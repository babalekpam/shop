/**
 * Runs the importer over the real converted list, when one is present.
 *
 * `npm run agency:prospects`
 *
 * Skips when `data/togo-sante-2026.json` is absent, so CI stays green without the data —
 * which is never committed (see .gitignore). Reports the shape of the list and the top of
 * the call queue, so a human can act on it without the file being loaded anywhere else.
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildCallQueue,
  importProspects,
  type ProspectRow,
} from '../../src/agency/import/prospects';

const PATH = 'data/togo-sante-2026.json';
const present = existsSync(PATH);

describe.skipIf(!present)('Togo private-health list', () => {
  const rows = JSON.parse(readFileSync(PATH, 'utf8')) as Array<ProspectRow & { director?: string }>;

  it('imports under a recorded legitimate-interest assessment', () => {
    const result = importProspects(rows, {
      assessmentRef: 'LIA-TOGO-2026-01',
      provenance: 'Ministère de la Santé — registre des formations sanitaires privées',
    });

    process.stdout.write(
      `\n  list shape: ${result.stats.total} facilities\n` +
        `    institutional contact : ${result.stats.institutional}\n` +
        `    personal mobile       : ${result.stats.personalMobile}  (human call only)\n` +
        `    email only            : ${result.stats.emailOnly}\n` +
        `    no contact point      : ${result.stats.noContactPoint}\n`,
    );

    expect(result.contacts.length).toBeGreaterThan(0);
    for (const contact of result.contacts) {
      expect(contact.lawfulBasis.assessmentRef).toBeTruthy();
      expect(contact.channelConsents).toEqual([]);
    }
  });

  it('admits far fewer to automated channels than to a call list', () => {
    const all = importProspects(rows, { assessmentRef: 'LIA-1', provenance: 'registre' });
    const automated = importProspects(rows, {
      assessmentRef: 'LIA-1', provenance: 'registre', automatedOnly: true,
    });

    process.stdout.write(
      `\n  reachable by a human : ${all.contacts.length}\n` +
        `  eligible for automated outreach : ${automated.contacts.length}\n`,
    );
    expect(automated.contacts.length).toBeLessThan(all.contacts.length);
  });

  it('puts the renewal window at the top of the call queue', () => {
    const queue = buildCallQueue(rows, 15);

    // Shape only — no names, no numbers.
    //
    // `data/` is gitignored because this data cannot be rotated and the people in it did
    // not choose to be there. Printing it here would defeat that entirely: terminal
    // scrollback gets pasted into chats, and CI logs are retained for months and readable
    // by anyone with repository access. The test's job is to prove the queue orders
    // correctly against the real file, and it can do that without naming a single clinic.
    let personalMobiles = 0;
    for (const entry of queue) if (entry.personalMobile) personalMobiles++;
    process.stdout.write(
      `\n  call queue: ${queue.length} entries, ` +
        `${personalMobiles} on a personal mobile (human call only)\n` +
        `  most overdue licence: ${queue[0]?.daysToExpiry ?? '?'} days\n\n`,
    );

    // Expired licences first — they are operating without a valid one and know it.
    expect(queue[0]?.daysToExpiry).toBeLessThan(0);
  });

  it('holds no clinical content', () => {
    // The file is licensing and contact data. Verified rather than assumed, because the
    // PHI boundary is absolute and this is the first external dataset to enter.
    const blob = JSON.stringify(rows);
    for (const marker of [/\bpatient/i, /diagnos/i, /ordonnance/i, /dossier m[ée]dical/i]) {
      expect(blob).not.toMatch(marker);
    }
  });
});
