// Component library for the simulation builder/renderer. This models real
// breadboard topology (separate power rails vs. individually-wired terminal
// columns split by the center gutter — not one big shared bus) and real
// electrical math (Ohm's law: resistance, forward voltage, current) on top
// of the topology layer: a part only lights up if it's on a genuinely
// closed loop back to a power source, AND the computed current through it
// is enough to actually light it, AND not so much that it would burn out.
// It's still a simplified model — one series path per power domain via
// shortest-path, not a general SPICE-style solver — but it now catches
// real mistakes: too little resistance destroys an LED, no resistor at
// all is a dead short, and wiring straight to the wall outlet (120V,
// modeled as its own untransformed, dangerous domain) fries everything
// downstream regardless of what's in the way.
//
// Kept in sync by hand with public/admin/sim-components.js, which
// defines the identical registry (and the same <defs> gradients) for the
// admin builder — a plain script can't import this ES module, and vice
// versa.

function escXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Shared gradients/filters every component's shapes fill with, instead of
// flat colors, for a less cartoonish look. Referenced by fixed ids, so
// multiple simulation blocks on one page technically duplicate these <defs>
// — harmless since every copy is pixel-identical, just not strictly unique
// ids (not worth threading a per-instance prefix through every call site).
export const SIM_DEFS_SVG = `<defs>
  <linearGradient id="sim-grad-board" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#f2ecd9"/>
    <stop offset="100%" stop-color="#d6cca8"/>
  </linearGradient>
  <radialGradient id="sim-grad-hole" cx="35%" cy="35%" r="75%">
    <stop offset="0%" stop-color="#5a5442"/>
    <stop offset="100%" stop-color="#161409"/>
  </radialGradient>
  <linearGradient id="sim-grad-metal" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="#f0f0f0"/>
    <stop offset="50%" stop-color="#a8a8a8"/>
    <stop offset="100%" stop-color="#f0f0f0"/>
  </linearGradient>
  <radialGradient id="sim-grad-led-off" cx="35%" cy="28%" r="80%">
    <stop offset="0%" stop-color="#8a8a8a"/>
    <stop offset="100%" stop-color="#333"/>
  </radialGradient>
  <radialGradient id="sim-grad-led-on" cx="35%" cy="28%" r="80%">
    <stop offset="0%" stop-color="#fffbe0"/>
    <stop offset="45%" stop-color="#ffe066"/>
    <stop offset="100%" stop-color="#d98c0f"/>
  </radialGradient>
  <linearGradient id="sim-grad-resistor" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#ecd9ab"/>
    <stop offset="50%" stop-color="#d4b878"/>
    <stop offset="100%" stop-color="#a98a4e"/>
  </linearGradient>
  <linearGradient id="sim-grad-battery" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#666"/>
    <stop offset="55%" stop-color="#3a3a3a"/>
    <stop offset="100%" stop-color="#1c1c1c"/>
  </linearGradient>
  <linearGradient id="sim-grad-pcb" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#2a6b45"/>
    <stop offset="100%" stop-color="#0f3320"/>
  </linearGradient>
  <linearGradient id="sim-grad-tv-bezel" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#3a3a3a"/>
    <stop offset="100%" stop-color="#0a0a0a"/>
  </linearGradient>
  <radialGradient id="sim-grad-screen-on" cx="50%" cy="35%" r="85%">
    <stop offset="0%" stop-color="#cdeeff"/>
    <stop offset="100%" stop-color="#3a7ab8"/>
  </radialGradient>
  <linearGradient id="sim-grad-plastic" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#f2f2ec"/>
    <stop offset="100%" stop-color="#cfcfc2"/>
  </linearGradient>
  <filter id="sim-glow" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="3" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>`;

// ---------- Real-world electrical reference data ----------
export const LED_COLORS = {
  red: { label: "Red", forwardVoltage: 2.0, onColor: "#ff4d3d" },
  yellow: { label: "Yellow", forwardVoltage: 2.1, onColor: "#ffe14d" },
  green: { label: "Green", forwardVoltage: 2.2, onColor: "#4dff6a" },
  blue: { label: "Blue", forwardVoltage: 3.2, onColor: "#4d9dff" },
  white: { label: "White", forwardVoltage: 3.0, onColor: "#fffbe8" },
};
export const LED_RATED_MA = 20; // typical 5mm LED
export const DIODE_FORWARD_V = 0.7; // silicon
export const DIODE_RATED_MA = 1000; // a 1N400x-style 1 A part
export const OUTLET_VOLTAGE = 120; // US household mains, AC
export const RESISTOR_WATTAGE_RATING = 0.25; // typical through-hole resistor
export const TEENSY_LOAD_OHMS = 300; // stand-in for a running board's own draw
// A typical microcontroller board's own power budget (running off 3.3V/
// 5V, drawing well under a watt) -- feeding it from something like a
// 12V+ supply through its fixed load model should read as unsafe, the
// same way an overheating resistor does, not just a bigger harmless
// number.
export const TEENSY_WATTAGE_RATING = 1;

const DIGIT_COLORS = ["black", "brown", "red", "orange", "yellow", "green", "blue", "violet", "gray", "white"];
const BAND_HEX = {
  black: "#1a1a1a",
  brown: "#6b4423",
  red: "#d32f2f",
  orange: "#f57c00",
  yellow: "#fbc02d",
  green: "#388e3c",
  blue: "#1976d2",
  violet: "#7b1fa2",
  gray: "#9e9e9e",
  white: "#f5f5f5",
  gold: "#d4af37",
};

// Standard 4-band resistor color code (2 significant digits + multiplier +
// gold tolerance), computed from whatever resistance value the admin sets
// — so the part actually reads correctly, the way a real one would.
export function resistorBandHexes(ohms) {
  ohms = Math.max(1, Math.round(Number(ohms) || 220));
  let mult = Math.max(0, Math.floor(Math.log10(ohms)) - 1);
  let sig = Math.round(ohms / Math.pow(10, mult));
  if (sig >= 100) {
    sig = Math.round(sig / 10);
    mult++;
  }
  const d1 = Math.floor(sig / 10);
  const d2 = sig % 10;
  return [BAND_HEX[DIGIT_COLORS[d1]], BAND_HEX[DIGIT_COLORS[d2]], BAND_HEX[DIGIT_COLORS[mult] || "black"], BAND_HEX.gold];
}

export const BREADBOARD_COLUMN_OPTIONS = Object.freeze([15, 30, 45]);

export function resolveBreadboardColumns(value) {
  const columns = Number(value);
  return BREADBOARD_COLUMN_OPTIONS.includes(columns) ? columns : 30;
}

function createBreadboardPins(cols) {
  return Array.from({ length: cols }, (_, i) => i).flatMap((i) => [
    { id: `rpt${i + 1}`, x: 20 + i * 40, y: 14 },
    { id: `rnt${i + 1}`, x: 20 + i * 40, y: 26 },
    { id: `t${i + 1}`, x: 20 + i * 40, y: 60 },
    { id: `b${i + 1}`, x: 20 + i * 40, y: 90 },
    { id: `rnb${i + 1}`, x: 20 + i * 40, y: 124 },
    { id: `rpb${i + 1}`, x: 20 + i * 40, y: 136 },
  ]);
}

function createBreadboardRailGroups(cols) {
  return {
    pos_top: Array.from({ length: cols }, (_, i) => `rpt${i + 1}`),
    neg_top: Array.from({ length: cols }, (_, i) => `rnt${i + 1}`),
    neg_bottom: Array.from({ length: cols }, (_, i) => `rnb${i + 1}`),
    pos_bottom: Array.from({ length: cols }, (_, i) => `rpb${i + 1}`),
  };
}

function renderBreadboardSvg(cols) {
  const width = cols * 40;
  let holes = "";
  for (let i = 0; i < cols; i++) {
    const x = 20 + i * 40;
    holes += `<circle class="bb-hole bb-hole-rail" cx="${x}" cy="14" r="2.5"/>`;
    holes += `<circle class="bb-hole bb-hole-rail" cx="${x}" cy="26" r="2.5"/>`;
    holes += `<circle class="bb-hole" cx="${x}" cy="60" r="3"/>`;
    holes += `<circle class="bb-hole" cx="${x}" cy="90" r="3"/>`;
    holes += `<circle class="bb-hole bb-hole-rail" cx="${x}" cy="124" r="2.5"/>`;
    holes += `<circle class="bb-hole bb-hole-rail" cx="${x}" cy="136" r="2.5"/>`;
  }
  return `<rect class="bb-body" x="0" y="0" width="${width}" height="150" rx="6"/><rect class="bb-sheen" x="3" y="3" width="${width - 6}" height="16" rx="4"/><rect class="bb-rail-line bb-rail-pos" x="10" y="12.5" width="${width - 20}" height="3" rx="1.5"/><rect class="bb-rail-line bb-rail-neg" x="10" y="24.5" width="${width - 20}" height="3" rx="1.5"/><text class="bb-rail-label bb-rail-label-pos" x="4" y="17">+</text><text class="bb-rail-label bb-rail-label-neg" x="4" y="29">-</text><rect class="bb-channel" x="4" y="68" width="${width - 8}" height="14" rx="3"/><rect class="bb-rail-line bb-rail-neg" x="10" y="122.5" width="${width - 20}" height="3" rx="1.5"/><rect class="bb-rail-line bb-rail-pos" x="10" y="134.5" width="${width - 20}" height="3" rx="1.5"/><text class="bb-rail-label bb-rail-label-neg" x="4" y="127">-</text><text class="bb-rail-label bb-rail-label-pos" x="4" y="139">+</text>${holes}`;
}

// Basic parameters for the two passive parts that don't change the DC
// analysis on their own: a capacitor is an open circuit once charged, and
// an inductor is a wire with only its winding resistance. Hand-mirrored
// between public/admin/sim-components.js and worker/simulation-render.js.
const trimNumber = (n) => String(Math.round(n * 100) / 100);
export function capacitanceMicrofarads(c) {
  const value = Number(c && c.capacitance);
  return Number.isFinite(value) && value > 0 ? Math.max(1e-6, Math.min(value, 1e9)) : 100;
}
export function inductanceMillihenries(c) {
  const value = Number(c && c.inductance);
  return Number.isFinite(value) && value > 0 ? Math.max(1e-6, Math.min(value, 1e9)) : 10;
}
export function inductorWindingOhms(c) {
  const value = Number(c && c.dcResistance);
  return Number.isFinite(value) && value > 0 ? Math.max(0.01, Math.min(value, 1e9)) : 1;
}
// Picks the largest unit whose value still rounds to at least 1, so 999.999µF
// reads 1mF rather than 1000µF.
function formatScaled(base, units) {
  for (let i = units.length - 1; i > 0; i--) {
    const value = base / units[i][1];
    if (Math.round(value * 100) / 100 >= 1) return `${trimNumber(value)}${units[i][0]}`;
  }
  return `${trimNumber(base / units[0][1])}${units[0][0]}`;
}
const CAPACITANCE_UNITS = [["pF", 1], ["nF", 1e3], ["µF", 1e6], ["mF", 1e9], ["F", 1e12]];
const INDUCTANCE_UNITS = [["nH", 1], ["µH", 1e3], ["mH", 1e6], ["H", 1e9]];
export function formatCapacitance(uF) {
  return formatScaled(uF * 1e6, CAPACITANCE_UNITS);
}
export function formatInductance(mH) {
  return formatScaled(mH * 1e6, INDUCTANCE_UNITS);
}
// Beside the body at quarter turns, where the upright text would otherwise
// sit on it. Inline style because the stylesheet's own text-anchor rule
// outranks the presentation attribute.
function partLabelSvg(className, text, c, x, upturnedY, turnedY) {
  const anchor = c && c.rotation === 90 ? "end" : c && c.rotation === 270 ? "start" : "middle";
  const y = anchor === "middle" ? upturnedY : turnedY;
  return `<text class="${className}" x="${x}" y="${y}" text-anchor="${anchor}" style="text-anchor:${anchor}" font-size="8">${escXml(text)}</text>`;
}

