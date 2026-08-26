import { describe, it, expect, vi } from 'vitest';
import { checkPayment, readFact, CinetPayUnavailableError } from '../../src/lib/gateway/cinetpay';

const accepted = { code: '00', data: { status: 'ACCEPTED', amount: 15000, currency: 'XOF', transaction_id: 'TX1' } };

describe('readFact', () => {
  it('recognises an accepted payment', () => {
    expect(readFact(accepted, 'TX1')).toEqual({
      status: 'accepted', amountMinor: 15000, currency: 'XOF', transactionId: 'TX1', gatewayCode: '00',
    });
  });

  it('does NOT scale the amount — XOF minor units are whole francs', () => {
    // The /100 and *100 bugs are the same bug. 15000 XOF is 15000 minor units at exponent 0.
    expect(readFact(accepted, 'TX1').amountMinor).toBe(15000);
  });

  it('reads a numeric amount sent as a string', () => {
    expect(readFact({ code: '00', data: { status: 'ACCEPTED', amount: '15000' } }, 'TX1').amountMinor).toBe(15000);
  });

  it('treats a refused payment as refused', () => {
    expect(readFact({ code: '627', data: { status: 'REFUSED' } }, 'TX1').status).toBe('refused');
  });

  it('treats a pending payment as pending, not accepted', () => {
    expect(readFact({ code: '662', data: { status: 'PENDING' } }, 'TX1').status).toBe('pending');
  });

  it.each([
    ['empty body', {}],
    ['null', null],
    ['a string', 'ACCEPTED'],
    ['status without the success code', { data: { status: 'ACCEPTED' } }],
    ['success code without the status', { code: '00', data: {} }],
    ['an unrecognised status', { code: '00', data: { status: 'SOMETHING_NEW' } }],
  ])('never reports accepted for %s', (_label, body) => {
    // An unrecognised shape must withhold access, not guess at it.
    expect(readFact(body, 'TX1').status).not.toBe('accepted');
  });

  it('falls back to the requested transaction id when the response omits it', () => {
    expect(readFact({ code: '00', data: { status: 'ACCEPTED' } }, 'TX9').transactionId).toBe('TX9');
  });
});

describe('checkPayment', () => {
  const creds = { apiKey: 'k', siteId: 's', transactionId: 'TX1' };

  it('posts the transaction to the check endpoint and returns the fact', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => accepted });
    const fact = await checkPayment({ ...creds, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fact.status).toBe('accepted');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('/v2/payment/check');
    expect(JSON.parse(init.body)).toMatchObject({ transaction_id: 'TX1', site_id: 's' });
  });

  it('throws on a non-OK response rather than reporting a status', async () => {
    // An outage must leave the webhook unprocessed so the gateway retries. Returning
    // "not accepted" here would silently drop a payment the customer really made.
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    await expect(checkPayment({ ...creds, fetchImpl: fetchImpl as unknown as typeof fetch }))
      .rejects.toBeInstanceOf(CinetPayUnavailableError);
  });

  it('throws when the endpoint is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(checkPayment({ ...creds, fetchImpl: fetchImpl as unknown as typeof fetch }))
      .rejects.toBeInstanceOf(CinetPayUnavailableError);
  });

  it('does not leak credentials in the thrown message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(checkPayment({ ...creds, apiKey: 'SUPER_SECRET', fetchImpl: fetchImpl as unknown as typeof fetch }))
      .rejects.toThrow(/^(?!.*SUPER_SECRET).*$/);
  });
});
