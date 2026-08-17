# morgen-mcp Architecture

Current as of v0.1.7 (2026-04-14).

## File Size Audit (500-line project limit)

| File                                      | Lines | Status |
|-------------------------------------------|------:|--------|
| src/validation.js                         |    63 | OK     |
| src/tags.js                               |    89 | OK (NEW in v0.1.5) |
| src/index.js                              |   137 | OK     |
| src/client.js                             |   141 | OK     |
| src/events-shape.js                       |   189 | OK     |
| src/nl-date-parser.js                     |   190 | OK (NEW in v0.1.6) |
| src/tools-conversions.js                  |   192 | OK (NEW in v0.1.5) |
| src/calendar-cache.js                     |   202 | OK     |
| src/nl-recurrence.js                      |   212 | OK (NEW in v0.1.6) |
| src/tools-events-schema.js                |   278 | OK     |
| src/tools-reflow.js                       |   436 | OK (NEW in v0.1.4) |
| src/tools-events.js                       |   461 | OK     |
| src/tools-tasks.js                        |   489 | OK (within 11 of cap — next task feature requires tools-tasks-schema.js split) |
| bin/setup.js                              |    96 | OK     |
| tests/ (15 files)                         |  ~3.5k | test suite, informational |

All production files under the 500-line limit. Modules were split progressively across v0.1.2 → v0.1.6 to keep each one single-purpose:

- **v0.1.2** extracted `tools-events-schema.js` (JSON Schema defs) and `calendar-cache.js` (default-calendar resolver) from `tools-events.js`, and split the security test suite into three category-scoped files.
- **v0.1.4** added `tools-reflow.js` for the new `reflow_day` tool so the existing event module stayed focused on raw CRUD.
- **v0.1.5** extracted `tags.js` (label → UUID resolver, shared helper) out of `tools-tasks.js` to keep the task module under the 500-line cap after tags were re-enabled, and added `tools-conversions.js` for the `event_to_task` soft-conversion tool.
- **v0.1.6** added `nl-date-parser.js` (chrono-node wrapper) and `nl-recurrence.js` (natural-language recurrence helper) as pure client-side helpers shared across every tool that takes a date/time or recurrence input.

`tools-tasks.js` sits at 489/500 — the next task feature forces a `tools-tasks-schema.js` split following the same pattern as `tools-events-schema.js`.

## Dependency Graph

```
                      +----------------+
                      |  src/index.js  |  stdio entrypoint, env load, dispatch
                      +-------+--------+
                              |
                 +------------+------------+
                 |                         |
                 v                         v
        +------------------+      +------------------+
        | tools-events.js  |      | tools-tasks.js   |
        |  eventHandlers   |      |  TASK_TOOLS (7)  |
        |  (6 handlers)    |      |  taskHandlers    |
        +-+----+----+---+--+      +--+-----------+---+
          |    |    |   |            |           |
          |    |    |   +----+       |           |
          |    |    |        |       |           |
          |    |    v        v       |           |
          |    |  +--------------+ +--------------------+
          |    |  | tools-events-| | calendar-cache.js  |
          |    |  |  schema.js   | | getCalendarCache   |
          |    |  | EVENT_TOOLS  | | resolveCalendarMeta|
          |    |  |   (6 defs)   | | resolveDefaultMeta |
          |    |  +--------------+ +----+----------+----+
          |    |                        |          |
          |    v                        |          |
          |  +------------------+       |          |
          |  | events-shape.js  |<------+          |
          |  | mapCalendar      |                  |
          |  | mapEvent         |                  |
          |  | toParticipantMap |                  |
          |  | toLocationMap    |                  |
          |  | unwrap*          |                  |
          |  +------------------+                  |
          |                                        |
          v                                        v
        +-------------+<---------------------------+
        | client.js   |           +--------------------+
        | morgenFetch |           |  validation.js     |
        | rate limit  |           |  validateId,       |
        | retries     |           |  validateISODate,  |
        | key scrub   |           |  validateEnum,     |
        +------+------+           |  validateIntRange, |
               |                  |  validateStringArr |
               v                  +--------------------+
         (global fetch)
```

No circular imports. `index.js` depends on the two `tools-*` modules. `tools-events.js` depends on `tools-events-schema.js`, `events-shape.js`, `calendar-cache.js`, `client.js`, and `validation.js`. `calendar-cache.js` depends on `client.js` and `events-shape.js` (see `src/calendar-cache.js:46-60`). `tools-tasks.js` depends on `client.js` and `validation.js`. `client.js` and `validation.js` have zero intra-project imports.

## Tool Count

