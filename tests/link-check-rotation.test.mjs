// The daily link check looks at other sites' links a batch at a time (25), carrying results forward, and says how many are waiting.
import assert from "node:assert/strict";
import { pickExternalBatch, runScheduledLinkCheck, getLinkCheckStatus, LINK_CHECK_EXTERNAL_PER_RUN } from "../worker/db.js";

assert.equal(LINK_CHECK_EXTERNAL_PER_RUN, 25);

// ---- picking a batch ----
const urls = ["https://c.example", "https://a.example", "https://b.example", "https://d.example", "https://a.example"];
assert.deepEqual(pickExternalBatch(urls, "", 2), { batch: ["https://a.example", "https://b.example"], next: "https://b.example" }, "from the start, in order, no duplicates");
assert.deepEqual(pickExternalBatch(urls, "https://b.example", 2), { batch: ["https://c.example", "https://d.example"], next: "https://d.example" }, "carries on after the cursor");
assert.deepEqual(pickExternalBatch(urls, "https://d.example", 2), { batch: ["https://a.example", "https://b.example"], next: "https://b.example" }, "wraps round at the end");
assert.deepEqual(pickExternalBatch(urls, "https://c.example", 3).batch, ["https://d.example", "https://a.example", "https://b.example"], "and wraps within one batch");
assert.deepEqual(pickExternalBatch(urls, "", 99).batch.length, 4, "never more than there are");
assert.deepEqual(pickExternalBatch([], "x", 5), { batch: [], next: "" }, "nothing to check");
assert.deepEqual(pickExternalBatch(urls, "zzz", 1).batch, ["https://a.example"], "a cursor past everything starts over");
assert.deepEqual(pickExternalBatch(["https://q.example"], "https://q.example", 5), { batch: ["https://q.example"], next: "https://q.example" }, "a single address is checked every time");
assert.equal(pickExternalBatch(urls, "", 0).batch.length >= 1, true, "a nonsense limit still checks something");

// ---- a stand-in for the settings table ----
function fakeEnv() {
  const settings = new Map();
  return {
    settings,
    env: {
      DB: {
        prepare(sql) {
          const make = (b) => ({
            first: async () => (/FROM settings WHERE key = \?/.test(sql) ? (settings.has(b[0]) ? { value: settings.get(b[0]) } : null) : (() => { throw new Error("first: " + sql); })()),
            run: async () => { if (/^INSERT INTO settings/.test(sql)) settings.set(b[0], b[1]); else throw new Error("run: " + sql); return {}; },
          });
          return { bind: (...b) => make(b), ...make([]) };
        },
      },
    },
  };
}
const outside = Array.from({ length: 60 }, (_, i) => `https://site${String(i).padStart(2, "0")}.example/page`);
const gatherOf = (extraInternal = ["/about", "/random/post"], ext = outside) => async () => ({ found: [...ext.map((url, i) => ({ url, source: `Article ${i}` })), ...extraInternal.map((url) => ({ url, source: "Page" })), { url: ext[0], source: "A second place" }] });
const checker = (log, dead = new Set()) => async (env, u) => { log.push(u); return /^https?:/.test(u) ? (dead.has(u) ? { ok: false, status: "Unreachable" } : { ok: true, status: "200" }) : u === "/gone" ? { ok: false, status: "Not found" } : { ok: true, status: "OK" }; };
const T = (n) => new Date(Date.UTC(2026, 9, 1 + n));

// ---- run after run ----
const f = fakeEnv();
const dead = new Set([outside[3], outside[40]]);
let log = [];
let r = await runScheduledLinkCheck(f.env, { gather: gatherOf(), check: checker(log, dead), now: T(0) });
assert.equal(log.filter((u) => u.startsWith("http")).length, 25, "the first run checks 25 outside links");
assert.equal(log.filter((u) => !u.startsWith("http")).length, 2, "and both of this site's own links");
assert.equal(r.outsideChecked, 25);
assert.equal(r.notChecked, 35, "35 are still waiting");
let st = await getLinkCheckStatus(f.env);
assert.equal(st.notChecked, 35);
assert.equal(st.perRun, 25);
assert.deepEqual(st.broken.map((b) => b.url), [outside[3]], "only the dead one among those checked is reported");
assert.equal(st.broken[0].status, "Unreachable");
assert.equal(st.broken[0].checkedAt, T(0).toISOString(), "with when it was looked at");
assert.equal(f.settings.get("link_check_cursor"), outside[24], "it remembers where it stopped");
assert.ok(!log.includes(outside[30]), "links past the cap were not touched");

