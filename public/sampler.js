// THE SAMPLER: a track whose sound is a recording of your own (SAMPLER in the sound picker). You load a sound file or record with the microphone,
// and the keys play it in one of three ways:
//   PITCH  the key plays the whole sample, higher or lower the further it is from the ROOT key (the key the sample is already at)
//   CHOP   the sample is cut into chops (markers on the waveform) and each key from BASE up plays one chop, at its own speed: drum breaks, vocal cuts
//   LOOP   like PITCH, but the part between START and END goes round and round for as long as the key is held
// It finds things out about the sample (the ANALYSE button): the note it is on (for a single note), the key it is in (for a loop or a chord:
// from which of the twelve notes it has most of), and how many beats it is (from where its hits fall). KEY MATCH then moves it into the key of the
// song (the KEY and SCALE of the LEDs), and TEMPO MATCH makes it fit the song's tempo, both without changing the other: the sample is worked out
// again (time stretching by overlapping pieces that line up, then speeding it up or down to move its pitch) and kept.
//
// Where things are kept: the sound itself is in this browser (IndexedDB), under a number worked out from the sound, so loading the same file
// again finds it again. A song (and a song file, and a link) keeps only what is about the sample: its name, where you chopped it and what was found.
// The page that plays notes (playVoice in synth.js) asks samplerVoice for what a key plays, and plays it with a SampleSource, which can be used
// where an oscillator can (it has a frequency, a detune, start, stop and ended).
// The settings (the dials of the SAMPLE, CHOP and TUNE tabs) are in the track's settings like every other dial: see FX_DEFAULTS in synth.js.

const SAMPLE_MAX_SECONDS = 120; // a longer file is turned away
const SAMPLE_MODES = ["PITCH", "CHOP", "LOOP"];
const BEAT_CHOICES = [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]; // how many beats the sample is (0 is not matched to the tempo)
const sampleMode = (settings) => placeOf(settings.smode, SAMPLE_MODES.length);
const sampleRoot = (v) => 24 + Math.round(v * 72); // the key the sample is at: C1 up to C7
const sampleFine = (v) => Math.round((v - 0.5) * 100); // and how many cents above or below it (-50 to 50)
const sampleShift = (v) => Math.round((v - 0.5) * 24); // semitones the sample is moved by (-12 to 12)
const sampleBase = (v) => 36 + Math.round(v * 48); // the key of the first chop
const sampleBeats = (v) => BEAT_CHOICES[placeOf(v, BEAT_CHOICES.length)];
const noteLabel = (note) => NOTE_NAMES[((note % 12) + 12) % 12] + (Math.floor(note / 12) - 1);
const SAMPLER_KEYS = new Set(["smode", "srev", "sstart", "send", "sroot", "sfine", "sbase", "ssens", "sshift", "sbeats"]);

// is this track's sound the sampler?
function isSampler(track) {
    return !!SOUNDS[trackSettings[track].sound] && SOUNDS[trackSettings[track].sound].sampler === true;
}

// ---- what each track has ----
// { id, name, data: { rate, channels: [Float32Array] } or null (while it is being found, or if it is missing), missing, duration (seconds),
//   chops: [seconds, ...] where each chop starts (the first is 0), analysis, view, cache, working (0 to 1 while it is being worked out) }
const samplerState = Array.from({ length: MAX_TRACKS }, () => null);

function emptySampler() {
    return { id: "", name: "", data: null, missing: false, duration: 0, chops: [0], analysis: null, view: null, viewWanted: "", cache: new Map(), working: null, timer: 0, peaks: null, message: "" };
}

// ---- the sounds, kept in the browser ----
const sampleMemory = new Map(); // id -> data, for the ones that are loaded

function sampleDb() {
    return new Promise((resolve, reject) => {
        try {
            const request = indexedDB.open("studio-samples", 1);
            request.onupgradeneeded = () => request.result.createObjectStore("samples", { keyPath: "id" });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        } catch (e) {
            reject(e);
        }
    });
}

async function keepSample(id, name, data) {
    sampleMemory.set(id, data);
    try {
        const db = await sampleDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction("samples", "readwrite");
            tx.objectStore("samples").put({ id, name, rate: data.rate, channels: data.channels });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
        return true;
    } catch {
        return false; // (the browser will not keep it: it is still here until the page closes)
    }
}

async function findSample(id) {
    if (sampleMemory.has(id)) return sampleMemory.get(id);
    try {
        const db = await sampleDb();
        const record = await new Promise((resolve, reject) => {
            const request = db.transaction("samples").objectStore("samples").get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        db.close();
        if (record && Array.isArray(record.channels) && record.channels.length) {
            const data = { rate: record.rate, channels: record.channels };
            sampleMemory.set(id, data);
            return data;
        }
    } catch {}
    return null;
}

// a name for a sound that comes from what is in it, so the same sound is always the same one
function sampleId(data) {
    let h = 2166136261;
    const first = data.channels[0];
    const step = Math.max(1, Math.floor(first.length / 20000));
    for (let i = 0; i < first.length; i += step) h = Math.imul(h ^ Math.round(first[i] * 32767), 16777619);
    h = Math.imul(h ^ first.length, 16777619);
    h = Math.imul(h ^ data.rate, 16777619);
    return (h >>> 0).toString(16).padStart(8, "0") + "-" + first.length.toString(16);
}

// ---- getting a sound in ----
// a decoded sound as plain data (one or two channels), turned up to a good level
function dataFromBuffer(buffer) {
    const channels = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c).slice());
    let peak = 0;
    channels.forEach((ch) => {
        for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
    });
    const gain = peak > 0.0001 ? Math.min(8, 0.9 / peak) : 1;
    if (Math.abs(gain - 1) > 0.01) channels.forEach((ch) => { for (let i = 0; i < ch.length; i++) ch[i] *= gain; });
    return { rate: buffer.sampleRate, channels };
}

