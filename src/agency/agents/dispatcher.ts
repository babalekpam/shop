/**
 * The dispatcher.
 *
 * Every agent action passes through here, and this is the only place an action can become
 * an effect. Agents propose; the dispatcher decides. That separation is what makes the
 * system auditable — there is one chokepoint to reason about rather than seven.
 *
 * Order of operations, and why:
 *
 *   1. **Compliance gate** — refusals are cheapest and most absolute.
 *   2. **Effective autonomy level** — taint dominates the registry, so anything derived
 *      from external content is demoted to human review before it can execute.
 *   3. **Execute or queue.**
 *   4. **Audit, always** — including refusals, which are the entries that matter most
 *      when explaining what the system did not do.
 *
 * Spec §3.
 */

import { effectiveLevel, isOutbound } from '../domain/autonomy';
import type { ActionRequest, Contact, Decision } from '../domain/types';
import type { ComplianceGate } from '../compliance/gate';
import type { AuditLog } from '../audit';
import type { BudgetLedger } from '../budget';
import type { AgencyStore } from '../store';
import { scanForPhi, redactForLog } from '../content/phi';

export interface PendingApproval {
  request: ActionRequest;
  reason: string;
  queuedAt: string;
}

export interface DispatcherDeps {
  store: AgencyStore;
  gate: ComplianceGate;
  audit: AuditLog;
  ledger: BudgetLedger;
  /** Performs the effect. Absent for a dry run. */
  execute?: (request: ActionRequest, contact?: Contact) => Promise<void>;
}

export class Dispatcher {
  /** Actions awaiting a human. Read by the approval queue UI. */
  readonly pending: PendingApproval[] = [];
  /** L1 actions that executed and owe the operator a line in the digest. */
  readonly digest: ActionRequest[] = [];

  constructor(private readonly deps: DispatcherDeps) {}

  async dispatch(request: ActionRequest, contact?: Contact): Promise<Decision> {
    // A PHI tripwire on anything that would be persisted or sent. Clinical text can
    // arrive from a clinic's reply without anyone intending it; it must not reach a log,
    // a prompt, or an outbound message. (Security spec §0.)
    const phi = scanForPhi(`${request.summary}`);
    if (phi.suspected) {
      const decision: Decision = {
        outcome: 'refused',
        reason: 'clinical language detected; routed to human handling',
        code: 'phi_suspected',
      };
      this.deps.audit.append({
        agent: request.agent,
        actionKind: request.kind,
        outcome: 'refused:phi_suspected',
        detail: redactForLog(request.summary),
      });
      return decision;
    }

    const verdict = this.deps.gate.evaluate(request, contact);
    if (!verdict.allowed) {
      this.deps.audit.append({
        agent: request.agent,
        actionKind: request.kind,
        outcome: `refused:${verdict.code}`,
        detail: verdict.reason,
      });
      return { outcome: 'refused', reason: verdict.reason, code: verdict.code };
    }

    const level = effectiveLevel(request.kind, request.derivedFromUntrusted);

    if (level === 'L2') {
      const reason = request.derivedFromUntrusted
        ? 'derived from untrusted external content; requires human review'
        : 'action requires human approval';
      this.pending.push({ request, reason, queuedAt: new Date().toISOString() });
      this.deps.audit.append({
        agent: request.agent,
        actionKind: request.kind,
        outcome: 'queued_for_human',
        detail: reason,
      });
      return { outcome: 'queued_for_human', level: 'L2', reason };
    }

    if (this.deps.execute) {
      await this.deps.execute(request, contact);
    }

    // Metering happens after the effect, because that is when the cost is real.
    if (request.estimatedTokens) this.deps.ledger.record('tokens', request.estimatedTokens);
    if (request.spendMinor) this.deps.ledger.record('ad_spend_minor', request.spendMinor);

    // Frequency accounting only counts things that reached a person.
    if (isOutbound(request.kind) && contact && request.channel) {
      this.deps.store.recordTouch({
        contactId: contact.id,
        channel: request.channel,
        actionKind: request.kind,
        sentAt: new Date().toISOString(),
      });
    }

    if (level === 'L1') this.digest.push(request);

    this.deps.audit.append({
      agent: request.agent,
      actionKind: request.kind,
      outcome: `executed:${level}`,
      detail: request.summary,
    });

    return { outcome: 'executed', level, notify: level === 'L1' };
  }
}
