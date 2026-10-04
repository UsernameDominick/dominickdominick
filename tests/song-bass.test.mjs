// The bass line (songData.bass): a second melodic part over C1 to B2 that plays with its own voice, volume, mute and held notes, lives
// per pattern, feeds the preview seed only once it has a note, and leaves a song without one exactly as it was.
import { makeCtx, count, loadEngine, lane } from "./fake-audio.mjs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const E = loadEngine();
const STEP = 60 / 120 / 4;

const play = (data, step = 0, time = 0) => { const ctx = makeCtx(); E.scheduleStep(ctx, data, step, time, () => 0.5); return ctx; };
const oscs = (ctx) => ctx.nodes.filter((n) => n.kind === "osc");
const song = (bass, extra = {}) => ({ tempo: 120, kit: "acoustic", master_volume: 1, tracks: {}, melody: { waveform: "sine", notes: {} }, bass, ...extra });
const hz = (name) => E.noteToFreq(name);

// ---- the roll ----
{
  ok(E.BASS_NOTES.length === 24 && E.BASS_NOTES[0] === "B2" && E.BASS_NOTES[11] === "C2" && E.BASS_NOTES[12] === "B1" && E.BASS_NOTES[23] === "C1", "the bass roll is C1 to B2, highest first, like the melody roll", [E.BASS_NOTES[0], E.BASS_NOTES[23]]);
  ok(Math.abs(hz("C1") - 32.7) < 0.1 && Math.abs(hz("B2") - 123.47) < 0.1, "C1 is about 32.7 Hz and B2 about 123.5 Hz", [hz("C1"), hz("B2")]);
}

