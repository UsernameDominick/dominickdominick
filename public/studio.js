// the song: 5 tracks, and each track has 8 blocks (one bar of music each).
// record notes from the piano into a block, mute a track, copy / paste / clear blocks, and
// press play to hear the whole thing. It uses the synth from synth.js (so load that first).

// (TRACKS, how many tracks there are, and each track's settings (trackSettings) live in synth.js)
const MAX_BARS = 32; // the most bars a song can have. The data for all of them is kept, a shorter song just doesn't show or play the rest
let BARS = 8; // bars in the song right now (blocks per track)
const BEATS = 4; // beats in a bar
const LOOKAHEAD = 0.12; // seconds ahead that the scheduler plans notes
const TICK_MS = 25; // how often the scheduler wakes up (in milliseconds)

// song[track][bar] is a list of notes: { beat: 0 up to just under 4, note: MIDI number }
const song = Array.from({ length: MAX_TRACKS }, () => Array.from({ length: MAX_BARS }, () => []));
// a block can be stretched over more bars (the pattern in it loops). clipLen[track][bar] is how many bars the
// block that starts at that bar covers. The bars a block covers hide their own blocks, they come back if it shrinks
const clipLen = Array.from({ length: MAX_TRACKS }, () => new Array(MAX_BARS).fill(1));
const muted = new Array(MAX_TRACKS).fill(false);
// a track on loop repeats what's in it to fill the rest of the song: its blocks, up to the last one with notes in,
// go round again and again until bar 8 (the repeats show as faded blocks)
const looped = new Array(MAX_TRACKS).fill(false);
const soloed = new Array(MAX_TRACKS).fill(false); // with any track on solo, only the soloed tracks are heard
let selTrack = 0; // the selected block
let selBar = 0;
let clipboard = null; // a copied block ({ notes, len }), or null if nothing is copied

// the recording options (the arrow by REC opens them, record.js has the popup). Each one is a place in its list below, and
// they're remembered
const QUANTIZE_STEPS = [0, 1, 0.5, 0.25, 0.125]; // recorded notes snap to the nearest one of these (in beats), 0 is off
const QUANTIZE_NAMES = ["OFF", "1/4", "1/8", "1/16", "1/32"];
const SWING_AMOUNTS = [0, 0.25, 0.5, 0.75, 1]; // how far the late notes are pushed: 1 is half a step later
const SWING_NAMES = ["OFF", "25%", "50%", "75%", "100%"];
const SWING_GRIDS = [0.5, 0.25]; // the notes it swings are the off-beats of this size of step, in beats
const SWING_GRID_NAMES = ["8THS", "16THS"];
const REC_MODES = ["REPLACE", "OVERDUB"]; // REPLACE clears the block when recording starts, OVERDUB keeps what's in it
const OFF_ON = ["OFF", "ON"];
const recordOptions = { quantize: 3, swing: 0, swingGrid: 1, mode: 0, loop: 0, step: 0 };
const recordLists = { quantize: QUANTIZE_NAMES, swing: SWING_NAMES, swingGrid: SWING_GRID_NAMES, mode: REC_MODES, loop: OFF_ON, step: OFF_ON };
try {
    const saved = JSON.parse(localStorage.getItem("recordOptions"));
    for (const key in recordOptions) {
        if (saved && Number.isInteger(saved[key]) && saved[key] >= 0 && saved[key] < recordLists[key].length) recordOptions[key] = saved[key];
    }
} catch {}

// the size of a quantize step in beats (a step recording with quantize off moves by a sixteenth)
function quantizeStep() {
    return QUANTIZE_STEPS[recordOptions.quantize];
}

// how much later (in beats) swing plays a note that starts this far into a bar. Only the notes on the off-beats of the grid
// move (every other step), and the others stay where they are
function swingDelay(beat) {
    const amount = SWING_AMOUNTS[recordOptions.swing];
    if (!amount) return 0;
    const step = SWING_GRIDS[recordOptions.swingGrid];
    const place = beat / step;
    const nearest = Math.round(place);
    if (Math.abs(place - nearest) > 0.05 || nearest % 2 === 0) return 0;
    return amount * 0.5 * step;
}

// transport (play and record)
let bpm = 100; // set by the BPM strip, used the next time you press play or rec
let running = false;
let recordArmed = false; // true if this run is a recording
let beatSec; // seconds per beat for this run
let startTime; // audio clock time of beat 0 for this run
let nextBeat; // the next beat the scheduler hasn't planned yet
let recTrack; // where this run is recording to
let recBar;
let countBeats = 0; // how many beats of count-in come before this recording starts (set when you press rec)
let recBeats = BEATS; // how many beats long the recording is: the whole block, however many bars it is
let recLoop = false; // this recording goes round and round the block until you stop it (set when you press rec)
let recOverdub = false; // this recording adds to what's in the block (and plays it) instead of replacing it
// step recording (no clock): the selected block gets a cursor, each note you play goes in at the cursor and the cursor moves
// on a step. null when it's off, or else the cursor's place in beats from the start of the block
let stepCursor = null;
let stepTimer = null; // waiting a moment to move on, so the notes of a chord all go in the same place
const STEP_CHORD_MS = 90;
let tickTimer;
let lastNowBar = -1; // which bar is lit up as playing right now (-1 is none)

// things on the page
const songEl = document.getElementById("song");
const playBtn = document.getElementById("playButton");
const stopBtn = document.getElementById("stopButton");
const recBtn = document.getElementById("recButton");
const recText = recBtn.querySelector(".rec-text");
const copyBtn = document.getElementById("copyButton");
const pasteBtn = document.getElementById("pasteButton");
const clearBtn = document.getElementById("clearButton");
const soundSelect = document.getElementById("soundSelect");
const soundUp = document.getElementById("soundUp");
const soundDown = document.getElementById("soundDown");

// the colours a track can have (the first five are the ones the five tracks start with)
const TRACK_PALETTE = [
    { name: "Amber", color: "#f2a900" },
    { name: "Red", color: "#d63a1d" },
    { name: "Sage", color: "#7fb069" },
    { name: "Blue", color: "#4f9dbf" },
    { name: "Rose", color: "#e59ac0" },
    { name: "Orange", color: "#ff8c1a" },
    { name: "Violet", color: "#9b7fd1" },
    { name: "Cream", color: "#e6d5ab" },
];
const trackColors = Array.from({ length: MAX_TRACKS }, (_, t) => TRACK_PALETTE[t % TRACK_PALETTE.length].color);
try {
    const savedColors = JSON.parse(localStorage.getItem("trackColors"));
    if (Array.isArray(savedColors)) {
        savedColors.forEach((color, t) => {
            if (TRACK_PALETTE.some((entry) => entry.color === color)) trackColors[t] = color;
        });
    }
} catch {}

const trackMenu = make("div", "track-context-menu");
trackMenu.setAttribute("role", "menu");
trackMenu.setAttribute("aria-label", "Track options");
trackMenu.hidden = true;
const renameTrackButton = make("button", "track-menu-action", "RENAME TRACK");
renameTrackButton.type = "button";
renameTrackButton.setAttribute("role", "menuitem");
const renameForm = make("form", "track-rename-form");
renameForm.hidden = true;
const renameInput = document.createElement("input");
renameInput.type = "text";
renameInput.maxLength = 24;
renameInput.required = true;
renameInput.setAttribute("aria-label", "Track name");
const renameActions = make("div", "track-rename-actions");
const saveTrackName = make("button", "track-menu-action", "SAVE");
saveTrackName.type = "submit";
const cancelTrackRename = make("button", "track-menu-action", "CANCEL");
cancelTrackRename.type = "button";
renameActions.append(saveTrackName, cancelTrackRename);
renameForm.append(renameInput, renameActions);
const colorChoices = make("div", "track-color-choices");
colorChoices.setAttribute("role", "group");
colorChoices.setAttribute("aria-label", "Track color");
TRACK_PALETTE.forEach(({ name, color }) => {
    const choice = make("button", "track-color-choice");
    choice.type = "button";
    choice.style.backgroundColor = color;
    choice.setAttribute("aria-label", "Set track color to " + name);
    choice.setAttribute("role", "menuitemradio");
    choice.dataset.color = color;
    choice.addEventListener("click", () => setTrackColor(menuTrack, color));
    colorChoices.appendChild(choice);
});
trackMenu.append(renameTrackButton, renameForm, colorChoices);
document.body.appendChild(trackMenu);
let menuTrack = 0;

function openTrackMenu(e, t) {
    e.preventDefault();
    selectBlock(t, selBar);
    menuTrack = t;
    renameForm.hidden = true;
    renameTrackButton.hidden = false;
    trackMenu.hidden = false;
    colorChoices.querySelectorAll(".track-color-choice").forEach((choice) => {
        choice.setAttribute("aria-checked", String(choice.dataset.color === trackColors[t]));
    });
    const left = Math.max(8, Math.min(e.clientX, window.innerWidth - trackMenu.offsetWidth - 8));
    const top = Math.max(8, Math.min(e.clientY, window.innerHeight - trackMenu.offsetHeight - 8));
    trackMenu.style.left = left + "px";
    trackMenu.style.top = top + "px";
    renameTrackButton.focus();
}

function closeTrackMenu() {
    trackMenu.hidden = true;
}

function setTrackColor(t, color) {
    if (!TRACK_PALETTE.some((entry) => entry.color === color)) return;
    trackColors[t] = color;
    try {
        localStorage.setItem("trackColors", JSON.stringify(trackColors));
    } catch {}
    trackHeads[t].head.style.setProperty("--track-color", color);
    cells[t].forEach(({ block }) => block.style.setProperty("--track-color", color));
    cells[t].forEach((_, b) => drawBlock(t, b));
    drawGraphs(); // (the graphs are the colour of the selected track)
    closeTrackMenu();
}

renameTrackButton.addEventListener("click", () => {
    renameInput.value = trackName(menuTrack);
    renameForm.hidden = false;
    renameTrackButton.hidden = true;
    renameInput.focus();
    renameInput.select();
});

renameForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = renameInput.value.trim().slice(0, 24);
    if (name) {
        renameTrack(menuTrack, name);
        trackHeads[menuTrack].name.textContent = name;
        showSound();
    }
    closeTrackMenu();
});

cancelTrackRename.addEventListener("click", () => {
    renameForm.hidden = true;
    renameTrackButton.hidden = false;
    renameTrackButton.focus();
});

document.addEventListener("pointerdown", (e) => {
    if (!trackMenu.hidden && !trackMenu.contains(e.target)) closeTrackMenu();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !trackMenu.hidden) closeTrackMenu();
});

