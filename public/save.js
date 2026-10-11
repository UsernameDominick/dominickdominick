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
            clipLen: clipLen[t].slice(0, BARS),
            bars: song[t].slice(0, BARS).map((bar) => bar.map((n) => ({ ...n }))),
        });
    }
    return {
        tempo: bpm,
        volume: songVolume,
        barCount: BARS, // (how many bars long it is. The tracks are as many as there are in the list)
        filterTypes: 5, // (a song from before the filter had five types has 0, 0.5 and 1 for low pass, high pass and band pass: see cleanSong)
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
    // how long it is and how many tracks it has (a song from before there was a choice has 8 bars and 5 tracks)
    const barCount = Number.isInteger(raw.barCount) ? Math.min(MAX_BARS, Math.max(4, raw.barCount)) : 8;
    const trackCount = tracks.length ? Math.min(MAX_TRACKS, Math.max(MIN_TRACKS, tracks.length)) : 5;
    const oldFilterTypes = raw.filterTypes !== 5;
    const clean = { tempo: Math.min(BPM_MAX, Math.max(BPM_MIN, tempo)), volume: unit(raw.volume, 0.5), barCount, tracks: [] };

    for (let t = 0; t < trackCount; t++) {
        const r = tracks[t] && typeof tracks[t] === "object" ? tracks[t] : {};
        const settings = usualSettings(t);
        for (const key in settings) settings[key] = unit(r.settings && r.settings[key], settings[key]);
        // (a song from before UNI and SPREAD had three copies when DETUNE was up, all in the middle of the speakers)
        const saved = r.settings || {};
        if (typeof saved.uni !== "number") settings.uni = settings.detune > 0.0125 ? 2 / 15 : 0;
        if (typeof saved.spread !== "number") settings.spread = 0;
        if (oldFilterTypes) settings.ftype = legacyFilterType(settings.ftype);
        const sound = r.settings && r.settings.sound;
        settings.sound = Number.isInteger(sound) && sound >= 0 && sound < SOUNDS.length ? sound : 0;
        const length = [];
        const bars = [];
        for (let b = 0; b < barCount; b++) {
            const len = Array.isArray(r.clipLen) ? r.clipLen[b] : 1;
            length.push(Number.isInteger(len) && len >= 1 ? Math.min(len, barCount - b) : 1);
            const notes = [];
            (Array.isArray(r.bars) && Array.isArray(r.bars[b]) ? r.bars[b] : []).forEach((n) => {
                if (!n || !Number.isInteger(n.note) || n.note < 0 || n.note > 127) return;
                if (typeof n.beat !== "number" || !Number.isFinite(n.beat) || n.beat < 0 || n.beat >= BEATS * barCount) return;
                const note = { beat: n.beat, note: n.note };
                for (const key in PARAM_DEFAULTS) if (typeof n[key] === "number" && Number.isFinite(n[key])) note[key] = unit(n[key], PARAM_DEFAULTS[key]);
                notes.push(note);
            });
            bars.push(notes);
        }
        clean.tracks.push({
            name: cleanSongName(r.name).slice(0, 24) || (t === DRUM_TRACK ? "DRUMS" : "TRK " + (t + 1)),
            color: TRACK_PALETTE.some((entry) => entry.color === r.color) ? r.color : TRACK_PALETTE[t % TRACK_PALETTE.length].color,
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
            const fx = { ...DRUM_FX_DEFAULTS };
            const saved = Array.isArray(drums.fx) && drums.fx[i] && typeof drums.fx[i] === "object" ? drums.fx[i] : {};
            // (a song saved when the drums shared the filter, the fade, the drive and so on has those on the drum track's own
            // settings, so every drum starts from them)
            const shared = tracks[DRUM_TRACK] && tracks[DRUM_TRACK].settings ? tracks[DRUM_TRACK].settings : {};
            for (const key in fx) {
                const fromTrack = key === "edecay" ? shared.decay : key === "pan" || key === "dly" || key === "rev" || key === "pitch" || key === "decay" ? undefined : shared[key];
                fx[key] = unit(typeof saved[key] === "number" ? saved[key] : fromTrack, fx[key]);
            }
            if (oldFilterTypes) fx.ftype = legacyFilterType(fx.ftype);
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
    // (no audio is made here: a song that comes back when the page opens must stay quiet until you click. If the audio is
    // running its dials are moved to match, and if it isn't they are used when it starts)
    // the size first: the grid is built again if it isn't the size of the song. Everything the song doesn't use is cleared (the
    // tracks after its last one are as new, so they are as they start if a track is added)
    if (clean.barCount !== BARS || clean.tracks.length !== TRACKS) {
        BARS = clean.barCount;
        TRACKS = clean.tracks.length;
        rebuildSong();
    }
    for (let t = 0; t < MAX_TRACKS; t++) {
        for (let b = 0; b < MAX_BARS; b++) {
            song[t][b] = [];
            clipLen[t][b] = 1;
        }
        if (t >= TRACKS) {
            Object.assign(trackSettings[t], usualSettings(t));
            muted[t] = soloed[t] = looped[t] = false;
            if (ctx) {
                applyFx(t);
                applyFilter(t);
                trackGains[t].gain.value = trackSettings[t].volume;
            }
        }
    }
    setBpm(clean.tempo);
    songVolume = clean.volume;
    document.getElementById("songVolume").value = String(clean.volume);
    songVolumeStrip.update(); // (the dial turns and says the new volume)
    if (ctx) master.gain.setTargetAtTime(songVolume * 2, ctx.currentTime, 0.015);

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
        if (ctx) {
            applyFx(t);
            applyFilter(t);
            trackGains[t].gain.value = t === DRUM_TRACK ? 1 : r.settings.volume;
        }
        setTrackColor(t, r.color);
    });

    const d = clean.drums;
    d.kit.forEach((sound, i) => (drumKit[i] = sound));
    saveDrumKit();
    refreshDrumKeys();
    DRUM_NOTES.forEach((note, i) => {
        setDrumVolume(note, d.volumes[i]);
        Object.assign(drumFx[i], d.fx[i]);
        drumMuted[i] = d.muted[i];
        drumSoloed[i] = d.soloed[i];
        drumLooped[i] = d.looped[i];
    });

    saveDrumFx();
    drumFx.forEach((_, slot) => applyDrumChannel(slot)); // (the drums that have been played are given their settings)
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
    if (!found) return "Not saved yet. The page keeps your latest work and brings it back when you come back.";
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

function fileNameFor(name, extension = ".json") {
    return (name.replace(/[^a-z0-9 _-]+/gi, "").trim().replace(/\s+/g, "-").toLowerCase() || "song") + extension;
}

// gives the browser a file to save
function downloadBlob(blob, fileName) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function downloadSong(name, saved, snapshot) {
    const text = JSON.stringify({ app: SONG_APP, version: SONG_VERSION, name, saved, song: snapshot });
    downloadBlob(new Blob([text], { type: "application/json" }), fileNameFor(name));
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

// ---- a new song ----

function newSong() {
    showSong(cleanSong({})); // (with nothing in it, everything is how a song starts)
    songName = NEW_SONG_NAME;
    rememberSongName();
    saveName.value = songName;
    savedLook = JSON.stringify(songSnapshot());
    songsStatus.textContent = "A new song, with nothing in it.";
}

const songNewButton = document.getElementById("songNew");
songNewButton.addEventListener("click", () => askFirst(songNewButton, "REPLACE?", newSong, songChanged()));

// ---- a link to the song ----
// The song is squashed (deflate) and written into the address after a #, so a link opens the song for whoever has it. Nothing
// goes to a server: the part after the # never leaves the browser until they open the link.

const SHARE_START = "#song=";
const SHARE_LONG = 6000; // a link longer than this might be cut short by an app it's pasted into
const SHARE_MAX_BYTES = 2 * 1024 * 1024; // the most a link can unpack to (so a link can't be made to fill the memory)
const shareButton = document.getElementById("shareLink");
const shareBox = document.getElementById("shareBox");

function toBase64Url(bytes) {
    let text = "";
    bytes.forEach((byte) => (text += String.fromCharCode(byte)));
    return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
    const plain = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(plain, (c) => c.charCodeAt(0));
}

async function squash(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unsquash(bytes) {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const parts = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > SHARE_MAX_BYTES) {
            reader.cancel();
            throw new Error("That link is too big to be a song.");
        }
        parts.push(value);
    }
    return new TextDecoder().decode(await new Blob(parts).arrayBuffer());
}

async function shareLinkFor(name, snapshot) {
    const bytes = await squash(JSON.stringify({ app: SONG_APP, version: SONG_VERSION, name, song: snapshot }));
    return location.origin + location.pathname + SHARE_START + toBase64Url(bytes);
}

// the song a link holds, checked and cleaned like any other song, or null if the address has no song in it
async function songFromLink(hash) {
    if (!hash.startsWith(SHARE_START)) return null;
    let raw;
    try {
        raw = JSON.parse(await unsquash(fromBase64Url(hash.slice(SHARE_START.length))));
    } catch (err) {
        throw new Error(err.message.startsWith("That link") ? err.message : "That link is not a song.");
    }
    if (!raw || raw.app !== SONG_APP) throw new Error("That link is not a song from here.");
    return { name: cleanSongName(raw.name) || NEW_SONG_NAME, clean: cleanSong(raw.song) };
}

shareButton.addEventListener("click", async () => {
    const name = cleanSongName(saveName.value) || songName;
    try {
        const link = await shareLinkFor(name, songSnapshot());
        shareBox.value = link;
        shareBox.hidden = false;
        let copied = false;
        try {
            await navigator.clipboard.writeText(link);
            copied = true;
        } catch {
            shareBox.select(); // (the browser won't let the page copy, so the link is selected to copy by hand)
        }
        saveStatus.textContent =
            (copied ? "Link copied" : "Copy the link below") + " (" + link.length + " characters)." +
            (link.length > SHARE_LONG ? " It is long: some apps may cut it short, so DOWNLOAD FILE is safer to send." : "");
    } catch {
        saveStatus.textContent = "This browser can't make a link. Use DOWNLOAD FILE to share.";
    }
});

// opens the song in the address (when the page opens, or when a link is pasted into a page that is already open). The song that
// was being worked on isn't lost: if it has changes that aren't saved it is saved first, as "Before opening a link"
async function openSharedLink() {
    let found;
    try {
        found = await songFromLink(location.hash);
    } catch (err) {
        history.replaceState(null, "", location.pathname + location.search);
        songsStatus.textContent = err.message;
        return false;
    }
    if (!found) return false;
    history.replaceState(null, "", location.pathname + location.search); // (so a reload doesn't open it again)
    if (songChanged() && hasMusic()) {
        const list = storedSongs().filter((entry) => !sameName(entry.name, "Before opening a link"));
        list.unshift({ name: "Before opening a link", saved: Date.now(), song: songSnapshot() });
        keepSongs(list);
    }
    showSong(found.clean);
    songName = found.name;
    rememberSongName();
    saveName.value = songName;
    savedLook = ""; // (it isn't saved anywhere yet)
    songsStatus.textContent = "Opened " + songName + " from a link. Press the save button to keep it.";
    return true;
}

window.addEventListener("hashchange", openSharedLink);

// is there anything in the song? (notes anywhere)
function hasMusic() {
    return song.some((track, t) => t < TRACKS && track.some((bar, b) => b < BARS && bar.length > 0));
}

// ---- autosave ----
// The song on the screen is kept in the browser every couple of seconds (when it has changed) and when the page is closed or
// hidden, and it comes back when the page opens, so a reload doesn't lose it. This is separate from the saved songs.

const AUTOSAVE_KEY = "autosave";
let autosavedLook = "";

function autosave() {
    const snapshot = songSnapshot();
    const look = JSON.stringify(snapshot);
    if (look === autosavedLook) return;
    try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ name: songName, saved: Date.now(), song: snapshot }));
        autosavedLook = look;
    } catch {}
}

// puts the autosaved song back on the screen
function restoreAutosave() {
    try {
        const stored = JSON.parse(localStorage.getItem(AUTOSAVE_KEY));
        if (!stored || !stored.song) return false;
        showSong(cleanSong(stored.song));
        songName = cleanSongName(stored.name) || NEW_SONG_NAME;
        saveName.value = songName;
        // (if it is a song that was saved, and it hasn't changed since, it counts as saved)
        const found = storedSongs().find((entry) => sameName(entry.name, songName));
        if (found && JSON.stringify(found.song) === JSON.stringify(songSnapshot())) savedLook = JSON.stringify(found.song);
        return true;
    } catch {
        return false;
    }
}

savedLook = JSON.stringify(songSnapshot()); // the song as the page starts: nothing to save yet

(async () => {
    restoreAutosave(); // (first, so that if the address has a song in it, the song that was being worked on is kept: see openSharedLink)
    await openSharedLink();
    autosavedLook = JSON.stringify(songSnapshot());
    setInterval(autosave, 2000); // (only now, so the song that was kept isn't written over before it is back)
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") autosave();
    });
    window.addEventListener("pagehide", autosave);
})();
