/**
 * Legal documents.
 *
 * **These are drafts and must be reviewed by counsel before launch.** That is not
 * boilerplate caution — it is a requirement ARGILETTE's own security spec already sets
 * (§2, "get local counsel for the African jurisdictions"; §15 gates launch on a privacy
 * policy, DPAs for every processor, and local sign-off).
 *
 * What is written here is grounded in what the platform actually does — Paddle is the
 * merchant of record, card data never reaches our servers, download links expire in
 * fifteen minutes, dunning runs twenty-one days, no patient data exists anywhere in the
 * system. Those are facts about the build, and a lawyer reviewing them is far cheaper
 * than a lawyer drafting from nothing.
 *
 * What is *not* written here is anything only ARGILETTE can know: registered address,
 * entity numbers, the data-protection contact, the governing jurisdiction. Those are
 * `[[placeholders]]`, rendered visibly so the site cannot quietly go live with them
 * unfilled, and asserted in the test suite.
 *
 * Legal text is deliberately English and French only. Machine-translating a binding
 * commitment into a language nobody on the team reads is exactly the failure mode the
 * build spec flags for clinical strings, and a warranty disclaimer carries the same
 * weight. Other locales fall back to English, with the governing-language clause saying
 * so.
 */

export type LegalSlug = 'terms' | 'privacy' | 'refunds';

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalContent {
  title: string;
  lede: string;
  sections: LegalSection[];
}

export interface LegalDoc {
  slug: LegalSlug;
  /** ISO date. Shown to the reader — a legal page with no date is not much use. */
  updated: string;
  /**
   * False once counsel has signed the document off. Drives the review banner, so
   * clearing it is a one-line change rather than a hunt through markup.
   */
  reviewPending: boolean;
  locales: { en: LegalContent } & Partial<Record<string, LegalContent>>;
}

export const LEGAL_SLUGS: LegalSlug[] = ['terms', 'privacy', 'refunds'];

const GOVERNING_LANGUAGE_EN =
  'This document is published in English and French. Where the two differ, the English version governs.';
const GOVERNING_LANGUAGE_FR =
  'Ce document est publié en anglais et en français. En cas de divergence, la version anglaise prévaut.';

