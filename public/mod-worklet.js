// The modulation of a note, as an AudioWorklet: three LFOs (slow waves), two more envelopes (a rise and fall of their own, besides the one that
// shapes the volume), and the matrix that decides what each of them does. One of these is made for each note, only if the matrix has something in it.
//
// Sources (what moves):                       Destinations (what is moved):
//   LFO 1, LFO 2, LFO 3  a wave, -1 to 1        PITCH    the pitch of the note, in cents (a full amount is an octave each way)
//   ENV 2, ENV 3         a rise and fall, 0 to 1  CUTOFF   the filter's cutoff, in cents (a full amount is four octaves each way)
//   VEL                  how hard the key was hit RES      the filter's resonance, in dB (a full amount is 12dB)
//   KEY                  the note, from low to high AMP     the volume of the note (a full amount can take it to nothing or double it)
//   WHEEL, PRESS         the mod wheel, and how    PAN      where the note is in the speakers
//                        hard the key is pressed   PW       the pulse width of the oscillator
//   RAND                 a different number for    F DRIVE  the filter drive
//                        each note                 SUB      the sub wave
// Each of the eight outputs is one destination: the sum of every source that is sent to it, each times its amount. They are plugged into the
// notes' parameters, and add to whatever those are already. The sources are worked out every 16 samples and the outputs glide between, which is
// smooth enough and a lot cheaper. The LFOs that are not "key" sync run on the clock of the song, so every note sees the same wave.
// Everything it needs to know is given when it is made (messages are not heard while a file is being made), except when the key is let go
// (release) which for a key held down is sent as a message while it plays.

const RATE = sampleRate; // (read once: reading sampleRate again and again is slow)
const TICK = 16;
// how far a full amount (1) moves each destination
const SCALE = [1200, 4800, 12, 1, 1, 0.45, 1, 1];

// a number from 0 to 1 that is always the same for the same whole number and seed, for the random LFO shapes
function hash(n, seed) {
    let x = Math.imul((n | 0) ^ Math.imul(seed | 0, 0x9e3779b1), 0x85ebca6b);
    x ^= x >>> 15;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 13;
    return ((x >>> 0) % 100000) / 100000;
}

// the LFO shapes: 0 sine, 1 triangle, 2 saw up, 3 saw down, 4 square, 5 random steps (sample and hold), 6 smooth random
function lfoValue(shape, cycles, seed) {
    const n = Math.floor(cycles);
    const p = cycles - n;
    switch (shape) {
        case 0:
            return Math.sin(2 * Math.PI * p);
        case 1:
            return 1 - 4 * Math.abs(p - 0.5);
        case 2:
            return 2 * p - 1;
        case 3:
            return 1 - 2 * p;
        case 4:
            return p < 0.5 ? 1 : -1;
        case 5:
            return hash(n, seed) * 2 - 1;
        default: {
            const a = hash(n, seed) * 2 - 1;
            const b = hash(n + 1, seed) * 2 - 1;
            const s = p * p * (3 - 2 * p);
            return a + (b - a) * s;
        }
    }
}

// the level (0 to 1) of an envelope t seconds after the key went down, if it was let go at release seconds (Infinity if it has not been):
// it rises over a, falls over d to the level s, stays there, and when let go falls away over r. The same shape as the volume's
function envelopeValue(t, release, env) {
    const level = (u) => (u <= env.a ? (env.a > 0 ? u / env.a : 1) : u <= env.a + env.d ? env.s ** ((u - env.a) / Math.max(env.d, 1e-4)) : env.s);
    if (t < release) return level(t);
    const from = level(release);
    const gone = (t - release) / Math.max(env.r, 1e-4);
    return gone >= 1 ? 0 : from * 0.001 ** gone * (1 - gone);
}

