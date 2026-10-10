// starting points, in the saved songs popup (the folder button):
//   STARTER SONGS    a few ready-made songs to open, so there is something to play with and change straight away
//   DRUM PATTERNS    a beat (rock, house, hip hop...) to put into the selected drum block, one bar of it repeated to fill the block
// The songs are written here as notes and presets (presets.js), and opened the way a saved song is (showSong in save.js). It uses
// both of those and the drums (drums.js), so load it after them.

// ---- the drum patterns ----
// A pattern is one bar of 16 steps (step 0 is beat 1, step 4 is beat 2, and so on). Each part has the steps it plays on. The parts
// are the names of the drum parts in drums.js, so a pattern plays whichever drum of that part is in the kit
const DRUM_PATTERNS = [
    { name: "ROCK", hits: { KICK: [0, 8, 10], SNARE: [4, 12], "CLOSED HAT": [0, 2, 4, 6, 8, 10, 12, 14] } },
    { name: "HOUSE", hits: { KICK: [0, 4, 8, 12], CLAP: [4, 12], "OPEN HAT": [2, 6, 10, 14], "CLOSED HAT": [1, 3, 5, 7, 9, 11, 13, 15] } },
    { name: "HIP HOP", hits: { KICK: [0, 7, 10], SNARE: [4, 12], "CLOSED HAT": [0, 2, 4, 6, 8, 10, 12, 14] } },
    { name: "TRAP", hits: { KICK: [0, 10], CLAP: [8], "CLOSED HAT": [0, 2, 4, 6, 8, 10, 11, 12, 13, 14, 15], "OPEN HAT": [14] } },
    { name: "DNB", hits: { KICK: [0, 10], SNARE: [4, 12], "CLOSED HAT": [0, 2, 4, 6, 8, 10, 12, 14] } },
    { name: "REGGAETON", hits: { KICK: [0, 4, 8, 12], SNARE: [3, 6, 11, 14], "CLOSED HAT": [2, 6, 10, 14] } },
    { name: "FUNK", hits: { KICK: [0, 3, 6, 10], SNARE: [4, 12, 15], "CLOSED HAT": [0, 2, 3, 4, 6, 8, 10, 11, 12, 14] } },
    { name: "HALF TIME", hits: { KICK: [0, 10], SNARE: [8], "CLOSED HAT": [0, 4, 8, 12] } },
];

// how hard a drum is hit on a step: the hats are accented on the beat and soft in between, the rest are firm
function patternVelocity(part, step) {
    if (part !== "CLOSED HAT" && part !== "OPEN HAT") return 1;
    return step % 4 === 0 ? 0.95 : step % 2 === 0 ? 0.7 : 0.5;
}

// the place in a kit (a list of drums, like drumKit) of the first drum that is this part, or -1
function slotForPart(part, kit) {
    return kit.findIndex((sound) => DRUM_SOUNDS[sound].group === part);
}

// the notes of one bar of a pattern, for a kit
function patternNotes(pattern, kit) {
    const notes = [];
    for (const part in pattern.hits) {
        const slot = slotForPart(part, kit);
        if (slot < 0) continue; // (the kit has no drum of that part)
        pattern.hits[part].forEach((step) => {
            const note = { beat: step / 4, note: DRUM_NOTES[slot] };
            const velocity = patternVelocity(part, step);
            if (velocity < 1) note.velocity = velocity;
            notes.push(note);
        });
    }
    return notes.sort((a, b) => a.beat - b.beat);
}

// puts a pattern into the selected drum block (the drum track's block in the selected bar, if another track is selected)
function applyDrumPattern(pattern) {
    const bar = selTrack === DRUM_TRACK ? selBar : clipAt(DRUM_TRACK, selBar);
    if (selTrack !== DRUM_TRACK) selectBlock(DRUM_TRACK, bar);
    const bars = clipBars(DRUM_TRACK, bar);
    const one = patternNotes(pattern, drumKit);
    const notes = [];
    for (let i = 0; i < bars; i++) one.forEach((n) => notes.push({ ...n, beat: n.beat + i * BEATS }));
    song[DRUM_TRACK][bar] = notes;
    layoutSong(); // draws every block again
    return bars;
}

