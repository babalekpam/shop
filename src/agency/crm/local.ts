/**
 * The local CRM.
 *
 * Implements the same port against the agency's own store, so the system runs with no
 * Node CRM at all — during development, in tests, and on day one before the integration
 * is wired. Swapping between them is a constructor argument.
 *
 * Its existence is also the argument that the port is honest: an interface with one
 * implementation tends to leak that implementation's assumptions.
 */

import type { AgencyStore } from '../store';
import type {
  CrmActivity,
  CrmContact,
  CrmHealth,
  CrmPort,
  CrmSuppression,
  ListContactsOptions,
  Page,
} from './port';

export class LocalCrm implements CrmPort {
  readonly name = 'local';

  constructor(private readonly store: AgencyStore) {}

  isConfigured(): boolean {
    return true;
  }

  async health(): Promise<CrmHealth> {
    return { reachable: true, latencyMs: 0, detail: 'local store' };
  }

  async listContacts(_options?: ListContactsOptions): Promise<Page<CrmContact>> {
    const rows = this.store.connection.prepare('SELECT id FROM contacts').all() as Array<{
      id: string;
    }>;
    const items = rows
      .map((r) => this.store.getContact(String(r.id)))
      .filter((c): c is NonNullable<typeof c> => c !== undefined)
      .map((c) => ({
        crmId: c.id,
        email: c.email,
        phone: c.phone,
        linkedinUrn: c.linkedinUrn,
        organisation: c.organisation,
        country: c.country,
        locale: c.locale,
        lawfulBasis: c.lawfulBasis,
        consents: c.channelConsents,
        stage: null,
      }));
    return { items };
  }

  async getContact(crmId: string): Promise<CrmContact | undefined> {
    const page = await this.listContacts();
    return page.items.find((c) => c.crmId === crmId);
  }

  async upsertContact(contact: Omit<CrmContact, 'crmId'> & { crmId?: string }): Promise<string> {
    const id = contact.crmId ?? crypto.randomUUID();
    this.store.addContact({
      id,
      email: contact.email,
      phone: contact.phone,
      linkedinUrn: contact.linkedinUrn,
      organisation: contact.organisation,
      country: contact.country,
      locale: contact.locale,
      lawfulBasis: contact.lawfulBasis,
      channelConsents: contact.consents,
    });
    return id;
  }

  /** No-ops: the local store already records touches and the audit log records the rest. */
  async recordActivity(_activity: CrmActivity): Promise<void> {}
  async moveStage(_crmContactId: string, _stage: string): Promise<void> {}

  /** The local list is the authority; there is nothing upstream to import from. */
  async listSuppressions(_since?: string): Promise<CrmSuppression[]> {
    return [];
  }
}
