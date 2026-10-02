// The voltage at each pin, as the simulation builder's "Show voltages" draws it. Loads the builder's own analysis code.
import fs from "node:fs";
import vm from "node:vm";
import * as W from "../worker/simulation-render.js";

const window = {};
const ctx = vm.createContext({ window, console, Math, Number, String, Object, Array, Set, Map, JSON, Infinity, NaN, CSS: { escape: (s) => s } });
for (const f of ["sim-solver.js", "sim-schematic.js", "sim-components.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/admin/${f}`, import.meta.url), "utf8"), ctx);
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const near = (a, b, tol = 1e-6) => typeof a === "number" && Math.abs(a - b) < tol;

const bat = (extra = {}) => ({ id: "bat", type: "battery", x: 10, y: 10, voltage: 9, ...extra });
const res = (id, ohms, x = 200) => ({ id, type: "resistor", x, y: 10, resistance: ohms });
const led = (id, x = 400) => ({ id, type: "led", x, y: 10, color: "red" });
const wire = (id, a, ap, b, bp) => ({ id, from: { compId: a, pin: ap }, to: { compId: b, pin: bp } });
const node = (c, pin) => window.simNodeId(c, pin);
const volts = (data, options = { voltages: true }) => {
  const a = window.computeSimElectricalAnalysis(data, options);
  return (comp, pin) => a.nodeVoltage(node(comp, pin));
};

// series: battery 9 V, R1 100, R2 200 -> 30 mA: nodes 9, 6, 0
{
  const R1 = res("r1", 100, 100), R2 = res("r2", 200, 300), B = bat();
  const data = { components: [B, R1, R2], wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "r2", "p1"), wire("w3", "r2", "p2", "bat", "neg")] };
  const v = volts(data);
  ok(near(v(B, "pos"), 9) && near(v(R1, "p1"), 9), "the battery's + side is at 9 V", [v(B, "pos"), v(R1, "p1")]);
  ok(near(v(R1, "p2"), 6) && near(v(R2, "p1"), 6), "between the two resistors it is 6 V (30 mA through 200 Ω)", [v(R1, "p2"), v(R2, "p1")]);
  ok(near(v(R2, "p2"), 0) && near(v(B, "neg"), 0), "back at the battery's − side it is 0 V", [v(R2, "p2"), v(B, "neg")]);
  // without the option nothing is worked out (no voltmeter in the circuit), and the ordinary results are identical either way
  const plain = window.computeSimElectricalAnalysis(data);
  ok(plain.nodeVoltage(node(R1, "p2")) === undefined, "without the option, with no voltmeter, there are no node voltages");
  ok(JSON.stringify(plain) === JSON.stringify(window.computeSimElectricalAnalysis(data, { voltages: true })) && JSON.stringify(plain) === JSON.stringify(W.computeCircuitAnalysis(data)), "asking for voltages changes none of the part results (client and worker still agree)");
  ok(!Object.keys(window.computeSimElectricalAnalysis(data, { voltages: true })).includes("nodeVoltage"), "nodeVoltage stays out of sight of loops over the results");
}

// LED loop: the LED's anode sits at its forward voltage (2 V) above its cathode
{
  const B = bat(), R = res("r1", 220, 150), L = led("l1");
  const data = { components: [B, R, L], wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "l1", "anode"), wire("w3", "l1", "cathode", "bat", "neg")] };
  const v = volts(data);
  ok(near(v(L, "anode"), 2, 1e-3) && near(v(L, "cathode"), 0), "an LED conducting from a 9 V battery drops its 2 V forward voltage", [v(L, "anode"), v(L, "cathode")]);
  ok(near(v(R, "p1"), 9) && near(v(R, "p2"), 2, 1e-3), "and the resistor takes the other 7 V", [v(R, "p1"), v(R, "p2")]);
}

// parallel branches go through the general solver
{
  const B = bat(), RS = res("rs", 100, 100), RA = res("ra", 300, 300), RB = res("rb", 600, 300);
  RB.y = 200;
  const data = {
    components: [B, RS, RA, RB],
    wires: [
      wire("w1", "bat", "pos", "rs", "p1"), wire("w2", "rs", "p2", "ra", "p1"), wire("w3", "rs", "p2", "rb", "p1"),
      wire("w4", "ra", "p2", "bat", "neg"), wire("w5", "rb", "p2", "bat", "neg"),
    ],
  };
  // 300 ∥ 600 = 200 Ω, + 100 Ω series = 300 Ω, so 30 mA; the junction is 9 - 3 = 6 V
  const v = volts(data);
  ok(near(v(RS, "p2"), 6) && near(v(RA, "p1"), 6) && near(v(RB, "p1"), 6), "a parallel pair shares one junction voltage (6 V)", [v(RS, "p2"), v(RA, "p1"), v(RB, "p1")]);
  ok(near(v(RA, "p2"), 0) && near(v(RB, "p2"), 0), "and both return to 0 V", [v(RA, "p2"), v(RB, "p2")]);
}

// a pin nothing reaches has no voltage to show
{
  const B = bat(), R = res("lonely", 100);
  const v = volts({ components: [B, R], wires: [] });
  ok(v(R, "p1") === undefined && v(R, "p2") === undefined, "an unconnected part has no voltage", [v(R, "p1"), v(R, "p2")]);
}
// damaged data never throws
ok((() => { try { window.computeSimElectricalAnalysis(null, { voltages: true }); window.computeSimElectricalAnalysis({ components: [{}], wires: [{}] }, { voltages: true }); return true; } catch (e) { return false; } })(), "damaged data never throws");

if (fail) { console.log(`FAILURES ${fail}`); process.exit(1); }
console.log("ALL PASS");
