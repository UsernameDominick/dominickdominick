import fs from "node:fs";
import vm from "node:vm";
import * as W from "../worker/simulation-render.js";
const window = {};
const ctx = vm.createContext({ window, console, Math, Number, String, Object, Array, Set, Map, JSON, Infinity, NaN, Float64Array, CSS: { escape: (s) => s } });
vm.runInContext(fs.readFileSync(new URL("../public/admin/sim-solver.js", import.meta.url), "utf8"), ctx);
vm.runInContext(fs.readFileSync(new URL("../public/admin/sim-schematic.js", import.meta.url), "utf8"), ctx);
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
const tr = (id, polarity = "npn", gain) => ({ id, type: "transistor", x: 200, y: 100, polarity, ...(gain ? { gain } : {}) });
const near2 = near;
// NPN low-side switch driving an LED: battery+ -> R_load -> LED -> collector; emitter -> battery-; battery+ -> R_base -> base
const lowSide = (rb, polarity = "npn") => ({ components: [bat("b", 9), res("rb", rb), res("rc", 330), led("l"), tr("q", polarity)], wires: [w("b", "pos", "rc", "p1"), w("rc", "p2", "l", "anode"), w("l", "cathode", "q", "collector"), w("q", "emitter", "b", "neg"), w("b", "pos", "rb", "p1"), w("rb", "p2", "q", "base")] });
let d = lowSide(10000), r = both(d);
ok(r.same && r.w.q.region === "saturated" && near(r.w.l.currentMa, (9 - 2.0 - 0.2) / 330 * 1000, 1e-3) && r.w.l.status === "normal", "NPN switch with 10k base: saturated, the LED gets (9 - 2.0 - 0.2) / 330 = 20.6 mA", [r.w.q, r.w.l]);
ok(near(r.w.q.baseMa, (9 - 0.7) / 10000 * 1000, 1e-3) && near(r.w.q.vce, 0.2, 1e-6), "base current (9 - 0.7)/10k = 0.83 mA, Vce 0.2 V", [r.w.q.baseMa, r.w.q.vce]);
ok(!r.c.meta.parallel, "a solved transistor circuit raises no warning flag");
d = lowSide(1000000); r = both(d);
ok(r.same && r.w.q.region === "active" && near(r.w.q.currentMa, 100 * 8.3e-3, 1e-3) && r.w.l.status === "dim", "NPN with a 1 M base resistor is active: Ic = 100 x 8.3 uA = 0.83 mA, the LED is dim", [r.w.q.region, r.w.q.currentMa, r.w.l.status]);
// base left open: off
d = lowSide(10000); d.wires = d.wires.filter((x) => x.to.pin !== "base" && x.from.pin !== "base"); r = both(d);
ok(r.same && r.w.q.region === "off" && r.w.q.status === "off" && r.w.q.currentMa === 0 && r.w.l.status === "idle" && r.w.l.currentMa === 0, "base left unwired: the transistor is off and the LED is idle (no current)", [r.w.q, r.w.l]);
// with gain set
d = lowSide(1000000); d.components.find((x) => x.id === "q").gain = 300; r = both(d);
ok(r.same && near(r.w.q.currentMa, 300 * 8.3e-3, 1e-3), "gain 300 triples the collector current", r.w.q.currentMa);
// PNP high side: emitter to battery+, base via R to battery-, collector -> LED -> R -> battery-
const highSide = { components: [bat("b", 9), res("rb", 10000), res("rc", 330), led("l"), tr("q", "pnp")], wires: [w("b", "pos", "q", "emitter"), w("q", "collector", "l", "anode"), w("l", "cathode", "rc", "p1"), w("rc", "p2", "b", "neg"), w("q", "base", "rb", "p1"), w("rb", "p2", "b", "neg")] };
r = both(highSide);
ok(r.same && r.w.q.region === "saturated" && r.w.q.polarity === "pnp" && near(r.w.l.currentMa, (9 - 2.0 - 0.2) / 330 * 1000, 1e-3), "PNP high-side switch: saturated, same LED current", [r.w.q, r.w.l]);
// burn-out
d = lowSide(10000); d.components[1].resistance = 10; r = both(d);
ok(r.same && (r.w.q.status === "burnt" || r.w.q.status === "overdriven"), "a 10 ohm base resistor pushes far too much base current: " + r.w.q.status, [r.w.q.baseMa]);
// powered view: wires beside a conducting transistor are lit, with the base unwired nothing is
const pc = window.computeSimPoweredSet(lowSide(10000));
const pw = W.computePoweredSet(lowSide(10000));
ok(JSON.stringify([...pc.poweredComps].sort()) === JSON.stringify([...pw.poweredComps].sort()) && pc.poweredComps.has("l") && pc.poweredComps.has("q"), "powered view: the LED and the transistor are powered when the base is driven", [...pc.poweredComps]);
const noBase = lowSide(10000); noBase.wires = noBase.wires.filter((x) => x.to.pin !== "base" && x.from.pin !== "base");
const pc2 = window.computeSimPoweredSet(noBase), pw2 = W.computePoweredSet(noBase);
ok(!pc2.poweredComps.has("l") && JSON.stringify([...pc2.poweredComps].sort()) === JSON.stringify([...pw2.poweredComps].sort()), "powered view: with the base unwired the LED is not powered, client and worker agree", [...pc2.poweredComps]);
// base wired to ground through a pull-down: NPN off, LED unlit
const pull = lowSide(10000); pull.components[1] = res("rb", 10000); pull.wires = pull.wires.filter((x) => !(x.from.compId === "b" && x.to.compId === "rb")); pull.wires.push(w("b", "neg", "rb", "p1"));
r = both(pull); ok(r.same && r.w.q.region === "off", "base pulled to the negative rail: off", r.w.q.region);
// two transistors: NPN driving a PNP
const two = { components: [bat("b", 9), res("r1", 10000), res("r2", 4700), res("r3", 330), led("l"), tr("q1", "npn"), tr("q2", "pnp")], wires: [w("b", "pos", "r1", "p1"), w("r1", "p2", "q1", "base"), w("q1", "emitter", "b", "neg"), w("b", "pos", "q2", "emitter"), w("b", "pos", "r2", "p1"), w("r2", "p2", "q1", "collector"), w("r2", "p2", "q2", "base"), w("q2", "collector", "l", "anode"), w("l", "cathode", "r3", "p1"), w("r3", "p2", "b", "neg")] };
r = both(two); ok(r.same && r.w.q1.region !== "off" && r.w.q2.region !== "off" && r.w.l.currentMa > 5, "an NPN pulling an PNP's base low turns both on and lights the LED", [r.w.q1.region, r.w.q2.region, r.w.l.currentMa]);
// transistor wired with collector to emitter: ignored, no crash
const shorted = { components: [bat("b", 9), res("rc", 330), tr("q")], wires: [w("b", "pos", "rc", "p1"), w("rc", "p2", "q", "collector"), w("q", "collector", "q", "emitter"), w("q", "emitter", "b", "neg")] };
r = both(shorted); ok(r.same, "collector wired straight to the emitter does not crash and the two renderers agree");
// critic follow-ups: a base held low by a divider, a floating PNP base, base-emitter-only conduction
const div = lowSide(10000); div.components[1] = res("rb", 100000); div.components.push(res("rg", 1000)); div.wires.push(w("rb", "p2", "rg", "p1"), w("rg", "p2", "b", "neg"));
r = both(div); const pcd = window.computeSimPoweredSet(div, r.c), pwd = W.computePoweredSet(div, r.w);
ok(r.same && r.w.q.region === "off" && r.w.l.status === "idle" && !pcd.poweredComps.has("l") && JSON.stringify([...pcd.poweredComps].sort()) === JSON.stringify([...pwd.poweredComps].sort()), "base held at 0.09 V by a divider: transistor off, LED idle and not powered, client = worker", [r.w.q.region, r.w.l.status, [...pcd.poweredComps]]);
const pcLit = window.computeSimPoweredSet(lowSide(10000), both(lowSide(10000)).c);
ok(pcLit.poweredComps.has("l") && pcLit.poweredComps.has("rc"), "and a driven transistor still powers the LED and its resistor");
const floatPnp = JSON.parse(JSON.stringify(highSide)); floatPnp.components.find((x) => x.id === "q").gain = 1000; floatPnp.wires = floatPnp.wires.filter((x) => x.to.pin !== "base" && x.from.pin !== "base" && x.to.compId !== "rb" && x.from.compId !== "rb");
r = both(floatPnp); ok(r.same && r.w.q.region === "off" && r.w.q.currentMa === 0 && r.w.l.status === "idle", "a PNP with its base unwired stays off even at gain 1000 (no 8 nA 'active' state)", [r.w.q, r.w.l]);
// LED in the base leg, collector unwired: the base-emitter current powers the LED in the powered view
const beOnly = { components: [bat("b", 9), res("rb", 330), led("l"), tr("q")], wires: [w("b", "pos", "rb", "p1"), w("rb", "p2", "l", "anode"), w("l", "cathode", "q", "base"), w("q", "emitter", "b", "neg")] };
r = both(beOnly); const pcb = window.computeSimPoweredSet(beOnly, r.c), pwb = W.computePoweredSet(beOnly, r.w);
ok(r.same && pcb.poweredComps.has("l") && JSON.stringify([...pcb.poweredComps].sort()) === JSON.stringify([...pwb.poweredComps].sort()), "an LED in the base leg with a floating collector is powered by the base current", [...pcb.poweredComps]);
// plain circuits without transistors are untouched
const series = { components: [bat("b"), res("r1", 100), led("l")], wires: [w("b", "pos", "r1", "p1"), w("r1", "p2", "l", "anode"), w("l", "cathode", "b", "neg")] };
r = both(series); ok(r.same && !r.w.q, "a circuit with no transistor is unaffected");
console.log(fail ? "FAILURES " + fail : "ALL PASS");
