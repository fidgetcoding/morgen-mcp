import { morgenFetch } from "./client.js";
import {
  validateId,
  validateISODate,
  validateEnum,
  validateStringArray,
} from "./validation.js";
import {
  isoDurationFromRange,
  isoUtcToLocal,
  mapCalendar,
  mapEvent,
  toParticipantMap,
  unwrapCalendars,
  unwrapEvent,
  unwrapEvents,
  validateParticipantEmails,
  validateRecurrenceRules,
} from "./events-shape.js";
import {
  getAllAccountsWithCalendars,
  groupCalendarIdsByAccount,
  inferAccountFromContext,
  resolveCalendarByAccountName,
  resolveCalendarMeta,
  resolveDefaultCalendarMeta,
  resolveSelfEmail,
} from "./calendar-cache.js";
import {
  EVENT_TOOLS,
  EVENT_PRIVACY,
  FREE_BUSY_STATUS,
  VIRTUAL_ROOM_TYPES,
  ACCOUNT_NAMES,
  SERIES_UPDATE_MODES,
  RSVP_RESPONSES,
} from "./tools-events-schema.js";
import { resolveDateTimeInput } from "./nl-date-parser.js";
import { parseRecurrenceString } from "./nl-recurrence.js";

// Morgen's participationStatus uses past-tense forms; the MCP's user-facing
// input accepts the bare verb. Map on the way out.
const RSVP_STATUS_MAP = {
  accept: "accepted",
  decline: "declined",
  tentative: "tentative",
};

export { EVENT_TOOLS };

const MAX_TITLE_LEN = 500;
const MAX_DESCRIPTION_LEN = 5000;
const MAX_LOCATION_LEN = 500;
const MAX_ID_LEN = 500;

// Timezone resolution order:
//   1. MORGEN_TIMEZONE env var (explicit override)
//   2. Node's Intl-reported system timezone (picks up the user's OS setting)
//   3. America/New_York (last-resort fallback)
function resolveDefaultTimezone() {
  if (process.env.MORGEN_TIMEZONE) return process.env.MORGEN_TIMEZONE;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === "string") return tz;
  } catch {
    // fall through
  }
  return "America/New_York";
}
const DEFAULT_TIMEZONE = resolveDefaultTimezone();

function validateString(value, field, maxLen) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  if (value.length > maxLen) {
    throw new Error(`${field} must be ${maxLen} characters or fewer`);
  }
}