// ----- Logic gates: static diagram parts (no signal simulation) -----
// A gate is drawn with its standard symbol and carries a truth table for the
// diagram. `gate` picks the symbol and its standard table; an optional `truth`
// array (0/1 outputs in input order 00, 01, 10, 11, or 0, 1 for one-input
// gates) overrides the standard table. Hand-mirrored between
// public/admin/sim-components.js and worker/simulation-render.js.
export const LOGIC_GATES = {
  and: { label: "AND", inputs: 2, out: (a, b) => a & b },
  or: { label: "OR", inputs: 2, out: (a, b) => a | b },
  nand: { label: "NAND", inputs: 2, out: (a, b) => 1 - (a & b) },
  nor: { label: "NOR", inputs: 2, out: (a, b) => 1 - (a | b) },
  xor: { label: "XOR", inputs: 2, out: (a, b) => a ^ b },
  xnor: { label: "XNOR", inputs: 2, out: (a, b) => 1 - (a ^ b) },
  not: { label: "NOT", inputs: 1, out: (a) => 1 - a },
  buffer: { label: "Buffer", inputs: 1, out: (a) => a },
};
export function isLogicGateName(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LOGIC_GATES, value);
}
export function resolveLogicGate(comp) {
  return comp && isLogicGateName(comp.gate) ? comp.gate : "and";
}
// Input combinations in truth-table order (A, or A then B).
export function logicGateRows(gate) {
  return LOGIC_GATES[gate].inputs === 2 ? [[0, 0], [0, 1], [1, 0], [1, 1]] : [[0], [1]];
}
export function standardLogicTruth(gate) {
  const { out } = LOGIC_GATES[gate];
  return logicGateRows(gate).map((bits) => out(...bits));
}
export function isValidLogicTruth(gate, truth) {
  return Array.isArray(truth) && truth.length === (LOGIC_GATES[gate].inputs === 2 ? 4 : 2) && truth.every((v) => v === 0 || v === 1);
}
export function logicGateTruth(comp) {
  const gate = resolveLogicGate(comp);
  return comp && isValidLogicTruth(gate, comp.truth) ? comp.truth.slice() : standardLogicTruth(gate);
}
export function logicGateIsCustom(comp) {
  return JSON.stringify(logicGateTruth(comp)) !== JSON.stringify(standardLogicTruth(resolveLogicGate(comp)));
}
// One line for hover titles: "AND gate: inputs A,B -> out: 00->0, 01->0, ...".
export function logicGateSummary(comp) {
  const gate = resolveLogicGate(comp);
  const truth = logicGateTruth(comp);
  const rows = logicGateRows(gate).map((bits, i) => `${bits.join("")}\u2192${truth[i]}`).join(", ");
  const inputs = LOGIC_GATES[gate].inputs === 2 ? "A,B" : "A";
  return `${LOGIC_GATES[gate].label} gate${logicGateIsCustom(comp) ? " (custom)" : ""}: inputs ${inputs} \u2192 out: ${rows}`;
}
// The hover title: the part's label (unless it only repeats the gate's own
// name) followed by the summary.
export function logicGateTitle(comp) {
  const gateName = LOGIC_GATES[resolveLogicGate(comp)].label.toLowerCase();
  const label = typeof comp.label === "string" ? comp.label.trim() : "";
  const repeatsGate = [gateName, `${gateName} gate`, "logic gate"].includes(label.toLowerCase());
  return [repeatsGate ? "" : label, logicGateSummary(comp)].filter(Boolean).join(" \u2014 ");
}
function logicGatePins(gate) {
  const out = { id: "out", x: 70, y: 25 };
  return LOGIC_GATES[gate].inputs === 2
    ? [{ id: "a", x: 0, y: 15 }, { id: "b", x: 0, y: 35 }, out]
    : [{ id: "a", x: 0, y: 25 }, out];
}
// Symbol geometry: `tip` is where the body ends; an inverting gate hangs a
// bubble there and the output lead starts after it.
const LOGIC_GATE_SHAPES = {
  and: { body: "M14,8 H32 A17,17 0 0 1 32,42 H14 Z", tip: 49, inverted: false, inX: 14 },
  nand: { body: "M14,8 H32 A17,17 0 0 1 32,42 H14 Z", tip: 49, inverted: true, inX: 14 },
  or: { body: "M14,8 C24,8 40,10 52,25 C40,40 24,42 14,42 C20,34 20,16 14,8 Z", tip: 52, inverted: false, inX: 16 },
  nor: { body: "M14,8 C24,8 40,10 52,25 C40,40 24,42 14,42 C20,34 20,16 14,8 Z", tip: 52, inverted: true, inX: 16 },
  xor: { body: "M14,8 C24,8 40,10 52,25 C40,40 24,42 14,42 C20,34 20,16 14,8 Z", tip: 52, inverted: false, inX: 12, extra: "M8,8 C14,16 14,34 8,42" },
  xnor: { body: "M14,8 C24,8 40,10 52,25 C40,40 24,42 14,42 C20,34 20,16 14,8 Z", tip: 52, inverted: true, inX: 12, extra: "M8,8 C14,16 14,34 8,42" },
  not: { body: "M16,9 L16,41 L46,25 Z", tip: 46, inverted: true, inX: 16 },
  buffer: { body: "M16,9 L16,41 L46,25 Z", tip: 46, inverted: false, inX: 16 },
};
function renderLogicGateSvg(gate, comp) {
  const shape = LOGIC_GATE_SHAPES[gate];
  const pins = logicGatePins(gate);
  const outX = shape.inverted ? shape.tip + 7 : shape.tip;
  const leads = pins
    .filter((pin) => pin.id !== "out")
    .map((pin) => `<line class="gate-lead" x1="0" y1="${pin.y}" x2="${shape.inX}" y2="${pin.y}"/>`)
    .join("");
  const bubble = shape.inverted ? `<circle class="gate-bubble" cx="${shape.tip + 3.5}" cy="25" r="3.5"/>` : "";
  const extra = shape.extra ? `<path class="gate-extra" d="${shape.extra}"/>` : "";
  // A custom truth table dashes the outline (a text caption would collide with
  // the body at quarter turns).
  const bodyClass = logicGateIsCustom(comp) ? "gate-body gate-body-custom" : "gate-body";
  return `<rect class="gate-hit" x="0" y="4" width="70" height="42" fill="transparent"/>${leads}<line class="gate-lead" x1="${outX}" y1="25" x2="70" y2="25"/>${extra}<path class="${bodyClass}" d="${shape.body}"/>${bubble}`;
}
function logicGateDefinition(base, comp) {
  const gate = resolveLogicGate(comp);
  return { ...base, gate, pins: logicGatePins(gate), render: (c) => renderLogicGateSvg(gate, c) };
}

export function validateLogicGates(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.components)) return null;
  for (let index = 0; index < data.components.length; index++) {
    const comp = data.components[index];
    if (!comp || typeof comp !== "object" || Array.isArray(comp) || comp.type !== "logic_gate") continue;
    const hasGate = Object.prototype.hasOwnProperty.call(comp, "gate");
    const hasTruth = Object.prototype.hasOwnProperty.call(comp, "truth");
    if ((hasGate && !isLogicGateName(comp.gate)) || (hasTruth && !isValidLogicTruth(resolveLogicGate(comp), comp.truth))) {
      return `Component ${index + 1} has an invalid logic gate. Gate must be one of ${Object.keys(LOGIC_GATES).join(", ")}, and a custom truth table must list 4 outputs (2-input gates) or 2 (NOT and buffer), each 0 or 1.`;
    }
  }
  return null;
}

// An SPDT switch's stored position must be exactly "a" or "b" (the renderers
// are lenient and treat anything else as "a", but stored data stays clean).
export function validateSwitchPositions(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.components)) return null;
  for (let index = 0; index < data.components.length; index++) {
    const comp = data.components[index];
    if (!comp || typeof comp !== "object" || Array.isArray(comp) || comp.type !== "switch_spdt") continue;
    if (Object.prototype.hasOwnProperty.call(comp, "position") && comp.position !== "a" && comp.position !== "b") {
      return `Component ${index + 1} has an invalid switch position. Position must be "a" or "b".`;
    }
  }
  return null;
}

