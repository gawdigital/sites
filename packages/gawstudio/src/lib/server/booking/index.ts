// Booking recording sessions: the settings, what a day offers, and holding and confirming a slot. Pure data in,
// data out; the routes, the Durable Object and the calendar come later and call this.
export { DEFAULT_SETTINGS, blocksOn, recordingProblems, settingsProblems } from './settings.ts';
export type { BlockSetting, BookingSettings, DayBlock, RecordingHours } from './settings.ts';

export { availability, daySlots, freeTechnicians, isOffered, isStudioFree } from './availability.ts';
export type { Busy, BusyKind, DayAvailability, DayMode, Interval, Slot, SlotKind, Technician } from './availability.ts';

export { EMPTY_STATE, assignTechnician, busyOf, confirm, confirmLate, expire, hold, nextExpiry, release } from './holds.ts';
export type { BookingContext, BookingState, Hold, HoldRequest, Outcome, Refusal, Session } from './holds.ts';

export { addDays, datesBetween, instantOf, isLocalDate, isWallTime, localDateOf, minutesOf, wallMinutesOf, weekdayOf } from './time.ts';
export type { LocalDate, WallTime, Weekday } from './time.ts';

// The tests' helpers (instants and intervals written as the studio's wall clock: `at`, `between`, `busy`, `span`)
// are this module's testing entry, `./testing.ts`: other modules' tests import them from there.
export type { TechnicianId, TechnicianRef } from '../shared/technician.ts';
