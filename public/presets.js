// presets: ready-made ones (FACTORY_PRESETS below, in groups called PRESET: BASS and so on), and the star by the sound picker
// saves the selected synth track's sound and all its dials (not its volume) under a name, in a group called MY PRESETS. Pick
// one in the sound picker's dropdown and the selected track gets that sound and those dials. (The drum track's sounds are the
// drums, so presets are for the synth tracks.) Yours are kept in the browser, and this uses the helpers in save.js (so load
// it after that).

const PRESETS_KEY = "presets";
const PRESET_NAME_MAX = 30;

const presetButton = document.getElementById("presetButton");
const presetPopover = document.getElementById("presetPopover");
const presetTitle = document.getElementById("presetTitle");
const presetForm = document.getElementById("presetForm");
const presetName = document.getElementById("presetName");
const presetList = document.getElementById("presetList");
const presetStatus = document.getElementById("presetStatus");
let renamingPreset = null; // the name of the preset that's being renamed in the list, if any

// ---- the built-in presets ----
// Ready-made sounds, in the sound picker in groups (PRESET: BASS and so on). Each one lists only what it changes: everything
// else is how a track starts. The numbers are the dials (0 to 1), and sound is a place in SOUNDS in synth.js: 0 SAW, 1 SQUARE,
// 2 SINE, 3 TRIANGLE, 4 SUPER SAW, 5 SUB BASS, 6 ORGAN, 7 HOLLOW. A few of the dial numbers, for working out what they mean:
//   attack  0 is 5ms, 0.25 is 22ms, 0.5 is 100ms, 0.75 is 450ms, 1 is 2s
//   decay   0 is 20ms, 0.3 is 90ms, 0.5 is 250ms, 0.7 is 680ms, 1 is 3s
//   release 0 is 50ms, 0.1 is 0.35s, 0.25 is 0.8s, 0.5 is 1.5s, 1 is 3s
//   cutoff  0.3 is 400Hz, 0.5 is 1100Hz, 0.7 is 3200Hz, 1 is 16000Hz
//   oct     0.25 is an octave down, 0.75 an octave up. ftype 0 is low pass, 0.25 high pass, 0.5 band pass, 0.75 notch, 1 peak; fmodel 0 is SVF 12, 0.5 SVF 24, 1 the ladder
//   dtime   0 is a 16th, 0.25 an 8th, 0.5 a dotted 8th, 0.75 a quarter, 1 a half
// (for the presets that use the modulation: mx sends a source to a destination by an amount from -1 to 1, in the numbers of the matrix. The sources are
// 0 to 2 the LFOs, 3 and 4 the two extra envelopes, 5 how hard the key is hit, 6 the note, 7 the mod wheel, 8 pressure and 9 chance, and the
// destinations 0 pitch, 1 cutoff, 2 resonance, 3 volume, 4 pan, 5 pulse width, 6 filter drive and 7 sub. An LFO's dials: lXw its shape (0 sine, 1/6 triangle,
// 2/6 saw up, 3/6 saw down, 4/6 square, 5/6 steps, 1 smooth), lXm its mode (0 free, 0.5 each note, 1 in time with the song) and lXr its rate: free, 0.34 is
// 0.5Hz, 0.45 1Hz, 0.55 2Hz, 0.66 4Hz, and in time with the song 2/7 is a bar, 4/7 a quarter, 5/7 an eighth and 6/7 a sixteenth. For the chord and the arpeggio,
// chordDial, arpDial and arpRateDial give the dial for a name)
const mx = (source, dest, amount) => ({ ["x" + source + "_" + dest]: 0.5 + amount / 2 });
const chordDial = (name) => CHORDS.findIndex((c) => c.name === name) / (CHORDS.length - 1);
const arpDial = (name) => ARP_MODES.indexOf(name) / (ARP_MODES.length - 1);
const arpRateDial = (name) => ARP_RATES.findIndex((r) => r.name === name) / (ARP_RATES.length - 1);
const FACTORY_PRESETS = [
    // bass
    { group: "BASS", name: "Sub Bass", sound: 5, cutoff: 0.45, attack: 0.05, decay: 0.45, sustain: 0.8, release: 0.12, drive: 0.1 },
    { group: "BASS", name: "Acid Bass", sound: 0, oct: 0.25, cutoff: 0.22, resonance: 0.7, fenv: 0.55, attack: 0, decay: 0.3, sustain: 0.3, release: 0.08, glide: 0.15, drive: 0.25 },
    { group: "BASS", name: "Wobble Bass", sound: 1, oct: 0.25, cutoff: 0.4, resonance: 0.45, drive: 0.3, tdep: 0.6, trate: 0.55, attack: 0.02, sustain: 0.9, release: 0.1 },
    { group: "BASS", name: "Reese Bass", sound: 0, oct: 0.25, detune: 0.6, uni: 4 / 15, spread: 0.7, cutoff: 0.35, resonance: 0.2, drive: 0.3, tdep: 0.15, trate: 0.1, attack: 0.05, sustain: 0.9, release: 0.12 },
    { group: "BASS", name: "Pluck Bass", sound: 0, oct: 0.25, cutoff: 0.3, resonance: 0.3, fenv: 0.45, attack: 0, decay: 0.25, sustain: 0.15, release: 0.1 },
    // leads
    { group: "LEAD", name: "Super Lead", sound: 4, detune: 0.3, uni: 6 / 15, spread: 0.8, glide: 0.12, cutoff: 0.85, attack: 0.08, decay: 0.5, sustain: 0.75, release: 0.2, vdep: 0.25, vrate: 0.45, dly: 0.25, dtime: 0.5, dfb: 0.35, rev: 0.2 },
    { group: "LEAD", name: "Square Lead", sound: 1, cutoff: 0.8, glide: 0.1, drive: 0.1, vdep: 0.2, vrate: 0.5, attack: 0.03, sustain: 0.8, release: 0.15, dly: 0.2, dtime: 0.75, dfb: 0.3 },
    { group: "LEAD", name: "Sine Whistle", sound: 2, vdep: 0.35, vrate: 0.5, glide: 0.2, attack: 0.35, sustain: 0.9, release: 0.3, rev: 0.3 },
    { group: "LEAD", name: "Hoover", sound: 4, detune: 0.8, uni: 6 / 15, spread: 0.9, glide: 0.4, drive: 0.5, cutoff: 0.7, resonance: 0.3, vdep: 0.3, vrate: 0.6, attack: 0.05, sustain: 0.8, release: 0.15, rev: 0.15 },
    { group: "LEAD", name: "Chiptune", sound: 1, oct: 0.75, vdep: 0.12, vrate: 0.55, attack: 0, decay: 0.1, sustain: 0.6, release: 0.05 },
    // pads
    { group: "PAD", name: "Warm Pad", sound: 4, detune: 0.4, uni: 4 / 15, spread: 0.8, cutoff: 0.55, resonance: 0.1, attack: 0.75, decay: 0.6, sustain: 0.8, release: 0.6, vdep: 0.1, vrate: 0.2, rev: 0.6 },
    { group: "PAD", name: "Glass Pad", sound: 3, detune: 0.5, uni: 3 / 15, spread: 1, cutoff: 0.8, attack: 0.7, sustain: 0.9, release: 0.75, tdep: 0.15, trate: 0.2, dly: 0.3, dtime: 0.75, dfb: 0.5, rev: 0.75 },
    { group: "PAD", name: "Hollow Choir", sound: 7, detune: 0.2, uni: 2 / 15, spread: 0.6, cutoff: 0.5, attack: 0.65, sustain: 0.8, release: 0.6, vdep: 0.15, vrate: 0.35, rev: 0.55 },
    { group: "PAD", name: "Dream Strings", sound: 0, detune: 0.45, uni: 5 / 15, spread: 1, cutoff: 0.5, attack: 0.7, sustain: 0.85, release: 0.6, tdep: 0.2, trate: 0.35, rev: 0.5 },
    { group: "PAD", name: "Ambient Drone", sound: 4, detune: 0.6, uni: 6 / 15, spread: 1, cutoff: 0.5, attack: 1, sustain: 1, release: 1, vdep: 0.15, vrate: 0.1, tdep: 0.2, trate: 0.1, dly: 0.4, dtime: 1, dfb: 0.5, rev: 1 },
    // keys and plucks
    { group: "KEYS", name: "Organ", sound: 6, cutoff: 0.9, attack: 0.05, decay: 0.2, sustain: 1, release: 0.08, tdep: 0.25, trate: 0.45, rev: 0.25 },
    { group: "KEYS", name: "Electric Piano", sound: 3, cutoff: 0.7, fenv: 0.2, drive: 0.05, attack: 0.02, decay: 0.55, sustain: 0.3, release: 0.35, tdep: 0.25, trate: 0.3, rev: 0.2 },
    { group: "KEYS", name: "Pluck", sound: 0, cutoff: 0.35, fenv: 0.5, attack: 0, decay: 0.3, sustain: 0.08, release: 0.2, dly: 0.35, dtime: 0.75, dfb: 0.4, rev: 0.25 },
    { group: "KEYS", name: "Marimba", sound: 3, oct: 0.75, cutoff: 0.8, attack: 0, decay: 0.4, sustain: 0.05, release: 0.15, rev: 0.2 },
    { group: "KEYS", name: "Bell", sound: 6, oct: 0.75, attack: 0, decay: 0.8, sustain: 0.1, release: 0.7, dly: 0.25, dtime: 0.5, dfb: 0.45, rev: 0.6 },
    // effects
    { group: "FX", name: "Dub Stab", sound: 1, cutoff: 0.6, attack: 0, decay: 0.25, sustain: 0.2, release: 0.2, dly: 0.7, dtime: 0.75, dfb: 0.65, rev: 0.35 },
    { group: "FX", name: "Telephone", sound: 1, ftype: 0.5, cutoff: 0.6, resonance: 0.6, drive: 0.7, attack: 0.01, sustain: 0.9, release: 0.05 },
    // the newer engine: the ladder filter, the matrix, the rack, ping pong and the rooms
    { group: "BASS", name: "Ladder Bass", sound: 0, oct: 0.25, fmodel: 1, cutoff: 0.28, resonance: 0.55, fdrive: 0.35, fenv: 0.5, ktrack: 0.3, drive: 0.1, attack: 0, decay: 0.3, sustain: 0.35, release: 0.1 },
    { group: "BASS", name: "Mono Growl", sound: 1, oct: 0.25, mode: 0.5, glide: 0.1, fmodel: 0.5, cutoff: 0.28, resonance: 0.4, fdrive: 0.15, drive: 0.05, attack: 0.01, sustain: 0.9, release: 0.1, l1w: 1 / 6, l1m: 1, l1r: 5 / 7, ...mx(0, 1, 0.3) },
    { group: "BASS", name: "Sub Pressure", sound: 5, cutoff: 0.5, sub: 0.25, attack: 0.02, decay: 0.4, sustain: 0.85, release: 0.1, cpmix: 0.6, cpthr: 0.45, cpratio: 0.35, cpatk: 0.4, cprel: 0.4 },
    { group: "BASS", name: "Fat Unison Bass", sound: 0, oct: 0.25, uni: 5 / 15, detune: 0.35, spread: 0.3, fmodel: 0.5, cutoff: 0.35, resonance: 0.2, fdrive: 0.2, attack: 0.03, sustain: 0.9, release: 0.12, cpmix: 0.5, cpthr: 0.3, cpratio: 0.25 },
    { group: "BASS", name: "Squelch", sound: 0, oct: 0.25, fmodel: 1, cutoff: 0.2, resonance: 0.75, fenv: 0.6, drive: 0.15, attack: 0, decay: 0.22, sustain: 0.2, release: 0.08, v3a: 0, v3d: 0.3, v3s: 0, v3r: 0.1, ...mx(4, 1, 0.3) },
    { group: "LEAD", name: "Flange Lead", sound: 0, uni: 3 / 15, detune: 0.25, spread: 0.6, cutoff: 0.8, attack: 0.04, sustain: 0.8, release: 0.2, flmix: 0.5, flrate: 0.25, fldep: 0.6, flfb: 0.5, rev: 0.2 },
    { group: "LEAD", name: "Pulse Lead", sound: 1, pw: 0.2, cutoff: 0.75, attack: 0.02, sustain: 0.85, release: 0.15, chmix: 0.35, l1w: 0, l1r: 0.45, ...mx(0, 5, 0.4), dly: 0.2, dtime: 0.5, dfb: 0.3 },
    { group: "LEAD", name: "Legato Lead", sound: 0, mode: 1, glide: 0.15, cutoff: 0.7, vdep: 0.1, vrate: 0.5, attack: 0.04, sustain: 0.85, release: 0.2, dly: 0.2, dping: 1, dtime: 0.25, dfb: 0.3, rev: 0.25, ...mx(7, 0, 0.05) },
    { group: "LEAD", name: "Crush Lead", sound: 1, oct: 0.75, cutoff: 0.9, attack: 0, sustain: 0.8, release: 0.1, crmix: 0.5, crbits: 0.3, crhold: 0.1 },
    { group: "LEAD", name: "Detuned Stack", sound: 4, uni: 8 / 15, detune: 0.45, spread: 1, cutoff: 0.8, attack: 0.05, sustain: 0.8, release: 0.25, chmix: 0.3, chrate: 0.3, rev: 0.25 },
    { group: "LEAD", name: "Screamer", sound: 0, mode: 0.5, glide: 0.12, fmodel: 1, cutoff: 0.55, resonance: 0.7, fdrive: 0.6, drive: 0.3, vdep: 0.2, vrate: 0.5, attack: 0.02, sustain: 0.85, release: 0.15 },
    { group: "PAD", name: "Slow Sweep Pad", sound: 4, uni: 4 / 15, detune: 0.35, spread: 0.9, cutoff: 0.4, resonance: 0.15, attack: 0.7, sustain: 0.85, release: 0.6, l1w: 0, l1r: 0.25, ...mx(0, 1, 0.35), phmix: 0.4, phrate: 0.15, phdep: 0.6, rev: 0.6 },
    { group: "PAD", name: "Chorus Strings", sound: 0, uni: 3 / 15, detune: 0.3, spread: 0.7, cutoff: 0.6, attack: 0.6, sustain: 0.85, release: 0.55, chmix: 0.6, chrate: 0.25, chdep: 0.6, rev: 0.5 },
    { group: "PAD", name: "PWM Pad", sound: 1, pw: 0.35, cutoff: 0.55, attack: 0.65, sustain: 0.85, release: 0.6, l1w: 1 / 6, l1r: 0.3, ...mx(0, 5, 0.5), chmix: 0.4, rev: 0.5 },
    { group: "PAD", name: "Evolving Drone", sound: 4, uni: 6 / 15, detune: 0.5, spread: 1, cutoff: 0.45, attack: 1, sustain: 1, release: 1, l1w: 0, l1r: 0.2, ...mx(0, 1, 0.25), l2w: 1 / 6, l2r: 0.3, ...mx(1, 4, 0.4), phmix: 0.5, dly: 0.4, dping: 1, dtime: 1, dfb: 0.5, rev: 1, rsize: 1 },
    { group: "PAD", name: "Cathedral", sound: 6, attack: 0.5, sustain: 0.9, release: 0.7, rev: 1, rsize: 1, rdamp: 0.5, rpre: 0.3 },
    { group: "KEYS", name: "Phaser Keys", sound: 3, cutoff: 0.75, attack: 0.02, decay: 0.55, sustain: 0.3, release: 0.4, phmix: 0.6, phrate: 0.22, phdep: 0.7, phfb: 0.5, rev: 0.25 },
    { group: "KEYS", name: "Tine Piano", sound: 3, cutoff: 0.5, fenv: 0.25, attack: 0, decay: 0.5, sustain: 0.2, release: 0.35, chmix: 0.3, rev: 0.2, ...mx(5, 1, 0.3) },
    { group: "KEYS", name: "Clav", sound: 1, pw: 0.3, cutoff: 0.5, resonance: 0.35, fenv: 0.45, drive: 0.1, attack: 0, decay: 0.22, sustain: 0.1, release: 0.1 },
    { group: "KEYS", name: "Drive Keys", sound: 3, drive: 0.35, cutoff: 0.6, tdep: 0.3, trate: 0.4, attack: 0.01, decay: 0.5, sustain: 0.35, release: 0.3, rev: 0.25, ...mx(5, 1, 0.25) },
    { group: "KEYS", name: "Glass Bells", sound: 6, oct: 0.75, attack: 0, decay: 0.8, sustain: 0.05, release: 0.7, dly: 0.3, dping: 1, dtime: 0.5, dfb: 0.5, rev: 0.7, rsize: 1 },
    { group: "ARP", name: "Arp Pluck", sound: 0, cutoff: 0.4, fenv: 0.5, attack: 0, decay: 0.25, sustain: 0.1, release: 0.12, chord: chordDial("MIN7"), arp: arpDial("UP"), arate: arpRateDial("1/16"), dly: 0.3, dping: 1, dtime: 0.25, dfb: 0.4, rev: 0.3 },
    { group: "ARP", name: "Trance Arp", sound: 4, uni: 4 / 15, detune: 0.3, spread: 0.7, cutoff: 0.6, attack: 0, decay: 0.2, sustain: 0.2, release: 0.1, chord: chordDial("MIN"), arp: arpDial("UP DOWN"), arate: arpRateDial("1/16"), dly: 0.35, dtime: 0.5, dfb: 0.4, rev: 0.3 },
    { group: "ARP", name: "Random Arp", sound: 1, pw: 0.3, cutoff: 0.65, attack: 0, decay: 0.15, sustain: 0.1, release: 0.1, chord: chordDial("7TH"), arp: arpDial("RANDOM"), arate: arpRateDial("1/16"), dly: 0.3, dping: 1, dtime: 0.25, dfb: 0.35, rev: 0.25 },
    { group: "FX", name: "Alien Sweep", sound: 0, fmodel: 1, ftype: 0.5, cutoff: 0.5, resonance: 0.7, attack: 0.1, sustain: 0.9, release: 0.4, l1w: 5 / 6, l1r: 0.55, ...mx(0, 1, 0.5), flmix: 0.4, rev: 0.5 },
    { group: "FX", name: "Noise Riser", sound: 4, noise: 0.6, cutoff: 0.3, resonance: 0.2, attack: 0.9, sustain: 1, release: 0.4, v2a: 0.85, v2d: 0.5, v2s: 1, v2r: 0.3, ...mx(3, 1, 0.5), rev: 0.4 },
    { group: "FX", name: "Laser Zap", sound: 0, oct: 0.75, attack: 0, decay: 0.15, sustain: 0, release: 0.1, v2a: 0, v2d: 0.15, v2s: 0, v2r: 0.1, ...mx(3, 0, 0.8), dly: 0.2, dtime: 0.25, dfb: 0.3 },
    { group: "FX", name: "Crusher Stab", sound: 1, cutoff: 0.8, attack: 0, decay: 0.25, sustain: 0.2, release: 0.1, crmix: 0.7, crbits: 0.2, crhold: 0.15 },
    { group: "FX", name: "Ping Pong Dub", sound: 1, cutoff: 0.5, attack: 0, decay: 0.2, sustain: 0.15, release: 0.15, dly: 0.8, dping: 1, dtime: 0.5, dfb: 0.7, rev: 0.4 },
    { group: "FX", name: "Tape Wobble", sound: 3, cutoff: 0.6, attack: 0.02, sustain: 0.85, release: 0.3, vdep: 0.2, vrate: 0.3, l3w: 1, l3r: 0.35, ...mx(2, 0, 0.03), tdep: 0.15, chmix: 0.3, rev: 0.3 },
];

