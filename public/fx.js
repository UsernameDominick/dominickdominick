// more ways to shape a sound, and the dials that set them. Each track (and each drum on the drum track) can be given
// a pan, a drive (distortion), a detune, a glide, a filter type and filter envelope, an echo and a room (reverb), a
// vibrato and a tremolo, and be tuned up or down. The dials for all of them are in the box with the strips (container 4),
// in five tabs, and they change the sound that's selected (the one the sound picker shows).
// This needs synth.js, drums.js and params.js loaded first.

// makes an element with a class and some text (studio.js has the same, but it loads after this file)
function mk(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    if (text) el.textContent = text;
    return el;
}

// ---- what each dial means ----

const FILTER_BASE = 1000; // a note's filter starts at this cutoff and the CUT dial moves it (in cents) from there, see playNote
const FILTER_TYPE_NAMES = ["LP", "HP", "BP"];
const DELAY_BEATS = [0.25, 0.5, 0.75, 1, 2]; // how long the echo is, in beats: a 16th, an 8th, a dotted 8th, a quarter, a half
const DELAY_NAMES = ["1/16", "1/8", "3/16", "1/4", "1/2"];

function panFrom(v) {
    return (v - 0.5) * 2; // -1 (left) to 1 (right)
}
function octFrom(v) {
    return Math.round((v - 0.5) * 4); // -2 to 2 octaves
}
function semiFrom(v) {
    return Math.round((v - 0.5) * 24); // -12 to 12 semitones
}
function detuneCents(v) {
    return v * 40; // how far the three copies of a sound are spread apart
}
function glideSeconds(v) {
    return v * 0.6; // how long a note takes to slide from the one before it
}
function fenvOctaves(v) {
    return v * 5; // how many octaves the filter opens up by at the top of the fade
}
function delayIndex(v) {
    return Math.min(DELAY_BEATS.length - 1, Math.round(v * (DELAY_BEATS.length - 1)));
}
function vibRateHz(v) {
    return 0.5 * 24 ** v; // 0.5 to 12 Hz
}
function vibCents(v) {
    return v * 100; // how far the pitch swings each way
}
function tremRateHz(v) {
    return 0.5 * 32 ** v; // 0.5 to 16 Hz
}
function pitchSemis(v) {
    return Math.round((v - 0.5) * 24); // a drum's pitch, -12 to 12 semitones
}
function drumDecayScale(v) {
    return 4 ** (2 * v - 1); // how many times longer than usual a drum rings: a quarter to four times
}

// ---- what each drum has, on its own (the dials follow the selected drum) ----
// Every dial is each drum's own, so turning one changes the selected drum and nothing else:
//   pan: where it is, dly and rev: how much goes to the echo and the room, pitch and decay: how it's tuned and how long it rings
//   drive, ftype, cutoff and resonance: the distortion and the filter, attack, edecay, sustain and release: the fade it is given
//   (edecay is the fade's DEC dial: a drum's own decay is how long it rings), dtime and dfb: the echo's time and repeats, trate
//   and tdep: the tremolo. They all start with no change to the sound
const DRUM_FX_DEFAULTS = {
    pan: 0.5, dly: 0, rev: 0, pitch: 0.5, decay: 0.5,
    drive: 0, ftype: 0, cutoff: 1, resonance: 0,
    attack: DIAL_DEFAULTS.drums.attack, edecay: DIAL_DEFAULTS.drums.decay, sustain: DIAL_DEFAULTS.drums.sustain, release: DIAL_DEFAULTS.drums.release,
    dtime: FX_DEFAULTS.dtime, dfb: FX_DEFAULTS.dfb, trate: FX_DEFAULTS.trate, tdep: FX_DEFAULTS.tdep,
};
const drumFx = DRUM_NOTES.map(() => ({ ...DRUM_FX_DEFAULTS }));
try {
    const savedFx = JSON.parse(localStorage.getItem("drumFx"));
    if (Array.isArray(savedFx) && savedFx.length === drumFx.length) {
        savedFx.forEach((entry, i) => {
            for (const key in drumFx[i]) if (entry && typeof entry[key] === "number" && entry[key] >= 0 && entry[key] <= 1) drumFx[i][key] = entry[key];
        });
    }
} catch {}

