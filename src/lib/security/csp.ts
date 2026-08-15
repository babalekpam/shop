/**
 * Content Security Policy.
 *
 * Security spec §5: *"Strict CSP with nonces, no `unsafe-inline`."* Both halves matter,
 * and they have different costs:
 *
 * **`style-src 'self'`** costs an indirection — resting state in a stylesheet, dynamic
 * values through CSSOM — and is the constraint the whole design-system approach in
 * §1.2 is built around. It is free at runtime.
 *
 * **`script-src` with a nonce** costs static rendering. Next's bootstrap scripts are
 * inline, so they need either a per-request nonce or a build-time hash. A per-request
 * nonce cannot be baked into a statically prerendered page, so pages that carry it render
 * dynamically. That is a real trade against the Lighthouse target, and it is taken
 * deliberately: `'unsafe-inline'` on `script-src` would defeat the policy's main purpose,
 * and a storefront handling payment is not the place to make that trade the other way.
 *
 * If the marketing pages later need to be static, the resolution is to move CSP
 * enforcement to the Cloudflare edge using script hashes rather than to relax it here.
 *
 * Paddle's checkout domain is the only permitted third-party script origin. Nothing else
 * may load on a checkout page — no analytics, no chat widget, no pixel (security spec §11).
 */

export interface CspOptions {
  nonce: string;
  /** Report-only in development, where React's refresh runtime needs `eval`. */
  development?: boolean;
}

const PADDLE = ['https://cdn.paddle.com', 'https://sandbox-cdn.paddle.com'];
const PADDLE_API = ['https://*.paddle.com'];
const CINETPAY = ['https://checkout.cinetpay.com', 'https://api-checkout.cinetpay.com'];

export function buildCsp({ nonce, development = false }: CspOptions): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // `strict-dynamic` lets the nonce'd bootstrap load the rest of the chunk graph without
    // enumerating every file, and modern browsers then ignore the host allowlist.
    "'strict-dynamic'",
    ...PADDLE,
    // Next's dev-mode refresh runtime compiles with eval. Never in production.
    ...(development ? ["'unsafe-eval'"] : []),
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    // No `unsafe-inline`, no nonce needed: no stylesheet or style attribute is generated
    // at runtime. Everything is a first-party file.
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${[...PADDLE_API, ...CINETPAY].join(' ')}`,
    `frame-src ${[...PADDLE_API, 'https://checkout.cinetpay.com'].join(' ')}`,
    `form-action 'self' ${[...PADDLE_API, 'https://checkout.cinetpay.com'].join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** A fresh 128-bit nonce per request, via the Web Crypto API available in the edge runtime. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
