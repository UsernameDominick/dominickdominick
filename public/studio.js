// the song: 5 tracks, and each track has 8 blocks (one bar of music each).
// record notes from the piano into a block, mute a track, copy / paste / clear blocks, and
// press play to hear the whole thing. It uses the synth from synth.js (so load that first).

// (TRACKS, how many tracks there are, and each track's settings (trackSettings) live in synth.js)
const BARS = 8; // blocks per track
const BEATS = 4; // beats in a bar
const QUANTIZE = 0.25; // recorded notes snap to the nearest 16th note (a quarter of a beat), 0 turns it off
const LOOKAHEAD = 0.12; // seconds ahead that the scheduler plans notes
const TICK_MS = 25; // how often the scheduler wakes up (in milliseconds)

// song[track][bar] is a list of notes: { beat: 0 up to just under 4, note: MIDI number }
const song = Array.from({ length: TRACKS }, () => Array.from({ length: BARS }, () => []));
// a block can be stretched over more bars (the pattern in it loops). clipLen[track][bar] is how many bars the
// block that starts at that bar covers. The bars a block covers hide their own blocks, they come back if it shrinks
const clipLen = Array.from({ length: TRACKS }, () => new Array(BARS).fill(1));
const muted = new Array(TRACKS).fill(false);
const soloed = new Array(TRACKS).fill(false); // with any track on solo, only the soloed tracks are heard
let selTrack = 0; // the selected block
let selBar = 0;
let clipboard = null; // a copied block ({ notes, len }), or null if nothing is copied

// transport (play and record)
let bpm = 100; // set by the BPM strip, used the next time you press play or rec
let running = false;
let recordArmed = false; // true if this run is a recording
let beatSec; // seconds per beat for this run
let startTime; // audio clock time of beat 0 for this run
let nextBeat; // the next beat the scheduler hasn't planned yet
let recTrack; // where this run is recording to
let recBar;
let tickTimer;
let lastNowBar = -1; // which bar is lit up as playing right now (-1 is none)

// things on the page
const songEl = document.getElementById("song");
const playBtn = document.getElementById("playButton");
const recBtn = document.getElementById("recButton");
const copyBtn = document.getElementById("copyButton");
const pasteBtn = document.getElementById("pasteButton");
const clearBtn = document.getElementById("clearButton");
const bpmSlider = document.getElementById("bpmSlider");
const soundSelect = document.getElementById("soundSelect");
const soundUp = document.getElementById("soundUp");
const soundDown = document.getElementById("soundDown");

const toolsEl = make("div", "block-tools"); // the little buttons by the selected block's border
const handleEl = make("div", "block-handle"); // the grip on the selected block's right edge, drag it to resize the block
const cells = []; // cells[track][bar] is { block, canvas }
const barHeads = []; // the numbers 1 to 8 along the top
const trackHeads = []; // trackHeads[track] is { name, mute, solo }
const lanes = []; // the grey strip behind each track's blocks

// the drum track can open up to show every drum on its own row (the arrow by DRUMS). Each drum is one white key,
// and its place in the kit is its "slot" (0 is the lowest key). Each row can be muted or soloed on its own
const DRUM_COUNT = DRUM_NOTES.length;
const drumMuted = new Array(DRUM_COUNT).fill(false);
const drumSoloed = new Array(DRUM_COUNT).fill(false);
let drumsOpen = false;
const drumRows = []; // drumRows[slot] is { head, name, mute, solo, lane, cells: [{ el, canvas }] }
let foldBtn; // the arrow by DRUMS

