import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { verifyServiceToken, hashToken, resetTokenCache, type TokenVerdict } from '../../src/lib/entitlements/tokens';

/** Narrows the discriminated union so a test can assert on the refusal reason. */
const why = (v: TokenVerdict) => (v.ok ? 'ok' : v.reason);

const NAVIMED = 'tok_navimed_abcdef0123456789';
const NEVRAL = 'tok_nevral_9876543210fedcba';

function setRegistry(map: Record<string, string> | undefined) {
  if (map === undefined) delete process.env.ENTITLEMENT_SERVICE_TOKENS;
  else process.env.ENTITLEMENT_SERVICE_TOKENS = JSON.stringify(map);
  resetTokenCache();
}

describe('verifyServiceToken', () => {
  beforeEach(() => setRegistry({ navimed: hashToken(NAVIMED), nevral: hashToken(NEVRAL) }));
  afterEach(() => setRegistry(undefined));

  it('accepts the right token for its product', () => {
    expect(verifyServiceToken(`Bearer ${NAVIMED}`, 'navimed')).toEqual({ ok: true, product: 'navimed' });
  });

  it('REJECTS a valid token used for a different product', () => {
    // The entire value of per-product tokens: one stolen secret is not full compromise.
    expect(verifyServiceToken(`Bearer ${NEVRAL}`, 'navimed')).toEqual({ ok: false, reason: 'bad_token' });
  });

  it('rejects an unknown product', () => {
    expect(why(verifyServiceToken(`Bearer ${NAVIMED}`, 'barika'))).toBe('unknown_product');
  });

  it('rejects a missing header', () => {
    expect(why(verifyServiceToken(null, 'navimed'))).toBe('missing');
  });

  it.each([
    ['no scheme', NAVIMED],
    ['wrong scheme', `Basic ${NAVIMED}`],
    ['empty bearer', 'Bearer '],
  ])('rejects a malformed header (%s)', (_l, header) => {
    expect(verifyServiceToken(header, 'navimed').ok).toBe(false);
  });

  it('accepts a lowercase bearer scheme', () => {
    expect(verifyServiceToken(`bearer ${NAVIMED}`, 'navimed').ok).toBe(true);
  });

  it('rejects a near-miss token', () => {
    expect(why(verifyServiceToken(`Bearer ${NAVIMED}x`, 'navimed'))).toBe('bad_token');
  });

  it('reports not_configured when the registry is absent, and never ok', () => {
    setRegistry(undefined);
    expect(verifyServiceToken(`Bearer ${NAVIMED}`, 'navimed')).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('reports not_configured for an empty registry rather than accepting', () => {
    setRegistry({});
    expect(why(verifyServiceToken(`Bearer ${NAVIMED}`, 'navimed'))).toBe('not_configured');
  });

  it('ignores a plaintext token accidentally placed in the registry', () => {
    // The registry holds sha256 hashes. A plaintext value there is a misconfiguration,
    // and it must not authenticate anything.
    setRegistry({ navimed: NAVIMED });
    expect(why(verifyServiceToken(`Bearer ${NAVIMED}`, 'navimed'))).toBe('not_configured');
  });

  it('survives malformed registry JSON without granting', () => {
    process.env.ENTITLEMENT_SERVICE_TOKENS = '{not json';
    resetTokenCache();
    expect(why(verifyServiceToken(`Bearer ${NAVIMED}`, 'navimed'))).toBe('not_configured');
  });

  it('picks up a rotated token without a restart', () => {
    const rotated = 'tok_navimed_rotated_value';
    setRegistry({ navimed: hashToken(rotated) });
    expect(verifyServiceToken(`Bearer ${rotated}`, 'navimed').ok).toBe(true);
    expect(verifyServiceToken(`Bearer ${NAVIMED}`, 'navimed').ok).toBe(false);
  });
});
