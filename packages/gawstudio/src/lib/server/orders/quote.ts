// Pricing an order from the catalogue. Pure: a catalogue and a request in, a priced order (or the reasons it
// cannot be priced) out.
//
// How the sums are made:
// - Every amount is an integer in the minor unit of the quote's one currency. A quote never mixes currencies; an
//   item with no price in the requested currency is an error, not a conversion.
// - Lines are in the catalogue's price basis for that currency (`pricesIncludeVat`): net or gross, as stored.
// - A discount is a line of its own, negative: the rate of the discounted amount, rounded half away from zero to
//   the minor unit (`percentOf`). When several rules match a line, the highest rate applies; they do not stack.
// - VAT is computed once per quote on the sum of the lines, not per line, so the totals never drift by rounding.
//   Net prices: `vat = round(subtotal × rate)`, `total = subtotal + vat`. Gross prices: `total` is the sum,
//   `subtotal = round(total / (1 + rate))`, `vat = total − subtotal`. Both round half away from zero.
// - Every line's amount is `lineAmount(quantity, unitPrice)` and the totals are `totals` of their sum, both from
//   `../shared/money.ts`. The invoicing computes a document's total with the same two functions from the same
//   quantities and unit prices, so an invoice made from a quote's lines has the quote's total by construction.
import { ANYONE } from './catalogue.ts';
import type { AddOn, Catalogue, DiscountRule, QueueKind, TrackService } from './catalogue.ts';
import { formatRate, lineAmount, percentOf, totals } from './money.ts';
import type { Currency, Prices } from './money.ts';

/** A recording session: a fixed block, a whole day, or a free window paid by the hour. */
export type SessionRequest = ({ type: 'block' | 'day' } | { type: 'window'; minutes: number }) & {
  /** The session's Prague date, for the line's text only; booking the slot is not this module's. */
  date?: string;
};

export interface AddOnRequest {
  id: string;
  /** On how many of the line's tracks; all of them when left out. */
  tracks?: number;
}

export interface TrackRequest {
  service: string;
  /** A technician id, or `ANYONE`. */
  technician: string;
  tracks: number;
  addOns?: readonly AddOnRequest[];
}

/** The order form's optional company details, carried to the invoice untouched. */
export interface CompanyDetails {
  name?: string;
  companyId?: string;
  vatId?: string;
}

export interface QuoteRequest {
  currency: Currency;
  recording?: readonly SessionRequest[];
  tracks?: readonly TrackRequest[];
  company?: CompanyDetails;
}

/** One invoice-ready line. `description` is English; `type`, `code` and `technician` let a page word it itself. */
export interface QuoteLine {
  type: 'recording' | 'service' | 'addon' | 'discount';
  /** The catalogue item: `block`, `day` or `hour` for recording, else the service, add-on or discount id. */
  code: string;
  description: string;
  technician?: string;
  /** Sessions, hours (a window may be a fraction of an hour), tracks; 1 for a discount. */
  quantity: number;
  unit: 'session' | 'hour' | 'track' | 'discount';
  /** In the quote's price basis, minor units. */
  unitPrice: number;
  /** In the quote's price basis, minor units; negative for a discount. */
  amount: number;
  vatRateBp: number;
}

/** What an order line puts into a technician's queue. */
export interface WorkItem {
  service: string;
  kind: QueueKind;
  /** A technician id, or `ANYONE`. */
  technician: string;
  tracks: number;
  /** Tracks × the service's weight, plus the add-ons' load, in load units. */
  load: number;
}

export interface Quote {
  currency: Currency;
  /** The basis of the lines' amounts. */
  pricesIncludeVat: boolean;
  vatRateBp: number;
  lines: QuoteLine[];
  /** Net of VAT. */
  subtotal: number;
  vat: number;
  /** What the customer pays. */
  total: number;
  work: WorkItem[];
  company?: CompanyDetails;
}

export type QuoteErrorCode =
  | 'empty'
  | 'no-recording'
  | 'invalid-session'
  | 'unknown-service'
  | 'unknown-technician'
  | 'not-offered'
  | 'invalid-tracks'
  | 'unknown-addon'
  | 'addon-not-applicable'
  | 'duplicate-addon'
  | 'invalid-addon-tracks'
  | 'no-price';

