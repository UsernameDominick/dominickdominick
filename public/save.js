// saving songs. The save button (the floppy disk) saves the song on the screen under a name, in this browser. The folder
// button under it opens the saved songs: load one, rename it, download it as a file, delete it, or open a song file
// you downloaded. A saved song has the notes, the block lengths, every track's sound and dials, the drum kit, the tempo
// and the song volume. It uses the song and the settings from studio.js, fx.js and drums.js, so load this last.

const SONG_APP = "dominickdominick-daw"; // written into a song file, so a file from somewhere else is turned away
const SONG_VERSION = 1;
const SONGS_KEY = "songs"; // where the saved songs are kept in the browser: a list, newest first
const SONG_NAME_MAX = 30;
const SONG_FILE_MAX = 5 * 1024 * 1024; // a song file bigger than this is not one of ours
const NEW_SONG_NAME = "My song";
const ARM_MS = 3000; // how long a button that asks "sure?" waits for the second click

const saveButton = document.getElementById("saveButton");
const songsButton = document.getElementById("songsButton");
const savePopover = document.getElementById("savePopover");
const songsPopover = document.getElementById("songsPopover");
const saveName = document.getElementById("saveName");
const saveStatus = document.getElementById("saveStatus");
const songsStatus = document.getElementById("songsStatus");
const songList = document.getElementById("songList");
const songFile = document.getElementById("songFile");
const songOpenFile = document.getElementById("songOpenFile");

let songName = NEW_SONG_NAME; // the name of the song on the screen
try {
    songName = cleanSongName(localStorage.getItem("songName")) || NEW_SONG_NAME;
} catch {}
let renamingSong = null; // the name of the saved song that's being renamed in the list, if any
let savedLook = ""; // what the song looked like when it was last saved or loaded (to tell if it has changed since)

// ---- the song as plain data ----

// everything that makes up the song on the screen
function songSnapshot() {
    const tracks = [];
    for (let t = 0; t < TRACKS; t++) {
        tracks.push({
            name: trackName(t),
            color: trackColors[t],
            settings: { ...trackSettings[t] },
            muted: muted[t],
            soloed: soloed[t],
            looped: looped[t],
            clipLen: clipLen[t].slice(),
            bars: song[t].map((bar) => bar.map((n) => ({ ...n }))),
        });
    }
    return {
        tempo: bpm,
        volume: songVolume,
        tracks,
        drums: {
            kit: drumKit.slice(),
            volumes: drumVolumes.slice(),
            fx: drumFx.map((fx) => ({ ...fx })),
            muted: drumMuted.slice(),
            soloed: drumSoloed.slice(),
            looped: drumLooped.slice(),
        },
    };
}

function songChanged() {
    return JSON.stringify(songSnapshot()) !== savedLook;
}

function cleanSongName(text) {
    return typeof text === "string" ? text.trim().replace(/\s+/g, " ").slice(0, SONG_NAME_MAX) : "";
}

// a number from a file that has to be between 0 and 1 (or the usual value if it isn't a number)
function unit(v, usual) {
    return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : usual;
}

function flags(list, count) {
    return Array.from({ length: count }, (_, i) => Array.isArray(list) && list[i] === true);
}

// a track's settings as they start out (the same as in synth.js)
function usualSettings(t) {
    return { sound: 0, volume: 0.5, cutoff: 1, resonance: 0, ...FX_DEFAULTS, ...(t === DRUM_TRACK ? DIAL_DEFAULTS.drums : DIAL_DEFAULTS.synth) };
}

