# ARGILETTE.shop — Security Specification

**Version:** 1.0
**Companion to:** ARGILETTE.shop Build Specification v2.0
**Target standard:** OWASP ASVS Level 2, with Level 3 controls on the entitlement service

---

## 0. The Most Important Decision

**No patient data enters the storefront. Ever.**

ARGILETTE.shop sells NaviMED subscriptions. It must never store, process, transit, or log protected health information. The store knows: *this clinic pays for the Clinique plan, 15 seats, through 15 September.* It does not know a single patient name, diagnosis, or record.

This one boundary is worth more than every control below it combined. It means:

- The storefront falls outside HIPAA's definition of a covered entity or business associate function for PHI
- A full compromise of the store leaks billing data — bad, recoverable — not medical records
- The audit surface stays small enough for a small team to actually defend

**Enforcement is architectural, not procedural.** The storefront database has no PHI-capable columns. The entitlement API returns entitlement state only, never clinical payloads. Any pull request adding a free-text field that could receive clinical data is rejected at review. Write this rule into `CONTRIBUTING.md` and make it a named reviewer responsibility.

The one place the boundary is genuinely thin: Keycloak is shared identity between the store and NaviMED. Section 4 addresses that specifically.

---

## 1. Data Classification

| Class | Examples | Controls |
|---|---|---|
| **Restricted** | Service tokens, webhook secrets, license key material, Keycloak client secrets | Vault-managed, rotated, never logged, break-glass access only |
| **Confidential** | Customer email, billing address, order history, entitlement state | Encrypted at rest, RBAC, access logged |
| **Internal** | Product catalog, pricing, FX snapshots, translations | Standard access control |
| **Public** | Marketing copy, public plan pricing | None |
| **Prohibited** | Any PHI, full card numbers, government ID numbers | **Must not exist in this system** |

If a field cannot be classified, it does not ship.

---

## 2. Regulatory Surface

| Regime | Trigger | Obligation |
|---|---|---|
| **HIPAA** | US healthcare customers | Avoided for the store by the Section 0 boundary. NaviMED itself remains in scope — BAAs required with every vendor touching PHI there. |
| **GDPR** | Any EU-resident data subject | Lawful basis, DSAR handling, 72-hour breach notification to the supervisory authority, DPA with each processor |
| **Nigeria NDPA** | Nigerian data subjects | Registration and local compliance obligations |
| **Togo / UEMOA data protection** | Togolese and regional data subjects | Notification/registration with the national authority |
| **PCI-DSS** | Card payments | Reduced to **SAQ-A** — see Section 6 |
| **US state privacy laws** | California and similar | Deletion and opt-out rights |

**Get local counsel for the African jurisdictions.** Requirements there have moved quickly and vary by country; do not have engineers infer obligations from blog posts. Budget for a compliance review before launch, not after.

---

## 3. Threat Model

Adversaries worth designing against, in priority order:

1. **Opportunistic automated attackers** — credential stuffing, known-CVE scanning, bot carding. Highest volume by far.
2. **Payment fraudsters** — stolen cards to obtain license keys or downloads for resale; mobile-money social engineering.
3. **Entitlement forgers** — the highest-value target. Forging an entitlement response grants free access to every ARGILETTE product simultaneously.
4. **Malicious or compromised insiders** — admin console holds grant/revoke power across the portfolio.
5. **Supply-chain attackers** — a compromised npm dependency in a checkout path.

Explicitly **out of scope**: nation-state targeted attack. Defending that with this team size is not achievable, and pretending otherwise produces security theatre instead of working controls.

---

## 4. Identity & Access

### Keycloak hardening
- Separate realm for ARGILETTE customer identity; **separate client per product**, minimum scopes each
- Authorization Code flow with PKCE. No implicit flow, no ROPC.
- Short access-token TTL (5 min); refresh tokens rotated on use with reuse detection
- Brute-force detection enabled; progressive lockout
- Password policy: length-first (12+ minimum), breached-password screening. Do not enforce forced periodic rotation — it demonstrably drives weaker passwords.
- Keycloak instance patched on a defined cadence; admin console **never** exposed to the public internet — bind to VPN or IP allowlist

### The shared-identity boundary
Keycloak spans the store and NaviMED, which is the one place Section 0's wall is thin. Controls:
- Store and NaviMED are distinct clients with **non-overlapping scopes**. A store-issued token must be rejected by NaviMED's PHI endpoints, and this must be tested, not assumed.
- No claim carrying clinical meaning appears in any token the store can read
- Token audience (`aud`) validated strictly by every consuming service

### MFA
- **Mandatory** for all admin and staff accounts, no exceptions and no grace period
- Offered and strongly encouraged for customer accounts; mandatory for accounts holding clinic-level entitlements
- TOTP and WebAuthn/passkeys. **SMS as a fallback only** — SIM-swap risk is materially higher in several target markets, and it should not be the sole factor for any privileged account.