async function decodeSound(arrayBuffer) {
    getCtx();
    const decoder = ctx && !renderingOffline ? ctx : new OfflineAudioContext(2, 1, 48000);
    const buffer = await decoder.decodeAudioData(arrayBuffer);
    if (buffer.duration > SAMPLE_MAX_SECONDS) throw new Error("That sound is longer than " + SAMPLE_MAX_SECONDS / 60 + " minutes.");
    if (buffer.length < 64) throw new Error("That sound is too short.");
    return dataFromBuffer(buffer);
}

// gives a track a sound (the data) and works out what it can for it
async function setTrackSample(track, name, data, keepChops) {
    const id = sampleId(data);
    const old = samplerState[track];
    const st = emptySampler();
    st.id = id;
    st.name = name;
    st.data = data;
    st.duration = data.channels[0].length / data.rate;
    if (keepChops && old && old.id === id) {
        st.chops = old.chops;
        st.analysis = old.analysis;
    }
    samplerState[track] = st;
    const kept = await keepSample(id, name, data);
    if (!kept) st.message = "THE BROWSER WILL NOT KEEP IT";
    st.view = makeView(st, data, 1, 0, false);
    st.viewWanted = viewKeyOf(track);
    return st;
}

// a file you picked or dropped: decoded and given to the track. Then it is looked at, to set the way it plays
async function loadSampleFile(track, file) {
    const st = samplerState[track] || (samplerState[track] = emptySampler());
    st.message = "LOADING";
    samplerChanged(track, null);
    try {
        const data = await decodeSound(await file.arrayBuffer());
        const name = file.name.replace(/\.[^.]+$/, "").slice(0, 24).toUpperCase() || "SAMPLE";
        await setTrackSample(track, name, data, false);
        await analyseAndSet(track);
    } catch (e) {
        st.message = (e && e.message ? e.message : "THAT FILE WILL NOT PLAY").slice(0, 60).toUpperCase();
        if (!samplerState[track].data) st.message = "COULD NOT READ THAT FILE";
    }
    samplerChanged(track, null);
}

// ---- the microphone ----
let recorder = null; // { track, stream, media, chunks, started }

function recordingSeconds() {
    return recorder ? (performance.now() - recorder.started) / 1000 : 0;
}

async function startRecording(track) {
    if (recorder) return;
    const st = samplerState[track] || (samplerState[track] = emptySampler());
    try {
        // (an echo, noise and level control are for calls: they would change a recording of an instrument)
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        const media = new MediaRecorder(stream);
        recorder = { track, stream, media, chunks: [], started: performance.now() };
        media.ondataavailable = (e) => e.data && e.data.size && recorder && recorder.chunks.push(e.data);
        media.start();
        st.message = "";
    } catch (e) {
        recorder = null;
        st.message = e && e.name === "NotAllowedError" ? "MICROPHONE BLOCKED" : "NO MICROPHONE";
    }
    samplerChanged(track, null);
}

async function stopRecording() {
    if (!recorder) return;
    const r = recorder;
    const st = samplerState[r.track];
    const blob = await new Promise((resolve) => {
        r.media.onstop = () => resolve(new Blob(r.chunks, { type: r.media.mimeType || "audio/webm" }));
        r.media.stop();
    });
    r.stream.getTracks().forEach((track) => track.stop());
    recorder = null;
    st.message = "WORKING";
    samplerChanged(r.track, null);
    try {
        const data = await decodeSound(await blob.arrayBuffer());
        recordingNumber++;
        await setTrackSample(r.track, "RECORDING " + recordingNumber, data, false);
        await analyseAndSet(r.track);
    } catch (e) {
        st.message = "NOTHING WAS RECORDED";
    }
    samplerChanged(r.track, null);
}
let recordingNumber = 0;

// ---- looking at a sound ----
// (all of these work on plain arrays, so they can be tried on their own)
function monoOf(data) {
    const first = data.channels[0];
    if (data.channels.length === 1) return first;
    const second = data.channels[1];
    const out = new Float32Array(first.length);
    for (let i = 0; i < out.length; i++) out[i] = (first[i] + second[i]) * 0.5;
    return out;
}

// the Fourier transform (it finds how much of each pitch is in a stretch of sound): in place, the length is a power of two
function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1;
        const angle = (-2 * Math.PI) / len;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
            let cr = 1;
            let ci = 0;
            for (let k = 0; k < half; k++) {
                const a = i + k;
                const b = a + half;
                const vr = re[b] * cr - im[b] * ci;
                const vi = re[b] * ci + im[b] * cr;
                re[b] = re[a] - vr;
                im[b] = im[a] - vi;
                re[a] += vr;
                im[a] += vi;
                const next = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = next;
            }
        }
    }
}

function hann(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    return w;
}

