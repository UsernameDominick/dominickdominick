// AUTOMATION: a dial that moves by itself while the song plays. Under each synth track the lane (the arrow on its header) has an AUTO tab: pick a
// dial from the list and draw how it goes over the song, as points joined by straight lines (click to add a point, drag it to move it, press on it
// twice to take it away). While the song plays (and in the file it is made into) the dial follows the line: it is flat before the first point and
// after the last. When the song stops every dial goes back to where you had it, and that is what a saved song keeps.
// Any dial that is a smooth 0 to 1 can be drawn (not the ones that click from one choice to the next). The drums have none: each drum has its own
// dials, and the track only has its volume.
// This needs fx.js (the list of dials) and is used by studio.js (the lane), save.js (a song keeps it) and export.js (the file follows it).

const AUTO_MAX_POINTS = 64;
const AUTO_STEP = 1 / 8; // a point snaps to an eighth of a beat

// the lines: automation[track][key] is a list of [beat, value], in order of beat (the beat is counted from the start of the song)
const automation = Array.from({ length: MAX_TRACKS }, () => ({}));
// what a dial was before the song moved it, so that it can go back (and a saved song has the dial where you left it)
const autoBase = Array.from({ length: MAX_TRACKS }, () => ({}));
const autoLast = Array.from({ length: MAX_TRACKS }, () => ({})); // the value last given to each dial, so a dial that has not moved is not set again

// the dials that can be drawn: { key (what the track keeps it as), label (like FILTER CUT), spec (the dial: how to write its value) }
let automatable = null;

function automatableList() {
    if (automatable) return automatable;
    automatable = [];
    const seen = new Set();
    DIALS.forEach((spec) => {
        if (spec.scope === "drums" || spec.step || spec.slider) return; // (a drum's own dial, or a dial that clicks from one choice to the next)
        let key = spec.key || (spec.id === "gainSlider" ? "volume" : null);
        if (!key) return;
        if (TRACK_SETTING_KEYS[key]) key = TRACK_SETTING_KEYS[key];
        if (seen.has(key) || SAMPLER_KEYS.has(key)) return;
        seen.add(key);
        const tab = DIAL_TABS.find((t) => t.id === spec.group);
        automatable.push({ key, label: (tab ? tab.name + " " : "") + spec.label, spec });
    });
    return automatable;
}

function autoEntry(key) {
    return automatableList().find((entry) => entry.key === key);
}

// ---- following a line ----
function autoValueAt(points, beat) {
    if (!points.length) return null;
    if (beat <= points[0][0]) return points[0][1];
    const last = points[points.length - 1];
    if (beat >= last[0]) return last[1];
    for (let i = 1; i < points.length; i++) {
        if (beat <= points[i][0]) {
            const a = points[i - 1];
            const b = points[i];
            return b[0] === a[0] ? b[1] : a[1] + ((b[1] - a[1]) * (beat - a[0])) / (b[0] - a[0]);
        }
    }
    return last[1];
}

function automationUsed(t) {
    return Object.keys(automation[t]).some((key) => automation[t][key].length > 0);
}

function anyAutomation() {
    for (let t = 0; t < MAX_TRACKS; t++) if (automationUsed(t)) return true;
    return false;
}

// gives a dial a value from its line (and remembers where it was)
function applyAutomated(t, key, v) {
    const s = trackSettings[t];
    if (!(key in autoBase[t])) autoBase[t][key] = s[key];
    s[key] = v;
    if (!ctx) return;
    if (key === "volume") {
        if (trackGains[t]) trackGains[t].gain.setTargetAtTime(v, ctx.currentTime, 0.015);
    } else {
        applyFx(t);
        applyFilter(t);
    }
}

// sets every dial that has a line to what its line says at this beat of the song
function runAutomation(beat) {
    let shown = false;
    for (let t = 0; t < TRACKS; t++) {
        if (t === DRUM_TRACK) continue;
        const lines = automation[t];
        for (const key in lines) {
            const v = autoValueAt(lines[key], beat);
            if (v === null) continue;
            if (autoLast[t][key] !== undefined && Math.abs(autoLast[t][key] - v) < 0.0005) continue;
            autoLast[t][key] = v;
            applyAutomated(t, key, v);
            if (t === liveTrack) shown = true;
            if (key === "volume" && typeof paintTrackVolume === "function") paintTrackVolume(t);
        }
    }
    if (shown && !renderingOffline) showAutomatedDials();
}

