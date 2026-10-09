// A recording stand-in for Web Audio plus a loader for the song engine, shared by the song tests (not a test itself: the runner only
// picks up *.test.mjs). Every param remembers each call with its time, every oscillator remembers when it was started and stopped.
import fs from "node:fs";
import vm from "node:vm";

export function makeParam(initial = 0) {
  const p = { value: initial, calls: [] };
  const rec = (kind) => (v, t) => { p.calls.push({ kind, v, t }); return p; };
  p.setValueAtTime = rec("set");
  p.linearRampToValueAtTime = rec("lin");
  p.exponentialRampToValueAtTime = rec("exp");
  p.setTargetAtTime = (v, t, tc) => { p.calls.push({ kind: "target", v, t, tc }); return p; };
  p.cancelScheduledValues = () => p;
  return p;
}
function makeNode(kind, ctx) {
  const node = { kind, out: [], gain: makeParam(1), frequency: makeParam(440), Q: makeParam(1), detune: makeParam(0), type: "sine", fftSize: 0, started: null, stopped: null };
  node.setPeriodicWave = (w) => { node.wave = w; node.type = "custom"; };
  node.connect = (to) => { node.out.push(to); return to; };
  node.start = (t) => { node.started = t; };
  node.stop = (t) => { node.stopped = t; };
  ctx.nodes.push(node);
  return node;
}
export function makeCtx(rate = 44100) {
  const ctx = { nodes: [], sampleRate: rate, currentTime: 0, destination: { kind: "destination", out: [] } };
  ctx.createGain = () => makeNode("gain", ctx);
  ctx.createOscillator = () => makeNode("osc", ctx);
  ctx.createBufferSource = () => makeNode("source", ctx);
  ctx.createBiquadFilter = () => makeNode("filter", ctx);
  ctx.createAnalyser = () => makeNode("analyser", ctx);
  ctx.createWaveShaper = () => makeNode("shaper", ctx);
  ctx.createConvolver = () => makeNode("convolver", ctx);
  ctx.createDelay = () => { const n = makeNode("delay", ctx); n.delayTime = makeParam(0); return n; };
  // the nodes a later stage of the engine will use (a pan, a compressor, a stereo merge, a custom wave, a worklet): here so a test can build them
  ctx.createStereoPanner = () => { const n = makeNode("panner", ctx); n.pan = makeParam(0); return n; };
  ctx.createDynamicsCompressor = () => {
    const n = makeNode("compressor", ctx);
    n.threshold = makeParam(-24); n.knee = makeParam(30); n.ratio = makeParam(12); n.attack = makeParam(0.003); n.release = makeParam(0.25); n.reduction = 0;
    return n;
  };
  ctx.createChannelMerger = (inputs = 6) => { const n = makeNode("merger", ctx); n.inputs = inputs; return n; };
  ctx.createChannelSplitter = (outputs = 6) => { const n = makeNode("splitter", ctx); n.outputs = outputs; return n; };
  ctx.createPeriodicWave = (real, imag) => ({ kind: "wave", real: Array.from(real), imag: Array.from(imag) });
  ctx.audioWorklet = { addModule: async () => {} };
  ctx.createBuffer = (channels, length, sampleRate) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
  };
  return ctx;
}
// The engine puts a soft limiter in front of the speakers: a quarter-gain into a waveshaper with a 4097-point curve, into the destination.
// These find it and look through it, so a test can still ask "what feeds the output" and "how many saturators does this voice have".
const isLimiterShaper = (n) => n.kind === "shaper" && !!n.curve && n.curve.length === 4097;
export const limiterShaper = (ctx) => ctx.nodes.find(isLimiterShaper);
export const limiterIn = (ctx) => { const s = limiterShaper(ctx); return s ? ctx.nodes.find((n) => n.kind === "gain" && n.out.includes(s)) : undefined; };
// True when a node's output is what the listener hears: the destination itself, or the limiter in front of it.
export const reachesOutput = (ctx, node) => node.out.includes(ctx.destination) || (!!limiterIn(ctx) && node.out.includes(limiterIn(ctx)));
// True when the signal of a node can reach the speakers by any route, however many stages (a pan, a compressor, the limiter) sit between: use this
// when the question is "is it audible", and reachesOutput when the question is "does it feed the output stage directly".
export function audible(ctx, node) {
  const seen = new Set();
  const walk = (n) => {
    if (n === ctx.destination) return true;
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return (n.out || []).some(walk);
  };
  return walk(node);
}
export const count = (ctx, kind) => ctx.nodes.filter((n) => n.kind === kind && !isLimiterShaper(n)).length;

export const offlineLog = [];
class FakeOffline {
  constructor(channels, length, rate) {
    Object.assign(this, makeCtx(rate));
    this.length = length;
    offlineLog.push(this);
  }
  async startRendering() { return { getChannelData: () => new Float32Array(this.length) }; }
}

const sandbox = () => vm.createContext({ Math, Number, Object, Array, JSON, Float32Array, Promise, WeakMap, Map, Set, Date, isFinite, parseFloat, String, console });
// extra: anything to put in the engine's global scope (a test passes its own setTimeout/clearTimeout to drive the player by hand)
export function loadEngine(extra = {}) {
  const window = { OfflineAudioContext: FakeOffline };
  const context = sandbox();
  context.window = window;
  Object.assign(context, extra);
  vm.runInContext(fs.readFileSync(new URL("../public/song-engine.js", import.meta.url), "utf8"), context);
  return window.SongEngine;
}
export function loadSongFiles() {
  const window = {};
  const context = sandbox();
  context.window = window;
  vm.runInContext(fs.readFileSync(new URL("../public/studio/song-files.js", import.meta.url), "utf8"), context);
  return window.SongFiles;
}

export const lane = (str) => Array.from(str, (c) => c === "x");
// A song with only a melody (so every oscillator and filter in the context is the melody's).
export const melodyOnly = (extra = {}, notes = { C4: lane("x...............") }, melody = {}) => ({
  tempo: 120, kit: "acoustic", master_volume: 1, tracks: {}, melody: { waveform: "sine", notes, ...melody }, ...extra,
});
