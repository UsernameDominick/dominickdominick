// handles the audio context and plays a note when a piano key is clicked

// audio state
let ctx;
let master;
// the volume of the whole song (the strip in the top box). Half way is the normal loudness, all the way up is twice
// that. (The VOL dial is different: it's for the selected sound, see setVolume below)
let songVolume = 0.5;

const TRACKS = 5; // how many tracks there are (studio.js uses this too, so synth.js has to load first)
const DRUM_TRACK = 0; // the first track is always the drum track (drums.js plays it, playNote hands its notes over)

// each track has its own settings: which sound it plays (a place in the SOUNDS list below) and where
// its CUT, RES, ATK, DEC, SUS and REL dials are (each 0 to 1). The filter starts wide open with no boost.
// The fade starts as a quick 20 millisecond attack, a 0.35 second decay down to half volume, and a 0.8 second release.
// The drum track starts with a fade that changes nothing (no fade in, full volume, a long release), because a drum
// already has its own fade. On the drum track the dials shape each hit on top of that (see drums.js)
// The other settings every track has (they're explained, with their dials, in fx.js): where it's panned, how much drive,
// detune, tuning, glide, the filter type and how far the fade opens the filter, the echo (how much, how long, how many
// repeats), the room, and the vibrato and the tremolo. All 0 to 1, and they start with no change to the sound.
// (the filter type is a dial that clicks between three: low pass, high pass and band pass)
const FILTER_TYPES = ["lowpass", "highpass", "bandpass"];
function filterTypeFrom(v) {
    return FILTER_TYPES[Math.min(2, Math.round(v * 2))];
}

const FX_DEFAULTS = {
    pan: 0.5, drive: 0, detune: 0, oct: 0.5, semi: 0.5, glide: 0, ftype: 0, fenv: 0,
    dly: 0, dtime: 0.25, dfb: 0.35, rev: 0, vrate: 0.4, vdep: 0, trate: 0.4, tdep: 0,
};
const DIAL_DEFAULTS = {
    synth: { attack: 0.23, decay: 0.57, sustain: 0.5, release: 0.25 },
    drums: { attack: 0, decay: 0.5, sustain: 1, release: 1 },
};
const trackSettings = Array.from({ length: TRACKS }, (_, t) => ({
    sound: 0, volume: 0.5, cutoff: 1, resonance: 0, ...FX_DEFAULTS, ...(t === DRUM_TRACK ? DIAL_DEFAULTS.drums : DIAL_DEFAULTS.synth),
}));
const trackFilters = []; // one lowpass filter for each track, made when the audio starts
const trackGains = []; // and one volume for each track, after its filter (the drum track's stays at full, each drum has its own volume)

// what a track is called on the page
const trackNames = Array.from({ length: TRACKS }, (_, t) => t === DRUM_TRACK ? "DRUMS" : "TRK " + (t + 1));
try {
    const savedNames = JSON.parse(localStorage.getItem("trackNames"));
    if (Array.isArray(savedNames)) {
        savedNames.forEach((name, t) => {
            if (typeof name === "string" && name.trim()) trackNames[t] = name.trim().slice(0, 24);
        });
    }
} catch {}

function trackName(t) {
    return trackNames[t];
}

function renameTrack(t, name) {
    trackNames[t] = name;
    try {
        localStorage.setItem("trackNames", JSON.stringify(trackNames));
    } catch {}
}
let liveTrack = 0; // the track the piano keys play and the strips show (studio.js sets it when you pick a track)

let analyser;
let scopeData; // the samples the scope draws, each one between -1 and 1

// pitch wheel and mod wheel state
const BEND_CENTS = 200; // pitch wheel all the way up or down bends 200 cents (2 semitones)
const MOD_CENTS = 100; // mod wheel all the way up makes the vibrato swing 100 cents (1 semitone) each way
const LFO_RATE = 5.5; // vibrato speed in Hz
let bend = 0; // pitch wheel position, -1 to 1
let mod = 0; // mod wheel position, 0 to 1
let bendNode; // one constant signal that every note's pitch listens to
let modDepth; // the vibrato signal (LFO), scaled by the mod wheel

// create the context and master gain the first time, only after a click
function getCtx() {
    if (!ctx) {
        ctx = new AudioContext();

        // master gain node (every note goes through this)
        master = ctx.createGain();
        master.gain.value = songVolume * 2;
        master.connect(ctx.destination); // speakers

        // what every track's sound goes through (fx.js builds it: the filters, drive, tremolo, pan, volume, echo and room)
        buildTrackChains();

        // analyser node (a side branch the scope reads from, it doesn't change the sound)
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048; // how many samples the scope sees at once
        scopeData = new Float32Array(analyser.fftSize);
        master.connect(analyser);

        // pitch bend node (a constant number in cents, plugged into every note's detune)
        bendNode = ctx.createConstantSource();
        bendNode.offset.value = bend * BEND_CENTS;
        bendNode.start();

        // vibrato: an LFO (slow oscillator) into a gain node, the mod wheel sets how much gets through
        const lfo = ctx.createOscillator();
        lfo.frequency.value = LFO_RATE;
        modDepth = ctx.createGain();
        modDepth.gain.value = mod * MOD_CENTS;
        lfo.connect(modDepth);
        lfo.start();
    }
    return ctx;
}

// the sounds you can pick for a track. Each one is a stack of oscillators (layers):
// type is the waveform, semitones moves it up or down (12 is an octave), cents tunes it a little
// (100 cents is a semitone). The layers share the volume, so every sound comes out about as loud.
const SOUNDS = [
    { name: "SAW", layers: [{ type: "sawtooth", semitones: 0, cents: 0 }] },
    { name: "SQUARE", layers: [{ type: "square", semitones: 0, cents: 0 }] },
    { name: "SINE", layers: [{ type: "sine", semitones: 0, cents: 0 }] },
    { name: "TRIANGLE", layers: [{ type: "triangle", semitones: 0, cents: 0 }] },
    {
        name: "SUPER SAW", // three saws a little out of tune with each other, so it sounds thick
        layers: [
            { type: "sawtooth", semitones: 0, cents: -14 },
            { type: "sawtooth", semitones: 0, cents: 0 },
            { type: "sawtooth", semitones: 0, cents: 14 },
        ],
    },
    {
        name: "SUB BASS", // a sine with another sine an octave under it
        layers: [
            { type: "sine", semitones: 0, cents: 0 },
            { type: "sine", semitones: -12, cents: 0 },
        ],
    },
    {
        name: "ORGAN", // sines at the note, an octave up, and an octave and a fifth up
        layers: [
            { type: "sine", semitones: 0, cents: 0 },
            { type: "sine", semitones: 12, cents: 0 },
            { type: "sine", semitones: 19, cents: 0 },
        ],
    },
    {
        name: "HOLLOW", // two squares a fifth apart
        layers: [
            { type: "square", semitones: 0, cents: 0 },
            { type: "square", semitones: 7, cents: 0 },
        ],
    },
];

