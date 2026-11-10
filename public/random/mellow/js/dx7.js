// DX7 FM core for Mellow: a port of the msfa synth core (it is also read as text by the audio worklet)
/* eslint-disable no-unused-vars, no-undef -- offers names the other files use; uses names that live in the other files of the folder */

/*
 * DX7 FM core for Mellow: a JavaScript port of the msfa synth core
 * (Google "music-synthesizer-for-android", Apache License 2.0, the same core
 * Dexed and the M-VAVE FM-1 firmware are built on). Integer maths follows the
 * C++ so output matches the original sample for sample.
 *
 * Original: Copyright 2012 Google Inc., Licensed under the Apache License,
 * Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0). Amp-mod, LFO and
 * the 12-voice allocator follow the Dexed copy of msfa.
 */
const DX7 = (function () {
	"use strict";
	const LG_N = 6,
		N = 1 << LG_N,
		FEEDBACK_BITDEPTH = 8;

	// ---------------------------------------------------------------- tables
	const SIN_N = 1024,
		sintab = new Int32Array(SIN_N * 2);
	const EXP2_N = 1024,
		exp2tab = new Int32Array(EXP2_N * 2);
	const FREQ_N = 1024,
		freqtab = new Int32Array(FREQ_N + 1);
	let tablesReady = false;

	function initTables(sampleRate) {
		// Sin::init (SIN_DELTA layout): [dy, y0] pairs, exact 64-bit recurrence
		const dphase = (2 * Math.PI) / SIN_N;
		let c = BigInt(Math.floor(Math.cos(dphase) * (1 << 30) + 0.5));
		let s = BigInt(Math.floor(Math.sin(dphase) * (1 << 30) + 0.5));
		let u = BigInt(1 << 30),
			v = 0n;
		const R = BigInt(1 << 29);
		for (let i = 0; i < SIN_N / 2; i++) {
			const vn = Number(v);
			sintab[(i << 1) + 1] = (vn + 32) >> 6;
			sintab[((i + SIN_N / 2) << 1) + 1] = -((vn + 32) >> 6);
			const t = (u * s + v * c + R) >> 30n;
			u = (u * c - v * s + R) >> 30n;
			v = t;
		}
		for (let i = 0; i < SIN_N - 1; i++) {
			sintab[i << 1] = sintab[(i << 1) + 3] - sintab[(i << 1) + 1];
		}
		sintab[(SIN_N << 1) - 2] = -sintab[(SIN_N << 1) - 1];

		// Exp2::init
		let inc = Math.pow(2, 1 / EXP2_N),
			y = 1 << 30;
		for (let i = 0; i < EXP2_N; i++) {
			exp2tab[(i << 1) + 1] = Math.floor(y + 0.5);
			y *= inc;
		}
		for (let i = 0; i < EXP2_N - 1; i++) {
			exp2tab[i << 1] = exp2tab[(i << 1) + 3] - exp2tab[(i << 1) + 1];
		}
		exp2tab[(EXP2_N << 1) - 2] = (((1 << 31) >>> 0) - exp2tab[(EXP2_N << 1) - 1]) | 0;

		// Freqlut::init
		let yy = Math.pow(2, 24 + 20) / sampleRate;
		inc = Math.pow(2, 1 / FREQ_N);
		for (let i = 0; i < FREQ_N + 1; i++) {
			freqtab[i] = Math.floor(yy + 0.5) | 0;
			yy *= inc;
		}

		Env.initSr(sampleRate);
		PitchEnv.init(sampleRate);
		Lfo.init(sampleRate);
		tablesReady = true;
	}

	// Sin::lookup (inline, SIN_DELTA). dy*lowbits < 2^45, so doubles are exact.
	function sinLookup(phase) {
		const lowbits = phase & 16383;
		const pi = (phase >> 13) & 2046;
		return (
			(sintab[pi + 1] + ((sintab[pi] * lowbits) >> 14)) | 0
		); /* |dy*lowbits| < 2^31, so this equals the old floor(.../16384) */
	}

	// Exp2::lookup (inline)
	function exp2Lookup(x) {
		const lowbits = x & 16383;
		const xi = (x >> 13) & 2046;
		const y = exp2tab[xi + 1] + Math.floor((exp2tab[xi] * lowbits) / 16384);
		return (y | 0) >> (6 - (x >> 24));
	}

	// Freqlut::lookup
	function freqLookup(logfreq) {
		const ix = (logfreq & 0xffffff) >> 14;
		const y0 = freqtab[ix],
			y1 = freqtab[ix + 1];
		const lowbits = logfreq & 16383;
		const y = (y0 + Math.floor(((y1 - y0) * lowbits) / 16384)) | 0;
		let sh = 20 - (logfreq >> 24);
		if (sh > 31) {
			sh = 31;
		}
		return y >> sh;
	}

	// ---------------------------------------------------------------- envelope
	const levellut = [0, 5, 9, 13, 17, 20, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 42, 43, 45, 46];
	const scaleOutLevel = (ol) => (ol >= 20 ? 28 + ol : levellut[ol]);

	class Env {
		constructor() {
			this.rates = [0, 0, 0, 0];
			this.levels = [0, 0, 0, 0];
			this.outlevel = 0;
			this.rateScaling = 0;
			this.level = 0;
			this.target = 0;
			this.rising = false;
			this.ix = 4;
			this.inc = 0;
			this.down = false;
			this.inited = false;
		}
		init(r, l, ol, rs) {
			this.inited = true;
			for (let i = 0; i < 4; i++) {
				this.rates[i] = r[i];
				this.levels[i] = l[i];
			}
			this.outlevel = ol;
			this.rateScaling = rs;
			this.level = 0;
			this.down = true;
			this.advance(0);
		}
		getsample() {
			if (this.ix < 3 || (this.ix < 4 && !this.down)) {
				if (this.rising) {
					const jump = 1716;
					if (this.level < jump << 16) {
						this.level = jump << 16;
					}
					this.level = (this.level + (((17 << 24) - this.level) >> 24) * this.inc) | 0;
					if (this.level >= this.target) {
						this.level = this.target;
						this.advance(this.ix + 1);
					}
				} else {
					this.level = (this.level - this.inc) | 0;
					if (this.level <= this.target) {
						this.level = this.target;
						this.advance(this.ix + 1);
					}
				}
			}
			return this.level;
		}
		keydown(d) {
			if (this.down !== d) {
				this.down = d;
				this.advance(d ? 0 : 3);
			}
		}
		advance(newix) {
			this.ix = newix;
			if (this.ix < 4) {
				const newlevel = this.levels[this.ix];
				let actual = scaleOutLevel(newlevel) >> 1;
				actual = (actual << 6) + this.outlevel - 4256;
				actual = actual < 16 ? 16 : actual;
				this.target = actual << 16;
				this.rising = this.target > this.level;
				let qrate = (this.rates[this.ix] * 41) >> 6;
				qrate += this.rateScaling;
				qrate = Math.min(qrate, 63);
				let inc = (4 + (qrate & 3)) << (2 + LG_N + (qrate >> 2));
				this.inc = Math.floor((inc * Env.srMul) / 16777216) | 0;
			}
		}
		isActive() {
			return this.inited && (this.ix < 4 || this.levels[3] > 0);
		}
	}
	Env.srMul = 1 << 24;
	Env.initSr = (sr) => {
		Env.srMul = Math.floor((44100.0 / sr) * (1 << 24));
	};
	Env.scaleOutLevel = scaleOutLevel;

	// ---------------------------------------------------------------- pitch env
	const pitchenv_rate = [
		1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 16,
		16, 17, 18, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 33, 34, 36, 37, 38, 39, 41, 42,
		44, 46, 47, 49, 51, 53, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 79, 82, 85, 88, 91, 94,
		98, 102, 106, 110, 115, 120, 125, 130, 135, 141, 147, 153, 159, 165, 171, 178, 185, 193, 202,
		211, 232, 243, 254, 255,
	];
	const pitchenv_tab = [
		-128, -116, -104, -95, -85, -76, -68, -61, -56, -52, -49, -46, -43, -41, -39, -37, -35, -33,
		-32, -31, -30, -29, -28, -27, -26, -25, -24, -23, -22, -21, -20, -19, -18, -17, -16, -15, -14,
		-13, -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
		12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,
		38, 40, 43, 46, 49, 53, 58, 65, 73, 82, 92, 103, 115, 127,
	];
	class PitchEnv {
		constructor() {
			this.rates = [0, 0, 0, 0];
			this.levels = [0, 0, 0, 0];
			this.level = 0;
			this.target = 0;
			this.rising = false;
			this.ix = 4;
			this.inc = 0;
			this.down = true;
		}
		set(r, l) {
			for (let i = 0; i < 4; i++) {
				this.rates[i] = r[i];
				this.levels[i] = l[i];
			}
			this.level = pitchenv_tab[l[3]] << 19;
			this.down = true;
			this.advance(0);
		}
		getsample() {
			if (this.ix < 3 || (this.ix < 4 && !this.down)) {
				if (this.rising) {
					this.level = (this.level + this.inc) | 0;
					if (this.level >= this.target) {
						this.level = this.target;
						this.advance(this.ix + 1);
					}
				} else {
					this.level = (this.level - this.inc) | 0;
					if (this.level <= this.target) {
						this.level = this.target;
						this.advance(this.ix + 1);
					}
				}
			}
			return this.level;
		}
		keydown(d) {
			if (this.down !== d) {
				this.down = d;
				this.advance(d ? 0 : 3);
			}
		}
		advance(ix) {
			this.ix = ix;
			if (ix < 4) {
				this.target = pitchenv_tab[this.levels[ix]] << 19;
				this.rising = this.target > this.level;
				this.inc = (pitchenv_rate[this.rates[ix]] * PitchEnv.unit) | 0;
			}
		}
	}
	PitchEnv.unit = 0;
	PitchEnv.init = (sr) => {
		PitchEnv.unit = Math.floor((N * (1 << 24)) / (21.3 * sr) + 0.5);
	};

	// ---------------------------------------------------------------- LFO
	const lfoSource = [
		0.062541, 0.125031, 0.312393, 0.43712, 0.62461, 0.750694, 0.93633, 1.125302, 1.249609, 1.436782,
		1.560915, 1.752081, 1.875117, 2.062494, 2.247191, 2.374451, 2.560492, 2.686728, 2.873976,
		2.99895, 3.188013, 3.36984, 3.500175, 3.682224, 3.812065, 4.0008, 4.186202, 4.310716, 4.50126,
		4.623209, 4.814636, 4.93048, 5.121901, 5.315191, 5.434783, 5.617346, 5.750431, 5.946717,
		6.062811, 6.248438, 6.431695, 6.564264, 6.74946, 6.868132, 7.052186, 7.25058, 7.375719,
		7.556294, 7.687577, 7.877738, 7.993605, 8.181967, 8.372405, 8.504848, 8.685079, 8.810573,
		8.986341, 9.122423, 9.300595, 9.500285, 9.607994, 9.798158, 9.950249, 10.117361, 11.251125,
		11.384335, 12.562814, 13.676149, 13.904338, 15.092062, 16.366612, 16.638935, 17.869907,
		19.193858, 19.425019, 20.833333, 21.034918, 22.50225, 24.003841, 24.260068, 25.746653,
		27.173913, 27.578599, 29.052876, 30.693677, 31.191516, 32.658393, 34.31709, 34.674064,
		36.416606, 38.197097, 38.550501, 40.387722, 40.749796, 42.625746, 44.326241, 44.883303,
		46.772685, 48.590865, 49.261084,
	];
	class Lfo {
		constructor() {
			this.phase = 0;
			this.delta = 0;
			this.wave = 0;
			this.randstate = 0;
			this.delaystate = 0;
			this.delayinc = 0;
			this.delayinc2 = 0;
			this.sync = false;
		}
		reset(p) {
			// p = [speed, delay, pmd, amd, sync, wave]
			this.delta = Math.floor(lfoSource[p[0]] * Lfo.ratio) >>> 0;
			let a = 99 - p[1];
			if (a === 99) {
				this.delayinc = 0xffffffff;
				this.delayinc2 = 0xffffffff;
			} else {
				a = (16 + (a & 15)) << (1 + (a >> 4));
				this.delayinc = (Lfo.unit * a) >>> 0;
				a &= 0xff80;
				a = Math.max(0x80, a);
				this.delayinc2 = (Lfo.unit * a) >>> 0;
			}
			this.wave = p[5];
			this.sync = p[4] !== 0;
		}
		getsample() {
			this.phase = (this.phase + this.delta) >>> 0;
			const ph = this.phase;
			let x;
			switch (this.wave) {
				case 0:
					x = ph >>> 7;
					x ^= -(ph >>> 31);
					x &= (1 << 24) - 1;
					return x;
				case 1:
					return (~ph ^ 0x80000000) >>> 8;
				case 2:
					return (ph ^ 0x80000000) >>> 8;
				case 3:
					return (~ph >>> 7) & (1 << 24);
				case 4:
					return (1 << 23) + (sinLookup(ph >>> 8) >> 1);
				case 5:
					if (ph < this.delta) {
						this.randstate = (this.randstate * 179 + 17) & 0xff;
					}
					x = this.randstate ^ 0x80;
					return (x + 1) << 16;
			}
			return 1 << 23;
		}
		getdelay() {
			const delta = this.delaystate < 0x80000000 ? this.delayinc : this.delayinc2;
			const d = this.delaystate + delta;
			if (d > 0xffffffff) {
				return 1 << 24;
			}
			this.delaystate = d;
			if (d < 0x80000000) {
				return 0;
			}
			return Math.floor(d / 128) & ((1 << 24) - 1);
		}
		keydown() {
			if (this.sync) {
				this.phase = 0x7fffffff;
			}
			this.delaystate = 0;
		}
	}
	Lfo.unit = 0;
	Lfo.ratio = 0;
	Lfo.init = (sr) => {
		Lfo.unit = Math.floor((N * 25190424) / sr + 0.5) >>> 0;
		Lfo.ratio = (4437500000.0 * N) / sr;
	};

	// ---------------------------------------------------------------- FM core
	const OUT1 = 1,
		OUT2 = 2,
		OUTADD = 4,
		IN1 = 16,
		IN2 = 32,
		FBIN = 64,
		FBOUT = 128;
	const ALGS = [
		[0xc1, 0x11, 0x11, 0x14, 0x01, 0x14],
		[0x01, 0x11, 0x11, 0x14, 0xc1, 0x14],
		[0xc1, 0x11, 0x14, 0x01, 0x11, 0x14],
		[0x41, 0x11, 0x94, 0x01, 0x11, 0x14],
		[0xc1, 0x14, 0x01, 0x14, 0x01, 0x14],
		[0x41, 0x94, 0x01, 0x14, 0x01, 0x14],
		[0xc1, 0x11, 0x05, 0x14, 0x01, 0x14],
		[0x01, 0x11, 0xc5, 0x14, 0x01, 0x14],
		[0x01, 0x11, 0x05, 0x14, 0xc1, 0x14],
		[0x01, 0x05, 0x14, 0xc1, 0x11, 0x14],
		[0xc1, 0x05, 0x14, 0x01, 0x11, 0x14],
		[0x01, 0x05, 0x05, 0x14, 0xc1, 0x14],
		[0xc1, 0x05, 0x05, 0x14, 0x01, 0x14],
		[0xc1, 0x05, 0x11, 0x14, 0x01, 0x14],
		[0x01, 0x05, 0x11, 0x14, 0xc1, 0x14],
		[0xc1, 0x11, 0x02, 0x25, 0x05, 0x14],
		[0x01, 0x11, 0x02, 0x25, 0xc5, 0x14],
		[0x01, 0x11, 0x11, 0xc5, 0x05, 0x14],
		[0xc1, 0x14, 0x14, 0x01, 0x11, 0x14],
		[0x01, 0x05, 0x14, 0xc1, 0x14, 0x14],
		[0x01, 0x14, 0x14, 0xc1, 0x14, 0x14],
		[0xc1, 0x14, 0x14, 0x14, 0x01, 0x14],
		[0xc1, 0x14, 0x14, 0x01, 0x14, 0x04],
		[0xc1, 0x14, 0x14, 0x14, 0x04, 0x04],
		[0xc1, 0x14, 0x14, 0x04, 0x04, 0x04],
		[0xc1, 0x05, 0x14, 0x01, 0x14, 0x04],
		[0x01, 0x05, 0x14, 0xc1, 0x14, 0x04],
		[0x04, 0xc1, 0x11, 0x14, 0x01, 0x14],
		[0xc1, 0x14, 0x01, 0x14, 0x04, 0x04],
		[0x04, 0xc1, 0x11, 0x14, 0x04, 0x04],
		[0xc1, 0x14, 0x04, 0x04, 0x04, 0x04],
		[0xc4, 0x04, 0x04, 0x04, 0x04, 0x04],
	];
	const isCarrier = (alg, op) => (ALGS[alg][op] & OUTADD) !== 0;

	// kernels: gain ramps linearly over the block (dgain), all products < 2^53
	function kCompute(out, input, phase0, freq, gain1, gain2, add) {
		const dgain = (gain2 - gain1 + (N >> 1)) >> LG_N;
		let gain = gain1,
			phase = phase0;
		for (let i = 0; i < N; i++) {
			gain = (gain + dgain) | 0;
			const y = sinLookup((phase + input[i]) | 0);
			const y1 = Math.floor((y * gain) / 16777216);
			out[i] = add ? (out[i] + y1) | 0 : y1 | 0;
			phase = (phase + freq) | 0;
		}
	}

	function kPure(out, phase0, freq, gain1, gain2, add) {
		const dgain = (gain2 - gain1 + (N >> 1)) >> LG_N;
		let gain = gain1,
			phase = phase0;
		for (let i = 0; i < N; i++) {
			gain = (gain + dgain) | 0;
			const y = sinLookup(phase);
			const y1 = Math.floor((y * gain) / 16777216);
			out[i] = add ? (out[i] + y1) | 0 : y1 | 0;
			phase = (phase + freq) | 0;
		}
	}

	function kFb(out, phase0, freq, gain1, gain2, fb, fbShift, add) {
		const dgain = (gain2 - gain1 + (N >> 1)) >> LG_N;
		let gain = gain1,
			phase = phase0,
			y0 = fb[0],
			y = fb[1];
		for (let i = 0; i < N; i++) {
			gain = (gain + dgain) | 0;
			const scaled = (y0 + y) >> (fbShift + 1);
			y0 = y;
			y = sinLookup((phase + scaled) | 0);
			y = Math.floor((y * gain) / 16777216) | 0;
			out[i] = add ? (out[i] + y) | 0 : y;
			phase = (phase + freq) | 0;
		}
		fb[0] = y0;
		fb[1] = y;
	}

	class FmCore {
		constructor() {
			this.buf = [new Int32Array(N), new Int32Array(N)];
			this.has = new Uint8Array(3);
		}
		// params: array of 6 {gainOut, inputLevel, freq, phase}
		render(output, params, algorithm, fbBuf, fbShift) {
			const THRESH = 1120,
				alg = ALGS[algorithm],
				has = this.has;
			has[0] = 1;
			has[1] = 0;
			has[2] = 0;
			for (let op = 0; op < 6; op++) {
				const flags = alg[op];
				let add = (flags & OUTADD) !== 0;
				const p = params[op],
					inbus = (flags >> 4) & 3,
					outbus = flags & 3;
				const outptr = outbus === 0 ? output : this.buf[outbus - 1];
				const gain1 = p.gainOut;
				const gain2 = exp2Lookup((p.inputLevel - (14 << 24)) | 0);
				p.gainOut = gain2;
				if (gain1 >= THRESH || gain2 >= THRESH) {
					if (!has[outbus]) {
						add = false;
					}
					if (inbus === 0 || !has[inbus]) {
						if ((flags & 0xc0) === 0xc0 && fbShift < 16) {
							kFb(outptr, p.phase, p.freq, gain1, gain2, fbBuf, fbShift, add);
						} else {
							kPure(outptr, p.phase, p.freq, gain1, gain2, add);
						}
					} else {
						kCompute(outptr, this.buf[inbus - 1], p.phase, p.freq, gain1, gain2, add);
					}
					has[outbus] = 1;
				} else if (!add) {
					has[outbus] = 0;
				}
				p.phase = (p.phase + (p.freq << LG_N)) | 0;
			}
		}
	}

	// ---------------------------------------------------------------- note
	const coarsemul = [
		-16777216, 0, 16777216, 26591258, 33554432, 38955489, 43368474, 47099600, 50331648, 53182516,
		55732705, 58039632, 60145690, 62083076, 63876816, 65546747, 67108864, 68576247, 69959732,
		71268397, 72509921, 73690858, 74816848, 75892776, 76922906, 77910978, 78860292, 79773775,
		80654032, 81503396, 82323963, 83117622,
	];
	const velocity_data = [
		0, 70, 86, 97, 106, 114, 121, 126, 132, 138, 142, 148, 152, 156, 160, 163, 166, 170, 173, 174,
		178, 181, 184, 186, 189, 190, 194, 196, 198, 200, 202, 205, 206, 209, 211, 214, 216, 218, 220,
		222, 224, 225, 227, 229, 230, 232, 233, 235, 237, 238, 240, 241, 242, 243, 244, 246, 246, 248,
		249, 250, 251, 252, 253, 254,
	];
	const exp_scale_data = [
		0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 14, 16, 19, 23, 27, 33, 39, 47, 56, 66, 80, 94, 110, 126, 142,
		158, 174, 190, 206, 222, 238, 250,
	];
	const pitchmodsenstab = [0, 10, 20, 33, 55, 92, 153, 255];
	const ampmodsenstab = [0, 4342338, 7171437, 16777216];

	const SCR_R = [0, 0, 0, 0],
		SCR_L = [0, 0, 0, 0],
		SCR_LFO = [0, 0, 0, 0, 0, 0]; /* scratch for init(): nothing is allocated when a note starts */
	const midinoteToLogfreq = (n) => 50857777 + Math.floor((1 << 24) / 12) * n;

	function oscFreq(midinote, mode, coarse, fine, detune) {
		let lf;
		if (mode === 0) {
			lf = midinoteToLogfreq(midinote);
			lf += coarsemul[coarse & 31];
			if (fine) {
				lf += Math.floor(24204406.323123 * Math.log(1 + 0.01 * fine) + 0.5);
			}
			lf += 12606 * (detune - 7);
		} else {
			lf = (4458616 * ((coarse & 3) * 100 + fine)) >> 3;
			lf += detune > 7 ? 13457 * (detune - 7) : 0;
		}
		return lf | 0;
	}

	function scaleVelocity(velocity, sens) {
		const v = Math.max(0, Math.min(127, velocity));
		const vv = velocity_data[v >> 1] - 239;
		return ((sens * vv + 7) >> 3) << 4;
	}

	function scaleRate(midinote, sens) {
		const x = Math.min(31, Math.max(0, Math.floor(midinote / 3) - 7));
		return (sens * x) >> 3;
	}

	function scaleCurve(group, depth, curve) {
		let scale;
		if (curve === 0 || curve === 3) {
			scale = (group * depth * 329) >> 12;
		} else {
			scale = (exp_scale_data[Math.min(group, exp_scale_data.length - 1)] * depth * 329) >> 15;
		}
		if (curve < 2) {
			scale = -scale;
		}
		return scale;
	}

	function scaleLevel(midinote, bp, ld, rd, lc, rc) {
		const off = midinote - bp - 17;
		return off >= 0
			? scaleCurve(Math.floor((off + 1) / 3), rd, rc)
			: scaleCurve(Math.floor((-off + 1) / 3), ld, lc); /* msfa/Dexed: (offset + 1) / 3 */
	}

	class Dx7Note {
		constructor() {
			this.core = new FmCore();
			this.env = [];
			this.params = [];
			for (let i = 0; i < 6; i++) {
				this.env.push(new Env());
				this.params.push({ gainOut: 0, inputLevel: 0, freq: 0, phase: 0 });
			}
			this.pitchenv = new PitchEnv();
			this.basepitch = new Int32Array(6);
			this.ampmodsens = new Int32Array(6);
			this.fb = new Int32Array(2);
			this.fbShift = 16;
			this.alg = 0;
			this.pmd = 0;
			this.pms = 0;
			this.amd = 0;
			this.opMode = [0, 0, 0, 0, 0, 0];
			this.opSwitch = 63;
			this.inited = false;
			this.note = -1;
			this.fn = 0;
		}
		init(patch, midinote, velocity) {
			this.inited = true;
			this.note = midinote;
			const rates = SCR_R,
				levels = SCR_L;
			for (let op = 0; op < 6; op++) {
				const off = op * 21;
				for (let i = 0; i < 4; i++) {
					rates[i] = patch[off + i];
					levels[i] = patch[off + 4 + i];
				}
				let outlevel = scaleOutLevel(patch[off + 16]);
				outlevel += scaleLevel(
					midinote,
					patch[off + 8],
					patch[off + 9],
					patch[off + 10],
					patch[off + 11],
					patch[off + 12],
				);
				outlevel = Math.min(127, outlevel);
				outlevel = outlevel << 5;
				outlevel += scaleVelocity(velocity, patch[off + 15]);
				outlevel = Math.max(0, outlevel);
				this.env[op].init(rates, levels, outlevel, scaleRate(midinote, patch[off + 13]));
				const mode = patch[off + 17];
				this.opMode[op] = mode;
				this.basepitch[op] = oscFreq(
					midinote,
					mode,
					patch[off + 18],
					patch[off + 19],
					patch[off + 20],
				);
				this.ampmodsens[op] = ampmodsenstab[patch[off + 14] & 3];
				this.params[op].phase = 0;
				this.params[op].gainOut = 0;
				this.params[op].inputLevel = 0;
			}
			for (let i = 0; i < 4; i++) {
				rates[i] = patch[126 + i];
				levels[i] = patch[130 + i];
			}
			this.pitchenv.set(rates, levels);
			this.alg = patch[134];
			const feedback = patch[135];
			this.fbShift = feedback !== 0 ? FEEDBACK_BITDEPTH - feedback : 16;
			this.fb[0] = 0;
			this.fb[1] = 0;
			this.pmd = (patch[139] * 165) >> 6;
			this.pms = pitchmodsenstab[patch[143] & 7];
			this.amd = (patch[140] * 165) >> 6;
			this.opSwitch = patch.length > 155 ? patch[155] : 63;
		}
		// adds into buf. lfoVal is Q24 (0..2^24), lfoDelay Q24 (0..2^24)
		compute(buf, lfoVal, lfoDelay, tune) {
			// ==== PITCH ====
			const pmdv = this.pmd * lfoDelay; // < 2^32
			const senslfo = this.pms * (lfoVal - (1 << 23)); // |.| < 2^31
			let pmod1 = 0;
			if (pmdv !== 0 && senslfo !== 0) {
				/* |(pmdv * senslfo) >> 39| in exact double maths (the product has up to 63 bits) */
				const neg = senslfo < 0,
					m = neg ? -senslfo : senslfo,
					A = pmdv * (m >>> 16),
					B = pmdv * (m & 65535);
				const Bh = Math.floor(B / 65536),
					T = A + Bh,
					q = Math.floor(T / 8388608);
				pmod1 = neg && (T - q * 8388608 !== 0 || B - Bh * 65536 !== 0) ? q + 1 : q;
			}
			const pitchMod = this.pitchenv.getsample() + pmod1 * (senslfo < 0 ? -1 : 1);
			// ==== AMP MOD (no controllers connected, eg_mod = 127) ====
			const lv = (1 << 24) - lfoVal;
			let amod1 = Math.floor((this.amd * lfoDelay) / 256);
			amod1 = Math.floor((amod1 * lv) / 16777216);
			const amdMod = amod1 >>> 0;
			// ==== OP RENDER ====
			for (let op = 0; op < 6; op++) {
				const p = this.params[op];
				if (!(this.opSwitch & (1 << op))) {
					this.env[op].getsample();
					p.inputLevel = 0;
					continue;
				}
				p.freq = freqLookup(
					(this.basepitch[op] + (tune | 0) + (this.opMode[op] ? 0 : pitchMod)) | 0,
				);
				let level = this.env[op].getsample();
				if (this.ampmodsens[op] !== 0) {
					const sensamp = Math.floor((amdMod * this.ampmodsens[op]) / 16777216) >>> 0;
					const pt = Math.floor(Math.exp((sensamp / 262144) * 0.07 + 12.2)) >>> 0;
					const lv = level >>> 0,
						ldiff =
							Math.floor(((lv >>> 16) * pt + Math.floor(((lv & 65535) * pt) / 65536)) / 256) >>> 0;
					level = (level - ldiff) | 0;
				}
				p.inputLevel = level;
			}
			this.core.render(buf, this.params, this.alg, this.fb, this.fbShift);
		}
		keyup() {
			for (let i = 0; i < 6; i++) {
				this.env[i].keydown(false);
			}
			this.pitchenv.keydown(false);
		}
		isPlaying() {
			if (!this.inited) {
				return false;
			}
			for (let i = 0; i < 6; i++) {
				if (isCarrier(this.alg, i) && this.env[i].isActive()) {
					return true;
				}
			}
			return false;
		}
	}

	// ---------------------------------------------------------------- engine
	// 12 voices, 64-sample blocks, LFO once per block, per-voice >>4 into the mix.
	// Output stage (Mellow's addition, all fixed-size state, 6 multiply-adds per sample): DC blocker (1.5 Hz) -> peak limiter with
	// one-block look-ahead gain ramp (ceiling 0.9, release ~120 ms) -> soft ceiling that can never reach 1.0 -> NaN/Inf guard.
	// Nothing in noteOn / noteOff / block allocates: stolen voices swap with a pool of spare notes.
	const LIM_C = 0.9;

	// Voice stealing (all 12 voices busy): a released voice (a tail) goes before any held note, and the oldest goes first. It used to take a round-robin cursor, which is the OLDEST voice
	// held or not, so a held chord was the first thing to vanish under a looping queue or an arp (measured: HOLD a 3-note chord, loop a queue over a long-release pad, the chord was gone in 4 s).
	// A voice's age is one counter shared by every engine, so the worklet can rank the voices of all four tracks together (cap in FM_WORKLET).
	// Firmware: one 32-bit age per voice (48 bytes) and one pass over 12 voices when a note finds no free one.
	let voiceSeq = 0;

	const stealScore = (v) => (v.held ? 0 : 1e15) - v.age; // the highest score is stolen first
	class Engine {
		constructor(sampleRate, voices) {
			if (!tablesReady || Engine.sr !== sampleRate) {
				initTables(sampleRate);
				Engine.sr = sampleRate;
			}
			this.nv = voices || 12;
			this.voices = [];
			this.cursor = 0;
			for (let i = 0; i < this.nv; i++) {
				this.voices.push({
					note: -1,
					held: false,
					active: false,
					holds: 0,
					age: 0,
					bc: 0,
					bt: 0,
					bs: 0,
					dx: new Dx7Note(),
				});
			}
			this.lfo = new Lfo();
			this.patch = new Uint8Array(156);
			this.vbuf = new Int32Array(N);
			this.mix = new Int32Array(N);
			this.tune = 0;
			this.dying = [];
			this.spare = [];
			for (let i = 0; i < 6; i++) {
				this.spare.push(new Dx7Note());
			} // stolen voices are swapped, not allocated
			this.og = 1; // output gain applied before the limiter (the FM-1 tracks use 3)
			this.dcx = 0;
			this.dcy = 0;
			this.dcR = 1 - (2 * Math.PI * 1.5) / sampleRate; // DC blocker, fc 1.5 Hz (the core has almost no DC: it is insurance, so its start-up shift stays under 2% at 65 Hz)
			this.lg = 1;
			this.lrel = 1 - Math.exp(-N / (0.12 * sampleRate));
			this.tmp = new Float64Array(N);
			this.post = true;
			this.resets = 0;
		}
		// parameters are clamped to what a DX7 voice (VMEM) can hold, so no byte pattern can index outside a table
		setPatch(p) {
			const d = this.patch,
				n = Math.min(155, p.length),
				c = (v, hi) => (v > hi ? hi : v);
			for (let j = 0; j < n; j++) {
				d[j] = p[j];
			}
			for (let op = 0; op < 6; op++) {
				const o = op * 21;
				for (let i = 0; i < 11; i++) {
					d[o + i] = c(d[o + i], 99);
				} // rates, levels, breakpoint, left and right depth
				d[o + 11] &= 3;
				d[o + 12] &= 3;
				d[o + 13] = c(d[o + 13], 7);
				d[o + 14] &= 3;
				d[o + 15] = c(d[o + 15], 7);
				d[o + 16] = c(d[o + 16], 99);
				d[o + 17] &= 1;
				d[o + 18] &= 31;
				d[o + 19] = c(d[o + 19], 99);
				d[o + 20] = c(d[o + 20], 14);
			}
			for (let i = 126; i < 134; i++) {
				d[i] = c(d[i], 99);
			}
			d[134] &= 31;
			d[135] = c(d[135], 7);
			d[136] &= 1;
			for (let i = 137; i < 141; i++) {
				d[i] = c(d[i], 99);
			}
			d[141] &= 1;
			d[142] = c(d[142], 5);
			d[143] = c(d[143], 7);
			d[155] = p.length > 155 ? p[155] & 63 : 63;
			SCR_LFO[0] = d[137];
			SCR_LFO[1] = d[138];
			SCR_LFO[2] = d[139];
			SCR_LFO[3] = d[140];
			SCR_LFO[4] = d[141];
			SCR_LFO[5] = d[142];
			this.lfo.reset(SCR_LFO);
		}
		noteOn(note, vel, mono) {
			let i = -1,
				holds = 0;
			if (mono) {
				i = 0;
				for (let k = 1; k < this.nv; k++) {
					if (this.voices[k].active && this.voices[k].held) {
						this.voices[k].held = false;
						this.voices[k].holds = 0;
						this.voices[k].dx.keyup();
					}
				}
			} else {
				// the same key pressed again while it is still held restarts that voice (counted, so each press needs its own release) instead of stacking a second copy on top of it
				for (let k = 0; k < this.nv; k++) {
					const w = this.voices[k];
					if (w.active && w.held && w.note === note) {
						i = k;
						holds = w.holds;
						break;
					}
				}
				if (i < 0) {
					for (let k = 0; k < this.nv; k++) {
						const c = (this.cursor + k) % this.nv;
						if (!this.voices[c].active) {
							i = c;
							break;
						}
					}
				}
			}
			if (i < 0) {
				let bs = -1e18;
				for (let k = 0; k < this.nv; k++) {
					const w = this.voices[k],
						s = stealScore(w);
					if (s > bs) {
						bs = s;
						i = k;
					}
				}
			} // steal the oldest tail, else the oldest held note
			this.cursor = (i + 1) % this.nv;
			const v = this.voices[i];
			if (v.active) {
				this.fadeOut(v);
			} // the old note fades over ~3 ms instead of clicking off
			v.age = ++voiceSeq;
			v.note = note;
			v.active = true;
			v.held = true;
			v.holds = holds + 1;
			v.bc = 0;
			v.bt = 0;
			v.bs = 0;
			this.lfo.keydown();
			v.dx.init(this.patch, note, vel);
		}
		noteOff(note) {
			for (let k = 0; k < this.nv; k++) {
				const v = this.voices[k];
				if (v.active && v.held && v.note === note) {
					if (v.holds > 1) {
						v.holds--;
						return;
					}
					v.held = false;
					v.holds = 0;
					v.dx.keyup();
					break;
				}
			}
		}
		// a queued step's pitch bend: this note's own offset (1/16777216 octave units, like tune) glides to `to` over `dur` seconds (the block-wise linear glide in block(): click-free)
		bend(note, to, dur) {
			for (const v of this.voices) {
				if (v.active && v.held && v.note === note) {
					v.bt = to;
					v.bs = Math.max(1, Math.abs(to - v.bc) / Math.max(1, Math.round((dur * Engine.sr) / N)));
				}
			}
		}
		killAll() {
			for (const v of this.voices) {
				if (v.active) {
					this.fadeOut(v);
				}
			}
		} // KILL: every voice out in ~3 ms, release tails included
		quench(note) {
			for (const v of this.voices) {
				if (v.active && v.note === note) {
					this.fadeOut(v);
				}
			}
		} // a muted sequencer note: out in ~3 ms, release tail included
		allOff() {
			for (const v of this.voices) {
				if (v.active && v.held) {
					v.held = false;
					v.holds = 0;
					v.dx.keyup();
				}
			}
		}
		anyActive() {
			if (this.dying.length) {
				return true;
			}
			for (let k = 0; k < this.nv; k++) {
				if (this.voices[k].active) {
					return true;
				}
			}
			return false;
		}
		fadeOut(v) {
			if (this.dying.length >= 6) {
				this.spare.push(this.dying.shift());
			} // a burst of steals: the oldest fade (already half way) ends now
			v.dx.fn = 0;
			this.dying.push(v.dx);
			v.dx = this.spare.pop() || new Dx7Note();
			v.active = false;
			v.held = false;
			v.holds = 0;
		}
		// kills every voice and the fades, and clears the output filters (used if the output ever went non-finite)
		reset() {
			for (const v of this.voices) {
				v.active = false;
				v.held = false;
				v.holds = 0;
			}
			while (this.dying.length) {
				this.spare.push(this.dying.pop());
			}
			this.dcx = 0;
			this.dcy = 0;
			this.lg = 1;
			this.resets++;
		}
		// renders one block of N samples into out (Float32Array) at offset
		block(out, off) {
			const mix = this.mix,
				vbuf = this.vbuf,
				dying = this.dying;
			mix.fill(0);
			const lfoVal = this.lfo.getsample(),
				lfoDelay = this.lfo.getdelay();
			for (let k = 0; k < this.nv; k++) {
				const v = this.voices[k];
				if (!v.active) {
					continue;
				}
				vbuf.fill(0);
				if (v.bt !== v.bc) {
					const d = v.bt - v.bc;
					v.bc = d < v.bs && d > -v.bs ? v.bt : v.bc + (d > 0 ? v.bs : -v.bs);
				}
				v.dx.compute(vbuf, lfoVal, lfoDelay, this.tune + (v.bc | 0));
				for (let j = 0; j < N; j++) {
					mix[j] = (mix[j] + (vbuf[j] >> 4)) | 0;
				}
				if (!v.held && !v.dx.isPlaying()) {
					v.active = false;
				}
			}
			for (let d = dying.length - 1; d >= 0; d--) {
				// fade-out of stolen/killed voices: 1 -> 0.5 -> 0 over two blocks
				const y = dying[d];
				vbuf.fill(0);
				y.compute(vbuf, lfoVal, lfoDelay, this.tune);
				const g0 = 1 - y.fn * 0.5;
				for (let j = 0; j < N; j++) {
					mix[j] = (mix[j] + Math.round((vbuf[j] >> 4) * (g0 - (0.5 * (j + 1)) / N))) | 0;
				}
				if (++y.fn >= 2) {
					for (let m = d; m < dying.length - 1; m++) {
						dying[m] = dying[m + 1];
					}
					this.spare.push(y);
					dying.length--;
				}
			}
			if (!this.post) {
				for (let j = 0; j < N; j++) {
					out[off + j] = mix[j] / 16777216;
				}
				return;
			}
			// ---- output stage
			const og = this.og / 16777216,
				R = this.dcR,
				tmp = this.tmp;
			let x1 = this.dcx,
				y1 = this.dcy,
				pk = 0,
				nan = 0;
			for (let j = 0; j < N; j++) {
				const x = mix[j] * og,
					y = x - x1 + R * y1;
				x1 = x;
				y1 = y;
				tmp[j] = y;
				const a = y < 0 ? -y : y;
				if (a > pk) {
					pk = a;
				}
				nan += y * 0;
			}
			if (nan !== 0 || !(pk < 1e9)) {
				this.reset();
				for (let j = 0; j < N; j++) {
					out[off + j] = 0;
				}
				return;
			} // NaN / Inf / absurd: silence and start clean
			this.dcx = x1;
			this.dcy = y1 > 1e-20 || y1 < -1e-20 ? y1 : 0;
			const g0 = this.lg,
				need = pk > LIM_C ? LIM_C / pk : 1,
				rel = g0 + (1 - g0) * this.lrel,
				gt = need < rel ? need : rel,
				dg = (gt - g0) / N;
			let g = g0;
			for (let j = 0; j < N; j++) {
				g += dg;
				let s = tmp[j] * g,
					a = s < 0 ? -s : s;
				if (a > 0.9) {
					const u = (a - 0.9) * 10;
					a = 0.9 + (0.1 * u) / (1 + u);
					s = s < 0 ? -a : a;
				} // only the first samples of a sudden overload reach this; it can never touch 1.0
				out[off + j] = s;
			}
			this.lg = gt;
		}
	}

	return {
		N,
		Engine,
		Dx7Note,
		FmCore,
		Env,
		PitchEnv,
		Lfo,
		initTables,
		ALGS,
		isCarrier,
		stealScore,
		sinLookup,
		exp2Lookup,
		freqLookup,
		scaleOutLevel,
		scaleLevel,
	};
})();
if (typeof module !== "undefined") {
	module.exports = DX7;
}
