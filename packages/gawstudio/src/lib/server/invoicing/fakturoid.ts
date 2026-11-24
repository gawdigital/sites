// The Fakturoid API v3 adapter: `InvoicingProvider` over the one Fakturoid account, which is G.A.W. Group's (the
// invoices are issued by G.A.W. Group; G.A.W.Studio is its brand, named in the lines and notes the caller writes).
//
// Built from the official documentation, every page read on 2026-11-24:
//   https://www.fakturoid.cz/api/v3                   base URL, account slug in the path, User-Agent (400 without),
//                                                     JSON, 40 records per page (`page`), the two error bodies,
//                                                     503 in maintenance, 429 and the X-RateLimit headers, 402
//   https://www.fakturoid.cz/api/v3/authorization     Client Credentials flow (see token.ts)
//   https://www.fakturoid.cz/api/v3/subjects          attributes, index with the `custom_id` filter, create (201,
//                                                     422, 403 over the plan's limit), update (PATCH)
//   https://www.fakturoid.cz/api/v3/invoices          attributes, lines, `vat_price_mode`, `document_type` and
//                                                     `correction_id`, index with the `custom_id` filter, detail,
//                                                     create (201, 422, 403 without a bank account), the PDF
//                                                     download (204 until generated), `public_html_url`
//   https://www.fakturoid.cz/api/v3/invoice-payments  create (201, 422, 403 on an already paid invoice)
//   https://www.fakturoid.cz/api/v3/invoice-messages  create (204; 403 on the free plan, over quota, disabled)
//   https://www.fakturoid.cz/api/v3/changelog         v2's `fire` events `deliver`, `pay` and `correction` and the
//                                                     `/invoices/correction.json` endpoint are gone, replaced by
//                                                     Invoice Messages, Invoice Payments and `document_type`
//
// The issue's open question, answered: yes, API v3 covers corrective documents. A correction (dobropis, opravný
// daňový doklad) is an ordinary `POST /accounts/{slug}/invoices.json` with `document_type: "correction"` and
// `correction_id` set to the corrected invoice's ID; Fakturoid then points the invoice's own `correction_id` back
// at the correction. The documentation itself says to issue one where a VAT payer's invoice cannot be cancelled.
//
// What the documentation does not say is marked UNVERIFIED where it matters; in short:
//   - the sign of a correction's lines (we negate the unit prices);
//   - whether `exchange_rate` is defaulted for a foreign-currency document (documented as required, so we require it);
//   - whether `custom_id` is unique or matched exactly by the index filter (we compare it ourselves);
//   - whether a negative `unit_price` (a discount line) is accepted on an invoice;
//   - which status wrong client credentials get from the token endpoint (see token.ts).
// Number series: no `number_format_id` is sent, so documents take the account's default series. There is no draft
// state: a created invoice is issued at once and has its number.
import { fromDecimal, isCurrency, toDecimal } from './money.ts';
import { createTokenSource, FAKTUROID_API, type TokenConfig, type TokenSource } from './token.ts';
import {
  fail,
  ok,
  type CorrectionInput,
  type Currency,
  type CustomerRef,
  type DocumentDraft,
  type DocumentKind,
  type InvoiceCustomer,
  type InvoiceDocument,
  type InvoiceInput,
  type InvoiceLanguage,
  type InvoicingError,
  type InvoicingProvider,
  type Issued,
  type PaymentInput,
  type PaymentResult,
  type PriceMode,
  type Result,
} from './types.ts';

export interface FakturoidConfig extends TokenConfig {
  /** The account's name as it stands in its URLs. Configuration, like the credentials: not in the repository. */
  slug: string;
  /** The currency the account keeps its books in; a document in another one needs an exchange rate. */
  accountCurrency?: Currency;
  /** For tests, or to share one token source between adapters; made from the config when omitted. */
  tokens?: TokenSource;
}

/** Collections come 40 to a page. */
export const PAGE_SIZE = 40;

/** A reference is looked for on this many pages at most: one is the expected number, the rest is a safety net. */
const MAX_PAGES = 5;

/** Fakturoid's language codes are its own: Czech is `cz`. */
const LANGUAGE: Record<InvoiceLanguage, string> = { en: 'en', de: 'de', cs: 'cz' };

const VAT_PRICE_MODE: Record<PriceMode, string> = { net: 'without_vat', gross: 'from_total_with_vat' };

type Json = Record<string, unknown>;

