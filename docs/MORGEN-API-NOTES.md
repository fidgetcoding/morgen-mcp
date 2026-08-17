# Morgen API Reference Notes

Authoritative facts verified against docs.morgen.so on 2026-04-13. Every claim cites its source URL.

## Base URL

- **`https://api.morgen.so`** (NOT `sync.morgen.so`)
- All endpoints live under `/v3/...`
- Source: https://docs.morgen.so/events and https://docs.morgen.so/calendars
- Verbatim example: `fetch("https://api.morgen.so/v3/calendars/list", ...)`

## Authentication

- Header: **`Authorization: ApiKey <API_KEY>`** (literal word "ApiKey", space, key — not "Bearer", not "X-API-Key")
- Source: https://docs.morgen.so/events
- Verbatim: `Authorization: "ApiKey <API_KEY>"`
- Obtain key at platform.morgen.so → Developers API page.
- Source: https://docs.morgen.so/authentication

## Tasks (`/v3/tasks/...`)

Source: https://docs.morgen.so/tasks

### Priority — INTEGER, not enum
- Type: `Number`
- Range: `0–9`
- Semantics: `0 = undefined, 1 = highest, 9 = lowest`
- NOT `low | normal | high | urgent`.

### Task list field — `taskListId` (NOT `listId`)
- Example value: `"taskListId": "default"`

### Task lists are being DEPRECATED — use tags instead
Confirmed 2026-04-15 by John Mavrick (Software Developer @ Morgen) via direct email:

> "As for task lists, would you be open to using tags instead? Those are documented with a public API available https://docs.morgen.so/tags and tags technically would cover all the use cases tasks do. In our upcoming launch of a new app we are actually removing task lists as everything can be done with tags (Inbox would have its own tag), or could just be tasks without one."

**Implications for the MCP and any downstream sync (e.g. n8n Obsidian↔Morgen):**

- Do **not** invest in task-list discovery or lookup by name — the resource is going away in the next Morgen app release. The earlier probes for `/v3/tasks/lists`, `/v3/task-lists`, `/v3/tasks/containers` (all 404) were hitting a resource Morgen never intended to expose and is now removing.
- Keep `taskListId: "inbox"` as a shim **for now** — it's the only valid value today and the create endpoint still requires a list. Once the new app ships it will likely become optional or ignored.
- **Tags replace lists as the primary organization mechanism.** "Inbox" becomes a tag called `Inbox`, "Lorecraft" becomes a tag called `Lorecraft`, etc.
- Tags are **multi-valued**, unlike lists — this is actually useful (a task can be both `ProjectA` and `Urgent`). Enforce "one Area tag at a time" in application logic, not via schema; John confirmed Morgen itself relies on prompt/convention for this.
- Task completion status is **orthogonal** to tags. The `progress` enum (and `/tasks/close` / `/tasks/reopen`) keeps working exactly as before. Switching from lists to tags changes the organizational bucket, not the checkbox.

Related memory: `reference_morgen_api_quirks.md`, `project_morgen_first_party_mcp.md`.

### Full task object fields
`@type`, `id`, `accountId`, `integrationId`, `taskListId`, `created`, `updated`, `title`, `description`, `descriptionContentType`, `due`, `timeZone`, `estimatedDuration`, `priority` (Number), `progress` (String), `position` (Number), `relatedTo` (Object), `tags` (Array).

Note: `created`/`updated` timestamps (not `createdAt`/`updatedAt`). No `completed` boolean — status is represented via `progress` (String).

### Task-to-calendar scheduling — NOT exposed by the public API
Confirmed 2026-04-14. Morgen's web app has a drag-task-to-calendar feature that produces events with `morgen.so:metadata.taskId` set (and the checkbox render in the UI). **This mechanism is NOT exposed by the public v3 API.** Specifically verified:

