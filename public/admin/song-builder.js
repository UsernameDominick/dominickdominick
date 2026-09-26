(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const Engine = window.SongEngine;
  const TRACKS = ["kick", "snare", "hihat", "clap"];
  const TRACK_LABELS = { kick: "Kick", snare: "Snare", hihat: "Hi-Hat", clap: "Clap" };
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

  function defaultSongData() {
    return {
      tempo: 120,
      kit: "acoustic",
      visualization: "bars",
      theme: "default",
      page_sync: false,
      master_volume: 1,
      tracks: TRACKS.reduce((acc, t) => {
        acc[t] = new Array(STEPS).fill(false);
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
  window.addEventListener("beforeunload", (e) => {
    if (!songHasUnsavedChanges) return;
    e.preventDefault();
    e.returnValue = "";
  });
  function setAutosaveStatus(text) {
    const el2 = $("song-autosave-status");
    if (el2) el2.textContent = text;
  }
  async function autosaveSong() {
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
    const data = songData;
    try {
      await window.adminApi(`/songs/${id}`, { method: "PATCH", body: JSON.stringify({ name, data }) });
      if (gen !== openGeneration) return; // a different song opened while this PATCH was in flight
      songHasUnsavedChanges = false;
      setAutosaveStatus("Saved " + new Date().toLocaleTimeString());
      if (window.refreshSongOptions) window.refreshSongOptions();
    } catch (err) {
      if (gen !== openGeneration) return;
      setAutosaveStatus("Autosave failed: " + err.message);
    }
  }
  function scheduleAutosave() {
    if (!currentSongId) return;
    songHasUnsavedChanges = true;
    setAutosaveStatus("Unsaved changes…");
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosaveSong, 2000);
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

  function highlightStep(step) {
    document.querySelectorAll(".song-step").forEach((el) => {
      el.classList.toggle("song-step-playing", Number(el.dataset.step) === step);
    });
    $("song-preview-name").textContent = $("song-name").value || "Song name";
    const viz = songData.visualization || "bars";
    const hits = songData.tracks && Object.keys(songData.tracks).some((t) => songData.tracks[t][step]);
    if (viz === "bars") {
      $("song-preview-bars")
        .querySelectorAll(".song-embed-bar")
        .forEach((bar, i) => bar.classList.toggle("song-embed-bar-active", i === step));
    } else if (viz === "waveform") {
      drawWaveformPreview(step / STEPS);
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

  let player = Engine.createPlayer(getAudioCtx, songData, highlightStep);

  // Editing tempo/kit/waveform while a song is already playing should
  // take effect immediately, not just after Save — so these write
  // straight into the same songData object the running player reads.
  $("song-tempo").addEventListener("input", () => {
    songData.tempo = Number($("song-tempo").value) || 120;
    refreshWaveformPreview();
    scheduleAutosave();
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
  // Bumped on every manual edit of the volume slider -- lets the async
  // normalize scan below detect "the admin changed the volume by hand
  // while my offline render was still in flight" and back off rather than
  // clobbering a deliberate manual adjustment with a stale computed one.
  let volumeInputGeneration = 0;
  $("song-master-volume").addEventListener("input", () => {
    volumeInputGeneration++;
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
    // Captured *before* the async render -- a critic pass found that
    // without these, finishing the scan after the admin had already
    // switched to a different song (openGeneration, the same guard
    // openBuilder itself uses) or manually dragged the volume slider
    // (volumeInputGeneration, above) would silently overwrite the wrong
    // song's master_volume, or clobber a deliberate manual adjustment,
    // with this scan's now-stale result.
    const myOpenGeneration = openGeneration;
    const myVolumeGeneration = volumeInputGeneration;
    try {
      const peaks = await Engine.renderWaveformPeaks(songData, 400);
      if (myOpenGeneration !== openGeneration || myVolumeGeneration !== volumeInputGeneration) return;
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
      // No pushHistory() here -- the Song builder has no undo/redo stack at
      // all (a pre-existing gap logged separately in outline.md, unlike
      // the Photo Editor and simulation builder), so nothing else in this
      // file pushes one either.
      songData.master_volume = newVolume;
      $("song-master-volume").value = newVolumePercent;
      Engine.setMasterVolume(getAudioCtx(), newVolume);
      scheduleAutosave();
      const unsavedNote = currentSongId ? "" : " (Save the song to keep this.)";
      alert(`Peak was ${Math.round(peakAmp * 100)}% of full scale. Master volume set to ${newVolumePercent}% to avoid clipping.${unsavedNote}`);
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
    function tick() {
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

  function startPlayback() {
    player.start();
    startPeakMeter();
    $("song-play").textContent = "⏸ Stop";
  }

  function stopPlayback() {
    player.stop();
    stopPeakMeter();
    document.querySelectorAll(".song-step").forEach((el) => el.classList.remove("song-step-playing"));
    $("song-preview-bars")
      .querySelectorAll(".song-embed-bar")
      .forEach((bar) => bar.classList.remove("song-embed-bar-active"));
    $("song-preview-pulse").classList.remove("song-embed-pulse-beat", "song-embed-pulse-hit");
    if (pageSyncOverlay) pageSyncOverlay.classList.remove("song-page-sync-hit");
    drawWaveformPreview(0);
    $("song-play").textContent = "▶ Play";
  }

  $("song-play").addEventListener("click", () => {
    if (player.isPlaying()) stopPlayback();
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
  function handleMidiMessage(msg) {
    const [status, note, velocity] = msg.data;
    const isNoteOn = status >> 4 === 9 && velocity > 0;
    if (!isNoteOn) return;
    const noteName = Engine.midiToNoteName(note);
    const ctx = getAudioCtx();
    const waveform = $("song-waveform").value;
    const duration = 60 / (songData.tempo || 120) / 4;
    Engine.playMelodyNote(ctx, ctx.currentTime, Engine.noteToFreq(noteName), waveform, duration);
    if (!songData.melody.notes[noteName]) return; // outside the 2-octave piano roll range — preview only
    if (player.isPlaying() && $("song-record").checked) {
      const step = player.currentStep();
      songData.melody.notes[noteName][step] = true;
      const cell = document.querySelector(`.song-steps[data-row="${noteName}"] .song-step[data-step="${step}"]`);
      if (cell) cell.classList.add("song-step-on");
    }
  }

  if (navigator.requestMIDIAccess) {
    $("song-midi-connect").hidden = false;
    $("song-midi-connect").addEventListener("click", async () => {
      try {
        const access = await navigator.requestMIDIAccess();
        access.inputs.forEach((input) => (input.onmidimessage = handleMidiMessage));
        $("song-midi-connect").textContent = "🎹 MIDI connected";
        $("song-midi-connect").disabled = true;
        $("song-record-label").hidden = false;
      } catch (err) {
        alert("Couldn't access MIDI devices: " + err.message);
      }
    });
  }

  // ---------- Sequencer grid ----------
  // Shared by the drum sequencer and the piano roll — both are just a set
  // of named rows, each STEPS long, toggled the same way. Parameterized by
  // plain get/set functions rather than duplicated per grid.
  function renderStepGrid(containerId, rowKeys, rowLabel, getOn, setOn, rowClass) {
    $(containerId).innerHTML = rowKeys
      .map((key) => {
        const label = rowLabel(key);
        return `<div class="song-track-row${rowClass ? rowClass(key) : ""}"><span class="song-track-label">${label}</span><div class="song-steps" data-row="${key}">${Array.from(
          { length: STEPS },
          (_, i) =>
            `<button type="button" class="song-step${getOn(key, i) ? " song-step-on" : ""}${
              i % 4 === 0 ? " song-step-beat" : ""
            }" data-row="${key}" data-step="${i}" aria-label="${label} step ${i + 1}"></button>`
        ).join("")}</div></div>`;
      })
      .join("");
    $(containerId)
      .querySelectorAll(".song-step")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const key = btn.dataset.row;
          const step = Number(btn.dataset.step);
          const next = !getOn(key, step);
          setOn(key, step, next);
          btn.classList.toggle("song-step-on", next);
          refreshWaveformPreview();
          scheduleAutosave();
        });
      });
  }

  function renderSequencer() {
    renderStepGrid(
      "song-sequencer",
      TRACKS,
      (t) => TRACK_LABELS[t],
      (t, i) => songData.tracks[t][i],
      (t, i, v) => (songData.tracks[t][i] = v)
    );
  }

  function renderPianoRoll() {
    renderStepGrid(
      "song-piano-roll",
      PIANO_NOTES,
      (n) => n,
      (n, i) => songData.melody.notes[n][i],
      (n, i, v) => (songData.melody.notes[n][i] = v),
      (n) => (n.includes("#") ? " song-row-black-key" : "")
    );
  }

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
  function transposeMelody(semitones) {
    const oldNotes = songData.melody.notes;
    const newNotes = {};
    PIANO_NOTES.forEach((n) => (newNotes[n] = new Array(STEPS).fill(false)));
    const dropped = [];
    PIANO_NOTES.forEach((sourceName, sourceIndex) => {
      const targetName = PIANO_NOTES[sourceIndex - semitones];
      for (let step = 0; step < STEPS; step++) {
        if (!oldNotes[sourceName][step]) continue;
        if (targetName) newNotes[targetName][step] = true;
        else dropped.push(`${sourceName} (step ${step + 1})`);
      }
    });
    if (dropped.length) {
      const shown = dropped.slice(0, 8).join(", ") + (dropped.length > 8 ? `, and ${dropped.length - 8} more` : "");
      const ok = confirm(
        `This will remove ${dropped.length} note${dropped.length === 1 ? "" : "s"} that would move outside the piano roll's range: ${shown}. Continue?`
      );
      if (!ok) return;
    }
    songData.melody.notes = newNotes;
    renderPianoRoll();
    refreshWaveformPreview();
    scheduleAutosave();
  }

  // ---------- List modal ----------
  async function loadSongsList() {
    songs = await window.adminApi("/songs");
    renderSongsList();
  }

  function escapeXml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderSongsList() {
    $("songs-list").innerHTML =
      songs
        .map(
          (s) =>
            `<div class="simulation-row"><span>${escapeXml(s.name)}</span><button type="button" class="usage-song" data-id="${
              s.id
            }" data-name="${escapeXml(s.name)}" title="See which pages use this song">Usage</button><button type="button" class="duplicate-song" data-id="${
              s.id
            }">Duplicate</button><button type="button" class="edit-song" data-id="${s.id}">Edit</button><button type="button" class="delete-song" data-id="${s.id}">Delete</button></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No songs yet.</p>";
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
            ? `This song is used in: ${usage.map((u) => u.title).join(", ")}. Delete anyway? Those blocks will show "not found".`
            : "Delete this song? This can't be undone.";
          if (!confirm(msg)) return;
          await window.adminApi(`/songs/${btn.dataset.id}`, { method: "DELETE" });
          await loadSongsList();
        })
      );
  }

  $("songs-btn").addEventListener("click", async () => {
    $("songs-modal").hidden = false;
    await loadSongsList();
  });
  $("close-songs").addEventListener("click", () => ($("songs-modal").hidden = true));
  $("new-song-btn").addEventListener("click", () => openBuilder(null));

  // ---------- Open / close builder ----------
  async function openBuilder(id) {
    stopPlayback();
    // Switching songs must drop any pending autosave for the PREVIOUS one
    // first — openBuilder awaits a fetch before songData is reassigned,
    // so without this, a timer scheduled while editing song A could fire
    // during that await window, after currentSongId has already moved on
    // to song B but songData is still A's stale content, silently
    // overwriting B's row with A's data.
    clearTimeout(autosaveTimer);
    setAutosaveStatus("");
    songHasUnsavedChanges = false;
    // A second, independent race a critic pass found: clicking Edit on
    // song A, then song B before A's own GET resolves, used to let
    // whichever response came back LAST win, applying it to the form
    // regardless of which song the admin actually meant to open --
    // `currentSongId` would correctly end up as B, but the populated
    // songData/name/tempo/etc. could silently be A's. This generation
    // token is bumped on every call and checked right after the await;
    // a superseded call bails out before touching anything.
    const myGeneration = ++openGeneration;
    currentSongId = id;
    if (id) {
      const song = await window.adminApi(`/songs/${id}`);
      if (myGeneration !== openGeneration) return;
      $("song-name").value = song.name;
      songData = song.data && song.data.tracks ? song.data : defaultSongData();
      // A song saved before the piano roll existed won't have `melody` at
      // all, and a drum-only song can have `melody.notes` present but
      // missing individual note keys (e.g. `{}`) — backfill both cases
      // rather than letting the grid render/toggle throw on a missing key.
      if (!songData.melody) songData.melody = defaultSongData().melody;
      if (!songData.melody.notes) songData.melody.notes = defaultSongData().melody.notes;
      PIANO_NOTES.forEach((n) => {
        if (!songData.melody.notes[n]) songData.melody.notes[n] = new Array(STEPS).fill(false);
      });
    } else {
      $("song-name").value = "New song";
      songData = defaultSongData();
    }
    $("song-tempo").value = songData.tempo || 120;
    $("song-kit").value = songData.kit || "acoustic";
    $("song-waveform").value = songData.melody.waveform || "sine";
    $("song-visualization").value = songData.visualization || "bars";
    $("song-theme").value = SONG_THEME_CLASSES.has(songData.theme) ? songData.theme : "default";
    applySongTheme($("song-preview-embed"), songData.theme);
    $("song-page-sync").checked = !!songData.page_sync;
    $("song-master-volume").value = Math.round((typeof songData.master_volume === "number" ? songData.master_volume : 1) * 100);
    // The shared AudioContext (and its master GainNode) persists across
    // songs -- without this, opening song B right after playing song A
    // would leave the gain at A's last value until B's own playback
    // schedules its first step.
    Engine.setMasterVolume(getAudioCtx(), songData.master_volume);
    $("song-preview-name").textContent = $("song-name").value || "Song name";
    // songData was just reassigned to a new object — the player has to be
    // rebuilt against it, since createPlayer captured the old reference.
    player = Engine.createPlayer(getAudioCtx, songData, highlightStep);
    $("songs-modal").hidden = true;
    $("song-builder-modal").hidden = false;
    renderSequencer();
    renderPianoRoll();
    updatePreviewVisibility();
    refreshWaveformPreview();
  }

  $("close-song-builder").addEventListener("click", () => {
    stopPlayback();
    $("song-builder-modal").hidden = true;
    $("songs-modal").hidden = false;
    loadSongsList().catch(() => {});
  });

  $("save-song").addEventListener("click", async () => {
    const name = $("song-name").value.trim();
    if (!name) return alert("Name is required.");
    songData.tempo = Number($("song-tempo").value) || 120;
    songData.kit = $("song-kit").value;
    songData.melody.waveform = $("song-waveform").value;
    songData.visualization = $("song-visualization").value;
    songData.theme = $("song-theme").value;
    songData.page_sync = $("song-page-sync").checked;
    songData.master_volume = Number($("song-master-volume").value) / 100;
    try {
      if (currentSongId) {
        await window.adminApi(`/songs/${currentSongId}`, { method: "PATCH", body: JSON.stringify({ name, data: songData }) });
      } else {
        const res = await window.adminApi("/songs", { method: "POST", body: JSON.stringify({ name, data: songData }) });
        currentSongId = res.id;
      }
      clearTimeout(autosaveTimer);
      songHasUnsavedChanges = false;
      setAutosaveStatus("Saved " + new Date().toLocaleTimeString());
      alert("Saved.");
      if (window.refreshSongOptions) window.refreshSongOptions();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Export session report ----------
  // A plain-text summary of this song's current in-memory settings and
  // note counts -- reads songData directly, so it reflects any unsaved
  // edits still in the builder, not just what's persisted.
  $("song-export-report").addEventListener("click", () => {
    const name = $("song-name").value.trim() || "Untitled song";
    const lines = [
      `Song: ${name}`,
      `Tempo: ${songData.tempo} BPM`,
      `Drum kit: ${songData.kit}`,
      `Melody waveform: ${songData.melody.waveform}`,
      `Visualization: ${songData.visualization}`,
      `Theme: ${songData.theme}`,
      `Master volume: ${Math.round((typeof songData.master_volume === "number" ? songData.master_volume : 1) * 100)}%`,
      `Page background sync: ${songData.page_sync ? "on" : "off"}`,
      "",
      "Drum tracks (steps hit / total):",
      ...TRACKS.map((t) => `  ${TRACK_LABELS[t]}: ${songData.tracks[t].filter(Boolean).length} / ${STEPS}`),
      "",
      "Melody notes used:",
    ];
    const usedNotes = PIANO_NOTES.filter((n) => songData.melody.notes[n] && songData.melody.notes[n].some(Boolean));
    if (usedNotes.length) {
      usedNotes.forEach((n) => lines.push(`  ${n}: ${songData.melody.notes[n].filter(Boolean).length} / ${STEPS}`));
    } else {
      lines.push("  (none)");
    }
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9-_]+/gi, "-") || "song"}-report.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });
})();
