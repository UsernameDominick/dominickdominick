// the dials box when the selected track is a sampler (sampler.js): three tabs (OSC goes away, these take its place).
//   SAMPLE  the waveform with START and END handles to drag, and where the sound comes from: LOAD a file (or drop one on the box) or record with the
//           microphone. STYLE is how the keys play it (PITCH, CHOP or LOOP), REV plays it backwards
//   CHOP    the waveform with a marker where each chop starts: click to add one (and hear it), drag to move one, double-click to take one away.
//           AUTO cuts it at the hits (SENS is how small a hit counts) or into 4, 8 or 16 equal parts; BASE is the key of the first chop
//   TUNE    what was found (the note, the key, the tempo) and ROOT and FINE (the note the sound is at), then KEY MATCH (moves it into the key of the
//           song) and TEMPO MATCH (makes it fit the song's tempo): SHIFT and BEATS are the dials they set, and can be set by hand
// This needs fx.js (which builds the tabs, plates and dials) and dialviews.js (the pictures) loaded first.

const SAMPLE_INK = "#17130f";

// the box under a tab's plate title, by the title
function plateRow(title) {
    const found = dialPlates.find((plate) => plate.el.querySelector("h3").textContent === title);
    return found ? found.row : null;
}

function plateButton(label, aria, onClick) {
    const button = mk("button", "plate-button", label);
    button.type = "button";
    button.setAttribute("aria-label", aria);
    button.addEventListener("click", onClick);
    return button;
}

