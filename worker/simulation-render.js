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
  // A real half+ breadboard: 30 columns (the same count as a real 400+
  // tie-point board), with independent power rails on BOTH the top and
  // bottom edges — not just one — plus a terminal strip split into
  // independent columns by the center gutter. Each column's 5 physical
  // holes are electrically one point in real life; one hole stands in
  // for the whole column here, but different columns are NOT connected
  // to each other, and the top rails are NOT connected to the bottom
  // rails, so building a circuit requires bridging with parts/jumpers
  // the way a real breadboard does.
  breadboard: {
    label: "Breadboard",
    w: 1200,
    h: 150,
    cols: 30,
    railGroups: {
      pos_top: Array.from({ length: 30 }, (_, i) => `rpt${i + 1}`),
      neg_top: Array.from({ length: 30 }, (_, i) => `rnt${i + 1}`),
      neg_bottom: Array.from({ length: 30 }, (_, i) => `rnb${i + 1}`),
      pos_bottom: Array.from({ length: 30 }, (_, i) => `rpb${i + 1}`),
    },
    pins: Array.from({ length: 30 }, (_, i) => i).flatMap((i) => [
      { id: `rpt${i + 1}`, x: 20 + i * 40, y: 14 },
      { id: `rnt${i + 1}`, x: 20 + i * 40, y: 26 },
      { id: `t${i + 1}`, x: 20 + i * 40, y: 60 },
      { id: `b${i + 1}`, x: 20 + i * 40, y: 90 },
      { id: `rnb${i + 1}`, x: 20 + i * 40, y: 124 },
      { id: `rpb${i + 1}`, x: 20 + i * 40, y: 136 },
    ]),
    render: () => {
      let holes = "";
      for (let i = 0; i < 30; i++) {
        const x = 20 + i * 40;
        holes += `<circle class="bb-hole bb-hole-rail" cx="${x}" cy="14" r="2.5"/>`;
        holes += `<circle class="bb-hole bb-hole-rail" cx="${x}" cy="26" r="2.5"/>`;
        holes += `<circle class="bb-hole" cx="${x}" cy="60" r="3"/>`;
        holes += `<circle class="bb-hole" cx="${x}" cy="90" r="3"/>`;
        holes += `<circle class="bb-hole bb-hole-rail" cx="${x}" cy="124" r="2.5"/>`;
        holes += `<circle class="bb-hole bb-hole-rail" cx="${x}" cy="136" r="2.5"/>`;
      }
      return `<rect class="bb-body" x="0" y="0" width="1200" height="150" rx="6"/><rect class="bb-sheen" x="3" y="3" width="1194" height="16" rx="4"/><rect class="bb-rail-line bb-rail-pos" x="10" y="12.5" width="1180" height="3" rx="1.5"/><rect class="bb-rail-line bb-rail-neg" x="10" y="24.5" width="1180" height="3" rx="1.5"/><text class="bb-rail-label bb-rail-label-pos" x="4" y="17">+</text><text class="bb-rail-label bb-rail-label-neg" x="4" y="29">−</text><rect class="bb-channel" x="4" y="68" width="1192" height="14" rx="3"/><rect class="bb-rail-line bb-rail-neg" x="10" y="122.5" width="1180" height="3" rx="1.5"/><rect class="bb-rail-line bb-rail-pos" x="10" y="134.5" width="1180" height="3" rx="1.5"/><text class="bb-rail-label bb-rail-label-neg" x="4" y="127">−</text><text class="bb-rail-label bb-rail-label-pos" x="4" y="139">+</text>${holes}`;
    },
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
  // An idealized ammeter: zero resistance (doesn't disturb the circuit
  // it's measuring), placed IN SERIES like a switch/wire, reporting
  // whatever current already flows on the analyzed path through it. A
  // real voltmeter (measured in PARALLEL, showing the potential
  // difference between two arbitrary points) needs actual per-node
  // voltage computation this simulator's single-shortest-path model
  // doesn't have -- that's real solver work, out of scope here; this
  // covers the current-measurement half of "voltage/current meter" that
  // fits the existing analysis for free.
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

function nodeId(comp, pinId) {
  const def = SIM_COMPONENTS[comp.type];
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
    const def = SIM_COMPONENTS[c.type];
    if (!def) return;
    def.pins.forEach((p) => {
      const n = nodeId(c, p.id);
      if (!adjacency.has(n)) adjacency.set(n, new Set());
    });
    if (def.passthrough && (c.type !== "switch" || isSwitchClosed(c))) {
      def.passthrough.forEach(([a, b]) => link(nodeId(c, a), nodeId(c, b)));
    }
    if (c.type === "led" && def.polarity && c.id !== excludeLedId) {
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
    const def = SIM_COMPONENTS[c.type];
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
    const def = SIM_COMPONENTS[c.type];
    if (!def) return;
    if (c.type === "led" && def.polarity) {
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
    const def = SIM_COMPONENTS[c.type];
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
    } else if (c.type === "switch") {
      if (isSwitchClosed(c)) link(nodeId(c, "p1"), nodeId(c, "p2"), { compId: c.id, kind: "wire", resistance: 0 });
    } else if (c.type === "ammeter") {
      link(nodeId(c, "p1"), nodeId(c, "p2"), { compId: c.id, kind: "ammeter", resistance: 0 });
    } else if (c.type === "mcu_teensy") {
      link(nodeId(c, "vin"), nodeId(c, "gnd"), { compId: c.id, kind: "teensy", resistance: TEENSY_LOAD_OHMS });
    } else if (c.type === "led" && def.polarity) {
      const color = LED_COLORS[c.color] ? c.color : "red";
      link(nodeId(c, def.polarity.pos), nodeId(c, def.polarity.neg), {
        compId: c.id,
        kind: "led",
        resistance: 0,
        forwardVoltage: LED_COLORS[color].forwardVoltage,
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

// Runs real Ohm's-law math over each independently-sourced power domain
// (the wall outlet, a battery, and any power supply whose input is
// actually fed) and returns per-component results: current, status, and
// (for LEDs/resistors) whether they're within safe limits or would be
// destroyed. This is a simplified single-series-path model per domain —
// good enough for the loop-based circuits this builder makes, not a
// general multi-branch solver.
export function computeCircuitAnalysis(data) {
  const components = (data && data.components) || [];
  const { poweredNodes } = computePoweredSet(data);
  const { adjacency, edgeInfo } = buildAnalysisGraph(data);

  const domains = [];
  components.forEach((c) => {
    const def = SIM_COMPONENTS[c.type];
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
  domains.forEach((domain) => {
    const path = shortestPathNodes(adjacency, domain.posNode, domain.negNode);
    if (!path || path.length < 2) return;
    let totalResistance = domain.internalResistance || 0;
    let totalForwardVoltage = 0;
    const edges = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const info = edgeInfo.get(key);
      if (!info) continue;
      totalResistance += info.resistance || 0;
      if (info.kind === "led") totalForwardVoltage += info.forwardVoltage || 0;
      edges.push(info);
    }
    const netVoltage = domain.voltage - totalForwardVoltage;
    let currentAmps;
    if (netVoltage <= 0) currentAmps = 0;
    else if (totalResistance <= 0) currentAmps = Infinity;
    else currentAmps = netVoltage / totalResistance;
    const currentMa = currentAmps === Infinity ? Infinity : currentAmps * 1000;

    edges.forEach((info) => {
      if (!info.compId) return;
      if (info.kind === "led") {
        let status = "normal";
        if (domain.dangerous) status = "burnt";
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
  const def = SIM_COMPONENTS[comp.type];
  const pin = def.pins.find((p) => p.id === pinId);
  if (!pin) return null;
  return { x: comp.x + pin.x, y: comp.y + pin.y };
}

function renderComponentSvg(comp, poweredComps, analysis) {
  const def = SIM_COMPONENTS[comp.type];
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
  const titleSvg = comp.label && comp.type !== "mcu_teensy" ? `<title>${escXml(comp.label)}</title>` : "";
  // An ammeter's whole reason for existing is showing a number -- a critic
  // pass found the public embed never rendered ANY analysis result (only
  // used them to toggle a "damaged" CSS class), so a site visitor placed
  // in front of a published ammeter would never actually see a reading,
  // only the admin's own inspector panel. Printed directly on the part,
  // matching how mcu_teensy already prints its own label visibly.
  const readingSvg =
    comp.type === "ammeter" && info
      ? `<text class="ammeter-reading" x="20" y="32" text-anchor="middle" font-size="8">${
          info.currentMa === Infinity ? "∞" : info.currentMa.toFixed(1)
        }mA</text>`
      : "";
  return `<g class="sim-comp sim-comp-${escXml(comp.type)}${statusClass}" data-id="${escXml(comp.id)}" data-powered="${
    poweredComps.has(comp.id) ? "true" : "false"
  }" transform="translate(${comp.x},${comp.y})">${titleSvg}${def.render(comp)}${readingSvg}</g>`;
}

// Optional presentation-only route bends; electrical connectivity still uses wire.from/to.
const MAX_MANUAL_WIRE_WAYPOINTS = 20;

function hasValidWireWaypoints(wire) {
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
      point.x <= 1500 &&
      point.y >= 0 &&
      point.y <= 700
    );
}

function getWireWaypoints(wire) {
  if (!wire || wire.auto === true || !Array.isArray(wire.waypoints) || !hasValidWireWaypoints(wire)) return [];
  return wire.waypoints.map((point) => ({ x: point.x, y: point.y }));
}

function getWireRoutePoints(wire, p1, p2) {
  return [p1, ...getWireWaypoints(wire), p2];
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
  const routePoints = getWireRoutePoints(wire, p1, p2);
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
    const def = SIM_COMPONENTS[c.type];
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
    for (const point of getWireWaypoints(w)) grow(point.x, point.y);
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
  const components = (Array.isArray(source.components) ? source.components : []).filter((component) => {
    if (
      !component ||
      typeof component !== "object" ||
      Array.isArray(component) ||
      !validId(component.id) ||
      componentsById.has(component.id) ||
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
    return true;
  });
  const wires = (Array.isArray(source.wires) ? source.wires : []).filter((wire) => {
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
      const definition = component && SIM_COMPONENTS[component.type];
      return Boolean(definition && definition.pins.some((pin) => pin.id === end.pin));
    };
    return Boolean(
      wire &&
        typeof wire === "object" &&
        !Array.isArray(wire) &&
        validEndpoint(wire.from) &&
        validEndpoint(wire.to)
    );
  });
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
