/**
 * Node CRM client.
 *
 * An HTTP adapter for the port, driven entirely by `CrmMapping` so that the shape of the
 * real API is configuration rather than code. See mapping.ts for why.
 *
 * What this client will not do:
 *
 *  - It will not read free text. Only the enumerated fields in `CrmFieldMap` are mapped,
 *    so a `notes` column on the other side has nowhere to arrive. (Security spec §0.)
 *  - It will not retry a 4xx. A rejected payload rejected again is the same answer, more
 *    expensively, and retrying a 401 is how an integration gets its token locked.
 *  - It will not log the token, a URL containing it, or a response body.
 */

import { CrmAuthError, CrmRequestError, CrmUnavailableError } from './errors';
import {
  DEFAULT_MAPPING,
  readPath,
  writePath,
  type CrmMapping,
} from './mapping';
import type {
  CrmActivity,
  CrmContact,
  CrmHealth,
  CrmPort,
  CrmSuppression,
  ListContactsOptions,
  Page,
} from './port';
import type { Channel, LawfulBasisKind } from '../domain/types';

export interface NodeCrmConfig {
  baseUrl: string;
  token: string;
  mapping?: CrmMapping | undefined;
  /** Per-request timeout. A CRM that hangs must not hang the agency. */
  timeoutMs?: number | undefined;
  /** Retries for transient failures only. */
  maxRetries?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
  /** Injected so backoff is testable without real waiting. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;

export class NodeCrmClient implements CrmPort {
  readonly name = 'node-crm';

  private readonly mapping: CrmMapping;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly config: NodeCrmConfig) {
    this.mapping = config.mapping ?? DEFAULT_MAPPING;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.doFetch = config.fetchImpl ?? globalThis.fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  isConfigured(): boolean {
    return Boolean(this.config.baseUrl && this.config.token);
  }

  async health(): Promise<CrmHealth> {
    if (!this.isConfigured()) {
      return { reachable: false, latencyMs: null, detail: 'NODE_CRM_URL or NODE_CRM_TOKEN not set' };
    }
    const started = Date.now();
    try {
      await this.request('GET', this.mapping.endpoints.health);
      return { reachable: true, latencyMs: Date.now() - started, detail: 'ok' };
    } catch (error) {
      return { reachable: false, latencyMs: null, detail: (error as Error).message };
    }
  }

  async listContacts(options: ListContactsOptions = {}): Promise<Page<CrmContact>> {
    const params = new URLSearchParams();
    if (options.cursor) params.set('cursor', options.cursor);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.updatedSince) params.set('updated_since', options.updatedSince);

    const query = params.toString();
    const path = query
      ? `${this.mapping.endpoints.listContacts}?${query}`
      : this.mapping.endpoints.listContacts;

    const body = await this.request('GET', path);
    const rawItems = readPath(body, this.mapping.listItemsPath);
    const items = Array.isArray(rawItems) ? rawItems : [];
    const cursor = readPath(body, this.mapping.listCursorPath);

    return {
      items: items
        .map((item) => this.toContact(item))
        .filter((c): c is CrmContact => c !== null),
      cursor: typeof cursor === 'string' && cursor.length > 0 ? cursor : undefined,
    };
  }

  async getContact(crmId: string): Promise<CrmContact | undefined> {
    const path = this.mapping.endpoints.getContact.replace('{id}', encodeURIComponent(crmId));
    try {
      const body = await this.request('GET', path);
      return this.toContact(body) ?? undefined;
    } catch (error) {
      if (error instanceof CrmRequestError && error.status === 404) return undefined;
      throw error;
    }
  }

  async upsertContact(contact: Omit<CrmContact, 'crmId'> & { crmId?: string }): Promise<string> {
    const payload = this.fromContact(contact);
    if (contact.crmId) {
      const path = this.mapping.endpoints.updateContact.replace(
        '{id}',
        encodeURIComponent(contact.crmId),
      );
      await this.request('PATCH', path, payload);
      return contact.crmId;
    }
    const body = await this.request('POST', this.mapping.endpoints.createContact, payload);
    const id = readPath(body, this.mapping.fields.crmId);
    if (typeof id !== 'string' && typeof id !== 'number') {
      throw new CrmRequestError('CRM did not return an id for the created contact', 500);
    }
    return String(id);
  }

  async recordActivity(activity: CrmActivity): Promise<void> {
    await this.request('POST', this.mapping.endpoints.recordActivity, {
      contact_id: activity.crmContactId,
      kind: activity.kind,
      at: activity.at,
      channel: activity.channel,
      summary: activity.summary,
      // Sent as a header too; included here for CRMs that read it from the body.
      idempotency_key: activity.idempotencyKey,
    }, activity.idempotencyKey);
  }

  async moveStage(crmContactId: string, stage: string): Promise<void> {
    const path = this.mapping.endpoints.moveStage.replace(
      '{id}',
      encodeURIComponent(crmContactId),
    );
    await this.request('POST', path, { stage });
  }

  async listSuppressions(since?: string): Promise<CrmSuppression[]> {
    const path = since
      ? `${this.mapping.endpoints.listSuppressions}?since=${encodeURIComponent(since)}`
      : this.mapping.endpoints.listSuppressions;
    const body = await this.request('GET', path);
    const raw = readPath(body, this.mapping.listItemsPath);
    const items = Array.isArray(raw) ? raw : [];

    return items
      .map((item): CrmSuppression | null => {
        const record = item as Record<string, unknown>;
        const identifier = record.identifier ?? record.email ?? record.phone;
        if (typeof identifier !== 'string') return null;
        const reason = String(record.reason ?? 'manual');
        return {
          identifier,
          reason:
            reason === 'unsubscribed' || reason === 'complaint' ? reason : 'manual',
          at: typeof record.at === 'string' ? record.at : new Date().toISOString(),
        };
      })
      .filter((s): s is CrmSuppression => s !== null);
  }

  // ---- Mapping -------------------------------------------------------------

  /**
   * Map a CRM record into our narrow shape.
   *
   * Returns null rather than throwing when the record has no usable lawful basis. A
   * contact whose basis we cannot establish is not importable, and one bad row should not
   * abort a page of good ones — the sync reports the count it skipped.
   */
  private toContact(raw: unknown): CrmContact | null {
    if (raw === null || typeof raw !== 'object') return null;
    const f = this.mapping.fields;

    const str = (path: string): string | null => {
      const value = readPath(raw, path);
      return typeof value === 'string' && value.length > 0 ? value : null;
    };

    const crmId = str(f.crmId);
    const organisation = str(f.organisation);
    const basisKind = str(f.basisKind);
    const basisAt = str(f.basisEstablishedAt);
    const basisSource = str(f.basisProvenance);

    if (!crmId || !organisation || !basisKind || !basisAt || !basisSource) return null;
    if (basisKind !== 'consent' && basisKind !== 'contract' && basisKind !== 'legitimate_interest') {
      return null;
    }

    const assessmentRef = str(f.basisAssessmentRef);
    const consentWording = str(f.basisConsentWording);

    // The same completeness rule the local CHECK constraints enforce. Applied here too so
    // an incomplete basis is rejected at the boundary rather than at the database, where
    // the error is less legible.
    if (basisKind === 'legitimate_interest' && !assessmentRef) return null;
    if (basisKind === 'consent' && !consentWording) return null;

    const consentsRaw = readPath(raw, 'consents');
    const consents = Array.isArray(consentsRaw)
      ? consentsRaw
          .map((c) => c as Record<string, unknown>)
          .filter((c) => typeof c.channel === 'string')
          .map((c) => ({
            channel: String(c.channel) as Channel,
            optedInAt: typeof c.opted_in_at === 'string' ? c.opted_in_at : basisAt,
            provenance: typeof c.provenance === 'string' ? c.provenance : basisSource,
          }))
      : [];

    return {
      crmId,
      email: str(f.email),
      phone: str(f.phone),
      linkedinUrn: str(f.linkedinUrn),
      organisation,
      country: str(f.country) ?? 'XX',
      locale: str(f.locale) ?? 'en',
      lawfulBasis: {
        kind: basisKind as LawfulBasisKind,
        establishedAt: basisAt,
        provenance: basisSource,
        assessmentRef: assessmentRef ?? undefined,
        consentWording: consentWording ?? undefined,
      },
      consents,
      stage: str(f.stage),
    };
  }