export const SIM_COMPONENTS = {
  outlet: {
    label: "Wall Outlet",
    w: 40,
    h: 60,
    isSource: true,
    dangerous: true, // raw mains — never meant to wire directly to protoboard parts
    polarity: { pos: "hot", neg: "neutral" },
    pins: [
      { id: "hot", x: 14, y: 60 },
      { id: "neutral", x: 26, y: 60 },
    ],
    render: () =>
      `<rect class="outlet-body" x="0" y="0" width="40" height="60" rx="4"/><rect class="outlet-plate" x="3" y="3" width="34" height="54" rx="3"/><rect class="outlet-slot" x="10" y="16" width="4" height="14" rx="1"/><rect class="outlet-slot" x="26" y="16" width="4" height="14" rx="1"/><circle class="outlet-ground" cx="20" cy="42" r="3"/>`,
  },
  power_supply: {
    label: "Power Supply",
    w: 70,
    h: 40,
    // Passes AC in through to DC out topologically (the loop still has to
    // close somewhere downstream) — but electrically it's treated as its
    // own isolated, regulated source on the output side: the transformer
    // means the wall's 120V never reaches the DC side, and the current
    // math on each side is computed separately (see computeCircuitAnalysis).
    passthrough: [
      ["in_hot", "out_pos"],
      ["in_neutral", "out_neg"],
    ],
    pins: [
      { id: "in_hot", x: 0, y: 12 },
      { id: "in_neutral", x: 0, y: 28 },
      { id: "out_pos", x: 70, y: 12 },
      { id: "out_neg", x: 70, y: 28 },
    ],
    render: (c) =>
      `<rect class="ps-body" x="0" y="0" width="70" height="40" rx="4"/><rect class="ps-vent" x="24" y="8" width="24" height="3" rx="1"/><rect class="ps-vent" x="24" y="14" width="24" height="3" rx="1"/><rect class="ps-vent" x="24" y="20" width="24" height="3" rx="1"/><circle class="ps-indicator" cx="58" cy="32" r="3"/><text class="ps-label" x="35" y="38" text-anchor="middle" font-size="8">${escXml(
        c.outputVoltage || 5
      )}V DC</text>`,
  },
  // A real half+ breadboard with four independent rails and a terminal
  // strip split into separate columns by the center gutter. The default
  // stays at 30 columns for simulations saved before size was selectable.
  breadboard: {
    label: "Breadboard",
    w: 1200,
    h: 150,
    cols: 30,
    railGroups: createBreadboardRailGroups(30),
    pins: createBreadboardPins(30),
    render: (c) => renderBreadboardSvg(resolveBreadboardColumns(c && c.cols)),
  },
  led: {
    label: "LED",
    w: 40,
    h: 40,
    // Deliberately NOT passthrough — an LED only conducts anode-to-
    // cathode, so it needs the direction check, not just a connection.
    // Leads are exactly one breadboard hole-spacing apart (40px), splayed
    // outward from the bulb — so both legs plug into two real, adjacent
    // holes when dropped on the board, not just one anchored pin.
    polarity: { pos: "anode", neg: "cathode" },
    pins: [
      { id: "anode", x: 0, y: 40 },
      { id: "cathode", x: 40, y: 40 },
    ],
    render: (c) => {
      const color = LED_COLORS[c.color] && LED_COLORS[c.color].onColor ? c.color : "red";
      return `<g style="--led-on-color:${LED_COLORS[color].onColor}"><line class="led-lead" x1="15" y1="26" x2="0" y2="40"/><line class="led-lead" x1="25" y1="26" x2="40" y2="40"/><ellipse class="led-flange" cx="20" cy="26" rx="10" ry="2.5"/><path class="led-bulb" d="M11,26 L11,10 A9,9 0 0 1 29,10 L29,26 Z"/><path class="led-shine" d="M15,14 A5,5 0 0 1 21,10"/></g>`;
    },
  },
  // A plain silicon diode: conducts anode to cathode with a fixed 0.7 V drop and blocks the other way. It reuses the LED's
  // polarity and path handling (see buildAnalysisGraph); only its drawing, rating and wording differ.
  diode: {
    label: "Diode",
    w: 40,
    h: 40,
    polarity: { pos: "anode", neg: "cathode" },
    pins: [
      { id: "anode", x: 0, y: 40, label: "Anode" },
      { id: "cathode", x: 40, y: 40, label: "Cathode" },
    ],
    render: () =>
      `<rect class="diode-hit" x="0" y="14" width="40" height="26" fill="transparent"/><path class="diode-lead" d="M0,40 L0,26 L10,26" fill="none"/><path class="diode-lead" d="M28,26 L40,26 L40,40" fill="none"/><polygon class="diode-body" points="10,16 10,36 28,26"/><line class="diode-bar" x1="28" y1="15" x2="28" y2="37"/>`,
  },
  resistor: {
    label: "Resistor",
    w: 80,
    h: 16,
    passthrough: [["p1", "p2"]],
    // Leads are exactly two hole-spacings apart (80px), so plugging one
    // end into the board also seats the other leg on a real hole two
    // columns over — a genuine bridge, not a rigid part just riding along.
    pins: [
      { id: "p1", x: 0, y: 8 },
      { id: "p2", x: 80, y: 8 },
    ],
    render: (c) => {
      const [b1, b2, b3, b4] = resistorBandHexes(c.resistance);
      return `<line class="resistor-lead" x1="0" y1="8" x2="22" y2="8"/><rect class="resistor-body" x="22" y="0" width="36" height="16" rx="3"/><rect class="resistor-band" x="28" y="0" width="3" height="16" fill="${b1}"/><rect class="resistor-band" x="34" y="0" width="3" height="16" fill="${b2}"/><rect class="resistor-band" x="40" y="0" width="3" height="16" fill="${b3}"/><rect class="resistor-band" x="49" y="0" width="3" height="16" fill="${b4}"/><line class="resistor-lead" x1="58" y1="8" x2="80" y2="8"/>`;
    },
  },
  // A real switch matters: current only flows when it's closed. The admin
  // sets the default state when building the circuit (site visitors get a
  // static rendering, not a live toggle) — but it's still a genuine gate
  // in the topology, not just decoration.
  switch: {
    label: "Switch",
    w: 40,
    h: 20,
    passthrough: [["p1", "p2"]],
    pins: [
      { id: "p1", x: 0, y: 10 },
      { id: "p2", x: 40, y: 10 },
    ],
    render: (c) => {
      const closed = c.closed !== false;
      // A solid housing rect, not just thin lines — gives the switch a real
      // body to click/tap (thin strokes alone leave most of the bounding
      // box un-clickable) and reads as an actual switch package.
      return `<rect class="switch-body" x="4" y="1" width="32" height="18" rx="3"/><line class="switch-lead" x1="0" y1="10" x2="8" y2="10"/><circle class="switch-pivot" cx="8" cy="10" r="2.5"/><line class="switch-lever" x1="8" y1="10" x2="${
        closed ? 32 : 27
      }" y2="${closed ? 10 : 1}"/><circle class="switch-pivot" cx="32" cy="10" r="2.5"/><line class="switch-lead" x1="32" y1="10" x2="40" y2="10"/>`;
    },
  },
  // Single-pole double-throw (changeover) switch: the common terminal is
  // connected to exactly one of the two throws, chosen by `position`.
  switch_spdt: {
    label: "SPDT Switch",
    w: 40,
    h: 40,
    pins: [
      { id: "com", x: 0, y: 20, label: "Common" },
      { id: "a", x: 40, y: 10, label: "Throw A" },
      { id: "b", x: 40, y: 30, label: "Throw B" },
    ],
    render: (c) => {
      const ty = c.position === "b" ? 30 : 10;
      return `<rect class="switch-body" x="4" y="1" width="32" height="38" rx="3"/><line class="spdt-lead" x1="0" y1="20" x2="8" y2="20"/><line class="spdt-lead" x1="32" y1="10" x2="40" y2="10"/><line class="spdt-lead" x1="32" y1="30" x2="40" y2="30"/><circle class="switch-pivot" cx="8" cy="20" r="2.5"/><circle class="switch-pivot" cx="32" cy="10" r="2.5"/><circle class="switch-pivot" cx="32" cy="30" r="2.5"/><line class="switch-lever" x1="8" y1="20" x2="32" y2="${ty}"/>`;
    },
  },
  // A static logic-gate symbol (see the logic-gate block above): its pins
  // depend on the chosen gate, so getSimComponentDefinition swaps them in.
  logic_gate: {
    label: "Logic Gate",
    w: 70,
    h: 50,
    pins: logicGatePins("and"),
    render: (c) => renderLogicGateSvg("and", c),
  },
  // Two-terminal capacitor. In this DC model it charges up and then blocks
  // current, so it is deliberately not a passthrough and adds no edge to the
  // analysis: anything wired through it gets no power. Leads are one hole
  // spacing (40px) apart so it plugs into adjacent breadboard columns. The
  // transparent rect gives the thin part a full-size click target.
  capacitor: {
    label: "Capacitor",
    w: 40,
    h: 36,
    pins: [
      { id: "p1", x: 0, y: 12 },
      { id: "p2", x: 40, y: 12 },
    ],
    render: (c) =>
      `<rect class="capacitor-hit" x="4" y="0" width="32" height="24" fill="transparent"/><line class="capacitor-lead" x1="0" y1="12" x2="12" y2="12"/><rect class="capacitor-body" x="12" y="1" width="16" height="22" rx="3"/><line class="capacitor-plate" x1="17" y1="5" x2="17" y2="19"/><line class="capacitor-plate" x1="23" y1="5" x2="23" y2="19"/><line class="capacitor-lead" x1="28" y1="12" x2="40" y2="12"/>${partLabelSvg("capacitor-label", formatCapacitance(capacitanceMicrofarads(c)), c, 20, 33, 27.8)}`,
  },
  // Two-terminal inductor: at DC it passes current like a wire with only
  // its winding resistance (see inductorWindingOhms), so it is a passthrough
  // and the analysis treats it as a small resistor. Leads are two hole
  // spacings (80px) apart, like the resistor.
  inductor: {
    label: "Inductor",
    w: 80,
    h: 36,
    passthrough: [["p1", "p2"]],
    pins: [
      { id: "p1", x: 0, y: 12 },
      { id: "p2", x: 80, y: 12 },
    ],
    render: (c) =>
      `<rect class="inductor-hit" x="8" y="0" width="64" height="24" fill="transparent"/><line class="inductor-lead" x1="0" y1="12" x2="16" y2="12"/><rect class="inductor-body" x="16" y="2" width="48" height="20" rx="6"/><path class="inductor-coil" d="M16,12 a8,8 0 0 1 16,0 a8,8 0 0 1 16,0 a8,8 0 0 1 16,0"/><line class="inductor-lead" x1="64" y1="12" x2="80" y2="12"/>${partLabelSvg("inductor-label", formatInductance(inductanceMillihenries(c)), c, 40, 33, 26.8)}`,
  },
  // An idealized ammeter: zero resistance (doesn't disturb the circuit
  // it's measuring), placed IN SERIES like a switch/wire, reporting
  // whatever current already flows on the analyzed path through it. A
  // voltage meter (measured in PARALLEL) is the separate voltmeter part below.
  ammeter: {
    label: "Ammeter",
    w: 40,
    // Taller than the switch it otherwise mirrors (h:20) so the live
    // current reading (see renderComponentSvg in both this file and
    // public/admin/sim-components.js) has room within the part's own
    // declared bounding box instead of rendering below it -- pins stay
    // at their original y:10 (the lead-spacing math that matters for
    // breadboard snapping is horizontal, unaffected by this).
    h: 34,
    passthrough: [["p1", "p2"]],
    pins: [
      { id: "p1", x: 0, y: 10 },
      { id: "p2", x: 40, y: 10 },
    ],
    render: () =>
      `<line class="ammeter-lead" x1="0" y1="10" x2="11" y2="10"/><circle class="ammeter-body" cx="20" cy="10" r="9"/><text class="ammeter-label" x="20" y="13" text-anchor="middle" font-size="9">A</text><line class="ammeter-lead" x1="29" y1="10" x2="40" y2="10"/>`,
  },
  // An idealized voltmeter: infinite resistance (no analysis edge, so it never
  // disturbs the circuit), reading the potential difference between its two
  // probes; see collectNodePotentials for which points it can read.
  voltmeter: {
    label: "Voltmeter",
    w: 40,
    h: 34,
    pins: [
      { id: "pos", x: 0, y: 10, label: "Positive probe" },
      { id: "neg", x: 40, y: 10, label: "Negative probe" },
    ],
    render: () =>
      `<rect class="voltmeter-hit" x="0" y="0" width="40" height="24" fill="transparent"/><line class="voltmeter-lead" x1="0" y1="10" x2="11" y2="10"/><circle class="voltmeter-body" cx="20" cy="10" r="9"/><text class="voltmeter-label" x="20" y="13" text-anchor="middle" font-size="9">V</text><text class="voltmeter-sign" x="5" y="22" text-anchor="middle" font-size="8">+</text><text class="voltmeter-sign voltmeter-sign-neg" x="35" y="22" text-anchor="middle" font-size="8">\u2212</text><line class="voltmeter-lead" x1="29" y1="10" x2="40" y2="10"/>`,
  },
  // An idealized ohmmeter: it measures the resistance between its two probes through the unpowered network (resistors,
  // potentiometers, inductor windings, wires, closed switches), reads OL when there is no path, and refuses a circuit that
  // has a source wired into it. It is not a series part and adds no analysis edge; see ohmmeterReadings.
  ohmmeter: {
    label: "Ohmmeter",
    w: 40,
    h: 34,
    pins: [
      { id: "p1", x: 0, y: 10, label: "Probe A" },
      { id: "p2", x: 40, y: 10, label: "Probe B" },
    ],
    render: () =>
      `<rect class="ohmmeter-hit" x="0" y="0" width="40" height="24" fill="transparent"/><line class="ohmmeter-lead" x1="0" y1="10" x2="11" y2="10"/><circle class="ohmmeter-body" cx="20" cy="10" r="9"/><text class="ohmmeter-label" x="20" y="13.5" text-anchor="middle" font-size="10">\u03A9</text><line class="ohmmeter-lead" x1="29" y1="10" x2="40" y2="10"/>`,
  },
  // A two-terminal variable resistor -- no separate wiper-tap pin, so no
  // voltage-divider behavior (that needs a real multi-branch solver, out
  // of scope here). The wiper % just scales the resistance between p1/p2
  // the same way turning the knob would change the resistive path length
  // on a real pot used in this two-terminal "rheostat" configuration.
  potentiometer: {
    label: "Potentiometer",
    w: 80,
    h: 32,
    passthrough: [["p1", "p2"]],
    pins: [
      { id: "p1", x: 0, y: 16 },
      { id: "p2", x: 80, y: 16 },
    ],
    render: (c) => {
      const maxR = Math.max(1, Number(c.maxResistance) || 10000);
      // `Number(x) ?? 50` was dead-fallback code -- Number() never returns
      // null/undefined, only a number or NaN, and `NaN ?? 50` is still NaN
      // (NaN is not nullish). A missing/non-numeric wiper (an imported or
      // hand-edited simulation) silently produced "NaNΩ" on the public
      // embed's label and fed NaN resistance into the electrical analysis.
      // Number.isFinite() is the check that actually catches NaN and falls
      // back correctly, while still preserving an explicit 0 (unlike
      // `|| 50`, which would treat 0 as falsy too).
      const rawWiper = Number(c.wiper);
      const wiperPct = Math.max(0, Math.min(100, Number.isFinite(rawWiper) ? rawWiper : 50));
      const ohms = Math.max(1, Math.round(maxR * (wiperPct / 100)));
      const wiperX = 10 + 60 * (wiperPct / 100);
      return `<line class="resistor-lead" x1="0" y1="16" x2="10" y2="16"/><rect class="resistor-body" x="10" y="10" width="60" height="12" rx="3"/><line class="resistor-lead" x1="70" y1="16" x2="80" y2="16"/><line class="pot-wiper" x1="${wiperX}" y1="0" x2="${wiperX}" y2="10"/><polygon class="pot-wiper-arrow" points="${
        wiperX - 3
      },0 ${wiperX + 3},0 ${wiperX},6"/><text class="pot-label" x="40" y="30" text-anchor="middle" font-size="8">${escXml(ohms)}Ω</text>`;
    },
  },
  battery: {
    label: "Battery",
    w: 50,
    h: 26,
    isSource: true,
    polarity: { pos: "pos", neg: "neg" },
    pins: [
      { id: "pos", x: 0, y: 13 },
      { id: "neg", x: 50, y: 13 },
    ],
    render: (c) =>
      `<rect class="battery-body" x="0" y="0" width="50" height="26" rx="4"/><rect class="battery-cap" x="0" y="9" width="5" height="8"/><rect class="battery-cap" x="45" y="9" width="5" height="8"/><text class="battery-label" x="25" y="17" text-anchor="middle">${escXml(
        c.voltage || 9
      )}V</text>`,
  },
  mcu_teensy: {
    label: "Microcontroller (Teensy)",
    w: 90,
    h: 36,
    // A real board draws current between VIN and GND (running the chip),
    // so — unlike an LED — it isn't direction-sensitive; treat it as a
    // passthrough load. Its digital pins are separate, ordinary signal
    // pins with no special power role.
    passthrough: [["vin", "gnd"]],
    pins: [
      { id: "vin", x: 8, y: 0 },
      { id: "gnd", x: 82, y: 0 },
      ...Array.from({ length: 8 }).map((_, i) => ({ id: `d${i}`, x: 6 + i * 11, y: 36 })),
    ],
    render: (c) => {
      let pinsSvg = "";
      for (let i = 0; i < 8; i++) pinsSvg += `<rect class="mcu-pin" x="${5 + i * 11}" y="30" width="2" height="6"/>`;
      return `<rect class="mcu-body" x="0" y="0" width="90" height="36" rx="4"/><circle class="mcu-power-pin" cx="8" cy="4" r="2.5"/><circle class="mcu-gnd-pin" cx="82" cy="4" r="2.5"/><rect class="mcu-chip" x="28" y="8" width="34" height="16" rx="2"/>${pinsSvg}<text class="mcu-label" x="45" y="30" text-anchor="middle" font-size="7">${escXml(
        c.label || "Teensy"
      )}</text>`;
    },
  },
  tv: {
    label: "TV / Display",
    w: 130,
    h: 84,
    pins: [{ id: "hdmi", x: 0, y: 42 }],
    render: () =>
      `<rect class="tv-body" x="0" y="0" width="130" height="84" rx="6"/><rect class="tv-screen" x="6" y="6" width="118" height="72" rx="2"/><rect class="tv-glare" x="10" y="10" width="40" height="10" rx="2"/><circle class="tv-led" cx="65" cy="80" r="1.5"/>`,
  },
};