// ---- a bass note plays with the bass voice at its own pitch ----
{
  const ctx = play(song({ notes: { C2: lane("x...............") } }));
  const o = oscs(ctx);
  ok(o.length === 2 && o[0].type === "sawtooth" && count(ctx, "filter") === 1, "one bass note: the bass voice (a sawtooth plus its sub-octave, one low-pass filter)", { osc: o.length, type: o[0].type, filters: count(ctx, "filter") });
  ok(Math.abs(o[0].frequency.value - hz("C2")) < 1e-6 && Math.abs(o[1].frequency.value - hz("C2") / 2) < 1e-6, "at C2 (65.4 Hz) with the sub an octave under", o.map((x) => x.frequency.value));
  ok(o.every((x) => x.started === 0 && x.stopped > 0), "every oscillator is started and given an end");
  ok(oscs(play(song({ notes: { C2: lane("x...............") } }), 1)).length === 0, "nothing on step 2 means nothing sounds");
}
// the voice can be changed, and a bad name falls back to bass
{
  const named = (voice) => oscs(play(song({ voice, notes: { E1: lane("x...............") } })));
  ok(named("pad").length === 3 && named("pluck").length === 1 && named("bell").length === 2, "pad, pluck and bell are the engine's own voices", [named("pad").length, named("pluck").length, named("bell").length]);
  for (const evil of ["nope", "constructor", "__proto__", 7, null, {}, undefined]) ok(E.bassVoiceOf({ bass: { voice: evil } }) === "bass", `a voice of ${JSON.stringify(evil)} plays as the bass voice`);
  ok(E.bassVoiceOf({}) === "bass" && E.bassVoiceOf(null) === "bass" && E.bassVoiceOf({ bass: { voice: "lead" } }) === "lead", "no bass at all or a real name behave");
}
// mix: volume, level, mute
{
  // a quiet note is routed through one extra gain set to its level (volume x step strength); a full-level one is not
  const hasLevel = (ctx, v) => ctx.nodes.some((n) => n.kind === "gain" && Math.abs(n.gain.value - v) < 1e-9);
  const full = play(song({ notes: { C2: lane("x...............") } }));
  ok(!hasLevel(full, 0.5) && !hasLevel(full, 0.4) && !hasLevel(full, 0.2), "a full-strength note at full volume has no extra level stage");
  ok(hasLevel(play(song({ volume: 0.5, notes: { C2: lane("x...............") } })), 0.5), "the bass's volume sets its level");
  ok(hasLevel(play(song({ notes: { C2: [0.4, false, false, false] } })), 0.4), "a soft step sets its level");
  ok(hasLevel(play(song({ volume: 0.5, notes: { C2: [0.4, false, false, false] } })), 0.2), "volume and strength multiply");
  ok(oscs(play(song({ muted: true, notes: { C2: lane("x...............") } }))).length === 0, "a muted bass is silent");
  ok(oscs(play(song({ hidden: true, notes: { C2: lane("x...............") } }))).length === 2, "hiding the bass in the editor does not silence it");
  ok(E.isBassMuted(song({ muted: true })) === true && E.isBassMuted(song({})) === false && E.isBassMuted({}) === false, "isBassMuted reads only the bass's own flag");
  ok(oscs(play(song({ notes: { C2: lane("x...............") } }, { melody: { waveform: "sine", muted: true, notes: { C4: lane("x...............") } } }))).length === 2, "muting the melody does not touch the bass");
}
// the melody and the bass play together
{
  const ctx = play(song({ notes: { C2: lane("x...............") } }, { melody: { waveform: "square", notes: { C4: lane("x...............") } } }));
  ok(oscs(ctx).length === 3 && oscs(ctx).filter((o) => o.type === "square").length === 1, "a melody note and a bass note on the same step both sound", oscs(ctx).map((o) => o.type));
}
// held notes: a tie lengthens the bass note, the way it does for the melody
{
  const short = oscs(play(song({ notes: { C2: lane("x...............") } })))[0].stopped;
  const held = oscs(play(song({ notes: { C2: lane("xxxx............") }, ties: { C2: lane(".xxx............") } })))[0].stopped;
  ok(held > short + 2 * STEP, "three tied steps hold the note about three steps longer than one", { short, held });
  const second = play(song({ notes: { C2: lane("xxxx............") }, ties: { C2: lane(".xxx............") } }), 1);
  ok(oscs(second).length === 0, "a tied step does not strike the note again");
  ok(E.heldSteps(song({ notes: { C2: lane("xxxx............") }, ties: { C2: lane(".xxx............") } }), "C2", 0, "bass") === 4 && E.isTiedContinuation(song({ notes: { C2: lane("xx..............") }, ties: { C2: lane(".x..............") } }), "C2", 1, "bass") === true, "heldSteps and isTiedContinuation take the part");
  ok(E.isTiedContinuation(song({ notes: { C2: lane("x...............") }, ties: { C2: lane(".x..............") } }), "C2", 1, "bass") === false, "a stale tie on an empty step is ignored");
  ok(E.isTiedContinuation({ melody: { notes: { C4: lane("xx") }, ties: { C4: lane(".x") } } }, "C4", 1) === true, "the melody's own ties still work with no part given");
}
// hostile data cannot throw
{
  for (const bass of ["x", 7, [], null, { notes: "x" }, { notes: [] }, { notes: { C2: "xxxx" } }, { notes: { C2: null } }, { notes: { C2: lane("x") }, ties: "x" }, { notes: { C2: lane("x...............") }, volume: "loud" }, { notes: { Z9: lane("x...............") } }]) {
    let threw = false;
    try { play({ tempo: 120, tracks: {}, melody: { notes: {} }, bass }); } catch (e) { threw = true; }
    ok(!threw, `a bass of ${JSON.stringify(bass)} does not throw`);
  }
}

