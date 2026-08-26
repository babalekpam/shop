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
crm/         Node CRM port, HTTP adapter, configurable mapping, sync
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

## Connecting Node CRM

```bash
NODE_CRM_URL=https://crm.example NODE_CRM_TOKEN=... npm run agency:crm-check
```

Skips cleanly with no credentials, probes a live instance with them.

Node CRM's exact API surface is an open question in the spec (§13.3), so the adapter is
driven by `crm/mapping.ts` rather than hard-coded. If Node CRM calls the field
`company_name`, that is one line of `NODE_CRM_MAPPING` rather than a client rewrite. The
defaults are a conventional REST shape and **they are assumptions** — the check is how you
find out which are wrong.

Two rules the sync exists to hold:

**Suppression is never delegated and never mirrored.** Sends read it from the local store,
always. The CRM can contribute suppressions; they flow one way, and only ever adding.
There is no path that removes a local suppression because the CRM stopped listing it — a
deleted row or a botched migration must not return someone to the pool after they
objected. A CRM outage therefore cannot enable a send: stale-but-present is safe.

**Only enumerated fields cross the boundary.** A CRM is where people put free text and
NaviMED prospects are clinics, so a `notes` column on the other side has nowhere to land
here. Asserted by a test that feeds the client a record containing clinical text.

## Next

Phase 2 is Scout/Analyst/Writer producing real drafts, which needs a `Reasoner`. Phase 3
is email, which needs a sending domain separate from `argilette.shop` —
`assertDomainSeparation()` refuses to start otherwise, because degraded outbound
reputation would stop licence keys reaching paying customers.
