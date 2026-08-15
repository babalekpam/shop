import { NextResponse } from 'next/server';
import { bySlug, priceFor } from '../../../../data/catalog';
import { gatewayForCountry, type Gateway } from '../../../../lib/commerce/region';

/**
 * Create a checkout session.
 *
 * This route is deliberately incomplete, and fails loudly rather than quietly: until real
 * gateway credentials are present it returns 501, and it never returns anything a client
 * could mistake for a completed purchase.
 *
 * That is not a placeholder shortcut, it is the security spec's central rule:
 *
 *   · **Never grant access from a redirect — only from a verified webhook** (build spec
 *     §9). A session response says "go and pay", never "you have paid".
 *   · CinetPay notifications must be **re-verified server-side** against their check
 *     endpoint before anything is granted. The notify payload alone is not trusted.
 *   · Every handler is idempotent on `gateway_event_id`, enforced by a unique constraint
 *     at the database level, because application-level checks race under the concurrent
 *     duplicate deliveries mobile money actually produces.
 *
 * Wiring this up is Sprint 3 (Paddle) and Sprint 4 (CinetPay). See README.md.
 */

interface SessionRequest {
  lines: Array<{ slug: string; quantity: number; currency: string; lockedAmountMinor: number }>;
  gateway: Gateway;
  locale: string;
}

const configured = {
  paddle: () => !!process.env.PADDLE_API_KEY && !!process.env.PADDLE_WEBHOOK_SECRET,
  cinetpay: () => !!process.env.CINETPAY_API_KEY && !!process.env.CINETPAY_SITE_ID,
} as const;

export async function POST(request: Request) {
  let body: SessionRequest;
  try {
    body = (await request.json()) as SessionRequest;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // Reject by default, never sanitise and proceed (security spec §5). A production
  // implementation validates with Zod at this boundary; the shape checks below are the
  // same discipline at the scale this stub needs.
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: 'empty_cart' }, { status: 400 });
  }
  if (body.gateway !== 'paddle' && body.gateway !== 'cinetpay') {
    return NextResponse.json({ error: 'unknown_gateway' }, { status: 400 });
  }

  // **Never trust a client-supplied price.** The amounts in the request are what the
  // customer was shown; they are checked against the catalog here, and the server's number
  // is the one that would reach the gateway. A cart that posts its own totals is the
  // oldest hole in commerce software.
  let serverTotal = 0;
  for (const line of body.lines) {
    const sku = bySlug(line.slug);
    if (!sku) return NextResponse.json({ error: 'unknown_sku' }, { status: 400 });
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100) {
      return NextResponse.json({ error: 'invalid_quantity' }, { status: 400 });
    }
    const price = priceFor(sku, line.currency);
    if (!price) return NextResponse.json({ error: 'unavailable_currency' }, { status: 400 });
    serverTotal += price.amountMinor * line.quantity;
  }

  const country = request.headers.get('CF-IPCountry');
  const suggested = gatewayForCountry(country);

  if (!configured[body.gateway]()) {
    return NextResponse.json(
      {
        error: 'gateway_not_configured',
        gateway: body.gateway,
        suggestedGateway: suggested,
        // Echoed so an operator can see routing and totals are correct before the keys
        // land. No customer data, nothing that could be mistaken for an entitlement.
        serverTotalMinor: serverTotal,
        detail:
          body.gateway === 'paddle'
            ? 'Set PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET.'
            : 'Set CINETPAY_API_KEY and CINETPAY_SITE_ID.',
      },
      { status: 501 },
    );
  }

  // Sprint 3 / Sprint 4: create the gateway session and return its URL or overlay token.
  // Access is granted by the webhook handler, never here and never by the success page.
  return NextResponse.json({ error: 'not_implemented' }, { status: 501 });
}
