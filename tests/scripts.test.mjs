// The Scripts window: what is stored, what a script may call, the editing rules of the code editor, and the helpers a script sees.
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { cleanScript, cleanGraph, readScriptRow, isScriptId, SCRIPT_CODE_MAX } from "../worker/scripts.js";

const require = createRequire(import.meta.url);
const P = require("../public/admin/script-policy.js");
const E = require("../public/admin/script-editor.js");
const R = require("../public/admin/script-runner.js");
const T = require("../public/admin/script-templates.js");

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

// ---- storage
{
  ok(cleanScript({ name: "  Tag  all ", code: "x\r\ny" }).value.name === "Tag all", "name is trimmed and spaces squashed");
  ok(cleanScript({ name: "a", code: "x\r\ny" }).value.code === "x\ny", "line endings normalised");
  ok(!cleanScript({ name: "", code: "x" }).ok && !cleanScript({ code: "x" }).ok, "a name is required");
  ok(!cleanScript({ name: "a" }).ok && !cleanScript({ name: "a", code: 5 }).ok, "code must be text");
  ok(!cleanScript({ name: "a".repeat(61), code: "" }).ok, "name length capped");
  ok(cleanScript({ name: "a", code: "" }).ok, "an empty script can be saved");
  ok(!cleanScript({ name: "a", code: "é".repeat(SCRIPT_CODE_MAX / 2 + 1) }).ok, "size is counted in bytes, not characters");
  ok(!cleanScript({ name: "a", code: "", description: "d".repeat(301) }).ok, "description capped");
  ok(!cleanScript(null).ok, "null body refused, not thrown");
  const row = readScriptRow({ key: "admin_script:abcdef123456", value: JSON.stringify({ name: "n", code: "c", updated_at: "t" }) });
  ok(row && row.id === "abcdef123456" && row.name === "n" && row.description === "", "a stored row reads back");
  ok(readScriptRow({ key: "admin_script:x", value: "{nope" }) === null && readScriptRow({ key: "other:x", value: "{}" }) === null, "broken or foreign rows are skipped");
  ok(isScriptId("abcdef123456") && !isScriptId("ABCDEF123456") && !isScriptId("abc"), "ids are 12 lowercase hex characters");
}

// ---- node graphs
{
  const good = { version: 1, nodes: [{ id: "n1", type: "start", x: 10.4, y: 20, values: {}, props: {} }, { id: "n2", type: "set-setting", x: 300, y: 20, values: { value: "#fff" }, props: { key: "theme_accent" } }], wires: [{ from: { node: "n1", pin: "then" }, to: { node: "n2", pin: "in" } }], view: { x: 1, y: 2, zoom: 1.5 } };
  const g = cleanGraph(good);
  ok(g.ok && g.value.nodes[0].x === 10 && g.value.view.zoom === 1.5, "a graph is accepted and its positions rounded", g.ok);
  ok(cleanScript({ name: "n", code: "", graph: good }).value.graph.nodes.length === 2, "a script keeps its graph");
  ok(cleanScript({ name: "n", code: "", graph: null }).value.graph === undefined && cleanScript({ name: "n", code: "" }).value.graph === undefined, "no graph, no graph field");
  ok(!cleanScript({ name: "n", code: "", graph: 5 }).ok && !cleanGraph([]).ok && !cleanGraph({ nodes: {}, wires: [] }).ok, "something that is not a graph is refused");
  ok(!cleanGraph({ ...good, nodes: [good.nodes[0], good.nodes[0]] }).ok, "a repeated node id is refused");
  ok(!cleanGraph({ ...good, nodes: [{ ...good.nodes[0], id: "has space" }] }).ok && !cleanGraph({ ...good, nodes: [{ ...good.nodes[0], id: "a-b_C9" }], wires: [] }).ok === false, "node ids must be plain words");
  ok(!cleanGraph({ ...good, nodes: [{ ...good.nodes[0], type: "Bad Type" }] }).ok, "node types must be plain words");
  ok(!cleanGraph({ ...good, nodes: [{ ...good.nodes[0], x: "10" }] }).ok && !cleanGraph({ ...good, nodes: [{ ...good.nodes[0], y: 1e9 }] }).ok, "positions must be sensible numbers");
  ok(!cleanGraph({ ...good, nodes: [{ ...good.nodes[0], values: { v: { a: 1 } } }] }).ok && !cleanGraph({ ...good, nodes: [{ ...good.nodes[0], props: [] }] }).ok, "values must be plain text, numbers or yes/no");
  ok(!cleanGraph({ ...good, nodes: [{ ...good.nodes[0], values: { v: "x".repeat(20001) } }] }).ok, "a value is capped in length");
  ok(!cleanGraph({ ...good, wires: [{ from: { node: "n1", pin: "then" }, to: { node: "ghost", pin: "in" } }] }).ok, "a wire to a missing node is refused");
  ok(!cleanGraph({ ...good, wires: [{ from: { node: "n1", pin: "a b" }, to: { node: "n2", pin: "in" } }] }).ok, "pin ids must be plain words");
  const many = { nodes: Array.from({ length: 301 }, (_, i) => ({ id: "n" + i, type: "start", x: 0, y: 0 })), wires: [] };
  ok(!cleanGraph(many).ok, "300 nodes at most");
  ok(!cleanGraph({ nodes: [], wires: Array.from({ length: 1001 }, () => ({})) }).ok, "1000 wires at most");
  const row = readScriptRow({ key: "admin_script:abcdef123456", value: JSON.stringify({ name: "n", code: "c", graph: good }) });
  ok(row.graph && row.graph.nodes.length === 2, "a stored graph reads back");
  ok(readScriptRow({ key: "admin_script:abcdef123456", value: JSON.stringify({ name: "n", code: "c", graph: "junk" }) }).graph === null, "a damaged graph reads as none");
  ok(cleanGraph({ ...good, view: { x: 1, y: 2, zoom: 9 } }).value.view.zoom === 1, "an out-of-range zoom is reset");
}

