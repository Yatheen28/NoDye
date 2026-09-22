interface ValidatedBadgeProps {
  /** Use the light variant on off-white backgrounds (login page). */
  variant?: 'dark' | 'light'
}

/**
 * Static "Model Validated Performance" badge. These are the published
 * benchmark thresholds for the generator and are intentionally hardcoded:
 * they are never fetched, stored per scan, or recomputed. Per-scan metrics
 * live on the results page and are a separate thing.
 */
export function ValidatedBadge({ variant = 'dark' }: ValidatedBadgeProps) {
  return (
    <div
      className={`validated-badge${variant === 'light' ? ' validated-badge--light' : ''}`}
      title="Published validation benchmarks for the NoDye generator"
    >
      <span className="validated-badge__label">
        <span className="validated-badge__dot" aria-hidden="true" />
        Validated
      </span>
      <span className="validated-badge__metrics">
        <span>PSNR &gt; 32 dB</span>
        <span className="validated-badge__sep" aria-hidden="true" />
        <span>SSIM &gt; 0.90</span>
        <span className="validated-badge__sep" aria-hidden="true" />
        <span>MAE &lt; 0.05</span>
      </span>
    </div>
  )
}
