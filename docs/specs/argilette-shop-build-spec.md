# ARGILETTE.shop — Build Specification

**Version:** 2.0 — multi-locale (10 languages) + worldwide currency
**Owner:** ARGILETTE LLC
**Audience:** Development team

---

## 1. Objective

Build the commercial storefront and entitlement backbone for the ARGILETTE product portfolio. Two jobs:

1. **Sell** — services, SaaS subscriptions, and digital downloads, in 10 languages and any world currency.
2. **Authorize** — single source of truth for who has paid for what, queried by every ARGILETTE product (Node CRM, NaviMED Suite, VUNA, K-Vault, ArgiDrop, NeVral, ADRESA).

Job 2 is what matters long-term. A checkout page is replaceable; a central entitlement service is what stops each product building its own billing.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router), TypeScript strict | Matches existing ARGILETTE codebases |
| Database | PostgreSQL (Neon) | Existing infra |
| ORM | Drizzle | Typed migrations |
| Auth | Keycloak (existing Hetzner instance) | Central identity — do not build local auth |
| Hosting | Vercel | Existing pattern |
| Edge / DNS | Cloudflare | Also supplies geo header |
| International payments | **Paddle** (merchant of record) | 200+ countries, localized currency, global tax |
| Africa / mobile money | CinetPay | Orange, MTN, Moov, Wave — Paddle does not cover these |
| FX rates | Daily provider snapshot, cached in DB | Never convert from a live API at request time |
| Email | Postal + Amazon SES relay (existing) | Receipts, license keys, dunning |
| i18n | next-intl | 10 locales, RTL-capable |
| Motion | Motion (spring-based), first-party bundled | Interruptible, velocity-aware. No CDN — see §15 |

**Gateway change from v1:** Lemon Squeezy is dropped in favour of Paddle. Lemon Squeezy's main advantage was native license-key issuance, which we no longer need since the entitlement service owns licensing. Paddle's jurisdiction and currency coverage is the deciding factor for a worldwide catalog.

---

## 3. Architecture

```
                    ┌──────────────────────┐
   Customer ───────►│  ARGILETTE.shop      │
                    │  Next.js storefront  │
                    └──────────┬───────────┘
                               │
                 ┌─────────────┴─────────────┐
                 ▼                           ▼
        ┌────────────────┐          ┌────────────────┐
        │    Paddle      │          │   CinetPay     │
        │ worldwide, MoR │          │ FCFA / mobile  │
        └───────┬────────┘          └───────┬────────┘
                │      webhooks             │
                └─────────────┬─────────────┘
                              ▼
                   ┌──────────────────────┐
                   │  Entitlement Service │
                   │  (Postgres + API)    │
                   └──────────┬───────────┘
                              │  GET /api/v1/entitlements
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        Node CRM      NaviMED Suite      VUNA / K-Vault
```

### Gateway routing

Read `CF-IPCountry` from the Cloudflare request header.

- UEMOA/CEMAC zone (BJ, BF, CI, GW, ML, NE, SN, TG, CM, CF, TD, CG, GQ, GA) → CinetPay, mobile money first
- Everywhere else → Paddle

Always offer a manual override. Geo is a default, never a lock — a diaspora customer in Paris paying for a Lomé clinic must be able to reach the FCFA/mobile-money path.

---

## 4. Currency Model

This is the part most likely to be built wrong. Read it carefully.

### Three-layer pricing

1. **Base price** — every plan has one canonical price in USD, stored in minor units.
2. **Strategic overrides** — hand-set prices for markets where purchasing power, not FX, sets the number. XOF is the primary case: NaviMED at the FX-converted equivalent of $40 would be mispriced for a Lomé cabinet. Overrides always win over conversion.
3. **FX-derived prices** — the long tail. Converted from base USD using a cached daily rate, then rounded per the currency's charm rule.

```sql
prices    id, plan_id, currency CHAR(3), amount_minor BIGINT,
          source ENUM('override','fx'), gateway_price_id,
          fx_rate_used NUMERIC, fx_snapshot_at, active
```

Never let a customer see one price and get charged another. The price shown at add-to-cart is locked into the order for the duration of the session; if the FX snapshot rolls over mid-checkout, the locked price stands.

### Decimal handling

**Do not assume two decimal places.** Currency minor-unit exponents vary:

