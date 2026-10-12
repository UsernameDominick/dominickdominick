// more ways to shape a sound, and the dials that set them. Each track (and each drum on the drum track) can be given
// a pan, a drive (distortion), a detune, a glide, a filter type and filter envelope, an echo and a room (reverb), a
// vibrato and a tremolo, and be tuned up or down. The dials for all of them are in the box with the strips (container 4),
// in tabs, and they change the sound that's selected (the one the sound picker shows).
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
const FILTER_TYPE_NAMES = ["LP", "HP", "BP", "NOTCH", "PEAK"];
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
//   and tdep: the tremolo, e1f to e3q: the three EQ bands, roll and build: the roll. They all start with no change to the sound
const DRUM_FX_DEFAULTS = {
    roll: 0, build: 0, // (the PLAY tab: how fast the drum rolls, 0 is no roll, and how much the roll builds up. See playDrum)
    ...EQ_DEFAULTS,
    pan: 0.5, dly: 0, rev: 0, pitch: 0.5, decay: 0.5,
    drive: 0, ftype: 0, cutoff: 1, resonance: 0,
    attack: DIAL_DEFAULTS.drums.attack, edecay: DIAL_DEFAULTS.drums.decay, sustain: DIAL_DEFAULTS.drums.sustain, release: DIAL_DEFAULTS.drums.release,
    dtime: FX_DEFAULTS.dtime, dfb: FX_DEFAULTS.dfb, trate: FX_DEFAULTS.trate, tdep: FX_DEFAULTS.tdep,
};
const drumFx = DRUM_NOTES.map(() => ({ ...DRUM_FX_DEFAULTS }));
try {
    const savedFx = JSON.parse(localStorage.getItem("drumFx"));
    if (Array.isArray(savedFx) && savedFx.length === drumFx.length) {
        // (the filter types a drum had saved before there were five were 0, 0.5 and 1, and are moved to where those are now, once)
        const moveTypes = localStorage.getItem("filterTypes5") !== "1";
        savedFx.forEach((entry, i) => {
            for (const key in drumFx[i]) if (entry && typeof entry[key] === "number" && entry[key] >= 0 && entry[key] <= 1) drumFx[i][key] = entry[key];
            if (moveTypes) drumFx[i].ftype = legacyFilterType(drumFx[i].ftype);
        });
    }
    localStorage.setItem("filterTypes5", "1");
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
const trackEq = []; // the three EQ bands of each track (a list of three filters)
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
const trackRacks = []; // each track's effects rack (the chorus, phaser, flanger, crusher and compressor): { node, linked, timer }
let reverbs = []; // the rooms (one for each size, made the first time it is used), shared by all tracks: the convolver of each
const trackChains = []; // the whole chain of each track (everything makeChain gives back)
const activeFilters = Array.from({ length: MAX_TRACKS }, () => new Set()); // the filters of the notes sounding now, for each track
const lastFrequency = new Array(MAX_TRACKS).fill(0); // the last note each track played, for the glide

// a room: two channels of noise that fades away and gets duller as it goes (the high notes die first, as in a real room), after a few early
// reflections, which the convolver turns into reverb. A different noise in each channel makes it wide
function makeRoom(seconds) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        let low = 0;
        for (let i = 0; i < length; i++) {
            const t = i / length;
            low += ((Math.random() * 2 - 1) - low) * (0.12 + 0.88 * (1 - t) ** 2.5); // (a filter that closes as it goes)
            data[i] = low * (1 - t) ** 3.5 * (t < 0.01 ? t * 100 : 1);
        }
        // the first reflections: single clicks off the walls in the first 70ms, each quieter, in a different place in each channel
        for (let k = 0; k < 7; k++) {
            const at = Math.floor(rate * (0.007 + 0.009 * k * (1 + 0.37 * channel) + 0.004 * channel));
            if (at < length) data[at] += (k % 2 ? -1 : 1) * 0.9 * 0.78 ** k;
        }
    }
    return buffer;
}

// the convolver for a room size, made the first time something uses it
function roomNode(size) {
    if (!reverbs[size]) {
        const conv = ctx.createConvolver();
        conv.buffer = makeRoom(ROOM_SIZES[size].seconds);
        const out = ctx.createGain();
        out.gain.value = 0.7;
        conv.connect(out);
        out.connect(master);
        reverbs[size] = conv;
    }
    return reverbs[size];
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

    // the EQ: three bands one after another (a peaking filter boosts or cuts a part of the sound, and is no change at 0dB)
    const bands = [0, 1, 2].map(() => {
        const band = ctx.createBiquadFilter();
        band.type = "peaking";
        return band;
    });
    bus.connect(bands[0]);
    bands[0].connect(bands[1]);
    bands[1].connect(bands[2]);
    const eqOut = bands[2];

    // drive: some of the sound goes through the squashing and some doesn't (DRIVE is how much)
    const dry = ctx.createGain();
    const pre = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = DRIVE_CURVE;
    shaper.oversample = "2x";
    const post = ctx.createGain();
    const wet = ctx.createGain();
    const trem = ctx.createGain();
    eqOut.connect(dry);
    dry.connect(trem);
    eqOut.connect(pre);
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
    // ping pong: a second delay that the echoes bounce to and from, the first in the left speaker, the second in the right. With PING off
    // the sound goes round the first one alone and out in the middle, as it always did
    const delay2 = ctx.createDelay(4);
    const tone2 = ctx.createBiquadFilter();
    tone2.type = "lowpass";
    tone2.frequency.value = 3500;
    const cross = ctx.createGain();
    const cross2 = ctx.createGain();
    tone.connect(cross);
    cross.connect(delay2);
    delay2.connect(tone2);
    tone2.connect(cross2);
    cross2.connect(delay);
    const outCenter = ctx.createGain();
    delay.connect(outCenter);
    outCenter.connect(master);
    const outLeft = ctx.createGain();
    const panLeft = ctx.createStereoPanner();
    panLeft.pan.value = -1;
    delay.connect(outLeft);
    outLeft.connect(panLeft);
    panLeft.connect(master);
    const outRight = ctx.createGain();
    const panRight = ctx.createStereoPanner();
    panRight.pan.value = 1;
    delay2.connect(outRight);
    outRight.connect(panRight);
    panRight.connect(master);

    // the room: a send, then how long after the sound it starts (PRE), how dull it is (DAMP), and the size of room it goes to (one of the
    // gains is open, SIZE says which; each is joined to its room the first time it is opened)
    const rSend = ctx.createGain();
    gain.connect(rSend);
    const rPre = ctx.createDelay(0.25);
    const rDamp = ctx.createBiquadFilter();
    rDamp.type = "lowpass";
    rDamp.frequency.value = 16000;
    rSend.connect(rPre);
    rPre.connect(rDamp);
    const rSizes = ROOM_SIZES.map(() => {
        const g = ctx.createGain();
        g.gain.value = 0;
        rDamp.connect(g);
        return g;
    });

    return { filter, bus, bands, dry, pre, post, wet, trem, tremWave, depth, pan, gain, dSend, delay, feedback, rSend, delay2, cross, cross2, outCenter, outLeft, outRight, rPre, rDamp, rSizes, rJoined: ROOM_SIZES.map(() => false) };
}

