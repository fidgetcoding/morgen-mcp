import { getAccountNames } from "./account-routes.js";
// MCP tool definitions for Morgen event tools. Pulled into a separate file
// to keep tools-events.js under the 500-line project limit.

const SERIES_UPDATE_MODES = ["single", "future", "all"];
const RSVP_RESPONSES = ["accept", "decline", "tentative"];
const EVENT_PRIVACY = ["public", "private", "secret"];
const FREE_BUSY_STATUS = ["free", "busy"];
const VIRTUAL_ROOM_TYPES = ["default", "googleMeet", "microsoftTeams"];
// Logical account names come from the user's MORGEN_ACCOUNT_ROUTES config
// (see src/account-routes.js). Empty when routing is not configured.
const ACCOUNT_NAMES = getAccountNames();

export const EVENT_TOOLS = [
  {
    name: "list_calendars",
    description:
      "List all calendars connected to your Morgen account. Returns calendar IDs, names, colors, account associations, and read-only status.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_events",
    description:
      "List events within a date range across one or more calendars. If calendar_ids is omitted, queries every calendar on every account. Recurrences are expanded server-side.",
    inputSchema: {
      type: "object",
      properties: {
        start: {
          type: "string",
          description:
            "Start of the range — ISO 8601 (2026-04-13T00:00:00Z) or natural language (e.g. 'today', 'monday', 'next week').",
        },
        end: {
          type: "string",
          description:
            "End of the range — ISO 8601 (2026-04-20T00:00:00Z) or natural language (e.g. 'friday', 'next sunday', 'in 7 days').",
        },
        timezone: {
          type: "string",
          description:
            "IANA timezone used when interpreting natural-language dates. Defaults to MORGEN_TIMEZONE or the system setting.",
        },
        calendar_ids: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter to specific calendar IDs. Use list_calendars to discover IDs.",
        },
      },
      required: ["start", "end"],
      additionalProperties: false,
    },
  },
  {
    name: "create_event",
    description:
      "Create a calendar event. If calendar_id is omitted, smart routing picks an account from your MORGEN_ACCOUNT_ROUTES config by matching participant email domains and title/description keywords, falling back to your default route and then to the default writable calendar. Pass `account` to override the inference explicitly.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: {
          type: "string",
          description:
            "Specific calendar ID to target. When provided, overrides smart routing and the `account` override. Use list_calendars to discover IDs.",
        },
        account: {
          type: "string",
          // Only constrain the enum when the user has configured routes;
          // an empty enum would reject every value.
          ...(ACCOUNT_NAMES.length > 0 ? { enum: ACCOUNT_NAMES } : {}),
          description:
            ACCOUNT_NAMES.length > 0
              ? `Force the event onto a specific connected account (overrides smart routing). One of: ${ACCOUNT_NAMES.join(", ")}.`
              : "Force the event onto a specific connected account (overrides smart routing). Configure MORGEN_ACCOUNT_ROUTES to enable account names.",
        },
        title: { type: "string", description: "Event title" },
        start: {
          type: "string",
          description:
            "Start time — ISO 8601 (2026-04-15T14:00:00-04:00) or natural language (e.g. 'tomorrow at 3pm', 'next friday 10am', 'in 2 hours'). Interpreted in the caller's timezone unless overridden.",
        },
        end: {
          type: "string",
          description:
            "End time — ISO 8601 or natural language. Used to compute duration; the Morgen API itself stores duration, not end time.",
        },
        timezone: {
          type: "string",
          description:
            "IANA timezone for the event (e.g. 'America/New_York'). Defaults to MORGEN_TIMEZONE env var or the system's detected timezone.",
        },
        description: { type: "string", description: "Event description" },
        location: { type: "string", description: "Event location (wrapped into Morgen's keyed Location map automatically)" },
        participants: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of participant email addresses. Each is sent as an attendee; Morgen assigns roles and participation status server-side.",
        },
        recurrence_rules: {
          oneOf: [
            {
              type: "string",
              description:
                "Natural-language recurrence (e.g. 'every monday', 'weekly', 'biweekly', 'weekdays', 'first friday of every month').",
            },
            {
              type: "array",
              description:
                "Morgen RecurrenceRule objects. Example: [{\"@type\":\"RecurrenceRule\",\"frequency\":\"weekly\",\"interval\":1,\"byDay\":[{\"@type\":\"NDay\",\"day\":\"mo\"}]}].",
              items: { type: "object" },
            },
          ],
          description:
            "Recurrence pattern. Accepts a natural-language string like 'every tuesday and thursday' or an array of Morgen RecurrenceRule objects.",
        },
        privacy: {
          type: "string",
          enum: EVENT_PRIVACY,
          description: "Event privacy level: 'public', 'private', or 'secret'.",
        },
        free_busy_status: {
          type: "string",
          enum: FREE_BUSY_STATUS,
          description: "How the event affects your free/busy state: 'free' or 'busy'. Defaults to 'busy' on Morgen's side.",
        },
        virtual_room: {
          type: "string",
          enum: VIRTUAL_ROOM_TYPES,
          description:
            "Request a virtual meeting room: 'default' (no room), 'googleMeet' (auto-create Google Meet), or 'microsoftTeams' (auto-create Teams). Note: virtual rooms cannot be removed once attached.",
        },
        color_id: {
          type: "string",
          description: "Google Calendar color ID (1-11) — only applies to events on Google-integration calendars.",
        },
        alerts: {
          type: "object",
          description:
            "Optional Morgen alerts map. Advanced: pass the exact shape Morgen's API expects (keyed by alert ID with {@type, trigger, action} objects).",
        },
      },
      required: ["title", "start", "end"],
      additionalProperties: false,
    },
  },
  {
    name: "update_event",
    description:
      "Update an existing event. For recurring events, use series_update_mode to control whether a single occurrence, future occurrences, or the entire series is updated.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "The event ID to update" },
        calendar_id: {
          type: "string",
          description: "The calendar ID the event belongs to",
        },
        title: { type: "string", description: "New event title" },
        start: {
          type: "string",
          description:
            "New start time — ISO 8601 or natural language (e.g. 'tomorrow at 3pm').",
        },
        end: {
          type: "string",
          description:
            "New end time — ISO 8601 or natural language. Used to recompute duration.",
        },
        timezone: {
          type: "string",
          description: "IANA timezone. Defaults to MORGEN_TIMEZONE env var or the system timezone.",
        },
        description: { type: "string", description: "New description" },
        location: { type: "string", description: "New location" },
        participants: {
          type: "array",
          items: { type: "string" },
          description: "Replacement participant email list",
        },
        recurrence_rules: {
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "object" } },
          ],
          description:
            "Replacement recurrence pattern. Accepts a natural-language string ('every monday', 'biweekly', 'weekdays') or an array of Morgen RecurrenceRule objects.",
        },
        series_update_mode: {
          type: "string",
          enum: SERIES_UPDATE_MODES,
          description:
            "For recurring events: 'single' (this occurrence, default), 'future' (this and future), or 'all' (entire series). Sent as a query parameter.",
        },
        privacy: {
          type: "string",
          enum: EVENT_PRIVACY,
          description: "Event privacy: 'public', 'private', or 'secret'.",
        },
        free_busy_status: {
          type: "string",
          enum: FREE_BUSY_STATUS,
          description: "Free/busy state: 'free' or 'busy'.",
        },
        virtual_room: {
          type: "string",
          enum: VIRTUAL_ROOM_TYPES,
          description: "Request a virtual meeting room: 'default', 'googleMeet', or 'microsoftTeams'. Rooms cannot be removed once attached.",
        },
        color_id: {
          type: "string",
          description: "Google Calendar color ID (1-11).",
        },
        alerts: {
          type: "object",
          description: "Advanced: Morgen alerts map (keyed by alert ID).",
        },
      },
      required: ["event_id", "calendar_id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_event",
    description:
      "Delete an event by ID. For recurring events, use series_update_mode to control scope.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "The event ID to delete" },
        calendar_id: {
          type: "string",
          description: "The calendar ID the event belongs to",
        },
        series_update_mode: {
          type: "string",
          enum: SERIES_UPDATE_MODES,
          description:
            "For recurring events: 'single' (default), 'future', or 'all'. Sent as a query parameter.",
        },
      },
      required: ["event_id", "calendar_id"],
      additionalProperties: false,
    },
  },
  {
    name: "rsvp_event",
    description:
      "Respond to an event invitation (accept, decline, or tentative). Implemented as a PATCH to /v3/events/update that updates your own participant entry's participationStatus — Morgen has no dedicated RSVP endpoint. Your own email is resolved from MORGEN_SELF_EMAIL env var, or derived from the target calendar's name (most of Nate's Google calendars are named after the email). Override with the self_email argument if neither works.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "The event ID to respond to" },
        calendar_id: {
          type: "string",
          description: "The calendar ID the event belongs to",
        },
        response: {
          type: "string",
          enum: RSVP_RESPONSES,
          description: "RSVP response: 'accept', 'decline', or 'tentative' (maps to Morgen's 'accepted', 'declined', 'tentative').",
        },
        self_email: {
          type: "string",
          description: "Optional override for the email keying the participant map. Only needed if MORGEN_SELF_EMAIL isn't set and the calendar name isn't an email.",
        },
      },
      required: ["event_id", "calendar_id", "response"],
      additionalProperties: false,
    },
  },
];

export {
  SERIES_UPDATE_MODES,
  RSVP_RESPONSES,
  EVENT_PRIVACY,
  FREE_BUSY_STATUS,
  VIRTUAL_ROOM_TYPES,
  ACCOUNT_NAMES,
};