// ---- the starter songs ----

const BASE_DRUM_KIT = DRUM_NOTES.map((_, i) => drumIndex(...BASE_KIT[i])); // the drums a new song starts with

const hit = (beat, pitch, velocity) => (velocity === undefined ? { beat, note: pitch } : { beat, note: pitch, velocity });
// the same chord (a list of notes) played on each of these beats
const chordAt = (beats, pitches, velocity) => beats.flatMap((beat) => pitches.map((pitch) => hit(beat, pitch, velocity)));
// a list of bars used again and again until there are 8
const loopBars = (bars) => Array.from({ length: 8 }, (_, i) => bars[i % bars.length]);
// the drum bars: one bar of a pattern in every bar (with some of the bars changed by the second argument: bar number -> notes to add)
function drumBars(patternName, extras = {}) {
    const one = patternNotes(DRUM_PATTERNS.find((p) => p.name === patternName), BASE_DRUM_KIT);
    return Array.from({ length: 8 }, (_, b) => [...one, ...(extras[b] || [])]);
}
const slotNote = (part) => DRUM_NOTES[slotForPart(part, BASE_DRUM_KIT)];

// a track: a name, the built-in preset it uses (by name, plus changes), how loud, and its 8 bars of notes
function starterTrack(name, presetName, bars, extra = {}, volume = 0.5) {
    const preset = FACTORY_PRESETS.find((p) => p.name === presetName);
    return { name, settings: { ...factorySettings(preset), ...extra, volume }, bars };
}