// Orientation (rotate in 90-degree steps and/or mirror horizontally) is
// applied to a part's *definition*, mirroring public/admin/sim-components.js
// exactly: pins move, width/height swap, and the drawing is wrapped in a
// matching SVG transform. Mirrored first, then rotated clockwise.
export const SIM_ORIENTATION_ROTATIONS = Object.freeze([0, 90, 180, 270]);

function componentOrientation(comp) {
  const rotation = comp && typeof comp.rotation === "number" ? comp.rotation : 0;
  return {
    rotation: SIM_ORIENTATION_ROTATIONS.includes(rotation) ? rotation : 0,
    mirror: Boolean(comp) && comp.mirror === true,
  };
}

function orientPoint(x, y, w, h, rotation, mirror) {
  const mx = mirror ? w - x : x;
  if (rotation === 90) return { x: h - y, y: mx };
  if (rotation === 180) return { x: w - mx, y: h - y };
  if (rotation === 270) return { x: y, y: w - mx };
  return { x: mx, y };
}

// Labels printed on a part would turn upside-down or backwards with the
// drawing, so each <text> gets the inverse transform about its visual centre
// (a third of the font size above the baseline) to stay where the un-rotated
// drawing put it.
function keepTextUpright(svg, rotation, mirror) {
  return svg.replace(/<text\b([^>]*)>/g, (match, attrs) => {
    const num = (name, fallback) => {
      const m = new RegExp(`\\s${name}="(-?[0-9.]+)"`).exec(attrs);
      return m ? Number(m[1]) : fallback;
    };
    const x = num("x", 0);
    const y = num("y", 0) - num("font-size", 10) * 0.35;
    const parts = [`translate(${x} ${y})`];
    if (mirror) parts.push("scale(-1 1)");
    if (rotation) parts.push(`rotate(${-rotation})`);
    parts.push(`translate(${-x} ${-y})`);
    return `<text${attrs} transform="${parts.join(" ")}">`;
  });
}

// `overlay` wraps extra live drawing (the ammeter's reading) in the same
// orientation transform as the part, so it turns with the body.
export function orientSimulationDefinition(def, comp) {
  const { rotation, mirror } = componentOrientation(comp);
  if (!rotation && !mirror) return def;
  const w = def.w;
  const h = def.h;
  const swap = rotation === 90 || rotation === 270;
  const outer =
    rotation === 90 ? `translate(${h} 0) rotate(90)` :
    rotation === 180 ? `translate(${w} ${h}) rotate(180)` :
    rotation === 270 ? `translate(0 ${w}) rotate(270)` : "";
  const inner = mirror ? `translate(${w} 0) scale(-1 1)` : "";
  const transform = [outer, inner].filter(Boolean).join(" ");
  const wrap = (svg) => `<g class="sim-oriented" transform="${transform}">${keepTextUpright(svg, rotation, mirror)}</g>`;
  return {
    ...def,
    w: swap ? h : w,
    h: swap ? w : h,
    rotation,
    mirror,
    pins: def.pins.map((pin) => ({ ...pin, ...orientPoint(pin.x, pin.y, w, h, rotation, mirror) })),
    render: (c) => wrap(def.render(c)),
    overlay: wrap,
  };
}

// The ammeter prints its live reading below the body (or above it at 180
// degrees, via the oriented overlay). A quarter turn leaves no room there, so
// the reading is anchored beside the body instead, on the side away from it.
// Inline style because the stylesheet's own text-anchor rule outranks the
// presentation attribute. Mirrors public/admin/sim-components.js.
function meterReadingSvg(className, text, rotation) {
  const placement =
    rotation === 90 ? { y: 22.8, anchor: "end" } :
    rotation === 270 ? { y: 23.8, anchor: "start" } :
    { y: 32, anchor: "middle" };
  return `<text class="${className}" x="20" y="${placement.y}" text-anchor="${placement.anchor}" style="text-anchor:${placement.anchor}" font-size="8">${text}</text>`;
}
function ammeterReadingSvg(text, rotation) {
  return meterReadingSvg("ammeter-reading", text, rotation);
}
function voltmeterReadingSvg(text, rotation) {
  return meterReadingSvg("voltmeter-reading", text, rotation);
}
function ohmmeterReadingSvg(text, rotation) {
  return meterReadingSvg("ohmmeter-reading", text, rotation);
}
// "4.60V", "-3.10V", or a dash when the probes can't be read.
export function formatVolts(volts) {
  if (typeof volts !== "number" || !Number.isFinite(volts)) return "\u2014";
  const rounded = Math.abs(volts) < 0.005 ? 0 : volts;
  return Math.abs(rounded) >= 10000 ? `${rounded.toExponential(1).replace("e+", "e")}V` : `${rounded.toFixed(2)}V`;
}

// Breadboards keep their fixed layout (rails, holes and snapping all assume
// the horizontal board), so an orientation on one is invalid rather than
// silently ignored.
export function validateComponentOrientations(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.components)) return null;
  for (let index = 0; index < data.components.length; index++) {
    const comp = data.components[index];
    if (!comp || typeof comp !== "object" || Array.isArray(comp)) continue;
    const hasRotation = Object.prototype.hasOwnProperty.call(comp, "rotation");
    const hasMirror = Object.prototype.hasOwnProperty.call(comp, "mirror");
    if (!hasRotation && !hasMirror) continue;
    if (
      (hasRotation && !SIM_ORIENTATION_ROTATIONS.includes(comp.rotation)) ||
      (hasMirror && typeof comp.mirror !== "boolean") ||
      (comp.type === "breadboard" && ((hasRotation && comp.rotation !== 0) || comp.mirror === true))
    ) {
      return `Component ${index + 1} has an invalid orientation. Rotation must be 0, 90, 180, or 270, mirror must be true or false, and breadboards cannot be rotated or mirrored.`;
    }
  }
  return null;
}

export function getSimulationComponentDefinition(comp) {
  if (!comp || typeof comp !== "object" || Array.isArray(comp) || typeof comp.type !== "string" || !Object.hasOwn(SIM_COMPONENTS, comp.type)) return null;
  const def = SIM_COMPONENTS[comp.type];
  if (comp.type === "logic_gate") return orientSimulationDefinition(logicGateDefinition(def, comp), comp);
  if (comp.type !== "breadboard") return orientSimulationDefinition(def, comp);
  const cols = resolveBreadboardColumns(comp.cols);
  return {
    ...def,
    cols,
    w: cols * 40,
    pins: createBreadboardPins(cols),
    railGroups: createBreadboardRailGroups(cols),
    render: () => renderBreadboardSvg(cols),
  };
}

