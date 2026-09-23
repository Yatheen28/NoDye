/**
 * TumorAnalysisPanel
 *
 * Renders the full "AI Tumor Analysis" section on the ResultsPage.
 *
 * Layout (mirrors the spec):
 *
 *   AI TUMOR ANALYSIS  ─────────────────────────────────────────
 *
 *   [Generated MRI]   [Grad-CAM heatmap]   [AI overlay]
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ AI Finding card: badge + primary prediction + metrics    │
 *   └──────────────────────────────────────────────────────────┘
 *
 *   Per-type breakdown table (3 tumour types + no-tumour)
 *
 *   Slice navigator (prev / next through analysed slices)
 *
 *   AI Analysis Summary + disclaimer
 *
 * INTEGRATION NOTE:
 *   - `analysis` is the `tumor_analysis` JSONB column from the `scans` table,
 *     written by tumor_service.run_tumor_analysis().
 *   - `sliceImageUrls` is a map from slice-z to {mri, heatmap, overlay} signed URLs,
 *     resolved by the parent (ResultsPage) via signedUrl().
 *   - Nothing here is fabricated: only values the classifier actually produced
 *     are displayed.  Measurements the model cannot make (volume, location, mask)
 *     are shown as "Not available".
 */

import { useEffect, useState } from 'react'
import type { TumorAnalysis, TumorCategory, TumorSlice } from '../lib/supabase'

// ─── helpers ────────────────────────────────────────────────────────────────

function riskClass(tier: string | undefined): string {
  const t = (tier ?? '').toLowerCase()
  if (t.startsWith('very high') || t.startsWith('high')) return 'risk--high'
  if (t.startsWith('moderate') || t.startsWith('medium')) return 'risk--moderate'
  if (t.startsWith('low') || t.startsWith('very low') || t.includes('healthy')) return 'risk--low'
  return 'risk--neutral'
}

function riskPill(tier: string | undefined) {
  return (
    <span className={`tumor-risk-pill ${riskClass(tier)}`}>
      {tier ?? 'Unknown'}
    </span>
  )
}

// ─── sub-components ─────────────────────────────────────────────────────────

interface SliceImageSetProps {
  mri: string | null
  heatmap: string | null
  overlay: string | null
  z: number | undefined
  loading: boolean
}

function SliceImageSet({ mri, heatmap, overlay, z, loading }: SliceImageSetProps) {
  const panels: { src: string | null; label: string; caption: string }[] = [
    { src: mri, label: 'MRI', caption: `Generated MRI${z !== undefined ? ` (slice z=${z})` : ''}` },
    { src: heatmap, label: 'HEAT MAP', caption: 'Grad-CAM activation map' },
    { src: overlay, label: 'AI OVERLAY', caption: 'Suspicious region overlay' },
  ]

  return (
    <div className="tumor-image-row">
      {panels.map(({ src, label, caption }) => (
        <div key={label} className="tumor-image-cell">
          <div className="tumor-image-frame">
            <span className="tumor-image-frame__label">{label}</span>
            {loading || !src ? (
              <div className="skeleton tumor-image-frame__skeleton" />
            ) : (
              <img src={src} alt={caption} />
            )}
          </div>
          <p className="tumor-image-caption">{caption}</p>
        </div>
      ))}
    </div>
  )
}

interface FindingCardProps {
  analysis: TumorAnalysis
}

