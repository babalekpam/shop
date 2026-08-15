import { getTranslations, setRequestLocale } from 'next-intl/server';
import { byTier } from '../../../data/catalog';
import { getRegion } from '../../../lib/commerce/server-region';
import { SkuCard } from '../../../components/site/SkuCard';

export default async function DownloadsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'tiers' });
  const { currency } = await getRegion();

  return (
    <>
      <section className="section page-head">
        <h1 className="type-title-1">{t('downloads.name')}</h1>
        <p className="type-body page-lede">{t('downloads.blurb')}</p>
      </section>

      <section className="section">
        <div className="sku-grid">
          {byTier('downloads').map((sku) => (
            <SkuCard key={sku.slug} sku={sku} currency={currency} />
          ))}
        </div>
      </section>
    </>
  );
}