// checks a song that came out of the browser's storage or a file and gives back a safe copy of it. A saved song can't
// be trusted to be right (a file could be anything), so every number is kept inside what the page can handle
function cleanSong(raw) {
    if (!raw || typeof raw !== "object") throw new Error("That is not a song.");
    const tracks = Array.isArray(raw.tracks) ? raw.tracks : [];
    const drums = raw.drums && typeof raw.drums === "object" ? raw.drums : {};
    const tempo = typeof raw.tempo === "number" && Number.isFinite(raw.tempo) ? Math.round(raw.tempo) : 100;
    const clean = { tempo: Math.min(BPM_MAX, Math.max(BPM_MIN, tempo)), volume: unit(raw.volume, 0.5), tracks: [] };

    for (let t = 0; t < TRACKS; t++) {
        const r = tracks[t] && typeof tracks[t] === "object" ? tracks[t] : {};
        const settings = usualSettings(t);
        for (const key in settings) settings[key] = unit(r.settings && r.settings[key], settings[key]);
        const sound = r.settings && r.settings.sound;
        settings.sound = Number.isInteger(sound) && sound >= 0 && sound < SOUNDS.length ? sound : 0;
        const length = [];
        const bars = [];
        for (let b = 0; b < BARS; b++) {
            const len = Array.isArray(r.clipLen) ? r.clipLen[b] : 1;
            length.push(Number.isInteger(len) && len >= 1 ? Math.min(len, BARS - b) : 1);
            const notes = [];
            (Array.isArray(r.bars) && Array.isArray(r.bars[b]) ? r.bars[b] : []).forEach((n) => {
                if (!n || !Number.isInteger(n.note) || n.note < 0 || n.note > 127) return;
                if (typeof n.beat !== "number" || !Number.isFinite(n.beat) || n.beat < 0 || n.beat >= BEATS * BARS) return;
                const note = { beat: n.beat, note: n.note };
                for (const key in PARAM_DEFAULTS) if (typeof n[key] === "number" && Number.isFinite(n[key])) note[key] = unit(n[key], PARAM_DEFAULTS[key]);
                notes.push(note);
            });
            bars.push(notes);
        }
        clean.tracks.push({
            name: cleanSongName(r.name).slice(0, 24) || (t === DRUM_TRACK ? "DRUMS" : "TRK " + (t + 1)),
            color: TRACK_PALETTE.some((entry) => entry.color === r.color) ? r.color : TRACK_PALETTE[t].color,
            settings,
            muted: r.muted === true,
            soloed: r.soloed === true,
            looped: r.looped === true,
            clipLen: length,
            bars,
        });
    }

    clean.drums = {
        kit: DRUM_NOTES.map((_, i) => {
            const sound = Array.isArray(drums.kit) ? drums.kit[i] : null;
            return Number.isInteger(sound) && sound >= 0 && sound < DRUM_SOUNDS.length ? sound : drumIndex(...BASE_KIT[i]);
        }),
        volumes: DRUM_NOTES.map((_, i) => unit(Array.isArray(drums.volumes) ? drums.volumes[i] : null, 0.5)),
        fx: DRUM_NOTES.map((_, i) => {
            const fx = { pan: 0.5, dly: 0, rev: 0, pitch: 0.5, decay: 0.5 };
            for (const key in fx) fx[key] = unit(Array.isArray(drums.fx) && drums.fx[i] ? drums.fx[i][key] : null, fx[key]);
            return fx;
        }),
        muted: flags(drums.muted, DRUM_COUNT),
        soloed: flags(drums.soloed, DRUM_COUNT),
        looped: flags(drums.looped, DRUM_COUNT),
    };
    return clean;
}

// puts a (clean) song on the screen, in place of the one that's there
function showSong(clean) {
    if (running) stopTransport();
    getCtx(); // (this is after a click) the tracks' audio has to exist for the dials to be applied
    setBpm(clean.tempo);
    const volume = document.getElementById("songVolume");
    volume.value = String(clean.volume);
    volume.dispatchEvent(new Event("input")); // (the dial moves and the volume follows, like turning it)

    clean.tracks.forEach((r, t) => {
        Object.assign(trackSettings[t], r.settings);
        renameTrack(t, r.name);
        trackHeads[t].name.textContent = r.name;
        muted[t] = r.muted;
        soloed[t] = r.soloed;
        looped[t] = r.looped;
        for (let b = 0; b < BARS; b++) {
            song[t][b] = r.bars[b];
            clipLen[t][b] = r.clipLen[b];
        }
        applyFx(t);
        applyFilter(t);
        trackGains[t].gain.value = t === DRUM_TRACK ? 1 : r.settings.volume;
        setTrackColor(t, r.color);
    });

    const d = clean.drums;
    d.kit.forEach((sound, i) => (drumKit[i] = sound));
    saveDrumKit();
    refreshDrumKeys();
    DRUM_NOTES.forEach((note, i) => {
        setDrumVolume(note, d.volumes[i]);
        for (const key in d.fx[i]) setDrumFx(note, key, d.fx[i][key]);
        drumMuted[i] = d.muted[i];
        drumSoloed[i] = d.soloed[i];
        drumLooped[i] = d.looped[i];
    });

    selectBlock(selTrack, selBar); // (a block that now covers the selected bar is selected whole)
    layoutSong(); // draws every block again
    showAudible();
    showSound(); // the sound picker and the dials show the selected sound
    updateButtons();
    resetHistory(); // (nothing to undo in a song that's just been opened)
}

// ---- the saved songs in the browser ----

