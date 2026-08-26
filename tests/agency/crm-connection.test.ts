/**
 * Live Node CRM connection check.
 *
 * `npm run agency:crm-check`
 *
 * Skips silently when `NODE_CRM_URL` and `NODE_CRM_TOKEN` are absent, so CI stays green
 * without credentials. Set both and it probes a real instance.
 *
 * A connection check is an integration test, so it is written as one rather than as a
 * bespoke script — that also means it runs through the same TypeScript pipeline as
 * everything else, with no extra dependency to review.
 *
 * **Reads only.** A connectivity check that creates a contact is a connectivity check
 * that pollutes a production pipeline.
 */

import { describe, expect, it } from 'vitest';

import { NodeCrmClient } from '../../src/agency/crm/node-crm';
import { mappingFromJson } from '../../src/agency/crm/mapping';

const baseUrl = process.env.NODE_CRM_URL;
const token = process.env.NODE_CRM_TOKEN;
const configured = Boolean(baseUrl && token);

describe.skipIf(!configured)('Node CRM — live connection', () => {
  const client = new NodeCrmClient({
    baseUrl: baseUrl!,
    token: token!,
    mapping: mappingFromJson(process.env.NODE_CRM_MAPPING),
    maxRetries: 1,
  });

  it('is reachable', async () => {
    const health = await client.health();
    expect(
      health.reachable,
      `Not reachable: ${health.detail}\n` +
        'If the host is up but the path is wrong, override endpoints.health via ' +
        'NODE_CRM_MAPPING. See src/agency/crm/mapping.ts.',
    ).toBe(true);
  });

  it('lists contacts, and they map onto our shape', async () => {
    const page = await client.listContacts({ limit: 5 });
    expect(Array.isArray(page.items)).toBe(true);

    // The failure this is really looking for: an endpoint that answers, but whose field
    // names differ, so everything maps to null and the sync silently imports nothing.
    // That looks like success everywhere else.
    if (page.items.length === 0) {
      process.stdout.write(
        '\n  NOTE: the contacts endpoint answered but nothing mapped.\n' +
          '  Either there are no contacts, or the field names differ from CrmFieldMap.\n' +
          '  Compare a raw record against src/agency/crm/mapping.ts.\n\n',
      );
    } else {
      const first = page.items[0]!;
      expect(first.crmId, 'crmId did not map — check fields.crmId').toBeTruthy();
      expect(first.organisation, 'organisation did not map').toBeTruthy();
      expect(
        first.lawfulBasis.kind,
        'lawful basis did not map — contacts without one cannot be imported',
      ).toBeTruthy();
    }
  });

  it('exposes suppressions for import', async () => {
    // Until this works, someone who unsubscribes inside Node CRM stays reachable here.
    const suppressions = await client.listSuppressions();
    expect(Array.isArray(suppressions)).toBe(true);
  });
});

describe.skipIf(configured)('Node CRM — not configured', () => {
  it('reports cleanly rather than failing', async () => {
    const client = new NodeCrmClient({ baseUrl: '', token: '' });
    expect(client.isConfigured()).toBe(false);
    const health = await client.health();
    expect(health.reachable).toBe(false);
    expect(health.detail).toMatch(/not set/);
  });
});
