"""Model 2 integration: tumor classification on the synthetic T1CE produced by Model 1.

INTEGRATION OVERVIEW
--------------------
    Original T1 (.nii.gz)
        -> infer.py::infer_volume()            (Model 1, unchanged)
        -> synthetic_t1ce.nii.gz               (float32 volume in [0, 1])
        -> select_analysis_slices()            (which axial slices to analyse)
        -> adapt_model1_output()               (ADAPTER: 2-D slice -> uint8 RGB PIL)
        -> model2_inference()                  (Model 2, unchanged weights + preprocessing)
        -> analyze_tumor_result()              (aggregate per-slice results)
        -> dict stored in scans.tumor_analysis + PNGs in storage

Model 2 (tumor_predictor_package) is an EfficientNet-B0 *classifier* with four
classes (glioma / meningioma / no_tumor / pituitary).  It is NOT a segmentation
model, so it cannot produce a mask, a volume or an anatomical location.  What it
does produce is used verbatim: per-slice class probabilities, the predicted
class and a Grad-CAM saliency map.  Nothing else is invented here.

Neither model is retrained or modified.  Model 2's own preprocessing
(``src/dataset.py::get_transforms``) and loader (``tumor_detector._get_model``)
are reused directly so the network sees exactly the tensor it was trained on.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Callable

import matplotlib
matplotlib.use("Agg")
import nibabel as nib
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

from config import TUMOR_MODEL_PATH, TUMOR_PKG_DIR, TUMOR_SLICE_COUNT

# Make the package importable exactly as it expects (`from src.dataset import ...`).
if str(TUMOR_PKG_DIR) not in sys.path:
    sys.path.insert(0, str(TUMOR_PKG_DIR))

ProgressFn = Callable[[int, str, str | None], None]


# --------------------------------------------------------------------------- #
# Errors: every failure mode is a subclass so callers can catch one type.
# --------------------------------------------------------------------------- #
class TumorAnalysisError(RuntimeError):
    """Base class for anything that goes wrong in the Model 2 stage."""


class TumorModelMissingError(TumorAnalysisError):
    """best_model.pth or the package sources could not be found / imported."""


class TumorInputError(TumorAnalysisError):
    """The generated volume is not something Model 2 can consume."""


class TumorInferenceError(TumorAnalysisError):
    """Model 2 forward pass or Grad-CAM failed."""


# --------------------------------------------------------------------------- #
# Model 2 loading (once per process)
# --------------------------------------------------------------------------- #
_MODEL = None
_DEVICE: torch.device | None = None
_CLASSES: list[str] | None = None
_GRADCAM = None
_TRANSFORM = None
_CKPT_META: dict = {}

# Human-readable names are taken from the package so labels stay consistent.
_DISPLAY_NAMES: dict[str, str] = {}

# General reference text shown next to each tumour type.  This is static
# educational information, NOT a per-patient measurement.
TUMOR_TYPE_INSIGHTS: dict[str, str] = {
    "glioma_tumor": (
        "Arises from glial (supporting) cells within brain tissue. Gliomas are the most "
        "common primary intra-axial brain tumours and are graded I-IV by histology."
    ),
    "meningioma_tumor": (
        "Arises from the meninges covering the brain. Typically extra-axial, slow-growing "
        "and most often benign (WHO grade I), but may compress adjacent structures."
    ),
    "pituitary_tumor": (
        "Arises in the pituitary gland at the sella turcica. Usually benign adenomas; may "
        "present with endocrine changes or visual-field defects from optic-chiasm contact."
    ),
    "no_tumor": "No tumour class predicted by the classifier for this input.",
}


def load_tumor_model_once():
    """Load Model 2 a single time and keep it resident (mirrors load_model_once for Model 1).

    Returns (model, device, classes).  Raises TumorModelMissingError if the
    package or checkpoint is absent so the server can decide whether that is fatal.
    """
    global _MODEL, _DEVICE, _CLASSES, _GRADCAM, _TRANSFORM, _CKPT_META, _DISPLAY_NAMES
    if _MODEL is not None:
        return _MODEL, _DEVICE, _CLASSES

    if not Path(TUMOR_PKG_DIR).exists():
        raise TumorModelMissingError(f"tumor_predictor_package not found at {TUMOR_PKG_DIR}")
    if not Path(TUMOR_MODEL_PATH).exists():
        raise TumorModelMissingError(f"Tumor model checkpoint not found: {TUMOR_MODEL_PATH}")

    try:
        # Package internals are imported lazily so a missing package does not
        # break the Model 1 pipeline at import time.
        from src.dataset import CLASS_DISPLAY_NAMES, get_transforms  # noqa: WPS433
        from src.interpret import GradCAM  # noqa: WPS433
        from tumor_detector import _get_model  # noqa: WPS433
    except Exception as exc:  # ImportError or anything inside the package
        raise TumorModelMissingError(f"Could not import tumor_predictor_package: {exc}") from exc

    try:
        model, device, classes = _get_model(TUMOR_MODEL_PATH)
    except Exception as exc:
        raise TumorModelMissingError(f"Failed to load tumor model weights: {exc}") from exc

    # Checkpoint metadata (epoch / val metrics) is informational only.
    try:
        ck = torch.load(TUMOR_MODEL_PATH, map_location="cpu", weights_only=False)
        _CKPT_META = {
            "architecture": ck.get("architecture", "efficientnet_b0"),
            "epoch": ck.get("epoch"),
            "val_f1": round(float(ck["best_val_f1"]), 4) if "best_val_f1" in ck else None,
            "val_acc": round(float(ck["val_acc"]), 4) if "val_acc" in ck else None,
        }
    except Exception:
        _CKPT_META = {"architecture": "efficientnet_b0"}

    _MODEL, _DEVICE, _CLASSES = model, device, list(classes)
    _DISPLAY_NAMES = dict(CLASS_DISPLAY_NAMES)
    # Model 2's own eval-time transform: Resize(224) -> ToTensor -> ImageNet Normalize.
    _TRANSFORM = get_transforms(224, is_train=False)
    # One GradCAM per process.  The package's predict_tumor_from_image() builds a
    # new GradCAM (and registers new hooks) on every call, which leaks hooks; a
    # single shared instance avoids that.
    _GRADCAM = GradCAM(model)
    print(f"[NoDye] Tumor classifier loaded from {TUMOR_MODEL_PATH} on {device} (classes={_CLASSES})")
    return _MODEL, _DEVICE, _CLASSES


def tumor_model_status() -> dict:
    """For /health: whether Model 2 is loaded and where it was looked for."""
    return {
        "loaded": _MODEL is not None,
        "checkpoint": os.path.basename(TUMOR_MODEL_PATH),
        "checkpoint_exists": Path(TUMOR_MODEL_PATH).exists(),
        "device": str(_DEVICE) if _DEVICE is not None else None,
        **_CKPT_META,
    }


# --------------------------------------------------------------------------- #
# Volume validation + slice selection
# --------------------------------------------------------------------------- #
def load_generated_volume(pred_path: str) -> np.ndarray:
    """Load Model 1's output NIfTI and validate that it is a 3-D scalar volume."""
    if not os.path.exists(pred_path):
        raise TumorInputError(f"Generated MRI not found: {pred_path}")
    try:
        vol = nib.load(pred_path).get_fdata(dtype=np.float32)
    except Exception as exc:
        raise TumorInputError(f"Generated MRI is not a readable NIfTI volume: {exc}") from exc
    if vol.ndim == 4 and vol.shape[3] == 1:
        vol = vol[..., 0]
    if vol.ndim != 3:
        raise TumorInputError(f"Expected a 3-D volume, got shape {vol.shape}")
    if min(vol.shape) < 8:
        raise TumorInputError(f"Volume too small to analyse: shape {vol.shape}")
    if not np.isfinite(vol).all():
        raise TumorInputError("Generated MRI contains NaN/Inf values")
    return vol