function storedSongs() {
    try {
        const list = JSON.parse(localStorage.getItem(SONGS_KEY));
        return Array.isArray(list) ? list.filter((entry) => entry && typeof entry.name === "string" && entry.song) : [];
    } catch {
        return [];
    }
}

// keeps the list, or says no if the browser won't (its storage is full, or switched off)
function keepSongs(list) {
    try {
        localStorage.setItem(SONGS_KEY, JSON.stringify(list));
        return true;
    } catch {
        return false;
    }
}

function sameName(a, b) {
    return a.toLowerCase() === b.toLowerCase();
}

function timeText(ms) {
    return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function noteCount(snapshot) {
    let count = 0;
    try {
        snapshot.tracks.forEach((track) => track.bars.forEach((bar) => (count += bar.length)));
    } catch {}
    return count;
}

// saves the song on the screen under the name in the box (or the name it has), in place of a saved song with that name
function saveSong() {
    const name = cleanSongName(saveName.value) || songName || NEW_SONG_NAME;
    const list = storedSongs();
    const entry = { name, saved: Date.now(), song: songSnapshot() };
    const at = list.findIndex((other) => sameName(other.name, name));
    if (at >= 0) list.splice(at, 1);
    list.unshift(entry);
    if (!keepSongs(list)) {
        saveStatus.textContent = "The browser would not keep it (its storage is full). Use DOWNLOAD FILE.";
        return false;
    }
    songName = name;
    rememberSongName();
    savedLook = JSON.stringify(entry.song);
    saveName.value = name;
    saveStatus.textContent = (at >= 0 ? "Saved over " : "Saved ") + name + " at " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + ".";
    flashSaved();
    return true;
}

function rememberSongName() {
    try {
        localStorage.setItem("songName", songName);
    } catch {}
}

// the floppy disk turns into a tick for a moment, so a save with Ctrl+S (no popup) is seen too
let savedTimer;
function flashSaved() {
    saveButton.classList.add("saved");
    saveButton.setAttribute("aria-label", "Saved");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
        saveButton.classList.remove("saved");
        saveButton.setAttribute("aria-label", "Save the song");
    }, 1500);
}

// what the quick save popup says about the song on the screen
function saveSummary() {
    const found = storedSongs().find((entry) => sameName(entry.name, songName));
    if (!found) return "Not saved yet.";
    return songChanged() ? "Changed since the last save." : "All changes saved.";
}

// a button that asks "sure?" first: the first click changes its words, a second click soon after does it
function askFirst(button, words, run, needed = true) {
    if (!needed || button.dataset.armed) {
        clearTimeout(button.armTimer);
        delete button.dataset.armed;
        run();
        return;
    }
    const was = button.textContent;
    button.dataset.armed = "true";
    button.textContent = words;
    button.armTimer = setTimeout(() => {
        delete button.dataset.armed;
        button.textContent = was;
    }, ARM_MS);
}

// ---- the files ----

function fileNameFor(name) {
    return (name.replace(/[^a-z0-9 _-]+/gi, "").trim().replace(/\s+/g, "-").toLowerCase() || "song") + ".json";
}

