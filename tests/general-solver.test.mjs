import fs from "node:fs";
import vm from "node:vm";
import * as W from "../worker/simulation-render.js";
const window = {};
const ctx = vm.createContext({ window, console, Math, Number, String, Object, Array, Set, Map, JSON, Infinity, NaN, Float64Array, CSS: { escape: (s) => s } });
vm.runInContext(fs.readFileSync(new URL("../public/admin/sim-solver.js", import.meta.url), "utf8"), ctx);
vm.runInContext(fs.readFileSync(new URL("../public/admin/sim-components.js", import.meta.url), "utf8"), ctx);
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const near = (a, b, tol = 1e-6) => typeof a === "number" && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const both = (data) => { const w = W.computeCircuitAnalysis(data), c = window.computeSimElectricalAnalysis(data); return { w, c, same: JSON.stringify(w) === JSON.stringify(c) }; };
const bat = (id, v = 9, extra = {}) => ({ id, type: "battery", x: 10, y: 10, voltage: v, ...extra });
const res = (id, ohms) => ({ id, type: "resistor", x: 100, y: 10, resistance: ohms });
const led = (id, color = "red") => ({ id, type: "led", x: 300, y: 10, color });
const dio = (id) => ({ id, type: "diode", x: 200, y: 10 });
const amm = (id) => ({ id, type: "ammeter", x: 200, y: 10 });
const vm_ = (id) => ({ id, type: "voltmeter", x: 300, y: 200 });
const wire = (id, a, ap, b, bp) => ({ id, from: { compId: a, pin: ap }, to: { compId: b, pin: bp } });
let wn = 0; const w = (a, ap, b, bp) => wire("w" + wn++, a, ap, b, bp);

