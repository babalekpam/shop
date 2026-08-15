'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Logo } from '../brand/Logo';
import { useCart } from '../../lib/commerce/cart';
import { LocaleSwitcher } from './LocaleSwitcher';
import { Toolbar } from '../ui/Toolbar';

/**
 * Site header.
 *
 * Nav items are named for their contents, not for vague umbrellas: "Security &
 * Engineering", not "Services"; "Your account", not "Dashboard". Specificity is what
 * makes navigation predictable.
 *
 * The bar is a translucent floating layer with content scrolling underneath, and the
 * scroll edge appears only once content is genuinely behind it.
 */
export function Header() {
  const t = useTranslations('nav');
  const tBrand = useTranslations('brand');
  const locale = useLocale();
  const { count, setOpen } = useCart();

  const links = [
    { href: `/${locale}/services`, label: t('security') },
    { href: `/${locale}/software`, label: t('software') },
    { href: `/${locale}/downloads`, label: t('downloads') },
  ];

  return (
    <Toolbar className="site-header">
      <Link href={`/${locale}`} className="site-logo" aria-label="ARGILETTE">
        <Logo size="sm" tagline={tBrand('tagline')} idSuffix="header" />
      </Link>

      <nav className="site-nav" aria-label={t('openMenu')}>
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="site-nav-link">
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="site-header-actions">
        <LocaleSwitcher />
        <button
          type="button"
          className="cart-button"
          onClick={() => setOpen(true)}
          aria-label={t('cartWithCount', { count })}
        >
          <CartIcon />
          {count > 0 && (
            <span className="cart-badge type-caption" aria-hidden="true">
              {count}
            </span>
          )}
        </button>
      </div>
    </Toolbar>
  );
}

/** A bag, not an arrow — the metaphor should be the object, and objects do not mirror. */
function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M6 8h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9 8V6.5a3 3 0 0 1 6 0V8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
