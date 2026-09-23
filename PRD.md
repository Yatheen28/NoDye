<div align="center">

# Product Requirements Document — NoDye

### Contrast-Free Brain MRI Synthesis with AI Tumour Analysis

*HackSpectra HS020 — CodeMark*

</div>

---

## 1. Problem Statement

### 1.1 The Clinical Problem

Gadolinium-based contrast agents (GBCAs) are routinely injected during brain MRI procedures to produce contrast-enhanced T1-weighted (T1CE) images. These enhanced images are critical for detecting and characterising brain tumours, as they reveal blood-brain barrier disruptions caused by tumour growth.

However, GBCAs carry significant risks and limitations:

| Issue | Impact |
|---|---|
| **Nephrogenic Systemic Fibrosis (NSF)** | Life-threatening condition in patients with impaired kidney function |
| **Gadolinium Deposition** | Long-term retention of gadolinium in the brain, bones, and skin — effects still under investigation |
| **Allergic Reactions** | Anaphylaxis risk requiring emergency preparedness |
| **Cost** | Contrast agents add $200–$600 per scan; repeated scans multiply this cost |
| **Patient Discomfort** | Intravenous injection, extended scan time, and anxiety |
| **Contraindications** | Pregnant patients, paediatric cases, and patients with severe renal impairment may not receive contrast |

### 1.2 The Opportunity

Recent advances in deep learning have demonstrated that synthetic contrast-enhanced images can be generated from standard (non-contrast) T1 MRI scans with high structural fidelity. By combining this capability with an automatic tumour screening classifier, we can provide radiologists with a **zero-injection, AI-powered diagnostic aid** that:

1. Eliminates GBCA exposure entirely
2. Provides immediate tumour screening without waiting for contrast administration
3. Generates professional clinical reports automatically
4. Operates as a multi-hospital SaaS platform with full data isolation

---

## 2. Product Vision

> **NoDye** enables hospitals to screen brain MRI scans for tumours without injecting contrast agents — making brain tumour detection safer, faster, and more accessible.

---

## 3. Target Users

| User | Role | Key Needs |
|---|---|---|
| **Radiologist** | Primary clinical user | View synthetic T1CE, review AI tumour analysis, generate reports |
| **Radiology Technician** | Uploads MRI scans | Simple upload interface with real-time progress feedback |
| **Hospital Administrator** | Manages the platform | Multi-hospital data isolation, patient data privacy |
| **Patient** | Indirect beneficiary | Avoidance of contrast agent injection and associated risks |

---

## 4. Product Scope

### 4.1 In Scope (Current Version)

| Feature | Description |
|---|---|
| **Contrast Synthesis** | Generate synthetic T1CE from standard T1 MRI using Attention U-Net |
| **Tumour Classification** | Automatic 4-class brain tumour screening using EfficientNet-B0 |
| **Grad-CAM Visualisation** | Saliency maps highlighting regions influencing the AI prediction |
| **Interactive Slice Navigator** | Step through analysed slices; tumour-positive slices highlighted |
| **PDF Report Generation** | Professional clinical report with AI findings, generated on demand |
| **Multi-Hospital SaaS** | Supabase Auth + RLS for hospital-level data isolation |
| **Patient Data Encryption** | AES-256 encryption for PII (name, phone, address) |
| **Real-Time Progress** | WebSocket-based progress stream from upload to completion |
| **File Downloads** | Synthetic T1CE NIfTI, preview PNGs, attention heatmaps, PDF reports |

### 4.2 Out of Scope (Future Versions)

| Feature | Rationale |
|---|---|
| Tumour segmentation masks | Model 2 is a classifier; segmentation requires a different architecture (e.g., U-Net) |
| Tumour volume measurement | Requires a segmentation mask |
| Anatomical location reporting | Requires spatial localisation beyond Grad-CAM |
| Longitudinal tracking | Comparing scans over time requires patient history features |
| Mobile application | Current version is web-only |
| Regulatory certification | This is a research/hackathon prototype, not a certified medical device |

---

## 5. Functional Requirements

### 5.1 Authentication & Multi-Tenancy

| ID | Requirement | Priority |
|---|---|---|
| AUTH-01 | Hospital accounts authenticate via email/password through Supabase Auth | Must Have |
| AUTH-02 | Each hospital sees only its own patients and scans (RLS enforcement) | Must Have |
| AUTH-03 | Backend verifies JWT tokens on every API request | Must Have |
| AUTH-04 | Storage objects are scoped to the hospital's UID prefix | Must Have |

