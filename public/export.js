// EXPORT AUDIO (in the save popup): plays the whole song into a sound file (WAV) that you can keep or share. It is not played
// out loud and it doesn't take as long as the song does: the browser works it out as fast as it can (an OfflineAudioContext).
//
// The page's sound engine (synth.js, fx.js, drums.js) uses one audio context and one set of tracks that it keeps in variables.
// To use the same engine for the file, those are put to one side, the engine is built again in the offline context, every note
// of the song is scheduled in it, and when it's done the live ones are put back exactly as they were. While it works the page
// is switched off (nothing can be played), so nothing can use the wrong ones. It uses the helpers in save.js, so load it after.

const EXPORT_TAIL = 3; // seconds after the end of the song for echoes, reverb and notes that are still fading out
const exportButton = document.getElementById("exportAudio");

// every list of nodes the engine builds for the tracks (buildTrackChains in fx.js adds to each)
const chainLists = [
    trackFilters, trackGains, trackBus, trackEq, driveDry, drivePre, drivePost, driveWet, tremGain, tremDepth, tremLfo, trackPan,
    dlySend, dlyNode, dlyFeedback, revSend, vibLfo, vibGain, cutCtl, resCtl,
];

// works out the song as sound: gives back an AudioBuffer
async function renderSong() {
    if (running) stopTransport();
    stopStepRecording();
    getCtx(); // (so there is a live engine to put to one side, and a sample rate to use)

    const live = {
        ctx, master, bendNode, modDepth, reverbIn, beatSec,
        lists: chainLists.map((list) => list.slice()),
        filters: activeFilters.map((set) => new Set(set)),
        last: lastFrequency.slice(),
        drums: drumChannels.slice(),
    };
    const perBeat = 60 / bpm;
    const length = Math.ceil((BARS * BEATS * perBeat + EXPORT_TAIL) * live.ctx.sampleRate);
    const offline = new OfflineAudioContext(2, length, live.ctx.sampleRate);

    try {
        renderingOffline = true; // (no lights flash and nothing is sent out while it works)
        ctx = offline;
        master = offline.createGain();
        master.gain.value = songVolume * 2;
        master.connect(makeLimiter(offline));

        chainLists.forEach((list) => (list.length = 0));
        activeFilters.forEach((set) => set.clear());
        lastFrequency.fill(0);
        drumChannels.fill(null); // (each drum makes its chain, in the offline context, the first time it's hit)
        buildTrackChains();

        // the pitch wheel and mod wheel, as they are now (getCtx makes these for the live context)
        bendNode = offline.createConstantSource();
        bendNode.offset.value = bend * BEND_CENTS;
        bendNode.start();
        modDepth = offline.createGain();
        modDepth.gain.value = mod * MOD_CENTS;
        const lfo = offline.createOscillator();
        lfo.frequency.value = LFO_RATE;
        lfo.connect(modDepth);
        lfo.start();

        // every note of the song, bar after bar, exactly as playing it does (the muted tracks, the loops and the swing too)
        beatSec = perBeat;
        for (let n = 0; n < BARS * BEATS; n++) playBeatOf(Math.floor(n / BEATS), n % BEATS, 0.02 + n * perBeat, -1);
        return await offline.startRendering();
    } finally {
        ctx = live.ctx;
        master = live.master;
        bendNode = live.bendNode;
        modDepth = live.modDepth;
        reverbIn = live.reverbIn;
        beatSec = live.beatSec;
        chainLists.forEach((list, i) => {
            list.length = 0;
            list.push(...live.lists[i]);
        });
        activeFilters.forEach((set, i) => {
            set.clear();
            live.filters[i].forEach((filter) => set.add(filter));
        });
        lastFrequency.splice(0, lastFrequency.length, ...live.last);
        drumChannels.splice(0, drumChannels.length, ...live.drums);
        renderingOffline = false;
    }
}

// a WAV file (16 bit, stereo) from the sound. If it is louder than a file can hold, it is turned down to fit (not cut off)
function wavFile(buffer) {
    const channels = buffer.numberOfChannels;
    const frames = buffer.length;
    const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
    let peak = 0;
    data.forEach((samples) => {
        for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(samples[i]));
    });
    const turnDown = peak > 0.99 ? 0.99 / peak : 1;

    const bytes = new ArrayBuffer(44 + frames * channels * 2);
    const view = new DataView(bytes);
    const text = (at, words) => [...words].forEach((letter, i) => view.setUint8(at + i, letter.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, 36 + frames * channels * 2, true);
    text(8, "WAVEfmt ");
    view.setUint32(16, 16, true); // the size of this part
    view.setUint16(20, 1, true); // plain samples (PCM)
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * 2, true); // bytes each second
    view.setUint16(32, channels * 2, true); // bytes for one sample of every channel
    view.setUint16(34, 16, true); // bits in a sample
    text(36, "data");
    view.setUint32(40, frames * channels * 2, true);
    let at = 44;
    for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channels; c++) {
            const sample = Math.max(-1, Math.min(1, data[c][i] * turnDown));
            view.setInt16(at, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            at += 2;
        }
    }
    return new Blob([bytes], { type: "audio/wav" });
}

// keys and MIDI are ignored while it works (the mouse and touch can't reach the page, it's switched off)
function blockKeys(e) {
    e.stopImmediatePropagation();
    e.preventDefault();
}

exportButton.addEventListener("click", async () => {
    if (!hasMusic()) {
        saveStatus.textContent = "There is nothing to export yet. Put some notes in the song first.";
        return;
    }
    const name = cleanSongName(saveName.value) || songName;
    exportButton.disabled = true;
    saveStatus.textContent = "Working out the song...";
    document.body.inert = true;
    window.addEventListener("keydown", blockKeys, true);
    window.addEventListener("keyup", blockKeys, true);
    try {
        await new Promise((resolve) => setTimeout(resolve, 40)); // (so the words above are shown first)
        const buffer = await renderSong();
        downloadBlob(wavFile(buffer), fileNameFor(name, ".wav"));
        saveStatus.textContent = "Saved " + fileNameFor(name, ".wav") + " (" + Math.round(buffer.duration) + " seconds).";
    } catch (err) {
        saveStatus.textContent = "Could not make the audio file: " + err.message;
    } finally {
        window.removeEventListener("keydown", blockKeys, true);
        window.removeEventListener("keyup", blockKeys, true);
        document.body.inert = false;
        exportButton.disabled = false;
    }
});