// ---- analytic circuits ----
let d = { components: [bat("b"), res("r1", 1000), res("r2", 1000), res("r3", 1000), amm("am")], wires: [w("b", "pos", "am", "p1"), w("am", "p2", "r1", "p1"), w("r1", "p2", "r2", "p1"), w("r1", "p2", "r3", "p1"), w("r2", "p2", "b", "neg"), w("r3", "p2", "b", "neg")] };
let r = both(d);
ok(r.same && near(r.w.am.currentMa, 6, 1e-6) && near(r.w.r1.currentMa, 6, 1e-6) && near(r.w.r2.currentMa, 3, 1e-6) && near(r.w.r3.currentMa, 3, 1e-6), "R1 in series with R2||R3 (1k each) on 9 V: 6 mA in R1 and the ammeter, 3 mA in each branch", [r.w.am.currentMa, r.w.r1.currentMa, r.w.r2.currentMa, r.w.r3.currentMa]);
ok(!r.c.meta.parallel, "a solved parallel circuit no longer raises the parallel-branch warning flag");
// bridge with ammeter across the middle
const bridge = (rb) => ({ components: [bat("b"), res("r1", 100), res("r2", 200), res("r3", 300), res("r4", 400), amm("am")], wires: [w("b", "pos", "r1", "p1"), w("b", "pos", "r2", "p1"), w("r1", "p2", "r3", "p1"), w("r2", "p2", "r4", "p1"), w("r3", "p2", "b", "neg"), w("r4", "p2", "b", "neg"), w("am", "p1", "r1", "p2"), w("am", "p2", "r2", "p2")] });
r = both(bridge());
// reference: nodes top=9, a (r1/r3), c (r2/r4), bottom=0 ; ammeter joins a and c (ideal): single middle node m; r1||r2 ... both from top, r3||r4 to bottom
const vm_mid = (() => { const gTop = 1 / 100 + 1 / 200, gBot = 1 / 300 + 1 / 400; return 9 * gTop / (gTop + gBot); })();
const iAm = (9 - vm_mid) / 100 - (vm_mid - 0) / 300; // current r1 minus current r3 flows through the ammeter a->c? net into a is i1 - i3 flows a->c
ok(r.same && near(r.w.am.currentMa, Math.abs(iAm) * 1000, 1e-6), "a bridge with an ammeter across the middle reads the unbalanced current", [r.w.am.currentMa, Math.abs(iAm) * 1000]);
// two batteries in parallel with internal resistance share current
d = { components: [bat("b1", 9, { internalResistance: 1 }), bat("b2", 9, { internalResistance: 1 }), res("r", 100), amm("a1")], wires: [w("b2", "pos", "r", "p1"), w("r", "p2", "b1", "neg"), w("r", "p2", "b2", "neg"), w("a1", "p1", "b1", "pos"), w("a1", "p2", "r", "p1")] };
r = both(d);
ok(r.same && near(r.w.r.currentMa, 9 / 100.5 * 1000, 1e-6) && near(r.w.a1.currentMa, 9 / 100.5 * 1000 / 2, 1e-6), "two 9 V cells with 1 ohm internal resistance in parallel share the load current equally", [r.w.r.currentMa, r.w.a1.currentMa]);
// cells in series
d = { components: [bat("c1", 1.5), bat("c2", 1.5), res("r", 100)], wires: [w("c1", "pos", "c2", "neg"), w("c2", "pos", "r", "p1"), w("r", "p2", "c1", "neg")] };
r = both(d); ok(r.same && near(r.w.r.currentMa, 30, 1e-6), "two 1.5 V cells in series drive 30 mA through 100 ohm", r.w.r);
// diode-OR: two batteries through diodes to a load
d = { components: [bat("hi", 9), bat("lo", 5), dio("d1"), dio("d2"), res("r", 100)], wires: [w("hi", "pos", "d1", "anode"), w("lo", "pos", "d2", "anode"), w("d1", "cathode", "r", "p1"), w("d2", "cathode", "r", "p1"), w("r", "p2", "hi", "neg"), w("r", "p2", "lo", "neg")] };
r = both(d); ok(r.same && near(r.w.r.currentMa, (9 - 0.7) / 100 * 1000, 1e-3) && r.w.d1.status === "normal" && r.w.d2.status === "reversed", "a diode-OR picks the higher supply: 83 mA from the 9 V cell, the 5 V diode is reverse biased ('reversed')", [r.w.r.currentMa, r.w.d1.status, r.w.d2.status]);
// parallel LED branches
d = { components: [bat("b", 9), res("r1", 470), res("r2", 1000), led("l1"), led("l2", "blue")], wires: [w("b", "pos", "r1", "p1"), w("b", "pos", "r2", "p1"), w("r1", "p2", "l1", "anode"), w("r2", "p2", "l2", "anode"), w("l1", "cathode", "b", "neg"), w("l2", "cathode", "b", "neg")] };
r = both(d); ok(r.same && near(r.w.l1.currentMa, (9 - 2.0) / 470 * 1000, 1e-3) && near(r.w.l2.currentMa, (9 - 3.2) / 1000 * 1000, 1e-3) && r.w.l1.status === "normal", "two LED branches each take (9 - Vf)/R: red on 470 ohm, blue on 1k", [r.w.l1.currentMa, r.w.l2.currentMa]);
// LED in parallel with a diode: the lower drop clamps
d = { components: [bat("b", 9), res("r", 330), led("l"), dio("dd")], wires: [w("b", "pos", "r", "p1"), w("r", "p2", "l", "anode"), w("r", "p2", "dd", "anode"), w("l", "cathode", "b", "neg"), w("dd", "cathode", "b", "neg")] };
r = both(d); ok(r.same && near(r.w.dd.currentMa, (9 - 0.7) / 330 * 1000, 1e-3) && r.w.l.currentMa === 0 && r.w.l.status === "unlit-low-voltage", "a diode across an LED clamps it at 0.7 V: the LED is off ('unlit-low-voltage')", [r.w.l, r.w.dd.currentMa]);
// reversed diode in a side branch
d = { components: [bat("b", 9), res("r1", 100), res("r2", 100), dio("dd")], wires: [w("b", "pos", "r1", "p1"), w("b", "pos", "r2", "p1"), w("r1", "p2", "b", "neg"), w("r2", "p2", "dd", "anode"), w("dd", "cathode", "b", "neg")] };
r = both(d); ok(r.same && near(r.w.r1.currentMa, 90, 1e-6) && near(r.w.r2.currentMa, 83, 1e-3), "forward diode in a side branch: r2 carries (9 - 0.7)/100", [r.w.r1.currentMa, r.w.r2.currentMa]);
d.wires[3] = w("r2", "p2", "dd", "cathode"); d.wires[4] = w("dd", "anode", "b", "neg");
r = both(d); ok(r.same && near(r.w.r1.currentMa, 90, 1e-6) && r.w.r2.currentMa < 1e-6 && r.w.dd.status === "reversed", "the same diode reversed blocks its branch: r2 carries nothing, the diode is 'reversed'", [r.w.r2.currentMa, r.w.dd.status]);
// shorted LED branch (wire across): burns the resistor, LED has no result
d = { components: [bat("b", 9), res("r", 10), res("r2", 10), led("l")], wires: [w("b", "pos", "r", "p1"), w("r", "p2", "l", "anode"), w("l", "cathode", "b", "neg"), w("b", "pos", "r2", "p1"), w("r2", "p2", "b", "neg")] };
r = both(d); ok(r.same && near(r.w.r2.currentMa, 900, 1e-6) && r.w.r2.status === "overheating", "a parallel 10 ohm resistor across 9 V carries 900 mA and overheats", r.w.r2);
// voltmeters anywhere in a solved network
d = { components: [bat("b"), res("r1", 100), res("r2", 200), res("r3", 300), vm_("v1"), vm_("v2")], wires: [w("b", "pos", "r1", "p1"), w("r1", "p2", "r2", "p1"), w("r1", "p2", "r3", "p1"), w("r2", "p2", "b", "neg"), w("r3", "p2", "b", "neg"), w("v1", "pos", "r2", "p1"), w("v1", "neg", "b", "neg"), w("v2", "pos", "r1", "p1"), w("v2", "neg", "r1", "p2")] };
r = both(d); const vpar = 9 * (120 / (100 + 120)); ok(r.same && near(r.w.v1.volts, vpar, 1e-9) && near(r.w.v2.volts, 9 - vpar, 1e-9), "voltmeters read the shared-node voltage (R2||R3 = 120 ohm) and the drop across R1", [r.w.v1.volts, r.w.v2.volts, vpar]);
// dead short / contradiction fall back to the one-path figures, no crash
d = { components: [bat("b1", 9), bat("b2", 5)], wires: [w("b1", "pos", "b2", "pos"), w("b1", "neg", "b2", "neg")] };
r = both(d); ok(r.same, "two ideal sources of different voltage in parallel (a contradiction): declined, engines agree, no crash");
d = { components: [bat("b"), res("r", 100)], wires: [w("b", "pos", "b", "neg"), w("b", "pos", "r", "p1"), w("r", "p2", "b", "neg")] };
r = both(d); ok(r.same && Object.values(r.w).every((x) => x), "a battery shorted by a wire is declined and the engines agree");
// outlet networks keep the one-path 'dangerous' behaviour
d = { components: [{ id: "o", type: "outlet", x: 0, y: 0 }, res("r1", 100), res("r2", 100)], wires: [w("o", "hot", "r1", "p1"), w("o", "hot", "r2", "p1"), w("r1", "p2", "o", "neutral"), w("r2", "p2", "o", "neutral")] };
r = both(d); ok(r.same && r.w.r1.dangerous === true, "an outlet network is left to the one-path rules (dangerous)", r.w.r1);
// unsolvable networks keep the one-path warning flag
{ const op = { components: [{ id: "o", type: "outlet", x: 0, y: 0 }, res("r1", 100), res("r2", 100)], wires: [w("o", "hot", "r1", "p1"), w("o", "hot", "r2", "p1"), w("r1", "p2", "o", "neutral"), w("r2", "p2", "o", "neutral")] };
  ok(window.computeSimElectricalAnalysis(op).meta.parallel === true, "a parallel outlet network (left to the one-path rules) still raises the parallel warning flag");
  const shortPar = { components: [bat("b"), res("r1", 100), res("r2", 100)], wires: [w("b", "pos", "b", "neg"), w("b", "pos", "r1", "p1"), w("b", "pos", "r2", "p1"), w("r1", "p2", "b", "neg"), w("r2", "p2", "b", "neg")] };
  const win2 = {}; const c3 = vm.createContext({ window: win2, console, Math, Number, String, Object, Array, Set, Map, JSON, Infinity, NaN, Float64Array, CSS: { escape: (s) => s } }); vm.runInContext(fs.readFileSync(new URL("../public/admin/sim-components.js", import.meta.url), "utf8"), c3);
  ok(JSON.stringify(window.computeSimElectricalAnalysis(shortPar)) === JSON.stringify(win2.computeSimElectricalAnalysis(shortPar)), "a dead-shorted battery with resistors across it is left to the one-path rules, unchanged"); }
