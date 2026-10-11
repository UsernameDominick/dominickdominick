// the picture on the left of each tab of the dials box (container 4). Each tab has one, built the same way: a dark panel with a top edge in
// the colour of the selected track, drawn from the dials of the selected sound, so it always shows what the dials are doing.
//   SOUND   the shape of the sound's wave (for a drum: how long it rings)
//   FILTER  the filter, with a handle you can drag: sideways for the cutoff, up and down for the resonance
//   EQ, ENV the editors in fx.js (synth.js draws them)
//   FX      the echoes (bars) and the room (a fading shade)
//   MOD     the vibrato and the tremolo as waves
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
    const shade = [{ x: xFor(0), y: bottom }];
    for (let i = 0; i <= 60; i++) {
        const t = (i / 60) * span;
        shade.push({ x: xFor(t), y: yFor(room * Math.exp(-t / 0.7)) });
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
        g.fillStyle = accent;
        g.fillRect(Math.round(xFor(t)) - 4, yFor(level), 8, bottom - yFor(level));
    }
    g.fillStyle = withAlpha(accent, 0.5);
    g.fillRect(left - 4, bottom, right - left + 8, 2);
    viewText(g, "ECHO " + DELAY_NAMES[delayIndex(s.dtime)], 8, 24);
    viewText(g, "ROOM " + Math.round(s.rev * 100) + "%", w - 8, 24, "right");
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
const DIAL_VIEW_DRAWERS = { sound: drawSoundView, osc: drawOscView, filter: drawFilterView, fx: drawFxView, mod: drawModView, play: drawPlayView };

function drawDialViews() {
    if (typeof dialBar === "undefined" || !dialBar) return;
    dialBar.el.style.setProperty("--accent", graphAccent());
    const draw = DIAL_VIEW_DRAWERS[dialTab];
    if (draw && dialViews[dialTab]) draw(dialViews[dialTab]);
}

drawDialViews();
