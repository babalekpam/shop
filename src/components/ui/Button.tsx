'use client';

/**
 * Button — feedback on pointer-down, commit on pointer-up.
 *
 * The moment lag appears, the feeling of directness falls off a cliff. Waiting for
 * `click` to show that a button was pressed feels dead, so the press state lands on
 * `pointerdown` and the action fires on release.
 *
 * The press state is a CSS class, not an inline style: our CSP runs `style-src` without
 * `unsafe-inline`, and it also means the visual lands in the same frame as the event
 * rather than after a React commit.
 *
 * See docs/design-system.md §1.2 and .claude/skills/apple-design/SKILL.md §1, §10, §13.
 */

import { forwardRef, useCallback, useRef, useState } from 'react';

/** Slop around the button within which the press survives. Skill §10: ~10px. */
const CANCEL_SLOP = 10;

export type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'destructive';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /**
   * Fire a short haptic on commit. Reserve it for meaningful moments — a payment
   * confirming, an item snapping home. Over-feedback trains people to ignore all of it.
   */
  haptic?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', haptic = false, className, onPointerDown, onClick, ...props },
  forwardedRef,
) {
  const [pressed, setPressed] = useState(false);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button === 0) {
        origin.current = { x: event.clientX, y: event.clientY };
        setPressed(true);
        // Capture so the press state tracks correctly when the finger slides off and
        // back on — cancel-by-dragging-away, and un-cancel by dragging back.
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      onPointerDown?.(event);
    },
    [onPointerDown],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!origin.current) return;
    const withinSlop =
      Math.abs(event.clientX - origin.current.x) <= CANCEL_SLOP + event.currentTarget.offsetWidth / 2 &&
      Math.abs(event.clientY - origin.current.y) <= CANCEL_SLOP + event.currentTarget.offsetHeight / 2;
    setPressed(withinSlop);
  }, []);

  const release = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    origin.current = null;
    setPressed(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      // Visual, haptic and action on the same frame — latency between the senses is what
      // destroys the illusion that they share a cause. (Skill §13, harmony.)
      if (haptic && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(8);
      }
      onClick?.(event);
    },
    [haptic, onClick],
  );

  return (
    <button
      ref={forwardedRef}
      className={['btn', `btn-${variant}`, className].filter(Boolean).join(' ')}
      data-pressed={pressed || undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      onClick={handleClick}
      {...props}
    />
  );
});
