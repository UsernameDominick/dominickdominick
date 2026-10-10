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
//   oct     0.25 is an octave down, 0.75 an octave up. ftype 0 is low pass, 0.5 high pass, 1 band pass
//   dtime   0 is a 16th, 0.25 an 8th, 0.5 a dotted 8th, 0.75 a quarter, 1 a half
const FACTORY_PRESETS = [
    // bass
    { group: "BASS", name: "Sub Bass", sound: 5, cutoff: 0.45, attack: 0.05, decay: 0.45, sustain: 0.8, release: 0.12, drive: 0.1 },
    { group: "BASS", name: "Acid Bass", sound: 0, oct: 0.25, cutoff: 0.22, resonance: 0.7, fenv: 0.55, attack: 0, decay: 0.3, sustain: 0.3, release: 0.08, glide: 0.15, drive: 0.25 },
    { group: "BASS", name: "Wobble Bass", sound: 1, oct: 0.25, cutoff: 0.4, resonance: 0.45, drive: 0.3, tdep: 0.6, trate: 0.55, attack: 0.02, sustain: 0.9, release: 0.1 },
    { group: "BASS", name: "Reese Bass", sound: 0, oct: 0.25, detune: 0.6, cutoff: 0.35, resonance: 0.2, drive: 0.3, tdep: 0.15, trate: 0.1, attack: 0.05, sustain: 0.9, release: 0.12 },
    { group: "BASS", name: "Pluck Bass", sound: 0, oct: 0.25, cutoff: 0.3, resonance: 0.3, fenv: 0.45, attack: 0, decay: 0.25, sustain: 0.15, release: 0.1 },
    // leads
    { group: "LEAD", name: "Super Lead", sound: 4, detune: 0.3, glide: 0.12, cutoff: 0.85, attack: 0.08, decay: 0.5, sustain: 0.75, release: 0.2, vdep: 0.25, vrate: 0.45, dly: 0.25, dtime: 0.5, dfb: 0.35, rev: 0.2 },
    { group: "LEAD", name: "Square Lead", sound: 1, cutoff: 0.8, glide: 0.1, drive: 0.1, vdep: 0.2, vrate: 0.5, attack: 0.03, sustain: 0.8, release: 0.15, dly: 0.2, dtime: 0.75, dfb: 0.3 },
    { group: "LEAD", name: "Sine Whistle", sound: 2, vdep: 0.35, vrate: 0.5, glide: 0.2, attack: 0.35, sustain: 0.9, release: 0.3, rev: 0.3 },
    { group: "LEAD", name: "Hoover", sound: 4, detune: 0.8, glide: 0.4, drive: 0.5, cutoff: 0.7, resonance: 0.3, vdep: 0.3, vrate: 0.6, attack: 0.05, sustain: 0.8, release: 0.15, rev: 0.15 },
    { group: "LEAD", name: "Chiptune", sound: 1, oct: 0.75, vdep: 0.12, vrate: 0.55, attack: 0, decay: 0.1, sustain: 0.6, release: 0.05 },
    // pads
    { group: "PAD", name: "Warm Pad", sound: 4, detune: 0.4, cutoff: 0.55, resonance: 0.1, attack: 0.75, decay: 0.6, sustain: 0.8, release: 0.6, vdep: 0.1, vrate: 0.2, rev: 0.6 },
    { group: "PAD", name: "Glass Pad", sound: 3, detune: 0.5, cutoff: 0.8, attack: 0.7, sustain: 0.9, release: 0.75, tdep: 0.15, trate: 0.2, dly: 0.3, dtime: 0.75, dfb: 0.5, rev: 0.75 },
    { group: "PAD", name: "Hollow Choir", sound: 7, detune: 0.2, cutoff: 0.5, attack: 0.65, sustain: 0.8, release: 0.6, vdep: 0.15, vrate: 0.35, rev: 0.55 },
    { group: "PAD", name: "Dream Strings", sound: 0, detune: 0.45, cutoff: 0.5, attack: 0.7, sustain: 0.85, release: 0.6, tdep: 0.2, trate: 0.35, rev: 0.5 },
    { group: "PAD", name: "Ambient Drone", sound: 4, detune: 0.6, cutoff: 0.5, attack: 1, sustain: 1, release: 1, vdep: 0.15, vrate: 0.1, tdep: 0.2, trate: 0.1, dly: 0.4, dtime: 1, dfb: 0.5, rev: 1 },
    // keys and plucks
    { group: "KEYS", name: "Organ", sound: 6, cutoff: 0.9, attack: 0.05, decay: 0.2, sustain: 1, release: 0.08, tdep: 0.25, trate: 0.45, rev: 0.25 },
    { group: "KEYS", name: "Electric Piano", sound: 3, cutoff: 0.7, fenv: 0.2, drive: 0.05, attack: 0.02, decay: 0.55, sustain: 0.3, release: 0.35, tdep: 0.25, trate: 0.3, rev: 0.2 },
    { group: "KEYS", name: "Pluck", sound: 0, cutoff: 0.35, fenv: 0.5, attack: 0, decay: 0.3, sustain: 0.08, release: 0.2, dly: 0.35, dtime: 0.75, dfb: 0.4, rev: 0.25 },
    { group: "KEYS", name: "Marimba", sound: 3, oct: 0.75, cutoff: 0.8, attack: 0, decay: 0.4, sustain: 0.05, release: 0.15, rev: 0.2 },
    { group: "KEYS", name: "Bell", sound: 6, oct: 0.75, attack: 0, decay: 0.8, sustain: 0.1, release: 0.7, dly: 0.25, dtime: 0.5, dfb: 0.45, rev: 0.6 },
    // effects
    { group: "FX", name: "Dub Stab", sound: 1, cutoff: 0.6, attack: 0, decay: 0.25, sustain: 0.2, release: 0.2, dly: 0.7, dtime: 0.75, dfb: 0.65, rev: 0.35 },
    { group: "FX", name: "Telephone", sound: 1, ftype: 1, cutoff: 0.6, resonance: 0.6, drive: 0.7, attack: 0.01, sustain: 0.9, release: 0.05 },
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
}, { popupOnly: true }); // a popup on a phone too

document.getElementById("presetSave").addEventListener("click", savePreset);
presetName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") savePreset();
});

refreshPresetOptions(); // (the dropdown was filled before this was loaded)
