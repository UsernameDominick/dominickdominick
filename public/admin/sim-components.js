// Mirrors worker/simulation-render.js's SIM_COMPONENTS registry and its
// computePoweredSet() function — kept in sync by hand, since a worker ES
// module can't be imported by this plain script and vice versa. Any new
// component type, or any change to how "powered" is computed, needs to be
// made in both places.
(function () {
  "use strict";

  function escXml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.SIM_COMPONENTS = {
    outlet: {
      label: "Wall Outlet",
      w: 40,
      h: 60,
      isSource: true,
      pins: [{ id: "plug", x: 20, y: 60 }],
      render: () =>
        `<rect class="outlet-body" x="0" y="0" width="40" height="60" rx="4"/><rect class="outlet-slot" x="10" y="16" width="4" height="14"/><rect class="outlet-slot" x="26" y="16" width="4" height="14"/><circle class="outlet-ground" cx="20" cy="42" r="3"/>`,
    },
    power_supply: {
      label: "Power Supply",
      w: 70,
      h: 40,
      pins: [
        { id: "in", x: 0, y: 20 },
        { id: "out", x: 70, y: 20 },
      ],
      render: () => `<rect class="ps-body" x="0" y="0" width="70" height="40" rx="4"/><text class="ps-label" x="35" y="24" text-anchor="middle">PSU</text>`,
    },
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
      isSource: true,
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
      render: () =>
        `<rect class="tv-body" x="0" y="0" width="130" height="84" rx="6"/><rect class="tv-screen" x="6" y="6" width="118" height="72"/>`,
    },
  };

  // Everything wired (directly or transitively) to an outlet or battery is
  // "powered" — a plain graph-reachability walk, nothing more.
  window.computeSimPoweredSet = function (data) {
    const components = (data && data.components) || [];
    const wires = (data && data.wires) || [];
    const adjacency = new Map();
    const link = (a, b) => {
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      adjacency.get(a).add(b);
    };
    wires.forEach((w) => {
      link(w.from.compId, w.to.compId);
      link(w.to.compId, w.from.compId);
    });

    const poweredComps = new Set();
    const queue = [];
    components.forEach((c) => {
      const def = window.SIM_COMPONENTS[c.type];
      if (def && def.isSource) {
        poweredComps.add(c.id);
        queue.push(c.id);
      }
    });
    while (queue.length) {
      const current = queue.shift();
      const neighbors = adjacency.get(current);
      if (!neighbors) continue;
      neighbors.forEach((n) => {
        if (!poweredComps.has(n)) {
          poweredComps.add(n);
          queue.push(n);
        }
      });
    }

    const poweredWires = new Set();
    wires.forEach((w) => {
      if (poweredComps.has(w.from.compId) && poweredComps.has(w.to.compId)) poweredWires.add(w.id);
    });

    return { poweredComps, poweredWires };
  };
})();
