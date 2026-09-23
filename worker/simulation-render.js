// Component library for the simulation builder/renderer. This is a
// wiring-accurate *diagram*, not an electrically accurate simulator: it
// has no notion of voltage, current, or resistance. What it DOES model
// for real is topology: a part only lights up if it's on a genuinely
// closed loop back to a power source (outlet or battery) — not just
// "reachable" from one. An open circuit (a dangling wire with no return
// path) lights nothing, and a backwards LED (wired with the wrong
// terminal toward the source's positive side) won't light even though
// it's fully wired into an otherwise-working loop, the same way a real
// one wouldn't.
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

export const SIM_COMPONENTS = {
  outlet: {
    label: "Wall Outlet",
    w: 40,
    h: 60,
    isSource: true,
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
    // Passes AC in through to DC out — it doesn't generate power itself,
    // so the loop still has to close somewhere downstream of it.
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
    render: () =>
      `<rect class="ps-body" x="0" y="0" width="70" height="40" rx="4"/><rect class="ps-vent" x="24" y="8" width="24" height="3" rx="1"/><rect class="ps-vent" x="24" y="14" width="24" height="3" rx="1"/><rect class="ps-vent" x="24" y="20" width="24" height="3" rx="1"/><circle class="ps-indicator" cx="58" cy="32" r="3"/><text class="ps-label" x="35" y="38" text-anchor="middle" font-size="8">PSU</text>`,
  },
  breadboard: {
    label: "Breadboard",
    w: 340,
    h: 120,
    // Every hole in a row is the same electrical rail — a simplified
    // stand-in for a real board's internally-bussed strips.
    railGroups: {
      top: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `t${i + 1}`),
      bottom: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `b${i + 1}`),
    },
    pins: [0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => [
      { id: `t${i + 1}`, x: 20 + i * 40, y: 15 },
      { id: `b${i + 1}`, x: 20 + i * 40, y: 105 },
    ]),
    render: () => {
      let holes = "";
      for (let i = 0; i < 8; i++) {
        holes += `<circle class="bb-hole" cx="${20 + i * 40}" cy="15" r="3"/>`;
        holes += `<circle class="bb-hole" cx="${20 + i * 40}" cy="105" r="3"/>`;
      }
      return `<rect class="bb-body" x="0" y="0" width="340" height="120" rx="6"/><rect class="bb-channel" x="4" y="52" width="332" height="16" rx="3"/>${holes}`;
    },
  },
  led: {
    label: "LED",
    w: 26,
    h: 40,
    // Deliberately NOT passthrough — an LED only conducts anode-to-
    // cathode, so it needs the direction check, not just a connection.
    polarity: { pos: "anode", neg: "cathode" },
    pins: [
      { id: "anode", x: 8, y: 40 },
      { id: "cathode", x: 18, y: 40 },
    ],
    render: () =>
      `<line class="led-lead" x1="8" y1="26" x2="8" y2="40"/><line class="led-lead" x1="18" y1="26" x2="18" y2="40"/><path class="led-bulb" d="M4,26 L4,10 A9,9 0 0 1 22,10 L22,26 Z"/><path class="led-shine" d="M8,14 A5,5 0 0 1 14,10"/>`,
  },
  resistor: {
    label: "Resistor",
    w: 50,
    h: 16,
    passthrough: [["p1", "p2"]],
    pins: [
      { id: "p1", x: 0, y: 8 },
      { id: "p2", x: 50, y: 8 },
    ],
    render: () =>
      `<line class="resistor-lead" x1="0" y1="8" x2="8" y2="8"/><rect class="resistor-body" x="8" y="0" width="34" height="16" rx="3"/><rect class="resistor-band" x="15" y="0" width="3" height="16"/><rect class="resistor-band" x="22" y="0" width="3" height="16"/><rect class="resistor-band" x="29" y="0" width="3" height="16"/><line class="resistor-lead" x1="42" y1="8" x2="50" y2="8"/>`,
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
    render: () =>
      `<rect class="battery-body" x="0" y="0" width="50" height="26" rx="4"/><rect class="battery-cap" x="0" y="9" width="5" height="8"/><rect class="battery-cap" x="45" y="9" width="5" height="8"/><text class="battery-label" x="25" y="17" text-anchor="middle">+ / -</text>`,
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
    if (def.passthrough) def.passthrough.forEach(([a, b]) => link(nodeId(c, a), nodeId(c, b)));
    if (c.type === "led" && def.polarity && c.id !== excludeLedId) {
      link(nodeId(c, def.polarity.pos), nodeId(c, def.polarity.neg));
    }
  });
  wires.forEach((w) => {
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
    const fromComp = components.find((c) => c.id === w.from.compId);
    const toComp = components.find((c) => c.id === w.to.compId);
    if (!fromComp || !toComp) return;
    const a = nodeId(fromComp, w.from.pin);
    const b = nodeId(toComp, w.to.pin);
    if (poweredNodes.has(a) && poweredNodes.has(b)) poweredWires.add(w.id);
  });

  return { poweredComps, poweredWires, poweredNodes };
}

function pinPosition(comp, pinId) {
  const def = SIM_COMPONENTS[comp.type];
  if (!def) return null;
  const pin = def.pins.find((p) => p.id === pinId);
  if (!pin) return null;
  return { x: comp.x + pin.x, y: comp.y + pin.y };
}

function renderComponentSvg(comp, poweredComps) {
  const def = SIM_COMPONENTS[comp.type];
  if (!def) return "";
  return `<g class="sim-comp sim-comp-${escXml(comp.type)}" data-id="${escXml(comp.id)}" data-powered="${
    poweredComps.has(comp.id) ? "true" : "false"
  }" transform="translate(${comp.x},${comp.y})">${def.render(comp)}</g>`;
}

function renderWireSvg(wire, components, poweredWires) {
  const fromComp = components.find((c) => c.id === wire.from.compId);
  const toComp = components.find((c) => c.id === wire.to.compId);
  if (!fromComp || !toComp) return "";
  const p1 = pinPosition(fromComp, wire.from.pin);
  const p2 = pinPosition(toComp, wire.to.pin);
  if (!p1 || !p2) return "";
  // A part snapped directly onto a breadboard hole has a zero-length
  // "wire" (its pin and the hole are the same point) — it's plugged in
  // physically, not cabled, so there's nothing to draw.
  if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 0.5) return "";
  return `<path class="sim-wire sim-wire-${escXml(wire.kind || "wire")}" data-id="${escXml(
    wire.id
  )}" data-animated="${poweredWires.has(wire.id) ? "true" : "false"}" d="M${p1.x},${p1.y} L${p2.x},${p2.y}"/>`;
}

export function renderSimulationSvg(data, { width = 900, height = 500 } = {}) {
  const components = (data && data.components) || [];
  const wires = (data && data.wires) || [];
  const { poweredComps, poweredWires } = computePoweredSet(data);
  const wiresSvg = wires.map((w) => renderWireSvg(w, components, poweredWires)).join("");
  const compsSvg = components.map((c) => renderComponentSvg(c, poweredComps)).join("");
  return `<svg class="sim-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${SIM_DEFS_SVG}${wiresSvg}${compsSvg}</svg>`;
}