// builds all of it, once, when the audio starts (getCtx calls this)
function buildTrackChains() {
    reverbs = []; // (a room is made the first time it is used, see roomNode)

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
        trackEq.push(c.bands);
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
        trackRacks.push({ node: null, linked: false, timer: 0 });
        trackChains.push(c);

        applyFilter(t, true);
        applyFx(t, true);
        applyRack(t, true);
        c.gain.gain.value = t === DRUM_TRACK ? 1 : trackSettings[t].volume;
    }
}

// The effects rack sits between a track's pan and its volume. It is only put in when one of its effects is turned on (a worklet costs
// something every moment, even for sound it does not change), and taken out again a moment after the last one is turned off, once its
// MIX has faded to nothing so nothing clicks. The drums have none
function applyRack(t, instant = false) {
    if (!ctx || !trackPan[t] || t === DRUM_TRACK) return;
    const rack = trackRacks[t];
    const s = trackSettings[t];
    const on = rackOn(s) && !safeEngine && ctx.rackReady === true;
    if (on || (rack.linked && rack.node)) {
        if (!rack.node) {
            rack.node = new AudioWorkletNode(ctx, "synth-rack", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { config: rackConfig(s) } });
        } else {
            rack.node.port.postMessage({ type: "config", config: rackConfig(s) });
        }
    }
    if (on) {
        clearTimeout(rack.timer);
        rack.timer = 0;
        if (!rack.linked) {
            trackPan[t].disconnect(trackGains[t]);
            trackPan[t].connect(rack.node);
            rack.node.connect(trackGains[t]);
            rack.linked = true;
        }
    } else if (rack.linked && !rack.timer) {
        const pan = trackPan[t]; // (these are kept now: if the song is made into a file before the timer goes off, the lists hold other nodes by then)
        const volume = trackGains[t];
        const unlink = () => {
            rack.timer = 0;
            if (!rack.linked || rackOn(trackSettings[t])) return;
            try {
                pan.disconnect(rack.node);
                rack.node.disconnect();
                pan.connect(volume);
            } catch {}
            rack.linked = false;
        };
        if (instant || renderingOffline) unlink();
        else rack.timer = setTimeout(unlink, 1500); // (the echoes of a flanger and the like take a moment to fade)
    }
}

function applyAllRacks() {
    for (let t = 0; t < MAX_TRACKS; t++) applyRack(t, true);
}

// a track's chain, put together from the lists of its nodes
function chainOf(t) {
    return trackChains[t];
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
    setParam(c.filter.Q, drumFilterQ(type, dB), instant, now, 0.015);
    setParam(c.filter.gain, 6, instant, now, 0.015); // (how far the peak turns the band up, the other types have no use for it)
    // the EQ bands
    c.bands.forEach((band, i) => {
        const n = i + 1;
        setParam(band.frequency, eqFreq(s["e" + n + "f"]), instant, now, 0.015);
        setParam(band.gain, eqGain(s["e" + n + "g"]), instant, now, 0.015);
        setParam(band.Q, eqQ(s["e" + n + "q"]), instant, now, 0.015);
    });
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

    // the echo: with PING on, the sound bounces between the two delays and out of the left and right speakers, not round the one and out in the
    // middle (a drum has no PING)
    const ping = placeOf(s.dping || 0, 2);
    set(c.dSend.gain, s.dly * 0.8);
    set(c.feedback.gain, s.dfb * 0.85 * (1 - ping));
    set(c.cross.gain, s.dfb * 0.85 * ping);
    set(c.cross2.gain, s.dfb * 0.85 * ping);
    set(c.outCenter.gain, 1 - ping);
    set(c.outLeft.gain, ping * 0.5); // (a stereo panner all the way to one side adds the two channels together, so they are turned down by half)
    set(c.outRight.gain, ping * 0.5);
    set(c.delay.delayTime, echoSeconds(s), 0.03);
    set(c.delay2.delayTime, echoSeconds(s), 0.03);

    // the room (a drum has the middle size, open and no wait)
    const size = placeOf(s.rsize === undefined ? 0.5 : s.rsize, ROOM_SIZES.length);
    if (!c.rJoined[size]) {
        c.rSizes[size].connect(roomNode(size));
        c.rJoined[size] = true;
    }
    c.rSizes.forEach((g, i) => set(g.gain, i === size ? 1 : 0, 0.05));
    set(c.rSend.gain, s.rev * 0.8);
    set(c.rDamp.frequency, roomDampHz(s.rdamp === undefined ? 1 : s.rdamp));
    set(c.rPre.delayTime, roomPreSeconds(s.rpre || 0), 0.03);
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
    activeFilters[t].forEach((filter) => filter.configure(s));
}

// puts everything else a track has on its nodes: the drive, the tremolo, the vibrato, the pan, the echo and the room
function applyFx(t, instant = false) {
    if (!ctx || !trackPan[t]) return;
    const s = trackSettings[t];
    applyChainFx(chainOf(t), s, instant);
    setParam(vibLfo[t].frequency, vibRateHz(s.vrate), instant, ctx.currentTime, 0.02);
    setParam(vibGain[t].gain, vibCents(s.vdep), instant, ctx.currentTime, 0.02);
    applyRack(t, instant);
}

