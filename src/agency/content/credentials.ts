/**
 * The credential register.
 *
 * The catalog is explicit that this market checks: *"buyers at this price point ask who
 * performed the testing and what certifications they hold."* A fabricated certification
 * claim is fraud, and it is fraud in precisely the sentence a buyer verifies first.
 *
 * So credential claims are **not generated**. They are drawn from this frozen register by
 * key, and any copy leaving the Writer is scanned for claims that are not in it. A model
 * asked to write persuasively about security expertise will, sooner or later, invent a
 * certification — the register is what makes that a caught error rather than a published
 * one.
 */

export interface Credential {
  key: string;
  /** The exact wording that may be published. Not a summary to paraphrase. */
  claim: string;
  /** How it can be checked, if a buyer asks. */
  evidence: string;
}

/**
 * Verified claims only. Adding an entry is a human act with evidence attached — it is an
 * L2 action (`claims.credential`), not something an agent can extend.
 */
export const CREDENTIAL_REGISTER: readonly Credential[] = Object.freeze([
  Object.freeze({
    key: 'ms-cybersecurity',
    claim: 'M.S. in Cybersecurity',
    evidence: 'Degree certificate on file',
  }),
  Object.freeze({
    key: 'security-plus',
    claim: 'CompTIA Security+',
    evidence: 'Certification ID on file',
  }),
  Object.freeze({
    key: 'production-platform',
    claim: 'a compliance platform we run in production ourselves',
    evidence: 'NeVral, deployed and operating',
  }),
]);

export const credentialByKey = (key: string): Credential | undefined =>
  CREDENTIAL_REGISTER.find((c) => c.key === key);

/**
 * Certifications and qualifications that would be a lie if they appeared.
 *
 * Deliberately a denylist of the specific high-value claims a model is most likely to
 * reach for when writing security marketing copy, rather than an attempt to detect all
 * possible false statements — which is not achievable and would produce false positives
 * on ordinary prose.
 */
const KNOWN_CLAIM_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bOSCP\b/i, label: 'OSCP' },
  { pattern: /\bCISSP\b/i, label: 'CISSP' },
  { pattern: /\bCISM\b/i, label: 'CISM' },
  { pattern: /\bCEH\b/i, label: 'CEH' },
  { pattern: /\bCISA\b/i, label: 'CISA' },
  { pattern: /\bGPEN\b/i, label: 'GPEN' },
  { pattern: /\bGIAC\b/i, label: 'GIAC' },
  { pattern: /\bPh\.?D\b/i, label: 'PhD' },
  { pattern: /\bISO\s*27001\s+(certified|accredited)\b/i, label: 'ISO 27001 certification' },
  { pattern: /\bSOC\s*2\s+(certified|accredited)\b/i, label: 'SOC 2 certification' },
  { pattern: /\bcertified\s+ethical\s+hacker\b/i, label: 'Certified Ethical Hacker' },
];

export interface ClaimScanResult {
  ok: boolean;
  /** Claims found in the copy that are not in the register. */
  unregistered: string[];
}

/**
 * Scan copy for credential claims that are not in the register.
 *
 * Note what this does *not* do: it does not try to verify that registered claims are used
 * accurately, and it does not read intent. It answers one narrow, checkable question —
 * does this text assert a qualification we have not recorded evidence for.
 */
export function scanForUnregisteredClaims(copy: string): ClaimScanResult {
  const registered = CREDENTIAL_REGISTER.map((c) => c.claim.toLowerCase());
  const unregistered: string[] = [];

  for (const { pattern, label } of KNOWN_CLAIM_PATTERNS) {
    if (!pattern.test(copy)) continue;
    // A pattern that is part of a registered claim is fine — "SOC 2 Type I readiness" is
    // a service we sell, distinct from asserting we are SOC 2 certified.
    const isRegistered = registered.some((claim) => pattern.test(claim));
    if (!isRegistered) unregistered.push(label);
  }

  return { ok: unregistered.length === 0, unregistered: [...new Set(unregistered)] };
}

/** Assemble a credential line from register keys. The only sanctioned way to state one. */
export function renderCredentials(keys: readonly string[]): string {
  const claims = keys
    .map((k) => credentialByKey(k))
    .filter((c): c is Credential => c !== undefined)
    .map((c) => c.claim);
  if (claims.length === 0) return '';
  if (claims.length === 1) return claims[0]!;
  return `${claims.slice(0, -1).join(', ')} and ${claims[claims.length - 1]!}`;
}
