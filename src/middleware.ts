import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { DEFAULT_LOCALE, LOCALE_BY_COUNTRY, LOCALES, isLocale } from './i18n/routing';
import { buildCsp, generateNonce } from './lib/security/csp';

export const LOCALE_COOKIE = 'ARGILETTE_LOCALE';

/**
 * Locale resolution, in priority order (build spec §5):
 *
 *   1. the URL segment — an explicit link always wins
 *   2. the user's saved choice, from a cookie
 *   3. Cloudflare's country header
 *   4. English
 *
 * Geo is a default, never a lock. A diaspora customer in Paris buying for a Lomé clinic
 * must be able to override both the locale and the payment path, and that override has to
 * outlast the request that set it.
 */
function resolveLocale(request: NextRequest): string {
  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  if (saved && isLocale(saved)) return saved;

  const country = request.headers.get('CF-IPCountry')?.toUpperCase();
  if (country && LOCALE_BY_COUNTRY[country]) return LOCALE_BY_COUNTRY[country];

  return DEFAULT_LOCALE;
}

/**
 * Locale prefixing is handled here rather than by next-intl's own middleware, because the
 * CSP nonce has to reach the render as a *request* header — that is how Next stamps it
 * onto its inline bootstrap scripts — and threading request headers through another
 * middleware's response is fragile. next-intl still owns message loading, via the
 * `[locale]` route param in `src/i18n/request.ts`; only the routing half is ours.
 */
export default function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp({ nonce, development: process.env.NODE_ENV !== 'production' });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next reads the nonce out of this request header and applies it to the scripts it
  // generates. Without it, a nonce'd policy blocks Next's own bootstrap.
  requestHeaders.set('Content-Security-Policy', csp);

  const { pathname } = request.nextUrl;
  const hasLocale = LOCALES.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );

  if (!hasLocale) {
    const locale = resolveLocale(request);
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
    // 307, not 308: the target depends on a header and a cookie, so it must never be
    // cached as permanent.
    const redirect = NextResponse.redirect(url, 307);
    redirect.headers.set('Content-Security-Policy', csp);
    return redirect;
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Everything except Next internals, the API surface, and static files. The API is
  // excluded deliberately: the entitlement endpoints are consumed by other ARGILETTE
  // products and must not be locale-prefixed.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
