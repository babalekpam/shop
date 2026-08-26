/**
 * Entitlement resolution — the fail-open / fail-closed split.
 *
 * The build spec (§8) says the entitlement API fails open for 72 hours during an outage.
 * The security spec (§7) corrects that: it is right for availability and wrong as an
 * unqualified rule for security. This function is where the correction lives.
 *
 *   | Reason access ended                          | Behaviour                    |
 *   |----------------------------------------------|------------------------------|
 *   | Billing lapse, expiry, downgrade              | fail open, 72h grace         |
 *   | Security, fraud, chargeback, admin for cause  | fail closed, immediately     |
 *
 * A clinic must not lose patient records because a card expired on a Saturday. A
 * compromised account must lose access in seconds, not days. Encoding both in one place
 * means no consumer has to rediscover the distinction.
 *
 * Pure — no database, no clock of its own — so every branch is testable.
 */
import { isSecurityClass } from '../commerce/fulfil';
import type { RevocationReason } from '../../db/schema';

export const GRACE_SECONDS = 72 * 60 * 60;
export const EDGE_CACHE_SECONDS = 60;

export interface EntitlementRow {
  product_slug: string;
  plan_slug: string;
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  seats: number;
  expires_at: string | Date | null;
  revocation_reason: RevocationReason | null;
  revoked_at: string | Date | null;
  features?: string[] | null;
}

export interface Resolution {
  body: {
    customer_id: string;
    product: string;
    status: 'active' | 'grace' | 'revoked' | 'expired' | 'none';
    plan: string | null;
    seats: number | null;
    expires_at: string | null;
    features: string[];
    /** Present only while a billing-class lapse is still inside its grace window. */
    grace_until?: string;
    /** Present only for security-class revocations, so consumers can act on the class. */
    revocation_class?: 'security';
    issued_at: string;
  };
  /** What the consumer and the edge are allowed to do with this answer. */
  cacheControl: string;
  /** Security-class answers must never be served from a cache. */
  bypassCache: boolean;
  httpStatus: 200 | 404;
}

export function resolveEntitlement(opts: {
  customerId: string;
  product: string;
  row: EntitlementRow | null;
  nowMs: number;
}): Resolution {
  const { customerId, product, row, nowMs } = opts;
  const issuedAt = new Date(nowMs).toISOString();

  const base = {
    customer_id: customerId,
    product,
    plan: null as string | null,
    seats: null as number | null,
    expires_at: null as string | null,
    features: [] as string[],
    issued_at: issuedAt,
  };

  if (!row) {
    // 404, not 200-with-none: "no such entitlement" and "an entitlement that says no" are
    // different facts, and a consumer that conflates them caches the wrong one.
    return {
      body: { ...base, status: 'none' },
      cacheControl: 'private, max-age=0, no-store',
      bypassCache: true,
      httpStatus: 404,
    };
  }

  const filled = {
    ...base,
    plan: row.plan_slug,
    seats: row.seats,
    expires_at: toIso(row.expires_at),
    features: row.features ?? [],
  };

  // Security class first: it outranks everything, including an unexpired period.
  if (isSecurityClass(row.revocation_reason)) {
    return {
      body: { ...filled, status: 'revoked', revocation_class: 'security' },
      cacheControl: 'no-store',
      bypassCache: true,
      httpStatus: 200,
    };
  }

  const expiresMs = toMs(row.expires_at);
  const activeByStatus = row.status === 'active';
  const withinPeriod = expiresMs === null || expiresMs > nowMs;

  if (activeByStatus && withinPeriod) {
    return {
      body: { ...filled, status: 'active' },
      cacheControl: `public, max-age=${EDGE_CACHE_SECONDS}, stale-while-revalidate=${EDGE_CACHE_SECONDS}`,
      bypassCache: false,
      httpStatus: 200,
    };
  }

  // Billing class, or a lapsed period. Grace runs from when access actually ended.
  const endedMs = toMs(row.revoked_at) ?? expiresMs ?? nowMs;
  const graceEndsMs = endedMs + GRACE_SECONDS * 1000;

  if (nowMs < graceEndsMs) {
    return {
      body: { ...filled, status: 'grace', grace_until: new Date(graceEndsMs).toISOString() },
      // Short cache: the grace window is ticking and a stale "grace" must not outlive it.
      cacheControl: `private, max-age=${EDGE_CACHE_SECONDS}`,
      bypassCache: false,
      httpStatus: 200,
    };
  }

  return {
    body: { ...filled, status: 'expired' },
    cacheControl: `private, max-age=${EDGE_CACHE_SECONDS}`,
    bypassCache: false,
    httpStatus: 200,
  };
}

function toMs(v: string | Date | null | undefined): number | null {
  if (!v) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}
function toIso(v: string | Date | null | undefined): string | null {
  const ms = toMs(v);
  return ms === null ? null : new Date(ms).toISOString();
}
