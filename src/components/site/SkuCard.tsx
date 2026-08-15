'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '../ui/Button';
import { Price } from '../ui/Price';
import { currenciesFor, localise, priceFor, type Sku } from '../../data/catalog';
import { useCart } from '../../lib/commerce/cart';

export interface SkuCardProps {
  sku: Sku;
  /** The currency resolved for this visitor, from their region. */
  currency: string;
}

export function SkuCard({ sku, currency }: SkuCardProps) {
  const t = useTranslations('catalog');
  const locale = useLocale();
  const { add, setOpen } = useCart();
  const [justAdded, setJustAdded] = useState(false);

  // Fall back to whatever the SKU is actually priced in. Several products are
  // FCFA-native — NaviMED is priced for a Lomé cabinet, not converted down from a US
  // number — and showing them as unavailable because the visitor resolved to USD would
  // hide the catalog's most important products from most of the world.
  const available = currenciesFor(sku);
  const displayCurrency = available.includes(currency) ? currency : (available[0] ?? 'USD');
  const price = priceFor(sku, displayCurrency);

  if (!price) return null;

  const interval =
    sku.interval === 'once' ? undefined : t(`interval.${sku.interval}` as 'interval.month');

  return (
    <article className="sku-card" data-tier={sku.tier}>
      <div className="sku-card-body">
        <h3 className="type-title-3">{localise(sku.name, locale)}</h3>
        <p className="type-callout sku-card-summary">{localise(sku.summary, locale)}</p>

        {sku.delivery && (
          <p className="type-caption sku-card-delivery">
            {t('delivery')}: {localise(sku.delivery, locale)}
          </p>
        )}
      </div>

      <div className="sku-card-foot">
        <Price
          amountMinor={price.amountMinor}
          currency={displayCurrency}
          locale={locale}
          {...(interval ? { interval } : {})}
          size="title-2"
        />

        <div className="sku-card-actions">
          {sku.href && (
            <a
              className="btn btn-plain type-caption"
              href={sku.href}
              rel="noreferrer noopener"
              target="_blank"
            >
              {t('learnMore')}
            </a>
          )}
          <Button
            variant="primary"
            haptic
            onClick={() => {
              add(sku, displayCurrency);
              setJustAdded(true);
              setOpen(true);
              window.setTimeout(() => setJustAdded(false), 1500);
            }}
          >
            {justAdded ? t('added') : t('addToCart')}
          </Button>
        </div>
      </div>
    </article>
  );
}