// makes an element with a class and some text
function make(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    if (text) el.textContent = text;
    return el;
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

// shows the blocks the way the lengths say: a long block stretches over its bars and the bars under it hide
// which grid row a track is on (the drum rows, when they're open, push the other tracks down)
function trackRow(t) {
    return t === DRUM_TRACK ? 2 : 2 + t + (drumsOpen ? DRUM_COUNT : 0);
}

function layoutSong() {
    // the rows: the numbers, then each track (the drums, when they're open, have a short row for each drum under DRUMS)
    songEl.style.gridTemplateRows = drumsOpen
        ? "24px 38px repeat(" + DRUM_COUNT + ", 30px) repeat(" + (TRACKS - 1) + ", 38px)"
        : "";
    for (let t = 0; t < TRACKS; t++) {
        trackHeads[t].head.style.gridArea = trackRow(t) + " / 1";
        lanes[t].style.gridArea = trackRow(t) + " / 2 / auto / -1";
        const starts = clipStarts(t);
        for (let b = 0; b < BARS; b++) {
            const { block } = cells[t][b];
            const covered = starts[b] !== b;
            block.classList.toggle("covered", covered);
            block.style.gridArea = trackRow(t) + " / " + (b + 2) + " / auto / span " + clipBars(t, b);
        }
    }
    // the drum rows follow the drum track's blocks (a long block is one long box in every row)
    const drumStarts = clipStarts(DRUM_TRACK);
    drumRows.forEach((r, slot) => {
        r.head.classList.toggle("folded", !drumsOpen);
        r.lane.classList.toggle("folded", !drumsOpen);
        r.head.style.gridArea = 3 + slot + " / 1";
        r.lane.style.gridArea = 3 + slot + " / 2 / auto / -1";
        r.cells.forEach(({ el }, b) => {
            el.classList.toggle("folded", !drumsOpen);
            el.classList.toggle("covered", drumStarts[b] !== b);
            el.style.gridArea = 3 + slot + " / " + (b + 2) + " / auto / span " + clipBars(DRUM_TRACK, b);
        });
    });
    // the lit up bar is worked out again from the new lengths
    barHeads.forEach((head) => head.classList.remove("now"));
    cells.forEach((row) => row.forEach((cell) => cell.block.classList.remove("now")));
    lastNowBar = -1;
    drawAll();
    placeTools();
}

// builds the grid: the numbers along the top, then a row for each track
function buildSong() {
    songEl.appendChild(make("div", "corner"));

    for (let b = 0; b < BARS; b++) {
        const head = make("div", "bar-head", String(b + 1));
        barHeads.push(head);
        songEl.appendChild(head);
    }

    for (let t = 0; t < TRACKS; t++) {
        // the left side of the row: the track name (click to select it) and its mute button
        const head = make("div", "track-head");
        head.style.gridArea = t + 2 + " / 1";
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
        head.append(name, mute, solo);
        songEl.appendChild(head);
        trackHeads.push({ head, name, mute, solo });

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
            block.addEventListener("click", () => selectBlock(t, b, true)); // (clicking a block brings up its buttons)
            block.addEventListener("dblclick", openEditor); // (the first click of the double click selected it)
            songEl.appendChild(block);
            cells[t].push({ block, canvas });
        }
    }

    buildDrumRows();
    songEl.appendChild(toolsEl); // sits on top of the grid, placeTools moves it to the selected block
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
            drumMuted[slot] = !drumMuted[slot];
            showAudible();
        });
        const solo = make("button", "solo", "S");
        solo.addEventListener("click", () => {
            drumSoloed[slot] = !drumSoloed[slot];
            showAudible();
        });
        head.append(name, mute, solo);
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
        drumRows.push({ head, name, mute, solo, lane, cells: row });
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
function pickDrum(note) {
    if (selTrack !== DRUM_TRACK) selectBlock(DRUM_TRACK, selBar);
    selectedDrumNote = note;
    refreshDrumKeys();
    showSound();
    previewNote(note, DRUM_TRACK);
}

// clicking a drum's box adds a hit of that drum where you clicked (the nearest sixteenth), or takes away the hit that's there
function toggleDrumHit(slot, b, e) {
    const note = DRUM_NOTES[slot];
    const notes = song[DRUM_TRACK][b];
    const rect = e.currentTarget.getBoundingClientRect();
    const barW = rect.width / clipBars(DRUM_TRACK, b); // a long block shows its bar again and again, a click in any of them is the same place
    const steps = Math.round(BEATS / EDIT_STEP);
    const step = Math.min(steps - 1, Math.floor((((e.clientX - rect.left) % barW) / barW) * steps));
    const found = notes.findIndex((n) => drumSlot(n.note) === slot && Math.round(n.beat / EDIT_STEP) === step);
    if (found >= 0) {
        notes.splice(found, 1);
    } else {
        notes.push({ beat: step * EDIT_STEP, note });
        previewNote(note, DRUM_TRACK);
    }
    drawBlock(DRUM_TRACK, b); // (this draws the drum boxes of that bar too)
}