function FindingCard({ analysis }: FindingCardProps) {
  const detected = Boolean(analysis.tumor_detected)
  const pf = analysis.primary_finding

  return (
    <div className={`tumor-finding-card ${detected ? 'tumor-finding-card--detected' : 'tumor-finding-card--clear'}`}>
      <div className="tumor-finding-card__left">
        <p className="tumor-finding-card__label">AI Finding</p>
        <p className="tumor-finding-card__primary">
          <strong>{pf?.name ?? '—'}</strong>
          {pf && (
            <span className="tumor-finding-card__prob">
              {' '}— mean probability {pf.mean_probability_pct}%
            </span>
          )}
        </p>
        <p className="tumor-finding-card__meta">
          Overall tumour chance:{' '}
          <strong>{analysis.overall_tumor_chance_pct ?? '—'}%</strong>
          {analysis.overall_risk_tier && (
            <> &nbsp;·&nbsp; {riskPill(analysis.overall_risk_tier)}</>
          )}
        </p>
        <p className="tumor-finding-card__meta">
          Affected slices:{' '}
          <strong>{analysis.tumor_positive_count ?? 0}</strong> of{' '}
          {(analysis.slices_analyzed ?? []).length} analysed
          {analysis.slices_total !== undefined && (
            <> (volume depth {analysis.slices_total})</>
          )}
        </p>
        {analysis.aggregation && (
          <p className="tumor-finding-card__sub">
            Aggregation: {analysis.aggregation}. Representative slice z=
            {analysis.representative_slice ?? '—'}.
          </p>
        )}
      </div>
      <div className="tumor-finding-card__badge">
        <span className={`tumor-badge ${detected ? 'tumor-badge--detected' : 'tumor-badge--clear'}`}>
          {detected ? 'TUMOUR DETECTED' : 'NO TUMOUR PREDICTED'}
        </span>
      </div>
    </div>
  )
}

interface CategoryTableProps {
  categories: TumorCategory[]
}

