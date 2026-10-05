// The bar counter's text ("6 bars", "Bar 3 of 6", "· Pattern B"): what a song says about where it is in its song order.
import { loadEngine, lane } from "./fake-audio.mjs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const E = loadEngine();

const part = (str) => ({ tracks: { kick: lane(str) }, notes: {}, ties: {} });
const song = (chain, extra = {}) => ({ tempo: 120, tracks: { kick: lane("x...") }, melody: { notes: {} }, patterns: { B: part("..x."), C: part("...x") }, chain, ...extra });

ok(E.positionLabel({ tempo: 120, tracks: { kick: lane("x...") }, melody: { notes: {} } }, 0) === null, "a song with no patterns has nothing to count");
ok(E.positionLabel(song(undefined), null) === null && E.positionLabel(song([]), 0) === null, "patterns but no song order: still one bar, nothing to count");
ok(E.positionLabel(song(["A"]), 0) === null, "an order of one bar has nothing to count");
ok(E.positionLabel(song(["A", "B", "A", "C", "B", "B"]), null) === "6 bars", "at rest (no bar playing) it says how many bars there are");
ok(E.positionLabel(song(["A", "B", "A", "C", "B", "B"]), undefined) === "6 bars" && E.positionLabel(song(["A", "B"]), -1) === "2 bars" && E.positionLabel(song(["A", "B"]), NaN) === "2 bars", "undefined, negative and NaN all mean at rest");
ok(E.positionLabel(song(["A", "B", "A", "C", "B", "B"]), 0) === "Bar 1 of 6" && E.positionLabel(song(["A", "B", "A", "C", "B", "B"]), 2) === "Bar 3 of 6" && E.positionLabel(song(["A", "B", "A", "C", "B", "B"]), 5) === "Bar 6 of 6", "bars count from 1");
ok(E.positionLabel(song(["A", "B", "A", "C", "B", "B"]), 3, { pattern: true }) === "Bar 4 of 6 · Pattern C", "the builder's version names the pattern", E.positionLabel(song(["A", "B", "A", "C", "B", "B"]), 3, { pattern: true }));
ok(E.positionLabel(song(["A", "B"]), 99) === "Bar 2 of 2", "an index past the end stops at the last bar");
ok(E.positionLabel(song(["A", "B"]), 1.9) === "Bar 2 of 2" && E.positionLabel(song(["A", "B"]), 0.5) === "Bar 1 of 2", "a fraction rounds down");
ok(E.positionLabel(song(["A", "Z", "B"]), null) === "2 bars", "a pattern letter the song doesn't have is not counted (the same way it isn't played)");
ok(E.positionLabel(song(Array(64).fill("A")), 63) === "Bar 64 of 64" && E.positionLabel(song(Array(80).fill("B")), null) === "64 bars", "the order is cut at 64 bars, like the player");
ok(E.positionLabel(song(["A", "B"], { editing: "B", tracks: part("..x.").tracks, patterns: { A: part("x...") } }), 0, { pattern: true }) === "Bar 1 of 2 · Pattern A", "it follows the open pattern swap (the open one is the song's own parts)");
ok(E.positionLabel(song(["A", "B"]), 0).length <= E.positionLabel(song(Array(64).fill("A")), 63).length, "the widest text (the last bar of a long song) is at least as long as any other");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