// the note a single sound is on: the pitch is found in the loudest stretches (the YIN method: where the sound is most like itself a
// little later), and counts only if most of them agree. Gives { pitched, note (a number with cents in it), clarity }
function findPitch(mono, rate) {
    const factor = Math.max(1, Math.floor(rate / 24000));
    const length = Math.floor(mono.length / factor);
    const x = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        let sum = 0;
        for (let k = 0; k < factor; k++) sum += mono[i * factor + k];
        x[i] = sum / factor;
    }
    const sr = rate / factor;
    const W = Math.round(sr * 0.06);
    const tauMax = Math.round(sr / 38);
    const hop = Math.max(1, Math.round(W / 2));
    const starts = [];
    let loudest = 0;
    const rms = [];
    for (let s = 0; s + W + tauMax < length; s += hop) {
        let sum = 0;
        for (let i = 0; i < W; i++) sum += x[s + i] * x[s + i];
        rms.push(Math.sqrt(sum / W));
        starts.push(s);
        loudest = Math.max(loudest, rms[rms.length - 1]);
    }
    const loud = starts.filter((_, i) => rms[i] > loudest * 0.35);
    if (loud.length < 2) return { pitched: false, note: 60, clarity: 0 };
    const picks = [];
    const stride = Math.max(1, Math.floor(loud.length / 20));
    for (let i = 0; i < loud.length && picks.length < 20; i += stride) picks.push(loud[i]);
    const found = [];
    const d = new Float64Array(tauMax + 1);
    for (const s of picks) {
        let running = 0;
        d[0] = 1;
        for (let tau = 1; tau <= tauMax; tau++) {
            let sum = 0;
            for (let i = 0; i < W; i++) {
                const diff = x[s + i] - x[s + i + tau];
                sum += diff * diff;
            }
            running += sum;
            d[tau] = running > 0 ? (sum * tau) / running : 1;
        }
        let tau = 2;
        while (tau < tauMax && d[tau] > 0.15) tau++;
        if (tau >= tauMax) continue;
        while (tau + 1 < tauMax && d[tau + 1] < d[tau]) tau++;
        const a = d[tau - 1];
        const b = d[tau];
        const c = d[tau + 1];
        const shift = a - 2 * b + c !== 0 ? (a - c) / (2 * (a - 2 * b + c)) : 0;
        const period = tau + shift;
        if (period > 0 && 1 - b > 0.8) found.push({ freq: sr / period, clarity: 1 - b });
    }
    if (found.length < Math.max(2, picks.length * 0.4)) return { pitched: false, note: 60, clarity: 0 };
    const freqs = found.map((f) => f.freq).sort((p, q) => p - q);
    const median = freqs[Math.floor(freqs.length / 2)];
    const agree = freqs.filter((f) => Math.abs(1200 * Math.log2(f / median)) < 40).length;
    if (agree < found.length * 0.6) return { pitched: false, note: 60, clarity: 0 };
    const clarity = found.reduce((sum, f) => sum + f.clarity, 0) / found.length;
    return { pitched: true, note: 69 + 12 * Math.log2(median / 440), clarity };
}

// the key a sound is in: how much of each of the twelve notes it has, set against the shape of a major and of a minor key (Krumhansl and
// Schmuckler's profiles). Gives { chroma (twelve numbers), tonic (0 is C), minor, score (how well it fits, -1 to 1), name }
const KEY_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KEY_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function chromaOf(mono, rate) {
    const size = 8192;
    const hop = 4096;
    const win = hann(size);
    const chroma = new Float64Array(12);
    const lowBin = Math.ceil((65 * size) / rate);
    const highBin = Math.min(size / 2 - 1, Math.floor((2100 * size) / rate));
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    let loudest = 0;
    const frames = [];
    for (let s = 0; s + size <= mono.length || (s === 0 && mono.length > 0); s += hop) {
        let sum = 0;
        for (let i = 0; i < size; i++) {
            const v = s + i < mono.length ? mono[s + i] : 0;
            sum += v * v;
        }
        frames.push({ s, energy: sum });
        loudest = Math.max(loudest, sum);
        if (s + size >= mono.length) break;
    }
    for (const frame of frames) {
        if (frame.energy < loudest * 0.02) continue; // (the quiet parts are mostly noise)
        for (let i = 0; i < size; i++) {
            re[i] = (frame.s + i < mono.length ? mono[frame.s + i] : 0) * win[i];
            im[i] = 0;
        }
        fft(re, im);
        for (let k = lowBin; k <= highBin; k++) {
            const pitch = 69 + 12 * Math.log2((k * rate) / size / 440);
            const near = Math.round(pitch);
            if (Math.abs(pitch - near) > 0.4) continue; // (between two notes: leakage, not a note)
            chroma[((near % 12) + 12) % 12] += Math.sqrt(Math.hypot(re[k], im[k]));
        }
    }
    return chroma;
}

function findKey(mono, rate) {
    const chroma = chromaOf(mono, rate);
    const total = chroma.reduce((a, b) => a + b, 0);
    if (total <= 0) return { chroma: Array(12).fill(0), tonic: 0, minor: false, score: 0, name: "NONE" };
    const mean = total / 12;
    let best = { score: -2, tonic: 0, minor: false };
    for (let tonic = 0; tonic < 12; tonic++) {
        for (const minor of [false, true]) {
            const profile = minor ? KEY_MINOR : KEY_MAJOR;
            const pm = profile.reduce((a, b) => a + b, 0) / 12;
            let num = 0;
            let dx = 0;
            let dy = 0;
            for (let i = 0; i < 12; i++) {
                const x = chroma[(tonic + i) % 12] - mean;
                const y = profile[i] - pm;
                num += x * y;
                dx += x * x;
                dy += y * y;
            }
            const score = dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
            if (score > best.score) best = { score, tonic, minor };
        }
    }
    return { chroma: Array.from(chroma, (v) => v / Math.max(...chroma)), tonic: best.tonic, minor: best.minor, score: best.score, name: NOTE_NAMES[best.tonic] + (best.minor ? " MIN" : " MAJ") };
}

