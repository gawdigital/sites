// Invoicing as the rest of the studio's backend sees it: one interface, no provider's vocabulary. An order that has
// been paid becomes an invoice (issued by G.A.W. Group, with the G.A.W.Studio brand named in its lines and text by
// whoever builds them), the payment is recorded on it, the provider e-mails it, and a refund is a corrective
// document. The Fakturoid adapter (`fakturoid.ts`) and the in-memory fake (`fake.ts`) both implement it.

import type { Currency } from '../shared/money.ts';

/** The currencies the studio sells in, shared with the orders. Both have two decimal places (see `money.ts`). */
export type { Currency };

/** An amount in minor units (haléře, cents): always an integer, never a float of crowns. */
export interface Money {
  amount: number;
  currency: Currency;
}

/** The site's locales; the adapter maps them to the provider's own codes. */
export type InvoiceLanguage = 'en' | 'de' | 'cs';

/** Whether the lines' unit prices are without VAT (`net`) or include it (`gross`). One mode per document. */
export type PriceMode = 'net' | 'gross';

export type PaymentMethod = 'card' | 'bank' | 'cash' | 'paypal';

/** A calendar date, `YYYY-MM-DD`. The caller decides the day (and so the time zone): nothing here reads a clock. */
export type IsoDate = string;

export interface Address {
  street: string;
  city: string;
  zip: string;
  /** ISO 3166-1 alpha-2, e.g. `CZ`. */
  country: string;
}

/** The optional company details of the order form. */
export interface Company {
  name: string;
  /** Company registration number (IČO). */
  companyId?: string;
  /** VAT number (DIČ), with its country prefix. */
  vatId?: string;
}

/**
 * Who the invoice is for. `reference` is our own stable key for this billing identity and is what find-or-create
 * matches on: the same account ordering once privately and once for a company needs two references.
 */
export interface InvoiceCustomer {
  reference: string;
  /** The person: the invoice's name for a consumer, the contact person for a company. */
  name: string;
  /** Where the provider sends the invoice e-mail. */
  email: string;
  company?: Company;
  address?: Address;
}

export interface CustomerRef {
  /** The provider's identifier, as a string. */
  id: string;
  reference: string;
  /** False when the customer was already there (whether or not its details had to be brought up to date). */
  created: boolean;
}

/** One invoice-ready line. A discount is a line with a negative unit price. */
export interface InvoiceLine {
  name: string;
  quantity: number;
  /** The unit's label as printed, e.g. `h`, `pc`; omitted when there is none. */
  unit?: string;
  /** Minor units, in the document's currency, net or gross as the document's `priceMode` says. */
  unitPrice: number;
  /** Percent, e.g. `21`. */
  vatRate: number;
}

/** What an invoice and a corrective document have in common. */
export interface DocumentDraft {
  currency: Currency;
  priceMode: PriceMode;
  lines: readonly InvoiceLine[];
  language: InvoiceLanguage;
  /** The tag that marks the studio's documents in the shared account. */
  tag: string;
  issuedOn: IsoDate;
  /** The date of the taxable supply, when it is not the date of issue. */
  taxableSupplyOn?: IsoDate;
  /**
   * How many units of the account's currency one unit of `currency` is worth, as a decimal string (`"25.215"`).
   * Needed when `currency` is not the account's own; see the adapter for why it cannot be defaulted.
   */
  exchangeRate?: string;
  /** Text printed before the lines; the place to name the brand. */
  note?: string;
  footerNote?: string;
}

export interface InvoiceInput extends DocumentDraft {
  /** Our order's reference: the idempotency key. An order has at most one invoice. */
  orderReference: string;
  /** From `ensureCustomer`. */
  customerId: string;
  paymentMethod?: PaymentMethod;
}

export interface CorrectionInput extends DocumentDraft {
  /** Our refund's reference: the idempotency key. A refund has at most one corrective document. */
  refundReference: string;
  /** The invoice being corrected. */
  invoiceId: string;
  /**
   * `lines` here are what is taken back, written as on the invoice (positive prices for what was sold): the
   * provider's sign convention is the adapter's business.
   */
  lines: readonly InvoiceLine[];
}