// a built-in preset with every dial filled in (what it doesn't change is how a track starts)
function factorySettings(preset) {
    const settings = { sound: 0, cutoff: 1, resonance: 0, ...FX_DEFAULTS, ...DIAL_DEFAULTS.synth };
    for (const key in settings) if (typeof preset[key] === "number") settings[key] = preset[key];
    return settings;
}

// every preset as { value, name, group, settings }: the built-in ones (value f:name) and then the ones you saved (p:name)
function allPresets() {
    return [
        ...FACTORY_PRESETS.map((p) => ({ value: "f:" + p.name, name: p.name, group: "PRESET: " + p.group, settings: factorySettings(p) })),
        ...storedPresets().map((p) => ({ value: "p:" + p.name, name: p.name, group: "MY PRESETS", settings: p.settings })),
    ];
}

function storedPresets() {
    try {
        const list = JSON.parse(localStorage.getItem(PRESETS_KEY));
        return Array.isArray(list) ? list.filter((p) => p && typeof p.name === "string" && p.settings && typeof p.settings === "object") : [];
    } catch {
        return [];
    }
}

function keepPresets(list) {
    try {
        localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
        return true;
    } catch {
        return false;
    }
}

function cleanPresetName(text) {
    return typeof text === "string" ? text.trim().replace(/\s+/g, " ").slice(0, PRESET_NAME_MAX) : "";
}

