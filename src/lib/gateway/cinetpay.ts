/**
 * CinetPay server-side re-verification.
 *
 * Build spec §9, step 4: *re-verify server-side against CinetPay's check endpoint before
 * granting. Do not trust the notify payload alone.*
 *
 * A valid signature proves the message came from CinetPay. It does not prove the customer's
 * money moved — notify bodies describe attempts, including failed and pending ones, and
 * mobile money produces plenty of both. The check endpoint is the authority.
 *
 * This module returns a payment *fact*, never a decision. Granting is the caller's job, and
 * it should happen only for `status: 'accepted'`.
 */
export type PaymentStatus = 'accepted' | 'refused' | 'pending' | 'unknown';

export interface PaymentFact {
  status: PaymentStatus;
  /** Minor units, exponent-aware. XOF has no decimals; this is never divided by 100. */
  amountMinor: number | null;
  currency: string | null;
  transactionId: string;
  /** CinetPay's raw code, kept for the audit trail and for support conversations. */
  gatewayCode: string | null;
}

export class CinetPayUnavailableError extends Error {
  readonly code = 'CINETPAY_UNAVAILABLE';
  constructor(message: string) { super(message); this.name = 'CinetPayUnavailableError'; }
}

const CHECK_URL = 'https://api-checkout.cinetpay.com/v2/payment/check';

/**
 * Asks CinetPay what actually happened to a transaction.
 *
 * Throws rather than returning 'unknown' when the endpoint is unreachable. The caller must
 * then leave the webhook unprocessed so the gateway retries — treating an outage as
 * "not accepted" would be safe, but treating it as a terminal answer would silently drop
 * a payment the customer really made.
 */
export async function checkPayment(opts: {
  transactionId: string;
  apiKey: string;
  siteId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<PaymentFact> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);

  let body: unknown;
  try {
    const res = await doFetch(CHECK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apikey: opts.apiKey,
        site_id: opts.siteId,
        transaction_id: opts.transactionId,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new CinetPayUnavailableError(`check endpoint returned ${res.status}`);
    body = await res.json();
  } catch (err) {
    if (err instanceof CinetPayUnavailableError) throw err;
    throw new CinetPayUnavailableError(
      err instanceof Error ? err.message : 'check endpoint unreachable'
    );
  } finally {
    clearTimeout(timer);
  }

  return readFact(body, opts.transactionId);
}

/** Parsing is separated from fetching so the shape handling is testable without a network. */
export function readFact(body: unknown, transactionId: string): PaymentFact {
  const root = asRecord(body);
  const data = asRecord(root['data']);
  const code = str(root['code']) ?? str(data['code']);
  const status = str(data['status']);

  // CinetPay signals success with code "00" and status "ACCEPTED". Anything we do not
  // positively recognise is 'unknown', never 'accepted' — an unrecognised shape is a
  // reason to withhold access, not to guess.
  let mapped: PaymentStatus = 'unknown';
  if (code === '00' && status === 'ACCEPTED') mapped = 'accepted';
  else if (status === 'REFUSED' || code === '627') mapped = 'refused';
  else if (status === 'PENDING' || code === '662') mapped = 'pending';

  const rawAmount = data['amount'];
  const amount = typeof rawAmount === 'number' ? rawAmount
    : typeof rawAmount === 'string' && /^\d+(\.\d+)?$/.test(rawAmount) ? Number(rawAmount)
    : null;

  return {
    status: mapped,
    // CinetPay quotes XOF in whole francs, which IS the minor unit at exponent 0.
    // Multiplying by 100 here would overcharge by 100× — the mirror of the /100 bug the
    // house rules ban. The exponent belongs to the currency, never to the parser.
    amountMinor: amount,
    currency: str(data['currency']),
    transactionId: str(data['transaction_id']) ?? transactionId,
    gatewayCode: code,
  };
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
}
