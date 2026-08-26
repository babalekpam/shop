/**
 * Per-product service tokens.
 *
 * Security spec §7: high entropy, stored hashed, independently revocable, rotated on a
 * schedule. Forging one response unlocks every ARGILETTE product, so the token check is
 * the highest-value code path in the repository.
 *
 * `ENTITLEMENT_SERVICE_TOKENS` is a JSON map of `product_slug -> sha256(token)`. Hashes,
 * never plaintext — the environment is a place operators read, and a plaintext token there
 * is a token in a screenshot.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export type TokenVerdict =
  | { ok: true; product: string }
  | { ok: false; reason: 'not_configured' | 'missing' | 'malformed' | 'unknown_product' | 'bad_token' };

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

let cache: { raw: string; map: Record<string, string> } | null = null;

function registry(): Record<string, string> | null {
  const raw = process.env.ENTITLEMENT_SERVICE_TOKENS;
  if (!raw) return null;
  if (cache && cache.raw === raw) return cache.map;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v)) map[k] = v.toLowerCase();
    }
    cache = { raw, map };
    return map;
  } catch {
    return null;
  }
}

/**
 * Verifies a bearer token against the product it claims to be for.
 *
 * The token is checked against **that product's** hash only. A token valid for `navimed`
 * must not answer questions about `nevral`; the whole point of per-product tokens is that
 * one stolen secret is not full compromise.
 */
export function verifyServiceToken(authorization: string | null, product: string): TokenVerdict {
  const map = registry();
  if (!map || Object.keys(map).length === 0) return { ok: false, reason: 'not_configured' };
  if (!authorization) return { ok: false, reason: 'missing' };

  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!m || !m[1]) return { ok: false, reason: 'malformed' };

  const expected = map[product];
  if (!expected) return { ok: false, reason: 'unknown_product' };

  const given = hashToken(m[1]);
  // Both are 64 hex chars by construction, so timingSafeEqual cannot throw on length here.
  const equal = timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
  return equal ? { ok: true, product } : { ok: false, reason: 'bad_token' };
}

/** Test seam: clears the parsed-registry cache. */
export function resetTokenCache(): void { cache = null; }
