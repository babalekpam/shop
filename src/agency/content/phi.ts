/**
 * PHI tripwire.
 *
 * The storefront's absolute rule (security spec §0) extends here: no patient data enters
 * any ARGILETTE commercial system. The agency's exposure is different from the store's —
 * it *reads* clinic websites and receives replies from clinic staff, so clinical text can
 * arrive without anyone intending it. A reply that says "our patient Ama Kofi missed her
 * appointment, can we reschedule the demo" is entirely plausible.
 *
 * There is no PHI-capable column in the schema, so this cannot be *stored*. This tripwire
 * catches it before it reaches a log line, a prompt, or an audit detail.
 *
 * It is a coarse signal, not a classifier. Its bias is deliberately toward flagging for
 * human handling, because the cost of a false positive is one reviewed message and the
 * cost of a false negative is a category of data we promise never to hold.
 */

const CLINICAL_MARKERS: readonly RegExp[] = [
  /\bpatient(s)?\b/i,
  /\bdiagnos(is|ed|tic)\b/i,
  /\bprescri(be|bed|ption)\b/i,
  /\bmedical\s+record\b/i,
  /\bdossier\s+m[ée]dical\b/i,
  /\bordonnance\b/i,
  /\bsympt(o|ô)m(e|es|s)?\b/i,
  /\btreatment\s+plan\b/i,
  /\bblood\s+(test|pressure|sugar)\b/i,
  /\bHIV|VIH\b/,
  /\bpregnan(t|cy)\b/i,
  /\ballerg(y|ies|ique)\b/i,
];

export interface PhiScanResult {
  suspected: boolean;
  markers: string[];
}

/**
 * Look for clinical language.
 *
 * "Patient" alone is enough to flag. In a sales context aimed at clinics the word appears
 * legitimately — "your patients" in marketing copy — which is exactly why flagged content
 * goes to a human rather than being dropped: the system does not try to decide which
 * mention is which.
 */
export function scanForPhi(text: string): PhiScanResult {
  const markers = CLINICAL_MARKERS.filter((p) => p.test(text)).map((p) => p.source);
  return { suspected: markers.length > 0, markers };
}

/**
 * Reduce text to something safe to put in a log or an audit detail.
 *
 * Never the content itself. Length and a hash are enough to correlate two occurrences of
 * the same message without retaining a word of it.
 */
export function redactForLog(text: string): string {
  return `[redacted ${text.length} chars]`;
}
