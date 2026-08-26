# ARGILETTE Agency — Specification

**Version:** 0.1 — planning draft, nothing built
**Owner:** ARGILETTE LLC
**Companion to:** Build Specification v2.0, Security Specification v1.0, Catalog
**Status:** Design only. No code exists. Approve or amend §0 before anything is built.

---

## 0. The decision that matters most

**The agent team does the work. It does not sign the contract on the two deals that pay the bills.**

The catalog sets the target at roughly $5,100/month, composed as one penetration test, one
compliance retainer, ~20 SaaS subscribers and four clinic subscriptions. Eighty-five percent of
that revenue is **two enterprise sales**.

Autonomous outbound is a volume instrument. It is the correct tool for the downloads and the
self-serve subscriptions. It is the wrong tool for the two deals, and the catalog already says why:

> *"buyers at this price point ask who performed the testing and what certifications they hold.
> Lead with your credentials and the platform, not with ARGILETTE's size."*

The asset that closes a $3,500 pentest is a named human holding an M.S. in Cybersecurity and
Security+. An agent cannot be that credential, and a buyer who discovers an AI negotiated their
security engagement has been given a reason to doubt the engagement itself.

So autonomy is **split by tier**, not applied uniformly:

| Tier | Agent autonomy | Human involvement |
|---|---|---|
| Downloads, self-serve SaaS | Full — research, outreach, nurture, and the storefront closes | None per deal |
| Engineering services | Research, outreach, nurture, scope draft, scheduling | Approves scope and price |
| NeVral — pentest, compliance | Research, warm-up, scheduling, follow-up, proposal draft | **Takes the call. Signs.** |

This is not a smaller system. The agent still performs the overwhelming majority of the labour on
every tier. It does not sign.

**The second non-negotiable:** this system inherits the storefront's PHI boundary in full. NaviMED
prospects are clinics. No agent may ingest, store, or transmit patient data, and no lead record may
contain a field capable of holding it. Security spec §0 applies here unchanged.

---

## 1. Objective

Replace the function of an outbound agency and an SDR team for ARGILETTE's own growth, and prove it
well enough to sell later.

Two jobs:

1. **Generate and progress demand** — find the right organisations, reach them legitimately, hold a
   conversation, and hand over a qualified, scheduled, briefed opportunity.
2. **Close what can be closed without a human** — downloads and self-serve subscriptions complete
   through the existing ARGILETTE.shop checkout with nobody in the loop.

**Phase 2 is productization.** Run it on ARGILETTE first as the reference deployment, then package
it as a catalog tier. That is the same argument the security spec makes for dogfooding NeVral: it
validates the product, generates the artefacts, and gives a buyer something real to look at.

---

## 2. What the team is

Seven roles. Each is a bounded agent with its own tools, its own prompt, and its own audit trail —
not one agent with a large toolbelt, because a bounded agent is one you can reason about when it
misbehaves.

| Agent | Owns | Never does |
|---|---|---|
| **Scout** | ICP definition, account discovery, firmographic enrichment, disqualification | Contacts anyone |
| **Analyst** | Scoring, prioritisation, territory and cadence planning, reporting | Writes customer-facing copy |
| **Writer** | Sequences, posts, proposals, ad creative, localisation into FR/EN | Sends anything |
| **Operator** | Sending, scheduling, cadence execution, suppression enforcement | Composes from scratch |
| **Responder** | Inbound replies, qualification, objection handling, booking | Discusses price above the self-serve tier |
| **Publisher** | LinkedIn organic, blog, SEO content | Posts anything naming a client |
| **Steward** | Compliance checks, DSAR handling, suppression, audit, kill switch | Anything customer-facing |

The Steward is deliberately not a persuasive agent. Its job is to say no.

**One thing that is not an agent:** the compliance gate is *code*, not a prompt. Suppression,
consent state and rate limits are enforced in the send path with a database constraint behind them.
An agent that is merely instructed not to contact a suppressed address will eventually contact a
suppressed address.

---

## 3. Autonomy model

Every action is classified. There are three levels and nothing sits between them.

| Level | Meaning | Examples |
|---|---|---|
| **L0 — Autonomous** | Acts. Logged. No notification. | Research, enrichment, scoring, drafting, scheduling a send, replying to an inbound question answerable from the catalog, booking a call into a free slot |
| **L1 — Autonomous, notified** | Acts, then tells you. Reversible within a window. | First-touch outreach to a new account, publishing a scheduled post, sending a proposal for an engineering SKU, moving a deal stage |
| **L2 — Proposes only** | Cannot act. Waits for a human. | Everything in §3.1 |

