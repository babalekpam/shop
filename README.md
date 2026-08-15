# ARGILETTE.shop

Commercial storefront and entitlement backbone for the ARGILETTE product portfolio.

Next.js 16 (App Router) · TypeScript strict · 10 locales including RTL Arabic · Paddle + CinetPay ·
exponent-aware multi-currency · Apple fluid-interface design system.

```bash
npm install
npm run dev        # http://localhost:3000 → redirects to your locale
npm run verify     # typecheck + 69 tests + production build
```

The app **runs with no credentials at all**. The catalog, all ten locales, the cart, the price
lock and the design system work out of the box. Payments return a clear `501` until gateway keys
are present — deliberately, so a half-configured deployment can never look like a working one.

---

## What is actually built and verified

| Area | State |
|---|---|
| Design system (motion, materials, type, a11y) | Built, 69 tests, documented in `docs/design-system.md` |
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

## What is NOT built

Being precise about this matters more than the list above, because these are the parts that
handle money and access.

| Missing | Needs | Spec |
|---|---|---|
| **Paddle checkout + webhooks** | Real credentials, then implementation | Sprint 3 |
| **CinetPay mobile money + server-side re-verification** | Real credentials, then implementation | Sprint 4 |
| **Database** — no Drizzle schema, no migrations. The catalog is a typed seed file. | Neon URL | Sprint 1 |
| **Keycloak auth** — no `/account`, no admin, no route protection | Keycloak client | Sprint 1 |
| **Entitlement API** `/api/v1/entitlements` — the actual point of the product | DB + tokens | Sprint 5 |
| **FX engine** — daily snapshot, rounding rules, 48h staleness freeze | FX provider key | Sprint 2 |
| **Licence keys, download grants, signed URLs** | DB | Sprint 3/5 |
| Legal pages (`/legal/*`) are linked but not written | Counsel | — |
| Clinical-terminology review for the ten locales | Named reviewers | Sprint 6 |

**Do not let anything grant access until the webhook handlers exist.** `POST /api/checkout/session`
currently validates the cart against the server-side catalog and returns `501`. It never returns
anything a client could read as a completed purchase. That is the shape the real implementation
must keep: build spec §9 — *never grant access from a redirect, only from a verified webhook.*

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
