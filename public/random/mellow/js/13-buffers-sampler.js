// audio buffers, curves and the sampler data
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-unused-vars, no-undef -- offers names the other files use; uses names that live in the other files of the folder */

// ---------- buffers, curves ----------
function noiseBuf(sec, kind, cb) {
	const n = Math.floor(AC.sampleRate * sec),
		b = AC.createBuffer(1, n, AC.sampleRate),
		d = b.getChannelData(0);
	if (cb && kind === "brown") {
		let l = 0,
			i = 0;
		const st = () => {
			const e = Math.min(n, i + 65536);
			for (; i < e; i++) {
				l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02;
				d[i] = l * 3.5;
			}
			if (i < n) {
				setTimeout(st, 0);
			} else {
				cb(b);
			}
		};
		st();
		return;
	} /* async: 64k samples per task, calls cb(buffer) */
	if (kind === "brown") {
		let l = 0;
		for (let i = 0; i < n; i++) {
			l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02;
			d[i] = l * 3.5;
		}
	} else if (kind === "pops") {
		const c = Math.floor(sec * 7);
		for (let k = 0; k < c; k++) {
			const p = Math.floor(Math.random() * (n - 200)),
				a = (Math.random() < 0.15 ? 1 : 0.3) * (Math.random() * 0.6 + 0.3);
			for (let j = 0; j < 40; j++) {
				d[p + j] = (Math.random() * 2 - 1) * a * Math.exp(-j / 6);
			}
		}
	} else if (kind === "crackle") {
		const c = Math.floor(sec * 26);
		for (let k = 0; k < c; k++) {
			const p = Math.floor(Math.random() * (n - 300)),
				a = Math.random() * 0.9,
				len = 20 + Math.random() * 120;
			for (let j = 0; j < len; j++) {
				d[p + j] = (Math.random() * 2 - 1) * a * Math.exp(-j / (len / 4));
			}
		}
	} else {
		for (let i = 0; i < n; i++) {
			d[i] = Math.random() * 2 - 1;
		}
	}
	if (cb) {
		setTimeout(() => cb(b), 0);
		return;
	}
	return b;
}

// shaper input is halved, so the curve spans -2..+2 of the real signal: linear up to 0.8, then eases to exactly 1.0
function softClipCurve() {
	const n = 4096,
		c = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const a = ((i / (n - 1)) * 2 - 1) * 2,
			m = Math.abs(a);
		c[i] = (m <= 0.8 ? m : 0.8 + 0.2 * Math.tanh((m - 0.8) / 0.2)) * Math.sign(a);
	}
	return c;
}

function satCurve(k) {
	const n = 2048,
		c = new Float32Array(n),
		d = Math.tanh(k * 0.35) / 0.35;
	for (let i = 0; i < n; i++) {
		const x = (i / (n - 1)) * 2 - 1;
		c[i] = Math.tanh(x * k) / d;
	}
	return c;
}

function crushCurve(bits) {
	const n = 4096,
		c = new Float32Array(n),
		lv = Math.pow(2, bits - 1);
	for (let i = 0; i < n; i++) {
		const x = (i / (n - 1)) * 2 - 1;
		c[i] = Math.round(x * lv) / lv;
	}
	return c;
}

/* ---- the reverb: an 8-line feedback delay network rendered to an impulse response ----
   What the FM-1 would run per sample: four series allpass diffusers on the input, eight modulated delay lines, a one-pole damping filter on each (Jot: DC decay and Nyquist decay set separately),
   an 8x8 Hadamard feedback matrix (24 additions), early-reflection taps off the input line, and a stereo tap sum. About 150 multiply-adds per sample, and for HALL at the default size about
   290 ms of delay = 12.8 k samples = 26 KB at 16 bit (+2 KB diffusers, +2 KB pre-delay; SHIMMER adds a 4 KB pitch-shifter line). That is 3x stock's 8 KB arena, so it would come out of the free RAM.
   The prototype does not run it per sample: it renders the algorithm's impulse response once (in small chunks, so the page never stalls) and the browser's convolver plays that back (the
   convolver is the stand-in, the algorithm is what ships). The four types differ in their lines, pre-delay, early reflections, damping and diffusion, not just in length. */
