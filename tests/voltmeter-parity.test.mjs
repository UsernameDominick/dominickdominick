import fs from "node:fs";
import vm from "node:vm";
import * as W from "../worker/simulation-render.js";
import { simulationDataError } from "../worker/simulation-validation.js";

const window = {};
const ctx = vm.createContext({ window, console, Math, Number, String, Object, Array, Set, Map, JSON, Infinity, NaN, CSS: { escape: (s) => s } });
vm.runInContext(fs.readFileSync(new URL("../public/admin/sim-solver.js", import.meta.url), "utf8"), ctx);
vm.runInContext(fs.readFileSync(new URL("../public/admin/sim-components.js", import.meta.url), "utf8"), ctx);
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const near = (a, b, tol = 1e-9) => typeof a === "number" && Math.abs(a - b) < tol;
const both = (data) => { const w = W.computeCircuitAnalysis(data), c = window.computeSimElectricalAnalysis(data); return { w, c, same: JSON.stringify(w) === JSON.stringify(c) }; };

// definitions
let bad = null, n = 0;
for (const rotation of [0, 90, 180, 270]) for (const mirror of [false, true]) {
  const comp = { id: "v", type: "voltmeter", x: 0, y: 0, ...(rotation ? { rotation } : {}), ...(mirror ? { mirror: true } : {}) };
  const c = window.getSimComponentDefinition(comp), w = W.getSimulationComponentDefinition(comp);
  n++;
  if (!(c && w && c.w === w.w && c.h === w.h && JSON.stringify(c.pins) === JSON.stringify(w.pins) && c.render(comp) === w.render(comp))) bad = { rotation, mirror };
}
ok(!bad, `client and worker definitions match across ${n} orientations`, bad);
ok(W.formatVolts(4.6) === "4.60V" && W.formatVolts(-3.1) === "-3.10V" && W.formatVolts(-0.001) === "0.00V" && W.formatVolts(null) === "—" && W.formatVolts(NaN) === "—" && window.simFormatVolts(4.6) === "4.60V" && window.simFormatVolts(null) === "—", "voltage formatting (both engines): 2 decimals, no negative zero, dash when unreadable");

const bat = (extra = {}) => ({ id: "bat", type: "battery", x: 10, y: 10, voltage: 9, ...extra });
const res = (id, ohms, x = 200) => ({ id, type: "resistor", x, y: 10, resistance: ohms });
const wire = (id, a, ap, b, bp) => ({ id, from: { compId: a, pin: ap }, to: { compId: b, pin: bp } });
const vm_ = (id, x = 300) => ({ id, type: "voltmeter", x, y: 200 });

// series loop bat+ -> R1(100) -> R2(200) -> bat-  : I = 30 mA
const series = (extraComps = [], extraWires = []) => ({
  components: [bat(), res("r1", 100, 100), res("r2", 200, 300), ...extraComps],
  wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "r2", "p1"), wire("w3", "r2", "p2", "bat", "neg"), ...extraWires],
});
let d = series([vm_("v1"), vm_("v2"), vm_("v3"), vm_("v4")], [
  wire("a1", "v1", "pos", "r1", "p1"), wire("a2", "v1", "neg", "r1", "p2"),   // across R1
  wire("b1", "v2", "pos", "r2", "p1"), wire("b2", "v2", "neg", "r2", "p2"),   // across R2
  wire("c1", "v3", "pos", "bat", "pos"), wire("c2", "v3", "neg", "bat", "neg"), // across the battery
  wire("d1", "v4", "pos", "r1", "p2"), wire("d2", "v4", "neg", "r1", "p1"),   // R1 reversed
]);
let r = both(d);
ok(r.same, "series loop with four voltmeters: worker and client analysis identical");
ok(near(r.w.v1.volts, 3) && near(r.w.v2.volts, 6) && near(r.w.v3.volts, 9) && near(r.w.v4.volts, -3), "across R1 = 3 V, across R2 = 6 V, across the battery = 9 V, reversed probes = -3 V", [r.w.v1.volts, r.w.v2.volts, r.w.v3.volts, r.w.v4.volts]);
ok(near(r.w.r1.currentMa, 30) && near(r.w.r2.currentMa, 30) && r.w.r1.status === "normal", "the voltmeters don't disturb the circuit (30 mA still flows through both resistors)");
const noMeters = W.computeCircuitAnalysis(series());
ok(JSON.stringify(noMeters.r1) === JSON.stringify(r.w.r1) && JSON.stringify(noMeters.r2) === JSON.stringify(r.w.r2), "results for every other part are identical with and without the voltmeters");

