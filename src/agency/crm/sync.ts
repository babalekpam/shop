/**
 * Synchronisation between Node CRM and the local agency store.
 *
 * The direction of each flow is a deliberate choice, not a convenience:
 *
 *   contacts        CRM  →  local     the CRM is the system of record for who exists
 *   activities      local →  CRM      the pipeline should reflect what the agency did
 *   stage changes   local →  CRM      same
 *   suppressions    CRM  →  local     one way, and only ever *adding*
 *
 * **Suppressions are import-only and additive.** There is no path that removes a local
 * suppression because the CRM no longer lists it. A bidirectional sync would mean a
 * deleted CRM row, a botched migration or a conflict resolution nobody watched could
 * quietly return someone to the pool after they objected. Spec §6.2 says suppression is
 * absolute; absolute means it does not participate in reconciliation.
 *
 * **A CRM outage never enables a send.** Sends read suppression from the local store,
 * which is always available. If this sync has not run, the local list is merely stale —
 * and stale-but-present is safe, because everything it already contains still blocks.
 */

import { randomUUID } from 'node:crypto';
import type { AgencyStore } from '../store';
import type { AuditLog } from '../audit';
import type { CrmActivity, CrmContact, CrmPort } from './port';
import { CrmError } from './errors';
import type { Contact } from '../domain/types';

export interface SyncReport {
  imported: number;
  /** Records the CRM returned that could not be imported, with why. */
  skipped: Array<{ crmId: string | null; reason: string }>;
  suppressionsImported: number;
  errors: string[];
}

export interface CrmSyncDeps {
  crm: CrmPort;
  store: AgencyStore;
  audit: AuditLog;
  /** Cap on pages, so a runaway pagination cursor cannot loop forever. */
  maxPages?: number | undefined;
}

/** Local id derived from the CRM id, so a re-import updates rather than duplicates. */
export const localIdFor = (crmId: string): string => `crm:${crmId}`;

export function toLocalContact(remote: CrmContact): Contact {
  return {
    id: localIdFor(remote.crmId),
    email: remote.email,
    phone: remote.phone,
    linkedinUrn: remote.linkedinUrn,
    organisation: remote.organisation,
    country: remote.country,
    locale: remote.locale,
    lawfulBasis: remote.lawfulBasis,
    channelConsents: remote.consents,
  };
}

export class CrmSync {
  private readonly maxPages: number;

  constructor(private readonly deps: CrmSyncDeps) {
    this.maxPages = deps.maxPages ?? 100;
  }

  /**
   * Pull suppressions first, then contacts.
   *
   * The order matters. Importing a contact who unsubscribed in the CRM yesterday, and only
   * afterwards importing that unsubscribe, leaves a window in which the contact is
   * eligible. Reversing it closes the window.
   */
  async pull(since?: string): Promise<SyncReport> {
    const report: SyncReport = { imported: 0, skipped: [], suppressionsImported: 0, errors: [] };

    try {
      const suppressions = await this.deps.crm.listSuppressions(since);
      for (const entry of suppressions) {
        // Additive only. `suppress` keeps any existing entry, so a CRM-sourced record
        // cannot overwrite the reason on an older local one.
        this.deps.store.suppress(entry.identifier, entry.reason, 'imported from node-crm');
        report.suppressionsImported++;
      }
    } catch (error) {
      // Recorded, not thrown: failing to import new suppressions is bad, but it does not
      // make the existing local list unsafe, and aborting here would also skip contacts.
      report.errors.push(`suppressions: ${(error as Error).message}`);
    }

    let cursor: string | undefined;
    for (let page = 0; page < this.maxPages; page++) {
      let batch;
      try {
        batch = await this.deps.crm.listContacts({
          ...(cursor ? { cursor } : {}),
          ...(since ? { updatedSince: since } : {}),
        });
      } catch (error) {
        report.errors.push(`contacts: ${(error as Error).message}`);
        break;
      }

      for (const remote of batch.items) {
        try {
          this.upsertLocal(remote);
          report.imported++;
        } catch (error) {
          // One malformed record must not abort a page of good ones. The commonest cause
          // is an incomplete lawful basis, which is exactly what should be refused.
          report.skipped.push({ crmId: remote.crmId, reason: (error as Error).message });
        }
      }

      if (!batch.cursor) break;
      cursor = batch.cursor;
    }

    this.deps.audit.append({
      agent: 'steward',
      actionKind: 'research.enrich',
      outcome: report.errors.length > 0 ? 'partial' : 'executed:L0',
      detail: `crm pull: ${report.imported} imported, ${report.skipped.length} skipped, ${report.suppressionsImported} suppressions`,
    });

    return report;
  }

  /**
   * Insert or refresh a contact locally.
   *
   * Delete-then-insert rather than an UPDATE, so the schema's CHECK constraints run on
   * every import. A row that was valid when first written must still be valid now; an
   * UPDATE path is how a tightened constraint quietly stops applying to existing data.
   */
  private upsertLocal(remote: CrmContact): void {
    const local = toLocalContact(remote);
    const existing = this.deps.store.getContact(local.id);
    if (existing) {
      this.deps.store.connection.prepare('DELETE FROM contacts WHERE id = ?').run(local.id);
    }
    this.deps.store.addContact(local);
  }

  /**
   * Push an activity.
   *
   * Idempotency key generated per call and sent as a header, so a retry after a timeout
   * does not produce a duplicate activity — the same discipline the storefront applies to
   * gateway webhooks.
   */
  async pushActivity(activity: Omit<CrmActivity, 'idempotencyKey'>): Promise<boolean> {
    try {
      await this.deps.crm.recordActivity({ ...activity, idempotencyKey: randomUUID() });
      return true;
    } catch (error) {
      // A failed write-back is a reporting gap, never a reason to stop working. The agency
      // knows what it did; the CRM is temporarily behind.
      this.deps.audit.append({
        agent: 'steward',
        actionKind: 'crm.move_stage',
        outcome: 'failed',
        detail: `activity push failed: ${(error as Error).message}`,
      });
      return false;
    }
  }

  async pushStage(crmContactId: string, stage: string): Promise<boolean> {
    try {
      await this.deps.crm.moveStage(crmContactId, stage);
      return true;
    } catch (error) {
      const retryable = error instanceof CrmError ? error.retryable : false;
      this.deps.audit.append({
        agent: 'analyst',
        actionKind: 'crm.move_stage',
        outcome: 'failed',
        detail: `stage push failed (${retryable ? 'retryable' : 'permanent'}): ${(error as Error).message}`,
      });
      return false;
    }
  }
}
