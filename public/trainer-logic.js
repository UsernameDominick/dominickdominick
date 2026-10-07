// The aim trainer's rules, with no page in them so a node test can load them: the drills, where targets go, how a run is scored, the
// settings and their limits, and the history kept in this browser. `window.TrainerLogic`.
(function () {
  "use strict";
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  const DRILLS = {
    gridshot: { name: "Gridshot", about: "Three targets sit on a grid. Hit one and another appears. Fast and accurate." },
    tracking: { name: "Tracking", about: "A target glides around. Keep your aim on it for as long as you can." },
    flick: { name: "Flick", about: "One target at a time, somewhere new each time. Snap to it and click." },
    precision: { name: "Precision", about: "Small targets, one at a time. Slow down just enough to hit every one." },
    reaction: { name: "Reaction", about: "Wait for the screen to turn green, then click as fast as you can. Eight tries." },
  };
  const REACTION_TRIALS = 8;
  // How big a drill's targets are, from the Target size setting: precision uses half-size targets.
  const targetSize = (drill, size) => Math.max(12, Math.round(drill === "precision" ? size * 0.5 : size));
  // The wait before the screen turns green, in ms (never the same twice because it comes from the run's own random numbers).
  const reactionDelay = (rng) => Math.round(900 + rng() * 2100);
  const DRILL_IDS = Object.keys(DRILLS);

  const DEFAULTS = { size: 48, duration: 30, sensitivity: 1, speed: 3, lock: false, crosshair: "dot" };
  const LIMITS = { size: [16, 120], duration: [10, 120], sensitivity: [0.1, 5], speed: [1, 6] };
  const CROSSHAIRS = ["dot", "cross", "circle"];

  // Settings from anywhere (storage, a form): numbers pulled into range, anything unknown dropped.
  function cleanSettings(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const out = {};
    Object.keys(LIMITS).forEach((k) => {
      const n = Number(r[k]);
      out[k] = Number.isFinite(n) ? clamp(n, LIMITS[k][0], LIMITS[k][1]) : DEFAULTS[k];
    });
    out.size = Math.round(out.size);
    out.duration = Math.round(out.duration / 5) * 5;
    out.sensitivity = Math.round(out.sensitivity * 100) / 100;
    out.speed = Math.round(out.speed * 10) / 10;
    out.lock = r.lock === true;
    out.crosshair = CROSSHAIRS.includes(r.crosshair) ? r.crosshair : DEFAULTS.crosshair;
    return out;
  }

  // A small seedable random number generator (so a test can replay a run).
  function makeRng(seed) {
    let s = (Number(seed) || 1) >>> 0 || 1;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- gridshot: a 3 x 3 grid, three targets on it at a time ----
  const GRID = 3;
  function gridCenter(cell, w, h, size) {
    const col = cell % GRID;
    const row = Math.floor(cell / GRID);
    const pad = size * 0.9;
    const innerW = Math.max(1, w - pad * 2);
    const innerH = Math.max(1, h - pad * 2);
    return { x: pad + (innerW * (col + 0.5)) / GRID, y: pad + (innerH * (row + 0.5)) / GRID };
  }
  // A cell that is not one of those already in use.
  function pickCell(rng, taken) {
    const free = [];
    for (let i = 0; i < GRID * GRID; i++) if (!taken.includes(i)) free.push(i);
    return free[Math.floor(rng() * free.length)];
  }

  // ---- flick: a new spot somewhere on the stage, well away from the last one ----
  function flickNext(rng, w, h, size, last, minDist) {
    const pad = size;
    const need = Math.min(minDist || Math.min(w, h) * 0.3, Math.hypot(w, h) * 0.4);
    let p = null;
    for (let i = 0; i < 24; i++) {
      p = { x: pad + rng() * Math.max(1, w - pad * 2), y: pad + rng() * Math.max(1, h - pad * 2) };
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= need) return p;
    }
    return p;
  }

  // ---- tracking: the target moves and bounces off the edges, changing its mind now and then ----
  function trackStart(rng, w, h, size) {
    const a = rng() * Math.PI * 2;
    return { x: w / 2, y: h / 2, vx: Math.cos(a), vy: Math.sin(a), turn: 0.6 + rng() };
  }
  // `speed` is in stage-widths per second divided by ten... simply: pixels per second = speed * 90 on a 800 px stage, scaled with it.
  function trackStep(t, dt, w, h, size, speed, rng) {
    const px = speed * 90 * (Math.min(w, h) / 600);
    const next = { x: t.x, y: t.y, vx: t.vx, vy: t.vy, turn: t.turn - dt };
    if (next.turn <= 0) {
      const a = Math.atan2(next.vy, next.vx) + (rng() - 0.5) * 2.2;
      next.vx = Math.cos(a);
      next.vy = Math.sin(a);
      next.turn = 0.5 + rng() * 1.2;
    }
    next.x += next.vx * px * dt;
    next.y += next.vy * px * dt;
    const r = size / 2;
    if (next.x < r) { next.x = r; next.vx = Math.abs(next.vx); }
    if (next.x > w - r) { next.x = w - r; next.vx = -Math.abs(next.vx); }
    if (next.y < r) { next.y = r; next.vy = Math.abs(next.vy); }
    if (next.y > h - r) { next.y = h - r; next.vy = -Math.abs(next.vy); }
    return next;
  }

  const hit = (target, x, y, size) => Math.hypot(x - target.x, y - target.y) <= size / 2;

  // Where the crosshair goes when the mouse is captured: it moves by the mouse's own movement times the sensitivity, and stays on the stage.
  function moveAim(aim, dx, dy, sens, w, h) {
    return { x: clamp(aim.x + dx * sens, 0, w), y: clamp(aim.y + dy * sens, 0, h) };
  }

  // ---- scoring ----
  // A run is { drill, hits, shots, reactions: [ms], onTarget: ms, total: ms }.
  function summarize(run) {
    const shots = Math.max(0, run.shots || 0);
    const hits = Math.max(0, run.hits || 0);
    const reactions = (run.reactions || []).filter((n) => Number.isFinite(n) && n >= 0);
    const avg = reactions.length ? Math.round(reactions.reduce((a, b) => a + b, 0) / reactions.length) : null;
    const total = Math.max(1, run.total || 1);
    let accuracy;
    let score;
    if (run.drill === "tracking") {
      accuracy = clamp(Math.round(((run.onTarget || 0) / total) * 100), 0, 100);
      score = Math.round(((run.onTarget || 0) / 1000) * 100);
    } else {
      accuracy = shots ? Math.round((hits / shots) * 100) : 0;
      // hits count, misses cost a little, a quick average adds a bonus
      const bonus = avg === null ? 0 : clamp(Math.round((700 - avg) / 10), 0, 50);
      score = Math.max(0, hits * 100 - (shots - hits) * 30 + hits * bonus);
    }
    return { drill: run.drill, hits, shots, accuracy, reaction: avg, score, seconds: Math.round(total / 1000) };
  }

  // ---- history, newest first, capped ----
  const HISTORY_MAX = 60;
  function cleanHistory(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e) => e && DRILL_IDS.includes(e.drill) && Number.isFinite(e.score))
      .map((e) => ({
        drill: e.drill,
        score: Math.round(e.score),
        accuracy: clamp(Math.round(Number(e.accuracy) || 0), 0, 100),
        reaction: Number.isFinite(e.reaction) ? Math.round(e.reaction) : null,
        hits: Math.max(0, Math.round(Number(e.hits) || 0)),
        seconds: Math.max(0, Math.round(Number(e.seconds) || 0)),
        at: Number.isFinite(e.at) ? e.at : 0,
      }))
      .slice(0, HISTORY_MAX);
  }
  function addRun(list, summary, at) {
    const entry = { drill: summary.drill, score: summary.score, accuracy: summary.accuracy, reaction: summary.reaction, hits: summary.hits, seconds: summary.seconds, at: at || 0 };
    return cleanHistory([entry, ...cleanHistory(list)]);
  }
  function bestOf(list, drill) {
    return cleanHistory(list).filter((e) => e.drill === drill).reduce((best, e) => (best === null || e.score > best ? e.score : best), null);
  }
  // Is this score the best so far for its drill (ignoring the run itself, already added)? The first run of a drill counts.
  function isRecord(listBefore, summary) {
    const best = bestOf(listBefore, summary.drill);
    return summary.score > 0 && (best === null || summary.score > best);
  }

  // ---- the chart: a drill's last scores, oldest first, as points in a small box ----
  function series(list, drill, n) {
    return cleanHistory(list).filter((e) => e.drill === drill).slice(0, n || 20).map((e) => e.score).reverse();
  }
  // { line: "M x y L x y ...", dots: [{x, y}], best: index of the highest } for `values` drawn in a w x h box with `pad` around it.
  function sparkline(values, w, h, pad) {
    const v = (values || []).filter((n) => Number.isFinite(n));
    const p = pad == null ? 4 : pad;
    if (!v.length) return { line: "", dots: [], best: -1 };
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    const span = hi - lo || 1;
    const dots = v.map((n, i) => ({
      x: Math.round((v.length === 1 ? w / 2 : p + ((w - p * 2) * i) / (v.length - 1)) * 10) / 10,
      y: Math.round((hi === lo ? h / 2 : h - p - ((h - p * 2) * (n - lo)) / span) * 10) / 10,
    }));
    return { line: dots.map((d, i) => `${i ? "L" : "M"}${d.x} ${d.y}`).join(" "), dots, best: v.indexOf(hi) };
  }

  // ---- sensitivity: the same turn of the wrist in different games ----
  // `yaw` is how many degrees the view turns for one count of the mouse at a sensitivity of 1 (the numbers the games' own communities use).
  const GAMES = {
    cs2: { name: "CS2 and CS:GO", yaw: 0.022 },
    valorant: { name: "Valorant", yaw: 0.07 },
    apex: { name: "Apex Legends", yaw: 0.022 },
    overwatch: { name: "Overwatch 2", yaw: 0.0066 },
    cod: { name: "Call of Duty", yaw: 0.0066 },
    r6: { name: "Rainbow Six Siege", yaw: 0.00572957795 },
  };
  // How far (cm) the mouse travels for a full turn, at `dpi`.
  function cm360(game, sens, dpi) {
    const g = GAMES[game];
    const n = Number(sens);
    const d = Number(dpi);
    if (!g || !(n > 0) || !(d > 0)) return null;
    return Math.round(((360 / (d * g.yaw * n)) * 2.54) * 100) / 100;
  }
  // The sensitivity in game `to` that turns the view as far as `sens` does in game `from` (the DPI cancels out).
  function convertSens(from, to, sens) {
    const a = GAMES[from];
    const b = GAMES[to];
    const n = Number(sens);
    if (!a || !b || !(n > 0)) return null;
    const out = (n * a.yaw) / b.yaw;
    return Math.round(out * (out < 1 ? 10000 : 1000)) / (out < 1 ? 10000 : 1000);
  }

  window.TrainerLogic = { DRILLS, DRILL_IDS, DEFAULTS, LIMITS, CROSSHAIRS, GRID, HISTORY_MAX, REACTION_TRIALS, GAMES, targetSize, reactionDelay, series, sparkline, cm360, convertSens, cleanSettings, makeRng, gridCenter, pickCell, flickNext, trackStart, trackStep, hit, moveAim, summarize, cleanHistory, addRun, bestOf, isRecord };
})();