// ---- fixes from the critic ----
// stale one-path results are cleared inside a solved network: an LED shorted by a closed switch in parallel
{ const sw = { id: "sw", type: "switch", x: 0, y: 0, closed: true };
  const dd = { components: [bat("b"), res("r", 330), led("l"), sw, res("r2", 1000)], wires: [w("b", "pos", "r", "p1"), w("r", "p2", "l", "anode"), w("l", "cathode", "b", "neg"), w("l", "anode", "sw", "p1"), w("l", "cathode", "sw", "p2"), w("b", "pos", "r2", "p1"), w("r2", "p2", "b", "neg")] };
  const rr = both(dd); ok(rr.same && near(rr.w.r.currentMa, 9 / 330 * 1000, 1e-6) && rr.w.l === undefined, "an LED shorted by a closed switch keeps no stale 'normal' result; the resistor reads the full 27.3 mA", [rr.w.l, rr.w.r.currentMa]); }
// contradicting ideal sources: declined AND flagged, not silent
{ const dd = { components: [bat("b1", 9), bat("b2", 5), res("r", 100)], wires: [w("b1", "pos", "r", "p1"), w("b2", "pos", "r", "p1"), w("r", "p2", "b1", "neg"), w("r", "p2", "b2", "neg")] };
  const rr = both(dd); ok(rr.same && rr.c.meta.parallel === true, "two ideal cells of different voltage in parallel: declined, and the warning flag is raised", rr.c.meta);
  const same9 = { components: [bat("b1", 9), bat("b2", 9), res("r", 100)], wires: dd.wires };
  ok(window.computeSimElectricalAnalysis(same9).meta.parallel === true, "two identical ideal cells in parallel (indeterminate sharing): flagged too"); }
