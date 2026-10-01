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
  function noiseBuffer(ctx, duration, random = Math.random) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
    return buf;
  }

  // ---------- Master bus ----------
  // One shared GainNode per AudioContext that every voice routes through
  // instead of ctx.destination directly, so a single master-volume control
  // affects drums + melody together. Keyed by ctx (not a module-level
  // singleton) since the admin builder and public embed each own their own
  // AudioContext, and an OfflineAudioContext used for waveform rendering
  // needs its own gain node too.
  const masterGains = new WeakMap();
  function getMasterGain(ctx) {
    let gain = masterGains.get(ctx);
    if (!gain) {
      gain = ctx.createGain();
      gain.connect(ctx.destination);
      masterGains.set(ctx, gain);
    }
    return gain;
  }

  // Applies a master-volume value to ctx's gain node with a short ramp
  // rather than a bare `.value =` jump, which produces an audible click if
  // the slider is dragged during active playback. Exposed publicly (not
  // just called from scheduleStep) so a caller can apply a volume change
  // immediately -- e.g. dragging the slider while stopped, or opening a
  // different song into an AudioContext that's still holding the
  // previous song's gain value -- rather than waiting for the next
  // scheduled step to pick it up.
  // A read-only metering tap off the master gain, backing both the live
  // peak meter and the RMS (average loudness) meter -- both read the same
  // underlying time-domain samples each animation frame. Never connected
  // onward to ctx.destination itself, so it doesn't add a second copy of
  // the audio to the output, just observes the same signal everything
  // else already hears. One per AudioContext, same rationale as the
  // master gain itself.
  const peakMeterAnalysers = new WeakMap();
  function getPeakMeterAnalyser(ctx) {
    let analyser = peakMeterAnalysers.get(ctx);
    if (!analyser) {
      analyser = ctx.createAnalyser();
      // 2048 (not a smaller, "faster" size) is deliberate: a critic pass
      // found that at 256 samples, each poll only covers ~5.8ms of audio
      // while requestAnimationFrame polls roughly every ~16.7ms (60fps) --
      // leaving most of the audio between polls unsampled and able to
      // scroll out of the analyser's buffer unread, so a brief drum
      // transient landing in an unpolled gap could be silently missed
      // entirely (a "peak meter" that can under-report the true peak
      // defeats its own purpose). At 2048 samples (~46ms of audio at a
      // typical 44.1kHz context), each poll's window is wider than the
      // gap between polls, so consecutive windows overlap and nothing
      // slips through unsampled.
      analyser.fftSize = 2048;
      getMasterGain(ctx).connect(analyser);
      peakMeterAnalysers.set(ctx, analyser);
    }
    return analyser;
  }

  function setMasterVolume(ctx, value) {
    const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
    const gainParam = getMasterGain(ctx).gain;
    const now = ctx.currentTime;
    gainParam.cancelScheduledValues(now);
    gainParam.setValueAtTime(gainParam.value, now);
    gainParam.linearRampToValueAtTime(clamped, now + 0.03);
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
    osc.connect(gain).connect(getMasterGain(ctx));
    osc.start(time);
    osc.stop(time + p.kickDecay + 0.05);
  }

  function playSnare(ctx, time, kit, random = Math.random) {
    const p = KIT_PARAMS[kit] || KIT_PARAMS.acoustic;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, p.snareDecay, random);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = 900;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.7, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + p.snareDecay);
    noise.connect(noiseFilter).connect(noiseGain).connect(getMasterGain(ctx));
    noise.start(time);

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = p.snareTone;
    oscGain.gain.setValueAtTime(0.5, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + p.snareDecay * 0.8);
    osc.connect(oscGain).connect(getMasterGain(ctx));
    osc.start(time);
    osc.stop(time + p.snareDecay + 0.05);
  }

  function playHihat(ctx, time, kit, random = Math.random) {
    const p = KIT_PARAMS[kit] || KIT_PARAMS.acoustic;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, p.hihatDecay, random);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + p.hihatDecay);
    noise.connect(filter).connect(gain).connect(getMasterGain(ctx));
    noise.start(time);
  }

  function playClap(ctx, time, kit, random = Math.random) {
    const p = KIT_PARAMS[kit] || KIT_PARAMS.acoustic;
    // Three quick, tightly-spaced bursts read as a "clap" rather than a
    // single noise hit — a cheap, standard trick for synthesizing claps.
    [0, 0.012, 0.024].forEach((offset) => {
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer(ctx, p.clapDecay, random);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1200;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, time + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, time + offset + p.clapDecay);
      noise.connect(filter).connect(gain).connect(getMasterGain(ctx));
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
    osc.connect(gain).connect(getMasterGain(ctx));
    osc.start(time);
    osc.stop(time + duration);
  }

  function stepDurationFor(tempo) {
    return 60 / (tempo || 120) / 4; // 16th notes
  }

  // Max timing nudge at 100% humanize -- small enough to still read as "the
  // same quantized pattern, just not robotically exact" rather than
  // sloppy/off-time. Applied per NOTE (not once per step), so two drums
  // landing on the same step each get their own independent nudge instead
  // of the whole step just sliding together, which is what actually reads
  // as more human than a mechanically identical grid.
  const HUMANIZE_MAX_JITTER_S = 0.015;
  function humanizeJitter(songData, random = Math.random) {
    const amount = songData.humanize || 0;
    if (!amount) return 0; // skip Math.random() entirely for the (default, common) off case
    return (random() * 2 - 1) * HUMANIZE_MAX_JITTER_S * (amount / 100);
  }

  // A muted drum track is silent everywhere the engine plays the song (admin
  // preview, public embed, cached waveform); "hidden" is editor-only and is
  // deliberately not consulted here.
  function isTrackMuted(songData, track) {
    return Boolean(songData.trackMeta && songData.trackMeta[track] && songData.trackMeta[track].muted === true);
  }
  function isMelodyMuted(songData) {
    return Boolean(songData.melody && songData.melody.muted === true);
  }
  function stepHasAudibleDrumHit(songData, step) {
    return Boolean(
      songData.tracks && Object.keys(songData.tracks).some((t) => songData.tracks[t][step] && PLAYERS[t] && !isTrackMuted(songData, t))
    );
  }

  function scheduleStep(ctx, songData, step, time, random = Math.random) {
    // Read fresh every step, same as tempo/kit below, so a live volume-
    // slider drag while a song is already playing takes effect on the next
    // scheduled step too (on top of the immediate application a caller
    // does directly via setMasterVolume -- this is a cheap idempotent
    // re-application, not the only place the value gets applied).
    setMasterVolume(ctx, songData.master_volume);
    const kit = songData.kit || "acoustic";
    if (songData.tracks) {
      Object.keys(songData.tracks).sort().forEach((track) => {
        // Clamped to 0 rather than passed through raw -- a negative jitter
        // draw on step 0 of an OfflineAudioContext render (renderWaveformPeaks
        // schedules step 0 at real time 0, unlike live playback which always
        // starts comfortably ahead of ctx.currentTime) would otherwise hand
        // AudioBufferSourceNode/OscillatorNode.start() a negative time, which
        // throws a RangeError and kills the whole render -- a critic pass
        // caught this live (silently broken waveform preview, admin builder
        // AND public embed both, since they share this exact code path).
        if (songData.tracks[track][step] && PLAYERS[track] && !isTrackMuted(songData, track)) PLAYERS[track](ctx, Math.max(0, time + humanizeJitter(songData, random)), kit, random);
      });
    }
    if (songData.melody && !isMelodyMuted(songData)) {
      const waveform = songData.melody.waveform || "sine";
      const duration = stepDurationFor(songData.tempo);
      Object.keys(songData.melody.notes).sort().forEach((note) => {
        if (songData.melody.notes[note][step]) playMelodyNote(ctx, Math.max(0, time + humanizeJitter(songData, random)), noteToFreq(note), waveform, duration);
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

  // A tiny seeded PRNG gives the waveform preview repeatable noise without
  // changing the live drums' per-hit randomness. Seed from musical content
  // only; cache metadata and preview-only controls must not change the sound.
  function previewRandom(songData) {
    const tracks = Object.fromEntries(
      Object.keys(songData.tracks || {}).sort().map((key) => [key, songData.tracks[key]])
    );
    const notes = songData.melody && songData.melody.notes || {};
    const melody = songData.melody
      ? { waveform: songData.melody.waveform || "sine", notes: Object.fromEntries(Object.keys(notes).sort().map((key) => [key, notes[key]])) }
      : null;
    const input = JSON.stringify({ tempo: songData.tempo || 120, kit: songData.kit || "acoustic", tracks, melody });
    let seed = 2166136261;
    for (let i = 0; i < input.length; i++) seed = Math.imul(seed ^ input.charCodeAt(i), 16777619);
    let state = seed >>> 0 || 0x6d2b79f5;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

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
      // atTime (optional, AudioContext seconds): begin on that moment of the audio clock instead of "now",
      // so a caller that has already scheduled something before the song (a count-in) can land exactly on it.
      start(atTime) {
        if (playing) return;
        playing = true;
        currentStep = 0;
        const ctx = getAudioCtx();
        nextStepTime = Number.isFinite(atTime) && atTime > ctx.currentTime ? atTime : ctx.currentTime + 0.05;
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
    // The waveform preview shows the song's rhythmic/melodic pattern shape,
    // not its loudness -- rendering it at the actual master_volume would
    // shrink it toward a flat line as the volume slider is lowered (and
    // hide the pattern entirely at 0), which is a readability regression
    // with no corresponding benefit. Render at full volume regardless of
    // the song's actual master_volume so the preview's scale stays fixed.
    // The preview ignores humanize and uses a content-seeded noise stream:
    // repeated renders of the same song therefore show the same pattern,
    // while normal playback keeps fresh noise on each hit.
    const previewData =
      songData.master_volume === 1 && !songData.humanize
        ? songData
        : Object.assign({}, songData, { master_volume: 1, humanize: 0 });
    const random = previewRandom(previewData);
    for (let step = 0; step < STEPS; step++) scheduleStep(ctx, previewData, step, step * stepDur, random);
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
      // Rounded to 4 decimal places -- a critic pass reviewing the new
      // persisted-cache feature (song-builder.js's cached_peaks) found
      // that storing raw float64 values (18+ characters each, e.g.
      // -0.9608913660049438) bloated a 200-bucket song's saved JSON to
      // ~2.7KB for data that's only ever drawn to a handful of on-screen
      // pixels -- far more precision than the visual actually uses.
      // Applies to every caller of this shared function (the admin
      // preview and the public embed's live-render fallback too), not
      // just the new cache, since there's no reason for any of them to
      // carry more precision than the others.
      peaks.push([Math.round(min * 10000) / 10000, Math.round(max * 10000) / 10000]);
    }
    return peaks;
  }

  return {
    STEPS,
    NOTE_NAMES,
    noteToFreq,
    midiToNoteName,
    scheduleStep,
    isTrackMuted,
    isMelodyMuted,
    stepHasAudibleDrumHit,
    playMelodyNote,
    createPlayer,
    renderWaveformPeaks,
    setMasterVolume,
    getPeakMeterAnalyser,
  };
})();