function drumFxAt(note) {
    return drumFx[drumSlot(note)];
}

function saveDrumFx() {
    try {
        localStorage.setItem("drumFx", JSON.stringify(drumFx));
    } catch {}
}

function setDrumFx(note, key, v) {
    drumFxAt(note)[key] = v;
    saveDrumFx();
    applyDrumChannel(drumSlot(note));
}

// ---- the audio: what every track's sound goes through after its notes ----
// notes -> the track's bus -> drive -> tremolo -> pan -> the track's volume -> the song's volume, with the echo and the
// room as side branches off the volume. The vibrato and the controls for each note's filter are made here too.

const trackBus = [];
const driveDry = [];
const drivePre = [];
const drivePost = [];
const driveWet = [];
const tremGain = [];
const tremDepth = [];
const tremLfo = [];
const trackPan = [];
const dlySend = [];
const dlyNode = [];
const dlyFeedback = [];
const revSend = [];
const vibLfo = [];
const vibGain = [];
const cutCtl = []; // a signal for each track that the cutoff of every one of its notes' filters follows (in cents)
const resCtl = []; // and the same for the resonance
let reverbIn; // the room, shared by all tracks
const activeFilters = Array.from({ length: MAX_TRACKS }, () => new Set()); // the filters of the notes sounding now, for each track
const lastFrequency = new Array(MAX_TRACKS).fill(0); // the last note each track played, for the glide

// a room: two channels of noise that fades away, which the convolver turns into reverb
function makeRoom() {
    const length = Math.floor(ctx.sampleRate * 2.4);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3.5;
    }
    return buffer;
}

// the drive curve: the louder it goes in, the more it's squashed into a soft limit
const DRIVE_CURVE = new Float32Array(2048);
for (let i = 0; i < DRIVE_CURVE.length; i++) DRIVE_CURVE[i] = Math.tanh(3 * ((i / (DRIVE_CURVE.length - 1)) * 2 - 1));

// makes one chain of the nodes a sound goes through, and gives them back: a filter that is where a sound goes in (a drum hit
// goes into it, a synth note has a filter of its own instead) into the bus, then drive, tremolo, pan, the volume and the song's
// volume, with an echo and a send to the room (the room is shared). A track has one, and so does each drum (a drum has
// the same dials as a track, and each drum's own)
function makeChain() {
    const filter = ctx.createBiquadFilter();
    const bus = ctx.createGain();
    filter.connect(bus);

    // drive: some of the sound goes through the squashing and some doesn't (DRIVE is how much)
    const dry = ctx.createGain();
    const pre = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = DRIVE_CURVE;
    shaper.oversample = "2x";
    const post = ctx.createGain();
    const wet = ctx.createGain();
    const trem = ctx.createGain();
    bus.connect(dry);
    dry.connect(trem);
    bus.connect(pre);
    pre.connect(shaper);
    shaper.connect(post);
    post.connect(wet);
    wet.connect(trem);

    // tremolo: a slow wave (an LFO) turns the volume up and down
    const tremWave = ctx.createOscillator();
    const depth = ctx.createGain();
    tremWave.connect(depth);
    depth.connect(trem.gain);
    tremWave.start();

    const pan = ctx.createStereoPanner();
    const gain = ctx.createGain();
    trem.connect(pan);
    pan.connect(gain);
    gain.connect(master);

    // the echo: the sound goes into a delay that feeds itself (a little duller each time round)
    const dSend = ctx.createGain();
    const delay = ctx.createDelay(4);
    const feedback = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3500;
    gain.connect(dSend);
    dSend.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    delay.connect(master);

    // the room
    const rSend = ctx.createGain();
    gain.connect(rSend);
    rSend.connect(reverbIn);

    return { filter, bus, dry, pre, post, wet, trem, tremWave, depth, pan, gain, dSend, delay, feedback, rSend };
}