export interface QuoteError {
  code: QuoteErrorCode;
  /** Where in the request: `recording[0]`, `tracks[1].addOns[0]`. */
  path: string;
}

export type QuoteResult = { ok: true; quote: Quote } | { ok: false; errors: QuoteError[] };

type Draft = { lines: QuoteLine[]; work: WorkItem[]; errors: QuoteError[]; currency: Currency; vatRateBp: number };

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

/** A catalogue amount is usable only as a non-negative integer. */
const priceIn = (prices: Prices | undefined, currency: Currency): number | undefined => {
  const p = prices?.[currency];
  return p !== undefined && Number.isSafeInteger(p) && p >= 0 ? p : undefined;
};

/**
 * The per-track price of a service for the customer's choice. "Anyone" pays the catalogue's `anyonePrices`, or
 * else the lowest price any technician asks: nobody pays more for not choosing.
 */
export function trackPrice(service: TrackService, technician: string, currency: Currency): number | undefined {
  if (technician !== ANYONE) return Object.hasOwn(service.prices, technician) ? priceIn(service.prices[technician], currency) : undefined;
  const fixed = priceIn(service.anyonePrices, currency);
  if (fixed !== undefined) return fixed;
  const asked = Object.values(service.prices).flatMap((p) => priceIn(p, currency) ?? []);
  return asked.length ? Math.min(...asked) : undefined;
}

/** The rule that takes the most off a line of this kind and size, if any. */
export function discountFor(rules: readonly DiscountRule[], kind: QueueKind, tracks: number): DiscountRule | undefined {
  let best: DiscountRule | undefined;
  for (const rule of rules) {
    if (!rule.kinds.includes(kind) || tracks < rule.minTracks || rule.rateBp <= 0) continue;
    if (!best || rule.rateBp > best.rateBp) best = rule;
  }
  return best;
}

function priceSession(catalogue: Catalogue, session: SessionRequest, path: string, draft: Draft): void {
  const recording = catalogue.recording;
  if (!recording) return void draft.errors.push({ code: 'no-recording', path });
  const on = session.date ? ` (${session.date})` : '';
  const base = { type: 'recording', vatRateBp: draft.vatRateBp } as const;

  if (session.type === 'window') {
    const step = recording.windowStepMinutes;
    if (!isCount(session.minutes) || !isCount(step) || session.minutes % step !== 0) {
      return void draft.errors.push({ code: 'invalid-session', path });
    }
    const hour = priceIn(recording.hour, draft.currency);
    if (hour === undefined) return void draft.errors.push({ code: 'no-price', path });
    const hours = session.minutes / 60;
    // A window that is not whole hours is rounded to the minor unit, half away from zero.
    const amount = lineAmount(hours, hour);
    draft.lines.push({ ...base, code: 'hour', description: `Recording, ${hours} h${on}`, quantity: hours, unit: 'hour', unitPrice: hour, amount });
    return;
  }

  if (session.type !== 'block' && session.type !== 'day') return void draft.errors.push({ code: 'invalid-session', path });
  const item = recording[session.type];
  const price = priceIn(item.prices, draft.currency);
  if (price === undefined) return void draft.errors.push({ code: 'no-price', path });
  const what = session.type === 'block' ? `${item.hours} h block` : `whole day (${item.hours} h)`;
  draft.lines.push({ ...base, code: session.type, description: `Recording, ${what}${on}`, quantity: 1, unit: 'session', unitPrice: price, amount: lineAmount(1, price) });
}

/** The add-ons of one track line, validated: their lines and load, or `undefined` once an error was noted. */
function priceAddOns(
  catalogue: Catalogue,
  service: TrackService,
  request: TrackRequest,
  path: string,
  draft: Draft,
): { lines: QuoteLine[]; load: number } | undefined {
  const lines: QuoteLine[] = [];
  const seen = new Set<string>();
  let load = 0;
  let failed = false;
  (request.addOns ?? []).forEach((wanted, i) => {
    const at = `${path}.addOns[${i}]`;
    const fail = (code: QuoteErrorCode) => {
      draft.errors.push({ code, path: at });
      failed = true;
    };
    const addOn: AddOn | undefined = catalogue.addOns.find((a) => a.id === wanted.id);
    if (!addOn) return fail('unknown-addon');
    if (!addOn.kinds.includes(service.kind)) return fail('addon-not-applicable');
    if (seen.has(addOn.id)) return fail('duplicate-addon');
    seen.add(addOn.id);
    const tracks = wanted.tracks ?? request.tracks;
    if (!isCount(tracks) || tracks > request.tracks) return fail('invalid-addon-tracks');
    const price = priceIn(addOn.prices, draft.currency);
    if (price === undefined) return fail('no-price');
    load += Math.max(0, addOn.load) * tracks;
    lines.push({
      type: 'addon',
      code: addOn.id,
      description: `${addOn.name} (${service.name})`,
      technician: request.technician,
      quantity: tracks,
      unit: 'track',
      unitPrice: price,
      amount: lineAmount(tracks, price),
      vatRateBp: draft.vatRateBp,
    });
  });
  return failed ? undefined : { lines, load };
}

