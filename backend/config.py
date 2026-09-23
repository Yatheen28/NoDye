import os
from pathlib import Path

# Resolve relative to this file's directory, not CWD.
BACKEND_ROOT = Path(__file__).resolve().parent
ML_DIR = BACKEND_ROOT / "contrast-free-brain-mri"

_default_ckpt = ML_DIR / "checkpoints" / "generator_epoch0100.h5"
if not _default_ckpt.exists():
    # Fallback: repo-root copy of the ML project (same relative layout).
    _alt = BACKEND_ROOT.parent / "contrast-free-brain-mri" / "checkpoints" / "generator_epoch0100.h5"
    if _alt.exists():
        _default_ckpt = _alt

CHECKPOINT_PATH = os.environ.get("CHECKPOINT_PATH") or str(_default_ckpt)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# --------------------------------------------------------------------------- #
# Model 2: tumor classifier (tumor_predictor_package, EfficientNet-B0, .pth)
# --------------------------------------------------------------------------- #
# The package ships with its own `src/` modules and `models/best_model.pth`.
# It is looked up next to the backend first, then at the repo root.
_tumor_candidates = [
    BACKEND_ROOT / "tumor_predictor_package",
    BACKEND_ROOT.parent / "tumor_predictor_package",
]
TUMOR_PKG_DIR = Path(os.environ.get("TUMOR_PKG_DIR") or next((p for p in _tumor_candidates if p.exists()), _tumor_candidates[0]))
TUMOR_MODEL_PATH = os.environ.get("TUMOR_MODEL_PATH") or str(TUMOR_PKG_DIR / "models" / "best_model.pth")

# Model 2 is a 2-D classifier, so the generated 3-D volume is sampled at this
# many evenly spaced axial slices (centre slice always included).
TUMOR_SLICE_COUNT = max(1, int(os.environ.get("TUMOR_SLICE_COUNT", "9")))
# Set TUMOR_ANALYSIS_ENABLED=0 to skip Model 2 entirely (pipeline behaves as before).
TUMOR_ANALYSIS_ENABLED = os.environ.get("TUMOR_ANALYSIS_ENABLED", "1") not in ("0", "false", "False")

# Published validation benchmarks, used when no ground-truth T1CE is supplied.
BENCHMARK_METRICS = {"psnr": 32.4, "ssim": 0.912, "mae": 0.041}

BUCKET_RAW = "raw-scans"
BUCKET_RESULT = "result-scans"
BUCKET_PREVIEW = "previews"
BUCKET_HEATMAP = "heatmaps"
BUCKET_REPORTS = "reports"
