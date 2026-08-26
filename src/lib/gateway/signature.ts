/**
 * Webhook signature verification.
 *
 * Security spec §8: unsigned or invalid-signature requests are dropped and alerted on,
 * never processed "just in case". This module decides that, and nothing else — it does no
 * database work, so it can be exhaustively tested without one.
 *
 * Every comparison here is constant-time. A byte-by-byte early return leaks the expected
 * signature one character at a time to anyone willing to send enough requests, which turns
 * "forge a webhook" from impossible into a long afternoon.
 */
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';

export type VerdictReason =
  | 'ok'
  | 'missing_signature'
  | 'malformed_signature'
  | 'unknown_key_id'
  | 'bad_signature'
  | 'stale_timestamp'
  | 'future_timestamp'
  | 'not_configured';

export interface Verdict {
  valid: boolean;
  reason: VerdictReason;
}

const ok: Verdict = { valid: true, reason: 'ok' };
const no = (reason: VerdictReason): Verdict => ({ valid: false, reason });

/** Constant-time string compare that does not leak length through an early return. */
export function safeEqual(a: string, b: string): boolean {
  // Hash first: timingSafeEqual throws on length mismatch, and the throw itself is an
  // oracle for the expected length. Hashing makes both sides 32 bytes, always.
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Paddle Billing signs as `ts=<unix>;h1=<hex hmac>` over `<ts>:<raw body>`.
 * The raw body matters: re-serialising parsed JSON changes key order and whitespace, and
 * the signature will never match. Callers must pass the bytes as received.
 */
export function verifyPaddle(opts: {
  rawBody: string;
  header: string | null;
  secret: string | undefined;
  toleranceSeconds?: number;
  nowMs?: number;
}): Verdict {
  const { rawBody, header, secret } = opts;
  const tolerance = opts.toleranceSeconds ?? 300;
  const now = opts.nowMs ?? Date.now();

  if (!secret) return no('not_configured');
  if (!header) return no('missing_signature');

  let ts: string | undefined;
  let h1: string | undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 'ts') ts = v;
    else if (k === 'h1') h1 = v;
  }
  if (!ts || !h1 || !/^\d+$/.test(ts) || !/^[0-9a-f]+$/i.test(h1)) return no('malformed_signature');

  const skew = now - Number(ts) * 1000;
  if (skew > tolerance * 1000) return no('stale_timestamp');
  // A timestamp far in the future is equally a replay tool — it would keep a captured
  // delivery valid long after the tolerance window should have closed it.
  if (skew < -tolerance * 1000) return no('future_timestamp');

  const expected = createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex');
  return safeEqual(expected, h1.toLowerCase()) ? ok : no('bad_signature');
}

/**
 * CinetPay signs the notify body with an HMAC-SHA256 token in `x-token`.
 *
 * Passing this is necessary but **not sufficient**. Build spec §9 requires the payment to
 * be re-verified server-side against CinetPay's check endpoint before anything is granted;
 * a valid signature only proves the message came from CinetPay, not that the customer's
 * money moved. `verifyCinetPayNotify` deliberately returns a Verdict and nothing else, so
 * no caller can mistake it for an authorisation.
 */
export function verifyCinetPayNotify(opts: {
  rawBody: string;
  header: string | null;
  secretKey: string | undefined;
}): Verdict {
  const { rawBody, header, secretKey } = opts;
  if (!secretKey) return no('not_configured');
  if (!header) return no('missing_signature');
  if (!/^[0-9a-f]+$/i.test(header)) return no('malformed_signature');
  const expected = createHmac('sha256', secretKey).update(rawBody).digest('hex');
  return safeEqual(expected, header.toLowerCase()) ? ok : no('bad_signature');
}
