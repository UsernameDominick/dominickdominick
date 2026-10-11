// MIDI: play the synth and the drums with a real MIDI keyboard, and send what plays out to MIDI gear. The
// MIDI button in the top box opens the options: which INPUT to listen to, which CHANNEL, an OCTAVE shift,
// a VELOCITY CURVE (how hard you have to hit a key to get a loud note), what PRESSURE does and an OUTPUT to send to. The sustain pedal
// (controller 64) holds the notes after the keys are let go, and pressure (aftertouch) moves the notes you're holding. The browser asks for permission the first time you open it (Chrome and Edge do
// MIDI, Safari doesn't). This needs synth.js, drums.js, panels.js and leds.js loaded first.

const midiButton = document.getElementById("midiButton");
const midiPopover = document.getElementById("midiPopover");
const closeMidi = document.getElementById("closeMidi");

registerPanel("midi", midiButton, midiPopover, closeMidi, askForMidi);

const MIDI_CHANNELS = ["ALL"].concat(Array.from({ length: 16 }, (_, i) => String(i + 1)));
const MIDI_OCTAVES = [-2, -1, 0, 1, 2];
// how the force a key is hit with (0 to 1) becomes how loud the note is: SOFT makes a light touch louder, HARD needs a firm hit
const VELOCITY_CURVES = [
    { name: "SOFT", power: 0.6 },
    { name: "NORMAL", power: 1 },
    { name: "HARD", power: 1.6 },
];

// where we are with the browser: "idle" (haven't asked yet), "asking" (waiting for you to say yes),
// "ready", "denied" (you said no) or "unsupported" (this browser has no MIDI)
let midiState = "idle";
let midiAccess = null; // the browser's list of MIDI devices, once it's let us have it

// the choices. They're remembered by the device's name, because a device's id can change between visits
let inputName = null; // the device we listen to, or null for none
let outputName = null; // the device we send to, or null for none
let midiChannel = 0; // 0 listens to every channel, 1 to 16 listens to just that one
let midiOctave = 0; // moves every note you play up or down by this many octaves
let midiCurve = 1; // the velocity curve: a place in VELOCITY_CURVES

try {
    const saved = JSON.parse(localStorage.getItem("midiSettings"));
    if (saved && typeof saved.input === "string") inputName = saved.input;
    if (saved && typeof saved.output === "string") outputName = saved.output;
    if (saved && saved.channel >= 0 && saved.channel <= 16) midiChannel = saved.channel;
    if (saved && MIDI_OCTAVES.includes(saved.octave)) midiOctave = saved.octave;
    if (saved && Number.isInteger(saved.curve) && saved.curve >= 0 && saved.curve < VELOCITY_CURVES.length) midiCurve = saved.curve;
} catch {}

function saveMidiSettings() {
    try {
        localStorage.setItem(
            "midiSettings",
            JSON.stringify({ input: inputName, output: outputName, channel: midiChannel, octave: midiOctave, curve: midiCurve })
        );
    } catch {}
}

let currentInput = null; // the real input and output devices we're using right now (or null)
let currentOutput = null;

// what the device lists say when there's no list to show
const MIDI_MESSAGES = {
    idle: "OPEN THIS TO START",
    asking: "ALLOW MIDI IN THE BROWSER",
    denied: "MIDI WAS BLOCKED",
    unsupported: "NOT IN THIS BROWSER",
};

// the devices that are plugged in right now
function connectedDevices(map) {
    return map ? [...map.values()].filter((device) => device.state === "connected") : [];
}

// the items for a device list: OFF, then each device (or a message if there are none to show)
function deviceItems(devices) {
    const items = ["OFF"];
    if (midiState !== "ready") items.push({ name: MIDI_MESSAGES[midiState], disabled: true });
    else if (devices.length === 0) items.push({ name: "NONE FOUND", disabled: true });
    else devices.forEach((device) => items.push((device.name || "MIDI DEVICE").toUpperCase()));
    return items;
}

// what's written on the computer version of the button
function updateMidiButton() {
    let text = "MIDI OFF";
    if (midiState === "unsupported") text = "NO MIDI";
    else if (currentInput || currentOutput) text = "MIDI " + [currentInput && "IN", currentOutput && "OUT"].filter(Boolean).join("/");
    midiButton.querySelector(".settings-text").textContent = text;
    midiButton.title = midiState === "unsupported" ? "This browser can't do MIDI" : "MIDI options";
}

const markChannel = makeChoices([byId("popChannelChoices"), byId("channelChoices")], MIDI_CHANNELS, (i) => {
    midiChannel = i;
    saveMidiSettings();
    markChannel(midiChannel);
});

