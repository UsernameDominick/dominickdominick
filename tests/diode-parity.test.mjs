import fs from "node:fs";
import vm from "node:vm";
import * as W from "../worker/simulation-render.js";
import { simulationDataError } from "../worker/simulation-validation.js";
const window = {};
const ctx = vm.createContext({ window, console, Math, Number, String, Object, Array, Set, Map, JSON, Infinity, NaN, Float64Array, CSS: { escape: (s) => s } });
vm.runInContext(fs.readFileSync(new URL("../public/admin/sim-solver.js", import.meta.url), "utf8"), ctx);
vm.runInContext(fs.readFileSync(new URL("../public/admin/sim-components.js", import.meta.url), "utf8"), ctx);
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const near = (a, b, tol = 1e-9) => typeof a === "number" && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const both = (data) => { const w = W.computeCircuitAnalysis(data), c = window.computeSimElectricalAnalysis(data); return { w, c, same: JSON.stringify(w) === JSON.stringify(c) }; };
const bat = (v = 9) => ({ id: "bat", type: "battery", x: 10, y: 10, voltage: v });
const res = (id, ohms) => ({ id, type: "resistor", x: 100, y: 10, resistance: ohms });
const dio = (id = "d") => ({ id, type: "diode", x: 200, y: 10 });
const led = (id = "led") => ({ id, type: "led", x: 300, y: 10, color: "red" });
const vm_ = (id) => ({ id, type: "voltmeter", x: 300, y: 200 });
const wire = (id, a, ap, b, bp) => ({ id, from: { compId: a, pin: ap }, to: { compId: b, pin: bp } });
// definitions
let bad = null, n = 0;
for (const rotation of [0, 90, 180, 270]) for (const mirror of [false, true]) {
  const comp = { id: "d", type: "diode", x: 0, y: 0, ...(rotation ? { rotation } : {}), ...(mirror ? { mirror: true } : {}) };
  const c = window.getSimComponentDefinition(comp), w = W.getSimulationComponentDefinition(comp); n++;
  if (!(c && w && c.w === w.w && c.h === w.h && JSON.stringify(c.pins) === JSON.stringify(w.pins) && JSON.stringify(c.polarity) === JSON.stringify(w.polarity) && c.render(comp) === w.render(comp))) bad = { rotation, mirror };
}
ok(!bad, `client and worker diode definitions match across ${n} orientations`, bad);
const loop = (diodeFwd, extra = [], ewires = [], v = 9, ohms = 100) => ({ components: [bat(v), res("r", ohms), dio(), ...extra], wires: [wire("w1", "bat", "pos", "d", diodeFwd ? "anode" : "cathode"), wire("w2", "d", diodeFwd ? "cathode" : "anode", "r", "p1"), wire("w3", "r", "p2", "bat", "neg"), ...ewires] });
let r = both(loop(true));
ok(r.same && r.w.d.kind === "diode" && r.w.d.status === "normal" && near(r.w.d.currentMa, 83) && near(r.w.r.currentMa, 83), "9 V - 0.7 V across 100 ohm is 83 mA through the diode and the resistor", [r.w.d, r.w.r.currentMa]);
r = both(loop(false));
ok(r.same && r.w.d.status === "reversed" && r.w.d.currentMa === 0 && r.w.r.currentMa === 0, "a backwards diode blocks: reversed, 0 mA through everything", [r.w.d, r.w.r.currentMa]);
r = both(loop(true, [led()], []));
r = both({ components: [bat(), res("r", 100), dio(), led()], wires: [wire("w1", "bat", "pos", "d", "anode"), wire("w2", "d", "cathode", "led", "anode"), wire("w3", "led", "cathode", "r", "p1"), wire("w4", "r", "p2", "bat", "neg")] });
ok(r.same && r.w.d.status === "normal" && near(r.w.d.currentMa, (9 - 0.7 - 2.0) / 100 * 1000), "a diode in series with a red LED drops 0.7 V on top of the LED's 2.0 V", [r.w.d.currentMa, r.w.led.currentMa]);
r = both({ components: [bat(), res("r", 100), dio(), led()], wires: [wire("w1", "bat", "pos", "d", "cathode"), wire("w2", "d", "anode", "led", "anode"), wire("w3", "led", "cathode", "r", "p1"), wire("w4", "r", "p2", "bat", "neg")] });
ok(r.same && r.w.d.status === "reversed" && r.w.led.status === "blocked", "a backwards diode blocks the LED in the same loop ('blocked')", [r.w.d.status, r.w.led.status]);
r = both({ components: [bat(), res("r", 100), dio(), led()], wires: [wire("w1", "bat", "pos", "led", "cathode"), wire("w2", "led", "anode", "d", "anode"), wire("w3", "d", "cathode", "r", "p1"), wire("w4", "r", "p2", "bat", "neg")] });
ok(r.same && r.w.led.status === "reversed" && r.w.d.status === "blocked", "a backwards LED blocks the diode ('blocked')", [r.w.led.status, r.w.d.status]);
r = both({ components: [bat(), dio()], wires: [wire("w1", "bat", "pos", "d", "anode"), wire("w2", "d", "cathode", "bat", "neg")] });
ok(r.same && r.w.d.status === "burnt", "a diode straight across a battery with no resistor is burnt", r.w.d);
r = both(loop(true, [], [], 0.5));
ok(r.same && r.w.d.status === "off" && r.w.d.currentMa === 0, "a 0.5 V source can't reach the 0.7 V drop: off", r.w.d);
r = both(loop(true, [], [], 9, 1));
ok(r.same && r.w.d.status === "burnt", "8.3 A through a diode (1 A rating) burns it", r.w.d);
r = both(loop(true, [], [], 9, 10));
ok(r.same && r.w.d.status === "normal" && near(r.w.d.currentMa, 830), "830 mA is still under the 1 A rating: normal", r.w.d);
r = both(loop(true, [], [], 9, 4));
ok(r.same && r.w.d.status === "overdriven", "2.075 A is overdriven (1.5x to 3x the rating)", r.w.d);
r = both({ components: [{ id: "out", type: "outlet", x: 0, y: 0 }, dio()], wires: [wire("w1", "out", "hot", "d", "anode"), wire("w2", "d", "cathode", "out", "neutral")] });
ok(r.same && r.w.d.status === "burnt" && r.w.d.dangerous === true, "mains across a diode destroys it (dangerous)", r.w.d);
// voltmeters across diodes
r = both(loop(true, [vm_("v")], [wire("a", "v", "pos", "d", "anode"), wire("b", "v", "neg", "d", "cathode")]));
ok(r.same && near(r.w.v.volts, 0.7), "a voltmeter across a conducting diode reads 0.7 V", r.w.v);
r = both(loop(false, [vm_("v")], [wire("a", "v", "pos", "d", "cathode"), wire("b", "v", "neg", "d", "anode")]));
ok(r.same && r.w.v.volts !== null && near(Math.abs(r.w.v.volts), 9), "a voltmeter across a blocking diode reads the whole 9 V", r.w.v);
// ohmmeter sees a diode as open
r = both({ components: [dio(), { id: "om", type: "ohmmeter", x: 0, y: 0 }], wires: [wire("a", "om", "p1", "d", "anode"), wire("b", "om", "p2", "d", "cathode")] });
ok(r.same && r.w.om.status === "open", "an ohmmeter reads a diode as open", r.w.om);
// existing LED results unchanged
r = both({ components: [bat(), res("r", 470), led()], wires: [wire("w1", "bat", "pos", "r", "p1"), wire("w2", "r", "p2", "led", "anode"), wire("w3", "led", "cathode", "bat", "neg")] });
ok(r.same && r.w.led.kind === "led" && r.w.led.status === "normal", "an LED loop is unchanged (kind led, normal)", r.w.led);
// powered set
const ps = window.computeSimPoweredSet(loop(true)); ok(ps.poweredComps.has("d") && ps.poweredComps.has("r"), "a forward diode is part of the powered circuit");
const psr = window.computeSimPoweredSet(loop(false));
ok(!psr.poweredComps.has("d") && !psr.poweredComps.has("r") && psr.poweredNodes.size === 0 && psr.poweredWires.size === 0, "a backwards diode in the only loop powers nothing: no part, node or wire glows", [[...psr.poweredComps], psr.poweredWires.size]);
// reverse-polarity protection: battery + reversed diode, then a resistor and TV beyond it
const prot = { components: [bat(), dio(), res("r", 100), { id: "tv", type: "tv", x: 400, y: 10 }], wires: [wire("w1", "bat", "pos", "d", "cathode"), wire("w2", "d", "anode", "r", "p1"), wire("w3", "r", "p2", "bat", "neg"), wire("w4", "r", "p1", "tv", "pwr")] };
const tvPin = W.getSimulationComponentDefinition({ id: "tv", type: "tv", x: 0, y: 0 }).pins[0].id; prot.wires[3].to.pin = tvPin;
const pp = window.computeSimPoweredSet(prot); ok(!pp.poweredComps.has("r") && !pp.poweredComps.has("tv"), "behind a reversed diode the resistor and TV are not powered", [...pp.poweredComps]);
const prot2 = JSON.parse(JSON.stringify(prot)); prot2.wires[0].to.pin = "anode"; prot2.wires[1].from.pin = "cathode";
const pp2 = window.computeSimPoweredSet(prot2); ok(pp2.poweredComps.has("r") && pp2.poweredComps.has("tv") && pp2.poweredComps.has("d"), "the same circuit with the diode the right way round powers everything", [...pp2.poweredComps]);
// diode then LED then resistor, all orientations
const chain = (dFwd, lFwd) => ({ components: [bat(), dio(), led(), res("r", 330)], wires: [wire("w1", "bat", "pos", "d", dFwd ? "anode" : "cathode"), wire("w2", "d", dFwd ? "cathode" : "anode", "led", lFwd ? "anode" : "cathode"), wire("w3", "led", lFwd ? "cathode" : "anode", "r", "p1"), wire("w4", "r", "p2", "bat", "neg")] });
for (const [df, lf] of [[true, true], [true, false], [false, true], [false, false]]) { const set = window.computeSimPoweredSet(chain(df, lf)).poweredComps; const w2 = W.computePoweredSet(chain(df, lf)).poweredComps; const want = df && lf; ok(set.has("led") === want && set.has("d") === df && JSON.stringify([...set].sort()) === JSON.stringify([...w2].sort()), `diode ${df ? "forward" : "backwards"} + LED ${lf ? "forward" : "backwards"}: the LED ${want ? "glows" : "does not"} and the diode ${df ? "counts as powered" : "does not"}, worker agrees`, [...set]); }
// the neg-side diode: battery - ... resistor ... diode ... back to neg
const low = { components: [bat(), res("r", 100), dio()], wires: [wire("w1", "bat", "pos", "r", "p1"), wire("w2", "r", "p2", "d", "anode"), wire("w3", "d", "cathode", "bat", "neg")] };
ok(window.computeSimPoweredSet(low).poweredComps.has("d") && window.computeSimPoweredSet(low).poweredComps.has("r"), "a forward diode on the negative side still counts as powered");
// diode-free circuits: the client and worker powered sets agree
let srng = 4242; const srand = () => (srng = (srng * 1664525 + 1013904223) % 4294967296) / 4294967296; let identical = true, trials = 0;
const pins2 = { battery: ["pos", "neg"], resistor: ["p1", "p2"], led: ["anode", "cathode"], switch: ["p1", "p2"], outlet: ["hot", "neutral"] };
for (let t = 0; t < 1500; t++) { const comps = [bat()]; for (let i = 0; i < 2 + Math.floor(srand() * 5); i++) { const k = srand(); comps.push(k < 0.4 ? res("c" + i, 100) : k < 0.8 ? led("c" + i) : { id: "c" + i, type: "switch", x: 0, y: 0, closed: srand() < 0.7 }); }
  const wires = []; for (let i = 0; i < 2 + Math.floor(srand() * 8); i++) { const a = comps[Math.floor(srand() * comps.length)], b = comps[Math.floor(srand() * comps.length)]; const pa = pins2[a.type][Math.floor(srand() * 2)], pb = pins2[b.type][Math.floor(srand() * 2)]; if (a === b && pa === pb) continue; wires.push(wire("w" + i, a.id, pa, b.id, pb)); }
  const d = { components: comps, wires }; const norm = (r) => JSON.stringify({ c: [...r.poweredComps].sort(), w: [...r.poweredWires].sort(), n: [...r.poweredNodes].sort() }); trials++;
  if (norm(window.computeSimPoweredSet(d)) !== norm(W.computePoweredSet(d))) { identical = false; console.log("powered set differs", JSON.stringify(d).slice(0, 200)); break; } }
