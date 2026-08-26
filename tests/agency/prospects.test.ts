import { describe, expect, it } from 'vitest';

import {
  buildCallQueue,
  callPriority,
  classifyContactPoint,
  classifyPhone,
  eligibleForAutomatedOutreach,
  importProspects,
  prospectId,
  type ProspectRow,
} from '../../src/agency/import/prospects';

/** Synthetic rows. The real list is personal data and does not belong in a repository. */
function row(overrides: Partial<ProspectRow> = {}): ProspectRow {
  return {
    ref: '1',
    name: 'CLINIQUE TEST',
    segment: 'Clinique',
    tier: 'A',
    score: 100,
    ownerType: 'Organisation / confession',
    phone: '+228 22 25 20 87',
    phone2: '',
    email: '',
    phoneConfidence: 'Élevée',
    phoneSource: 'registre',
    city: 'Grand Lomé',
    district: 'GOLFE',
    region: 'REGION DU GRAND LOME',
    licenceStatus: 'Valide',
    daysToExpiry: 800,
    ...overrides,
  };
}

const LIA = { assessmentRef: 'LIA-TOGO-2026-01', provenance: 'Ministère de la Santé — registre' };

describe('phone classification', () => {
  it('separates Togolese fixed lines from mobiles', () => {
    expect(classifyPhone('+228 22 25 20 87')).toBe('fixed');
    expect(classifyPhone('+228 70 41 05 94')).toBe('mobile');
    expect(classifyPhone('90 12 34 56')).toBe('mobile');
    expect(classifyPhone('')).toBe('unknown');
  });

  it('treats a sole practitioner mobile as personal, and a hospital mobile as institutional', () => {
    // The same number shape means different things depending on who holds it.
    expect(
      classifyContactPoint(row({ phone: '+228 90 11 22 33', ownerType: 'Praticien individuel' })),
    ).toBe('personal_mobile');
    expect(
      classifyContactPoint(row({ phone: '+228 90 11 22 33', ownerType: 'Organisation / confession' })),
    ).toBe('institutional');
  });

  it('falls back to a second number, then to email, then to nothing', () => {
    expect(classifyContactPoint(row({ phone: '', phone2: '+228 22 00 00 00' }))).toBe('institutional');
    expect(classifyContactPoint(row({ phone: '', phone2: '', email: 'a@b.tg' }))).toBe('email_only');
    expect(classifyContactPoint(row({ phone: '', phone2: '', email: '' }))).toBe('none');
  });
});

describe('automated-outreach eligibility', () => {
  it('excludes a sole practitioner mobile', () => {
    // A human may call a doctor's published number. The machine may not message it.
    expect(
      eligibleForAutomatedOutreach(row({ phone: '+228 91 00 00 00', ownerType: 'Praticien individuel' })),
    ).toBe(false);
  });

  it('excludes a number nobody could corroborate', () => {
    expect(eligibleForAutomatedOutreach(row({ phoneConfidence: 'Faible' }))).toBe(false);
    expect(eligibleForAutomatedOutreach(row({ phoneConfidence: 'Élevée' }))).toBe(true);
  });

  it('excludes a row with no contact point at all', () => {
    expect(eligibleForAutomatedOutreach(row({ phone: '', phone2: '', email: '' }))).toBe(false);
  });
});

