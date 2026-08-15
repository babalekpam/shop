/**
 * The ARGILETTE mark — the segmented "A".
 *
 * Rebuilt as exact geometry rather than traced from the raster, so it stays crisp at a
 * 16px favicon and on a print-scale banner alike, and so the gradient can follow the
 * theme instead of being baked in.
 *
 * The construction is one triangle cut into four bands by three gaps, with a triangular
 * counter opening the bottom band into the two legs. All coordinates are on a 100×100
 * grid; the edges are derived from the same two lines, so the band ends stay perfectly
 * flush with the silhouette at any size.
 *
 * The gradient runs light-to-dark downward on dark surfaces and dark-to-light on light
 * ones, matching the supplied artwork. That is driven by tokens, not by a prop, so a
 * surface never has to know which way round it is.
 */

export interface MarkProps {
  /** Rendered size in px. Defaults to inheriting the font size via `1em`. */
  size?: number | string | undefined;
  /** Accessible name. Omit for decorative use alongside a visible wordmark. */
  title?: string | undefined;
  className?: string | undefined;
  /** Unique suffix for the gradient id, when several marks share a document. */
  idSuffix?: string | undefined;
}

export function Mark({ size = '1em', title, className, idSuffix = 'default' }: MarkProps) {
  const gradientId = `argilette-mark-${idSuffix}`;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={['brand-mark', className].filter(Boolean).join(' ')}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand-mark-from, #5c9bd6)" />
          <stop offset="100%" stopColor="var(--brand-mark-to, #3b6d9c)" />
        </linearGradient>
      </defs>
      <g fill={`url(#${gradientId})`}>
        {/* Apex */}
        <polygon points="50,2 63.42,30 36.58,30" />
        {/* Upper band */}
        <polygon points="34.67,34 65.33,34 76.83,58 23.17,58" />
        {/* Crossbar — solid full width, which is what reads as the A's bar */}
        <polygon points="21.25,62 78.75,62 85.46,76 14.54,76" />
        {/* Legs, split by the counter */}
        <polygon points="12.63,80 44,80 34,98 4,98" />
        <polygon points="56,80 87.37,80 96,98 66,98" />
      </g>
    </svg>
  );
}
