/**
 * Spend ceilings — for money and for tokens.
 *
 * Two rules from spec §7:
 *
 * 1. **Reaching the ceiling stops spend. It does not raise a request.** A cap that
 *    politely asks to be raised is not a cap; the point is that the failure mode is
 *    "nothing happens" rather than "an agent argues for more budget at 3am".
 * 2. **LLM consumption is spend.** An autonomous research loop with no cost bound is a way
 *    to spend four figures qualifying a lead worth $29.
 */

import type { AgencyStore } from '../store';

export type LedgerKind = 'tokens' | 'ad_spend_minor';

export interface Ceilings {
  /** Tokens per period, across the whole team. */
  tokens: number;
  /** Ad spend per period, in minor units of the billing currency. */
  adSpendMinor: number;
}

/** `YYYY-MM`. Ceilings are monthly. */
export const periodFor = (date: Date): string => date.toISOString().slice(0, 7);

export class BudgetLedger {
  constructor(
    private readonly store: AgencyStore,
    private readonly ceilings: Ceilings,
  ) {}

  spent(kind: LedgerKind, period = periodFor(new Date())): number {
    const row = this.store.connection
      .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM ledger WHERE period = ? AND kind = ?')
      .get(period, kind) as { total: number };
    return Number(row.total);
  }

  remaining(kind: LedgerKind, period = periodFor(new Date())): number {
    const ceiling = kind === 'tokens' ? this.ceilings.tokens : this.ceilings.adSpendMinor;
    return Math.max(0, ceiling - this.spent(kind, period));
  }

  /**
   * Whether an amount would breach the ceiling.
   *
   * Checked before the work happens, not after — an agent that discovers it is over budget
   * having already spent the tokens has learned nothing useful.
   */
  wouldExceed(kind: LedgerKind, amount: number, period = periodFor(new Date())): boolean {
    return amount > this.remaining(kind, period);
  }

  record(kind: LedgerKind, amount: number, period = periodFor(new Date())): void {
    if (amount <= 0) return;
    this.store.connection
      .prepare('INSERT INTO ledger (id, period, kind, amount, at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), period, kind, Math.round(amount), new Date().toISOString());
  }
}
