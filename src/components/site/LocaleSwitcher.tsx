'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { LOCALES } from '../../i18n/routing';

/** Endonyms — a language is listed as its own speakers write it, never translated. */
const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  fr: 'Français',
  pt: 'Português',
  es: 'Español',
  ar: 'العربية',
  sw: 'Kiswahili',
  ha: 'Hausa',
  yo: 'Yorùbá',
  ee: 'Eʋegbe',
  wo: 'Wolof',
};

/**
 * Locale switcher.
 *
 * The choice is persisted in a cookie that outranks the geo header on every later
 * request, so someone who picks French in Lomé is not switched back next visit. Geo is a
 * default, never a lock.
 */
export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('nav');
  const [pending, startTransition] = useTransition();

  const change = (next: string) => {
    // A year, so the preference survives the trip. Lax is enough — this is not a
    // credential and it is only read on top-level navigation.
    document.cookie = `ARGILETTE_LOCALE=${next}; path=/; max-age=31536000; samesite=lax`;
    const rest = pathname.replace(new RegExp(`^/${locale}`), '') || '';
    startTransition(() => {
      router.replace(`/${next}${rest}`);
      router.refresh();
    });
  };

  return (
    <label className="locale-switcher">
      <span className="visually-hidden">{t('language')}</span>
      <select
        value={locale}
        onChange={(event) => change(event.target.value)}
        disabled={pending}
        className="locale-select type-caption"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_NAMES[code] ?? code}
          </option>
        ))}
      </select>
    </label>
  );
}
