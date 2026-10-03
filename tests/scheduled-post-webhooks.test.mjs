// Scheduled posts: the daily cron tells the publish webhooks about posts that went live since its last run.
import assert from "node:assert/strict";
import { stampMs, duePublishes, publishWebhookPayload, runScheduledPostWebhooks, SCHEDULED_WEBHOOK_MARKER, SCHEDULED_WEBHOOK_CAP } from "../worker/db.js";

const DAY = 86400000;
const NOW = Date.parse("2026-10-10T08:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

// ---- stampMs: both stored shapes are UTC ----
assert.equal(stampMs("2026-10-03 08:00:00"), Date.parse("2026-10-03T08:00:00Z"));
assert.equal(stampMs("2026-10-03T08:00:00.000Z"), Date.parse("2026-10-03T08:00:00Z"));
assert.equal(stampMs("2026-10-03T08:00"), Date.parse("2026-10-03T08:00:00Z"));
assert.equal(stampMs("2026-10-03T10:00:00+02:00"), Date.parse("2026-10-03T08:00:00Z"));
assert.equal(stampMs("2026-10-03T10:00:00+0200"), Date.parse("2026-10-03T08:00:00Z"));
assert.equal(stampMs(""), null);
assert.equal(stampMs(null), null);
assert.equal(stampMs("soon"), null);
assert.equal(stampMs("2026-13-45 99:99:99"), null);

// ---- payload shape (shared with the save-time webhook) ----
assert.deepEqual(publishWebhookPayload("article", { title: "T", slug: "s", published_at: "x" }), {
  contentType: "article", title: "T", slug: "s", url: "https://dominickdominick.com/random/s", published_at: "x",
});
assert.equal(publishWebhookPayload("project", { title: "T", slug: "p", published_at: "x" }).url, "https://dominickdominick.com/projects/p");

// ---- duePublishes ----
const items = [
  { slug: "old", published_at: iso(NOW - 3 * DAY) },
  { slug: "b", published_at: "2026-10-09 12:00:00" },
  { slug: "a", published_at: iso(NOW - 18 * 3600000) },
  { slug: "future", published_at: iso(NOW + 3600000) },
  { slug: "edge", published_at: iso(NOW) },
  { slug: "none", published_at: null },
];
let r = duePublishes(items, NOW - DAY, NOW);
assert.deepEqual(r.due.map((d) => d.item.slug), ["b", "a", "edge"], "mixed formats, oldest first, the future one and the old one left out; 'now' counts");
assert.equal(r.deferred, 0);
r = duePublishes(items, NOW - DAY, NOW, 2);
assert.deepEqual(r.due.map((d) => d.item.slug), ["b", "a"]);
assert.equal(r.deferred, 1);
r = duePublishes(items, NOW - DAY, NOW, 10, (i) => i.slug === "a");
assert.deepEqual(r.due.map((d) => d.item.slug), ["b", "edge"], "announced ones are skipped before the cap applies");
assert.deepEqual(duePublishes(null, 0, NOW), { due: [], deferred: 0 });

// ---- the sweep, against a stand-in database ----
function fakeEnv({ settings = {}, articles = [], projects = [], history = [] } = {}) {
  const state = { settings: { ...settings }, articles, projects, history: history.map((h, i) => ({ id: i + 1, ...h })) };
  const prep = (sql) => {
    const make = (binds) => ({
      first: async () => {
        if (/FROM settings WHERE key = \?/.test(sql)) return binds[0] in state.settings ? { value: state.settings[binds[0]] } : null;
        throw new Error("first: " + sql);
      },
      all: async () => {
        let m;
        if ((m = /FROM (articles|projects)\s+WHERE deleted_at IS NULL AND archived = 0/.exec(sql))) {
          const [floorDay, nowIso] = binds;
          return { results: state[m[1]].filter((x) => !x.deleted_at && !x.archived && x.published_at && x.published_at >= floorDay && (!x.expires_at || x.expires_at > nowIso)).sort((a, b) => (a.published_at < b.published_at ? -1 : 1)) };
        }
        if (/FROM webhook_deliveries ORDER BY id DESC/.test(sql)) return { results: [...state.history].reverse().slice(0, 200) };
        throw new Error("all: " + sql);
      },
      run: async () => {
        if (/^INSERT INTO settings/.test(sql)) {
          state.settings[binds[0]] = binds[1];
          return {};
        }
        if (/^INSERT INTO webhook_deliveries/.test(sql)) {
          const id = state.history.length + 1;
          state.history.push({ id, url: binds[0], payload: binds[1], status: binds[2], status_code: binds[3], error: binds[4] });
          return { meta: { last_row_id: id } };
        }
        if (/^DELETE FROM webhook_deliveries/.test(sql)) return {};
        throw new Error("run: " + sql);
      },
    });
    return { bind: (...b) => make(b), ...make([]) };
  };
  return { state, env: { DB: { prepare: prep } } };
}
const sends = [];
const okSend = async (url, init) => (sends.push({ url, payload: JSON.parse(init.body) }), { ok: true, status: 200 });
const row = (slug, ms, extra = {}) => ({ title: slug.toUpperCase(), slug, published_at: iso(ms), ...extra });
const HOOK = "https://hooks.example.com/a";

// First run only sets the marker.
let f = fakeEnv({ settings: { webhook_url: HOOK }, articles: [row("a", NOW - 3600000)] });
let out = await runScheduledPostWebhooks(f.env, { send: okSend, now: NOW });
assert.equal(out.initialised, true);
assert.equal(f.state.settings[SCHEDULED_WEBHOOK_MARKER], iso(NOW), "marker starts at now");
assert.equal(sends.length, 0, "nothing already out is announced");

// Next day: a scheduled post that went live, plus one still in the future, one trashed, one archived, one expired, one older than the marker.
const last = NOW - DAY;
sends.length = 0;
f = fakeEnv({
  settings: { webhook_url: `${HOOK}\nnot a url\n  https://hooks.example.com/b  `, [SCHEDULED_WEBHOOK_MARKER]: iso(last) },
  articles: [
    row("went-live", NOW - 5 * 3600000),
    row("later", NOW + 3600000),
    row("trashed", NOW - 3600000, { deleted_at: "2026-10-10 00:00:00" }),
    row("archived", NOW - 3600000, { archived: 1 }),
    row("expired", NOW - 7200000, { expires_at: iso(NOW - 3600000) }),
    row("before-marker", last - 3600000),
    { title: "Sql", slug: "sql-stamp", published_at: "2026-10-09 20:00:00" },
  ],
  projects: [row("a-project", NOW - 3600000)],
});
out = await runScheduledPostWebhooks(f.env, { send: okSend, now: NOW });
assert.deepEqual(sends.map((s) => `${s.url} ${s.payload.slug}`), [
  "https://hooks.example.com/a sql-stamp", "https://hooks.example.com/b sql-stamp",
  "https://hooks.example.com/a went-live", "https://hooks.example.com/b went-live",
], "each live post goes to every real URL, oldest first; projects stay quiet until switched on");
assert.equal(out.posts, 2);
assert.equal(out.deliveries, 4);
assert.equal(f.state.settings[SCHEDULED_WEBHOOK_MARKER], iso(NOW));
assert.equal(f.state.history.length, 4, "each delivery is logged like any other");
assert.equal(sends[0].payload.url, "https://dominickdominick.com/random/sql-stamp");

// Running again the same day sends nothing new (the marker moved, and history agrees).
sends.length = 0;
out = await runScheduledPostWebhooks(f.env, { send: okSend, now: NOW + 1800000 });
assert.equal(sends.length, 0);

// ...and when the future post's time arrives, the following sweep announces it.
out = await runScheduledPostWebhooks(f.env, { send: okSend, now: NOW + 7200000 });
assert.deepEqual(sends.map((s) => s.payload.slug), ["later", "later"], "once per URL");

// Projects join in when that switch is on.
sends.length = 0;
f = fakeEnv({ settings: { webhook_url: HOOK, webhook_on_project_publish: "1", [SCHEDULED_WEBHOOK_MARKER]: iso(last) }, projects: [row("a-project", NOW - 3600000)] });
await runScheduledPostWebhooks(f.env, { send: okSend, now: NOW });
assert.deepEqual(sends.map((s) => [s.payload.contentType, s.payload.url]), [["project", "https://dominickdominick.com/projects/a-project"]]);

// Something already announced when it was saved is not announced again, even if its date is spelled differently in the table.
sends.length = 0;
f = fakeEnv({
  settings: { webhook_url: HOOK, [SCHEDULED_WEBHOOK_MARKER]: iso(last) },
  articles: [{ title: "Saved live", slug: "saved-live", published_at: "2026-10-09 23:00:00" }, row("scheduled", NOW - 3600000)],
  history: [{ url: HOOK, payload: JSON.stringify({ contentType: "article", title: "Saved live", slug: "saved-live", url: "x", published_at: "2026-10-09T23:00:00.000Z" }), status: "success" }],
});
await runScheduledPostWebhooks(f.env, { send: okSend, now: NOW });
assert.deepEqual(sends.map((s) => s.payload.slug), ["scheduled"]);

// A failing endpoint is logged as failed and does not stop the rest, nor the marker.
sends.length = 0;
f = fakeEnv({ settings: { webhook_url: `${HOOK}\nhttps://hooks.example.com/b`, [SCHEDULED_WEBHOOK_MARKER]: iso(last) }, articles: [row("p", NOW - 3600000)] });
const flaky = async (url, init) => {
  if (url.endsWith("/a")) throw new Error("connection refused");
  return okSend(url, init);
};
out = await runScheduledPostWebhooks(f.env, { send: flaky, now: NOW });
assert.equal(sends.length, 1);
assert.deepEqual(f.state.history.map((h) => h.status), ["failed", "success"]);
assert.equal(f.state.settings[SCHEDULED_WEBHOOK_MARKER], iso(NOW));

// No URLs configured: nothing is sent and the marker still moves, so a URL added later does not announce the past.
sends.length = 0;
f = fakeEnv({ settings: { [SCHEDULED_WEBHOOK_MARKER]: iso(last) }, articles: [row("p", NOW - 3600000)] });
await runScheduledPostWebhooks(f.env, { send: okSend, now: NOW });
assert.equal(sends.length, 0);
assert.equal(f.state.settings[SCHEDULED_WEBHOOK_MARKER], iso(NOW));

// A marker from long ago only looks back a week.
sends.length = 0;
f = fakeEnv({ settings: { webhook_url: HOOK, [SCHEDULED_WEBHOOK_MARKER]: iso(NOW - 90 * DAY) }, articles: [row("ancient", NOW - 30 * DAY), row("recent", NOW - 2 * DAY)] });
await runScheduledPostWebhooks(f.env, { send: okSend, now: NOW });
assert.deepEqual(sends.map((s) => s.payload.slug), ["recent"]);

// More than the cap, all stamped the same second (a bulk publish): ten go out, the marker stops there, and the next sweeps finish the job.
sends.length = 0;
const burst = Array.from({ length: 25 }, (_, i) => ({ title: "B" + i, slug: "burst-" + String(i).padStart(2, "0"), published_at: "2026-10-10 03:00:00" }));
f = fakeEnv({ settings: { webhook_url: HOOK, [SCHEDULED_WEBHOOK_MARKER]: iso(last) }, articles: burst });
out = await runScheduledPostWebhooks(f.env, { send: okSend, now: NOW });
assert.equal(out.posts, SCHEDULED_WEBHOOK_CAP);
assert.equal(out.deferred, 15);
assert.ok(stampMs(f.state.settings[SCHEDULED_WEBHOOK_MARKER]) < NOW, "the marker has not jumped past the posts still waiting");
out = await runScheduledPostWebhooks(f.env, { send: okSend, now: NOW + DAY });
assert.equal(out.posts, SCHEDULED_WEBHOOK_CAP);
out = await runScheduledPostWebhooks(f.env, { send: okSend, now: NOW + 2 * DAY });
assert.equal(out.posts, 5);
assert.equal(out.deferred, 0);
assert.equal(new Set(sends.map((s) => s.payload.slug)).size, 25, "every post announced exactly once");
assert.equal(sends.length, 25);

console.log("ALL PASS");