// ---- policy
{
  const c = (m, p) => P.checkCall(m, p);
  ok(c("GET", "/articles").ok && !c("GET", "/articles").write, "reading articles is allowed");
  ok(c("GET", "/articles?limit=5").ok, "a query string is fine");
  ok(c("PATCH", "/articles/5").ok && c("PATCH", "/articles/5").write, "changing an article is a write");
  ok(c("POST", "/articles").ok && c("DELETE", "/redirects/3").ok && c("PUT", "/settings").ok && c("PUT", "/pages/3/css").ok, "content routes are writable");
  ok(c("DELETE", "/articles/5/permanent").destructive === true, "permanent delete is flagged");
  ok(c("POST", "/media/bulk-delete").ok && c("POST", "/media/bulk-delete").destructive, "bulk media delete is flagged");
  ok(c("DELETE", "/articles/5").destructive === false, "moving to Trash is not flagged");
  for (const [m, p] of [["POST", "/login"], ["GET", "/logout"], ["POST", "/import"], ["POST", "/scheduled-backups-restore"], ["POST", "/history-orphans/purge"], ["POST", "/upload"], ["GET", "/scripts"], ["PUT", "/scripts/abcdef123456"], ["DELETE", "/scripts/abcdef123456"], ["POST", "/client-error"]]) {
    ok(!c(m, p).ok, `${m} ${p} is blocked`);
  }
  ok(!c("PATCH", "/media/uploads/x.png").ok && !c("DELETE", "/media/uploads/x.png").ok, "single media files can be read, not changed");
  ok(!c("PATCH", "/something-new").ok, "an unknown route is read-only");
  ok(c("GET", "/something-new").ok, "but readable");
  for (const p of ["//evil.com/x", "https://evil.com", "articles", "/articles/../login", "/articles/%2e%2e/login", "/a b", "/articles/", "", null, undefined, 5, "/x\\y", "/a\nb"]) {
    ok(!c("GET", p).ok, `${JSON.stringify(p)} is not a valid path`);
  }
  ok(!c("TRACE", "/articles").ok, "odd methods refused");
  ok(c("get", "/articles").ok, "method case does not matter");
  ok(P.isSettingsSave("PUT", "/settings") && P.isSettingsSave("put", "/settings?x=1") && !P.isSettingsSave("GET", "/settings") && !P.isSettingsSave("PUT", "/pages/3/css") && !P.isSettingsSave("PUT", "//settings"), "a settings save is recognised");
  const merged = P.mergeSettings({ theme_bg: "#000", theme_accent: "#f00", site_brand: "X" }, { theme_accent: "#0f0" });
  ok(merged.theme_bg === "#000" && merged.site_brand === "X" && merged.theme_accent === "#0f0", "a settings save keeps what it does not mention", merged);
  ok(P.mergeSettings(null, { a: 1 }).a === 1 && Object.keys(P.mergeSettings({ a: 1 }, null)).length === 1, "and copes with nothing on either side");
  ok(P.describeCall("PATCH", "/articles/5", { tags: ["a"], title: "t", expected_version: 3 }) === "PATCH /articles/5 (tags, title)", "a change is summarised by the fields it touches");
  ok(P.describeCall("DELETE", "/articles/5") === "DELETE /articles/5", "no fields, no brackets");
}

