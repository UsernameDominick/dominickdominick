// All SQL the site still runs: the error log and the rate limit behind the study unlock. The tables of the features that were cut (pages,
// blocks, settings, media, songs, revisions and the rest) are still in the database, untouched; nothing reads them.

// ---------- Error log ----------
const ERROR_LOG_KEEP = 300;

export async function logError(env, { message, stack, path }) {
  await env.DB
    .prepare("INSERT INTO error_log (message, stack, path) VALUES (?, ?, ?)")
    .bind(String(message || "Unknown error").slice(0, 2000), stack ? String(stack).slice(0, 4000) : null, path || null)
    .run();
  await env.DB
    .prepare(`DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY id DESC LIMIT ?)`)
    .bind(ERROR_LOG_KEEP)
    .run()
    .catch(() => {});
}

// ---------- Rate limiting ----------
export async function checkRateLimit(env, bucket, ip, { windowMinutes = 1, maxAttempts = 30 } = {}) {
  const { results } = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM rate_limits WHERE bucket = ? AND ip = ? AND attempted_at > datetime('now', '-${Math.max(
        1,
        Math.floor(windowMinutes)
      )} minutes')`
    )
    .bind(bucket, ip)
    .all();
  return (results[0]?.n || 0) < maxAttempts;
}

// Old rows are swept now and then rather than on every hit: the delete filters on attempted_at alone, so it cannot use the
// (bucket, ip, attempted_at) index and scans the table. The window itself is still enforced by checkRateLimit, so rows
// that linger a little longer than a day change nothing.
export const RATE_LIMIT_PRUNE_ODDS = 50;
export function shouldPruneRateLimits(roll = Math.random()) {
  return roll < 1 / RATE_LIMIT_PRUNE_ODDS;
}

export async function recordRateLimitHit(env, bucket, ip, roll) {
  await env.DB.prepare("INSERT INTO rate_limits (bucket, ip) VALUES (?, ?)").bind(bucket, ip).run();
  if (!shouldPruneRateLimits(roll)) return;
  await env.DB
    .prepare(`DELETE FROM rate_limits WHERE attempted_at < datetime('now', '-1 day')`)
    .run()
    .catch(() => {});
}
