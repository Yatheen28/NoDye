import { bandFor, METRIC_SPECS } from './metrics'
import type { MetricsSource } from '../lib/supabase'

interface MetricsPanelProps {
  psnr: number | null
  ssim: number | null
  mae: number | null
  source: MetricsSource | null
}

export function MetricsPanel({ psnr, ssim, mae, source }: MetricsPanelProps) {
  const values = { psnr, ssim, mae }

  return (
    <div>
      {METRIC_SPECS.map((spec) => {
        const v = values[spec.key]
        const band = v === null ? null : bandFor(spec, v)
        return (
          <div className="metric-row" key={spec.key}>
            <div className="metric-row__name">
              {spec.label}
              <span className="metric-row__sub">{spec.description}</span>
            </div>
            <div>
              {band && (
                <span className={`status-pill status-pill--${band}`}>
                  {band === 'green' ? 'Within target' : band === 'yellow' ? 'Review' : 'Below target'}
                </span>
              )}
            </div>
            <div className={`metric-row__value${band ? ` metric-row__value--${band}` : ''}`}>
              {v === null ? <span className="muted">n/a</span> : spec.format(v)}
            </div>
          </div>
        )
      })}

      {source === 'benchmark' && (
        <div className="alert alert--warn" role="note" style={{ marginTop: '1rem' }}>
          No ground-truth T1CE was supplied with this scan, so these are the model's published
          validation benchmarks, not measurements of this volume.
        </div>
      )}
      {source === 'measured' && (
        <p className="small muted" style={{ marginTop: '1rem' }}>
          Measured on the central axial slice against the supplied ground-truth T1CE.
        </p>
      )}
    </div>
  )
}