const handleEl = make("div", "block-handle"); // the grip on the selected block's right edge, drag it to resize the block
// the corner above the track names holds the button for the size of the song: how many bars, and how many tracks (it opens a popup)
const cornerEl = make("div", "corner");
const sizeButton = make("button", "tool size-button");
sizeButton.id = "sizeButton";
sizeButton.setAttribute("aria-expanded", "false");
const sizeText = make("span", "size-text");
sizeButton.append(sizeText, make("span", "menu-arrow"));
sizeButton.querySelector(".menu-arrow").setAttribute("aria-hidden", "true");
cornerEl.appendChild(sizeButton);
function showSizeText() {
    sizeText.textContent = BARS + " BARS, " + TRACKS + " TRACKS";
    sizeButton.setAttribute("aria-label", "Song size: " + BARS + " bars and " + TRACKS + " tracks. Change it");
}
const cells = []; // cells[track][bar] is { block, canvas }
const barHeads = []; // the numbers 1 to 8 along the top
const trackHeads = []; // trackHeads[track] is { name, mute, solo }
const lanes = []; // the grey strip behind each track's blocks

// the drum track can open up to show every drum on its own row (the arrow by DRUMS). Each drum is one white key,
// and its place in the kit is its "slot" (0 is the lowest key). Each row can be muted or soloed on its own
const DRUM_COUNT = DRUM_NOTES.length;
const drumMuted = new Array(DRUM_COUNT).fill(false);
const drumSoloed = new Array(DRUM_COUNT).fill(false);
// a drum on loop repeats its own hits (up to the last bar that has one) to the end of the song, on its own
const drumLooped = new Array(DRUM_COUNT).fill(false);
let drumsOpen = false;
const drumRows = []; // drumRows[slot] is { head, name, mute, solo, lane, cells: [{ el, canvas }] }
let foldBtn; // the arrow by DRUMS

// the lane under a track (or under a drum row) where each note's velocity, randomness and so on are edited, opened by the
// arrow at the end of its header. Each lane shows one setting at a time (the tabs on its header choose which)
const PARAM_ROW = 64; // how tall a lane is
const paramOpen = new Array(MAX_TRACKS).fill(false);
const drumParamOpen = new Array(DRUM_COUNT).fill(false);
const paramLanes = []; // paramLanes[track] is a lane
const drumParamLanes = []; // drumParamLanes[slot] is a lane
// which grid row each thing is on, worked out by layoutSong (the lanes that are open push the rows below them down)
const rowOfTrack = [];
const rowOfParam = [];
const rowOfDrum = [];
const rowOfDrumParam = [];

// how strong the lines behind the notes are (0 to 1): the ones at each beat, and the ones between bars
const LINE_BEAT = 0.1;
const LINE_BAR = 0.22;

// makes an element with a class and some text
function make(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    if (text) el.textContent = text;
    return el;
}

function makeDrumTrackVolumeDial() {
    const box = make("div", "dial drum-track-volume");
    box.dataset.default = "1";
    const label = make("label", "", "DRUM");
    const face = make("div", "dial-face");
    const input = document.createElement("input");
    input.type = "range";
    input.className = "dial-input";
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.value = String(drumTrackVolumeAt());
    input.setAttribute("aria-label", "Volume of the whole drum track");
    const output = document.createElement("output");
    output.setAttribute("aria-hidden", "true");
    box.append(label, face, input, output);
    buildDial(box);
    setUpDialDrag(box, input);
    const showVolume = () => {
        const value = Number(input.value);
        setDrumTrackVolume(value);
        updateDial(box, value);
        const text = Math.round(value * 100) + "%";
        output.textContent = text;
        input.setAttribute("aria-valuetext", text);
        box.title = "Drum track volume: " + text;
    };
    input.addEventListener("input", showVolume);
    showVolume();
    return box;
}

// where the blocks start in a track: starts[bar] is the bar of the block that covers that bar
// (a block covers its own bar and the ones after it, as many as its length says)
function clipStarts(t) {
    const starts = [];
    let start = 0;
    let end = 0;
    for (let b = 0; b < BARS; b++) {
        if (b >= end) {
            start = b;
            end = b + clipLen[t][b];
        }
        starts.push(start);
    }
    return starts;
}

// the block that covers a bar of a track
function clipAt(t, bar) {
    return clipStarts(t)[bar];
}

// how many bars a block really covers (it can't run past the end of the song)
function clipBars(t, b) {
    return Math.min(clipLen[t][b], BARS - b);
}

// A block's notes count their beats from the start of the block, so a block that's 4 bars long can hold 16 beats of music
// (a note past the end of its block is kept, but silent, until the block is made longer again)

// the notes of a block that fall inside its length
function clipNotes(t, b) {
    const end = clipBars(t, b) * BEATS;
    return song[t][b].filter((n) => n.beat < end);
}

// the notes that play in one bar of the song, with their beats counted from the start of that bar
function barNotes(t, bar) {
    const start = clipAt(t, bar);
    const from = (bar - start) * BEATS;
    return song[t][start].filter((n) => n.beat >= from && n.beat < from + BEATS).map((n) => (from === 0 ? n : { ...n, beat: n.beat - from }));
}

// how many bars a track's content takes up: up to the end of its last block that has notes in (0 if it has none)
function loopLength(t) {
    const starts = clipStarts(t);
    for (let bar = BARS - 1; bar >= 0; bar--) {
        if (clipNotes(t, starts[bar]).length > 0) return starts[bar] + clipBars(t, starts[bar]);
    }
    return 0;
}

// which bar a bar plays the music of. On a track that's looping, the bars after its content play the bars from
// the start again (bar 6 of a 4 bar loop plays bar 2). Everything else just plays its own bar
function loopSource(t, bar) {
    if (!looped[t]) return bar;
    const length = loopLength(t);
    return length > 0 && bar >= length ? bar % length : bar;
}

// the same for one drum: how many bars its hits take up (up to the end of the last block with a hit of that drum in)
function drumLoopLength(slot) {
    const starts = clipStarts(DRUM_TRACK);
    for (let bar = BARS - 1; bar >= 0; bar--) {
        if (clipNotes(DRUM_TRACK, starts[bar]).some((n) => drumSlot(n.note) === slot)) return starts[bar] + clipBars(DRUM_TRACK, starts[bar]);
    }
    return 0;
}

// which bar a drum plays the hits of in a bar: its own loop if it's looping, or else the drum track's
function drumSourceBar(slot, bar) {
    if (!drumLooped[slot]) return loopSource(DRUM_TRACK, bar);
    const length = drumLoopLength(slot);
    return length > 0 && bar >= length ? bar % length : bar;
}

// is this bar a repeat for this drum (so its hits are drawn faded)? ownBars is true if the bar has notes of its own
function drumIsRepeat(slot, bar, ownBars) {
    if (drumLooped[slot]) return drumLoopLength(slot) > 0 && bar >= drumLoopLength(slot);
    return !ownBars && isRepeat(DRUM_TRACK, bar);
}

// the notes that play in a bar of a track. The drum track also plays each looping drum from its own loop
function notesForBar(t, bar) {
    const notes = barNotes(t, loopSource(t, bar));
    if (t !== DRUM_TRACK || !drumLooped.includes(true)) return notes;
    const mixed = notes.filter((n) => !drumLooped[drumSlot(n.note)]);
    drumLooped.forEach((on, slot) => {
        if (on) mixed.push(...barNotes(t, drumSourceBar(slot, bar)).filter((n) => drumSlot(n.note) === slot));
    });
    return mixed;
}

// is this bar one of the repeats of a looping track (so it's drawn faded)?
function isRepeat(t, bar) {
    return looped[t] && bar >= loopLength(t) && loopLength(t) > 0;
}

// shows the blocks the way the lengths say: a long block stretches over its bars and the bars under it hide.
// It works out the rows too: the numbers, then each track. Under a track comes its lane if that's open, and under DRUMS
// (if the drums are opened up) a short row for each drum, each with its own lane if that's open
function layoutSong() {
    const heights = ["24px"];
    let row = 2;
    for (let t = 0; t < TRACKS; t++) {
        rowOfTrack[t] = row++;
        heights.push("48px");
        if (paramOpen[t]) {
            rowOfParam[t] = row++;
            heights.push(PARAM_ROW + "px");
        }
        if (t === DRUM_TRACK && drumsOpen) {
            for (let slot = 0; slot < DRUM_COUNT; slot++) {
                rowOfDrum[slot] = row++;
                heights.push("30px");
                if (drumParamOpen[slot]) {
                    rowOfDrumParam[slot] = row++;
                    heights.push(PARAM_ROW + "px");
                }
            }
        }
    }
    songEl.style.gridTemplateRows = heights.join(" ");

    for (let t = 0; t < TRACKS; t++) {
        trackHeads[t].head.style.gridArea = rowOfTrack[t] + " / 1";
        lanes[t].style.gridArea = rowOfTrack[t] + " / 2 / auto / -1";
        const starts = clipStarts(t);
        for (let b = 0; b < BARS; b++) {
            const { block } = cells[t][b];
            const covered = starts[b] !== b;
            block.classList.toggle("covered", covered);
            block.style.gridArea = rowOfTrack[t] + " / " + (b + 2) + " / auto / span " + clipBars(t, b);
        }
        if (paramLanes[t]) showLane(paramLanes[t], paramOpen[t], rowOfParam[t], t);
    }
    // the drum rows follow the drum track's blocks (a long block is one long box in every row)
    const drumStarts = clipStarts(DRUM_TRACK);
    drumRows.forEach((r, slot) => {
        r.head.classList.toggle("folded", !drumsOpen);
        r.lane.classList.toggle("folded", !drumsOpen);
        if (drumsOpen) {
            r.head.style.gridArea = rowOfDrum[slot] + " / 1";
            r.lane.style.gridArea = rowOfDrum[slot] + " / 2 / auto / -1";
        }
        r.cells.forEach(({ el }, b) => {
            el.classList.toggle("folded", !drumsOpen);
            el.classList.toggle("covered", drumStarts[b] !== b);
            if (drumsOpen) el.style.gridArea = rowOfDrum[slot] + " / " + (b + 2) + " / auto / span " + clipBars(DRUM_TRACK, b);
        });
        r.settings.setAttribute("aria-expanded", String(drumParamOpen[slot]));
        showLane(drumParamLanes[slot], drumsOpen && drumParamOpen[slot], rowOfDrumParam[slot], DRUM_TRACK);
    });
    // the lit up bar is worked out again from the new lengths
    barHeads.forEach((head) => head.classList.remove("now"));
    cells.forEach((row) => row.forEach((cell) => cell.block.classList.remove("now")));
    lastNowBar = -1;
    drawAll();
    placeHandle();
}

// shows or hides a lane, and puts it on its row (its boxes follow the blocks of the track, like the drum rows do)
function showLane(lane, shown, row, t) {
    lane.head.classList.toggle("folded", !shown);
    lane.laneEl.classList.toggle("folded", !shown);
    const starts = clipStarts(t);
    lane.cells.forEach(({ el }, b) => {
        el.classList.toggle("folded", !shown);
        el.classList.toggle("covered", starts[b] !== b);
        if (shown) el.style.gridArea = row + " / " + (b + 2) + " / auto / span " + clipBars(t, b);
    });
    if (shown) {
        lane.head.style.gridArea = row + " / 1";
        lane.laneEl.style.gridArea = row + " / 2 / auto / -1";
    }
}