L1 is where most of the system lives. The point of L1 is that you read a digest, not a queue.

### 3.1 The L2 gates — non-negotiable

These require a human decision. They are hard-coded, not configurable by an agent.

1. **Accepting a penetration-testing or compliance engagement.** A human verifies the client owns or
   is authorised to test the target. The draft Terms already require this warranty; an agent closing
   the deal without verification sells ARGILETTE into unauthorised access to third-party systems.
   This is the single most important gate on the page.
2. **Any claim about credentials, certifications, or past clients.** These are templated strings
   drawn from a fixed register, never generated. A fabricated certification claim is fraud, and it
   is the exact claim this market checks.
3. **Any pricing below catalog, any custom scope, any contractual commitment** not already in the
   catalog.
4. **Launching a new paid campaign, or raising the spend cap** (§7).
5. **Adding a new lead source** (§6.3). New sources are where legal exposure enters.
6. **Any public post naming a client**, or referencing a security finding, even anonymised.
7. **Contacting anyone on the suppression list** — this one is not a gate so much as an
   impossibility; it fails closed at the database.

### 3.2 The kill switch

One flag halts every outbound action across every channel, immediately, and records who set it and
why. It is reachable without deploying, and it fails safe: if the flag store is unreachable, outbound
stops.

A system that runs unattended needs an off switch more than it needs any individual feature.

---

## 4. Channels

Version one covers three. Each has real constraints that shape the build rather than decorate it.

### 4.1 Email — the workhorse

- **A separate sending domain. This is not optional.** Cold outreach must never share a domain with
  transactional mail. The storefront sends receipts, licence keys and dunning notices through Postal
  and SES (build spec §2); if outbound reputation degrades, licence keys stop arriving and paying
  customers are the ones who suffer. Use `go.argilette.shop` or similar, with its own SPF, DKIM and
  DMARC, and keep `argilette.shop` transactional-only.
- Warm-up schedule before volume. Ramp over weeks, not days.
- Every message: identifiable sender, real postal address, one-click unsubscribe honoured
  immediately and in any case within the statutory window.
- Reply detection routes to the Responder; unsubscribes and bounces route to the Steward and hit
  suppression synchronously.
- Hard per-domain and per-day rate limits, enforced in the send path.

### 4.2 WhatsApp Business API — the West African channel

Dominant for clinics and SMEs across Togo, Senegal, Côte d'Ivoire and Benin, which is where the
NaviMED and Node CRM demand actually is.

- Official API only. **Template messages require Meta pre-approval**, and business-initiated
  messages require an opt-in on record. This is a platform rule with account termination behind it,
  and it means WhatsApp is a *nurture and support* channel far more than a cold-open channel.
- The 24-hour customer-service window governs free-form replies. The Responder must know which
  window it is in; outside it, only approved templates.
- Opt-in provenance is stored per contact — when, where, and by what wording.

### 4.3 LinkedIn — organic publishing only

- Publishing and engagement from ARGILETTE's own presence.
- **No automated connection requests, no automated DMs, no scraping.** These violate LinkedIn's
  terms regardless of tooling, enforcement is aggressive, and the account at risk is the one the
  catalog says already produces inbound. Losing it costs more than the automation saves.
**Access is an application, and a LinkedIn Page alone does not grant it.** The Page is the object
you post *to*; the gate is the Community Management API, and it has five prerequisites:

| Requirement | ARGILETTE status |
|---|---|
| A registered legal entity — individuals are refused | ✅ ARGILETTE LLC |
| A LinkedIn Page | ✅ held |
| A developer app, with business email, legal name, registered address and website | ⬜ to create |
| A **Page super admin verifying the app** — no verification, no access | ⬜ to do |
| An access request stating the use case, reviewed by LinkedIn | ⬜ to submit |

Two tiers follow. **Development Tier** is granted first and caps at roughly 500 requests per app and
100 per member. That is almost certainly sufficient for our volume — a handful of posts a day plus
comment reads is nowhere near the ceiling — so **Standard Tier is unlikely to be on the critical
path.** The blocker is the initial approval, not the upgrade.

LinkedIn publishes no approval timeline and third-party reports range from days to months. Plan for
the Publisher drafting while a human posts, and treat API posting as an improvement that lands when
it lands rather than a dependency.