// ---- patterns: the bass lives in each pattern ----
{
  const multi = {
    tempo: 120, kit: "acoustic", master_volume: 1, tracks: { kick: lane("x...") }, melody: { waveform: "sine", notes: {} },
    bass: { voice: "pluck", volume: 0.8, notes: { C2: lane("x...............") }, ties: { C2: lane("................") } },
    patterns: { B: { tracks: {}, notes: {}, ties: {}, bass: { notes: { G1: lane("..x.............") }, ties: {} } }, C: { tracks: {}, notes: {}, ties: {} } },
    chain: ["A", "B", "C"],
  };
  const a = E.patternData(multi, "A"), b = E.patternData(multi, "B"), c = E.patternData(multi, "C");
  ok(a.bass && a.bass.notes.C2[0] === true && b.bass.notes.G1[2] === true && c.bass && JSON.stringify(c.bass.notes) === "{}", "each pattern has its own bass; one that never had any has an empty one (not another pattern's)");
  const vb = E.viewOf(multi, "B");
  ok(vb.bass.voice === "pluck" && vb.bass.volume === 0.8 && vb.bass.notes.G1[2] === true && !vb.bass.notes.C2, "playing B uses B's bass notes with the song's one bass voice and volume");
  ok(oscs(play(E.viewOf(multi, "C"))).length === 0 && oscs(play(E.viewOf(multi, "C"), 2)).length === 0, "pattern C has no bass notes, so none sound");
  ok(oscs(play(E.viewOf(multi, "B"), 2)).length === 1 && oscs(play(E.viewOf(multi, "B"), 0)).length === 0, "pattern B's bass sounds on its own step only");
  const noBass = { tempo: 120, tracks: {}, melody: { notes: {} }, editing: "B", patterns: { A: { tracks: {}, notes: {}, ties: {}, bass: { notes: { C1: lane("x...") }, ties: {} } } }, chain: ["A", "B"] };
  ok(E.viewOf(noBass, "A").bass && E.viewOf(noBass, "A").bass.notes.C1[0] === true, "a song whose open pattern has no bass can still have one in another pattern");
  ok(!E.patternData({ tempo: 120, tracks: {}, melody: { notes: {} } }, "A").bass && !("bass" in E.viewOf({ tempo: 120, tracks: {}, melody: { notes: {} }, patterns: { B: { tracks: {} } } }, "B")), "a song without any bass has no bass key in its patterns or views");
  const parts = E.chainPatterns(multi);
  ok(parts.length === 3 && parts[1].bass.notes.G1[2] === true, "the song order resolved for exports carries each pattern's bass");
}

// ---- the preview seed ----
{
  const seedOf = (data) => { const r = E.previewRandom(data); return [r(), r(), r()].map((v) => Number(v.toFixed(10))).join(); };
  const plain = { tempo: 120, kit: "acoustic", tracks: { kick: lane("x...x...") }, melody: { waveform: "sine", notes: { C4: lane("x...") } } };
  const withEmpty = { ...plain, bass: { notes: { C2: lane("................") } } };
  const withNote = { ...plain, bass: { notes: { C2: lane("x...............") } } };
  const other = { ...plain, bass: { notes: { C2: lane("..x............") } } };
  ok(seedOf(plain) === seedOf(withEmpty), "an empty bass changes nothing (the seed is exactly what it was)");
  ok(seedOf(plain) !== seedOf(withNote) && seedOf(withNote) !== seedOf(other), "a bass note, and where it is, change the seed");
  ok(seedOf({ ...withNote, bass: { ...withNote.bass, muted: true, hidden: true, volume: 0.3 } }) === seedOf(withNote), "mute, hide and volume do not change the seed (like the melody's)");
  ok(seedOf({ ...withNote, bass: { ...withNote.bass, voice: "pad" } }) !== seedOf(withNote), "the voice does, because it changes the sound");
}

// ---- the audio paths include the bass ----
{
  const withBass = song({ voice: "pad", notes: { C2: lane("x...............") } });
  const r = await E.renderLoopAudio(withBass, { loops: 1 });
  const peaks = await E.renderWaveformPeaks(withBass, 20);
  ok(r.loopSamples === Math.round(STEP * 16 * 44100) && peaks.length === 20, "the offline renders accept a song with a bass line (they schedule it through the same code as live playback)", [r.loopSamples, peaks.length]);
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
