<div align="center">

# NoDye

### Contrast-Free Brain MRI Synthesis with AI Tumor Analysis

[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.104%2B-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-2-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

</div>

---

## Overview

**NoDye** is a clinical AI platform that eliminates the need for gadolinium-based contrast agents in brain MRI by synthesising contrast-enhanced T1 (T1CE) images from standard T1 scans — and then automatically screening the synthetic scan for brain tumours.

The system chains two independent deep-learning models into a single, end-to-end inference pipeline:

| Stage | Model | Output |
|---|---|---|
| **Model 1** — Contrast Synthesis | Attention U-Net (`.h5`) | Synthetic T1CE NIfTI volume |
| **Model 2** — Tumor Classification | EfficientNet-B0 (`.pth`) | Per-slice tumour probabilities + Grad-CAM |

Neither model is retrained or modified. The integration is a clean adapter layer that converts Model 1's float32 NIfTI output into the RGB PIL images Model 2 was trained on.

---

## Pipeline Architecture

```
Original BraTS 2021 T1 MRI (.nii.gz)
          │
          ▼
┌─────────────────────────────┐
│  Model 1 Preprocessing      │  _load_volume() + _normalise()
│  (Attention U-Net)          │  infer_volume() — slice-by-slice
└─────────────────────────────┘
          │
          ▼  synthetic_t1ce.nii.gz  (float32, [0,1])
          │
          ▼
┌─────────────────────────────┐
│  ADAPTER LAYER              │  adapt_model1_output()
│  float32 slice → uint8 RGB  │  clip → ×255 → rot90 → PIL RGB
└─────────────────────────────┘
          │
          ▼  PIL.Image (RGB, any size)
          │
          ▼
┌─────────────────────────────┐
│  Model 2 Preprocessing      │  get_transforms(224, is_train=False)
│  (EfficientNet-B0)          │  Resize(224) → ToTensor → ImageNet norm
└─────────────────────────────┘
          │
          ▼
┌─────────────────────────────┐
│  Tumor Classifier           │  4-class softmax
│  + Grad-CAM                 │  glioma / meningioma / pituitary / no_tumor
└─────────────────────────────┘
          │
          ▼
┌─────────────────────────────┐
│  Aggregation                │  Mean probabilities over 9 axial slices
│  + Report Generation        │  PDF with AI Tumor Analysis section
└─────────────────────────────┘
```

---

## Key Features

- **Zero contrast agents** — synthesises T1CE from T1 using a trained Attention U-Net
- **Automatic tumour screening** — EfficientNet-B0 classifies 9 evenly-spaced axial slices of the synthetic scan
- **Grad-CAM visualisation** — saliency maps highlight regions that influenced the prediction (not a segmentation mask)
- **3-panel AI overlay** — Generated MRI · Grad-CAM heatmap · Blended overlay, per slice
- **Interactive slice navigator** — step through all analysed slices in the web UI; tumour-positive slices are highlighted in red
- **Per-type breakdown** — glioma, meningioma, pituitary, and healthy probabilities with risk tiers and clinical insights
- **Professional PDF report** — ReportLab-generated clinical report with the full AI Tumor Analysis section embedded
- **Multi-hospital SaaS** — Supabase auth + RLS; each hospital sees only its own patients and scans
- **Real-time progress** — WebSocket stream with per-stage progress from upload to complete

---

## Repository Structure

```
.
├── backend/                          # FastAPI server
│   ├── main.py                       # API routes: /infer, /ws/infer/{id}, /scans/{id}/pdf
│   ├── inference_service.py          # Model 1 orchestration + storage upload
│   ├── tumor_service.py              # Model 2 pipeline (adapter → classifier → aggregation)
│   ├── pdf_service.py                # ReportLab clinical PDF with AI Tumor Analysis section
│   ├── config.py                     # Paths, feature flags, bucket names
│   ├── auth.py                       # Supabase JWT verification + RLS helpers
│   ├── run_pipeline_local.py         # Local end-to-end test (no Supabase required)
│   ├── requirements.txt
│   └── tumor_predictor_package/      # Model 2 portable package
│       ├── tumor_detector.py         # One-function public API: predict_tumor_from_image()
│       ├── models/
│       │   └── best_model.pth        # EfficientNet-B0 weights (val F1 = 0.9745)
│       └── src/
│           ├── model.py              # BrainTumorClassifier + risk tier scoring
│           ├── dataset.py            # Transforms, class names
│           └── interpret.py          # GradCAM + overlay utilities
│
├── frontend/                         # React + TypeScript + Vite
│   └── src/
│       ├── pages/
│       │   ├── ResultsPage.tsx       # Main results view with AI Tumor Analysis section
│       │   └── UploadPage.tsx        # NIfTI upload + real-time WebSocket progress
│       ├── components/
│       │   └── TumorAnalysisPanel.tsx # 3-panel images, finding card, slice navigator
│       ├── hooks/
│       │   └── useWebSocket.ts       # WebSocket progress hook (captures tumor summary)
│       └── lib/
│           └── supabase.ts           # Supabase client + domain types (TumorAnalysis, Scan)
│
├── contrast-free-brain-mri/          # Model 1 ML project (Attention U-Net)
│   ├── infer.py                      # infer_volume() — slice-by-slice inference
│   ├── train.py                      # load_generator() — model loading
│   └── checkpoints/                  # generator_epoch0100.h5 (gitignored)
│
└── supabase/
    └── migrations/
        ├── 001_schema.sql            # Base schema: hospitals, patients, scans
        └── 002_tumor_analysis.sql    # Adds tumor_analysis JSONB column to scans
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **ML — Model 1** | PyTorch / Keras Attention U-Net, NiBabel, NumPy |
| **ML — Model 2** | PyTorch, EfficientNet-B0 (torchvision), Grad-CAM |
| **Backend** | FastAPI, Uvicorn, WebSockets, ReportLab |
| **Database** | Supabase (PostgreSQL + Row Level Security) |
| **Storage** | Supabase Storage (private buckets, signed URLs) |
| **Frontend** | React 18, TypeScript, Vite, plain CSS design system |
| **Auth** | Supabase Auth (JWT, per-hospital isolation) |

---

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works)
- Model 1 checkpoint: `contrast-free-brain-mri/checkpoints/generator_epoch0100.h5`
- Model 2 checkpoint: `backend/tumor_predictor_package/models/best_model.pth` *(tracked in this repo)*

### 1. Clone & install

```bash
git clone https://github.com/Yatheen28/NoDye.git
cd NoDye

# Backend
cd backend
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### 2. Configure environment

```bash
# backend/.env  (copy from backend/.env.example)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
CHECKPOINT_PATH=../contrast-free-brain-mri/checkpoints/generator_epoch0100.h5

# frontend/.env.local
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_BACKEND_URL=http://localhost:8000
```

### 3. Run database migrations

```bash
# In your Supabase SQL editor, run in order:
supabase/migrations/001_schema.sql
supabase/migrations/002_tumor_analysis.sql
```

### 4. Start the servers

```bash
# Terminal 1 — Backend
cd backend
uvicorn main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and sign in with your Supabase hospital account.

---

## Local Pipeline Test (No Supabase)

To verify the full two-model pipeline without any cloud dependencies:

```bash
cd backend
python run_pipeline_local.py /path/to/BraTS2021_XXXXX_t1.nii.gz --out ./local_out
```

This produces:
```
local_out/
├── synthetic_t1ce.nii.gz     # Model 1 output
├── preview.png               # Central axial slice preview
├── heatmap.png               # Absolute difference map
├── tumor_analysis.json       # Full Model 2 result (all 9 slices)
├── report.pdf                # Complete clinical PDF
└── tumor/
    ├── z038_mri.png          # Generated MRI for each analysed slice
    ├── z038_heatmap.png      # Grad-CAM activation map
    └── z038_overlay.png      # MRI + heatmap blend
```

**Example output** (BraTS 2021 T1, 155 axial slices):

```
tumor_detected       : False
primary_finding      : Healthy (No Tumor) (72.8%, High Risk / Primary Suspicion)
overall_tumor_chance : 27.2% [Moderate Risk / Secondary Suspicion]
slices analysed      : [0, 19, 38, 58, 77, 96, 116, 135, 154]
tumour-positive      : [38]   ← slice z=38 flagged as Meningioma (88.2%)

Category breakdown:
  Healthy (No Tumor)   mean  72.8%  max  92.1%  votes 8
  Meningioma Tumor     mean  16.3%  max  88.2%  votes 1
  Pituitary Tumor      mean   6.7%  max  12.1%  votes 0
  Glioma Tumor         mean   4.2%  max   7.5%  votes 0
```

---

## Model Details

### Model 1 — Attention U-Net (Contrast Synthesis)

| Property | Value |
|---|---|
| Architecture | Attention U-Net |
| Input | T1 MRI, single axial slice, normalised [0, 1] |
| Output | Synthetic T1CE slice, float32 [0, 1] |
| Checkpoint | `generator_epoch0100.h5` |
| Benchmark PSNR | 32.4 dB |
| Benchmark SSIM | 0.912 |
| Benchmark MAE | 0.041 |

### Model 2 — EfficientNet-B0 (Tumor Classifier)

| Property | Value |
|---|---|
| Architecture | EfficientNet-B0 (transfer learning) |
| Classes | glioma · meningioma · pituitary · no_tumor |
| Input | 224×224 RGB PIL image, ImageNet normalisation |
| Output | 4-class softmax probabilities + Grad-CAM heatmap |
| Checkpoint | `best_model.pth` |
| Validation F1 | **0.9745** |
| Validation Accuracy | **0.9721** |
| Training data | BraTS / Kaggle Brain Tumor MRI Dataset |

> **Important:** Model 2 is a 2-D image classifier, not a segmentation model. It cannot produce a tumour mask, volume, or anatomical location. Grad-CAM overlays indicate model attention, not tumour boundaries. All results must be reviewed by a qualified radiologist.

---

## Web Interface

### Upload Page
- Select a patient from the hospital's patient list
- Upload a `.nii` or `.nii.gz` T1 volume
- Real-time WebSocket progress bar with stage labels (Preprocessing → Synthesising → AI tumour analysis → Complete)

### Results Page

```
┌─ Existing Report ──────────────────────────────────────────────┐
│  [Synthetic T1CE preview]    [Absolute difference heatmap]     │
│  Image Quality Metrics: PSNR · SSIM · MAE                     │
│  Downloads: .nii.gz · Preview PNG · Heatmap PNG               │
└────────────────────────────────────────────────────────────────┘

┌─ AI Tumor Analysis ────────────────────────────────────────────┐
│  [Generated MRI]  [Grad-CAM heatmap]  [AI overlay]            │
│                                                                │
│  ◀ Prev  Slice z=38 · Meningioma (88.2%) · tumour 91.1%  Next ▶│
│  ● ● ● ● ● ● ● ● ●   (red dot = tumour-positive slice)        │
│                                                                │
│  ┌──────────────────────────────────┬──────────────────────┐  │
│  │ AI Finding                       │  NO TUMOUR PREDICTED │  │
│  │ Healthy (No Tumor) — 72.8%       │  (green badge)       │  │
│  │ Overall tumour chance: 27.2%     │                      │  │
│  │ Affected slices: 1 of 9 analysed │                      │  │
│  └──────────────────────────────────┴──────────────────────┘  │
│                                                                │
│  Tumour type breakdown:                                        │
│  Category          Mean   Max   Slices  Risk tier             │
│  Healthy           72.8%  92.1%   8     High / Primary        │
│  Meningioma        16.3%  88.2%   1     Moderate              │
│  Pituitary          6.7%  12.1%   0     Low / Unlikely        │
│  Glioma             4.2%   7.5%   0     Low / Unlikely        │
│                                                                │
│  Not measured: segmentation mask · volume · location          │
│  AI Analysis Summary + Disclaimer                             │
└────────────────────────────────────────────────────────────────┘
```

### PDF Report
Generated on demand via **Generate PDF** button. Includes:
- Hospital header + patient details
- Synthetic T1CE preview + attention map
- AI Tumor Analysis section with 3-panel images, finding card, per-type table
- Physician signature line

---

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `SUPABASE_URL` | backend `.env` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | backend `.env` | Service role key (never expose to frontend) |
| `CHECKPOINT_PATH` | backend `.env` | Path to Model 1 `.h5` checkpoint |
| `TUMOR_PKG_DIR` | backend `.env` | Override path to `tumor_predictor_package/` |
| `TUMOR_MODEL_PATH` | backend `.env` | Override path to `best_model.pth` |
| `TUMOR_SLICE_COUNT` | backend `.env` | Number of axial slices to analyse (default: 9) |
| `TUMOR_ANALYSIS_ENABLED` | backend `.env` | Set to `0` to disable Model 2 entirely |
| `CORS_ORIGINS` | backend `.env` | Comma-separated allowed origins |
| `VITE_SUPABASE_URL` | frontend `.env.local` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | frontend `.env.local` | Supabase anon key |
| `VITE_BACKEND_URL` | frontend `.env.local` | FastAPI server URL |

---

## Supabase Storage Buckets

| Bucket | Contents |
|---|---|
| `raw-scans` | Original uploaded T1 NIfTI files |
| `result-scans` | Synthetic T1CE NIfTI files |
| `previews` | Central slice preview PNGs |
| `heatmaps` | Absolute difference maps + Model 2 per-slice PNGs (`tumor/z*_*.png`) |
| `reports` | Generated PDF reports |

All buckets are private. The frontend signs URLs on demand (30-minute expiry, scoped to the hospital's session).

---

## Disclaimer

NoDye is an experimental research prototype. It is **not a certified medical device** and must not be used for clinical diagnosis. All AI-generated results must be reviewed by a qualified radiologist. Grad-CAM overlays indicate model attention regions, not tumour boundaries or segmentation masks.

---

<div align="center">
<sub>NoDye · 2026</sub>
</div>