// draws the hits of every drum in one bar's boxes
function drawDrumCells(b) {
    if (!drumsOpen) return;
    const notes = song[DRUM_TRACK][b];
    const bars = clipBars(DRUM_TRACK, b);
    const dpr = window.devicePixelRatio || 1;
    drumRows.forEach(({ cells: row }, slot) => {
        const { el, canvas } = row[b];
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w || !h) return;
        const hits = notes.filter((n) => drumSlot(n.note) === slot);
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
            g.globalAlpha = 0.2;
            for (let beat = 1; beat < BEATS; beat++) g.fillRect(Math.round(left + (beat / BEATS) * barW), 0, 1, h);
            if (rep > 0) g.fillRect(Math.round(left), 0, 2, h);
            g.globalAlpha = 1;
            g.fillStyle = "#ff8c1a";
            hits.forEach((n) => g.fillRect(left + (n.beat / BEATS) * barW, 3, Math.max(4, barW / 16 - 1), h - 6));
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
function drawBlock(t, b) {
    if (t === DRUM_TRACK) drawDrumCells(b);
    const { block, canvas } = cells[t][b];
    const notes = song[t][b];
    const bars = clipBars(t, b);

    block.classList.toggle("has-notes", notes.length > 0);
    block.setAttribute(
        "aria-label",
        "Track " + (t + 1) + ", bar " + (b + 1) + (bars > 1 ? ", " + bars + " bars" : "") + ", " +
            (notes.length === 0 ? "empty" : notes.length + " notes")
    );
    block.setAttribute("aria-pressed", String(t === selTrack && b === selBar));

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    g.fillStyle = getComputedStyle(block).color; // white, or dark when the block is selected

    // a long block shows its bar again for each bar it covers (the pattern loops)
    const barW = w / bars;
    for (let rep = 0; rep < bars; rep++) {
        const left = rep * barW;

        // faint lines at beats 2, 3 and 4, so you can see where in the bar a note is (and a stronger one between bars)
        g.globalAlpha = 0.25;
        for (let beat = 1; beat < BEATS; beat++) g.fillRect(Math.round(left + (beat / BEATS) * barW), 0, 1, h);
        if (rep > 0) {
            g.globalAlpha = 0.6;
            g.fillRect(Math.round(left), 0, 2, h);
        }
        g.globalAlpha = 1;

        // one mark per note (the piano runs from MIDI note 48 to 84)
        notes.forEach((n) => {
            const x = left + (n.beat / BEATS) * barW;
            const pitch = Math.min(1, Math.max(0, (n.note - 48) / 36)); // a MIDI note outside the piano is drawn at the top or bottom edge
            const y = h - 6 - pitch * (h - 12);
            g.fillRect(x, y - 2, Math.max(4, barW / 16), 4);
        });
    }
}

function drawAll() {
    for (let t = 0; t < TRACKS; t++) for (let b = 0; b < BARS; b++) drawBlock(t, b);
}

// selects a block (the white one), and the track it's in (the orange name). Pick a bar that a long block
// covers and you get the whole block
function selectBlock(t, b, withTools = false) {
    toolsShown = withTools;
    b = clipAt(t, b);
    closeEditor(); // the editor was for the old block
    const oldTrack = selTrack;
    const oldBar = selBar;
    selTrack = t;
    selBar = b;

    cells[oldTrack][oldBar].block.classList.remove("selected");
    cells[t][b].block.classList.add("selected");
    trackHeads.forEach((head, i) => head.name.classList.toggle("selected", i === t));

    drawBlock(oldTrack, oldBar); // draw both again, the marks change colour when selected
    drawBlock(t, b);

    showSound(); // the sound picker shows this track's sound
    placeTools();
}

// ---- the buttons by the border of the selected block ----
// A row of little buttons sits across the top border of the selected block: shorter, longer, edit and delete.

const shorterBtn = make("button", "tool-mini", "\u2212"); // a minus sign
const longerBtn = make("button", "tool-mini", "+");
const editBtn = make("button", "tool-mini wide", "EDIT");
const deleteBtn = make("button", "tool-mini", "\u00d7"); // a times sign
shorterBtn.setAttribute("aria-label", "Make the block one bar shorter");
longerBtn.setAttribute("aria-label", "Make the block one bar longer");
editBtn.setAttribute("aria-label", "Edit the notes in the block");
deleteBtn.setAttribute("aria-label", "Delete the block: clear its notes and make it one bar");
toolsEl.setAttribute("role", "group");
toolsEl.setAttribute("aria-label", "Block tools");
toolsEl.append(shorterBtn, longerBtn, editBtn, deleteBtn);

// puts the buttons on the selected block's top border, lined up with its right end (but not off either end
// of the song, and not over the track names)
// the buttons only show after you click a block. They go away when you click anywhere else (or press Escape),
// the block stays selected, you just click it again to bring them back
let toolsShown = false;

function hideTools() {
    toolsShown = false;
    placeTools();
}

document.addEventListener("pointerdown", (e) => {
    if (toolsShown && !e.target.closest?.(".block, .block-tools, .block-handle")) hideTools();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && toolsShown && !editing) hideTools();
});

function placeTools() {
    toolsEl.classList.toggle("away", !toolsShown);
    handleEl.classList.toggle("away", !toolsShown);
    const block = cells[selTrack][selBar].block;
    if (!toolsShown || block.offsetWidth === 0) return;
    const width = toolsEl.offsetWidth;
    const firstBlock = cells[0][0].block.offsetLeft;
    const right = block.offsetLeft + block.offsetWidth - handleEl.offsetWidth; // (the buttons end where the grip starts)
    const left = Math.max(firstBlock, Math.min(right - width, songEl.scrollWidth - width));
    toolsEl.style.left = left + "px";
    toolsEl.style.top = block.offsetTop - toolsEl.offsetHeight / 2 + "px";
    // the grip is on the block's right edge, the same height as the block
    handleEl.style.left = block.offsetLeft + block.offsetWidth - handleEl.offsetWidth + "px";
    handleEl.style.top = block.offsetTop + "px";
    handleEl.style.height = block.offsetHeight + "px";
    shorterBtn.disabled = clipLen[selTrack][selBar] <= 1;
    longerBtn.disabled = selBar + clipBars(selTrack, selBar) >= BARS;
}

// changes how many bars the selected block covers (1 up to the end of the song)
function setLength(len) {
    clipLen[selTrack][selBar] = Math.max(1, Math.min(len, BARS - selBar));
    layoutSong();
    showEditorTitle();
}

// dragging the grip: the block grows or shrinks a whole bar at a time, to the bar the pointer is over
let resizing = false;

handleEl.addEventListener("pointerdown", (e) => {
    e.preventDefault(); // (so dragging doesn't select text)
    resizing = true;
    try {
        handleEl.setPointerCapture(e.pointerId); // keeps the drag going when the pointer leaves the grip
    } catch {}
});

handleEl.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    const stride = barHeads[1].offsetLeft - barHeads[0].offsetLeft; // from one bar to the next
    const gap = stride - barHeads[0].offsetWidth;
    const x = e.clientX - songEl.getBoundingClientRect().left; // (the song may be scrolled, its left moves with it)
    const bars = Math.round((x - barHeads[selBar].offsetLeft + gap) / stride); // how many bars reach to the pointer
    const len = Math.max(1, Math.min(bars, BARS - selBar));
    if (len !== clipBars(selTrack, selBar)) setLength(len);
});

