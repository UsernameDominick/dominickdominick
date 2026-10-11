// The effects rack of a track, as an AudioWorklet: a chorus, a phaser, a flanger, a bit crusher and a compressor, one after the other (in that
// order), each with its own MIX (nothing at 0). One of these sits at the end of every synth track's effects, where the sound is already stereo.
// Everything that has its MIX at nothing is skipped, so a rack with nothing turned on does next to nothing (and is not even put in until the
// first one is turned on).
//   CHORUS    three copies of the sound, each a little late by an amount that wobbles, a different way in each speaker: it sounds like more than
//             one of it, wider and softer
//   PHASER    six all pass stages whose pitch sweeps up and down: the sound plus a copy of itself with its phase turned by the stages leaves
//             notches that sweep. FDBK sends some of it round again, which makes the notches sharper
//   FLANGER   one very short delay that sweeps, mixed in with the sound: a comb of notches that sweep, the "jet plane" sound. FDBK as above
//   CRUSH     the sound with fewer steps in its loudness (BITS) and held for several samples at a time (RATE): a gritty, digital sound
//   COMP      a compressor: it turns the sound down when it goes over THRESH by the RATIO, with an ATTACK and a RELEASE, and turns it back up by
//             the amount it took off. MIX blends the compressed sound with the original (parallel compression)
// The settings come in a "config" message (and when it is made, because a message is not heard while a file is being made).

const RATE = sampleRate; // (read once: reading sampleRate again and again is slow)
const TWO_PI = Math.PI * 2;
const LINE = 4096; // the length of each delay line (about 85ms), a power of two so the places wrap quickly
const MASK = LINE - 1;

// a sample from a delay line, delay samples back from where the next one goes (with a curve through the four samples round it, so the
// delay can be any length and moved smoothly without clicks)
function tap(line, write, delay) {
    const position = write - delay;
    const i = Math.floor(position);
    const f = position - i;
    const a = line[(i - 1) & MASK];
    const b = line[i & MASK];
    const c = line[(i + 1) & MASK];
    const d = line[(i + 2) & MASK];
    return b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)));
}

