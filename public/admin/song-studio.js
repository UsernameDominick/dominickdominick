// The Song builder's Studio layout, built for a phone first. Top to bottom: a stack of five layer cards you swipe through or tap, one
// expanded card for the layer being edited (its steps and its sound), the play controls, and a scrollable piano keyboard.
//
// It is a view over the classic editor, not a second editor. The classic editor stays in the page (hidden) and every control here drives
// the matching classic control or clicks the matching classic step, so undo, autosave, recording, ties and the saved song are exactly
// what they always were. The five layers are not stored; they are a fixed grouping of the song's own drum rows, bass line and melody.
(function () {
  const $ = (id) => document.getElementById(id);
  const modal = $("song-builder-modal");
  const studio = $("song-studio");
  if (!modal || !studio) return;
  const Engine = window.SongEngine;
  const host = () => window.SongStudioHost;
  const song = () => (host() ? host().song() : null);

  // The order is fixed on purpose: layer 1 to 5 always mean the same thing.
  const LAYERS = [
    { id: "kick", n: 1, name: "Kick", kind: "drums", rows: ["kick"], add: [] },
    { id: "snare", n: 2, name: "Snare & clap", kind: "drums", rows: ["snare", "clap", "rim"], add: ["rim"] },
    { id: "hats", n: 3, name: "Hats & perc", kind: "drums", rows: ["hihat", "openhat", "tom", "crash"], add: ["openhat", "tom", "crash"] },
    { id: "bass", n: 4, name: "Bass", kind: "bass" },
    { id: "melody", n: 5, name: "Melody", kind: "melody" },
  ];
  const ROW_LABELS = { kick: "Kick", snare: "Snare", hihat: "Hi-hat", openhat: "Open hat", clap: "Clap", rim: "Rim", tom: "Tom", crash: "Crash" };
  const ROW_SHORT = { kick: "Kick", snare: "Snare", hihat: "Hat", openhat: "Open", clap: "Clap", rim: "Rim", tom: "Tom", crash: "Crash" };
  // Semitones above C0: the melody roll is C3 to B4 and the bass roll C1 to B2, the same as the classic editor's.
  const RANGE = { melody: [36, 59], bass: [12, 35] };
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const STEPS = 16;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const semis = (name) => {
    const m = /^([A-G]#?)(-?\d)$/.exec(name);
    return m ? NAMES.indexOf(m[1]) + 12 * Number(m[2]) : 0;
  };
  const noteName = (n) => NAMES[n % 12] + Math.floor(n / 12);
  const layerOf = (id) => LAYERS.find((l) => l.id === id) || LAYERS[0];
  const layerIndex = () => LAYERS.findIndex((l) => l.id === layerId);
  const unitOf = (layer, n) => (layer.kind === "drums" ? "hit" : "note") + (n === 1 ? "" : "s");

  let view = "studio";
  try {
    if (localStorage.getItem("songView") === "classic") view = "classic";
  } catch {
    /* no storage: studio */
  }
  let layerId = "kick";

  // ---------- reading the song ----------
  const meta = (s, row) => (s.trackMeta && s.trackMeta[row]) || {};
  const rowsOf = (s, layer) => layer.rows.filter((r) => s.tracks && s.tracks[r]);
  const partOf = (s, layer) => (layer.kind === "bass" ? s.bass : s.melody) || { notes: {} };
  const hit = (v) => v !== false && v != null && v !== 0;
  function layerInfo(s, layer) {
    if (layer.kind === "drums") {
      const rows = rowsOf(s, layer);
      const cells = [];
      rows.forEach((row, ri) => (s.tracks[row] || []).forEach((v, i) => hit(v) && cells.push({ x: i, y: ri, h: rows.length, a: Engine.stepLevel(v) })));
      const muted = rows.length > 0 && rows.every((r) => meta(s, r).muted === true);
      const kit = s.kit || "acoustic";
      return { cells, count: cells.length, muted, sound: kit.charAt(0).toUpperCase() + kit.slice(1) + " kit", rows };
    }
    const part = partOf(s, layer);
    const [lo, hi] = RANGE[layer.kind];
    const cells = [];
    Object.keys(part.notes || {}).forEach((name) => {
      const y = hi - semis(name);
      (part.notes[name] || []).forEach((v, i) => hit(v) && y >= 0 && y <= hi - lo && cells.push({ x: i, y, h: hi - lo + 1, a: Engine.stepLevel(v) }));
    });
    const voice = layer.kind === "bass" ? Engine.bassVoiceOf(s) : Engine.melodyVoiceOf(s);
    const label = voice && Engine.MELODY_VOICES[voice] ? Engine.MELODY_VOICES[voice].label : layer.kind === "melody" ? `Basic ${(s.melody && s.melody.waveform) || "sine"}` : "Bass";
    return { cells, count: cells.length, muted: part.muted === true, sound: label, rows: [] };
  }
  const volumeOf = (s, layer) => {
    if (layer.kind === "drums") {
      const rows = rowsOf(s, layer);
      return rows.length ? Engine.volumeOf(meta(s, rows[0])) : 1;
    }
    return Engine.volumeOf(partOf(s, layer));
  };
  // The layer to open with: the first one that has something in it, else the first.
  function firstLayerWithContent(s) {
    const found = LAYERS.find((l) => layerInfo(s, l).count > 0);
    return found ? found.id : LAYERS[0].id;
  }
  const usedNotes = (s, layer) => {
    const part = partOf(s, layer);
    return Object.keys(part.notes || {}).filter((n) => (part.notes[n] || []).some(hit)).map(semis);
  };

  // ---------- the stack of layer cards (3) ----------
  const stackEl = $("studio-stack");
  const cardSigs = {};
  function dots(info) {
    const cell = 6;
    const h = Math.max(1, info.cells[0] ? info.cells[0].h : 1);
    const rowH = 24 / h;
    const rects = info.cells
      .map((c) => `<rect x="${c.x * cell}" y="${(c.y * rowH).toFixed(2)}" width="${cell - 1}" height="${Math.max(2, rowH - 1).toFixed(2)}" rx="1" opacity="${(0.4 + 0.6 * c.a).toFixed(2)}"/>`)
      .join("");
    return `<svg class="studio-dots" viewBox="0 0 ${STEPS * cell} 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">${rects}</svg>`;
  }
  function cardHtml(layer, s, front) {
    const info = layerInfo(s, layer);
    const count = `${info.count} ${unitOf(layer, info.count)}`;
    const label = `Layer ${layer.n}, ${layer.name}: ${count}${info.muted ? ", muted" : ""}. ${front ? "Selected" : "Choose this layer"}`;
    return (
      `<button type="button" class="studio-card-main" data-no-history data-pick="${layer.id}" aria-pressed="${front}" aria-label="${esc(label)}"${front ? "" : ' tabindex="-1"'}>` +
      `<span class="studio-badge" aria-hidden="true">${layer.n}</span>` +
      `<span class="studio-card-name">${esc(layer.name)}</span>` +
      dots(info) +
      `<span class="studio-card-meta"><span>${count}</span><span class="studio-card-sound">${esc(info.sound)}</span></span>` +
      `</button>` +
      (front ? `<button type="button" class="studio-card-mute" data-mute-layer="${layer.id}" aria-pressed="${info.muted}" aria-label="Mute layer ${layer.n}, ${esc(layer.name)}">${info.muted ? "Muted" : "Mute"}</button>` : "")
    );
  }
  function renderStack(s) {
    if (!stackEl.children.length) {
      LAYERS.forEach((layer) => {
        const el = document.createElement("div");
        el.className = "studio-card";
        el.dataset.card = layer.id;
        el.style.setProperty("--layer-color", `var(--layer-${layer.n})`);
        stackEl.appendChild(el);
      });
    }
    const at = layerIndex();
    LAYERS.forEach((layer, i) => {
      const el = stackEl.children[i];
      const d = i - at;
      el.style.setProperty("--d", String(d));
      el.style.setProperty("--ad", String(Math.min(Math.abs(d), 3)));
      el.dataset.pos = d === 0 ? "front" : Math.abs(d) === 1 ? "near" : Math.abs(d) === 2 ? "far" : "gone";
      el.dataset.side = d < 0 ? "left" : d > 0 ? "right" : "front";
      const html = cardHtml(layer, s, d === 0);
      if (cardSigs[layer.id] !== html) {
        cardSigs[layer.id] = html;
        el.innerHTML = html;
      }
    });
  }
  // The numbers under the stack reach any layer in one tap (the cards behind the front one only show a sliver).
  const pagerEl = $("studio-pager");
  function renderPager() {
    if (!pagerEl.children.length) {
      pagerEl.innerHTML = LAYERS.map(
        (l) => `<button type="button" class="studio-dot" data-no-history data-pick="${l.id}" style="--layer-color: var(--layer-${l.n})" aria-label="Layer ${l.n}, ${esc(l.name)}">${l.n}</button>`
      ).join("");
    }
    pagerEl.querySelectorAll(".studio-dot").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pick === layerId)));
  }
  pagerEl.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-pick]");
    if (b) selectLayer(b.dataset.pick);
  });
  // Swiping: the front card follows a finger and lets go to the next or the one before; a tap (no drag) is an ordinary click on a card.
  let drag = null;
  let dragged = false;
  stackEl.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || (e.target.closest && e.target.closest(".studio-card-mute"))) return;
    drag = { x: e.clientX, id: e.pointerId, moved: false };
  });
  stackEl.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 8) {
      drag.moved = true;
      try {
        stackEl.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable */
      }
      stackEl.classList.add("studio-dragging");
    }
    if (drag.moved) stackEl.style.setProperty("--drag", `${Math.max(-120, Math.min(120, dx))}px`);
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const was = drag;
    drag = null;
    stackEl.classList.remove("studio-dragging");
    stackEl.style.removeProperty("--drag");
    if (!was.moved) return;
    dragged = true;
    setTimeout(() => (dragged = false), 50);
    if (Math.abs(dx) > 36) moveLayer(dx < 0 ? 1 : -1);
  }
  stackEl.addEventListener("pointerup", endDrag);
  stackEl.addEventListener("pointercancel", endDrag);
  // A sideways trackpad or wheel scroll moves through the stack too.
  let wheelAt = 0;
  stackEl.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 12) return;
      e.preventDefault();
      const now = Date.now();
      if (now - wheelAt < 280) return;
      wheelAt = now;
      moveLayer(e.deltaX > 0 ? 1 : -1);
    },
    { passive: false }
  );
  stackEl.addEventListener("click", (e) => {
    if (dragged) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const pick = e.target.closest && e.target.closest("[data-pick]");
    const mute = e.target.closest && e.target.closest("[data-mute-layer]");
    if (pick) selectLayer(pick.dataset.pick);
    else if (mute) toggleMute(layerOf(mute.dataset.muteLayer));
  });
  stackEl.addEventListener("keydown", (e) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1 };
    let to = null;
    if (e.key in keys) to = layerIndex() + keys[e.key];
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = LAYERS.length - 1;
    if (to === null) return;
    e.preventDefault();
    const target = LAYERS[Math.max(0, Math.min(LAYERS.length - 1, to))];
    selectLayer(target.id);
    const btn = stackEl.querySelector(`[data-pick="${target.id}"]`);
    if (btn) btn.focus();
  });
  function moveLayer(delta) {
    const to = Math.max(0, Math.min(LAYERS.length - 1, layerIndex() + delta));
    if (LAYERS[to].id !== layerId) selectLayer(LAYERS[to].id);
  }
  function toggleMute(layer) {
    if (layer.id !== layerId) selectLayer(layer.id, { quiet: true });
    const s = song();
    if (layer.kind === "drums") {
      const rows = rowsOf(s, layer);
      const allMuted = rows.length > 0 && rows.every((r) => meta(s, r).muted === true);
      rows.forEach((r) => {
        if ((meta(s, r).muted === true) === allMuted) {
          const real = $("song-sequencer").querySelector(`.song-track-mute[data-row="${r}"]`);
          if (real) real.click();
        }
      });
    } else {
      $("song-melody-mute").click();
    }
    refresh();
  }

  // ---------- choosing a layer ----------
  const live = $("studio-live");
  const say = (text) => {
    live.textContent = text;
  };
  // The real roll shows one melodic part at a time, and the studio reads and clicks it, so keep it on the layer's part.
  function syncRoll() {
    const layer = layerOf(layerId);
    if (layer.kind === "bass") $("song-roll-bass").click();
    else if (layer.kind === "melody") $("song-roll-melody").click();
  }
  // A row or roll hidden in the classic editor has no steps to click, so open it (a view setting only).
  function openHidden(layer) {
    const s = song();
    if (layer.kind === "drums") {
      rowsOf(s, layer).forEach((r) => {
        if (meta(s, r).hidden === true) {
          const real = $("song-sequencer").querySelector(`.song-track-hide[data-row="${r}"]`);
          if (real) real.click();
        }
      });
    } else if (partOf(s, layer).hidden === true) {
      $("song-melody-hide").click();
    }
  }
  function selectLayer(id, opts) {
    const layer = layerOf(id);
    const changed = layer.id !== layerId;
    layerId = layer.id;
    syncRoll();
    openHidden(layer);
    detailSig = "";
    gridSig = "";
    keysSig = "";
    refresh();
    if (!changed) return;
    say(`Layer ${layer.n}, ${layer.name}`);
    if (opts && opts.quiet) return;
    detailEl.classList.remove("studio-detail-in");
    void detailEl.offsetWidth;
    detailEl.classList.add("studio-detail-in");
  }

  // ---------- the expanded card (4) ----------
  const detailEl = $("studio-detail");
  let detailSig = "";
  const field = (label, control, extra) => `<label class="studio-field${extra ? " studio-field-" + extra : ""}"><span>${label}</span>${control}</label>`;
  function patternButtons() {
    return Array.from($("song-pattern-buttons").querySelectorAll("[data-pattern]"));
  }
  function detailHtml(layer, s, info) {
    const rows = info.rows;
    const addable = layer.kind === "drums" ? layer.add.filter((r) => !(s.tracks && s.tracks[r])) : [];
    let controls = "";
    let volume = "";
    const volumeField = (attrs, label) => `<label class="studio-vol-inline"><span>Volume</span><input type="range" class="studio-vol-input" ${attrs} min="0" max="100" aria-label="${label}"></label>`;
    if (layer.kind === "drums") {
      controls += field("Drum kit (all drums)", `<select id="studio-kit" data-src="song-kit" aria-label="Drum kit, for all drums"></select>`);
      if (rows.length === 1) {
        volume = volumeField(`data-row-vol="${rows[0]}"`, `${ROW_LABELS[rows[0]]} volume`);
      } else if (rows.length > 1) {
        controls += `<details class="studio-mix studio-field-wide"><summary>Volume and mute for each sound</summary>${rows
          .map(
            (r) =>
              `<div class="studio-mix-row"><span>${ROW_LABELS[r]}</span>` +
              `<button type="button" class="studio-mini" data-row-mute="${r}" aria-pressed="false" aria-label="Mute ${ROW_LABELS[r]}">Mute</button>` +
              `<input type="range" class="studio-vol-input" data-row-vol="${r}" min="0" max="100" aria-label="${ROW_LABELS[r]} volume"></div>`
          )
          .join("")}</details>`;
      }
      if (addable.length) {
        controls += field(
          "Add a sound",
          `<span class="studio-add"><select id="studio-add" aria-label="Drum sound to add">${addable.map((r) => `<option value="${r}">${ROW_LABELS[r]}</option>`).join("")}</select><button type="button" id="studio-add-btn" class="studio-mini">Add</button></span>`
        );
      }
    } else {
      controls += field(layer.kind === "bass" ? "Bass sound" : "Piano sound", `<select id="studio-voice" data-src="${layer.kind === "bass" ? "song-bass-voice" : "song-voice"}" aria-label="${layer.kind === "bass" ? "Bass sound" : "Piano sound"}"></select>`);
      if (layer.kind === "melody") controls += `<span id="studio-wave-field" class="studio-wave-field">${field("Wave", `<select id="studio-wave" data-src="song-waveform" aria-label="Wave for the basic sound"></select>`)}</span>`;
      volume = volumeField(`id="studio-layer-vol"`, "Layer volume");
    }
    const hint =
      layer.kind === "drums"
        ? "Tap a step to place a hit. With Rec on, press a pad while it plays."
        : "Tap to place notes; hold a note to tie it to the one before. With Rec on, play the keys while it plays.";
    return (
      `<div class="studio-detail-head">` +
      `<span class="studio-badge" aria-hidden="true">${layer.n}</span>` +
      `<div class="studio-detail-title"><h2>${esc(layer.name)}</h2><p id="studio-sub" class="studio-detail-sub"></p></div>` +
      `<span id="studio-patterns" class="studio-patterns" role="group" aria-label="Pattern being edited"></span>` +
      `<button type="button" id="studio-undo" class="studio-round studio-small" data-no-history aria-label="Undo" title="Undo (Ctrl+Z)"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 7L4 12l5 5M4 12h10a6 6 0 010 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` +
      `<button type="button" id="studio-redo" class="studio-round studio-small" data-no-history aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 7l5 5-5 5M20 12H10a6 6 0 000 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` +
      `<button type="button" id="studio-mute" class="studio-pill" aria-pressed="false">Mute</button>` +
      `</div>` +
      `<div id="studio-grid-scroll" class="studio-grid-scroll"><div id="studio-grid" class="studio-grid" data-kind="${layer.kind}" role="group" aria-label="${esc(layer.name)} steps"></div></div>` +
      `<p id="studio-hint" class="studio-hint">${hint}</p>` +
      `<div class="studio-edit">${controls}</div>` +
      `<div class="studio-foot">${volume}<button type="button" id="studio-clear" class="studio-link" title="Remove everything in this layer (undoable)">Clear layer</button></div>`
    );
  }
  function renderDetail(s) {
    const layer = layerOf(layerId);
    const info = layerInfo(s, layer);
    const addable = layer.kind === "drums" ? layer.add.filter((r) => !(s.tracks && s.tracks[r])) : [];
    const sig = [layer.id, info.rows.join(), addable.join()].join("|");
    if (sig !== detailSig) {
      detailSig = sig;
      detailEl.style.setProperty("--layer-color", `var(--layer-${layer.n})`);
      detailEl.innerHTML = detailHtml(layer, s, info);
      gridSig = "";
    }
    // Values are updated in place, so a slider being dragged is never rebuilt under the finger.
    $("studio-sub").textContent = `${info.count} ${unitOf(layer, info.count)} · ${info.sound}`;
    $("studio-hint").hidden = info.count > 0; // the how-to only shows while the layer is empty
    const mute = $("studio-mute");
    mute.setAttribute("aria-pressed", String(info.muted));
    mute.textContent = info.muted ? "Muted" : "Mute";
    mute.setAttribute("aria-label", `${info.muted ? "Unmute" : "Mute"} layer ${layer.n}, ${layer.name}`);
    $("studio-undo").disabled = $("song-undo").disabled;
    $("studio-redo").disabled = $("song-redo").disabled;
    detailEl.querySelectorAll("select[data-src]").forEach((sel) => {
      const src = $(sel.dataset.src);
      if (sel.dataset.filled !== src.innerHTML) {
        sel.innerHTML = src.innerHTML;
        sel.dataset.filled = src.innerHTML;
      }
      if (sel.value !== src.value) sel.value = src.value;
    });
    const wave = $("studio-wave-field");
    if (wave) wave.hidden = Boolean(Engine.melodyVoiceOf(s));
    const lv = $("studio-layer-vol");
    if (lv && document.activeElement !== lv) lv.value = Math.round(volumeOf(s, layer) * 100);
    detailEl.querySelectorAll("[data-row-vol]").forEach((r) => {
      if (document.activeElement !== r) r.value = Math.round(Engine.volumeOf(meta(s, r.dataset.rowVol)) * 100);
    });
    detailEl.querySelectorAll("[data-row-mute]").forEach((b) => b.setAttribute("aria-pressed", String(meta(s, b.dataset.rowMute).muted === true)));
    syncPatterns();
  }
  function syncPatterns() {
    const box = $("studio-patterns");
    if (!box) return;
    const real = patternButtons();
    const sig = real.map((b) => b.dataset.pattern + b.getAttribute("aria-pressed")).join();
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.innerHTML =
      real.length > 1
        ? real.map((b) => `<button type="button" class="studio-pat" data-no-history data-pat="${b.dataset.pattern}" aria-pressed="${b.getAttribute("aria-pressed")}" aria-label="Pattern ${b.dataset.pattern}">${b.dataset.pattern}</button>`).join("")
        : "";
  }
  detailEl.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches && t.matches("select[data-src]")) {
      const src = $(t.dataset.src);
      src.value = t.value;
      fire(src, "change");
      refresh();
    }
  });
  detailEl.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "studio-layer-vol") {
      $("song-melody-volume").value = t.value;
      fire($("song-melody-volume"), "input");
    } else if (t.dataset && t.dataset.rowVol) {
      const real = $("song-sequencer").querySelector(`.song-track-volume[data-row="${t.dataset.rowVol}"]`);
      if (real) {
        real.value = t.value;
        fire(real, "input");
      }
    }
  });
  detailEl.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("button");
    if (!t || t.classList.contains("studio-cell") || t.dataset.play) return;
    const layer = layerOf(layerId);
    if (t.id === "studio-mute") toggleMute(layer);
    else if (t.id === "studio-undo") $("song-undo").click();
    else if (t.id === "studio-redo") $("song-redo").click();
    else if (t.dataset.pat) {
      const real = $("song-pattern-buttons").querySelector(`[data-pattern="${t.dataset.pat}"]`);
      if (real) real.click();
      detailSig = "";
      gridSig = "";
      keysSig = "";
      syncRoll();
    } else if (t.dataset.rowMute) {
      const real = $("song-sequencer").querySelector(`.song-track-mute[data-row="${t.dataset.rowMute}"]`);
      if (real) real.click();
    } else if (t.id === "studio-add-btn") {
      $("song-add-drum").value = $("studio-add").value;
      $("song-add-drum-btn").click();
    } else if (t.id === "studio-clear") {
      if (layer.kind === "drums") {
        const target = $("song-pattern-target");
        const keep = target.value;
        rowsOf(song(), layer).forEach((r) => {
          target.value = r;
          $("song-pattern-clear").click();
        });
        target.value = keep;
      } else {
        $("song-melody-clear").click();
      }
    } else {
      return;
    }
    refresh();
  });

  // ---------- the steps inside the expanded card ----------
  // The cells here only mirror the song. A tap clicks the matching step of the classic editor, which does the real work (step strength,
  // undo, autosave, the preview), and then the mirror is painted again from the song.
  let gridSig = "";
  let gridCells = [];
  let colCells = [];
  let cellAt = {};
  let lastCol = -1;
  const melodicRows = (layer) => {
    const [lo, hi] = RANGE[layer.kind];
    const rows = [];
    for (let n = hi; n >= lo; n--) rows.push(noteName(n));
    return rows;
  };
  function buildGrid(layer, s) {
    const rows = layer.kind === "drums" ? rowsOf(s, layer) : melodicRows(layer);
    const sig = layer.id + "|" + rows.join();
    if (sig === gridSig) return;
    gridSig = sig;
    const grid = $("studio-grid");
    grid.innerHTML = rows
      .map((row) => {
        const label = layer.kind === "drums" ? ROW_SHORT[row] : row;
        const full = layer.kind === "drums" ? ROW_LABELS[row] : row;
        let groups = "";
        for (let g = 0; g < 4; g++) {
          let cells = "";
          for (let i = g * 4; i < g * 4 + 4; i++) {
            cells += `<button type="button" class="studio-cell" data-row="${row}" data-step="${i}" aria-pressed="false" aria-label="${full} step ${i + 1}" tabindex="-1"></button>`;
          }
          groups += `<span class="studio-beat${g % 2 ? " studio-beat-alt" : ""}">${cells}</span>`;
        }
        const tag = layer.kind === "drums" ? `<span class="studio-row-label">${label}</span>` : `<button type="button" class="studio-row-label studio-row-key" data-play="${row}" tabindex="-1" aria-label="Play ${row}">${label}</button>`;
        return `<div class="studio-row${row.includes("#") ? " studio-row-black" : ""}" data-row="${row}">${tag}${groups}</div>`;
      })
      .join("");
    gridCells = Array.from(grid.querySelectorAll(".studio-cell"));
    colCells = Array.from({ length: STEPS }, () => []);
    cellAt = {};
    gridCells.forEach((c) => {
      colCells[Number(c.dataset.step)].push(c);
      cellAt[c.dataset.row + ":" + c.dataset.step] = c;
    });
    if (gridCells[0]) gridCells[0].tabIndex = 0;
    lastCol = -1;
    centerGrid(false);
  }
  function paintGrid(s, layer) {
    const part = layer.kind === "drums" ? null : partOf(s, layer);
    gridCells.forEach((cell) => {
      const row = cell.dataset.row;
      const i = Number(cell.dataset.step);
      const v = layer.kind === "drums" ? (s.tracks[row] || [])[i] : ((part.notes || {})[row] || [])[i];
      const on = hit(v);
      const lv = on ? Engine.stepLevel(v) : 0;
      const tied = on && layer.kind !== "drums" && Boolean(part.ties && part.ties[row] && part.ties[row][i] === true);
      if (cell._on !== on) {
        cell._on = on;
        cell.classList.toggle("on", on);
        cell.setAttribute("aria-pressed", String(on));
      }
      if (cell._lv !== lv) {
        cell._lv = lv;
        if (on && lv < 1) cell.style.setProperty("--lv", String(lv));
        else cell.style.removeProperty("--lv");
      }
      if (cell._tied !== tied) {
        cell._tied = tied;
        cell.classList.toggle("tied", tied);
      }
    });
  }
  // Scroll the notes to where the music is (or the middle of the range for an empty layer).
  function centerGrid(smooth) {
    const layer = layerOf(layerId);
    const scroll = $("studio-grid-scroll");
    if (!scroll || layer.kind === "drums") return;
    const used = usedNotes(song(), layer);
    const [lo, hi] = RANGE[layer.kind];
    const mid = used.length ? Math.round((Math.min(...used) + Math.max(...used)) / 2) : Math.round((lo + hi) / 2);
    const row = $("studio-grid").querySelector(`.studio-row[data-row="${noteName(Math.max(lo, Math.min(hi, mid)))}"]`);
    if (!row) return;
    const top = row.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    scroll.scrollTo({ top: Math.max(0, top - scroll.clientHeight / 2 + row.offsetHeight / 2), behavior: smooth ? "smooth" : "auto" });
  }
  function realStep(cell) {
    const layer = layerOf(layerId);
    const root = layer.kind === "drums" ? $("song-sequencer") : $("song-piano-roll");
    return root.querySelector(`.song-step[data-row="${cell.dataset.row}"][data-step="${cell.dataset.step}"]`);
  }
  function tapCell(cell, shift) {
    const real = realStep(cell);
    if (!real) return;
    real.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: Boolean(shift) }));
    refresh();
    if (!shift) say(`${cell.getAttribute("aria-label")}: ${cell.classList.contains("on") ? "on" : "off"}`);
  }
  // A long press on a note ties it to the one before (the classic editor's Shift+click).
  let hold = null;
  detailEl.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest && e.target.closest(".studio-cell");
    if (!cell || layerOf(layerId).kind === "drums") return;
    hold = {
      cell,
      fired: false,
      timer: setTimeout(() => {
        hold.fired = true;
        tapCell(cell, true);
      }, 520),
    };
  });
  const endHold = () => {
    if (hold) clearTimeout(hold.timer);
  };
  detailEl.addEventListener("pointerup", endHold);
  detailEl.addEventListener("pointercancel", endHold);
  detailEl.addEventListener("pointerleave", endHold);
  detailEl.addEventListener("click", (e) => {
    const cell = e.target.closest && e.target.closest(".studio-cell");
    const key = e.target.closest && e.target.closest("[data-play]");
    if (cell) {
      if (hold && hold.fired) {
        hold = null;
        return;
      }
      tapCell(cell, e.shiftKey);
    } else if (key) {
      pressNote(key.dataset.play);
    }
  });
  // Arrow keys move between the cells; Enter and Space press the focused one (they are buttons).
  detailEl.addEventListener("keydown", (e) => {
    const cell = e.target.closest && e.target.closest(".studio-cell");
    if (!cell) return;
    const rows = Array.from($("studio-grid").querySelectorAll(".studio-row")).map((r) => r.dataset.row);
    let r = rows.indexOf(cell.dataset.row);
    let c = Number(cell.dataset.step);
    if (e.key === "ArrowRight") c = Math.min(STEPS - 1, c + 1);
    else if (e.key === "ArrowLeft") c = Math.max(0, c - 1);
    else if (e.key === "ArrowDown") r = Math.min(rows.length - 1, r + 1);
    else if (e.key === "ArrowUp") r = Math.max(0, r - 1);
    else if (e.key === "Home") c = 0;
    else if (e.key === "End") c = STEPS - 1;
    else return;
    e.preventDefault();
    const next = cellAt[rows[r] + ":" + c];
    if (!next) return;
    gridCells.forEach((x) => (x.tabIndex = -1));
    next.tabIndex = 0;
    next.focus();
    if (next.scrollIntoView) next.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  // ---------- the keys (1): a scrollable piano, or pads on a drum layer ----------
  const keysEl = $("studio-keys");
  const keysScroll = $("studio-keys-scroll");
  let keysSig = "";
  function renderKeys(s) {
    const layer = layerOf(layerId);
    const rows = layer.kind === "drums" ? rowsOf(s, layer) : null;
    const sig = layer.id + "|" + (rows ? rows.join() : "");
    if (sig === keysSig) return;
    keysSig = sig;
    lit.clear();
    keysEl.style.setProperty("--layer-color", `var(--layer-${layer.n})`);
    if (layer.kind === "drums") {
      keysEl.className = "studio-keys studio-pads";
      keysEl.style.removeProperty("--whites");
      keysEl.setAttribute("aria-label", `${layer.name} pads`);
      keysEl.innerHTML = rows.map((r) => `<button type="button" class="studio-pad" data-pad="${r}" aria-label="Play ${ROW_LABELS[r]}">${ROW_LABELS[r]}</button>`).join("");
      return;
    }
    keysEl.className = "studio-keys";
    keysEl.setAttribute("aria-label", `Piano keys for ${layer.name}`);
    const [lo, hi] = RANGE[layer.kind];
    const all = [];
    for (let n = lo; n <= hi; n++) all.push(noteName(n));
    const whiteCount = all.filter((n) => !n.includes("#")).length;
    const step = 100 / whiteCount;
    let whites = -1;
    keysEl.style.setProperty("--whites", String(whiteCount));
    keysEl.innerHTML = all
      .map((n) => {
        if (!n.includes("#")) {
          whites++;
          return `<button type="button" class="studio-key studio-key-white" data-key="${n}" aria-label="Play ${n}" style="left:${(whites * step).toFixed(3)}%;width:${step.toFixed(3)}%"><span aria-hidden="true">${/^C\d$/.test(n) ? n : ""}</span></button>`;
        }
        return `<button type="button" class="studio-key studio-key-black" data-key="${n}" aria-label="Play ${n.replace("#", " sharp")}" style="left:${((whites + 1) * step - step * 0.32).toFixed(3)}%;width:${(step * 0.64).toFixed(3)}%"></button>`;
      })
      .join("");
    centerKeys(false);
  }
  function centerKeys(smooth) {
    const layer = layerOf(layerId);
    if (layer.kind === "drums") return;
    const used = usedNotes(song(), layer);
    const [lo, hi] = RANGE[layer.kind];
    const mid = used.length ? Math.round((Math.min(...used) + Math.max(...used)) / 2) : Math.round((lo + hi) / 2);
    const nearest = keysEl.querySelector(`[data-key="${noteName(Math.max(lo, Math.min(hi, mid)))}"]`);
    if (!nearest) return;
    const x = nearest.getBoundingClientRect().left - keysEl.getBoundingClientRect().left + nearest.offsetWidth / 2;
    keysScroll.scrollTo({ left: Math.max(0, x - keysScroll.clientWidth / 2), behavior: smooth ? "smooth" : "auto" });
  }
  function flash(el) {
    if (!el) return;
    el.classList.add("down");
    setTimeout(() => el.classList.remove("down"), 170);
  }
  function pressNote(name) {
    const h = host();
    if (!h) return;
    h.note(name);
    flash(keysEl.querySelector(`[data-key="${name}"]`));
    refresh();
  }
  // A mouse or pen plays on press (so it feels like an instrument); the click that follows is skipped. A finger plays on the click, which
  // never happens when it was a swipe along the keyboard. Keyboard Enter and Space arrive as clicks too.
  let mouseDone = false;
  keysEl.addEventListener("pointerdown", (e) => {
    const k = e.target.closest && e.target.closest("[data-key], [data-pad]");
    if (!k || e.pointerType === "touch" || e.button > 0) return;
    e.preventDefault();
    mouseDone = true;
    k.click();
  });
  keysEl.addEventListener("pointerup", () => setTimeout(() => (mouseDone = false), 0));
  keysEl.addEventListener("pointercancel", () => setTimeout(() => (mouseDone = false), 0));
  keysEl.addEventListener("click", (e) => {
    const k = e.target.closest && e.target.closest("[data-key], [data-pad]");
    if (!k) return;
    if (e.isTrusted && mouseDone) return;
    if (k.dataset.pad) {
      host().hit(k.dataset.pad);
      flash(k);
      refresh();
    } else {
      pressNote(k.dataset.key);
    }
  });

  // ---------- playing: the playhead, the keys and the cards light up with the music ----------
  let pending = [];
  const lit = new Set();
  function setLit(names) {
    lit.forEach((n) => {
      if (!names.has(n)) {
        const el = keysEl.querySelector(`[data-key="${n}"], [data-pad="${n}"]`);
        if (el) el.classList.remove("lit");
        lit.delete(n);
      }
    });
    names.forEach((n) => {
      if (lit.has(n)) return;
      lit.add(n);
      const el = keysEl.querySelector(`[data-key="${n}"], [data-pad="${n}"]`);
      if (el) el.classList.add("lit");
    });
  }
  function layerHits(layer, data, step) {
    if (layer.kind === "drums") return layer.rows.some((r) => data.tracks && hit((data.tracks[r] || [])[step]) && !(data.trackMeta && data.trackMeta[r] && data.trackMeta[r].muted === true));
    const part = layer.kind === "bass" ? data.bass : data.melody;
    return Boolean(part && part.notes && part.muted !== true && Object.keys(part.notes).some((n) => hit((part.notes[n] || [])[step])));
  }
  // A note roll wider than the screen follows the playhead sideways (a drum grid always fits, so it never moves).
  function followPlayhead(cell) {
    const scroll = $("studio-grid-scroll");
    if (!cell || !scroll || layerOf(layerId).kind === "drums" || scroll.scrollWidth <= scroll.clientWidth + 2) return;
    const c = cell.getBoundingClientRect();
    const s = scroll.getBoundingClientRect();
    if (c.left >= s.left + 44 && c.right <= s.right - 8) return;
    scroll.scrollTo({ left: Math.max(0, scroll.scrollLeft + (c.left - s.left) - 56), behavior: "smooth" });
  }
  function paintStep(step, info) {
    const s = song();
    if (!s) return;
    const data = info ? info.data : s;
    const layer = layerOf(layerId);
    const here = !info || info.pattern === Engine.editingName(s);
    if (lastCol !== -1 && colCells[lastCol]) colCells[lastCol].forEach((c) => c.classList.remove("now"));
    lastCol = -1;
    if (here && colCells[step]) {
      colCells[step].forEach((c) => c.classList.add("now"));
      lastCol = step;
      followPlayhead(colCells[step][0]);
    }
    const names = new Set();
    if (layer.kind === "drums") {
      layer.rows.forEach((r) => {
        if (data.tracks && hit((data.tracks[r] || [])[step]) && !(data.trackMeta && data.trackMeta[r] && data.trackMeta[r].muted === true)) names.add(r);
      });
    } else {
      const part = layer.kind === "bass" ? data.bass : data.melody;
      if (part && part.notes && part.muted !== true) Object.keys(part.notes).forEach((n) => hit((part.notes[n] || [])[step]) && names.add(n));
    }
    setLit(names);
    LAYERS.forEach((l, i) => {
      if (!layerHits(l, data, step)) return;
      const el = stackEl.children[i];
      if (!el) return;
      el.classList.remove("hit");
      void el.offsetWidth;
      el.classList.add("hit");
    });
  }
  function clearPlay() {
    pending.forEach(clearTimeout);
    pending = [];
    if (lastCol !== -1 && colCells[lastCol]) colCells[lastCol].forEach((c) => c.classList.remove("now"));
    lastCol = -1;
    setLit(new Set());
  }

  // ---------- the controls (2) ----------
  const playBtn = $("studio-play");
  function togglePlay() {
    const h = host();
    if (h.playing()) h.pause();
    else $("song-play").click(); // plays (or carries on after a pause, with the count-in if one is set)
    syncTransport();
  }
  playBtn.addEventListener("click", togglePlay);
  $("studio-stop").addEventListener("click", () => {
    host().stop();
    syncTransport();
  });
  $("studio-rec").addEventListener("click", () => {
    const box = $("song-record");
    box.checked = !box.checked;
    fire(box, "change");
    syncTransport();
  });
  $("studio-metro").addEventListener("click", () => {
    $("song-metronome-on").click();
    syncTransport();
  });
  $("studio-volume").addEventListener("input", (e) => {
    $("song-master-volume").value = e.target.value;
    fire($("song-master-volume"), "input");
  });
  $("studio-bpm").addEventListener("input", (e) => {
    $("song-tempo").value = e.target.value;
    fire($("song-tempo"), "input");
  });
  $("studio-bpm").addEventListener("change", (e) => {
    $("song-tempo").value = e.target.value;
    fire($("song-tempo"), "change");
  });
  function syncTransport() {
    const h = host();
    const playing = h.playing();
    const paused = h.paused();
    $("studio-play").setAttribute("aria-label", playing ? "Pause" : paused ? "Carry on" : "Play");
    // toggleAttribute, not .hidden: an SVG element has no hidden property, so assigning one would change nothing on screen.
    playBtn.querySelector(".studio-ico-play").toggleAttribute("hidden", playing);
    playBtn.querySelector(".studio-ico-pause").toggleAttribute("hidden", !playing);
    playBtn.classList.toggle("studio-playing", playing);
    $("studio-stop").disabled = !playing && !paused;
    $("studio-rec").setAttribute("aria-pressed", String($("song-record").checked));
    $("studio-metro").setAttribute("aria-pressed", String($("song-metronome-on").checked));
    if (document.activeElement !== $("studio-volume")) $("studio-volume").value = $("song-master-volume").value;
    if (document.activeElement !== $("studio-bpm")) $("studio-bpm").value = $("song-tempo").value;
  }

  // ---------- the bar at the top ----------
  const nameEl = $("studio-name");
  nameEl.addEventListener("input", () => {
    $("song-name").value = nameEl.value;
    fire($("song-name"), "input");
  });
  $("studio-save").addEventListener("click", () => $("save-song").click());
  $("studio-help").addEventListener("click", () => {
    const real = modal.querySelector(".editor-help-btn");
    if (real) real.click();
  });
  $("studio-close").addEventListener("click", () => $("close-song-builder").click());
  $("studio-full").addEventListener("click", () => setView("classic", true));
  $("song-view-toggle").addEventListener("click", () => setView("studio", true));
  function syncTop() {
    if (document.activeElement !== nameEl) nameEl.value = $("song-name").value;
    const text = $("song-autosave-status").textContent.trim();
    const status = $("studio-status");
    if (status.textContent !== text) status.textContent = text;
    $("studio-save").dataset.state = /unsaved/i.test(text) ? "dirty" : /saved/i.test(text) ? "saved" : "";
    // The row of open-song tabs only matters when there are several.
    modal.classList.toggle("studio-multi-tabs", $("song-tabs").querySelectorAll(".song-tab").length > 1);
  }

  // ---------- keeping the layout in step with the editor ----------
  function refresh(opts) {
    if (view !== "studio" || modal.hidden) return;
    const h = host();
    const s = song();
    if (!h || !s) return;
    if (opts && opts.opened) {
      layerId = firstLayerWithContent(s);
      clearPlay();
    }
    if (opts && (opts.opened || opts.rebuild)) {
      detailSig = gridSig = keysSig = "";
      Object.keys(cardSigs).forEach((k) => delete cardSigs[k]);
      syncRoll();
      openHidden(layerOf(layerId));
    }
    const layer = layerOf(layerId);
    renderStack(s);
    renderPager();
    renderDetail(s);
    buildGrid(layer, s);
    paintGrid(s, layer);
    renderKeys(s);
    syncTransport();
    syncTop();
  }
  let queued = 0;
  const later = () => {
    clearTimeout(queued);
    queued = setTimeout(refresh, 30);
  };
  ["click", "input", "change", "keyup"].forEach((t) => modal.addEventListener(t, later));
  setInterval(() => {
    if (view === "studio" && !modal.hidden) refresh();
  }, 700);

  function setView(next, save) {
    view = next;
    if (save) {
      try {
        localStorage.setItem("songView", next);
      } catch {
        /* not saved */
      }
    }
    const on = view === "studio";
    modal.classList.toggle("song-studio-on", on);
    studio.hidden = !on;
    if (on) {
      refresh({ rebuild: true });
    } else {
      clearPlay();
      if (host()) host().forget();
      modal.classList.remove("studio-multi-tabs");
      // The classic rulers measure the grids, which had no size while the studio was showing.
      window.dispatchEvent(new Event("resize"));
    }
  }

  window.SongStudio = {
    refresh(opts) {
      refresh(opts);
    },
    // Called by the editor a little before a step sounds (time is on the audio clock); the lights follow the sound, not the scheduling.
    step(step, time, info) {
      if (view !== "studio" || modal.hidden) return;
      const wait = typeof time === "number" && host() ? Math.max(0, (time - host().now()) * 1000) : 0;
      if (wait < 16) {
        paintStep(step, info);
        return;
      }
      const id = setTimeout(() => {
        pending = pending.filter((t) => t !== id);
        paintStep(step, info);
      }, wait);
      pending.push(id);
    },
    stopped() {
      if (view !== "studio") return;
      clearPlay();
      if (host()) syncTransport();
    },
    // A note played from the computer keyboard or a MIDI device: show it on the keys.
    played(requested) {
      if (view !== "studio") return;
      const layer = layerOf(layerId);
      if (layer.kind === "drums") return;
      let n = semis(requested);
      if (layer.kind === "bass") {
        while (n < 12) n += 12;
        while (n > 35) n -= 12;
      }
      flash(keysEl.querySelector(`[data-key="${noteName(n)}"]`));
      later();
    },
    active: () => view === "studio" && !modal.hidden,
    toggle: togglePlay,
    drumLayerOpen: () => view === "studio" && layerOf(layerId).kind === "drums",
    setView,
    view: () => view,
    select: selectLayer,
    layers: LAYERS,
  };
  setView(view, false);
})();
