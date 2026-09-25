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
      page_sync: false,
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

  async function refreshWaveformPreview() {
    if ((songData.visualization || "bars") !== "waveform") return;
    previewPeaks = await Engine.renderWaveformPeaks(songData, 200);
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
    previewPeaks.forEach((p, i) => {
      const played = i / previewPeaks.length <= progress;
      c2d.fillStyle = played ? "#ff7a45" : "rgba(255,255,255,0.25)";
      const yTop = mid + p[1] * mid;
      const yBot = mid + p[0] * mid;
      c2d.fillRect(i * barW, yTop, Math.max(1, barW - 1), Math.max(1, yBot - yTop));
    });
  }

  $("song-visualization").addEventListener("change", () => {
    songData.visualization = $("song-visualization").value;
    updatePreviewVisibility();
    refreshWaveformPreview();
  });
  $("song-page-sync").addEventListener("change", () => (songData.page_sync = $("song-page-sync").checked));

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
  });
  $("song-kit").addEventListener("change", () => {
    songData.kit = $("song-kit").value;
    refreshWaveformPreview();
  });
  $("song-waveform").addEventListener("change", () => {
    songData.melody.waveform = $("song-waveform").value;
    refreshWaveformPreview();
  });
  $("song-name").addEventListener("input", () => ($("song-preview-name").textContent = $("song-name").value || "Song name"));

  function startPlayback() {
    player.start();
    $("song-play").textContent = "⏸ Stop";
  }

  function stopPlayback() {
    player.stop();
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
            `<div class="simulation-row"><span>${escapeXml(s.name)}</span><button type="button" class="duplicate-song" data-id="${
              s.id
            }">Duplicate</button><button type="button" class="edit-song" data-id="${s.id}">Edit</button><button type="button" class="delete-song" data-id="${s.id}">Delete</button></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No songs yet.</p>";
    $("songs-list")
      .querySelectorAll(".edit-song")
      .forEach((btn) => btn.addEventListener("click", () => openBuilder(Number(btn.dataset.id))));
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
          if (!confirm('Delete this song? Any block using it will show "not found".')) return;
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
    currentSongId = id;
    if (id) {
      const song = await window.adminApi(`/songs/${id}`);
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
    $("song-page-sync").checked = !!songData.page_sync;
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
    songData.page_sync = $("song-page-sync").checked;
    try {
      if (currentSongId) {
        await window.adminApi(`/songs/${currentSongId}`, { method: "PATCH", body: JSON.stringify({ name, data: songData }) });
      } else {
        const res = await window.adminApi("/songs", { method: "POST", body: JSON.stringify({ name, data: songData }) });
        currentSongId = res.id;
      }
      alert("Saved.");
      if (window.refreshSongOptions) window.refreshSongOptions();
    } catch (err) {
      alert(err.message);
    }
  });
})();