// the echo is in time with the song, so it follows the BPM (studio.js calls this when the BPM changes)
function updateDelayTimes(only) {
    if (!ctx || !dlyNode.length) return;
    for (let t = 0; t < MAX_TRACKS; t++) {
        if (only !== undefined && t !== only) continue;
        dlyNode[t].delayTime.setTargetAtTime(echoSeconds(trackSettings[t]), ctx.currentTime, 0.03);
        trackChains[t].delay2.delayTime.setTargetAtTime(echoSeconds(trackSettings[t]), ctx.currentTime, 0.03);
    }
    if (only === undefined) {
        drumChannels.forEach((c, slot) => {
            if (!c) return;
            c.delay.delayTime.setTargetAtTime(echoSeconds(drumFx[slot]), ctx.currentTime, 0.03);
            c.delay2.delayTime.setTargetAtTime(echoSeconds(drumFx[slot]), ctx.currentTime, 0.03);
        });
    }
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
    if (typeof SAMPLER_KEYS !== "undefined" && SAMPLER_KEYS.has(key) && !isDrums()) samplerChanged(liveTrack, key);
    drawGraphs(); // (the filter and the fade graphs follow the dials)
    if (typeof dialEntries !== "undefined") dialEntries.forEach(({ strip }) => strip.update()); // (and the words on the dials, see lfoRateText)
}

const pct = (v) => Math.round(v * 100) + "%";
const signed = (n) => (n > 0 ? "+" + n : String(n));

// a dial for a setting that's kept in the selected sound (or the selected drum) and is applied by applyFx
const settingDial = (group, label, key, aria, scope, def, format, defDrums = def) => ({
    group, label, aria, scope, def, defDrums, format, key, id: "dial-" + key,
    get: () => getSetting(key),
    apply: (v) => setSetting(key, v),
});

const DIAL_TABS = [
    { id: "sound", name: "SOUND" },
    { id: "osc", name: "OSC" },
    { id: "sample", name: "SAMPLE" },
    { id: "chop", name: "CHOP" },
    { id: "tune", name: "TUNE" },
    { id: "filter", name: "FILTER" },
    { id: "eq", name: "EQ" },
    { id: "env", name: "ENV" },
    { id: "fx", name: "FX" },
    { id: "mod", name: "MOD" },
    { id: "move", name: "MOVE" },
    { id: "grit", name: "GRIT" },
    { id: "play", name: "PLAY" },
    { id: "lfo", name: "LFO" },
    { id: "menv", name: "MENV" },
    { id: "matrix", name: "MATRIX" },
];

// what an LFO's RATE dial says: cycles a second, or a length of time in the song if the LFO is in sync mode
function lfoRateText(i, v) {
    if (placeOf(getSetting("l" + i + "m"), LFO_MODES.length) === 2) return LFO_SYNC[placeOf(v, LFO_SYNC.length)].name;
    const hz = lfoRateHz(v);
    return hz < 1 ? hz.toFixed(2) : hz < 10 ? hz.toFixed(1) : String(Math.round(hz));
}

const rackRateText = (v) => {
    const hz = rackRateHz(v);
    return hz < 1 ? hz.toFixed(2) : hz.toFixed(1);
};

