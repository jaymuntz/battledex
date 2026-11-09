// Fixed-window rate limiter keyed by IP (project-brief.md: 5 requests/min).
//
// State lives in this function instance's memory. That is fine for local
// `vercel dev` (one process), but on Vercel each warm instance keeps its own
// count, so the limit is per-instance, not global. Swap this for a shared
// store (e.g. Upstash Redis / Vercel KV) when deploying in Stage 7.

export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW_MS = 60_000;

const hits = new Map(); // ip -> { count, resetAt }

// Returns { allowed: true } or { allowed: false, retryAfterSeconds }.
export function checkRateLimit(ip, now = Date.now()) {
  // Drop expired entries so the map can't grow forever.
  for (const [key, entry] of hits) {
    if (entry.resetAt <= now) hits.delete(key);
  }

  const entry = hits.get(ip);
  if (!entry) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  entry.count += 1;
  return { allowed: true };
}

// Best-effort client IP. Vercel sets x-forwarded-for (client first);
// x-real-ip and the socket address are fallbacks for local dev.
export function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}