// the settings a preset holds: everything the dials set, except the volume
function presetSettingsOf(t) {
    const settings = { ...trackSettings[t] };
    delete settings.volume;
    return settings;
}

// a preset's settings as numbers the track can have (a preset in the browser's storage could be anything)
function cleanPresetSettings(raw, t) {
    const clean = presetSettingsOf(t);
    for (const key in clean) {
        const v = raw[key];
        clean[key] = typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : clean[key];
    }
    // (a preset saved before the oscillator dials: the new ones start as they do on a new track, and it had three copies if DETUNE was up)
    ["uni", "spread", "pw", "sub", "noise", "mode", "voices", "fmodel", "fdrive", "ktrack"].forEach((key) => {
        if (typeof raw[key] !== "number") clean[key] = FX_DEFAULTS[key];
    });
    // (and its filter type, from before there were five, is moved to where it is now)
    if (typeof raw.fmodel !== "number") clean.ftype = legacyFilterType(typeof raw.ftype === "number" ? raw.ftype : 0);
    if (typeof raw.uni !== "number") clean.uni = clean.detune > 0.0125 ? 2 / 15 : 0;
    if (typeof raw.spread !== "number") clean.spread = 0;
    const sound = raw.sound;
    clean.sound = Number.isInteger(sound) && sound >= 0 && sound < SOUNDS.length ? sound : 0;
    return clean;
}

