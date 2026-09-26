// Mirrors worker/simulation-render.js's SIM_COMPONENTS registry, its
// <defs> gradients, and its topology/electrical-analysis functions — kept
// in sync by hand, since a worker ES module can't be imported by this
// plain script and vice versa. Any new component type, or any change to
// how "powered" or current/voltage is computed, needs to be made in both
// places.
(function () {
  "use strict";

  function escXml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.SIM_DEFS_SVG = `<defs>
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

  window.LED_COLORS = {
    red: { label: "Red", forwardVoltage: 2.0, onColor: "#ff4d3d" },
    yellow: { label: "Yellow", forwardVoltage: 2.1, onColor: "#ffe14d" },
    green: { label: "Green", forwardVoltage: 2.2, onColor: "#4dff6a" },
    blue: { label: "Blue", forwardVoltage: 3.2, onColor: "#4d9dff" },
    white: { label: "White", forwardVoltage: 3.0, onColor: "#fffbe8" },
  };
  const LED_RATED_MA = 20;
  const OUTLET_VOLTAGE = 120;
  const RESISTOR_WATTAGE_RATING = 0.25;
  const TEENSY_LOAD_OHMS = 300;
  // A typical microcontroller board's own power budget (running off 3.3V/
  // 5V, drawing well under a watt) -- feeding it from something like a
  // 12V+ supply through its fixed load model should read as unsafe, the
  // same way an overheating resistor does, not just a bigger harmless
  // number.
  const TEENSY_WATTAGE_RATING = 1;

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

  function resistorBandHexes(ohms) {
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
  window.simResistorBandHexes = resistorBandHexes;

  window.SIM_COMPONENTS = {
    outlet: {
      label: "Wall Outlet",
      w: 40,
      h: 60,
      isSource: true,
      dangerous: true,
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
    // A real half+ breadboard: 30 columns (matching a real 400+
    // tie-point board), with independent power rails on BOTH the top
    // and bottom edges. Each column's 5 physical holes are electrically
    // one point in real life; one hole stands in for the whole column
    // here, but different columns are NOT connected to each other, and
    // the top rails are NOT connected to the bottom rails.
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
      polarity: { pos: "anode", neg: "cathode" },
      // Leads are exactly one breadboard hole-spacing apart (40px), splayed
      // outward from the bulb — so both legs plug into two real, adjacent
      // holes when dropped on the board, not just one anchored pin.
      pins: [
        { id: "anode", x: 0, y: 40 },
        { id: "cathode", x: 40, y: 40 },
      ],
      render: (c) => {
        const color = window.LED_COLORS[c.color] ? c.color : "red";
        return `<g style="--led-on-color:${window.LED_COLORS[color].onColor}"><line class="led-lead" x1="15" y1="26" x2="0" y2="40"/><line class="led-lead" x1="25" y1="26" x2="40" y2="40"/><ellipse class="led-flange" cx="20" cy="26" rx="10" ry="2.5"/><path class="led-bulb" d="M11,26 L11,10 A9,9 0 0 1 29,10 L29,26 Z"/><path class="led-shine" d="M15,14 A5,5 0 0 1 21,10"/></g>`;
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
    // covers the current-measurement half of "voltage/current meter"
    // that fits the existing analysis for free.
    ammeter: {
      label: "Ammeter",
      w: 40,
      // Taller than the switch it otherwise mirrors (h:20) so the live
      // current reading (see renderComponentSvg in both this file and
      // worker/simulation-render.js) has room within the part's own
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
        // `Number(x) ?? 50` was dead-fallback code -- Number() never
        // returns null/undefined, only a number or NaN, and `NaN ?? 50` is
        // still NaN (NaN is not nullish). A missing/non-numeric wiper (an
        // imported or hand-edited simulation) silently produced "NaNΩ" on
        // the label and a NaN resistance value feeding the electrical
        // analysis. Number.isFinite() is the check that actually catches
        // NaN and falls back correctly, while still preserving an explicit
        // 0 (unlike `|| 50`, which would treat 0 as falsy too).
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
    const def = window.SIM_COMPONENTS[comp.type];
    if (def && def.railGroups) {
      for (const rail of Object.keys(def.railGroups)) {
        if (def.railGroups[rail].includes(pinId)) return `${comp.id}:rail:${rail}`;
      }
    }
    return `${comp.id}:${pinId}`;
  }
  window.simNodeId = nodeId;

  function isSwitchClosed(c) {
    return c.closed !== false;
  }
  window.simIsSwitchClosed = isSwitchClosed;

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
      const def = window.SIM_COMPONENTS[c.type];
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

  window.computeSimPoweredSet = function (data) {
    const components = (data && data.components) || [];
    const wires = (data && data.wires) || [];
    const adjacency = buildGraph(data, null);

    const activeSources = [];
    const poweredNodes = new Set();
    components.forEach((c) => {
      const def = window.SIM_COMPONENTS[c.type];
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
      const def = window.SIM_COMPONENTS[c.type];
      if (!def) return;
      if (c.type === "led" && def.polarity) {
        const posNode = nodeId(c, def.polarity.pos);
        const negNode = nodeId(c, def.polarity.neg);
        if (!poweredNodes.has(posNode) || !poweredNodes.has(negNode)) return;
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
  };

  // ---------- Electrical analysis: Ohm's law on top of the topology ----------
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
      const def = window.SIM_COMPONENTS[c.type];
      if (!def) return;
      def.pins.forEach((p) => {
        const n = nodeId(c, p.id);
        if (!adjacency.has(n)) adjacency.set(n, new Set());
      });
      if (c.type === "power_supply") return;
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
        const color = window.LED_COLORS[c.color] ? c.color : "red";
        link(nodeId(c, def.polarity.pos), nodeId(c, def.polarity.neg), {
          compId: c.id,
          kind: "led",
          resistance: 0,
          forwardVoltage: window.LED_COLORS[color].forwardVoltage,
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

  window.computeSimElectricalAnalysis = function (data) {
    const components = (data && data.components) || [];
    const { poweredNodes } = window.computeSimPoweredSet(data);
    const { adjacency, edgeInfo } = buildAnalysisGraph(data);

    const domains = [];
    components.forEach((c) => {
      const def = window.SIM_COMPONENTS[c.type];
      if (!def) return;
      if (c.type === "battery") {
        domains.push({ posNode: nodeId(c, "pos"), negNode: nodeId(c, "neg"), voltage: Number(c.voltage) || 9, dangerous: false });
      } else if (c.type === "outlet") {
        domains.push({ posNode: nodeId(c, "hot"), negNode: nodeId(c, "neutral"), voltage: 120, dangerous: true });
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
      let totalResistance = 0;
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
          // -- a critic pass found the original version multiplied
          // current by the full source voltage, which only happens to
          // equal the teensy's own dissipation when it's the sole
          // resistive element in the loop. With anything else sharing the
          // series path (a current-limiting resistor, a potentiometer, an
          // LED ahead of it), some of that source voltage drops across
          // the OTHER component, not the teensy, so multiplying by the
          // full domain voltage overstated the teensy's own figure by
          // reporting the whole loop's power under its name.
          const amps = currentMa === Infinity ? 0 : currentMa / 1000;
          const watts = amps * amps * TEENSY_LOAD_OHMS;
          const status = domain.dangerous ? "burnt" : watts > TEENSY_WATTAGE_RATING ? "overheating" : "normal";
          results[info.compId] = { kind: "teensy", currentMa, voltage: domain.voltage, watts, status, dangerous: domain.dangerous };
        } else if (info.kind === "ammeter") {
          // Zero resistance, so it never changes what current flows -- it
          // just reports whatever the loop's own analysis already
          // computed at this point on the path, same as a real idealized
          // ammeter should.
          results[info.compId] = { kind: "ammeter", currentMa, status: domain.dangerous ? "burnt" : "normal", dangerous: domain.dangerous };
        }
      });
    });

    return results;
  };
})();
