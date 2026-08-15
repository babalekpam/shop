import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Static security headers.
 *
 * CSP is *not* here — it carries a per-request nonce, so it is set in middleware
 * (`src/lib/security/csp.ts`). Everything below is request-independent.
 *
 * In production these belong at the Cloudflare edge (security spec §5), but defining
 * them here means a local run and a Replit deployment behave like production instead of
 * silently permitting what the real environment forbids — which is how an inline style
 * gets merged and only fails after launch.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(self)',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
