// Patterns A-D and the song order: how the engine finds each pattern, what plays and in which order, how the player walks the order, how
// the waveform preview and the audio export cover the whole song, and that a song with one pattern is exactly what it always was.
import { makeCtx, count, offlineLog, loadEngine, loadSongFiles, lane } from "./fake-audio.mjs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const E = loadEngine();
const F = loadSongFiles();
const STEP = 60 / 120 / 4;
const hits = (str) => lane(str);
const kickOnly = (str) => ({ kick: hits(str) });
const patternOf = (tracksStr) => ({ tracks: kickOnly(tracksStr), notes: {}, ties: {} });

// A song in the shape the builder saves: the open pattern in the usual places, the others under patterns.
const multi = (extra = {}) => ({
  tempo: 120, kit: "acoustic", master_volume: 1, trackMeta: {},
  tracks: kickOnly("x.......x......."), melody: { waveform: "sine", notes: { C4: hits("x...............") } },
  patterns: { B: { tracks: kickOnly("....x..........."), notes: { E4: hits("x...............") }, ties: {} } },
  ...extra,
});

// ---- one-pattern songs are exactly what they were: the same seeded noise as before the patterns existed ----
{
  const was = {
    drumsOnly: [0.314478838816, 0.785143263172, 0.670454978943, 0.25762658962],
    withMelody: [0.664437857922, 0.624858397292, 0.340221073944, 0.291222660104],
    noTempo: [0.788640409475, 0.1498018899, 0.416165034287, 0.157471359242],
  };
  const songs = {
    drumsOnly: { tempo: 120, kit: "acoustic", tracks: { kick: hits("x...x...x...x..."), snare: hits("....x.......x..."), hihat: hits("x.x.x.x.x.x.x.x."), clap: hits("................") }, melody: { waveform: "sine", notes: {} } },
    withMelody: { tempo: 100, kit: "808", tracks: { kick: hits("x...............") }, melody: { waveform: "square", notes: { C4: hits("x...x..."), E4: hits("..x.....") }, ties: { C4: hits(".xxx....") } } },
    noTempo: { kit: "electronic", tracks: { crash: hits("x") }, melody: { notes: {} } },
  };
  for (const [name, data] of Object.entries(songs)) {
    const r = E.previewRandom(data);
    const got = [r(), r(), r(), r()].map((v) => Number(v.toFixed(12)));
    ok(JSON.stringify(got) === JSON.stringify(was[name]), `${name}: the seeded drum noise is the same as before patterns existed`, got);
  }
}

