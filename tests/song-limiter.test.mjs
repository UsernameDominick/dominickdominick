// The output limiter: a soft ceiling in front of the speakers. A normal mix passes through unchanged, a hot one is bent under full scale
// instead of clipping; the master bus, the reverb return and the echo return all end at it; the render that measures a song's own level
// (behind Normalize to peak) skips it so it sees the true peak.
import { makeCtx, count, loadEngine, loadSongFiles, offlineLog, limiterShaper, limiterIn, reachesOutput } from "./fake-audio.mjs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined && !c ? " " + JSON.stringify(extra) : ""}`); };

const E = loadEngine();
const F = loadSongFiles();
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---- the curve's maths
const L = E.softLimit;
let linear = true;
for (let x = -0.85; x <= 0.85; x += 0.01) if (L(x) !== x) linear = false;
ok(linear, "up to 85% of full scale the signal passes through exactly unchanged");
let monotonic = true, bounded = true, odd = true, prev = -Infinity;
for (let x = -8; x <= 8; x += 0.01) {
  const y = L(x);
  if (y < prev - 1e-12) monotonic = false;
  if (Math.abs(y) > 1) bounded = false;
  if (!near(L(-x), -y, 1e-12)) odd = false;
  prev = y;
}
ok(monotonic, "a louder input never comes out quieter");
ok(bounded, "nothing comes out above full scale, however hot the input");
ok(odd, "it treats the positive and negative halves alike");
ok(L(1) < 1 && L(1) > 0.9, "full scale in comes out a little under full scale", L(1));
ok(L(4) > 0.9999 && L(100) <= 1, "a very hot input settles at full scale", [L(4), L(100)]);
ok(near(L(0.85 + 1e-6) - L(0.85), 1e-6, 1e-9), "the bend starts smoothly: the slope at the knee is 1");

// ---- the wiring
{
  const ctx = makeCtx();
  E.setMasterVolume(ctx, 1); // builds the master bus
  const shaper = limiterShaper(ctx);
  const pre = limiterIn(ctx);
  ok(!!shaper && !!pre, "a context gets one limiter (a gain into a waveshaper) as soon as it has a master bus");
  ok(pre && pre.gain.value === 0.25, "the gain in front scales the signal into the curve's range (a quarter)", pre && pre.gain.value);
  ok(shaper && shaper.out.includes(ctx.destination) && shaper.oversample === "none", "the waveshaper feeds the destination, without oversampling (nothing to change below the knee)");
  ok(shaper && shaper.curve.length === 4097 && shaper.curve[2048] === 0, "its curve has 4097 points with exactly 0 in the middle");
  // The shaper reads the curve over -1..1 after the quarter gain, i.e. real inputs -4..4: check it against softLimit between the points.
  const at = (x) => {
    const pos = ((x / 4 + 1) / 2) * 4096;
    const i = Math.floor(pos), f = pos - i;
    return shaper.curve[i] * (1 - f) + (shaper.curve[Math.min(i + 1, 4096)] * f);
  };
  let worst = 0;
  for (let x = -4; x <= 4; x += 0.0137) worst = Math.max(worst, Math.abs(at(x) - L(x)));
  ok(worst < 1e-3, "the curve the speakers get matches the maths (worst gap below 0.001)", worst);
  const master = ctx.nodes.find((n) => n.kind === "gain" && n !== pre && n.out.includes(pre));
  ok(!!master && !master.out.includes(ctx.destination), "the master bus feeds the limiter, never the destination directly");
  E.setSpace(ctx, 50);
  E.setEcho(ctx, 50);
  const feeders = ctx.nodes.filter((n) => n.kind === "gain" && n !== pre && n.out.includes(pre));
  ok(feeders.length === 3, "the master bus, the reverb return and the echo return all end at the limiter", feeders.length);
  ok(!ctx.nodes.some((n) => n.out && n.out.includes(ctx.destination) && n !== shaper), "nothing but the limiter reaches the destination");
  E.setMasterVolume(ctx, 1);
  ok(count(ctx, "shaper") === 0, "the limiter is not counted as one of a voice's own saturators");
}

// ---- the level-measuring render skips it
{
  const ctx = makeCtx();
  ctx.__measure = true;
  E.setMasterVolume(ctx, 1);
  ok(!limiterShaper(ctx) && !limiterIn(ctx), "a context flagged as a measurement gets no limiter");
  const master = ctx.nodes.find((n) => n.kind === "gain");
  ok(master && master.out.includes(ctx.destination), "its master bus feeds the destination directly");
}
{
  const song = F.cleanSong({ tempo: 120, tracks: { kick: [true, ...Array(15).fill(false)], snare: Array(16).fill(false), hat: Array(16).fill(false), clap: Array(16).fill(false) } });
  offlineLog.length = 0;
  await E.renderWaveformPeaks(song, 20);
  const measured = offlineLog[offlineLog.length - 1];
  ok(measured && measured.nodes.length > 0 && !limiterShaper(measured), "the peak scan (Normalize to peak) renders without the limiter, so it sees the song's true level");
  offlineLog.length = 0;
  await E.renderLoopAudio(song, {});
  const exported = offlineLog[offlineLog.length - 1];
  ok(exported && !!limiterShaper(exported) && reachesOutput(exported, limiterShaper(exported)) === true, "the audio export renders with the limiter, so a hot mix is not written to the file clipped");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
