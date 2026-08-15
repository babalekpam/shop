'use client';

/**
 * PaymentStatus — the mobile-money waiting state.
 *
 * This is the sharpest collision in the product between Apple's fluidity guidance and
 * what is actually true. That guidance assumes the system knows the outcome and is merely
 * moving toward it. On the CinetPay path we do not know the outcome, we cannot know it
 * for minutes, and the honest answer is "we are waiting on a network we do not control."
 *
 * A spinner here is a lie about latency, told at the moment the customer is most anxious:
 * money has left, nothing has arrived. So we respond instantly to the *tap* and then tell
 * the truth about the *wait*.
 *
 * Rules this component exists to enforce (design system §1.4):
 *   · no indeterminate spinner, and no progress bar that fills on a timer
 *   · no looping animation near 0.2 Hz — skill §14 flags that as a vestibular trigger,
 *     and a five-second "waiting" pulse lands exactly on it
 *   · elapsed time appears once the wait passes 20s, because silence then reads as
 *     breakage. It counts up honestly; it never counts down to a deadline we cannot keep
 *   · the page says leaving is safe, because it is — the webhook grants entitlement
 *     independently of this tab (build spec §9)
 *   · every state is legible as text with all animation disabled
 */

import { useEffect, useState } from 'react';

export type PaymentPhase =
  | 'submitting'
  | 'awaiting_confirmation'
  | 'verifying'
  | 'confirmed'
  | 'failed';

/**
 * All copy is passed in, already localised. Assembling strings inside the component would
 * hide them from the per-locale coverage report in CI (build spec §5).
 */
export interface PaymentStatusStrings {
  submitting: string;
  awaitingTitle: string;
  awaitingDetail: string;
  verifying: string;
  confirmed: string;
  failed: string;
  /** e.g. "You can close this page — we'll email you when it completes." */
  safeToLeave: string;
  /** e.g. "Waiting {duration}" */
  elapsedLabel: (duration: string) => string;
  retry: string;
}

export interface PaymentStatusProps {
  phase: PaymentPhase;
  /** `Date.now()` at submit. Drives the elapsed counter. */
  startedAt: number;
  locale: string;
  strings: PaymentStatusStrings;
  onRetry?: () => void;
}

/** Below this, silence is normal. Above it, silence reads as breakage. */
const ELAPSED_VISIBLE_AFTER_MS = 20_000;

const STEPS: readonly PaymentPhase[] = [
  'submitting',
  'awaiting_confirmation',
  'verifying',
  'confirmed',
];

function formatElapsed(ms: number, locale: string): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const number = new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 });
  return `${new Intl.NumberFormat(locale).format(minutes)}:${number.format(seconds)}`;
}

export function PaymentStatus({
  phase,
  startedAt,
  locale,
  strings,
  onRetry,
}: PaymentStatusProps) {
  const [elapsed, setElapsed] = useState(0);
  const settled = phase === 'confirmed' || phase === 'failed';

  useEffect(() => {
    if (settled) return;
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [settled, startedAt]);

  const currentStep = STEPS.indexOf(phase);
  const showElapsed = !settled && elapsed >= ELAPSED_VISIBLE_AFTER_MS;

  const title =
    phase === 'submitting'
      ? strings.submitting
      : phase === 'awaiting_confirmation'
        ? strings.awaitingTitle
        : phase === 'verifying'
          ? strings.verifying
          : phase === 'confirmed'
            ? strings.confirmed
            : strings.failed;

  return (
    // aria-live so the state change reaches a screen reader without stealing focus —
    // the customer may well be looking at their phone, not this screen.
    <section className="payment-status" data-phase={phase} aria-live="polite">
      <h2 className="type-title-2 payment-status-title">{title}</h2>

      {phase === 'awaiting_confirmation' && (
        <p className="type-body payment-status-detail">{strings.awaitingDetail}</p>
      )}

      {/* Discrete completed steps. Each one is true when it appears — no bar filling
          toward a completion we cannot predict. */}
      <ol className="payment-steps" aria-hidden="true">
        {STEPS.map((step, index) => (
          <li
            key={step}
            className="payment-step"
            data-state={
              phase === 'failed'
                ? index <= currentStep
                  ? 'failed'
                  : 'pending'
                : index < currentStep
                  ? 'done'
                  : index === currentStep
                    ? 'active'
                    : 'pending'
            }
          />
        ))}
      </ol>

      {showElapsed && (
        <p className="type-caption payment-status-elapsed">
          {strings.elapsedLabel(formatElapsed(elapsed, locale))}
        </p>
      )}

      {/* The customer is free to go. Saying so is the difference between a two-minute
          wait and a two-minute wait spent worrying. */}
      {!settled && <p className="type-callout payment-status-leave">{strings.safeToLeave}</p>}

      {phase === 'failed' && onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          {strings.retry}
        </button>
      )}
    </section>
  );
}
