// Pausing a song and carrying on: the player can start from a given step and place in the song order (options.step, options.chainIndex),
// ignores values that make no sense, and a plain start is still the top of the song.
import { makeCtx, loadEngine, lane } from "./fake-audio.mjs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const song = (extra = {}) => ({
  tempo: 120, kit: "acoustic", master_volume: 1, trackMeta: {},
  tracks: { kick: lane("x...x...x...x...") }, melody: { waveform: "sine", notes: {} },
  patterns: { B: { tracks: { kick: lane("....x...........") }, notes: {}, ties: {} } },
  chain: ["A", "A", "B"],
  ...extra,
});

function run(options, count) {
  const timers = [];
  const E = loadEngine({ setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {} });
  const ctx = makeCtx();
  const events = [];
  const player = E.createPlayer(() => ctx, song(), (step, time, info) => events.push({ step, time, pattern: info.pattern, chainIndex: info.chainIndex }));
  player.start(undefined, options);
  for (let guard = 0; events.length < count && guard < 2000; guard++) {
    ctx.currentTime += 0.05;
    const fn = timers.pop();
    if (!fn) break;
    fn();
  }
  return events.slice(0, count);
}

{
  const e = run(undefined, 4);
  ok(e[0].step === 0 && e[0].chainIndex === 0 && e[0].pattern === "A", "a plain start is the top of the song", e[0]);
}
{
  const e = run({ step: 5, chainIndex: 1 }, 20);
  ok(e[0].step === 5 && e[0].chainIndex === 1 && e[0].pattern === "A", "it starts on the step and place in the order it was given", e[0]);
  ok(e.slice(0, 11).map((x) => x.step).join() === "5,6,7,8,9,10,11,12,13,14,15", "and runs on step by step to the end of that bar");
  ok(e[11].step === 0 && e[11].chainIndex === 2 && e[11].pattern === "B", "then moves on to the next pattern in the order", e[11]);
}
{
  const e = run({ step: 3, chainIndex: 2 }, 16);
  ok(e[0].pattern === "B" && e[0].step === 3, "it can resume inside a later pattern", e[0]);
  ok(e[13].step === 0 && e[13].chainIndex === 0 && e[13].pattern === "A", "and wraps round to the top of the order", e[13]);
}
{
  const bad = [{ step: 99 }, { step: -1 }, { step: 1.5 }, { step: "4" }, { chainIndex: -2 }, { chainIndex: 0.5 }, { step: null, chainIndex: null }, {}];
  const fine = bad.map((o) => { const e = run(o, 1)[0]; return e.step === 0 && e.chainIndex === 0; });
  ok(fine.every(Boolean), "values that make no sense are ignored and it starts at the top", fine);
}
{
  const e = run({ step: 2, chainIndex: 9 }, 3);
  ok(e[0].chainIndex === 0 && e[0].pattern === "A", "a place past the end of the order falls back to its first pattern", e[0]);
}
{
  const e = run({ pattern: "B", step: 7 }, 12);
  ok(e.every((x) => x.pattern === "B") && e[0].step === 7 && e[9].step === 0, "a looped pattern resumes on its step as well", e.map((x) => x.step).join());
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