// builds the grid: the numbers along the top, then a row for each track
let lastBlockClick = { t: -1, b: -1, time: 0 }; // the last block that was clicked, and when (to spot a double click or tap)

function buildSong() {
    // a block is never narrower than 88px (64px when there are more than 8 bars), the song scrolls sideways instead
    const blockMin = BARS <= 8 ? 88 : 64;
    songEl.style.gridTemplateColumns = "248px repeat(" + BARS + ", minmax(" + blockMin + "px, 1fr))";
    songEl.style.minWidth = "calc(248px + " + BARS + " * " + blockMin + "px + " + BARS + " * var(--gap))";
    showSizeText();
    songEl.appendChild(cornerEl);

    for (let b = 0; b < BARS; b++) {
        const head = make("div", "bar-head", String(b + 1));
        barHeads.push(head);
        songEl.appendChild(head);
    }

    for (let t = 0; t < TRACKS; t++) {
            // the left side of the row: the track name (click to select, right-click to customize) and its mute button
        const head = make("div", "track-head");
        head.style.gridArea = t + 2 + " / 1";
            head.style.setProperty("--track-color", trackColors[t]);
        const name = make("button", "track-name", trackName(t)); // the first track is always drums
        name.addEventListener("click", () => selectBlock(t, selBar));
        const mute = make("button", "mute", "M");
        mute.setAttribute("aria-pressed", "false");
        mute.setAttribute("aria-label", "Mute track " + (t + 1));
        mute.addEventListener("click", () => toggleMute(t));
        const solo = make("button", "solo", "S");
        solo.setAttribute("aria-pressed", "false");
        solo.setAttribute("aria-label", "Solo track " + (t + 1));
        solo.addEventListener("click", () => toggleSolo(t));
        const loop = make("button", "loop", "L");
        loop.setAttribute("aria-pressed", "false");
        loop.setAttribute("aria-label", "Loop track " + (t + 1) + ": repeat its blocks to the end of the song");
        loop.addEventListener("click", () => toggleLoop(t));
        const settings = make("button", "params-arrow");
        settings.setAttribute("aria-expanded", "false");
        settings.setAttribute("aria-label", "Show the lane under track " + (t + 1) + " for each note's velocity, randomness and release");
        settings.addEventListener("click", () => toggleParamLane(t, null, settings));
        // (the drum track has no lane of its own: each drum has one, on its own row, so every drum is edited on its own.
        // An empty space is left where the arrow would be, so its M, S and L line up with the other tracks')
        head.append(name, mute, solo, loop, t === DRUM_TRACK ? makeDrumTrackVolumeDial() : settings);
        head.addEventListener("contextmenu", (e) => openTrackMenu(e, t));
        songEl.appendChild(head);
        trackHeads.push({ head, name, mute, solo, loop, settings });

        if (t === DRUM_TRACK) {
            // the arrow that opens up the drums (a triangle drawn with borders, CSS turns it down when open)
            foldBtn = make("button", "fold");
            foldBtn.setAttribute("aria-expanded", "false");
            foldBtn.setAttribute("aria-label", "Show each drum on its own row");
            foldBtn.addEventListener("click", toggleDrums);
            head.prepend(foldBtn);
        }

        // the grey lane behind the blocks (the blocks are placed over it, in the same row)
        const lane = make("div", "lane");
        lane.style.gridArea = t + 2 + " / 2 / auto / -1";
        songEl.appendChild(lane);
        lanes.push(lane);

        // the blocks along the row
        cells.push([]);
        for (let b = 0; b < BARS; b++) {
            const block = make("button", "block");
            const canvas = document.createElement("canvas");
            block.appendChild(canvas);
            block.style.setProperty("--track-color", trackColors[t]);
            block.addEventListener("click", (e) => {
                const wasSelected = t === selTrack && b === selBar;
                selectBlock(t, b);
                // a second click on the same block soon after the first opens the step sequencer. (This is worked out
                // here and not with the dblclick event, because a phone doesn't send one for a double tap.) Enter on a
                // block that's already selected does it too, for the keyboard
                const now = performance.now();
                const again = lastBlockClick.t === t && lastBlockClick.b === b && now - lastBlockClick.time < 400;
                lastBlockClick = { t, b, time: now };
                if (again || (e.detail === 0 && wasSelected)) {
                    lastBlockClick = { t: -1, b: -1, time: 0 };
                    openStepPopup();
                }
            });
            songEl.appendChild(block);
            cells[t].push({ block, canvas });
        }
    }

    buildDrumRows();
    buildParamLanes();
    songEl.appendChild(handleEl);
}

// ---- the drums, one row each ----
// (these rows are built once and hidden until the arrow opens them)

// the name on a drum's row: its key and its drum, like C3 KICK
function drumLabel(slot) {
    const note = DRUM_NOTES[slot];
    return NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1) + " " + DRUM_SOUNDS[drumKit[slot]].label;
}

function buildDrumRows() {
    DRUM_NOTES.forEach((note, slot) => {
        const head = make("div", "track-head sub folded");
        const name = make("button", "track-name");
        name.addEventListener("click", () => pickDrum(note));
        const mute = make("button", "mute", "M");
        mute.addEventListener("click", () => {
            focusDrum(slot);
            drumMuted[slot] = !drumMuted[slot];
            showAudible();
        });
        const solo = make("button", "solo", "S");
        solo.addEventListener("click", () => {
            focusDrum(slot);
            drumSoloed[slot] = !drumSoloed[slot];
            showAudible();
        });
        const loop = make("button", "loop", "L");
        loop.addEventListener("click", () => {
            focusDrum(slot);
            drumLooped[slot] = !drumLooped[slot];
            showAudible();
            for (let b = 0; b < BARS; b++) drawDrumCells(b);
        });
        const settings = make("button", "params-arrow");
        settings.setAttribute("aria-expanded", "false");
        settings.addEventListener("click", () => {
            focusDrum(slot);
            toggleParamLane(DRUM_TRACK, slot, settings);
        });
        head.append(name, mute, solo, loop, settings);
        songEl.appendChild(head);

        const lane = make("div", "lane folded");
        songEl.appendChild(lane);

        // a box for each bar: the hits of this drum, click to add or take away a hit
        const row = [];
        for (let b = 0; b < BARS; b++) {
            const el = make("button", "drum-cell folded");
            el.tabIndex = -1; // (the EDIT popup is the keyboard way to change notes)
            const canvas = document.createElement("canvas");
            el.appendChild(canvas);
            el.addEventListener("click", (e) => toggleDrumHit(slot, b, e));
            songEl.appendChild(el);
            row.push({ el, canvas });
        }
        drumRows.push({ head, name, mute, solo, loop, settings, lane, cells: row });
    });
}

// opens or closes the drum rows
function toggleDrums() {
    drumsOpen = !drumsOpen;
    foldBtn.setAttribute("aria-expanded", String(drumsOpen));
    foldBtn.setAttribute("aria-label", drumsOpen ? "Hide the drum rows" : "Show each drum on its own row");
    layoutSong();
    showAudible();
}

// clicking a drum's name picks that drum: the drum track is selected, the sound picker shows it and you hear it
function pickDrum(note, preview = true) {
    if (selTrack !== DRUM_TRACK) selectBlock(DRUM_TRACK, selBar);
    selectedDrumNote = note;
    refreshDrumKeys();
    showSound();
    if (preview) previewNote(note, DRUM_TRACK);
}

// anything you do on a drum's row (a hit, a button, its lane) makes that the selected drum, so the dials are for it. (No sound
// is played, you're doing something else)
function focusDrum(slot) {
    if (selTrack !== DRUM_TRACK || selectedDrumNote !== DRUM_NOTES[slot]) pickDrum(DRUM_NOTES[slot], false);
}

// clicking a drum's box adds a hit of that drum where you clicked (the nearest sixteenth), or takes away the hit that's there
function toggleDrumHit(slot, b, e) {
    focusDrum(slot);
    const note = DRUM_NOTES[slot];
    const notes = song[DRUM_TRACK][b];
    const rect = e.currentTarget.getBoundingClientRect();
    const steps = clipBars(DRUM_TRACK, b) * Math.round(BEATS / EDIT_STEP); // the squares along the whole block
    const step = Math.min(steps - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * steps)));
    const found = notes.findIndex((n) => drumSlot(n.note) === slot && Math.round(n.beat / EDIT_STEP) === step);
    if (found >= 0) {
        notes.splice(found, 1);
    } else {
        notes.push({ beat: step * EDIT_STEP, note });
        previewNote(note, DRUM_TRACK);
    }
    drawBlock(DRUM_TRACK, b); // (this draws the drum boxes of that bar too)
}

// draws the hits of every drum in one block's boxes
function drawDrumCells(b) {
    if (!drumsOpen) return;
    const bars = clipBars(DRUM_TRACK, b);
    const dpr = (window.devicePixelRatio || 1) * uiScale; // (a bigger page is drawn sharper, not stretched)
    const own = clipNotes(DRUM_TRACK, b);
    const ownBars = own.length > 0; // (a block with notes of its own isn't a repeat)
    drumRows.forEach(({ cells: row }, slot) => {
        const { el, canvas } = row[b];
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w || !h) return;
        const hits = own.filter((n) => drumSlot(n.note) === slot);
        el.setAttribute(
            "aria-label",
            drumLabel(slot) + ", bar " + (b + 1) + ", " + (hits.length === 0 ? "no hits" : hits.length + " hits") + ". Click to add or take away a hit"
        );
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const g = canvas.getContext("2d");
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const barW = w / bars;
        for (let rep = 0; rep < bars; rep++) {
            const left = rep * barW;
            g.fillStyle = "white";
            g.globalAlpha = LINE_BEAT;
            for (let beat = 1; beat < BEATS; beat++) g.fillRect(Math.round(left + (beat / BEATS) * barW), 0, 1, h);
            g.globalAlpha = LINE_BAR;
            if (rep > 0) g.fillRect(Math.round(left), 0, 2, h);
            g.globalAlpha = 1;
            g.fillStyle = "#f2a900";
            // on a looping drum (or a looping drum track) the bars after the content show the hits they repeat, faded.
            // Otherwise it's this bar's part of the block
            const repeat = drumIsRepeat(slot, b + rep, ownBars);
            const shown = repeat
                ? barNotes(DRUM_TRACK, drumSourceBar(slot, b + rep)).filter((n) => drumSlot(n.note) === slot)
                : hits.filter((n) => n.beat >= rep * BEATS && n.beat < (rep + 1) * BEATS).map((n) => ({ ...n, beat: n.beat - rep * BEATS }));
            g.globalAlpha = repeat ? 0.4 : 1;
            shown.forEach((n) => g.fillRect(left + (n.beat / BEATS) * barW, 3, Math.max(4, barW / 16 - 1), h - 6));
            g.globalAlpha = 1;
        }
    });
}

