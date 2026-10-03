// The lamp part: a resistance that glows with the power it is given. The browser (public/admin/sim-components.js + sim-solver.js)
// and the worker (worker/simulation-render.js) each analyse a circuit; the two must agree on a lamp in every kind of circuit.
import fs from "node:fs";
import vm from "node:vm";
import * as W from "../worker/simulation-render.js";
import { simulationDataError } from "../worker/simulation-validation.js";
const window = {};
const ctx = vm.createContext({ window, console, Math, Number, String, Object, Array, Set, Map, JSON, Infinity, NaN, Float64Array, CSS: { escape: (s) => s } });
for (const f of ["sim-solver.js", "sim-schematic.js", "sim-components.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/admin/${f}`, import.meta.url), "utf8"), ctx);
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const near = (a, b, tol = 1e-6) => typeof a === "number" && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const both = (data) => { const w = W.computeCircuitAnalysis(data), c = window.computeSimElectricalAnalysis(data); return { w, c, same: JSON.stringify(w) === JSON.stringify(c) }; };
const bat = (v = 9) => ({ id: "bat", type: "battery", x: 10, y: 10, voltage: v });
const lamp = (id = "l", ohms) => ({ id, type: "lamp", x: 100, y: 10, ...(ohms === undefined ? {} : { resistance: ohms }) });
const res = (id, ohms) => ({ id, type: "resistor", x: 200, y: 10, resistance: ohms });
const wire = (id, a, ap, b, bp) => ({ id, from: { compId: a, pin: ap }, to: { compId: b, pin: bp } });
const series = (v, ohms) => ({ components: [bat(v), lamp("l", ohms)], wires: [wire("w1", "bat", "pos", "l", "p1"), wire("w2", "l", "p2", "bat", "neg")] });

// ---- definition ----
let bad = null, n = 0;
for (const rotation of [0, 90, 180, 270]) for (const mirror of [false, true]) {
  const comp = { id: "l", type: "lamp", x: 0, y: 0, ...(rotation ? { rotation } : {}), ...(mirror ? { mirror: true } : {}) };
  const c = window.getSimComponentDefinition(comp), w = W.getSimulationComponentDefinition(comp); n++;
  if (!(c && w && c.w === w.w && c.h === w.h && JSON.stringify(c.pins) === JSON.stringify(w.pins) && c.render(comp) === w.render(comp))) bad = { rotation, mirror };
}
ok(!bad, `client and worker lamp definitions match across ${n} orientations`, bad);
const def = W.getSimulationComponentDefinition({ id: "l", type: "lamp", x: 0, y: 0 });
ok(def.pins.length === 2 && def.pins[0].x === 0 && def.pins[1].x === 40 && def.pins[0].y === 40 && def.pins[1].y === 40, "two leads one breadboard hole-spacing apart, like the LED");
ok(/sim-art-schem/.test(def.render({ id: "l", type: "lamp" })) && /lamp-glass/.test(def.render({ id: "l", type: "lamp" })) && /sch-lamp-body/.test(def.render({ id: "l", type: "lamp" })), "it is drawn both ways: the bulb and the schematic circle");

// ---- numbers ----
ok(near(W.lampOhms({}), 180) && near(W.lampOhms({ resistance: 60 }), 60) && near(W.lampOhms({ resistance: "x" }), 180) && near(W.lampOhms({ resistance: -5 }), 180) && near(W.lampOhms({ resistance: 0 }), 180) && near(W.lampOhms({ resistance: 0.2 }), 1) && near(W.lampOhms(null), 180), "resistance defaults to 180 and is kept sane");
ok(window.simLampOhms({ resistance: 60 }) === W.lampOhms({ resistance: 60 }) && window.simLampOhms({}) === 180 && window.simLampOhms({ resistance: "x" }) === 180, "the client reads it the same way");
ok(window.SIM_LAMP_RATED_WATTS === W.LAMP_RATED_WATTS && W.LAMP_RATED_WATTS === 0.5, "both sides know the 0.5 W rating");

// ---- one-path analysis ----
let r = both(series(9));
ok(r.same && r.w.l.kind === "resistor" && r.w.l.lamp === true && near(r.w.l.currentMa, 50) && near(r.w.l.watts, 0.45) && r.w.l.status === "normal", "9 V across the default 180 ohm lamp: 50 mA, 0.45 W, lit normally", r.w.l);
r = both(series(5));
ok(r.same && near(r.w.l.currentMa, 5000 / 180) && r.w.l.status === "normal" && r.w.l.watts < 0.45, "5 V lights it less, still normal", r.w.l);
r = both(series(2));
ok(r.same && r.w.l.status === "dim" && r.w.l.watts < 0.05, "2 V gives under a tenth of the rating: dim", r.w.l);
r = both(series(12));
ok(r.same && r.w.l.status === "overheating" && r.w.l.watts > 0.5, "12 V is 0.8 W against a 0.5 W rating: overheating", r.w.l);
r = both(series(9, 60));
ok(r.same && r.w.l.status === "overheating" && near(r.w.l.watts, 1.35), "a 60 ohm lamp on 9 V is 1.35 W: overheating", r.w.l);
r = both({ components: [bat(), lamp("l"), res("r", 220)], wires: [wire("w1", "bat", "pos", "l", "p1"), wire("w2", "l", "p2", "r", "p1"), wire("w3", "r", "p2", "bat", "neg")] });
ok(r.same && near(r.w.l.currentMa, 9000 / 400) && r.w.l.status === "normal" && r.w.r.status === "normal", "a resistor in series takes its share: 22.5 mA through both", [r.w.l, r.w.r.currentMa]);
// the resistor's own results are unchanged by the lamp work
r = both({ components: [bat(12), res("r", 100)], wires: [wire("w1", "bat", "pos", "r", "p1"), wire("w2", "r", "p2", "bat", "neg")] });
ok(r.same && r.w.r.kind === "resistor" && !("lamp" in r.w.r) && r.w.r.status === "overheating", "a plain resistor result carries no lamp flag and still uses the 0.25 W rating", r.w.r);
// a switch in the loop
r = both({ components: [bat(), lamp("l"), { id: "sw", type: "switch", x: 0, y: 0, closed: false }], wires: [wire("w1", "bat", "pos", "l", "p1"), wire("w2", "l", "p2", "sw", "p1"), wire("w3", "sw", "p2", "bat", "neg")] });
ok(r.same && (!r.w.l || r.w.l.status === "off" || !(r.w.l.currentMa > 0)), "an open switch in the loop: no current through the lamp", r.w.l);
r = both({ components: [bat(), lamp("l"), { id: "sw", type: "switch", x: 0, y: 0, closed: true }], wires: [wire("w1", "bat", "pos", "l", "p1"), wire("w2", "l", "p2", "sw", "p1"), wire("w3", "sw", "p2", "bat", "neg")] });
ok(r.same && near(r.w.l.currentMa, 50), "closed, it lights", r.w.l);
// mains
r = both({ components: [{ id: "out", type: "outlet", x: 0, y: 0 }, lamp("l")], wires: [wire("w1", "out", "hot", "l", "p1"), wire("w2", "l", "p2", "out", "neutral")] });
ok(r.same && r.w.l.status === "burnt" && r.w.l.dangerous === true, "a lamp straight off the wall is destroyed", r.w.l);

// ---- parallel: the general network solver ----
const parallel = { components: [bat(), lamp("a"), { ...lamp("b"), x: 160 }], wires: [wire("w1", "bat", "pos", "a", "p1"), wire("w2", "bat", "pos", "b", "p1"), wire("w3", "a", "p2", "bat", "neg"), wire("w4", "b", "p2", "bat", "neg")] };
r = both(parallel);
ok(r.same && r.w.a.lamp === true && r.w.b.lamp === true && near(r.w.a.currentMa, 50, 1e-4) && near(r.w.b.currentMa, 50, 1e-4) && r.w.a.status === "normal", "two lamps across one battery each get the full 9 V: 50 mA each", [r.w.a, r.w.b]);
const mixed = { components: [bat(), lamp("a"), { ...lamp("b", 60), x: 160 }], wires: parallel.wires };
r = both(mixed);
ok(r.same && r.w.a.status === "normal" && r.w.b.status === "overheating" && r.w.b.lamp === true, "a hungrier lamp in parallel overheats on its own", [r.w.a.status, r.w.b.status]);
const dimmed = { components: [bat(1.5), lamp("a"), { ...lamp("b"), x: 160 }], wires: parallel.wires };
r = both(dimmed);
ok(r.same && r.w.a.status === "dim" && r.w.b.status === "dim", "1.5 V across two lamps: both dim", [r.w.a.status, r.w.b.status]);

// ---- meters ----
r = both({ components: [lamp("l", 120), { id: "om", type: "ohmmeter", x: 0, y: 0 }], wires: [wire("a", "om", "p1", "l", "p1"), wire("b", "om", "p2", "l", "p2")] });
ok(r.same && r.w.om.status !== "open" && near(r.w.om.ohms, 120), "an ohmmeter across a lamp reads its resistance", r.w.om);
r = both({ components: [bat(), lamp("l"), { id: "v", type: "voltmeter", x: 300, y: 200 }], wires: [...series(9).wires, wire("a", "v", "pos", "l", "p1"), wire("b", "v", "neg", "l", "p2")] });
ok(r.same && near(r.w.v.volts, 9), "a voltmeter across a lamp reads the battery voltage", r.w.v);

// ---- public page: glow and wording ----
const svgOf = (data) => W.renderSimulationSvg(data);
let svg = svgOf(series(9));
ok(/sim-comp-lamp[^>]*data-id="l"[^>]*data-powered="true"[^>]*style="--lamp-level:0\.90"/.test(svg), "a lit lamp is marked powered and carries its brightness (0.45 W of 0.5 W = 0.90)", (svg.match(/<g class="sim-comp sim-comp-lamp[^>]*>/) || [])[0]);
svg = svgOf(series(2));
ok(/sim-comp-lamp[^>]*data-powered="true"[^>]*style="--lamp-level:0\.20"/.test(svg), "a barely driven lamp glows at the 0.20 floor, not at nothing");
svg = svgOf(series(12));
ok(/sim-comp-lamp sim-damaged[^>]*data-powered="true"/.test(svg), "an overdriven lamp is marked damaged");
svg = svgOf({ components: [bat(), lamp("l")], wires: [wire("w1", "bat", "pos", "l", "p1")] });
ok(/sim-comp-lamp[^>]*data-powered="false"/.test(svg) && !/--lamp-level/.test(svg), "a lamp with one lead dangling stays dark");
svg = svgOf({ components: [lamp("l")], wires: [] });
ok(/data-powered="false"/.test(svg), "a lamp on its own stays dark");
const d = W.describeSimulation(series(9));
ok(/180 Ω lamp/.test(d.sentence || d.summary || JSON.stringify(d)), "the page description names it: 180 Ω lamp", d.sentence || d.summary);
const live = svgOf(series(9));
ok(/data-readout="180 Ω"[^>]*data-readout-live="50\.0 mA · 0\.45 W · OK"/.test(live), "tapping the lamp shows 180 Ω and its live figures", (live.match(/data-readout-live="[^"]*"/g) || []).slice(0, 3));

// ---- storage ----
ok(simulationDataError(series(9)) === null, "a circuit with a lamp saves");
ok(simulationDataError({ components: [{ id: "l", type: "lamp", x: 1, y: 1, resistance: "<script>" }], wires: [] }) === null && !/<script/.test(svgOf({ components: [{ id: "l", type: "lamp", x: 1, y: 1, resistance: "<script>" }], wires: [] })), "a hostile resistance value never reaches the markup");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
