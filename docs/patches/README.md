# Node CRM patch — apply instructions

`node-crm-suppression-gate.patch` targets **babalekpam/ARGICRM-FULL**, not this repo.
It was written against that repo's `main` and verified there: `npx tsc --noEmit` shows
no new errors, and the gate was exercised against a live PostgreSQL 16 instance
(17 assertions, all passing).

## Apply

```bash
git clone https://github.com/babalekpam/ARGICRM-FULL
cd ARGICRM-FULL
git checkout -b argilette/suppression-gate
git am < node-crm-suppression-gate.patch
npm install
npx tsc --noEmit          # 1 pre-existing error in routes/agents.ts:8, unrelated
```

## Before it runs in production

1. **Set `UNSUBSCRIBE_SECRET`** (any long random string). It falls back to `JWT_SECRET`.
   With neither set, outreach sending throws rather than emitting an opt-out link that
   would break on the next restart. That is deliberate — a dead unsubscribe link reads to
   the recipient as an ignored opt-out.
2. **`APP_URL` must be the public origin**, because unsubscribe links are built from it.
3. The migration runs itself on first send. It is `CREATE TABLE IF NOT EXISTS` plus two
   `ADD COLUMN IF NOT EXISTS`, safe to run against live data, and idempotent — verified.
4. **Seed the suppression list before the first campaign.** Anyone who has already asked
   to be removed is not in it, because until now there was nowhere to record them:
   `POST /api/email/suppressions {address, reason}`.

## What it changes

| File | Change |
|---|---|
| `server/services/suppression.ts` | New. The table, the gate, HMAC unsubscribe tokens, lawful-basis constants. |
| `server/db.ts` | New `rows()` helper — `db.execute()` returns a pg `Result`, not an array. |
| `server/routes/email-tracking.ts` | Gate before `/send`; public `GET`/`POST /track/unsubscribe/:token`; suppression-list management. |
| `server/routes/workflows.ts` | Gate on the unattended `send_email` action; an opt-out reports as `skipped`, not an error. |
| `server/services/email.ts` | `sendGenericEmail` requires `tenantId`, checks the gate, adds footer + RFC 8058 headers. |
| `server/services/email-tracking.ts` | `embedTracking` now requires an unsubscribe URL and renders the footer. |
| `server/routes/agents.ts` | Prospect import requires a lawful basis; no longer marks imports `contacted`. |

## Not included, and why

- **`contacts.opt_in` is left alone.** It defaults to `false` and nothing has ever written
  to it, so enforcing it would block every existing contact — the column holds no
  information, not a record of refusal. Deciding whether to backfill or drop it is a data
  question, not a code one. See `docs/specs/node-crm-overlap.md` §"opt_in".
- **WhatsApp and LinkedIn.** Node CRM does not send on those channels; the `channel`
  column exists so the gate extends without a migration when they arrive.
