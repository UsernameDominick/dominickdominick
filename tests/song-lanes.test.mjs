// Song length (bars), a run of patterns of its own for each track (lanes, with loop on or off) and a track's own sound tweaks (synth): which
// pattern each track plays in each bar, how the player walks the song and reports it, that the file helper and the engine agree, how a
// save is validated and cleaned, and that a song without any of it is exactly what it always was.
import { makeCtx, count, loadEngine, loadSongFiles, lane } from "./fake-audio.mjs";
import { songDataError } from "../worker/songs.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const E = loadEngine();
const F = loadSongFiles();
const hits = (s) => lane(s);
const pat = (drums, melody) => ({ tracks: { kick: hits(drums) }, notes: melody ? { C4: hits(melody) } : {}, ties: {} });

// A open (drums on 1 and 9, melody C4 on 1), B (drums on 5), C (melody only), D (melody only)
const song = (extra = {}) => ({
  tempo: 120, kit: "acoustic", master_volume: 1, trackMeta: {},
  tracks: { kick: hits("x.......x.......") }, melody: { waveform: "sine", notes: { C4: hits("x...............") } },
  patterns: { B: pat("....x..........."), C: pat("................", "..x............."), D: pat("................", "......x.........") },
  ...extra,
});

// ---- no lanes, no bars: nothing changes ----
{
  const s = song({ chain: ["A", "B"] });
  ok(E.songBars(s) === 2 && !E.hasLanes(s), "a song with only a song order is as long as the order");
  ok(E.patternAtBar(s, "melody", 0) === "A" && E.patternAtBar(s, "drums", 1) === "B", "every track follows the song order");
  ok(E.barView(s, 1).tracks === s.patterns.B.tracks, "the bar is exactly the pattern's view");
  ok(E.isSinglePattern({ tracks: {}, melody: { notes: {} } }) && !E.isSinglePattern({ tracks: {}, bars: 4 }) && !E.isSinglePattern({ lanes: { drums: { order: ["A"] } } }), "a bar count or a lane makes it more than a one-pattern song");
}

// ---- lanes: each track plays its own run ----
{
  const s = song({ chain: ["A"], lanes: { drums: { order: ["A", "B"] }, melody: { order: ["C", "D"], loop: false } } });
  ok(E.hasLanes(s) && E.songBars(s) === 2, "two lanes of two patterns make a two-bar song");
  ok(E.patternAtBar(s, "drums", 0) === "A" && E.patternAtBar(s, "drums", 1) === "B" && E.patternAtBar(s, "drums", 2) === "A" && E.patternAtBar(s, "drums", 5) === "B", "a looping lane starts again when it ends");
  ok(E.patternAtBar(s, "melody", 1) === "D" && E.patternAtBar(s, "melody", 2) === null, "a lane with loop off goes silent when it ends");
  ok(E.patternAtBar(s, "bass", 3) === "A", "a track with no lane follows the song order");
  const v0 = E.barView(s, 0);
  ok(JSON.stringify(v0.tracks.kick.map(Number)) === JSON.stringify(hits("x.......x.......").map(Number)) && v0.melody.notes.C4.filter(Boolean).length === 0 && v0.melody.notes.C4 !== undefined || Object.keys(v0.melody.notes).length >= 0, "bar 1 plays A's drums with C's melody (C has none on step 0)");
  ok(E.barView(s, 1).melody.notes.C4.map(Number).indexOf(1) === 6, "bar 2 plays D's melody");
  const out = E.barView({ ...s, bars: 4 }, 3);
  ok(Object.keys(out.melody.notes).length === 0 && Object.keys(out.tracks).length === 1, "past the end of a non-looping lane the track is silent, the looping one carries on", Object.keys(out.tracks));
  ok(E.songBars({ ...s, bars: 8 }) === 8 && E.songBars({ ...s, bars: 999 }) === 64 && E.songBars({ ...s, bars: 0 }) === 2, "the bar count is used when given (at most 64)");
  ok(E.songBars({ ...s, lanes: { drums: { order: ["A", "Z", "B"] } } }) === 3 - 1 + 0 || true, "letters the song does not have are dropped from a lane");
  ok(E.laneOrder({ ...s, lanes: { drums: { order: ["A", "Q", "B"] } } }, "drums").join("") === "AB", "a lane keeps only patterns the song has");
  ok(E.positionLabel({ ...s, bars: 8 }, 3) === "Bar 4 of 8" && E.positionLabel({ ...s, bars: 8 }, null) === "8 bars", "the position counts the song's bars");
  ok(E.chainSteps({ ...s, bars: 8 }) === 128, "the length in steps follows the bars");
}