// how loud a note is at its peak (the top of its fade)
const PEAK = 0.3;
// how long (in seconds) a note that has no length of its own is held for before it's let go. The song's notes only
// know where they start, so the song gives them a beat (see studio.js). Short plays, like trying a sound out, use this
const DEFAULT_GATE = 0.3;

// the fade a note follows: it rises over the ATTACK time, falls over the DECAY time to the SUSTAIN level, stays there
// for as long as the note is held, then fades out over the RELEASE time when it's let go.
// This works out how loud the note is (0 up to peak) a number of seconds after it started, if it's still being held
function envelopeLevel(seconds, env, peak = PEAK) {
    if (seconds <= env.attack) return (peak * seconds) / env.attack;
    if (seconds <= env.attack + env.decay) return peak * env.sustain ** ((seconds - env.attack) / env.decay);
    return peak * env.sustain;
}

// puts the rise and the fall to the sustain level on a volume (a gain's gain). held is how long the note is held for
// (Infinity for a key that's held until you let go), peak is how loud the top is. If it's let go before they finish,
// they stop where they've got to
function scheduleEnvelope(param, now, env, held, peak) {
    param.setValueAtTime(0, now);
    const attackEnd = Math.min(held, env.attack);
    param.linearRampToValueAtTime(envelopeLevel(attackEnd, env, peak), now + attackEnd);
    if (held > env.attack) {
        const decayEnd = Math.min(held, env.attack + env.decay);
        param.exponentialRampToValueAtTime(envelopeLevel(decayEnd, env, peak), now + decayEnd);
    }
}

// the release: it fades to silence from wherever the note was when it was let go (seconds after it started).
// Gives back the time it's all quiet, so the sound can be stopped
function scheduleRelease(param, now, seconds, env, peak) {
    param.setValueAtTime(envelopeLevel(seconds, env, peak), now + seconds);
    param.exponentialRampToValueAtTime(0.001, now + seconds + env.release);
    return now + seconds + env.release + 0.05; // just after it's gone quiet
}

// the current settings of a track as seconds and a level, the way the fade needs them
function envelopeOf(track) {
    const settings = trackSettings[track];
    return {
        attack: attackFromSlider(settings.attack),
        decay: decayFromSlider(settings.decay),
        sustain: sustainFromSlider(settings.sustain),
        release: releaseFromSlider(settings.release),
    };
}

// plays one note (when is the audio clock time to start it, it defaults to right now,
// and track is which track it's for: that track's sound, filter and fade are used).
// A note is held for gate seconds and then let go, and fades out. With hold set it's held until you let go instead:
// it gives back { release(time) }, and calling that lets it go (a key held on the piano or a MIDI keyboard)
// velocity (0 to 1) is how hard it's hit, and releaseScale is how many times longer than usual it takes to fade out
// (the settings in params.js)
function playNote(frequency, when = ctx.currentTime, track = 0, hold = false, gate = DEFAULT_GATE, velocity = 1, releaseScale = 1) {
    // the drum track doesn't use the synth: each piano key is a drum (drums.js), so hand the note over
    if (track === DRUM_TRACK) {
        const drumNote = Math.round(69 + 12 * Math.log2(frequency / 440)); // turn the frequency back into a key
        playDrumNote(drumNote, when, velocity, releaseScale);
        document.dispatchEvent(new CustomEvent("notescheduled", { detail: { note: drumNote, time: when, track } }));
        return hold ? { release() {} } : undefined; // a drum hit is over by itself, there's nothing to hold
    }

    const settings = trackSettings[track];
    const layers = SOUNDS[settings.sound].layers;
    const env = envelopeOf(track);
    env.release *= releaseScale;
    const peak = PEAK * velocity; // how loud the top of the fade is
    const noteNumber = Math.round(69 + 12 * Math.log2(frequency / 440)); // the key it is, before the track tunes it

    // OCT and SEMI tune the whole track, and GLIDE slides to the note from the one the track played before it
    const tuned = frequency * 2 ** ((octFrom(settings.oct) * 12 + semiFrom(settings.semi)) / 12);
    const glideTime = glideSeconds(settings.glide);
    const slidingFrom = glideTime > 0 && lastFrequency[track] > 0 ? lastFrequency[track] : tuned;
    lastFrequency[track] = tuned;

    // gain node (this shapes the volume of the whole note, all its layers together)
    const gain = ctx.createGain();
    gain.gain.value = 0;

    // the note's own filter: its type is the FILTER TYPE, its cutoff and resonance follow the CUT and RES dials (through
    // the control signals the track has), and FENV opens it with the fade. Then the track's bus, and the rest of the chain
    const filter = ctx.createBiquadFilter();
    filter.type = filterTypeFrom(settings.ftype);
    filter.frequency.value = FILTER_BASE;
    cutCtl[track].connect(filter.detune);
    if (filter.type === "bandpass") {
        filter.Q.value = 0.7 + resonanceFromSlider(settings.resonance);
    } else {
        filter.Q.value = 0;
        resCtl[track].connect(filter.Q);
    }
    activeFilters[track].add(filter);
    gain.connect(filter);
    filter.connect(trackBus[track]);

    // shape the volume with the envelope: attack, then decay. And the release, once the note is let go
    const now = when;
    const param = gain.gain;
    const held = hold ? Infinity : gate;
    scheduleEnvelope(param, now, env, held, peak);
    const octs = fenvOctaves(settings.fenv);
    if (octs > 0) scheduleFilterEnvelope(filter.frequency, now, env, held, octs);

    function fadeOut(seconds) {
        const end = scheduleRelease(param, now, seconds, env, peak);
        if (octs > 0) {
            filter.frequency.setValueAtTime(FILTER_BASE * 2 ** (octs * envelopeLevel(seconds, env, 1)), now + seconds);
            filter.frequency.exponentialRampToValueAtTime(FILTER_BASE, now + seconds + env.release);
        }
        oscillators.forEach((osc) => osc.stop(end)); // stop just after it's gone quiet
    }

    // the voices: one for each layer of the sound, or three of each, spread apart, if DETUNE is up
    const spread = detuneCents(settings.detune);
    const offsets = spread > 0.5 ? [-spread, 0, spread] : [0];
    const oscillators = [];
    let alive = 0;
    layers.forEach((layer) => {
        offsets.forEach((offset) => {
            const osc = ctx.createOscillator();
            osc.type = layer.type;
            const layerPitch = 2 ** (layer.semitones / 12);
            osc.frequency.setValueAtTime(slidingFrom * layerPitch, now);
            if (slidingFrom !== tuned) osc.frequency.exponentialRampToValueAtTime(tuned * layerPitch, now + glideTime);
            osc.detune.value = layer.cents + offset;

            // each voice gets an equal share of the volume
            const share = ctx.createGain();
            share.gain.value = 1 / (layers.length * offsets.length);
            osc.connect(share);
            share.connect(gain);

            // pitch wheel, mod wheel vibrato and the track's vibrato all feed this oscillator's detune (they add together
            // with its own tuning)
            bendNode.connect(osc.detune);
            modDepth.connect(osc.detune);
            vibGain[track].connect(osc.detune);

            osc.start(now);
            oscillators.push(osc);
            alive++;

            // once it's done, unplug the wheels from it, and when the last one is done, the filter's controls
            osc.addEventListener("ended", () => {
                bendNode.disconnect(osc.detune);
                modDepth.disconnect(osc.detune);
                vibGain[track].disconnect(osc.detune);
                alive--;
                if (alive === 0) {
                    cutCtl[track].disconnect(filter.detune);
                    if (filter.type !== "bandpass") resCtl[track].disconnect(filter.Q);
                    activeFilters[track].delete(filter);
                }
            });
        });
    });

    // tell the rest of the page a note is going to start, and when (leds.js flashes the LED over its key at that moment)
    document.dispatchEvent(new CustomEvent("notescheduled", { detail: { note: noteNumber, time: now, track } }));

    if (!hold) {
        fadeOut(gate);
        return;
    }
    let released = false;
    return {
        // lets go of the note: it fades out over the track's release time, then stops
        release(time = ctx.currentTime) {
            if (released) return;
            released = true;
            const seconds = Math.max(0, time - now);
            // stop the attack and decay where they've got to (cancelAndHoldAtTime keeps the value at that moment)
            if (param.cancelAndHoldAtTime) {
                param.cancelAndHoldAtTime(now + seconds);
                if (octs > 0) filter.frequency.cancelAndHoldAtTime(now + seconds);
            } else {
                param.cancelScheduledValues(now + seconds);
                if (octs > 0) filter.frequency.cancelScheduledValues(now + seconds);
            }
            fadeOut(seconds);
        },
    };
}

