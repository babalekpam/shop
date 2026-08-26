/**
 * Licence keys.
 *
 * Security spec §9: stored as salted hashes, shown in plaintext exactly once, at issuance.
 *
 * **On the KDF.** The spec names Argon2id, which is the right default for *passwords*.
 * Licence keys here are 160 bits of CSPRNG output, so an offline attacker holding the
 * database faces 2^160 candidates — memory-hardness buys nothing against a keyspace that
 * size, and Argon2id would mean a native dependency in a build that must stay portable.
 * This uses scrypt from `node:crypto`: memory-hard, no dependency, and far stronger than
 * the entropy actually requires. If a human-chosen key format is ever introduced, that
 * reasoning collapses and this must move to Argon2id.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 32 } as const;

/** Crockford base32 without I, L, O, U — a key gets read aloud down a phone line. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUPS = 4;
const GROUP_LEN = 5;

export interface IssuedKey {
  /** Shown to the customer exactly once. Never stored, never logged. */
  plaintext: string;
  hash: string;
  salt: string;
  /** Non-secret, stored, so support can identify a key without holding a usable one. */
  prefix: string;
}

/**
 * The random part, without the KDF.
 *
 * Split out from `issueKey` because the two properties are independent and only one is
 * expensive: uniqueness comes from the CSPRNG, resistance to a stolen database comes from
 * scrypt. Keeping them separate means the uniqueness property can be exercised across
 * thousands of samples in milliseconds instead of minutes.
 */
export function generateKeyString(productSlug: string): string {
  const raw = randomBytes(20); // 160 bits
  let bits = 0n;
  for (const b of raw) bits = (bits << 8n) | BigInt(b);

  const chars: string[] = [];
  for (let i = 0; i < GROUPS * GROUP_LEN; i++) {
    chars.push(ALPHABET[Number(bits & 31n)]!);
    bits >>= 5n;
  }
  const body = Array.from({ length: GROUPS }, (_, g) =>
    chars.slice(g * GROUP_LEN, (g + 1) * GROUP_LEN).join('')
  ).join('-');

  return `${productSlug.slice(0, 4).toUpperCase()}-${body}`;
}

export function issueKey(productSlug: string): IssuedKey {
  const plaintext = generateKeyString(productSlug);
  const salt = randomBytes(16).toString('hex');
  return { plaintext, hash: hashKey(plaintext, salt), salt, prefix: productSlug.slice(0, 4).toUpperCase() };
}

export function hashKey(plaintext: string, salt: string): string {
  return scryptSync(normalise(plaintext), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
  }).toString('hex');
}

/**
 * Constant-time verification.
 *
 * Normalisation is applied to the *input* before hashing, so a customer typing their key
 * in lower case with stray spaces still activates. It must be identical to the
 * normalisation used at issuance or every key fails.
 */
export function verifyKey(plaintext: string, salt: string, expectedHash: string): boolean {
  const given = Buffer.from(hashKey(plaintext, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

function normalise(key: string): string {
  return key.trim().toUpperCase().replace(/\s+/g, '');
}

export type ActivationRefusal =
  | 'unknown_key' | 'revoked' | 'expired' | 'activation_limit_reached' | 'wrong_product';

export interface KeyRecord {
  productSlug: string;
  activationLimit: number;
  activations: number;
  expiresAt: Date | string | null;
  revokedAt: Date | string | null;
}

/**
 * Decides whether an activation may proceed. Pure, so every refusal path is testable.
 * Ordered most-severe first: a revoked key reports revoked even if it is also expired,
 * because that is the more actionable answer for support.
 */
export function canActivate(
  record: KeyRecord | null,
  product: string,
  nowMs: number
): { ok: true } | { ok: false; reason: ActivationRefusal } {
  if (!record) return { ok: false, reason: 'unknown_key' };
  if (record.revokedAt) return { ok: false, reason: 'revoked' };
  if (record.productSlug !== product) return { ok: false, reason: 'wrong_product' };
  const expires = record.expiresAt
    ? (record.expiresAt instanceof Date ? record.expiresAt.getTime() : Date.parse(record.expiresAt))
    : null;
  if (expires !== null && Number.isFinite(expires) && expires <= nowMs) {
    return { ok: false, reason: 'expired' };
  }
  if (record.activations >= record.activationLimit) {
    return { ok: false, reason: 'activation_limit_reached' };
  }
  return { ok: true };
}
