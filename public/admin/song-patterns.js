// Pattern helpers for the song builder: Euclidean rhythms and starter beats for the drums, and shift, reverse, chord, arpeggio and random
// tools for the melody. Pure (no DOM), so a node test can load it.
(function () {
  // Spread `hits` hits as evenly as possible over `steps` steps (the "Euclidean" rhythm: 3 in 8 is x..x..x.), then turn it `rotate`
  // steps later. Returns an array of booleans.
  function euclideanRow(hits, steps, rotate) {
    const n = Math.max(1, Math.floor(Number(steps)) || 16);
    const k = Math.max(0, Math.min(n, Math.floor(Number(hits)) || 0));
    const r = Math.floor(Number(rotate)) || 0;
    const row = Array.from({ length: n }, (_, i) => (i * k) % n < k);
    return row.map((_, i) => row[(((i - r) % n) + n) % n]);
  }

  // Starter beats over 16 steps: "x" is a hit, "." a rest. Rows a beat doesn't list are left empty.
  const STARTERS = [
    { id: "four-floor", label: "Four on the floor", rows: { kick: "x...x...x...x...", clap: "....x.......x...", hihat: "..x...x...x...x." } },
    { id: "rock", label: "Rock backbeat", rows: { kick: "x.......x.x.....", snare: "....x.......x...", hihat: "x.x.x.x.x.x.x.x." } },
    { id: "boom-bap", label: "Hip-hop boom bap", rows: { kick: "x.....x...x.....", snare: "....x.......x...", hihat: "x.x.x.x.x.x.x.x." } },
    { id: "half-time", label: "Half-time", rows: { kick: "x.........x.....", snare: "........x.......", hihat: "x.x.x.x.x.x.x.x." } },
    { id: "trap", label: "Trap", rows: { kick: "x.....x...x.....", snare: "........x.......", clap: "........x.......", hihat: "xxxxxxxxxxxxxxxx" } },
    { id: "dembow", label: "Reggaeton dembow", rows: { kick: "x...x...x...x...", snare: "...x..x....x..x.", hihat: "x.x.x.x.x.x.x.x." } },
    { id: "breakbeat", label: "Breakbeat", rows: { kick: "x.x.......x.x...", snare: "....x..x.x..x...", hihat: "x.x.x.x.x.x.x.x." } },
    // These use the extra drum voices; applying one to all drums adds the rows it needs.
    { id: "disco", label: "Disco (open hats)", rows: { kick: "x...x...x...x...", clap: "....x.......x...", hihat: "x.x.x.x.x.x.x.x.", openhat: "..x...x...x...x." } },
    { id: "bossa", label: "Bossa nova (rim clave)", rows: { kick: "x..x..x...x..x..", rim: "x..x..x...x..x..", hihat: "x.x.x.x.x.x.x.x." } },
    { id: "tom-groove", label: "Tom groove", rows: { kick: "x.......x.......", snare: "....x.......x...", tom: "..x..x....x.x...", hihat: "x.x.x.x.x.x.x.x.", crash: "x..............." } },
  ];

  // One row of a starter beat as booleans (all false for a row the beat doesn't list or an unknown beat), resized to `steps`.
  function starterRow(id, track, steps) {
    const beat = STARTERS.find((b) => b.id === id);
    const text = (beat && beat.rows[track]) || "";
    const n = Math.max(1, Math.floor(Number(steps)) || 16);
    return Array.from({ length: n }, (_, i) => text[i % 16] === "x" && i < 16);
  }


  // ---------- Melody tools ----------
  // The melody is { "C4": [step values...], ... }, one row per piano roll note. Every function here returns a fresh object and leaves
  // its input alone; step values (true, or whatever the row holds) are carried across unchanged by the tools that only move notes.
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const CHORDS = {
    major: { label: "Major", intervals: [0, 4, 7] },
    minor: { label: "Minor", intervals: [0, 3, 7] },
    dim: { label: "Diminished", intervals: [0, 3, 6] },
    sus4: { label: "Suspended 4th", intervals: [0, 5, 7] },
    dom7: { label: "Dominant 7th", intervals: [0, 4, 7, 10] },
    maj7: { label: "Major 7th", intervals: [0, 4, 7, 11] },
    min7: { label: "Minor 7th", intervals: [0, 3, 7, 10] },
  };
  const ARPEGGIO_PATTERNS = { up: "Up", down: "Down", updown: "Up and down" };

  // A note's height as one number (C0 is 0), or null for something that is not a note name.
  function noteValue(name) {
    const m = /^([A-G]#?)(\d+)$/.exec(String(name));
    return m ? Number(m[2]) * 12 + NOTE_NAMES.indexOf(m[1]) : null;
  }
  const stepCount = (steps) => Math.max(1, Math.floor(Number(steps)) || 16);
  const emptyMelody = (allNames, steps) => {
    const out = {};
    allNames.forEach((n) => (out[n] = new Array(steps).fill(false)));
    return out;
  };
  const rowOf = (notes, name, steps) => Array.from({ length: steps }, (_, i) => (notes && notes[name] ? notes[name][i] || false : false));

  // Every note moved `by` steps later (negative: earlier); what falls off one end wraps to the other.
  function rotateMelody(notes, by, steps) {
    const n = stepCount(steps);
    const r = Math.floor(Number(by)) || 0;
    const out = {};
    for (const name of Object.keys(notes || {})) {
      const row = rowOf(notes, name, n);
      out[name] = row.map((_, i) => row[(((i - r) % n) + n) % n]);
    }
    return out;
  }

  // The melody played backwards: the last step becomes the first.
  function reverseMelody(notes, steps) {
    const n = stepCount(steps);
    const out = {};
    for (const name of Object.keys(notes || {})) out[name] = rowOf(notes, name, n).reverse();
    return out;
  }

  // ---- held notes (ties) ----
  // melody.ties is { "C4": [step flags...] }: a true at index i joins step i to the same note on step i - 1 (the two are one held note).
  // A flag is only meaningful when the note is on at both steps and i is not the first step, so cleanTies drops the rest.
  function cleanTies(notes, ties, steps) {
    const n = stepCount(steps);
    const out = {};
    for (const name of Object.keys(ties || {})) {
      const row = notes && notes[name];
      if (!row || !Array.isArray(ties[name])) continue;
      const flags = Array.from({ length: n }, (_, i) => i > 0 && ties[name][i] === true && Boolean(row[i]) && Boolean(row[i - 1]));
      if (flags.some(Boolean)) out[name] = flags;
    }
    return out;
  }
  const hasTies = (ties) => Object.values(ties || {}).some((row) => Array.isArray(row) && row.some((v) => v === true));
  // Ties after the notes were moved `by` steps later: they travel with their notes, and a tie that would straddle the end of the
  // loop is dropped by cleanTies.
  function rotateTies(ties, by, steps) {
    const n = stepCount(steps);
    const r = Math.floor(Number(by)) || 0;
    const out = {};
    for (const name of Object.keys(ties || {})) {
      const row = Array.from({ length: n }, (_, i) => ties[name] && ties[name][i] === true);
      out[name] = row.map((_, i) => row[(((i - r) % n) + n) % n]);
    }
    return out;
  }
  // Ties after the melody was played backwards: the link between steps i - 1 and i becomes the link between n - i - 1 and n - i.
  function reverseTies(ties, steps) {
    const n = stepCount(steps);
    const out = {};
    for (const name of Object.keys(ties || {})) {
      const row = Array.from({ length: n }, (_, i) => ties[name] && ties[name][i] === true);
      out[name] = Array.from({ length: n }, (_, i) => (i === 0 ? false : row[n - i]));
    }
    return out;
  }
  // Ties for every note that is struck on two steps in a row, so each such run becomes one held note.
  function tieRepeats(notes, steps) {
    const n = stepCount(steps);
    const out = {};
    for (const name of Object.keys(notes || {})) {
      const row = rowOf(notes, name, n);
      const flags = row.map((on, i) => i > 0 && Boolean(on) && Boolean(row[i - 1]));
      if (flags.some(Boolean)) out[name] = flags;
    }
    return out;
  }

  // The notes of a chord on `rootName`, lowest first, limited to the names the piano roll has. `missing` counts chord tones that would
  // sit outside the roll.
  function chordNames(rootName, type, allNames) {
    const chord = CHORDS[type];
    const root = noteValue(rootName);
    if (!chord || root === null) return { names: [], missing: 0 };
    const byValue = new Map((allNames || []).map((n) => [noteValue(n), n]));
    const names = [];
    let missing = 0;
    for (const interval of chord.intervals) {
      const found = byValue.get(root + interval);
      if (found) names.push(found);
      else missing++;
    }
    return { names, missing };
  }

  // The same melody with the chord's notes switched on at one step (counting from 0).
  function stampChord(notes, names, step, steps) {
    const n = stepCount(steps);
    const s = Math.floor(Number(step));
    const out = {};
    for (const name of Object.keys(notes || {})) out[name] = rowOf(notes, name, n);
    if (Number.isInteger(s) && s >= 0 && s < n) for (const name of names || []) if (out[name]) out[name][s] = true;
    return out;
  }

  // A fresh melody that plays the chord one note at a time, one note every `every` steps from the first step, over `steps` steps.
  // pattern: "up" (low to high), "down", or "updown" (up, then back down without repeating the top or bottom note).
  function arpeggioMelody(allNames, chord, pattern, every, steps) {
    const n = stepCount(steps);
    const gap = Math.max(1, Math.floor(Number(every)) || 1);
    const ascending = [...(chord || [])].sort((a, b) => noteValue(a) - noteValue(b));
    const out = emptyMelody(allNames, n);
    if (!ascending.length) return out;
    let cycle = ascending;
    if (pattern === "down") cycle = [...ascending].reverse();
    else if (pattern === "updown" && ascending.length > 2) cycle = [...ascending, ...ascending.slice(1, -1).reverse()];
    for (let step = 0, k = 0; step < n; step += gap, k++) {
      const name = cycle[k % cycle.length];
      if (out[name]) out[name][step] = true;
    }
    return out;
  }

  // The piano roll notes that belong to a scale (a root name like "D" and semitone offsets from it), lowest first.
  function scalePool(allNames, rootName, intervals) {
    const root = NOTE_NAMES.indexOf(rootName);
    if (root < 0 || !Array.isArray(intervals) || !intervals.length) return [];
    return (allNames || [])
      .filter((name) => {
        const v = noteValue(name);
        return v !== null && intervals.includes(((v % 12) - root + 12) % 12);
      })
      .sort((a, b) => noteValue(a) - noteValue(b));
  }

  // A fresh melody of one note at a time wandering through `pool` (lowest first): each step is a rest or a note, and a note usually sits
  // within two scale notes of the one before, so it sounds like a tune and not like noise. `rng` returns 0 up to 1 (Math.random).
  function randomMelody(allNames, pool, steps, { density = 0.6, rng = Math.random } = {}) {
    const n = stepCount(steps);
    const out = emptyMelody(allNames, n);
    const notes = (pool || []).filter((name) => out[name]);
    if (!notes.length) return out;
    const chance = Math.max(0, Math.min(1, Number(density)));
    const move = [-2, -1, -1, 0, 1, 1, 2];
    let at = Math.floor(rng() * notes.length) % notes.length;
    for (let step = 0; step < n; step++) {
      if (rng() >= chance) continue;
      out[notes[at]][step] = true;
      at = Math.max(0, Math.min(notes.length - 1, at + move[Math.floor(rng() * move.length) % move.length]));
    }
    return out;
  }

  window.SongPatterns = { euclideanRow, STARTERS, starterRow, CHORDS, ARPEGGIO_PATTERNS, noteValue, rotateMelody, reverseMelody, cleanTies, hasTies, rotateTies, reverseTies, tieRepeats, chordNames, stampChord, arpeggioMelody, scalePool, randomMelody };
})();