class SynthMod extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: "wheel", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
            { name: "pressure", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
        ];
    }

    constructor(options) {
        super();
        const o = options.processorOptions || {};
        this.startFrame = Math.round((o.startTime || 0) * RATE);
        this.stopFrame = o.stopTime > 0 && o.stopTime < Infinity ? Math.round(o.stopTime * RATE) : Infinity;
        this.releaseSeconds = o.releaseTime >= 0 && o.releaseTime < Infinity ? o.releaseTime - (o.startTime || 0) : Infinity; // (seconds after the start)
        this.velocity = o.velocity === undefined ? 1 : o.velocity;
        this.key = o.key || 0;
        this.seed = o.seed || 0;
        this.random = hash(this.seed, 7) * 2 - 1;
        // the LFOs: shape, mode (0 free, 1 key, 2 tempo), the rate in cycles a second, and how long it takes to fade in
        this.lfos = (o.lfos || []).map((l) => ({ shape: l.shape || 0, mode: l.mode || 0, hz: l.hz || 1, fade: l.fade || 0 }));
        this.envs = (o.envs || []).map((e) => ({ a: e.a, d: e.d, s: e.s, r: e.r }));
        // what goes where: [source, destination, amount]
        this.routes = o.routes || [];
        this.used = new Uint8Array(8);
        this.routes.forEach((r) => (this.used[r[1]] = 1));
        this.from = new Float64Array(8); // the outputs at the start of this stretch of 16 samples, and at the end
        this.to = new Float64Array(8);
        this.ended = false;
        this.primed = false;
        this.port.onmessage = (e) => {
            if (!e.data) return;
            if (e.data.type === "release") this.releaseSeconds = e.data.time - this.startFrame / RATE;
            else if (e.data.type === "stop") this.stopFrame = Math.round(e.data.time * RATE);
        };
    }

    // what every output is, at this frame
    evaluate(frame, wheel, pressure, into) {
        const t = (frame - this.startFrame) / RATE;
        const clock = frame / RATE;
        const sources = this.sources || (this.sources = new Float64Array(10));
        for (let i = 0; i < 3; i++) {
            const lfo = this.lfos[i];
            if (!lfo) {
                sources[i] = 0;
                continue;
            }
            const cycles = (lfo.mode === 1 ? Math.max(t, 0) : clock) * lfo.hz;
            let v = lfoValue(lfo.shape, cycles, this.seed + i * 101);
            if (lfo.fade > 0) v *= Math.min(1, Math.max(t, 0) / lfo.fade);
            sources[i] = v;
        }
        for (let i = 0; i < 2; i++) sources[3 + i] = this.envs[i] ? envelopeValue(Math.max(t, 0), this.releaseSeconds, this.envs[i]) : 0;
        sources[5] = this.velocity;
        sources[6] = this.key;
        sources[7] = wheel;
        sources[8] = pressure;
        sources[9] = this.random;
        into.fill(0);
        for (let i = 0; i < this.routes.length; i++) {
            const r = this.routes[i];
            into[r[1]] += sources[r[0]] * r[2] * SCALE[r[1]];
        }
    }

    process(inputs, outputs, parameters) {
        if (this.ended) return false;
        const first = currentFrame;
        const size = outputs[0][0].length;
        if (first >= this.stopFrame) {
            this.ended = true;
            this.port.postMessage("ended");
            return false;
        }
        if (first + size <= this.startFrame) return true;
        const wheel = parameters.wheel[0];
        const pressure = parameters.pressure[0];
        const from = Math.max(0, this.startFrame - first);
        const to = Math.min(size, this.stopFrame - first);
        if (!this.primed) {
            this.evaluate(Math.max(first, this.startFrame), wheel, pressure, this.to);
            this.from.set(this.to);
            this.primed = true;
        }
        let n = from;
        while (n < to) {
            const steps = Math.min(TICK, to - n);
            this.from.set(this.to);
            this.evaluate(first + n + steps, wheel, pressure, this.to);
            for (let d = 0; d < 8; d++) {
                if (!this.used[d]) continue;
                const out = outputs[d][0];
                const a = this.from[d];
                const slope = (this.to[d] - a) / steps;
                for (let k = 0; k < steps; k++) out[n + k] = a + slope * (k + 1);
            }
            n += steps;
        }
        if (first + size >= this.stopFrame) {
            this.ended = true;
            this.port.postMessage("ended");
            return false;
        }
        return true;
    }
}

registerProcessor("synth-mod", SynthMod);
