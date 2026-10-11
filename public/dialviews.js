// the picture on the left of each tab of the dials box (container 4). Each tab has one, built the same way: a dark panel with a top edge in
// the colour of the selected track, drawn from the dials of the selected sound, so it always shows what the dials are doing.
//   SOUND   the shape of the sound's wave (for a drum: how long it rings)
//   FILTER  the filter, with a handle you can drag: sideways for the cutoff, up and down for the resonance
//   EQ, ENV the editors in fx.js (synth.js draws them)
//   FX      the echoes (bars) and the room (a fading shade)
//   MOD     the vibrato and the tremolo as waves
//   MOVE    the chorus, the phaser and the flanger as the waves that sweep them
//   GRIT    the bit crusher as a stepped wave, the compressor as a line from the level in to the level out
//   PLAY    the chord or the arpeggio (or, on a drum, the roll)
// synth.js calls drawDialViews whenever a dial changes. This needs synth.js, drums.js and fx.js loaded first.

// the set-up of a picture: its canvas, the colour of the selected track on the panel's edge, and a faint grid
function viewSetup(canvas, across = 8, down = 4) {
    const { g, w, h } = prepGraph(canvas);
    const accent = graphAccent();
    canvas.parentElement.style.setProperty("--accent", accent);
    drawGrid(g, w, h, across, down, accent);
    g.textBaseline = "alphabetic";
    return { g, w, h, accent };
}

// words on a picture, in the cream of the others (16px)
function viewText(g, text, x, y, align = "left", alpha = 0.85) {
    g.font = "bold 16px Karla, sans-serif";
    g.textAlign = align;
    g.textBaseline = "alphabetic";
    g.fillStyle = withAlpha(GRAPH_TEXT, alpha);
    g.fillText(text, x, y);
}