// where the hits are: the spectrum is worked out every few milliseconds, and a hit is where it rises sharply (how much more of each pitch there is
// than a moment ago, added up), above what is usual round it. sensitivity (0 to 1) is how small a rise counts. Gives the times in seconds
function spectralFlux(mono, rate) {
    const size = 1024;
    const hop = 256;
    const win = hann(size);
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    let previous = new Float64Array(size / 2);
    const flux = [];
    const topBin = Math.min(size / 2, Math.floor((9000 * size) / rate));
    for (let s = 0; s + size <= mono.length; s += hop) {
        for (let i = 0; i < size; i++) {
            re[i] = mono[s + i] * win[i];
            im[i] = 0;
        }
        fft(re, im);
        let sum = 0;
        const now = new Float64Array(size / 2);
        for (let k = 1; k < topBin; k++) {
            const mag = Math.log1p(40 * Math.hypot(re[k], im[k]) / size * 8);
            now[k] = mag;
            if (mag > previous[k]) sum += mag - previous[k];
        }
        flux.push(sum);
        previous = now;
    }
    return { flux, hop, size };
}

function findHits(mono, rate, sensitivity) {
    const { flux, hop, size } = spectralFlux(mono, rate);
    if (flux.length < 8) return [];
    const times = [];
    const max = Math.max(...flux) || 1;
    const spread = 10;
    const factor = 1.15 + 2.4 * (1 - sensitivity) ** 1.5;
    const minGap = Math.round((0.05 * rate) / hop);
    let last = -minGap;
    for (let k = 2; k < flux.length - 2; k++) {
        let local = 0;
        let count = 0;
        for (let j = Math.max(0, k - spread); j <= Math.min(flux.length - 1, k + spread); j++) {
            local += flux[j];
            count++;
        }
        const threshold = (local / count) * factor + max * 0.04 * (1 - sensitivity);
        const isPeak = flux[k] > threshold && flux[k] >= flux[k - 1] && flux[k] >= flux[k + 1] && flux[k] > flux[k - 2] * 0.999;
        if (isPeak && k - last >= minGap) {
            // the hit is where the sound starts to rise most steeply, near the middle of the frame the spectrum jumped in (so the tail of an earlier
            // sound, still ringing, does not hide it): the sound's size is followed by a quick envelope, and the hit is the start of its biggest
            // rise over two milliseconds. Then back to where the wave crosses zero (so a chop does not start with a click)
            const centre = k * hop + size / 2;
            const from = Math.max(1, centre - Math.round(rate * 0.035));
            const to = Math.min(mono.length - 1, centre + Math.round(rate * 0.025));
            const span = Math.max(2, Math.round(rate * 0.002));
            let envelope = 0;
            const level = new Float32Array(to - from + 1);
            for (let i = from; i <= to; i++) {
                const v = Math.abs(mono[i]);
                envelope = v > envelope ? v : envelope * 0.995 + v * 0.005; // (up at once, down slowly)
                level[i - from] = envelope;
            }
            let quiet = centre;
            let steepest = 0;
            for (let i = 0; i + span < level.length; i++) {
                const rise = level[i + span] - level[i];
                if (rise > steepest) {
                    steepest = rise;
                    quiet = from + i;
                }
            }
            for (let i = quiet; i < Math.min(mono.length - 1, quiet + span); i++) {
                if (Math.abs(mono[i]) > steepest * 0.5) {
                    quiet = i;
                    break;
                }
            }
            for (let i = quiet; i > Math.max(1, quiet - Math.round(rate * 0.003)); i--) {
                if ((mono[i - 1] <= 0 && mono[i] > 0) || (mono[i - 1] >= 0 && mono[i] < 0)) {
                    quiet = i;
                    break;
                }
            }
            times.push(quiet / rate);
            last = k;
        }
    }
    return times;
}

// how many beats a sound is: the speed it ticks at (found from how often the hits repeat) is made to fit a whole number of beats over the length
// of the sound. Gives { beats (one of BEAT_CHOICES, or 0 if it is not like a loop), bpm }
function findBeats(mono, rate) {
    const duration = mono.length / rate;
    if (duration < 1.2) return { beats: 0, bpm: 0 };
    const { flux, hop } = spectralFlux(mono, rate);
    if (flux.length < 32) return { beats: 0, bpm: 0 };
    const mean = flux.reduce((a, b) => a + b, 0) / flux.length;
    const onset = flux.map((v) => Math.max(0, v - mean));
    const secondsPerFrame = hop / rate;
    let bestBpm = 0;
    let bestScore = -1;
    for (let bpm = 70; bpm <= 175; bpm += 0.5) {
        const lag = 60 / bpm / secondsPerFrame;
        let sum = 0;
        let count = 0;
        for (let multiple = 1; multiple <= 4; multiple++) {
            const l = lag * multiple;
            for (let i = 0; i + l + 1 < onset.length; i++) {
                const f = i + l;
                const a = Math.floor(f);
                sum += onset[i] * (onset[a] * (1 - (f - a)) + onset[a + 1] * (f - a));
                count++;
            }
        }
        const prior = Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.7) ** 2);
        const score = (sum / Math.max(1, count)) * prior;
        if (score > bestScore) {
            bestScore = score;
            bestBpm = bpm;
        }
    }
    // the choice of beats that makes the speed closest to what was heard (or half or double it)
    let best = { beats: 0, error: Infinity };
    for (const beats of BEAT_CHOICES) {
        if (beats === 0) continue;
        const implied = (beats * 60) / duration;
        if (implied < 55 || implied > 200) continue;
        const error = Math.min(Math.abs(Math.log2(implied / bestBpm)), Math.abs(Math.log2(implied / (bestBpm * 2))) + 0.02, Math.abs(Math.log2(implied / (bestBpm / 2))) + 0.02);
        if (error < best.error) best = { beats, error };
    }
    if (best.error > 0.12) return { beats: 0, bpm: bestBpm };
    return { beats: best.beats, bpm: (best.beats * 60) / duration };
}

