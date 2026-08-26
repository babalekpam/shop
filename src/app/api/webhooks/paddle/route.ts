/**
 * Paddle webhooks — where international purchases become access.
 *
 * The order of operations is the security requirement, not a style choice:
 *   1. read the RAW body (re-serialising parsed JSON breaks the signature)
 *   2. verify the signature and the timestamp — drop and alert on failure
 *   3. only then parse
 *   4. apply inside a transaction keyed on the gateway's event id
 *
 * A 200 is returned for a duplicate, because it is not an error and the gateway should
 * stop retrying. A 5xx is returned for a failure, because it should.
 */
import { NextResponse } from 'next/server';
import { verifyPaddle } from '../../../../lib/gateway/signature';
import { ingestWebhook } from '../../../../lib/gateway/ingest';
import { grantEntitlement, revokeEntitlement } from '../../../../lib/commerce/fulfil';
import { isDatabaseConfigured } from '../../../../db/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret || !isDatabaseConfigured()) {
    // Never 200 an event we cannot durably record — the gateway would stop retrying and
    // the purchase would be lost.
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  const verdict = verifyPaddle({
    rawBody,
    header: request.headers.get('paddle-signature'),
    secret,
  });

  if (!verdict.valid) {
    console.warn('[webhook:paddle] rejected:', verdict.reason);
    // 400, not 500: the delivery is bad and retrying it will not help. The alert is the
    // log line above; a repeated bad signature is an attack, not a bug.
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }

  let event: PaddleEvent;
  try {
    event = JSON.parse(rawBody) as PaddleEvent;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!event.event_id || !event.event_type) {
    return NextResponse.json({ error: 'missing_event_id' }, { status: 400 });
  }

  const outcome = await ingestWebhook({
    gateway: 'paddle',
    gatewayEventId: event.event_id,
    type: event.event_type,
    payload: event,
    apply: async (tx) => {
      const d = event.data ?? {};
      const sub = readCustomFields(d);
      if (!sub.keycloakSub || !sub.productSlug || !sub.planSlug) {
        throw new Error(`event ${event.event_id} lacks the custom data needed to identify a customer`);
      }

      switch (event.event_type) {
        case 'transaction.completed':
        case 'subscription.created':
        case 'subscription.updated':
          await grantEntitlement(tx, {
            keycloakSub: sub.keycloakSub,
            email: sub.email ?? '',
            productSlug: sub.productSlug,
            planSlug: sub.planSlug,
            seats: sub.seats ?? 1,
            expiresAt: d.current_billing_period?.ends_at
              ? new Date(d.current_billing_period.ends_at) : null,
          });
          break;

        case 'subscription.canceled':
        case 'subscription.past_due':
          // Billing class: consumers may honour last-known-good for 72h. A clinic does not
          // lose patient records because a card expired on a Saturday.
          await revokeEntitlement(tx, {
            keycloakSub: sub.keycloakSub,
            productSlug: sub.productSlug,
            reason: event.event_type === 'subscription.past_due' ? 'billing_lapse' : 'expiry',
          });
          break;

        case 'adjustment.created':
          // A chargeback is a security-class signal, not a billing one: it fails closed
          // immediately and a later payment does not silently restore access.
          if (d.action === 'chargeback') {
            await revokeEntitlement(tx, {
              keycloakSub: sub.keycloakSub,
              productSlug: sub.productSlug,
              reason: 'chargeback',
            });
          }
          break;

        default:
          // Unrecognised events are recorded and acknowledged, not applied. Paddle adds
          // event types; that must not become a 500 loop.
          break;
      }
    },
  });

  if (outcome.status === 'failed') {
    console.error('[webhook:paddle] dead-lettered', event.event_id, outcome.error);
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }
  return NextResponse.json({ status: outcome.status }, { status: 200 });
}

interface PaddleEvent {
  event_id?: string;
  event_type?: string;
  data?: {
    action?: string;
    custom_data?: Record<string, unknown>;
    current_billing_period?: { ends_at?: string };
  };
}

/**
 * Paddle carries our identifiers in `custom_data`, set when the checkout session is
 * created. Reading them defensively matters: this is attacker-adjacent data in the sense
 * that a misconfigured checkout can produce it, and a missing field must fail the event
 * rather than grant a partial entitlement.
 */
function readCustomFields(d: NonNullable<PaddleEvent['data']>) {
  const c = d.custom_data ?? {};
  const s = (k: string): string | undefined => (typeof c[k] === 'string' ? (c[k] as string) : undefined);
  const n = (k: string): number | undefined => (typeof c[k] === 'number' ? (c[k] as number) : undefined);
  return {
    keycloakSub: s('keycloak_sub'),
    email: s('email'),
    productSlug: s('product_slug'),
    planSlug: s('plan_slug'),
    seats: n('seats'),
  };
}
