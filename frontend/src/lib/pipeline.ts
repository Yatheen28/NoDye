/**
 * Inference pipeline stages as seen by the UI. Boundaries mirror the
 * `progress(pct, …)` ticks emitted by backend/inference_service.py so the
 * checklist can be driven purely from the raw percentage.
 */
export const PIPELINE_STAGES = [
  { key: 'queued', label: 'Queued', at: 0 },
  { key: 'preprocess', label: 'Preprocessing', at: 5 },
  { key: 'synth', label: 'Synthesising contrast', at: 15 },
  { key: 'attention', label: 'Attention heatmap', at: 86 },
  { key: 'tumour', label: 'AI tumour analysis', at: 88 },
  { key: 'metrics', label: 'Computing metrics', at: 95 },
  { key: 'upload', label: 'Uploading to storage', at: 98 },
  { key: 'done', label: 'Complete', at: 100 },
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]
