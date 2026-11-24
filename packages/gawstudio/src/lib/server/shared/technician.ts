// The one notion of "which technician" the server modules share. The catalogue (`orders`) knows a technician's
// name, prices and weekly capacity; the booking knows when a technician is busy. They are the same people, so
// both records carry the same id, and `technicianProblems` says when the two lists disagree.

/** A technician's id: the key of the catalogue's prices, of a hold's and a session's `technicianId`, of the queue. */
export type TechnicianId = string;

/** What every record about a technician has in common. */
export interface TechnicianRef {
  id: TechnicianId;
}

/**
 * What is wrong between the catalogue's technicians and the ones the booking is given, in plain sentences for the
 * admin; empty when they agree. An id may be listed once in each, and whoever can be booked for a session must be
 * in the catalogue (the reverse is fine: a technician may only mix or master).
 */
export function technicianProblems(catalogue: readonly TechnicianRef[], bookable: readonly TechnicianRef[]): string[] {
  const problems: string[] = [];
  const twice = (list: readonly TechnicianRef[]): TechnicianId[] => [...new Set(list.map((t) => t.id).filter((id, i, ids) => ids.indexOf(id) !== i))];
  for (const id of twice(catalogue)) problems.push(`Technician "${id}" is listed twice in the catalogue.`);
  for (const id of twice(bookable)) problems.push(`Technician "${id}" is listed twice for booking.`);
  const known = new Set(catalogue.map((t) => t.id));
  for (const id of new Set(bookable.map((t) => t.id))) {
    if (!known.has(id)) problems.push(`Technician "${id}" can be booked for a session and is not in the catalogue.`);
  }
  return problems;
}
