// RANDOM and MORPH, for the sound of the selected synth track (not the drums, and not a sampler: its sound is the recording).
//   RANDOM (the dice by the star) makes a new sound from chance, kept inside what sounds like something: it picks a wave, how it is shaped, the
//   filter, the fade, a little echo and room, sometimes a unison, an effect from the rack, and a route or two in the matrix. Shift+click (or
//   SMALL CHANGES in the presets popup) only nudges the sound it has, a little.
//   MORPH (in the presets popup) slides the sound toward another one: the dials in between are worked out from the two, and the ones that choose from
//   a list (the wave, the filter model, a shape) change over half way.
// What stays as it is: the volume and pan, OCT and SEMI (so the notes stay where they are), and how notes are played (the PLAY dials). This needs
// presets.js (the list of presets and the popup) loaded first.

const randomButton = document.getElementById("randomButton");
const morphTo = document.getElementById("morphTo");
const morphSlider = document.getElementById("morphSlider");
const morphStatus = document.getElementById("morphStatus");
const smallChanges = document.getElementById("smallChanges");

// what a random sound leaves alone
const LAB_KEEP = new Set(["sound", "volume", "pan", "oct", "semi", "mode", "voices", "chord", "arp", "arate", "glide"]);
SAMPLER_KEYS.forEach((key) => LAB_KEEP.add(key));
// the dials that choose from a short list (they do not slide)
const LAB_STEPPED = new Set(["sound", "ftype", "fmodel", "dtime", "dping", "rsize", "l1w", "l2w", "l3w", "l1m", "l2m", "l3m", "mode", "voices", "chord", "arp", "arate", "uni", "crbits", "crhold"]);

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
// a number near the middle more often than the ends (two dice added)
const bell = (a, b) => a + ((Math.random() + Math.random()) / 2) * (b - a);

// every key a track's sound has that a random sound can change (the dials, the rack and the matrix)
function labKeys() {
    return Object.keys(presetSettingsOf(selTrack)).filter((key) => !LAB_KEEP.has(key));
}

