import { describe, it, expect } from 'vitest';
import { issueKey, generateKeyString, verifyKey, hashKey, canActivate, type KeyRecord } from '../../src/lib/licensing/keys';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const HOUR = 3_600_000;

describe('issueKey', () => {
  it('produces a product-prefixed, grouped key', () => {
    const k = issueKey('navimed');
    expect(k.plaintext).toMatch(/^NAVI(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
    expect(k.prefix).toBe('NAVI');
  });

  it('never reuses a key across 20,000 samples', () => {
    // Exercises the generator, not the KDF — 160 bits of CSPRNG is where uniqueness
    // actually comes from, and testing it through scrypt would cap the sample at a
    // handful without testing anything more.
    const n = 20_000;
    const seen = new Set(Array.from({ length: n }, () => generateKeyString('navimed')));
    expect(seen.size).toBe(n);
  });

  it('uses a fresh salt each time, so identical keys would not share a hash', () => {
    const a = issueKey('navimed'); const b = issueKey('navimed');
    expect(a.salt).not.toBe(b.salt);
  });

  it('excludes characters that are ambiguous when read aloud', () => {
    // I/L/O/U are omitted: a key gets dictated down a phone line to support.
    const body = issueKey('navimed').plaintext.split('-').slice(1).join('');
    expect(body).not.toMatch(/[ILOU]/);
  });

  it('returns a hash that is not the plaintext', () => {
    const k = issueKey('navimed');
    expect(k.hash).not.toContain(k.plaintext);
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('verifyKey', () => {
  it('accepts the issued key', () => {
    const k = issueKey('navimed');
    expect(verifyKey(k.plaintext, k.salt, k.hash)).toBe(true);
  });

  it('accepts a key typed in lower case with stray spaces', () => {
    const k = issueKey('navimed');
    expect(verifyKey(`  ${k.plaintext.toLowerCase()} `, k.salt, k.hash)).toBe(true);
  });

  it('rejects a near-miss', () => {
    const k = issueKey('navimed');
    const wrong = k.plaintext.slice(0, -1) + (k.plaintext.endsWith('0') ? '1' : '0');
    expect(verifyKey(wrong, k.salt, k.hash)).toBe(false);
  });

  it('rejects the right key against the wrong salt', () => {
    const a = issueKey('navimed'); const b = issueKey('navimed');
    expect(verifyKey(a.plaintext, b.salt, a.hash)).toBe(false);
  });

  it('rejects a malformed stored hash without throwing', () => {
    const k = issueKey('navimed');
    expect(() => verifyKey(k.plaintext, k.salt, 'short')).not.toThrow();
    expect(verifyKey(k.plaintext, k.salt, 'short')).toBe(false);
  });

  it('is deterministic for a given key and salt', () => {
    const k = issueKey('navimed');
    expect(hashKey(k.plaintext, k.salt)).toBe(hashKey(k.plaintext, k.salt));
  });
});

describe('canActivate', () => {
  const rec = (o: Partial<KeyRecord> = {}): KeyRecord => ({
    productSlug: 'navimed', activationLimit: 3, activations: 0,
    expiresAt: null, revokedAt: null, ...o,
  });

  it('allows an activation within the limit', () => {
    expect(canActivate(rec(), 'navimed', NOW)).toEqual({ ok: true });
  });

  it('refuses an unknown key', () => {
    expect(canActivate(null, 'navimed', NOW)).toEqual({ ok: false, reason: 'unknown_key' });
  });

  it('refuses at the limit, not one past it', () => {
    expect(canActivate(rec({ activations: 3 }), 'navimed', NOW))
      .toEqual({ ok: false, reason: 'activation_limit_reached' });
    expect(canActivate(rec({ activations: 2 }), 'navimed', NOW).ok).toBe(true);
  });

  it('refuses a revoked key', () => {
    expect(canActivate(rec({ revokedAt: new Date(NOW - HOUR) }), 'navimed', NOW))
      .toEqual({ ok: false, reason: 'revoked' });
  });

  it('reports revoked before expired — the more actionable answer for support', () => {
    const r = rec({ revokedAt: new Date(NOW - HOUR), expiresAt: new Date(NOW - HOUR) });
    expect(canActivate(r, 'navimed', NOW)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('refuses an expired key', () => {
    expect(canActivate(rec({ expiresAt: new Date(NOW - 1000) }), 'navimed', NOW))
      .toEqual({ ok: false, reason: 'expired' });
  });

  it('allows a key expiring in the future', () => {
    expect(canActivate(rec({ expiresAt: new Date(NOW + HOUR) }), 'navimed', NOW).ok).toBe(true);
  });

  it('refuses a key belonging to a different product', () => {
    expect(canActivate(rec({ productSlug: 'nevral' }), 'navimed', NOW))
      .toEqual({ ok: false, reason: 'wrong_product' });
  });

  it('tolerates an unparseable expiry rather than granting or throwing', () => {
    expect(() => canActivate(rec({ expiresAt: 'nonsense' }), 'navimed', NOW)).not.toThrow();
  });
});