// ---- editor rules
{
  const enter = (t, s, e = s) => E.enterEdit(t, s, e);
  let r = enter("  foo(", 6);
  ok(r.text === "  foo(\n    " && r.start === r.text.length, "Enter after an opening bracket indents one level deeper", r);
  r = enter("{}", 1);
  ok(r.text === "{\n  \n}" && r.start === 4, "Enter between {} opens the pair onto three lines", r);
  r = enter("    x = 1", 9);
  ok(r.text === "    x = 1\n    ", "Enter keeps the indentation");
  r = enter("a b", 1, 2);
  ok(r.text === "a\nb", "Enter over a selection replaces it");

  let t = E.tabEdit("ab", 1, 1, false);
  ok(t.text === "a  b" && t.start === 3, "Tab at a caret inserts two spaces");
  t = E.tabEdit("a\nb\nc", 0, 5, false);
  ok(t.text === "  a\n  b\n  c" && t.start === 2 && t.end === 11, "Tab on a selection indents every line", t);
  t = E.tabEdit("  a\n    b", 0, 9, true);
  ok(t.text === "a\n  b", "Shift+Tab outdents", t);
  t = E.tabEdit("a\nb", 0, 0, true);
  ok(t.text === "a\nb", "Shift+Tab with nothing to remove changes nothing");
  t = E.tabEdit("a\nb\n", 0, 4, false);
  ok(t.text === "  a\n  b\n", "a selection ending after a newline does not indent the line below");

  let c = E.commentEdit("a\n  b", 0, 5);
  ok(c.text === "// a\n  // b", "Ctrl+/ comments each line at its indentation", c);
  c = E.commentEdit(c.text, c.start, c.end);
  ok(c.text === "a\n  b", "and uncomments them again", c);
  c = E.commentEdit("a\n\nb", 0, 4);
  ok(c.text === "// a\n\n// b", "blank lines are left alone");

  ok(E.typeEdit("", 0, 0, "(").text === "()" && E.typeEdit("", 0, 0, "(").start === 1, "typing ( adds the partner");
  ok(E.typeEdit("()", 1, 1, ")").start === 2 && E.typeEdit("()", 1, 1, ")").text === "()", "typing ) steps over the partner");
  ok(E.typeEdit("don", 3, 3, "'") === null, "an apostrophe after a word is left alone");
  ok(E.typeEdit("", 0, 0, '"').text === '""', "a quote at the start of a word pairs");
  ok(E.typeEdit("x", 0, 0, "(") === null, "no pair before a word character");
  ok(E.typeEdit("abc", 0, 3, "(").text === "(abc)", "typing a bracket over a selection wraps it");
  ok(E.typeEdit("", 0, 0, "a") === null, "ordinary letters are untouched");
  ok(E.backspaceEdit("()", 1, 1).text === "" && E.backspaceEdit("(x)", 1, 1) === null, "Backspace removes an empty pair only");

  ok(E.completionContext("await site.", 11).base === "" && E.completionContext("await site.", 11).prefix === "", "`site.` completes the helper names");
  ok(E.completionContext("site.art", 8).prefix === "art" && E.completionContext("site.art", 8).from === 5, "a partly typed name");
  ok(E.completionContext("site.articles.", 14).base === "articles", "`site.articles.` completes its methods");
  ok(E.completionContext("mysite.", 7) === null && E.completionContext("foo.site.", 9) === null, "only the real site object completes");
  ok(E.suggestions(E.completionContext("site.art", 8)).map((s) => s.name).join() === "articles", "prefix filters the list");
  const names = E.suggestions(E.completionContext("site.articles.", 14)).map((s) => s.name);
  ok(["list", "get", "create", "update", "remove"].every((n) => names.includes(n)), "article methods are listed", names);
  ok(E.suggestions(E.completionContext("site.articles.list", 18)).length === 0, "a finished name offers nothing more");
  ok(E.suggestions(E.completionContext("site.nonsense.", 14)).length === 0, "unknown objects offer nothing");

  const h = E.highlight('const a = "x<y" // note <b>\nawait site.get(1)');
  ok(h.includes('<span class="ce-keyword">const</span>') && h.includes('<span class="ce-string">&quot;') === false && h.includes("&lt;"), "keywords coloured and markup escaped", h);
  ok(h.includes('<span class="ce-comment">// note &lt;b&gt;</span>') && h.includes('<span class="ce-global">site</span>'), "comments and the site object coloured");
  ok(E.highlight("a.site").includes("ce-global") === false, "a property named site is not the site object");
  ok(E.highlight("`unterminated").includes("ce-string") && E.highlight("/* open").includes("ce-comment"), "unterminated strings and comments do not throw");
  ok(E.highlight("<script>alert(1)</script>").includes("<script>") === false, "page markup in code is escaped");
}

