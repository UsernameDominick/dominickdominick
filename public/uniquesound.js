// UNIQUESOUND: the second page of the site. The whole studio slides away to the left (a carousel) and this page slides in from the right: a grid of
// cards, each a different, interesting way to make a sound with one of the tools. A card that is a sound has TRY IT: it puts those dials on the
// selected synth track (or the first one that is not the drums or a sampler), plays a note, and slides back to the studio on the tab where the dials
// are, so you can see what was done and move them. A card that is a way of working (a drum roll, chopping a loop, drawing a line for a dial) has SHOW ME,
// which takes you to the right place in the studio.
// The tabs STUDIO and UNIQUESOUND are in the top box on both pages. This needs presets.js (the helpers that turn a list of dials into a sound) and the
// rest of the studio loaded first.

const uniqueTabs = [...document.querySelectorAll(".nav-tab")];
const dawPage = document.getElementById("dawPage");
const uniquePage = document.getElementById("uniquePage");
const uniqueGrid = document.getElementById("uniqueGrid");
const uniqueFilters = document.getElementById("uniqueFilters");
const uniqueNote = document.getElementById("uniqueNote");

// ---- the cards ----
// tool is the filter it is under, tab is the tab of the dials box that it ends on, and a sound card has the dials it sets (the same numbers as the
// presets: see the notes at the top of FACTORY_PRESETS in presets.js). A card with go() is a way of working
const RECIPES = [
    // the oscillator
    { tool: "OSC", tab: "osc", title: "Supersaw wall", text: "Stack eight copies of a saw wave and pull them a little out of tune, then spread them across the speakers: the sound of a huge trance chord from one key.", settings: { sound: 4, uni: 7 / 15, detune: 0.5, spread: 1, cutoff: 0.8, attack: 0.05, sustain: 0.85, release: 0.3, rev: 0.25 } },
    { tool: "OSC", tab: "osc", title: "Pulse width wobble", text: "A square wave is a pulse, and its width changes how hollow it sounds. Let a slow LFO move the width and the sound breathes and shimmers like two voices.", settings: { sound: 1, pw: 0.3, cutoff: 0.7, attack: 0.04, sustain: 0.85, release: 0.25, l1w: 0, l1r: 0.3, ...mx(0, 5, 0.55), chmix: 0.3 } },
    { tool: "OSC", tab: "osc", title: "Sub weight", text: "Add a sub wave, a square an octave under the note, and drop the whole thing an octave. Now it moves the room, not just the speakers.", settings: { sound: 0, oct: 0.25, sub: 0.5, cutoff: 0.5, resonance: 0.15, attack: 0.02, sustain: 0.9, release: 0.12 } },
    { tool: "OSC", tab: "osc", title: "Breath of noise", text: "A plain sine is cold. Mix in a little noise and give it a slow start and it turns into breath, like a flute or a whispered note.", settings: { sound: 2, noise: 0.35, cutoff: 0.6, attack: 0.3, sustain: 0.9, release: 0.4, vdep: 0.1, vrate: 0.45, rev: 0.35 } },
    // the filter
    { tool: "FILTER", tab: "filter", title: "Acid squelch", text: "The ladder filter with the resonance high, the cutoff low and the filter envelope opening it on every note. Play a pattern of short notes and slide the cutoff by hand.", settings: { sound: 0, oct: 0.25, fmodel: 1, cutoff: 0.2, resonance: 0.75, fenv: 0.6, drive: 0.15, attack: 0, decay: 0.22, sustain: 0.2, release: 0.08, glide: 0.1 } },
    { tool: "FILTER", tab: "filter", title: "Talking band", text: "A band pass filter only lets one band of pitches through. With the resonance up and the cutoff moved slowly by an LFO it sounds like a mouth saying wow.", settings: { sound: 0, ftype: 0.5, cutoff: 0.45, resonance: 0.6, attack: 0.03, sustain: 0.9, release: 0.2, l1w: 0, l1r: 0.4, ...mx(0, 1, 0.5), rev: 0.25 } },
    { tool: "FILTER", tab: "filter", title: "Pings that ring", text: "The ladder filter rings by itself when the resonance is nearly all the way up. A very short note then becomes a bell-like ping at the cutoff.", settings: { sound: 3, fmodel: 1, cutoff: 0.55, resonance: 0.95, ktrack: 0.6, attack: 0, decay: 0.15, sustain: 0, release: 0.2, rev: 0.3 } },
    { tool: "FILTER", tab: "filter", title: "Follow the note", text: "With key tracking up, the cutoff moves as far as the note does, so high notes are as bright as low ones. Play up the keyboard and the tone stays even.", settings: { sound: 0, cutoff: 0.3, resonance: 0.3, ktrack: 1, fenv: 0.4, attack: 0, decay: 0.3, sustain: 0.15, release: 0.15 } },
    // the envelope
    { tool: "ENV", tab: "env", title: "Soft pluck", text: "No attack, a medium decay and almost no sustain: the note is struck and then dies away on its own, however long you hold the key.", settings: { sound: 3, cutoff: 0.8, attack: 0, decay: 0.45, sustain: 0.05, release: 0.35, rev: 0.25 } },
    { tool: "ENV", tab: "env", title: "Slow swell", text: "A long attack and release make every note rise like a wave and fade like one. Play chords with long notes and let them overlap.", settings: { sound: 4, uni: 4 / 15, detune: 0.35, spread: 0.9, cutoff: 0.55, attack: 0.85, sustain: 0.9, release: 0.75, rev: 0.6 } },
    { tool: "ENV", tab: "env", title: "Gated chop", text: "Full sustain and no release: the sound starts and stops exactly with the key, like a switch. Tap keys in rhythm for a tight, stuttering stab.", settings: { sound: 1, cutoff: 0.65, attack: 0, decay: 0.5, sustain: 1, release: 0, drive: 0.2 } },
    // the EQ
    { tool: "EQ", tab: "eq", title: "Telephone", text: "Cut the lows and the highs and boost the middle with the EQ and the sound comes down a wire. Add a band pass filter for a small speaker.", settings: { sound: 1, e1f: 0.2, e1g: 0.05, e2f: 0.55, e2g: 0.85, e3f: 0.8, e3g: 0.05, cutoff: 0.7, drive: 0.3, attack: 0.01, sustain: 0.9, release: 0.1 } },
    { tool: "EQ", tab: "eq", title: "Air", text: "Boost the top band a lot and a dull sound opens up, with a bright shine on top. It is how a pad gets that expensive sparkle.", settings: { sound: 0, uni: 3 / 15, detune: 0.3, cutoff: 0.75, e3f: 0.9, e3g: 0.85, e3q: 0.2, attack: 0.5, sustain: 0.9, release: 0.5, rev: 0.4 } },
    { tool: "EQ", tab: "eq", title: "Scooped hollow", text: "A narrow cut in the middle takes the body out of a sound and leaves the edges: hollow, like a sound heard from another room.", settings: { sound: 4, uni: 3 / 15, e2f: 0.5, e2g: 0.05, e2q: 0.7, cutoff: 0.8, attack: 0.1, sustain: 0.85, release: 0.4, rev: 0.3 } },
    // echo and room
    { tool: "ECHO", tab: "fx", title: "Ping pong dub", text: "The echo bounces from the left speaker to the right. A short stab with the repeats turned up leaves a trail of echoes dancing across the room.", settings: { sound: 1, cutoff: 0.5, attack: 0, decay: 0.2, sustain: 0.15, release: 0.15, dly: 0.8, dping: 1, dtime: 0.5, dfb: 0.7, rev: 0.4 } },
    { tool: "ECHO", tab: "fx", title: "Slapback", text: "One very short echo with no repeats, like a tape machine in a small room. It makes a thin sound fat without making it wash around.", settings: { sound: 0, cutoff: 0.6, attack: 0.01, decay: 0.4, sustain: 0.4, release: 0.2, dly: 0.45, dtime: 0, dfb: 0.05 } },
    { tool: "ECHO", tab: "fx", title: "Cathedral", text: "The large room, a long wait before it starts and the high notes dying away fast: a single note hangs in the air and takes seconds to leave.", settings: { sound: 6, attack: 0.5, sustain: 0.9, release: 0.7, rev: 1, rsize: 1, rdamp: 0.45, rpre: 0.3 } },
    { tool: "ECHO", tab: "fx", title: "Dotted glow", text: "An echo a dotted eighth long, in time with the song, with the repeats bouncing between the speakers. It turns a simple melody into a pattern.", settings: { sound: 3, cutoff: 0.75, attack: 0, decay: 0.4, sustain: 0.2, release: 0.3, dly: 0.55, dping: 1, dtime: 0.5, dfb: 0.55, rev: 0.3 } },
    // vibrato and tremolo
    { tool: "MOD", tab: "mod", title: "Singing vibrato", text: "A gentle wobble in the pitch, not too fast, with a slow start and a little glide between notes. It makes a lead sound sung rather than played.", settings: { sound: 0, cutoff: 0.8, glide: 0.15, vdep: 0.25, vrate: 0.5, attack: 0.1, sustain: 0.85, release: 0.25, dly: 0.2, dtime: 0.75, dfb: 0.3 } },
    { tool: "MOD", tab: "mod", title: "Rotary organ", text: "The organ sound with the volume swinging up and down at a medium speed, like the spinning speaker of an old organ.", settings: { sound: 6, cutoff: 0.9, attack: 0.03, decay: 0.2, sustain: 1, release: 0.08, tdep: 0.45, trate: 0.5, rev: 0.25 } },
    // the matrix and the LFOs
    { tool: "MATRIX", tab: "matrix", title: "Auto wah", text: "An LFO sends the cutoff up and down in the matrix while the resonance is high: the filter wah-wahs on its own, in time with nothing but itself.", settings: { sound: 0, cutoff: 0.4, resonance: 0.5, attack: 0.02, sustain: 0.9, release: 0.2, l1w: 0, l1r: 0.5, ...mx(0, 1, 0.55) } },
    { tool: "MATRIX", tab: "matrix", title: "Steps and random", text: "An LFO that picks a new random value for each step, sent to the cutoff and to the pan. Every note falls somewhere new: bubbling, never the same twice.", settings: { sound: 1, cutoff: 0.45, resonance: 0.4, attack: 0, decay: 0.25, sustain: 0.3, release: 0.1, l1w: 5 / 6, l1r: 0.62, ...mx(0, 1, 0.5), l2w: 5 / 6, l2r: 0.62, ...mx(1, 4, 0.5), dly: 0.3, dping: 1, dtime: 0.25 } },
    { tool: "MATRIX", tab: "matrix", title: "Pitch drop", text: "A quick envelope sent to the pitch: each note starts far too high and falls to where it should be. A laser, or with a lower sound, a kick drum.", settings: { sound: 2, attack: 0, decay: 0.2, sustain: 0, release: 0.1, v2a: 0, v2d: 0.15, v2s: 0, v2r: 0.1, ...mx(3, 0, 0.8), dly: 0.2, dtime: 0.25, dfb: 0.3 } },
    { tool: "MATRIX", tab: "matrix", title: "Touch brightness", text: "Send how hard the key is hit to the cutoff. Play softly and the sound is dark and gentle, hit hard and it opens up and bites.", settings: { sound: 0, cutoff: 0.3, resonance: 0.2, attack: 0, decay: 0.4, sustain: 0.4, release: 0.2, ...mx(5, 1, 0.6) } },
    { tool: "MATRIX", tab: "matrix", title: "Drifting pan", text: "A slow smooth random LFO sent to the pan: each note drifts somewhere between the speakers while it plays, never settling in the same place.", settings: { sound: 4, uni: 2 / 15, cutoff: 0.6, attack: 0.3, sustain: 0.9, release: 0.5, l3w: 1, l3r: 0.3, ...mx(2, 4, 0.8), rev: 0.5 } },
    // the rack
    { tool: "RACK", tab: "move", title: "Chorus shimmer", text: "Three delayed copies of the sound, each wobbling a little, a different way in each speaker. It sounds like several players, wider and softer.", settings: { sound: 0, cutoff: 0.7, attack: 0.1, sustain: 0.85, release: 0.3, chmix: 0.65, chrate: 0.3, chdep: 0.7, rev: 0.3 } },
    { tool: "RACK", tab: "move", title: "Jet flanger", text: "A very short delay that sweeps, with some of it fed back round: a comb of notches that moves up and down, the sound of a jet passing.", settings: { sound: 0, cutoff: 0.9, attack: 0.03, sustain: 0.9, release: 0.3, flmix: 0.65, flrate: 0.2, fldep: 0.7, flfb: 0.7 } },
    { tool: "RACK", tab: "move", title: "Phaser sweep", text: "Six stages that turn the phase of the sound and sweep: notches that glide up and down a pad. More feedback makes them sharper.", settings: { sound: 4, uni: 3 / 15, detune: 0.3, cutoff: 0.8, attack: 0.5, sustain: 0.9, release: 0.5, phmix: 0.7, phrate: 0.15, phdep: 0.8, phfb: 0.55, rev: 0.4 } },
    { tool: "RACK", tab: "grit", title: "Lo-fi crush", text: "Fewer steps in the loudness and the sound held for several samples at a time: the gritty, digital sound of an old sampler or a game console.", settings: { sound: 1, oct: 0.75, cutoff: 0.9, attack: 0, sustain: 0.8, release: 0.1, crmix: 0.65, crbits: 0.25, crhold: 0.2 } },
    { tool: "RACK", tab: "grit", title: "Pump compressor", text: "A compressor with a low threshold and a high ratio squeezes the loud start of every note flat and brings the quiet tail up: dense, close, and punchy.", settings: { sound: 0, oct: 0.25, cutoff: 0.5, attack: 0, decay: 0.3, sustain: 0.5, release: 0.15, cpmix: 1, cpthr: 0.65, cpratio: 0.55, cpatk: 0.2, cprel: 0.5 } },
    // playing
    { tool: "PLAY", tab: "play", title: "One finger chords", text: "Choose a chord and every key you press plays the whole chord. A minor seventh on a soft sound turns one finger into a lush progression.", settings: { sound: 4, uni: 3 / 15, cutoff: 0.6, attack: 0.3, sustain: 0.85, release: 0.5, chord: chordDial("MIN7"), rev: 0.5 } },
    { tool: "PLAY", tab: "play", title: "Arpeggio machine", text: "Choose a chord and an arpeggio direction and one held key plays the notes one after another in time with the song. Change RATE for a different feel.", settings: { sound: 4, uni: 4 / 15, detune: 0.3, cutoff: 0.6, attack: 0, decay: 0.2, sustain: 0.2, release: 0.1, chord: chordDial("MIN"), arp: arpDial("UP DOWN"), arate: arpRateDial("1/16"), dly: 0.35, dtime: 0.5, dfb: 0.4, rev: 0.3 } },
    { tool: "PLAY", tab: "play", title: "Legato glide", text: "In legato mode one voice slides between the keys you hold, and back to the one before when you let go of the newest. Add glide for a singing slide.", settings: { sound: 0, mode: 1, glide: 0.3, cutoff: 0.7, vdep: 0.15, vrate: 0.5, attack: 0.04, sustain: 0.9, release: 0.2, dly: 0.2, dping: 1, dtime: 0.25 } },
    // the sampler
    { tool: "SAMPLER", tab: "chop", title: "Chop a break", text: "Load a drum loop, press HITS on the CHOP tab and every hit becomes a key, from the base key up. Play the pieces in a new order and the loop becomes your own.", steps: ["Pick SAMPLER in the sound picker.", "LOAD a drum loop (or record one with RECORD).", "On the CHOP tab press HITS, then play the keys from C3."], go: () => goSampler("chop") },
    { tool: "SAMPLER", tab: "sample", title: "Reverse swell", text: "Turn REV on and give the sample a slow fade in: the end of a sound plays first and swells up into a hit, the classic reversed cymbal.", steps: ["Load a cymbal, or any short sound, into the sampler.", "On the SAMPLE tab turn REV on and turn IN up for a slow fade in.", "Set GATE to ONE SHOT so it plays to the end."], go: () => goSampler("sample") },
    { tool: "SAMPLER", tab: "tune", title: "Fit it to your song", text: "ANALYSE finds the key and the tempo of a loop. KEY MATCH moves it into the key of your song and TEMPO MATCH stretches it to your tempo, each without changing the other.", steps: ["Load a melodic loop into the sampler.", "On the TUNE tab press ANALYSE, then KEY MATCH and TEMPO MATCH.", "Change the BPM and watch it follow."], go: () => goSampler("tune") },
    { tool: "SAMPLER", tab: "sample", title: "Tune a voice into an instrument", text: "Record yourself holding one note, set STYLE to LOOP and the part between START and END goes round while you hold a key: you can play your own voice.", steps: ["Press RECORD on the SAMPLE tab and sing one steady note.", "Set STYLE to LOOP and drag START and END round a steady part.", "Press ANALYSE on the TUNE tab so the keys play in tune."], go: () => goSampler("sample") },
    // drums
    { tool: "DRUMS", tab: "play", title: "Roll and build", text: "A roll hits the drum again and again for as long as you hold the key, and BUILD makes it start soft and get louder, like a drummer building into a drop.", steps: ["Select the DRUMS track and play a snare key.", "On the PLAY tab set ROLL to 1/16.", "Turn BUILD up so every roll gets louder as it goes."], go: () => goDrums("play") },
    { tool: "DRUMS", tab: "fx", title: "Dub snare", text: "Every drum has its own dials, so one drum can have a huge echo and room while the rest stay dry. Give the snare a ping pong echo and a big room.", steps: ["Select the DRUMS track and pick the snare.", "On the FX tab turn DLY and REV up.", "Everything else stays dry: the dials only change the drum you picked."], go: () => goDrums("fx") },
    // automation
    { tool: "AUTOMATION", tab: "filter", title: "Filter riser", text: "Draw a line for the cutoff that starts low and climbs over the whole song, with a long note held on top. It is how a build-up grows without touching a dial.", steps: ["Open the lane under a track (the arrow) and pick the AUTO tab.", "Pick FILTER CUT in the list.", "Click a low point at the start and a high one at the end."], go: () => goAutomation("cutoff") },
    { tool: "AUTOMATION", tab: "mod", title: "Hand-drawn tremolo", text: "Draw the volume as a zigzag, a point low and a point high, bar after bar, and you have a tremolo of your own, in any rhythm you like.", steps: ["Open the lane under a track and pick the AUTO tab.", "Pick SOUND VOL in the list.", "Click points up and down along the song."], go: () => goAutomation("volume") },
    // random and morph
    { tool: "RANDOM", tab: "sound", title: "Roll the dice", text: "The dice by the star makes a whole new sound from chance, kept inside what sounds like something. Hold Shift for small changes to the sound you have.", steps: ["Click the dice, listen, click again.", "When something is good, save it with the star.", "Shift and click nudges the sound a little."], go: () => goRandom() },
    { tool: "RANDOM", tab: "sound", title: "Morph two sounds", text: "Open the presets, pick a sound to morph into and slide: every dial in between is worked out, and you can stop anywhere for a sound that is neither.", steps: ["Click the star and find MORPH THIS SOUND INTO.", "Pick a preset and drag the slider.", "Stop where it sounds new and save it."], go: () => goMorph() },
];

