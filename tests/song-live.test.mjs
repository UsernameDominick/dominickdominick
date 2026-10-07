// Live playing in the Studio: arpeggio and roll rates, which note is next, strumming, drum pad strength, the pitch wheel, saved settings.
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/admin/song-live.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, Array, Object, Boolean }));
const L = window.SongLive;
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

// rates
ok(L.rateSeconds(120, "1/4") === 0.5 && L.rateSeconds(120, "1/16") === 0.125 && L.rateSeconds(120, "1/32") === 0.0625, "a beat at 120 is half a second; 1/16 and 1/32 follow", [L.rateSeconds(120, "1/16"), L.rateSeconds(120, "1/32")]);
ok(Math.abs(L.rateSeconds(120, "1/16T") - 0.5 / 6) < 1e-9, "a triplet is three to the beat... six to a quarter pair: a sixth of a beat");
ok(L.rateSeconds(120, "nope") === 0.125 && L.rateSeconds(0, "1/4") === 0.5, "an unknown rate falls back to 1/16 and a missing tempo to 120");
ok(L.rateSeconds(9999, "1/4") === 0.2, "the tempo is kept in a sane range");

// chords
ok(L.chordNotes(60, "major").join() === "60,64,67" && L.chordNotes(60, "minor").join() === "60,63,67" && L.chordNotes(60, "dom7").join() === "60,64,67,70", "chords stack on the root");
ok(L.chordNotes(60, "junk").join() === "60,64,67", "an unknown chord is major");

// strum
{
  const down = L.strumPlan(4, 90, "down", 0);
  ok(down.map((s) => s.i).join() === "0,1,2,3" && down[0].at === 0 && Math.abs(down[3].at - 0.09) < 1e-9, "a downstrum goes low to high across the spread", down);
  const up = L.strumPlan(4, 90, "up", 0);
  ok(up.map((s) => s.i).join() === "3,2,1,0", "an upstrum goes high to low");
  ok(L.strumPlan(3, 60, "alt", 0).map((s) => s.i).join() === "0,1,2" && L.strumPlan(3, 60, "alt", 1).map((s) => s.i).join() === "2,1,0", "alternate swaps with each strum");
  ok(L.strumPlan(1, 60, "down", 0).length === 1 && L.strumPlan(1, 60, "down", 0)[0].at === 0, "a single note has no spread");
  ok(L.strumPlan(3, 99999, "down", 0)[2].at <= 0.4 + 1e-9, "the spread is capped");
}

// arpeggio
{
  const held = [67, 60, 64];
  ok(L.arpCycle(held, "up", 1).join() === "60,64,67", "up sorts the held notes");
  ok(L.arpCycle(held, "down", 1).join() === "67,64,60", "down reverses them");
  ok(L.arpCycle(held, "updown", 1).join() === "60,64,67,64", "up and down does not repeat the ends");
  ok(L.arpCycle(held, "played", 1).join() === "67,60,64", "as played keeps the order they were pressed");
  ok(L.arpCycle([60], "up", 3).join() === "60,72,84", "octaves stack the pass higher");
  ok(L.arpCycle([], "up", 1).length === 0, "nothing held, nothing to play");
  ok(L.arpCycle([60, 64], "updown", 1).join() === "60,64", "two notes up and down is just up");
  ok([0, 1, 2, 3, 4].map((i) => L.arpPick(held, "up", 1, i, null)).join() === "60,64,67,60,64", "ticks loop through the cycle");
  ok(L.arpPick([60], "up", 1, 5, null) === 60, "one held note repeats: that is a trill");
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let prev = null, same = 0;
  const seen = new Set();
  for (let i = 0; i < 200; i++) { const m = L.arpPick(held, "random", 2, i, rng, prev); if (m === prev) same++; seen.add(m); prev = m; }
  ok(same === 0 && seen.size >= 5, "random never repeats a note back to back and reaches the whole span", [same, seen.size]);
  ok(L.arpPick([], "random", 1, 0, rng) === null, "random with nothing held is nothing");
}

// pads
{
  const top = L.padVelocity({ y: 0, h: 100, pointerType: "mouse" });
  const bottom = L.padVelocity({ y: 100, h: 100, pointerType: "mouse" });
  ok(top === 0.3 && bottom === 1, "the top of a pad is soft and the bottom is hard", [top, bottom]);
  ok(Math.abs(L.padVelocity({ y: 50, h: 100, pointerType: "touch" }) - 0.65) < 1e-9, "the middle is in between");
  ok(L.padVelocity({ pointerType: "pen", pressure: 0.9, y: 0, h: 100 }) > 0.9, "a pen's pressure sets it");
  ok(L.padVelocity({ pointerType: "pen", pressure: 0.5, y: 100, h: 100 }) === 1, "a pen reporting the default 0.5 is treated as no pressure");
  ok(L.padVelocity({ y: -50, h: 100 }) === 0.3 && L.padVelocity({ y: 999, h: 100 }) === 1, "a press outside the pad is clamped");
  const flat = [0, 1, 2, 3].map((i) => L.rollVelocity(i, false, 1));
  ok(flat[0] === 1 && flat[1] < 1 && flat[2] === 1, "a flat roll gives every other hit a touch less", flat);
  const swell = [0, 4, 8, 20].map((i) => L.rollVelocity(i, true, 1));
  ok(swell[0] < swell[1] && swell[1] < swell[2] && swell[3] === 1 && swell[0] >= 0.15, "a swell builds up to full strength", swell);
}

// pitch wheel
ok(L.bendCents(1, 2) === 200 && L.bendCents(-1, 2) === -200 && L.bendCents(0.5, 2) === 100 && L.bendCents(0, 2) === 0, "the wheel bends by its range in cents");
ok(L.bendCents(5, 2) === 200 && L.bendCents(1, 99) === 1200 && L.bendCents(1, 0) === 200, "past the end is clamped, and a missing range is two semitones");

// saved settings
{
  const d = L.cleanPlay(null);
  ok(d.mode === "off" && d.rate === "1/16" && d.octaves === 1 && d.chord === "major" && d.swell === false, "no settings gives the defaults", d);
  const w = L.cleanPlay({ mode: "laser", rate: "1/99", pattern: "x", octaves: 9, gate: 7, chord: "z", spread: 1, dir: "sideways", swell: "yes", bendRange: -3 });
  ok(w.mode === "off" && w.rate === "1/16" && w.pattern === "up" && w.octaves === 3 && w.gate === 1 && w.chord === "major" && w.spread === 10 && w.dir === "down" && w.swell === false && w.bendRange === 2, "wild values are pulled into range or dropped", w);
  ok(L.cleanPlay({ mode: "roll", rate: "1/32", swell: true }).swell === true, "good values stay");
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
