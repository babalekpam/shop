import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyPaddle, verifyCinetPayNotify, safeEqual } from '../../src/lib/gateway/signature';

const SECRET = 'pdl_ntfset_test_secret';
const NOW = 1_760_000_000_000; // fixed clock; a wall-clock test is a test that fails at 3am

function paddleHeader(body: string, atMs = NOW, secret = SECRET): string {
  const ts = Math.floor(atMs / 1000);
  return `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;
}

describe('safeEqual', () => {
  it('matches identical strings', () => expect(safeEqual('abc', 'abc')).toBe(true));
  it('rejects different strings', () => expect(safeEqual('abc', 'abd')).toBe(false));
  it('rejects different lengths without throwing', () => {
    // timingSafeEqual throws on length mismatch; the hash step must absorb that.
    expect(() => safeEqual('a', 'aaaaaaaaaaaaaaaa')).not.toThrow();
    expect(safeEqual('a', 'aaaaaaaaaaaaaaaa')).toBe(false);
  });
  it('rejects empty against non-empty', () => expect(safeEqual('', 'x')).toBe(false));
});

describe('verifyPaddle', () => {
  const body = '{"event_id":"evt_1","event_type":"transaction.completed"}';

  it('accepts a correct signature', () => {
    const v = verifyPaddle({ rawBody: body, header: paddleHeader(body), secret: SECRET, nowMs: NOW });
    expect(v).toEqual({ valid: true, reason: 'ok' });
  });

  it('rejects a body altered after signing', () => {
    const header = paddleHeader(body);
    const tampered = body.replace('evt_1', 'evt_2');
    expect(verifyPaddle({ rawBody: tampered, header, secret: SECRET, nowMs: NOW }).reason).toBe('bad_signature');
  });

  it('rejects a signature made with a different secret', () => {
    const header = paddleHeader(body, NOW, 'other_secret');
    expect(verifyPaddle({ rawBody: body, header, secret: SECRET, nowMs: NOW }).reason).toBe('bad_signature');
  });

  it('rejects a replay beyond the tolerance window', () => {
    const header = paddleHeader(body, NOW - 400_000); // 400s old, tolerance 300s
    expect(verifyPaddle({ rawBody: body, header, secret: SECRET, nowMs: NOW }).reason).toBe('stale_timestamp');
  });

  it('accepts a delivery inside the tolerance window', () => {
    const header = paddleHeader(body, NOW - 120_000);
    expect(verifyPaddle({ rawBody: body, header, secret: SECRET, nowMs: NOW }).valid).toBe(true);
  });

  it('rejects a timestamp far in the future', () => {
    // Otherwise a captured delivery stays valid indefinitely by dating it forward.
    const header = paddleHeader(body, NOW + 400_000);
    expect(verifyPaddle({ rawBody: body, header, secret: SECRET, nowMs: NOW }).reason).toBe('future_timestamp');
  });

  it('rejects a missing header rather than passing it through', () => {
    expect(verifyPaddle({ rawBody: body, header: null, secret: SECRET, nowMs: NOW }).reason).toBe('missing_signature');
  });

  it.each([
    ['garbage', 'garbage'],
    ['no h1', 'ts=1760000000'],
    ['no ts', 'h1=deadbeef'],
    ['non-numeric ts', 'ts=abc;h1=deadbeef'],
    ['non-hex h1', 'ts=1760000000;h1=zzzz'],
  ])('rejects a malformed header (%s)', (_label, header) => {
    expect(verifyPaddle({ rawBody: body, header, secret: SECRET, nowMs: NOW }).reason).toBe('malformed_signature');
  });

  it('reports not_configured rather than accepting when no secret is set', () => {
    // The dangerous failure would be treating "no secret" as "no check required".
    const v = verifyPaddle({ rawBody: body, header: paddleHeader(body), secret: undefined, nowMs: NOW });
    expect(v).toEqual({ valid: false, reason: 'not_configured' });
  });

  it('is case-insensitive about the hex digest', () => {
    const header = paddleHeader(body).toUpperCase().replace('TS=', 'ts=').replace(';H1=', ';h1=');
    expect(verifyPaddle({ rawBody: body, header, secret: SECRET, nowMs: NOW }).valid).toBe(true);
  });
});

describe('verifyCinetPayNotify', () => {
  const body = 'cpm_trans_id=TX1&cpm_site_id=1234';
  const KEY = 'cinetpay_secret';
  const token = createHmac('sha256', KEY).update(body).digest('hex');

  it('accepts a correct token', () => {
    expect(verifyCinetPayNotify({ rawBody: body, header: token, secretKey: KEY }).valid).toBe(true);
  });
  it('rejects a tampered body', () => {
    expect(verifyCinetPayNotify({ rawBody: body + '&amount=1', header: token, secretKey: KEY }).reason)
      .toBe('bad_signature');
  });
  it('rejects a missing token', () => {
    expect(verifyCinetPayNotify({ rawBody: body, header: null, secretKey: KEY }).reason).toBe('missing_signature');
  });
  it('reports not_configured rather than accepting', () => {
    expect(verifyCinetPayNotify({ rawBody: body, header: token, secretKey: undefined }).reason)
      .toBe('not_configured');
  });
});
