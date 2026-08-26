/**
 * Fulfilment — the only place access is granted.
 *
 * Every function here takes a transaction handle and is called exclusively from
 * `ingestWebhook`'s apply callback. That is the shape build spec §9 requires: access
 * follows a *verified webhook*, never a redirect, and it is applied atomically with the
 * event row that justifies it.
 *
 * Nothing here is exported to a route that a browser can reach.
 */
import { sql } from 'drizzle-orm';
import type { getDb } from '../../db/client';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

export interface GrantInput {
  keycloakSub: string;
  email: string;
  productSlug: string;
  planSlug: string;
  seats?: number;
  /** Null means perpetual — a download purchase rather than a subscription. */
  expiresAt: Date | null;
  sourceSubscriptionId?: string | null;
}

/**
 * Grants or extends an entitlement.
 *
 * Upsert, not insert: the unique index on (customer_id, product_slug) means a renewal
 * updates the existing row rather than creating a second one. Two rows would make "is this
 * customer entitled?" depend on which the reader saw first.
 *
 * Granting also clears any prior revocation, which is correct — a customer who lapsed and
 * came back is entitled again — with one exception enforced by the caller: a `security`
 * class revocation is never cleared by a payment. Paying does not undo a fraud finding.
 */
export async function grantEntitlement(tx: Tx, input: GrantInput): Promise<void> {
  const customerId = await upsertCustomer(tx, input.keycloakSub, input.email);

  const blocked = await firstRow<{ revocation_reason: string | null }>(await tx.execute(sql`
    SELECT revocation_reason FROM entitlements
    WHERE customer_id = ${customerId}::uuid AND product_slug = ${input.productSlug}
  `));
  if (blocked && isSecurityClass(blocked.revocation_reason)) {
    throw new SecurityRevocationError(input.productSlug);
  }

  await tx.execute(sql`
    INSERT INTO entitlements
      (customer_id, product_slug, plan_slug, status, seats, expires_at, source_subscription_id, updated_at)
    VALUES (${customerId}::uuid, ${input.productSlug}, ${input.planSlug}, 'active',
            ${input.seats ?? 1}, ${input.expiresAt}, ${input.sourceSubscriptionId ?? null}, now())
    ON CONFLICT (customer_id, product_slug) DO UPDATE SET
      plan_slug = EXCLUDED.plan_slug,
      status = 'active',
      seats = EXCLUDED.seats,
      expires_at = EXCLUDED.expires_at,
      source_subscription_id = COALESCE(EXCLUDED.source_subscription_id, entitlements.source_subscription_id),
      revocation_reason = NULL,
      revoked_at = NULL,
      updated_at = now()
  `);
}

/** Ends access. The reason is not cosmetic — it decides whether consumers may cache. */
export async function revokeEntitlement(tx: Tx, opts: {
  keycloakSub: string;
  productSlug: string;
  reason: 'billing_lapse' | 'expiry' | 'downgrade' | 'security' | 'fraud' | 'chargeback' | 'admin_for_cause';
}): Promise<void> {
  await tx.execute(sql`
    UPDATE entitlements SET
      status = ${isSecurityClass(opts.reason) ? 'revoked' : 'suspended'},
      revocation_reason = ${opts.reason},
      revoked_at = now(),
      updated_at = now()
    WHERE product_slug = ${opts.productSlug}
      AND customer_id = (SELECT id FROM customers WHERE keycloak_sub = ${opts.keycloakSub})
  `);
}

/**
 * Security-class revocations fail closed immediately and bypass caching; billing-class
 * ones fail open for 72 hours (security spec §7). A compromised account must lose access
 * in seconds — but a clinic must not lose patient records over a failed charge.
 */
export function isSecurityClass(reason: string | null | undefined): boolean {
  return reason === 'security' || reason === 'fraud'
    || reason === 'chargeback' || reason === 'admin_for_cause';
}

export class SecurityRevocationError extends Error {
  readonly code = 'SECURITY_REVOCATION_STANDS';
  constructor(productSlug: string) {
    super(`entitlement for ${productSlug} is revoked for cause; a payment does not restore it`);
    this.name = 'SecurityRevocationError';
  }
}

async function upsertCustomer(tx: Tx, keycloakSub: string, email: string): Promise<string> {
  const res = await tx.execute(sql`
    INSERT INTO customers (keycloak_sub, email)
    VALUES (${keycloakSub}, ${email})
    ON CONFLICT (keycloak_sub) DO UPDATE SET email = EXCLUDED.email
    RETURNING id
  `);
  const row = firstRow<{ id: string }>(res);
  if (!row) throw new Error('customer upsert returned no row');
  return row.id;
}

function firstRow<T>(res: unknown): T | undefined {
  if (Array.isArray(res)) return res[0] as T | undefined;
  const maybe = res as { rows?: unknown[] };
  return Array.isArray(maybe.rows) ? (maybe.rows[0] as T | undefined) : undefined;
}
