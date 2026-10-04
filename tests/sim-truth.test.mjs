// Truth tables on a circuit's public page: one real HTML table per kind of gate, with the standard or the custom outputs, one table for
// identical gates, escaped labels, a cap on a long list, a section on the circuit's own page and a fold under an embed, and nothing
// at all for a circuit with no gates.
import { renderLogicGateTables, standardLogicTruth, logicGateRows, LOGIC_GATES } from "../worker/simulation-render.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const gate = (id, g, extra = {}) => ({ id, type: "logic_gate", gate: g, x: 40 + (id.length) * 10, y: 40, ...extra });
const circuit = (...components) => ({ components, wires: [] });
const rowsOf = (html) => [...html.matchAll(/<tr><td>(\d)<\/td>(?:<td>(\d)<\/td>)?<td class="sim-truth-out sim-truth-out-(\d)">\d<\/td><\/tr>/g)].map((m) => [m[1], m[2], m[3]].filter((x) => x !== undefined).join(""));

// ---- nothing to show
ok(renderLogicGateTables(circuit(), "u") === "" && renderLogicGateTables({ components: [{ id: "r", type: "resistor", x: 10, y: 10 }], wires: [] }, "u") === "", "a circuit with no gates gets no markup");
for (const bad of [null, undefined, "x", {}, { components: "x" }, { components: [null, 5, "a"] }]) ok(renderLogicGateTables(bad, "u") === "", `${JSON.stringify(bad)} gets none and does not throw`);

// ---- each standard gate
for (const name of Object.keys(LOGIC_GATES)) {
  const html = renderLogicGateTables(circuit(gate("g1", name)), "u1", { open: true });
  const want = logicGateRows(name).map((bits, i) => bits.join("") + standardLogicTruth(name)[i]);
  ok(rowsOf(html).join() === want.join(), `${LOGIC_GATES[name].label}: the table lists every input combination with the standard output`, rowsOf(html));
  ok(html.includes(`<caption>${LOGIC_GATES[name].label} gate</caption>`), `${LOGIC_GATES[name].label}: the caption names the gate`);
  const heads = [...html.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1]).join();
  ok(heads === (LOGIC_GATES[name].inputs === 2 ? "A,B,Out" : "A,Out"), `${LOGIC_GATES[name].label}: column headings ${heads}`);
}

// ---- section or fold
{
  const open = renderLogicGateTables(circuit(gate("g1", "xor")), "sim-standalone", { open: true });
  ok(/^<section class="sim-truth" aria-labelledby="sim-standalone-truth-h"><h2 id="sim-standalone-truth-h">Logic gates<\/h2>/.test(open), "on the circuit's own page it is a section with a heading the section is named by");
  ok(/not part of the live readings/.test(open), "and says the gates are not simulated");
  const fold = renderLogicGateTables(circuit(gate("g1", "xor"), gate("g2", "and")), "sim-7");
  ok(/^<details class="sim-truth sim-truth-fold"><summary>Logic gate truth tables \(2\)<\/summary>/.test(fold) && !/<h2/.test(fold), "under an embedded circuit it is a folded details counting the gates, with no extra heading");
}

// ---- custom tables
{
  const html = renderLogicGateTables(circuit(gate("g1", "and", { truth: [1, 1, 0, 0], label: "Mystery" })), "u");
  ok(rowsOf(html).join() === "001,011,100,110" && /\(custom table\)/.test(html) && /Mystery/.test(html), "a custom table shows its own outputs, says so and keeps the label", rowsOf(html));
  const bad = renderLogicGateTables(circuit(gate("g1", "and", { truth: [1, 1, 1] })), "u");
  ok(rowsOf(bad).join() === "000,010,100,111" && !/custom/.test(bad), "a damaged custom table falls back to the standard one");
  const unknown = renderLogicGateTables(circuit(gate("g1", "banana")), "u");
  ok(/AND gate/.test(unknown) && rowsOf(unknown).join() === "000,010,100,111", "an unknown gate name is drawn and listed as AND, as the drawing does");
}

// ---- identical gates share one table
{
  const html = renderLogicGateTables(circuit(gate("a", "and", { label: "U1" }), gate("bb", "and", { label: "U2" }), gate("ccc", "and", { label: "U1" }), gate("dddd", "or", { label: "U3" })), "u");
  ok((html.match(/<table/g) || []).length === 2, "three AND gates and one OR make two tables", (html.match(/<table/g) || []).length);
  ok(html.includes("<caption>AND gate × 3: U1, U2</caption>") && html.includes("<caption>OR gate: U3</caption>"), "the shared table names the count and each label once", html.match(/<caption>[^<]*<\/caption>/g));
  const custom = renderLogicGateTables(circuit(gate("a", "and"), gate("bb", "and", { truth: [0, 0, 0, 0] })), "u");
  ok((custom.match(/<table/g) || []).length === 2, "an AND with a custom table is not lumped in with the standard AND");
  ok(/Logic gate truth tables \(5\)/.test(renderLogicGateTables(circuit(gate("a", "and"), gate("bb", "and"), gate("ccc", "and"), gate("dddd", "or"), gate("eeeee", "not")), "u")), "the fold counts gates, not tables");
}

// ---- escaping and limits
{
  const evil = renderLogicGateTables(circuit(gate("g1", "and", { label: '<img src=x onerror="alert(1)">&"' })), "u\"><script>");
  ok(!/<img|<script|onerror="/.test(evil) && evil.includes("&lt;img") && !evil.includes('u"><script>'), "a label or id with markup is escaped", evil.slice(0, 200));
  const long = renderLogicGateTables(circuit(gate("g1", "and", { label: "x".repeat(500) })), "u");
  ok(/x{40}(?!x)/.test(long) && !/x{41}/.test(long), "a very long label is cut to 40 characters");
  const many = [];
  const names = Object.keys(LOGIC_GATES);
  names.forEach((n) => { for (let k = 0; k < 4; k++) many.push(gate(`${n}${k}`, n, { truth: logicGateRows(n).map((_, i) => (k >> (i % 2)) & 1).slice(0, LOGIC_GATES[n].inputs === 2 ? 4 : 2) })); });
  const html = renderLogicGateTables(circuit(...many), "u", { open: true });
  const tables = (html.match(/<table/g) || []).length;
  ok(tables <= 12 && (tables === 12 ? /and \d+ more kinds? of gate/.test(html) : true), "a long list stops at 12 tables and counts the rest", tables);
  ok(/<table/.test(html) && html.indexOf("<table") > html.indexOf("</p>"), "the note comes before the tables");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
