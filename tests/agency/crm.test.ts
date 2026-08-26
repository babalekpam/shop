import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgencyStore } from '../../src/agency/store';
import { AuditLog } from '../../src/agency/audit';
import { NodeCrmClient } from '../../src/agency/crm/node-crm';
import { LocalCrm } from '../../src/agency/crm/local';
import { CrmSync, localIdFor } from '../../src/agency/crm/sync';
import { CrmAuthError, CrmRequestError, CrmUnavailableError } from '../../src/agency/crm/errors';
import { DEFAULT_MAPPING, mappingFromJson, readPath, writePath } from '../../src/agency/crm/mapping';

/** A fetch double that replays queued responses and records what was asked of it. */
function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift() ?? { status: 500 };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const validRecord = {
  id: 'crm-1',
  email: 'ops@clinique.tg',
  phone: null,
  linkedin_urn: null,
  organisation: 'Clinique Lomé',
  country: 'TG',
  locale: 'fr',
  stage: 'qualified',
  lawful_basis: {
    kind: 'legitimate_interest',
    established_at: '2026-08-01',
    provenance: 'business directory',
    assessment_ref: 'LIA-2026-01',
  },
};

let store: AgencyStore;
beforeEach(() => {
  store = new AgencyStore();
});
afterEach(() => store.close());

describe('mapping', () => {
  it('reads and writes dotted paths', () => {
    expect(readPath({ a: { b: 'c' } }, 'a.b')).toBe('c');
    expect(readPath({ a: {} }, 'a.b.c')).toBeUndefined();
    const target = {};
    writePath(target, 'x.y.z', 1);
    expect(target).toEqual({ x: { y: { z: 1 } } });
  });

  it('merges an override over the defaults without losing the rest', () => {
    // The point of the mapping layer: adapting to Node CRM's real shape is config.
    const mapping = mappingFromJson(JSON.stringify({ fields: { organisation: 'company_name' } }));
    expect(mapping.fields.organisation).toBe('company_name');
    expect(mapping.fields.email).toBe(DEFAULT_MAPPING.fields.email);
    expect(mapping.endpoints.listContacts).toBe(DEFAULT_MAPPING.endpoints.listContacts);
  });

  it('honours a remapped field end to end', async () => {
    const { impl } = fakeFetch([
      { status: 200, body: { data: [{ ...validRecord, organisation: undefined, company_name: 'Renamed Ltd' }] } },
    ]);
    const client = new NodeCrmClient({
      baseUrl: 'https://crm.test',
      token: 't',
      fetchImpl: impl,
      mapping: mappingFromJson(JSON.stringify({ fields: { organisation: 'company_name' } })),
    });
    const page = await client.listContacts();
    expect(page.items[0]?.organisation).toBe('Renamed Ltd');
  });
});