// the picker's value for the preset the selected track's sound is exactly, if it is one (so the picker can say so). Your
// own presets come first, so if you saved a copy of a built-in one it shows yours
function matchingPreset(t) {
    const now = presetSettingsOf(t);
    const all = allPresets();
    const found = [...all.filter((p) => p.group === "MY PRESETS"), ...all.filter((p) => p.group !== "MY PRESETS")].find((p) => {
        const settings = cleanPresetSettings(p.settings, t);
        return Object.keys(now).every((key) => Math.abs(settings[key] - now[key]) < 0.0005);
    });
    return found ? found.value : null;
}

// the groups at the end of the sound picker's dropdown: your presets, then the built-in ones by kind (studio.js calls this when
// it fills the dropdown with the synth sounds)
function addPresetOptions() {
    if (drumMode) return;
    const all = allPresets();
    const groups = [...new Set(all.map((p) => p.group))].sort((a, b) => (a === "MY PRESETS" ? -1 : b === "MY PRESETS" ? 1 : 0));
    groups.forEach((label) => {
        const group = document.createElement("optgroup");
        group.label = label;
        all.filter((p) => p.group === label).forEach((p) => {
            const option = document.createElement("option");
            option.value = p.value;
            option.textContent = p.name;
            group.appendChild(option);
        });
        soundSelect.appendChild(group);
    });
}

