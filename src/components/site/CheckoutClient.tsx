'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '../ui/Button';
import { Price } from '../ui/Price';
import { PaymentStatus, type PaymentPhase } from '../ui/PaymentStatus';
import { useCart } from '../../lib/commerce/cart';
import { bySlug, localise } from '../../data/catalog';
import { formatMoney } from '../../lib/format/money';
import type { Gateway, RegionDefaults } from '../../lib/commerce/region';

export interface CheckoutClientProps {
  region: RegionDefaults;
}

export function CheckoutClient({ region }: CheckoutClientProps) {
  const t = useTranslations('checkout');
  const tCart = useTranslations('cart');
  const tPrice = useTranslations('price');
  const tPayment = useTranslations('payment');
  const locale = useLocale();
  const { lines, subtotalMinor, currency, isLocked } = useCart();

  const [gateway, setGateway] = useState<Gateway>(region.gateway);
  const [phase, setPhase] = useState<PaymentPhase | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const displayCurrency = currency ?? region.currency;

  async function pay() {
    setProblem(null);
    setStartedAt(Date.now());
    setPhase('submitting');

    const response = await fetch('/api/checkout/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lines, gateway, locale }),
    });

    if (response.ok) {
      // Sprint 3/4 hands off to the gateway here. Deliberately unreachable until the
      // session route is implemented — and even then, access comes from the webhook, so
      // this branch never grants anything.
      setPhase('awaiting_confirmation');
      return;
    }

    const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
    setPhase('failed');
    setProblem(detail?.detail ?? `Checkout is not available yet (${response.status}).`);
  }

  if (lines.length === 0) {
    return (
      <div className="checkout-empty">
        <p className="type-body">{tCart('empty')}</p>
      </div>
    );
  }

  if (phase) {
    return (
      <div className="checkout-status">
        <PaymentStatus
          phase={phase}
          startedAt={startedAt}
          locale={locale}
          onRetry={() => setPhase(null)}
          strings={{
            submitting: tPayment('submitting'),
            awaitingTitle: tPayment('awaitingTitle'),
            awaitingDetail: tPayment('awaitingDetail'),
            verifying: tPayment('verifying'),
            confirmed: tPayment('confirmed'),
            failed: tPayment('failed'),
            safeToLeave: tPayment('safeToLeave'),
            elapsedLabel: (duration) => tPayment('elapsed', { duration }),
            retry: tPayment('retry'),
          }}
        />
        {problem && (
          <p className="type-caption checkout-problem" role="status">
            {problem}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="checkout">
      <section className="checkout-summary">
        <h2 className="type-title-3">{t('summary')}</h2>
        <ul className="checkout-lines">
          {lines.map((line) => {
            const sku = bySlug(line.slug);
            if (!sku) return null;
            return (
              <li key={line.slug} className="checkout-line">
                <span className="type-callout">{localise(sku.name, locale)}</span>
                <Price
                  amountMinor={line.lockedAmountMinor * line.quantity}
                  currency={line.currency}
                  locale={locale}
                  locked={isLocked(line)}
                  lockedLabel={tPrice('locked')}
                  size="body"
                />
              </li>
            );
          })}
        </ul>
        <div className="checkout-total">
          <span className="type-callout">{tCart('subtotal')}</span>
          <span className="type-title-2 type-money">
            {formatMoney(subtotalMinor, { locale, currency: displayCurrency })}
          </span>
        </div>
      </section>

      <section className="checkout-gateway">
        <h2 className="type-title-3">{t('payWith')}</h2>

        {/* Geo picked the default; the override is a visible control on the page, not a
            buried link. A diaspora customer paying for a Lomé clinic must be able to reach
            the mobile-money path without hunting for it. */}
        <fieldset className="gateway-options">
          <legend className="visually-hidden">{t('payWith')}</legend>

          <label className="gateway-option">
            <input
              type="radio"
              name="gateway"
              value="paddle"
              checked={gateway === 'paddle'}
              onChange={() => setGateway('paddle')}
            />
            <span>
              <span className="type-callout gateway-name">{t('paddle')}</span>
              <span className="type-caption">{t('paddleDetail')}</span>
            </span>
          </label>

          <label className="gateway-option">
            <input
              type="radio"
              name="gateway"
              value="cinetpay"
              checked={gateway === 'cinetpay'}
              onChange={() => setGateway('cinetpay')}
            />
            <span>
              <span className="type-callout gateway-name">{t('cinetpay')}</span>
              <span className="type-caption">{t('cinetpayDetail')}</span>
            </span>
          </label>
        </fieldset>

        {region.country && <p className="type-caption">{t('regionNote')}</p>}

        <Button variant="primary" haptic onClick={pay} className="checkout-pay">
          {t('pay', { amount: formatMoney(subtotalMinor, { locale, currency: displayCurrency }) })}
        </Button>

        {/* Card fields live on the provider's own page. Saying so reduces the anxiety that
            costs conversions, and it is also literally what keeps us in PCI SAQ-A. */}
        <p className="type-caption checkout-security">{t('securityNote')}</p>
      </section>
    </div>
  );
}
