// Chord progressions for the song builder's piano roll: the right chords in the right key, each placed on the roll, spread over the loop,
// held with ties (or just struck), added to the existing melody, and never merged into the chord before.
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/admin/song-patterns.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, Array, Map, Object, String }));
const P = window.SongPatterns;
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const ROLL = []; [4, 3].forEach((o) => { for (let i = 11; i >= 0; i--) ROLL.push(NAMES[i] + o); }); // as the builder: C3-B4
const empty = () => Object.fromEntries(ROLL.map((n) => [n, new Array(16).fill(false)]));
const on = (notes, name) => notes[name].map((v, i) => (v ? i : -1)).filter((i) => i >= 0).join();
const labels = (key, id) => P.progressionChords(ROLL, key, id).map((c) => c.label).join(" ");

// ---- the list ----
ok(P.PROGRESSIONS.length >= 8 && P.PROGRESSIONS.every((p) => p.id && p.label && p.chords.length && 16 % p.chords.length === 0), "every progression has a name and a chord count that divides the 16 steps evenly", P.PROGRESSIONS.map((p) => [p.id, p.chords.length]));
ok(new Set(P.PROGRESSIONS.map((p) => p.id)).size === P.PROGRESSIONS.length, "ids are unique");
ok(P.PROGRESSIONS.every((p) => p.chords.every(([offset, type]) => Number.isInteger(offset) && offset >= 0 && offset < 12 && P.CHORDS[type])), "every chord is a semitone offset and a known chord type");

// ---- the right chords in the right key ----
ok(labels("C", "pop") === "C G Am F", "I V vi IV in C is C G Am F", labels("C", "pop"));
ok(labels("D", "pop") === "D A Bm G", "…in D is D A Bm G", labels("D", "pop"));
ok(labels("A", "minor") === "Am F C G", "i bVI bIII bVII in A is Am F C G", labels("A", "minor"));
ok(labels("C", "jazz") === "Dm7 G7 Cmaj7 Cmaj7", "ii V I I in C is Dm7 G7 Cmaj7 Cmaj7", labels("C", "jazz"));
ok(labels("E", "andalusian") === "Em D C B", "i bVII bVI V in E is Em D C B", labels("E", "andalusian"));
ok(labels("G", "canon") === "G D Em Bm C G C D", "the canon in G is G D Em Bm C G C D", labels("G", "canon"));
ok(P.progressionChords(ROLL, "H", "pop").length === 0 && P.progressionChords(ROLL, "C", "nope").length === 0 && P.progressionChords([], "C", "pop").length === 0 && P.progressionChords(ROLL, undefined, "pop").length === 0, "an unknown key, progression or an empty roll gives no chords");

// ---- placed on the roll ----
{
  const c = P.progressionChords(ROLL, "C", "pop");
  ok(c[0].names.join() === "C3,E3,G3" && c[1].names.join() === "G3,B3,D4" && c[2].names.join() === "A3,C4,E4" && c[3].names.join() === "F3,A3,C4", "each chord sits as low on the roll as it fits (C3 E3 G3, G3 B3 D4, A3 C4 E4, F3 A3 C4)", c.map((x) => x.names.join(" ")));
  ok(c.every((x) => x.missing === 0), "nothing is left out in C");
  // every key and every progression: all chord tones are real roll notes, in order low to high, none missing
  let allFit = true, detail = null;
  for (const key of NAMES) for (const p of P.PROGRESSIONS) for (const chord of P.progressionChords(ROLL, key, p.id)) {
    const type = chord.names.length;
    const values = chord.names.map((n) => ROLL.indexOf(n));
    if (chord.missing !== 0 || !chord.names.every((n) => ROLL.includes(n)) || type < 3) { allFit = false; detail = { key, p: p.id, chord }; }
    if (values.some((v, i) => i && v >= values[i - 1])) { allFit = false; detail = { key, p: p.id, order: chord }; } // ROLL is high-to-low, so tones must fall in index
  }
  ok(allFit, "in all 12 keys, every chord of every progression fits the roll in full, lowest note first", detail);
  const small = P.progressionChords(["C3", "E3", "G3"], "C", "pop");
  ok(small[0].names.join() === "C3,E3,G3" && small[1].missing > 0, "on a short roll, tones that do not fit are counted as missing", small.map((x) => [x.label, x.missing]));
}

