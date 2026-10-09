// The song engine's Echo (a tempo-synced delay send): off builds nothing at all, on builds one delay with a darkened feedback loop and a
// wet level, the delay follows the tempo, and previews and renders treat it the way the player does.
import { makeCtx, count, offlineLog, loadEngine, loadSongFiles, reachesOutput } from "./fake-audio.mjs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const E = loadEngine();
const F = loadSongFiles();
const song = (extra = {}) => ({
  tempo: 120, kit: "acoustic", master_volume: 1,
  tracks: { kick: Array.from({ length: 16 }, (_, i) => i % 4 === 0) },
  melody: { waveform: "sine", notes: { C4: Array.from({ length: 16 }, (_, i) => i === 0) } },
  ...extra,
});
const playAll = (ctx, data) => { for (let s = 0; s < 16; s++) E.scheduleStep(ctx, data, s, s * 0.125, () => 0.5); };
const STEP = 60 / 120 / 4;
const sendOf = (ctx) => ({ delay: ctx.nodes.find((n) => n.kind === "delay"), filters: ctx.nodes.filter((n) => n.kind === "filter") });
const lastSet = (param) => { const calls = param.calls.filter((c) => c.kind === "set"); return calls.length ? calls[calls.length - 1].v : undefined; };
const lastTo = (param) => { const calls = param.calls.filter((c) => c.kind === "set" || c.kind === "target"); return calls.length ? calls[calls.length - 1].v : undefined; }; // a value set at once, or one the param glides to

// ---- off ----
{
  const a = makeCtx(); playAll(a, song());
  const b = makeCtx(); playAll(b, song({ echo: 0 }));
  ok(count(a, "delay") === 0 && count(b, "delay") === 0, "Echo off (missing or 0) builds no delay");
  const c = makeCtx(); playAll(c, song({ echo: "abc" }));
  const d = makeCtx(); playAll(d, song({ echo: null }));
  const e = makeCtx(); playAll(e, song({ echo: -20 }));
  ok(count(c, "delay") === 0 && count(d, "delay") === 0 && count(e, "delay") === 0, "a damaged or negative value is off too");
  E.setEcho(a, 0, 120);
  ok(count(a, "delay") === 0, "setEcho(0) on a context that never had echo builds nothing");
}

// ---- on ----
{
  const ctx = makeCtx(); playAll(ctx, song({ echo: 50 }));
  ok(count(ctx, "delay") === 1, "Echo on builds exactly one delay for the whole song", count(ctx, "delay"));
  const { delay } = sendOf(ctx);
  ok(Math.abs(lastTo(delay.delayTime) - STEP * 3) < 1e-9, "the delay is a dotted eighth: three sixteenth steps at the song's tempo", { got: lastTo(delay.delayTime), want: STEP * 3 });
  const master = ctx.nodes.find((n) => n.kind === "gain" && n.out.includes(delay));
  ok(!!master, "it listens to the master bus");
  const tone = delay.out[0];
  ok(tone && tone.kind === "filter" && tone.type === "lowpass" && tone.frequency.value < 5000, "the repeats go through a low-pass so each one is duller", tone && { type: tone.type, hz: tone.frequency.value });
  const feedback = tone.out.find((n) => n.kind === "gain" && n.out.includes(delay));
  const wet = tone.out.find((n) => n.kind === "gain" && reachesOutput(ctx, n));
  ok(!!feedback && !!wet, "the low-pass feeds both a feedback gain back into the delay and a wet gain to the output");
  ok(wet.gain.calls.some((c) => c.kind === "ramp" || c.kind === "lin") && Math.abs(wet.gain.calls.filter((c) => c.kind === "lin").pop().v - 0.4) < 1e-9, "50% echo ramps the wet level to 0.4", wet.gain.calls);
  ok(Math.abs(lastSet(feedback.gain) - 0.475) < 1e-9, "and the feedback to 0.475", lastSet(feedback.gain));
  playAll(ctx, song({ echo: 50 }));
  ok(count(ctx, "delay") === 1, "playing on does not build a second delay");
}