def generated_slice_range(vol: np.ndarray) -> tuple[int, int]:
    """Return [lo, hi] of axial slices that Model 1 actually filled (non-zero).

    infer_volume() leaves the top/bottom `trim_frac` slices as zeros, so we
    only analyse slices that contain generated signal.
    """
    nonzero = np.where(np.abs(vol).reshape(-1, vol.shape[2]).max(axis=0) > 1e-6)[0]
    if nonzero.size == 0:
        raise TumorInputError("Generated MRI is empty (all slices are zero)")
    return int(nonzero[0]), int(nonzero[-1])


def select_analysis_slices(vol: np.ndarray, count: int = TUMOR_SLICE_COUNT) -> list[int]:
    """Evenly spaced axial indices within the generated range; centre slice always included."""
    lo, hi = generated_slice_range(vol)
    centre = vol.shape[2] // 2
    if count <= 1 or hi == lo:
        return [min(max(centre, lo), hi)]
    idx = np.linspace(lo, hi, num=count).round().astype(int).tolist()
    if lo <= centre <= hi and centre not in idx:
        # Replace the nearest sample so the centre slice is always analysed.
        nearest = min(range(len(idx)), key=lambda i: abs(idx[i] - centre))
        idx[nearest] = centre
    return sorted(set(idx))