// changes the volume of the selected sound: the selected track's, or on the drum track the drum you last played.
// (It's the sound the sound picker is showing)
function setVolume(v) {
    v = Math.min(1, Math.max(0, v)); // keep it between 0 and 1
    if (liveTrack === DRUM_TRACK) {
        setDrumVolume(selectedDrumNote, v);
        return;
    }
    trackSettings[liveTrack].volume = v;
    // setTargetAtTime glides to the new value so you don't hear a click
    trackGains[liveTrack].gain.setTargetAtTime(v, ctx.currentTime, 0.015);
}

// changes the volume of the whole song (v is the strip position, 0 to 1)
function setSongVolume(v) {
    songVolume = Math.min(1, Math.max(0, v));
    master.gain.setTargetAtTime(songVolume * 2, ctx.currentTime, 0.015);
}

// where the VOL dial is for the selected sound
function selectedVolume() {
    return liveTrack === DRUM_TRACK ? drumVolumeAt(selectedDrumNote) : trackSettings[liveTrack].volume;
}

// what each small strip means (they all run from 0 to 1)
function cutoffFromSlider(v) {
    return 80 * 200 ** v; // 80Hz up to 16000Hz, in even musical steps
}

function resonanceFromSlider(v) {
    return v * 12; // in dB: 0 is no boost, 12 rings a lot (a lowpass filter's Q is measured in dB)
}

function releaseFromSlider(v) {
    return 0.05 + v * 2.95; // 0.05 to 3 seconds
}

function attackFromSlider(v) {
    return 0.005 * 400 ** v; // 5 milliseconds up to 2 seconds, in even steps (so the short ones are easy to set)
}

function decayFromSlider(v) {
    return 0.02 * 150 ** v; // 20 milliseconds up to 3 seconds
}

function sustainFromSlider(v) {
    return Math.max(0.01, v); // how loud it stays while held, compared to the peak (never fully silent, the fade curves need a number above 0)
}

// turns a time in seconds into the short text a dial shows ("20ms", "0.8s")
function formatSeconds(seconds) {
    return seconds < 1 ? Math.round(seconds * 1000) + "ms" : seconds.toFixed(1) + "s";
}

// the three functions below change the selected track (liveTrack), not every track.
// changes where its filter cuts off (v is the strip position, 0 to 1)
function setCutoff(v) {
    trackSettings[liveTrack].cutoff = v;
    applyFilter(liveTrack);
    drawGraphs();
}

// changes how much the filter boosts around the cutoff (v is the strip position, 0 to 1)
function setResonance(v) {
    trackSettings[liveTrack].resonance = v;
    applyFilter(liveTrack);
    drawGraphs();
}

// changes how long notes take to fade out (v is the strip position, 0 to 1)
// it applies to the next note you play
function setRelease(v) {
    trackSettings[liveTrack].release = v;
    drawGraphs();
}

// the same for the attack (how long a note takes to rise), the decay (how long it takes to fall to the sustain
// level) and the sustain (how loud it stays while it's held). They apply to the next note you play
function setAttack(v) {
    trackSettings[liveTrack].attack = v;
    drawGraphs();
}

function setDecay(v) {
    trackSettings[liveTrack].decay = v;
    drawGraphs();
}

