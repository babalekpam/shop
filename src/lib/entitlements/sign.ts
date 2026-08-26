/**
 * Detached JWS over entitlement responses.
 *
 * Security spec §7: responses are signed so a consuming product verifies authenticity
 * independently of transport, with an issued-at claim so a captured response cannot be
 * replayed indefinitely.
 *
 * Ed25519 via `node:crypto` — no dependency, and a signature a consumer can verify with
 * any standard JOSE library. The signature travels in a header rather than the body so the
 * JSON stays exactly what the build spec documents.
 */
import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from 'node:crypto';

const b64url = (b: Buffer) =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export class SigningKeyMissingError extends Error {
  readonly code = 'SIGNING_KEY_MISSING';
  constructor() {
    super('ENTITLEMENT_SIGNING_KEY is not set — entitlement responses cannot be signed.');
    this.name = 'SigningKeyMissingError';
  }
}

/** True when signing is available. Absence is a 503, never an unsigned response. */
export function canSign(): boolean {
  return !!process.env.ENTITLEMENT_SIGNING_KEY;
}

function privateKey() {
  const pem = process.env.ENTITLEMENT_SIGNING_KEY;
  if (!pem) throw new SigningKeyMissingError();
  return createPrivateKey(pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem);
}

/**
 * Returns a detached JWS: `<protected header>..<signature>`, the payload omitted.
 * The consumer recomputes it from the response body it received, so a body swapped in
 * transit fails verification.
 */
export function signDetached(payload: string, issuedAtMs: number): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JOSE', iat: Math.floor(issuedAtMs / 1000) })));
  const signingInput = `${header}.${b64url(Buffer.from(payload, 'utf8'))}`;
  const sig = nodeSign(null, Buffer.from(signingInput, 'utf8'), privateKey());
  return `${header}..${b64url(sig)}`;
}

/**
 * Verifies a detached JWS against a body. Exported so the test suite proves the pair
 * round-trips, and so consuming products have a reference implementation to copy.
 */
export function verifyDetached(opts: {
  detached: string;
  payload: string;
  publicKeyPem: string;
  maxAgeSeconds?: number;
  nowMs?: number;
}): { valid: boolean; reason: 'ok' | 'malformed' | 'bad_signature' | 'expired' } {
  const parts = opts.detached.split('..');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false, reason: 'malformed' };
  const [header, sig] = parts as [string, string];

  let iat: number;
  try {
    const parsed = JSON.parse(unb64url(header).toString('utf8')) as { iat?: number; alg?: string };
    if (parsed.alg !== 'EdDSA' || typeof parsed.iat !== 'number') return { valid: false, reason: 'malformed' };
    iat = parsed.iat;
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  const signingInput = `${header}.${b64url(Buffer.from(opts.payload, 'utf8'))}`;
  const okSig = nodeVerify(
    null,
    Buffer.from(signingInput, 'utf8'),
    createPublicKey(opts.publicKeyPem),
    unb64url(sig)
  );
  if (!okSig) return { valid: false, reason: 'bad_signature' };

  // Signature checked before age, so an expired-but-authentic response is distinguishable
  // from a forgery in the consumer's logs.
  const age = ((opts.nowMs ?? Date.now()) / 1000) - iat;
  if (age > (opts.maxAgeSeconds ?? 300)) return { valid: false, reason: 'expired' };
  return { valid: true, reason: 'ok' };
}
