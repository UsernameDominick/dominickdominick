// the recording options: the little arrow by REC opens a popup to change how recording works. The settings are kept by
// studio.js (recordOptions, with the lists of names), and this fills in the popup.
//   QUANTIZE   what you record snaps to the nearest beat, eighth, sixteenth or thirty-second (or doesn't)
//   SWING      plays every other step late, for a bouncier feel (it's heard when the song plays, the notes aren't moved)
//   WHEN RECORDING   REPLACE clears the block when recording starts, OVERDUB adds to what's in it
//   LOOP RECORD      goes round and round the block until you press STOP, adding notes each time round
//   STEP RECORD      REC puts a cursor on the block, and each note you play goes in at the cursor (no clock)
// And a button to snap the notes already in the selected block to the quantize setting.

const recOptionsButton = document.getElementById("recOptions");
const recPopover = document.getElementById("recPopover");
const recStatus = document.getElementById("recStatus");
const quantizeBlockButton = document.getElementById("quantizeBlock");

const RECORD_GROUPS = [
    ["recQuantize", "quantize"],
    ["recSwing", "swing"],
    ["recSwingGrid", "swingGrid"],
    ["recMode", "mode"],
    ["recLoop", "loop"],
    ["recStep", "step"],
];

// what REC will do with the settings as they are
function recordSummary() {
    if (recordOptions.step === 1) return "REC puts a cursor on the block. Play notes to put them in. Space is a rest, Backspace goes back a step.";
    const how = recordOptions.mode === 1 ? "adds to what is in the block" : "replaces what is in the block";
    if (recordOptions.loop === 1) return "REC goes round and round the block until you press STOP, and " + how + ", then adds more each time round.";
    return "REC records the block once and " + how + ".";
}

function showRecordOptions() {
    RECORD_GROUPS.forEach(([id, key]) => {
        fillChoices([document.getElementById(id)], recordLists[key], recordOptions[key], (i) => {
            recordOptions[key] = i;
            try {
                localStorage.setItem("recordOptions", JSON.stringify(recordOptions));
            } catch {}
            if (key === "step" && i === 0) stopStepRecording();
            recStatus.textContent = recordSummary();
            showRecordOptions();
        });
    });
    quantizeBlockButton.disabled = quantizeStep() === 0;
    recStatus.textContent = recordSummary();
}

// snaps every note in the selected block to the nearest step. Two notes that end up in the same place are one note
function quantizeBlock() {
    const step = quantizeStep();
    if (!step) return;
    const length = clipBars(selTrack, selBar) * BEATS;
    const seen = new Set();
    const snapped = [];
    let moved = 0;
    song[selTrack][selBar].forEach((n) => {
        let beat = Math.round(n.beat / step) * step;
        if (beat >= length) beat = length - step; // (a note near the end can't go past it)
        if (beat !== n.beat) moved++;
        const place = beat + ":" + n.note;
        if (seen.has(place)) return;
        seen.add(place);
        snapped.push({ ...n, beat });
    });
    song[selTrack][selBar] = snapped;
    drawBlock(selTrack, selBar);
    recStatus.textContent = moved === 0 ? "Every note was already on the beat." : "Snapped " + moved + (moved === 1 ? " note" : " notes") + " to " + QUANTIZE_NAMES[recordOptions.quantize] + ".";
}

registerPanel("rec", recOptionsButton, recPopover, null, showRecordOptions, { popupOnly: true }); // a popup on a phone too
quantizeBlockButton.addEventListener("click", quantizeBlock);
