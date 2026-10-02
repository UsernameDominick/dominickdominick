// The simulation builder's parameter sweep: solve the circuit across a range of one setting and chart one reading.
// Loads the builder's own analysis code plus sim-sweep.js.
import fs from "node:fs";
import vm from "node:vm";

const window = {};
const ctx = vm.createContext({ window, console, Math, Number, String, Object, Array, Set, Map, JSON, Infinity, NaN, CSS: { escape: (s) => s } });
for (const f of ["sim-solver.js", "sim-schematic.js", "sim-components.js", "sim-sweep.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/admin/${f}`, import.meta.url), "utf8"), ctx);
const S = window.SimSweep;
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const near = (a, b, tol = 1e-6) => typeof a === "number" && Math.abs(a - b) < tol;

const wire = (id, a, ap, b, bp) => ({ id, from: { compId: a, pin: ap }, to: { compId: b, pin: bp } });
const names = new Map([["bat", "Battery 1"], ["r1", "Resistor 1"], ["r2", "Resistor 2"], ["pot", "Pot 1"], ["am", "Ammeter 1"]]);
// battery 10 V -> R1 (swept) -> R2 100 Ω -> back
const circuit = (r1 = 100) => ({
  components: [
    { id: "bat", type: "battery", x: 10, y: 10, voltage: 10 },
    { id: "r1", type: "resistor", x: 100, y: 10, resistance: r1 },
    { id: "r2", type: "resistor", x: 300, y: 10, resistance: 100 },
  ],
  wires: [wire("w1", "bat", "pos", "r1", "p1"), wire("w2", "r1", "p2", "r2", "p1"), wire("w3", "r2", "p2", "bat", "neg")],
});
const base = (extra = {}) => ({ compId: "r1", paramKey: "resistance", from: 100, to: 900, steps: 3, scale: "linear", ...extra });
const watchCurrent = { kind: "reading", compId: "r2", field: "currentMa", unit: "mA" };

// what can be swept and watched
{
  const data = circuit();
  const sw = S.sweepable(data);
  ok(sw.map((s) => `${s.compId}.${s.param.key}`).join() === "bat.voltage,bat.internalResistance,r1.resistance,r2.resistance", "a battery and each resistor are sweepable", sw.map((s) => `${s.compId}.${s.param.key}`));
  const opts = S.watchOptions(data, names, (c, p) => p);
  ok(opts.filter((o) => o.kind === "reading").length === 4, "each resistor offers its current and its power", opts.filter((o) => o.kind === "reading").map((o) => o.label));
  ok(opts.some((o) => o.kind === "pin" && o.compId === "r2" && o.pin === "p1" && o.label === "Resistor 2, p1"), "a wired pin can be watched, named for the part", opts.filter((o) => o.kind === "pin").length);
  ok(!opts.some((o) => o.kind === "pin" && !data.wires.some((w) => (w.from.compId === o.compId && w.from.pin === o.pin) || (w.to.compId === o.compId && w.to.pin === o.pin))), "a pin with no wire is not offered");
}

// a linear sweep of R1 against the current through R2: 10 V over (R1 + 100 Ω)
{
  const r = S.run(circuit(), base({ watch: watchCurrent }));
  ok(!r.error && r.xs.join() === "100,500,900", "three values, 100 to 900", r.xs);
  ok(near(r.ys[0], 50, 1e-6) && near(r.ys[1], 16.6666667, 1e-5) && near(r.ys[2], 10, 1e-6), "current through R2 is 50, 16.7 and 10 mA", r.ys);
  ok(near(r.now, 50, 1e-6), "'as built' (R1 = 100 Ω) is the 50 mA the circuit has now", r.now);
  const power = S.run(circuit(), base({ watch: { kind: "reading", compId: "r2", field: "watts", unit: "W" } }));
  ok(near(power.ys[0], 0.25, 1e-9), "power in R2 at R1 = 100 Ω is 0.25 W (50 mA squared times 100 Ω)", power.ys[0]);
  const pin = S.run(circuit(), base({ watch: { kind: "pin", compId: "r2", pin: "p1", unit: "V" } }));
  ok(near(pin.ys[0], 5) && near(pin.ys[1], 10 / 6) && near(pin.ys[2], 1), "the voltage at R2's top is 5, 1.67 and 1 V (a divider)", pin.ys);
}

// the circuit passed in is never changed
{
  const data = circuit();
  const before = JSON.stringify(data);
  S.run(data, base({ watch: watchCurrent }));
  ok(JSON.stringify(data) === before, "the circuit data is untouched by a sweep");
}

// log scale
{
  const r = S.run(circuit(), base({ from: 100, to: 10000, steps: 3, scale: "log", watch: watchCurrent }));
  ok(r.xs.join() === "100,1000,10000", "a log sweep steps by equal ratios", r.xs);
  ok(S.run(circuit(), base({ from: 0, to: 10, scale: "log", watch: watchCurrent })).error, "a log scale cannot start at zero (resistance also has a floor of 1 Ω)");
}

// battery voltage and potentiometer wiper
{
  const v = S.run(circuit(), { compId: "bat", paramKey: "voltage", from: 5, to: 15, steps: 3, scale: "linear", watch: watchCurrent });
  ok(near(v.ys[0], 25) && near(v.ys[1], 50) && near(v.ys[2], 75), "raising the battery raises the current in proportion", v.ys);
  const pot = { components: [{ id: "bat", type: "battery", x: 10, y: 10, voltage: 10 }, { id: "pot", type: "potentiometer", x: 100, y: 10, maxResistance: 1000, wiper: 50 }, { id: "r2", type: "resistor", x: 300, y: 10, resistance: 1000 }], wires: [wire("w1", "bat", "pos", "pot", "p1"), wire("w2", "pot", "p2", "r2", "p1"), wire("w3", "r2", "p2", "bat", "neg")] };
  const w = S.run(pot, { compId: "pot", paramKey: "wiper", from: 0, to: 100, steps: 3, watch: watchCurrent });
  ok(w.ys.length === 3 && near(w.ys[1], 10 / 1.5, 1e-4) && near(w.ys[2], 5, 1e-6), "a rheostat at 50% and 100% passes 6.67 and 5 mA", w.ys);
  ok(S.currentValue(pot.components[1], S.paramFor("potentiometer", "wiper")) === 50, "the as-built wiper position is read from the part");
}

// requests are checked and put right
{
  const p = S.paramFor("resistor", "resistance");
  ok(S.normalize({ from: 900, to: 100, steps: 3 }, p).spec.from === 100, "a reversed range is put in order");
  ok(S.normalize({ from: 100, to: 900, steps: 5000 }, p).spec.steps === S.MAX_STEPS && S.normalize({ from: 100, to: 900, steps: 0 }, p).spec.steps >= S.MIN_STEPS, "the number of steps is kept in bounds");
  ok(S.normalize({ from: 100, to: 100 }, p).error && S.normalize({ from: "x", to: 5 }, p).error && S.normalize({ from: 0, to: 5 }, p).error, "an empty, unreadable or out-of-range request gets a plain message", S.normalize({ from: 0, to: 5 }, p).error);
  ok(S.normalize({ from: 100, to: 900, scale: "log" }, S.paramFor("potentiometer", "wiper")) && S.normalize({ from: 1, to: 9, scale: "log" }, S.paramFor("potentiometer", "wiper")).spec.scale === "linear", "a setting that cannot be logarithmic falls back to linear");
  ok(S.run({ components: [] }, base({ watch: watchCurrent })).error && S.run(circuit(), base({ compId: "zzz", watch: watchCurrent })).error && S.run(circuit(), base({ watch: null })).error && S.run(circuit(), base({ watch: { kind: "reading", compId: "gone", field: "currentMa", unit: "mA" } })).error, "a missing part or choice is an error message, never a crash");
  ok(S.run(null, base({ watch: watchCurrent })).error && S.run(undefined, {}).error, "damaged input is an error message, not a throw");
}

// readings that do not exist are gaps, not zeros
{
  const open = { components: [{ id: "bat", type: "battery", x: 10, y: 10, voltage: 10 }, { id: "r1", type: "resistor", x: 100, y: 10, resistance: 100 }], wires: [wire("w1", "bat", "pos", "r1", "p1")] };
  const r = S.run(open, base({ watch: { kind: "reading", compId: "r1", field: "currentMa", unit: "mA" } }));
  ok(r.ys.every((y) => y === null || y === 0), "an open circuit gives no reading (or zero current), never a made-up figure", r.ys);
  const nopin = S.run(open, base({ watch: { kind: "pin", compId: "r1", pin: "p2", unit: "V" } }));
  ok(S.describe(nopin, names, "voltage at Resistor 1, p2").length > 0 && S.chartSvg(nopin, names, "voltage at Resistor 1, p2").startsWith("<svg"), "an all-gap sweep still describes and draws without error", nopin.ys);
  const short = { components: [{ id: "bat", type: "battery", x: 10, y: 10, voltage: 10 }, { id: "am", type: "ammeter", x: 100, y: 10 }], wires: [wire("w1", "bat", "pos", "am", "p1"), wire("w2", "am", "p2", "bat", "neg")] };
  const s = S.run(short, { compId: "bat", paramKey: "voltage", from: 5, to: 15, steps: 3, watch: { kind: "reading", compId: "am", field: "currentMa", unit: "mA" } });
  ok(s.ys.every((y) => y === null), "a dead short (infinite current) is a gap, not Infinity", s.ys);
}

// the words, the csv and the chart
{
  const r = S.run(circuit(), base({ watch: watchCurrent }));
  const label = "current through Resistor 2";
  const text = S.describe(r, names, label);
  ok(/Current through Resistor 2 as the resistance of Resistor 1 goes from 100Ω to 900Ω: from 50 mA to 10 mA/.test(text), "the summary says what moved and the range of the answer", text);
  ok(/lowest 10 mA at 900Ω, highest 50 mA at 100Ω/.test(text) && /As built \(100Ω\) it is 50 mA/.test(text), "it names the lowest and highest points and the as-built figure", text);
  const csv = S.csv(r, names, label).split("\n");
  ok(csv.length === 4 && csv[0] === "Resistance of Resistor 1 (Ω),Current through Resistor 2 (mA)" && csv[1] === "100,50", "the CSV has a header and one row per step", csv);
  const evil = S.csv(r, names, "=cmd|' /c calc'!A0, more").split("\n")[0].split(",");
  ok(evil.join(",").startsWith("Resistance of Resistor 1 (Ω),\"'=cmd"), "a label that opens with = is not left as a spreadsheet formula, and commas are quoted", evil);
  const svg = S.chartSvg(r, names, label);
  ok(svg.startsWith("<svg") && svg.endsWith("</svg>") && (svg.match(/<polyline/g) || []).length === 1 && (svg.match(/<circle/g) || []).length === 3, "one line and a dot for each step", (svg.match(/<circle/g) || []).length);
  ok(/class="sweep-now"/.test(svg) && /as built/.test(svg), "the as-built setting is marked");
  const nasty = S.chartSvg(r, new Map([["r1", "<img src=x onerror=alert(1)>"]]), "<script>alert(1)</script>");
  ok(!/<img|<script/i.test(nasty) && /&lt;script&gt;/.test(nasty), "names are escaped in the chart", nasty.length);
  ok(!/NaN|Infinity|undefined/.test(svg), "no NaN or Infinity ends up in the drawing");
  const flat = S.run(circuit(), { compId: "r1", paramKey: "resistance", from: 100, to: 900, steps: 3, watch: { kind: "pin", compId: "bat", pin: "pos", unit: "V" } });
  ok(!/NaN|Infinity/.test(S.chartSvg(flat, names, "flat")) && /\(no change\)/.test(S.describe(flat, names, "flat")), "a flat line (the battery's own + side never moves) draws and says so", flat.ys);
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
