// Schematic symbols for the Simulation builder and the public page. Shared by both (the admin loads this file with a script
// tag, the worker imports it), so a part looks the same wherever it is drawn. Each symbol is drawn inside the same box as the
// part's pictorial art, with its leads ending exactly on the part's pins, so wires, rotation, mirroring and hit-testing need
// nothing extra: sim-components.js and simulation-render.js draw both versions into every part and CSS shows one of them.
// Parts with no entry here (breadboard, microcontroller, TV, logic gates, which already are symbols) look the same in both views.
(function (root) {
  "use strict";

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const trim = (n) => String(Math.round(n * 100) / 100);
  // The largest unit whose value still rounds to at least 1 (so 999.999 µF reads 1 mF).
  function scaled(base, units) {
    for (let i = units.length - 1; i > 0; i--) {
      const value = base / units[i][1];
      if (Math.round(value * 100) / 100 >= 1) return `${trim(value)}${units[i][0]}`;
    }
    return `${trim(base / units[0][1])}${units[0][0]}`;
  }
  const OHMS = [["Ω", 1], ["kΩ", 1e3], ["MΩ", 1e6]];
  const FARADS = [["pF", 1], ["nF", 1e3], ["µF", 1e6], ["mF", 1e9], ["F", 1e12]];
  const HENRIES = [["nH", 1], ["µH", 1e3], ["mH", 1e6], ["H", 1e9]];
  // A stored value that is missing, not a number, or absurd falls back or is capped, like the part's own drawing does.
  const positive = (value, fallback, max = 1e9) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.min(Number(value), max) : fallback);

  const line = (d, cls = "") => `<path class="sch-line${cls ? " " + cls : ""}" d="${d}"/>`;
  const dot = (x, y) => `<circle class="sch-dot" cx="${x}" cy="${y}" r="2.4"/>`;
  const hit = (w, h) => `<rect class="sch-hit" x="0" y="0" width="${w}" height="${h}" fill="transparent"/>`;
  // x, y and font-size are always written out: keepTextUpright() in the renderers reads them to keep labels readable when a part is rotated.
  const text = (x, y, size, value, cls = "sch-text") => `<text class="${cls}" x="${x}" y="${y}" text-anchor="middle" style="text-anchor:middle" font-size="${size}">${esc(value)}</text>`;
  // At a quarter turn a label under the symbol would land on it, so it is anchored beside the part instead (the same rule the
  // pictorial art uses): `turnedY` is where it sits when the part is turned 90 or 270 degrees.
  const labelNear = (c, x, upright, turnedY, size, value) => {
    const rotation = c && c.rotation;
    const anchor = rotation === 90 ? "end" : rotation === 270 ? "start" : "middle";
    const y = anchor === "middle" ? upright : turnedY;
    return `<text class="sch-text" x="${x}" y="${y}" text-anchor="${anchor}" style="text-anchor:${anchor}" font-size="${size}">${esc(value)}</text>`;
  };
  const ZIGZAG = (y) => `L14,${y} L18,${y - 6} L26,${y + 6} L34,${y - 6} L42,${y + 6} L50,${y - 6} L58,${y + 6} L62,${y}`;

  const symbols = {
    resistor: (c) => `${hit(80, 16)}${line(`M0,8 ${ZIGZAG(8)} L80,8`)}${text(40, 28, 8, scaled(Math.max(1, positive(c.resistance, 220)), OHMS))}`,

    potentiometer: (c) => {
      const raw = Number(c.wiper);
      const pct = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 50));
      const maxR = Math.max(1, positive(c.maxResistance, 10000));
      const wx = 14 + 48 * (pct / 100);
      return `${hit(80, 32)}${line(`M0,16 ${ZIGZAG(16)} L80,16`)}${line(`M${wx},1 L${wx},9`)}<polygon class="sch-fill" points="${wx - 3},8 ${wx + 3},8 ${wx},13"/>${labelNear(c, 40, 31, 27, 8, scaled(Math.max(1, Math.round(maxR * (pct / 100))), OHMS))}`;
    },

    capacitor: (c) => `${hit(40, 36)}${line("M0,12 L17,12")}${line("M17,3 L17,21", "sch-plate")}${line("M23,3 L23,21", "sch-plate")}${line("M23,12 L40,12")}${labelNear(c, 20, 33, 27.8, 8, scaled(positive(c.capacitance, 100) * 1e6, FARADS))}`,

    inductor: (c) => `${hit(80, 36)}${line("M0,12 L10,12 a7.5,7.5 0 0 1 15,0 a7.5,7.5 0 0 1 15,0 a7.5,7.5 0 0 1 15,0 a7.5,7.5 0 0 1 15,0 L80,12")}${text(40, 33, 8, scaled(positive(c.inductance, 10) * 1e6, HENRIES))}`,

    switch: (c) =>
      `${hit(40, 20)}${line("M0,10 L8,10")}${line("M32,10 L40,10")}${dot(8, 10)}${dot(32, 10)}${c.closed === false ? line("M8,10 L29,1") : line("M8,10 L32,10")}`,

    switch_spdt: (c) =>
      `${hit(40, 40)}${line("M0,20 L8,20")}${line("M32,10 L40,10")}${line("M32,30 L40,30")}${dot(8, 20)}${dot(32, 10)}${dot(32, 30)}${c.position === "b" ? line("M8,20 L30,29") : line("M8,20 L30,11")}`,

    battery: (c) =>
      `${hit(50, 26)}${line("M0,13 L13,13")}${line("M13,2 L13,24", "sch-plate")}${line("M19,7 L19,19", "sch-plate")}${line("M25,2 L25,24", "sch-plate")}${line("M31,7 L31,19", "sch-plate")}${line("M31,13 L50,13")}${text(6, 10, 8, "+")}${text(41, 9, 8, `${trim(positive(c.voltage, 9, 1e6))}V`)}`,

    power_supply: (c) =>
      `${hit(70, 40)}<rect class="sch-line" x="12" y="2" width="46" height="36" rx="3"/>${line("M0,12 L12,12")}${line("M0,28 L12,28")}${line("M58,12 L70,12")}${line("M58,28 L70,28")}${text(35, 17, 9, "AC/DC")}${text(35, 31, 8, `${trim(positive(c.outputVoltage, 5, 1e6))}V`)}${text(64, 10, 8, "+")}${text(64, 26, 8, "−")}`,

    outlet: () =>
      `${hit(40, 60)}<circle class="sch-line" cx="20" cy="22" r="16"/>${line("M14,60 L14,36.8")}${line("M26,60 L26,36.8")}${line("M11,22 q4.5,-8 9,0 t9,0")}${text(20, 4, 7, "120V AC")}`,

    led: (c, ctx) =>
      `<g style="--led-on-color:${esc((ctx && ctx.ledOnColor) || "#ff5a4d")}">${hit(40, 40)}${line("M0,40 L0,28 L12,28")}${line("M28,28 L40,28 L40,40")}<polygon class="sch-line sch-led-body" points="12,18 12,38 28,28"/>${line("M28,18 L28,38", "sch-plate")}${line("M21,14 L30,5 M25.5,5 L30,5 L30,9.5")}${line("M26,17 L35,8 M30.5,8 L35,8 L35,12.5")}</g>`,

    diode: () =>
      `${hit(40, 40)}${line("M0,40 L0,28 L12,28")}${line("M28,28 L40,28 L40,40")}<polygon class="sch-line sch-diode-body" points="12,18 12,38 28,28"/>${line("M28,18 L28,38", "sch-plate")}`,

    // The lamp: a circle with a cross through it (the standard symbol), leads out to its two pins.
    lamp: () =>
      `${hit(40, 40)}${line("M0,40 L0,22 L8,22")}${line("M32,22 L40,22 L40,40")}<circle class="sch-line sch-lamp-body" cx="20" cy="22" r="12"/>${line("M11.5,13.5 L28.5,30.5")}${line("M28.5,13.5 L11.5,30.5")}`,

    // The buzzer: a circle marked BZ (its usual reference letters), leads out to its two pins.
    buzzer: () =>
      `${hit(40, 40)}${line("M0,40 L0,22 L8,22")}${line("M32,22 L40,22 L40,40")}<circle class="sch-line sch-buzzer-body" cx="20" cy="22" r="12"/>${text(20, 25.5, 9, "BZ")}`,

    transistor: (c) => {
      const pnp = c && c.polarity === "pnp";
      const arrow = pnp ? "25.7,45.6 22.8,39.8 29.1,41.6" : "28.7,48.4 35,50.2 32.1,44.4";
      return `${hit(40, 60)}<circle class="sch-line" cx="23" cy="30" r="17"/>${line("M0,30 L17,30")}${line("M17,18 L17,42", "sch-plate")}${line("M17,25 L40,6 L40,0")}${line("M17,35 L40,54 L40,60")}<polygon class="sch-fill" points="${arrow}"/>${text(8, 55, 7, pnp ? "PNP" : "NPN")}`;
    },
  };

  // The three meters are circles with a letter; their live readings are drawn by the renderers below the symbol.
  const meter = (letter, marks) => () =>
    `${hit(40, 34)}<circle class="sch-line" cx="20" cy="10" r="10"/>${line("M0,10 L10,10")}${line("M30,10 L40,10")}${text(20, 14, 11, letter, "sch-text sch-meter-letter")}${marks ? text(6, 7, 8, "+") + text(34, 7, 8, "−") : ""}`;
  symbols.ammeter = meter("A", false);
  symbols.voltmeter = meter("V", true);
  symbols.ohmmeter = meter("Ω", false);

  root.SimSchematic = { symbols };
})(typeof window !== "undefined" ? window : globalThis);
