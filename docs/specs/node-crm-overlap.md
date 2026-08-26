# Node CRM overlap — what to keep, what to delete, what to fix

Audit of `babalekpam/ARGICRM-FULL` (`argilette-crm` v2.0.0) against `src/agency/`, done to
resolve one decision: **Node CRM leads, this repo fills gaps.** Nothing here is built yet.
This is the map that says which of my ~2,900 lines survive.

Read at commit: the `main` of ARGICRM-FULL as of 2026-08-26.

---

## 1. Does Node CRM send? Yes — two paths, and they behave differently

This was the question that decides everything else, because two send paths with two
suppression lists is precisely how someone who opted out gets contacted anyway.

| Path | Where | Who triggers it | Gated by |
|---|---|---|---|
| Tracked outreach email | `server/routes/email-tracking.ts:126` → `sendWithTenantSmtp` | An authenticated user, one recipient per call | Auth + tenant SMTP configured. Nothing else. |
| Workflow action `send_email` / `compose_email` | `server/routes/workflows.ts:149` → `sendGenericEmail` | **The workflow engine, unattended** | Nothing. |

The second one is the live risk. `execution_mode` defaults to `"auto"`
(`server/routes/workflows.ts:465`), workflows fire on record events via
`executeAction`, and a scheduled evaluator additionally fires `deal_inactive`,
`invoice_overdue` and `lead_score_updated` triggers on a timer. So a rule saved once can
email a contact months later with no human present at the moment of sending.

**Node CRM's AI agents cannot send.** `executeTool` (`server/services/agents.ts:918`)
exposes reads, `create_task`, `create_activity`, `score_lead`, `search_prospects` and
`generate_email` — and `generate_email` returns copy, it does not transmit. Likewise
`runAutonomousLeadGen` (`server/services/leadgen.ts:674`) discovers, enriches, verifies and
scores; it never sends. That is a genuinely sound boundary and it is worth naming as a
design decision rather than an accident, because the L0/L1/L2 model below has to preserve it.

## 2. There is no suppression list. At all.

- `suppression` appears in **zero** files.
- `unsubscribe` appears in **one**: `server/services/agents.ts:214`, inside an AI system
  prompt listing benchmark metrics. It is prose, not a mechanism.
- `embedTracking` (`server/services/email-tracking.ts:13`) injects an open pixel and
  rewrites every link through a click redirect. It adds **no opt-out link**, and the send
  sets **no `List-Unsubscribe` header**.
- `contacts.optIn` exists (`shared/schema.ts:80`, defaults `false`). **Nothing reads it.**
  Its only other occurrence in the codebase is a column name inside a metadata array at
  `server/platform/registry.ts:27`. Neither send path consults it.

The `optIn` column is worse than its absence would be. It is surfaced to users as a field,
so ticking it looks like it means something, and it means nothing.

`prospects` (`shared/schema-extended.ts:235`) carries no consent field of any kind, and
`dataSource` defaults to `"enriched"` — i.e. the default provenance is scraped.

Meanwhile every open is logged with IP and user-agent (`email_events`, plus
`email_sends.first_opener_ip`). Tracking a person that precisely while offering them no way
to stop is the combination that draws regulator attention, not either half alone.

## 3. Untrusted web text reaches a model prompt unmarked

`server/services/leadgen.ts:278` interpolates DuckDuckGo result titles and snippets
straight into a prompt, and the model's reply is `JSON.parse`d and inserted into
`prospects`. The snippet is written by whoever controls the indexed page.

Impact is bounded — the worst case is a poisoned prospect row, not an autonomous send,
because agents cannot send. But it is the exact shape `src/agency/content/untrusted.ts`
exists to mark, and the bound depends on the agent/send separation holding forever.

## 4. Free-text fields are PHI-capable

`contacts.notes`, `contacts.bio` and `leads.notes` are unconstrained `text`. Node CRM is a
general CRM so that is reasonable for it. It stops being reasonable the moment the Togo
private-health prospecting list is imported, because a rep summarising a clinic call into
`notes` is one keystroke from patient data — and house rule #1 has no exceptions.
This is a boundary that has to be enforced on the way in, not by asking people nicely.

---

## 5. The merge

### Delete from `src/agency/` — Node CRM does it, and does it better

| Mine | Superseded by |
|---|---|
| `agents/team.ts`, `agents/dispatcher.ts` | `AGENT_DEFINITIONS` + `runAgent` + agent memory (`server/services/agents.ts`) |
| `crm/local.ts`, `store/index.ts`, most of `store/schema.sql` | Postgres `contacts` / `leads` / `prospects` / `deals` |
| `channels/transport.ts` (the transport itself) | `email.ts` + `email-tracking.ts` |
| `domain/types.ts` prospect + lead shapes | Node CRM's schema, via the mapping layer |

### Keep — Node CRM has no equivalent

| Mine | Why it survives |
|---|---|
| `compliance/gate.ts` | The only suppression check that exists anywhere. |
| `compliance/killswitch.ts` | There is no stop button today. |
| `audit/index.ts` | `activities` is a log; it is not tamper-evident. |
| `content/untrusted.ts` | §3. |
| `content/credentials.ts` | No credential boundary exists. |
| `content/phi.ts` | §4, and house rule #1. |
| `domain/autonomy.ts` | Node CRM's autonomy control is one boolean per workflow. L0/L1/L2 is per action kind, and taint dominates. |
| `import/prospects.ts` — the `assessmentRef` guard | Node CRM's `/lead-gen/:resultId/import` records no lawful basis. |
| `crm/port.ts`, `node-crm.ts`, `mapping.ts`, `sync.ts` | Retarget to the real API shape found here. |
| `budget/index.ts` | `ai-credits.ts` meters model spend only — not ad spend, not per-channel volume. |

### Fix in Node CRM itself — this cannot be done from this repo

The gate only works if it sits in front of **both** send paths. Adding it to one leaves the
other open, which is the two-lists failure in a different costume.

1. A `suppressions` table keyed on `(tenant_id, channel, address)` as **primary key**, so a
   double insert is a no-op rather than a duplicate row.
2. A single `assertSendable()` called by `email-tracking.ts:/send` **and** by
   `executeAction`'s `send_email` branch, before either transmits.
3. `List-Unsubscribe` + `List-Unsubscribe-Post` headers and a one-click opt-out link
   injected inside `embedTracking`, so no send path can omit it by construction.
4. Either read `contacts.optIn` in `assertSendable()` or drop the column. A consent field
   nothing enforces is a liability with a checkbox.
5. Reject the import of any record into `prospects` without a recorded lawful basis.

Item 3 is the cheapest and highest-value: putting it inside `embedTracking` rather than at
the call sites means a future third send path inherits it for free.
