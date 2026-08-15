import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, dirFor, isLocale } from '../../i18n/routing';
import { CartProvider } from '../../lib/commerce/cart';
import { Header } from '../../components/site/Header';
import { Footer } from '../../components/site/Footer';
import { CartDrawer } from '../../components/site/CartDrawer';
import '../../styles/index.css';
import '../../styles/site.css';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  // The brand navy and the light surface, so the browser chrome matches the page rather
  // than flashing white behind a dark header on mobile.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfbfd' },
    { media: '(prefers-color-scheme: dark)', color: '#131c26' },
  ],
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'brand' });

  return {
    title: {
      default: `ARGILETTE — ${t('tagline')}`,
      template: '%s — ARGILETTE',
    },
    description:
      'Security, software and engineering from ARGILETTE. Every product and service has a price and a buy button.',
    metadataBase: process.env.NEXT_PUBLIC_SITE_URL
      ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
      : undefined,
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);
  const messages = await getMessages({ locale });

  return (
    // `dir` here is what makes every logical property and every gesture in the design
    // system resolve correctly. It is set once, at the root, from the locale.
    <html lang={locale} dir={dirFor(locale)} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <CartProvider>
            <a className="skip-link" href="#main">
              {messages.nav && typeof messages.nav === 'object'
                ? ((messages.nav as Record<string, string>).skipToContent ?? 'Skip to content')
                : 'Skip to content'}
            </a>
            <Header />
            <main id="main" className="site-main">
              {children}
            </main>
            <Footer />
            <CartDrawer />
          </CartProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
