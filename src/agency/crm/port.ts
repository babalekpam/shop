/**
 * The CRM port.
 *
 * Node CRM is the system of record (spec §5) — ARGILETTE sells it, and running the agency
 * on it is the same dogfooding argument the security spec makes for the storefront and
 * NeVral. But the agency must not become unable to protect people when the CRM is having
 * a bad day, so two rules shape this interface:
 *
 * **1. Suppression is never delegated.** It is read from the local store, always. The CRM
 * can *contribute* suppressions (someone unsubscribes through a Node CRM form), and that
 * flows one way — into the local list, never out of it. A remote lookup in the send path
 * would mean an outage decides whether we honour an objection, and the failure mode of a
 * timeout is "send anyway". Spec §6.2 says suppression is absolute; absolute cannot depend
 * on someone else's uptime.
 *
 * **2. Only enumerated fields cross this boundary.** A CRM is a place people put free
 * text, and NaviMED prospects are clinics — a note reading "called re: patient backlog"
 * is entirely plausible. `CrmContact` has no free-text field, so clinical data has nowhere
 * to land even if it exists on the other side. Security spec §0 applies here unchanged.
 */

import type { Channel, LawfulBasis } from '../domain/types';

/** A contact as it crosses the boundary. Deliberately narrow. */
export interface CrmContact {
  /** The CRM's own identifier. */
  crmId: string;
  email: string | null;
  phone: string | null;
  linkedinUrn: string | null;
  organisation: string;
  country: string;
  locale: string;
  /**
   * Required. A contact arriving from the CRM without a lawful basis is not importable —
   * the pool is not a place to put people whose basis we intend to work out later.
   */
  lawfulBasis: LawfulBasis;
  consents: Array<{ channel: Channel; optedInAt: string; provenance: string }>;
  stage: string | null;
}

/** Something the agency did, written back so the pipeline reflects reality. */
export interface CrmActivity {
  crmContactId: string;
  kind: 'outreach_sent' | 'reply_received' | 'call_booked' | 'proposal_sent' | 'purchase';
  at: string;
  channel: Channel | null;
  /**
   * Short, structured, and free of personal data. Not a transcript — the CRM is not where
   * message bodies go, and an activity note is exactly where a well-meaning integration
   * starts storing them.
   */
  summary: string;
  /** Deduplicates retries. The CRM must treat a repeat as a no-op. */
  idempotencyKey: string;
}

export interface CrmSuppression {
  identifier: string;
  reason: 'unsubscribed' | 'complaint' | 'manual';
  at: string;
}

export interface CrmHealth {
  reachable: boolean;
  /** Round-trip in ms, when reachable. */
  latencyMs: number | null;
  detail: string;
}

export interface Page<T> {
  items: T[];
  /** Opaque. Pass back to continue; absent when the listing is exhausted. */
  cursor?: string | undefined;
}

export interface ListContactsOptions {
  cursor?: string | undefined;
  limit?: number | undefined;
  /** ISO timestamp. Only contacts changed since then. */
  updatedSince?: string | undefined;
}

/**
 * What the agency needs from a CRM.
 *
 * Small on purpose. Every method here is one the agency actually calls; a port that
 * mirrors the whole of Node CRM's surface would be a port that breaks whenever Node CRM
 * grows a feature.
 */
export interface CrmPort {
  readonly name: string;
  isConfigured(): boolean;
  health(): Promise<CrmHealth>;

  listContacts(options?: ListContactsOptions): Promise<Page<CrmContact>>;
  getContact(crmId: string): Promise<CrmContact | undefined>;
  upsertContact(contact: Omit<CrmContact, 'crmId'> & { crmId?: string }): Promise<string>;

  recordActivity(activity: CrmActivity): Promise<void>;
  moveStage(crmContactId: string, stage: string): Promise<void>;

  /**
   * Suppressions raised in the CRM, for import into the local list.
   *
   * One direction only. There is deliberately no `pushSuppression` — the local list is
   * the authority, and a bidirectional sync is how a suppression gets lost in a conflict
   * resolution nobody was watching.
   */
  listSuppressions(since?: string): Promise<CrmSuppression[]>;
}