export function validateBreadboardColumnSizes(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.components)) return null;
  for (const comp of data.components) {
    if (
      !comp ||
      typeof comp !== "object" ||
      Array.isArray(comp) ||
      comp.type !== "breadboard" ||
      !Object.prototype.hasOwnProperty.call(comp, "cols")
    ) continue;
    if (!BREADBOARD_COLUMN_OPTIONS.includes(Number(comp.cols))) {
      return "Breadboard size must be 15, 30, or 45 columns.";
    }
  }
  return null;
}

export function getSimulationCanvasBounds(components = []) {
  let width = 1500;
  let height = 700;
  for (const component of Array.isArray(components) ? components : []) {
    const definition = getSimulationComponentDefinition(component);
    if (!definition || !Number.isFinite(component.x) || !Number.isFinite(component.y)) continue;
    width = Math.max(width, component.x + definition.w + 20);
    height = Math.max(height, component.y + definition.h + 20);
  }
  return { width, height };
}

function nodeId(comp, pinId) {
  const def = getSimulationComponentDefinition(comp);
  if (def && def.railGroups) {
    for (const rail of Object.keys(def.railGroups)) {
      if (def.railGroups[rail].includes(pinId)) return `${comp.id}:rail:${rail}`;
    }
  }
  return `${comp.id}:${pinId}`;
}

function isSwitchClosed(c) {
  return c.closed !== false;
}
// Which throw of an SPDT switch the common terminal is connected to.
function spdtThrow(c) {
  return c.position === "b" ? "b" : "a";
}

// ---------- Topology: build an undirected graph and answer "is there an
// actual closed loop back to a source" — not just "is it reachable." ----------
// A correctly-wired LED does conduct, so its anode-cathode edge is
// included like any other device when just checking "does the loop
// close." Direction/orientation is a separate question (see
// computePoweredSet), answered by excluding one specific LED's own edge
// and checking whether the loop still reaches both its legs from the
// correct sides — excludeLedId is which LED's edge to leave out for that.
function buildGraph(data, excludeLedId) {
  const components = (data && data.components) || [];
  const wires = (data && data.wires) || [];
  const adjacency = new Map();
  const link = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  };
  components.forEach((c) => {
    const def = getSimulationComponentDefinition(c);
    if (!def) return;
    def.pins.forEach((p) => {
      const n = nodeId(c, p.id);
      if (!adjacency.has(n)) adjacency.set(n, new Set());
    });
    if (def.passthrough && (c.type !== "switch" || isSwitchClosed(c))) {
      def.passthrough.forEach(([a, b]) => link(nodeId(c, a), nodeId(c, b)));
    }
    if (c.type === "switch_spdt") link(nodeId(c, "com"), nodeId(c, spdtThrow(c)));
    if ((c.type === "led" || c.type === "diode") && def.polarity && c.id !== excludeLedId) {
      link(nodeId(c, def.polarity.pos), nodeId(c, def.polarity.neg));
    }
  });
  wires.forEach((w) => {
    if (
      !w ||
      typeof w !== "object" ||
      Array.isArray(w) ||
      !w.from ||
      typeof w.from !== "object" ||
      !w.to ||
      typeof w.to !== "object"
    ) return;
    const fromComp = components.find((c) => c.id === w.from.compId);
    const toComp = components.find((c) => c.id === w.to.compId);
    if (!fromComp || !toComp) return;
    link(nodeId(fromComp, w.from.pin), nodeId(toComp, w.to.pin));
  });
  return adjacency;
}

function bfsReach(adjacency, start, avoid) {
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    const neighbors = adjacency.get(cur);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (n === avoid || visited.has(n)) continue;
      visited.add(n);
      queue.push(n);
    }
  }
  return visited;
}

function connected(adjacency, a, b) {
  return bfsReach(adjacency, a).has(b);
}

// Everything on a genuinely closed loop back to an outlet or battery is
// "powered" — a component with a dangling, unreturned wire to power is
// not, and an LED wired backwards on an otherwise-complete loop is not.
export function computePoweredSet(data) {
  const components = (data && data.components) || [];
  const wires = (data && data.wires) || [];
  // The main graph treats every correctly-conducting device (including a
  // wired-in LED) as an edge, so a simple series loop actually closes.
  const adjacency = buildGraph(data, null);

  const activeSources = [];
  const poweredNodes = new Set();
  components.forEach((c) => {
    const def = getSimulationComponentDefinition(c);
    if (!def || !def.isSource || !def.polarity) return;
    const posNode = nodeId(c, def.polarity.pos);
    const negNode = nodeId(c, def.polarity.neg);
    if (connected(adjacency, posNode, negNode)) {
      activeSources.push({ posNode, negNode });
      bfsReach(adjacency, posNode).forEach((n) => poweredNodes.add(n));
    }
  });

  const poweredComps = new Set();
  components.forEach((c) => {
    const def = getSimulationComponentDefinition(c);
    if (!def) return;
    if ((c.type === "led" || c.type === "diode") && def.polarity) {
      const posNode = nodeId(c, def.polarity.pos);
      const negNode = nodeId(c, def.polarity.neg);
      if (!poweredNodes.has(posNode) || !poweredNodes.has(negNode)) return;
      // Direction check: rebuild the graph with just THIS LED's own edge
      // removed, then ask whether the loop still reaches its anode from
      // the source's positive side (without a shortcut through the
      // cathode) and its cathode from the negative side — a backwards
      // LED fails this even though both legs are technically wired in.
      const graphWithoutThisLed = buildGraph(data, c.id);
      const correctlyOriented = activeSources.some(
        (s) =>
          bfsReach(graphWithoutThisLed, s.posNode, negNode).has(posNode) &&
          bfsReach(graphWithoutThisLed, s.negNode, posNode).has(negNode)
      );
      if (correctlyOriented) poweredComps.add(c.id);
      return;
    }
    const anyPinPowered = def.pins.some((p) => poweredNodes.has(nodeId(c, p.id)));
    if (anyPinPowered) poweredComps.add(c.id);
  });

  const poweredWires = new Set();
  wires.forEach((w) => {
    if (
      !w ||
      typeof w !== "object" ||
      Array.isArray(w) ||
      !w.from ||
      typeof w.from !== "object" ||
      !w.to ||
      typeof w.to !== "object"
    ) return;
    const fromComp = components.find((c) => c.id === w.from.compId);
    const toComp = components.find((c) => c.id === w.to.compId);
    if (!fromComp || !toComp) return;
    const a = nodeId(fromComp, w.from.pin);
    const b = nodeId(toComp, w.to.pin);
    if (poweredNodes.has(a) && poweredNodes.has(b)) poweredWires.add(w.id);
  });

  return { poweredComps, poweredWires, poweredNodes };
}

// ---------- Electrical analysis: Ohm's law on top of the topology. ----------
// Builds a graph like buildGraph, but also records which component/kind
// produced each edge (so a path can be walked back into resistance and
// forward-voltage totals), and treats every power_supply as a hard
// boundary — its transformer isolates the wall side from the DC side, so
// a path can't cross through one, keeping "domains" (each with their own
// source voltage) from bleeding into each other.
function buildAnalysisGraph(data) {
  const components = (data && data.components) || [];
  const wires = (data && data.wires) || [];
  const adjacency = new Map();
  const edgeInfo = new Map();
  const link = (a, b, info) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    edgeInfo.set(key, info);
  };
  components.forEach((c) => {
    const def = getSimulationComponentDefinition(c);
    if (!def) return;
    def.pins.forEach((p) => {
      const n = nodeId(c, p.id);
      if (!adjacency.has(n)) adjacency.set(n, new Set());
    });
    if (c.type === "power_supply") return; // isolation boundary — no edge across it
    if (c.type === "resistor") {
      link(nodeId(c, "p1"), nodeId(c, "p2"), { compId: c.id, kind: "resistor", resistance: Math.max(1, Number(c.resistance) || 220) });
    } else if (c.type === "potentiometer") {
      // Reuses "resistor" as the edge kind -- a potentiometer wired as a
      // two-terminal rheostat behaves electrically identically to a fixed
      // resistor at whatever value the wiper currently sets, so it gets
      // the exact same current/wattage/overheating analysis for free
      // rather than duplicating that logic under a new kind.
      const maxR = Math.max(1, Number(c.maxResistance) || 10000);
      const rawWiper = Number(c.wiper);
      const wiperPct = Math.max(0, Math.min(100, Number.isFinite(rawWiper) ? rawWiper : 50));
      link(nodeId(c, "p1"), nodeId(c, "p2"), { compId: c.id, kind: "resistor", resistance: Math.max(1, Math.round(maxR * (wiperPct / 100))) });
    } else if (c.type === "inductor") {
      link(nodeId(c, "p1"), nodeId(c, "p2"), { compId: c.id, kind: "resistor", resistance: inductorWindingOhms(c) });
    } else if (c.type === "switch") {
      if (isSwitchClosed(c)) link(nodeId(c, "p1"), nodeId(c, "p2"), { compId: c.id, kind: "wire", resistance: 0 });
    } else if (c.type === "switch_spdt") {
      link(nodeId(c, "com"), nodeId(c, spdtThrow(c)), { compId: c.id, kind: "wire", resistance: 0 });
    } else if (c.type === "ammeter") {
      link(nodeId(c, "p1"), nodeId(c, "p2"), { compId: c.id, kind: "ammeter", resistance: 0 });
    } else if (c.type === "mcu_teensy") {
      link(nodeId(c, "vin"), nodeId(c, "gnd"), { compId: c.id, kind: "teensy", resistance: TEENSY_LOAD_OHMS });
    } else if ((c.type === "led" || c.type === "diode") && def.polarity) {
      const color = LED_COLORS[c.color] ? c.color : "red";
      link(nodeId(c, def.polarity.pos), nodeId(c, def.polarity.neg), {
        compId: c.id,
        kind: "led",
        device: c.type,
        resistance: 0,
        forwardVoltage: c.type === "diode" ? DIODE_FORWARD_V : LED_COLORS[color].forwardVoltage,
        posNode: nodeId(c, def.polarity.pos),
        negNode: nodeId(c, def.polarity.neg),
      });
    }
  });
  wires.forEach((w) => {
    const fromComp = components.find((c) => c.id === w.from.compId);
    const toComp = components.find((c) => c.id === w.to.compId);
    if (!fromComp || !toComp) return;
    link(nodeId(fromComp, w.from.pin), nodeId(toComp, w.to.pin), { compId: null, kind: "wire", resistance: 0 });
  });
  return { adjacency, edgeInfo };
}

function shortestPathNodes(adjacency, start, end) {
  if (start === end) return [start];
  const parent = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === end) break;
    const neighbors = adjacency.get(cur);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (parent.has(n)) continue;
      parent.set(n, cur);
      queue.push(n);
    }
  }
  if (!parent.has(end)) return null;
  const path = [end];
  let cur = end;
  while (parent.get(cur) !== null) {
    cur = parent.get(cur);
    path.push(cur);
  }
  return path.reverse();
}