const TOOL_FILTERS = ["ALL", "OSC", "FILTER", "ENV", "EQ", "ECHO", "MOD", "MATRIX", "RACK", "PLAY", "SAMPLER", "DRUMS", "AUTOMATION", "RANDOM"];
let uniqueFilter = "ALL";

// ---- going to the right place in the studio ----
// the track a sound card goes on: the selected one, if it is a synth track, or the first one that is
function synthTrackFor() {
    if (selTrack !== DRUM_TRACK && !isSampler(selTrack)) return selTrack;
    for (let t = 1; t < TRACKS; t++) if (!isSampler(t)) return t;
    return -1;
}

function selectTrackForCard(t) {
    if (selTrack !== t) selectBlock(t, selBar);
}

function goSampler(tab) {
    let t = selTrack !== DRUM_TRACK ? selTrack : 1;
    if (!isSampler(t)) {
        trackSettings[t].sound = SOUNDS.length - 1;
        Object.assign(trackSettings[t], { attack: 0, decay: 0.5, sustain: 1, release: 0.2 });
    }
    selectTrackForCard(t);
    showSound();
    selectDialTab(tab);
}

function goDrums(tab) {
    selectTrackForCard(DRUM_TRACK);
    selectDialTab(tab);
}

function goAutomation(key) {
    const t = synthTrackFor();
    if (t < 0) return;
    selectTrackForCard(t);
    paramOpen[t] = true;
    layoutSong();
    const lane = paramLanes[t];
    lane.autoKey = key;
    lane.tabEls[lane.tabEls.length - 1].click();
    lane.autoSelect.value = key;
}

