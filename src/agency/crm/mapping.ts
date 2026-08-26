/**
 * Field and endpoint mapping.
 *
 * Node CRM's exact API surface is an open question in the spec (§13.3) — it is
 * ARGILETTE's own product and its shape is not yet audited against what the agency needs.
 * Rather than guess and hard-code, the adapter reads its paths and field names from here.
 *
 * That means adapting to the real API is editing this file, not rewriting the client. If
 * Node CRM calls the field `company_name` rather than `organisation`, that is one line.
 *
 * The defaults below are a conventional REST shape. **They are assumptions.** Run
 * `npm run agency:crm-check` against a real instance to find out which of them are wrong.
 */

export interface CrmEndpoints {
  health: string;
  listContacts: string;
  getContact: string;
  createContact: string;
  updateContact: string;
  recordActivity: string;
  moveStage: string;
  listSuppressions: string;
}

/**
 * Our field name to theirs.
 *
 * Dotted paths are supported for nested payloads (`attributes.email`), because CRMs love
 * an envelope.
 */
export interface CrmFieldMap {
  crmId: string;
  email: string;
  phone: string;
  linkedinUrn: string;
  organisation: string;
  country: string;
  locale: string;
  stage: string;
  basisKind: string;
  basisEstablishedAt: string;
  basisProvenance: string;
  basisAssessmentRef: string;
  basisConsentWording: string;
}

export interface CrmMapping {
  endpoints: CrmEndpoints;
  fields: CrmFieldMap;
  /** Where the array lives in a list response. Empty string means the body is the array. */
  listItemsPath: string;
  /** Where the pagination cursor lives. */
  listCursorPath: string;
}

export const DEFAULT_MAPPING: CrmMapping = {
  endpoints: {
    health: '/api/v1/health',
    listContacts: '/api/v1/contacts',
    getContact: '/api/v1/contacts/{id}',
    createContact: '/api/v1/contacts',
    updateContact: '/api/v1/contacts/{id}',
    recordActivity: '/api/v1/activities',
    moveStage: '/api/v1/contacts/{id}/stage',
    listSuppressions: '/api/v1/suppressions',
  },
  fields: {
    crmId: 'id',
    email: 'email',
    phone: 'phone',
    linkedinUrn: 'linkedin_urn',
    organisation: 'organisation',
    country: 'country',
    locale: 'locale',
    stage: 'stage',
    basisKind: 'lawful_basis.kind',
    basisEstablishedAt: 'lawful_basis.established_at',
    basisProvenance: 'lawful_basis.provenance',
    basisAssessmentRef: 'lawful_basis.assessment_ref',
    basisConsentWording: 'lawful_basis.consent_wording',
  },
  listItemsPath: 'data',
  listCursorPath: 'next_cursor',
};

/** Read a dotted path. Returns undefined rather than throwing on a missing branch. */
export function readPath(source: unknown, path: string): unknown {
  if (path === '') return source;
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Write a dotted path, creating intermediate objects. */
export function writePath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (typeof next !== 'object' || next === null) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]!] = value;
}

/** Load a mapping override from JSON, deep-merged over the defaults. */
export function mappingFromJson(json: string | undefined): CrmMapping {
  if (!json) return DEFAULT_MAPPING;
  const override = JSON.parse(json) as Partial<CrmMapping>;
  return {
    endpoints: { ...DEFAULT_MAPPING.endpoints, ...override.endpoints },
    fields: { ...DEFAULT_MAPPING.fields, ...override.fields },
    listItemsPath: override.listItemsPath ?? DEFAULT_MAPPING.listItemsPath,
    listCursorPath: override.listCursorPath ?? DEFAULT_MAPPING.listCursorPath,
  };
}
