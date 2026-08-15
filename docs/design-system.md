# ARGILETTE.shop — Design System

**Version:** 1.0
**Companion to:** Build Specification v2.0 and Security Specification v1.0
**Source of truth for craft:** [`.claude/skills/apple-design/SKILL.md`](../.claude/skills/apple-design/SKILL.md)

---

## 0. What this document is

The `apple-design` skill describes how an interface should feel: instant on press, glued to the
finger, interruptible mid-flight, carrying momentum, resisting at boundaries, built from translucent
material and size-specific type.

None of that is written for a storefront that ships Arabic on day one, prices in XOF and KWD, runs a
CSP with no `unsafe-inline`, and takes payments that resolve in *minutes* over mobile money on
low-end Android hardware.

This document is the resolution layer. Every section takes a rule from the skill and states what it
means here — including the four places where our constraints genuinely contradict it, and what we do
instead. It never softens the skill for convenience. Where we deviate, the deviation is named,
justified, and bounded.

**Read this with the skill open, not instead of it.**

---

## 1. The four real collisions

These are the places where following the skill literally produces a broken or non-compliant product.
Each has a resolution that preserves the *intent* of the original rule.

### 1.1 Spatial consistency is direction-relative — and our direction flips

> Skill §7: "A panel that slides in from the right must dismiss to the right."

Arabic is a launch locale. In RTL, the cart drawer must enter and exit from the **left**, and a
"forward" swipe on a carousel moves the opposite way. A rule expressed in physical directions is
wrong in five of our ten locales' worth of screens the moment `dir="rtl"` is set.

**Resolution — express every gesture and transition in logical axes.**

- Surfaces are anchored to `inline-start` / `inline-end`, never `left` / `right`.
- Drag deltas are converted to a logical delta by multiplying by a direction sign:
  `sign = dir === 'rtl' ? -1 : 1`. `src/lib/motion/direction.ts` owns this; no component computes it
  inline.
- `transform: translateX()` is still physical, so the **sign** is applied at the point the logical
  delta becomes a transform — one conversion, at the boundary.
- Icons that encode direction (chevrons, back arrows, progress) mirror. Icons that encode a real
  object (trash, lock, download) do not.
- Skill §7's symmetric-path rule survives intact: enter and exit still share a path. The path is just
  named `inline-end` instead of `right`.

The gesture-direction test is not "does it work in Arabic" — it is **"does the code contain the word
`left` or `right` at all."** If it does, it is a bug waiting for the RTL QA pass in Sprint 6.

### 1.2 Our CSP forbids the inline styles that SSR animation depends on

> Security spec §5: "Strict CSP with nonces, no `unsafe-inline`."

This is a hard security requirement and it is not negotiable. It has a consequence most frontend work
gets wrong:

- A `style="transform: translateY(100%)"` attribute **in server-rendered HTML is blocked** by
  `style-src` without `unsafe-inline`. The element renders with no transform — so a sheet that should
  start off-screen renders on top of the page for the duration of hydration.
- Setting the same value from JavaScript (`el.style.transform = …`, or React's `style` prop after
  hydration) goes through CSSOM and is **not** CSP-restricted. That path is fine.

**Resolution — initial state comes from a stylesheet, dynamic state comes from CSSOM.**

- Every animatable surface has its closed/resting state defined by a class in
  `src/styles/`, delivered as a nonce'd first-party stylesheet.
- Runtime values are written as CSS custom properties via `el.style.setProperty('--sheet-y', …)`,
  and the stylesheet consumes them: `transform: translateY(var(--sheet-y, 100%))`.
- **No component may pass a `style` prop that must be correct before hydration.** Review rejects it.
- Motion/Framer Motion's `initial` prop server-renders an inline style attribute. Use
  `initial={false}` and let the CSS class hold the resting state, or the surface flashes.

This costs one indirection and buys the CSP posture the security spec is built on. It also removes a
whole class of hydration flash bugs, so it is not purely a tax.

