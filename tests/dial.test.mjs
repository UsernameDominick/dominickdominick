// The maths of a dial (public/dial.js DialMath): dragging, fine drags, keys, the wheel, detents, typed numbers. The page side (pointer events, the
// bubble, resetting, typing) is checked in the browser by tests/e2e/test_studio_dials.js.
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/dial.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, Object, String, Array, isFinite }));
const M = window.DialMath;
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined && !c ? " " + JSON.stringify(extra) : ""}`); };

ok(!!M && typeof window.Dial === "undefined", "loading the file without a page gives the maths and nothing else");

// quantize and fraction
ok(M.quantize(503.4, 0, 1000, 1) === 503 && M.quantize(-5, 0, 1000, 1) === 0 && M.quantize(5000, 0, 1000, 1) === 1000, "a value is put on the grid and inside the range");
ok(M.quantize(0.34, 0, 1, 0.25) === 0.25 && M.quantize(0.4, 0, 1, 0.25) === 0.5, "steps other than 1 are honoured");
ok(M.quantize(7, 0, 100, 0) === 7, "a step of 0 means 1");
ok(M.fraction(250, 0, 1000) === 0.25 && M.fraction(5, 5, 5) === 0 && M.fraction(-3, 0, 10) === 0, "fraction is 0 to 1 and safe on an empty range");

// dragging
ok(M.dragValue(0, 180, 0, 1000, 1, false) === 1000, "180 px up is the whole range");
ok(M.dragValue(500, 90, 0, 1000, 1, false) === 1000 && M.dragValue(500, -90, 0, 1000, 1, false) === 0, "90 px is half of it, either way");
ok(M.dragValue(0, 180, 0, 1000, 1, true) === 250, "a fine drag moves four times less");
ok(M.dragValue(900, 500, 0, 1000, 1, false) === 1000 && M.dragValue(100, -500, 0, 1000, 1, false) === 0, "a long drag stops at the ends");
{
  // Shift pressed half way: carrying on from the new value means no jump
  const mid = M.dragValue(0, 90, 0, 1000, 1, false); // 500
  const next = M.dragValue(mid, 0, 0, 1000, 1, true); // rebased, no travel yet
  ok(mid === 500 && next === 500, "re-basing a drag when Shift changes keeps the value where it was");
}

// keys
const kv = (key, shift, value = 500) => M.keyValue(key, shift, value, 0, 1000, 1);
ok(kv("ArrowUp", false) === 501 && kv("ArrowRight", false) === 501 && kv("ArrowDown", false) === 499 && kv("ArrowLeft", false) === 499, "an arrow is one step");
ok(kv("ArrowUp", true) === 510 && kv("ArrowDown", true) === 490, "Shift and an arrow is ten steps");
ok(kv("PageUp", false) === 600 && kv("PageDown", false) === 400 && kv("PageUp", true) === 510, "PageUp and PageDown are a tenth of the range (Shift: a hundredth)");
ok(kv("Home", false) === 0 && kv("End", false) === 1000, "Home and End are the ends");
ok(kv("a", false) === null && kv("Enter", false) === null && kv("Tab", false) === null, "other keys are not the dial's");
ok(kv("ArrowUp", true, 995) === 1000 && kv("ArrowDown", true, 4) === 0, "keys stop at the ends");
ok(M.keyValue("ArrowUp", false, 0.5, 0, 1, 0.01) === 0.51, "a key moves by the input's own step");

// wheel
ok(M.wheelValue(-100, false, 500, 0, 1000, 1) === 510 && M.wheelValue(100, false, 500, 0, 1000, 1) === 490, "a wheel notch is one percent of the range, up for a negative delta");
ok(M.wheelValue(-100, true, 500, 0, 1000, 1) === 502, "with Shift it is a fifth of that");
ok(M.wheelValue(-1, false, 50, 0, 100, 1) === 51 && M.wheelValue(0, false, 50, 0, 100, 1) === 50, "never less than one step, and a zero delta does nothing");

// detents
ok(M.snap(497, [0, 500, 1000], 20) === 500 && M.snap(520, [0, 500, 1000], 20) === 500 && M.snap(521, [0, 500, 1000], 20) === 521, "a value within reach of a detent is pulled onto it, outside it is left alone");
ok(M.snap(10, [0, 12], 5) === 12 && M.snap(8, [0, 12, 9], 5) === 9, "the nearest detent wins");
ok(M.snap(5, [], 20) === 5 && M.snap(5, undefined, 20) === 5, "no detents, no pull");

// typed numbers
ok(M.parseNumber("1.5") === 1.5 && M.parseNumber("1,5 kHz") === 1.5 && M.parseNumber("-6 dB") === -6 && M.parseNumber("+3 st") === 3 && M.parseNumber(" 65 % ") === 65, "numbers are found in text, with a comma or a unit");
ok(M.parseNumber(".5") === 0.5 && M.parseNumber("3200 Hz") === 3200 && M.parseNumber("abc") === null && M.parseNumber("") === null, "a bare fraction, a plain number, and text with no number");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