// a round dot on a picture
function viewDot(g, x, y, radius, fill, accent) {
    g.beginPath();
    g.arc(x, y, radius, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = "#17130f";
    g.stroke();
}

// ---- SOUND ----
// one cycle of each kind of wave, from 0 to 1 round
const WAVES = {
    sine: (p) => Math.sin(2 * Math.PI * p),
    sawtooth: (p) => 2 * (p - Math.floor(p + 0.5)),
    square: (p) => (Math.sin(2 * Math.PI * p) >= 0 ? 1 : -1),
    triangle: (p) => 2 * Math.abs(2 * (p - Math.floor(p + 0.5))) - 1,
};

function drawSoundView(canvas) {
    if (isDrums()) {
        drawFadeGraph(canvas); // (a drum has no wave to show, so it shows how long it rings)
        return;
    }
    if (isSampler(liveTrack) && typeof drawSamplePicture === "function") {
        drawSamplePicture(canvas, "mini"); // (a sampler's wave is the sound that was loaded)
        return;
    }
    const { g, w, h, accent } = viewSetup(canvas, 6, 4);
    const sound = SOUNDS[trackSettings[liveTrack].sound];
    // the layers of the sound added together, three times round, as loud as they can be without leaving the picture
    const count = 240;
    const wave = Array.from({ length: count + 1 }, (_, i) =>
        sound.layers.reduce((sum, layer) => sum + WAVES[layer.type](((i / count) * 3) * 2 ** (layer.semitones / 12 + layer.cents / 1200)), 0)
    );
    const peak = Math.max(...wave.map(Math.abs)) || 1;
    const points = wave.map((v, i) => ({ x: (i / count) * w, y: h / 2 - (v / peak) * (h / 2 - EDITOR_PAD - 4) }));
    drawLine(g, points, h, accent, w);
    viewText(g, sound.name, 8, h - 8);
    canvas.setAttribute("aria-label", "Picture of the sound " + sound.name + ": the shape of its wave.");
}

// ---- LFO ----
// the three LFOs over two seconds, a lane each: the ones that move something are bright and the others dim (the matrix says what they move)
function drawLfoView(canvas) {
    const { g, w, h, accent } = viewSetup(canvas, 8, 3);
    const settings = trackSettings[liveTrack];
    const routes = modRoutes(settings);
    const laneH = (h - 8) / 3;
    for (let i = 1; i <= 3; i++) {
        const top = 4 + (i - 1) * laneH;
        const mid = top + laneH / 2 + 6;
        const amp = laneH / 2 - 16;
        const used = routes.some((r) => r[0] === i - 1);
        const shape = placeOf(settings["l" + i + "w"], LFO_SHAPES.length);
        const hz = lfoCycles(settings, i);
        const fade = lfoFadeSeconds(settings["l" + i + "f"]);
        const points = [];
        for (let k = 0; k <= 200; k++) {
            const t = (k / 200) * 2;
            let value = lfoWave(shape, t * hz, i * 101);
            if (fade > 0) value *= Math.min(1, t / fade);
            points.push({ x: (k / 200) * w, y: mid - value * amp });
        }
        g.globalAlpha = used ? 1 : 0.35;
        g.fillStyle = withAlpha(accent, 0.3);
        g.fillRect(0, Math.round(mid), w, 1);
        g.beginPath();
        points.forEach((p, k) => (k === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
        g.strokeStyle = accent;
        g.lineWidth = 2.5;
        g.lineJoin = "round";
        g.stroke();
        g.globalAlpha = 1;
        viewText(g, "LFO " + i + (used ? "" : "  not used"), 8, top + 17, "left", used ? 0.9 : 0.6);
    }
    canvas.setAttribute("aria-label", "Picture of the three LFOs as waves over two seconds.");
}

// an LFO's wave at this many cycles in: the same shapes as mod-worklet.js (the random ones are drawn as a fixed pattern)
function lfoWave(shape, cycles, seed) {
    const n = Math.floor(cycles);
    const p = cycles - n;
    const random = (k) => ((Math.sin(k * 127.1 + seed * 311.7) * 43758.5453) % 1 + 1) % 1;
    switch (shape) {
        case 0:
            return Math.sin(2 * Math.PI * p);
        case 1:
            return 1 - 4 * Math.abs(p - 0.5);
        case 2:
            return 2 * p - 1;
        case 3:
            return 1 - 2 * p;
        case 4:
            return p < 0.5 ? 1 : -1;
        case 5:
            return random(n) * 2 - 1;
        default:
            return (random(n) * 2 - 1) * (1 - p * p * (3 - 2 * p)) + (random(n + 1) * 2 - 1) * (p * p * (3 - 2 * p));
    }
}

// ---- MENV ----
// the two envelopes, a lane each, with the key let go a little over half way
function drawMenvView(canvas) {
    const { g, w, h, accent } = viewSetup(canvas, 8, 2);
    const settings = trackSettings[liveTrack];
    const routes = modRoutes(settings);
    const laneH = (h - 8) / 2;
    [2, 3].forEach((n, lane) => {
        const top = 4 + lane * laneH;
        const bottom = top + laneH - 10;
        const high = top + 24;
        const env = { attack: attackFromSlider(settings["v" + n + "a"]), decay: decayFromSlider(settings["v" + n + "d"]), sustain: sustainFromSlider(settings["v" + n + "s"]), release: releaseFromSlider(settings["v" + n + "r"]) };
        const hold = Math.max(0.2, 0.3 * (env.attack + env.decay + env.release));
        const letGo = env.attack + env.decay + hold;
        const total = (letGo + env.release) / 0.92;
        const used = routes.some((r) => r[0] === 2 + n);
        const points = [];
        for (let k = 0; k <= 200; k++) {
            const t = (k / 200) * total;
            let level = envelopeLevel(Math.min(t, letGo), env, 1);
            if (t > letGo) level *= Math.max(0, 1 - (t - letGo) / env.release) ** 2;
            points.push({ x: (k / 200) * w, y: bottom - level * (bottom - high) });
        }
        g.globalAlpha = used ? 1 : 0.35;
        drawLine(g, points, bottom + 2, accent, w);
        g.globalAlpha = 1;
        viewText(g, "ENV " + n + (used ? "" : "  not used"), 8, top + 18, "left", used ? 0.9 : 0.6);
    });
    canvas.setAttribute("aria-label", "Picture of the two envelopes.");
}

// ---- MATRIX ----
// a grid: a column for each source (what moves) and a row for each destination (what is moved). Each square holds how much, from minus to
// plus a hundred percent: a bar to the right (plus) or the left (minus) of the middle of the square. Click a square and drag up or down to set
// it. The grid is kept in the track's settings, as x<source>_<destination> (0.5 is nothing)
const MATRIX_LABEL_WIDTH = 92;
const MATRIX_HEADER = 26;
let matrixHover = null; // the square the pointer is over: { source, dest }

function matrixSquares(w, h) {
    const cw = (w - MATRIX_LABEL_WIDTH - 10) / MOD_SOURCES.length;
    const ch = (h - MATRIX_HEADER - 6) / MOD_DESTS.length;
    return { cw, ch };
}

const matrixAmount = (settings, source, dest) => (settings["x" + source + "_" + dest] - 0.5) * 2;

function drawMatrixView(canvas) {
    const { g, w, h, accent } = viewSetup(canvas, 1, 1);
    const settings = trackSettings[liveTrack];
    const { cw, ch } = matrixSquares(w, h);
    g.lineWidth = 1;
    g.fillStyle = withAlpha(accent, 0.16);
    for (let s = 0; s <= MOD_SOURCES.length; s++) g.fillRect(Math.round(MATRIX_LABEL_WIDTH + s * cw), MATRIX_HEADER - 4, 1, h - MATRIX_HEADER + 4);
    for (let d = 0; d <= MOD_DESTS.length; d++) g.fillRect(6, Math.round(MATRIX_HEADER + d * ch), w - 12, 1);
    MOD_SOURCES.forEach((name, s) => viewText(g, name, MATRIX_LABEL_WIDTH + (s + 0.5) * cw, 19, "center", 0.9));
    MOD_DESTS.forEach((name, d) => viewText(g, name, 10, MATRIX_HEADER + (d + 0.5) * ch + 5, "left", 0.9));
    for (let s = 0; s < MOD_SOURCES.length; s++) {
        for (let d = 0; d < MOD_DESTS.length; d++) {
            const x = MATRIX_LABEL_WIDTH + s * cw;
            const y = MATRIX_HEADER + d * ch;
            const amount = matrixAmount(settings, s, d);
            const hovered = matrixHover && matrixHover.source === s && matrixHover.dest === d;
            if (Math.abs(amount) > 0.005) {
                const half = Math.abs(amount) * (cw / 2 - 3);
                g.fillStyle = amount > 0 ? withAlpha(accent, 0.85) : withAlpha("#efe0bf", 0.85);
                g.fillRect(amount > 0 ? x + cw / 2 : x + cw / 2 - half, y + 3, half, ch - 6);
                g.font = "bold 16px Karla, sans-serif";
                g.textAlign = "center";
                g.textBaseline = "alphabetic";
                const text = (amount > 0 ? "+" : "-") + Math.round(Math.abs(amount) * 100);
                g.lineWidth = 3;
                g.strokeStyle = "rgba(23, 19, 15, 0.9)";
                g.strokeText(text, x + cw / 2, y + ch / 2 + 5);
                g.fillStyle = GRAPH_TEXT;
                g.fillText(text, x + cw / 2, y + ch / 2 + 5);
            } else {
                g.fillStyle = withAlpha(GRAPH_TEXT, hovered ? 0.7 : 0.18);
                g.beginPath();
                g.arc(x + cw / 2, y + ch / 2, 2.5, 0, Math.PI * 2);
                g.fill();
            }
            if (hovered) {
                g.lineWidth = 2;
                g.strokeStyle = GRAPH_TEXT;
                g.strokeRect(x + 1.5, y + 1.5, cw - 3, ch - 3);
            }
        }
    }
    canvas.setAttribute("aria-label", VIEW_MATRIX_LABEL);
}
const VIEW_MATRIX_LABEL = "The matrix. Each row is something that is moved and each column is what moves it: click a square and drag up or down to set how much. Double-click a square to clear it.";

// putting the matrix back to nothing (double-clicking its tab)
function resetPicture(id) {
    if (id !== "matrix") return;
    for (let s = 0; s < MOD_SOURCES.length; s++) for (let d = 0; d < MOD_DESTS.length; d++) trackSettings[liveTrack]["x" + s + "_" + d] = 0.5;
    drawGraphs();
}

(function setUpMatrixView() {
    const canvas = dialViews.matrix;
    let drag = null; // { source, dest, startY, startAmount }
    let lastDown = { time: 0, source: -1, dest: -1 };
    const squareAt = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scale = rect.width / canvas.offsetWidth;
        const x = (e.clientX - rect.left) / scale;
        const y = (e.clientY - rect.top) / scale;
        const { cw, ch } = matrixSquares(canvas.offsetWidth, canvas.offsetHeight);
        const source = Math.floor((x - MATRIX_LABEL_WIDTH) / cw);
        const dest = Math.floor((y - MATRIX_HEADER) / ch);
        return source >= 0 && source < MOD_SOURCES.length && dest >= 0 && dest < MOD_DESTS.length ? { source, dest } : null;
    };
    const setAmount = (source, dest, amount) => {
        const clamped = Math.max(-1, Math.min(1, Math.round(amount * 100) / 100));
        setSetting("x" + source + "_" + dest, (clamped + 1) / 2);
    };
    canvas.addEventListener("pointerdown", (e) => {
        const square = squareAt(e);
        if (!square) return;
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        const now = performance.now();
        const again = now - lastDown.time < 350 && lastDown.source === square.source && lastDown.dest === square.dest;
        lastDown = again ? { time: 0, source: -1, dest: -1 } : { time: now, source: square.source, dest: square.dest };
        if (again) {
            setAmount(square.source, square.dest, 0); // (double-click: nothing again)
            drag = null;
            return;
        }
        let amount = matrixAmount(trackSettings[liveTrack], square.source, square.dest);
        if (Math.abs(amount) < 0.005) {
            amount = 0.5; // (a click on an empty square starts it at half)
            setAmount(square.source, square.dest, amount);
        }
        drag = { ...square, startY: e.clientY, startAmount: amount };
    });
    canvas.addEventListener("pointermove", (e) => {
        if (drag) {
            const rect = canvas.getBoundingClientRect();
            const scale = rect.width / canvas.offsetWidth;
            setAmount(drag.source, drag.dest, drag.startAmount + (drag.startY - e.clientY) / scale / 70);
            return;
        }
        const square = squareAt(e);
        const same = (!square && !matrixHover) || (square && matrixHover && square.source === matrixHover.source && square.dest === matrixHover.dest);
        if (!same) {
            matrixHover = square;
            drawGraphs();
        }
    });
    const stop = () => (drag = null);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("pointerleave", () => {
        if (!drag && matrixHover) {
            matrixHover = null;
            drawGraphs();
        }
    });
})();

// ---- OSC ----
// the wave on top (with the pulse width and the sub wave added) and, under it, the copies of the unison as dots: from left to right is where
// each one is in the speakers (SPREAD) and from low to high is how far it is tuned from the note (DETUNE)
function drawOscView(canvas) {
    const { g, w, h, accent } = viewSetup(canvas, 6, 4);
    const settings = trackSettings[liveTrack];
    const sound = SOUNDS[settings.sound];
    const pw = pwFrom(settings.pw);
    const waveTop = EDITOR_PAD;
    const waveHeight = (h - EDITOR_PAD * 2) * 0.58;
    const count = 240;
    const cycles = 3;
    const wave = Array.from({ length: count + 1 }, (_, i) => {
        const t = (i / count) * cycles;
        let sum = sound.layers.reduce((total, layer) => {
            const phase = (t * 2 ** (layer.semitones / 12 + layer.cents / 1200)) % 1;
            // (a square is a pulse of this width with nothing added to it, as the worklet makes it)
            return total + (layer.type === "square" ? WAVES.sawtooth(phase) - WAVES.sawtooth((phase + pw) % 1) : WAVES[layer.type](phase));
        }, 0) / sound.layers.length;
        if (settings.sub > 0) sum += settings.sub * 0.5 * (((t / 2) % 1) < 0.5 ? 1 : -1);
        return sum;
    });
    const peak = Math.max(...wave.map(Math.abs), 0.001);
    const points = wave.map((v, i) => ({ x: (i / count) * w, y: waveTop + waveHeight / 2 - (v / peak) * (waveHeight / 2) }));
    drawLine(g, points, waveTop + waveHeight, accent, w);

    // the copies of the unison
    const copies = unisonFrom(settings.uni);
    const spread = settings.spread;
    const detune = detuneCents(settings.detune);
    const top = waveTop + waveHeight + 22;
    const bottom = h - 12;
    const order = copies % 7 === 0 ? 1 : 7;
    g.fillStyle = withAlpha(accent, 0.35);
    g.fillRect(12, Math.round((top + bottom) / 2), w - 24, 1);
    for (let i = 0; i < copies; i++) {
        const pitch = copies === 1 ? 0 : (i / (copies - 1)) * 2 - 1; // -1 (lowest) to 1 (highest)
        const place = copies === 1 ? 0 : (((i * order) % copies) / (copies - 1)) * 2 - 1;
        const x = w / 2 + place * spread * (w / 2 - 24);
        const y = (top + bottom) / 2 - pitch * Math.min(1, detune / 40) * ((bottom - top) / 2);
        viewDot(g, x, y, 6, i === 0 || i === copies - 1 ? GRAPH_TEXT : accent, accent);
    }
    viewText(g, copies === 1 ? sound.name : sound.name + "  x" + copies, 8, waveTop + waveHeight + 16);
    canvas.setAttribute("aria-label", "Picture of the oscillator: " + sound.name + ", " + copies + (copies === 1 ? " copy" : " copies") + " in the unison, " + Math.round(pw * 100) + " percent pulse width.");
}

// ---- FILTER ----
function drawFilterView(canvas) {
    drawFilterGraph(canvas, false, true);
}

// the handle: sideways is the cutoff, up and down is the resonance
(function setUpFilterView() {
    const canvas = dialViews.filter;
    let dragging = false;
    const setDial = (id, value) => {
        const input = document.getElementById(id);
        input.value = String(Math.min(1, Math.max(0, value)));
        input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const edit = (e) => {
        const rect = canvas.getBoundingClientRect();
        const pad = (EDITOR_PAD * rect.height) / canvas.offsetHeight;
        const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (e.clientY - rect.top - pad) / (rect.height - 2 * pad)));
        const hz = 20 * 1000 ** x; // (the picture's pitch runs 20Hz to 20kHz in even steps)
        setDial("cutoffSlider", Math.log(hz / 80) / Math.log(200)); // (the CUT dial runs 80Hz to 16kHz)
        const db = FILTER_VIEW_TOP - y * (FILTER_VIEW_TOP - FILTER_VIEW_BOTTOM);
        setDial("resonanceSlider", db / 12); // (the RES dial is 0 to 12dB)
    };
    canvas.addEventListener("pointerdown", (e) => {
        dragging = true;
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        edit(e);
    });
    canvas.addEventListener("pointermove", (e) => {
        if (dragging) edit(e);
    });
    const stop = () => (dragging = false);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
})();

// ---- FX ----
function drawFxView(canvas) {
    const { g, w, h, accent } = viewSetup(canvas, 8, 4);
    const s = selectedSettings();
    const delay = echoSeconds(s); // seconds between echoes
    const span = Math.max(delay * 5.6, 2.6); // the seconds across the picture
    const left = 16;
    const right = w - 12;
    const top = 40;
    const bottom = h - 34;
    const xFor = (t) => left + (t / span) * (right - left);
    const yFor = (level) => bottom - level * (bottom - top);

    // the room: a shade that fades away over a couple of seconds (how much is REV)
    const room = s.rev * 0.8;
    const roomSeconds = ROOM_SIZES[placeOf(s.rsize === undefined ? 0.5 : s.rsize, ROOM_SIZES.length)].seconds;
    const wait = roomPreSeconds(s.rpre || 0);
    const shade = [{ x: xFor(0), y: bottom }];
    for (let i = 0; i <= 60; i++) {
        const t = (i / 60) * span;
        // (the shade starts after the pre delay and fades over the length of the room; a duller room is a little lower)
        const dull = 1 - 0.35 * (1 - (s.rdamp === undefined ? 1 : s.rdamp));
        shade.push({ x: xFor(t), y: yFor(t < wait ? 0 : room * dull * Math.exp(-(t - wait) / (roomSeconds * 0.3))) });
    }
    shade.push({ x: xFor(span), y: bottom });
    g.beginPath();
    shade.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.closePath();
    g.fillStyle = withAlpha(accent, 0.3);
    g.fill();

    // the sound and its echoes as bars: the first is the sound itself, then each echo is quieter (how loud and how many is DLY and DFB)
    g.fillStyle = withAlpha(GRAPH_TEXT, 0.9);
    g.fillRect(Math.round(xFor(0)) - 4, yFor(1), 8, bottom - yFor(1));
    for (let n = 1; n < 40; n++) {
        const t = n * delay;
        const level = s.dly * 0.8 * (s.dfb * 0.85) ** (n - 1);
        if (t > span || level < 0.02) break;
        // (with PING the echoes take turns: the left speaker's are the colour of the track, the right speaker's are cream)
        g.fillStyle = placeOf(s.dping || 0, 2) && n % 2 === 0 ? withAlpha(GRAPH_TEXT, 0.65) : accent;
        g.fillRect(Math.round(xFor(t)) - 4, yFor(level), 8, bottom - yFor(level));
    }
    g.fillStyle = withAlpha(accent, 0.5);
    g.fillRect(left - 4, bottom, right - left + 8, 2);
    viewText(g, "ECHO " + DELAY_NAMES[delayIndex(s.dtime)] + (placeOf(s.dping || 0, 2) ? " PING" : ""), 8, 24);
    viewText(g, ROOM_SIZES[placeOf(s.rsize === undefined ? 0.5 : s.rsize, ROOM_SIZES.length)].name + " " + Math.round(s.rev * 100) + "%", w - 8, 24, "right");
    canvas.setAttribute("aria-label", "Picture of the echo, every " + DELAY_NAMES[delayIndex(s.dtime)] + ", and the room at " + Math.round(s.rev * 100) + " percent.");
}

// ---- MOD ----
function drawModView(canvas) {
    const { g, w, h, accent } = viewSetup(canvas, 8, 4);
    const s = selectedSettings();
    const drums = isDrums();
    const seconds = 2; // the time across the picture
    // a lane for the vibrato (a synth's pitch swinging) over a lane for the tremolo (the volume swinging); a drum has only the tremolo
    const lanes = drums ? [["TREMOLO", tremRateHz(s.trate), s.tdep, true]] : [["VIBRATO", vibRateHz(s.vrate), s.vdep, false], ["TREMOLO", tremRateHz(s.trate), s.tdep, true]];
    const laneH = (h - 12) / lanes.length;
    lanes.forEach(([name, rate, depth, tremolo], i) => {
        const top = 6 + i * laneH;
        const a = top + 30; // the room for the wave in this lane: from a (the top) down to b
        const b = top + laneH - 6;
        const points = [];
        for (let k = 0; k <= 200; k++) {
            const wave = Math.sin(2 * Math.PI * rate * ((k / 200) * seconds));
            // vibrato: the pitch swings up and down round the middle. Tremolo: the volume goes between full and one less than the depth
            const y = tremolo ? b - (1 - depth / 2 + (depth / 2) * wave) * (b - a) : (a + b) / 2 - ((b - a) / 2) * depth * wave;
            points.push({ x: (k / 200) * w, y });
        }
        g.fillStyle = withAlpha(accent, 0.3);
        g.fillRect(0, Math.round(tremolo ? a : (a + b) / 2), w, 1); // (full volume, or the middle)
        g.beginPath();
        points.forEach((p, k) => (k === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
        g.strokeStyle = accent;
        g.lineWidth = 2.5;
        g.lineJoin = "round";
        g.stroke();
        viewText(g, name + "  " + rate.toFixed(1) + " Hz", 8, top + 20);
    });
    canvas.setAttribute("aria-label", "Picture of the " + lanes.map((lane) => lane[0].toLowerCase()).join(" and the ") + " as waves.");
}

// ---- MOVE ----
// the chorus, the phaser and the flanger, a lane each: the wave that sweeps it over two seconds (DEPTH is how tall, MIX how bright)
function drawMoveView(canvas) {
    const { g, w, h, accent } = viewSetup(canvas, 8, 3);
    const s = selectedSettings();
    const lanes = [["CHORUS", s.chmix, s.chrate, s.chdep], ["PHASER", s.phmix, s.phrate, s.phdep], ["FLANGER", s.flmix, s.flrate, s.fldep]];
    const laneH = (h - 8) / lanes.length;
    lanes.forEach(([name, mix, rate, depth], i) => {
        const top = 4 + i * laneH;
        const mid = top + laneH / 2 + 8;
        const amp = Math.max(2, laneH / 2 - 18) * (0.25 + 0.75 * depth);
        const on = mix > 0.001;
        g.fillStyle = withAlpha(accent, on ? 0.35 : 0.15);
        g.fillRect(0, Math.round(mid), w, 1);
        g.beginPath();
        for (let k = 0; k <= 200; k++) {
            const x = (k / 200) * w;
            const y = mid - amp * Math.sin(2 * Math.PI * rackRateHz(rate) * ((k / 200) * 2));
            if (k === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
        }
        g.strokeStyle = on ? accent : withAlpha(accent, 0.3);
        g.lineWidth = 2.5;
        g.lineJoin = "round";
        g.stroke();
        viewText(g, name + "  " + (on ? Math.round(mix * 100) + "%  " + rackRateHz(rate).toFixed(1) + " Hz" : "OFF"), 8, top + 20, "left", on ? 0.9 : 0.5);
    });
    canvas.setAttribute("aria-label", "Picture of the chorus, the phaser and the flanger as the waves that sweep them.");
}

// ---- GRIT ----
// the crusher on the left: a wave cut into steps (BITS) and held (HOLD); the compressor on the right: the level that goes in against the level
// that comes out, a bend at the threshold
function drawGritView(canvas) {
    const { g, w, h, accent } = viewSetup(canvas, 8, 4);
    const s = selectedSettings();
    const half = Math.floor(w / 2) - 8;
    const top = 40;
    const bottom = h - 30;

    // the crusher
    const crushOn = s.crmix > 0.001;
    const levels = 2 ** crushBits(s.crbits) / 2;
    const every = crushHold(s.crhold);
    const mid = (top + bottom) / 2;
    const amp = (bottom - top) / 2;
    const points = [];
    let held = 0;
    for (let k = 0; k <= 160; k++) {
        const wave = Math.sin(2 * Math.PI * 1.5 * (k / 160));
        const stepped = crushOn ? Math.round(wave * levels) / levels : wave;
        if (k % Math.max(1, Math.round(every / 2)) === 0) held = stepped; // (the picture is not at the song's sample rate, so the hold is a fraction of it)
        const v = crushOn ? held : wave;
        const x = 8 + (k / 160) * (half - 16);
        points.push({ x, y: mid - v * amp });
    }
    g.fillStyle = withAlpha(accent, 0.25);
    g.fillRect(8, Math.round(mid), half - 16, 1);
    g.beginPath();
    points.forEach((p, k) => {
        if (k === 0) g.moveTo(p.x, p.y);
        else {
            g.lineTo(p.x, points[k - 1].y);
            g.lineTo(p.x, p.y);
        }
    });
    g.strokeStyle = crushOn ? accent : withAlpha(accent, 0.3);
    g.lineWidth = 2.5;
    g.lineJoin = "miter";
    g.stroke();
    viewText(g, crushOn ? "CRUSH " + crushBits(s.crbits) + " BITS" : "CRUSH OFF", 8, 24, "left", crushOn ? 0.9 : 0.5);

    // the compressor: input level on the way across (-60dB to 0), output level up; the dim line is no change
    const left = half + 24;
    const right = w - 14;
    const xFor = (db) => left + ((db + 60) / 60) * (right - left);
    const yFor = (db) => bottom - ((Math.max(-60, db) + 60) / 60) * (bottom - top);
    const compOn = s.cpmix > 0.001;
    const threshold = compThreshold(s.cpthr);
    const ratio = compRatio(s.cpratio);
    const out = (db) => {
        const over = db - threshold;
        let reduction = 0;
        if (over > 3) reduction = over * (1 - 1 / ratio);
        else if (over > -3) reduction = ((over + 3) * (over + 3) * (1 - 1 / ratio)) / 12;
        const compressed = db - reduction + (-threshold * (1 - 1 / ratio) * 0.6);
        return db * (1 - s.cpmix) + compressed * s.cpmix;
    };
    g.beginPath();
    g.moveTo(xFor(-60), yFor(-60));
    g.lineTo(xFor(0), yFor(0));
    g.strokeStyle = withAlpha(GRAPH_TEXT, 0.25);
    g.lineWidth = 1.5;
    g.stroke();
    g.beginPath();
    for (let k = 0; k <= 60; k++) {
        const db = -60 + k;
        const p = { x: xFor(db), y: Math.max(top - 6, yFor(out(db))) };
        if (k === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
    }
    g.strokeStyle = compOn ? accent : withAlpha(accent, 0.3);
    g.lineWidth = 2.5;
    g.stroke();
    if (compOn) viewDot(g, xFor(threshold), yFor(out(threshold)), 6, GRAPH_TEXT, accent);
    viewText(g, compOn ? "COMP " + compRatio(s.cpratio).toFixed(1) + ":1  " + Math.round(threshold) + "dB" : "COMP OFF", left - 8, 24, "left", compOn ? 0.9 : 0.5);
    canvas.setAttribute("aria-label", "Picture of the bit crusher as a stepped wave and of the compressor as a line from the level that goes in to the level that comes out.");
}

// ---- PLAY ----
function drawPlayView(canvas) {
    const { g, w, h, accent } = viewSetup(canvas, 8, 4);
    const left = 20;
    const right = w - 20;
    const top = 40;
    const bottom = h - 34;

    if (isDrums()) {
        // the roll: the hits across two beats, each as tall as it is hard (BUILD starts it soft)
        const fx = drumFxAt(selectedDrumNote);
        const rate = placeOf(fx.roll, ROLL_RATES.length);
        const hits = rate === 0 ? 1 : Math.min(32, Math.floor(2 / ROLL_RATES[rate].beats));
        const start = 1 - 0.85 * fx.build;
        const slot = (right - left) / Math.max(hits, 1);
        for (let i = 0; i < hits; i++) {
            const level = hits > 1 ? start + (1 - start) * (i / (hits - 1)) : 1;
            const bar = Math.max(3, Math.min(14, slot * 0.6));
            g.fillStyle = i === 0 ? withAlpha(GRAPH_TEXT, 0.9) : accent;
            g.fillRect(Math.round(left + i * slot), bottom - level * (bottom - top), bar, level * (bottom - top));
        }
        g.fillStyle = withAlpha(accent, 0.5);
        g.fillRect(left - 4, bottom, right - left + 8, 2);
        viewText(g, rate === 0 ? "ROLL OFF" : "ROLL " + ROLL_RATES[rate].name + (fx.build > 0.02 ? "  BUILD " + Math.round(fx.build * 100) + "%" : ""), 8, 24);
        canvas.setAttribute("aria-label", rate === 0 ? "Picture of the roll: it is off, one hit." : "Picture of the roll: " + hits + " hits over two beats.");
        return;
    }

    // a chord and an arpeggio: the notes as dots, higher notes higher up. A chord is a stack, an arpeggio spreads them out in time
    const settings = trackSettings[liveTrack];
    const chord = CHORDS[placeOf(settings.chord, CHORDS.length)];
    const mode = placeOf(settings.arp, ARP_MODES.length);
    const rateName = ARP_RATES[placeOf(settings.arate, ARP_RATES.length)].name;
    const tones = chord.steps.length > 1 ? chord.steps : [0, 12, 24];
    const yFor = (semitones) => bottom - (semitones / 24) * (bottom - top);
    if (mode === 0) {
        const x = (left + right) / 2;
        chord.steps.forEach((semis) => viewDot(g, x, yFor(semis), 9, semis === 0 ? GRAPH_TEXT : accent, accent));
    } else {
        const steps = 8;
        const slot = (right - left) / steps;
        const points = Array.from({ length: steps }, (_, i) => {
            // (a random one is shown as a fixed jumble, it is different every time it plays)
            const semis = mode === 4 ? tones[(i * 5 + 2) % tones.length] : arpOffset(tones, mode, i);
            return { x: left + slot * (i + 0.5), y: yFor(semis) };
        });
        g.beginPath();
        points.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
        g.strokeStyle = withAlpha(accent, 0.55);
        g.lineWidth = 2;
        g.stroke();
        points.forEach((p) => viewDot(g, p.x, p.y, 9, accent, accent));
    }
    viewText(g, "CHORD " + chord.name + "   ARP " + ARP_MODES[mode] + (mode === 0 ? "" : " " + rateName), 8, 24);
    canvas.setAttribute("aria-label", "Picture of the chord " + chord.name + " and the arpeggio " + ARP_MODES[mode] + ".");
}

// draws the picture of the tab that is showing (the others are hidden, and have no size to draw into), and the colour of the bar
const DIAL_VIEW_DRAWERS = { lfo: drawLfoView, menv: drawMenvView, matrix: drawMatrixView, sound: drawSoundView, osc: drawOscView, filter: drawFilterView, fx: drawFxView, mod: drawModView, move: drawMoveView, grit: drawGritView, play: drawPlayView };

function drawDialViews() {
    if (typeof dialBar === "undefined" || !dialBar) return;
    dialBar.el.style.setProperty("--accent", graphAccent());
    const draw = DIAL_VIEW_DRAWERS[dialTab];
    if (draw && dialViews[dialTab]) draw(dialViews[dialTab]);
}

drawDialViews();
