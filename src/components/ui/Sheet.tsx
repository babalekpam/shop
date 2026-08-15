'use client';

/**
 * Sheet — a draggable surface that can be grabbed, thrown, and grabbed again mid-flight.
 *
 * This component is where most of the design system actually lands:
 *
 *   · 1:1 tracking with pointer capture, so it stays glued to the finger  (skill §2)
 *   · interruptible — grabbing it mid-animation starts from the on-screen value, not the
 *     target, so there is no jump                                          (skill §3)
 *   · release velocity handed to the spring, so there is no seam between drag and
 *     animation                                                            (skill §5)
 *   · the landing point chosen by projecting momentum, not by measuring from the release
 *     position — a hard flick throws it                                    (skill §6)
 *   · rubber-banding past the open bound rather than a hard stop           (skill §9)
 *   · symmetric path: it leaves the way it arrived, expressed as a logical edge so RTL
 *     is correct by construction                                           (skill §7)
 *
 * Two implementation details carry most of that:
 *
 * **One motion value owns the position.** Dragging writes to it and the release spring
 * animates it, so an interrupt always resumes from the live on-screen value. Writing
 * `style.transform` directly during the drag and then handing the element to `animate()`
 * looks equivalent and is not — Motion would animate from its own stale cached value and
 * the sheet would jump on the first interrupt, which is precisely the failure skill §3 is
 * about.
 *
 * **The resting transform lives in sheet CSS, never in a `style` attribute.** A
 * server-rendered inline style is blocked by our CSP, so the sheet would render on top of
 * the page until hydration. The subscriber below only starts writing once the panel has
 * been measured. (Design system §1.2.)
 */

import { useCallback, useEffect, useRef } from 'react';
import { animate, useMotionValue } from 'motion/react';
import { useDrag } from '../../lib/motion/useDrag';
import { resolveSnapTarget, shouldCommit } from '../../lib/motion/project';
import { springs, toMotionSpring } from '../../lib/motion/spring';
import { readPreferences, resolveSpring } from '../../lib/motion/preferences';
import {
  edgeAxis,
  resolveDirection,
  toPhysicalX,
  type LogicalEdge,
} from '../../lib/motion/direction';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Which logical edge the sheet is anchored to. It enters and exits along this same
   * path — a surface that arrives from one edge and leaves by another reads as
   * disconnected.
   */
  edge?: LogicalEdge;
  /**
   * Modal surfaces dim the background to focus attention; parallel ones do not, so the
   * flow behind them is not broken. Checkout is modal. The cart drawer is not — the
   * catalog stays visible and browsable behind it. (Skill §12.)
   */
  modal?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  children: React.ReactNode;
}

/** Displacement past which a slow release still dismisses. */
const DISMISS_FRACTION = 0.5;

