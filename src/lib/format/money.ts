/**
 * Money display.
 *
 * Scope: this module *renders* an amount that has already been decided. Conversion,
 * strategic overrides, rounding rules and the FX snapshot belong to the currency engine
 * (build spec §4) and are not duplicated here.
 *
 * The one rule this module exists to enforce: **never divide by 100.** Minor-unit
 * exponents vary — XOF and JPY have none, KWD has three — and a hardcoded exponent
 * produces invoices wrong by 100× in Tokyo and 1000× in Kuwait City. The exponent comes
 * from the currency table, always.
 *
 * See docs/design-system.md §4.3 and build spec §4 "Decimal handling".
 */

export interface CurrencyMeta {
  code: string;
  /** Minor-unit exponent: 0 for XOF/JPY, 2 for USD/EUR, 3 for KWD. */
  exponent: number;
}

/**
 * Fallback exponents, for the currencies where getting it wrong is most expensive.
 *
 * This is a safety net, not the source of truth — the `currencies` table is (build spec
 * §4). It exists so a missing row degrades to a correct render rather than a silently
 * wrong one, and so this module is usable before the table is wired up.
 */
const EXPONENT_FALLBACKS: Readonly<Record<string, number>> = {
  // Zero-decimal
  XOF: 0, XAF: 0, JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, RWF: 0, UGX: 0, PYG: 0,
  KMF: 0, DJF: 0, GNF: 0, BIF: 0,
  // Three-decimal
  KWD: 3, BHD: 3, OMR: 3, TND: 3, JOD: 3, IQD: 3, LYD: 3,
};

const DEFAULT_EXPONENT = 2;

/** The minor-unit exponent for a currency, preferring the passed table row. */
export function exponentFor(currency: string, meta?: CurrencyMeta): number {
  if (meta && Number.isInteger(meta.exponent)) return meta.exponent;
  const code = currency.toUpperCase();
  return EXPONENT_FALLBACKS[code] ?? DEFAULT_EXPONENT;
}

/** Minor units → major units. The only place the division happens. */
export function toMajorUnits(amountMinor: number, currency: string, meta?: CurrencyMeta): number {
  return amountMinor / 10 ** exponentFor(currency, meta);
}

/** Major units → minor units, rounded to the nearest whole minor unit. */
export function toMinorUnits(amountMajor: number, currency: string, meta?: CurrencyMeta): number {
  return Math.round(amountMajor * 10 ** exponentFor(currency, meta));
}

export interface FormatMoneyOptions {
  /** BCP-47 locale. Drives digit shaping, grouping and symbol placement. */
  locale: string;
  currency: string;
  /**
   * Row from the `currencies` table. Falls back to the built-in map when absent.
   *
   * Explicitly `| undefined` so callers can forward an optional prop straight through
   * under `exactOptionalPropertyTypes` without having to conditionally build the object.
   */
  meta?: CurrencyMeta | undefined;
  /** Drop the fractional part even where the currency has one — for compact displays. */
  omitFraction?: boolean | undefined;
}

/**
 * Format an amount in minor units for display.
 *
 * `Intl.NumberFormat` handles symbol placement, grouping separators and digit shaping per
 * locale — all of which vary in ways worth never hand-rolling. We only tell it how many
 * fraction digits the currency actually has.
 */
export function formatMoney(amountMinor: number, options: FormatMoneyOptions): string {
  const { locale, currency, meta, omitFraction } = options;
  const exponent = exponentFor(currency, meta);
  const digits = omitFraction ? 0 : exponent;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(toMajorUnits(amountMinor, currency, meta));
}

/**
 * Format a recurring price with its interval, e.g. "$29.00/month".
 *
 * The interval is passed already localised — assembling it from a translation key here
 * would hide a string from the coverage report, and several of our locales do not follow
 * English plural rules (build spec §5).
 */
export function formatRecurring(
  amountMinor: number,
  localisedInterval: string,
  options: FormatMoneyOptions,
): string {
  return `${formatMoney(amountMinor, options)}/${localisedInterval}`;
}
