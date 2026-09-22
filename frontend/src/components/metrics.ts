/**
 * Metric thresholds shared by the metrics panel and chart.
 *
 *   PSNR: green >= 32 dB, yellow 25..32 dB, red < 25 dB
 *   SSIM: green >= 0.90, yellow 0.75..0.90, red < 0.75
 *   MAE:  green <= 0.05, yellow 0.05..0.10, red > 0.10
 */

export type Band = 'green' | 'yellow' | 'red'

export type MetricKey = 'psnr' | 'ssim' | 'mae'

export interface MetricSpec {
  key: MetricKey
  label: string
  description: string
  unit: string
  /** Lower bound of the chart axis. */
  min: number
  /** Upper bound of the chart axis. */
  max: number
  /** Two threshold points defining the three bands, in axis order. */
  thresholds: [number, number]
  /** True when a higher value is better. */
  higherIsBetter: boolean
  format: (v: number) => string
}

export const METRIC_SPECS: MetricSpec[] = [
  {
    key: 'psnr',
    label: 'PSNR',
    description: 'Peak signal-to-noise ratio',
    unit: 'dB',
    min: 15,
    max: 40,
    thresholds: [25, 32],
    higherIsBetter: true,
    format: (v) => `${v.toFixed(2)} dB`,
  },
  {
    key: 'ssim',
    label: 'SSIM',
    description: 'Structural similarity index',
    unit: '',
    min: 0.5,
    max: 1,
    thresholds: [0.75, 0.9],
    higherIsBetter: true,
    format: (v) => v.toFixed(4),
  },
  {
    key: 'mae',
    label: 'MAE',
    description: 'Mean absolute error',
    unit: '',
    min: 0,
    max: 0.2,
    thresholds: [0.05, 0.1],
    higherIsBetter: false,
    format: (v) => v.toFixed(4),
  },
]

export function bandFor(spec: MetricSpec, value: number): Band {
  const [lo, hi] = spec.thresholds
  if (spec.higherIsBetter) {
    if (value >= hi) return 'green'
    if (value >= lo) return 'yellow'
    return 'red'
  }
  if (value <= lo) return 'green'
  if (value <= hi) return 'yellow'
  return 'red'
}

export const BAND_COLOR: Record<Band, string> = {
  green: '#5B8C5A',
  yellow: '#D4A843',
  red: '#E8634A',
}

export const BAND_BG: Record<Band, string> = {
  green: '#E3ECE2',
  yellow: '#F8F0D8',
  red: '#FBE7E1',
}