// ---- stable at every amount; clamped ----
{
  for (const amount of [1, 25, 50, 75, 100, 500]) {
    const ctx = makeCtx(); E.setEcho(ctx, amount, 120, true);
    const { delay } = sendOf(ctx);
    const tone = delay.out[0];
    const feedback = tone.out.find((n) => n.kind === "gain" && n.out.includes(delay));
    const wet = tone.out.find((n) => n.kind === "gain" && reachesOutput(ctx, n));
    ok(feedback.gain.value < 0.7 && feedback.gain.value >= 0.35 && wet.gain.value <= 0.8 + 1e-9 && wet.gain.value > 0, `echo ${amount}%: feedback ${feedback.gain.value.toFixed(3)} (always below 1, so it dies away), wet ${wet.gain.value.toFixed(3)}`);
  }
}

// ---- tempo ----
{
  const ctx = makeCtx(); playAll(ctx, song({ echo: 40, tempo: 120 }));
  const { delay } = sendOf(ctx);
  E.scheduleStep(ctx, song({ echo: 40, tempo: 90 }), 0, 5, () => 0.5);
  ok(Math.abs(lastTo(delay.delayTime) - (60 / 90 / 4) * 3) < 1e-9, "a tempo change retimes the delay on the next step", lastTo(delay.delayTime));
  const slow = makeCtx(); E.setEcho(slow, 50, 40, true);
  ok(sendOf(slow).delay.delayTime.value < 2, "even at the slowest tempo the delay fits inside the node's two-second limit", sendOf(slow).delay.delayTime.value);
}

// ---- contexts and the other send ----
{
  const a = makeCtx(), b = makeCtx();
  playAll(a, song({ echo: 60 })); playAll(b, song());
  ok(count(a, "delay") === 1 && count(b, "delay") === 0, "each audio context has its own send");
  const both = makeCtx(); playAll(both, song({ echo: 30, space: 30 }));
  ok(count(both, "delay") === 1 && count(both, "convolver") === 1, "Echo and Space can be on together, each with its own send");
  const metered = makeCtx(); E.getPeakMeterAnalyser(metered); E.setEcho(metered, 50, 120);
  const wet = sendOf(metered).delay.out[0].out.find((n) => n.kind === "gain" && reachesOutput(metered, n));
  ok(wet.out.some((n) => n.kind === "analyser"), "the meters read the echo too");
}

// ---- previews and renders ----
{
  offlineLog.length = 0;
  await E.renderWaveformPeaks(song({ echo: 80 }), 40);
  ok(offlineLog.length === 1 && count(offlineLog[0], "delay") === 0, "the waveform preview ignores Echo (repeats would smear the pattern)");
  offlineLog.length = 0;
  await E.renderLoopAudio(song({ echo: 70, tempo: 100 }), { loops: 1 });
  const rendered = offlineLog[0];
  const { delay } = sendOf(rendered);
  ok(!!delay && Math.abs(delay.delayTime.value - (60 / 100 / 4) * 3) < 1e-9, "the audio export includes the echo, set from its first sample", delay && delay.delayTime.value);
  offlineLog.length = 0;
  await E.renderLoopAudio(song(), { loops: 1 });
  ok(count(offlineLog[0], "delay") === 0, "an export of a song without Echo builds none");
}

// ---- validation, import and export ----
{
  const clean = F.cleanSong({ echo: 150 });
  ok(clean.echo === 100, "import clamps echo to 0-100", clean.echo);
  ok(F.cleanSong({ echo: "x" }).echo === 0 && F.cleanSong({}).echo === 0 && F.cleanSong({ echo: 35 }).echo === 35, "a missing or damaged value is 0, a good one is kept");
  const round = F.parseImport(F.exportJson("T", F.cleanSong({ echo: 42, space: 10 })));
  ok(round.data.echo === 42 && round.data.space === 10, "export then import keeps Echo and Space");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