# --------------------------------------------------------------------------- #
# ADAPTER: Model 1 output -> Model 2 input
# --------------------------------------------------------------------------- #
def adapt_model1_output(vol: np.ndarray, z: int) -> Image.Image:
    """Convert one axial slice of Model 1's [0, 1] float volume into the RGB PIL image Model 2 expects.

    Contract on each side:
      * Model 1 output : float32, shape (H, W, D), intensity in [0, 1], NIfTI axes.
      * Model 2 input  : PIL.Image, mode RGB, any size (its own transform resizes to 224x224
                         and applies ImageNet mean/std).

    The conversion is deliberately identical to inference_service.save_preview_png
    (clip -> *255 -> uint8 -> rot90), so the classifier sees exactly the image the
    clinician sees in the preview.  Grayscale is replicated to three channels, which
    is what the package itself does for grayscale inputs (tumor_detector.py).
    No contrast stretching or other intensity manipulation is applied.
    """
    if not (0 <= z < vol.shape[2]):
        raise TumorInputError(f"Slice index {z} out of range for depth {vol.shape[2]}")
    sl = np.clip(vol[:, :, z], 0.0, 1.0)
    sl_u8 = np.rot90((sl * 255.0).astype(np.uint8))
    return Image.fromarray(np.ascontiguousarray(sl_u8)).convert("RGB")


# --------------------------------------------------------------------------- #
# Model 2 inference on one slice
# --------------------------------------------------------------------------- #
def model2_inference(pil_img: Image.Image, *, gradcam: bool = True) -> dict:
    """Run Model 2 on one RGB image.  Returns raw per-class probabilities + Grad-CAM.

    Returns
    -------
    {
      "probabilities": {class_key: float in [0, 1]},
      "predicted_class": class_key,
      "predicted_index": int,
      "heatmap": np.ndarray (h, w) in [0, 1] or None,   # Grad-CAM for the predicted class
    }
    """
    model, device, classes = load_tumor_model_once()
    try:
        x = _TRANSFORM(pil_img).unsqueeze(0).to(device)
        with torch.no_grad():
            logits = model(x)
        probs = F.softmax(logits, dim=1).squeeze(0).cpu().numpy().astype(float)
        top = int(np.argmax(probs))
    except Exception as exc:
        raise TumorInferenceError(f"Tumor classifier forward pass failed: {exc}") from exc

    heatmap = None
    if gradcam:
        try:
            # Grad-CAM needs gradients, so a second forward+backward is run by the
            # package's own implementation (targeting the predicted class).
            x_grad = x.detach().clone().requires_grad_(True)
            heatmap, _ = _GRADCAM.generate_heatmap(x_grad, target_class_idx=top)
            heatmap = np.asarray(heatmap, dtype=np.float32)
        except Exception as exc:
            # Grad-CAM is explanatory only; a failure here must not lose the classification.
            print(f"[NoDye] Grad-CAM failed: {exc}")
            heatmap = None

    return {
        "probabilities": {classes[i]: float(probs[i]) for i in range(len(classes))},
        "predicted_class": classes[top],
        "predicted_index": top,
        "heatmap": heatmap,
    }


# --------------------------------------------------------------------------- #
# Visualisations (Grad-CAM is a saliency map, NOT a segmentation mask)
# --------------------------------------------------------------------------- #
def render_heatmap_png(heatmap: np.ndarray, size: tuple[int, int], out_png: str) -> None:
    """Colour-map the Grad-CAM heat map alone (jet), resized to the MRI slice size."""
    w, h = size
    hm = Image.fromarray((np.clip(heatmap, 0, 1) * 255).astype(np.uint8)).resize((w, h), Image.Resampling.BICUBIC)
    cmap = matplotlib.colormaps["jet"]
    rgb = (cmap(np.asarray(hm) / 255.0)[:, :, :3] * 255).astype(np.uint8)
    Image.fromarray(rgb).save(out_png)