### 5.2 Patient Management

| ID | Requirement | Priority |
|---|---|---|
| PAT-01 | Register new patients with name, age, gender, phone, and address | Must Have |
| PAT-02 | Patient PII (name, phone, address) encrypted at rest with AES-256 | Must Have |
| PAT-03 | Auto-generate structured patient IDs (format: `XXXX-YYYYMMDD-NNN`) | Must Have |
| PAT-04 | List all patients belonging to the authenticated hospital | Must Have |
| PAT-05 | Patient form validation (required fields, age range, phone format) | Should Have |

### 5.3 MRI Upload & Processing

| ID | Requirement | Priority |
|---|---|---|
| MRI-01 | Accept `.nii` and `.nii.gz` T1 MRI uploads | Must Have |
| MRI-02 | Validate file format before processing | Must Have |
| MRI-03 | Stream real-time progress via WebSocket during processing | Must Have |
| MRI-04 | Generate synthetic T1CE volume using Model 1 | Must Have |
| MRI-05 | Generate attention heatmap (absolute difference map) | Must Have |
| MRI-06 | Store all artefacts (NIfTI, PNGs) in Supabase Storage | Must Have |
| MRI-07 | Create scan record in database with storage paths and metrics | Must Have |

### 5.4 AI Tumour Analysis

| ID | Requirement | Priority |
|---|---|---|
| TUM-01 | Classify synthetic T1CE for tumours using Model 2 (EfficientNet-B0) | Must Have |
| TUM-02 | Analyse 9 evenly spaced axial slices (centre slice always included) | Must Have |
| TUM-03 | Generate Grad-CAM saliency maps for each analysed slice | Must Have |
| TUM-04 | Produce 3-panel visualisation per slice (MRI, heatmap, overlay) | Must Have |
| TUM-05 | Aggregate per-slice probabilities into volume-level summary | Must Have |
| TUM-06 | Classify risk tier (High Chance, Medium Chance, Low Chance) | Must Have |
| TUM-07 | Store full analysis as JSONB in the `tumor_analysis` column | Must Have |
| TUM-08 | Model 2 failures must not abort Model 1 results | Must Have |
| TUM-09 | Model 2 can be disabled via `TUMOR_ANALYSIS_ENABLED=0` | Should Have |

### 5.5 Results Dashboard

| ID | Requirement | Priority |
|---|---|---|
| RES-01 | Display synthetic T1CE preview and attention heatmap | Must Have |
| RES-02 | Display AI tumour analysis with interactive slice navigator | Must Have |
| RES-03 | Display finding card with primary prediction and risk tier | Must Have |
| RES-04 | Display tumour type breakdown table with probabilities and insights | Must Have |
| RES-05 | Display user-friendly AI analysis summary | Must Have |
| RES-06 | Provide download links for NIfTI, PNGs, and PDF report | Must Have |
| RES-07 | Risk tiers use sensible colour coding (green = healthy, red = tumour) | Must Have |

### 5.6 PDF Report

| ID | Requirement | Priority |
|---|---|---|
| PDF-01 | Generate professional clinical PDF on demand | Must Have |
| PDF-02 | Include hospital header, patient details, imaging, and AI analysis | Must Have |
| PDF-03 | Include finding card, tumour type breakdown, and AI summary | Must Have |
| PDF-04 | Include physician signature line | Must Have |
| PDF-05 | Upload generated PDF to storage for future retrieval | Should Have |

---

## 6. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | Full pipeline (upload → results) completes in < 60 seconds on CPU for a 155-slice volume |
| **Security** | All PII encrypted at rest; RLS enforces data isolation; JWT auth on every request |
| **Privacy** | HIPAA-aligned encryption; no PII in logs; Supabase Vault for key management |
| **Reliability** | Model 2 failures do not affect Model 1 results; graceful degradation |
| **Scalability** | Stateless backend; models loaded once per process; storage in cloud buckets |
| **Usability** | Non-technical UI with plain-language AI summaries; colour-coded risk tiers |
| **Accessibility** | Semantic HTML; ARIA labels on interactive elements; keyboard navigation |

---

## 7. User Stories

### Radiologist

> *As a radiologist, I want to upload a patient's T1 MRI scan and receive a synthetic contrast-enhanced image along with an automatic tumour screening, so I can make an initial assessment without exposing the patient to contrast agents.*