// everything above on one sound: the data for the TUNE tab. Takes a moment for a long sound, so it lets the page breathe between the parts
async function analyseSample(data) {
    const mono = monoOf(data);
    const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
    const duration = mono.length / data.rate;
    // the middle of a long sound is looked at, not all of it
    const slice = duration > 40 ? mono.subarray(Math.floor(mono.length / 2 - data.rate * 20), Math.floor(mono.length / 2 + data.rate * 20)) : mono;
    await pause();
    const pitch = findPitch(slice.length > data.rate * 6 ? slice.subarray(0, data.rate * 6) : slice, data.rate);
    await pause();
    const key = findKey(slice, data.rate);
    await pause();
    const beats = findBeats(mono, data.rate);
    return { pitched: pitch.pitched, note: pitch.note, clarity: pitch.clarity, key, beats: beats.beats, bpm: beats.bpm };
}

// looks at the sound on a track and sets how it plays: a single note is played by pitch from the key it is on, and a longer sound is chopped
async function analyseAndSet(track) {
    const st = samplerState[track];
    if (!st || !st.data) return;
    st.message = "ANALYSING";
    samplerChanged(track, null);
    st.analysis = await analyseSample(st.data);
    const a = st.analysis;
    const s = trackSettings[track];
    // the key it is on (for a single note), the ROOT dial gets it, the cents go on FINE
    const note = a.pitched ? a.note : 60;
    const rounded = Math.round(note);
    s.sroot = (Math.min(96, Math.max(24, rounded)) - 24) / 72;
    s.sfine = 0.5 + (note - rounded) / 100;
    s.sshift = 0.5;
    s.sbeats = 0;
    s.srev = 0;
    s.sstart = 0;
    s.send = 1;
    if (a.pitched && st.duration < 6) {
        s.smode = 0; // PITCH
    } else {
        s.smode = 0.5; // CHOP
        st.chops = [0, ...findHits(monoOf(st.data), st.data.rate, s.ssens)].slice(0, 48);
        if (st.chops.length < 2) st.chops = equalChops(st.duration, 8);
        rechop(track);
    }
    st.message = "";
    st.viewWanted = "";
    if (typeof showTrackSettings === "function" && track === liveTrack) showTrackSettings();
    samplerChanged(track, null);
}

// looks at the sound again (the ANALYSE button): what it finds is shown on the TUNE tab, and a single note's ROOT and FINE are set to it
async function reanalyse(track) {
    const st = samplerState[track];
    if (!st || !st.data) return;
    st.message = "ANALYSING";
    samplerChanged(track, null);
    st.analysis = await analyseSample(st.data);
    const a = st.analysis;
    if (a.pitched) {
        const rounded = Math.round(a.note);
        const s = trackSettings[track];
        s.sroot = (Math.min(96, Math.max(24, rounded)) - 24) / 72;
        s.sfine = 0.5 + (a.note - rounded) / 100;
    }
    st.message = "";
    if (typeof showTrackSettings === "function" && track === liveTrack) showTrackSettings();
    samplerChanged(track, null);
}

// the chops of a sound cut into equal parts, or at its hits
function equalChops(duration, count) {
    return Array.from({ length: count }, (_, i) => (i * duration) / count);
}

// what the START and END dials say: seconds of the sound
function sampleTimeText(v) {
    const st = samplerState[liveTrack];
    return st && st.duration ? (v * st.duration).toFixed(2) + "s" : Math.round(v * 100) + "%";
}

// where, among the chops, a time is
function chopAt(chops, seconds) {
    let found = 0;
    chops.forEach((start, i) => {
        if (start <= seconds) found = i;
    });
    return found;
}

// ---- moving a sound into the key and the tempo of the song ----
// the shift (in semitones, -6 to 5) that brings a key into the song's: the notes of the sample's key against the notes of the song's scale,
// the most that fit wins, and the same tonic is better
function matchShift(key) {
    const sampleSteps = key.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    const song = new Set(SCALES[ledScale].steps.map((step) => (ledRoot + step) % 12));
    let best = { shift: 0, score: -1 };
    for (let shift = -6; shift <= 5; shift++) {
        const moved = sampleSteps.map((step) => (key.tonic + step + shift + 120) % 12);
        let score = moved.filter((pc) => song.has(pc)).length * 10;
        if ((key.tonic + shift + 120) % 12 === ledRoot) score += 5;
        score -= Math.abs(shift) * 0.01;
        if (score > best.score) best = { shift, score };
    }
    return best.shift;
}

