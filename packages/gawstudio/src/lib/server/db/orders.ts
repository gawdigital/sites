// Orders on D1: the lifecycle record (`Order`, `../orders/lifecycle.ts`) together with the quote it was priced
// with (`Quote`, `../orders/quote.ts`), who it belongs to, and a revision.
//
// The order's state machine is pure, so two requests can each read an order, move it and write it back. The
// revision decides between them: `update` names the revision it read, every statement of its batch applies only
// while the order still has it, and the last one moves it on. The batch is one transaction, so either all of an
// update is stored or none of it, and the caller that gets `false` reads the order again.
//
// The ISO instants of `Order` are stored as epoch milliseconds and come back as the same strings.
import { FLOWS, ORDER_STATES } from '../orders/lifecycle.ts';
import type { Order } from '../orders/lifecycle.ts';
import { QUEUE_KINDS } from '../orders/catalogue.ts';
import { CURRENCIES } from '../orders/money.ts';
import type { CompanyDetails, Quote, QuoteLine, WorkItem } from '../orders/quote.ts';
import { changesOf, isoOf, MAX_BOUND_PARAMETERS, msOf, oneOf, rowsOf } from './d1.ts';
import type { D1Like, D1ResultLike, D1StatementLike, D1Value } from './d1.ts';

/** An order as it is kept. */
export interface StoredOrder {
  order: Order;
  /** The pricing the customer accepted: the lines for the invoice, the totals, the work for the queue. */
  quote: Quote;
  /** `null` until an account is known, and again once the account is deleted. */
  accountId: string | null;
  /** The address the order form gave, normalised; `null` once anonymised. */
  email: string | null;
  createdAt: number;
  /** How many times the order has been written since it was inserted. `0` for a new one. */
  revision: number;
}

interface OrderRow {
  id: string;
  revision: number;
  account_id: string | null;
  email: string | null;
  flow: string;
  state: string;
  state_since: number;
  delivered_at: number | null;
  expected_delivery: string | null;
  currency: string;
  prices_include_vat: number;
  vat_rate_bp: number;
  subtotal: number;
  vat: number;
  total: number;
  company_name: string | null;
  company_id: string | null;
  company_vat_id: string | null;
  created_at: number;
}

interface HistoryRow {
  order_id: string;
  seq: number;
  state: string;
  at: number;
}

interface LineRow {
  order_id: string;
  position: number;
  type: string;
  code: string;
  description: string;
  technician: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  amount: number;
  vat_rate_bp: number;
}

interface WorkRow {
  order_id: string;
  position: number;
  service: string;
  kind: string;
  technician: string;
  tracks: number;
  load: number;
}

const LINE_TYPES: readonly QuoteLine['type'][] = ['recording', 'service', 'addon', 'discount'];
const LINE_UNITS: readonly QuoteLine['unit'][] = ['session', 'hour', 'track', 'discount'];

/** Applies only while the order (`?1`) is at the revision (`?2`) the caller read. */
const UNCHANGED = 'EXISTS (SELECT 1 FROM orders WHERE id = ?1 AND revision = ?2)';

function line(row: LineRow): QuoteLine {
  return {
    type: oneOf(LINE_TYPES, row.type, 'order_lines.type'),
    code: row.code,
    description: row.description,
    ...(row.technician === null ? {} : { technician: row.technician }),
    quantity: row.quantity,
    unit: oneOf(LINE_UNITS, row.unit, 'order_lines.unit'),
    unitPrice: row.unit_price,
    amount: row.amount,
    vatRateBp: row.vat_rate_bp,
  };
}

const work = (row: WorkRow): WorkItem => ({
  service: row.service,
  kind: oneOf(QUEUE_KINDS, row.kind, 'order_work.kind'),
  technician: row.technician,
  tracks: row.tracks,
  load: row.load,
});

function company(row: OrderRow): CompanyDetails | undefined {
  if (row.company_name === null && row.company_id === null && row.company_vat_id === null) return undefined;
  return {
    ...(row.company_name === null ? {} : { name: row.company_name }),
    ...(row.company_id === null ? {} : { companyId: row.company_id }),
    ...(row.company_vat_id === null ? {} : { vatId: row.company_vat_id }),
  };
}

function stored(row: OrderRow, history: HistoryRow[], lines: LineRow[], workRows: WorkRow[]): StoredOrder {
  const details = company(row);
  return {
    order: {
      id: row.id,
      flow: oneOf(FLOWS, row.flow, 'orders.flow'),
      state: oneOf(ORDER_STATES, row.state, 'orders.state'),
      stateSince: isoOf(row.state_since),
      ...(row.delivered_at === null ? {} : { deliveredAt: isoOf(row.delivered_at) }),
      ...(row.expected_delivery === null ? {} : { expectedDelivery: row.expected_delivery }),
      history: history.map((h) => ({ state: oneOf(ORDER_STATES, h.state, 'order_history.state'), at: isoOf(h.at) })),
    },
    quote: {
      currency: oneOf(CURRENCIES, row.currency, 'orders.currency'),
      pricesIncludeVat: row.prices_include_vat === 1,
      vatRateBp: row.vat_rate_bp,
      lines: lines.map(line),
      subtotal: row.subtotal,
      vat: row.vat,
      total: row.total,
      work: workRows.map(work),
      ...(details ? { company: details } : {}),
    },
    accountId: row.account_id,
    email: row.email,
    createdAt: row.created_at,
    revision: row.revision,
  };
}

