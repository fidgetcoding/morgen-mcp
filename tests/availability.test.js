import { describe, it, expect } from "vitest";
import {
  eachDate,
  toBusyIntervals,
  findFreeWindows,
  localDiffMinutes,
  AVAILABILITY_TOOLS,
  availabilityHandlers,
  DEFAULT_WORK_START_HOUR,
  DEFAULT_WORK_END_HOUR,
} from "../src/tools-availability.js";

const ev = (start, duration, extra = {}) => ({ start, duration, ...extra });

describe("localDiffMinutes", () => {
  it("measures forward distance in minutes", () => {
    expect(localDiffMinutes("2026-08-04T09:00:00", "2026-08-04T10:30:00")).toBe(90);
  });

  it("is negative when the second argument is earlier", () => {
    expect(localDiffMinutes("2026-08-04T10:00:00", "2026-08-04T09:00:00")).toBe(-60);
  });

  it("spans midnight without a date-math detour", () => {
    expect(localDiffMinutes("2026-08-04T23:00:00", "2026-08-05T01:00:00")).toBe(120);
  });
});

describe("eachDate", () => {
  it("skips weekends by default", () => {
    expect(eachDate("2026-08-03", "2026-08-09")).toEqual([
      "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07",
    ]);
  });

  it("includes weekends on request", () => {
    expect(eachDate("2026-08-08", "2026-08-09", { includeWeekends: true }))
      .toEqual(["2026-08-08", "2026-08-09"]);
  });

  it("keeps the first day west of UTC", () => {
    expect(eachDate("2026-08-04", "2026-08-04")).toEqual(["2026-08-04"]);
  });

  it("returns nothing for an inverted range", () => {
    expect(eachDate("2026-08-07", "2026-08-03")).toEqual([]);
  });
});

describe("toBusyIntervals", () => {
  it("derives end from Morgen's ISO 8601 duration", () => {
    const [interval] = toBusyIntervals([ev("2026-08-04T10:00:00", "PT1H30M")]);
    expect(interval.end).toBe("2026-08-04T11:30:00");
  });

  it("drops all-day events rather than blanking the day", () => {
    expect(toBusyIntervals([
      ev("2026-08-04T00:00:00", "P1D", { showWithoutTime: true, title: "PTO" }),
    ])).toEqual([]);
  });

  it("falls back to an explicit end when duration is absent", () => {
    const [interval] = toBusyIntervals([
      { start: "2026-08-04T10:00:00", end: "2026-08-04T11:00:00" },
    ]);
    expect(interval.end).toBe("2026-08-04T11:00:00");
  });

  it("omits events it cannot measure instead of inventing a length", () => {
    expect(toBusyIntervals([
      ev("2026-08-04T10:00:00", "not-a-duration"),
      { start: "2026-08-04T10:00:00" },
      { start: "garbage", duration: "PT1H" },
      null,
      undefined,
    ])).toEqual([]);
  });

  it("drops zero-length and inverted events", () => {
    expect(toBusyIntervals([
      { start: "2026-08-04T10:00:00", end: "2026-08-04T10:00:00" },
      { start: "2026-08-04T12:00:00", end: "2026-08-04T11:00:00" },
    ])).toEqual([]);
  });

  it("sorts ascending by start", () => {
    const out = toBusyIntervals([
      ev("2026-08-04T15:00:00", "PT1H"),
      ev("2026-08-04T09:00:00", "PT1H"),
      ev("2026-08-04T12:00:00", "PT1H"),
    ]);
    expect(out.map((e) => e.start)).toEqual([
      "2026-08-04T09:00:00", "2026-08-04T12:00:00", "2026-08-04T15:00:00",
    ]);
  });

  it("tolerates a null or missing event list", () => {
    expect(toBusyIntervals(null)).toEqual([]);
    expect(toBusyIntervals(undefined)).toEqual([]);
  });
});