const STARTER_SONGS = [
    {
        name: "Lofi Evening",
        build() {
            const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [50, 53, 57, 60], [52, 56, 59, 62]]; // Am7 Fmaj7 Dm7 E7
            const roots = [57, 53, 50, 52];
            const phrase = [
                [hit(0, 64), hit(1.5, 67), hit(2, 64), hit(3, 62)],
                [hit(0, 60), hit(1, 62), hit(2, 60), hit(3.5, 57)],
                [hit(0, 62), hit(1.5, 64), hit(2, 62), hit(3, 60)],
                [hit(0, 64), hit(1, 62), hit(2, 59), hit(3, 64)],
            ];
            return {
                tempo: 78,
                drums: drumBars("HIP HOP"),
                tracks: [
                    starterTrack("KEYS", "Electric Piano", loopBars(chords.map((c) => [...chordAt([0], c, 0.8), ...chordAt([1.5], c, 0.5), ...chordAt([2.5], c, 0.65)]))),
                    starterTrack("BASS", "Sub Bass", loopBars(roots.map((r) => [hit(0, r), hit(2.5, r, 0.8)])), {}, 0.6),
                    starterTrack("MELODY", "Marimba", loopBars(phrase), {}, 0.45),
                    starterTrack("PAD", "Warm Pad", loopBars(chords.map((c) => [...chordAt([0], c.slice(1), 0.5), ...chordAt([2], c.slice(1), 0.35)])), {}, 0.35),
                ],
            };
        },
    },
    {
        name: "Night Drive",
        build() {
            const triads = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]]; // Am F C G
            const roots = [57, 53, 60, 55];
            const bass = roots.map((r) => [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((beat, i) => hit(beat, [r, r, r + 12, r, r + 7, r, r + 12, r][i], i % 2 === 0 ? 0.95 : 0.7)));
            // each note of the lead is stepped through (an arpeggio, set in the track's PLAY dials) over its beat
            const lead = triads.map((t) => [0, 1, 2, 3].map((beat, i) => hit(beat, t[[0, 1, 2, 1][i]], 0.85)));
            return {
                tempo: 120,
                drums: drumBars("HOUSE", { 0: [hit(0, slotNote("CRASH"), 0.8)] }),
                tracks: [
                    starterTrack("BASS", "Acid Bass", loopBars(bass), {}, 0.55),
                    starterTrack("LEAD", "Super Lead", loopBars(lead), { arp: 0.25, arate: 2 / 3, rev: 0.35 }, 0.4),
                    starterTrack("PAD", "Warm Pad", loopBars(triads.map((t) => chordAt([0], t, 0.5))), {}, 0.4),
                    starterTrack("PLUCK", "Pluck", loopBars(roots.map((r) => [0.5, 1.5, 2.5, 3.5].map((beat) => hit(beat, r + 12, 0.6)))), {}, 0.4),
                ],
            };
        },
    },
    {
        name: "Chiptune Quest",
        build() {
            const arps = [[60, 64, 67, 72, 67, 64, 67, 64], [59, 62, 67, 71, 67, 62, 67, 62], [57, 60, 64, 69, 64, 60, 64, 60], [57, 60, 65, 69, 65, 60, 65, 60]]; // C G Am F
            const roots = [60, 55, 57, 53];
            const thirds = [64, 62, 60, 60];
            return {
                tempo: 140,
                drums: drumBars("ROCK", { 0: [hit(0, slotNote("CRASH"), 0.85)], 4: [hit(0, slotNote("CRASH"), 0.85)] }),
                tracks: [
                    starterTrack("LEAD", "Chiptune", loopBars(arps.map((a) => a.map((p, i) => hit(i / 2, p, i % 2 === 0 ? 0.9 : 0.7)))), {}, 0.45),
                    starterTrack("BASS", "Pluck Bass", loopBars(roots.map((r) => [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((beat) => hit(beat, r, beat % 1 === 0 ? 0.95 : 0.7)))), {}, 0.6),
                    starterTrack("HARMONY", "Square Lead", loopBars(thirds.map((p) => [hit(0, p, 0.6), hit(2, p + 3, 0.5)])), {}, 0.3),
                    starterTrack("BELLS", "Bell", Array.from({ length: 8 }, (_, b) => (b % 2 === 1 ? [hit(0, [64, 67, 69, 65][(b - 1) / 2], 0.6)] : [])), {}, 0.4),
                ],
            };
        },
    },
    {
        name: "Dub Echo",
        build() {
            const stabs = [[50, 53, 57, 60], [50, 53, 57, 60], [55, 58, 62, 65], [57, 61, 64, 67]]; // Dm7 Dm7 Gm7 A7
            const roots = [50, 50, 55, 57];
            const whistle = [[], [], [hit(0, 69), hit(1.5, 67), hit(2, 65)], [hit(0, 64, 0.8)], [], [], [hit(0, 65), hit(1.5, 69), hit(2, 72)], [hit(0, 69, 0.8)]];
            return {
                tempo: 70,
                drums: drumBars("HALF TIME", { 3: [hit(3.5, slotNote("RIM"), 0.7)], 7: [hit(3.5, slotNote("RIM"), 0.7)] }),
                tracks: [
                    starterTrack("STABS", "Dub Stab", loopBars(stabs.map((c) => chordAt([1, 3], c, 0.8))), {}, 0.45),
                    starterTrack("BASS", "Sub Bass", loopBars(roots.map((r) => [hit(0, r), hit(0.75, r, 0.7), hit(2, r), hit(2.5, r + 7, 0.8)])), {}, 0.65),
                    starterTrack("WHISTLE", "Sine Whistle", whistle, { rev: 0.5, dly: 0.45, dtime: 0.75, dfb: 0.5 }, 0.35),
                    starterTrack("STRINGS", "Dream Strings", loopBars(stabs.map((c) => chordAt([0], c.slice(0, 3), 0.4))), {}, 0.3),
                ],
            };
        },
    },
    {
        name: "Ambient Drift",
        build() {
            const bell = [[hit(1, 69, 0.6), hit(3.5, 76, 0.5)], [], [hit(0.5, 72, 0.5), hit(2, 67, 0.6)], [hit(3, 64, 0.5)], [hit(1.5, 76, 0.55)], [hit(0, 69, 0.6), hit(2.5, 72, 0.5)], [], [hit(2, 67, 0.5)]];
            return {
                tempo: 60,
                drums: Array.from({ length: 8 }, () => []),
                tracks: [
                    starterTrack("DRONE", "Ambient Drone", [[hit(0, 57, 0.6)], [], [hit(0, 53, 0.6)], [], [hit(0, 55, 0.6)], [], [hit(0, 57, 0.6)], []], {}, 0.9),
                    starterTrack("GLASS", "Glass Pad", [chordAt([0], [60, 64, 67, 71], 0.5), [], chordAt([0], [60, 64, 65, 69], 0.5), [], chordAt([0], [59, 62, 67], 0.5), [], chordAt([0], [60, 64, 67, 71], 0.5), []], {}, 0.85),
                    starterTrack("BELLS", "Bell", bell, {}, 0.8),
                    starterTrack("STRINGS", "Dream Strings", [[], chordAt([0], [57, 60, 64], 0.4), [], chordAt([0], [53, 57, 60], 0.4), [], chordAt([0], [55, 59, 62], 0.4), [], chordAt([0], [57, 60, 64], 0.4)], {}, 0.7),
                ],
            };
        },
    },
];

