import { describe, it, expect } from 'vitest';
import { resolveEntitlement, GRACE_SECONDS, type EntitlementRow } from '../../src/lib/entitlements/resolve';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const HOUR = 3_600_000;

const row = (over: Partial<EntitlementRow> = {}): EntitlementRow => ({
  product_slug: 'navimed',
  plan_slug: 'clinique',
  status: 'active',
  seats: 15,
  expires_at: new Date(NOW + 30 * 24 * HOUR).toISOString(),
  revocation_reason: null,
  revoked_at: null,
  features: ['barika_ehr', 'carnet_patient'],
  ...over,
});

const resolve = (r: EntitlementRow | null, nowMs = NOW) =>
  resolveEntitlement({ customerId: 'sub-1', product: 'navimed', row: r, nowMs });

describe('active entitlements', () => {
  it('returns active and is edge-cacheable', () => {
    const res = resolve(row());
    expect(res.body.status).toBe('active');
    expect(res.body.seats).toBe(15);
    expect(res.body.features).toEqual(['barika_ehr', 'carnet_patient']);
    expect(res.cacheControl).toContain('max-age=60');
    expect(res.bypassCache).toBe(false);
  });

  it('treats a null expiry as perpetual, not as expired', () => {
    expect(resolve(row({ expires_at: null })).body.status).toBe('active');
  });

  it('carries an issued_at so consumers can reject a stale replay', () => {
    expect(resolve(row()).body.issued_at).toBe(new Date(NOW).toISOString());
  });
});

describe('no entitlement', () => {
  it('404s rather than returning a 200 that says no', () => {
    // "No such entitlement" and "an entitlement that says no" are different facts.
    const res = resolve(null);
    expect(res.httpStatus).toBe(404);
    expect(res.body.status).toBe('none');
    expect(res.cacheControl).toContain('no-store');
  });
});

describe('billing-class lapse — fails OPEN', () => {
  const lapsed = row({
    status: 'suspended', revocation_reason: 'billing_lapse',
    revoked_at: new Date(NOW - HOUR).toISOString(),
  });

  it('grants grace one hour after a failed charge', () => {
    const res = resolve(lapsed);
    expect(res.body.status).toBe('grace');
    expect(res.bypassCache).toBe(false);
  });

  it('still grants grace at 71 hours', () => {
    // The clinic keeps its patient records over a weekend. This is the whole point.
    expect(resolve(lapsed, NOW + 70 * HOUR).body.status).toBe('grace');
  });

  it('expires once past 72 hours', () => {
    expect(resolve(lapsed, NOW + GRACE_SECONDS * 1000 + HOUR).body.status).toBe('expired');
  });

  it('reports when grace runs out', () => {
    expect(resolve(lapsed).body.grace_until)
      .toBe(new Date(NOW - HOUR + GRACE_SECONDS * 1000).toISOString());
  });

  it.each(['billing_lapse', 'expiry', 'downgrade'] as const)('%s is billing class', (reason) => {
    const res = resolve(row({ status: 'suspended', revocation_reason: reason, revoked_at: new Date(NOW).toISOString() }));
    expect(res.body.status).toBe('grace');
    expect(res.body.revocation_class).toBeUndefined();
  });
});

describe('security-class revocation — fails CLOSED', () => {
  it.each(['security', 'fraud', 'chargeback', 'admin_for_cause'] as const)(
    '%s revokes immediately with no grace',
    (reason) => {
      const res = resolve(row({
        status: 'revoked', revocation_reason: reason, revoked_at: new Date(NOW - 60_000).toISOString(),
      }));
      expect(res.body.status).toBe('revoked');
      expect(res.body.revocation_class).toBe('security');
      expect(res.body.grace_until).toBeUndefined();
    }
  );

  it('is never cacheable', () => {
    const res = resolve(row({ status: 'revoked', revocation_reason: 'fraud' }));
    expect(res.cacheControl).toBe('no-store');
    expect(res.bypassCache).toBe(true);
  });

  it('outranks an unexpired billing period', () => {
    // A compromised account with a paid-up year must still lose access in seconds.
    const res = resolve(row({
      status: 'active',
      revocation_reason: 'security',
      expires_at: new Date(NOW + 365 * 24 * HOUR).toISOString(),
    }));
    expect(res.body.status).toBe('revoked');
  });

  it('never reports grace for a security reason even one second in', () => {
    const res = resolve(row({ status: 'revoked', revocation_reason: 'chargeback', revoked_at: new Date(NOW - 1000).toISOString() }));
    expect(res.body.status).not.toBe('grace');
  });
});

describe('expiry by period', () => {
  it('enters grace when the period ends without an explicit revocation', () => {
    const res = resolve(row({ expires_at: new Date(NOW - HOUR).toISOString() }));
    expect(res.body.status).toBe('grace');
  });

  it('expires 72 hours after the period ended', () => {
    const res = resolve(row({ expires_at: new Date(NOW - GRACE_SECONDS * 1000 - HOUR).toISOString() }));
    expect(res.body.status).toBe('expired');
  });

  it('tolerates an unparseable expiry rather than throwing', () => {
    const res = resolve(row({ expires_at: 'not-a-date' }));
    expect(['active', 'grace', 'expired']).toContain(res.body.status);
  });
});