// ---- finding patterns ----
{
  const single = { tempo: 120, tracks: kickOnly("x..............."), melody: { notes: {} } };
  ok(E.isSinglePattern(single) && E.editingName(single) === "A" && E.patternNames(single).join() === "A", "a song with no patterns, chain or editing is one pattern, A");
  ok(E.chainOf(single).join() === "A" && E.chainSteps(single) === 16, "and its song order is just A, one bar");
  ok(E.viewOf(single, "A") === single, "the view of a one-pattern song is the song itself (no copy)");

  const s = multi();
  ok(!E.isSinglePattern(s) && E.editingName(s) === "A" && E.patternNames(s).join() === "A,B", "with another pattern stored, A (open) and B exist", E.patternNames(s));
  ok(E.patternData(s, "A").tracks === s.tracks && E.patternData(s, "B").tracks === s.patterns.B.tracks, "the open pattern is the song's own parts, the others come from patterns");
  ok(E.patternData(s, "C") === null && E.patternData(s, "Z") === null && E.patternData(s, "constructor") === null && E.patternData(s, "__proto__") === null && E.patternData(s, undefined) === null, "a pattern the song does not have, or a name that is not one, is null");

  const editingB = { ...multi(), editing: "B", tracks: s.patterns.B.tracks, melody: { waveform: "sine", notes: s.patterns.B.notes }, patterns: { A: { tracks: s.tracks, notes: s.melody.notes, ties: {} } } };
  ok(E.editingName(editingB) === "B" && E.patternNames(editingB).join() === "A,B" && E.patternData(editingB, "B").tracks === editingB.tracks && E.patternData(editingB, "A").tracks === s.tracks, "when B is the open pattern, A comes from patterns and B from the song's own parts");
  ok(JSON.stringify(E.chainPatterns({ ...editingB, chain: ["A", "B"] }).map((p) => [p.name, p.tracks.kick.map(Number).join("")])) === JSON.stringify(E.chainPatterns({ ...s, chain: ["A", "B"] }).map((p) => [p.name, p.tracks.kick.map(Number).join("")])), "the same music stored with A open or with B open resolves to the same patterns in the same order");
  ok(E.editingName({ editing: "Z" }) === "A" && E.editingName({ editing: "constructor" }) === "A" && E.editingName({ editing: 3 }) === "A", "a damaged editing name means A");

  // the song order
  ok(E.chainOf({ ...s, chain: ["A", "A", "B", "A"] }).join("") === "AABA", "the song order is what was set");
  ok(E.chainOf({ ...s, chain: ["A", "C", "B", "Z", "constructor", 5] }).join("") === "AB", "patterns the song does not have, and junk, are dropped from the order");
  ok(E.chainOf({ ...s, chain: [] }).join("") === "A" && E.chainOf({ ...s, chain: "AB" }).join("") === "A" && E.chainOf({ ...s, chain: ["C"] }).join("") === "A", "no usable order plays the first pattern the song has");
  ok(E.chainOf({ ...s, chain: Array(40).fill("A") }).length === 32 && E.MAX_CHAIN === 32, "the order is cut to 32");
  const noA = { ...s, editing: "B", tracks: s.patterns.B.tracks, melody: { notes: s.patterns.B.notes }, patterns: {} };
  ok(E.patternNames(noA).join() === "B" && E.chainOf(noA).join() === "B", "a song whose only pattern is B plays B");
  ok(E.chainSteps({ ...s, chain: ["A", "B", "B"] }) === 48, "three bars are 48 steps");

  // the view
  const view = E.viewOf({ ...s, space: 30, trackMeta: { kick: { volume: 0.5 } } }, "B");
  ok(view.tracks === s.patterns.B.tracks && view.melody.notes === s.patterns.B.notes && view.melody.waveform === "sine" && view.space === 30 && view.trackMeta.kick.volume === 0.5, "a pattern's view has its own tracks and notes and everything else of the song (mix, instrument, effects)");
  ok(s.tracks.kick[0] === true && s.melody.notes.E4 === undefined && s.patterns.B.tracks.kick[4] === true, "making a view changes nothing in the song");
  ok(E.viewOf(s, "A") === s && E.viewOf(s, "Q") === s, "the open pattern's view is the song itself, and an unknown pattern falls back to it");
}

