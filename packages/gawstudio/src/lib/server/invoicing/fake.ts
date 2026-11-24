// An invoicing provider that lives in memory, for the tests of whatever calls one (orders, payments, the account
// page). It keeps the interface's promises (one invoice per order reference, one correction per refund reference,
// a paid invoice stays paid) and lets a test look at what was issued and make the next call fail.
import {
  fail,
  ok,
  type CorrectionInput,
  type CustomerRef,
  type DocumentDraft,
  type InvoiceCustomer,
  type InvoiceDocument,
  type InvoiceInput,
  type InvoicingError,
  type InvoicingProvider,
  type Issued,
  type Money,
  type PaymentInput,
  type PaymentResult,
  type Result,
} from './types.ts';

export type InvoicingCall = keyof InvoicingProvider;

/** A document with what it was made from, for assertions. */
export interface FakeDocument {
  document: InvoiceDocument;
  input: InvoiceInput | CorrectionInput;
  payments: PaymentInput[];
  /** How many times the e-mail was asked for. */
  emails: number;
}

/** The total with VAT of a draft's lines, in minor units: each VAT rate's net sum is taxed and rounded on its own. */
export function totalOf(draft: DocumentDraft): number {
  if (draft.priceMode === 'gross') return draft.lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPrice), 0);
  const netByRate = new Map<number, number>();
  for (const line of draft.lines) netByRate.set(line.vatRate, (netByRate.get(line.vatRate) ?? 0) + Math.round(line.quantity * line.unitPrice));
  return [...netByRate].reduce((sum, [rate, net]) => sum + net + Math.round((net * rate) / 100), 0);
}

export class FakeInvoicing implements InvoicingProvider {
  /** Customers by our reference. */
  readonly customers = new Map<string, { id: string; customer: InvoiceCustomer }>();
  /** Documents by the provider's ID, in the order they were issued. */
  readonly documents = new Map<string, FakeDocument>();
  /** Every call made, in order: for asserting what did and did not happen. */
  readonly calls: InvoicingCall[] = [];

  readonly #failures = new Map<InvoicingCall, InvoicingError[]>();
  #nextId = 1;

  /** Makes the next call of `call` fail with `error`, once. Queue several for several failures. */
  failNext(call: InvoicingCall, error: InvoicingError): void {
    this.#failures.set(call, [...(this.#failures.get(call) ?? []), error]);
  }

  /** The documents issued so far. */
  get issued(): FakeDocument[] {
    return [...this.documents.values()];
  }

  async ensureCustomer(customer: InvoiceCustomer): Promise<Result<CustomerRef>> {
    const failed = this.#enter('ensureCustomer');
    if (failed) return failed;
    const known = this.customers.get(customer.reference);
    const id = known?.id ?? String(this.#nextId++);
    this.customers.set(customer.reference, { id, customer });
    return ok({ id, reference: customer.reference, created: !known });
  }

  async createInvoice(input: InvoiceInput): Promise<Result<Issued>> {
    const failed = this.#enter('createInvoice');
    if (failed) return failed;
    const existing = this.#byReference(input.orderReference, 'invoice');
    if (existing) return ok({ document: existing.document, created: false });
    if (![...this.customers.values()].some((known) => known.id === input.customerId)) {
      return fail({ kind: 'validation', message: 'subject_id: Contact does not exist.', fields: { subject_id: ['Contact does not exist.'] } });
    }
    return ok({ document: this.#issue(input, { kind: 'invoice', reference: input.orderReference, total: totalOf(input) }), created: true });
  }

  async findInvoice(orderReference: string): Promise<Result<InvoiceDocument | undefined>> {
    return this.#enter('findInvoice') ?? ok(this.#byReference(orderReference, 'invoice')?.document);
  }

  async getInvoice(invoiceId: string): Promise<Result<InvoiceDocument>> {
    const failed = this.#enter('getInvoice');
    if (failed) return failed;
    const found = this.documents.get(invoiceId);
    return found ? ok(found.document) : fail(missing(invoiceId));
  }

  async recordPayment(invoiceId: string, payment: PaymentInput): Promise<Result<PaymentResult>> {
    const failed = this.#enter('recordPayment');
    if (failed) return failed;
    const found = this.documents.get(invoiceId);
    if (!found) return fail(missing(invoiceId));
    if (found.document.paid) return ok({ invoiceId, alreadyPaid: true });
    if (payment.amount.currency !== found.document.total.currency) {
      return fail({ kind: 'validation', message: 'The payment is not in the invoice\'s currency.', fields: { currency: [`the invoice is in ${found.document.total.currency}`] } });
    }
    found.payments.push(payment);
    const paid = found.payments.reduce((sum, each) => sum + each.amount.amount, 0);
    found.document.paid = paid >= found.document.total.amount;
    return ok({ invoiceId, alreadyPaid: false });
  }

  async sendInvoiceEmail(invoiceId: string): Promise<Result<void>> {
    const failed = this.#enter('sendInvoiceEmail');
    if (failed) return failed;
    const found = this.documents.get(invoiceId);
    if (!found) return fail(missing(invoiceId));
    found.emails += 1;
    return ok(undefined);
  }

  async downloadPdf(invoiceId: string): Promise<Result<Uint8Array>> {
    const failed = this.#enter('downloadPdf');
    if (failed) return failed;
    const found = this.documents.get(invoiceId);
    return found ? ok(new TextEncoder().encode(`%PDF-fake ${found.document.number}`)) : fail(missing(invoiceId));
  }

  async issueCorrection(input: CorrectionInput): Promise<Result<Issued>> {
    const failed = this.#enter('issueCorrection');
    if (failed) return failed;
    const existing = this.#byReference(input.refundReference, 'correction');
    if (existing) return ok({ document: existing.document, created: false });
    const invoice = this.documents.get(input.invoiceId);
    if (!invoice || invoice.document.kind !== 'invoice') return fail(missing(input.invoiceId));
    const document = this.#issue(input, { kind: 'correction', reference: input.refundReference, total: -totalOf(input) });
    document.correctsInvoiceId = input.invoiceId;
    return ok({ document, created: true });
  }

  /** Notes the call and takes its queued failure, if any. */
  #enter(call: InvoicingCall): Result<never> | undefined {
    this.calls.push(call);
    const error = this.#failures.get(call)?.shift();
    return error ? fail(error) : undefined;
  }

  #byReference(reference: string, kind: InvoiceDocument['kind']): FakeDocument | undefined {
    return this.issued.find((each) => each.document.kind === kind && each.document.reference === reference);
  }

  #issue(input: InvoiceInput | CorrectionInput, made: { kind: InvoiceDocument['kind']; reference: string; total: number }): InvoiceDocument {
    const id = String(this.#nextId++);
    const number = `${input.issuedOn.slice(0, 4)}-${String(this.documents.size + 1).padStart(4, '0')}`;
    const total: Money = { amount: made.total, currency: input.currency };
    const document: InvoiceDocument = { id, kind: made.kind, number, reference: made.reference, paid: false, total, publicUrl: `https://invoices.example/${number}` };
    this.documents.set(id, { document, input, payments: [], emails: 0 });
    return document;
  }
}

const missing = (id: string): InvoicingError => ({ kind: 'not_found', message: `No document ${id}.` });