def render_overlay_png(pil_img: Image.Image, heatmap: np.ndarray, out_png: str) -> None:
    """MRI + Grad-CAM blend using the package's own overlay routine."""
    from src.interpret import overlay_gradcam_on_image  # noqa: WPS433

    overlay_gradcam_on_image(pil_img, heatmap).save(out_png)


# --------------------------------------------------------------------------- #
# Aggregation
# --------------------------------------------------------------------------- #
def _risk_tier(p: float) -> str:
    from src.model import get_risk_tier  # noqa: WPS433  (package's own thresholds)

    return get_risk_tier(p)


def analyze_tumor_result(per_slice: list[dict], classes: list[str], *, depth: int, generated_range: tuple[int, int]) -> dict:
    """Aggregate per-slice classifier outputs into one volume-level summary.

    Aggregation is a plain mean of softmax probabilities across the analysed
    slices (stated in the output so the reader knows how the number was made).
    "Tumor detected" means the class with the highest *mean* probability is a
    tumour class.  Per-slice votes are also reported.
    """
    if not per_slice:
        raise TumorInferenceError("No slices were analysed")

    mean_p = {c: float(np.mean([s["probabilities"][c] for s in per_slice])) for c in classes}
    max_p = {c: float(np.max([s["probabilities"][c] for s in per_slice])) for c in classes}
    votes = {c: sum(1 for s in per_slice if s["predicted_class"] == c) for c in classes}

    primary_key = max(mean_p, key=mean_p.get)
    p_no_tumor = mean_p.get("no_tumor", 0.0)
    tumor_chance = float(np.clip(1.0 - p_no_tumor, 0.0, 1.0))
    tumor_detected = primary_key != "no_tumor"

    categories = []
    for c in classes:
        categories.append({
            "class_key": c,
            "name": _DISPLAY_NAMES.get(c, c),
            "mean_probability_pct": round(mean_p[c] * 100.0, 1),
            "max_probability_pct": round(max_p[c] * 100.0, 1),
            "slices_predicted": votes[c],
            "risk_tier": "Healthy / No Tumour" if c == "no_tumor" else _risk_tier(mean_p[c]),
            "is_tumor_type": c != "no_tumor",
            "insight": TUMOR_TYPE_INSIGHTS.get(c, ""),
        })
    categories.sort(key=lambda d: d["mean_probability_pct"], reverse=True)

    positive = [s["z"] for s in per_slice if s["predicted_class"] != "no_tumor"]
    # Representative slice: highest per-slice tumour chance (or centre-most if none).
    rep = max(per_slice, key=lambda s: s["tumor_chance_pct"])["z"]

    n = len(per_slice)
    primary_name = _DISPLAY_NAMES.get(primary_key, primary_key)
    if tumor_detected:
        summary = (
            f"The AI analyzed the scan and found that a tumour is likely present (overall chance: {tumor_chance * 100:.1f}%). "
            f"The most probable type is {primary_name}."
        )
    else:
        summary = (
            f"The AI analyzed the scan and did not find strong evidence of a tumour. "
            f"The scan appears healthy (tumour chance: {tumor_chance * 100:.1f}%)."
        )

    return {
        "tumor_detected": tumor_detected,
        "overall_tumor_chance_pct": round(tumor_chance * 100.0, 1),
        "overall_healthy_chance_pct": round(p_no_tumor * 100.0, 1),
        "overall_risk_tier": _risk_tier(tumor_chance),
        "primary_finding": {
            "class_key": primary_key,
            "name": primary_name,
            "mean_probability_pct": round(mean_p[primary_key] * 100.0, 1),
            "risk_tier": "Healthy / No Tumour" if primary_key == "no_tumor" else _risk_tier(mean_p[primary_key]),
        },
        "aggregation": f"mean of softmax probabilities over {n} analysed slices",
        "categories": categories,
        "slices_total": depth,
        "slices_generated_range": [generated_range[0], generated_range[1]],
        "slices_analyzed": [s["z"] for s in per_slice],
        "tumor_positive_slices": positive,
        "tumor_positive_count": len(positive),
        "representative_slice": rep,
        # Explicitly state what this model cannot provide (no fabrication).
        "not_available": {
            "segmentation_mask": "Model 2 is a classifier; it does not output a mask.",
            "volume": "Not measurable without a segmentation mask.",
            "location": "Not quantified. Grad-CAM shows influential regions only.",
        },
        "summary_text": summary,
        "disclaimer": (
            "AI-generated result from an image classifier trained on 2-D brain MRI. It is not a "
            "diagnosis and must be reviewed by a qualified radiologist. Grad-CAM overlays indicate "
            "model attention, not tumour boundaries."
        ),
    }