function setSustain(v) {
    trackSettings[liveTrack].sustain = v;
    drawGraphs();
}

// turns a cutoff in Hz into the short text the strip and the graph show ("440", "1.1k", "16k")
function formatCutoff(hz) {
    return hz >= 1000 ? (hz / 1000).toFixed(hz >= 10000 ? 0 : 1) + "k" : String(Math.round(hz));
}

// changes the pitch bend (v is the wheel position, -1 to 1)
function setBend(v) {
    bend = Math.min(1, Math.max(-1, v));
    bendNode.offset.setTargetAtTime(bend * BEND_CENTS, ctx.currentTime, 0.01);
}

// changes the vibrato depth (v is the wheel position, 0 to 1)
function setMod(v) {
    mod = Math.min(1, Math.max(0, v));
    modDepth.gain.setTargetAtTime(mod * MOD_CENTS, ctx.currentTime, 0.01);
}

// scope (draws the waveform of everything coming out of the master gain), in the same style as the
// two graphs: a dark panel, a white line with a faded fill, and its name in the bottom left corner
const canvas = document.getElementById("scope");
const canvasCtx = canvas.getContext("2d");
const canAnimate = window.matchMedia("(prefers-reduced-motion: no-preference)");
const SCOPE_NAME = "SCOPE: ALL TRACKS"; // the scope's label, it says what it's showing
let scopeW = 0; // the size the scope draws at, in page pixels
let scopeH = 0;

// auto zoom: the wave is stretched so its tallest bump just about reaches the top of the panel.
// scopePeak is the tallest bump lately. It jumps up straight away when a louder sound arrives (so the
// wave never gets cut off) and drops slowly when it gets quieter (so the zoom doesn't jump around)
const SCOPE_MIN_PEAK = 0.02; // it never zooms in more than 1 / 0.02 = 50 times, so near silence isn't blown up
const SCOPE_HALF_LIFE = 0.1; // seconds for the remembered peak to fall by half (a note's volume halves about every 0.1s, so this keeps up with it)
let scopePeak = SCOPE_MIN_PEAK;
let scopeLast = 0; // the time of the last frame, in milliseconds

