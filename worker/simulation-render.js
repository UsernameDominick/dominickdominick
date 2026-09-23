// Component library for the simulation builder/renderer. This is an
// intentionally simple "animated diagram" system, not an electrically
// accurate simulator: each component has a manually-set "powered"
// flag and each wire a manually-set "animated" flag, and a single
// power toggle on the public page flips a CSS class that changes
// their appearance. There's no computed circuit continuity.
//
// Kept in sync by hand with public/admin/sim-components.js, which
// defines the identical registry for the admin builder (a plain
// script can't import this ES module, and vice versa).

function escXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const SIM_COMPONENTS = {
  breadboard: {
    label: "Breadboard",
    w: 340,
    h: 120,
    pins: [0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => [
      { id: `t${i + 1}`, x: 20 + i * 40, y: 15 },
      { id: `b${i + 1}`, x: 20 + i * 40, y: 105 },
    ]),
    render: () => {
      let holes = "";
      for (let i = 0; i < 8; i++) {
        holes += `<circle class="bb-hole" cx="${20 + i * 40}" cy="15" r="2.5"/>`;
        holes += `<circle class="bb-hole" cx="${20 + i * 40}" cy="105" r="2.5"/>`;
      }
      return `<rect class="bb-body" x="0" y="0" width="340" height="120" rx="6"/>${holes}`;
    },
  },
  led: {
    label: "LED",
    w: 26,
    h: 40,
    pins: [
      { id: "anode", x: 8, y: 40 },
      { id: "cathode", x: 18, y: 40 },
    ],
    render: () =>
      `<path class="led-bulb" d="M4,26 L4,10 A9,9 0 0 1 22,10 L22,26 Z"/><line class="led-lead" x1="8" y1="26" x2="8" y2="40"/><line class="led-lead" x1="18" y1="26" x2="18" y2="40"/>`,
  },
  resistor: {
    label: "Resistor",
    w: 50,
    h: 16,
    pins: [
      { id: "p1", x: 0, y: 8 },
      { id: "p2", x: 50, y: 8 },
    ],
    render: () =>
      `<line class="resistor-lead" x1="0" y1="8" x2="8" y2="8"/><rect class="resistor-body" x="8" y="0" width="34" height="16"/><line class="resistor-lead" x1="42" y1="8" x2="50" y2="8"/>`,
  },
  battery: {
    label: "Battery",
    w: 50,
    h: 26,
    pins: [
      { id: "pos", x: 0, y: 13 },
      { id: "neg", x: 50, y: 13 },
    ],
    render: () =>
      `<rect class="battery-body" x="0" y="0" width="50" height="26" rx="4"/><text class="battery-label" x="25" y="17" text-anchor="middle">+ / -</text>`,
  },
  mcu_teensy: {
    label: "Microcontroller (Teensy)",
    w: 90,
    h: 36,
    pins: Array.from({ length: 8 }).map((_, i) => ({ id: `d${i}`, x: 6 + i * 11, y: 36 })),
    render: (c) =>
      `<rect class="mcu-body" x="0" y="0" width="90" height="36" rx="4"/><text class="mcu-label" x="45" y="21" text-anchor="middle">${escXml(
        c.label || "Teensy"
      )}</text>`,
  },
  tv: {
    label: "TV / Display",
    w: 130,
    h: 84,
    pins: [{ id: "hdmi", x: 0, y: 42 }],
    render: () => `<rect class="tv-body" x="0" y="0" width="130" height="84" rx="6"/><rect class="tv-screen" x="6" y="6" width="118" height="72"/>`,
  },
};

function pinPosition(comp, pinId) {
  const def = SIM_COMPONENTS[comp.type];
  if (!def) return null;
  const pin = def.pins.find((p) => p.id === pinId);
  if (!pin) return null;
  return { x: comp.x + pin.x, y: comp.y + pin.y };
}

function renderComponentSvg(comp) {
  const def = SIM_COMPONENTS[comp.type];
  if (!def) return "";
  return `<g class="sim-comp sim-comp-${escXml(comp.type)}" data-id="${escXml(comp.id)}" data-powered="${
    comp.powered ? "true" : "false"
  }" transform="translate(${comp.x},${comp.y})">${def.render(comp)}</g>`;
}

function renderWireSvg(wire, components) {
  const fromComp = components.find((c) => c.id === wire.from.compId);
  const toComp = components.find((c) => c.id === wire.to.compId);
  if (!fromComp || !toComp) return "";
  const p1 = pinPosition(fromComp, wire.from.pin);
  const p2 = pinPosition(toComp, wire.to.pin);
  if (!p1 || !p2) return "";
  return `<path class="sim-wire sim-wire-${escXml(wire.kind || "wire")}" data-id="${escXml(
    wire.id
  )}" data-animated="${wire.animated ? "true" : "false"}" d="M${p1.x},${p1.y} L${p2.x},${p2.y}"/>`;
}

export function renderSimulationSvg(data, { width = 900, height = 500 } = {}) {
  const components = (data && data.components) || [];
  const wires = (data && data.wires) || [];
  const wiresSvg = wires.map((w) => renderWireSvg(w, components)).join("");
  const compsSvg = components.map((c) => renderComponentSvg(c)).join("");
  return `<svg class="sim-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${wiresSvg}${compsSvg}</svg>`;
}