const DIALS = [
    // SOUND
    { group: "sound", label: "VOL", aria: "Volume of the selected sound", scope: "both", def: 0.5, defDrums: 0.5, format: pct, id: "gainSlider", get: () => selectedVolume(), apply: (v) => setVolume(v) },
    settingDial("sound", "PAN", "pan", "Pan of the selected sound, left to right", "both", 0.5, (v) => (Math.abs(v - 0.5) < 0.01 ? "C" : (v < 0.5 ? "L" : "R") + Math.round(Math.abs(v - 0.5) * 200))),
    settingDial("sound", "OCT", "oct", "Tune the selected sound up or down in octaves", "synth", 0.5, (v) => signed(octFrom(v))),
    settingDial("sound", "SEMI", "semi", "Tune the selected sound up or down in semitones", "synth", 0.5, (v) => signed(semiFrom(v))),
    settingDial("sound", "GLIDE", "glide", "Glide: how long a note takes to slide from the one before", "synth", 0, (v) => Math.round(glideSeconds(v) * 1000) + "ms"),
    settingDial("sound", "DRIVE", "drive", "Drive: distortion", "both", 0, pct),
    settingDial("sound", "PITCH", "pitch", "Pitch of the selected drum", "drums", 0.5, (v) => signed(pitchSemis(v))),
    settingDial("sound", "DECAY", "decay", "How long the selected drum rings", "drums", 0.5, (v) => "x" + drumDecayScale(v).toFixed(2)),
    // FILTER
    settingDial("filter", "MODEL", "fmodel", "Filter model: SVF 12 is a smooth two pole filter, SVF 24 is two of them, and the ladder is the four pole filter of a Minimoog, which rings by itself with the resonance up", "synth", 0, (v) => FILTER_MODELS[filterModelFrom(v)]),
    settingDial("filter", "TYPE", "ftype", "Filter type: low pass, high pass, band pass, notch or peak", "both", 0, (v) => FILTER_TYPE_NAMES[filterModeFrom(v)]),
    { ...settingDial("filter", "CUT", "cutoff", "Filter cutoff", "both", 1, (v) => formatCutoff(cutoffFromSlider(v))), id: "cutoffSlider" },
    { ...settingDial("filter", "RES", "resonance", "Filter resonance", "both", 0, (v) => Math.round(resonanceFromSlider(v)) + "dB"), id: "resonanceSlider" },
    settingDial("filter", "F DRIVE", "fdrive", "Filter drive: pushes the sound into the filter (and, in the ladder, round its loop) so it squashes and warms up", "synth", 0, pct),
    settingDial("filter", "KEY", "ktrack", "Key tracking: how much the cutoff follows the note you play, all the way up it moves as far as the note does", "synth", 0, pct),
    settingDial("filter", "FENV", "fenv", "Filter envelope: how far the fade opens the filter", "synth", 0, (v) => "+" + fenvOctaves(v).toFixed(1)),
    // EQ: three bands, each with where it is (FREQ), how much it boosts or cuts (GAIN) and how wide it is (Q: a high one is narrow,
    // for taking out one thing without touching what's round it)
    ...[1, 2, 3].flatMap((n) => [
        settingDial("eq", "FREQ " + n, "e" + n + "f", "EQ band " + n + " frequency: the part of the sound it works on", "both", EQ_DEFAULTS["e" + n + "f"], (v) => formatCutoff(eqFreq(v))),
        settingDial("eq", "GAIN " + n, "e" + n + "g", "EQ band " + n + " gain in decibels: boosts or cuts that part of the sound", "both", 0.5, (v) => signed(Math.round(eqGain(v) * 10) / 10)),
        settingDial("eq", "Q " + n, "e" + n + "q", "EQ band " + n + " width: a higher number works on a narrower part of the sound", "both", EQ_DEFAULTS["e" + n + "q"], (v) => eqQ(v).toFixed(1)),
    ]),
    // ENV
    { ...settingDial("env", "ATK", "attack", "Attack time", "both", DIAL_DEFAULTS.synth.attack, (v) => formatSeconds(attackFromSlider(v)), DIAL_DEFAULTS.drums.attack), id: "attackSlider" },
    { ...settingDial("env", "DEC", "envdecay", "Decay time", "both", DIAL_DEFAULTS.synth.decay, (v) => formatSeconds(decayFromSlider(v)), DIAL_DEFAULTS.drums.decay), id: "decaySlider" },
    { ...settingDial("env", "SUS", "sustain", "Sustain level", "both", DIAL_DEFAULTS.synth.sustain, pct, DIAL_DEFAULTS.drums.sustain), id: "sustainSlider" },
    { ...settingDial("env", "REL", "release", "Release time", "both", DIAL_DEFAULTS.synth.release, (v) => releaseFromSlider(v).toFixed(1) + "s", DIAL_DEFAULTS.drums.release), id: "releaseSlider" },
    // FX
    settingDial("fx", "DLY", "dly", "Echo: how much of the sound goes to the echo", "both", 0, pct),
    settingDial("fx", "DTIME", "dtime", "Echo time, in time with the song", "both", 0.25, (v) => DELAY_NAMES[delayIndex(v)]),
    settingDial("fx", "DFB", "dfb", "Echo feedback: how many times it repeats", "both", 0.35, pct),
    settingDial("fx", "PING", "dping", "Ping pong: the echoes bounce from one speaker to the other", "synth", 0, (v) => (placeOf(v, 2) ? "ON" : "OFF")),
    settingDial("fx", "REV", "rev", "Room: how much of the sound goes to the reverb", "both", 0, pct),
    settingDial("fx", "SIZE", "rsize", "Room size: small, medium or large", "synth", 0.5, (v) => ROOM_SIZES[placeOf(v, ROOM_SIZES.length)].name),
    settingDial("fx", "DAMP", "rdamp", "Room damping: how fast the high notes die away in the room, the top is not at all", "synth", 1, (v) => (v > 0.99 ? "OPEN" : formatCutoff(roomDampHz(v)))),
    settingDial("fx", "PRE", "rpre", "Room pre delay: how long after the sound the room starts", "synth", 0, (v) => Math.round(roomPreSeconds(v) * 1000) + "ms"),
    // MOD
    settingDial("mod", "VRATE", "vrate", "Vibrato speed", "synth", 0.4, (v) => vibRateHz(v).toFixed(1)),
    settingDial("mod", "VDEP", "vdep", "Vibrato depth", "synth", 0, (v) => Math.round(vibCents(v)) + "c"),
    settingDial("mod", "TRATE", "trate", "Tremolo speed", "both", 0.4, (v) => tremRateHz(v).toFixed(1)),
    settingDial("mod", "TDEP", "tdep", "Tremolo depth", "both", 0, pct),
    // MOVE and GRIT: the effects rack (rack-worklet.js)
    settingDial("move", "CH MIX", "chmix", "Chorus: how much of the doubled, wobbling copies is mixed in", "synth", 0, pct),
    settingDial("move", "CH SPD", "chrate", "Chorus speed", "synth", FX_DEFAULTS.chrate, (v) => rackRateText(v)),
    settingDial("move", "CH DEP", "chdep", "Chorus depth: how far the copies wobble", "synth", FX_DEFAULTS.chdep, pct),
    settingDial("move", "PH MIX", "phmix", "Phaser: how much of the swept sound is mixed in", "synth", 0, pct),
    settingDial("move", "PH SPD", "phrate", "Phaser speed", "synth", FX_DEFAULTS.phrate, (v) => rackRateText(v)),
    settingDial("move", "PH DEP", "phdep", "Phaser depth: how far the notches sweep", "synth", FX_DEFAULTS.phdep, pct),
    settingDial("move", "PH FB", "phfb", "Phaser feedback: sends some round again, which makes the notches sharper", "synth", FX_DEFAULTS.phfb, pct),
    settingDial("move", "FL MIX", "flmix", "Flanger: how much of the swept short delay is mixed in", "synth", 0, pct),
    settingDial("move", "FL SPD", "flrate", "Flanger speed", "synth", FX_DEFAULTS.flrate, (v) => rackRateText(v)),
    settingDial("move", "FL DEP", "fldep", "Flanger depth: how far the delay sweeps", "synth", FX_DEFAULTS.fldep, pct),
    settingDial("move", "FL FB", "flfb", "Flanger feedback: sends some round again, which makes it ring", "synth", FX_DEFAULTS.flfb, pct),
    settingDial("grit", "CR MIX", "crmix", "Crusher: how much of the crushed sound is mixed in", "synth", 0, pct),
    settingDial("grit", "BITS", "crbits", "Crusher bits: how many steps the loudness has, fewer is grittier", "synth", FX_DEFAULTS.crbits, (v) => String(crushBits(v))),
    settingDial("grit", "HOLD", "crhold", "Crusher hold: the sound is held for this many samples at a time, more is grittier", "synth", 0, (v) => "x" + crushHold(v)),
    settingDial("grit", "CP MIX", "cpmix", "Compressor: how much of the compressed sound is mixed in", "synth", 0, pct),
    settingDial("grit", "THRESH", "cpthr", "Compressor threshold: the level it starts turning the sound down at", "synth", FX_DEFAULTS.cpthr, (v) => Math.round(compThreshold(v)) + "dB"),
    settingDial("grit", "RATIO", "cpratio", "Compressor ratio: how hard it turns down what goes over", "synth", FX_DEFAULTS.cpratio, (v) => compRatio(v).toFixed(1) + ":1"),
    settingDial("grit", "ATTACK", "cpatk", "Compressor attack: how fast it turns the sound down", "synth", FX_DEFAULTS.cpatk, (v) => compAttackMs(v).toFixed(1) + "ms"),
    settingDial("grit", "RELEASE", "cprel", "Compressor release: how fast it lets go", "synth", FX_DEFAULTS.cprel, (v) => Math.round(compReleaseMs(v)) + "ms"),
    // SAMPLE, CHOP and TUNE (the sampler, sampler.js and samplerui.js: only on a track whose sound is SAMPLER)
    settingDial("sample", "STYLE", "smode", "Style: pitch plays the whole sound, higher or lower for each key. Chop plays one piece of it on each key. Loop goes round the part between start and end while the key is held", "synth", 0, (v) => SAMPLE_MODES[placeOf(v, SAMPLE_MODES.length)]),
    settingDial("sample", "REV", "srev", "Reverse: plays the sound backwards", "synth", 0, (v) => (v >= 0.5 ? "ON" : "OFF")),
    settingDial("sample", "START", "sstart", "Start: where the sound starts, or where a loop starts", "synth", 0, (v) => sampleTimeText(v)),
    settingDial("sample", "END", "send", "End: where the sound ends, or where a loop goes back to the start", "synth", 1, (v) => sampleTimeText(v)),
    settingDial("sample", "IN", "sfadein", "Fade in: how long the sound takes to come up at its start, which softens a hard start", "synth", 0, (v) => fadeText(v)),
    settingDial("sample", "OUT", "sfadeout", "Fade out: how long the sound takes to go down at its end, which stops a click where a chop or the sound stops", "synth", 0.07, (v) => fadeText(v)),
    settingDial("sample", "GATE", "sgate", "Gate: letting go of a key fades the sound out. One shot: the sound plays to its end whatever the key does (not for a loop)", "synth", 0, (v) => (v >= 0.5 ? "ONE SHOT" : "GATE")),
    settingDial("chop", "SENS", "ssens", "Sensitivity: how small a rise in the sound counts as a hit when it is chopped at its hits", "synth", 0.5, pct),
    settingDial("chop", "BASE", "sbase", "Base key: the key of the first chop, and each key above it plays the next", "synth", 0.25, (v) => noteLabel(sampleBase(v))),
    settingDial("tune", "ROOT", "sroot", "Root: the note the sound is at. Playing that key plays it as it is", "synth", 0.5, (v) => noteLabel(sampleRoot(v))),
    settingDial("tune", "FINE", "sfine", "Fine: how many cents above or below the root note the sound is", "synth", 0.5, (v) => signed(sampleFine(v)) + "c"),
    settingDial("tune", "SHIFT", "sshift", "Shift: moves the sound up or down in semitones without changing its speed. Key match sets it", "synth", 0.5, (v) => signed(sampleShift(v))),
    settingDial("tune", "BEATS", "sbeats", "Beats: how many beats long the sound is. It is stretched to fit the song's tempo without changing its pitch. Off leaves it as it is", "synth", 0, (v) => (sampleBeats(v) === 0 ? "OFF" : String(sampleBeats(v)))),
    // OSC (the oscillator, made by osc-worklet.js)
    settingDial("osc", "UNI", "uni", "Unison: how many copies of the wave play together", "synth", 0, (v) => String(unisonFrom(v))),
    settingDial("osc", "DETUNE", "detune", "Detune: how far apart in pitch the copies of the unison are", "synth", 0, (v) => Math.round(detuneCents(v)) + "c"),
    settingDial("osc", "SPREAD", "spread", "Spread: how wide the copies are in the speakers", "synth", 0.5, pct),
    settingDial("osc", "PW", "pw", "Pulse width: the width of a square wave, the middle is a plain square", "synth", 0.5, (v) => Math.round(pwFrom(v) * 100) + "%"),
    settingDial("osc", "SUB", "sub", "Sub: a square wave an octave under the note", "synth", 0, pct),
    settingDial("osc", "NOISE", "noise", "Noise: a hiss added to the sound", "synth", 0, pct),
    // PLAY (chords and the arpeggiator, played in playNote in synth.js)
    settingDial("play", "CHORD", "chord", "Chord: more notes played with each note", "synth", 0, (v) => CHORDS[placeOf(v, CHORDS.length)].name),
    settingDial("play", "ARP", "arp", "Arpeggio: plays the chord one note after another, in this order", "synth", 0, (v) => ARP_MODES[placeOf(v, ARP_MODES.length)]),
    settingDial("play", "RATE", "arate", "Arpeggio speed, in time with the song", "synth", 2 / 3, (v) => ARP_RATES[placeOf(v, ARP_RATES.length)].name),
    // (how notes share the track)
    settingDial("play", "MODE", "mode", "Mode: poly plays as many notes as you like, mono one at a time, legato slides from note to note", "synth", 0, (v) => VOICE_MODES[placeOf(v, VOICE_MODES.length)]),
    settingDial("play", "VOICES", "voices", "Voices: the most notes that sound at once on this track", "synth", 1, (v) => String(voiceLimitFrom(v))),
    // (a drum has its own PLAY dials: a roll)
    settingDial("play", "ROLL", "roll", "Roll: hits the drum again and again, this fast, while the key is held", "drums", 0, (v) => ROLL_RATES[placeOf(v, ROLL_RATES.length)].name),
    settingDial("play", "BUILD", "build", "Build: how soft a roll starts, it gets louder as it goes", "drums", 0, pct),
    // LFO and MENV: the modulation (mod-worklet.js). What each one moves is chosen in the MATRIX tab
    ...[1, 2, 3].flatMap((i) => [
        settingDial("lfo", "SHP " + i, "l" + i + "w", "LFO " + i + " shape", "synth", 0, (v) => LFO_SHAPES[placeOf(v, LFO_SHAPES.length)]),
        settingDial("lfo", "MODE " + i, "l" + i + "m", "LFO " + i + " mode: free runs on the clock, key starts again with each note, sync is in time with the song", "synth", 0, (v) => LFO_MODES[placeOf(v, LFO_MODES.length)]),
        settingDial("lfo", "RATE " + i, "l" + i + "r", "LFO " + i + " rate: in cycles a second, or a length of time in the song in sync mode", "synth", 0.4, (v) => lfoRateText(i, v)),
        settingDial("lfo", "FADE " + i, "l" + i + "f", "LFO " + i + " fade in: how long it takes to come in after a note starts", "synth", 0, (v) => (v === 0 ? "0" : lfoFadeSeconds(v).toFixed(1) + "s")),
    ]),
    ...[2, 3].flatMap((n) => [
        settingDial("menv", "ATK " + n, "v" + n + "a", "Envelope " + n + " attack time", "synth", FX_DEFAULTS["v" + n + "a"], (v) => formatSeconds(attackFromSlider(v))),
        settingDial("menv", "DEC " + n, "v" + n + "d", "Envelope " + n + " decay time", "synth", FX_DEFAULTS["v" + n + "d"], (v) => formatSeconds(decayFromSlider(v))),
        settingDial("menv", "SUS " + n, "v" + n + "s", "Envelope " + n + " sustain level", "synth", FX_DEFAULTS["v" + n + "s"], pct),
        settingDial("menv", "REL " + n, "v" + n + "r", "Envelope " + n + " release time", "synth", FX_DEFAULTS["v" + n + "r"], (v) => releaseFromSlider(v).toFixed(1) + "s"),
    ]),
];
// the steps of the stepped dials, so they click from one choice to the next
DIALS.forEach((dial) => {
    if (dial.id === "dial-oct") dial.step = 0.25;
    if (dial.id === "dial-semi") dial.step = 1 / 24;
    if (dial.id === "dial-dtime") dial.step = 0.25;
    if (dial.id === "dial-ftype") dial.step = 0.25;
    if (dial.id === "dial-fmodel") dial.step = 0.5;
    if (dial.id === "dial-dping") dial.step = 1;
    if (dial.id === "dial-smode") dial.step = 0.5;
    if (dial.id === "dial-srev") dial.step = 1;
    if (dial.id === "dial-sgate") dial.step = 1;
    if (dial.id === "dial-sroot") dial.step = 1 / 72;
    if (dial.id === "dial-sbase") dial.step = 1 / 48;
    if (dial.id === "dial-sshift") dial.step = 1 / 24;
    if (dial.id === "dial-sbeats") dial.step = 1 / (BEAT_CHOICES.length - 1);
    if (dial.id === "dial-rsize") dial.step = 0.5;
    if (/^dial-l[123]w$/.test(dial.id)) dial.step = 1 / (LFO_SHAPES.length - 1);
    if (/^dial-l[123]m$/.test(dial.id)) dial.step = 1 / (LFO_MODES.length - 1);
    if (dial.id === "dial-chord") dial.step = 1 / (CHORDS.length - 1);
    if (dial.id === "dial-arp") dial.step = 1 / (ARP_MODES.length - 1);
    if (dial.id === "dial-arate") dial.step = 1 / (ARP_RATES.length - 1);
    if (dial.id === "dial-roll") dial.step = 1 / (ROLL_RATES.length - 1);
    if (dial.id === "dial-uni" || dial.id === "dial-voices") dial.step = 1 / 15;
    if (dial.id === "dial-mode") dial.step = 1 / (VOICE_MODES.length - 1);
});
// the dials that are sliders and not knobs (how many marks each has): the ones that choose from a short list, and PAN, which sits
// left and right of a middle
const SLIDER_MARKS = {
    "dial-chord": CHORDS.length, "dial-arp": ARP_MODES.length, "dial-arate": ARP_RATES.length, "dial-roll": ROLL_RATES.length,
    "dial-l1w": LFO_SHAPES.length, "dial-l2w": LFO_SHAPES.length, "dial-l3w": LFO_SHAPES.length,
    "dial-l1m": LFO_MODES.length, "dial-l2m": LFO_MODES.length, "dial-l3m": LFO_MODES.length,
    "dial-ftype": 5, "dial-fmodel": 3, "dial-dping": 2, "dial-rsize": 3, "dial-smode": 3, "dial-srev": 2, "dial-sgate": 2, "dial-dtime": DELAY_BEATS.length, "dial-oct": 5, "dial-pan": 3, "dial-mode": VOICE_MODES.length,
};
DIALS.forEach((dial) => {
    if (SLIDER_MARKS[dial.id]) dial.slider = SLIDER_MARKS[dial.id];
});

