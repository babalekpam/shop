/**
 * The send gate.
 *
 * Everything that determines whether a human may be contacted runs here, in code, backed
 * by database constraints. This is the spec's central structural claim (§2): an agent
 * *instructed* not to contact a suppressed address will eventually contact one, because
 * instructions are probabilistic and constraints are not.
 *
 * Checks run in a deliberate order — cheapest and most absolute first, so a halted system
 * never touches the database and a suppressed contact is never scored for frequency.
 */

import type { AgencyStore } from '../store';
import { resolveKillSwitch, type KillSwitchReader } from './killswitch';
import type { BudgetLedger } from '../budget';
import type { ActionRequest, Contact, Channel, RefusalCode } from '../domain/types';
import { isOutbound } from '../domain/autonomy';

export interface FrequencyPolicy {
  /** Maximum touches in the window, across **all** channels combined. */
  maxTouches: number;
  windowDays: number;
}

export const DEFAULT_FREQUENCY: FrequencyPolicy = { maxTouches: 3, windowDays: 30 };

export interface GateDeps {
  store: AgencyStore;
  killSwitch: KillSwitchReader;
  ledger: BudgetLedger;
  frequency?: FrequencyPolicy;
  now?: () => Date;
}

export type GateVerdict =
  | { allowed: true }
  | { allowed: false; code: RefusalCode; reason: string };

const deny = (code: RefusalCode, reason: string): GateVerdict => ({
  allowed: false,
  code,
  reason,
});

/**
 * Channels whose platform rules require an explicit, recorded opt-in before a
 * business-initiated message.
 *
 * WhatsApp is the live case: Meta requires opt-in provenance and an approved template,
 * with account termination behind it. Email cold outreach can rest on legitimate interest;
 * WhatsApp cannot. (Spec §4.2.)
 */
const CONSENT_REQUIRED_CHANNELS: ReadonlySet<Channel> = new Set<Channel>(['whatsapp']);

export class ComplianceGate {
  private readonly frequency: FrequencyPolicy;
  private readonly now: () => Date;

  constructor(private readonly deps: GateDeps) {
    this.frequency = deps.frequency ?? DEFAULT_FREQUENCY;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Decide whether an action may proceed.
   *
   * Returns a refusal rather than throwing, because a refusal is a normal, expected,
   * loggable outcome — most of them mean the system is working.
   */
  evaluate(request: ActionRequest, contact?: Contact): GateVerdict {
    // 1. The kill switch. Absolute, and checked before anything else touches state.
    if (isOutbound(request.kind) || request.kind === 'publish.post') {
      const halt = resolveKillSwitch(this.deps.killSwitch);
      if (halt.halted) return deny('kill_switch', halt.reason);
    }

    // 2. Ceilings. Cheap, and refusing here avoids doing work that cannot be paid for.
    if (request.estimatedTokens && this.deps.ledger.wouldExceed('tokens', request.estimatedTokens)) {
      return deny('token_ceiling', 'monthly token ceiling reached');
    }
    if (request.spendMinor && this.deps.ledger.wouldExceed('ad_spend_minor', request.spendMinor)) {
      return deny('spend_ceiling', 'monthly ad spend ceiling reached');
    }

    // Everything below concerns contacting a person. Actions that reach nobody stop here.
    if (!isOutbound(request.kind)) return { allowed: true };

    if (!contact) {
      return deny('no_lawful_basis', 'outbound action with no contact attached');
    }

    // 3. Suppression. Checked against every identifier we hold for this person, not just
    //    the one this channel happens to use — someone who unsubscribed by email has not
    //    consented to be reached on WhatsApp instead.
    for (const identifier of this.deps.store.identifiersFor(contact)) {
      if (this.deps.store.isSuppressed(identifier)) {
        const entry = this.deps.store.getSuppression(identifier);
        return deny('suppressed', `suppressed (${entry?.reason ?? 'unknown'})`);
      }
    }

    // 4. Lawful basis. Its completeness is enforced by CHECK constraints at write time;
    //    this re-verifies at send time because a row can predate a schema tightening.
    const basis = contact.lawfulBasis;
    if (basis.kind === 'legitimate_interest' && !basis.assessmentRef) {
      return deny('basis_incomplete', 'legitimate interest claimed with no written assessment');
    }
    if (basis.kind === 'consent' && !basis.consentWording) {
      return deny('basis_incomplete', 'consent claimed with no recorded wording');
    }

    // 5. Channel consent, where the platform demands it.
    const channel = request.channel;
    if (channel && CONSENT_REQUIRED_CHANNELS.has(channel)) {
      const hasConsent = contact.channelConsents.some((c) => c.channel === channel);
      if (!hasConsent) {
        return deny('no_channel_consent', `${channel} requires a recorded opt-in`);
      }
    }

    // 6. Frequency, across all channels combined.
    const since = new Date(this.now().getTime() - this.frequency.windowDays * 86_400_000);
    const touches = this.deps.store.touchesSince(contact.id, since.toISOString());
    if (touches >= this.frequency.maxTouches) {
      return deny(
        'frequency_cap',
        `${touches} touches in ${this.frequency.windowDays} days, cap is ${this.frequency.maxTouches}`,
      );
    }

    return { allowed: true };
  }
}
