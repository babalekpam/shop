import { getTranslations, setRequestLocale } from 'next-intl/server';
import { byTier } from '../../../data/catalog';
import { getRegion } from '../../../lib/commerce/server-region';
import { SkuCard } from '../../../components/site/SkuCard';

export default async function ServicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'tiers' });
  const tCatalog = await getTranslations({ locale, namespace: 'catalog' });
  const { currency } = await getRegion();

  return (
    <>
      <section className="section page-head" data-tier="security">
        <h1 className="type-title-1">{t('security.name')}</h1>
        <p className="type-body page-lede">{t('security.blurb')}</p>
        {/* Services are not instant delivery. Saying so before payment, not after, is the
            difference between a managed expectation and a support ticket. */}
        <p className="type-caption page-note">{tCatalog('notInstant')}</p>
      </section>

      <section className="section">
        <div className="sku-grid">
          {[...byTier('security'), ...byTier('engineering')].map((sku) => (
            <SkuCard key={sku.slug} sku={sku} currency={currency} />
          ))}
        </div>
      </section>
    </>
  );
}
