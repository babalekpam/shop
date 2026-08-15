/**
 * Catalog seed.
 *
 * This is a typed stand-in for the `products` / `plans` / `prices` tables in build spec
 * §6, so the storefront has something real to render before Sprint 1 wires up Drizzle.
 * The shapes deliberately mirror the schema — minor units, explicit currency, strategic
 * overrides separate from the USD base — so replacing this file with a database query is
 * a swap, not a rewrite.
 *
 * Two catalog rules from the spec are enforced here rather than left to reviewers:
 *
 *   · **COBO is not sellable.** A payment platform under BCEAO licensing carries
 *     obligations that sit well outside a storefront checkout. It is linked, never
 *     transacted, until the licensing position is settled.
 *   · **The lead lists are not products.** Reselling personal contact data creates real
 *     GDPR and ECOWAS exposure. They are internal assets. A market map — counts and
 *     categories, no named individuals — is a different artefact and could ship later.
 */

export type Tier = 'security' | 'engineering' | 'software' | 'downloads';
export type ProductType = 'service' | 'subscription' | 'download';
export type BillingInterval = 'once' | 'month' | 'year';

/**
 * Translatable content, keyed by locale.
 *
 * Mirrors the `*_i18n` side tables rather than a JSONB blob, so coverage stays
 * queryable. `en` is required; everything else falls back to it per key, never per page.
 */
export type Localised = { en: string } & Partial<Record<string, string>>;

export interface Price {
  currency: string;
  amountMinor: number;
  /**
   * `override` prices are hand-set for purchasing power and always beat FX conversion.
   * West African purchasing power is not US purchasing power, and the FX-converted
   * equivalent of a US price would be nonsense in Lomé.
   */
  source: 'base' | 'override';
}

export interface Sku {
  slug: string;
  tier: Tier;
  type: ProductType;
  interval: BillingInterval;
  name: Localised;
  summary: Localised;
  /** Promised turnaround. Services are not instant delivery, and the page must say so. */
  delivery?: Localised;
  prices: Price[];
  /** Marketing site for the product, kept as its own domain. */
  href?: string;
  featured?: boolean;
}

export const localise = (field: Localised, locale: string): string =>
  field[locale] ?? field.en;

/** The price to display for a currency, preferring a strategic override. */
export function priceFor(sku: Sku, currency: string): Price | undefined {
  const matches = sku.prices.filter((p) => p.currency === currency);
  return matches.find((p) => p.source === 'override') ?? matches[0];
}

/** Currencies this SKU can actually be sold in today. */
export const currenciesFor = (sku: Sku): string[] => [
  ...new Set(sku.prices.map((p) => p.currency)),
];

const usd = (amountMinor: number): Price => ({ currency: 'USD', amountMinor, source: 'base' });
const xof = (amountMinor: number): Price => ({
  currency: 'XOF',
  amountMinor,
  source: 'override',
});

