/**
 * CinetPay webhooks — mobile money.
 *
 * The difference from Paddle is step 3, and it is the whole point of this file:
 *
 *   **A valid signature is not a payment.** CinetPay's notify tells us a transaction
 *   changed state, including to states like REFUSED and PENDING. Build spec §9 requires
 *   re-verification against CinetPay's check endpoint before anything is granted.
 *
 * The asynchrony is real: a customer confirms on their handset minutes later, the browser
 * may be long closed, and duplicate notifies for one transaction are routine. All three are
 * handled by ingesting on `cpm_trans_id` and granting only on a checked 'accepted'.
 */
import { NextResponse } from 'next/server';
import { verifyCinetPayNotify } from '../../../../lib/gateway/signature';
import { ingestWebhook } from '../../../../lib/gateway/ingest';
import { checkPayment, CinetPayUnavailableError } from '../../../../lib/gateway/cinetpay';
import { grantEntitlement } from '../../../../lib/commerce/fulfil';
import { isDatabaseConfigured } from '../../../../db/client';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const secretKey = process.env.CINETPAY_SECRET_KEY;
  const apiKey = process.env.CINETPAY_API_KEY;
  const siteId = process.env.CINETPAY_SITE_ID;
  if (!secretKey || !apiKey || !siteId || !isDatabaseConfigured()) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  const verdict = verifyCinetPayNotify({
    rawBody,
    header: request.headers.get('x-token'),
    secretKey,
  });
  if (!verdict.valid) {
    console.warn('[webhook:cinetpay] rejected:', verdict.reason);
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }

  // CinetPay posts form-encoded, not JSON.
  const form = new URLSearchParams(rawBody);
  const transactionId = form.get('cpm_trans_id');
  if (!transactionId) {
    return NextResponse.json({ error: 'missing_transaction_id' }, { status: 400 });
  }

  // ── Step 4: ask CinetPay what actually happened. ────────────────────────────
  // Deliberately BEFORE ingestion. If the check endpoint is down we must return 5xx and
  // let CinetPay retry — recording the event as processed here would consume the id and
  // the retry would be discarded as a duplicate, losing a real payment.
  let fact;
  try {
    fact = await checkPayment({ transactionId, apiKey, siteId });
  } catch (err) {
    if (err instanceof CinetPayUnavailableError) {
      console.error('[webhook:cinetpay] check endpoint unavailable:', err.message);
      return NextResponse.json({ error: 'verification_unavailable' }, { status: 503 });
    }
    throw err;
  }

  if (fact.status !== 'accepted') {
    // Recorded, not granted. A pending payment will notify again when it settles, and that
    // later notify carries the same transaction id — so it must not be marked processed
    // now. We record it as a distinct event id so the audit trail keeps both.
    await recordNonGrant(transactionId, fact.status, rawBody);
    return NextResponse.json({ status: 'recorded', payment: fact.status }, { status: 200 });
  }

  const outcome = await ingestWebhook({
    gateway: 'cinetpay',
    gatewayEventId: transactionId,
    type: 'payment.accepted',
    payload: { transactionId, fact, form: Object.fromEntries(form) },
    apply: async (tx) => {
      const meta = readMetadata(form.get('cpm_custom'));
      if (!meta.keycloakSub || !meta.productSlug || !meta.planSlug) {
        throw new Error(`transaction ${transactionId} lacks the metadata needed to identify a customer`);
      }
      await grantEntitlement(tx, {
        keycloakSub: meta.keycloakSub,
        email: meta.email ?? '',
        productSlug: meta.productSlug,
        planSlug: meta.planSlug,
        seats: meta.seats ?? 1,
        expiresAt: meta.expiresAt ? new Date(meta.expiresAt) : null,
      });
      await tx.execute(sql`
        UPDATE orders SET status = 'paid'
        WHERE gateway = 'cinetpay' AND gateway_order_id = ${transactionId}
      `);
    },
  });

  if (outcome.status === 'failed') {
    console.error('[webhook:cinetpay] dead-lettered', transactionId, outcome.error);
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }
  return NextResponse.json({ status: outcome.status }, { status: 200 });
}

/** Refused and pending notifies are auditable facts, but they never consume the grant id. */
async function recordNonGrant(transactionId: string, status: string, rawBody: string) {
  const { getDb } = await import('../../../../db/client');
  try {
    await getDb().execute(sql`
      INSERT INTO webhook_events (gateway, gateway_event_id, type, payload, processed_at)
      VALUES ('cinetpay', ${`${transactionId}:${status}`}, ${`payment.${status}`},
              ${JSON.stringify({ transactionId, status, raw: rawBody.slice(0, 2000) })}::jsonb, now())
      ON CONFLICT (gateway, gateway_event_id) DO NOTHING
    `);
  } catch (err) {
    console.error('[webhook:cinetpay] could not record non-grant:', err);
  }
}

/** `cpm_custom` is our own JSON, set at session creation. Parsed defensively regardless. */
function readMetadata(raw: string | null) {
  if (!raw) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  const c = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : undefined);
  const n = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : undefined);
  return {
    keycloakSub: s('keycloak_sub'),
    email: s('email'),
    productSlug: s('product_slug'),
    planSlug: s('plan_slug'),
    seats: n('seats'),
    expiresAt: s('expires_at'),
  };
}