// the names on the rows follow the kit (change a drum in the sound picker and its row is renamed), and the row
// of the drum you're editing is white
function refreshDrumRows() {
    drumRows.forEach(({ name }, slot) => {
        name.textContent = drumLabel(slot);
        name.title = DRUM_SOUNDS[drumKit[slot]].name;
        name.setAttribute("aria-label", DRUM_SOUNDS[drumKit[slot]].name + ", key " + drumLabel(slot).split(" ")[0]);
        name.classList.toggle("selected", selTrack === DRUM_TRACK && DRUM_NOTES[slot] === selectedDrumNote);
    });
}

// draws the notes of one block as little marks: left to right is time, bottom to top is pitch
function drawBlock(t, b, fromLoop = false) {
    if (t === DRUM_TRACK) drawDrumCells(b);
    drawParamCells(t, b);
    // on a looping track the repeats show what's in the blocks before them, so when one changes they all draw again
    if (!fromLoop && looped[t]) for (let other = 0; other < BARS; other++) if (other !== b) drawBlock(t, other, true);
    const { block, canvas } = cells[t][b];
    const notes = clipNotes(t, b); // (what's in the block, a block that's several bars long has all its bars' notes)
    const bars = clipBars(t, b);
    const repeat = isRepeat(t, b) && notes.length === 0; // a faded repeat of the bars before it

    block.classList.toggle("has-notes", notes.length > 0);
    block.classList.toggle("repeat", repeat);
    block.setAttribute(
        "aria-label",
        "Track " + (t + 1) + ", bar " + (b + 1) + (bars > 1 ? ", " + bars + " bars" : "") + ", " +
            (notes.length === 0 ? (repeat ? "looping bar " + (loopSource(t, b) + 1) : "empty") : notes.length + " notes")
    );
    block.setAttribute("aria-pressed", String(t === selTrack && b === selBar));

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = (window.devicePixelRatio || 1) * uiScale; // (a bigger page is drawn sharper, not stretched)
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    g.fillStyle = getComputedStyle(block).color; // white, or dark when the block is selected

    // a long block shows each of its bars, one after the other
    const barW = w / bars;
    for (let rep = 0; rep < bars; rep++) {
        const left = rep * barW;

        // faint lines at beats 2, 3 and 4, so you can see where in the bar a note is (and a stronger one between bars)
        g.globalAlpha = LINE_BEAT;
        for (let beat = 1; beat < BEATS; beat++) g.fillRect(Math.round(left + (beat / BEATS) * barW), 0, 1, h);
        if (rep > 0) {
            g.globalAlpha = LINE_BAR;
            g.fillRect(Math.round(left), 0, 2, h);
        }
        g.globalAlpha = 1;

        // one mark per note (the piano runs from MIDI note 48 to 84). On a looping track a bar after the
        // content shows the notes of the bar it repeats. Otherwise it's this bar's part of the block
        const shown =
            notes.length === 0 && isRepeat(t, b + rep)
                ? barNotes(t, loopSource(t, b + rep))
                : notes.filter((n) => n.beat >= rep * BEATS && n.beat < (rep + 1) * BEATS).map((n) => ({ ...n, beat: n.beat - rep * BEATS }));
        shown.forEach((n) => {
            const x = left + (n.beat / BEATS) * barW;
            const pitch = Math.min(1, Math.max(0, (n.note - 48) / 36)); // a MIDI note outside the piano is drawn at the top or bottom edge
            const y = h - 6 - pitch * (h - 12);
            g.fillRect(x, y - 2, Math.max(4, barW / 16), 4);
        });
    }

    // step recording: a line where the next note will go
    if (stepCursor !== null && t === selTrack && b === selBar) {
        g.fillStyle = "#f2a900";
        g.fillRect(Math.round((stepCursor / (bars * BEATS)) * w), 0, 3, h);
    }
}

function drawAll() {
    for (let t = 0; t < TRACKS; t++) for (let b = 0; b < BARS; b++) drawBlock(t, b);
}

// selects a block (the white one), and the track it's in (the orange name). Pick a bar that a long block
// covers and you get the whole block
function selectBlock(t, b) {
    b = clipAt(t, b);
    closePanel("steps"); // the step sequencer popup was for the old block
    const oldTrack = selTrack;
    const oldBar = selBar;
    selTrack = t;
    selBar = b;

    if (stepCursor !== null) stepCursor = 0; // (a step recording starts at the start of whichever block is selected)
    cells[oldTrack][oldBar].block.classList.remove("selected");
    cells[t][b].block.classList.add("selected");
    trackHeads.forEach((head, i) => head.name.classList.toggle("selected", i === t));

    drawBlock(oldTrack, oldBar); // draw both again, the marks change colour when selected
    drawBlock(t, b);

    showSound(); // the sound picker shows this track's sound
    placeHandle();
}

function placeHandle() {
    const block = cells[selTrack][selBar].block;
    if (block.offsetWidth === 0) return;
    // the grip is on the block's right edge, the same height as the block
    handleEl.style.left = block.offsetLeft + block.offsetWidth - handleEl.offsetWidth + "px";
    handleEl.style.top = block.offsetTop + "px";
    handleEl.style.height = block.offsetHeight + "px";
}

// changes how many bars the selected block covers (1 up to the end of the song)
function setLength(len) {
    clipLen[selTrack][selBar] = Math.max(1, Math.min(len, BARS - selBar));
    layoutSong();
}

// dragging the grip: the block grows or shrinks a whole bar at a time, to the bar the pointer is over
let resizing = false;

handleEl.addEventListener("pointerdown", (e) => {
    e.preventDefault(); // (so dragging doesn't select text)
    e.stopPropagation();
    resizing = true;
    try {
        handleEl.setPointerCapture(e.pointerId); // keeps the drag going when the pointer leaves the grip
    } catch {}
});

handleEl.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    const stride = barHeads[1].offsetLeft - barHeads[0].offsetLeft; // from one bar to the next
    const gap = stride - barHeads[0].offsetWidth;
    const x = (e.clientX - songEl.getBoundingClientRect().left) / uiScale; // (the song may be scrolled, its left moves with it. And the page may be scaled up)
    const bars = Math.round((x - barHeads[selBar].offsetLeft + gap) / stride); // how many bars reach to the pointer
    const len = Math.max(1, Math.min(bars, BARS - selBar));
    if (len !== clipBars(selTrack, selBar)) setLength(len);
});

const stopResizing = () => (resizing = false);
handleEl.addEventListener("pointerup", stopResizing);
handleEl.addEventListener("pointercancel", stopResizing);
handleEl.addEventListener("lostpointercapture", stopResizing);

// the sound picker: on a synth track it shows and changes the track's sound. On the drum track (track 1)
// it shows and changes the drum on the key you last played

// fills the dropdown from a list of { name, group } (items with a group go under a heading in the list)
function fillSoundOptions(items) {
    soundSelect.innerHTML = "";
    let heading = null;
    let headingName = null;
    items.forEach((item, i) => {
        const option = document.createElement("option");
        option.value = String(i);
        option.textContent = item.name;
        if (item.group) {
            if (item.group !== headingName) {
                heading = document.createElement("optgroup");
                heading.label = item.group;
                soundSelect.appendChild(heading);
                headingName = item.group;
            }
            heading.appendChild(option);
        } else {
            soundSelect.appendChild(option);
        }
    });
    if (typeof addPresetOptions === "function") addPresetOptions(); // the saved presets, at the end (presets.js)
}

let listShown = null; // what the dropdown's list is made of right now: "drums" or "synth"

// makes the selected track the live one: the keyboard turns into drums (or back), the picker shows
// its sound, CUT, RES and REL show its settings, the graphs draw it, and the piano keys play it
function showSound() {
    liveTrack = selTrack;
    setDrumMode(selTrack === DRUM_TRACK);

    const wanted = drumMode ? "drums" : "synth";
    if (wanted !== listShown) {
        fillSoundOptions(drumMode ? DRUM_SOUNDS : SOUNDS);
        listShown = wanted;
    }

    if (drumMode) {
        soundSelect.value = String(drumSoundAt(selectedDrumNote));
        soundSelect.setAttribute("aria-label", "Drum for the selected key");
    } else {
        soundSelect.value = String(trackSettings[selTrack].sound);
        // (if the track is exactly a preset, the picker says so)
        const preset = typeof matchingPreset === "function" ? matchingPreset(selTrack) : null;
        if (preset !== null) soundSelect.value = preset;
        soundSelect.setAttribute("aria-label", "Sound for track " + (selTrack + 1));
    }
    showTrackSettings();
    refreshDrumRows();
    if (typeof showLabButtons === "function") showLabButtons(); // (the dice by the star, soundlab.js)
}

// gives the selected track a new sound (or the selected drum key a new drum), and plays it so you can hear it
async function setSound(index) {
    getCtx();
    if (ctx.state === "suspended") await ctx.resume(); // browsers start audio suspended

    if (drumMode) {
        setDrumSound(selectedDrumNote, index);
        showSound();
        playDrumNote(selectedDrumNote); // (it's the new drum now)
        return;
    }

    const wasSampler = isSampler(selTrack);
    trackSettings[selTrack].sound = (index + SOUNDS.length) % SOUNDS.length; // goes round at the ends of the list
    if (isSampler(selTrack) && !wasSampler) {
        // (a sample plays as it is: no rise and no fall to a sustain, and a short fade out. The dials are still the track's to change)
        Object.assign(trackSettings[selTrack], { attack: 0, decay: 0.5, sustain: 1, release: 0.2 });
    }
    showSound();
    if (isSampler(selTrack)) {
        selectDialTab("sample"); // (the sampler's own tabs)
        return; // (there is nothing to hear until a sound is loaded)
    }
    playNote(noteToFrequency(60), ctx.currentTime, selTrack); // middle C
}

// the arrows: on a synth track they go through all the sounds, on the drum track they stay on the same
// part (so on a snare they go through the snares)
function stepSound(delta) {
    if (drumMode) setSound(nextVariant(drumSoundAt(selectedDrumNote), delta));
    else setSound(trackSettings[selTrack].sound + delta);
}

soundSelect.addEventListener("change", () => {
    if (/^[pf]:/.test(soundSelect.value)) applyPresetValue(soundSelect.value); // a preset, built in (f:) or yours (p:) (presets.js)
    else setSound(Number(soundSelect.value));
    soundSelect.blur(); // (so the letter keys play the piano again, and don't jump to another sound in the list)
});
soundUp.addEventListener("click", () => stepSound(-1)); // up the list
soundDown.addEventListener("click", () => stepSound(1)); // down the list
document.addEventListener("drumselected", showSound); // playing a different drum key shows that key's drum

