// The Song builder's Studio layout: five fixed layers as preview cards, one expanded card for the layer being edited, a scrollable roll and
// a keyboard with simple transport controls. It is a view over the classic editor, not a second editor: the roll and the drum grid are the
// builder's own elements moved in here, and every control drives the builder's own control (so undo, autosave, recording and the saved song
// are exactly the same). The layers are not stored; they are a fixed grouping of the song's drum rows, bass line and melody.
(function () {
  const $ = (id) => document.getElementById(id);
  const modal = $("song-builder-modal");
  const studio = $("song-studio");
  if (!modal || !studio) return;
  const Engine = window.SongEngine;

  // The order is fixed on purpose: layer 1 to 5 always mean the same thing.
  const LAYERS = [
    { id: "kick", n: 1, name: "Kick", kind: "drums", rows: ["kick"], addable: [] },
    { id: "snare", n: 2, name: "Snare & clap", kind: "drums", rows: ["snare", "clap", "rim"], addable: ["rim"] },
    { id: "hats", n: 3, name: "Hats & perc", kind: "drums", rows: ["hihat", "openhat", "tom", "crash"], addable: ["openhat", "tom", "crash"] },
    { id: "bass", n: 4, name: "Bass", kind: "bass" },
    { id: "melody", n: 5, name: "Melody", kind: "melody" },
  ];
  const ROW_LABELS = { kick: "Kick", snare: "Snare", hihat: "Hi-hat", openhat: "Open hat", clap: "Clap", rim: "Rim", tom: "Tom", crash: "Crash" };
  const RANGE = { melody: [36, 59], bass: [12, 35] };
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const ADOPTED = ["song-sequencer-ruler", "song-sequencer", "song-piano-roll-ruler", "song-piano-roll"];

  let view = "studio";
  try {
    if (localStorage.getItem("songView") === "classic") view = "classic";
  } catch {
    /* no storage: studio */
  }
  let layerId = "melody";
  let adopted = false;
  const homes = {};
  const layerOf = (id) => LAYERS.find((l) => l.id === id) || LAYERS[4];
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const song = () => (window.SongStudioHost && window.SongStudioHost.song()) || null;
  const semis = (name) => {
    const m = /^([A-G]#?)(-?\d)$/.exec(name);
    return m ? NAMES.indexOf(m[1]) + 12 * Number(m[2]) : 0;
  };

  // ---------- reading the song ----------
  const meta = (s, row) => (s.trackMeta && s.trackMeta[row]) || {};
  const rowsOf = (s, layer) => layer.rows.filter((r) => s.tracks && s.tracks[r]);
  const partOf = (s, layer) => (layer.kind === "bass" ? s.bass : s.melody) || { notes: {} };
  const hit = (v) => v !== false && v != null && v !== 0;
  function layerInfo(s, layer) {
    if (layer.kind === "drums") {
      const rows = rowsOf(s, layer);
      const cells = [];
      rows.forEach((row, ri) => (s.tracks[row] || []).forEach((v, i) => hit(v) && cells.push({ x: i, y: ri, h: rows.length, a: typeof v === "number" ? v : 1 })));
      const muted = rows.length > 0 && rows.every((r) => meta(s, r).muted === true);
      return { cells, count: cells.length, muted, sound: (s.kit || "acoustic") + " kit", rows };
    }
    const part = partOf(s, layer);
    const [lo, hi] = RANGE[layer.kind];
    const cells = [];
    Object.keys(part.notes || {}).forEach((name) => {
      const y = hi - semis(name);
      (part.notes[name] || []).forEach((v, i) => hit(v) && y >= 0 && y <= hi - lo && cells.push({ x: i, y, h: hi - lo + 1, a: typeof v === "number" ? v : 1 }));
    });
    const voice = layer.kind === "bass" ? Engine.bassVoiceOf(s) : Engine.melodyVoiceOf(s);
    return { cells, count: cells.length, muted: part.muted === true, sound: voice || (layer.kind === "melody" ? s.melody && s.melody.waveform : "") || "basic", rows: [] };
  }
  const volumeOf = (s, layer) => {
    if (layer.kind === "drums") {
      const rows = rowsOf(s, layer);
      return rows.length ? Engine.volumeOf(meta(s, rows[0])) : 1;
    }
    return Engine.volumeOf(partOf(s, layer));
  };

  // ---------- the five preview cards ----------
  function dots(info) {
    const w = 16;
    const h = Math.max(1, info.cells[0] ? info.cells[0].h : 1);
    const cell = 6;
    const rowH = 24 / h;
    const rects = info.cells.map((c) => `<rect x="${c.x * cell}" y="${(c.y * rowH).toFixed(2)}" width="${cell - 1}" height="${Math.max(2, rowH - 1).toFixed(2)}" rx="1" opacity="${(0.45 + 0.55 * Math.min(1, c.a)).toFixed(2)}"/>`).join("");
    return `<svg class="studio-dots" viewBox="0 0 ${w * cell} 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">${rects}</svg>`;
  }
  function cardHtml(layer, s) {
    const info = layerInfo(s, layer);
    const vol = Math.round(volumeOf(s, layer) * 100);
    const active = layer.id === layerId;
    const summary = `${info.count} ${layer.kind === "drums" ? "hit" : "note"}${info.count === 1 ? "" : "s"}`;
    return (
      `<button type="button" class="studio-card-main" data-layer="${layer.id}" aria-pressed="${active}" aria-label="Layer ${layer.n}, ${esc(layer.name)}: ${summary}${info.muted ? ", muted" : ""}. ${active ? "Selected" : "Select to edit"}">` +
      `<span class="studio-card-n" aria-hidden="true">${layer.n}</span>` +
      `<span class="studio-card-name">${esc(layer.name)}</span>` +
      dots(info) +
      `<span class="studio-card-meta"><span>${summary}</span><span class="studio-card-sound">${esc(info.sound)}</span></span>` +
      `<span class="studio-card-vol" aria-hidden="true"><span style="width:${vol}%"></span></span>` +
      `</button>` +
      `<button type="button" class="studio-card-mute" data-mute="${layer.id}" aria-pressed="${info.muted}" aria-label="Mute layer ${layer.n}, ${esc(layer.name)}" title="Mute layer ${layer.n}">${info.muted ? "Muted" : "Mute"}</button>`
    );
  }
  const cardSigs = {};
  function renderCards(s) {
    const box = $("studio-cards");
    LAYERS.forEach((layer) => {
      let el = box.querySelector(`.studio-card[data-card="${layer.id}"]`);
      if (!el) {
        el = document.createElement("div");
        el.className = "studio-card";
        el.dataset.card = layer.id;
        box.appendChild(el);
      }
      const html = cardHtml(layer, s);
      if (cardSigs[layer.id] === html) return;
      cardSigs[layer.id] = html;
      el.innerHTML = html;
      el.classList.toggle("studio-card-active", layer.id === layerId);
    });
  }

  // ---------- selecting a layer ----------
  const rollTitle = $("song-roll-title");
  function selectLayer(id, opts) {
    const layer = layerOf(id);
    const changed = layer.id !== layerId;
    layerId = layer.id;
    if (layer.kind === "bass") $("song-roll-bass").click();
    else if (layer.kind === "melody") $("song-roll-melody").click();
    detailSig = "";
    applyLayerView();
    refresh();
    if (changed && !(opts && opts.quiet)) {
      const panel = $("studio-detail");
      panel.classList.remove("studio-detail-in");
      void panel.offsetWidth;
      panel.classList.add("studio-detail-in");
    }
  }
  function applyLayerView() {
    const layer = layerOf(layerId);
    const drums = layer.kind === "drums";
    studio.dataset.activeLayer = layer.id;
    $("song-sequencer-ruler").hidden = !drums;
    $("song-sequencer").hidden = !drums;
    $("song-piano-roll-ruler").hidden = drums;
    $("song-piano-roll").hidden = drums;
    if (drums) filterRows();
  }
  // The drum grid shows only the rows of the open layer.
  function filterRows() {
    const layer = layerOf(layerId);
    if (layer.kind !== "drums") return;
    $("song-sequencer").querySelectorAll(".song-track-row").forEach((row) => {
      const tagged = row.querySelector("[data-row]");
      const name = tagged ? tagged.dataset.row : "";
      row.hidden = !layer.rows.includes(name);
    });
  }

  // ---------- the expanded card ----------
  let detailSig = "";
  const cloneOptions = (from, to, value) => {
    to.innerHTML = from.innerHTML;
    to.value = value;
  };
  function selectField(label, id, source) {
    return `<label class="studio-field"><span>${label}</span><select id="${id}" data-src="${source}"></select></label>`;
  }
  function renderDetail(s) {
    const layer = layerOf(layerId);
    const info = layerInfo(s, layer);
    const box = $("studio-detail");
    const real = layer.kind === "drums" ? { rows: info.rows } : {};
    const addable = layer.kind === "drums" ? layer.addable.filter((r) => !(s.tracks && s.tracks[r])) : [];
    const sig = [layer.id, real.rows ? real.rows.join() : "", addable.join(), layer.kind === "melody" ? Engine.melodyVoiceOf(s) || "" : ""].join("|");
    if (sig !== detailSig) {
      detailSig = sig;
      let body = "";
      if (layer.kind === "drums") {
        body += selectField("Drum kit (all drums)", "studio-kit", "song-kit");
        body += `<div class="studio-rows">${info.rows
          .map(
            (r) =>
              `<div class="studio-row" data-row="${r}"><span class="studio-row-name">${ROW_LABELS[r] || r}</span>` +
              `<button type="button" class="studio-row-mute" data-row-mute="${r}" aria-pressed="false" aria-label="Mute ${ROW_LABELS[r] || r}">Mute</button>` +
              `<input type="range" class="studio-row-vol" data-row-vol="${r}" min="0" max="100" aria-label="${ROW_LABELS[r] || r} volume"></div>`
          )
          .join("")}</div>`;
        if (addable.length) {
          body += `<label class="studio-field"><span>Add a sound</span><span class="studio-add"><select id="studio-add" aria-label="Drum sound to add">${addable
            .map((r) => `<option value="${r}">${ROW_LABELS[r]}</option>`)
            .join("")}</select><button type="button" id="studio-add-btn">Add</button></span></label>`;
        }
      } else {
        body += selectField(layer.kind === "bass" ? "Bass sound" : "Piano sound", "studio-voice", layer.kind === "bass" ? "song-bass-voice" : "song-voice");
        if (layer.kind === "melody") body += `<span id="studio-wave-wrap">${selectField("Wave (for the basic sound)", "studio-wave", "song-waveform")}</span>`;
        body += `<label class="studio-field"><span>Volume</span><input type="range" id="studio-layer-vol" min="0" max="100" aria-label="Layer volume"></label>`;
      }
      box.innerHTML =
        `<div class="studio-detail-head"><h2><span class="studio-detail-n" aria-hidden="true">${layer.n}</span> Layer ${layer.n}: ${esc(layer.name)}</h2>` +
        `<span id="studio-detail-count" class="studio-detail-count"></span>` +
        `<button type="button" id="studio-detail-clear" class="studio-detail-clear" title="Remove every ${layer.kind === "drums" ? "hit" : "note"} of this layer (undoable)">Clear layer</button></div>` +
        `<div class="studio-detail-body">${body}</div>`;
    }
    // In-place values, so a slider being dragged is never rebuilt under the pointer.
    $("studio-detail-count").textContent = `${info.count} ${layer.kind === "drums" ? "hit" : "note"}${info.count === 1 ? "" : "s"}${info.muted ? " · muted" : ""}`;
    box.querySelectorAll("select[data-src]").forEach((sel) => {
      const src = $(sel.dataset.src);
      if (sel.dataset.filled !== src.innerHTML || sel.value !== src.value) {
        if (sel.dataset.filled !== src.innerHTML) sel.innerHTML = src.innerHTML;
        sel.dataset.filled = src.innerHTML;
        sel.value = src.value;
      }
    });
    const wave = $("studio-wave-wrap");
    if (wave) wave.hidden = Boolean(Engine.melodyVoiceOf(s));
    const lv = $("studio-layer-vol");
    if (lv && document.activeElement !== lv) lv.value = Math.round(volumeOf(s, layer) * 100);
    box.querySelectorAll("[data-row-vol]").forEach((r) => {
      if (document.activeElement !== r) r.value = Math.round(Engine.volumeOf(meta(s, r.dataset.rowVol)) * 100);
    });
    box.querySelectorAll("[data-row-mute]").forEach((b) => b.setAttribute("aria-pressed", String(meta(s, b.dataset.rowMute).muted === true)));
  }
  $("studio-detail").addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches && t.matches("select[data-src]")) {
      const src = $(t.dataset.src);
      src.value = t.value;
      fire(src, "change");
      refresh();
    }
  });
  $("studio-detail").addEventListener("input", (e) => {
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
  $("studio-detail").addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("button");
    if (!t) return;
    const layer = layerOf(layerId);
    if (t.dataset.rowMute) {
      const real = $("song-sequencer").querySelector(`.song-track-mute[data-row="${t.dataset.rowMute}"]`);
      if (real) real.click();
    } else if (t.id === "studio-add-btn") {
      const pick = $("studio-add").value;
      $("song-add-drum").value = pick;
      $("song-add-drum-btn").click();
    } else if (t.id === "studio-detail-clear") {
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
    }
    refresh();
  });

  // ---------- cards: select and mute ----------
  $("studio-cards").addEventListener("click", (e) => {
    const main = e.target.closest && e.target.closest("[data-layer]");
    const mute = e.target.closest && e.target.closest("[data-mute]");
    if (main) selectLayer(main.dataset.layer);
    else if (mute) {
      const layer = layerOf(mute.dataset.mute);
      if (layer.id !== layerId) selectLayer(layer.id, { quiet: true });
      if (layer.kind === "drums") {
        const s = song();
        const rows = rowsOf(s, layer);
        const allMuted = rows.every((r) => meta(s, r).muted === true);
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
  });
  // Left and right arrows move between the five cards.
  $("studio-cards").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const at = LAYERS.findIndex((l) => l.id === layerId);
    const next = LAYERS[(at + (e.key === "ArrowRight" ? 1 : LAYERS.length - 1)) % LAYERS.length];
    e.preventDefault();
    selectLayer(next.id);
    const btn = $("studio-cards").querySelector(`[data-layer="${next.id}"]`);
    if (btn) btn.focus();
    if (btn && btn.scrollIntoView) btn.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  });

  // ---------- keys ----------
  let keysSig = "";
  function renderKeys() {
    const layer = layerOf(layerId);
    const box = $("studio-keys");
    const source = layer.kind === "drums" ? $("song-sequencer") : $("song-piano-roll");
    const labels = Array.from(source.querySelectorAll(".song-track-label-playable"))
      .map((b) => b.dataset.row)
      .filter((name) => layer.kind !== "drums" || layer.rows.includes(name));
    const sig = layer.kind + "|" + labels.join();
    if (sig === keysSig) return;
    keysSig = sig;
    if (layer.kind === "drums") {
      box.className = "studio-keys studio-pads";
      const rows = rowsOf(song(), layer);
      box.innerHTML = rows.map((r) => `<button type="button" class="studio-pad" data-key="${r}" aria-label="Play ${ROW_LABELS[r] || r}">${ROW_LABELS[r] || r}</button>`).join("");
      return;
    }
    box.className = "studio-keys";
    const asc = labels.slice().reverse();
    const white = asc.filter((n) => !n.includes("#"));
    const step = 100 / Math.max(1, white.length);
    let whites = -1;
    box.innerHTML = asc
      .map((n) => {
        if (!n.includes("#")) {
          whites++;
          return `<button type="button" class="studio-key studio-key-white" data-key="${n}" aria-label="Play ${n}" style="left:${(whites * step).toFixed(3)}%;width:${step.toFixed(3)}%"><span>${/^C\d$/.test(n) ? n : ""}</span></button>`;
        }
        return `<button type="button" class="studio-key studio-key-black" data-key="${n}" aria-label="Play ${n.replace("#", " sharp")}" style="left:${((whites + 1) * step - step * 0.3).toFixed(3)}%;width:${(step * 0.6).toFixed(3)}%"></button>`;
      })
      .join("");
  }
  function pressKey(btn) {
    const name = btn.dataset.key;
    const layer = layerOf(layerId);
    const source = layer.kind === "drums" ? $("song-sequencer") : $("song-piano-roll");
    const label = source.querySelector(`.song-track-label-playable[data-row="${name}"]`);
    if (label) label.click();
    btn.classList.add("studio-key-down");
    setTimeout(() => btn.classList.remove("studio-key-down"), 160);
  }
  // A mouse or pen plays on press. A finger plays on lift, so dragging the keyboard sideways on a phone does not play a note.
  let touchKey = null;
  $("studio-keys").addEventListener("pointerdown", (e) => {
    const k = e.target.closest && e.target.closest("[data-key]");
    if (!k || e.button > 0) return;
    if (e.pointerType === "touch") {
      touchKey = k;
      return;
    }
    e.preventDefault();
    pressKey(k);
  });
  $("studio-keys").addEventListener("pointerup", (e) => {
    if (e.pointerType !== "touch" || !touchKey) return;
    const k = e.target.closest && e.target.closest("[data-key]");
    const was = touchKey;
    touchKey = null;
    if (k && k === was) pressKey(k);
  });
  $("studio-keys").addEventListener("pointercancel", () => {
    touchKey = null;
  });
  $("studio-keys").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const k = e.target.closest && e.target.closest("[data-key]");
    if (!k) return;
    e.preventDefault();
    pressKey(k);
  });

  // ---------- transport ----------
  $("studio-play").addEventListener("click", () => {
    $("song-play").click();
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
  $("studio-undo").addEventListener("click", () => {
    $("song-undo").click();
    refresh();
  });
  $("studio-redo").addEventListener("click", () => {
    $("song-redo").click();
    refresh();
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
  $("studio-patterns").addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-pat]");
    if (!b) return;
    const real = $("song-pattern-buttons").querySelector(`[data-pattern="${b.dataset.pat}"]`);
    if (real) real.click();
    setTimeout(() => {
      applyLayerView();
      refresh();
    }, 0);
  });
  $("studio-tools").addEventListener("click", () => {
    const open = !modal.classList.contains("studio-tools-open");
    modal.classList.toggle("studio-tools-open", open);
    $("studio-tools").setAttribute("aria-pressed", String(open));
  });
  function syncTransport() {
    const playing = /stop|⏸/i.test($("song-play").textContent);
    const play = $("studio-play");
    play.textContent = playing ? "⏸" : "▶";
    play.setAttribute("aria-label", playing ? "Pause" : "Play");
    play.classList.toggle("studio-playing", playing);
    $("studio-rec").setAttribute("aria-pressed", String($("song-record").checked));
    $("studio-metro").setAttribute("aria-pressed", String($("song-metronome-on").checked));
    $("studio-undo").disabled = $("song-undo").disabled;
    $("studio-redo").disabled = $("song-redo").disabled;
    if (document.activeElement !== $("studio-volume")) $("studio-volume").value = $("song-master-volume").value;
    if (document.activeElement !== $("studio-bpm")) $("studio-bpm").value = $("song-tempo").value;
    const buttons = Array.from($("song-pattern-buttons").querySelectorAll("[data-pattern]"));
    const sig = buttons.map((b) => b.dataset.pattern + b.getAttribute("aria-pressed")).join();
    const box = $("studio-patterns");
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.innerHTML =
        buttons.length > 1
          ? buttons.map((b) => `<button type="button" class="studio-pat" data-pat="${b.dataset.pattern}" aria-pressed="${b.getAttribute("aria-pressed")}" aria-label="Pattern ${b.dataset.pattern}">${b.dataset.pattern}</button>`).join("")
          : "";
    }
  }

  // ---------- view switching ----------
  function adopt() {
    if (adopted) return;
    const host = $("studio-roll-scroll");
    ADOPTED.forEach((id) => {
      const el = $(id);
      if (!el) return;
      const mark = document.createComment("studio-home-" + id);
      el.parentNode.insertBefore(mark, el);
      homes[id] = mark;
      host.appendChild(el);
    });
    adopted = true;
  }
  function release() {
    if (!adopted) return;
    ADOPTED.forEach((id) => {
      const el = $(id);
      const mark = homes[id];
      if (!el || !mark || !mark.parentNode) return;
      mark.parentNode.insertBefore(el, mark);
      mark.remove();
      el.hidden = false;
      delete homes[id];
    });
    $("song-sequencer").querySelectorAll(".song-track-row").forEach((r) => (r.hidden = false));
    adopted = false;
  }
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
    const toggle = $("song-view-toggle");
    toggle.textContent = on ? "Classic view" : "Studio view";
    toggle.setAttribute("aria-pressed", String(on));
    if (on) {
      adopt();
      applyLayerView();
      keysSig = "";
      detailSig = "";
      refresh();
    } else {
      release();
      modal.classList.remove("studio-tools-open");
    }
  }
  $("song-view-toggle").addEventListener("click", () => setView(view === "studio" ? "classic" : "studio", true));

  // ---------- keeping in step with the editor ----------
  function refresh() {
    if (view !== "studio" || modal.hidden) return;
    const s = song();
    if (!s) return;
    renderCards(s);
    cardSigsActive();
    renderDetail(s);
    syncTransport();
    renderKeys();
    filterRows();
  }
  function cardSigsActive() {
    $("studio-cards").querySelectorAll(".studio-card").forEach((el) => {
      const on = el.dataset.card === layerId;
      el.classList.toggle("studio-card-active", on);
      const main = el.querySelector(".studio-card-main");
      if (main && main.getAttribute("aria-pressed") !== String(on)) {
        main.setAttribute("aria-pressed", String(on));
        cardSigs[el.dataset.card] = "";
      }
    });
  }
  let queued = 0;
  const later = () => {
    clearTimeout(queued);
    queued = setTimeout(refresh, 30);
  };
  ["click", "input", "change", "keyup"].forEach((t) => modal.addEventListener(t, later));
  // Notes recorded while it plays, and the step highlight, change without any event, so look now and then.
  setInterval(() => {
    if (view === "studio" && !modal.hidden) refresh();
  }, 500);
  new MutationObserver(() => {
    if (view === "studio") filterRows();
  }).observe($("song-sequencer"), { childList: true });
  new MutationObserver(() => {
    if (view === "studio" && !modal.hidden) {
      keysSig = "";
      later();
    }
  }).observe($("song-piano-roll"), { childList: true });

  window.SongStudio = {
    refresh() {
      if (view === "studio") {
        applyLayerView();
        keysSig = "";
        detailSig = "";
        const l = layerOf(layerId);
        if (l.kind === "bass") $("song-roll-bass").click();
        else if (l.kind === "melody") $("song-roll-melody").click();
        Object.keys(cardSigs).forEach((k) => (cardSigs[k] = ""));
        refresh();
      }
    },
    layers: LAYERS,
    setView,
    view: () => view,
    select: selectLayer,
  };
  setView(view, false);
})();
