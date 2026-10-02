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
let seed = 987654; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; const pick = (a) => a[Math.floor(rnd() * a.length)];
const pins = { battery: ["pos", "neg"], resistor: ["p1", "p2"], led: ["anode", "cathode"], diode: ["anode", "cathode"], transistor: ["collector", "base", "emitter"], voltmeter: ["pos", "neg"], ammeter: ["p1", "p2"] };
let diffs = 0, withT = 0, errors = 0;
for (let t = 0; t < 3000; t++) {
  const comps = [{ id: "b0", type: "battery", x: 10, y: 10, voltage: pick([3, 5, 9, 12]) }]; if (rnd() < 0.2) comps.push({ id: "b1", type: "battery", x: 10, y: 80, voltage: pick([3, 9]) });
  const n = 3 + Math.floor(rnd() * 7);
  for (let i = 0; i < n; i++) { const type = pick(["resistor", "resistor", "led", "diode", "transistor", "transistor", "voltmeter", "ammeter"]); const c = { id: "c" + i, type, x: 50 + i * 20, y: 50 + i * 10 }; if (type === "resistor") c.resistance = pick([47, 330, 1000, 10000, 100000]); if (type === "led") c.color = pick(["red", "blue", "green"]); if (type === "transistor") { c.polarity = pick(["npn", "pnp"]); c.gain = pick([50, 100, 300]); } comps.push(c); }
  const wires = []; const nw = comps.length + Math.floor(rnd() * 5);
  const endpoint = () => { const c = pick(comps); return [c.id, pick(pins[c.type])]; };
  for (let i = 0; i < nw; i++) { const [a, ap] = endpoint(), [b, bp] = endpoint(); if (a === b && ap === bp) continue; wires.push(w(a, ap, b, bp)); }
  const d = { components: comps, wires };
  if (comps.some((c) => c.type === "transistor")) withT++;
  try {
    const ca = window.computeSimElectricalAnalysis(d), wa = W.computeCircuitAnalysis(d);
    const cp = window.computeSimPoweredSet(d, ca), wp = W.computePoweredSet(d, wa);
    const same = JSON.stringify(ca) === JSON.stringify(wa) && JSON.stringify([...cp.poweredComps].sort()) === JSON.stringify([...wp.poweredComps].sort()) && JSON.stringify([...cp.poweredNodes].sort()) === JSON.stringify([...wp.poweredNodes].sort()) && JSON.stringify([...cp.poweredWires].sort()) === JSON.stringify([...wp.poweredWires].sort());
    if (!same) { diffs++; if (diffs < 3) console.log("DIFF", JSON.stringify(d).slice(0, 400)); }
  } catch (e) { errors++; if (errors < 3) console.log("ERR", e.message, JSON.stringify(d).slice(0, 300)); }
}
ok(diffs === 0 && errors === 0, `3000 random circuits (${withT} with a transistor): client and worker agree, no exceptions (${diffs} differences, ${errors} errors)`);
console.log(fail ? "FAILURES " + fail : "ALL PASS");
