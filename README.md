<a id="top"></a>

<div align="center">

# Morgen MCP

![Morgen MCP](https://raw.githubusercontent.com/fidgetcoding/morgen-mcp/main/morgenmcp.png)

**Natural-language calendar and task control for Morgen in Claude Code.**

[![npm version](https://img.shields.io/npm/v/fidgetcoding-morgen-mcp)](https://www.npmjs.com/package/fidgetcoding-morgen-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-green)](https://modelcontextprotocol.io)

[![Follow on X](https://img.shields.io/badge/FOLLOW%20%40fidgetcoding-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/fidgetcoding) [![LinkedIn](https://img.shields.io/badge/LINKEDIN-CONNECT-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white&labelColor=555555)](https://www.linkedin.com/in/nate-davidovich/) [![YouTube](https://img.shields.io/badge/YOUTUBE-SUBSCRIBE-FF0000?style=for-the-badge&logo=youtube&logoColor=white&labelColor=555555)](https://youtube.com/@fidgetcoding) [![Instagram](https://img.shields.io/badge/INSTAGRAM-FOLLOW-E4405F?style=for-the-badge&logo=instagram&logoColor=white&labelColor=555555)](https://instagram.com/fidgetcoding)

</div>

---

## Quick Navigation

| Link | Section | What it does | Time |
|---|---|---|---|
| [Why Morgen (and this MCP)](#why-morgen-and-this-mcp) | Overview | Why I moved from Motion to Morgen + why this MCP exists | ~2 min |
| [Natural-Language Native](#natural-language-native-no-commands-needed) | Talk to it | Plain-English dates, recurrence, tasks — no commands | ~1 min |
| [How It Works](#how-it-works) | Overview | How Claude dispatches Morgen tools under the hood | ~1 min |
| [Why This Exists](#why-this-exists) | Context | The gap this MCP fills | ~2 min |
| [Features](#features) | Reference | All tools exposed — calendar + task | ~2 min |
| [Important Note About Tasks](#important-note-about-tasks) | Reference | Morgen task scheduling caveats | ~1 min |
| [Quick Install](#quick-install) | Setup | One-liner to wire the MCP into Claude | ~1 min |
| [Setup](#setup) | Setup | Getting a Morgen API key | ~2 min |
| [Configuration Reference](#configuration-reference) | Setup | Env vars + options | ~3 min |
| [Usage Examples](#usage-examples) | Reference | Natural-language flows | ~2 min |
| [Rate Limits](#rate-limits) | Reference | 300pt/15min budget + tool costs | ~1 min |
| [Security](#security) | Reference | Secret handling + disclosure | ~1 min |
| [Troubleshooting](#troubleshooting) | Reference | Auth errors, rate limits, tag resolver, stale keys | ~2 min |
| [Development](#development) | Reference | Contributing + tests | ~2 min |
| [Under the Hood](#under-the-hood) | Reference | JSCalendar, NL date parsing, architecture | ~2 min |
| [Acknowledgements](#acknowledgements) | Meta | Credits | — |
| [One more thing](#one-more-thing) | Meta | `task-maxxing` — DIY two-way task sync (Obsidian ↔ Morgen, Notion dropped 2026-05-04) | ~1 min |
| [Project Status](#project-status) | Meta | Actively maintained — this is the live MCP | ~1 min |
| [License](#license) | Meta | MIT | — |

---

## Why Morgen (and this MCP)

[Morgen](https://morgen.so) is an auto-scheduling calendar and task app that unifies Google, Outlook, iCloud, and native tasks into a single pane. You can sign up at [morgen.so](https://morgen.so) — the free tier covers everything this MCP needs.

I (Nate) was on Motion before I switched. Three reasons the move stuck:

- **Cheaper.** I run Morgen entirely on the free tier. Motion's paid plan was the floor.
- **Better product.** Morgen unifies calendars and tasks in one auto-scheduling surface, and the UI is cleaner. The auto-scheduler is genuinely opinionated in the right places.
- **Better API.** The Morgen public API is well-designed enough to actually wrap — one API key, no browser-storage refresh tokens, no Firebase. That's why this MCP exists and feels thin.

If you're on Motion, I also keep [motion-mcp](https://github.com/fidgetcoding/motion-mcp) up — low-maintenance but still functional. But the honest pitch: try Morgen.

<p align="right"><a href="#top">↑ back to top</a></p>

## Natural-Language Native (no commands needed)

> [!IMPORTANT]
> **🗣️ You talk. Claude dispatches. No commands, no syntax, no JSON.**
>
> Every date, time, and recurrence field in this MCP accepts plain English. You don't memorize tools, you don't build ISO strings, you don't hand-author recurrence objects. You just say what you want.
>
> - "Move my 3pm to 4pm tomorrow."
> - "Create a 30-minute call with person@example.com every tuesday at 2pm."
> - "Add a task called 'Review contracts' due friday at 5pm, high priority."
> - "Reflow the rest of today's focus blocks starting at 1pm — dry run first."
>
> Claude picks the right tool, fills in the parameters, and hands the result back in conversation. ISO 8601 still works for programmatic callers who want it — strict shapes pass through untouched.

<p align="right"><a href="#top">↑ back to top</a></p>

## How It Works

Once installed, you just talk to Claude. No commands to memorize, no special syntax, no API calls to learn. You speak in plain English and Claude handles the rest.

```
You:    "What's on my calendar this week?"
You:    "Add a task called 'Review contracts' due Friday, high priority"
You:    "Move my 3pm to 4pm tomorrow"
You:    "Mark the laundry task as done"
You:    "Decline the 5pm invite"
You:    "Create a 30-minute call with person@example.com Thursday at 2pm"
```

That's it. Claude sees your Morgen calendars and tasks, understands your schedule, and takes action — all through natural conversation. No buttons, no UI, no context switching. You stay in your terminal and your day stays in sync.

<p align="right"><a href="#top">↑ back to top</a></p>

## Why This Exists

Morgen is one of the cleanest calendar-plus-task apps on the market. It unifies Google, Outlook, iCloud, and native Morgen tasks into a single auto-scheduling interface, and it ships a genuinely well-designed public API.

This MCP wraps that API and hands the whole surface to Claude Code — events, tasks, RSVPs, calendars, the lot. One API key, one install command, and you are talking to your calendar in natural language.

A few things make Morgen's API worth wrapping:

- **Single credential.** Just one API key from [platform.morgen.so/developers-api](https://platform.morgen.so/developers-api). No OAuth dance, no refresh-token rotation, no Firebase session pulling, no IndexedDB scraping.
- **Stable public surface.** Morgen documents its API at [docs.morgen.so](https://docs.morgen.so) — endpoints, rate limits, data shapes, recurrence rules, the JSCalendar nuances. Writing this wrapper involved reading docs, not reverse-engineering a web app.
- **Unified model.** One set of endpoints for calendars, events, and tasks — not three disconnected providers glued together.
- **Claude + Morgen + natural language.** Morgen's auto-scheduler is opinionated. Claude Code is a natural-language interpreter. Put them together and you get "reflow the rest of today starting at 1pm, dry run first" in terminal English, instead of a GUI drag-drop session.

The MCP stays a thin layer: one `fetch` per Morgen endpoint, local rate-limit bookkeeping, input validation, and a natural-language front-end for dates and recurrence. No SDK middleware, no opinionated scheduling logic of our own.

<p align="right"><a href="#top">↑ back to top</a></p>

## Features

### Event Tools

| Tool | Description |
|---|---|
| `list_calendars` | List all Morgen calendars with id, name, color, account, sort order, and read-only status |
| `list_events` | Fetch events in a date range across one or more calendars with full details |
| `create_event` | Create an event with title, time, participants, description, location, and recurrence |
| `update_event` | Update an event; supports `series_update_mode` (`single`, `future`, `all`) for editing recurring events |
| `delete_event` | Delete an event by ID; supports `series_update_mode` (`single`, `future`, `all`) for recurring scope |
| `rsvp_event` | Accept, decline, or tentatively respond to an invitation |

### Task Tools

| Tool | Description |
|---|---|
| `list_tasks` | List native Morgen tasks |
| `create_task` | Create a new task with title, description, due date, priority (integer 0-9; 1 = highest, 9 = lowest, 0 = undefined), and tag labels |
| `update_task` | Update an existing task — change title, description, due date, priority, or tag labels |
| `move_task` | Move a task to a different Morgen task list |
| `close_task` | Mark a task as completed |
| `reopen_task` | Reopen a completed task |
| `delete_task` | Delete a task permanently |

> **Note on `tags`:** Pass tags as an array of human-readable **label strings** (e.g. `["urgent","admin"]`). The MCP resolves each label to a Morgen tag UUID via `/v3/tags/list` + `/v3/tags/create` and auto-creates any tag that doesn't already exist. Match is case-insensitive. This costs an extra 10 rate-limit points per tagged call (for the `tags/list` lookup) plus 1 point per newly-created tag.

> **Note on create/update responses:** Morgen's `/v3/tasks/create` and `/v3/tasks/update` responses only echo the task ID — not the full object. `create_task` and `update_task` synthesize a return shape from the request body + returned ID for immediate use. For server-authoritative state (after Morgen applies defaults), call `list_tasks` afterwards.

> **Note on task scheduling:** Morgen's public API does NOT expose the task-to-calendar linkage (the `morgen.so:metadata.taskId` field on events is read-only). A task created via `create_task` lands in the Morgen inbox WITHOUT a calendar slot. To get the checkbox-on-calendar render that Morgen's web app produces when you drag a task to a time slot, drag it manually in the Morgen UI once — there is no public endpoint for this today.

### Reflow Tools

| Tool | Description |
|---|---|
| `reflow_day` | Compress a day's events back-to-back starting from an anchor time. Defaults to `dry_run: true`. Auto-filters to solo blocks (no external participants) so real meetings never move. Pass `event_ids` to reflow an explicit set, or let the tool auto-detect solo blocks on the target calendar. Capped at 50 `event_ids` per call for rate-limit safety. On partial failure (mid-loop `update_event` errors), throws a structured error with `applied_steps` + `pending_steps` so you can recover manually. |

### Conversion Tools

| Tool | Description |
|---|---|
| `event_to_task` | Soft-convert a calendar event into a Morgen task. Bundles `create_task` + `delete_event` into one call. The resulting task lands in your Morgen inbox — Morgen's public API does not expose the task-to-calendar linkage, so you'll need to drag the task to a calendar slot manually in the Morgen web app to get the checkbox render. Pass `delete_original: false` to keep the source event. |

### Natural-language support (v0.1.6+)

Every tool that takes a date, time, or recurrence pattern accepts natural language in addition to strict ISO / Morgen shapes. You never have to hand-build an ISO 8601 string or a `RecurrenceRule` object unless you want to.

**Date and time inputs** — `create_event.start`, `create_event.end`, `update_event.start`, `update_event.end`, `list_events.start`, `list_events.end`, `create_task.due`, `update_task.due`, `event_to_task.due`, `reflow_day.date`, and `reflow_day.anchor_time` all accept casual phrases:

```
"tomorrow at 3pm"
"next friday 10am"
"in 2 hours"
"friday at 5pm"
"today"
"next monday"
"1pm"
"3:30pm"
```

ISO 8601 still works unchanged — if the string already matches `YYYY-MM-DDTHH:MM` (or `YYYY-MM-DD` for date-only fields, or `HH:MM` for time-only fields), it's passed through untouched. Natural-language parsing respects the caller's timezone, so "tomorrow at 9am" resolves to a different UTC instant in `America/New_York` vs `Europe/London`.

**Recurrence** — `create_event.recurrence_rules` and `update_event.recurrence_rules` accept a plain string *or* the original array of Morgen `RecurrenceRule` objects:

```
"daily" / "every day"
"weekly" / "every week"
"monthly" / "yearly" / "annually"
"every 2 weeks" / "biweekly" / "every other week"
"every monday"
"every tuesday and thursday"
"weekdays" / "weekends"
"first monday of every month"
"last friday of every month"
"every 6 months"
```

Example — a weekly 1:1 that Claude can now wire up from a sentence:

> "Create a 30-minute call with person@example.com every tuesday at 2pm"

The old hand-built `recurrence_rules: [{ "@type": "RecurrenceRule", frequency: "weekly", ... }]` shape is still accepted unchanged, so existing scripted callers don't need to migrate.

**Reflow example:** *"I just finished the Mama call early. Reflow the rest of today's focus blocks starting at 1:00 PM, dry run first."*

```
reflow_day {
  anchor_time: "13:00",
  dry_run: true
}
```

Returns a plan showing each event's old start → new start. Re-run with `dry_run: false` to commit.

<p align="right"><a href="#top">↑ back to top</a></p>

## Important Note About Tasks

Morgen's `/tasks` endpoints only manage **native Morgen tasks** — the ones created directly inside Morgen with `integrationId: "morgen"`. Tasks that Morgen syncs in from external providers like Todoist, Google Tasks, Microsoft To Do, or Things are fully visible in the Morgen app but are **not writable through this MCP**. The Morgen API intentionally scopes write access to its own native task system.

The practical takeaway: if you want Claude to create, update, and close tasks programmatically, create them as native Morgen tasks. Everything else stays read-only from Morgen's side and should be managed through that provider's own integration.

<p align="right"><a href="#top">↑ back to top</a></p>

## Quick Install

One command. That is it.

```bash
claude mcp add morgen --env MORGEN_API_KEY=your_key_here -- npx -y fidgetcoding-morgen-mcp
```

Then restart Claude Code and start talking to your calendar.

<p align="right"><a href="#top">↑ back to top</a></p>

## Setup

Morgen authentication is simple: one API key. No browser scraping, no refresh tokens, no Firebase.

### Step 1: Get your Morgen API key

1. Go to [platform.morgen.so/developers-api](https://platform.morgen.so/developers-api)
2. Sign in with your Morgen account
3. Generate an API key and copy it

### Step 2: Configure

You have three options:

**Option A — Run the setup command:**

```bash
npx fidgetcoding-morgen-mcp setup
```

It will prompt you for your API key and timezone, then write a `.env` file for you.

**Option B — Create `.env` manually:**

```bash
MORGEN_API_KEY=your_morgen_api_key_here
MORGEN_TIMEZONE=America/New_York
```

**Option C — Pass them as environment variables in your Claude MCP config:**

```json
{
  "mcpServers": {
    "morgen": {
      "command": "npx",
      "args": ["-y", "fidgetcoding-morgen-mcp"],
      "env": {
        "MORGEN_API_KEY": "your_morgen_api_key_here",
        "MORGEN_TIMEZONE": "America/New_York"
      }
    }
  }
}
```

### Step 3: Restart Claude Code

That is the whole setup. No token refresh cycles, no IndexedDB spelunking.

<p align="right"><a href="#top">↑ back to top</a></p>

## Configuration Reference

| Variable | Required | Description |
|---|---|---|
| `MORGEN_API_KEY` | Yes | Your Morgen API key from [platform.morgen.so/developers-api](https://platform.morgen.so/developers-api) |
| `MORGEN_TIMEZONE` | No | IANA timezone for calendar operations (default: `America/New_York`). Used for formatting event times and task due dates. |

<p align="right"><a href="#top">↑ back to top</a></p>

## Usage Examples

Once installed and configured, just talk to Claude naturally:

**Check your schedule**
> "What's on my calendar this week?"

**List calendars**
> "Which Morgen calendars do I have connected?"

**Create events**
> "Create a meeting called 'Team Sync' tomorrow at 2pm for 30 minutes"
> "Schedule a call with person@example.com at 5:30pm today"

**Modify events**
> "Move my 3pm to 4pm"
> "Change the Team Sync description to include the agenda link"

**Handle invitations**
> "Decline the 5pm meeting"
> "Tentatively accept the all-hands on Thursday"

**Delete events**
> "Cancel the standup on Friday"

**Manage tasks**
> "Add a task called 'Review contracts' due Friday, high priority"
> "What tasks do I have open?"
> "Mark the laundry task as done"
> "Reopen the invoice follow-up task"
> "Move the recording task to my Deep Work list"

<p align="right"><a href="#top">↑ back to top</a></p>

## Rate Limits

Morgen uses a rolling point-based rate limit: **300 points per 15-minute window** per API key.

- List endpoints (`list_events`, `list_tasks`, `list_calendars`, `tags/list`) cost **10 points** per call
- Writes (create, update, delete, close, reopen, rsvp, move, `tags/create`) cost **1 point** per call

In practice this is very generous for interactive use — you can fire off hundreds of writes in a session without getting near the ceiling. Just avoid tight polling loops on the list endpoints.

Full details: [docs.morgen.so/rate-limits](https://docs.morgen.so/rate-limits)

<p align="right"><a href="#top">↑ back to top</a></p>

## Security

Your Morgen API key grants full access to your Morgen account — all calendars, all events, all tasks. Treat it like a password:

- Do not commit your `.env` file to version control. The included `.gitignore` excludes it, but verify.
- Do not paste your key into shared chats, issues, or screenshots.
- Rotate the key from the developer portal if you suspect it has leaked.

<p align="right"><a href="#top">↑ back to top</a></p>

## Troubleshooting

**"Authentication failed" or `401 Unauthorized`.**
Your `MORGEN_API_KEY` is missing, mistyped, or has been rotated out. Pull a fresh key from the Morgen developer portal (Settings → API) and re-export it into your environment — watch for stray whitespace on copy-paste. Restart Claude Code after updating `.env`.

**Rate-limit errors (`429` or "point budget exceeded").**
Morgen enforces 300 points per rolling 15-minute window. List calls cost 10 pts each, writes cost 1 pt. Tight polling loops on `list_events` / `list_tasks` are the usual culprit — the `calendar-cache.js` layer already amortizes the hot path, but if you're hitting the ceiling, back off for a minute and the window resets.

**Tags silently dropped on `create_task` / `update_task`.**
Morgen's tag API takes UUIDs, not labels. The built-in resolver in `tags.js` auto-creates any missing label, but if you hit this it's usually because the label string didn't reach the tool — double-check the request body and confirm Claude passed `tags: ["label1", "label2"]` as an array of strings, not a comma-joined single string.

**"Invalid API key" immediately after a successful call.**
Morgen keys don't expire on a fixed clock, but they do invalidate if the key is revoked in the portal or if the account is downgraded. Regenerate the key, update `.env`, and restart the MCP server. If you're seeing this mid-session with no portal changes, open an issue — it's worth surfacing.

<p align="right"><a href="#top">↑ back to top</a></p>

## Development

```bash
# Clone the repo
git clone https://github.com/fidgetcoding/morgen-mcp.git
cd morgen-mcp

# Install dependencies
npm install

# Configure credentials
cp .env.example .env
# Edit .env with your API key

# Run directly
npm start
```

<p align="right"><a href="#top">↑ back to top</a></p>

## Under the Hood

The server runs as a stdio-based MCP server using the official `@modelcontextprotocol/sdk`. All Morgen operations go through raw `fetch` calls against the public API at `https://api.morgen.so/v3`, authenticated with your API key via the `Authorization: ApiKey ...` header.

No SDK middleware, no token juggling, no refresh cycles. Just a thin, predictable wrapper around endpoints that Morgen already documents.

<p align="right"><a href="#top">↑ back to top</a></p>

## Acknowledgements

Big thanks to **John Mavrick** and the team at [Morgen](https://morgen.so). Building a third-party MCP on top of someone else's product is a gamble — you're betting the vendor is okay with a community-built wrapper, responsive when the docs are ambiguous, and willing to treat small external builders as partners rather than noise.

Morgen has cleared that bar from day one. The public API is documented like they actually want people to build on it, questions get answered thoughtfully, and the team has been genuinely supportive of this MCP existing. Ecosystem-friendly vendor behavior is rarer than it should be — when you see it, it's worth naming.

<p align="right"><a href="#top">↑ back to top</a></p>

## One more thing

If morgen-mcp tames your calendar, the next thing you probably want to tame is your tasks. I built [**task-maxxing**](https://github.com/fidgetcoding/task-maxxing) for exactly that — a public, DIY, two-way sync between Obsidian Tasks and Morgen, orchestrated via n8n (Notion was dropped 2026-05-04). One source of truth for every task-shaped thought. Create it in Obsidian, complete it in Morgen, both stay in sync.

It genuinely helped my ADHD. Having a single reliable home for every loose end — and knowing nothing falls through the cracks between three apps — was a real quality-of-life unlock. If that pattern might help yours too, the repo is open-source and the setup is documented step by step.

→ [github.com/fidgetcoding/task-maxxing](https://github.com/fidgetcoding/task-maxxing)

<p align="right"><a href="#top">↑ back to top</a></p>

## Project Status

> **Actively maintained.** This is the MCP I use every day and the one I'm building on. If Morgen's API surface grows, this repo grows with it. Bug reports get real attention, features get shipped, and the roadmap tracks what Morgen themselves are working on.

The counterpart repo is **[motion-mcp](https://github.com/fidgetcoding/motion-mcp)** — same philosophy, different calendar. It's in low-maintenance mode now that I've moved to Morgen, but it still works for anyone who's on Motion and wants agentic calendar access. If you're evaluating both, this repo is the one getting active care.

<p align="right"><a href="#top">↑ back to top</a></p>

## License

MIT — see [LICENSE](LICENSE) for details.

<p align="right"><a href="#top">↑ back to top</a></p>

---

Built by [Nate Davidovich / Lorecraft](https://github.com/fidgetcoding)

[⤴ back to top](#top)

## Security: gitleaks pre-commit hook

This repo ships with a `.gitleaks.toml` config and a one-liner installer for a local
pre-commit hook that scans staged content for secrets (GitHub tokens, API keys, JWTs,
etc.) before every commit.

```bash
bash scripts/install-pre-commit-hook.sh
```

The hook runs `gitleaks protect --staged` and blocks commits that contain secrets.
For emergencies you can bypass with `git commit --no-verify` — but DO NOT bypass for
real secrets. Use env vars or a secret manager instead.

If gitleaks isn't installed yet:
- macOS: `brew install gitleaks`
- Linux: https://github.com/gitleaks/gitleaks/releases