**Where the value actually is.** The catalog says inbound already arrives through the founder's
personal profile, and that the sale is credential-led. Personal posts also out-reach Page posts
substantially on this platform. The permission set includes `w_member_social`, so posting as a member
— with that member authorising their own app — is legitimate, unlike automated connections or DMs.
But the credential is the product here: personal posts should stay review-before-send even where
automation is permitted. Automate the Page freely; assist rather than replace the personal voice.

### 4.4 Paid ads — phase 2, machinery built now

Not in version one. The spend-cap and approval machinery in §7 is built now so enabling Google and
Meta later is configuration rather than a redesign. Ads suit the downloads and self-serve tiers,
where volume converts; they do not suit a two-deals-a-month enterprise motion.

---

## 5. System of record — Node CRM

**The pipeline lives in Node CRM.** ARGILETTE sells it; the security spec's argument for running the
storefront through NeVral applies unchanged. Building on your own CRM produces a reference
deployment, a case study, and sustained pressure on the product's real gaps.

Accept the cost honestly: if Node CRM lacks something the agency system needs, that becomes Node CRM
roadmap work rather than a HubSpot subscription. That is the point, but it is a cost.

Every agent reads and writes through the CRM's API. No agent keeps private state about a contact.
There is one record per human and it is auditable.

---

## 6. Data and lawful basis

The part most likely to be built wrong, and the part with the largest downside.

### 6.1 Every contact carries a lawful basis

No record enters the outreach pool without one, recorded explicitly and dated:

| Basis | When | Notes |
|---|---|---|
| Consent | They opted in | Provenance stored: when, where, exact wording |
| Contract | Existing customer | Covers service messages, not marketing |
| Legitimate interest | B2B cold outreach | Requires a written, dated LIA per source. Narrow. |

Regimes in scope are already enumerated in security spec §2 — GDPR, Nigeria's NDPA, Togo and the
wider UEMOA framework, US state laws. Outreach volume is what converts a theoretical obligation into
a complaint, so the register is not paperwork.

### 6.2 Suppression is absolute and synchronous

One list. Unsubscribes, bounces, complaints, DSAR erasures and manual additions all land in it.
Checked in the send path against a unique constraint, not by an agent's judgement. Suppression
survives re-import from any source — a contact who opted out and reappears in a new list stays
suppressed.

### 6.3 The existing lead lists

The catalog is explicit that the ECOWAS clinic CSV and the 63-institution APSFD tracker should not be
commercialised, because *"reselling personal contact data creates real legal exposure."*

Using them to drive automated outreach is not the same act, but it draws on the same exposure and
adds volume, which is what attracts regulator attention. The recommendation:

- Do **not** pipe them into automated sequences.
- If they are used at all, use them for *research* — identifying which organisations to approach —
  and reach those organisations through a publicly listed business contact under a documented
  legitimate-interest assessment, not by mailing a named individual from a scraped list.
- Any decision to do otherwise is a business decision made with counsel, recorded, and not something
  an agent may initiate. That is why "adding a new lead source" is an L2 gate.

### 6.4 DSAR and erasure

Access, rectification, erasure, objection and portability requests are handled within one month.
Erasure removes the contact everywhere except the suppression list, which retains the minimum needed
to keep honouring the objection — deleting someone entirely means mailing them again next quarter.

---

## 7. Spend control

Built now, exercised in phase 2.

- A **hard monthly ceiling**. The agent optimises freely beneath it. Reaching it stops spend; it does
  not trigger a request.
- Raising the cap, or launching a new campaign type, is L2.
- Spend is tracked against pipeline in the same reporting run, so the question "is this working" has
  a number rather than an impression.
- **LLM cost is spend too.** Token consumption per lead is metered with its own ceiling. An
  autonomous research loop with no cost bound is a way to spend four figures on a lead worth $29.

---

## 8. Integration with ARGILETTE.shop

- Campaign attribution flows through to the order, so revenue is traceable to a source.
- Entitlement webhooks flow back to the CRM: a completed purchase updates the pipeline without an
  agent asserting it did.
- **The agent never grants entitlements and never touches the checkout session route.** Access comes
  from a verified payment webhook and from nothing else (build spec §9). An agent with a "mark as
  paid" capability is a way to give away products.
- Self-serve closes are the storefront's existing flow. The agency system routes people to it; it
  does not reimplement it.

---

## 9. Observability

- Every outbound action, every agent decision, and every gate outcome is logged with the agent, the
  input, and the reasoning.
- Privileged actions extend the existing Merkle-chained audit pattern (security spec §10), so the
  record is tamper-evident.
