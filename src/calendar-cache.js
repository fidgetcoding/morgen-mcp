import {
  getAccountRoutes,
  getDefaultRouteName,
  findRouteByName,
} from "./account-routes.js";
// Cached calendar directory. Every write endpoint in Morgen's API requires
// both `calendarId` AND `accountId`, so we need to look up the accountId for
// a given calendarId. Hitting /v3/calendars/list costs 10 rate points, so we
// cache the whole result for 10 minutes.
import { morgenFetch } from "./client.js";
import { unwrapCalendars } from "./events-shape.js";

const TTL_MS = 10 * 60 * 1000;

let cache = null;
let expiresAt = 0;
let loadingPromise = null;

async function loadCache() {
  const raw = await morgenFetch("/v3/calendars/list", { points: 10 });
  const list = unwrapCalendars(raw);
  const byId = new Map();
  const byAccount = new Map();
  for (const c of list) {
    if (!c || !c.id) continue;
    const rights = c.myRights || {};
    const readOnly =
      rights.mayWriteAll === false && rights.mayReadItems === true;
    const entry = {
      id: c.id,
      name: c.name,
      accountId: c.accountId,
      integrationId: c.integrationId,
      color: c.color,
      readOnly,
    };
    byId.set(c.id, entry);
    if (entry.accountId) {
      if (!byAccount.has(entry.accountId)) byAccount.set(entry.accountId, []);
      byAccount.get(entry.accountId).push(entry);
    }
  }
  // Default writable calendar = first non-read-only entry in docs order.
  const defaultEntry =
    list.find((c) => c?.id && !(c.myRights?.mayWriteAll === false)) || list[0];
  const defaultId = defaultEntry?.id || null;
  cache = { list, byId, byAccount, defaultId };
  expiresAt = Date.now() + TTL_MS;
  return cache;
}

export async function getCalendarCache() {
  if (cache && expiresAt > Date.now()) return cache;
  if (loadingPromise) return loadingPromise;
  loadingPromise = loadCache().finally(() => {
    loadingPromise = null;
  });
  return loadingPromise;
}

export async function resolveCalendarMeta(calendarId) {
  const c = await getCalendarCache();
  const entry = c.byId.get(calendarId);
  if (!entry) {
    throw new Error(
      `calendar_id is not a known calendar on this account — run list_calendars to discover valid IDs`
    );
  }
  return entry;
}

export async function resolveDefaultCalendarMeta() {
  const c = await getCalendarCache();
  if (!c.defaultId) {
    throw new Error(
      "No calendars available on this account. Connect a calendar in Morgen first."
    );
  }
  return c.byId.get(c.defaultId);
}

export async function groupCalendarIdsByAccount(calendarIds) {
  const c = await getCalendarCache();
  const byAccount = new Map();
  for (const id of calendarIds) {
    const entry = c.byId.get(id);
    if (!entry) {
      throw new Error(
        `calendar_id ${id} is not a known calendar — run list_calendars to discover valid IDs`
      );
    }
    if (!byAccount.has(entry.accountId)) byAccount.set(entry.accountId, []);
    byAccount.get(entry.accountId).push(id);
  }
  return byAccount;
}

export async function getAllAccountsWithCalendars() {
  const c = await getCalendarCache();
  return c.byAccount;
}

export function _resetCalendarCache() {
  cache = null;
  expiresAt = 0;
  loadingPromise = null;
}

// Smart account routing: infer which connected account a new event should live
// on, from title, description, and participant emails. Returns a logical account
// name that callers resolve to a real calendar via resolveCalendarByAccountName,
// or null when the user has configured no routes.
//
// The rules come entirely from MORGEN_ACCOUNT_ROUTES — see src/account-routes.js.
// Routes are tested in configured order and the first match wins; within a route,
// participant emails are checked before free-text cues because they are the more
// reliable signal. With no routes configured this returns null and the caller
// falls back to the default writable calendar.
export function inferAccountFromContext({ title = "", description = "", participants = [] }) {
  const routes = getAccountRoutes();
  if (routes.length === 0) return null;

  const text = `${title || ""} ${description || ""}`.toLowerCase();
  const emails = (participants || []).map((p) => String(p || "").toLowerCase());

  for (const route of routes) {
    if (route.isDefault) continue; // considered last, below
    const emailHit = route.emailDomains.some((d) => emails.some((e) => e.endsWith(d)));
    const keywordHit = route.keywords.some((k) => text.includes(k));
    if (emailHit || keywordHit) return route.name;
  }
  return getDefaultRouteName();
}

// Map a logical account name to the calendar metadata entry Morgen uses. The
// name-to-calendar patterns come from the user's MORGEN_ACCOUNT_ROUTES config.
// Falls back to the cache's defaultId when the account can't be matched, which
// is the right behaviour for a single-account setup.
export async function resolveCalendarByAccountName(name) {
  const c = await getCalendarCache();
  const route = name ? findRouteByName(name) : null;
  const pattern = route?.calendarPattern || null;
  if (pattern) {
    for (const entry of c.list) {
      const calName = entry?.name || "";
      if (pattern.test(calName) && entry?.myRights?.mayWriteAll !== false) {
        return c.byId.get(entry.id);
      }
    }
  }
  // Fall back to the default writable calendar
  if (c.defaultId) return c.byId.get(c.defaultId);
  throw new Error(
    `No calendar found for account name "${name}" and no default calendar is available`
  );
}

// Resolve the caller's own email address, used when keying RSVP patches into
// the Morgen participants map. Order of resolution:
//   1. MORGEN_SELF_EMAIL env var (explicit override, always wins)
//   2. The calendar meta's name if it looks like an email (Google calendars
//      are commonly named after the account email)
//   3. Throw with a clear hint to set the env var
export function resolveSelfEmail(calendarMeta) {
  const envEmail = process.env.MORGEN_SELF_EMAIL;
  if (envEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(envEmail)) {
    return envEmail;
  }
  const name = calendarMeta?.name || "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) {
    return name;
  }
  throw new Error(
    `Could not determine your own email address for RSVP patching. Set the MORGEN_SELF_EMAIL environment variable (e.g. you@example.com) in your MCP config.`
  );
}

// Test helper: preload the cache with fake entries so handlers can look up
// calendar metadata without hitting a real API. Entries should be
// { id, accountId, name?, readOnly?, integrationId?, color? } objects.
export function _seedCalendarCache(entries) {
  loadingPromise = null;
  const byId = new Map();
  const byAccount = new Map();
  for (const e of entries) {
    const entry = {
      id: e.id,
      name: e.name || e.id,
      accountId: e.accountId,
      integrationId: e.integrationId || "google",
      color: e.color || "#000000",
      readOnly: e.readOnly === true,
    };
    byId.set(entry.id, entry);
    if (!byAccount.has(entry.accountId)) byAccount.set(entry.accountId, []);
    byAccount.get(entry.accountId).push(entry);
  }
  const defaultEntry = entries.find((e) => !e.readOnly) || entries[0];
  cache = {
    list: entries,
    byId,
    byAccount,
    defaultId: defaultEntry ? defaultEntry.id : null,
  };
  expiresAt = Date.now() + 10 * 60 * 1000;
}