const stopResizing = () => (resizing = false);
handleEl.addEventListener("pointerup", stopResizing);
handleEl.addEventListener("pointercancel", stopResizing);
handleEl.addEventListener("lostpointercapture", stopResizing);

shorterBtn.addEventListener("click", () => setLength(clipBars(selTrack, selBar) - 1));
longerBtn.addEventListener("click", () => setLength(clipBars(selTrack, selBar) + 1));

// delete: the block is emptied and goes back to one bar (what it covered comes back)
deleteBtn.addEventListener("click", () => {
    song[selTrack][selBar] = [];
    clipLen[selTrack][selBar] = 1;
    layoutSong();
});

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
        soundSelect.setAttribute("aria-label", "Sound for track " + (selTrack + 1));
    }
    showTrackSettings();
    refreshDrumRows();
}

// gives the selected track a new sound (or the selected drum key a new drum), and plays it so you can hear it
async function setSound(index) {
    getCtx();
    if (ctx.state === "suspended") await ctx.resume(); // browsers start audio suspended

    if (drumMode) {
        setDrumSound(selectedDrumNote, index);
        showSound();
        playDrumSound(index, ctx.currentTime);
        return;
    }

    trackSettings[selTrack].sound = (index + SOUNDS.length) % SOUNDS.length; // goes round at the ends of the list
    showSound();
    playNote(noteToFrequency(60), ctx.currentTime, selTrack); // middle C
}

