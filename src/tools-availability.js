// find_free_slots — where are the actual gaps?
//
// reflow_day answers "pull everything forward"; list_events answers "what is on
// the calendar". Neither answers the question people actually ask an assistant,
// which is "when am I free for an hour this week". This does that, across every
// calendar at once, so a gap is only reported when nothing anywhere fills it.
//
// All arithmetic happens in Morgen's LocalDateTime string space
// ("YYYY-MM-DDTHH:MM:SS"). Those strings sort lexicographically, and staying in
// wall-clock avoids re-deriving offsets the API already applied. Durations are
// diffed by reading the strings as UTC — legitimate here because both sides of
// every subtraction carry the same (absent) offset, so it cancels.

import { morgenFetch } from "./client.js";
import { validateId, validateIntegerRange, validateStringArray } from "./validation.js";
import { getCalendarCache, resolveCalendarMeta } from "./calendar-cache.js";
import { unwrapEvents } from "./events-shape.js";
import { resolveDateInput } from "./nl-date-parser.js";
import { parseIsoDurationSeconds, addSecondsToLocal, validateReflowDate } from "./tools-reflow.js";

const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

export const DEFAULT_WORK_START_HOUR = 9;
export const DEFAULT_WORK_END_HOUR = 18;
export const DEFAULT_MIN_MINUTES = 30;

// A week of weekdays is the useful default span; beyond a month the response
// stops being something a model can reason over in one pass.
const MAX_RANGE_DAYS = 31;

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