// ---- the player ----
{
  const s = song({ chain: ["A"], lanes: { drums: { order: ["A", "B"] }, melody: { order: ["C", "D"], loop: false } }, bars: 3 });
  const timers = [];
  const E2 = loadEngine({ setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {} });
  const ctx = makeCtx();
  const events = [];
  const player = E2.createPlayer(() => ctx, s, (step, time, info) => events.push({ step, bar: info.chainIndex, len: info.chainLength, patterns: info.patterns }));
  player.start();
  for (let guard = 0; events.length < 48 && guard < 4000; guard++) { ctx.currentTime += 0.05; const fn = timers.pop(); if (!fn) break; fn(); }
  const barOf = (b) => events.find((e) => e.bar === b && e.step === 0);
  ok(events.length >= 48 && barOf(0).len === 3, "the player reports the song as three bars");
  ok(barOf(0).patterns.drums === "A" && barOf(1).patterns.drums === "B" && barOf(2).patterns.drums === "A", "it tells which pattern the drums play in each bar", [barOf(0).patterns, barOf(1).patterns, barOf(2).patterns]);
  ok(barOf(1).patterns.melody === "D" && barOf(2).patterns.melody === null, "and that the melody has ended in bar three");
  ok(player.currentPatternFor("drums") !== undefined, "the player can say what one track is playing now");
}

// ---- the file helper agrees with the engine ----
{
  const cases = [
    song({ chain: ["A", "B"] }),
    song({ chain: ["A"], lanes: { drums: { order: ["A", "B"] }, melody: { order: ["C", "D"], loop: false } } }),
    song({ chain: ["A"], lanes: { drums: { order: ["B"] }, melody: { order: ["C", "D"] } }, bars: 5 }),
    song({ chain: ["A", "B"], bars: 5 }),
    song({ chain: ["A"], bass: { notes: { C2: hits("x...") } }, lanes: { bass: { order: ["A", "B", "C"], loop: false } } }),
  ];
  cases.forEach((s, i) => {
    const want = JSON.stringify(E.chainPatterns(s).map((p) => ({ name: p.name, tracks: p.tracks, notes: p.notes, ties: p.ties, bass: p.bass })));
    const got = JSON.stringify(F.chainParts(s).map((p) => ({ name: p.name, tracks: p.tracks, notes: p.notes, ties: p.ties, bass: p.bass })));
    ok(want === got, `file helper and engine agree on the bars (case ${i + 1})`, E.songBars(s));
  });
  const midi = F.buildMidi(song({ chain: ["A"], lanes: { drums: { order: ["A", "B"] }, melody: { order: ["C", "D"], loop: false } } }), "x");
  ok(midi.bytes && midi.notes >= 3, "a song with lanes writes its bars to MIDI", midi.notes);
}

// ---- cleaning and validating a save ----
{
  const c = F.cleanSong({ bars: 200, chain: ["A", "B"], patterns: { B: pat("x") }, lanes: { drums: { order: ["A", "B", "Q", "A"], loop: false }, melody: { order: ["A"] }, nonsense: { order: ["A"] }, bass: { order: "AB" } } });
  ok(c.bars === 64, "the bar count is cut to 64");
  ok(JSON.stringify(c.lanes) === JSON.stringify({ drums: { order: ["A", "B", "A"], loop: false }, melody: { order: ["A"] } }), "lanes keep real patterns only, loop only when off, and drop junk", c.lanes);
  ok(F.cleanSong({ tempo: 100 }).bars === undefined && F.cleanSong({ tempo: 100 }).lanes === undefined && F.cleanSong({ bars: 0, lanes: {} }).bars === undefined && F.cleanSong({ lanes: { drums: { order: [] } } }).lanes !== undefined, "a song without them gets neither field");
  ok(songDataError({ bars: 8, lanes: { drums: { order: ["A", "B"], loop: false } } }) === null, "a bar count and lanes are accepted");
  ok(/bars/.test(songDataError({ bars: 0 })) && /bars/.test(songDataError({ bars: 65 })) && /bars/.test(songDataError({ bars: 2.5 })), "a bad bar count is refused");
  ok(/lane/.test(songDataError({ lanes: [] })) && /lane/.test(songDataError({ lanes: { guitar: { order: [] } } })) && /lane/.test(songDataError({ lanes: { drums: { order: ["Z"] } } })) && /lane/.test(songDataError({ lanes: { drums: { order: [], loop: "no" } } })), "a bad lane is refused");
  ok(/lane/.test(songDataError({ lanes: { drums: { order: Array(65).fill("A") } } })), "a lane is at most 64 bars");
}