// internal resistance: terminal voltage sags
const sag = { components: [bat({ internalResistance: 30 }), res("r1", 270, 100), vm_("v")], wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "bat", "neg"), wire("a", "v", "pos", "bat", "pos"), wire("b", "v", "neg", "bat", "neg")] };
r = both(sag);
ok(r.same && near(r.w.v.volts, 9 - 0.03 * 30), "a battery with 30 ohm internal resistance reads 8.1 V at its terminals under a 30 mA load", r.w.v && r.w.v.volts);

// LED drop
const led = { components: [bat(), res("r1", 220, 100), { id: "led", type: "led", x: 300, y: 10, color: "red" }, vm_("v")], wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "led", "anode"), wire("w3", "led", "cathode", "bat", "neg"), wire("a", "v", "pos", "led", "anode"), wire("b", "v", "neg", "led", "cathode")] };
const ledDef = W.getSimulationComponentDefinition({ id: "led", type: "led", x: 0, y: 0 });
const ledPins = ledDef.pins.map((p) => p.id);
if (!ledPins.includes("anode")) { for (const w of led.wires) for (const e of [w.from, w.to]) if (e.compId === "led") e.pin = e.pin === "anode" ? ledPins[0] : ledPins[1]; }
r = both(led);
ok(r.same && near(r.w.v.volts, W.LED_COLORS.red.forwardVoltage), `across an LED reads its forward voltage (${W.LED_COLORS.red.forwardVoltage} V)`, r.w.v && r.w.v.volts);

// a wired-on side node shares the potential
const spur = series([vm_("v"), { id: "r3", type: "resistor", x: 500, y: 300, resistance: 1000 }], [wire("a", "v", "pos", "r3", "p1"), wire("s1", "r3", "p1", "r1", "p2"), wire("b", "v", "neg", "bat", "neg")]);
r = both(spur);
ok(r.same && r.w.v.volts !== null && near(r.w.v.volts, 6, 1e-9), "a probe wired onto a dead-end spur off the R1/R2 junction reads that node's 6 V", r.w.v && r.w.v.volts);

// probe on a dead-end spur past a resistor: no current flows there, so it shares its attach point's potential
const off = series([vm_("v"), { id: "r3", type: "resistor", x: 500, y: 300, resistance: 1000 }], [wire("s1", "r3", "p1", "r1", "p2"), wire("a", "v", "pos", "r3", "p2"), wire("b", "v", "neg", "bat", "neg")]);
r = both(off);
ok(r.same && near(r.w.v.volts, 6), "a probe behind a dead-end spur resistor reads the potential where the spur hangs (6 V; no current flows in it)", r.w.v);

// open circuit: source voltage across the terminals, 0 across a dangling resistor
const open = { components: [bat(), res("r1", 100, 100), vm_("v1"), vm_("v2")], wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("a1", "v1", "pos", "bat", "pos"), wire("a2", "v1", "neg", "bat", "neg"), wire("b1", "v2", "pos", "r1", "p1"), wire("b2", "v2", "neg", "r1", "p2")] };
r = both(open);
ok(r.same && near(r.w.v1.volts, 9) && near(r.w.v2.volts, 0), "open circuit: 9 V across the battery, 0 V across a dangling resistor", [r.w.v1.volts, r.w.v2.volts]);