// the pieces of sound (in samples) that are put together again more or less slowly, and how much they overlap, in the WSOLA time stretch
async function stretchSound(channels, rate, factor, progress) {
    const n = channels[0].length;
    const N = Math.round((rate * 0.046) / 2) * 2; // a piece is about 46ms
    const Hs = N / 2; // the pieces go into the result this far apart
    const Ha = Hs / factor; // and come from the sound this far apart
    const D = 4;
    const reach = Math.round(rate * 0.013); // each piece may move this far to line up better with the one before it
    // a quieter, shorter copy to look for the best place in (a quarter of the samples, the channels together)
    const ms = new Float32Array(Math.ceil(n / D));
    for (let i = 0; i < ms.length; i++) {
        let sum = 0;
        for (let k = 0; k < D && i * D + k < n; k++) for (let c = 0; c < channels.length; c++) sum += channels[c][i * D + k];
        ms[i] = sum / (D * channels.length);
    }
    const win = hann(N);
    const outLength = Math.ceil(n * factor) + N * 2;
    const out = channels.map(() => new Float32Array(outLength));
    const M = N / D;
    const search = Math.round(reach / D);
    let previous = 0;
    let frame = 0;
    for (;;) {
        const nominal = Math.round(frame * Ha);
        if (nominal >= n - N / 2) break;
        let chosen = Math.min(n - N, Math.max(0, nominal));
        if (frame > 0) {
            const natural = Math.min(n - N, previous + Hs);
            const target = Math.floor(natural / D);
            const around = Math.floor(nominal / D);
            let bestScore = -Infinity;
            let bestAt = around;
            for (let d = -search; d <= search; d++) {
                const at = around + d;
                if (at < 0 || (at + M) * D > n - 1) continue;
                let dot = 0;
                let energy = 1e-9;
                for (let i = 0; i < M; i++) {
                    const v = ms[at + i];
                    dot += v * ms[target + i];
                    energy += v * v;
                }
                const score = dot / Math.sqrt(energy);
                if (score > bestScore) {
                    bestScore = score;
                    bestAt = at;
                }
            }
            chosen = Math.min(n - N, Math.max(0, bestAt * D));
        }
        const base = frame * Hs;
        for (let c = 0; c < channels.length; c++) {
            const source = channels[c];
            const dest = out[c];
            for (let i = 0; i < N; i++) {
                const w = frame === 0 && i < Hs ? 1 : win[i];
                dest[base + i] += source[chosen + i] * w;
            }
        }
        previous = chosen;
        frame++;
        if (frame % 24 === 0) {
            if (progress) progress(Math.min(1, nominal / n));
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }
    return out.map((ch) => ch.subarray(0, Math.ceil(n * factor)));
}

// the sound read p times faster (so p times higher), through a curve between the four samples round each place. Sped up, what is above the new
// top pitch is filtered out first so it does not fold back as a whine
function speedUp(x, p) {
    let source = x;
    if (p > 1.0001) {
        const cutoff = 0.46 / p;
        const taps = 96;
        const half = taps / 2;
        const kernel = new Float64Array(taps + 1);
        let sum = 0;
        for (let i = 0; i <= taps; i++) {
            const t = i - half;
            const sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
            kernel[i] = sinc * (0.42 - 0.5 * Math.cos((2 * Math.PI * i) / taps) + 0.08 * Math.cos((4 * Math.PI * i) / taps));
            sum += kernel[i];
        }
        for (let i = 0; i <= taps; i++) kernel[i] /= sum;
        source = new Float32Array(x.length);
        for (let i = 0; i < x.length; i++) {
            let acc = 0;
            for (let k = 0; k <= taps; k++) {
                const j = i + k - half;
                if (j >= 0 && j < x.length) acc += x[j] * kernel[k];
            }
            source[i] = acc;
        }
    }
    const length = Math.max(1, Math.floor((source.length - 1) / p));
    const out = new Float32Array(length);
    const last = source.length - 1;
    for (let i = 0; i < length; i++) {
        const position = i * p;
        const k = Math.floor(position);
        const f = position - k;
        const a = source[Math.max(0, k - 1)];
        const b = source[k];
        const c = source[Math.min(last, k + 1)];
        const d = source[Math.min(last, k + 2)];
        out[i] = b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)));
    }
    return out;
}

function fitLength(x, length) {
    if (x.length === length) return x;
    const out = new Float32Array(length);
    out.set(x.subarray(0, Math.min(length, x.length)));
    return out;
}

// a sound made longer or shorter (ratio: 1 is as it was, 2 twice as long) and moved up or down (semitones) without changing the other
async function processSound(data, ratio, semitones, progress) {
    const p = 2 ** (semitones / 12);
    const factor = ratio * p; // stretched this much first, then sped up by p, so it comes out ratio times as long
    let channels = data.channels;
    if (Math.abs(factor - 1) > 0.0005) channels = await stretchSound(channels, data.rate, factor, progress);
    if (Math.abs(p - 1) > 0.0001) channels = channels.map((ch) => speedUp(ch, p));
    const length = Math.round(data.channels[0].length * ratio);
    return { rate: data.rate, channels: channels.map((ch) => fitLength(ch, length)) };
}

// ---- what a track plays ----
// the key that says which processed copy a track wants: the tempo match, the key match and the direction
function viewKeyOf(track) {
    const st = samplerState[track];
    const s = trackSettings[track];
    if (!st || !st.data) return "";
    const beats = sampleBeats(s.sbeats);
    const ratio = beats > 0 ? (beats * 60) / bpm / st.duration : 1;
    return ratio.toFixed(4) + "|" + sampleShift(s.sshift) + "|" + (s.srev >= 0.5 ? 1 : 0);
}

function reversedCopy(data) {
    return { rate: data.rate, channels: data.channels.map((ch) => Float32Array.from(ch).reverse()) };
}

// what plays, made from a processed sound: the audio buffer, and the chops moved to where they are in it
function makeView(st, data, ratio, semis, reverse) {
    const source = reverse ? reversedCopy(data) : data;
    const buffer = new AudioBuffer({ length: source.channels[0].length, numberOfChannels: source.channels.length, sampleRate: source.rate });
    source.channels.forEach((ch, c) => buffer.copyToChannel(ch, c));
    const duration = source.channels[0].length / source.rate;
    return { buffer, duration, chops: chopsInView(st, duration, ratio, reverse), ratio, semis, reverse, forward: data, key: ratio.toFixed(4) + "|" + semis + "|" + (reverse ? 1 : 0) };
}