log = [];
r = await runScheduledLinkCheck(f.env, { gather: gatherOf(), check: checker(log, dead), now: T(1) });
assert.deepEqual(log.filter((u) => u.startsWith("http")), outside.slice(25, 50), "the next run carries on from there");
assert.equal(r.notChecked, 10);
st = await getLinkCheckStatus(f.env);
assert.deepEqual(st.broken.map((b) => b.url).sort(), [outside[3], outside[40]].sort(), "yesterday's dead link is still reported (carried forward) and today's is added");
assert.equal(st.broken.find((b) => b.url === outside[3]).checkedAt, T(0).toISOString(), "its date is when it was last actually checked");

log = [];
r = await runScheduledLinkCheck(f.env, { gather: gatherOf(), check: checker(log, dead), now: T(2) });
const third = log.filter((u) => u.startsWith("http"));
assert.deepEqual(third.slice(0, 10), outside.slice(50, 60), "the third run finishes the list");
assert.deepEqual(third.slice(10), outside.slice(0, 15), "and wraps back to the start to fill the batch");
assert.equal(r.notChecked, 0, "now every outside link has been checked at least once");
assert.equal((await getLinkCheckStatus(f.env)).notChecked, 0);

// A link that comes back to life is cleared when it is next looked at, not before.
dead.delete(outside[3]);
log = [];
await runScheduledLinkCheck(f.env, { gather: gatherOf(), check: checker(log, dead), now: T(3) });
assert.deepEqual(log.filter((u) => u.startsWith("http")), outside.slice(15, 40), "the fourth run takes the next 25");
assert.ok(!log.includes(outside[3]), "link 3 is not in this batch");
st = await getLinkCheckStatus(f.env);
assert.ok(st.broken.some((b) => b.url === outside[3]), "so it is still reported, from the earlier look, even though it has come back");
log = [];
await runScheduledLinkCheck(f.env, { gather: gatherOf(), check: checker(log, dead), now: T(4) });
assert.ok(log.includes(outside[3]) && log.includes(outside[40]), "the fifth run covers links 40 to 59 and 0 to 4, which includes both");
st = await getLinkCheckStatus(f.env);
assert.deepEqual(st.broken.map((b) => b.url), [outside[40]], "link 3 is cleared and only the one that is still dead remains");
assert.equal(st.broken[0].checkedAt, T(4).toISOString(), "with the date it was last seen dead");

// A site's own link that is broken is reported every run, however many outside links there are.
log = [];
await runScheduledLinkCheck(f.env, { gather: gatherOf(["/about", "/gone"]), check: checker(log, dead), now: T(5) });
st = await getLinkCheckStatus(f.env);
assert.ok(st.broken.some((b) => b.url === "/gone" && b.status === "Not found" && !("checkedAt" in b)), "an internal broken link is found every run, without a carried date");

// A link taken off the site stops being reported; state does not pile up.
await runScheduledLinkCheck(f.env, { gather: gatherOf([], outside.filter((u) => u !== outside[40])), check: checker([], dead), now: T(6) });
st = await getLinkCheckStatus(f.env);
assert.ok(!st.broken.some((b) => b.url === outside[40]), "removing the page that held the link clears it");
const state = JSON.parse(f.settings.get("link_check_external_state"));
assert.ok(!(outside[40] in state), "and its remembered result is dropped");
assert.ok(Object.keys(state).length <= 59);

// Few outside links: all of them every run.
const g = fakeEnv();
log = [];
await runScheduledLinkCheck(g.env, { gather: gatherOf(["/about"], outside.slice(0, 5)), check: checker(log), now: T(0) });
assert.equal(log.filter((u) => u.startsWith("http")).length, 5);
assert.equal((await getLinkCheckStatus(g.env)).notChecked, 0);

// No outside links at all.
const h = fakeEnv();
r = await runScheduledLinkCheck(h.env, { gather: async () => ({ found: [{ url: "/x", source: "p" }] }), check: checker([]), now: T(0) });
assert.equal(r.outsideTotal, 0);
assert.equal(h.settings.get("link_check_cursor"), "");

// Junk in the stored state is ignored, not trusted.
const j = fakeEnv();
j.settings.set("link_check_external_state", "not json");
await runScheduledLinkCheck(j.env, { gather: gatherOf(["/a"], outside.slice(0, 3)), check: checker([]), now: T(0) });
j.settings.set("link_check_external_state", JSON.stringify([1, 2]));
await runScheduledLinkCheck(j.env, { gather: gatherOf(["/a"], outside.slice(0, 3)), check: checker([]), now: T(1) });
assert.equal((await getLinkCheckStatus(j.env)).notChecked, 0);

// The status of a site that never ran.
const k = fakeEnv();
assert.deepEqual(await getLinkCheckStatus(k.env), { lastAt: null, broken: [], notChecked: 0, perRun: 25 });

console.log("ALL PASS");
