/**
 * Drizzle schema — the typed mirror of `migrations/0001_init.sql`.
 *
 * The SQL file is the source of truth, not this file. Constraints that protect money or
 * access (the unique index on `gateway_event_id`, the CHECK on entitlement status, the
 * activation ceiling on licence keys) live in the migration because the database enforces
 * them against every writer, including a psql session at 2am. Drizzle types only bind the
 * application.
 */
import {
  pgTable, uuid, text, integer, smallint, bigint, boolean, jsonb, timestamp, date, numeric,
} from 'drizzle-orm/pg-core';

export const currencies = pgTable('currencies', {
  code: text('code').primaryKey(),
  exponent: smallint('exponent').notNull(),
  symbol: text('symbol').notNull(),
  roundingRule: text('rounding_rule').notNull().default('nearest'),
  enabled: boolean('enabled').notNull().default(true),
});

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  keycloakSub: text('keycloak_sub').notNull().unique(),
  email: text('email').notNull(),
  name: text('name'),
  country: text('country'),
  locale: text('locale').notNull().default('en'),
  preferredCurrency: text('preferred_currency'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  type: text('type').$type<'service' | 'subscription' | 'download'>().notNull(),
  status: text('status').$type<'draft' | 'active' | 'archived'>().notNull().default('draft'),
});

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull(),
  slug: text('slug').notNull(),
  billingInterval: text('billing_interval').$type<'month' | 'year' | 'once'>(),
  features: jsonb('features').$type<string[]>().notNull().default([]),
  seatLimit: integer('seat_limit'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const prices = pgTable('prices', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull(),
  currency: text('currency').notNull(),
  // bigint mode 'number' is safe here: the largest representable amount is 2^53-1 minor
  // units, which in the highest-exponent currency we support (KWD, 3 decimals) is still
  // over 9 trillion dinar. A cart cannot reach it.
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  source: text('source').$type<'strategic' | 'fx'>().notNull().default('strategic'),
  gatewayPriceId: text('gateway_price_id'),
  fxRateUsed: numeric('fx_rate_used'),
  fxSnapshotAt: timestamp('fx_snapshot_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
});

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull(),
  currency: text('currency').notNull(),
  locale: text('locale').notNull().default('en'),
  subtotalMinor: bigint('subtotal_minor', { mode: 'number' }).notNull(),
  taxMinor: bigint('tax_minor', { mode: 'number' }).notNull().default(0),
  totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
  gateway: text('gateway').$type<'paddle' | 'cinetpay'>().notNull(),
  gatewayOrderId: text('gateway_order_id'),
  status: text('status').$type<'pending' | 'paid' | 'failed' | 'refunded'>().notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull(),
  planId: uuid('plan_id').notNull(),
  quantity: integer('quantity').notNull(),
  unitAmountMinor: bigint('unit_amount_minor', { mode: 'number' }).notNull(),
  lockedPriceMinor: bigint('locked_price_minor', { mode: 'number' }).notNull(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull(),
  planId: uuid('plan_id').notNull(),
  gateway: text('gateway').$type<'paddle' | 'cinetpay'>().notNull(),
  gatewaySubscriptionId: text('gateway_subscription_id'),
  status: text('status')
    .$type<'active' | 'past_due' | 'paused' | 'cancelled' | 'expired'>().notNull(),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  seats: integer('seats').notNull().default(1),
});

/** The reason an entitlement stopped being active. Decides caching behaviour downstream. */
export type RevocationReason =
  | 'billing_lapse' | 'expiry' | 'downgrade'
  | 'security' | 'fraud' | 'chargeback' | 'admin_for_cause';

export const entitlements = pgTable('entitlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull(),
  productSlug: text('product_slug').notNull(),
  planSlug: text('plan_slug').notNull(),
  status: text('status').$type<'active' | 'suspended' | 'revoked' | 'expired'>().notNull(),
  seats: integer('seats').notNull().default(1),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  sourceSubscriptionId: uuid('source_subscription_id'),
  revocationReason: text('revocation_reason').$type<RevocationReason>(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const licenseKeys = pgTable('license_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull(),
  productSlug: text('product_slug').notNull(),
  keyHash: text('key_hash').notNull(),
  keySalt: text('key_salt').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  activationLimit: integer('activation_limit').notNull().default(1),
  activations: integer('activations').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const downloadGrants = pgTable('download_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull(),
  productId: uuid('product_id').notNull(),
  downloadCount: integer('download_count').notNull().default(0),
  maxDownloads: integer('max_downloads').notNull().default(5),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});

export const serviceBookings = pgTable('service_bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull(),
  sku: text('sku').notNull(),
  intakePayload: jsonb('intake_payload').notNull().default({}),
  status: text('status')
    .$type<'pending' | 'scheduled' | 'delivered' | 'cancelled'>().notNull().default('pending'),
  promisedDeliveryDate: date('promised_delivery_date'),
});

export const fxRates = pgTable('fx_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  base: text('base').notNull(),
  quote: text('quote').notNull(),
  rate: numeric('rate').notNull(),
  snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull(),
  provider: text('provider').notNull(),
});

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  gateway: text('gateway').$type<'paddle' | 'cinetpay'>().notNull(),
  gatewayEventId: text('gateway_event_id').notNull(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
});