// where each chop is in a view: [start, end] in seconds of its buffer (the chops are kept as they are in the sound as it was loaded, a stretched
// sound has them moved by the ratio, and in a reversed one each is turned round)
function chopsInView(st, duration, ratio, reverse) {
    return st.chops.map((start, i) => {
        const a = Math.min(duration, start * ratio);
        const b = Math.min(duration, (i + 1 < st.chops.length ? st.chops[i + 1] : st.duration) * ratio);
        return reverse ? [duration - b, duration - a] : [a, b];
    });
}

// the chops of a track were changed (a marker added, moved or taken away): the view that plays has them in their new places
function rechop(track) {
    const st = samplerState[track];
    if (!st) return;
    st.chops = [...new Set([0, ...st.chops.map((c) => Math.max(0, Math.min(st.duration - 0.01, c)))])].sort((x, y) => x - y).slice(0, 64);
    if (st.view) st.view.chops = chopsInView(st, st.view.duration, st.view.ratio, st.view.reverse);
}

// works out the processed copy a track wants (if it is not there yet) and then swaps it in. A dial being turned asks again and again, so it waits
// until the dial has been still for a moment
function wantView(track, now = false) {
    const st = samplerState[track];
    if (!st || !st.data) return Promise.resolve(null);
    const wanted = viewKeyOf(track);
    if (st.view && st.view.key === wanted) {
        st.working = null;
        return Promise.resolve(st.view);
    }
    st.viewWanted = wanted;
    clearTimeout(st.timer);
    return new Promise((resolve) => {
        const run = async () => {
            const key = st.viewWanted;
            const [ratioText, semisText, reverseText] = key.split("|");
            const ratio = Number(ratioText);
            const semis = Number(semisText);
            const reverse = reverseText === "1";
            const baseKey = ratioText + "|" + semisText;
            let processed = st.cache.get(baseKey);
            if (!processed) {
                st.working = 0;
                samplerChanged(track, null);
                processed = await processSound(st.data, ratio, semis, (done) => {
                    st.working = done;
                    samplerChanged(track, null, true);
                });
                st.cache.set(baseKey, processed);
                if (st.cache.size > 4) st.cache.delete(st.cache.keys().next().value);
            }
            st.working = null;
            if (key === st.viewWanted) {
                st.view = makeView(st, processed, ratio, semis, reverse);
                st.peaks = null;
            }
            samplerChanged(track, null);
            resolve(st.view);
        };
        if (now) run();
        else st.timer = setTimeout(run, 350);
    });
}

// the view a track plays right now (the last one that is ready: a new one is on its way if the dials have moved)
function samplerView(track) {
    const st = samplerState[track];
    if (!st || !st.data) return null;
    if (!st.view) st.view = makeView(st, st.data, 1, 0, false);
    if (st.view.key !== viewKeyOf(track) && st.viewWanted !== viewKeyOf(track)) wantView(track);
    return st.view;
}

// every sampler track's view made ready (the song is made into a file only once they are)
async function prepareSamplers() {
    for (let t = 0; t < MAX_TRACKS; t++) if (samplerState[t] && samplerState[t].data && isSampler(t)) await wantView(t, true);
}

// what a key plays on a sampler track: null for nothing (no sound loaded, or a key with no chop), or
// { buffer, offset, duration, loop, loopStart, loopEnd, rootHz } in seconds of the buffer. frequency is the key's own pitch
function samplerVoice(track, noteNumber, frequency) {
    const view = samplerView(track);
    if (!view) return null;
    const s = trackSettings[track];
    const mode = sampleMode(s);
    if (mode === 1) {
        const at = noteNumber - sampleBase(s.sbase);
        if (at < 0 || at >= view.chops.length) return null;
        const [a, b] = view.chops[at];
        if (b - a < 0.002) return null;
        return { buffer: view.buffer, offset: a, duration: b - a, loop: false, rootHz: frequency }; // (the chop's own speed: the track's OCT and SEMI are all that move it)
    }
    let lo = view.duration * s.sstart;
    let hi = view.duration * s.send;
    if (view.reverse) [lo, hi] = [view.duration - hi, view.duration - lo];
    if (hi - lo < 0.005) hi = Math.min(view.duration, lo + 0.005);
    const rootHz = 440 * 2 ** ((sampleRoot(s.sroot) + sampleFine(s.sfine) / 100 - 69) / 12);
    return mode === 2
        ? { buffer: view.buffer, offset: lo, duration: undefined, loop: true, loopStart: lo, loopEnd: hi, rootHz }
        : { buffer: view.buffer, offset: lo, duration: hi - lo, loop: false, rootHz };
}

// a sample as a sound source, made like an oscillator: it has a frequency (the pitch it plays at, a signal in Hz that moves the speed), a detune,
// and start, stop and ended. The speed is the frequency over the one the sample is at
class SampleSource {
    constructor(context, voice) {
        this.voice = voice;
        this.source = context.createBufferSource();
        this.source.buffer = voice.buffer;
        this.source.loop = voice.loop;
        if (voice.loop) {
            this.source.loopStart = voice.loopStart;
            this.source.loopEnd = voice.loopEnd;
        }
        this.source.playbackRate.value = 0; // (all of the speed comes from the frequency below)
        this.pitch = context.createConstantSource();
        this.pitch.offset.value = voice.rootHz;
        const scale = context.createGain();
        scale.gain.value = 1 / voice.rootHz;
        this.pitch.connect(scale);
        scale.connect(this.source.playbackRate);
        this.frequency = this.pitch.offset;
        this.detune = this.source.detune;
        this.source.addEventListener("ended", () => {
            try {
                this.pitch.stop();
            } catch {}
            this.pitch.disconnect();
            scale.disconnect();
        });
    }

