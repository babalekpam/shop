/**
 * Prospect list import.
 *
 * Built for the Togo private-health register, and general enough for the next list.
 *
 * Three findings from the data shaped this, and they are worth stating because they
 * contradict what a "lead list import" usually assumes:
 *
 * **1. This is a call list, not an email list.** 47% of the 359 facilities have a phone
 * and 3% have an email. An importer that fed these into email sequences would be working
 * with eleven records. The useful output is a prioritised call queue for a human.
 *
 * **2. Two thirds are sole practitioners, and their "business" number is a personal
 * mobile.** 227 of 359 are `Praticien individuel`, and 104 of the 169 numbers are Togolese
 * mobiles. A sole practitioner's mobile is personal data in a way a hospital switchboard
 * is not, and unsolicited commercial messages to personal mobiles generate more complaints
 * than any other channel. Those records are imported but marked ineligible for automated
 * outreach — a human may call them; the machine may not message them.
 *
 * **3. The licence renewal window is the real signal.** 19 facilities are already
 * operating on an expired licence and 36 more expire within six months. A facility facing
 * renewal has to engage with administration and record-keeping, which is exactly when
 * NaviMED is relevant. Nothing else in the file targets as well.
 *
 * On lawful basis: the catalog says of the lead lists, *"use them internally"* — internal
 * prospecting is the sanctioned use, and this is not the reselling it warns against. The
 * source is a public ministry register of licensed facilities, which is a strong
 * legitimate-interest position. It is still a position that needs writing down, so
 * `importProspects` refuses to run without an assessment reference. (Spec §6.1, §6.3.)
 */

import type { Contact, LawfulBasis } from '../domain/types';
import { normalisePhone } from '../domain/normalise';

/** A row as it comes out of the workbook, already normalised to our column names. */
export interface ProspectRow {
  ref: string;
  name: string;
  segment: string;
  tier: 'A' | 'B' | 'C' | string;
  score: number;
  ownerType: string;
  phone: string;
  phone2: string;
  email: string;
  phoneConfidence: string;
  phoneSource: string;
  city: string;
  district: string;
  region: string;
  licenceStatus: string;
  daysToExpiry: number | null;
}

/**
 * What kind of contact point we hold.
 *
 * The distinction drives eligibility, so it is a type rather than a comment.
 */
export type ContactPoint = 'institutional' | 'personal_mobile' | 'email_only' | 'none';

/**
 * Togo numbering: fixed lines begin 22/23, mobiles 7x/9x.
 *
 * A fixed line at a hospital is a switchboard. A mobile belonging to a sole practitioner
 * is that person's phone. The two deserve different treatment even though both sit in the
 * same column of the spreadsheet.
 */
export function classifyPhone(phone: string): 'fixed' | 'mobile' | 'unknown' {
  const digits = normalisePhone(phone).replace(/^\+?228/, '').replace(/\D/g, '');
  if (!digits) return 'unknown';
  if (digits.startsWith('2')) return 'fixed';
  if (/^[789]/.test(digits)) return 'mobile';
  return 'unknown';
}

const isIndividualPractitioner = (ownerType: string): boolean =>
  /praticien individuel/i.test(ownerType);

export function classifyContactPoint(row: ProspectRow): ContactPoint {
  const phone = row.phone.trim() || row.phone2.trim();
  if (phone) {
    const kind = classifyPhone(phone);
    // A mobile held by a sole practitioner is a personal number. A mobile listed for a
    // hospital is a duty phone — institutional in everything but numbering range.
    if (kind === 'mobile' && isIndividualPractitioner(row.ownerType)) return 'personal_mobile';
    return 'institutional';
  }
  if (row.email.trim()) return 'email_only';
  return 'none';
}

/**
 * Whether the automated channels may touch this record at all.
 *
 * Deliberately conservative. A human may call anyone in the list; the agency may only
 * *message* institutional contact points. The spec's §6.3 resolution was to use lists for
 * research and reach organisations through a published business contact — this is that
 * rule, made mechanical.
 */
export function eligibleForAutomatedOutreach(row: ProspectRow): boolean {
  const point = classifyContactPoint(row);
  if (point === 'personal_mobile' || point === 'none') return false;
  // A directory number nobody could corroborate is as likely to be someone else's.
  if (point === 'institutional' && /faible/i.test(row.phoneConfidence)) return false;
  return true;
}

export interface ImportOptions {
  /**
   * Reference to the written legitimate-interest assessment covering this source.
   *
   * Required. Importing 359 people's contact details is exactly the moment a lawful basis
   * has to exist on paper, and the schema will reject the rows anyway — failing here gives
   * a better error than a constraint violation 359 times.
   */
  assessmentRef: string;
  /** Where the list came from, recorded per contact. */
  provenance: string;
  /** Import only rows the automated channels may actually use. */
  automatedOnly?: boolean | undefined;
  locale?: string | undefined;
}