// the dials of the selected track turn with their lines (without setting them: that would make where they are now the place they go back to)
function showAutomatedDials() {
    const lines = automation[liveTrack];
    dialEntries.forEach(({ spec, input, strip, box }) => {
        let key = spec.key || (spec.id === "gainSlider" ? "volume" : null);
        if (key && TRACK_SETTING_KEYS[key]) key = TRACK_SETTING_KEYS[key];
        if (!key || !lines[key] || !lines[key].length || box.hidden) return;
        input.value = String(trackSettings[liveTrack][key]);
        strip.update();
    });
}

// the song has stopped (or the file is made): every dial goes back to where it was
function endAutomation() {
    for (let t = 0; t < MAX_TRACKS; t++) {
        const keys = Object.keys(autoBase[t]);
        if (!keys.length) continue;
        keys.forEach((key) => (trackSettings[t][key] = autoBase[t][key]));
        autoBase[t] = {};
        autoLast[t] = {};
        if (ctx) {
            if (keys.includes("volume") && trackGains[t]) trackGains[t].gain.setTargetAtTime(trackSettings[t].volume, ctx.currentTime, 0.015);
            applyFx(t);
            applyFilter(t);
        }
        if (typeof paintTrackVolume === "function") paintTrackVolume(t);
    }
    if (typeof showTrackSettings === "function" && !renderingOffline) showTrackSettings();
}

// ---- in a song ----
// the settings of a track as the song keeps them: the dials where you left them, not where a line has moved them to
function settingsWithoutAutomation(t) {
    return { ...trackSettings[t], ...autoBase[t] };
}

function automationOf(t) {
    const out = {};
    for (const key in automation[t]) if (automation[t][key].length) out[key] = automation[t][key].map((p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]);
    return out;
}

// the lines of a song from a file or the browser's storage, made safe (a file can be anything)
function cleanAutomation(raw) {
    const clean = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return clean;
    let lines = 0;
    for (const key of Object.keys(raw)) {
        if (!autoEntry(key) || !Array.isArray(raw[key]) || lines >= 40) continue;
        const points = [];
        raw[key].slice(0, AUTO_MAX_POINTS).forEach((p) => {
            if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number" || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
            points.push([Math.min(MAX_BARS * BEATS, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))]);
        });
        points.sort((a, b) => a[0] - b[0]);
        const unique = points.filter((p, i) => i === 0 || p[0] > points[i - 1][0]);
        if (unique.length) {
            clean[key] = unique;
            lines++;
        }
    }
    return clean;
}

// puts the lines of a song (clean) on the tracks
function showAutomation(lists) {
    for (let t = 0; t < MAX_TRACKS; t++) {
        automation[t] = lists && lists[t] ? lists[t] : {};
        autoBase[t] = {};
        autoLast[t] = {};
    }
    if (typeof refreshAutomationLanes === "function") refreshAutomationLanes();
}

// ---- the lane ----
const AUTO_PAD = 7; // the line and its points keep this far from the top and the bottom of the lane

function fillAutoSelect(lane) {
    const select = lane.autoSelect;
    select.innerHTML = "";
    automatableList().forEach((entry) => {
        const option = document.createElement("option");
        option.value = entry.key;
        option.textContent = entry.label + (automation[lane.t][entry.key] && automation[lane.t][entry.key].length ? "  *" : "");
        select.appendChild(option);
    });
    select.value = lane.autoKey;
}