describe('NodeCrmClient', () => {
  it('sends the token as a bearer header, never in the URL', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const client = new NodeCrmClient({ baseUrl: 'https://crm.test', token: 'secret-token', fetchImpl: impl });
    await client.health();

    expect(calls[0]?.url).not.toContain('secret-token');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer secret-token');
  });

  it('never leaks the response body into an error message', async () => {
    // A body can echo the payload, which can carry personal data.
    const { impl } = fakeFetch([{ status: 422, body: { email: 'ada@private.test' } }]);
    const client = new NodeCrmClient({ baseUrl: 'https://crm.test', token: 't', fetchImpl: impl, maxRetries: 0 });
    await expect(client.listContacts()).rejects.toThrow(/returned 422/);
    await expect(client.listContacts()).rejects.not.toThrow(/ada@private.test/);
  });

  it('retries a 5xx and succeeds', async () => {
    const { impl, calls } = fakeFetch([
      { status: 503 },
      { status: 200, body: { data: [validRecord] } },
    ]);
    const client = new NodeCrmClient({
      baseUrl: 'https://crm.test', token: 't', fetchImpl: impl, sleep: async () => {},
    });
    const page = await client.listContacts();
    expect(calls).toHaveLength(2);
    expect(page.items).toHaveLength(1);
  });

  it('does not retry a 401 — retrying is how a token gets locked out', async () => {
    const { impl, calls } = fakeFetch([{ status: 401 }, { status: 200, body: {} }]);
    const client = new NodeCrmClient({
      baseUrl: 'https://crm.test', token: 't', fetchImpl: impl, sleep: async () => {},
    });
    await expect(client.listContacts()).rejects.toBeInstanceOf(CrmAuthError);
    expect(calls).toHaveLength(1);
  });

  it('does not retry a 4xx payload rejection', async () => {
    const { impl, calls } = fakeFetch([{ status: 422 }, { status: 200, body: {} }]);
    const client = new NodeCrmClient({
      baseUrl: 'https://crm.test', token: 't', fetchImpl: impl, sleep: async () => {},
    });
    await expect(client.listContacts()).rejects.toBeInstanceOf(CrmRequestError);
    expect(calls).toHaveLength(1);
  });

  it('reports an unreachable host as retryable rather than as a bad request', async () => {
    const impl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const client = new NodeCrmClient({
      baseUrl: 'https://crm.test', token: 't', fetchImpl: impl, maxRetries: 1, sleep: async () => {},
    });
    await expect(client.listContacts()).rejects.toBeInstanceOf(CrmUnavailableError);
  });

  it('sends an idempotency key on activity writes', async () => {
    // A retry after a timeout must not create a duplicate activity — the same discipline
    // the storefront applies to gateway webhooks.
    const { impl, calls } = fakeFetch([{ status: 204 }]);
    const client = new NodeCrmClient({ baseUrl: 'https://crm.test', token: 't', fetchImpl: impl });
    await client.recordActivity({
      crmContactId: 'crm-1', kind: 'outreach_sent', at: '2026-08-15T00:00:00Z',
      channel: 'email', summary: 'first touch', idempotencyKey: 'key-123',
    });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe('key-123');
  });

  it('reports unconfigured rather than throwing', async () => {
    const client = new NodeCrmClient({ baseUrl: '', token: '' });
    expect(client.isConfigured()).toBe(false);
    expect((await client.health()).reachable).toBe(false);
  });
});

describe('field discipline at the boundary', () => {
  it('drops free-text fields the CRM happens to carry', async () => {
    // A CRM is a place people put free text, and NaviMED prospects are clinics. Only
    // enumerated fields cross, so clinical data has nowhere to land. (Security spec §0.)
    const { impl } = fakeFetch([
      { status: 200, body: { data: [{ ...validRecord, notes: 'patient backlog discussion', description: 'x' }] } },
    ]);
    const client = new NodeCrmClient({ baseUrl: 'https://crm.test', token: 't', fetchImpl: impl });
    const page = await client.listContacts();

    const serialised = JSON.stringify(page.items[0]);
    expect(serialised).not.toContain('patient backlog');
    expect(Object.keys(page.items[0]!)).not.toContain('notes');
  });

  it('refuses a record whose lawful basis is incomplete', async () => {
    const { impl } = fakeFetch([
      {
        status: 200,
        body: {
          data: [
            { ...validRecord, id: 'good' },
            // legitimate interest with no written assessment
            { ...validRecord, id: 'bad', lawful_basis: { kind: 'legitimate_interest', established_at: '2026-08-01', provenance: 'a list' } },
          ],
        },
      },
    ]);
    const client = new NodeCrmClient({ baseUrl: 'https://crm.test', token: 't', fetchImpl: impl });
    const page = await client.listContacts();

    expect(page.items.map((c) => c.crmId)).toEqual(['good']);
  });
});