- `/v3/tasks/update` whitelist-rejects `start`, `scheduledStart`, `calendarId`, `accountId`. Error: `"property <field> should not exist"`.
- `/v3/events/create` with `morgen.so:metadata.taskId` in the body rejects with either `"An event with canBeCompleted cannot have a taskId"` (when `canBeCompleted: true`) or `"Invalid event id"` (when `canBeCompleted: false`).
- `/v3/events/update` with top-level `taskId` rejects: `"property taskId should not exist"`.
- No endpoint exists at `/v3/tasks/schedule`, `/v3/tasks/plan`, `/v3/tasks/block`, `/v3/tasks/timeblock`, `/v3/events/fromTask`, `/v3/events/createFromTask`, `/v3/events/linkTask`, `/v3/tasks/scheduleOn`, `/v3/tasks/planAt`, `/v3/calendars/block-task`, or `/v3/tasks/scheduleInCalendar`. All return 404.
- The `morgen.so:metadata` field on an event is documented as **read-only** at https://docs.morgen.so/events.

**Workaround:** create the task via `/v3/tasks/create`, then have the user drag it to a time slot in the Morgen web app. The drag triggers Morgen's private linking endpoint which is not in the public API. File a feature request with Morgen support to expose it.

### `due` field — floating local datetime (JSCalendar RFC 8984 §3.3)
Confirmed by live testing 2026-04-14. Morgen's task `due` field expects a
**floating local datetime** string with NO timezone offset and NO `Z` suffix.
The IANA timezone for interpreting the due date is stored separately in the
`timeZone` field on the task object.

**Rejected (HTTP 400):**
- `"2026-04-14T00:00:00-04:00"` — offset-aware (EST)
- `"2026-04-14T23:59:00.000Z"` — UTC with milliseconds

**Accepted:**
- `"2026-04-14T00:00:00"` — floating local datetime, no offset
- `"2026-04-14T23:59:00"` — floating local datetime, no offset

The MCP's `toFloatingDateTime()` helper in `src/validation.js` (added in v0.1.7)
strips any trailing `+HH:MM`, `-HH:MM`, or `Z` (and optional preceding `.NNN`
milliseconds) from the resolved datetime before POSTing to `/v3/tasks/create`
and `/v3/tasks/update`. ISO pass-through and NL-parsed datetimes both run
through this normalization step.

### /v3/tasks/create response shape — echoes ONLY the ID
Verified live 2026-04-14 against the published API. The `POST /v3/tasks/create` endpoint returns:
```json
{ "data": { "id": "<uuid>" } }
```
It does **not** echo the full task object. To read back the created task with Morgen's server-side defaults applied (priority, progress, position, created/updated), call `/v3/tasks/list` and filter by the returned ID. The same applies to `/v3/tasks/update`.

### `tags` field — array of tag ID strings (UUIDs), NOT labels
Confirmed against https://docs.morgen.so/tasks and https://docs.morgen.so/tags on 2026-04-14.

On the Task object, `tags` is an array of **tag ID strings** (UUIDs referencing Tag resources), not an array of human-readable label strings and not an array of typed objects. Verbatim doc example:

```json
"tags": ["550e8400-e29b-41d4-a716-446655440000"]
```

Tags are a first-class resource. Each Tag has its own schema and CRUD endpoints:

```ts
interface Tag {
  id: string;       // UUID
  name?: string;    // display label
  color?: string;   // "#RRGGBB"
  updated?: string; // ISO 8601
  deleted?: boolean;
}
```

- `GET  /v3/tags/list`          — list tags (optional `limit`, `updatedAfter`)
- `GET  /v3/tags?id=<TAG_ID>`   — fetch single tag
- `POST /v3/tags/create`        — body: `{ name: string, color?: string }` → `{ data: { id } }`
- `POST /v3/tags/update`        — body: `{ id, name?, color? }` (name/color cannot be unset once set)
- `POST /v3/tags/delete`        — body: `{ id }`