class SynthRack extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.config = null;
        // for each speaker: the chorus's and the flanger's delay lines, the phaser's stages
        this.chorusLine = [new Float32Array(LINE), new Float32Array(LINE)];
        this.flangerLine = [new Float32Array(LINE), new Float32Array(LINE)];
        this.write = 0;
        this.phaserState = [new Float64Array(6), new Float64Array(6)]; // the memory of each all pass stage
        this.phaserLast = [0, 0]; // the last sound out of the phaser, for the feedback
        this.flangerLast = [0, 0];
        this.crushHold = [0, 0];
        this.crushCount = 0;
        this.compGain = 1; // the compressor's gain (it changes slowly, with the attack and the release)
        this.compLevel = 0;
        this.phase = { chorus: 0, phaser: 0, flanger: 0 }; // the LFOs, as how far round each is
        this.mixSmooth = { chorus: 0, phaser: 0, flanger: 0, crush: 0, comp: 0 };
        this.setConfig((options.processorOptions || {}).config);
        this.port.onmessage = (e) => {
            if (e.data && e.data.type === "config") this.setConfig(e.data.config);
        };
    }

    setConfig(config) {
        this.config = config || null;
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const out = outputs[0];
        const size = out[0].length;
        const inL = input && input.length > 0 ? input[0] : null;
        const inR = input && input.length > 1 ? input[1] : inL;
        const outL = out[0];
        const outR = out.length > 1 ? out[1] : out[0];
        const c = this.config;
        if (!inL) {
            outL.fill(0);
            outR.fill(0);
            return true;
        }
        // nothing turned on (or nothing known yet): the sound goes straight through
        if (!c || !(c.chorus.mix > 0 || c.phaser.mix > 0 || c.flanger.mix > 0 || c.crush.mix > 0 || c.comp.mix > 0 || this.mixSmooth.chorus > 0.001 || this.mixSmooth.phaser > 0.001 || this.mixSmooth.flanger > 0.001 || this.mixSmooth.crush > 0.001 || this.mixSmooth.comp > 0.001)) {
            outL.set(inL);
            outR.set(inR);
            return true;
        }

        const ms = this.mixSmooth;
        const smooth = 0.002; // how fast a MIX follows its dial, per sample (so turning it makes no click)
        // how far each LFO moves each sample
        const chorusStep = c.chorus.rate / RATE;
        const phaserStep = c.phaser.rate / RATE;
        const flangerStep = c.flanger.rate / RATE;
        const crushLevels = 2 ** c.crush.bits; // the number of steps in the loudness
        const crushEvery = Math.max(1, Math.round(c.crush.reduce));
        const comp = c.comp;
        // the compressor: how fast it follows a rise and a fall, per sample
        const attackCoef = Math.exp(-1 / (Math.max(comp.attack, 0.05) * 0.001 * RATE));
        const releaseCoef = Math.exp(-1 / (Math.max(comp.release, 1) * 0.001 * RATE));
        const makeup = 10 ** (((-comp.threshold * (1 - 1 / comp.ratio)) * 0.6) / 20);

        let w = this.write;
        for (let n = 0; n < size; n++) {
            let l = inL[n];
            let r = inR[n];
            ms.chorus += ((c.chorus.mix) - ms.chorus) * smooth;
            ms.phaser += ((c.phaser.mix) - ms.phaser) * smooth;
            ms.flanger += ((c.flanger.mix) - ms.flanger) * smooth;
            ms.crush += ((c.crush.mix) - ms.crush) * smooth;
            ms.comp += ((c.comp.mix) - ms.comp) * smooth;

            // ---- chorus ----
            this.chorusLine[0][w & MASK] = l;
            this.chorusLine[1][w & MASK] = r;
            if (ms.chorus > 0.0005) {
                const phase = this.phase.chorus;
                let wl = 0;
                let wr = 0;
                for (let v = 0; v < 3; v++) {
                    // each of three copies: a late time of its own (about 12, 18 and 24 milliseconds) that wobbles by DEPTH, the right speaker's
                    // wobble a quarter of the way round from the left's
                    const base = (0.012 + 0.006 * v) * RATE;
                    const swing = c.chorus.depth * 0.004 * RATE;
                    wl += tap(this.chorusLine[0], w, base + swing * Math.sin(TWO_PI * (phase + v / 3)));
                    wr += tap(this.chorusLine[1], w, base + swing * Math.sin(TWO_PI * (phase + v / 3 + 0.25)));
                }
                l = l * (1 - ms.chorus * 0.5) + (wl / 3) * ms.chorus;
                r = r * (1 - ms.chorus * 0.5) + (wr / 3) * ms.chorus;
                this.phase.chorus = (phase + chorusStep) % 1;
            }

            // ---- phaser ----
            if (ms.phaser > 0.0005) {
                const phase = this.phase.phaser;
                const sweep = 0.5 + 0.5 * Math.sin(TWO_PI * phase);
                // the pitch of the stages goes up and down, DEPTH is how many octaves (up to four), round 600Hz
                const octaves = 0.5 + c.phaser.depth * 3.5;
                const hz = 600 * 2 ** ((sweep - 0.5) * octaves * 1.6);
                const t = Math.tan((Math.PI * Math.min(hz, RATE * 0.45)) / RATE);
                const a = (t - 1) / (t + 1); // the all pass stage's coefficient
                for (let ch = 0; ch < 2; ch++) {
                    const state = this.phaserState[ch];
                    let x = (ch === 0 ? l : r) + c.phaser.feedback * this.phaserLast[ch];
                    for (let s = 0; s < 6; s++) {
                        const y = a * x + state[s];
                        state[s] = x - a * y;
                        x = y;
                    }
                    this.phaserLast[ch] = x;
                    const dry = ch === 0 ? l : r;
                    const mixed = dry * (1 - ms.phaser * 0.5) + x * ms.phaser * 0.5;
                    if (ch === 0) l = mixed;
                    else r = mixed;
                }
                // (the right speaker's sweep is a little behind the left's, in a second phaser, only by the pitch: they share the stages' memory
                // above for simplicity, so the phaser is the same in both)
                this.phase.phaser = (phase + phaserStep) % 1;
            }

            // ---- flanger ----
            for (let ch = 0; ch < 2; ch++) this.flangerLine[ch][w & MASK] = (ch === 0 ? l : r) + c.flanger.feedback * this.flangerLast[ch];
            if (ms.flanger > 0.0005) {
                const phase = this.phase.flanger;
                for (let ch = 0; ch < 2; ch++) {
                    // the delay sweeps between 0.4 and (0.4 + DEPTH times 7) milliseconds, the right speaker a quarter round behind the left
                    const sweep = 0.5 + 0.5 * Math.sin(TWO_PI * (phase + ch * 0.25));
                    const delay = (0.0004 + c.flanger.depth * 0.007 * sweep) * RATE;
                    const wet = tap(this.flangerLine[ch], w, delay);
                    this.flangerLast[ch] = wet;
                    const dry = ch === 0 ? l : r;
                    const mixed = dry * (1 - ms.flanger * 0.5) + wet * ms.flanger * 0.5;
                    if (ch === 0) l = mixed;
                    else r = mixed;
                }
                this.phase.flanger = (phase + flangerStep) % 1;
            } else {
                this.flangerLast[0] = 0;
                this.flangerLast[1] = 0;
            }
            w++;

            // ---- bit crusher ----
            if (ms.crush > 0.0005) {
                if (this.crushCount % crushEvery === 0) {
                    this.crushHold[0] = Math.round(l * crushLevels * 0.5) / (crushLevels * 0.5);
                    this.crushHold[1] = Math.round(r * crushLevels * 0.5) / (crushLevels * 0.5);
                }
                this.crushCount++;
                l = l * (1 - ms.crush) + this.crushHold[0] * ms.crush;
                r = r * (1 - ms.crush) + this.crushHold[1] * ms.crush;
            }

            // ---- compressor ----
            if (ms.comp > 0.0005) {
                const peak = Math.max(Math.abs(l), Math.abs(r));
                // the level follows the sound up quickly (the attack) and down slowly (the release)
                this.compLevel = peak > this.compLevel ? attackCoef * this.compLevel + (1 - attackCoef) * peak : releaseCoef * this.compLevel + (1 - releaseCoef) * peak;
                const db = 20 * Math.log10(this.compLevel + 1e-9);
                const over = db - comp.threshold;
                // (a soft bend of 6dB wide round the threshold)
                let reduction = 0;
                if (over > 3) reduction = over * (1 - 1 / comp.ratio);
                else if (over > -3) reduction = ((over + 3) * (over + 3) * (1 - 1 / comp.ratio)) / 12;
                const target = 10 ** (-reduction / 20);
                this.compGain += (target - this.compGain) * 0.1;
                const wetL = l * this.compGain * makeup;
                const wetR = r * this.compGain * makeup;
                l = l * (1 - ms.comp) + wetL * ms.comp;
                r = r * (1 - ms.comp) + wetR * ms.comp;
            }
            outL[n] = l;
            outR[n] = r;
        }
        this.write = w & 0x3fffffff;
        return true;
    }
}

registerProcessor("synth-rack", SynthRack);
