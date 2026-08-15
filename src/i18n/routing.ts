import { defineRouting } from 'next-intl/routing';

/**
 * The ten launch locales (build spec §5).
 *
 * Arabic is here on day one, not deferred — which makes RTL a layout requirement across
 * every screen rather than a phase-2 nicety.
 */
export const LOCALES = ['en', 'fr', 'pt', 'es', 'ar', 'sw', 'ha', 'yo', 'ee', 'wo'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Locales written right-to-left. Drives `dir` and the logical-axis gesture flip. */
const RTL_LOCALES = new Set<string>(['ar']);

export const isRtl = (locale: string): boolean => RTL_LOCALES.has(locale);
export const dirFor = (locale: string): 'ltr' | 'rtl' => (isRtl(locale) ? 'rtl' : 'ltr');

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

/**
 * Country → default locale. A default, never a lock: the switcher is always reachable,
 * and the choice is persisted in a cookie that outranks geo on the next request.
 */
export const LOCALE_BY_COUNTRY: Readonly<Record<string, Locale>> = {
  // Francophone West and Central Africa
  TG: 'fr', BJ: 'fr', BF: 'fr', CI: 'fr', ML: 'fr', NE: 'fr', SN: 'fr', GN: 'fr',
  CM: 'fr', CF: 'fr', TD: 'fr', CG: 'fr', GA: 'fr', FR: 'fr', BE: 'fr', CH: 'fr',
  // Lusophone
  PT: 'pt', BR: 'pt', AO: 'pt', MZ: 'pt', GW: 'pt', CV: 'pt',
  // Hispanophone
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es',
  // Arabic
  MA: 'ar', DZ: 'ar', TN: 'ar', EG: 'ar', LY: 'ar', SA: 'ar', AE: 'ar', KW: 'ar',
  QA: 'ar', BH: 'ar', OM: 'ar', JO: 'ar', IQ: 'ar',
  // Swahili
  KE: 'sw', TZ: 'sw', UG: 'sw', CD: 'sw', RW: 'sw',
};

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
  localeDetection: false, // handled in middleware, from CF-IPCountry plus the cookie
});
