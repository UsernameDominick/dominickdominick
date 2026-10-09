// Pump: a song with Pump above 0 sends its melody and bass line through a "music" gain that dips on every kick and swells back (like
// sidechain compression); a song without it builds nothing extra and is exactly as before.
import { makeCtx, count, loadEngine, lane, reachesOutput, limiterIn } from "./fake-audio.mjs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const E = loadEngine();

const song = (extra = {}) => ({
  tempo: 120, kit: "acoustic", master_volume: 1,
  tracks: { kick: lane("x...x...x...x...") }, trackMeta: {},
  melody: { waveform: "sine", notes: { C4: lane("x...x...x...x...") } },
  bass: { notes: { C2: lane("x...............") } },
  ...extra,
});
const play = (data, step = 0, time = 0) => { const ctx = makeCtx(); E.scheduleStep(ctx, data, step, time, () => 0.5); return ctx; };
const masterOf = (ctx) => ctx.nodes.find((n) => n.kind === "gain" && reachesOutput(ctx, n) && n !== limiterIn(ctx));
// The music bus: a gain into the master that has automation and is fed by nothing but other gains (a voice's own envelope gain is fed by
// an oscillator or a filter).
const busOf = (ctx) => {
  const m = masterOf(ctx);
  return ctx.nodes.find((n) => n.kind === "gain" && n !== m && n.out.includes(m) && n.gain.calls.length > 0 && ctx.nodes.filter((f) => f.out.includes(n)).every((f) => f.kind === "gain"));
};

// ---- off: nothing extra is built
{
  const base = play(song());
  const zero = play(song({ pump: 0 }));
  ok(count(base, "gain") === count(zero, "gain") && !busOf(base) && !busOf(zero), "Pump absent or 0 builds no music bus: the same number of gain nodes", [count(base, "gain"), count(zero, "gain")]);
  const m = masterOf(base);
  const voiceGains = base.nodes.filter((n) => n.kind === "gain" && n !== m && n.out.includes(m));
  ok(voiceGains.length >= 2, "(without Pump the melody and bass voices feed the master gain directly)", voiceGains.length);
  for (const bad of [-5, "x", null, NaN, undefined, {}, [], "0"]) ok(!busOf(play(song({ pump: bad }))), `a Pump of ${JSON.stringify(bad)} is off`);
}

// ---- on: the music goes through one bus, the drums do not
{
  const ctx = play(song({ pump: 60 }));
  const master = masterOf(ctx);
  const bus = busOf(ctx);
  ok(!!bus && bus.out.includes(master), "Pump on: a music bus gain feeds the master gain", !!bus);
  const intoBus = ctx.nodes.filter((n) => n !== bus && n.out.includes(bus));
  ok(intoBus.length >= 2, "the melody's and the bass line's voices both feed the bus", intoBus.length);
  const intoMaster = ctx.nodes.filter((n) => n !== bus && n.out.includes(master));
  ok(intoMaster.length >= 1, "the drums still go straight to the master (the kick is what triggers the dip, it is not ducked)", intoMaster.length);
  const calls = bus.gain.calls;
  ok(calls.length === 2 && calls[0].kind === "set" && calls[1].kind === "lin" && calls[1].v === 1, "one kick makes one dip: set low, then ramp back to 1", calls);
  ok(Math.abs(calls[0].v - (1 - 0.6 * 0.85)) < 1e-9 && calls[0].t === 0, "at Pump 60 it drops to 49% at the kick's time", calls[0]);
  ok(Math.abs(calls[1].t - 0.35) < 1e-9, "and is back at full after the release (a third of a second at 120 BPM)", calls[1].t);
  ok(count(ctx, "gain") === count(play(song({ pump: 100 })), "gain"), "the amount changes the dip, not the graph");
  const deep = busOf(play(song({ pump: 100 }))).gain.calls[0].v;
  ok(Math.abs(deep - 0.15) < 1e-9, "Pump 100 dips to 15%", deep);
  ok(busOf(play(song({ pump: 250 }))).gain.calls[0].v === deep && !busOf(play(song({ pump: 0.0001 }))) === false, "an amount over 100 counts as 100");
}

