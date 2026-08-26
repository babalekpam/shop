import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  signDownload, verifyDownload, DOWNLOAD_TTL_SECONDS, DownloadSecretMissingError,
} from '../../src/lib/licensing/downloads';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const MIN = 60_000;
const base = { customerSub: 'sub-alice', productSlug: 'navimed', grantId: 'grant-1', nowMs: NOW };

beforeAll(() => { process.env.DOWNLOAD_URL_SECRET = 'test-download-secret'; });
afterAll(() => { delete process.env.DOWNLOAD_URL_SECRET; });

const check = (token: string, over: Partial<Parameters<typeof verifyDownload>[0]> = {}) =>
  verifyDownload({ token, presentedBySub: 'sub-alice', productSlug: 'navimed', nowMs: NOW, ...over });

describe('signDownload', () => {
  it('round-trips for the customer it was issued to', () => {
    const { token } = signDownload(base);
    expect(check(token).ok).toBe(true);
  });

  it('expires 15 minutes out by default', () => {
    const { expiresAtMs } = signDownload(base);
    expect(expiresAtMs - NOW).toBe(DOWNLOAD_TTL_SECONDS * 1000);
  });

  it('issues a distinct nonce each time, so single-use tracking is possible', () => {
    const a = signDownload(base).token, b = signDownload(base).token;
    expect(a).not.toBe(b);
  });
});

describe('customer binding — the property that matters', () => {
  it('REFUSES a URL presented by a different customer', () => {
    // An unbound signed URL is a bearer token that can be pasted into a forum.
    const { token } = signDownload(base);
    expect(check(token, { presentedBySub: 'sub-mallory' }))
      .toEqual({ ok: false, reason: 'wrong_customer' });
  });

  it('refuses a URL used against a different product', () => {
    const { token } = signDownload(base);
    expect(check(token, { productSlug: 'nevral' })).toEqual({ ok: false, reason: 'wrong_product' });
  });

  it('cannot be re-pointed by editing the claim — the signature covers it', () => {
    const { token } = signDownload(base);
    const [payload, sig] = token.split('.') as [string, string];
    const claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    claim.customerSub = 'sub-mallory';
    const forged = `${Buffer.from(JSON.stringify(claim)).toString('base64url')}.${sig}`;
    expect(check(forged, { presentedBySub: 'sub-mallory' }))
      .toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('cannot have its expiry extended', () => {
    const { token } = signDownload(base);
    const [payload, sig] = token.split('.') as [string, string];
    const claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    claim.expiresAtMs = NOW + 365 * 24 * 3_600_000;
    const forged = `${Buffer.from(JSON.stringify(claim)).toString('base64url')}.${sig}`;
    expect(check(forged, { nowMs: NOW + 60 * MIN }).ok).toBe(false);
  });
});

describe('expiry', () => {
  it('accepts at 14 minutes', () => {
    const { token } = signDownload(base);
    expect(check(token, { nowMs: NOW + 14 * MIN }).ok).toBe(true);
  });
  it('refuses at 16 minutes', () => {
    const { token } = signDownload(base);
    expect(check(token, { nowMs: NOW + 16 * MIN })).toEqual({ ok: false, reason: 'expired' });
  });
  it('refuses exactly at the expiry instant', () => {
    const { token, expiresAtMs } = signDownload(base);
    expect(check(token, { nowMs: expiresAtMs }).ok).toBe(false);
  });
});

describe('malformed input', () => {
  it.each([
    ['empty', ''],
    ['no dot', 'abcdef'],
    ['not base64', '!!!.???'],
    ['payload is not JSON', `${Buffer.from('nope').toString('base64url')}.sig`],
    ['claim missing fields', `${Buffer.from('{"customerSub":"a"}').toString('base64url')}.sig`],
  ])('refuses %s without throwing', (_l, token) => {
    expect(() => check(token)).not.toThrow();
    expect(check(token).ok).toBe(false);
  });

  it('checks the signature before any claim, so a forgery never reports wrong_customer', () => {
    // Reasoning about claims on an unverified token is reasoning about attacker input.
    const forged = `${Buffer.from(JSON.stringify({
      customerSub: 'sub-mallory', productSlug: 'navimed', grantId: 'g', expiresAtMs: NOW + MIN, nonce: 'n',
    })).toString('base64url')}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    expect(check(forged).ok).toBe(false);
    expect(check(forged)).toEqual({ ok: false, reason: 'bad_signature' });
  });
});

describe('configuration', () => {
  it('throws rather than issuing an unsigned link when no secret is set', () => {
    const saved = process.env.DOWNLOAD_URL_SECRET;
    delete process.env.DOWNLOAD_URL_SECRET;
    expect(() => signDownload(base)).toThrow(DownloadSecretMissingError);
    process.env.DOWNLOAD_URL_SECRET = saved;
  });

  it('refuses a token signed with a different secret', () => {
    const { token } = signDownload(base);
    process.env.DOWNLOAD_URL_SECRET = 'rotated-secret';
    const res = check(token);
    process.env.DOWNLOAD_URL_SECRET = 'test-download-secret';
    expect(res).toEqual({ ok: false, reason: 'bad_signature' });
  });
});
