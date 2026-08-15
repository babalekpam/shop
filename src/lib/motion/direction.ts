/**
 * Writing-direction awareness for gestures.
 *
 * Apple's spatial-consistency rule — a panel that enters from the right dismisses to the
 * right — is expressed in physical directions. Arabic is a launch locale, so in RTL that
 * same panel enters and dismisses from the *left*, and a physical rule is simply wrong
 * there.
 *
 * The fix is to express gestures in logical axes and convert to physical exactly once,
 * here. If a component computes its own direction sign, that is the bug.
 *
 * See docs/design-system.md §1.1 and .claude/skills/apple-design/SKILL.md §7.
 */

export type Direction = 'ltr' | 'rtl';

/** Which edge a surface is anchored to, in logical terms. Never `left`/`right`. */
export type LogicalEdge = 'inline-start' | 'inline-end' | 'block-start' | 'block-end';

/**
 * Multiplier converting a physical x delta into a logical inline delta, and back.
 *
 * In RTL a pointer moving physically left is moving toward the inline *end*, so a
 * positive logical delta corresponds to a negative physical one.
 */
export function inlineSign(direction: Direction): 1 | -1 {
  return direction === 'rtl' ? -1 : 1;
}

/** Physical pointer delta → logical inline delta. */
export function toLogicalInline(physicalDeltaX: number, direction: Direction): number {
  return physicalDeltaX * inlineSign(direction);
}

/** Logical inline offset → physical x, for handing to a transform. */
export function toPhysicalX(logicalInline: number, direction: Direction): number {
  return logicalInline * inlineSign(direction);
}

/**
 * Read the effective direction from an element, falling back to the document.
 *
 * Reads computed style rather than the `dir` attribute, so a component nested under a
 * `dir` set anywhere up the tree resolves correctly instead of only when the attribute
 * is on itself.
 */
export function resolveDirection(element?: Element | null): Direction {
  if (typeof window === 'undefined') return 'ltr';
  const target = element ?? document.documentElement;
  return window.getComputedStyle(target).direction === 'rtl' ? 'rtl' : 'ltr';
}

/** Which axis a logical edge lives on — the axis a surface anchored there drags along. */
export function edgeAxis(edge: LogicalEdge): 'inline' | 'block' {
  return edge === 'inline-start' || edge === 'inline-end' ? 'inline' : 'block';
}

/**
 * The sign of the dismiss direction for a surface anchored to `edge`, in the physical
 * coordinates a transform expects.
 *
 * A sheet anchored to `block-end` (a bottom sheet) dismisses downward: +1 on y.
 * A drawer anchored to `inline-end` dismisses toward the inline end: +1 on x in LTR,
 * −1 in RTL.
 */
export function dismissSign(edge: LogicalEdge, direction: Direction): 1 | -1 {
  switch (edge) {
    case 'block-end':
      return 1;
    case 'block-start':
      return -1;
    case 'inline-end':
      return inlineSign(direction);
    case 'inline-start':
      return (inlineSign(direction) * -1) as 1 | -1;
  }
}
