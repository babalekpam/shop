import { describe, expect, it } from 'vitest';

import { relativeVelocity, springs, toMotionSpring } from '../src/lib/motion/spring';
import {
  DEFAULT_DECELERATION_RATE,
  nearestSnapPoint,
  project,
  projectEndpoint,
  resolveSnapTarget,
  shouldCommit,
} from '../src/lib/motion/project';
import { clampWithRubberband, rubberband } from '../src/lib/motion/rubberband';
import { VelocityTracker } from '../src/lib/motion/velocity';
import { dismissSign, inlineSign, toLogicalInline, toPhysicalX } from '../src/lib/motion/direction';

describe('spring mapping', () => {
  it('maps a critically damped spring to zero bounce', () => {
    expect(toMotionSpring({ damping: 1.0, response: 0.4 })).toEqual({
      type: 'spring',
      bounce: 0,
      duration: 0.4,
    });
  });

  it('maps damping 0.8 to the bounce 0.2 the skill specifies', () => {
    const spring = toMotionSpring({ damping: 0.8, response: 0.3 });
    expect(spring.bounce).toBeCloseTo(0.2, 10);
    expect(spring.duration).toBe(0.3);
  });

  it('clamps over-damped springs to no overshoot rather than a negative bounce', () => {
    expect(toMotionSpring({ damping: 1.6, response: 0.4 }).bounce).toBe(0);
  });

  it('carries velocity through only when one is supplied', () => {
    expect(toMotionSpring(springs.ui).velocity).toBeUndefined();
    expect(toMotionSpring(springs.sheet, 820).velocity).toBe(820);
    // A non-finite velocity would propagate NaN into a transform and blank the element.
    expect(toMotionSpring(springs.sheet, Number.NaN).velocity).toBeUndefined();
  });

  it('reserves bounce for the momentum-driven springs', () => {
    expect(toMotionSpring(springs.ui).bounce).toBe(0);
    expect(toMotionSpring(springs.reposition).bounce).toBe(0);
    expect(toMotionSpring(springs.snappy).bounce).toBe(0);
    expect(toMotionSpring(springs.sheet).bounce).toBeGreaterThan(0);
    expect(toMotionSpring(springs.momentum).bounce).toBeGreaterThan(0);
  });

  it('normalises velocity against the remaining distance', () => {
    // The skill's worked example: at y=50, target y=150, finger at 50px/s → 0.5.
    expect(relativeVelocity(50, 50, 150)).toBe(0.5);
  });

  it('returns zero rather than dividing by zero at the target', () => {
    expect(relativeVelocity(400, 100, 100)).toBe(0);
  });
});

describe('momentum projection', () => {
  it("uses Apple's exponential-decay form, not the physics-textbook one", () => {
    // (1000/1000) * 0.998 / (1 - 0.998) = 499
    expect(project(1000, DEFAULT_DECELERATION_RATE)).toBeCloseTo(499, 6);
    // The textbook v²/(2a) form would give a wildly different number; assert we are not
    // accidentally shipping it.
    expect(project(1000)).not.toBeCloseTo(1000 ** 2 / (2 * 0.998), 0);
  });

  it('projects further the faster the release', () => {
    expect(project(2000)).toBeGreaterThan(project(1000));
  });

  it('preserves direction', () => {
    expect(project(-1000)).toBeCloseTo(-499, 6);
  });

  it('never returns a non-finite distance for a degenerate deceleration rate', () => {
    expect(project(1000, 1)).toBe(0);
    expect(project(1000, -0.5)).toBe(0);
  });

  it('offsets the projection from the release position', () => {
    expect(projectEndpoint(120, 1000)).toBeCloseTo(619, 6);
  });
});

describe('snap targets', () => {
  it('picks the nearest point', () => {
    expect(nearestSnapPoint(180, [0, 400])).toBe(0);
    expect(nearestSnapPoint(260, [0, 400])).toBe(400);
  });

  it('throws rather than silently returning undefined with no candidates', () => {
    expect(() => nearestSnapPoint(10, [])).toThrow();
  });

  it('lands a hard flick where the gesture was going, not near where it stopped', () => {
    // Released only 40px into a 400px sheet, but thrown hard. Measuring from the release
    // position would snap back to 0 and read as the flick being ignored.
    expect(nearestSnapPoint(40, [0, 400])).toBe(0);
    expect(resolveSnapTarget(40, 1200, [0, 400])).toBe(400);
  });

  it('lets a slow release settle back to the nearer point', () => {
    expect(resolveSnapTarget(40, 20, [0, 400])).toBe(0);
  });
});