// the arrows: on a synth track they go through all the sounds, on the drum track they stay on the same
// part (so on a snare they go through the snares)
function stepSound(delta) {
    if (drumMode) setSound(nextVariant(drumSoundAt(selectedDrumNote), delta));
    else setSound(trackSettings[selTrack].sound + delta);
}

soundSelect.addEventListener("change", () => setSound(Number(soundSelect.value)));
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
        lanes[t].classList.toggle("muted", !audible(t));
        cells[t].forEach((cell) => cell.block.classList.toggle("muted", !audible(t)));
    }
    // each drum row, too (it's dim if its drum isn't heard, or the whole drum track isn't)
    drumRows.forEach((r, slot) => {
        const heard = audible(DRUM_TRACK) && drumAudible(slot);
        r.mute.setAttribute("aria-pressed", String(drumMuted[slot]));
        r.solo.setAttribute("aria-pressed", String(drumSoloed[slot]));
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

function toggleSolo(t) {
    soloed[t] = !soloed[t];
    showAudible();
}

// editing the selected block
copyBtn.addEventListener("click", () => {
    clipboard = { notes: song[selTrack][selBar].map((n) => ({ ...n })), len: clipBars(selTrack, selBar) };
    updateButtons();
});

pasteBtn.addEventListener("click", () => {
    if (!clipboard) return;
    song[selTrack][selBar] = clipboard.notes.map((n) => ({ ...n }));
    clipLen[selTrack][selBar] = Math.min(clipboard.len, BARS - selBar);
    layoutSong();
});

clearBtn.addEventListener("click", () => {
    song[selTrack][selBar] = [];
    drawBlock(selTrack, selBar);
});

// the metronome click for the count-in
function playClick(time, accent) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = accent ? 1500 : 1000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(gain);
    gain.connect(master);
    osc.start(time);
    osc.stop(time + 0.06);
}

// plays every note that starts during one beat of one bar (skipTrack is left out, -1 leaves none out)
function playBeatOf(bar, beatInBar, time, skipTrack) {
    for (let t = 0; t < TRACKS; t++) {
        if (t === skipTrack || !audible(t)) continue;
        // (a long block plays its one bar of notes over and over)
        song[t][clipAt(t, bar)].forEach((n) => {
            if (Math.floor(n.beat) !== beatInBar) return;
            if (t === DRUM_TRACK && !drumAudible(drumSlot(n.note))) return; // a drum that's muted (or not on solo)
            // (a note in the song only knows where it starts, so each one is held for a beat and then let go)
            playNote(noteToFrequency(n.note), time + (n.beat - beatInBar) * beatSec, t, false, beatSec);
        });
    }
}

// plans one beat. Beats are counted from 0 when you press play or rec.
// Play: the 8 bars go round and round. Rec: 4 beats of count-in, then the recorded bar (beats 4 to 7)
function scheduleBeat(n, time) {
    if (!recordArmed) {
        playBeatOf(Math.floor(n / BEATS) % BARS, n % BEATS, time, -1);
    } else if (n < BEATS) {
        playClick(time, n === 0);
    } else {
        if (n === BEATS) {
            song[recTrack][recBar] = []; // recording replaces what was in the block
            drawBlock(recTrack, recBar);
        }
        // the other tracks play along, but not the one being recorded
        playBeatOf(recBar, n - BEATS, time, recTrack);
    }
}

// runs every 25ms: plans every beat that starts in the next fraction of a second.
// It plans ahead on the audio clock (not setTimeout) so the timing stays steady
function tick() {
    const horizon = ctx.currentTime + LOOKAHEAD;
    while (startTime + nextBeat * beatSec < horizon) {
        if (recordArmed && nextBeat >= BEATS * 2) break; // a recording is one bar, nothing more to plan
        scheduleBeat(nextBeat, startTime + nextBeat * beatSec);
        nextBeat++;
    }
    if (recordArmed && ctx.currentTime >= startTime + BEATS * 2 * beatSec) stopTransport();
}

async function startTransport(record) {
    getCtx();
    if (ctx.state === "suspended") await ctx.resume(); // browsers start audio suspended
    stopTransport();

    beatSec = 60 / bpm;
    recordArmed = record;
    recTrack = selTrack;
    recBar = selBar;
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
    showEditorStep(-1);
}

// notes you play on the piano while recording go into the recorded block
document.addEventListener("noteplayed", (e) => {
    if (!running || !recordArmed) return;
    const beat = (e.detail.time - startTime) / beatSec - BEATS; // 0 is the start of the recorded bar
    if (beat < 0 || beat >= BEATS) return; // during the count-in, or after the bar
    let snapped = QUANTIZE ? Math.round(beat / QUANTIZE) * QUANTIZE : beat;
    if (snapped >= BEATS) snapped = BEATS - QUANTIZE; // keep it inside the bar
    song[recTrack][recBar].push({ beat: snapped, note: e.detail.note });
    drawBlock(recTrack, recBar);
});

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
    const counting = running && recordArmed && beat < BEATS;
    const recording = running && recordArmed && beat >= BEATS;

    playBtn.textContent = running ? "STOP" : "PLAY";
    playBtn.classList.toggle("on", running && !recordArmed);
    recBtn.classList.toggle("on", recording);
    recBtn.classList.toggle("counting", counting);
    recBtn.textContent = counting ? String(Math.min(4, Math.max(0, Math.floor(beat)) + 1)) : "REC";
    pasteBtn.disabled = !clipboard;
    editorPlay.textContent = playBtn.textContent;
    editorPlay.classList.toggle("on", playBtn.classList.contains("on"));
}