function goRandom() {
    const t = synthTrackFor();
    if (t >= 0) selectTrackForCard(t);
    selectDialTab("sound");
    randomButton.focus();
}

function goMorph() {
    const t = synthTrackFor();
    if (t >= 0) selectTrackForCard(t);
    presetButton.click();
}

// puts a sound card's dials on a synth track and plays a note
function tryRecipe(r) {
    const t = synthTrackFor();
    if (t < 0) {
        uniqueNote.textContent = "There is no synth track to put it on. Change a track's sound from SAMPLER first.";
        return false;
    }
    getCtx();
    selectTrackForCard(t);
    Object.assign(trackSettings[t], cleanPresetSettings(factorySettings(r.settings), t));
    applyFx(t);
    applyFilter(t);
    showSound();
    selectDialTab(r.tab);
    return true;
}

// ---- the dials a card sets, as small labels ----
function dialLabelsOf(settings) {
    const specs = {};
    DIALS.forEach((spec) => {
        if (spec.key && !specs[spec.key]) specs[spec.key] = spec;
    });
    const out = [];
    for (const key of Object.keys(settings)) {
        const v = settings[key];
        if (key === "sound") {
            out.push("WAVE " + SOUNDS[v].name);
            continue;
        }
        const matrix = key.match(/^x(\d+)_(\d+)$/);
        if (matrix) {
            out.push(MOD_SOURCES[matrix[1]] + " > " + MOD_DESTS[matrix[2]] + " " + signedPercent((v - 0.5) * 2));
            continue;
        }
        const spec = specs[key === "decay" ? "envdecay" : key];
        if (spec) out.push(spec.label + " " + spec.format(v));
    }
    return out;
}