const dialPanel = document.getElementById("dialPanel");
const dialEntries = []; // { spec, box, input, strip } for every dial
let dialTab = "sound";
let selectDialTab; // shows a tab (buildDialPanel sets it)
let dialTabButtons = []; // the buttons of the tabs
let dialBar; // the bar along the top of the dials box that says which sound the dials are for ({ chip, name, right })
const dialViews = {}; // the picture on the left of each tab (a canvas), drawn by dialviews.js (the EQ and ENV ones are here)
const dialPlates = []; // the plates the dials sit on: { el, dials }
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
    // the bar along the top: what is being edited (the track or the drum, its sound), and the tab you are on
    const barEl = mk("div", "dial-bar");
    dialBar = { el: barEl, edit: mk("span", "", "EDITING"), chip: mk("span", "dial-bar-chip"), name: mk("span", ""), right: mk("span", "dial-bar-right") };
    barEl.append(dialBar.edit, dialBar.chip, dialBar.name, dialBar.right);
    dialPanel.appendChild(barEl);
    const dialBody = mk("div", "dial-body");
    dialPanel.appendChild(dialBody);
    dialPanel.insertBefore(tabs, dialBody); // (a row of tabs under the bar)

    const groups = {};
    DIAL_TABS.forEach((tab) => {
        groups[tab.id] = mk("div", "dial-group");
        groups[tab.id].dataset.tab = tab.id;
        dialBody.appendChild(groups[tab.id]);
    });

    function addCurveEditor(tab, label) {
        const panel = mk("div", "curve-editor");
        panel.setAttribute("role", "group");
        panel.setAttribute("aria-label", label);
        const canvas = document.createElement("canvas");
        canvas.setAttribute("role", "img");
        panel.appendChild(canvas);
        groups[tab].appendChild(panel);
        return canvas;
    }

    const eqEditor = addCurveEditor("eq", "Equalizer graph. Drag a numbered band to change its frequency and gain.");
    const envEditor = addCurveEditor("env", "Envelope graph. Drag A, D, S, or R to adjust attack, decay, sustain, or release.");
    registerEqEditorGraph(eqEditor);
    registerEnvEditorGraph(envEditor);
    dialViews.eq = eqEditor;
    dialViews.env = envEditor;
    // (every other tab has a picture too, drawn by dialviews.js)
    const VIEW_LABELS = {
        sound: "Picture of the selected sound: the shape of its wave, or for a drum how long it rings.",
        osc: "Picture of the oscillator: the shape of the wave with its pulse width and sub wave, and where the copies of the unison are in pitch and in the speakers.",
        filter: "Filter graph. Drag the C handle sideways for the cutoff and up and down for the resonance.",
        fx: "Picture of the echo and the room: the echoes as bars, and the room as a fading shade.",
        mod: "Picture of the vibrato and the tremolo as waves.",
        move: "Picture of the chorus, the phaser and the flanger as the waves that sweep them. The ones turned on are bright.",
        sample: "The waveform of the sound. Drag the START and END handles to choose the part that plays.",
        chop: "The waveform of the sound with a marker where each chop starts. Click to add a marker, drag one to move it, double-click one to take it away.",
        tune: "What was found in the sound: its note, its key and its tempo, and how much of each of the twelve notes it has, with a dot under the notes of the song's scale.",
        grit: "Picture of the bit crusher as a stepped wave, and of the compressor as a line from the level that goes in to the level that comes out.",
        play: "Picture of the chord and the arpeggio, or for a drum the roll.",
        lfo: "Picture of the three LFOs as waves over two seconds, the ones that move something bright and the others dim.",
        menv: "Picture of the two envelopes, the ones that move something bright and the others dim.",
        matrix: "The matrix. Each row is something that is moved and each column is what moves it: click a square and drag up or down to set how much, between minus and plus one hundred percent. Double-click a square to clear it.",
    };
    ["sound", "osc", "sample", "chop", "tune", "filter", "fx", "mod", "move", "grit", "play", "lfo", "menv", "matrix"].forEach((tab) => (dialViews[tab] = addCurveEditor(tab, VIEW_LABELS[tab])));

    // the plates: the dials of each tab sit on engraved plates, with a title, grouped by what they do
    const PLATE_LAYOUT = {
        sound: [["LEVEL", ["VOL", "PAN"]], ["TUNING", ["OCT", "SEMI", "GLIDE", "PITCH", "DECAY"]], ["DIRT", ["DRIVE"]]],
        osc: [["UNISON", ["UNI", "DETUNE", "SPREAD"]], ["WAVE", ["PW", "SUB", "NOISE"]]],
        sample: [["SOURCE", []], ["PLAY", ["STYLE", "REV", "START", "END"]], ["FADE", ["IN", "OUT", "GATE"]]],
        chop: [["AUTO", ["SENS"]], ["KEYS", ["BASE"]], ["VIEW", []]],
        tune: [["TUNE", ["ROOT", "FINE"]], ["MATCH", ["SHIFT", "BEATS"]]],
        filter: [["FILTER", ["MODEL", "TYPE", "CUT", "RES", "F DRIVE", "KEY"]], ["FILTER ENV", ["FENV"]]],
        eq: [1, 2, 3].map((n) => ["BAND " + n, ["FREQ " + n, "GAIN " + n, "Q " + n]]),
        env: [["ENVELOPE", ["ATK", "DEC", "SUS", "REL"]]],
        fx: [["ECHO", ["DLY", "DTIME", "DFB", "PING"]], ["ROOM", ["REV", "SIZE", "DAMP", "PRE"]]],
        mod: [["VIBRATO", ["VRATE", "VDEP"]], ["TREMOLO", ["TRATE", "TDEP"]]],
        move: [["CHORUS", ["CH MIX", "CH SPD", "CH DEP"]], ["PHASER", ["PH MIX", "PH SPD", "PH DEP", "PH FB"]], ["FLANGER", ["FL MIX", "FL SPD", "FL DEP", "FL FB"]]],
        grit: [["CRUSHER", ["CR MIX", "BITS", "HOLD"]], ["COMPRESSOR", ["CP MIX", "THRESH", "RATIO", "ATTACK", "RELEASE"]]],
        play: [["CHORD AND ARP", ["CHORD", "ARP", "RATE"]], ["VOICES", ["MODE", "VOICES"]], ["ROLL", ["ROLL", "BUILD"]]],
        lfo: [1, 2, 3].map((i) => ["LFO " + i, ["SHP " + i, "MODE " + i, "RATE " + i, "FADE " + i]]),
        menv: [2, 3].map((n) => ["ENV " + n, ["ATK " + n, "DEC " + n, "SUS " + n, "REL " + n]]),
        matrix: [],
    };
    const plateOf = {}; // a dial's name -> the box its dial goes in
    for (const tab in PLATE_LAYOUT) {
        PLATE_LAYOUT[tab].forEach(([title, names]) => {
            const el = mk("div", "plate");
            ["tl", "tr", "bl", "br"].forEach((corner) => el.appendChild(mk("span", "screw " + corner)));
            el.appendChild(mk("h3", "", title));
            const row = mk("div", "plate-dials");
            if (!names.length) row.dataset.buttons = "true"; // (a plate of buttons only: samplerui.js puts them in)
            el.appendChild(row);
            groups[tab].appendChild(el);
            dialPlates.push({ el, row });
            names.forEach((name) => (plateOf[name] = row));
        });
    }

    function setDialValue(id, value) {
        const input = document.getElementById(id);
        input.value = String(Math.min(1, Math.max(0, value)));
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    let draggedEqBand = null;
    const editEqAt = (e) => {
        const rect = eqEditor.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const pad = (EDITOR_PAD * rect.height) / eqEditor.offsetHeight; // (the line and the handles keep this far from the top and bottom)
        const y = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top - pad) / (rect.height - 2 * pad)));
        setDialValue("dial-e" + draggedEqBand + "f", x);
        setDialValue("dial-e" + draggedEqBand + "g", y);
    };
    eqEditor.addEventListener("pointerdown", (e) => {
        const rect = eqEditor.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        draggedEqBand = [1, 2, 3].reduce((closest, band) =>
            Math.abs(getSetting("e" + band + "f") - x) < Math.abs(getSetting("e" + closest + "f") - x) ? band : closest, 1);
        e.preventDefault();
        eqEditor.setPointerCapture(e.pointerId);
        editEqAt(e);
    });
    eqEditor.addEventListener("pointermove", (e) => {
        if (draggedEqBand !== null) editEqAt(e);
    });
    const stopEqEdit = () => (draggedEqBand = null);
    eqEditor.addEventListener("pointerup", stopEqEdit);
    eqEditor.addEventListener("pointercancel", stopEqEdit);

    let draggedEnvStage = null;
    // (the editor is drawn to real time, see envEditorTimes in synth.js: a handle is at a time, so dragging it sideways sets a time)
    const envPad = () => (EDITOR_PAD * envEditor.getBoundingClientRect().height) / envEditor.offsetHeight;
    const envHandles = () => {
        const { env, span, letGoAt } = envEditorTimes();
        return [
            { stage: "attack", x: env.attack / span, y: 0 },
            { stage: "decay", x: (env.attack + env.decay) / span, y: 1 - env.sustain },
            { stage: "sustain", x: letGoAt / span, y: 1 - env.sustain },
            { stage: "release", x: (letGoAt + env.release) / span, y: 1 },
        ];
    };
    const editEnvAt = (e) => {
        const rect = envEditor.getBoundingClientRect();
        const pad = envPad();
        let x = (e.clientX - rect.left) / rect.width;
        if (x > 0.97) envEditorFrozen.span *= 1.03; // (pulling a handle past the right edge zooms the graph out)
        x = Math.min(1, Math.max(0, x));
        const y = Math.min(1, Math.max(0, (e.clientY - rect.top - pad) / (rect.height - 2 * pad)));
        const t = x * envEditorFrozen.span; // the time under the pointer, in seconds
        const { env } = envEditorTimes();
        if (draggedEnvStage === "attack") setDialValue("attackSlider", attackToSlider(t));
        if (draggedEnvStage === "decay") setDialValue("decaySlider", decayToSlider(t - env.attack));
        if (draggedEnvStage === "sustain") setDialValue("sustainSlider", 1 - y);
        if (draggedEnvStage === "release") setDialValue("releaseSlider", releaseToSlider(t - (env.attack + env.decay + envEditorFrozen.hold)));
    };
    envEditor.addEventListener("pointerdown", (e) => {
        const rect = envEditor.getBoundingClientRect();
        const pad = envPad();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top - pad) / (rect.height - 2 * pad);
        envEditorFrozen = null; // (the handles are where the scale that fits the fade puts them)
        draggedEnvStage = envHandles().reduce((closest, handle) => {
            const distance = Math.hypot((handle.x - x) * rect.width, (handle.y - y) * (rect.height - 2 * pad));
            return distance < closest.distance ? { stage: handle.stage, distance } : closest;
        }, { stage: "attack", distance: Infinity }).stage;
        const { hold, span } = envEditorTimes();
        envEditorFrozen = { hold, span }; // (and the scale is held still while it is dragged, so the handle stays under the pointer)
        e.preventDefault();
        envEditor.setPointerCapture(e.pointerId);
        editEnvAt(e);
    });
    envEditor.addEventListener("pointermove", (e) => {
        if (draggedEnvStage !== null) editEnvAt(e);
    });
    const stopEnvEdit = () => {
        draggedEnvStage = null;
        envEditorFrozen = null;
        drawGraphs(); // (the scale fits the fade again)
    };
    envEditor.addEventListener("pointerup", stopEnvEdit);
    envEditor.addEventListener("pointercancel", stopEnvEdit);

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
        (plateOf[spec.label] || groups[spec.group]).appendChild(box);
        if (spec.slider) {
            box.classList.add("slider");
            buildSlider(box, spec.slider);
            setUpSliderDrag(box, input);
        } else {
            buildDial(box);
            setUpDialDrag(box, input);
        }
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
        // (the tabs scroll if there are too many to fit, so the one that's picked is brought into view)
        const picked = tabButtons[DIAL_TABS.findIndex((tab) => tab.id === id)];
        if (picked.offsetLeft < tabs.scrollLeft) tabs.scrollLeft = picked.offsetLeft;
        else if (picked.offsetLeft + picked.offsetWidth > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = picked.offsetLeft + picked.offsetWidth - tabs.clientWidth;
        dialBar.right.textContent = DIAL_TABS.find((tab) => tab.id === id).name;
        drawGraphs(); // (each tab has its own picture to draw)
    }
    // double-clicking a tab puts every dial on it back to where it starts, for the selected sound (a drum's start in a different place from a
    // synth's). The tab says RESET for a moment
    function resetTab(id) {
        const names = new Set((PLATE_LAYOUT[id] || []).flatMap(([, labels]) => labels));
        dialEntries.forEach(({ spec, box, input }) => {
            if (!names.has(spec.label) || box.hidden) return;
            input.value = box.dataset.default;
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        if (typeof resetPicture === "function") resetPicture(id); // (a tab with a picture you edit, like the matrix, puts that back too)
        const button = tabButtons[DIAL_TABS.findIndex((tab) => tab.id === id)];
        const name = DIAL_TABS.find((tab) => tab.id === id).name;
        button.textContent = "RESET";
        setTimeout(() => (button.textContent = name), 700);
    }
    tabButtons.forEach((button, i) => {
        let lastTap = 0; // (a phone does not send a double click)
        button.addEventListener("click", () => {
            const now = performance.now();
            if (now - lastTap < 350) {
                lastTap = 0;
                resetTab(DIAL_TABS[i].id);
            } else {
                lastTap = now;
            }
        });
    });
    selectDialTab = showDialTab;
    showDialTab(dialTab);
}
buildDialPanel();

// moves the dials to the selected sound's settings, and hides the ones that don't apply to it (studio.js calls this when you
// pick a track or a drum)
function showTrackSettings() {
    const drums = isDrums();
    // (a drum has no oscillator, no modulation and no effects rack: those tabs are not for it)
    ["osc", "move", "grit", "lfo", "menv", "matrix"].forEach((id) => {
        dialTabButtons[DIAL_TABS.findIndex((tab) => tab.id === id)].disabled = drums;
        if (drums && dialTab === id) selectDialTab("sound");
    });
    // (a sampler has no oscillator but has the tabs for its sound, and no other track has those)
    const sampler = !drums && isSampler(liveTrack);
    dialTabButtons[DIAL_TABS.findIndex((tab) => tab.id === "osc")].hidden = sampler;
    ["sample", "chop", "tune"].forEach((id) => {
        dialTabButtons[DIAL_TABS.findIndex((tab) => tab.id === id)].hidden = !sampler;
        if (!sampler && dialTab === id) selectDialTab("sound");
    });
    if (sampler && dialTab === "osc") selectDialTab("sample");
    // (and says what the dials are for in the bar: the selected drum, or the selected track and its sound)
    dialBar.chip.textContent = drums ? "DRUMS" : trackName(liveTrack);
    dialBar.name.textContent = drums ? DRUM_SOUNDS[drumSoundAt(selectedDrumNote)].name : SOUNDS[trackSettings[liveTrack].sound].name;
    dialEntries.forEach(({ spec, box, input, strip }) => {
        const shown = spec.scope === "both" || (spec.scope === "drums") === drums;
        box.hidden = !shown;
        if (!shown) return;
        box.dataset.default = drums ? spec.defDrums : spec.def; // double-clicking puts it back to where this kind of sound starts
        input.value = spec.get();
        strip.update();
    });
    // a plate with no dials showing (a synth's filter envelope on a drum, a drum's roll on a synth) is not shown
    dialPlates.forEach(({ el, row }) => (el.hidden = !row.dataset.buttons && [...row.children].every((box) => box.hidden)));
    if (typeof refreshSamplerUi === "function") refreshSamplerUi(liveTrack);
    drawGraphs();
}