function CategoryTable({ categories }: CategoryTableProps) {
  return (
    <div className="tumor-category-table-wrap">
      <table className="tumor-category-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Mean prob.</th>
            <th>Max prob.</th>
            <th>Risk tier</th>
            <th>Insight</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.class_key} className={c.is_tumor_type ? '' : 'tumor-category-table__healthy'}>
              <td>
                <strong>{c.name}</strong>
              </td>
              <td className="mono">{c.mean_probability_pct}%</td>
              <td className="mono">{c.max_probability_pct}%</td>
              <td>{riskPill(c.risk_tier)}</td>
              <td className="tumor-category-table__insight">{c.insight}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface SliceNavigatorProps {
  slices: TumorSlice[]
  activeIdx: number
  onSelect: (idx: number) => void
}

function SliceNavigator({ slices, activeIdx, onSelect }: SliceNavigatorProps) {
  if (slices.length <= 1) return null
  const s = slices[activeIdx]

  return (
    <div className="tumor-slice-nav">
      <div className="tumor-slice-nav__controls">
        <button
          className="btn btn--ghost btn--sm"
          disabled={activeIdx === 0}
          onClick={() => onSelect(activeIdx - 1)}
          aria-label="Previous slice"
        >
          ← Prev
        </button>
        <span className="tumor-slice-nav__info">
          Slice z={s.z} &nbsp;·&nbsp; {s.predicted_name} ({s.confidence_pct}%)
          &nbsp;·&nbsp; tumour chance {s.tumor_chance_pct}%
        </span>
        <button
          className="btn btn--ghost btn--sm"
          disabled={activeIdx === slices.length - 1}
          onClick={() => onSelect(activeIdx + 1)}
          aria-label="Next slice"
        >
          Next →
        </button>
      </div>
      <div className="tumor-slice-nav__dots">
        {slices.map((sl, i) => (
          <button
            key={sl.z}
            className={`tumor-slice-dot ${i === activeIdx ? 'tumor-slice-dot--active' : ''} ${sl.predicted_class !== 'no_tumor' ? 'tumor-slice-dot--positive' : ''}`}
            onClick={() => onSelect(i)}
            aria-label={`Slice z=${sl.z}`}
            title={`z=${sl.z}: ${sl.predicted_name} (${sl.confidence_pct}%)`}
          />
        ))}
      </div>
    </div>
  )
}

// ─── not-available block ─────────────────────────────────────────────────────

function NotAvailableBlock({ items }: { items: Record<string, string> }) {
  const entries = Object.entries(items)
  if (!entries.length) return null
  return (
    <div className="tumor-na-block">
      <span className="tumor-na-block__label">Not measured by this model:</span>
      {entries.map(([k, v]) => (
        <span key={k} className="tumor-na-block__item">
          <strong>{k.replace(/_/g, ' ')}</strong> — {v}
        </span>
      ))}
    </div>
  )
}

// ─── failed / disabled states ────────────────────────────────────────────────

function TumorUnavailable({ analysis }: { analysis: TumorAnalysis | null | undefined }) {
  const status = analysis?.status ?? 'unavailable'
  const reason = analysis?.error ?? 'Tumour classifier did not run for this scan.'

  const isDisabled = status === 'disabled'
  return (
    <div className={`alert ${isDisabled ? 'alert--info' : 'alert--warn'}`} role="note">
      <div>
        <strong>AI Tumor Analysis — {isDisabled ? 'disabled' : 'unavailable'}</strong>
        <p style={{ marginTop: '0.25rem' }}>{reason}</p>
        {analysis?.error_kind && (
          <p className="small muted" style={{ marginTop: '0.25rem' }}>
            Error kind: {analysis.error_kind}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── main export ─────────────────────────────────────────────────────────────

export interface SliceUrls {
  mri: string | null
  heatmap: string | null
  overlay: string | null
}

interface TumorAnalysisPanelProps {
  analysis: TumorAnalysis | null | undefined
  /** Map from slice z-index to signed URLs for that slice's images. */
  sliceImageUrls: Map<number, SliceUrls>
  /** True while the parent is still signing URLs. */
  imagesLoading: boolean
}

export function TumorAnalysisPanel({ analysis, sliceImageUrls, imagesLoading }: TumorAnalysisPanelProps) {
  const [activeSliceIdx, setActiveSliceIdx] = useState(0)

  // Reset to representative slice whenever analysis changes.
  useEffect(() => {
    if (!analysis?.slices?.length) return
    const repZ = analysis.representative_slice
    const repIdx = repZ !== undefined
      ? analysis.slices.findIndex((s) => s.z === repZ)
      : 0
    setActiveSliceIdx(Math.max(0, repIdx))
  }, [analysis])

  // ── guard: not ok ──────────────────────────────────────────────────────────
  if (!analysis || analysis.status !== 'ok') {
    return (
      <section className="tumor-section">
        <div className="tumor-section__head">
          <h2 className="tumor-section__title">AI Tumor Analysis</h2>
          <span className="tumor-ai-tag">AI-GENERATED · EfficientNet-B0 classifier</span>
        </div>
        <TumorUnavailable analysis={analysis} />
      </section>
    )
  }

  const slices = analysis.slices ?? []
  const activeSlice = slices[activeSliceIdx] ?? null
  const activeZ = activeSlice?.z
  const activeUrls = activeZ !== undefined ? (sliceImageUrls.get(activeZ) ?? { mri: null, heatmap: null, overlay: null }) : { mri: null, heatmap: null, overlay: null }

  return (
    <section className="tumor-section">
      {/* ── header ── */}
      <div className="tumor-section__head">
        <h2 className="tumor-section__title">AI Tumor Analysis</h2>
        <span className="tumor-ai-tag">AI-GENERATED · EfficientNet-B0 classifier · Not a clinical diagnosis</span>
      </div>

      {/* ── 3-panel images ── */}
      <SliceImageSet
        mri={activeUrls.mri}
        heatmap={activeUrls.heatmap}
        overlay={activeUrls.overlay}
        z={activeZ}
        loading={imagesLoading && !activeUrls.mri}
      />

      {/* ── slice navigator ── */}
      {slices.length > 0 && (
        <SliceNavigator
          slices={slices}
          activeIdx={activeSliceIdx}
          onSelect={setActiveSliceIdx}
        />
      )}

      {/* ── finding card ── */}
      <FindingCard analysis={analysis} />

      {/* ── per-type breakdown ── */}
      {analysis.categories && analysis.categories.length > 0 && (
        <div style={{ marginTop: '1.25rem' }}>
          <p className="tumor-subsection-label">Tumour type breakdown</p>
          <CategoryTable categories={analysis.categories} />
        </div>
      )}

      {/* ── AI summary ── */}
      {analysis.summary_text && (
        <div className="tumor-summary-block">
          <p className="tumor-subsection-label">AI Analysis Summary</p>
          <p className="tumor-summary-block__text">{analysis.summary_text}</p>
        </div>
      )}
    </section>
  )
}
