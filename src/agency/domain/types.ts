/**
 * ARGILETTE Agency — domain types.
 *
 * See docs/specs/argilette-agency-spec.md. Two rules from that spec are enforced by the
 * shape of these types rather than by anyone remembering them:
 *
 * 1. **No PHI-capable field exists anywhere in this model.** NaviMED prospects are
 *    clinics; a free-text field on a contact is exactly how clinical information would
 *    arrive. There is no `notes` string on `Contact`, and there never should be. What
 *    the system knows about a person is structured, enumerated, and small.
 *    (Security spec §0, agency spec §0.)
 *
 * 2. **A contact cannot exist in the outreach pool without a lawful basis.** It is a
 *    required field, not an optional one, so "we'll fill it in later" fails to compile.
 *    (Agency spec §6.1.)
 */

/** Channels the system can reach someone through. */
export type Channel = 'email' | 'whatsapp' | 'linkedin';

/**
 * Why we are permitted to contact this person.
 *
 * `contract` covers service messages to existing customers, not marketing.
 * `legitimate_interest` requires a written, dated assessment per source — see
 * `LawfulBasis.assessmentRef`.
 */
export type LawfulBasisKind = 'consent' | 'contract' | 'legitimate_interest';

export interface LawfulBasis {
  kind: LawfulBasisKind;
  /** ISO date the basis was established. Undated bases are not auditable. */
  establishedAt: string;
  /** Where it came from — a form URL, an order id, a named list. */
  provenance: string;
  /**
   * Reference to the written legitimate-interest assessment. Required when
   * `kind === 'legitimate_interest'`; the gate rejects the contact otherwise.
   */
  assessmentRef?: string | undefined;
  /** Exact wording shown at opt-in. Required for `consent`. */
  consentWording?: string | undefined;
}

/**
 * Per-channel opt-in.
 *
 * WhatsApp business-initiated messages require this on record — a platform rule with
 * account termination behind it, not a nicety (agency spec §4.2).
 */
export interface ChannelConsent {
  channel: Channel;
  optedInAt: string;
  provenance: string;
}

export interface Contact {
  id: string;
  /** Lowercased at construction; the suppression key is derived from it. */
  email: string | null;
  /** E.164. Null when we hold no phone. */
  phone: string | null;
  linkedinUrn: string | null;
  organisation: string;
  /** ISO 3166-1 alpha-2. Drives which regime applies. */
  country: string;
  locale: string;
  lawfulBasis: LawfulBasis;
  channelConsents: ChannelConsent[];
}

/** Why someone is suppressed. All of these are permanent unless a human reverses them. */
export type SuppressionReason =
  | 'unsubscribed'
  | 'complaint'
  | 'hard_bounce'
  | 'dsar_erasure'
  | 'manual';

export interface SuppressionEntry {
  /** Normalised address or phone. The unique key in the database. */
  identifier: string;
  reason: SuppressionReason;
  suppressedAt: string;
  note: string | null;
}

/**
 * Autonomy levels (agency spec §3). Three, with nothing in between.
 *
 *   L0 — acts, logged, no notification
 *   L1 — acts, then notifies; reversible within a window
 *   L2 — cannot act; a human decides
 */
export type AutonomyLevel = 'L0' | 'L1' | 'L2';

/** Everything an agent can ask to do. The registry in `autonomy.ts` assigns each a level. */
export type ActionKind =
  | 'research.enrich'
  | 'research.score'
  | 'content.draft'
  | 'content.localise'
  | 'outreach.schedule'
  | 'outreach.send_first_touch'
  | 'outreach.send_followup'
  | 'inbound.reply_from_catalog'
  | 'inbound.book_call'
  | 'crm.move_stage'
  | 'publish.post'
  | 'publish.post_naming_client'
  | 'proposal.send_engineering'
  | 'deal.accept_security_engagement'
  | 'deal.custom_pricing'
  | 'claims.credential'
  | 'ads.launch_campaign'
  | 'ads.raise_cap'
  | 'leads.add_source'
  | 'contact.suppressed_override';

export interface ActionRequest {
  kind: ActionKind;
  agent: AgentName;
  /** Human-readable summary for the digest and the audit entry. */
  summary: string;
  contactId?: string | undefined;
  channel?: Channel | undefined;
  /**
   * True when any input to this action came from outside our trust boundary — a fetched
   * page, an inbound reply, a social profile. Forces L2 regardless of the action's
   * registered level. See `src/agency/content/untrusted.ts`.
   */
  derivedFromUntrusted?: boolean | undefined;
  /** Estimated LLM tokens, metered against the ceiling. */
  estimatedTokens?: number | undefined;
  /** Ad spend in minor units, metered against the cap. */
  spendMinor?: number | undefined;
}

export type AgentName =
  | 'scout'
  | 'analyst'
  | 'writer'
  | 'operator'
  | 'responder'
  | 'publisher'
  | 'steward';

/** The outcome of putting an action through the dispatcher. */
export type Decision =
  | { outcome: 'executed'; level: Exclude<AutonomyLevel, 'L2'>; notify: boolean }
  | { outcome: 'queued_for_human'; level: 'L2'; reason: string }
  | { outcome: 'refused'; reason: string; code: RefusalCode };

export type RefusalCode =
  | 'kill_switch'
  | 'suppressed'
  | 'no_lawful_basis'
  | 'basis_incomplete'
  | 'no_channel_consent'
  | 'frequency_cap'
  | 'token_ceiling'
  | 'spend_ceiling'
  | 'unregistered_credential_claim'
  | 'phi_suspected';
