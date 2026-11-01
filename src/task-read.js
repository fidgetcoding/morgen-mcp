// Reading Morgen tasks: list_tasks, get_task, and the shared response shaping.
//
// /v3/tasks/list returns open tasks only, with no parameter to change that
// (https://docs.morgen.so/tasks, "Deleted and unknown tasks"). A completed or
// deleted task can only be read by ID through GET /v3/tasks?id=, so there is no
// way to enumerate them, only to look up IDs the caller already knows.
import { morgenFetch } from "./client.js";
import { validateId } from "./validation.js";

const MAX_INCLUDED_IDS = 50;

function unwrapTask(raw) {
  return raw?.data?.task ?? raw?.task ?? raw?.data ?? raw;
}

function unwrapTaskList(raw) {
  if (Array.isArray(raw)) return raw;
  return (
    raw?.data?.tasks ??
    raw?.tasks ??
    (Array.isArray(raw?.data) ? raw.data : []) ??
    []
  );
}

export function shapeTask(raw) {
  const task = unwrapTask(raw);
  if (!task || typeof task !== "object") return null;
  const scheduled = task["morgen.so:derived"]?.scheduled;
  return {
    id: task.id ?? null,
    title: task.title ?? null,
    description: task.description ?? null,
    due: task.due ?? null,
    priority: typeof task.priority === "number" ? task.priority : null,
    taskListId: task.taskListId ?? null,
    accountId: task.accountId ?? null,
    integrationId: task.integrationId ?? "morgen",
    progress: task.progress ?? null,
    position: typeof task.position === "number" ? task.position : null,
    estimatedDuration: task.estimatedDuration ?? null,
    timeZone: task.timeZone ?? null,
    tags: Array.isArray(task.tags) ? task.tags : undefined,
    created: task.created ?? null,
    updated: task.updated ?? null,
    ...(task.deleted === true ? { deleted: true } : {}),
    ...(typeof scheduled === "boolean" ? { scheduled } : {}),
  };
}

function shapeTaskList(raw) {
  const list = unwrapTaskList(raw);
  const tasks = list.map(shapeTask).filter(Boolean);
  return { count: tasks.length, tasks };
}

// Morgen answers 200 in every case: the task, the task with deleted: true, or
// data.task: null for an ID that is unknown or not yours. Never a 404.
async function fetchTaskById(id) {
  const response = await morgenFetch(`/v3/tasks?id=${encodeURIComponent(id)}`, { points: 1 });
  if (!response?.data?.task) return null;
  return shapeTask(response);
}

function validateIncludedIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("include_task_ids must be an array of task IDs");
  if (value.length > MAX_INCLUDED_IDS) {
    throw new Error(`include_task_ids accepts at most ${MAX_INCLUDED_IDS} IDs`);
  }
  return [...new Set(value.map((id) => validateId(id, "include_task_ids entry")))];
}

export const LIST_TASKS_TOOL = {
  name: "list_tasks",
  description:
    "List open native Morgen tasks. Morgen's list omits completed and deleted tasks and has no option to include them, so pass include_task_ids to add specific ones by ID. Does not include tasks synced from external providers (Todoist, Google Tasks, etc.).",
  inputSchema: {
    type: "object",
    properties: {
      include_task_ids: {
        type: "array",
        items: { type: "string" },
        maxItems: MAX_INCLUDED_IDS,
        description:
          "Task IDs to add to the result even if completed or deleted. Costs 1 rate-limit point per ID not already in the list. IDs Morgen doesn't recognize come back in not_found.",
      },
    },
    additionalProperties: false,
  },
};

export const GET_TASK_TOOL = {
  name: "get_task",
  description:
    "Read one native Morgen task by ID, including a completed or deleted one. A deleted task comes back with deleted: true. An ID that is unknown or not yours returns found: false.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "The Morgen ID of the task." },
    },
    required: ["task_id"],
    additionalProperties: false,
  },
};

export async function listTasks(args = {}) {
  const includedIds = validateIncludedIds(args.include_task_ids);
  const response = await morgenFetch("/v3/tasks/list?limit=500", { points: 10 });
  const result = shapeTaskList(response);
  if (includedIds.length === 0) return result;

  const listed = new Set(result.tasks.map((task) => task.id));
  const tasks = [...result.tasks];
  const notFound = [];
  for (const id of includedIds) {
    if (listed.has(id)) continue;
    const task = await fetchTaskById(id);
    if (task) tasks.push(task);
    else notFound.push(id);
  }
  return { count: tasks.length, tasks, not_found: notFound };
}

export async function getTask(args = {}) {
  const id = validateId(args.task_id, "task_id");
  return (await fetchTaskById(id)) ?? { id, found: false };
}
