/**
 * The three accessibility signals, read once and applied consistently.
 *
 * Reduced motion does not mean reduced *feedback*. It means a gentler, non-vestibular
 * equivalent: a press state, a status change and an error are all still fully expressed,
 * as opacity and colour rather than movement.
 *
 * See docs/design-system.md §5 and .claude/skills/apple-design/SKILL.md §14.
 */

import { springs, toMotionSpring, type AppleSpring, type MotionSpring } from './spring';

export interface MotionPreferences {
  reducedMotion: boolean;
  reducedTransparency: boolean;
  increasedContrast: boolean;
}

const query = (q: string): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(q).matches;
};

export function readPreferences(): MotionPreferences {
  return {
    reducedMotion: query('(prefers-reduced-motion: reduce)'),
    reducedTransparency: query('(prefers-reduced-transparency: reduce)'),
    increasedContrast: query('(prefers-contrast: more)'),
  };
}

/**
 * Subscribe to preference changes. Returns an unsubscribe function.
 *
 * These change mid-session more often than people expect — a system-wide accessibility
 * toggle, or a phone entering low-power mode — and a component that reads the value once
 * at mount keeps animating after the user asked it to stop.
 */
export function watchPreferences(onChange: (prefs: MotionPreferences) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};

  const queries = [
    window.matchMedia('(prefers-reduced-motion: reduce)'),
    window.matchMedia('(prefers-reduced-transparency: reduce)'),
    window.matchMedia('(prefers-contrast: more)'),
  ];
  const handler = () => onChange(readPreferences());
  queries.forEach((q) => q.addEventListener('change', handler));
  return () => queries.forEach((q) => q.removeEventListener('change', handler));
}

/** A short cross-fade, in seconds — the reduced-motion substitute for any spring. */
export const CROSSFADE_DURATION = 0.2;

/**
 * Resolve a spring against the user's motion preference.
 *
 * Under reduced motion this returns a critically damped spring at the cross-fade
 * duration: no overshoot, no velocity carried in. Callers pair it with
 * `shouldAnimatePosition` to decide whether the element moves at all, or only fades.
 */
export function resolveSpring(
  spring: AppleSpring,
  velocity?: number,
  prefs: MotionPreferences = readPreferences(),
): MotionSpring {
  if (prefs.reducedMotion) {
    // Overshoot dropped, velocity deliberately not handed through — inheriting a flick's
    // momentum is exactly the vestibular motion the preference is asking us to remove.
    return toMotionSpring({ damping: 1.0, response: CROSSFADE_DURATION });
  }
  return toMotionSpring(spring, velocity);
}

/**
 * Whether position should be animated, or the change should be instant with only opacity
 * carrying the transition.
 */
export function shouldAnimatePosition(
  prefs: MotionPreferences = readPreferences(),
): boolean {
  return !prefs.reducedMotion;
}

/**
 * The blur radius a material should use, honouring reduced transparency and contrast.
 *
 * Returned as a discrete value, always — the radius is stepped on commit, never
 * interpolated, because animating it re-runs the backdrop readback every frame and drops
 * mid-range Android below 60fps. (Design system §1.3.)
 */
export function resolveBlur(
  radiusPx: number,
  prefs: MotionPreferences = readPreferences(),
): number {
  if (prefs.reducedTransparency || prefs.increasedContrast) return 0;
  return Math.min(radiusPx, 24); // hard cap, per the material budget
}

export { springs };