/** The columns of `orders` an update may change, in the order `fields` gives their values. */
const FIELDS = [
  'account_id',
  'email',
  'flow',
  'state',
  'state_since',
  'delivered_at',
  'expected_delivery',
  'currency',
  'prices_include_vat',
  'vat_rate_bp',
  'subtotal',
  'vat',
  'total',
  'company_name',
  'company_id',
  'company_vat_id',
] as const;

function fields({ order, quote, accountId, email }: StoredOrder): D1Value[] {
  return [
    accountId,
    email,
    order.flow,
    order.state,
    msOf(order.stateSince),
    order.deliveredAt === undefined ? null : msOf(order.deliveredAt),
    order.expectedDelivery ?? null,
    quote.currency,
    quote.pricesIncludeVat ? 1 : 0,
    quote.vatRateBp,
    quote.subtotal,
    quote.vat,
    quote.total,
    quote.company?.name ?? null,
    quote.company?.companyId ?? null,
    quote.company?.vatId ?? null,
  ];
}

function groupByOrder<T extends { order_id: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.order_id);
    if (group) group.push(row);
    else groups.set(row.order_id, [row]);
  }
  return groups;
}

export class OrderRepository {
  readonly #db: D1Like;

  constructor(db: D1Like) {
    this.#db = db;
  }

  /**
   * Stores a new order, with its history, lines and work, at revision 0 (whatever `revision` says). An id that
   * is already taken is a programming error and throws; nothing is stored then.
   */
  async insert(order: StoredOrder): Promise<void> {
    await this.#db.batch(this.insertStatements(order));
  }