describe('import', () => {
  it('refuses to run without a written legitimate-interest assessment', () => {
    // Importing hundreds of contact records is exactly the moment the basis must exist
    // on paper. Failing here beats 359 constraint violations.
    expect(() => importProspects([row()], { assessmentRef: '', provenance: 'x' })).toThrow(
      /requires assessmentRef/,
    );
  });

  it('records the basis and provenance on every contact', () => {
    const result = importProspects([row()], LIA);
    const contact = result.contacts[0]!;
    expect(contact.lawfulBasis.kind).toBe('legitimate_interest');
    expect(contact.lawfulBasis.assessmentRef).toBe('LIA-TOGO-2026-01');
    expect(contact.lawfulBasis.provenance).toMatch(/Ministère/);
  });

  it('imports the facility, never the named practitioner', () => {
    // The workbook names a director for 97% of rows. Those names stay in the source file:
    // the automated system has no field to hold them in, which is the point.
    const result = importProspects([row({ name: 'CABINET DU Dr EXEMPLE' })], LIA);
    const serialised = JSON.stringify(result.contacts[0]);
    expect(result.contacts[0]?.organisation).toBe('CABINET DU Dr EXEMPLE');
    expect(serialised).not.toMatch(/"name"|"contactName"|"dirigeant"/);
  });

  it('grants no channel consent, so WhatsApp stays closed to the whole list', () => {
    // Nobody in a prospect list has opted in to anything. The compliance gate refuses
    // WhatsApp without a recorded opt-in, so this is what keeps that true.
    const result = importProspects([row()], LIA);
    expect(result.contacts[0]?.channelConsents).toEqual([]);
  });

  it('skips rows with no contact point and says so', () => {
    const result = importProspects([row({ ref: '2', phone: '', phone2: '', email: '' })], LIA);
    expect(result.contacts).toHaveLength(0);
    expect(result.excluded[0]).toMatchObject({ ref: '2', reason: 'no contact point' });
  });

  it('excludes personal mobiles when importing for automated channels', () => {
    const rows = [
      row({ ref: '1', ownerType: 'Organisation / confession' }),
      row({ ref: '2', ownerType: 'Praticien individuel', phone: '+228 91 00 00 00' }),
    ];
    const result = importProspects(rows, { ...LIA, automatedOnly: true });

    expect(result.contacts.map((c) => c.id)).toEqual([prospectId('1')]);
    expect(result.excluded[0]?.reason).toMatch(/human call only/);
  });

  it('reports the shape of the list rather than dropping rows silently', () => {
    const rows = [
      row({ ref: '1' }),
      row({ ref: '2', ownerType: 'Praticien individuel', phone: '+228 91 00 00 00' }),
      row({ ref: '3', phone: '', phone2: '', email: 'a@b.tg' }),
      row({ ref: '4', phone: '', phone2: '', email: '' }),
    ];
    const result = importProspects(rows, LIA);
    expect(result.stats).toEqual({
      total: 4, institutional: 1, personalMobile: 1, emailOnly: 1, noContactPoint: 1,
    });
  });

  it('gives a stable id so a re-import updates rather than duplicates', () => {
    const a = importProspects([row({ ref: '216' })], LIA).contacts[0];
    const b = importProspects([row({ ref: '216', name: 'RENAMED' })], LIA).contacts[0];
    expect(a?.id).toBe(b?.id);
  });
});

describe('call queue', () => {
  it('ranks renewal urgency above tier', () => {
    // A Tier B clinic whose licence expired last month is a better call today than a
    // Tier A hospital with three years left. Timing beats size.
    const expiredB = row({ ref: 'b', tier: 'B', daysToExpiry: -41, licenceStatus: 'Expiré' });
    const comfortableA = row({ ref: 'a', tier: 'A', daysToExpiry: 900 });
    expect(callPriority(expiredB)).toBeGreaterThan(callPriority(comfortableA));
  });

  it('puts already-expired licences at the top', () => {
    const queue = buildCallQueue([
      row({ ref: '1', daysToExpiry: 400 }),
      row({ ref: '2', daysToExpiry: -20, licenceStatus: 'Expiré' }),
      row({ ref: '3', daysToExpiry: 60 }),
    ]);
    expect(queue.map((q) => q.ref)).toEqual(['2', '3', '1']);
  });

  it('includes personal mobiles but flags them', () => {
    const queue = buildCallQueue([
      row({ ref: '1', ownerType: 'Praticien individuel', phone: '+228 91 00 00 00' }),
    ]);
    expect(queue[0]?.personalMobile).toBe(true);
  });

  it('leaves out rows nobody can reach', () => {
    const queue = buildCallQueue([row({ ref: '1', phone: '', phone2: '', email: '' })]);
    expect(queue).toHaveLength(0);
  });
});