function irGen(rt, size, damp, sr, probe) {
	const sz = size / 99,
		dp = damp / 99,
		rnd0 = (2463534242 + rt * 977 + size * 131) >>> 0;
	let rx = rnd0;
	const rnd = () => {
		rx ^= rx << 13;
		rx >>>= 0;
		rx ^= rx >>> 17;
		rx ^= rx << 5;
		rx >>>= 0;
		return rx / 2147483648 - 1;
	};
	// type table: pre-delay (s), line lengths (ms), RT60 at DC (s), Nyquist/DC decay ratio, modulation depth (samples), diffuser gain/count, early reflections [ms, gain], brightness
	const TY = [
			{
				pre: 0.022,
				L: [17.3, 21.1, 25.7, 29.9, 34.3, 39.1, 44.9, 51.7],
				ls: 0.75 + sz * 0.5,
				t60: 0.9 + sz * 3.1,
				al: 0.85 - 0.62 * dp,
				mod: 3,
				dg: 0.55,
				diffN: 4,
				er: [
					[31, 0.28],
					[43, -0.22],
					[57, 0.18],
				],
				hi: 0,
			}, // HALL: big, late, smooth, dark tail
			{
				pre: 0.004,
				L: [11.3, 14.9, 18.7, 22.9, 27.7, 33.1, 39.7, 47.3],
				ls: 0.8 + sz * 0.4,
				t60: 0.18 + sz * 1.1,
				al: 0.95 - 0.4 * dp,
				mod: 2.5,
				dg: 0.5,
				diffN: 3,
				er: [
					[6.3, 0.9],
					[9.7, -0.8],
					[13.1, 0.7],
					[17.9, -0.62],
					[23.3, 0.52],
					[29.7, -0.42],
					[37.1, 0.34],
					[45.7, -0.26],
				],
				hi: 0,
			}, // ROOM: short, strong early reflections
			{
				pre: 0,
				L: [13.7, 17.3, 21.1, 25.3, 29.9, 34.7, 39.9, 45.7],
				ls: 0.85 + sz * 0.3,
				t60: 0.5 + sz * 2.7,
				al: 0.98 - 0.25 * dp,
				mod: 6,
				dg: 0.7,
				diffN: 6,
				er: [],
				hi: 0.9,
			}, // PLATE: instant, dense, bright, no reflections
			{
				pre: 0.024,
				L: [19.9, 24.3, 29.5, 34.3, 39.5, 45.1, 51.7, 59.5],
				ls: 0.75 + sz * 0.5,
				t60: 1.4 + sz * 3,
				al: 0.9 - 0.45 * dp,
				mod: 4,
				dg: 0.55,
				diffN: 4,
				er: [
					[33, 0.25],
					[47, -0.2],
				],
				hi: 0,
				shim: 1,
			}, // SHIMMER: a hall whose tail is also fed an octave up
		][rt],
		n = Math.min(Math.floor(sr * 3.2), Math.floor(sr * TY.t60 * 1.1)),
		pre = Math.floor(sr * TY.pre);
	const outL = new Float32Array(n),
		outR = new Float32Array(n),
		NL = 8;
	const len = TY.L.map((ms) => Math.max(8, Math.round((ms * TY.ls * sr) / 1000))),
		mxd = Math.ceil(TY.mod) + 3,
		line = len.map((l) => new Float32Array(l + mxd + 2)),
		w = new Int32Array(NL);
	const g = len.map((l) => Math.pow(10, (-3 * l) / (sr * TY.t60))),
		al = Math.max(0.05, Math.min(0.98, TY.al)),
		pd = g.map((gi) =>
			Math.max(0, Math.min(0.97, (Math.LN10 / 4) * Math.log10(gi) * (1 - 1 / (al * al)))),
		),
		z = new Float64Array(NL);
	// input diffusion: series allpass, lengths in ms scaled with the rate
	const dl = [4.3, 3.1, 8.6, 6.3, 2.3, 5.1]
			.slice(0, TY.diffN)
			.map((ms) => Math.round((ms * sr) / 1000)),
		dbuf = dl.map((l) => new Float32Array(l + 1)),
		dw = new Int32Array(dl.length);
	// early reflection taps: short noise bursts, panned alternately
	const er = TY.er.map(([ms, gn], k) => {
		const bl = 24,
			b = new Float32Array(bl);
		let lp = 0;
		for (let j = 0; j < bl; j++) {
			lp += 0.6 * (rnd() - lp);
			b[j] = lp * Math.exp(-j / 8);
		}
		return { at: pre + Math.round((ms * sr) / 1000), gn, b, pan: k % 2 ? 0.75 : 0.25 };
	});
	// modulation: one slow sine per line, incommensurate rates
	const mr = [0.31, 0.43, 0.57, 0.71, 0.83, 1.09, 1.37, 1.71].map((f) => (f * 2 * Math.PI) / sr),
		mp = new Float64Array(NL).map((_, i) => i * 0.8);
	// shimmer: a two-head granular octave-up shifter in the feedback (60 ms grains)
	const SD = Math.round(0.06 * sr),
		sb = new Float32Array(SD + 4);
	let sw = 0,
		sph = 0;
	const sL = [1, -1, 1, -1, 1, -1, 1, -1],
		sR = [1, 1, -1, -1, 1, 1, -1, -1];
	let i = 0,
		x = new Float64Array(NL),
		y = new Float64Array(NL),
		hp = 0;
	const total = n + 0;

	function run(max) {
		const end = Math.min(total, i + max);
		for (; i < end; i++) {
			// input: the impulse through the diffusers
			let v = probe
				? i < 2205
					? Math.sin((2 * Math.PI * probe * i) / sr) * Math.pow(Math.sin((Math.PI * i) / 2205), 2)
					: 0
				: i === 0
					? 1
					: 0;
			for (let d = 0; d < dl.length; d++) {
				const b = dbuf[d],
					p = dw[d],
					o = b[p],
					t = v + -TY.dg * o;
				b[p] = t;
				v = o + TY.dg * t;
				dw[d] = (p + 1) % b.length;
			}
			// read the lines
			for (let k = 0; k < NL; k++) {
				const L = line[k],
					N = L.length,
					dm = TY.mod * Math.sin(mp[k]);
				mp[k] += mr[k];
				let r = w[k] - len[k] - dm;
				while (r < 0) {
					r += N;
				}
				const i0 = Math.floor(r),
					f = r - i0,
					a = L[i0 % N],
					b = L[(i0 + 1) % N];
				y[k] = a + (b - a) * f;
			}
			// damping + decay per line, then the Hadamard mix
			for (let k = 0; k < NL; k++) {
				const o = g[k] * (1 - pd[k]) * y[k] + pd[k] * z[k];
				z[k] = o;
				x[k] = o;
			}
			let sh = 0;
			if (TY.shim) {
				const m = (x[2] + x[6]) * 0.5;
				sb[sw] = m;
				const d1 = sph * SD,
					d2 = ((sph + 0.5) % 1) * SD;
				const rd = (d) => {
					let r = sw - d;
					while (r < 0) {
						r += SD + 4;
					}
					const i0 = Math.floor(r),
						f = r - i0;
					return sb[i0 % (SD + 4)] * (1 - f) + sb[(i0 + 1) % (SD + 4)] * f;
				};
				const w1 = Math.pow(Math.sin(Math.PI * sph), 2),
					w2 = Math.pow(Math.sin(Math.PI * ((sph + 0.5) % 1)), 2);
				sh = (rd(d1) * w1 + rd(d2) * w2) * 0.42;
				sph -= 1 / SD;
				if (sph < 0) {
					sph += 1;
				}
				sw = (sw + 1) % (SD + 4);
			} /* ratio 2: the read heads move 2 samples per sample */
			// 8-point fast Walsh-Hadamard (in place on x), scaled by 1/sqrt(8)
			for (let h = 1; h < NL; h <<= 1) {
				for (let a = 0; a < NL; a += h << 1) {
					for (let b = a; b < a + h; b++) {
						const p = x[b],
							q = x[b + h];
						x[b] = p + q;
						x[b + h] = p - q;
					}
				}
			}
			const sc = 0.35355339;
			let oL = 0,
				oR = 0;
			for (let k = 0; k < NL; k++) {
				let u = x[k] * sc + v * 0.35355339 * (k % 3 ? 1 : -1);
				if (k === 3 || k === 6) {
					u += sh;
				}
				const L = line[k];
				L[w[k]] = u;
				w[k] = (w[k] + 1) % L.length;
				oL += sL[k] * y[k];
				oR += sR[k] * y[k];
			}
			let l = oL * 0.5,
				r = oR * 0.5;
			if (TY.hi) {
				const nl = l,
					nr = r;
				hp += 0.25 * ((nl + nr) * 0.5 - hp);
				l += TY.hi * (nl - hp);
				r += TY.hi * (nr - hp);
			} /* plate: a bright edge */
			const j = i + pre;
			if (j < n) {
				outL[j] += l;
				outR[j] += r;
			}
		}
		return i >= total;
	}

	// early reflections are added at the end of the render (they are independent of the network)
	function finish() {
		er.forEach((e) => {
			for (let j = 0; j < e.b.length; j++) {
				const q = e.at + j;
				if (q < n) {
					outL[q] += e.b[j] * e.gn * (1 - e.pan) * 1.6;
					outR[q] += e.b[j] * e.gn * e.pan * 1.6;
				}
			}
		});
		// a short fade at the very end so the truncated tail cannot click, and a scale so the loudest part is ~1
		const f = Math.min(n >> 2, Math.floor(sr * 0.12));
		for (let j = 0; j < f; j++) {
			const m = j / f;
			outL[n - 1 - j] *= m;
			outR[n - 1 - j] *= m;
		}
		let pk = 1e-9;
		for (let j = 0; j < n; j++) {
			pk = Math.max(pk, Math.abs(outL[j]), Math.abs(outR[j]));
		}
		for (let j = 0; j < n; j++) {
			outL[j] /= pk;
			outR[j] /= pk;
		}
	}
	return {
		run,
		finish,
		outL,
		outR,
		n,
		mem: len.reduce((a, b) => a + b, 0) + dl.reduce((a, b) => a + b, 0) + pre + (TY.shim ? SD : 0),
	};
}

