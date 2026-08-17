// Unit tests for the v0.1.4 reflow_day pure helpers and compression logic.
// These don't touch the network — only the duration math, validators, and
// the pure compressSchedule / isSoloBlock functions.
import { describe, it, expect } from "vitest";
import {
  compressSchedule,
  parseIsoDurationSeconds,
  secondsToIsoDuration,
  addSecondsToLocal,
  validateAnchorTime,
  validateReflowDate,
  isSoloBlock,
} from "../src/tools-reflow.js";

describe("parseIsoDurationSeconds", () => {
  it("parses PT30M as 1800s", () => {
    expect(parseIsoDurationSeconds("PT30M")).toBe(1800);
  });
  it("parses PT15M as 900s", () => {
    expect(parseIsoDurationSeconds("PT15M")).toBe(900);
  });
  it("parses PT1H as 3600s", () => {
    expect(parseIsoDurationSeconds("PT1H")).toBe(3600);
  });
  it("parses PT1H30M as 5400s", () => {
    expect(parseIsoDurationSeconds("PT1H30M")).toBe(5400);
  });
  it("parses PT2H45M15S as 9915s", () => {
    expect(parseIsoDurationSeconds("PT2H45M15S")).toBe(9915);
  });
  it("parses P1D as 86400s", () => {
    expect(parseIsoDurationSeconds("P1D")).toBe(86400);
  });
  it("rejects empty string", () => {
    expect(() => parseIsoDurationSeconds("")).toThrow();
  });
  it("rejects non-string inputs", () => {
    expect(() => parseIsoDurationSeconds(null)).toThrow();
    expect(() => parseIsoDurationSeconds(undefined)).toThrow();
    expect(() => parseIsoDurationSeconds(30)).toThrow();
  });
  it("rejects free-form duration strings", () => {
    expect(() => parseIsoDurationSeconds("30 minutes")).toThrow();
    expect(() => parseIsoDurationSeconds("1h30m")).toThrow();
  });
  it("rejects zero duration", () => {
    expect(() => parseIsoDurationSeconds("PT0S")).toThrow();
  });
});

describe("secondsToIsoDuration", () => {
  it("emits PT30M for 1800", () => {
    expect(secondsToIsoDuration(1800)).toBe("PT30M");
  });
  it("emits PT1H for 3600", () => {
    expect(secondsToIsoDuration(3600)).toBe("PT1H");
  });
  it("emits PT1H30M for 5400", () => {
    expect(secondsToIsoDuration(5400)).toBe("PT1H30M");
  });
  it("emits PT0S for 0", () => {
    expect(secondsToIsoDuration(0)).toBe("PT0S");
  });
  it("emits PT0S for negatives", () => {
    expect(secondsToIsoDuration(-60)).toBe("PT0S");
  });
});

describe("addSecondsToLocal", () => {
  it("adds 30 minutes", () => {
    expect(addSecondsToLocal("2026-04-14T13:00:00", 1800)).toBe(
      "2026-04-14T13:30:00"
    );
  });
  it("rolls over the hour", () => {
    expect(addSecondsToLocal("2026-04-14T13:45:00", 1800)).toBe(
      "2026-04-14T14:15:00"
    );
  });
  it("rolls over the day", () => {
    expect(addSecondsToLocal("2026-04-14T23:45:00", 1800)).toBe(
      "2026-04-15T00:15:00"
    );
  });
  it("supports subtraction via negative seconds", () => {
    expect(addSecondsToLocal("2026-04-14T13:30:00", -1800)).toBe(
      "2026-04-14T13:00:00"
    );
  });
  it("rejects non-LocalDateTime input", () => {
    expect(() => addSecondsToLocal("not a date", 60)).toThrow();
    expect(() => addSecondsToLocal("2026-04-14", 60)).toThrow();
    expect(() => addSecondsToLocal("2026-04-14T13:00:00Z", 60)).toThrow();
  });
});

describe("validateAnchorTime", () => {
  it("accepts HH:MM", () => {
    expect(validateAnchorTime("13:00")).toBe("13:00:00");
  });
  it("accepts H:MM and pads", () => {
    expect(validateAnchorTime("9:00")).toBe("09:00:00");
  });
  it("accepts HH:MM:SS", () => {
    expect(validateAnchorTime("13:00:30")).toBe("13:00:30");
  });
  it("rejects hour > 23", () => {
    expect(() => validateAnchorTime("25:00")).toThrow();
  });
  it("rejects minute > 59", () => {
    expect(() => validateAnchorTime("12:70")).toThrow();
  });
  it("rejects bad format", () => {
    expect(() => validateAnchorTime("1pm")).toThrow();
    expect(() => validateAnchorTime("")).toThrow();
    expect(() => validateAnchorTime(null)).toThrow();
  });
});

describe("validateReflowDate", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(validateReflowDate("2026-04-14")).toBe("2026-04-14");
  });
  it("rejects US format", () => {
    expect(() => validateReflowDate("04/14/2026")).toThrow();
  });
  it("rejects free-form", () => {
    expect(() => validateReflowDate("tomorrow")).toThrow();
    expect(() => validateReflowDate("")).toThrow();
  });
  it("returns undefined for undefined input", () => {
    expect(validateReflowDate(undefined)).toBeUndefined();
  });
  it("returns undefined for null input", () => {
    expect(validateReflowDate(null)).toBeUndefined();
  });
});

