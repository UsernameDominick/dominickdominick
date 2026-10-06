(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const Engine = window.SongEngine;
  // The instrument and kit menus come from the engine, so a new sound there shows up here without anything else to keep in step.
  (function fillSoundMenus() {
    const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const groups = Engine.VOICE_GROUPS.map((group) => `<optgroup label="${escape(group.label)}">${group.voices.map((name) => `<option value="${name}">${escape(Engine.MELODY_VOICES[name].label)}</option>`).join("")}</optgroup>`).join("");
    $("song-voice").innerHTML = `<option value="">Basic (waveform)</option>${groups}`;
    $("song-bass-voice").innerHTML = groups;
    $("song-part-voice").innerHTML = groups;
    $("song-kit").innerHTML = Engine.KITS.map((name) => `<option value="${name}">${escape(Engine.KIT_LABELS[name])} kit</option>`).join("");
  })();
  // The Studio layout (song-studio.js) reads the open song and drives playback through this, and is told when the editor was rebuilt,
  // when a step is about to sound and when playback stopped.
  window.SongStudioHost = {
    song: () => songData,
    playing: () => player.isPlaying() || isCountingIn(),
    paused: () => resumeFrom !== null && !(player.isPlaying() || isCountingIn()),
    pause: () => pausePlayback(),
    stop: () => stopPlayback(),
    forget: () => { resumeFrom = null; },
    now: () => getAudioCtx().currentTime,
    note: (name) => playAndMaybeRecordNote(name),
    hit: (row) => auditDrumHit(row),
    // One undo step for everything done between group(true) and group(false).
    group: (on) => {
      if (on) {
        flushSongHistoryInputGroup();
        historyGroup = { before: captureSongHistoryState() };
        // A drag that never reports its end (the page lost the pointer) must not leave undo switched off.
        clearTimeout(historyGroupTimer);
        historyGroupTimer = setTimeout(() => window.SongStudioHost.group(false), 10000);
      } else if (historyGroup) {
        clearTimeout(historyGroupTimer);
        const group = historyGroup;
        historyGroup = null;
        songEditGeneration++;
        pushSongUndoState(group.before);
      }
    },
    // The scale the song highlights ({ root, type, snap, degrees }), or null. With snap on, notes played or tapped in move to the nearest note
    // of it; with it off (the default) the keys are free.
    scale: () => {
      const sc = activeScale();
      return sc ? { root: sc.root, type: sc.type, snap: sc.snap === true, degrees: SCALES[sc.type].slice() } : null;
    },
    setSnap: (on) => {
      const sc = activeScale();
      if (!sc) return;
      if (on) sc.snap = true;
      else delete sc.snap;
      scheduleAutosave();
    },
    snap: (name) => snapToScale(name, (candidate) => Boolean(roll().notes[rowForNote(candidate)])),
    // A track's own sound tweaks (wave, attack, decay, sustain, release, cutoff, detune, vibrato). A null value takes a tweak back to the sound's own.
    synth: (id) => {
      const part = id === "melody" ? songData.melody : songData[id];
      return part && part.synth ? Object.assign({}, part.synth) : {};
    },
    setSynth: (id, patch) => {
      const part = id === "melody" ? songData.melody : ensurePart(id);
      const next = Object.assign({}, part.synth || {});
      Object.keys(patch).forEach((key) => {
        if (patch[key] === null || patch[key] === undefined) delete next[key];
        else next[key] = patch[key];
      });
      const clean = Engine.cleanSynth(next);
      if (clean) part.synth = clean;
      else delete part.synth;
      scheduleAutosave();
    },
    // Plays a note of a track (never records it), with the track's sound as it is now.
    hear: (id, name) => hearNote(id, name),
    hearDrum: (row) => soundDrum(row),
    // One drum sound's own tweaks (tune in semitones, decay as a multiplier, tone from -1 to 1). A null value takes a tweak back to the kit's.
    drum: (row) => Engine.drumShape(songData.trackMeta && songData.trackMeta[row]),
    setDrum: (row, patch) => {
      const meta = songData.trackMeta && songData.trackMeta[row];
      if (!meta) return;
      Object.keys(patch).forEach((key) => {
        if (!Engine.DRUM_RANGES[key]) return;
        if (patch[key] === null || patch[key] === undefined) delete meta[key];
        else meta[key] = Math.max(Engine.DRUM_RANGES[key][0], Math.min(Engine.DRUM_RANGES[key][1], Number(patch[key]) || 0));
      });
      scheduleAutosave();
    },
    // Where recorded notes land: 0 = on the step that is sounding, else the nearest 1, 2 or 4 steps.
    quantize: () => quantizeSteps,
    setQuantize: (n) => {
      quantizeSteps = [0, 1, 2, 4].includes(Number(n)) ? Number(n) : 1;
      try {
        localStorage.setItem("songQuantize", String(quantizeSteps));
      } catch {
        /* a remembered choice is a nicety */
      }
    },
    // Wake the sound up (a phone keeps it asleep until a touch), for the Studio's own buttons.
    unlock: () => ensureAudio(),
  };
  let quantizeSteps = (() => {
    try {
      const n = Number(localStorage.getItem("songQuantize"));
      return localStorage.getItem("songQuantize") !== null && [0, 1, 2, 4].includes(n) ? n : 1;
    } catch {
      return 1;
    }
  })();
  const notifyStudio = (opened) => { if (window.SongStudio) window.SongStudio.refresh({ opened: opened === true }); };
  // Every song has the four core drum rows. The extra voices (open hat, rim, tom, crash) are added to a song from the menu under the
  // grid, so a song that never asked for them has exactly the rows it always had. TRACK_ORDER is the order rows are shown in.
  const CORE_TRACKS = ["kick", "snare", "hihat", "clap"];
  const EXTRA_TRACKS = ["openhat", "rim", "tom", "crash"];
  const TRACK_ORDER = ["kick", "snare", "hihat", "openhat", "clap", "rim", "tom", "crash"];
  const TRACK_LABELS = { kick: "Kick", snare: "Snare", hihat: "Hi-Hat", openhat: "Open Hat", clap: "Clap", rim: "Rim", tom: "Tom", crash: "Crash" };
  // Distinct default swatch per track so a freshly-created song's grid
  // already reads as 4 differentiable lanes at a glance, rather than every
  // track sharing the same accent color until an admin manually picks one.
  const DEFAULT_TRACK_COLORS = { kick: "#ff7a45", snare: "#ffd166", hihat: "#4ecdc4", clap: "#c9a5ff", openhat: "#7bdff2", rim: "#f4a261", tom: "#e76f51", crash: "#b8e986" };
  const STEPS = Engine.STEPS;

  // Piano roll: 2 octaves (C3-B4), highest pitch first — the usual
  // top-to-bottom piano-roll convention. Reuses the exact same
  // .song-step/.song-steps toggle-grid cells and click handling as the
  // drum sequencer below, just with a note name (not a drum sound) as the
  // per-row key, so the same rendering/toggle code covers both.
  // Mirrors the whitelist in worker/render.js's renderSongBlockHtml -- both
  // sides need to agree on which theme values actually have a matching
  // CSS rule (public/style.css's .song-theme-* classes), since "default"
  // (or any unrecognized value from stale/imported data) means no
  // song-theme-* class at all, falling through to the site's own global
  // --accent unchanged.
  const SONG_THEME_CLASSES = new Set(["sunset", "ocean", "mono", "neon"]);
  function applySongTheme(embedEl, theme) {
    SONG_THEME_CLASSES.forEach((t) => embedEl.classList.remove(`song-theme-${t}`));
    if (SONG_THEME_CLASSES.has(theme)) embedEl.classList.add(`song-theme-${theme}`);
  }

  const NOTE_NAMES = Engine.NOTE_NAMES;
  const PIANO_NOTES = [];
  [4, 3].forEach((octave) => {
    for (let i = 11; i >= 0; i--) PIANO_NOTES.push(NOTE_NAMES[i] + octave);
  });

  // The bass line, the chords and the lead each have a two-octave roll of their own (C1 to B2, C3 to B4, C4 to B5). songData.bass, .chords
  // and .lead are created the first time one is needed and dropped at save time while it has nothing in it, so a song that never uses
  // them is stored exactly as it always was.
  const BASS_NOTES = Engine.BASS_NOTES;
  const PART_KEYS = Engine.PART_KEYS;
  const PART_NOTES = Engine.PART_NOTES;
  const emptyLanes = (names) => names.reduce((acc, n) => {
    acc[n] = new Array(STEPS).fill(false);
    return acc;
  }, {});

  function defaultSongData() {
    return {
      tempo: 120,
      kit: "acoustic",
      visualization: "bars",
      theme: "default",
      page_sync: false,
      master_volume: 1,
      humanize: 0,
      swing: 0,
      space: 0,
      // Free-text production notes -- mix references, arrangement ideas,
      // "redo the kick" reminders. Rides in the same JSON blob as every
      // other song setting, but renderSongBlockHtml() (worker/render.js)
      // explicitly strips this one key before it reaches the public
      // embed's data-song attribute, the same "never shown publicly"
      // guarantee articles/projects give their own private_notes column.
      private_notes: "",
      tracks: CORE_TRACKS.reduce((acc, t) => {
        acc[t] = new Array(STEPS).fill(false);
        return acc;
      }, {}),
      trackMeta: CORE_TRACKS.reduce((acc, t) => {
        acc[t] = { color: DEFAULT_TRACK_COLORS[t], note: "" };
        return acc;
      }, {}),
      melody: {
        waveform: "sine",
        notes: PIANO_NOTES.reduce((acc, n) => {
          acc[n] = new Array(STEPS).fill(false);
          return acc;
        }, {}),
      },
    };
  }

  let songs = [];
  let currentSongId = null;
  let songData = defaultSongData();
  // Which part the piano roll shows and the melody tools work on: "melody", or "bass", "chords" or "lead" (each its own roll). Everything the
  // roll and its tools touch goes through roll() / rollNotes(), so the same tools serve every part.
  let rollPart = "melody";
  function ensurePart(key) {
    if (!songData[key] || typeof songData[key] !== "object" || Array.isArray(songData[key])) songData[key] = {};
    if (!songData[key].notes || typeof songData[key].notes !== "object" || Array.isArray(songData[key].notes)) songData[key].notes = {};
    PART_NOTES[key].forEach((n) => {
      if (!Array.isArray(songData[key].notes[n])) songData[key].notes[n] = new Array(STEPS).fill(false);
    });
    return songData[key];
  }
  const ensureBass = () => ensurePart("bass");
  const isBassRoll = () => rollPart === "bass";
  const isPartRoll = () => rollPart !== "melody";
  const roll = () => (isPartRoll() ? ensurePart(rollPart) : songData.melody);
  const rollNotes = () => (isPartRoll() ? PART_NOTES[rollPart] : PIANO_NOTES);
  const PART_WORDS = { melody: "melody", bass: "bass line", chords: "chords", lead: "lead" };
  const rollWord = () => PART_WORDS[rollPart];
  const rollWordCap = () => PART_WORDS[rollPart].charAt(0).toUpperCase() + PART_WORDS[rollPart].slice(1);
  // Drops a part with nothing in it (and every pattern's empty one) from a copy about to be saved, so a song that never used it is unchanged.
  function pruneParts(data) {
    const hasNotes = (part) => part && part.notes && typeof part.notes === "object" && Object.values(part.notes).some((lane) => Array.isArray(lane) && lane.some(Boolean));
    PART_KEYS.forEach((key) => {
      if (data.patterns && typeof data.patterns === "object") {
        Object.values(data.patterns).forEach((part) => {
          if (part && part[key] && !hasNotes(part[key])) delete part[key];
        });
      }
      if (!data[key]) return;
      const anyPattern = data.patterns && typeof data.patterns === "object" && Object.values(data.patterns).some((part) => part && part[key]);
      const customised = data[key].voice !== undefined || data[key].synth !== undefined || data[key].muted === true || data[key].hidden === true || (data[key].volume !== undefined && data[key].volume !== 1);
      if (!hasNotes(data[key]) && !anyPattern && !customised) delete data[key];
    });
    return data;
  }
  // The drum rows the open song has, in display order: the core four, plus each extra voice that was added to it. A row belongs to the
  // whole song (its colour, mute and volume are shared by every pattern), so it is found by its settings, not by one pattern's lanes.
  function trackList() {
    return TRACK_ORDER.filter((t) => CORE_TRACKS.includes(t) || (songData.trackMeta && songData.trackMeta[t]));
  }

  // ---------- Autosave ----------
  // Songs previously had zero autosave/crash-recovery wiring at all,
  // unlike pages/articles/projects (each of which shares scheduleAutosave/
  // conflict-detection patterns) -- a crash or an accidental close mid-
  // session lost every unsaved edit. No optimistic-locking/conflict
  // system exists for songs (no version column), so unlike the article/
  // project autosave this can't detect a concurrent edit from another tab
  // -- an acceptable gap on a single-admin site with no realistic
  // concurrent-editor scenario, matching how the manual Save button
  // already has no conflict check either; this isn't a regression this
  // feature introduces. Only autosaves a song that's already been
  // explicitly saved once (has an id) -- a brand-new song still needs a
  // deliberate first Save so its name is intentional, not whatever a few
  // keystrokes happened to produce (same reasoning as the article/project
  // autosave's own "only an existing draft" guard).
  let autosaveTimer = null;
  let autosavePromise = null;
  let autosaveOpenGeneration = null;
  let autosaveQueued = false;
  let songSavePending = false;
  let songSaveOpenGeneration = null;
  let songDirtyGeneration = 0;
  // Bumped by every openBuilder() call and captured locally by both
  // openBuilder() itself and autosaveSong() -- guards two separate races
  // a critic pass found: (1) clicking Edit on song A then song B before
  // A's GET resolves used to let whichever response arrived LAST win,
  // overwriting the open form/songData with the wrong song's content
  // regardless of which one the admin actually meant to open, and (2) an
  // autosave PATCH already in flight when a different song is opened
  // still correctly saves to the right song (its id/body are captured
  // synchronously before the timer's callback awaits), but writing its
  // "Saved"/"failed" status into #song-autosave-status *after* a new song
  // is already showing there is misleading -- that status update is now
  // suppressed instead.
  let openGeneration = 0;
  // Tracks whether there's an edit not yet confirmed saved -- separate
  // from app.js's own `unsavedDirty` (a different IIFE/closure this
  // script has no access to) and its beforeunload guard, so this file
  // wires an equivalent guard of its own rather than leaving song edits
  // as the one editor in this admin with no "are you sure" on tab close.
  let songHasUnsavedChanges = false;

  // Undo history belongs to the open song only. Group text and slider input
  // into one step, keep the stack bounded, and include the separate name field.
  const SONG_HISTORY_LIMIT = 100;
  const songUndoStack = [];
  const songRedoStack = [];
  const songHistoryEvents = new WeakMap();
  let songHistoryInputGroup = null;
  let songHistoryInputTimer = null;
  let songHistoryKnownName = $("song-name").value;
  let tapTimes = [];
  let tapStatusTimer = null;
  let tapPreviewTimer = null;

  function captureSongHistoryState(name = $("song-name").value) {
    return { name, data: JSON.parse(JSON.stringify(songData)) };
  }
  function sameSongHistoryState(a, b) {
    return a.name === b.name && JSON.stringify(a.data) === JSON.stringify(b.data);
  }
  function updateSongHistoryButtons() {
    const undo = $("song-undo");
    const redo = $("song-redo");
    if (undo) undo.disabled = songUndoStack.length === 0;
    if (redo) redo.disabled = songRedoStack.length === 0;
  }
  function pushSongUndoState(before) {
    if (sameSongHistoryState(before, captureSongHistoryState())) return false;
    const last = songUndoStack[songUndoStack.length - 1];
    if (last && sameSongHistoryState(last, before)) return false;
    songUndoStack.push(before);
    if (songUndoStack.length > SONG_HISTORY_LIMIT) songUndoStack.shift();
    songRedoStack.length = 0;
    updateSongHistoryButtons();
    return true;
  }
  function flushSongHistoryInputGroup() {
    if (!songHistoryInputGroup) return;
    const group = songHistoryInputGroup;
    songHistoryInputGroup = null;
    clearTimeout(songHistoryInputTimer);
    songHistoryInputTimer = null;
    pushSongUndoState(group.before);
  }
  function resetSongHistory() {
    historyGroup = null;
    clearTimeout(historyGroupTimer);
    clearTimeout(songHistoryInputTimer);
    songHistoryInputTimer = null;
    songHistoryInputGroup = null;
    songUndoStack.length = 0;
    tapTimes = [];
    songRedoStack.length = 0;
    songHistoryKnownName = $("song-name").value;
    updateSongHistoryButtons();
  }
  function isSongHistoryTextInput(target) {
    if (!target) return false;
    if (target.tagName === "TEXTAREA") return true;
    if (target.tagName !== "INPUT") return false;
    return !["button", "submit", "reset", "checkbox", "radio", "file", "hidden"].includes(target.type);
  }
  function songHistoryShortcut(event) {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.isComposing) return null;
    const key = String(event.key || "").toLowerCase();
    if (key === "z") return event.shiftKey ? "redo" : "undo";
    if (key === "y") return "redo";
    return null;
  }
  function songHistoryCommand(target) {
    return target && target.closest ? target.closest("#song-undo, #song-redo") : null;
  }
  function captureSongHistoryEvent(event) {
    if ($("song-builder-modal").hidden) return;
    if (event.type === "click" && event.target && event.target.closest && event.target.closest("#song-tap-tempo, [data-no-history]")) {
      songHistoryEvents.set(event, { skip: true }); // tapping a tempo is grouped separately; switching pattern changes what you look at, not the music
      return;
    }
    if (event.type === "click" && songHistoryCommand(event.target)) {
      flushSongHistoryInputGroup();
      songHistoryEvents.set(event, { skip: true });
      return;
    }
    if (event.type === "keydown") {
      const shortcut = songHistoryShortcut(event);
      if (shortcut) {
        flushSongHistoryInputGroup();
        songHistoryEvents.set(event, { shortcut, generation: openGeneration });
        return;
      }
      if (isSongHistoryTextInput(event.target) || (event.target && event.target.isContentEditable)) return;
    }
    const continuesInput = songHistoryInputGroup && songHistoryInputGroup.target === event.target &&
      (event.type === "input" || event.type === "change");
    if (!continuesInput) flushSongHistoryInputGroup();
    songHistoryEvents.set(event, {
      before: captureSongHistoryState(event.target && event.target.id === "song-name" ? songHistoryKnownName : $("song-name").value),
      generation: openGeneration,
      target: event.target,
      type: event.type,
    });
  }
  // While a group is open (a drag across many steps in the Studio) the events inside it make no undo steps of their own: the whole drag is
  // one, pushed when the group ends.
  let historyGroup = null;
  let historyGroupTimer = 0;
  function finishSongHistoryEvent(event) {
    const pending = songHistoryEvents.get(event);
    if (!pending) return;
    songHistoryEvents.delete(event);
    if (pending.skip) return;
    if (historyGroup) return;
    if (pending.shortcut) {
      if (pending.generation !== openGeneration || $("song-builder-modal").hidden) return;
      event.preventDefault();
      if (pending.shortcut === "undo") undoSongEdit();
      else redoSongEdit();
      return;
    }
    if (pending.generation !== openGeneration || $("song-builder-modal").hidden) return;
    const after = captureSongHistoryState();
    if (event.target && event.target.id === "song-name") songHistoryKnownName = after.name;
    if (sameSongHistoryState(pending.before, after)) {
      if (event.type === "change" && songHistoryInputGroup && songHistoryInputGroup.target === pending.target) {
        flushSongHistoryInputGroup();
      }
      return;
    }
    songEditGeneration++;
    if (event.type === "change" && songHistoryInputGroup && songHistoryInputGroup.target === pending.target) {
      flushSongHistoryInputGroup();
      return;
    }
    if (event.type === "input" && isSongHistoryTextInput(pending.target)) {
      if (!songHistoryInputGroup) songHistoryInputGroup = { target: pending.target, before: pending.before };
      clearTimeout(songHistoryInputTimer);
      songHistoryInputTimer = setTimeout(flushSongHistoryInputGroup, 700);
      return;
    }
    flushSongHistoryInputGroup();
    pushSongUndoState(pending.before);
  }
  function applySongHistoryState(state) {
    const restored = JSON.parse(JSON.stringify(state.data));
    Object.keys(songData).forEach((key) => delete songData[key]);
    Object.assign(songData, restored);
    $("song-name").value = state.name;
    songHistoryKnownName = state.name;
    $("song-tempo").value = songData.tempo || 120;
    $("song-kit").value = songData.kit || "acoustic";
    $("song-waveform").value = songData.melody.waveform || "sine";
    syncVoiceControl();
    $("song-visualization").value = songData.visualization || "bars";
    $("song-theme").value = SONG_THEME_CLASSES.has(songData.theme) ? songData.theme : "default";
    $("song-page-sync").checked = !!songData.page_sync;
    $("song-master-volume").value = Math.round((typeof songData.master_volume === "number" ? songData.master_volume : 1) * 100);
    $("song-humanize").value = typeof songData.humanize === "number" ? songData.humanize : 0;
    $("song-swing").value = Number(songData.swing) || 0;
    $("song-swing").setAttribute("aria-valuetext", Number(songData.swing) ? `${Number(songData.swing)}% swing` : "Straight");
    $("song-space").value = Number(songData.space) || 0;
    $("song-space").setAttribute("aria-valuetext", Number(songData.space) ? `${Number(songData.space)}% space` : "Dry");
    $("song-echo").value = Number(songData.echo) || 0;
    $("song-echo").setAttribute("aria-valuetext", Number(songData.echo) ? `${Number(songData.echo)}% echo` : "Dry");
    $("song-pump").value = Number(songData.pump) || 0;
    $("song-pump").setAttribute("aria-valuetext", Number(songData.pump) ? `${Number(songData.pump)}% pump` : "Off");
    $("song-notes").value = songData.private_notes || "";
    applySongTheme($("song-preview-embed"), songData.theme);
    Engine.setMasterVolume(getAudioCtx(), songData.master_volume);
    Engine.setSpace(getAudioCtx(), songData.space);
    Engine.setEcho(getAudioCtx(), songData.echo, songData.tempo);
    $("song-preview-name").textContent = state.name || "Song name";
    renderSequencer();
    renderPianoRoll();
    renderPatternControls();
    updatePreviewVisibility();
    refreshWaveformPreview();
    notifyStudio();
    songEditGeneration++;
    scheduleAutosave();
  }
  function undoSongEdit() {
    flushSongHistoryInputGroup();
    if (!songUndoStack.length) return;
    const current = captureSongHistoryState();
    const previous = songUndoStack.pop();
    songRedoStack.push(current);
    if (songRedoStack.length > SONG_HISTORY_LIMIT) songRedoStack.shift();
    applySongHistoryState(previous);
    updateSongHistoryButtons();
  }
  function redoSongEdit() {
    flushSongHistoryInputGroup();
    if (!songRedoStack.length) return;
    const current = captureSongHistoryState();
    const next = songRedoStack.pop();
    songUndoStack.push(current);
    if (songUndoStack.length > SONG_HISTORY_LIMIT) songUndoStack.shift();
    applySongHistoryState(next);
    updateSongHistoryButtons();
  }
  const songBuilderModal = $("song-builder-modal");
  ["click", "input", "change"].forEach((type) => {
    songBuilderModal.addEventListener(type, captureSongHistoryEvent, true);
    songBuilderModal.addEventListener(type, finishSongHistoryEvent);
  });
  songBuilderModal.addEventListener("focusout", flushSongHistoryInputGroup);
  document.addEventListener("keydown", captureSongHistoryEvent, true);
  $("song-undo").addEventListener("click", undoSongEdit);
  $("song-redo").addEventListener("click", redoSongEdit);

  window.addEventListener("beforeunload", (e) => {
    if (!songHasUnsavedChanges && !songSavePending) return;
    e.preventDefault();
    e.returnValue = "";
  });
  function setAutosaveStatus(text) {
    const el2 = $("song-autosave-status");
    if (el2) el2.textContent = text;
  }
  function queueSongAutosave() {
    if (!currentSongId || songSavePending) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosaveSong, 2000);
  }
  async function performAutosave() {
    if (!currentSongId) return;
    const name = $("song-name").value.trim();
    if (!name) return;
    // Safe to capture openGeneration here (only once this timer callback
    // actually starts running, not at scheduleAutosave() time) precisely
    // because openBuilder() unconditionally clears autosaveTimer on every
    // call -- a still-pending (not yet fired) timer for the previously
    // open song is always cancelled before this line could ever run
    // against a generation that's already moved on. If that clearTimeout
    // were ever removed, this generation check would need to move to
    // scheduleAutosave() instead to stay correct.
    const gen = openGeneration;
    const id = currentSongId;
    const dirtyGen = songDirtyGeneration;
    const data = pruneParts(JSON.parse(JSON.stringify(songData)));
    try {
      await refreshCachedWaveformPeaks(data);
      if (gen !== openGeneration || id !== currentSongId) return; // a different song opened while the peaks render was in flight -- this autosave is stale, let the next one (against the now-current song) handle it
      await window.adminApi(`/songs/${id}`, { method: "PATCH", body: JSON.stringify({ name, data }) });
      if (gen !== openGeneration || id !== currentSongId) return; // a different song opened while this PATCH was in flight
      if (dirtyGen === songDirtyGeneration) {
        songHasUnsavedChanges = false;
        setAutosaveStatus("Saved " + new Date().toLocaleTimeString());
      } else {
        songHasUnsavedChanges = true;
        setAutosaveStatus("Unsaved changes…");
        autosaveQueued = true;
      }
      if (window.refreshSongOptions) window.refreshSongOptions();
    } catch (err) {
      if (gen !== openGeneration || id !== currentSongId) return;
      setAutosaveStatus("Autosave failed: " + err.message);
    }
  }
  function autosaveSong() {
    autosaveTimer = null;
    if (!currentSongId) return Promise.resolve();
    if (songSavePending || autosavePromise) {
      autosaveQueued = true;
      return autosavePromise || Promise.resolve();
    }
    const gen = openGeneration;
    setAutosaveStatus("Autosaving…");
    const request = performAutosave();
    let tracked;
    tracked = request.finally(() => {
      if (autosavePromise === tracked) {
        autosavePromise = null;
        autosaveOpenGeneration = null;
      }
      if (!autosaveQueued) return;
      autosaveQueued = false;
      if (songSavePending) {
        autosaveQueued = true;
        return;
      }
      if (songHasUnsavedChanges && currentSongId) queueSongAutosave();
    });
    autosavePromise = tracked;
    autosaveOpenGeneration = gen;
    return tracked;
  }
  function scheduleAutosave() {
    songDirtyGeneration++;
    songHasUnsavedChanges = true;
    setAutosaveStatus(currentSongId ? "Unsaved changes…" : "Unsaved draft — save to keep");
    clearTimeout(autosaveTimer);
    // A new draft has no row to PATCH yet. Keep it marked dirty so the
    // status and beforeunload guard protect it until the first manual Save.
    if (!currentSongId) return;
    if (songSavePending || autosavePromise) {
      autosaveQueued = true;
      return;
    }
    queueSongAutosave();
  }
  // applyDiscard=false: only ask (and refuse while a save is running). The caller
  // resets the dirty state itself once the switch really happens, so a leave
  // that then fails or is abandoned never marks unsaved edits as clean.
  function canLeaveSongBuilder(applyDiscard = true) {
    if (songSavePending && songSaveOpenGeneration === openGeneration) {
      setAutosaveStatus("Save in progress. Wait before closing or switching songs.");
      return false;
    }
    if (autosavePromise && autosaveOpenGeneration === openGeneration) {
      setAutosaveStatus("Autosave in progress. Wait before closing or switching songs.");
      return false;
    }
    if (songHasUnsavedChanges) {
      const message = currentSongId
        ? "Discard unsaved changes to this song?"
        : "Discard this unsaved song draft?";
      if (!confirm(message)) return false;
      if (applyDiscard) {
        clearTimeout(autosaveTimer);
        songHasUnsavedChanges = false;
        autosaveQueued = false;
        setAutosaveStatus("");
      }
    }
    return true;
  }

  // Playback and drum/melody synthesis both live in the shared engine
  // (public/song-engine.js) — the exact same code the public Song block
  // uses to play a song on an article/project page. Only the admin-
  // specific bits (grid highlighting, live tempo/kit/waveform editing)
  // stay here.
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  // A browser (a phone above all) keeps the sound asleep until a touch, and puts it back to sleep when the page is in the background or the
  // phone rings. Everything that is about to make a sound wakes it first, from the tap that asked for it, so Play and Preview never go quiet.
  function ensureAudio() {
    const ctx = getAudioCtx();
    if (ctx.state !== "running" && typeof ctx.resume === "function") {
      try {
        const woke = ctx.resume();
        if (woke && typeof woke.catch === "function") woke.catch(() => {});
      } catch {
        /* the next tap tries again */
      }
    }
    return ctx;
  }
  ["pointerdown", "keydown", "touchend"].forEach((type) => document.addEventListener(type, () => { if (audioCtx && audioCtx.state !== "running") ensureAudio(); }, true));

  // ---------- Live preview panel ----------
  // Mirrors exactly what the public Song block renders/does (same CSS
  // classes, same SongEngine calls) so "dialing in" the visualization here
  // matches what a reader will actually see — no separate preview-only
  // implementation to keep in sync.
  let previewPeaks = null;

  function updatePreviewVisibility() {
    const viz = songData.visualization || "bars";
    $("song-preview-bars").hidden = viz !== "bars";
    $("song-preview-waveform").hidden = viz !== "waveform";
    $("song-preview-pulse").hidden = viz !== "pulse";
    if (viz === "bars" && !$("song-preview-bars").children.length) {
      $("song-preview-bars").innerHTML = Array.from({ length: STEPS }, () => `<span class="song-embed-bar"></span>`).join("");
    }
  }

  // Dragging the new volume slider fires many rapid 'input' events, each
  // triggering a re-render here -- an OfflineAudioContext render is async,
  // so several can be in flight at once and resolve out of order. A
  // generation token discards any render whose result comes back after a
  // newer one was already started, the same pattern used for the
  // open-song race above.
  let waveformPreviewGeneration = 0;
  async function refreshWaveformPreview() {
    if ((songData.visualization || "bars") !== "waveform") return;
    const myGeneration = ++waveformPreviewGeneration;
    const peaks = await Engine.renderWaveformPeaks(songData, 200);
    if (myGeneration !== waveformPreviewGeneration) return;
    previewPeaks = peaks;
    drawWaveformPreview(0);
  }

  // ---------- Cached waveform peaks (persisted with the song) ----------
  // The public embed (public/song-embed.js) used to run its own
  // OfflineAudioContext render of renderWaveformPeaks() on EVERY page
  // load of a "waveform"-visualization song, just to draw the static
  // preview bars -- pure wasted CPU/battery for every visitor, since the
  // peaks are a deterministic function of songData that only actually
  // changes when the admin edits and saves the song. Computing it once
  // here at save time (reusing the exact same 200-bucket call the admin
  // preview above already makes, so the cached shape matches what the
  // admin already saw while editing) and persisting it as part of the
  // saved song data means every future page load can skip the render
  // entirely and just draw the already-computed numbers -- worker/
  // render.js's renderSongBlockHtml() already serializes the WHOLE
  // song.data blob into the embed's data-song attribute, so this needed
  // no server-side change at all to reach the public page.
  // Only computed for "waveform" visualization songs, since that's the
  // only mode with a canvas to draw peaks into at all -- storing it for
  // "bars"/"pulse" songs would just be dead weight in the saved JSON
  // that nothing ever reads. Recomputed fresh on every save (rather than
  // tracked with a separate dirty flag) so it can never go stale against
  // whatever content was actually saved.
  // Takes `data` as an explicit parameter (rather than reading the
  // module-level `songData` directly) so the object this writes onto is
  // fixed at the moment it's called, not re-resolved after the `await`
  // -- otherwise switching to a different song while this render is
  // still in flight (the same shape of race a critic pass already
  // stress-tested for the "Generate cover art" feature) could attach one
  // song's freshly-computed peaks onto a DIFFERENT song's data object.
  async function refreshCachedWaveformPeaks(data) {
    if ((data.visualization || "bars") === "waveform") {
      try {
        data.cached_peaks = await Engine.renderWaveformPeaks(data, 200);
      } catch (err) {
        delete data.cached_peaks; // a broken/partial cache would be worse than none -- the embed falls back to a live render when this is absent
      }
    } else {
      delete data.cached_peaks;
    }
  }

  function drawWaveformPreview(progress) {
    const canvas = $("song-preview-waveform");
    if (!previewPeaks || canvas.hidden) return;
    const c2d = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const mid = h / 2;
    c2d.clearRect(0, 0, w, h);
    const barW = w / previewPeaks.length;
    // Reads --accent off the preview embed itself (not hardcoded) so a
    // chosen theme is reflected here too, matching the public embed's own
    // theme-aware waveform color (see public/song-embed.js).
    const accent = getComputedStyle($("song-preview-embed")).getPropertyValue("--accent").trim() || "#ff7a45";
    previewPeaks.forEach((p, i) => {
      const played = i / previewPeaks.length <= progress;
      c2d.fillStyle = played ? accent : "rgba(255,255,255,0.25)";
      const yTop = mid + p[1] * mid;
      const yBot = mid + p[0] * mid;
      c2d.fillRect(i * barW, yTop, Math.max(1, barW - 1), Math.max(1, yBot - yTop));
    });
  }

  $("song-theme").addEventListener("change", () => {
    songData.theme = $("song-theme").value;
    applySongTheme($("song-preview-embed"), songData.theme);
    // A theme change only re-colors --accent -- it doesn't change the
    // underlying waveform samples at all, so re-rendering the offline
    // peaks themselves would be pointless work; just redraw with the
    // already-cached peaks at the new color.
    if ((songData.visualization || "bars") === "waveform") drawWaveformPreview(0);
    scheduleAutosave();
  });
  $("song-visualization").addEventListener("change", () => {
    songData.visualization = $("song-visualization").value;
    updatePreviewVisibility();
    refreshWaveformPreview();
    scheduleAutosave();
  });
  $("song-page-sync").addEventListener("change", () => {
    songData.page_sync = $("song-page-sync").checked;
    scheduleAutosave();
  });

  // Same shared-overlay approach as the public embed (public/song-embed.js)
  // — one fixed layer, flashed on any beat, so trying "Sync page background"
  // here previews the same effect a reader would see.
  let pageSyncOverlay = null;
  function getPageSyncOverlay() {
    if (!pageSyncOverlay) {
      pageSyncOverlay = document.createElement("div");
      pageSyncOverlay.id = "song-page-sync-overlay";
      document.body.appendChild(pageSyncOverlay);
    }
    return pageSyncOverlay;
  }
  function flashPageSync() {
    const overlay = getPageSyncOverlay();
    overlay.classList.remove("song-page-sync-hit");
    void overlay.offsetWidth;
    overlay.classList.add("song-page-sync-hit");
  }

  // info (from the player): which pattern is sounding and where it sits in the song order. The playhead is drawn on the grids only while the
  // pattern being played is the one being edited, and the waveform's progress covers the whole song.
  function highlightStep(step, time, info) {
    if (typeof time === "number") noteScheduledStep(step, time, info && info.chainIndex, info);
    if (window.SongStudio) window.SongStudio.step(step, time, info);
    if (info && window.SongStudio && window.SongStudio.active() && $("song-record").checked) extendLaneForRecording(window.SongStudio.openLane(), step, info);
    const visible = !info || info.pattern === editingPattern();
    document.querySelectorAll(".song-step").forEach((el) => {
      el.classList.toggle("song-step-playing", visible && Number(el.dataset.step) === step);
    });
    if (info) markPlayingOrderChip(info.chainLength > 1 ? info.chainIndex : -1);
    $("song-preview-name").textContent = $("song-name").value || "Song name";
    const viz = songData.visualization || "bars";
    const hits = Engine.stepHasAudibleDrumHit(info ? info.data : songData, step);
    if (viz === "bars") {
      $("song-preview-bars")
        .querySelectorAll(".song-embed-bar")
        .forEach((bar, i) => bar.classList.toggle("song-embed-bar-active", i === step));
    } else if (viz === "waveform") {
      drawWaveformPreview(((info ? info.chainIndex : 0) * STEPS + step) / ((info ? info.chainLength : 1) * STEPS));
    } else if (viz === "pulse") {
      const pulseEl = $("song-preview-pulse");
      pulseEl.classList.toggle("song-embed-pulse-beat", hits);
      if (hits) {
        pulseEl.classList.remove("song-embed-pulse-hit");
        void pulseEl.offsetWidth;
        pulseEl.classList.add("song-embed-pulse-hit");
      }
    }
    if (songData.page_sync && hits) flashPageSync();
  }

  // ---------- Metronome and count-in ----------
  // A practice aid that lives only in this editor: the clicks go straight to the speakers (not through the song's
  // master bus, so volume/normalize/meters and the saved song or public player never include them). Each choice is
  // remembered in this browser. Songs are 16 steps of sixteenth notes, so a beat is every 4th step and the bar
  // starts on step 0.
  const METRO_STORE_KEY = "song_metronome_prefs";
  const METRO_SOUNDS = {
    click: { type: "square", hi: 1500, lo: 1000, ms: 18 },
    beep: { type: "sine", hi: 1320, lo: 880, ms: 70 },
    wood: { type: "triangle", hi: 1200, lo: 800, ms: 45 },
    tick: { type: "sawtooth", hi: 3200, lo: 2400, ms: 10 },
  };
  const metroPrefs = { on: false, sound: "click", accent: true, volume: 60, countIn: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(METRO_STORE_KEY) || "null");
    if (saved && typeof saved === "object") {
      if (typeof saved.on === "boolean") metroPrefs.on = saved.on;
      if (typeof saved.sound === "string" && Object.prototype.hasOwnProperty.call(METRO_SOUNDS, saved.sound)) metroPrefs.sound = saved.sound;
      if (typeof saved.accent === "boolean") metroPrefs.accent = saved.accent;
      if (Number.isFinite(saved.volume)) metroPrefs.volume = Math.min(100, Math.max(0, Math.round(saved.volume)));
      if ([0, 2, 4, 8].includes(saved.countIn)) metroPrefs.countIn = saved.countIn;
    }
  } catch (e) {}
  function syncMetroControls() {
    $("song-metronome-on").checked = metroPrefs.on;
    $("song-metronome-sound").value = metroPrefs.sound;
    $("song-metronome-accent").checked = metroPrefs.accent;
    $("song-metronome-volume").value = String(metroPrefs.volume);
    $("song-count-in").value = String(metroPrefs.countIn);
  }
  function saveMetroPrefs() {
    try {
      localStorage.setItem(METRO_STORE_KEY, JSON.stringify(metroPrefs));
    } catch (e) {}
  }
  syncMetroControls();
  $("song-metronome-on").addEventListener("change", () => {
    metroPrefs.on = $("song-metronome-on").checked;
    saveMetroPrefs();
  });
  $("song-metronome-sound").addEventListener("change", () => {
    metroPrefs.sound = $("song-metronome-sound").value;
    saveMetroPrefs();
    previewMetroClick();
  });
  $("song-metronome-accent").addEventListener("change", () => {
    metroPrefs.accent = $("song-metronome-accent").checked;
    saveMetroPrefs();
  });
  $("song-metronome-volume").addEventListener("input", () => {
    metroPrefs.volume = Number($("song-metronome-volume").value) || 0;
    saveMetroPrefs();
  });
  $("song-metronome-volume").addEventListener("change", previewMetroClick);
  $("song-count-in").addEventListener("change", () => {
    metroPrefs.countIn = Number($("song-count-in").value) || 0;
    saveMetroPrefs();
  });
  // One click at `time` (AudioContext seconds); returns the oscillator so a cancelled count-in can silence it.
  function metroClickAt(time, accented) {
    const ctx = getAudioCtx();
    const def = METRO_SOUNDS[metroPrefs.sound] || METRO_SOUNDS.click;
    const peak = (metroPrefs.volume / 100) * (accented ? 0.5 : 0.35);
    if (peak <= 0) return null;
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.0001, time);
    gainNode.gain.exponentialRampToValueAtTime(peak, time + 0.002);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, time + def.ms / 1000);
    const osc = ctx.createOscillator();
    osc.type = def.type;
    osc.frequency.value = accented ? def.hi : def.lo;
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + def.ms / 1000 + 0.02);
    return osc;
  }
  function previewMetroClick() {
    if (getAudioCtx().state === "suspended") getAudioCtx().resume();
    metroClickAt(getAudioCtx().currentTime + 0.01, metroPrefs.accent);
  }
  // Called for every scheduled sequencer step while playing.
  function metroOnStep(step, time) {
    if (!metroPrefs.on || typeof time !== "number" || step % 4 !== 0) return;
    metroClickAt(time, metroPrefs.accent && step === 0);
  }
  let countInTimer = null;
  let countInOscs = [];
  let countInActive = false;
  let countInToken = 0; // bumped on cancel so a count-in still waiting for the audio context to resume gives up
  const isCountingIn = () => countInActive;
  function cancelCountIn() {
    countInToken++;
    countInActive = false;
    clearTimeout(countInTimer);
    countInTimer = null;
    countInOscs.forEach((o) => {
      try {
        o.stop();
      } catch (e) {}
    });
    countInOscs = [];
  }
  const onPlayerStep = (step, time, info) => {
    highlightStep(step, time, info);
    metroOnStep(step, time);
  };

  let player = Engine.createPlayer(getAudioCtx, songData, onPlayerStep);

  // Editing tempo/kit/waveform while a song is already playing should
  // take effect immediately, not just after Save — so these write
  // straight into the same songData object the running player reads.
  $("song-tempo").addEventListener("input", () => {
    songData.tempo = Number($("song-tempo").value) || 120;
    Engine.setEcho(getAudioCtx(), songData.echo, songData.tempo);
    renderRulers();
    refreshWaveformPreview();
    scheduleAutosave();
  });
  // Tap tempo: the BPM comes from the average gap between your last few taps; a pause of two seconds starts over.
  // A whole tap session is one undo step, and the preview render waits until the taps settle.
  $("song-tap-tempo").addEventListener("click", () => {
    const now = performance.now();
    if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2000) tapTimes = [];
    tapTimes.push(now);
    tapTimes = tapTimes.slice(-6);
    clearTimeout(tapStatusTimer);
    tapStatusTimer = setTimeout(() => { $("song-tap-status").textContent = ""; }, 4000);
    if (tapTimes.length < 2) {
      $("song-tap-status").textContent = "Keep tapping.";
      return;
    }
    const gap = (tapTimes[tapTimes.length - 1] - tapTimes[0]) / (tapTimes.length - 1);
    const raw = Math.round(60000 / gap);
    const bpm = Math.max(40, Math.min(240, raw));
    if (!songHistoryInputGroup) songHistoryInputGroup = { target: $("song-tap-tempo"), before: captureSongHistoryState() };
    clearTimeout(songHistoryInputTimer);
    songHistoryInputTimer = setTimeout(flushSongHistoryInputGroup, 2200);
    songEditGeneration++;
    $("song-tempo").value = bpm;
    songData.tempo = bpm;
    renderRulers();
    scheduleAutosave();
    clearTimeout(tapPreviewTimer);
    tapPreviewTimer = setTimeout(refreshWaveformPreview, 300);
    $("song-tap-status").textContent = raw === bpm ? `${bpm} BPM` : `${bpm} BPM (${raw < bpm ? "slowest" : "fastest"} allowed)`;
  });
  $("song-kit").addEventListener("change", () => {
    songData.kit = $("song-kit").value;
    refreshWaveformPreview();
    scheduleAutosave();
  });
  $("song-waveform").addEventListener("change", () => {
    songData.melody.waveform = $("song-waveform").value;
    refreshWaveformPreview();
    scheduleAutosave();
  });
  // The melody sound (instrument) brings its own oscillator, so the plain waveform select only applies while it is "Basic".
  function syncVoiceControl() {
    const voice = Engine.melodyVoiceOf(songData);
    $("song-voice").value = voice;
    $("song-waveform").disabled = !!voice;
    $("song-waveform").title = voice ? `Not used while the melody sound is ${Engine.MELODY_VOICES[voice].label}: it brings its own waveform. Choose Basic to use this again.` : "Melody instrument waveform";
  }
  $("song-voice").addEventListener("change", () => {
    const voice = $("song-voice").value;
    if (voice) songData.melody.voice = voice;
    else delete songData.melody.voice;
    syncVoiceControl();
    refreshWaveformPreview();
    scheduleAutosave();
  });
  // Invalidates an async normalize scan if any song edit happens while it
  // renders, so a stale scan cannot overwrite newer work.
  let songEditGeneration = 0;
  $("song-master-volume").addEventListener("input", () => {
    songData.master_volume = Number($("song-master-volume").value) / 100;
    // Apply immediately rather than waiting for scheduleStep's next pass —
    // otherwise dragging the slider while playback is stopped (or before
    // the next scheduled step) has no audible effect, and a MIDI-keyboard
    // preview note (which plays via Engine.playMelodyNote directly, not
    // through scheduleStep) would play at a stale volume. The waveform
    // preview intentionally always renders at full scale regardless of
    // master_volume (see renderWaveformPeaks), so it doesn't need a
    // refresh here.
    Engine.setMasterVolume(getAudioCtx(), songData.master_volume);
    scheduleAutosave();
  });
  $("song-humanize").addEventListener("input", () => {
    songData.humanize = Number($("song-humanize").value) || 0;
    scheduleAutosave();
  });
  // Drum pattern tools: shift (wraps), randomize or clear one drum row or all of them.
  const patternRows = () => {
    const t = $("song-pattern-target").value;
    return t === "all" ? trackList().filter((k) => songData.trackMeta[k].hidden !== true) : trackList().filter((k) => k === t);
  };
  const patternWord = () => ($("song-pattern-target").value === "all" ? "all drums" : TRACK_LABELS[$("song-pattern-target").value]);
  let patternAnnounce = 0;
  function patternEdit(fn, message) {
    for (const k of patternRows()) {
      const row = Array.from({ length: STEPS }, (_, i) => songData.tracks[k][i] || false);
      songData.tracks[k] = fn(row, k);
    }
    renderSequencer();
    const skipped = $("song-pattern-target").value === "all" ? trackList().length - patternRows().length : 0;
    patternAnnounce++;
    $("song-pattern-status").textContent = `${message} (${patternWord()}${skipped ? `, ${skipped} hidden row${skipped > 1 ? "s" : ""} skipped` : ""}).${patternAnnounce % 2 ? "" : " "}`;
    scheduleAutosave();
    refreshWaveformPreview();
  }
  // How full a randomized row is: busy hats, sparse kicks, and the extra voices kept light so a random beat still breathes.
  const DRUM_RANDOM_DENSITY = { hihat: 0.5, kick: 0.25, openhat: 0.15, rim: 0.15, tom: 0.12, crash: 0.04 };
  const shiftRow = (row, by) => row.map((_, i) => row[(i - by + STEPS) % STEPS]);
  $("song-pattern-shift-left").addEventListener("click", () => patternEdit((r) => shiftRow(r, -1), "Shifted one step earlier"));
  $("song-pattern-shift-right").addEventListener("click", () => patternEdit((r) => shiftRow(r, 1), "Shifted one step later"));
  $("song-pattern-clear").addEventListener("click", () => patternEdit((r) => r.map(() => false), "Cleared"));
  $("song-pattern-random").addEventListener("click", () =>
    patternEdit((r, k) => r.map((_, i) => Math.random() < (DRUM_RANDOM_DENSITY[k] ?? 0.2) || (k === "kick" && i % 4 === 0 && Math.random() < 0.7)), "Randomized, all hits at full strength"));
  // Starter beats and Euclidean rhythms replace the rows chosen under "Apply to" (hidden rows are skipped, as for Randomize).
  const starterSelect = $("song-starter-beat");
  window.SongPatterns.STARTERS.forEach((b) => {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.label;
    starterSelect.appendChild(opt);
  });
  const clampInt = (id, lo, hi) => {
    const input = $(id);
    const v = Math.max(lo, Math.min(hi, Math.floor(Number(input.value)) || 0));
    input.value = v;
    return v;
  };
  $("song-starter-apply").addEventListener("click", () => {
    const beat = window.SongPatterns.STARTERS.find((b) => b.id === starterSelect.value);
    // A beat that uses an extra drum (an open hat, a rim click) brings its row along if the song doesn't have it yet.
    if (beat && $("song-pattern-target").value === "all") {
      const needed = Object.keys(beat.rows).filter((t) => EXTRA_TRACKS.includes(t) && !trackList().includes(t));
      needed.forEach(addDrumRow);
      if (needed.length) renderSequencer();
    }
    patternEdit((r, k) => window.SongPatterns.starterRow(starterSelect.value, k, STEPS), `Replaced with the ${beat ? beat.label : "starter"} beat`);
  });
  // Fills: the end of the bar becomes a roll or a stop (see SongPatterns.FILLS). They always touch the last steps of every row, whatever is
  // chosen under "Apply to"; a row the fill needs (a tom) is added.
  window.SongPatterns.FILLS.forEach((f) => $("song-fill-style").appendChild(new Option(f.label, f.id)));
  $("song-fill-apply").addEventListener("click", () => {
    const fill = window.SongPatterns.FILLS.find((f) => f.id === $("song-fill-style").value);
    if (!fill) return;
    Object.keys(fill.rows).filter((t) => EXTRA_TRACKS.includes(t) && !trackList().includes(t)).forEach(addDrumRow);
    trackList().forEach((t) => {
      if (fill.clear === "all" || fill.clear.includes(t)) for (let i = fill.from; i < STEPS; i++) songData.tracks[t][i] = false;
    });
    Object.entries(fill.rows).forEach(([t, levels]) => levels.forEach((level, k) => { songData.tracks[t][fill.from + k] = level; }));
    renderSequencer();
    patternAnnounce++;
    $("song-pattern-status").textContent = `${fill.label.replace(/ \(.*$/, "")} added over steps ${fill.from + 1} to ${STEPS}.${patternAnnounce % 2 ? "" : " "}`;
    scheduleAutosave();
    refreshWaveformPreview();
  });
  $("song-euclid-apply").addEventListener("click", () => {
    const hits = clampInt("song-euclid-hits", 0, STEPS);
    const rotate = clampInt("song-euclid-rotate", 0, STEPS - 1);
    patternEdit(() => window.SongPatterns.euclideanRow(hits, STEPS, rotate), `${hits} hit${hits === 1 ? "" : "s"} spread evenly${rotate ? `, turned ${rotate} step${rotate === 1 ? "" : "s"} later` : ""}`);
  });
  $("song-swing").addEventListener("input", () => {
    songData.swing = Number($("song-swing").value) || 0;
    $("song-swing").setAttribute("aria-valuetext", songData.swing ? `${songData.swing}% swing` : "Straight");
    refreshWaveformPreview();
    scheduleAutosave();
  });
  $("song-space").addEventListener("input", () => {
    songData.space = Number($("song-space").value) || 0;
    $("song-space").setAttribute("aria-valuetext", songData.space ? `${songData.space}% space` : "Dry");
    // Applied straight away so a held note or a MIDI-keyboard preview hears it, not just the next step.
    Engine.setSpace(getAudioCtx(), songData.space);
    Engine.setEcho(getAudioCtx(), songData.echo, songData.tempo);
    scheduleAutosave();
  });
  $("song-echo").addEventListener("input", () => {
    const amount = Number($("song-echo").value) || 0;
    if (amount) songData.echo = amount; else delete songData.echo; // a song with no echo has no echo field, as before
    $("song-echo").setAttribute("aria-valuetext", amount ? `${amount}% echo` : "Dry");
    Engine.setEcho(getAudioCtx(), songData.echo, songData.tempo);
    scheduleAutosave();
  });
  $("song-pump").addEventListener("input", () => {
    const amount = Number($("song-pump").value) || 0;
    if (amount) songData.pump = amount; else delete songData.pump; // a song with no pump has no pump field
    $("song-pump").setAttribute("aria-valuetext", amount ? `${amount}% pump` : "Off");
    refreshWaveformPreview();
    scheduleAutosave();
  });
  $("song-notes").addEventListener("input", () => {
    songData.private_notes = $("song-notes").value;
    scheduleAutosave();
  });
  // Renders the song's actual synthesized mix at full volume (via the same
  // OfflineAudioContext renderWaveformPeaks already uses, which forces
  // master_volume=1 internally regardless of the song's saved value -- see
  // song-engine.js) and reads its real peak amplitude, rather than
  // guessing from track/note counts -- several drums and melody notes
  // landing on the same 16th note can sum well past a single voice's own
  // level, so this is the only way to know the actual mixed peak.
  let normalizingPeak = false;
  $("song-normalize-peak").addEventListener("click", async () => {
    if (normalizingPeak) return;
    normalizingPeak = true;
    const btn = $("song-normalize-peak");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Scanning…";
    // Captured before the async render so switching songs or editing any
    // part of the current song makes this result stale.
    const myOpenGeneration = openGeneration;
    const myEditGeneration = songEditGeneration;
    try {
      const peaks = await Engine.renderWaveformPeaks(songData, 400);
      if (myOpenGeneration !== openGeneration || myEditGeneration !== songEditGeneration) return;
      const peakAmp = Math.max(0.0001, ...peaks.flatMap((p) => [Math.abs(p[0]), Math.abs(p[1])]));
      const TARGET_PEAK = 0.98; // a hair under full scale, not 1.0 exactly, for a small safety margin
      // Round down (not to nearest) to a whole percent, and use that SAME
      // rounded value everywhere -- for the slider display, the applied
      // live gain, and the persisted songData.master_volume -- rather than
      // storing full float precision while only the display was rounded.
      // A critic pass found that mismatch meant a later explicit Save
      // (which recomputes master_volume from the now-rounded slider) could
      // silently disagree with what autosave had already persisted, and
      // rounding to *nearest* instead of down could push the stored volume
      // above the level this scan actually proved safe against clipping.
      const newVolumePercent = Math.floor(Math.min(1, TARGET_PEAK / peakAmp) * 100);
      const newVolume = newVolumePercent / 100;
      const historyBefore = captureSongHistoryState();
      songData.master_volume = newVolume;
      $("song-master-volume").value = newVolumePercent;
      Engine.setMasterVolume(getAudioCtx(), newVolume);
      if (pushSongUndoState(historyBefore)) songEditGeneration++;
      scheduleAutosave();
      const unsavedNote = currentSongId ? "" : " (Save the song to keep this.)";
      const mutedParts = [...trackList().filter((t) => Engine.isTrackMuted(songData, t)).map((t) => TRACK_LABELS[t]), ...(Engine.isMelodyMuted(songData) ? ["Melody"] : [])];
      const mutedNote = mutedParts.length ? ` Muted parts (${mutedParts.join(", ")}) weren't counted, so unmuting them later can clip.` : "";
      alert(`Peak was ${Math.round(peakAmp * 100)}% of full scale. Master volume set to ${newVolumePercent}% to avoid clipping.${mutedNote}${unsavedNote}`);
    } catch (err) {
      alert("Couldn't scan the song's peak level: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
      normalizingPeak = false;
    }
  });
  $("song-name").addEventListener("input", () => {
    $("song-preview-name").textContent = $("song-name").value || "Song name";
    scheduleAutosave();
  });

  // Live peak + RMS meters -- both read the real master-bus signal via the
  // same metering AnalyserNode tapped off the master gain (see
  // song-engine.js), not a decorative animation driven by note data. One
  // shared requestAnimationFrame loop drives both bars from the same
  // buffer read each frame (RMS = root-mean-square, the average-loudness
  // companion figure a peak reading alone doesn't give -- it's always
  // lower than the peak for any real musical signal, which is expected,
  // not a bug in either meter).
  // PEAK_METER_DRAIN_MS covers this engine's longest realistic decay tail
  // after scheduling stops: up to 0.1s (SCHEDULE_AHEAD_S in
  // song-engine.js) for an already-scheduled note to actually start, plus
  // up to ~0.6s for the slowest kit's kick decay (the "808" kit's
  // kickDecay 0.55s + its own 0.05s stop buffer) to finish ringing out.
  const PEAK_METER_DRAIN_MS = 800;

  // ---------- Master clipping history ----------
  // The meter loop below already reads the real mixed output, so it also
  // notices when a frame reaches full scale (1.0; the red meter warns from
  // 0.98). Clipping frames that follow each other closely are one event whose
  // peak is the loudest frame in it; a long unbroken stretch is split so each
  // entry stays informative. Kept in memory for the open song only, and only
  // for the master bus -- there are no per-track meters to attribute a clip to.
  const CLIP_HISTORY_LIMIT = 50;
  const CLIP_EVENT_GAP_MS = 120;
  const CLIP_EVENT_MAX_MS = 2000;
  const CLIP_ANNOUNCE_INTERVAL_MS = 2000;
  let clipHistory = [];
  let clipTotal = 0;
  let lastClipAt = Number.NEGATIVE_INFINITY;
  let clipAnnounceTimer = null;
  let lastAnnounceAt = Number.NEGATIVE_INFINITY;
  // Steps are scheduled up to ~100ms before they sound, so the step heard at a
  // clip frame is the latest scheduled step whose time has already passed.
  let scheduledSteps = [];

  function noteScheduledStep(step, time, chainIndex, info) {
    scheduledSteps.push({ step, time, chainIndex: chainIndex || 0, pattern: info ? info.pattern : undefined, patterns: info ? info.patterns : undefined });
    if (scheduledSteps.length > 32) scheduledSteps.shift();
  }

  function audibleStepAt(audioTime) {
    let heard = scheduledSteps.length ? scheduledSteps[0].step : 0;
    for (const entry of scheduledSteps) {
      if (entry.time <= audioTime) heard = entry.step;
    }
    return heard;
  }

  function clipEventText(event) {
    const length = event.end - event.start;
    const span = length >= 250 ? `, lasting ${(length / 1000).toFixed(1)}s` : "";
    const where =
      event.stepStart === event.stepEnd
        ? `near step ${event.stepStart + 1} of ${STEPS}`
        : `from step ${event.stepStart + 1} to ${event.stepEnd + 1} of ${STEPS}`;
    return `Clip ${event.number}: ${where}, peak ${Math.round(event.peak * 100)}%${span}`;
  }

  function renderClipHistory() {
    $("song-clip-summary").textContent = `Clipping history (${clipTotal})`;
    $("song-clip-section").classList.toggle("song-clip-alert", clipTotal > 0);
    $("song-clip-empty").hidden = clipTotal > 0;
    $("song-clip-clear").disabled = clipTotal === 0;
    $("song-clip-list").hidden = clipTotal === 0;
    // Newest first, so a fresh clip is never hidden below the scroll fold.
    $("song-clip-list").innerHTML = clipHistory
      .slice()
      .reverse()
      .map((event) => `<li>${clipEventText(event)}</li>`)
      .join("");
    const dropped = clipTotal - clipHistory.length;
    $("song-clip-dropped").hidden = dropped <= 0;
    $("song-clip-dropped").textContent = dropped > 0 ? `Showing the latest ${clipHistory.length}; ${dropped} older ${dropped === 1 ? "entry was" : "entries were"} dropped.` : "";
  }

  // The first clip of a run is announced at once; after that at most one
  // announcement per interval, always ending on the latest count.
  function announceClips() {
    clearTimeout(clipAnnounceTimer);
    const wait = Math.max(0, CLIP_ANNOUNCE_INTERVAL_MS - (performance.now() - lastAnnounceAt));
    clipAnnounceTimer = setTimeout(() => {
      lastAnnounceAt = performance.now();
      $("song-clip-status").textContent = clipTotal ? `Clipped ${clipTotal} ${clipTotal === 1 ? "time" : "times"} so far` : "";
    }, wait);
  }

  function recordClipFrame(peak, now, audioTime, frameMs) {
    const last = clipHistory[clipHistory.length - 1];
    const heardStep = audibleStepAt(audioTime);
    // The gap is measured between animation frames, so it stretches with slow
    // frames (a busy or backgrounded tab) instead of splitting one clip in two.
    const gap = Math.max(CLIP_EVENT_GAP_MS, 3 * frameMs);
    let changed = false;
    if (!last || now - lastClipAt > gap || now - last.start > CLIP_EVENT_MAX_MS) {
      clipTotal++;
      clipHistory.push({ number: clipTotal, stepStart: heardStep, stepEnd: heardStep, peak, start: now, end: now });
      if (clipHistory.length > CLIP_HISTORY_LIMIT) clipHistory.shift();
      changed = true;
      announceClips();
    } else {
      // Sustained clipping repeats identical frames; only touch the DOM when
      // what the entry displays actually changes.
      const before = clipEventText(last);
      if (peak > last.peak) last.peak = peak;
      last.end = now;
      last.stepEnd = heardStep;
      changed = clipEventText(last) !== before;
    }
    lastClipAt = now;
    if (changed) renderClipHistory();
  }

  // Clear keeps the scheduled-step queue: a clip already inside the ~100ms
  // lookahead should still be attributed to the step that is sounding.
  function resetClipHistory({ keepSteps = false } = {}) {
    clipHistory = [];
    clipTotal = 0;
    lastClipAt = Number.NEGATIVE_INFINITY;
    if (!keepSteps) scheduledSteps = [];
    lastAnnounceAt = Number.NEGATIVE_INFINITY;
    clearTimeout(clipAnnounceTimer);
    $("song-clip-status").textContent = "";
    renderClipHistory();
  }
  $("song-clip-clear").addEventListener("click", () => {
    resetClipHistory({ keepSteps: true });
    $("song-clip-summary").focus(); // the button just disabled itself
  });

  let peakMeterRaf = null;
  let peakMeterDrainTimer = null;
  function startPeakMeter() {
    clearTimeout(peakMeterDrainTimer);
    peakMeterDrainTimer = null;
    if (peakMeterRaf) return; // already running -- e.g. Stop then Play again before the drain finished
    const analyser = Engine.getPeakMeterAnalyser(getAudioCtx());
    const buffer = new Float32Array(analyser.fftSize);
    const peakFill = $("song-peak-meter-fill");
    const rmsFill = $("song-rms-meter-fill");
    // Spectrum reads frequency-domain data off the exact same shared
    // AnalyserNode the peak/RMS meters already tap -- both representations
    // (time-domain and frequency-domain) are always available from one
    // analyser every frame, so no second node or extra audio-graph
    // connection is needed.
    const spectrumCanvas = $("song-spectrum");
    const spectrumCtx = spectrumCanvas.getContext("2d");
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const SPECTRUM_BARS = 24;
    function drawSpectrum() {
      analyser.getByteFrequencyData(freqData);
      const w = spectrumCanvas.width;
      const h = spectrumCanvas.height;
      spectrumCtx.clearRect(0, 0, w, h);
      const binsPerBar = Math.floor(freqData.length / SPECTRUM_BARS);
      const barWidth = w / SPECTRUM_BARS;
      spectrumCtx.fillStyle = "#4dff6a"; // matches the pre-existing peak meter's own hardcoded fill color (style.css's .song-peak-meter-fill), not var(--accent) -- consistent with that established VU-meter-color convention, not a themeable element
      for (let bar = 0; bar < SPECTRUM_BARS; bar++) {
        let sum = 0;
        const start = bar * binsPerBar;
        // The last bar absorbs any remainder bins from the floor() above
        // (1024 bins / 24 bars leaves 16 left over) so the highest-
        // frequency content is folded in rather than silently never drawn.
        const end = bar === SPECTRUM_BARS - 1 ? freqData.length : start + binsPerBar;
        for (let i = start; i < end; i++) sum += freqData[i];
        const avg = sum / (end - start); // 0-255
        const barHeight = (avg / 255) * h;
        spectrumCtx.fillRect(bar * barWidth, h - barHeight, Math.max(1, barWidth - 1), barHeight);
      }
    }
    let lastTickAt = performance.now();
    function tick() {
      const tickAt = performance.now();
      const frameMs = tickAt - lastTickAt;
      lastTickAt = tickAt;
      analyser.getFloatTimeDomainData(buffer);
      let peak = 0;
      let sumSquares = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = buffer[i];
        const abs = Math.abs(v);
        if (abs > peak) peak = abs;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / buffer.length);
      peakFill.style.width = Math.min(100, Math.round(peak * 100)) + "%";
      peakFill.classList.toggle("song-peak-meter-clip", peak >= 0.98);
      if (peak >= 1) recordClipFrame(peak, tickAt, getAudioCtx().currentTime, frameMs);
      rmsFill.style.width = Math.min(100, Math.round(rms * 100)) + "%";
      drawSpectrum();
      peakMeterRaf = requestAnimationFrame(tick);
    }
    tick();
  }
  function stopPeakMeter() {
    // player.stop() only clears the step-scheduling timer -- it doesn't
    // stop already-triggered oscillators/buffer sources, which keep
    // decaying on their own for up to PEAK_METER_DRAIN_MS. A critic pass
    // found that hard-resetting the meter to 0% the instant Stop is
    // clicked visibly disagreed with drum/melody sound that was still
    // actually audible. Keep the same rAF loop running so both meters
    // keep tracking the real, decaying signal, and only reset once the
    // tail has had time to finish.
    clearTimeout(peakMeterDrainTimer);
    peakMeterDrainTimer = setTimeout(() => {
      if (peakMeterRaf) cancelAnimationFrame(peakMeterRaf);
      peakMeterRaf = null;
      const peakFill = $("song-peak-meter-fill");
      peakFill.style.width = "0%";
      peakFill.classList.remove("song-peak-meter-clip");
      $("song-rms-meter-fill").style.width = "0%";
      const spectrumCanvas = $("song-spectrum");
      spectrumCanvas.getContext("2d").clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
    }, PEAK_METER_DRAIN_MS);
  }

  // Where a paused song carries on from (null: from the top). Only the Studio's Pause sets it; every ordinary stop clears it.
  let resumeFrom = null;
  function startOptions() {
    const options = Object.assign({}, playOptions(), resumeFrom || {});
    resumeFrom = null;
    return options;
  }
  function pausePlayback() {
    if (!player.isPlaying() && !isCountingIn()) return false;
    let from = null;
    if (player.isPlaying() && !isCountingIn()) {
      const now = getAudioCtx().currentTime;
      let heard = null;
      for (const entry of scheduledSteps) if (entry.time <= now) heard = entry;
      if (heard) from = { step: heard.step, chainIndex: heard.chainIndex };
    }
    stopPlayback();
    resumeFrom = from;
    return true;
  }
  function startPlayback() {
    const beats = metroPrefs.countIn;
    ensureAudio();
    if (!beats) {
      player.start(undefined, startOptions());
      startPeakMeter();
      $("song-play").textContent = "Stop";
      return;
    }
    // Count-in: the clicks AND the song's first step are both placed on the audio clock, so the song starts exactly
    // when the last count-in beat ends, whatever the main thread or a throttled tab is doing. The audio context
    // is resumed first (a suspended one has a frozen clock).
    const token = ++countInToken;
    countInActive = true;
    const silent = metroPrefs.volume <= 0;
    $("song-play").textContent = silent ? "Stop (counting in, click volume is 0…)" : "Stop (counting in…)";
    const live = $("song-transport-live");
    if (live) live.textContent = `Counting in ${beats} beats`;
    const ctx = getAudioCtx();
    Promise.resolve(ctx.state !== "running" ? ctx.resume() : null)
      .catch(() => {})
      .then(() => {
        if (token !== countInToken) return;
        const beatSec = 60 / (songData.tempo || 120);
        const t0 = ctx.currentTime + 0.08;
        countInOscs = [];
        for (let i = 0; i < beats; i++) {
          const o = metroClickAt(t0 + i * beatSec, metroPrefs.accent && i % 4 === 0);
          if (o) countInOscs.push(o);
        }
        const startAt = t0 + beats * beatSec;
        player.start(startAt, startOptions());
        startPeakMeter();
        countInTimer = setTimeout(() => {
          countInTimer = null;
          countInActive = false;
          countInOscs = [];
          $("song-play").textContent = "Stop";
          if (live) live.textContent = "Playing";
        }, Math.max(0, (startAt - ctx.currentTime) * 1000));
      });
  }

  function stopPlayback() {
    cancelCountIn();
    resumeFrom = null;
    player.stop();
    if (window.SongStudio) window.SongStudio.stopped();
    stopPeakMeter();
    document.querySelectorAll(".song-step").forEach((el) => el.classList.remove("song-step-playing"));
    $("song-preview-bars")
      .querySelectorAll(".song-embed-bar")
      .forEach((bar) => bar.classList.remove("song-embed-bar-active"));
    $("song-preview-pulse").classList.remove("song-embed-pulse-beat", "song-embed-pulse-hit");
    markPlayingOrderChip(-1);
    if (pageSyncOverlay) pageSyncOverlay.classList.remove("song-page-sync-hit");
    drawWaveformPreview(0);
    $("song-play").textContent = "Play";
  }

  $("song-play").addEventListener("click", () => {
    if (player.isPlaying() || isCountingIn()) stopPlayback();
    else startPlayback();
  });

  $("song-transpose-down").addEventListener("click", () => transposeMelody(-1));
  $("song-transpose-up").addEventListener("click", () => transposeMelody(1));
  $("song-transpose-octave-down").addEventListener("click", () => transposeMelody(-12));
  $("song-transpose-octave-up").addEventListener("click", () => transposeMelody(12));

  // ---------- Web MIDI input ----------
  // Progressive enhancement: the "Connect MIDI" button only ever appears
  // if the browser actually supports the API at all — no point offering a
  // control that can't work. Only two behaviors once connected: live
  // preview (every note-on plays immediately, so an external keyboard
  // works as an instrument monitor) and, only while the sequencer is
  // playing and "Record" is checked, writing the note into the piano roll
  // at whatever step is currently playing.
  // Shared by both MIDI input and computer-keyboard note entry below: play
  // the note immediately as a live preview, and — only while the sequencer
  // is playing and "Record" is checked — also write it into the piano roll
  // at whatever step is currently playing.
  // The roll row a played note lands on: the note itself in the melody roll, and for the bass line the same note folded by octaves into
  // C1 to B2 (so a keyboard played in the middle of its range still records a bass line).
  function rowForNote(name) {
    if (!isBassRoll()) return name;
    const m = /^([A-G]#?)(\d)$/.exec(name);
    if (!m) return name;
    let number = NOTE_NAMES.indexOf(m[1]) + (Number(m[2]) + 1) * 12;
    while (number < 24) number += 12;
    while (number > 47) number -= 12;
    return NOTE_NAMES[number % 12] + (Math.floor(number / 12) - 1);
  }
  // Where a hit played now lands while recording: the step that is sounding at this moment and the pattern the track plays in this bar (the
  // heard step, not the one scheduled a moment ahead). null when the track is silent in this bar.
  function recordingSpot(trackKey) {
    if (!player.isPlaying() || isCountingIn() || !$("song-record").checked) return null;
    const now = getAudioCtx().currentTime;
    let heard = null;
    for (const entry of scheduledSteps) if (entry.time <= now) heard = entry;
    let step = heard ? heard.step : player.currentStep();
    let at = heard;
    // Quantize: a note played a little before the next step belongs to that step. Past the last step of a bar it belongs to the next bar's
    // first step if that one is already scheduled, else it stays on the last grid line of this bar.
    if (heard && quantizeSteps) {
      const stepSeconds = Engine.stepDurationFor(songData.tempo);
      const fraction = Math.max(0, Math.min(1, (now - heard.time) / stepSeconds));
      const target = Math.round((heard.step + fraction) / quantizeSteps) * quantizeSteps;
      if (target <= STEPS - 1) step = target;
      else {
        const next = scheduledSteps.find((entry) => entry.time > heard.time && entry.step === 0 && entry.time - now < stepSeconds * 2);
        if (next) {
          step = 0;
          at = next;
        } else step = Math.floor((STEPS - 1) / quantizeSteps) * quantizeSteps;
      }
    }
    let pattern;
    if (at && at.patterns && Object.prototype.hasOwnProperty.call(at.patterns, trackKey)) pattern = at.patterns[trackKey];
    else pattern = at && at.pattern ? at.pattern : player.currentPattern();
    return pattern ? { step, pattern } : null;
  }
  // The stored (not open) pattern `name`, with the lane `lanes` ({ row or note: steps }) of the part made if it is not there yet.
  function storedLane(name, key, rowName) {
    const stored = songData.patterns && songData.patterns[name];
    if (!stored || typeof stored !== "object") return null;
    let holder = stored;
    let lanes;
    if (key === "drums") {
      if (!stored.tracks) stored.tracks = {};
      lanes = stored.tracks;
    } else if (key === "melody") {
      if (!stored.notes) stored.notes = {};
      lanes = stored.notes;
    } else {
      if (!stored[key]) stored[key] = { notes: {}, ties: {} };
      if (!stored[key].notes) stored[key].notes = {};
      holder = stored[key];
      lanes = holder.notes;
    }
    if (!Array.isArray(lanes[rowName])) lanes[rowName] = new Array(STEPS).fill(false);
    return lanes[rowName];
  }
  // A drum pad (the Studio's keys on a drum layer): it sounds the drum, and while recording it also turns that step on in the pattern the
  // drums play in this bar through the grid's own click, so undo, autosave and the preview behave as for a hand-placed step.
  // A drum row's sound on its own, for the ear.
  function soundDrum(row) {
    if (!songData.tracks || !songData.tracks[row]) return false;
    const ctx = ensureAudio();
    const meta = Object.assign({}, songData.trackMeta && songData.trackMeta[row], { muted: false });
    const one = Object.assign({}, songData, { tracks: { [row]: [true] }, trackMeta: { [row]: meta }, melody: { notes: {} }, bass: undefined, chords: undefined, lead: undefined });
    Engine.scheduleStep(ctx, one, 0, ctx.currentTime);
    return true;
  }
  function auditDrumHit(row) {
    if (!soundDrum(row)) return;
    const spot = recordingSpot("drums");
    if (!spot) return;
    if (spot.pattern !== editingPattern()) {
      const lane = storedLane(spot.pattern, "drums", row);
      if (lane && !lane[spot.step]) {
        lane[spot.step] = true;
        refreshWaveformPreview();
        scheduleAutosave();
      }
      return;
    }
    if (songData.tracks[row][spot.step]) return;
    const cell = $("song-sequencer").querySelector(`.song-step[data-row="${row}"][data-step="${spot.step}"]`);
    if (cell) cell.click();
  }
  function playAndMaybeRecordNote(requested) {
    if (window.SongStudio && window.SongStudio.drumTrackOpen()) return; // notes would land in a part that is not on screen
    requested = snapToScale(requested, (candidate) => Boolean(roll().notes[rowForNote(candidate)]));
    if (window.SongStudio) window.SongStudio.played(requested);
    const ctx = ensureAudio();
    const noteName = rowForNote(requested);
    const part = roll();
    const duration = 60 / (songData.tempo || 120) / 4;
    if (isPartRoll()) {
      Engine.withVolume(ctx, Engine.volumeOf(part), () => Engine.playVoicedNote(ctx, ctx.currentTime, Engine.noteToFreq(noteName), Engine.partVoiceOf(songData, rollPart), duration, part.synth));
    } else {
      const waveform = $("song-waveform").value;
      const voice = Engine.melodyVoiceOf(songData);
      Engine.withVolume(ctx, Engine.volumeOf(songData.melody), () =>
        voice ? Engine.playVoicedNote(ctx, ctx.currentTime, Engine.noteToFreq(noteName), voice, duration, songData.melody.synth) : Engine.playMelodyNote(ctx, ctx.currentTime, Engine.noteToFreq(noteName), waveform, duration));
    }
    if (!part.notes[noteName]) return; // outside the 2-octave piano roll range — preview only
    const spot = recordingSpot(rollPart);
    if (spot && spot.pattern !== editingPattern()) {
      const lane = storedLane(spot.pattern, rollPart, noteName);
      if (lane && !lane[spot.step]) {
        lane[spot.step] = true;
        refreshWaveformPreview();
        scheduleAutosave();
      }
    } else if (spot) {
      const step = spot.step;
      const wasRecorded = Boolean(part.notes[noteName][step]);
      if (!wasRecorded) part.notes[noteName][step] = true;
      // Recording into a collapsed piano roll would write notes nobody can see.
      const revealed = part.hidden === true;
      if (revealed) {
        setFlag(part, "hidden", false);
        renderPianoRoll();
      }
      const cell = document.querySelector(`.song-steps[data-row="${noteName}"] .song-step[data-step="${step}"]`);
      if (cell) cell.classList.add("song-step-on");
      if (!wasRecorded || revealed) scheduleAutosave();
    }
  }

  // A note of a track played for the ear only (a slider released in the Studio's sound settings), with the track's sound as it is now.
  function hearNote(id, name) {
    const ctx = ensureAudio();
    const duration = 60 / (songData.tempo || 120) / 4;
    const part = id === "melody" ? songData.melody : songData[id];
    const voice = id === "melody" ? Engine.melodyVoiceOf(songData) : Engine.partVoiceOf(songData, id);
    const volume = Engine.volumeOf(part);
    Engine.withVolume(ctx, volume, () => (voice ? Engine.playVoicedNote(ctx, ctx.currentTime, Engine.noteToFreq(name), voice, duration * 2, part && part.synth) : Engine.playMelodyNote(ctx, ctx.currentTime, Engine.noteToFreq(name), $("song-waveform").value, duration * 2)));
  }
  function handleMidiMessage(msg) {
    const [status, note, velocity] = msg.data;
    const isNoteOn = status >> 4 === 9 && velocity > 0;
    if (!isNoteOn) return;
    // Drum pads (channel 10, or any note while the Studio has the drums open): General MIDI drum notes play and record the matching row.
    if (window.SongStudio && window.SongStudio.drumTrackOpen()) {
      const row = window.SongFiles && window.SongFiles.GM_TO_ROW[note];
      if (row) auditDrumHit(row);
      return;
    }
    const noteName = Engine.midiToNoteName(note);
    const shouldRecord = Boolean(recordingSpot(rollPart)) && !!roll().notes[rowForNote(snapToScale(noteName, (candidate) => Boolean(roll().notes[rowForNote(candidate)])))];
    const historyBefore = shouldRecord ? captureSongHistoryState() : null;
    playAndMaybeRecordNote(noteName);
    if (historyBefore && pushSongUndoState(historyBefore)) songEditGeneration++;
  }

  if (navigator.requestMIDIAccess) {
    $("song-midi-connect").hidden = false;
    $("song-midi-connect").addEventListener("click", async () => {
      try {
        const access = await navigator.requestMIDIAccess();
        // Wires up every currently-known input AND re-runs on every future
        // `statechange` (a device plugged in or unplugged after the initial
        // connect) -- so a MIDI keyboard plugged in mid-session gets picked
        // up automatically instead of silently doing nothing until the page
        // is reloaded and "Connect MIDI" clicked again.
        function refreshMidiDevices() {
          // Per the Web MIDI spec, unplugging a device does NOT remove its
          // entry from `access.inputs` -- the port object is kept around
          // (so replugging the same physical device can reuse it) and only
          // its `.state` flips from "connected" to "disconnected". Wiring
          // and counting every entry unconditionally would keep reporting
          // an unplugged device as connected forever.
          const connected = Array.from(access.inputs.values()).filter((i) => i.state !== "disconnected");
          connected.forEach((input) => (input.onmidimessage = handleMidiMessage));
          const names = connected.map((i) => i.name || "Unnamed device");
          if (names.length === 0) {
            $("song-midi-connect").textContent = "No MIDI devices found";
            $("song-midi-connect").title = "Plug in a MIDI keyboard/controller — it'll be picked up automatically, no need to click again.";
          } else {
            $("song-midi-connect").textContent = `${names.length} MIDI device${names.length === 1 ? "" : "s"} connected`;
            $("song-midi-connect").title = names.join(", ");
          }
        }
        refreshMidiDevices();
        access.onstatechange = refreshMidiDevices;
        $("song-midi-connect").disabled = true;
        $("song-record-label").hidden = false;
      } catch (err) {
        alert("Couldn't access MIDI devices: " + err.message);
      }
    });
    // Already allowed on an earlier visit: connect without asking again, so a keyboard just works when the builder opens.
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "midi" }).then((state) => {
        if (state.state === "granted" && !$("song-midi-connect").disabled) $("song-midi-connect").click();
      }).catch(() => {});
    }
  }

  // ---------- Computer-keyboard note entry ----------
  // No hardware to "connect" here, unlike MIDI above — the browser's own
  // keydown events are always available, so this is armed as soon as the
  // song builder modal is open, gated only by the same isTyping guard the
  // simulation builder's own keyboard shortcuts already use (so typing a
  // song name or an option value never gets hijacked as a note). Mirrors
  // the classic Ableton-style "typing keyboard" layout: ZXCVBNM plus
  // SDGHJ (black keys) for the lower of the piano roll's two octaves,
  // QWERTYU plus 23567 for the upper octave — 12 keys per row, exactly
  // matching one octave each, so every key maps to exactly one note with
  // no leftover or ambiguous keys.
  const KEYBOARD_NOTE_MAP = {
    z: "C", s: "C#", x: "D", d: "D#", c: "E", v: "F", g: "F#", b: "G", h: "G#", n: "A", j: "A#", m: "B",
    q: "C", "2": "C#", w: "D", "3": "D#", e: "E", r: "F", "5": "F#", t: "G", "6": "G#", y: "A", "7": "A#", u: "B",
  };
  const KEYBOARD_NOTE_OCTAVE = {
    z: 3, s: 3, x: 3, d: 3, c: 3, v: 3, g: 3, b: 3, h: 3, n: 3, j: 3, m: 3,
    q: 4, "2": 4, w: 4, "3": 4, e: 4, r: 4, "5": 4, t: 4, "6": 4, y: 4, "7": 4, u: 4,
  };
  document.addEventListener("keydown", (e) => {
    if ($("song-builder-modal").hidden) return;
    if (e.repeat) return; // a held key must play the note once, not retrigger on every OS auto-repeat tick
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (document.activeElement && document.activeElement.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (!(key in KEYBOARD_NOTE_MAP)) return;
    e.preventDefault();
    playAndMaybeRecordNote(KEYBOARD_NOTE_MAP[key] + (KEYBOARD_NOTE_OCTAVE[key] + (rollPart === "lead" ? 1 : 0)));
  });
  // Space plays and stops, the way it does in a music program. It only counts when no control has the focus (on a button, a step or a
  // field, Space already means "press this"), and only while the song builder is the dialog on top.
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " || e.repeat || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const modal = $("song-builder-modal");
    if (modal.hidden) return;
    const active = document.activeElement;
    if (active && active !== document.body && !(active === modal)) {
      if (!modal.contains(active) || active.matches('input, textarea, select, button, a[href], summary, [contenteditable], [role="button"], [role="tab"], [role="checkbox"], [role="slider"], [tabindex]:not([tabindex="-1"])') || active.isContentEditable) return;
    }
    const z = (m) => Number(getComputedStyle(m).zIndex) || 0;
    if ([...document.querySelectorAll(".modal:not([hidden])")].some((m) => m !== modal && z(m) >= z(modal))) return;
    e.preventDefault();
    if (window.SongStudio && window.SongStudio.active()) window.SongStudio.toggle(); // the Studio pauses and carries on; the classic Play stops
    else $("song-play").click();
  });
  // [ and ] open the previous / next pattern, under the same rules as Space (nothing focused that wants the key, builder on top).
  document.addEventListener("keydown", (e) => {
    if ((e.key !== "[" && e.key !== "]") || e.repeat || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const modal = $("song-builder-modal");
    if (modal.hidden) return;
    const active = document.activeElement;
    if (active && active !== document.body && !(active === modal)) {
      if (!modal.contains(active) || active.matches('input, textarea, select, [contenteditable]') || active.isContentEditable) return;
    }
    const z = (m) => Number(getComputedStyle(m).zIndex) || 0;
    if ([...document.querySelectorAll(".modal:not([hidden])")].some((m) => m !== modal && z(m) >= z(modal))) return;
    const names = Engine.patternNames(songData);
    if (names.length < 2) return;
    const at = names.indexOf(editingPattern());
    const next = names[(at + (e.key === "]" ? 1 : names.length - 1)) % names.length];
    e.preventDefault();
    if (openPattern(next)) afterPatternSwitch(`Editing pattern ${next}: ${partsSummary(next)}.`);
  });
  document.addEventListener("keydown", finishSongHistoryEvent);
  $("song-record-label").hidden = false;

  // Inverted from KEYBOARD_NOTE_MAP/KEYBOARD_NOTE_OCTAVE (note+octave ->
  // the physical key that plays it) rather than a second, separately
  // maintained table -- used by the on-screen keyboard below (item #314)
  // to show each note's own keyboard shortcut, so it doubles as the
  // legend a critic pass on the computer-keyboard feature (#315) noted
  // was otherwise completely undiscoverable (no on-screen hint existed
  // anywhere for which keys played which notes).
  const NOTE_TO_KEYBOARD_KEY = {};
  Object.keys(KEYBOARD_NOTE_MAP).forEach((key) => {
    NOTE_TO_KEYBOARD_KEY[KEYBOARD_NOTE_MAP[key] + KEYBOARD_NOTE_OCTAVE[key]] = key.toUpperCase();
  });

  const SONG_ICON_ATTRS = 'viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const SONG_EYE_ICON = `<svg ${SONG_ICON_ATTRS}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const SONG_EYE_OFF_ICON = `<svg ${SONG_ICON_ATTRS}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/><line x1="3" y1="21" x2="21" y2="3"/></svg>`;

  // ---------- Sequencer grid ----------
  // Shared by the drum sequencer and the piano roll — both are just a set
  // of named rows, each STEPS long, toggled the same way. Parameterized by
  // plain get/set functions rather than duplicated per grid.
  // `getMeta`/`onMetaChange` are optional and only passed for the drum
  // sequencer, not the piano roll -- a color+note swatch per PIANO_NOTES row
  // (2 octaves) would be far too many controls to be useful, whereas the 4
  // fixed drum tracks are exactly the kind of small, named "channel" list a
  // per-row color/label actually helps distinguish at a glance.
  // `onLabelClick` is optional and only passed for the piano roll (item
  // #314, "on-screen keyboard") -- rendering the row label as a clickable
  // button that previews/records the note wired to the exact same
  // playAndMaybeRecordNote() the computer-keyboard and MIDI paths already
  // use, rather than a third parallel implementation of "play this note."
  // Not passed for the drum sequencer, since its rows are sounds, not a
  // pitched instrument with keys to click.
  function renderStepGrid(containerId, rowKeys, rowLabel, getOn, setOn, rowClass, getMeta, onMetaChange, onLabelClick) {
    $(containerId).innerHTML = rowKeys
      .map((key) => {
        const label = rowLabel(key);
        const meta = getMeta ? getMeta(key) : null;
        const rowStyle = meta ? ` style="--track-color: ${escapeXml(meta.color)}"` : "";
        const muted = Boolean(meta) && meta.muted === true;
        const hidden = Boolean(meta) && meta.hidden === true;
        const toggleHtml = meta
          ? `<button type="button" class="song-track-toggle song-track-mute" data-row="${key}" aria-pressed="${muted}" aria-label="Mute ${label}" title="Mute ${label}: silent in the preview and on the public page">M</button>` +
            `<button type="button" class="song-track-toggle song-track-hide" data-row="${key}" aria-pressed="${hidden}" aria-label="Hide ${label} row" title="Hide ${label} row: collapses it here in the editor, but it still plays unless muted">${hidden ? SONG_EYE_OFF_ICON : SONG_EYE_ICON}</button>`
          : "";
        // An added drum row has a × at its far end (not beside Mute and Hide, which would push its steps out of line with the rows above).
        const removeHtml = containerId === "song-sequencer" && EXTRA_TRACKS.includes(key)
          ? `<button type="button" class="song-track-toggle song-track-remove" data-row="${key}" aria-label="Remove ${label} row" title="Remove the ${label} row from this song (undoable)">×</button>`
          : "";
        if (hidden) {
          return `<div class="song-track-row song-track-row-hidden${muted ? " song-track-row-muted" : ""}"${rowStyle}><span class="song-track-label">${label}</span>${toggleHtml}<span class="song-track-hidden-note">Hidden, ${
            muted ? "muted" : "still plays"
          }${reportVolume(meta)}</span>${removeHtml}</div>`;
        }
        const metaHtml = meta
          ? `<input type="color" class="song-track-color" data-row="${key}" value="${escapeXml(meta.color)}" title="${label} color" aria-label="${label} color">` +
            `<input type="text" class="song-track-note" data-row="${key}" value="${escapeXml(meta.note)}" placeholder="note…" maxlength="60" title="${label} note" aria-label="${label} note">` +
            `<input type="range" class="song-track-volume" data-row="${key}" min="0" max="100" value="${Math.round((Number.isFinite(Number(meta.volume)) && meta.volume != null ? Math.max(0, Math.min(1, Number(meta.volume))) : 1) * 100)}" title="${label} volume" aria-label="${label} volume" aria-valuetext="${volumeText(meta.volume)}">`
          : "";
        // The keyboard-shortcut hint (e.g. "Q") is shown right in the
        // clickable label itself rather than only in a hover tooltip --
        // a tooltip alone (as this session's #315 critic pass on the
        // typing-keyboard feature found) requires already knowing to
        // hover over the right element, which defeats its own purpose as
        // a discoverability aid for someone who doesn't already know the
        // key layout exists.
        // aria-hidden on the hint span (its content is fully repeated,
        // spelled out, in aria-label below) and an explicit aria-label
        // instead of relying on the button's own text content -- a
        // critic pass found that without these, a screen reader's
        // computed accessible name was the raw glued-together text "C4
        // Q", ambiguous about whether "Q" is part of the note name or a
        // shortcut hint. tabindex="-1" removes the button from Tab
        // order entirely (still fully clickable by mouse) -- the same
        // critic pass found that WITHOUT it, tabbing through the piano
        // roll (the natural way to navigate a 16x24 step grid by
        // keyboard) now hit 24 extra stops interleaved one per row,
        // rather than being appended at the end or skipped -- a real,
        // if non-blocking, keyboard-navigation regression this button
        // would otherwise introduce.
        const keyHint = onLabelClick && NOTE_TO_KEYBOARD_KEY[key] ? ` <span class="song-key-hint" aria-hidden="true">${NOTE_TO_KEYBOARD_KEY[key]}</span>` : "";
        const labelHtml = onLabelClick
          ? `<button type="button" class="song-track-label song-track-label-playable" data-row="${key}" tabindex="-1" aria-label="${label}, press ${
              NOTE_TO_KEYBOARD_KEY[key] || "its keyboard shortcut"
            } to play" title="Click to preview this note (or press its keyboard shortcut, ${
              NOTE_TO_KEYBOARD_KEY[key] || "?"
            }, when not typing in a text field)">${label}${keyHint}</button>`
          : `<span class="song-track-label">${label}</span>`;
        return `<div class="song-track-row${rowClass ? rowClass(key) : ""}${muted ? " song-track-row-muted" : ""}"${rowStyle}>${labelHtml}${toggleHtml}${metaHtml}<div class="song-steps" data-row="${key}">${Array.from(
          { length: STEPS },
          (_, i) =>
            `<button type="button" class="song-step${getOn(key, i) ? " song-step-on" : ""}${
              i % 4 === 0 ? " song-step-beat" : ""
            }" data-row="${key}" data-step="${i}"${stepLevelAttrs(getOn(key, i))} aria-label="${label} step ${i + 1}${stepLevelSpoken(getOn(key, i))}"></button>`
        ).join("")}</div>${removeHtml}</div>`;
      })
      .join("");
    if (onLabelClick) {
      $(containerId)
        .querySelectorAll(".song-track-label-playable")
        .forEach((btn) => {
          btn.addEventListener("click", () => onLabelClick(btn.dataset.row));
        });
    }
    $(containerId)
      .querySelectorAll(".song-step")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const key = btn.dataset.row;
          const step = Number(btn.dataset.step);
          // The "Step strength" menu decides how hard a step is struck: clicking an empty step turns it on at that strength,
          // clicking an on step of a different strength changes it, and clicking one that already matches turns it off.
          const level = selectedStepLevel();
          const current = getOn(key, step);
          const next = !current || Engine.stepLevel(current) !== level ? (level >= 1 ? true : level) : false;
          setOn(key, step, next);
          btn.classList.toggle("song-step-on", Boolean(next));
          if (next && next !== true) btn.style.setProperty("--lv", String(next)); else btn.style.removeProperty("--lv");
          btn.setAttribute("aria-label", btn.getAttribute("aria-label").replace(/, (soft|medium)$/, "") + stepLevelSpoken(next));
          $("song-step-status").textContent = `${btn.getAttribute("aria-label").replace(/,.*$/, "").replace(/ step (\d+).*$/, " step $1")}: ${!next ? "off" : Engine.stepLevel(next) >= 1 ? "full" : Engine.stepLevel(next) >= 0.5 ? "medium" : "soft"}.`;
          refreshWaveformPreview();
          scheduleAutosave();
        });
      });
    if (!onMetaChange) return;
    $(containerId)
      .querySelectorAll(".song-track-mute")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const next = getMeta(btn.dataset.row).muted !== true;
          onMetaChange(btn.dataset.row, "muted", next);
          btn.setAttribute("aria-pressed", String(next));
          btn.closest(".song-track-row").classList.toggle("song-track-row-muted", next);
          refreshWaveformPreview();
          scheduleAutosave();
        });
      });
    $(containerId)
      .querySelectorAll(".song-track-hide")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          onMetaChange(btn.dataset.row, "hidden", getMeta(btn.dataset.row).hidden !== true);
          scheduleAutosave();
        });
      });
    $(containerId)
      .querySelectorAll(".song-track-color")
      .forEach((inp) => {
        inp.addEventListener("input", () => {
          onMetaChange(inp.dataset.row, "color", inp.value);
          inp.closest(".song-track-row").style.setProperty("--track-color", inp.value);
          scheduleAutosave();
        });
      });
    $(containerId)
      .querySelectorAll(".song-track-volume")
      .forEach((inp) => {
        inp.addEventListener("input", () => {
          const v = Number(inp.value) / 100;
          onMetaChange(inp.dataset.row, "volume", v);
          inp.setAttribute("aria-valuetext", volumeText(v));
          refreshWaveformPreview();
          scheduleAutosave();
        });
      });
    $(containerId)
      .querySelectorAll(".song-track-note")
      .forEach((inp) => {
        inp.addEventListener("input", () => {
          onMetaChange(inp.dataset.row, "note", inp.value);
          scheduleAutosave();
        });
      });
  }

  const STEP_LEVELS = { full: 1, medium: 0.65, soft: 0.35 };
  const selectedStepLevel = () => STEP_LEVELS[$("song-step-level").value] || 1;
  // On steps below full strength carry their level as a number in the same array (true = full), so every
  // consumer that only asks "is it on?" keeps working and older songs are unchanged.
  const stepLevelAttrs = (v) => (v && Engine.stepLevel(v) < 1 ? ` style="--lv: ${Engine.stepLevel(v)}"` : "");
  const stepLevelSpoken = (v) => (!v || Engine.stepLevel(v) >= 1 ? "" : Engine.stepLevel(v) >= 0.5 ? ", medium" : ", soft");
  // A track's volume is only stored while below full, so songs that never touch it save exactly as before.
  function volumeText(v) {
    const n = Number(v);
    return `${Math.round((Number.isFinite(n) && v != null ? Math.max(0, Math.min(1, n)) : 1) * 100)}%`;
  }
  // Whether the open pattern's bass line has a note (a bass line with nothing in it is not saved and not reported).
  const partHasNotes = (key) => Boolean(songData[key] && songData[key].notes && Object.values(songData[key].notes).some((lane) => Array.isArray(lane) && lane.some(Boolean)));
  const bassHasNotes = () => partHasNotes("bass");
  const reportVolume = (meta) => (Engine.volumeOf(meta) < 1 ? ` (volume ${Math.round(Engine.volumeOf(meta) * 100)}%)` : "");
  function setVolume(target, value) {
    if (value >= 1) delete target.volume;
    else target.volume = Math.max(0, Math.min(1, value));
  }

  // "muted" and "hidden" are only stored while true, so a song that never uses
  // them saves byte-for-byte the same as before this feature existed.
  function setFlag(target, field, value) {
    if (value) target[field] = true;
    else delete target[field];
  }

  // ---------- Bars-and-beats and time ruler ----------
  // A strip above each grid labelling its 16 steps the way a musician counts them (1 e & a 2 e & a ...) with the
  // absolute time of each beat at the current tempo underneath. It is decoration (aria-hidden: every step button
  // already has its own spoken label), lined up with the real step grid by measuring it, and redrawn whenever the grid
  // is, the tempo changes or the panel is resized.
  const RULER_SUBDIVISIONS = ["", "e", "&", "a"];
  // The tempo field accepts 40-240 (a typed value outside it is shown clamped here rather than as negative or zero time).
  function formatRulerTime(seconds) {
    return `${seconds.toFixed(2)}s`;
  }
  function renderRuler(containerId) {
    const container = $(containerId);
    const ruler = $(`${containerId}-ruler`);
    if (!container || !ruler) return;
    const steps = container.querySelector(".song-steps");
    if (!steps) {
      ruler.hidden = true; // every row is collapsed: nothing to line up with
      return;
    }
    ruler.hidden = false;
    const stepSeconds = 60 / Math.min(240, Math.max(40, Number(songData.tempo) || 120)) / 4;
    ruler.innerHTML =
      '<div class="song-steps song-ruler-steps">' +
      Array.from({ length: STEPS }, (_, i) => {
        const beat = i % 4 === 0;
        const label = beat ? String(i / 4 + 1) : RULER_SUBDIVISIONS[i % 4];
        return `<span class="song-step song-ruler-cell${beat ? " song-step-beat song-ruler-beat" : ""}"><span class="song-ruler-label">${label}</span>${
          beat ? `<span class="song-ruler-time">${formatRulerTime(i * stepSeconds)}</span>` : ""
        }</span>`;
      }).join("") +
      "</div>";
    layoutRuler(containerId);
    // The builder dialog scales in over ~0.2 s and rects measured mid-animation are scaled too, so measure again after.
    clearTimeout(rulerSettleTimers[containerId]);
    rulerSettleTimers[containerId] = setTimeout(() => layoutRuler(containerId), 320);
  }
  const rulerSettleTimers = {};
  // Lines the ruler up with the first visible step grid by measuring it (layout, not looks: the grid's left edge
  // depends on how wide the row labels and toggles in front of it turned out).
  function layoutRuler(containerId) {
    const container = $(containerId);
    const ruler = $(`${containerId}-ruler`);
    const steps = container && container.querySelector(".song-steps");
    const inner = ruler && ruler.firstChild;
    if (!steps || !inner || inner.nodeType !== 1) return;
    const cr = container.getBoundingClientRect();
    const sr = steps.getBoundingClientRect();
    inner.style.flex = "none";
    inner.style.marginLeft = `${Math.max(0, sr.left - cr.left)}px`;
    inner.style.width = `${sr.width}px`;
  }
  function renderRulers() {
    renderRuler("song-sequencer");
    renderRuler("song-piano-roll");
  }
  if (typeof ResizeObserver === "function") {
    let rulerFrame = 0;
    const ro = new ResizeObserver(() => {
      if (rulerFrame) return;
      rulerFrame = requestAnimationFrame(() => {
        rulerFrame = 0;
        if (!$("song-builder-modal").hidden) renderRulers();
      });
    });
    ro.observe($("song-sequencer"));
    ro.observe($("song-piano-roll"));
  }

  function renderSequencer() {
    renderStepGrid(
      "song-sequencer",
      trackList(),
      (t) => TRACK_LABELS[t],
      (t, i) => songData.tracks[t][i],
      (t, i, v) => (songData.tracks[t][i] = v),
      undefined,
      (t) => songData.trackMeta[t],
      (t, field, value) => {
        if (field === "muted" || field === "hidden") setFlag(songData.trackMeta[t], field, value);
        else if (field === "volume") setVolume(songData.trackMeta[t], value);
        else songData.trackMeta[t][field] = value;
        // A collapsed row's "Hidden, muted / still plays" text is only
        // rendered with the row, so re-render whenever it could go stale.
        if (field !== "hidden" && !(field === "muted" && songData.trackMeta[t].hidden === true)) return;
        renderSequencer();
        const toggle = $("song-sequencer").querySelector(`.song-track-${field === "hidden" ? "hide" : "mute"}[data-row="${t}"]`);
        if (toggle) toggle.focus();
      }
    );
    renderRuler("song-sequencer");
    $("song-sequencer").querySelectorAll(".song-track-remove").forEach((btn) => btn.addEventListener("click", () => removeDrumRow(btn.dataset.row)));
    syncAddDrumControl();
    syncPatternTargets();
  }

  // ---------- Extra drum voices ----------
  // The menu under the grid lists the voices this song doesn't have yet; each added row is an ordinary row (mute, hide, volume, note,
  // colour, patterns, stems) and the × on it takes it out again. Both are single undo steps like every other edit.
  function addDrumRow(t) {
    songData.tracks[t] = new Array(STEPS).fill(false);
    songData.trackMeta[t] = { color: DEFAULT_TRACK_COLORS[t], note: "" };
  }
  function syncAddDrumControl() {
    const missing = TRACK_ORDER.filter((t) => EXTRA_TRACKS.includes(t) && !trackList().includes(t));
    const select = $("song-add-drum");
    const chosen = select.value;
    select.innerHTML = missing.map((t) => `<option value="${t}">${TRACK_LABELS[t]}</option>`).join("");
    if (missing.includes(chosen)) select.value = chosen;
    $("song-add-drum-row").hidden = missing.length === 0;
  }
  // "Apply to" lists the rows the song has, and keeps the choice while it still exists.
  function syncPatternTargets() {
    const select = $("song-pattern-target");
    const chosen = select.value;
    select.innerHTML = `<option value="all">All drums</option>` + trackList().map((t) => `<option value="${t}">${TRACK_LABELS[t]}</option>`).join("");
    select.value = chosen === "all" || trackList().includes(chosen) ? chosen : "all";
  }
  $("song-add-drum-btn").addEventListener("click", () => {
    const t = $("song-add-drum").value;
    if (!EXTRA_TRACKS.includes(t) || trackList().includes(t)) return;
    addDrumRow(t);
    renderSequencer();
    const first = $("song-sequencer").querySelector(`.song-step[data-row="${t}"]`);
    if (first) first.focus();
    $("song-drum-status").textContent = `${TRACK_LABELS[t]} row added.`;
    scheduleAutosave();
  });
  function removeDrumRow(t) {
    if (!EXTRA_TRACKS.includes(t) || !trackList().includes(t)) return;
    const hits = (songData.tracks[t] || []).filter(Boolean).length;
    if (hits && !confirm(`Remove the ${TRACK_LABELS[t]} row and its ${hits} hit${hits === 1 ? "" : "s"}? Undo brings it back.`)) return;
    delete songData.tracks[t];
    delete songData.trackMeta[t];
    Object.values(songData.patterns || {}).forEach((part) => part && part.tracks && delete part.tracks[t]);
    renderSequencer();
    $("song-add-drum").value = t;
    $("song-add-drum").focus();
    $("song-drum-status").textContent = `${TRACK_LABELS[t]} row removed.`;
    refreshWaveformPreview();
    scheduleAutosave();
  }


  // ---------- Patterns and the song order ----------
  // A song is one 16-step pattern unless it has more (A to D) and a song order that plays them one after another (the data layout is
  // explained in song-engine.js). The pattern being edited is always the song's own tracks and melody notes, so every tool in this editor
  // works on it unchanged; switching pattern swaps those parts with the stored ones. Switching is a view change, not an edit, so it is
  // not an undo step; making, copying and removing patterns and editing the order are.
  let playOrder = false; // Play follows the song order (true) or loops the pattern being edited (false); only matters with several patterns
  let playingChip = -1;
  const editingPattern = () => Engine.editingName(songData);
  function playOptions() {
    return Engine.isSinglePattern(songData) || playOrder ? undefined : { pattern: editingPattern() };
  }
  const emptyParts = () => ({ tracks: {}, notes: {}, ties: {} });
  const countOn = (lanes) => Object.values(lanes).reduce((n, lane) => n + (Array.isArray(lane) ? lane.filter(Boolean).length : 0), 0);
  const partsCount = (part) => ({
    hits: countOn(part.tracks),
    notes: countOn(part.notes),
    bass: part.bass ? countOn(part.bass.notes) : 0,
    chords: part.chords ? countOn(part.chords.notes) : 0,
    lead: part.lead ? countOn(part.lead.notes) : 0,
  });
  const partsSummary = (name) => {
    const c = partsCount(Engine.patternData(songData, name));
    const more = [["bass", "bass note"], ["chords", "chord note"], ["lead", "lead note"]].filter(([key]) => c[key]).map(([key, word]) => `, ${c[key]} ${word}${c[key] === 1 ? "" : "s"}`).join("");
    return `${c.hits} drum hit${c.hits === 1 ? "" : "s"}, ${c.notes} melody note${c.notes === 1 ? "" : "s"}${more}`;
  };
  // The open pattern's parts as the song stores them in patterns: its own tracks and melody, and each of the bass, chords and lead the song has.
  const openParts = () => {
    const parts = { tracks: songData.tracks, notes: songData.melody.notes, ties: songData.melody.ties || {} };
    PART_KEYS.forEach((key) => {
      if (songData[key]) parts[key] = { notes: songData[key].notes, ties: songData[key].ties || {} };
    });
    return parts;
  };
  // Puts one pattern's parts into the song's own fields, with every row and every roll note present. Split by part so a pattern's drums,
  // melody or bass line can be taken on their own (Copy from another pattern).
  const lane16 = (lane) => Array.from({ length: STEPS }, (_, i) => (Array.isArray(lane) && lane[i] !== undefined ? lane[i] : false));
  function loadDrums(part) {
    const tracks = {};
    trackList().forEach((t) => (tracks[t] = lane16(part.tracks && part.tracks[t])));
    songData.tracks = tracks;
  }
  function loadMelody(part) {
    const notes = {};
    PIANO_NOTES.forEach((n) => (notes[n] = lane16(part.notes && part.notes[n])));
    songData.melody.notes = notes;
    setPartTies(songData.melody, part.ties || {});
  }
  // The bass, the chords and the lead follow the same pattern: the incoming pattern's notes (or none), over every note of the part's roll.
  function loadPart(key, part) {
    if (!part[key] && !songData[key]) return;
    const target = ensurePart(key);
    const lanes = {};
    PART_NOTES[key].forEach((n) => (lanes[n] = lane16(part[key] && part[key].notes && part[key].notes[n])));
    target.notes = lanes;
    setPartTies(target, part[key] && part[key].ties ? part[key].ties : {});
  }
  function loadParts(part) {
    loadDrums(part);
    loadMelody(part);
    PART_KEYS.forEach((key) => loadPart(key, part));
  }
  const copyParts = (part) => JSON.parse(JSON.stringify(part));
  // Makes `name` the open pattern: the one open now goes into the store, and `parts` (or the stored pattern of that name) becomes the song's
  // own. Returns false if there is no such pattern and none was given.
  function openPattern(name, parts) {
    const from = editingPattern();
    if (name === from || !Engine.PATTERN_NAMES.includes(name)) return false;
    const incoming = parts || (Engine.patternData(songData, name) ? copyParts(Engine.patternData(songData, name)) : null);
    if (!incoming) return false;
    const stored = songData.patterns && !Array.isArray(songData.patterns) && typeof songData.patterns === "object" ? songData.patterns : {};
    stored[from] = openParts();
    delete stored[name];
    songData.patterns = stored;
    if (name === "A") delete songData.editing;
    else songData.editing = name;
    loadParts(incoming);
    if (!Object.keys(songData.patterns).length) delete songData.patterns;
    return true;
  }
  const nextFreeName = () => Engine.PATTERN_NAMES.find((n) => !Engine.patternData(songData, n)) || null;
  const chainList = () => (Array.isArray(songData.chain) ? songData.chain.filter((n) => Engine.PATTERN_NAMES.includes(n)) : []);

  const patternSay = (message) => { $("song-arrangement-note").textContent = message; };
  const orderSummary = () => {
    const chain = chainList();
    if (!chain.length) return "No song order yet: the song plays its first pattern on its own.";
    const seconds = (60 / (Number(songData.tempo) || 120) / 4) * STEPS * chain.length;
    return `Song order: ${chain.join(" ")}, ${chain.length} bar${chain.length === 1 ? "" : "s"}, ${seconds.toFixed(1)} seconds at ${Number(songData.tempo) || 120} BPM.`;
  };

  function markPlayingOrderChip(index) {
    if (index === playingChip) return;
    playingChip = index;
    $("song-order-list").querySelectorAll("li").forEach((li, i) => {
      li.classList.toggle("song-order-playing", i === index);
      if (i === index) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    updatePreviewPosition();
  }

  // The preview's bar counter, as on the public player: "N bars" at rest, "Bar 3 of 6 · Pattern B" while the song order plays (and nothing at
  // all for a song of one bar). One segment per bar in the strip.
  function updatePreviewPosition() {
    const row = $("song-preview-position");
    const order = Engine.chainOf(songData);
    const playing = playingChip >= 0 && playingChip < order.length ? playingChip : null;
    const text = Engine.positionLabel(songData, playing, { pattern: true });
    row.hidden = !text;
    if (!text) return;
    const strip = $("song-preview-position-strip");
    if (strip.children.length !== order.length) {
      strip.innerHTML = order.map(() => "<span></span>").join("");
      $("song-preview-position-label").style.minWidth = Engine.positionLabel(songData, order.length - 1, { pattern: true }).length + "ch";
    }
    $("song-preview-position-label").textContent = text;
    [...strip.children].forEach((seg, i) => {
      seg.classList.toggle("is-now", i === playing);
      seg.classList.toggle("is-done", playing !== null && i < playing);
    });
  }

  function renderPatternControls() {
    const names = Engine.patternNames(songData);
    const open = editingPattern();
    $("song-pattern-buttons").innerHTML = names
      .map((n) => `<button type="button" class="song-pattern-btn" data-no-history data-pattern="${n}" aria-pressed="${n === open}" title="Edit pattern ${n} (${partsSummary(n)})">${n}</button>`)
      .join("");
    $("song-pattern-buttons").querySelectorAll(".song-pattern-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        if (!openPattern(btn.dataset.pattern)) return;
        afterPatternSwitch(`Editing pattern ${btn.dataset.pattern}: ${partsSummary(btn.dataset.pattern)}.`);
      })
    );
    $("song-pattern-new").disabled = names.length >= Engine.PATTERN_NAMES.length;
    $("song-pattern-duplicate").disabled = names.length >= Engine.PATTERN_NAMES.length;
    $("song-pattern-remove").hidden = names.length < 2; // a song needs a pattern, so Remove only shows once there is a second one
    const several = names.length > 1;
    $("song-order-tools").hidden = !several;
    const chain = chainList();
    $("song-order-list").innerHTML = chain
      .map((n, i) => `<li class="song-order-chip"><button type="button" class="song-order-move" data-index="${i}" data-dir="-1" aria-label="Move ${n} at position ${i + 1} earlier" title="Move ${n} one bar earlier"${i === 0 ? " disabled" : ""}>‹</button><span class="song-order-letter">${n}</span><button type="button" class="song-order-move" data-index="${i}" data-dir="1" aria-label="Move ${n} at position ${i + 1} later" title="Move ${n} one bar later"${i === chain.length - 1 ? " disabled" : ""}>›</button><button type="button" class="song-order-remove" data-index="${i}" aria-label="Remove ${n} at position ${i + 1} from the song order" title="Remove ${n} (position ${i + 1})">×</button></li>`)
      .join("");
    $("song-order-list").querySelectorAll(".song-order-remove").forEach((btn) => btn.addEventListener("click", () => removeFromOrder(Number(btn.dataset.index))));
    $("song-order-list").querySelectorAll(".song-order-move").forEach((btn) => btn.addEventListener("click", () => moveInOrder(Number(btn.dataset.index), Number(btn.dataset.dir))));
    playingChip = -1;
    updatePreviewPosition();
    // With no order the song plays its first pattern on its own: say so, so an empty order is not a mystery.
    $("song-order-hint").hidden = chain.length > 0;
    $("song-order-hint").textContent = `Nothing in the order yet: the song plays pattern ${Engine.chainOf(songData)[0]} on its own. Add patterns with the + buttons.`;
    $("song-order-add").innerHTML = names
      .map((n) => `<button type="button" class="song-track-toggle song-order-add-btn" data-pattern="${n}" aria-label="Add ${n} to the song order" title="Add pattern ${n} to the end of the song order (${chain.length} of ${Engine.MAX_CHAIN} bars used)"${chain.length >= Engine.MAX_CHAIN ? " disabled" : ""}>+ ${n}</button>`)
      .join("");
    $("song-order-add").querySelectorAll(".song-order-add-btn").forEach((btn) => btn.addEventListener("click", () => addToOrder(btn.dataset.pattern)));
    $("song-order-clear").disabled = chain.length === 0;
    $("song-order-summary").textContent = chain.length ? orderSummary().replace(/^Song order: [A-D ]+, /, "") : "";
    $("song-play-order").checked = playOrder;
    $("song-play-order").disabled = !several;
    // Copy from another pattern: the other patterns, with the choice kept when it still exists.
    $("song-copy-tools").hidden = !several;
    const others = names.filter((n) => n !== open);
    const picked = $("song-copy-from").value;
    $("song-copy-from").innerHTML = others.map((n) => `<option value="${n}">${n}</option>`).join("");
    if (others.includes(picked)) $("song-copy-from").value = picked;
  }
  // After the open pattern changed: redraw both grids (and the rows and menus around them) and the pattern buttons, and keep focus on
  // the pattern that was chosen.
  function afterPatternSwitch(message) {
    renderSequencer();
    renderPianoRoll();
    renderPatternControls();
    patternSay(message);
    const active = $("song-pattern-buttons").querySelector('[aria-pressed="true"]');
    if (active) active.focus();
  }

  // ---------- Arrangement for the Studio: how long the song is, a lane of patterns for each track, loop on or off ----------
  // A track with no lane of its own follows the song order. The first change to a track's arrangement gives it a lane that starts as that
  // order, so nothing moves until the change itself. Each pattern holds a part for every track, so tracks never share notes even when a lane
  // names the same letter: a bar only differs once a track's lane names another pattern for it.
  function ownLane(key) {
    if (!songData.lanes || typeof songData.lanes !== "object" || Array.isArray(songData.lanes)) songData.lanes = {};
    if (!songData.lanes[key] || !Array.isArray(songData.lanes[key].order)) songData.lanes[key] = { order: Engine.laneOrder(songData, key).slice() };
    songData.lanes[key].order = songData.lanes[key].order.filter((n) => Engine.patternData(songData, n));
    return songData.lanes[key];
  }
  const partOnly = (parts, key) => {
    const out = emptyParts();
    if (key === "drums") out.tracks = parts.tracks || {};
    else if (key === "melody") { out.notes = parts.notes || {}; out.ties = parts.ties || {}; }
    else if (parts[key]) out[key] = parts[key];
    return out;
  };
  const arrChanged = () => {
    renderPatternControls();
    refreshWaveformPreview();
    scheduleAutosave();
  };
  const arrReopen = () => {
    renderSequencer();
    renderPianoRoll();
    renderPatternControls();
  };
  const arr = {
    info(key) {
      const bars = Engine.songBars(songData);
      const order = Engine.laneOrder(songData, key);
      const loops = Engine.laneLoops(songData, key);
      const cells = [];
      for (let bar = 0; bar < bars; bar++) {
        const name = !order.length ? null : loops ? order[bar % order.length] : bar < order.length ? order[bar] : null;
        cells.push({ bar, name, repeat: Boolean(name) && bar >= order.length });
      }
      return { bars, length: order.length, auto: !songData.bars, own: Boolean(songData.lanes && songData.lanes[key]), loops, cells, open: editingPattern(), free: Engine.PATTERN_NAMES.length - Engine.patternNames(songData).length };
    },
    // Shows the pattern a track plays in a bar in the editor; false when the track is silent there.
    openBar(key, bar) {
      const name = Engine.patternAtBar(songData, key, bar);
      if (!name) return false;
      if (name !== editingPattern()) {
        openPattern(name);
        arrReopen();
      }
      return true;
    },
    // A new empty bar at the end of the track's lane, opened.
    addBar(key) {
      const name = nextFreeName();
      if (!name || Engine.laneOrder(songData, key).length >= Engine.MAX_BARS) return null;
      const lane = ownLane(key);
      openPattern(name, emptyParts());
      lane.order.push(name);
      if (songData.bars && songData.bars < lane.order.length) songData.bars = lane.order.length;
      arrReopen();
      arrChanged();
      return name;
    },
    // Makes one bar of a track its own (a copy of what the track plays there, in a new pattern), so a looped bar can change on its own.
    differ(key, bar) {
      const current = Engine.patternAtBar(songData, key, bar);
      if (!current) return null;
      const name = nextFreeName();
      if (!name) return null;
      const lane = ownLane(key);
      const base = lane.order.length;
      if (!base) return null;
      // Spell out the loop over the whole song first, so every bar keeps playing what it played before the one that is changed.
      const full = Math.min(Engine.MAX_BARS, Math.max(Engine.songBars(songData), bar + 1));
      while (lane.order.length < full) lane.order.push(lane.order[lane.order.length % base]);
      const copy = partOnly(copyParts(Engine.patternData(songData, current)), key);
      openPattern(name, copy);
      lane.order[bar] = name;
      arrReopen();
      arrChanged();
      return name;
    },
    removeBar(key, bar) {
      if (bar < 0 || bar >= Engine.laneOrder(songData, key).length) return false;
      const lane = ownLane(key);
      lane.order.splice(bar, 1);
      arrReopen();
      arrChanged();
      return true;
    },
    setLoop(key, loops) {
      const lane = ownLane(key);
      if (loops) delete lane.loop;
      else lane.loop = false;
      arrChanged();
    },
    // Back to following the song order.
    follow(key) {
      if (!songData.lanes || !songData.lanes[key]) return;
      delete songData.lanes[key];
      if (!Object.keys(songData.lanes).length) delete songData.lanes;
      arrChanged();
    },
    setBars(n) {
      const value = Math.floor(Number(n));
      if (Number.isFinite(value) && value >= 1) songData.bars = Math.min(Engine.MAX_BARS, value);
      else delete songData.bars;
      arrChanged();
    },
  };
  Object.assign(window.SongStudioHost, { arr });
  // While recording on a track whose lane does not loop (and the song's length is not fixed), the song grows with the take: a new empty
  // bar is added just before the track runs out, so the music carries on instead of wrapping round.
  function extendLaneForRecording(key, step, info) {
    if (!key || songData.bars || !songData.lanes || !songData.lanes[key] || songData.lanes[key].loop !== false) return;
    const lane = ownLane(key);
    const need = Math.min(Engine.MAX_BARS, step === STEPS - 1 ? info.chainIndex + 2 : info.chainIndex + 1);
    let grew = false;
    while (lane.order.length < need) {
      const name = nextFreeName();
      if (!name) break;
      if (!songData.patterns || typeof songData.patterns !== "object") songData.patterns = {};
      songData.patterns[name] = emptyParts();
      lane.order.push(name);
      grew = true;
    }
    if (grew) arrChanged();
  }

  // Copy one part (or everything) of another pattern into the open one. The other pattern is not changed.
  $("song-copy-apply").addEventListener("click", () => {
    const from = $("song-copy-from").value;
    const what = $("song-copy-what").value;
    const source = Engine.patternData(songData, from);
    if (!source || from === editingPattern()) return;
    const part = copyParts(source);
    if (what === "drums" || what === "all") loadDrums(part);
    if (what === "melody" || what === "all") loadMelody(part);
    PART_KEYS.forEach((key) => {
      if (what === key || what === "all") loadPart(key, part);
    });
    const words = { drums: "drums", melody: "melody", bass: "bass line", chords: "chords", lead: "lead", all: "everything" };
    renderSequencer();
    renderPianoRoll();
    renderPatternControls();
    patternSay(`Pattern ${editingPattern()} now has pattern ${from}'s ${words[what]}. Undo brings the old one back.`);
    refreshWaveformPreview();
    scheduleAutosave();
    $("song-copy-apply").focus();
  });
  $("song-pattern-new").addEventListener("click", () => {
    const name = nextFreeName();
    if (!name) return;
    openPattern(name, emptyParts());
    afterPatternSwitch(`Pattern ${name} started, empty, and open for editing.`);
  });
  $("song-pattern-duplicate").addEventListener("click", () => {
    const name = nextFreeName();
    if (!name) return;
    const from = editingPattern();
    openPattern(name, copyParts(openParts()));
    afterPatternSwitch(`Pattern ${name} is a copy of ${from}, and is now open. Undo takes it back.`);
    refreshWaveformPreview();
    scheduleAutosave();
  });
  $("song-pattern-remove").addEventListener("click", () => {
    const names = Engine.patternNames(songData);
    if (names.length < 2) return;
    const name = editingPattern();
    const used = chainList().filter((n) => n === name).length;
    const c = partsCount(Engine.patternData(songData, name));
    if ((c.hits || c.notes || c.bass || c.chords || c.lead || used) && !confirm(`Remove pattern ${name} (${partsSummary(name)})${used ? ` and its ${used} place${used === 1 ? "" : "s"} in the song order` : ""}? Undo brings it back.`)) return;
    const next = names.find((n) => n !== name);
    openPattern(next); // this stores the pattern being removed, which is then dropped
    delete songData.patterns[name];
    if (!Object.keys(songData.patterns).length) delete songData.patterns;
    const chain = chainList().filter((n) => n !== name);
    if (chain.length) songData.chain = chain;
    else delete songData.chain;
    if (songData.lanes) Object.keys(songData.lanes).forEach((k) => { songData.lanes[k].order = songData.lanes[k].order.filter((n) => n !== name); });
    afterPatternSwitch(`Pattern ${name} removed. Pattern ${next} is open.`);
    refreshWaveformPreview();
    scheduleAutosave();
  });
  function changeOrder(next, message) {
    if (next.length) songData.chain = next;
    else delete songData.chain;
    renderPatternControls();
    patternSay(`${message} ${orderSummary()}`);
    refreshWaveformPreview();
    scheduleAutosave();
  }
  function addToOrder(name) {
    const chain = chainList();
    if (chain.length >= Engine.MAX_CHAIN) return patternSay(`The song order is full (${Engine.MAX_CHAIN} bars).`);
    const was = chain.length;
    changeOrder([...chain, name], `${name} added.`);
    if (was < 2 && chain.length + 1 >= 2 && !playOrder) {
      playOrder = true; // the order now has something to play: Play follows it
      $("song-play-order").checked = true;
      patternSay(`${$("song-arrangement-note").textContent} Play now follows the song order.`);
    }
    const again = $("song-order-add").querySelector(`[data-pattern="${name}"]`);
    if (again && !again.disabled) again.focus();
  }
  // Swaps a bar of the song order with its neighbour (so a pattern can be put in the middle: add it, then move it). Focus stays on the
  // moved bar's button for the same direction, or the other one once it reaches an end.
  function moveInOrder(index, dir) {
    const chain = chainList();
    const target = index + dir;
    if (index < 0 || index >= chain.length || target < 0 || target >= chain.length) return;
    const next = chain.slice();
    [next[index], next[target]] = [next[target], next[index]];
    changeOrder(next, `${chain[index]} moved from position ${index + 1} to ${target + 1}.`);
    const chip = $("song-order-list").querySelectorAll("li")[target];
    const wanted = chip && chip.querySelector(`.song-order-move[data-dir="${dir}"]:not(:disabled)`);
    (wanted || (chip && chip.querySelector(".song-order-move:not(:disabled)")) || $("song-order-add").querySelector("button")).focus();
  }
  function removeFromOrder(index) {
    const chain = chainList();
    if (index < 0 || index >= chain.length) return;
    const name = chain[index];
    changeOrder(chain.filter((_, i) => i !== index), `${name} at position ${index + 1} removed.`);
    const items = $("song-order-list").querySelectorAll(".song-order-remove");
    (items[Math.min(index, items.length - 1)] || $("song-order-add").querySelector("button")).focus();
  }
  $("song-order-clear").addEventListener("click", () => {
    if (!chainList().length) return;
    changeOrder([], "Song order cleared.");
    $("song-order-add").querySelector("button").focus();
  });
  $("song-play-order").addEventListener("change", () => {
    playOrder = $("song-play-order").checked;
    patternSay(playOrder ? "Play follows the song order." : `Play loops pattern ${editingPattern()}.`);
    if (player.isPlaying()) patternSay(`${$("song-arrangement-note").textContent} Stop and play again to hear it.`);
  });

  function updateMelodyToggles() {
    const part = roll();
    const word = rollWord();
    const muted = part.muted === true;
    const hidden = part.hidden === true;
    const melodyVolume = Number.isFinite(Number(part.volume)) && part.volume != null ? Math.max(0, Math.min(1, Number(part.volume))) : 1;
    $("song-melody-volume").value = Math.round(melodyVolume * 100);
    $("song-melody-volume").setAttribute("aria-valuetext", volumeText(melodyVolume));
    $("song-melody-mute").setAttribute("aria-pressed", String(muted));
    $("song-melody-hide").setAttribute("aria-pressed", String(hidden));
    $("song-melody-mute").textContent = muted ? "Muted" : "Mute";
    $("song-melody-hide").textContent = hidden ? "Hidden" : "Hide";
    // The accessible name always contains the visible word (WCAG 2.5.3).
    $("song-melody-mute").setAttribute("aria-label", muted ? `Muted ${word}` : `Mute ${word}`);
    $("song-melody-hide").setAttribute("aria-label", hidden ? `Hidden ${word} piano roll` : `Hide ${word} piano roll`);
    $("song-melody-mute").title = `Mute the ${word}: silent in the preview and on the public page`;
    $("song-melody-hide").title = `Hide the piano roll here in the editor; the ${word} still plays unless muted`;
    $("song-melody-volume").setAttribute("aria-label", `${rollWordCap()} volume`);
    $("song-melody-volume").title = `${rollWordCap()} volume`;
  }

  function setMelodyFlag(field) {
    const part = roll();
    setFlag(part, field, part[field] !== true);
    updateMelodyToggles();
    if (field === "hidden") {
      renderPianoRoll();
      const toggle = $("song-piano-roll").querySelector(".song-melody-show") || $("song-melody-hide");
      toggle.focus();
    } else {
      if (part.hidden === true) renderPianoRoll();
      refreshWaveformPreview();
    }
    scheduleAutosave();
  }
  $("song-melody-volume").addEventListener("input", () => {
    const part = roll();
    setVolume(part, Number($("song-melody-volume").value) / 100);
    $("song-melody-volume").setAttribute("aria-valuetext", volumeText(part.volume ?? 1));
    refreshWaveformPreview();
    scheduleAutosave();
  });
  $("song-melody-mute").addEventListener("click", () => setMelodyFlag("muted"));
  $("song-melody-hide").addEventListener("click", () => setMelodyFlag("hidden"));

  // Scale highlight: marks the piano roll rows that belong to a key's scale (stored as songData.scale, a viewing aid only).
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], majpent: [0, 2, 4, 7, 9], minpent: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10] };
  // The scale only counts when both its type and key are valid, so the controls and the row marks never disagree.
  const activeScale = () => {
    const sc = songData.scale;
    return sc && SCALES[sc.type] && NOTE_NAMES.includes(sc.root) ? sc : null;
  };
  function scaleRowClass(note) {
    const sc = activeScale();
    const set = sc && SCALES[sc.type];
    if (!set) return "";
    const pc = NOTE_NAMES.indexOf(note.replace(/\d+$/, ""));
    const root = NOTE_NAMES.indexOf(sc.root);
    if (pc < 0 || root < 0) return "";
    const degree = (pc - root + 12) % 12;
    return degree === 0 ? " song-row-scale song-row-scale-root" : set.includes(degree) ? " song-row-scale" : " song-row-off-scale";
  }
  function syncScaleControls() {
    const sc = activeScale();
    $("song-scale-type").value = sc ? sc.type : "off";
    $("song-scale-root").value = sc ? sc.root : "C";
  }
  // The nearest note of the highlighted scale to a note name (the lower one when two are as near), when snapping is on; else the note itself.
  function snapToScale(name, within) {
    const sc = activeScale();
    const m = /^([A-G]#?)(\d)$/.exec(name);
    if (!sc || sc.snap !== true || !m) return name;
    const set = SCALES[sc.type];
    const root = NOTE_NAMES.indexOf(sc.root);
    const number = NOTE_NAMES.indexOf(m[1]) + Number(m[2]) * 12;
    const inScale = (n) => set.includes((((n % 12) - root) + 12) % 12);
    for (let d = 0; d <= 12; d++) {
      for (const n of [number - d, number + d]) {
        const candidate = NOTE_NAMES[n % 12] + Math.floor(n / 12);
        if (inScale(n) && (!within || within(candidate))) return candidate;
      }
    }
    return name;
  }
  function onScaleChange() {
    const type = $("song-scale-type").value;
    const snap = songData.scale && songData.scale.snap === true;
    if (type === "off") delete songData.scale;
    else songData.scale = Object.assign({ root: $("song-scale-root").value, type }, snap ? { snap: true } : {});
    renderPianoRoll();
    const sc = activeScale();
    if (sc) $("song-prog-key").value = sc.root; // chord progressions start in the key being highlighted
    $("song-scale-status").textContent = sc ? `Highlighting ${sc.root} ${$("song-scale-type").selectedOptions[0].textContent.toLowerCase()}: ${$("song-piano-roll").querySelectorAll(".song-row-scale").length} rows in scale.` : "Scale highlight off.";
    scheduleAutosave();
  }
  $("song-scale-type").addEventListener("change", onScaleChange);
  $("song-scale-root").addEventListener("change", onScaleChange);

  function renderPianoRoll() {
    syncScaleControls();
    syncRollPart();
    updateMelodyToggles();
    const part = roll();
    const word = rollWord();
    if (part.hidden === true) {
      $("song-piano-roll").innerHTML =
        `<div class="song-track-row song-track-row-hidden${part.muted === true ? " song-track-row-muted" : ""}">` +
        `<span class="song-track-hidden-note">${rollWordCap()} hidden, ${part.muted === true ? "muted" : "still plays"}</span>` +
        `<button type="button" class="song-melody-show">Show ${word}</button></div>`;
      $("song-piano-roll").querySelector(".song-melody-show").addEventListener("click", () => setMelodyFlag("hidden"));
      renderRuler("song-piano-roll");
      return;
    }
    renderStepGrid(
      "song-piano-roll",
      rollNotes(),
      (n) => n,
      (n, i) => part.notes[n][i],
      (n, i, v) => (part.notes[n][i] = v),
      (n) => (n.includes("#") ? " song-row-black-key" : "") + scaleRowClass(n),
      undefined,
      undefined,
      (n) => playAndMaybeRecordNote(n)
    );
    renderRuler("song-piano-roll");
    setMelodyTies(part.ties || {});
    paintTies();
    // Spoken cue for the highlight: "C4, root of the scale" / "D4, in scale".
    $("song-piano-roll").querySelectorAll(".song-row-scale").forEach((row) => {
      const label = row.querySelector(".song-track-label-playable");
      if (label) label.setAttribute("aria-label", label.getAttribute("aria-label").replace(", press", row.classList.contains("song-row-scale-root") ? ", root of the scale, press" : ", in scale, press"));
    });
  }

  // The Melody / Bass switch above the roll: which part the roll shows and the tools below it work on. Switching is a view change, not an
  // edit (no undo step). The heading, the tool labels, the bass sound menu and the chord root list follow the part.
  // The chord root list starts on a sensible note for each part.
  const ROLL_RANGES = { melody: "", bass: "C1 to B2", chords: "C3 to B4", lead: "C4 to B5" };
  const TOOL_NAMES = { melody: "Melody", bass: "Bass", chords: "Chords", lead: "Lead" };
  const DEFAULT_ROOTS = { melody: "C4", bass: "C2", chords: "C3", lead: "C5" };
  function syncRollPart() {
    const bass = isBassRoll();
    const part = rollPart;
    ["melody", "bass", "chords", "lead"].forEach((key) => $("song-roll-" + key).setAttribute("aria-pressed", String(key === part)));
    $("song-roll-title").textContent = part === "melody" ? "Melody (piano roll)" : `${rollWordCap()} (piano roll, ${ROLL_RANGES[part]})`;
    $("song-bass-voice").hidden = !bass;
    $("song-part-voice").hidden = part !== "chords" && part !== "lead";
    $("song-bass-follow").hidden = !bass;
    if (bass) $("song-bass-voice").value = bassVoiceName();
    if (part === "chords" || part === "lead") $("song-part-voice").value = Engine.partVoiceOf(songData, part);
    const word = rollWord();
    const tune = part === "melody" ? "tune" : part === "bass" ? "bass line" : word;
    $("song-melody-tools-summary").textContent = `${TOOL_NAMES[part]} tools: shift, reverse, random ${tune}, chords and arpeggios`;
    $("song-melody-clear").textContent = part === "melody" ? "Clear melody" : `Clear ${word}`;
    $("song-melody-clear").title = `Remove every ${part === "bass" ? "bass" : word} note (undoable)`;
    $("song-melody-random").textContent = `Random ${tune} in scale`;
    $("song-prog-stamp").textContent = bass ? "Stamp chord roots" : "Stamp progression";
    $("song-prog-stamp").title = bass
      ? "Add the root note of every chord of the progression across the loop, keeping the rest of the bass line (undoable). Held roots ring for their whole stretch."
      : `Add every chord of the progression across the loop, keeping the rest of the ${word} (undoable). Held chords ring for their whole stretch.`;
    fillChordRoots();
  }
  const bassVoiceName = () => Engine.bassVoiceOf(songData);
  const ROLL_NOTICES = {
    melody: "Editing the melody.",
    bass: "Editing the bass line. Its notes are an octave or two below the melody, C1 to B2.",
    chords: "Editing the chords. Its roll is C3 to B4, and its sound is a pad unless you choose another.",
    lead: "Editing the lead. Its roll is C4 to B5, an octave above the melody's, and its sound is a lead synth unless you choose another.",
  };
  function setRollPart(part) {
    if (part === rollPart) return;
    rollPart = part;
    if (part !== "melody") ensurePart(part);
    renderPianoRoll();
    melodyToolsSay(ROLL_NOTICES[part]);
    $("song-roll-" + part).focus();
  }
  ["melody", "bass", "chords", "lead"].forEach((key) => $("song-roll-" + key).addEventListener("click", () => setRollPart(key)));
  // The bass sound: the engine's "bass" voice unless another is chosen (stored only when it is not the default).
  $("song-bass-voice").addEventListener("change", () => {
    const bass = ensureBass();
    const voice = $("song-bass-voice").value;
    if (voice === "bass") delete bass.voice;
    else bass.voice = voice;
    refreshWaveformPreview();
    scheduleAutosave();
  });
  // The chords' and the lead's sound: each part's own default voice unless another is chosen (stored only when it is not the default).
  $("song-part-voice").addEventListener("change", () => {
    if (rollPart !== "chords" && rollPart !== "lead") return;
    const target = ensurePart(rollPart);
    const voice = $("song-part-voice").value;
    if (voice === Engine.partVoiceOf({}, rollPart)) delete target.voice;
    else target.voice = voice;
    refreshWaveformPreview();
    scheduleAutosave();
  });

  // ---------- Held notes (ties) ----------
  // songData.melody.ties[note][step] === true joins that step to the same note one step earlier, so the two play as one longer note
  // (the engine does the playing, see song-engine.js). Only meaningful with the note on at both steps, so every edit tidies them.
  function setPartTies(part, ties) {
    const clean = window.SongPatterns.cleanTies(part.notes, ties, STEPS);
    if (window.SongPatterns.hasTies(clean)) part.ties = clean;
    else delete part.ties;
  }
  const setMelodyTies = (ties) => setPartTies(roll(), ties); // the part the roll is showing
  function paintTies() {
    const ties = roll().ties || {};
    $("song-piano-roll").querySelectorAll(".song-step[data-row]").forEach((cell) => {
      const tied = Boolean(ties[cell.dataset.row] && ties[cell.dataset.row][Number(cell.dataset.step)] === true);
      cell.classList.toggle("song-step-tied", tied);
      if (tied) cell.setAttribute("aria-description", "Held: tied to the same note on the step before");
      else cell.removeAttribute("aria-description");
    });
  }
  let tieAnnounce = 0;
  function tieSay(message) {
    tieAnnounce++;
    $("song-melody-tools-note").textContent = message + (tieAnnounce % 2 ? "" : " ");
  }
  // Shift+click (or Shift+Enter) on a note toggles its tie to the step before.
  $("song-piano-roll").addEventListener(
    "click",
    (e) => {
      if (!e.shiftKey) return;
      const cell = e.target.closest && e.target.closest(".song-step[data-row]");
      if (!cell) return;
      e.stopPropagation();
      e.preventDefault();
      const name = cell.dataset.row;
      const step = Number(cell.dataset.step);
      const notes = roll().notes;
      if (step === 0 || !notes[name] || !notes[name][step] || !notes[name][step - 1]) {
        tieSay(`${name} step ${step + 1} can't be tied: a tie joins a note to the same note on the step before, so turn both steps on first.`);
        return;
      }
      const ties = roll().ties ? JSON.parse(JSON.stringify(roll().ties)) : {};
      if (!ties[name]) ties[name] = new Array(STEPS).fill(false);
      ties[name][step] = ties[name][step] !== true;
      const nowTied = ties[name][step] === true;
      setMelodyTies(ties);
      paintTies();
      tieSay(`${name} steps ${step} and ${step + 1} ${nowTied ? "tied: they play as one held note" : "untied"}.`);
      refreshWaveformPreview();
      scheduleAutosave();
    },
    true
  );
  // A plain click (which turns a step on or off) may leave a tie with nothing to join: tidy up after the step's own handler has run.
  $("song-piano-roll").addEventListener("click", (e) => {
    if (e.shiftKey || !(e.target.closest && e.target.closest(".song-step[data-row]"))) return;
    setMelodyTies(roll().ties || {});
    paintTies();
  });

  // Shifts every note in the melody up/down by `semitones` (positive =
  // up), re-keying each row to a different piano-roll row rather than
  // touching step timing. PIANO_NOTES[0] is the highest pitch (B4) with
  // pitch decreasing as the index increases, so "up" moves toward lower
  // indices. A note that would land outside the piano roll's fixed 2-octave
  // range (C3-B4) is dropped -- there's no way to display a note above or
  // below the visible grid.
  //
  // A critic pass flagged the original version (a post-hoc alert naming
  // only a count, with no confirmation first) as a real gap: this is the
  // single most bulk-destructive one-click action in a builder with no
  // undo at all, and it's inconsistent with this same file's own
  // established pattern for destructive actions (deleting a song already
  // uses confirm() before acting, not just a notice after). Reworked to
  // compute the full effect first without mutating anything, then confirm
  // before applying if anything would actually be lost -- naming the
  // specific notes/steps, not just a count, so the admin can make an
  // informed choice while it's still reversible by just clicking Cancel.
  // Transposing changes the key of the whole song, so it moves the notes of every pattern, not just the one open.
  function transposeMelody(semitones) {
    const names = rollNotes();
    const shiftNotes = (oldNotes, label, dropped) => {
      const newNotes = {};
      names.forEach((n) => (newNotes[n] = new Array(STEPS).fill(false)));
      names.forEach((sourceName, sourceIndex) => {
        const targetName = names[sourceIndex - semitones];
        for (let step = 0; step < STEPS; step++) {
          if (!oldNotes[sourceName] || !oldNotes[sourceName][step]) continue;
          if (targetName) newNotes[targetName][step] = oldNotes[sourceName][step];
          else dropped.push(`${sourceName} (step ${step + 1}${label})`);
        }
      });
      return newNotes;
    };
    // Held notes travel with their notes (a tied note that was dropped takes its tie with it).
    const shiftTies = (oldTies) => {
      const newTies = {};
      names.forEach((sourceName, sourceIndex) => {
        const targetName = names[sourceIndex - semitones];
        if (targetName && oldTies[sourceName]) newTies[targetName] = oldTies[sourceName];
      });
      return newTies;
    };
    const dropped = [];
    const several = Engine.patternNames(songData).length > 1;
    const openName = editingPattern();
    const open = roll();
    const openNotes = shiftNotes(open.notes, several ? `, pattern ${openName}` : "", dropped);
    // each other pattern's notes for this part (a melody sits in the pattern itself, the others under their own name: "bass", "chords", "lead")
    const slotOf = (part) => (isPartRoll() ? part && part[rollPart] : part);
    const stored = Object.entries(songData.patterns || {}).map(([name, part]) => [name, slotOf(part)]).filter(([, slot]) => slot && slot.notes).map(([name, slot]) => [name, slot, shiftNotes(slot.notes, `, pattern ${name}`, dropped)]);
    if (dropped.length) {
      const shown = dropped.slice(0, 8).join(", ") + (dropped.length > 8 ? `, and ${dropped.length - 8} more` : "");
      const ok = confirm(
        `This will remove ${dropped.length} note${dropped.length === 1 ? "" : "s"} that would move outside the piano roll's range: ${shown}. Continue?`
      );
      if (!ok) return;
    }
    const openTies = shiftTies(open.ties || {});
    stored.forEach(([, slot, notes]) => {
      slot.notes = notes;
      slot.ties = shiftTies(slot.ties || {});
    });
    open.notes = openNotes;
    setMelodyTies(openTies);
    renderPianoRoll();
    refreshWaveformPreview();
    scheduleAutosave();
  }

  // ---------- Melody tools: shift, reverse, clear, random tune, chord stamp and arpeggio (maths in song-patterns.js) ----------
  // Every button here changes songData synchronously inside its click, so the song's own Undo (which watches clicks) covers each one.
  const MP = window.SongPatterns;
  const chordRoot = $("song-chord-root");
  // The chord root menu lists the notes of the part being edited, lowest first, keeping the chosen root when the new roll has it.
  let rootsFor = "";
  function fillChordRoots() {
    if (rootsFor === rollPart) return;
    rootsFor = rollPart;
    const names = [...rollNotes()].reverse();
    chordRoot.innerHTML = "";
    names.forEach((n) => chordRoot.appendChild(new Option(n, n)));
    chordRoot.value = DEFAULT_ROOTS[rollPart];
  }
  fillChordRoots();
  Object.entries(MP.CHORDS).forEach(([id, c]) => $("song-chord-type").appendChild(new Option(c.label, id)));
  Object.entries(MP.ARPEGGIO_PATTERNS).forEach(([id, label]) => $("song-arp-pattern").appendChild(new Option(label, id)));
  let melodyToolsAnnounce = 0;
  function melodyToolsSay(message) {
    melodyToolsAnnounce++;
    $("song-melody-tools-note").textContent = message + (melodyToolsAnnounce % 2 ? "" : " ");
  }
  function melodyHasNotes() {
    const notes = roll().notes;
    return rollNotes().some((n) => notes[n] && notes[n].some(Boolean));
  }
  // Runs one tool: fn gets the current notes and returns the new ones. A hidden piano roll is left alone so nothing changes out of sight.
  // tiesFn(oldTies, newNotes) says what happens to the held notes; leave it out and they are cleared (a melody made from scratch).
  function melodyEdit(fn, message, tiesFn) {
    const part = roll();
    if (part.hidden === true) {
      melodyToolsSay(`The ${rollWord()} is hidden. Show it first (the Show ${rollWord()} button in the piano roll), then try again.`);
      return false;
    }
    const next = fn(part.notes);
    rollNotes().forEach((n) => {
      if (!next[n]) next[n] = new Array(STEPS).fill(false);
    });
    part.notes = next;
    setMelodyTies(tiesFn ? tiesFn(part.ties || {}, next) : {});
    renderPianoRoll();
    refreshWaveformPreview();
    scheduleAutosave();
    melodyToolsSay(message);
    return true;
  }
  $("song-melody-shift-left").addEventListener("click", () => {
    if (!melodyHasNotes()) return melodyToolsSay(`There are no ${rollWord()} notes to shift yet.`);
    melodyEdit((notes) => MP.rotateMelody(notes, -1, STEPS), `${rollWordCap()} shifted one step earlier.`, (ties) => MP.rotateTies(ties, -1, STEPS));
  });
  $("song-melody-shift-right").addEventListener("click", () => {
    if (!melodyHasNotes()) return melodyToolsSay(`There are no ${rollWord()} notes to shift yet.`);
    melodyEdit((notes) => MP.rotateMelody(notes, 1, STEPS), `${rollWordCap()} shifted one step later.`, (ties) => MP.rotateTies(ties, 1, STEPS));
  });
  $("song-melody-reverse").addEventListener("click", () => {
    if (!melodyHasNotes()) return melodyToolsSay(`There are no ${rollWord()} notes to reverse yet.`);
    melodyEdit((notes) => MP.reverseMelody(notes, STEPS), `${rollWordCap()} reversed.`, (ties) => MP.reverseTies(ties, STEPS));
  });
  $("song-melody-clear").addEventListener("click", () => {
    if (!melodyHasNotes()) return melodyToolsSay(`The ${rollWord()} is already empty.`);
    melodyEdit(() => ({}), `${rollWordCap()} cleared. Undo brings it back.`);
  });
  $("song-melody-tie-repeats").addEventListener("click", () => {
    const pairs = Object.values(MP.tieRepeats(roll().notes, STEPS)).reduce((n, row) => n + row.filter(Boolean).length, 0);
    if (!pairs) return melodyToolsSay("There are no repeated notes to tie: a note has to be on two steps in a row.");
    melodyEdit((notes) => notes, `${pairs} repeated note${pairs === 1 ? "" : "s"} tied: each run plays as one held note.`, (ties, notes) => MP.tieRepeats(notes, STEPS));
  });
  $("song-melody-untie").addEventListener("click", () => {
    if (!MP.hasTies(roll().ties)) return melodyToolsSay("No notes are held yet.");
    melodyEdit((notes) => notes, "All held notes untied: every note is struck again.", () => ({}));
  });
  $("song-melody-density").addEventListener("input", () => {
    $("song-melody-density").setAttribute("aria-valuetext", `${$("song-melody-density").value}% of steps`);
  });
  $("song-melody-random").addEventListener("click", () => {
    const sc = activeScale();
    const pool = sc ? MP.scalePool(rollNotes(), sc.root, SCALES[sc.type]) : MP.scalePool(rollNotes(), "C", SCALES.majpent);
    const label = sc ? `${sc.root} ${$("song-scale-type").selectedOptions[0].textContent.toLowerCase()}` : "C major pentatonic (no scale is highlighted)";
    const had = melodyHasNotes();
    melodyEdit(() => MP.randomMelody(rollNotes(), pool, STEPS, { density: Number($("song-melody-density").value) / 100 }), `A random ${rollPart === "melody" ? "tune" : rollWord()} in ${label}${had ? ` replaced the ${rollWord()}. Undo brings it back` : ""}.`);
  });
  // Bass only: a note on the root at every kick hit of the open pattern, held until the next one (see SongPatterns.bassFromHits).
  $("song-bass-follow").addEventListener("click", () => {
    const hits = songData.tracks && songData.tracks.kick;
    if (!Array.isArray(hits) || !hits.some(Boolean)) return melodyToolsSay("The kick has no hits in this pattern. Add some in the drums first, then the bass can follow it.");
    const sc = activeScale();
    const root = sc ? sc.root : "C";
    const had = melodyHasNotes();
    let made = null;
    melodyEdit(
      () => {
        made = MP.bassFromHits(rollNotes(), `${root}2`, hits, STEPS);
        return made.notes;
      },
      `Bass on every kick, on ${root}${had ? ", replacing the bass line. Undo brings it back" : ""}.`,
      () => made.ties
    );
  });
  const chosenChord = () => MP.chordNames($("song-chord-root").value, $("song-chord-type").value, rollNotes());
  const chordWord = () => `${$("song-chord-root").value} ${$("song-chord-type").selectedOptions[0].textContent.toLowerCase()}`;
  const missingWord = (c) => (c.missing ? ` ${c.missing} chord note${c.missing === 1 ? " was" : "s were"} above the piano roll and left out.` : "");
  $("song-chord-stamp").addEventListener("click", () => {
    const c = chosenChord();
    if (!c.names.length) return melodyToolsSay("That chord does not fit in the piano roll. Pick a lower root.");
    const step = Math.max(1, Math.min(STEPS, Math.floor(Number($("song-chord-step").value)) || 1));
    $("song-chord-step").value = step;
    melodyEdit((notes) => MP.stampChord(notes, c.names, step - 1, STEPS), `${chordWord()} chord added on step ${step}.${missingWord(c)}`, (ties) => ties);
  });
  $("song-arp-apply").addEventListener("click", () => {
    const c = chosenChord();
    if (!c.names.length) return melodyToolsSay("That chord does not fit in the piano roll. Pick a lower root.");
    const every = Number($("song-arp-every").value) || 1;
    const had = melodyHasNotes();
    melodyEdit(
      () => MP.arpeggioMelody(rollNotes(), c.names, $("song-arp-pattern").value, every, STEPS),
      `${chordWord()} arpeggio, ${$("song-arp-pattern").selectedOptions[0].textContent.toLowerCase()}, a note every ${every === 1 ? "step" : every + " steps"}${had ? `, replaced the ${rollWord()}. Undo brings it back` : ""}.${missingWord(c)}`
    );
  });

  // Chord progressions: all the chords of a well-known sequence in a key, spread over the loop and (by default) held so they ring. On the
  // bass line only each chord's root is stamped, which is what a bass plays under a progression.
  NOTE_NAMES.forEach((n) => $("song-prog-key").appendChild(new Option(n, n)));
  $("song-prog-key").value = "C";
  MP.PROGRESSIONS.forEach((p) => $("song-prog-type").appendChild(new Option(p.label, p.id)));
  $("song-prog-stamp").addEventListener("click", () => {
    let chords = MP.progressionChords(rollNotes(), $("song-prog-key").value, $("song-prog-type").value);
    if (!chords.length) return melodyToolsSay("That progression is not available in this key.");
    if (isBassRoll()) chords = chords.map((c) => ({ label: c.label, names: c.names.slice(0, 1), missing: 0 }));
    const hold = $("song-prog-hold").checked;
    const span = Math.floor(STEPS / chords.length);
    const left = chords.reduce((n, c) => n + c.missing, 0);
    let stamped = null;
    const message = `${$("song-prog-type").selectedOptions[0].textContent.split(":")[0]} progression${isBassRoll() ? " (chord roots)" : ""} in ${$("song-prog-key").value}: ${chords.map((c) => c.label).join(", ")}, ${hold ? `each held for ${span} step${span === 1 ? "" : "s"}` : `struck on every ${span === 1 ? "step" : span + "th step"}`}.${left ? ` ${left} chord note${left === 1 ? " was" : "s were"} above the piano roll and left out.` : ""}`;
    melodyEdit(
      (notes) => {
        stamped = MP.stampProgression(notes, roll().ties || {}, chords, STEPS, { hold });
        return stamped.notes;
      },
      message,
      () => stamped.ties
    );
  });

  // ---------- List modal ----------
  async function loadSongsList() {
    songs = await window.adminApi("/songs");
    // A deleted song can't stay open as a tab.
    const before = songTabs.length;
    songTabs = songTabs.filter((t) => t.draft || songs.some((x) => x.id === t.id));
    if (songTabs.length !== before) renderSongTabs();
    renderSongsList();
  }

  function escapeXml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Client-side substring filter over the songs list (item #197) --
  // matches the exact convention the media library's own search box
  // already uses (case-insensitive, filters on every "input" event, no
  // server round-trip since the full list is already loaded). A list
  // this small never needed a server-side search endpoint; this is
  // purely about finding one song quickly once there are more than a
  // handful, not about scaling to a list too large to load at once.
  function filteredSongs() {
    const q = $("song-search").value.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((s) => s.name.toLowerCase().includes(q));
  }

  function renderSongsList() {
    const visible = filteredSongs();
    $("songs-list").innerHTML =
      visible
        .map(
          (s) =>
            `<div class="simulation-row"><span>${escapeXml(s.name)}</span><button type="button" class="usage-song" data-id="${
              s.id
            }" data-name="${escapeXml(s.name)}" title="See which pages use this song">Usage</button><button type="button" class="duplicate-song" data-id="${
              s.id
            }">Duplicate</button><button type="button" class="edit-song" data-id="${s.id}">Edit</button><button type="button" class="delete-song" data-id="${s.id}">Delete</button></div>`
        )
        .join("") ||
      `<p style='color:var(--text-dim);font-size:0.85rem;'>${
        songs.length ? "No songs match your search." : "No songs yet."
      }</p>`;
    if (window.bulkList) {
      window.bulkList({
        listId: "songs-list",
        type: "song",
        noun: "song",
        rowIdSelector: ".edit-song",
        duplicate: (id) => window.adminApi(`/songs/${id}/duplicate`, { method: "POST" }),
        remove: (id) => window.adminApi(`/songs/${id}`, { method: "DELETE" }),
        reload: loadSongsList,
      });
    }
    $("songs-list")
      .querySelectorAll(".edit-song")
      .forEach((btn) => btn.addEventListener("click", () => openBuilder(Number(btn.dataset.id))));
    $("songs-list")
      .querySelectorAll(".usage-song")
      .forEach((btn) => btn.addEventListener("click", () => window.showContentUsage("song", btn.dataset.id, btn.dataset.name)));
    $("songs-list")
      .querySelectorAll(".duplicate-song")
      .forEach((btn) =>
        btn.addEventListener("click", async () => {
          await window.adminApi(`/songs/${btn.dataset.id}/duplicate`, { method: "POST" });
          await loadSongsList();
        })
      );
    $("songs-list")
      .querySelectorAll(".delete-song")
      .forEach((btn) =>
        btn.addEventListener("click", async () => {
          const usage = await window.adminApi(`/content-usage?type=song&id=${btn.dataset.id}`).catch(() => []);
          const msg = usage.length
            ? `This song is used in: ${usage.map((u) => u.title).join(", ")}. Delete anyway? Those blocks will be omitted from public pages until replaced.`
            : "Delete this song? This can't be undone.";
          if (!confirm(msg)) return;
          await window.adminApi(`/songs/${btn.dataset.id}`, { method: "DELETE" });
          await loadSongsList();
        })
      );
  }

  // ---------- Templates ----------
  // Same generic /templates?kind=... API the simulation builder already
  // uses for its own "Save as template"/picker pair -- songs just weren't
  // in TEMPLATE_KINDS yet. Adding "song" there plus this wiring is the
  // whole feature; the storage/listing/deletion endpoints needed zero
  // changes since they were already kind-agnostic.
  let songTemplates = [];
  async function loadSongTemplates() {
    try {
      songTemplates = await window.adminApi("/templates?kind=song");
    } catch {
      songTemplates = [];
    }
    const starters = window.SongStarters ? window.SongStarters.LIST : [];
    $("song-template-picker").innerHTML =
      `<option value="">Blank</option>` +
      (starters.length ? `<optgroup label="Built-in starters">${starters.map((x) => `<option value="starter:${x.id}" title="${escapeXml(x.blurb)}">${escapeXml(x.name)}</option>`).join("")}</optgroup>` : "") +
      (songTemplates.length ? `<optgroup label="Your templates">${songTemplates.map((t) => `<option value="${t.id}">${escapeXml(t.name)}</option>`).join("")}</optgroup>` : "");
  }

  // Mute/hide describe one song's working state, like private_notes; a new
  // song made from a template should start audible and fully expanded.
  function stripSongMixFlags(data) {
    const clean = JSON.parse(JSON.stringify(data));
    Object.values(clean.trackMeta || {}).forEach((meta) => {
      delete meta.muted;
      delete meta.hidden;
    });
    if (clean.melody) {
      delete clean.melody.muted;
      delete clean.melody.hidden;
    }
    PART_KEYS.forEach((key) => {
      if (clean[key]) {
        delete clean[key].muted;
        delete clean[key].hidden;
      }
    });
    return pruneParts(clean);
  }

  $("save-song-template-btn").addEventListener("click", async () => {
    const name = prompt("Template name:");
    if (!name) return;
    try {
      // Everything else in songData is a reusable starting point (tempo,
      // kit, tracks, theme) -- private_notes is commentary about this ONE
      // production ("redo the kick", "old preset, don't ship this"), not
      // something that should silently reappear inside every future song
      // made from this template. Same reasoning openBuilder() already
      // applies to a template's own name not carrying over.
      await window.adminApi("/templates", { method: "POST", body: JSON.stringify({ kind: "song", name, data: stripSongMixFlags({ ...songData, private_notes: "" }) }) });
      await loadSongTemplates();
    } catch (err) {
      alert(err.message);
    }
  });

  // Backfills fields a song saved before they existed (or a template saved
  // before they existed) won't have -- shared by both the "open an existing
  // song" and "start from a template" paths so a stale template can't throw
  // on a missing key any more than a stale saved song already couldn't.
  const isPlain = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  function backfillSongData(data) {
    // A row whose tracks object lacks (or mangles) a lane must still open.
    if (!data.tracks || typeof data.tracks !== "object") data.tracks = {};
    // The core rows always exist; an extra voice is only tidied up if the song has it (and never invented).
    const hasRow = (t) => Array.isArray(data.tracks[t]) || Boolean(data.trackMeta && data.trackMeta[t]) || Object.values(isPlain(data.patterns) ? data.patterns : {}).some((pt) => isPlain(pt) && isPlain(pt.tracks) && Array.isArray(pt.tracks[t]));
    [...CORE_TRACKS, ...EXTRA_TRACKS.filter(hasRow)].forEach((t) => {
      const lane = Array.isArray(data.tracks[t]) ? data.tracks[t] : [];
      data.tracks[t] = Array.from({ length: STEPS }, (_, i) => (lane[i] === undefined ? false : lane[i]));
    });
    if (!data.melody) data.melody = defaultSongData().melody;
    if (!data.melody.notes) data.melody.notes = defaultSongData().melody.notes;
    PIANO_NOTES.forEach((n) => {
      if (!data.melody.notes[n]) data.melody.notes[n] = new Array(STEPS).fill(false);
    });
    // The bass, chords and lead, for a song that has them: every note of the part's roll present, nothing odd left in place of an object.
    PART_KEYS.forEach((key) => {
      if (data[key] !== undefined && !isPlain(data[key])) delete data[key];
      if (!isPlain(data[key])) return;
      const partNotes = isPlain(data[key].notes) ? data[key].notes : {};
      data[key].notes = {};
      PART_NOTES[key].forEach((n) => {
        const lane = Array.isArray(partNotes[n]) ? partNotes[n] : [];
        data[key].notes[n] = Array.from({ length: STEPS }, (_, i) => (lane[i] === undefined ? false : lane[i]));
      });
      if (data[key].ties !== undefined && !isPlain(data[key].ties)) delete data[key].ties;
    });
    if (!data.trackMeta) data.trackMeta = defaultSongData().trackMeta;
    [...CORE_TRACKS, ...EXTRA_TRACKS.filter(hasRow)].forEach((t) => {
      if (!data.trackMeta[t]) data.trackMeta[t] = { color: DEFAULT_TRACK_COLORS[t], note: "" };
    });
    // Other patterns, if the song has them: every row and every piano roll note present, and nothing odd left in place of an object.
    if (data.patterns !== undefined && !isPlain(data.patterns)) delete data.patterns;
    if (isPlain(data.patterns)) {
      Object.keys(data.patterns).forEach((name) => {
        if (!Engine.PATTERN_NAMES.includes(name) || !isPlain(data.patterns[name])) { delete data.patterns[name]; return; }
        const part = data.patterns[name];
        const tracks = isPlain(part.tracks) ? part.tracks : {};
        part.tracks = {};
        [...CORE_TRACKS, ...EXTRA_TRACKS.filter((t) => data.trackMeta[t])].forEach((t) => {
          const lane = Array.isArray(tracks[t]) ? tracks[t] : [];
          part.tracks[t] = Array.from({ length: STEPS }, (_, i) => (lane[i] === undefined ? false : lane[i]));
        });
        const notes = isPlain(part.notes) ? part.notes : {};
        part.notes = {};
        PIANO_NOTES.forEach((n) => {
          const lane = Array.isArray(notes[n]) ? notes[n] : [];
          part.notes[n] = Array.from({ length: STEPS }, (_, i) => (lane[i] === undefined ? false : lane[i]));
        });
        if (!isPlain(part.ties)) part.ties = {};
        PART_KEYS.forEach((key) => {
          if (part[key] !== undefined && !isPlain(part[key])) delete part[key];
          if (!isPlain(part[key])) return;
          const lanes = isPlain(part[key].notes) ? part[key].notes : {};
          part[key].notes = {};
          PART_NOTES[key].forEach((n) => {
            const lane = Array.isArray(lanes[n]) ? lanes[n] : [];
            part[key].notes[n] = Array.from({ length: STEPS }, (_, i) => (lane[i] === undefined ? false : lane[i]));
          });
          if (!isPlain(part[key].ties)) part[key].ties = {};
        });
      });
      if (!Object.keys(data.patterns).length) delete data.patterns;
    }
    if (data.editing !== undefined && !Engine.PATTERN_NAMES.includes(data.editing)) delete data.editing;
    if (data.chain !== undefined && !Array.isArray(data.chain)) delete data.chain;
    if (data.bars !== undefined && !(Number.isInteger(data.bars) && data.bars >= 1)) delete data.bars;
    if (data.bars > Engine.MAX_BARS) data.bars = Engine.MAX_BARS;
    if (data.lanes !== undefined && !isPlain(data.lanes)) delete data.lanes;
    if (isPlain(data.lanes)) {
      Object.keys(data.lanes).forEach((key) => {
        if (!Engine.LANE_KEYS.includes(key) || !isPlain(data.lanes[key]) || !Array.isArray(data.lanes[key].order)) { delete data.lanes[key]; return; }
        data.lanes[key].order = data.lanes[key].order.filter((n) => Engine.PATTERN_NAMES.includes(n)).slice(0, Engine.MAX_BARS);
        if (data.lanes[key].loop !== false) delete data.lanes[key].loop;
      });
      if (!Object.keys(data.lanes).length) delete data.lanes;
    }
    if (data.private_notes == null) data.private_notes = "";
    return data;
  }

  $("songs-btn").addEventListener("click", async () => {
    $("songs-modal").hidden = false;
    $("song-search").value = ""; // reset on open -- a leftover filter from a previous visit would silently hide songs the admin expects to see
    await loadSongsList();
    await loadSongTemplates();
  });
  $("close-songs").addEventListener("click", () => {
    cancelPendingOpen();
    $("songs-modal").hidden = true;
  });
  $("song-search").addEventListener("input", renderSongsList);
  $("new-song-btn").addEventListener("click", () => {
    const choice = $("song-template-picker").value;
    if (choice.startsWith("starter:")) openBuilder(null, null, choice.slice("starter:".length));
    else openBuilder(null, Number(choice) || null);
  });

  // ---------- Tabs (songs open in this session) ----------
  // Each tab is a song row, or the one unsaved draft (id null). Switching
  // reuses openBuilder(), so every guard it already has (pending saves, the
  // generation token against racing opens) applies unchanged; the only
  // addition is flushing a pending autosave first so a quick switch doesn't
  // ask "discard unsaved changes?" over an edit that autosave was seconds from
  // saving.
  let songTabs = [];
  function renderSongTabs() {
    const bar = $("song-tabs");
    if (!bar) return;
    bar.innerHTML = "";
    const list = document.createElement("div");
    list.className = "song-tablist";
    // An empty tablist is invalid ARIA; it only exists once there is a tab in it.
    if (songTabs.length) {
      list.setAttribute("role", "tablist");
      list.setAttribute("aria-label", "Open songs");
    }
    songTabs.forEach((t) => {
      const active = t.draft ? currentSongId == null : t.id === currentSongId;
      const title = (t.draft ? "(unsaved) " : "") + (t.name || "Untitled song");
      const wrap = document.createElement("div");
      wrap.className = "song-tab" + (active ? " is-active" : "");
      wrap.setAttribute("role", "presentation");
      const label = document.createElement("button");
      label.type = "button";
      label.className = "song-tab-label";
      label.setAttribute("role", "tab");
      label.setAttribute("aria-selected", String(active));
      label.tabIndex = active ? 0 : -1;
      label.textContent = title;
      label.title = title + " (Delete closes this tab)";
      label.addEventListener("click", () => switchToTab(t));
      label.addEventListener("keydown", (e) => {
        if (e.key === "Delete") {
          e.preventDefault();
          closeTab(t);
        }
      });
      const close = document.createElement("button");
      close.type = "button";
      close.className = "song-tab-close";
      close.tabIndex = -1; // Delete on the tab closes it; one Tab stop per tab, not two
      // A tablist may only hold tabs, so the mouse-only close button is hidden from assistive technology: Delete on the tab
      // (announced in its description) is the keyboard and screen-reader way to close it.
      close.setAttribute("aria-hidden", "true");
      close.setAttribute("aria-label", "Close tab " + title);
      close.textContent = "×";
      close.addEventListener("click", () => closeTab(t));
      wrap.append(label, close);
      list.append(wrap);
    });
    bar.append(list);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "song-tab-add";
    add.innerHTML = '<span class="song-tab-add-long">+ Open another song</span><span class="song-tab-add-short" aria-hidden="true">+ Open</span>';
    add.setAttribute("aria-label", "Open another song");
    add.title = "Go to the song list (your open tabs stay)";
    add.addEventListener("click", leaveToSongList);
    bar.append(add);
    // Keep the active tab in view in the scrolling strip (only the strip scrolls).
    // Deferred a frame so the strip has its layout when the builder has just opened.
    requestAnimationFrame(() => {
      const current = list.querySelector(".song-tab.is-active");
      if (!current) return;
      if (current.offsetLeft < list.scrollLeft) list.scrollLeft = current.offsetLeft - 8;
      else if (current.offsetLeft + current.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = current.offsetLeft + current.offsetWidth - list.clientWidth + 8;
    });
  }
  // Left/Right/Home/End move between tabs (roving tabindex).
  $("song-tabs").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const tabs = [...$("song-tabs").querySelectorAll(".song-tab-label")];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
  });
  function syncActiveTab() {
    const name = $("song-name").value.trim() || "Untitled song";
    let tab = songTabs.find((t) => (currentSongId ? t.id === currentSongId : t.draft));
    if (!tab) {
      // A draft that just got its first save turns into that song's tab.
      const draft = currentSongId ? songTabs.find((t) => t.draft) : null;
      if (draft) {
        draft.draft = false;
        draft.id = currentSongId;
        tab = draft;
      } else {
        tab = currentSongId ? { id: currentSongId, name } : { id: null, draft: true, name };
        songTabs.push(tab);
      }
    }
    tab.name = name;
    renderSongTabs();
    // One persistent live region, updated only when the open song really changes.
    const key = tab.draft ? "draft" : String(tab.id);
    if (key !== lastAnnouncedTab) {
      lastAnnouncedTab = key;
      const status = $("song-tab-status");
      if (status) status.textContent = `Editing ${name}, tab ${songTabs.indexOf(tab) + 1} of ${songTabs.length}`;
    }
  }
  let lastAnnouncedTab = null;
  async function flushAutosaveBeforeSwitch() {
    if (currentSongId && songHasUnsavedChanges) {
      clearTimeout(autosaveTimer);
      await autosaveSong();
    }
  }
  async function switchToTab(t) {
    const active = t.draft ? currentSongId == null : t.id === currentSongId;
    if (active) {
      // Clicking the tab you are already on after asking for another one: the
      // latest click wins, so cancel the pending open.
      if (openRequestSeq !== committedOpenSeq) openRequestSeq++;
      return;
    }
    try {
      await flushAutosaveBeforeSwitch();
      if (await openBuilder(t.id)) focusActiveTab();
    } catch (err) {
      alert(`Couldn't switch songs: ${(err && err.message) || "something went wrong"}`);
    }
  }
  async function closeTab(t) {
    if (!songTabs.includes(t)) return; // a second click on a tab already closed
    const active = t.draft ? currentSongId == null : t.id === currentSongId;
    // Closing the tab whose open is still loading cancels that open.
    if (!active && !t.draft && pendingOpenId === t.id) cancelPendingOpen();
    if (!active) {
      songTabs = songTabs.filter((x) => x !== t);
      renderSongTabs();
      focusActiveTab();
      return;
    }
    try {
      await flushAutosaveBeforeSwitch();
      const i = songTabs.indexOf(t);
      const neighbour = songTabs[i + 1] || songTabs[i - 1];
      if (neighbour) {
        // The tab goes only once the switch really happened (a declined discard
        // prompt, a save in progress or a failed load keeps everything as it was).
        if (await openBuilder(neighbour.id)) {
          songTabs = songTabs.filter((x) => x !== t);
          renderSongTabs();
          focusActiveTab();
        }
      } else if (canLeaveSongBuilder()) {
        cancelPendingOpen();
        songTabs = [];
        renderSongTabs();
        stopPlayback();
        $("song-builder-modal").hidden = true;
        $("songs-modal").hidden = false;
        loadSongsList().catch(() => {});
      }
    } catch (err) {
      alert(`Couldn't close that tab: ${(err && err.message) || "something went wrong"}`);
    }
  }
  // Focus survives a re-render: the strip is rebuilt, so put it back on the
  // active tab after a switch or close.
  function focusActiveTab() {
    requestAnimationFrame(() => {
      const el = $("song-tabs").querySelector(".song-tab.is-active .song-tab-label");
      if (el) el.focus();
    });
  }
  // An explicit leave (top ×, "+ Open another song", closing the last tab, closing
  // the list) beats an open that is still waiting on its GET.
  function cancelPendingOpen() {
    if (openRequestSeq !== committedOpenSeq) openRequestSeq++;
  }
  async function leaveToSongList() {
    await flushAutosaveBeforeSwitch();
    if (!canLeaveSongBuilder()) return;
    cancelPendingOpen();
    stopPlayback();
    $("song-builder-modal").hidden = true;
    $("songs-modal").hidden = false;
    loadSongsList().catch(() => {});
  }
  $("song-name").addEventListener("input", () => {
    const tab = songTabs.find((t) => (currentSongId ? t.id === currentSongId : t.draft));
    if (tab) {
      tab.name = $("song-name").value.trim() || "Untitled song";
      renderSongTabs();
    }
  });

  // ---------- Open / close builder ----------
  // Fetch first, commit second: the song that is open stays fully intact (id,
  // form, data, autosave state) until the requested one has actually loaded, so a
  // failed or superseded open can never leave the builder pointing at one song
  // while showing another's content. Resolves true once the new song is open.
  let openRequestSeq = 0;
  let committedOpenSeq = 0;
  let pendingOpenId = null; // the song a not-yet-committed open is fetching
  // What a new blank song starts with, from Site Settings > Songs (tempo, length, drum kit). A failed read just leaves the built-in defaults.
  async function fetchSongDefaults() {
    try {
      return await window.adminApi("/settings");
    } catch {
      return null;
    }
  }
  function applySongDefaults(data, settings) {
    if (!settings) return;
    try {
      const tempo = Number(settings.song_default_tempo);
      if (Number.isInteger(tempo) && tempo >= 40 && tempo <= 240) data.tempo = tempo;
      const bars = Number(settings.song_default_bars);
      if (Number.isInteger(bars) && bars >= 1 && bars <= Engine.MAX_BARS) data.bars = bars;
      if (Engine.KITS.includes(settings.song_default_kit)) data.kit = settings.song_default_kit;
    } catch {
      /* built-in defaults */
    }
  }
  async function openBuilder(id, templateId, starterId) {
    if (!canLeaveSongBuilder(false)) return false;
    const dirtyGenAtAsk = songDirtyGeneration;
    // Clicking Edit on song A and then song B before A's GET resolves: only the
    // latest request may apply its response.
    const mySeq = ++openRequestSeq;
    pendingOpenId = id;
    let song = null;
    let defaults = null;
    if (!id && !starterId && !templateId) defaults = await fetchSongDefaults(); // read with the other request, before this open is committed
    if (!id && mySeq !== openRequestSeq) return false;
    if (id) {
      try {
        song = await window.adminApi(`/songs/${id}`);
      } catch (err) {
        if (mySeq !== openRequestSeq) return false;
        if (/not found/i.test((err && err.message) || "")) {
          songTabs = songTabs.filter((t) => t.id !== id);
          renderSongTabs();
        }
        alert(`Couldn't open that song: ${(err && err.message) || "the request failed"}`);
        return false;
      }
      if (mySeq !== openRequestSeq) return false;
    }
    // Edits made to the open song while the GET was in flight were never part of
    // the answer given above: ask again rather than dropping them.
    if (songHasUnsavedChanges && songDirtyGeneration !== dirtyGenAtAsk) {
      if (!canLeaveSongBuilder(false)) return false;
    }
    committedOpenSeq = mySeq;
    // Leaving an unsaved draft discards it, so its tab goes too.
    if (currentSongId == null) songTabs = songTabs.filter((t) => !t.draft);
    stopPlayback();
    // Drop any pending autosave for the PREVIOUS song now that it is really being
    // left (openGeneration below also makes any in-flight one stale).
    clearTimeout(autosaveTimer);
    setAutosaveStatus("");
    songHasUnsavedChanges = false;
    songDirtyGeneration = 0;
    autosaveQueued = false;
    const myGeneration = ++openGeneration;
    void myGeneration;
    currentSongId = id;
    if (id) {
      $("song-name").value = song.name;
      songData = backfillSongData(song.data && song.data.tracks ? song.data : defaultSongData());
    } else if (starterId && window.SongStarters && window.SongStarters.build(starterId)) {
      // A built-in starter: a whole little song, named for what it is (rename it before saving, or leave it).
      const starter = window.SongStarters.LIST.find((x) => x.id === starterId);
      $("song-name").value = starter.name;
      songData = backfillSongData(window.SongStarters.build(starterId));
    } else if (templateId) {
      const t = songTemplates.find((x) => x.id === templateId);
      // A template is a fresh starting point, same as a blank song -- its
      // own name is just a label for picking it in the dropdown, not
      // something that should carry over onto every song created from it.
      $("song-name").value = "New song";
      songData = backfillSongData(t && t.data && t.data.tracks ? JSON.parse(JSON.stringify(t.data)) : defaultSongData());
    } else {
      $("song-name").value = "New song";
      songData = defaultSongData();
      applySongDefaults(songData, defaults);
    }
    $("song-tempo").value = songData.tempo || 120;
    $("song-kit").value = songData.kit || "acoustic";
    $("song-waveform").value = songData.melody.waveform || "sine";
    syncVoiceControl();
    $("song-visualization").value = songData.visualization || "bars";
    $("song-theme").value = SONG_THEME_CLASSES.has(songData.theme) ? songData.theme : "default";
    applySongTheme($("song-preview-embed"), songData.theme);
    $("song-page-sync").checked = !!songData.page_sync;
    $("song-master-volume").value = Math.round((typeof songData.master_volume === "number" ? songData.master_volume : 1) * 100);
    $("song-humanize").value = typeof songData.humanize === "number" ? songData.humanize : 0;
    $("song-swing").value = Number(songData.swing) || 0;
    $("song-swing").setAttribute("aria-valuetext", Number(songData.swing) ? `${Number(songData.swing)}% swing` : "Straight");
    $("song-space").value = Number(songData.space) || 0;
    $("song-space").setAttribute("aria-valuetext", Number(songData.space) ? `${Number(songData.space)}% space` : "Dry");
    $("song-echo").value = Number(songData.echo) || 0;
    $("song-echo").setAttribute("aria-valuetext", Number(songData.echo) ? `${Number(songData.echo)}% echo` : "Dry");
    $("song-pump").value = Number(songData.pump) || 0;
    $("song-pump").setAttribute("aria-valuetext", Number(songData.pump) ? `${Number(songData.pump)}% pump` : "Off");
    $("song-notes").value = songData.private_notes || "";
    // The shared AudioContext (and its master GainNode) persists across
    // songs -- without this, opening song B right after playing song A
    // would leave the gain at A's last value until B's own playback
    // schedules its first step.
    Engine.setMasterVolume(getAudioCtx(), songData.master_volume);
    Engine.setSpace(getAudioCtx(), songData.space);
    Engine.setEcho(getAudioCtx(), songData.echo, songData.tempo);
    $("song-preview-name").textContent = $("song-name").value || "Song name";
    // songData was just reassigned to a new object — the player has to be
    // rebuilt against it, since createPlayer captured the old reference.
    player = Engine.createPlayer(getAudioCtx, songData, onPlayerStep);
    $("songs-modal").hidden = true;
    $("song-builder-modal").hidden = false;
    resetSongHistory();
    resetClipHistory();
    // Play follows the song when it has several bars (a song order, a bar count or a track with bars of its own); the Studio always plays the song.
    playOrder = chainList().length > 1 || Boolean(songData.bars) || Engine.hasLanes(songData) || Boolean(window.SongStudio && window.SongStudio.active && window.SongStudio.active());
    rollPart = "melody"; // every song opens on its melody
    renderSequencer();
    renderPianoRoll();
    renderPatternControls();
    patternSay("");
    notifyStudio(true);
    updatePreviewVisibility();
    refreshWaveformPreview();
    syncActiveTab();
    return true;
  }

  $("close-song-builder").addEventListener("click", () => {
    if (!canLeaveSongBuilder()) return;
    cancelPendingOpen();
    songTabs = []; // the top × ends the editing session; "+ Open another song" keeps the tabs
    lastAnnouncedTab = null;
    renderSongTabs();
    stopPlayback();
    $("song-builder-modal").hidden = true;
    $("songs-modal").hidden = false;
    loadSongsList().catch(() => {});
  });

  $("save-song").addEventListener("click", async () => {
    if (songSavePending) return;
    const name = $("song-name").value.trim();
    if (!name) return alert("Name is required.");
    songData.tempo = Number($("song-tempo").value) || 120;
    songData.kit = $("song-kit").value;
    songData.melody.waveform = $("song-waveform").value;
    songData.visualization = $("song-visualization").value;
    songData.theme = $("song-theme").value;
    songData.page_sync = $("song-page-sync").checked;
    songData.master_volume = Number($("song-master-volume").value) / 100;
    songData.humanize = Number($("song-humanize").value) || 0;
    songData.swing = Number($("song-swing").value) || 0;
    songData.space = Number($("song-space").value) || 0;
    songData.private_notes = $("song-notes").value;
    const gen = openGeneration;
    const id = currentSongId;
    const dirtyGen = songDirtyGeneration;
    const data = pruneParts(JSON.parse(JSON.stringify(songData)));
    const saveButton = $("save-song");
    const wasDisabled = saveButton.disabled;
    const pendingAutosave = autosavePromise;
    songSavePending = true;
    songSaveOpenGeneration = gen;
    autosaveQueued = false;
    clearTimeout(autosaveTimer);
    saveButton.disabled = true;
    setAutosaveStatus("Saving…");
    let saveFailed = false;
    try {
      await refreshCachedWaveformPeaks(data);
      // An older autosave may already be writing this same row. Let it
      // finish before the explicit Save so an earlier snapshot cannot
      // arrive last and overwrite the newer manual save.
      if (pendingAutosave) await pendingAutosave;
      let newId = id;
      if (id) {
        await window.adminApi(`/songs/${id}`, { method: "PATCH", body: JSON.stringify({ name, data }) });
      } else {
        const res = await window.adminApi("/songs", { method: "POST", body: JSON.stringify({ name, data }) });
        newId = res.id;
        if (!newId) throw new Error("Save did not return a song id.");
      }
      if (gen !== openGeneration) {
        // A different song is open now, but THIS song's data was still
        // genuinely saved above -- refresh the songs list so a
        // brand-new song shows up there rather than only existing in a
        // database row nobody in the UI knows about yet.
        if (window.refreshSongOptions) window.refreshSongOptions();
        return;
      }
      if (!id) {
        currentSongId = newId;
        syncActiveTab();
      }
      if (dirtyGen === songDirtyGeneration) {
        clearTimeout(autosaveTimer);
        songHasUnsavedChanges = false;
        autosaveQueued = false;
        setAutosaveStatus("Saved " + new Date().toLocaleTimeString());
      } else {
        songHasUnsavedChanges = true;
        setAutosaveStatus("Saved, but newer edits still need saving…");
      }
      if (window.refreshSongOptions) window.refreshSongOptions();
    } catch (err) {
      if (gen !== openGeneration) {
        // The user has already moved to another song, so nothing on screen shows
        // this failure; say so rather than losing the edits silently.
        alert(`The save of "${name}" failed after you left it: ${err.message}`);
        return;
      }
      saveFailed = true;
      songHasUnsavedChanges = true;
      setAutosaveStatus("Save failed: " + err.message);
      alert(err.message);
    } finally {
      songSavePending = false;
      songSaveOpenGeneration = null;
      saveButton.disabled = wasDisabled;
      if (gen !== openGeneration) {
        // A different song may have been opened while the captured Save
        // was pending. If that song was edited, its queued autosave still
        // needs a timer after this page-wide Save lock is released.
        if (autosaveQueued && songHasUnsavedChanges && currentSongId) {
          autosaveQueued = false;
          queueSongAutosave();
        }
      } else if (songHasUnsavedChanges && currentSongId &&
          (dirtyGen !== songDirtyGeneration || autosaveQueued || saveFailed)) {
        autosaveQueued = false;
        queueSongAutosave();
      }
    }
  });

  // ---------- Export session report ----------
  // A plain-text summary of this song's current in-memory settings and
  // note counts -- reads songData directly, so it reflects any unsaved
  // edits still in the builder, not just what's persisted.
  const REPORT_NAMES = { bass: "Bass", chords: "Chords", lead: "Lead" };
  $("song-export-report").addEventListener("click", () => {
    const name = $("song-name").value.trim() || "Untitled song";
    const lines = [
      `Song: ${name}`,
      `Tempo: ${songData.tempo} BPM`,
      `Drum kit: ${songData.kit}`,
      ...(Engine.isSinglePattern(songData)
        ? []
        : [`Patterns: ${Engine.patternNames(songData).join(", ")} (${editingPattern()} was open)`, `Song order: ${Engine.chainOf(songData).join(" ")} (${Engine.chainOf(songData).length} bar${Engine.chainOf(songData).length === 1 ? "" : "s"})`]),
      `Melody sound: ${Engine.melodyVoiceOf(songData) ? Engine.MELODY_VOICES[Engine.melodyVoiceOf(songData)].label : `Basic, ${songData.melody.waveform} waveform`}${songData.melody.muted === true ? " (muted)" : ""}${reportVolume(songData.melody)}`,
      ...PART_KEYS.filter(partHasNotes).map((key) => `${REPORT_NAMES[key]} sound: ${Engine.MELODY_VOICES[Engine.partVoiceOf(songData, key)].label}${songData[key].muted === true ? " (muted)" : ""}${reportVolume(songData[key])}`),
      `Visualization: ${songData.visualization}`,
      `Theme: ${songData.theme}`,
      `Master volume: ${Math.round((typeof songData.master_volume === "number" ? songData.master_volume : 1) * 100)}%`,
      `Humanize: ${typeof songData.humanize === "number" ? songData.humanize : 0}%`,
      `Swing: ${typeof songData.swing === "number" ? songData.swing : 0}%`,
      `Space: ${typeof songData.space === "number" ? songData.space : 0}%`,
      `Echo: ${Number(songData.echo) || 0}%`,
      ...(Number(songData.pump) ? [`Pump: ${Number(songData.pump)}%`] : []),
      `Page background sync: ${songData.page_sync ? "on" : "off"}`,
      ...(clipTotal ? [`Master clipping events this session: ${clipTotal}`] : []),
      "",
      "Drum tracks (steps hit / total):",
      ...trackList().map((t) => `  ${TRACK_LABELS[t]}: ${songData.tracks[t].filter(Boolean).length} / ${STEPS}${songData.trackMeta[t].muted === true ? " (muted)" : ""}${reportVolume(songData.trackMeta[t])}`),
      "",
      "Melody notes used:",
    ];
    const usedNotes = PIANO_NOTES.filter((n) => songData.melody.notes[n] && songData.melody.notes[n].some(Boolean));
    if (usedNotes.length) {
      usedNotes.forEach((n) => lines.push(`  ${n}: ${songData.melody.notes[n].filter(Boolean).length} / ${STEPS}`));
    } else {
      lines.push("  (none)");
    }
    PART_KEYS.filter(partHasNotes).forEach((key) => {
      lines.push("", `${REPORT_NAMES[key]} notes used:`);
      PART_NOTES[key].filter((n) => songData[key].notes[n] && songData[key].notes[n].some(Boolean)).forEach((n) => lines.push(`  ${n}: ${songData[key].notes[n].filter(Boolean).length} / ${STEPS}`));
    });
    if (songData.private_notes && songData.private_notes.trim()) {
      lines.push("", "Notes:", songData.private_notes.trim());
    }
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9-_]+/gi, "-") || "song"}-report.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ---------- Export MIDI and the song file; import a song file ----------
  const fileStatus = (text) => {
    $("song-file-status").textContent = text;
  };
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  const fileStem = () => (($("song-name").value.trim() || "Untitled song").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "song");
  $("song-export-midi").addEventListener("click", () => {
    const out = window.SongFiles.buildMidi(songData, $("song-name").value.trim() || "Untitled song");
    if (!out.bytes) {
      fileStatus("Nothing to export: no unmuted drum track, melody, bass, chords or lead has any notes.");
      return;
    }
    downloadBlob(new Blob([out.bytes], { type: "audio/midi" }), `${fileStem()}.mid`);
    const bars = window.SongFiles.chainParts(songData).length;
    fileStatus(`Exported ${out.notes} note${out.notes === 1 ? "" : "s"} as MIDI (${bars === 1 ? "one bar" : `${bars} bars, the song order`}${Number(songData.swing) ? ", with swing" : ""}; muted tracks left out).`);
  });
  $("song-export-json").addEventListener("click", () => {
    const text = window.SongFiles.exportJson($("song-name").value, songData);
    downloadBlob(new Blob([text], { type: "application/json" }), `${fileStem()}.song.json`);
    fileStatus("Exported the whole song as a file.");
  });
  $("song-import-btn").addEventListener("click", () => $("song-import-input").click());
  $("song-import-input").addEventListener("change", async () => {
    const input = $("song-import-input");
    const file = input.files && input.files[0];
    input.value = "";
    const status = $("song-import-status");
    if (!file) return;
    if (file.size > 2000000) {
      status.textContent = "That file is too big to be a song (over 2 MB).";
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      status.textContent = "Couldn't read that file.";
      return;
    }
    const parsed = window.SongFiles.parseImport(text);
    if (parsed.error) {
      status.textContent = parsed.error;
      return;
    }
    try {
      status.textContent = "Importing…";
      const created = await window.adminApi("/songs", { method: "POST", body: JSON.stringify({ name: parsed.name, data: parsed.data }) });
      await loadSongsList();
      status.textContent = `Imported "${parsed.name}" as a new song.`;
      await openBuilder(created.id);
    } catch (e) {
      status.textContent = `Couldn't import the song: ${e.message || e}`;
    }
  });

  // A MIDI file becomes a new song (see SongFiles.importMidi); what could not be kept is listed in the open builder.
  $("song-import-midi-btn").addEventListener("click", () => $("song-import-midi-input").click());
  $("song-import-midi-input").addEventListener("change", async () => {
    const input = $("song-import-midi-input");
    const file = input.files && input.files[0];
    input.value = "";
    const status = $("song-import-status");
    if (!file) return;
    if (file.size > 1000000) {
      status.textContent = "That MIDI file is too big (over 1 MB).";
      return;
    }
    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch {
      status.textContent = "Couldn't read that file.";
      return;
    }
    const result = window.SongFiles.importMidi(new Uint8Array(buffer));
    if (result.error) {
      status.textContent = result.error;
      return;
    }
    const name = file.name.replace(/\.(midi?|MIDI?)$/i, "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200) || "Imported MIDI";
    const notes = result.info.messages.join(" ");
    try {
      status.textContent = "Importing…";
      const created = await window.adminApi("/songs", { method: "POST", body: JSON.stringify({ name, data: result.song }) });
      await loadSongsList();
      status.textContent = `Imported "${name}" as a new song. ${notes}`;
      await openBuilder(created.id);
      fileStatus(`Imported from MIDI. ${notes}`);
    } catch (e) {
      status.textContent = `Couldn't import the song: ${e.message || e}`;
    }
  });

  // ---------- Export audio (WAV) ----------
  // Renders the loop offline (SongEngine.renderLoopAudio) and writes a mono
  // WAV: 16- or 24-bit integer PCM, or 32-bit float. Integer depths can be
  // dithered (TPDF, one least-significant bit either side) so rounding error
  // doesn't turn into distortion on quiet material; exact digital silence is
  // left silent rather than given a noise floor. The same song exports the same
  // audio each time, give or take floating-point differences far below one
  // 16-bit step.
  const audioModal = $("song-audio-modal");
  const AUDIO_DEPTHS = { "16": { bytes: 2, label: "16-bit" }, "24": { bytes: 3, label: "24-bit" }, "32f": { bytes: 4, label: "32-bit float" } };

  function encodeWavMono(samples, sampleRate, depth, dither) {
    const bytesPer = AUDIO_DEPTHS[depth].bytes;
    const isFloat = depth === "32f";
    const dataBytes = samples.length * bytesPer;
    const pad = dataBytes % 2; // RIFF chunks sit on even boundaries; an odd 24-bit data chunk gets one pad byte
    const factBytes = isFloat ? 12 : 0; // float WAVs carry a 'fact' chunk with the frame count
    const buffer = new ArrayBuffer(44 + factBytes + dataBytes + pad);
    const view = new DataView(buffer);
    const text = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    text(0, "RIFF");
    view.setUint32(4, 36 + factBytes + dataBytes + pad, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, isFloat ? 3 : 1, true); // 1 = integer PCM, 3 = IEEE float
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPer, true);
    view.setUint16(32, bytesPer, true);
    view.setUint16(34, bytesPer * 8, true);
    let at = 36;
    if (isFloat) {
      text(at, "fact");
      view.setUint32(at + 4, 4, true);
      view.setUint32(at + 8, samples.length, true);
      at += 12;
    }
    text(at, "data");
    view.setUint32(at + 4, dataBytes, true);
    at += 8;
    let peak = 0;
    let clipped = 0;
    let state = 0x9e3779b9 ^ samples.length; // fixed seed: the same song always exports the same file
    const noise = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
    const full = isFloat ? 0 : Math.pow(2, bytesPer * 8 - 1);
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const mag = Math.abs(x);
      if (mag > peak) peak = mag;
      if (mag > 1) clipped++;
      if (isFloat) {
        view.setFloat32(at, x, true);
      } else {
        let v = Math.max(-1, Math.min(1, x)) * (full - 1);
        if (dither && mag > 1e-9) v += noise() + noise() - 1;
        v = Math.max(-full, Math.min(full - 1, Math.round(v)));
        if (bytesPer === 2) view.setInt16(at, v, true);
        else {
          const u = v < 0 ? v + 0x1000000 : v;
          view.setUint8(at, u & 0xff);
          view.setUint8(at + 1, (u >> 8) & 0xff);
          view.setUint8(at + 2, (u >> 16) & 0xff);
        }
      }
      at += bytesPer;
    }
    return { blob: new Blob([buffer], { type: "audio/wav" }), bytes: new Uint8Array(buffer), peak, clipped };
  }

  // A minimal ZIP writer (stored, no compression: WAV doesn't compress usefully
  // and this keeps it dependency-free). File names are flagged as UTF-8.
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function buildZip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const file of files) {
      const name = enc.encode(file.name);
      const crc = crc32(file.bytes);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true); // stored
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, file.bytes.length, true);
      local.setUint32(22, file.bytes.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(local.buffer, name, file.bytes);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, dosTime, true);
      entry.setUint16(14, dosDate, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, file.bytes.length, true);
      entry.setUint32(24, file.bytes.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(entry.buffer, name);
      offset += 30 + name.length + file.bytes.length;
    }
    const centralSize = central.reduce((n, part) => n + (part.byteLength !== undefined ? part.byteLength : part.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
  }

  // One copy of the song per stem, with every other track, the melody, the bass, the chords and the lead muted
  // (a muted track in the song itself is left out). Stems are rendered on their
  // own, so noise-based drums and humanize timing are not sample-identical to
  // the same track inside the full mix.
  function stemJobs() {
    const jobs = [];
    const copyFor = (solo) => {
      const copy = JSON.parse(JSON.stringify(songData));
      copy.trackMeta = copy.trackMeta || {};
      trackList().forEach((t) => { copy.trackMeta[t] = { ...(copy.trackMeta[t] || {}), muted: t !== solo }; });
      copy.melody = copy.melody || { waveform: "sine", notes: {} };
      copy.melody.muted = solo !== "melody";
      PART_KEYS.forEach((key) => {
        if (copy[key]) copy[key].muted = solo !== key;
      });
      return copy;
    };
    const playedPatterns = Engine.chainPatterns(songData);
    trackList().forEach((t) => {
      const hits = playedPatterns.some((part) => (part.tracks[t] || []).some(Boolean));
      if (hits && !(songData.trackMeta && songData.trackMeta[t] && songData.trackMeta[t].muted === true)) jobs.push({ id: t, label: TRACK_LABELS[t], data: copyFor(t) });
    });
    const anyMelody = playedPatterns.some((part) => Object.values(part.notes).some((lane) => Array.isArray(lane) && lane.some(Boolean)));
    if (anyMelody && !(songData.melody && songData.melody.muted === true)) jobs.push({ id: "melody", label: "Melody", data: copyFor("melody") });
    const STEM_LABELS = { bass: "Bass", chords: "Chords", lead: "Lead" };
    PART_KEYS.forEach((key) => {
      const any = playedPatterns.some((part) => part[key] && Object.values(part[key].notes).some((lane) => Array.isArray(lane) && lane.some(Boolean)));
      if (any && !(songData[key] && songData[key].muted === true)) jobs.push({ id: key, label: STEM_LABELS[key], data: copyFor(key) });
    });
    return jobs;
  }

  function audioOptions() {
    return {
      sampleRate: Number($("song-audio-rate").value),
      depth: $("song-audio-depth").value,
      loops: Number($("song-audio-loops").value),
      tailSeconds: Number($("song-audio-tail").value),
      dither: $("song-audio-dither").checked && $("song-audio-depth").value !== "32f",
      stems: $("song-audio-stems").checked,
    };
  }
  function refreshAudioSummary() {
    const o = audioOptions();
    const tempo = Number(songData.tempo) || 120;
    const loopSeconds = (60 / tempo / 4) * Engine.chainSteps(songData);
    const repeats = Math.min(o.loops, Engine.maxExportLoops(songData));
    const seconds = loopSeconds * repeats + o.tailSeconds;
    const files = o.stems ? stemJobs().length : 1;
    const bytes = Math.round(seconds * o.sampleRate) * AUDIO_DEPTHS[o.depth].bytes * Math.max(1, files);
    const size = bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    $("song-audio-dither").disabled = o.depth === "32f";
    $("song-audio-summary").textContent = o.stems
      ? files
        ? `${files} stem${files === 1 ? "" : "s"} of ${seconds.toFixed(2)} seconds at ${songData.tempo} BPM in one ZIP, about ${size}.`
        : "Nothing to export as stems: no unmuted track has any notes."
      : `${seconds.toFixed(2)} seconds at ${songData.tempo} BPM, about ${size}.`;
    // A long song is repeated fewer times than the menu offers (five minutes of audio at most).
    if (repeats < o.loops) $("song-audio-summary").textContent += ` Repeated ${repeats} time${repeats === 1 ? "" : "s"}, not ${o.loops}: the song is long.`;
    // Not while a render is running: Cancel is showing and Export must stay disabled.
    if ($("song-audio-cancel").hidden) $("song-audio-go").disabled = o.stems && !files;
  }
  ["song-audio-rate", "song-audio-depth", "song-audio-loops", "song-audio-tail", "song-audio-dither", "song-audio-stems"].forEach((id) => $(id).addEventListener("change", refreshAudioSummary));
  $("song-export-audio").addEventListener("click", () => {
    $("song-audio-status").textContent = "";
    refreshAudioSummary();
    audioModal.hidden = false;
    $("song-audio-rate").focus();
  });
  // Offline rendering can't be interrupted part-way, but its result can be thrown away: bumping the
  // token makes a render that finishes later do nothing.
  let audioRenderToken = 0;
  function cancelAudioRender() {
    audioRenderToken++;
    $("song-audio-go").disabled = false;
    $("song-audio-cancel").hidden = true;
  }
  function closeAudioDialog() {
    if (!$("song-audio-cancel").hidden) cancelAudioRender();
    audioModal.hidden = true;
    $("song-export-audio").focus();
  }
  $("song-audio-cancel").addEventListener("click", () => {
    cancelAudioRender();
    $("song-audio-status").textContent = "Cancelled.";
    $("song-audio-go").focus();
  });
  $("close-song-audio").addEventListener("click", closeAudioDialog);
  audioModal.addEventListener("click", (e) => {
    if (e.target === audioModal) closeAudioDialog();
  });
  audioModal.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    closeAudioDialog();
  });
  $("song-audio-go").addEventListener("click", async () => {
    const btn = $("song-audio-go");
    const status = $("song-audio-status");
    const o = audioOptions();
    const token = ++audioRenderToken;
    btn.disabled = true;
    $("song-audio-cancel").hidden = false;
    $("song-audio-cancel").focus(); // Export just disabled itself; keep keyboard users in the dialog
    status.textContent = "Rendering… long exports at a high sample rate can take a while. Cancel stops waiting for it.";
    try {
      const jobs = o.stems ? stemJobs() : [{ id: "", label: "", data: songData }];
      if (!jobs.length) {
        status.textContent = "Nothing to export as stems: no unmuted track has any notes.";
        return;
      }
      const results = [];
      for (const job of jobs) {
        const render = await window.SongEngine.renderLoopAudio(job.data, { sampleRate: o.sampleRate, loops: o.loops, tailSeconds: o.tailSeconds });
        if (token !== audioRenderToken) return; // cancelled while rendering
        results.push({ job, ...encodeWavMono(render.samples, render.sampleRate, o.depth, o.dither) });
      }
      // Letters and numbers of any language survive; everything else becomes one dash; capped so the file name stays usable.
      const name = ($("song-name").value.trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/-{2,}/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 80)) || "song";
      const suffix = `${o.loops}x-${o.sampleRate / 1000}kHz-${o.depth === "32f" ? "32f" : o.depth + "bit"}`;
      const wavName = (id) => `${name}${id ? "-" + id : ""}-${suffix}.wav`;
      const file = o.stems ? `${name}-stems-${suffix}.zip` : wavName("");
      const blob = o.stems ? buildZip(results.map((r) => ({ name: wavName(r.job.id), bytes: r.bytes }))) : results[0].blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file;
      a.click();
      URL.revokeObjectURL(url);
      const peak = results.reduce((m, r) => Math.max(m, r.peak), 0);
      const clipped = results.reduce((n, r) => n + r.clipped, 0);
      const level = peak > 0 ? `${(20 * Math.log10(peak)).toFixed(1)} dBFS` : "silent";
      const what = o.stems ? `${results.length} stem${results.length === 1 ? "" : "s"} in ${file}` : file;
      const hot = o.stems ? results.filter((r) => r.clipped).map((r) => r.job.label.toLowerCase()) : [];
      status.textContent = !peak
        ? `Exported ${what}, but it is silent: there is nothing sounding in it.`
        : clipped && o.depth !== "32f"
          ? `Exported ${what}. The ${o.stems ? "loudest peak" : "peak"} was above full scale (${level}), so ${clipped} samples were clipped${hot.length ? ` (in the ${hot.join(", ")} ${hot.length === 1 ? "stem" : "stems"})` : ""}. Lower the master volume, or export 32-bit float to keep them.`
          : `Exported ${what}. ${o.stems ? "Loudest peak" : "Peak"} ${level}.`;
    } catch (err) {
      if (token === audioRenderToken) status.textContent = `Export failed: ${err.message || err}`;
    } finally {
      if (token === audioRenderToken) {
        btn.disabled = false;
        $("song-audio-cancel").hidden = true;
        // The button disabled itself while rendering; keep keyboard users on it.
        if (!audioModal.hidden && (document.activeElement === document.body || document.activeElement === btn)) btn.focus();
      }
    }
  });

  // ---------- Generate waveform cover art ----------
  // Renders the song's own already-existing offline waveform peaks
  // (the same Engine.renderWaveformPeaks() used for the "waveform"
  // visualization preview above) onto a fresh, higher-resolution
  // 1200x630 canvas (a common social/cover-image aspect ratio) and
  // uploads the result straight into the Media Library via the same
  // adminUploadBlob() helper the Photo Editor's own "Save as new"
  // already uses -- no new upload plumbing needed. Reads the theme's
  // live --accent color off the already-rendered preview embed, exactly
  // like drawWaveformPreview() above, rather than hardcoding a second
  // copy of the four theme colors that could drift out of sync with
  // public/style.css's own .song-theme-* definitions.
  $("song-generate-cover-art").addEventListener("click", async () => {
    const btn = $("song-generate-cover-art");
    if (btn.disabled) return;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generating…";
    try {
      const peaks = await Engine.renderWaveformPeaks(songData, 80);
      const w = 1200;
      const h = 630;
      const cvs = document.createElement("canvas");
      cvs.width = w;
      cvs.height = h;
      const c2d = cvs.getContext("2d");
      c2d.fillStyle = "#0c0a16"; // matches the site's own dark-theme --bg
      c2d.fillRect(0, 0, w, h);
      const accent = getComputedStyle($("song-preview-embed")).getPropertyValue("--accent").trim() || "#ff7a45";
      const mid = h / 2;
      const barW = w / peaks.length;
      c2d.fillStyle = accent;
      peaks.forEach((p, i) => {
        const yTop = mid + p[1] * mid * 0.85; // 0.85, not 1, so the tallest peaks leave a small margin rather than touching the image edges
        const yBot = mid + p[0] * mid * 0.85;
        c2d.fillRect(i * barW, yTop, Math.max(1, barW - 2), Math.max(1, yBot - yTop));
      });
      const blob = await new Promise((resolve) => cvs.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Canvas export failed");
      await window.adminUploadBlob(blob, "song-covers");
      if (window.refreshMediaLibrary) window.refreshMediaLibrary();
      alert("Cover art generated and added to the Media Library (in the \"song-covers\" folder).");
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // ---------- Snapshot mix ----------
  // Creates a brand-new, separate song row from the CURRENT in-memory
  // songData -- including any unsaved edits still in the builder, not
  // just what's persisted -- so an admin can try a different mixing
  // direction (volumes, theme, kit, notes) without losing this exact
  // version, and without it disturbing the song still open in this
  // builder (currentSongId/songHasUnsavedChanges are left untouched;
  // this only ever creates a new row, never overwrites the original).
  $("song-snapshot-mix").addEventListener("click", async () => {
    const name = $("song-name").value.trim();
    if (!name) return alert("Name is required before snapshotting.");
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const snapshotName = `${name} (snapshot ${timestamp})`;
    const btn = $("song-snapshot-mix");
    const originalText = btn.textContent;
    btn.textContent = "Snapshotting…";
    btn.disabled = true;
    try {
      // Deep-cloned so this snapshot is a true independent copy, unaffected
      // by any further live edits made to songData after this point.
      const data = JSON.parse(JSON.stringify(songData));
      await refreshCachedWaveformPeaks(data);
      await window.adminApi("/songs", { method: "POST", body: JSON.stringify({ name: snapshotName, data }) });
      if (window.refreshSongOptions) window.refreshSongOptions();
      alert(`Saved as a new song: "${snapshotName}". You're still editing the original -- open it separately from the Songs list to compare.`);
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  // Phone toolbar: "More" opens the full grouped tools (the CSS in style.css does the rest); each opening starts closed.
  {
    const inner = $("song-builder-modal").querySelector(".simulation-builder-inner");
    const moreBtn = $("song-toolbar-more");
    const setMore = (open) => {
      inner.classList.toggle("sim-more-open", open);
      moreBtn.setAttribute("aria-expanded", String(open));
      moreBtn.querySelector(".sim-more-caret").textContent = open ? "▴" : "▾";
    };
    moreBtn.addEventListener("click", () => setMore(!inner.classList.contains("sim-more-open")));
    // The preview card and clipping history fold away on a phone or a short laptop screen so the drum grid is in reach; a tall desktop always shows them.
    const fold = $("song-preview-fold");
    const wide = window.matchMedia("(min-width: 861px) and (min-height: 861px)");
    wide.addEventListener("change", (e) => {
      if (e.matches) fold.open = true;
    });
    new MutationObserver(() => {
      if (!$("song-builder-modal").hidden) {
        setMore(false);
        fold.open = wide.matches;
      }
    }).observe($("song-builder-modal"), { attributes: true, attributeFilter: ["hidden"] });
  }
})();
