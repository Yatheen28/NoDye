"""Orchestrates one inference job: infer.py (in-process) -> heatmap -> metrics -> storage -> scans row.

Nothing here re-implements preprocessing, model loading or reconstruction; those
live in contrast-free-brain-mri/infer.py and train.py and are called directly.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from typing import Callable

import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import nibabel as nib
import numpy as np
import torch
import torchvision.transforms.functional as TF

from config import (
    BENCHMARK_METRICS,
    BUCKET_HEATMAP,
    BUCKET_PREVIEW,
    BUCKET_RAW,
    BUCKET_RESULT,
    CHECKPOINT_PATH,
    ML_DIR,
    TUMOR_ANALYSIS_ENABLED,
)

# Make the ML project importable exactly as it expects (`from train import load_generator`).
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))

from evaluate_metrics import evaluate_patient_scan  # noqa: E402
from infer import _load_volume, _normalise, infer_volume  # noqa: E402
from train import load_generator  # noqa: E402

# INTEGRATION: Model 2 (tumour classifier) lives in tumor_service.py and consumes
# the synthetic T1CE that infer_volume() writes.  See run_inference_job below.
import tumor_service  # noqa: E402

ProgressFn = Callable[[int, str, str | None], None]

_GENERATOR = None
_DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


def load_model_once():
    """Load the generator a single time at server startup and keep it resident."""
    global _GENERATOR
    if _GENERATOR is None:
        if not Path(CHECKPOINT_PATH).exists():
            raise FileNotFoundError(f"Checkpoint not found: {CHECKPOINT_PATH}")
        _GENERATOR = load_generator(CHECKPOINT_PATH, _DEVICE)
        print(f"[NoDye] Generator loaded from {CHECKPOINT_PATH} on {_DEVICE}")
    return _GENERATOR


def device_name() -> str:
    return str(_DEVICE)


# --------------------------------------------------------------------------- #
# Heatmap: replaced with Absolute Difference plot per user request
# --------------------------------------------------------------------------- #
def extract_attention_heatmap(t1_vol_norm: np.ndarray, z: int, out_png: str, img_size: int = 256) -> None:
    G = load_model_once()
    H, W = t1_vol_norm.shape[:2]

    with torch.no_grad():
        x = torch.from_numpy(t1_vol_norm[:, :, z]).unsqueeze(0)
        x = TF.resize(x, [img_size, img_size], antialias=True).unsqueeze(0).to(_DEVICE)
        out = G(x)
        
    input_img = x.squeeze().cpu().numpy()
    gen_img = out.squeeze().cpu().numpy()
    
    # Calculate difference and resize back to original slice dimensions
    diff = np.abs(input_img - gen_img)
    diff = cv2.resize(diff, (W, H))
    difference = np.rot90(diff)

    fig, ax = plt.subplots(figsize=(6, 6))
    # Match frontend dark theme background
    fig.patch.set_facecolor('#000000')
    ax.set_facecolor('#000000')
    
    # Expose ax as a mock dictionary so the exact user snippet works perfectly
    axes = {(1, 0): ax}

    im = axes[1, 0].imshow(
        difference,
        cmap="hot",
        vmin=0,
        vmax=0.2
    )
    axes[1, 0].axis("off")
    
    cb = plt.colorbar(im, ax=axes[1, 0], fraction=0.046)
    cb.ax.tick_params(colors='white')

    fig.savefig(out_png, bbox_inches='tight', facecolor=fig.get_facecolor())
    plt.close(fig)


def save_preview_png(pred_path: str, z: int, out_png: str) -> None:
    vol = nib.load(pred_path).get_fdata(dtype=np.float32)
    sl = np.clip(vol[:, :, z], 0.0, 1.0)
    cv2.imwrite(out_png, np.rot90((sl * 255).astype(np.uint8)))


def _find_ground_truth(t1_path: str, original_name: str, upload_dir: str) -> str | None:
    """BraTS convention: *_t1.nii.gz -> *_t1ce.nii.gz in the same folder (demo mode)."""
    if not original_name.endswith("_t1.nii.gz"):
        return None
    gt_name = original_name.replace("_t1.nii.gz", "_t1ce.nii.gz")
    for folder in (upload_dir, os.path.dirname(t1_path)):
        cand = os.path.join(folder, gt_name)
        if os.path.exists(cand):
            return cand
    return None


# --------------------------------------------------------------------------- #
# Main job
# --------------------------------------------------------------------------- #
def run_inference_job(
    *,
    sb,  # supabase service-role Client
    hospital_id: str,
    patient_id: str,
    upload_bytes: bytes,
    original_filename: str,
    gt_bytes: bytes | None,
    progress: ProgressFn,
) -> dict:
    with tempfile.TemporaryDirectory(prefix="nodye_") as tmp:
        safe_name = os.path.basename(original_filename) or "input.nii.gz"
        t1_path = os.path.join(tmp, safe_name)
        with open(t1_path, "wb") as fh:
            fh.write(upload_bytes)
        if gt_bytes and safe_name.endswith("_t1.nii.gz"):
            with open(os.path.join(tmp, safe_name.replace("_t1.nii.gz", "_t1ce.nii.gz")), "wb") as fh:
                fh.write(gt_bytes)

        progress(10, "Preprocessing complete", "Volume loaded and normalised")

        out_path = os.path.join(tmp, "synthetic_t1ce.nii.gz")

        def on_slice(done: int, total: int) -> None:
            pct = 15 + int(70 * done / max(total, 1))
            progress(pct, "Synthesising contrast", f"Slice {done}/{total}")

        infer_volume(
            t1_path,
            CHECKPOINT_PATH,
            out_path,
            progress_callback=on_slice,
            generator=load_model_once(),
        )

        progress(86, "Extracting attention heatmap", "Hooking att1.psi")
        t1_norm = _normalise(_load_volume(t1_path))
        z = t1_norm.shape[2] // 2
        preview_png = os.path.join(tmp, "preview.png")
        raw_preview_png = os.path.join(tmp, "raw_preview.png")
        heatmap_png = os.path.join(tmp, "heatmap.png")
        save_preview_png(out_path, z, preview_png)
        save_preview_png(t1_path, z, raw_preview_png)
        extract_attention_heatmap(t1_norm, z, heatmap_png)

        # ------------------------------------------------------------------ #
        # INTEGRATION POINT: Model 1 output -> Model 2.
        # `out_path` (synthetic_t1ce.nii.gz, float32 in [0,1]) is the *only*
        # thing handed to the tumour classifier.  Model 2 failures are recorded
        # in the scan row but never abort the existing contrast pipeline.
        # ------------------------------------------------------------------ #
        tumor_dir = os.path.join(tmp, "tumor")
        tumor_files: list[tuple[str, str]] = []
        if TUMOR_ANALYSIS_ENABLED:
            try:
                tumor_analysis, tumor_files = tumor_service.run_tumor_analysis(out_path, tumor_dir, progress=progress)
            except tumor_service.TumorAnalysisError as exc:
                print(f"[NoDye] Tumor analysis skipped: {exc}")
                tumor_analysis = tumor_service.failed_analysis(exc)
            except Exception as exc:  # unexpected: still keep Model 1 results
                print(f"[NoDye] Tumor analysis crashed: {exc}")
                tumor_analysis = tumor_service.failed_analysis(exc)
        else:
            tumor_analysis = {"status": "disabled", "error": None, "slices": []}

        progress(95, "Computing metrics", None)
        gt_path = _find_ground_truth(t1_path, safe_name, tmp)
        if gt_path:
            metrics = evaluate_patient_scan(gt_path, out_path)
            metrics_source = "measured"
        else:
            metrics = dict(BENCHMARK_METRICS)
            metrics_source = "benchmark"

        progress(98, "Uploading to storage", None)
        import uuid

        scan_id = str(uuid.uuid4())
        prefix = f"{hospital_id}/{patient_id}/{scan_id}"
        paths = {
            "raw_scan_url": _upload(sb, BUCKET_RAW, f"{prefix}/{safe_name}", t1_path, "application/gzip"),
            "result_scan_url": _upload(sb, BUCKET_RESULT, f"{prefix}/synthetic_t1ce.nii.gz", out_path, "application/gzip"),
            "preview_image_url": _upload(sb, BUCKET_PREVIEW, f"{prefix}/preview.png", preview_png, "image/png"),
            "attention_map_url": _upload(sb, BUCKET_HEATMAP, f"{prefix}/heatmap.png", heatmap_png, "image/png"),
        }
        # Also upload the raw preview (we don't have a column for it, but frontend can infer its path)
        _upload(sb, BUCKET_PREVIEW, f"{prefix}/raw_preview.png", raw_preview_png, "image/png")

        # Model 2 images (per-slice MRI / Grad-CAM heat map / overlay) go in the
        # existing `heatmaps` bucket under <prefix>/tumor/... so no new bucket or
        # storage policy is required.  Paths inside the JSON are rewritten to the
        # full object path so the frontend can sign them directly.
        if tumor_files:
            for rel_name, local in tumor_files:
                _upload(sb, BUCKET_HEATMAP, f"{prefix}/{rel_name}", local, "image/png")
            for sl in tumor_analysis.get("slices", []):
                sl["images"] = {k: f"{prefix}/{v}" for k, v in sl["images"].items()}
            tumor_analysis["images_bucket"] = BUCKET_HEATMAP

        row = {
            "scan_id": scan_id,
            "patient_id": patient_id,
            **paths,
            "psnr": round(metrics["psnr"], 4),
            "ssim": round(metrics["ssim"], 4),
            "mae": round(metrics["mae"], 4),
            "metrics_source": metrics_source,
        }
        sb.table("scans").insert(row).execute()

        # Stored separately so a database that has not yet run
        # supabase/migrations/002_tumor_analysis.sql still records the scan.
        try:
            sb.table("scans").update({"tumor_analysis": tumor_analysis}).eq("scan_id", scan_id).execute()
        except Exception as exc:
            print(f"[NoDye] Could not store tumor_analysis (run migration 002?): {exc}")

        return {
            "scan_id": scan_id,
            "metrics": {**metrics, "source": metrics_source},
            "tumor": _tumor_summary(tumor_analysis),
        }


def _tumor_summary(analysis: dict) -> dict:
    """Compact Model 2 summary for the WebSocket `complete` event."""
    if analysis.get("status") != "ok":
        return {"status": analysis.get("status", "failed"), "error": analysis.get("error")}
    pf = analysis.get("primary_finding", {})
    return {
        "status": "ok",
        "tumor_detected": analysis.get("tumor_detected"),
        "primary_finding": pf.get("name"),
        "primary_probability_pct": pf.get("mean_probability_pct"),
        "overall_tumor_chance_pct": analysis.get("overall_tumor_chance_pct"),
        "overall_risk_tier": analysis.get("overall_risk_tier"),
    }


def _upload(sb, bucket: str, object_path: str, local_path: str, content_type: str) -> str:
    with open(local_path, "rb") as fh:
        sb.storage.from_(bucket).upload(
            object_path, fh.read(), {"content-type": content_type, "upsert": "true"}
        )
    return object_path
