// Bulk actions on articles and projects: D1 allows 100 bound values per statement, so long selections must go in chunks.
import assert from "node:assert/strict";
import { bulkArticleAction, bulkProjectAction, chunkList, IN_CHUNK } from "../worker/db.js";

// A stand-in database that refuses more than 100 bound values (like D1) and understands just the statements these actions use.
function fakeDb(table, rows) {
  const log = { statements: 0, batches: 0, maxBinds: 0 };
  const byId = new Map(rows.map((r) => [r.id, { ...r }]));
  function run(sql, binds) {
    log.statements++;
    log.maxBinds = Math.max(log.maxBinds, binds.length);
    if (binds.length > 100) throw new Error("too many SQL variables");
    const ids = new Set(binds);
    let m;
    if ((m = /^SELECT id FROM \w+ WHERE id IN \([?,]+\) AND locked = 1$/.exec(sql))) return [...byId.values()].filter((r) => ids.has(r.id) && r.locked);
    if (/^SELECT id, published_at, body FROM/.test(sql)) return [...byId.values()].filter((r) => ids.has(r.id)).map(({ id, published_at, body }) => ({ id, published_at, body }));
    if (/^SELECT id, tags FROM/.test(sql)) return [...byId.values()].filter((r) => ids.has(r.id)).map(({ id, tags }) => ({ id, tags }));
    if (/^UPDATE \w+ SET published_at = COALESCE/.test(sql)) {
      for (const id of ids) byId.get(id) && !byId.get(id).published_at && (byId.get(id).published_at = "now");
      return [];
    }
    if (/^UPDATE \w+ SET published_at = NULL/.test(sql)) {
      for (const id of ids) byId.get(id) && (byId.get(id).published_at = null);
      return [];
    }
    if (/^UPDATE \w+ SET deleted_at/.test(sql)) {
      for (const id of ids) byId.get(id) && (byId.get(id).deleted_at = "now");
      return [];
    }
    if (/^UPDATE \w+ SET tags = \?/.test(sql)) {
      byId.get(binds[1]).tags = binds[0];
      return [];
    }
    throw new Error("unexpected SQL: " + sql);
  }
  const prep = (sql) => ({
    bind: (...binds) => ({
      sql,
      binds,
      all: async () => ({ results: run(sql, binds) }),
      run: async () => (run(sql, binds), {}),
    }),
  });
  return {
    byId,
    log,
    env: {
      DB: {
        prepare: prep,
        batch: async (statements) => {
          log.batches++;
          for (const st of statements) run(st.sql, st.binds);
          return statements.map(() => ({}));
        },
      },
    },
  };
}

const LONG = "x".repeat(80);
function makeRows(n) {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, locked: (i + 1) % 10 === 0 ? 1 : 0, published_at: null, deleted_at: null, tags: "[]", body: LONG }));
}

// ---- chunkList ----
assert.equal(IN_CHUNK, 90);
assert.deepEqual(chunkList([]), []);
assert.deepEqual(chunkList([1, 2, 3], 2), [[1, 2], [3]]);
assert.equal(chunkList(Array.from({ length: 250 }, (_, i) => i)).length, 3);

// ---- 250 articles at once, every action ----
for (const [name, fn] of [["articles", bulkArticleAction], ["projects", bulkProjectAction]]) {
  let db = fakeDb(name, makeRows(250));
  const ids = [...db.byId.keys()];
  let r = await fn(db.env, ids, "publish");
  assert.equal(r.skippedLocked, 25, `${name}: every tenth row is locked`);
  assert.equal(r.affected, 225, `${name}: the rest are published`);
  assert.ok(db.log.maxBinds <= IN_CHUNK, `${name}: no statement binds more than ${IN_CHUNK} values (saw ${db.log.maxBinds})`);
  assert.equal([...db.byId.values()].filter((x) => x.published_at).length, 225);
  assert.ok(!db.byId.get(10).published_at, "a locked row is untouched");

  r = await fn(db.env, ids, "unpublish");
  assert.equal(r.affected, 225);
  assert.equal([...db.byId.values()].filter((x) => x.published_at).length, 0);

  r = await fn(db.env, ids, "add-tag", { tag: "bulk" });
  assert.equal(r.affected, 225);
  assert.equal([...db.byId.values()].filter((x) => x.tags === '["bulk"]').length, 225);
  r = await fn(db.env, ids, "add-tag", { tag: "bulk" });
  assert.equal([...db.byId.values()].filter((x) => x.tags === '["bulk"]').length, 225, "adding the same tag twice changes nothing");
  assert.ok(db.log.maxBinds <= IN_CHUNK);

  r = await fn(db.env, ids, "trash");
  assert.equal(r.affected, 225);
  assert.equal([...db.byId.values()].filter((x) => x.deleted_at).length, 225);
  assert.ok(db.log.batches >= 3, "writes went through db.batch");
}

// ---- smaller behaviours kept ----
let db = fakeDb("articles", [{ id: 1, locked: 0, published_at: null, deleted_at: null, tags: "[]", body: "short" }, { id: 2, locked: 0, published_at: "2024", deleted_at: null, tags: "[]", body: "" }, ...makeRows(0)]);
let r = await bulkArticleAction(db.env, [1, 2, 2, "2", "nope", -4, 1.5], "publish");
assert.deepEqual(r, { affected: 1, skippedLocked: 0, skippedTooShort: 1 }, "duplicates count once, a too-short body is skipped, a published one passes");
assert.deepEqual(await bulkArticleAction(db.env, [], "publish"), { affected: 0, skippedLocked: 0 });
assert.deepEqual(await bulkArticleAction(db.env, ["x"], "publish"), { affected: 0, skippedLocked: 0 });
await assert.rejects(() => bulkArticleAction(db.env, [1], "explode"), /Invalid bulk action/);
await assert.rejects(() => bulkArticleAction(db.env, [1], "add-tag", {}), /Tag required/);

console.log("ALL PASS");