    connect(node) {
        this.source.connect(node);
    }

    start(when) {
        this.pitch.start(when);
        if (this.voice.duration !== undefined) this.source.start(when, this.voice.offset, this.voice.duration);
        else this.source.start(when, this.voice.offset);
    }

    stop(when) {
        try {
            this.source.stop(when);
        } catch {}
        try {
            this.pitch.stop(when);
        } catch {}
    }

    addEventListener(type, listener) {
        this.source.addEventListener(type, listener);
    }
}

// ---- what a song keeps ----
// the part of a track's sampler that goes in a song: no sound (it is in the browser), only what is about it
function samplerMeta(track) {
    const st = samplerState[track];
    if (!st || !st.id) return null;
    const a = st.analysis;
    return {
        id: st.id,
        name: st.name,
        duration: Math.round(st.duration * 1000) / 1000,
        chops: st.chops.map((c) => Math.round(c * 10000) / 10000),
        analysis: a ? { pitched: a.pitched, note: Math.round(a.note * 100) / 100, clarity: Math.round(a.clarity * 100) / 100, beats: a.beats, bpm: Math.round(a.bpm * 10) / 10, key: { tonic: a.key.tonic, minor: a.key.minor, score: Math.round(a.key.score * 100) / 100, name: a.key.name, chroma: a.key.chroma.map((v) => Math.round(v * 100) / 100) } } : null,
    };
}

// a sampler from a song file or the browser's storage, made safe to use (a file can be anything)
function cleanSamplerMeta(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{1,10}$/.test(raw.id)) return null;
    const duration = typeof raw.duration === "number" && raw.duration > 0 && raw.duration <= SAMPLE_MAX_SECONDS ? raw.duration : 1;
    let chops = Array.isArray(raw.chops) ? raw.chops.filter((c) => typeof c === "number" && Number.isFinite(c) && c >= 0 && c < duration).slice(0, 64) : [];
    chops = [...new Set([0, ...chops])].sort((a, b) => a - b);
    let analysis = null;
    const a = raw.analysis;
    if (a && typeof a === "object" && a.key && typeof a.key === "object") {
        const num = (v, lo, hi, usual) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : usual);
        const tonic = Number.isInteger(a.key.tonic) && a.key.tonic >= 0 && a.key.tonic < 12 ? a.key.tonic : 0;
        const minor = a.key.minor === true;
        analysis = {
            pitched: a.pitched === true,
            note: num(a.note, 0, 127, 60),
            clarity: num(a.clarity, 0, 1, 0),
            beats: BEAT_CHOICES.includes(a.beats) ? a.beats : 0,
            bpm: num(a.bpm, 0, 400, 0),
            key: {
                tonic,
                minor,
                score: num(a.key.score, -1, 1, 0),
                name: NOTE_NAMES[tonic] + (minor ? " MIN" : " MAJ"),
                chroma: Array.isArray(a.key.chroma) && a.key.chroma.length === 12 ? a.key.chroma.map((v) => num(v, 0, 1, 0)) : Array(12).fill(0),
            },
        };
    }
    return { id: raw.id, name: typeof raw.name === "string" ? raw.name.slice(0, 24) : "SAMPLE", duration, chops, analysis };
}

// puts the samplers of a song on the tracks (save.js calls this when a song is shown): the sounds are fetched from the browser, and a track whose
// sound is not there says so (the song still plays, that track is quiet)
function showSamplers(metas) {
    for (let t = 0; t < MAX_TRACKS; t++) {
        const meta = metas ? metas[t] : null;
        const old = samplerState[t];
        if (!meta) {
            samplerState[t] = null;
            continue;
        }
        if (old && old.id === meta.id && old.data) {
            // (the same sound: the chops and the findings of the song are put on it)
            old.chops = meta.chops;
            old.analysis = meta.analysis;
            old.name = meta.name;
            old.view = null;
            old.viewWanted = "";
            continue;
        }
        const st = emptySampler();
        st.id = meta.id;
        st.name = meta.name;
        st.duration = meta.duration;
        st.chops = meta.chops;
        st.analysis = meta.analysis;
        st.missing = true;
        samplerState[t] = st;
        findSample(meta.id).then((data) => {
            if (samplerState[t] !== st) return;
            if (data) {
                st.data = data;
                st.duration = data.channels[0].length / data.rate;
                st.missing = false;
                st.view = makeView(st, data, 1, 0, false);
                st.viewWanted = "";
                wantView(t, true);
            }
            samplerChanged(t, null);
        });
    }
}

// a dial of the sampler moved, or something about it changed (the UI is in samplerui.js)
function samplerChanged(track, key, quiet) {
    if (key === "sshift" || key === "sbeats" || key === "srev") wantView(track);
    if (typeof refreshSamplerUi === "function") refreshSamplerUi(track, quiet);
    if (track === liveTrack && typeof updateLeds === "function") updateLeds(); // (a chop's keys are lit above the piano)
}

// the tempo changed: a sample matched to the tempo is worked out again
function samplerTempoChanged() {
    for (let t = 0; t < MAX_TRACKS; t++) {
        const st = samplerState[t];
        if (st && st.data && sampleBeats(trackSettings[t].sbeats) > 0) wantView(t);
    }
}
