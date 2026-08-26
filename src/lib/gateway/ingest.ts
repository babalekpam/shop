/**
 * Webhook ingestion — the idempotency spine.
 *
 * Security spec §8 requires idempotency enforced by a database constraint rather than
 * application logic, and handlers that run inside a transaction so partial application is
 * impossible. Both happen here so no individual handler has to remember.
 *
 * The distinction that makes this correct rather than merely safe-looking:
 *
 *   **A duplicate is an event already APPLIED. A dead letter is an event that FAILED.**
 *
 * If "have I seen this id?" were the duplicate test, then the first delivery failing
 * halfway — a gateway timeout, a deploy mid-transaction — would poison the id forever, and
 * the gateway's retry (the thing designed to fix exactly that) would be discarded as a
 * duplicate. The customer paid and never got access, and the logs say "duplicate, skipped".
 *
 * So the test is `processed_at IS NOT NULL`. A failed event keeps `processed_at` NULL and
 * is retried on redelivery; a succeeded one is short-circuited.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../../db/client';

export type IngestOutcome =
  | { status: 'applied'; eventRowId: string }
  | { status: 'duplicate'; eventRowId: string }
  | { status: 'failed'; eventRowId: string | null; error: string };

export interface IngestInput {
  gateway: 'paddle' | 'cinetpay';
  /** The gateway's own event id. The unique constraint is on (gateway, this). */
  gatewayEventId: string;
  type: string;
  payload: unknown;
  /**
   * Applies the event's effects. Runs inside the same transaction as the event row, so a
   * throw rolls back everything including the row — which is what leaves it retryable.
   */
  apply: (tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]) => Promise<void>;
}

export async function ingestWebhook(input: IngestInput): Promise<IngestOutcome> {
  const db = getDb();
  const { gateway, gatewayEventId, type, payload } = input;

  try {
    return await db.transaction(async (tx) => {
      // Claim the event. Under two concurrent identical deliveries one blocks on the row
      // lock until the other commits, so exactly one proceeds to apply.
      //
      // RETURNING gives the post-update row, and the update never touches processed_at —
      // so a non-null value here means some earlier delivery already applied this event.
      const claimed = await tx.execute(sql`
        INSERT INTO webhook_events (gateway, gateway_event_id, type, payload, attempts)
        VALUES (${gateway}, ${gatewayEventId}, ${type}, ${JSON.stringify(payload)}::jsonb, 1)
        ON CONFLICT (gateway, gateway_event_id) DO UPDATE
          SET attempts = webhook_events.attempts + 1
        RETURNING id, processed_at
      `);
      const row = firstRow<{ id: string; processed_at: string | null }>(claimed);
      if (!row) throw new Error('webhook_events claim returned no row');

      if (row.processed_at !== null) {
        // Already applied. Commit so the attempts increment survives as a record that the
        // gateway delivered this twice — useful when diagnosing a gateway's retry storm.
        return { status: 'duplicate' as const, eventRowId: row.id };
      }

      await input.apply(tx);

      await tx.execute(sql`
        UPDATE webhook_events SET processed_at = now(), error = NULL WHERE id = ${row.id}::uuid
      `);
      return { status: 'applied' as const, eventRowId: row.id };
    });
  } catch (err) {
    // The transaction rolled back, taking the event row with it. Record the failure
    // separately so it lands in the dead-letter view — with processed_at still NULL, so a
    // redelivery retries rather than being mistaken for a duplicate.
    const message = err instanceof Error ? err.message : String(err);
    const eventRowId = await recordDeadLetter({ gateway, gatewayEventId, type, payload, error: message });
    return { status: 'failed', eventRowId, error: message };
  }
}

async function recordDeadLetter(opts: {
  gateway: string; gatewayEventId: string; type: string; payload: unknown; error: string;
}): Promise<string | null> {
  try {
    const res = await getDb().execute(sql`
      INSERT INTO webhook_events (gateway, gateway_event_id, type, payload, error, attempts)
      VALUES (${opts.gateway}, ${opts.gatewayEventId}, ${opts.type},
              ${JSON.stringify(opts.payload)}::jsonb, ${truncate(opts.error)}, 1)
      ON CONFLICT (gateway, gateway_event_id) DO UPDATE
        SET error = ${truncate(opts.error)}, attempts = webhook_events.attempts + 1
      RETURNING id
    `);
    return firstRow<{ id: string }>(res)?.id ?? null;
  } catch {
    // If even the dead-letter write fails the database is gone; the caller must still
    // return a 5xx so the gateway retries. Swallowing here is deliberate.
    return null;
  }
}

/** Error text is operator-facing and must never carry gateway payload detail into logs. */
function truncate(s: string): string {
  return s.length > 500 ? `${s.slice(0, 500)}…` : s;
}

/** `db.execute` returns a pg Result on this driver, an array on others. Handle both. */
function firstRow<T>(res: unknown): T | undefined {
  if (Array.isArray(res)) return res[0] as T | undefined;
  const maybe = res as { rows?: unknown[] };
  return Array.isArray(maybe.rows) ? (maybe.rows[0] as T | undefined) : undefined;
}

/** Events that failed and were never applied. Admin replay reads this. */
export async function deadLetters(gateway?: 'paddle' | 'cinetpay', limit = 100) {
  const res = await getDb().execute(sql`
    SELECT id, gateway, gateway_event_id, type, error, attempts, received_at
    FROM webhook_events
    WHERE processed_at IS NULL AND error IS NOT NULL
      ${gateway ? sql`AND gateway = ${gateway}` : sql``}
    ORDER BY received_at DESC
    LIMIT ${limit}
  `);
  return Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? []);
}