// keeps the buttons and the lit up bar current while it's running (it only changes a class when
// something changes, so it's not an animation)
function uiLoop() {
    if (!running) return;
    updateButtons();

    const beat = (ctx.currentTime - startTime) / beatSec;
    let bar = -1;
    if (recordArmed) {
        if (beat >= BEATS) bar = recBar;
    } else if (beat >= 0) {
        bar = Math.floor(beat / BEATS) % BARS;
    }
    showNow(bar);
    showEditorStep(beat);

    requestAnimationFrame(uiLoop);
}

playBtn.addEventListener("click", () => {
    if (running) stopTransport();
    else startTransport(false);
});

recBtn.addEventListener("click", () => {
    if (running && recordArmed) stopTransport();
    else startTransport(true);
});

// tempo: 60 to 180 beats per minute (it changes the next time you press play or rec)
setUpStrip(bpmSlider, (v) => Math.round(60 + v * 120), (v) => {
    bpm = Math.round(60 + v * 120);
});

// ---- the block editor ----
// EDIT (or double-clicking a block) switches the song box over to an editor for the selected block, and BACK
// switches it back. The editor has two tabs, which are two ways to look at the same notes (you choose, and it
// remembers):
//   PIANO ROLL: a row for every key (a keyboard down the left), a square for each sixteenth note of the bar.
//   STEP SEQ: big pads, and only the rows you need: every drum on the drum track, the notes in the key of the
//   LEDs on the other tracks (plus any other note already in the block).
// Click a square to put a note there, click it again to take it away, or hold the mouse down and drag across
// squares to paint a lot at once. It plays each note you add. What you edit is the block's notes (the same
// ones you record), and the song uses them straight away.

