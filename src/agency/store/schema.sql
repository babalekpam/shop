-- ARGILETTE Agency — storage schema.
--
-- Written for SQLite (node:sqlite) so the constraints below are genuinely exercised in
-- tests. The Postgres deployment mirrors it exactly; see store/drizzle-schema.ts.
--
-- The design rule that matters: **suppression is a constraint, not a query.** An agent
-- that is merely instructed not to contact a suppressed address will eventually contact
-- one. A UNIQUE index and a foreign key cannot be talked round.

CREATE TABLE IF NOT EXISTS contacts (
  id             TEXT PRIMARY KEY,
  -- Nullable because we may hold only a phone, or only a LinkedIn URN.
  email          TEXT,
  phone          TEXT,
  linkedin_urn   TEXT,
  organisation   TEXT NOT NULL,
  country        TEXT NOT NULL,
  locale         TEXT NOT NULL,
  -- Lawful basis is NOT NULL by design: a contact cannot enter the pool without one.
  basis_kind     TEXT NOT NULL CHECK (basis_kind IN ('consent','contract','legitimate_interest')),
  basis_at       TEXT NOT NULL,
  basis_source   TEXT NOT NULL,
  -- Required when basis_kind = 'legitimate_interest'. Enforced below.
  basis_ref      TEXT,
  basis_wording  TEXT,
  created_at     TEXT NOT NULL,

  -- A legitimate-interest basis without a written assessment is not a basis.
  CHECK (basis_kind <> 'legitimate_interest' OR basis_ref IS NOT NULL),
  -- Consent without the wording shown is unprovable.
  CHECK (basis_kind <> 'consent' OR basis_wording IS NOT NULL)
);

-- There is deliberately no free-text column on contacts. See domain/types.ts.

CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_idx ON contacts(email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS channel_consents (
  contact_id   TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('email','whatsapp','linkedin')),
  opted_in_at  TEXT NOT NULL,
  provenance   TEXT NOT NULL,
  PRIMARY KEY (contact_id, channel)
);

-- The suppression list. One row per identifier, forever.
--
-- The UNIQUE primary key is what makes re-import safe: a contact who opted out and then
-- reappears in a freshly bought list collides here rather than quietly re-entering the
-- pool. Spec §6.2.
CREATE TABLE IF NOT EXISTS suppressions (
  identifier     TEXT PRIMARY KEY,
  reason         TEXT NOT NULL CHECK (reason IN ('unsubscribed','complaint','hard_bounce','dsar_erasure','manual')),
  suppressed_at  TEXT NOT NULL,
  note           TEXT
);

-- Every outbound touch, for the cross-channel frequency cap.
--
-- The cap counts across channels combined, not per channel: three messages in a week is
-- three messages whether or not they arrived by three different routes.
CREATE TABLE IF NOT EXISTS touches (
  id           TEXT PRIMARY KEY,
  contact_id   TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,
  action_kind  TEXT NOT NULL,
  sent_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS touches_contact_idx ON touches(contact_id, sent_at);

-- Append-only, tamper-evident. Merkle-chained per security spec §10.
--
-- No UPDATE or DELETE path exists in the application. In Postgres the application role is
-- additionally denied both.
CREATE TABLE IF NOT EXISTS audit_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  agent       TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  detail      TEXT NOT NULL,
  prev_hash   TEXT NOT NULL,
  hash        TEXT NOT NULL UNIQUE
);

-- Spend and token consumption, metered against ceilings.
CREATE TABLE IF NOT EXISTS ledger (
  id         TEXT PRIMARY KEY,
  period     TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('tokens','ad_spend_minor')),
  amount     INTEGER NOT NULL,
  at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ledger_period_idx ON ledger(period, kind);
