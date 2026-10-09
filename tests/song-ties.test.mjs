// Held notes (melody.ties): a tie joins a note to the same note on the step before, so the two play as one longer note. The engine
// plays it; the pattern tools keep ties with their notes. Run against a recording stand-in for the Web Audio graph.
import fs from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

function makeParam(initial = 0) {
  const p = { value: initial };
  p.setValueAtTime = () => p; p.linearRampToValueAtTime = () => p; p.exponentialRampToValueAtTime = () => p; p.cancelScheduledValues = () => p;
  return p;
}
function makeCtx(rate = 44100) {
  const ctx = { nodes: [], sampleRate: rate, currentTime: 0, destination: { kind: "destination", connect() {} }, notes: [] };
  const node = (kind) => {
    const n = { kind, gain: makeParam(1), frequency: makeParam(440), Q: makeParam(1), detune: makeParam(0), type: "sine", fftSize: 0 };
    n.connect = (to) => to; n.start = () => {}; n.stop = () => {};
    ctx.nodes.push(n);
    return n;
  };
  ctx.createGain = () => node("gain");
  ctx.createBufferSource = () => node("source");
  ctx.createBiquadFilter = () => node("filter");
  ctx.createAnalyser = () => node("analyser");
  ctx.createConvolver = () => node("convolver");
  ctx.createWaveShaper = () => node("shaper");
  ctx.createOscillator = () => {
    const o = node("osc");
    const rec = { freq: 0, start: null, stop: null };
    o.start = (t) => { rec.start = t; rec.freq = o.frequency.value; };
    o.stop = (t) => { rec.stop = t; };
    ctx.notes.push(rec);
    return o;
  };
  ctx.createBuffer = (channels, length, sampleRate) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
  };
  return ctx;
}
const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/song-engine.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, Object, Array, JSON, Float32Array, Promise, WeakMap, Set, Date, isFinite, parseFloat, console }));
const E = window.SongEngine;
const STEP = 60 / 120 / 4; // 16ths at 120 bpm
const row = (...on) => Array.from({ length: 16 }, (_, i) => on.includes(i));
const song = (notes, ties) => ({ tempo: 120, kit: "acoustic", tracks: {}, master_volume: 1, melody: { waveform: "sine", notes, ...(ties ? { ties } : {}) } });
const play = (data) => {
  const ctx = makeCtx();
  for (let s = 0; s < 16; s++) E.scheduleStep(ctx, data, s, s * STEP, () => 0.5);
  return ctx.notes.map((n) => ({ at: Math.round(n.start / STEP), steps: Math.round(((n.stop - n.start) / STEP) * 1000) / 1000 }));
};
const flags = (...on) => row(...on);

// ---- no ties: exactly as before ----
let r = play(song({ C4: row(2, 3, 4) }));
ok(r.length === 3 && r.every((n) => n.steps === 1), "three adjacent notes with no ties are three separate one-step notes", r);
ok(E.isTiedContinuation(song({ C4: row(2, 3) }), "C4", 3) === false && E.heldSteps(song({ C4: row(2, 3) }), "C4", 2) === 1, "and nothing reads as tied");

// ---- one tie ----
let d = song({ C4: row(2, 3) }, { C4: flags(3) });
r = play(d);
ok(r.length === 1 && r[0].at === 2 && r[0].steps === 2, "two steps tied play as ONE note, struck on the first step and two steps long", r);
ok(E.isTiedContinuation(d, "C4", 3) === true && E.isTiedContinuation(d, "C4", 2) === false && E.heldSteps(d, "C4", 2) === 2, "the second step is a continuation and the first is held for two");

// ---- a run of three, and runs that touch ----
d = song({ C4: row(2, 3, 4) }, { C4: flags(3, 4) });
r = play(d);
ok(r.length === 1 && r[0].steps === 3, "a chain of ties is one note held for three steps", r);
d = song({ C4: row(2, 3, 4, 5) }, { C4: flags(3, 5) });
r = play(d);
ok(r.length === 2 && r[0].at === 2 && r[0].steps === 2 && r[1].at === 4 && r[1].steps === 2, "an untied step between two ties starts a new note: two notes of two steps", r);

// ---- other notes are unaffected ----
d = song({ C4: row(2, 3), E4: row(2, 3) }, { C4: flags(3) });
r = play(d);
ok(r.length === 3 && r.filter((n) => n.steps === 2).length === 1 && r.filter((n) => n.steps === 1).length === 2, "only the tied note is held; another note on the same steps is struck twice", r);
ok(new Set(play(song({ C4: row(2, 3), E4: row(2, 3) }, { C4: flags(3), E4: flags(3) })).map((n) => n.steps)).size === 1, "tie both and both are held");