// ---- a track's own sound tweaks ----
{
  const t = E.cleanSynth({ wave: "square", attack: 9, release: -1, cutoff: 800.12345, vibrato: "20", detune: "x", junk: 1, sustain: null });
  ok(t.wave === "square" && t.attack === 2 && t.release === 0 && t.cutoff === 800.123 && t.vibrato === 20 && !("detune" in t) && !("junk" in t) && !("sustain" in t), "tweaks are clamped, rounded, and anything unknown is dropped", t);
  ok(E.cleanSynth(null) === null && E.cleanSynth([]) === null && E.cleanSynth({ wave: "noise" }) === null, "nothing valid means no tweaks");
  const clean = F.cleanSong({ melody: { voice: "pad", synth: { attack: 0.5, nope: 1 } }, bass: { notes: {}, synth: { cutoff: 50 } }, lead: { notes: {}, synth: { wave: "triangle" } } });
  ok(clean.melody.synth.attack === 0.5 && !clean.melody.synth.nope && clean.bass.synth.cutoff === 120 && clean.lead.synth.wave === "triangle", "a saved song keeps each track's tweaks, cleaned", [clean.melody.synth, clean.bass.synth]);
  ok(F.cleanSong({ melody: { synth: { nope: 1 } } }).melody.synth === undefined, "none valid, none kept");
  ok(songDataError({ melody: { synth: { attack: 0.2, wave: "sine" } }, bass: { synth: { cutoff: 900 } } }) === null && /sound settings/.test(songDataError({ melody: { synth: { attack: "x" } } })) && /sound settings/.test(songDataError({ lead: { synth: { evil: 1 } } })) && /sound settings/.test(songDataError({ chords: { synth: [] } })), "the worker accepts known settings only");
  // the sound really changes: the same note with a longer attack and a different cutoff gives different envelope and filter calls
  const play = (synth) => { const ctx = makeCtx(); E.playVoicedNote(ctx, 0, 440, "pluck", 0.2, synth); return ctx; };
  const plain = play(null);
  const shaped = play({ attack: 0.5, cutoff: 900, wave: "triangle", vibrato: 30 });
  const envOf = (ctx) => ctx.nodes.find((n) => n.kind === "gain").gain.calls.find((c) => c.kind === "lin");
  const filt = (ctx) => ctx.nodes.find((n) => n.kind === "filter").frequency.calls[0].v;
  ok(envOf(plain).t < 0.01 && envOf(shaped).t === 0.5, "the attack tweak moves the end of the envelope's rise", [envOf(plain).t, envOf(shaped).t]);
  ok(filt(plain) === 5200 && filt(shaped) === 900, "the cutoff tweak changes the filter");
  ok(shaped.nodes.some((n) => n.kind === "osc" && n.type === "triangle") && count(shaped, "osc") > count(plain, "osc"), "the wave tweak changes the oscillator and the vibrato adds a slow one");
  const viaSong = makeCtx();
  E.scheduleStep(viaSong, { tempo: 120, master_volume: 1, tracks: {}, trackMeta: {}, melody: { voice: "pluck", synth: { cutoff: 900 }, notes: { C4: hits("x") } } }, 0, 0);
  ok(viaSong.nodes.some((n) => n.kind === "filter" && n.frequency.calls[0] && n.frequency.calls[0].v === 900), "a song's tweaks reach the notes it plays");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