export type DocumentKind = 'invoice' | 'correction';

/** An issued document, as much of it as the rest of the backend needs. */
export interface InvoiceDocument {
  id: string;
  kind: DocumentKind;
  /** The number from the provider's series. */
  number: string;
  /** The order reference of an invoice, the refund reference of a corrective document. */
  reference: string;
  paid: boolean;
  /** Total including VAT; negative on a corrective document. */
  total: Money;
  /** The page the customer can open without logging in, with the PDF behind a button. */
  publicUrl: string;
  /** On a corrective document: the invoice it corrects. */
  correctsInvoiceId?: string;
}

export interface Issued {
  document: InvoiceDocument;
  /** False when the reference already had a document and that one is returned instead of a new one. */
  created: boolean;
}

export interface PaymentInput {
  paidOn: IsoDate;
  amount: Money;
  /** Ask the provider to send its own thank-you e-mail; left to the account's setting when omitted. */
  sendThankYouEmail?: boolean;
}

export interface PaymentResult {
  invoiceId: string;
  /** True when the invoice was paid before this call and nothing was recorded. */
  alreadyPaid: boolean;
}

/**
 * Why a call failed.
 * - `validation`: the provider (or the adapter, before calling) refused the data; `fields` says which and why.
 * - `rate_limited`: too many requests; retry after `retryAfterSeconds` when the provider said how long.
 * - `unauthorized`: the credentials do not work, even with a new token.
 * - `forbidden`: the account may not do this (plan, locked document, blocked account); `code` is the provider's.
 * - `not_found`: no such customer or document.
 * - `not_ready`: the PDF is still being generated; ask again in a second or two.
 * - `unavailable`: the provider is down, in maintenance or unreachable; retry later.
 * - `unexpected`: anything else, including a response we could not read.
 */
export type InvoicingError =
  | { kind: 'validation'; message: string; fields: Record<string, string[]> }
  | { kind: 'rate_limited'; message: string; retryAfterSeconds?: number }
  | { kind: 'unauthorized'; message: string }
  | { kind: 'forbidden'; message: string; code?: string }
  | { kind: 'not_found'; message: string }
  | { kind: 'not_ready'; message: string }
  | { kind: 'unavailable'; message: string; status?: number }
  | { kind: 'unexpected'; message: string; status?: number };

/** Failures are values, not exceptions: a caller decides per kind whether to retry, queue or give up. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: InvoicingError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (error: InvoicingError): Result<never> => ({ ok: false, error });

export interface InvoicingProvider {
  /** Finds the customer by `reference` or creates it; an existing one gets the details given here. */
  ensureCustomer(customer: InvoiceCustomer): Promise<Result<CustomerRef>>;

  /**
   * Issues the invoice for an order, or returns the one the order already has. The check and the creation are two
   * requests: the caller must not run two of them for the same order at once.
   */
  createInvoice(input: InvoiceInput): Promise<Result<Issued>>;

  /** The invoice issued for an order reference, if there is one. */
  findInvoice(orderReference: string): Promise<Result<InvoiceDocument | undefined>>;

  getInvoice(invoiceId: string): Promise<Result<InvoiceDocument>>;

  /** Records the payment, which marks the invoice paid. An invoice that is already paid is left as it is. */
  recordPayment(invoiceId: string, payment: PaymentInput): Promise<Result<PaymentResult>>;

  /** Has the provider e-mail the document to the customer's address. */
  sendInvoiceEmail(invoiceId: string): Promise<Result<void>>;

  /** The PDF itself, for serving from the customer's account; `not_ready` shortly after the document was issued. */
  downloadPdf(invoiceId: string): Promise<Result<Uint8Array>>;

  /** Issues the corrective document for a refund, or returns the one the refund already has. */
  issueCorrection(input: CorrectionInput): Promise<Result<Issued>>;
}