// puts a preset (the picker's value for it, like f:Acid Bass) on the selected synth track, and plays a note so you hear it
function applyPresetValue(value) {
    const p = allPresets().find((entry) => entry.value === value);
    if (!p || selTrack === DRUM_TRACK) return showSound();
    getCtx();
    Object.assign(trackSettings[selTrack], cleanPresetSettings(p.settings, selTrack));
    applyFx(selTrack);
    applyFilter(selTrack);
    showSound();
    previewNote(60);
}

// the picker lists what's saved now
function refreshPresetOptions() {
    listShown = null;
    showSound();
}

function presetsChanged(message) {
    presetStatus.textContent = message;
    refreshPresetOptions();
    showPresetList();
}

function savePreset() {
    if (selTrack === DRUM_TRACK) return;
    const name = cleanPresetName(presetName.value);
    if (!name) {
        presetStatus.textContent = "Type a name for the preset first.";
        return;
    }
    const list = storedPresets();
    const at = list.findIndex((p) => sameName(p.name, name));
    const preset = { name, settings: presetSettingsOf(selTrack) };
    if (at >= 0) list[at] = preset;
    else list.push(preset);
    if (!keepPresets(list)) {
        presetStatus.textContent = "The browser would not keep it (its storage is full).";
        return;
    }
    presetsChanged((at >= 0 ? "Saved over " : "Saved ") + name + ". It is in the sound picker under MY PRESETS.");
}