### Authorization
- RBAC via Keycloak realm roles, enforced in **server-side middleware**. Client-side route guards are UX, not security.
- Every admin mutation authorized on the specific object, not just the route — a role check that lets an admin edit *any* order is not the same as one scoped to what they should touch
- Principle of least privilege on database users: the app connects with a role that cannot `DROP`, cannot read the audit log, and cannot alter schema

---

## 5. Application Security

Target: **OWASP ASVS Level 2** across the app, **Level 3** on the entitlement service and admin console.

- **Input validation** at the boundary with a schema validator (Zod), typed end to end. Reject-by-default, never sanitize-and-proceed.
- **SQL injection**: parameterized queries only via Drizzle. Raw SQL requires named reviewer approval and a comment justifying it.
- **XSS**: React's default escaping; `dangerouslySetInnerHTML` is banned by lint rule. Any exception needs DOMPurify and review.
- **CSRF**: SameSite=Lax cookies plus anti-CSRF tokens on state-changing forms.
- **SSRF**: the FX provider and gateway calls are the egress paths. Allowlist destination hosts explicitly; block link-local and private ranges.
- **IDOR**: every object fetch scoped by `customer_id` from the session, never from a request parameter. This is the single most common real-world breach in commerce apps — test it deliberately.
- **Mass assignment**: explicit field allowlists on every write. Never spread a request body into an ORM call.
- **Open redirect**: post-checkout and post-login redirects validated against an internal allowlist.

