// The buzzer part: a resistance that sounds once it gets enough voltage. The browser (public/admin/sim-components.js + sim-solver.js)
// and the worker (worker/simulation-render.js) each analyse a circuit; the two must agree on a buzzer in every kind of circuit.
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
const bz = (id = "z", ohms) => ({ id, type: "buzzer", x: 100, y: 10, ...(ohms === undefined ? {} : { resistance: ohms }) });
const res = (id, ohms) => ({ id, type: "resistor", x: 200, y: 10, resistance: ohms });
const wire = (id, a, ap, b, bp) => ({ id, from: { compId: a, pin: ap }, to: { compId: b, pin: bp } });
const series = (v, ohms) => ({ components: [bat(v), bz("z", ohms)], wires: [wire("w1", "bat", "pos", "z", "p1"), wire("w2", "z", "p2", "bat", "neg")] });

// ---- definition ----
let bad = null, n = 0;
for (const rotation of [0, 90, 180, 270]) for (const mirror of [false, true]) {
  const comp = { id: "z", type: "buzzer", x: 0, y: 0, ...(rotation ? { rotation } : {}), ...(mirror ? { mirror: true } : {}) };
  const c = window.getSimComponentDefinition(comp), w = W.getSimulationComponentDefinition(comp); n++;
  if (!(c && w && c.w === w.w && c.h === w.h && JSON.stringify(c.pins) === JSON.stringify(w.pins) && c.render(comp) === w.render(comp))) bad = { rotation, mirror };
}
ok(!bad, `client and worker buzzer definitions match across ${n} orientations`, bad);
const comp0 = { id: "z", type: "buzzer", x: 0, y: 0 };
const def = W.getSimulationComponentDefinition(comp0);
ok(def.pins.length === 2 && def.pins[0].x === 0 && def.pins[1].x === 40 && def.pins[0].y === 40 && def.pins[1].y === 40, "two leads one breadboard hole-spacing apart, like the lamp and the LED");
const art = def.render(comp0);
ok(/buzzer-body/.test(art) && /buzzer-wave-1/.test(art) && /buzzer-wave-2/.test(art) && /sch-buzzer-body/.test(art) && />BZ</.test(art), "drawn both ways: the round sounder with its arcs, and the BZ circle");
// every part of the drawing sits inside its 40 x 40 box
const nums = [...art.matchAll(/(?:x|cx|x1|x2)="([\d.]+)"/g)].map((m) => Number(m[1]));
ok(Math.max(...nums) <= 40 + 0.001, "nothing is drawn past the right edge of the part", Math.max(...nums));

// ---- numbers ----
ok(W.buzzerOhms({}) === 250 && W.buzzerOhms({ resistance: 60 }) === 60 && W.buzzerOhms({ resistance: "x" }) === 250 && W.buzzerOhms({ resistance: -5 }) === 250 && W.buzzerOhms({ resistance: 0 }) === 250 && W.buzzerOhms({ resistance: 0.2 }) === 1 && W.buzzerOhms(null) === 250, "resistance defaults to 250 and is kept sane");
ok(window.simBuzzerOhms({ resistance: 60 }) === 60 && window.simBuzzerOhms({}) === 250 && window.simBuzzerOhms({ resistance: "x" }) === 250, "the client reads it the same way");
ok(window.SIM_BUZZER_RATED_WATTS === W.BUZZER_RATED_WATTS && W.BUZZER_RATED_WATTS === 0.5 && window.SIM_BUZZER_MIN_VOLTS === W.BUZZER_MIN_VOLTS && W.BUZZER_MIN_VOLTS === 2.5, "both sides know the 0.5 W rating and the 2.5 V threshold");

