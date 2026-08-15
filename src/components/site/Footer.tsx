'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Logo } from '../brand/Logo';

export function Footer() {
  const t = useTranslations('footer');
  const tNav = useTranslations('nav');
  const tBrand = useTranslations('brand');
  const locale = useLocale();

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <Logo size="md" tagline={tBrand('tagline')} idSuffix="footer" />
          <p className="type-caption">{t('builtWith')}</p>
        </div>

        <nav className="site-footer-nav" aria-label={t('products')}>
          <h2 className="type-caption site-footer-heading">{t('products')}</h2>
          <Link href={`/${locale}/services`}>{tNav('security')}</Link>
          <Link href={`/${locale}/software`}>{tNav('software')}</Link>
          <Link href={`/${locale}/downloads`}>{tNav('downloads')}</Link>
        </nav>

        <nav className="site-footer-nav" aria-label={t('legal')}>
          <h2 className="type-caption site-footer-heading">{t('legal')}</h2>
          <Link href={`/${locale}/legal/terms`}>{t('terms')}</Link>
          <Link href={`/${locale}/legal/privacy`}>{t('privacy')}</Link>
          <Link href={`/${locale}/legal/refunds`}>{t('refunds')}</Link>
        </nav>
      </div>

      <p className="type-caption site-footer-rights">
        {t('rights', { year: new Date().getFullYear() })}
      </p>
    </footer>
  );
}