const markOctave = makeChoices(
    [byId("popOctaveChoices"), byId("octaveChoices")],
    MIDI_OCTAVES.map((octave) => (octave > 0 ? "+" + octave : String(octave))),
    (i) => {
        midiOctave = MIDI_OCTAVES[i];
        saveMidiSettings();
        markOctave(MIDI_OCTAVES.indexOf(midiOctave));
    }
);

const markCurve = makeChoices([byId("popCurveChoices"), byId("curveChoices")], VELOCITY_CURVES.map((curve) => curve.name), (i) => {
    midiCurve = i;
    saveMidiSettings();
    markCurve(midiCurve);
});

// SOUND ENGINE: NEW uses the worklets (unison, the ladder, the matrix...), SAFE only the browser's own parts, for a computer that crackles
const ENGINE_CHOICES = ["NEW", "SAFE"];
const markEngine = makeChoices([byId("popEngineChoices"), byId("engineChoices")], ENGINE_CHOICES, (i) => {
    setSafeEngine(i === 1);
    markEngine(i);
});

// what the mouse does to a note you hold when you move it sideways (X) and up and down (Y): see synth.js
const markX = makeChoices([byId("popXChoices"), byId("xChoices")], XY_TARGETS, (i) => {
    xyMod.x = i;
    saveXyMod();
    markX(xyMod.x);
});
const markY = makeChoices([byId("popYChoices"), byId("yChoices")], XY_TARGETS, (i) => {
    xyMod.y = i;
    saveXyMod();
    markY(xyMod.y);
});

// what pressing harder on a key you hold does (aftertouch)
const markP = makeChoices([byId("popPChoices"), byId("pChoices")], XY_TARGETS, (i) => {
    xyMod.p = i;
    saveXyMod();
    markP(xyMod.p);
});

// works out which devices we're using, listens to the input, and rewrites everything that shows MIDI
function refreshMidi() {
    const inputs = connectedDevices(midiAccess && midiAccess.inputs);
    const outputs = connectedDevices(midiAccess && midiAccess.outputs);

    currentInput = inputs.find((device) => device.name === inputName) || null;
    currentOutput = outputs.find((device) => device.name === outputName) || null;

    // only the chosen input is listened to
    if (midiAccess) {
        midiAccess.inputs.forEach((device) => {
            device.onmidimessage = currentInput && device.id === currentInput.id ? onMidiMessage : null;
        });
    }

    fillChoices([byId("popInputChoices"), byId("inputChoices")], deviceItems(inputs), currentInput ? 1 + inputs.indexOf(currentInput) : 0, (i) => {
        inputName = i === 0 ? null : inputs[i - 1].name;
        saveMidiSettings();
        refreshMidi();
    });
    fillChoices([byId("popOutputChoices"), byId("outputChoices")], deviceItems(outputs), currentOutput ? 1 + outputs.indexOf(currentOutput) : 0, (i) => {
        outputName = i === 0 ? null : outputs[i - 1].name;
        saveMidiSettings();
        refreshMidi();
    });
    markChannel(midiChannel);
    markOctave(MIDI_OCTAVES.indexOf(midiOctave));
    markX(xyMod.x);
    markY(xyMod.y);
    markP(xyMod.p);
    markCurve(midiCurve);
    markEngine(safeEngine ? 1 : 0);
    if (!currentInput) letGoOfPedalNotes(); // (an unplugged keyboard can't let the pedal up)
    updateMidiButton();
}

// the first time the MIDI panel is opened (that's a click, so it's allowed to ask): make the audio ready, so a
// note from a MIDI keyboard can make sound, and ask the browser for the MIDI devices
function askForMidi() {
    getCtx();
    if (ctx.state === "suspended") ctx.resume();

    if (midiState !== "idle") return;
    if (!navigator.requestMIDIAccess) {
        midiState = "unsupported";
        refreshMidi();
        return;
    }

    midiState = "asking";
    refreshMidi();
    navigator
        .requestMIDIAccess()
        .then((access) => {
            midiAccess = access;
            midiState = "ready";
            access.onstatechange = refreshMidi; // a device was plugged in or unplugged
            refreshMidi();
        })
        .catch(() => {
            midiState = "denied";
            refreshMidi();
        });
}

// ---- notes coming in ----

// a MIDI note number moved by the octave setting. On the drum track the note has to land on one of the drum
// keys, so it's moved by whole octaves until it does
function inputNote(rawNote) {
    let note = rawNote + midiOctave * 12;
    if (drumMode) {
        while (note < FIRST_NOTE) note += 12;
        while (note > LAST_NOTE) note -= 12;
    }
    return note;
}

const heldMidi = new Map(); // the keys held down on the MIDI keyboard: its note number -> the note's { release }
let pedalDown = false; // the sustain pedal
const pedalNotes = []; // the notes whose keys were let go while the pedal was down: they sound until it comes up, then fade