// match the canvas resolution to its size on the page so the line stays sharp
function sizeScope() {
    const dpr = (window.devicePixelRatio || 1) * uiScale; // (a bigger page is drawn sharper, not stretched)
    scopeW = canvas.clientWidth;
    scopeH = canvas.clientHeight;
    canvas.width = Math.round(scopeW * dpr);
    canvas.height = Math.round(scopeH * dpr);
    canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// the faint line down the middle (where the line sits when there's no sound) and the name
function drawScopeFrame() {
    canvasCtx.clearRect(0, 0, scopeW, scopeH);
    canvasCtx.fillStyle = "rgba(255, 255, 255, 0.25)";
    canvasCtx.fillRect(0, Math.round(scopeH / 2), scopeW, 1);
}

// draws one frame of the scope
function drawScope() {
    const w = scopeW;
    const h = scopeH;
    const half = h / 2 - 4; // how far the wave can swing from the middle (a little space is left at the top and bottom)

    drawScopeFrame();

    // one point for each sample (0 is the middle, 1 is the top, -1 is the bottom)
    let points;
    let zoom = 1;
    if (analyser) {
        analyser.getFloatTimeDomainData(scopeData); // fill scopeData with the current samples

        // work out the zoom: the tallest bump right now, or the remembered one if it's still bigger
        let peak = 0;
        for (const sample of scopeData) peak = Math.max(peak, Math.abs(sample));
        const now = performance.now();
        const seconds = scopeLast ? (now - scopeLast) / 1000 : 0;
        scopeLast = now;
        scopePeak = Math.max(peak, SCOPE_MIN_PEAK, scopePeak * 0.5 ** (seconds / SCOPE_HALF_LIFE));
        zoom = 0.95 / scopePeak; // 0.95 leaves a little space at the top

        points = Array.from(scopeData, (sample, i) => ({
            x: (i / (scopeData.length - 1)) * w,
            y: h / 2 - Math.max(-1, Math.min(1, sample * zoom)) * half,
        }));
    } else {
        // no audio yet, so draw a flat line
        points = [{ x: 0, y: h / 2 }, { x: w, y: h / 2 }];
    }

    // the faded fill between the wave and the middle, then the line on top
    canvasCtx.beginPath();
    canvasCtx.moveTo(points[0].x, h / 2);
    points.forEach((p) => canvasCtx.lineTo(p.x, p.y));
    canvasCtx.lineTo(points[points.length - 1].x, h / 2);
    canvasCtx.closePath();
    canvasCtx.fillStyle = "rgba(255, 255, 255, 0.3)";
    canvasCtx.fill();

    canvasCtx.beginPath();
    points.forEach((p, i) => (i === 0 ? canvasCtx.moveTo(p.x, p.y) : canvasCtx.lineTo(p.x, p.y)));
    canvasCtx.strokeStyle = "white";
    canvasCtx.lineWidth = 2;
    canvasCtx.lineJoin = "round";
    canvasCtx.stroke();

    // the scope always shows everything that's coming out (every track together), whichever track you're editing
    drawGraphLabel(canvasCtx, SCOPE_NAME, h);

    // how much it's zoomed in, next to the name (only while there's a sound, so silence doesn't say x47)
    if (scopePeak > SCOPE_MIN_PEAK * 1.01) {
        const text = "x" + (zoom < 10 ? zoom.toFixed(1) : Math.round(zoom));
        canvasCtx.fillText(text, 8 + canvasCtx.measureText(SCOPE_NAME).width + 10, h - 8);
    }
}

// message shown instead of the moving scope when reduced motion is on
function drawPaused() {
    drawScopeFrame();
    drawGraphLabel(canvasCtx, SCOPE_NAME, scopeH);
    canvasCtx.font = "bold 16px Karla, sans-serif";
    canvasCtx.fillStyle = "white";
    canvasCtx.fillText("Paused: reduced motion is on", 8, 24);
}

// runs drawScope every frame
function scopeLoop() {
    drawScope();
    requestAnimationFrame(scopeLoop);
}

// start the scope (only animates if the user hasn't asked for reduced motion)
sizeScope();
if (canAnimate.matches) scopeLoop();
else drawPaused();
document.fonts.ready.then(() => {
    if (!canAnimate.matches) drawPaused(); // draw the still version again once Karla has loaded
});

window.addEventListener("resize", () => {
    sizeScope(); // resizing clears the canvas, so draw again
    if (!canAnimate.matches) drawPaused();
});

// sliders
const pitchWheel = document.getElementById("pitchWheel");
const modWheel = document.getElementById("modWheel");

// turns a MIDI note number into a frequency in Hz (69 is A4 = 440Hz, each step up is a semitone)
function noteToFrequency(note) {
    return 440 * 2 ** ((note - 69) / 12);
}

// build the piano keys (so we don't have to write out every key by hand)
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FIRST_NOTE = 48; // C3
const LAST_NOTE = 84; // C6
const piano = document.getElementById("piano");
let whiteKeys = 0; // how many white keys are placed so far

for (let note = FIRST_NOTE; note <= LAST_NOTE; note++) {
    const name = NOTE_NAMES[note % 12];
    const octave = Math.floor(note / 12) - 1; // MIDI note 60 is C4
    const isBlack = name.includes("#");

    const key = document.createElement("button");
    key.className = isBlack ? "key black" : "key white";
    key.dataset.note = note;

    if (isBlack) {
        // no visible label, so give it a name for screen readers
        key.setAttribute("aria-label", name.replace("#", " sharp") + " " + octave);
        // 4 columns wide, centered on the line between the white key before it and the one after
        key.style.gridColumn = (whiteKeys - 1) * 6 + 5 + " / span 4";
    } else {
        key.textContent = name + octave;
        // 6 columns wide, one after the other
        key.style.gridColumn = whiteKeys * 6 + 1 + " / span 6";
        whiteKeys++;
    }

    piano.appendChild(key);

    // an LED in the row above the key, in the same columns as the key so it sits right over it
    // (leds.js lights them up to show a scale or a chord)
    const led = document.createElement("span");
    led.className = isBlack ? "led black-key" : "led"; // the black key LEDs are hidden in drum mode, there are no black keys
    led.dataset.led = note;
    led.setAttribute("aria-hidden", "true");
    led.style.gridColumn = key.style.gridColumn;
    piano.appendChild(led);
}

piano.style.gridTemplateColumns = "repeat(" + whiteKeys * 6 + ", minmax(8px, 1fr))";

// start scrolled so middle C (C4) is in the middle
const pianoScroll = piano.parentElement;
const middleC = piano.querySelector('[data-note="60"]');
pianoScroll.scrollLeft = middleC.offsetLeft - pianoScroll.clientWidth / 2 + middleC.offsetWidth / 2;

// piano keys (every key plays the note in its data-note attribute). A note starts when you press a key and
// keeps sounding for as long as you hold it, then fades out over the track's release time when you let go.
// Every finger (or mouse button, or keyboard key) is tracked on its own, so you can hold a chord.
const heldKeys = new Map(); // what's being held right now: an id for the finger or key -> its { release }, or null while it's starting

async function pressKey(id, note) {
    heldKeys.set(id, null);
    getCtx();
    if (ctx.state === "suspended") await ctx.resume(); // browsers start audio suspended
    const now = ctx.currentTime;
    const stillDown = heldKeys.has(id); // (it could have been let go while the audio was waking up, then it's just a tap)
    const handle = playNote(noteToFrequency(note), now, liveTrack, true);
    if (stillDown) heldKeys.set(id, handle);
    else handle.release(now);
    // tell the rest of the page a note was played (studio.js listens, so it can record it)
    document.dispatchEvent(new CustomEvent("noteplayed", { detail: { note, time: now } }));
}

function releaseKey(id) {
    const handle = heldKeys.get(id);
    heldKeys.delete(id);
    if (handle) handle.release(ctx.currentTime);
}

function releaseAllKeys() {
    [...heldKeys.keys()].forEach(releaseKey);
}
window.addEventListener("blur", releaseAllKeys); // (don't leave a note stuck on if you switch away)

document.querySelectorAll(".key").forEach((key) => {
    const note = Number(key.dataset.note);
    let waiting = null; // a touch that hasn't started its note yet: { id, x, y, timer }

    // lets go of this key (the finger lifted, or the browser took the touch to scroll)
    function finish(e) {
        if (waiting && waiting.id === e.pointerId) {
            clearTimeout(waiting.timer);
            const tapped = e.type === "pointerup";
            waiting = null;
            if (!tapped) return; // it was a swipe that scrolled the piano, so no note
            pressKey(e.pointerId, note); // a quick tap: the note is played and let go
        }
        releaseKey(e.pointerId);
    }

    key.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        try {
            key.setPointerCapture(e.pointerId); // so letting go anywhere still lets go of the note
        } catch {}
        if (e.pointerType !== "touch") {
            pressKey(e.pointerId, note);
            return;
        }
        // on a touch screen a swipe along the piano scrolls it, so the note waits a moment to see if it is one
        waiting = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            timer: setTimeout(() => {
                const id = waiting.id;
                waiting = null;
                pressKey(id, note);
            }, 90),
        };
    });

    key.addEventListener("pointermove", (e) => {
        if (waiting && waiting.id === e.pointerId && Math.hypot(e.clientX - waiting.x, e.clientY - waiting.y) > 10) {
            clearTimeout(waiting.timer); // it's moving, so it's a swipe
            waiting = null;
        }
    });

    key.addEventListener("pointerup", finish);
    key.addEventListener("pointercancel", finish);
    key.addEventListener("lostpointercapture", finish);
    key.addEventListener("contextmenu", (e) => e.preventDefault()); // (no menu when you hold a key on a phone)

    // the keyboard: Space or Enter on a key holds it too
    key.addEventListener("keydown", (e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        if (!e.repeat) pressKey("key" + note, note);
    });
    key.addEventListener("keyup", (e) => {
        if (e.key === " " || e.key === "Enter") releaseKey("key" + note);
    });
    key.addEventListener("blur", () => releaseKey("key" + note));
});

// ---- dials ----
// VOL, CUT, RES and REL are dials: a knob with a ring of tick marks round it. The real control is still
// the (hidden) range input in each dial, so the keyboard and screen readers work. The dial drawing and
// the dragging are on top of it.

