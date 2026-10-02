// Euclidean rhythms and starter beats for the song builder's drums.
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/admin/song-patterns.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, Array }));
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

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