const signedPercent = (v) => (v > 0 ? "+" : "") + Math.round(v * 100) + "%";

// ---- building the page ----
function buildCard(r) {
    const card = document.createElement("article");
    card.className = "unique-card";
    card.dataset.tool = r.tool;
    const tag = document.createElement("span");
    tag.className = "unique-tag";
    tag.textContent = r.tool;
    const title = document.createElement("h2");
    title.textContent = r.title;
    const text = document.createElement("p");
    text.textContent = r.text;
    card.append(tag, title, text);
    if (r.settings) {
        const dials = document.createElement("ul");
        dials.className = "unique-dials";
        const labels = dialLabelsOf(r.settings);
        labels.slice(0, 9).forEach((label) => {
            const li = document.createElement("li");
            li.textContent = label;
            dials.appendChild(li);
        });
        if (labels.length > 9) {
            const li = document.createElement("li");
            li.textContent = "+" + (labels.length - 9) + " more";
            dials.appendChild(li);
        }
        card.appendChild(dials);
    } else {
        const steps = document.createElement("ol");
        steps.className = "unique-steps";
        r.steps.forEach((step) => {
            const li = document.createElement("li");
            li.textContent = step;
            steps.appendChild(li);
        });
        card.appendChild(steps);
    }
    const button = document.createElement("button");
    button.className = "tool unique-go";
    button.type = "button";
    button.textContent = r.settings ? "TRY IT" : "SHOW ME";
    button.setAttribute("aria-label", (r.settings ? "Try " : "Show me: ") + r.title + ". It goes back to the studio");
    button.addEventListener("click", () => {
        uniqueNote.textContent = "";
        if (r.settings) {
            if (!tryRecipe(r)) return;
        } else {
            getCtx();
            r.go();
        }
        showPage("daw");
        if (r.settings) setTimeout(() => previewNote(60), 450); // (the sound is heard as the studio slides back)
    });
    card.appendChild(button);
    return card;
}

