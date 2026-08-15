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
 * The resting (closed) transform lives in sheet.css, never in a `style` attribute — a
 * server-rendered inline style is blocked by our CSP and the sheet would render on top of
 * the page until hydration. Runtime values are written through CSSOM, which is not
 * CSP-restricted. (Design system §1.2.)
 */

import { useCallback, useEffect, useRef } from 'react';
import { animate } from 'motion/react';
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
  const size = useRef(0);
  const directionRef = useRef<'ltr' | 'rtl'>('ltr');

  const axis = edgeAxis(edge);
  /** Logical offsets are dismiss-positive on end edges, dismiss-negative on start edges. */
  const dismissDirection = edge === 'block-end' || edge === 'inline-end' ? 1 : -1;

  /** Write a logical offset to the panel as a physical transform, via CSSOM. */
  const paint = useCallback(
    (offset: number) => {
      const panel = panelRef.current;
      if (!panel) return;
      panel.style.transform =
        axis === 'block'
          ? `translateY(${offset}px)`
          : `translateX(${toPhysicalX(offset, directionRef.current)}px)`;

      if (modal && scrimRef.current && size.current > 0) {
        const progress = 1 - Math.min(1, Math.abs(offset) / size.current);
        scrimRef.current.style.opacity = String(progress);
      }
    },
    [axis, modal],
  );

  const measure = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return 0;
    const rect = panel.getBoundingClientRect();
    size.current = axis === 'block' ? rect.height : rect.width;
    return size.current;
  }, [axis]);

  const settle = useCallback(
    (target: number, velocity: number, momentum: boolean) => {
      const panel = panelRef.current;
      if (!panel) return;

      const prefs = readPreferences();
      // Bounce is earned: overshoot only because a flick preceded it. A sheet closed by
      // its button uses the critically damped default instead.
      const spring = resolveSpring(momentum ? springs.sheet : springs.ui, velocity, prefs);

      const from = panel.style.transform;
      void from; // Motion reads the presentation value itself; retained for debugging.

      animate(
        panel,
        axis === 'block'
          ? { y: target }
          : { x: toPhysicalX(target, directionRef.current) },
        spring,
      );

      if (modal && scrimRef.current) {
        animate(
          scrimRef.current,
          { opacity: target === 0 ? 1 : 0 },
          toMotionSpring(springs.ui),
        );
      }

      // Blur is stepped, never interpolated — animating the radius re-runs the backdrop
      // readback every frame. (Design system §1.3.)
      panel.dataset.materialised = target === 0 ? 'true' : 'false';
    },
    [axis, modal],
  );

  const { isDragging, handlers } = useDrag({
    axis,
    bounds: dismissDirection === 1 ? { min: 0, max: size.current } : { min: -size.current, max: 0 },
    dimension: size.current,
    onDragStart: () => {
      directionRef.current = resolveDirection(panelRef.current);
      measure();
      // will-change only while a gesture is live. A permanent hint promotes every surface
      // to its own layer and exhausts memory on exactly the devices we protect.
      if (panelRef.current) panelRef.current.style.willChange = 'transform';
    },
    onDrag: ({ offset }) => paint(offset),
    onDragEnd: ({ offset, velocity }) => {
      const extent = size.current || measure();
      if (panelRef.current) panelRef.current.style.willChange = '';

      // Dismiss-positive scalars, so the decision reads the same on every edge.
      const displacement = offset * dismissDirection;
      const dismissVelocity = velocity * dismissDirection;

      // The landing point comes from where the gesture was *going*, not where it stopped.
      const projectedTarget = resolveSnapTarget(displacement, dismissVelocity, [0, extent]);
      const commit =
        shouldCommit(displacement, dismissVelocity, extent * DISMISS_FRACTION) ||
        projectedTarget === extent;

      const target = (commit ? extent : 0) * dismissDirection;
      // Raw release velocity, not the projection — projection picks the destination,
      // velocity handoff removes the seam. Both, or you get half the feel.
      settle(target, velocity, true);

      if (commit !== !open) return;
      onOpenChange(!commit);
    },
  });

  // React to controlled `open` changes that did not come from a gesture.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    directionRef.current = resolveDirection(panel);
    const extent = measure();
    if (isDragging) return;
    settle(open ? 0 : extent * dismissDirection, 0, false);
  }, [open, isDragging, measure, settle, dismissDirection]);

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