// True when the analysed path is the only route for current: with every
// zero-resistance link (wire, closed switch, ammeter) contracted, each
// resistive part on the path is a bridge, so nothing runs in parallel with it
// and no wire, switch or ammeter bypasses it. Used by the voltmeter, and to
// decide whether a backwards LED really stops the loop.
function pathIsOnlyRoute(adjacency, edgeInfo, path) {
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const claims = new Set([path[0]]);
  const walk = [path[0]];
  while (walk.length) {
    const cur = walk.shift();
    for (const n of adjacency.get(cur) || []) {
      if (!claims.has(n)) {
        claims.add(n);
        walk.push(n);
      }
    }
  }
  const isZero = (info) => !info || info.kind === "wire" || info.kind === "ammeter";
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const resistive = [];
  const seenKeys = new Set();
  claims.forEach((a) => {
    for (const b of adjacency.get(a) || []) {
      const key = edgeKey(a, b);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      if (isZero(edgeInfo.get(key))) {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
      } else {
        resistive.push({ a, b, key });
      }
    }
  });
  const superAdj = new Map();
  resistive.forEach(({ a, b, key }) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (!superAdj.has(ra)) superAdj.set(ra, []);
    if (!superAdj.has(rb)) superAdj.set(rb, []);
    superAdj.get(ra).push({ to: rb, key });
    superAdj.get(rb).push({ to: ra, key });
  });
  const pathEdges = [];
  for (let i = 0; i < path.length - 1; i++) {
    const key = edgeKey(path[i], path[i + 1]);
    if (!isZero(edgeInfo.get(key))) pathEdges.push({ a: path[i], b: path[i + 1], key });
  }
  for (const { a, b, key } of pathEdges) {
    const from = find(a);
    const to = find(b);
    if (from === to) return false;
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      for (const step of superAdj.get(cur) || []) {
        if (step.key === key || seen.has(step.to)) continue;
        seen.add(step.to);
        queue.push(step.to);
      }
    }
    if (seen.has(to)) return false;
  }
  return true;
}

