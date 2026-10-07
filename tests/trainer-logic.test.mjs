// The aim trainer's rules: settings limits, target placement, tracking movement, scoring and history.
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/trainer-logic.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, Array, Object, JSON, Boolean, Infinity }));
const T = window.TrainerLogic;
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

// settings
const d = T.cleanSettings(null);
ok(d.size === 48 && d.duration === 30 && d.sensitivity === 1 && d.lock === false && d.crosshair === "dot", "no settings gives the defaults", d);
const w = T.cleanSettings({ size: 9999, duration: 3, sensitivity: -4, speed: "x", lock: "yes", crosshair: "laser" });
ok(w.size === 120 && w.duration === 10 && w.sensitivity === 0.1 && w.speed === 3 && w.lock === false && w.crosshair === "dot", "wild values are pulled into range or dropped", w);
ok(T.cleanSettings({ duration: 47 }).duration === 45, "the length moves to a multiple of five");

// rng
const a = T.makeRng(7);
const b = T.makeRng(7);
ok(a() === b() && a() === b(), "the same seed gives the same numbers");
{ const r = T.makeRng(3); let low = 1, high = 0; for (let i = 0; i < 500; i++) { const v = r(); low = Math.min(low, v); high = Math.max(high, v); } ok(low >= 0 && high < 1 && high - low > 0.9, "numbers stay in 0..1 and spread out"); }

// gridshot
{
  const rng = T.makeRng(11);
  const taken = [0, 4, 8];
  let bad = 0;
  for (let i = 0; i < 100; i++) if (taken.includes(T.pickCell(rng, taken))) bad++;
  ok(bad === 0, "a new target never lands on a cell already in use");
  const c = T.gridCenter(4, 900, 600, 48);
  ok(Math.abs(c.x - 450) < 1 && Math.abs(c.y - 300) < 1, "the middle cell is in the middle of the stage", c);
  const corner = T.gridCenter(0, 900, 600, 48);
  ok(corner.x > 24 && corner.y > 24, "the corner cells keep a whole target on the stage", corner);
}

// flick
{
  const rng = T.makeRng(5);
  let last = { x: 100, y: 100 };
  let near = 0, off = 0;
  for (let i = 0; i < 200; i++) {
    const p = T.flickNext(rng, 800, 500, 40, last, 200);
    if (Math.hypot(p.x - last.x, p.y - last.y) < 200) near++;
    if (p.x < 40 || p.x > 760 || p.y < 40 || p.y > 460) off++;
    last = p;
  }
  ok(near === 0, "a flick target is always far from the last");
  ok(off === 0, "and always fully on the stage");
  const tiny = T.flickNext(T.makeRng(1), 60, 60, 20, { x: 30, y: 30 }, 5000);
  ok(Number.isFinite(tiny.x) && Number.isFinite(tiny.y), "a stage too small for the distance still gives a spot");
}

// tracking
{
  const rng = T.makeRng(9);
  let t = T.trackStart(rng, 800, 500, 48);
  let outside = 0;
  let moved = 0;
  for (let i = 0; i < 1500; i++) {
    const n = T.trackStep(t, 1 / 60, 800, 500, 48, 4, rng);
    if (n.x < 24 - 1e-6 || n.x > 776 + 1e-6 || n.y < 24 - 1e-6 || n.y > 476 + 1e-6) outside++;
    moved += Math.hypot(n.x - t.x, n.y - t.y);
    t = n;
  }
  ok(outside === 0, "the tracked target never leaves the stage");
  ok(moved > 1000, "and it keeps moving", Math.round(moved));
  const slow = T.trackStep({ x: 400, y: 250, vx: 1, vy: 0, turn: 5 }, 1, 800, 500, 48, 1, rng);
  const fast = T.trackStep({ x: 400, y: 250, vx: 1, vy: 0, turn: 5 }, 1, 800, 500, 48, 5, rng);
  ok(fast.x - 400 > (slow.x - 400) * 4, "a higher speed setting goes further in a second");
}

// hit and aim
ok(T.hit({ x: 100, y: 100 }, 120, 100, 48) && !T.hit({ x: 100, y: 100 }, 125, 100, 48), "a click is a hit inside the circle and not outside it");
{
  const m = T.moveAim({ x: 100, y: 100 }, 10, -20, 2, 800, 500);
  ok(m.x === 120 && m.y === 60, "captured aim moves by the movement times the sensitivity", m);
  const e = T.moveAim({ x: 5, y: 5 }, -100, -100, 1, 800, 500);
  ok(e.x === 0 && e.y === 0, "and stays on the stage");
}

// scoring
{
  const good = T.summarize({ drill: "gridshot", hits: 40, shots: 44, reactions: [400, 500], total: 30000 });
  ok(good.accuracy === 91 && good.reaction === 450 && good.score > 4000, "gridshot: accuracy, average reaction and a score", good);
  const sloppy = T.summarize({ drill: "gridshot", hits: 40, shots: 80, reactions: [400, 500], total: 30000 });
  ok(sloppy.score < good.score && sloppy.accuracy === 50, "more misses lower the score");
  const slow = T.summarize({ drill: "gridshot", hits: 40, shots: 44, reactions: [1200], total: 30000 });
  ok(slow.score < good.score, "a slower average lowers it too");
  const none = T.summarize({ drill: "flick", hits: 0, shots: 0, reactions: [], total: 30000 });
  ok(none.score === 0 && none.accuracy === 0 && none.reaction === null, "an empty run scores nothing and does not divide by zero", none);
  const never = T.summarize({ drill: "flick", hits: 0, shots: 5, reactions: [], total: 30000 });
  ok(never.score === 0, "misses never push the score below zero", never);
  const tr = T.summarize({ drill: "tracking", onTarget: 15000, total: 30000 });
  ok(tr.accuracy === 50 && tr.score === 1500, "tracking: accuracy is the share of time on the target", tr);
  const over = T.summarize({ drill: "tracking", onTarget: 99999, total: 30000 });
  ok(over.accuracy === 100, "and never passes 100");
}

