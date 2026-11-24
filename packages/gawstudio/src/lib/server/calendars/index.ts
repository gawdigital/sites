// The calendars the booking system reads and writes, behind one interface. See `types.ts` for the contract,
// `ical.ts` for what is read from iCalendar (and which recurrences are not), `caldav.ts` and `google.ts` for the
// two services, `conflicts.ts` for the overlap report and `fake.ts` for other modules' tests.

export * from './types.ts';
export { bookingOfGoogleEventId, bookingOfUid, googleEventId, isOurUid, uidForBooking } from './uid.ts';
export { DAY, HOUR, instantToWall, MINUTE, offsetAt, resolveZone, SECOND, wallToInstant, zoned } from './zone.ts';
export {
  busyFromICalendar,
  type CalendarEventText,
  type ContentLine,
  escapeText,
  fold,
  formatUtc,
  parseCalendar,
  type ParsedCalendar,
  parseDuration,
  parseLine,
  parseWhen,
  unescapeText,
  unfold,
  type VEvent,
  type When,
  writeCalendar,
} from './ical.ts';
export { child, type DavResponse, decodeEntities, descendants, escapeXml, parseMultistatus, parseXml, type XmlNode } from './xml.ts';
export {
  basicAuth,
  bookingOfResource,
  type CalDavAccount,
  type CalDavCalendar,
  CalDavClient,
  type CalDavDiscovery,
  type CalDavObject,
  CalDavProvider,
  calendarQueryBody,
  calendarsFrom,
  ICLOUD_CALDAV,
  propfindBody,
  type PutCondition,
  type PutResult,
  resourceUrl,
} from './caldav.ts';
export {
  type ApiRequest,
  CHANNEL_ID_MAX,
  CHANNEL_TOKEN_MAX,
  deleteRequest,
  eventBody,
  FREEBUSY_MAX_CALENDARS,
  freeBusyRequests,
  GOOGLE_CALENDAR_API,
  GoogleCalendar,
  insertRequest,
  isFromChannel,
  parsePushHeaders,
  patchRequest,
  type PushNotification,
  readChannel,
  readFreeBusy,
  renewalDue,
  stopRequest,
  type WatchChannel,
  type WatchOptions,
  watchRequest,
} from './google.ts';
export { type Conflict, detectConflicts, type Session } from './conflicts.ts';
export { FakeCalendar } from './fake.ts';
