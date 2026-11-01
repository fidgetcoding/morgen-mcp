// Natural-language date/time parsing — v0.1.6
//
// Wraps chrono-node so every tool that takes a date/time field accepts both
// strict ISO 8601 (existing behavior) AND casual phrases like "tomorrow at
// 3pm", "next friday", "in 2 hours". Pass-through is the default: strings
// that already look ISO are returned untouched so existing callers and the
// validation helpers downstream keep working.
//
// Timezone awareness: chrono knows nothing about IANA names and, left alone,
// decides what "today" means from the system clock. We hand it the target
// zone's current UTC offset as its reference, so "today" / "tomorrow" / "9am"
// are read on the target zone's calendar even when the machine is on a
// different day. We then pull the wall-clock year/month/day/hour/minute out of
// chrono's ParsingResult and re-project them into the target IANA zone, because
// the offset on the resolved date can differ from today's across DST.

import * as chrono from "chrono-node";

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_HHMM_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

// Timezone resolution order:
//   1. MORGEN_TIMEZONE env var (explicit override)
//   2. Node's Intl-reported system timezone (picks up the user's OS setting)
//   3. America/New_York (last-resort fallback)
export function resolveDefaultTimezone() {
  if (process.env.MORGEN_TIMEZONE) return process.env.MORGEN_TIMEZONE;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === "string") return tz;
  } catch {
    // fall through
  }
  return "America/New_York";
}

function assertNonEmpty(input, field) {
  if (input === undefined || input === null || input === "") {
    throw new Error(`${field} is required`);
  }
  if (typeof input !== "string") {
    throw new Error(`${field} must be a string`);
  }
}

// Given wall-clock components and an IANA timezone, return the real UTC
// instant (in ms) and the zone offset in minutes (positive = east of UTC,
// matching ISO 8601). We use the "naive-UTC then correct twice" trick to
// stay DST-safe across transitions.
function resolveWallClockInZone(year, month, day, hour, minute, second, tz) {
  // Step 1: naive — pretend the wall-clock is UTC, see what that instant
  // maps to in the target zone.
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = zoneOffsetMinutesAt(naiveUtc, tz);
  // Step 2: subtract offset1 to get a closer guess, then re-query offset
  // at the adjusted instant. Handles DST transitions.
  const guess = naiveUtc - offset1 * 60000;
  const offset2 = zoneOffsetMinutesAt(guess, tz);
  const trueUtc = naiveUtc - offset2 * 60000;
  return { utcMs: trueUtc, offsetMinutes: offset2 };
}

// Offset in minutes for a given absolute instant and IANA timezone.
// Positive = east of UTC (e.g. Europe/Berlin CEST = +120).
function zoneOffsetMinutesAt(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const wallMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second")
  );
  return Math.round((wallMs - utcMs) / 60000);
}