const studioEl = document.querySelector(".studio");
const noteEditor = document.getElementById("noteEditor");
const editorTitle = document.getElementById("editorTitle");
const editorBody = document.getElementById("editorBody");
const editorGrid = document.getElementById("editorGrid");
const editorBack = document.getElementById("editorBack");
const editorClear = document.getElementById("editorClear");
const editorPlay = document.getElementById("editorPlay");
const tabRoll = document.getElementById("tabRoll");
const tabSteps = document.getElementById("tabSteps");
const EDIT_STEP = 0.25; // each square is a sixteenth note (a quarter of a beat)
const EDIT_STEPS = Math.round(BEATS / EDIT_STEP); // 16 squares across

let editing = false;
let editorTab = "roll"; // "roll" or "steps"
try {
    if (localStorage.getItem("editorTab") === "steps") editorTab = "steps";
} catch {}

let editorHeads = []; // the 16 numbers along the top of the grid (the one that's playing lights up)
let editorColumns = []; // editorColumns[step] is every square in that column
let lastEditorStep = -1;

function openEditor() {
    editing = true;
    studioEl.classList.add("editing");
    noteEditor.hidden = false;
    buildEditor();
    updateButtons();
    editorBack.focus({ preventScroll: true });
}

function closeEditor() {
    if (!editing) return;
    editing = false;
    toolsShown = false; // (back from the editor, the buttons are put away)
    studioEl.classList.remove("editing");
    noteEditor.hidden = true;
    layoutSong(); // the song was out of sight, so work out its size and draw it again
    editBtn.focus({ preventScroll: true });
}

editBtn.addEventListener("click", openEditor);
editorBack.addEventListener("click", closeEditor);
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && editing) closeEditor();
});

editorClear.addEventListener("click", () => {
    song[selTrack][selBar] = [];
    drawBlock(selTrack, selBar);
    buildEditor();
});
editorPlay.addEventListener("click", () => playBtn.click());

function setTab(tab) {
    editorTab = tab;
    try {
        localStorage.setItem("editorTab", tab);
    } catch {}
    buildEditor();
}
tabRoll.addEventListener("click", () => setTab("roll"));
tabSteps.addEventListener("click", () => setTab("steps"));

function showEditorTitle() {
    const bars = clipBars(selTrack, selBar);
    editorTitle.textContent =
        "TRACK " + (selTrack + 1) + ", " + (bars > 1 ? "BARS " + (selBar + 1) + " TO " + (selBar + bars) : "BAR " + (selBar + 1));
}

// is this note in the key the LEDs are set to?
function inKey(note) {
    return SCALES[ledScale].steps.includes((((note - ledRoot) % 12) + 12) % 12);
}

// the notes that get a row, highest first
function editorNotes() {
    const notes = [];
    if (selTrack === DRUM_TRACK) {
        // every drum, in both tabs (on the drum track a piano roll is a roll of drums)
        for (let i = DRUM_NOTES.length - 1; i >= 0; i--) notes.push(DRUM_NOTES[i]);
        return notes;
    }
    const used = song[selTrack][selBar].map((n) => n.note);
    for (let n = LAST_NOTE; n >= FIRST_NOTE; n--) {
        if (editorTab === "roll" || inKey(n) || used.includes(n)) notes.push(n);
    }
    return notes;
}

