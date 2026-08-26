import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgencyStore } from '../../src/agency/store';
import { ComplianceGate } from '../../src/agency/compliance/gate';
import { InMemoryKillSwitch, resolveKillSwitch } from '../../src/agency/compliance/killswitch';
import { BudgetLedger } from '../../src/agency/budget';
import { AuditLog } from '../../src/agency/audit';
import { Dispatcher } from '../../src/agency/agents/dispatcher';
import { createTeam } from '../../src/agency/agents/team';
import { taint } from '../../src/agency/content/untrusted';
import type { ActionRequest, Contact } from '../../src/agency/domain/types';

const CEILINGS = { tokens: 100_000, adSpendMinor: 500_00 };

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    email: 'ada@clinique-lome.tg',
    phone: '+22890000000',
    linkedinUrn: null,
    organisation: 'Clinique Lomé',
    country: 'TG',
    locale: 'fr',
    lawfulBasis: {
      kind: 'legitimate_interest',
      establishedAt: '2026-08-01',
      provenance: 'public business directory',
      assessmentRef: 'LIA-2026-01',
    },
    channelConsents: [],
    ...overrides,
  };
}

interface Harness {
  store: AgencyStore;
  gate: ComplianceGate;
  audit: AuditLog;
  ledger: BudgetLedger;
  killSwitch: InMemoryKillSwitch;
  dispatcher: Dispatcher;
  executed: ActionRequest[];
}

function harness(): Harness {
  const store = new AgencyStore();
  const killSwitch = new InMemoryKillSwitch();
  const ledger = new BudgetLedger(store, CEILINGS);
  const gate = new ComplianceGate({ store, killSwitch, ledger });
  const audit = new AuditLog(store);
  const executed: ActionRequest[] = [];
  const dispatcher = new Dispatcher({
    store,
    gate,
    audit,
    ledger,
    execute: async (r) => {
      executed.push(r);
    },
  });
  return { store, gate, audit, ledger, killSwitch, dispatcher, executed };
}

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.store.close());

describe('lawful basis', () => {
  it('cannot store a legitimate-interest contact with no written assessment', () => {
    // Enforced by a CHECK constraint, so it fails at write time rather than at send time
    // when a person is already on the receiving end.
    expect(() =>
      h.store.addContact(
        contact({
          lawfulBasis: {
            kind: 'legitimate_interest',
            establishedAt: '2026-08-01',
            provenance: 'a list',
            assessmentRef: undefined,
          },
        }),
      ),
    ).toThrow();
  });

  it('cannot store a consent contact with no recorded wording', () => {
    expect(() =>
      h.store.addContact(
        contact({
          lawfulBasis: {
            kind: 'consent',
            establishedAt: '2026-08-01',
            provenance: 'signup form',
            consentWording: undefined,
          },
        }),
      ),
    ).toThrow();
  });

  it('accepts a complete basis', () => {
    expect(() => h.store.addContact(contact())).not.toThrow();
    expect(h.store.getContact('c1')?.organisation).toBe('Clinique Lomé');
  });
});

describe('suppression', () => {
  it('refuses a send to a suppressed contact, at the store rather than in a prompt', async () => {
    h.store.addContact(contact());
    h.store.suppress('ada@clinique-lome.tg', 'unsubscribed');

    const team = createTeam();
    const decision = await h.dispatcher.dispatch(
      team.operator.firstTouch(contact(), 'email'),
      contact(),
    );

    expect(decision.outcome).toBe('refused');
    expect(decision).toMatchObject({ code: 'suppressed' });
    expect(h.executed).toHaveLength(0);
  });

  it('is case- and whitespace-insensitive', () => {
    h.store.suppress('  Ada@Clinique-Lome.TG  ', 'complaint');
    expect(h.store.isSuppressed('ada@clinique-lome.tg')).toBe(true);
  });

  it('survives re-import, keeping the original reason', () => {
    // The failure this prevents: a contact who unsubscribed reappears in a freshly bought
    // list, and the re-import overwrites the reason so nobody can see they ever objected.
    h.store.suppress('ada@clinique-lome.tg', 'unsubscribed', 'original');
    h.store.suppress('ada@clinique-lome.tg', 'manual', 'from new list');

    const entry = h.store.getSuppression('ada@clinique-lome.tg');
    expect(entry?.reason).toBe('unsubscribed');
    expect(entry?.note).toBe('original');
  });

  it('blocks every channel, not just the one that was unsubscribed', async () => {
    // Someone who unsubscribed by email has not consented to be reached on WhatsApp.
    const c = contact({
      channelConsents: [{ channel: 'whatsapp', optedInAt: '2026-08-01', provenance: 'form' }],
    });
    h.store.addContact(c);
    h.store.suppress('ada@clinique-lome.tg', 'unsubscribed');

    const team = createTeam();
    const decision = await h.dispatcher.dispatch(team.operator.firstTouch(c, 'whatsapp'), c);
    expect(decision).toMatchObject({ outcome: 'refused', code: 'suppressed' });
  });
});

