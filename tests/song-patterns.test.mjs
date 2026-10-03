// Euclidean rhythms and starter beats for the song builder's drums.
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/admin/song-patterns.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, Array, Map, Object, String }));
const P = window.SongPatterns;
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const text = (row) => row.map((b) => (b ? "x" : ".")).join("");

// the well-known rhythms
ok(text(P.euclideanRow(3, 8, 0)) === "x..x..x.", "3 in 8 is x..x..x. (the tresillo)", text(P.euclideanRow(3, 8, 0)));
ok(text(P.euclideanRow(4, 16, 0)) === "x...x...x...x...", "4 in 16 is four on the floor");
ok(text(P.euclideanRow(2, 16, 0)) === "x.......x.......", "2 in 16 is one per half");
ok(text(P.euclideanRow(5, 8, 0)).split("x").length - 1 === 5, "5 in 8 has five hits");
ok(text(P.euclideanRow(0, 16, 0)) === "................" && text(P.euclideanRow(16, 16, 0)) === "xxxxxxxxxxxxxxxx", "0 hits is empty and 16 hits fills every step");
// always exactly `hits` hits, and no two gaps differing by more than one step
let allGood = true;
for (let n = 1; n <= 16; n++) for (let k = 0; k <= n; k++) {
  const row = P.euclideanRow(k, n, 0);
  if (row.length !== n || row.filter(Boolean).length !== k) allGood = false;
  const idx = row.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
  if (idx.length > 1) {
    const gaps = idx.map((v, i) => (idx[(i + 1) % idx.length] - v + n) % n || n);
    if (Math.max(...gaps) - Math.min(...gaps) > 1) allGood = false;
  }
}
ok(allGood, "for every size from 1 to 16 and every hit count: the right number of hits, spaced evenly (gaps differ by at most one)");

// rotation turns it later and wraps
ok(text(P.euclideanRow(3, 8, 1)) === ".x..x..x", "rotating by 1 moves every hit one step later", text(P.euclideanRow(3, 8, 1)));
ok(text(P.euclideanRow(4, 16, 16)) === text(P.euclideanRow(4, 16, 0)) && text(P.euclideanRow(4, 16, -4)) === text(P.euclideanRow(4, 16, 12)), "a full turn changes nothing, and a negative turn wraps");
// nonsense in, something sane out
ok(P.euclideanRow("x", "y", "z").length === 16 && P.euclideanRow(99, 16, 0).filter(Boolean).length === 16 && P.euclideanRow(-3, 16, 0).filter(Boolean).length === 0, "unreadable or out-of-range numbers are clamped, never thrown on");

// starter beats
ok(P.STARTERS.length >= 6 && new Set(P.STARTERS.map((b) => b.id)).size === P.STARTERS.length, "there are several starter beats with distinct ids", P.STARTERS.map((b) => b.id));
ok(P.STARTERS.every((b) => Object.entries(b.rows).every(([track, r]) => ["kick", "snare", "hihat", "clap"].includes(track) && /^[x.]{16}$/.test(r))), "every beat names real drum rows, 16 steps each");
ok(P.STARTERS.every((b) => b.rows.kick), "every starter beat has a kick");
ok(text(P.starterRow("four-floor", "kick", 16)) === "x...x...x...x..." && text(P.starterRow("rock", "snare", 16)) === "....x.......x...", "a row comes out as booleans, as written");
ok(P.starterRow("rock", "clap", 16).every((b) => b === false) && P.starterRow("nope", "kick", 16).every((b) => b === false), "a row the beat doesn't list, or an unknown beat, is empty");
ok(P.starterRow("rock", "kick", 16).every((b) => typeof b === "boolean"), "values are true booleans, as the song's own rows hold");
ok(P.starterRow("rock", "kick", 8).length === 8 && P.starterRow("rock", "kick", 32).length === 32 && P.starterRow("rock", "kick", 32).slice(16).every((b) => !b), "a different step count is padded with rests or cut short");