# --------------------------------------------------------------------------- #
# Full Model 2 stage on a generated volume
# --------------------------------------------------------------------------- #
def run_tumor_analysis(
    pred_path: str,
    out_dir: str,
    *,
    progress: ProgressFn | None = None,
    slice_count: int = TUMOR_SLICE_COUNT,
    gradcam: bool = True,
) -> tuple[dict, list[tuple[str, str]]]:
    """Analyse Model 1's generated volume with Model 2.

    Returns (analysis_dict, files) where `files` is a list of
    (relative_name, local_png_path) that the caller uploads to storage.  The
    analysis dict references images by the same relative names under
    slices[i]["images"], so the caller only has to prefix them.
    """
    model, device, classes = load_tumor_model_once()
    vol = load_generated_volume(pred_path)
    lo, hi = generated_slice_range(vol)
    zs = select_analysis_slices(vol, slice_count)
    os.makedirs(out_dir, exist_ok=True)

    per_slice: list[dict] = []
    files: list[tuple[str, str]] = []
    for i, z in enumerate(zs):
        if progress:
            progress(88 + int(7 * i / max(len(zs), 1)), "AI tumour analysis", f"Slice {z} ({i + 1}/{len(zs)})")
        pil_img = adapt_model1_output(vol, z)          # <- Model 1 -> Model 2 hand-off
        res = model2_inference(pil_img, gradcam=gradcam)

        mri_name = f"tumor/z{z:03d}_mri.png"
        mri_path = os.path.join(out_dir, f"z{z:03d}_mri.png")
        pil_img.save(mri_path)
        images = {"mri": mri_name}
        files.append((mri_name, mri_path))

        if res["heatmap"] is not None:
            hm_name, ov_name = f"tumor/z{z:03d}_heatmap.png", f"tumor/z{z:03d}_overlay.png"
            hm_path, ov_path = os.path.join(out_dir, f"z{z:03d}_heatmap.png"), os.path.join(out_dir, f"z{z:03d}_overlay.png")
            render_heatmap_png(res["heatmap"], pil_img.size, hm_path)
            render_overlay_png(pil_img, res["heatmap"], ov_path)
            images.update({"heatmap": hm_name, "overlay": ov_name})
            files += [(hm_name, hm_path), (ov_name, ov_path)]

        probs = res["probabilities"]
        per_slice.append({
            "z": z,
            "predicted_class": res["predicted_class"],
            "predicted_name": _DISPLAY_NAMES.get(res["predicted_class"], res["predicted_class"]),
            "confidence_pct": round(probs[res["predicted_class"]] * 100.0, 1),
            "tumor_chance_pct": round((1.0 - probs.get("no_tumor", 0.0)) * 100.0, 1),
            "probabilities": probs,
            "probabilities_pct": {k: round(v * 100.0, 1) for k, v in probs.items()},
            "images": images,
        })

    analysis = analyze_tumor_result(per_slice, classes, depth=vol.shape[2], generated_range=(lo, hi))
    analysis["slices"] = per_slice
    analysis["status"] = "ok"
    analysis["error"] = None
    analysis["model"] = {
        "name": "Brain tumour classifier (EfficientNet-B0, tumor_predictor_package)",
        "checkpoint": os.path.basename(TUMOR_MODEL_PATH),
        "classes": classes,
        "input": "2-D axial slice of synthetic T1CE, 224x224 RGB, ImageNet normalisation",
        "device": str(device),
        **_CKPT_META,
    }
    analysis["source"] = "synthetic_t1ce"
    return analysis, files


def failed_analysis(exc: Exception) -> dict:
    """Structured placeholder stored when Model 2 could not run, so the UI can explain why."""
    kind = {
        TumorModelMissingError: "model_missing",
        TumorInputError: "invalid_input",
        TumorInferenceError: "inference_failed",
    }.get(type(exc), "error")
    return {"status": "failed", "error_kind": kind, "error": str(exc), "slices": []}