// Potential (volts above the source's negative terminal) of the nodes the
// single-path model can honestly vouch for, for the voltmeter. The solver
// follows ONE path per source, so a voltage is only defined when that path is
// the only route for current:
//   - no other source's terminal is in the same connected circuit ("sources");
//   - every resistive part on the path is a bridge once zero-resistance links
//     (wires, closed switches, the ammeter) are contracted, i.e. nothing runs
//     in parallel with it and no switch or wire bypasses it ("parallel");
//   - the loop can conduct: a dead short has no voltage ("short"), and LEDs
//     that block (forward voltage above the source, or wired backwards) may
//     only be a single LED, which then takes the whole source voltage; two or
//     more can't be split ("ambiguous").
// Then the path drops I*R per resistive part and the forward voltage per LED
// (plus the battery's internal drop), and every other node in the circuit --
// dead-end spurs carry no current -- shares the potential of the path node it
// hangs from. With no complete path (an open circuit) no current flows, so the
// whole circuit reachable from the positive terminal sits at the source voltage
// and the part reachable from the negative terminal at 0. Returns the map, the
// reason it is empty (null when usable) and the nodes the circuit covers.
function collectNodePotentials(adjacency, edgeInfo, domain, path, otherTerminals, currentAmps, netVoltage) {
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const reach = (starts) => {
    const seen = new Set(starts);
    const queue = [...starts];
    while (queue.length) {
      const cur = queue.shift();
      for (const n of adjacency.get(cur) || []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return seen;
  };
  const hasPath = Boolean(path) && path.length >= 2;
  const claims = reach(hasPath ? [domain.posNode] : [domain.posNode, domain.negNode]);
  const fail = (reason) => ({ map: new Map(), reason, claims });
  if ([...claims].some((n) => otherTerminals.has(n))) return fail("sources");
  if (!Number.isFinite(domain.voltage) || domain.voltage <= 0) return fail("invalid");
  const potentials = new Map();
  if (!hasPath) {
    reach([domain.posNode]).forEach((n) => potentials.set(n, domain.voltage));
    reach([domain.negNode]).forEach((n) => {
      if (!potentials.has(n)) potentials.set(n, 0);
    });
    return { map: potentials, reason: null, claims };
  }

  if (!pathIsOnlyRoute(adjacency, edgeInfo, path)) return fail("parallel");
  const ledSteps = [];
  for (let i = 0; i < path.length - 1; i++) {
    const info = edgeInfo.get(edgeKey(path[i], path[i + 1]));
    if (info && info.kind === "led") ledSteps.push(info.posNode === undefined || (path[i] === info.posNode && path[i + 1] === info.negNode));
  }

  const blocked = netVoltage <= 0 || ledSteps.some((forward) => !forward);
  if (blocked && ledSteps.length >= 2) return fail("ambiguous");
  if (!blocked && currentAmps === Infinity) return fail("short");
  const amps = blocked ? 0 : currentAmps;
  let volts = domain.voltage - amps * (domain.internalResistance || 0);
  potentials.set(path[0], volts);
  for (let i = 0; i < path.length - 1; i++) {
    const info = edgeInfo.get(edgeKey(path[i], path[i + 1]));
    let drop = 0;
    if (info) drop = info.kind === "led" ? (blocked ? volts : info.forwardVoltage || 0) : amps * (info.resistance || 0);
    volts -= drop;
    potentials.set(path[i + 1], volts);
  }
  const queue = [...path];
  while (queue.length) {
    const cur = queue.shift();
    const curVolts = potentials.get(cur);
    for (const n of adjacency.get(cur) || []) {
      if (potentials.has(n)) continue;
      potentials.set(n, curVolts);
      queue.push(n);
    }
  }
  return { map: potentials, reason: null, claims };
}

// Runs real Ohm's-law math over each independently-sourced power domain
// (the wall outlet, a battery, and any power supply whose input is
// actually fed) and returns per-component results: current, status, and
// (for LEDs/resistors) whether they're within safe limits or would be
// destroyed. This is a simplified single-series-path model per domain —
// good enough for the loop-based circuits this builder makes, not a
// general multi-branch solver.
// ---------- Ohmmeter ----------
// Resistance between a meter's two probes. A real ohmmeter reads an UNPOWERED circuit, so a probe whose circuit has a source
// (battery, outlet, power supply) wired into it shows a dash. Resistors, potentiometers and inductor windings are resistances,
// wires, closed switches and ammeters are 0 ohm, and LEDs, capacitors, chips and meters are open (the meter's test current is
// far too small to turn them on). The network is solved exactly (a nodal solve), so parallel branches and bridges are right.
// Unlike the one-path solver above, nothing here assumes the circuit is a single loop.
function ohmmeterReadings(components, wires) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const touched = new Set();
  const resistive = [];
  const sourceNodes = [];
  const join = (a, b) => {
    touched.add(a);
    touched.add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const resist = (a, b, r) => {
    if (!(r > 0)) return join(a, b);
    if (r >= 1e12) {
      // Beyond what any meter could read: counts as open (a part that is merely there).
      touched.add(a);
      touched.add(b);
      return;
    }
    touched.add(a);
    touched.add(b);
    resistive.push({ a, b, r });
  };
  components.forEach((c) => {
    const def = getSimulationComponentDefinition(c);
    if (!def) return;
    def.pins.forEach((p) => find(nodeId(c, p.id)));
    if (def.isSource || c.type === "power_supply") def.pins.forEach((p) => sourceNodes.push(nodeId(c, p.id)));
    if (c.type === "resistor") resist(nodeId(c, "p1"), nodeId(c, "p2"), Math.max(1, Number(c.resistance) || 220));
    else if (c.type === "potentiometer") {
      const maxR = Math.max(1, Number(c.maxResistance) || 10000);
      const rawWiper = Number(c.wiper);
      const wiperPct = Math.max(0, Math.min(100, Number.isFinite(rawWiper) ? rawWiper : 50));
      resist(nodeId(c, "p1"), nodeId(c, "p2"), Math.max(1, Math.round(maxR * (wiperPct / 100))));
    } else if (c.type === "inductor") resist(nodeId(c, "p1"), nodeId(c, "p2"), inductorWindingOhms(c));
    else if (c.type === "switch") {
      if (isSwitchClosed(c)) join(nodeId(c, "p1"), nodeId(c, "p2"));
    } else if (c.type === "switch_spdt") join(nodeId(c, "com"), nodeId(c, spdtThrow(c)));
    else if (c.type === "ammeter") join(nodeId(c, "p1"), nodeId(c, "p2"));
  });
  wires.forEach((w) => {
    if (!(w && w.from && w.to)) return;
    const fromComp = components.find((c) => c.id === w.from.compId);
    const toComp = components.find((c) => c.id === w.to.compId);
    if (!fromComp || !toComp) return;
    join(nodeId(fromComp, w.from.pin), nodeId(toComp, w.to.pin));
  });
  // The network on joined nodes: each resistance links two groups (one that starts and ends on the same group is shorted out).
  const edges = [];
  const around = new Map();
  resistive.forEach(({ a, b, r }) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    edges.push({ a: ra, b: rb, g: 1 / r });
    if (!around.has(ra)) around.set(ra, []);
    if (!around.has(rb)) around.set(rb, []);
    around.get(ra).push(rb);
    around.get(rb).push(ra);
  });
  const sourceGroups = new Set(sourceNodes.map(find));
  const reach = (start) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      for (const n of around.get(cur) || []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return seen;
  };
  const MAX_NODES = 250;
  const results = {};
  components.forEach((c) => {
    if (c.type !== "ohmmeter") return;
    const pa = nodeId(c, "p1");
    const pb = nodeId(c, "p2");
    const none = (reason) => ({ kind: "ohmmeter", ohms: null, status: "no-reading", reason, dangerous: false });
    if (!touched.has(pa) || !touched.has(pb)) {
      results[c.id] = none("unwired");
      return;
    }
    const A = find(pa);
    const B = find(pb);
    const netA = reach(A);
    const netB = netA.has(B) ? netA : reach(B);
    if ([...netA, ...netB].some((n) => sourceGroups.has(n))) {
      results[c.id] = none("powered");
      return;
    }
    if (A === B) {
      results[c.id] = { kind: "ohmmeter", ohms: 0, status: "normal", reason: null, dangerous: false };
      return;
    }
    if (!netA.has(B)) {
      results[c.id] = { kind: "ohmmeter", ohms: null, status: "open", reason: null, dangerous: false };
      return;
    }
    const nodes = [...netA];
    if (nodes.length > MAX_NODES) {
      results[c.id] = none("large");
      return;
    }
    // Inject 1 A at A, hold B at 0 V: the potential at A is then the resistance.
    const index = new Map();
    nodes.filter((n) => n !== B).forEach((n, i) => index.set(n, i));
    const n = index.size;
    const m = Array.from({ length: n }, () => new Float64Array(n + 1));
    m[index.get(A)][n] = 1;
    edges.forEach(({ a, b, g }) => {
      if (!netA.has(a)) return;
      const ia = index.get(a);
      const ib = index.get(b);
      if (ia !== undefined) m[ia][ia] += g;
      if (ib !== undefined) m[ib][ib] += g;
      if (ia !== undefined && ib !== undefined) {
        m[ia][ib] -= g;
        m[ib][ia] -= g;
      }
    });
    // Pivots are judged relative to the largest conductance, so a network of very large resistances still solves.
    let scale = 0;
    for (let i = 0; i < n; i++) scale = Math.max(scale, m[i][i]);
    let singular = false;
    for (let col = 0; col < n && !singular; col++) {
      let pivot = col;
      for (let row = col + 1; row < n; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
      if (Math.abs(m[pivot][col]) < 1e-12 * scale) {
        singular = true;
        break;
      }
      [m[col], m[pivot]] = [m[pivot], m[col]];
      for (let row = col + 1; row < n; row++) {
        const f = m[row][col] / m[col][col];
        if (!f) continue;
        for (let k = col; k <= n; k++) m[row][k] -= f * m[col][k];
      }
    }
    if (singular) {
      results[c.id] = none("invalid");
      return;
    }
    const x = new Float64Array(n);
    for (let row = n - 1; row >= 0; row--) {
      let sum = m[row][n];
      for (let k = row + 1; k < n; k++) sum -= m[row][k] * x[k];
      x[row] = sum / m[row][row];
    }
    // Twelve significant digits hide the solver's rounding noise (300.00000000000006).
    const ohms = Number(x[index.get(A)].toPrecision(12));
    results[c.id] = Number.isFinite(ohms) && ohms >= 0
      ? { kind: "ohmmeter", ohms, status: "normal", reason: null, dangerous: false }
      : none("invalid");
  });
  return results;
}

// "47.0Ω", "4.70kΩ", "1.00MΩ"; a dash when there is no reading and OL when the probes aren't connected.
const OHM_UNITS = [["Ω", 1], ["kΩ", 1e3], ["MΩ", 1e6], ["GΩ", 1e9]];
export function formatOhms(ohms, status) {
  if (status === "open") return "OL";
  if (typeof ohms !== "number" || !Number.isFinite(ohms) || ohms < 0) return "—";
  if (ohms >= 1e11) return "OL";
  if (ohms < 0.005) return "0Ω";
  if (ohms < 1) return `${ohms.toFixed(2)}Ω`;
  let u = 0;
  while (u < OHM_UNITS.length - 1 && ohms >= OHM_UNITS[u + 1][1]) u++;
  const digits = (value) => (value < 10 ? 2 : value < 100 ? 1 : 0);
  let scaled = ohms / OHM_UNITS[u][1];
  let text = scaled.toFixed(digits(scaled));
  if (Number(text) >= 1000 && u < OHM_UNITS.length - 1) {
    u++;
    scaled = ohms / OHM_UNITS[u][1];
    text = scaled.toFixed(digits(scaled));
  }
  return `${text}${OHM_UNITS[u][0]}`;
}

export function computeCircuitAnalysis(data) {
  const components = (data && data.components) || [];
  const { poweredNodes } = computePoweredSet(data);
  const { adjacency, edgeInfo } = buildAnalysisGraph(data);

  const domains = [];
  components.forEach((c) => {
    const def = getSimulationComponentDefinition(c);
    if (!def) return;
    if (c.type === "battery") {
      domains.push({
        posNode: nodeId(c, "pos"),
        negNode: nodeId(c, "neg"),
        voltage: Number(c.voltage) || 9,
        internalResistance: Math.max(0, Number(c.internalResistance) || 0),
        dangerous: false,
      });
    } else if (c.type === "outlet") {
      domains.push({ posNode: nodeId(c, "hot"), negNode: nodeId(c, "neutral"), voltage: OUTLET_VOLTAGE, dangerous: true });
    } else if (c.type === "power_supply") {
      const inHot = nodeId(c, "in_hot");
      const inNeutral = nodeId(c, "in_neutral");
      if (poweredNodes.has(inHot) && poweredNodes.has(inNeutral)) {
        domains.push({ posNode: nodeId(c, "out_pos"), negNode: nodeId(c, "out_neg"), voltage: Number(c.outputVoltage) || 5, dangerous: false });
      }
    }
  });

  const results = {};
  // Only voltmeters need node potentials, so nothing else pays for them.
  const wantPotentials = components.some((c) => c.type === "voltmeter");
  const potentialMaps = [];
  // Terminals of every source: the domains, plus each Power Supply's output
  // (a supply that is fed but whose own loop is unclosed has no domain yet).
  const supplyTerminals = [];
  components.forEach((c) => {
    if (c.type === "power_supply") supplyTerminals.push(nodeId(c, "out_pos"), nodeId(c, "out_neg"));
  });
  const otherTerminals = (domain) => {
    const others = new Set();
    domains.forEach((d) => {
      if (d !== domain) {
        others.add(d.posNode);
        others.add(d.negNode);
      }
    });
    supplyTerminals.forEach((n) => others.add(n));
    others.delete(domain.posNode);
    others.delete(domain.negNode);
    return others;
  };
  domains.forEach((domain) => {
    const path = shortestPathNodes(adjacency, domain.posNode, domain.negNode);
    if (!path || path.length < 2) {
      if (wantPotentials) potentialMaps.push({ domain, ...collectNodePotentials(adjacency, edgeInfo, domain, null, otherTerminals(domain), 0, 0) });
      return;
    }
    let totalResistance = domain.internalResistance || 0;
    let totalForwardVoltage = 0;
    const reversedLedIds = new Set();
    const edges = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const info = edgeInfo.get(key);
      if (!info) continue;
      totalResistance += info.resistance || 0;
      if (info.kind === "led") totalForwardVoltage += info.forwardVoltage || 0;
      // A backwards LED blocks the loop like a diode (when that loop is a plain series path).
      if (info.kind === "led" && info.posNode !== undefined && a === info.negNode && b === info.posNode) reversedLedIds.add(info.compId);
      edges.push(info);
    }
    // With a parallel branch or bypass the single path isn't the whole story, so a
    // backwards LED only stops the loop when the path is the only route.
    const ledsBlock = reversedLedIds.size > 0 && pathIsOnlyRoute(adjacency, edgeInfo, path);
    const netVoltage = domain.voltage - totalForwardVoltage;
    let currentAmps;
    if (netVoltage <= 0 || ledsBlock) currentAmps = 0;
    else if (totalResistance <= 0) currentAmps = Infinity;
    else currentAmps = netVoltage / totalResistance;
    const currentMa = currentAmps === Infinity ? Infinity : currentAmps * 1000;
    if (wantPotentials) potentialMaps.push({ domain, ...collectNodePotentials(adjacency, edgeInfo, domain, path, otherTerminals(domain), currentAmps, netVoltage) });

    edges.forEach((info) => {
      if (!info.compId) return;
      if (info.kind === "led" && info.device === "diode") {
        let status = "normal";
        if (domain.dangerous) status = "burnt";
        else if (ledsBlock && reversedLedIds.has(info.compId)) status = "reversed";
        else if (ledsBlock) status = "blocked";
        else if (currentMa === Infinity || currentMa > DIODE_RATED_MA * 3) status = "burnt";
        else if (currentMa > DIODE_RATED_MA * 1.5) status = "overdriven";
        else if (netVoltage <= 0) status = "off";
        results[info.compId] = { kind: "diode", currentMa, voltage: domain.voltage, status, dangerous: domain.dangerous };
      } else if (info.kind === "led") {
        let status = "normal";
        if (domain.dangerous) status = "burnt";
        else if (ledsBlock && reversedLedIds.has(info.compId)) status = "reversed";
        else if (ledsBlock) status = "blocked";
        else if (currentMa === Infinity || currentMa > LED_RATED_MA * 3) status = "burnt";
        else if (currentMa > LED_RATED_MA * 1.5) status = "overdriven";
        else if (netVoltage <= 0) status = "unlit-low-voltage";
        else if (currentMa < 1) status = "dim";
        results[info.compId] = { kind: "led", currentMa, voltage: domain.voltage, status, dangerous: domain.dangerous };
      } else if (info.kind === "resistor") {
        const amps = currentMa === Infinity ? 0 : currentMa / 1000;
        const watts = amps * amps * info.resistance;
        const status = domain.dangerous ? "burnt" : watts > RESISTOR_WATTAGE_RATING ? "overheating" : "normal";
        results[info.compId] = { kind: "resistor", currentMa, watts, status, dangerous: domain.dangerous };
      } else if (info.kind === "teensy") {
        // Same P=I^2*R math as the resistor branch above, using the
        // teensy's OWN fixed load (TEENSY_LOAD_OHMS), not domain.voltage
        // -- a critic pass found the original version multiplied current
        // by the full source voltage, which only happens to equal the
        // teensy's own dissipation when it's the sole resistive element
        // in the loop. With anything else sharing the series path (a
        // current-limiting resistor, a potentiometer, an LED ahead of
        // it), some of that source voltage drops across the OTHER
        // component, not the teensy, so multiplying by the full domain
        // voltage overstated the teensy's own figure by reporting the
        // whole loop's power under its name.
        const amps = currentMa === Infinity ? 0 : currentMa / 1000;
        const watts = amps * amps * TEENSY_LOAD_OHMS;
        const status = domain.dangerous ? "burnt" : watts > TEENSY_WATTAGE_RATING ? "overheating" : "normal";
        results[info.compId] = { kind: "teensy", currentMa, voltage: domain.voltage, watts, status, dangerous: domain.dangerous };
      } else if (info.kind === "ammeter") {
        // Zero resistance, so it never changes what current flows -- it
        // just reports whatever the loop's own analysis already computed
        // at this point on the path, same as a real idealized ammeter
        // should.
        results[info.compId] = { kind: "ammeter", currentMa, status: domain.dangerous ? "burnt" : "normal", dangerous: domain.dangerous };
      }
    });
  });

  // Voltmeters read the difference between their probes' potentials, from the
  // source whose circuit covers both. Otherwise they say why not.
  if (wantPotentials) {
    components.forEach((c) => {
      if (c.type !== "voltmeter") return;
      const pos = nodeId(c, "pos");
      const neg = nodeId(c, "neg");
      const hit = potentialMaps.find(({ reason, map }) => !reason && map.has(pos) && map.has(neg));
      let volts = hit ? hit.map.get(pos) - hit.map.get(neg) : null;
      let reason = null;
      if (hit && !Number.isFinite(volts)) {
        volts = null;
        reason = "invalid";
      } else if (!hit) {
        const claimer = potentialMaps.find((m) => m.reason && (m.claims.has(pos) || m.claims.has(neg)));
        const wired = (node) => (adjacency.get(node) || new Set()).size > 0;
        reason = claimer
            ? claimer.reason
            : potentialMaps.some((m) => !m.reason && (m.map.has(pos) || m.map.has(neg)))
            ? "probes"
            : wired(pos) && wired(neg)
            ? "nosource"
            : "unwired";
      }
      results[c.id] =
        volts === null
          ? { kind: "voltmeter", volts: null, status: "no-reading", reason, dangerous: false }
          : { kind: "voltmeter", volts, status: "normal", reason: null, dangerous: hit.domain.dangerous };
    });
  }

  if (components.some((c) => c.type === "ohmmeter")) Object.assign(results, ohmmeterReadings(components, (data && data.wires) || []));

  return results;
}

function pinPosition(comp, pinId) {
  if (
    !comp ||
    typeof comp !== "object" ||
    Array.isArray(comp) ||
    typeof comp.type !== "string" ||
    !Object.prototype.hasOwnProperty.call(SIM_COMPONENTS, comp.type) ||
    !Number.isFinite(comp.x) ||
    !Number.isFinite(comp.y) ||
    comp.x < 0 ||
    comp.x > 1500 ||
    comp.y < 0 ||
    comp.y > 700
  ) return null;
  const def = getSimulationComponentDefinition(comp);
  if (!def) return null;
  const pin = def.pins.find((p) => p.id === pinId);
  if (!pin) return null;
  return { x: comp.x + pin.x, y: comp.y + pin.y };
}

function renderComponentSvg(comp, poweredComps, analysis) {
  const def = getSimulationComponentDefinition(comp);
  if (!def) return "";
  const info = analysis[comp.id];
  const statusClass = info && (info.status === "burnt" || info.status === "overheating") ? " sim-damaged" : "";
  // Matches the admin builder: every component type already gets this
  // treatment the Teensy component alone used to get (its label prints
  // directly on the part, in both the builder and this public render),
  // so a label an admin chose to fill in was already precedent for
  // public-visible content, not a private note -- a native <title> just
  // extends that same visibility to every other component type as a
  // hover tooltip instead of printed text. Skipped for mcu_teensy itself,
  // which already prints the same text visibly -- a tooltip repeating it
  // would just be redundant (a critic pass found this).
  const meterTitle = comp.type === "ohmmeter" && info ? `Ohmmeter reading ${info.status === "open" ? "open circuit (OL)" : info.status === "no-reading" ? "none" : formatOhms(info.ohms, info.status)}` : "";
  const titleText = comp.type === "mcu_teensy" ? "" : comp.type === "logic_gate" ? logicGateTitle(comp) : meterTitle ? (comp.label ? `${comp.label}: ${meterTitle}` : meterTitle) : comp.label || "";
  const titleSvg = titleText ? `<title>${escXml(titleText)}</title>` : "";
  // An ammeter's whole reason for existing is showing a number -- a critic
  // pass found the public embed never rendered ANY analysis result (only
  // used them to toggle a "damaged" CSS class), so a site visitor placed
  // in front of a published ammeter would never actually see a reading,
  // only the admin's own inspector panel. Printed directly on the part,
  // matching how mcu_teensy already prints its own label visibly.
  const readingSvg =
    comp.type === "ammeter" && info
      ? ammeterReadingSvg(`${info.currentMa === Infinity ? "∞" : info.currentMa.toFixed(1)}mA`, def.rotation || 0)
      : comp.type === "voltmeter" && info
      ? voltmeterReadingSvg(formatVolts(info.volts), def.rotation || 0)
      : comp.type === "ohmmeter" && info
      ? ohmmeterReadingSvg(formatOhms(info.ohms, info.status), def.rotation || 0)
      : "";
  return `<g class="sim-comp sim-comp-${escXml(comp.type)}${statusClass}" data-id="${escXml(comp.id)}" data-powered="${
    poweredComps.has(comp.id) ? "true" : "false"
  }" transform="translate(${comp.x},${comp.y})">${titleSvg}${def.render(comp)}${readingSvg && def.overlay ? def.overlay(readingSvg) : readingSvg}</g>`;
}

// Optional presentation-only route bends; electrical connectivity still uses wire.from/to.
const MAX_MANUAL_WIRE_WAYPOINTS = 20;

function hasValidWireWaypoints(wire, bounds = getSimulationCanvasBounds()) {
  if (!wire || !Object.prototype.hasOwnProperty.call(wire, "waypoints")) return true;
  const points = wire.waypoints;
  return Array.isArray(points) &&
    points.length <= MAX_MANUAL_WIRE_WAYPOINTS &&
    !(wire.auto === true && points.length > 0) &&
    points.every((point) =>
      point &&
      typeof point === "object" &&
      !Array.isArray(point) &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      point.x >= 0 &&
      point.x <= bounds.width &&
      point.y >= 0 &&
      point.y <= bounds.height
    );
}

function getWireWaypoints(wire, components = []) {
  if (!wire || wire.auto === true || !Array.isArray(wire.waypoints) || !hasValidWireWaypoints(wire, getSimulationCanvasBounds(components))) return [];
  return wire.waypoints.map((point) => ({ x: point.x, y: point.y }));
}

function getWireRoutePoints(wire, p1, p2, components) {
  return [p1, ...getWireWaypoints(wire, components), p2];
}

function getWireRoutePath(points) {
  return points.map((point, index) => (index === 0 ? "M" : "L") + point.x + "," + point.y).join(" ");
}

// Places labels halfway along the visible route rather than halfway
// between component pins, which can be far away from a bent wire.
function getWireLabelPosition(points) {
  if (!points.length) return { x: 0, y: 0 };
  let longestIndex = -1;
  let longestLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    if (length > longestLength) {
      longestLength = length;
      longestIndex = i;
    }
  }
  if (longestIndex < 0) return { x: points[0].x, y: points[0].y };
  // Center labels on a straight segment, not on a waypoint where two
  // segments meet; this keeps multi-bend labels from sitting on a corner.
  return {
    x: (points[longestIndex].x + points[longestIndex + 1].x) / 2,
    y: (points[longestIndex].y + points[longestIndex + 1].y) / 2,
  };
}

