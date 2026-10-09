// Melody instruments: a song with no melody.voice plays exactly the plain waveform note; a named voice shapes the note (envelope, filter,
// detuned twin, sub-octave, partial, vibrato), is held for the note's length and released, and stays safe against bad data.
import { makeCtx, count, loadEngine, loadSongFiles, lane, melodyOnly } from "./fake-audio.mjs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const E = loadEngine();
const F = loadSongFiles();
const STEP = 60 / 120 / 4; // a sixteenth at 120 BPM

const play = (data, step = 0, time = 0) => { const ctx = makeCtx(); E.scheduleStep(ctx, data, step, time, () => 0.5); return ctx; };
const oscs = (ctx) => ctx.nodes.filter((n) => n.kind === "osc");

// ---- the list of voices ----
{
  const names = Object.keys(E.MELODY_VOICES);
  ok(names.length >= 5 && names.every((n) => E.MELODY_VOICES[n].label && E.MELODY_VOICES[n].wave), "every voice has a label and its own oscillator type", names);
  ok(JSON.stringify(F.MELODY_VOICES) === JSON.stringify(names), "the import cleaner knows exactly the engine's voices (same names, same order)", { engine: names, files: F.MELODY_VOICES });
}

// ---- the plain note is untouched ----
{
  const ctx = play(melodyOnly({}, { C4: lane("x...............") }, { waveform: "square" }));
  ok(oscs(ctx).length === 1 && oscs(ctx)[0].type === "square" && count(ctx, "filter") === 0, "no voice: one oscillator of the chosen waveform and no filter, as before", { osc: oscs(ctx).length, type: oscs(ctx)[0].type, filters: count(ctx, "filter") });
  const bad = play(melodyOnly({}, { C4: lane("x...............") }, { waveform: "sawtooth", voice: "nope" }));
  ok(oscs(bad).length === 1 && oscs(bad)[0].type === "sawtooth" && count(bad, "filter") === 0, "an unknown voice name falls back to the plain note");
  for (const evil of ["constructor", "__proto__", "toString", "hasOwnProperty", 7, null, {}, ["pluck"]]) {
    ok(E.melodyVoiceOf({ melody: { voice: evil } }) === "", `a voice of ${JSON.stringify(evil)} is not a voice`);
  }
  ok(E.melodyVoiceOf({}) === "" && E.melodyVoiceOf(null) === "" && E.melodyVoiceOf({ melody: {} }) === "" && E.melodyVoiceOf({ melody: { voice: "pad" } }) === "pad", "missing data is no voice, a real name is that voice");
}

// ---- each voice builds what it says ----
const shape = {
  pluck: { osc: 1, filter: 1, type: "sawtooth" },
  lead: { osc: 4, filter: 1, type: "square" }, // three twins and the vibrato LFO
  pad: { osc: 3, filter: 1, type: "sawtooth" },
  bass: { osc: 2, filter: 1, type: "sawtooth" }, // plus the sub-octave
  bell: { osc: 2, filter: 0, type: "sine" }, // plus the inharmonic partial
};
for (const [name, want] of Object.entries(shape)) {
  const ctx = play(melodyOnly({}, { C4: lane("x...............") }, { waveform: "sine", voice: name }));
  ok(oscs(ctx).length === want.osc && count(ctx, "filter") === want.filter && oscs(ctx)[0].type === want.type, `${name}: ${want.osc} oscillators, ${want.filter} filter, ${want.type} (ignores the waveform select)`, { osc: oscs(ctx).length, filter: count(ctx, "filter"), type: oscs(ctx)[0].type });
  const everyStopped = oscs(ctx).every((o) => o.started === 0 && o.stopped > 0);
  ok(everyStopped, `${name}: every oscillator is started and given an end`, oscs(ctx).map((o) => [o.started, o.stopped]));
}

