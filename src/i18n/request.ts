import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, isLocale } from './routing';

type Messages = Record<string, unknown>;

/**
 * Deep-merge a locale's messages over English.
 *
 * Build spec §5: *"a locale below 100% coverage falls back to `en` per-key, never per
 * page."* A page-level fallback would flip a half-translated screen entirely into
 * English, which is worse than a single untranslated label — the customer loses their
 * place. Merging per key means a missing string is the only thing that changes.
 */
function mergeWithFallback(base: Messages, override: Messages): Messages {
  const merged: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      merged[key] = mergeWithFallback(existing as Messages, value as Messages);
    } else if (value !== undefined && value !== '') {
      merged[key] = value;
    }
  }
  return merged;
}

async function load(locale: string): Promise<Messages> {
  try {
    return (await import(`../../messages/${locale}.json`)).default as Messages;
  } catch {
    // A locale with no message file yet is served entirely from the fallback rather than
    // crashing the route. CI reports the coverage gap; the customer still gets a page.
    return {};
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : DEFAULT_LOCALE;

  const fallback = await load(DEFAULT_LOCALE);
  const messages = locale === DEFAULT_LOCALE ? fallback : mergeWithFallback(fallback, await load(locale));

  return {
    locale,
    messages,
    // Formats stay locale-driven via Intl; money specifically goes through
    // src/lib/format/money.ts so the minor-unit exponent is never assumed.
    now: new Date(),
  };
});
