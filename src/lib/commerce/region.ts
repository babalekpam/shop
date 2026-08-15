/**
 * Gateway and currency routing.
 *
 * Build spec §3: the UEMOA/CEMAC zone routes to CinetPay with mobile money first;
 * everywhere else routes to Paddle. Read from Cloudflare's `CF-IPCountry` header.
 *
 * **Geo is a default, never a lock.** The override is a visible control on the checkout
 * page, not a buried link — a diaspora customer in Paris paying for a Lomé clinic has to
 * be able to reach the FCFA and mobile-money path, and someone travelling through Abidjan
 * has to be able to reach the card path. Getting this wrong does not degrade the
 * experience, it makes the purchase impossible.
 */

export type Gateway = 'paddle' | 'cinetpay';

/** UEMOA (XOF) and CEMAC (XAF) member states. */
const UEMOA = ['BJ', 'BF', 'CI', 'GW', 'ML', 'NE', 'SN', 'TG'] as const;
const CEMAC = ['CM', 'CF', 'TD', 'CG', 'GQ', 'GA'] as const;

const FRANC_ZONE = new Set<string>([...UEMOA, ...CEMAC]);

export const isFrancZone = (country?: string | null): boolean =>
  !!country && FRANC_ZONE.has(country.toUpperCase());

/** UEMOA settles in XOF, CEMAC in XAF. They are distinct currencies at par, not one. */
export function currencyForCountry(country?: string | null): string {
  if (!country) return 'USD';
  const code = country.toUpperCase();
  if ((UEMOA as readonly string[]).includes(code)) return 'XOF';
  if ((CEMAC as readonly string[]).includes(code)) return 'XAF';
  return 'USD';
}

export function gatewayForCountry(country?: string | null): Gateway {
  return isFrancZone(country) ? 'cinetpay' : 'paddle';
}

export interface RegionDefaults {
  country: string | null;
  currency: string;
  gateway: Gateway;
}

export function resolveRegion(country?: string | null): RegionDefaults {
  return {
    country: country?.toUpperCase() ?? null,
    currency: currencyForCountry(country),
    gateway: gatewayForCountry(country),
  };
}

/** Currencies the storefront can present today. Extend as the currency engine lands. */
export const SUPPORTED_CURRENCIES = ['USD', 'XOF', 'XAF', 'EUR'] as const;