// ---- envelope order and length ----
{
  // the envelope gain is the one wired to the voice output: find a gain whose param has a ramp to the peak
  const envOf = (ctx) => ctx.nodes.filter((n) => n.kind === "gain" && n.gain.calls.some((c) => c.kind === "lin" && c.v > 0.05))[0];
  for (const name of Object.keys(E.MELODY_VOICES)) {
    const env = envOf(play(melodyOnly({}, { C4: lane("x...............") }, { voice: name })));
    const times = env.gain.calls.map((c) => c.t);
    ok(times.every((t, i) => i === 0 || t >= times[i - 1]), `${name}: envelope events are in time order (Web Audio requires it)`, times);
    ok(env.gain.calls.every((c) => c.kind === "set" ? c.v > 0 : c.v > 0), `${name}: the envelope never targets zero (exponential ramps need a positive value)`);
  }
  // a held voice lasts as long as its note plus the release; a struck voice rings for its decay whatever the length
  const lone = oscs(play(melodyOnly({}, { C4: lane("x...............") }, { voice: "bass" })))[0].stopped;
  const tied = oscs(play(melodyOnly({}, { C4: lane("xxx.............") }, { voice: "bass", ties: { C4: lane(".xx.............") } })))[0].stopped;
  const b = E.MELODY_VOICES.bass;
  const gateOf = (length) => Math.max(length, b.attack + b.decay); // a note is never cut into its decay
  ok(Math.abs(lone - (gateOf(STEP) + b.release + 0.02)) < 1e-9, "a one-step note is held to the end of its decay, then released", { lone });
  ok(Math.abs(tied - (gateOf(3 * STEP) + b.release + 0.02)) < 1e-9 && tied > lone, "a note tied across three steps is held for all three, then released", { tied, expected: gateOf(3 * STEP) + b.release + 0.02 });
  const bellShort = oscs(play(melodyOnly({}, { C4: lane("x...............") }, { voice: "bell" })))[0].stopped;
  const bellTied = oscs(play(melodyOnly({}, { C4: lane("xxx.............") }, { voice: "bell", ties: { C4: lane(".xx.............") } })))[0].stopped;
  ok(bellShort === bellTied, "a struck voice (bell) rings for its own decay however long the note is");
  const gate = oscs(play(melodyOnly({}, { C4: lane("x...............") }, { voice: "pad" })))[0];
  ok(gate.stopped > STEP + E.MELODY_VOICES.pad.release * 0.5, "a pad's release carries on after the note's end", { stopped: gate.stopped, step: STEP });
}

// ---- notes scheduled later start later, and strength still scales volume ----
{
  const ctx = play(melodyOnly({}, { C4: lane("....x...........") }, { voice: "lead" }), 4, 1.5);
  ok(oscs(ctx).every((o) => o.started === 1.5), "a voice starts at the step's time", oscs(ctx).map((o) => o.started));
}

// ---- offline renders (waveform preview and WAV export) accept a voice ----
{
  const data = melodyOnly({}, { C4: lane("x...x...x...x...") }, { voice: "lead" });
  const peaks = await E.renderWaveformPeaks(data, 50);
  ok(Array.isArray(peaks) && peaks.length === 50, "the waveform preview renders with a voice");
  const wav = await E.renderLoopAudio(data, { loops: 2 });
  ok(wav.samples.length === wav.loopSamples * 2, "the audio export renders with a voice");
}

// ---- the import cleaner keeps a real voice and held notes, and drops the rest ----
{
  const base = (melody) => ({ tempo: 100, melody });
  const kept = F.cleanSong(base({ voice: "pluck", notes: { C4: lane("xx.............."), D4: lane("x...............") }, ties: { C4: lane(".x.............."), D4: lane(".x..............") } }));
  ok(kept.melody.voice === "pluck", "a real voice survives import");
  ok(kept.melody.ties && kept.melody.ties.C4[1] === true && !kept.melody.ties.D4, "a tie survives import where the note is on at both steps, and a stale one is dropped", kept.melody.ties);
  ok(F.cleanSong(base({ voice: "evil<script>", notes: {} })).melody.voice === undefined, "an invalid voice is dropped on import");
  ok(F.cleanSong(base({ ties: { C4: lane(".x..............") }, notes: { C4: lane("x...............") } })).melody.ties === undefined, "a tie with no note before it is dropped");
  ok(F.cleanSong(base({ notes: {} })).melody.voice === undefined && F.cleanSong(base({ notes: {} })).melody.ties === undefined, "a song without them stays without them");
  const roundTrip = F.parseImport(F.exportJson("T", kept));
  ok(JSON.stringify(roundTrip.data.melody) === JSON.stringify(kept.melody), "export then import keeps the voice and the held notes exactly");
}

