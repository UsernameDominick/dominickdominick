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

// ---- what each drum has, on its own (the drum track's dials follow the selected drum) ----
// pan: where it is, dly and rev: how much goes to the echo and the room, pitch and decay: how it's tuned and how long it rings
const drumFx = DRUM_NOTES.map(() => ({ pan: 0.5, dly: 0, rev: 0, pitch: 0.5, decay: 0.5 }));
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

function setDrumFx(note, key, v) {
    drumFxAt(note)[key] = v;
    try {
        localStorage.setItem("drumFx", JSON.stringify(drumFx));
    } catch {}
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
const activeFilters = Array.from({ length: TRACKS }, () => new Set()); // the filters of the notes sounding now, for each track
const lastFrequency = new Array(TRACKS).fill(0); // the last note each track played, for the glide

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

// builds all of it, once, when the audio starts (getCtx calls this)
function buildTrackChains() {
    reverbIn = ctx.createConvolver();
    reverbIn.buffer = makeRoom();
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.7;
    reverbIn.connect(reverbOut);
    reverbOut.connect(master);

    // the drive curve: the louder it goes in, the more it's squashed into a soft limit
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(3 * ((i / (curve.length - 1)) * 2 - 1));

    for (let t = 0; t < TRACKS; t++) {
        // the drum track's own filter (a drum hit goes through it, a synth note has its own filter instead)
        const filter = ctx.createBiquadFilter();
        const bus = ctx.createGain();
        filter.connect(bus);

        // drive: some of the sound goes through the squashing and some doesn't (DRIVE is how much)
        const dry = ctx.createGain();
        const pre = ctx.createGain();
        const shaper = ctx.createWaveShaper();
        shaper.curve = curve;
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
        const trackGain = ctx.createGain();
        trackGain.gain.value = t === DRUM_TRACK ? 1 : trackSettings[t].volume;
        trem.connect(pan);
        pan.connect(trackGain);
        trackGain.connect(master);

        // the echo: the sound goes into a delay that feeds itself (a little duller each time round)
        const dSend = ctx.createGain();
        const delay = ctx.createDelay(4);
        const feedback = ctx.createGain();
        const tone = ctx.createBiquadFilter();
        tone.type = "lowpass";
        tone.frequency.value = 3500;
        trackGain.connect(dSend);
        dSend.connect(delay);
        delay.connect(tone);
        tone.connect(feedback);
        feedback.connect(delay);
        delay.connect(master);

        // the room
        const rSend = ctx.createGain();
        trackGain.connect(rSend);
        rSend.connect(reverbIn);

        // what the filter of each note follows, and the vibrato
        const cut = ctx.createConstantSource();
        const res = ctx.createConstantSource();
        cut.start();
        res.start();
        const vib = ctx.createOscillator();
        const vibDepth = ctx.createGain();
        vib.connect(vibDepth);
        vib.start();

        trackFilters.push(filter);
        trackGains.push(trackGain);
        trackBus.push(bus);
        driveDry.push(dry);
        drivePre.push(pre);
        drivePost.push(post);
        driveWet.push(wet);
        tremGain.push(trem);
        tremDepth.push(depth);
        tremLfo.push(tremWave);
        trackPan.push(pan);
        dlySend.push(dSend);
        dlyNode.push(delay);
        dlyFeedback.push(feedback);
        revSend.push(rSend);
        vibLfo.push(vib);
        vibGain.push(vibDepth);
        cutCtl.push(cut);
        resCtl.push(res);

        applyFilter(t);
        applyFx(t);
        trackGain.gain.value = t === DRUM_TRACK ? 1 : trackSettings[t].volume;
    }
}

// puts the filter settings of a track on its filters (the drum track's own filter, and the control signals every note's
// filter follows). Notes that are sounding change type at once
function applyFilter(t) {
    if (!ctx || !trackFilters[t]) return;
    const s = trackSettings[t];
    const now = ctx.currentTime;
    const hz = cutoffFromSlider(s.cutoff);
    const dB = resonanceFromSlider(s.resonance);
    const type = filterTypeFrom(s.ftype);
    cutCtl[t].offset.setTargetAtTime(1200 * Math.log2(hz / FILTER_BASE), now, 0.015);
    resCtl[t].offset.setTargetAtTime(dB, now, 0.015);
    const filter = trackFilters[t];
    filter.type = type;
    filter.frequency.setTargetAtTime(hz, now, 0.015);
    filter.Q.setTargetAtTime(type === "bandpass" ? 0.7 + dB : dB, now, 0.015);
    activeFilters[t].forEach((f) => (f.type = type));
}

// puts everything else a track has on its nodes: the drive, the tremolo, the vibrato, the pan, the echo and the room
function applyFx(t) {
    if (!ctx || !trackPan[t]) return;
    const s = trackSettings[t];
    const now = ctx.currentTime;
    const smooth = 0.02;
    const drums = t === DRUM_TRACK;

    trackPan[t].pan.setTargetAtTime(drums ? 0 : panFrom(s.pan), now, smooth); // (each drum is panned as it's hit)

    // drive: how much goes through the squashing, and how hard it's pushed. The squashed sound is brought back down so it's
    // about as loud as the clean one
    const push = 1 + 14 * s.drive;
    drivePre[t].gain.setTargetAtTime(push, now, smooth);
    drivePost[t].gain.setTargetAtTime(0.3 / Math.tanh(3 * Math.min(1, 0.3 * push)), now, smooth);
    driveWet[t].gain.setTargetAtTime(s.drive, now, smooth);
    driveDry[t].gain.setTargetAtTime(1 - s.drive, now, smooth);

    // tremolo: the volume swings between full and (1 - depth)
    tremGain[t].gain.setTargetAtTime(1 - s.tdep / 2, now, smooth);
    tremDepth[t].gain.setTargetAtTime(s.tdep / 2, now, smooth);
    tremLfo[t].frequency.setTargetAtTime(tremRateHz(s.trate), now, smooth);

    vibLfo[t].frequency.setTargetAtTime(vibRateHz(s.vrate), now, smooth);
    vibGain[t].gain.setTargetAtTime(vibCents(s.vdep), now, smooth);

    // the echo and the room (a drum is sent by its own amounts as it's hit, so the drum track's are off)
    dlySend[t].gain.setTargetAtTime(drums ? 0 : s.dly * 0.8, now, smooth);
    dlyFeedback[t].gain.setTargetAtTime(s.dfb * 0.85, now, smooth);
    revSend[t].gain.setTargetAtTime(drums ? 0 : s.rev * 0.8, now, smooth);
    updateDelayTimes(t);
}

// the echo is in time with the song, so it follows the BPM (studio.js calls this when the BPM changes)
function updateDelayTimes(only) {
    if (!ctx || !dlyNode.length) return;
    for (let t = 0; t < TRACKS; t++) {
        if (only !== undefined && t !== only) continue;
        const seconds = (DELAY_BEATS[delayIndex(trackSettings[t].dtime)] * 60) / bpm;
        dlyNode[t].delayTime.setTargetAtTime(Math.min(3.9, seconds), ctx.currentTime, 0.03);
    }
}

// sends a sound to the echo and the room (for a drum hit: each drum has its own amounts)
function sendTo(node, echo, room, track) {
    if (echo > 0) {
        const g = ctx.createGain();
        g.gain.value = echo * 0.8;
        node.connect(g);
        g.connect(dlyNode[track]);
    }
    if (room > 0) {
        const g = ctx.createGain();
        g.gain.value = room * 0.8;
        node.connect(g);
        g.connect(reverbIn);
    }
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
const DRUM_ONLY_KEYS = ["pitch", "decay"]; // these are only for a drum
const PER_DRUM_KEYS = ["pan", "dly", "rev", "pitch", "decay"]; // on the drum track these are each drum's own

// where a setting is kept for the selected sound
function getSetting(key) {
    return isDrums() && PER_DRUM_KEYS.includes(key) ? drumFxAt(selectedDrumNote)[key] : trackSettings[liveTrack][key];
}

function setSetting(key, v) {
    if (isDrums() && PER_DRUM_KEYS.includes(key)) {
        setDrumFx(selectedDrumNote, key, v);
        return;
    }
    trackSettings[liveTrack][key] = v;
    applyFx(liveTrack);
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
    { group: "filter", label: "TYPE", aria: "Filter type: low pass, high pass or band pass", scope: "both", def: 0, defDrums: 0, format: (v) => FILTER_TYPE_NAMES[Math.min(2, Math.round(v * 2))], id: "dial-ftype", step: 0.5,
      get: () => trackSettings[liveTrack].ftype, apply: (v) => { trackSettings[liveTrack].ftype = v; applyFilter(liveTrack); drawGraphs(); } },
    { group: "filter", label: "CUT", aria: "Filter cutoff", scope: "both", def: 1, defDrums: 1, format: (v) => formatCutoff(cutoffFromSlider(v)), id: "cutoffSlider",
      get: () => trackSettings[liveTrack].cutoff, apply: (v) => setCutoff(v) },
    { group: "filter", label: "RES", aria: "Filter resonance", scope: "both", def: 0, defDrums: 0, format: (v) => Math.round(resonanceFromSlider(v)) + "dB", id: "resonanceSlider",
      get: () => trackSettings[liveTrack].resonance, apply: (v) => setResonance(v) },
    settingDial("filter", "FENV", "fenv", "Filter envelope: how far the fade opens the filter", "synth", 0, (v) => "+" + fenvOctaves(v).toFixed(1)),
    // ENV
    { group: "env", label: "ATK", aria: "Attack time", scope: "both", def: DIAL_DEFAULTS.synth.attack, defDrums: DIAL_DEFAULTS.drums.attack, format: (v) => formatSeconds(attackFromSlider(v)), id: "attackSlider",
      get: () => trackSettings[liveTrack].attack, apply: (v) => setAttack(v) },
    { group: "env", label: "DEC", aria: "Decay time", scope: "both", def: DIAL_DEFAULTS.synth.decay, defDrums: DIAL_DEFAULTS.drums.decay, format: (v) => formatSeconds(decayFromSlider(v)), id: "decaySlider",
      get: () => trackSettings[liveTrack].decay, apply: (v) => setDecay(v) },
    { group: "env", label: "SUS", aria: "Sustain level", scope: "both", def: DIAL_DEFAULTS.synth.sustain, defDrums: DIAL_DEFAULTS.drums.sustain, format: pct, id: "sustainSlider",
      get: () => trackSettings[liveTrack].sustain, apply: (v) => setSustain(v) },
    { group: "env", label: "REL", aria: "Release time", scope: "both", def: DIAL_DEFAULTS.synth.release, defDrums: DIAL_DEFAULTS.drums.release, format: (v) => releaseFromSlider(v).toFixed(1) + "s", id: "releaseSlider",
      get: () => trackSettings[liveTrack].release, apply: (v) => setRelease(v) },
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
];
// the steps of the stepped dials, so they click from one choice to the next
DIALS.forEach((dial) => {
    if (dial.id === "dial-oct") dial.step = 0.25;
    if (dial.id === "dial-semi") dial.step = 1 / 24;
    if (dial.id === "dial-dtime") dial.step = 0.25;
});

const dialPanel = document.getElementById("dialPanel");
const dialEntries = []; // { spec, box, input, strip } for every dial
let dialTab = "sound";
try {
    const savedTab = localStorage.getItem("dialTab");
    if (DIAL_TABS.some((tab) => tab.id === savedTab)) dialTab = savedTab;
} catch {}

// builds the tabs and the dials (the knobs themselves are drawn by buildDial in synth.js)
function buildDialPanel() {
    const tabs = mk("div", "dial-tabs");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Which dials to show");
    const tabButtons = DIAL_TABS.map((tab) => {
        const button = mk("button", "dial-tab", tab.name);
        button.addEventListener("click", () => showDialTab(tab.id));
        tabs.appendChild(button);
        return button;
    });
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
    showDialTab(dialTab);
}
buildDialPanel();

// moves the dials to the selected sound's settings, and hides the ones that don't apply to it (studio.js calls this when you
// pick a track or a drum)
function showTrackSettings() {
    const drums = isDrums();
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
