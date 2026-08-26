/**
 * Tamper-evident audit log.
 *
 * Each entry carries the hash of its predecessor, so altering or removing any historical
 * row breaks the chain from that point forward and `verify()` reports exactly where. This
 * is the Merkle-chained pattern the security spec §10 already specifies for the
 * storefront's privileged actions, applied to the agency's.
 *
 * The application has no update or delete path. In the Postgres deployment the audit
 * table is additionally owned by a role the application cannot use to modify it, because
 * an append-only guarantee enforced only by the code that appends is not a guarantee.
 */

import { createHash } from 'node:crypto';
import type { AgencyStore } from '../store';
import type { ActionKind, AgentName } from '../domain/types';

export interface AuditEntry {
  seq: number;
  at: string;
  agent: AgentName;
  actionKind: ActionKind;
  outcome: string;
  detail: string;
  prevHash: string;
  hash: string;
}

/** The chain's anchor. A fixed, known value so the first entry is verifiable too. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * ASCII unit separator (U+001F). Chosen because it cannot occur in any of the joined
 * values, so ("ab","c") and ("a","bc") cannot collide into the same digest — a real
 * weakness of naive string concatenation in a hash chain.
 */
const FIELD_SEP = String.fromCharCode(31);

function computeHash(input: {
  at: string;
  agent: string;
  actionKind: string;
  outcome: string;
  detail: string;
  prevHash: string;
}): string {
  return createHash('sha256')
    .update(
      [
        input.prevHash,
        input.at,
        input.agent,
        input.actionKind,
        input.outcome,
        input.detail,
      ].join(FIELD_SEP),
    )
    .digest('hex');
}

export class AuditLog {
  constructor(private readonly store: AgencyStore) {}

  /**
   * Append an entry.
   *
   * `detail` must already be free of personal data, credentials and anything clinical —
   * the caller scrubs, because only the caller knows what the field means. Security spec
   * §10 lists what must never be logged.
   */
  append(entry: {
    agent: AgentName;
    actionKind: ActionKind;
    outcome: string;
    detail: string;
  }): AuditEntry {
    const at = new Date().toISOString();
    const prevHash = this.headHash();
    const hash = computeHash({ ...entry, at, prevHash });

    this.store.connection
      .prepare(
        `INSERT INTO audit_log (at, agent, action_kind, outcome, detail, prev_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(at, entry.agent, entry.actionKind, entry.outcome, entry.detail, prevHash, hash);

    const row = this.store.connection
      .prepare('SELECT seq FROM audit_log WHERE hash = ?')
      .get(hash) as { seq: number };

    return { seq: Number(row.seq), at, prevHash, hash, ...entry };
  }

  headHash(): string {
    const row = this.store.connection
      .prepare('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1')
      .get() as { hash: string } | undefined;
    return row ? String(row.hash) : GENESIS_HASH;
  }

  all(): AuditEntry[] {
    const rows = this.store.connection
      .prepare('SELECT * FROM audit_log ORDER BY seq ASC')
      .all() as Array<Record<string, string | number>>;
    return rows.map((r) => ({
      seq: Number(r.seq),
      at: String(r.at),
      agent: String(r.agent) as AgentName,
      actionKind: String(r.action_kind) as ActionKind,
      outcome: String(r.outcome),
      detail: String(r.detail),
      prevHash: String(r.prev_hash),
      hash: String(r.hash),
    }));
  }

  /**
   * Recompute the chain.
   *
   * Returns the sequence number of the first entry that does not verify, or ok when the
   * whole chain is intact. Reporting *where* it broke is what makes this useful during an
   * incident — "something was altered" is much less actionable than "entry 412 onward".
   */
  verify(): { ok: true } | { ok: false; brokenAt: number; reason: string } {
    let expectedPrev = GENESIS_HASH;
    for (const entry of this.all()) {
      if (entry.prevHash !== expectedPrev) {
        return { ok: false, brokenAt: entry.seq, reason: 'predecessor hash does not match' };
      }
      const recomputed = computeHash({
        at: entry.at,
        agent: entry.agent,
        actionKind: entry.actionKind,
        outcome: entry.outcome,
        detail: entry.detail,
        prevHash: entry.prevHash,
      });
      if (recomputed !== entry.hash) {
        return { ok: false, brokenAt: entry.seq, reason: 'entry content does not match its hash' };
      }
      expectedPrev = entry.hash;
    }
    return { ok: true };
  }
}