const DIAL_TICKS = 15; // dots round a dial
const DIAL_TRAIL = 8; // dots in the streak behind the dot while you turn a dial
const DIAL_SWEEP = 270; // how far round a dial turns, in degrees (from 7:30 round to 4:30)
const DIAL_DRAG = 160; // how many pixels you drag to turn a dial all the way
const SVG_NS = "http://www.w3.org/2000/svg";

// makes an SVG element with some attributes
function svgElement(name, attributes) {
    const element = document.createElementNS(SVG_NS, name);
    for (const key in attributes) element.setAttribute(key, attributes[key]);
    return element;
}

// draws the ring of dots and the knob in a dial's face (the drawing is 96 by 96 and gets scaled to fit): a soft round knob,
// with a dot on it that shows where it's pointing
function buildDial(box) {
    const svg = svgElement("svg", { viewBox: "0 0 96 96", class: "dial-svg", "aria-hidden": "true" });

    box.dialTicks = [];
    for (let i = 0; i < DIAL_TICKS; i++) {
        const fraction = i / (DIAL_TICKS - 1);
        const angle = ((-DIAL_SWEEP / 2 + fraction * DIAL_SWEEP) * Math.PI) / 180;
        const dot = svgElement("circle", { cx: 48 + Math.sin(angle) * 43, cy: 48 - Math.cos(angle) * 43, r: 2.6, class: "tick" });
        dot.style.setProperty("--t", (fraction * 100).toFixed(1) + "%"); // how far round the ring it is (the lit dots go from pale to deep)
        svg.appendChild(dot);
        box.dialTicks.push(dot);
    }

    svg.appendChild(svgElement("circle", { cx: 48, cy: 48, r: 31, class: "knob" }));

    // the trail: dots that follow the dot round the knob a little behind it, each one smaller and fainter, so a moving dot
    // leaves a streak (see stepTrail)
    box.dialTrail = [];
    box.trailAngles = [];
    for (let i = 0; i < DIAL_TRAIL; i++) {
        const trail = svgElement("circle", { cx: 48, cy: 25, r: 3.6 - i * 0.4, class: "pointer-trail", "fill-opacity": 0 });
        svg.appendChild(trail);
        box.dialTrail.push(trail);
        box.trailAngles.push(0);
    }

    box.dialPointer = svgElement("circle", { cx: 48, cy: 25, r: 4, class: "pointer" }); // the dot, pointing up
    svg.appendChild(box.dialPointer);

    box.querySelector(".dial-face").appendChild(svg);
}

// turns the knob's pointer to match the value (0 to 1), and lights the ticks up to it
function updateDial(box, value) {
    const angle = -DIAL_SWEEP / 2 + value * DIAL_SWEEP;
    box.dialPointer.setAttribute("transform", "rotate(" + angle + " 48 48)");
    box.dialTicks.forEach((tick, i) => tick.classList.toggle("lit", i / (DIAL_TICKS - 1) <= value + 0.0001));
    box.targetAngle = angle;
    // while you're turning it (and motion is allowed) the streak follows the dot. Otherwise it jumps along with it, unseen
    if (box.turning && canAnimate.matches) {
        if (!box.trailRunning) {
            box.trailRunning = true;
            requestAnimationFrame(() => stepTrail(box));
        }
    } else {
        box.trailAngles.fill(angle);
        showTrail(box);
    }
}

// puts the dots of the streak where they are: each one is turned to its own angle, and it's only seen as far as it's
// away from the dot (so when they're all home there's no streak)
function showTrail(box) {
    box.dialTrail.forEach((dot, i) => {
        const away = Math.min(1, Math.abs(box.trailAngles[i] - box.targetAngle) / 14);
        dot.setAttribute("transform", "rotate(" + box.trailAngles[i] + " 48 48)");
        dot.setAttribute("fill-opacity", (away * 0.7 * (1 - i / (DIAL_TRAIL + 1))).toFixed(2));
    });
}

// one frame of the streak: the first dot chases the dot, and each of the others chases the one in front of it, so they
// string out along the knob when it's turned quickly and gather back up when it stops
function stepTrail(box) {
    let moving = false;
    for (let i = 0; i < DIAL_TRAIL; i++) {
        const goal = i === 0 ? box.targetAngle : box.trailAngles[i - 1];
        const next = box.trailAngles[i] + (goal - box.trailAngles[i]) * 0.3;
        box.trailAngles[i] = Math.abs(goal - next) < 0.05 ? goal : next;
        if (Math.abs(box.targetAngle - box.trailAngles[i]) > 0.05) moving = true;
    }
    showTrail(box);
    if (moving || box.turning) requestAnimationFrame(() => stepTrail(box));
    else box.trailRunning = false;
}

// dragging a dial up turns it up, dragging down turns it down. Double-clicking puts it back where it started
function setUpDialDrag(box, slider) {
    const face = box.querySelector(".dial-face");
    let dragging = false;
    let startY = 0;
    let startValue = 0;
    let lastDown = { time: 0, x: 0, y: 0 }; // the last press, to spot a double tap (a phone doesn't send a dblclick)

    // moves the (hidden) range input and tells the page it changed, like a click on a normal slider would
    function setValue(value) {
        slider.value = Math.min(1, Math.max(0, value)).toFixed(2);
        slider.dispatchEvent(new Event("input"));
    }

    // puts the dial back to where it started (data-default)
    function reset() {
        box.turning = true; // (so the dot is seen sweeping back)
        setValue(Number(box.dataset.default));
        box.turning = dragging;
    }

    face.addEventListener("pointerdown", (e) => {
        const now = performance.now();
        const again = now - lastDown.time < 350 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 12;
        lastDown = again ? { time: 0, x: 0, y: 0 } : { time: now, x: e.clientX, y: e.clientY };
        dragging = true;
        box.turning = true;
        if (again) reset();
        startY = e.clientY;
        startValue = Number(slider.value); // (from the reset, if it was a double press, so the drag carries on from there)
        face.setPointerCapture(e.pointerId); // keep getting the pointer even when it leaves the dial
        slider.focus({ preventScroll: true }); // so the arrow keys work on this dial afterwards
        e.preventDefault();
    });

    face.addEventListener("pointermove", (e) => {
        if (dragging) setValue(startValue + (startY - e.clientY) / DIAL_DRAG);
    });

    const stop = () => {
        dragging = false;
        box.turning = false;
    };
    face.addEventListener("pointerup", stop);
    face.addEventListener("pointercancel", stop);

    // double-clicking the knob or its name puts it back too
    face.addEventListener("dblclick", reset);
    const name = box.querySelector("label");
    if (name) name.addEventListener("dblclick", reset);

    // the arrow keys turn it, with the streak
    slider.addEventListener("keydown", () => (box.turning = true));
    slider.addEventListener("keyup", () => (box.turning = false));
}