// a whole new sound, as the settings it changes
function randomSettings() {
    const s = {};
    for (const key of labKeys()) s[key] = FX_DEFAULTS[key] !== undefined ? FX_DEFAULTS[key] : 0; // (everything starts from how a track starts)
    s.cutoff = 1;
    s.resonance = 0;
    s.attack = DIAL_DEFAULTS.synth.attack;
    s.decay = DIAL_DEFAULTS.synth.decay;
    s.sustain = DIAL_DEFAULTS.synth.sustain;
    s.release = DIAL_DEFAULTS.synth.release;
    s.sound = Math.floor(Math.random() * 8); // (the eight waves, not the sampler)

    // the shape of the sound: how long it takes to come in, how it falls and how it rings out
    const plucked = chance(0.4);
    const pad = !plucked && chance(0.35);
    s.attack = pad ? between(0.5, 0.85) : plucked ? between(0, 0.08) : chance(0.7) ? between(0, 0.12) : between(0.15, 0.4); // (a pluck that is slow to come in would be gone before it arrived)
    s.decay = plucked ? between(0.2, 0.55) : between(0.3, 0.8);
    s.sustain = plucked ? between(0.05, 0.3) : between(0.4, 1);
    s.release = pad ? between(0.35, 0.8) : plucked ? between(0.05, 0.3) : between(0.05, 0.4);

    // the oscillator
    if (chance(0.45)) {
        s.uni = Math.round(between(1, 7)) / 15;
        s.detune = bell(0.15, 0.6);
        s.spread = between(0.4, 1);
    }
    if (s.sound === 1 || s.sound === 7) s.pw = chance(0.5) ? between(0.15, 0.85) : 0.5;
    if (chance(0.2)) s.sub = between(0.15, 0.5);
    if (chance(0.08)) s.noise = between(0.05, 0.25);

    // the filter
    s.fmodel = chance(0.55) ? 0 : chance(0.5) ? 0.5 : 1;
    s.ftype = chance(0.82) || [2, 5, 6].includes(s.sound) ? 0 : pick([0.25, 0.5, 0.75]); // (a sine or an organ through a band pass or a high pass is hardly there)
    // (the ladder and the 24dB filter take more of the sound away at the same cutoff, and a band pass or notch most of all, so they are kept more open)
    s.cutoff = s.ftype === 0 ? bell(s.fmodel === 1 ? 0.55 : s.fmodel === 0.5 ? 0.4 : 0.28, 1) : s.ftype === 0.25 ? between(0.1, 0.42) : s.ftype === 0.5 ? between(0.3, 0.6) : between(0.4, 0.8);
    s.resonance = chance(0.6) ? between(0, 0.3) : between(0.3, 0.7);
    if (chance(0.3)) s.fdrive = between(0.1, 0.5);
    if (chance(0.3)) s.ktrack = between(0.2, 0.9);
    if (s.ftype === 0 && chance(0.5)) s.fenv = between(0.15, 0.65);

    // drive, vibrato and tremolo
    if (chance(0.3)) s.drive = between(0.05, 0.4);
    if (chance(0.3)) {
        s.vdep = between(0.05, 0.35);
        s.vrate = between(0.35, 0.65);
    }
    if (chance(0.25)) {
        s.tdep = between(0.1, 0.5);
        s.trate = between(0.2, 0.7);
    }

    // the echo and the room
    if (chance(0.5)) {
        s.dly = between(0.1, 0.55);
        s.dtime = pick([0, 0.25, 0.5, 0.75]);
        s.dfb = between(0.2, 0.6);
        s.dping = chance(0.5) ? 1 : 0;
    }
    if (chance(0.65)) {
        s.rev = between(0.1, 0.65);
        s.rsize = chance(0.3) ? 0 : chance(0.5) ? 0.5 : 1;
        s.rdamp = between(0.35, 1);
        s.rpre = chance(0.3) ? between(0.05, 0.3) : 0;
    }

    // the rack: none of it, or one or two of the effects (the crusher, which is rough, only now and then, and not much)
    const effects = chance(0.35) ? [] : [pick(["chorus", "phaser", "flanger", "comp"]), ...(chance(0.3) ? [pick(["chorus", "phaser", "flanger", "comp"])] : [])];
    if (chance(0.06)) effects.push("crush");
    effects.forEach((name) => {
        if (name === "chorus") Object.assign(s, { chmix: between(0.25, 0.65), chrate: between(0.2, 0.55), chdep: between(0.35, 0.8) });
        if (name === "phaser") Object.assign(s, { phmix: between(0.3, 0.7), phrate: between(0.15, 0.5), phdep: between(0.4, 0.85), phfb: between(0.1, 0.6) });
        if (name === "flanger") Object.assign(s, { flmix: between(0.25, 0.6), flrate: between(0.1, 0.5), fldep: between(0.3, 0.8), flfb: between(0.1, 0.6) });
        if (name === "comp") Object.assign(s, { cpmix: between(0.5, 1), cpthr: between(0.3, 0.6), cpratio: between(0.15, 0.45), cpatk: between(0.2, 0.6), cprel: between(0.3, 0.6) });
        if (name === "crush") Object.assign(s, { crmix: between(0.2, 0.5), crbits: between(0.3, 0.7), crhold: between(0, 0.15) });
    });

    // the matrix: up to three routes. An LFO is set up for each one it needs
    const lfoFor = (i, dest) => {
        const shapes = dest === 4 ? [0, 1 / 6, 5 / 6, 1] : [0, 1 / 6, 2 / 6, 3 / 6, 1];
        s["l" + (i + 1) + "w"] = pick(shapes);
        if (chance(0.3)) {
            s["l" + (i + 1) + "m"] = 1; // (in time with the song)
            s["l" + (i + 1) + "r"] = pick([2, 3, 4, 5, 6]) / 7;
        } else {
            s["l" + (i + 1) + "m"] = chance(0.2) ? 0.5 : 0;
            s["l" + (i + 1) + "r"] = dest === 0 ? between(0.4, 0.6) : between(0.25, 0.6);
        }
        if (chance(0.2)) s["l" + (i + 1) + "f"] = between(0.1, 0.5);
    };
    const envelopeFor = (n) => {
        s["v" + n + "a"] = chance(0.6) ? between(0, 0.3) : between(0.4, 0.8);
        s["v" + n + "d"] = between(0.2, 0.7);
        s["v" + n + "s"] = between(0, 0.6);
        s["v" + n + "r"] = between(0.1, 0.5);
    };
    const routeCount = pick([0, 0, 1, 1, 2, 3]);
    const used = new Set();
    for (let r = 0; r < routeCount; r++) {
        const dest = pick([1, 1, 1, 1, 0, 3, 4, 4, 2, 2, s.sound === 1 || s.sound === 7 ? 5 : 1, 6]);
        const lfoLike = dest === 0 || dest === 3 || dest === 4 || chance(0.6);
        let source;
        let amount;
        if (lfoLike) {
            source = Math.floor(Math.random() * 3);
            if (used.has("l" + source)) continue;
            used.add("l" + source);
            lfoFor(source, dest);
            amount = dest === 0 ? between(0.02, 0.08) : dest === 3 ? between(0.1, 0.4) : dest === 1 ? between(0.15, 0.5) : between(0.2, 0.6);
            if (chance(0.4) && dest !== 3) amount = -amount;
        } else {
            source = pick([3, 4, 5, 9]);
            if (source === 3 || source === 4) {
                if (used.has("e" + source)) continue;
                used.add("e" + source);
                envelopeFor(source - 1);
            }
            amount = between(0.15, 0.55) * (dest === 0 ? 0.3 : 1) * (chance(0.2) ? -1 : 1);
        }
        s["x" + source + "_" + dest] = clamp01(0.5 + amount / 2);
    }
    return s;
}

