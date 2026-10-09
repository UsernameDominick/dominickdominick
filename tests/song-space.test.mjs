// The song engine's Space (reverb) send: off means no extra audio nodes at all, on builds one
// seeded convolver off the master bus, and previews/renders treat it the way the player does.
import fs from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

// A recording stand-in for the Web Audio graph. Every node remembers what it was connected to,
// and every param remembers the last value it was asked to reach.
function makeParam(initial = 0) {
  const p = { value: initial, target: null, calls: [] };
  p.setValueAtTime = (v) => { p.calls.push(["set", v]); return p; };
  p.linearRampToValueAtTime = (v) => { p.target = v; p.calls.push(["ramp", v]); return p; };
  p.exponentialRampToValueAtTime = () => p;
  p.cancelScheduledValues = () => p;
  return p;
}
function makeNode(kind, ctx) {
  const node = { kind, out: [], gain: makeParam(1), frequency: makeParam(440), Q: makeParam(1), detune: makeParam(0), type: "sine", fftSize: 0 };
  node.connect = (to) => { node.out.push(to); return to; };
  node.start = () => {};
  node.stop = () => {};
  ctx.nodes.push(node);
  return node;
}
// The engine puts a soft limiter (a quarter-gain into a 4097-point waveshaper) in front of the destination: "reaches the speakers" means the
// destination or that limiter's input.
const isLimiterShaper = (n) => n.kind === "shaper" && !!n.curve && n.curve.length === 4097;
const toOutput = (ctx, n) => {
  const shaper = ctx.nodes.find(isLimiterShaper);
  const pre = shaper && ctx.nodes.find((x) => x.kind === "gain" && x.out.includes(shaper));
  return n.out.includes(ctx.destination) || (!!pre && n.out.includes(pre));
};
function makeCtx(rate = 44100) {
  const ctx = { nodes: [], sampleRate: rate, currentTime: 0, destination: { kind: "destination", out: [] } };
  ctx.createGain = () => makeNode("gain", ctx);
  ctx.createOscillator = () => makeNode("osc", ctx);
  ctx.createBufferSource = () => makeNode("source", ctx);
  ctx.createBiquadFilter = () => makeNode("filter", ctx);
  ctx.createAnalyser = () => makeNode("analyser", ctx);
  ctx.createConvolver = () => makeNode("convolver", ctx);
  ctx.createWaveShaper = () => makeNode("shaper", ctx);
  ctx.createBuffer = (channels, length, sampleRate) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
  };
  return ctx;
}
const count = (ctx, kind) => ctx.nodes.filter((n) => n.kind === kind).length;