function renamePreset(preset, text) {
    const name = cleanPresetName(text);
    renamingPreset = null;
    if (!name || name === preset.name) return showPresetList();
    const list = storedPresets();
    if (list.some((p) => p.name !== preset.name && sameName(p.name, name))) {
        presetStatus.textContent = "There is already a preset called " + name + ".";
        return showPresetList();
    }
    const found = list.find((p) => p.name === preset.name);
    if (found) found.name = name;
    keepPresets(list);
    presetsChanged("Renamed to " + name + ".");
}

function deletePreset(preset) {
    keepPresets(storedPresets().filter((p) => p.name !== preset.name));
    presetsChanged("Deleted " + preset.name + ".");
}

function presetRow(preset) {
    const row = make("div", "song-row");
    const info = make("div", "song-info");
    const renaming = renamingPreset === preset.name;
    let box;
    if (renaming) {
        box = make("input", "text-input");
        box.type = "text";
        box.maxLength = PRESET_NAME_MAX;
        box.value = preset.name;
        box.setAttribute("aria-label", "New name for " + preset.name);
        box.addEventListener("keydown", (e) => {
            if (e.key === "Enter") renamePreset(preset, box.value);
            if (e.key === "Escape") {
                e.stopPropagation(); // (the popup stays, only the renaming stops)
                renamingPreset = null;
                showPresetList();
            }
        });
        info.appendChild(box);
    } else {
        info.appendChild(make("div", "song-title", preset.name));
    }
    const base = SOUNDS[cleanPresetSettings(preset.settings, 1).sound];
    info.appendChild(make("div", "song-meta", "Based on " + (base ? base.name : "a sound")));

    const actions = make("div", "song-actions preset-actions");
    const apply = songButton("USE", "Use " + preset.name + " on the selected track", () => applyPresetValue("p:" + preset.name));
    apply.disabled = selTrack === DRUM_TRACK;
    const rename = songButton(renaming ? "OK" : "RENAME", (renaming ? "Finish renaming " : "Rename ") + preset.name, () => {
        if (renaming) return renamePreset(preset, box.value);
        renamingPreset = preset.name;
        showPresetList();
    });
    const remove = songButton("DELETE", "Delete " + preset.name, () => askFirst(remove, "SURE?", () => deletePreset(preset)));
    actions.append(apply, rename, remove);
    row.append(info, actions);
    if (renaming) setTimeout(() => box.focus(), 0);
    return row;
}