// labels: a forward-biased LED below its drop is 'unlit-low-voltage', never 'blocked' in a solved network
{ const dd = { components: [bat("b", 3), res("r1", 100), res("r2", 100), led("l", "blue")], wires: [w("b", "pos", "r1", "p1"), w("b", "pos", "r2", "p1"), w("r1", "p2", "l", "anode"), w("l", "cathode", "b", "neg"), w("r2", "p2", "b", "neg")] };
  const rr = both(dd); ok(rr.same && rr.w.l.status === "unlit-low-voltage", "a blue LED on 3 V in a parallel circuit is 'unlit-low-voltage'", rr.w.l); }
// floating island: a node joined only through an off diode gives no voltmeter reading
{ const dd = { components: [bat("b", 9), res("r1", 100), res("r2", 100), dio("d"), res("r3", 100), vm_("v1"), vm_("v2")], wires: [w("b", "pos", "r1", "p1"), w("b", "pos", "r2", "p1"), w("r1", "p2", "b", "neg"), w("r2", "p2", "b", "neg"), w("b", "neg", "d", "anode"), w("d", "cathode", "r3", "p1"), w("v1", "pos", "r3", "p1"), w("v1", "neg", "b", "neg"), w("v2", "pos", "r1", "p1"), w("v2", "neg", "b", "neg")] };
  const rr = both(dd); ok(rr.same && rr.w.v1.volts === null && near(rr.w.v2.volts, 9, 1e-6), "a meter on a node behind an off diode (a floating island) shows a dash; a meter in the live network still reads", [rr.w.v1, rr.w.v2.volts]); }
