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

# Published validation benchmarks, used when no ground-truth T1CE is supplied.
BENCHMARK_METRICS = {"psnr": 32.4, "ssim": 0.912, "mae": 0.041}

BUCKET_RAW = "raw-scans"
BUCKET_RESULT = "result-scans"
BUCKET_PREVIEW = "previews"
BUCKET_HEATMAP = "heatmaps"
BUCKET_REPORTS = "reports"