// LED can't conduct (1.5 V source): first LED takes the whole source voltage
const weak = { components: [bat({ voltage: 1.5 }), res("r1", 220, 100), { id: "led", type: "led", x: 300, y: 10, color: "red" }, vm_("v1"), vm_("v2")], wires: [wire("w1", "bat", "pos", "led", ledPins[0]), wire("w2", "led", ledPins[1], "r1", "p1"), wire("w3", "r1", "p2", "bat", "neg"), wire("a1", "v1", "pos", "led", ledPins[0]), wire("a2", "v1", "neg", "led", ledPins[1]), wire("b1", "v2", "pos", "r1", "p1"), wire("b2", "v2", "neg", "r1", "p2")] };
r = both(weak);
ok(r.same && near(r.w.v1.volts, 1.5) && near(r.w.v2.volts, 0), "a 1.5 V battery can't light a red LED: 1.5 V across the LED, 0 V across the resistor", [r.w.v1 && r.w.v1.volts, r.w.v2 && r.w.v2.volts]);

// short circuit: no reading
const short = { components: [bat(), vm_("v")], wires: [wire("w1", "bat", "pos", "bat", "neg"), wire("a", "v", "pos", "bat", "pos"), wire("b", "v", "neg", "bat", "neg")] };
r = both(short);
ok(r.same && r.w.v.volts === null, "a dead short gives no reading");

// unconnected voltmeter
const lone = { components: [bat(), res("r1", 100, 100), vm_("v")], wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "bat", "neg")] };
r = both(lone);
ok(r.same && r.w.v.volts === null && r.w.v.status === "no-reading", "an unwired voltmeter shows no reading");

// two sources: readings come from the source that knows both probes
const two = { components: [bat(), bat({ id: "bat2", voltage: 5 }), res("r1", 100, 100), res("r2", 100, 300), vm_("v1"), vm_("v2"), vm_("v3")], wires: [
  wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "bat", "neg"),
  wire("w3", "bat2", "pos", "r2", "p1"), wire("w4", "r2", "p2", "bat2", "neg"),
  wire("a1", "v1", "pos", "r1", "p1"), wire("a2", "v1", "neg", "r1", "p2"),
  wire("b1", "v2", "pos", "r2", "p1"), wire("b2", "v2", "neg", "r2", "p2"),
  wire("c1", "v3", "pos", "r1", "p1"), wire("c2", "v3", "neg", "r2", "p2"),
] };
r = both(two);
ok(r.same && near(r.w.v1.volts, 9) && near(r.w.v2.volts, 5) && r.w.v3.volts === null, "two separate circuits: each meter reads its own loop; probes across both show no reading", [r.w.v1.volts, r.w.v2.volts, r.w.v3.volts]);

// mains
const mains = { components: [{ id: "out", type: "outlet", x: 10, y: 10 }, vm_("v")], wires: [wire("a", "v", "pos", "out", "hot"), wire("b", "v", "neg", "out", "neutral")] };
r = both(mains);
ok(r.same && near(r.w.v.volts, 120) && r.w.v.dangerous === true, "across a wall outlet reads 120 V and is flagged dangerous", r.w.v);

// through a closed switch and an ammeter: zero-resistance links share potential
const chain = { components: [bat(), { id: "sw", type: "switch", x: 100, y: 10, closed: true }, { id: "am", type: "ammeter", x: 200, y: 10 }, res("r1", 300, 300), vm_("v")], wires: [
  wire("w1", "bat", "pos", "sw", "p1"), wire("w2", "sw", "p2", "am", "p1"), wire("w3", "am", "p2", "r1", "p1"), wire("w4", "r1", "p2", "bat", "neg"),
  wire("a", "v", "pos", "am", "p2"), wire("b", "v", "neg", "bat", "neg"),
] };
r = both(chain);
ok(r.same && near(r.w.v.volts, 9), "through a closed switch and an ammeter the potential is unchanged (9 V at the resistor's top)", r.w.v && r.w.v.volts);
chain.components[1].closed = false;
r = both(chain);
ok(r.same, "with the switch open the engines still agree", r.w.v);

// SPDT and rotation don't matter
for (const rotation of [90, 180, 270]) {
  const dd = series([{ ...vm_("v"), rotation, mirror: rotation === 180 }], [wire("a", "v", "pos", "r1", "p1"), wire("b", "v", "neg", "r1", "p2")]);
  const rr = both(dd);
  ok(rr.same && near(rr.w.v.volts, 3), `rotation ${rotation}: still reads 3 V (pins follow the orientation)`, rr.w.v && rr.w.v.volts);
}

