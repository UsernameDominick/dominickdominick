// The temporary Study block (worker/study/): the password check, the unlock route, and what a page shows.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { samePassword, expectedPassword, gatePassword, handleStudyUnlock, renderStudyBlock, studyPageTags, STUDY_LABS } from "../worker/study/index.js";
import { withBridge, LAB_BRIDGES } from "../worker/study/bridges.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

// A small stand-in for D1: block rows by id, a rate-limit count, and a log of every statement.
function makeEnv({ blocks = {}, used = 0, extra = {} } = {}) {
  const log = [];
  const DB = {
    prepare(sql) {
      const stmt = {
        args: [],
        bind(...a) { stmt.args = a; return stmt; },
        async first() { log.push(["first", sql, stmt.args]); return /FROM blocks b LEFT JOIN shared_blocks/.test(sql) ? blocks[stmt.args[0]] || null : null; },
        async all() { log.push(["all", sql, stmt.args]); return { results: [{ n: used }] }; },
        async run() { log.push(["run", sql, stmt.args]); return {}; },
      };
      return stmt;
    },
  };
  return { DB, log, __studyLabs: { "core1-lab": "<!DOCTYPE html><title>LAB</title>" }, ...extra };
}
const row = (content, type = "study") => ({ type, content: JSON.stringify(content), shared_type: null, shared_content: null });
const call = (env, body, { raw, ip = "1.2.3.4" } = {}) =>
  handleStudyUnlock(new Request("https://x.test/api/study/unlock", { method: "POST", headers: { "CF-Connecting-IP": ip, "Content-Type": "application/json" }, body: raw !== undefined ? raw : JSON.stringify(body) }), env);
const hits = (env) => env.log.filter((l) => l[0] === "run" && /INSERT INTO rate_limits/.test(l[1]));

// ---- the password check ----
ok(await samePassword("Tulip", "Tulip") && await samePassword("123", "123"), "the right password matches");
ok(await samePassword("tulip", "Tulip") && await samePassword("TULIP", "Tulip"), "capital letters do not matter (a phone capitalises the first one)");
ok(await samePassword("  Tulip \n", "Tulip") && await samePassword(" 123 ", "123"), "spaces around it do not matter");
ok(!(await samePassword("Tulips", "Tulip")) && !(await samePassword("124", "123")), "a near miss does not match");
ok(!(await samePassword("", "Tulip")) && !(await samePassword("Tul", "Tulip")) && !(await samePassword("Tulip!", "Tulip")) && !(await samePassword("", "123")) && !(await samePassword("12", "123")) && !(await samePassword("1234", "123")), "empty, short and long guesses do not match");
ok(await samePassword("café", "café"), "the same word typed two ways (composed or not) matches");
ok(!(await samePassword(null, "123")) && !(await samePassword(undefined, "x")) && !(await samePassword(12345, "123")), "junk input never matches");
ok(await samePassword(12345, "12345"), "numbers are compared as text");

// ---- which password a block wants ----
ok(expectedPassword({}, {}) === "123", "no password set: the default (123)");
ok(expectedPassword({}, { password: "   " }) === "123", "a blank password box: the default");
ok(expectedPassword({}, { password: " mine " }) === "mine", "the block's own password wins (trimmed)");
ok(expectedPassword({ STUDY_PASSWORD: "envpw" }, {}) === "envpw", "an STUDY_PASSWORD variable replaces the default");
ok(expectedPassword({ STUDY_PASSWORD: "envpw" }, { password: "mine" }) === "mine", "but not a block's own password");
ok(expectedPassword(undefined, undefined) === "123", "nothing at all still works");

// ---- every block asks ----
ok(gatePassword({}, undefined) === "123" && gatePassword({}, {}) === "123" && gatePassword({}, { requirePassword: false }) === "123", "every block asks: the default when nothing is set (the old tick no longer matters)");
ok(gatePassword({}, { password: " mine " }) === "mine", "a block's own password is the one");
ok(gatePassword({ STUDY_PASSWORD: "envpw" }, {}) === "envpw", "else the STUDY_PASSWORD variable");