function formatOffset(offsetMinutes) {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function pad(n, w = 2) {
  return String(n).padStart(w, "0");
}

// Build an ISO 8601 string from wall-clock components + IANA timezone.
function wallClockToIso(year, month, day, hour, minute, second, tz) {
  const { offsetMinutes } = resolveWallClockInZone(
    year,
    month,
    day,
    hour,
    minute,
    second,
    tz
  );
  return (
    `${pad(year, 4)}-${pad(month)}-${pad(day)}T` +
    `${pad(hour)}:${pad(minute)}:${pad(second)}${formatOffset(offsetMinutes)}`
  );
}

function chronoParseComponents(input, field, tz) {
  const instant = new Date();
  const results = chrono.parse(input, {
    instant,
    timezone: zoneOffsetMinutesAt(instant.getTime(), tz),
  });
  if (!results || results.length === 0) {
    throw new Error(
      `${field}: could not parse "${input}" as a date/time. ` +
      `Use ISO 8601 (2026-04-15T10:00:00-04:00) or natural language ` +
      `(e.g. "tomorrow at 3pm", "next friday", "in 2 hours").`
    );
  }
  const comp = results[0].start;
  // "in 2 hours" is a fixed distance from now, so read it without the zone
  // reference: chrono applies that reference through host-local clock math,
  // which lands an hour out when the shifted time crosses the host's DST change.
  if (comp.tags().has("result/relativeDateAndTime")) {
    const date = chrono.parse(input, instant)[0].start.date();
    const wall = new Date(date.getTime() + zoneOffsetMinutesAt(date.getTime(), tz) * 60000);
    return {
      year: wall.getUTCFullYear(),
      month: wall.getUTCMonth() + 1,
      day: wall.getUTCDate(),
      hour: wall.getUTCHours(),
      minute: wall.getUTCMinutes(),
      second: wall.getUTCSeconds(),
      tzCertain: true,
      tzOffsetMinutes: comp.get("timezoneOffset"),
      date,
    };
  }
  return {
    year: comp.get("year"),
    month: comp.get("month"),
    day: comp.get("day"),
    hour: comp.get("hour") ?? 0,
    minute: comp.get("minute") ?? 0,
    second: comp.get("second") ?? 0,
    tzCertain: comp.isCertain("timezoneOffset"),
    tzOffsetMinutes: comp.get("timezoneOffset"),
    date: results[0].start.date(),
  };
}

// Accepts ISO 8601 (e.g. "2026-04-15T10:00:00-04:00") or natural language.
// Returns an ISO 8601 string with explicit offset in the target timezone.
export function resolveDateTimeInput(input, tz = resolveDefaultTimezone()) {
  assertNonEmpty(input, "date/time");
  if (ISO_DATETIME_RE.test(input)) return input;

  const comp = chronoParseComponents(input, "date/time", tz);
  if (comp.tzCertain && typeof comp.tzOffsetMinutes === "number") {
    // Chrono recognized an explicit offset (e.g. "3pm EDT") — trust it.
    return comp.date.toISOString();
  }
  return wallClockToIso(
    comp.year,
    comp.month,
    comp.day,
    comp.hour,
    comp.minute,
    comp.second,
    tz
  );
}

// Date-only variant — YYYY-MM-DD strings pass through; anything else is
// parsed via chrono and the resulting date's wall-clock date-in-tz is
// returned. Used by reflow_day's `date` param.
export function resolveDateInput(input, tz = resolveDefaultTimezone()) {
  assertNonEmpty(input, "date");
  if (DATE_ONLY_RE.test(input)) return input;

  const comp = chronoParseComponents(input, "date", tz);
  // Render the resolved date as a YYYY-MM-DD in the target tz. Use the same
  // wall-clock components chrono picked, re-projected through the zone so
  // a midnight-at-the-other-side-of-the-world parse still names the right
  // local date.
  if (comp.year && comp.month && comp.day) {
    return `${pad(comp.year, 4)}-${pad(comp.month)}-${pad(comp.day)}`;
  }
  // Fallback — shouldn't hit in practice, but degrade gracefully.
  return comp.date.toLocaleDateString("en-CA", { timeZone: tz });
}

// Time-only variant — HH:MM or HH:MM:SS pass through (mirroring the existing
// validateAnchorTime regex). Everything else goes through chrono so "1pm" /
// "3:30pm" / "noon" works. Returns normalized HH:MM:SS.
export function resolveTimeInput(input, tz = resolveDefaultTimezone()) {
  assertNonEmpty(input, "time");
  const hhmm = input.match(TIME_HHMM_RE);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    const s = hhmm[3] ? Number(hhmm[3]) : 0;
    if (h > 23 || m > 59 || s > 59) {
      throw new Error(`time must be a valid 24-hour time: ${input}`);
    }
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  const comp = chronoParseComponents(input, "time", tz);
  const h = comp.hour ?? 0;
  const m = comp.minute ?? 0;
  const s = comp.second ?? 0;
  if (h > 23 || m > 59 || s > 59) {
    throw new Error(`time must be a valid 24-hour time: ${input}`);
  }
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
