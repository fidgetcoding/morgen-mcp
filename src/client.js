export const MORGEN_BASE = "https://api.morgen.so";

// Raised from 100 → 300 on 2026-04-15 per John Mavrick @ Morgen
// ("other users hitting limits quickly"). The constant lives here because
// Morgen has no public endpoint exposing the current budget.
const RATE_LIMIT_POINTS = 300;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// Rolling window of { timestamp, points } entries
let pointLedger = [];

function pruneLedger(now) {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  pointLedger = pointLedger.filter((entry) => entry.timestamp > cutoff);
}

function currentPoints() {
  return pointLedger.reduce((sum, entry) => sum + entry.points, 0);
}

// Walk the ledger to find the earliest moment enough old points expire
// for the incoming request to fit within the budget. A 10-point list call
// with only 5 free points needs to wait until multiple old entries drop off,
// not just the oldest one.
function msUntilFits(now, incomingPoints) {
  const overBy = currentPoints() + incomingPoints - RATE_LIMIT_POINTS;
  if (overBy <= 0) return 0;
  let released = 0;
  for (const entry of pointLedger) {
    released += entry.points;
    if (released >= overBy) {
      const expiryTime = entry.timestamp + RATE_LIMIT_WINDOW_MS;
      return Math.max(0, expiryTime - now);
    }
  }
  return RATE_LIMIT_WINDOW_MS;
}

function enforceRateLimit(points) {
  if (points > RATE_LIMIT_POINTS) {
    throw new Error(
      `request requires ${points} points but the Morgen rate limit budget is only ${RATE_LIMIT_POINTS} points per 15 minutes`
    );
  }
  const now = Date.now();
  pruneLedger(now);

  if (currentPoints() + points > RATE_LIMIT_POINTS) {
    const msUntilExpiry = msUntilFits(now, points);
    const secondsUntilExpiry = Math.max(1, Math.ceil(msUntilExpiry / 1000));
    throw new Error(
      `Morgen rate limit reached (300 points per 15 minutes). Try again in ${secondsUntilExpiry} seconds.`
    );
  }

  pointLedger.push({ timestamp: now, points });
}

export function _resetRateLimiter() {
  pointLedger = [];
}

function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function withRetry(fn, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRetryable =
        err.name === "AbortError" ||
        (err.message && (
          err.message.includes("HTTP 429") ||
          err.message.includes("HTTP 503") ||
          err.message.includes("fetch failed")
        ));
      if (!isRetryable || attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 1_000 * attempt));
    }
  }
  throw lastError;
}

function morgenHeaders() {
  const apiKey = process.env.MORGEN_API_KEY;
  return {
    Authorization: `ApiKey ${apiKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function scrubKey(message) {
  const key = process.env.MORGEN_API_KEY;
  if (!message) return message;
  let scrubbed = message.replace(/https?:\/\/[^\s)]+/g, "[redacted-url]");
  if (key && key.length > 4) {
    scrubbed = scrubbed.split(key).join("[redacted-key]");
  }
  return scrubbed;
}

export async function morgenFetch(path, { method = "GET", body, points = 1 } = {}) {
  enforceRateLimit(points);

  try {
    return await withRetry(async () => {
      const init = {
        method,
        headers: morgenHeaders(),
      };
      if (body !== undefined) {
        init.body = JSON.stringify(body);
      }

      const res = await fetchWithTimeout(`${MORGEN_BASE}${path}`, init);

      if (!res.ok) {
        // https://docs.morgen.so/authentication: a valid key on a plan without
        // API access gets a 403 "Missing entitlements".
        const hint = res.status === 403 ? " If your key is valid, your Morgen plan may not include API access." : "";
        throw new Error(
          `Morgen API error (HTTP ${res.status}). The request to ${path} was not successful.${hint}`
        );
      }

      if (
        res.status === 204 ||
        res.status === 205 ||
        res.headers.get("content-length") === "0"
      ) {
        return null;
      }

      return res.json();
    });
  } catch (err) {
    const safe = scrubKey(err instanceof Error ? err.message : String(err));
    throw new Error(safe || "Morgen API call failed");
  }
}
