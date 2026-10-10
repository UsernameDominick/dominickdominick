// play the piano with the computer keyboard, the way a lot of music programs do. Two rows of letters are the keys:
//
//     2 3   5 6 7   9 0          (the black keys, a row above the white ones)
//    Q W E R T Y U I O P         the white keys, one octave and a bit up
//
//      S D   G H J               the black keys
//     Z X C V B N M              the white keys, starting on C
//
// [ and ] move all of it down and up an octave. A key held down holds the note (and a chord, an arpeggio and recording all
// work, because it plays the same way the on-screen piano does: pressKey in synth.js). In drum mode (the drum track is selected)
// the keys are the drums instead, from the bottom row (Z to M) up through the home row (A to J) and the top row (Q to I).
// The shortcuts that are letters (keys.js) are Shift and the letter, so they never get in the way.

// each key (by where it is on the keyboard, not what letter it types) and how many semitones above the lowest note it plays
const KB_NOTES = {
    KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22,
    KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
};
// the drum keys, in the order of the drums on the piano (the lowest one first)
const KB_DRUMS = [
    "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM",
    "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ",
    "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI",
];
const KB_SHORTCUT_LETTERS = ["KeyM", "KeyS", "KeyL", "KeyR", "KeyE"]; // with Shift these are shortcuts (keys.js)
let keyboardBase = 60; // the note the Z key plays: middle C to start with

// the note a key plays right now, or null if it isn't a piano key (or the note is off the end of the piano)
function keyboardNote(code) {
    if (drumMode) {
        const place = KB_DRUMS.indexOf(code);
        return place < 0 ? null : DRUM_NOTES[place];
    }
    if (!(code in KB_NOTES)) return null;
    const note = keyboardBase + KB_NOTES[code];
    return note >= FIRST_NOTE && note <= LAST_NOTE ? note : null;
}

// is the key press for a text box or a dropdown (so it is typing, not playing)? A dial is fine: its arrow keys are the only
// thing it uses, so the letters still play after you've turned one
function typingInText(target) {
    return target instanceof Element && target.closest("input:not([type=range]), textarea, select, [contenteditable]") !== null;
}

document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (typingInText(e.target) || (e.target instanceof Element && e.target.closest(".popover"))) return;

    if (e.code === "BracketLeft" || e.code === "BracketRight") {
        if (!e.repeat) keyboardBase = Math.min(FIRST_NOTE + 24, Math.max(FIRST_NOTE, keyboardBase + (e.code === "BracketRight" ? 12 : -12)));
        e.preventDefault();
        return;
    }
    if (e.shiftKey && KB_SHORTCUT_LETTERS.includes(e.code)) return; // (a shortcut)
    const note = keyboardNote(e.code);
    if (note === null) return;
    e.preventDefault();
    // (not if an analog keyboard has already started it, analog.js)
    if (!e.repeat && !heldKeys.has("kb" + e.code)) pressKey("kb" + e.code, note);
});

document.addEventListener("keyup", (e) => {
    if (heldKeys.has("kb" + e.code)) releaseKey("kb" + e.code);
});
