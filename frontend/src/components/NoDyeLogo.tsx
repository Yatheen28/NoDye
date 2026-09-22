interface NoDyeLogoProps {
  /** Height of the mark in px. Text scales with it. */
  size?: number
  /** Colour of the mark and wordmark. Defaults to deep teal. */
  color?: string
  /** Hide the wordmark and render the mark only. */
  markOnly?: boolean
  className?: string
}

/**
 * Procedural NoDye mark: two mirrored hemispheres separated by a central
 * fissure, each with two sulcus strokes. Built entirely from SVG paths so it
 * can be inlined anywhere (header, login, PDF rasterisation) with no assets.
 */
export function NoDyeLogo({
  size = 28,
  color = '#0D4F4F',
  markOnly = false,
  className,
}: NoDyeLogoProps) {
  const textSize = size * 0.78

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.4,
        color,
        lineHeight: 1,
      }}
      aria-label="NoDye"
      role="img"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* Left hemisphere */}
        <path d="M15 5.5C10 5.5 5.5 9 5.5 14.5c0 3.5 2 6 4.5 7.5V26h5V5.5z" />
        {/* Right hemisphere */}
        <path d="M17 5.5c5 0 9.5 3.5 9.5 9 0 3.5-2 6-4.5 7.5V26h-5V5.5z" />
        {/* Sulci */}
        <path d="M8.5 12.5c1.5-.5 3 .5 3.5 2" />
        <path d="M20 12.5c1.5-.5 3 .5 3.5 2" />
        <path d="M9 18c1.5 0 2.5 1 3 2.5" />
        <path d="M20 18c1.5 0 2.5 1 3 2.5" />
      </svg>
      {!markOnly && (
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 600,
            fontSize: textSize,
            letterSpacing: '-0.02em',
          }}
        >
          No<span style={{ fontWeight: 400 }}>Dye</span>
        </span>
      )}
    </span>
  )
}