// ---------- melody tools ----------
// The piano roll's own order: octave 4 from B down to C, then octave 3 (so higher notes come first).
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const ALL = [];
[4, 3].forEach((o) => { for (let i = 11; i >= 0; i--) ALL.push(NAMES[i] + o); });
const blank = () => Object.fromEntries(ALL.map((n) => [n, new Array(16).fill(false)]));
const withNotes = (spec) => { const m = blank(); for (const [n, steps] of Object.entries(spec)) steps.forEach((s) => (m[n][s] = true)); return m; };
const used = (m) => Object.entries(m).filter(([, r]) => r.some(Boolean)).map(([n, r]) => `${n}:${r.map((b, i) => (b ? i : -1)).filter((i) => i >= 0).join(",")}`).join(" ");
// a small seeded random source, so the "random" tools are repeatable here
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

ok(P.noteValue("C0") === 0 && P.noteValue("C4") === 48 && P.noteValue("B3") === 47 && P.noteValue("C#4") === 49 && P.noteValue("H4") === null && P.noteValue("") === null, "noteValue puts every note on one scale");
ok(Object.keys(P.CHORDS).length === 7 && P.CHORDS.major.intervals.join() === "0,4,7" && P.CHORDS.min7.intervals.join() === "0,3,7,10", "seven chord types with their intervals");