> *As a radiologist, I want to generate a professional PDF report with the AI findings, so I can include it in the patient's medical record.*

> *As a radiologist, I want to navigate through different slices of the analysed scan and see which slices the AI flagged as potentially tumour-positive, so I can focus my review on the most relevant areas.*

### Radiology Technician

> *As a radiology technician, I want to upload an MRI scan and see real-time progress of the AI processing, so I know when the results are ready for the radiologist to review.*

> *As a radiology technician, I want to register new patients in the system with their demographics, so I can associate scans with the correct patient records.*

### Hospital Administrator

> *As a hospital administrator, I want assurance that our patient data is completely isolated from other hospitals on the platform, so we meet our data governance requirements.*

---

## 8. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| **Synthesis Quality (PSNR)** | ≥ 30 dB | Computed against ground-truth T1CE when available |
| **Synthesis Quality (SSIM)** | ≥ 0.90 | Same |
| **Classification Accuracy** | ≥ 95% | Model 2 validation accuracy = 97.21% |
| **Classification F1 Score** | ≥ 0.95 | Model 2 validation F1 = 0.9745 |
| **Pipeline Completion Time** | < 60s (CPU) | End-to-end from upload to results |
| **Zero Data Leakage** | 0 cross-hospital data access incidents | Enforced by RLS policies |

---

## 9. Technical Constraints

| Constraint | Detail |
|---|---|
| **Model Weights** | Pre-trained; not retrained during integration |
| **Input Format** | NIfTI (.nii / .nii.gz) T1 MRI volumes only |
| **2D Classifier Limitation** | Model 2 processes individual 2D slices, not the full 3D volume |
| **No Segmentation** | Tumour boundaries, volumes, and locations cannot be determined |
| **CPU Inference** | No GPU required; inference runs on CPU (CUDA used if available) |
| **Supabase Dependency** | Database, auth, and storage all require a Supabase project |

---

## 10. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Model produces low-quality synthesis | Incorrect tumour screening downstream | Low | PSNR/SSIM benchmarks validated against BraTS 2021 |
| False positive tumour detection | Unnecessary patient anxiety | Medium | Clear labelling as AI-generated; must be reviewed by radiologist |
| False negative tumour detection | Missed tumour | Medium | System is a screening aid, not a diagnostic replacement |
| Patient data breach | Legal and ethical consequences | Low | AES-256 encryption + RLS + Vault key management |
| Model checkpoint corruption | Service unavailable | Low | Checkpoints versioned; health endpoint reports model status |
| Supabase outage | Platform unavailable | Low | Local pipeline test mode available (`run_pipeline_local.py`) |

---

## 11. Release Plan

| Phase | Scope | Status |
|---|---|---|
| **Phase 1** — Core Pipeline | Model 1 contrast synthesis + storage + basic UI | ✅ Complete |
| **Phase 2** — AI Analysis | Model 2 integration + Grad-CAM + slice navigator | ✅ Complete |
| **Phase 3** — Clinical Polish | PDF reports + risk tiers + non-technical summaries | ✅ Complete |
| **Phase 4** — Security Hardening | PII encryption + RLS + auth enforcement | ✅ Complete |
| **Phase 5** — Hackathon Submission | Documentation + demo + final testing | 🔄 In Progress |

---

## 12. Glossary

| Term | Definition |
|---|---|
| **T1 MRI** | Standard T1-weighted magnetic resonance imaging scan (no contrast) |
| **T1CE** | T1-weighted contrast-enhanced MRI (after gadolinium injection) |
| **GBCA** | Gadolinium-Based Contrast Agent |
| **NIfTI** | Neuroimaging Informatics Technology Initiative — standard medical image format (.nii / .nii.gz) |
| **BraTS** | Brain Tumor Segmentation Challenge — benchmark dataset |
| **Grad-CAM** | Gradient-weighted Class Activation Mapping — saliency visualisation technique |
| **RLS** | Row Level Security — PostgreSQL feature for data isolation |
| **PII** | Personally Identifiable Information |
| **PSNR** | Peak Signal-to-Noise Ratio |
| **SSIM** | Structural Similarity Index Measure |
| **MAE** | Mean Absolute Error |

---

<div align="center">
<sub>NoDye PRD · HackSpectra HS020 · 2026</sub>
</div>