function drawAutomationCell(lane, b) {
    const { el, canvas } = lane.cells[b];
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = (window.devicePixelRatio || 1) * uiScale;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bars = clipBars(lane.t, b);
    const barW = w / bars;
    const key = lane.autoKey;
    const points = automation[lane.t][key] || [];
    const entry = autoEntry(key);
    const from = b * BEATS;
    const to = (b + bars) * BEATS;
    const xFor = (beat) => ((beat - from) / (to - from)) * w;
    const yFor = (v) => AUTO_PAD + (1 - v) * (h - 2 * AUTO_PAD);

    // faint lines at the beats, a stronger one between bars (as in the other lanes)
    g.fillStyle = "white";
    for (let rep = 0; rep < bars; rep++) {
        g.globalAlpha = LINE_BEAT;
        for (let beat = 1; beat < BEATS; beat++) g.fillRect(Math.round(rep * barW + (beat / BEATS) * barW), 0, 1, h);
        g.globalAlpha = LINE_BAR;
        if (rep > 0) g.fillRect(Math.round(rep * barW), 0, 2, h);
    }
    g.globalAlpha = 1;

    if (!points.length) {
        // nothing drawn yet: a dashed line where the dial is now, and what to do
        const base = trackSettings[lane.t][key];
        g.strokeStyle = "rgba(255, 243, 220, 0.35)";
        g.lineWidth = 2;
        g.setLineDash([6, 6]);
        g.beginPath();
        g.moveTo(0, yFor(base));
        g.lineTo(w, yFor(base));
        g.stroke();
        g.setLineDash([]);
        if (b === 0) {
            g.font = "bold 16px Karla, sans-serif";
            g.fillStyle = "rgba(255, 243, 220, 0.85)";
            g.textBaseline = "top";
            g.fillText("CLICK TO DRAW " + (entry ? entry.label : ""), 8, 5);
        }
        el.setAttribute("aria-label", "Bar " + (b + 1) + ": no line drawn. Press in the lane to add a point to the line for " + (entry ? entry.label.toLowerCase() : "a dial"));
        return;
    }

    // the line over this box: where it is at the left edge, each point inside, and where it is at the right edge
    const path = [[from, autoValueAt(points, from)]];
    points.forEach((p) => {
        if (p[0] > from && p[0] < to) path.push(p);
    });
    path.push([to, autoValueAt(points, to)]);
    g.beginPath();
    path.forEach((p, i) => (i === 0 ? g.moveTo(xFor(p[0]), yFor(p[1])) : g.lineTo(xFor(p[0]), yFor(p[1]))));
    g.lineTo(xFor(to), h);
    g.lineTo(xFor(from), h);
    g.closePath();
    g.fillStyle = "rgba(242, 169, 0, 0.18)";
    g.fill();
    g.beginPath();
    path.forEach((p, i) => (i === 0 ? g.moveTo(xFor(p[0]), yFor(p[1])) : g.lineTo(xFor(p[0]), yFor(p[1]))));
    g.strokeStyle = "#f2a900";
    g.lineWidth = 2.5;
    g.lineJoin = "round";
    g.stroke();
    points.forEach((p) => {
        if (p[0] < from || p[0] > to) return;
        g.beginPath();
        g.arc(xFor(p[0]), yFor(p[1]), 5.5, 0, Math.PI * 2);
        g.fillStyle = "#fff3dc";
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = "#17130f";
        g.stroke();
    });
    el.setAttribute("aria-label", "Bar " + (b + 1) + ": a line for " + (entry ? entry.label.toLowerCase() : "a dial") + " with " + points.length + " points");
}

function drawAutomationLane(lane) {
    for (let b = 0; b < BARS; b++) drawParamCell(lane, b);
}

// the places of a lane's boxes on the screen, to turn where a pointer is into a beat of the song (and back)
function laneBeat(lane, clientX) {
    let best = null;
    lane.cells.forEach(({ el }, b) => {
        if (el.offsetWidth === 0) return; // (hidden under a longer block)
        const rect = el.getBoundingClientRect();
        const distance = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
        if (!best || distance < best.distance) best = { distance, rect, b };
    });
    if (!best) return 0;
    const bars = clipBars(lane.t, best.b);
    const across = Math.min(1, Math.max(0, (clientX - best.rect.left) / best.rect.width));
    return best.b * BEATS + across * bars * BEATS;
}

function laneValue(lane, clientY) {
    const rect = lane.cells[0].el.getBoundingClientRect();
    return Math.min(1, Math.max(0, 1 - (clientY - rect.top - AUTO_PAD) / (rect.height - 2 * AUTO_PAD)));
}

