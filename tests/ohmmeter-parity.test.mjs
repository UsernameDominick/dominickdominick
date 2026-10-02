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
const near = (a, b, tol = 1e-9) => typeof a === "number" && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const both = (data) => { const w = W.computeCircuitAnalysis(data), c = window.computeSimElectricalAnalysis(data); return { w, c, same: JSON.stringify(w) === JSON.stringify(c) }; };
const res = (id, ohms) => ({ id, type: "resistor", x: 100, y: 10, resistance: ohms });
const wire = (id, a, ap, b, bp) => ({ id, from: { compId: a, pin: ap }, to: { compId: b, pin: bp } });
const om = (id = "om") => ({ id, type: "ohmmeter", x: 300, y: 200 });
const bat = () => ({ id: "bat", type: "battery", x: 10, y: 10, voltage: 9 });
const across = (id, comp, a = "p1", b = "p2") => [wire(id + "1", id, "p1", comp, a), wire(id + "2", id, "p2", comp, b)];

// definitions match
let bad = null, n = 0;
for (const rotation of [0, 90, 180, 270]) for (const mirror of [false, true]) {
  const comp = { id: "o", type: "ohmmeter", x: 0, y: 0, ...(rotation ? { rotation } : {}), ...(mirror ? { mirror: true } : {}) };
  const c = window.getSimComponentDefinition(comp), w = W.getSimulationComponentDefinition(comp); n++;
  if (!(c && w && c.w === w.w && c.h === w.h && JSON.stringify(c.pins) === JSON.stringify(w.pins) && c.render(comp) === w.render(comp))) bad = { rotation, mirror };
}
ok(!bad, `client and worker definitions match across ${n} orientations`, bad);
const fmt = [[0, "0Ω"], [0.5, "0.50Ω"], [1, "1.00Ω"], [33.333, "33.3Ω"], [220, "220Ω"], [999.6, "1.00kΩ"], [4700, "4.70kΩ"], [47000, "47.0kΩ"], [1e6, "1.00MΩ"], [2.2e9, "2.20GΩ"]];
ok(fmt.every(([v, t]) => W.formatOhms(v, "normal") === t && window.simFormatOhms(v, "normal") === t), "formatOhms matches in both engines", fmt.filter(([v, t]) => W.formatOhms(v, "normal") !== t).map(([v]) => [v, W.formatOhms(v, "normal")]));
ok(W.formatOhms(null, "open") === "OL" && W.formatOhms(null, "no-reading") === "—" && W.formatOhms(NaN) === "—", "OL for open, a dash for no reading");

// exact values
const val = (data, id = "om") => { const r = both(data); return { same: r.same, r: r.w[id] }; };
let d = { components: [res("r1", 100), res("r2", 200), om()], wires: [wire("s", "r1", "p2", "r2", "p1"), wire("a", "om", "p1", "r1", "p1"), wire("b", "om", "p2", "r2", "p2")] };
let q = val(d); ok(q.same && near(q.r.ohms, 300) && q.r.status === "normal", "series 100 + 200 reads 300", q.r);
d = { components: [res("r1", 100), res("r2", 100), om()], wires: [wire("p", "r1", "p1", "r2", "p1"), wire("q", "r1", "p2", "r2", "p2"), wire("a", "om", "p1", "r1", "p1"), wire("b", "om", "p2", "r1", "p2")] };
q = val(d); ok(q.same && near(q.r.ohms, 50), "two 100 in parallel (same two nodes) reads 50", q.r);
d = { components: [res("r1", 330), om()], wires: [...across("om", "r1")] }; q = val(d); ok(q.same && near(q.r.ohms, 330), "across one resistor reads its value"); 
d = { components: [{ id: "p", type: "potentiometer", x: 0, y: 0, maxResistance: 10000, wiper: 25 }, om()], wires: across("om", "p") }; q = val(d); ok(q.same && near(q.r.ohms, 2500), "a 10k pot at 25% reads 2500", q.r);
// Wheatstone bridge: balanced -> 100, unbalanced matches the reference
const bridge = (r5) => ({ components: [res("r1", 100), res("r2", 100), res("r3", 100), res("r4", 100), res("r5", r5), om()], wires: [
  wire("a1", "om", "p1", "r1", "p1"), wire("a2", "om", "p1", "r2", "p1"), wire("b1", "om", "p2", "r3", "p2"), wire("b2", "om", "p2", "r4", "p2"),
  wire("m1", "r1", "p2", "r3", "p1"), wire("m2", "r2", "p2", "r4", "p1"), wire("x1", "r5", "p1", "r1", "p2"), wire("x2", "r5", "p2", "r2", "p2")] });
