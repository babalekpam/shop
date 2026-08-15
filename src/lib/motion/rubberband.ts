/**
 * Rubber-banding — soft boundaries.
 *
 * At an edge, resist progressively instead of stopping hard. A hard stop reads as
 * "frozen"; continuous resistance reads as "responsive, but there's nothing more here."
 * Real things slow before they stop.
 *
 * A hard stop is only correct where there is a real wall — a disabled control, a
 * validation block. Everywhere content merely runs out, it resists.
 *
 * See docs/design-system.md §2.4 and .claude/skills/apple-design/SKILL.md §9.
 */

/** Apple's constant. Lower resists harder. */
export const DEFAULT_RUBBERBAND_CONSTANT = 0.55;

/**
 * How far the element actually moves, given how far past the boundary the pointer went.
 *
 * @param overshoot how far past the bound the pointer is, in px (sign preserved)
 * @param dimension the size of the dimension being dragged — the resistance scales with it
 */
export function rubberband(
  overshoot: number,
  dimension: number,
  constant: number = DEFAULT_RUBBERBAND_CONSTANT,
): number {
  if (dimension <= 0) return 0;
  return (
    (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
  );
}

/**
 * Clamp a dragged value to bounds, resisting past them rather than stopping dead.
 *
 * Inside the bounds this is 1:1 with the pointer — direct manipulation is not negotiable
 * within range. Resistance applies only to the overshoot.
 */
export function clampWithRubberband(
  value: number,
  min: number,
  max: number,
  dimension: number,
  constant: number = DEFAULT_RUBBERBAND_CONSTANT,
): number {
  if (value < min) {
    return min + rubberband(value - min, dimension, constant);
  }
  if (value > max) {
    return max + rubberband(value - max, dimension, constant);
  }
  return value;
}
