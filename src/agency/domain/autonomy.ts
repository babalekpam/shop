/**
 * The autonomy registry — which actions the team may take alone.
 *
 * This table is the system's whole safety posture in one place, which is deliberate: a
 * policy spread across seven agent prompts is a policy nobody can audit. Changing a level
 * here is a reviewable diff.
 *
 * See docs/specs/argilette-agency-spec.md §3.
 */

import type { ActionKind, AutonomyLevel } from './types';

/**
 * The seven L2 gates from spec §3.1 are the entries that read `L2` below. They are
 * `const` and there is no setter — an agent cannot lower its own gate, which is the point.
 */
export const ACTION_AUTONOMY: Readonly<Record<ActionKind, AutonomyLevel>> = Object.freeze({
  // L0 — acts, logged, no notification. Nothing here reaches a customer.
  'research.enrich': 'L0',
  'research.score': 'L0',
  'content.draft': 'L0',
  'content.localise': 'L0',
  'outreach.schedule': 'L0',
  'inbound.reply_from_catalog': 'L0',
  'inbound.book_call': 'L0',

  // L1 — acts, then notifies. Reversible within a window.
  'outreach.send_first_touch': 'L1',
  'outreach.send_followup': 'L1',
  'crm.move_stage': 'L1',
  'publish.post': 'L1',
  'proposal.send_engineering': 'L1',

  // L2 — a human decides. Spec §3.1.
  //
  // The first of these is the most important line in the system. A penetration test
  // accepted without a human verifying the client is authorised to have the target
  // tested sells ARGILETTE into unauthorised access to a third party's systems. The
  // draft Terms already require that warranty; this is what makes it true in code.
  'deal.accept_security_engagement': 'L2',
  'claims.credential': 'L2',
  'deal.custom_pricing': 'L2',
  'ads.launch_campaign': 'L2',
  'ads.raise_cap': 'L2',
  'leads.add_source': 'L2',
  'publish.post_naming_client': 'L2',
  'contact.suppressed_override': 'L2',
});

/**
 * The level an action actually runs at.
 *
 * Taint dominates the registry: anything derived from content we did not author cannot
 * act autonomously, however innocuous its registered level. This is the structural answer
 * to prompt injection — an instruction smuggled into an inbound reply cannot cause a send,
 * because the resulting action is no longer eligible to execute. (Spec §10.)
 */
export function effectiveLevel(kind: ActionKind, derivedFromUntrusted = false): AutonomyLevel {
  const registered = ACTION_AUTONOMY[kind];
  if (derivedFromUntrusted) return 'L2';
  return registered;
}

/** Actions that put something in front of a human being. Used for frequency accounting. */
export const OUTBOUND_ACTIONS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  'outreach.send_first_touch',
  'outreach.send_followup',
  'proposal.send_engineering',
]);

export const isOutbound = (kind: ActionKind): boolean => OUTBOUND_ACTIONS.has(kind);