q = val(bridge(50)); ok(q.same && near(q.r.ohms, 100), "a balanced Wheatstone bridge reads 100 whatever the bridge resistor", q.r);
const ub = { components: [res("r1", 100), res("r2", 200), res("r3", 300), res("r4", 400), res("r5", 150), om()], wires: bridge(1).wires };
q = val(ub);
// reference by Kron reduction
const kron = (edges, A, B) => {
  const nodes = new Set(); edges.forEach(([a, b]) => { nodes.add(a); nodes.add(b); });
  const L = new Map(); const g = (a, b) => (L.get(a + "|" + b) || 0);
  const add = (a, b, v) => L.set(a + "|" + b, g(a, b) + v);
  edges.forEach(([a, b, r]) => { add(a, a, 1 / r); add(b, b, 1 / r); add(a, b, -1 / r); add(b, a, -1 / r); });
  const rest = [...nodes].filter((x) => x !== A && x !== B);
  for (const k of rest) {
    const others = [...nodes].filter((x) => x !== k);
    for (const i of others) for (const j of others) add(i, j, -g(i, k) * g(k, j) / g(k, k));
    nodes.delete(k);
  }
  const g12 = -g(A, B); return 1 / g12;
};
const refUb = kron([["A", "m1", 100], ["A", "m2", 200], ["m1", "B", 300], ["m2", "B", 400], ["m1", "m2", 150]], "A", "B");
ok(q.same && near(q.r.ohms, refUb, 1e-9), "an unbalanced bridge matches an independent (Kron) reference", [q.r.ohms, refUb]);

// open / switches / shorts / zero
d = { components: [res("r1", 100), res("r2", 100), om()], wires: [wire("a", "om", "p1", "r1", "p1"), wire("b", "om", "p2", "r2", "p2")] };
q = val(d); ok(q.same && q.r.status === "open" && q.r.ohms === null, "two parts with nothing between them reads open (OL)", q.r);
d = { components: [res("r1", 100), { id: "sw", type: "switch", x: 0, y: 0, closed: true }, res("r2", 200), om()], wires: [wire("s1", "r1", "p2", "sw", "p1"), wire("s2", "sw", "p2", "r2", "p1"), wire("a", "om", "p1", "r1", "p1"), wire("b", "om", "p2", "r2", "p2")] };
q = val(d); ok(q.same && near(q.r.ohms, 300), "a closed switch in the path adds nothing", q.r);
d.components[1].closed = false; q = val(d); ok(q.same && q.r.status === "open", "an open switch breaks the path (OL)", q.r);
d = { components: [res("r1", 100), om()], wires: [wire("a", "om", "p1", "r1", "p1"), wire("b", "om", "p2", "r1", "p1")] };
q = val(d); ok(q.same && q.r.ohms === 0 && q.r.status === "normal", "both probes on the same node read 0", q.r);
d = { components: [res("r1", 100), res("r2", 100), om()], wires: [wire("sh", "r1", "p1", "r1", "p2"), wire("s", "r1", "p2", "r2", "p1"), wire("a", "om", "p1", "r1", "p1"), wire("b", "om", "p2", "r2", "p2")] };
q = val(d); ok(q.same && near(q.r.ohms, 100), "a resistor shorted by a wire across its legs drops out", q.r);
d = { components: [res("r1", 100), { id: "led", type: "led", x: 0, y: 0 }, om()], wires: [wire("s", "r1", "p2", "led", "anode"), wire("a", "om", "p1", "r1", "p1"), wire("b", "om", "p2", "led", "cathode")] };
q = val(d); ok(q.same && q.r.status === "open", "an LED reads open to an ohmmeter's tiny test current", q.r);
d = { components: [res("r1", 100), { id: "ind", type: "inductor", x: 0, y: 0 }, om()], wires: [wire("s", "r1", "p2", "ind", "p1"), wire("a", "om", "p1", "r1", "p1"), wire("b", "om", "p2", "ind", "p2")] };
q = val(d); const windingOnly = W.inductorWindingOhms({ id: "ind", type: "inductor" }); ok(q.same && near(q.r.ohms, 100 + windingOnly), "an inductor counts as its winding resistance", [q.r.ohms, windingOnly]);
d = { components: [res("r1", 100), { id: "cap", type: "capacitor", x: 0, y: 0 }, om()], wires: [wire("s", "r1", "p2", "cap", "p1"), wire("a", "om", "p1", "r1", "p1"), wire("b", "om", "p2", "cap", "p2")] };
q = val(d); ok(q.same && q.r.status === "open", "a capacitor blocks (OL)", q.r);