function priceTracks(catalogue: Catalogue, request: TrackRequest, path: string, draft: Draft): void {
  const service = catalogue.services.find((s) => s.id === request.service);
  if (!service) return void draft.errors.push({ code: 'unknown-service', path });
  if (!isCount(request.tracks)) return void draft.errors.push({ code: 'invalid-tracks', path });

  const technician = catalogue.technicians.find((t) => t.id === request.technician);
  if (request.technician !== ANYONE) {
    if (!technician) return void draft.errors.push({ code: 'unknown-technician', path });
    if (!Object.hasOwn(service.prices, technician.id)) return void draft.errors.push({ code: 'not-offered', path });
  }
  const price = trackPrice(service, request.technician, draft.currency);
  if (price === undefined) return void draft.errors.push({ code: 'no-price', path });

  const addOns = priceAddOns(catalogue, service, request, path, draft);
  if (!addOns) return;

  const by = technician ? ` — ${technician.name}` : '';
  const line: QuoteLine = {
    type: 'service',
    code: service.id,
    description: `${service.name}${by}`,
    technician: request.technician,
    quantity: request.tracks,
    unit: 'track',
    unitPrice: price,
    amount: lineAmount(request.tracks, price),
    vatRateBp: draft.vatRateBp,
  };
  draft.lines.push(line, ...addOns.lines);

  const rule = discountFor(catalogue.discounts, service.kind, request.tracks);
  if (rule) {
    const discounted = line.amount + (rule.includesAddOns ? addOns.lines.reduce((sum, l) => sum + l.amount, 0) : 0);
    const amount = -percentOf(discounted, rule.rateBp);
    if (amount !== 0) {
      draft.lines.push({
        type: 'discount',
        code: rule.id,
        description: `${rule.name} −${formatRate(rule.rateBp)} (${service.name}, ${request.tracks} tracks)`,
        technician: request.technician,
        quantity: 1,
        unit: 'discount',
        unitPrice: amount,
        amount,
        vatRateBp: draft.vatRateBp,
      });
    }
  }

  draft.work.push({
    service: service.id,
    kind: service.kind,
    technician: request.technician,
    tracks: request.tracks,
    load: Math.max(0, service.load) * request.tracks + addOns.load,
  });
}

export { totals };

/** Prices an order in the requested currency: every problem in the request is reported, not only the first. */
export function quote(catalogue: Catalogue, request: QuoteRequest): QuoteResult {
  const draft: Draft = { lines: [], work: [], errors: [], currency: request.currency, vatRateBp: catalogue.vatRateBp };
  const sessions = request.recording ?? [];
  const tracks = request.tracks ?? [];
  if (!sessions.length && !tracks.length) draft.errors.push({ code: 'empty', path: '' });

  sessions.forEach((session, i) => priceSession(catalogue, session, `recording[${i}]`, draft));
  tracks.forEach((line, i) => priceTracks(catalogue, line, `tracks[${i}]`, draft));
  if (draft.errors.length) return { ok: false, errors: draft.errors };

  const pricesIncludeVat = catalogue.pricesIncludeVat[request.currency];
  const sum = draft.lines.reduce((total, line) => total + line.amount, 0);
  return {
    ok: true,
    quote: {
      currency: request.currency,
      pricesIncludeVat,
      vatRateBp: catalogue.vatRateBp,
      lines: draft.lines,
      ...totals(sum, catalogue.vatRateBp, pricesIncludeVat),
      work: draft.work,
      ...(request.company ? { company: request.company } : {}),
    },
  };
}
