// The Trainer page (/trainer): an aim trainer for FPS games. Three drills (gridshot, tracking, flick), a left panel with the drills and your
// recent runs, a right panel with the settings, both foldable like the Studio's. Everything is kept in this browser (localStorage); nothing
// is sent anywhere. The rules (target placement, movement, scoring, history) are in /trainer-logic.js so a node test can check them.
(function () {
  "use strict";
  const K = window.SiteAppKit;
  if (!K) return;
  let L = null; // /trainer-logic.js, loaded by the kit before build() runs
  const KEYS = { settings: "trainer.settings.v1", history: "trainer.history.v1", start: "trainer.start.v1", last: "trainer.last.v1", left: "trainer.leftPanel", right: "trainer.rightPanel" };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* not kept */ } },
  };
  const json = (k, fallback) => { try { return JSON.parse(store.get(k)) ?? fallback; } catch (e) { return fallback; } };
  const esc = K.esc;

  let root = null;
  let settings = null;
  let history = [];
  let drill = null;
  let run = null; // the run in progress
  let raf = 0;
  let aim = { x: 0, y: 0 };
  let pressed = false;
  let seed = Date.now();
  let lastResult = null; // the run just finished, for the Share button
  const sz = () => L.targetSize(run ? run.drill : drill, settings.size);
  const els = {};
  const $ = (sel) => root.querySelector(sel);

  // Which drill the page opens on: the one chosen under "Opens with", or the last one used.
  function startDrill() {
    const choice = store.get(KEYS.start) || "last";
    if (L.DRILL_IDS.includes(choice)) return choice;
    const last = store.get(KEYS.last);
    return L.DRILL_IDS.includes(last) ? last : "gridshot";
  }

  const settingRows = () => [
    { key: "size", label: "Target size", unit: " px", min: L.LIMITS.size[0], max: L.LIMITS.size[1], step: 2 },
    { key: "duration", label: "Run length", unit: " s", min: L.LIMITS.duration[0], max: L.LIMITS.duration[1], step: 5 },
    { key: "speed", label: "Tracking speed", unit: "", min: L.LIMITS.speed[0], max: L.LIMITS.speed[1], step: 0.5, only: "tracking" },
  ];

  function shellHtml() {
    return `<div class="trainer" data-drill="gridshot">
      <aside id="trainer-left" class="trainer-panel trainer-left" aria-label="Drills and runs">
        <div class="studio-panel-head"><h2>Drills</h2>
          <button type="button" class="studio-panel-fold" aria-expanded="true" aria-controls="trainer-left-body" aria-label="Hide the drills panel" title="Hide the drills panel">←</button></div>
        <div id="trainer-left-body" class="studio-panel-body">
          <div class="trainer-drills" role="radiogroup" aria-label="Drill"></div>
          <div class="trainer-chart"></div>
          <h3 class="trainer-sub">Recent runs</h3>
          <ol class="trainer-history"></ol>
          <button type="button" class="btn trainer-clear" hidden>Clear history</button>
        </div>
        <button type="button" class="studio-panel-handle" aria-expanded="false" aria-controls="trainer-left-body" title="Show the drills"><span>Drills</span></button>
      </aside>
      <section class="trainer-main" aria-label="Aim trainer">
        <div class="trainer-bar">
          <div class="trainer-readout"><span class="trainer-name"></span><span class="trainer-about"></span></div>
          <dl class="trainer-live" aria-hidden="true">
            <div><dt>Time</dt><dd class="live-time">0</dd></div>
            <div><dt>Hits</dt><dd class="live-hits">0</dd></div>
            <div><dt>Accuracy</dt><dd class="live-acc">-</dd></div>
          </dl>
        </div>
        <div class="trainer-stage" id="trainer-stage" role="group" aria-label="Practice area" tabindex="-1">
          <div class="trainer-field"></div>
          <div class="trainer-aim" hidden></div>
          <div class="trainer-overlay">
            <div class="trainer-card trainer-intro">
              <h2 class="intro-title"></h2>
              <p class="intro-text"></p>
              <button type="button" class="btn btn-accent trainer-go">Start</button>
              <p class="intro-hint">Esc ends a run early.</p>
            </div>
            <div class="trainer-card trainer-result" hidden>
              <h2>Run finished</h2>
              <p class="result-record" hidden>New best for this drill.</p>
              <dl class="result-grid"></dl>
              <div class="result-chart"></div>
              <div class="result-actions"><button type="button" class="btn btn-accent trainer-again">Go again</button><button type="button" class="btn trainer-share">Share score</button><button type="button" class="btn trainer-close">Done</button></div>
              <p class="result-share-status" role="status"></p>
            </div>
            <div class="trainer-count" hidden aria-hidden="true"></div>
          </div>
        </div>
        <p class="trainer-status sr-only" role="status" aria-live="polite"></p>
      </section>
      <aside id="trainer-right" class="trainer-panel trainer-right" aria-label="Settings">
        <div class="studio-panel-head"><h2>Settings</h2>
          <button type="button" class="studio-panel-fold" aria-expanded="true" aria-controls="trainer-right-body" aria-label="Hide the settings panel" title="Hide the settings panel">→</button></div>
        <div id="trainer-right-body" class="studio-panel-body"><div class="trainer-settings"></div><div class="trainer-backup"></div></div>
        <button type="button" class="studio-panel-handle" aria-expanded="false" aria-controls="trainer-right-body" title="Show the settings"><span>Settings</span></button>
      </aside>
    </div>`;
  }

  // ---------- panels ----------
  function renderDrills() {
    $(".trainer-drills").innerHTML = L.DRILL_IDS.map((id) => {
      const best = L.bestOf(history, id);
      return `<button type="button" role="radio" class="trainer-drill" data-drill="${id}" aria-checked="${id === drill}"><span class="drill-name">${esc(L.DRILLS[id].name)}</span><span class="drill-best">${best === null ? "No runs yet" : "Best " + best}</span></button>`;
    }).join("");
  }
  // A drill's recent scores as a line: how you are doing over time, with the best run marked.
  function chartHtml(id, w, h) {
    const values = L.series(history, id, 20);
    if (values.length < 2) return `<p class="trainer-chart-empty">${values.length ? "One run so far: play a few more to see your progress." : "Play a few runs to see your progress."}</p>`;
    const sp = L.sparkline(values, w, h, 6);
    const best = Math.max(...values);
    const dots = sp.dots.map((d, i) => `<circle cx="${d.x}" cy="${d.y}" r="${i === sp.best ? 4.5 : 2.5}" class="${i === sp.best ? "is-best" : ""}"/>`).join("");
    return `<svg viewBox="0 0 ${w} ${h}" class="trainer-spark" role="img" aria-label="Your last ${values.length} ${esc(L.DRILLS[id].name)} scores, from ${values[0]} to ${values[values.length - 1]}, best ${best}"><path d="${sp.line}" fill="none"/>${dots}</svg><p class="trainer-chart-cap">Last ${values.length} runs · best ${best}</p>`;
  }
  function renderChart() {
    $(".trainer-chart").innerHTML = `<h3 class="trainer-sub">Progress</h3>${chartHtml(drill, 220, 70)}`;
  }
  function renderHistory() {
    renderChart();
    const list = history.slice(0, 12);
    $(".trainer-history").innerHTML = list.length
      ? list.map((e) => `<li><span class="h-drill">${esc(L.DRILLS[e.drill].name)}</span><span class="h-score">${e.score}</span><span class="h-meta">${e.accuracy}%${e.reaction === null ? "" : " · " + e.reaction + " ms"}</span></li>`).join("")
      : `<li class="trainer-empty">Your runs show up here.</li>`;
    $(".trainer-clear").hidden = !history.length;
  }
  const gameOptions = (sel) => Object.keys(L.GAMES).map((k) => `<option value="${k}"${k === sel ? " selected" : ""}>${esc(L.GAMES[k].name)}</option>`).join("");
  // The same turn of the wrist in another game: its sensitivity, and how far the mouse travels for a full turn.
  function convert() {
    const out = $("#conv-out");
    if (!out) return;
    const from = $("#conv-from").value;
    const to = $("#conv-to").value;
    const sens = Number($("#conv-sens").value);
    const dpi = Number($("#conv-dpi").value);
    const r = L.convertSens(from, to, sens);
    const cm = L.cm360(from, sens, dpi);
    out.textContent = r === null ? "Enter a sensitivity above zero." : `${L.GAMES[to].name}: ${r}` + (cm === null ? "" : `  ·  ${cm} cm per full turn${dpi ? " at " + dpi + " DPI" : ""}`);
  }
  function renderSettings() {
    const rows = settingRows().map((r) => `<label class="trainer-row" data-row="${r.key}" data-only="${r.only || ""}"${r.only && r.only !== drill ? " hidden" : ""}><span class="field-label">${esc(r.label)}</span>
        <input type="range" data-key="${r.key}" min="${r.min}" max="${r.max}" step="${r.step}" value="${settings[r.key]}"><output>${settings[r.key]}${r.unit}</output></label>`).join("");
    $(".trainer-settings").innerHTML = `${rows}
      <label class="trainer-check"><input type="checkbox" data-key="lock"${settings.lock ? " checked" : ""}><span>Capture the mouse like a game</span></label>
      <label class="trainer-row" data-only="lock"${settings.lock ? "" : " hidden"}><span class="field-label">Sensitivity</span>
        <input type="range" data-key="sensitivity" min="${L.LIMITS.sensitivity[0]}" max="${L.LIMITS.sensitivity[1]}" step="0.05" value="${settings.sensitivity}"><output>${settings.sensitivity}x</output></label>
      <label class="trainer-row trainer-select"><span class="field-label">Crosshair</span>
        <select data-key="crosshair">${L.CROSSHAIRS.map((c) => `<option value="${c}"${settings.crosshair === c ? " selected" : ""}>${c[0].toUpperCase() + c.slice(1)}</option>`).join("")}</select></label>
      <label class="trainer-row trainer-select"><span class="field-label">Opens with</span>
        <select id="trainer-start"><option value="last">The drill I used last</option>${L.DRILL_IDS.map((id) => `<option value="${id}"${store.get(KEYS.start) === id ? " selected" : ""}>${esc(L.DRILLS[id].name)}</option>`).join("")}</select></label>
      <details class="trainer-convert"><summary>Convert sensitivity between games</summary>
        <label class="trainer-row trainer-select"><span class="field-label">From</span><select id="conv-from">${gameOptions("cs2")}</select></label>
        <label class="trainer-row"><span class="field-label">Sensitivity</span><input type="number" id="conv-sens" min="0.001" step="any" value="1" inputmode="decimal"></label>
        <label class="trainer-row trainer-select"><span class="field-label">To</span><select id="conv-to">${gameOptions("valorant")}</select></label>
        <label class="trainer-row"><span class="field-label">Mouse DPI (optional)</span><input type="number" id="conv-dpi" min="100" step="50" value="800" inputmode="numeric"></label>
        <p class="trainer-convert-out" id="conv-out" role="status" aria-live="polite"></p>
      </details>
      <p class="trainer-note">Settings and runs stay in this browser.</p>`;
    paintAimLook();
    rowsFor(drill);
    convert();
  }
  function paintAimLook() {
    els.aim.className = "trainer-aim is-" + settings.crosshair;
  }

  function setupFold(side, key) {
    const el = $("#trainer-" + side);
    const apply = (on) => {
      store.set(key, on ? "folded" : "open");
      $(".trainer").classList.toggle("is-" + side + "-folded", on);
      el.querySelectorAll(".studio-panel-fold, .studio-panel-handle").forEach((b) => b.setAttribute("aria-expanded", String(!on)));
    };
    apply(store.get(key) === "folded");
    el.addEventListener("click", (e) => {
      if (e.target.closest(".studio-panel-fold")) { apply(true); el.querySelector(".studio-panel-handle").focus(); }
      else if (e.target.closest(".studio-panel-handle")) { apply(false); el.querySelector(".studio-panel-fold").focus(); }
    });
  }

  // Which settings matter for the drill: the speed only for tracking; the reaction drill has no targets and no length.
  function rowsFor(id) {
    root.querySelectorAll("[data-row]").forEach((row) => {
      const key = row.dataset.row;
      row.hidden = (key === "speed" && id !== "tracking") || ((key === "size" || key === "duration") && id === "reaction");
    });
  }

  // ---------- picking a drill ----------
  function chooseDrill(id) {
    if (run) return;
    drill = id;
    store.set(KEYS.last, id);
    $(".trainer").dataset.drill = id;
    $(".trainer-name").textContent = L.DRILLS[id].name;
    $(".trainer-about").textContent = L.DRILLS[id].about;
    $(".intro-title").textContent = L.DRILLS[id].name;
    $(".intro-text").textContent = id === "tracking" ? "Hold the button down and keep your aim on the moving target. Time on target is your score." : id === "reaction" ? L.DRILLS[id].about + " Clicking early costs you." : L.DRILLS[id].about + " Click as fast as you can without missing.";
    renderDrills();
    renderChart();
    rowsFor(id);
    $(".trainer-settings").querySelectorAll("[data-only]").forEach((row) => {
      const only = row.dataset.only;
      if (only === "tracking") row.hidden = id !== "tracking";
    });
    showOverlay("intro");
    clearField();
  }

  // ---------- the stage ----------
  const stageSize = () => ({ w: els.stage.clientWidth, h: els.stage.clientHeight });
  function clearField() { els.field.innerHTML = ""; }
  function showOverlay(which) {
    const o = $(".trainer-overlay");
    o.hidden = !which;
    $(".trainer-intro").hidden = which !== "intro";
    $(".trainer-result").hidden = which !== "result";
    $(".trainer-count").hidden = which !== "count";
  }
  function spot(t) {
    t.el.style.transform = `translate(${t.x - sz() / 2}px, ${t.y - sz() / 2}px)`;
  }
  function makeTarget(x, y, extra) {
    const el = document.createElement("div");
    el.className = "trainer-target";
    el.style.width = el.style.height = sz() + "px";
    el.setAttribute("aria-hidden", "true");
    els.field.appendChild(el);
    const t = Object.assign({ el, x, y, born: performance.now() }, extra || {});
    spot(t);
    return t;
  }
  function rng() { return run.rng(); }

  function spawnGrid(first) {
    const { w, h } = stageSize();
    const taken = run.targets.map((t) => t.cell);
    const cell = L.pickCell(rng, taken);
    const c = L.gridCenter(cell, w, h, sz());
    run.targets.push(makeTarget(c.x, c.y, { cell }));
    return first;
  }
  function spawnFlick() {
    const { w, h } = stageSize();
    const last = run.last;
    const p = L.flickNext(rng, w, h, sz(), last, Math.min(w, h) * 0.35);
    run.last = p;
    run.targets = [makeTarget(p.x, p.y, {})];
  }

  // ---------- a run ----------
  function begin() {
    if (run) return;
    seed = (seed * 1103515245 + 12345) >>> 0;
    run = { drill, state: "count", rng: L.makeRng(seed), hits: 0, shots: 0, reactions: [], onTarget: 0, targets: [], last: null, startAt: 0, lastFrame: 0, track: null, tracked: false };
    clearField();
    $(".trainer").classList.add("is-running");
    const { w, h } = stageSize();
    aim = { x: w / 2, y: h / 2 };
    placeAim();
    els.aim.hidden = !settings.lock && true;
    if (settings.lock) {
      try {
        const p = els.stage.requestPointerLock && els.stage.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* the page still works with the normal pointer */ }
    }
    let n = 3;
    showOverlay("count");
    const tick = () => {
      if (!run || run.state !== "count") return;
      const c = $(".trainer-count");
      if (n === 0) { startRun(); return; }
      c.textContent = String(n--);
      run.timer = setTimeout(tick, 500);
    };
    tick();
  }
  function startRun() {
    showOverlay(null);
    run.state = "go";
    run.startAt = performance.now();
    run.lastFrame = run.startAt;
    const { w, h } = stageSize();
    if (drill === "gridshot") for (let i = 0; i < 3; i++) spawnGrid();
    else if (drill === "flick" || drill === "precision") spawnFlick();
    else if (drill === "reaction") reactionNext();
    else {
      run.track = L.trackStart(rng, w, h, sz());
      run.targets = [makeTarget(run.track.x, run.track.y, {})];
    }
    els.stage.focus({ preventScroll: true });
    raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    if (!run || run.state !== "go") return;
    const dt = Math.min(0.05, (now - run.lastFrame) / 1000);
    run.lastFrame = now;
    const elapsed = now - run.startAt;
    if (drill === "tracking") {
      const { w, h } = stageSize();
      run.track = L.trackStep(run.track, dt, w, h, sz(), settings.speed, rng);
      const t = run.targets[0];
      t.x = run.track.x;
      t.y = run.track.y;
      spot(t);
      const on = pressed && L.hit(t, aim.x, aim.y, sz());
      t.el.classList.toggle("is-on", on);
      if (on) run.onTarget += dt * 1000;
    }
    paintLive(elapsed);
    if (drill !== "reaction" && elapsed >= settings.duration * 1000) return finish(elapsed);
    raf = requestAnimationFrame(frame);
  }
  function summaryNow(elapsed) {
    return L.summarize({ drill, hits: run.hits, shots: run.shots, reactions: run.reactions, onTarget: run.onTarget, total: elapsed });
  }
  function paintLive(elapsed) {
    if (!run) {
      $(".live-time").textContent = "0 s";
      $(".live-hits").textContent = "0";
      $(".live-acc").textContent = "-";
      return;
    }
    $(".live-time").textContent = run.drill === "reaction" ? `${run.hits} of ${L.REACTION_TRIALS}` : Math.max(0, Math.ceil(settings.duration - elapsed / 1000)) + " s";
    if (drill === "tracking") {
      $(".live-hits").textContent = Math.round(run.onTarget / 100) / 10 + " s";
      $(".live-acc").textContent = elapsed > 500 ? Math.min(100, Math.round((run.onTarget / elapsed) * 100)) + "%" : "-";
    } else if (run.drill === "reaction") {
      const avg = run.reactions.length ? Math.round(run.reactions.reduce((a, b) => a + b, 0) / run.reactions.length) : null;
      $(".live-hits").textContent = avg === null ? "-" : avg + " ms";
      $(".live-acc").textContent = run.shots ? Math.round((run.hits / run.shots) * 100) + "%" : "-";
    } else {
      $(".live-hits").textContent = String(run.hits);
      $(".live-acc").textContent = run.shots ? Math.round((run.hits / run.shots) * 100) + "%" : "-";
    }
  }
  function release() {
    if (document.pointerLockElement === els.stage && document.exitPointerLock) document.exitPointerLock();
    els.aim.hidden = true;
    pressed = false;
  }
  function stop() {
    if (!run) return;
    clearTimeout(run.timer);
    clearTimeout(run.cueTimer);
    cancelAnimationFrame(raf);
    release();
    run = null;
    $(".trainer").classList.remove("is-running");
  }
  function finish(elapsed) {
    const done = summaryNow(run.drill === "reaction" ? elapsed : Math.min(elapsed, settings.duration * 1000));
    const record = L.isRecord(history, done);
    const run_best = run.reactions.length ? Math.min(...run.reactions) : null;
    stop();
    history = L.addRun(history, done, Date.now());
    store.set(KEYS.history, JSON.stringify(history));
    renderDrills();
    renderHistory();
    clearField();
    const grid = $(".result-grid");
    const isTrack = done.drill === "tracking";
    const isReact = done.drill === "reaction";
    const best = run_best;
    grid.innerHTML = (isReact
      ? [["Score", done.score], ["Average", done.reaction === null ? "-" : done.reaction + " ms"], ["Fastest", best === null ? "-" : best + " ms"], ["Early clicks", done.shots - done.hits]]
      : [
          ["Score", done.score],
          [isTrack ? "Time on target" : "Accuracy", done.accuracy + "%"],
          isTrack ? ["Run length", done.seconds + " s"] : ["Hits", done.hits + " of " + done.shots],
          isTrack ? null : ["Reaction", done.reaction === null ? "-" : done.reaction + " ms"],
        ]
    ).filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
    lastResult = { done, record };
    $(".result-chart").innerHTML = chartHtml(done.drill, 320, 80);
    $(".result-record").hidden = !record;
    showOverlay("result");
    $(".trainer-status").textContent = `Run finished. Score ${done.score}, accuracy ${done.accuracy} percent.${record ? " New best." : ""}`;
    $(".trainer-again").focus({ preventScroll: true });
  }
  function abort() {
    if (!run) return;
    stop();
    clearField();
    showOverlay("intro");
    paintLive(0);
    $(".trainer-status").textContent = "Run ended.";
    $(".trainer-go").focus({ preventScroll: true });
  }

  // ---------- the reaction drill: wait for green, then click ----------
  function reactionNext() {
    if (!run) return;
    clearField();
    const cue = document.createElement("div");
    cue.className = "trainer-cue is-wait";
    cue.textContent = "Wait for green…";
    els.field.appendChild(cue);
    run.cueEl = cue;
    run.cueOn = false;
    run.pause = false;
    run.cueTimer = setTimeout(() => {
      if (!run) return;
      run.cueOn = true;
      run.cueAt = performance.now();
      cue.className = "trainer-cue is-go";
      cue.textContent = "Click!";
    }, L.reactionDelay(rng));
  }
  function reactionClick() {
    if (!run || run.state !== "go" || run.pause) return;
    const now = performance.now();
    run.shots++;
    run.pause = true;
    if (!run.cueOn) {
      // too soon: it counts against you and the wait starts again
      clearTimeout(run.cueTimer);
      run.cueEl.className = "trainer-cue is-early";
      run.cueEl.textContent = "Too soon. Wait for green.";
      run.timer = setTimeout(reactionNext, 1000);
    } else {
      const ms = Math.round(now - run.cueAt);
      run.hits++;
      run.reactions.push(ms);
      run.cueOn = false;
      run.cueEl.className = "trainer-cue is-result";
      run.cueEl.textContent = ms + " ms";
      if (run.hits >= L.REACTION_TRIALS) run.timer = setTimeout(() => finish(performance.now() - run.startAt), 800);
      else run.timer = setTimeout(reactionNext, 900);
    }
    paintLive(now - run.startAt);
  }

  // ---------- sharing a score: a picture of the result, shared or saved ----------
  function cardBlob(done, record) {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 630;
    const g = c.getContext("2d");
    g.fillStyle = "#1a1620";
    g.fillRect(0, 0, 1200, 630);
    g.fillStyle = "#d65624";
    g.fillRect(0, 0, 18, 630);
    const font = (size, weight) => `${weight || 400} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.fillStyle = "#b0a6a0";
    g.font = font(32);
    g.fillText("dominickdominick.com/trainer", 80, 100);
    g.fillStyle = "#f7eee4";
    g.font = font(84, 700);
    g.fillText(L.DRILLS[done.drill].name, 80, 220);
    g.font = font(190, 800);
    g.fillStyle = "#d65624";
    g.fillText(String(done.score), 80, 410);
    g.fillStyle = "#f7eee4";
    g.font = font(44, 600);
    const lines = done.drill === "tracking" ? [`${done.accuracy}% on target`] : done.drill === "reaction" ? [done.reaction === null ? "" : `${done.reaction} ms average`, `${done.hits} of ${L.REACTION_TRIALS} clean`] : [`${done.accuracy}% accuracy`, done.reaction === null ? "" : `${done.reaction} ms per target`];
    lines.filter(Boolean).forEach((t, i) => g.fillText(t, 80, 490 + i * 56));
    if (record) {
      g.fillStyle = "#3ecf8e";
      g.font = font(40, 700);
      g.fillText("New best", 80, 580);
    }
    return new Promise((resolve) => c.toBlob(resolve, "image/png"));
  }
  async function shareScore() {
    const say = (t) => { $(".result-share-status").textContent = t; };
    if (!lastResult) return;
    const { done, record } = lastResult;
    const text = `I scored ${done.score} on ${L.DRILLS[done.drill].name} in the aim trainer (${done.accuracy}%). dominickdominick.com/trainer`;
    try {
      const blob = await cardBlob(done, record);
      const file = new File([blob], "aim-score.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text });
          return say("Shared.");
        } catch (err) {
          if (err && err.name === "AbortError") return;
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "aim-score.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      say("Saved the picture of your score.");
    } catch (err) {
      say("That did not work here.");
    }
  }

  // ---------- aiming ----------
  function placeAim() { els.aim.style.transform = `translate(${aim.x}px, ${aim.y}px)`; }
  function pointer(e) {
    const r = els.stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function shoot(x, y) {
    if (!run || run.state !== "go") return;
    run.shots++;
    const now = performance.now();
    const t = run.targets.find((q) => L.hit(q, x, y, sz()));
    if (t) {
      run.hits++;
      run.reactions.push(Math.round(now - t.born));
      t.el.remove();
      run.targets = run.targets.filter((q) => q !== t);
      if (drill === "gridshot") spawnGrid();
      else spawnFlick();
    } else {
      flash(x, y);
    }
    paintLive(now - run.startAt);
  }
  function flash(x, y) {
    const m = document.createElement("div");
    m.className = "trainer-miss";
    m.style.transform = `translate(${x - 8}px, ${y - 8}px)`;
    els.field.appendChild(m);
    setTimeout(() => m.remove(), 300);
  }

  function wire() {
    els.stage.addEventListener("pointerdown", (e) => {
      if (!run || run.state !== "go") return;
      if (e.button > 0) return;
      e.preventDefault();
      pressed = true;
      if (!settings.lock) aim = pointer(e);
      if (drill === "reaction") reactionClick();
      else if (drill !== "tracking") shoot(aim.x, aim.y);
      try { if (!settings.lock) els.stage.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    });
    els.stage.addEventListener("pointerup", () => { pressed = false; });
    els.stage.addEventListener("pointercancel", () => { pressed = false; });
    els.stage.addEventListener("pointermove", (e) => {
      if (!run) return;
      if (settings.lock && document.pointerLockElement === els.stage) {
        const { w, h } = stageSize();
        aim = L.moveAim(aim, e.movementX || 0, e.movementY || 0, settings.sensitivity, w, h);
        placeAim();
      } else if (!settings.lock) aim = pointer(e);
    });
    els.stage.addEventListener("contextmenu", (e) => { if (run) e.preventDefault(); });
    document.addEventListener("pointerlockchange", () => {
      // Esc in a captured mouse lets go of it: that ends the run.
      if (run && settings.lock && document.pointerLockElement !== els.stage && run.state !== "count") abort();
    });
    root.addEventListener("click", (e) => {
      const d = e.target.closest(".trainer-drill");
      if (d) return chooseDrill(d.dataset.drill);
      if (e.target.closest(".trainer-go, .trainer-again")) return begin();
      if (e.target.closest(".trainer-close")) return showOverlay("intro");
      if (e.target.closest(".trainer-share")) return shareScore();
      if (e.target.closest(".trainer-clear")) {
        if (!window.confirm("Clear your runs from this browser?")) return;
        history = [];
        store.set(KEYS.history, "[]");
        renderDrills();
        renderHistory();
      }
    });
    root.addEventListener("input", (e) => {
      const key = e.target.dataset && e.target.dataset.key;
      if (!key) return;
      const next = Object.assign({}, settings, { [key]: e.target.type === "checkbox" ? e.target.checked : e.target.type === "range" ? Number(e.target.value) : e.target.value });
      settings = L.cleanSettings(next);
      store.set(KEYS.settings, JSON.stringify(settings));
      const out = e.target.parentElement.querySelector("output");
      if (out) out.textContent = settings[key] + (key === "sensitivity" ? "x" : key === "duration" ? " s" : key === "size" ? " px" : "");
      if (key === "lock") root.querySelector('[data-only="lock"]').hidden = !settings.lock;
      if (key === "crosshair") paintAimLook();
    });
    root.addEventListener("change", (e) => {
      if (e.target.id === "trainer-start") store.set(KEYS.start, e.target.value);
    });
    root.addEventListener("input", (e) => { if (e.target.closest && e.target.closest(".trainer-convert")) convert(); });
    root.addEventListener("change", (e) => { if (e.target.closest && e.target.closest(".trainer-convert")) convert(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && run && document.contains(root)) { e.preventDefault(); abort(); }
    });
  }

  // Back up and restore: your settings and runs to one file, and back (runs are merged, your current settings are kept).
  function makeBackup() {
    return K.backup({
      app: "trainer",
      collect: async () => ({ settings, history, start: store.get(KEYS.start) || "last" }),
      restore: async (parts) => {
        const had = history.length;
        const seen = new Set(history.map((e) => [e.drill, e.at, e.score].join("|")));
        const extra = L.cleanHistory(parts.history).filter((e) => !seen.has([e.drill, e.at, e.score].join("|")));
        history = L.cleanHistory(history.concat(extra).sort((a, b) => b.at - a.at));
        store.set(KEYS.history, JSON.stringify(history));
        if (!store.get(KEYS.settings) && parts.settings) {
          settings = L.cleanSettings(parts.settings);
          store.set(KEYS.settings, JSON.stringify(settings));
        }
        renderDrills();
        renderHistory();
        renderSettings();
        return { added: Math.max(0, history.length - had), skipped: extra.length === 0 ? L.cleanHistory(parts.history).length : 0, full: 0 };
      },
    });
  }

  K.register({
    name: "trainer",
    mountId: "trainer-mount",
    shellClass: "trainer-native",
    loadingText: "Loading the Trainer…",
    standalone: true,
    scripts: ["/backup-logic.js", "/trainer-logic.js"],
    build(inner) {
      L = window.TrainerLogic;
      settings = L.cleanSettings(json(KEYS.settings, {}));
      history = L.cleanHistory(json(KEYS.history, []));
      root = inner;
      inner.innerHTML = shellHtml();
      els.stage = $("#trainer-stage");
      els.field = $(".trainer-field");
      els.aim = $(".trainer-aim");
      setupFold("left", KEYS.left);
      setupFold("right", KEYS.right);
      renderSettings();
      renderHistory();
      wire();
      const bk = makeBackup();
      $(".trainer-backup").appendChild(bk);
      chooseDrill(startDrill());
    },
    shown() {},
    onLeave() { abort(); },
  });
})();