### Why v0.1.4 tags broke (HTTP 400)
morgen-mcp ≤ v0.1.3 forwarded user-supplied label strings directly (`tags: ["urgent","admin"]`) into the `/v3/tasks/create` body. Morgen expected UUID references to pre-existing Tag resources, so the label strings failed validation and the whole create call 400'd. Removing the param in v0.1.4 was the correct temporary fix.

### v0.1.5 — label-to-ID resolution layer (SHIPPED)
User-friendly `tags` param restored at the MCP surface as an array of label strings. Label → ID resolution happens inside the handler:

1. At create_task / update_task / event_to_task entry, if `tags` was provided:
   a. `src/tags.js` calls `/v3/tags/list` once per handler invocation and builds a label→id map (case-insensitive).
   b. For each requested label, the resolver reuses an existing Tag if found; otherwise calls `/v3/tags/create` with `{ name: label }` and captures the new ID.
   c. `body.tags` is replaced with the resolved `[tagId, ...]` array before POSTing to `/v3/tasks/create` or `/v3/tasks/update`.
2. Rate-limit cost per call with tags: 10 (list) + 1 per missing tag (create) + 1 (task create/update). The label→id map is in-memory per handler invocation only — not persisted across calls because tag state can change server-side.
3. MCP-facing schema is `{ type: "array", items: { type: "string" }, maxItems: 50 }` with the description "human-readable labels; auto-created on first use". Strict input validation via `validateTagLabels` in `src/tags.js`.

## Events (`/v3/events/...`)

Source: https://docs.morgen.so/events

### Recurrence — `recurrenceRules`, array of STRUCTURED OBJECTS (JSCalendar RFC 8984 §4.3.3, not RFC 5545 RRULE strings)
Morgen's events API accepts JSCalendar `RecurrenceRule` objects from RFC 8984. The docs example shows only a tiny subset — the full object graph is documented below based on RFC 8984 + verification against live calls.

Verbatim doc example:
```json
"recurrenceRules": [{
  "@type": "RecurrenceRule",
  "frequency": "weekly",
  "interval": 1,
  "byDay": [{ "@type": "NDay", "day": "mo" }]
}]
```

**Full `RecurrenceRule` object fields** (all optional unless marked):

| Field | Type | Notes |
|---|---|---|
| `@type` | `"RecurrenceRule"` | **required literal** |
| `frequency` | string enum | **required**. One of: `yearly`, `monthly`, `weekly`, `daily`, `hourly`, `minutely`, `secondly` |
| `interval` | positive integer | defaults to `1`. "Every N units of `frequency`" |
| `byDay` | array of `NDay` objects | day-of-week filter. See `NDay` below |
| `byMonthDay` | array of integers | day-of-month filter (1-31, or -1 to -31 for "last Nth") |
| `byMonth` | array of strings | month filter (`"1"` to `"12"` as strings, not ints) |
| `byYearDay` | array of integers | day-of-year filter (1-366, or negative for "from end") |
| `byWeekNo` | array of integers | ISO week number filter |
| `byHour` | array of integers | hour-of-day filter (0-23) |
| `byMinute` | array of integers | minute filter (0-59) |
| `bySecond` | array of integers | second filter (0-59) |
| `bySetPosition` | array of integers | nth occurrence selector after byDay/byMonth/etc. filter is applied |
| `count` | positive integer | total occurrences. **Mutually exclusive with `until`** |
| `until` | LocalDateTime | stop date. **Mutually exclusive with `count`** |
| `skip` | string | `"omit"` (default), `"backward"`, or `"forward"` |
| `firstDayOfWeek` | string | `"mo"` (default), `"su"`, etc. — affects weekly-frequency week boundaries |
| `rscale` | string | calendar system — default `"gregorian"`, rarely changed |