/* renders the network above in 2048-sample slices (a few ms each), then hands the stereo buffer to the convolver */
function buildIR(rt, size, damp, done, tok) {
	const sr = AC.sampleRate,
		g = irGen(rt, size, damp, sr),
		b = AC.createBuffer(2, g.n, sr);
	const step = () => {
		if (tok !== A.irTok) {
			return;
		}
		if (!g.run(2048)) {
			setTimeout(step, 0);
			return;
		}
		g.finish();
		b.copyToChannel(g.outL, 0);
		b.copyToChannel(g.outR, 1);
		done(b);
	};
	step();
}

function swapIR(f) {
	const tok = ++A.irTok;
	buildIR(
		f.rt,
		f.size,
		f.damp,
		(b) => {
			if (tok !== A.irTok) {
				return;
			}
			const t = AC.currentTime;
			A.irHold = true;
			A.rW.gain.cancelScheduledValues(t);
			A.rW.gain.setTargetAtTime(0, t, 0.008);
			setTimeout(() => {
				if (tok !== A.irTok) {
					return;
				}
				A.conv.buffer = b;
				A.irBuf = b;
				A.irReady = true;
				A.irHold = false;
				audioSync();
			}, 50);
		},
		tok,
	);
}

// ---------- sampler data ----------
const SMP_RATE = 22050,
	SMP_MAX = 2;