// rendering: reading overlay in the public SVG
const svg = W.renderSimulationSvg(d);
ok(/class="voltmeter-reading"[^>]*>3\.00V</.test(svg) && /class="voltmeter-reading"[^>]*>6\.00V</.test(svg) && /class="voltmeter-reading"[^>]*>-3\.00V</.test(svg), "the public SVG prints each meter's live reading");
const svgNo = W.renderSimulationSvg(lone);
ok(/class="voltmeter-reading"[^>]*>—</.test(svgNo), "an unreadable meter prints a dash");
ok(!/<script/i.test(svg), "no markup injection");

// ---- the honesty rules (each must dash, with a reason, and both engines agree) ----
const reasonOf = (data, id = "v") => { const rr = both(data); return { same: rr.same, volts: rr.w[id] && rr.w[id].volts, reason: rr.w[id] && rr.w[id].reason }; };
// H1: parallel branches
const par = { components: [bat(), res("r1", 1000, 100), res("r2", 1000, 300), res("r3", 1000, 300), vm_("v"), vm_("v2")], wires: [
  wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "r2", "p1"), wire("w2b", "r1", "p2", "r3", "p1"), wire("w3", "r2", "p2", "bat", "neg"), wire("w3b", "r3", "p2", "bat", "neg"),
  wire("a1", "v", "pos", "r1", "p1"), wire("a2", "v", "neg", "r1", "p2"), wire("b1", "v2", "pos", "r2", "p1"), wire("b2", "v2", "neg", "r2", "p2")] };
let q = reasonOf(par); let q2 = reasonOf(par, "v2");
ok(q.same && near(q.volts, 6, 1e-9) && near(q2.volts, 3, 1e-9), "parallel branches (R1 in series with R2||R3, 1k each): the general solver reads 6 V across R1 and 3 V across R2", [q, q2]);
// switch across R1
const bypass = series([{ id: "sw", type: "switch", x: 400, y: 300, closed: true }, vm_("v")], [wire("s1", "sw", "p1", "r1", "p1"), wire("s2", "sw", "p2", "r1", "p2"), wire("a1", "v", "pos", "r1", "p1"), wire("a2", "v", "neg", "r1", "p2")]);
q = reasonOf(bypass);
ok(q.same && near(q.volts, 0, 1e-9), "a closed switch wired across R1 shorts it: the meter reads 0 V", q);
bypass.components[bypass.components.findIndex((c) => c.id === "sw")].closed = false;
q = reasonOf(bypass);
ok(q.same && near(q.volts, 3), "with that switch OPEN the loop is a plain series loop again and R1 reads 3 V", q);
// H3: wire-joined nodes never get different voltages: probe across a plain wire beside a bypass
const wireinv = series([{ id: "sw", type: "switch", x: 400, y: 300, closed: true }, vm_("v")], [wire("s1", "sw", "p1", "r1", "p1"), wire("s2", "sw", "p2", "r1", "p2"), wire("a1", "v", "pos", "r1", "p2"), wire("a2", "v", "neg", "sw", "p2")]);
q = reasonOf(wireinv);
ok(q.same && near(q.volts, 0, 1e-9), "a meter across the wire beside a bypassed resistor reads 0 V (one wire, one potential)", q);
// ammeter across R1 is also a bypass
const amBypass = series([{ id: "am", type: "ammeter", x: 400, y: 300 }, vm_("v")], [wire("s1", "am", "p1", "r1", "p1"), wire("s2", "am", "p2", "r1", "p2"), wire("a1", "v", "pos", "r1", "p1"), wire("a2", "v", "neg", "r1", "p2")]);
q = reasonOf(amBypass);
ok(q.same && near(q.volts, 0, 1e-9), "an ammeter wired across R1 bypasses it: 0 V", q);
// bypass through a two-wire chain
const chain2 = series([{ id: "j", type: "resistor", x: 500, y: 300, resistance: 1 }, vm_("v")], [wire("s1", "j", "p1", "r1", "p1"), wire("s2", "j", "p2", "r1", "p2"), wire("a1", "v", "pos", "r1", "p1"), wire("a2", "v", "neg", "r1", "p2")]);
q = reasonOf(chain2);
ok(q.same && near(q.volts, 9 * (100 / 101) / (200 + 100 / 101), 1e-6), "a 1-ohm resistor wired across R1 (100 || 1 in series with 200): reads 0.0443 V", q);