function setWireWaypoints(wire, points) {
  if (points.length) wire.waypoints = points;
  else delete wire.waypoints;
}

function renderWireSvg(wire, components, poweredWires) {
  const fromComp = components.find((c) => c.id === wire.from.compId);
  const toComp = components.find((c) => c.id === wire.to.compId);
  if (!fromComp || !toComp) return "";
  const p1 = pinPosition(fromComp, wire.from.pin);
  const p2 = pinPosition(toComp, wire.to.pin);
  if (!p1 || !p2) return "";
  const routePoints = getWireRoutePoints(wire, p1, p2, components);
  const routeLength = routePoints.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - routePoints[index].x, point.y - routePoints[index].y), 0);
  if (routeLength < 0.5) return "";
  const d = getWireRoutePath(routePoints);
  const labelPoint = getWireLabelPosition(routePoints);
  const labelSvg = wire.label
    ? `<text class="sim-wire-label" x="${labelPoint.x}" y="${labelPoint.y - 6}" text-anchor="middle">${escXml(
        wire.label
      )}</text>`
    : "";
  const kind = wire.kind === "hdmi" ? "hdmi" : "wire";
  const thicknessMultiplier = { thin: 0.6, thick: 1.7 }[wire.thickness] || 1;
  const roundPx = (n) => Math.round(n * 100) / 100;
  const strokeStyle =
    thicknessMultiplier === 1 ? "" : ` style="stroke-width:${roundPx((kind === "hdmi" ? 5 : 4) * thicknessMultiplier)}px"`;
  const shineStrokeStyle =
    thicknessMultiplier === 1 ? "" : ` style="stroke-width:${roundPx((kind === "hdmi" ? 1.5 : 1.2) * thicknessMultiplier)}px"`;
  return `<path class="sim-wire sim-wire-${kind}" data-id="${escXml(wire.id)}" data-animated="${poweredWires.has(wire.id) ? "true" : "false"}" d="${d}"${strokeStyle}/><path class="sim-wire-shine sim-wire-shine-${kind}" d="${d}"${shineStrokeStyle}/>${labelSvg}`;
}

// The embed always used the builder's whole 1500x700 canvas as its view,
// so a small circuit built in one corner rendered as a few specks in a
// mostly-empty box. The view now fits the circuit's actual bounds (every
// part's box, wire endpoints, and manual bend points), with padding and a minimum size so
// a single part isn't blown up to fill the screen.
function fittedViewBox(components, wires, fallbackW, fallbackH) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const c of components) {
    const def = getSimulationComponentDefinition(c);
    if (!def || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    grow(c.x, c.y);
    grow(c.x + (def.w || 0), c.y + (def.h || 0));
  }
  for (const w of wires) {
    for (const end of [w.from, w.to]) {
      const comp = end && components.find((c) => c.id === end.compId);
      const p = comp && pinPosition(comp, end.pin);
      if (p) grow(p.x, p.y);
    }
    for (const point of getWireWaypoints(w, components)) grow(point.x, point.y);
  }
  if (!Number.isFinite(minX)) return `0 0 ${fallbackW} ${fallbackH}`;
  const PAD = 40;
  const MIN_W = 480;
  const MIN_H = 200;
  let x = minX - PAD, y = minY - PAD, w = maxX - minX + PAD * 2, h = maxY - minY + PAD * 2;
  if (w < MIN_W) { x -= (MIN_W - w) / 2; w = MIN_W; }
  if (h < MIN_H) { y -= (MIN_H - h) / 2; h = MIN_H; }
  const r = (n) => Math.round(n);
  return `${r(x)} ${r(y)} ${r(w)} ${r(h)}`;
}

function sanitizeSimulationRenderData(data) {
  const source = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const validId = (value) =>
    (typeof value === "string" &&
      value.length > 0 &&
      value.length <= 160 &&
      !Object.prototype.hasOwnProperty.call(Object.prototype, value)) ||
    Number.isSafeInteger(value);
  const componentsById = new Map();
  const renderedComponentIds = new Set();
  const components = (Array.isArray(source.components) ? source.components : []).filter((component) => {
    if (
      !component ||
      typeof component !== "object" ||
      Array.isArray(component) ||
      !validId(component.id) ||
      componentsById.has(component.id) ||
      renderedComponentIds.has(String(component.id)) ||
      typeof component.type !== "string" ||
      !Object.prototype.hasOwnProperty.call(SIM_COMPONENTS, component.type) ||
      !Number.isFinite(component.x) ||
      !Number.isFinite(component.y) ||
      component.x < 0 ||
      component.x > 1500 ||
      component.y < 0 ||
      component.y > 700
    ) return false;
    componentsById.set(component.id, component);
    renderedComponentIds.add(String(component.id));
    return true;
  });
  const wireIds = new Set();
  const wires = [];
  const sourceWires = Array.isArray(source.wires) ? source.wires : [];
  for (let index = 0; index < sourceWires.length; index++) {
    const wire = sourceWires[index];
    const validEndpoint = (end) => {
      if (
        !end ||
        typeof end !== "object" ||
        Array.isArray(end) ||
        !validId(end.compId) ||
        typeof end.pin !== "string" ||
        !end.pin ||
        end.pin.length > 100
      ) return false;
      const component = componentsById.get(end.compId);
      const definition = component && getSimulationComponentDefinition(component);
      return Boolean(definition && definition.pins.some((pin) => pin.id === end.pin));
    };
    if (
      !wire ||
      typeof wire !== "object" ||
      Array.isArray(wire) ||
      !validEndpoint(wire.from) ||
      !validEndpoint(wire.to)
    ) continue;
    let id = wire.id;
    if (!validId(id) || wireIds.has(String(id))) {
      let candidate = `render_wire_${index + 1}`;
      let suffix = 1;
      while (wireIds.has(candidate)) candidate = `render_wire_${index + 1}_${suffix++}`;
      id = candidate;
    }
    wireIds.add(String(id));
    wires.push({ ...wire, id });
  }
  return { components, wires };
}

export function renderSimulationSvg(data, { width = 1500, height = 700 } = {}) {
  const safeData = sanitizeSimulationRenderData(data);
  const components = safeData.components;
  const wires = safeData.wires;
  const { poweredComps, poweredWires } = computePoweredSet(safeData);
  const analysis = computeCircuitAnalysis(safeData);
  const wiresSvg = wires.map((w) => renderWireSvg(w, components, poweredWires)).join("");
  const compsSvg = components.map((c) => renderComponentSvg(c, poweredComps, analysis)).join("");
  return `<svg class="sim-svg" viewBox="${fittedViewBox(components, wires, width, height)}" xmlns="http://www.w3.org/2000/svg">${SIM_DEFS_SVG}${wiresSvg}${compsSvg}</svg>`;
}