// ---- the player walks the song order ----
function drive(songData, options, bars) {
  const timers = [];
  const E2 = loadEngine({ setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {} });
  const ctx = makeCtx();
  const events = [];
  const nodeCounts = [];
  const player = E2.createPlayer(() => ctx, songData, (step, time, info) => { events.push({ step, time, ...info }); nodeCounts.push(ctx.nodes.length); });
  player.start(undefined, options);
  const total = bars * 16;
  for (let guard = 0; events.length < total && guard < 4000; guard++) {
    ctx.currentTime += 0.05;
    const fn = timers.pop();
    if (!fn) break;
    fn();
  }
  return { E2, ctx, events: events.slice(0, total), nodeCounts, player };
}
{
  const s = multi({ chain: ["A", "A", "B"] });
  const { events, nodeCounts, player } = drive(s, undefined, 6);
  const seq = events.map((e) => e.pattern).filter((_, i) => i % 16 === 0).join("");
  ok(seq === "AABAAB", "the player plays the song order and wraps round to the start", seq);
  ok(events.every((e, i) => e.step === i % 16), "each bar runs steps 0 to 15");
  ok(events.every((e) => e.chainLength === 3) && events.map((e) => e.chainIndex).filter((_, i) => i % 16 === 0).join("") === "012012", "info carries the position in the order and its length");
  ok(events.every((e) => e.data === s || e.data.tracks === s.patterns.B.tracks), "info.data is the song as that pattern plays it");
  const gaps = events.slice(1).map((e, i) => e.time - events[i].time);
  ok(gaps.every((g) => Math.abs(g - STEP) < 1e-9), "the steps stay evenly spaced across bar boundaries", gaps.filter((g) => Math.abs(g - STEP) > 1e-9).slice(0, 3));
  // A has kicks on steps 0 and 8 (2 oscillators per bar, plus its melody note), B has a kick on step 4 and a melody note on 0
  const perBar = [0, 1, 2].map((bar) => nodeCounts[bar * 16 + 15] - (bar === 0 ? 0 : nodeCounts[bar * 16 - 1]));
  ok(perBar[1] === 6 && perBar[2] === 4, "a bar of A schedules its two kicks and melody note (6 nodes), the bar of B its one kick and melody note (4)", perBar);
  ok(player.currentPattern() === "B" || player.currentPattern() === "A", "the player reports which pattern it is on", player.currentPattern());
}
{
  // loop mode plays one pattern for ever, even though the song order says otherwise
  const s = multi({ chain: ["A", "B"] });
  const { events } = drive(s, { pattern: "B" }, 3);
  ok(events.every((e) => e.pattern === "B" && e.chainLength === 1 && e.chainIndex === 0), "start with { pattern: 'B' } loops B and ignores the order");
  const unknown = drive(s, { pattern: "D" }, 1).events;
  ok(unknown.every((e) => e.pattern === "A"), "looping a pattern the song does not have falls back to the open one", unknown[0].pattern);
}
{
  // a one-pattern song: the original behaviour, the song itself as data
  const single = { tempo: 120, kit: "acoustic", master_volume: 1, tracks: kickOnly("x..............."), melody: { waveform: "sine", notes: {} } };
  const { events } = drive(single, undefined, 2);
  ok(events.length === 32 && events.every((e) => e.pattern === "A" && e.chainLength === 1 && e.data === single), "a one-pattern song loops with the song itself as info.data");
}
{
  // the order edited while it plays (shortened past the position, a pattern removed)
  const s = multi({ chain: ["A", "B", "A", "B"] });
  const timers = [];
  const E2 = loadEngine({ setTimeout: (fn) => { timers.push(fn); return 1; }, clearTimeout: () => {} });
  const ctx = makeCtx();
  const seen = [];
  const player = E2.createPlayer(() => ctx, s, (step, time, info) => seen.push(info.pattern));
  player.start();
  const run = (n) => { for (let g = 0; g < n; g++) { ctx.currentTime += 0.05; const fn = timers.pop(); if (fn) fn(); } };
  run(80); // well into the order
  s.chain = ["A"]; // shortened to one bar while the player is on a later one
  const before = seen.length;
  run(200);
  ok(seen.length > before && seen.slice(before + 17).every((p) => p === "A"), "shortening the order while playing carries on without a gap or a crash", seen.slice(before).join("").slice(0, 40));
  delete s.patterns; s.chain = ["A", "B"];
  const mark = seen.length;
  run(200);
  ok(seen.length > mark && seen.slice(mark + 17).every((p) => p === "A"), "removing a pattern while playing drops it from the order");
}

