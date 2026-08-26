# ARGILETTE Agency — Phase 1

Implements the compliance spine and agent framework from
[`docs/specs/argilette-agency-spec.md`](../../docs/specs/argilette-agency-spec.md).

```
domain/      Types, the autonomy registry, identifier normalisation
store/       SQLite-backed store + schema. Constraints, not conventions.
compliance/  The send gate and the kill switch
audit/       Merkle-chained, tamper-evident log
budget/      Token and ad-spend ceilings
content/     Taint tracking, credential register, PHI tripwire
agents/      The seven agents and the dispatcher
channels/    Transports behind one interface, with a recording double
```

## What is real

Everything here runs and is tested — 43 tests, against a real database with real
constraints. `node:sqlite` ships with Node, so there is no native build step and the
constraints in `store/schema.sql` are genuinely exercised rather than asserted in prose.

The Postgres deployment mirrors that schema. Swapping the store is one adapter.

## What is not

The three transports (`channels/transport.ts`) have no provider implementation. They are
complete up to the network call and **refuse rather than pretend** when unconfigured —
the same discipline as the storefront's checkout returning 501. A half-configured
deployment that appears to be sending is worse than one that plainly is not.

`Reasoner` is the model call. It defaults to `NullReasoner`, which throws, so nothing
calls a model by accident. The policy in `agents/team.ts` is deterministic and testable
without one — which means swapping models cannot quietly change what an agent may do.

## The three things to understand before changing anything

**1. The gate is code, not a prompt.** An agent *instructed* not to contact a suppressed
address will eventually contact one. Suppression is a `PRIMARY KEY`, lawful basis is a
`CHECK` constraint, and both are checked in the send path. Do not move these into a
system prompt.

**2. Taint dominates the autonomy registry.** Anything derived from content we did not
author — a fetched page, an inbound reply — is forced to L2 human review however innocuous
its registered level. This is the structural answer to prompt injection: an injected
instruction can change what an agent *proposes* and can never cause a send. Removing that
one line in `domain/autonomy.ts` fails two tests, by design.

**3. `deal.accept_security_engagement` is L2 and must stay L2.** A penetration test
accepted without a human verifying the client is authorised to have the target tested
sells ARGILETTE into unauthorised access to a third party's systems. The draft Terms
already require that warranty; the gate is what makes it true.

## Next

Phase 2 is Scout/Analyst/Writer producing real drafts, which needs a `Reasoner`. Phase 3
is email, which needs a sending domain separate from `argilette.shop` —
`assertDomainSeparation()` refuses to start otherwise, because degraded outbound
reputation would stop licence keys reaching paying customers.
