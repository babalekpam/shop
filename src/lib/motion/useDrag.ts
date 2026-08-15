'use client';

/**
 * Direct manipulation — 1:1 tracking with pointer capture, hysteresis, axis locking,
 * rubber-banded bounds, and a velocity measurement worth handing to a spring.
 *
 * Touch and content move together. The element stays glued to the finger the whole way
 * through the gesture, not only when it ends, and the gesture can be started, reversed
 * and released without the interface ever taking control away.
 *
 * See docs/design-system.md §2 and .claude/skills/apple-design/SKILL.md §2, §5, §6, §10.
 */

import { useCallback, useRef, useState } from 'react';
import { clampWithRubberband } from './rubberband';
import { VelocityTracker } from './velocity';
import { resolveDirection, toLogicalInline, type Direction } from './direction';

export interface Bounds {
  min: number;
  max: number;
}

export interface DragState {
  /** Offset from the drag origin, in logical units — already rubber-banded. */
  offset: number;
  /** px/s at this instant, measured over a trailing window. */
  velocity: number;
}

export interface UseDragOptions {
  /**
   * `inline` follows the writing direction and flips under RTL. `block` is vertical and
   * does not. Bottom sheets are `block`; side drawers are `inline`.
   */
  axis: 'inline' | 'block';
  /**
   * Drag bounds in logical units. Movement past them resists rather than stopping.
   *
   * Pass a function when the bounds depend on a measurement — a sheet does not know its
   * own height until it is laid out, and a plain object captured during the first render
   * would be `{min: 0, max: 0}` for the whole of the first gesture. Functions are resolved
   * once per gesture, at pointer-down.
   */
  bounds?: Bounds | (() => Bounds);
  /** Size of the dragged dimension, in px — scales the rubber-band resistance. */
  dimension?: number | (() => number);
  /**
   * Movement required before the gesture commits to this axis, in px. Below it, nothing
   * moves and the browser keeps the gesture — so a vertical scroll inside a horizontally
   * draggable drawer still scrolls.
   */
  hysteresis?: number;
  /**
   * Cancel the gesture if the first decisive movement is on the other axis. Leave on for
   * anything inside a scrollable region.
   */
  lockAxis?: boolean;
  onDragStart?: () => void;
  onDrag?: (state: DragState) => void;
  onDragEnd?: (state: DragState) => void;
}

export interface UseDragResult {
  isDragging: boolean;
  /** Spread onto the draggable element. */
  handlers: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
    onPointerCancel: (event: React.PointerEvent) => void;
  };
}

const DEFAULT_HYSTERESIS = 10;

export function useDrag(options: UseDragOptions): UseDragResult {
  const {
    axis,
    bounds,
    dimension = 0,
    hysteresis = DEFAULT_HYSTERESIS,
    lockAxis = true,
    onDragStart,
    onDrag,
    onDragEnd,
  } = options;

  const [isDragging, setIsDragging] = useState(false);

  const origin = useRef({ x: 0, y: 0 });
  const direction = useRef<Direction>('ltr');
  const tracker = useRef(new VelocityTracker());
  const active = useRef(false);
  const committed = useRef(false);
  const abandoned = useRef(false);
  const pointerId = useRef<number | null>(null);

  // Resolved once per gesture rather than read from the render closure, so a measurement
  // taken in onDragStart is the one this gesture actually uses.
  const activeBounds = useRef<Bounds | undefined>(undefined);
  const activeDimension = useRef(0);

  /** Physical pointer position → logical offset along the tracked axis. */
  const logicalDelta = useCallback(
    (event: React.PointerEvent): number => {
      if (axis === 'block') return event.clientY - origin.current.y;
      return toLogicalInline(event.clientX - origin.current.x, direction.current);
    },
    [axis],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Secondary buttons are not drags. Let them through to context menus.
      if (event.button !== 0) return;

      active.current = true;
      committed.current = false;
      abandoned.current = false;
      pointerId.current = event.pointerId;
      origin.current = { x: event.clientX, y: event.clientY };
      direction.current = resolveDirection(event.currentTarget);
      tracker.current.reset();
      tracker.current.sample(0, event.timeStamp);

      // Capture so tracking survives the pointer leaving the element's bounds — without
      // this, a fast drag drops the gesture the moment it exits the hit area.
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!active.current || abandoned.current) return;
      if (pointerId.current !== null && event.pointerId !== pointerId.current) return;

      const delta = logicalDelta(event);

      if (!committed.current) {
        const crossAxisDelta =
          axis === 'block'
            ? event.clientX - origin.current.x
            : event.clientY - origin.current.y;

        // Nothing moves until intent is clear. Both axes are evaluated from the first
        // move, and the loser is cancelled once the winner is unambiguous.
        if (Math.abs(delta) < hysteresis && Math.abs(crossAxisDelta) < hysteresis) return;

        if (lockAxis && Math.abs(crossAxisDelta) > Math.abs(delta)) {
          abandoned.current = true;
          return;
        }

        committed.current = true;
        setIsDragging(true);
        // Measurement happens here, so bounds are resolved *after* it, not before.
        onDragStart?.();
        activeBounds.current = typeof bounds === 'function' ? bounds() : bounds;
        activeDimension.current = typeof dimension === 'function' ? dimension() : dimension;
      }

      // Subtract the hysteresis in the direction of travel, so committing to the gesture
      // does not jump the element by the threshold distance.
      const travelled = delta - Math.sign(delta) * hysteresis;

      const resolvedBounds = activeBounds.current;
      const offset = resolvedBounds
        ? clampWithRubberband(
            travelled,
            resolvedBounds.min,
            resolvedBounds.max,
            activeDimension.current ||
              Math.abs(resolvedBounds.max - resolvedBounds.min) ||
              1,
          )
        : travelled;

      tracker.current.sample(offset, event.timeStamp);
      onDrag?.({ offset, velocity: tracker.current.velocity() });
    },
    [axis, bounds, dimension, hysteresis, lockAxis, logicalDelta, onDrag, onDragStart],
  );

  const finish = useCallback(
    (event: React.PointerEvent) => {
      if (!active.current) return;
      if (pointerId.current !== null && event.pointerId !== pointerId.current) return;

      const wasCommitted = committed.current;

      active.current = false;
      committed.current = false;
      pointerId.current = null;
      setIsDragging(false);

      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      activeBounds.current = undefined;
      activeDimension.current = 0;

      if (!wasCommitted || abandoned.current) {
        abandoned.current = false;
        tracker.current.reset();
        return;
      }
      abandoned.current = false;

      const offset = tracker.current.latest() ?? 0;
      const velocity = tracker.current.velocity();
      tracker.current.reset();

      onDragEnd?.({ offset, velocity });
    },
    [onDragEnd],
  );

  return {
    isDragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  };
}