// an island that carries its own source: meters inside it read, a meter between the two islands says nothing
{ const dd = { components: [bat("b", 9), res("r1", 100), res("r2", 100), dio("d"), bat("c", 5), res("r4", 100), vm_("va"), vm_("vb"), vm_("vx")], wires: [w("b", "pos", "r1", "p1"), w("b", "pos", "r2", "p1"), w("r1", "p2", "b", "neg"), w("r2", "p2", "b", "neg"), w("b", "neg", "d", "anode"), w("d", "cathode", "c", "pos"), w("c", "pos", "r4", "p1"), w("r4", "p2", "c", "neg"), w("va", "pos", "r1", "p1"), w("va", "neg", "b", "neg"), w("vb", "pos", "r4", "p1"), w("vb", "neg", "r4", "p2"), w("vx", "pos", "b", "pos"), w("vx", "neg", "c", "neg")] };
  const rr = both(dd); ok(rr.same && near(rr.w.va.volts, 9, 1e-6) && near(rr.w.vb.volts, 5, 1e-6) && rr.w.vx.volts === null, "an island with its own battery behind an off diode: a meter inside each island reads, a meter across the two islands shows a dash", [rr.w.va.volts, rr.w.vb.volts, rr.w.vx]); }
// plain series circuits are byte-identical to before (no engagement)
const series = { components: [bat("b"), res("r1", 100), res("r2", 200), led("l")], wires: [w("b", "pos", "r1", "p1"), w("r1", "p2", "r2", "p1"), w("r2", "p2", "l", "anode"), w("l", "cathode", "b", "neg")] };
const oldCtx = vm.createContext({ window: {}, console, Math, Number, String, Object, Array, Set, Map, JSON, Infinity, NaN, Float64Array, CSS: { escape: (s) => s } });
r = both(series); const noSolver = (() => { const win = {}; const c2 = vm.createContext({ window: win, console, Math, Number, String, Object, Array, Set, Map, JSON, Infinity, NaN, Float64Array, CSS: { escape: (s) => s } }); vm.runInContext(fs.readFileSync(new URL("../public/admin/sim-components.js", import.meta.url), "utf8"), c2); return win.computeSimElectricalAnalysis(series); })();
ok(JSON.stringify(noSolver) === JSON.stringify(r.c), "a plain series loop gives exactly the same results with or without the general solver");

// ---- random networks vs an independent reference ----
let rng = 2024; const rand = () => (rng = (rng * 1664525 + 1013904223) % 4294967296) / 4294967296;
const env = { getDef: window.getSimComponentDefinition, nodeId: window.simNodeId, isSwitchClosed: window.simIsSwitchClosed, spdtThrow: window.simSpdtThrow, validWire: (x) => Boolean(x && x.from && x.to), inductorOhms: W.inductorWindingOhms,
  forwardVoltage: (c) => (c.type === "diode" ? W.DIODE_FORWARD_V : W.LED_COLORS[c.color].forwardVoltage), supplyActive: () => false, limits: { ledMa: 20, diodeMa: 1000, resistorWatts: 0.25, teensyWatts: 1, teensyOhms: 300 } };
