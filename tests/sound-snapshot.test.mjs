// A fingerprint of how every sound is built. For each melodic voice, each plain waveform, each drum of each kit and the effects, the test builds the sound
// into the recording Web Audio of fake-audio.mjs and fingerprints the whole graph: every node, its type, every parameter value and automation call
// (with its time), every connection, the saturation curves and the noise buffers. The fingerprints are in tests/__snapshots__/sound.json.
//
// When a sound is changed ON PURPOSE the test fails and names what changed; look at the list, then run
//     UPDATE_SNAPSHOT=1 node tests/sound-snapshot.test.mjs
// and commit the new file with the change, so the diff of sound.json shows exactly which sounds the change touched. (The older tests, which check one
// thing each, still say why a particular rule broke.)
import fs from "node:fs";
import { makeCtx, loadEngine, lane, melodyOnly } from "./fake-audio.mjs";

const FILE = new URL("./__snapshots__/sound.json", import.meta.url);
const E = loadEngine();
const r6 = (x) => (typeof x === "number" ? Math.round(x * 1e6) / 1e6 : x);
const PARAMS = ["gain", "frequency", "Q", "detune", "delayTime", "pan", "threshold", "knee", "ratio", "attack", "release"];
const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]) * (1 + (i % 7)); return r6(s); };

function describeGraph(ctx) {
  const index = new Map(ctx.nodes.map((n, i) => [n, i]));
  index.set(ctx.destination, -1);
  return ctx.nodes.map((n) => {
    const d = { k: n.kind, t: n.type, st: [r6(n.started), r6(n.stopped)], out: n.out.map((o) => (index.has(o) ? index.get(o) : "?")) };
    for (const p of PARAMS) {
      const param = n[p];
      if (param && typeof param === "object" && "value" in param) {
        d[p] = [r6(param.value), param.calls.map((c) => [c.kind, r6(c.v), r6(c.t), r6(c.tc)])];
      }
    }
    if (n.curve) d.curve = [n.curve.length, sum(n.curve)];
    if (n.oversample && n.oversample !== "none") d.oversample = n.oversample;
    if (n.buffer && n.buffer.getChannelData) d.buffer = [n.buffer.numberOfChannels, n.buffer.length, sum(n.buffer.getChannelData(0))];
    if (n.wave) d.wave = [n.wave.real.length, sum(n.wave.real), sum(n.wave.imag)];
    return d;
  });
}
function fnv(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
function summary(ctx) {
  const c = {};
  for (const n of ctx.nodes) { const key = n.kind === "osc" || n.kind === "filter" ? `${n.kind}:${n.type}` : n.kind; c[key] = (c[key] || 0) + 1; }
  return Object.entries(c).map(([k, v]) => `${k} x${v}`).join(", ");
}
const entry = (ctx) => { const g = describeGraph(ctx); return { h: fnv(JSON.stringify(g)), n: ctx.nodes.length, s: summary(ctx) }; };

const play = (data, step = 0) => { const ctx = makeCtx(); E.scheduleStep(ctx, data, step, 0, () => 0.5); return ctx; };
const all = {};

// every melodic voice, one held note
for (const name of Object.keys(E.MELODY_VOICES)) all[`voice:${name}`] = entry(play(melodyOnly({}, { C4: lane("x...............") }, { voice: name })));
// the plain waveform note
for (const wave of ["sine", "square", "sawtooth", "triangle"]) all[`wave:${wave}`] = entry(play(melodyOnly({}, { C4: lane("x...............") }, { waveform: wave })));
// each drum of each kit
const ROWS = ["kick", "snare", "hihat", "clap", "openhat", "rim", "tom", "crash"];
for (const kit of E.KITS) {
  for (const row of ROWS) {
    const data = { tempo: 120, kit, master_volume: 1, trackMeta: {}, tracks: { [row]: lane("x...............") }, melody: { waveform: "sine", notes: {} } };
    all[`drum:${kit}:${row}`] = entry(play(data));
  }
}
// the effects and the master chain
{
  const ctx = makeCtx();
  E.setMasterVolume(ctx, 0.8);
  E.setSpace(ctx, 60);
  E.setEcho(ctx, 40);
  all["fx:space+echo"] = entry(ctx);
  const withPump = play({ tempo: 120, kit: "acoustic", master_volume: 1, pump: 60, trackMeta: {}, tracks: { kick: lane("x...............") }, melody: { waveform: "sine", notes: { C4: lane("x...............") } } });
  all["fx:pump"] = entry(withPump);
}

const text = JSON.stringify(all, null, 1) + "\n";
if (process.env.UPDATE_SNAPSHOT) {
  fs.writeFileSync(FILE, text);
  console.log(`wrote ${Object.keys(all).length} fingerprints to tests/__snapshots__/sound.json`);
  process.exit(0);
}

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined && !c ? " " + JSON.stringify(extra) : ""}`); };
let saved = null;
try { saved = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { saved = null; }
ok(!!saved, "the fingerprint file exists (UPDATE_SNAPSHOT=1 node tests/sound-snapshot.test.mjs makes it)");
if (saved) {
  const changed = Object.keys(all).filter((k) => saved[k] && saved[k].h !== all[k].h);
  const added = Object.keys(all).filter((k) => !saved[k]);
  const removed = Object.keys(saved).filter((k) => !all[k]);
  ok(Object.keys(all).length >= 41 + 4 + 15 * 8 + 2, "the snapshot covers every voice, every waveform, every drum of every kit and the effects", Object.keys(all).length);
  ok(!changed.length, "no sound changed since the fingerprints were taken (if on purpose: UPDATE_SNAPSHOT=1 node tests/sound-snapshot.test.mjs, and commit sound.json)", changed.slice(0, 25).map((k) => `${k}: ${saved[k].s} (${saved[k].n}) -> ${all[k].s} (${all[k].n})`));
  ok(!added.length, "no sound was added without a fingerprint", added.slice(0, 25));
  ok(!removed.length, "no fingerprinted sound has gone", removed.slice(0, 25));
}
console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
