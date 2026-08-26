/**
 * The agency store.
 *
 * Backed by `node:sqlite`, which ships with Node and needs no native build step. The
 * Postgres deployment mirrors this schema; the point of running the real thing here is
 * that the constraints in `schema.sql` are exercised by the test suite rather than
 * asserted in prose.
 *
 * The store deliberately exposes no `updateSuppression` or `deleteSuppression`. Removing
 * someone from the suppression list is a human act performed against the database, not an
 * API an agent can reach.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suppressionKey } from '../domain/normalise';
import type {
  Channel,
  Contact,
  SuppressionEntry,
  SuppressionReason,
} from '../domain/types';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface TouchRecord {
  contactId: string;
  channel: Channel;
  actionKind: string;
  sentAt: string;
}

export class AgencyStore {
  private readonly db: DatabaseSync;

  constructor(location = ':memory:') {
    this.db = new DatabaseSync(location);
    // Foreign keys are OFF by default in SQLite, which would silently defeat the
    // ON DELETE CASCADE on consents and touches.
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(readFileSync(join(HERE, 'schema.sql'), 'utf8'));
  }

  close(): void {
    this.db.close();
  }

  // ---- Contacts ------------------------------------------------------------

  /**
   * Insert a contact.
   *
   * Throws if the lawful basis is incomplete — the CHECK constraints in the schema reject
   * a legitimate-interest basis with no assessment reference, and consent with no recorded
   * wording. That failure is the point: it happens at write time rather than at send time,
   * when a person is already on the receiving end.
   */
  addContact(contact: Contact): void {
    const insert = this.db.prepare(`
      INSERT INTO contacts (id, email, phone, linkedin_urn, organisation, country, locale,
                            basis_kind, basis_at, basis_source, basis_ref, basis_wording, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      contact.id,
      contact.email ? suppressionKey(contact.email) : null,
      contact.phone ? suppressionKey(contact.phone) : null,
      contact.linkedinUrn,
      contact.organisation,
      contact.country,
      contact.locale,
      contact.lawfulBasis.kind,
      contact.lawfulBasis.establishedAt,
      contact.lawfulBasis.provenance,
      contact.lawfulBasis.assessmentRef ?? null,
      contact.lawfulBasis.consentWording ?? null,
      new Date().toISOString(),
    );

    const consent = this.db.prepare(`
      INSERT INTO channel_consents (contact_id, channel, opted_in_at, provenance)
      VALUES (?, ?, ?, ?)
    `);
    for (const c of contact.channelConsents) {
      consent.run(contact.id, c.channel, c.optedInAt, c.provenance);
    }
  }

  getContact(id: string): Contact | undefined {
    const row = this.db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as
      | Record<string, string | null>
      | undefined;
    if (!row) return undefined;

    const consents = this.db
      .prepare('SELECT channel, opted_in_at, provenance FROM channel_consents WHERE contact_id = ?')
      .all(id) as Array<Record<string, string>>;

    return {
      id: String(row.id),
      email: row.email ?? null,
      phone: row.phone ?? null,
      linkedinUrn: row.linkedin_urn ?? null,
      organisation: String(row.organisation),
      country: String(row.country),
      locale: String(row.locale),
      lawfulBasis: {
        kind: String(row.basis_kind) as Contact['lawfulBasis']['kind'],
        establishedAt: String(row.basis_at),
        provenance: String(row.basis_source),
        assessmentRef: row.basis_ref ?? undefined,
        consentWording: row.basis_wording ?? undefined,
      },
      channelConsents: consents.map((c) => ({
        channel: c.channel as Channel,
        optedInAt: String(c.opted_in_at),
        provenance: String(c.provenance),
      })),
    };
  }

  // ---- Suppression ---------------------------------------------------------

  /**
   * Suppress an identifier. Idempotent: re-suppressing keeps the *original* entry.
   *
   * That ordering matters. If a later import overwrote the reason and date, an
   * unsubscribe from two years ago would look like a fresh manual entry, and the audit
   * trail for why someone is suppressed would be destroyed by the very re-import the
   * list is meant to survive.
   */
  suppress(identifier: string, reason: SuppressionReason, note: string | null = null): void {
    this.db
      .prepare(
        `INSERT INTO suppressions (identifier, reason, suppressed_at, note)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(identifier) DO NOTHING`,
      )
      .run(suppressionKey(identifier), reason, new Date().toISOString(), note);
  }

  isSuppressed(identifier: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS hit FROM suppressions WHERE identifier = ?')
      .get(suppressionKey(identifier));
    return row !== undefined;
  }

  getSuppression(identifier: string): SuppressionEntry | undefined {
    const row = this.db
      .prepare('SELECT * FROM suppressions WHERE identifier = ?')
      .get(suppressionKey(identifier)) as Record<string, string | null> | undefined;
    if (!row) return undefined;
    return {
      identifier: String(row.identifier),
      reason: String(row.reason) as SuppressionReason,
      suppressedAt: String(row.suppressed_at),
      note: row.note ?? null,
    };
  }

  /** Every identifier we hold for a contact, for a suppression check before any send. */
  identifiersFor(contact: Contact): string[] {
    return [contact.email, contact.phone].filter((v): v is string => typeof v === 'string');
  }

  // ---- Touches -------------------------------------------------------------

  recordTouch(touch: TouchRecord): void {
    this.db
      .prepare(
        'INSERT INTO touches (id, contact_id, channel, action_kind, sent_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(crypto.randomUUID(), touch.contactId, touch.channel, touch.actionKind, touch.sentAt);
  }

  /**
   * Touches in a trailing window, **across all channels**.
   *
   * Counting per channel is the common mistake: it lets a contact receive an email, a
   * WhatsApp message and a LinkedIn touch in the same afternoon while every individual
   * cap reports healthy.
   */
  touchesSince(contactId: string, sinceIso: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM touches WHERE contact_id = ? AND sent_at >= ?')
      .get(contactId, sinceIso) as { n: number };
    return Number(row.n);
  }

  // ---- Erasure -------------------------------------------------------------

  /**
   * DSAR erasure.
   *
   * Removes the contact everywhere **except** suppression, which retains the minimum
   * needed to keep honouring the objection. Deleting someone entirely is how you end up
   * mailing them again next quarter from a fresh list — the erasure would have destroyed
   * the only record that they refused. (Spec §6.4.)
   */
  erase(contactId: string): void {
    const contact = this.getContact(contactId);
    if (!contact) return;
    for (const identifier of this.identifiersFor(contact)) {
      this.suppress(identifier, 'dsar_erasure', 'erased on request');
    }
    this.db.prepare('DELETE FROM contacts WHERE id = ?').run(contactId);
  }

  /** Escape hatch for the audit log and ledger, which own their own SQL. */
  get connection(): DatabaseSync {
    return this.db;
  }
}