// builds all of it, once, when the audio starts (getCtx calls this)
function buildTrackChains() {
    reverbIn = ctx.createConvolver();
    reverbIn.buffer = makeRoom();
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.7;
    reverbIn.connect(reverbOut);
    reverbOut.connect(master);

    for (let t = 0; t < MAX_TRACKS; t++) { // (for every track the song could have, so adding one later needs nothing built)
        const c = makeChain();

        // what the filter of each note follows, and the vibrato
        const cut = ctx.createConstantSource();
        const res = ctx.createConstantSource();
        cut.start();
        res.start();
        const vib = ctx.createOscillator();
        const vibDepth = ctx.createGain();
        vib.connect(vibDepth);
        vib.start();

        trackFilters.push(c.filter);
        trackGains.push(c.gain);
        trackBus.push(c.bus);
        driveDry.push(c.dry);
        drivePre.push(c.pre);
        drivePost.push(c.post);
        driveWet.push(c.wet);
        tremGain.push(c.trem);
        tremDepth.push(c.depth);
        tremLfo.push(c.tremWave);
        trackPan.push(c.pan);
        dlySend.push(c.dSend);
        dlyNode.push(c.delay);
        dlyFeedback.push(c.feedback);
        revSend.push(c.rSend);
        vibLfo.push(vib);
        vibGain.push(vibDepth);
        cutCtl.push(cut);
        resCtl.push(res);

        applyFilter(t, true);
        applyFx(t, true);
        c.gain.gain.value = t === DRUM_TRACK ? 1 : trackSettings[t].volume;
    }
}

// a track's chain, put together from the lists of its nodes
function chainOf(t) {
    return {
        filter: trackFilters[t], bus: trackBus[t], dry: driveDry[t], pre: drivePre[t], post: drivePost[t], wet: driveWet[t],
        trem: tremGain[t], tremWave: tremLfo[t], depth: tremDepth[t], pan: trackPan[t], gain: trackGains[t], dSend: dlySend[t],
        delay: dlyNode[t], feedback: dlyFeedback[t], rSend: revSend[t],
    };
}

// puts a value on a node's setting: it glides there (so turning a dial doesn't click), or, for a chain that has just been made
// (instant), it is there at once, because a new chain starts out as the browser makes it (a filter at 350Hz, the drive all the
// way up) and the first sound through it would be wrong while it glided
function setParam(param, value, instant, now, smooth) {
    if (instant) param.value = value;
    else param.setTargetAtTime(value, now, smooth);
}

// the filter of a chain, from the settings (a track's or a drum's: they have the same names)
function applyChainFilter(c, s, instant = false) {
    const now = ctx.currentTime;
    const dB = resonanceFromSlider(s.resonance);
    const type = filterTypeFrom(s.ftype);
    c.filter.type = type;
    setParam(c.filter.frequency, cutoffFromSlider(s.cutoff), instant, now, 0.015);
    setParam(c.filter.Q, type === "bandpass" ? 0.7 + dB : dB, instant, now, 0.015);
}

// everything else a chain has, from the settings: the pan, the drive, the tremolo, the echo and the room
function applyChainFx(c, s, instant = false) {
    const now = ctx.currentTime;
    const smooth = 0.02;
    const set = (param, value, time = smooth) => setParam(param, value, instant, now, time);
    set(c.pan.pan, panFrom(s.pan));

    // drive: how much goes through the squashing, and how hard it's pushed. The squashed sound is brought back down so it's
    // about as loud as the clean one
    const push = 1 + 14 * s.drive;
    set(c.pre.gain, push);
    set(c.post.gain, 0.3 / Math.tanh(3 * Math.min(1, 0.3 * push)));
    set(c.wet.gain, s.drive);
    set(c.dry.gain, 1 - s.drive);

    // tremolo: the volume swings between full and (1 - depth)
    set(c.trem.gain, 1 - s.tdep / 2);
    set(c.depth.gain, s.tdep / 2);
    set(c.tremWave.frequency, tremRateHz(s.trate));

    // the echo and the room
    set(c.dSend.gain, s.dly * 0.8);
    set(c.feedback.gain, s.dfb * 0.85);
    set(c.rSend.gain, s.rev * 0.8);
    set(c.delay.delayTime, echoSeconds(s), 0.03);
}