describe('sync', () => {
  function syncWith(responses: Array<{ status: number; body?: unknown }>) {
    const { impl } = fakeFetch(responses);
    const crm = new NodeCrmClient({
      baseUrl: 'https://crm.test', token: 't', fetchImpl: impl, sleep: async () => {},
    });
    const audit = new AuditLog(store);
    return { sync: new CrmSync({ crm, store, audit }), audit };
  }

  it('imports contacts into the local store', async () => {
    const { sync } = syncWith([
      { status: 200, body: { data: [] } },
      { status: 200, body: { data: [validRecord] } },
    ]);
    const report = await sync.pull();

    expect(report.imported).toBe(1);
    expect(store.getContact(localIdFor('crm-1'))?.organisation).toBe('Clinique Lomé');
  });

  it('imports suppressions before contacts, closing the eligibility window', async () => {
    // Importing a contact who unsubscribed yesterday, and only afterwards importing that
    // unsubscribe, leaves a window in which they are reachable.
    const { sync } = syncWith([
      { status: 200, body: { data: [{ identifier: 'ops@clinique.tg', reason: 'unsubscribed', at: '2026-08-10' }] } },
      { status: 200, body: { data: [validRecord] } },
    ]);
    const report = await sync.pull();

    expect(report.suppressionsImported).toBe(1);
    expect(store.isSuppressed('ops@clinique.tg')).toBe(true);
  });

  it('never removes a local suppression the CRM has stopped listing', async () => {
    // Suppression is import-only and additive. A deleted CRM row, a botched migration or
    // a conflict resolution nobody watched must not return someone to the pool.
    store.suppress('gone@clinique.tg', 'complaint', 'local');
    const { sync } = syncWith([
      { status: 200, body: { data: [] } },
      { status: 200, body: { data: [] } },
    ]);
    await sync.pull();

    expect(store.isSuppressed('gone@clinique.tg')).toBe(true);
    expect(store.getSuppression('gone@clinique.tg')?.reason).toBe('complaint');
  });

  it('does not let a CRM-sourced entry overwrite an older local reason', async () => {
    store.suppress('ops@clinique.tg', 'complaint', 'original');
    const { sync } = syncWith([
      { status: 200, body: { data: [{ identifier: 'ops@clinique.tg', reason: 'manual', at: '2026-08-11' }] } },
      { status: 200, body: { data: [] } },
    ]);
    await sync.pull();

    expect(store.getSuppression('ops@clinique.tg')?.reason).toBe('complaint');
  });

  it('skips a malformed record without aborting the page', async () => {
    const { sync } = syncWith([
      { status: 200, body: { data: [] } },
      { status: 200, body: { data: [validRecord, { id: 'broken' }, { ...validRecord, id: 'crm-2', email: 'two@clinique.tg' }] } },
    ]);
    const report = await sync.pull();

    // The broken record never maps, so it is dropped at the client rather than counted.
    expect(report.imported).toBe(2);
  });

  it('survives a CRM outage without throwing, and the local list still blocks', async () => {
    // The rule that matters: an outage must never enable a send.
    store.suppress('ops@clinique.tg', 'unsubscribed');
    const impl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const crm = new NodeCrmClient({
      baseUrl: 'https://crm.test', token: 't', fetchImpl: impl, maxRetries: 0, sleep: async () => {},
    });
    const sync = new CrmSync({ crm, store, audit: new AuditLog(store) });

    const report = await sync.pull();
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.imported).toBe(0);
    // Stale-but-present is safe: everything already suppressed still blocks.
    expect(store.isSuppressed('ops@clinique.tg')).toBe(true);
  });

  it('records a failed activity push in the audit rather than throwing', async () => {
    const { sync, audit } = syncWith([{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }]);
    const ok = await sync.pushActivity({
      crmContactId: 'crm-1', kind: 'outreach_sent', at: '2026-08-15T00:00:00Z',
      channel: 'email', summary: 'first touch',
    });

    // A failed write-back is a reporting gap, never a reason to stop working.
    expect(ok).toBe(false);
    expect(audit.all().at(-1)?.outcome).toBe('failed');
  });

  it('re-imports an existing contact through the schema constraints', async () => {
    const { sync } = syncWith([
      { status: 200, body: { data: [] } },
      { status: 200, body: { data: [validRecord] } },
      { status: 200, body: { data: [] } },
      { status: 200, body: { data: [{ ...validRecord, organisation: 'Clinique Lomé SARL' }] } },
    ]);
    await sync.pull();
    await sync.pull();

    expect(store.getContact(localIdFor('crm-1'))?.organisation).toBe('Clinique Lomé SARL');
  });
});

describe('LocalCrm', () => {
  it('satisfies the same port with no network', async () => {
    // Its existence is the argument that the port is honest — an interface with one
    // implementation tends to leak that implementation's assumptions.
    const local = new LocalCrm(store);
    expect(local.isConfigured()).toBe(true);
    expect((await local.health()).reachable).toBe(true);

    const id = await local.upsertContact({
      email: 'a@b.test', phone: null, linkedinUrn: null,
      organisation: 'Test', country: 'TG', locale: 'fr',
      lawfulBasis: { kind: 'contract', establishedAt: '2026-08-01', provenance: 'order-1' },
      consents: [], stage: null,
    });

    expect((await local.getContact(id))?.organisation).toBe('Test');
    expect(await local.listSuppressions()).toEqual([]);
  });
});