  /**
   * The statements of `insert`, for a caller that stores something else in the same batch (the checkout's store
   * puts its own row after them, so an order and its checkout exist together or not at all).
   */
  insertStatements(order: StoredOrder): D1StatementLike[] {
    const fresh = { ...order, revision: 0 };
    const columns = ['id', 'revision', 'created_at', ...FIELDS];
    return [
      this.#db
        .prepare(`INSERT INTO orders (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
        .bind(fresh.order.id, 0, fresh.createdAt, ...fields(fresh)),
      ...this.#children(fresh),
    ];
  }

  /**
   * Writes the order back: `true` when it was still at `order.revision` and is now one further, `false` when
   * another write came first (or there is no such order) and nothing was stored. The history only grows: entries
   * already stored are left as they are. The lines and the work are replaced, so a requote is an update too.
   */
  async update(order: StoredOrder): Promise<boolean> {
    const results = await this.#db.batch(this.updateStatements(order));
    return changesOf(results.at(-1)) === 1;
  }

  /**
   * The statements of `update`: the last one moves the revision on, and changed one row exactly when the update
   * took. A caller's own statements go before it, each conditional on the revision in the same way
   * (`EXISTS (SELECT 1 FROM orders WHERE id = ? AND revision = ?)`). With `keepOwner` the account and the
   * address are left as they are stored: for a caller that does not own them (the checkout, which must not undo
   * a `claim` or an `anonymise` it has not seen; both move the revision, so it would be refused anyway).
   */
  updateStatements(order: StoredOrder, { keepOwner = false }: { keepOwner?: boolean } = {}): D1StatementLike[] {
    const { id } = order.order;
    const values = fields(order);
    const sets = FIELDS.map((field, i) => ({ field, value: values[i]! })).filter(({ field }) => !(keepOwner && (field === 'account_id' || field === 'email')));
    return [
      this.#db.prepare(`DELETE FROM order_lines WHERE order_id = ?1 AND ${UNCHANGED}`).bind(id, order.revision),
      this.#db.prepare(`DELETE FROM order_work WHERE order_id = ?1 AND ${UNCHANGED}`).bind(id, order.revision),
      ...this.#children(order),
      this.#db
        .prepare(`UPDATE orders SET revision = revision + 1, ${sets.map(({ field }, i) => `${field} = ?${i + 3}`).join(', ')} WHERE id = ?1 AND revision = ?2`)
        .bind(id, order.revision, ...sets.map(({ value }) => value)),
    ];
  }

  /** The history, lines and work of an order, each applying only while the order is at its `revision`. */
  #children({ order, quote, revision }: StoredOrder): D1StatementLike[] {
    const history = () => this.#db.prepare(
      `INSERT INTO order_history (order_id, seq, state, at) SELECT ?1, ?3, ?4, ?5 WHERE ${UNCHANGED} ON CONFLICT DO NOTHING`,
    );
    const lines = () => this.#db.prepare(
      `INSERT INTO order_lines (order_id, position, type, code, description, technician, quantity, unit, unit_price, amount, vat_rate_bp)
       SELECT ?1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12 WHERE ${UNCHANGED}`,
    );
    const workItems = () => this.#db.prepare(
      `INSERT INTO order_work (order_id, position, service, kind, technician, tracks, load)
       SELECT ?1, ?3, ?4, ?5, ?6, ?7, ?8 WHERE ${UNCHANGED}`,
    );
    return [
      ...order.history.map((h, seq) => history().bind(order.id, revision, seq, h.state, msOf(h.at))),
      ...quote.lines.map((l, position) =>
        lines().bind(order.id, revision, position, l.type, l.code, l.description, l.technician ?? null, l.quantity, l.unit, l.unitPrice, l.amount, l.vatRateBp),
      ),
      ...quote.work.map((w, position) => workItems().bind(order.id, revision, position, w.service, w.kind, w.technician, w.tracks, w.load)),
    ];
  }

  async get(id: string): Promise<StoredOrder | undefined> {
    return (await this.#select('id = ?', [id]))[0];
  }

  /** An account's orders, oldest first. */
  ofAccount(accountId: string): Promise<StoredOrder[]> {
    return this.#select('account_id = ?', [accountId]);
  }

  /** The orders placed with an address (whether or not an account has claimed them), oldest first. */
  ofEmail(email: string): Promise<StoredOrder[]> {
    return this.#select('email = ?', [email]);
  }

  /** The orders in any of the states, oldest first: what the queue and the overdue list are computed from. */
  async inStates(states: readonly Order['state'][]): Promise<StoredOrder[]> {
    if (states.length === 0) return [];
    if (states.length > MAX_BOUND_PARAMETERS) throw new RangeError('db: more states than a statement binds');
    return this.#select(`state IN (${states.map(() => '?').join(', ')})`, [...states]);
  }

  /** Whole orders in one batch of four queries, however many match. */
  async #select(where: string, params: D1Value[]): Promise<StoredOrder[]> {
    return this.assemble(await this.#db.batch(this.selectStatements(where, params)));
  }

  /**
   * The four queries that read whole orders, for a caller that reads something else in the same batch; `where`
   * is a condition on `orders` written by that caller, never text from outside. `assemble` takes their results.
   */
  selectStatements(where: string, params: D1Value[] = []): D1StatementLike[] {
    const matching = `SELECT id FROM orders WHERE ${where}`;
    return [
      this.#db.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY created_at, id`).bind(...params),
      this.#db.prepare(`SELECT * FROM order_history WHERE order_id IN (${matching}) ORDER BY order_id, seq`).bind(...params),
      this.#db.prepare(`SELECT * FROM order_lines WHERE order_id IN (${matching}) ORDER BY order_id, position`).bind(...params),
      this.#db.prepare(`SELECT * FROM order_work WHERE order_id IN (${matching}) ORDER BY order_id, position`).bind(...params),
    ];
  }

  /** The orders in the results of `selectStatements`, oldest first. */
  assemble(results: readonly D1ResultLike[]): StoredOrder[] {
    const [orders, history, lines, workRows] = results;
    const historyOf = groupByOrder(rowsOf<HistoryRow>(history));
    const linesOf = groupByOrder(rowsOf<LineRow>(lines));
    const workOf = groupByOrder(rowsOf<WorkRow>(workRows));
    return rowsOf<OrderRow>(orders).map((row) => stored(row, historyOf.get(row.id) ?? [], linesOf.get(row.id) ?? [], workOf.get(row.id) ?? []));
  }

  /** Gives the orders placed with an address to an account, where no account has them yet. Returns how many. */
  async claim(email: string, accountId: string): Promise<number> {
    const result = await this.#db
      .prepare('UPDATE orders SET account_id = ?1, revision = revision + 1 WHERE email = ?2 AND account_id IS NULL')
      .bind(accountId, email)
      .run();
    return changesOf(result);
  }

  /**
   * Cuts an order loose from its customer (the `anonymise` of the accounts' `DeletionPlan`): the account, the
   * address and the company details go; the lifecycle, the lines and the amounts stay. Which fields the law lets
   * go is the owner's and the accountant's decision: this removes every one that names the customer.
   */
  async anonymise(orderId: string): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `UPDATE orders SET revision = revision + 1, account_id = NULL, email = NULL,
                company_name = NULL, company_id = NULL, company_vat_id = NULL
         WHERE id = ?`,
      )
      .bind(orderId)
      .run();
    return changesOf(result) === 1;
  }
}