// shift
{
  const m = withNotes({ C4: [0, 4], E4: [15] });
  const untouched = used(m);
  ok(used(P.rotateMelody(m, 1, 16)) === "E4:0 C4:1,5" || used(P.rotateMelody(m, 1, 16)) === "C4:1,5 E4:0", "shift one step later moves every note and wraps the last step to the first", used(P.rotateMelody(m, 1, 16)));
  ok(used(P.rotateMelody(m, -1, 16)).includes("C4:3,15") && used(P.rotateMelody(m, -1, 16)).includes("E4:14"), "shift one step earlier wraps the first step to the end", used(P.rotateMelody(m, -1, 16)));
  ok(used(P.rotateMelody(m, 16, 16)) === used(m) && used(P.rotateMelody(m, 0, 16)) === used(m), "a full turn or none leaves it as it was");
  let back = m; for (let i = 0; i < 16; i++) back = P.rotateMelody(back, 1, 16);
  ok(used(back) === used(m), "sixteen single shifts come all the way round");
  ok(used(m) === untouched, "the original is untouched");
  const rows = P.rotateMelody(m, 3, 16);
  ok(Object.keys(rows).length === ALL.length && Object.values(rows).every((r) => r.length === 16), "every row is kept at 16 steps");
  const strong = { C4: [0.5, false, false, false] };
  ok(P.rotateMelody(strong, 1, 4).C4[1] === 0.5, "a step value that is not just true is carried across");
}
// reverse
{
  const m = withNotes({ C4: [0, 1], D4: [3], E4: [15] });
  const r = P.reverseMelody(m, 16);
  ok(used(r).includes("C4:14,15") && used(r).includes("D4:12") && used(r).includes("E4:0"), "reverse turns the step order round", used(r));
  ok(used(P.reverseMelody(r, 16)) === used(m), "reversing twice is the original");
}
// chords
{
  let c = P.chordNames("C4", "major", ALL);
  ok(c.names.join() === "C4,E4,G4" && c.missing === 0, "C major from C4 is C4 E4 G4, lowest first", c);
  c = P.chordNames("A3", "minor", ALL);
  ok(c.names.join() === "A3,C4,E4", "A minor from A3 reaches up into the next octave", c.names);
  c = P.chordNames("G4", "dom7", ALL);
  ok(c.names.join() === "G4,B4" && c.missing === 2, "tones above the top of the roll are left out and counted", c);
  c = P.chordNames("C#3", "maj7", ALL);
  ok(c.names.join() === "C#3,F3,G#3,C4", "a major 7th on C#3", c.names);
  ok(P.chordNames("C4", "nope", ALL).names.length === 0 && P.chordNames("Z9", "major", ALL).names.length === 0, "an unknown chord or root gives nothing");
  const stamped = P.stampChord(blank(), ["C4", "E4", "G4"], 5, 16);
  ok(used(stamped) === "G4:5 E4:5 C4:5", "stamping puts the chord on one step", used(stamped));
  const both = P.stampChord(stamped, ["D4"], 6, 16);
  ok(used(both).includes("D4:6") && used(both).includes("C4:5"), "stamping adds to what is there");
  ok(used(P.stampChord(blank(), ["C4"], 16, 16)) === "" && used(P.stampChord(blank(), ["C4"], -1, 16)) === "" && used(P.stampChord(blank(), ["NOPE"], 0, 16)) === "", "a step or note that does not exist changes nothing");
}
// arpeggio
{
  const chord = ["G4", "C4", "E4"];
  const seq = (m, steps) => Array.from({ length: steps }, (_, i) => ALL.find((n) => m[n][i]) || ".").join(" ");
  ok(seq(P.arpeggioMelody(ALL, chord, "up", 1, 8), 8) === "C4 E4 G4 C4 E4 G4 C4 E4", "up: low to high, over and over, one note a step", seq(P.arpeggioMelody(ALL, chord, "up", 1, 8), 8));
  ok(seq(P.arpeggioMelody(ALL, chord, "down", 1, 6), 6) === "G4 E4 C4 G4 E4 C4", "down: high to low");
  ok(seq(P.arpeggioMelody(ALL, ["C4", "E4", "G4", "B4"], "updown", 1, 8), 8) === "C4 E4 G4 B4 G4 E4 C4 E4", "up and down: no repeated top or bottom note", seq(P.arpeggioMelody(ALL, ["C4", "E4", "G4", "B4"], "updown", 1, 8), 8));
  ok(seq(P.arpeggioMelody(ALL, chord, "up", 2, 8), 8) === "C4 . E4 . G4 . C4 .", "every 2 steps leaves a rest between", seq(P.arpeggioMelody(ALL, chord, "up", 2, 8), 8));
  ok(seq(P.arpeggioMelody(ALL, chord, "up", 4, 16), 16).split(" ").filter((x) => x !== ".").length === 4, "every 4 steps over 16 gives four notes");
  ok(seq(P.arpeggioMelody(ALL, ["C4"], "updown", 1, 4), 4) === "C4 C4 C4 C4", "a single note just repeats");
  ok(used(P.arpeggioMelody(ALL, [], "up", 1, 16)) === "", "no chord, no notes");
  ok(Object.keys(P.arpeggioMelody(ALL, chord, "up", 1, 16)).length === ALL.length, "every piano roll row exists in the result");
}
// scale pool and random melody
{
  const pool = P.scalePool(ALL, "C", [0, 2, 4, 5, 7, 9, 11]);
  ok(pool.length === 14 && pool[0] === "C3" && pool[pool.length - 1] === "B4" && !pool.some((n) => n.includes("#")), "C major in the two-octave roll: the 14 white keys, lowest first", pool);
  const pent = P.scalePool(ALL, "A", [0, 3, 5, 7, 10]);
  ok(pent.join() === "A3,C4,D4,E4,G4,A4,C3,D3,E3,G3".split(",").sort((a, b) => P.noteValue(a) - P.noteValue(b)).join(), "A minor pentatonic", pent);
  ok(P.scalePool(ALL, "Q", [0]).length === 0 && P.scalePool(ALL, "C", []).length === 0, "a bad key or no intervals gives an empty pool");
  const rnd = P.randomMelody(ALL, pool, 16, { density: 0.7, rng: seeded(7) });
  const placed = [];
  for (let i = 0; i < 16; i++) { const here = ALL.filter((n) => rnd[n][i]); if (here.length > 1) placed.push("chord at " + i); if (here.length === 1) placed.push(here[0]); }
  ok(!placed.some((x) => x.startsWith("chord")), "one note at a time", placed);
  ok(placed.length > 4 && placed.length < 16, "a mix of notes and rests", placed.length);
  ok(placed.every((n) => pool.includes(n)), "every note is in the scale", placed);
  const idx = placed.map((n) => pool.indexOf(n));
  ok(idx.every((v, i) => i === 0 || Math.abs(v - idx[i - 1]) <= 2 * (placed.length)), "notes sit within the pool");
  const again = P.randomMelody(ALL, pool, 16, { density: 0.7, rng: seeded(7) });
  ok(used(again) === used(rnd), "the same random source gives the same melody");
  ok(used(P.randomMelody(ALL, pool, 16, { density: 0, rng: seeded(3) })) === "", "density 0 is silence");
  const full = P.randomMelody(ALL, pool, 16, { density: 1, rng: seeded(3) });
  ok(Array.from({ length: 16 }, (_, i) => ALL.filter((n) => full[n][i]).length).every((c) => c === 1), "density 1 puts a note on every step");
  ok(used(P.randomMelody(ALL, [], 16, { rng: seeded(1) })) === "" && used(P.randomMelody(ALL, ["X9"], 16, { rng: seeded(1) })) === "", "an empty pool gives silence");
  // a walk stays close: with the pool's steps counted, consecutive notes are never more than 2 apart from the walk, though rests let it drift only by the walk itself
  const walk = P.randomMelody(ALL, pool, 16, { density: 1, rng: seeded(11) });
  const walkIdx = Array.from({ length: 16 }, (_, i) => pool.findIndex((n) => walk[n][i]));
  ok(walkIdx.every((v, i) => i === 0 || Math.abs(v - walkIdx[i - 1]) <= 2), "with every step filled, no leap is bigger than two scale notes", walkIdx);
}