function todayInTimezone(tz) {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

/** Minutes between two LocalDateTime strings. Positive when b is later. */
export function localDiffMinutes(a, b) {
  return (new Date(`${b}Z`).getTime() - new Date(`${a}Z`).getTime()) / 60_000;
}

/**
 * Expand an inclusive YYYY-MM-DD range into individual date strings.
 * Built from numeric parts so the first day survives a west-of-UTC offset.
 */
export function eachDate(startDate, endDate, { includeWeekends = false } = {}) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const endMs = new Date(ey, em - 1, ed).getTime();

  const dates = [];
  for (let dt = new Date(sy, sm - 1, sd); dt.getTime() <= endMs; dt.setDate(dt.getDate() + 1)) {
    const dow = dt.getDay();
    if (!includeWeekends && (dow === 0 || dow === 6)) continue;
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${day}`);
  }
  return dates;
}

/**
 * Project raw Morgen events onto busy LocalDateTime intervals.
 *
 * Morgen models an event as start + ISO-8601 duration rather than start + end,
 * so the end is derived. All-day entries (`showWithoutTime`, or a start with no
 * time component) are dropped: they label a day rather than occupying it, and
 * counting them as busy would erase every slot on the day.
 *
 * @param {Array<object>} events raw events from /v3/events/list
 * @returns {Array<{start: string, end: string, title?: string, calendarId?: string}>}
 */
export function toBusyIntervals(events) {
  const out = [];
  for (const e of events || []) {
    if (!e || typeof e !== "object") continue;
    if (e.showWithoutTime === true) continue;
    if (typeof e.start !== "string" || !LOCAL_DATETIME_RE.test(e.start)) continue;

    let end;
    if (typeof e.duration === "string") {
      try {
        end = addSecondsToLocal(e.start, parseIsoDurationSeconds(e.duration));
      } catch {
        continue; // unparseable duration — better to omit than to invent a length
      }
    } else if (typeof e.end === "string" && LOCAL_DATETIME_RE.test(e.end)) {
      end = e.end;
    } else {
      continue;
    }
    if (end <= e.start) continue;
    out.push({ start: e.start, end, title: e.title, calendarId: e.calendarId });
  }
  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return out;
}

/**
 * Find gaps of at least `minMinutes` inside working hours on the given dates.
 *
 * The cursor only moves forward, so nested and overlapping meetings collapse
 * naturally: a short meeting inside a long one can never reopen a gap the long
 * one already closed.
 *
 * @param {object} options
 * @param {Array<{start: string, end: string}>} options.busy sorted ascending
 * @param {string[]} options.dates YYYY-MM-DD
 * @param {number} [options.workStartHour]
 * @param {number} [options.workEndHour]
 * @param {number} [options.minMinutes]
 * @returns {Array<{date: string, start: string, end: string, duration_minutes: number}>}
 */
export function findFreeWindows({
  busy,
  dates,
  workStartHour = DEFAULT_WORK_START_HOUR,
  workEndHour = DEFAULT_WORK_END_HOUR,
  minMinutes = DEFAULT_MIN_MINUTES,
}) {
  const slots = [];

  for (const date of dates) {
    const dayStart = `${date}T${String(workStartHour).padStart(2, "0")}:00:00`;
    // Hour 24 means "to midnight", which has no representation inside the same
    // date string — clamp to 23:59:59 rather than rolling onto the next day.
    const dayEnd = workEndHour === 24
      ? `${date}T23:59:59`
      : `${date}T${String(workEndHour).padStart(2, "0")}:00:00`;
    if (!(dayStart < dayEnd)) continue;

    const dayBusy = busy.filter((e) => e.start < dayEnd && e.end > dayStart);

    let cursor = dayStart;
    for (const evt of dayBusy) {
      const evtStart = evt.start < dayStart ? dayStart : evt.start;
      const evtEnd = evt.end > dayEnd ? dayEnd : evt.end;

      if (evtStart > cursor) {
        const gap = localDiffMinutes(cursor, evtStart);
        if (gap >= minMinutes) {
          slots.push({ date, start: cursor, end: evtStart, duration_minutes: Math.round(gap) });
        }
      }
      if (evtEnd > cursor) cursor = evtEnd;
    }

    if (cursor < dayEnd) {
      const gap = localDiffMinutes(cursor, dayEnd);
      if (gap >= minMinutes) {
        slots.push({ date, start: cursor, end: dayEnd, duration_minutes: Math.round(gap) });
      }
    }
  }

  return slots;
}

async function resolveTargetCalendars(args) {
  if (args.calendar_ids !== undefined) {
    validateStringArray(args.calendar_ids, "calendar_ids", 20);
    const metas = [];
    for (const id of args.calendar_ids) {
      validateId(id, "calendar_ids entry");
      const meta = await resolveCalendarMeta(id);
      if (meta) metas.push(meta);
    }
    if (metas.length === 0) throw new Error("none of the supplied calendar_ids could be resolved");
    return metas;
  }
  // Default to every known calendar — you are busy if ANY of them says so, and
  // checking only the writable/default one is how double-bookings happen.
  const cache = await getCalendarCache();
  const metas = Array.from(cache.byId.values()).filter((c) => c.accountId);
  if (metas.length === 0) {
    throw new Error("No calendars available on this account. Connect a calendar in Morgen first.");
  }
  return metas;
}

export async function handleFindFreeSlots(args = {}) {
  const timeZone = args.timezone || resolveDefaultTimezone();

  const startDate = args.start_date
    ? validateReflowDate(resolveDateInput(args.start_date, timeZone), "start_date")
    : todayInTimezone(timeZone);
  const endDate = args.end_date
    ? validateReflowDate(resolveDateInput(args.end_date, timeZone), "end_date")
    : startDate;
  if (endDate < startDate) throw new Error("end_date must be on or after start_date");

  const spanDays = Math.round(
    (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / 86_400_000
  ) + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    throw new Error(`date range cannot exceed ${MAX_RANGE_DAYS} days`);
  }

  const workStartHour = args.work_start_hour === undefined
    ? DEFAULT_WORK_START_HOUR
    : validateIntegerRange(args.work_start_hour, "work_start_hour", 0, 23);
  const workEndHour = args.work_end_hour === undefined
    ? DEFAULT_WORK_END_HOUR
    : validateIntegerRange(args.work_end_hour, "work_end_hour", 1, 24);
  if (workEndHour <= workStartHour) {
    throw new Error("work_end_hour must be greater than work_start_hour");
  }
  const minMinutes = args.min_duration_minutes === undefined
    ? DEFAULT_MIN_MINUTES
    : validateIntegerRange(args.min_duration_minutes, "min_duration_minutes", 5, 1440);

  const calendars = await resolveTargetCalendars(args);

  // Pad ±1 day so events that straddle the boundary in another offset are seen.
  const padStart = new Date(new Date(`${startDate}T00:00:00Z`).getTime() - 86_400_000)
    .toISOString().slice(0, 19) + "Z";
  const padEnd = new Date(new Date(`${endDate}T00:00:00Z`).getTime() + 2 * 86_400_000)
    .toISOString().slice(0, 19) + "Z";

  const byAccount = new Map();
  for (const cal of calendars) {
    if (!byAccount.has(cal.accountId)) byAccount.set(cal.accountId, []);
    byAccount.get(cal.accountId).push(cal.id);
  }

  const raw = [];
  // One request per account rather than per calendar — events/list costs 10
  // points against a 100-point / 15-minute budget, and calendarIds is a list.
  for (const [accountId, calendarIds] of byAccount) {
    const params = new URLSearchParams();
    params.set("accountId", accountId);
    params.set("calendarIds", calendarIds.join(","));
    params.set("start", padStart);
    params.set("end", padEnd);
    const data = await morgenFetch(`/v3/events/list?${params.toString()}`, { points: 10 });
    raw.push(...unwrapEvents(data));
  }

  const busy = toBusyIntervals(raw);
  const dates = eachDate(startDate, endDate, { includeWeekends: args.include_weekends === true });
  const slots = findFreeWindows({ busy, dates, workStartHour, workEndHour, minMinutes });

  return {
    timezone: timeZone,
    range: { start_date: startDate, end_date: endDate },
    working_hours: `${workStartHour}:00 - ${workEndHour}:00`,
    minimum_duration_minutes: minMinutes,
    calendars_checked: calendars.map((c) => ({ id: c.id, name: c.name })),
    busy_events_considered: busy.length,
    free_slots: slots,
    total_slots: slots.length,
  };
}

export const AVAILABILITY_TOOLS = [
  {
    name: "find_free_slots",
    description:
      "Find open gaps in the calendar. Checks every calendar at once (a slot is only free if nothing anywhere fills it) and returns windows of at least the requested length inside working hours. Use for 'when am I free for an hour this week' — list_events tells you what's booked, this tells you what isn't.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: {
          type: "string",
          description: "First day to check — YYYY-MM-DD or natural language ('today', 'next Monday'). Defaults to today.",
        },
        end_date: {
          type: "string",
          description: "Last day to check, inclusive. Defaults to start_date. Max 31 days.",
        },
        min_duration_minutes: {
          type: "number",
          description: "Ignore gaps shorter than this (default 30, min 5, max 1440)",
        },
        work_start_hour: {
          type: "number",
          description: "Earliest hour to consider, 0-23 (default 9)",
        },
        work_end_hour: {
          type: "number",
          description: "Latest hour to consider, 1-24 (default 18)",
        },
        include_weekends: {
          type: "boolean",
          description: "Include Saturday and Sunday (default false)",
        },
        calendar_ids: {
          type: "array",
          items: { type: "string" },
          description: "Restrict the check to these calendars. Defaults to all of them.",
        },
        timezone: {
          type: "string",
          description: "IANA timezone (default MORGEN_TIMEZONE or the system zone)",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
];

export const availabilityHandlers = {
  find_free_slots: handleFindFreeSlots,
};
