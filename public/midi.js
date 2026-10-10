// MIDI: play the synth and the drums with a real MIDI keyboard, and send what plays out to MIDI gear. The
// MIDI button in the top box opens the options: which INPUT to listen to, which CHANNEL, an OCTAVE shift,
// and an OUTPUT to send to. The browser asks for permission the first time you open it (Chrome and Edge do
// MIDI, Safari doesn't). This needs synth.js, drums.js, panels.js and leds.js loaded first.

const midiButton = document.getElementById("midiButton");
const midiPopover = document.getElementById("midiPopover");
const closeMidi = document.getElementById("closeMidi");

registerPanel("midi", midiButton, midiPopover, closeMidi, askForMidi);

const MIDI_CHANNELS = ["ALL"].concat(Array.from({ length: 16 }, (_, i) => String(i + 1)));
const MIDI_OCTAVES = [-2, -1, 0, 1, 2];

// where we are with the browser: "idle" (haven't asked yet), "asking" (waiting for you to say yes),
// "ready", "denied" (you said no) or "unsupported" (this browser has no MIDI)
let midiState = "idle";
let midiAccess = null; // the browser's list of MIDI devices, once it's let us have it

// the choices. They're remembered by the device's name, because a device's id can change between visits
let inputName = null; // the device we listen to, or null for none
let outputName = null; // the device we send to, or null for none
let midiChannel = 0; // 0 listens to every channel, 1 to 16 listens to just that one
let midiOctave = 0; // moves every note you play up or down by this many octaves

try {
    const saved = JSON.parse(localStorage.getItem("midiSettings"));
    if (saved && typeof saved.input === "string") inputName = saved.input;
    if (saved && typeof saved.output === "string") outputName = saved.output;
    if (saved && saved.channel >= 0 && saved.channel <= 16) midiChannel = saved.channel;
    if (saved && MIDI_OCTAVES.includes(saved.octave)) midiOctave = saved.octave;
} catch {}

function saveMidiSettings() {
    try {
        localStorage.setItem(
            "midiSettings",
            JSON.stringify({ input: inputName, output: outputName, channel: midiChannel, octave: midiOctave })
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
        if (heldMidi.has(data1)) heldMidi.get(data1).release(now); // the same key again, let go of the old one
        // (the force you hit the key with, data2, is the note's velocity, and it's recorded with the note)
        heldMidi.set(data1, playNote(noteToFrequency(note), now, liveTrack, true, DEFAULT_GATE, data2 / 127));
        document.dispatchEvent(new CustomEvent("noteplayed", { detail: { note, time: now, velocity: data2 / 127 } }));
    } else if (type === 0x80 || type === 0x90) {
        // a note off (or a note on with no force, which also means off): let go of that key's note
        if (heldMidi.has(data1)) heldMidi.get(data1).release(ctx.currentTime);
        heldMidi.delete(data1);
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
