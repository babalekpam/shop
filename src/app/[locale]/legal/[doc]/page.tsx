import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  LEGAL_DOCS,
  LEGAL_SLUGS,
  hasOwnLegalTranslation,
  legalContent,
  splitPlaceholders,
  type LegalSlug,
} from '../../../../data/legal';

export function generateStaticParams() {
  return LEGAL_SLUGS.map((doc) => ({ doc }));
}

const isLegalSlug = (value: string): value is LegalSlug =>
  (LEGAL_SLUGS as string[]).includes(value);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; doc: string }>;
}): Promise<Metadata> {
  const { locale, doc } = await params;
  if (!isLegalSlug(doc)) return {};
  const content = legalContent(LEGAL_DOCS[doc], locale);
  return {
    title: content.title,
    description: content.lede,
    // Draft legal text should not be indexed. Removing `reviewPending` removes this too.
    robots: LEGAL_DOCS[doc].reviewPending ? { index: false, follow: false } : undefined,
  };
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ locale: string; doc: string }>;
}) {
  const { locale, doc } = await params;
  if (!isLegalSlug(doc)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'legal' });
  const document = LEGAL_DOCS[doc];
  const content = legalContent(document, locale);
  const translated = hasOwnLegalTranslation(document, locale);

  const updated = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
    new Date(document.updated),
  );

  return (
    <article className="section legal">
      <header className="legal-head">
        <h1 className="type-title-1">{content.title}</h1>
        <p className="type-body legal-lede">{content.lede}</p>
        <p className="type-caption">{t('updated', { date: updated })}</p>
      </header>

      {/* Draft status is stated at the top, not buried. Publishing legal text that has
          not been reviewed without saying so would be the dishonest option. */}
      {document.reviewPending && (
        <aside className="legal-notice" role="note">
          <p className="type-callout">{t('draftNotice')}</p>
        </aside>
      )}

      {/* An English fallback on a binding document has to be visible: a reader in Wolof
          needs to know they are reading a language they may not have chosen. */}
      {!translated && (
        <aside className="legal-notice legal-notice-quiet" role="note">
          <p className="type-caption">{t('englishFallback')}</p>
        </aside>
      )}

      {content.sections.map((section) => (
        <section key={section.heading} className="legal-section">
          <h2 className="type-title-3">{section.heading}</h2>
          {section.paragraphs.map((paragraph, index) => (
            <p key={index} className="type-body">
              {splitPlaceholders(paragraph).map((run, runIndex) =>
                run.placeholder ? (
                  <mark key={runIndex} className="legal-placeholder" title={t('placeholder')}>
                    {run.text}
                  </mark>
                ) : (
                  <span key={runIndex}>{run.text}</span>
                ),
              )}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
