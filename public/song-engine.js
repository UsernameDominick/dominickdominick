// Shared by the Studio's song builder and the shelf's song cards —
// one implementation of drum synthesis, note→frequency, and playback
// scheduling, used by both instead of duplicated per-context. Kept
// framework-free and DOM-free so either caller can drive it with its own
// UI (grid highlighting, whatever).
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

  // ---------- Output limiter ----------
  // Everything the listener hears goes through one soft limiter in front of the speakers (the master bus, the reverb return and the echo
  // return all end here). It is a waveshaper whose curve is a straight line up to LIMIT_KNEE of full scale, so a normal mix passes through
  // untouched, and above it bends smoothly towards full scale without ever reaching past it: a pile-up of supersaw, pad and chords is
  // squashed gently instead of clipping into harsh distortion. Inputs up to LIMIT_RANGE times full scale are shaped; the gain in front
  // scales the signal into the curve's domain. No look-ahead, so no delay. The meters read the signal BEFORE it (the master gain), so the
  // clipping history still tells the visitor when a mix is hot enough for the limiter to be working.
  const LIMIT_KNEE = 0.85;
  const LIMIT_RANGE = 4;
  let limiterCurve = null;
  function softLimit(x) {
    const a = Math.abs(x);
    if (a <= LIMIT_KNEE) return x;
    const y = LIMIT_KNEE + (1 - LIMIT_KNEE) * Math.tanh((a - LIMIT_KNEE) / (1 - LIMIT_KNEE));
    return x < 0 ? -y : y;
  }
  function getLimiterCurve() {
    if (!limiterCurve) {
      const n = 4097; // odd, so the middle sample is exactly 0
      limiterCurve = new Float32Array(n);
      for (let i = 0; i < n; i++) limiterCurve[i] = softLimit((i / (n - 1) * 2 - 1) * LIMIT_RANGE);
    }
    return limiterCurve;
  }
  const outputs = new WeakMap();
  // Where a voice, the master bus or an effect return connects to be heard. A render that measures the song's own level (the peak scan
  // behind Normalize to peak) sets ctx.__measure first and gets the bare destination, so it sees the true level, not the limited one.
  function getOutput(ctx) {
    let out = outputs.get(ctx);
    if (!out) {
      if (ctx.__measure) {
        out = ctx.destination;
      } else {
        const pre = ctx.createGain();
        pre.gain.value = 1 / LIMIT_RANGE;
        const shaper = ctx.createWaveShaper();
        shaper.curve = getLimiterCurve();
        shaper.oversample = "none";
        pre.connect(shaper);
        shaper.connect(ctx.destination);
        out = pre;
      }
      outputs.set(ctx, out);
    }
    return out;
  }

  // ---------- Master bus ----------
  // One shared GainNode per AudioContext that every voice routes through
  // instead of ctx.destination directly, so a single master-volume control
  // affects drums + melody together. Keyed by ctx (not a module-level
  // singleton) since the builder and a shelf card each own their own
  // AudioContext, and an OfflineAudioContext used for waveform rendering
  // needs its own gain node too.
  const masterGains = new WeakMap();
  function getMasterGain(ctx) {
    let gain = masterGains.get(ctx);
    if (!gain) {
      gain = ctx.createGain();
      gain.connect(getOutput(ctx));
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
  let busDest = null; // the music bus while the melody and the other melodic parts are being scheduled with Pump on (see "Pump" below)
  function voiceOut(ctx) {
    return voiceDest || busDest || getMasterGain(ctx);
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
    gain.connect(busDest || getMasterGain(ctx));
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
  // seed (decaying noise), so exports always get the same room.
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
      wet.connect(getOutput(ctx));
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

  // ---------- Pump (sidechain-style ducking) ----------
  // A song with Pump above 0 sends its melody and bass line through one "music" gain that dips on every kick hit and swells back, the
  // way sidechain compression makes a bass breathe with the kick. The music bus sits before the master gain, so the reverb and echo
  // sends hear the pumping too. Pump 0 (or absent) builds nothing, so those songs sound and render exactly as before.
  const PUMP_MAX_DIP = 0.85; // at Pump 100 the music falls to 15% on a kick
  const musicBuses = new WeakMap();
  function getMusicBus(ctx) {
    let bus = musicBuses.get(ctx);
    if (!bus) {
      bus = ctx.createGain();
      bus.connect(getMasterGain(ctx));
      musicBuses.set(ctx, bus);
    }
    return bus;
  }
  function pumpAmount(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) / 100 : 0;
  }
  // The dip on a kick at `time`: down at once, then back up over about three steps (never more than a third of a second).
  function duckMusic(ctx, time, amount, tempo) {
    const gain = getMusicBus(ctx).gain;
    const release = Math.min(0.35, stepDurationFor(tempo) * 3);
    gain.setValueAtTime(1 - amount * PUMP_MAX_DIP, time);
    gain.linearRampToValueAtTime(1, time + release);
  }
  function withMusicBus(ctx, amount, fn) {
    if (!amount) return fn();
    busDest = getMusicBus(ctx);
    try {
      return fn();
    } finally {
      busDest = null;
    }
  }

  // ---------- Echo (tempo-synced delay) ----------
  // Like Space, a send off the master bus that a song with Echo at 0 never builds: master gain -> delay -> low-pass -> wet gain ->
  // destination, with the low-pass fed back into the delay so each repeat is quieter and duller than the last. The delay is a dotted
  // eighth (three sixteenth steps) of the song's tempo, which is what makes repeats land between the beats rather than on top of them.
  const ECHO_STEPS = 3;
  const ECHO_MAX_WET = 0.8;
  const echoSends = new WeakMap();
  function getEchoSend(ctx) {
    let send = echoSends.get(ctx);
    if (!send) {
      const delay = ctx.createDelay(2);
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 3200;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.4;
      const wet = ctx.createGain();
      wet.gain.value = 0;
      getMasterGain(ctx).connect(delay);
      delay.connect(tone);
      tone.connect(wet);
      tone.connect(feedback);
      feedback.connect(delay);
      wet.connect(getOutput(ctx));
      const analyser = peakMeterAnalysers.get(ctx);
      if (analyser) wet.connect(analyser);
      send = { delay, feedback, wet };
      echoSends.set(ctx, send);
    }
    return send;
  }
  function echoAmount(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) / 100 : 0;
  }
  // Echo is 0 to 100 (percent). More echo is both louder and longer-lasting (the feedback rises from 0.35 to 0.6). The delay time follows
  // the tempo, so this is called with it every step as well as when the slider moves. `immediate` sets the levels outright, for an offline
  // render that has to be right from its first sample.
  function setEcho(ctx, value, tempo, immediate) {
    const amount = echoAmount(value);
    if (amount === 0 && !echoSends.has(ctx)) return;
    const send = getEchoSend(ctx);
    const wet = amount * ECHO_MAX_WET;
    const feedback = 0.35 + amount * 0.25;
    const time = Math.min(1.99, stepDurationFor(tempo) * ECHO_STEPS);
    if (immediate) {
      send.wet.gain.value = wet;
      send.feedback.gain.value = feedback;
      send.delay.delayTime.value = time;
      return;
    }
    const now = ctx.currentTime;
    send.wet.gain.cancelScheduledValues(now);
    send.wet.gain.setValueAtTime(send.wet.gain.value, now);
    send.wet.gain.linearRampToValueAtTime(wet, now + 0.03);
    send.feedback.gain.setValueAtTime(feedback, now);
    send.delay.delayTime.setValueAtTime(time, now);
  }

  // Each kit is a set of numbers the drum voices read. A kit only names what differs from DEFAULT_KIT, which holds the numbers the
  // first three kits always had, so those sound exactly as they did.
  const DEFAULT_KIT = {
    kickFreq: 150, kickDecay: 0.35, kickWave: "sine", kickDrop: 2.5, kickEnd: 0.5, kickClick: 0, kickDrive: 0,
    snareTone: 200, snareDecay: 0.18, snareHP: 900, snareNoise: 0.7, snareBody: 0.5, snareWave: "triangle",
    hihatDecay: 0.06, hihatHP: 7000, hihatLevel: 0.4,
    clapDecay: 0.12, clapBP: 1200, clapLevel: 0.5,
    openhatDecay: 0.3, openhatHP: 6500,
    tomFreq: 120, tomDecay: 0.3, tomDrop: 1.9,
    rimDecay: 0.035, rimTune: 1, crashDecay: 1.2, crashHP: 1,
  };
  const KIT_LABELS = {
    acoustic: "Acoustic", electronic: "Electronic", "808": "808", "909": "909", house: "House", techno: "Techno", trap: "Trap", boombap: "Boom bap",
    lofi: "Lo-fi", rock: "Rock", jazz: "Jazz", dnb: "Drum and bass", chip: "8-bit", industrial: "Industrial", soft: "Soft",
  };
  const KIT_PARAMS = {
    acoustic: {},
    electronic: { kickFreq: 90, kickDecay: 0.25, snareTone: 320, snareDecay: 0.12, hihatDecay: 0.04, clapDecay: 0.08, openhatDecay: 0.2, tomFreq: 160, tomDecay: 0.22, rimDecay: 0.025, crashDecay: 0.9 },
    "808": { kickFreq: 55, kickDecay: 0.55, snareTone: 180, snareDecay: 0.22, hihatDecay: 0.08, clapDecay: 0.15, openhatDecay: 0.4, tomFreq: 90, tomDecay: 0.5, rimDecay: 0.03, crashDecay: 1.5 },
    "909": { kickFreq: 70, kickDecay: 0.3, kickClick: 0.5, kickDrive: 0.25, snareTone: 230, snareDecay: 0.2, snareHP: 1200, snareNoise: 0.85, hihatDecay: 0.05, hihatHP: 8000, clapDecay: 0.14, clapBP: 1500, openhatDecay: 0.35, tomFreq: 130, tomDecay: 0.28, crashDecay: 1.4 },
    house: { kickFreq: 60, kickDecay: 0.28, kickClick: 0.35, snareTone: 210, snareDecay: 0.13, snareNoise: 0.5, snareBody: 0.35, hihatDecay: 0.05, hihatHP: 8500, hihatLevel: 0.34, clapDecay: 0.16, clapBP: 1400, clapLevel: 0.65, openhatDecay: 0.32, openhatHP: 7500 },
    techno: { kickFreq: 52, kickDecay: 0.34, kickDrop: 3, kickClick: 0.3, kickDrive: 0.5, snareTone: 260, snareDecay: 0.1, snareHP: 1500, snareBody: 0.3, hihatDecay: 0.035, hihatHP: 9000, clapDecay: 0.1, clapBP: 1800, openhatDecay: 0.18, tomFreq: 140, tomDecay: 0.2, rimDecay: 0.02, crashDecay: 1 },
    trap: { kickFreq: 42, kickDecay: 0.85, kickDrop: 2, kickEnd: 0.7, kickClick: 0.15, snareTone: 240, snareDecay: 0.14, snareHP: 1400, snareNoise: 0.8, snareBody: 0.25, hihatDecay: 0.03, hihatHP: 9500, hihatLevel: 0.36, clapDecay: 0.18, clapBP: 1300, openhatDecay: 0.22, openhatHP: 8500, tomFreq: 80, tomDecay: 0.6, crashDecay: 1.6 },
    boombap: { kickFreq: 62, kickDecay: 0.32, kickClick: 0.2, kickDrive: 0.3, snareTone: 190, snareDecay: 0.2, snareHP: 700, snareNoise: 0.75, snareBody: 0.55, hihatDecay: 0.045, hihatHP: 6000, hihatLevel: 0.3, clapDecay: 0.14, clapBP: 1000, openhatDecay: 0.26, openhatHP: 5500, tomFreq: 100, tomDecay: 0.32, crashDecay: 1.1 },
    lofi: { kickFreq: 72, kickDecay: 0.3, kickWave: "triangle", kickDrop: 2, snareTone: 170, snareDecay: 0.17, snareHP: 500, snareNoise: 0.45, snareBody: 0.55, hihatDecay: 0.05, hihatHP: 4500, hihatLevel: 0.26, clapDecay: 0.16, clapBP: 800, clapLevel: 0.4, openhatDecay: 0.24, openhatHP: 4200, tomFreq: 95, tomDecay: 0.3, rimDecay: 0.04, rimTune: 0.8, crashDecay: 1, crashHP: 0.6 },
    rock: { kickFreq: 110, kickDecay: 0.4, kickClick: 0.45, snareTone: 180, snareDecay: 0.26, snareHP: 700, snareNoise: 0.85, snareBody: 0.6, hihatDecay: 0.07, hihatHP: 6500, hihatLevel: 0.42, clapDecay: 0.14, openhatDecay: 0.45, openhatHP: 6000, tomFreq: 100, tomDecay: 0.45, tomDrop: 1.5, crashDecay: 2, crashHP: 0.9 },
    jazz: { kickFreq: 130, kickDecay: 0.22, kickWave: "triangle", kickDrop: 1.8, snareTone: 220, snareDecay: 0.22, snareHP: 450, snareNoise: 0.4, snareBody: 0.25, hihatDecay: 0.1, hihatHP: 5000, hihatLevel: 0.24, clapDecay: 0.1, clapBP: 900, clapLevel: 0.3, openhatDecay: 0.5, openhatHP: 4500, tomFreq: 110, tomDecay: 0.35, rimDecay: 0.05, rimTune: 0.9, crashDecay: 1.8, crashHP: 0.7 },
    dnb: { kickFreq: 68, kickDecay: 0.22, kickClick: 0.4, snareTone: 300, snareDecay: 0.15, snareHP: 1600, snareNoise: 0.9, snareBody: 0.45, hihatDecay: 0.03, hihatHP: 9000, hihatLevel: 0.34, clapDecay: 0.09, openhatDecay: 0.2, openhatHP: 8000, tomFreq: 150, tomDecay: 0.2, crashDecay: 1.2 },
    chip: { kickFreq: 100, kickDecay: 0.16, kickWave: "square", kickDrop: 3, kickEnd: 0.3, snareTone: 400, snareDecay: 0.1, snareHP: 3000, snareNoise: 0.6, snareBody: 0.35, snareWave: "square", hihatDecay: 0.025, hihatHP: 10000, hihatLevel: 0.3, clapDecay: 0.07, clapBP: 2500, openhatDecay: 0.14, openhatHP: 9000, tomFreq: 180, tomDecay: 0.14, rimDecay: 0.02, rimTune: 1.3, crashDecay: 0.6, crashHP: 1.2 },
    industrial: { kickFreq: 50, kickDecay: 0.45, kickWave: "sine", kickDrop: 3.5, kickClick: 0.7, kickDrive: 0.9, snareTone: 150, snareDecay: 0.25, snareHP: 2000, snareNoise: 1, snareBody: 0.7, snareWave: "sawtooth", hihatDecay: 0.05, hihatHP: 6000, hihatLevel: 0.45, clapDecay: 0.2, clapBP: 2000, clapLevel: 0.6, openhatDecay: 0.35, tomFreq: 70, tomDecay: 0.5, tomDrop: 2.4, crashDecay: 2.2, crashHP: 0.8 },
    soft: { kickFreq: 80, kickDecay: 0.26, kickWave: "triangle", kickDrop: 1.7, snareTone: 190, snareDecay: 0.16, snareHP: 600, snareNoise: 0.35, snareBody: 0.4, hihatDecay: 0.06, hihatHP: 5500, hihatLevel: 0.2, clapDecay: 0.1, clapBP: 900, clapLevel: 0.3, openhatDecay: 0.3, openhatHP: 5000, tomFreq: 105, tomDecay: 0.3, rimDecay: 0.04, rimTune: 0.9, crashDecay: 1.3, crashHP: 0.7 },
  };
  const KITS = ["acoustic", "electronic", "808", "909", "house", "techno", "trap", "boombap", "lofi", "rock", "jazz", "dnb", "chip", "industrial", "soft"]; // the order of the menus (number-like names would otherwise sort first)

  // One drum sound's own tweaks (songData.trackMeta[row]): tune in semitones, decay as a multiplier of the kit's, tone from dull to bright
  // (for the kick and the tom it is the punch of the pitch drop). Anything outside its range is pulled back inside; absent means "as the kit".
  const DRUM_RANGES = { tune: [-12, 12], decay: [0.3, 3], tone: [-1, 1] };
  function drumShape(meta) {
    const out = {};
    if (!meta || typeof meta !== "object") return out;
    Object.keys(DRUM_RANGES).forEach((key) => {
      const n = Number(meta[key]);
      if (meta[key] === undefined || meta[key] === null || meta[key] === "" || !Number.isFinite(n)) return;
      out[key] = Math.max(DRUM_RANGES[key][0], Math.min(DRUM_RANGES[key][1], n));
    });
    return out;
  }
  function kitParams(kit, shape) {
    const p = Object.assign({}, DEFAULT_KIT, Object.prototype.hasOwnProperty.call(KIT_PARAMS, kit) ? KIT_PARAMS[kit] : KIT_PARAMS.acoustic);
    if (!shape) return p;
    const f = shape.tune ? Math.pow(2, shape.tune / 12) : 1;
    const d = shape.decay || 1;
    const t = shape.tone ? Math.pow(2, shape.tone * 1.5) : 1;
    if (f !== 1) {
      ["kickFreq", "snareTone", "tomFreq", "snareHP", "hihatHP", "openhatHP", "clapBP"].forEach((k) => (p[k] *= f));
      p.rimTune *= f;
      p.crashHP *= f;
    }
    if (d !== 1) ["kickDecay", "snareDecay", "hihatDecay", "clapDecay", "openhatDecay", "tomDecay", "rimDecay", "crashDecay"].forEach((k) => (p[k] *= d));
    if (t !== 1) {
      ["snareHP", "hihatHP", "openhatHP", "clapBP"].forEach((k) => (p[k] *= t));
      p.crashHP *= t;
      p.rimTune *= Math.sqrt(t);
      p.kickDrop *= t;
      p.tomDrop = 1 + (p.tomDrop - 1) * t;
    }
    return p;
  }
  // The tone of a hit in the kit's own terms: a soft saturation (a waveshaper) for the kicks that ask for drive.
  const driveCurves = new Map();
  function driveCurve(amount) {
    const key = Math.round(amount * 20);
    if (!driveCurves.has(key)) {
      const k = 1 + key * 1.5;
      const curve = new Float32Array(257);
      for (let i = 0; i < 257; i++) {
        const x = (i / 128) - 1;
        curve[i] = Math.tanh(k * x) / Math.tanh(k);
      }
      driveCurves.set(key, curve);
    }
    return driveCurves.get(key);
  }

  function playKick(ctx, time, kit, random = Math.random, shape) {
    const p = kitParams(kit, shape);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = p.kickWave;
    osc.frequency.setValueAtTime(p.kickFreq * p.kickDrop, time);
    osc.frequency.exponentialRampToValueAtTime(p.kickFreq * p.kickEnd, time + p.kickDecay);
    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + p.kickDecay);
    let tail = gain;
    if (p.kickDrive > 0) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = driveCurve(p.kickDrive);
      gain.connect(shaper);
      tail = shaper;
    }
    osc.connect(gain);
    tail.connect(voiceOut(ctx));
    osc.start(time);
    osc.stop(time + p.kickDecay + 0.05);
    if (p.kickClick > 0) {
      const click = ctx.createBufferSource();
      click.buffer = noiseBuffer(ctx, 0.012, random);
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 2500;
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(p.kickClick * 0.6, time);
      clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.012);
      click.connect(filter).connect(clickGain).connect(voiceOut(ctx));
      click.start(time);
    }
  }

  function playSnare(ctx, time, kit, random = Math.random, shape) {
    const p = kitParams(kit, shape);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, p.snareDecay, random);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = p.snareHP;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(p.snareNoise, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + p.snareDecay);
    noise.connect(noiseFilter).connect(noiseGain).connect(voiceOut(ctx));
    noise.start(time);

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = p.snareWave;
    osc.frequency.value = p.snareTone;
    oscGain.gain.setValueAtTime(p.snareBody, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + p.snareDecay * 0.8);
    osc.connect(oscGain).connect(voiceOut(ctx));
    osc.start(time);
    osc.stop(time + p.snareDecay + 0.05);
  }

  function playHihat(ctx, time, kit, random = Math.random, shape) {
    chokeOpenHat(ctx, time); // a closed hat steps on a ringing open one
    const p = kitParams(kit, shape);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, p.hihatDecay, random);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = p.hihatHP;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(p.hihatLevel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + p.hihatDecay);
    noise.connect(filter).connect(gain).connect(voiceOut(ctx));
    noise.start(time);
  }

  function playClap(ctx, time, kit, random = Math.random, shape) {
    const p = kitParams(kit, shape);
    // Three quick, tightly-spaced bursts read as a "clap" rather than a
    // single noise hit — a cheap, standard trick for synthesizing claps.
    [0, 0.012, 0.024].forEach((offset) => {
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer(ctx, p.clapDecay, random);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = p.clapBP;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(p.clapLevel, time + offset);
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
  function playOpenHat(ctx, time, kit, random = Math.random, shape) {
    chokeOpenHat(ctx, time);
    const p = kitParams(kit, shape);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, p.openhatDecay, random);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = p.openhatHP;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + p.openhatDecay);
    const choke = ctx.createGain();
    noise.connect(filter).connect(gain).connect(choke).connect(voiceOut(ctx));
    noise.start(time);
    openHats.set(ctx, { choke: choke.gain, from: time, until: time + p.openhatDecay });
  }

  function playTom(ctx, time, kit, random = Math.random, shape) {
    const p = kitParams(kit, shape);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(p.tomFreq * p.tomDrop, time);
    osc.frequency.exponentialRampToValueAtTime(p.tomFreq, time + 0.07);
    gain.gain.setValueAtTime(0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + p.tomDecay);
    osc.connect(gain).connect(voiceOut(ctx));
    osc.start(time);
    osc.stop(time + p.tomDecay + 0.05);
  }

  // A short, dry click: two pitched tones and a burst of band-passed noise, over in a few hundredths of a second.
  function playRim(ctx, time, kit, random = Math.random, shape) {
    const p = kitParams(kit, shape);
    [[1750, 0.35], [480, 0.45]].forEach(([freq, level]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq * p.rimTune;
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
    filter.frequency.value = 3200 * p.rimTune;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.3, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + p.rimDecay);
    noise.connect(filter).connect(noiseGain).connect(voiceOut(ctx));
    noise.start(time);
  }

  // Two layers of noise at different brightness shimmer against each other and die away slowly.
  function playCrash(ctx, time, kit, random = Math.random, shape) {
    const p = kitParams(kit, shape);
    [[4500, 0.22, 1], [9000, 0.16, 0.7]].forEach(([cutoff, level, length]) => {
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer(ctx, p.crashDecay * length, random);
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = cutoff * p.crashHP;
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
    // the first five are the originals: their numbers must not change (old songs sound as they did)
    pluck: { label: "Pluck", wave: "sawtooth", attack: 0.002, decay: 0.28, sustain: 0, release: 0, cutoff: 5200, cutoffEnd: 600, filterTime: 0.22, q: 3, level: 0.8 },
    lead: { label: "Lead", wave: "square", attack: 0.012, decay: 0.12, sustain: 0.65, release: 0.09, cutoff: 3600, q: 1, detune: 8, vibrato: { cents: 14, rate: 5.5, delay: 0.18 }, level: 0.55 },
    pad: { label: "Pad", wave: "sawtooth", attack: 0.28, decay: 0.3, sustain: 0.75, release: 0.55, cutoff: 1500, q: 0.7, detune: 11, level: 0.5 },
    bass: { label: "Bass", wave: "sawtooth", attack: 0.005, decay: 0.14, sustain: 0.7, release: 0.06, cutoff: 900, cutoffEnd: 420, filterTime: 0.2, q: 2, sub: 0.7, level: 0.7 },
    bell: { label: "Bell", wave: "sine", attack: 0.002, decay: 1.4, sustain: 0, release: 0, partial: { ratio: 2.76, level: 0.4 }, level: 0.9 },
    // keys
    epiano: { label: "Electric piano", wave: "sine", attack: 0.004, decay: 1.1, sustain: 0.2, release: 0.3, fm: { ratio: 1, depth: 0.22 }, tremolo: { depth: 0.18, rate: 4.6 }, level: 0.8 },
    fmkeys: { label: "Bright keys", wave: "sine", attack: 0.003, decay: 0.7, sustain: 0.1, release: 0.2, fm: { ratio: 2, depth: 0.35 }, partial: { ratio: 4, level: 0.12 }, level: 0.75 },
    piano: { label: "Piano", wave: "triangle", attack: 0.003, decay: 1.2, sustain: 0, release: 0, cutoff: 4200, cutoffEnd: 700, filterTime: 0.7, q: 0.8, partial: { ratio: 2, level: 0.35 }, level: 0.85 },
    clav: { label: "Clav", wave: "sawtooth", attack: 0.002, decay: 0.26, sustain: 0, release: 0, cutoff: 3600, cutoffEnd: 700, filterTime: 0.16, q: 5, level: 0.75 },
    organ: { label: "Organ", wave: "sine", attack: 0.012, decay: 0.05, sustain: 1, release: 0.06, sub: 0.45, partial: { ratio: 3, level: 0.3 }, vibrato: { cents: 7, rate: 6.4, delay: 0.1 }, level: 0.6 },
    musicbox: { label: "Music box", wave: "sine", attack: 0.002, decay: 0.9, sustain: 0, release: 0, partial: { ratio: 4, level: 0.5 }, level: 0.8 },
    // plucked and struck
    harp: { label: "Harp", wave: "triangle", attack: 0.002, decay: 1.1, sustain: 0, release: 0, cutoff: 4800, cutoffEnd: 1200, filterTime: 0.5, q: 0.9, partial: { ratio: 2, level: 0.3 }, level: 0.85 },
    guitar: { label: "Guitar", wave: "sawtooth", attack: 0.002, decay: 0.75, sustain: 0, release: 0, cutoff: 3400, cutoffEnd: 700, filterTime: 0.5, q: 1.5, level: 0.7 },
    kalimba: { label: "Kalimba", wave: "sine", attack: 0.002, decay: 0.6, sustain: 0, release: 0, partial: { ratio: 5.4, level: 0.3 }, level: 0.9 },
    marimba: { label: "Marimba", wave: "sine", attack: 0.002, decay: 0.5, sustain: 0, release: 0, partial: { ratio: 4, level: 0.5 }, cutoff: 3000, q: 0.7, level: 0.9 },
    pizz: { label: "Pizzicato", wave: "square", attack: 0.002, decay: 0.22, sustain: 0, release: 0, cutoff: 2600, cutoffEnd: 500, filterTime: 0.15, q: 1.5, level: 0.6 },
    stab: { label: "Synth stab", wave: "sawtooth", attack: 0.003, decay: 0.24, sustain: 0, release: 0, cutoff: 3600, cutoffEnd: 800, filterTime: 0.18, q: 2, unison: 3, detune: 14, level: 0.6 },
    // bass
    subbass: { label: "Sub bass", wave: "sine", attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.08, level: 1 },
    reese: { label: "Reese bass", wave: "sawtooth", attack: 0.01, decay: 0.2, sustain: 0.9, release: 0.1, cutoff: 750, q: 2, unison: 3, detune: 18, drive: 0.2, level: 0.6 },
    acid: { label: "Acid bass", wave: "sawtooth", attack: 0.002, decay: 0.22, sustain: 0.45, release: 0.05, cutoff: 2400, cutoffEnd: 260, filterTime: 0.16, q: 12, level: 0.6 },
    wobble: { label: "Wobble bass", wave: "sawtooth", attack: 0.005, decay: 0.2, sustain: 0.9, release: 0.08, cutoff: 700, q: 7, wobble: { rate: 3, cents: 2400 }, sub: 0.5, level: 0.6 },
    finger: { label: "Finger bass", wave: "triangle", attack: 0.006, decay: 0.3, sustain: 0.55, release: 0.08, cutoff: 1500, cutoffEnd: 500, filterTime: 0.3, q: 1, sub: 0.4, level: 0.9 },
    pluckbass: { label: "Pluck bass", wave: "sawtooth", attack: 0.002, decay: 0.28, sustain: 0, release: 0, cutoff: 1900, cutoffEnd: 300, filterTime: 0.22, q: 3, sub: 0.5, level: 0.75 },
    chipbass: { label: "8-bit bass", wave: "square", attack: 0.002, decay: 0.08, sustain: 0.8, release: 0.03, cutoff: 1800, q: 0.7, level: 0.55 },
    // leads
    supersaw: { label: "Supersaw", wave: "sawtooth", attack: 0.012, decay: 0.15, sustain: 0.8, release: 0.15, cutoff: 6500, q: 0.8, unison: 5, detune: 22, level: 0.4 },
    squarelead: { label: "Square lead", wave: "square", attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.08, cutoff: 5200, q: 1, vibrato: { cents: 10, rate: 5.8, delay: 0.25 }, level: 0.5 },
    chip: { label: "8-bit lead", wave: "square", attack: 0.001, decay: 0.05, sustain: 0.75, release: 0.03, level: 0.45 },
    brass: { label: "Brass", wave: "sawtooth", attack: 0.06, decay: 0.15, sustain: 0.8, release: 0.12, cutoff: 1200, cutoffEnd: 3400, filterTime: 0.14, q: 1.4, detune: 6, level: 0.55 },
    strings: { label: "Strings", wave: "sawtooth", attack: 0.18, decay: 0.3, sustain: 0.85, release: 0.25, cutoff: 3200, q: 0.7, unison: 3, detune: 9, vibrato: { cents: 12, rate: 5.4, delay: 0.3 }, level: 0.5 },
    flute: { label: "Flute", wave: "sine", attack: 0.08, decay: 0.1, sustain: 0.85, release: 0.12, noise: 0.12, cutoff: 4500, q: 0.8, vibrato: { cents: 11, rate: 5, delay: 0.3 }, level: 0.8 },
    vox: { label: "Choir lead", wave: "sawtooth", attack: 0.14, decay: 0.2, sustain: 0.8, release: 0.25, noise: 0.04, ftype: "bandpass", cutoff: 1000, q: 2.2, vibrato: { cents: 14, rate: 5.2, delay: 0.25 }, level: 1 },
    laser: { label: "Laser", wave: "sawtooth", attack: 0.001, decay: 0.22, sustain: 0, release: 0, cutoff: 6000, q: 4, slide: { cents: 2400, time: 0.14 }, level: 0.6 },
    // pads
    warmpad: { label: "Warm pad", wave: "triangle", attack: 0.5, decay: 0.4, sustain: 0.8, release: 0.9, cutoff: 1100, q: 0.7, unison: 3, detune: 9, level: 0.6 },
    glasspad: { label: "Glass pad", wave: "sine", attack: 0.45, decay: 0.4, sustain: 0.8, release: 1, partial: { ratio: 2.005, level: 0.5 }, tremolo: { depth: 0.2, rate: 3.2 }, unison: 2, detune: 6, level: 0.6 },
    stringpad: { label: "String pad", wave: "sawtooth", attack: 0.6, decay: 0.4, sustain: 0.85, release: 1, cutoff: 1900, q: 0.7, unison: 5, detune: 16, level: 0.4 },
    darkpad: { label: "Dark pad", wave: "sawtooth", attack: 0.7, decay: 0.5, sustain: 0.8, release: 1.2, cutoff: 600, cutoffEnd: 900, filterTime: 0.8, q: 1.5, unison: 3, detune: 12, level: 0.5 },
    swell: { label: "Swell", wave: "sawtooth", attack: 1.1, decay: 0.5, sustain: 0.8, release: 1.4, cutoff: 800, cutoffEnd: 2600, filterTime: 1.1, q: 1.2, unison: 3, detune: 10, level: 0.5 },
    wind: { label: "Wind", wave: "sine", attack: 0.5, decay: 0.3, sustain: 0.9, release: 0.9, noise: 0.8, ftype: "bandpass", cutoff: 900, q: 3, tremolo: { depth: 0.3, rate: 0.7 }, level: 0.3 },
    // bells and mallets
    chime: { label: "Chime", wave: "sine", attack: 0.002, decay: 1.9, sustain: 0, release: 0, partial: { ratio: 3.01, level: 0.5 }, level: 0.8 },
    vibes: { label: "Vibraphone", wave: "sine", attack: 0.003, decay: 1.6, sustain: 0, release: 0, partial: { ratio: 4, level: 0.2 }, tremolo: { depth: 0.45, rate: 5 }, level: 0.9 },
    glassbell: { label: "Glass bell", wave: "sine", attack: 0.002, decay: 1.5, sustain: 0, release: 0, fm: { ratio: 3.5, depth: 0.45 }, level: 0.8 },
  };
  // How the instruments are grouped in the menus.
  const VOICE_GROUPS = [
    { label: "Keys", voices: ["epiano", "fmkeys", "piano", "clav", "organ", "musicbox"] },
    { label: "Plucked and struck", voices: ["pluck", "harp", "guitar", "kalimba", "marimba", "pizz", "stab"] },
    { label: "Bass", voices: ["bass", "subbass", "reese", "acid", "wobble", "finger", "pluckbass", "chipbass"] },
    { label: "Leads", voices: ["lead", "supersaw", "squarelead", "chip", "brass", "strings", "flute", "vox", "laser"] },
    { label: "Pads", voices: ["pad", "warmpad", "glasspad", "stringpad", "darkpad", "swell", "wind"] },
    { label: "Bells and mallets", voices: ["bell", "chime", "vibes", "glassbell"] },
  ];
  const MELODY_VOICE_PEAK = 0.25; // the same loudness the plain waveform note starts at

  // A track's own tweaks to its sound (songData[part].synth): any of these, each inside its range. Anything else is dropped, so stale or
  // hostile data can never reach the audio graph.
  const SYNTH_WAVES = ["sine", "square", "sawtooth", "triangle"];
  const SYNTH_FILTERS = ["lowpass", "highpass", "bandpass"];
  const SYNTH_RANGES = {
    attack: [0.001, 2], decay: [0.02, 3], sustain: [0, 1], release: [0, 3], cutoff: [120, 12000], detune: [0, 40], vibrato: [0, 60],
    res: [0.1, 18], vrate: [0.5, 12], sub: [0, 1], noise: [0, 1], drive: [0, 1], tremolo: [0, 1], trate: [0.5, 14], fm: [0, 1], fmratio: [0.5, 8],
    sweep: [-1, 1], unison: [1, 7],
  };
  function cleanSynth(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const out = {};
    if (SYNTH_WAVES.includes(raw.wave)) out.wave = raw.wave;
    if (SYNTH_FILTERS.includes(raw.ftype)) out.ftype = raw.ftype;
    Object.keys(SYNTH_RANGES).forEach((key) => {
      const n = Number(raw[key]);
      if (raw[key] === undefined || raw[key] === null || raw[key] === "" || !Number.isFinite(n)) return;
      const [lo, hi] = SYNTH_RANGES[key];
      const clamped = Math.max(lo, Math.min(hi, n));
      out[key] = key === "unison" ? Math.round(clamped) : Math.round(clamped * 1000) / 1000;
    });
    return Object.keys(out).length ? out : null;
  }
  // A named voice with a track's tweaks laid over it.
  function shapedVoice(voiceName, synth) {
    const base = MELODY_VOICES[voiceName];
    const t = cleanSynth(synth);
    if (!t) return base;
    const v = Object.assign({}, base);
    if (t.wave) v.wave = t.wave;
    ["attack", "decay", "sustain", "release", "detune"].forEach((key) => { if (t[key] !== undefined) v[key] = t[key]; });
    if (t.ftype) v.ftype = t.ftype;
    if (t.cutoff !== undefined) {
      if (v.cutoffEnd && v.cutoff) v.cutoffEnd = Math.max(80, (v.cutoffEnd * t.cutoff) / v.cutoff);
      v.cutoff = t.cutoff;
    }
    if (t.res !== undefined) v.q = t.res;
    if ((t.res !== undefined || t.ftype) && !v.cutoff) v.cutoff = (t.ftype || "lowpass") === "lowpass" ? 12000 : 1200;
    if (t.sweep !== undefined) {
      if (t.sweep === 0) delete v.cutoffEnd;
      else {
        if (!v.cutoff) v.cutoff = 6000;
        v.cutoffEnd = Math.max(80, Math.min(16000, v.cutoff * Math.pow(2, -t.sweep * 4)));
        v.filterTime = v.filterTime || v.decay;
      }
    }
    if (t.vibrato !== undefined || t.vrate !== undefined) {
      const cents = t.vibrato !== undefined ? t.vibrato : base.vibrato ? base.vibrato.cents : 0;
      const rate = t.vrate !== undefined ? t.vrate : (base.vibrato && base.vibrato.rate) || 5.5;
      v.vibrato = cents > 0 ? { cents, rate, delay: base.vibrato ? base.vibrato.delay : 0.18 } : undefined;
    }
    if (t.sub !== undefined) v.sub = t.sub > 0 ? t.sub : undefined;
    if (t.noise !== undefined) v.noise = t.noise > 0 ? t.noise : undefined;
    if (t.drive !== undefined) v.drive = t.drive > 0 ? t.drive : undefined;
    if (t.tremolo !== undefined || t.trate !== undefined) {
      const depth = t.tremolo !== undefined ? t.tremolo : base.tremolo ? base.tremolo.depth : 0;
      const rate = t.trate !== undefined ? t.trate : (base.tremolo && base.tremolo.rate) || 5;
      v.tremolo = depth > 0 ? { depth, rate } : undefined;
    }
    if (t.fm !== undefined || t.fmratio !== undefined) {
      const depth = t.fm !== undefined ? t.fm : base.fm ? base.fm.depth : 0;
      const ratio = t.fmratio !== undefined ? t.fmratio : (base.fm && base.fm.ratio) || 1;
      v.fm = depth > 0 ? { depth, ratio } : undefined;
    }
    if (t.unison !== undefined) v.unison = t.unison;
    return v;
  }

  // Returns { release(at), bend(cents) } for a note played live (held until released, up to 30 s, and bent by the pitch wheel); a note
  // scheduled in a song ignores it. `live` only changes the length: the sound is built exactly as before.
  function playVoicedNote(ctx, time, freq, voiceName, duration, synth, random = Math.random, live = false) {
    const v = shapedVoice(voiceName, synth);
    const end = time + (live ? 30 : duration);
    const tracked = []; // everything that has to stop when a held note is let go
    const pitched = []; // the oscillators that carry the note's pitch, with their ratio to it, for bending
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
      filter.type = v.ftype || "lowpass";
      filter.Q.value = v.q || 1;
      filter.frequency.setValueAtTime(v.cutoff, time);
      if (v.cutoffEnd) filter.frequency.exponentialRampToValueAtTime(v.cutoffEnd, time + (v.filterTime || v.decay));
      filter.connect(envelope);
      tone = filter;
      if (v.wobble) {
        const wob = ctx.createOscillator();
        const wobDepth = ctx.createGain();
        wob.frequency.value = v.wobble.rate;
        wobDepth.gain.value = v.wobble.cents;
        wob.connect(wobDepth).connect(filter.detune);
        wob.start(time);
        wob.stop(stopAt);
        tracked.push(wob);
      }
    }
    if (v.drive) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = driveCurve(v.drive);
      shaper.connect(tone);
      tone = shaper;
    }
    if (v.tremolo) {
      const trem = ctx.createGain();
      trem.gain.value = 1 - v.tremolo.depth / 2;
      const lfo = ctx.createOscillator();
      const lfoDepth = ctx.createGain();
      lfo.frequency.value = v.tremolo.rate;
      lfoDepth.gain.value = v.tremolo.depth / 2;
      lfo.connect(lfoDepth).connect(trem.gain);
      lfo.start(time);
      lfo.stop(stopAt);
      tracked.push(lfo);
      envelope.connect(trem).connect(voiceOut(ctx));
    } else envelope.connect(voiceOut(ctx));
    const oscillator = (type, hz, level, cents) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz;
      if (v.slide) {
        osc.detune.setValueAtTime((cents || 0) + v.slide.cents, time);
        osc.detune.linearRampToValueAtTime(cents || 0, time + v.slide.time);
      } else if (cents) osc.detune.value = cents;
      const mix = ctx.createGain();
      mix.gain.value = level;
      osc.connect(mix).connect(tone);
      osc.start(time);
      osc.stop(stopAt);
      tracked.push(osc);
      pitched.push({ osc, ratio: hz / freq });
      return osc;
    };
    const voices = [];
    if (v.unison) {
      // n oscillators spread evenly across +/- detune cents
      const n = v.unison;
      for (let i = 0; i < n; i++) {
        const pos = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
        voices.push(oscillator(v.wave, freq, n > 1 ? 0.9 / Math.sqrt(n) : 1, pos * (v.detune || 0)));
      }
    } else {
      const twin = v.detune ? 0.5 : 1;
      voices.push(oscillator(v.wave, freq, twin));
      if (v.detune) voices.push(oscillator(v.wave, freq, twin, v.detune), oscillator(v.wave, freq, twin * 0.6, -v.detune));
    }
    if (v.sub) oscillator("sine", freq / 2, v.sub);
    if (v.partial) oscillator("sine", freq * v.partial.ratio, v.partial.level);
    if (v.noise) {
      const hiss = ctx.createBufferSource();
      hiss.buffer = noiseBuffer(ctx, Math.max(0.05, stopAt - time), random);
      const hissLevel = ctx.createGain();
      hissLevel.gain.value = v.noise * 0.7;
      hiss.connect(hissLevel).connect(tone);
      hiss.start(time);
      tracked.push(hiss);
    }
    if (v.fm) {
      // a sine modulator at a multiple of the note bends every oscillator's pitch; its depth falls away as the note decays, which is what gives
      // electric pianos and bells their bright start
      const mod = ctx.createOscillator();
      const modDepth = ctx.createGain();
      const deviation = freq * v.fm.ratio * v.fm.depth * 6;
      mod.frequency.value = freq * v.fm.ratio;
      modDepth.gain.setValueAtTime(deviation, time);
      modDepth.gain.exponentialRampToValueAtTime(Math.max(0.001, deviation * 0.15), attackEnd + v.decay);
      mod.connect(modDepth);
      voices.forEach((o) => modDepth.connect(o.frequency));
      mod.start(time);
      mod.stop(stopAt);
      tracked.push(mod);
    }
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
      tracked.push(lfo);
    }
    return {
      // Let go of a held note: a voice with a sustain fades over its release; a struck voice (pluck, bell, piano) rings out by itself.
      release(at) {
        if (v.sustain <= 0) return;
        const t = Math.max(Number(at) || 0, ctx.currentTime);
        try {
          if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
          else {
            g.cancelScheduledValues(t);
            g.setValueAtTime(Math.max(0.0001, g.value), t);
          }
          const fade = Math.max(0.06, v.release);
          g.exponentialRampToValueAtTime(0.0001, t + fade);
          tracked.forEach((o) => { try { o.stop(t + fade + 0.03); } catch (e) { /* already stopped */ } });
        } catch (e) { /* the note has already ended */ }
      },
      bend(cents) {
        const k = Math.pow(2, (Number(cents) || 0) / 1200);
        pitched.forEach((p) => { try { p.osc.frequency.setTargetAtTime(freq * p.ratio * k, ctx.currentTime, 0.015); } catch (e) { /* ended */ } });
      },
    };
  }

  // A plain waveform note held while a key is down (a song with no named voice): a short attack, a steady level, a quick release.
  function playLiveWave(ctx, freq, waveform) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = waveform;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.012);
    osc.connect(gain).connect(voiceOut(ctx));
    osc.start(now);
    osc.stop(now + 30);
    return {
      release(at) {
        const t = Math.max(Number(at) || 0, ctx.currentTime);
        try {
          if (gain.gain.cancelAndHoldAtTime) gain.gain.cancelAndHoldAtTime(t);
          else {
            gain.gain.cancelScheduledValues(t);
            gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
          }
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
          osc.stop(t + 0.12);
        } catch (e) { /* ended */ }
      },
      bend(cents) {
        try { osc.frequency.setTargetAtTime(freq * Math.pow(2, (Number(cents) || 0) / 1200), ctx.currentTime, 0.015); } catch (e) { /* ended */ }
      },
    };
  }

  // The name of the voice a song's melody uses, or "" for the plain waveform note (an unknown name is "" too, so stale data stays safe).
  function melodyVoiceOf(songData) {
    const name = songData && songData.melody && songData.melody.voice;
    return typeof name === "string" && Object.prototype.hasOwnProperty.call(MELODY_VOICES, name) ? name : "";
  }

  // ---------- Melodic parts: bass, chords, lead ----------
  // Three more melodic parts besides the melody, each songData[key] = { notes, ties, voice, volume, muted, hidden } shaped like
  // songData.melody but over a two-octave roll of its own (BASS C1 to B2, CHORDS C3 to B4, LEAD C4 to B5, highest note first). Its sound
  // is a named voice, a default per part unless the song picked another. A song without a part plays exactly as it always did.
  const PART_KEYS = ["bass", "chords", "lead"];
  const PART_OCTAVES = { bass: [1, 2], chords: [3, 4], lead: [4, 5] };
  const PART_VOICES = { bass: "bass", chords: "pad", lead: "lead" };
  const PART_NOTES = {};
  PART_KEYS.forEach((key) => {
    PART_NOTES[key] = [];
    for (let octave = PART_OCTAVES[key][1]; octave >= PART_OCTAVES[key][0]; octave--) {
      for (let i = 11; i >= 0; i--) PART_NOTES[key].push(NOTE_NAMES[i] + octave);
    }
  });
  const BASS_NOTES = PART_NOTES.bass;
  function partVoiceOf(songData, key) {
    const name = songData && songData[key] && songData[key].voice;
    return typeof name === "string" && Object.prototype.hasOwnProperty.call(MELODY_VOICES, name) ? name : PART_VOICES[key];
  }
  function isPartMuted(songData, key) {
    return Boolean(songData[key] && songData[key].muted === true);
  }
  const bassVoiceOf = (songData) => partVoiceOf(songData, "bass");
  const isBassMuted = (songData) => isPartMuted(songData, "bass");

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

  // A muted drum track is silent everywhere the engine plays the song (playback,
  // exports, the peak scan); "hidden" is editor-only and is
  // deliberately not consulted here.
  function isTrackMuted(songData, track) {
    return Boolean(songData.trackMeta && songData.trackMeta[track] && songData.trackMeta[track].muted === true);
  }
  function isMelodyMuted(songData) {
    return Boolean(songData.melody && songData.melody.muted === true);
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
  // `part` is "melody" (the default), "bass", "chords" or "lead".
  function isTiedContinuation(songData, note, step, part = "melody") {
    const voice = songData[part];
    const ties = voice && voice.ties && voice.ties[note];
    const row = voice && voice.notes && voice.notes[note];
    return Boolean(step > 0 && ties && row && ties[step] === true && row[step] && row[step - 1]);
  }
  // How many steps the note struck on `step` is held for (1 when it is not tied to anything after it).
  function heldSteps(songData, note, step, part = "melody") {
    let length = 1;
    while (step + length < STEPS && isTiedContinuation(songData, note, step + length, part)) length++;
    return length;
  }

  // ---------- Patterns and the song order ----------
  // A song is one pattern (drum hits, melody notes and held notes over 16 steps) unless it was given more, up to four named A to D, plus
  // a song order (songData.chain) of up to 32 of them to play one after another. The pattern being edited lives in the song's own tracks
  // and melody.notes/ties, exactly as it always has; songData.editing names it (absent means "A") and songData.patterns holds each other
  // pattern as { tracks, notes, ties }. Everything else (mix, instrument, scale, tempo, echo...) is shared by every pattern. A song with
  // no patterns, chain or editing is the one-pattern song it always was and takes the original code path everywhere.
  const PATTERN_NAMES = "ABCDEFGHIJKLMNOP".split("");
  const MAX_BARS = 64;
  const MAX_CHAIN = MAX_BARS;
  // Each of the five Studio tracks can play its own run of patterns (a "lane"): songData.lanes[track] = { order: ["A", "B"], loop: false }.
  // A lane shorter than the song loops until the song ends unless its loop is off; a track with no lane follows the song order. A song
  // with no lanes and no bar count is the song it always was.
  const LANE_KEYS = ["drums", "bass", "chords", "melody", "lead"];
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  function isSinglePattern(songData) {
    return !songData.patterns && !songData.chain && !songData.editing && !songData.lanes && !songData.bars;
  }
  function editingName(songData) {
    return PATTERN_NAMES.includes(songData.editing) ? songData.editing : "A";
  }
  // One pattern's parts, or null when the song has no such pattern. A pattern carries a part ({ notes, ties }, as "bass", "chords" or "lead")
  // only when the song has that part.
  function patternData(songData, name) {
    if (!PATTERN_NAMES.includes(name)) return null;
    if (name === editingName(songData)) {
      const melody = isObj(songData.melody) ? songData.melody : {};
      const open = { tracks: isObj(songData.tracks) ? songData.tracks : {}, notes: isObj(melody.notes) ? melody.notes : {}, ties: isObj(melody.ties) ? melody.ties : {} };
      PART_KEYS.forEach((key) => {
        if (isObj(songData[key])) open[key] = { notes: isObj(songData[key].notes) ? songData[key].notes : {}, ties: isObj(songData[key].ties) ? songData[key].ties : {} };
      });
      return open;
    }
    const other = isObj(songData.patterns) && Object.prototype.hasOwnProperty.call(songData.patterns, name) ? songData.patterns[name] : null;
    if (!isObj(other)) return null;
    const stored = { tracks: isObj(other.tracks) ? other.tracks : {}, notes: isObj(other.notes) ? other.notes : {}, ties: isObj(other.ties) ? other.ties : {} };
    PART_KEYS.forEach((key) => {
      if (isObj(other[key]) || isObj(songData[key])) {
        const part = isObj(other[key]) ? other[key] : {};
        stored[key] = { notes: isObj(part.notes) ? part.notes : {}, ties: isObj(part.ties) ? part.ties : {} };
      }
    });
    return stored;
  }
  // The patterns the song has, in the order A to D.
  function patternNames(songData) {
    return PATTERN_NAMES.filter((name) => patternData(songData, name));
  }
  // What plays, in order: the song order with any pattern the song no longer has dropped (and cut to 32); with no usable order, just the
  // first pattern the song has.
  function chainOf(songData) {
    const names = patternNames(songData);
    const wanted = (Array.isArray(songData.chain) ? songData.chain : []).filter((name) => names.includes(name)).slice(0, MAX_CHAIN);
    return wanted.length ? wanted : names.slice(0, 1);
  }
  function hasLanes(songData) {
    return isObj(songData.lanes) && LANE_KEYS.some((key) => isObj(songData.lanes[key]));
  }
  // The patterns one track plays, in order: its lane (pattern letters the song no longer has dropped), or the song order when it has none.
  function laneOrder(songData, key) {
    if (!hasLanes(songData) || !isObj(songData.lanes[key])) return chainOf(songData);
    const names = patternNames(songData);
    const order = Array.isArray(songData.lanes[key].order) ? songData.lanes[key].order : [];
    return order.filter((name) => names.includes(name)).slice(0, MAX_BARS);
  }
  function laneLoops(songData, key) {
    return !(hasLanes(songData) && isObj(songData.lanes[key]) && songData.lanes[key].loop === false);
  }
  // The pattern a track plays in bar `bar` (0 is the first), or null when it is silent there (an empty lane, or a lane that does not loop
  // and has ended).
  function patternAtBar(songData, key, bar) {
    const order = laneOrder(songData, key);
    if (!order.length) return null;
    if (laneLoops(songData, key)) return order[bar % order.length];
    return bar < order.length ? order[bar] : null;
  }
  // How many bars the song is: the number it was given, else as many as its longest run of patterns.
  function songBars(songData) {
    if (Number.isInteger(songData.bars) && songData.bars >= 1) return Math.min(MAX_BARS, songData.bars);
    let bars = chainOf(songData).length;
    if (hasLanes(songData)) LANE_KEYS.forEach((key) => { if (isObj(songData.lanes[key])) bars = Math.max(bars, laneOrder(songData, key).length); });
    return Math.min(MAX_BARS, Math.max(1, bars));
  }
  function chainSteps(songData) {
    return songBars(songData) * STEPS;
  }
  // The song as scheduleStep reads it while pattern `name` is playing: the same song with that pattern's parts in the usual places.
  function viewOf(songData, name) {
    if (isSinglePattern(songData) || name === editingName(songData)) return songData;
    const part = patternData(songData, name);
    if (!part) return songData;
    const view = Object.assign({}, songData, { tracks: part.tracks, melody: Object.assign({}, isObj(songData.melody) ? songData.melody : {}, { notes: part.notes, ties: part.ties }) });
    PART_KEYS.forEach((key) => {
      if (part[key]) view[key] = Object.assign({}, isObj(songData[key]) ? songData[key] : {}, { notes: part[key].notes, ties: part[key].ties });
    });
    return view;
  }
  // The song as it sounds in bar `bar`: each track's own pattern from its lane, or the song order's pattern for all of them when the song
  // has no lanes (then it is exactly viewOf).
  function barView(songData, bar) {
    if (!hasLanes(songData)) {
      const chain = chainOf(songData);
      return viewOf(songData, chain[bar % chain.length]);
    }
    const pick = (key) => {
      const name = patternAtBar(songData, key, bar);
      return name ? patternData(songData, name) : null;
    };
    const view = Object.assign({}, songData);
    const drums = pick("drums");
    view.tracks = drums ? drums.tracks : {};
    const melody = pick("melody");
    view.melody = Object.assign({}, isObj(songData.melody) ? songData.melody : {}, { notes: melody ? melody.notes : {}, ties: melody ? melody.ties : {} });
    PART_KEYS.forEach((key) => {
      if (!isObj(songData[key])) return;
      const part = pick(key);
      view[key] = Object.assign({}, songData[key], { notes: part && part[key] ? part[key].notes : {}, ties: part && part[key] ? part[key].ties : {} });
    });
    return view;
  }
  // The song's bars resolved to their parts, for exports that do not play the song (MIDI).
  function chainPatterns(songData) {
    const bars = [];
    for (let bar = 0; bar < songBars(songData); bar++) {
      const view = barView(songData, bar);
      const chain = chainOf(songData);
      const out = { name: chain[bar % chain.length], tracks: isObj(view.tracks) ? view.tracks : {}, notes: isObj(view.melody.notes) ? view.melody.notes : {}, ties: isObj(view.melody.ties) ? view.melody.ties : {} };
      PART_KEYS.forEach((key) => { if (isObj(view[key])) out[key] = { notes: isObj(view[key].notes) ? view[key].notes : {}, ties: isObj(view[key].ties) ? view[key].ties : {} }; });
      bars.push(out);
    }
    return bars;
  }
  // Exports repeat the whole song, so a long one gets fewer repeats than the 16 the menu offers (five minutes of audio at most).
  const MAX_EXPORT_SECONDS = 300;
  function maxExportLoops(songData) {
    const seconds = stepDurationFor(songData.tempo) * chainSteps(songData);
    return Math.max(1, Math.min(16, Math.floor(MAX_EXPORT_SECONDS / seconds)));
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
    setEcho(ctx, songData.echo, songData.tempo);
    const kit = songData.kit || "acoustic";
    const pump = pumpAmount(songData.pump);
    if (songData.tracks) {
      Object.keys(songData.tracks).sort().forEach((track) => {
        // Clamped to 0 rather than passed through raw -- a negative jitter
        // draw on step 0 of an OfflineAudioContext render (renderWaveformPeaks
        // schedules step 0 at real time 0, unlike live playback which always
        // starts comfortably ahead of ctx.currentTime) would otherwise hand
        // AudioBufferSourceNode/OscillatorNode.start() a negative time, which
        // throws a RangeError and kills the whole render -- a critic pass
        // caught this live (a silently broken peak scan).
        if (songData.tracks[track][step] && PLAYERS[track] && !isTrackMuted(songData, track)) {
          const hitTime = Math.max(0, time + humanizeJitter(songData, random));
          withVolume(ctx, volumeOf(songData.trackMeta && songData.trackMeta[track]) * stepLevel(songData.tracks[track][step]), () => PLAYERS[track](ctx, hitTime, kit, random, drumShape(songData.trackMeta && songData.trackMeta[track])));
          if (pump && track === "kick") duckMusic(ctx, hitTime, pump, songData.tempo);
        }
      });
    }
    withMusicBus(ctx, pump, () => scheduleMusic(ctx, songData, step, time, random));
  }

  // The melody and the other melodic parts of one step (split out of scheduleStep so Pump can route them through the music bus).
  function scheduleMusic(ctx, songData, step, time, random) {
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
            voice ? playVoicedNote(ctx, noteTime, noteToFreq(note), voice, length, songData.melody.synth, random) : playMelodyNote(ctx, noteTime, noteToFreq(note), waveform, length));
        }
      });
    }
    PART_KEYS.forEach((key) => {
      if (!(isObj(songData[key]) && isObj(songData[key].notes)) || isPartMuted(songData, key)) return;
      const voice = partVoiceOf(songData, key);
      const duration = stepDurationFor(songData.tempo);
      Object.keys(songData[key].notes).sort().forEach((note) => {
        const lane = songData[key].notes[note];
        if (Array.isArray(lane) && lane[step] && !isTiedContinuation(songData, note, step, key)) {
          const noteTime = Math.max(0, time + humanizeJitter(songData, random));
          const length = duration * heldSteps(songData, note, step, key);
          withVolume(ctx, volumeOf(songData[key]) * stepLevel(lane[step]), () => playVoicedNote(ctx, noteTime, noteToFreq(note), voice, length, songData[key].synth, random));
        }
      });
    });
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

  // A tiny seeded PRNG gives the offline render repeatable noise without
  // changing the live drums' per-hit randomness. Seed from musical content
  // only; settings that are not music must not change the sound.
  function seedPart(songData) {
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
    const seed = { tracks, melody };
    // A bass line, chords or lead feed the seed only once they have a note, so a song without them seeds exactly as it always did.
    PART_KEYS.forEach((part) => {
      if (!(isObj(songData[part]) && isObj(songData[part].notes))) return;
      const partNotes = songData[part].notes;
      const used = Object.keys(partNotes).sort().filter((key) => Array.isArray(partNotes[key]) && partNotes[key].some(Boolean));
      if (used.length) seed[part] = { voice: partVoiceOf(songData, part), notes: used.map((key) => [key, partNotes[key], isObj(songData[part].ties) ? songData[part].ties[key] || null : null]) };
    });
    return seed;
  }
  function previewRandom(songData) {
    // A one-pattern song seeds from exactly what it always did. A song with several seeds from every pattern and the song order, taken
    // the same way whichever pattern happens to be open for editing, so the same music always gets the same noise.
    const input = JSON.stringify(
      isSinglePattern(songData)
        ? Object.assign({ tempo: songData.tempo || 120, kit: songData.kit || "acoustic" }, seedPart(songData))
        : { tempo: songData.tempo || 120, kit: songData.kit || "acoustic", chain: chainOf(songData), patterns: patternNames(songData).map((name) => [name, seedPart(viewOf(songData, name))]) }
    );
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
  // recording into the builder's grid while playing). onStep(step,
  // time), optional: called once per scheduled step for any UI sync
  // (highlighting a cell).
  // `songData` is read fresh each step, so a caller can edit it while it plays. onStep(step, time, info) also gets
  // info = { pattern, chainIndex, chainLength, data }: which pattern is sounding, where it sits in the song order, and the song as that
  // pattern plays it.
  function createPlayer(getAudioCtx, songData, onStep) {
    let playing = false;
    let currentStep = 0;
    let chainIndex = 0;
    let playingPattern = "A";
    let playingLanes = {};
    let loopName = "";
    let nextStepTime = 0;
    let timer = null;

    function loop() {
      const ctx = getAudioCtx();
      while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
        let name;
        let length = 1;
        let view;
        let lanes = {};
        if (isSinglePattern(songData)) {
          name = "A";
          view = viewOf(songData, name);
        } else if (loopName) {
          name = patternData(songData, loopName) ? loopName : editingName(songData); // a pattern removed while looping falls back to the open one
          view = viewOf(songData, name);
        } else {
          const chain = chainOf(songData);
          length = songBars(songData);
          if (chainIndex >= length) chainIndex = 0; // the song was shortened while playing
          name = chain[chainIndex % chain.length];
          view = barView(songData, chainIndex);
          LANE_KEYS.forEach((key) => { lanes[key] = patternAtBar(songData, key, chainIndex); });
        }
        playingPattern = name;
        playingLanes = lanes;
        scheduleStep(ctx, view, currentStep, nextStepTime);
        if (onStep) onStep(currentStep, nextStepTime + swingDelay(songData, currentStep), { pattern: name, patterns: lanes, chainIndex, chainLength: length, data: view }); // the time the step actually sounds
        if (!isSinglePattern(songData) && !loopName) length = songBars(songData); // the editor may have lengthened the song while recording
        nextStepTime += stepDurationFor(songData.tempo);
        currentStep = (currentStep + 1) % STEPS;
        if (currentStep === 0 && length > 1) chainIndex = (chainIndex + 1) % length;
      }
      timer = setTimeout(loop, LOOKAHEAD_MS);
    }

    return {
      // atTime (optional, AudioContext seconds): begin on that moment of the audio clock instead of "now",
      // so a caller that has already scheduled something before the song (a count-in) can land exactly on it.
      // options.pattern (optional): loop just that pattern instead of playing the song order.
      // options.step and options.chainIndex (optional): carry on from there instead of the top (a paused song resumes where it stopped).
      start(atTime, options) {
        if (playing) return;
        playing = true;
        currentStep = options && Number.isInteger(options.step) && options.step >= 0 && options.step < STEPS ? options.step : 0;
        chainIndex = options && Number.isInteger(options.chainIndex) && options.chainIndex >= 0 ? options.chainIndex : 0;
        loopName = options && typeof options.pattern === "string" ? options.pattern : "";
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
      currentPattern: () => playingPattern,
      // The pattern one track is playing now (null when it is silent in this bar).
      currentPatternFor: (key) => (Object.prototype.hasOwnProperty.call(playingLanes, key) ? playingLanes[key] : playingPattern),
      currentChainIndex: () => chainIndex,
    };
  }

  // Renders one full loop through an OfflineAudioContext and downsamples
  // the result into min/max peak pairs — a real waveform derived from the
  // actual synthesized audio, not a decorative fake. Async because
  // offline rendering happens off the main thread. The builder uses it
  // to find a song's real peak level (Normalize to peak).
  async function renderWaveformPeaks(songData, peakCount) {
    const stepDur = stepDurationFor(songData.tempo);
    // The whole song order, one pattern after another (a one-pattern song is one loop, as ever).
    const bars = songBars(songData);
    const duration = stepDur * STEPS * bars;
    const sampleRate = 44100;
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OfflineCtx(1, Math.ceil(sampleRate * duration), sampleRate);
    ctx.__measure = true; // this render measures the song's own level, so it skips the output limiter (see getOutput)
    // The render is at full volume regardless of the song's master_volume,
    // so the peak it finds is the song's own, not the slider's.
    // It ignores humanize and uses a content-seeded noise stream:
    // repeated renders of the same song therefore give the same peaks,
    // while normal playback keeps fresh noise on each hit.
    // The same goes for Space and Echo: a reverb tail or repeats would smear the pattern.
    const previewData =
      songData.master_volume === 1 && !songData.humanize && !songData.space && !songData.echo
        ? songData
        : Object.assign({}, songData, { master_volume: 1, humanize: 0, space: 0, echo: 0 });
    const random = previewRandom(previewData);
    for (let bar = 0; bar < bars; bar++) {
      const view = barView(previewData, bar);
      for (let step = 0; step < STEPS; step++) scheduleStep(ctx, view, step, (bar * STEPS + step) * stepDur, random);
    }
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
      // Rounded to 4 decimal places: far more precision than a peak level needs.
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
    const bars = songBars(songData);
    const totalSteps = STEPS * bars;
    const loops = Math.min(maxExportLoops(songData), Math.max(1, Math.min(16, Math.round(Number(options.loops)) || 1)));
    const tail = Math.max(0, Math.min(10, Number(options.tailSeconds) || 0));
    const loopSamples = Math.max(1, Math.round(stepDurationFor(songData.tempo) * totalSteps * sampleRate));
    const tailSamples = Math.round(tail * sampleRate);
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OfflineCtx(1, loopSamples * 2 + tailSamples, sampleRate);
    // The master gain starts at 1 and setMasterVolume only ramps towards the
    // song's volume over 30 ms, which would leave the first moments too loud;
    // start it at the right level so the whole render is at the song's volume.
    getMasterGain(ctx).gain.value = Number.isFinite(songData.master_volume) ? Math.max(0, Math.min(1, songData.master_volume)) : 1;
    setSpace(ctx, songData.space, true);
    setEcho(ctx, songData.echo, songData.tempo, true);
    const stepSeconds = loopSamples / sampleRate / totalSteps;
    for (let pass = 0; pass < 2; pass++) {
      const random = previewRandom(songData);
      for (let bar = 0; bar < bars; bar++) {
        const view = barView(songData, bar);
        for (let step = 0; step < STEPS; step++) scheduleStep(ctx, view, step, (pass * totalSteps + bar * STEPS + step) * stepSeconds, random);
      }
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
    isBassMuted,
    bassVoiceOf,
    BASS_NOTES,
    PART_KEYS,
    PART_NOTES,
    PART_OCTAVES,
    partVoiceOf,
    isPartMuted,
    isTiedContinuation,
    heldSteps,
    swingDelay,
    stepDurationFor,
    DRUM_VOICES: Object.keys(PLAYERS),
    KITS,
    KIT_LABELS,
    DRUM_RANGES,
    drumShape,
    PATTERN_NAMES,
    MAX_CHAIN,
    isSinglePattern,
    editingName,
    patternData,
    patternNames,
    chainOf,
    LANE_KEYS,
    MAX_BARS,
    hasLanes,
    laneOrder,
    laneLoops,
    patternAtBar,
    songBars,
    barView,
    chainSteps,
    chainPatterns,
    viewOf,
    maxExportLoops,
    previewRandom,
    playMelodyNote,
    playVoicedNote,
    playLiveWave,
    cleanSynth,
    SYNTH_WAVES,
    SYNTH_FILTERS,
    VOICE_GROUPS,
    SYNTH_RANGES,
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
    setEcho,
    getPeakMeterAnalyser,
    softLimit,
  };
})();
