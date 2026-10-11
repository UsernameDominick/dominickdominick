// The filter of the synth, as an AudioWorklet (code that runs on the audio thread and works on the sound sample by sample).
// Every note goes through one of these. It has three models and five types:
//   SVF 12   a two pole state variable filter (12dB for every octave past the cutoff). It follows the same curve as the browser's own filter at
//            the same settings, so a song that was made with that one sounds the same, and it stays smooth and quiet when the cutoff moves fast
//   SVF 24   two of them one after the other (24dB an octave), tuned so that with no resonance the bend at the cutoff is flat and even
//   LADDER   four one pole stages in a loop, like the filter in a Minimoog (24dB an octave). Resonance eats the low notes a little and, turned
//            all the way up, makes it ring by itself. The loop squashes loud sound as it goes round, which is where its warm, thick sound is from
//   LP low pass, HP high pass, BP band pass, NOTCH (takes out a band) and PEAK (turns a band up and takes the rest down a little)
// DRIVE pushes the sound into a soft squash before the filter (and inside the ladder's loop). A squash makes tones that fold back down as harsh
// whistles (aliasing), so with DRIVE up, and always for the ladder, it works at twice the sample rate and filters the extra off on the way
// back down (a long, even filter that lets only the lower half through, which is what costs the little delay).
// The cutoff is frequency (in Hz, so it can follow a fade made with exponential ramps) and detune (in cents, which the dials, the mouse and the
// keyboard track add to). resonance is in dB, 0 to 12 on the RES dial (and a little more is possible): the same numbers the old filter had.
// All of the maths is the zero delay feedback kind: the filter is worked out exactly for each sample, so it stays stable when the cutoff is
// changed quickly (the "zipper" noise and blow-ups of the usual filters).

const RATE = sampleRate; // (read once: reading sampleRate again and again is slow, each time is a call into the browser)
const TWO_PI = Math.PI * 2;

// the long, even filter used to go up to twice the sample rate and down again. It lets through the lower half of the band and keeps out the
// upper half (a "half band" filter), 31 points long. Only its odd points are not zero, so only those are used. Made with a Kaiser window
const HALF_BAND = (() => {
    const taps = new Float64Array(8); // taps[j] is the point at distance 2j+1 from the middle
    const beta = 8;
    const bessel = (x) => {
        let sum = 1;
        let term = 1;
        for (let k = 1; k < 30; k++) {
            term *= (x / (2 * k)) * (x / (2 * k));
            sum += term;
        }
        return sum;
    };
    for (let j = 0; j < 8; j++) {
        const n = 2 * j + 1;
        const ideal = Math.sin((Math.PI * n) / 2) / (Math.PI * n);
        const window = bessel(beta * Math.sqrt(1 - (n / 16) * (n / 16))) / bessel(beta);
        taps[j] = ideal * window;
    }
    return taps;
})();

// a quick close fit to tanh (the squash): the real one is slow to work out for every sample. Exact at 0, within 0.002 everywhere
function squash(x) {
    if (x > 3) return 1;
    if (x < -3) return -1;
    const x2 = x * x;
    return (x * (27 + x2)) / (27 + 9 * x2);
}

