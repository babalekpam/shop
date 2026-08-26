/**
 * Channel transports.
 *
 * One interface, three real adapters and a test double. Providers sit behind this line so
 * that wiring a real account later is configuration rather than a rewrite — and so the
 * entire send path can be tested without credentials, which is what lets the compliance
 * spine be verified end to end today.
 */

import type { Channel } from '../domain/types';

export interface OutboundMessage {
  channel: Channel;
  to: string;
  /** Subject for email. Ignored elsewhere. */
  subject?: string | undefined;
  body: string;
  /**
   * Provider-approved template identifier. Required for WhatsApp business-initiated
   * messages; Meta rejects free-form sends outside the service window.
   */
  templateId?: string | undefined;
}

export type SendResult =
  | { sent: true; providerId: string }
  | { sent: false; retryable: boolean; error: string };

export interface Transport {
  readonly channel: Channel;
  /** Whether credentials are present. A transport without them must refuse, not pretend. */
  isConfigured(): boolean;
  send(message: OutboundMessage): Promise<SendResult>;
}

/**
 * Records sends instead of making them.
 *
 * Used by the test suite and by dry runs. It reports `isConfigured() === true` because the
 * thing under test is the gate and the dispatcher, not provider connectivity.
 */
export class RecordingTransport implements Transport {
  readonly sent: OutboundMessage[] = [];

  constructor(readonly channel: Channel) {}

  isConfigured(): boolean {
    return true;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    this.sent.push(message);
    return { sent: true, providerId: `recorded-${this.sent.length}` };
  }
}

/**
 * Base for the real adapters.
 *
 * The important behaviour is the refusal: an unconfigured transport returns a
 * non-retryable failure rather than throwing or silently succeeding. A half-configured
 * deployment that appears to be sending is worse than one that plainly is not — the same
 * reasoning as the storefront's checkout returning 501.
 */
abstract class CredentialedTransport implements Transport {
  abstract readonly channel: Channel;
  protected abstract requiredEnv(): string[];

  isConfigured(): boolean {
    return this.requiredEnv().every((key) => Boolean(process.env[key]));
  }

  protected notConfigured(): SendResult {
    return {
      sent: false,
      retryable: false,
      error: `${this.channel} transport not configured; missing ${this.requiredEnv()
        .filter((k) => !process.env[k])
        .join(', ')}`,
    };
  }

  abstract send(message: OutboundMessage): Promise<SendResult>;
}

/**
 * Email.
 *
 * **A separate sending domain from the storefront's transactional mail.** If cold outreach
 * degrades the reputation of `argilette.shop`, licence keys and dunning notices stop
 * arriving and paying customers are the ones who suffer. `AGENCY_MAIL_DOMAIN` must differ
 * from the storefront's `MAIL_FROM` domain; `assertDomainSeparation()` enforces it.
 */
export class EmailTransport extends CredentialedTransport {
  readonly channel = 'email' as const;

  protected requiredEnv(): string[] {
    return ['AGENCY_SMTP_HOST', 'AGENCY_SMTP_USER', 'AGENCY_SMTP_PASS', 'AGENCY_MAIL_FROM'];
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.isConfigured()) return this.notConfigured();
    // Sprint work: hand to the provider. Deliberately unimplemented rather than stubbed
    // with a fake success — see the class comment above.
    return { sent: false, retryable: false, error: 'email provider not implemented' };
  }
}

/**
 * WhatsApp Business API.
 *
 * Business-initiated messages require a Meta-approved template *and* a recorded opt-in.
 * The opt-in is checked by the compliance gate; the template is checked here, because
 * sending free-form outside the 24-hour service window is a platform violation rather
 * than a compliance one.
 */
export class WhatsAppTransport extends CredentialedTransport {
  readonly channel = 'whatsapp' as const;

  protected requiredEnv(): string[] {
    return ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'];
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.isConfigured()) return this.notConfigured();
    if (!message.templateId) {
      return {
        sent: false,
        retryable: false,
        error: 'business-initiated WhatsApp requires an approved template',
      };
    }
    return { sent: false, retryable: false, error: 'whatsapp provider not implemented' };
  }
}

/**
 * LinkedIn — organic publishing only.
 *
 * There is deliberately no method here for connection requests or direct messages. Those
 * violate LinkedIn's terms regardless of tooling, and the account at risk is the one the
 * catalog says already produces inbound. The absence is the control: you cannot call what
 * does not exist. A test asserts no such method appears.
 */
export class LinkedInTransport extends CredentialedTransport {
  readonly channel = 'linkedin' as const;

  protected requiredEnv(): string[] {
    return ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_ORGANIZATION_URN'];
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.isConfigured()) return this.notConfigured();
    return { sent: false, retryable: false, error: 'linkedin publisher not implemented' };
  }
}

/**
 * Refuse to run if outreach and transactional mail share a domain.
 *
 * Checked at startup rather than at send time: discovering this after a reputation
 * incident is discovering it too late.
 */
export function assertDomainSeparation(
  agencyFrom: string | undefined,
  storefrontFrom: string | undefined,
): void {
  if (!agencyFrom || !storefrontFrom) return;
  const domainOf = (address: string): string => address.split('@').pop()?.toLowerCase() ?? '';
  if (domainOf(agencyFrom) === domainOf(storefrontFrom)) {
    throw new Error(
      'Agency outreach and storefront transactional mail share a sending domain. ' +
        'Degraded outbound reputation would stop licence keys reaching paying customers. ' +
        'Use a separate domain for AGENCY_MAIL_FROM.',
    );
  }
}
