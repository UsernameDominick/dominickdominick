// The rules of playing live in the Studio, with no page in them so a node test can load them: how fast an arpeggio or a roll runs, which
// note comes next, how a chord is strummed, how hard a drum pad is hit, and how far the pitch wheel bends. Notes are MIDI numbers here
// (60 = C4); the Studio turns names into numbers and back. `window.SongLive`.
(function () {
  "use strict";
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  // Rates are fractions of a whole note's quarter: "1/4" is a beat, "1/32" is a roll. The triplet is three to a beat.
  const RATES = { "1/4": 1, "1/8": 2, "1/16": 4, "1/32": 8, "1/16T": 6 };
  const RATE_LABELS = { "1/4": "1/4", "1/8": "1/8", "1/16": "1/16", "1/32": "1/32 roll", "1/16T": "1/16 triplet" };
  const rateSeconds = (tempo, rate) => 60 / clamp(Number(tempo) || 120, 30, 300) / (RATES[rate] || RATES["1/16"]);

  const CHORDS = {
    major: { label: "Major", steps: [0, 4, 7] },
    minor: { label: "Minor", steps: [0, 3, 7] },
    dom7: { label: "Seventh", steps: [0, 4, 7, 10] },
    maj7: { label: "Major 7th", steps: [0, 4, 7, 11] },
    min7: { label: "Minor 7th", steps: [0, 3, 7, 10] },
    sus2: { label: "Sus 2", steps: [0, 2, 7] },
    sus4: { label: "Sus 4", steps: [0, 5, 7] },
    power: { label: "Power", steps: [0, 7, 12] },
    dim: { label: "Diminished", steps: [0, 3, 6] },
  };
  const chordNotes = (root, type) => (CHORDS[type] || CHORDS.major).steps.map((s) => root + s);

  // When each note of a strummed chord sounds, in seconds after the press. `dir`: "down" goes low to high, "up" high to low, "alt" swaps on
  // every strum (`n` counts them). Returns [{ i, at }] in the order they sound, i indexing the chord from its lowest note.
  function strumPlan(count, spreadMs, dir, n) {
    const gap = clamp(Number(spreadMs) || 0, 0, 400) / 1000 / Math.max(1, count - 1 || 1);
    const down = dir === "up" ? false : dir === "alt" ? (n || 0) % 2 === 0 : true;
    const out = [];
    for (let k = 0; k < count; k++) out.push({ i: down ? k : count - 1 - k, at: k * gap });
    return out;
  }

  // The notes an arpeggio runs through, from what is held. Spread over `octaves` (1 to 3), each pass an octave higher.
  const PATTERNS = { up: "Up", down: "Down", updown: "Up and down", random: "Random", played: "As played" };
  function arpCycle(held, pattern, octaves) {
    const base = held.slice();
    if (!base.length) return [];
    if (pattern !== "played") base.sort((a, b) => a - b);
    let up = [];
    for (let o = 0; o < clamp(Math.round(octaves) || 1, 1, 3); o++) base.forEach((m) => up.push(m + 12 * o));
    if (pattern === "down") return up.reverse();
    if (pattern === "updown") return up.length > 2 ? up.concat(up.slice(1, -1).reverse()) : up;
    return up;
  }
  // The note for tick `i` of the arpeggio: the cycle in order, or any of its notes (never the same one twice running when there is a choice)
  // for "random".
  function arpPick(held, pattern, octaves, i, rng, previous) {
    const cycle = arpCycle(held, pattern, octaves);
    if (!cycle.length) return null;
    if (pattern !== "random") return cycle[((i % cycle.length) + cycle.length) % cycle.length];
    if (cycle.length === 1) return cycle[0];
    let pick = cycle[Math.floor((rng || Math.random)() * cycle.length)];
    if (pick === previous) pick = cycle[(cycle.indexOf(pick) + 1) % cycle.length];
    return pick;
  }

  // How hard a drum pad is struck, 0.3 to 1. A pen reports pressure; a mouse or a finger does not, so where on the pad it lands says it: the
  // top edge is soft, the bottom hard.
  function padVelocity(o) {
    const pressure = Number(o.pressure);
    if (o.pointerType === "pen" && pressure > 0 && pressure !== 0.5) return clamp(0.25 + 0.75 * pressure, 0.3, 1);
    const h = Number(o.h) || 1;
    return clamp(0.3 + 0.7 * clamp((Number(o.y) || 0) / h, 0, 1), 0.3, 1);
  }
  // A roll (a held pad that repeats): the strength of hit `i`. With swell it builds from soft to the full strength over eight hits; without,
  // every other hit is a touch softer, which is what makes a hat roll sound played rather than machine-gunned.
  function rollVelocity(i, swell, base) {
    const v = clamp(Number(base) || 1, 0.3, 1);
    if (swell) return clamp(v * (0.5 + 0.5 * Math.min(1, i / 8)), 0.15, 1);
    return clamp(i % 2 ? v * 0.85 : v, 0.15, 1);
  }

  // The pitch wheel: -1 to 1 bends by `range` semitones (default 2); the result is in cents.
  const bendCents = (wheel, range) => Math.round(clamp(Number(wheel) || 0, -1, 1) * clamp(Number(range) > 0 ? Number(range) : 2, 0.5, 12) * 100);

  // Play settings kept in the browser, cleaned on the way in.
  const DEFAULTS = { mode: "off", padMode: "off", rate: "1/16", pattern: "up", octaves: 1, gate: 0.6, chord: "major", spread: 70, dir: "down", swell: false, bendRange: 2 };
  function cleanPlay(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    return {
      mode: ["off", "arp", "strum", "random"].includes(r.mode) ? r.mode : DEFAULTS.mode,
      padMode: ["off", "roll"].includes(r.padMode) ? r.padMode : DEFAULTS.padMode,
      rate: RATES[r.rate] ? r.rate : DEFAULTS.rate,
      pattern: PATTERNS[r.pattern] ? r.pattern : DEFAULTS.pattern,
      octaves: clamp(Math.round(Number(r.octaves)) || 1, 1, 3),
      gate: clamp(Number(r.gate) || DEFAULTS.gate, 0.1, 1),
      chord: CHORDS[r.chord] ? r.chord : DEFAULTS.chord,
      spread: clamp(Math.round(Number(r.spread)) || DEFAULTS.spread, 10, 400),
      dir: ["down", "up", "alt"].includes(r.dir) ? r.dir : DEFAULTS.dir,
      swell: r.swell === true,
      bendRange: clamp(Number(r.bendRange) > 0 ? Number(r.bendRange) : 2, 0.5, 12),
    };
  }

  // When a key, pad or MIDI note was pressed, as a moment on the audio clock, in the terms of what the player HEARD. ctx.currentTime is the
  // moment the sound is being made; what reaches the ears is later by the output latency (a phone speaker, a Bluetooth headset), and a
  // player taps in time with what they hear, so a press compared with currentTime lands a step early or late. getOutputTimestamp() pairs the
  // clock time that is coming out of the speakers right now with a performance.now() time: a press with its own timestamp (a MIDI message,
  // an event) maps straight onto it, which also removes the delay of waiting in the page's event queue. Without it (older Safari) the
  // reported output latency is taken off instead. Never more than MAX_LAG from the render clock, so a wild report cannot throw a note away.
  const MAX_LAG = 0.25;
  const positive = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  function pressTime(ctx, stamp) {
    const render = Number(ctx && ctx.currentTime) || 0;
    if (ctx && typeof ctx.getOutputTimestamp === "function" && Number.isFinite(stamp)) {
      let ts = null;
      try {
        ts = ctx.getOutputTimestamp();
      } catch (e) {
        ts = null;
      }
      if (ts && positive(ts.performanceTime) && Number.isFinite(ts.contextTime) && ts.contextTime > 0) {
        const t = ts.contextTime + (stamp - ts.performanceTime) / 1000;
        if (Math.abs(t - render) <= MAX_LAG) return t;
      }
    }
    const lag = positive(ctx && ctx.outputLatency) || positive(ctx && ctx.baseLatency);
    return render - Math.min(lag, MAX_LAG);
  }

  window.SongLive = { pressTime, RATES, RATE_LABELS, CHORDS, PATTERNS, DEFAULTS, rateSeconds, chordNotes, strumPlan, arpCycle, arpPick, padVelocity, rollVelocity, bendCents, cleanPlay };
})();