export const LEGAL_DOCS: Record<LegalSlug, LegalDoc> = {
  terms: {
    slug: 'terms',
    updated: '2026-08-15',
    reviewPending: true,
    locales: {
      en: {
        title: 'Terms of sale',
        lede: 'The terms on which ARGILETTE LLC sells services, subscriptions and digital downloads through ARGILETTE.shop.',
        sections: [
          {
            heading: 'Who you are contracting with',
            paragraphs: [
              'ARGILETTE.shop is operated by ARGILETTE LLC, registered at [[registered address]], company number [[company number]].',
              'For international card and bank payments, Paddle.com Market Ltd acts as merchant of record. That means your contract for payment is with Paddle, and Paddle appears on your statement. Your contract for the delivery of the service or product itself is with ARGILETTE LLC.',
              'For mobile money payments in the UEMOA and CEMAC zones, payment is processed by CinetPay and your contract is with ARGILETTE LLC directly.',
            ],
          },
          {
            heading: 'Prices and currency',
            paragraphs: [
              'Every price is shown inclusive of the taxes we are required to include for your country, and exclusive of those we are not. The payment provider calculates and remits tax as merchant of record where that applies.',
              'The price shown when you add an item to your cart is the price you pay. If exchange rates move while you are checking out, the price you were shown stands for the remainder of that session.',
              'Some prices are set for a specific market rather than converted from a base currency. Where that applies, the local price is the price — it is not a discount and it is not an error.',
            ],
          },
          {
            heading: 'Services',
            paragraphs: [
              'Services are delivered work, not instant access. The delivery time shown on each service is the commitment we make, measured from the point we have the information we need from you to begin.',
              'After payment we will contact you for the scope, deadline, contacts and existing assets required to start. Delivery timelines depend on receiving that promptly.',
              'Security testing is performed only against systems you own or are demonstrably authorised to test. You warrant that authorisation before work begins, and we may suspend an engagement without refund if it cannot be evidenced.',
            ],
          },
          {
            heading: 'Subscriptions',
            paragraphs: [
              'Subscriptions renew automatically at the interval shown until cancelled. You can cancel at any time from your account; access continues to the end of the period you have paid for.',
              'If a payment fails, your access is not cut off immediately. We retry and contact you over a twenty-one day period before access is suspended. Mobile money failures are frequently transient, and a temporarily empty wallet is not a cancelled account.',
              'Where a plan is sold per seat, you are responsible for the number of seats in use matching the number you pay for.',
            ],
          },
          {
            heading: 'Digital downloads and licence keys',
            paragraphs: [
              'Download links are short-lived and bound to your account for security. You can generate a new link from your account at any time while your purchase remains valid.',
              'Licence keys are issued to you and shown in full once, at issuance. Keys carry an activation limit shown at purchase. Sharing, reselling or publishing a key is a breach of these terms and may result in revocation.',
            ],
          },
          {
            heading: 'Acceptable use',
            paragraphs: [
              'You may not use anything bought here to break the law, to attack systems you do not have permission to test, or to build a product that competes by redistributing our materials substantially unchanged.',
              'We may suspend access where we reasonably believe an account is compromised, fraudulent, or being used for the above. Where suspension is for a security reason we will act immediately and explain afterwards.',
            ],
          },
          {
            heading: 'Warranties and liability',
            paragraphs: [
              '[[Counsel to draft: warranty scope, disclaimer, liability cap, and any carve-outs for the security-testing engagements. This section carries the most commercial risk on the page and should not be adapted from a template.]]',
            ],
          },
          {
            heading: 'Governing law',
            paragraphs: [
              'These terms are governed by the laws of [[governing jurisdiction]], and the courts of [[venue]] have exclusive jurisdiction, without prejudice to any mandatory consumer protections available to you where you live.',
              GOVERNING_LANGUAGE_EN,
            ],
          },
          {
            heading: 'Changes',
            paragraphs: [
              'We may update these terms. If a change materially affects an active subscription or an undelivered service, we will tell you before it applies to you. The date at the top of this page is the last change.',
              'Questions about these terms: [[legal contact email]].',
            ],
          },
        ],
      },
      fr: {
        title: 'Conditions de vente',
        lede: "Les conditions selon lesquelles ARGILETTE LLC vend des prestations, des abonnements et des téléchargements sur ARGILETTE.shop.",
        sections: [
          {
            heading: 'Votre cocontractant',
            paragraphs: [
              "ARGILETTE.shop est exploité par ARGILETTE LLC, dont le siège est situé [[adresse du siège]], immatriculée sous le numéro [[numéro d'immatriculation]].",
              "Pour les paiements internationaux par carte et par virement, Paddle.com Market Ltd agit en qualité de revendeur officiel. Votre contrat de paiement est donc conclu avec Paddle, qui apparaît sur votre relevé. Le contrat portant sur la livraison de la prestation ou du produit est conclu avec ARGILETTE LLC.",
              "Pour les paiements mobile money dans les zones UEMOA et CEMAC, le paiement est traité par CinetPay et votre contrat est conclu directement avec ARGILETTE LLC.",
            ],
          },
          {
            heading: 'Prix et devises',
            paragraphs: [
              "Chaque prix est affiché taxes comprises lorsque la réglementation de votre pays l'exige, et hors taxes dans le cas contraire. Le prestataire de paiement calcule et reverse la taxe en tant que revendeur officiel lorsque cela s'applique.",
              "Le prix affiché au moment de l'ajout au panier est celui que vous payez. Si les taux de change évoluent pendant votre commande, le prix qui vous a été présenté reste applicable pour la durée de la session.",
              "Certains prix sont fixés pour un marché donné plutôt que convertis depuis une devise de base. Dans ce cas, le prix local est le prix : il ne s'agit ni d'une remise ni d'une erreur.",
            ],
          },
          {
            heading: 'Prestations',
            paragraphs: [
              "Les prestations sont des travaux livrés, non un accès immédiat. Le délai indiqué pour chaque prestation constitue notre engagement, à compter du moment où nous disposons des informations nécessaires pour commencer.",
              "Après le paiement, nous vous contacterons pour recueillir le périmètre, l'échéance, les contacts et les éléments existants nécessaires au démarrage. Les délais dépendent de la réception rapide de ces éléments.",
              "Les tests de sécurité ne sont réalisés que sur des systèmes dont vous êtes propriétaire ou pour lesquels vous êtes manifestement autorisé. Vous garantissez cette autorisation avant le début des travaux ; à défaut de preuve, nous pouvons suspendre la mission sans remboursement.",
            ],
          },
          {
            heading: 'Abonnements',
            paragraphs: [
              "Les abonnements se renouvellent automatiquement selon la périodicité indiquée jusqu'à résiliation. Vous pouvez résilier à tout moment depuis votre compte ; l'accès se poursuit jusqu'au terme de la période payée.",
              "En cas d'échec de paiement, votre accès n'est pas interrompu immédiatement. Nous effectuons des relances pendant vingt et un jours avant toute suspension. Les échecs de mobile money sont souvent passagers, et un portefeuille temporairement vide n'est pas un compte résilié.",
              "Lorsqu'une formule est vendue par utilisateur, il vous appartient de veiller à ce que le nombre d'utilisateurs actifs corresponde au nombre payé.",
            ],
          },
          {
            heading: 'Téléchargements et clés de licence',
            paragraphs: [
              "Les liens de téléchargement sont de courte durée et rattachés à votre compte pour des raisons de sécurité. Vous pouvez en générer un nouveau depuis votre compte tant que votre achat reste valide.",
              "Les clés de licence vous sont délivrées et affichées en entier une seule fois, à l'émission. Chaque clé comporte une limite d'activations indiquée à l'achat. Le partage, la revente ou la publication d'une clé constitue un manquement aux présentes conditions et peut entraîner sa révocation.",
            ],
          },
          {
            heading: 'Usage acceptable',
            paragraphs: [
              "Vous ne pouvez utiliser ce qui est acheté ici ni pour enfreindre la loi, ni pour attaquer des systèmes que vous n'êtes pas autorisé à tester, ni pour créer un produit concurrent redistribuant nos supports substantiellement inchangés.",
              "Nous pouvons suspendre un accès lorsque nous avons des motifs raisonnables de penser qu'un compte est compromis, frauduleux ou utilisé aux fins ci-dessus. Lorsque la suspension repose sur un motif de sécurité, nous agissons immédiatement et expliquons ensuite.",
            ],
          },
          {
            heading: 'Garanties et responsabilité',
            paragraphs: [
              "[[À rédiger par le conseil : étendue de la garantie, clause de non-responsabilité, plafond de responsabilité et exclusions propres aux missions de test de sécurité. Cette section porte le risque commercial le plus élevé de la page et ne doit pas être adaptée d'un modèle.]]",
            ],
          },
          {
            heading: 'Droit applicable',
            paragraphs: [
              "Les présentes conditions sont régies par le droit de [[juridiction applicable]], et les tribunaux de [[for compétent]] sont seuls compétents, sans préjudice des protections impératives dont vous bénéficiez en tant que consommateur dans votre pays de résidence.",
              GOVERNING_LANGUAGE_FR,
            ],
          },
          {
            heading: 'Modifications',
            paragraphs: [
              "Nous pouvons modifier les présentes conditions. Si une modification affecte substantiellement un abonnement en cours ou une prestation non livrée, nous vous en informerons avant qu'elle ne vous soit applicable. La date en haut de cette page correspond à la dernière modification.",
              "Questions sur ces conditions : [[adresse e-mail juridique]].",
            ],
          },
        ],
      },
    },
  },

  privacy: {
    slug: 'privacy',
    updated: '2026-08-15',
    reviewPending: true,
    locales: {
      en: {
        title: 'Privacy',
        lede: 'What ARGILETTE.shop collects, why, who it is shared with, and what you can ask us to do about it.',
        sections: [
          {
            heading: 'What this store never holds',
            paragraphs: [
              'ARGILETTE.shop sells subscriptions to NaviMED and CARNET, which are clinical systems. This store holds no patient data of any kind — no names, no diagnoses, no records, not in the database and not in the logs. It knows that a clinic pays for a given plan, for a given number of seats, until a given date. Nothing more.',
              'That boundary is enforced by how the system is built rather than by policy: the storefront database has no field capable of holding clinical information. A full compromise of this store would expose billing data, which is bad and recoverable — not medical records.',
              'We also never receive your card number, expiry or security code. Those are entered on the payment provider’s own page and never reach ARGILETTE systems, logs or backups.',
            ],
          },
          {
            heading: 'What we do collect',
            paragraphs: [
              'Account and contact: your name, email address, country and language preference.',
              'Commercial: what you bought, when, in what currency, your order and invoice history, your subscription status and entitlements, and billing address where the payment provider passes it to us.',
              'Technical: IP-derived country (used to choose your language and payment method), and standard security logs used to detect attacks and abuse.',
              'For services, the intake information you send us to scope the work. Please do not include personal data about third parties, or any clinical information, in that intake.',
            ],
          },
          {
            heading: 'Why we are allowed to hold it',
            paragraphs: [
              'To perform our contract with you: everything needed to take payment, deliver what you bought, and support it.',
              'To meet legal obligations: tax, accounting and record-keeping requirements.',
              'For our legitimate interests: preventing fraud and abuse, securing the service, and understanding aggregate demand. We balance these against your rights and use the least data that works.',
              'With your consent, where we ask for it — for example marketing email. You can withdraw consent at any time, and doing so never affects the service you have paid for.',
            ],
          },
          {
            heading: 'Who we share it with',
            paragraphs: [
              'Payment: Paddle (merchant of record for international payments) and CinetPay (mobile money).',
              'Infrastructure: [[hosting provider]] for the application, [[database provider]] for the database, Cloudflare for edge delivery and protection, and our own Keycloak instance for sign-in.',
              'Email: our mail infrastructure, for receipts, licence keys and service notices.',
              'Each of these is a processor acting on our instructions under a data processing agreement. We do not sell your data, and we do not share it for anyone else’s advertising.',
            ],
          },
          {
            heading: 'Where it goes',
            paragraphs: [
              'We operate across Europe, West and Central Africa, and North America, and your data may be processed in any of them. Transfers out of the EEA rely on [[transfer mechanism — counsel to confirm: SCCs, adequacy, or other]].',
            ],
          },
          {
            heading: 'How long we keep it',
            paragraphs: [
              'Order and invoice records for as long as tax and accounting law requires, which is typically [[retention period]] years.',
              'Account data for as long as your account is open, and for a short period afterwards to handle disputes and chargebacks.',
              'Security logs for a limited window, then deleted. Logs are scrubbed of personal data as a matter of design.',
            ],
          },
          {
            heading: 'Your rights',
            paragraphs: [
              'You can ask us for a copy of your data, to correct it, to delete it, to restrict or object to how we use it, and to receive it in a portable format. Where we rely on consent, you can withdraw it.',
              'Write to [[data protection contact]]. We will respond within one month. There is no charge.',
              'Depending on where you live, these rights come from the GDPR, the Nigeria Data Protection Act, national data protection law in Togo and the wider UEMOA region, or state privacy laws in the United States. You also have the right to complain to your national supervisory authority.',
            ],
          },
          {
            heading: 'If something goes wrong',
            paragraphs: [
              'If a breach affects your personal data and presents a risk to you, we will notify the relevant supervisory authority within 72 hours of becoming aware, and tell you directly where the risk is high.',
              GOVERNING_LANGUAGE_EN,
            ],
          },
        ],
      },
      fr: {
        title: 'Confidentialité',
        lede: "Ce qu'ARGILETTE.shop collecte, pourquoi, avec qui ces données sont partagées, et ce que vous pouvez nous demander.",
        sections: [
          {
            heading: 'Ce que cette boutique ne détient jamais',
            paragraphs: [
              "ARGILETTE.shop vend des abonnements à NaviMED et CARNET, qui sont des systèmes cliniques. Cette boutique ne détient aucune donnée de patient — ni nom, ni diagnostic, ni dossier, ni dans la base de données ni dans les journaux. Elle sait qu'un cabinet paie une formule donnée, pour un nombre de postes donné, jusqu'à une date donnée. Rien de plus.",
              "Cette frontière est garantie par l'architecture et non par une simple politique : la base de données de la boutique ne comporte aucun champ capable de recevoir une information clinique. Une compromission totale de cette boutique exposerait des données de facturation — grave et réparable — et non des dossiers médicaux.",
              "Nous ne recevons jamais non plus votre numéro de carte, sa date d'expiration ou son cryptogramme. Ces données sont saisies sur la page du prestataire de paiement et n'atteignent jamais les systèmes, journaux ou sauvegardes d'ARGILETTE.",
            ],
          },
          {
            heading: 'Ce que nous collectons',
            paragraphs: [
              "Compte et contact : nom, adresse e-mail, pays et langue.",
              "Commercial : vos achats, leur date, leur devise, votre historique de commandes et de factures, l'état de vos abonnements et de vos droits, ainsi que l'adresse de facturation lorsque le prestataire de paiement nous la transmet.",
              "Technique : le pays déduit de votre adresse IP (utilisé pour choisir votre langue et votre moyen de paiement) et les journaux de sécurité standard servant à détecter les attaques et les abus.",
              "Pour les prestations, les informations de cadrage que vous nous transmettez. Merci de ne pas y inclure de données personnelles de tiers ni d'informations cliniques.",
            ],
          },
          {
            heading: 'Sur quelle base juridique',
            paragraphs: [
              "L'exécution de notre contrat : tout ce qui est nécessaire pour encaisser, livrer et assurer le suivi de votre achat.",
              "Le respect d'obligations légales : exigences fiscales, comptables et de conservation.",
              "Nos intérêts légitimes : prévention de la fraude et des abus, sécurité du service et compréhension de la demande agrégée. Nous les mettons en balance avec vos droits et utilisons le minimum de données utile.",
              "Votre consentement lorsque nous le demandons, par exemple pour les e-mails marketing. Vous pouvez le retirer à tout moment, sans que cela n'affecte le service que vous avez payé.",
            ],
          },
          {
            heading: 'Avec qui nous les partageons',
            paragraphs: [
              "Paiement : Paddle (revendeur officiel pour les paiements internationaux) et CinetPay (mobile money).",
              "Infrastructure : [[hébergeur]] pour l'application, [[fournisseur de base de données]] pour la base, Cloudflare pour la diffusion et la protection en périphérie, et notre instance Keycloak pour l'authentification.",
              "E-mail : notre infrastructure de messagerie, pour les reçus, les clés de licence et les avis de service.",
              "Chacun agit en qualité de sous-traitant, sur nos instructions, dans le cadre d'un accord de traitement. Nous ne vendons pas vos données et ne les partageons pour la publicité de personne.",
            ],
          },
          {
            heading: 'Où elles sont traitées',
            paragraphs: [
              "Nous opérons en Europe, en Afrique de l'Ouest et centrale et en Amérique du Nord ; vos données peuvent être traitées dans ces régions. Les transferts hors EEE reposent sur [[mécanisme de transfert — à confirmer par le conseil : CCT, adéquation ou autre]].",
            ],
          },
          {
            heading: 'Durée de conservation',
            paragraphs: [
              "Les commandes et factures aussi longtemps que la législation fiscale et comptable l'exige, soit généralement [[durée de conservation]] ans.",
              "Les données de compte tant que votre compte est ouvert, puis pendant une courte période afin de traiter les litiges et impayés.",
              "Les journaux de sécurité pendant une durée limitée, puis supprimés. Ils sont expurgés des données personnelles par conception.",
            ],
          },
          {
            heading: 'Vos droits',
            paragraphs: [
              "Vous pouvez demander une copie de vos données, leur rectification, leur effacement, la limitation ou l'opposition à leur traitement, ainsi que leur portabilité. Lorsque nous nous fondons sur le consentement, vous pouvez le retirer.",
              "Écrivez à [[contact protection des données]]. Nous répondons sous un mois, sans frais.",
              "Selon votre lieu de résidence, ces droits découlent du RGPD, de la loi nigériane sur la protection des données, du droit national togolais et régional UEMOA, ou des lois américaines des États. Vous pouvez également saisir votre autorité de contrôle nationale.",
            ],
          },
          {
            heading: "En cas d'incident",
            paragraphs: [
              "Si une violation touche vos données personnelles et présente un risque pour vous, nous informerons l'autorité de contrôle compétente dans les 72 heures suivant sa découverte, et vous informerons directement lorsque le risque est élevé.",
              GOVERNING_LANGUAGE_FR,
            ],
          },
        ],
      },
    },
  },

  refunds: {
    slug: 'refunds',
    updated: '2026-08-15',
    reviewPending: true,
    locales: {
      en: {
        title: 'Refunds',
        lede: 'When you can get your money back, how long it takes, and how mobile money differs.',
        sections: [
          {
            heading: 'Digital downloads',
            paragraphs: [
              'Downloads are delivered immediately, so we ask you to confirm at checkout that you want access straight away. In the EU and UK that confirmation waives the fourteen-day right of withdrawal, and we will say so plainly at the point you agree to it.',
              'If a file is broken, misdescribed, or you cannot make it work with reasonable help from us, tell us within fourteen days and we will refund it in full. "I already downloaded it" is not a reason we will refuse.',
            ],
          },
          {
            heading: 'Services',
            paragraphs: [
              'Before work starts, you can cancel a service for a full refund.',
              'Once work has started, we refund the portion not yet delivered. For a fixed-scope engagement we will tell you what has been completed and what that leaves.',
              'For security testing specifically, work is usually scheduled in blocks. Cancelling inside [[notice period]] of a booked block may not be refundable, because the time cannot be resold at short notice. This is stated at booking.',
            ],
          },
          {
            heading: 'Subscriptions',
            paragraphs: [
              'You can cancel at any time. Access continues to the end of the period you have already paid for, and we do not bill again.',
              'We do not automatically refund part-months. If you cancelled and were charged again because a cancellation did not register, that is our problem and we will refund it in full.',
              'If a subscription was unusable because of a fault on our side, tell us and we will refund the affected period.',
            ],
          },
          {
            heading: 'Mobile money',
            paragraphs: [
              'Mobile money behaves differently from cards and it is worth knowing how.',
              'If money left your wallet but the purchase did not complete, it will usually settle on its own within [[settlement window]] — the confirmation reaches us separately from your browser, so closing the page does not lose the payment. If it has not resolved after that, contact us with the transaction reference and we will trace it.',
              'If you were charged twice for one purchase, we refund the duplicate in full. Duplicate notifications are a known characteristic of these networks and we treat them as our problem, not yours.',
              'Refunds return to the wallet that paid. We cannot redirect a mobile money refund to a card or a different number.',
            ],
          },
          {
            heading: 'How refunds are paid',
            paragraphs: [
              'Card and bank refunds are processed by Paddle as merchant of record and return to the original payment method, typically within [[card refund window]] working days depending on your bank.',
              'Mobile money refunds return to the paying wallet, typically within [[mobile money refund window]].',
            ],
          },
          {
            heading: 'Chargebacks',
            paragraphs: [
              'If you raise a chargeback, access is suspended while it is reviewed. If it turns out to be a mistake or a family member’s purchase, contact us and we will sort it out — a chargeback is a slower and more damaging route to the same refund.',
            ],
          },
          {
            heading: 'Asking for a refund',
            paragraphs: [
              'Email [[support email]] with your order number and what went wrong. We aim to answer within [[response time]] working days.',
              'None of this limits rights you have under consumer law where you live.',
              GOVERNING_LANGUAGE_EN,
            ],
          },
        ],
      },
      fr: {
        title: 'Remboursements',
        lede: "Dans quels cas vous êtes remboursé, sous quel délai, et en quoi le mobile money diffère.",
        sections: [
          {
            heading: 'Téléchargements',
            paragraphs: [
              "Les téléchargements sont livrés immédiatement ; nous vous demandons donc de confirmer au paiement que vous souhaitez un accès immédiat. Dans l'UE et au Royaume-Uni, cette confirmation vaut renonciation au droit de rétractation de quatorze jours, ce que nous indiquons clairement au moment où vous l'acceptez.",
              "Si un fichier est défectueux, mal décrit, ou si vous ne parvenez pas à l'utiliser malgré notre aide, signalez-le sous quatorze jours et nous vous rembourserons intégralement. « Vous l'avez déjà téléchargé » n'est pas un motif de refus.",
            ],
          },
          {
            heading: 'Prestations',
            paragraphs: [
              "Avant le début des travaux, vous pouvez annuler une prestation et être intégralement remboursé.",
              "Une fois les travaux entamés, nous remboursons la part non encore livrée. Pour une mission à périmètre fixe, nous vous indiquerons ce qui a été réalisé et ce qu'il en résulte.",
              "Pour les tests de sécurité en particulier, les travaux sont planifiés par blocs. Une annulation dans les [[délai de préavis]] précédant un bloc réservé peut ne pas être remboursable, ce créneau ne pouvant être revendu à brève échéance. Cela est précisé à la réservation.",
            ],
          },
          {
            heading: 'Abonnements',
            paragraphs: [
              "Vous pouvez résilier à tout moment. L'accès se poursuit jusqu'au terme de la période déjà payée et aucun nouveau prélèvement n'est effectué.",
              "Nous ne remboursons pas automatiquement les mois entamés. Si vous avez résilié et avez tout de même été prélevé parce que la résiliation n'a pas été enregistrée, l'erreur est la nôtre et le remboursement est intégral.",
              "Si un abonnement était inutilisable en raison d'un dysfonctionnement de notre côté, signalez-le et nous rembourserons la période concernée.",
            ],
          },
          {
            heading: 'Mobile money',
            paragraphs: [
              "Le mobile money ne se comporte pas comme une carte, et il est utile de savoir comment.",
              "Si le montant a quitté votre portefeuille sans que l'achat aboutisse, la situation se régularise généralement d'elle-même sous [[délai de règlement]] : la confirmation nous parvient indépendamment de votre navigateur, fermer la page ne perd donc pas le paiement. Passé ce délai, contactez-nous avec la référence de transaction et nous la tracerons.",
              "Si vous avez été débité deux fois pour un même achat, nous remboursons intégralement le doublon. Les notifications en double sont une caractéristique connue de ces réseaux : c'est notre problème, pas le vôtre.",
              "Les remboursements retournent au portefeuille ayant payé. Nous ne pouvons pas rediriger un remboursement mobile money vers une carte ou un autre numéro.",
            ],
          },
          {
            heading: 'Modalités de versement',
            paragraphs: [
              "Les remboursements par carte et virement sont traités par Paddle en qualité de revendeur officiel et reviennent sur le moyen de paiement d'origine, généralement sous [[délai de remboursement carte]] jours ouvrés selon votre banque.",
              "Les remboursements mobile money reviennent au portefeuille payeur, généralement sous [[délai de remboursement mobile money]].",
            ],
          },
          {
            heading: 'Oppositions bancaires',
            paragraphs: [
              "Si vous engagez une opposition, l'accès est suspendu le temps de l'examen. S'il s'agit d'une erreur ou de l'achat d'un proche, contactez-nous et nous réglerons cela — l'opposition est une voie plus lente et plus dommageable vers le même remboursement.",
            ],
          },
          {
            heading: 'Demander un remboursement',
            paragraphs: [
              "Écrivez à [[e-mail du support]] en indiquant votre numéro de commande et le problème rencontré. Nous visons une réponse sous [[délai de réponse]] jours ouvrés.",
              "Rien de ce qui précède ne limite les droits que vous tenez du droit de la consommation applicable dans votre pays.",
              GOVERNING_LANGUAGE_FR,
            ],
          },
        ],
      },
    },
  },
};

/** Content for a locale, falling back to English. Legal text is en/fr only by design. */
export function legalContent(doc: LegalDoc, locale: string): LegalContent {
  return doc.locales[locale] ?? doc.locales.en;
}

/** Whether a locale has its own version, rather than the English fallback. */
export const hasOwnLegalTranslation = (doc: LegalDoc, locale: string): boolean =>
  Boolean(doc.locales[locale]);

/**
 * Split a paragraph into text and `[[placeholder]]` runs, so the page can render the
 * unfilled ones visibly. A placeholder that merely looks like prose is one that ships.
 */
export function splitPlaceholders(text: string): Array<{ text: string; placeholder: boolean }> {
  return text
    .split(/(\[\[[^\]]+\]\])/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith('[[') && part.endsWith(']]')
        ? { text: part.slice(2, -2), placeholder: true }
        : { text: part, placeholder: false },
    );
}
