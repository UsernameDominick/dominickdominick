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
  p.cancelScheduledValues = () => p;
  return p;
}
function makeNode(kind, ctx) {
  const node = { kind, out: [], gain: makeParam(1), frequency: makeParam(440), Q: makeParam(1), detune: makeParam(0), type: "sine", fftSize: 0, started: null, stopped: null };
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
  ctx.createConvolver = () => makeNode("convolver", ctx);
  ctx.createDelay = () => { const n = makeNode("delay", ctx); n.delayTime = makeParam(0); return n; };
  ctx.createBuffer = (channels, length, sampleRate) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
  };
  return ctx;
}
export const count = (ctx, kind) => ctx.nodes.filter((n) => n.kind === kind).length;

export const offlineLog = [];
class FakeOffline {
  constructor(channels, length, rate) {
    Object.assign(this, makeCtx(rate));
    this.length = length;
    offlineLog.push(this);
  }
  async startRendering() { return { getChannelData: () => new Float32Array(this.length) }; }
}

const sandbox = () => vm.createContext({ Math, Number, Object, Array, JSON, Float32Array, Promise, WeakMap, Set, Date, isFinite, parseFloat, String, console });
export function loadEngine() {
  const window = { OfflineAudioContext: FakeOffline };
  const context = sandbox();
  context.window = window;
  vm.runInContext(fs.readFileSync(new URL("../public/song-engine.js", import.meta.url), "utf8"), context);
  return window.SongEngine;
}
export function loadSongFiles() {
  const window = {};
  const context = sandbox();
  context.window = window;
  vm.runInContext(fs.readFileSync(new URL("../public/admin/song-files.js", import.meta.url), "utf8"), context);
  return window.SongFiles;
}

export const lane = (str) => Array.from(str, (c) => c === "x");
// A song with only a melody (so every oscillator and filter in the context is the melody's).
export const melodyOnly = (extra = {}, notes = { C4: lane("x...............") }, melody = {}) => ({
  tempo: 120, kit: "acoustic", master_volume: 1, tracks: {}, melody: { waveform: "sine", notes, ...melody }, ...extra,
});