interface Call {
  method: 'GET' | 'POST' | 'PATCH';
  /** After `/accounts/{slug}`. */
  path: string;
  query?: Record<string, string>;
  body?: Json;
  /** How a successful response is read. */
  read?: 'json' | 'bytes' | 'nothing';
}

interface Answer {
  status: number;
  json?: unknown;
  bytes?: Uint8Array;
}

export function createFakturoid(config: FakturoidConfig): InvoicingProvider {
  const tokens = config.tokens ?? createTokenSource(config);
  const root = `${config.baseUrl ?? FAKTUROID_API}/accounts/${encodeURIComponent(config.slug)}`;
  const accountCurrency = config.accountCurrency ?? 'CZK';

  async function send(call: Call, token: string): Promise<Response | undefined> {
    const url = new URL(root + call.path);
    for (const [name, value] of Object.entries(call.query ?? {})) url.searchParams.set(name, value);
    const headers: Record<string, string> = {
      'User-Agent': config.userAgent,
      Accept: call.read === 'bytes' ? 'application/pdf' : 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (call.body) headers['Content-Type'] = 'application/json';
    try {
      return await config.fetch(url.toString(), { method: call.method, headers, body: call.body ? JSON.stringify(call.body) : undefined });
    } catch {
      return undefined;
    }
  }

  /** One API call: with a token, once more with a new token after a 401, its failure mapped to our errors. */
  async function api(call: Call): Promise<Result<Answer>> {
    let response: Response | undefined;
    for (const forceNew of [false, true]) {
      const token = await tokens.token({ forceNew });
      if (!token.ok) return token;
      response = await send(call, token.value);
      if (!response) return fail({ kind: 'unavailable', message: 'Fakturoid could not be reached.' });
      // A 401 with a cached token usually means the token was revoked or ran out early: one new token, one retry.
      if (response.status !== 401) break;
    }
    if (!response) return fail({ kind: 'unexpected', message: 'No response.' });
    if (!response.ok) return fail(await readError(response));

    const read = call.read ?? 'json';
    if (read === 'nothing' || response.status === 204) return ok({ status: response.status });
    if (read === 'bytes') return ok({ status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) });
    const json: unknown = await response.json().catch(() => undefined);
    if (json === undefined) return fail({ kind: 'unexpected', message: 'The response is not JSON.', status: response.status });
    return ok({ status: response.status, json });
  }

  /**
   * The first record carrying exactly this `custom_id` that `accept` takes. The index filters by `custom_id`;
   * UNVERIFIED that the filter is an exact match and that Fakturoid keeps the value unique, hence the comparison
   * here and the walk over further pages while they come back full.
   */
  async function findByCustomId(path: string, customId: string, accept: (record: Json) => boolean): Promise<Result<Json | undefined>> {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const answer = await api({ method: 'GET', path, query: { custom_id: customId, page: String(page) } });
      if (!answer.ok) return answer;
      const records = Array.isArray(answer.value.json) ? answer.value.json.filter(isRecord) : [];
      const found = records.find((record) => record.custom_id === customId && accept(record));
      if (found || records.length < PAGE_SIZE) return ok(found);
    }
    return ok(undefined);
  }

  async function findDocument(reference: string, kind: DocumentKind): Promise<Result<InvoiceDocument | undefined>> {
    const found = await findByCustomId('/invoices.json', reference, (record) => record.document_type === kind);
    if (!found.ok || !found.value) return found.ok ? ok(undefined) : found;
    return readDocument(found.value);
  }

  async function detail(invoiceId: string): Promise<Result<Json>> {
    if (!isId(invoiceId)) return fail(notAnId('invoice', invoiceId));
    const answer = await api({ method: 'GET', path: `/invoices/${invoiceId}.json` });
    if (!answer.ok) return answer;
    return isRecord(answer.value.json) ? ok(answer.value.json) : fail(unreadable('invoice'));
  }

  async function create(body: Json): Promise<Result<Issued>> {
    const answer = await api({ method: 'POST', path: '/invoices.json', body });
    if (!answer.ok) return answer;
    const document = readDocument(answer.value.json);
    return document.ok ? ok({ document: document.value, created: true }) : document;
  }

  /** What the adapter can refuse without asking Fakturoid. */
  function checkDraft(draft: DocumentDraft): InvoicingError | undefined {
    const fields: Record<string, string[]> = {};
    if (draft.lines.length === 0) fields.lines = ['must not be empty'];
    if (draft.lines.some((line) => !Number.isSafeInteger(line.unitPrice))) fields.unit_price = ['must be an integer of minor units'];
    if (draft.lines.some((line) => !Number.isFinite(line.quantity) || !Number.isFinite(line.vatRate))) fields.lines = ['quantity and VAT rate must be numbers'];
    if (draft.tag.trim() === '') fields.tags = ['the tag must not be empty'];
    if (draft.exchangeRate !== undefined && !/^\d+(\.\d+)?$/.test(draft.exchangeRate)) fields.exchange_rate = ['must be a decimal number'];
    // Documented: "Exchange rate (required if document currency differs from account currency)". UNVERIFIED whether
    // Fakturoid would fill in the day's rate itself; until someone tries it on the account, the caller supplies it.
    if (draft.currency !== accountCurrency && draft.exchangeRate === undefined) fields.exchange_rate = [`is required for a document in ${draft.currency}`];
    return Object.keys(fields).length > 0 ? { kind: 'validation', message: 'The document was not sent: its data is incomplete.', fields } : undefined;
  }

  return {
    async ensureCustomer(customer: InvoiceCustomer): Promise<Result<CustomerRef>> {
      const wanted = subjectBody(customer);
      const found = await findByCustomId('/subjects.json', customer.reference, () => true);
      if (!found.ok) return found;

      if (!found.value) {
        const answer = await api({ method: 'POST', path: '/subjects.json', body: wanted });
        if (!answer.ok) return answer;
        const id = isRecord(answer.value.json) ? readId(answer.value.json.id) : undefined;
        return id ? ok({ id, reference: customer.reference, created: true }) : fail(unreadable('subject'));
      }

      const id = readId(found.value.id);
      if (!id) return fail(unreadable('subject'));
      // An invoice copies the subject's name and address when it is created, so a customer who has since moved or
      // corrected a VAT number must be brought up to date first. Only what differs is sent.
      const stored = found.value;
      const changes = Object.fromEntries(Object.entries(wanted).filter(([name, value]) => (stored[name] ?? '') !== value));
      if (Object.keys(changes).length > 0) {
        const answer = await api({ method: 'PATCH', path: `/subjects/${id}.json`, body: changes });
        if (!answer.ok) return answer;
      }
      return ok({ id, reference: customer.reference, created: false });
    },

    async createInvoice(input: InvoiceInput): Promise<Result<Issued>> {
      if (!isId(input.customerId)) return fail(notAnId('customer', input.customerId));
      const refused = checkDraft(input);
      if (refused) return fail(refused);

      // Idempotency: the order reference is the invoice's `custom_id`, and the index can be filtered by it. Fakturoid
      // documents no idempotency key for requests, so this look-up before the create is all there is.
      const existing = await findDocument(input.orderReference, 'invoice');
      if (!existing.ok) return existing;
      if (existing.value) return ok({ document: existing.value, created: false });

      return create(invoiceBody(input));
    },

    findInvoice: (orderReference) => findDocument(orderReference, 'invoice'),

    async getInvoice(invoiceId: string): Promise<Result<InvoiceDocument>> {
      const invoice = await detail(invoiceId);
      return invoice.ok ? readDocument(invoice.value) : invoice;
    },

    async recordPayment(invoiceId: string, payment: PaymentInput): Promise<Result<PaymentResult>> {
      // Adding a payment to a paid invoice is a 403, so a repeated call asks first and leaves a paid invoice alone.
      const invoice = await detail(invoiceId);
      if (!invoice.ok) return invoice;
      if (invoice.value.status === 'paid') return ok({ invoiceId, alreadyPaid: true });
      if (invoice.value.currency !== payment.amount.currency) {
        return fail({
          kind: 'validation',
          message: 'The payment was not sent: its currency is not the invoice\'s.',
          fields: { currency: [`the invoice is in ${String(invoice.value.currency)}`] },
        });
      }
      const answer = await api({ method: 'POST', path: `/invoices/${invoiceId}/payments.json`, body: paymentBody(payment), read: 'nothing' });
      return answer.ok ? ok({ invoiceId, alreadyPaid: false }) : answer;
    },

    async sendInvoiceEmail(invoiceId: string): Promise<Result<void>> {
      if (!isId(invoiceId)) return fail(notAnId('invoice', invoiceId));
      // An empty message takes everything from the account: the address from the subject, the subject line and the
      // text from the e-mail settings (`replace_with_defaults` is true unless said otherwise). Paid plans only.
      const answer = await api({ method: 'POST', path: `/invoices/${invoiceId}/message.json`, body: {}, read: 'nothing' });
      return answer.ok ? ok(undefined) : answer;
    },

    async downloadPdf(invoiceId: string): Promise<Result<Uint8Array>> {
      if (!isId(invoiceId)) return fail(notAnId('invoice', invoiceId));
      const answer = await api({ method: 'GET', path: `/invoices/${invoiceId}/download.pdf`, read: 'bytes' });
      if (!answer.ok) return answer;
      // 204 until the PDF has been generated, "a second or two" after the document is created or changed.
      if (!answer.value.bytes) return fail({ kind: 'not_ready', message: 'The PDF is not generated yet.' });
      return ok(answer.value.bytes);
    },

    async issueCorrection(input: CorrectionInput): Promise<Result<Issued>> {
      const refused = checkDraft(input);
      if (refused) return fail(refused);

      const existing = await findDocument(input.refundReference, 'correction');
      if (!existing.ok) return existing;
      if (existing.value) return ok({ document: existing.value, created: false });

      // The correction goes to the invoice's own subject (`subject_id` is required on every document).
      const invoice = await detail(input.invoiceId);
      if (!invoice.ok) return invoice;
      const subjectId = invoice.value.subject_id;
      if (typeof subjectId !== 'number') return fail(unreadable('invoice'));
      if (invoice.value.currency !== input.currency) {
        return fail({
          kind: 'validation',
          message: 'The correction was not sent: its currency is not the invoice\'s.',
          fields: { currency: [`the invoice is in ${String(invoice.value.currency)}`] },
        });
      }
      return create(correctionBody(input, subjectId));
    },
  };
}