function validateRequiredString(value, field, maxLen) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${field} is required`);
  }
  validateString(value, field, maxLen);
}

// Morgen represents event locations as a keyed map of Location objects, not a
// scalar string. Wrap the caller-provided string into the minimum viable shape.
function toLocationsMap(locationString) {
  if (!locationString) return undefined;
  return {
    [locationString]: {
      "@type": "Location",
      name: locationString,
    },
  };
}

// ---------- handlers ----------

async function handleListCalendars() {
  const data = await morgenFetch("/v3/calendars/list", { points: 10 });
  const raw = unwrapCalendars(data);
  const calendars = raw.map(mapCalendar);
  return { calendars, total: calendars.length };
}

async function fetchEventsForAccount(accountId, calendarIds, start, end) {
  const params = new URLSearchParams();
  params.set("accountId", accountId);
  params.set("calendarIds", calendarIds.join(","));
  params.set("start", start);
  params.set("end", end);
  const data = await morgenFetch(
    `/v3/events/list?${params.toString()}`,
    { points: 10 }
  );
  return unwrapEvents(data);
}

async function handleListEvents(args = {}) {
  const rangeTz = args.timezone || DEFAULT_TIMEZONE;
  if (args.start !== undefined) args.start = resolveDateTimeInput(args.start, rangeTz);
  if (args.end !== undefined) args.end = resolveDateTimeInput(args.end, rangeTz);
  validateISODate(args.start, "start");
  validateISODate(args.end, "end");

  if (Date.parse(args.end) < Date.parse(args.start)) {
    throw new Error("end must be on or after start");
  }

  // Group requested calendars by account. Morgen requires one call per account.
  let accountMap;
  if (args.calendar_ids !== undefined) {
    validateStringArray(args.calendar_ids, "calendar_ids", 100);
    for (const id of args.calendar_ids) {
      validateId(id, "calendar_ids");
    }
    accountMap = await groupCalendarIdsByAccount(args.calendar_ids);
  } else {
    // No filter — query every calendar on every account.
    const byAccount = await getAllAccountsWithCalendars();
    accountMap = new Map();
    for (const [acctId, entries] of byAccount.entries()) {
      accountMap.set(acctId, entries.map((e) => e.id));
    }
  }

  const all = [];
  for (const [accountId, calendarIds] of accountMap.entries()) {
    const events = await fetchEventsForAccount(
      accountId,
      calendarIds,
      args.start,
      args.end
    );
    all.push(...events);
  }

  const events = all.map(mapEvent);
  return { events, total: events.length };
}

async function handleCreateEvent(args = {}) {
  validateRequiredString(args.title, "title", MAX_TITLE_LEN);
  const createTz = args.timezone || DEFAULT_TIMEZONE;
  if (args.start !== undefined) args.start = resolveDateTimeInput(args.start, createTz);
  if (args.end !== undefined) args.end = resolveDateTimeInput(args.end, createTz);
  validateISODate(args.start, "start");
  validateISODate(args.end, "end");

  if (Date.parse(args.end) < Date.parse(args.start)) {
    throw new Error("end must be on or after start");
  }

  if (args.description !== undefined) {
    validateString(args.description, "description", MAX_DESCRIPTION_LEN);
  }
  if (args.location !== undefined) {
    validateString(args.location, "location", MAX_LOCATION_LEN);
  }
  if (args.participants !== undefined) {
    validateParticipantEmails(args.participants);
  }
  if (args.recurrence_rules !== undefined) {
    // v0.1.6: accept natural-language strings too. parseRecurrenceString
    // passes arrays through unchanged, so existing callers keep working.
    args.recurrence_rules = parseRecurrenceString(args.recurrence_rules);
    validateRecurrenceRules(args.recurrence_rules);
  }
  if (args.privacy !== undefined) validateEnum(args.privacy, EVENT_PRIVACY, "privacy");
  if (args.free_busy_status !== undefined) validateEnum(args.free_busy_status, FREE_BUSY_STATUS, "free_busy_status");
  if (args.virtual_room !== undefined) validateEnum(args.virtual_room, VIRTUAL_ROOM_TYPES, "virtual_room");
  // Only enforce the enum when routes are configured; otherwise any name is
  // accepted and simply resolves to the default calendar.
  if (args.account !== undefined && ACCOUNT_NAMES.length > 0) {
    validateEnum(args.account, ACCOUNT_NAMES, "account");
  }

  // Calendar resolution precedence:
  //   1. explicit calendar_id (caller knows exactly which calendar)
  //   2. explicit account name override (a name from MORGEN_ACCOUNT_ROUTES)
  //   3. smart routing inferred from title + description + participants
  //      (matches configured routes, then the configured default route)
  //   4. default writable calendar (last resort)
  let calendarMeta;
  if (args.calendar_id) {
    validateId(args.calendar_id, "calendar_id");
    calendarMeta = await resolveCalendarMeta(args.calendar_id);
  } else if (args.account) {
    calendarMeta = await resolveCalendarByAccountName(args.account);
  } else {
    const inferred = inferAccountFromContext({
      title: args.title,
      description: args.description,
      participants: args.participants,
    });
    calendarMeta = await resolveCalendarByAccountName(inferred);
    if (!calendarMeta) {
      calendarMeta = await resolveDefaultCalendarMeta();
    }
  }

  if (calendarMeta.readOnly) {
    throw new Error(
      `calendar ${calendarMeta.name} is read-only — cannot create events on it`
    );
  }

  const timeZone = args.timezone || DEFAULT_TIMEZONE;
  const localStart = isoUtcToLocal(args.start, timeZone);
  const duration = isoDurationFromRange(args.start, args.end);

  const body = {
    accountId: calendarMeta.accountId,
    calendarId: calendarMeta.id,
    title: args.title,
    start: localStart,
    duration,
    timeZone,
    showWithoutTime: false,
  };

  if (args.description !== undefined) body.description = args.description;
  if (args.location !== undefined) body.locations = toLocationsMap(args.location);
  if (args.participants !== undefined) {
    body.participants = toParticipantMap(args.participants);
  }
  if (args.recurrence_rules !== undefined) {
    body.recurrenceRules = args.recurrence_rules;
  }
  if (args.privacy !== undefined) body.privacy = args.privacy;
  if (args.free_busy_status !== undefined) body.freeBusyStatus = args.free_busy_status;
  if (args.virtual_room !== undefined) {
    body["morgen.so:requestVirtualRoom"] = args.virtual_room;
  }
  if (args.color_id !== undefined) body["google.com:colorId"] = args.color_id;
  if (args.alerts !== undefined && typeof args.alerts === "object") {
    body.alerts = args.alerts;
  }

  const data = await morgenFetch("/v3/events/create", {
    method: "POST",
    body,
    points: 1,
  });

  return { success: true, event: mapEvent(unwrapEvent(data)), routedTo: calendarMeta.name };
}

async function handleUpdateEvent(args = {}) {
  const eventId = validateId(args.event_id, "event_id");
  validateId(args.calendar_id, "calendar_id");
  const calendarMeta = await resolveCalendarMeta(args.calendar_id);

  if (args.title !== undefined) {
    validateString(args.title, "title", MAX_TITLE_LEN);
  }
  if (args.description !== undefined) {
    validateString(args.description, "description", MAX_DESCRIPTION_LEN);
  }
  if (args.location !== undefined) {
    validateString(args.location, "location", MAX_LOCATION_LEN);
  }
  const updateTz = args.timezone || DEFAULT_TIMEZONE;
  if (args.start !== undefined) {
    args.start = resolveDateTimeInput(args.start, updateTz);
    validateISODate(args.start, "start");
  }
  if (args.end !== undefined) {
    args.end = resolveDateTimeInput(args.end, updateTz);
    validateISODate(args.end, "end");
  }
  if (args.start !== undefined && args.end !== undefined) {
    if (Date.parse(args.end) < Date.parse(args.start)) {
      throw new Error("end must be on or after start");
    }
  }
  if (args.participants !== undefined) {
    validateParticipantEmails(args.participants);
  }
  if (args.recurrence_rules !== undefined) {
    args.recurrence_rules = parseRecurrenceString(args.recurrence_rules);
    validateRecurrenceRules(args.recurrence_rules);
  }
  if (args.series_update_mode !== undefined) {
    validateEnum(args.series_update_mode, SERIES_UPDATE_MODES, "series_update_mode");
  }
  if (args.privacy !== undefined) validateEnum(args.privacy, EVENT_PRIVACY, "privacy");
  if (args.free_busy_status !== undefined) validateEnum(args.free_busy_status, FREE_BUSY_STATUS, "free_busy_status");
  if (args.virtual_room !== undefined) validateEnum(args.virtual_room, VIRTUAL_ROOM_TYPES, "virtual_room");

  const timeZone = args.timezone || DEFAULT_TIMEZONE;
  const body = {
    id: eventId,
    accountId: calendarMeta.accountId,
    calendarId: calendarMeta.id,
  };
  if (args.title !== undefined) body.title = args.title;
  // Morgen requires the full timing quartet (start, duration, timeZone,
  // showWithoutTime) whenever any timing field is updated.
  if (args.start !== undefined || args.end !== undefined) {
    if (args.start !== undefined) {
      body.start = isoUtcToLocal(args.start, timeZone);
    }
    body.timeZone = timeZone;
    if (args.start !== undefined && args.end !== undefined) {
      body.duration = isoDurationFromRange(args.start, args.end);
    }
    body.showWithoutTime = false;
  }
  if (args.description !== undefined) body.description = args.description;
  if (args.location !== undefined) body.locations = toLocationsMap(args.location);
  if (args.participants !== undefined) {
    body.participants = toParticipantMap(args.participants);
  }
  if (args.recurrence_rules !== undefined) {
    body.recurrenceRules = args.recurrence_rules;
  }
  if (args.privacy !== undefined) body.privacy = args.privacy;
  if (args.free_busy_status !== undefined) body.freeBusyStatus = args.free_busy_status;
  if (args.virtual_room !== undefined) {
    body["morgen.so:requestVirtualRoom"] = args.virtual_room;
  }
  if (args.color_id !== undefined) body["google.com:colorId"] = args.color_id;
  if (args.alerts !== undefined && typeof args.alerts === "object") {
    body.alerts = args.alerts;
  }

  const params = new URLSearchParams();
  if (args.series_update_mode !== undefined) {
    params.set("seriesUpdateMode", args.series_update_mode);
  }
  const qs = params.toString();
  const path = qs ? `/v3/events/update?${qs}` : "/v3/events/update";

  const data = await morgenFetch(path, {
    method: "POST",
    body,
    points: 1,
  });

  return { success: true, event: mapEvent(unwrapEvent(data)) };
}

async function handleDeleteEvent(args = {}) {
  const eventId = validateId(args.event_id, "event_id");
  validateId(args.calendar_id, "calendar_id");
  const calendarMeta = await resolveCalendarMeta(args.calendar_id);

  if (args.series_update_mode !== undefined) {
    validateEnum(
      args.series_update_mode,
      SERIES_UPDATE_MODES,
      "series_update_mode"
    );
  }

  const params = new URLSearchParams();
  if (args.series_update_mode !== undefined) {
    params.set("seriesUpdateMode", args.series_update_mode);
  }
  const qs = params.toString();
  const path = qs ? `/v3/events/delete?${qs}` : "/v3/events/delete";

  await morgenFetch(path, {
    method: "POST",
    body: {
      id: eventId,
      accountId: calendarMeta.accountId,
      calendarId: calendarMeta.id,
    },
    points: 1,
  });

  return {
    success: true,
    deletedId: eventId,
    calendarId: calendarMeta.id,
    seriesUpdateMode: args.series_update_mode,
  };
}

// Morgen has NO dedicated RSVP endpoint. /v3/events/accept, /decline, and
// /tentative do not exist. RSVP is done by PATCHing the event's participants
// map via POST /v3/events/update, keying the update by the caller's own
// email address and setting participationStatus to "accepted" / "declined" /
// "tentative" (past-tense forms).
//
// The caller's own email comes from MORGEN_SELF_EMAIL env var, or is derived
// from the calendar name if it looks like an email (most Google calendars
// are named after the account email). See calendar-cache.js::resolveSelfEmail.
async function handleRsvpEvent(args = {}) {
  const eventId = validateId(args.event_id, "event_id");
  validateId(args.calendar_id, "calendar_id");
  const calendarMeta = await resolveCalendarMeta(args.calendar_id);
  validateEnum(args.response, RSVP_RESPONSES, "response");

  const selfEmailOverride = args.self_email;
  const selfEmail =
    selfEmailOverride && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(selfEmailOverride)
      ? selfEmailOverride
      : resolveSelfEmail(calendarMeta);

  const participationStatus = RSVP_STATUS_MAP[args.response];

  const body = {
    id: eventId,
    accountId: calendarMeta.accountId,
    calendarId: calendarMeta.id,
    participants: {
      [selfEmail]: {
        "@type": "Participant",
        email: selfEmail,
        participationStatus,
      },
    },
  };

  const data = await morgenFetch("/v3/events/update", {
    method: "POST",
    body,
    points: 1,
  });

  return {
    success: true,
    eventId,
    calendarId: calendarMeta.id,
    response: args.response,
    participationStatus,
    selfEmail,
    event: mapEvent(unwrapEvent(data)),
  };
}

export const eventHandlers = {
  list_calendars: handleListCalendars,
  list_events: handleListEvents,
  create_event: handleCreateEvent,
  update_event: handleUpdateEvent,
  delete_event: handleDeleteEvent,
  rsvp_event: handleRsvpEvent,
};
