// public/sim-buzzer.js: the tone a buzzer makes. Run against a stand-in for the browser's audio, since node has none.
import fs from "node:fs";
import vm from "node:vm";

function makeBrowser({ withAudio = true } = {}) {
  const log = { contexts: 0, oscillators: [], started: 0, stopped: 0, resumed: 0, events: [] };
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
  class FakeContext {
    constructor() { log.contexts++; this.currentTime = 0; this.state = "suspended"; this.destination = {}; }
    resume() { log.resumed++; this.state = "running"; }
    createOscillator() { const o = { type: "", frequency: { value: 0 }, connect() {}, start() { log.started++; }, stop() { log.stopped++; } }; log.oscillators.push(o); return o; }
    createGain() { return { gain: param(), connect() {} }; }
    createBiquadFilter() { return { type: "", frequency: { value: 0 }, connect() {} }; }
  }
  const timers = [];
  const window = withAudio ? { AudioContext: FakeContext } : {};
  const context = vm.createContext({
    window,
    document: { dispatchEvent: (e) => log.events.push(e.type) },
    CustomEvent: class { constructor(type) { this.type = type; } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    Math, Number,
  });
  vm.runInContext(fs.readFileSync(new URL("../public/sim-buzzer.js", import.meta.url), "utf8"), context);
  return { B: window.SimBuzzer, log, timers };
}

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

let { B, log, timers } = makeBrowser();
ok(typeof B.play === "function" && typeof B.stop === "function" && typeof B.toggle === "function" && typeof B.playing === "function", "exposes play, stop, toggle and playing");
ok(B.playing() === false && log.contexts === 0, "nothing is created until it is asked to play (no audio on its own)");
ok(B.play() === true && B.playing() === true && log.contexts === 1 && log.started === 1 && log.resumed === 1, "play starts one tone and wakes the audio context");
ok(log.oscillators[0].type === "square" && log.oscillators[0].frequency.value === 2400, "a 2.4 kHz square wave");
ok(timers.length === 1 && timers[0].ms === 1200, "it ends by itself after 1.2 seconds", timers.map((t) => t.ms));
timers[0].fn();
ok(B.playing() === false && log.stopped === 1 && log.events.includes("sim-buzzer-stopped"), "when the time is up it stops and says so");
B.play(); B.play();
ok(log.started === 3 && log.stopped === 2 && B.playing() === true && log.contexts === 1, "starting again replaces the tone rather than layering a second (one context, one tone at a time)", { started: log.started, stopped: log.stopped });
ok(B.toggle() === false && B.playing() === false, "toggle while playing stops it");
ok(B.toggle() === true && B.playing() === true, "toggle while silent starts it");
B.stop(); B.stop();
ok(B.playing() === false, "stop is safe to call again");
B.play(99999);
ok(timers[timers.length - 1].ms === 5000, "a long length is capped at 5 seconds");
B.play(10);
ok(timers[timers.length - 1].ms === 200, "a tiny one is raised to 200 ms");
B.stop();

({ B, log, timers } = makeBrowser({ withAudio: false }));
ok(B.play() === false && B.playing() === false && B.toggle() === false, "without audio support it just says it could not play");
B.stop();

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