function showCards() {
    uniqueGrid.innerHTML = "";
    RECIPES.filter((r) => uniqueFilter === "ALL" || r.tool === uniqueFilter).forEach((r) => uniqueGrid.appendChild(buildCard(r)));
    uniqueFilters.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === uniqueFilter)));
}

TOOL_FILTERS.forEach((tool) => {
    const button = document.createElement("button");
    button.className = "unique-filter";
    button.type = "button";
    button.textContent = tool;
    button.dataset.tool = tool;
    button.addEventListener("click", () => {
        uniqueFilter = tool;
        showCards();
    });
    uniqueFilters.appendChild(button);
});
showCards();

// ---- the carousel ----
let page = "daw";
let slideTimer = 0;

function showPage(which) {
    if (which === page) return;
    page = which;
    const unique = which === "unique";
    clearTimeout(slideTimer);
    // both pages are in the page while they slide; the one that is away is taken out of the way of the keyboard and of screen readers
    dawPage.inert = false;
    uniquePage.inert = false;
    uniquePage.hidden = false;
    void uniquePage.offsetWidth; // (it is laid out where it waits, off to the right, before it is told to slide in)
    document.body.classList.toggle("on-unique", unique);
    uniqueTabs.forEach((tab) => tab.setAttribute("aria-pressed", String((tab.dataset.page === "unique") === unique)));
    const settle = () => {
        dawPage.inert = unique;
        uniquePage.inert = !unique;
        if (unique) {
            uniquePage.scrollTop = 0;
            document.getElementById("uniqueTitle").focus({ preventScroll: true });
        } else {
            uniquePage.hidden = true;
            const tab = document.querySelector("#dawPage .nav-tab[data-page=daw]");
            if (tab) tab.focus({ preventScroll: true });
        }
        window.dispatchEvent(new Event("resize")); // (the studio draws itself again at its size)
    };
    // (with reduced motion the pages just change, with no sliding)
    const slides = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    slideTimer = setTimeout(settle, slides ? 560 : 0);
}

uniqueTabs.forEach((tab) => tab.addEventListener("click", () => showPage(tab.dataset.page)));
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && page === "unique" && !document.querySelector(".popover:not([hidden])")) showPage("daw");
});
uniquePage.hidden = true;
uniquePage.inert = true;