// is this track heard? With any track on solo, only the soloed ones are. Otherwise every track that isn't muted
function audible(t) {
    return soloed.includes(true) ? soloed[t] : !muted[t];
}

// shows which tracks are heard: the lanes and blocks of the ones that aren't go dim
function showAudible() {
    for (let t = 0; t < TRACKS; t++) {
        trackHeads[t].mute.setAttribute("aria-pressed", String(muted[t]));
        trackHeads[t].solo.setAttribute("aria-pressed", String(soloed[t]));
        trackHeads[t].loop.setAttribute("aria-pressed", String(looped[t]));
        lanes[t].classList.toggle("muted", !audible(t));
        cells[t].forEach((cell) => cell.block.classList.toggle("muted", !audible(t)));
    }
    // each drum row, too (it's dim if its drum isn't heard, or the whole drum track isn't)
    drumRows.forEach((r, slot) => {
        const heard = audible(DRUM_TRACK) && drumAudible(slot);
        r.mute.setAttribute("aria-pressed", String(drumMuted[slot]));
        r.solo.setAttribute("aria-pressed", String(drumSoloed[slot]));
        r.loop.setAttribute("aria-pressed", String(drumLooped[slot]));
        r.loop.setAttribute("aria-label", "Loop " + DRUM_SOUNDS[drumKit[slot]].name + ": repeat its hits to the end of the song");
        r.settings.setAttribute("aria-label", "Show the lane under " + DRUM_SOUNDS[drumKit[slot]].name + " for each note's velocity, randomness and release");
        r.mute.setAttribute("aria-label", "Mute " + DRUM_SOUNDS[drumKit[slot]].name);
        r.solo.setAttribute("aria-label", "Solo " + DRUM_SOUNDS[drumKit[slot]].name);
        r.lane.classList.toggle("muted", !heard);
        r.cells.forEach(({ el }) => el.classList.toggle("muted", !heard));
    });
}

// is this drum heard? With any drum on solo, only the soloed drums are. Otherwise every drum that isn't muted
function drumAudible(slot) {
    return drumSoloed.includes(true) ? drumSoloed[slot] : !drumMuted[slot];
}

function toggleMute(t) {
    muted[t] = !muted[t];
    showAudible();
}

// turns a track's loop on or off, and draws its blocks again (the repeats appear or go)
function toggleLoop(t) {
    looped[t] = !looped[t];
    showAudible();
    for (let b = 0; b < BARS; b++) drawBlock(t, b, true);
}

function toggleSolo(t) {
    soloed[t] = !soloed[t];
    showAudible();
}

// editing the selected block (the buttons are for touch screens, a computer uses Ctrl+C, Ctrl+V and Delete: keys.js)
function copyBlock() {
    clipboard = { notes: song[selTrack][selBar].map((n) => ({ ...n })), len: clipBars(selTrack, selBar) };
    updateButtons();
}

function pasteBlock() {
    if (!clipboard) return;
    song[selTrack][selBar] = clipboard.notes.map((n) => ({ ...n }));
    clipLen[selTrack][selBar] = Math.min(clipboard.len, BARS - selBar);
    layoutSong();
}

function clearBlock() {
    song[selTrack][selBar] = [];
    drawBlock(selTrack, selBar);
}

copyBtn.addEventListener("click", copyBlock);
pasteBtn.addEventListener("click", pasteBlock);
clearBtn.addEventListener("click", clearBlock);

// ---- the metronome ----
// The METRO button opens its settings. CLICK is when it ticks: never, only in the count-in before a recording, or
// always (while playing and recording). COUNT-IN is how many bars of ticks come before a recording starts.
const CLICK_WHEN = ["OFF", "COUNT-IN", "ALWAYS"];
const COUNT_INS = ["OFF", "1 BAR", "2 BARS"]; // the place in this list is how many bars
// the sounds the ticks can have: hi is the pitch of the first beat of a bar, lo is the others
const CLICK_SOUNDS = [
    { name: "CLICK", type: "sine", hi: 1500, lo: 1000, decay: 0.05 },
    { name: "WOOD", type: "triangle", hi: 900, lo: 600, decay: 0.03 },
    { name: "BEEP", type: "square", hi: 880, lo: 660, decay: 0.08, quieter: 0.4 },
];
const CLICK_LEVELS = [
    { name: "LOW", gain: 0.08 },
    { name: "MED", gain: 0.2 },
    { name: "HIGH", gain: 0.4 },
];
// the settings: each is a place in the list above. They're remembered
const metro = { when: 1, countIn: 1, sound: 0, level: 1 };
const metroLists = { when: CLICK_WHEN, countIn: COUNT_INS, sound: CLICK_SOUNDS, level: CLICK_LEVELS };
try {
    const saved = JSON.parse(localStorage.getItem("metronome"));
    for (const key in metro) {
        if (saved && Number.isInteger(saved[key]) && saved[key] >= 0 && saved[key] < metroLists[key].length) metro[key] = saved[key];
    }
} catch {}

// one tick of the metronome (accent is the first beat of a bar, which is higher)
function playClick(time, accent) {
    const sound = CLICK_SOUNDS[metro.sound];
    const osc = ctx.createOscillator();
    osc.type = sound.type;
    osc.frequency.value = accent ? sound.hi : sound.lo;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(CLICK_LEVELS[metro.level].gain * (sound.quieter || 1), time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + sound.decay);
    osc.connect(gain);
    gain.connect(master);
    osc.start(time);
    osc.stop(time + sound.decay + 0.01);
}

// plays every note that starts during one beat of one bar (skipTrack is left out, -1 leaves none out)
function playBeatOf(bar, beatInBar, time, skipTrack) {
    for (let t = 0; t < TRACKS; t++) {
        if (t === skipTrack || !audible(t)) continue;
        // (a long block plays its one bar of notes over and over, and a track on loop goes back to its start)
        const notes = notesForBar(t, bar);
        notes.forEach((n) => {
            if (Math.floor(n.beat) !== beatInBar) return;
            if (t === DRUM_TRACK && !drumAudible(drumSlot(n.note))) return; // a drum that's muted (or not on solo)
            // each note is played the way its own settings say: how hard, how early or late, or not at all
            const feel = humanize(n);
            if (!feel) return;
            const when = Math.max(ctx.currentTime, time + (n.beat - beatInBar + swingDelay(n.beat)) * beatSec + feel.shift);
            // (a note in the song only knows where it starts, so each one is held for a beat and then let go. A drum that rolls rolls
            // until the next hit of that drum, if that is sooner)
            let gate = beatSec;
            if (t === DRUM_TRACK) {
                const next = notes.reduce((soonest, m) => (m.note === n.note && m.beat > n.beat ? Math.min(soonest, m.beat) : soonest), Infinity);
                gate = Math.min(beatSec, (next - n.beat) * beatSec);
            }
            playNote(noteToFrequency(n.note), when, t, false, gate, feel.velocity, feel.release);
        });
    }
}

// plans one beat. Beats are counted from 0 when you press play or rec.
// Play: the 8 bars go round and round. Rec: the count-in, then the selected block from its start to its end (a block
// that's 4 bars long is recorded straight through all 4 bars)
function scheduleBeat(n, time) {
    if (!recordArmed) {
        playBeatOf(Math.floor(n / BEATS) % BARS, n % BEATS, time, -1);
        if (metro.when === 2) playClick(time, n % BEATS === 0); // (the click is on all the time)
    } else if (n < countBeats) {
        if (metro.when >= 1) playClick(time, n % BEATS === 0); // the count-in
    } else {
        if (n === countBeats && !recOverdub) {
            song[recTrack][recBar] = []; // recording replaces what was in the block
            drawBlock(recTrack, recBar);
        }
        // (with loop record the beats keep counting, and this goes back to the start of the block each time round)
        const into = (n - countBeats) % recBeats;
        if (metro.when === 2) playClick(time, into % BEATS === 0);
        // the other tracks play along, bar after bar as far as the block goes. The one being recorded is quiet the first time
        // round (unless it's an overdub), then you hear what you've put in
        const hearTrack = recOverdub || n - countBeats >= recBeats;
        playBeatOf(recBar + Math.floor(into / BEATS), into % BEATS, time, hearTrack ? -1 : recTrack);
    }
}

// runs every 25ms: plans every beat that starts in the next fraction of a second.
// It plans ahead on the audio clock (not setTimeout) so the timing stays steady
function tick() {
    const horizon = ctx.currentTime + LOOKAHEAD;
    while (startTime + nextBeat * beatSec < horizon) {
        if (recordArmed && !recLoop && nextBeat >= countBeats + recBeats) break; // a recording is the count-in and the block, nothing more to plan (unless it loops)
        scheduleBeat(nextBeat, startTime + nextBeat * beatSec);
        nextBeat++;
    }
    if (recordArmed && !recLoop && ctx.currentTime >= startTime + (countBeats + recBeats) * beatSec) stopTransport();
}

async function startTransport(record) {
    getCtx();
    if (ctx.state === "suspended") await ctx.resume(); // browsers start audio suspended
    stopTransport();
    stopStepRecording();

    beatSec = 60 / bpm;
    recordArmed = record;
    recLoop = record && recordOptions.loop === 1;
    recOverdub = record && recordOptions.mode === 1;
    recTrack = selTrack;
    recBar = selBar;
    countBeats = record ? metro.countIn * BEATS : 0; // the count-in setting from the metronome
    recBeats = clipBars(recTrack, recBar) * BEATS; // a block that's 4 bars long records 4 bars
    startTime = ctx.currentTime + 0.1; // a moment from now, so the first beat isn't late
    nextBeat = 0;
    running = true;

    tickTimer = setInterval(tick, TICK_MS);
    tick();
    requestAnimationFrame(uiLoop);
}

function stopTransport() {
    clearInterval(tickTimer);
    running = false;
    recordArmed = false;
    updateButtons();
    showNow(-1);
    if (typeof checkpoint === "function") checkpoint(); // (a take is one step to undo. keys.js)
}

// notes you play on the piano while recording go into the recorded block
document.addEventListener("noteplayed", (e) => {
    if (stepCursor !== null) return stepRecordNote(e.detail);
    if (!running || !recordArmed) return;
    let beat = (e.detail.time - startTime) / beatSec - countBeats; // 0 is the start of the recorded block
    if (beat < 0) return; // during the count-in
    if (recLoop) beat %= recBeats; // (the block goes round and round)
    else if (beat >= recBeats) return; // after the block
    const step = quantizeStep();
    let snapped = step ? Math.round(beat / step) * step : beat;
    if (snapped >= recBeats) snapped = recLoop ? 0 : recBeats - (step || 0.25); // keep it inside the block (a loop wraps to the start)
    // the same note in the same place isn't put in twice (going round again, or an overdub)
    if (song[recTrack][recBar].some((n) => n.note === e.detail.note && Math.abs(n.beat - snapped) < 0.001)) return;
    song[recTrack][recBar].push(newNote(snapped, e.detail));
    drawBlock(recTrack, recBar);
});

