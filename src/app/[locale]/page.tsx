import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { featured } from '../../data/catalog';
import { getRegion } from '../../lib/commerce/server-region';
import { SkuCard } from '../../components/site/SkuCard';
import { Logo } from '../../components/brand/Logo';

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'home' });
  const tTiers = await getTranslations({ locale, namespace: 'tiers' });
  const tBrand = await getTranslations({ locale, namespace: 'brand' });
  const { currency } = await getRegion();

  const tiers = [
    { key: 'security', href: `/${locale}/services` },
    { key: 'software', href: `/${locale}/software` },
    { key: 'downloads', href: `/${locale}/downloads` },
  ] as const;

  return (
    <>
      <section className="hero">
        <Logo variant="stacked" size="lg" tagline={tBrand('tagline')} idSuffix="hero" />
        <h1 className="type-display hero-title">{t('title')}</h1>
        <p className="type-body hero-lede">{t('lede')}</p>
        <div className="hero-actions">
          <Link href={`/${locale}/services`} className="btn btn-primary">
            {t('ctaPrimary')}
          </Link>
          <Link href={`/${locale}/software`} className="btn btn-secondary">
            {t('ctaSecondary')}
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="tier-grid">
          {tiers.map((tier) => (
            <Link key={tier.key} href={tier.href} className="tier-card">
              <h2 className="type-title-3">{tTiers(`${tier.key}.name`)}</h2>
              <p className="type-callout">{tTiers(`${tier.key}.blurb`)}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="type-title-1 section-heading">{t('featured')}</h2>
        <div className="sku-grid">
          {featured().map((sku) => (
            <SkuCard key={sku.slug} sku={sku} currency={currency} />
          ))}
        </div>
      </section>

      <section className="section">
        <p className="type-callout credentials">{t('credentials')}</p>
      </section>
    </>
  );
}
