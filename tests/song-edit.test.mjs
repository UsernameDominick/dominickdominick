// The Studio's roll and sequencer editing: notes as spans, move, copy, resize, strength, box select, drum painting.
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/admin/song-edit.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, Array, Object, JSON, Boolean }));
const E = window.SongEdit;
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const S = 16;
const rowNames = ["E4", "D4", "C4"];
const blank = () => ({ E4: new Array(S).fill(false), D4: new Array(S).fill(false), C4: new Array(S).fill(false) });
const text = (arr) => arr.map((v) => (v ? "x" : ".")).join("");

// a held C4 on steps 2 to 4, a single E4 on step 8, a soft D4 on step 0
const notes = blank();
const ties = {};
[2, 3, 4].forEach((i) => (notes.C4[i] = true));
ties.C4 = new Array(S).fill(false); ties.C4[3] = true; ties.C4[4] = true;
notes.E4[8] = true;
notes.D4[0] = 0.5;

const list = E.spans(notes, ties, S);
ok(list.length === 3, "three notes are found", list);
const c4 = list.find((s) => s.row === "C4");
ok(c4.start === 2 && c4.len === 3, "a held note is one span of its length", c4);
ok(E.spanAt(notes, ties, "C4", 3, S).start === 2 && E.spanAt(notes, ties, "C4", 5, S) === null, "the span covering a step is found, and none past its end");

// move
let m = E.move(notes, ties, [c4], 0, 4, S, rowNames);
ok(text(m.notes.C4) === "......xxx......." && m.ties.C4[7] === true && m.ties.C4[6] === false, "a held note moves along as a whole", [text(m.notes.C4), m.ties.C4]);
ok(text(notes.C4) === "..xxx...........", "the original is left alone");
m = E.move(notes, ties, [c4], 0, 99, S, rowNames);
ok(text(m.notes.C4) === ".............xxx" && m.moved.steps === 11, "a move is stopped at the end of the bar, the note not cut", [text(m.notes.C4), m.moved]);
m = E.move(notes, ties, [c4], -1, 0, S, rowNames);
ok(m.notes.D4[2] === true && m.notes.D4[4] === true && text(m.notes.C4) === "................", "dragging up a row changes the pitch", m.moved);
m = E.move(notes, ties, E.spans(notes, ties, S), -9, 0, S, rowNames);
ok(m.moved.rows === 0 && text(m.notes.E4) === text(notes.E4), "a group that is already at the top cannot go higher", m.moved);
m = E.move(notes, ties, [c4], 0, 6, S, rowNames, { copy: true });
ok(text(m.notes.C4) === "..xxx...xxx....." && m.ties.C4[9] === true, "copying leaves the original and makes a second note", text(m.notes.C4));
m = E.move(notes, ties, [E.spans(notes, ties, S).find((s) => s.row === "D4")], 0, 3, S, rowNames);
ok(m.notes.D4[3] === 0.5, "a soft note stays soft when moved", m.notes.D4[3]);

// resize
let r = E.resize(notes, ties, c4, 5, S);
ok(text(r.notes.C4) === "..xxxxx........." && r.ties.C4[5] === true && r.ties.C4[6] === true && r.len === 5, "a note grows to the right, tied to itself", text(r.notes.C4));
r = E.resize(notes, ties, c4, 1, S);
ok(text(r.notes.C4) === "..x............." && r.ties.C4[3] === false && r.ties.C4[4] === false, "and shrinks, leaving a single step", text(r.notes.C4));
const blocked = blank(); blocked.C4[2] = true; blocked.C4[6] = true;
r = E.resize(blocked, {}, { row: "C4", start: 2, len: 1 }, 9, S);
ok(r.len === 4 && r.notes.C4[6] === true, "it cannot grow over the next note of its row", r.len);
r = E.resize(blank(), {}, { row: "C4", start: 14, len: 1 }, 9, S);
ok(r.len === 2, "or past the end of the bar", r.len);

// strength
ok(E.level(1) === true && E.level(0.5) === 0.5 && E.level(0) === 0.1 && E.level(2) === true, "strengths: 1 is true, below it a number, never under 0.1");
const lv = E.setLevel(notes, [c4], 0.4, S);
ok(lv.C4[2] === 0.4 && lv.C4[3] === 0.4 && lv.C4[4] === 0.4 && lv.E4[8] === true, "a note takes a strength on every step it covers, others untouched");
ok(E.startLevel(notes, ties, 3, S) === 0 && E.startLevel(notes, ties, 2, S) === 1 && E.startLevel(notes, ties, 0, S) === 0.5, "the lane draws the strength of notes that start on a step, not held parts");
ok(E.setStepLevels(notes, [{ row: "E4", step: 8 }, { row: "E4", step: 9 }], 0.3, S).E4[9] === false, "a step that is off is not turned on by a strength change");

// box
const boxed = E.inBox(notes, ties, S, rowNames, { row: 2, step: 4 }, { row: 1, step: 6 });
ok(boxed.length === 1 && boxed[0].row === "C4", "a box takes the notes it touches, in any corner order, even by their tail", boxed);
ok(E.inBox(notes, ties, S, rowNames, { row: 0, step: 0 }, { row: 2, step: 15 }).length === 3, "a box over everything takes all three");

// snap
ok(E.snap(5, 4) === 4 && E.snap(6, 4) === 8 && E.snap(5, 2) === 6 && E.snap(5.4, 1) === 5, "snap rounds to a beat, an eighth or a step");

// drums
const drums = { kick: new Array(S).fill(false), snare: new Array(S).fill(false) };
const painted = E.paintCells(drums, [{ row: "kick", step: 0 }, { row: "kick", step: 4 }, { row: "snare", step: 15 }, { row: "tom", step: 2 }, { row: "kick", step: 99 }], true, S);
ok(painted.kick[0] === true && painted.kick[4] === true && painted.snare[15] === true && !painted.tom, "drum cells are painted, rows and steps that do not exist ignored");
ok(E.paintCells(painted, [{ row: "kick", step: 0 }], false, S).kick[0] === false && painted.kick[0] === true, "and cleared, without touching the original");
ok(E.paintCells(drums, [{ row: "kick", step: 1 }], 0.5, S).kick[1] === 0.5, "with a strength");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
