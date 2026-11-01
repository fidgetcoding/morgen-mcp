# morgen-mcp Performance Notes

Current as of v0.1.8 (2026-04-15). Reference: https://docs.morgen.so/rate-limits

## Morgen Rate Limit Budget

- **300 points per 15-minute rolling window** per API key (raised from 100 on 2026-04-15 per direct confirmation from John Mavrick @ Morgen — "other users hitting limits quickly"). The constant lives in `src/client.js:3` since Morgen has no endpoint exposing the current budget.
- `/list` endpoints cost **10 points** each
- All other endpoints cost **1 point** each

The client rejects requests with points > 300 upfront, preventing indefinite waits on misconfigured endpoints.

## Steady-State Throughput

| Workload                                         | Req / 15 min | Points | Headroom |
|--------------------------------------------------|-------------:|-------:|---------:|
| Pure list calls                                  |           30 |    300 |        0 |
| Pure writes                                      |          300 |    300 |        0 |
| Mixed (5 lists + 250 writes)                     |          255 |    300 |        0 |
| Realistic (1 list + 290 writes)                  |          291 |    300 |        0 |
| Heavy read (8 lists + 220 writes)                |          228 |    300 |        0 |
| Multi-account unfiltered list_events (4 accts)   |            1 |     40 |      260 |
| n8n W2 (15-min poll: events/list + tasks/list)   |            2 |     20 |      280 |

One list call now consumes ~3.3% of the window budget (down from 10%). The n8n W2 polling workflow (~20 pts per 15-min tick) has 14× headroom, which means we can safely drop its cadence to 5-min polling (60 pts/15min) or add additional read calls without starving the budget. On Nate's 4-account setup, a single unfiltered `list_events` still fans out to one `/v3/events/list` call per account (see `src/tools-events.js:131-139`), costing 40 points — now 13% of the budget instead of 40%.

## Client Rate Limiter

The limiter in `src/client.js` is point-based, rolling-window, and enforces the budget _before_ making a request.

- Ledger entries: `{ timestamp, points }` (`src/client.js:6`)
- Pruning: every call drops entries older than 15 minutes (`src/client.js:9-12`)
- Upfront budget guard (new in v0.1.2): `enforceRateLimit` rejects any request whose `points` exceeds `RATE_LIMIT_POINTS` before touching the ledger (`src/client.js:37-41`). A caller who passes `points: 150` fails immediately rather than waiting forever for a slot that can never open.
- `msUntilFits` walks the ledger forward, summing points that must expire before the incoming request fits (`src/client.js:22-34`). This prevents the retry-storm pattern where a naive calculation reports "wait 30 seconds" but the request still fails because only the oldest entry expired.
- Errors thrown from `morgenFetch` run through `scrubKey()` to strip both full URLs and the `MORGEN_API_KEY` value before propagating to the caller (`src/client.js:96-104`).

## Default Calendar Cache

The cache lives in `src/calendar-cache.js` — not `src/tools-events.js`. Every Morgen write endpoint requires both `calendarId` AND `accountId`, so the module caches the full calendar directory (not just the default id) in `byId` and `byAccount` lookup maps. Without caching, each default-path `create_event` would cost 11 points (10 list + 1 create), dropping effective write throughput from 100 to 9 per window.

`loadCache()` hits `/v3/calendars/list` once, builds the lookup maps, picks the first writable calendar as the default, and stores the result for **10 minutes** (`src/calendar-cache.js:8`, `:42-44`).

Promise-dedupe fix (new in v0.1.2): two concurrent callers on a cold cache share the same in-flight fetch via a `loadingPromise` guard, preventing 2× the rate cost on startup. See `src/calendar-cache.js:47-54` — if `loadingPromise` is non-null, a second caller awaits the same promise instead of firing a duplicate `/v3/calendars/list` request. The promise clears in a `.finally()` so the next cold read can retry cleanly.

Test code can reset the cache via `_resetCalendarCache()` (`src/calendar-cache.js:98-102`), which also clears any pending `loadingPromise`.

## Points Assignment

| Handler                                                     | Points |
|-------------------------------------------------------------|-------:|
| `list_calendars`, `list_events`, `list_tasks`, `list_tags`  |     10 |
| All create / update / delete / move / close / reopen / rsvp |      1 |
| `create_task` / `update_task` WITH tags (new labels)        | 11 + N (N = new tag creates) |
| `create_task` / `update_task` WITH tags (all existing)      |     11 |
| `reflow_day` dry-run (single calendar)                      |     10 |
| `reflow_day` apply (single calendar, 5 event moves)         |     15 |
| `event_to_task`                                             |      2 |
| `event_to_task` WITH tags (new labels)                      | 12 + N |

All handler call sites pass `points` explicitly to `morgenFetch`.

## Post-v0.1.2 cost patterns

**v0.1.4 `reflow_day` (client-side compression)** — fetches events once (10 pts) then issues one `POST /v3/events/update` per reflowable step. For Nate's typical 4-5 focus blocks, that's 14-15 pts per apply call. Capped at **50 event_ids** (v0.1.5) to keep a pathological call under the 100-pt budget. On mid-loop failure, the tool throws a structured error with `applied_steps` / `pending_steps` so the caller can recover manually instead of re-running blind.

**v0.1.5 `tags` label resolver** — every `create_task` / `update_task` / `event_to_task` call that passes tag labels fans out to `/v3/tags/list` (10 pts) plus `/v3/tags/create` per missing tag (1 pt each). Worst case with 10 brand-new labels on one task: 10 + 10 + 1 = **21 pts** in a single create. With the v0.1.8 rate-limit bump to 300 pts/15min, a bulk Notion → Morgen import of 20 tasks with 3 new tags each (260 pts) now fits in a single window with headroom. Callers importing 25+ tagged tasks in one window should still batch-precreate tags once to be safe.

**v0.1.6 natural-language parsing** — pure client-side, zero additional rate-limit cost. `chrono-node` runs in-process, and `nl-recurrence.js` is a plain string-to-object transform. The only Morgen API calls in v0.1.6's NL path are the same ones that would have happened with raw ISO inputs.

**v0.1.6 structured-error preservation** — `src/index.js` now detects `err.reflow` / `err.conversion` on thrown errors and embeds them in both the stderr log and the user-facing content payload. No additional API cost; observability improvement only.

## Observability

- Structured JSON log lines are emitted to stderr on every tool call from `src/index.js`:
  `{ event: "tool_call", tool, status: "success" | "error", durationMs, error? }`
- No external observability integration (OpenTelemetry, Sentry, etc.) — acceptable for a local stdio MCP. Claude Code surfaces the stderr logs in its debugger panel.

## Future Optimizations (v0.1.7+)

- Add a pre-flight budget warning when `currentPoints() > 80`, logged to stderr.
- Optionally cache `list_events` / `list_tasks` responses for 30 seconds to survive bursty AI workflows.
- Pin cache TTL to an env var (e.g. `MORGEN_CACHE_TTL_MS`) for per-deployment tuning of the 10-minute default.
- **Parallelize `resolveTagLabelsToIds` tag-create calls** via `Promise.all` — currently serial, so 10 new tags = 10 sequential round-trips (~30s real-time latency). The 1-pt-per-call cost is unchanged, but wall-clock time improves dramatically.
- **Atomic server-side reflow** — waiting on Morgen to expose `POST /v3/calendars/reflow` per the 2026-04-14 feature request email. Would replace the sequential client-side loop and eliminate partial-failure state entirely.
