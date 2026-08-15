'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Price } from '../ui/Price';
import { useCart, type CartLine } from '../../lib/commerce/cart';
import { bySlug, localise } from '../../data/catalog';
import { formatMoney } from '../../lib/format/money';

/**
 * Cart drawer.
 *
 * A **parallel** task, not a modal one: it opens from the inline edge with no scrim, so
 * the catalog stays visible and browsable behind it. Dimming here would break the flow
 * for no gain — nothing about reviewing a cart demands undivided attention.
 *
 * Anchored to `inline-end`, so it arrives from the right in English and from the left in
 * Arabic without a second code path.
 *
 * Removing a line is undo-with-a-toast, never a confirmation dialog. Confirmation is
 * reserved for genuinely destructive, irreversible actions; spending it here would train
 * people to click through the one dialog that matters.
 */
export function CartDrawer() {
  const t = useTranslations('cart');
  const tPrice = useTranslations('price');
  const locale = useLocale();
  const { lines, open, setOpen, subtotalMinor, currency, remove, restore, isLocked } = useCart();
  const [undoable, setUndoable] = useState<CartLine | null>(null);

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      edge="inline-end"
      modal={false}
      aria-label={t('title')}
    >
      <div className="cart-drawer">
        <header className="cart-drawer-head">
          <h2 className="type-title-2">{t('title')}</h2>
          <Button variant="plain" onClick={() => setOpen(false)}>
            {t('close')}
          </Button>
        </header>

        {lines.length === 0 ? (
          <div className="cart-empty">
            <p className="type-body">{t('empty')}</p>
            <p className="type-caption">{t('emptyHint')}</p>
          </div>
        ) : (
          <ul className="cart-lines">
            {lines.map((line) => {
              const sku = bySlug(line.slug);
              if (!sku) return null;
              return (
                <li key={line.slug} className="cart-line">
                  <div className="cart-line-main">
                    <p className="type-callout">{localise(sku.name, locale)}</p>
                    <Price
                      amountMinor={line.lockedAmountMinor * line.quantity}
                      currency={line.currency}
                      locale={locale}
                      locked={isLocked(line)}
                      lockedLabel={tPrice('locked')}
                      size="body"
                    />
                  </div>
                  <Button
                    variant="plain"
                    onClick={() => {
                      setUndoable(line);
                      remove(line.slug);
                    }}
                  >
                    {t('remove')}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {undoable && (
          <div className="cart-undo" role="status">
            <span className="type-caption">
              {t('removed', { name: localise(bySlug(undoable.slug)?.name ?? { en: '' }, locale) })}
            </span>
            <Button
              variant="plain"
              onClick={() => {
                restore(undoable);
                setUndoable(null);
              }}
            >
              {t('undo')}
            </Button>
          </div>
        )}

        {lines.length > 0 && currency && (
          <footer className="cart-drawer-foot">
            <div className="cart-subtotal">
              <span className="type-callout">{t('subtotal')}</span>
              <span className="type-title-3 type-money">
                {formatMoney(subtotalMinor, { locale, currency })}
              </span>
            </div>
            <p className="type-caption">{t('taxNote')}</p>
            <Link
              href={`/${locale}/checkout`}
              className="btn btn-primary cart-checkout"
              onClick={() => setOpen(false)}
            >
              {t('checkout')}
            </Link>
          </footer>
        )}
      </div>
    </Sheet>
  );
}