// how long the echo is, in seconds, from the settings (it's in time with the song)
function echoSeconds(s) {
    return Math.min(3.9, (DELAY_BEATS[delayIndex(s.dtime)] * 60) / bpm);
}

// puts the filter settings of a track on its chain, and on the control signals every note's filter follows. Notes that are
// sounding change type at once
function applyFilter(t, instant = false) {
    if (!ctx || !trackFilters[t]) return;
    const s = trackSettings[t];
    const now = ctx.currentTime;
    setParam(cutCtl[t].offset, 1200 * Math.log2(cutoffFromSlider(s.cutoff) / FILTER_BASE), instant, now, 0.015);
    setParam(resCtl[t].offset, resonanceFromSlider(s.resonance), instant, now, 0.015);
    applyChainFilter(chainOf(t), s, instant);
    activeFilters[t].forEach((f) => (f.type = filterTypeFrom(s.ftype)));
}

// puts everything else a track has on its nodes: the drive, the tremolo, the vibrato, the pan, the echo and the room
function applyFx(t, instant = false) {
    if (!ctx || !trackPan[t]) return;
    const s = trackSettings[t];
    applyChainFx(chainOf(t), s, instant);
    setParam(vibLfo[t].frequency, vibRateHz(s.vrate), instant, ctx.currentTime, 0.02);
    setParam(vibGain[t].gain, vibCents(s.vdep), instant, ctx.currentTime, 0.02);
}

// the echo is in time with the song, so it follows the BPM (studio.js calls this when the BPM changes)
function updateDelayTimes(only) {
    if (!ctx || !dlyNode.length) return;
    for (let t = 0; t < MAX_TRACKS; t++) {
        if (only !== undefined && t !== only) continue;
        dlyNode[t].delayTime.setTargetAtTime(echoSeconds(trackSettings[t]), ctx.currentTime, 0.03);
    }
    if (only === undefined) drumChannels.forEach((c, slot) => c && c.delay.delayTime.setTargetAtTime(echoSeconds(drumFx[slot]), ctx.currentTime, 0.03));
}

// ---- each drum's own chain ----
// A drum hit goes through the chain of its drum, made the first time that drum is hit, so each drum can have its own filter,
// drive, fade, echo, room, pan and tremolo (the dials change the selected drum, not all of them)
const drumChannels = new Array(DRUM_NOTES.length).fill(null);

function drumChannel(slot) {
    if (!drumChannels[slot]) {
        drumChannels[slot] = makeChain();
        applyDrumChannel(slot, true);
    }
    return drumChannels[slot];
}

// puts a drum's settings on its chain (if it has been made)
function applyDrumChannel(slot, instant = false) {
    const c = drumChannels[slot];
    if (!c || !ctx) return;
    applyChainFilter(c, drumFx[slot], instant);
    applyChainFx(c, drumFx[slot], instant);
}

// opens a note's filter with its fade: it starts at the cutoff and opens up by octs octaves as the note rises, and
// closes down again to the cutoff as it falls to the sustain level. (If the note is let go before it finishes,
// the release carries on from where it is)
function scheduleFilterEnvelope(param, now, env, held, octs) {
    param.setValueAtTime(FILTER_BASE, now);
    const attackEnd = Math.min(held, env.attack);
    param.exponentialRampToValueAtTime(FILTER_BASE * 2 ** (octs * envelopeLevel(attackEnd, env, 1)), now + attackEnd);
    if (held > env.attack) {
        const decayEnd = Math.min(held, env.attack + env.decay);
        param.exponentialRampToValueAtTime(FILTER_BASE * 2 ** (octs * envelopeLevel(decayEnd, env, 1)), now + decayEnd);
    }
}