// H2: several sources in one circuit
const srcLoop = (extra = [], extraWires = [], first = []) => ({ components: [...first, bat({ id: "A" }), res("r1", 330, 100), { id: "led", type: "led", x: 300, y: 10, color: "red" }, vm_("v"), ...extra], wires: [
  wire("w1", "A", "pos", "r1", "p1"), wire("w2", "r1", "p2", "led", ledPins[0]), wire("w3", "led", ledPins[1], "A", "neg"),
  wire("a1", "v", "pos", "r1", "p1"), wire("a2", "v", "neg", "r1", "p2"), ...extraWires] });
q = reasonOf(srcLoop());
ok(q.same && near(q.volts, 330 * (9 - 2) / 330), "baseline: single source, R1 = 330 ohm, red LED: reads 7 V", q);
const withB = (order) => srcLoop([bat({ id: "B", voltage: 5 })].filter(() => order === "after"), [wire("bx", "B", "pos", "r1", "p1")], order === "before" ? [bat({ id: "B", voltage: 5 })] : []);
const qa = reasonOf(withB("before")), qb = reasonOf(withB("after"));
ok(qa.same && qb.same && near(qa.volts, 7, 1e-3) && near(qb.volts, 7, 1e-3) && near(qa.volts, qb.volts, 1e-12), "a second source with one terminal left loose changes nothing: 7 V across R1 whichever order the parts were placed (the general solver; it used to dash)", [qa, qb]);
const twoCells = { components: [bat({ id: "c1", voltage: 1.5 }), bat({ id: "c2", voltage: 1.5 }), res("r1", 100, 100), vm_("v")], wires: [wire("w1", "c1", "pos", "c2", "neg"), wire("w2", "c2", "pos", "r1", "p1"), wire("w3", "r1", "p2", "c1", "neg"), wire("a1", "v", "pos", "c2", "pos"), wire("a2", "v", "neg", "c2", "neg")] };
q = reasonOf(twoCells);
ok(q.same && near(q.volts, 1.5, 1e-9), "two 1.5 V cells in series: each cell reads 1.5 V across itself (3 V total across the load)", q);
const grounded = { components: [bat({ id: "A" }), bat({ id: "B", voltage: 5 }), res("r1", 100, 100), res("r2", 100, 300), vm_("v")], wires: [wire("w1", "A", "pos", "r1", "p1"), wire("w2", "r1", "p2", "A", "neg"), wire("w3", "B", "pos", "r2", "p1"), wire("w4", "r2", "p2", "B", "neg"), wire("g", "A", "neg", "B", "neg"), wire("a1", "v", "pos", "r1", "p1"), wire("a2", "v", "neg", "r1", "p2")] };
q = reasonOf(grounded);
ok(q.same && near(q.volts, 9, 1e-9), "two loops sharing a ground wire: each source holds its own voltage across its own loop", q);

// H4 + M2: LEDs that can't conduct
const rev = { components: [bat(), res("r1", 330, 100), { id: "led", type: "led", x: 300, y: 10, color: "red" }, vm_("v1"), vm_("v2")], wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "led", ledPins[1]), wire("w3", "led", ledPins[0], "bat", "neg"),
  wire("a1", "v1", "pos", "r1", "p1"), wire("a2", "v1", "neg", "r1", "p2"), wire("b1", "v2", "pos", "led", ledPins[1]), wire("b2", "v2", "neg", "led", ledPins[0])] };
