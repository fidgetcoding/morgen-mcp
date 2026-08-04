# Changelog

All notable changes to `fidgetcoding-morgen-mcp` are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note on package name:** This package was originally published as `morgen-mcp` on npm. Renamed to `fidgetcoding-morgen-mcp` on 2026-04-18 under the FidgetCoding brand umbrella. The old `morgen-mcp` package is deprecated with a redirect message. The GitHub owner account has since been renamed — the canonical URL today is `github.com/fidgetcoding/morgen-mcp` (old `lorecraft-io/morgen-mcp` URLs 301-redirect).

## [0.2.0] - 2026-08-04

### Fixed
- MCP stdio stream corruption: dotenv 17 prints an "injected env" tip line to stdout by default, which lands ahead of the JSON-RPC stream. Suppressed with `quiet: true` in `src/index.js`.

### Added
- `find_free_slots` (`src/tools-availability.js`) — returns open windows rather than bookings. Unions busy time across every connected calendar so a slot is only free when nothing anywhere fills it, honours configurable working hours and a minimum duration, accepts natural-language dates, and caps the range at 31 days. Fetches one `events/list` per account rather than per calendar to stay inside Morgen's 100-point / 15-minute budget. All-day entries are excluded from busy time — they label a day rather than occupying it. 28 new tests.
- README: social-links badge strip (X · LinkedIn · YouTube · Instagram, ruvnet-style for-the-badge) inserted into the centered header block beneath the project metadata badges.
- README: documented the optional `MORGEN_SELF_EMAIL` env var (used by `rsvp_event` self-identification) and the Node.js 20+ requirement.

### Changed
- README: banner filename switched from `morgen-mcp.png` to `morgenmcp.png` to match the sibling-repo brand-kit convention (`motionmcp.png`, `taskmaxxing.png`, etc.). The old asset is kept in-tree for now; the README now points at `morgenmcp.png` via the absolute `raw.githubusercontent.com` URL so it still renders on npmjs.com.
- README: added a "back to top" anchor button at section boundaries (dd6a607).
- Git history rewrite: `git filter-repo` collapsed all author/committer identities (dependabot[bot], lorecraft-io, fidgetcoding, nate variants) into a single `Nate Davidovich <nate@lorecraft.io>` identity across `main` and all release tags. All `Co-authored-by:` trailers stripped. Tag commit hashes for v0.1.10 / v0.1.12 / v0.1.13 / v0.1.14 changed; npm tarballs unaffected (already published from old hashes).

### Security
- All npm advisories cleared (was 3 high / 3 moderate / 1 low): `@modelcontextprotocol/sdk` pinned to 1.30.0 plus a transitive-dependency refresh. `npm audit` reports 0.

## [0.1.14] - 2026-04-20

### Changed
- Release cut to retest OIDC trusted-publisher auth with a regenerated `package-lock.json` that includes all platform-specific optional deps (`@rolldown/binding-*`). No source changes — validation of the npm 11+ / OIDC publish chain end-to-end.

### Fixed
- `package-lock.json` regenerated with npm 11+ so the lockfile carries every `@rolldown/binding-*` platform entry needed by vitest 4.x under the OIDC publish environment (5fd1976).

## [0.1.13] - 2026-04-20

### Changed
- Release cut to smoke-test OIDC provenance after bumping the publish workflow's npm version.

### Fixed
- Publish workflow now upgrades npm to `11+` before running `npm publish --provenance`. npm's trusted-publisher OIDC auth requires npm 11.5+, which the default GitHub Actions runner did not ship (1f1b181).

## [0.1.12] - 2026-04-20

### Added
- OIDC publish workflow (`.github/workflows/publish.yml`): GitHub Actions now publishes to npm via `--provenance` using npm's trusted-publisher OIDC flow — no long-lived `NPM_TOKEN` stored in the repo or its secrets (51fd121).

### Changed
- Release cut as the first smoke test of the provenance-signed publish path; package bytes identical to 0.1.11 on the source side.

## [0.1.11] - 2026-04-20

### Changed
- `dotenv` bumped to `17.4.2` — picks up the upstream security + deprecation fixes and aligns the morgen-mcp / motion-mcp / task-maxxing trio on one dotenv major (548f4ba).
- `prepublishOnly` gate wired into `package.json`: `npm publish` now refuses to run if `npm test` fails, closing a shipping-without-tests window that existed in 0.1.10.
- CI action pins rolled to `@v6` across the workflow set (checkout, setup-node, upload-artifact) to stay on supported majors.

### Fixed
- CI: vitest 4.x CI failures under npm-cli#4828 resolved by declaring explicit cross-platform `@rolldown/binding-*` entries as `optionalDependencies` so the Linux + macOS runners install the native binding they actually need (12eed66).

