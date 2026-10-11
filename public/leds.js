// the LEDs above the piano keys. They can show the notes of a scale, or a chord, in any key,
// like the light guides on a keyboard controller. KEY, SCALE and SHOW (in the strips box) choose
// what they show. This needs synth.js loaded first, because that's what builds the keys and the LEDs.

// every scale is the list of steps up from its first note (its root), in semitones. short is the shorter
// name the settings button uses (so the button stays small)
const SCALES = [
    { name: "MAJOR", short: "MAJ", steps: [0, 2, 4, 5, 7, 9, 11] },
    { name: "NATURAL MINOR", short: "MIN", steps: [0, 2, 3, 5, 7, 8, 10] },
    { name: "HARMONIC MINOR", short: "HARM MIN", steps: [0, 2, 3, 5, 7, 8, 11] },
    { name: "MELODIC MINOR", short: "MEL MIN", steps: [0, 2, 3, 5, 7, 9, 11] },
    { name: "DORIAN", short: "DOR", steps: [0, 2, 3, 5, 7, 9, 10] },
    { name: "PHRYGIAN", short: "PHRY", steps: [0, 1, 3, 5, 7, 8, 10] },
    { name: "LYDIAN", short: "LYD", steps: [0, 2, 4, 6, 7, 9, 11] },
    { name: "MIXOLYDIAN", short: "MIXO", steps: [0, 2, 4, 5, 7, 9, 10] },
    { name: "LOCRIAN", short: "LOC", steps: [0, 1, 3, 5, 6, 8, 10] },
    { name: "MAJOR PENTATONIC", short: "MAJ PENT", steps: [0, 2, 4, 7, 9] },
    { name: "MINOR PENTATONIC", short: "MIN PENT", steps: [0, 3, 5, 7, 10] },
    { name: "BLUES", short: "BLUES", steps: [0, 3, 5, 6, 7, 10] },
    { name: "WHOLE TONE", short: "WHOLE", steps: [0, 2, 4, 6, 8, 10] },
    { name: "CHROMATIC", short: "CHROM", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

// what the LEDs can show: the scale, the chord on the note you last played, or nothing
const LED_MODES = ["SCALE", "CHORD", "OFF"];

let ledRoot = 0; // the key: 0 is C, 1 is C#, and so on up to 11 (B)
let ledScale = 0; // a place in the SCALES list
let ledMode = 0; // a place in the LED_MODES list
let lastPlayed = null; // the last note you played on the piano (a MIDI number), for the chord

// the choices are remembered, so the page comes back the way you left it (the page works without this)
try {
    const saved = JSON.parse(localStorage.getItem("ledSettings"));
    if (saved && saved.root >= 0 && saved.root < 12) ledRoot = saved.root;
    if (saved && saved.scale >= 0 && saved.scale < SCALES.length) ledScale = saved.scale;
    if (saved && saved.mode >= 0 && saved.mode < LED_MODES.length) ledMode = saved.mode;
} catch {}

function saveLedSettings() {
    try {
        localStorage.setItem("ledSettings", JSON.stringify({ root: ledRoot, scale: ledScale, mode: ledMode }));
    } catch {}
}

const leds = new Map(); // note number -> its LED
document.querySelectorAll(".led").forEach((led) => leds.set(Number(led.dataset.led), led));

// the notes (as steps up from the key) that make a triad on one step of the scale: that step and
// the two a third and a fifth above it, going two scale notes at a time
function triadOn(steps, index) {
    return [steps[index], steps[(index + 2) % steps.length], steps[(index + 4) % steps.length]];
}

// lights the right LEDs for the key, scale and mode that are chosen
function updateLeds() {
    updateSettingsButton(); // the button shows the key and scale, and is switched off in drum mode

    // in drum mode the keys are drums, not notes, so there's no scale to show (the LEDs still flash when a drum plays)
    if (drumMode) {
        leds.forEach((led) => led.classList.remove("on", "root"));
        return;
    }

    // a sampler in CHOP style: the LEDs show which keys have a chop (the first, gold, is the BASE key)
    if (typeof isSampler === "function" && isSampler(liveTrack) && samplerState[liveTrack] && samplerState[liveTrack].data && sampleMode(trackSettings[liveTrack]) === 1) {
        const base = sampleBase(trackSettings[liveTrack].sbase);
        const count = samplerState[liveTrack].chops.length;
        leds.forEach((led, note) => {
            const on = note >= base && note < base + count;
            led.classList.toggle("on", on);
            led.classList.toggle("root", on && note === base);
        });
        return;
    }

    const steps = SCALES[ledScale].steps;
    let lit = []; // the notes to light, as steps up from the key
    let rootStep = 0; // which of them gets the bigger LED

    if (ledMode === 0) {
        lit = steps;
    } else if (ledMode === 1) {
        // the chord on the last note you played (if it's in the scale, otherwise on the key itself)
        let index = 0;
        if (lastPlayed !== null) {
            const found = steps.indexOf((((lastPlayed - ledRoot) % 12) + 12) % 12);
            if (found >= 0) index = found;
        }
        lit = triadOn(steps, index);
        rootStep = steps[index];
    }

    leds.forEach((led, note) => {
        const step = (((note - ledRoot) % 12) + 12) % 12;
        const on = lit.includes(step);
        led.classList.toggle("on", on);
        led.classList.toggle("root", on && step === rootStep);
    });
}

// a quick flash on the LED over a key when that note plays (from the piano, or from the song)
document.addEventListener("notescheduled", (e) => {
    const led = leds.get(e.detail.note);
    if (!led) return;
    const wait = Math.max(0, (e.detail.time - ctx.currentTime) * 1000); // the note may be a moment in the future
    setTimeout(() => {
        led.classList.add("hit");
        setTimeout(() => led.classList.remove("hit"), 160);
    }, wait);
});

// remember what you played, so the chord LEDs can follow it
document.addEventListener("noteplayed", (e) => {
    lastPlayed = e.detail.note;
    if (ledMode === 1) updateLeds();
});

// ---- the SETTINGS button: the key, the scale and what the LEDs show ----
// (panels.js opens it as a popup on a computer, and flips the dials box over on a phone)

const settingsButton = document.getElementById("pianoSettings");
const popover = document.getElementById("pianoPopover");
const closeButton = document.getElementById("closeSettings");

registerPanel("piano", settingsButton, popover, closeButton);

// what's written on the computer version of the button
function updateSettingsButton() {
    const text =
        ledMode === 2 ? "LEDS OFF" : NOTE_NAMES[ledRoot] + " " + SCALES[ledScale].short + (ledMode === 1 ? " CHORD" : "");
    settingsButton.querySelector(".settings-text").textContent = text;
    settingsButton.disabled = drumMode; // there's no scale to choose on the drum track
    settingsButton.title = drumMode ? "Scales don't apply to the drum track" : "Piano settings";
    if (drumMode) closePanel("piano");
}

// fills the choices for one setting with buttons, one for each name, in every box given (the popup has
// one set and the back of the box has another, and they always show the same choice). Choosing one calls
// onChange with its place in the list. It gives back a function that marks which one is chosen right now
function makeChoices(boxes, names, onChange) {
    const buttons = [];
    boxes.forEach((box) => {
        names.forEach((name, i) => {
            const button = document.createElement("button");
            button.className = "choice";
            button.textContent = name;
            button.addEventListener("click", () => onChange(i));
            box.appendChild(button);
            buttons.push({ button, i });
        });
    });
    return (chosen) => buttons.forEach(({ button, i }) => button.setAttribute("aria-pressed", String(i === chosen)));
}

const byId = (id) => document.getElementById(id);

const markKey = makeChoices([byId("popKeyChoices"), byId("keyChoices")], NOTE_NAMES, (i) => {
    ledRoot = i;
    changed();
});
const markScale = makeChoices(
    [byId("popScaleChoices"), byId("scaleChoices")],
    SCALES.map((scale) => scale.name),
    (i) => {
        ledScale = i;
        changed();
    }
);
const markMode = makeChoices([byId("popModeChoices"), byId("modeChoices")], LED_MODES, (i) => {
    ledMode = i;
    changed();
});

// after any choice: save it, and update the LEDs, the button and the marked choices
function changed() {
    saveLedSettings();
    updateLeds();
    markKey(ledRoot);
    markScale(ledScale);
    markMode(ledMode);
}

changed(); // marks the saved choices and lights the LEDs
