/**
 * GET /api/v1/entitlements?product=navimed
 *
 * The contract every ARGILETTE product depends on (build spec §8). Treated as public from
 * day one: versioned, documented, never breaking.
 *
 *   Authorization: Bearer <per-product service token>
 *   X-Customer-Id: <keycloak sub>
 *
 * Security spec §7 requirements implemented here: per-product tokens checked against that
 * product only, responses signed with a detached JWS so authenticity survives transport,
 * every lookup logged with token identity, and the fail-open/fail-closed split applied
 * through `resolveEntitlement`.
 */
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { verifyServiceToken } from '../../../../lib/entitlements/tokens';
import { canSign, signDetached } from '../../../../lib/entitlements/sign';
import { resolveEntitlement, type EntitlementRow } from '../../../../lib/entitlements/resolve';
import { isDatabaseConfigured, rows } from '../../../../db/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const product = url.searchParams.get('product');
  const customerId = request.headers.get('x-customer-id');

  if (!product) return problem(400, 'missing_product');
  if (!customerId) return problem(400, 'missing_customer_id');

  // Auth before anything else, and the same response shape for every auth failure — a
  // distinct 404 for "unknown product" would let an unauthenticated caller enumerate the
  // product catalogue by watching status codes.
  const verdict = verifyServiceToken(request.headers.get('authorization'), product);
  if (!verdict.ok) {
    if (verdict.reason === 'not_configured') return problem(503, 'not_configured');
    console.warn('[entitlements] auth failed:', verdict.reason, 'product:', product);
    return problem(401, 'unauthorized');
  }

  if (!isDatabaseConfigured()) return problem(503, 'not_configured');
  // An unsigned response is not an acceptable degraded mode: a consumer that accepts one
  // has no way to tell it from a forgery.
  if (!canSign()) return problem(503, 'signing_unavailable');

  let row: EntitlementRow | null = null;
  try {
    const found = await rows<EntitlementRow>(sql`
      SELECT e.product_slug, e.plan_slug, e.status, e.seats, e.expires_at,
             e.revocation_reason, e.revoked_at,
             COALESCE(p.features, '[]'::jsonb) AS features
      FROM entitlements e
      JOIN customers c ON c.id = e.customer_id
      LEFT JOIN products pr ON pr.slug = e.product_slug
      LEFT JOIN plans p ON p.product_id = pr.id AND p.slug = e.plan_slug
      WHERE c.keycloak_sub = ${customerId} AND e.product_slug = ${product}
      LIMIT 1
    `);
    row = found[0] ?? null;
  } catch (err) {
    console.error('[entitlements] lookup failed:', err instanceof Error ? err.message : err);
    // 503 so the consumer applies its own last-known-good policy. Never 200 with a
    // fabricated answer — that is the one failure mode that silently grants access.
    return problem(503, 'lookup_failed');
  }

  const nowMs = Date.now();
  const resolution = resolveEntitlement({ customerId, product, row, nowMs });

  // Serialise once: the signature covers these exact bytes, so the body must not be
  // re-serialised on the way out.
  const payload = JSON.stringify(resolution.body);
  const signature = signDetached(payload, nowMs);

  // Every lookup logged with token identity, product and customer (security spec §7).
  // The token itself is never logged — the product it authenticated is the identity.
  console.info('[entitlements]', JSON.stringify({
    product, customer: customerId, status: resolution.body.status, token_product: verdict.product,
  }));

  return new NextResponse(payload, {
    status: resolution.httpStatus,
    headers: {
      'content-type': 'application/json',
      'cache-control': resolution.cacheControl,
      'x-entitlement-signature': signature,
      ...(resolution.bypassCache ? { 'x-entitlement-bypass-cache': '1' } : {}),
      ...(resolution.body.revocation_class ? { 'x-entitlement-revocation-class': 'security' } : {}),
    },
  });
}

function problem(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
}