// the MIDI button's words are squashed flat while the pedal is down, and spring back when it comes up
function showPedal() {
    midiButton.classList.toggle("pedal-down", pedalDown);
}

// lets go of the notes the pedal was holding, and takes the pedal up
function letGoOfPedalNotes() {
    pedalDown = false;
    showPedal();
    if (!ctx) return;
    pedalNotes.splice(0).forEach((handle) => handle.release(ctx.currentTime));
}

// lets go of everything (all notes off)
function letGoOfAllMidi() {
    heldMidi.forEach((handle, key) => {
        handle.release(ctx.currentTime);
        endExpression("midi" + key);
    });
    heldMidi.clear();
    letGoOfPedalNotes();
}

function onMidiMessage(e) {
    const [status, data1, data2] = e.data;
    const type = status & 0xf0;
    if (midiChannel && (status & 0x0f) + 1 !== midiChannel) return; // not the channel we're listening to
    if (!ctx || renderingOffline) return; // the audio isn't ready yet (or the song is being made into a file)

    if (type === 0x90 && data2 > 0) {
        // a note on: play it on the selected track (it sounds until the key is let go), and let the page know, so
        // the song can record it
        const note = inputNote(data1);
        const now = ctx.currentTime;
        if (heldMidi.has(data1)) {
            // the same key again: the old note is let go (or, with the pedal down, left to fade when the pedal comes up)
            if (pedalDown) pedalNotes.push(heldMidi.get(data1));
            else heldMidi.get(data1).release(now);
            endExpression("midi" + data1);
        }
        // (the force you hit the key with, data2, shaped by the velocity curve, is the note's velocity, and it's recorded with the note)
        const velocity = (data2 / 127) ** VELOCITY_CURVES[midiCurve].power;
        heldMidi.set(data1, playNote(noteToFrequency(note), now, liveTrack, true, DEFAULT_GATE, velocity));
        startPressure("midi" + data1, heldMidi.get(data1)); // (pressing harder on the key moves the note, see synth.js)
        document.dispatchEvent(new CustomEvent("noteplayed", { detail: { note, time: now, velocity } }));
    } else if (type === 0x80 || type === 0x90) {
        // a note off (or a note on with no force, which also means off): let go of that key's note, unless the pedal is holding it
        if (heldMidi.has(data1)) {
            if (pedalDown) pedalNotes.push(heldMidi.get(data1));
            else heldMidi.get(data1).release(ctx.currentTime);
            endExpression("midi" + data1);
        }
        heldMidi.delete(data1);
    } else if (type === 0xd0) {
        // channel pressure (aftertouch): how hard the keys that are held are being pressed, together
        heldMidi.forEach((handle, key) => setPressure("midi" + key, data1 / 127));
    } else if (type === 0xa0) {
        // pressure on one key
        setPressure("midi" + data1, data2 / 127);
    } else if (type === 0xb0 && data1 === 64) {
        // controller 64 is the sustain pedal (down from 64 up)
        if (data2 >= 64) {
            pedalDown = true;
            showPedal();
        } else {
            letGoOfPedalNotes();
        }
    } else if (type === 0xb0 && (data1 === 123 || data1 === 120)) {
        // all notes off
        letGoOfAllMidi();
    } else if (type === 0xe0) {
        // pitch bend: the wheel on the keyboard moves the pitch wheel (8192 is the middle)
        pitchWheel.value = Math.max(-1, Math.min(1, (((data2 << 7) | data1) - 8192) / 8192));
        pitchWheel.dispatchEvent(new Event("input"));
    } else if (type === 0xb0 && data1 === 1) {
        // controller 1 is the mod wheel
        modWheel.value = data2 / 127;
        modWheel.dispatchEvent(new Event("input"));
    }
}

// ---- notes going out ----

// every note the page plays (the piano, the song, MIDI coming in) can be sent to the output device. The
// drums go out on channel 10 and the synth tracks on channels 1 to 4, so a MIDI synth can tell them apart.
// (If the same device is the input and the output nothing is sent, or its own notes would come straight back)
document.addEventListener("notescheduled", (e) => {
    if (!currentOutput || (currentInput && currentOutput.id === currentInput.id)) return;
    const { note, time, track } = e.detail;
    if (note < 0 || note > 127) return;

    const channel = track === DRUM_TRACK ? 9 : Math.max(0, track - 1);
    const stamp = performance.now() + Math.max(0, (time - ctx.currentTime) * 1000); // when it should sound, in the browser's time
    currentOutput.send([0x90 | channel, note, 100], stamp);
    currentOutput.send([0x80 | channel, note, 0], stamp + 250);
});

refreshMidi(); // writes the first lists and marks the saved choices
