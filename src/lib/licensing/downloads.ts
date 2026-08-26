/**
 * Signed download URLs.
 *
 * Security spec §9: 15-minute TTL, single-use where feasible, **bound to the requesting
 * customer**. That last clause is the one that matters — an unbound signed URL is a bearer
 * token that can be pasted into a forum, and the download is the product.
 *
 * The signature covers the customer, the product, the expiry and a nonce together. Changing
 * any of them invalidates it, so a URL issued for one customer cannot be replayed by
 * another even if they hold it.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const DOWNLOAD_TTL_SECONDS = 15 * 60;

export class DownloadSecretMissingError extends Error {
  readonly code = 'DOWNLOAD_SECRET_MISSING';
  constructor() {
    super('DOWNLOAD_URL_SECRET is not set — download links cannot be signed.');
    this.name = 'DownloadSecretMissingError';
  }
}

function secret(): string {
  const s = process.env.DOWNLOAD_URL_SECRET;
  if (!s) throw new DownloadSecretMissingError();
  return s;
}

export interface DownloadClaim {
  customerSub: string;
  productSlug: string;
  grantId: string;
  expiresAtMs: number;
  nonce: string;
}

const b64url = (b: Buffer) => b.toString('base64url');

function mac(c: DownloadClaim): string {
  // Field separator is a unit separator, not a delimiter that can appear in the values.
  // With a comma, ("a,b", "c") and ("a", "b,c") would sign identically.
  const SEP = String.fromCharCode(31);
  const canonical = [c.customerSub, c.productSlug, c.grantId, String(c.expiresAtMs), c.nonce].join(SEP);
  return b64url(createHmac('sha256', secret()).update(canonical).digest());
}

export function signDownload(opts: {
  customerSub: string;
  productSlug: string;
  grantId: string;
  nowMs: number;
  ttlSeconds?: number;
}): { token: string; expiresAtMs: number } {
  const expiresAtMs = opts.nowMs + (opts.ttlSeconds ?? DOWNLOAD_TTL_SECONDS) * 1000;
  const claim: DownloadClaim = {
    customerSub: opts.customerSub,
    productSlug: opts.productSlug,
    grantId: opts.grantId,
    expiresAtMs,
    // Single-use: the nonce is what a consumed-tokens table keys on.
    nonce: randomBytes(9).toString('base64url'),
  };
  const payload = b64url(Buffer.from(JSON.stringify(claim), 'utf8'));
  return { token: `${payload}.${mac(claim)}`, expiresAtMs };
}

export type DownloadRefusal =
  | 'malformed' | 'bad_signature' | 'expired' | 'wrong_customer' | 'wrong_product';

/**
 * Verifies a download token *against the customer presenting it*.
 *
 * `presentedBySub` is required, not optional. Making it optional would let a caller omit
 * it and silently accept any holder — the exact failure this function exists to prevent.
 */
export function verifyDownload(opts: {
  token: string;
  presentedBySub: string;
  productSlug: string;
  nowMs: number;
}): { ok: true; claim: DownloadClaim } | { ok: false; reason: DownloadRefusal } {
  const dot = opts.token.lastIndexOf('.');
  if (dot < 1) return { ok: false, reason: 'malformed' };

  let claim: DownloadClaim;
  try {
    const parsed = JSON.parse(Buffer.from(opts.token.slice(0, dot), 'base64url').toString('utf8'));
    if (
      typeof parsed?.customerSub !== 'string' || typeof parsed?.productSlug !== 'string' ||
      typeof parsed?.grantId !== 'string' || typeof parsed?.expiresAtMs !== 'number' ||
      typeof parsed?.nonce !== 'string'
    ) return { ok: false, reason: 'malformed' };
    claim = parsed as DownloadClaim;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const given = Buffer.from(opts.token.slice(dot + 1), 'base64url');
  const expected = Buffer.from(mac(claim), 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  // Signature first, then the claims. Checking a claim on an unverified token would be
  // reasoning about attacker-supplied data.
  if (claim.customerSub !== opts.presentedBySub) return { ok: false, reason: 'wrong_customer' };
  if (claim.productSlug !== opts.productSlug) return { ok: false, reason: 'wrong_product' };
  if (claim.expiresAtMs <= opts.nowMs) return { ok: false, reason: 'expired' };

  return { ok: true, claim };
}
