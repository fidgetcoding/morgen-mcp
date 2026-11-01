// Reflow Day — v0.1.4
//
// Compress a sequence of "reflowable" events on a single day back-to-back
// starting from an anchor time. Designed for the case where a focus block
// finishes early (or gets cancelled) and everything behind it should slide
// forward without waiting on Morgen's scheduler to reposition anything.
//
// Safety model:
//   - Single writable calendar at a time
//   - Auto mode filters to "solo blocks" (organizer is self, no external
//     participants) so real meetings never get moved
//   - Dry run is the default; callers must pass dry_run: false to commit
//   - Explicit event_ids array bypasses auto-detection but still respects
//     the calendar's writability

import { morgenFetch } from "./client.js";
import { validateId } from "./validation.js";
import {
  resolveCalendarMeta,
  resolveDefaultCalendarMeta,
  resolveSelfEmail,
} from "./calendar-cache.js";
import { mapEvent, unwrapEvents } from "./events-shape.js";
import { resolveDateInput, resolveDefaultTimezone, resolveTimeInput } from "./nl-date-parser.js";

// Hard cap on explicit event_ids per reflow_day call. Each mutation costs 1
// point against Morgen's 100-point / 15-minute budget, and the auto-fetch
// of events/list costs 10. Capping at 50 keeps the whole call under the
// budget even in the worst case and prevents a caller-driven rate-limit
// storm that would strand the calendar in a half-reflowed state.
const MAX_EVENT_IDS = 50;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
// ISO 8601 duration — subset Morgen uses. PT30M, PT1H30M, P1D, etc.
const DURATION_RE =
  /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

function todayInTimezone(tz) {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

export function validateReflowDate(value, field = "date") {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    throw new Error(`${field} must be YYYY-MM-DD`);
  }
  return value;
}

