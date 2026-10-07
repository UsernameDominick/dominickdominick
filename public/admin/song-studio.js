// The Song builder: the Studio, the one way to make a song, built for a phone first. Top to bottom: five track cards stacked on top of each
// other (Drums, Bass, Chords, Melody, Lead; scroll through them or tap one), the open track's expanded card (a bar strip, a step grid or a
// roll, a few quick buttons), the play controls and a piano keyboard that stays at the bottom. Everything else the builder can do sits in the
// Tools sheet: the sound of the open track, its tools, the song's settings, the patterns, and sharing and export.
//
// It is a view over the builder's own editor, not a second editor. That editor stays in the page (hidden) and every control here drives the
// matching one or clicks the matching step, so undo, autosave, recording, ties and the saved song are exactly what they always were. The
// five tracks are not stored; they are the song's own drum rows, bass, chords, melody and lead. The builder's own controls that the sheet
// needs are moved into it, ids and all, so each keeps working as it did.
(function () {
  const $ = (id) => document.getElementById(id);
  const modal = $("song-builder-modal");
  const studio = $("song-studio");
  if (!modal || !studio) return;
  const Engine = window.SongEngine;
  const Edit = window.SongEdit;
  const host = () => window.SongStudioHost;
  const song = () => (host() ? host().song() : null);

  // The order is fixed on purpose: track 1 to 5 always mean the same thing, and each is the name of its lane in the song.
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
  // Semitones above C0: every melodic roll is two octaves, the same as the builder's (melody C3 to B4, bass C1 to B2, chords C3 to B4, lead C4 to B5).
  const RANGE = { melody: [36, 59], bass: [12, 35], chords: [36, 59], lead: [48, 71] };
  const HEAR = { melody: "C4", bass: "C2", chords: "C4", lead: "C5" }; // the note played to hear a change of sound
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
  const lsGet = (key, fallback) => {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  };
  const lsSet = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* not saved */
    }
  };

  // The old editor on its own (no Studio) is not offered to anyone; the older browser tests still drive it through this switch.
  const legacy = lsGet("songView", "studio") === "classic";
  let trackId = "drums";
  let mode = lsGet("songGridMode", "roll"); // how the notes of a track are drawn: the roll shows every note at once, on a phone too
  let soundRow = "kick"; // the drum sound whose volume the sound sheet shows (and whose strengths the level lane draws)
  let sel = new Set(); // the notes picked in the roll, by Edit.key (row:start)
  let snapBy = [1, 2, 4].includes(Number(lsGet("studioSnap", "1"))) ? Number(lsGet("studioSnap", "1")) : 1; // steps a drag snaps to: 1/16, 1/8, 1/4
  let zoom = [1, 1.5, 2, 3].includes(Number(lsGet("studioZoom", "1"))) ? Number(lsGet("studioZoom", "1")) : 1; // size of the roll
  let clip = null; // the bar copied with "Copy bar"
  const barPick = {}; // the bar being edited in each track

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
  // The scale the song highlights, as a set of the pitch classes (0 to 11) that belong to it, and whether notes snap to it.
  function scaleSet() {
    const sc = host() && host().scale ? host().scale() : null;
    if (!sc) return null;
    const root = NAMES.indexOf(sc.root);
    return { snap: sc.snap, has: (n) => sc.degrees.includes((((n % 12) - root) + 12) % 12), type: sc.type, root: sc.root };
  }
  // The row a tap lands on: with snapping on, the nearest note of the scale.
  function snapRow(row) {
    const sc = scaleSet();
    return sc && sc.snap && host().snap ? host().snap(row) : row;
  }

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
  // What a card counts is what its track plays in the bar picked for it, not the open pattern (opening Bass's second bar opens pattern
  // B, which can have no drums in it while the drums go on playing their own A).
  function cardInfo(s, track) {
    const name = Engine.patternAtBar && Engine.viewOf ? Engine.patternAtBar(s, track.id, barPick[track.id] || 0) : undefined;
    if (name === undefined) return trackInfo(s, track);
    const own = trackInfo(s, track);
    if (!name) return Object.assign({}, own, { cells: [], count: 0 });
    const seen = trackInfo(Engine.viewOf(s, name), track);
    return Object.assign({}, own, { cells: seen.cells, count: seen.count });
  }
  function cardHtml(track, s, front) {
    const info = cardInfo(s, track);
    const count = `${info.count} ${unitOf(track, info.count)}`;
    const label = `Track ${track.n}, ${track.name}: ${count}${info.muted ? ", muted" : ""}. ${front ? "Selected" : "Choose this track"}`;
    return (
      `<button type="button" class="studio-card-main" data-no-history data-pick="${track.id}" data-muted="${info.muted}" data-has="${info.count > 0}" aria-pressed="${front}" aria-label="${esc(label)}">` +
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
  // As a row of tabs (a phone, a tablet) the swipe goes across; as a column it goes up and down.
  const across = () => getComputedStyle(stackEl).flexDirection === "row";
  const along = (e) => (drag.across ? e.clientX - drag.x : e.clientY - drag.y);
  stackEl.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, across: across() };
  });
  stackEl.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = along(e);
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
    const dy = along(e);
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
  // The builder's roll shows one melodic part at a time, and the studio reads and clicks it, so keep it on the track's part.
  function syncRoll() {
    const track = trackOf(trackId);
    if (track.kind === "notes") $("song-roll-" + track.part).click();
  }
  // A row or roll hidden in the builder has no steps to click, so open it (a view setting only).
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
  // Every track plays its own pattern in each bar; show the one for the bar being edited.
  function showBar(track) {
    const arr = host().arr;
    if (!arr) return;
    const bars = arr.info(track.id).bars;
    const bar = Math.max(0, Math.min(bars - 1, barPick[track.id] || 0));
    barPick[track.id] = bar;
    arr.openBar(track.id, bar);
  }
  function selectTrack(id, opts) {
    const track = trackOf(id);
    const changed = track.id !== trackId;
    trackId = track.id;
    showBar(track);
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
  // One row of controls over the steps: the bars, + Bar, Loop, Steps or Roll, the sound (named on the button), Mute, Clear and a menu. On a
  // phone Loop, Mute and Clear move into the menu, so the row stays one row and the steps get the room.
  function detailHtml(track) {
    const hint =
      track.kind === "drums"
        ? "Tap a step to place a hit, or press and drag across steps to paint a run of them. Drag the bars under the steps to set how hard each is struck. With Rec on, press a pad while it plays."
        : mode === "roll"
          ? "Tap to place a note, drag along empty steps to draw a held note. Drag a note to move it, its right edge to resize it, Alt-drag to copy it, Shift-drag a box to select several. Drag the bars under the notes to set their strength."
          : "Tap to place notes; hold a note to tie it to the one before. With Rec on, play the keys while it plays.";
    const rollTools =
      track.kind === "notes" && mode === "roll"
        ? `<span class="studio-rolltools studio-wide-only" role="group" aria-label="Piano roll view"><label class="studio-snap" title="Notes you draw, move or resize snap to this">Snap <select id="studio-snap-by" data-no-reset aria-label="Snap notes to"><option value="1">1/16</option><option value="2">1/8</option><option value="4">1/4</option></select></label>` +
          `<button type="button" class="studio-mini" data-act="zoom-out" data-no-history aria-label="Zoom out" title="Zoom out">−</button><button type="button" class="studio-mini" data-act="zoom-in" data-no-history aria-label="Zoom in" title="Zoom in: bigger notes, scroll to see the rest">+</button></span>`
        : "";
    const modeSwitch =
      track.kind === "notes"
        ? `<span class="studio-modes" role="group" aria-label="How the notes are drawn"><button type="button" class="studio-mode" data-act="mode" data-mode="steps" data-no-history aria-pressed="${mode === "steps"}" title="Big steps you tap, scrolling a little">Steps</button><button type="button" class="studio-mode" data-act="mode" data-mode="roll" data-no-history aria-pressed="${mode === "roll"}" title="A piano roll: every note in view, drag to draw">Roll</button></span>`
        : "";
    return (
      `<h2 class="sim-sr-only">${esc(track.name)}</h2>` +
      `<div class="studio-trackbar" role="group" aria-label="${esc(track.name)}: bars and controls">` +
      `<div id="studio-bars" class="studio-bars" role="group" aria-label="Choose the bar to edit"></div>` +
      `<button type="button" class="studio-mini studio-add-bar" data-act="bar-add" aria-label="Add a bar" title="Add a new empty bar to the end of this track">+<span class="studio-wide-word"> Bar</span></button>` +
      `<button type="button" id="studio-loop" class="studio-mini studio-loop studio-wide-only" data-act="loop" aria-pressed="true" title="Loop: this track plays again from its first bar when it reaches its last, until the song ends">↻ Loop</button>` +
      modeSwitch +
      rollTools +
      `<button type="button" class="studio-mini studio-sound-btn" data-act="sound" data-no-history aria-label="Change the sound" title="Change the sound: the instrument, how it starts and ends, how bright it is"><span id="studio-sub" class="studio-sound-name"></span><span aria-hidden="true" class="studio-caret">▾</span></button>` +
      `<button type="button" id="studio-mute" class="studio-pill studio-wide-only" aria-pressed="false">Mute</button>` +
      `<button type="button" class="studio-mini studio-wide-only" id="studio-clear" data-act="clear" title="Remove everything in this track's bar (undoable)">Clear</button>` +
      `<span class="studio-popwrap"><button type="button" id="studio-bars-menu-btn" class="studio-mini studio-dots-btn" data-act="bars-menu" data-no-history aria-haspopup="true" aria-expanded="false" aria-controls="studio-bars-menu" aria-label="More for this track" title="More: track tools, make a bar different, remove a bar, the length of the song">⋯</button>` +
      `<div id="studio-bars-menu" class="studio-pop studio-pop-menu" role="group" aria-label="More for this track"></div></span>` +
      `</div>` +
      `<div id="studio-grid-scroll" class="studio-grid-scroll"><div id="studio-grid" class="studio-grid" data-kind="${track.kind}" data-mode="${track.kind === "drums" ? "steps" : mode}" role="group" aria-label="${esc(track.name)} steps"></div>` +
      `<div id="studio-silent" class="studio-silent" hidden><p></p><button type="button" class="studio-mini" data-act="bar-add">Add a bar here</button></div></div>` +
      `<div id="studio-pager" class="studio-pager" role="group" aria-label="Which steps are in view" hidden><button type="button" class="studio-page" data-page="0" data-no-history aria-pressed="true">Steps 1–8</button><button type="button" class="studio-page" data-page="1" data-no-history aria-pressed="false">Steps 9–16</button></div>` +
      `<p id="studio-hint" class="studio-hint">${hint}</p>` +
      `<p id="studio-note" class="studio-note" role="status" hidden></p>`
    );
  }
  function renderDetail(s) {
    const track = trackOf(trackId);
    const info = trackInfo(s, track);
    const sig = [track.id, info.rows.join(), mode].join("|");
    if (sig !== detailSig) {
      detailSig = sig;
      detailEl.style.setProperty("--track-color", `var(--track-${track.n})`);
      detailEl.innerHTML = detailHtml(track);
      gridSig = "";
      barsSig = "";
      const snapMenu = $("studio-snap-by");
      if (snapMenu) snapMenu.value = String(snapBy);
      applyZoom();
    }
    // Values are updated in place, so nothing is rebuilt under a finger.
    $("studio-sub").textContent = info.sound;
    $("studio-sub").closest("button").setAttribute("aria-label", `Sound: ${info.sound}. Change it`);
    $("studio-hint").hidden = info.count > 0; // the how-to only shows while the track is empty
    const mute = $("studio-mute");
    mute.setAttribute("aria-pressed", String(info.muted));
    mute.textContent = info.muted ? "Muted" : "Mute";
    mute.setAttribute("aria-label", `${info.muted ? "Unmute" : "Mute"} track ${track.n}, ${track.name}`);
    $("studio-undo").disabled = $("song-undo").disabled;
    $("studio-redo").disabled = $("song-redo").disabled;
    $("studio-fan-undo").disabled = $("song-undo").disabled;
    $("studio-fan-redo").disabled = $("song-redo").disabled;
    renderBars();
  }
  // What the builder said about the last thing a tool did ("Bass on every kick…", "The kick has no hits…") is worth showing here.
  function showToolNote() {
    const text = $("song-melody-tools-note").textContent.trim();
    const el = $("studio-note");
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
  }

  // ---------- the bars of the open track ----------
  // One chip per bar of the song: its number, the pattern the track plays in it (a bar a looping track repeats is dimmed, a bar it is
  // silent in is empty). A tap opens that bar. Loop, + Bar and the menu are on the same row.
  let barsSig = "";
  let playingBar = -1;
  function renderBars() {
    const arr = host().arr;
    const box = $("studio-bars");
    if (!arr || !box) return;
    const key = trackOf(trackId).id;
    const info = arr.info(key);
    const sel = Math.max(0, Math.min(info.bars - 1, barPick[key] || 0));
    const sig = JSON.stringify([info.cells.map((c) => [c.name, c.repeat]), info.open, info.loops, info.own, sel, info.free]);
    const loop = $("studio-loop");
    loop.setAttribute("aria-pressed", String(info.loops));
    loop.classList.toggle("is-off", !info.loops);
    if (sig !== barsSig) {
      barsSig = sig;
      box.innerHTML = info.cells
        .map((c) => {
          const word = c.name ? `pattern ${c.name}${c.repeat ? ", repeated from the loop" : ""}` : "silent";
          return `<button type="button" class="studio-bar${c.name === info.open ? " is-open" : ""}${c.repeat ? " is-repeat" : ""}${c.name ? "" : " is-empty"}${c.bar === sel ? " is-sel" : ""}" data-no-history data-act="bar" data-bar="${c.bar}" aria-pressed="${c.bar === sel}" aria-label="Bar ${c.bar + 1}, ${word}"><b>${c.bar + 1}</b><i>${c.name || "–"}</i></button>`;
        })
        .join("");
      const open = box.querySelector(".is-sel");
      if (open && open.scrollIntoView) open.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    markPlayingBar(playingBar);
    const silent = $("studio-silent");
    const here = info.cells[sel];
    if (silent) {
      silent.hidden = Boolean(here && here.name);
      silent.querySelector("p").textContent = `This track is silent in bar ${sel + 1}${info.loops ? "" : " (it does not loop)"}.`;
    }
  }
  function markPlayingBar(bar) {
    playingBar = bar;
    const box = $("studio-bars");
    if (!box) return;
    box.querySelectorAll(".studio-bar").forEach((b) => b.classList.toggle("is-now", Number(b.dataset.bar) === bar));
  }
  function barsMenuHtml() {
    const arr = host().arr;
    const track = trackOf(trackId);
    const key = track.id;
    const info = arr.info(key);
    const sel0 = barPick[key] || 0;
    const sel = sel0;
    const here = info.cells[sel];
    const s = song();
    const muted = trackInfo(s, track).muted;
    return (
      `<button type="button" class="studio-menu-item" data-act="tools">Track tools…<small>${track.kind === "drums" ? "Starter beats, fills, shift, random and more" : "Chords, arpeggios, transpose, the scale and more"}</small></button>` +
      `<button type="button" class="studio-menu-item studio-menu-narrow" data-act="loop" aria-pressed="${info.loops}">${info.loops ? "Loop is on" : "Loop is off"}<small>${info.loops ? "Tap to play this track once and stop" : "Tap to repeat this track until the song ends"}</small></button>` +
      `<button type="button" class="studio-menu-item studio-menu-narrow" data-act="mute" aria-pressed="${muted}">${muted ? "Unmute" : "Mute"} ${esc(track.name)}<small>${muted ? "It is silent now" : "Silence it while you work on the others"}</small></button>` +
      ($("song-midi-connect") && !$("song-midi-connect").hidden ? `<button type="button" class="studio-menu-item studio-menu-narrow" data-act="midi">${esc($("studio-midi").textContent)}<small>Connect a MIDI keyboard or pad controller</small></button>` : "") +
      `<button type="button" class="studio-menu-item studio-menu-narrow" data-act="clear">Clear bar ${sel + 1}<small>Remove everything this track plays there (undoable)</small></button>` +
      `<button type="button" class="studio-menu-item" data-act="shift-left">Shift the bar earlier<small>Everything moves one step left and wraps round</small></button>` +
      `<button type="button" class="studio-menu-item" data-act="shift-right">Shift the bar later<small>Everything moves one step right and wraps round</small></button>` +
      `<button type="button" class="studio-menu-item" data-act="copy-bar">Copy bar ${sel0 + 1}<small>Keep what this track plays in this bar</small></button>` +
      `<button type="button" class="studio-menu-item" data-act="paste-bar"${clip && clip.kind === track.kind ? "" : " disabled"}>Paste into bar ${sel0 + 1}<small>${clip && clip.kind === track.kind ? "Replace this bar with the one you copied" : "Copy a bar of this kind of track first"}</small></button>` +
      `<button type="button" class="studio-menu-item" data-act="bar-differ"${here && here.name ? "" : " disabled"}>Make bar ${sel + 1} different<small>A copy of what this track plays there, so it can change on its own</small></button>` +
      `<button type="button" class="studio-menu-item" data-act="bar-remove"${here && here.name && !here.repeat ? "" : " disabled"}>Remove bar ${sel + 1} from this track<small>The bars after it move up</small></button>` +
      `<button type="button" class="studio-menu-item" data-act="lane-follow"${info.own ? "" : " disabled"}>Follow the song order again<small>Drop this track's own bars</small></button>` +
      `<div class="studio-menu-len"><span id="studio-len-label">Song length</span><button type="button" class="studio-mini" data-act="bars-less" aria-label="One bar shorter">−</button><output id="studio-len">${info.bars}</output><button type="button" class="studio-mini" data-act="bars-more" aria-label="One bar longer">+</button>` +
      `<button type="button" class="studio-mini" data-act="bars-auto"${info.auto ? " disabled" : ""} title="Let the song be as long as the music in it">Auto</button></div>`
    );
  }

  // ---------- popovers (volume, metronome, the bars menu) ----------
  let openPop = null;
  function closePop() {
    if (!openPop) return;
    openPop.panel.classList.remove("is-open");
    openPop.button.setAttribute("aria-expanded", "false");
    openPop = null;
  }
  function togglePop(button, panel) {
    if (openPop && openPop.panel === panel) return closePop();
    closePop();
    panel.classList.add("is-open");
    button.setAttribute("aria-expanded", "true");
    openPop = { button, panel };
    const field = panel.querySelector("input, select, button:not([disabled])");
    if (field) field.focus();
  }
  document.addEventListener("pointerdown", (e) => {
    if (openPop && !openPop.panel.contains(e.target) && !openPop.button.contains(e.target)) closePop();
  });
  studio.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openPop) {
      e.stopPropagation();
      const b = openPop.button;
      closePop();
      b.focus();
    }
  });

  detailEl.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("button");
    if (!t || t.classList.contains("studio-cell") || t.dataset.play) return;
    const track = trackOf(trackId);
    const arr = host().arr;
    const act = t.dataset.act;
    if (t.id === "studio-mute" || act === "mute") {
      toggleMute(track);
      closePop();
    } else if (act === "mode") {
      mode = t.dataset.mode;
      lsSet("songGridMode", mode);
      detailSig = "";
      gridSig = "";
    } else if (act === "midi") {
      closePop();
      $("studio-midi").click();
    } else if (act === "sound") openSheet("sound");
    else if (act === "tools") {
      closePop();
      openSheet("tools");
    }
    else if (act === "bar") {
      barPick[track.id] = Number(t.dataset.bar);
      followPaused = host().playing();
      if (!arr.openBar(track.id, barPick[track.id])) say(`Bar ${barPick[track.id] + 1} is silent for ${track.name}`);
      else say(`Bar ${barPick[track.id] + 1}`);
      gridSig = "";
      keysSig = "";
      barsSig = "";
    } else if (act === "bar-add") {
      const name = arr.addBar(track.id);
      if (!name) say("There is no room for another bar: all sixteen patterns are used.");
      else barPick[track.id] = Math.max(0, arr.info(track.id).length - 1);
      gridSig = "";
      barsSig = "";
    } else if (act === "bar-differ") {
      const name = arr.differ(track.id, barPick[track.id] || 0);
      say(name ? `Bar ${(barPick[track.id] || 0) + 1} is now its own pattern, ${name}.` : "There is no room for another pattern: all sixteen are used.");
      closePop();
      gridSig = "";
      barsSig = "";
    } else if (act === "bar-remove") {
      const bar = barPick[track.id] || 0;
      arr.removeBar(track.id, bar);
      barPick[track.id] = Math.max(0, bar - 1);
      showBar(track);
      closePop();
      gridSig = "";
      barsSig = "";
    } else if (act === "lane-follow") {
      arr.follow(track.id);
      closePop();
      barsSig = "";
    } else if (act === "loop") {
      if (t.closest("#studio-bars-menu")) closePop();
      arr.setLoop(track.id, !arr.info(track.id).loops);
      say(arr.info(track.id).loops ? `${track.name} loops until the song ends` : `${track.name} plays once and then stops`);
      barsSig = "";
    } else if (act === "shift-left" || act === "shift-right") {
      closePop();
      shiftBar(track, act === "shift-left" ? -1 : 1);
    } else if (act === "copy-bar") {
      closePop();
      copyBar(track);
    } else if (act === "paste-bar") {
      closePop();
      pasteBar(track);
    } else if (act === "zoom-in" || act === "zoom-out") {
      const steps = [1, 1.5, 2, 3];
      zoom = steps[Math.max(0, Math.min(steps.length - 1, steps.indexOf(zoom) + (act === "zoom-in" ? 1 : -1)))];
      lsSet("studioZoom", String(zoom));
      applyZoom();
      return;
    } else if (act === "bars-menu") {
      $("studio-bars-menu").innerHTML = barsMenuHtml();
      togglePop(t, $("studio-bars-menu"));
      return;
    } else if (act === "bars-less" || act === "bars-more" || act === "bars-auto") {
      const info = arr.info(track.id);
      arr.setBars(act === "bars-auto" ? null : Math.max(1, Math.min(Engine.MAX_BARS, info.bars + (act === "bars-more" ? 1 : -1))));
      $("studio-bars-menu").innerHTML = barsMenuHtml();
      const again = $("studio-bars-menu").querySelector(`[data-act="${act}"]:not([disabled])`) || $("studio-bars-menu").querySelector("button:not([disabled])");
      if (again) again.focus(); // the menu was rebuilt, so keep the focus on it
      barsSig = "";
    } else if (act === "clear") {
      if (t.closest("#studio-bars-menu")) closePop();
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
  });

  // ---------- the steps inside the expanded card ----------
  // The cells here only mirror the song. A tap clicks the matching step of the builder's editor, which does the real work (step strength,
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
    const sc = scaleSet();
    const sig = track.id + "|" + mode + "|" + rows.join() + "|" + (sc ? sc.root + sc.type + sc.snap : "");
    if (sig === gridSig) return;
    gridSig = sig;
    const grid = $("studio-grid");
    grid.innerHTML = rows
      .map((row) => {
        const label = track.kind === "drums" ? ROW_SHORT[row] : row;
        const full = track.kind === "drums" ? ROW_LABELS[row] : row;
        const off = track.kind === "notes" && sc && !sc.has(semis(row));
        let groups = "";
        for (let g = 0; g < 4; g++) {
          let cells = "";
          for (let i = g * 4; i < g * 4 + 4; i++) {
            cells += `<button type="button" class="studio-cell" data-row="${row}" data-step="${i}" aria-pressed="false" aria-label="${full} step ${i + 1}" tabindex="-1"></button>`;
          }
          groups += `<span class="studio-beat${g % 2 ? " studio-beat-alt" : ""}">${cells}</span>`;
        }
        const tag = track.kind === "drums" ? `<span class="studio-row-label">${label}</span>` : `<button type="button" class="studio-row-label studio-row-key" data-play="${row}" tabindex="-1" aria-label="Play ${row}">${label}</button>`;
        return `<div class="studio-row${row.includes("#") ? " studio-row-black" : ""}${off ? " studio-row-off" : ""}" data-row="${row}">${tag}${groups}</div>`;
      })
      .join("");
    // Under the steps, a lane of bars: how hard each step is struck. Drag across it to draw the strengths.
    let laneBeats = "";
    for (let g = 0; g < 4; g++) {
      let bars = "";
      for (let i = g * 4; i < g * 4 + 4; i++) bars += `<span class="studio-lane-bar" data-lane="${i}"><i></i></span>`;
      laneBeats += `<span class="studio-beat${g % 2 ? " studio-beat-alt" : ""}">${bars}</span>`;
    }
    grid.insertAdjacentHTML("beforeend", `<div class="studio-row studio-lane-row" aria-hidden="true"><span class="studio-row-label studio-lane-label"></span>${laneBeats}</div>`);
    laneBars = Array.from(grid.querySelectorAll(".studio-lane-bar"));
    gridCells = Array.from(grid.querySelectorAll(".studio-cell"));
    colCells = Array.from({ length: STEPS }, () => []);
    cellAt = {};
    gridCells.forEach((c) => {
      colCells[Number(c.dataset.step)].push(c);
      cellAt[c.dataset.row + ":" + c.dataset.step] = c;
    });
    if (gridCells[0]) gridCells[0].tabIndex = 0;
    lastCol = -1;
    applyZoom();
    centerGrid(false);
  }
  let laneBars = [];
  // The roll's size: rows taller and steps wider, the grid scrolling when it is bigger than its room.
  function applyZoom() {
    const grid = $("studio-grid");
    if (!grid) return;
    const zoomed = zoom > 1 && trackOf(trackId).kind === "notes" && mode === "roll";
    grid.toggleAttribute("data-zoomed", zoomed);
    grid.style.setProperty("--zoom", String(zoomed ? zoom : 1));
    const out = detailEl.querySelector('[data-act="zoom-out"]');
    const inn = detailEl.querySelector('[data-act="zoom-in"]');
    if (out) out.disabled = zoom <= 1;
    if (inn) inn.disabled = zoom >= 3;
  }
  // Notes that are picked, notes of other tracks behind this one (ghosts), and where each note ends (its resize handle).
  let selCells = new Set();
  let endCells = new Set();
  let ghostCells = new Set();
  function paintGrid(s, track) {
    const part = track.kind === "drums" ? null : partOf(s, track);
    if (part) {
      const list = Edit.spans(part.notes || {}, part.ties || {}, STEPS);
      const keys = new Set(list.map(Edit.key));
      sel.forEach((k) => keys.has(k) || sel.delete(k));
      selCells = new Set();
      endCells = new Set();
      list.forEach((sp) => {
        endCells.add(sp.row + ":" + (sp.start + sp.len - 1));
        if (sel.has(Edit.key(sp))) for (let k = 0; k < sp.len; k++) selCells.add(sp.row + ":" + (sp.start + k));
      });
      ghostCells = new Set();
      TRACKS.forEach((t) => {
        if (t.kind !== "notes" || t.id === track.id) return;
        const notes = partOf(s, t).notes || {};
        Object.keys(notes).forEach((row) => (notes[row] || []).forEach((v, i) => hit(v) && ghostCells.add(row + ":" + i)));
      });
    } else {
      selCells = new Set();
      endCells = new Set();
      ghostCells = new Set();
    }
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
      const k = row + ":" + i;
      const picked = selCells.has(k);
      if (cell._sel !== picked) {
        cell._sel = picked;
        cell.classList.toggle("sel", picked);
      }
      const end = endCells.has(k);
      if (cell._end !== end) {
        cell._end = end;
        cell.classList.toggle("span-end", end);
      }
      const ghost = !on && ghostCells.has(k);
      if (cell._ghost !== ghost) {
        cell._ghost = ghost;
        cell.classList.toggle("ghost", ghost);
      }
    });
    paintLane(s, track, part);
  }
  // The level lane: the strength of each step of the chosen drum sound, or of the notes that start on each step of the roll.
  function paintLane(s, track, part) {
    if (!laneBars.length) return;
    const label = detailEl.querySelector(".studio-lane-label");
    if (label) label.textContent = track.kind === "drums" ? "Hit" : "Level";
    const row = track.kind === "drums" ? (s.tracks[soundRow] ? soundRow : drumRows(s)[0]) : null;
    laneBars.forEach((bar) => {
      const i = Number(bar.dataset.lane);
      const lv = track.kind === "drums" ? Edit.startLevel({ [row]: s.tracks[row] || [] }, {}, i, STEPS) : Edit.startLevel(part.notes || {}, part.ties || {}, i, STEPS);
      if (bar._lv !== lv) {
        bar._lv = lv;
        bar.firstChild.style.setProperty("--h", String(lv));
        bar.classList.toggle("on", lv > 0);
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
  // The builder's own step for a cell. With scale snapping on, a note tapped outside the scale lands on the nearest row of it.
  function realStep(cell, row) {
    const track = trackOf(trackId);
    const root = track.kind === "drums" ? $("song-sequencer") : $("song-piano-roll");
    return root.querySelector(`.song-step[data-row="${row || cell.dataset.row}"][data-step="${cell.dataset.step}"]`);
  }
  function clickStep(row, step, shift) {
    const track = trackOf(trackId);
    const target = track.kind === "drums" ? row : snapRow(row);
    const real = realStep({ dataset: { step } }, target);
    if (!real) return null;
    real.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: Boolean(shift) }));
    return target;
  }
  function tapCell(cell, shift) {
    const target = clickStep(cell.dataset.row, cell.dataset.step, shift);
    if (!target) return;
    refresh();
    if (!shift) {
      const now = cellAt[target + ":" + cell.dataset.step] || cell;
      say(`${now.getAttribute("aria-label")}: ${now.classList.contains("on") ? "on" : "off"}`);
    }
  }
  // A long press on a note ties it to the one before (the builder's Shift+click).
  let hold = null;
  detailEl.addEventListener("pointerdown", (e) => {
    const bar = e.target.closest && e.target.closest(".studio-lane-bar");
    if (bar) return laneDown(e);
    const cell = e.target.closest && e.target.closest(".studio-cell");
    if (!cell) return;
    if (trackOf(trackId).kind === "drums") {
      soundRow = cell.dataset.row;
      return drumDown(e, cell);
    }
    if (mode === "roll") return rollDown(e, cell);
    hold = {
      cell,
      fired: false,
      at: performance.now(),
      timer: setTimeout(() => {
        hold.fired = true;
        tapCell(cell, true);
      }, 520),
    };
  });
  // Letting go counts as the long press if it was held long enough, even when a busy page had not run the timer yet.
  const endHold = (e) => {
    if (!hold) return;
    clearTimeout(hold.timer);
    if (!hold.fired && e && e.type === "pointerup" && performance.now() - hold.at >= 520) {
      hold.fired = true;
      tapCell(hold.cell, true);
    }
  };
  detailEl.addEventListener("pointerup", endHold);
  detailEl.addEventListener("pointercancel", endHold);
  detailEl.addEventListener("pointerleave", endHold);

  // ---------- dragging: paint drum steps, move and resize notes, pick with a box, draw strengths ----------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let gdrag = null; // { kind: "move" | "resize" | "box" | "drums", ... }
  let lane = null;
  const suppressClick = () => {
    paintDone = true;
    setTimeout(() => (paintDone = false), 60);
  };
  // How big a step and a row are on screen right now, and the roll's rows from the top.
  function geom() {
    const rows = Array.from($("studio-grid").querySelectorAll(".studio-row[data-row]:not(.studio-lane-row)"));
    if (!rows.length) return null;
    const r0 = rows[0].getBoundingClientRect();
    const r1 = rows[1] ? rows[1].getBoundingClientRect() : r0;
    const a = cellAt[rows[0].dataset.row + ":0"].getBoundingClientRect();
    const b = cellAt[rows[0].dataset.row + ":1"].getBoundingClientRect();
    return { cw: Math.max(4, b.left - a.left), rh: Math.max(4, r1.top - r0.top || r0.height), names: rows.map((r) => r.dataset.row) };
  }
  const barNow = () => {
    const part = partOf(song(), trackOf(trackId));
    return { notes: clone(part.notes || {}), ties: clone(part.ties || {}) };
  };
  const strengthNow = () => Edit.level(host().stepStrength());

  function drumDown(e, cell) {
    if (e.button > 0) return;
    gdrag = { kind: "drums", id: e.pointerId, erase: cell.classList.contains("on"), x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, seen: new Set([cell.dataset.row + ":" + cell.dataset.step]), start: cell, moved: false };
  }
  function drumApply(cell) {
    const row = cell.dataset.row;
    const step = Number(cell.dataset.step);
    host().editDrums((tracks) => Edit.paintCells(tracks, [{ row, step }], gdrag.erase ? false : strengthNow(), STEPS));
  }
  function rollDown(e, cell) {
    if (e.button > 0) return;
    const part = partOf(song(), trackOf(trackId));
    const step = Number(cell.dataset.step);
    const sp = Edit.spanAt(part.notes || {}, part.ties || {}, cell.dataset.row, step, STEPS);
    const modKey = e.ctrlKey || e.metaKey;
    if (e.shiftKey) {
      // Shift on empty steps: a box. Shift on a note stays the builder's own tie toggle.
      if (sp) return;
      const g = geom();
      if (!g) return;
      gdrag = { kind: "box", id: e.pointerId, x: e.clientX, y: e.clientY, a: { row: g.names.indexOf(cell.dataset.row), step }, g, moved: false, el: null };
      return;
    }
    if (!sp) {
      sel.clear();
      paintGrid(song(), trackOf(trackId));
      return startPaint(e, cell);
    }
    if (modKey) {
      const k = Edit.key(sp);
      sel.has(k) ? sel.delete(k) : sel.add(k);
      paintGrid(song(), trackOf(trackId));
      suppressClick();
      e.preventDefault();
      return;
    }
    if (!sel.has(Edit.key(sp))) {
      sel = new Set([Edit.key(sp)]);
      paintGrid(song(), trackOf(trackId));
    }
    const r = cell.getBoundingClientRect();
    const atEdge = step === sp.start + sp.len - 1 && e.clientX > r.left + r.width * 0.6;
    gdrag = { kind: atEdge ? "resize" : "move", id: e.pointerId, x: e.clientX, y: e.clientY, sp, copy: e.altKey && !atEdge, moved: false, base: null, list: null, g: null, lastRows: 0 };
  }
  detailEl.addEventListener("pointermove", (e) => {
    if (!gdrag || e.pointerId !== gdrag.id) return;
    const dx = e.clientX - gdrag.x;
    const dy = e.clientY - gdrag.y;
    if (gdrag.kind === "drums") {
      if (!gdrag.moved) {
        if (Math.hypot(dx, dy) < 4) return;
        gdrag.moved = true;
        host().group(true);
        try {
          detailEl.setPointerCapture(e.pointerId);
        } catch {
          /* not capturable */
        }
        drumApply(gdrag.start);
      }
      // sample along the way so a fast gdrag does not skip a step
      const dist = Math.hypot(e.clientX - gdrag.lx, e.clientY - gdrag.ly);
      const n = Math.max(1, Math.ceil(dist / 6));
      for (let k = 1; k <= n; k++) {
        const c = stepUnder(gdrag.lx + ((e.clientX - gdrag.lx) * k) / n, gdrag.ly + ((e.clientY - gdrag.ly) * k) / n);
        const key = c && c.dataset.row + ":" + c.dataset.step;
        if (c && !gdrag.seen.has(key)) {
          gdrag.seen.add(key);
          drumApply(c);
        }
      }
      gdrag.lx = e.clientX;
      gdrag.ly = e.clientY;
      paintGrid(song(), trackOf(trackId));
      return;
    }
    if (gdrag.kind === "box") {
      if (!gdrag.moved && Math.hypot(dx, dy) < 4) return;
      if (!gdrag.moved) {
        gdrag.moved = true;
        gdrag.el = document.createElement("div");
        gdrag.el.className = "studio-marquee";
        document.body.append(gdrag.el);
        try {
          detailEl.setPointerCapture(e.pointerId);
        } catch {
          /* not capturable */
        }
      }
      Object.assign(gdrag.el.style, { left: Math.min(gdrag.x, e.clientX) + "px", top: Math.min(gdrag.y, e.clientY) + "px", width: Math.abs(dx) + "px", height: Math.abs(dy) + "px" });
      const c = stepUnder(e.clientX, e.clientY);
      if (c) {
        const b = { row: gdrag.g.names.indexOf(c.dataset.row), step: Number(c.dataset.step) };
        const part = barNow();
        sel = new Set(Edit.inBox(part.notes, part.ties, STEPS, gdrag.g.names, gdrag.a, b).map(Edit.key));
        paintGrid(song(), trackOf(trackId));
      }
      return;
    }
    // move or resize a note (or all the picked ones)
    if (!gdrag.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      gdrag.moved = true;
      gdrag.g = geom();
      gdrag.base = barNow();
      gdrag.list = Edit.spans(gdrag.base.notes, gdrag.base.ties, STEPS).filter((sp) => sel.has(Edit.key(sp)));
      if (!gdrag.list.length) gdrag.list = [gdrag.sp];
      host().group(true);
      try {
        detailEl.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable */
      }
    }
    const g = gdrag.g;
    if (!g) return;
    const track = trackOf(trackId);
    if (gdrag.kind === "move") {
      const first = gdrag.list[0];
      const dSteps = Edit.snap(first.start + dx / g.cw, snapBy) - first.start;
      const dRows = Math.round(dy / g.rh);
      host().editRoll(() => {
        const out = Edit.move(gdrag.base.notes, gdrag.base.ties, gdrag.list, dRows, dSteps, STEPS, g.names, { copy: gdrag.copy });
        sel = new Set(out.spans.map(Edit.key));
        if (out.moved.rows !== gdrag.lastRows) {
          gdrag.lastRows = out.moved.rows;
          const at = g.names.indexOf(gdrag.sp.row) + out.moved.rows;
          if (g.names[at]) host().hear(track.id, g.names[at]);
        }
        return { notes: out.notes, ties: out.ties };
      });
    } else {
      const end = gdrag.sp.start + gdrag.sp.len;
      const dLen = Edit.snap(end + dx / g.cw, snapBy) - end;
      host().editRoll(() => {
        let n = gdrag.base.notes;
        let t = gdrag.base.ties;
        gdrag.list.forEach((sp) => {
          const out = Edit.resize(n, t, sp, sp.len + dLen, STEPS);
          n = out.notes;
          t = out.ties;
        });
        return { notes: n, ties: t };
      });
    }
    paintGrid(song(), track);
  });
  function endGridDrag(e) {
    if (lane && (!e || e.pointerId === lane.id)) {
      lane = null;
      host().group(false);
      suppressClick();
      refresh();
    }
    if (!gdrag || (e && e.pointerId !== gdrag.id)) return;
    const was = gdrag;
    gdrag = null;
    if (was.el) was.el.remove();
    if (was.moved) {
      if (was.kind !== "box") host().group(false);
      suppressClick();
      refresh();
    }
  }
  detailEl.addEventListener("pointerup", endGridDrag);
  detailEl.addEventListener("pointercancel", endGridDrag);
  detailEl.addEventListener("lostpointercapture", endGridDrag);
  window.addEventListener("pointerup", endGridDrag, true);

  // The lane: press on a bar and drag to set the strength of that step; keep dragging along to draw them.
  function laneDown(e) {
    if (e.button > 0) return;
    lane = { id: e.pointerId };
    host().group(true);
    try {
      detailEl.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    laneSet(e);
    e.preventDefault();
  }
  function laneSet(e) {
    let bar = null;
    for (const b of laneBars) {
      const r = b.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX < r.right + 2) {
        bar = b;
        break;
      }
    }
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    let lv = 1 - (e.clientY - r.top) / Math.max(1, r.height);
    lv = Math.max(0.1, Math.min(1, lv));
    if (lv > 0.93) lv = 1;
    const step = Number(bar.dataset.lane);
    const track = trackOf(trackId);
    if (track.kind === "drums") {
      const row = soundRow;
      host().editDrums((tracks) => {
        if (!tracks[row] || !Edit.on(tracks[row][step])) return null;
        return { [row]: Edit.setStepLevels({ [row]: tracks[row] }, [{ row, step }], lv, STEPS)[row] };
      });
    } else {
      host().editRoll(({ notes, ties }) => {
        const list = Edit.spans(notes, ties, STEPS).filter((sp) => sp.start === step && (!sel.size || sel.has(Edit.key(sp))));
        return list.length ? { notes: Edit.setLevel(notes, list, lv, STEPS), ties } : null;
      });
    }
    paintGrid(song(), track);
  }
  detailEl.addEventListener("pointermove", (e) => {
    if (lane && e.pointerId === lane.id) laneSet(e);
  });

  // Keys on the picked notes: Delete removes them, the arrows move them (up and down by a semitone, Shift for an octave), Esc lets go.
  detailEl.addEventListener(
    "keydown",
    (e) => {
      if (mode !== "roll" || trackOf(trackId).kind !== "notes" || !e.target.closest || !e.target.closest(".studio-cell")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        e.stopPropagation();
        const b = barNow();
        sel = new Set(Edit.spans(b.notes, b.ties, STEPS).map(Edit.key));
        paintGrid(song(), trackOf(trackId));
        return;
      }
      if (!sel.size) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        sel.clear();
        paintGrid(song(), trackOf(trackId));
        return;
      }
      const g = geom();
      if (!g) return;
      const pickedNow = (b) => Edit.spans(b.notes, b.ties, STEPS).filter((sp) => sel.has(Edit.key(sp)));
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        host().editRoll((b) => {
          const out = Edit.remove(b.notes, b.ties, pickedNow(b), STEPS);
          return { notes: out.notes, ties: out.ties };
        });
        sel.clear();
        refresh();
        return;
      }
      const dir = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      let moved = null;
      host().editRoll((b) => {
        const out = Edit.move(b.notes, b.ties, pickedNow(b), dir[0] * (e.shiftKey ? 12 : 1), dir[1] * (e.shiftKey ? snapBy * 4 : snapBy), STEPS, g.names);
        sel = new Set(out.spans.map(Edit.key));
        moved = out;
        return { notes: out.notes, ties: out.ties };
      });
      if (moved && dir[0] && moved.moved.rows) {
        const now = barNow();
        const one = Edit.spans(now.notes, now.ties, STEPS).find((sp) => sel.has(Edit.key(sp)));
        if (one) host().hear(trackId, one.row);
      }
      refresh();
    },
    true
  );

  // ---------- bar tools: shift, copy, paste ----------
  const MP = () => window.SongPatterns;
  function shiftBar(track, by) {
    if (track.kind === "drums") {
      host().editDrums((tracks) => {
        const out = {};
        Object.keys(tracks).forEach((row) => (out[row] = MP().rotateMelody({ [row]: tracks[row] }, by, STEPS)[row] || tracks[row]));
        return out;
      });
    } else {
      host().editRoll(({ notes, ties }) => ({ notes: MP().rotateMelody(notes, by, STEPS), ties: MP().rotateTies(ties, by, STEPS) }));
    }
    sel.clear();
    say(`${track.name} shifted one step ${by < 0 ? "earlier" : "later"}`);
    refresh();
  }
  function copyBar(track) {
    clip = track.kind === "drums" ? { kind: "drums", tracks: clone(song().tracks) } : { kind: "notes", ...barNow() };
    say(`Copied ${track.name}'s bar`);
  }
  function pasteBar(track) {
    if (!clip || clip.kind !== track.kind) return;
    if (track.kind === "drums") {
      host().editDrums((tracks) => {
        const out = {};
        Object.keys(tracks).forEach((row) => (out[row] = clip.tracks[row] ? clone(clip.tracks[row]) : new Array(STEPS).fill(false)));
        return out;
      });
    } else {
      host().editRoll(({ notes }) => {
        const n = {};
        Object.keys(notes).forEach((row) => (n[row] = clip.notes[row] ? clone(clip.notes[row]) : new Array(STEPS).fill(false)));
        return { notes: n, ties: clone(clip.ties) };
      });
    }
    sel.clear();
    say(`Pasted into ${track.name}'s bar`);
    refresh();
  }
  detailEl.addEventListener("change", (e) => {
    if (e.target.id === "studio-snap-by") {
      snapBy = Number(e.target.value) || 1;
      lsSet("studioSnap", String(snapBy));
    }
  });

  // The roll: press a note and drag along its row to hold it for as long as you drag, press on an empty step and drag to draw, or press on a
  // note and drag across others to erase them. The whole drag is one undo step. A plain tap is the usual click.
  let paint = null;
  let paintDone = false;
  function stepUnder(x, y) {
    const el = document.elementFromPoint(x, y);
    const cell = el && el.closest ? el.closest(".studio-cell") : null;
    return cell && detailEl.contains(cell) ? cell : null;
  }
  function startPaint(e, cell) {
    if (e.button > 0) return;
    paint = { id: e.pointerId, row: cell.dataset.row, from: Number(cell.dataset.step), last: Number(cell.dataset.step), x: e.clientX, y: e.clientY, moved: false, erase: cell.classList.contains("on"), grouped: false };
  }
  detailEl.addEventListener("pointermove", (e) => {
    if (!paint || e.pointerId !== paint.id) return;
    if (!paint.moved && Math.abs(e.clientX - paint.x) < 7) return;
    const cell = stepUnder(e.clientX, e.clientY);
    if (!cell) return;
    if (!paint.moved) {
      paint.moved = true;
      paint.grouped = true;
      host().group(true);
      try {
        detailEl.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable */
      }
      // the step pressed is the start: a new note is begun on it, or the note on it is the first one erased
      const start = cellAt[paint.row + ":" + paint.from];
      if (start && start.classList.contains("on") === paint.erase) clickStep(paint.row, paint.from, false);
    }
    const step = Number(cell.dataset.step);
    if (step === paint.last) return;
    const dir = step > paint.last ? 1 : -1;
    for (let s = paint.last + dir; dir > 0 ? s <= step : s >= step; s += dir) {
      const c = cellAt[paint.row + ":" + s];
      if (!c) continue;
      const on = c.classList.contains("on");
      if (paint.erase) {
        if (on) clickStep(paint.row, s, false);
      } else if (dir > 0) {
        if (!on) clickStep(paint.row, s, false);
        refreshCell(c);
        clickStep(paint.row, s, true); // hold it to the step before
      }
      refreshCell(cellAt[paint.row + ":" + s]);
    }
    paint.last = step;
    paintGrid(song(), trackOf(trackId));
  });
  function refreshCell(c) {
    if (c) paintGrid(song(), trackOf(trackId));
  }
  function endPaint(e) {
    if (!paint || e.pointerId !== paint.id) return;
    const was = paint;
    paint = null;
    if (was.grouped) {
      host().group(false);
      paintDone = true;
      setTimeout(() => (paintDone = false), 60);
      refresh();
    }
  }
  detailEl.addEventListener("pointerup", endPaint);
  detailEl.addEventListener("pointercancel", endPaint);
  detailEl.addEventListener("lostpointercapture", endPaint);
  window.addEventListener("pointerup", endPaint, true);
  detailEl.addEventListener("click", (e) => {
    const cell = e.target.closest && e.target.closest(".studio-cell");
    const key = e.target.closest && e.target.closest("[data-play]");
    if (cell) {
      if (paintDone) {
        e.preventDefault();
        return;
      }
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
    const sc = scaleSet();
    const sig = track.id + "|" + (rows ? rows.join() : "") + "|" + (sc ? sc.root + sc.type : "");
    if (sig === keysSig) return;
    releaseAllLive(true);
    keysSig = sig;
    lit.clear();
    keysEl.style.setProperty("--track-color", `var(--track-${track.n})`);
    $("studio-keyboard").style.setProperty("--track-color", `var(--track-${track.n})`);
    $("studio-keyboard").dataset.kind = track.kind === "drums" ? "drums" : "notes";
    syncPlayUi();
    if (track.kind === "drums") {
      keysEl.className = "studio-keys studio-pads";
      keysEl.style.removeProperty("--whites");
      keysEl.setAttribute("aria-label", "Drum pads");
      keysEl.innerHTML = rows.map((r) => `<button type="button" class="studio-pad" data-pad="${r}" aria-label="Play ${ROW_LABELS[r]}"><span class="p-vel" aria-hidden="true"></span><span class="p-name">${ROW_LABELS[r]}</span><span class="p-hint" aria-hidden="true">soft top, hard bottom</span></button>`).join("");
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
        const off = sc && !sc.has(semis(n)) ? " out" : "";
        const letter = n.replace(/-?\d+$/, "");
        const oct = n.slice(letter.length);
        if (!n.includes("#")) {
          whites++;
          const root = sc && sc.root === letter ? " is-root" : "";
          const isC = letter === "C" ? " is-c" : "";
          return `<button type="button" class="studio-key studio-key-white${off}${isC}${root}" data-key="${n}" aria-label="Play ${n}" style="left:${(whites * step).toFixed(3)}%;width:${step.toFixed(3)}%"><span class="k-name" aria-hidden="true"><span class="k-letter">${letter}</span><span class="k-oct">${oct}</span></span></button>`;
        }
        return `<button type="button" class="studio-key studio-key-black${off}" data-key="${n}" aria-label="Play ${n.replace("#", " sharp")}" style="left:${((whites + 1) * step - step * 0.32).toFixed(3)}%;width:${(step * 0.64).toFixed(3)}%"><span class="k-name" aria-hidden="true">${letter}</span></button>`;
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
    flash(keysEl.querySelector(`[data-key="${snapRow(name)}"]`) || keysEl.querySelector(`[data-key="${name}"]`));
    refresh();
  }
  // ---------- playing live: keys you can hold, Hold, the pitch wheel, arpeggio, strum, random and pad rolls ----------
  // A press makes a "voice" ({ el, stop() }): a held note, an arpeggio running while keys are down, a strummed chord, or a pad (a roll when the
  // pad is set to roll). Releasing stops the voice, unless Hold is on: then it is kept, and stopped when Hold is switched off.
  const Live = window.SongLive;
  const clampN = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const readPlay = () => {
    try {
      return Live.cleanPlay(JSON.parse(lsGet("studioPlay", "{}")));
    } catch {
      return Live.cleanPlay({});
    }
  };
  let play = readPlay();
  const savePlay = () => {
    try {
      localStorage.setItem("studioPlay", JSON.stringify(play));
    } catch {
      /* a remembered choice is a nicety */
    }
  };
  const keyboardEl = $("studio-keyboard");
  const held = new Map(); // pointer id -> voice
  const pedal = []; // voices kept alive by Hold
  const touching = new Map(); // a finger that may still turn out to be a swipe: id -> { el, x, y, timer }
  let sustained = false;
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isDrums = () => trackOf(trackId).kind === "drums";
  const tempo = () => (song() && song().tempo) || 120;
  const keyEl = (name) => keysEl.querySelector(`[data-key="${name}"]`);

  // A note held live, sounding at least `min` ms so a quick tap is still heard.
  function heldNote(el, name, velocity, min) {
    const h = host().noteOn(name, velocity);
    const at = performance.now();
    if (!h) return { el, stop() {} };
    return {
      el,
      stop() {
        const heldFor = (performance.now() - at) / 1000; // how long the key was down, whatever the sound is made to last
        const wait = Math.max(0, min - (performance.now() - at));
        if (wait) setTimeout(() => h.off(heldFor), wait);
        else h.off(heldFor);
      },
    };
  }
  // The arpeggio: one for the whole keyboard, running while any key is down (or held by Hold), over the notes held.
  const arp = { notes: [], i: 0, timer: 0, prev: null };
  function arpTick() {
    const track = trackOf(trackId);
    if (!arp.notes.length || track.kind === "drums") {
      arp.timer = 0;
      return;
    }
    const sec = Live.rateSeconds(tempo(), play.rate);
    const [lo, hi] = RANGE[track.part];
    let pick = Live.arpPick(arp.notes.map((n) => n.midi), play.mode === "random" ? "random" : play.pattern, play.octaves, arp.i++, Math.random, arp.prev);
    if (pick !== null) {
      while (pick > hi) pick -= 12;
      while (pick < lo) pick += 12;
      arp.prev = pick;
      const name = noteName(pick);
      host().note(name, { duration: sec * play.gate, velocity: 1 });
      flash(keyEl(name));
      refresh();
    }
    arp.timer = setTimeout(arpTick, sec * 1000);
  }
  function startArp(el, name) {
    const entry = { el, midi: semis(name) };
    arp.notes.push(entry);
    if (!arp.timer) {
      arp.i = 0;
      arp.prev = null;
      arpTick();
    }
    return {
      el,
      stop() {
        arp.notes = arp.notes.filter((n) => n !== entry);
        if (!arp.notes.length) {
          clearTimeout(arp.timer);
          arp.timer = 0;
        }
      },
    };
  }
  // A strum: the chord built on the key, its notes sounding one after another across the spread and held until the key is let go.
  let strums = 0;
  function startStrum(el, name) {
    const [, hi] = RANGE[trackOf(trackId).part];
    const chord = Live.chordNotes(semis(name), play.chord).map((m) => {
      while (m > hi) m -= 12;
      return m;
    });
    const voices = [];
    const timers = [];
    let released = false;
    Live.strumPlan(chord.length, play.spread, play.dir, strums++).forEach((p) => {
      timers.push(setTimeout(() => {
        if (released) return;
        voices.push(heldNote(el, noteName(chord[p.i]), 0.9, 320));
        flash(keyEl(noteName(chord[p.i])));
      }, p.at * 1000));
    });
    return {
      el,
      stop() {
        released = true;
        timers.forEach(clearTimeout);
        voices.forEach((v) => v.stop());
      },
    };
  }
  function startKey(el) {
    const name = el.dataset.key;
    if (play.mode === "arp" || play.mode === "random") return startArp(el, name);
    if (play.mode === "strum") return startStrum(el, name);
    return heldNote(el, name, 1, 140);
  }
  // A pad: struck at a strength set by where on it you press (or a pen's pressure); a roll repeats until it is let go.
  function padFlash(el, v) {
    const bar = el.querySelector(".p-vel");
    if (bar) bar.style.setProperty("--vel", String(v));
    el.classList.add("down");
    setTimeout(() => {
      el.classList.remove("down");
      if (bar) bar.style.setProperty("--vel", "0");
    }, 170);
  }
  function startPad(el, e) {
    const row = el.dataset.pad;
    const rect = el.getBoundingClientRect();
    const base = Live.padVelocity({ y: e.clientY - rect.top, h: rect.height, pressure: e.pressure, pointerType: e.pointerType });
    let n = 0;
    let timer = 0;
    const strike = () => {
      const v = n === 0 ? base : Live.rollVelocity(n, play.swell, base);
      n++;
      host().hit(row, v);
      padFlash(el, v);
      refresh();
    };
    strike();
    const rolling = play.padMode === "roll";
    if (rolling) {
      el.classList.add("rolling");
      const sec = Live.rateSeconds(tempo(), play.rate);
      const again = () => {
        timer = setTimeout(() => {
          strike();
          again();
        }, sec * 1000);
      };
      again();
    }
    return {
      el,
      stop() {
        clearTimeout(timer);
        el.classList.remove("rolling");
      },
    };
  }
  function begin(id, el, e) {
    if (held.has(id)) return;
    if (host().unlock) host().unlock();
    const voice = el.dataset.pad ? startPad(el, e) : startKey(el);
    if (!voice) return;
    held.set(id, voice);
    el.classList.add("held");
  }
  function end(id) {
    const voice = held.get(id);
    if (!voice) return;
    held.delete(id);
    if (sustained) {
      pedal.push(voice);
      return;
    }
    voice.stop();
    if (![...held.values(), ...pedal].some((v) => v.el === voice.el)) voice.el.classList.remove("held");
    refresh();
  }
  function releaseAllLive(everything) {
    touching.forEach((t) => clearTimeout(t.timer));
    touching.clear();
    [...held.keys()].forEach((id) => {
      const v = held.get(id);
      held.delete(id);
      v.stop();
    });
    if (everything) pedal.splice(0).forEach((v) => v.stop());
    keysEl.querySelectorAll(".held").forEach((el) => el.classList.remove("held"));
    arp.notes = [];
    clearTimeout(arp.timer);
    arp.timer = 0;
    setWheel(0);
  }
  keysEl.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    const el = e.target.closest && e.target.closest("[data-key], [data-pad]");
    if (!el) return;
    if (e.pointerType === "touch") {
      // a finger may be starting to swipe along the keyboard: play once it has stayed put for a moment (or lifts, which is a tap)
      const t = { el, x: e.clientX, y: e.clientY, e: { clientY: e.clientY, pressure: e.pressure, pointerType: e.pointerType } };
      t.timer = setTimeout(() => {
        touching.delete(e.pointerId);
        begin(e.pointerId, el, t.e);
      }, 70);
      touching.set(e.pointerId, t);
      return;
    }
    e.preventDefault();
    if (held.has(e.pointerId)) end(e.pointerId); // a press whose release was lost
    begin(e.pointerId, el, e);
  });
  window.addEventListener("pointermove", (e) => {
    const t = touching.get(e.pointerId);
    if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8) {
      clearTimeout(t.timer);
      touching.delete(e.pointerId);
      return;
    }
    // a mouse or pen sliding across the keys plays each one in turn (a glissando)
    const voice = held.get(e.pointerId);
    if (!voice || e.pointerType === "touch" || !voice.el.dataset.key) return;
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const next = over && over.closest && over.closest("[data-key]");
    if (next && next !== voice.el && keysEl.contains(next)) {
      end(e.pointerId);
      begin(e.pointerId, next, e);
    }
  });
  const lift = (e) => {
    const t = touching.get(e.pointerId);
    if (t) {
      // lifted before the delay: a tap
      clearTimeout(t.timer);
      touching.delete(e.pointerId);
      if (e.type === "pointerup") {
        begin(e.pointerId, t.el, t.e);
        setTimeout(() => end(e.pointerId), 30);
      }
      return;
    }
    end(e.pointerId);
  };
  window.addEventListener("pointerup", lift);
  window.addEventListener("pointercancel", lift);
  // A keyboard user's Enter or Space (a click with no pointer) and a script's .click() play a single note or hit; a real click after a
  // pointer press was already played.
  keysEl.addEventListener("click", (e) => {
    const k = e.target.closest && e.target.closest("[data-key], [data-pad]");
    if (!k) return;
    if (e.isTrusted && e.detail > 0) return;
    if (k.dataset.pad) {
      host().hit(k.dataset.pad);
      flash(k);
      refresh();
    } else pressNote(k.dataset.key);
  });
  // Hold: keeps what you let go of sounding until you press it again.
  const sustainBtn = $("studio-sustain");
  sustainBtn.addEventListener("click", () => {
    sustained = !sustained;
    sustainBtn.setAttribute("aria-pressed", String(sustained));
    if (!sustained) {
      pedal.splice(0).forEach((v) => v.stop());
      keysEl.querySelectorAll(".held").forEach((el) => {
        if (![...held.values()].some((v) => v.el === el)) el.classList.remove("held");
      });
      refresh();
    }
  });

  // The pitch wheel: drag it up or down to bend every note held; it springs back to the middle when let go.
  const wheel = $("studio-wheel");
  let wheelV = 0;
  let wheelDrag = false;
  let spring = 0;
  function setWheel(v) {
    wheelV = clampN(v, -1, 1);
    const cents = Live.bendCents(wheelV, play.bendRange);
    wheel.style.setProperty("--bend", String(wheelV));
    wheel.classList.toggle("is-bent", Math.abs(wheelV) > 0.02);
    wheel.setAttribute("aria-valuenow", String(Math.round(wheelV * 100)));
    wheel.setAttribute("aria-valuetext", cents ? `${cents > 0 ? "up" : "down"} ${Math.abs(cents)} cents` : "No bend");
    if (host() && host().bend) host().bend(cents);
  }
  function springBack() {
    cancelAnimationFrame(spring);
    if (reduceMotion()) return setWheel(0);
    const step = () => {
      if (Math.abs(wheelV) < 0.03) return setWheel(0);
      setWheel(wheelV * 0.7);
      spring = requestAnimationFrame(step);
    };
    spring = requestAnimationFrame(step);
  }
  const wheelTo = (e) => {
    const r = wheel.getBoundingClientRect();
    setWheel((r.top + r.height / 2 - e.clientY) / Math.max(1, r.height / 2 - 14));
  };
  wheel.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    cancelAnimationFrame(spring);
    wheelDrag = true;
    try { wheel.setPointerCapture(e.pointerId); } catch { /* fine */ }
    if (host().unlock) host().unlock();
    wheelTo(e);
  });
  wheel.addEventListener("pointermove", (e) => { if (wheelDrag) wheelTo(e); });
  const wheelUp = () => {
    if (!wheelDrag) return;
    wheelDrag = false;
    springBack();
  };
  wheel.addEventListener("pointerup", wheelUp);
  wheel.addEventListener("pointercancel", wheelUp);
  wheel.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    cancelAnimationFrame(spring);
    setWheel(wheelV + (e.key === "ArrowUp" ? 0.5 : -0.5));
  });
  wheel.addEventListener("keyup", (e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") springBack(); });

  // The Play button: how the keys play (normal, arpeggio, strum, random; or normal and roll on the pads) and its settings.
  const modeBtn = $("studio-playmode");
  const playPop = $("studio-playpop");
  const MODES = [["off", "Normal"], ["arp", "Arpeggio"], ["strum", "Strum"], ["random", "Random"]];
  const PAD_MODES = [["off", "Normal"], ["roll", "Roll"]];
  const ppSel = (key, label, list, value) => `<label>${label}<select data-pp="${key}">${list.map(([v, l]) => `<option value="${v}"${String(v) === String(value) ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
  const RATE_LIST = Object.keys(Live.RATES).map((r) => [r, Live.RATE_LABELS[r]]);
  function playLabel() {
    if (isDrums()) return play.padMode === "roll" ? `Roll ${Live.RATE_LABELS[play.rate]}` : "Normal";
    return { off: "Normal", arp: `Arpeggio ${play.rate}`, strum: `Strum ${Live.CHORDS[play.chord].label}`, random: `Random ${play.rate}` }[play.mode];
  }
  function syncPlayUi() {
    if (!modeBtn) return;
    modeBtn.textContent = "Play: " + playLabel();
    const hint = isDrums()
      ? play.padMode === "roll" ? "Hold a pad to roll it" : "Press low on a pad to hit it hard"
      : { off: "Hold a key to sustain it", arp: "Hold keys to arpeggiate them", strum: "Tap a key to strum its chord", random: "Hold keys for random notes from them" }[play.mode];
    $("studio-keyhint").textContent = hint;
    if (!playPop.hidden) renderPlayPop();
  }
  function renderPlayPop() {
    const drums = isDrums();
    const modes = (drums ? PAD_MODES : MODES).map(([v, l]) => `<button type="button" class="pp-mode" data-pp-mode="${v}" aria-pressed="${(drums ? play.padMode : play.mode) === v}" data-no-history>${l}</button>`).join("");
    let body = "";
    if (drums) {
      if (play.padMode === "roll") body += ppSel("rate", "Roll speed", RATE_LIST, play.rate) + `<label class="pp-check"><input type="checkbox" data-pp="swell"${play.swell ? " checked" : ""}> Swell: build up as it rolls</label>`;
      body += `<p class="pp-note">Where you press a pad sets how hard it hits: the top is soft, the bottom is hard. Hold a pad with Roll on for a hi-hat roll, and press Hold to keep it rolling.</p>`;
    } else {
      if (play.mode === "arp" || play.mode === "random") {
        body += ppSel("rate", "Speed", RATE_LIST, play.rate);
        if (play.mode === "arp") body += ppSel("pattern", "Order", Object.entries(Live.PATTERNS), play.pattern);
        body += ppSel("octaves", "Octaves", [[1, "1"], [2, "2"], [3, "3"]], play.octaves);
        body += ppSel("gate", "Note length", [[0.3, "Short"], [0.6, "Medium"], [1, "Full"]], play.gate);
      } else if (play.mode === "strum") {
        body += ppSel("chord", "Chord", Object.entries(Live.CHORDS).map(([k, c]) => [k, c.label]), play.chord);
        body += ppSel("spread", "Strum speed", [[30, "Fast"], [70, "Medium"], [140, "Slow"], [260, "Very slow"]], play.spread);
        body += ppSel("dir", "Direction", [["down", "Down"], ["up", "Up"], ["alt", "Alternate"]], play.dir);
      }
      body += ppSel("bendRange", "Pitch wheel range", [[1, "1 semitone"], [2, "2 semitones"], [5, "5 semitones"], [12, "An octave"]], play.bendRange);
      body += `<p class="pp-note">${{ off: "Normal: a held key keeps sounding until you let go.", arp: "Arpeggio: hold one or more keys and they play one after another. One key repeats it, like a trill.", strum: "Strum: a key plays the chord built on it, one note after another.", random: "Random: hold keys and random notes from them (and the octaves above) play." }[play.mode]}</p>`;
    }
    playPop.innerHTML = `<div class="pp-modes">${modes}</div>${body}`;
  }
  modeBtn.addEventListener("click", () => {
    playPop.hidden = !playPop.hidden;
    modeBtn.setAttribute("aria-expanded", String(!playPop.hidden));
    if (!playPop.hidden) {
      renderPlayPop();
      const first = playPop.querySelector("[aria-pressed='true'], button");
      if (first) first.focus();
    }
  });
  const closePlayPop = () => {
    if (playPop.hidden) return false;
    playPop.hidden = true;
    modeBtn.setAttribute("aria-expanded", "false");
    return true;
  };
  playPop.addEventListener("click", (e) => {
    const m = e.target.closest("[data-pp-mode]");
    if (!m) return;
    releaseAllLive(false);
    if (isDrums()) play.padMode = m.dataset.ppMode;
    else play.mode = m.dataset.ppMode;
    play = Live.cleanPlay(play);
    savePlay();
    syncPlayUi();
    renderPlayPop();
    const again = playPop.querySelector("[aria-pressed='true']");
    if (again) again.focus();
  });
  playPop.addEventListener("change", (e) => {
    const key = e.target.dataset && e.target.dataset.pp;
    if (!key) return;
    play = Live.cleanPlay(Object.assign({}, play, { [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
    savePlay();
    syncPlayUi();
    const again = playPop.querySelector(`[data-pp="${key}"]`); // the options were redrawn: give the focus back
    if (again) again.focus();
  });
  playPop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closePlayPop();
      modeBtn.focus();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!playPop.hidden && !playPop.contains(e.target) && !modeBtn.contains(e.target)) closePlayPop();
  });
  syncPlayUi();

  // ---------- playing: the playhead, the keys and the cards light up with the music ----------
  let pending = [];
  let followPaused = false; // tapping a bar while it plays stops the editor following the music until it plays again
  const pref = (key, fallback) => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  };
  const setPref = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* a remembered choice is a nicety */
    }
  };
  let followOn = pref("songFollow", "1") !== "0"; // the Follow button: off means the editor stays where it is while the song plays
  let recTop = pref("songRecTop", "0") === "1"; // the button before Rec: recording always starts from the beginning
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
    // The editor follows the music from bar to bar: when the open track moves on to another bar, that bar opens (its pattern, if it differs).
    if (info && info.patterns && followOn && !followPaused && lastBar !== info.chainIndex && host().arr) {
      const want = info.patterns[track.id];
      barPick[track.id] = info.chainIndex;
      if (want && want !== Engine.editingName(s)) {
        host().arr.openBar(track.id, info.chainIndex);
        gridSig = "";
        keysSig = "";
        syncRoll();
        refresh();
      }
      barsSig = "";
      renderBars();
    }
    if (info) {
      lastBar = info.chainIndex;
      markPlayingBar(info.chainIndex);
    }
    const open = info && info.patterns && info.patterns[track.id] !== undefined ? info.patterns[track.id] : info ? info.pattern : null;
    const here = !info || open === Engine.editingName(s);
    if (lastCol !== -1 && colCells[lastCol]) colCells[lastCol].forEach((c) => c.classList.remove("now"));
    lastCol = -1;
    if (here && colCells[step]) {
      colCells[step].forEach((c) => c.classList.add("now"));
      lastCol = step;
      if (followOn) followPlayhead(colCells[step][0]);
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
  let lastBar = -1;
  function clearPlay() {
    pending.forEach(clearTimeout);
    pending = [];
    if (lastCol !== -1 && colCells[lastCol]) colCells[lastCol].forEach((c) => c.classList.remove("now"));
    lastCol = -1;
    lastBar = -1;
    followPaused = false;
    markPlayingBar(-1);
    setLit(new Set());
    stackEl.querySelectorAll(".hit").forEach((el) => el.classList.remove("hit"));
  }

  // ---------- the controls (2) ----------
  const playBtn = $("studio-play");
  function togglePlay() {
    const h = host();
    if (h.playing()) h.pause();
    else {
      followPaused = false;
      h.unlock();
      if (recTop && $("song-record").checked) h.forget(); // armed to record: from the top, not from where it was paused
      $("song-play").click(); // plays (or carries on after a pause, with the count-in if one is set)
    }
    syncTransport();
  }
  playBtn.addEventListener("click", togglePlay);
  $("studio-sheet-play").addEventListener("click", togglePlay); // shaping a sound while it plays
  $("studio-stop").addEventListener("click", () => {
    host().stop();
    syncTransport();
  });
  $("studio-fan-stop").addEventListener("click", () => {
    host().stop();
    syncTransport();
    closeFan(true);
  });
  // Undo and redo on the bar press the builder's own, so the history is the one it keeps.
  $("studio-undo").addEventListener("click", () => {
    $("song-undo").click();
    refresh();
  });
  $("studio-redo").addEventListener("click", () => {
    $("song-redo").click();
    refresh();
  });
  // ---------- the fan: Rec is a hub; hold it (or press ⋯) and the other controls open in an arc above it ----------
  const fan = $("studio-fan");
  const fanToggle = $("studio-fan-btn");
  const recHub = $("studio-rec");
  function layoutFan() {
    const slots = [...fan.querySelectorAll(".studio-fan-slot")].filter((slot) => getComputedStyle(slot).display !== "none");
    const n = slots.length;
    const room = Math.min(studio.clientWidth || window.innerWidth, window.innerWidth) / 2 - 44;
    const radius = Math.max(96, Math.min(152, room));
    fan.style.setProperty("--arc", radius.toFixed(0) + "px");
    // The arc grows from Rec, but slides toward the middle when Rec is near an edge, so every circle (and its label) stays on screen.
    const hub = fan.parentElement.getBoundingClientRect();
    const rec = recHub.getBoundingClientRect();
    const cx = rec.left + rec.width / 2;
    const item = parseFloat(getComputedStyle(fan).getPropertyValue("--item")) || 44;
    const need = radius + item / 2 + 8;
    const W = window.innerWidth;
    const center = need * 2 > W ? W / 2 : Math.max(need, Math.min(W - need, cx));
    fan.style.setProperty("--fan-x", (center - hub.left).toFixed(1) + "px");
    // from just above the left of the hub to just above its right (165 degrees round to 15), wide enough for a name under each circle
    const from = (165 * Math.PI) / 180;
    const to = (15 * Math.PI) / 180;
    slots.forEach((slot, i) => {
      const t = from - (n > 1 ? i / (n - 1) : 0.5) * (from - to);
      slot.style.setProperty("--x", (Math.cos(t) * radius).toFixed(1) + "px");
      slot.style.setProperty("--y", (Math.sin(t) * radius).toFixed(1) + "px");
      slot.style.setProperty("--d", i * 18 + "ms");
    });
  }
  function fanIsOpen() {
    return !fan.hidden;
  }
  function openFan() {
    if (fanIsOpen()) return;
    closePop();
    fan.hidden = false;
    layoutFan();
    requestAnimationFrame(() => fan.classList.add("is-open"));
    fanToggle.setAttribute("aria-expanded", "true");
    host().unlock();
  }
  function closeFan(returnFocus) {
    if (!fanIsOpen()) return;
    closePop();
    fan.classList.remove("is-open");
    fan.hidden = true;
    fanToggle.setAttribute("aria-expanded", "false");
    if (returnFocus && fan.contains(document.activeElement)) fanToggle.focus();
  }
  $("studio-fan-close").addEventListener("click", () => {
    closeFan(false);
    fanToggle.focus();
  });
  fanToggle.addEventListener("click", () => {
    if (fanIsOpen()) return closeFan(true);
    openFan();
    const first = fan.querySelector(".studio-fan-item:not([disabled])");
    if (first) first.focus();
  });
  let holdTimer = null;
  let holdOpened = false;
  recHub.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button > 0) return;
    holdOpened = false;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      holdOpened = true;
      if (navigator.vibrate) try { navigator.vibrate(12); } catch (err) { /* no buzz */ }
      openFan();
    }, 420);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((t) => recHub.addEventListener(t, () => clearTimeout(holdTimer)));
  recHub.addEventListener("contextmenu", (e) => e.preventDefault());
  // The press that opened the fan is not a tap on Rec.
  recHub.addEventListener("click", (e) => {
    if (holdOpened) {
      holdOpened = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    } else closeFan(false);
  }, true);
  document.addEventListener("pointerdown", (e) => {
    if (fanIsOpen() && !e.target.closest("#studio-fan, #studio-rec, #studio-fan-btn")) closeFan(false);
  });
  studio.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && fanIsOpen() && !openPop) {
      e.stopPropagation();
      closeFan(true);
    }
  });
  window.addEventListener("resize", () => { if (fanIsOpen()) layoutFan(); });
  // The fan's undo, redo and clear press the same buttons the open track's card has.
  $("studio-fan-undo").addEventListener("click", () => $("song-undo").click());
  $("studio-fan-redo").addEventListener("click", () => $("song-redo").click());
  $("studio-fan-clear").addEventListener("click", () => {
    const clear = $("studio-clear");
    if (clear) clear.click();
    closeFan(true);
  });
  $("studio-rec").addEventListener("click", () => {
    const box = $("song-record");
    box.checked = !box.checked;
    fire(box, "change");
    // With "from the top" on, arming Rec starts the song again from the beginning (while it plays, or paused part-way).
    if (box.checked && recTop) {
      const h = host();
      const wasPlaying = h.playing();
      if (wasPlaying) h.stop();
      h.forget();
      if (wasPlaying) {
        followPaused = false;
        h.unlock();
        $("song-play").click();
      }
    }
    syncTransport();
  });
  $("studio-rec-top").addEventListener("click", () => {
    recTop = !recTop;
    setPref("songRecTop", recTop ? "1" : "0");
    syncTransport();
    $("studio-live").textContent = recTop ? "Recording will start from the beginning every time." : "Recording will start from where the song is.";
  });
  $("studio-follow").addEventListener("click", () => {
    followOn = !followOn;
    setPref("songFollow", followOn ? "1" : "0");
    followPaused = false;
    syncTransport();
    $("studio-live").textContent = followOn ? "The editor follows the music." : "The editor stays where it is.";
  });
  // Quantize shows what it is set to; a tap moves on to the next (the grid is sixteen steps, so these are the ones that land on it).
  const QUANT = [
    [1, "1/16", "nearest sixteenth (one step)"],
    [2, "1/8", "nearest eighth"],
    [4, "1/4", "nearest beat"],
    [0, "Off", "off: the step that is sounding"],
  ];
  $("studio-quant-btn").addEventListener("click", () => {
    const at = QUANT.findIndex((q) => q[0] === host().quantize());
    const next = QUANT[(at + 1) % QUANT.length];
    host().setQuantize(String(next[0]));
    syncTransport();
    $("studio-live").textContent = `Quantize ${next[2]}`;
  });
  $("studio-metro").addEventListener("click", (e) => togglePop(e.currentTarget, $("studio-pop-metro")));
  $("studio-metro-on").addEventListener("change", () => {
    $("song-metronome-on").click();
    syncTransport();
  });
  $("studio-metro-vol").addEventListener("input", (e) => {
    $("song-metronome-volume").value = e.target.value;
    fire($("song-metronome-volume"), "input");
    $("studio-metro-out").textContent = e.target.value;
  });
  $("studio-count-in").addEventListener("change", (e) => {
    $("song-count-in").value = e.target.value;
    fire($("song-count-in"), "change");
  });
  $("studio-volume-btn").addEventListener("click", (e) => togglePop(e.currentTarget, $("studio-pop-volume")));
  $("studio-volume").addEventListener("input", (e) => {
    $("song-master-volume").value = e.target.value;
    fire($("song-master-volume"), "input");
    $("studio-volume-out").textContent = e.target.value;
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
    [playBtn, $("studio-sheet-play")].forEach((b) => {
      b.querySelector(".studio-ico-play").toggleAttribute("hidden", playing);
      b.querySelector(".studio-ico-pause").toggleAttribute("hidden", !playing);
    });
    $("studio-sheet-play").setAttribute("aria-label", playing ? "Pause" : paused ? "Carry on" : "Play");
    playBtn.classList.toggle("studio-playing", playing);
    $("studio-stop").disabled = !playing && !paused;
    $("studio-fan-stop").disabled = !playing && !paused;
    $("studio-rec").setAttribute("aria-pressed", String($("song-record").checked));
    $("studio-rec-top").setAttribute("aria-pressed", String(recTop));
    $("studio-follow").setAttribute("aria-pressed", String(followOn));
    const quant = QUANT.find((q) => q[0] === host().quantize()) || QUANT[0];
    $("studio-quant-value").textContent = quant[1];
    $("studio-quant-btn").setAttribute("aria-label", `Quantize: ${quant[1]}. Tap for the next setting`);
    $("studio-quant-btn").classList.toggle("is-set", host().quantize() !== 1);
    const metro = $("song-metronome-on").checked;
    $("studio-metro").setAttribute("aria-pressed", String(metro));
    $("studio-metro-on").checked = metro;
    if (document.activeElement !== $("studio-volume")) {
      $("studio-volume").value = $("song-master-volume").value;
      $("studio-volume-out").textContent = $("song-master-volume").value;
    }
    if (document.activeElement !== $("studio-metro-vol")) {
      $("studio-metro-vol").value = $("song-metronome-volume").value;
      $("studio-metro-out").textContent = $("song-metronome-volume").value;
    }
    if (document.activeElement !== $("studio-count-in")) $("studio-count-in").value = $("song-count-in").value;
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
  $("studio-midi").addEventListener("click", () => $("song-midi-connect").click());
  function syncTop() {
    if (document.activeElement !== nameEl) nameEl.value = $("song-name").value;
    const text = $("song-autosave-status").textContent.trim();
    const status = $("studio-status");
    if (status.textContent !== text) status.textContent = text;
    $("studio-save").dataset.state = /unsaved/i.test(text) ? "dirty" : /saved/i.test(text) ? "saved" : "";
    // The row of open-song tabs only matters when there are several.
    modal.classList.toggle("studio-multi-tabs", $("song-tabs").querySelectorAll(".song-tab").length > 1);
    // MIDI: the button shows once the browser can do it, and says what is connected.
    const midi = $("song-midi-connect");
    const mb = $("studio-midi");
    mb.hidden = midi.hidden;
    const connected = midi.disabled;
    mb.dataset.state = connected ? "on" : "";
    mb.setAttribute("aria-pressed", String(connected));
    mb.textContent = connected && /\d/.test(midi.textContent) ? "MIDI ✓" : "MIDI";
    mb.title = connected ? midi.title || "MIDI connected" : "Connect a MIDI keyboard or pad controller: its notes play and, with Rec on, record";
    if (midi.textContent.includes("No MIDI")) mb.title = "No MIDI device found. Plug one in and it is picked up.";
  }

  // ---------- the tools sheet ----------
  // The builder's own controls, moved here (ids and all) so each keeps working as it always did; only the ones with no Studio version.
  const sheet = $("studio-sheet");
  const sheetTabs = sheet.querySelector(".studio-sheet-tabs");
  const sheetBody = sheet.querySelector(".studio-sheet-body");
  // On the Studio page (not the owner's dialog) a wide screen shows the open track's sound in a panel beside the music, instead of in the
  // sheet: the Sound pane is moved there (ids, handlers and all) and moved back when the screen gets narrow. It is always built, and the page's
  // stylesheet shows it from 1280 px (matching `wide` below); `soundHomed` says whether the pane is in it right now.
  const pageMode = Boolean(studio.closest(".app-native"));
  const wide = window.matchMedia("(min-width: 1280px)");
  const soundPanel = document.createElement("aside");
  soundPanel.id = "studio-sound-panel";
  soundPanel.className = "studio-panel studio-sound-panel";
  soundPanel.setAttribute("aria-label", "Sound of the open track");
  soundPanel.innerHTML =
    `<div class="studio-panel-head"><h2 id="studio-sound-panel-title">Sound</h2>` +
    `<button type="button" class="studio-panel-fold" data-no-history aria-expanded="true" aria-controls="studio-sound-panel-body" aria-label="Hide the sound panel" title="Hide the sound panel">→</button></div>` +
    `<div id="studio-sound-panel-body" class="studio-panel-body"></div>` +
    `<button type="button" class="studio-panel-handle" data-no-history aria-expanded="false" aria-controls="studio-sound-panel-body" title="Show the sound panel"><span>Sound</span></button>`;
  const soundPanelBody = soundPanel.querySelector(".studio-panel-body");
  if (pageMode) studio.append(soundPanel);
  let soundHomed = false;
  let soundFolded = lsGet("studio.soundPanel", "") === "folded";
  // The Sound pane's own controls answer to whichever of the two it is in.
  const onSound = (type, fn) => [sheetBody, soundPanelBody].forEach((root) => root.addEventListener(type, fn));
  const PANES = [
    { id: "sound", label: "Sound" },
    { id: "tools", label: "Track" },
    { id: "song", label: "Song" },
    { id: "arrange", label: "Patterns" },
    { id: "share", label: "Share" },
  ];
  const panes = {};
  let sheetTab = "song";
  let sheetBuilt = false;
  const section = (title, hint) => {
    const el = document.createElement("section");
    el.className = "studio-section";
    el.innerHTML = `<h3>${esc(title)}</h3>${hint ? `<p class="studio-section-hint">${esc(hint)}</p>` : ""}`;
    return el;
  };
  const row = (...nodes) => {
    const el = document.createElement("div");
    el.className = "studio-section-row";
    nodes.filter(Boolean).forEach((n) => el.append(n));
    return el;
  };
  const labelOf = (id) => ($(id) ? $(id).closest("label") || $(id) : null);
  function buildSheet() {
    if (sheetBuilt) return;
    sheetBuilt = true;
    PANES.forEach((p, i) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "studio-sheet-tab";
      tab.dataset.pane = p.id;
      tab.dataset.noHistory = "";
      tab.id = "studio-tab-" + p.id;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "studio-pane-" + p.id);
      tab.textContent = p.label;
      sheetTabs.append(tab);
      const pane = document.createElement("div");
      pane.className = "studio-pane";
      pane.id = "studio-pane-" + p.id;
      pane.setAttribute("role", "tabpanel");
      pane.setAttribute("aria-labelledby", tab.id);
      pane.hidden = i !== 0;
      sheetBody.append(pane);
      panes[p.id] = pane;
    });

    // Song: tempo, length, feel, the scale, the mix, notes.
    const feel = section("Tempo and feel", "Swing, humanize, space, echo and pump shape the whole song.");
    const lenField = document.createElement("label");
    lenField.className = "studio-song-length";
    lenField.innerHTML = `Length in bars <input type="number" id="studio-song-bars" min="1" max="${Engine.MAX_BARS}" step="1" inputmode="numeric" data-no-reset placeholder="Auto" aria-describedby="studio-song-bars-hint"><span id="studio-song-bars-hint" class="studio-section-hint">Empty: the song is as long as the music in it. A number: it loops after that many bars.</span>`;
    feel.append(
      row(labelOf("song-tempo"), $("song-tap-tempo"), $("song-tap-status")),
      row(lenField),
      row(labelOf("song-humanize"), labelOf("song-swing"), labelOf("song-space"), labelOf("song-echo"), labelOf("song-pump"))
    );
    const metroSec = section("Metronome");
    metroSec.append(row($("song-metronome-sound"), labelOf("song-metronome-accent")));
    const mix = section("Mix", "A level for the whole song. Normalize sets a safe volume from one pass of the real sound.");
    mix.append(row($("song-normalize-peak")), row(document.querySelector(".song-meter-group")));
    const notes = section("Notes and templates");
    notes.append(row(document.querySelector(".song-notes-section")), row($("save-song-template-btn")));
    panes.song.append(feel, metroSec, mix, notes);

    // Patterns: the builder's own arrangement section (patterns, song order, copy).
    const arrange = section("Patterns and song order", "Every pattern holds one bar for each track. The song order plays patterns one after another. A track's own bars (the strip under its name) can differ from it.");
    arrange.append(row($("song-arrangement")));
    panes.arrange.append(arrange);

    // Track tools: for the drums, or for the notes of the open track.
    const toolsDrums = document.createElement("div");
    toolsDrums.id = "studio-tools-drums";
    const dt = section("Drum tools", "These work on the bar being edited. Apply to chooses which sounds they change.");
    dt.append(row(document.querySelector('[aria-label="Drum pattern tools"]')), row($("song-generators")));
    toolsDrums.append(dt);
    const toolsNotes = document.createElement("div");
    toolsNotes.id = "studio-tools-notes";
    const nt = section("Notes", "These work on the bar being edited, for the open track.");
    const scaleSec = section("Scale", "Mark the notes of a key in the roll and on the keys. With snapping on, notes you play or tap move to the nearest note of the scale; off, every note is free.");
    const snap = document.createElement("label");
    snap.className = "studio-check";
    snap.innerHTML = `<input type="checkbox" id="studio-snap"> Snap notes to the scale`;
    scaleSec.append(row($("song-scale-root"), $("song-scale-type"), snap));
    const tr = document.querySelector("#song-transpose-octave-down");
    nt.append(row(tr ? tr.closest(".song-transpose-controls") : null), row($("song-melody-tools")));
    toolsNotes.append(scaleSec, nt);
    const strength = section("Step strength", "How hard the next step you place is struck, in the drums and the roll. Click a step again to change its strength.");
    strength.append(row($("song-step-level").closest(".song-pattern-tools")));
    panes.tools.append(strength, toolsDrums, toolsNotes);
    if ($("song-melody-tools")) $("song-melody-tools").open = true;

    // Share: how the song looks on the page, the preview, files and export.
    const look = section("On the page", "How the song's player looks where you put it.");
    look.append(row($("song-visualization"), $("song-theme"), labelOf("song-page-sync")));
    const prev = section("Preview");
    prev.append(row($("song-preview-fold")), row($("song-clip-status")));
    const exp = section("Export", "Files and renders of this song.");
    exp.append(row($("song-export-report"), $("song-export-audio"), $("song-export-midi"), $("song-export-json")), row($("song-file-status")), row($("song-generate-cover-art"), $("song-snapshot-mix")));
    panes.share.append(look, prev, exp);

    // Everything else stays in the builder, hidden: the selects the Sound tab drives, the roll's own buttons, the rows and the grids.
    sheetTabs.addEventListener("click", (e) => {
      const tab = e.target.closest && e.target.closest(".studio-sheet-tab");
      if (tab) showPane(tab.dataset.pane);
    });
    sheetTabs.addEventListener("keydown", (e) => {
      const ids = PANES.map((p) => p.id);
      const at = ids.indexOf(sheetTab);
      let to = null;
      if (e.key === "ArrowRight") to = ids[(at + 1) % ids.length];
      else if (e.key === "ArrowLeft") to = ids[(at + ids.length - 1) % ids.length];
      if (!to) return;
      e.preventDefault();
      showPane(to);
      const tab = $("studio-tab-" + to);
      if (tab) tab.focus();
    });
    sheetBody.addEventListener("change", (e) => {
      if (e.target.id === "studio-snap") {
        host().setSnap(e.target.checked);
        gridSig = "";
        keysSig = "";
        refresh();
      } else if (e.target.id === "studio-song-bars") {
        host().arr.setBars(e.target.value === "" ? null : Number(e.target.value));
        refresh();
      }
    });
  }
  function showPane(id) {
    sheetTab = id;
    PANES.forEach((p) => {
      const on = p.id === id;
      if (!(p.id === "sound" && soundHomed)) panes[p.id].hidden = !on;
      const tab = $("studio-tab-" + p.id);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      tab.classList.toggle("is-active", on);
    });
    $("studio-sheet-title").textContent = PANES.find((p) => p.id === id).label;
    syncSheet();
  }
  let sheetReturn = null;
  // Put the Sound pane where it belongs for this width: the panel on a wide Studio page, the sheet otherwise.
  function placeSound() {
    if (!sheetBuilt) return;
    soundHomed = pageMode && wide.matches && !legacy;
    const home = soundHomed ? soundPanelBody : sheetBody;
    if (panes.sound.parentNode !== home) {
      home.append(panes.sound);
      soundSig = "";
    }
    const tab = $("studio-tab-sound");
    if (tab) tab.hidden = soundHomed;
    if (soundHomed) {
      panes.sound.hidden = false;
      if (sheetTab === "sound") showPane("song");
    } else showPane(sheetTab);
    soundPanel.classList.toggle("is-folded", soundHomed && soundFolded);
    studio.classList.toggle("studio-sounds-folded", soundHomed && soundFolded);
    syncSoundFold();
  }
  function syncSoundFold() {
    const fold = soundPanel.querySelector(".studio-panel-fold");
    const handle = soundPanel.querySelector(".studio-panel-handle");
    fold.setAttribute("aria-expanded", String(!soundFolded));
    handle.setAttribute("aria-expanded", String(!soundFolded));
  }
  function foldSound(folded) {
    soundFolded = folded;
    lsSet("studio.soundPanel", folded ? "folded" : "open");
    placeSound();
    gridSig = "";
    refresh();
  }
  soundPanel.addEventListener("click", (e) => {
    if (e.target.closest(".studio-panel-fold")) {
      foldSound(true);
      soundPanel.querySelector(".studio-panel-handle").focus();
    } else if (e.target.closest(".studio-panel-handle")) {
      foldSound(false);
      soundPanel.querySelector(".studio-panel-fold").focus();
    }
  });
  if (wide.addEventListener) wide.addEventListener("change", () => { placeSound(); refresh(); });
  // The panel shows the open track's sound and follows the track chosen on the left.
  function syncSoundPanel() {
    if (!soundHomed || soundFolded) return;
    const track = trackOf(trackId);
    $("studio-sound-panel-title").textContent = `${track.name} sound`;
    soundPanel.style.setProperty("--panel-color", `var(--track-${track.n})`);
    renderSound();
  }
  function openSheet(id) {
    if (id === "sound" && soundHomed) {
      // the sound is in the panel: open it if it was folded, and put the focus on its first control
      if (soundFolded) foldSound(false);
      const first = panes.sound.querySelector("button, select, input");
      if (first) first.focus();
      return;
    }
    buildSheet();
    sheetReturn = document.activeElement;
    closePop();
    sheet.hidden = false;
    placeSheet();
    studio.classList.add("studio-sheet-on");
    showPane(id || sheetTab);
    const first = panes[sheetTab].querySelector("select, input, button");
    const close = $("close-studio-sheet");
    (first || close).focus();
  }
  // On a phone the sheet is a dropdown under the Tools button, with a little pointer to it; elsewhere it is the panel it always was.
  const phoneSheet = () => window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  function placeSheet() {
    if (!phoneSheet()) return;
    const sr = studio.getBoundingClientRect();
    const tr = $("studio-tools").getBoundingClientRect();
    sheet.style.setProperty("--sheet-top", Math.round(tr.bottom - sr.top + 8) + "px");
    sheet.style.setProperty("--sheet-caret", Math.max(14, Math.round(sr.right - 8 - (tr.left + tr.width / 2) - 6)) + "px");
  }
  window.addEventListener("resize", () => { if (!sheet.hidden) placeSheet(); });
  document.addEventListener("pointerdown", (e) => {
    if (sheet.hidden || !phoneSheet()) return;
    if (sheet.contains(e.target) || $("studio-tools").contains(e.target) || (e.target.closest && e.target.closest(".modal:not(#song-builder-modal), .dial-face"))) return;
    closeSheet();
  });
  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    studio.classList.remove("studio-sheet-on");
    if (sheetReturn && document.contains(sheetReturn) && sheetReturn.focus) sheetReturn.focus();
    sheetReturn = null;
    refresh();
  }
  $("studio-tools").addEventListener("click", () => (sheet.hidden ? openSheet() : closeSheet()));
  $("studio-sheet-help").addEventListener("click", () => $("studio-help").click());
  $("close-studio-sheet").addEventListener("click", closeSheet);
  sheet.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeSheet();
    }
  });
  // What the open sheet shows about the song and the open track, kept current.
  function syncSheet() {
    if (sheet.hidden || !sheetBuilt) return;
    const s = song();
    const track = trackOf(trackId);
    $("studio-tools-drums").hidden = track.kind !== "drums";
    $("studio-tools-notes").hidden = track.kind === "drums";
    const sc = scaleSet();
    const snap = $("studio-snap");
    if (snap) {
      snap.checked = Boolean(sc && sc.snap);
      snap.disabled = !sc;
      snap.title = sc ? "" : "Choose a scale first";
    }
    const bars = $("studio-song-bars");
    if (bars && document.activeElement !== bars) bars.value = s.bars ? String(s.bars) : "";
    if (sheetTab === "sound") renderSound();
    $("studio-sheet-title").textContent = panes[sheetTab] ? (sheetTab === "sound" || sheetTab === "tools" ? `${track.name} ${sheetTab === "sound" ? "sound" : "tools"}` : PANES.find((p) => p.id === sheetTab).label) : "Tools";
  }

  // ---------- the Sound tab: the instrument and its shape, or the kit and each drum sound ----------
  // sustain, attack and the rest are the named sound's own values until a track tweaks one (then it is saved with the song).
  const KNOBS = [
    { key: "attack", label: "Attack", min: 0.001, max: 2, log: true, unit: "s", hint: "How slowly the note fades in" },
    { key: "decay", label: "Decay", min: 0.02, max: 3, log: true, unit: "s", hint: "How long it takes to settle" },
    { key: "sustain", label: "Sustain", min: 0, max: 1, unit: "%", hint: "How loud it stays while held; 0 is a struck note that just rings out" },
    { key: "release", label: "Release", min: 0, max: 3, unit: "s", sqrt: true, hint: "How long it rings after the note ends" },
    { key: "cutoff", label: "Brightness", min: 120, max: 12000, log: true, unit: "Hz", hint: "The filter's cutoff: lower is darker" },
    { key: "res", label: "Resonance", min: 0.1, max: 18, log: true, unit: "q", hint: "How sharply the filter rings at its cutoff: higher is more vocal or squelchy" },
    { key: "sweep", label: "Filter sweep", min: -1, max: 1, unit: "sweep", hint: "Right: the filter closes over each note (a pluck). Left: it opens (a swell)" },
    { key: "detune", label: "Thickness", min: 0, max: 40, unit: "cents", hint: "How far the stacked copies are tuned apart, for width" },
    { key: "unison", label: "Voices", min: 1, max: 7, unit: "voices", int: true, hint: "How many copies of the sound are stacked" },
    { key: "sub", label: "Sub", min: 0, max: 1, unit: "%", hint: "A pure tone an octave below, for weight" },
    { key: "noise", label: "Noise", min: 0, max: 1, unit: "%", hint: "Breath or hiss mixed in, shaped by the filter" },
    { key: "drive", label: "Drive", min: 0, max: 1, unit: "%", hint: "Gentle distortion that fattens and grits the sound" },
    { key: "fm", label: "FM bite", min: 0, max: 1, unit: "%", hint: "A second tone bends this one, bright at the start and mellowing as it rings: electric pianos and bells" },
    { key: "fmratio", label: "FM pitch", min: 0.5, max: 8, log: true, unit: "x", hint: "How high the bending tone is, as a multiple of the note: whole numbers are smooth, others are clangy" },
    { key: "vibrato", label: "Vibrato", min: 0, max: 60, unit: "cents", hint: "A slow wobble in the pitch" },
    { key: "vrate", label: "Vibrato speed", min: 0.5, max: 12, log: true, unit: "Hz1", hint: "How fast the pitch wobbles" },
    { key: "tremolo", label: "Tremolo", min: 0, max: 1, unit: "%", hint: "A wobble in the loudness" },
    { key: "trate", label: "Tremolo speed", min: 0.5, max: 14, log: true, unit: "Hz1", hint: "How fast the loudness wobbles" },
  ];
  // How the knobs are grouped on the Sound tab.
  const KNOB_GROUPS = [
    { title: "Envelope", hint: "the shape of each note", keys: ["attack", "decay", "sustain", "release"], open: true },
    { title: "Filter", hint: "brightness and bite", keys: ["cutoff", "res", "sweep"], filter: true, open: true },
    { title: "Tone", hint: "width, weight and grit", keys: ["detune", "unison", "sub", "noise", "drive", "fm", "fmratio"] },
    { title: "Movement", hint: "vibrato and tremolo", keys: ["vibrato", "vrate", "tremolo", "trate"] },
  ];
  const SYNTH_KEYS_ALL = ["wave", "ftype"].concat(KNOBS.map((k) => k.key));
  const DRUM_KNOBS = [
    { key: "tune", label: "Tune", min: -12, max: 12, unit: "st", def: 0, hint: "The pitch of this sound, in semitones" },
    { key: "decay", label: "Length", min: 0.3, max: 3, log: true, unit: "len", def: 1, hint: "How long this sound rings, against the kit's own" },
    { key: "tone", label: "Tone", min: -1, max: 1, unit: "tone", def: 0, hint: "Duller to the left, brighter to the right (on kicks and toms it is the punch of the pitch drop)" },
  ];
  const fromSlider = (k, t) => (k.log ? k.min * Math.pow(k.max / k.min, t) : k.sqrt ? k.min + (k.max - k.min) * t * t : k.min + (k.max - k.min) * t);
  const toSlider = (k, v) => (k.log ? Math.log(Math.max(k.min, v) / k.min) / Math.log(k.max / k.min) : k.sqrt ? Math.sqrt(Math.max(0, (v - k.min) / (k.max - k.min))) : (v - k.min) / (k.max - k.min));
  const signed = (n) => (n > 0 ? "+" : "") + n;
  const fmt = (k, v) => {
    switch (k.unit) {
      case "%": return `${Math.round(v * 100)}%`;
      case "Hz": return `${Math.round(v)} Hz`;
      case "Hz1": return `${v.toFixed(1)} Hz`;
      case "s": return `${v < 0.1 ? v.toFixed(3) : v.toFixed(2)} s`;
      case "q": return v.toFixed(1);
      case "x": return `${v.toFixed(2)}×`;
      case "voices": return String(Math.round(v));
      case "sweep": return `${signed(Math.round(v * 100))}%`;
      case "st": return `${signed(Math.round(v * 10) / 10)} st`;
      case "len": return `${Math.round(v * 100)}%`;
      case "tone": return `${signed(Math.round(v * 100))}%`;
      default: return `${Math.round(v)} ${k.unit}`;
    }
  };
  // The value a knob shows: the track's tweak, else what the named sound has.
  function knobValue(k, voice, synth) {
    if (synth[k.key] !== undefined) return synth[k.key];
    const v = (voice && Engine.MELODY_VOICES[voice]) || {};
    switch (k.key) {
      case "vibrato": return v.vibrato ? v.vibrato.cents : 0;
      case "vrate": return v.vibrato ? v.vibrato.rate : 5.5;
      case "tremolo": return v.tremolo ? v.tremolo.depth : 0;
      case "trate": return v.tremolo ? v.tremolo.rate : 5;
      case "fm": return v.fm ? v.fm.depth : 0;
      case "fmratio": return v.fm ? v.fm.ratio : 1;
      case "cutoff": return v.cutoff || k.max;
      case "res": return v.q || 1;
      case "unison": return v.unison || (v.detune ? 3 : 1);
      case "sweep": return v.cutoffEnd && v.cutoff ? Math.max(-1, Math.min(1, -Math.log2(v.cutoffEnd / v.cutoff) / 4)) : 0;
      default: return v[k.key] !== undefined ? v[k.key] : k.min;
    }
  }
  let soundSig = "";
  // The instrument and kit browsers (shown in the Sounds panel): every name the menu has, the chosen one pressed. A menu that has groups
  // (the instruments) shows a row of group buttons and the names of one group, the chosen instrument's to start with; a flat one (the kits)
  // shows every name.
  function fillBrowsers(pane) {
    pane.querySelectorAll(".studio-browser").forEach((box) => {
      const sel = pane.querySelector("#" + box.dataset.browse);
      if (!sel) return;
      const groupOf = (value) => {
        const o = [...sel.options].find((x) => x.value === value);
        return o && o.parentNode.tagName === "OPTGROUP" ? o.parentNode.label : "";
      };
      // follow the chosen instrument into its group when it changes (from the menu, a preset, a new song), else keep the group the visitor is in
      if (box.dataset.value !== sel.value) {
        box.dataset.value = sel.value;
        const g = groupOf(sel.value);
        if (g) box.dataset.group = g;
        box.dataset.filled = "";
      }
      const sig = sel.innerHTML + "|" + (box.dataset.group || "");
      if (box.dataset.filled !== sig) {
        box.dataset.filled = sig;
        const btn = (o) => `<button type="button" class="studio-pick" data-pick="${esc(o.value)}" data-no-history aria-pressed="false">${esc(o.textContent)}</button>`;
        const groups = [...sel.children].filter((c) => c.tagName === "OPTGROUP");
        const loose = [...sel.children].filter((c) => c.tagName !== "OPTGROUP");
        const shown = groups.find((g) => g.label === box.dataset.group) || groups[0];
        let html = "";
        if (loose.length) html += `<div class="studio-picks">${loose.map(btn).join("")}</div>`;
        if (groups.length) {
          html += `<div class="studio-pick-tabs" role="group" aria-label="Kinds of sound">${groups
            .map((g) => `<button type="button" class="studio-pick-tab" data-group="${esc(g.label)}" data-no-history aria-pressed="${g === shown}">${esc(g.label)}</button>`)
            .join("")}</div>`;
          html += `<div class="studio-picks">${[...shown.children].map(btn).join("")}</div>`;
        }
        box.innerHTML = html;
      }
      box.querySelectorAll("[data-pick]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pick === sel.value)));
    });
  }
  function renderSound() {
    const pane = panes.sound;
    const s = song();
    const track = trackOf(trackId);
    const rows = drumRows(s);
    if (track.kind === "drums" && !rows.includes(soundRow)) soundRow = rows[0];
    const sig = [track.id, rows.join(), track.kind === "drums" ? soundRow : ""].join("|");
    if (sig !== soundSig) {
      soundSig = sig;
      pane.innerHTML = track.kind === "drums" ? drumSoundHtml(rows) : noteSoundHtml(track);
      pane.querySelectorAll("select[data-src]").forEach((sel) => (sel.dataset.filled = ""));
    }
    pane.querySelectorAll("select[data-src]").forEach((sel) => {
      const src = $(sel.dataset.src);
      if (sel.dataset.filled !== src.innerHTML) {
        sel.innerHTML = src.innerHTML;
        sel.dataset.filled = src.innerHTML;
      }
      if (sel.value !== src.value) sel.value = src.value;
    });
    fillBrowsers(pane);
    if (track.kind === "drums") {
      pane.querySelectorAll("[data-sound]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sound === soundRow)));
      const vol = pane.querySelector("#studio-sound-vol");
      if (vol && document.activeElement !== vol) vol.value = Math.round(Engine.volumeOf(meta(s, soundRow)) * 100);
      const shape = host().drum(soundRow);
      pane.querySelectorAll("[data-dknob]").forEach((input) => {
        const k = DRUM_KNOBS.find((x) => x.key === input.dataset.dknob);
        const value = shape[k.key] !== undefined ? shape[k.key] : k.def;
        if (document.activeElement !== input) input.value = String(Math.round(toSlider(k, value) * 1000));
        const out = pane.querySelector(`[data-dout="${k.key}"]`);
        if (out) {
          out.textContent = fmt(k, value);
          out.classList.toggle("is-tweaked", shape[k.key] !== undefined);
        }
      });
      const resetDrum = pane.querySelector("#studio-sound-reset");
      if (resetDrum) resetDrum.disabled = !Object.keys(shape).length;
      const mute = pane.querySelector("#studio-sound-mute");
      if (mute) {
        mute.setAttribute("aria-pressed", String(meta(s, soundRow).muted === true));
        mute.textContent = meta(s, soundRow).muted === true ? `${ROW_LABELS[soundRow]} is muted` : `Mute ${ROW_LABELS[soundRow]}`;
      }
      const realColor = $("song-sequencer").querySelector(`.song-track-color[data-row="${soundRow}"]`);
      const color = pane.querySelector("#studio-sound-color");
      if (color && realColor && document.activeElement !== color) color.value = realColor.value;
      const realNote = $("song-sequencer").querySelector(`.song-track-note[data-row="${soundRow}"]`);
      const note = pane.querySelector("#studio-sound-note");
      if (note && realNote && document.activeElement !== note) note.value = realNote.value;
      const remove = pane.querySelector("#studio-sound-remove");
      if (remove) remove.hidden = !["openhat", "rim", "tom", "crash"].includes(soundRow); // the four core sounds stay
      const add = pane.querySelector("#studio-add");
      const left = ["openhat", "rim", "tom", "crash"].filter((r) => !(s.tracks && s.tracks[r]));
      if (add && add.options.length !== left.length) add.innerHTML = left.map((r) => `<option value="${r}">${ROW_LABELS[r]}</option>`).join("");
      const addBtn = pane.querySelector("#studio-add-btn");
      if (addBtn) addBtn.disabled = !left.length;
      return;
    }
    const part = partOf(s, track);
    const synth = host().synth(track.id);
    const voice = voiceOf(s, track);
    const basic = !voice;
    const filterMenu = pane.querySelector("#studio-synth-ftype");
    if (filterMenu) filterMenu.disabled = basic;
    pane.querySelectorAll("[data-knob]").forEach((input) => {
      const k = KNOBS.find((x) => x.key === input.dataset.knob);
      const value = knobValue(k, voice, synth);
      if (document.activeElement !== input) input.value = String(Math.round(toSlider(k, value) * 1000));
      input.disabled = basic;
      const out = pane.querySelector(`[data-out="${k.key}"]`);
      if (out) {
        out.textContent = fmt(k, value);
        out.classList.toggle("is-tweaked", synth[k.key] !== undefined);
      }
    });
    const ftype = pane.querySelector("#studio-synth-ftype");
    if (ftype) ftype.value = synth.ftype || (voice && Engine.MELODY_VOICES[voice].ftype) || "lowpass";
    const wave = pane.querySelector("#studio-synth-wave");
    if (wave) wave.value = track.part === "melody" && basic ? (s.melody && s.melody.waveform) || "sine" : synth.wave || (voice && Engine.MELODY_VOICES[voice].wave) || "sine";
    const vol = pane.querySelector("#studio-sound-vol");
    if (vol && document.activeElement !== vol) vol.value = Math.round(Engine.volumeOf(part) * 100);
    const reset = pane.querySelector("#studio-synth-reset");
    if (reset) reset.disabled = !Object.keys(synth).length;
    const note = pane.querySelector("#studio-synth-note");
    if (note) note.hidden = !basic;
  }
  function noteSoundHtml(track) {
    const source = { melody: "song-voice", bass: "song-bass-voice", chords: "song-part-voice", lead: "song-part-voice" }[track.part];
    const knob = (k) =>
      `<label class="studio-knob" title="${esc(k.hint)}"><span class="studio-knob-name">${k.label}</span><output data-out="${k.key}"></output>` +
      `<input type="range" min="0" max="1000" step="1" data-knob="${k.key}" data-no-reset aria-label="${k.label}: ${esc(k.hint)}"></label>`;
    const folds = KNOB_GROUPS.map((g) => {
      const filterType = g.filter
        ? `<label class="studio-field studio-field-wide">Filter type<select id="studio-synth-ftype" aria-label="Filter type"><option value="lowpass">Low-pass (darken)</option><option value="highpass">High-pass (thin)</option><option value="bandpass">Band-pass (hollow)</option></select></label>`
        : "";
      return (
        `<details class="studio-fold"${g.open ? " open" : ""}><summary>${g.title}<small>${g.hint}</small></summary>${filterType}` +
        `<div class="studio-knobs">${g.keys.map((key) => knob(KNOBS.find((k) => k.key === key))).join("")}</div></details>`
      );
    }).join("");
    const waves = Engine.SYNTH_WAVES.map((w) => `<option value="${w}">${w.charAt(0).toUpperCase() + w.slice(1)}</option>`).join("");
    return (
      `<section class="studio-section"><h3>Instrument</h3>` +
      `<div class="studio-browser" data-browse="studio-voice" role="group" aria-label="${esc(track.name)} instruments"></div>` +
      `<div class="studio-section-row"><label class="studio-field studio-browse-select">Instrument<select id="studio-voice" data-src="${source}" aria-label="${esc(track.name)} instrument"></select></label>` +
      `<label class="studio-field">Wave<select id="studio-synth-wave" aria-label="Wave shape">${waves}</select></label></div>` +
      `<p id="studio-synth-note" class="studio-section-hint">Basic is a plain wave. Pick an instrument to shape how it starts, rings and sounds.</p>` +
      `<div class="studio-section-row"><button type="button" class="studio-mini" data-hear data-no-history>Preview</button>` +
      `<button type="button" id="studio-synth-reset" class="studio-mini" data-no-history title="Back to the instrument's own settings">Reset the sound</button></div></section>` +
      `<section class="studio-section studio-folds"><h3>Shape the sound</h3>${folds}</section>` +
      `<section class="studio-section"><h3>Level</h3><label class="studio-vol-inline"><span>Volume</span><input type="range" id="studio-sound-vol" min="0" max="100" data-no-reset aria-label="${esc(track.name)} volume"></label>` +
      `<button type="button" class="studio-mini" data-mute-track data-no-history>Mute ${esc(track.name)}</button></section>`
    );
  }
  function drumSoundHtml(rows) {
    const chips = rows.map((r) => `<button type="button" class="studio-chip" data-sound="${r}" data-no-history aria-pressed="false">${ROW_LABELS[r]}</button>`).join("");
    return (
      `<section class="studio-section"><h3>Drum kit</h3><div class="studio-browser" data-browse="studio-kit" role="group" aria-label="Drum kits"></div><div class="studio-section-row"><label class="studio-field studio-browse-select">Kit for every drum sound<select id="studio-kit" data-src="song-kit" aria-label="Drum kit"></select></label></div></section>` +
      `<section class="studio-section"><h3>Each sound</h3><p class="studio-section-hint">Pick a sound, then set its volume, tune, length and tone, or mute it.</p>` +
      `<div class="studio-chips" role="group" aria-label="Drum sound">${chips}</div>` +
      `<div class="studio-section-row"><label class="studio-vol-inline"><span>Volume</span><input type="range" id="studio-sound-vol" min="0" max="100" data-no-reset aria-label="Volume of the chosen drum sound"></label></div>` +
      `<div class="studio-knobs">${DRUM_KNOBS.map((k) => `<label class="studio-knob" title="${esc(k.hint)}"><span class="studio-knob-name">${k.label}</span><output data-dout="${k.key}"></output><input type="range" min="0" max="1000" step="1" data-dknob="${k.key}" data-no-reset aria-label="${k.label} of the chosen drum sound: ${esc(k.hint)}"></label>`).join("")}</div>` +
      `<div class="studio-section-row"><button type="button" id="studio-sound-reset" class="studio-mini" data-no-history title="Back to the kit's own tune, length and tone for this sound">Reset this sound</button></div>` +
      `<div class="studio-section-row"><button type="button" id="studio-sound-mute" class="studio-mini" aria-pressed="false" data-no-history>Mute</button><button type="button" class="studio-mini" data-hear-drum data-no-history>Preview</button><button type="button" id="studio-sound-remove" class="studio-mini" data-no-history title="Take this sound out of the song (undoable)">Remove this sound</button></div>` +
      `<div class="studio-section-row"><label class="studio-field studio-field-small">Colour<input type="color" id="studio-sound-color" aria-label="Colour of the chosen drum sound"></label><label class="studio-field">Note<input type="text" id="studio-sound-note" maxlength="60" placeholder="A note about this sound" aria-label="Note about the chosen drum sound"></label></div></section>` +
      `<section class="studio-section"><h3>Add a sound</h3><div class="studio-section-row"><label class="studio-field">Sound<select id="studio-add" aria-label="Drum sound to add"></select></label><button type="button" id="studio-add-btn" class="studio-mini" data-no-history>Add</button></div></section>`
    );
  }
  onSound("change", (e) => {
    const t = e.target;
    if (t.matches && t.matches("select[data-src]")) {
      const src = $(t.dataset.src);
      src.value = t.value;
      fire(src, "change");
      soundSig = "";
      refresh();
      if (trackOf(trackId).kind === "notes") host().hear(trackId, HEAR[trackOf(trackId).part]);
      else host().hearDrum(soundRow);
    } else if (t.id === "studio-synth-ftype") {
      host().setSynth(trackId, { ftype: t.value });
      refresh();
      host().hear(trackId, HEAR[trackOf(trackId).part]);
    } else if (t.dataset && t.dataset.dknob) {
      host().hearDrum(soundRow);
    } else if (t.id === "studio-synth-wave") {
      const track = trackOf(trackId);
      if (track.part === "melody" && !voiceOf(song(), track)) {
        $("song-waveform").value = t.value;
        fire($("song-waveform"), "change");
      } else host().setSynth(trackId, { wave: t.value });
      refresh();
      host().hear(trackId, HEAR[track.part]);
    } else if (t.dataset && t.dataset.knob) {
      host().hear(trackId, HEAR[trackOf(trackId).part]);
    }
  });
  onSound("input", (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.knob) {
      const k = KNOBS.find((x) => x.key === t.dataset.knob);
      let raw = fromSlider(k, Number(t.value) / 1000);
      if (k.int) raw = Math.round(raw);
      else if (k.key === "sweep" && Math.abs(raw) < 0.03) raw = 0;
      host().setSynth(trackId, { [k.key]: Math.round(raw * 1000) / 1000 });
      const out = panes.sound.querySelector(`[data-out="${k.key}"]`);
      if (out) {
        out.textContent = fmt(k, raw);
        out.classList.add("is-tweaked");
      }
      panes.sound.querySelector("#studio-synth-reset").disabled = false;
    } else if (t.dataset && t.dataset.dknob) {
      const k = DRUM_KNOBS.find((x) => x.key === t.dataset.dknob);
      let raw = fromSlider(k, Number(t.value) / 1000);
      if (k.key === "tune") raw = Math.round(raw * 10) / 10;
      else if (Math.abs(raw - k.def) < (k.max - k.min) * 0.012) raw = k.def; // a notch at the kit's own value
      raw = Math.round(raw * 1000) / 1000;
      host().setDrum(soundRow, { [k.key]: raw === k.def ? null : raw });
      const out = panes.sound.querySelector(`[data-dout="${k.key}"]`);
      if (out) {
        out.textContent = fmt(k, raw);
        out.classList.toggle("is-tweaked", raw !== k.def);
      }
      const resetDrum = panes.sound.querySelector("#studio-sound-reset");
      if (resetDrum) resetDrum.disabled = !Object.keys(host().drum(soundRow)).length;
    } else if (t.id === "studio-sound-color" || t.id === "studio-sound-note") {
      const real = $("song-sequencer").querySelector(`.song-track-${t.id === "studio-sound-color" ? "color" : "note"}[data-row="${soundRow}"]`);
      if (real) {
        real.value = t.value;
        fire(real, "input");
      }
    } else if (t.id === "studio-sound-vol") {
      const track = trackOf(trackId);
      if (track.kind === "drums") {
        const real = $("song-sequencer").querySelector(`.song-track-volume[data-row="${soundRow}"]`);
        if (real) {
          real.value = t.value;
          fire(real, "input");
        }
      } else {
        $("song-melody-volume").value = t.value;
        fire($("song-melody-volume"), "input");
      }
    }
  });
  onSound("click", (e) => {
    const t = e.target.closest && e.target.closest("button");
    if (!t) return;
    const track = trackOf(trackId);
    if (t.dataset.sound) {
      soundRow = t.dataset.sound;
      host().hearDrum(soundRow);
    } else if (t.id === "studio-sound-mute") {
      const real = $("song-sequencer").querySelector(`.song-track-mute[data-row="${soundRow}"]`);
      if (real) real.click();
    } else if (t.id === "studio-sound-remove") {
      const real = $("song-sequencer").querySelector(`.song-track-remove[data-row="${soundRow}"]`);
      if (real) real.click();
      soundRow = "kick";
      soundSig = "";
      gridSig = "";
      keysSig = "";
    } else if (t.id === "studio-sound-reset") {
      host().setDrum(soundRow, { tune: null, decay: null, tone: null });
      soundSig = "";
      refresh();
      host().hearDrum(soundRow);
    } else if (t.hasAttribute("data-hear-drum")) host().hearDrum(soundRow);
    else if (t.hasAttribute("data-hear")) host().hear(trackId, HEAR[track.part]);
    else if (t.hasAttribute("data-mute-track")) toggleMute(track);
    else if (t.id === "studio-synth-reset") {
      host().setSynth(trackId, Object.fromEntries(SYNTH_KEYS_ALL.map((key) => [key, null])));
      host().hear(trackId, HEAR[track.part]);
    } else if (t.id === "studio-add-btn") {
      $("song-add-drum").value = $("studio-add").value;
      $("song-add-drum-btn").click();
      soundSig = "";
    } else if (t.dataset.group !== undefined && t.closest(".studio-browser")) {
      const box = t.closest(".studio-browser");
      box.dataset.group = t.dataset.group;
      fillBrowsers(panes.sound);
      return;
    } else if (t.dataset.pick !== undefined) {
      // a name in the instrument or kit browser: the same as choosing it in the menu it stands for (which also plays it)
      const sel = panes.sound.querySelector("#" + t.closest(".studio-browser").dataset.browse);
      if (!sel) return;
      sel.value = t.dataset.pick;
      fire(sel, "change");
      return;
    } else return;
    refresh();
  });
  // The tools the sheet moved in from the builder do their work through the builder; the studio just shows what they said.
  sheetBody.addEventListener("click", () => {
    setTimeout(() => {
      gridSig = gridSig; // eslint-disable-line no-self-assign
      refresh();
      showToolNote();
    }, 0);
  });

  // ---------- keeping the layout in step with the builder ----------
  function refresh(opts) {
    if (legacy || modal.hidden) return;
    const h = host();
    const s = song();
    if (!h || !s) return;
    if (opts && opts.opened) {
      trackId = firstTrackWithContent(s);
      Object.keys(barPick).forEach((k) => delete barPick[k]);
      clearPlay();
      closeSheet();
    }
    if (opts && (opts.opened || opts.rebuild)) {
      detailSig = gridSig = keysSig = barsSig = soundSig = "";
      Object.keys(cardSigs).forEach((k) => delete cardSigs[k]);
      showBar(trackOf(trackId));
      syncRoll();
      openHidden(trackOf(trackId));
    }
    const track = trackOf(trackId);
    renderStack(s);
    renderDetail(s);
    buildGrid(track, s);
    paintGrid(s, track);
    syncPager();
    renderKeys(s);
    syncTransport();
    syncTop();
    syncSheet();
    syncSoundPanel();
  }
  // When the steps are wider than the screen (a phone shows half a bar at a time), two buttons say which half is in view and jump to the
  // other; a swipe across the steps does the same.
  function syncPager() {
    const pager = $("studio-pager");
    const scroll = $("studio-grid-scroll");
    if (!pager || !scroll) return;
    const wide = $("studio-grid").dataset.mode === "steps" && scroll.scrollWidth > scroll.clientWidth + 4;
    if (pager.hidden === wide) pager.hidden = !wide;
    if (!wide) return;
    const second = scroll.scrollLeft > (scroll.scrollWidth - scroll.clientWidth) / 2;
    pager.querySelectorAll(".studio-page").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.page) === (second ? 1 : 0))));
    if (!scroll._pagerWired) {
      scroll._pagerWired = true;
      scroll.addEventListener("scroll", () => requestAnimationFrame(syncPager), { passive: true });
    }
  }
  detailEl.addEventListener("click", (e) => {
    const page = e.target.closest && e.target.closest(".studio-page");
    if (!page) return;
    const scroll = $("studio-grid-scroll");
    scroll.scrollTo({ left: page.dataset.page === "1" ? scroll.scrollWidth : 0 });
  });
  window.addEventListener("resize", () => requestAnimationFrame(syncPager));
  let queued = 0;
  const later = () => {
    clearTimeout(queued);
    queued = setTimeout(refresh, 30);
  };
  ["click", "input", "change", "keyup"].forEach((t) => modal.addEventListener(t, later));
  setInterval(() => {
    if (!legacy && !modal.hidden) refresh();
  }, 700);

  if (legacy) {
    modal.classList.remove("song-studio-on");
    studio.hidden = true;
  } else {
    modal.classList.add("song-studio-on");
    studio.hidden = false;
    buildSheet();
    placeSound();
    refresh({ rebuild: true });
  }

  window.SongStudio = {
    refresh(opts) {
      refresh(opts);
    },
    // Called by the builder a little before a step sounds (time is on the audio clock); the lights follow the sound, not the scheduling.
    step(step, time, info) {
      if (legacy || modal.hidden) return;
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
      if (legacy) return;
      clearPlay();
      if (host()) syncTransport();
    },
    // A note played from the computer keyboard or a MIDI device: show it on the keys.
    played(requested) {
      if (legacy) return;
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
    active: () => !legacy && !modal.hidden,
    toggle: togglePlay,
    drumTrackOpen: () => !legacy && trackOf(trackId).kind === "drums",
    // The lane (track) the open card edits, or null.
    openLane: () => (legacy ? null : trackOf(trackId).id),
    select: selectTrack,
    openSheet,
    tracks: TRACKS,
  };
})();
