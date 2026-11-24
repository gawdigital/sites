// References to the documents the invoicing provider issued (`InvoiceDocument`, `../invoicing/types.ts`): which
// order has which invoice and which corrective documents. The documents themselves stay at the provider.
import type { DocumentKind, InvoiceDocument } from '../invoicing/types.ts';
import { changesOf, oneOf, rowsOf } from './d1.ts';
import type { D1Like } from './d1.ts';

interface InvoiceRow {
  provider: string;
  document_id: string;
  order_id: string;
  kind: string;
  number: string;
  reference: string;
  paid: number;
  total: number;
  currency: string;
  public_url: string;
  corrects_document_id: string | null;
  created_at: number;
  updated_at: number;
}

const KINDS: readonly DocumentKind[] = ['invoice', 'correction'];
const CURRENCIES: readonly InvoiceDocument['total']['currency'][] = ['CZK', 'EUR'];

const document = (row: InvoiceRow): InvoiceDocument => ({
  id: row.document_id,
  kind: oneOf(KINDS, row.kind, 'invoices.kind'),
  number: row.number,
  reference: row.reference,
  paid: row.paid === 1,
  total: { amount: row.total, currency: oneOf(CURRENCIES, row.currency, 'invoices.currency') },
  publicUrl: row.public_url,
  ...(row.corrects_document_id === null ? {} : { correctsInvoiceId: row.corrects_document_id }),
});

export class InvoiceRepository {
  readonly #db: D1Like;
  readonly #provider: string;

  /** `provider` names the invoicing provider whose ids these are (`fakturoid`), so a change of provider cannot mix them. */
  constructor(db: D1Like, provider: string) {
    this.#db = db;
    this.#provider = provider;
  }

  /**
   * Notes a document issued for an order, or brings a known one up to date (paid, number, total, public page).
   * `false` when the document's reference already has a different document of that kind: an order has one
   * invoice and a refund one corrective document, and the caller has issued a second. The order must exist.
   */
  async save(orderId: string, doc: InvoiceDocument, now: number): Promise<boolean> {
    const [, updated] = await this.#db.batch([
      this.#db
        .prepare(
          `INSERT INTO invoices (provider, document_id, order_id, kind, number, reference, paid, total, currency,
                                 public_url, corrects_document_id, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12) ON CONFLICT DO NOTHING`,
        )
        .bind(
          this.#provider,
          doc.id,
          orderId,
          doc.kind,
          doc.number,
          doc.reference,
          doc.paid ? 1 : 0,
          doc.total.amount,
          doc.total.currency,
          doc.publicUrl,
          doc.correctsInvoiceId ?? null,
          now,
        ),
      this.#db
        .prepare(
          `UPDATE invoices SET number = ?3, paid = ?4, total = ?5, currency = ?6, public_url = ?7, updated_at = ?8
           WHERE provider = ?1 AND document_id = ?2 AND order_id = ?9 AND kind = ?10 AND reference = ?11`,
        )
        .bind(this.#provider, doc.id, doc.number, doc.paid ? 1 : 0, doc.total.amount, doc.total.currency, doc.publicUrl, now, orderId, doc.kind, doc.reference),
    ]);
    return changesOf(updated) === 1;
  }

  async get(documentId: string): Promise<InvoiceDocument | undefined> {
    const row = await this.#db
      .prepare('SELECT * FROM invoices WHERE provider = ? AND document_id = ?')
      .bind(this.#provider, documentId)
      .first<InvoiceRow>();
    return row ? document(row) : undefined;
  }

  /** The document issued for an order reference (`invoice`) or a refund reference (`correction`). */
  async byReference(kind: DocumentKind, reference: string): Promise<InvoiceDocument | undefined> {
    const row = await this.#db
      .prepare('SELECT * FROM invoices WHERE provider = ? AND kind = ? AND reference = ?')
      .bind(this.#provider, kind, reference)
      .first<InvoiceRow>();
    return row ? document(row) : undefined;
  }

  /** An order's documents from this provider, the invoice first, then its corrections in the order they were noted. */
  async ofOrder(orderId: string): Promise<InvoiceDocument[]> {
    const result = await this.#db
      .prepare(`SELECT * FROM invoices WHERE provider = ? AND order_id = ? ORDER BY kind = 'invoice' DESC, created_at, document_id`)
      .bind(this.#provider, orderId)
      .all<InvoiceRow>();
    return rowsOf<InvoiceRow>(result).map(document);
  }
}
