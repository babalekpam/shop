import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getRegion } from '../../../lib/commerce/server-region';
import { CheckoutClient } from '../../../components/site/CheckoutClient';

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'checkout' });
  const region = await getRegion();

  return (
    <section className="section page-head">
      <h1 className="type-title-1">{t('title')}</h1>
      <CheckoutClient region={region} />
    </section>
  );
}