// ---- the extra drum voices ----
{
  const drums = (tracks, extra = {}) => ({ tempo: 120, kit: "acoustic", master_volume: 1, tracks, melody: { waveform: "sine", notes: {} }, ...extra });
  const hit = (name, step = 0) => ({ [name]: Array.from({ length: 16 }, (_, i) => i === step) });
  const all = ["kick", "snare", "hihat", "clap", "openhat", "rim", "tom", "crash"];
  ok(JSON.stringify([...E.DRUM_VOICES].sort()) === JSON.stringify([...all].sort()), "the engine plays exactly the eight drum voices", E.DRUM_VOICES);
  ok(JSON.stringify([...F.CORE_DRUMS, ...F.EXTRA_DRUMS].sort()) === JSON.stringify([...all].sort()), "the file helper knows the same eight", [F.CORE_DRUMS, F.EXTRA_DRUMS]);
  ok(all.every((d) => Number.isInteger(F.GM_DRUMS[d]) && F.GM_DRUMS[d] >= 27 && F.GM_DRUMS[d] <= 87), "every voice has a General MIDI percussion note");
  ok(new Set(all.map((d) => F.GM_DRUMS[d])).size === 8, "and no two share one");

  // what each new voice builds, in every kit
  for (const kit of ["acoustic", "electronic", "808"]) {
    const make = (name) => { const ctx = makeCtx(); E.scheduleStep(ctx, drums(hit(name), { kit }), 0, 0, () => 0.5); return ctx; };
    const open = make("openhat"), tom = make("tom"), rim = make("rim"), crash = make("crash");
    ok(count(open, "osc") === 6 && count(open, "source") === 1 && count(open, "filter") === 2 && count(tom, "osc") === 1 && count(tom, "source") === 1 && count(rim, "osc") === 2 && count(rim, "source") === 1 && count(crash, "osc") === 6 && count(crash, "source") === 2 && count(crash, "filter") === 3, `${kit}: open hat is noise, tom one oscillator, rim two tones and a click, crash two noise layers`, { open: count(open, "source"), tom: count(tom, "osc"), rim: [count(rim, "osc"), count(rim, "source")], crash: count(crash, "source") });
  }
  // the open hat rings longer than the closed one, the crash longer still
  const lengthOf = (name) => { const ctx = makeCtx(); E.scheduleStep(ctx, drums(hit(name)), 0, 0, () => 0.5); return Math.max(...ctx.nodes.filter((n) => n.kind === "gain").flatMap((n) => n.gain.calls.filter((c) => c.kind === "exp").map((c) => c.t))); };
  ok(lengthOf("hihat") < lengthOf("openhat") && lengthOf("openhat") < lengthOf("crash"), "decay lengths run closed hat < open hat < crash", [lengthOf("hihat"), lengthOf("openhat"), lengthOf("crash")]);

  // a song without the extra rows never touches them, and a muted extra is silent
  const core = makeCtx(); E.scheduleStep(core, drums({ kick: Array(16).fill(true) }), 0, 0, () => 0.5);
  ok(count(core, "source") === 1 && count(core, "osc") === 1, "a song with only the core rows plays only those (a kick is an oscillator and its beater)");
  const muted = makeCtx(); E.scheduleStep(muted, drums(hit("crash"), { trackMeta: { crash: { muted: true } } }), 0, 0, () => 0.5);
  ok(muted.nodes.filter((n) => n.kind === "source" || n.kind === "osc").length === 0, "a muted extra drum is silent");
  const unknown = makeCtx(); E.scheduleStep(unknown, drums({ cowbell: Array(16).fill(true) }), 0, 0, () => 0.5);
  ok(unknown.nodes.filter((n) => n.kind === "source" || n.kind === "osc").length === 0, "a row the engine has no voice for makes no sound");

  // choke: a closed hat (or the next open hat) cuts a ringing open hat; nothing before it starts or after it has died
  const chokeCalls = (ctx) => ctx.nodes.flatMap((n) => n.gain.calls.filter((c) => c.kind === "target"));
  const run = (rows, steps) => { const ctx = makeCtx(); const data = drums(rows); for (const step of steps) E.scheduleStep(ctx, data, step, step * STEP, () => 0.5); return ctx; };
  const both = { openhat: Array.from({ length: 16 }, (_, i) => i === 0), hihat: Array.from({ length: 16 }, (_, i) => i === 1) };
  const cut = chokeCalls(run(both, [0, 1]));
  ok(cut.length === 1 && Math.abs(cut[0].t - STEP) < 1e-9 && cut[0].v < 0.001, "a closed hat one step after an open hat cuts it at that moment", cut);
  const late = { openhat: Array.from({ length: 16 }, (_, i) => i === 0), hihat: Array.from({ length: 16 }, (_, i) => i === 8) };
  ok(chokeCalls(run(late, [0, 8])).length === 0, "a closed hat after the open hat has died away cuts nothing", chokeCalls(run(late, [0, 8])));
  const before = { hihat: Array.from({ length: 16 }, (_, i) => i === 0), openhat: Array.from({ length: 16 }, (_, i) => i === 1) };
  ok(chokeCalls(run(before, [0, 1])).length === 0, "a closed hat before the open one cuts nothing");
  const twice = { openhat: Array.from({ length: 16 }, (_, i) => i === 0 || i === 1) };
  ok(chokeCalls(run(twice, [0, 1])).length === 1, "an open hat struck again cuts the one still ringing");
  const same = { openhat: Array.from({ length: 16 }, (_, i) => i === 0), hihat: Array.from({ length: 16 }, (_, i) => i === 0) };
  ok(chokeCalls(run(same, [0])).length === 0, "an open and a closed hat on the same step both sound (no choke)");
  // each audio context keeps its own open hat
  const a = makeCtx(), c2 = makeCtx();
  E.scheduleStep(a, drums({ openhat: Array(16).fill(true) }), 0, 0, () => 0.5);
  E.scheduleStep(c2, drums({ hihat: Array(16).fill(true) }), 0, STEP, () => 0.5);
  ok(chokeCalls(c2).length === 0, "a hat in one audio context never cuts an open hat in another");

  // offline renders accept the new rows
  const peaks = await E.renderWaveformPeaks(drums({ openhat: Array(16).fill(true), tom: Array(16).fill(true), rim: Array(16).fill(true), crash: hit("crash").crash }), 40);
  ok(peaks.length === 40, "the waveform preview renders a song that uses the extra drums");
}