// ---- the waveform preview and the audio export cover the whole song ----
{
  const s = multi({ chain: ["A", "B", "A"] });
  offlineLog.length = 0;
  const peaks = await E.renderWaveformPeaks(s, 60);
  const off = offlineLog[0];
  ok(peaks.length === 60 && off.length === Math.ceil(44100 * STEP * 16 * 3), "the preview renders all three bars", { length: off.length, want: Math.ceil(44100 * STEP * 48) });
  const kicks = off.nodes.filter((n) => n.kind === "osc" && n.type === "sine" && n.started !== null);
  const starts = kicks.map((n) => Number(n.started.toFixed(6))).sort((a, b) => a - b);
  // kicks: A on steps 0 and 8 (bars 1 and 3), B on step 4 (bar 2); plus melody notes C4 (A) and E4 (B)
  const kickStarts = starts.filter((t) => [0, 8 * STEP, 16 * STEP + 4 * STEP, 32 * STEP, 32 * STEP + 8 * STEP].some((x) => Math.abs(x - t) < 1e-6));
  ok(kickStarts.length >= 5, "the kicks land at A's steps in bars 1 and 3 and B's step in bar 2", starts);
  offlineLog.length = 0;
  await E.renderWaveformPeaks(multi(), 60);
  ok(offlineLog[0].length === Math.ceil(44100 * STEP * 16), "a song with no order previews one bar, the first pattern");

  offlineLog.length = 0;
  const wav = await E.renderLoopAudio(s, { loops: 2, sampleRate: 44100 });
  ok(wav.loopSamples === Math.round(STEP * 48 * 44100) && wav.loops === 2 && wav.samples.length === wav.loopSamples * 2, "the audio export is the whole song, repeated", { loop: wav.loopSamples });
  ok(offlineLog[0].length === wav.loopSamples * 2, "rendered as two passes of the whole song");

  // a long song gets fewer repeats than asked for
  const long = multi({ chain: Array(32).fill("A") });
  ok(E.maxExportLoops(long) === 4 && E.maxExportLoops(multi()) === 16 && E.maxExportLoops({ tempo: 40, tracks: {}, melody: {} }) === 16, "a 32-bar song at 120 BPM can repeat 4 times in a five-minute export; a short one, 16", [E.maxExportLoops(long), E.maxExportLoops(multi())]);
  offlineLog.length = 0;
  const big = await E.renderLoopAudio(long, { loops: 16 });
  ok(big.loops === 4, "…and the render honours it", big.loops);
}

// ---- storage independence of the render ----
{
  const a = multi({ chain: ["A", "B"] });
  const b = { ...multi(), editing: "B", tracks: a.patterns.B.tracks, melody: { waveform: "sine", notes: a.patterns.B.notes }, patterns: { A: { tracks: a.tracks, notes: a.melody.notes, ties: {} } }, chain: ["A", "B"] };
  const ra = E.previewRandom(a), rb = E.previewRandom(b);
  ok([ra(), ra(), ra()].join() === [rb(), rb(), rb()].join(), "the same music gets the same drum noise whichever pattern was open when it was saved");
  const rc = E.previewRandom({ ...a, chain: ["B", "A"] });
  ok([E.previewRandom(a)(), E.previewRandom(a)()].join() !== [rc(), rc()].join(), "a different song order seeds differently");
}

// ---- the file helper resolves patterns exactly as the engine does ----
{
  const a = multi({ chain: ["A", "B", "A"] });
  const editingB = { ...multi(), editing: "B", tracks: a.patterns.B.tracks, melody: { waveform: "sine", notes: a.patterns.B.notes }, patterns: { A: { tracks: a.tracks, notes: a.melody.notes, ties: {} } }, chain: ["B", "A", "A", "B"] };
  const withGarbage = multi({ chain: ["A", "Z", "B", "constructor", null, "C"], patterns: { B: a.patterns.B, constructor: patternOf("x"), C: "no", __proto__: { D: patternOf("x") } } });
  const cases = [
    ["one pattern", { tempo: 120, tracks: kickOnly("x..............."), melody: { notes: {} } }],
    ["two patterns, A open, no order", multi()],
    ["an order", a],
    ["B open", editingB],
    ["junk in the order and patterns", withGarbage],
    ["too long an order", multi({ chain: Array(40).fill("B") })],
    ["editing is not a pattern", multi({ editing: "Z", chain: ["B"] })],
    ["a bass line in the open pattern and in B", multi({ bass: { notes: { C2: hits("x...") }, ties: {} }, patterns: { B: { ...a.patterns.B, bass: { notes: { G1: hits("..x.") }, ties: {} } } }, chain: ["A", "B", "A"] })],
    ["a bass line in the song, none in B", multi({ bass: { voice: "pad", notes: { C2: hits("x...") } }, chain: ["A", "B"] })],
    ["a bass line only in a stored pattern", multi({ patterns: { B: { ...a.patterns.B, bass: { notes: { C1: hits("x") } } } }, chain: ["B", "A"] })],
    ["B open, with a bass line", { ...editingB, bass: { notes: { E1: hits("x...") }, ties: {} }, patterns: { A: { tracks: a.tracks, notes: a.melody.notes, ties: {}, bass: { notes: { A1: hits("..x.") }, ties: {} } } } }],
    ["junk instead of a bass line", multi({ bass: "no", patterns: { B: { ...a.patterns.B, bass: 7 } } })],
  ];
  for (const [label, song] of cases) {
    const want = JSON.stringify(E.chainPatterns(song).map((p) => ({ name: p.name, tracks: p.tracks, notes: p.notes, ties: p.ties, bass: p.bass })));
    const got = JSON.stringify(F.chainParts(song).map((p) => ({ name: p.name, tracks: p.tracks, notes: p.notes, ties: p.ties, bass: p.bass })));
    ok(want === got, `file helper and engine agree on the song order: ${label}`, E.chainOf(song).join(""));
  }
}

