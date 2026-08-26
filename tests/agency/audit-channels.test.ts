import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { AgencyStore } from '../../src/agency/store';
import { AuditLog, GENESIS_HASH } from '../../src/agency/audit';
import {
  EmailTransport,
  LinkedInTransport,
  RecordingTransport,
  WhatsAppTransport,
  assertDomainSeparation,
} from '../../src/agency/channels/transport';

let store: AgencyStore;
let audit: AuditLog;
beforeEach(() => {
  store = new AgencyStore();
  audit = new AuditLog(store);
});
afterEach(() => store.close());

describe('tamper-evident audit log', () => {
  it('chains from a known genesis so even the first entry is verifiable', () => {
    const first = audit.append({ agent: 'scout', actionKind: 'research.enrich', outcome: 'executed:L0', detail: 'x' });
    expect(first.prevHash).toBe(GENESIS_HASH);
    expect(audit.verify()).toEqual({ ok: true });
  });

  it('verifies a healthy chain of many entries', () => {
    for (let i = 0; i < 25; i++) {
      audit.append({ agent: 'operator', actionKind: 'outreach.send_followup', outcome: 'executed:L1', detail: `touch ${i}` });
    }
    expect(audit.verify()).toEqual({ ok: true });
  });

  it('detects an altered entry and reports where', () => {
    audit.append({ agent: 'scout', actionKind: 'research.enrich', outcome: 'executed:L0', detail: 'first' });
    const target = audit.append({ agent: 'operator', actionKind: 'outreach.send_first_touch', outcome: 'executed:L1', detail: 'second' });
    audit.append({ agent: 'analyst', actionKind: 'research.score', outcome: 'executed:L0', detail: 'third' });

    // Rewrite history directly in the database, as an attacker with DB access would.
    store.connection
      .prepare('UPDATE audit_log SET detail = ? WHERE seq = ?')
      .run('tampered', target.seq);

    const result = audit.verify();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.brokenAt).toBe(target.seq);
      expect(result.reason).toMatch(/does not match its hash/);
    }
  });

  it('detects a deleted entry', () => {
    audit.append({ agent: 'scout', actionKind: 'research.enrich', outcome: 'ok', detail: 'a' });
    const second = audit.append({ agent: 'scout', actionKind: 'research.enrich', outcome: 'ok', detail: 'b' });
    audit.append({ agent: 'scout', actionKind: 'research.enrich', outcome: 'ok', detail: 'c' });

    store.connection.prepare('DELETE FROM audit_log WHERE seq = ?').run(second.seq);

    const result = audit.verify();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/predecessor hash/);
  });

  it('records refusals, not only successes', () => {
    // The entries that matter most when explaining what the system did not do.
    audit.append({ agent: 'operator', actionKind: 'outreach.send_first_touch', outcome: 'refused:suppressed', detail: 'suppressed (unsubscribed)' });
    expect(audit.all().at(-1)?.outcome).toBe('refused:suppressed');
  });
});

describe('channel transports', () => {
  it('refuse rather than pretend when unconfigured', async () => {
    for (const t of [new EmailTransport(), new WhatsAppTransport(), new LinkedInTransport()]) {
      expect(t.isConfigured()).toBe(false);
      const result = await t.send({ channel: t.channel, to: 'x', body: 'y' });
      expect(result.sent).toBe(false);
      if (!result.sent) {
        expect(result.retryable).toBe(false);
        expect(result.error).toMatch(/not configured/);
      }
    }
  });

  it('WhatsApp refuses a business-initiated send with no approved template', async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test';
    try {
      const result = await new WhatsAppTransport().send({ channel: 'whatsapp', to: '+228', body: 'hi' });
      expect(result.sent).toBe(false);
      if (!result.sent) expect(result.error).toMatch(/approved template/);
    } finally {
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      delete process.env.WHATSAPP_ACCESS_TOKEN;
    }
  });

  it('has no LinkedIn connection or DM capability anywhere in the source', () => {
    // The absence is the control: you cannot call what does not exist. Automated
    // connections and DMs violate LinkedIn's terms and risk the account the catalog says
    // already produces inbound.
    const source = readFileSync('src/agency/channels/transport.ts', 'utf8');
    for (const forbidden of [/sendConnectionRequest/, /sendDirectMessage/, /\bsendDM\b/, /invitation/i]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  it('refuses to share a sending domain with storefront transactional mail', () => {
    // If cold outreach degrades argilette.shop's reputation, licence keys stop arriving
    // and paying customers are the ones who suffer.
    expect(() =>
      assertDomainSeparation('hello@argilette.shop', 'no-reply@argilette.shop'),
    ).toThrow(/separate domain/i);

    expect(() =>
      assertDomainSeparation('hello@go.argilette.shop', 'no-reply@argilette.shop'),
    ).not.toThrow();
  });

  it('the recording double captures sends for tests without credentials', async () => {
    const t = new RecordingTransport('email');
    await t.send({ channel: 'email', to: 'a@b.test', subject: 'hi', body: 'x' });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]?.subject).toBe('hi');
  });
});

describe('no PHI-capable storage', () => {
  it('has no free-text column on contacts', () => {
    // The structural half of security spec §0: clinical data cannot be stored because
    // there is nowhere to put it.
    const columns = store.connection.prepare('PRAGMA table_info(contacts)').all() as Array<{ name: string }>;
    const names = columns.map((c) => String(c.name));
    for (const forbidden of ['notes', 'note', 'comments', 'description', 'free_text', 'summary']) {
      expect(names).not.toContain(forbidden);
    }
  });
});
