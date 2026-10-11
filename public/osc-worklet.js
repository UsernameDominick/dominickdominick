// The oscillator of the synth, as an AudioWorklet (code that runs on the audio thread and makes the sound itself, sample by sample).
// One of these makes one layer of a note: a wave (sine, triangle, saw, square or pulse), with
//   unison  up to 16 copies of it, spread apart in pitch (uniDetune, in cents, from the lowest to the highest) and across the speakers (spread),
//   PW      the width of a square (0.5 is a plain square; narrower is hollow and reedy),
//   SUB     a square wave an octave under it, and
//   NOISE   a hiss added to it.
//
// How the waves are made without aliasing. A saw wave is a sine at the note, plus a sine at twice the pitch (half as loud), plus one at three
// times (a third as loud) and so on for ever. A computer can't make the ones above half its sample rate: they would fold back down as harsh,
// out-of-tune whistles (aliasing). So each wave is built from tables, one for every number of those sines (1, 2, 3 ... up to 1024), made once
// when this file loads. A note picks the table with as many sines as fit under half the sample rate for its pitch, and slides smoothly between two
// neighbouring tables so the sound doesn't jump as the pitch moves (a pitch bend, vibrato). The tables are read with a four point curve through
// the samples, which keeps the reading clean. A square or a pulse is a saw minus the same saw a bit later in its cycle, so it is clean too and
// its width (PW) can be moved smoothly.
//
// It is used the way an OscillatorNode is: frequency and detune are parameters other signals (the pitch wheel, vibrato) can be plugged into.
// It starts at a time and stops at a time, to the exact sample, and says "ended" when it has stopped (see makeOsc in synth.js).

const TWO_PI = Math.PI * 2;
const RATE = sampleRate; // (read once: reading sampleRate again and again is slow, each time is a call into the browser)
const NYQUIST = RATE * 0.5;
const WAVE_IDS = { sawtooth: 0, square: 1, triangle: 2, sine: 3 };
const SIZE = 2048; // samples in a table
const LOUDNESS = 0.853; // a saw or a square this loud is as loud as the browser's own (which is scaled so its tallest point is 1)

// ---- the tables ----
// a table has the samples of one wave, with one more in front and two after (the four point curve reads a neighbour each side)
function makeTable(samples) {
    const t = new Float32Array(SIZE + 3);
    t[0] = samples[SIZE - 1];
    for (let i = 0; i < SIZE; i++) t[i + 1] = samples[i];
    t[SIZE + 1] = samples[0];
    t[SIZE + 2] = samples[1];
    return t;
}

const SINE_STEPS = new Float64Array(SIZE);
for (let i = 0; i < SIZE; i++) SINE_STEPS[i] = Math.sin((TWO_PI * i) / SIZE);

// the saw tables: sawTable[m] has the first m sines (m = 0 is silence), for every m up to 48, then a table every 5% more up to 1024
const SAW_FIRST = 48;
const SAW_GROW = 1.05;
const sawSines = [0];
for (let m = 1; m <= SAW_FIRST; m++) sawSines.push(m);
for (let m = SAW_FIRST * SAW_GROW; m < 1024; m *= SAW_GROW) sawSines.push(Math.floor(m));
sawSines.push(1024);
const sawTable = [];
{
    const sum = new Float64Array(SIZE);
    let added = 0;
    sawSines.forEach((count) => {
        for (let j = added + 1; j <= count; j++) {
            const amount = (-2 / Math.PI / j) * LOUDNESS;
            for (let i = 0; i < SIZE; i++) sum[i] += amount * SINE_STEPS[(j * i) & (SIZE - 1)];
        }
        added = Math.max(added, count);
        sawTable.push(makeTable(sum));
    });
}

// the triangle: only the odd sines, each very quiet (one over the square of its number), so 63 tables are plenty
const TRI_MAX = 63;
const triTable = [];
{
    const sum = new Float64Array(SIZE);
    triTable.push(makeTable(sum));
    for (let m = 1; m <= TRI_MAX; m++) {
        if (m % 2 === 1) {
            const amount = ((8 / (Math.PI * Math.PI)) * (m % 4 === 1 ? 1 : -1)) / (m * m);
            for (let i = 0; i < SIZE; i++) sum[i] += amount * SINE_STEPS[(m * i) & (SIZE - 1)];
        }
        triTable.push(makeTable(sum));
    }
}

// which saw table has the most sines that still fit (for h sines under half the sample rate), as an index into sawTable
function sawLevel(h) {
    let lo = 0;
    let hi = sawSines.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (sawSines[mid] <= h) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

// the four point curve through a table at this place round the wave (phase, 0 up to 1)
function read(table, phase) {
    const x = phase * SIZE;
    const i = x | 0;
    const f = x - i;
    const a = table[i];
    const b = table[i + 1];
    const c = table[i + 2];
    const d = table[i + 3];
    return b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)));
}