export function validateAnchorTime(value, field = "anchor_time") {
  if (typeof value !== "string" || !TIME_RE.test(value)) {
    throw new Error(`${field} must be HH:MM or HH:MM:SS (24-hour)`);
  }
  const [, h, m, s] = value.match(TIME_RE);
  const hour = Number(h);
  const minute = Number(m);
  const second = s ? Number(s) : 0;
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${field} must be a valid 24-hour time`);
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

// ISO 8601 duration string → total seconds.
export function parseIsoDurationSeconds(duration) {
  if (typeof duration !== "string") {
    throw new Error(`invalid ISO 8601 duration: ${duration}`);
  }
  const match = duration.match(DURATION_RE);
  if (!match || duration === "P" || duration === "PT") {
    throw new Error(`invalid ISO 8601 duration: ${duration}`);
  }
  const [, days, hours, minutes, seconds] = match;
  const d = days ? Number(days) : 0;
  const h = hours ? Number(hours) : 0;
  const m = minutes ? Number(minutes) : 0;
  const s = seconds ? Number(seconds) : 0;
  if (d === 0 && h === 0 && m === 0 && s === 0) {
    throw new Error(`ISO 8601 duration must be non-zero: ${duration}`);
  }
  return d * 86400 + h * 3600 + m * 60 + s;
}

// Seconds → ISO 8601 duration string. Inverse of parseIsoDurationSeconds.
export function secondsToIsoDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "PT0S";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  let out = "PT";
  if (hours) out += `${hours}H`;
  if (minutes) out += `${minutes}M`;
  if (seconds && !hours) out += `${seconds}S`;
  return out === "PT" ? "PT0S" : out;
}

// Add N seconds to a Morgen LocalDateTime string ("YYYY-MM-DDTHH:MM:SS").
// Treats the string as wall-clock; no DST handling, which is fine for
// same-day intra-working-hours reflow.
export function addSecondsToLocal(localDateTime, seconds) {
  if (typeof localDateTime !== "string" || !LOCAL_DATETIME_RE.test(localDateTime)) {
    throw new Error(
      `addSecondsToLocal: invalid LocalDateTime "${localDateTime}"`
    );
  }
  const asUtc = new Date(`${localDateTime}Z`);
  if (Number.isNaN(asUtc.getTime())) {
    throw new Error(`addSecondsToLocal: invalid LocalDateTime "${localDateTime}"`);
  }
  const shifted = new Date(asUtc.getTime() + seconds * 1000);
  return shifted.toISOString().slice(0, 19);
}

function compareLocal(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// Is this event safe to reflow in auto-mode?
// Definition: organizer is the caller (or unset) and no participant is an
// external email. Case-insensitive match on self email.
export function isSoloBlock(event, selfEmail) {
  if (!selfEmail) return false;
  const self = selfEmail.toLowerCase();
  const participants = Array.isArray(event.participants) ? event.participants : [];
  for (const p of participants) {
    if (!p || !p.email) continue;
    if (p.email.toLowerCase() !== self) return false;
  }
  if (event.organizer && event.organizer.toLowerCase() !== self) {
    return false;
  }
  return true;
}

// Pure compression: given a list of events and an anchor LocalDateTime,
// return a plan that chains them back-to-back from the anchor, preserving
// each event's original duration. Pure function — used by the handler and
// unit tests.
// FIXME v0.1.5: overlapping source events (e.g. two events that overlap by
// 5 min in the original schedule) are silently de-overlapped here — we sort
// by start then chain back-to-back, so the second event is placed strictly
// after the first regardless of original overlap. This is usually what the
// caller wants for reflow, but we should either document this explicitly in
// the tool description or warn when the input had overlaps.
// FIXME v0.1.5: anchor + sum(durations) can roll past 23:59:59 into the next
// day via addSecondsToLocal's Date math. No check that the compressed plan
// still fits inside the target `date`. A full day of PT1H blocks starting at
// 18:00 will silently schedule events into tomorrow's LocalDateTime.
export function compressSchedule(events, anchorLocal) {
  const sorted = [...events].sort((a, b) => compareLocal(a.start, b.start));
  const plan = [];
  let cursor = anchorLocal;
  for (const ev of sorted) {
    // FIXME v0.1.5: throws if ev.duration is missing/invalid. handleReflowDay
    // filters on `!e.duration` upstream, but compressSchedule is exported and
    // unit-tested as a pure function — external callers can still hit this.
    // Either skip events with missing duration here or document the contract.
    const durationSeconds = parseIsoDurationSeconds(ev.duration);
    const newStart = cursor;
    const newEnd = addSecondsToLocal(cursor, durationSeconds);
    plan.push({
      event_id: ev.id,
      title: ev.title,
      old_start: ev.start,
      new_start: newStart,
      new_end: newEnd,
      duration: ev.duration,
    });
    cursor = newEnd;
  }
  return plan;
}

// ---------- handler ----------

async function fetchRawEventsForCalendar(calendarMeta, startIso, endIso) {
  const params = new URLSearchParams();
  params.set("accountId", calendarMeta.accountId);
  params.set("calendarIds", calendarMeta.id);
  params.set("start", startIso);
  params.set("end", endIso);
  const data = await morgenFetch(
    `/v3/events/list?${params.toString()}`,
    { points: 10 }
  );
  return unwrapEvents(data);
}

export async function handleReflowDay(args = {}) {
  const timeZone = args.timezone || resolveDefaultTimezone();
  // v0.1.6: accept natural-language time/date too. resolveTimeInput keeps
  // the HH:MM/HH:MM:SS fast path identical to the old regex behavior and
  // only falls through to chrono for casual phrases like "1pm".
  const normalizedAnchor = args.anchor_time !== undefined
    ? resolveTimeInput(args.anchor_time, timeZone)
    : args.anchor_time;
  const anchorTime = validateAnchorTime(normalizedAnchor);
  let date;
  if (args.date) {
    date = validateReflowDate(resolveDateInput(args.date, timeZone));
  } else {
    date = todayInTimezone(timeZone);
  }
  const dryRun = args.dry_run === false ? false : true;
  const protectFixed = args.protect_fixed === false ? false : true;

  let calendarMeta;
  if (args.calendar_id) {
    validateId(args.calendar_id, "calendar_id");
    calendarMeta = await resolveCalendarMeta(args.calendar_id);
  } else {
    calendarMeta = await resolveDefaultCalendarMeta();
  }

  if (!calendarMeta) {
    throw new Error("unable to resolve a writable calendar for reflow");
  }
  if (calendarMeta.readOnly) {
    throw new Error(
      `calendar ${calendarMeta.name} is read-only — cannot reflow events on it`
    );
  }

  // Pad the query range by ±1 day so events on the target date are captured
  // regardless of the caller's timezone vs UTC offset.
  const dayAnchor = new Date(`${date}T00:00:00Z`);
  const padStart = new Date(dayAnchor.getTime() - 86400 * 1000);
  const padEnd = new Date(dayAnchor.getTime() + 2 * 86400 * 1000);
  const startIso = padStart.toISOString().slice(0, 19) + "Z";
  const endIso = padEnd.toISOString().slice(0, 19) + "Z";

  const rawEvents = await fetchRawEventsForCalendar(calendarMeta, startIso, endIso);

  // Keep only events whose LocalDateTime start falls on the target date
  const sameDay = rawEvents.filter(
    (e) => typeof e.start === "string" && e.start.startsWith(date)
  );

  let candidates;
  if (Array.isArray(args.event_ids) && args.event_ids.length > 0) {
    if (args.event_ids.length > MAX_EVENT_IDS) {
      throw new Error(
        `event_ids may not exceed ${MAX_EVENT_IDS} entries (rate-limit safety cap)`
      );
    }
    for (let i = 0; i < args.event_ids.length; i++) {
      validateId(args.event_ids[i], `event_ids[${i}]`);
    }
    const idSet = new Set(args.event_ids);
    candidates = sameDay.filter((e) => idSet.has(e.id) && e.duration);
  } else {
    // v0.1.5 fix: use resolveSelfEmail instead of calendarMeta.name so the
    // filter works when a calendar is renamed (e.g. "Work" instead of the
    // account email). Falls back to MORGEN_SELF_EMAIL env var.
    //
    // v0.1.6 fix: only resolve self-email when protect_fixed is actually
    // going to use it. The v0.1.5 version called resolveSelfEmail before the
    // protect_fixed check, so `protect_fixed: false` still raised when neither
    // MORGEN_SELF_EMAIL was set nor the calendar name was email-shaped — even
    // though the caller had explicitly opted out of the solo-block filter.
    let selfEmail = null;
    if (protectFixed) {
      try {
        selfEmail = resolveSelfEmail(calendarMeta);
      } catch (err) {
        throw new Error(
          `reflow_day auto mode cannot determine your self-email for the solo-block filter. ` +
          `Set MORGEN_SELF_EMAIL in your MCP env, pass event_ids explicitly, or set protect_fixed: false.`
        );
      }
    }
    candidates = sameDay.filter((e) => {
      if (!e.duration) return false;
      if (protectFixed && !isSoloBlock(mapEvent(e), selfEmail)) return false;
      return true;
    });
  }

  if (candidates.length === 0) {
    return {
      dry_run: dryRun,
      applied: false,
      calendar: calendarMeta.name,
      anchor: `${date}T${anchorTime}`,
      reflow: [],
      message: "no reflowable events found for the given date + filters",
    };
  }

  const plan = compressSchedule(
    candidates.map((e) => ({
      id: e.id,
      title: e.title,
      start: e.start,
      duration: e.duration,
    })),
    `${date}T${anchorTime}`
  );

  if (dryRun) {
    return {
      dry_run: true,
      applied: false,
      calendar: calendarMeta.name,
      anchor: `${date}T${anchorTime}`,
      reflow: plan,
    };
  }

  // v0.1.5: track applied vs pending steps so a mid-loop failure produces a
  // structured error the caller can use to recover manually. We do NOT
  // attempt an automatic rollback because update_event is not idempotent
  // w.r.t. Morgen's internal timestamps and an inverse update could itself
  // fail, compounding the inconsistency. The goal is observability, not
  // transactional guarantees — the caller (usually Claude) sees which
  // events committed and which didn't, and can ask the user how to proceed.
  const applied = [];
  const pending = plan.slice();
  let failure = null;
  for (const step of plan) {
    try {
      await morgenFetch("/v3/events/update", {
        method: "POST",
        body: {
          id: step.event_id,
          accountId: calendarMeta.accountId,
          calendarId: calendarMeta.id,
          start: step.new_start,
          timeZone,
          duration: step.duration,
          showWithoutTime: false,
        },
        points: 1,
      });
      applied.push(step);
      pending.shift();
    } catch (err) {
      failure = {
        step,
        error: err instanceof Error ? err.message : String(err),
      };
      break;
    }
  }

  if (failure) {
    const err = new Error(
      `reflow_day partial failure at step ${applied.length + 1} of ${plan.length}: ${failure.error}. ` +
      `${applied.length} event(s) already moved; ${pending.length} event(s) still at original times.`
    );
    err.reflow = {
      applied,
      pending,
      failed_at: failure.step.event_id,
      failed_step_index: applied.length,
      error_message: failure.error,
    };
    throw err;
  }

  return {
    dry_run: false,
    applied: true,
    calendar: calendarMeta.name,
    anchor: `${date}T${anchorTime}`,
    reflow: plan,
  };
}

export const REFLOW_TOOLS = [
  {
    name: "reflow_day",
    description:
      "Compress same-day events back-to-back starting from an anchor time. Use when a focus block finishes early (or gets cancelled) and everything behind it should slide forward. Defaults to dry_run: true (no mutations) and auto-filters to solo blocks (no external participants) so real meetings never move. Pass event_ids to reflow an explicit set instead of auto-detecting.",
    inputSchema: {
      type: "object",
      properties: {
        anchor_time: {
          type: "string",
          description:
            "Local time the first reflowed event should start — HH:MM / HH:MM:SS (24-hour) or natural language like '1pm', '3:30pm'.",
        },
        date: {
          type: "string",
          description:
            "Target date — YYYY-MM-DD or natural language ('today', 'tomorrow', 'next monday'). Defaults to today in the caller's timezone.",
        },
        calendar_id: {
          type: "string",
          description: "Target calendar ID. Defaults to the primary writable calendar.",
        },
        event_ids: {
          type: "array",
          items: { type: "string" },
          maxItems: 50,
          description:
            "Explicit list of event IDs to reflow. When set, bypasses auto-detection and protect_fixed. Sorted by current start time before compression. Capped at 50 for rate-limit safety.",
        },
        timezone: {
          type: "string",
          description: "IANA timezone for the date and anchor_time. Defaults to MORGEN_TIMEZONE or the system setting.",
        },
        protect_fixed: {
          type: "boolean",
          description:
            "When true (default), auto-mode skips events that have any external participant. Ignored when event_ids is set.",
        },
        dry_run: {
          type: "boolean",
          description: "When true (default), returns the proposed plan without mutating. Pass false to commit.",
        },
      },
      required: ["anchor_time"],
      additionalProperties: false,
    },
  },
];

export const reflowHandlers = {
  reflow_day: handleReflowDay,
};