/** A subject as we keep it: only the fields we own, so an update never touches what the accountant set by hand. */
export function subjectBody(customer: InvoiceCustomer): Record<string, string> {
  const body: Record<string, string> = {
    custom_id: customer.reference,
    // A company is invoiced under its own name, with the person as the contact.
    name: customer.company?.name ?? customer.name,
    email: customer.email,
  };
  if (customer.company) body.full_name = customer.name;
  if (customer.company?.companyId) body.registration_no = customer.company.companyId;
  if (customer.company?.vatId) body.vat_no = customer.company.vatId;
  if (customer.address) {
    body.street = customer.address.street;
    body.city = customer.address.city;
    body.zip = customer.address.zip;
    body.country = customer.address.country;
  }
  return body;
}

/** The fields an invoice and a correction share. `sign` is -1 for a correction's lines. */
function documentBody(draft: DocumentDraft, sign: 1 | -1): Json {
  const body: Json = {
    issued_on: draft.issuedOn,
    currency: draft.currency,
    language: LANGUAGE[draft.language],
    vat_price_mode: VAT_PRICE_MODE[draft.priceMode],
    tags: [draft.tag],
    lines: draft.lines.map((line) => {
      const wire: Json = {
        name: line.name,
        quantity: String(line.quantity),
        // Money leaves as a decimal string in major units; `toDecimal` is the only conversion.
        unit_price: toDecimal(sign * line.unitPrice, draft.currency),
        vat_rate: line.vatRate,
      };
      if (line.unit) wire.unit_name = line.unit;
      return wire;
    }),
  };
  if (draft.taxableSupplyOn) body.taxable_fulfillment_due = draft.taxableSupplyOn;
  if (draft.exchangeRate) body.exchange_rate = draft.exchangeRate;
  if (draft.note) body.note = draft.note;
  if (draft.footerNote) body.footer_note = draft.footerNote;
  return body;
}