// a note that's been played: a note played softly on a MIDI keyboard keeps how hard it was hit (velocity), a note from the
// screen is full
function newNote(beat, played) {
    const note = { beat, note: played.note };
    if (typeof played.velocity === "number" && played.velocity < 0.995) note.velocity = Math.round(played.velocity * 100) / 100;
    return note;
}

// ---- step recording ----
// With STEP RECORD on (the recording options), REC doesn't start the clock. It puts a cursor at the start of the selected
// block, each note you play goes in at the cursor, and the cursor moves on one step (the size of the quantize setting). The
// notes of a chord go in the same place. Space moves on without a note, Backspace goes back a step and takes out what was there.
// REC again, or the end of the block, stops it.
function startStepRecording() {
    if (running) stopTransport();
    stepCursor = 0;
    updateButtons();
    drawBlock(selTrack, selBar);
}

function stopStepRecording() {
    if (stepCursor === null) return;
    clearTimeout(stepTimer);
    stepTimer = null;
    stepCursor = null;
    updateButtons();
    drawBlock(selTrack, selBar);
}

function stepSize() {
    return quantizeStep() || 0.25;
}

function stepRecordNote(played) {
    const list = song[selTrack][selBar];
    const length = clipBars(selTrack, selBar) * BEATS;
    if (stepCursor >= length) return;
    const at = list.findIndex((n) => n.note === played.note && Math.abs(n.beat - stepCursor) < 0.001);
    if (at >= 0) list.splice(at, 1);
    list.push(newNote(stepCursor, played));
    clearTimeout(stepTimer);
    stepTimer = setTimeout(stepForward, STEP_CHORD_MS); // (a moment after the last note of a chord)
    drawBlock(selTrack, selBar);
}

// the cursor moves on a step (and when it gets to the end of the block, step recording is over)
function stepForward() {
    clearTimeout(stepTimer);
    stepTimer = null;
    if (stepCursor === null) return;
    stepCursor += stepSize();
    if (stepCursor >= clipBars(selTrack, selBar) * BEATS - 0.001) stopStepRecording();
    else drawBlock(selTrack, selBar);
}

// a rest: if a note is waiting to move the cursor on, that happens first, then one more step
function stepRest() {
    if (stepCursor === null) return;
    if (stepTimer !== null) stepForward();
    stepForward();
}

// back a step, taking out the notes that were there
function stepBack() {
    if (stepCursor === null) return;
    if (stepTimer !== null) stepForward();
    if (stepCursor === null) return; // (that was the end of the block)
    stepCursor = Math.max(0, stepCursor - stepSize());
    song[selTrack][selBar] = song[selTrack][selBar].filter((n) => Math.abs(n.beat - stepCursor) >= 0.001);
    drawBlock(selTrack, selBar);
}

// lights up the bar that's playing: its number and its five blocks
function showNow(bar) {
    if (bar === lastNowBar) return;
    if (lastNowBar >= 0) {
        barHeads[lastNowBar].classList.remove("now");
        for (let t = 0; t < TRACKS; t++) cells[t][clipAt(t, lastNowBar)].block.classList.remove("now");
    }
    if (bar >= 0) {
        barHeads[bar].classList.add("now");
        for (let t = 0; t < TRACKS; t++) cells[t][clipAt(t, bar)].block.classList.add("now");
    }
    lastNowBar = bar;
}

// the play and rec buttons: STOP while it's running, and REC shows the count-in (1 2 3 4)
function updateButtons() {
    const beat = running ? (ctx.currentTime - startTime) / beatSec : -1;
    const counting = running && recordArmed && countBeats > 0 && beat < countBeats;
    const recording = running && recordArmed && beat >= countBeats;

    playBtn.classList.toggle("on", running && !recordArmed);
    recBtn.classList.toggle("on", recording || stepCursor !== null);
    recBtn.classList.toggle("counting", counting);
    // (REC is a red disc, and it says STEP while step recording and counts the beats in while it counts in)
    const recWords = stepCursor !== null ? "STEP" : counting ? String(Math.floor((Math.max(0, beat)) % BEATS) + 1) : "";
    recText.textContent = recWords;
    recBtn.classList.toggle("has-text", recWords !== "");
    pasteBtn.disabled = !clipboard;
}

// keeps the buttons and the lit up bar current while it's running (it only changes a class when
// something changes, so it's not an animation)
function uiLoop() {
    if (!running) return;
    updateButtons();

    const beat = (ctx.currentTime - startTime) / beatSec;
    let bar = -1;
    if (recordArmed) {
        // (the bar of the block that's being recorded: a block that's several bars long lights them one after the other,
        // and a loop goes back to the first)
        if (beat >= countBeats) bar = recBar + Math.min(recBeats / BEATS - 1, Math.floor(((beat - countBeats) % recBeats) / BEATS));
    } else if (beat >= 0) {
        bar = Math.floor(beat / BEATS) % BARS;
    }
    showNow(bar);

    requestAnimationFrame(uiLoop);
}

// PLAY plays (it does nothing while the song is going), STOP stops. STOP pressed twice quickly stops everything for good: the song, held
// keys, rolls, notes that are fading out and echoes (stopAllSounds, synth.js)
function stopPlaying() {
    if (stepCursor !== null) stopStepRecording();
    if (running) stopTransport();
}

playBtn.addEventListener("click", () => {
    if (!running) startTransport(false);
});

let lastStopClick = 0;
stopBtn.addEventListener("click", () => {
    const now = performance.now();
    if (now - lastStopClick < 400) {
        lastStopClick = 0;
        stopPlaying();
        stopAllSounds();
        // (a short flash, so you can see it did it)
        stopBtn.classList.add("on");
        setTimeout(() => stopBtn.classList.remove("on"), 350);
    } else {
        lastStopClick = now;
        stopPlaying();
    }
});

recBtn.addEventListener("click", () => {
    if (stepCursor !== null) stopStepRecording();
    else if (running && recordArmed) stopTransport();
    else if (recordOptions.step === 1) startStepRecording();
    else startTransport(true);
});

// ---- the tempo (the BPM button) ----
// The button says the tempo and opens a popup to change it: type it, nudge it, tap it on the beat, or pick a common one.
// It's remembered, and it changes the next time you press play or rec.
const bpmButton = document.getElementById("bpmButton");
const bpmText = document.getElementById("bpmText");
const bpmPopover = document.getElementById("bpmPopover");
const bpmInput = document.getElementById("bpmInput");
const BPM_MIN = 40;
const BPM_MAX = 240;
const BPM_PRESETS = [70, 80, 90, 100, 110, 120, 128, 140];

function setBpm(v, save = true) {
    bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(v)));
    bpmText.textContent = bpm + " BPM";
    if (document.activeElement !== bpmInput) bpmInput.value = String(bpm); // (not while you're typing in it)
    showBpmPresets();
    updateDelayTimes(); // (the echo is in time with the song)
    if (typeof samplerTempoChanged === "function") samplerTempoChanged(); // (a sample matched to the tempo is worked out again)
    if (save) {
        try {
            localStorage.setItem("bpm", String(bpm));
        } catch {}
    }
}

// marks the preset that matches the tempo
function showBpmPresets() {
    fillChoices([document.getElementById("bpmPresets")], BPM_PRESETS.map(String), BPM_PRESETS.indexOf(bpm), (i) => setBpm(BPM_PRESETS[i]));
}

registerPanel("bpm", bpmButton, bpmPopover, null, () => {
    bpmInput.value = String(bpm);
    showBpmPresets();
}, { popupOnly: true }); // a popup on a phone too

document.getElementById("bpmDown").addEventListener("click", () => setBpm(bpm - 1));
document.getElementById("bpmUp").addEventListener("click", () => setBpm(bpm + 1));

// typing: it follows what you type as long as it's a tempo that makes sense, and tidies up when you're done
bpmInput.addEventListener("input", () => {
    const typed = Number(bpmInput.value);
    if (bpmInput.value !== "" && typed >= BPM_MIN && typed <= BPM_MAX) setBpm(typed);
});
bpmInput.addEventListener("change", () => {
    setBpm(Number(bpmInput.value) || bpm);
    bpmInput.value = String(bpm);
});
bpmInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") bpmInput.blur();
});

// tapping: the tempo is worked out from how far apart your taps are (the last few, and it starts again if you stop for 2 seconds)
const taps = [];
function tapTempo() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length >= 2) setBpm((60000 * (taps.length - 1)) / (taps[taps.length - 1] - taps[0]));
}
const bpmTap = document.getElementById("bpmTap");
bpmTap.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    tapTempo(); // (as soon as it's pressed, not when it's let go, so the beat isn't late)
});
bpmTap.addEventListener("click", (e) => {
    if (e.detail === 0) tapTempo(); // (a key press on the button)
});

// the tempo it was left at
try {
    const savedBpm = Number(localStorage.getItem("bpm"));
    if (savedBpm >= BPM_MIN && savedBpm <= BPM_MAX) setBpm(savedBpm, false);
    else setBpm(bpm, false);
} catch {
    setBpm(bpm, false);
}

// ---- the step sequencer ----
// Double-clicking a block opens a popup with a step sequencer for it, pointing at the block: a square for each
// sixteenth note of the bar, and a row for each note you'd need. On the drum track that's every drum, on the other
// tracks it's the notes in the key of the LEDs (plus any other note already in the block).
// Click a square to put a note there, click it again to take it away, or hold the mouse down and drag across
// squares to paint a lot at once. It plays each note you add. What you change is the block's notes (the same ones
// you record), and the song uses them straight away.

const EDIT_STEP = 0.25; // each square is a sixteenth note (a quarter of a beat)
const EDIT_STEPS = Math.round(BEATS / EDIT_STEP); // 16 squares across

// is this note in the key the LEDs are set to?
function inKey(note) {
    return SCALES[ledScale].steps.includes((((note - ledRoot) % 12) + 12) % 12);
}

// the notes that get a row, highest first
function sequencerNotes() {
    const notes = [];
    if (selTrack === DRUM_TRACK) {
        for (let i = DRUM_NOTES.length - 1; i >= 0; i--) notes.push(DRUM_NOTES[i]); // every drum
        return notes;
    }
    const used = song[selTrack][selBar].map((n) => n.note);
    for (let n = LAST_NOTE; n >= FIRST_NOTE; n--) {
        if (inKey(n) || used.includes(n)) notes.push(n);
    }
    return notes;
}

let stepBar = 0; // which bar of the block the squares are for (a block that's several bars long has a tab for each)

// is there a note in this square? (on the drum track a note from a black key counts for the white key below it)
function noteAt(step, note) {
    return song[selTrack][selBar].findIndex(
        (n) =>
            Math.round(n.beat / EDIT_STEP) === stepBar * EDIT_STEPS + step &&
            (selTrack === DRUM_TRACK ? drumSlot(n.note) === drumSlot(note) : n.note === note)
    );
}

