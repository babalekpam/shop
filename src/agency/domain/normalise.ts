/**
 * Identifier normalisation.
 *
 * Suppression is only as good as the key it is stored under. `Ada@Example.COM` and
 * `ada@example.com` are the same person, and a system that treats them as two will mail
 * someone who asked it not to. Normalisation happens once, here, and both the suppression
 * store and the contact record use it.
 */

/**
 * Lowercase and trim. Deliberately does **not** strip gmail-style dots or `+tags`:
 * those are provider-specific, and guessing wrong merges two real people into one record.
 * Over-suppressing is recoverable; under-suppressing is a complaint.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Digits and a leading `+` only, so formatting differences cannot split a person in two. */
export function normalisePhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

/** The suppression key for any identifier we might hold. */
export function suppressionKey(identifier: string): string {
  return identifier.includes('@') ? normaliseEmail(identifier) : normalisePhone(identifier);
}
