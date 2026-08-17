// Unit tests for smart account routing and the RSVP status mapping.
//
// These don't hit the network — they exercise the pure inference function from
// calendar-cache.js against a fictional MORGEN_ACCOUNT_ROUTES config, plus the
// self-email resolution helper.
import { describe, it, expect, beforeEach } from "vitest";
import {
  inferAccountFromContext,
  _resetCalendarCache,
  _seedCalendarCache,
  resolveCalendarByAccountName,
  resolveSelfEmail,
} from "../src/calendar-cache.js";
import { _resetAccountRoutes } from "../src/account-routes.js";

const ORIGINAL_ENV = { ...process.env };

// Fictional routing table. `studio` is listed before `labs` so the tests can
// assert configured order decides ties; `primary` is the default fallback.
const ROUTES = JSON.stringify([
  {
    name: "studio",
    emailDomains: ["@studio.example"],
    keywords: ["studio", "widget launch"],
    calendarPattern: "me@studio\\.example|studio",
  },
  {
    name: "labs",
    emailDomains: ["@labs.example"],
    keywords: ["labs", "labsco"],
    calendarPattern: "me@labs\\.example|labs",
  },
  {
    name: "primary",
    default: true,
    calendarPattern: "me@primary\\.example|primary",
  },
]);

function seedCalendars() {
  _seedCalendarCache([
    {
      id: "cal-primary",
      accountId: "acct-primary",
      name: "me@primary.example",
      integrationId: "google",
    },
    {
      id: "cal-studio",
      accountId: "acct-studio",
      name: "me@studio.example",
      integrationId: "google",
    },
    {
      id: "cal-labs",
      accountId: "acct-labs",
      name: "me@labs.example",
      integrationId: "google",
    },
  ]);
}

beforeEach(() => {
  _resetCalendarCache();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MORGEN_SELF_EMAIL;
  process.env.MORGEN_ACCOUNT_ROUTES = ROUTES;
  _resetAccountRoutes();
  seedCalendars();
});

describe("inferAccountFromContext", () => {
  it("falls back to the default route with no signals", () => {
    expect(inferAccountFromContext({ title: "Dentist" })).toBe("primary");
  });

  it("routes on a participant email domain", () => {
    expect(
      inferAccountFromContext({
        title: "Client sync",
        participants: ["someone@studio.example"],
      })
    ).toBe("studio");
  });

  it("routes on a keyword in the title", () => {
    expect(inferAccountFromContext({ title: "STUDIO brand review" })).toBe("studio");
  });

  it("routes on a multi-word keyword in the description", () => {
    expect(
      inferAccountFromContext({
        title: "Sync",
        description: "Kicking off the widget launch campaign",
      })
    ).toBe("studio");
  });

  it("routes to a later route on its own email domain", () => {
    expect(
      inferAccountFromContext({
        title: "Standup",
        participants: ["someone@labs.example"],
      })
    ).toBe("labs");
  });

  it("routes to a later route on its own keyword", () => {
    expect(inferAccountFromContext({ title: "labs investor prep" })).toBe("labs");
  });

  it("configured order breaks ties when both keywords appear", () => {
    expect(
      inferAccountFromContext({ title: "studio <> labs joint thing" })
    ).toBe("studio");
  });

  it("participant email beats a title with no cues", () => {
    expect(
      inferAccountFromContext({
        title: "Generic meeting",
        participants: ["someone@labs.example"],
      })
    ).toBe("labs");
  });

  it("returns null when no routes are configured", () => {
    delete process.env.MORGEN_ACCOUNT_ROUTES;
    _resetAccountRoutes();
    expect(inferAccountFromContext({ title: "studio" })).toBe(null);
  });

  it("returns null when the config is malformed", () => {
    process.env.MORGEN_ACCOUNT_ROUTES = "{not json";
    _resetAccountRoutes();
    expect(inferAccountFromContext({ title: "studio" })).toBe(null);
  });
});

describe("resolveCalendarByAccountName", () => {
  it("resolves the default route to its calendar", async () => {
    const meta = await resolveCalendarByAccountName("primary");
    expect(meta.id).toBe("cal-primary");
    expect(meta.accountId).toBe("acct-primary");
  });

  it("resolves a keyword route to its calendar", async () => {
    const meta = await resolveCalendarByAccountName("studio");
    expect(meta.id).toBe("cal-studio");
  });

  it("resolves another route to its calendar", async () => {
    const meta = await resolveCalendarByAccountName("labs");
    expect(meta.id).toBe("cal-labs");
  });

  it("falls back to default when the account name is unknown", async () => {
    const meta = await resolveCalendarByAccountName("nonexistent");
    // Falls back to the first non-readonly entry (cal-primary, seeded first)
    expect(meta.id).toBe("cal-primary");
  });

  it("falls back to default when no routes are configured", async () => {
    delete process.env.MORGEN_ACCOUNT_ROUTES;
    _resetAccountRoutes();
    const meta = await resolveCalendarByAccountName(null);
    expect(meta.id).toBe("cal-primary");
  });
});

describe("resolveSelfEmail", () => {
  it("prefers MORGEN_SELF_EMAIL env var when valid", () => {
    process.env.MORGEN_SELF_EMAIL = "override@example.com";
    const email = resolveSelfEmail({ name: "me@primary.example" });
    expect(email).toBe("override@example.com");
  });

  it("derives from calendar name if env var unset and name looks like an email", () => {
    const email = resolveSelfEmail({ name: "me@primary.example" });
    expect(email).toBe("me@primary.example");
  });

  it("ignores invalid env var value and falls back to calendar name", () => {
    process.env.MORGEN_SELF_EMAIL = "not-an-email";
    const email = resolveSelfEmail({ name: "me@studio.example" });
    expect(email).toBe("me@studio.example");
  });

  it("throws with a clear hint when neither source is available", () => {
    expect(() => resolveSelfEmail({ name: "Work" })).toThrow(/MORGEN_SELF_EMAIL/);
  });
});