async function previewNote(note, track = selTrack) {
    getCtx();
    if (ctx.state === "suspended") await ctx.resume();
    playNote(noteToFrequency(note), ctx.currentTime, track);
}

// puts a note in a square (on = true) or takes it away (on = false), and hears it when it's put in
function setSquare(cell, on) {
    const step = Number(cell.dataset.step);
    const note = Number(cell.dataset.note);
    const found = noteAt(step, note);
    if (on && found < 0) {
        song[selTrack][selBar].push({ beat: (stepBar * EDIT_STEPS + step) * EDIT_STEP, note });
        previewNote(note);
    } else if (!on && found >= 0) {
        song[selTrack][selBar].splice(found, 1);
    } else {
        return;
    }
    cell.classList.toggle("on", on);
    cell.setAttribute("aria-pressed", String(on));
    drawBlock(selTrack, selBar);
}

// dragging across squares paints them all the way the first one went (mouse and pen. On a touch screen a drag
// scrolls the grid instead, so a tap is one square)
let painting = null; // null, or the way dragging sets squares: true is on, false is off
let lastPointer = "mouse";

function setUpGrid(grid) {
    grid.addEventListener("pointerdown", (e) => {
        lastPointer = e.pointerType;
        const cell = e.target.closest(".step");
        if (!cell || e.pointerType === "touch") return;
        e.preventDefault(); // (so dragging doesn't select text)
        painting = !cell.classList.contains("on");
        setSquare(cell, painting);
    });

    grid.addEventListener("pointerover", (e) => {
        if (painting === null) return;
        const cell = e.target.closest(".step");
        if (cell) setSquare(cell, painting);
    });

    // a tap on a touch screen, or a key press on a square (the mouse is handled above, a mouse click has detail 1 or more)
    grid.addEventListener("click", (e) => {
        const cell = e.target.closest(".step");
        if (!cell || (e.detail !== 0 && lastPointer !== "touch")) return;
        setSquare(cell, !cell.classList.contains("on"));
    });
}

document.addEventListener("pointerup", () => (painting = null));
document.addEventListener("pointercancel", () => (painting = null));

// fills a grid with the squares for the selected block: the numbers along the top (1 2 3 4 for the four beats),
// then a row of squares for each note
function fillGrid(grid) {
    const drums = selTrack === DRUM_TRACK;
    grid.innerHTML = "";
    grid.className = "editor-grid steps" + (drums ? " drums" : "");

    grid.appendChild(make("div", "step-corner"));
    for (let step = 0; step < EDIT_STEPS; step++) {
        grid.appendChild(make("div", "step-head", step % 4 === 0 ? String(step / 4 + 1) : ""));
    }

    sequencerNotes().forEach((note) => {
        const sharp = !drums && NOTE_NAMES[note % 12].includes("#");
        const name = drums ? drumLabel(drumSlot(note)) : NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1);
        const label = make("div", "step-label", name);
        label.dataset.note = String(note);
        grid.appendChild(label);

        for (let step = 0; step < EDIT_STEPS; step++) {
            const cell = make("button", "step" + (sharp ? " sharp" : "") + (Math.floor(step / 4) % 2 === 1 ? " alt" : ""));
            cell.dataset.step = String(step);
            cell.dataset.note = String(note);
            const on = noteAt(step, note) >= 0;
            cell.classList.toggle("on", on);
            cell.setAttribute("aria-pressed", String(on));
            cell.setAttribute("aria-label", name + ", beat " + (1 + step * EDIT_STEP));
            grid.appendChild(cell);
        }
    });
}

// scrolls a grid's box to the notes in the block (or to the middle of the keyboard if it's empty)
function scrollToNotes(grid, box) {
    const marked = grid.querySelector(".step.on");
    const middle =
        marked ||
        grid.querySelector(selTrack === DRUM_TRACK ? ".step-label[data-note]" : '.step-label[data-note="60"]') ||
        grid.querySelector(".step-label[data-note]");
    if (middle) box.scrollTop = Math.max(0, middle.offsetTop - box.clientHeight / 2);
}

const stepPopover = document.getElementById("stepPopover");
const stepTitle = document.getElementById("stepTitle");
const stepGrid = document.getElementById("stepGrid");
const stepBars = document.getElementById("stepBars");
const stepsTrigger = document.createElement("button"); // (the popup system wants a button, this one is never shown)
registerPanel("steps", stepsTrigger, stepPopover, null, buildStepPopup, {
    popupOnly: true, // it's a popup on a phone too
    anchor: () => cells[selTrack][selBar].block, // and it points at the block, not at a button
});
setUpGrid(stepGrid);

// fills the popup for the selected block (runs each time it opens)
function buildStepPopup() {
    stepBar = 0;
    showStepPopup();
}

// (and again when you pick another bar of a long block)
function showStepPopup() {
    const bars = clipBars(selTrack, selBar);
    stepTitle.textContent =
        "STEP SEQ: " + trackName(selTrack) + ", " + (bars > 1 ? "BARS " + (selBar + 1) + " TO " + (selBar + bars) : "BAR " + (selBar + 1));
    // a block that's several bars long has a tab for each bar, the squares are for the bar that's picked
    stepBars.innerHTML = "";
    stepBars.hidden = bars < 2;
    for (let i = 0; i < bars; i++) {
        const tab = make("button", "step-bar-tab", String(selBar + i + 1));
        tab.setAttribute("aria-pressed", String(i === stepBar));
        tab.setAttribute("aria-label", "Bar " + (selBar + i + 1));
        tab.addEventListener("click", () => {
            stepBar = i;
            showStepPopup();
        });
        stepBars.appendChild(tab);
    }
    fillGrid(stepGrid);
    // (it may not be showing yet, so wait until it is to scroll to the notes)
    requestAnimationFrame(() => scrollToNotes(stepGrid, stepGrid.parentElement));
}

function openStepPopup() {
    if (stepPopover.hidden) togglePanel("steps");
}

// scrolling the song moves the block out from under the popup, so that closes it (scrolling inside the popup is fine)
document.addEventListener(
    "scroll",
    (e) => {
        if (!stepPopover.hidden && !stepPopover.contains(e.target)) closePanel("steps");
    },
    true
);

// ---- the lanes for each note's velocity, randomness and so on ----
// The arrow at the end of a track's header (or a drum row's) opens a lane under it with a bar for every note. The bar's
// height is the note's setting, and you change it by dragging: press on a bar and drag up or down, or drag along the lane
// to draw the settings of a lot of notes at once. The tabs on the lane's header pick which setting you're looking at.

const PARAM_KEYS = [
    { key: "velocity", tab: "VEL", label: "VELOCITY", format: (v) => Math.round(v * 100) + "%" },
    { key: "random", tab: "RND", label: "RANDOM VELOCITY", format: (v) => Math.round(v * 100) + "%" },
    { key: "timing", tab: "TIM", label: "RANDOM TIMING", format: (v) => (v === 0 ? "0ms" : "\u00b1" + Math.round(v * TIMING_RANDOM_SECONDS * 1000) + "ms") },
    { key: "chance", tab: "CHN", label: "CHANCE", format: (v) => Math.round(v * 100) + "%" },
    { key: "release", tab: "REL", label: "RELEASE", format: (v) => "x" + releaseScale(v).toFixed(2) },
];

// makes a lane for a track (slot is null) or for one drum of the drum track
function buildParamLane(t, slot) {
    const head = make("div", "track-head sub param-head folded");
    head.style.setProperty("--track-color", trackColors[t]);
    const tabs = make("div", "param-tabs");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Which setting to show");
    const readout = make("div", "param-readout", PARAM_KEYS[0].label);
    const lane = { t, slot, key: "velocity", head, readout, tabEls: [], cells: [], laneEl: make("div", "lane folded") };

    PARAM_KEYS.forEach((setting) => {
        const tab = make("button", "param-tab", setting.tab);
        tab.title = setting.label;
        tab.setAttribute("aria-label", setting.label);
        tab.setAttribute("aria-pressed", String(setting.key === lane.key));
        tab.addEventListener("click", () => {
            lane.key = setting.key;
            lane.tabEls.forEach((el, i) => el.setAttribute("aria-pressed", String(PARAM_KEYS[i].key === lane.key)));
            readout.textContent = setting.label;
            for (let b = 0; b < BARS; b++) drawParamCell(lane, b);
        });
        lane.tabEls.push(tab);
        tabs.appendChild(tab);
    });
    head.append(tabs, readout);
    songEl.appendChild(head);
    songEl.appendChild(lane.laneEl);

    for (let b = 0; b < BARS; b++) {
        const el = make("div", "param-cell folded");
        el.setAttribute("role", "img");
        el.setAttribute("aria-label", "Bar " + (b + 1) + ": the bars are the notes, drag them up or down to change the setting");
        const canvas = document.createElement("canvas");
        el.appendChild(canvas);
        el.addEventListener("pointerdown", (e) => {
            e.preventDefault(); // (so dragging doesn't select things or scroll)
            if (slot !== null) focusDrum(slot); // (a drum's lane: that drum is the selected one)
            paramDrag = { lane, x: e.clientX, y: e.clientY, edited: null };
            paintParam(lane, e.clientX, e.clientY, e.clientX, e.clientY, true);
        });
        songEl.appendChild(el);
        lane.cells.push({ el, canvas });
    }
    return lane;
}

function buildParamLanes() {
    for (let t = 0; t < TRACKS; t++) paramLanes.push(t === DRUM_TRACK ? null : buildParamLane(t, null)); // (the drums have a lane for each drum)
    DRUM_NOTES.forEach((_, slot) => drumParamLanes.push(buildParamLane(DRUM_TRACK, slot)));
}

// opens or closes the lane under a track (slot is null) or a drum row
function toggleParamLane(t, slot, arrow) {
    if (slot === null) paramOpen[t] = !paramOpen[t];
    else drumParamOpen[slot] = !drumParamOpen[slot];
    arrow.setAttribute("aria-expanded", String(slot === null ? paramOpen[t] : drumParamOpen[slot]));
    layoutSong();
}

// the notes a lane shows for a block: all of the track's, or just the drum's
function laneNotes(lane, b) {
    const notes = clipNotes(lane.t, b);
    return lane.slot === null ? notes : notes.filter((n) => drumSlot(n.note) === lane.slot);
}