// is there a note in this square? (on the drum track a note from a black key counts for the white key below it)
function noteAt(step, note) {
    return song[selTrack][selBar].findIndex(
        (n) =>
            Math.round(n.beat / EDIT_STEP) === step &&
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
        song[selTrack][selBar].push({ beat: step * EDIT_STEP, note });
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

editorGrid.addEventListener("pointerdown", (e) => {
    lastPointer = e.pointerType;
    const cell = e.target.closest(".step");
    if (!cell || e.pointerType === "touch") return;
    e.preventDefault(); // (so dragging doesn't select text)
    painting = !cell.classList.contains("on");
    setSquare(cell, painting);
});

editorGrid.addEventListener("pointerover", (e) => {
    if (painting === null) return;
    const cell = e.target.closest(".step");
    if (cell) setSquare(cell, painting);
});

document.addEventListener("pointerup", () => (painting = null));
document.addEventListener("pointercancel", () => (painting = null));

// a tap on a touch screen, or a key press on a square (the mouse is handled above, a mouse click has detail 1 or more)
editorGrid.addEventListener("click", (e) => {
    const cell = e.target.closest(".step");
    if (!cell || (e.detail !== 0 && lastPointer !== "touch")) return;
    setSquare(cell, !cell.classList.contains("on"));
});

// fills the editor for the selected block (runs each time it opens, and when the tab changes)
function buildEditor() {
    showEditorTitle();
    tabRoll.classList.toggle("on", editorTab === "roll");
    tabSteps.classList.toggle("on", editorTab === "steps");
    tabRoll.setAttribute("aria-pressed", String(editorTab === "roll"));
    tabSteps.setAttribute("aria-pressed", String(editorTab === "steps"));

    const drums = selTrack === DRUM_TRACK;
    editorGrid.innerHTML = "";
    editorGrid.className = "editor-grid " + editorTab + (drums ? " drums" : "");
    editorHeads = [];
    editorColumns = Array.from({ length: EDIT_STEPS }, () => []);
    lastEditorStep = -1;

    // the numbers along the top: 1 2 3 4 for the four beats of the bar
    editorGrid.appendChild(make("div", "step-corner"));
    for (let step = 0; step < EDIT_STEPS; step++) {
        const head = make("div", "step-head", step % 4 === 0 ? String(step / 4 + 1) : "");
        editorHeads.push(head);
        editorGrid.appendChild(head);
    }

    editorNotes().forEach((note) => {
        const sharp = !drums && NOTE_NAMES[note % 12].includes("#");
        const name = drums ? drumLabel(drumSlot(note)) : NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1);
        // (in the piano roll the names are drawn like the keys: white keys white, black keys black)
        const label = make("div", "step-label" + (editorTab === "roll" && !drums ? (sharp ? " key-black" : " key-white") : ""), name);
        label.dataset.note = String(note);
        editorGrid.appendChild(label);

        for (let step = 0; step < EDIT_STEPS; step++) {
            const cell = make("button", "step" + (sharp ? " sharp" : "") + (Math.floor(step / 4) % 2 === 1 ? " alt" : ""));
            cell.dataset.step = String(step);
            cell.dataset.note = String(note);
            const on = noteAt(step, note) >= 0;
            cell.classList.toggle("on", on);
            cell.setAttribute("aria-pressed", String(on));
            cell.setAttribute("aria-label", name + ", beat " + (1 + step * EDIT_STEP));
            editorColumns[step].push(cell);
            editorGrid.appendChild(cell);
        }
    });

    // scroll to the notes in the block (or to the middle of the keyboard if it's empty)
    const marked = editorGrid.querySelector(".step.on");
    const middle =
        marked || editorGrid.querySelector(drums ? ".step-label[data-note]" : '.step-label[data-note="60"]') || editorGrid.querySelector(".step-label[data-note]");
    if (middle) editorBody.scrollTop = Math.max(0, middle.offsetTop - editorBody.clientHeight / 2);
}

// while the song plays, the square column that's playing lights up (if the editor is open on the block that's playing)
function showEditorStep(beat) {
    let step = -1;
    if (editing && running && !recordArmed && beat >= 0) {
        const bar = Math.floor(beat / BEATS) % BARS;
        if (clipAt(selTrack, bar) === selBar) step = Math.floor(((beat % BEATS) / BEATS) * EDIT_STEPS);
    }
    if (step === lastEditorStep) return;
    if (lastEditorStep >= 0) {
        editorHeads[lastEditorStep].classList.remove("now");
        editorColumns[lastEditorStep].forEach((cell) => cell.classList.remove("now"));
    }
    if (step >= 0) {
        editorHeads[step].classList.add("now");
        editorColumns[step].forEach((cell) => cell.classList.add("now"));
    }
    lastEditorStep = step;
}

buildSong();
selectBlock(0, 0);
updateButtons();
layoutSong();
showAudible();
window.addEventListener("resize", layoutSong); // resizing clears a canvas, so draw again (and the buttons move)
new ResizeObserver(layoutSong).observe(songEl); // (the song gets wider or narrower with its box)