describe("findFreeWindows", () => {
  const dates = ["2026-08-04"];

  it("returns the whole working day when nothing is booked", () => {
    const [slot] = findFreeWindows({ busy: [], dates });
    expect(slot.start).toBe("2026-08-04T09:00:00");
    expect(slot.end).toBe("2026-08-04T18:00:00");
    expect(slot.duration_minutes).toBe((DEFAULT_WORK_END_HOUR - DEFAULT_WORK_START_HOUR) * 60);
  });

  it("splits the day around one meeting", () => {
    const busy = toBusyIntervals([ev("2026-08-04T12:00:00", "PT1H")]);
    const slots = findFreeWindows({ busy, dates });
    expect(slots.map((s) => [s.start, s.end])).toEqual([
      ["2026-08-04T09:00:00", "2026-08-04T12:00:00"],
      ["2026-08-04T13:00:00", "2026-08-04T18:00:00"],
    ]);
  });

  it("honours the minimum duration", () => {
    const busy = toBusyIntervals([ev("2026-08-04T09:30:00", "PT8H")]);
    expect(findFreeWindows({ busy, dates, minMinutes: 30 })).toHaveLength(2);
    expect(findFreeWindows({ busy, dates, minMinutes: 45 })).toHaveLength(0);
  });

  it("collapses a nested meeting", () => {
    const busy = toBusyIntervals([
      ev("2026-08-04T10:00:00", "PT4H"),
      ev("2026-08-04T11:00:00", "PT1H"),
    ]);
    expect(findFreeWindows({ busy, dates }).map((s) => s.duration_minutes)).toEqual([60, 240]);
  });

  it("collapses overlapping meetings without reopening a gap", () => {
    const busy = toBusyIntervals([
      ev("2026-08-04T10:00:00", "PT2H"),
      ev("2026-08-04T11:00:00", "PT2H"),
    ]);
    expect(findFreeWindows({ busy, dates }).map((s) => s.duration_minutes)).toEqual([60, 300]);
  });

  it("clamps meetings that spill outside working hours", () => {
    const busy = toBusyIntervals([
      ev("2026-08-04T07:00:00", "PT3H"),
      ev("2026-08-04T16:00:00", "PT4H"),
    ]);
    expect(findFreeWindows({ busy, dates }).map((s) => s.duration_minutes)).toEqual([360]);
  });

  it("ignores events on neighbouring days", () => {
    const busy = toBusyIntervals([ev("2026-08-05T09:00:00", "PT9H")]);
    expect(findFreeWindows({ busy, dates })).toHaveLength(1);
  });

  it("honours custom working hours", () => {
    const [slot] = findFreeWindows({ busy: [], dates, workStartHour: 6, workEndHour: 22 });
    expect(slot.duration_minutes).toBe(960);
  });

  it("clamps hour 24 to 23:59:59 rather than rolling into the next day", () => {
    const [slot] = findFreeWindows({ busy: [], dates, workStartHour: 22, workEndHour: 24 });
    expect(slot.end).toBe("2026-08-04T23:59:59");
    expect(slot.date).toBe("2026-08-04");
  });

  it("returns nothing for an inverted window or an empty date list", () => {
    expect(findFreeWindows({ busy: [], dates, workStartHour: 18, workEndHour: 9 })).toEqual([]);
    expect(findFreeWindows({ busy: [], dates: [] })).toEqual([]);
  });

  it("covers every day in a multi-day range", () => {
    const slots = findFreeWindows({ busy: [], dates: eachDate("2026-08-03", "2026-08-07") });
    expect(slots).toHaveLength(5);
    expect(new Set(slots.map((s) => s.date)).size).toBe(5);
  });

  it("treats calendars as a single pool — any event blocks the slot", () => {
    const busy = toBusyIntervals([
      ev("2026-08-04T10:00:00", "PT1H", { calendarId: "work" }),
      ev("2026-08-04T14:00:00", "PT1H", { calendarId: "personal" }),
    ]);
    // 09:00-10:00, 11:00-14:00, 15:00-18:00 — the personal event blocks a slot
    // just as hard as the work one.
    expect(findFreeWindows({ busy, dates }).map((s) => s.duration_minutes)).toEqual([60, 180, 180]);
  });
});

describe("tool registration", () => {
  it("exposes find_free_slots with a matching handler", () => {
    expect(AVAILABILITY_TOOLS.map((t) => t.name)).toEqual(["find_free_slots"]);
    expect(typeof availabilityHandlers.find_free_slots).toBe("function");
  });

  it("requires no arguments so 'when am I free today' works bare", () => {
    expect(AVAILABILITY_TOOLS[0].inputSchema.required).toEqual([]);
    expect(AVAILABILITY_TOOLS[0].inputSchema.additionalProperties).toBe(false);
  });
});
