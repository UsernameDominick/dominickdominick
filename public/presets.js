// presets: the star by the sound picker saves the selected synth track's sound and all its dials (not its volume) under a
// name. Presets are in the sound picker's dropdown, in a group called MY PRESETS: pick one and the selected track gets that
// sound and those dials. (The drum track's sounds are the drums, so presets are for the synth tracks.) They're kept in the
// browser, and they use the helpers in save.js (so load this after it).

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

// the preset the selected track's sound is exactly, if it is one (so the picker can say so)
function matchingPreset(t) {
    const now = presetSettingsOf(t);
    const found = storedPresets().find((p) => {
        const settings = cleanPresetSettings(p.settings, t);
        return Object.keys(now).every((key) => Math.abs(settings[key] - now[key]) < 0.0005);
    });
    return found ? found.name : null;
}

// the group at the end of the sound picker's dropdown (studio.js calls this when it fills the dropdown with the synth sounds)
function addPresetOptions() {
    if (drumMode) return;
    const list = storedPresets();
    if (!list.length) return;
    const group = document.createElement("optgroup");
    group.label = "MY PRESETS";
    list.forEach((p) => {
        const option = document.createElement("option");
        option.value = "p:" + p.name;
        option.textContent = p.name;
        group.appendChild(option);
    });
    soundSelect.appendChild(group);
}

// puts a preset on the selected synth track, and plays a note so you hear it
function applyPresetNamed(name) {
    const p = storedPresets().find((entry) => entry.name === name);
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
    const apply = songButton("USE", "Use " + preset.name + " on the selected track", () => applyPresetNamed(preset.name));
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
    presetName.value = drums ? "" : matchingPreset(selTrack) || "";
    presetStatus.textContent = drums ? "Pick one of the synth tracks to save or use a preset." : "";
    renamingPreset = null;
    showPresetList();
}, { popupOnly: true }); // a popup on a phone too

document.getElementById("presetSave").addEventListener("click", savePreset);
presetName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") savePreset();
});

refreshPresetOptions(); // (the dropdown was filled before this was loaded)
