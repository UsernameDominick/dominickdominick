// Ready-made songs for the song builder's "new song" menu: a few complete little arrangements (patterns, a song order, a melody, a bass
// line, mix settings) to start from or to learn from. Pure data plus a builder (no DOM), so a node test can load it; the song comes out
// through SongFiles.cleanSong, so it is exactly what a saved song looks like.
(function () {
  // A lane is 16 characters, one per sixteenth step: x full strength, o medium, g ghost (quiet), . off. In a note lane a "-" holds the
  // note before it (that step is on and tied to the step before, so the two play as one longer note).
  const LEVELS = { x: true, o: 0.65, g: 0.35 };
  const drumLane = (text) => Array.from({ length: 16 }, (_, i) => LEVELS[text[i]] || false);
  function noteLanes(map) {
    const notes = {};
    const ties = {};
    Object.keys(map || {}).forEach((name) => {
      const text = map[name];
      const lane = new Array(16).fill(false);
      const held = new Array(16).fill(false);
      for (let i = 0; i < 16; i++) {
        const c = text[i];
        if (LEVELS[c]) lane[i] = LEVELS[c];
        else if (c === "-" && i > 0 && lane[i - 1]) {
          lane[i] = lane[i - 1];
          held[i] = true;
        }
      }
      notes[name] = lane;
      if (held.some(Boolean)) ties[name] = held;
    });
    return { notes, ties };
  }
  function parts(pattern) {
    const tracks = {};
    Object.keys(pattern.drums || {}).forEach((row) => (tracks[row] = drumLane(pattern.drums[row])));
    const melody = noteLanes(pattern.melody);
    const bass = noteLanes(pattern.bass);
    return { tracks, notes: melody.notes, ties: melody.ties, bass: { notes: bass.notes, ties: bass.ties } };
  }

  // A raw song (pattern A is the song's own parts, B to D go under patterns). Every pattern lists the same drum rows so each row exists
  // everywhere.
  function raw(spec) {
    const names = Object.keys(spec.patterns);
    const rows = [...new Set(names.flatMap((n) => Object.keys(spec.patterns[n].drums || {})))];
    const built = {};
    names.forEach((n) => {
      built[n] = parts(spec.patterns[n]);
      rows.forEach((row) => { if (!built[n].tracks[row]) built[n].tracks[row] = drumLane("................"); });
    });
    const first = built[names[0]];
    const song = {
      tempo: spec.tempo,
      kit: spec.kit,
      swing: spec.swing || 0,
      humanize: spec.humanize || 0,
      space: spec.space || 0,
      echo: spec.echo || 0,
      master_volume: 0.9,
      visualization: spec.visualization || "bars",
      theme: spec.theme || "default",
      tracks: first.tracks,
      trackMeta: {},
      melody: { waveform: "sine", voice: spec.melodyVoice, volume: spec.melodyVolume, notes: first.notes, ties: first.ties },
      bass: { voice: spec.bassVoice, volume: spec.bassVolume, notes: first.bass.notes, ties: first.bass.ties },
      chain: spec.chain.split(""),
      private_notes: spec.notes || "",
    };
    if (spec.scale) song.scale = spec.scale;
    if (spec.pump) song.pump = spec.pump;
    if (names.length > 1) {
      song.patterns = {};
      names.slice(1).forEach((n) => {
        song.patterns[n] = { tracks: built[n].tracks, notes: built[n].notes, ties: built[n].ties };
        if (Object.keys(built[n].bass.notes).length) song.patterns[n].bass = built[n].bass; // a pattern with no bass notes simply has none
      });
    }
    return song;
  }

  // The four bars of a four-chord loop, one pattern per chord, so the song order shows how patterns make an arrangement.
  const LOFI_DRUMS = { kick: "x.....x...x.....", snare: "....x.......x...", hihat: "o.g.o.g.o.g.o.g." };
  const SPECS = [
    {
      id: "lofi",
      name: "Lo-fi loop",
      blurb: "Slow, swung and soft: a bell melody over Am, F, C, G (one pattern per chord) with a warm bass.",
      tempo: 80, kit: "acoustic", swing: 55, humanize: 25, space: 35, echo: 28, theme: "ocean", visualization: "waveform",
      melodyVoice: "bell", melodyVolume: 0.8, bassVolume: 0.9,
      scale: { root: "A", type: "minpent" },
      chain: "ABCD",
      notes: "Four patterns, one per chord of Am - F - C - G. The drums are the same in each; the last bar adds a small hi-hat fill. Try Follow the kick on the bass, or swap the bell for Pluck.",
      patterns: {
        A: { drums: LOFI_DRUMS, melody: { E4: "x--.....x---....", C4: "....x-.......x-.", A3: "......x........." }, bass: { A1: "x---..x-....x-.." } },
        B: { drums: LOFI_DRUMS, melody: { C4: "x--.....x---....", A3: "....x-.......x-.", F3: "......x........." }, bass: { F1: "x---..x-....x-.." } },
        C: { drums: LOFI_DRUMS, melody: { G4: "x--.....x---....", E4: "....x-.......x-.", C4: "......x........." }, bass: { C2: "x---..x-....x-.." } },
        D: { drums: { ...LOFI_DRUMS, hihat: "o.g.o.g.o.o.oooo", snare: "....x.......x.gg" }, melody: { D4: "x--.....x---....", B3: "....x-.......x-.", G3: "......x........." }, bass: { G1: "x---..x-....x-.." } },
      },
    },
    {
      id: "house",
      name: "Four on the floor",
      blurb: "A house groove at 124 BPM: kick on every beat, open hats on the off-beats, an off-beat bass and lead stabs, with a breakdown.",
      tempo: 124, kit: "electronic", space: 15, pump: 55, theme: "neon",
      melodyVoice: "lead", melodyVolume: 0.65, bassVolume: 0.95,
      scale: { root: "A", type: "minpent" },
      chain: "AABBCDBB",
      notes: "Eight bars: groove, groove, stabs, stabs, breakdown (no kick), a fill, stabs, stabs. The open hat row was added from the menu under the drums. Pump makes the bass and stabs dip on every kick; turn it to 0 to hear the difference.",
      patterns: {
        A: { drums: { kick: "x...x...x...x...", clap: "....x.......x...", hihat: "g...g...g...g...", openhat: "..x...x...x...x." }, bass: { A1: "..x-..x-..x-..x-" } },
        B: { drums: { kick: "x...x...x...x...", clap: "....x.......x...", hihat: "g...g...g...g...", openhat: "..x...x...x...x." }, melody: { A3: "x..x..x.........", C4: "x..x..x.........", E4: "x..x..x........." }, bass: { A1: "..x-..x-........", F1: "..........x-..x-" } },
        C: { drums: { hihat: "g.g.g.g.g.g.g.g.", clap: "............x..." }, melody: { A3: "x---------------", C4: "x---------------", E4: "x---------------" } },
        D: { drums: { kick: "x...x...x...x.xx", clap: "....x.......x...", snare: "..........x.xxxx", hihat: "g...g...g...g...", openhat: "..x...x...x....." }, bass: { A1: "..x-..x-..x-...." } },
      },
    },
    {
      id: "funk",
      name: "Funk groove",
      blurb: "A tight, swung 102 BPM groove: ghost-note snare, a busy plucked bass and a short lead riff in the second pattern.",
      tempo: 102, kit: "acoustic", swing: 28, humanize: 18, theme: "sunset",
      melodyVoice: "lead", melodyVolume: 0.6, bassVoice: "pluck", bassVolume: 0.95,
      scale: { root: "E", type: "minpent" },
      chain: "AABAAB",
      notes: "A is the groove on its own, B adds the riff. Ghost hits are the quiet steps on the snare: click a step again to change its strength.",
      patterns: {
        A: { drums: { kick: "x..x...x..x.....", snare: "....x..g.g..x..g", hihat: "x.x.x.x.x.x.x.x.", openhat: "..............x." }, bass: { E1: "x..x..x.....x-..", G1: "..........x.....", A1: "..............x." } },
        B: { drums: { kick: "x..x...x..x.....", snare: "....x..g.g..x..g", hihat: "x.x.x.x.x.x.x.x.", openhat: "..............x." }, melody: { E4: "x.x.....x.x.....", G4: "......x.......x.", B3: ".....x.........." }, bass: { E1: "x..x..x.....x-..", G1: "..........x.....", A1: "..............x." } },
      },
    },
    {
      id: "trap",
      name: "Dark trap",
      blurb: "140 BPM with 808 drums: rolling hi-hats, a snare on beat three, long low bass notes and a sparse bell.",
      tempo: 140, kit: "808", space: 25, echo: 18, theme: "mono",
      melodyVoice: "bell", melodyVolume: 0.7, bassVolume: 1,
      scale: { root: "D", type: "minor" },
      chain: "ABBCBB",
      notes: "A is the intro (no hats), B the main loop, C a switch-up with a hi-hat roll. The bass notes are held across many steps: Shift+click a note to tie it to the one before.",
      patterns: {
        A: { drums: { kick: "x.....x...x.....", snare: "........x.......", hihat: "................" }, melody: { D4: "x---------------" }, bass: { D1: "x-------........" } },
        B: { drums: { kick: "x.....x...x.....", snare: "........x.......", hihat: "x.x.x.x.xxx.x.xx", openhat: "..............x." }, melody: { D4: "x-------........", A4: "........x-------" }, bass: { D1: "x-------..x-....", F1: "............x---" } },
        C: { drums: { kick: "x..x..x...x..x..", snare: "........x.......", hihat: "x.x.x.x.xxxxxxxx", openhat: "..............x." }, melody: { F4: "x-------........", D4: "........x---...." }, bass: { D1: "x-------........", C2: "........x-------" } },
      },
    },
  ];

  const byId = (id) => SPECS.find((s) => s.id === id) || null;
  // The song for a starter id, cleaned like any saved song, or null for an unknown id.
  function build(id) {
    const spec = byId(id);
    if (!spec || !window.SongFiles) return null;
    return window.SongFiles.cleanSong(raw(spec));
  }
  window.SongStarters = { LIST: SPECS.map((s) => ({ id: s.id, name: s.name, blurb: s.blurb })), build };
})();