function downloadSong(name, saved, snapshot) {
    const text = JSON.stringify({ app: SONG_APP, version: SONG_VERSION, name, saved, song: snapshot });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    link.download = fileNameFor(name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// reads a song file, and shows its song (the name comes from the file)
async function openSongFile(file) {
    try {
        if (file.size > SONG_FILE_MAX) throw new Error("That file is too big to be a song.");
        let raw;
        try {
            raw = JSON.parse(await file.text());
        } catch {
            throw new Error("That file is not a song file.");
        }
        if (!raw || raw.app !== SONG_APP) throw new Error("That file is not a song from here.");
        if (raw.version > SONG_VERSION) throw new Error("That song is from a newer version of this page.");
        const clean = cleanSong(raw.song);
        showSong(clean);
        songName = cleanSongName(raw.name) || NEW_SONG_NAME;
        rememberSongName();
        savedLook = JSON.stringify(songSnapshot());
        songsStatus.textContent = "Opened " + songName + ". Press the save button to keep it in this browser.";
        showSongList();
    } catch (err) {
        songsStatus.textContent = err.message;
    }
}

// ---- the saved songs list ----

function loadSong(entry) {
    try {
        showSong(cleanSong(entry.song));
        songName = entry.name;
        rememberSongName();
        savedLook = JSON.stringify(songSnapshot());
        songsStatus.textContent = "Loaded " + entry.name + ".";
        showSongList();
    } catch (err) {
        songsStatus.textContent = "Could not load that song: " + err.message;
    }
}

function renameSong(entry, text) {
    const name = cleanSongName(text);
    renamingSong = null;
    if (!name || name === entry.name) return showSongList();
    const list = storedSongs();
    if (list.some((other) => other.name !== entry.name && sameName(other.name, name))) {
        songsStatus.textContent = "There is already a song called " + name + ".";
        return showSongList();
    }
    const found = list.find((other) => other.name === entry.name);
    if (found) found.name = name;
    if (!keepSongs(list)) songsStatus.textContent = "The browser would not keep the new name.";
    else songsStatus.textContent = "Renamed to " + name + ".";
    if (songName === entry.name) {
        songName = name;
        rememberSongName();
        saveName.value = name;
    }
    showSongList();
}

function deleteSong(entry) {
    keepSongs(storedSongs().filter((other) => other.name !== entry.name));
    songsStatus.textContent = "Deleted " + entry.name + ".";
    showSongList();
}

function songButton(words, label, onClick) {
    const button = make("button", "tool song-act", words);
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.addEventListener("click", onClick);
    return button;
}

function songRow(entry) {
    const row = make("div", "song-row");
    row.classList.toggle("current", sameName(entry.name, songName));
    const info = make("div", "song-info");
    const renaming = renamingSong === entry.name;
    let box;
    if (renaming) {
        box = make("input", "text-input");
        box.type = "text";
        box.maxLength = SONG_NAME_MAX;
        box.value = entry.name;
        box.setAttribute("aria-label", "New name for " + entry.name);
        box.addEventListener("keydown", (e) => {
            if (e.key === "Enter") renameSong(entry, box.value);
            if (e.key === "Escape") {
                e.stopPropagation(); // (the popup stays, only the renaming stops)
                renamingSong = null;
                showSongList();
            }
        });
        info.appendChild(box);
    } else {
        info.appendChild(make("div", "song-title", entry.name));
    }
    const notes = noteCount(entry.song);
    info.appendChild(make("div", "song-meta", notes + (notes === 1 ? " note" : " notes") + ", " + timeText(entry.saved)));

    const actions = make("div", "song-actions");
    const load = songButton("LOAD", "Load " + entry.name, () => {
        askFirst(load, "REPLACE?", () => loadSong(entry), songChanged());
    });
    const rename = songButton(renaming ? "OK" : "RENAME", (renaming ? "Finish renaming " : "Rename ") + entry.name, () => {
        if (renaming) return renameSong(entry, box.value);
        renamingSong = entry.name;
        showSongList();
    });
    const download = songButton("DOWNLOAD", "Download " + entry.name + " as a file", () => downloadSong(entry.name, entry.saved, entry.song));
    const remove = songButton("DELETE", "Delete " + entry.name, () => askFirst(remove, "SURE?", () => deleteSong(entry)));
    actions.append(load, rename, download, remove);
    row.append(info, actions);
    if (renaming) setTimeout(() => box.focus(), 0);
    return row;
}

function showSongList() {
    const list = storedSongs();
    songList.innerHTML = "";
    if (!list.length) {
        songList.appendChild(make("p", "song-empty", "Nothing saved yet. Use the save button to keep the song."));
        return;
    }
    list.forEach((entry) => songList.appendChild(songRow(entry)));
}

// ---- the buttons ----

registerPanel("save", saveButton, savePopover, null, () => {
    saveName.value = songName;
    saveStatus.textContent = saveSummary();
}, { popupOnly: true }); // a popup on a phone too

registerPanel("songs", songsButton, songsPopover, null, () => {
    renamingSong = null;
    songsStatus.textContent = "";
    showSongList();
}, { popupOnly: true });

document.getElementById("saveNow").addEventListener("click", saveSong);
saveName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveSong();
});
document.getElementById("saveDownload").addEventListener("click", () => {
    const name = cleanSongName(saveName.value) || songName;
    downloadSong(name, Date.now(), songSnapshot());
    saveStatus.textContent = "Downloaded " + fileNameFor(name) + ".";
});

songOpenFile.addEventListener("click", () => askFirst(songOpenFile, "REPLACE?", () => songFile.click(), songChanged()));
songFile.addEventListener("change", () => {
    const file = songFile.files[0];
    songFile.value = ""; // (so the same file can be opened again)
    if (file) openSongFile(file);
});

// Ctrl+S (Command+S on a Mac) saves, instead of the browser offering to save the page
document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (document.activeElement !== saveName) saveName.value = songName;
        saveSong();
    }
});

savedLook = JSON.stringify(songSnapshot()); // the song as the page starts: nothing to save yet