// refuses powered circuits
d = { components: [bat(), res("r1", 100), om()], wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "bat", "neg"), ...across("om", "r1")] };
q = val(d); ok(q.same && q.r.status === "no-reading" && q.r.reason === "powered", "a circuit with a battery wired in gives no reading ('powered')", q.r);
d = { components: [res("r1", 100), om(), { id: "ps", type: "power_supply", x: 0, y: 0 }], wires: [wire("w1", "ps", "out_pos", "r1", "p1"), ...across("om", "r1")] };
q = val(d); ok(q.same && q.r.reason === "powered", "a power supply's output wired in also counts as powered", q.r);
d = { components: [res("r1", 100), om()], wires: [wire("a", "om", "p1", "r1", "p1")] };
q = val(d); ok(q.same && q.r.reason === "unwired", "one unwired probe shows no reading ('unwired')", q.r);
d = { components: [om()], wires: [] }; q = val(d); ok(q.same && q.r.reason === "unwired", "a lone ohmmeter reads nothing ('unwired')");

// meters don't disturb other results; two ohmmeters
const loop = { components: [bat(), res("r1", 100), res("r2", 200)], wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "r2", "p1"), wire("w3", "r2", "p2", "bat", "neg")] };
const withMeters = { components: [...loop.components, om("o1"), om("o2")], wires: [...loop.wires, ...across("o1", "r1"), ...across("o2", "r2")] };
const a1 = both(loop).w, a2 = both(withMeters);
ok(a2.same && JSON.stringify(a1.r1) === JSON.stringify(a2.w.r1) && JSON.stringify(a1.r2) === JSON.stringify(a2.w.r2), "an ohmmeter doesn't change any other part's analysis");
ok(a2.w.o1.reason === "powered" && a2.w.o2.reason === "powered", "both meters in a live loop refuse");

// big network refuses
const big = { components: [om()], wires: [] };
for (let i = 0; i < 280; i++) { big.components.push(res("q" + i, 10)); if (i) big.wires.push(wire("c" + i, "q" + (i - 1), "p2", "q" + i, "p1")); }
big.wires.push(wire("a", "om", "p1", "q0", "p1"), wire("b", "om", "p2", "q279", "p2"));
q = val(big); ok(q.same && q.r.reason === "large", "a network of 280+ nodes is declined rather than slow ('large')", q.r);
const t0 = Date.now(); const mid = { components: [om()], wires: [] }; for (let i = 0; i < 100; i++) { mid.components.push(res("q" + i, 10)); if (i) mid.wires.push(wire("c" + i, "q" + (i - 1), "p2", "q" + i, "p1")); }
mid.wires.push(wire("a", "om", "p1", "q0", "p1"), wire("b", "om", "p2", "q99", "p2")); q = val(mid); ok(q.same && near(q.r.ohms, 1000) && Date.now() - t0 < 500, "a 100-resistor chain reads 1000 quickly", [q.r.ohms, Date.now() - t0]);