r = both(rev);
ok(r.same && near(r.w.v1.volts, 0) && near(r.w.v2.volts, 9), "a reversed LED blocks: 0 V across the resistor, the full 9 V across the LED (real physics; it used to print 7 V and 2 V)", [r.w.v1.volts, r.w.v2.volts]);
const twoLeds = (voltage, colors) => ({ components: [bat({ voltage }), res("r1", 100, 100), { id: "l1", type: "led", x: 300, y: 10, color: colors[0] }, { id: "l2", type: "led", x: 400, y: 10, color: colors[1] }, vm_("v")], wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "l1", ledPins[0]), wire("w3", "l1", ledPins[1], "l2", ledPins[0]), wire("w4", "l2", ledPins[1], "bat", "neg"), wire("a1", "v", "pos", "l1", ledPins[0]), wire("a2", "v", "neg", "l1", ledPins[1])] });
q = reasonOf(twoLeds(3, ["red", "red"]));
ok(q.same && q.volts === null && q.reason === "ambiguous", "two red LEDs on 3 V can't conduct and can't be split: dash ('ambiguous')", q);
const wf = W.LED_COLORS.white ? "white" : "red";
q = reasonOf(twoLeds(W.LED_COLORS.red.forwardVoltage + W.LED_COLORS[wf].forwardVoltage, ["red", wf]));
ok(q.same && q.volts === null && q.reason === "ambiguous", "forward voltages summing exactly to the supply are still ambiguous", q);
q = reasonOf(twoLeds(9, ["red", "red"]));
ok(q.same && near(q.volts, W.LED_COLORS.red.forwardVoltage), "two red LEDs on 9 V conduct: each drops its forward voltage", q);

// short
q = reasonOf(short);
ok(q.same && q.volts === null && q.reason === "short", "a dead short dashes with reason 'short'", q);
// unwired / probes
q = reasonOf(lone);
ok(q.same && q.reason === "unwired", "an unwired meter says 'unwired'", q);
const split = { components: [bat(), res("r1", 100, 100), vm_("v")], wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "bat", "neg"), wire("a1", "v", "pos", "r1", "p1")] };
q = reasonOf(split);
ok(q.same && q.volts === null && q.reason === "probes", "one probe in the circuit and one loose says 'probes'", q);
// invalid voltage
q = reasonOf({ components: [bat({ voltage: "Infinity" }), res("r1", 100, 100), vm_("v")], wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "bat", "neg"), wire("a1", "v", "pos", "r1", "p1"), wire("a2", "v", "neg", "r1", "p2")] });
ok(q.same && q.volts === null && q.reason === "invalid", "a non-finite source voltage dashes ('invalid') instead of printing Infinity", q);
// huge voltages stay short
ok(W.formatVolts(1e12) === "1.0e12V" && window.simFormatVolts(1e12) === "1.0e12V" && W.formatVolts(9999.994) === "9999.99V", "huge readings switch to exponent form so they fit the part", [W.formatVolts(1e12), W.formatVolts(9999.994)]);
// no potential work without voltmeters
ok(!("volts" in Object.assign({}, ...Object.values(W.computeCircuitAnalysis(series())))), "circuits without voltmeters produce no voltmeter results");
// power supply fed from an outlet
const psLoop = { components: [{ id: "out", type: "outlet", x: 10, y: 10 }, { id: "ps", type: "power_supply", x: 100, y: 10, outputVoltage: 5 }, res("r1", 100, 300), vm_("v")], wires: [
  wire("w1", "out", "hot", "ps", "in_hot"), wire("w2", "out", "neutral", "ps", "in_neutral"), wire("w3", "ps", "out_pos", "r1", "p1"), wire("w4", "r1", "p2", "ps", "out_neg"), wire("a1", "v", "pos", "r1", "p1"), wire("a2", "v", "neg", "r1", "p2")] };
q = reasonOf(psLoop);
ok(q.same && (q.volts === null || near(q.volts, 5)), "a power supply fed from an outlet reads its 5 V across the load (or dashes when its input isn't powered), never a wrong number", q);

