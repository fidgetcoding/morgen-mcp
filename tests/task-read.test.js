// list_tasks and get_task against the responses https://docs.morgen.so/tasks
// documents: open tasks from /tasks/list, and a 200 from /tasks?id= for a live
// task, a deleted task (deleted: true) and an unknown ID (data.task: null).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_TOOLS, taskHandlers } from "../src/tools-tasks.js";
import { _resetRateLimiter } from "../src/client.js";

const OPEN = { id: "open-1", title: "Open", progress: "needs-action", integrationId: "morgen" };
const COMPLETED = { id: "done-1", title: "Done", progress: "completed", integrationId: "morgen" };
const DELETED = { id: "gone-1", title: "Gone", progress: "needs-action", deleted: true, integrationId: "morgen" };
const SCHEDULED = { id: "sched-1", title: "On grid", "morgen.so:derived": { scheduled: true } };

let requests;

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  _resetRateLimiter();
  requests = [];
  process.env.MORGEN_API_KEY = "test-key-placeholder";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const { pathname, searchParams } = new URL(url);
      requests.push(pathname + (searchParams.size ? `?${searchParams}` : ""));
      if (pathname === "/v3/tasks/list") return json({ data: { tasks: [OPEN], labelDefs: [], spaces: [] } });
      const byId = { "done-1": COMPLETED, "gone-1": DELETED, "open-1": OPEN, "sched-1": SCHEDULED };
      return json({ data: { task: byId[searchParams.get("id")] ?? null, labelDefs: [] } });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("list_tasks", () => {
  it("makes one list call and keeps its shape when no IDs are passed", async () => {
    const out = await taskHandlers.list_tasks();
    expect(out.count).toBe(1);
    expect(out.tasks.map((t) => t.id)).toEqual(["open-1"]);
    expect(out).not.toHaveProperty("not_found");
    expect(requests).toEqual(["/v3/tasks/list?limit=500"]);
  });

  it("adds completed and deleted tasks by ID and reports unknown ones", async () => {
    const out = await taskHandlers.list_tasks({ include_task_ids: ["done-1", "gone-1", "nope"] });
    expect(out.count).toBe(3);
    expect(out.tasks.find((t) => t.id === "done-1").progress).toBe("completed");
    expect(out.tasks.find((t) => t.id === "gone-1").deleted).toBe(true);
    expect(out.not_found).toEqual(["nope"]);
  });

  it("doesn't refetch an ID the list already returned, or a repeated ID", async () => {
    const out = await taskHandlers.list_tasks({ include_task_ids: ["open-1", "done-1", "done-1"] });
    expect(out.tasks.map((t) => t.id)).toEqual(["open-1", "done-1"]);
    expect(requests).toEqual(["/v3/tasks/list?limit=500", "/v3/tasks?id=done-1"]);
  });

  it("rejects bad input before calling Morgen", async () => {
    await expect(taskHandlers.list_tasks({ include_task_ids: "done-1" })).rejects.toThrow(/array/);
    await expect(taskHandlers.list_tasks({ include_task_ids: ["../secret"] })).rejects.toThrow(/invalid characters/);
    const tooMany = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    await expect(taskHandlers.list_tasks({ include_task_ids: tooMany })).rejects.toThrow(/at most 50/);
    expect(requests).toEqual([]);
  });
});

describe("get_task", () => {
  it("reads a completed task", async () => {
    const out = await taskHandlers.get_task({ task_id: "done-1" });
    expect(out.progress).toBe("completed");
    expect(out).not.toHaveProperty("deleted");
  });

  it("flags a deleted task", async () => {
    const out = await taskHandlers.get_task({ task_id: "gone-1" });
    expect(out.deleted).toBe(true);
  });

  it("reports an unknown ID without inventing a task", async () => {
    expect(await taskHandlers.get_task({ task_id: "nope" })).toEqual({ id: "nope", found: false });
  });

  it("passes through Morgen's read-only scheduled flag", async () => {
    const out = await taskHandlers.get_task({ task_id: "sched-1" });
    expect(out.scheduled).toBe(true);
  });

  it("is registered as a tool with a required task_id", () => {
    const tool = TASK_TOOLS.find((t) => t.name === "get_task");
    expect(tool.inputSchema.required).toEqual(["task_id"]);
  });
});

describe("plan errors", () => {
  it("mentions the plan on a 403", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"message":"Missing entitlements"}', { status: 403 })));
    await expect(taskHandlers.list_tasks()).rejects.toThrow(/plan may not include API access/);
  });
});