describe('commit decision', () => {
  it('honours a flick back open even from past the position threshold', () => {
    // Dragged 80% closed, then flicked back. Position alone would dismiss it, which
    // overrides the user's most recent and clearest statement of intent.
    expect(shouldCommit(320, -900, 200)).toBe(false);
  });

  it('dismisses on a fast flick even from barely moved', () => {
    expect(shouldCommit(30, 900, 200)).toBe(true);
  });

  it('falls back to position when the release carried no intent', () => {
    expect(shouldCommit(260, 10, 200)).toBe(true);
    expect(shouldCommit(120, 10, 200)).toBe(false);
  });
});

describe('rubber-banding', () => {
  it('moves less than the overshoot, and progressively less', () => {
    const small = rubberband(50, 400);
    const large = rubberband(200, 400);
    expect(small).toBeLessThan(50);
    expect(large).toBeLessThan(200);
    // Resistance increases: the second 150px of overshoot buys less than the first 50.
    expect(large - small).toBeLessThan(150);
  });

  it('preserves direction and is symmetric', () => {
    expect(rubberband(-120, 400)).toBeCloseTo(-rubberband(120, 400), 10);
  });

  it('never divides by a zero dimension', () => {
    expect(rubberband(100, 0)).toBe(0);
  });

  it('tracks 1:1 inside the bounds — direct manipulation is not negotiable in range', () => {
    expect(clampWithRubberband(150, 0, 400, 400)).toBe(150);
    expect(clampWithRubberband(0, 0, 400, 400)).toBe(0);
    expect(clampWithRubberband(400, 0, 400, 400)).toBe(400);
  });

  it('resists past either bound instead of stopping dead', () => {
    const below = clampWithRubberband(-100, 0, 400, 400);
    expect(below).toBeLessThan(0);
    expect(below).toBeGreaterThan(-100);

    const above = clampWithRubberband(500, 0, 400, 400);
    expect(above).toBeGreaterThan(400);
    expect(above).toBeLessThan(500);
  });
});

describe('velocity tracking', () => {
  it('measures px/s across the trailing window', () => {
    const tracker = new VelocityTracker(100);
    tracker.sample(0, 0);
    tracker.sample(50, 50);
    tracker.sample(100, 100);
    expect(tracker.velocity()).toBeCloseTo(1000, 6);
  });

  it('rejects a single jittery final sample', () => {
    // The naive last-two-events implementation would report 1500px/s from a finger that
    // has barely moved: 3px in 2ms.
    const tracker = new VelocityTracker(100);
    tracker.sample(0, 0);
    tracker.sample(1, 40);
    tracker.sample(2, 80);
    tracker.sample(5, 82);
    expect(Math.abs(tracker.velocity())).toBeLessThan(200);
  });

  it('returns zero when there is not enough signal, so the decision falls back to position', () => {
    const tracker = new VelocityTracker();
    expect(tracker.velocity()).toBe(0);
    tracker.sample(10, 5);
    expect(tracker.velocity()).toBe(0);
  });

  it('keeps at least two samples so a slow drag still reports a velocity', () => {
    const tracker = new VelocityTracker(100);
    tracker.sample(0, 0);
    tracker.sample(20, 500);
    tracker.sample(40, 1000);
    expect(tracker.velocity()).not.toBe(0);
  });

  it('reports the latest position and clears on reset', () => {
    const tracker = new VelocityTracker();
    tracker.sample(42, 10);
    expect(tracker.latest()).toBe(42);
    tracker.reset();
    expect(tracker.latest()).toBeUndefined();
    expect(tracker.velocity()).toBe(0);
  });
});

describe('writing direction', () => {
  it('flips the inline axis under RTL', () => {
    expect(inlineSign('ltr')).toBe(1);
    expect(inlineSign('rtl')).toBe(-1);
  });

  it('reads a physical drag as a logical one', () => {
    // Dragging physically left in Arabic is dragging toward the inline end.
    expect(toLogicalInline(-80, 'rtl')).toBe(80);
    expect(toLogicalInline(-80, 'ltr')).toBe(-80);
  });

  it('round-trips logical to physical and back', () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      expect(toLogicalInline(toPhysicalX(120, dir), dir)).toBe(120);
    }
  });

  it('dismisses a bottom sheet downward regardless of writing direction', () => {
    expect(dismissSign('block-end', 'ltr')).toBe(1);
    expect(dismissSign('block-end', 'rtl')).toBe(1);
    expect(dismissSign('block-start', 'rtl')).toBe(-1);
  });

  it('mirrors an inline-anchored drawer under RTL', () => {
    // The cart drawer leaves the way it arrived — toward the inline end, which is
    // physically right in English and physically left in Arabic.
    expect(dismissSign('inline-end', 'ltr')).toBe(1);
    expect(dismissSign('inline-end', 'rtl')).toBe(-1);
    expect(dismissSign('inline-start', 'ltr')).toBe(-1);
    expect(dismissSign('inline-start', 'rtl')).toBe(1);
  });
});
