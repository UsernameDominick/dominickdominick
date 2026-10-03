// The Features board: features.json is well formed, requests are cleaned, and the board's lanes, filtering and text export behave.
import fs from "node:fs";
import { createRequire } from "node:module";
import { checkFeatures, cleanRequest, countByStatus, readRequestRow, isRequestId, FEATURE_STATUSES, FEATURE_KINDS, REQUEST_TITLE_MAX } from "../worker/features.js";

const require = createRequire(import.meta.url);
const B = require("../public/admin/features-board.js");
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const doc = JSON.parse(fs.readFileSync(new URL("../features.json", import.meta.url), "utf8"));
const problems = checkFeatures(doc);
ok(problems.length === 0, "features.json is well formed", problems);
ok(doc.items.length > 50, "the list has real content", doc.items.length);
const bad = checkFeatures({ updated: "yesterday", items: [{ id: "A b", title: "", area: "", status: "nope" }, { id: "x", title: "t", area: "a", status: "todo", kind: "decision" }, { id: "x", title: "t", area: "a", status: "done" }, { id: "y", title: "t", area: "a", status: "todo" }, { id: "z", title: "t", area: "a", status: "done", kind: "wat", request: "short", date: "soon" }] });
ok(bad.length >= 10, "problems are reported: bad id, missing title and area, bad status, open without a kind, undecided without a note, duplicate id, bad kind, bad request id, bad dates", bad);
ok(checkFeatures(null).length === 1 && checkFeatures({}).length === 1, "a missing document is one problem, not a crash");
ok(checkFeatures({ updated: "2026-10-03", items: [{ id: "a", title: "t", area: "a", status: "done" }] }).length === 0, "a finished item needs no kind");
const counts = countByStatus(doc.items);
ok(FEATURE_STATUSES.every((s) => s in counts) && Object.values(counts).reduce((a, b) => a + b, 0) === doc.items.length, "every item is counted once", counts);
ok(doc.items.some((i) => i.status === "done") && doc.items.some((i) => i.status === "todo" && i.kind === "decision"), "finished items and ones waiting on the owner both exist");
ok(doc.items.filter((i) => i.status === "doing").length <= 3, "only a few things are marked as being worked on at once", doc.items.filter((i) => i.status === "doing").map((i) => i.title));

// requests
{
  const r = cleanRequest({ title: "  Add   a thing ", notes: "a\r\nb  ", kind: "bug" });
  ok(r.ok && r.value.title === "Add a thing" && r.value.notes === "a\nb" && r.value.status === "todo" && r.value.kind === "bug", "a request is tidied and starts as a to-do", r);
  ok(cleanRequest({ title: "t" }).value.kind === "idea", "a request with no kind is an idea");
  ok(!cleanRequest({ title: "" }).ok && !cleanRequest({}).ok && !cleanRequest(null).ok, "a title is required");
  ok(!cleanRequest({ title: "x".repeat(REQUEST_TITLE_MAX + 1) }).ok, "title length capped");
  ok(!cleanRequest({ title: "t", notes: "n".repeat(1001) }).ok, "notes length capped");
  ok(!cleanRequest({ title: "t", status: "bogus" }).ok && !cleanRequest({ title: "t", kind: "decision" }).ok, "unknown status or kind refused (decision is something only the board sets)");
  const p = cleanRequest({ status: "done" }, { partial: true });
  ok(p.ok && p.value.status === "done" && !("title" in p.value) && !("kind" in p.value), "a partial update changes only what it names", p);
  ok(cleanRequest({ kind: "bug" }, { partial: true }).value.kind === "bug", "a kind can be changed on its own");
  ok(!cleanRequest({ title: "  " }, { partial: true }).ok, "but a blank title is still refused");
  const row = readRequestRow({ key: "feature_request:abcdef123456", value: JSON.stringify({ title: "t", status: "weird", kind: "huh", created_at: "x" }) });
  ok(row && row.id === "abcdef123456" && row.status === "todo" && row.kind === "idea" && row.notes === "", "a stored row reads back, with a bad status or kind repaired", row);
  ok(readRequestRow({ key: "feature_request:abcdef123456", value: JSON.stringify({ title: "t", status: "requested" }) }).status === "todo", "a request saved before kinds existed is a to-do");
  ok(readRequestRow({ key: "feature_request:x", value: "{nope" }) === null && readRequestRow({ key: "other:1", value: "{}" }) === null && readRequestRow({ key: "feature_request:x", value: null }) === null, "broken or foreign rows are skipped");
  ok(isRequestId("abcdef123456") && !isRequestId("ABC") && !isRequestId("abcdef12345g"), "ids are 12 lowercase hex characters");
  ok(FEATURE_KINDS[0] === "decision", "waiting on the owner comes first");
}