// device limit: 2 s x 22,050 Hz x 8-bit = ~44 KB of RAM

const SMP_ULAW = true;
/* the 8 bits are mu-law (G.711, mu=255), not linear: the same 44 KB, but the step grows with the level, so quiet tails keep ~38 dB of signal-to-noise instead of falling to 20 dB. Decoding on the device is a 256-entry table (512 B of flash); encoding is a log lookup at record time. */
function ulawQ(x) {
	const a = Math.min(1, Math.abs(x));
	if (!(a > 0)) {
		return 0;
	}
	const q = Math.round((Math.log(1 + 255 * a) / Math.log(256)) * 127) / 127,
		y = (Math.pow(256, q) - 1) / 255;
	return x < 0 ? -y : y;
}

/* The sampler's one resampler: a Blackman-windowed sinc (12 zero crossings each side), evaluated at fractional positions from a 256-per-sample table, DC gain exactly 1. Going down (the recorded bar to 22,050 Hz) its cutoff sits at 92% of the new Nyquist, so nothing above 10 kHz folds back; going up (22,050 Hz data to the context's rate) it reconstructs the 8-bit steps without the images that a linear read leaves. On the device the same job is a half-band FIR on the 44,118 Hz recording and a 4-point Hermite read on playback (about 10 multiplies a sample). With `done`, the work is cut into ~2 ms tasks so the page never stalls. */
function smpResample(d, reverbIn, rOut, done) {
	const n = d.length,
		m = Math.max(1, Math.floor((n * rOut) / reverbIn)),
		o = new Float32Array(m),
		ratio = reverbIn / rOut,
		fc = Math.min(1, rOut / reverbIn) * (rOut < reverbIn ? 0.92 : 1),
		hw = 12 / fc,
		R = 256,
		K = Math.ceil(hw * R),
		tab = new Float32Array(2 * K + 2);
	for (let k = -K; k <= K; k++) {
		const u = k / R,
			a = Math.PI * fc * u,
			s = k === 0 ? 1 : Math.sin(a) / a,
			w =
				Math.abs(u) >= hw
					? 0
					: 0.42 + 0.5 * Math.cos((Math.PI * u) / hw) + 0.08 * Math.cos((2 * Math.PI * u) / hw);
		tab[k + K] = fc * s * w;
	}
	const run = (a, b) => {
		for (let i = a; i < b; i++) {
			const x = i * ratio,
				j0 = Math.ceil(x - hw),
				j1 = Math.floor(x + hw);
			let s = 0,
				w = 0;
			for (let j = j0; j <= j1; j++) {
				const h = tab[((x - j) * R + K + 0.5) | 0],
					v = d[j < 0 ? 0 : j >= n ? n - 1 : j];
				w += h;
				s += h * v;
			}
			o[i] = w ? s / w : 0;
		}
	};
	if (!done) {
		run(0, m);
		return o;
	}
	let i = 0;
	const step = () => {
		const e = Math.min(m, i + 1536);
		run(i, e);
		i = e;
		if (i < m) {
			setTimeout(step, 0);
		} else {
			done(o);
		}
	};
	step();
}

