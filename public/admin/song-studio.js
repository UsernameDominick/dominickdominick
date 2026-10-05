// The Song builder's Studio layout, built for a phone first. Top to bottom: five track cards stacked on top of each other (Drums, Bass,
// Chords, Melody, Lead; scroll through them or tap one), the open track's expanded card (its steps and its sound), the play controls, and
// a piano keyboard that stays at the bottom.
//
// It is a view over the classic editor, not a second editor. The classic editor stays in the page (hidden) and every control here drives
// the matching classic control or clicks the matching classic step, so undo, autosave, recording, ties and the saved song are exactly
// what they always were. The five tracks are not stored; they are the song's own drum rows, bass, chords, melody and lead.
(function () {
  const $ = (id) => document.getElementById(id);
  const modal = $("song-builder-modal");
  const studio = $("song-studio");
  if (!modal || !studio) return;
  const Engine = window.SongEngine;
  const host = () => window.SongStudioHost;
  const song = () => (host() ? host().song() : null);

  // The order is fixed on purpose: track 1 to 5 always mean the same thing.
  const TRACKS = [
    { id: "drums", n: 1, name: "Drums", kind: "drums" },
    { id: "bass", n: 2, name: "Bass", kind: "notes", part: "bass" },
    { id: "chords", n: 3, name: "Chords", kind: "notes", part: "chords" },
    { id: "melody", n: 4, name: "Melody", kind: "notes", part: "melody" },
    { id: "lead", n: 5, name: "Lead", kind: "notes", part: "lead" },
  ];
  const DRUM_ORDER = ["kick", "snare", "hihat", "openhat", "clap", "rim", "tom", "crash"];
  const ROW_LABELS = { kick: "Kick", snare: "Snare", hihat: "Hi-hat", openhat: "Open hat", clap: "Clap", rim: "Rim", tom: "Tom", crash: "Crash" };
  const ROW_SHORT = { kick: "Kick", snare: "Snare", hihat: "Hat", openhat: "Open", clap: "Clap", rim: "Rim", tom: "Tom", crash: "Crash" };
  // Semitones above C0: every melodic roll is two octaves, the same as the classic editor's (melody C3 to B4, bass C1 to B2, chords C3 to
  // B4, lead C4 to B5).
  const RANGE = { melody: [36, 59], bass: [12, 35], chords: [36, 59], lead: [48, 71] };
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const STEPS = 16;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const semis = (name) => {
    const m = /^([A-G]#?)(-?\d)$/.exec(name);
    return m ? NAMES.indexOf(m[1]) + 12 * Number(m[2]) : 0;
  };
  const noteName = (n) => NAMES[n % 12] + Math.floor(n / 12);
  const trackOf = (id) => TRACKS.find((t) => t.id === id) || TRACKS[0];
  const trackIndex = () => TRACKS.findIndex((t) => t.id === trackId);
  const unitOf = (track, n) => (track.kind === "drums" ? "hit" : "note") + (n === 1 ? "" : "s");

  let view = "studio";
  try {
    if (localStorage.getItem("songView") === "classic") view = "classic";
  } catch {
    /* no storage: studio */
  }
  let trackId = "drums";

  // ---------- reading the song ----------
  const meta = (s, row) => (s.trackMeta && s.trackMeta[row]) || {};
  const drumRows = (s) => DRUM_ORDER.filter((r) => s.tracks && s.tracks[r]);
  const partOf = (s, track) => (track.part === "melody" ? s.melody : s[track.part]) || { notes: {} };
  const hit = (v) => v !== false && v != null && v !== 0;
  const voiceOf = (s, track) => (track.part === "melody" ? Engine.melodyVoiceOf(s) : Engine.partVoiceOf(s, track.part));
  function trackInfo(s, track) {
    if (track.kind === "drums") {
      const rows = drumRows(s);
      const cells = [];
      rows.forEach((row, ri) => (s.tracks[row] || []).forEach((v, i) => hit(v) && cells.push({ x: i, y: ri, h: rows.length, a: Engine.stepLevel(v) })));
      const muted = rows.length > 0 && rows.every((r) => meta(s, r).muted === true);
      const kit = s.kit || "acoustic";
      return { cells, count: cells.length, muted, sound: kit.charAt(0).toUpperCase() + kit.slice(1) + " kit", rows };
    }
    const part = partOf(s, track);
    const [lo, hi] = RANGE[track.part];
    const cells = [];
    let count = 0;
    Object.keys(part.notes || {}).forEach((name) => {
      const y = hi - semis(name);
      (part.notes[name] || []).forEach((v, i) => {
        if (!hit(v) || y < 0 || y > hi - lo) return;
        // A held step carries on the note before it, so it is drawn (joined to it) but not counted as another note.
        const held = Boolean(part.ties && part.ties[name] && part.ties[name][i] === true);
        cells.push({ x: i, y, h: hi - lo + 1, a: Engine.stepLevel(v), t: held });
        if (!held) count++;
      });
    });
    const voice = voiceOf(s, track);
    const label = voice && Engine.MELODY_VOICES[voice] ? Engine.MELODY_VOICES[voice].label : `Basic ${(s.melody && s.melody.waveform) || "sine"}`;
    return { cells, count, muted: part.muted === true, sound: label, rows: [] };
  }
  // The track to open with: the first one that has something in it, else Drums.
  function firstTrackWithContent(s) {
    const found = TRACKS.find((t) => trackInfo(s, t).count > 0);
    return found ? found.id : TRACKS[0].id;
  }
  const usedNotes = (s, track) => {
    const part = partOf(s, track);
    return Object.keys(part.notes || {}).filter((n) => (part.notes[n] || []).some(hit)).map(semis);
  };

  // ---------- the stack of track cards (3): stacked on top of each other, the open one in front ----------
  const stackEl = $("studio-stack");
  const cardSigs = {};
  function dots(info) {
    const cell = 6;
    const h = Math.max(1, info.cells[0] ? info.cells[0].h : 1);
    const rowH = 24 / h;
    const rects = info.cells
      .map((c) => `<rect x="${c.x * cell - (c.t ? 1 : 0)}" y="${(c.y * rowH).toFixed(2)}" width="${cell - 1 + (c.t ? 1 : 0)}" height="${Math.max(2, rowH - 1).toFixed(2)}" rx="1" opacity="${(0.4 + 0.6 * c.a).toFixed(2)}"/>`)
      .join("");
    return `<svg class="studio-dots" viewBox="0 0 ${STEPS * cell} 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">${rects}</svg>`;
  }
  function cardHtml(track, s, front) {
    const info = trackInfo(s, track);
    const count = `${info.count} ${unitOf(track, info.count)}`;
    const label = `Track ${track.n}, ${track.name}: ${count}${info.muted ? ", muted" : ""}. ${front ? "Selected" : "Choose this track"}`;
    return (
      `<button type="button" class="studio-card-main" data-no-history data-pick="${track.id}" data-muted="${info.muted}" aria-pressed="${front}" aria-label="${esc(label)}">` +
      `<span class="studio-card-head"><span class="studio-badge" aria-hidden="true">${track.n}</span><span class="studio-card-name">${esc(track.name)}</span><span class="studio-card-count">${count}${info.muted ? " · muted" : ""}</span></span>` +
      `<span class="studio-card-body">${dots(info)}<span class="studio-card-meta"><span>${count}${info.muted ? " · muted" : ""}</span><span class="studio-card-sound">${esc(info.sound)}</span></span></span>` +
      `</button>`
    );
  }
  // Card i sits i strips down from the top, except that the cards below the open one start after its full height; the open card is in
  // front of all. Each card behind shows only its top strip, which is all the name and count need.
  function renderStack(s) {
    if (!stackEl.children.length) {
      TRACKS.forEach((track) => {
        const el = document.createElement("div");
        el.className = "studio-card";
        el.dataset.card = track.id;
        el.style.setProperty("--track-color", `var(--track-${track.n})`);
        stackEl.appendChild(el);
      });
    }
    const f = trackIndex();
    TRACKS.forEach((track, i) => {
      const el = stackEl.children[i];
      el.style.setProperty("--k1", String(i <= f ? i : i - 1));
      el.style.setProperty("--k2", String(i > f ? 1 : 0));
      el.style.setProperty("--z", String(i === f ? 20 : i + 1));
      el.dataset.pos = i === f ? "front" : i < f ? "above" : "below";
      const html = cardHtml(track, s, i === f);
      if (cardSigs[track.id] !== html) {
        cardSigs[track.id] = html;
        el.innerHTML = html;
      }
    });
  }
  // Scrolling through the stack: a swipe up or down, the wheel, or the arrow keys moves to the next or the one before; a tap on any card
  // opens it. A drag follows the finger a little and lets go to the next or the one before.
  let drag = null;
  let dragged = false;
  stackEl.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    drag = { y: e.clientY, id: e.pointerId, moved: false };
  });
  stackEl.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) > 8) {
      drag.moved = true;
      try {
        stackEl.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable */
      }
      stackEl.classList.add("studio-dragging");
    }
    if (drag.moved) stackEl.style.setProperty("--drag", `${Math.max(-40, Math.min(40, dy))}px`);
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    const was = drag;
    drag = null;
    stackEl.classList.remove("studio-dragging");
    stackEl.style.removeProperty("--drag");
    if (!was.moved) return;
    dragged = true;
    setTimeout(() => (dragged = false), 50);
    if (Math.abs(dy) > 28) moveTrack(dy < 0 ? 1 : -1);
  }
  stackEl.addEventListener("pointerup", endDrag);
  stackEl.addEventListener("pointercancel", endDrag);
  let wheelAt = 0;
  stackEl.addEventListener(
    "wheel",
    (e) => {
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (Math.abs(delta) < 8) return;
      e.preventDefault();
      const now = Date.now();
      if (now - wheelAt < 260) return;
      wheelAt = now;
      moveTrack(delta > 0 ? 1 : -1);
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
    if (pick) selectTrack(pick.dataset.pick);
  });
  stackEl.addEventListener("keydown", (e) => {
    const steps = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    let to = null;
    if (e.key in steps) to = trackIndex() + steps[e.key];
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = TRACKS.length - 1;
    if (to === null) return;
    e.preventDefault();
    const target = TRACKS[Math.max(0, Math.min(TRACKS.length - 1, to))];
    selectTrack(target.id);
    const btn = stackEl.querySelector(`[data-pick="${target.id}"]`);
    if (btn) btn.focus();
  });
  function moveTrack(delta) {
    const to = Math.max(0, Math.min(TRACKS.length - 1, trackIndex() + delta));
    if (TRACKS[to].id !== trackId) selectTrack(TRACKS[to].id);
  }
  function toggleMute(track) {
    if (track.id !== trackId) selectTrack(track.id, { quiet: true });
    const s = song();
    if (track.kind === "drums") {
      const rows = drumRows(s);
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

  // ---------- choosing a track ----------
  const live = $("studio-live");
  const say = (text) => {
    live.textContent = text;
  };
  // The real roll shows one melodic part at a time, and the studio reads and clicks it, so keep it on the track's part.
  function syncRoll() {
    const track = trackOf(trackId);
    if (track.kind === "notes") $("song-roll-" + track.part).click();
  }
  // A row or roll hidden in the classic editor has no steps to click, so open it (a view setting only).
  function openHidden(track) {
    const s = song();
    if (track.kind === "drums") {
      drumRows(s).forEach((r) => {
        if (meta(s, r).hidden === true) {
          const real = $("song-sequencer").querySelector(`.song-track-hide[data-row="${r}"]`);
          if (real) real.click();
        }
      });
    } else if (partOf(s, track).hidden === true) {
      $("song-melody-hide").click();
    }
  }
  function selectTrack(id, opts) {
    const track = trackOf(id);
    const changed = track.id !== trackId;
    trackId = track.id;
    syncRoll();
    openHidden(track);
    detailSig = "";
    gridSig = "";
    keysSig = "";
    refresh();
    if (!changed) return;
    say(`Track ${track.n}, ${track.name}`);
    if (opts && opts.quiet) return;
    detailEl.classList.remove("studio-detail-in");
    void detailEl.offsetWidth;
    detailEl.classList.add("studio-detail-in");
  }

  // ---------- the expanded card (4) ----------
  const detailEl = $("studio-detail");
  let detailSig = "";
  const field = (label, control, extra) => `<label class="studio-field${extra ? " studio-field-" + extra : ""}"><span>${label}</span>${control}</label>`;
  const patternButtons = () => Array.from($("song-pattern-buttons").querySelectorAll("[data-pattern]"));
  const addableRows = (s) => ["openhat", "rim", "tom", "crash"].filter((r) => !(s.tracks && s.tracks[r]));
  function detailHtml(track, s, info) {
    const rows = info.rows;
    let controls = "";
    let volume = "";
    const volumeField = `<label class="studio-vol-inline"><span>Volume</span><input type="range" id="studio-track-vol" class="studio-vol-input" min="0" max="100" aria-label="${esc(track.name)} volume"></label>`;
    if (track.kind === "drums") {
      controls += field("Drum kit", `<select id="studio-kit" data-src="song-kit" aria-label="Drum kit, for every drum sound"></select>`);
      const addable = addableRows(s);
      if (addable.length) {
        controls += field(
          "Add a sound",
          `<span class="studio-add"><select id="studio-add" aria-label="Drum sound to add">${addable.map((r) => `<option value="${r}">${ROW_LABELS[r]}</option>`).join("")}</select><button type="button" id="studio-add-btn" class="studio-mini">Add</button></span>`
        );
      }
      // The mix sits in the bottom row beside Clear track, so the steps keep the room.
      volume = `<details class="studio-mix"><summary>Volume and mute for each sound</summary>${rows
        .map(
          (r) =>
            `<div class="studio-mix-row"><span>${ROW_LABELS[r]}</span>` +
            `<button type="button" class="studio-mini" data-row-mute="${r}" aria-pressed="false" aria-label="Mute ${ROW_LABELS[r]}">Mute</button>` +
            `<input type="range" class="studio-vol-input" data-row-vol="${r}" min="0" max="100" aria-label="${ROW_LABELS[r]} volume"></div>`
        )
        .join("")}</details>`;
    } else {
      const voiceSource = { melody: "song-voice", bass: "song-bass-voice", chords: "song-part-voice", lead: "song-part-voice" }[track.part];
      const soundLabel = track.part === "melody" ? "Piano sound" : `${track.name} sound`;
      controls += field(soundLabel, `<select id="studio-voice" data-src="${voiceSource}" aria-label="${soundLabel}"></select>`);
      if (track.part === "melody") controls += `<span id="studio-wave-field" class="studio-wave-field">${field("Wave", `<select id="studio-wave" data-src="song-waveform" aria-label="Wave for the basic sound"></select>`)}</span>`;
      if (track.part === "bass") controls += `<button type="button" id="studio-follow" class="studio-mini studio-action" title="Put a bass note on every kick hit of this pattern">Follow the kick</button>`;
      if (track.part === "chords") {
        controls +=
          field("Progression", `<select id="studio-prog-type" data-src="song-prog-type" aria-label="Chord progression"></select>`) +
          field("Key", `<select id="studio-prog-key" data-src="song-prog-key" aria-label="Key of the progression"></select>`, "small") +
          `<button type="button" id="studio-prog-stamp" class="studio-mini studio-action" title="Fill the loop with this chord progression (undoable)">Fill</button>`;
      }
      volume = volumeField;
    }
    const hint =
      track.kind === "drums"
        ? "Tap a step to place a hit. With Rec on, press a pad while it plays."
        : track.part === "chords"
          ? "Tap notes to build chords, or fill the loop with a progression. Hold a note to tie it. With Rec on, play the keys while it plays."
          : "Tap to place notes; hold a note to tie it to the one before. With Rec on, play the keys while it plays.";
    return (
      `<div class="studio-detail-head">` +
      `<span class="studio-badge" aria-hidden="true">${track.n}</span>` +
      `<div class="studio-detail-title"><h2>${esc(track.name)}</h2><p id="studio-sub" class="studio-detail-sub"></p></div>` +
      `<span id="studio-patterns" class="studio-patterns" role="group" aria-label="Pattern being edited"></span>` +
      `<button type="button" id="studio-undo" class="studio-round studio-small" data-no-history aria-label="Undo" title="Undo (Ctrl+Z)"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 7L4 12l5 5M4 12h10a6 6 0 010 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` +
      `<button type="button" id="studio-redo" class="studio-round studio-small" data-no-history aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 7l5 5-5 5M20 12H10a6 6 0 000 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` +
      `<button type="button" id="studio-mute" class="studio-pill" aria-pressed="false">Mute</button>` +
      `</div>` +
      `<div id="studio-grid-scroll" class="studio-grid-scroll"><div id="studio-grid" class="studio-grid" data-kind="${track.kind}" role="group" aria-label="${esc(track.name)} steps"></div></div>` +
      `<p id="studio-hint" class="studio-hint">${hint}</p>` +
      `<p id="studio-note" class="studio-note" role="status" hidden></p>` +
      `<div class="studio-edit">${controls}</div>` +
      `<div class="studio-foot">${volume}<button type="button" id="studio-clear" class="studio-link" title="Remove everything in this track (undoable)">Clear track</button></div>`
    );
  }
  function renderDetail(s) {
    const track = trackOf(trackId);
    const info = trackInfo(s, track);
    const sig = [track.id, info.rows.join(), track.kind === "drums" ? addableRows(s).join() : ""].join("|");
    if (sig !== detailSig) {
      detailSig = sig;
      detailEl.style.setProperty("--track-color", `var(--track-${track.n})`);
      detailEl.innerHTML = detailHtml(track, s, info);
      gridSig = "";
    }
    // Values are updated in place, so a slider being dragged is never rebuilt under the finger.
    $("studio-sub").textContent = `${info.count} ${unitOf(track, info.count)} · ${info.sound}`;
    $("studio-hint").hidden = info.count > 0; // the how-to only shows while the track is empty
    const mute = $("studio-mute");
    mute.setAttribute("aria-pressed", String(info.muted));
    mute.textContent = info.muted ? "Muted" : "Mute";
    mute.setAttribute("aria-label", `${info.muted ? "Unmute" : "Mute"} track ${track.n}, ${track.name}`);
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
    const tv = $("studio-track-vol");
    if (tv && document.activeElement !== tv) tv.value = Math.round(Engine.volumeOf(partOf(s, track)) * 100);
    detailEl.querySelectorAll("[data-row-vol]").forEach((r) => {
      if (document.activeElement !== r) r.value = Math.round(Engine.volumeOf(meta(s, r.dataset.rowVol)) * 100);
    });
    detailEl.querySelectorAll("[data-row-mute]").forEach((b) => b.setAttribute("aria-pressed", String(meta(s, b.dataset.rowMute).muted === true)));
    syncPatterns();
  }
  // What the classic editor said about the last thing a tool did ("Bass on every kick…", "The kick has no hits…") is worth showing here.
  function showToolNote() {
    const text = $("song-melody-tools-note").textContent.trim();
    const el = $("studio-note");
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
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
    if (t.id === "studio-track-vol") {
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
    const track = trackOf(trackId);
    if (t.id === "studio-mute") toggleMute(track);
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
    } else if (t.id === "studio-follow") {
      $("song-bass-follow").click();
      detailEl.dataset.note = "1";
    } else if (t.id === "studio-prog-stamp") {
      $("song-prog-stamp").click();
      detailEl.dataset.note = "1";
    } else if (t.id === "studio-clear") {
      if (track.kind === "drums") {
        const target = $("song-pattern-target");
        const keep = target.value;
        drumRows(song()).forEach((r) => {
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
    if (detailEl.dataset.note) {
      delete detailEl.dataset.note;
      showToolNote();
    }
  });

  // ---------- the steps inside the expanded card ----------
  // The cells here only mirror the song. A tap clicks the matching step of the classic editor, which does the real work (step strength,
  // undo, autosave, the preview), and then the mirror is painted again from the song.
  let gridSig = "";
  let gridCells = [];
  let colCells = [];
  let cellAt = {};
  let lastCol = -1;
  const melodicRows = (track) => {
    const [lo, hi] = RANGE[track.part];
    const rows = [];
    for (let n = hi; n >= lo; n--) rows.push(noteName(n));
    return rows;
  };
  function buildGrid(track, s) {
    const rows = track.kind === "drums" ? drumRows(s) : melodicRows(track);
    const sig = track.id + "|" + rows.join();
    if (sig === gridSig) return;
    gridSig = sig;
    const grid = $("studio-grid");
    grid.innerHTML = rows
      .map((row) => {
        const label = track.kind === "drums" ? ROW_SHORT[row] : row;
        const full = track.kind === "drums" ? ROW_LABELS[row] : row;
        let groups = "";
        for (let g = 0; g < 4; g++) {
          let cells = "";
          for (let i = g * 4; i < g * 4 + 4; i++) {
            cells += `<button type="button" class="studio-cell" data-row="${row}" data-step="${i}" aria-pressed="false" aria-label="${full} step ${i + 1}" tabindex="-1"></button>`;
          }
          groups += `<span class="studio-beat${g % 2 ? " studio-beat-alt" : ""}">${cells}</span>`;
        }
        const tag = track.kind === "drums" ? `<span class="studio-row-label">${label}</span>` : `<button type="button" class="studio-row-label studio-row-key" data-play="${row}" tabindex="-1" aria-label="Play ${row}">${label}</button>`;
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
  function paintGrid(s, track) {
    const part = track.kind === "drums" ? null : partOf(s, track);
    gridCells.forEach((cell) => {
      const row = cell.dataset.row;
      const i = Number(cell.dataset.step);
      const v = track.kind === "drums" ? (s.tracks[row] || [])[i] : ((part.notes || {})[row] || [])[i];
      const on = hit(v);
      const lv = on ? Engine.stepLevel(v) : 0;
      const tied = on && track.kind !== "drums" && Boolean(part.ties && part.ties[row] && part.ties[row][i] === true);
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
  // Scroll the notes to where the music is (or the middle of the range for an empty track).
  function centerGrid(smooth) {
    const track = trackOf(trackId);
    const scroll = $("studio-grid-scroll");
    if (!scroll || track.kind === "drums") return;
    const used = usedNotes(song(), track);
    const [lo, hi] = RANGE[track.part];
    const mid = used.length ? Math.round((Math.min(...used) + Math.max(...used)) / 2) : Math.round((lo + hi) / 2);
    const row = $("studio-grid").querySelector(`.studio-row[data-row="${noteName(Math.max(lo, Math.min(hi, mid)))}"]`);
    if (!row) return;
    const top = row.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    scroll.scrollTo({ top: Math.max(0, top - scroll.clientHeight / 2 + row.offsetHeight / 2), behavior: smooth ? "smooth" : "auto" });
  }
  function realStep(cell) {
    const track = trackOf(trackId);
    const root = track.kind === "drums" ? $("song-sequencer") : $("song-piano-roll");
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
    if (!cell || trackOf(trackId).kind === "drums") return;
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

  // ---------- the keys (1): they stay at the bottom, a piano you scroll sideways, or pads on the drums ----------
  const keysEl = $("studio-keys");
  const keysScroll = $("studio-keys-scroll");
  let keysSig = "";
  function renderKeys(s) {
    const track = trackOf(trackId);
    const rows = track.kind === "drums" ? drumRows(s) : null;
    const sig = track.id + "|" + (rows ? rows.join() : "");
    if (sig === keysSig) return;
    keysSig = sig;
    lit.clear();
    keysEl.style.setProperty("--track-color", `var(--track-${track.n})`);
    if (track.kind === "drums") {
      keysEl.className = "studio-keys studio-pads";
      keysEl.style.removeProperty("--whites");
      keysEl.setAttribute("aria-label", "Drum pads");
      keysEl.innerHTML = rows.map((r) => `<button type="button" class="studio-pad" data-pad="${r}" aria-label="Play ${ROW_LABELS[r]}">${ROW_LABELS[r]}</button>`).join("");
      return;
    }
    keysEl.className = "studio-keys";
    keysEl.setAttribute("aria-label", `Piano keys for ${track.name}`);
    const [lo, hi] = RANGE[track.part];
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
    const track = trackOf(trackId);
    if (track.kind === "drums") return;
    const used = usedNotes(song(), track);
    const [lo, hi] = RANGE[track.part];
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
  function trackHits(track, data, step) {
    if (track.kind === "drums") return DRUM_ORDER.some((r) => data.tracks && hit((data.tracks[r] || [])[step]) && !(data.trackMeta && data.trackMeta[r] && data.trackMeta[r].muted === true));
    const part = track.part === "melody" ? data.melody : data[track.part];
    return Boolean(part && part.notes && part.muted !== true && Object.keys(part.notes).some((n) => hit((part.notes[n] || [])[step])));
  }
  // A note roll wider than the screen follows the playhead sideways (a grid that fits never moves).
  function followPlayhead(cell) {
    const scroll = $("studio-grid-scroll");
    if (!cell || !scroll || scroll.scrollWidth <= scroll.clientWidth + 2) return;
    const c = cell.getBoundingClientRect();
    const s = scroll.getBoundingClientRect();
    if (c.left >= s.left + 44 && c.right <= s.right - 8) return;
    scroll.scrollTo({ left: Math.max(0, scroll.scrollLeft + (c.left - s.left) - 56), behavior: "smooth" });
  }
  function paintStep(step, info) {
    const s = song();
    if (!s) return;
    const data = info ? info.data : s;
    const track = trackOf(trackId);
    const here = !info || info.pattern === Engine.editingName(s);
    if (lastCol !== -1 && colCells[lastCol]) colCells[lastCol].forEach((c) => c.classList.remove("now"));
    lastCol = -1;
    if (here && colCells[step]) {
      colCells[step].forEach((c) => c.classList.add("now"));
      lastCol = step;
      followPlayhead(colCells[step][0]);
    }
    const names = new Set();
    if (track.kind === "drums") {
      DRUM_ORDER.forEach((r) => {
        if (data.tracks && hit((data.tracks[r] || [])[step]) && !(data.trackMeta && data.trackMeta[r] && data.trackMeta[r].muted === true)) names.add(r);
      });
    } else {
      const part = track.part === "melody" ? data.melody : data[track.part];
      if (part && part.notes && part.muted !== true) Object.keys(part.notes).forEach((n) => hit((part.notes[n] || [])[step]) && names.add(n));
    }
    setLit(names);
    TRACKS.forEach((t, i) => {
      if (!trackHits(t, data, step)) return;
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
    stackEl.querySelectorAll(".hit").forEach((el) => el.classList.remove("hit"));
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
      trackId = firstTrackWithContent(s);
      clearPlay();
    }
    if (opts && (opts.opened || opts.rebuild)) {
      detailSig = gridSig = keysSig = "";
      Object.keys(cardSigs).forEach((k) => delete cardSigs[k]);
      syncRoll();
      openHidden(trackOf(trackId));
    }
    const track = trackOf(trackId);
    renderStack(s);
    renderDetail(s);
    buildGrid(track, s);
    paintGrid(s, track);
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
      const track = trackOf(trackId);
      if (track.kind === "drums") return;
      let n = semis(requested);
      if (track.part === "bass") {
        while (n < 12) n += 12;
        while (n > 35) n -= 12;
      }
      flash(keysEl.querySelector(`[data-key="${noteName(n)}"]`));
      later();
    },
    active: () => view === "studio" && !modal.hidden,
    toggle: togglePlay,
    drumTrackOpen: () => view === "studio" && trackOf(trackId).kind === "drums",
    setView,
    view: () => view,
    select: selectTrack,
    tracks: TRACKS,
  };
  setView(view, false);
})();
