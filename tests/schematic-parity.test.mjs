// The schematic symbols are one shared file, but each renderer wraps them with the pictorial art: check the client and the
// worker draw every part identically (art and symbol both), for a spread of settings and at every orientation.
import fs from "node:fs";
import vm from "node:vm";
import * as W from "../worker/simulation-render.js";

const window = {};
const ctx = vm.createContext({ window, console, Math, Number, String, Object, Array, Set, Map, JSON, Infinity, NaN, Float64Array, CSS: { escape: (s) => s } });
for (const f of ["sim-solver.js", "sim-schematic.js", "sim-components.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/admin/${f}`, import.meta.url), "utf8"), ctx);

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const types = Object.keys(window.SimSchematic.symbols);
ok(types.length >= 14, `${types.length} part types have a schematic symbol`, types);

const variants = (type) => {
  const base = { id: "p", type, x: 10, y: 10 };
  const extras = {
    resistor: [{ resistance: 220 }, { resistance: 4700 }, { resistance: 2200000 }],
    potentiometer: [{ wiper: 0 }, { wiper: 50, maxResistance: 10000 }, { wiper: 100, maxResistance: 500 }],
    capacitor: [{ capacitance: 0.001 }, { capacitance: 47 }, { capacitance: 4700 }],
    inductor: [{ inductance: 0.5 }, { inductance: 22 }, { inductance: 3000 }],
    switch: [{ closed: true }, { closed: false }],
    switch_spdt: [{ position: "a" }, { position: "b" }],
    battery: [{ voltage: 1.5 }, { voltage: 9 }],
    power_supply: [{ outputVoltage: 3.3 }, { outputVoltage: 12 }],
    led: [{ color: "red" }, { color: "blue" }, { color: "white" }, { color: "nonsense" }],
    transistor: [{ polarity: "npn" }, { polarity: "pnp" }],
  }[type] || [{}];
  const out = [];
  for (const e of extras) for (const rotation of [0, 90, 180, 270]) for (const mirror of [false, true]) out.push({ ...base, ...e, rotation, mirror });
  return out;
};

let compared = 0;
let differ = null;
let hostile = 0;
for (const type of types) {
  for (const comp of variants(type)) {
    const a = window.getSimComponentDefinition(comp);
    const b = W.getSimulationComponentDefinition(comp);
    compared++;
    if (!a || !b || a.render(comp) !== b.render(comp) || JSON.stringify(a.pins) !== JSON.stringify(b.pins)) { differ = differ || `${type} ${JSON.stringify(comp)}`; }
    const svg = b.render(comp);
    if (!svg.includes("sim-art-real") || !svg.includes("sim-art-schem") || /<script/i.test(svg)) differ = differ || `shape ${type}`;
  }
  // hostile stored values never break the markup
  for (const bad of [{ resistance: "<script>x" }, { capacitance: "<b>", inductance: {}, wiper: "NaN", voltage: "9<", outputVoltage: -1 }]) {
    const comp = { id: "p", type, x: 0, y: 0, ...bad };
    const svg = W.getSimulationComponentDefinition(comp).render(comp);
    if (/<script|<b>/i.test(svg)) hostile++;
  }
}
ok(!differ, `client and worker draw ${compared} part variants (every type, setting, rotation and mirror) identically`, differ);
ok(hostile === 0, "hostile stored values never reach the markup");
// the symbol alone is stable
const led = window.SimSchematic.symbols.led({ color: "red" }, { ledOnColor: "#ff0000" });
ok(/--led-on-color:#ff0000/.test(led) && /sch-led-body/.test(led), "the LED symbol carries its glow colour");
console.log(fail ? "FAILURES " + fail : "ALL PASS");
