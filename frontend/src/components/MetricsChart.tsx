import { BAND_BG, BAND_COLOR, bandFor, METRIC_SPECS, type Band } from './metrics'

interface MetricsChartProps {
  psnr: number | null
  ssim: number | null
  mae: number | null
}

const W = 640
const ROW_H = 54
const LABEL_W = 72
const VALUE_W = 96
const PAD_Y = 14
const BAR_H = 14

/**
 * Three horizontal threshold gauges rendered as plain SVG. Each track is
 * split into the red / yellow / green bands for that metric, and the marker
 * shows where this scan's value falls.
 */
export function MetricsChart({ psnr, ssim, mae }: MetricsChartProps) {
  const values = { psnr, ssim, mae }
  const trackX = LABEL_W
  const trackW = W - LABEL_W - VALUE_W
  const height = METRIC_SPECS.length * ROW_H + PAD_Y

  return (
    <svg
      className="metrics-chart"
      viewBox={`0 0 ${W} ${height}`}
      role="img"
      aria-label="Metric values against clinical thresholds"
    >
      {METRIC_SPECS.map((spec, i) => {
        const y = PAD_Y + i * ROW_H
        const barY = y + 18
        const scale = (v: number) =>
          trackX + ((Math.min(spec.max, Math.max(spec.min, v)) - spec.min) / (spec.max - spec.min)) * trackW

        const [t1, t2] = spec.thresholds
        const bandsInOrder: Band[] = spec.higherIsBetter
          ? ['red', 'yellow', 'green']
          : ['green', 'yellow', 'red']
        const stops = [spec.min, t1, t2, spec.max]

        const v = values[spec.key]
        const band = v === null ? null : bandFor(spec, v)

        return (
          <g key={spec.key}>
            <text
              x={0}
              y={barY + BAR_H / 2 + 4}
              fontFamily="var(--font-sans)"
              fontSize={13}
              fontWeight={600}
              fill="#4A4A4A"
            >
              {spec.label}
            </text>

            {bandsInOrder.map((b, j) => {
              const x0 = scale(stops[j])
              const x1 = scale(stops[j + 1])
              return (
                <rect
                  key={b}
                  x={x0}
                  y={barY}
                  width={Math.max(0, x1 - x0)}
                  height={BAR_H}
                  fill={BAND_BG[b]}
                  stroke={BAND_COLOR[b]}
                  strokeWidth={1}
                />
              )
            })}

            {[t1, t2].map((t) => (
              <g key={t}>
                <line
                  x1={scale(t)}
                  x2={scale(t)}
                  y1={barY - 4}
                  y2={barY + BAR_H + 4}
                  stroke="#6B7B8D"
                  strokeWidth={1}
                />
                <text
                  x={scale(t)}
                  y={barY - 7}
                  textAnchor="middle"
                  fontFamily="var(--font-mono)"
                  fontSize={10}
                  fill="#6B7B8D"
                >
                  {t}
                  {spec.unit ? ` ${spec.unit}` : ''}
                </text>
              </g>
            ))}

            {v !== null && band && (
              <g>
                <line
                  x1={scale(v)}
                  x2={scale(v)}
                  y1={barY - 6}
                  y2={barY + BAR_H + 6}
                  stroke={BAND_COLOR[band]}
                  strokeWidth={3}
                />
                <polygon
                  points={`${scale(v) - 5},${barY + BAR_H + 6} ${scale(v) + 5},${barY + BAR_H + 6} ${scale(v)},${barY + BAR_H + 12}`}
                  fill={BAND_COLOR[band]}
                />
              </g>
            )}

            <text
              x={W}
              y={barY + BAR_H / 2 + 4}
              textAnchor="end"
              fontFamily="var(--font-mono)"
              fontSize={14}
              fontWeight={500}
              fill={band ? BAND_COLOR[band] : '#92A0AE'}
            >
              {v === null ? 'n/a' : spec.format(v)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