// ---- MIDI writes the whole song order ----
{
  const readNotes = (bytes) => {
    const out = []; let p = 14; // skip the header chunk (MThd, length 6, 3 words)
    const u32 = (i) => (bytes[i] << 24 | bytes[i + 1] << 16 | bytes[i + 2] << 8 | bytes[i + 3]) >>> 0;
    p = 8 + u32(4);
    while (p < bytes.length) {
      const len = u32(p + 4); const end = p + 8 + len; let q = p + 8; let tick = 0; let name = "";
      while (q < end) {
        let delta = 0, b; do { b = bytes[q++]; delta = (delta << 7) | (b & 0x7f); } while (b & 0x80);
        tick += delta; const status = bytes[q++];
        if (status === 0xff) { const type = bytes[q++]; const l = bytes[q++]; if (type === 3) name = String.fromCharCode(...bytes.slice(q, q + l)); q += l; }
        else { const note = bytes[q++]; const vel = bytes[q++]; out.push({ track: name, tick, on: (status & 0xf0) === 0x90 && vel > 0, note }); }
      }
      p = end;
    }
    return out;
  };
  const song = {
    tempo: 120, tracks: kickOnly("x.......x......."), trackMeta: {}, melody: { notes: { C4: hits("xxx.............") }, ties: { C4: hits(".xx.............") } },
    patterns: { B: { tracks: kickOnly("....x..........."), notes: { E4: hits("x...............") }, ties: {} } }, chain: ["A", "B", "A"],
  };
  const out = F.buildMidi(song, "x");
  const ev = readNotes(out.bytes);
  const kicks = ev.filter((e) => e.track === "Drums" && e.on && e.note === 36).map((e) => e.tick);
  ok(kicks.join() === [0, 8 * 120, 16 * 120 + 4 * 120, 32 * 120, 32 * 120 + 8 * 120].join(), "kicks land at A's steps in bars 1 and 3 and B's step in bar 2", kicks);
  const mel = ev.filter((e) => e.track === "Melody");
  const c4 = mel.filter((e) => e.note === 60).map((e) => `${e.on ? "on" : "off"}@${e.tick}`);
  ok(c4.join() === "on@0,off@360,on@3840,off@4200", "C4 is one held note in bar 1 and again in bar 3 (ties never cross a bar)", c4);
  const e4 = mel.filter((e) => e.note === 64).map((e) => `${e.on ? "on" : "off"}@${e.tick}`);
  ok(e4.join() === "on@1920,off@2040", "B's melody note is in bar 2 only", e4);
  ok(out.notes === 5 + 2 + 1, "every pattern's notes are counted", out.notes);
  const solo = F.buildMidi({ ...song, patterns: undefined, chain: undefined, editing: undefined }, "x");
  ok(readNotes(solo.bytes).filter((e) => e.track === "Drums" && e.on).length === 2 && solo.notes === 2 + 1, "a one-pattern song still writes one bar");
  const muted = F.buildMidi({ ...song, trackMeta: { kick: { muted: true } } }, "x");
  ok(readNotes(muted.bytes).every((e) => e.track !== "Drums"), "a muted drum is muted in every pattern");
}