// ---- the helpers a script sees (the worker's side, driven with a fake port)
async function runScript(code, { dry = true, answer } = {}) {
  const sent = [];
  const logs = [];
  let done = null;
  // The fake global is also `self`, as in a real worker, so removing `fetch` from it removes it for the script too.
  const self = { setTimeout, JSON, Object, Array, Map, Set, Math, Number, String, Error, Promise };
  self.self = self;
  const port = {
    postMessage(m) {
      if (m.t === "call") {
        sent.push(m);
        const data = answer ? answer(m) : { ok: true };
        if (data && data.__error) setTimeout(() => port.onmessage({ data: { id: m.id, ok: false, error: data.__error, status: 400 } }), 0);
        else setTimeout(() => port.onmessage({ data: { id: m.id, ok: true, data } }), 0);
      } else if (m.t === "log") logs.push(m);
      else if (m.t === "done") done = m;
    },
    onmessage: null,
  };
  const ctx = vm.createContext(self);
  const { source, offset } = R.buildSource(code);
  vm.runInContext(source, ctx);
  self.onmessage({ data: { port, dry } });
  for (let i = 0; i < 200 && !done; i++) await new Promise((r) => setTimeout(r, 5));
  return { sent, logs, done, offset, self };
}

{
  let r = await runScript(`await site.articles.update(5, { tags: ["a"] }); await site.redirects.create({ from_path: "/a", to_path: "/b" }); return 7;`);
  ok(r.done && r.done.ok && r.done.value === "7", "a script runs and its return value comes back", r.done);
  ok(r.sent[0].method === "PATCH" && r.sent[0].path === "/articles/5" && r.sent[0].body.tags[0] === "a", "articles.update is PATCH /articles/:id", r.sent[0]);
  ok(r.sent[1].method === "POST" && r.sent[1].path === "/redirects", "redirects.create is POST /redirects");

  r = await runScript(`const a = await site.articles.get(2); console.log(a && a.title);`, { answer: () => [{ id: 1, title: "one" }, { id: 2, title: "two" }] });
  ok(r.sent.length === 1 && r.sent[0].path === "/articles" && r.logs[0].text === "two", "get on a type with no single-item route reads the list and finds it", r.logs);

  r = await runScript(`await site.songs.get(3); await site.articles.list({ tag: "a b", n: undefined });`);
  ok(r.sent[0].path === "/songs/3" && r.sent[1].path === "/articles?tag=a%20b", "single-item routes and query strings are built", r.sent.map((s) => s.path));

  r = await runScript(`console.log("hi", { a: 1 }, [1]); console.warn("w"); console.error(new Error("e"));`);
  ok(r.logs.length === 3 && r.logs[0].text === 'hi {\n  "a": 1\n} [\n  1\n]' && r.logs[1].level === "warn" && r.logs[2].level === "error", "console output is formatted and levelled", r.logs.map((l) => l.text));

  r = await runScript(`await fetch("/api/admin/settings");`);
  ok(r.done && !r.done.ok && /isn't available in scripts/.test(r.done.error.message), "fetch is refused with a pointer to site.api", r.done);
  r = await runScript(`new WebSocket("wss://x");`);
  ok(r.done && !r.done.ok, "so are the other network doors");

  r = await runScript(`\nconst x = 1;\nthrow new Error("boom");\n`);
  const line = r.done.error.lines.map((n) => (n > r.offset ? n - r.offset : null)).find((n) => n !== null);
  ok(r.done && !r.done.ok && r.done.error.message === "boom" && line === 3, "an error reports the line in the script, not in the wrapper", { line, lines: r.done.error.lines, offset: r.offset });

  r = await runScript(`\n\nawait site.articles.update(5, {});\n`, { answer: () => ({ __error: "The server said no" }) });
  const failLine = r.done.error.lines.map((n) => (n > r.offset ? n - r.offset : null)).find((n) => n !== null);
  ok(r.done && !r.done.ok && r.done.error.message === "The server said no" && failLine === 3, "a failed request is traced back to the line of the script that made it", { failLine, lines: r.done.error.lines, offset: r.offset });

  r = await runScript(`await site.each([1, 2, 3, 4, 5], async (n) => { await site.sleep(1); await site.post("/redirects", { n }); }, { concurrency: 2 });`);
  ok(r.done.ok && r.sent.length === 5, "site.each runs every item", r.sent.length);
  r = await runScript(`return site.slugify("  Héllo, Wörld! 2 ") + "|" + site.dryRun;`, { dry: false });
  ok(r.done.value === '"hello-world-2|false"', "slugify and dryRun", r.done.value);
  r = await runScript(`await site.api("POST", "/articles", { f() {} });`);
  ok(r.sent.length === 1 && r.sent[0].body.f === undefined, "request bodies are reduced to plain data");
  r = await runScript(`const o = {}; o.o = o; await site.api("POST", "/articles", o);`);
  ok(r.done && !r.done.ok && /plain data/.test(r.done.error.message), "a circular body is a clear error, not a crash");
  r = await runScript(`return undefined;`);
  ok(r.done.ok && r.done.value === undefined, "no return value, nothing shown");
}

// ---- starter scripts all at least parse (top-level await and all)
{
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const t of T.TEMPLATES) {
    let err = null;
    try { new AsyncFunction("site", "console", t.code); } catch (e) { err = e.message; }
    ok(!err, `template "${t.name}" parses`, err);
  }
  ok(new Set(T.TEMPLATES.map((t) => t.id)).size === T.TEMPLATES.length, "template ids are unique");
  ok(T.TEMPLATES[0].id === "blank", "the blank script comes first");
  const used = new Set();
  for (const t of T.TEMPLATES) for (const m of t.code.matchAll(/site\.([a-zA-Z]+)\.([a-zA-Z]+)\(/g)) used.add(`site.${m[1]}.${m[2]}`);
  const known = new Set(E.SDK_DOCS.map((d) => d[0]));
  for (const u of used) ok(known.has(u), `${u} used by a template is a documented helper`);
}

// ---- wiring
{
  const html = fs.readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  for (const f of ["script-policy.js", "script-runner.js", "script-editor.js", "script-templates.js"]) ok(html.includes(`/admin/${f}`), `${f} is loaded by the admin`);
  const api = fs.readFileSync(new URL("../worker/admin-api.js", import.meta.url), "utf8");
  ok(/path === "\/scripts" && method === "GET"/.test(api) && /scriptMatch && method === "DELETE"/.test(api), "the admin API has the script routes");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