  private fromContact(contact: Omit<CrmContact, 'crmId'> & { crmId?: string }): Record<string, unknown> {
    const f = this.mapping.fields;
    const payload: Record<string, unknown> = {};
    writePath(payload, f.email, contact.email);
    writePath(payload, f.phone, contact.phone);
    writePath(payload, f.linkedinUrn, contact.linkedinUrn);
    writePath(payload, f.organisation, contact.organisation);
    writePath(payload, f.country, contact.country);
    writePath(payload, f.locale, contact.locale);
    writePath(payload, f.basisKind, contact.lawfulBasis.kind);
    writePath(payload, f.basisEstablishedAt, contact.lawfulBasis.establishedAt);
    writePath(payload, f.basisProvenance, contact.lawfulBasis.provenance);
    if (contact.lawfulBasis.assessmentRef) {
      writePath(payload, f.basisAssessmentRef, contact.lawfulBasis.assessmentRef);
    }
    if (contact.lawfulBasis.consentWording) {
      writePath(payload, f.basisConsentWording, contact.lawfulBasis.consentWording);
    }
    if (contact.stage) writePath(payload, f.stage, contact.stage);
    return payload;
  }

  // ---- Transport -----------------------------------------------------------

  private async request(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<unknown> {
    let lastError: Error = new CrmUnavailableError('no attempt made');

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff. Bounded, because an agency that spends four minutes
        // retrying a dead CRM is an agency that has stopped working.
        await this.sleep(Math.min(2 ** attempt * 250, 4_000));
      }

      try {
        return await this.attempt(method, path, body, idempotencyKey);
      } catch (error) {
        lastError = error as Error;
        const retryable =
          error instanceof CrmUnavailableError ||
          (error instanceof CrmRequestError && (error.status ?? 0) >= 500);
        if (!retryable) throw error;
      }
    }
    throw lastError;
  }

  private async attempt(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      // Bearer, never a query parameter — a token in a URL ends up in access logs.
      authorization: `Bearer ${this.config.token}`,
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

    let response: Response;
    try {
      const init: RequestInit = { method, headers, signal: controller.signal };
      // Assigned conditionally rather than set to undefined: under
      // exactOptionalPropertyTypes an explicit undefined is not the same as absent.
      if (body !== undefined) init.body = JSON.stringify(body);
      response = await this.doFetch(new URL(path, this.config.baseUrl).toString(), init);
    } catch (error) {
      // Message only — never the URL, which could carry identifiers.
      throw new CrmUnavailableError(`node-crm unreachable: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw new CrmAuthError('node-crm rejected the token', response.status);
    }
    if (!response.ok) {
      // Status only. A body can echo the payload, which can carry personal data.
      throw new CrmRequestError(`node-crm returned ${response.status}`, response.status);
    }
    if (response.status === 204) return null;

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new CrmRequestError('node-crm returned a non-JSON body', response.status);
    }
  }
}

/** Build a client from the environment. Returns undefined when unconfigured. */
export function nodeCrmFromEnv(mapping?: CrmMapping): NodeCrmClient | undefined {
  const baseUrl = process.env.NODE_CRM_URL;
  const token = process.env.NODE_CRM_TOKEN;
  if (!baseUrl || !token) return undefined;
  return new NodeCrmClient({ baseUrl, token, mapping });
}
