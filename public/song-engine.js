// Shared by the admin Songs builder and the public Song block player —
// one implementation of drum synthesis, note→frequency, and playback
// scheduling, used both places instead of duplicated per-context. Kept
// framework-free and DOM-free so either caller can drive it with its own
// UI (grid highlighting, a public visualizer, whatever).
window.SongEngine = (function () {
  "use strict";

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const STEPS = 16;

  function noteToFreq(note) {
    const m = note.match(/^([A-G]#?)(\d)$/);
    if (!m) return 440;
    const midi = NOTE_NAMES.indexOf(m[1]) + (Number(m[2]) + 1) * 12;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function midiToNoteName(midiNum) {
    const octave = Math.floor(midiNum / 12) - 1;
    return NOTE_NAMES[midiNum % 12] + octave;
  }

  // ---------- Drum synthesis (Web Audio, no samples — no licensing to
  // manage, and it keeps a song fully portable as plain JSON). Kit
  // variants tweak pitch/decay/tone per drum, not the synthesis method.
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
      const noise = ctx.createBufferSource();
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

  function stepDurationFor(tempo) {
    return 60 / (tempo || 120) / 4; // 16th notes
  }

  function scheduleStep(ctx, songData, step, time) {
    const kit = songData.kit || "acoustic";
    if (songData.tracks) {
      Object.keys(songData.tracks).forEach((track) => {
        if (songData.tracks[track][step] && PLAYERS[track]) PLAYERS[track](ctx, time, kit);
      });
    }
    if (songData.melody) {
      const waveform = songData.melody.waveform || "sine";
      const duration = stepDurationFor(songData.tempo);
      Object.keys(songData.melody.notes).forEach((note) => {
        if (songData.melody.notes[note][step]) playMelodyNote(ctx, time, noteToFreq(note), waveform, duration);
      });
    }
  }

  // ---------- Scheduler ----------
  // The standard "lookahead" pattern (Chris Wilson's "A Tale of Two
  // Clocks") rather than a plain setInterval-per-step — a plain interval
  // drifts audibly against AudioContext's own clock, which is the actual
  // thing producing sound. This always schedules notes against
  // ctx.currentTime, so playback timing stays accurate even if the
  // periodic checks themselves jitter a little.
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD_S = 0.1;

  // getAudioCtx: () => AudioContext. songData: the song's data object
  // (read fresh each step, so a caller can mutate it live — e.g. MIDI
  // recording into the admin builder's grid while playing). onStep(step,
  // time), optional: called once per scheduled step for any UI sync
  // (highlighting a cell, animating a visualizer).
  function createPlayer(getAudioCtx, songData, onStep) {
    let playing = false;
    let currentStep = 0;
    let nextStepTime = 0;
    let timer = null;

    function loop() {
      const ctx = getAudioCtx();
      while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
        scheduleStep(ctx, songData, currentStep, nextStepTime);
        if (onStep) onStep(currentStep, nextStepTime);
        nextStepTime += stepDurationFor(songData.tempo);
        currentStep = (currentStep + 1) % STEPS;
      }
      timer = setTimeout(loop, LOOKAHEAD_MS);
    }

    return {
      start() {
        if (playing) return;
        playing = true;
        currentStep = 0;
        nextStepTime = getAudioCtx().currentTime + 0.05;
        loop();
      },
      stop() {
        playing = false;
        clearTimeout(timer);
      },
      isPlaying: () => playing,
      currentStep: () => currentStep,
    };
  }

  // Renders one full loop through an OfflineAudioContext and downsamples
  // the result into min/max peak pairs — a real waveform derived from the
  // actual synthesized audio, not a decorative fake. Async because
  // offline rendering happens off the main thread; callers should render
  // once (on load or on edit) and cache the result rather than re-render
  // every frame.
  async function renderWaveformPeaks(songData, peakCount) {
    const stepDur = stepDurationFor(songData.tempo);
    const duration = stepDur * STEPS;
    const sampleRate = 44100;
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OfflineCtx(1, Math.ceil(sampleRate * duration), sampleRate);
    for (let step = 0; step < STEPS; step++) scheduleStep(ctx, songData, step, step * stepDur);
    const buffer = await ctx.startRendering();
    const data = buffer.getChannelData(0);
    const count = peakCount || 200;
    const bucketSize = Math.max(1, Math.floor(data.length / count));
    const peaks = [];
    for (let i = 0; i < count; i++) {
      let min = 0;
      let max = 0;
      const start = i * bucketSize;
      const end = Math.min(start + bucketSize, data.length);
      for (let j = start; j < end; j++) {
        const v = data[j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      peaks.push([min, max]);
    }
    return peaks;
  }

  return {
    STEPS,
    NOTE_NAMES,
    noteToFreq,
    midiToNoteName,
    scheduleStep,
    playMelodyNote,
    createPlayer,
    renderWaveformPeaks,
  };
})();