// ---- one-path analysis ----
let r = both(series(9));
ok(r.same && r.w.z.kind === "resistor" && r.w.z.buzzer === true && near(r.w.z.currentMa, 36) && near(r.w.z.watts, 0.324) && near(r.w.z.volts, 9) && r.w.z.status === "buzzing", "9 V across the default 250 ohm buzzer: 36 mA, 0.32 W, buzzing", r.w.z);
r = both(series(3));
ok(r.same && r.w.z.status === "buzzing" && near(r.w.z.volts, 3), "3 V is enough", r.w.z);
r = both(series(2));
ok(r.same && r.w.z.status === "quiet" && near(r.w.z.volts, 2) && r.w.z.currentMa > 0, "2 V is under the 2.5 V threshold: too quiet", r.w.z);
r = both(series(12));
ok(r.same && r.w.z.status === "overheating" && r.w.z.watts > 0.5, "12 V is 0.58 W against a 0.5 W rating: overheating", r.w.z);
r = both(series(9, 100));
ok(r.same && r.w.z.status === "overheating" && near(r.w.z.watts, 0.81), "a 100 ohm buzzer on 9 V is 0.81 W: overheating", r.w.z);
r = both({ components: [bat(), bz("z"), res("r", 220)], wires: [wire("w1", "bat", "pos", "z", "p1"), wire("w2", "z", "p2", "r", "p1"), wire("w3", "r", "p2", "bat", "neg")] });
ok(r.same && near(r.w.z.currentMa, 9000 / 470) && near(r.w.z.volts, 250 * 9 / 470) && r.w.z.status === "buzzing", "a resistor in series takes its share (4.8 V left for the buzzer, still sounds)", [r.w.z.currentMa, r.w.z.volts]);
r = both({ components: [bat(), bz("z"), res("r", 1000)], wires: [wire("w1", "bat", "pos", "z", "p1"), wire("w2", "z", "p2", "r", "p1"), wire("w3", "r", "p2", "bat", "neg")] });
ok(r.same && r.w.z.status === "quiet" && near(r.w.z.volts, 250 * 9 / 1250), "with a 1 k resistor in series it only gets 1.8 V: too quiet", r.w.z);
r = both({ components: [bat(12), res("r", 100)], wires: [wire("w1", "bat", "pos", "r", "p1"), wire("w2", "r", "p2", "bat", "neg")] });
ok(r.same && !("buzzer" in r.w.r) && !("lamp" in r.w.r) && r.w.r.status === "overheating", "a plain resistor result carries no buzzer or lamp flag", r.w.r);
r = both({ components: [bat(), bz("z"), { id: "sw", type: "switch", x: 0, y: 0, closed: false }], wires: [wire("w1", "bat", "pos", "z", "p1"), wire("w2", "z", "p2", "sw", "p1"), wire("w3", "sw", "p2", "bat", "neg")] });
ok(r.same && (!r.w.z || r.w.z.status === "off" || !(r.w.z.currentMa > 0)), "an open switch in the loop: it is silent", r.w.z);
r = both({ components: [bat(), bz("z"), { id: "sw", type: "switch", x: 0, y: 0, closed: true }], wires: [wire("w1", "bat", "pos", "z", "p1"), wire("w2", "z", "p2", "sw", "p1"), wire("w3", "sw", "p2", "bat", "neg")] });
ok(r.same && r.w.z.status === "buzzing", "closed, it sounds", r.w.z);
r = both({ components: [{ id: "out", type: "outlet", x: 0, y: 0 }, bz("z")], wires: [wire("w1", "out", "hot", "z", "p1"), wire("w2", "z", "p2", "out", "neutral")] });
ok(r.same && r.w.z.status === "burnt" && r.w.z.dangerous === true, "a buzzer straight off the wall is destroyed", r.w.z);
// it sounds whichever way round it is wired
const flipped = { components: [bat(), bz("z")], wires: [wire("w1", "bat", "pos", "z", "p2"), wire("w2", "z", "p1", "bat", "neg")] };
r = both(flipped);
ok(r.same && r.w.z.status === "buzzing", "wired the other way round it still sounds (no polarity)", r.w.z.status);

// ---- parallel: the general network solver ----
const wiresPar = [wire("w1", "bat", "pos", "a", "p1"), wire("w2", "bat", "pos", "b", "p1"), wire("w3", "a", "p2", "bat", "neg"), wire("w4", "b", "p2", "bat", "neg")];
r = both({ components: [bat(), bz("a"), { ...bz("b"), x: 160 }], wires: wiresPar });
ok(r.same && r.w.a.buzzer === true && r.w.b.buzzer === true && near(r.w.a.currentMa, 36, 1e-4) && r.w.a.status === "buzzing" && r.w.b.status === "buzzing", "two buzzers across one battery each get the full 9 V", [r.w.a, r.w.b]);
r = both({ components: [bat(), bz("a"), { ...bz("b", 100), x: 160 }], wires: wiresPar });
ok(r.same && r.w.a.status === "buzzing" && r.w.b.status === "overheating" && r.w.b.buzzer === true, "a hungrier buzzer in parallel overheats on its own", [r.w.a.status, r.w.b.status]);
r = both({ components: [bat(2), bz("a"), { ...bz("b"), x: 160 }], wires: wiresPar });
ok(r.same && r.w.a.status === "quiet" && r.w.b.status === "quiet", "2 V across two buzzers: both too quiet", [r.w.a.status, r.w.b.status]);
r = both({ components: [bat(), bz("a"), { ...bz("b"), x: 160 }], wires: wiresPar.slice(0, 3) });
ok(r.same, "a buzzer in a half-wired parallel circuit: client and worker still agree");