ok(identical, `${trials} random diode-free circuits: the client's powered sets match the worker's`);
// random circuits with diodes: worker and client powered sets agree
let pagree = true; srng = 99;
for (let t = 0; t < 1500; t++) { const comps = [bat()]; for (let i = 0; i < 2 + Math.floor(srand() * 5); i++) { const k = srand(); comps.push(k < 0.3 ? res("c" + i, 100) : k < 0.7 ? dio("c" + i) : led("c" + i)); }
  const wires = []; for (let i = 0; i < 2 + Math.floor(srand() * 8); i++) { const a = comps[Math.floor(srand() * comps.length)], b = comps[Math.floor(srand() * comps.length)]; const pa = pinsOf2(a), pb = pinsOf2(b); if (a === b && pa === pb) continue; wires.push(wire("w" + i, a.id, pa, b.id, pb)); }
  const d = { components: comps, wires }; const norm = (r) => JSON.stringify({ c: [...r.poweredComps].sort(), w: [...r.poweredWires].sort(), n: [...r.poweredNodes].sort() }); if (norm(window.computeSimPoweredSet(d)) !== norm(W.computePoweredSet(d))) { pagree = false; break; } }
function pinsOf2(c) { const m = { battery: ["pos", "neg"], resistor: ["p1", "p2"], diode: ["anode", "cathode"], led: ["anode", "cathode"] }[c.type]; return m[Math.floor(srand() * 2)]; }
ok(pagree, "1500 random circuits with diodes: worker and client powered sets agree");
// render + server
const svg = W.renderSimulationSvg(loop(true)); ok(/class="diode-body"/.test(svg) && !/<script/i.test(svg), "the public SVG draws the diode symbol");
ok(simulationDataError(loop(true)) === null, "the server accepts circuits with diodes");
// random circuits: engines agree
let rng = 777; const rand = () => (rng = (rng * 1664525 + 1013904223) % 4294967296) / 4294967296;
let same = true, diodes = 0;
const pinsOf = { battery: ["pos", "neg"], resistor: ["p1", "p2"], diode: ["anode", "cathode"], led: ["anode", "cathode"], voltmeter: ["pos", "neg"], ohmmeter: ["p1", "p2"] };
for (let t = 0; t < 2500; t++) {
  const comps = [bat(1 + Math.floor(rand() * 12))]; const count = 2 + Math.floor(rand() * 6);
  for (let i = 0; i < count; i++) { const k = rand(); const id = "c" + i; comps.push(k < 0.3 ? res(id, 10 + Math.floor(rand() * 500)) : k < 0.6 ? dio(id) : k < 0.75 ? led(id) : k < 0.88 ? { ...vm_(id) } : { id, type: "ohmmeter", x: 0, y: 0 }); }
  const wires = []; const nw = 2 + Math.floor(rand() * 9);
  for (let i = 0; i < nw; i++) { const a = comps[Math.floor(rand() * comps.length)], b = comps[Math.floor(rand() * comps.length)]; const pa = pinsOf[a.type][Math.floor(rand() * 2)], pb = pinsOf[b.type][Math.floor(rand() * 2)]; if (a === b && pa === pb) continue; wires.push(wire("w" + i, a.id, pa, b.id, pb)); }
  const d = { components: comps, wires }; const rr = both(d); same = same && rr.same; diodes += comps.filter((c) => c.type === "diode").length;
  const vals = Object.values(rr.w); if (vals.some((x) => x.kind === "diode" && !(x.status && (Number.isFinite(x.currentMa) || x.currentMa === Infinity)))) { same = false; console.log("bad diode result", JSON.stringify(rr.w)); }
}
ok(same, `2500 random circuits (${diodes} diodes): worker and client agree and every diode result is well formed`);
console.log(fail ? `FAILURES ${fail}` : "ALL PASS"); process.exit(fail ? 1 : 0);
