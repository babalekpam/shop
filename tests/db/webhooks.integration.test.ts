/**
 * Integration tests against a real PostgreSQL.
 *
 * These are the tests that matter for money and access, because the properties being
 * checked — a unique constraint holding under concurrent inserts, a transaction rolling
 * back cleanly — are properties of the database, not of TypeScript. A mock cannot fail
 * the way Postgres fails.
 *
 * Skipped unless TEST_DATABASE_URL is set, so `npm test` still runs anywhere:
 *   TEST_DATABASE_URL=postgres://... npm test
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';

const URL_ = process.env.TEST_DATABASE_URL;
const run = URL_ ? describe : describe.skip;

run('webhook ingestion against real Postgres', () => {
  let getDb: typeof import('../../src/db/client')['getDb'];
  let closeDb: typeof import('../../src/db/client')['closeDb'];
  let rows: typeof import('../../src/db/client')['rows'];
  let ingestWebhook: typeof import('../../src/lib/gateway/ingest')['ingestWebhook'];
  let grantEntitlement: typeof import('../../src/lib/commerce/fulfil')['grantEntitlement'];
  let revokeEntitlement: typeof import('../../src/lib/commerce/fulfil')['revokeEntitlement'];

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    ({ getDb, closeDb, rows } = await import('../../src/db/client'));
    ({ ingestWebhook } = await import('../../src/lib/gateway/ingest'));
    ({ grantEntitlement, revokeEntitlement } = await import('../../src/lib/commerce/fulfil'));
    const migration = readFileSync('src/db/migrations/0001_init.sql', 'utf8');
    await getDb().execute(sql.raw(migration));
  });

  afterAll(async () => { await closeDb(); });

  beforeEach(async () => {
    await getDb().execute(sql`
      TRUNCATE webhook_events, entitlements, order_items, orders, subscriptions,
               license_keys, download_grants, service_bookings, customers RESTART IDENTITY CASCADE
    `);
  });

  const grantEvent = (eventId: string, sub = 'kc-alice') => ({
    gateway: 'paddle' as const,
    gatewayEventId: eventId,
    type: 'transaction.completed',
    payload: { event_id: eventId },
    apply: async (tx: Parameters<Parameters<typeof ingestWebhook>[0]['apply']>[0]) => {
      await grantEntitlement(tx, {
        keycloakSub: sub, email: `${sub}@example.com`,
        productSlug: 'navimed', planSlug: 'clinique', seats: 15,
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      });
    },
  });

  const countEntitlements = async () =>
    (await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM entitlements`))[0]!.n;

  it('applies a first delivery', async () => {
    const out = await ingestWebhook(grantEvent('evt_1'));
    expect(out.status).toBe('applied');
    expect(await countEntitlements()).toBe(1);
  });

  it('treats a redelivery as a duplicate and does not grant twice', async () => {
    await ingestWebhook(grantEvent('evt_1'));
    const second = await ingestWebhook(grantEvent('evt_1'));
    expect(second.status).toBe('duplicate');
    expect(await countEntitlements()).toBe(1);
  });

  it('survives TEN concurrent identical deliveries with exactly one apply', async () => {
    // This is the race application-level "have I seen this id?" logic loses, and the
    // reason the unique constraint is in the database.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => ingestWebhook(grantEvent('evt_race')))
    );
    expect(results.filter(r => r.status === 'applied')).toHaveLength(1);
    expect(results.filter(r => r.status === 'duplicate')).toHaveLength(9);
    expect(await countEntitlements()).toBe(1);
  });

  it('records every duplicate delivery in the attempts counter', async () => {
    await Promise.all(Array.from({ length: 5 }, () => ingestWebhook(grantEvent('evt_a'))));
    const found = await rows<{ attempts: number }>(
      sql`SELECT attempts FROM webhook_events WHERE gateway_event_id = 'evt_a'`);
    expect(found[0]!.attempts).toBe(5);
  });

  it('rolls back completely when apply throws — no partial grant', async () => {
    const out = await ingestWebhook({
      ...grantEvent('evt_fail'),
      apply: async (tx) => {
        await grantEntitlement(tx, {
          keycloakSub: 'kc-bob', email: 'bob@example.com',
          productSlug: 'navimed', planSlug: 'clinique', expiresAt: null,
        });
        throw new Error('gateway payload was incomplete');
      },
    });
    expect(out.status).toBe('failed');
    expect(await countEntitlements()).toBe(0);
  });

  it('RETRIES a previously failed event rather than calling it a duplicate', async () => {
    // The bug this guards: if "seen this id" meant duplicate, the gateway's retry — the
    // mechanism designed to recover a half-failed delivery — would be discarded, and the
    // customer would have paid for access they never got.
    const failing = {
      ...grantEvent('evt_retry'),
      apply: async () => { throw new Error('transient'); },
    };
    const first = await ingestWebhook(failing);
    expect(first.status).toBe('failed');

    const second = await ingestWebhook(grantEvent('evt_retry'));
    expect(second.status).toBe('applied');
    expect(await countEntitlements()).toBe(1);
  });

  it('lists a failed event in the dead-letter view, and clears it once applied', async () => {
    const { deadLetters } = await import('../../src/lib/gateway/ingest');
    await ingestWebhook({ ...grantEvent('evt_dl'), apply: async () => { throw new Error('boom'); } });
    expect((await deadLetters('paddle')).length).toBe(1);
    await ingestWebhook(grantEvent('evt_dl'));
    expect((await deadLetters('paddle')).length).toBe(0);
  });

  it('keeps distinct events distinct', async () => {
    await ingestWebhook(grantEvent('evt_1', 'kc-alice'));
    await ingestWebhook(grantEvent('evt_2', 'kc-bob'));
    expect(await countEntitlements()).toBe(2);
  });

  it('renews rather than duplicating an entitlement for the same customer and product', async () => {
    await ingestWebhook(grantEvent('evt_1', 'kc-alice'));
    await ingestWebhook(grantEvent('evt_2', 'kc-alice'));
    expect(await countEntitlements()).toBe(1);
  });
});

run('entitlement grant and revoke semantics', () => {
  let getDb: typeof import('../../src/db/client')['getDb'];
  let closeDb: typeof import('../../src/db/client')['closeDb'];
  let rows: typeof import('../../src/db/client')['rows'];
  let grantEntitlement: typeof import('../../src/lib/commerce/fulfil')['grantEntitlement'];
  let revokeEntitlement: typeof import('../../src/lib/commerce/fulfil')['revokeEntitlement'];
  let SecurityRevocationError: typeof import('../../src/lib/commerce/fulfil')['SecurityRevocationError'];

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    ({ getDb, closeDb, rows } = await import('../../src/db/client'));
    ({ grantEntitlement, revokeEntitlement, SecurityRevocationError } =
      await import('../../src/lib/commerce/fulfil'));
    await getDb().execute(sql.raw(readFileSync('src/db/migrations/0001_init.sql', 'utf8')));
  });
  afterAll(async () => { await closeDb(); });
  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE entitlements, customers RESTART IDENTITY CASCADE`);
  });

  const grant = (sub: string) => getDb().transaction(async (tx) =>
    grantEntitlement(tx, {
      keycloakSub: sub, email: `${sub}@x.com`,
      productSlug: 'navimed', planSlug: 'clinique', expiresAt: null,
    }));

  const readRow = async (sub: string) =>
    (await rows<{ status: string; revocation_reason: string | null }>(sql`
      SELECT e.status, e.revocation_reason FROM entitlements e
      JOIN customers c ON c.id = e.customer_id WHERE c.keycloak_sub = ${sub}`))[0];

  it('a billing lapse suspends and can be restored by paying', async () => {
    await grant('kc-1');
    await getDb().transaction(async (tx) =>
      revokeEntitlement(tx, { keycloakSub: 'kc-1', productSlug: 'navimed', reason: 'billing_lapse' }));
    expect((await readRow('kc-1'))!.status).toBe('suspended');

    await grant('kc-1');
    const after = await readRow('kc-1');
    expect(after!.status).toBe('active');
    expect(after!.revocation_reason).toBeNull();
  });

  it('a fraud revocation is NOT undone by a subsequent payment', async () => {
    // Paying does not undo a fraud finding. If this ever regresses, a compromised account
    // buys its way back in for the price of one subscription.
    await grant('kc-2');
    await getDb().transaction(async (tx) =>
      revokeEntitlement(tx, { keycloakSub: 'kc-2', productSlug: 'navimed', reason: 'fraud' }));

    await expect(grant('kc-2')).rejects.toBeInstanceOf(SecurityRevocationError);
    expect((await readRow('kc-2'))!.status).toBe('revoked');
  });

  it('the database rejects an invented revocation reason', async () => {
    await grant('kc-3');
    await expect(getDb().execute(sql`
      UPDATE entitlements SET revocation_reason = 'because_i_said_so'
    `)).rejects.toThrow();
  });

  it('the database rejects a second entitlement for one customer and product', async () => {
    await grant('kc-4');
    await expect(getDb().execute(sql`
      INSERT INTO entitlements (customer_id, product_slug, plan_slug, status)
      SELECT id, 'navimed', 'cabinet', 'active' FROM customers WHERE keycloak_sub = 'kc-4'
    `)).rejects.toThrow();
  });
});
