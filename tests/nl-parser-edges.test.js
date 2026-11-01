// Edge-case coverage for the v0.1.6 natural-language date parser.
//
// This file complements tests/nl-parser.test.js (the coder's base coverage)
// with gnarlier scenarios: IANA timezone projection across NY/London/Tokyo,
// DST spring-forward boundaries, ambiguous days/times when today *is* the
// referenced day, decimal-hour relative offsets, past dates, and strict
// ISO-8601 pass-through semantics.
//
// Determinism: resolveDateTimeInput calls `new Date()` internally (no ref
// injection), so every case that involves "today" / "tomorrow" / relative
// offsets pins the clock with `vi.setSystemTime`. Tests that do their own
// fake-timer lifecycle always call `vi.useRealTimers()` in a matching
// afterEach to avoid bleeding fake time into sibling tests.

import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveDateTimeInput } from "../src/nl-date-parser.js";

// Helpers for readable assertions.
function wallClock(iso) {
  const m = iso.match(/T(\d{2}):(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}:${m[3]}` : null;
}
function offsetPart(iso) {
  // Match the trailing offset: Z, +HH:MM, or -HH:MM.
  const m = iso.match(/(Z|[+-]\d{2}:\d{2})$/);
  return m ? m[1] : null;
}
function datePart(iso) {
  return iso.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Group A — IANA timezone projection
// ---------------------------------------------------------------------------
describe("resolveDateTimeInput — IANA timezone projection", () => {
  afterEach(() => vi.useRealTimers());

  it("'tomorrow at midnight' in America/New_York produces -04:00 at 04:00Z", () => {
    // Pin to a Tuesday afternoon (well clear of DST edges) in early-mid April.
    // "tomorrow" is read on the target zone's calendar, not the host's.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00-04:00"));

    const iso = resolveDateTimeInput("tomorrow at midnight", "America/New_York");
    expect(datePart(iso)).toBe("2026-04-15");
    expect(wallClock(iso)).toBe("00:00:00");
    expect(offsetPart(iso)).toBe("-04:00");
    expect(new Date(iso).toISOString()).toBe("2026-04-15T04:00:00.000Z");
  });

  it("'tomorrow at midnight' in Europe/London produces +01:00 (BST) at 23:00Z prev-day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00-04:00"));

    const iso = resolveDateTimeInput("tomorrow at midnight", "Europe/London");
    expect(datePart(iso)).toBe("2026-04-15");
    expect(wallClock(iso)).toBe("00:00:00");
    expect(offsetPart(iso)).toBe("+01:00");
    expect(new Date(iso).toISOString()).toBe("2026-04-14T23:00:00.000Z");
  });

  it("'tomorrow at midnight' in Asia/Tokyo produces +09:00 at 15:00Z prev-day", () => {
    // 10:00Z is still 2026-04-14 in Tokyo (19:00), so "tomorrow" is the 15th.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T10:00:00Z"));

    const iso = resolveDateTimeInput("tomorrow at midnight", "Asia/Tokyo");
    expect(datePart(iso)).toBe("2026-04-15");
    expect(wallClock(iso)).toBe("00:00:00");
    expect(offsetPart(iso)).toBe("+09:00");
    expect(new Date(iso).toISOString()).toBe("2026-04-14T15:00:00.000Z");
  });

  it("NY vs London vs Tokyo for the same wall clock yield different UTC instants", () => {
    // 10:00Z is 2026-04-14 in all three zones, so all three "tomorrow"s are the 15th.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T10:00:00Z"));

    const ny = resolveDateTimeInput("tomorrow at midnight", "America/New_York");
    const london = resolveDateTimeInput("tomorrow at midnight", "Europe/London");
    const tokyo = resolveDateTimeInput("tomorrow at midnight", "Asia/Tokyo");

    const nyMs = new Date(ny).getTime();
    const lonMs = new Date(london).getTime();
    const tokyoMs = new Date(tokyo).getTime();

    // NY (EDT, UTC-4) is 5h behind London (BST, UTC+1).
    expect(nyMs - lonMs).toBe(5 * 3600 * 1000);
    // London (BST, UTC+1) is 8h behind Tokyo (JST, UTC+9).
    expect(lonMs - tokyoMs).toBe(8 * 3600 * 1000);
  });

  it("DST spring-forward: 'march 8 2026 at 3am' in NY lands cleanly on EDT (-04:00)", () => {
    // 2026-03-08 is US spring-forward day. At 02:00 local, clocks jump to
    // 03:00 EDT. We use an explicit date phrase because chrono's 'next
    // sunday' relative resolver bumps to the following week from a mid-
    // week ref, which would bypass the DST day entirely. This asserts the
    // wrapper's two-pass DST-safe offset resolver produces -04:00 (EDT)
    // rather than accidentally emitting -05:00 (EST) on the jump day.
    const iso = resolveDateTimeInput("march 8 2026 at 3am", "America/New_York");
    expect(Number.isNaN(new Date(iso).getTime())).toBe(false);
    expect(datePart(iso)).toBe("2026-03-08");
    expect(wallClock(iso)).toBe("03:00:00");
    expect(offsetPart(iso)).toBe("-04:00");
    // 03:00 EDT = 07:00 UTC on 2026-03-08.
    expect(new Date(iso).toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Group B — Ambiguous weekday/time-of-day (document actual behavior)
// ---------------------------------------------------------------------------
describe("resolveDateTimeInput — ambiguous weekday/time-of-day", () => {
  afterEach(() => vi.useRealTimers());

  it("'sunday' when ref IS a sunday resolves to today (chrono default, non-forwarding)", () => {
    // 2026-04-12 is a Sunday.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T12:00:00-04:00"));

    const iso = resolveDateTimeInput("sunday", "America/New_York");
    // chrono treats unqualified weekdays as "the current weekday if it
    // matches today". Document that behavior so any future change surfaces.
    expect(datePart(iso)).toBe("2026-04-12");
  });

  it("'friday' when ref IS a friday resolves to today", () => {
    // 2026-04-17 is a Friday.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T12:00:00-04:00"));

    const iso = resolveDateTimeInput("friday", "America/New_York");
    expect(datePart(iso)).toBe("2026-04-17");
  });

  it("'9am' with evening ref stays on today (chrono does not forward past times)", () => {
    // Pin to 2026-04-15 at 7pm NY local. 9am NY is already in the past.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T19:00:00-04:00"));

    const iso = resolveDateTimeInput("9am", "America/New_York");
    expect(wallClock(iso)).toBe("09:00:00");
    expect(datePart(iso)).toBe("2026-04-15");
    // 09:00 NY (EDT) = 13:00Z — a past instant relative to the ref, but
    // the parser accepts it because there is no field discrimination.
    expect(new Date(iso).toISOString()).toBe("2026-04-15T13:00:00.000Z");
  });

  it("'9am' with early-morning ref stays on today (target still in the future)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T03:00:00-04:00"));

    const iso = resolveDateTimeInput("9am", "America/New_York");
    expect(datePart(iso)).toBe("2026-04-15");
    expect(wallClock(iso)).toBe("09:00:00");
    expect(new Date(iso).toISOString()).toBe("2026-04-15T13:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Group C — Relative time (minutes, hours, decimals)
// ---------------------------------------------------------------------------
describe("resolveDateTimeInput — relative-time offsets", () => {
  afterEach(() => vi.useRealTimers());

  it("'in 30 minutes' resolves to ref + 30 min", () => {
    vi.useFakeTimers();
    const ref = new Date("2026-04-15T14:00:00-04:00");
    vi.setSystemTime(ref);

    const iso = resolveDateTimeInput("in 30 minutes", "America/New_York");
    const deltaMs = new Date(iso).getTime() - ref.getTime();
    // Allow a 60s tolerance for chrono's internal rounding.
    expect(Math.abs(deltaMs - 30 * 60 * 1000)).toBeLessThan(60 * 1000);
  });

  it("'in 90 minutes' resolves to ref + 90 min", () => {
    vi.useFakeTimers();
    const ref = new Date("2026-04-15T14:00:00-04:00");
    vi.setSystemTime(ref);

    const iso = resolveDateTimeInput("in 90 minutes", "America/New_York");
    const deltaMs = new Date(iso).getTime() - ref.getTime();
    expect(Math.abs(deltaMs - 90 * 60 * 1000)).toBeLessThan(60 * 1000);
  });

  it("'in 2.5 hours' resolves to ref + 150 min (chrono supports decimal hours)", () => {
    vi.useFakeTimers();
    const ref = new Date("2026-04-15T14:00:00-04:00");
    vi.setSystemTime(ref);

    const iso = resolveDateTimeInput("in 2.5 hours", "America/New_York");
    const deltaMs = new Date(iso).getTime() - ref.getTime();
    expect(Math.abs(deltaMs - 150 * 60 * 1000)).toBeLessThan(60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// Group D — Past dates pass through (no field discrimination in v0.1.6)
// ---------------------------------------------------------------------------
describe("resolveDateTimeInput — past dates", () => {
  afterEach(() => vi.useRealTimers());

  it("'yesterday' resolves to the previous date in the target tz (not rejected)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T14:00:00-04:00"));

    const iso = resolveDateTimeInput("yesterday", "America/New_York");
    expect(datePart(iso)).toBe("2026-04-14");
    // Parser accepts past dates — document it so a future policy change
    // (e.g. reject past start times) surfaces through this test.
  });
});

// ---------------------------------------------------------------------------
// Group E — Invalid inputs
// ---------------------------------------------------------------------------
describe("resolveDateTimeInput — invalid input rejection", () => {
  it("rejects empty string", () => {
    expect(() => resolveDateTimeInput("", "America/New_York")).toThrow(/required/i);
  });

  it("rejects null", () => {
    expect(() => resolveDateTimeInput(null, "America/New_York")).toThrow(/required/i);
  });

  it("rejects undefined", () => {
    expect(() => resolveDateTimeInput(undefined, "America/New_York")).toThrow(
      /required/i
    );
  });

  it("rejects objects with a type-error message", () => {
    expect(() =>
      resolveDateTimeInput({ foo: 1 }, "America/New_York")
    ).toThrow(/must be a string/i);
  });

  it("rejects numeric input with a type-error message", () => {
    expect(() => resolveDateTimeInput(12345, "America/New_York")).toThrow(
      /must be a string/i
    );
  });

  it("rejects unparseable gibberish with a 'could not parse' hint", () => {
    expect(() =>
      resolveDateTimeInput("asdf qwerty", "America/New_York")
    ).toThrow(/could not parse/i);
    // And the hint should point the caller at the supported syntax.
    expect(() =>
      resolveDateTimeInput("asdf qwerty", "America/New_York")
    ).toThrow(/ISO 8601/);
  });

  // v0.1.6 has no explicit upper-bound length guard; chrono will eventually
  // return null for any long random string, which is then wrapped in the
  // standard "could not parse" error. Keeping the assertion loose until a
  // dedicated length gate lands.
  it("rejects very long gibberish (>500 chars) via the standard parse failure", () => {
    const longGarbage = "zzzzz ".repeat(120); // 720 chars of nonsense
    expect(() =>
      resolveDateTimeInput(longGarbage, "America/New_York")
    ).toThrow(/could not parse/i);
  });
});

// ---------------------------------------------------------------------------
// Group F — ISO 8601 pass-through
// ---------------------------------------------------------------------------
describe("resolveDateTimeInput — ISO 8601 pass-through", () => {
  it("returns a 'Z'-suffixed datetime unchanged regardless of target tz", () => {
    const iso = "2026-04-20T15:00:00Z";
    expect(resolveDateTimeInput(iso, "Europe/London")).toBe(iso);
    expect(resolveDateTimeInput(iso, "America/New_York")).toBe(iso);
  });

  it("returns an explicit +/-HH:MM offset unchanged regardless of target tz", () => {
    const iso = "2026-04-20T15:00:00-04:00";
    expect(resolveDateTimeInput(iso, "Europe/London")).toBe(iso);
    expect(resolveDateTimeInput(iso, "Asia/Tokyo")).toBe(iso);
  });

  it("returns a millisecond-precision 'Z' datetime unchanged", () => {
    const iso = "2026-04-20T15:00:00.123Z";
    expect(resolveDateTimeInput(iso, "America/New_York")).toBe(iso);
  });

  it("passes a naked local datetime (no offset) through because ISO_DATETIME_RE matches the prefix only", () => {
    const iso = "2026-04-20T15:00:00";
    // Parser uses /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/ — no offset required.
    // Document the pass-through so callers know a bare local string is
    // forwarded as-is to downstream validators.
    expect(resolveDateTimeInput(iso, "America/New_York")).toBe(iso);
    expect(resolveDateTimeInput(iso, "Europe/London")).toBe(iso);
  });

  it("almost-ISO with a space separator (not 'T') is parsed via chrono into target tz", () => {
    // "2026-04-20 15:00" does NOT match ISO_DATETIME_RE (needs literal 'T'),
    // so it falls through to chrono and is then projected into the target
    // zone. Expected NY output: 2026-04-20T15:00:00-04:00 (EDT in April).
    // The test is ref-independent because chrono anchors the date portion
    // on the input itself, but we pin a clock anyway for determinism.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00-04:00"));
    try {
      const iso = resolveDateTimeInput("2026-04-20 15:00", "America/New_York");
      expect(datePart(iso)).toBe("2026-04-20");
      expect(wallClock(iso)).toBe("15:00:00");
      expect(offsetPart(iso)).toBe("-04:00");
    } finally {
      vi.useRealTimers();
    }
  });
});