// ---- the import cleaner keeps patterns, the order and the open pattern, and nothing else ----
{
  const full = {
    tempo: 100, editing: "B",
    tracks: { kick: hits("x..............."), tom: hits("..x.............") }, trackMeta: { tom: { color: "#112233" } },
    melody: { notes: { C4: hits("xx.............."), D4: hits("x...............") }, ties: { C4: hits(".x..............") } },
    patterns: {
      A: { tracks: { kick: hits("x...x...x...x..."), tom: hits("................"), cowbell: hits("xxxx") }, notes: { E4: hits("xx..............") }, ties: { E4: hits(".x..............") } },
      C: { tracks: { kick: hits("x") }, notes: { C4: hits("xx"), Z9: hits("x") }, ties: { C4: hits(".x") } },
      B: { tracks: { kick: hits("xxxxxxxxxxxxxxxx") }, notes: {}, ties: {} },
      E: { tracks: {}, notes: {} },
      __proto__: { D: { tracks: { kick: hits("x") }, notes: {} } },
    },
    chain: ["A", "B", "C", "D", "E", "A", 7, null, "constructor"],
  };
  const c = F.cleanSong(full);
  ok(c.editing === "B", "the open pattern is kept (B)", c.editing);
  ok(Object.keys(c.patterns).join() === "A,C", "the other patterns are kept in order, and the open one, an unknown letter and an inherited one are dropped", Object.keys(c.patterns));
  ok(Object.keys(c.patterns.A.tracks).sort().join() === "clap,hihat,kick,snare,tom" && !c.patterns.A.tracks.cowbell, "a pattern has a lane for each row the song has, and none for a row it doesn't", Object.keys(c.patterns.A.tracks));
  ok(c.patterns.A.tracks.kick.filter(Boolean).length === 4 && c.patterns.A.notes.E4.filter(Boolean).length === 2 && c.patterns.A.ties.E4[1] === true, "its hits, notes and held notes are cleaned and kept", c.patterns.A.ties);
  ok(c.patterns.C.ties.C4[1] === true && Object.keys(c.patterns.C.notes).length === 24 && !c.patterns.C.notes.Z9, "notes off the roll are dropped and the roll is filled in", Object.keys(c.patterns.C.notes).length);
  ok(c.chain.join("") === "ABCA", "the order keeps real patterns only (A, B open, C; D and E don't exist) in the order given", c.chain);
  const round = F.parseImport(F.exportJson("T", c));
  ok(JSON.stringify(round.data) === JSON.stringify(c), "export then import gives exactly the same song");
  const plain = F.cleanSong({ tempo: 90 });
  ok(plain.editing === undefined && plain.patterns === undefined && plain.chain === undefined && !("editing" in plain) && !("patterns" in plain) && !("chain" in plain), "a one-pattern song gets none of the three fields");
  ok(F.cleanSong({ editing: "A", patterns: { A: patternOf("x") } }).editing === undefined && F.cleanSong({ editing: "A", patterns: { A: patternOf("x") } }).patterns === undefined, "editing A is the default (not written), and a stored A while A is open is dropped");
  ok(F.cleanSong({ chain: ["A"], patterns: {} }).chain.join() === "A" && F.cleanSong({ chain: ["B"] }).chain === undefined, "an order of the one pattern is kept; one naming a pattern that doesn't exist is dropped");
  ok(F.cleanSong({ chain: Array(50).fill("A") }).chain.length === 32, "a very long order is cut to 32");
  ok(F.cleanSong({ patterns: "no", chain: "AB", editing: { a: 1 } }).patterns === undefined, "wrong types are ignored");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