// ---- the dials ----
// Five tabs, each with a group of dials. The dials that don't apply to the selected sound are hidden (a drum has no
// glide, a synth sound has no drum pitch). Each dial has: where to find its value for the selected sound, what to do
// when it's turned, and how to write its value.

const isDrums = () => liveTrack === DRUM_TRACK;
// A dial's setting is kept in the selected synth track, or on the drum track in the selected drum (see drumFx). The fade's DEC
// dial is called envdecay here, because a drum keeps it as edecay (its decay is how long it rings) and a track as decay
const DRUM_SETTING_KEYS = { envdecay: "edecay" };
const TRACK_SETTING_KEYS = { envdecay: "decay" };

// where a setting is kept for the selected sound
function getSetting(key) {
    if (isDrums()) return drumFxAt(selectedDrumNote)[DRUM_SETTING_KEYS[key] || key];
    return trackSettings[liveTrack][TRACK_SETTING_KEYS[key] || key];
}

function setSetting(key, v) {
    if (isDrums()) {
        setDrumFx(selectedDrumNote, DRUM_SETTING_KEYS[key] || key, v);
    } else {
        trackSettings[liveTrack][TRACK_SETTING_KEYS[key] || key] = v;
        applyFx(liveTrack);
        applyFilter(liveTrack);
    }
    drawGraphs(); // (the filter and the fade graphs follow the dials)
}

const pct = (v) => Math.round(v * 100) + "%";
const signed = (n) => (n > 0 ? "+" + n : String(n));

// a dial for a setting that's kept in the selected sound (or the selected drum) and is applied by applyFx
const settingDial = (group, label, key, aria, scope, def, format, defDrums = def) => ({
    group, label, aria, scope, def, defDrums, format, id: "dial-" + key,
    get: () => getSetting(key),
    apply: (v) => setSetting(key, v),
});

const DIAL_TABS = [
    { id: "sound", name: "SOUND" },
    { id: "filter", name: "FILTER" },
    { id: "env", name: "ENV" },
    { id: "fx", name: "FX" },
    { id: "mod", name: "MOD" },
    { id: "play", name: "PLAY" },
];

