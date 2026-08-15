# ARGILETTE.shop

Commercial storefront and entitlement backbone for the ARGILETTE product portfolio.
Next.js 16 (App Router) · TypeScript strict · Drizzle/Postgres · Keycloak · Paddle + CinetPay · 10 locales.

## Read before you build

| Document | What it governs |
|---|---|
| [`docs/specs/argilette-shop-build-spec.md`](docs/specs/argilette-shop-build-spec.md) | Architecture, currency model, data model, routes, milestones |
| [`docs/specs/argilette-shop-security-spec.md`](docs/specs/argilette-shop-security-spec.md) | The PHI boundary, PCI scope, entitlement hardening |
| [`docs/specs/argilette-shop-catalog.md`](docs/specs/argilette-shop-catalog.md) | Products, tiers, pricing |
| [`docs/design-system.md`](docs/design-system.md) | **How the interface behaves** — Apple fluid-interface craft resolved against our constraints |
| [`.claude/skills/apple-design/SKILL.md`](.claude/skills/apple-design/SKILL.md) | Upstream design source of truth |

The `apple-design` skill is vendored into this repo, so it loads automatically. Anything you build
that a user can see or touch goes through it — and through `docs/design-system.md`, which is where
its guidance is made concrete for RTL, ten locales, strict CSP, and asynchronous mobile money.

## Three rules that outrank everything else

1. **No patient data enters this system. Ever.** No PHI-capable columns, no free-text field that
   could receive clinical data, no clinical claim in any token the store can read. Enforced at
   review, not by policy. (Security spec §0.)
2. **Card data never touches our infrastructure.** Paddle and CinetPay host their own payment
   fields. Putting a card input in our DOM escalates PCI scope from SAQ-A and is an architectural
   decision, not a frontend ticket. (Security spec §6.)
3. **Never grant access from a redirect — only from a verified webhook.** Every handler idempotent
   on `gateway_event_id`. (Build spec §9.)

## Frontend house rules

These are the design-system rules with teeth in code review. Full rationale in `docs/design-system.md`.

- **No inline `style` attributes in server-rendered markup.** Our CSP runs `style-src` without
  `unsafe-inline`, so a `style="..."` attribute in SSR HTML is blocked and the element renders
  unstyled — a closed sheet would sit on top of the page until hydration. Resting state goes in a
  stylesheet; dynamic values are written at runtime through CSSOM (`el.style.transform = …` or
  `el.style.setProperty('--sheet-y', …)`), which is a property write, not attribute parsing, and is
  not CSP-restricted. `npm test` asserts no primitive server-renders a `style` attribute.
- **No CDN anything** — no third-party fonts, no script tags, no stylesheets. Everything
  first-party, pinned, in the lockfile. Paddle's checkout domain is the only permitted third-party
  script origin, and nothing else may load on a checkout page. (Security spec §5, §11.)
- **Physical CSS properties are a bug.** `margin-inline-start`, never `margin-left`. Arabic is a
  launch locale, not a phase-2 nicety, and a physical property is a silent RTL break.
- **Animate `transform` and `opacity` only.** Anything else costs layout or paint, and the mobile
  Lighthouse ≥90 target is measured on the hardware our primary market actually carries.
- **Money renders through `src/lib/format/money.ts`.** Never `/100`, never a hardcoded two
  decimals — XOF has zero, KWD has three, and a hardcoded exponent produces invoices wrong by 1000×.

## Layout

```
src/styles/          Design tokens, type scale, materials — plain CSS, no build-time magic
src/lib/motion/      Springs, momentum projection, rubber-banding, velocity, drag
src/lib/format/      Exponent-aware money and number formatting
src/components/ui/   Primitives that implement the design system
docs/                Specs and the design system
```
