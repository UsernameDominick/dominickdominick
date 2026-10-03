// The Nodes editor's brain: node definitions, the graph compiler, the starter graphs, and the layout numbers the canvas relies on.
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const D = require("../public/admin/node-defs.js");
const C = require("../public/admin/node-compiler.js");
const T = require("../public/admin/node-templates.js");
const E = require("../public/admin/node-editor.js");
const R = require("../public/admin/script-runner.js");
const SP = require("../public/admin/script-policy.js");

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const N = (id, type, x = 0, y = 0, values = {}, props = {}) => ({ id, type, x, y, values, props });
const W = (a, ap, b, bp = "in") => ({ from: { node: a, pin: ap }, to: { node: b, pin: bp } });
const G = (nodes, wires) => ({ nodes, wires });
const errors = (r) => r.problems.filter((p) => p.level === "error").map((p) => p.text);
const warns = (r) => r.problems.filter((p) => p.level === "warn").map((p) => p.text);

// ---- definitions
{
  const types = Object.keys(D.NODES);
  ok(types.length >= 20, "there is a good set of nodes", types.length);
  for (const [type, def] of Object.entries(D.NODES)) {
    const exec = D.isExec(def);
    const pins = [...(def.inputs || []).map((p) => "in:" + p.id), ...(def.outputs || []).map((p) => "out:" + p.id), ...(def.flowOuts || []).map((p) => "flow:" + p.id)];
    const problems = [];
    if (new Set(pins).size !== pins.length) problems.push("repeated pin id");
    if (!def.title || !D.CATEGORY_ORDER.includes(def.category)) problems.push("title or category");
    if (exec && typeof def.emit !== "function") problems.push("a step needs emit");
    if (!exec && (typeof def.expr !== "function" || (def.outputs || []).length !== 1)) problems.push("a value node needs expr and one output");
    if (def.flowIn && !exec) problems.push("flowIn without exec");
    for (const p of [...(def.inputs || []), ...(def.outputs || [])]) if (!D.TYPE_LABELS[p.type]) problems.push(`pin ${p.id} has unknown type ${p.type}`);
    for (const p of def.props || []) if (p.control === "select" && !p.options.some((o) => o.value === p.value)) problems.push(`prop ${p.id} default is not an option`);
    for (const [pin, vars] of Object.entries(def.scoped || {})) if (!(def.flowOuts || []).some((f) => f.id === pin) || vars.some((v) => !(def.outputs || []).some((o) => o.id === v))) problems.push("scoped refers to missing pins");
    if (def.continueAfter && !(def.flowOuts || []).some((f) => f.id === def.continueAfter)) problems.push("continueAfter is not a flow pin");
    ok(problems.length === 0, `node "${type}" is well formed`, problems);
  }
  ok(D.NODES.start && D.NODES.start.flowIn === false, "Start has no flow in");
  // flow only joins flow; values are lenient
  ok(D.compatible("flow", "flow") && !D.compatible("flow", "text") && !D.compatible("text", "flow"), "flow only joins flow");
  ok(D.compatible("text", "text") && D.compatible("any", "list") && D.compatible("list", "any") && !D.compatible("list", "text") && !D.compatible("object", "list"), "values: same type or any");
  ok(D.compatible("number", "text") && D.compatible("bool", "text") && !D.compatible("text", "number"), "numbers and yes/no print as text, not the other way round");
  // the settings and style fields offered by nodes exist on the site
  const api = fs.readFileSync(new URL("../worker/admin-api.js", import.meta.url), "utf8");
  const settingsKeys = new Set([...api.slice(api.indexOf("const SETTINGS_KEYS = ["), api.indexOf("];", api.indexOf("const SETTINGS_KEYS = [")))].join("").match(/"([a-z_]+)"/g).map((s) => s.slice(1, -1)));
  ok(D.SETTING_KEYS.every(([k]) => settingsKeys.has(k)), "every setting a node can set is a real site setting", D.SETTING_KEYS.filter(([k]) => !settingsKeys.has(k)));
  const app = fs.readFileSync(new URL("../public/admin/app.js", import.meta.url), "utf8");
  const fields = app.slice(app.indexOf("const STYLE_FIELDS = ["), app.indexOf("const STYLE_GROUPS"));
  ok(D.STYLE_KEYS.every(([k]) => fields.includes(`key: "${k}"`)), "every block style a node can set is a real block style field", D.STYLE_KEYS.filter(([k]) => !fields.includes(`key: "${k}"`)).map((k) => k[0]));
}