**`NDay` object** (inside `byDay`):
```json
{ "@type": "NDay", "day": "mo", "nthOfPeriod": 1 }
```
- `@type`: `"NDay"` literal
- `day`: two-char day code — `mo`, `tu`, `we`, `th`, `fr`, `sa`, `su`
- `nthOfPeriod` (optional): non-zero integer. `1` = first, `2` = second, `-1` = last. Used for "first monday of month" / "last friday of month" patterns.

**Common patterns:**

Every monday at recurrence-source time:
```json
{ "@type": "RecurrenceRule", "frequency": "weekly", "interval": 1,
  "byDay": [{ "@type": "NDay", "day": "mo" }] }
```

Weekdays (every mon-fri):
```json
{ "@type": "RecurrenceRule", "frequency": "weekly", "interval": 1,
  "byDay": [
    { "@type": "NDay", "day": "mo" }, { "@type": "NDay", "day": "tu" },
    { "@type": "NDay", "day": "we" }, { "@type": "NDay", "day": "th" },
    { "@type": "NDay", "day": "fr" }
  ] }
```

First monday of every month:
```json
{ "@type": "RecurrenceRule", "frequency": "monthly", "interval": 1,
  "byDay": [{ "@type": "NDay", "day": "mo", "nthOfPeriod": 1 }] }
```

Last friday of every month:
```json
{ "@type": "RecurrenceRule", "frequency": "monthly", "interval": 1,
  "byDay": [{ "@type": "NDay", "day": "fr", "nthOfPeriod": -1 }] }
```

Every 2 weeks (biweekly):
```json
{ "@type": "RecurrenceRule", "frequency": "weekly", "interval": 2 }
```

For 10 occurrences only:
```json
{ "@type": "RecurrenceRule", "frequency": "daily", "interval": 1, "count": 10 }
```

Until a specific date:
```json
{ "@type": "RecurrenceRule", "frequency": "weekly", "interval": 1,
  "until": "2026-12-31T23:59:59" }
```

### NL recurrence helper (v0.1.6)
The `nl-recurrence.js` module translates natural-language strings into the structured objects above. `create_event` and `update_event` accept either a `string` OR an `array` for `recurrence_rules`. Supported phrases include: `daily`, `every day`, `weekly`, `every monday`, `every tuesday and thursday`, `weekdays`, `weekends`, `biweekly` / `every other week`, `every 3 weeks`, `monthly`, `first monday of every month`, `last friday of every month`, `every 2 months`, `yearly`, `annually`. Patterns that can't be represented cleanly in JSCalendar (e.g. "every 4th tuesday of each quarter", "every weekday except wednesday") throw a clear error listing supported patterns instead of silently doing the wrong thing.

### `seriesUpdateMode`
- Query parameter (not body field).
- Values: `all`, `future`, `single`
- Default: `single`

### Participants
- Map keyed by participant ID. Each value:
```json
{
  "@type": "Participant",
  "name": "John Doe",
  "email": "doe@morgen.so",
  "roles": { "attendee": true, "owner": true },
  "participationStatus": "needs-action",
  "accountOwner": true
}
```
- Fields: `name`, `email`, `roles` (object), `participationStatus` (NOT `responseStatus` or `status`).
- No separate `organizer` field — organizer is the participant with `roles.owner === true`.

## Calendars (`/v3/calendars/list`)

Source: https://docs.morgen.so/calendars

### Response shape — `{ data: { calendars: [...] } }` (doubly-wrapped)

### Calendar object fields
`@type` ("Calendar"), `id`, `accountId`, `integrationId` (e.g. `"o365"`), `name`, `color`, `sortOrder`, `myRights` (permissions object: `mayReadItems`, `mayWriteAll`, etc.), `defaultAlertsWithTime`, `defaultAlertsWithoutTime`, `morgen.so:metadata` (`busy`, `overrideColor`, `overrideName`).

Note: **no `isPrimary`, no `isReadOnly`, no `timezone` field.** Read-only is derived from `myRights`. Account-default status is not exposed as `isPrimary`.
