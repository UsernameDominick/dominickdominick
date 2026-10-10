// the drum track. Track 1 is always drums: when it's selected the piano loses its black keys and
// every white key becomes a drum (a kick, a snare, a hi hat...). Each key's drum can be changed on its
// own, so you can swap the snare and keep the same hi hat. The drums are made from scratch with the
// Web Audio API (no sound files). This needs synth.js loaded first.

// every drum is a PART (kick, snare...) with a few VARIANTS (classic, tight...). A variant is a list of
// numbers (p) that shape how the drum is built, and each part has a type (how it's built, see VOICES below)
const DRUM_PARTS = [
    {
        name: "KICK", type: "kick", label: "KICK",
        variants: [
            { name: "CLASSIC", p: { start: 150, end: 48, sweep: 0.12, decay: 0.5, click: 0.25 } },
            { name: "DEEP", p: { start: 110, end: 38, sweep: 0.18, decay: 0.8, click: 0.15 } },
            { name: "PUNCH", p: { start: 220, end: 55, sweep: 0.07, decay: 0.35, click: 0.5 } },
            { name: "808", p: { start: 90, end: 42, sweep: 0.25, decay: 1.2, click: 0.05 } },
            { name: "TIGHT", p: { start: 170, end: 60, sweep: 0.06, decay: 0.22, click: 0.4 } },
        ],
    },
    {
        name: "SNARE", type: "snare", label: "SNR",
        variants: [
            { name: "CLASSIC", p: { tone: 185, toneDecay: 0.12, noiseDecay: 0.22, hp: 1800, noise: 0.9 } },
            { name: "TIGHT", p: { tone: 210, toneDecay: 0.08, noiseDecay: 0.12, hp: 2500, noise: 0.8 } },
            { name: "FAT", p: { tone: 150, toneDecay: 0.2, noiseDecay: 0.3, hp: 1200, noise: 1.0 } },
            { name: "ELECTRO", p: { tone: 260, toneDecay: 0.15, noiseDecay: 0.18, hp: 3500, noise: 0.7 } },
            { name: "CRACK", p: { tone: 200, toneDecay: 0.06, noiseDecay: 0.35, hp: 2200, noise: 1.0 } },
        ],
    },
    {
        name: "CLAP", type: "clap", label: "CLAP",
        variants: [
            { name: "CLASSIC", p: { bursts: 3, spread: 0.012, burstDecay: 0.02, tail: 0.18, freq: 1500 } },
            { name: "TIGHT", p: { bursts: 3, spread: 0.008, burstDecay: 0.015, tail: 0.1, freq: 1800 } },
            { name: "WIDE", p: { bursts: 4, spread: 0.018, burstDecay: 0.03, tail: 0.3, freq: 1200 } },
        ],
    },
    {
        name: "RIM", type: "rim", label: "RIM",
        variants: [
            { name: "CLASSIC", p: { hz: 1700, decay: 0.04 } },
            { name: "WOOD", p: { hz: 900, decay: 0.06 } },
        ],
    },
    {
        name: "CLOSED HAT", type: "hat", label: "CHAT",
        variants: [
            { name: "CLASSIC", p: { pitch: 1, hp: 7000, decay: 0.05 } },
            { name: "TIGHT", p: { pitch: 1.2, hp: 8000, decay: 0.03 } },
            { name: "SOFT", p: { pitch: 0.9, hp: 5500, decay: 0.07, level: 0.7 } },
        ],
    },
    {
        name: "OPEN HAT", type: "hat", label: "OHAT",
        variants: [
            { name: "CLASSIC", p: { pitch: 1, hp: 7000, decay: 0.35 } },
            { name: "LONG", p: { pitch: 1, hp: 6500, decay: 0.7 } },
        ],
    },
    {
        name: "TOM", type: "tom", label: "TOM",
        variants: [
            { name: "LOW", label: "LTOM", p: { start: 130, end: 75, decay: 0.45 } },
            { name: "MID", label: "MTOM", p: { start: 180, end: 105, decay: 0.38 } },
            { name: "HIGH", label: "HTOM", p: { start: 250, end: 150, decay: 0.3 } },
            { name: "FLOOR", label: "FTOM", p: { start: 100, end: 55, decay: 0.6 } },
        ],
    },
    {
        name: "CRASH", type: "cymbal", label: "CRSH",
        variants: [
            { name: "CLASSIC", p: { pitch: 1, hp: 5000, decay: 1.4, level: 0.7 } },
            { name: "SHORT", p: { pitch: 1.1, hp: 6000, decay: 0.6, level: 0.7 } },
        ],
    },
    {
        name: "RIDE", type: "cymbal", label: "RIDE",
        variants: [
            { name: "CLASSIC", p: { pitch: 1.3, hp: 7000, decay: 0.9, level: 0.5 } },
            { name: "BELL", p: { pitch: 1.6, hp: 8500, decay: 0.5, level: 0.6 } },
        ],
    },
    {
        name: "COWBELL", type: "cowbell", label: "COWB",
        variants: [
            { name: "CLASSIC", p: { pitch: 1, decay: 0.35 } },
            { name: "HIGH", p: { pitch: 1.4, decay: 0.25 } },
        ],
    },
    {
        name: "SHAKER", type: "shaker", label: "SHKR",
        variants: [
            { name: "CLASSIC", p: { attack: 0.015, decay: 0.08, freq: 7000 } },
            { name: "SHORT", p: { attack: 0.005, decay: 0.04, freq: 8000 } },
        ],
    },
    {
        name: "CONGA", type: "conga", label: "CNGA",
        variants: [
            { name: "LOW", label: "LCNG", p: { start: 260, end: 180, decay: 0.28 } },
            { name: "HIGH", label: "HCNG", p: { start: 400, end: 300, decay: 0.2 } },
        ],
    },
    {
        name: "CLAVE", type: "clave", label: "CLVE",
        variants: [{ name: "CLASSIC", p: { hz: 2500, decay: 0.07 } }],
    },
];

