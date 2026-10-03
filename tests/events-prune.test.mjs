// The daily run removes analytics events older than 180 days, a slice at a time.
import assert from "node:assert/strict";
import { pruneOldEvents, EVENTS_KEEP_DAYS } from "../worker/db.js";

// A stand-in for the events table: rows have an age in days; the DELETE removes up to `limit` rows older than the cut-off.
function fakeEnv(ages) {
  const rows = ages.map((age, id) => ({ id, age }));
  const state = { rows, deletes: [], settings: {} };
  return {
    state,
    env: {
      DB: {
        prepare(sql) {
          return {
            bind: (...binds) => ({
              run: async () => {
                if (/^DELETE FROM events WHERE id IN \(SELECT id FROM events WHERE created_at < datetime\('now', \?\) LIMIT \?\)$/.test(sql)) {
                  const days = Number(/^-(\d+) days$/.exec(binds[0])[1]);
                  const limit = binds[1];
                  state.deletes.push({ days, limit });
                  const old = state.rows.filter((r) => r.age > days).slice(0, limit);
                  state.rows = state.rows.filter((r) => !old.includes(r));
                  return { meta: { changes: old.length } };
                }
                if (/^INSERT INTO settings/.test(sql)) { state.settings[binds[0]] = binds[1]; return {}; }
                throw new Error("unexpected SQL: " + sql);
              },
            }),
          };
        },
      },
    },
  };
}

assert.equal(EVENTS_KEEP_DAYS, 180);

// Only rows past the window go.
let f = fakeEnv([1, 30, 179, 180, 181, 400, 1000]);
let n = await pruneOldEvents(f.env);
assert.equal(n, 3, "181, 400 and 1000 days old are removed; 180 and under stay");
assert.deepEqual(f.state.rows.map((r) => r.age), [1, 30, 179, 180]);
assert.deepEqual(f.state.deletes, [{ days: 180, limit: 5000 }], "one slice was enough, so it stopped");
const note = JSON.parse(f.state.settings.last_events_prune);
assert.equal(note.deleted, 3);
assert.equal(note.keepDays, 180);
assert.ok(Number.isFinite(Date.parse(note.at)), "it notes when it last ran, and how much it removed");

// Nothing old: one empty slice, nothing removed.
f = fakeEnv([1, 2, 3]);
assert.equal(await pruneOldEvents(f.env), 0);
assert.equal(f.state.rows.length, 3);

// An empty table is fine.
f = fakeEnv([]);
assert.equal(await pruneOldEvents(f.env), 0);

// A big backlog goes in slices, up to the cap, and the rest waits for the next day.
f = fakeEnv(Array.from({ length: 23000 }, () => 400));
n = await pruneOldEvents(f.env, { batch: 5000, maxBatches: 3 });
assert.equal(n, 15000, "three slices of 5000");
assert.equal(f.state.rows.length, 8000, "the rest is left for tomorrow");
assert.equal(f.state.deletes.length, 3);
f = fakeEnv(Array.from({ length: 23000 }, () => 400));
n = await pruneOldEvents(f.env, { batch: 5000, maxBatches: 20 });
assert.equal(n, 23000, "with room to spare it takes the lot");
assert.equal(f.state.deletes.length, 5, "and stops at the first slice that comes up short");

// The window can't be set under a month, and junk falls back to 180.
f = fakeEnv([20, 29, 31, 100]);
n = await pruneOldEvents(f.env, { days: 1 });
assert.equal(n, 2, "asking for 1 day still keeps a month (30)");
assert.equal(f.state.deletes[0].days, 30);
f = fakeEnv([200]);
await pruneOldEvents(f.env, { days: "banana" });
assert.equal(f.state.deletes[0].days, 180);

console.log("ALL PASS");
