# ARGILETTE.shop

Commercial storefront and entitlement backbone for the ARGILETTE product portfolio.

Next.js 16 (App Router) · TypeScript strict · 10 locales including RTL Arabic · Paddle + CinetPay ·
exponent-aware multi-currency · Apple fluid-interface design system.

```bash
npm install
npm run dev        # http://localhost:3000 → redirects to your locale
npm run verify     # typecheck + 307 tests + production build
```

The app **runs with no credentials at all**. The catalog, all ten locales, the cart, the price
lock and the design system work out of the box. Payments return a clear `501` until gateway keys
are present — deliberately, so a half-configured deployment can never look like a working one.

---

## What is actually built and verified

| Area | State |
|---|---|
| Design system (motion, materials, type, a11y) | Built, tested, documented in `docs/design-system.md` |
| Brand (mark, lockup, favicon, palette) | Built from the supplied artwork as scalable geometry |
| 10 locales, RTL Arabic, per-key `en` fallback | Built and verified against a running server |
| Locale routing from `CF-IPCountry` + cookie override | Built and verified (`TG` → `fr`) |
| Catalog — every SKU and price from the catalog spec | Built, seeded in `src/data/catalog.ts` |
| Currency by region, strategic overrides beating FX | Built and verified (`US` → `$29.00`, `TG` → `F CFA 15,000`) |
| Cart, price lock, undo-on-remove | Built |
| Checkout UI, gateway routing, manual override | Built |
| Mobile-money waiting state | Built (`PaymentStatus`) |
| Strict CSP with per-request nonce, no `unsafe-inline` | Built, asserted in tests |
| `GET /api/v1/health` | Built |
| **Database schema + migration** (build spec §6) | Built, constraints verified against real Postgres |
| **Paddle + CinetPay webhooks**, idempotent on `gateway_event_id` | Built, verified under concurrent duplicate delivery |
| **CinetPay server-side re-verification** before any grant | Built |
| **Entitlement API** `/api/v1/entitlements`, signed, per-product tokens | Built |
| **Licence keys and signed download URLs** | Built |
| Terms, Privacy and Refunds pages | **Drafted, not reviewed** — see below |

## What is NOT built

Being precise about this matters more than the list above, because these are the parts that
handle money and access.

| Missing | Needs | Spec |
|---|---|---|
| **Keycloak auth** — no `/account`, no admin, no route protection | Keycloak client | Sprint 1 |
| **Paddle checkout session creation** — the webhook side is built; creating the overlay session is not | Paddle credentials | Sprint 3 |
| **FX engine** — daily snapshot, rounding rules, 48h staleness freeze | FX provider key | Sprint 2 |
| **Admin** — dead-letter replay UI (the query exists, the screen does not) | Keycloak roles | Sprint 5 |
| **mTLS** between entitlement API and consuming products | Deployment topology | Security §7 |
| Clinical-terminology review for the ten locales | Named reviewers | Sprint 6 |

The money-and-access path is now built and tested. What is left is authentication, the
outbound half of Paddle checkout, and operational surfaces.

**Access is granted in exactly one place.** `src/lib/commerce/fulfil.ts`, called only from a
verified webhook inside the transaction that records the event. `POST /api/checkout/session` still
returns `501` and never returns anything a client could read as a completed purchase — build spec
§9, *never grant access from a redirect, only from a verified webhook.*

---

## Deploying

The app is a standard Next.js 16 server-rendered application. It needs a Node runtime, not a
static host — locale routing, geo currency and the CSP nonce all run per request.

```bash
npm ci
npm run build
npm start          # honours $PORT
```

**Replit.** `.replit` is configured to install, build and run. Add environment variables through
Replit's Secrets pane, not a committed `.env`. Nothing in `.env.example` is required to boot.

**Vercel / Cloudflare.** Deploy as a normal Next app. In production, move the security headers to
the Cloudflare edge (security spec §5) and keep Cloudflare in front so `CF-IPCountry` is
populated — without that header everyone resolves to English and USD, which silently mis-prices
the primary market.

### After deploying, check

```bash
curl https://<host>/api/v1/health
curl -sI https://<host>/ -H 'CF-IPCountry: TG'   # expect 307 → /fr
```

---

## Two decisions worth knowing about before you change anything

**The legal pages are drafts and are not binding.** `/legal/terms`, `/legal/privacy` and
`/legal/refunds` are written from what the platform actually does — Paddle is merchant of record,
card data never reaches us, downloads expire in fifteen minutes, dunning runs twenty-one days, no
patient data exists anywhere. That makes them a useful starting point for a lawyer rather than a
finished document. Facts only ARGILETTE knows are `[[placeholders]]`, rendered highlighted on the
page so the site cannot quietly go live with them unfilled, and while `reviewPending` is true each
page shows a draft banner and is `noindex`. A test asserts a document cannot be marked reviewed
while placeholders remain. Security spec §2 and §15 already require counsel sign-off before launch;
this does not replace it.

