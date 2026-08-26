-- ARGILETTE.shop — initial schema (build spec §6).
--
-- Three things in here are load-bearing and must not be "simplified" later:
--
--   1. `webhook_events.gateway_event_id` is UNIQUE. Idempotency is enforced by the
--      database, not by application logic — an app-level "have I seen this?" check races
--      under the concurrent duplicate deliveries mobile money actually produces, and the
--      losing race grants a second subscription. (Security spec §8.)
--   2. Money is `bigint` minor units with the currency's exponent held in `currencies`.
--      No floats, anywhere. XOF has 0 decimals and KWD has 3; a hardcoded exponent
--      produces invoices wrong by 1000×.
--   3. There is no free-text column anywhere a clinical note could land. `service_bookings`
--      carries a structured JSONB intake, validated against an allowlist of keys before
--      insert. NaviMED customers are clinics — "called re: patient backlog" is an
--      entirely plausible thing for a well-meaning person to type. (Security spec §0.)

CREATE TABLE IF NOT EXISTS currencies (
  code            text PRIMARY KEY,
  exponent        smallint NOT NULL CHECK (exponent BETWEEN 0 AND 4),
  symbol          text NOT NULL,
  rounding_rule   text NOT NULL DEFAULT 'nearest',
  enabled         boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS customers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keycloak_sub       text UNIQUE NOT NULL,
  email              text NOT NULL,
  name               text,
  country            text,
  locale             text NOT NULL DEFAULT 'en',
  preferred_currency text REFERENCES currencies(code),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug    text UNIQUE NOT NULL,
  type    text NOT NULL CHECK (type IN ('service','subscription','download')),
  status  text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived'))
);

CREATE TABLE IF NOT EXISTS plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  slug        text NOT NULL,
  billing_interval text CHECK (billing_interval IN ('month','year','once')),
  features    jsonb NOT NULL DEFAULT '[]'::jsonb,
  seat_limit  integer,
  sort_order  integer NOT NULL DEFAULT 0,
  UNIQUE (product_id, slug)
);

CREATE TABLE IF NOT EXISTS prices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  currency         text NOT NULL REFERENCES currencies(code),
  amount_minor     bigint NOT NULL CHECK (amount_minor >= 0),
  source           text NOT NULL DEFAULT 'strategic' CHECK (source IN ('strategic','fx')),
  gateway_price_id text,
  fx_rate_used     numeric(18,8),
  fx_snapshot_at   timestamptz,
  active           boolean NOT NULL DEFAULT true
);
-- One active price per plan per currency. Two would make the amount charged depend on
-- row order, which is a pricing bug that only shows up in production.
CREATE UNIQUE INDEX IF NOT EXISTS prices_one_active_per_plan_currency
  ON prices (plan_id, currency) WHERE active;

CREATE TABLE IF NOT EXISTS orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      uuid NOT NULL REFERENCES customers(id),
  currency         text NOT NULL REFERENCES currencies(code),
  locale           text NOT NULL DEFAULT 'en',
  subtotal_minor   bigint NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor        bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor      bigint NOT NULL CHECK (total_minor >= 0),
  gateway          text NOT NULL CHECK (gateway IN ('paddle','cinetpay')),
  gateway_order_id text,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','paid','failed','refunded')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- A gateway's order id identifies one order. A duplicate notify must collide, not insert.