/** The body of `POST /invoices.json` for an order. */
export function invoiceBody(input: InvoiceInput): Json {
  const body: Json = {
    // `custom_id` is what a repeated create finds; `order_number` is the same reference where a person reads it.
    custom_id: input.orderReference,
    order_number: input.orderReference,
    document_type: 'invoice',
    subject_id: Number(input.customerId),
    ...documentBody(input, 1),
  };
  if (input.paymentMethod) body.payment_method = input.paymentMethod;
  return body;
}

/**
 * The body of `POST /invoices.json` for a corrective document.
 *
 * UNVERIFIED: the documentation gives `document_type` and `correction_id` and nothing on the lines' sign. A
 * corrective document reduces what was invoiced, so the lines are sent with negated unit prices (quantities as on
 * the invoice). To be confirmed on the account with the first real refund, before this is relied on.
 */
export function correctionBody(input: CorrectionInput, subjectId: number): Json {
  return {
    custom_id: input.refundReference,
    document_type: 'correction',
    correction_id: Number(input.invoiceId),
    subject_id: subjectId,
    ...documentBody(input, -1),
  };
}

/** The body of `POST /invoices/{id}/payments.json`. */
export function paymentBody(payment: PaymentInput): Json {
  const body: Json = { paid_on: payment.paidOn, amount: toDecimal(payment.amount.amount, payment.amount.currency) };
  // `mark_document_as_paid` is left to its default (true once the payments cover what remains), so a part payment
  // does not close the invoice. The thank-you e-mail is documented as needing it true, so the two travel together.
  if (payment.sendThankYouEmail !== undefined) {
    body.send_thank_you_email = payment.sendThankYouEmail;
    if (payment.sendThankYouEmail) body.mark_document_as_paid = true;
  }
  return body;
}

