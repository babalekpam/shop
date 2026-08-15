import { describe, expect, it } from 'vitest';

import {
  exponentFor,
  formatMoney,
  formatRecurring,
  toMajorUnits,
  toMinorUnits,
} from '../src/lib/format/money';

/**
 * Digits after the decimal separator in a formatted string.
 *
 * The separator is derived from the locale rather than assumed: a regex looking for
 * `[.,]` counts the grouping separator in "¥2,900" as three fraction digits, which is the
 * kind of wrong-by-locale assumption this whole module exists to prevent.
 */
function fractionDigits(formatted: string, locale = 'en-US'): number {
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ??
    '.';
  const index = formatted.lastIndexOf(decimal);
  if (index === -1) return 0;
  return formatted.slice(index + decimal.length).replace(/\D/g, '').length;
}

describe('minor-unit exponents', () => {
  it('knows the zero-decimal currencies', () => {
    for (const code of ['XOF', 'XAF', 'JPY', 'KRW', 'VND', 'CLP', 'RWF', 'UGX']) {
      expect(exponentFor(code)).toBe(0);
    }
  });

  it('knows the three-decimal currencies', () => {
    for (const code of ['KWD', 'BHD', 'OMR', 'TND', 'JOD', 'IQD']) {
      expect(exponentFor(code)).toBe(3);
    }
  });

  it('defaults to two for everything else', () => {
    for (const code of ['USD', 'EUR', 'GBP', 'NGN', 'ZAR']) {
      expect(exponentFor(code)).toBe(2);
    }
  });

  it('is case-insensitive', () => {
    expect(exponentFor('xof')).toBe(0);
    expect(exponentFor('kwd')).toBe(3);
  });

  it('prefers the currencies-table row over the built-in fallback', () => {
    // The table is the source of truth; the map is only a safety net.
    expect(exponentFor('XOF', { code: 'XOF', exponent: 2 })).toBe(2);
  });
});

describe('minor ↔ major conversion', () => {
  it('never assumes two decimal places', () => {
    // The failure this module exists to prevent: a hardcoded /100 makes these wrong by
    // 100× in Tokyo and 1000× in Kuwait City.
    expect(toMajorUnits(2900, 'USD')).toBe(29);
    expect(toMajorUnits(2900, 'JPY')).toBe(2900);
    expect(toMajorUnits(17500, 'XOF')).toBe(17500);
    expect(toMajorUnits(29000, 'KWD')).toBe(29);
  });

  it('round-trips through minor units', () => {
    for (const [amount, currency] of [
      [29, 'USD'],
      [2900, 'JPY'],
      [17500, 'XOF'],
      [29, 'KWD'],
    ] as const) {
      expect(toMajorUnits(toMinorUnits(amount, currency), currency)).toBe(amount);
    }
  });
});

describe('display formatting', () => {
  it('renders the decimals each currency actually has', () => {
    expect(fractionDigits(formatMoney(2900, { locale: 'en-US', currency: 'USD' }))).toBe(2);
    expect(fractionDigits(formatMoney(2900, { locale: 'en-US', currency: 'JPY' }))).toBe(0);
    expect(fractionDigits(formatMoney(17500, { locale: 'en-US', currency: 'XOF' }))).toBe(0);
    expect(fractionDigits(formatMoney(29000, { locale: 'en-US', currency: 'KWD' }))).toBe(3);
  });

  it('formats the catalog prices correctly', () => {
    expect(formatMoney(2900, { locale: 'en-US', currency: 'USD' })).toBe('$29.00');
    expect(formatMoney(350000, { locale: 'en-US', currency: 'USD' })).toBe('$3,500.00');
  });

  it('carries the amount through unscaled for zero-decimal currencies', () => {
    // 25,000 FCFA is 25000 minor units, not 250.
    const formatted = formatMoney(25000, { locale: 'fr-FR', currency: 'XOF' });
    expect(formatted.replace(/\D/g, '')).toBe('25000');
  });

  it('respects the locale, not just the currency', () => {
    const us = formatMoney(129900, { locale: 'en-US', currency: 'USD' });
    const fr = formatMoney(129900, { locale: 'fr-FR', currency: 'USD' });
    expect(us).not.toBe(fr);
    expect(us.replace(/\D/g, '')).toBe(fr.replace(/\D/g, ''));
  });

  it('honours a currencies-table exponent when formatting', () => {
    const formatted = formatMoney(2900, {
      locale: 'en-US',
      currency: 'XOF',
      meta: { code: 'XOF', exponent: 2 },
    });
    expect(fractionDigits(formatted)).toBe(2);
  });

  it('can drop the fraction for compact displays', () => {
    expect(
      fractionDigits(formatMoney(2900, { locale: 'en-US', currency: 'USD', omitFraction: true })),
    ).toBe(0);
  });

  it('appends an already-localised interval', () => {
    expect(
      formatRecurring(2900, 'mois', { locale: 'fr-FR', currency: 'USD' }),
    ).toMatch(/\/mois$/);
  });
});