**The CSP nonce makes pages render per request.** Next's bootstrap scripts are inline, so a
no-`unsafe-inline` policy needs a per-request nonce, and a per-request nonce cannot be baked into a
prerendered page. That is a real cost against the Lighthouse target, taken deliberately —
`'unsafe-inline'` on `script-src` would defeat the policy's purpose on a site handling payment. If
the marketing pages later need to be static, move CSP enforcement to the Cloudflare edge using
script hashes rather than relaxing it here.

**The stack is on Next 16, not the 15 the build spec originally named.** Next 15 pins `postcss`
and `sharp` versions carrying high-severity advisories, clearable only by the major upgrade.
Neither was reachable here — the postcss advisories need attacker-controlled CSS at build time and
ours is entirely first-party, and `sharp` backs `next/image`, which this app does not use — but
security spec §11 blocks merges on high findings, and a permanently-red audit trains people to
ignore it. `npm audit` now reports zero vulnerabilities. The build spec's stack table records the
change and the reason.

---

## Layout

```
src/app/[locale]/      Routes. The locale segment drives lang, dir and every logical property
src/components/brand/  Mark and lockup, rebuilt as geometry so they scale
src/components/ui/     Design-system primitives (Button, Sheet, Toolbar, Price, PaymentStatus)
src/components/site/   Header, Footer, CartDrawer, SkuCard, CheckoutClient
src/lib/motion/        Springs, momentum projection, rubber-banding, velocity, drag
src/lib/format/        Exponent-aware money — never /100
src/lib/commerce/      Cart with price lock, region and gateway routing
src/lib/security/      CSP construction
src/data/catalog.ts    Catalog seed, replaced by Drizzle queries in Sprint 1
src/styles/            Tokens, brand, type scale, materials, component resting states
messages/              Ten locale files; missing keys fall back to en per key
docs/                  Specs and the design system
```

## House rules

Full rationale in `CLAUDE.md` and `docs/design-system.md`. The ones with teeth:

1. **No patient data enters this system. Ever.** No PHI-capable column, no free-text field that
   could receive clinical data.
2. **Card data never touches our infrastructure.** Putting a card input in our DOM escalates PCI
   scope out of SAQ-A and is an architectural decision, not a frontend ticket.
3. **Never grant access from a redirect — only from a verified webhook**, idempotent on
   `gateway_event_id`.
4. **No `left`/`right` in CSS or gesture code.** Arabic ships on day one; a physical property is a
   silent RTL break.
5. **No inline `style` attribute in server-rendered markup.** The CSP drops it and the element
   renders unstyled. Asserted in the test suite.
6. **Money renders through `src/lib/format/money.ts`.** XOF has no decimals, KWD has three; a
   hardcoded `/100` produces invoices wrong by 1000×.

---

## The money-and-access path

Four properties hold this together. Each is enforced by something stronger than a code
review, and each has a test that fails if it is removed.

**Idempotency is a database constraint, not a check.** `webhook_events` has a unique index
on `(gateway, gateway_event_id)`. An application-level "have I seen this?" loses the race
under concurrent duplicate delivery — which mobile money actually produces — and the losing
race grants a second subscription. Verified with ten concurrent identical deliveries against
real Postgres: exactly one applies.

**A duplicate is an event already applied, not an id already seen.** The test is
`processed_at IS NOT NULL`. If it were "seen this id", a first delivery that failed halfway
would poison the id forever and the gateway's retry — the mechanism designed to fix exactly
that — would be discarded as a duplicate. The customer would have paid and got nothing,
and the logs would say "duplicate, skipped".

**A valid CinetPay signature is not a payment.** The notify is re-verified against
CinetPay's check endpoint before anything is granted. If that endpoint is unreachable the
handler returns 503 so CinetPay retries; it never records the event as processed, because
consuming the id would make the retry look like a duplicate and lose a real payment.

**Revocation has two classes.** Billing lapse, expiry and downgrade fail *open* for 72
hours — a clinic does not lose patient records because a card expired on a Saturday.
Security, fraud, chargeback and admin-for-cause fail *closed* immediately, bypass caching,
and are never cleared by a later payment. Paying does not undo a fraud finding.

### Running the database tests

The tests that matter here are properties of Postgres, not of TypeScript, so they run
against a real one. They skip when it is absent, so `npm test` works anywhere:

```bash
TEST_DATABASE_URL=postgres://user:pass@host/db npm test
```

### Applying the migration

```bash
psql "$DATABASE_URL" -f src/db/migrations/0001_init.sql
```

Idempotent — `CREATE TABLE IF NOT EXISTS` throughout, safe to re-run.