- Daily digest of L1 actions. Weekly performance review. Immediate alert on: a compliance gate
  refusing something, bounce or complaint rate crossing threshold, spend pacing, and any agent error
  loop.
- **Nothing clinical, no credentials and no full message bodies containing personal data in logs.**

---

## 10. Failure modes to design against

| Failure | Consequence | Mitigation |
|---|---|---|
| Agent fabricates a credential or a client | Fraud; destroys the credential-led sale | Templated register, L2 gate, refusal to generate |
| Domain reputation collapse | Licence keys stop arriving for paying customers | Separate sending domain, warm-up, rate limits |
| LinkedIn account ban | Loses the channel the catalog says produces inbound | Organic only, no automation of connections or DMs |
| Runaway loop | Cost, or a contact mailed forty times | Per-contact frequency cap, token ceiling, kill switch |
| Agent closes an unauthorised pentest | Unauthorised access to a third party's systems | L2 gate, human authorization check |
| Prompt injection from a scraped page or an inbound reply | Agent follows an attacker's instruction | Treat all external content as untrusted data; no tool-use decisions taken from fetched content |
| Suppressed contact re-imported | Regulatory complaint | Suppression checked at send, survives re-import |

Prompt injection deserves emphasis: this system reads attacker-reachable text by design — inbound
replies, company websites, social profiles. An agent that treats fetched content as instruction is
one email away from being redirected.

---

## 11. Milestones

Six weeks to a working internal system. Deliberately sequenced so the compliance spine exists before
anything sends.

**Phase 1 — Spine (week 1–2).** CRM schema, lawful-basis register, suppression with its database
constraint, kill switch, audit log, agent framework and dispatcher. *Done when:* a send is attempted
against a suppressed contact and fails closed, with an audit entry.

**Phase 2 — Research and content (week 2–3).** Scout, Analyst, Writer. No sending. *Done when:*
scored, enriched accounts appear in Node CRM with drafted, localised sequences attached, and nothing
has left the building.

**Phase 3 — Email (week 3–4).** Separate domain, authentication, warm-up, Operator, Responder,
reply and bounce handling. *Done when:* a sequence runs end to end, a reply routes correctly, and an
unsubscribe suppresses synchronously.

**Phase 4 — WhatsApp and LinkedIn (week 4–5).** Template approval, opt-in capture, window handling,
Publisher. *Done when:* a template send and a free-form reply both behave correctly at the 24-hour
boundary.

**Phase 5 — Close and integrate (week 5–6).** Booking, proposal drafts, tier gates, shop
attribution, entitlement writeback, reporting. *Done when:* a download buyer completes with nobody in
the loop, and a NeVral lead arrives as a booked, briefed call that the gate would not let an agent
close.

**Phase 6 — Productization (later).** Multi-tenancy, per-client isolation and credentials, processor
agreements. Not started until phase 5 has produced results worth quoting.

---

## 12. Acceptance criteria

- [ ] No contact is reachable without a recorded, dated lawful basis
- [ ] A send to a suppressed contact fails at the database, not in a prompt
- [ ] Suppression survives re-import from a new source
- [ ] The kill switch halts all channels, and fails safe when its store is unreachable
- [ ] No agent can grant an entitlement or mark an order paid
- [ ] Pentest and compliance engagements cannot be accepted without a human authorization check
- [ ] Credential claims come only from the fixed register; the Writer refuses to generate one
- [ ] Cold outreach and transactional mail use separate domains, verified by header inspection
- [ ] WhatsApp business-initiated sends require an opt-in on record and an approved template
- [ ] No automated LinkedIn connections or DMs exist in the codebase
- [ ] Token and ad spend each stop at their ceiling
- [ ] Per-contact frequency cap holds across all three channels combined, not per channel
- [ ] Injected instructions in a fetched page or inbound reply do not alter agent tool use — tested
      deliberately with a hostile fixture
- [ ] No PHI-capable field exists in any agency table
- [ ] Every privileged action is in the tamper-evident audit log
- [ ] A DSAR erasure removes the contact everywhere except suppression

---

## 13. Open questions

1. **Counsel review of the LIA template** before any cold outreach. Same counsel engagement the
   security spec already requires for the African jurisdictions.
2. **Which entity sends.** ARGILETTE LLC's registered address appears in every email footer. Confirm
   that is the address to publish.
3. **Node CRM's actual API surface** — needs an audit against §5 before phase 1 commits to it.
4. **LinkedIn API access** — apply early; the timeline assumes drafting-only until granted.
5. **Whether the Responder discusses price at all** on the engineering tier, or always defers.