function genLoop() {
	const sr = SMP_RATE,
		n = sr * SMP_MAX,
		d = new Float32Array(n),
		sl = n / 8;
	let x = 20240607;
	const rnd = () =>
		(x = (Math.imul(x, 1664525) + 1013904223) >>> 0) /
		4294967296; /* fixed seed: the same loop every time */
	/* one hit per slice: even slices are electric-piano chord stabs, odd slices are kick, snare, hat, open hat. Each hit is rendered on its own, faded out before its slice ends (so the loop wraps clean) and scaled to a set loudness, so every slice plays at about the same volume. */
	const hit = (s, len, f, rms) => {
		const st = Math.floor(s * sl),
			L = Math.min(Math.floor(len * sr), Math.floor(sl) - 1),
			b = new Float32Array(L);
		let e = 0;
		for (let i = 0; i < L; i++) {
			const r = (L - i) / (0.03 * sr);
			b[i] = f(i / sr, i) * (r < 1 ? r : 1);
			e += b[i] * b[i];
		}
		const g = e > 0 ? rms / Math.sqrt(e / L) : 0;
		for (let i = 0; i < L; i++) {
			d[st + i] += Math.tanh(2.2 * b[i] * Math.min(g, 40)) / 2.2;
		}
	}; /* the tanh keeps a noisy hit's random peaks near its body */
	/* EP stab: each note is a two-operator tine (a bell-like bark that decays into a soft sine) with a quiet detuned twin, strummed 7 ms apart */
	[
		[48, 52, 55, 59],
		[45, 48, 52, 55],
		[41, 45, 48, 52],
		[43, 47, 50, 53],
	].forEach((ch, c) => {
		const nt = ch.map((m, k) => ({ f: mf(m + 12) * 2 * Math.PI, o: Math.floor(k * 0.007 * sr) }));
		hit(
			c * 2,
			0.25,
			(t, i) => {
				let y = 0;
				for (const q of nt) {
					if (i < q.o) {
						continue;
					}
					const u = t - q.o / sr,
						e = Math.exp(-u * 7),
						ix = 1.5 * Math.exp(-u * 16) + 0.2 * e,
						ph = q.f * u;
					y +=
						(Math.sin(ph + ix * Math.sin(ph)) * 0.8 +
							0.2 * Math.sin(ph * 1.004 + ix * Math.sin(ph * 1.004))) *
							e *
							(1 - Math.exp(-u * 160)) +
						0.08 * Math.sin(ph * 7.02) * Math.exp(-u * 45);
				}
				return y;
			},
			0.15,
		);
	});
	/* kick: a pitch drop from 160 to 46 Hz through a soft clip, with a short click */
	{
		let ph = 0;
		hit(
			1,
			0.25,
			(t) => {
				ph += (2 * Math.PI * (46 + 114 * Math.exp(-t / 0.03))) / sr;
				return (
					Math.tanh(1.8 * Math.sin(ph)) * Math.exp(-t * 13) * (1 - Math.exp(-t * 500)) +
					(rnd() * 2 - 1) * Math.exp(-t * 900) * 0.25
				);
			},
			0.22,
		);
	}
	/* snare: two body tones and noise, band-passed by two one-pole filters */
	{
		let l1 = 0,
			l2 = 0;
		hit(
			3,
			0.25,
			(t) => {
				const w = rnd() * 2 - 1;
				l1 += 0.5 * (w - l1);
				l2 += 0.05 * (w - l2);
				return (
					(l1 - l2) * Math.exp(-t * 24) * 0.9 +
					(Math.sin(2 * Math.PI * 185 * t) * 0.6 + Math.sin(2 * Math.PI * 340 * t) * 0.3) *
						Math.exp(-t * 38) *
						(1 - Math.exp(-t * 600))
				);
			},
			0.16,
		);
	}
	/* hats: six square oscillators plus noise, high-passed by a one-pole */
	{
		const fr = [205.3, 304.4, 369.6, 522.7, 540, 800];
		const hat = (s, k) => {
			let lp = 0;
			hit(
				s,
				0.25,
				(t) => {
					let m = 0;
					for (const f of fr) {
						m += (t * f * 3.7) % 1 < 0.5 ? 1 : -1;
					}
					const w = (m / 6) * 0.5 + (rnd() * 2 - 1) * 0.7;
					lp += 0.45 * (w - lp);
					return (w - lp) * Math.exp(-t * k) * (1 - Math.exp(-t * 900));
				},
				s === 5 ? 0.1 : 0.1,
			);
		};
		hat(5, 60);
		hat(7, 13);
	}
	/* vinyl: a faint surface hiss and about 15 pops a second, mostly tiny, a few loud */
	let h = 0;
	for (let i = 64; i < n - 64; i++) {
		h += 0.35 * (rnd() * 2 - 1 - h);
		d[i] += h * 0.012;
	}
	for (let k = 0; k < 30; k++) {
		const p = 64 + Math.floor(rnd() * (n - 160)),
			a = 0.015 * Math.pow(6, rnd()),
			tau = 3 + rnd() * 5,
			sg = rnd() < 0.5 ? 1 : -1;
		for (let j = 0; j < 48; j++) {
			d[p + j] += (j < 2 ? sg : rnd() * 2 - 1) * a * Math.exp(-j / tau);
		}
	}
	setSample(d, sr);
}

