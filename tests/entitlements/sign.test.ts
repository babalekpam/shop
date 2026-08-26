import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { signDetached, verifyDetached, canSign } from '../../src/lib/entitlements/sign';

let publicPem: string;
let otherPublicPem: string;
const NOW = Date.parse('2026-06-01T12:00:00Z');

beforeAll(() => {
  const kp = generateKeyPairSync('ed25519');
  process.env.ENTITLEMENT_SIGNING_KEY = kp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  publicPem = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  otherPublicPem = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
});
afterAll(() => { delete process.env.ENTITLEMENT_SIGNING_KEY; });

const body = JSON.stringify({ customer_id: 'sub-1', product: 'navimed', status: 'active' });

describe('detached JWS', () => {
  it('round-trips', () => {
    const sig = signDetached(body, NOW);
    expect(verifyDetached({ detached: sig, payload: body, publicKeyPem: publicPem, nowMs: NOW }))
      .toEqual({ valid: true, reason: 'ok' });
  });

  it('omits the payload from the signature string', () => {
    // Detached: header..signature. A payload segment would double the response size and
    // let the two copies disagree.
    const sig = signDetached(body, NOW);
    expect(sig.split('..')).toHaveLength(2);
    expect(sig).not.toContain('navimed');
  });

  it('REJECTS a body altered in transit', () => {
    const sig = signDetached(body, NOW);
    const tampered = body.replace('"active"', '"revoked"');
    expect(verifyDetached({ detached: sig, payload: tampered, publicKeyPem: publicPem, nowMs: NOW }).reason)
      .toBe('bad_signature');
  });

  it('rejects a signature from a different key', () => {
    const sig = signDetached(body, NOW);
    expect(verifyDetached({ detached: sig, payload: body, publicKeyPem: otherPublicPem, nowMs: NOW }).reason)
      .toBe('bad_signature');
  });

  it('rejects a replay beyond the max age', () => {
    const sig = signDetached(body, NOW);
    expect(verifyDetached({ detached: sig, payload: body, publicKeyPem: publicPem, nowMs: NOW + 400_000 }).reason)
      .toBe('expired');
  });

  it('accepts inside the max age', () => {
    const sig = signDetached(body, NOW);
    expect(verifyDetached({ detached: sig, payload: body, publicKeyPem: publicPem, nowMs: NOW + 120_000 }).valid)
      .toBe(true);
  });

  it('checks the signature before the age, so authentic-but-old is distinguishable', () => {
    const sig = signDetached(body, NOW);
    const tampered = body.replace('active', 'revoked');
    // Old AND forged reports bad_signature, not expired.
    expect(verifyDetached({ detached: sig, payload: tampered, publicKeyPem: publicPem, nowMs: NOW + 999_999 }).reason)
      .toBe('bad_signature');
  });

  it.each([
    ['empty', ''],
    ['no separator', 'abcdef'],
    ['three parts', 'a..b..c'],
    ['empty header', '..sig'],
  ])('rejects a malformed detached JWS (%s)', (_l, detached) => {
    expect(verifyDetached({ detached, payload: body, publicKeyPem: publicPem, nowMs: NOW }).valid).toBe(false);
  });

  it('rejects an alg the verifier does not implement', () => {
    // "alg": "none" is the classic JWT downgrade. It must not verify.
    const header = Buffer.from(JSON.stringify({ alg: 'none', iat: Math.floor(NOW / 1000) }))
      .toString('base64url');
    expect(verifyDetached({ detached: `${header}..`, payload: body, publicKeyPem: publicPem, nowMs: NOW }).reason)
      .toBe('malformed');
  });

  it('canSign reflects configuration', () => {
    expect(canSign()).toBe(true);
    const saved = process.env.ENTITLEMENT_SIGNING_KEY;
    delete process.env.ENTITLEMENT_SIGNING_KEY;
    expect(canSign()).toBe(false);
    process.env.ENTITLEMENT_SIGNING_KEY = saved;
  });
});