### Headers
Strict CSP with nonces, no `unsafe-inline`. HSTS with preload. `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive `Permissions-Policy`. Paddle's checkout domain is the only third-party script origin permitted — audit any addition.

---

## 6. Payment Security

**PCI scope minimization is the strategy.** Card data never touches ARGILETTE infrastructure. Paddle is merchant of record and hosts the payment fields; CinetPay hosts its own. No PAN, CVV, or expiry ever reaches our servers, logs, or database.

This qualifies the store for **SAQ-A**, the lightest PCI validation tier. Protect that status deliberately — any change that puts a card field in our DOM, including a "quick" custom checkout, escalates scope to SAQ-A-EP and multiplies the compliance burden. Treat that as an architectural decision requiring sign-off, not a frontend ticket.

### Fraud controls
- Velocity limits per IP, per email, per card fingerprint from the gateway
- Digital downloads and license keys are the fraud magnet: cap activations, watch for one customer generating many keys, and flag rapid-fire small purchases
- Mobile money: confirm against CinetPay's verification endpoint server-side. Never grant on a notify payload alone.
- Chargeback webhook → immediate entitlement suspension, with manual review before permanent revocation

---

## 7. Entitlement API — Highest-Value Target

Forging one response unlocks every ARGILETTE product. Treat it as the crown jewel.

- **Per-product service tokens**, high entropy, stored hashed, independently revocable, rotated on a fixed schedule
- **mTLS between the entitlement service and consuming products** where deployment allows. Bearer tokens alone are a single stolen secret away from full compromise.
- Responses **signed** (detached JWS) so a consuming product verifies authenticity independent of transport
- Short-lived signed responses with an issued-at claim; consumers reject anything beyond a defined skew to prevent replay
- Rate limited per token; anomalous query volume alerts
- Every entitlement lookup logged with token identity, product, and customer

### Correcting a v2.0 design decision

The build spec says the entitlement API "fails open" for 72 hours during an outage. That is correct for **availability** but wrong as an unqualified rule for **security**. Split the two cases:

| Revocation reason | Behaviour |
|---|---|
| Billing lapse, expiry, downgrade | Fail open — honour last-known-good up to 72h |
| **Security event** — compromised account, fraud, chargeback, admin revocation for cause | **Fail closed immediately.** Push revocation to consumers; bypass all caching. |

Implement this as an explicit revocation reason on the entitlement record, with a push channel for security-class revocations rather than waiting on cache expiry. A clinic should not lose records over a failed charge — but a compromised account must lose access in seconds, not days.

---

## 8. Webhooks

- Signature verification mandatory on Paddle and CinetPay. **Unsigned or invalid-signature requests are dropped and alerted on**, never processed "just in case."
- Timestamp validation to reject replayed deliveries beyond a short window
- Idempotency keyed on `gateway_event_id`, enforced by a unique constraint at the database level — not application logic alone, which races under concurrent delivery
- Handlers run inside a transaction; partial application is impossible
- Failed events land in a dead-letter queue with alerting and manual replay in admin
- Webhook endpoints rate limited and IP-allowlisted to published gateway ranges where the provider offers them

---

## 9. Cryptography & Secrets

- TLS 1.3 minimum, modern cipher suites only, HSTS preload. TLS 1.0/1.1 disabled.
- Encryption at rest: Neon-managed encryption plus **application-level field encryption** on billing addresses and any token material
- License keys stored as salted hashes (Argon2id). Shown in plaintext exactly once, at issuance.
- Secrets in a managed secret store, injected at runtime. Never in the repository, never in build logs, never in error messages. Enforce with a pre-commit secret scanner and a CI gate.
- Documented rotation schedule: gateway keys and service tokens quarterly, immediately on any suspected exposure or staff departure
- Signed URLs for downloads: 15-minute TTL, single-use where feasible, bound to the requesting customer

---

## 10. Logging, Audit & Monitoring

### Immutable audit trail
Every privileged action — entitlement grant, revoke, extend, price override, refund, role change, admin login — written to an append-only audit log.

Use the **Merkle-chained audit log pattern already built for Custos.** Each entry carries a hash of its predecessor, so any tampering is detectable. This is proven in your own codebase and is exactly the control an auditor wants to see.

Audit records are written by a database role the application cannot use to update or delete.

### What must never be logged
Card data, full license keys, session tokens, passwords, webhook secrets, and — per Section 0 — anything clinical. Add a log-scrubbing middleware and test it; the most common leak path is an unhandled exception serializing a whole request object.

### Monitoring & alerting
Alert on: authentication failure spikes, admin login from a new geography, entitlement API volume anomalies, webhook signature failures, FX snapshot staleness beyond 48h, chargeback rate crossing threshold, and any 5xx spike on checkout.

Route alerts to a channel a human actually reads at 2am. An alert nobody sees is a log line with extra steps.

---

## 11. Supply Chain

- Lockfiles committed; dependencies pinned to exact versions
- Automated dependency scanning (SCA) in CI, blocking merges on high and critical findings
- SBOM generated per release
- New dependencies require review: maintenance status, maintainer count, download trend. A checkout path is not the place to try an unmaintained package.
- No third-party scripts on checkout pages beyond the payment gateway itself. Analytics, chat widgets, and pixels do not belong on a page handling payment.

---

## 12. Testing & Assurance

| Activity | Cadence |
|---|---|
| SAST in CI | Every PR |
| Dependency scan (SCA) | Every PR + daily |
| DAST against staging | Weekly |
| Secret scanning | Pre-commit + CI |
| Penetration test | Before launch, then annually and after major architectural change |
| Access review | Quarterly |
| Restore-from-backup drill | Quarterly |
| Incident response tabletop | Twice yearly |

**Dogfood NeVral here.** You sell penetration testing, vulnerability management, and SOC 2 / HIPAA / PCI-DSS compliance automation. Running ARGILETTE.shop through your own platform validates the product, generates the compliance artefacts you need anyway, and gives you a reference deployment to show buyers. The one caveat: an independent third-party pentest before launch still carries weight your own tooling cannot substitute for, particularly with enterprise and healthcare buyers who will ask who performed it.

---

## 13. Backup & Recovery

- Automated encrypted backups, retention defined by policy, stored in a separate region
- **Restores tested quarterly.** An untested backup is a hypothesis, not a backup.
- Documented RTO and RPO — set them explicitly rather than discovering them mid-incident
- Point-in-time recovery enabled on the database

---

## 14. Incident Response

Written runbook, in the repository, before launch. Minimum contents:

- On-call rotation and escalation path with names and numbers
- Severity definitions and declaration criteria
- Containment steps: revoke service tokens, disable gateway keys, force global session invalidation
- Forensics: preserve the audit log and system state before remediation
- **Notification clocks** — GDPR requires supervisory-authority notification within 72 hours of awareness; HIPAA's breach rules run to 60 days for affected individuals; African jurisdictions vary. These deadlines start at *awareness*, so the clock is running while you are still diagnosing. Know them in advance.
- Post-incident review, blameless, with tracked remediation items

---

## 15. Pre-Launch Security Gate

Do not go live until every item passes:

- [ ] Independent penetration test completed; all critical and high findings remediated
- [ ] Confirmed: zero PHI-capable fields in the storefront schema
- [ ] Store-issued token verified rejected by NaviMED PHI endpoints
- [ ] MFA enforced on every admin account
- [ ] Keycloak admin console unreachable from the public internet
- [ ] All secrets in the secret store; repository history scanned clean
- [ ] Webhook signature verification tested with deliberately forged payloads
- [ ] Idempotency verified under concurrent duplicate webhook delivery
- [ ] Entitlement responses signed; forged response rejected by a consuming product
- [ ] Security-class revocation propagates in under 60 seconds, bypassing cache
- [ ] IDOR testing across every customer-scoped object
- [ ] CSP enforced with no `unsafe-inline`
- [ ] Audit log verified append-only and tamper-evident
- [ ] Log scrubbing verified against a forced unhandled exception
- [ ] Backup restore drill completed successfully
- [ ] Incident response runbook written, with named on-call
- [ ] PCI SAQ-A completed and signed
- [ ] Privacy policy and DPAs in place for every processor
- [ ] Local counsel sign-off for target African jurisdictions

---

## A Closing Note on "Top Tier"

Top tier is not a long list of controls. It is a small number of correct architectural decisions, enforced consistently, and verified by someone who did not build the system.

The three decisions that matter most here:

1. **PHI never enters the storefront** — removes the worst-case breach entirely
2. **Card data never touches our infrastructure** — removes PCI scope
3. **The entitlement service is treated as the crown jewel** — signed, mTLS where possible, immediately revocable for cause

Everything else in this document supports those three. If schedule pressure forces cuts, cut elsewhere.