// how loud each copy of a unison is, so more copies don't get much louder: the same as the old three-copy detune for up to three, and
// then quieter for each one added
function unisonGain(count) {
    return count <= 3 ? 1 / count : 1 / Math.sqrt(3 * count);
}

class SynthOsc extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: "frequency", defaultValue: 440, minValue: 0, maxValue: 24000, automationRate: "a-rate" },
            { name: "detune", defaultValue: 0, minValue: -9600, maxValue: 9600, automationRate: "a-rate" },
            { name: "pw", defaultValue: 0.5, minValue: 0.02, maxValue: 0.98, automationRate: "k-rate" },
            { name: "sub", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
            { name: "noise", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
        ];
    }

    constructor(options) {
        super();
        const o = options.processorOptions || {};
        this.wave = WAVE_IDS[o.wave] === undefined ? 0 : WAVE_IDS[o.wave];
        this.count = Math.max(1, Math.min(16, Math.round(o.uni || 1)));
        this.startFrame = Math.round((o.startTime || 0) * RATE);
        // (a note in a file is told when it stops here, because messages are not heard while a file is made)
        this.stopFrame = o.stopTime > 0 && o.stopTime < Infinity ? Math.round(o.stopTime * RATE) : Infinity;
        this.ended = false;
        this.gain = unisonGain(this.count);

        // each copy: how far round the wave it is, its tuning (a ratio) and where it is in the speakers (a left and a right level).
        // The copies start at spread-out places in the wave, always the same ones, so a note sounds the same every time it is played
        const count = this.count;
        this.phase = new Float64Array(count);
        this.ratio = new Float64Array(count);
        this.left = new Float64Array(count);
        this.right = new Float64Array(count);
        // the tables each copy reads right now (worked out once for each block of sound, not for every sample): two, and how much of the
        // second to mix in
        this.tableA = new Array(count).fill(sawTable[0]);
        this.tableB = new Array(count).fill(sawTable[0]);
        this.mix = new Float64Array(count);
        this.pickedA = sawTable[0]; // (what pick() found)
        this.pickedB = sawTable[0];
        this.pickedMix = 0;
        const uniDetune = o.uniDetune || 0;
        const spread = Math.max(0, Math.min(1, o.spread || 0));
        const order = count % 7 === 0 ? 1 : 7; // (which copy goes where in the speakers, so the high ones aren't all on one side)
        for (let i = 0; i < count; i++) {
            const p = count === 1 ? 0 : (i / (count - 1)) * 2 - 1; // -1 (lowest) to 1 (highest)
            this.ratio[i] = 2 ** ((p * uniDetune) / 1200);
            this.phase[i] = count === 1 ? 0 : ((((i + 1) * 0.6180339887 + (o.seed || 0) * 0.3819660113) % 1) + 1) % 1;
            const q = count === 1 ? 0 : (((i * order) % count) / (count - 1)) * 2 - 1;
            const angle = ((q * spread + 1) * Math.PI) / 4; // equal power: the sound is as loud in the middle as at the sides
            this.left[i] = Math.cos(angle);
            this.right[i] = Math.sin(angle);
        }
        this.subPhase = 0;
        this.subA = sawTable[0];
        this.subB = sawTable[0];
        this.subMix = 0;
        this.noiseState = (((o.seed || 1) * 2654435761 + 1) >>> 0) || 1;

        this.port.onmessage = (e) => {
            if (e.data && e.data.type === "stop") this.stopFrame = Math.round(e.data.time * RATE);
        };
    }

    // white noise, from a quick random number generator
    nextNoise() {
        let x = this.noiseState;
        x ^= x << 13;
        x >>>= 0;
        x ^= x >>> 17;
        x ^= x << 5;
        x >>>= 0;
        this.noiseState = x;
        return x / 2147483648 - 1;
    }

    // picks the tables for a wave (0 saw or square, 2 triangle) with h sines under half the sample rate: the answer is left in pickedA,
    // pickedB and pickedMix (two tables, and how much of the second to mix in)
    pick(wave, h) {
        let a;
        let b;
        let mix = 0;
        if (wave === 2) {
            if (h >= TRI_MAX) a = b = triTable[TRI_MAX];
            else if (h < 1) a = b = triTable[0];
            else {
                const m = h | 0;
                a = triTable[m - 1];
                b = triTable[m];
                mix = h - m;
            }
        } else if (h >= 1024) {
            a = b = sawTable[sawTable.length - 1];
        } else if (h >= SAW_FIRST) {
            a = b = sawTable[sawLevel(h)];
        } else if (h < 1) {
            a = b = sawTable[0];
        } else {
            const m = h | 0;
            a = sawTable[m - 1];
            b = sawTable[m];
            mix = h - m;
        }
        this.pickedA = a;
        this.pickedB = b;
        this.pickedMix = mix;
    }

    process(inputs, outputs, parameters) {
        const out = outputs[0];
        const left = out[0];
        const right = out.length > 1 ? out[1] : left;
        const size = left.length;
        if (this.ended) return false;

        const first = currentFrame;
        // nothing yet (before the note starts)
        if (first + size <= this.startFrame) return true;
        // nothing more (after it has stopped)
        if (first >= this.stopFrame) {
            this.ended = true;
            this.port.postMessage("ended");
            return false;
        }

        const freq = parameters.frequency;
        const detune = parameters.detune;
        const moving = freq.length > 1 || detune.length > 1; // (the pitch changes during this block: a bend, a glide, vibrato)
        const pw = parameters.pw[0];
        const subLevel = parameters.sub[0];
        const noiseLevel = parameters.noise[0];
        const from = Math.max(0, this.startFrame - first);
        const to = Math.min(size, this.stopFrame - first);
        const count = this.count;
        const gain = this.gain;
        const wave = this.wave;
        const phase = this.phase;
        const ratio = this.ratio;
        const gl = this.left;
        const gr = this.right;
        const tableA = this.tableA;
        const tableB = this.tableB;
        const mixes = this.mix;
        const invRate = 1 / RATE;

        // the pitch at the start of the block: the tables are picked from it (it changes too little in a block to matter)
        let base = freq[from < freq.length ? from : 0] * 2 ** (detune[from < detune.length ? from : 0] / 1200);
        if (wave !== 3) {
            for (let v = 0; v < count; v++) {
                const hz = base * ratio[v];
                this.pick(wave, hz > 0 ? NYQUIST / hz : 0);
                tableA[v] = this.pickedA;
                tableB[v] = this.pickedB;
                mixes[v] = this.pickedMix;
            }
        }
        if (subLevel > 0) {
            // (the sub wave is always a square, made from the saw tables)
            this.pick(0, base > 0 ? NYQUIST / (base * 0.5) : 0);
            this.subA = this.pickedA;
            this.subB = this.pickedB;
            this.subMix = this.pickedMix;
        }

        for (let n = from; n < to; n++) {
            if (moving) base = (freq.length > 1 ? freq[n] : freq[0]) * 2 ** ((detune.length > 1 ? detune[n] : detune[0]) / 1200);
            let l = 0;
            let r = 0;
            if (base > 0 && base < NYQUIST) {
                const step = base * invRate;
                for (let v = 0; v < count; v++) {
                    let p = phase[v];
                    let s;
                    if (wave === 3) {
                        s = Math.sin(TWO_PI * p);
                    } else if (wave === 1) {
                        // a saw minus the same saw a little later (pw is how far later): a pulse with nothing added to it
                        let q = p + pw;
                        if (q >= 1) q -= 1;
                        const a = tableA[v];
                        s = read(a, p) - read(a, q);
                        const f = mixes[v];
                        if (f > 0) {
                            const b = tableB[v];
                            s += (read(b, p) - read(b, q) - s) * f;
                        }
                    } else {
                        s = read(tableA[v], p);
                        const f = mixes[v];
                        if (f > 0) s += (read(tableB[v], p) - s) * f;
                    }
                    s *= gain;
                    l += s * gl[v];
                    r += s * gr[v];
                    p += step * ratio[v];
                    if (p >= 1) p -= 1;
                    phase[v] = p;
                }
                if (subLevel > 0) {
                    // a square an octave under the note
                    let sp = this.subPhase;
                    let q = sp + 0.5;
                    if (q >= 1) q -= 1;
                    let s = read(this.subA, sp) - read(this.subA, q);
                    if (this.subMix > 0) s += (read(this.subB, sp) - read(this.subB, q) - s) * this.subMix;
                    sp += step * 0.5;
                    if (sp >= 1) sp -= 1;
                    this.subPhase = sp;
                    const level = s * subLevel * 0.5;
                    l += level;
                    r += level;
                }
            }
            if (noiseLevel > 0) {
                const hiss = this.nextNoise() * noiseLevel * 0.35;
                l += hiss;
                r += hiss;
            }
            left[n] = l;
            right[n] = r;
        }

        if (first + size >= this.stopFrame) {
            this.ended = true;
            this.port.postMessage("ended");
            return false;
        }
        return true;
    }
}

registerProcessor("synth-osc", SynthOsc);