describe('kill switch', () => {
  it('halts outbound when engaged', async () => {
    const c = contact();
    h.store.addContact(c);
    h.killSwitch.engage('investigating a complaint', 'ops');

    const team = createTeam();
    const decision = await h.dispatcher.dispatch(team.operator.firstTouch(c, 'email'), c);
    expect(decision).toMatchObject({ outcome: 'refused', code: 'kill_switch' });
  });

  it('fails safe when its store is unreachable', () => {
    // The alternative is a system that resumes sending exactly when its own
    // infrastructure is in an unknown state.
    h.killSwitch.breakStore();
    const verdict = resolveKillSwitch(h.killSwitch);
    expect(verdict.halted).toBe(true);
    expect(verdict.reason).toMatch(/failing safe/i);
  });

  it('does not block research, which reaches nobody', async () => {
    h.killSwitch.engage('paused', 'ops');
    const team = createTeam();
    const decision = await h.dispatcher.dispatch(team.analyst.score(contact()), contact());
    expect(decision.outcome).not.toBe('refused');
  });
});

describe('channel consent', () => {
  it('refuses WhatsApp without a recorded opt-in', async () => {
    const c = contact();
    h.store.addContact(c);
    const team = createTeam();
    const decision = await h.dispatcher.dispatch(team.operator.firstTouch(c, 'whatsapp'), c);
    expect(decision).toMatchObject({ outcome: 'refused', code: 'no_channel_consent' });
  });

  it('allows WhatsApp with one', async () => {
    const c = contact({
      channelConsents: [{ channel: 'whatsapp', optedInAt: '2026-08-01', provenance: 'form' }],
    });
    h.store.addContact(c);
    const team = createTeam();
    const decision = await h.dispatcher.dispatch(team.operator.firstTouch(c, 'whatsapp'), c);
    expect(decision.outcome).toBe('executed');
  });

  it('does not require an opt-in for email under legitimate interest', async () => {
    const c = contact();
    h.store.addContact(c);
    const team = createTeam();
    const decision = await h.dispatcher.dispatch(team.operator.firstTouch(c, 'email'), c);
    expect(decision.outcome).toBe('executed');
  });
});

describe('frequency cap', () => {
  it('counts across all channels combined, not per channel', async () => {
    // Three messages in a month is three messages whether or not they arrived by three
    // different routes. Per-channel caps let all three through while reporting healthy.
    const c = contact({
      channelConsents: [{ channel: 'whatsapp', optedInAt: '2026-08-01', provenance: 'form' }],
    });
    h.store.addContact(c);
    const team = createTeam();

    await h.dispatcher.dispatch(team.operator.firstTouch(c, 'email'), c);
    await h.dispatcher.dispatch(team.operator.followUp(c, 'whatsapp'), c);
    await h.dispatcher.dispatch(team.operator.followUp(c, 'email'), c);

    const fourth = await h.dispatcher.dispatch(team.operator.followUp(c, 'email'), c);
    expect(fourth).toMatchObject({ outcome: 'refused', code: 'frequency_cap' });
    expect(h.executed).toHaveLength(3);
  });
});

describe('DSAR erasure', () => {
  it('removes the contact but keeps the suppression', () => {
    // Deleting someone entirely is how you mail them again next quarter from a fresh
    // list: the erasure would destroy the only record that they objected.
    h.store.addContact(contact());
    h.store.erase('c1');

    expect(h.store.getContact('c1')).toBeUndefined();
    expect(h.store.isSuppressed('ada@clinique-lome.tg')).toBe(true);
    expect(h.store.getSuppression('ada@clinique-lome.tg')?.reason).toBe('dsar_erasure');
  });
});