- `EVENT_TOOLS` — 6 (`list_calendars`, `list_events`, `create_event`, `update_event`, `delete_event`, `rsvp_event`), defined in `src/tools-events-schema.js`
- `TASK_TOOLS` — 7 (`list_tasks`, `create_task`, `update_task`, `move_task`, `close_task`, `reopen_task`, `delete_task`), defined in `src/tools-tasks.js`
- `REFLOW_TOOLS` — 1 (`reflow_day`), defined in `src/tools-reflow.js` (NEW in v0.1.4)
- `CONVERSION_TOOLS` — 1 (`event_to_task`), defined in `src/tools-conversions.js` (NEW in v0.1.5)
- Total registered via `src/index.js`: **15**

## Separation of Concerns

- `index.js` — MCP stdio transport, env bootstrap, tool dispatch, URL-redacting error sanitization, and (v0.1.6) structured-metadata preservation on partial-failure errors (`err.reflow` / `err.conversion` surfaced in both stderr log and content payload).
- `client.js` — HTTP wrapper (`morgenFetch`): 30s timeout, 3x retry on 429/503/network, rolling 300-point-per-15-minute rate limiter (raised from 100 in v0.1.8) with accurate wait-time calculation, API key scrubbing in thrown errors.
- `validation.js` — pure input validators and format normalizers. No rate-limit logic (the canonical limiter lives in `client.js`). v0.1.7 adds `toFloatingDateTime()` — strips offset/Z from resolved datetime strings before they reach Morgen's task endpoints, which require JSCalendar floating local datetimes.
- `tools-events-schema.js` — pure JSON Schema definitions for the six `EVENT_TOOLS` entries, zero runtime behavior.
- `tools-events.js` — event handler implementations; composes the schema module, shape helpers, the calendar cache, the v0.1.3 smart account router, and (v0.1.6) the NL date and recurrence parsers.
- `events-shape.js` — pure helpers: response unwrappers (`data.data.*`), `mapCalendar`, `mapEvent`, `toParticipantMap`, `toLocationMap`, `validateRecurrenceRules`.
- `calendar-cache.js` — 10-minute in-memory cache for `list_calendars` results so `create_event`/`update_event` calls that omit `calendar_id` don't spend 10 rate points per call. Also exposes `resolveSelfEmail` (fallback chain: `MORGEN_SELF_EMAIL` env → email-shaped calendar name → throw) used by `rsvp_event` and `reflow_day` solo-block detection.
- `tools-tasks.js` — task tool schemas + handlers. Priority validated as integer 0-9 per the Morgen spec. Tags accepted as human-readable label strings and resolved to UUIDs via `tags.js` (v0.1.5). `synthesizeTaskFromBody` merges the request body with Morgen's ID-only create/update response so callers get an immediately usable return shape.
- `tags.js` — (NEW v0.1.5) label → UUID resolver for Morgen's Tag resource. Calls `/v3/tags/list` once per handler invocation, auto-creates any missing labels via `/v3/tags/create`, case-insensitive match, input deduplication. Cost: 10 pts (list) + 1 pt per new tag.
- `tools-reflow.js` — (NEW v0.1.4) `reflow_day` tool: compresses same-day events back-to-back from an anchor time, with `dry_run: true` default, `protect_fixed` auto-filter for solo blocks (v0.1.6 fix: only runs when `protect_fixed === true`), explicit `event_ids` override capped at 50, and partial-failure recovery via `err.reflow = { applied, pending, failed_at }`.
- `tools-conversions.js` — (NEW v0.1.5) `event_to_task` soft-conversion tool. Bundles `create_task` + `delete_event` into one call. Partial-failure recovery via `err.conversion = { task_id, source_event_id, deleted, error }`.
- `nl-date-parser.js` — (NEW v0.1.6) chrono-node-backed natural-language date/time parser. Exports `resolveDateTimeInput`, `resolveDateInput`, `resolveTimeInput` with ISO 8601 fast-path. DST-safe two-pass `resolveWallClockInZone` algorithm. Applied uniformly to every tool that accepts a date/time field.
- `nl-recurrence.js` — (NEW v0.1.6) natural-language → Morgen `RecurrenceRule` array helper. Handles "every monday", "weekdays", "first friday of every month", "biweekly", etc. Pass-through for existing array input. Wired into `create_event` + `update_event`.
- `bin/setup.js` — interactive first-run script that writes `MORGEN_API_KEY` into a local `.env` file.

## Consistency with motion-mcp

