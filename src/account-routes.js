// Account routing configuration.
//
// Smart routing decides which connected Morgen account a new event belongs on.
// The rules are USER-SUPPLIED — this server ships no accounts of its own, and
// hardcoding any would both leak the author's client list and be useless to
// everyone else.
//
// Configure with the MORGEN_ACCOUNT_ROUTES env var, a JSON array:
//
//   [
//     {
//       "name": "work",
//       "emailDomains": ["@acme.com"],
//       "keywords": ["acme", "widget project"],
//       "calendarPattern": "acme|me@acme\\.com"
//     },
//     {
//       "name": "personal",
//       "default": true,
//       "calendarPattern": "me@example\\.com"
//     }
//   ]
//
//   name            logical account name; what `account:` accepts on create_event
//   emailDomains    participant email suffixes that select this route
//   keywords        case-insensitive substrings of title+description
//   calendarPattern regex matched against calendar names to find the calendar
//   default         true on at most one route; used when nothing else matches
//
// Order matters: routes are tested top-down and the first match wins. Leave the
// variable unset and smart routing simply switches off — create_event then uses
// the default writable calendar, which is the correct behaviour for a
// single-account setup.

let cachedRoutes = null;
let warned = false;

function warnOnce(message) {
  if (warned) return;
  warned = true;
  console.error(`[morgen-mcp] MORGEN_ACCOUNT_ROUTES: ${message} — smart routing disabled.`);
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

// Parse + validate the env var. Any malformed entry disables routing entirely
// rather than half-applying it: a partially-understood routing table would send
// events to the wrong calendar, which is worse than not routing at all.
function parseRoutes(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warnOnce(`not valid JSON (${err.message})`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    warnOnce("expected a JSON array of route objects");
    return [];
  }

  const seen = new Set();
  const routes = [];
  let defaults = 0;

  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || !isNonEmptyString(entry.name)) {
      warnOnce("every route needs a non-empty string `name`");
      return [];
    }
    const name = entry.name.trim();
    if (seen.has(name)) {
      warnOnce(`duplicate route name "${name}"`);
      return [];
    }
    seen.add(name);

    let pattern = null;
    if (isNonEmptyString(entry.calendarPattern)) {
      try {
        pattern = new RegExp(entry.calendarPattern, "i");
      } catch (err) {
        warnOnce(`route "${name}" has an invalid calendarPattern (${err.message})`);
        return [];
      }
    }

    if (entry.default === true) defaults += 1;

    routes.push({
      name,
      emailDomains: Array.isArray(entry.emailDomains)
        ? entry.emailDomains.filter(isNonEmptyString).map((d) => d.toLowerCase())
        : [],
      keywords: Array.isArray(entry.keywords)
        ? entry.keywords.filter(isNonEmptyString).map((k) => k.toLowerCase())
        : [],
      calendarPattern: pattern,
      isDefault: entry.default === true,
    });
  }

  if (defaults > 1) {
    warnOnce("more than one route is marked default");
    return [];
  }
  return routes;
}

export function getAccountRoutes() {
  if (cachedRoutes) return cachedRoutes;
  const raw = process.env.MORGEN_ACCOUNT_ROUTES;
  cachedRoutes = isNonEmptyString(raw) ? parseRoutes(raw) : [];
  return cachedRoutes;
}

export function getAccountNames() {
  return getAccountRoutes().map((r) => r.name);
}

export function findRouteByName(name) {
  return getAccountRoutes().find((r) => r.name === name) || null;
}

export function getDefaultRouteName() {
  const fallback = getAccountRoutes().find((r) => r.isDefault);
  return fallback ? fallback.name : null;
}

// Test seam — also lets a long-running server pick up a changed env var.
export function _resetAccountRoutes() {
  cachedRoutes = null;
  warned = false;
}