// ---- compiling
{
  let r = C.compile(G([N("a", "start")], []));
  ok(r.ok && /^\/\/ Built from nodes/.test(r.code) && warns(r).some((t) => /Start isn't connected/.test(t)), "an empty graph compiles, with a hint to connect Start", r.problems);
  r = C.compile(G([], []));
  ok(!r.ok && errors(r).some((t) => /Add a Start node/.test(t)), "no Start is an error");
  r = C.compile(G([N("a", "start"), N("b", "start")], []));
  ok(!r.ok && errors(r).some((t) => /only be one Start/.test(t)), "two Start nodes is an error");

  r = C.compile(G([N("a", "start"), N("p", "print", 0, 0, { value: "hi \"there\"" })], [W("a", "then", "p")]));
  ok(r.ok && r.code.includes('console.log("hi \\"there\\"");'), "a typed-in value becomes a safe string literal", r.code);
  r = C.compile(G([N("a", "start"), N("p", "print", 0, 0, { value: "x" }), N("n", "number", 0, 0, {}, { value: "4.5" })], [W("a", "then", "p"), W("n", "value", "p", "value")]));
  ok(r.ok && r.code.includes("console.log((4.5));"), "a value node is worked out where it is used", r.code);

  // a step that needs something connected
  r = C.compile(G([N("a", "start"), N("g", "get-page-css")], [W("a", "then", "g")]));
  ok(!r.ok && errors(r).some((t) => /needs something connected to "Page"/.test(t)), "a required input with nothing connected is an error", errors(r));

  // order matters: a value is only there once its step has run
  r = C.compile(G([N("a", "start"), N("s", "get-settings"), N("p", "print")], [W("a", "then", "p"), W("p", "then", "s"), W("s", "settings", "p", "value")]));
  ok(!r.ok && errors(r).some((t) => /has not run by then/.test(t)), "using a value before its step runs is an error", errors(r));

  // loops and scope
  r = C.compile(G([N("a", "start"), N("l", "for-each"), N("g", "get-pages")], [W("a", "then", "g"), W("g", "then", "l"), W("g", "pages", "l", "list"), W("l", "body", "g")]));
  ok(!r.ok && errors(r).some((t) => /loops back|two places/.test(t)), "a flow that loops back is an error", errors(r));
  r = C.compile(G([N("a", "start"), N("g", "get-pages"), N("l", "for-each"), N("p", "print")], [W("a", "then", "g"), W("g", "then", "l"), W("g", "pages", "l", "list"), W("l", "done", "p"), W("l", "item", "p", "value")]));
  ok(!r.ok && errors(r).some((t) => /has not run by then/.test(t)), "a loop's item is not available after the loop", errors(r));
  r = C.compile(G([N("a", "start"), N("g", "get-pages"), N("l", "for-each"), N("p", "print"), N("q", "print", 0, 0, { value: "done" })], [W("a", "then", "g"), W("g", "then", "l"), W("g", "pages", "l", "list"), W("l", "body", "p"), W("l", "item", "p", "value"), W("l", "done", "q")]));
  ok(r.ok && /for \(const \[v_l_index, v_l_item\] of Array\.from\(v_g_pages \|\| \[\]\)\.entries\(\)\) \{\n  console\.log\(v_l_item\);\n\}\nconsole\.log\("done"\);/.test(r.code), "For each repeats its body, then carries on from Done", r.code);

  // branch (its condition has to be wired: a fixed yes/no would make the branch pointless)
  r = C.compile(G([N("a", "start"), N("b", "branch"), N("y", "print", 0, 0, { value: "yes" })], [W("a", "then", "b"), W("b", "true", "y")]));
  ok(!r.ok && errors(r).some((t) => /needs something connected to "Condition"/.test(t)), "Branch needs a condition connected", errors(r));
  const cond = [N("c", "equals", 0, 0, { a: "x", b: "x" })];
  r = C.compile(G([N("a", "start"), N("b", "branch"), ...cond, N("y", "print", 0, 0, { value: "yes" }), N("n", "print", 0, 0, { value: "no" })], [W("a", "then", "b"), W("c", "value", "b", "condition"), W("b", "true", "y"), W("b", "false", "n")]));
  ok(r.ok && r.code.includes('if ((String("x") === String("x"))) {\n  console.log("yes");\n} else {\n  console.log("no");\n}'), "Branch makes if / else", r.code);
  r = C.compile(G([N("a", "start"), N("b", "branch"), ...cond, N("y", "print", 0, 0, { value: "yes" })], [W("a", "then", "b"), W("c", "value", "b", "condition"), W("b", "true", "y")]));
  ok(r.ok && r.code.includes("if (") && !r.code.includes("else"), "no else when nothing is connected to No", r.code);
  r = C.compile(G([N("a", "start"), N("b", "branch"), ...cond, N("p", "print", 0, 0, { value: "shared" })], [W("a", "then", "b"), W("c", "value", "b", "condition"), W("b", "true", "p"), W("b", "false", "p")]));
  ok(!r.ok && errors(r).some((t) => /reached from two places/.test(t)), "a step reached from two places is an error", r.problems);
  r = C.compile(G([N("a", "start"), N("b", "branch"), N("y", "print", 0, 0, { value: "yes" })], [W("a", "then", "b"), W("b", "true", "y"), W("b", "condition", "y")]));
  ok(warns(r).length + errors(r).length >= 1, "a wire that matches no pins is flagged, not trusted");

  // wiring problems
  r = C.compile(G([N("a", "start"), N("g", "get-pages"), N("l", "for-each")], [W("a", "then", "g"), W("g", "then", "l"), W("g", "pages", "l", "list"), W("g", "pages", "l", "list")]));
  ok(r.ok, "an exact repeat of a wire is ignored");
  r = C.compile(G([N("a", "start"), N("s", "get-settings"), N("l", "for-each")], [W("a", "then", "s"), W("s", "then", "l"), W("s", "settings", "l", "list")]));
  ok(!r.ok && errors(r).some((t) => /can't go into/.test(t)), "an item can't go into a list pin", errors(r));
  r = C.compile(G([N("a", "start"), N("n", "number"), N("p", "print")], [W("a", "then", "p"), W("n", "value", "p", "value")]));
  ok(r.ok, "a number can go into anything-pins");
  r = C.compile(G([N("a", "start"), N("x", "no-such-node")], [W("a", "then", "x")]));
  ok(!r.ok || warns(r).length > 0, "an unknown node type is handled without throwing", r.problems);
  r = C.compile(G([N("a", "start"), N("p", "print"), N("p2", "print")], [W("a", "then", "p"), W("a", "then", "p2")]));
  ok(warns(r).some((t) => /two wires leaving/.test(t)), "two wires from one flow pin: the first is used, with a warning");
  r = C.compile(G([N("a", "start"), N("p", "print"), N("j", "join-text"), N("k", "join-text")], [W("a", "then", "p"), W("j", "value", "k", "a"), W("k", "value", "j", "a"), W("j", "value", "p", "value")]));
  ok(!r.ok && errors(r).some((t) => /wired into itself/.test(t)), "values wired in a circle are an error, not an endless loop", errors(r));
  r = C.compile(G([N("a", "start"), N("p", "print"), N("orphan", "get-pages"), N("t", "text")], [W("a", "then", "p")]));
  ok(r.ok && warns(r).filter((t) => /isn't connected to the script/.test(t)).length === 2, "nodes that aren't connected to anything are noted", warns(r));
  r = C.compile(G([N("a", "start"), N("j", "join-text")], [W("a", "then", "j")]));
  ok(!r.ok && errors(r).some((t) => /is a value, not a step/.test(t)) || errors(r).some((t) => /not a step/.test(t)), "a value node on the flow is an error", errors(r));

  // pieces
  r = C.compile(G([N("a", "start"), N("p", "print"), N("rep", "replace-text", 0, 0, { text: "a#fff b#fff", find: "#fff", replacement: "#000" })], [W("a", "then", "p"), W("rep", "value", "p", "value")]));
  const swapped = new AsyncFunction("console", `${r.code.replace(/console\.log\(/, "return (")}`);
  ok(r.ok && (await swapped({})) === "a#000 b#000", "Replace text swaps every copy", r.code);
  r = C.compile(G([N("a", "start"), N("p", "print"), N("rep", "replace-text", 0, 0, { text: "abc", find: "", replacement: "x" })], [W("a", "then", "p"), W("rep", "value", "p", "value")]));
  ok(await new AsyncFunction(r.code.replace(/console\.log\(/, "return (").replace(/^\/\/.*\n/, ""))() === "abc", "an empty Find changes nothing");
  // filter
  const filterExpr = (op, field, val, items) => {
    const g = C.compile(G([N("a", "start"), N("p", "print"), N("f", "filter-list", 0, 0, { value: val }, { field, operator: op }), N("c", "get-pages")], [W("a", "then", "c"), W("c", "then", "p"), W("c", "pages", "f", "list"), W("f", "value", "p", "value")]));
    return new AsyncFunction("site", g.code.replace(/console\.log\(/, "return (").replace(/^\/\/.*\n/, ""))({ pages: { list: async () => items } });
  };
  const pages = [{ slug: "home", title: "Home" }, { slug: "about-me", title: "About" }, { slug: "", title: null }];
  ok((await filterExpr("equals", "slug", "home", pages)).length === 1, "filter: is");
  ok((await filterExpr("contains", "slug", "ABOUT", pages)).length === 1, "filter: contains ignores capitals");
  ok((await filterExpr("starts-with", "slug", "ab", pages)).length === 1, "filter: starts with");
  ok((await filterExpr("not-equals", "slug", "home", pages)).length === 2, "filter: is not");
  ok((await filterExpr("empty", "title", "", pages)).length === 1 && (await filterExpr("not-empty", "title", "", pages)).length === 2, "filter: empty and not empty cope with missing fields");

  // lines map back to nodes
  r = C.compile(T.TEMPLATES[0].graph);
  const lineOfSet = r.code.split("\n").findIndex((l) => l.includes("site.pages.setCss")) + 1;
  ok(C.nodeAtLine(r, lineOfSet) === "n6" && C.nodeAtLine(r, 1) === null && C.nodeAtLine(r, 999) === null, "a line of the code points back at its node", C.nodeAtLine(r, lineOfSet));

  // sanitising
  const clean = C.sanitizeGraph({ nodes: [{ id: "a", type: "start", x: "12.6", y: null, values: { v: { nested: 1 }, ok: "t" }, props: [] }, { id: "a", type: "print" }, { type: "print" }, null], wires: [{ from: { node: "a", pin: "then" }, to: { node: "ghost", pin: "in" } }, null], view: { x: 1, y: 2, zoom: 9 } });
  ok(clean.nodes.length === 1 && clean.nodes[0].x === 13 && clean.nodes[0].y === 0 && clean.nodes[0].values.ok === "t" && !("v" in clean.nodes[0].values) && clean.wires.length === 0 && clean.view.zoom === 2, "sanitising drops what is broken and tidies the rest", clean);
  ok(C.sanitizeGraph(null).nodes.length === 0 && C.sanitizeGraph("junk").wires.length === 0, "and copes with garbage");
  const g1 = C.newGraph();
  ok(g1.nodes.length === 1 && g1.nodes[0].type === "start" && C.freeId(g1) === "n2", "a new graph is just Start; ids stay unique");
  const taken = C.freeId({ nodes: [{ id: "n2" }, { id: "n3" }] });
  ok(!["n2", "n3"].includes(taken), "freeId skips taken ids", taken);
}

// ---- the starter graphs
{
  for (const t of T.TEMPLATES) {
    const r = C.compile(t.graph);
    ok(r.ok && r.problems.length === 0, `starter graph "${t.name}" compiles with no problems`, r.problems);
    let err = null;
    try { new AsyncFunction("site", "console", r.code); } catch (e) { err = e.message; }
    ok(!err, `...and its code is valid JavaScript`, err);
  }
  ok(new Set(T.TEMPLATES.map((t) => t.id)).size === T.TEMPLATES.length, "starter ids are unique");

  // run the generated code against a pretend site
  async function run(code, answer) {
    const sent = [];
    let done = null;
    const self = { setTimeout, JSON, Object, Array, Map, Set, Math, Number, String, Error, Promise };
    self.self = self;
    const port = {
      postMessage(m) {
        if (m.t === "call") {
          sent.push(m);
          const data = answer(m);
          setTimeout(() => port.onmessage({ data: { id: m.id, ok: true, data } }), 0);
        } else if (m.t === "done") done = m;
      },
      onmessage: null,
    };
    vm.runInContext(R.buildSource(code).source, vm.createContext(self));
    self.onmessage({ data: { port, dry: false } });
    for (let i = 0; i < 400 && !done; i++) await new Promise((r) => setTimeout(r, 5));
    return { sent, done };
  }
  const swap = C.compile(T.TEMPLATES.find((t) => t.id === "swap-colour").graph);
  const out = await run(swap.code, (m) => (m.path === "/pages" ? [{ id: 1 }, { id: 2 }] : m.method === "GET" ? { css: m.path.includes("/1/") ? ".a { color: #ff7a45; }" : ".b { border: 1px solid #ff7a45; }" } : { ok: true }));
  const puts = out.sent.filter((m) => m.method === "PUT");
  ok(out.done && out.done.ok && puts.length === 2 && puts[0].body.css === ".a { color: #c1440e; }" && puts[1].body.css.includes("#c1440e"), "swapping a colour edits every page's CSS", out.done && out.done.error);
  const rule = C.compile(T.TEMPLATES.find((t) => t.id === "add-css-rule").graph);
  const out2 = await run(rule.code, (m) => (m.path === "/pages" ? [{ id: 7 }] : m.method === "GET" ? { css: "body { margin: 0; }" } : { ok: true }));
  const put2 = out2.sent.find((m) => m.method === "PUT");
  ok(put2 && put2.body.css === "body { margin: 0; }\n\n.button {\n  border-radius: 12px;\n}", "adding a rule appends it, laid out properly", put2 && put2.body.css);
  const out3 = await run(rule.code, (m) => (m.path === "/pages" ? [{ id: 7 }] : m.method === "GET" ? { css: "body { margin: 0; }\n\n.button {\n  border-radius: 12px;\n}" } : { ok: true }));
  ok(out3.sent.find((m) => m.method === "PUT").body.css === "body { margin: 0; }\n\n.button {\n  border-radius: 12px;\n}", "running it again changes nothing");
  const allCalls = [out, out2, out3].flatMap((o) => o.sent);
  ok(allCalls.length > 0 && allCalls.every((m) => SP.checkCall(m.method, m.path).ok), "every request the starter graphs make is one a script is allowed to make", allCalls.filter((m) => !SP.checkCall(m.method, m.path).ok));
  const acc = C.compile(T.TEMPLATES.find((t) => t.id === "set-accent").graph);
  const out4 = await run(acc.code, (m) => ({ ok: true }));
  ok(out4.sent[0].method === "PUT" && out4.sent[0].path === "/settings" && out4.sent[0].body.theme_accent === "#c1440e", "setting the accent colour names only that setting", out4.sent[0]);
  const round = C.compile(T.TEMPLATES.find((t) => t.id === "round-home-blocks").graph);
  const out5 = await run(round.code, (m) => (m.path === "/pages" ? [{ id: 1, slug: "home" }, { id: 2, slug: "other" }] : m.path === "/pages/1/blocks" ? [{ id: 10, style: { color: "red" } }, { id: 11, style: {} }] : { ok: true }));
  ok([...out4.sent, ...out5.sent].every((m) => SP.checkCall(m.method, m.path).ok), "...including settings and block styles");
  const patches = out5.sent.filter((m) => m.method === "PATCH");
  ok(patches.length === 2 && patches[0].path === "/blocks/10" && patches[0].body.style.color === "red" && patches[0].body.style.borderRadius === 12 && !out5.sent.some((m) => m.path === "/pages/2/blocks"), "block styles are merged, numbers stay numbers, other pages are untouched", patches);
}

// ---- the canvas numbers
{
  const L = E.layoutNode(D.NODES["for-each"]);
  ok(L.w === E.NODE_W && L.pins["in:in"].x === 0 && L.pins["out:body"].x === E.NODE_W && L.pins["out:done"].y > L.pins["out:body"].y, "pins sit on the node's left and right edges, one flow pin per row", Object.keys(L.pins));
  ok(L.pins["in:list"] && L.pins["out:item"] && L.pins["out:index"], "data pins are laid out too");
  for (const [type, def] of Object.entries(D.NODES)) {
    const l = E.layoutNode(def);
    const ys = Object.values(l.pins).filter((p) => p.dir === "in").map((p) => p.y).sort((a, b) => a - b);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]);
    ok(gaps.every((g) => g >= 20) && Object.values(l.pins).every((p) => p.y > E.HEADER_H && p.y < l.h), `node "${type}": pins are inside the node and not on top of each other`, gaps);
  }
  const unknown = E.layoutNode(undefined);
  ok(unknown.w === E.NODE_W && Object.keys(unknown.pins).length === 0, "an unknown node still has a size");
  ok(/^M 10 20 C 105 20, 105 80, 200 80$/.test(E.wirePath(10, 20, 200, 80)) && /^M 0 0 C 50 0,/.test(E.wirePath(0, 0, 10, 0)), "wires leave pins sideways with a sensible minimum curve", E.wirePath(10, 20, 200, 80));
}

// ---- wiring into the admin
{
  const html = fs.readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  for (const f of ["node-defs.js", "node-compiler.js", "node-editor.js", "node-templates.js"]) ok(html.includes(`/admin/${f}`), `${f} is loaded by the admin`);
  ok(html.indexOf("/admin/node-defs.js") < html.indexOf("/admin/node-compiler.js") && html.indexOf("/admin/node-compiler.js") < html.indexOf("/admin/node-editor.js"), "scripts load in dependency order");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