### Changed
- **npm package renamed to `fidgetcoding-morgen-mcp`** (was `morgen-mcp`). Install command updated across docs.
- `src/index.js`: server version now read from `package.json` at startup so the MCP handshake can't drift from the shipped release.
- README v2: Quick Navigation table, banner image, expanded "Why Morgen (and this MCP)" section with Motion → Morgen switch framing, loud "Natural-Language Native" admonition, John Mavrick + Morgen team Acknowledgements, `task-maxxing` "One more thing" end note.
- README banner image link swapped from relative `./morgen-mcp.png` to absolute `raw.githubusercontent.com` URL so the banner renders on npmjs.com as well as GitHub.
- Features table: `series_update_mode` enum corrected to `single` / `future` / `all` (was incorrectly documented as `this` / `following` / `all`). `delete_event` now documents its `series_update_mode` param.
- All example prompts: `drew@example.com` → `person@example.com`.
- Git history: `Co-Authored-By: claude-flow <ruv@ruv.net>` trailer stripped from all commits; `Nathan Davidovich` author fields rewritten to `Nate Davidovich`.

### Removed
- `docs/FEATURE-REQUEST-2026-04-15.md` — was an internal Canny-post draft that inadvertently referenced private Morgen roadmap information; removed from the public repo.

### Added
- `bugs.url` in `package.json`.
- `CHANGELOG.md` (this file, backfilled).

## [0.1.9] - 2026-04-15

### Fixed
- `/v3/tags/list` bare-array response handler (silent tag breakage when Morgen returned an unwrapped array).

## [0.1.8] - 2026-04-15

### Changed
- Rate limit documentation updated: `100 pts / 15-min window` → `300 pts / 15-min window` (Morgen raised the limit 2026-04-15).
- Tag-list deprecation docs updated to reflect upcoming Morgen app behavior (tag-first organization).

## [0.1.7] - 2026-04-14

### Fixed
- Task `due` field now uses JSCalendar floating local datetime via `toFloatingDateTime` in `validation.js`. Fixes HTTP 400 on `create_task` / `update_task` with due dates. 339/339 tests passing.

## [0.1.6] - 2026-04-14

### Added
- Natural-language date parser (`src/nl-date-parser.js`, chrono-node-backed, DST-safe). Every date/time input now accepts plain English — `"tomorrow at 3pm"`, `"next friday"`, `"in 2 hours"`, etc.
- Natural-language recurrence helper (`src/nl-recurrence.js`, JSCalendar RFC 8984). Handles `"daily"`, `"weekly"`, `"every tuesday and thursday"`, `"first monday of every month"`, `"weekdays"`, and more.
- Structured error metadata: `err.reflow` + `err.conversion` attach `applied_steps` / `pending_steps` so callers can recover from mid-loop failures.

### Fixed
- `reflow_day` auto-mode regression.

## [0.1.5] - 2026-04-14

### Added
- `event_to_task` soft-conversion tool (bundles `create_task` + `delete_event`).
- Tags restored: array-of-labels input resolved to Morgen tag UUIDs via `/v3/tags/list` + `/v3/tags/create` (auto-creates missing tags, case-insensitive match).

### Fixed
- `reflow_day` hardening: solo-block filter, `event_ids` cap at 50, partial-failure recovery metadata.

## [0.1.4] - 2026-04-14

### Added
- `reflow_day` tool: compress a day's events back-to-back starting from an anchor time, with `dry_run` default and solo-block auto-detection.

### Fixed
- `create_task` / `update_task` response shape: Morgen's API only echoes the task ID, so the tool now synthesizes a return object from the request body + returned ID for immediate use.
- Tags input temporarily removed (HTTP 400 on string-array shape); restored in 0.1.5.

## [0.1.3] - 2026-04-14

### Changed
- `rsvp_event` rewritten to PATCH the caller's participant entry directly (Morgen has no dedicated RSVP endpoint).
- Smart account routing: `create_event` auto-routes to PARZVL / BLOOM / Lorecraft based on title + description + participant email heuristics.
- Richer event shape: `privacy`, `free_busy_status`, `virtual_room`, `color_id`, `alerts` now supported.

## [0.1.2] - 2026-04-14

### Changed
- Full word-for-word audit cleanup: file splitting to respect 500-line-per-file rule, tighter bounded contexts (`client.js`, `tools-events.js`, `tools-events-schema.js`, `events-shape.js`, `calendar-cache.js`, `tools-tasks.js`, `validation.js`).

## [0.1.1] - 2026-04-13

### Added
- Initial public release as `morgen-mcp`.
- 13 tools: `list_calendars`, `list_events`, `create_event`, `update_event`, `delete_event`, `rsvp_event`, `list_tasks`, `create_task`, `update_task`, `move_task`, `close_task`, `reopen_task`, `delete_task`.
- Point-based rate limiter: 10 pts per list endpoint, 1 pt per write; `/v3/tags/list` lookup costs 10 pts per tagged call + 1 pt per auto-created tag.
- Single-credential auth: one Morgen API key via `Authorization: ApiKey ...` header. No OAuth, no refresh tokens, no Firebase.