// ---- the route ----
{
  const env = makeEnv({ blocks: { 7: row({ lab: "core1-lab", requirePassword: true }) } });
  const res = await call(env, { block: 7, password: " 123 " });
  const served = await res.text();
  ok(res.status === 200 && served.startsWith("<!DOCTYPE html><title>LAB</title>") && served.includes('study: "ready"'), "the right password returns the study page, with its progress bridge added");
  ok(/^text\/html/.test(res.headers.get("Content-Type")) && res.headers.get("Cache-Control") === "no-store" && res.headers.get("X-Robots-Tag") === "noindex", "as HTML, never cached, never indexed");
  ok(hits(env).length === 0, "a right password does not count against the limit");
}
{
  const env = makeEnv({ blocks: { 7: row({ requirePassword: true }) } });
  const res = await call(env, { block: 7, password: "nope" });
  const body = await res.json();
  ok(res.status === 401 && /isn't right/.test(body.error) && body.needsPassword === true && !JSON.stringify(body).includes("123"), "a wrong password is a 401 that does not give the answer away", body);
  ok(hits(env).length === 1 && hits(env)[0][2][0] === "study" && hits(env)[0][2][1] === "1.2.3.4", "and counts as one try for that visitor");
  ok(res.headers.get("Cache-Control") === "no-store", "errors are not cached either");
}
{
  const env = makeEnv({ blocks: { 7: row({ text: "x" }, "text") } });
  const res = await call(env, { block: 7, password: "123" });
  ok(res.status === 404 && hits(env).length === 1, "a block that is not a Study block is a 404 even with the right password, and counts as a try");
}
for (const [label, id] of [["missing", 99], ["text", "abc"], ["negative", -3], ["zero", 0], ["fraction", 1.5], ["null", null]]) {
  const env = makeEnv({ blocks: { 7: row({}) } });
  const res = await call(env, { block: id, password: "123" });
  ok(res.status === 404, `a ${label} block id is a 404`, res.status);
}
{
  const env = makeEnv({ blocks: { 7: { type: "text", content: "{}", shared_type: "study", shared_content: JSON.stringify({ password: "abc", requirePassword: true }) } } });
  ok((await call(env, { block: 7, password: "abc" })).status === 200, "a reusable (shared) Study block uses the shared content");
  ok((await call(env, { block: 7, password: "123" })).status === 401, "and its own password, not the default");
}
{
  const env = makeEnv({ blocks: { 7: row({ password: "mine", requirePassword: true }) } });
  ok((await call(env, { block: 7, password: "mine" })).status === 200 && (await call(env, { block: 7, password: "123" })).status === 401, "with a password set on the block, the default no longer works");
}
{
  const env = makeEnv({ blocks: { 7: row({ lab: "nope", requirePassword: true }) } });
  ok((await call(env, { block: 7, password: "123" })).status === 200, "an unknown study page name falls back to the one that exists");
}
{
  const env = makeEnv({ blocks: { 7: { type: "study", content: "{not json", shared_type: null, shared_content: null } } });
  ok((await call(env, { block: 7, password: "123" })).status === 200 && (await call(env, { block: 7 })).status === 401, "damaged block content still works, with the default password");
}
{
  const env = makeEnv({ blocks: { 7: row({ requirePassword: true }) }, used: 8 });
  const res = await call(env, { block: 7, password: "123" });
  ok(res.status === 429 && /Too many/.test((await res.json()).error), "after 8 tries in the window even the right password is refused (429)");
  ok(hits(env).length === 0, "without recording more");
  const env2 = makeEnv({ blocks: { 7: row({ requirePassword: true }) }, used: 7 });
  ok((await call(env2, { block: 7, password: "123" })).status === 200, "the 8th try is still allowed");
  const win = env2.log.find((l) => l[0] === "all");
  ok(/-15 minutes/.test(win[1]) && win[2][0] === "study", "the window is 15 minutes, in its own bucket", win[1].match(/-\d+ minutes/));
}
for (const [label, opts] of [["not JSON", { raw: "not json" }], ["an array", { raw: "[1]" }], ["null", { raw: "null" }], ["a string", { raw: '"hi"' }], ["empty", { raw: "" }], ["huge", { raw: JSON.stringify({ block: 7, password: "a".repeat(3000) }) }]]) {
  const env = makeEnv({ blocks: { 7: row({}) } });
  const res = await call(env, null, opts);
  ok(res.status === 400, `a request body that is ${label} is a 400`, res.status);
}
{
  const env = makeEnv({ blocks: { 7: row({ requirePassword: true }) } });
  for (const pw of [undefined, null, 5, {}, [], true]) {
    const res = await call(env, { block: 7, password: pw });
    if (res.status !== 401) ok(false, `a ${JSON.stringify(pw)} password is refused`, res.status);
  }
  ok(true, "a missing or non-text password is always refused");
  const long = await call(makeEnv({ blocks: { 7: row({ requirePassword: true }) } }), { block: 7, password: "123" + "x".repeat(500) });
  ok(long.status === 401, "a very long guess is refused, not matched on its first part");
}

// ---- a block left without the tick still asks ----
for (const [label, content] of [["no settings", {}], ["a password typed but not ticked", { password: "mine" }], ["ticked off", { requirePassword: false }]]) {
  const env = makeEnv({ blocks: { 7: row(content) } });
  ok((await call(env, { block: 7, password: "anything" })).status === 401, `${label}: a wrong password is refused`);
  ok((await call(env, { block: 7, password: content.password || "123" })).status === 200, `${label}: its password opens it`);
}
{
  const env = makeEnv({ blocks: { 7: row({ requirePassword: true }) } });
  for (const body of [{ block: 7 }, { block: 7, password: "" }, { block: 7, password: "   " }]) {
    const res = await call(env, body);
    const j = await res.json();
    ok(res.status === 401 && j.needsPassword === true && /Type the password/.test(j.error), `a block that asks, asked with no password (${JSON.stringify(body)}): 401 saying so`);
  }
  ok(hits(env).length === 0, "and an empty ask is not a guess, so it does not count against the limit");
}
{
  const env = makeEnv({ blocks: { 7: row({}) } });
  ok((await call(env, { block: 99 })).status === 404, "an open block's id is still needed: an unknown block is still a 404");
}

// ---- what a page shows ----
{
  const html = renderStudyBlock({ label: "Open <b>lab</b>", lab: "core1-lab", password: "topsecret", html: "<x>" }, 42, esc);
  ok(html.includes('data-study-block="42"') && html.includes('class="study-block"') && html.includes("study-open"), "the block is a button carrying its id");
  ok(!html.includes("topsecret") && !html.includes("123") && !html.includes("<x>"), "the password (the block's or the default) and any extra settings never reach the page");
  ok(html.includes("Open &lt;b&gt;lab&lt;/b&gt;") && !html.includes("<b>lab"), "the button text is escaped");
  ok(html.includes('data-study-title="A+ Core 1 Drill"'), "the popup's title comes from the study page's name");
  ok(html.includes('data-study-lab="core1-lab"') && renderStudyBlock({ lab: "bad" }, 3, esc).includes('data-study-lab="core1-lab"'), "and it names the study page (progress is kept per study page), falling back to the one that exists");
  ok(renderStudyBlock({}, 3, esc).includes(">Open study<"), "no button text: a sensible default");
  ok(renderStudyBlock(null, 3, esc).includes("study-open") && renderStudyBlock({ label: "x".repeat(300) }, 3, esc).includes(">" + "x".repeat(80) + "<"), "missing content and very long text are handled");
  ok(renderStudyBlock({ lab: "bad" }, 3, esc).includes("A+ Core 1 Drill"), "an unknown study page name shows the default one's title");
}
ok(studyPageTags('<div class="study-block">').length === 2 && studyPageTags('<div class="study-block">').join("").includes("/study/study.js"), "a page with the block gets the script and the stylesheet");
ok(studyPageTags("<p>hi</p>").length === 0 && studyPageTags("").length === 0 && studyPageTags(null).length === 0, "a page without it gets nothing");

// ---- the progress bridge ----
{
  const bridge = LAB_BRIDGES["core1-lab"];
  ok(typeof bridge === "string" && bridge.length > 500, "the study page has a bridge");
  let syntax = true;
  try { new vm.Script(bridge); } catch (e) { syntax = e.message; }
  ok(syntax === true, "it is valid browser code", syntax);
  ok(!/<\/script/i.test(bridge), "and cannot end its own script tag early");
  const page = "<html><body><p>hi</p></body></html>";
  const out = withBridge(page, "core1-lab");
  ok(out.indexOf("<script>") > out.indexOf("<p>hi</p>") && out.indexOf("</script></body>") > 0 && out.endsWith("</html>"), "it goes in just before the end of the body");
  ok(withBridge("<p>no body tag</p>", "core1-lab").endsWith("</script>"), "or at the end when there is no body tag");
  const tricky = withBridge("<body>a</body><pre>&lt;/body&gt; </body></pre></body>", "core1-lab");
  ok(tricky.lastIndexOf("<script>") > tricky.indexOf("</pre>") && tricky.endsWith("</body>"), "it goes before the LAST closing body tag");
  ok(withBridge(page, "something-else") === page && withBridge(page, undefined) === page, "a study page without a bridge is sent unchanged");
  ok(withBridge(null, "core1-lab").startsWith("<script>") && withBridge(undefined, "x") === "", "missing html does not crash");

  // Run the bridge against a stand-in for the study page: its state object, render, and the window it lives in.
  const makeState = () => ({
    screen: "home", exam: "A", qtype: "mc", shuffle: true, timedMode: false, timeRemaining: 0, timerEnd: 0, timerHandle: null, autoAdvanceHandle: null,
    queue: [], idx: 0, score: 0, results: [], sel: [], checked: false, gameHandle: null, gameTimerHandle: null, sessionActive: false, browseReturn: null,
    labBoardId: null, labCols: {}, labTray: [], labLocked: {}, labDrag: null, labElapsed: 0, labStartMs: 0, labClockHandle: null, labDone: false,
    lqId: null, lqItems: [], lqIdx: 0, lqHandle: null, labStats: {},
  });
  function run(state = makeState(), over = {}) {
    const posted = [], timers = [], intervals = [], calls = { render: 0, resumeTimer: 0 }, handlers = {}, docHandlers = {};
    const parent = { postMessage: (m) => posted.push(m) };
    const win = { parent, addEventListener: (type, fn) => { handlers[type] = fn; } };
    const doc = { documentElement: { style: {} }, hidden: false, addEventListener: (type, fn) => { docHandlers[type] = fn; } };
    const ctx = vm.createContext({
      window: win, parent, document: doc, state, JSON, Object, Array, Date, Number, String,
      render: () => { calls.render++; },
      canResume: () => state.sessionActive && state.queue.length > 0 && state.idx < state.queue.length,
      resumeTimer: () => { calls.resumeTimer++; },
      labCurBoard: () => (state.labBoardId === "known" ? {} : undefined),
      labQuizDef: () => (state.lqId === "knownq" ? {} : undefined),
      labTick: () => {}, labSyncElapsed: () => { state.labElapsed = 77; },
      setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
      setInterval: (fn) => { intervals.push(fn); return intervals.length; },
      ...over,
    });
    vm.runInContext(bridge, ctx);
    const send = (data, source = parent) => handlers.message({ source, data });
    return { state, posted, timers, intervals, calls, handlers, docHandlers, doc, ctx, send, parent };
  }

  let r = run();
  ok(r.posted.length === 1 && r.posted[0].study === "ready", "the study page says it is ready when it loads");
  r.ctx.render(); r.ctx.render();
  ok(r.calls.render === 2 && r.timers.length === 2, "every redraw of the page schedules a save");
  r.state.screen = "quiz"; r.state.score = 3; r.state.queue = [{ id: "A1", stem: "q" }]; r.state.timerHandle = 99; r.state.timerEnd = 12345; r.state.labDrag = { x: 1 }; r.state.labClockHandle = 5;
  r.timers[1]();
  const save = r.posted[r.posted.length - 1];
  ok(save.study === "save" && save.state.screen === "quiz" && save.state.score === 3 && save.state.queue[0].id === "A1", "a save carries the page's progress", Object.keys(save.state).length);
  ok(!("timerHandle" in save.state) && !("timerEnd" in save.state) && !("labDrag" in save.state) && !("labClockHandle" in save.state) && !("gameTimerHandle" in save.state), "but not clocks, timers or a drag in progress");
  ok(save.state.labElapsed === 77, "a running stopwatch is brought up to date first");
  r.state.queue[0].id = "CHANGED";
  ok(save.state.queue[0].id === "A1", "and it is a copy, not the live state");
  r.send({ study: "flush" });
  ok(r.posted[r.posted.length - 1].study === "save", "a flush request saves at once");
  r.docHandlers.visibilitychange(); r.doc.hidden = true; r.docHandlers.visibilitychange(); r.handlers.pagehide();
  ok(r.posted.filter((m) => m.study === "save").length >= 4, "leaving the page or hiding the tab saves too");
  r = run(Object.assign(makeState(), { huge: undefined }));
  r.state.sel = ["x".repeat(2000000)]; r.ctx.render(); r.timers[0]();
  ok(!r.posted.some((m) => m.study === "save"), "progress too big to keep is not sent");

  // restoring
  r = run();
  r.send({ study: "restore", state: { screen: "browse", exam: "B", score: 4, idx: 2, sel: [1, 2], browseReturn: null, sessionActive: true, queue: [{ id: "Q1" }, { id: "Q2" }, { id: "Q3" }, { id: "Q4" }], labStats: { b1: { best: 30 } } } });
  ok(r.state.screen === "browse" && r.state.exam === "B" && r.state.score === 4 && r.state.idx === 2 && r.state.sel.join() === "1,2" && r.state.queue.length === 4 && r.state.labStats.b1.best === 30, "restored progress is put back");
  ok(r.calls.render === 1, "and the page redraws once");
  r = run();
  r.send({ study: "restore", state: { notAKey: 5, score: "lots", sel: "not a list", timedMode: 1, screen: 7, timerHandle: 123, labClockHandle: 9, labDrag: { a: 1 }, timerEnd: 5, queue: {} } });
  ok(!("notAKey" in r.state) && r.state.score === 0 && Array.isArray(r.state.sel) && r.state.timedMode === false && r.state.screen === "home" && Array.isArray(r.state.queue), "unknown keys and values of the wrong kind are ignored", r.state.screen);
  ok(r.state.timerHandle === null && r.state.labClockHandle === null && r.state.labDrag === null && r.state.timerEnd === 0, "a saved clock, timer or drag is never put back");
  r = run(); r.send({ study: "restore", state: { screen: "game" } });
  ok(r.state.screen === "home", "a run with lives and a clock opens at the start instead");
  r = run(); r.send({ study: "restore", state: { screen: "quiz", sessionActive: false } });
  ok(r.state.screen === "home", "a quiz screen with nothing to resume opens at the start");
  r = run(); r.send({ study: "restore", state: { screen: "quiz", sessionActive: true, queue: [{ id: 1 }, { id: 2 }], idx: 1, timedMode: true, timeRemaining: 42 } });
  ok(r.state.screen === "quiz" && r.calls.resumeTimer === 1, "a timed quiz comes back with its clock restarted");
  r = run(); r.send({ study: "restore", state: { screen: "quiz", sessionActive: true, queue: [{ id: 1 }, { id: 2 }], idx: 1, timedMode: false } });
  ok(r.state.screen === "quiz" && r.calls.resumeTimer === 0, "an untimed one does not start a clock");
  r = run(); r.send({ study: "restore", state: { screen: "lab-board", labBoardId: "known", labElapsed: 30, labDone: false } });
  ok(r.state.screen === "lab-board" && r.intervals.length === 1 && Date.now() - r.state.labStartMs >= 29000 && Date.now() - r.state.labStartMs < 40000, "a sort board comes back with its stopwatch at the same time");
  r = run(); r.send({ study: "restore", state: { screen: "lab-board", labBoardId: "known", labElapsed: 30, labDone: true } });
  ok(r.intervals.length === 0, "a finished board does not start a stopwatch");
  r = run(); r.send({ study: "restore", state: { screen: "lab-board", labBoardId: "gone" } });
  ok(r.state.screen === "lab", "a board that no longer exists falls back to the lab menu");
  r = run(); r.send({ study: "restore", state: { screen: "lab-quiz", lqId: "gone" } });
  ok(r.state.screen === "lab", "and so does a quick quiz that no longer exists");
  for (const bad of [null, undefined, "x", 5, [], true]) { r = run(); r.send({ study: "restore", state: bad }); if (r.state.screen !== "home" || r.posted.some((m) => m.study === "corrupt")) ok(false, `restoring ${JSON.stringify(bad)} is harmless`); }
  ok(true, "restoring nothing, or junk, changes nothing");
  r = run(makeState(), { canResume: () => { throw new Error("boom"); } });
  r.send({ study: "restore", state: { screen: "quiz" } });
  ok(r.posted.some((m) => m.study === "corrupt"), "progress that breaks the page is reported so the popup can forget it");
  r = run(); r.send({ study: "restore", state: { screen: "browse" } }, { other: true });
  ok(r.state.screen === "home" && r.calls.render === 0, "messages from anywhere but the popup are ignored");
  r = run(); r.send({ study: "flush" }, {}); r.send("text"); r.send(null); r.send({ nope: 1 });
  ok(r.posted.length === 1, "and so are malformed ones");

  r = run(); r.send({ study: "zoom", value: 1.5 });
  ok(r.doc.documentElement.style.zoom === "1.5", "a size message resizes the page");
  r = run(); for (const v of [0, 0.1, 9, "x", null, NaN]) r.send({ study: "zoom", value: v });
  ok(r.doc.documentElement.style.zoom === undefined, "sizes outside a sane range are ignored");
  // opened on its own (not inside a popup) the bridge does nothing at all
  const w = { addEventListener() { throw new Error("should not listen"); } }; w.parent = w;
  const original = function render() {};
  const c = vm.createContext({ window: w, parent: w, document: { addEventListener() { throw new Error("should not listen"); }, documentElement: { style: {} } }, state: makeState(), render: original, JSON, Object, Array });
  let quiet = true;
  try { vm.runInContext(bridge, c); } catch (e) { quiet = e.message; }
  ok(quiet === true && c.render === original, "opened on its own, outside a popup, the bridge does nothing");
  const c2 = vm.createContext({ window: { parent: {}, addEventListener() {} }, parent: {}, document: { addEventListener() {}, documentElement: { style: {} } }, JSON, Object, Array });
  let quiet2 = true;
  try { vm.runInContext(bridge, c2); } catch (e) { quiet2 = e.message; }
  ok(quiet2 === true, "and neither does it break a page that is missing the parts it needs");
}

// ---- the files ----
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const lab = fs.readFileSync(path.join(root, "worker/study/core1-lab.html"), "utf8");
ok(/^<!DOCTYPE html>/i.test(lab) && lab.includes("A+ Core 1 Drill") && lab.length > 100000, "the study page file is the real one", lab.length);
ok(Object.keys(STUDY_LABS).join() === "core1-lab,c777-lab" && typeof STUDY_LABS["core1-lab"].load === "function", "it is registered under core1-lab (and the C777 drill beside it)");

// ---- the C777 drill ----
{
  const c777 = fs.readFileSync(path.join(root, "worker/study/c777-lab.html"), "utf8");
  ok(/^<!DOCTYPE html>/i.test(c777) && c777.includes("C777 Web Development Drill") && typeof STUDY_LABS["c777-lab"].load === "function", "the C777 drill is a real page and registered");
  ok((c777.match(/<\/script>/g) || []).length === 3, "no question text ends a script tag early");
  const data = c777.slice(c777.indexOf("const QS = [];"), c777.indexOf("</script>"));
  const QS = new Function(data + "\nreturn QS;")();
  ok(QS.length >= 300, "it has plenty of questions", QS.length);
  const units = new Set(QS.map((q) => q.u));
  ok([1, 2, 3, 4, 5, 6].every((u) => units.has(u)), "every unit of the study guide has questions");
  const shapeBad = QS.filter((q) => !q.s || !q.c.length || q.w.length < 2 || new Set(q.c.concat(q.w)).size !== q.c.length + q.w.length);
  ok(shapeBad.length === 0, "each has a right answer, two or more wrong ones and no repeated choice", shapeBad.slice(0, 3).map((q) => q.s));
  const dup = QS.length - new Set(QS.map((q) => q.u + q.s + q.k)).size;
  ok(dup === 0, "and none is asked twice", dup);
  const bridge = LAB_BRIDGES["c777-lab"];
  let syntax = true;
  try { new vm.Script(bridge); } catch (e) { syntax = e.message; }
  ok(typeof bridge === "string" && syntax === true && !/<\/script/i.test(bridge), "its progress bridge is valid browser code");
  ok(withBridge("<body></body>", "c777-lab").includes("\"ready\""), "and is added to the page");
}
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const leaks = walk(path.join(root, "public")).filter((f) => /\.(js|css|html|json|txt|xml|svg)$/.test(f) && /DEFAULT_PASSWORD|STUDY_PASSWORD/.test(fs.readFileSync(f, "utf8")));
ok(leaks.length === 0, "the password setting is named in no file that is served straight from public/", leaks);
const quizLeak = walk(path.join(root, "public")).filter((f) => /\.(js|css|html)$/.test(f) && fs.readFileSync(f, "utf8").includes("QUIZ_DATA"));
ok(quizLeak.length === 0, "and neither is the study page itself", quizLeak);
ok(!/DEFAULT_PASSWORD|STUDY_PASSWORD/.test(fs.readFileSync(path.join(root, "worker/render.js"), "utf8")), "nor in the page renderer");

// ---- a lab asked for by name (the search dialog): no block on a page, the same lock
{
  const env = makeEnv();
  let r = await call(env, { lab: "core1-lab" });
  ok(r.status === 401 && (await r.json()).needsPassword === true, "a lab asked for by name, with no password, is told to type one");
  ok(hits(env).length === 0, "(asking before a password is typed is not a guess)");
  r = await call(env, { lab: "core1-lab", password: "wrong" });
  ok(r.status === 401 && hits(env).length === 1, "a wrong password is refused and counted");
  r = await call(env, { lab: "core1-lab", password: "123" });
  ok(r.status === 200 && /LAB/.test(await r.text()), "the right password (the default, 123) opens the lab");
  r = await call(makeEnv({ extra: { STUDY_PASSWORD: "tulip" } }), { lab: "core1-lab", password: "Tulip" });
  ok(r.status === 200, "the site's own STUDY_PASSWORD is the one asked for when it is set");
  for (const bad of ["nope", "__proto__", "constructor", "toString", "", 7, null, ["core1-lab"], {}]) {
    r = await call(makeEnv(), { lab: bad, password: "123" });
    ok(r.status === 404 || r.status === 400, `a lab of ${JSON.stringify(bad)} is not a lab (${r.status})`);
  }
  r = await call(makeEnv({ blocks: { 5: row({ lab: "core1-lab", password: "tulip" }) } }), { block: 5, lab: "core1-lab", password: "123" });
  ok(r.status === 401, "a block id given with a lab means the block, with its own password");
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
