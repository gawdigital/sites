// The studio's catalogue: everything the specification calls an admin item (services, technicians, prices, add-ons,
// discounts, the VAT rate, the queue weights) is data of this shape, passed into `quote` and the queue. Nothing
// here is logic; `EXAMPLE_CATALOGUE` holds the starting prices of issue #29 and is an example, not the price list.
import type { TechnicianId, TechnicianRef } from '../shared/technician.ts';
import type { Currency, Prices } from './money.ts';

/** The four kinds of work the technicians' queue holds. AI-assisted work is curated, so it queues too. */
export const QUEUE_KINDS = ['mix', 'mastering', 'ai-mix', 'ai-mastering'] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

/**
 * Load is counted in integer units, `LOAD_UNIT` (1000) being one plain mix track, so that kinds add up in one
 * queue and half a track (500) needs no float. A technician doing "6 mixes or 15 masters" a week has a capacity
 * of 6000, with a mix weighing 1000 and a master 400.
 */
export const LOAD_UNIT = 1000;

/** The customer's choice when they name no technician. */
export const ANYONE = 'anyone';

/**
 * A technician as the catalogue lists one. The id is the shared one (`../shared/technician.ts`): the booking's
 * technician with the same id is the same person, and `technicianProblems` checks that the two lists agree.
 */
export interface Technician extends TechnicianRef {
  name: string;
  /** What the technician gets through in a week, in load units. */
  weeklyCapacity: number;
}

/** A per-track service. A technician offers it by having a price for it. */
export interface TrackService {
  id: string;
  name: string;
  kind: QueueKind;
  /** The weight of one track in the queue, in load units. */
  load: number;
  /** Price per track by technician id; the price may differ per technician. */
  prices: Record<TechnicianId, Prices>;
  /** Price per track when the customer chooses "anyone"; without it, the lowest technician price applies. */
  anyonePrices?: Prices;
}

/** A per-track extra (post-production, editing, tuning, stems, express …). */
export interface AddOn {
  id: string;
  name: string;
  /** The kinds of service it can be added to. */
  kinds: readonly QueueKind[];
  /** Price per track. */
  prices: Prices;
  /** Load it adds per track, in load units (post-production: 500, half a track); 0 for none. */
  load: number;
}

/** A quantity discount: `rateBp` off every order line of the listed kinds that has at least `minTracks` tracks. */
export interface DiscountRule {
  id: string;
  name: string;
  kinds: readonly QueueKind[];
  minTracks: number;
  rateBp: number;
  /** Whether the line's add-ons are discounted with the service, or the service price alone. */
  includesAddOns: boolean;
}

/**
 * Recording in the studio: sold as a fixed block, a whole day, or by the hour for a free window. The hours here
 * are what is sold; when the blocks are is the booking's (`BookingSettings`), and the booking's
 * `recordingProblems` checks that the two agree.
 */
export interface RecordingPrices {
  block: { hours: number; prices: Prices };
  day: { hours: number; prices: Prices };
  /** Price of one hour of a free window. */
  hour: Prices;
  /** A free window is a positive multiple of this many minutes. */
  windowStepMinutes: number;
}

export interface Catalogue {
  /** The VAT rate on everything the studio sells, in basis points. */
  vatRateBp: number;
  /**
   * Per currency, whether the catalogue's prices in it include VAT. `false`: prices are net and VAT is added on
   * top; `true`: prices are what the customer pays and the VAT is taken out of them.
   */
  pricesIncludeVat: Record<Currency, boolean>;
  technicians: readonly Technician[];
  recording?: RecordingPrices;
  services: readonly TrackService[];
  addOns: readonly AddOn[];
  discounts: readonly DiscountRule[];
}

/**
 * The starting points of issue #29, to be refined in the admin: an example and the tests' fixture, not a price
 * list. Recording is 800 Kč an hour net (a 4 h block 3,200 Kč, a day 6,400 Kč); mix and mastering are the old
 * store's EUR prices, taken as net until the owner says otherwise. No add-on has a price yet, so none is listed.
 * The capacities and weights are the specification's "6 mixes or 15 masters" for every technician; the weights of
 * mix with preprocess and of the AI kinds are guesses. The two AI-assisted services are placeholders: their
 * prices, their weights and who curates them are the owner's to decide.
 */
export const EXAMPLE_CATALOGUE: Catalogue = {
  vatRateBp: 2100,
  pricesIncludeVat: { CZK: false, EUR: false },
  technicians: [
    { id: 'libor', name: 'Libor', weeklyCapacity: 6 * LOAD_UNIT },
    { id: 'nero', name: 'Nèro', weeklyCapacity: 6 * LOAD_UNIT },
    { id: 'risto', name: 'Risto', weeklyCapacity: 6 * LOAD_UNIT },
  ],
  recording: {
    block: { hours: 4, prices: { CZK: 320_000 } },
    day: { hours: 8, prices: { CZK: 640_000 } },
    hour: { CZK: 80_000 },
    windowStepMinutes: 60,
  },
  services: [
    { id: 'mix', name: 'Mix', kind: 'mix', load: 1000, prices: { libor: { EUR: 20_000 }, nero: { EUR: 30_000 } } },
    {
      id: 'mix-preprocess',
      name: 'Mix with Preprocess',
      kind: 'mix',
      load: 1500,
      prices: { libor: { EUR: 40_000 }, nero: { EUR: 50_000 } },
    },
    {
      id: 'mastering',
      name: 'Mastering',
      kind: 'mastering',
      load: 400,
      prices: { libor: { EUR: 10_000 }, risto: { EUR: 18_000 } },
    },
    // AI-assisted work is curated by a technician, so it is priced per technician like the rest and queues too.
    { id: 'ai-mix', name: 'AI Mix', kind: 'ai-mix', load: 300, prices: { libor: { EUR: 5_000 } } },
    { id: 'ai-mastering', name: 'AI Mastering', kind: 'ai-mastering', load: 100, prices: { libor: { EUR: 2_500 } } },
  ],
  addOns: [],
  discounts: [
    {
      id: 'quantity-5',
      name: 'Quantity discount',
      kinds: ['mix', 'mastering'],
      minTracks: 5,
      rateBp: 500,
      includesAddOns: false,
    },
  ],
};

/** The technicians who offer a service in a currency, in catalogue order: the candidates for "anyone". */
export function techniciansFor(catalogue: Catalogue, serviceId: string, currency: Currency): Technician[] {
  const service = catalogue.services.find((s) => s.id === serviceId);
  if (!service) return [];
  return catalogue.technicians.filter((t) => Object.hasOwn(service.prices, t.id) && service.prices[t.id]![currency] !== undefined);
}