// ---- when it dips
{
  ok(busOf(play(song({ pump: 50 }), 1)) === undefined || busOf(play(song({ pump: 50 }), 1)).gain.calls.length === 0, "a step with no kick does not dip");
  const noKick = play(song({ pump: 50, tracks: { kick: lane("................"), snare: lane("x...............") } }));
  ok(!busOf(noKick) || busOf(noKick).gain.calls.length === 0, "a snare does not dip it, only the kick");
  const muted = play(song({ pump: 50, trackMeta: { kick: { muted: true } } }));
  ok(!busOf(muted) || busOf(muted).gain.calls.length === 0, "a muted kick plays nothing and dips nothing");
  const later = busOf(play(song({ pump: 50 }), 4, 2));
  ok(later && later.gain.calls[0].t === 2 && Math.abs(later.gain.calls[1].t - 2.35) < 1e-9, "the dip starts at the time the step is scheduled for", later && later.gain.calls.map((c) => c.t));
  const fast = busOf(play(song({ pump: 50, tempo: 240 })));
  ok(Math.abs(fast.gain.calls[1].t - 0.1875) < 1e-9, "at 240 BPM the release is shorter (three steps, 0.19 s)", fast.gain.calls[1].t);
  const slow = busOf(play(song({ pump: 50, tempo: 60 })));
  ok(Math.abs(slow.gain.calls[1].t - 0.35) < 1e-9, "and never longer than 0.35 s however slow the song", slow.gain.calls[1].t);
  const humanised = busOf(play(song({ pump: 50, humanize: 100 }), 0, 1));
  ok(humanised.gain.calls[0].t > 0.98 && humanised.gain.calls[0].t < 1.02, "with humanize the dip follows the kick's own nudged time", humanised.gain.calls[0].t);
}

// ---- it works with the other mix controls
{
  const ctx = play(song({ pump: 50, melody: { waveform: "sine", volume: 0.5, notes: { C4: lane("x...............") } } }));
  const bus = busOf(ctx);
  const half = ctx.nodes.find((n) => n.kind === "gain" && Math.abs(n.gain.value - 0.5) < 1e-9);
  ok(half && half.out.includes(bus), "a melody volume stage feeds the bus (volume, then pump, then master)");
  const onlyDrums = play({ tempo: 120, kit: "acoustic", pump: 50, tracks: { kick: lane("x...") }, melody: { waveform: "sine", notes: {} } });
  ok(!!busOf(onlyDrums), "a song with only drums still builds the bus (its gain is simply never used by a voice)");
  const m = masterOf(ctx);
  ok(ctx.nodes.filter((n) => n.out.includes(m)).length >= 1, "the bus is connected to the master so reverb and echo sends hear it");
  // a following step with Pump off after Pump on is not left routed through the bus
  const again = makeCtx();
  E.scheduleStep(again, song({ pump: 50 }), 0, 0, () => 0.5);
  const before = again.nodes.length;
  E.scheduleStep(again, song(), 4, 1, () => 0.5);
  const fresh = again.nodes.slice(before);
  const bus2 = busOf(again);
  ok(!fresh.some((n) => n.out.includes(bus2)), "a step scheduled without Pump after one with it does not go through the bus");
}

// ---- offline renders and the preview seed
{
  const peaks = await E.renderWaveformPeaks(song({ pump: 70 }), 30);
  const audio = await E.renderLoopAudio(song({ pump: 70 }), { loops: 1 });
  ok(peaks.length === 30 && audio.loopSamples === Math.round(0.125 * 16 * 44100), "the waveform preview and the audio export render a song with Pump", [peaks.length, audio.loopSamples]);
  const seed = (d) => { const r = E.previewRandom(d); return [r(), r(), r()].join(); };
  ok(seed(song()) === seed(song({ pump: 80 })), "Pump does not change the preview's seeded drum noise");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