### 1.3 "Materialize, don't just fade" is too expensive for our primary market's hardware

> Skill §12: "animate blur radius and scale together on enter/exit."
> Build spec acceptance: "Lighthouse performance ≥ 90 on mobile."

`backdrop-filter: blur()` forces a readback and re-composite of everything behind the surface.
Animating the **radius** re-runs that blur every frame. On the mid-range and older Android devices
that dominate the West African market this drops a sheet from 60fps to visibly stepping — which
violates skill §11 (frame-level smoothness) in the course of obeying §12.

**Resolution — keep the material, step the blur, animate only compositor properties.**

- Blur radius takes **discrete values, never interpolated ones.** A sheet goes from
  `--material-blur-none` to `--material-blur-lg` in one step, on the frame the gesture commits.
- The *motion* of materialising is carried by `opacity` and `scale`, which are compositor-only and
  free. The eye reads the surface as arriving; it does not need the radius to ramp.
- Cap concurrent blurred surfaces at **two**. A scrim plus a sheet is the budget. A blurred toolbar
  behind a blurred sheet behind a blurred popover is three readbacks per frame.
- Cap blur radius at `24px`. Beyond that the cost climbs and the visual difference does not.
- `will-change` goes on **only** while a gesture is live, and is removed on settle. A permanent
  `will-change: transform` on every card promotes every card to its own layer and exhausts memory on
  exactly the devices we are protecting.

This is a deliberate, bounded deviation from skill §12. The material hierarchy it exists to create is
fully preserved; only the radius interpolation is dropped.

### 1.4 Mobile money resolves in minutes, and no amount of motion can hide that

> Skill §1: "Respond on pointer-down." "Feedback must be continuous *during* the interaction."
> Build spec §9: "Customer confirms on their phone — this takes minutes, not seconds."

This is the sharpest collision in the product. Apple's fluidity guidance assumes the system knows the
outcome and is merely moving toward it. On the CinetPay path we do not know the outcome, we cannot
know it for minutes, and the truthful answer is "we are waiting for a network we do not control."

A spinner here is a **lie about latency**, and it fails skill §16's Responsibility and Familiarity
principles at the exact moment the customer is most anxious — money has left, nothing has arrived.

**Resolution — respond instantly to the *tap*, then tell the truth about the *wait*.**

| Moment | What we owe the customer | Implementation |
|---|---|---|
| Pointer-down on "Pay" | Instant, ≤16ms visual acknowledgment | Skill §1 press state. Non-negotiable. |
| Submit accepted | Immediate transition to a named waiting state | Not a spinner. A titled status: *"Check your phone"* |
| During the wait | Honest status, elapsed time, what happens next | Stepped status list, no indeterminate loop |
| Confirmation lands | Motion + haptic on the **same frame** as the state change | Skill §13 harmony |
| Browser closed mid-flow | The purchase still completes | Copy says so, explicitly, before they leave |

Specific rules for `PaymentStatus`:

- **No looping animation near 0.2 Hz** (one cycle per ~5s). Skill §14 flags this as a vestibular
  trigger, and a five-second pulse is exactly what a naive "waiting" animation lands on.
- **No progress bar that fills on a timer.** A bar that reaches 90% and stops is worse than no bar.
  Progress is expressed as discrete completed steps, each one true when it appears.
- **Elapsed time is shown once the wait exceeds 20 seconds**, because at that point silence reads as
  breakage. It counts up honestly; it does not count down toward a deadline we cannot guarantee.
- **The page states that closing it is safe.** Build spec §9 already guarantees the webhook grants
  entitlement independently. The interface must say so, or the customer sits and watches a screen
  they were free to leave.
- **Reduced motion loses nothing.** The status is legible as text and state with every animation
  disabled — motion is never the carrier of "is this working."

The same discipline applies, less urgently, to the Paddle path: it is fast, but it is still an
external overlay and still may fail.