/** A document from Fakturoid's JSON, or `unexpected` when what we rely on is not there. */
function readDocument(json: unknown): Result<InvoiceDocument> {
  if (!isRecord(json)) return fail(unreadable('invoice'));
  const id = readId(json.id);
  const kind = json.document_type === 'correction' ? 'correction' : json.document_type === 'invoice' ? 'invoice' : undefined;
  const total = isCurrency(json.currency) && (typeof json.total === 'string' || typeof json.total === 'number') ? fromDecimal(json.total, json.currency) : undefined;
  if (!id || !kind || total === undefined || !isCurrency(json.currency) || typeof json.number !== 'string' || typeof json.public_html_url !== 'string') {
    return fail(unreadable('invoice'));
  }
  const document: InvoiceDocument = {
    id,
    kind,
    number: json.number,
    reference: typeof json.custom_id === 'string' ? json.custom_id : '',
    paid: json.status === 'paid',
    total: { amount: total, currency: json.currency },
    publicUrl: json.public_html_url,
  };
  // On a correction `correction_id` is the corrected invoice (on that invoice it points back at the correction).
  const corrected = readId(json.correction_id);
  if (kind === 'correction' && corrected) document.correctsInvoiceId = corrected;
  return ok(document);
}

/**
 * A failed response as one of our errors. Fakturoid has two bodies: `{ errors: { field: [..] } }` (always for 422,
 * sometimes otherwise) and `{ error, error_description }`.
 */
export async function readError(response: Response): Promise<InvoicingError> {
  const body: unknown = await response.json().catch(() => undefined);
  const record = isRecord(body) ? body : {};
  const fields = readFields(record.errors);
  const code = typeof record.error === 'string' ? record.error : undefined;
  const message =
    typeof record.error_description === 'string'
      ? record.error_description
      : Object.entries(fields)
          .map(([name, problems]) => `${name}: ${problems.join(', ')}`)
          .join('; ') || `Fakturoid answered ${response.status}.`;
  const { status } = response;

  if (status === 422) return { kind: 'validation', message, fields };
  if (status === 429) return { kind: 'rate_limited', message, retryAfterSeconds: retryAfter(response.headers) };
  if (status === 401) return { kind: 'unauthorized', message };
  // 402: the account is blocked over an unpaid Fakturoid invoice. 403: the plan's limits, a missing bank account,
  // a locked or already paid document, e-mail quota.
  if (status === 402) return { kind: 'forbidden', message, code: code ?? 'account_blocked' };
  if (status === 403) return { kind: 'forbidden', message, code };
  if (status === 404) return { kind: 'not_found', message };
  if (status >= 500) return { kind: 'unavailable', message, status };
  return { kind: 'unexpected', message, status };
}

function readFields(errors: unknown): Record<string, string[]> {
  if (!isRecord(errors)) return {};
  return Object.fromEntries(
    Object.entries(errors).map(([name, problems]) => [name, Array.isArray(problems) ? problems.map(String) : [String(problems)]]),
  );
}

/** Seconds until the limit resets, from `X-RateLimit: default;r=0;t=55` (the `t` parameter). */
export function retryAfter(headers: Headers): number | undefined {
  const match = /(?:^|;)\s*t=(\d+)/.exec(headers.get('X-RateLimit') ?? '');
  return match ? Number(match[1]) : undefined;
}

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Fakturoid's IDs are integers; ours are their digits, which also keeps anything else out of a URL. */
const isId = (id: string): boolean => /^\d+$/.test(id);

const readId = (value: unknown): string | undefined => (typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : undefined);

const notAnId = (what: string, id: string): InvoicingError => ({ kind: 'not_found', message: `Not a Fakturoid ${what} ID: ${JSON.stringify(id)}.` });

const unreadable = (what: string): InvoicingError => ({ kind: 'unexpected', message: `Fakturoid's ${what} could not be read.` });
