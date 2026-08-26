/**
 * The seven agents.
 *
 * Each is bounded: its own inputs, its own permitted actions, its own audit identity. One
 * agent with a large toolbelt is not something you can reason about when it misbehaves;
 * seven narrow ones are. (Spec §2.)
 *
 * These are the *deterministic shells* — the part that decides what to propose and what an
 * agent is structurally forbidden from proposing. The model call that produces prose sits
 * behind `Reasoner`, so the policy in this file is testable without a model, and swapping
 * models cannot quietly change what an agent is allowed to do.
 */

import type { ActionKind, ActionRequest, AgentName, Contact } from '../domain/types';
import type { TaintedContent } from '../content/untrusted';
import { looksLikeInjection, renderForPrompt } from '../content/untrusted';
import { renderCredentials, scanForUnregisteredClaims } from '../content/credentials';

/** The model call. Injected so the team is testable, and swappable per agent. */
export interface Reasoner {
  complete(prompt: string, options?: { maxTokens?: number }): Promise<string>;
}

/** A reasoner that refuses to run. The default, so nothing calls a model by accident. */
export class NullReasoner implements Reasoner {
  async complete(): Promise<string> {
    throw new Error('no reasoner configured');
  }
}

export abstract class Agent {
  abstract readonly name: AgentName;
  /** Exactly what this agent may ask for. Anything else throws before dispatch. */
  abstract readonly permitted: ReadonlySet<ActionKind>;

  constructor(protected readonly reasoner: Reasoner = new NullReasoner()) {}

  /**
   * Build a request, checking it against this agent's own remit first.
   *
   * The check is not defence against an attacker — an agent is our code. It is defence
   * against drift: it makes "the Writer started sending things" a loud failure at the
   * moment it is introduced, rather than a behaviour discovered in production.
   */
  protected propose(request: Omit<ActionRequest, 'agent'>): ActionRequest {
    if (!this.permitted.has(request.kind)) {
      throw new Error(`${this.name} may not propose ${request.kind}`);
    }
    return { ...request, agent: this.name };
  }
}

/** Finds and enriches accounts. Contacts nobody. */
export class Scout extends Agent {
  readonly name = 'scout' as const;
  readonly permitted = new Set<ActionKind>(['research.enrich', 'leads.add_source']);

  enrich(organisation: string, evidence: TaintedContent): ActionRequest {
    // Research reads company websites — untrusted by definition. The taint rides along on
    // the request and demotes it to review if it ever drives something consequential.
    return this.propose({
      kind: 'research.enrich',
      summary: `enrich ${organisation} from ${evidence.source.origin}`,
      derivedFromUntrusted: true,
      estimatedTokens: 800,
    });
  }

  /** Adding a lead source is L2 — new sources are where legal exposure enters. */
  addSource(name: string): ActionRequest {
    return this.propose({ kind: 'leads.add_source', summary: `add lead source: ${name}` });
  }
}

/** Scores and prioritises. Writes no customer-facing copy. */
export class Analyst extends Agent {
  readonly name = 'analyst' as const;
  readonly permitted = new Set<ActionKind>(['research.score', 'crm.move_stage']);

  score(contact: Contact): ActionRequest {
    return this.propose({
      kind: 'research.score',
      summary: `score ${contact.organisation}`,
      contactId: contact.id,
      estimatedTokens: 400,
    });
  }

  moveStage(contact: Contact, stage: string): ActionRequest {
    return this.propose({
      kind: 'crm.move_stage',
      summary: `move ${contact.organisation} to ${stage}`,
      contactId: contact.id,
    });
  }
}

export interface DraftResult {
  copy: string;
  /** Set when the copy asserted a credential we have no evidence for. */
  rejected?: string[] | undefined;
}

/** Writes. Sends nothing. */
export class Writer extends Agent {
  readonly name = 'writer' as const;
  readonly permitted = new Set<ActionKind>(['content.draft', 'content.localise']);

  draft(topic: string): ActionRequest {
    return this.propose({
      kind: 'content.draft',
      summary: `draft copy: ${topic}`,
      estimatedTokens: 1500,
    });
  }

  /**
   * Produce copy and refuse to return it if it invents a credential.
   *
   * The register is assembled separately and appended, so the model never has to be
   * trusted to reproduce a certification name correctly — it is not asked to.
   */
  async compose(prompt: string, credentialKeys: readonly string[] = []): Promise<DraftResult> {
    const copy = await this.reasoner.complete(prompt);
    const scan = scanForUnregisteredClaims(copy);
    if (!scan.ok) {
      return { copy: '', rejected: scan.unregistered };
    }
    const credentials = renderCredentials(credentialKeys);
    return { copy: credentials ? `${copy}\n\n${credentials}` : copy };
  }
}