function setSample(d, rate) {
	let mx = 0;
	for (let i = 0; i < d.length; i++) {
		if (!isFinite(d[i])) {
			d[i] = 0;
		}
		mx = Math.max(mx, Math.abs(d[i]));
	} /* NaN guard: a bad value from a capture becomes silence */
	if (mx > 1e-4) {
		const g = Math.min(0.9 / mx, 30);
		for (let i = 0; i < d.length; i++) {
			d[i] *= g;
		}
	} /* normalise to 0.9, but never lift a near-silent capture by more than 30 dB */
	const e = Math.min(48, d.length >> 1);
	for (let i = 0; i < e; i++) {
		const w = i / e;
		d[i] *= w;
		d[d.length - 1 - i] *= w;
	} /* 2 ms fade at both ends: a capture cut mid-wave can't click when it loops or slices */
	for (let i = 0; i < d.length; i++) {
		d[i] = SMP_ULAW ? ulawQ(d[i]) : Math.round(d[i] * 127) / 127;
	}
	S.smpData = d;
	S.smpRate = rate;
	const B = 114,
		pk = new Float32Array(B),
		per = d.length / B;
	for (let b = 0; b < B; b++) {
		let m = 0;
		for (let i = Math.floor(b * per); i < Math.floor((b + 1) * per); i++) {
			m = Math.max(m, Math.abs(d[i]));
		}
		pk[b] = Math.pow(m, 0.7);
	}
	S.peaks = pk;
	A.smpBuf = null;
	smpPrep();
}

