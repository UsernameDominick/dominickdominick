import fs from "node:fs";
import vm from "node:vm";
import * as W from "../worker/simulation-render.js";
import { simulationDataError } from "../worker/simulation-validation.js";
const window = {};
const ctx = vm.createContext({ window, console, Math, Number, String, Object, Array, Set, Map, JSON, Infinity, NaN, Float64Array, CSS: { escape: (s) => s } });
vm.runInContext(fs.readFileSync(new URL("../public/admin/sim-solver.js", import.meta.url), "utf8"), ctx);
vm.runInContext(fs.readFileSync(new URL("../public/admin/sim-schematic.js", import.meta.url), "utf8"), ctx);
vm.runInContext(fs.readFileSync(new URL("../public/admin/sim-components.js", import.meta.url), "utf8"), ctx);
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const wire = (id, a, ap, b, bp) => ({ id, from: { compId: a, pin: ap }, to: { compId: b, pin: bp } });
// definitions match across sizes and split on/off
let bad = null;
for (const cols of [15, 30, 45]) for (const split of [false, true]) {
  const comp = { id: "bb", type: "breadboard", x: 0, y: 0, cols, ...(split ? { splitRails: true } : {}) };
  const c = window.getSimComponentDefinition(comp), w = W.getSimulationComponentDefinition(comp);
  if (!(JSON.stringify(c.railGroups) === JSON.stringify(w.railGroups) && c.render(comp) === w.render(comp) && JSON.stringify(c.pins) === JSON.stringify(w.pins))) bad = { cols, split };
}
ok(!bad, "client and worker breadboard definitions (rails, pins, drawing) match for 15/30/45 columns, split and not", bad);
const unsplit = window.getSimComponentDefinition({ id: "bb", type: "breadboard", cols: 30 });
ok(Object.keys(unsplit.railGroups).join() === "pos_top,neg_top,neg_bottom,pos_bottom" && unsplit.railGroups.pos_top.length === 30, "without the setting the four rails are whole, with the same names as before");
for (const [cols, left, right] of [[15, 8, 7], [30, 15, 15], [45, 23, 22]]) {
  const d = window.getSimComponentDefinition({ id: "bb", type: "breadboard", cols, splitRails: true });
  ok(Object.keys(d.railGroups).length === 8 && d.railGroups.pos_top_l.length === left && d.railGroups.pos_top_r.length === right && d.railGroups.neg_bottom_l[0] === "rnb1" && d.railGroups.neg_bottom_r[0] === `rnb${left + 1}`, `${cols} columns split ${left} | ${right}, every rail splits at the same column`);
}
const svgPlain = window.getSimComponentDefinition({ id: "bb", type: "breadboard", cols: 30 }).render();
const svgSplit = window.getSimComponentDefinition({ id: "bb", type: "breadboard", cols: 30, splitRails: true }).render();
ok((svgPlain.match(/bb-rail-line/g) || []).length === 4 && (svgSplit.match(/bb-rail-line/g) || []).length === 8, "the drawing shows each rail as two segments when split");
// connectivity
const circuit = (split, rightHole) => ({ components: [{ id: "bb", type: "breadboard", x: 0, y: 0, cols: 30, ...(split ? { splitRails: true } : {}) }, { id: "bat", type: "battery", x: 0, y: 200, voltage: 9 }, { id: "r", type: "resistor", x: 300, y: 200, resistance: 100 }, { id: "om", type: "ohmmeter", x: 500, y: 200 }],
  wires: [wire("a", "bat", "pos", "bb", "rpt3"), wire("b", "r", "p1", "bb", "rpt" + rightHole), wire("c", "r", "p2", "bat", "neg")] });
for (const [rightHole, side] of [[10, "left"], [20, "right"]]) {
  const open = W.computePoweredSet(circuit(false, rightHole)).poweredComps, split = W.computePoweredSet(circuit(true, rightHole)).poweredComps;
  const cOpen = window.computeSimPoweredSet(circuit(false, rightHole)).poweredComps, cSplit = window.computeSimPoweredSet(circuit(true, rightHole)).poweredComps;
  ok(open.has("r") && cOpen.has("r"), `unsplit: a wire to rail hole ${rightHole} (${side} half) is on the same rail as hole 3`);
  ok(split.has("r") === (side === "left") && cSplit.has("r") === (side === "left"), `split: hole ${rightHole} (${side} half) ${side === "left" ? "is" : "is NOT"} joined to hole 3, in both engines`);
}
// analysis sees it: resistor from hole 3 to hole 20 with a split rail has no loop
const loopData = (split) => ({ components: [{ id: "bb", type: "breadboard", x: 0, y: 0, cols: 30, ...(split ? { splitRails: true } : {}) }, { id: "bat", type: "battery", x: 0, y: 200, voltage: 9 }, { id: "r", type: "resistor", x: 300, y: 200, resistance: 100 }],
  wires: [wire("a", "bat", "pos", "bb", "rpt3"), wire("b", "r", "p1", "bb", "rpt20"), wire("c", "r", "p2", "bat", "neg")] });
ok(Math.abs(W.computeCircuitAnalysis(loopData(false)).r.currentMa - 90) < 1e-9, "unsplit rail: the loop closes and 90 mA flows");
ok(W.computeCircuitAnalysis(loopData(true)).r === undefined && window.computeSimElectricalAnalysis(loopData(true)).r === undefined, "split rail: no loop, so no analysis for the resistor (both engines)");
// ohmmeter across halves
const ohm = (split) => ({ components: [{ id: "bb", type: "breadboard", x: 0, y: 0, cols: 30, ...(split ? { splitRails: true } : {}) }, { id: "om", type: "ohmmeter", x: 0, y: 0 }], wires: [wire("a", "om", "p1", "bb", "rpt3"), wire("b", "om", "p2", "bb", "rpt20")] });
ok(W.computeCircuitAnalysis(ohm(false)).om.ohms === 0 && W.computeCircuitAnalysis(ohm(true)).om.status === "open", "an ohmmeter across the rail reads 0 Ω unsplit and OL split");
// validation
const good = { components: [{ id: "bb", type: "breadboard", x: 0, y: 0, cols: 30, splitRails: true }], wires: [] };
ok(simulationDataError(good) === null, "the server accepts splitRails: true");
ok(/split-rails/.test(simulationDataError({ components: [{ id: "bb", type: "breadboard", x: 0, y: 0, cols: 30, splitRails: "yes" }], wires: [] }) || ""), "the server refuses a non-boolean splitRails");
ok(simulationDataError({ components: [{ id: "bb", type: "breadboard", x: 0, y: 0, cols: 30 }], wires: [] }) === null, "old breadboards without the field still validate");
// the public SVG
const svg = W.renderSimulationSvg(good); ok((svg.match(/bb-rail-line/g) || []).length === 8, "the public SVG draws the split rails");
console.log(fail ? `FAILURES ${fail}` : "ALL PASS"); process.exit(fail ? 1 : 0);