function setDialTo(id, value) {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = String(Math.min(1, Math.max(0, value)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

// ---- the waveform ----
// the loudest and quietest of the sound in each column of pixels, kept for as long as the view and the width are the same
function wavePeaks(st, view, columns) {
    const key = view.key + "|" + columns + "|" + view.duration;
    if (st.peaks && st.peaks.key === key) return st.peaks;
    const channels = view.forward.channels;
    const n = channels[0].length;
    const lows = new Float32Array(columns);
    const highs = new Float32Array(columns);
    for (let x = 0; x < columns; x++) {
        const from = Math.floor((x / columns) * n);
        const to = Math.max(from + 1, Math.floor(((x + 1) / columns) * n));
        const stride = Math.max(1, Math.floor((to - from) / 64)); // (a column of a long sound is looked at in pieces, not at every sample)
        let lo = 0;
        let hi = 0;
        for (const ch of channels) {
            for (let i = from; i < to; i += stride) {
                const v = ch[i];
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
        }
        lows[x] = lo;
        highs[x] = hi;
    }
    st.peaks = { key, lows, highs };
    return st.peaks;
}

const WAVE_TOP = 26; // room for the words above the wave
const WAVE_BOTTOM = 6;

// the picture on the SAMPLE and CHOP tabs (and a small one on the SOUND tab). kind is "sample", "chop" or "mini"
function drawSamplePicture(canvas, kind) {
    const { g, w, h, accent } = viewSetup(canvas, 8, 2);
    const track = liveTrack;
    const st = samplerState[track];
    const s = trackSettings[track];
    const centre = (WAVE_TOP + h - WAVE_BOTTOM) / 2;
    const amp = (h - WAVE_TOP - WAVE_BOTTOM) / 2;

    const say = (lines) => {
        lines.forEach((line, i) => viewText(g, line, w / 2, h / 2 - ((lines.length - 1) * 11) + i * 24, "center", i === 0 ? 0.95 : 0.65));
    };
    if (!st || (!st.data && !st.missing)) {
        say([st && st.message ? st.message : "NO SOUND YET", "LOAD A FILE, DROP ONE HERE, OR RECORD"]);
        canvas.setAttribute("aria-label", "The sampler has no sound yet. Load a file, drop one here, or record with the microphone.");
        return;
    }
    if (st.missing) {
        say(["THE SOUND IS NOT IN THIS BROWSER", st.name, "LOAD THE FILE AGAIN (OR DROP IT HERE)"]);
        canvas.setAttribute("aria-label", "The sound " + st.name + " is not in this browser. Load the file again.");
        return;
    }
    const view = samplerView(track);
    const peaks = wavePeaks(st, view, Math.max(2, Math.floor(w)));
    const mode = sampleMode(s);

    // the wave
    g.fillStyle = withAlpha(accent, 0.3);
    g.fillRect(0, Math.round(centre), w, 1);
    g.fillStyle = accent;
    for (let x = 0; x < peaks.lows.length; x++) {
        const top = centre + peaks.lows[x] * amp;
        const bottom = centre + peaks.highs[x] * amp;
        g.fillRect(x, Math.floor(top), 1, Math.max(1, Math.ceil(bottom - top)));
    }
    const xFor = (seconds) => (seconds / view.duration) * w;

    if (kind !== "mini") {
        // START and END: the part outside is dimmed (a chop plays pieces of the whole sound, so there it is not)
        if (kind === "sample" && mode !== 1) {
            const a = s.sstart * w;
            const b = s.send * w;
            g.fillStyle = "rgba(10, 8, 6, 0.62)";
            g.fillRect(0, WAVE_TOP - 4, a, h - WAVE_TOP + 4);
            g.fillRect(b, WAVE_TOP - 4, w - b, h - WAVE_TOP + 4);
            g.fillStyle = withAlpha(GRAPH_TEXT, 0.95);
            g.fillRect(Math.round(a) - 1, WAVE_TOP - 4, 3, h - WAVE_TOP + 4);
            g.fillRect(Math.round(b) - 2, WAVE_TOP - 4, 3, h - WAVE_TOP + 4);
            viewText(g, "START", Math.min(w - 60, a + 6), WAVE_TOP + 14, "left", 0.9);
            viewText(g, "END", Math.max(40, b - 6), h - 12, "right", 0.9);
        }
        // the chops: a line where each starts, with its number (the key it is on counts up from BASE)
        if (kind === "chop" || mode === 1) {
            const bright = kind === "chop";
            let lastLabel = -100;
            view.chops.forEach((chop, i) => {
                const forward = st.chops[i] * view.ratio;
                const x = Math.round(xFor(forward));
                g.fillStyle = bright ? withAlpha(GRAPH_TEXT, i === 0 ? 0.55 : 0.95) : withAlpha(GRAPH_TEXT, 0.4);
                g.fillRect(x, WAVE_TOP - 4, i === 0 ? 2 : 3, h - WAVE_TOP + 4);
                if (bright && x - lastLabel >= 24) {
                    viewText(g, String(i + 1), x + 5, WAVE_TOP + 14, "left", 0.95);
                    lastLabel = x;
                }
            });
        }
    }

    // the words above
    const seconds = view.duration;
    if (kind === "mini") {
        viewText(g, st.name, 8, 20);
    } else {
        const stretched = view.ratio !== 1 || view.semis !== 0;
        viewText(g, st.name + "   " + seconds.toFixed(2) + " s" + (stretched ? "   MATCHED" : ""), 8, 20);
        const right = kind === "chop" ? (st.chops.length + " CHOPS ON " + noteLabel(sampleBase(s.sbase)) + " UP") : SAMPLE_MODES[mode];
        viewText(g, right, w - 8, 20, "right");
    }
    if (st.working !== null) {
        g.fillStyle = "rgba(10, 8, 6, 0.7)";
        g.fillRect(0, 0, w, h);
        viewText(g, "WORKING " + Math.round(st.working * 100) + "%", w / 2, h / 2 + 5, "center");
    }
    canvas.setAttribute("aria-label", "Waveform of " + st.name + ", " + seconds.toFixed(1) + " seconds" + (kind === "chop" ? ", with " + st.chops.length + " chops" : "") + ".");
}

// ---- the TUNE picture ----
function drawTunePicture(canvas) {
    const { g, w, h, accent } = viewSetup(canvas, 6, 3);
    const st = samplerState[liveTrack];
    const s = trackSettings[liveTrack];
    if (!st || !st.data) {
        viewText(g, "NO SOUND YET", w / 2, h / 2 + 5, "center", 0.8);
        canvas.setAttribute("aria-label", "The sampler has no sound yet.");
        return;
    }
    const a = st.analysis;
    const lines = [];
    const rootText = noteLabel(sampleRoot(s.sroot)) + (sampleFine(s.sfine) ? " " + (sampleFine(s.sfine) > 0 ? "+" : "") + sampleFine(s.sfine) + "c" : "");
    lines.push(["ROOT  " + rootText, 0.95]);
    if (!a) {
        lines.push(["PRESS ANALYSE", 0.7]);
    } else {
        lines.push([a.pitched ? "A NOTE  " + noteLabel(Math.round(a.note)) : "NOT A SINGLE NOTE", 0.85]);
        lines.push(["KEY  " + a.key.name + (a.key.score < 0.55 ? " ?  " : "  ") + Math.max(0, Math.round(a.key.score * 100)) + "%", 0.85]); // (a "?" when it is not sure: drums have no key)
        lines.push([a.beats ? a.beats + " BEATS  " + Math.round(a.bpm) + " BPM" : "NOT A LOOP", 0.85]);
    }
    lines.forEach(([text, alpha], i) => viewText(g, text, 10, 22 + i * 24, "left", alpha));

    // the twelve notes of the sound: how much it has of each. The key's own note is cream, and a dot under the notes of the song's scale
    const left = Math.round(w * 0.5);
    const right = w - 10;
    const bottom = h - 30;
    const top = 14;
    const slot = (right - left) / 12;
    const song = new Set(SCALES[ledScale].steps.map((step) => (ledRoot + step) % 12));
    for (let i = 0; i < 12; i++) {
        const level = a ? a.key.chroma[i] : 0;
        const x = left + i * slot;
        const bar = Math.max(2, level * (bottom - top));
        g.fillStyle = a && i === a.key.tonic ? withAlpha(GRAPH_TEXT, 0.95) : accent;
        g.fillRect(Math.round(x + 2), Math.round(bottom - bar), Math.max(3, Math.round(slot - 5)), Math.round(bar));
        if (song.has(i)) {
            g.fillStyle = "#f2a900";
            g.fillRect(Math.round(x + slot / 2 - 3), bottom + 6, 6, 6);
        }
        const black = [1, 3, 6, 8, 10].includes(i);
        viewText(g, black ? "#" : NOTE_NAMES[i], x + slot / 2, h - 8, "center", black ? 0.5 : 0.85);
    }
    canvas.setAttribute("aria-label", a ? "What was found in " + st.name + ": the key " + a.key.name + (a.beats ? ", " + a.beats + " beats" : "") + "." : "The sound has not been analysed yet.");
}

DIAL_VIEW_DRAWERS.sample = (canvas) => drawSamplePicture(canvas, "sample");
DIAL_VIEW_DRAWERS.chop = (canvas) => drawSamplePicture(canvas, "chop");
DIAL_VIEW_DRAWERS.tune = drawTunePicture;

// ---- dragging on the waveform ----
// the time (in the sound as it was loaded) under a pointer, from 0 to the duration
function timeAt(canvas, e) {
    const st = samplerState[liveTrack];
    const view = st && samplerView(liveTrack);
    if (!view) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return { fraction: x, original: (x * view.duration) / view.ratio, view };
}

// where a time is, snapped to the nearest place the wave crosses zero (so a chop does not start with a click)
function snapToZero(st, seconds) {
    const mono = monoOf(st.data);
    const rate = st.data.rate;
    const centre = Math.round(seconds * rate);
    const reach = Math.round(rate * 0.004);
    let best = centre;
    for (let d = 0; d <= reach; d++) {
        for (const at of [centre - d, centre + d]) {
            if (at > 0 && at < mono.length && mono[at - 1] <= 0 && mono[at] > 0) return at / rate;
        }
    }
    return best / rate;
}

function auditionChop(index) {
    if (sampleMode(trackSettings[liveTrack]) !== 1) return;
    getCtx();
    if (ctx.state === "suspended") ctx.resume();
    playNote(noteToFrequency(sampleBase(trackSettings[liveTrack].sbase) + index), ctx.currentTime, liveTrack);
}

(function setUpWaveDrags() {
    // SAMPLE: the START and END handles
    const sampleCanvas = dialViews.sample;
    let handle = null;
    sampleCanvas.addEventListener("pointerdown", (e) => {
        const at = timeAt(sampleCanvas, e);
        if (!at) return;
        const s = trackSettings[liveTrack];
        if (sampleMode(s) === 1) return; // (a chop plays pieces of the whole sound: its markers are on the CHOP tab)
        const rect = sampleCanvas.getBoundingClientRect();
        const distance = (value) => Math.abs(value - at.fraction) * rect.width;
        handle = distance(s.sstart) <= distance(s.send) ? "sstart" : "send";
        e.preventDefault();
        sampleCanvas.setPointerCapture(e.pointerId);
        moveHandle(at.fraction);
    });
    function moveHandle(fraction) {
        const s = trackSettings[liveTrack];
        const minGap = 0.002;
        if (handle === "sstart") setDialTo("dial-sstart", Math.min(fraction, s.send - minGap));
        else setDialTo("dial-send", Math.max(fraction, s.sstart + minGap));
    }
    sampleCanvas.addEventListener("pointermove", (e) => {
        if (!handle) return;
        const at = timeAt(sampleCanvas, e);
        if (at) moveHandle(at.fraction);
    });
    const letGo = () => (handle = null);
    sampleCanvas.addEventListener("pointerup", letGo);
    sampleCanvas.addEventListener("pointercancel", letGo);

    // CHOP: markers
    const chopCanvas = dialViews.chop;
    let dragged = -1;
    let moved = false;
    let lastMarkerPress = { marker: -1, time: 0 };
    const nearest = (e, st, view) => {
        const rect = chopCanvas.getBoundingClientRect();
        let best = -1;
        let bestDistance = 9;
        st.chops.forEach((start, i) => {
            const distance = Math.abs(((start * view.ratio) / view.duration) * rect.width - (e.clientX - rect.left));
            if (distance < bestDistance) {
                bestDistance = distance;
                best = i;
            }
        });
        return best;
    };
    chopCanvas.addEventListener("pointerdown", (e) => {
        const st = samplerState[liveTrack];
        const at = timeAt(chopCanvas, e);
        if (!st || !st.data || !at) return;
        e.preventDefault();
        const near = nearest(e, st, at.view);
        if (near > 0) {
            // a second press on the same marker soon after the first takes it away (not a dblclick event: a phone does not send one)
            const now = performance.now();
            if (lastMarkerPress.marker === st.chops[near] && now - lastMarkerPress.time < 350) {
                lastMarkerPress = { marker: -1, time: 0 };
                st.chops.splice(near, 1);
                rechop(liveTrack);
                samplerChanged(liveTrack, null);
                return;
            }
            lastMarkerPress = { marker: st.chops[near], time: now };
            dragged = near; // (the first chop always starts at the start)
            moved = false;
            chopCanvas.setPointerCapture(e.pointerId);
        } else if (near < 0 && st.chops.length < 64) {
            st.chops.push(snapToZero(st, at.original));
            rechop(liveTrack);
            const index = chopAt(st.chops, at.original);
            samplerChanged(liveTrack, null);
            auditionChop(index);
        }
    });
    chopCanvas.addEventListener("pointermove", (e) => {
        const st = samplerState[liveTrack];
        if (dragged < 0 || !st) return;
        const at = timeAt(chopCanvas, e);
        if (!at) return;
        moved = true;
        const low = (st.chops[dragged - 1] || 0) + 0.005;
        const high = (st.chops[dragged + 1] === undefined ? st.duration : st.chops[dragged + 1]) - 0.005;
        st.chops[dragged] = Math.min(high, Math.max(low, at.original));
        rechop(liveTrack);
        samplerChanged(liveTrack, null);
    });
    const finish = () => {
        const st = samplerState[liveTrack];
        if (dragged >= 0 && st && moved) {
            st.chops[dragged] = snapToZero(st, st.chops[dragged]);
            rechop(liveTrack);
            samplerChanged(liveTrack, null);
            auditionChop(dragged);
        }
        dragged = -1;
    };
    chopCanvas.addEventListener("pointerup", finish);
    chopCanvas.addEventListener("pointercancel", finish);
})();

// ---- the buttons ----
const sampleFileInput = document.createElement("input");
sampleFileInput.type = "file";
sampleFileInput.accept = "audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.webm";
sampleFileInput.hidden = true;
document.body.appendChild(sampleFileInput);
sampleFileInput.addEventListener("change", () => {
    const file = sampleFileInput.files && sampleFileInput.files[0];
    sampleFileInput.value = "";
    if (file && isSampler(liveTrack)) loadSampleFile(liveTrack, file);
});

let sampleButtons = {};

(function buildSamplerButtons() {
    const source = plateRow("SOURCE");
    const column = mk("div", "plate-buttons");
    const pair = mk("div", "plate-buttons row");
    sampleButtons.load = plateButton("LOAD", "Load a sound file into the sampler", () => sampleFileInput.click());
    sampleButtons.record = plateButton("RECORD", "Record a sound with the microphone", () => {
        if (recorder) stopRecording();
        else startRecording(liveTrack);
    });
    pair.append(sampleButtons.load, sampleButtons.record);
    sampleButtons.readout = mk("div", "sample-readout");
    sampleButtons.readout2 = mk("div", "sample-readout dim");
    column.append(pair, sampleButtons.readout, sampleButtons.readout2);
    source.appendChild(column);

    const auto = plateRow("AUTO");
    const grid = mk("div", "plate-buttons grid");
    sampleButtons.hits = plateButton("HITS", "Chop the sound at its hits", async () => {
        const st = samplerState[liveTrack];
        if (!st || !st.data) return;
        const times = findHits(monoOf(st.data), st.data.rate, trackSettings[liveTrack].ssens);
        st.chops = [0, ...times].slice(0, 64);
        rechop(liveTrack);
        trackSettings[liveTrack].smode = 0.5;
        showTrackSettings();
        samplerChanged(liveTrack, null);
    });
    const equal = (count) =>
        plateButton(String(count), "Chop the sound into " + count + " equal parts", () => {
            const st = samplerState[liveTrack];
            if (!st || !st.data) return;
            st.chops = equalChops(st.duration, count);
            rechop(liveTrack);
            trackSettings[liveTrack].smode = 0.5;
            showTrackSettings();
            samplerChanged(liveTrack, null);
        });
    sampleButtons.clear = plateButton("CLEAR", "Take away every chop but the first", () => {
        const st = samplerState[liveTrack];
        if (!st) return;
        st.chops = [0];
        rechop(liveTrack);
        samplerChanged(liveTrack, null);
    });
    grid.append(sampleButtons.hits, equal(4), equal(8), equal(16), sampleButtons.clear);
    auto.insertBefore(grid, auto.firstChild);

    const tune = plateRow("TUNE");
    const tuneColumn = mk("div", "plate-buttons");
    sampleButtons.analyse = plateButton("ANALYSE", "Look at the sound again to find its note, its key and its tempo", () => reanalyse(liveTrack));
    tuneColumn.appendChild(sampleButtons.analyse);
    tune.appendChild(tuneColumn);

    const match = plateRow("MATCH");
    const matchColumn = mk("div", "plate-buttons");
    sampleButtons.key = plateButton("KEY MATCH", "Move the sound into the key of the song", async () => {
        const st = samplerState[liveTrack];
        if (!st || !st.data) return;
        const s = trackSettings[liveTrack];
        if (sampleShift(s.sshift) !== 0) {
            setDialTo("dial-sshift", 0.5); // (pressed again: back to how it was)
            return;
        }
        if (!st.analysis) await reanalyse(liveTrack);
        setDialTo("dial-sshift", 0.5 + matchShift(st.analysis.key) / 24);
    });
    sampleButtons.tempo = plateButton("TEMPO MATCH", "Make the sound fit the tempo of the song", async () => {
        const st = samplerState[liveTrack];
        if (!st || !st.data) return;
        const s = trackSettings[liveTrack];
        if (sampleBeats(s.sbeats) > 0) {
            setDialTo("dial-sbeats", 0);
            return;
        }
        if (!st.analysis) await reanalyse(liveTrack);
        let beats = st.analysis.beats;
        if (!beats) beats = BEAT_CHOICES.slice(1).reduce((best, b) => (Math.abs(Math.log2((b * 60) / bpm / st.duration)) < Math.abs(Math.log2((best * 60) / bpm / st.duration)) ? b : best), 4);
        setDialTo("dial-sbeats", BEAT_CHOICES.indexOf(beats) / (BEAT_CHOICES.length - 1));
    });
    matchColumn.append(sampleButtons.key, sampleButtons.tempo);
    match.appendChild(matchColumn);
})();

// what the words and buttons say now (fx.js calls this when the dials change to another sound, sampler.js when something about a sampler changes)
let recordingTimer = 0;
let samplerRedrawQueued = false;
function refreshSamplerUi(track, quiet) {
    if (track !== undefined && track !== liveTrack) return;
    const st = samplerState[liveTrack];
    const s = trackSettings[liveTrack];
    const sampler = isSampler(liveTrack);
    if (sampler) {
        const recording = recorder !== null;
        sampleButtons.record.textContent = recording ? "STOP " + recordingSeconds().toFixed(1) + "s" : "RECORD";
        sampleButtons.record.setAttribute("aria-pressed", String(recording));
        if (recording && !recordingTimer) recordingTimer = setInterval(() => refreshSamplerUi(), 150);
        if (!recording && recordingTimer) {
            clearInterval(recordingTimer);
            recordingTimer = 0;
        }
        const message = st && st.message ? st.message : "";
        sampleButtons.readout.textContent = recording ? "RECORDING" : message || (st && st.name ? st.name : "NO SOUND");
        sampleButtons.readout2.textContent = st && st.data ? st.duration.toFixed(2) + " s  " + (st.data.channels.length > 1 ? "STEREO" : "MONO") + "  " + Math.round(st.data.rate / 100) / 10 + "k" : "";
        sampleButtons.key.setAttribute("aria-pressed", String(sampleShift(s.sshift) !== 0));
        sampleButtons.tempo.setAttribute("aria-pressed", String(sampleBeats(s.sbeats) > 0));
        const noSound = !st || !st.data;
        [sampleButtons.hits, sampleButtons.clear, sampleButtons.analyse, sampleButtons.key, sampleButtons.tempo].forEach((button) => (button.disabled = noSound));
        sampleButtons.load.disabled = recording;
        sampleButtons.record.disabled = !navigator.mediaDevices || typeof MediaRecorder === "undefined";
    }
    // (the picture is drawn again, but not more than once a frame: a bar being worked out says how far it is many times a second)
    if (!samplerRedrawQueued) {
        samplerRedrawQueued = true;
        requestAnimationFrame(() => {
            samplerRedrawQueued = false;
            if (typeof drawGraphs === "function") drawGraphs();
        });
    }
}

// ---- dropping a file on the dials box ----
dialPanel.addEventListener("dragover", (e) => {
    if (isSampler(liveTrack) && e.dataTransfer && [...e.dataTransfer.types].includes("Files")) {
        e.preventDefault();
        dialPanel.classList.add("dropping");
    }
});
dialPanel.addEventListener("dragleave", () => dialPanel.classList.remove("dropping"));
dialPanel.addEventListener("drop", (e) => {
    dialPanel.classList.remove("dropping");
    if (!isSampler(liveTrack) || !e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    loadSampleFile(liveTrack, e.dataTransfer.files[0]);
});

refreshSamplerUi();
drawDialViews();