// where a point is on the screen, for finding the one under a pointer
function pointOnScreen(lane, p) {
    let found = null;
    lane.cells.forEach(({ el }, b) => {
        if (el.offsetWidth === 0) return;
        const bars = clipBars(lane.t, b);
        if (p[0] < b * BEATS || p[0] > (b + bars) * BEATS) return;
        const rect = el.getBoundingClientRect();
        found = { x: rect.left + ((p[0] - b * BEATS) / (bars * BEATS)) * rect.width, y: rect.top + AUTO_PAD + (1 - p[1]) * (rect.height - 2 * AUTO_PAD) };
    });
    return found;
}

let autoDrag = null; // { lane, points, point } while a point is being dragged
let lastAutoPress = { point: null, time: 0 };

function autoPointerDown(lane, e, el) {
    const key = lane.autoKey;
    const list = automation[lane.t][key] || (automation[lane.t][key] = []);
    // the point under the pointer, if there is one (within a fingertip)
    let near = null;
    let nearDistance = 20;
    list.forEach((p) => {
        const at = pointOnScreen(lane, p);
        if (!at) return;
        const distance = Math.hypot(at.x - e.clientX, at.y - e.clientY);
        if (distance < nearDistance) {
            nearDistance = distance;
            near = p;
        }
    });
    const now = performance.now();
    if (near) {
        // pressed on it twice (not a dblclick event: a phone sends none): it is taken away
        if (lastAutoPress.point === near && now - lastAutoPress.time < 350) {
            list.splice(list.indexOf(near), 1);
            lastAutoPress = { point: null, time: 0 };
            autoChanged(lane);
            return;
        }
        lastAutoPress = { point: near, time: now };
        autoDrag = { lane, list, point: near };
    } else if (list.length < AUTO_MAX_POINTS) {
        const beat = Math.min(BARS * BEATS, Math.round(laneBeat(lane, e.clientX) / AUTO_STEP) * AUTO_STEP);
        const value = laneValue(lane, e.clientY);
        const same = list.find((p) => p[0] === beat);
        let point = same;
        if (same) {
            same[1] = value; // (a point is already there: it moves)
        } else {
            point = [beat, value];
            list.push(point);
            list.sort((p, q) => p[0] - q[0]);
        }
        autoDrag = { lane, list, point };
    }
    if (autoDrag) {
        try {
            el.setPointerCapture(e.pointerId);
        } catch {}
        autoChanged(lane, true);
    }
}

function autoPointerMove(e) {
    if (!autoDrag) return;
    const { lane, list, point } = autoDrag;
    const i = list.indexOf(point);
    if (i < 0) return;
    const gap = AUTO_STEP / 2;
    const low = i > 0 ? list[i - 1][0] + gap : 0;
    const high = i < list.length - 1 ? list[i + 1][0] - gap : BARS * BEATS;
    const beat = Math.round(laneBeat(lane, e.clientX) / AUTO_STEP) * AUTO_STEP;
    point[0] = Math.min(high, Math.max(low, beat));
    point[1] = laneValue(lane, e.clientY);
    autoChanged(lane, true);
}

function autoPointerUp() {
    if (!autoDrag) return;
    fillAutoSelect(autoDrag.lane); // (the list marks the dials that have a line)
    trackHeads[autoDrag.lane.t].settings.classList.toggle("has-auto", automationUsed(autoDrag.lane.t));
    autoDrag = null;
    if (typeof checkpoint === "function") checkpoint(); // (a drag is one step to undo)
}

// a line was changed: the lane is drawn again, and the SELECT says which dials have a line
function autoChanged(lane, drawing) {
    drawAutomationLane(lane);
    const arrow = trackHeads[lane.t].settings;
    arrow.classList.toggle("has-auto", automationUsed(lane.t));
    if (!drawing) {
        fillAutoSelect(lane);
        if (typeof checkpoint === "function") checkpoint();
    }
}

// the lanes are drawn again (after a song is opened or a line cleared)
function refreshAutomationLanes() {
    if (typeof paramLanes === "undefined") return;
    paramLanes.forEach((lane) => {
        if (!lane) return;
        trackHeads[lane.t].settings.classList.toggle("has-auto", automationUsed(lane.t));
        if (lane.autoSelect) fillAutoSelect(lane);
        if (lane.key === "auto") drawAutomationLane(lane);
    });
}