// the board
{
  const data = {
    updated: "2026-10-03",
    items: [
      { id: "a", area: "Admin", status: "done", title: "Alpha tool", summary: "Does alpha", date: "2026-09-01" },
      { id: "a2", area: "Admin", status: "done", title: "Newer tool", date: "2026-10-02" },
      { id: "a3", area: "Admin", status: "done", title: "Undated tool" },
      { id: "b", area: "Songs", status: "todo", kind: "idea", title: "Beta", notes: "waiting on cheese" },
      { id: "c", area: "Admin", status: "todo", kind: "decision", title: "Gamma", notes: "pick one" },
      { id: "d", area: "Songs", status: "doing", kind: "attention", title: "Delta" },
      { id: "e", area: "Site", status: "todo", kind: "bug", title: "Epsilon" },
      { id: "f", area: "Site", status: "parked", kind: "idea", title: "Zeta" },
      { id: "picked-up", area: "Requests", request: "aaaaaaaaaaaa", status: "doing", kind: "bug", title: "Claude's name for it", notes: "looking at it" },
      { id: "finished", area: "Requests", request: "bbbbbbbbbbbb", status: "done", kind: "idea", title: "Done request", date: "2026-10-03" },
      { id: "orphan", area: "Requests", request: "cccccccccccc", status: "doing", kind: "idea", title: "Request deleted on the site" },
    ],
    requests: [
      { id: "aaaaaaaaaaaa", title: "My bug report", notes: "it breaks", kind: "bug", status: "todo", created_at: "2026-10-02T10:00:00Z" },
      { id: "bbbbbbbbbbbb", title: "My idea", notes: "", kind: "idea", status: "todo", created_at: "2026-10-01T10:00:00Z" },
      { id: "dddddddddddd", title: "Brand new", notes: "n", kind: "attention", status: "todo", created_at: "2026-10-03T09:00:00Z" },
      { id: "eeeeeeeeeeee", title: "Ticked off by me", notes: "", kind: "idea", status: "done", created_at: "2026-10-03T08:00:00Z" },
      { id: "ffffffffffff", title: "Dropped one", notes: "", kind: "idea", status: "dropped", created_at: "2026-09-30T08:00:00Z" },
    ],
  };
  const board = B.buildBoard(data);
  const titles = (cards) => cards.map((c) => c.title);
  ok(titles(board.todo).join("|") === "Gamma|Epsilon|Brand new|Beta", "to do: waiting on you first, then bugs, then attention, then ideas", titles(board.todo));
  ok(titles(board.doing).join("|") === "My bug report|Delta|Request deleted on the site", "a picked-up request moves to Working on now (the owner's own first)", titles(board.doing));
  const mine = board.doing.find((c) => c.requestId === "aaaaaaaaaaaa");
  ok(mine && mine.title === "My bug report" && mine.picked && mine.mine && mine.notes === "looking at it" && mine.kind === "bug", "it keeps the owner's own title; Claude's note and status win", mine);
  ok(board.done.some((c) => c.title === "My idea" && c.picked) && !board.done.some((c) => c.title === "Done request"), "a request Claude finished shows in Done under its own name, once");
  ok(titles(board.done).join("|") === "My idea|Ticked off by me|Newer tool|Alpha tool|Undated tool", "done: newest first, undated last", titles(board.done));
  ok(board.done.some((c) => c.title === "Ticked off by me" && !c.picked), "a request the owner ticked off is done");
  ok(titles(board.dropped).join() === "Dropped one" && titles(board.parked).join() === "Zeta", "dropped and parked have their own lanes");
  ok(board.doing.some((c) => c.title === "Request deleted on the site" && c.source === "item"), "an entry pointing at a request that no longer exists shows as a normal item");
  ok(!board.todo.some((c) => c.title === "Claude's name for it") && !board.doing.some((c) => c.title === "Claude's name for it"), "the entry that picked a request up is not shown twice");
  ok(titles(board.todo).filter((t) => t === "Brand new").length === 1 && board.todo.find((c) => c.title === "Brand new").mine, "a new request sits in To do as the owner's");
  ok(B.buildBoard({}).todo.length === 0 && B.buildBoard(null).done.length === 0, "an empty board is fine");

  ok(B.filterCards(board.todo, { kind: "bug" }).map((c) => c.title).join() === "Epsilon", "filter by kind");
  ok(B.filterCards(board.done, { q: "ALPHA" }).length === 1, "search ignores case and reads summaries");
  ok(B.filterCards(board.todo, { q: "cheese" }).length === 1, "search reads notes");
  ok(B.filterCards(board.todo, { q: "songs cheese" }).length === 1 && B.filterCards(board.todo, { q: "songs zzz" }).length === 0, "every word has to match (the area counts)");
  ok(B.filterCards(board.todo, { area: "Songs" }).length === 1, "filter by area");
  ok(B.filterCards(board.todo, { q: "idea" }).length >= 1, "the kind's name is searchable too");
  ok(B.groupByKind(board.todo).map((g) => g.kind).join() === "decision,bug,attention,idea", "groups follow the kind order and empty ones are dropped", B.groupByKind(board.todo).map((g) => g.kind));
  ok(B.areasOf(data).join() === "Admin,Requests,Site,Songs", "areas listed once, sorted");

  const text = B.summaryText(data);
  ok(text.includes("Working on now:\n- My bug report [bug] — looking at it (id: aaaaaaaaaaaa)\n- Delta [Songs]"), "the text starts with what is being worked on", text.slice(0, 300));
  ok(text.includes("My new requests, not picked up yet:\n- Brand new [attention] — n (id: dddddddddddd)"), "the owner's new requests come next, with their ids");
  ok(text.includes("Needs your decision:\n- Gamma [Admin] — pick one") && text.includes("Bug:\n- Epsilon [Site]"), "then the rest by kind");
  ok(!text.includes("Alpha tool") && !text.includes("Ticked off by me") && !text.includes("Dropped one"), "finished and dropped items are left out");
  ok(B.filterCards([{ title: "<b>", summary: "", notes: "", area: "A", kind: "idea" }], { q: "<b>" }).length === 1, "markup characters in a search are just text");
}

const html = fs.readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
ok(html.includes("/admin/features-board.js") && html.includes('id="features-btn"') && html.includes('id="features-modal"') && html.includes('id="features-doing"') && html.includes('id="features-done"') && html.includes('id="features-todo"'), "the board is wired into the admin page");
const api = fs.readFileSync(new URL("../worker/admin-api.js", import.meta.url), "utf8");
ok(/path === "\/features" && method === "GET"/.test(api) && /feature-requests/.test(api), "the admin API has the board's routes");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
