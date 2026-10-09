// Recording accuracy: a press is placed on the audio clock where the player HEARD it, using the output timestamp when the browser gives
// one (a MIDI message's own time maps straight onto it) and the reported output latency when it does not. Never far from the render clock.
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/studio/song-live.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, Array, Object, Boolean }));
const { pressTime } = window.SongLive;
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined && !c ? " " + JSON.stringify(extra) : ""}`); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// a context 10 s in, whose speakers are 50 ms behind the render clock; performance.now() reads 5000 when the output was at 9.95
const ctx = (extra = {}) => ({ currentTime: 10, getOutputTimestamp: () => ({ contextTime: 9.95, performanceTime: 5000 }), ...extra });

ok(near(pressTime(ctx(), 5050), 10), "a press 50 ms after the heard moment is at 10.0 on the clock (the output timestamp is the reference)", pressTime(ctx(), 5050));
ok(near(pressTime(ctx(), 5000), 9.95), "a press exactly at the heard moment is at its context time");
ok(pressTime(ctx(), 4990) < pressTime(ctx(), 5000), "an earlier timestamp (a MIDI message that waited in the queue) lands earlier");
ok(near(pressTime(ctx({ outputLatency: 0.03 }), 5400), 9.97), "a timestamp more than a quarter second from the render clock is not trusted: the latency rule is used", pressTime(ctx({ outputLatency: 0.03 }), 5400));

// without getOutputTimestamp: the reported latency is taken off
ok(near(pressTime({ currentTime: 10, outputLatency: 0.04 }, 123), 9.96), "no output timestamp: the output latency is taken off the render clock");
ok(near(pressTime({ currentTime: 10, baseLatency: 0.01 }, 123), 9.99), "and the base latency when that is all there is");
ok(near(pressTime({ currentTime: 10 }, 123), 10), "and nothing when the browser reports none");
ok(near(pressTime({ currentTime: 10, outputLatency: 5 }, 123), 9.75), "a silly latency is capped at a quarter second");
ok(near(pressTime({ currentTime: 10, outputLatency: -1, baseLatency: NaN }, 123), 10), "a negative or missing latency counts as none");

// a broken timestamp does not throw, and does not poison the result
ok(near(pressTime(ctx({ getOutputTimestamp: () => { throw new Error("no"); }, outputLatency: 0.02 }), 5050), 9.98), "a throwing getOutputTimestamp falls back to the latency rule");
ok(near(pressTime(ctx({ getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }), outputLatency: 0.02 }), 5050), 9.98), "an output timestamp of zero (not yet running) is ignored");
ok(near(pressTime(ctx({ outputLatency: 0.02 }), undefined), 9.98), "a press with no time of its own uses the latency rule");
ok(near(pressTime(null, 1), 0) && Number.isFinite(pressTime(undefined, NaN)), "no context at all is zero, not an error");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
