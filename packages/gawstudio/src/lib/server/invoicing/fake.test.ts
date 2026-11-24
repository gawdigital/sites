import { describe, expect, test } from 'bun:test';

import { FakeInvoicing, fromDecimal, toDecimal, totalOf, type InvoiceInput } from './index.ts';

const customer = { reference: 'cust-7', name: 'Jane Doe', email: 'name@example.com' };

const order = (customerId: string, overrides: Partial<InvoiceInput> = {}): InvoiceInput => ({
  orderReference: 'ORD-1',
  customerId,
  currency: 'CZK',
  priceMode: 'gross',
  language: 'en',
  tag: 'gawstudio',
  issuedOn: '2026-11-24',
  lines: [
    { name: 'G.A.W.Studio: recording session', quantity: 2, unit: 'h', unitPrice: 150000, vatRate: 21 },
    { name: 'G.A.W.Studio: discount', quantity: 1, unitPrice: -50000, vatRate: 21 },
  ],
  ...overrides,
});

async function withInvoice() {
  const invoicing = new FakeInvoicing();
  const subject = await invoicing.ensureCustomer(customer);
  if (!subject.ok) throw new Error('no customer');
  const issued = await invoicing.createInvoice(order(subject.value.id));
  if (!issued.ok) throw new Error('no invoice');
  return { invoicing, customerId: subject.value.id, invoice: issued.value.document };
}

describe('money', () => {
  test('minor units become decimals with both places', () => {
    expect(toDecimal(121000, 'CZK')).toBe('1210.00');
    expect(toDecimal(5, 'EUR')).toBe('0.05');
    expect(toDecimal(-16050, 'CZK')).toBe('-160.50');
    expect(toDecimal(0, 'CZK')).toBe('0.00');
    expect(() => toDecimal(10.5, 'CZK')).toThrow(RangeError);
  });

  test('decimals become minor units without floating-point drift', () => {
    expect(fromDecimal('1210.0', 'CZK')).toBe(121000);
    expect(fromDecimal('0.29', 'EUR')).toBe(29);
    expect(fromDecimal('-3000.0', 'CZK')).toBe(-300000);
    expect(fromDecimal(1210, 'CZK')).toBe(121000);
    expect(fromDecimal('173.925', 'CZK')).toBe(17393);
    expect(fromDecimal('-0.0', 'CZK')).toBe(0);
    expect(fromDecimal('1,5', 'CZK')).toBeUndefined();
  });

  test('a total adds VAT to net prices, per rate, and leaves gross prices as they are', () => {
    const lines = [
      { name: 'a', quantity: 2, unitPrice: 100000, vatRate: 21 },
      { name: 'b', quantity: 1, unitPrice: 10000, vatRate: 12 },
    ];
    const draft = { currency: 'CZK' as const, language: 'en' as const, tag: 't', issuedOn: '2026-11-24', lines };

    expect(totalOf({ ...draft, priceMode: 'gross' })).toBe(210000);
    expect(totalOf({ ...draft, priceMode: 'net' })).toBe(242000 + 11200);
  });
});

describe('the fake provider', () => {
  test('finds a customer again by reference', async () => {
    const invoicing = new FakeInvoicing();
    const first = await invoicing.ensureCustomer(customer);
    const second = await invoicing.ensureCustomer({ ...customer, name: 'Jane Q. Doe' });

    expect(first).toEqual({ ok: true, value: { id: '1', reference: 'cust-7', created: true } });
    expect(second).toEqual({ ok: true, value: { id: '1', reference: 'cust-7', created: false } });
    expect(invoicing.customers.get('cust-7')?.customer.name).toBe('Jane Q. Doe');
  });

  test('issues one invoice per order reference', async () => {
    const { invoicing, customerId, invoice } = await withInvoice();
    const again = await invoicing.createInvoice(order(customerId));

    expect(invoice).toMatchObject({ kind: 'invoice', number: '2026-0001', reference: 'ORD-1', paid: false, total: { amount: 250000, currency: 'CZK' } });
    expect(again).toEqual({ ok: true, value: { document: invoice, created: false } });
    expect(invoicing.issued).toHaveLength(1);
    expect(await invoicing.findInvoice('ORD-1')).toEqual({ ok: true, value: invoice });
    expect(await invoicing.findInvoice('ORD-9')).toEqual({ ok: true, value: undefined });
  });

  test('refuses an invoice for a customer it does not know', async () => {
    expect(await new FakeInvoicing().createInvoice(order('99'))).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });

  test('a payment covering the total marks the invoice paid, once', async () => {
    const { invoicing, invoice } = await withInvoice();
    const payment = { paidOn: '2026-11-24', amount: { amount: 250000, currency: 'CZK' as const } };

    expect(await invoicing.recordPayment(invoice.id, payment)).toEqual({ ok: true, value: { invoiceId: invoice.id, alreadyPaid: false } });
    expect(await invoicing.recordPayment(invoice.id, payment)).toEqual({ ok: true, value: { invoiceId: invoice.id, alreadyPaid: true } });
    expect(await invoicing.getInvoice(invoice.id)).toMatchObject({ ok: true, value: { paid: true } });
    expect(invoicing.documents.get(invoice.id)?.payments).toEqual([payment]);
  });

  test('counts e-mails and hands out a PDF and a public URL', async () => {
    const { invoicing, invoice } = await withInvoice();
    await invoicing.sendInvoiceEmail(invoice.id);
    const pdf = await invoicing.downloadPdf(invoice.id);

    expect(invoicing.documents.get(invoice.id)?.emails).toBe(1);
    expect(pdf.ok && new TextDecoder().decode(pdf.value)).toBe('%PDF-fake 2026-0001');
    expect(invoice.publicUrl).toBe('https://invoices.example/2026-0001');
    expect(await invoicing.sendInvoiceEmail('99')).toMatchObject({ ok: false, error: { kind: 'not_found' } });
  });

  test('issues one corrective document per refund reference, with a negative total', async () => {
    const { invoicing, customerId, invoice } = await withInvoice();
    const { orderReference: _, customerId: __, ...draft } = order(customerId);
    const refund = { ...draft, refundReference: 'REF-1', invoiceId: invoice.id, issuedOn: '2026-12-01' };

    const first = await invoicing.issueCorrection(refund);
    const second = await invoicing.issueCorrection(refund);

    expect(first).toMatchObject({
      ok: true,
      value: { created: true, document: { kind: 'correction', reference: 'REF-1', correctsInvoiceId: invoice.id, total: { amount: -250000, currency: 'CZK' } } },
    });
    expect(second.ok && second.value.created).toBe(false);
    expect(invoicing.issued).toHaveLength(2);
    expect(await invoicing.issueCorrection({ ...refund, refundReference: 'REF-2', invoiceId: '99' })).toMatchObject({ ok: false, error: { kind: 'not_found' } });
  });

  test('fails the next call on request, once, and records every call', async () => {
    const invoicing = new FakeInvoicing();
    invoicing.failNext('ensureCustomer', { kind: 'rate_limited', message: 'Slow down', retryAfterSeconds: 5 });

    expect(await invoicing.ensureCustomer(customer)).toEqual({ ok: false, error: { kind: 'rate_limited', message: 'Slow down', retryAfterSeconds: 5 } });
    expect((await invoicing.ensureCustomer(customer)).ok).toBe(true);
    expect(invoicing.calls).toEqual(['ensureCustomer', 'ensureCustomer']);
  });
});
