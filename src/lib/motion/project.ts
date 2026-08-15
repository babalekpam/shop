/**
 * Momentum projection — animate to where the gesture is *going*.
 *
 * A flick should throw an element. Snapping to the nearest boundary measured from the
 * release *point* discards the velocity the user just expressed, and reads as the
 * interface ignoring them. Instead: project where the motion would come to rest, pick
 * the snap target nearest that projection, then hand the raw release velocity to the
 * spring so there is no seam between dragging and animating.
 *
 * See docs/design-system.md §2.3 and .claude/skills/apple-design/SKILL.md §6.
 */

/** Normal scroll feel. 0.99 is noticeably snappier. */
export const DEFAULT_DECELERATION_RATE = 0.998;

/**
 * Apple's projection function, from the *Designing Fluid Interfaces* sample code.
 *
 * Note this is the exponential-decay form, not the physics-textbook `v²/(2a)`. The
 * textbook form is not what Apple ships and does not feel the same.
 *
 * @param initialVelocity px/s at release
 * @returns the distance the element would travel before coming to rest
 */
export function project(
  initialVelocity: number,
  decelerationRate: number = DEFAULT_DECELERATION_RATE,
): number {
  // A rate of exactly 1 never decelerates; the formula divides by zero. Guard rather
  // than return Infinity into a transform.
  if (decelerationRate >= 1 || decelerationRate < 0) return 0;
  return ((initialVelocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Where the gesture would come to rest, given where it was released. */
export function projectEndpoint(
  currentPosition: number,
  releaseVelocity: number,
  decelerationRate: number = DEFAULT_DECELERATION_RATE,
): number {
  return currentPosition + project(releaseVelocity, decelerationRate);
}

/**
 * The snap point nearest a given position. Ties resolve to the first candidate, which
 * keeps the result stable rather than order-dependent on floating-point noise.
 */
export function nearestSnapPoint(position: number, snapPoints: readonly number[]): number {
  if (snapPoints.length === 0) {
    throw new Error('nearestSnapPoint requires at least one snap point');
  }
  let best = snapPoints[0]!;
  let bestDistance = Math.abs(position - best);
  for (let i = 1; i < snapPoints.length; i++) {
    const candidate = snapPoints[i]!;
    const distance = Math.abs(position - candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The whole release decision in one call: project, then snap.
 *
 * Pair the returned target with the *raw* release velocity when starting the spring —
 * projection chooses the destination, velocity handoff removes the seam. Using one
 * without the other gets you half the feel.
 */
export function resolveSnapTarget(
  currentPosition: number,
  releaseVelocity: number,
  snapPoints: readonly number[],
  decelerationRate: number = DEFAULT_DECELERATION_RATE,
): number {
  return nearestSnapPoint(
    projectEndpoint(currentPosition, releaseVelocity, decelerationRate),
    snapPoints,
  );
}

/**
 * Whether a drag should commit (dismiss) or return, decided by velocity *sign* first.
 *
 * A drawer dragged 80% of the way closed but flicked back open should open: the flick is
 * the user's most recent and clearest statement of intent, and overriding it with a
 * position threshold is an agency failure. Position only decides when the release was
 * slow enough to carry no intent at all.
 *
 * @param displacement how far from the resting position, in px
 * @param velocity px/s at release, positive in the dismiss direction
 * @param dismissThreshold displacement past which a *slow* release still dismisses
 * @param velocityThreshold speed above which velocity alone decides
 */
export function shouldCommit(
  displacement: number,
  velocity: number,
  dismissThreshold: number,
  velocityThreshold = 300,
): boolean {
  if (Math.abs(velocity) >= velocityThreshold) return velocity > 0;
  return displacement >= dismissThreshold;
}