// how much louder or quieter each part is made, so the whole kit sounds about as loud together
// (the hats and cymbals are made of thin high sound, so they need a lot more than the kick and snare)
const PART_BOOST = {
    SNARE: 0.8, CLAP: 2.4, "CLOSED HAT": 2.6, "OPEN HAT": 2.6, CRASH: 3.2, RIDE: 4, COWBELL: 3,
    SHAKER: 1.4, CONGA: 1.2, CLAVE: 1.2,
};

// the same drums as one flat list (the sound picker lists these, grouped by part)
const DRUM_SOUNDS = [];
const partStart = []; // where each part's first variant is in DRUM_SOUNDS
DRUM_PARTS.forEach((part, partIndex) => {
    partStart.push(DRUM_SOUNDS.length);
    part.variants.forEach((variant) => {
        DRUM_SOUNDS.push({
            name: part.name + " " + variant.name,
            group: part.name, // the heading in the dropdown
            label: variant.label || part.label, // the short name written on the key
            type: part.type,
            p: variant.p,
            partIndex,
            boost: PART_BOOST[part.name] || 1,
        });
    });
});

// finds a drum in the list by its part and variant name
function drumIndex(partName, variantName) {
    return DRUM_SOUNDS.findIndex((sound) => sound.name === partName + " " + variantName);
}

// the keys that can be drums: the white keys of the piano, from the lowest to the highest
const DRUM_NOTES = [];
for (let n = FIRST_NOTE; n <= LAST_NOTE; n++) {
    if (!NOTE_NAMES[n % 12].includes("#")) DRUM_NOTES.push(n);
}

// the base kit: which drum each white key starts as, in order from the lowest key
const BASE_KIT = [
    ["KICK", "CLASSIC"], ["KICK", "DEEP"], ["SNARE", "CLASSIC"], ["SNARE", "TIGHT"], ["CLAP", "CLASSIC"],
    ["RIM", "CLASSIC"], ["CLOSED HAT", "CLASSIC"], ["CLOSED HAT", "TIGHT"], ["OPEN HAT", "CLASSIC"],
    ["TOM", "LOW"], ["TOM", "MID"], ["TOM", "HIGH"], ["CRASH", "CLASSIC"], ["RIDE", "CLASSIC"],
    ["COWBELL", "CLASSIC"], ["SHAKER", "CLASSIC"], ["CONGA", "LOW"], ["CONGA", "HIGH"], ["CLAVE", "CLASSIC"],
    ["KICK", "808"], ["SNARE", "FAT"], ["CLAP", "WIDE"],
];

