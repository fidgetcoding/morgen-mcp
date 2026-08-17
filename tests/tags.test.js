// v0.1.5 unit tests for tag label → Morgen tag UUID resolution.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resolveTagLabelsToIds,
  validateTagLabels,
} from "../src/tools-tasks.js";

function installFetchMock(routes) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    const route = routes[`${method} ${path}`];
    if (!route) {
      return {
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: async () => ({ message: `no mock for ${method} ${path}` }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => route,
    };
  });
  return calls;
}

beforeEach(async () => {
  process.env.MORGEN_API_KEY = "test-key-placeholder";
  const client = await import("../src/client.js");
  client._resetRateLimiter();
});

describe("validateTagLabels", () => {
  it("accepts a small label array", () => {
    expect(validateTagLabels(["urgent", "admin"])).toEqual(["urgent", "admin"]);
  });
  it("rejects non-arrays", () => {
    expect(() => validateTagLabels("urgent")).toThrow();
    expect(() => validateTagLabels(null)).toThrow();
    expect(() => validateTagLabels(undefined)).toThrow();
  });
  it("rejects arrays with non-string entries", () => {
    expect(() => validateTagLabels(["ok", 42])).toThrow();
  });
  it("rejects empty strings", () => {
    expect(() => validateTagLabels(["ok", ""])).toThrow();
    expect(() => validateTagLabels(["ok", "   "])).toThrow();
  });
  it("rejects too many entries", () => {
    const huge = Array.from({ length: 51 }, (_, i) => `t${i}`);
    expect(() => validateTagLabels(huge)).toThrow(/50/);
  });
  it("rejects over-long labels", () => {
    const long = "x".repeat(101);
    expect(() => validateTagLabels([long])).toThrow(/100/);
  });
});

describe("resolveTagLabelsToIds", () => {
  it("returns [] for empty input without hitting the network", async () => {
    const calls = installFetchMock({});
    const ids = await resolveTagLabelsToIds([]);
    expect(ids).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("returns [] for null/undefined without hitting the network", async () => {
    const calls = installFetchMock({});
    expect(await resolveTagLabelsToIds(null)).toEqual([]);
    expect(await resolveTagLabelsToIds(undefined)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("reuses existing tag IDs by case-insensitive match", async () => {
    const calls = installFetchMock({
      "GET /v3/tags/list": {
        data: {
          tags: [
            { id: "uuid-urgent", name: "urgent" },
            { id: "uuid-admin", name: "Admin" },
          ],
        },
      },
    });
    const ids = await resolveTagLabelsToIds(["URGENT", "admin"]);
    expect(ids).toEqual(["uuid-urgent", "uuid-admin"]);
    // Only the list call — no create calls
    expect(calls.filter((c) => c.path === "/v3/tags/create")).toHaveLength(0);
  });

  it("creates missing tags via /v3/tags/create and returns the new IDs", async () => {
    const calls = installFetchMock({
      "GET /v3/tags/list": { data: { tags: [] } },
      "POST /v3/tags/create": { data: { id: "uuid-new" } },
    });
    const ids = await resolveTagLabelsToIds(["fresh"]);
    expect(ids).toEqual(["uuid-new"]);
    const creates = calls.filter((c) => c.path === "/v3/tags/create");
    expect(creates).toHaveLength(1);
    expect(creates[0].body).toEqual({ name: "fresh" });
  });

  it("mixes existing + new, preserving input order", async () => {
    let createCount = 0;
    const calls = installFetchMock({
      "GET /v3/tags/list": {
        data: { tags: [{ id: "uuid-existing", name: "existing" }] },
      },
      "POST /v3/tags/create": { data: { id: "uuid-gen" } },
    });
    // Stub create to return distinct IDs per call
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/v3/tags/create") {
        createCount++;
        calls.push({ path, method: "POST", body: JSON.parse(init.body) });
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ data: { id: `uuid-new-${createCount}` } }),
        };
      }
      return realFetch(url, init);
    });
    const ids = await resolveTagLabelsToIds(["new-one", "existing", "new-two"]);
    expect(ids).toEqual(["uuid-new-1", "uuid-existing", "uuid-new-2"]);
  });

  it("deduplicates case-insensitive labels in the input", async () => {
    const calls = installFetchMock({
      "GET /v3/tags/list": {
        data: { tags: [{ id: "uuid-a", name: "alpha" }] },
      },
    });
    const ids = await resolveTagLabelsToIds(["alpha", "ALPHA", "Alpha"]);
    expect(ids).toEqual(["uuid-a"]);
  });

  it("handles the legacy {tags: [...]} response shape", async () => {
    installFetchMock({
      "GET /v3/tags/list": { tags: [{ id: "uuid-legacy", name: "legacy" }] },
    });
    expect(await resolveTagLabelsToIds(["legacy"])).toEqual(["uuid-legacy"]);
  });

  it("handles Morgen's live bare-array response shape (regression fix v0.1.9)", async () => {
    // Verified live 2026-04-15: /v3/tags/list returns [...] at the top
    // level, not { data: { tags: [...] } }. Earlier parser fell through
    // to the [] fallback and silently dropped every tag, breaking every
    // tagged create/update in the MCP.
    installFetchMock({
      "GET /v3/tags/list": [
        { id: "uuid-urgent", name: "Urgent", color: "#FF0000" },
        { id: "uuid-project", name: "ProjectA", color: "#00FF00" },
      ],
    });
    expect(await resolveTagLabelsToIds(["Urgent", "ProjectA"])).toEqual([
      "uuid-urgent",
      "uuid-project",
    ]);
  });

  it("handles top-level-id create response (Morgen's actual shape)", async () => {
    // /v3/tags/create returns { id, name, color, position } with top-level id.
    // resolveTagLabelsToIds already accepts this via the ?? createResponse?.id
    // fallback, but lock in the behavior with a regression test.
    installFetchMock({
      "GET /v3/tags/list": [],
      "POST /v3/tags/create": {
        id: "uuid-new-top",
        name: "fresh",
        color: "#ABCDEF",
        position: 1,
      },
    });
    expect(await resolveTagLabelsToIds(["fresh"])).toEqual(["uuid-new-top"]);
  });

  it("skips created tags that the server returns without an id", async () => {
    installFetchMock({
      "GET /v3/tags/list": { data: { tags: [] } },
      "POST /v3/tags/create": { data: {} }, // no id echoed
    });
    const ids = await resolveTagLabelsToIds(["ghost"]);
    expect(ids).toEqual([]);
  });
});
