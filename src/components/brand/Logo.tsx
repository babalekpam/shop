/**
 * The ARGILETTE lockup — mark plus wordmark plus tagline.
 *
 * The wordmark is live text, not an outlined path. That is a deliberate choice:
 *
 *   · it scales with the user's text-size setting instead of staying pinned at a fixed
 *     pixel size, which is skill §15's Dynamic Type point applied to the one element on
 *     every page;
 *   · it is readable by a screen reader and selectable, so "ARGILETTE" is a word rather
 *     than an image of a word;
 *   · outlining it would need the original typeface, which we do not have, and tracing
 *     glyphs from the raster would give us subtly wrong curves at large sizes.
 *
 * The letterspacing, weight and rule are matched to the supplied artwork. If the brand
 * later standardises on a specific licensed face, self-host it (never a font CDN — CSP
 * and supply chain, security spec §5 and §11) and set `--font-brand`.
 */

import { Mark } from './Mark';

export type LogoVariant = 'horizontal' | 'stacked' | 'mark';

export interface LogoProps {
  variant?: LogoVariant | undefined;
  /** Show the "YOUR TECHNOLOGY PARTNER" tagline and its rule. */
  tagline?: string | undefined;
  /** Overall scale, applied to the mark and the type together. */
  size?: 'sm' | 'md' | 'lg' | undefined;
  className?: string | undefined;
  idSuffix?: string | undefined;
}

export function Logo({
  variant = 'horizontal',
  tagline,
  size = 'md',
  className,
  idSuffix = 'lockup',
}: LogoProps) {
  if (variant === 'mark') {
    return <Mark size="1em" title="ARGILETTE" className={className} idSuffix={idSuffix} />;
  }

  return (
    <span
      className={['brand-logo', `brand-logo-${variant}`, `brand-logo-${size}`, className]
        .filter(Boolean)
        .join(' ')}
    >
      <Mark className="brand-logo-mark" idSuffix={idSuffix} />
      <span className="brand-logo-type">
        <span className="brand-wordmark">ARGILETTE</span>
        {tagline && (
          <>
            <span className="brand-rule" aria-hidden="true" />
            <span className="brand-tagline">{tagline}</span>
          </>
        )}
      </span>
    </span>
  );
}
