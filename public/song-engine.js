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
      const send = reverbSends.get(ctx);
      if (send) send.wet.connect(analyser);
    }
    return analyser;
  }

    // Per-track mix: while a voice is being scheduled its output goes through a gain node of that
  // track's volume instead of straight to the master bus.
  let voiceDest = null;
  function voiceOut(ctx) {
    return voiceDest || getMasterGain(ctx);
  }
  function volumeOf(meta) {
    const v = meta && Number(meta.volume);
    return Number.isFinite(v) && meta.volume !== null && meta.volume !== "" ? Math.max(0, Math.min(1, v)) : 1;
  }
  // A step is on when truthy: `true` plays at full strength, a number between 0 and 1 plays at that fraction of it.
  function stepLevel(value) {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  }
  function withVolume(ctx, volume, fn) {
    if (volume >= 1) return fn();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(getMasterGain(ctx));
    voiceDest = gain;
    try {
      return fn();
    } finally {
      voiceDest = null;
    }
  }

function setMasterVolume(ctx, value) {
    const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
    const gainParam = getMasterGain(ctx).gain;
    const now = ctx.currentTime;
    gainParam.cancelScheduledValues(now);
    gainParam.setValueAtTime(gainParam.value, now);
    gainParam.linearRampToValueAtTime(clamped, now + 0.03);
  }

  // ---------- Space (reverb) ----------
  // A send off the master bus: master gain -> convolver -> wet gain -> destination, next to the
  // dry path that is already there. A song with Space at 0 never builds any of it, so those
  // songs sound and render exactly as before. The impulse response is generated from a fixed
  // seed (decaying noise), so exports and the public player always get the same room.
  const REVERB_SECONDS = 1.8;
  const REVERB_MAX_WET = 1.8;
  const reverbSends = new WeakMap();
  function reverbImpulse(ctx) {
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.round(rate * REVERB_SECONDS));
    const buffer = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let state = (0x9e3779b9 + channel * 0x85ebca6b) >>> 0 || 1;
      for (let i = 0; i < length; i++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        const noise = (state >>> 0) / 2147483648 - 1;
        // -60 dB by the end of the tail, with a short fade-in so it does not smear the attack.
        const decay = Math.pow(0.001, i / length);
        const fadeIn = Math.min(1, i / (rate * 0.004));
        data[i] = noise * decay * fadeIn;
      }
    }
    return buffer;
  }
  function getReverbSend(ctx) {
    let send = reverbSends.get(ctx);
    if (!send) {
      const convolver = ctx.createConvolver();
      convolver.buffer = reverbImpulse(ctx);
      const wet = ctx.createGain();
      wet.gain.value = 0;
      getMasterGain(ctx).connect(convolver);
      convolver.connect(wet);
      wet.connect(ctx.destination);
      // The meters read the same signal the speakers get, reverb included.
      const analyser = peakMeterAnalysers.get(ctx);
      if (analyser) wet.connect(analyser);
      send = { wet };
      reverbSends.set(ctx, send);
    }
    return send;
  }
  function spaceAmount(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) / 100 : 0;
  }
  // Space is 0 to 100 (percent). Ramps like the master volume to avoid clicks; `immediate` sets
  // it outright, for an offline render that has to be at the right level from its first sample.
  function setSpace(ctx, value, immediate) {
    const amount = spaceAmount(value);
    if (amount === 0 && !reverbSends.has(ctx)) return;
    const gainParam = getReverbSend(ctx).wet.gain;
    const level = amount * REVERB_MAX_WET;
    if (immediate) {
      gainParam.value = level;
      return;
    }
    const now = ctx.currentTime;
    gainParam.cancelScheduledValues(now);
    gainParam.setValueAtTime(gainParam.value, now);
    gainParam.linearRampToValueAtTime(level, now + 0.03);
  }

  const KIT_PARAMS = {
    acoustic: { kickFreq: 150, kickDecay: 0.35, snareTone: 200, snareDecay: 0.18, hihatDecay: 0.06, clapDecay: 0.12, openhatDecay: 0.3, tomFreq: 120, tomDecay: 0.3, rimDecay: 0.035, crashDecay: 1.2 },
    electronic: { kickFreq: 90, kickDecay: 0.25, snareTone: 320, snareDecay: 0.12, hihatDecay: 0.04, clapDecay: 0.08, openhatDecay: 0.2, tomFreq: 160, tomDecay: 0.22, rimDecay: 0.025, crashDecay: 0.9 },
    "808": { kickFreq: 55, kickDecay: 0.55, snareTone: 180, snareDecay: 0.22, hihatDecay: 0.08, clapDecay: 0.15, openhatDecay: 0.4, tomFreq: 90, tomDecay: 0.5, rimDecay: 0.03, crashDecay: 1.5 },
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
    osc.connect(gain).connect(voiceOut(ctx));
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
    noise.connect(noiseFilter).connect(noiseGain).connect(voiceOut(ctx));
    noise.start(time);

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = p.snareTone;
    oscGain.gain.setValueAtTime(0.5, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + p.snareDecay * 0.8);
    osc.connect(oscGain).connect(voiceOut(ctx));
    osc.start(time);
    osc.stop(time + p.snareDecay + 0.05);
  }

  function playHihat(ctx, time, kit, random = Math.random) {
    chokeOpenHat(ctx, time); // a closed hat steps on a ringing open one
    const p = KIT_PARAMS[kit] || KIT_PARAMS.acoustic;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, p.hihatDecay, random);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + p.hihatDecay);
    noise.connect(filter).connect(gain).connect(voiceOut(ctx));
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
      noise.connect(filter).connect(gain).connect(voiceOut(ctx));
      noise.start(time + offset);
    });
  }

  // ---------- Extra drum voices: open hat, tom, rim, crash ----------
  // A song only has these once they were added to it (the four above are always there), so older songs are untouched.
  // The open hat rings through a gain of its own so a closed hat (or the next open hat) can cut it off cleanly without disturbing its
  // decay curve; one per audio context is remembered, the way the master bus is.
  const openHats = new WeakMap();
  function chokeOpenHat(ctx, time) {
    const open = openHats.get(ctx);
    if (!open || time <= open.from || time >= open.until) return;
    open.choke.setTargetAtTime(0.0001, time, 0.004);
    open.until = time;
  }
  function playOpenHat(ctx, time, kit, random = Math.random) {
    chokeOpenHat(ctx, time);
    const p = KIT_PARAMS[kit] || KIT_PARAMS.acoustic;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, p.openhatDecay, random);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 6500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + p.openhatDecay);
    const choke = ctx.createGain();
    noise.connect(filter).connect(gain).connect(choke).connect(voiceOut(ctx));
    noise.start(time);
    openHats.set(ctx, { choke: choke.gain, from: time, until: time + p.openhatDecay });
  }

  function playTom(ctx, time, kit) {
    const p = KIT_PARAMS[kit] || KIT_PARAMS.acoustic;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(p.tomFreq * 1.9, time);
    osc.frequency.exponentialRampToValueAtTime(p.tomFreq, time + 0.07);
    gain.gain.setValueAtTime(0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + p.tomDecay);
    osc.connect(gain).connect(voiceOut(ctx));
    osc.start(time);
    osc.stop(time + p.tomDecay + 0.05);
  }

  // A short, dry click: two pitched tones and a burst of band-passed noise, over in a few hundredths of a second.
  function playRim(ctx, time, kit, random = Math.random) {
    const p = KIT_PARAMS[kit] || KIT_PARAMS.acoustic;
    [[1750, 0.35], [480, 0.45]].forEach(([freq, level]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(level, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + p.rimDecay);
      osc.connect(gain).connect(voiceOut(ctx));
      osc.start(time);
      osc.stop(time + p.rimDecay + 0.02);
    });
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, p.rimDecay, random);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 3200;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.3, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + p.rimDecay);
    noise.connect(filter).connect(noiseGain).connect(voiceOut(ctx));
    noise.start(time);
  }

  // Two layers of noise at different brightness shimmer against each other and die away slowly.
  function playCrash(ctx, time, kit, random = Math.random) {
    const p = KIT_PARAMS[kit] || KIT_PARAMS.acoustic;
    [[4500, 0.22, 1], [9000, 0.16, 0.7]].forEach(([cutoff, level, length]) => {
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer(ctx, p.crashDecay * length, random);
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = cutoff;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(level, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + p.crashDecay * length);
      noise.connect(filter).connect(gain).connect(voiceOut(ctx));
      noise.start(time);
    });
  }

  const PLAYERS = { kick: playKick, snare: playSnare, hihat: playHihat, clap: playClap, openhat: playOpenHat, tom: playTom, rim: playRim, crash: playCrash };

  function playMelodyNote(ctx, time, freq, waveform, duration) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = waveform;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.25, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration * 0.9);
    osc.connect(gain).connect(voiceOut(ctx));
    osc.start(time);
    osc.stop(time + duration);
  }

  // ---------- Melody instruments ----------
  // A song with no melody.voice plays exactly as it always has (playMelodyNote, the waveform select). A named voice shapes the
  // note instead: attack/decay/sustain/release, an optional low-pass sweep, a detuned twin, a sub-octave, an inharmonic partial
  // and a slow vibrato. sustain 0 makes a struck sound (pluck, bell) that rings for `decay` whatever the note length; anything
  // higher is held for the note's length (ties lengthen it) and then released. Each voice brings its own oscillator type.
  const MELODY_VOICES = {
    pluck: { label: "Pluck", wave: "sawtooth", attack: 0.002, decay: 0.28, sustain: 0, release: 0, cutoff: 5200, cutoffEnd: 600, filterTime: 0.22, q: 3, level: 0.8 },
    lead: { label: "Lead", wave: "square", attack: 0.012, decay: 0.12, sustain: 0.65, release: 0.09, cutoff: 3600, q: 1, detune: 8, vibrato: { cents: 14, rate: 5.5, delay: 0.18 }, level: 0.55 },
    pad: { label: "Pad", wave: "sawtooth", attack: 0.28, decay: 0.3, sustain: 0.75, release: 0.55, cutoff: 1500, q: 0.7, detune: 11, level: 0.5 },
    bass: { label: "Bass", wave: "sawtooth", attack: 0.005, decay: 0.14, sustain: 0.7, release: 0.06, cutoff: 900, cutoffEnd: 420, filterTime: 0.2, q: 2, sub: 0.7, level: 0.7 },
    bell: { label: "Bell", wave: "sine", attack: 0.002, decay: 1.4, sustain: 0, release: 0, partial: { ratio: 2.76, level: 0.4 }, level: 0.9 },
  };
  const MELODY_VOICE_PEAK = 0.25; // the same loudness the plain waveform note starts at

  function playVoicedNote(ctx, time, freq, voiceName, duration) {
    const v = MELODY_VOICES[voiceName];
    const end = time + duration;
    const peak = MELODY_VOICE_PEAK * (v.level || 1);
    const envelope = ctx.createGain();
    const g = envelope.gain;
    const attackEnd = time + v.attack;
    g.setValueAtTime(0.0001, time);
    g.linearRampToValueAtTime(peak, attackEnd);
    let stopAt;
    if (v.sustain > 0) {
      const held = Math.max(0.0001, peak * v.sustain);
      g.exponentialRampToValueAtTime(held, attackEnd + v.decay);
      const gate = Math.max(end, attackEnd + v.decay); // never cut into the decay, even for a one-step note
      g.setValueAtTime(held, gate);
      g.exponentialRampToValueAtTime(0.0001, gate + v.release);
      stopAt = gate + v.release + 0.02;
    } else {
      g.exponentialRampToValueAtTime(0.0001, attackEnd + v.decay);
      stopAt = attackEnd + v.decay + 0.02;
    }
    let tone = envelope;
    if (v.cutoff) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = v.q || 1;
      filter.frequency.setValueAtTime(v.cutoff, time);
      if (v.cutoffEnd) filter.frequency.exponentialRampToValueAtTime(v.cutoffEnd, time + (v.filterTime || v.decay));
      filter.connect(envelope);
      tone = filter;
    }
    envelope.connect(voiceOut(ctx));
    const oscillator = (type, hz, level, cents) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz;
      if (cents) osc.detune.value = cents;
      const mix = ctx.createGain();
      mix.gain.value = level;
      osc.connect(mix).connect(tone);
      osc.start(time);
      osc.stop(stopAt);
      return osc;
    };
    const twin = v.detune ? 0.5 : 1;
    const main = oscillator(v.wave, freq, twin);
    const voices = [main];
    if (v.detune) voices.push(oscillator(v.wave, freq, twin, v.detune), oscillator(v.wave, freq, twin * 0.6, -v.detune));
    if (v.sub) oscillator("sine", freq / 2, v.sub);
    if (v.partial) oscillator("sine", freq * v.partial.ratio, v.partial.level);
    if (v.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = v.vibrato.rate;
      depth.gain.setValueAtTime(0, time);
      depth.gain.linearRampToValueAtTime(v.vibrato.cents, time + v.vibrato.delay + 0.25);
      lfo.connect(depth);
      voices.forEach((o) => depth.connect(o.detune));
      lfo.start(time);
      lfo.stop(stopAt);
    }
  }

  // The name of the voice a song's melody uses, or "" for the plain waveform note (an unknown name is "" too, so stale data stays safe).
  function melodyVoiceOf(songData) {
    const name = songData && songData.melody && songData.melody.voice;
    return typeof name === "string" && Object.prototype.hasOwnProperty.call(MELODY_VOICES, name) ? name : "";
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

  // Swing delays every second sixteenth (steps 2, 4, 6... counting from 1) by up to half a step: 0 is straight,
  // about 67 is a triplet feel, 100 a dotted rhythm. Stored as songData.swing (0-100); absent means straight.
  function swingDelay(songData, step) {
    const amount = Math.max(0, Math.min(100, Number(songData.swing) || 0));
    return step % 2 === 1 ? (amount / 100) * 0.5 * stepDurationFor(songData.tempo) : 0;
  }

  // Held notes: melody.ties[note][i] === true joins step i to the same note on step i - 1, so the two are one note held for both steps
  // (no new attack on step i). A flag only counts when the note is on at both steps; anything else is ignored, so a stale flag can
  // never change the sound. Nothing ties across the end of the loop.
  function isTiedContinuation(songData, note, step) {
    const melody = songData.melody;
    const ties = melody && melody.ties && melody.ties[note];
    const row = melody && melody.notes && melody.notes[note];
    return Boolean(step > 0 && ties && row && ties[step] === true && row[step] && row[step - 1]);
  }
  // How many steps the note struck on `step` is held for (1 when it is not tied to anything after it).
  function heldSteps(songData, note, step) {
    let length = 1;
    while (step + length < STEPS && isTiedContinuation(songData, note, step + length)) length++;
    return length;
  }

  function scheduleStep(ctx, songData, step, time, random = Math.random) {
    time += swingDelay(songData, step);
    // Read fresh every step, same as tempo/kit below, so a live volume-
    // slider drag while a song is already playing takes effect on the next
    // scheduled step too (on top of the immediate application a caller
    // does directly via setMasterVolume -- this is a cheap idempotent
    // re-application, not the only place the value gets applied).
    setMasterVolume(ctx, songData.master_volume);
    setSpace(ctx, songData.space);
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
        if (songData.tracks[track][step] && PLAYERS[track] && !isTrackMuted(songData, track)) {
          const hitTime = Math.max(0, time + humanizeJitter(songData, random));
          withVolume(ctx, volumeOf(songData.trackMeta && songData.trackMeta[track]) * stepLevel(songData.tracks[track][step]), () => PLAYERS[track](ctx, hitTime, kit, random));
        }
      });
    }
    if (songData.melody && !isMelodyMuted(songData)) {
      const waveform = songData.melody.waveform || "sine";
      const voice = melodyVoiceOf(songData);
      const duration = stepDurationFor(songData.tempo);
      Object.keys(songData.melody.notes).sort().forEach((note) => {
        // A tied step carries on the note struck before it, which was given its full length when it started.
        if (songData.melody.notes[note][step] && !isTiedContinuation(songData, note, step)) {
          const noteTime = Math.max(0, time + humanizeJitter(songData, random));
          const length = duration * heldSteps(songData, note, step);
          withVolume(ctx, volumeOf(songData.melody) * stepLevel(songData.melody.notes[note][step]), () =>
            voice ? playVoicedNote(ctx, noteTime, noteToFreq(note), voice, length) : playMelodyNote(ctx, noteTime, noteToFreq(note), waveform, length));
        }
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
    // Held notes change the sound, so they feed the seed too; a song without any seeds exactly as it always did.
    const heldKeys = melody && songData.melody.ties && typeof songData.melody.ties === "object"
      ? Object.keys(notes).sort().filter((key) => Array.isArray(notes[key]) && notes[key].some((on, step) => on && isTiedContinuation(songData, key, step)))
      : [];
    if (melody && heldKeys.length) melody.held = heldKeys.map((key) => [key, songData.melody.ties[key]]);
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
        if (onStep) onStep(currentStep, nextStepTime + swingDelay(songData, currentStep)); // the time the step actually sounds
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
    // The same goes for Space: a reverb tail would smear the pattern it is meant to show.
    const previewData =
      songData.master_volume === 1 && !songData.humanize && !songData.space
        ? songData
        : Object.assign({}, songData, { master_volume: 1, humanize: 0, space: 0 });
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

  // Renders `loops` repeats of the pattern to mono samples for exporting as
  // audio, with the song's own master volume, humanize and mutes applied (the
  // same mix you hear). The pattern is played twice in an offline context and
  // the SECOND pass is kept: it already contains the ring-out of the notes at
  // the end of the first pass, exactly as a loop in playback does, so it joins
  // onto itself without a click. That one pass is then copied `loops` times, so
  // every repeat is the identical whole number of samples. Humanize and drum
  // noise use a content-seeded random stream restarted for each pass.
  // `tailSeconds` keeps the ring-out after the last repeat; without it the
  // result is cut at the loop boundary.
  async function renderLoopAudio(songData, options = {}) {
    const rate = Number(options.sampleRate);
    const sampleRate = Number.isFinite(rate) && rate >= 8000 && rate <= 192000 ? Math.round(rate) : 44100;
    const loops = Math.max(1, Math.min(16, Math.round(Number(options.loops)) || 1));
    const tail = Math.max(0, Math.min(10, Number(options.tailSeconds) || 0));
    const loopSamples = Math.max(1, Math.round(stepDurationFor(songData.tempo) * STEPS * sampleRate));
    const tailSamples = Math.round(tail * sampleRate);
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OfflineCtx(1, loopSamples * 2 + tailSamples, sampleRate);
    // The master gain starts at 1 and setMasterVolume only ramps towards the
    // song's volume over 30 ms, which would leave the first moments too loud;
    // start it at the right level so the whole render is at the song's volume.
    getMasterGain(ctx).gain.value = Number.isFinite(songData.master_volume) ? Math.max(0, Math.min(1, songData.master_volume)) : 1;
    setSpace(ctx, songData.space, true);
    const stepSeconds = loopSamples / sampleRate / STEPS;
    for (let pass = 0; pass < 2; pass++) {
      const random = previewRandom(songData);
      for (let step = 0; step < STEPS; step++) scheduleStep(ctx, songData, step, (pass * STEPS + step) * stepSeconds, random);
    }
    const rendered = (await ctx.startRendering()).getChannelData(0);
    const samples = new Float32Array(loopSamples * loops + tailSamples);
    const oneLoop = rendered.subarray(loopSamples, loopSamples * 2);
    for (let loop = 0; loop < loops; loop++) samples.set(oneLoop, loop * loopSamples);
    if (tailSamples) samples.set(rendered.subarray(loopSamples * 2, loopSamples * 2 + tailSamples), loopSamples * loops);
    return { samples, sampleRate, loopSamples, loops };
  }

  return {
    STEPS,
    NOTE_NAMES,
    noteToFreq,
    midiToNoteName,
    scheduleStep,
    isTrackMuted,
    isMelodyMuted,
    isTiedContinuation,
    heldSteps,
    stepHasAudibleDrumHit,
    swingDelay,
    DRUM_VOICES: Object.keys(PLAYERS),
    playMelodyNote,
    playVoicedNote,
    melodyVoiceOf,
    MELODY_VOICES,
    withVolume,
    stepLevel,
    volumeOf,
    createPlayer,
    renderWaveformPeaks,
    renderLoopAudio,
    setMasterVolume,
    setSpace,
    getPeakMeterAnalyser,
  };
})();
