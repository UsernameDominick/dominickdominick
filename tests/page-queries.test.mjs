// How many database queries a public page costs. A page used to fetch each of its ~30 site settings (theme colours, footer, custom
// head, maintenance mode...) in a query of its own; they are now read together, once per request. This drives the real worker with a
// counting fake database and fails if the settings reads creep back up.
import assert from "node:assert/strict";
import worker from "../worker/index.js";

function makeEnv(settings = {}) {
  const log = [];
  const home = { id: 1, slug: "home", title: "Home", meta_description: "", nav_label: null, nav_parent_id: null, password_hash: null, deleted_at: null };
  const article = { id: 7, slug: "hello", title: "Hello", body: "Hello world. ".repeat(20), tags: "[]", published_at: "2020-01-01T00:00:00.000Z", expires_at: null, archived: 0, deleted_at: null, version: 1, og_image: null, created_at: "2020-01-01", updated_at: "2020-01-01" };
  const run = (sql, binds) => {
    const note = () => log.push(sql.replace(/\s+/g, " ").trim());
    const settingsIn = /FROM settings WHERE key IN \(/.test(sql);
    const settingsOne = /FROM settings WHERE key = \?/.test(sql);
    return {
      first: async () => {
        note();
        if (settingsOne) return binds[0] in settings ? { value: settings[binds[0]] } : null;
        if (/FROM pages WHERE slug = \?/.test(sql)) return binds[0] === "home" ? home : null;
        if (/FROM articles WHERE slug = \?/.test(sql)) return binds[0] === "hello" ? article : null;
        return null;
      },
      all: async () => {
        note();
        if (settingsIn) return { results: binds.filter((k) => k in settings).map((k) => ({ key: k, value: settings[k] })) };
        if (/FROM articles/.test(sql)) return { results: [article] };
        return { results: [] };
      },
      run: async () => {
        note();
        return { meta: { last_row_id: 1 } };
      },
    };
  };
  const env = {
    DB: { prepare: (sql) => ({ bind: (...binds) => run(sql, binds), ...run(sql, []) }) },
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    MEDIA: { get: async () => null, head: async () => null },
    SESSION_SECRET: "test-secret",
  };
  return { env, log };
}
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
const get = (env, path) => worker.fetch(new Request(`https://dominickdominick.com${path}`, { headers: { "User-Agent": "Mozilla/5.0 Chrome/120" } }), env, ctx);
const settingsQueries = (log) => log.filter((q) => /FROM settings/.test(q));

// the home page
{
  const { env, log } = makeEnv({ theme_accent: "#ff7a3d", site_footer: "© me", maintenance_mode: "0", custom_head: "<!-- hi -->" });
  const res = await get(env, "/");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /--accent:#ff7a3d/, "the saved theme colour is still applied");
  assert.match(html, /© me/, "and the footer text");
  assert.match(html, /<!-- hi -->/, "and the custom head");
  const sq = settingsQueries(log);
  console.log(`home: ${log.length} queries, ${sq.length} on settings`);
  assert.ok(sq.length <= 3, `settings queries: ${sq.length}\n${sq.map((q) => q.slice(0, 90)).join("\n")}`);
  assert.ok(log.length <= 12, `total queries: ${log.length}`);
}
// an article page
{
  const { env, log } = makeEnv({ theme_bg: "#101010", maintenance_mode: "0" });
  const res = await get(env, "/random/hello");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /--bg:#101010/);
  const sq = settingsQueries(log);
  console.log(`article: ${log.length} queries, ${sq.length} on settings`);
  assert.ok(sq.length <= 3, `settings queries: ${sq.length}`);
}
// maintenance mode still works, from the same single read
{
  const { env, log } = makeEnv({ maintenance_mode: "1", maintenance_message: "Back soon, promise." });
  const res = await get(env, "/");
  assert.equal(res.status, 503);
  assert.match(await res.text(), /Back soon, promise\./);
  assert.ok(settingsQueries(log).length <= 3);
}
// a missing page is still a 404 and costs few settings reads
{
  const { env, log } = makeEnv({});
  const res = await get(env, "/definitely-not-here");
  assert.equal(res.status, 404);
  console.log(`404: ${log.length} queries, ${settingsQueries(log).length} on settings`);
  assert.ok(settingsQueries(log).length <= 3);
}
console.log("ALL PASS");