// the kit as it is now: drumKit[0] is the drum on the lowest white key, and so on (a number from DRUM_SOUNDS)
const drumKit = DRUM_NOTES.map((note, i) => drumIndex(...BASE_KIT[i]));

// changes to the kit are remembered, so your kit is there next time (the page works without this)
try {
    const saved = JSON.parse(localStorage.getItem("drumKit"));
    if (Array.isArray(saved) && saved.length === drumKit.length) {
        saved.forEach((sound, i) => {
            if (Number.isInteger(sound) && sound >= 0 && sound < DRUM_SOUNDS.length) drumKit[i] = sound;
        });
    }
} catch {}

function saveDrumKit() {
    try {
        localStorage.setItem("drumKit", JSON.stringify(drumKit));
    } catch {}
}

// each drum has its own volume (what the VOL dial sets while that drum is the selected one), 0 to 1. They start at
// 0.5, which is how loud the drums were before. They're remembered too
const drumVolumes = DRUM_NOTES.map(() => 0.5);
try {
    const savedVolumes = JSON.parse(localStorage.getItem("drumVolumes"));
    if (Array.isArray(savedVolumes) && savedVolumes.length === drumVolumes.length) {
        savedVolumes.forEach((v, i) => {
            if (typeof v === "number" && v >= 0 && v <= 1) drumVolumes[i] = v;
        });
    }
} catch {}

function drumVolumeAt(note) {
    return drumVolumes[drumSlot(note)];
}

function setDrumVolume(note, v) {
    drumVolumes[drumSlot(note)] = v;
    try {
        localStorage.setItem("drumVolumes", JSON.stringify(drumVolumes));
    } catch {}
}

// which place in the kit a key is. A black key (from an older recording) uses the white key just below it
function drumSlot(note) {
    let slot = DRUM_NOTES.indexOf(note);
    if (slot < 0) slot = DRUM_NOTES.indexOf(note - 1);
    return slot < 0 ? 0 : slot;
}

function drumSoundAt(note) {
    return drumKit[drumSlot(note)];
}

// gives a key a different drum
function setDrumSound(note, soundIndex) {
    drumKit[drumSlot(note)] = soundIndex;
    saveDrumKit();
    refreshDrumKeys();
}

// the next or previous variant of the same part (so the arrows step through the snares and stay on snares)
function nextVariant(soundIndex, delta) {
    const part = DRUM_SOUNDS[soundIndex].partIndex;
    const first = partStart[part];
    const count = DRUM_PARTS[part].variants.length;
    return first + ((soundIndex - first + delta + count) % count);
}

// ---- making the sounds ----

let noiseBuf; // a couple of seconds of white noise, made once and reused for every hit that needs noise
function noiseBuffer() {
    if (!noiseBuf) {
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
}

// a burst of noise through a filter that fades out: the hiss in a snare, the body of a hat, a clap
function noiseHit(t, decay, filterType, freq, level, out, q = 0.7, attack = 0.001) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer();
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, t + attack + decay);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(t, Math.random()); // start somewhere different in the noise each time
    source.stop(t + attack + decay + 0.05);
}

// a tone that starts at one pitch and drops to another: a kick, a tom, a conga
function toneHit(t, type, startHz, endHz, sweep, decay, level, out) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(startHz, t);
    osc.frequency.exponentialRampToValueAtTime(endHz, t + sweep);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.05);
}

// the metal sound of a hi hat or cymbal: six square waves at odd pitches (the same ones the old drum
// machines used) that clash with each other, filtered down to the bright part
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
function metalHit(t, pitch, hp, decay, level, out) {
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 10000;
    band.Q.value = 0.5;
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = hp;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level * 0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
    METAL.forEach((hz) => {
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.value = hz * pitch;
        osc.connect(band);
        osc.start(t);
        osc.stop(t + decay + 0.05);
    });
    band.connect(high);
    high.connect(gain);
    gain.connect(out);
}

