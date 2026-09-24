(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const TRACKS = ["kick", "snare", "hihat", "clap"];
  const TRACK_LABELS = { kick: "Kick", snare: "Snare", hihat: "Hi-Hat", clap: "Clap" };
  const STEPS = 16;

  // Piano roll: 2 octaves (C3-B4), highest pitch first — the usual
  // top-to-bottom piano-roll convention. Reuses the exact same
  // .song-step/.song-steps toggle-grid cells and click handling as the
  // drum sequencer below, just with a note name (not a drum sound) as the
  // per-row key, so the same rendering/toggle code covers both.
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const PIANO_NOTES = [];
  [4, 3].forEach((octave) => {
    for (let i = 11; i >= 0; i--) PIANO_NOTES.push(NOTE_NAMES[i] + octave);
  });

  function noteToFreq(note) {
    const m = note.match(/^([A-G]#?)(\d)$/);
    if (!m) return 440;
    const midi = NOTE_NAMES.indexOf(m[1]) + (Number(m[2]) + 1) * 12;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function defaultSongData() {
    return {
      tempo: 120,
      kit: "acoustic",
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

  // ---------- Drum synthesis (Web Audio, no samples — see outline.md for
  // why: no sample licensing to manage, and it keeps a song fully portable
  // as plain JSON). Kit variants tweak pitch/decay/tone per drum, not the
  // underlying synthesis method. ----------
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function noiseBuffer(ctx, duration) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  const KIT_PARAMS = {
    acoustic: { kickFreq: 150, kickDecay: 0.35, snareTone: 200, snareDecay: 0.18, hihatDecay: 0.06, clapDecay: 0.12 },
    electronic: { kickFreq: 90, kickDecay: 0.25, snareTone: 320, snareDecay: 0.12, hihatDecay: 0.04, clapDecay: 0.08 },
    "808": { kickFreq: 55, kickDecay: 0.55, snareTone: 180, snareDecay: 0.22, hihatDecay: 0.08, clapDecay: 0.15 },
  };

  function playKick(ctx, time, kit) {
    const p = KIT_PARAMS[kit] || KIT_PARAMS.acoustic;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(p.kickFreq * 2.5, time);
    osc.frequency.exponentialRampToValueAtTime(p.kickFreq * 0.5, time + p.kickDecay);
    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + p.kickDecay);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + p.kickDecay + 0.05);
  }

  function playSnare(ctx, time, kit) {
    const p = KIT_PARAMS[kit] || KIT_PARAMS.acoustic;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, p.snareDecay);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = 900;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.7, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + p.snareDecay);
    noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
    noise.start(time);

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = p.snareTone;
    oscGain.gain.setValueAtTime(0.5, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + p.snareDecay * 0.8);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + p.snareDecay + 0.05);
  }

  function playHihat(ctx, time, kit) {
    const p = KIT_PARAMS[kit] || KIT_PARAMS.acoustic;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, p.hihatDecay);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + p.hihatDecay);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(time);
  }

  function playClap(ctx, time, kit) {
    const p = KIT_PARAMS[kit] || KIT_PARAMS.acoustic;
    // Three quick, tightly-spaced bursts read as a "clap" rather than a
    // single noise hit — a cheap, standard trick for synthesizing claps.
    [0, 0.012, 0.024].forEach((offset) => {
      const noise = getAudioCtx().createBufferSource();
      noise.buffer = noiseBuffer(ctx, p.clapDecay);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1200;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, time + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, time + offset + p.clapDecay);
      noise.connect(filter).connect(gain).connect(ctx.destination);
      noise.start(time + offset);
    });
  }

  const PLAYERS = { kick: playKick, snare: playSnare, hihat: playHihat, clap: playClap };

  function playMelodyNote(ctx, time, freq, waveform, duration) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = waveform;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.25, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration * 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + duration);
  }

  // ---------- Scheduler ----------
  // The standard "lookahead" pattern (Chris Wilson's "A Tale of Two
  // Clocks") rather than a plain setInterval-per-step — a plain interval
  // drifts audibly against AudioContext's own clock, which is the actual
  // thing producing sound. This checks in frequently but always schedules
  // notes against ctx.currentTime, so playback timing stays accurate even
  // if the checks themselves jitter a little.
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD_S = 0.1;
  let isPlaying = false;
  let currentStep = 0;
  let nextStepTime = 0;
  let schedulerTimer = null;

  function stepDuration() {
    const tempo = Number($("song-tempo").value) || 120;
    return 60 / tempo / 4; // 16th notes
  }

  function scheduleStep(step, time) {
    const kit = $("song-kit").value;
    TRACKS.forEach((track) => {
      if (songData.tracks[track][step]) PLAYERS[track](getAudioCtx(), time, kit);
    });
    const waveform = $("song-waveform").value;
    const duration = stepDuration();
    Object.keys(songData.melody.notes).forEach((note) => {
      if (songData.melody.notes[note][step]) playMelodyNote(getAudioCtx(), time, noteToFreq(note), waveform, duration);
    });
    highlightStep(step);
  }

  function highlightStep(step) {
    document.querySelectorAll(".song-step").forEach((el) => {
      el.classList.toggle("song-step-playing", Number(el.dataset.step) === step);
    });
  }

  function schedulerLoop() {
    const ctx = getAudioCtx();
    while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      scheduleStep(currentStep, nextStepTime);
      nextStepTime += stepDuration();
      currentStep = (currentStep + 1) % STEPS;
    }
    schedulerTimer = setTimeout(schedulerLoop, LOOKAHEAD_MS);
  }

  function startPlayback() {
    if (isPlaying) return;
    isPlaying = true;
    currentStep = 0;
    nextStepTime = getAudioCtx().currentTime + 0.05;
    schedulerLoop();
    $("song-play").textContent = "⏸ Stop";
  }

  function stopPlayback() {
    isPlaying = false;
    clearTimeout(schedulerTimer);
    document.querySelectorAll(".song-step").forEach((el) => el.classList.remove("song-step-playing"));
    $("song-play").textContent = "▶ Play";
  }

  $("song-play").addEventListener("click", () => {
    if (isPlaying) stopPlayback();
    else startPlayback();
  });

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
      // A song saved before the piano roll existed won't have `melody` —
      // fall back to a blank one rather than letting every note-toggle
      // click below throw on a missing key.
      if (!songData.melody) songData.melody = defaultSongData().melody;
    } else {
      $("song-name").value = "New song";
      songData = defaultSongData();
    }
    $("song-tempo").value = songData.tempo || 120;
    $("song-kit").value = songData.kit || "acoustic";
    $("song-waveform").value = songData.melody.waveform || "sine";
    $("songs-modal").hidden = true;
    $("song-builder-modal").hidden = false;
    renderSequencer();
    renderPianoRoll();
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