| Exponent | Currencies | Example |
|---|---|---|
| 0 | XOF, XAF, JPY, KRW, VND, CLP, ISK, RWF, UGX, PYG | ¥2900 = 2900 minor |
| 2 | USD, EUR, GBP, NGN, ZAR, and most others | $29.00 = 2900 minor |
| 3 | KWD, BHD, OMR, TND, JOD, IQD | 29.000 KWD = 29000 minor |

Store the exponent per currency in a reference table. Every conversion, format, and gateway call reads it. A hardcoded `/100` produces invoices wrong by 100× in Japan and 1000× in Kuwait — this has sunk real launches.

### Rounding rules

Raw FX output is unsellable. `$29 → 17,412.83 XOF` reads like a bug.

| Currency class | Rule | Result |
|---|---|---|
| USD, EUR, GBP, CAD, AUD | Round up to `.99` | $28.43 → $28.99 |
| XOF, XAF | Round up to nearest 500 | 17,412 → 17,500 |
| JPY, KRW | Round up to nearest 100 | 4,283 → 4,300 |
| Everything else | Round up to nearest whole unit | 412.83 → 413 |

Always round **up**. Rounding down across thousands of transactions is a silent margin leak.

### FX refresh

- One provider snapshot per day, written to `fx_rates` with a timestamp.
- If the latest snapshot is older than 48 hours, **freeze prices at the last good rate and alert ops.** Do not fall back to a live call, and do not serve a stale-but-unflagged rate.
- Log the `fx_rate_used` on every price row so any historical invoice can be reconstructed.

```sql
fx_rates  id, base CHAR(3), quote CHAR(3), rate NUMERIC(18,8),
          snapshot_at, provider
currencies  code CHAR(3) PK, exponent SMALLINT, symbol,
            rounding_rule, enabled BOOL
```

### Tax display

EU and UK expect tax-inclusive display; the US expects tax-exclusive. Paddle handles the calculation and remittance as merchant of record — the storefront must respect its `display_mode` per locale rather than rendering one format globally.

---

## 5. Localization — 10 Languages