// ---- stale flags are ignored ----
d = song({ C4: row(3) }, { C4: flags(3) });
r = play(d);
ok(r.length === 1 && r[0].steps === 1, "a tie flag with nothing before it to join does nothing", r);
d = song({ C4: row(2, 4) }, { C4: flags(3, 4) });
r = play(d);
ok(r.length === 2 && r.every((n) => n.steps === 1), "a flag on a step that is off, or after a gap, does nothing", r);
d = song({ C4: row(0, 1) }, { C4: flags(0, 1) });
r = play(d);
ok(r.length === 1 && r[0].steps === 2, "step 0 can never be a continuation (nothing ties across the loop), step 1 can be tied to it", r);
d = song({ C4: row(15, 0) }, { C4: flags(0) });
r = play(d);
ok(r.length === 2 && r.every((n) => n.steps === 1), "a flag on step 0 does not reach back to step 15", r);
d = song({ C4: row(14, 15) }, { C4: flags(15) });
r = play(d);
ok(r.length === 1 && r[0].at === 14 && r[0].steps === 2, "a held note may run to the end of the loop", r);
ok(play(song({ C4: row(2, 3) }, { C4: "garbage" })).length === 2 && play(song({ C4: row(2, 3) }, { D4: flags(3) })).length === 2 && play(song({ C4: row(2, 3) }, null)).length === 2, "ties that are junk, for a different note, or missing are ignored");

// ---- tempo and strength ----
d = { ...song({ C4: row(2, 3) }, { C4: flags(3) }), tempo: 60 };
const ctx60 = makeCtx();
for (let s = 0; s < 16; s++) E.scheduleStep(ctx60, d, s, s * (60 / 60 / 4), () => 0.5);
ok(ctx60.notes.length === 1 && Math.abs(ctx60.notes[0].stop - ctx60.notes[0].start - 0.5) < 1e-9, "at 60 bpm a two-step hold is half a second", ctx60.notes[0]);
d = song({ C4: [false, false, 0.5, 0.5, false, false, false, false, false, false, false, false, false, false, false, false] }, { C4: flags(3) });
ok(play(d).length === 1, "a held note works with soft steps too");

// ---- oddly shaped songs never throw ----
for (const odd of [{ notes: [{ step: 0, note: "C4", length: 1 }], ties: { C4: [false, true] } }, { notes: { C4: "x" }, ties: { C4: flags(3) } }, { notes: { C4: row(2, 3) }, ties: [] }, { notes: { C4: row(2, 3) }, ties: { C4: null } }, { notes: { C4: row(2, 3) }, ties: 5 }]) {
  let threw = null;
  try { play({ tempo: 120, kit: "acoustic", tracks: {}, melody: { waveform: "sine", ...odd } }); } catch (e) { threw = String(e); }
  ok(threw === null, "an old or damaged melody shape plays (or stays quiet) without throwing", threw || JSON.stringify(odd).slice(0, 60));
}
{
  // The waveform preview (and the public embed's live render) seeds its noise from the song, which now looks at ties too.
  class FakeOffline {
    constructor(channels, length, rate) { Object.assign(this, makeCtx(rate)); this.length = length; }
    async startRendering() { return { getChannelData: () => new Float32Array(this.length) }; }
  }
  window.OfflineAudioContext = FakeOffline;
  for (const odd of [{ notes: [{ step: 0, note: "C4", length: 1 }], ties: { C4: flags(3) } }, { notes: { C4: row(2, 3) }, ties: { C4: flags(3) } }, { notes: { C4: row(2, 3) }, ties: 5 }, { notes: { C4: "x" }, ties: { C4: flags(3) } }]) {
    let threw = null;
    try { await E.renderWaveformPeaks({ tempo: 120, kit: "acoustic", tracks: { kick: row(0) }, melody: { waveform: "sine", ...odd } }, 16); } catch (e) { threw = String(e); }
    ok(threw === null, "the waveform preview renders an old or damaged melody shape without throwing", threw || JSON.stringify(odd).slice(0, 60));
  }
}

// ---- muted melody stays silent ----
d = song({ C4: row(2, 3) }, { C4: flags(3) }); d.melody.muted = true;
ok(play(d).length === 0, "a muted melody plays no held notes either");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