- **Intentional divergence — split files:** Motion ships one monolithic `src/index.js`. morgen-mcp splits into `index.js` / `client.js` / `tools-events.js` / `tools-events-schema.js` / `events-shape.js` / `calendar-cache.js` / `tools-tasks.js` / `validation.js` to respect the 500-line-per-file project rule and maintain clear bounded contexts.
- **Intentional divergence — simpler auth:** Motion uses OAuth via extracted Firebase refresh tokens. Morgen uses a single `Authorization: ApiKey <key>` header, so there is no token refresh cycle in `client.js`.
- **Intentional divergence — point-based rate limiter:** Motion tracks request counts; Morgen's documented limit is point-based (10 pts per list, 1 pt per write), so `client.js` ledgers points not requests.

## CLAUDE.md Compliance Matrix

| Rule                                    | Status |
|-----------------------------------------|--------|
| Files under 500 lines                   | PASS   |
| No stray files in repo root             | PASS   |
| Input validation at system boundaries   | PASS (every tool handler validates before fetch) |
| No secrets hardcoded                    | PASS (`MORGEN_API_KEY` read from env; `.env.example` ships without values) |
| DDD / bounded contexts                  | PASS (each module has a single clear responsibility) |

## Morgen API Shape Compliance

Every request body and response parser is aligned with the verified Morgen API shape documented in `docs/MORGEN-API-NOTES.md`:

- Base URL `https://api.morgen.so`.
- Auth header `Authorization: ApiKey <key>`.
- Doubly-wrapped list responses (`data.data.calendars`, `data.data.events`, `data.data.tasks`).
- Calendar objects: `readOnly` is derived from `myRights` (no `isPrimary`/`isReadOnly`/`timezone` fields on the wire).
- Event `participants` submitted as a keyed map `{ <email>: { "@type": "Participant", email, roles, participationStatus } }`.
- Event `locations` (plural) submitted as a keyed map with `{ "@type": "Location", name, ... }` entries — NEW in v0.1.2.
- Event `recurrenceRules` submitted as structured objects, not RFC 5545 RRULE strings. v0.1.6 additionally accepts natural-language strings via `nl-recurrence.js` which translate into the same structured shape before POST.
- Event `seriesUpdateMode` sent as a query parameter on update/delete, not as a body field.
- `create_event` and `update_event` must send all four timing fields together (`start`, `duration`, `timeZone`, `showWithoutTime`); omitting `timeZone` is rejected by the API — NEW in v0.1.2.
- Task priority is integer 0-9 (0 = undefined, 1 = highest, 9 = lowest); task list field is `taskListId` (not `listId`); task timestamps use `created`/`updated` (not `createdAt`/`updatedAt`).
- `move_task` is implemented against `POST /v3/tasks/update` with a new `taskListId` in the body; there is no `/v3/tasks/move` endpoint — NEW in v0.1.2.
- `rsvp_event` — Morgen has NO dedicated RSVP endpoint. `/v3/events/accept`, `/decline`, `/tentative` DO NOT EXIST. RSVP is implemented by PATCHing the participants map via `POST /v3/events/update` with past-tense `participationStatus` values — NEW in v0.1.3.
- `create_event` smart routing — requests that omit `calendar_id` auto-route to an account from your `MORGEN_ACCOUNT_ROUTES` config, matching participant email domains and title/description keywords, then falling back to the route marked `default` and finally to the default writable calendar. Override with an explicit `account` name. Unset the variable and routing switches off. See `src/account-routes.js`.
- Task `tags` on the wire are an array of Morgen tag UUIDs, not label strings. The MCP accepts human-readable labels at the surface and resolves them to UUIDs via `tags.js` → `/v3/tags/list` + `/v3/tags/create` — NEW in v0.1.5 (after v0.1.4 discovered Morgen rejects string-array tags with HTTP 400).
- `/v3/tasks/create` and `/v3/tasks/update` responses echo only `{ data: { id } }` — the MCP synthesizes a usable return shape from the request body + returned ID via `synthesizeTaskFromBody` — NEW in v0.1.4.
- Task `due` field uses JSCalendar floating local datetimes (RFC 8984 §3.3): no timezone offset, no `Z` suffix. Offset-aware strings (`2026-04-14T00:00:00-04:00`, `2026-04-14T23:59:00Z`) are rejected with HTTP 400. The `toFloatingDateTime()` helper in `validation.js` strips any trailing offset/Z before the body is POSTed — NEW in v0.1.7 (confirmed by live 400s in the field).
- **Task-to-calendar scheduling is NOT exposed by the public API.** The `morgen.so:metadata.taskId` linkage the Morgen web app drag-to-schedule uses is private. See `docs/MORGEN-API-NOTES.md` "Task-to-calendar scheduling" section for the full list of probed endpoints and rejection reasons. A feature request was filed with Morgen support on 2026-04-14 asking them to expose it publicly — confirmed NEW in v0.1.5 investigation.