const pinsOf = { battery: ["pos", "neg"], resistor: ["p1", "p2"], led: ["anode", "cathode"], diode: ["anode", "cathode"], ammeter: ["p1", "p2"] };
function reference(data) {
  // independent: union nodes by wires, Norton-convert sources, enumerate diode states, solve with plain Gauss-Jordan
  const parent = {}; const f = (x) => (parent[x] === undefined || parent[x] === x ? (parent[x] = x) : (parent[x] = f(parent[x])));
  const comps = data.components; const nid = (c, p) => `${c.id}.${p}`;
  comps.forEach((c) => pinsOf[c.type].forEach((p) => f(nid(c, p))));
  data.wires.forEach((x) => { const a = f(nid(comps.find((c) => c.id === x.from.compId), x.from.pin)), b = f(nid(comps.find((c) => c.id === x.to.compId), x.to.pin)); if (a !== b) parent[a] = b; });
  const N = (c, p) => f(nid(c, p));
  const names = new Set(); comps.forEach((c) => pinsOf[c.type].forEach((p) => names.add(N(c, p)))); const list = [...names]; const idx = Object.fromEntries(list.map((n, i) => [n, i]));
  const diodes = comps.filter((c) => c.type === "led" || c.type === "diode"); const results = {};
  for (let mask = 0; mask < 1 << diodes.length; mask++) {
    const n = list.length; const G = Array.from({ length: n }, () => new Float64Array(n + 1));
    const stampG = (a, b, g) => { G[idx[a]][idx[a]] += g; G[idx[b]][idx[b]] += g; G[idx[a]][idx[b]] -= g; G[idx[b]][idx[a]] -= g; };
    const stampI = (a, b, i) => { G[idx[a]][n] += i; G[idx[b]][n] -= i; }; // current i injected into a (and drawn from b)
    comps.forEach((c) => {
      if (c.type === "resistor") stampG(N(c, "p1"), N(c, "p2"), 1 / c.resistance);
      else if (c.type === "ammeter") stampG(N(c, "p1"), N(c, "p2"), 1e6);
      else if (c.type === "battery") { const rr = c.internalResistance || 1; stampG(N(c, "pos"), N(c, "neg"), 1 / rr); stampI(N(c, "pos"), N(c, "neg"), c.voltage / rr); }
    });
    const on = diodes.map((c, i) => Boolean(mask & (1 << i)));
    diodes.forEach((c, i) => { if (on[i]) { const vf = env.forwardVoltage(c); stampG(N(c, "anode"), N(c, "cathode"), 1 / 0.001); stampI(N(c, "anode"), N(c, "cathode"), vf / 0.001); } });
    // ground every connected component weakly, then solve
    for (let i = 0; i < n; i++) G[i][i] += 1e-15;
    // pin the first node of each component by a big conductance to ground-equivalent: use a global ground at node 0 of each component
    const comp = {}; const cf = (x) => (comp[x] === undefined || comp[x] === x ? (comp[x] = x) : (comp[x] = cf(comp[x]))); list.forEach((x) => cf(x));
    comps.forEach((c) => { const ps = pinsOf[c.type].map((p) => N(c, p)); if (c.type !== "battery") { const a = cf(ps[0]), b = cf(ps[1]); if (a !== b) comp[a] = b; } else { const a = cf(ps[0]), b = cf(ps[1]); if (a !== b) comp[a] = b; } });
    const firstOf = {}; list.forEach((x) => { const r = cf(x); if (firstOf[r] === undefined) firstOf[r] = x; });
    Object.values(firstOf).forEach((x) => { G[idx[x]][idx[x]] += 1e9; });
    const V = gauss(G, n); if (!V) continue;
    const volt = (x) => V[idx[x]];
    // consistency
    let good = true;
    diodes.forEach((c, i) => { const vd = volt(N(c, "anode")) - volt(N(c, "cathode")); const vf = env.forwardVoltage(c); if (on[i]) { const cur = (vd - vf) / 0.001; if (cur < -1e-9) good = false; } else if (vd > vf + 1e-7) good = false; });
    if (!good) continue;
    comps.forEach((c) => {
      if (c.type === "resistor") results[c.id] = Math.abs(volt(N(c, "p1")) - volt(N(c, "p2"))) / c.resistance * 1000;
      else if (c.type === "ammeter") results[c.id] = Math.abs(volt(N(c, "p1")) - volt(N(c, "p2"))) * 1e6 * 1000;
    });
    diodes.forEach((c, i) => { results[c.id] = on[i] ? Math.max(0, (volt(N(c, "anode")) - volt(N(c, "cathode")) - env.forwardVoltage(c)) / 0.001) * 1000 : 0; });
    return results;
  }
  return null;
}
function gauss(A, n) { const m = A.map((r) => Float64Array.from(r)); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r; if (Math.abs(m[p][c]) < 1e-30) return null; [m[c], m[p]] = [m[p], m[c]]; for (let r = 0; r < n; r++) { if (r === c) continue; const k = m[r][c] / m[c][c]; if (!k) continue; for (let j = c; j <= n; j++) m[r][j] -= k * m[c][j]; } } return Array.from({ length: n }, (_, i) => m[i][n] / m[i][i]); }
const reasons = {}; let declinedSolver = 0, declinedRef = 0; let compared = 0, mismatches = 0, declined = 0, worst = 0, firstBad = null;
for (let t = 0; t < 1500; t++) {
  const comps = []; const nb = 1 + Math.floor(rand() * 2); for (let i = 0; i < nb; i++) comps.push(bat("b" + i, [1.5, 3, 5, 9, 12][Math.floor(rand() * 5)], { internalResistance: [0.5, 1, 2][Math.floor(rand() * 3)] }));
  const extra = 2 + Math.floor(rand() * 6); for (let i = 0; i < extra; i++) { const k = rand(); const id = "c" + i; comps.push(k < 0.45 ? res(id, [47, 100, 220, 470, 1000][Math.floor(rand() * 5)]) : k < 0.65 ? led(id, ["red", "blue", "green"][Math.floor(rand() * 3)]) : k < 0.85 ? dio(id) : amm(id)); }
  const wires = []; const nw = 3 + Math.floor(rand() * 10); for (let i = 0; i < nw; i++) { const a = comps[Math.floor(rand() * comps.length)], b = comps[Math.floor(rand() * comps.length)]; const pa = pinsOf[a.type][Math.floor(rand() * 2)], pb = pinsOf[b.type][Math.floor(rand() * 2)]; if (a === b && pa === pb) continue; wires.push(wire("w" + i, a.id, pa, b.id, pb)); }
  const data = { components: comps, wires };
  const engage = new Set(comps.flatMap((c) => pinsOf[c.type].map((p) => env.nodeId(c, p))));
  const solved = window.SimSolver.analyze(data, env, engage);
  const ref = reference(data);
  if (!solved) { declined++; declinedSolver++; for (const r of window.SimSolver.lastDeclines) reasons[r] = (reasons[r] || 0) + 1; continue; }
  if (!ref) { declined++; declinedRef++; continue; }
  compared++;
  for (const c of comps) {
    if (c.type === "battery") continue;
    const got = solved.results[c.id]; if (!got) continue;
    const want = ref[c.id]; if (want === undefined) continue;
    const err = Math.abs(got.currentMa - want) / Math.max(1e-3, Math.abs(want)); // mA
    if (c.type === "ammeter" && want > 1e4) continue; // reference's 1 micro-ohm ammeter loses precision on huge currents
    if (err > 2e-3 && Math.abs(got.currentMa - want) > 1e-3) { mismatches++; if (!firstBad) firstBad = { t, id: c.id, got: got.currentMa, want, data: JSON.stringify(data).slice(0, 400) }; }
    worst = Math.max(worst, err);
  }
}
ok(mismatches === 0 && compared > 300, `${compared} random networks (${declined} declined): the solver's currents match an independent reference (every diode state enumerated) — ${mismatches} mismatches`, firstBad || { worst });
console.log('declined by solver', declinedSolver, JSON.stringify(reasons), 'by reference', declinedRef);
console.log(fail ? `FAILURES ${fail}` : "ALL PASS"); process.exit(fail ? 1 : 0);