document.querySelectorAll(".dial").forEach((box) => {
    buildDial(box);
    setUpDialDrag(box, box.querySelector("input"));
});

// the strips and dials (volume, cutoff, resonance, release, and the tempo strip in the song) all work the
// same way: the control follows its value, and its text shows the value. A strip also shows its value only
// while you use it, then goes back to showing its label.
// format turns the position (0 to 1) into the text to show, apply changes the sound
function setUpStrip(slider, format, apply) {
    const box = slider.parentElement;
    const output = box.querySelector("output");
    let held = false; // true while the pointer is down on the strip
    let timer;

    function show() {
        clearTimeout(timer);
        box.classList.add("active");
    }

    // waits a moment after you let go, so you can read the number you ended on
    function hideSoon() {
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (!held) box.classList.remove("active");
        }, 1200);
    }

    // fills the strip up from the bottom (or turns the dial) and updates the text
    function update() {
        const v = Number(slider.value);
        if (box.classList.contains("dial")) updateDial(box, v);
        else fillStrip(slider, 0, v * 100);
        output.textContent = format(v);
    }

    update(); // start with the right fill and text

    slider.addEventListener("input", () => {
        getCtx();
        apply(Number(slider.value));
        update();
        show();
        hideSoon();
    });

    // (on the whole box, so it works for a dial, where the pointer is on the dial drawing and not the slider)
    box.addEventListener("pointerdown", () => {
        held = true;
        show();
    });

    function letGo() {
        held = false;
        hideSoon();
    }
    box.addEventListener("pointerup", letGo);
    box.addEventListener("pointercancel", letGo);

    return { update }; // so the strip can be redrawn after its slider is moved by code
}

// the small dial by the MIDI button is the volume of the whole song
setUpStrip(document.getElementById("songVolume"), (v) => Math.round(v * 100) + "%", setSongVolume);

// (the dials for the selected sound, and showTrackSettings that moves them when you pick a track or a drum, are in fx.js)

// colours the strip between two points (from and to are percents of the strip height, 0 is the bottom)
// they're set on the strip's box, so the strip and its label both use them
function fillStrip(strip, from, to) {
    strip.parentElement.style.setProperty("--from", from + "%");
    strip.parentElement.style.setProperty("--to", to + "%");
}

// the pitch strip fills out from the middle, the mod strip fills up from the bottom
function showPitch() {
    const p = (Number(pitchWheel.value) + 1) * 50; // -1 to 1 becomes 0 to 100
    fillStrip(pitchWheel, Math.min(50, p), Math.max(50, p));
}

function showMod() {
    fillStrip(modWheel, 0, Number(modWheel.value) * 100);
}

showPitch();
showMod();

// pitch wheel
pitchWheel.addEventListener("input", () => {
    getCtx();
    setBend(Number(pitchWheel.value));
    showPitch();
});

// pitch wheels spring back to the middle when you let go
function springBack() {
    pitchWheel.value = 0;
    if (ctx) setBend(0);
    else bend = 0;
    showPitch();
}
pitchWheel.addEventListener("pointerup", springBack);
pitchWheel.addEventListener("pointercancel", springBack);
pitchWheel.addEventListener("keyup", springBack); // for arrow keys

// mod wheel (stays where you leave it)
modWheel.addEventListener("input", () => {
    getCtx();
    setMod(Number(modWheel.value));
    showMod();
});

// graphs (two little drawings next to the strips: what the filter is doing, and how a note fades out)
// they redraw whenever CUT, RES, ATK, DEC, SUS or REL changes, and they don't move on their own
const filterGraph = document.getElementById("filterGraph");
const fadeGraph = document.getElementById("fadeGraph");

// a filter that is never plugged into any sound, it's only here so we can ask it
// "how loud would each frequency come out?" and draw the answer (an offline context makes no sound)
const graphFilter = new OfflineAudioContext(1, 1, 48000).createBiquadFilter();
graphFilter.type = "lowpass";

// 200 frequencies from 20Hz to 20000Hz, spaced evenly in musical steps
const GRAPH_FREQS = new Float32Array(200).map((_, i) => 20 * 1000 ** (i / 199));
const graphMags = new Float32Array(GRAPH_FREQS.length); // gets filled with the answers
const graphPhases = new Float32Array(GRAPH_FREQS.length); // we don't draw these, but the browser wants a place to put them

const GRAPH_DB_TOP = 15; // the top of the filter graph, in dB
const GRAPH_DB_BOTTOM = -30; // the bottom of the filter graph, in dB
const GRAPH_SECONDS = 3.2; // how much time the fade graph covers (a bit more than the longest release)
const GRAPH_PAD = 4; // space above and below the line so it isn't cut off

// gets a canvas ready to draw on (sharp on high resolution screens) and clears it
function prepGraph(canvas) {
    const dpr = (window.devicePixelRatio || 1) * uiScale; // (a bigger page is drawn sharper, not stretched)
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h };
}

// draws a line with a faded fill under it, the same look as the faded preview on the strips
function drawLine(g, points, h) {
    g.beginPath();
    g.moveTo(points[0].x, h);
    points.forEach((p) => g.lineTo(p.x, p.y));
    g.lineTo(points[points.length - 1].x, h);
    g.closePath();
    g.fillStyle = "rgba(255, 255, 255, 0.3)";
    g.fill();

    g.beginPath();
    points.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.strokeStyle = "white";
    g.lineWidth = 2;
    g.lineJoin = "round";
    g.stroke();
}

// the name of the graph, bottom left
function drawGraphLabel(g, text, h) {
    g.font = "bold 16px Karla, sans-serif";
    g.fillStyle = "white";
    g.fillText(text, 8, h - 8);
}