// ---- stamping ----
{
  const chords = P.progressionChords(ROLL, "C", "pop");
  const held = P.stampProgression(empty(), {}, chords, 16, { hold: true });
  ok(on(held.notes, "C3") === "0,1,2,3" && on(held.notes, "G3") === "0,1,2,3,4,5,6,7" && on(held.notes, "E3") === "0,1,2,3", "held: each chord's notes are on for its whole four-step stretch (G3 is in C and in G, so it runs eight steps)", { C3: on(held.notes, "C3"), G3: on(held.notes, "G3") });
  ok(held.ties.C3.join() === [false, true, true, true, ...Array(12).fill(false)].join(), "…and tied after the first step of the stretch", held.ties.C3);
  ok(held.ties.G3[4] === false && held.ties.G3[5] === true && held.ties.G3[3] === true, "G3 is not tied across from the C chord into the G chord: the new chord strikes it fresh", held.ties.G3);
  const struck = P.stampProgression(empty(), {}, chords, 16, { hold: false });
  ok(on(struck.notes, "C3") === "0" && on(struck.notes, "G3") === "0,4" && Object.keys(struck.ties).length === 0, "not held: only the first step of each stretch is struck, no ties", { G3: on(struck.notes, "G3"), ties: struck.ties });

  // added to what is there, nothing else touched
  const base = empty(); base.C5 = undefined; delete base.C5; base.B4[15] = true; base.D4[0] = true;
  const added = P.stampProgression(base, {}, chords, 16);
  ok(added.notes.B4[15] === true && added.notes.D4[0] === true && on(added.notes, "C3") === "0,1,2,3", "the stamp adds to the melody and keeps the notes already there");
  ok(base.D4.filter(Boolean).length === 1 && base.C3.every((v) => !v), "the melody it was given is left alone");

  // stale ties on a note that is now struck fresh
  const stale = { G3: new Array(16).fill(false) }; stale.G3[4] = true;
  const fresh = P.stampProgression(empty(), stale, chords, 16);
  ok(fresh.ties.G3[4] === false, "a leftover tie flag at the start of a chord is cleared");
  // old held notes elsewhere survive
  const oldNotes = empty(); oldNotes.B4[10] = true; oldNotes.B4[11] = true;
  const oldTies = { B4: new Array(16).fill(false) }; oldTies.B4[11] = true;
  const kept = P.stampProgression(oldNotes, oldTies, chords, 16);
  ok(kept.ties.B4 && kept.ties.B4[11] === true, "held notes already in the melody stay held");

  // eight chords get two steps each; chord counts that do not divide still fit
  const canon = P.stampProgression(empty(), {}, P.progressionChords(ROLL, "C", "canon"), 16, { hold: true });
  ok(on(canon.notes, "C3") === "0,1,10,11" && on(canon.notes, "G3") === "0,1,2,3,6,7,10,11,14,15", "the canon's eight chords get two steps each (C comes round again at step 11; G is in C, G, Em, C and G)", { C3: on(canon.notes, "C3"), G3: on(canon.notes, "G3") });
  const five = P.stampProgression(empty(), {}, P.progressionChords(ROLL, "C", "pop").concat([{ label: "x", names: ["C4"], missing: 0 }]), 16, { hold: true });
  ok(on(five.notes, "C4").split(",").length >= 3 && Object.values(five.notes).every((r) => r.length === 16), "an odd number of chords still fits inside 16 steps");
  ok(Object.values(P.stampProgression(empty(), {}, [], 16).notes).every((r) => !r.some(Boolean)), "no chords stamps nothing");
  const unknown = P.stampProgression(empty(), {}, [{ label: "x", names: ["Z9", "C3"], missing: 0 }], 16);
  ok(on(unknown.notes, "C3") === "0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15" && !unknown.notes.Z9, "a note name that is not on the roll is skipped (a single chord spans the whole loop)");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