const DIALS = [
    // SOUND
    { group: "sound", label: "VOL", aria: "Volume of the selected sound", scope: "both", def: 0.5, defDrums: 0.5, format: pct, id: "gainSlider", get: () => selectedVolume(), apply: (v) => setVolume(v) },
    settingDial("sound", "PAN", "pan", "Pan of the selected sound, left to right", "both", 0.5, (v) => (Math.abs(v - 0.5) < 0.01 ? "C" : (v < 0.5 ? "L" : "R") + Math.round(Math.abs(v - 0.5) * 200))),
    settingDial("sound", "OCT", "oct", "Tune the selected sound up or down in octaves", "synth", 0.5, (v) => signed(octFrom(v))),
    settingDial("sound", "SEMI", "semi", "Tune the selected sound up or down in semitones", "synth", 0.5, (v) => signed(semiFrom(v))),
    settingDial("sound", "DETUNE", "detune", "Detune: spreads three copies of the sound apart", "synth", 0, (v) => Math.round(detuneCents(v)) + "c"),
    settingDial("sound", "GLIDE", "glide", "Glide: how long a note takes to slide from the one before", "synth", 0, (v) => Math.round(glideSeconds(v) * 1000) + "ms"),
    settingDial("sound", "DRIVE", "drive", "Drive: distortion", "both", 0, pct),
    settingDial("sound", "PITCH", "pitch", "Pitch of the selected drum", "drums", 0.5, (v) => signed(pitchSemis(v))),
    settingDial("sound", "DECAY", "decay", "How long the selected drum rings", "drums", 0.5, (v) => "x" + drumDecayScale(v).toFixed(2)),
    // FILTER
    settingDial("filter", "TYPE", "ftype", "Filter type: low pass, high pass or band pass", "both", 0, (v) => FILTER_TYPE_NAMES[Math.min(2, Math.round(v * 2))]),
    { ...settingDial("filter", "CUT", "cutoff", "Filter cutoff", "both", 1, (v) => formatCutoff(cutoffFromSlider(v))), id: "cutoffSlider" },
    { ...settingDial("filter", "RES", "resonance", "Filter resonance", "both", 0, (v) => Math.round(resonanceFromSlider(v)) + "dB"), id: "resonanceSlider" },
    settingDial("filter", "FENV", "fenv", "Filter envelope: how far the fade opens the filter", "synth", 0, (v) => "+" + fenvOctaves(v).toFixed(1)),
    // ENV
    { ...settingDial("env", "ATK", "attack", "Attack time", "both", DIAL_DEFAULTS.synth.attack, (v) => formatSeconds(attackFromSlider(v)), DIAL_DEFAULTS.drums.attack), id: "attackSlider" },
    { ...settingDial("env", "DEC", "envdecay", "Decay time", "both", DIAL_DEFAULTS.synth.decay, (v) => formatSeconds(decayFromSlider(v)), DIAL_DEFAULTS.drums.decay), id: "decaySlider" },
    { ...settingDial("env", "SUS", "sustain", "Sustain level", "both", DIAL_DEFAULTS.synth.sustain, pct, DIAL_DEFAULTS.drums.sustain), id: "sustainSlider" },
    { ...settingDial("env", "REL", "release", "Release time", "both", DIAL_DEFAULTS.synth.release, (v) => releaseFromSlider(v).toFixed(1) + "s", DIAL_DEFAULTS.drums.release), id: "releaseSlider" },
    // FX
    settingDial("fx", "DLY", "dly", "Echo: how much of the sound goes to the echo", "both", 0, pct),
    settingDial("fx", "DTIME", "dtime", "Echo time, in time with the song", "both", 0.25, (v) => DELAY_NAMES[delayIndex(v)]),
    settingDial("fx", "DFB", "dfb", "Echo feedback: how many times it repeats", "both", 0.35, pct),
    settingDial("fx", "REV", "rev", "Room: how much of the sound goes to the reverb", "both", 0, pct),
    // MOD
    settingDial("mod", "VRATE", "vrate", "Vibrato speed", "synth", 0.4, (v) => vibRateHz(v).toFixed(1)),
    settingDial("mod", "VDEP", "vdep", "Vibrato depth", "synth", 0, (v) => Math.round(vibCents(v)) + "c"),
    settingDial("mod", "TRATE", "trate", "Tremolo speed", "both", 0.4, (v) => tremRateHz(v).toFixed(1)),
    settingDial("mod", "TDEP", "tdep", "Tremolo depth", "both", 0, pct),
    // PLAY (chords and the arpeggiator, played in playNote in synth.js)
    settingDial("play", "CHORD", "chord", "Chord: more notes played with each note", "synth", 0, (v) => CHORDS[placeOf(v, CHORDS.length)].name),
    settingDial("play", "ARP", "arp", "Arpeggio: plays the chord one note after another, in this order", "synth", 0, (v) => ARP_MODES[placeOf(v, ARP_MODES.length)]),
    settingDial("play", "RATE", "arate", "Arpeggio speed, in time with the song", "synth", 2 / 3, (v) => ARP_RATES[placeOf(v, ARP_RATES.length)].name),
];
// the steps of the stepped dials, so they click from one choice to the next
DIALS.forEach((dial) => {
    if (dial.id === "dial-oct") dial.step = 0.25;
    if (dial.id === "dial-semi") dial.step = 1 / 24;
    if (dial.id === "dial-dtime") dial.step = 0.25;
    if (dial.id === "dial-ftype") dial.step = 0.5;
    if (dial.id === "dial-chord") dial.step = 1 / (CHORDS.length - 1);
    if (dial.id === "dial-arp") dial.step = 1 / (ARP_MODES.length - 1);
    if (dial.id === "dial-arate") dial.step = 1 / (ARP_RATES.length - 1);
});