describe("isSoloBlock", () => {
  const self = "me@example.com";

  it("true when caller is the only participant", () => {
    const event = {
      organizer: self,
      participants: [{ email: self, isOrganizer: true }],
    };
    expect(isSoloBlock(event, self)).toBe(true);
  });
  it("true when no participants", () => {
    expect(isSoloBlock({ organizer: self, participants: [] }, self)).toBe(true);
  });
  it("true when participants missing entirely", () => {
    expect(isSoloBlock({ organizer: self }, self)).toBe(true);
  });
  it("false with one external participant", () => {
    const event = {
      organizer: self,
      participants: [{ email: self }, { email: "someone@partner.example" }],
    };
    expect(isSoloBlock(event, self)).toBe(false);
  });
  it("false when organizer is external", () => {
    const event = {
      organizer: "external@partner.example",
      participants: [{ email: self }],
    };
    expect(isSoloBlock(event, self)).toBe(false);
  });
  it("case-insensitive email match", () => {
    const event = {
      organizer: "ME@example.com",
      participants: [{ email: "Me@Example.COM" }],
    };
    expect(isSoloBlock(event, self)).toBe(true);
  });
  it("false when selfEmail is empty", () => {
    expect(isSoloBlock({ organizer: self }, "")).toBe(false);
  });
});

describe("compressSchedule", () => {
  it("chains 3 events back-to-back from anchor", () => {
    const events = [
      { id: "a", title: "A", start: "2026-04-14T13:00:00", duration: "PT15M" },
      { id: "b", title: "B", start: "2026-04-14T13:15:00", duration: "PT45M" },
      { id: "c", title: "C", start: "2026-04-14T14:00:00", duration: "PT45M" },
    ];
    const plan = compressSchedule(events, "2026-04-14T12:30:00");
    expect(plan).toHaveLength(3);
    expect(plan[0].new_start).toBe("2026-04-14T12:30:00");
    expect(plan[0].new_end).toBe("2026-04-14T12:45:00");
    expect(plan[1].new_start).toBe("2026-04-14T12:45:00");
    expect(plan[1].new_end).toBe("2026-04-14T13:30:00");
    expect(plan[2].new_start).toBe("2026-04-14T13:30:00");
    expect(plan[2].new_end).toBe("2026-04-14T14:15:00");
  });

  it("sorts by original start before compressing", () => {
    const events = [
      { id: "b", title: "B", start: "2026-04-14T14:00:00", duration: "PT30M" },
      { id: "a", title: "A", start: "2026-04-14T13:00:00", duration: "PT30M" },
    ];
    const plan = compressSchedule(events, "2026-04-14T13:00:00");
    expect(plan[0].event_id).toBe("a");
    expect(plan[1].event_id).toBe("b");
    expect(plan[0].new_start).toBe("2026-04-14T13:00:00");
    expect(plan[1].new_start).toBe("2026-04-14T13:30:00");
  });

  it("preserves each event's duration", () => {
    const events = [
      { id: "x", title: "X", start: "2026-04-14T09:00:00", duration: "PT20M" },
      { id: "y", title: "Y", start: "2026-04-14T10:00:00", duration: "PT1H5M" },
    ];
    const plan = compressSchedule(events, "2026-04-14T09:00:00");
    expect(plan[0].duration).toBe("PT20M");
    expect(plan[1].duration).toBe("PT1H5M");
    expect(plan[0].new_end).toBe("2026-04-14T09:20:00");
    expect(plan[1].new_end).toBe("2026-04-14T10:25:00");
  });

  it("handles empty list", () => {
    expect(compressSchedule([], "2026-04-14T13:00:00")).toEqual([]);
  });

  it("handles a single event", () => {
    const events = [
      { id: "x", title: "X", start: "2026-04-14T10:00:00", duration: "PT1H" },
    ];
    const plan = compressSchedule(events, "2026-04-14T09:00:00");
    expect(plan).toHaveLength(1);
    expect(plan[0].new_start).toBe("2026-04-14T09:00:00");
    expect(plan[0].new_end).toBe("2026-04-14T10:00:00");
  });

  it("reproduces a four-block afternoon exactly, from 13:00", () => {
    const events = [
      { id: "llc",      title: "LLC rename",      start: "2026-04-14T13:00:00", duration: "PT15M" },
      { id: "karpathy", title: "Karpathy update", start: "2026-04-14T13:15:00", duration: "PT45M" },
      { id: "cli",      title: "CLI-MAXXING",     start: "2026-04-14T14:00:00", duration: "PT45M" },
      { id: "n8n",      title: "n8n sync",        start: "2026-04-14T14:45:00", duration: "PT45M" },
    ];
    const plan = compressSchedule(events, "2026-04-14T13:00:00");
    expect(plan[0].new_start).toBe("2026-04-14T13:00:00");
    expect(plan[1].new_start).toBe("2026-04-14T13:15:00");
    expect(plan[2].new_start).toBe("2026-04-14T14:00:00");
    expect(plan[3].new_start).toBe("2026-04-14T14:45:00");
    // Already tight — should be a no-op compression
    expect(plan.map((p) => p.new_start)).toEqual(plan.map((p) => p.old_start));
  });

  it("compresses when there's a gap", () => {
    // Same sequence, but anchor 30 min earlier, shifting everything left by 30
    const events = [
      { id: "llc",      title: "LLC",      start: "2026-04-14T13:00:00", duration: "PT15M" },
      { id: "karpathy", title: "Karpathy", start: "2026-04-14T13:15:00", duration: "PT45M" },
      { id: "cli",      title: "CLI",      start: "2026-04-14T14:00:00", duration: "PT45M" },
    ];
    const plan = compressSchedule(events, "2026-04-14T12:30:00");
    expect(plan[0].new_start).toBe("2026-04-14T12:30:00");
    expect(plan[1].new_start).toBe("2026-04-14T12:45:00");
    expect(plan[2].new_start).toBe("2026-04-14T13:30:00");
  });
});