class SynthFilter extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: "frequency", defaultValue: 1000, minValue: 10, maxValue: 24000, automationRate: "a-rate" },
            { name: "detune", defaultValue: 0, minValue: -19200, maxValue: 19200, automationRate: "a-rate" },
            { name: "resonance", defaultValue: 0, minValue: 0, maxValue: 24, automationRate: "k-rate" },
            { name: "drive", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
        ];
    }

    constructor(options) {
        super();
        const o = options.processorOptions || {};
        this.model = o.model || 0; // 0 SVF 12, 1 SVF 24, 2 LADDER
        this.mode = o.mode || 0; // 0 LP, 1 HP, 2 BP, 3 NOTCH, 4 PEAK
        this.quiet = 0; // how many blocks in a row there has been nothing coming in and nothing going out
        // when the note is over the filter is stopped (a ladder that rings by itself would otherwise ring for ever): it is told when, as the
        // oscillator is, and fades out over the last bit so it doesn't click
        this.stopFrame = o.stopTime > 0 && o.stopTime < Infinity ? Math.round(o.stopTime * RATE) : Infinity;
        // the filter's memory, for each of the two speakers: [0 1] the first state variable stage, [2 3] the second, [4 5 6 7] the ladder
        this.state = new Float64Array(16);
        // for going up and down in rate: the last sound that came in and the last sound that went out (a ring of 32), for each speaker
        this.inHistory = [new Float64Array(32), new Float64Array(32)];
        this.outHistory = [new Float64Array(32), new Float64Array(32)];
        this.position = 0; // where in the rings the next sample goes
        this.fastLoudest = 0; // (what the fast loop found in the block)
        this.fastQuietIn = true;
        this.g = 0; // the filter's step for this sample (the tangent form, and the one pole stage's form)
        this.G = 0;
        this.k1 = 1;
        this.k2 = 1;
        this.stages = 1;
        this.ladderK = 0;
        this.pre = 1;
        this.norm = 1;
        this.port.onmessage = (e) => {
            if (e.data && e.data.type === "config") {
                this.model = e.data.model;
                this.mode = e.data.mode;
            } else if (e.data && e.data.type === "stop") {
                this.stopFrame = Math.round(e.data.time * RATE);
            }
        };
    }

    // one sample through the state variable filter (two stages if there are two). x is the sound in, the memory is for this speaker
    // (offset is where it starts in the state). Gives back the sound out
    svf(x, offset, g, k1, k2, stages, mode) {
        const s = this.state;
        let v0 = x;
        for (let stage = 0; stage < stages; stage++) {
            const k = stage === 0 ? k1 : k2;
            const a1 = 1 / (1 + g * (g + k));
            const a2 = g * a1;
            const a3 = g * a2;
            const base = offset + stage * 2;
            const ic1 = s[base];
            const ic2 = s[base + 1];
            const v3 = v0 - ic2;
            const v1 = a1 * ic1 + a2 * v3;
            const v2 = ic2 + a2 * ic1 + a3 * v3;
            s[base] = 2 * v1 - ic1;
            s[base + 1] = 2 * v2 - ic2;
            switch (mode) {
                case 0:
                    v0 = v2; // low pass
                    break;
                case 1:
                    v0 = v0 - k * v1 - v2; // high pass
                    break;
                case 2:
                    v0 = k * v1; // band pass, the top of it the same loudness as the sound that went in
                    break;
                case 3:
                    v0 = v0 - k * v1; // notch
                    break;
                default:
                    v0 = 2 * v2 - v0 + k * v1; // peak: the low pass minus the high pass
            }
        }
        return v0;
    }

    // one sample through the ladder. G is the one pole stage's step, k how much comes back round the loop (4 rings by itself), and pre and norm
    // are the squash. Gives back the sound out
    ladder(x, offset, G, k, pre, norm, mode) {
        const s = this.state;
        const base = offset + 4;
        const s0 = s[base];
        const s1 = s[base + 1];
        const s2 = s[base + 2];
        const s3 = s[base + 3];
        // the loop is solved exactly (the stages are in a row, so how much of the sound that went round comes back is known before it is worked out)
        const G2 = G * G;
        const G4 = G2 * G2;
        const S = (1 - G) * (G2 * G * s0 + G2 * s1 + G * s2 + s3);
        const around = (G4 * x + S) / (1 + k * G4);
        let u = x - k * around;
        u = norm * squash(pre * u); // (always: this is what keeps the loop from running away, and makes it ring at a steady loudness at the top of the dial)
        let v = (u - s0) * G;
        const y1 = v + s0;
        s[base] = y1 + v;
        v = (y1 - s1) * G;
        const y2 = v + s1;
        s[base + 1] = y2 + v;
        v = (y2 - s2) * G;
        const y3 = v + s2;
        s[base + 2] = y3 + v;
        v = (y3 - s3) * G;
        const y4 = v + s3;
        s[base + 3] = y4 + v;
        switch (mode) {
            case 0:
                return y4; // low pass
            case 1:
                return u - 4 * y1 + 6 * y2 - 4 * y3 + y4; // high pass
            case 2:
                return 4 * (y2 - 2 * y3 + y4); // band pass
            case 3:
                return y4 + (u - 4 * y1 + 6 * y2 - 4 * y3 + y4); // notch: low pass plus high pass
            default:
                return y4 - (u - 4 * y1 + 6 * y2 - 4 * y3 + y4); // peak: low pass minus high pass
        }
    }

    // one sample through the filter (at the rate it is working at), for the speaker whose memory starts at offset: the squash, then the model
    core(x, offset) {
        if (this.model === 2) return this.ladder(x, offset, this.G, this.ladderK, this.pre, this.norm, this.mode);
        if (this.pre > 1) x = this.norm * squash(this.pre * x);
        return this.svf(x, offset, this.g, this.k1, this.k2, this.stages, this.mode);
    }

    // a whole block of sound through the state variable filter (one stage, or two for SVF 24), with no drive. Written out in full for speed: a
    // note's filter works on every sample of it, and a song can have dozens of notes sounding at once. The cutoff only has to be worked out
    // (a tangent and a power, which are slow) when it has moved: once for the block if it is not moving, and every 8 samples if it is
    fastBlock(inL, inR, outL, outR, size, freq, detune, mode, model, k1, k2, untilStop, fadeFrames) {
        const st = this.state;
        const twoStages = model === 1;
        // what each stage sends out: a bit of its low pass, its band pass and what came in (mode is the type)
        const mix = (k) => (mode === 0 ? [1, 0, 0] : mode === 1 ? [-1, -k, 1] : mode === 2 ? [0, k, 0] : mode === 3 ? [0, -k, 1] : [2, k, -1]);
        const m1 = mix(k1);
        const m2 = mix(k2);
        let l1a = st[0], l1b = st[1], l2a = st[2], l2b = st[3];
        let r1a = st[8], r1b = st[9], r2a = st[10], r2b = st[11];
        const still = (freq.length === 1 || freq[0] === freq[size - 1]) && (detune.length === 1 || detune[0] === detune[size - 1]);
        const nyquist = RATE * 0.49;
        let a1 = 0, a2 = 0, a3 = 0, b1 = 0, b2 = 0, b3 = 0;
        let next = 0;
        let loudest = 0;
        let quietIn = true;
        for (let n = 0; n < size; n++) {
            if (n >= next) {
                const index = still ? 0 : n;
                const hz = (freq.length > 1 ? freq[index] : freq[0]) * 2 ** ((detune.length > 1 ? detune[index] : detune[0]) / 1200);
                const g = Math.tan((Math.PI * (hz < 10 ? 10 : hz > nyquist ? nyquist : hz)) / RATE);
                a1 = 1 / (1 + g * (g + k1));
                a2 = g * a1;
                a3 = g * a2;
                b1 = 1 / (1 + g * (g + k2));
                b2 = g * b1;
                b3 = g * b2;
                next = still ? size : n + 8;
            }
            const x0 = inL ? inL[n] : 0;
            const x1 = inR ? inR[n] : 0;
            if (x0 !== 0 || x1 !== 0) quietIn = false;
            // left
            let v3 = x0 - l1b;
            let v1 = a1 * l1a + a2 * v3;
            let v2 = l1b + a2 * l1a + a3 * v3;
            l1a = 2 * v1 - l1a;
            l1b = 2 * v2 - l1b;
            let y0 = m1[0] * v2 + m1[1] * v1 + m1[2] * x0;
            if (twoStages) {
                const u = y0;
                v3 = u - l2b;
                v1 = b1 * l2a + b2 * v3;
                v2 = l2b + b2 * l2a + b3 * v3;
                l2a = 2 * v1 - l2a;
                l2b = 2 * v2 - l2b;
                y0 = m2[0] * v2 + m2[1] * v1 + m2[2] * u;
            }
            // right
            v3 = x1 - r1b;
            v1 = a1 * r1a + a2 * v3;
            v2 = r1b + a2 * r1a + a3 * v3;
            r1a = 2 * v1 - r1a;
            r1b = 2 * v2 - r1b;
            let y1 = m1[0] * v2 + m1[1] * v1 + m1[2] * x1;
            if (twoStages) {
                const u = y1;
                v3 = u - r2b;
                v1 = b1 * r2a + b2 * v3;
                v2 = r2b + b2 * r2a + b3 * v3;
                r2a = 2 * v1 - r2a;
                r2b = 2 * v2 - r2b;
                y1 = m2[0] * v2 + m2[1] * v1 + m2[2] * u;
            }
            if (!(y0 - y0 === 0) || !(y1 - y1 === 0)) {
                // (a filter with a huge setting can blow up: start it again, quietly, rather than send out a scream)
                l1a = l1b = l2a = l2b = r1a = r1b = r2a = r2b = 0;
                y0 = 0;
                y1 = 0;
            }
            const left = untilStop - n;
            if (left < fadeFrames) {
                const fade = left <= 0 ? 0 : left / fadeFrames;
                y0 *= fade;
                y1 *= fade;
            }
            outL[n] = y0;
            outR[n] = y1;
            const a = y0 < 0 ? -y0 : y0;
            const b = y1 < 0 ? -y1 : y1;
            if (a > loudest) loudest = a;
            if (b > loudest) loudest = b;
        }
        st[0] = l1a; st[1] = l1b; st[2] = l2a; st[3] = l2b;
        st[8] = r1a; st[9] = r1b; st[10] = r2a; st[11] = r2b;
        this.fastLoudest = loudest;
        this.fastQuietIn = quietIn;
    }

    process(inputs, outputs, parameters) {
        const out = outputs[0];
        const input = inputs[0];
        const size = out[0].length;
        const inL = input && input.length > 0 ? input[0] : null;
        const inR = input && input.length > 1 ? input[1] : inL;
        const outL = out[0];
        const outR = out.length > 1 ? out[1] : out[0];

        const freq = parameters.frequency;
        const detune = parameters.detune;
        const resonance = parameters.resonance[0];
        const drive = parameters.drive[0];
        const model = this.model;
        const mode = this.mode;
        const ladderModel = model === 2;
        const oversample = ladderModel || drive > 0.001; // (twice the sample rate, to keep the squash clean)
        const rate = oversample ? RATE * 2 : RATE;
        const pre = 1 + 14 * drive * drive; // how hard the sound is pushed into the squash
        // (so a sound about as loud as a note from the oscillator comes out about as loud, and a little quieter as the squash flattens it, because a
        // flattened wave is louder than the wave it was made from)
        const norm = 0.3 / squash(0.3 * pre) / (1 + 0.8 * drive);

        // how sharp the bend at the cutoff is: the old filter's numbers. A low pass, high pass, notch and peak have the resonance in dB (0dB is
        // the plain bend, the top of the bump is the number of dB), a band pass has it as its width (the old filter's way)
        const q = mode === 2 ? 0.7 + resonance : 10 ** (resonance / 20);
        let k1;
        let k2;
        let stages = 1;
        if (model === 1) {
            // two stages one after the other: for a low pass or a high pass the two are tuned so that with no resonance the bend is flat and
            // even (a fourth order Butterworth), and the resonance goes to the second one
            stages = 2;
            if (mode === 0 || mode === 1) {
                k1 = 1 / 0.5412;
                k2 = 1 / (1.3066 * q);
            } else {
                // (the two stages share the width, so the top of the band pass, the notch and the peak are as tall as with one)
                k1 = 1 / Math.sqrt(q);
                k2 = k1;
            }
        } else {
            k1 = 1 / q;
            k2 = k1;
        }
        const ladderK = (resonance / 12) * 4.3; // (the top of the RES dial, 12dB, is where the ladder rings by itself)
        // what the sample by sample part (core) works with
        this.k1 = k1;
        this.k2 = k2;
        this.stages = stages;
        this.ladderK = ladderK;
        this.pre = pre;
        this.norm = norm;

        const first = currentFrame;
        if (first >= this.stopFrame) {
            this.port.postMessage("ended");
            return false;
        }
        const untilStop = this.stopFrame - first; // (frames to go before it stops, for the fade out)
        const fadeFrames = RATE * 0.05;
        let loudest = 0;
        let quietIn = true;
        const nyquist = rate * 0.49;
        const state = this.state;

        if (!oversample && model < 2) {
            // the usual case (a state variable filter with no drive) has a quicker loop of its own
            this.fastBlock(inL, inR, outL, outR, size, freq, detune, mode, model, k1, k2, untilStop, fadeFrames);
            loudest = this.fastLoudest;
            quietIn = this.fastQuietIn;
        } else for (let n = 0; n < size; n++) {
            const hz = (freq.length > 1 ? freq[n] : freq[0]) * 2 ** ((detune.length > 1 ? detune[n] : detune[0]) / 1200);
            const fc = hz < 10 ? 10 : hz > nyquist ? nyquist : hz;
            const g = Math.tan((Math.PI * fc) / rate);
            const G = g / (1 + g);
            const x0 = inL ? inL[n] : 0;
            const x1 = inR ? inR[n] : 0;
            if (x0 !== 0 || x1 !== 0) quietIn = false;

            this.g = g;
            this.G = G;
            let y0;
            let y1;
            if (!oversample) {
                // (a drive of nothing and not the ladder: the sound goes straight through)
                y0 = this.core(x0, 0);
                y1 = this.core(x1, 8);
            } else {
                // up to twice the rate: the sample as it was, and one made between it and the next from its neighbours (the half band filter).
                // It works on the sound a few samples late, so it has the next few to look at
                const pos = this.position;
                const hx0 = this.inHistory[0];
                const hx1 = this.inHistory[1];
                hx0[pos & 31] = x0;
                hx1[pos & 31] = x1;
                const centre = pos - 8;
                // the two samples at twice the rate (the one on the sample and the one between), for the left and then the right speaker
                const first0 = this.core(hx0[centre & 31], 0);
                const second0 = this.core(this.upsample(hx0, centre), 0);
                const first1 = this.core(hx1[centre & 31], 8);
                const second1 = this.core(this.upsample(hx1, centre), 8);
                // and back down: the half band filter again, over the sound at twice the rate
                const ho0 = this.outHistory[0];
                const ho1 = this.outHistory[1];
                const m = (pos * 2) & 31;
                ho0[m] = first0;
                ho0[(m + 1) & 31] = second0;
                ho1[m] = first1;
                ho1[(m + 1) & 31] = second1;
                y0 = this.downsample(ho0, pos * 2 - 14);
                y1 = this.downsample(ho1, pos * 2 - 14);
                this.position = pos + 1;
            }
            if (!isFinite(y0) || !isFinite(y1)) {
                // (a filter with a huge setting can blow up: start it again, quietly, rather than send out a scream)
                state.fill(0);
                this.inHistory[0].fill(0);
                this.inHistory[1].fill(0);
                this.outHistory[0].fill(0);
                this.outHistory[1].fill(0);
                y0 = 0;
                y1 = 0;
            }
            const left = untilStop - n;
            if (left < fadeFrames) {
                const fade = left <= 0 ? 0 : left / fadeFrames;
                y0 *= fade;
                y1 *= fade;
            }
            outL[n] = y0;
            outR[n] = y1;
            const a = y0 < 0 ? -y0 : y0;
            const b = y1 < 0 ? -y1 : y1;
            if (a > loudest) loudest = a;
            if (b > loudest) loudest = b;
        }

        // nothing coming in and next to nothing going out for a while: this note is over, and the filter can stop
        if (quietIn && loudest < 1e-6) {
            this.quiet++;
            if (this.quiet > 40) {
                this.port.postMessage("ended");
                return false;
            }
        } else {
            this.quiet = 0;
        }
        return true;
    }

    // the sample half way between the sample at centre and the next one, from a ring of the sound that came in (the half band filter)
    upsample(ring, centre) {
        let sum = 0;
        for (let j = 0; j < 8; j++) sum += HALF_BAND[j] * (ring[(centre - j) & 31] + ring[(centre + 1 + j) & 31]);
        return 2 * sum;
    }

    // the sample at a rate half as fast, from the ring of the sound at twice the rate, around the point centre (the half band filter)
    downsample(ring, centre) {
        let sum = 0.5 * ring[centre & 31];
        for (let j = 0; j < 8; j++) sum += HALF_BAND[j] * (ring[(centre - (2 * j + 1)) & 31] + ring[(centre + (2 * j + 1)) & 31]);
        return sum;
    }
}

registerProcessor("synth-filter", SynthFilter);