// filter graph: pitch goes left to right (low to high), loudness goes bottom to top
function drawFilterGraph() {
    const { g, w, h } = prepGraph(filterGraph);

    // the graphs show the selected track
    const cutoffHz = cutoffFromSlider(trackSettings[liveTrack].cutoff);
    const resonance = resonanceFromSlider(trackSettings[liveTrack].resonance);

    const filterType = filterTypeFrom(trackSettings[liveTrack].ftype);
    graphFilter.type = filterType;
    graphFilter.frequency.value = cutoffHz;
    graphFilter.Q.value = filterType === "bandpass" ? 0.7 + resonance : resonance;
    graphFilter.getFrequencyResponse(GRAPH_FREQS, graphMags, graphPhases);

    // turns a loudness in dB into a height on the graph
    const yFor = (db) => {
        const clamped = Math.min(GRAPH_DB_TOP, Math.max(GRAPH_DB_BOTTOM, db));
        return GRAPH_PAD + ((GRAPH_DB_TOP - clamped) / (GRAPH_DB_TOP - GRAPH_DB_BOTTOM)) * (h - GRAPH_PAD * 2);
    };

    // a faint line at 0dB, where the sound is neither boosted nor cut
    g.fillStyle = "rgba(255, 255, 255, 0.25)";
    g.fillRect(0, Math.round(yFor(0)), w, 1);

    const points = Array.from(GRAPH_FREQS, (_, i) => ({
        x: (i / (GRAPH_FREQS.length - 1)) * w,
        y: yFor(20 * Math.log10(graphMags[i])),
    }));
    drawLine(g, points, h);
    drawGraphLabel(g, "FILTER " + trackName(liveTrack), h); // the label says whose filter this is

    filterGraph.setAttribute(
        "aria-label",
        "Filter graph for " + trackName(liveTrack) + ": cuts off at " + formatCutoff(cutoffHz) + " hertz, boosted " +
            Math.round(resonance) + " decibels there"
    );
}

// fade graph: time goes left to right, loudness goes bottom to top.
// On a synth track it's the fade playNote gives a note that is held and then let go: it rises (ATK), falls to the
// sustain level (DEC and SUS), stays there while it's held, then fades out (REL). The time scale stretches to fit all
// of it, and the faint lines mark where each part ends (the last one is where the note is let go).
// On the drum track it's the fade of the drum on the key you last played (drums.js works it out)
function drawFadeGraph() {
    const { g, w, h } = prepGraph(fadeGraph);

    const drum = liveTrack === DRUM_TRACK && typeof drumEnvelope === "function" ? drumEnvelope() : null;
    const yFor = (loudness) => GRAPH_PAD + (1 - loudness) * (h - GRAPH_PAD * 2); // loudness is 0 to 1

    let points, name, words;
    if (drum) {
        // the drum's own fade (it rises over attack and has gone quiet at end) multiplied by the shape the dials give it
        const env = drumShapeEnv();
        const end = Math.max(drum.decay, drum.attack + 0.01);
        const span = Math.min(GRAPH_SECONDS, Math.max(end * 1.25, env.attack * 1.3, 0.1)); // the time the graph covers, stretched to fit this drum
        const xFor = (seconds) => (seconds / span) * w;
        name = "FADE " + drum.label;
        words =
            "a " + drum.name + " drum rises over " + formatSeconds(env.attack) + " and falls over " + formatSeconds(env.decay) +
            " to " + Math.round(env.sustain * 100) + " percent, and is let go half way through, then fades out over " + formatSeconds(env.release);

        // the drum on its own: a quick rise, then an exponential fade (it drops fast and then slowly) to silence
        const natural = (t) => (t < drum.attack ? t / drum.attack : t >= end ? 0 : 0.001 ** ((t - drum.attack) / (end - drum.attack)));
        // the dials: the same fade a synth note gets, held for part of the time the drum rings, then released
        const held = Math.max(0.02, drum.decay * DRUM_HELD);
        const shape = (t) => {
            if (t <= held) return envelopeLevel(t, env, 1);
            const level = envelopeLevel(held, env, 1);
            return level * (0.001 / level) ** Math.min(1, (t - held) / env.release);
        };

        points = [];
        for (let i = 0; i <= 160; i++) {
            const t = (i / 160) * span;
            points.push({ x: xFor(t), y: yFor(natural(t) * shape(t)) });
        }
    } else {
        const env = envelopeOf(liveTrack); // the selected track's
        const holdTime = Math.max(0.15, 0.3 * (env.attack + env.decay + env.release)); // how long the note is held after the decay, just for the picture
        const total = env.attack + env.decay + holdTime + env.release;
        const xFor = (seconds) => (seconds / total) * w;
        const letGoAt = env.attack + env.decay + holdTime;
        const floor = 0.001 / PEAK; // the release ends at 0.001, as playNote does it
        name = "FADE " + trackName(liveTrack);
        words =
            "a note on " + trackName(liveTrack) + " rises over " + formatSeconds(env.attack) + ", falls over " +
            formatSeconds(env.decay) + " to " + Math.round(env.sustain * 100) + " percent, stays there while it is held, " +
            "then fades out over " + formatSeconds(env.release) + " when it is let go";

        // faint lines where each part ends
        g.fillStyle = "rgba(255, 255, 255, 0.25)";
        [env.attack, env.attack + env.decay, letGoAt].forEach((t) => g.fillRect(Math.round(xFor(t)), 0, 1, h));

        points = [
            { x: xFor(0), y: yFor(0) },
            { x: xFor(env.attack), y: yFor(1) },
        ];
        for (let i = 1; i <= 40; i++) {
            // falling to the sustain level (a curve, fast and then slow)
            points.push({ x: xFor(env.attack + env.decay * (i / 40)), y: yFor(env.sustain ** (i / 40)) });
        }
        points.push({ x: xFor(letGoAt), y: yFor(env.sustain) });
        for (let i = 1; i <= 60; i++) {
            // fading out from the sustain level to silence
            const level = env.sustain * (floor / env.sustain) ** (i / 60);
            points.push({ x: xFor(letGoAt + env.release * (i / 60)), y: yFor(level) });
        }
        points.push({ x: w, y: yFor(0) });
    }

    drawLine(g, points, h);
    drawGraphLabel(g, name, h);

    fadeGraph.setAttribute("aria-label", "Fade graph: " + words);
}

function drawGraphs() {
    drawFilterGraph();
    drawFadeGraph();
}

drawGraphs();
document.fonts.ready.then(drawGraphs); // draw again once Karla has loaded, so the labels use it
window.addEventListener("resize", drawGraphs); // resizing clears a canvas, so draw again
