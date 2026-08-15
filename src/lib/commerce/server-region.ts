import { headers } from 'next/headers';
import { resolveRegion, type RegionDefaults } from './region';

/**
 * The visitor's region defaults, from Cloudflare's country header.
 *
 * Reading `headers()` opts the route into dynamic rendering, which is already the case
 * here: the CSP nonce is per-request (see `src/lib/security/csp.ts`), so nothing carrying
 * it could be statically prerendered anyway.
 */
export async function getRegion(): Promise<RegionDefaults> {
  const store = await headers();
  return resolveRegion(store.get('CF-IPCountry'));
}