// how each type of drum is built (p is the variant's numbers, t is when to start, out is where it goes)
const VOICES = {
    kick(p, t, out) {
        toneHit(t, "sine", p.start, p.end, p.sweep, p.decay, 1, out);
        if (p.click) noiseHit(t, 0.012, "highpass", 2500, p.click, out); // the beater hitting the skin
    },
    snare(p, t, out) {
        toneHit(t, "triangle", p.tone * 1.3, p.tone, 0.03, p.toneDecay, 0.7, out); // the drum
        noiseHit(t, p.noiseDecay, "highpass", p.hp, p.noise, out); // the wires
    },
    clap(p, t, out) {
        for (let i = 0; i < p.bursts; i++) noiseHit(t + i * p.spread, p.burstDecay, "bandpass", p.freq, 0.9, out, 1.2);
        noiseHit(t + (p.bursts - 1) * p.spread, p.tail, "bandpass", p.freq, 0.8, out, 1.2); // the room
    },
    rim(p, t, out) {
        toneHit(t, "triangle", p.hz, p.hz * 0.8, 0.02, p.decay, 0.9, out);
        noiseHit(t, 0.01, "highpass", 3000, 0.4, out);
    },
    hat(p, t, out) {
        metalHit(t, p.pitch, p.hp, p.decay, 1, out);
    },
    cymbal(p, t, out) {
        metalHit(t, p.pitch, p.hp, p.decay, 1, out);
        noiseHit(t, p.decay, "highpass", p.hp, 0.25, out);
    },
    cowbell(p, t, out) {
        const band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 2500;
        band.Q.value = 1;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + p.decay);
        [540, 800].forEach((hz) => {
            const osc = ctx.createOscillator();
            osc.type = "square";
            osc.frequency.value = hz * p.pitch;
            osc.connect(band);
            osc.start(t);
            osc.stop(t + p.decay + 0.05);
        });
        band.connect(gain);
        gain.connect(out);
    },
    tom(p, t, out) {
        toneHit(t, "sine", p.start, p.end, 0.1, p.decay, 1, out);
        noiseHit(t, 0.01, "highpass", 2500, 0.2, out);
    },
    conga(p, t, out) {
        toneHit(t, "triangle", p.start, p.end, 0.04, p.decay, 0.9, out);
    },
    shaker(p, t, out) {
        noiseHit(t, p.decay, "bandpass", p.freq, 0.8, out, 0.8, p.attack);
    },
    clave(p, t, out) {
        toneHit(t, "sine", p.hz, p.hz, 0.01, p.decay, 0.9, out);
    },
};

// the drum track's ATK, DEC, SUS and REL dials shape every hit on top of the way the drum fades by itself: each hit
// rises over ATK, falls over DEC to the SUS level, and is let go half way through the time the drum rings for, then
// fades out over REL (so a short REL cuts the drum's tail short).
// (They start at nothing: no fade in, full volume, and a long release, so a drum sounds as it is until you turn them)
const DRUM_HELD = 0.5; // how much of the drum's ringing time the hit is held for before it's let go
function drumShapeEnv() {
    const env = envelopeOf(DRUM_TRACK);
    if (trackSettings[DRUM_TRACK].attack === 0) env.attack = 0.0005; // all the way down is no fade in at all
    return env;
}

// plays one drum from the list (when is the audio clock time to start it). Every hit goes through the
// drum track's filter, so CUT and RES on the strips shape the drums too
function playDrumSound(soundIndex, when = ctx.currentTime, volume = 0.5, releaseScale = 1, fx = null) {
    const base = DRUM_SOUNDS[soundIndex];
    // (with the drum's own settings: its pitch and how long it rings)
    const sound = fx ? { ...base, p: tunedDrum(base.p, fx) } : base;
    const env = drumShapeEnv();
    env.release *= releaseScale; // (the release setting in params.js)
    const held = Math.max(0.02, drumTiming(sound).decay * DRUM_HELD); // how long the hit is held for before it's let go

    // the shape from the dials (a volume that all of the drum's parts go through)
    const shape = ctx.createGain();
    scheduleEnvelope(shape.gain, when, env, held, 1);
    scheduleRelease(shape.gain, when, held, env, 1);
    shape.connect(trackFilters[DRUM_TRACK]);

    const out = ctx.createGain();
    out.gain.value = 0.55 * sound.boost * (sound.p.level === undefined ? 1 : sound.p.level) * volume;
    // each drum has its own pan, and its own amounts for the echo and the room
    let node = out;
    if (fx && fx.pan !== 0.5) {
        node = ctx.createStereoPanner();
        node.pan.value = panFrom(fx.pan);
        out.connect(node);
    }
    node.connect(shape);
    if (fx) sendTo(node, fx.dly, fx.rev, DRUM_TRACK);
    VOICES[sound.type](sound.p, when, out);
}