CREATE UNIQUE INDEX IF NOT EXISTS orders_gateway_order_id_unique
  ON orders (gateway, gateway_order_id) WHERE gateway_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  plan_id            uuid NOT NULL REFERENCES plans(id),
  quantity           integer NOT NULL CHECK (quantity > 0),
  unit_amount_minor  bigint NOT NULL CHECK (unit_amount_minor >= 0),
  locked_price_minor bigint NOT NULL CHECK (locked_price_minor >= 0)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id             uuid NOT NULL REFERENCES customers(id),
  plan_id                 uuid NOT NULL REFERENCES plans(id),
  gateway                 text NOT NULL CHECK (gateway IN ('paddle','cinetpay')),
  gateway_subscription_id text,
  status                  text NOT NULL
                          CHECK (status IN ('active','past_due','paused','cancelled','expired')),
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean NOT NULL DEFAULT false,
  seats                   integer NOT NULL DEFAULT 1 CHECK (seats > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_gateway_id_unique
  ON subscriptions (gateway, gateway_subscription_id) WHERE gateway_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS entitlements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           uuid NOT NULL REFERENCES customers(id),
  product_slug          text NOT NULL,
  plan_slug             text NOT NULL,
  status                text NOT NULL CHECK (status IN ('active','suspended','revoked','expired')),
  seats                 integer NOT NULL DEFAULT 1 CHECK (seats > 0),
  expires_at            timestamptz,
  source_subscription_id uuid REFERENCES subscriptions(id),
  -- Security spec §7: the reason decides whether consumers may honour a cached answer.
  -- Billing lapse fails open for 72h; a security revocation fails closed immediately.
  -- Storing the reason is what makes that distinction available to consumers at all.
  revocation_reason     text CHECK (revocation_reason IN
                          ('billing_lapse','expiry','downgrade','security','fraud','chargeback','admin_for_cause')),
  revoked_at            timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
-- One entitlement per customer per product. Two rows would make "is this customer
-- entitled?" depend on which one you read first.
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_customer_product_unique
  ON entitlements (customer_id, product_slug);

CREATE TABLE IF NOT EXISTS license_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      uuid NOT NULL REFERENCES customers(id),
  product_slug     text NOT NULL,
  -- Hash only. The plaintext key is shown exactly once, at issuance (security spec §9).
  key_hash         text NOT NULL,
  key_salt         text NOT NULL,
  -- A non-secret prefix so support can identify a key the customer reads out loud
  -- without the database ever holding anything that can be replayed.
  key_prefix       text NOT NULL,
  activation_limit integer NOT NULL DEFAULT 1 CHECK (activation_limit > 0),
  activations      integer NOT NULL DEFAULT 0 CHECK (activations >= 0),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT license_keys_activations_within_limit CHECK (activations <= activation_limit)
);
CREATE UNIQUE INDEX IF NOT EXISTS license_keys_hash_unique ON license_keys (key_hash);

CREATE TABLE IF NOT EXISTS download_grants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid NOT NULL REFERENCES customers(id),
  product_id     uuid NOT NULL REFERENCES products(id),
  download_count integer NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  max_downloads  integer NOT NULL DEFAULT 5 CHECK (max_downloads > 0),
  expires_at     timestamptz,
  CONSTRAINT download_grants_within_limit CHECK (download_count <= max_downloads)
);

CREATE TABLE IF NOT EXISTS service_bookings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id               uuid NOT NULL REFERENCES orders(id),
  sku                    text NOT NULL,
  -- Structured only. Keys are validated against an allowlist before insert
  -- (src/lib/commerce/intake.ts) so this cannot become a notes field.
  intake_payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                 text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','scheduled','delivered','cancelled')),
  promised_delivery_date date
);

CREATE TABLE IF NOT EXISTS fx_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base        text NOT NULL,
  quote       text NOT NULL,
  rate        numeric(18,8) NOT NULL CHECK (rate > 0),
  snapshot_at timestamptz NOT NULL,
  provider    text NOT NULL
);
CREATE INDEX IF NOT EXISTS fx_rates_latest ON fx_rates (base, quote, snapshot_at DESC);

-- ── The idempotency spine ──────────────────────────────────────────────────
-- Every gateway delivery is written here FIRST, inside the same transaction that applies
-- its effects. A duplicate delivery violates the unique constraint and the whole
-- transaction rolls back, so the second delivery cannot half-apply.
CREATE TABLE IF NOT EXISTS webhook_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway          text NOT NULL CHECK (gateway IN ('paddle','cinetpay')),
  gateway_event_id text NOT NULL,
  type             text NOT NULL,
  payload          jsonb NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  error            text,
  attempts         integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_gateway_event_id_unique
  ON webhook_events (gateway, gateway_event_id);
-- The dead-letter view: delivered, not processed, and it errored.
CREATE INDEX IF NOT EXISTS webhook_events_dead_letter
  ON webhook_events (gateway, received_at DESC) WHERE processed_at IS NULL AND error IS NOT NULL;