// random networks vs the Kron reference, worker == client
let rng = 12345; const rand = () => (rng = (rng * 1664525 + 1013904223) % 4294967296) / 4294967296;
let compared = 0, worst = 0, same = true;
for (let t = 0; t < 400; t++) {
  const nRes = 2 + Math.floor(rand() * 8), nodes = 2 + Math.floor(rand() * 5);
  const comps = [om()], wires = [], edges = [];
  const nodeOf = (k) => (k === 0 ? ["om", "p1"] : k === 1 ? ["om", "p2"] : null);
  // build resistors then wire each pin to a random "net" represented by a hub resistor pin wiring chain
  const nets = Array.from({ length: nodes }, (_, i) => []);
  for (let i = 0; i < nRes; i++) {
    const r = Math.round(10 + rand() * 990); comps.push(res("r" + i, r));
    const a = Math.floor(rand() * nodes); let b = Math.floor(rand() * nodes); if (b === a) b = (a + 1) % nodes;
    nets[a].push(["r" + i, "p1"]); nets[b].push(["r" + i, "p2"]); edges.push([a, b, r]);
  }
  nets[0].push(["om", "p1"]); nets[1].push(["om", "p2"]);
  let wn = 0; nets.forEach((pins) => { for (let i = 1; i < pins.length; i++) wires.push(wire("w" + wn++, pins[0][0], pins[0][1], pins[i][0], pins[i][1])); });
  const data = { components: comps, wires }; const r = both(data); same = same && r.same;
  const reachable = (() => { const adj = new Map(); edges.forEach(([a, b]) => { (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); }); const seen = new Set([0]); const q2 = [0]; while (q2.length) { const c = q2.shift(); for (const x of adj.get(c) || []) if (!seen.has(x)) { seen.add(x); q2.push(x); } } return seen; })();
  const reading = r.w.om;
  if (!nets[0].length || nets[0].length < 2 || nets[1].length < 2) continue;
  if (!reachable.has(1)) { if (reading.status !== "open") { same = false; console.log("expected open", t, reading); } continue; }
  const ref = kron(edges.filter(([a, b]) => reachable.has(a) && reachable.has(b)), 0, 1); compared++; const err = Math.abs(reading.ohms - ref) / ref; worst = Math.max(worst, err);
}
ok(same && compared > 150 && worst < 1e-9, `${compared} random networks: worker == client and every reading matches a Kron-reduction reference (worst relative error ${worst.toExponential(1)})`);

// huge values: open, never a dash; and the OL display range
for (const big of [1e12, 1e20, Infinity]) { const dd = { components: [res("r1", big), om()], wires: across("om", "r1") }; const rr = both(dd); ok(rr.same && rr.w.om.status === "open", `a ${big} ohm part reads as open (OL), not a dash`, rr.w.om); }
{ const dd = { components: [res("r1", 5e10), om()], wires: across("om", "r1") }; const rr = both(dd); ok(rr.same && near(rr.w.om.ohms, 5e10) && W.formatOhms(rr.w.om.ohms, "normal") === "50.0GΩ", "50 GΩ still reads", W.formatOhms(rr.w.om.ohms, "normal")); }
ok(W.formatOhms(2e11, "normal") === "OL" && window.simFormatOhms(2e11, "normal") === "OL", "beyond 100 GΩ the display says OL");
{ const dd = { components: [res("r1", 3e9), res("r2", 6e9), om()], wires: [wire("s", "r1", "p2", "r2", "p1"), wire("a", "om", "p1", "r1", "p1"), wire("b", "om", "p2", "r2", "p2")] }; const rr = both(dd); ok(rr.same && near(rr.w.om.ohms, 9e9), "very large resistances in series still add correctly", rr.w.om.ohms); }
// rendering + server
const svgData = { components: [res("r1", 4700), om()], wires: across("om", "r1") };
const svg = W.renderSimulationSvg(svgData);
ok(/class="ohmmeter-reading"[^>]*>4\.70kΩ</.test(svg), "the public SVG prints the live reading (4.70kΩ)");
const svgOpen = W.renderSimulationSvg({ components: [res("r1", 100), res("r2", 100), om()], wires: [wire("a", "om", "p1", "r1", "p1"), wire("b", "om", "p2", "r2", "p2")] });
ok(/class="ohmmeter-reading"[^>]*>OL</.test(svgOpen), "an open circuit prints OL");
ok(!/<script/i.test(svg), "no markup injection");
ok(/<title>Ohmmeter reading 4\.70kΩ<\/title>/.test(svg), "the public SVG gives the reading a spoken title");
for (const rotation of [90, 180, 270]) { const dd = { components: [res("r1", 330), { ...om(), rotation }], wires: across("om", "r1") }; const rr = both(dd); ok(rr.same && near(rr.w.om.ohms, 330), `rotation ${rotation}: still reads 330`); }
ok(simulationDataError(svgData) === null, "the server accepts circuits with ohmmeters", simulationDataError(svgData));
console.log(fail ? `FAILURES ${fail}` : "ALL PASS"); process.exit(fail ? 1 : 0);
