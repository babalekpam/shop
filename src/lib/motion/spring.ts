/**
 * Apple's two spring parameters, mapped to Motion's API — once, here.
 *
 * Apple deliberately replaced the physics triplet (mass/stiffness/damping) with two
 * designer-facing numbers, and we think in those:
 *
 *   damping ratio — overshoot. 1.0 is critically damped (no bounce); below 1.0 overshoots.
 *   response      — how quickly the value reaches the target, in seconds. NOT a duration:
 *                   a spring has no fixed duration, its settle time emerges from the parameters.
 *
 * Motion/Framer Motion expose `bounce` + `duration`, which map closely: bounce is the
 * complement of the damping ratio, and duration corresponds to response.
 *
 * See docs/design-system.md §2.1 and .claude/skills/apple-design/SKILL.md §4.
 */

export interface AppleSpring {
  /** 1.0 = critically damped, no overshoot. Below 1.0 overshoots and oscillates. */
  damping: number;
  /** Seconds to reach the target. Lower is snappier. */
  response: number;
}

export interface MotionSpring {
  type: 'spring';
  bounce: number;
  duration: number;
  velocity?: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Convert Apple's damping/response into Motion's bounce/duration.
 *
 * Over-damped springs (damping > 1) are clamped to bounce 0 rather than a negative
 * bounce: Motion treats negative bounce as undefined, and "no overshoot" is the whole
 * intent of an over-damped value anyway.
 */
export function toMotionSpring(spring: AppleSpring, velocity?: number): MotionSpring {
  const bounce = clamp(1 - spring.damping, 0, 1);
  const motionSpring: MotionSpring = {
    type: 'spring',
    bounce,
    duration: Math.max(0, spring.response),
  };
  if (velocity !== undefined && Number.isFinite(velocity)) {
    motionSpring.velocity = velocity;
  }
  return motionSpring;
}

/**
 * The house spring set. Anything a pointer can touch uses one of these.
 *
 * Bounce is earned, not decorative: overshoot belongs only where the gesture itself
 * carried momentum. The same surface legitimately uses two different springs depending
 * on how it was dismissed — `sheet` when flicked, `ui` when closed by a button.
 */
export const springs = {
  /** Default. Anything that appears without a gesture behind it. */
  ui: { damping: 1.0, response: 0.35 },
  /** Moving an element to a new position. Apple's PiP value. */
  reposition: { damping: 1.0, response: 0.4 },
  /** Small controls — toggles, chips, segmented controls. */
  snappy: { damping: 1.0, response: 0.25 },
  /** Drawers and sheets released from a drag. */
  sheet: { damping: 0.8, response: 0.3 },
  /** Anything the user flicked or threw. */
  momentum: { damping: 0.8, response: 0.4 },
  /** Rotation. Apple's value. */
  rotation: { damping: 0.8, response: 0.4 },
} as const satisfies Record<string, AppleSpring>;

export type SpringName = keyof typeof springs;

/**
 * Normalise a gesture velocity against the remaining distance, for spring APIs that
 * want a *relative* initial velocity:
 *
 *   relativeVelocity = gestureVelocity / (target − current)
 *
 * Motion takes absolute px/s directly via its `velocity` option, so you usually hand it
 * the raw value and never call this. It exists for the APIs that do not.
 *
 * Returns 0 when the element is already at the target — the alternative is a division by
 * zero that propagates Infinity into a transform and blanks the element.
 */
export function relativeVelocity(
  gestureVelocity: number,
  current: number,
  target: number,
): number {
  const distance = target - current;
  if (distance === 0) return 0;
  return gestureVelocity / distance;
}
