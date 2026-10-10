// the settings each note has, the way a MIDI note has a velocity: how hard it's hit, and how much that varies by chance.
// They're stored on the notes themselves (a note { beat, note } can also have velocity, random, timing, chance and
// release, each 0 to 1), and the lane under a track or a drum row (the arrow on its header) is where you change them,
// note by note. A note that has none of them set gets the normal values:
//   velocity: how loud the note is (1 is full)
//   random:   how much its velocity varies by chance, up or down (0 is none)
//   timing:   how much it lands early or late by chance (0 is none, 1 is up to 40 milliseconds either way)
//   chance:   how likely it is to play at all (1 is always)
//   release:  how long it takes to fade out. 0.5 leaves it as it is, 0 is a quarter as long, 1 is four times as long
const PARAM_DEFAULTS = { velocity: 1, random: 0, timing: 0, chance: 1, release: 0.5 };
const TIMING_RANDOM_SECONDS = 0.04;

// one setting of one note (or its normal value if it has none)
function noteParam(n, key) {
    return typeof n[key] === "number" ? n[key] : PARAM_DEFAULTS[key];
}

// how many times longer than normal a release setting (0 to 1) makes the fade out
function releaseScale(v) {
    return 4 ** (2 * v - 1);
}

// works out how one note in the song is played this time: nothing (it missed its chance), or how loud, how much early
// or late (in seconds) and how long it fades out. (The randomness is new every time the song plays)
function humanize(n) {
    if (Math.random() > noteParam(n, "chance")) return null;
    const velocity = noteParam(n, "velocity") * (1 + (Math.random() * 2 - 1) * noteParam(n, "random"));
    return {
        velocity: Math.min(1, Math.max(0.02, velocity)),
        shift: (Math.random() * 2 - 1) * noteParam(n, "timing") * TIMING_RANDOM_SECONDS,
        release: releaseScale(noteParam(n, "release")),
    };
}
