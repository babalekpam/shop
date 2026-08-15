import { describe, expect, it } from 'vitest';

import {
  LEGAL_DOCS,
  LEGAL_SLUGS,
  hasOwnLegalTranslation,
  legalContent,
  splitPlaceholders,
} from '../src/data/legal';

const docs = LEGAL_SLUGS.map((slug) => LEGAL_DOCS[slug]);

/** Every `[[placeholder]]` in a document, across every locale it ships in. */
function placeholdersIn(slug: (typeof LEGAL_SLUGS)[number]): string[] {
  const doc = LEGAL_DOCS[slug];
  return Object.values(doc.locales)
    .filter((content) => content !== undefined)
    .flatMap((content) => content.sections)
    .flatMap((section) => section.paragraphs)
    .flatMap((paragraph) => splitPlaceholders(paragraph))
    .filter((run) => run.placeholder)
    .map((run) => run.text);
}

describe('legal documents', () => {
  it('exists for every route the footer links to', () => {
    expect(LEGAL_SLUGS).toEqual(['terms', 'privacy', 'refunds']);
    for (const doc of docs) {
      expect(doc.locales.en.sections.length).toBeGreaterThan(0);
    }
  });

  it('ships English and French, and falls back for the rest', () => {
    for (const doc of docs) {
      expect(hasOwnLegalTranslation(doc, 'en')).toBe(true);
      expect(hasOwnLegalTranslation(doc, 'fr')).toBe(true);
      // Deliberate: a binding commitment is not machine-translated into a language
      // nobody on the team reads. Other locales get English, and the page says so.
      expect(hasOwnLegalTranslation(doc, 'wo')).toBe(false);
      expect(legalContent(doc, 'wo')).toBe(doc.locales.en);
    }
  });

  it('carries a dated version', () => {
    for (const doc of docs) {
      expect(doc.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(doc.updated))).toBe(false);
    }
  });

  it('states the governing language, since only two are published', () => {
    for (const doc of docs) {
      const en = doc.locales.en.sections.flatMap((s) => s.paragraphs).join(' ');
      const fr = doc.locales.fr?.sections.flatMap((s) => s.paragraphs).join(' ') ?? '';
      expect(en).toMatch(/English version governs/i);
      expect(fr).toMatch(/version anglaise prévaut/i);
    }
  });

  /**
   * The launch gate.
   *
   * A document may carry unfilled placeholders *or* be marked reviewed — never both.
   * Clearing `reviewPending` is what removes the draft banner and re-enables indexing,
   * so without this a document could be declared final with "[[governing jurisdiction]]"
   * still in it, and nothing would catch it.
   */
  it('cannot be marked reviewed while placeholders remain', () => {
    for (const slug of LEGAL_SLUGS) {
      const doc = LEGAL_DOCS[slug];
      if (!doc.reviewPending) {
        expect(placeholdersIn(slug), `${slug} is marked reviewed but still has placeholders`).toEqual(
          [],
        );
      }
    }
  });

  it('tracks what is still outstanding on each draft', () => {
    // Not an assertion about the count — that changes as counsel fills them in. It
    // asserts the drafts are honest about being incomplete rather than silently thin.
    for (const slug of LEGAL_SLUGS) {
      const doc = LEGAL_DOCS[slug];
      if (doc.reviewPending) {
        expect(placeholdersIn(slug).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('placeholder parsing', () => {
  it('separates placeholders from prose', () => {
    expect(splitPlaceholders('Governed by [[jurisdiction]] law.')).toEqual([
      { text: 'Governed by ', placeholder: false },
      { text: 'jurisdiction', placeholder: true },
      { text: ' law.', placeholder: false },
    ]);
  });

  it('handles several in one paragraph', () => {
    const runs = splitPlaceholders('Write to [[email]] within [[window]] days.');
    expect(runs.filter((r) => r.placeholder).map((r) => r.text)).toEqual(['email', 'window']);
  });

  it('leaves ordinary prose untouched', () => {
    expect(splitPlaceholders('No placeholders here.')).toEqual([
      { text: 'No placeholders here.', placeholder: false },
    ]);
  });

  it('does not treat a single bracket as a placeholder', () => {
    expect(splitPlaceholders('An array like [1] is not a placeholder.')).toEqual([
      { text: 'An array like [1] is not a placeholder.', placeholder: false },
    ]);
  });
});