/** Sends. Composes nothing from scratch. */
export class Operator extends Agent {
  readonly name = 'operator' as const;
  readonly permitted = new Set<ActionKind>([
    'outreach.schedule',
    'outreach.send_first_touch',
    'outreach.send_followup',
    'proposal.send_engineering',
  ]);

  firstTouch(contact: Contact, channel: ActionRequest['channel']): ActionRequest {
    return this.propose({
      kind: 'outreach.send_first_touch',
      summary: `first touch to ${contact.organisation}`,
      contactId: contact.id,
      channel,
    });
  }

  followUp(contact: Contact, channel: ActionRequest['channel']): ActionRequest {
    return this.propose({
      kind: 'outreach.send_followup',
      summary: `follow up with ${contact.organisation}`,
      contactId: contact.id,
      channel,
    });
  }
}

/** Handles inbound. Does not discuss price above the self-serve tier. */
export class Responder extends Agent {
  readonly name = 'responder' as const;
  readonly permitted = new Set<ActionKind>([
    'inbound.reply_from_catalog',
    'inbound.book_call',
    'deal.accept_security_engagement',
    'deal.custom_pricing',
  ]);

  /**
   * Handle an inbound reply.
   *
   * The reply is untrusted, so the resulting action carries taint and cannot execute
   * autonomously however benign the registered level. An injected instruction inside a
   * reply can therefore change what is *proposed*, and can never cause a send.
   */
  handleReply(contact: Contact, reply: TaintedContent): ActionRequest {
    const suspicious = looksLikeInjection(reply.value);
    return this.propose({
      kind: 'inbound.reply_from_catalog',
      summary: suspicious
        ? `inbound reply from ${contact.organisation} (possible injection attempt)`
        : `inbound reply from ${contact.organisation}`,
      contactId: contact.id,
      derivedFromUntrusted: true,
      estimatedTokens: 600,
    });
  }

  /** Always L2. The authorization check is a legal precondition, not a formality. */
  acceptSecurityEngagement(contact: Contact, sku: string): ActionRequest {
    return this.propose({
      kind: 'deal.accept_security_engagement',
      summary: `accept ${sku} for ${contact.organisation} — requires authorization check`,
      contactId: contact.id,
    });
  }

  /** Render an inbound message for a prompt, fenced and neutralised. */
  promptFor(reply: TaintedContent): string {
    return renderForPrompt(reply);
  }
}

/** Publishes organic content. Never names a client without approval. */
export class Publisher extends Agent {
  readonly name = 'publisher' as const;
  readonly permitted = new Set<ActionKind>(['publish.post', 'publish.post_naming_client']);

  post(topic: string, namesClient = false): ActionRequest {
    return this.propose({
      kind: namesClient ? 'publish.post_naming_client' : 'publish.post',
      summary: `publish: ${topic}`,
      channel: 'linkedin',
    });
  }
}

/** Compliance, suppression, DSAR, audit. Deliberately not a persuasive agent. */
export class Steward extends Agent {
  readonly name = 'steward' as const;
  readonly permitted = new Set<ActionKind>(['contact.suppressed_override', 'claims.credential']);

  /** Even the Steward cannot lift a suppression alone. */
  requestSuppressionOverride(identifier: string, justification: string): ActionRequest {
    return this.propose({
      kind: 'contact.suppressed_override',
      summary: `override suppression for ${identifier}: ${justification}`,
    });
  }

  registerCredential(claim: string): ActionRequest {
    return this.propose({
      kind: 'claims.credential',
      summary: `register credential claim: ${claim}`,
    });
  }
}

export interface Team {
  scout: Scout;
  analyst: Analyst;
  writer: Writer;
  operator: Operator;
  responder: Responder;
  publisher: Publisher;
  steward: Steward;
}

export function createTeam(reasoner: Reasoner = new NullReasoner()): Team {
  return {
    scout: new Scout(reasoner),
    analyst: new Analyst(reasoner),
    writer: new Writer(reasoner),
    operator: new Operator(reasoner),
    responder: new Responder(reasoner),
    publisher: new Publisher(reasoner),
    steward: new Steward(reasoner),
  };
}