export function Sheet({
  open,
  onOpenChange,
  edge = 'block-end',
  modal = true,
  children,
  ...aria
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);

  /** The single source of truth for where the sheet is, in logical units. */
  const offset = useMotionValue(0);

  const extent = useRef(0);
  const measured = useRef(false);
  const directionRef = useRef<'ltr' | 'rtl'>('ltr');
  /** The open state the sheet was last animated toward, so a gesture and the controlled
   *  prop cannot both settle it and fight each other. */
  const settledOpen = useRef<boolean | null>(null);

  const axis = edgeAxis(edge);
  /** Logical offsets are dismiss-positive on end edges, dismiss-negative on start edges. */
  const dismissDirection = edge === 'block-end' || edge === 'inline-end' ? 1 : -1;

  const measure = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return extent.current;
    const rect = panel.getBoundingClientRect();
    const size = axis === 'block' ? rect.height : rect.width;
    // A collapsed measurement (display:none, not yet laid out) would pin the bounds to
    // zero and make the sheet immovable. Keep the last good value instead.
    if (size > 0) {
      extent.current = size;
      measured.current = true;
    }
    return extent.current;
  }, [axis]);

  /** Write a logical offset to the panel as a physical transform, via CSSOM. */
  const paint = useCallback(
    (value: number) => {
      const panel = panelRef.current;
      if (!panel) return;
      panel.style.transform =
        axis === 'block'
          ? `translateY(${value}px)`
          : `translateX(${toPhysicalX(value, directionRef.current)}px)`;

      if (modal && scrimRef.current && extent.current > 0) {
        scrimRef.current.style.opacity = String(
          1 - Math.min(1, Math.abs(value) / extent.current),
        );
      }
    },
    [axis, modal],
  );

  const settle = useCallback(
    (target: number, velocity: number, momentum: boolean) => {
      const prefs = readPreferences();
      // Bounce is earned: overshoot only because a flick preceded it. A sheet closed by
      // its button uses the critically damped default instead.
      const spring = resolveSpring(momentum ? springs.sheet : springs.ui, velocity, prefs);

      // Animating the motion value, not the element — so this resumes from wherever the
      // sheet visually is, including mid-flight.
      animate(offset, target, spring);

      if (modal && scrimRef.current) {
        animate(scrimRef.current, { opacity: target === 0 ? 1 : 0 }, toMotionSpring(springs.ui));
      }

      const panel = panelRef.current;
      if (panel) {
        // Blur is stepped, never interpolated — animating the radius re-runs the backdrop
        // readback every frame. (Design system §1.3.)
        panel.dataset.materialised = target === 0 ? 'true' : 'false';
      }
    },
    [modal, offset],
  );

  const { isDragging, handlers } = useDrag({
    axis,
    // Resolved per gesture, after onDragStart has measured — a plain object here would be
    // {min: 0, max: 0} for the whole of the first drag.
    bounds: () =>
      dismissDirection === 1
        ? { min: 0, max: extent.current }
        : { min: -extent.current, max: 0 },
    dimension: () => extent.current,
    onDragStart: () => {
      directionRef.current = resolveDirection(panelRef.current);
      measure();
      // will-change only while a gesture is live. A permanent hint promotes every surface
      // to its own layer and exhausts memory on exactly the devices we protect.
      if (panelRef.current) panelRef.current.style.willChange = 'transform';
    },
    onDrag: ({ offset: dragged }) => offset.jump(dragged),
    onDragEnd: ({ offset: released, velocity }) => {
      const size = extent.current || measure();
      if (panelRef.current) panelRef.current.style.willChange = '';

      // Dismiss-positive scalars, so the decision reads the same on every edge.
      const displacement = released * dismissDirection;
      const dismissVelocity = velocity * dismissDirection;

      // The landing point comes from where the gesture was *going*, not where it stopped.
      const projected = resolveSnapTarget(displacement, dismissVelocity, [0, size]);
      const commit =
        shouldCommit(displacement, dismissVelocity, size * DISMISS_FRACTION) ||
        projected === size;

      const resulting = !commit;
      // Record before notifying, so the controlled-prop effect below recognises this
      // change as one the gesture already animated and does not re-settle it with a
      // zero-velocity spring.
      settledOpen.current = resulting;

      // Raw release velocity, not the projection — projection picks the destination,
      // velocity handoff removes the seam. Both, or you get half the feel.
      settle((commit ? size : 0) * dismissDirection, velocity, true);

      if (resulting !== open) onOpenChange(resulting);
    },
  });

  // Position the sheet once it has been laid out, without animating: before this runs the
  // CSS class holds the resting transform, which is what SSR needs.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    directionRef.current = resolveDirection(panel);
    const size = measure();
    if (!measured.current) return;

    if (settledOpen.current === null) {
      settledOpen.current = open;
      offset.jump(open ? 0 : size * dismissDirection);
    }

    const unsubscribe = offset.on('change', paint);
    paint(offset.get());
    return unsubscribe;
  }, [measure, offset, paint, open, dismissDirection]);

  // React to controlled `open` changes that did not come from a gesture.
  useEffect(() => {
    if (!measured.current || isDragging) return;
    if (settledOpen.current === open) return;
    settledOpen.current = open;
    settle(open ? 0 : extent.current * dismissDirection, 0, false);
  }, [open, isDragging, settle, dismissDirection]);

  // A px offset goes stale when the viewport changes. Re-measure and re-seat a closed
  // sheet, or it drifts partly on-screen after a rotation.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      const size = measure();
      if (!isDragging && !open && measured.current) offset.jump(size * dismissDirection);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure, isDragging, open, offset, dismissDirection]);

  return (
    <>
      {modal && (
        <div
          ref={scrimRef}
          className="sheet-scrim"
          data-open={open || undefined}
          onClick={() => onOpenChange(false)}
          aria-hidden="true"
        />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={modal || undefined}
        data-edge={edge}
        data-open={open || undefined}
        className="sheet material-thick"
        {...aria}
      >
        {/* The grab handle is the drag surface, so a scrollable body inside the sheet
            still scrolls. Axis locking in useDrag covers the rest. */}
        <div className="sheet-handle" {...handlers} aria-hidden="true">
          <span className="sheet-grabber" />
        </div>
        {children}
      </div>
    </>
  );
}
