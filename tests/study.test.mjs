// The temporary Study block (worker/study/): the password check, the unlock route, and what a page shows.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { samePassword, expectedPassword, gatePassword, handleStudyUnlock, renderStudyBlock, studyPageTags, STUDY_LABS } from "../worker/study/index.js";

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

// ---- whether a block asks at all ----
ok(gatePassword({}, undefined) === "" && gatePassword({}, {}) === "" && gatePassword({}, { label: "x" }) === "", "no setting: no password is asked for");
ok(gatePassword({}, { password: "mine" }) === "", "a password typed in but the box not ticked: still open (the tick is what turns it on)");
ok(gatePassword({}, { requirePassword: "true" }) === "" && gatePassword({}, { requirePassword: 1 }) === "", "only a real true turns it on");
ok(gatePassword({}, { requirePassword: true }) === "123", "ticked, no password typed: the default");
ok(gatePassword({}, { requirePassword: true, password: " mine " }) === "mine", "ticked with a password: that one");
ok(gatePassword({ STUDY_PASSWORD: "envpw" }, { requirePassword: true }) === "envpw" && gatePassword({ STUDY_PASSWORD: "envpw" }, {}) === "", "an STUDY_PASSWORD variable only matters when ticked");

// ---- the route ----
{
  const env = makeEnv({ blocks: { 7: row({ lab: "core1-lab", requirePassword: true }) } });
  const res = await call(env, { block: 7, password: " 123 " });
  ok(res.status === 200 && (await res.text()) === "<!DOCTYPE html><title>LAB</title>", "the right password returns the study page");
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
  ok((await call(env, { block: 7, password: "123" })).status === 200 && (await call(env, { block: 7 })).status === 200, "damaged block content still opens (it asks for nothing)");
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

// ---- a block that asks for nothing ----
for (const [label, content] of [["no settings", {}], ["a password typed but not ticked", { password: "mine" }], ["ticked off", { requirePassword: false, password: "mine" }], ["a text 'true'", { requirePassword: "true" }]]) {
  const env = makeEnv({ blocks: { 7: row(content) }, used: 99 });
  for (const body of [{ block: 7 }, { block: 7, password: "" }, { block: 7, password: "anything" }, { block: 7, password: 5 }]) {
    const res = await call(env, body);
    if (res.status !== 200) ok(false, `${label}: ${JSON.stringify(body)} opens`, res.status);
  }
  ok((await (await call(env, { block: 7 })).text()).includes("LAB"), `${label}: opens for anyone, even from a visitor who is over the try limit`);
  ok(hits(env).length === 0 && !env.log.some((l) => /rate_limits/.test(l[1])), `${label}: and never touches the try counter`);
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
  ok(renderStudyBlock({}, 3, esc).includes(">Open study<"), "no button text: a sensible default");
  ok(renderStudyBlock(null, 3, esc).includes("study-open") && renderStudyBlock({ label: "x".repeat(300) }, 3, esc).includes(">" + "x".repeat(80) + "<"), "missing content and very long text are handled");
  ok(renderStudyBlock({ lab: "bad" }, 3, esc).includes("A+ Core 1 Drill"), "an unknown study page name shows the default one's title");
}
ok(studyPageTags('<div class="study-block">').length === 2 && studyPageTags('<div class="study-block">').join("").includes("/study/study.js"), "a page with the block gets the script and the stylesheet");
ok(studyPageTags("<p>hi</p>").length === 0 && studyPageTags("").length === 0 && studyPageTags(null).length === 0, "a page without it gets nothing");

// ---- the files ----
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const lab = fs.readFileSync(path.join(root, "worker/study/core1-lab.html"), "utf8");
ok(/^<!DOCTYPE html>/i.test(lab) && lab.includes("A+ Core 1 Drill") && lab.length > 100000, "the study page file is the real one", lab.length);
ok(Object.keys(STUDY_LABS).join() === "core1-lab" && typeof STUDY_LABS["core1-lab"].load === "function", "it is registered under core1-lab");
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

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