// ---- mixed with a lamp ----
r = both({ components: [bat(), bz("z"), { id: "l", type: "lamp", x: 160, y: 10 }], wires: [wire("w1", "bat", "pos", "z", "p1"), wire("w2", "bat", "pos", "l", "p1"), wire("w3", "z", "p2", "bat", "neg"), wire("w4", "l", "p2", "bat", "neg")] });
ok(r.same && r.w.z.buzzer === true && !r.w.z.lamp && r.w.l.lamp === true && !r.w.l.buzzer, "a buzzer and a lamp on one battery keep their own kinds", [r.w.z.status, r.w.l.status]);

// ---- meters ----
r = both({ components: [bz("z", 120), { id: "om", type: "ohmmeter", x: 0, y: 0 }], wires: [wire("a", "om", "p1", "z", "p1"), wire("b", "om", "p2", "z", "p2")] });
ok(r.same && r.w.om.status !== "open" && near(r.w.om.ohms, 120), "an ohmmeter across a buzzer reads its resistance", r.w.om);
r = both({ components: [bat(), bz("z"), { id: "v", type: "voltmeter", x: 300, y: 200 }], wires: [...series(9).wires, wire("a", "v", "pos", "z", "p1"), wire("b", "v", "neg", "z", "p2")] });
ok(r.same && near(r.w.v.volts, 9), "a voltmeter across a buzzer reads the battery voltage", r.w.v);

// ---- public page: the sounding flag and wording ----
const svgOf = (data) => W.renderSimulationSvg(data);
const gOf = (svg) => (svg.match(/<g class="sim-comp sim-comp-buzzer[^>]*>/) || [])[0];
let svg = svgOf(series(9));
ok(/data-sounding="true"/.test(gOf(svg)) && /data-readout="250 Ω"/.test(gOf(svg)), "a driven buzzer is marked sounding and shows its value", gOf(svg));
ok(/data-readout-live="36\.0 mA · 0\.32 W · Buzzing"/.test(svg), "its live figures say Buzzing", (svg.match(/data-readout-live="[^"]*"/g) || []));
svg = svgOf(series(2));
ok(/data-sounding="false"/.test(gOf(svg)) && /Too quiet/.test(svg), "a quiet one is not marked sounding, and says Too quiet");
svg = svgOf(series(12));
ok(/sim-comp-buzzer sim-damaged/.test(gOf(svg)) && /data-sounding="false"/.test(gOf(svg)), "an overdriven one is marked damaged and silent", gOf(svg));
svg = svgOf({ components: [bat(), bz("z")], wires: [wire("w1", "bat", "pos", "z", "p1")] });
ok(/data-sounding="false"/.test(gOf(svg)), "a buzzer with one lead dangling is silent");
svg = svgOf({ components: [bz("z")], wires: [] });
ok(/data-sounding="false"/.test(gOf(svg)), "a buzzer on its own is silent");
ok(!/data-sounding/.test(svgOf(series(9)).replace(/<g class="sim-comp sim-comp-buzzer[^>]*>/, "")), "only buzzers carry the flag");
const d = W.describeSimulation(series(9));
ok(/250 Ω buzzer/.test(JSON.stringify(d)), "the page description names it: 250 Ω buzzer", d.sentence || d.summary);

// ---- storage ----
ok(simulationDataError(series(9)) === null, "a circuit with a buzzer saves");
const hostile = { components: [{ id: "z", type: "buzzer", x: 1, y: 1, resistance: "<script>" }], wires: [] };
ok(simulationDataError(hostile) === null && !/<script/.test(svgOf(hostile)), "a hostile resistance value never reaches the markup");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