export interface ImportResult {
  contacts: Contact[];
  /** Rows deliberately not imported, and why. Reported rather than silently dropped. */
  excluded: Array<{ ref: string; name: string; reason: string }>;
  stats: {
    total: number;
    institutional: number;
    personalMobile: number;
    emailOnly: number;
    noContactPoint: number;
  };
}

/** Stable id, so a re-import updates rather than duplicates. */
export const prospectId = (ref: string): string => `togo-sante:${ref}`;

export function importProspects(rows: ProspectRow[], options: ImportOptions): ImportResult {
  if (!options.assessmentRef?.trim()) {
    throw new Error(
      'importProspects requires assessmentRef: a written legitimate-interest assessment ' +
        'must exist before a prospect list is imported. See agency spec §6.1.',
    );
  }

  const basis: LawfulBasis = {
    kind: 'legitimate_interest',
    establishedAt: new Date().toISOString().slice(0, 10),
    provenance: options.provenance,
    assessmentRef: options.assessmentRef,
  };

  const contacts: Contact[] = [];
  const excluded: ImportResult['excluded'] = [];
  const stats = { total: rows.length, institutional: 0, personalMobile: 0, emailOnly: 0, noContactPoint: 0 };

  for (const row of rows) {
    const point = classifyContactPoint(row);
    if (point === 'institutional') stats.institutional++;
    else if (point === 'personal_mobile') stats.personalMobile++;
    else if (point === 'email_only') stats.emailOnly++;
    else stats.noContactPoint++;

    if (point === 'none') {
      excluded.push({ ref: row.ref, name: row.name, reason: 'no contact point' });
      continue;
    }
    if (options.automatedOnly && !eligibleForAutomatedOutreach(row)) {
      excluded.push({
        ref: row.ref,
        name: row.name,
        reason: point === 'personal_mobile' ? 'personal mobile — human call only' : 'low-confidence number',
      });
      continue;
    }

    const phone = (row.phone.trim() || row.phone2.trim()) || null;

    contacts.push({
      id: prospectId(row.ref),
      email: row.email.trim() ? row.email.trim().toLowerCase() : null,
      phone: phone ? normalisePhone(phone) : null,
      linkedinUrn: null,
      // The facility, never the practitioner. The workbook names a director for 97% of
      // rows; those names stay in the source file and out of the automated system. A
      // human caller can ask for them; the machine has no field to hold them in.
      organisation: row.name,
      country: 'TG',
      locale: options.locale ?? 'fr',
      lawfulBasis: basis,
      // No channel consent: nobody in this list has opted in to anything. WhatsApp is
      // therefore closed to all of them by the compliance gate, which is correct.
      channelConsents: [],
    });
  }

  return { contacts, excluded, stats };
}

/**
 * Priority for the human call queue.
 *
 * Renewal urgency dominates tier, because it is a *timing* signal rather than a size one:
 * a Tier B clinic whose licence expired last month is a better call today than a Tier A
 * hospital with three years left. Already-expired ranks highest — they are operating
 * without a valid licence and know it.
 */
export function callPriority(row: ProspectRow): number {
  const days = row.daysToExpiry;
  let urgency = 0;
  if (days !== null) {
    if (days < 0) urgency = 100;
    else if (days <= 90) urgency = 80;
    else if (days <= 180) urgency = 60;
    else if (days <= 365) urgency = 30;
  }
  const tierWeight = row.tier === 'A' ? 20 : row.tier === 'B' ? 10 : 0;
  const reachable = classifyContactPoint(row) === 'none' ? -50 : 0;
  return urgency + tierWeight + reachable + Math.min(row.score, 40) / 4;
}

export interface CallQueueEntry {
  ref: string;
  name: string;
  tier: string;
  city: string;
  phone: string;
  licenceStatus: string;
  daysToExpiry: number | null;
  priority: number;
  /** True when the number is a sole practitioner's mobile — call, never message. */
  personalMobile: boolean;
}

/**
 * Build the queue a human works through.
 *
 * Includes personal-mobile records: a person may call a doctor's published number. The
 * flag tells them what they are calling so the automated channels stay off it.
 */
export function buildCallQueue(rows: ProspectRow[], limit?: number): CallQueueEntry[] {
  const queue = rows
    .filter((r) => classifyContactPoint(r) !== 'none')
    .map((r) => ({
      ref: r.ref,
      name: r.name,
      tier: r.tier,
      city: r.city,
      phone: (r.phone.trim() || r.phone2.trim()),
      licenceStatus: r.licenceStatus,
      daysToExpiry: r.daysToExpiry,
      priority: callPriority(r),
      personalMobile: classifyContactPoint(r) === 'personal_mobile',
    }))
    .sort((a, b) => b.priority - a.priority);
  return limit ? queue.slice(0, limit) : queue;
}
