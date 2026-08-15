'use client';

/**
 * Price — tabular figures, exponent-aware formatting, and a visible price lock.
 *
 * Two decisions worth stating:
 *
 * 1. **Tabular numerals.** Proportional figures make a price jitter horizontally when
 *    quantity or currency changes. That jitter reads as instability on the one number the
 *    customer cares most about.
 *
 * 2. **The lock is visible.** The build spec guarantees the price shown at add-to-cart is
 *    the price charged, even across an FX rollover (§4). So when the rate moves and the
 *    number does not, the customer is looking at a discrepancy they cannot explain — and
 *    an unexplained price discrepancy at checkout is exactly where trust dies. Saying
 *    "held for this session" turns a suspected bug into a demonstration that we do what
 *    we promised.
 *
 * Price changes cross-fade rather than rolling or sliding: sliding digits imply a counter,
 * which implies the value is still moving.
 */

import { formatMoney, type CurrencyMeta } from '../../lib/format/money';

export interface PriceProps {
  /** Amount in minor units. Never pre-divided — the exponent is applied on render. */
  amountMinor: number;
  currency: string;
  locale: string;
  /** Row from the `currencies` table, so the exponent is authoritative. */
  meta?: CurrencyMeta;
  /** Already-localised interval, e.g. "month". Omit for one-time prices. */
  interval?: string;
  /**
   * Set when this price is held from the session's price lock and the live rate has since
   * moved. Requires `lockedLabel`.
   */
  locked?: boolean;
  /** Localised, e.g. "Price held for this session". */
  lockedLabel?: string;
  size?: 'display' | 'title-2' | 'body';
}

export function Price({
  amountMinor,
  currency,
  locale,
  meta,
  interval,
  locked = false,
  lockedLabel,
  size = 'title-2',
}: PriceProps) {
  const formatted = formatMoney(amountMinor, { locale, currency, meta });

  return (
    <span className="price">
      <span
        className={`type-${size} type-money price-amount`}
        // Keyed on the value so a change remounts and cross-fades, rather than mutating
        // in place with no transition at all.
        key={`${currency}-${amountMinor}`}
      >
        {formatted}
        {interval && <span className="price-interval type-callout">/{interval}</span>}
      </span>
      {locked && lockedLabel && (
        <span className="type-caption price-lock">{lockedLabel}</span>
      )}
    </span>
  );
}
