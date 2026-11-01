// Host-timezone independence for the natural-language date parser.
//
// The parser must read "today" / "tomorrow" / "9am" on the TARGET zone's
// calendar. A suite that only runs on one host zone cannot catch a day-off
// bug, so every case here runs under several host zones by assigning
// process.env.TZ, and each expected date is computed independently through
// Intl rather than hardcoded.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  resolveDateInput,
  resolveDateTimeInput,
  resolveDefaultTimezone,
  resolveTimeInput,
} from "../src/nl-date-parser.js";

const ORIGINAL_TZ = process.env.TZ;
const ORIGINAL_MORGEN_TZ = process.env.MORGEN_TIMEZONE;

const ZONES = [
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Pacific/Auckland",
];

// Instants chosen so that the zones above disagree about what day it is.
const INSTANTS = [
  "2026-04-15T23:00:00Z", // 19:00 on the 15th in NY, 03:00 on the 16th in Dubai
  "2026-04-15T11:00:00Z", // 07:00 on the 15th in NY, 23:00 on the 15th in Auckland
  "2026-12-31T22:30:00Z", // New Year's Eve in NY, already 2027 in Tokyo
];

function dateInZone(ms, tz) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: tz });
}

// Expected calendar date `days` after the target zone's today.
function zoneDatePlus(instant, tz, days) {
  const [y, m, d] = dateInZone(Date.parse(instant), tz).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function setHostZone(tz) {
  process.env.TZ = tz;
  // Guard against a runner where assigning TZ does not take effect, which
  // would quietly turn this whole file into a single-zone test.
  const probe = new Date("2026-04-15T23:00:00Z");
  expect(probe.toLocaleString("en-US")).toBe(probe.toLocaleString("en-US", { timeZone: tz }));
}

beforeEach(() => {
  delete process.env.MORGEN_TIMEZONE;
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  if (ORIGINAL_MORGEN_TZ === undefined) delete process.env.MORGEN_TIMEZONE;
  else process.env.MORGEN_TIMEZONE = ORIGINAL_MORGEN_TZ;
});

describe.each(ZONES)("host timezone %s", (host) => {
  describe.each(INSTANTS)("at %s", (instant) => {
    it.each(ZONES)("reads dates on the calendar of target %s", (target) => {
      setHostZone(host);
      vi.useFakeTimers();
      vi.setSystemTime(new Date(instant));

      const today = zoneDatePlus(instant, target, 0);
      const tomorrow = zoneDatePlus(instant, target, 1);
      const yesterday = zoneDatePlus(instant, target, -1);

      const nineAm = resolveDateTimeInput("9am", target);
      expect(nineAm.slice(0, 19)).toBe(`${today}T09:00:00`);
      expect(dateInZone(Date.parse(nineAm), target)).toBe(today);

      const tomorrowAt3 = resolveDateTimeInput("tomorrow at 3pm", target);
      expect(tomorrowAt3.slice(0, 19)).toBe(`${tomorrow}T15:00:00`);

      expect(resolveDateInput("today", target)).toBe(today);
      expect(resolveDateInput("tomorrow", target)).toBe(tomorrow);
      expect(resolveDateInput("yesterday", target)).toBe(yesterday);
    });

    it.each(ZONES)("keeps relative times exact for target %s", (target) => {
      setHostZone(host);
      vi.useFakeTimers();
      vi.setSystemTime(new Date(instant));

      const inTwoHours = resolveDateTimeInput("in 2 hours", target);
      expect(Date.parse(inTwoHours)).toBe(Date.parse(instant) + 2 * 3600 * 1000);
    });
  });
});

describe("target zone wins over host zone", () => {
  it("'9am' from a Dubai host at 03:00 on the 16th means the 15th in New York", () => {
    setHostZone("Asia/Dubai");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T19:00:00-04:00"));

    expect(resolveDateTimeInput("9am", "America/New_York")).toBe("2026-04-15T09:00:00-04:00");
    expect(resolveDateTimeInput("9am", "Asia/Dubai")).toBe("2026-04-16T09:00:00+04:00");
  });

  it("resolves the offset for the target date, not today, across DST", () => {
    setHostZone("Asia/Dubai");
    vi.useFakeTimers();
    // 2026-03-07 in NY is EST (-05:00); the next day clocks jump to EDT.
    vi.setSystemTime(new Date("2026-03-07T12:00:00-05:00"));

    expect(resolveDateTimeInput("tomorrow at 9am", "America/New_York")).toBe(
      "2026-03-08T09:00:00-04:00"
    );
  });

  it("resolveTimeInput reads 'now' in the target zone", () => {
    setHostZone("Asia/Dubai");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T23:00:00Z"));

    expect(resolveTimeInput("now", "America/New_York")).toBe("19:00:00");
    expect(resolveTimeInput("now", "Asia/Dubai")).toBe("03:00:00");
  });
});

describe("relative times stay exact when the zones' clocks shift", () => {
  it("'in 2 hours' is two real hours when the shifted time crosses the host's DST change", () => {
    setHostZone("America/New_York");
    vi.useFakeTimers();
    // Shifted to Auckland wall-clock this crosses New York's 2026-03-08 change.
    const now = "2026-03-07T11:00:00Z";
    vi.setSystemTime(new Date(now));

    const iso = resolveDateTimeInput("in 2 hours", "Pacific/Auckland");
    expect(Date.parse(iso)).toBe(Date.parse(now) + 2 * 3600 * 1000);
  });

  it("resolveDateInput and resolveTimeInput project 'in 2 hours' into the target zone", () => {
    setHostZone("America/New_York");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T23:00:00Z"));

    expect(resolveDateInput("in 2 hours", "Asia/Dubai")).toBe("2026-04-16");
    expect(resolveTimeInput("in 2 hours", "Asia/Dubai")).toBe("05:00:00");
    expect(resolveTimeInput("in 2 hours", "America/New_York")).toBe("21:00:00");
  });
});

describe("default timezone", () => {
  it("uses the system zone when no timezone is given", () => {
    setHostZone("Asia/Dubai");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T23:00:00Z"));

    expect(resolveDefaultTimezone()).toBe("Asia/Dubai");
    expect(resolveDateTimeInput("9am")).toBe("2026-04-16T09:00:00+04:00");
    expect(resolveDateInput("today")).toBe("2026-04-16");
  });

  it("MORGEN_TIMEZONE overrides the system zone", () => {
    setHostZone("Asia/Dubai");
    process.env.MORGEN_TIMEZONE = "Asia/Tokyo";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T23:00:00Z"));

    expect(resolveDefaultTimezone()).toBe("Asia/Tokyo");
    expect(resolveDateTimeInput("9am")).toBe("2026-04-16T09:00:00+09:00");
  });
});
