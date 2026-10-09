// Steady playback. The player schedules steps a little ahead of the audio clock from a timer. When a busy page runs that timer late it must
// not play the missed steps in one burst: it skips the steps whose time is over, keeps its place in the song true to the clock, looks
// further ahead for a while, and eases back after a calm stretch. A normal run is untouched.
import { makeCtx, loadEngine, lane } from "./fake-audio.mjs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined && !c ? " " + JSON.stringify(extra) : ""}`); };

const STEP = 60 / 120 / 4; // 120 bpm sixteenths: 0.125 s
const song = (extra = {}) => ({
  tempo: 120, kit: "acoustic", master_volume: 1, trackMeta: {},
  tracks: { kick: lane("x...x...x...x...") }, melody: { waveform: "sine", notes: {} },
  ...extra,
});

function rig(songData = song()) {
  const timers = [];
  const E = loadEngine({ setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => { timers.length = 0; } });
  const ctx = makeCtx();
  const events = [];
  const player = E.createPlayer(() => ctx, songData, (step, time, info) => events.push({ step, time, chainIndex: info.chainIndex }));
  // advances the audio clock by dt seconds, then lets the timer fire once (the page being late is simply a big dt)
  const tick = (dt) => { ctx.currentTime += dt; const fn = timers.pop(); if (fn) fn(); };
  return { E, ctx, player, events, tick };
}

// ---- a steady run: no stalls, same lookahead, every step in order, none missed
{
  const { player, events, tick, ctx } = rig();
  player.start();
  for (let i = 0; i < 120; i++) tick(0.025);
  ok(player.stalls() === 0 && player.skippedSteps() === 0, "a steady run has no stalls and skips nothing", [player.stalls(), player.skippedSteps()]);
  ok(Math.abs(player.lookahead() - 0.1) < 1e-9, "and keeps the normal lookahead of a tenth of a second", player.lookahead());
  ok(events.every((e, i) => e.step === i % 16), "every step is scheduled, in order", events.slice(0, 20).map((e) => e.step));
  ok(events.every((e, i) => i === 0 || Math.abs(e.time - events[i - 1].time - STEP) < 1e-9), "an eighth of a second apart (120 bpm sixteenths)");
  ok(events[events.length - 1].time < ctx.currentTime + 0.2, "and never more than the lookahead ahead of the clock");
}

// ---- a stall: 1.0 s late
{
  const { player, events, tick, ctx } = rig();
  player.start();
  for (let i = 0; i < 20; i++) tick(0.025); // 0.5 s of steady playing
  const before = events.length;
  const lastBefore = events[events.length - 1];
  tick(1.0); // the page is frozen for a second
  const burst = events.slice(before);
  ok(player.stalls() === 1, "the loop notices it ran late", player.stalls());
  ok(player.skippedSteps() >= 6 && player.skippedSteps() <= 8, "and skips the steps whose time is over (about eight at 120 bpm), not plays them", player.skippedSteps());
  ok(burst.length >= 1 && burst.length <= 3, "so only the steps still to come are scheduled, not a burst of stale ones", burst.length);
  ok(burst.every((e) => e.time >= ctx.currentTime - STEP), "none of them is in the past (nothing plays late in a pile)", burst.map((e) => +(e.time - ctx.currentTime).toFixed(3)));
  const gapSteps = (burst[0].time - lastBefore.time) / STEP;
  ok(Math.abs(gapSteps - Math.round(gapSteps)) < 1e-6, "the next step is still on the beat grid of the song (the position stayed true to the clock)", gapSteps);
  ok(burst[0].step === (lastBefore.step + Math.round(gapSteps)) % 16, "and it is the step the song should be on", [burst[0].step, lastBefore.step, gapSteps]);
  ok(player.lookahead() > 0.1 && player.lookahead() <= 0.3, "it looks further ahead from now on", player.lookahead());
}

// ---- stalls keep widening it, up to a ceiling
{
  const { player, tick } = rig();
  player.start();
  for (let i = 0; i < 8; i++) { tick(0.025); tick(0.5); }
  ok(player.stalls() === 8, "every stall is counted", player.stalls());
  ok(Math.abs(player.lookahead() - 0.3) < 1e-9, "but the lookahead stops at 0.3 seconds", player.lookahead());
}

// ---- and eases back after a calm stretch
{
  const { player, tick } = rig();
  player.start();
  tick(0.025);
  tick(0.8);
  const widened = player.lookahead();
  for (let i = 0; i < 1500; i++) tick(0.025); // 37 s of steady playing
  ok(widened > 0.1 && player.lookahead() < widened, "after a calm stretch the lookahead eases back", [widened, player.lookahead()]);
  ok(Math.abs(player.lookahead() - 0.1) < 1e-9, "all the way to the normal tenth of a second", player.lookahead());
}

// ---- a stall inside a song order lands in the right bar
{
  const s = song({ tracks: { kick: lane("x...x...x...x...") }, patterns: { B: { tracks: { kick: lane("....x...........") }, notes: {}, ties: {} } }, chain: ["A", "B", "A", "B"] });
  const { player, events, tick } = rig(s);
  player.start();
  for (let i = 0; i < 4; i++) tick(0.025);
  const before = events.length;
  const last = events[before - 1];
  tick(2.1); // 16.8 steps: just over a whole bar
  const next = events[before];
  const stepsAhead = Math.round((next.time - last.time) / STEP);
  const expectedGlobal = last.chainIndex * 16 + last.step + stepsAhead;
  ok(next.chainIndex * 16 + next.step === expectedGlobal % 64, "the position in the song order moves on with the clock across a bar line", [next.chainIndex, next.step, expectedGlobal]);
}

// ---- a stopped player does nothing more
{
  const { player, events, tick } = rig();
  player.start();
  tick(0.025);
  player.stop();
  const n = events.length;
  tick(0.5);
  ok(events.length === n && !player.isPlaying(), "stop is still stop");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