---

## 2. Motion

### 2.1 The two parameters

Per skill §4, think in **damping ratio** and **response**, never in mass/stiffness. Our mapping to
Motion's `bounce`/`duration` API lives in `src/lib/motion/spring.ts` and is the only place the
conversion is written.

| Token | Damping | Response | Use |
|---|---|---|---|
| `springs.ui` | `1.0` | `0.35` | Default. Anything that appears without a gesture behind it |
| `springs.reposition` | `1.0` | `0.4` | Moving an element to a new position (skill §4, Apple's PiP value) |
| `springs.sheet` | `0.8` | `0.3` | Drawers and sheets released from a drag |
| `springs.momentum` | `0.8` | `0.4` | Anything the user flicked or threw |
| `springs.snappy` | `1.0` | `0.25` | Small controls — toggles, chips, segmented controls |

**Bounce is earned, not decorative.** Skill §4: overshoot only when the gesture itself carried
momentum. A cart drawer the user *flicked* closed bounces. A cart drawer closed by clicking an X
button does not — it uses `springs.ui`. Two different springs on the same surface, chosen by how it
was dismissed, is correct and expected.

### 2.2 Interruptibility is a review gate, not an aspiration

Skill §3 calls this the single most important principle, and it is the one most often quietly
dropped under deadline. Concretely, for us:

- **No CSS `transition` or `@keyframes` on anything a pointer can touch.** They cannot be grabbed
  mid-flight. They remain correct for non-interactive decoration and for the reduced-motion
  cross-fade path (§4.3), where there is nothing to interrupt by design.
- **No `pointer-events: none` "while animating"**, no disabled state that exists only to protect an
  animation, no awaiting a transition before accepting the next input.
- Animations start from the **presentation value** — the live on-screen transform — not the target.
  Motion does this by default when you re-target a running animation; it does *not* if you unmount
  and remount the element, which is the usual way this gets broken.
- A sheet mid-close that the user grabs again follows the finger from where it visually is. If it
  jumps, the presentation value was not read.

### 2.3 Velocity handoff and momentum projection

The seam between drag and animation (skill §5) and the flick landing point (skill §6) are
implemented once, in `src/lib/motion/project.ts` and `velocity.ts`, and used by every draggable
surface.

- Release velocity is measured over a **short trailing window (~100ms)**, not from the last two
  events — a single jittery final sample produces a wild velocity and a sheet that rockets off.
- The resting point is projected with Apple's exponential-decay function,
  `project(v) = (v/1000) · d/(1−d)` with `d = 0.998`. The physics-textbook `v²/(2a)` form is
  explicitly not what ships (skill §6).
- The snap target is chosen from the **projected** endpoint, then the raw release velocity is handed
  to the spring. Choosing the target from the release *position* is the bug that makes a hard flick
  feel like it was ignored.
- **Commit/dismiss is decided by velocity sign, not by position** (skill Quick Reference). A drawer
  dragged 80% closed but flicked back open, opens. Position-only thresholds override the user's
  clearly expressed intent, which is a §16 Agency failure.

### 2.4 Boundaries

Rubber-banding (skill §9) applies at: the top of a scrolled sheet, the ends of the product carousel,
and the drag bounds of any draggable surface. Constant `0.55`, per the skill. Implementation in
`src/lib/motion/rubberband.ts`.

A hard stop is only correct where there is a real wall — a disabled control, a validation block.
Everywhere content merely runs out, it resists.

---

## 3. Materials & depth

Per skill §12, with the budget from §1.3 above.

| Token | Blur | Use |
|---|---|---|
| `--material-thin` | `12px` | Chips, badges, small floating controls |
| `--material-regular` | `20px` | Toolbars, nav, sticky headers |
| `--material-thick` | `24px` | Sheets, modals, cart drawer |

- **Bigger surface reads thicker** — a sheet gets `--material-thick` plus a deeper shadow than a chip
  at `--material-thin`. This is the hierarchy signal; it is not decoration.
- **Never stack two light translucent surfaces.** Legibility collapses (skill §12). If a popover must
  open over a sheet, the popover is **solid**.
- **Dim to focus, separate to keep flow.** Checkout and destructive admin confirmations are modal —
  scrim plus pushed-back background. The cart drawer is a *parallel* task, not a modal one: it uses
  translucency and offset with **no scrim**, so browsing continues behind it.
- **Scroll edge effect, not a divider.** Where content passes under floating chrome, fade a short
  gradient mask. No 1px border. The mask appears only when content is actually beneath the chrome.
- **Vibrancy for text on material.** Text over a translucent surface gets higher contrast, one step
  more weight, and a small positive tracking bump. Never flat mid-gray on glass. Colour goes on a
  solid layer, never on the translucent foreground.

---

## 4. Typography

### 4.1 The system font is right, and it is not enough for us

Skill §15 says default to the platform system font — it ships optical sizing and tracking tables. We
agree, and we still cannot stop there.

Build spec acceptance: *"Yoruba and Ewe diacritics render correctly — no tofu boxes — in the
production typeface."* The characters at risk are `ẹ ọ ɖ ƒ ŋ` and their combining forms. Coverage on
the Android system stack in our primary market is **inconsistent**, and a missing glyph does not
degrade gracefully — it renders a tofu box in the middle of a product name.

**Resolution — system font first, with a verified self-hosted fallback.**

```css
--font-sans: system-ui, -apple-system, "Segoe UI", Roboto,
             "ARGILETTE Latin Extended",   /* self-hosted, subsetted, verified coverage */
             sans-serif;
--font-arabic: system-ui, "Noto Naskh Arabic", serif;
```

- The fallback face is **self-hosted and subsetted** — never a font CDN. That is a CSP and
  supply-chain requirement (security spec §5, §11), not a performance preference.
- CI asserts glyph coverage for the full diacritic set across every locale's sample strings. A
  missing glyph fails the build. This is the mechanism behind the acceptance criterion; without it,
  "no tofu boxes" is a hope.
- `font-display: swap` on the fallback, so a slow font never blocks text.

### 4.2 Tracking and leading are size-specific

Skill §15: a single `letter-spacing` value is wrong somewhere. Our scale, in
`src/styles/typography.css`:

| Step | Size | Tracking | Leading | Use |
|---|---|---|---|---|
| `display` | `clamp(2rem, 5vw, 3.5rem)` | `-0.022em` | `1.05` | Hero, price on plan comparison |
| `title-1` | `2rem` | `-0.018em` | `1.15` | Page titles |
| `title-2` | `1.5rem` | `-0.012em` | `1.25` | Section headings |
| `title-3` | `1.25rem` | `-0.006em` | `1.3` | Card headings |
| `body` | `1rem` | `0` | `1.55` | Body copy |
| `callout` | `0.9375rem` | `0.004em` | `1.5` | Secondary copy |
| `caption` | `0.8125rem` | `0.01em` | `1.4` | Labels, metadata, legal |

Negative tracking as text grows, slightly positive as it shrinks — exactly skill §15. Hierarchy is
built from **weight + size + leading as a set**, never size alone.

### 4.3 Ten locales change the type, not just the strings

- **Arabic gets its own leading.** Naskh has taller ascenders and deeper descenders; body leading
  goes from `1.55` to `1.7`, and the tracking values above are **zeroed** — letter-spacing on Arabic
  breaks the cursive joins outright. This is applied by `[lang="ar"]`, not by a component prop.
- **Diacritic-heavy Latin (Yoruba, Ewe) gets more leading**, not more tracking. `ẹ̀` `ọ́` stack below
  and above the line; tight leading collides them with the neighbouring line.
- **All spacing in `rem`/`em`, never `px`** (skill §15, Dynamic Type). French and Portuguese strings
  run materially longer than English; a layout that only fits at the English string length will break
  in Sprint 6 QA, not before.
- **Money is `font-variant-numeric: tabular-nums`.** Proportional figures make a price jitter
  horizontally when quantity changes, which reads as instability on the one number the customer cares
  about most.

---

## 5. Accessibility

Skill §14 gives three independent signals. All three are honoured at the token layer in
`src/styles/tokens.css`, so a component gets them without opting in.

| Signal | What changes |
|---|---|
| `prefers-reduced-motion: reduce` | Springs and slides become ≤200ms opacity cross-fades. Overshoot dropped everywhere. Position changes become instant. Colour and opacity changes that carry meaning are kept. |
| `prefers-reduced-transparency: reduce` | Blur to `0`, background opacity to `1`. Materials become solid surfaces; hierarchy falls back to the shadow scale. |
| `prefers-contrast: more` | Near-solid backgrounds, explicit contrasting borders on every surface edge, vibrancy dropped in favour of maximum contrast. |

Additional rules from skill §14 that bind us specifically:

- **No full-viewport moving background** anywhere, including marketing pages.
- **No looping oscillation near 0.2 Hz** — this is the payment-waiting rule from §1.4, and it applies
  to skeleton loaders too.
- **Light/dark theme changes are eased, never cut.** An abrupt full-page brightness jump is a
  documented trigger.
- Reduced motion **is not reduced feedback.** A press state, a status change, and an error are still
  fully expressed — as opacity and colour rather than movement.

---

## 6. Applying this to our actual surfaces

### 6.1 Cart drawer

Parallel task, not modal (skill §12). Enters from `inline-end`, dismisses to `inline-end`.
Translucent `--material-thick`, **no scrim** — the catalog stays visible and browsable behind it.
Draggable to dismiss with rubber-banding at the open bound, momentum projection on release,
`springs.sheet` when flicked and `springs.ui` when closed by the button.

Removing a line item is **undo-with-a-toast, not a confirmation dialog** (skill §16 Agency:
forgiveness over friction; reserve dialogs for genuinely destructive, irreversible actions).

### 6.2 Price display

- Locked price is a **visible state**, not a silent one. Build spec §4 guarantees the price shown at
  add-to-cart is the price charged even across an FX rollover; if the rate moves and the number does
  not, the customer must be able to see *why*. A quiet "Price held for this session" caption turns a
  suspected bug into a demonstration of trustworthiness — skill §16 Craft and Responsibility.
- Price changes **cross-fade**; they never roll or slide. Sliding digits imply a counter, which
  implies the value is still moving.
- Tabular numerals, exponent-aware formatting through `src/lib/format/money.ts`. XOF renders zero
  decimals, USD two, KWD three — from the currency table, never from a literal.

### 6.3 Checkout

Modal. Scrim plus pushed-back background — this is a task that deserves undivided attention, and
skill §12's dim-to-focus is exactly right for it.

- **Zero third-party scripts beyond the gateway** (security spec §11). No analytics, no chat widget,
  no pixel. This is a security requirement that happens to also be skill §16 Purpose: the page has
  one job.
- Gateway routing is a **default, never a lock** (build spec §3). The manual override is visible on
  the page, not buried behind a link — a diaspora customer in Paris paying for a Lomé clinic must be
  able to reach the FCFA path without hunting. Skill §16 Agency and Flexibility.
- Validation is **inline, as you go** — never a wall of errors on submit (skill §16 feedback rules).

### 6.4 Mobile-money waiting state

Fully specified in §1.4 above. It is the single most important screen in the product to get right,
because it is where the customer has paid and has nothing yet, on the payment path our primary
market actually uses.

### 6.5 Navigation

Skill §16: *"Name nav items for their contents, not vague umbrellas."* Applied to the build spec's
route table:

| Route | Label | Not |
|---|---|---|
| `/[locale]/services` | **Security & Engineering** | "Services" |
| `/[locale]/software` | **Software** | "Products" |
| `/[locale]/downloads` | **Downloads** | "Resources" |
| `/[locale]/account` | **Your account** | "Dashboard" |

Every screen answers skill §16's four wayfinding questions. The mobile-money waiting state
specifically must answer *"how do I get out?"* — and its honest answer is "you may leave; this
completes without you."

### 6.6 Admin

The one place a confirmation dialog is **correct**. Revoking an entitlement cuts a clinic off from
its records; that is genuinely destructive and effectively irreversible in the moment. It gets a
typed confirmation, not a one-click OK.

Everything else in admin — editing copy, adjusting a price override, toggling a currency — is
reversible and gets undo instead. Skill §16 is explicit that overusing confirmation trains people to
click through, which is precisely what makes the *one* dialog that matters ineffective.

---

## 7. Review checklist

Applied to any PR that touches the interface.

**Response & manipulation**
- [ ] Visual feedback fires on `pointerdown`, not `click`
- [ ] Dragged elements track 1:1 and respect the grab offset
- [ ] Pointer capture set, so tracking survives leaving the element bounds

**Interruptibility**
- [ ] Every animation can be grabbed and reversed mid-flight
- [ ] No CSS `transition`/`@keyframes` on gesture-driven motion
- [ ] Animations start from the presentation value — no jump on interrupt
- [ ] No input lockout, no `pointer-events: none` during a transition

**Momentum**
- [ ] Release velocity measured over a trailing window, not the last two events
- [ ] Snap target chosen from the *projected* endpoint
- [ ] Release velocity handed to the spring
- [ ] Commit/dismiss decided by velocity sign, not position alone
- [ ] Bounce present only where a gesture carried momentum

**Internationalisation**
- [ ] No `left`/`right` in CSS or gesture code — logical properties throughout
- [ ] Verified in `dir="rtl"`, including drag direction and icon mirroring
- [ ] Spacing in `rem`/`em`; layout survives a 40% longer string
- [ ] Arabic leading and zeroed tracking applied
- [ ] Diacritics render — no tofu — in the production typeface

**Security & performance**
- [ ] No `style` attribute in server-rendered markup
- [ ] Dynamic values set via CSS custom properties through CSSOM
- [ ] No CDN font, script, or stylesheet
- [ ] Only `transform` and `opacity` animated
- [ ] `will-change` scoped to live gestures and removed on settle
- [ ] Blur radius stepped, not interpolated; ≤2 blurred surfaces; ≤24px
- [ ] Money formatted through the exponent-aware helper

**Accessibility**
- [ ] Correct under all three of reduced-motion, reduced-transparency, and increased-contrast
- [ ] No looping animation near 0.2 Hz
- [ ] Feedback survives motion being disabled
- [ ] Meaning never carried by motion alone

---

## 8. Acceptance criteria

Additions to build spec §14, verifiable in Sprint 6's QA pass.

- [ ] Every draggable surface can be grabbed mid-animation and reversed without a visual jump
- [ ] A hard flick lands where the projection says, not at the nearest snap point to the release
- [ ] Drag direction is correct in `dir="rtl"` on every gesture surface
- [ ] No server-rendered `style` attribute anywhere in the app — asserted in CI
- [ ] The app renders correctly with `style-src 'self' 'nonce-…'` and no `unsafe-inline`
- [ ] Sheets and drawers hold 60fps on a mid-range Android reference device
- [ ] Yoruba and Ewe diacritic coverage asserted in CI against every locale's sample strings
- [ ] The mobile-money waiting state is fully legible with all animation disabled
- [ ] The mobile-money waiting state contains no animation looping near 0.2 Hz
- [ ] Closing the browser during a mobile-money wait still completes the purchase, and the interface
      said so before it happened
- [ ] Price-lock state is visible to the customer whenever a locked price differs from the live rate
- [ ] Admin entitlement revocation is the only confirmation dialog in the product