const offlineLog = [];
class FakeOffline {
  constructor(channels, length, rate) {
    Object.assign(this, makeCtx(rate));
    this.length = length;
    offlineLog.push(this);
  }
  async startRendering() { return { getChannelData: () => new Float32Array(this.length) }; }
}
const window = { OfflineAudioContext: FakeOffline };
vm.runInContext(fs.readFileSync(new URL("../public/song-engine.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, Object, Array, JSON, Float32Array, Promise, WeakMap, Set, Date, isFinite, parseFloat, String }));
const E = window.SongEngine;

const song = (extra = {}) => ({
  tempo: 120, kit: "acoustic",
  tracks: { kick: Array.from({ length: 16 }, (_, i) => i % 4 === 0), snare: Array.from({ length: 16 }, (_, i) => i % 8 === 4) },
  melody: { waveform: "sine", notes: { C4: Array.from({ length: 16 }, (_, i) => i === 0) } },
  master_volume: 1,
  ...extra,
});
const playAll = (ctx, data) => { for (let s = 0; s < 16; s++) E.scheduleStep(ctx, data, s, s * 0.125, () => 0.5); };
const sends = (ctx) => ctx.nodes.filter((n) => n.kind === "convolver");

// ---- off: nothing extra is built, and a song without the setting behaves the same ----
{
  const a = makeCtx(); playAll(a, song());
  const b = makeCtx(); playAll(b, song({ space: 0 }));
  ok(count(a, "convolver") === 0 && count(b, "convolver") === 0, "Space off (missing or 0) builds no convolver");
  ok(a.nodes.length === b.nodes.length, "a song without a Space value builds exactly the same graph as Space 0", [a.nodes.length, b.nodes.length]);
  const c = makeCtx(); E.setSpace(c, 0); E.setSpace(c, NaN); E.setSpace(c, "abc"); E.setSpace(c, undefined);
  ok(c.nodes.length === 0, "setSpace with 0 / junk on a fresh context creates nothing");
}

// ---- on: one send off the master bus, at the right level ----
{
  const ctx = makeCtx();
  playAll(ctx, song({ space: 50 }));
  const [conv] = sends(ctx);
  ok(sends(ctx).length === 1, "Space on builds exactly one convolver, however many steps play");
  const master = ctx.nodes.find((n) => n.kind === "gain" && toOutput(ctx, n) && n.out.includes(conv));
  ok(!!master, "the master bus feeds both the destination (dry) and the convolver");
  const wet = conv.out[0];
  ok(wet && wet.kind === "gain" && toOutput(ctx, wet), "convolver -> wet gain -> the speakers");
  ok(Math.abs(wet.gain.target - 0.9) < 1e-9, "50% Space is a 0.9 wet level", wet.gain.target);
}
for (const [value, want] of [[100, 1.8], [150, 1.8], [25, 0.45], [-20, 0], ["60", 1.08]]) {
  const ctx = makeCtx();
  E.setSpace(ctx, 50); // build it
  E.setSpace(ctx, value);
  const wet = sends(ctx)[0].out[0];
  ok(Math.abs(wet.gain.target - want) < 1e-9, `Space ${JSON.stringify(value)} -> wet ${want}`, wet.gain.target);
}
{
  const ctx = makeCtx();
  E.setSpace(ctx, 80);
  E.setSpace(ctx, 0);
  const wet = sends(ctx)[0].out[0];
  ok(sends(ctx).length === 1 && wet.gain.target === 0, "turning Space back to 0 mutes the send but keeps the one node");
}
{
  const ctx = makeCtx();
  E.setSpace(ctx, 40, true);
  const wet = sends(ctx)[0].out[0];
  ok(Math.abs(wet.gain.value - 0.72) < 1e-9 && wet.gain.calls.length === 0, "immediate sets the level outright with no ramp", wet.gain.value);
}

// ---- the room itself: stereo, one-and-a-bit seconds, decaying, and the same every time ----
{
  const a = makeCtx(); E.setSpace(a, 50);
  const b = makeCtx(); E.setSpace(b, 90);
  const ia = sends(a)[0].buffer, ib = sends(b)[0].buffer;
  ok(ia.numberOfChannels === 2 && Math.abs(ia.length - 1.8 * 44100) <= 1, "impulse response is stereo and about 1.8 s", [ia.numberOfChannels, ia.length]);
  let same = true;
  for (let c = 0; c < 2; c++) { const x = ia.getChannelData(c), y = ib.getChannelData(c); for (let i = 0; i < x.length; i += 97) if (x[i] !== y[i]) same = false; }
  ok(same, "the impulse response is identical across contexts (fixed seed), whatever the Space level");
  const l = ia.getChannelData(0), r = ia.getChannelData(1);
  let diff = 0; for (let i = 0; i < 2000; i++) if (l[i] !== r[i]) diff++;
  ok(diff > 1500, "the two channels are decorrelated", diff);
  const rms = (arr, from, to) => { let s = 0; for (let i = from; i < to; i++) s += arr[i] * arr[i]; return Math.sqrt(s / (to - from)); };
  const n = l.length;
  ok(rms(l, n * 0.9, n) < rms(l, Math.round(n * 0.05), Math.round(n * 0.15)) * 0.05, "the tail dies away (at least 26 dB lower by the end)");
  let eased = Math.abs(l[0]) < 1e-6;
  for (let i = 0; i < 200; i++) if (Math.abs(l[i]) > i / (44100 * 0.004) + 1e-9) eased = false;
  ok(eased, "a 4 ms fade-in eases the start of the tail (no hard click at the attack)");
  let finite = true; for (const v of l) if (!Number.isFinite(v)) finite = false;
  ok(finite, "no NaN in the impulse response");
  const hi = makeCtx(48000); E.setSpace(hi, 50);
  ok(Math.abs(sends(hi)[0].buffer.length - 1.8 * 48000) <= 1, "the length follows the context's sample rate");
}

// ---- the meter hears the reverb whichever order things are built ----
{
  const ctx = makeCtx();
  E.getPeakMeterAnalyser(ctx);
  E.setSpace(ctx, 50);
  const analyser = ctx.nodes.find((n) => n.kind === "analyser");
  ok(sends(ctx)[0].out[0].out.includes(analyser), "reverb built after the meter is wired into it");
  const ctx2 = makeCtx();
  E.setSpace(ctx2, 50);
  E.getPeakMeterAnalyser(ctx2);
  const analyser2 = ctx2.nodes.find((n) => n.kind === "analyser");
  ok(sends(ctx2)[0].out[0].out.includes(analyser2), "meter built after the reverb picks it up too");
}

// ---- offline paths ----
{
  offlineLog.length = 0;
  await E.renderWaveformPeaks(song({ space: 100 }), 50);
  ok(offlineLog.length === 1 && count(offlineLog[0], "convolver") === 0, "the waveform preview ignores Space (a tail would smear the pattern)");
  offlineLog.length = 0;
  await E.renderLoopAudio(song({ space: 70 }), { loops: 1 });
  const c = offlineLog[0];
  const wet = sends(c)[0] && sends(c)[0].out[0];
  ok(sends(c).length === 1 && wet && Math.abs(wet.gain.value - 1.26) < 1e-9, "audio export renders with the song's Space from its first sample", wet && wet.gain.value);
  offlineLog.length = 0;
  await E.renderLoopAudio(song(), { loops: 1 });
  ok(count(offlineLog[0], "convolver") === 0, "audio export of a dry song builds no reverb");
}
ok(typeof E.setSpace === "function", "setSpace is exported for the builder");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
