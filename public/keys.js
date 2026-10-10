// undo and redo, and the keyboard shortcuts. (There's no button for the shortcuts, they're just there on a computer.)
//
//   Space            play and stop (while step recording, a rest)
//   Shift+R          record
//   Ctrl+Z           undo
//   Ctrl+Shift+Z     redo (Ctrl+Y does too)
//   Ctrl+C, Ctrl+V   copy the selected block, paste into it
//   Delete           clear the selected block (while step recording, Backspace goes back a step)
//   Ctrl+S           save the song (save.js)
//   Shift+M, S, L    mute, solo and loop the selected track
//   arrow keys       left and right pick the next block along, up and down the track above or below
//   Shift+E          open the step sequencer for the selected block
// (the letters on their own play the piano, see keyboard.js)
//
// Undo goes back through the music: the notes (and their velocity and so on), and how long the blocks are. It's one step for
// a drag, for a recording, or for a click. It uses the song and the blocks from studio.js, so load this after it.

const UNDO_LIMIT = 100;
const undoStack = []; // what the music was, as text, before each change (the last one is the most recent)
const redoStack = [];
const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");

function musicLook() {
    return JSON.stringify({ song, clipLen });
}

let lastLook = musicLook(); // the music as it was when we last looked

// looks at the music, and if it has changed since last time that's a step to undo. It's called when a click, a drag or a key
// press has finished (so a whole drag is one step), and when a recording stops
function checkpoint() {
    if (running && recordArmed) return; // (a recording is one step, when it stops)
    const look = musicLook();
    if (look === lastLook) return;
    undoStack.push(lastLook);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0; // (a new change leaves nothing to redo)
    lastLook = look;
    showHistory();
}

function showHistory() {
    undoButton.disabled = undoStack.length === 0;
    redoButton.disabled = redoStack.length === 0;
}

// puts the music back to how it was in the text
function restoreMusic(look) {
    const data = JSON.parse(look);
    for (let t = 0; t < MAX_TRACKS; t++) { // (all of them: the ones that are hidden are kept too)
        for (let b = 0; b < MAX_BARS; b++) {
            song[t][b] = data.song[t][b];
            clipLen[t][b] = data.clipLen[t][b];
        }
    }
    lastLook = look;
    selectBlock(selTrack, selBar); // (a block that now covers the selected bar is selected whole)
    layoutSong(); // draws every block again
    showHistory();
}

function undo() {
    if (running) stopTransport();
    checkpoint(); // (anything that hasn't been counted yet)
    if (!undoStack.length) return;
    redoStack.push(lastLook);
    restoreMusic(undoStack.pop());
}

function redo() {
    if (running) stopTransport();
    checkpoint();
    if (!redoStack.length) return;
    undoStack.push(lastLook);
    restoreMusic(redoStack.pop());
}

// a new song (or one that's opened) starts with nothing to undo
function resetHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    lastLook = musicLook();
    showHistory();
}

undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);

// (a moment after the click or drag has run its own code)
const checkSoon = () => setTimeout(checkpoint, 0);
document.addEventListener("pointerup", checkSoon);
document.addEventListener("click", checkSoon);
document.addEventListener("keyup", checkSoon);

// ---- the keys ----

// is the key press for something you're typing into (or a dropdown), and not for the song? (A dial isn't: after you've turned
// one the keys still work, except the arrows, which turn it)
function typingIn(target) {
    return target instanceof Element && target.closest("input:not([type=range]), textarea, select, [contenteditable]") !== null;
}

document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return; // (a piano key that was pressed with Space has dealt with it)
    const inPopup = e.target instanceof Element && e.target.closest(".popover") !== null;
    const key = e.key.toLowerCase();

    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (typingIn(e.target)) return; // (a text box has its own undo, copy and paste)
        if (key === "z") {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
        } else if (key === "y") {
            e.preventDefault();
            redo();
        } else if ((key === "c" || key === "v") && !String(window.getSelection()).length) {
            e.preventDefault();
            if (key === "c") copyBlock();
            else pasteBlock();
        }
        return; // (Ctrl+S is in save.js)
    }
    if (e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target) || inPopup) return;

    const arrow = { arrowleft: [0, -1], arrowright: [0, 1], arrowup: [-1, 0], arrowdown: [1, 0] }[key];
    if (arrow && e.target instanceof Element && e.target.closest(".piano-scroll, input[type=range]")) return; // (the arrows scroll the piano, or turn the dial)

    if (key === " " && !e.repeat) {
        e.preventDefault();
        if (stepCursor !== null) stepRest();
        else playBtn.click();
    } else if (key === "r" && e.shiftKey && !e.repeat) {
        e.preventDefault();
        recBtn.click();
    } else if (key === "delete") {
        e.preventDefault();
        clearBlock();
    } else if (key === "backspace") {
        e.preventDefault();
        if (stepCursor !== null) stepBack();
        else clearBlock();
    } else if (key === "m" && e.shiftKey && !e.repeat) {
        toggleMute(selTrack);
    } else if (key === "s" && e.shiftKey && !e.repeat) {
        toggleSolo(selTrack);
    } else if (key === "l" && e.shiftKey && !e.repeat) {
        toggleLoop(selTrack);
    } else if (key === "e" && e.shiftKey && !e.repeat) {
        openStepPopup();
    } else if (key === "escape") {
        stopStepRecording();
    } else if (arrow) {
        const track = selTrack + arrow[0];
        // (left goes to the block before, right to the block after this one, up and down stay in the same bar)
        const bar = arrow[1] > 0 ? selBar + clipBars(selTrack, selBar) : arrow[1] < 0 ? selBar - 1 : selBar;
        if (track < 0 || track >= TRACKS || bar < 0 || bar >= BARS) return;
        e.preventDefault();
        selectBlock(track, bar);
    }
});

showHistory();