// draws one box of a lane: a bar for each note, as tall as its setting
function drawParamCell(lane, b) {
    const { el, canvas } = lane.cells[b];
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = (window.devicePixelRatio || 1) * uiScale; // (a bigger page is drawn sharper, not stretched)
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bars = clipBars(lane.t, b);
    const barW = w / bars;

    // faint lines at the beats, and a stronger one between bars
    g.fillStyle = "white";
    for (let rep = 0; rep < bars; rep++) {
        g.globalAlpha = LINE_BEAT;
        for (let beat = 1; beat < BEATS; beat++) g.fillRect(Math.round(rep * barW + (beat / BEATS) * barW), 0, 1, h);
        g.globalAlpha = LINE_BAR;
        if (rep > 0) g.fillRect(Math.round(rep * barW), 0, 2, h);
    }

    const notes = laneNotes(lane, b);
    g.globalAlpha = 1;
    notes.forEach((n) => {
        const value = noteParam(n, lane.key);
        const x = (n.beat / (bars * BEATS)) * w;
        const height = Math.max(3, value * (h - 8));
        g.fillStyle = "#f2a900";
        g.fillRect(x, h - 4 - height, 6, height);
        g.fillStyle = "white"; // a cap on top of the bar, so its height is easy to see
        g.fillRect(x, h - 4 - height, 6, 2);
    });
    el.setAttribute(
        "aria-label",
        "Bar " + (b + 1) + ": " + notes.length + " notes. Drag the bars up or down to change their " + PARAM_KEYS.find((s) => s.key === lane.key).label.toLowerCase()
    );
}

// draws the lanes' boxes for one block (when its notes change)
function drawParamCells(t, b) {
    if (paramLanes[t] && paramOpen[t]) drawParamCell(paramLanes[t], b);
    if (t === DRUM_TRACK && drumsOpen) {
        drumParamLanes.forEach((lane, slot) => {
            if (drumParamOpen[slot]) drawParamCell(lane, b);
        });
    }
}

// dragging in a lane. paramDrag is set while the mouse (or a finger) is down: the lane, where it was last, and the
// last note that was changed
let paramDrag = null;

// sets the setting of the notes the pointer passes over, in a lane, going from where it was (x0, y0) to where it is
// (x1, y1). The height of the pointer in the lane is the value. When it's first pressed (down) it's the one note
// nearest to it that's changed, and from then on it's every note it moves over
function paintParam(lane, x0, y0, x1, y1, down) {
    const lo = Math.min(x0, x1) - 5;
    const hi = Math.max(x0, x1) + 5;
    const candidates = [];
    lane.cells.forEach(({ el }, b) => {
        if (el.offsetWidth === 0) return; // (a box that's hidden under a longer block, or the lane is closed)
        const rect = el.getBoundingClientRect();
        const bars = clipBars(lane.t, b);
        laneNotes(lane, b).forEach((n) => {
            const x = rect.left + (n.beat / (bars * BEATS)) * rect.width + 3; // the middle of its bar
            candidates.push({ n, b, x, rect });
        });
    });

    let chosen;
    if (down) {
        // the nearest one (within a finger's width), and if several are on top of each other the one whose bar is nearest the pointer's height
        let best = null;
        candidates.forEach((c) => {
            const value = Math.min(1, Math.max(0, 1 - (y1 - c.rect.top - 4) / (c.rect.height - 8)));
            const score = Math.abs(c.x - x1) * 100 + Math.abs(noteParam(c.n, lane.key) - value);
            if (Math.abs(c.x - x1) <= 18 && (!best || score < best.score)) best = { c, score };
        });
        chosen = best ? [best.c] : [];
    } else {
        chosen = candidates.filter((c) => c.x >= lo && c.x <= hi);
    }

    const touched = new Set();
    chosen.forEach((c) => {
        // where the pointer was in height when it was at this note (between the last place and this one)
        const along = x1 === x0 ? 1 : Math.min(1, Math.max(0, (c.x - x0) / (x1 - x0)));
        const y = y0 + (y1 - y0) * along;
        const value = Math.min(1, Math.max(0, 1 - (y - c.rect.top - 4) / (c.rect.height - 8)));
        c.n[lane.key] = Math.round(value * 100) / 100;
        paramDrag.edited = c.n;
        touched.add(c.b);
        const setting = PARAM_KEYS.find((s) => s.key === lane.key);
        lane.readout.textContent = setting.label + " " + setting.format(c.n[lane.key]);
    });
    touched.forEach((b) => drawParamCell(lane, b));
}

document.addEventListener("pointermove", (e) => {
    if (!paramDrag) return;
    paintParam(paramDrag.lane, paramDrag.x, paramDrag.y, e.clientX, e.clientY, false);
    paramDrag.x = e.clientX;
    paramDrag.y = e.clientY;
});

// letting go plays the last note you changed, so you can hear it with its new setting
async function endParamDrag() {
    const drag = paramDrag;
    paramDrag = null;
    if (!drag || !drag.edited) return;
    const n = drag.edited;
    getCtx();
    if (ctx.state === "suspended") await ctx.resume();
    playNote(noteToFrequency(n.note), ctx.currentTime, drag.lane.t, false, DEFAULT_GATE, noteParam(n, "velocity"), releaseScale(noteParam(n, "release")));
}
document.addEventListener("pointerup", endParamDrag);
document.addEventListener("pointercancel", endParamDrag);

// ---- the metronome's settings (the METRO button by BPM) ----
const metroButton = document.getElementById("metroButton");
const metroOptionsButton = document.getElementById("metroOptions");
const metroPopover = document.getElementById("metroPopover");
registerPanel("metro", metroOptionsButton, metroPopover, null, null, { popupOnly: true }); // a popup on a phone too

// the metronome button turns it on and off. Off is no ticks at all (not even the count-in), and on goes back to the way it was set
// (count-in or always)
let metroLastOn = metro.when || 1;
metroButton.addEventListener("click", () => {
    if (metro.when !== 0) {
        metroLastOn = metro.when;
        metro.when = 0;
    } else {
        metro.when = metroLastOn;
    }
    try {
        localStorage.setItem("metronome", JSON.stringify(metro));
    } catch {}
    showMetro();
    if (metro.when !== 0) previewClick();
});

async function previewClick() {
    getCtx();
    if (ctx.state === "suspended") await ctx.resume();
    playClick(ctx.currentTime, true); // so you can hear a sound or a level you pick
}

// fills each group of choices and marks the one that's chosen. Choosing one changes the setting and saves it
function showMetro() {
    metroButton.classList.toggle("on", metro.when !== 0); // (lit when it is on)
    metroButton.setAttribute("aria-pressed", String(metro.when !== 0));
    [
        ["metroClick", "when", CLICK_WHEN],
        ["metroCount", "countIn", COUNT_INS],
        ["metroSound", "sound", CLICK_SOUNDS.map((sound) => sound.name)],
        ["metroLevel", "level", CLICK_LEVELS.map((level) => level.name)],
    ].forEach(([id, key, names]) => {
        fillChoices([document.getElementById(id)], names, metro[key], (i) => {
            metro[key] = i;
            if (key === "when" && i !== 0) metroLastOn = i;
            try {
                localStorage.setItem("metronome", JSON.stringify(metro));
            } catch {}
            showMetro();
            if (key === "sound" || key === "level") previewClick();
        });
    });
}
showMetro();

// ---- the size of the song ----
// The button in the corner of the song opens a popup: how many bars (4 to 32) and how many tracks (the drums and 1 to 9
// more). The audio and the data are made for the most there can be, so changing the size only changes what is shown and played:
// the grid is built again, and what was in a bar or track that is hidden comes back if it is added again.
const SIZE_BARS = [4, 8, 12, 16, 24, 32];
const MIN_TRACKS = 2;
const sizePopover = document.getElementById("sizePopover");
const sizeTracksText = document.getElementById("sizeTracks");
const addTrackButton = document.getElementById("addTrack");
const removeTrackButton = document.getElementById("removeTrack");

// builds the grid again, for the bars and tracks there are now
function rebuildSong() {
    closePanel("steps");
    closeTrackMenu();
    while (songEl.firstChild) songEl.removeChild(songEl.firstChild);
    [barHeads, trackHeads, lanes, cells, drumRows, paramLanes, drumParamLanes].forEach((list) => (list.length = 0));
    selTrack = Math.min(selTrack, TRACKS - 1);
    selBar = Math.min(selBar, BARS - 1);
    buildSong();
    trackHeads.forEach((head, t) => head.settings.setAttribute("aria-expanded", String(paramOpen[t])));
    foldBtn.setAttribute("aria-expanded", String(drumsOpen));
    foldBtn.setAttribute("aria-label", drumsOpen ? "Hide the drum rows" : "Show each drum on its own row");
    layoutSong();
    showAudible();
    selectBlock(selTrack, selBar);
}

function setSongBars(bars) {
    if (bars === BARS) return;
    if (running) stopTransport();
    stopStepRecording();
    BARS = bars;
    rebuildSong();
    showSizePopup();
}

function addTrack() {
    if (TRACKS >= MAX_TRACKS) return;
    if (running) stopTransport();
    stopStepRecording();
    TRACKS++;
    const t = TRACKS - 1;
    if (ctx) {
        applyFx(t);
        applyFilter(t);
        trackGains[t].gain.value = trackSettings[t].volume;
    }
    rebuildSong();
    selectBlock(t, selBar); // (the new track is selected)
    showSizePopup();
}

function removeLastTrack() {
    if (TRACKS <= MIN_TRACKS) return;
    if (running) stopTransport();
    stopStepRecording();
    TRACKS--;
    rebuildSong();
    showSizePopup();
}

// fills the popup: the choices of bars, and what the track buttons can do
function showSizePopup() {
    fillChoices([document.getElementById("sizeBars")], SIZE_BARS.map(String), SIZE_BARS.indexOf(BARS), (i) => setSongBars(SIZE_BARS[i]));
    sizeTracksText.textContent = TRACKS + " tracks (the drums and " + (TRACKS - 1) + " more)";
    addTrackButton.disabled = TRACKS >= MAX_TRACKS;
    removeTrackButton.disabled = TRACKS <= MIN_TRACKS;
    showSizeText();
}

registerPanel("size", sizeButton, sizePopover, null, showSizePopup, { popupOnly: true }); // a popup on a phone too
addTrackButton.addEventListener("click", addTrack);
removeTrackButton.addEventListener("click", () => {
    const last = TRACKS - 1;
    const hasNotes = song[last].some((bar, b) => b < BARS && bar.length > 0);
    // (a track with notes in asks first: it hides it, and the notes only come back if a track is added again before the page is closed)
    if (!hasNotes || removeTrackButton.dataset.armed) {
        clearTimeout(removeTrackButton.armTimer);
        delete removeTrackButton.dataset.armed;
        removeTrackButton.textContent = "REMOVE LAST TRACK";
        removeLastTrack();
        return;
    }
    removeTrackButton.dataset.armed = "true";
    removeTrackButton.textContent = "SURE? IT HAS NOTES";
    removeTrackButton.armTimer = setTimeout(() => {
        delete removeTrackButton.dataset.armed;
        removeTrackButton.textContent = "REMOVE LAST TRACK";
    }, 3000);
});

buildSong();
selectBlock(0, 0);
updateButtons();
layoutSong();
showAudible();
window.addEventListener("resize", layoutSong); // resizing clears a canvas, so draw again (and the buttons move)
new ResizeObserver(layoutSong).observe(songEl); // (the song gets wider or narrower with its box)