// ---- file helper: MIDI notes and the import cleaner ----
{
  const lane16 = (str) => Array.from(str, (c) => c === "x");
  const song = { tempo: 120, tracks: { kick: lane16("x..............."), openhat: lane16("..x............."), rim: lane16("....x..........."), tom: lane16("......x........."), crash: lane16("x...............") }, trackMeta: {}, melody: { notes: {} } };
  const midi = F.buildMidi(song, "x");
  ok(midi.notes === 5, "every extra drum's hits are counted in the MIDI file", midi.notes);
  const bytes = Array.from(midi.bytes);
  const hasNote = (n) => bytes.some((v, i) => v === 0x99 && bytes[i + 1] === n);
  ok(hasNote(36) && hasNote(46) && hasNote(37) && hasNote(47) && hasNote(49), "they are written as General MIDI 46 (open hat), 37 (rim), 47 (tom) and 49 (crash) on channel 10");
  const none = F.buildMidi({ tempo: 120, tracks: { kick: lane16("x...............") }, trackMeta: {}, melody: { notes: {} } }, "x");
  ok(none.notes === 1, "a song without extra rows writes none");

  const cleaned = F.cleanSong({ tracks: { kick: lane16("x"), crash: lane16("x"), bogus: lane16("x") }, trackMeta: { crash: { color: "#112233", muted: true }, kick: {} } });
  ok(Object.keys(cleaned.tracks).sort().join() === "clap,crash,hihat,kick,snare", "import keeps the core rows, an extra row the file has, and nothing else", Object.keys(cleaned.tracks));
  ok(cleaned.trackMeta.crash.color === "#112233" && cleaned.trackMeta.crash.muted === true && !cleaned.trackMeta.tom, "an extra row keeps its colour and mute, an absent one gets no settings");
  ok(Object.keys(F.cleanSong({}).tracks).sort().join() === "clap,hihat,kick,snare", "a song file with no rows gets exactly the four core ones");
  const full = F.cleanSong({ tracks: { openhat: lane16("x..x"), rim: lane16("x"), tom: lane16("x"), crash: lane16("x") } });
  const round = F.parseImport(F.exportJson("T", full));
  ok(JSON.stringify(round.data.tracks) === JSON.stringify(full.tracks) && JSON.stringify(round.data.trackMeta) === JSON.stringify(full.trackMeta), "export then import keeps all eight rows exactly");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
