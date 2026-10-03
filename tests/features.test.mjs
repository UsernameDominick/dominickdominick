// The Features board: features.json is well formed, requests are cleaned, and the board's filtering and text export behave.
import fs from "node:fs";
import { createRequire } from "node:module";
import { checkFeatures, cleanRequest, countByStatus, readRequestRow, isRequestId, FEATURE_STATUSES, REQUEST_TITLE_MAX } from "../worker/features.js";

const require = createRequire(import.meta.url);
const B = require("../public/admin/features-board.js");
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const doc = JSON.parse(fs.readFileSync(new URL("../features.json", import.meta.url), "utf8"));
const problems = checkFeatures(doc);
ok(problems.length === 0, "features.json is well formed", problems);
ok(doc.items.length > 50, "the list has real content", doc.items.length);
ok(checkFeatures({ items: [{ id: "A b", title: "", area: "", status: "nope" }, { id: "x", title: "t", area: "a", status: "decision" }, { id: "x", title: "t", area: "a", status: "done" }], updated: "yesterday" }).length >= 6, "problems are reported: bad id, missing title and area, bad status, undecided without a note, duplicate id, bad date");
ok(checkFeatures(null).length === 1 && checkFeatures({}).length === 1, "a missing document is one problem, not a crash");
const counts = countByStatus(doc.items);
ok(FEATURE_STATUSES.every((s) => s in counts) && Object.values(counts).reduce((a, b) => a + b, 0) === doc.items.length, "every item is counted once", counts);
ok(doc.items.some((i) => i.status === "done") && doc.items.some((i) => i.status === "decision"), "both finished and waiting items exist");

// requests
{
  const r = cleanRequest({ title: "  Add   a thing ", notes: "a\r\nb  " });
  ok(r.ok && r.value.title === "Add a thing" && r.value.notes === "a\nb" && r.value.status === "requested", "a request is tidied and starts as requested", r);
  ok(!cleanRequest({ title: "" }).ok && !cleanRequest({}).ok && !cleanRequest(null).ok, "a title is required");
  ok(!cleanRequest({ title: "x".repeat(REQUEST_TITLE_MAX + 1) }).ok, "title length capped");
  ok(!cleanRequest({ title: "t", notes: "n".repeat(1001) }).ok, "notes length capped");
  ok(!cleanRequest({ title: "t", status: "bogus" }).ok, "unknown status refused");
  const p = cleanRequest({ status: "done" }, { partial: true });
  ok(p.ok && p.value.status === "done" && !("title" in p.value), "a partial update changes only what it names", p);
  ok(!cleanRequest({ title: "  " }, { partial: true }).ok, "but a blank title is still refused");
  const row = readRequestRow({ key: "feature_request:abcdef123456", value: JSON.stringify({ title: "t", status: "weird", created_at: "x" }) });
  ok(row && row.id === "abcdef123456" && row.status === "requested" && row.notes === "", "a stored row reads back, with a bad status repaired", row);
  ok(readRequestRow({ key: "feature_request:x", value: "{nope" }) === null && readRequestRow({ key: "other:1", value: "{}" }) === null && readRequestRow({ key: "feature_request:x", value: null }) === null, "broken or foreign rows are skipped");
  ok(isRequestId("abcdef123456") && !isRequestId("ABC") && !isRequestId("abcdef12345g"), "ids are 12 lowercase hex characters");
}

// the board
{
  const items = [
    { id: "a", area: "Admin", status: "done", title: "Alpha tool", summary: "Does alpha" },
    { id: "b", area: "Songs", status: "planned", title: "Beta", notes: "waiting on cheese" },
    { id: "c", area: "Admin", status: "decision", title: "Gamma", notes: "pick one" },
    { id: "d", area: "Songs", status: "doing", title: "Delta" },
  ];
  ok(B.filterItems(items, {}).length === 4 && B.filterItems(items, { status: "all" }).length === 4, "no filter shows everything");
  ok(B.filterItems(items, { status: "done" }).map((i) => i.id).join() === "a", "filter by status");
  ok(B.filterItems(items, { area: "Songs" }).map((i) => i.id).join() === "b,d", "filter by area");
  ok(B.filterItems(items, { q: "ALPHA" }).map((i) => i.id).join() === "a", "search ignores case and reads summaries");
  ok(B.filterItems(items, { q: "cheese" }).map((i) => i.id).join() === "b", "search reads notes");
  ok(B.filterItems(items, { q: "songs cheese" }).map((i) => i.id).join() === "b", "every word has to match (the area counts)");
  ok(B.filterItems(items, { q: "zzz" }).length === 0, "no match is an empty list");
  ok(B.groupByStatus(items).map((g) => g.status).join() === "decision,doing,planned,done", "what needs you comes first, finished last");
  ok(B.groupByStatus([]).length === 0, "empty groups are dropped");
  ok(B.areasOf(items).join() === "Admin,Songs", "areas listed once, sorted");
  const text = B.summaryText({ updated: "2026-10-03", items, requests: [{ title: "Mine", notes: "line one\nline two", status: "requested" }, { title: "Old", notes: "", status: "done" }] });
  ok(text.includes("Needs your decision:\n- Gamma [Admin] — pick one") && text.includes("In progress:\n- Delta [Songs]"), "the text lists open items with notes");
  ok(!text.includes("Alpha tool"), "finished items are left out of the text");
  ok(text.includes("My requests:\n- Mine — line one line two") && !text.includes("Old"), "open requests are included, finished ones are not");
  ok(B.filterItems([{ id: "x", area: "A", status: "done", title: "<b>" }], { q: "<b>" }).length === 1, "markup characters in a search are just text");
}

const html = fs.readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
ok(html.includes('/admin/features-board.js') && html.includes('id="features-btn"') && html.includes('id="features-modal"'), "the board is wired into the admin page");
const api = fs.readFileSync(new URL("../worker/admin-api.js", import.meta.url), "utf8");
ok(/path === "\/features" && method === "GET"/.test(api) && /feature-requests/.test(api), "the admin API has the board's routes");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