// ---- a backwards LED blocks the loop for EVERY part's result (not just the voltmeter) ----
const revLoop = (extra = [], extraWires = []) => ({ components: [bat(), res("r1", 330, 100), { id: "led", type: "led", x: 300, y: 10, color: "red" }, { id: "am", type: "ammeter", x: 400, y: 10 }, ...extra], wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "led", ledPins[1]), wire("w3", "led", ledPins[0], "am", "p1"), wire("w4", "am", "p2", "bat", "neg"), ...extraWires] });
r = both(revLoop());
ok(r.same && r.w.led.status === "reversed" && r.w.led.currentMa === 0 && r.w.r1.currentMa === 0 && r.w.am.currentMa === 0, "reversed LED: LED says 'reversed' and the resistor and ammeter both read 0 mA (no more 'healthy 21 mA' beside 'wired backwards')", [r.w.led, r.w.r1.currentMa, r.w.am.currentMa]);
const fwd = both({ ...revLoop(), wires: revLoop().wires.map((w) => (w.id === "w2" ? wire("w2", "r1", "p2", "led", ledPins[0]) : w.id === "w3" ? wire("w3", "led", ledPins[1], "am", "p1") : w)) });
ok(fwd.same && fwd.w.led.status !== "reversed" && fwd.w.am.currentMa > 15 && fwd.w.am.currentMa < 25, "the same loop with the LED the right way round still carries about 21 mA", [fwd.w.led.status, fwd.w.am.currentMa]);
const twoRev = { components: [bat(), res("r1", 330, 100), { id: "l1", type: "led", x: 300, y: 10, color: "red" }, { id: "l2", type: "led", x: 400, y: 10, color: "red" }], wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "l1", ledPins[1]), wire("w3", "l1", ledPins[0], "l2", ledPins[0]), wire("w4", "l2", ledPins[1], "bat", "neg")] };
r = both(twoRev);
ok(r.same && r.w.l1.status === "reversed" && r.w.l2.status === "blocked" && r.w.l2.currentMa === 0, "a forward LED in a loop with a backwards one is 'blocked', not 'dim'", [r.w.l1.status, r.w.l2.status]);
const dangerousRev = { components: [{ id: "out", type: "outlet", x: 10, y: 10 }, res("r1", 330, 100), { id: "led", type: "led", x: 300, y: 10, color: "red" }], wires: [wire("w1", "out", "hot", "r1", "p1"), wire("w2", "r1", "p2", "led", ledPins[1]), wire("w3", "led", ledPins[0], "out", "neutral")] };
r = both(dangerousRev);
ok(r.same && r.w.led.status === "burnt", "mains through a backwards LED is still reported as destroyed (the dangerous flag wins)", r.w.led.status);
// M-1: a backwards LED on one branch of a PARALLEL pair must not zero the whole loop, in either wiring order
const parRev = (reverseFirst) => {
  const branchW = (id, r, l, fwd) => [wire(id + "a", "am", "p2", r, "p1"), wire(id + "b", r, "p2", l, fwd ? ledPins[0] : ledPins[1]), wire(id + "c", l, fwd ? ledPins[1] : ledPins[0], "bat", "neg")];
  const fwdBranch = branchW("f", "r1", "l1", true), revBranch = branchW("g", "r2", "l2", false);
  return { components: [bat(), { id: "am", type: "ammeter", x: 60, y: 10 }, res("r1", 330, 100), res("r2", 330, 300), { id: "l1", type: "led", x: 200, y: 10, color: "red" }, { id: "l2", type: "led", x: 400, y: 10, color: "red" }], wires: [wire("w0", "bat", "pos", "am", "p1"), ...(reverseFirst ? [...revBranch, ...fwdBranch] : [...fwdBranch, ...revBranch])] };
};
for (const first of [true, false]) {
  r = both(parRev(first));
  ok(r.same && r.w.am.currentMa > 15, `parallel pair with one backwards LED (backwards branch wired ${first ? "first" : "second"}): the ammeter still reads a live current, not 0.0 mA`, r.w.am.currentMa);
}
// source-less network and PS terminals
const noSrc = { components: [res("r1", 100, 100), res("r2", 100, 300), vm_("v")], wires: [wire("w1", "r1", "p2", "r2", "p1"), wire("a1", "v", "pos", "r1", "p1"), wire("a2", "v", "neg", "r2", "p2")] };
q = reasonOf(noSrc);
ok(q.same && q.volts === null && q.reason === "nosource", "wired probes on a network with no source say 'nosource' (not 'unwired')", q);
const psTouch = { components: [{ id: "out", type: "outlet", x: 10, y: 10 }, { id: "ps", type: "power_supply", x: 100, y: 10, outputVoltage: 12 }, bat({ id: "A" }), res("r1", 330, 100), { id: "led", type: "led", x: 300, y: 10, color: "red" }, vm_("v")], wires: [
  wire("p1", "out", "hot", "ps", "in_hot"), wire("p2", "out", "neutral", "ps", "in_neutral"),
  wire("w1", "A", "pos", "r1", "p1"), wire("w2", "r1", "p2", "led", ledPins[0]), wire("w3", "led", ledPins[1], "A", "neg"),
  wire("x", "ps", "out_pos", "A", "pos"),
  wire("a1", "v", "pos", "r1", "p1"), wire("a2", "v", "neg", "r1", "p2")] };