function smpPeak(u) {
	if (!S.smpData) {
		genLoop();
	}
	return S.peaks[Math.min(S.peaks.length - 1, Math.floor(u * S.peaks.length))];
}

/* the playback buffers (forward and reversed) are made at the context's own rate (44.1 or 48 kHz, whatever the phone runs), so playback never relies on a browser's own 22,050 Hz conversion. Built in the background right after a sample is set; a voice that arrives first builds them on the spot. */
const smpFs = () => AC.sampleRate * (AC.sampleRate <= 48000 ? 2 : 1);

function smpFit(f) {
	const b = AC.createBuffer(1, f.length, smpFs());
	b.copyToChannel(f, 0);
	const r = AC.createBuffer(1, f.length, smpFs()),
		rd = r.getChannelData(0);
	for (let i = 0; i < f.length; i++) {
		rd[i] = f[f.length - 1 - i];
	}
	A.smpBuf = b;
	A.smpRev = r;
}

function smpPrep() {
	if (!AC || !S.smpData) {
		return;
	}
	const d = S.smpData,
		tok = (A.smpTok = (A.smpTok || 0) + 1);
	smpResample(d, S.smpRate, smpFs(), (f) => {
		if (tok === A.smpTok && S.smpData === d && !A.smpBuf) {
			smpFit(f);
		}
	});
}

function ensureBuf() {
	if (!S.smpData) {
		genLoop();
	}
	if (!A.smpBuf) {
		A.smpTok = (A.smpTok || 0) + 1;
		smpFit(smpResample(S.smpData, S.smpRate, smpFs()));
	}
}