// a starter song as the data a saved song is (the drums first, then the tracks)
function starterData(starter) {
    const built = starter.build();
    return {
        tempo: built.tempo,
        volume: 0.5,
        barCount: 8,
        tracks: [{ name: "DRUMS", bars: built.drums }, ...built.tracks.map((t) => ({ name: t.name, settings: t.settings, bars: t.bars }))],
    };
}

// opens a starter song in place of the one on the screen (a song with a block that is longer than a bar, or none, is all one bar blocks)
function openStarter(starter) {
    showSong(cleanSong(starterData(starter)));
    songName = starter.name;
    rememberSongName();
    saveName.value = songName;
    savedLook = JSON.stringify(songSnapshot()); // (a song that is opened and not changed can be replaced without asking)
    songsStatus.textContent = "Opened " + starter.name + ". Press PLAY. Change anything, then save it to keep it.";
}

// ---- the buttons ----

const starterList = document.getElementById("starterSongs");
const patternList = document.getElementById("drumPatterns");
let armedStarter = -1; // the starter that has been pressed once and is asking "replace?" (the song on the screen has changes)
let armedTimer;

function showStarters() {
    fillChoices([starterList], STARTER_SONGS.map((s, i) => (i === armedStarter ? "REPLACE?" : s.name.toUpperCase())), -1, (i) => {
        if (songChanged() && hasMusic() && armedStarter !== i) {
            armedStarter = i;
            clearTimeout(armedTimer);
            armedTimer = setTimeout(() => {
                armedStarter = -1;
                showStarters();
            }, 3000);
            return showStarters();
        }
        clearTimeout(armedTimer);
        armedStarter = -1;
        openStarter(STARTER_SONGS[i]);
        showStarters();
    });
    fillChoices([patternList], DRUM_PATTERNS.map((p) => p.name), -1, (i) => {
        const bars = applyDrumPattern(DRUM_PATTERNS[i]);
        songsStatus.textContent = "Put " + DRUM_PATTERNS[i].name + " into " + (bars > 1 ? "the " + bars + " bar drum block" : "bar " + (selBar + 1) + " of the drums") + ".";
    });
}

// (the list is filled each time the popup opens, after save.js has filled the saved songs)
const songsPanel = panels.songs;
const openedSongs = songsPanel.onOpen;
songsPanel.onOpen = () => {
    if (openedSongs) openedSongs();
    armedStarter = -1;
    showStarters();
};