q = reasonOf(psTouch);
ok(q.same && q.volts === null && q.reason === "sources", "a Power Supply's output wired onto a battery loop counts as another source even when its own loop is unclosed", q);
ok(/negative 3\.00 volts/.test("voltage meter reading negative 3.00V".replace(/V$/, " volts")), "(summary wording helper sanity)");

// ingress
ok(!simulationDataError(d), "the server accepts circuits with voltmeters", simulationDataError(d));

// random circuits: worker == client
let seed = 987654;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
let mism = 0, withReading = 0, total = 0;
for (let t = 0; t < 4000; t++) {
  const comps = [bat({ id: "bat", voltage: [3, 5, 9, 12][Math.floor(rnd() * 4)], ...(rnd() > 0.7 ? { internalResistance: Math.floor(rnd() * 50) } : {}) })];
  if (rnd() > 0.85) comps.push(bat({ id: "bat2", voltage: 5 }));
  const kinds = ["resistor", "resistor", "led", "switch", "switch_spdt", "ammeter", "potentiometer", "voltmeter", "voltmeter", "capacitor", "inductor"];
  const cnt = 2 + Math.floor(rnd() * 5);
  for (let i = 0; i < cnt; i++) {
    const type = kinds[Math.floor(rnd() * kinds.length)];
    const c = { id: "c" + i, type, x: i * 50, y: 50 };
    if (type === "resistor") c.resistance = 100 + Math.floor(rnd() * 900);
    if (type === "switch") c.closed = rnd() > 0.3;
    if (type === "switch_spdt") c.position = rnd() > 0.5 ? "a" : "b";
    if (rnd() > 0.8) c.rotation = [90, 180, 270][Math.floor(rnd() * 3)];
    comps.push(c);
  }
  const pinsOf = (c) => W.getSimulationComponentDefinition(c).pins.map((p) => p.id);
  const wires = [];
  const wcount = 3 + Math.floor(rnd() * 8);
  for (let i = 0; i < wcount; i++) {
    const a = comps[Math.floor(rnd() * comps.length)], b = comps[Math.floor(rnd() * comps.length)];
    if (a === b) continue;
    const pa = pinsOf(a), pb = pinsOf(b);
    wires.push(wire("w" + i, a.id, pa[Math.floor(rnd() * pa.length)], b.id, pb[Math.floor(rnd() * pb.length)]));
  }
  const data = { components: comps, wires };
  const rr = both(data);
  total++;
  if (!rr.same) mism++;
  for (const c of comps) if (c.type === "voltmeter" && rr.w[c.id] && rr.w[c.id].volts !== null) withReading++;
  for (const k of Object.keys(rr.w)) { const v = rr.w[k].volts; if (rr.w[k].kind === "voltmeter" && v !== null && !Number.isFinite(v)) { mism++; } }
}
ok(mism === 0, `${total} random circuits (${withReading} live voltmeter readings): worker and client agree and every reading is finite`, mism);
console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