function showPresetList() {
    const list = storedPresets();
    presetList.innerHTML = "";
    if (!list.length) {
        presetList.appendChild(make("p", "song-empty", "Nothing saved yet. Save a sound with the box above and it shows up here and in the sound picker."));
        return;
    }
    list.forEach((p) => presetList.appendChild(presetRow(p)));
}

registerPanel("presets", presetButton, presetPopover, null, () => {
    const drums = selTrack === DRUM_TRACK;
    presetTitle.textContent = drums ? "PRESETS ARE FOR THE SYNTH TRACKS" : "SAVE THIS SOUND AS A PRESET";
    presetForm.hidden = drums;
    const match = drums ? null : matchingPreset(selTrack);
    presetName.value = match && match.startsWith("p:") ? match.slice(2) : ""; // (the name of your own preset that this is)
    presetStatus.textContent = drums
        ? "Pick one of the synth tracks to save or use a preset."
        : FACTORY_PRESETS.length + " built-in presets are in the sound picker too, in the groups that start with PRESET.";
    renamingPreset = null;
    showPresetList();
    if (typeof openLab === "function") openLab(); // (the random and morph part of the popup, soundlab.js)
}, { popupOnly: true }); // a popup on a phone too

document.getElementById("presetSave").addEventListener("click", savePreset);
presetName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") savePreset();
});

refreshPresetOptions(); // (the dropdown was filled before this was loaded)