export const CATALOG: Sku[] = [
  // ---- Tier 1 — NeVral. Highest revenue per unit in the portfolio. ---------------
  {
    slug: 'pentest-web-app',
    tier: 'security',
    type: 'service',
    interval: 'once',
    featured: true,
    name: {
      en: 'External penetration test — single web application',
      fr: "Test d'intrusion externe — application web",
    },
    summary: {
      en: 'Full external assessment of one web application, with a written report and a remediation walkthrough.',
      fr: "Évaluation externe complète d'une application web, avec rapport écrit et accompagnement à la remédiation.",
    },
    delivery: { en: '2 weeks + report', fr: '2 semaines + rapport' },
    prices: [usd(350000)],
  },
  {
    slug: 'pentest-network',
    tier: 'security',
    type: 'service',
    interval: 'once',
    featured: true,
    name: {
      en: 'Penetration test — full network and application',
      fr: "Test d'intrusion — réseau et applications",
    },
    summary: {
      en: 'Network and application testing across your estate, with prioritised findings.',
      fr: "Tests réseau et applicatifs sur l'ensemble du périmètre, avec priorisation des résultats.",
    },
    delivery: { en: '3–4 weeks', fr: '3–4 semaines' },
    prices: [usd(850000)],
  },
  {
    slug: 'vulnerability-management',
    tier: 'security',
    type: 'subscription',
    interval: 'month',
    name: { en: 'Vulnerability management — continuous', fr: 'Gestion des vulnérabilités — continue' },
    summary: {
      en: 'Continuous scanning, triage and tracked remediation.',
      fr: 'Analyse continue, tri et suivi de la remédiation.',
    },
    prices: [usd(49900)],
  },
  {
    slug: 'soc-monitoring',
    tier: 'security',
    type: 'subscription',
    interval: 'month',
    name: { en: 'SOC / IDS-SIEM monitoring', fr: 'Supervision SOC / IDS-SIEM' },
    summary: { en: '24/7 monitoring, detection and escalation.', fr: 'Supervision, détection et escalade 24/7.' },
    prices: [usd(150000)],
  },
  {
    slug: 'threat-intelligence',
    tier: 'security',
    type: 'subscription',
    interval: 'month',
    name: { en: 'Threat intelligence feed', fr: 'Flux de renseignement sur les menaces' },
    summary: { en: 'Curated intelligence relevant to your sector and region.', fr: 'Renseignement ciblé sur votre secteur et votre région.' },
    prices: [usd(29900)],
  },
  {
    slug: 'deepfake-forensics',
    tier: 'security',
    type: 'service',
    interval: 'once',
    name: { en: 'Deepfake and image forensics — per case', fr: 'Analyse forensique deepfake et image — par dossier' },
    summary: { en: 'Authenticity analysis of a disputed image or video, with an evidential report.', fr: "Analyse d'authenticité d'une image ou vidéo contestée, avec rapport probatoire." },
    delivery: { en: '5 days', fr: '5 jours' },
    prices: [usd(75000)],
  },
  {
    slug: 'soc2-readiness',
    tier: 'security',
    type: 'subscription',
    interval: 'year',
    featured: true,
    name: { en: 'Compliance automation — SOC 2 Type I readiness', fr: 'Automatisation de conformité — préparation SOC 2 Type I' },
    summary: { en: 'Platform plus guidance to reach SOC 2 Type I readiness.', fr: 'Plateforme et accompagnement jusqu’à la préparation SOC 2 Type I.' },
    prices: [usd(900000)],
  },
  {
    slug: 'compliance-automation',
    tier: 'security',
    type: 'subscription',
    interval: 'month',
    name: { en: 'Compliance automation — HIPAA / PCI-DSS / NIST CSF', fr: 'Automatisation de conformité — HIPAA / PCI-DSS / NIST CSF' },
    summary: { en: 'Continuous control monitoring and evidence collection.', fr: 'Surveillance continue des contrôles et collecte de preuves.' },
    prices: [usd(85000)],
  },
  {
    slug: 'compliance-gap-assessment',
    tier: 'security',
    type: 'service',
    interval: 'once',
    name: { en: 'Compliance gap assessment', fr: 'Évaluation des écarts de conformité' },
    summary: { en: 'One-time assessment against your target framework, with a prioritised plan.', fr: 'Évaluation ponctuelle par rapport au référentiel visé, avec plan priorisé.' },
    delivery: { en: '10 days', fr: '10 jours' },
    prices: [usd(150000)],
  },

  // ---- Tier 2 — productized engineering. Ships first: no build work. -------------
  {
    slug: 'landing-page',
    tier: 'engineering',
    type: 'service',
    interval: 'once',
    name: { en: 'Landing page — design and build', fr: 'Page de destination — conception et développement' },
    summary: { en: 'A designed, built and deployed landing page.', fr: 'Une page de destination conçue, développée et déployée.' },
    delivery: { en: '5 business days', fr: '5 jours ouvrés' },
    prices: [usd(120000), xof(450000)],
  },
  {
    slug: 'mvp-sprint',
    tier: 'engineering',
    type: 'service',
    interval: 'once',
    featured: true,
    name: { en: 'MVP sprint — working product in two weeks', fr: 'Sprint MVP — produit fonctionnel en deux semaines' },
    summary: { en: 'A working, deployed product built in a focused two-week sprint.', fr: 'Un produit fonctionnel et déployé, construit en deux semaines.' },
    delivery: { en: '14 days', fr: '14 jours' },
    prices: [usd(450000), xof(1800000)],
  },
  {
    slug: 'payment-integration',
    tier: 'engineering',
    type: 'service',
    interval: 'once',
    name: { en: 'Payment integration — Stripe, CinetPay or Flutterwave', fr: 'Intégration de paiement — Stripe, CinetPay ou Flutterwave' },
    summary: { en: 'A tested payment integration, webhooks included.', fr: 'Une intégration de paiement testée, webhooks compris.' },
    delivery: { en: '3 days', fr: '3 jours' },
    prices: [usd(60000), xof(250000)],
  },
  {
    slug: 'app-store-submission',
    tier: 'engineering',
    type: 'service',
    interval: 'once',
    name: { en: 'Mobile app store submission and setup', fr: 'Soumission et configuration sur les stores mobiles' },
    summary: { en: 'Store listings prepared, built and submitted.', fr: 'Fiches préparées, builds produits et soumis.' },
    delivery: { en: '5 days', fr: '5 jours' },
    prices: [usd(75000), xof(300000)],
  },
  {
    slug: 'technical-translation',
    tier: 'engineering',
    type: 'service',
    interval: 'once',
    name: { en: 'Technical translation and localisation, EN↔FR', fr: 'Traduction technique et localisation, EN↔FR' },
    summary: { en: 'Technical content translated by an engineer, not a generalist.', fr: 'Contenu technique traduit par un ingénieur, pas un généraliste.' },
    delivery: { en: '4 days', fr: '4 jours' },
    prices: [usd(40000), xof(160000)],
  },
  {
    slug: 'engineering-retainer',
    tier: 'engineering',
    type: 'subscription',
    interval: 'month',
    name: { en: 'Monthly retainer — 20 engineering hours', fr: 'Forfait mensuel — 20 heures d’ingénierie' },
    summary: { en: 'Twenty hours a month of engineering, on your roadmap.', fr: 'Vingt heures d’ingénierie par mois, sur votre feuille de route.' },
    prices: [usd(240000), xof(950000)],
  },

  // ---- Tier 3 — SaaS subscriptions ----------------------------------------------
  {
    slug: 'node-crm-seat',
    tier: 'software',
    type: 'subscription',
    interval: 'month',
    name: { en: 'Node CRM — per seat', fr: 'Node CRM — par utilisateur' },
    summary: { en: 'The CRM built for how West African businesses actually sell.', fr: 'Le CRM conçu pour la façon dont les entreprises ouest-africaines vendent réellement.' },
    prices: [usd(2900), xof(15000)],
    href: 'https://argilette.org',
  },
  {
    slug: 'node-crm-team',
    tier: 'software',
    type: 'subscription',
    interval: 'month',
    name: { en: 'Node CRM — Team, 10 seats', fr: 'Node CRM — Équipe, 10 utilisateurs' },
    summary: { en: 'Ten seats, shared pipeline, one invoice.', fr: 'Dix utilisateurs, pipeline partagé, une seule facture.' },
    prices: [usd(19900), xof(100000)],
    href: 'https://argilette.org',
  },
  {
    slug: 'navimed-cabinet',
    tier: 'software',
    type: 'subscription',
    interval: 'month',
    featured: true,
    name: { en: 'NaviMED Suite — Cabinet, 1–3 practitioners', fr: 'NaviMED Suite — Cabinet, 1 à 3 praticiens' },
    summary: { en: 'NaviMED and CARNET for a single practice, in ten languages.', fr: 'NaviMED et CARNET pour un cabinet, en dix langues.' },
    prices: [xof(25000)],
    href: 'https://navimedi.com',
  },
  {
    slug: 'navimed-clinique',
    tier: 'software',
    type: 'subscription',
    interval: 'month',
    name: { en: 'NaviMED Suite — Clinique, 4–15 practitioners', fr: 'NaviMED Suite — Clinique, 4 à 15 praticiens' },
    summary: { en: 'Multi-practitioner clinics, shared records, role-based access.', fr: 'Cliniques multi-praticiens, dossiers partagés, accès par rôle.' },
    prices: [xof(75000)],
    href: 'https://navimedi.com',
  },
  {
    slug: 'navimed-groupe',
    tier: 'software',
    type: 'subscription',
    interval: 'month',
    name: { en: 'NaviMED Suite — Groupe, multi-site', fr: 'NaviMED Suite — Groupe, multi-site' },
    summary: { en: 'Multi-site groups with consolidated administration.', fr: 'Groupes multi-sites avec administration consolidée.' },
    prices: [xof(200000)],
    href: 'https://navimedi.com',
  },
  {
    slug: 'navimed-onboarding',
    tier: 'software',
    type: 'service',
    interval: 'once',
    name: { en: 'NaviMED Suite — onboarding and data migration', fr: 'NaviMED Suite — mise en service et migration des données' },
    summary: { en: 'Onboarding and migration from your existing records system.', fr: 'Mise en service et migration depuis votre système de dossiers actuel.' },
    delivery: { en: 'Scheduled with your practice', fr: 'Planifié avec votre cabinet' },
    prices: [xof(150000)],
  },
  {
    slug: 'gesmart-saba',
    tier: 'software',
    type: 'subscription',
    interval: 'month',
    name: { en: 'Gesmart / SÀBA — per SFD institution', fr: 'Gesmart / SÀBA — par institution SFD' },
    summary: { en: 'Management for decentralised financial institutions.', fr: 'Gestion pour les systèmes financiers décentralisés.' },
    prices: [xof(150000)],
  },
  {
    slug: 'kvault-family',
    tier: 'software',
    type: 'subscription',
    interval: 'month',
    name: { en: 'K-Vault — Family plan', fr: 'K-Vault — Formule Famille' },
    summary: { en: 'Encrypted vault for the whole household, on every device.', fr: 'Coffre chiffré pour toute la famille, sur tous les appareils.' },
    prices: [usd(699)],
    href: 'https://kvaults.com',
  },
  {
    slug: 'vuna-smallholder',
    tier: 'software',
    type: 'subscription',
    interval: 'month',
    name: { en: 'VUNA — Smallholder', fr: 'VUNA — Petit exploitant' },
    summary: { en: 'Smart farming for an individual holding.', fr: 'Agriculture intelligente pour une exploitation individuelle.' },
    prices: [xof(5000)],
    href: 'https://vunaafric.org',
  },
  {
    slug: 'vuna-cooperative',
    tier: 'software',
    type: 'subscription',
    interval: 'month',
    name: { en: 'VUNA — Cooperative', fr: 'VUNA — Coopérative' },
    summary: { en: 'Shared agronomy and yield tracking across a cooperative.', fr: 'Agronomie partagée et suivi des rendements à l’échelle d’une coopérative.' },
    prices: [xof(40000)],
    href: 'https://vunaafric.org',
  },
  {
    slug: 'fairetax-assessment',
    tier: 'software',
    type: 'service',
    interval: 'once',
    name: { en: 'FaireTax — per assessment', fr: 'FaireTax — par évaluation' },
    summary: { en: 'One AI-assisted property tax assessment.', fr: 'Une évaluation de taxe foncière assistée par IA.' },
    prices: [usd(4900)],
    href: 'https://fairetax.com',
  },
  {
    slug: 'fairetax-pro',
    tier: 'software',
    type: 'subscription',
    interval: 'month',
    name: { en: 'FaireTax Pro — unlimited', fr: 'FaireTax Pro — illimité' },
    summary: { en: 'Unlimited assessments for professional filers.', fr: 'Évaluations illimitées pour les professionnels.' },
    prices: [usd(9900)],
    href: 'https://fairetax.com',
  },
  {
    slug: 'adresa-commercial',
    tier: 'software',
    type: 'subscription',
    interval: 'month',
    name: { en: 'ADRESA — Partner API, commercial', fr: 'ADRESA — API partenaire, commercial' },
    summary: { en: 'Digital addressing at commercial volume. A rate-limited developer tier is free.', fr: 'Adressage numérique à volume commercial. Une offre développeur limitée est gratuite.' },
    prices: [usd(19900)],
  },

  // ---- Tier 5 — digital downloads. Instant delivery, signed URLs. ----------------
  {
    slug: 'saas-starter',
    tier: 'downloads',
    type: 'download',
    interval: 'once',
    featured: true,
    name: { en: 'Next.js + Supabase SaaS starter', fr: 'Kit de démarrage SaaS Next.js + Supabase' },
    summary: { en: 'Auth, billing and multi-tenancy, wired up and documented.', fr: 'Authentification, facturation et multi-tenant, câblés et documentés.' },
    prices: [usd(7900)],
  },
  {
    slug: 'react-ui-kit',
    tier: 'downloads',
    type: 'download',
    interval: 'once',
    name: { en: 'Bilingual EN/FR React UI kit', fr: 'Kit d’interface React bilingue EN/FR' },
    summary: { en: 'Components built bilingual from the start, not retrofitted.', fr: 'Des composants bilingues dès la conception, pas adaptés après coup.' },
    prices: [usd(5900)],
  },
  {
    slug: 'adresa-spec',
    tier: 'downloads',
    type: 'download',
    interval: 'once',
    name: { en: 'ADRESA digital addressing specification', fr: 'Spécification d’adressage numérique ADRESA' },
    summary: { en: 'The full French technical document.', fr: 'Le document technique complet en français.' },
    prices: [usd(4900)],
  },
  {
    slug: 'compliance-checklists',
    tier: 'downloads',
    type: 'download',
    interval: 'once',
    name: { en: 'Compliance checklist bundle', fr: 'Pack de listes de contrôle de conformité' },
    summary: { en: 'SOC 2, HIPAA, PCI-DSS and NIST CSF, as working checklists.', fr: 'SOC 2, HIPAA, PCI-DSS et NIST CSF, sous forme de listes exploitables.' },
    prices: [usd(3900)],
  },
  {
    slug: 'postgis-geocoding-starter',
    tier: 'downloads',
    type: 'download',
    interval: 'once',
    name: { en: 'PostGIS geocoding starter', fr: 'Kit de démarrage géocodage PostGIS' },
    summary: { en: 'The ADRESA architecture, generalised and runnable.', fr: 'L’architecture ADRESA, généralisée et exécutable.' },
    prices: [usd(6900)],
  },
  {
    slug: 'guide-saas-afrique',
    tier: 'downloads',
    type: 'download',
    interval: 'once',
    name: { en: 'Guide: Lancer une SaaS en Afrique de l’Ouest (FR)', fr: 'Guide : Lancer une SaaS en Afrique de l’Ouest' },
    summary: { en: 'A practical guide, in French, to launching SaaS in West Africa.', fr: 'Un guide pratique pour lancer une SaaS en Afrique de l’Ouest.' },
    prices: [usd(2900)],
  },
  {
    slug: 'keycloak-theming-guide',
    tier: 'downloads',
    type: 'download',
    interval: 'once',
    name: { en: 'Keycloak white-label theming guide', fr: 'Guide de personnalisation Keycloak en marque blanche' },
    summary: { en: 'Implementation guide for white-labelled Keycloak.', fr: 'Guide d’implémentation pour un Keycloak en marque blanche.' },
    prices: [usd(4500)],
  },
];

export const TIERS: Tier[] = ['security', 'engineering', 'software', 'downloads'];

export const byTier = (tier: Tier): Sku[] => CATALOG.filter((s) => s.tier === tier);
export const bySlug = (slug: string): Sku | undefined =>
  CATALOG.find((s) => s.slug === slug);
export const featured = (): Sku[] => CATALOG.filter((s) => s.featured);