// the same sound, moved a little in every way: amount is how far (a fraction of the whole dial)
function nudgedSettings(amount = 0.12) {
    const now = presetSettingsOf(selTrack);
    const s = {};
    for (const key of labKeys()) {
        if (typeof now[key] !== "number") continue;
        if (LAB_STEPPED.has(key)) {
            s[key] = now[key];
            if (key === "sound" && chance(0.08)) s[key] = Math.floor(Math.random() * 8);
            continue;
        }
        if (/^x\d+_\d+$/.test(key) && Math.abs(now[key] - 0.5) < 0.001) {
            s[key] = now[key]; // (an empty square in the matrix stays empty)
            continue;
        }
        if (/^(chmix|phmix|flmix|crmix|cpmix)$/.test(key) && now[key] < 0.001) {
            s[key] = 0; // (so does an effect that is off)
            continue;
        }
        s[key] = clamp01(now[key] + (Math.random() + Math.random() - 1) * amount);
    }
    return s;
}

// puts settings on the selected synth track, and shows them
function useSettings(s) {
    Object.assign(trackSettings[selTrack], s);
    applyFx(selTrack);
    applyFilter(selTrack);
    showSound();
}

function labAvailable() {
    return selTrack !== DRUM_TRACK && !isSampler(selTrack);
}

function randomSound(small) {
    if (!labAvailable()) return;
    getCtx();
    useSettings(small ? nudgedSettings() : randomSettings());
    previewNote(60);
}

randomButton.addEventListener("click", (e) => randomSound(e.shiftKey));
smallChanges.addEventListener("click", () => randomSound(true));

// ---- morph ----
// a sound halfway between two (t is 0 for the first, 1 for the second)
function morphSettings(a, b, t) {
    const s = {};
    for (const key in a) {
        if (key === "volume" || typeof a[key] !== "number" || typeof b[key] !== "number") continue;
        if (LAB_STEPPED.has(key) && key !== "uni") s[key] = t < 0.5 ? a[key] : b[key];
        else s[key] = a[key] + (b[key] - a[key]) * t;
    }
    return s;
}

let morphFrom = null; // the sound the slider starts from (this track's sound when the popup was opened)

function fillMorphList() {
    morphTo.innerHTML = "";
    const groups = {};
    allPresets().forEach((p) => {
        if (!groups[p.group]) {
            groups[p.group] = document.createElement("optgroup");
            groups[p.group].label = p.group;
            morphTo.appendChild(groups[p.group]);
        }
        const option = document.createElement("option");
        option.value = p.value;
        option.textContent = p.name;
        groups[p.group].appendChild(option);
    });
}

function openLab() {
    const on = labAvailable();
    document.getElementById("labBox").hidden = !on;
    if (!on) return;
    morphFrom = presetSettingsOf(selTrack);
    morphSlider.value = "0";
    fillMorphList();
    morphStatus.textContent = "Pick a sound to morph into, then move the slider.";
}

function moveMorph() {
    if (!labAvailable() || !morphFrom) return;
    const p = allPresets().find((entry) => entry.value === morphTo.value);
    if (!p) return;
    const b = cleanPresetSettings(p.settings, selTrack);
    const t = Number(morphSlider.value);
    const s = morphSettings(morphFrom, b, t);
    // (the sampler's wave is never the one the sound picks from)
    if (!(s.sound >= 0 && s.sound < SOUNDS.length - 1)) s.sound = morphFrom.sound;
    useSettings(s);
    morphStatus.textContent = t === 0 ? "This is the sound you started from." : t === 1 ? "This is " + p.name + "." : Math.round(t * 100) + "% of the way to " + p.name + ".";
}

morphSlider.addEventListener("input", moveMorph);
morphSlider.addEventListener("change", () => labAvailable() && previewNote(60));
morphTo.addEventListener("change", () => {
    morphFrom = presetSettingsOf(selTrack); // (a new target starts from the sound as it is now)
    morphSlider.value = "0";
    morphStatus.textContent = "Move the slider to morph into it.";
});

// the dice is greyed out where it does nothing (showSound in studio.js calls this)
function showLabButtons() {
    randomButton.disabled = !labAvailable();
}
showLabButtons();
