// Login: how long a locked-out connection waits, the message it sees, and how wrong passwords are counted.
import assert from "node:assert/strict";
import { loginRetrySeconds, loginLockoutMessage, recordLoginAttempt, getLoginLockout } from "../worker/db.js";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const sql = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const minAgo = (m) => sql(NOW - m * 60000);

// ---- retry time ----
assert.equal(loginRetrySeconds([], NOW), 0);
assert.equal(loginRetrySeconds(null, NOW), 0);
assert.equal(loginRetrySeconds(Array.from({ length: 7 }, (_, i) => minAgo(i)), NOW), 0, "seven wrong passwords is still allowed");
// Eight in the window: the next try is allowed when the oldest ages out (15 minutes after it).
let eight = [14, 10, 9, 8, 5, 3, 2, 1].map(minAgo);
assert.equal(loginRetrySeconds(eight, NOW), 60, "the oldest is 14 minutes old, so one more minute");
assert.equal(loginRetrySeconds([5, 5, 5, 5, 5, 5, 5, 5].map(minAgo), NOW), 10 * 60);
// Ten in the window: three must age out to get down to seven, so the wait is until the third oldest (9 minutes old) does.
const ten = [14, 13, 9, 8, 7, 6, 5, 4, 3, 2].map(minAgo);
assert.equal(loginRetrySeconds(ten, NOW), 6 * 60);
// Anything older than the window does not count.
assert.equal(loginRetrySeconds([...eight.slice(1), minAgo(20)], NOW), 0);
assert.equal(loginRetrySeconds(["garbage", ...eight.slice(1)], NOW), 0, "an unreadable time is ignored");
assert.ok(loginRetrySeconds(eight, NOW) >= 1);

// ---- message ----
assert.equal(loginLockoutMessage(60), "Too many wrong passwords. Try again in about 1 minute.");
assert.equal(loginLockoutMessage(61), "Too many wrong passwords. Try again in about 2 minutes.");
assert.equal(loginLockoutMessage(0), "Too many wrong passwords. Try again in about 1 minute.");
assert.equal(loginLockoutMessage(15 * 60), "Too many wrong passwords. Try again in about 15 minutes.");

// ---- a stand-in database ----
function fakeEnv(settings = {}, attempts = []) {
  const state = { settings: { ...settings }, deliveries: [], attempts: [...attempts] };
  const env = {
    DB: {
      prepare(sql) {
        const make = (b) => ({
          first: async () => {
            if (/FROM settings WHERE key/.test(sql)) return b[0] in state.settings ? { value: state.settings[b[0]] } : null;
            if (/COUNT\(\*\) AS n FROM login_attempts/.test(sql)) return { n: state.attempts.length };
            throw new Error("first: " + sql);
          },
          all: async () => {
            if (/SELECT attempted_at FROM login_attempts/.test(sql)) return { results: state.attempts.map((a) => ({ attempted_at: a })) };
            throw new Error("all: " + sql);
          },
          run: async () => {
            if (/^INSERT INTO login_attempts/.test(sql)) state.attempts.push(sql_now());
            else if (/^INSERT INTO webhook_deliveries/.test(sql)) state.deliveries.push({ url: b[0], payload: JSON.parse(b[1]), status: b[2], error: b[4] });
            else if (!/^DELETE FROM/.test(sql)) throw new Error("run: " + sql);
            return { meta: { last_row_id: state.deliveries.length } };
          },
        });
        return { bind: (...b) => make(b), ...make([]) };
      },
    },
  };
  return { state, env };
}
const sql_now = () => sql(Date.now());

// getLoginLockout reads the table through the same retry rule.
let f = fakeEnv({}, eight);
let lock = await getLoginLockout(f.env, "1.2.3.4", NOW);
assert.deepEqual(lock, { allowed: false, retryAfterSeconds: 60 });
f = fakeEnv({}, eight.slice(1));
assert.deepEqual(await getLoginLockout(f.env, "1.2.3.4", NOW), { allowed: true, retryAfterSeconds: 0 });

// recordLoginAttempt returns how many wrong passwords this connection now has in the window.
f = fakeEnv();
for (let i = 1; i <= 6; i++) assert.equal(await recordLoginAttempt(f.env, "1.2.3.4"), i);

console.log("ALL PASS");