// ---------- held notes (ties) ----------
{
  const flagsOf = (...on) => Array.from({ length: 16 }, (_, i) => on.includes(i));
  const tiesText = (t) => Object.entries(t).map(([n, r]) => `${n}:${r.map((b, i) => (b ? i : -1)).filter((i) => i >= 0).join(",")}`).sort().join(" ");
  const notes = withNotes({ C4: [2, 3, 4, 8], E4: [5, 6] });
  // cleanTies keeps only ties that join two steps where the note is on
  ok(tiesText(P.cleanTies(notes, { C4: flagsOf(3, 4, 5, 9) }, 16)) === "C4:3,4", "cleanTies drops flags whose note is off on either step", tiesText(P.cleanTies(notes, { C4: flagsOf(3, 4, 5, 9) }, 16)));
  ok(tiesText(P.cleanTies(notes, { C4: flagsOf(0, 3), X9: flagsOf(3), E4: "junk" }, 16)) === "C4:3", "step 0, unknown notes and junk rows are dropped");
  ok(Object.keys(P.cleanTies(notes, { C4: flagsOf(9) }, 16)).length === 0 && Object.keys(P.cleanTies(notes, null, 16)).length === 0, "nothing left means an empty result");
  ok(P.hasTies({ C4: flagsOf(3) }) && !P.hasTies({ C4: flagsOf() }) && !P.hasTies({}) && !P.hasTies(null) && !P.hasTies(undefined), "hasTies");
  // tieRepeats: every adjacent pair of the same note
  ok(tiesText(P.tieRepeats(notes, 16)) === "C4:3,4 E4:6", "tieRepeats ties each note struck on two steps in a row", tiesText(P.tieRepeats(notes, 16)));
  ok(Object.keys(P.tieRepeats(withNotes({ C4: [0, 2, 4] }), 16)).length === 0, "and nothing when no note repeats");
  // rotate: ties travel with their notes, one across the loop end is dropped
  const tied = { C4: flagsOf(3, 4), E4: flagsOf(6) };
  ok(tiesText(P.rotateTies(tied, 1, 16)) === "C4:4,5 E4:7", "ties move a step later with the notes", tiesText(P.rotateTies(tied, 1, 16)));
  ok(tiesText(P.rotateTies(tied, -1, 16)) === "C4:2,3 E4:5", "and a step earlier");
  const edge = P.cleanTies(P.rotateMelody(withNotes({ C4: [14, 15] }), 1, 16), P.rotateTies({ C4: flagsOf(15) }, 1, 16), 16);
  ok(Object.keys(edge).length === 0, "a tie that would straddle the end of the loop after a shift is dropped, not kept at step 0");
  // reverse: the link between two steps stays between those two steps
  const rev = P.reverseTies({ C4: flagsOf(3, 4) }, 16);
  ok(tiesText(rev) === "C4:12,13", "reversing: ties between steps 2-3 and 3-4 become ties between 11-12 and 12-13 (flagged on the later step)", tiesText(rev));
  const revNotes = P.reverseMelody(withNotes({ C4: [2, 3, 4] }), 16);
  ok(tiesText(P.cleanTies(revNotes, rev, 16)) === "C4:12,13", "and they still join notes that are on, after the notes are reversed too");
  ok(tiesText(P.reverseTies(P.reverseTies({ C4: flagsOf(3, 4, 9) }, 16), 16)) === "C4:3,4,9", "reversing twice is the original");
  ok(tiesText(P.rotateTies(P.rotateTies({ C4: flagsOf(3, 4, 9) }, 5, 16), -5, 16)) === "C4:3,4,9", "shifting there and back is the original");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