const dialPanel = document.getElementById("dialPanel");
const dialEntries = []; // { spec, box, input, strip } for every dial
let dialTab = "sound";
let selectDialTab; // shows a tab (buildDialPanel sets it)
let dialTabButtons = []; // the buttons of the tabs
try {
    const savedTab = localStorage.getItem("dialTab");
    if (DIAL_TABS.some((tab) => tab.id === savedTab)) dialTab = savedTab;
} catch {}

// builds the tabs and the dials (the knobs themselves are drawn by buildDial in synth.js)
function buildDialPanel() {
    const tabs = mk("div", "dial-tabs");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Which dials to show");
    const tabButtons = (dialTabButtons = DIAL_TABS.map((tab) => {
        const button = mk("button", "dial-tab", tab.name);
        button.addEventListener("click", () => showDialTab(tab.id));
        tabs.appendChild(button);
        return button;
    }));
    dialPanel.appendChild(tabs);

    const groups = {};
    DIAL_TABS.forEach((tab) => {
        groups[tab.id] = mk("div", "dial-group");
        dialPanel.appendChild(groups[tab.id]);
    });

    DIALS.forEach((spec) => {
        const box = mk("div", "dial");
        box.dataset.default = spec.def;
        const label = mk("label", "", spec.label);
        label.htmlFor = spec.id;
        const face = mk("div", "dial-face");
        const input = document.createElement("input");
        input.type = "range";
        input.className = "dial-input";
        input.id = spec.id;
        input.min = "0";
        input.max = "1";
        input.step = String(spec.step || 0.01);
        input.value = String(spec.def);
        input.setAttribute("aria-label", spec.aria);
        const output = document.createElement("output");
        output.htmlFor = spec.id;
        output.setAttribute("aria-hidden", "true");
        output.textContent = spec.format(spec.def);
        box.append(label, face, input, output);
        groups[spec.group].appendChild(box);
        buildDial(box);
        setUpDialDrag(box, input);
        const strip = setUpStrip(input, spec.format, spec.apply);
        dialEntries.push({ spec, box, input, strip });
    });

    function showDialTab(id) {
        dialTab = id;
        try {
            localStorage.setItem("dialTab", id);
        } catch {}
        DIAL_TABS.forEach((tab, i) => {
            groups[tab.id].hidden = tab.id !== id;
            tabButtons[i].setAttribute("aria-pressed", String(tab.id === id));
        });
    }
    selectDialTab = showDialTab;
    showDialTab(dialTab);
}
buildDialPanel();

// moves the dials to the selected sound's settings, and hides the ones that don't apply to it (studio.js calls this when you
// pick a track or a drum)
function showTrackSettings() {
    const drums = isDrums();
    // (the drums have no PLAY tab: no chords or arpeggios, a drum is a drum)
    const playTab = DIAL_TABS.findIndex((tab) => tab.id === "play");
    dialTabButtons[playTab].disabled = drums;
    if (drums && dialTab === "play") selectDialTab("sound");
    dialEntries.forEach(({ spec, box, input, strip }) => {
        const shown = spec.scope === "both" || (spec.scope === "drums") === drums;
        box.hidden = !shown;
        if (!shown) return;
        box.dataset.default = drums ? spec.defDrums : spec.def; // double-clicking puts it back to where this kind of sound starts
        input.value = spec.get();
        strip.update();
    });
    drawGraphs();
}
