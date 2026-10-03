// Rate limit counters: old rows are swept on roughly one hit in fifty instead of on every hit.
import assert from "node:assert/strict";
import { recordRateLimitHit, shouldPruneRateLimits, RATE_LIMIT_PRUNE_ODDS } from "../worker/db.js";

function fakeEnv() {
  const calls = [];
  return {
    calls,
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return { run: async () => (calls.push({ sql, args }), {}) };
          },
          run: async () => (calls.push({ sql, args: [] }), {}),
        };
      },
    },
  };
}

assert.equal(RATE_LIMIT_PRUNE_ODDS, 50);
assert.equal(shouldPruneRateLimits(0), true, "a roll of 0 prunes");
assert.equal(shouldPruneRateLimits(0.0199), true);
assert.equal(shouldPruneRateLimits(0.02), false, "the cut-off is one in fifty");
assert.equal(shouldPruneRateLimits(0.99), false);

// A normal hit inserts and nothing else.
let env = fakeEnv();
await recordRateLimitHit(env, "track", "1.2.3.4", 0.5);
assert.equal(env.calls.length, 1);
assert.match(env.calls[0].sql, /^INSERT INTO rate_limits/);
assert.deepEqual(env.calls[0].args, ["track", "1.2.3.4"]);

// A sampled hit inserts first, then sweeps rows over a day old.
env = fakeEnv();
await recordRateLimitHit(env, "track", "1.2.3.4", 0.001);
assert.equal(env.calls.length, 2);
assert.match(env.calls[0].sql, /^INSERT INTO rate_limits/);
assert.match(env.calls[1].sql, /^DELETE FROM rate_limits WHERE attempted_at < datetime\('now', '-1 day'\)/);

// A failed sweep never fails the request.
env = fakeEnv();
env.DB.prepare = (sql) => ({
  bind: () => ({ run: async () => ({}) }),
  run: async () => {
    throw new Error("db busy");
  },
});
await recordRateLimitHit(env, "track", "1.2.3.4", 0);

// Over many real rolls the sweep runs about 2% of the time.
let swept = 0;
const N = 20000;
for (let i = 0; i < N; i++) if (shouldPruneRateLimits()) swept++;
assert.ok(swept > N * 0.01 && swept < N * 0.035, `swept ${swept} of ${N}`);

console.log("ALL PASS");
