-- 002: Model 2 (tumour classifier) results.
-- One JSONB blob per scan written by backend/tumor_service.py via
-- inference_service.run_inference_job.  Kept nullable so scans processed
-- before this migration (or with TUMOR_ANALYSIS_ENABLED=0) remain valid.
-- Per-slice PNGs (MRI / Grad-CAM / overlay) are stored in the existing
-- `heatmaps` bucket under <hospital>/<patient>/<scan>/tumor/, so no new
-- bucket or storage policy is needed.
alter table scans add column if not exists tumor_analysis jsonb;

comment on column scans.tumor_analysis is
  'AI tumour classification (EfficientNet-B0) of the synthetic T1CE: status, primary_finding, categories[], slices[] with image paths. See backend/tumor_service.py.';