**Proposed locale set** (confirm against NaviMED's existing set before Sprint 1 — if it differs, this list changes, not the architecture):

| Locale | Language | Script | Market |
|---|---|---|---|
| `en` | English | LTR | US, UK, Anglophone Africa |
| `fr` | French | LTR | France, Francophone West/Central Africa |
| `pt` | Portuguese | LTR | Portugal, Brazil, Angola, Mozambique, Guinea-Bissau |
| `es` | Spanish | LTR | Spain, LatAm |
| `ar` | Arabic | **RTL** | North Africa, Gulf |
| `sw` | Swahili | LTR | Kenya, Tanzania, Uganda, DRC |
| `ha` | Hausa | LTR | Nigeria, Niger |
| `yo` | Yoruba | LTR | Nigeria, Benin |
| `ee` | Ewe | LTR | Togo, Ghana |
| `wo` | Wolof | LTR | Senegal, Gambia |

### Engineering implications

**Arabic forces RTL support**, which is not a translation task — it is a layout task. Logical CSS properties throughout (`margin-inline-start`, not `margin-left`), mirrored icons and progress indicators, `dir` attribute driven by locale, and a full visual QA pass per RTL screen. Budget roughly a full sprint week for this alone. If Arabic can be deferred to phase 2, the timeline shortens materially — that is a business call, not a technical one.

**Medical terminology must not be machine-translated.** NaviMED and CARNET surface clinical language. A mistranslated dosage field, consent string, or allergy label is a patient-safety issue, not a polish issue. Machine translation is acceptable for marketing copy; every clinical string requires review by a qualified speaker. Budget and schedule that as a real workstream with named reviewers.

**Yoruba, Ewe, Wolof, and Hausa have thin tooling.** Expect no off-the-shelf medical glossaries, inconsistent diacritics across input methods, and few professional localization vendors. Plan for in-house or community review, and verify font coverage for Yoruba and Ewe diacritics (`ẹ`, `ọ`, `ɖ`, `ƒ`, `ŋ`) across the chosen typeface — many web fonts silently drop these into tofu boxes.

**Other requirements**
- Locale from URL segment (`/[locale]/...`), default from `CF-IPCountry`, user override persisted in cookie
- Marketing and brand copy uses the inclusive **"nous"** voice in French
- `Intl.NumberFormat` and `Intl.DateTimeFormat` for all money and dates — never hand-rolled
- Pluralization via ICU message format; several of these languages do not follow English plural rules
- Email templates localized per customer's stored locale
- Translation keys managed in a single source of truth with a completeness report per locale in CI; a locale below 100% coverage falls back to `en` per-key, never per-page

---

## 6. Data Model

```sql
customers          id, keycloak_sub, email, name, country, locale,
                   preferred_currency, created_at

products           id, slug, type ENUM('service','subscription','download'),
                   status ENUM('draft','active','archived')

product_i18n       product_id, locale, name, description, meta_title,
                   meta_description
                   -- PRIMARY KEY (product_id, locale)

plans              id, product_id, slug, billing_interval,
                   features JSONB, seat_limit, sort_order

plan_i18n          plan_id, locale, name, feature_labels JSONB

prices             id, plan_id, currency, amount_minor, source,
                   gateway_price_id, fx_rate_used, fx_snapshot_at, active

currencies         code PK, exponent, symbol, rounding_rule, enabled

fx_rates           id, base, quote, rate, snapshot_at, provider

orders             id, customer_id, currency, locale, subtotal_minor,
                   tax_minor, total_minor, gateway, gateway_order_id,
                   status, created_at

order_items        id, order_id, plan_id, quantity, unit_amount_minor,
                   locked_price_minor

subscriptions      id, customer_id, plan_id, gateway, gateway_subscription_id,
                   status, current_period_start, current_period_end,
                   cancel_at_period_end, seats

entitlements       id, customer_id, product_slug, plan_slug, status,
                   seats, expires_at, source_subscription_id

license_keys       id, customer_id, product_slug, key_hash,
                   activation_limit, activations, expires_at, revoked_at

download_grants    id, customer_id, product_id, download_count,
                   max_downloads, expires_at

service_bookings   id, order_id, sku, intake_payload JSONB, status,
                   promised_delivery_date

webhook_events     id, gateway, gateway_event_id UNIQUE, type,
                   payload JSONB, processed_at, error
```

Translatable content lives in `*_i18n` side tables, never as JSONB blobs on the parent. Side tables let CI query coverage per locale; blobs hide gaps until a customer finds them.

---

## 7. Routes

### Public
```
/[locale]                        Home — three tiers
/[locale]/services               Services catalog
/[locale]/services/[slug]        SKU detail + intake form + buy
/[locale]/software               SaaS catalog
/[locale]/software/[slug]        Plan comparison + subscribe
/[locale]/downloads
/[locale]/downloads/[slug]
/[locale]/cart
/[locale]/checkout               Gateway + currency routing
/[locale]/checkout/success
/[locale]/legal/{terms,privacy,refunds}
```

### Authenticated (Keycloak)
```
/[locale]/account
/[locale]/account/subscriptions
/[locale]/account/downloads
/[locale]/account/licenses
/[locale]/account/orders
/[locale]/account/bookings
```

### Admin (Keycloak role-gated, enforced server-side)
```
/admin/products                  CRUD + per-locale content + price overrides
/admin/translations              Coverage matrix, missing-key report
/admin/currencies                Enable/disable, rounding rules, FX status
/admin/orders
/admin/subscriptions             Manual grant / revoke / extend
/admin/bookings
/admin/webhooks                  Failed event replay
```

### API
```
POST /api/checkout/session
POST /api/webhooks/paddle        Signature-verified
POST /api/webhooks/cinetpay      Signature-verified
GET  /api/v1/entitlements        Bearer-auth, consumed by portfolio products
POST /api/v1/licenses/activate
POST /api/v1/licenses/deactivate
GET  /api/v1/health
```

---

## 8. Entitlement API

The contract every ARGILETTE product depends on. Treat it as public from day one — versioned, documented, never breaking.

```http
GET /api/v1/entitlements?product=navimed
Authorization: Bearer <service-token>
X-Customer-Id: <keycloak-sub>
```

```json
{
  "customer_id": "3f9a...",
  "product": "navimed",
  "status": "active",
  "plan": "clinique",
  "seats": 15,
  "expires_at": "2026-09-15T00:00:00Z",
  "features": ["barika_ehr", "carnet_patient", "multi_site"]
}
```

**Requirements**
- Cached 60s at the edge; invalidated on any subscription webhook
- **Fail closed on auth, fail open on outage.** Invalid token → 401. But if the service is unreachable, consuming products honour last-known-good for up to 72 hours. A clinic must not lose access to patient records because a webhook worker died on a Saturday.
- Per-product service tokens, independently revocable

---

## 9. Checkout Flows

### Paddle (international)
1. Cart → `POST /api/checkout/session` with resolved currency and locale
2. Paddle overlay checkout, localized, tax-inclusive or exclusive per region
3. Webhook `transaction.completed` / `subscription.created` → write order, subscription, entitlement
4. Redirect to success page — **display only. Never grant access from a redirect, only from a verified webhook.**

### CinetPay (mobile money)
1. Cart → session with `currency=XOF`
2. CinetPay page: Orange Money, MTN, Moov, Wave, card
3. Customer confirms on their phone — this takes minutes, not seconds
4. Webhook notify → **re-verify server-side against CinetPay's check endpoint before granting.** Do not trust the notify payload alone.
5. Success page polls transaction status until confirmed or timed out

**Mobile money is asynchronous and unreliable in ways cards are not.** Build for: browser closed mid-payment, network drop after confirmation, duplicate notifies for one transaction. Every handler idempotent on `gateway_event_id`. A retry must never create a second subscription.

### Services SKUs
Payment plus structured intake (scope, deadline, contact, existing assets). On success create a `service_booking`, email confirmation with promised delivery date in the customer's locale, notify ops. Services are not instant delivery — say so on the product page, before payment.

---

## 10. Subscription Lifecycle

| Event | Action |
|---|---|
| `subscription.created` | Insert subscription + entitlement; welcome email + license key |
| `subscription.updated` | Recompute entitlement (plan or seat change) |
| `payment_failed` | Status → `past_due`; start dunning; **keep entitlement active** |
| Dunning day 3 / 7 / 14 | Retry + email in customer's locale |
| Day 21 unpaid | Status → `expired`; revoke entitlement |
| `subscription.canceled` | `cancel_at_period_end`; access runs to period end |

Twenty-one days of grace is deliberate. Mobile-money failures are frequently transient; a customer with a temporarily empty wallet is not a churned customer, and cutting a clinic off from its EHR on one failed charge is bad product and bad business.

---

## 11. Security

- Secrets in environment variables; nothing committed
- Webhook signature verification mandatory on both gateways; reject unsigned
- License keys stored hashed; shown in full exactly once at issuance
- Rate limits: 10/min checkout, 100/min entitlement API per token
- Download grants as short-lived signed URLs (15 min TTL), never direct object links
- Admin routes gated on a Keycloak realm role, enforced in server middleware
- CSP, HSTS via Cloudflare
- No PII in application logs

---

## 12. Environment

```
DATABASE_URL
KEYCLOAK_ISSUER / KEYCLOAK_CLIENT_ID / KEYCLOAK_CLIENT_SECRET
PADDLE_API_KEY / PADDLE_CLIENT_TOKEN / PADDLE_WEBHOOK_SECRET / PADDLE_ENV
CINETPAY_API_KEY / CINETPAY_SITE_ID / CINETPAY_SECRET_KEY
FX_PROVIDER_API_KEY / FX_REFRESH_CRON
SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_FROM
ENTITLEMENT_SERVICE_TOKENS   (JSON map: product_slug -> hashed token)
NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_DEFAULT_LOCALE
```

---

## 13. Milestones

Twelve weeks, revised from v1's eight. The added four weeks are 10-locale content infrastructure, RTL layout, and the currency engine — none of which existed in the two-language, two-currency version.

**Sprint 1 — Foundation (week 1–2)**
Scaffold, Drizzle schema with i18n side tables, Keycloak auth, locale routing for all 10, admin product CRUD with per-locale content, seeded catalog.
*Done when:* an admin creates a product with content in 10 locales and it renders correctly in each, Arabic included.

**Sprint 2 — Currency engine (week 3–4)**
Currencies reference table with exponents, FX snapshot job, rounding rules, override system, price-lock at cart, admin currency console.
*Done when:* the same plan renders correctly in USD, XOF, JPY, and KWD, with correct decimals and sensible rounding in each.

**Sprint 3 — International path + services (week 5–6)**
Cart, Paddle checkout, webhooks, orders, download grants, signed URLs, localized receipts, `/account`, services intake and booking pipeline.
*Done when:* a customer buys a service in any locale and ops receives a structured booking. **First revenue possible here.**

**Sprint 4 — Mobile money (week 7–8)**
CinetPay, mobile-money flow, async polling, idempotent webhooks, geo routing.
*Done when:* an Orange Money payment from Lomé grants access — including when the browser closes mid-flow.

**Sprint 5 — Subscriptions & entitlements (week 9–10)**
Lifecycle, dunning, entitlement API v1, license issuance and activation, one live integration against Node CRM.
*Done when:* Node CRM gates a feature on a live entitlement response; revoking in admin locks it within 60 seconds.

**Sprint 6 — RTL, localization QA, hardening (week 11–12)**
Full Arabic RTL pass, per-locale visual QA, clinical-terminology review sign-off, load testing, security review.
*Done when:* every screen passes visual QA in all 10 locales and clinical strings are signed off by named reviewers.

---

## 14. Acceptance Criteria

- [ ] Every page renders correctly in all 10 locales, Arabic in full RTL
- [ ] Yoruba and Ewe diacritics render correctly — no tofu boxes — in the production typeface
- [ ] Translation coverage report in CI; missing keys fall back per-key to `en`, never per-page
- [ ] Clinical strings signed off by a named qualified reviewer per language
- [ ] XOF and JPY render zero decimals; USD two; KWD three
- [ ] FX snapshot older than 48h freezes prices and alerts ops
- [ ] Price shown at add-to-cart equals price charged, even across an FX rollover
- [ ] Strategic overrides always beat FX conversion
- [ ] Rounding produces sellable numbers in every enabled currency
- [ ] Replaying any webhook creates no duplicate orders, subscriptions, or grants
- [ ] Killing the app mid-CinetPay-payment still grants entitlement once the webhook lands
- [ ] Entitlement API serves last-known-good during a simulated database outage
- [ ] License activation respects the activation limit
- [ ] Download URLs expire after 15 minutes
- [ ] Non-admin users get 403 on every `/admin` route, verified server-side
- [ ] Lighthouse performance ≥ 90 on mobile
- [ ] Tested against a real mobile-money sandbox transaction, not a mocked webhook
- [ ] Every draggable surface can be grabbed mid-animation and reversed without a jump
- [ ] Drag direction is correct in `dir="rtl"` on every gesture surface
- [ ] No server-rendered `style` attribute anywhere — the app runs under `style-src 'self' 'nonce-…'` with no `unsafe-inline`
- [ ] The mobile-money waiting state is fully legible with all animation disabled

The full design acceptance list is in [`docs/design-system.md`](../design-system.md) §8.

---

## 15. Design System

How the interface behaves is specified in [`docs/design-system.md`](../design-system.md), which
applies Apple's fluid-interface craft — vendored as a skill at
[`.claude/skills/apple-design/SKILL.md`](../../.claude/skills/apple-design/SKILL.md) — to this
platform. Springs rather than fixed-duration animations, 1:1 direct manipulation, interruptible
motion, momentum projection on release, translucent materials, and size-specific typography.

Four points where that craft meets constraints in this spec and the security spec, resolved there
in full:

1. **Spatial rules are direction-relative, and ours flip.** Arabic is a launch locale (§5), so
   every gesture and transition is expressed in logical axes. A `left` or `right` in gesture code
   or CSS is a defect, not a style preference.
2. **Strict CSP forbids the inline styles SSR animation usually relies on.** A `style` attribute in
   server-rendered HTML is blocked under `style-src` without `unsafe-inline` (security spec §5), so
   a sheet's resting transform would not apply until hydration. Resting state lives in a nonce'd
   stylesheet; runtime values are written through CSSOM, which CSP does not restrict.
3. **Blur is expensive on the hardware our primary market carries.** Backdrop blur radii are
   stepped, never interpolated, and capped at two concurrent blurred surfaces — otherwise the
   material layer costs us the Lighthouse ≥ 90 mobile target in §14.
4. **Mobile money resolves in minutes (§9), and no motion can hide that.** The CinetPay waiting
   state uses discrete true-when-shown steps, an honest elapsed counter, and explicit copy that
   closing the browser is safe — never a spinner or a timer-driven progress bar. This is the most
   important screen in the product to get right: it is where the customer has paid and has nothing
   yet.

**Implementation.** `src/lib/motion/` (springs, projection, rubber-banding, velocity, drag),
`src/lib/format/money.ts` (exponent-aware display for §4's currency model), `src/styles/`
(tokens, type scale, component resting states), `src/components/ui/`.

**Sprint impact.** Sprint 1 adopts the token and type layer with the locale routing, so no screen is
built against a scale it will later be retrofitted onto. Sprint 6's RTL and visual QA pass verifies
against the §7 review checklist and the §8 acceptance criteria.