// history
{
  let h = [];
  const s1 = T.summarize({ drill: "gridshot", hits: 10, shots: 10, reactions: [500], total: 30000 });
  ok(T.isRecord(h, s1), "the first run of a drill is a record");
  h = T.addRun(h, s1, 1000);
  const s2 = T.summarize({ drill: "gridshot", hits: 5, shots: 10, reactions: [500], total: 30000 });
  ok(!T.isRecord(h, s2), "a lower score is not");
  h = T.addRun(h, s2, 2000);
  ok(h.length === 2 && h[0].at === 2000, "runs are kept newest first");
  ok(T.bestOf(h, "gridshot") === s1.score && T.bestOf(h, "flick") === null, "the best is per drill");
  for (let i = 0; i < 100; i++) h = T.addRun(h, s2, 3000 + i);
  ok(h.length === T.HISTORY_MAX, "the history is capped", h.length);
  const dirty = T.cleanHistory([{ drill: "nope", score: 5 }, { drill: "flick", score: "x" }, null, { drill: "flick", score: 12.6, accuracy: 400, reaction: 300.4 }]);
  ok(dirty.length === 1 && dirty[0].score === 13 && dirty[0].accuracy === 100 && dirty[0].reaction === 300, "stored history is cleaned on the way in", dirty);
  ok(T.cleanHistory("junk").length === 0, "and junk gives an empty list");
}

// more drills
ok(T.DRILL_IDS.join() === "gridshot,tracking,flick,precision,reaction", "there are five drills");
ok(T.targetSize("precision", 48) === 24 && T.targetSize("gridshot", 48) === 48 && T.targetSize("precision", 16) === 12, "precision uses half-size targets, never under 12 px");
{
  const r = T.makeRng(2);
  const d = Array.from({ length: 50 }, () => T.reactionDelay(r));
  ok(d.every((n) => n >= 900 && n <= 3000) && new Set(d).size > 20, "the reaction wait is between 0.9 and 3 seconds and varies", [Math.min(...d), Math.max(...d)]);
  const sum = T.summarize({ drill: "reaction", hits: 8, shots: 10, reactions: [250, 300], total: 20000 });
  ok(sum.accuracy === 80 && sum.reaction === 275 && sum.score > 0, "a reaction run scores like the click drills (early clicks count as misses)", sum);
  ok(T.REACTION_TRIALS === 8, "eight tries");
}
// the chart
{
  let h = [];
  [100, 300, 200].forEach((sc, i) => { h = T.addRun(h, { drill: "flick", score: sc, accuracy: 90, reaction: 300, hits: 5, seconds: 30 }, 1000 + i); });
  h = T.addRun(h, { drill: "gridshot", score: 999, accuracy: 90, reaction: 300, hits: 5, seconds: 30 }, 5000);
  ok(T.series(h, "flick").join() === "100,300,200", "a drill's scores come oldest first, and only that drill's");
  ok(T.series(h, "flick", 2).join() === "300,200", "capped to the most recent");
  const sp = T.sparkline([100, 300, 200], 100, 40, 4);
  ok(sp.dots.length === 3 && sp.best === 1 && sp.dots[1].y < sp.dots[0].y && sp.dots[0].x === 4 && sp.dots[2].x === 96 && sp.line.startsWith("M4 "), "the line rises to the best run, inside the box", sp);
  ok(T.sparkline([], 100, 40).line === "" && T.sparkline([5], 100, 40).dots[0].x === 50 && T.sparkline([5, 5], 100, 40).dots[0].y === 20, "empty, one and flat series are fine");
}
// sensitivity
ok(T.cm360("cs2", 1, 800) === 51.95 && T.cm360("valorant", 0.35, 800) === 51.95 || Math.abs(T.cm360("valorant", 0.314, 800) - T.cm360("cs2", 1, 800)) < 0.5, "a CS2 sensitivity of 1 at 800 DPI is about 52 cm per turn, and Valorant has the matching number", [T.cm360("cs2", 1, 800), T.cm360("valorant", 0.314, 800)]);
ok(T.convertSens("cs2", "valorant", 1) === 0.3143 && T.convertSens("valorant", "cs2", 0.3143) > 0.99 && T.convertSens("valorant", "cs2", 0.3143) < 1.01, "CS2 1.0 is Valorant 0.3143, and back again");
ok(T.convertSens("cs2", "cs2", 2.5) === 2.5 && T.convertSens("apex", "cs2", 1.7) === 1.7, "the same game, or one with the same yaw, gives the same number");
ok(T.convertSens("cs2", "nope", 1) === null && T.convertSens("cs2", "apex", 0) === null && T.cm360("cs2", 1, 0) === null && T.cm360("x", 1, 800) === null, "bad input gives nothing rather than nonsense");
ok(Object.keys(T.GAMES).length >= 6 && Object.values(T.GAMES).every((g) => g.yaw > 0 && g.name), "a handful of games are known");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
