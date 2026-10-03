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

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