// plays whatever drum a key is set to
function playDrumNote(note, when = ctx.currentTime, velocity = 1, releaseScale = 1) {
    playDrumSound(drumSoundAt(note), when, drumVolumeAt(note) * velocity, releaseScale, drumFxAt(note));
}

// a drum with its PITCH and DECAY dials turned: the pitches are multiplied and the lengths are multiplied
const DRUM_PITCH_KEYS = ["start", "end", "tone", "hz", "freq", "hp", "pitch"];
const DRUM_DECAY_KEYS = ["decay", "toneDecay", "noiseDecay", "burstDecay", "tail"];
function tunedDrum(p, fx) {
    const pitch = 2 ** (pitchSemis(fx.pitch) / 12);
    const length = drumDecayScale(fx.decay);
    const tuned = { ...p };
    DRUM_PITCH_KEYS.forEach((key) => {
        if (typeof tuned[key] === "number") tuned[key] *= pitch;
    });
    DRUM_DECAY_KEYS.forEach((key) => {
        if (typeof tuned[key] === "number") tuned[key] *= length;
    });
    return tuned;
}

// how the selected drum fades out, for the FADE graph: how long it takes to rise (attack), how long until
// it's gone (decay), and its name. These come from the numbers each drum is built from
function drumEnvelope() {
    const sound = DRUM_SOUNDS[drumSoundAt(selectedDrumNote)];
    return { ...drumTiming(sound), label: sound.label, name: sound.name };
}

// how long one drum takes to rise (attack) and how long it rings until it's gone (decay), from the numbers it's built from
function drumTiming(sound) {
    const p = sound.p;
    let attack = 0.005;
    let decay = p.decay;

    if (sound.type === "snare") {
        decay = Math.max(p.toneDecay, p.noiseDecay); // the drum and the wires, whichever rings longer
    } else if (sound.type === "clap") {
        attack = (p.bursts - 1) * p.spread; // the little claps before the main one
        decay = p.tail;
    } else if (sound.type === "shaker") {
        attack = p.attack;
    }

    return { attack, decay };
}

// ---- the keyboard in drum mode ----

let drumMode = false; // true while track 1 is selected: no black keys, every white key is a drum
let selectedDrumNote = DRUM_NOTES[0]; // the key whose drum the sound picker is showing (the last one you played)

// writes the drum names on the white keys (or the note names back, when it's not drum mode)
function refreshDrumKeys() {
    document.querySelectorAll(".key.white").forEach((key) => {
        const note = Number(key.dataset.note);
        if (drumMode) {
            const sound = DRUM_SOUNDS[drumSoundAt(note)];
            key.textContent = sound.label;
            key.setAttribute("aria-label", sound.name);
        } else {
            key.textContent = NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1);
            key.removeAttribute("aria-label");
        }
        key.classList.toggle("drum-selected", drumMode && note === selectedDrumNote);
    });
}

// turns drum mode on or off (studio.js calls this when you pick a track)
function setDrumMode(on) {
    drumMode = on;
    piano.classList.toggle("drums", on);
    refreshDrumKeys();
    if (typeof updateLeds === "function") updateLeds(); // the scale LEDs go dark in drum mode
}

// playing a key in drum mode also selects it, so the sound picker can change its drum
document.addEventListener("noteplayed", (e) => {
    if (!drumMode || !DRUM_NOTES.includes(e.detail.note)) return;
    selectedDrumNote = e.detail.note;
    refreshDrumKeys();
    document.dispatchEvent(new CustomEvent("drumselected"));
});
