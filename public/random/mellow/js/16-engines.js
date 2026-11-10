// the other engines: analog, wavetable, sampler and drum voices, note voices
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---------- other engines ----------
const hold = (p, t, target, tc) => {
	if (p.cancelAndHoldAtTime) {
		p.cancelAndHoldAtTime(t);
	} else {
		p.cancelScheduledValues(t);
		p.setValueAtTime(p.value, t);
	}
	p.setTargetAtTime(target, t, tc);
};

/* Pitch bend reaches the oscillator and sampler voices through a ConstantSource wired into every voice's detune. A detune with an input is an audio-rate parameter, so Chrome recomputed 2^(cents/1200) for every oscillator on every sample even when the bend was 0. The wire is now only connected while the bend is away from 0 (and to voices started during it); at rest the detune is a plain value. */
function bendHook(p, trk) {
	const c = A.bendCs[trk];
	if (!c || !p) {
		return;
	}
	A.bdS[trk].add(p);
	if (A.bendOn[trk] || A.bndC[trk] !== 0) {
		try {
			c.connect(p);
		} catch (e) {
			/* nothing to do */
		}
	}
}

function bendFree(p, trk) {
	A.bdS[trk].delete(p);
	try {
		A.bendCs[trk] && A.bendCs[trk].disconnect(p);
	} catch (e) {
		/* nothing to do */
	}
}

function bendSync(trk) {
	const c = A.bendCs[trk];
	if (!c) {
		return;
	}
	clearTimeout(A.bendT[trk]);
	if (A.bndC[trk] !== 0) {
		if (!A.bendOn[trk]) {
			A.bendOn[trk] = true;
			A.bdS[trk].forEach((p) => {
				try {
					c.connect(p);
				} catch (e) {
					/* nothing to do */
				}
			});
		}
	} else if (A.bendOn[trk]) {
		A.bendT[trk] = setTimeout(() => {
			if (A.bndC[trk] === 0) {
				A.bendOn[trk] = false;
				A.bdS[trk].forEach((p) => {
					try {
						c.disconnect(p);
					} catch (e) {
						/* nothing to do */
					}
				});
			}
		}, 500);
	}
}

function mkv(oscs, nodes, trk) {
	const v = { dead: false, done: false, born: AC.currentTime };
	v.steal = v.cut = () => {
		if (v.stolen) {
			return;
		}
		v.stolen = true;
		if (v.kill) {
			v.kill(AC.currentTime);
		} else {
			v.done = true;
			v.stopAt(AC.currentTime + 0.04);
		}
	}; /* steal / cut (keyboard voice cap, STOP): a quick fade-out */
	v.stopAt = (tEnd) => {
		oscs.forEach((o) => {
			try {
				o.stop(tEnd);
			} catch (e) {
				/* nothing to do */
			}
		});
		if (v.bc) {
			try {
				v.bc.stop(tEnd);
			} catch (e) {
				/* nothing to do */
			}
		}
		setTimeout(
			() => {
				nodes.forEach((n) => {
					try {
						n.disconnect();
					} catch (e) {
						/* nothing to do */
					}
				});
				oscs.forEach((o) => bendFree(o.detune, trk));
				v.dead = true;
			},
			Math.max(0, (tEnd - AC.currentTime) * 1000) + 250,
		);
	};
	v.bend = (semi, t0, dur) => {
		if (v.dead || v.killed) {
			return;
		}
		let c = v.bc;
		if (!c) {
			c = v.bc = AC.createConstantSource();
			c.offset.value = 0;
			oscs.forEach((o) => {
				try {
					c.connect(o.detune);
				} catch (e) {
					/* nothing to do */
				}
			});
			nodes.push(c);
			c.start(AC.currentTime);
		} /* a queued step's pitch bend: a ConstantSource of its own wired into this voice's oscillators' detune (cents), ramped from 0 to `semi` semitones; made only for a bent step */
		const p = c.offset,
			a = Math.max(t0 || 0, AC.currentTime);
		p.cancelScheduledValues(a);
		p.setValueAtTime(0, a);
		p.linearRampToValueAtTime(semi * 100, a + Math.max(0.02, dur));
	};
	return v;
}

/* Analog and wavetable voices (Mellow extras, cheap per-sample maths, CPU unverified on the FM-1). Safety, all on the track's own bus: every voice of a track and engine feeds ONE soft limiter (engBus: linear to 0.8, then a smooth knee that can never pass 0.99, so any number of voices, a resonant filter or a hard drive cannot clip); at most ENGCAP voices (held plus releasing) live per track, and the oldest releasing (else same note, else oldest) is faded out in about 40 ms to make room; every parameter is checked finite before it reaches an AudioParam (a bad save used to throw and drop the note). */
const fin = (v, d) => (Number.isFinite(v) ? v : d),
	ENGCAP = 10;

/* Polyphony headroom: oscillator voices go through one bus per track whose gain follows the number of sounding voices (1 for up to 2, then 1/sqrt(n/2)), so a big chord or a mashed keyboard sums to a bounded level; the bus feeds the track's soft limiter (engBus). */
function vbus(trk) {
	const B = A.vbus || (A.vbus = []);
	if (!B[trk]) {
		const g = AC.createGain();
		g.connect(engBus(trk));
		B[trk] = g;
	}
	return B[trk];
}

function vbusSync(trk) {
	const B = A.vbus;
	if (!B || !B[trk]) {
		return;
	}
	let n = 0;
	(A.vox[trk] || []).forEach((v) => {
		if (!v.dead && !v.stolen) {
			n += v.done ? 0.25 : 1;
		}
	});
	B[trk].gain.setTargetAtTime(1 / Math.sqrt(Math.max(1, n / 2)), AC.currentTime, 0.04);
}

function engBus(trk) {
	const b = A.eb || (A.eb = []);
	if (b[trk]) {
		return b[trk];
	}
	const g = AC.createGain(),
		s = AC.createWaveShaper(),
		n = 2049,
		c = new Float32Array(n);
	g.gain.value = 0.25; // the shaper sees +-1, so +-4 of voice sum is scaled into it
	for (let i = 0; i < n; i++) {
		const x = ((i / (n - 1)) * 2 - 1) * 4,
			ax = Math.abs(x),
			y = ax <= 0.8 ? ax : 0.8 + 0.19 * Math.tanh((ax - 0.8) / 0.19);
		c[i] = x < 0 ? -y : y;
	}
	s.curve = c;
	g.connect(s);
	s.connect(A.tr[trk]);
	return (b[trk] = g);
}

function capVoices(trk, m, t0) {
	const R = A.vc || (A.vc = [[], [], [], []]),
		now = AC.currentTime,
		L = (R[trk] = R[trk].filter((x) => !x.v.dead && !(x.v.endT && x.v.endT < now - 0.3)));
	while (L.length >= ENGCAP) {
		let i = L.findIndex((x) => x.v.done);
		if (i < 0) {
			i = L.findIndex((x) => x.m === m);
		}
		if (i < 0) {
			i = 0;
		}
		const x = L.splice(i, 1)[0];
		if (x.v.kill) {
			x.v.kill(t0);
		}
	}
	return L;
}

/* DRIFT: the macro spreads each oscillator's pitch a little at note start (static, +-15 cents at most) and now also lets it wander slowly (a random walk over 26 s, a point every 2 s, +-9 cents at most). */
function wander(p, d0, dr, t0) {
	if (dr < 1) {
		return;
	}
	try {
		const n = 14,
			c = new Float32Array(n);
		c[0] = d0;
		for (let i = 1; i < n; i++) {
			c[i] = d0 + (Math.random() - 0.5) * dr * 0.6;
		}
		p.setValueCurveAtTime(c, t0, 26);
	} catch (e) {
		/* nothing to do */
	}
}

function anaVoice(trk, m, vel, t0) {
	m = fin(m, 60);
	vel = clamp(fin(vel, 1), 0, 1);
	t0 = fin(t0, AC.currentTime);
	const a = TK(trk).ana,
		f = mf(m),
		nodes = [],
		oscs = [],
		types = ["sawtooth", "square", "triangle", "sine"],
		lv = [1, 0.6, 0.87, 0.72],
		dr = (fin(TK(trk).mac[3], 0) / 127) * 30; // lv: level per wave, matched to the saw by RMS
	const w1 = clamp(Math.round(fin(a.w1, 0)), 0, 3),
		w2 = clamp(Math.round(fin(a.w2, 0)), 0, 3),
		cut = clamp(fin(a.cut, 78), 0, 127),
		res = clamp(fin(a.res, 0), 0, 99),
		det = clamp(fin(a.det, 0), 0, 99),
		atk = clamp(fin(a.atk, 0), 0, 99),
		rl = clamp(fin(a.rel, 0), 0, 99);
	const L = capVoices(trk, m, t0);
	const mk = (type, fr, det0, wd) => {
		const o = AC.createOscillator(),
			d0 = det0 + tuneC() + (Math.random() - 0.5) * dr;
		o.type = type;
		o.frequency.value = fr;
		o.detune.value = d0;
		if (wd) {
			wander(o.detune, d0, dr, t0);
		}
		bendHook(o.detune, trk);
		oscs.push(o);
		nodes.push(o);
		return o;
	};
	const o1 = mk(types[w1], f, -det / 2, 1),
		o2 = mk(types[w2], f, det / 2, 1),
		o3 = mk("sine", f / 2, 0, 0);
	const fmax = Math.min(20000, AC.sampleRate * 0.45),
		fcB = 20 * Math.pow(1000, cut / 127) * Math.pow(2, (vel - 1) * 1.5); // velocity opens the filter a little (nothing at full velocity)
	const fc = Math.min(
		fmax,
		Math.max(fcB * Math.pow(Math.max(1, f / 262), 0.5), Math.min(1.5 * f, fmax)),
	); // the cutoff follows notes above C4 by half, and never sits under 1.5x the pitch: a closed filter used to swallow high notes (-50 dB)
	const flt = AC.createBiquadFilter(),
		fs = Math.min(fc, Math.max(fc * 0.5, f * 2));
	flt.type = "lowpass";
	flt.frequency.value = fc;
	flt.Q.value = 0.7 + (res / 99) * 10;
	const B = 0.4 * lv[w1] * Math.pow(10, ((-Math.max(0, res - 25) / 74) * 3.2) / 20); // resonance above 25 adds up to +3.7 dB of peak: taken back
	const g = AC.createGain();
	g.gain.value = 0;
	o1.connect(flt);
	[
		[o2, lv[w2] / lv[w1]],
		[o3, 0.3 / (0.4 * lv[w1])],
	].forEach(([o, l]) => {
		if (Math.abs(l - 1) < 0.001) {
			o.connect(flt);
		} else {
			const x = AC.createGain();
			x.gain.value = l;
			o.connect(x);
			x.connect(flt);
			nodes.push(x);
		}
	}); // two oscillators of one level go straight into the filter: one gain node less than before
	const r = AC.createGain();
	flt.connect(g);
	g.connect(r);
	r.connect(vbus(trk));
	nodes.push(flt, g, r);
	const at = 0.006 + (atk / 99) * 1.6;
	g.gain.setValueAtTime(0, t0);
	g.gain.linearRampToValueAtTime(vel * 0.5 * B, t0 + at);
	g.gain.setTargetAtTime(vel * 0.38 * B, t0 + at, 0.4);
	if (at > 0.15) {
		flt.frequency.setValueAtTime(fs, t0);
		flt.frequency.exponentialRampToValueAtTime(fc, t0 + at);
	}
	oscs.forEach((o) => o.start(t0));
	const v = mkv(oscs, nodes, trk),
		rel = 0.08 + (rl / 99) * 2.4;
	v.off = (t) => {
		if (v.done) {
			return;
		}
		v.done = true;
		const tt = Math.max(t, AC.currentTime);
		r.gain.setTargetAtTime(0, tt, rel / 3);
		r.gain.setTargetAtTime(0, tt + rel * 2, 0.015);
		if (at > 0.15) {
			hold(flt.frequency, t, fs, rel / 2);
		}
		v.endT = tt + rel * 2 + 0.1;
		v.stopAt(v.endT);
	}; // the second target closes the last -52 dB so the stop is silent
	v.kill = (t) => {
		if (v.killed) {
			return;
		}
		v.killed = true;
		v.done = true;
		const tt = Math.max(t, AC.currentTime);
		r.gain.setTargetAtTime(0, tt, 0.008);
		v.endT = tt + 0.1;
		v.stopAt(v.endT);
	};
	L.push({ v, m });
	return v;
}

/* Wavetable. Bank 0 (CHOIR) is the original formula. Banks 1-5 are 8 frames x 32 harmonics of 8-bit amplitudes (all sine phase) that POSITION morphs through smoothly: 256 bytes a bank, 1,280 bytes for the five (constant tables in flash on the device; here the recipes below write them once at first use). WARP bends the waveform's phase, DRIVE is a tanh waveshaper on one 256-sample cycle, then the cycle is read back as 32 harmonics (about 25,000 multiply-adds, only when a setting changed) and scaled to a fixed RMS, so every bank, position and warp plays at the same loudness. */
const WTN = ["CHOIR", "VOWEL", "REED", "GLASS", "ORGAN", "SYNC"],
	WRMS = 0.79;

let WTB = null;

function wtBanks() {
	if (WTB) {
		return WTB;
	}
	const H = 32,
		F = 8,
		mk = (fn) => {
			const t = new Uint8Array(H * F);
			for (let f = 0; f < F; f++) {
				const a = new Float64Array(H + 1);
				fn(f, a);
				let mx = 1e-9;
				for (let h = 1; h <= H; h++) {
					mx = Math.max(mx, a[h]);
				}
				for (let h = 1; h <= H; h++) {
					t[f * H + h - 1] = Math.round(255 * Math.sqrt(Math.max(0, a[h]) / mx));
				}
			}
			return t;
		};
	const VW = [
			[730, 1090, 2440],
			[530, 1840, 2480],
			[270, 2290, 3010],
			[570, 840, 2410],
			[300, 870, 2240],
			[660, 1720, 2410],
			[490, 1350, 1690],
			[800, 1150, 2800],
		],
		PD = [0, 0.5, 0.4, 0.3, 0.2, 0, 0, 0.1];
	const sets = [
		[
			[1, 1],
			[2, 0.5],
			[3, 0.25],
		],
		[
			[1, 1],
			[3, 0.6],
			[4, 0.5],
			[5, 0.4],
		],
		[
			[1, 0.7],
			[4, 1],
			[5, 0.8],
			[6, 0.3],
		],
		[
			[2, 0.6],
			[3, 0.5],
			[5, 1],
			[7, 0.5],
		],
		[
			[1, 0.4],
			[5, 0.9],
			[6, 0.7],
			[8, 0.6],
			[9, 0.5],
		],
		[
			[3, 1],
			[7, 0.8],
			[8, 0.6],
			[11, 0.5],
			[13, 0.4],
		],
		[
			[4, 1],
			[7, 0.8],
			[9, 0.7],
			[11, 0.6],
			[13, 0.5],
			[17, 0.4],
			[19, 0.3],
		],
	];
	const og = [
		[[1, 1]],
		[
			[1, 1],
			[2, 0.7],
		],
		[
			[1, 1],
			[2, 0.6],
			[4, 0.5],
		],
		[
			[1, 1],
			[2, 0.8],
			[3, 0.7],
			[4, 0.6],
			[5, 0.4],
			[6, 0.4],
			[8, 0.3],
		],
		[
			[1, 1],
			[2, 0.2],
			[3, 0.9],
			[4, 0.1],
		],
		[
			[1, 0.6],
			[2, 0.5],
			[4, 0.9],
			[8, 0.8],
			[16, 0.6],
			[12, 0.4],
			[6, 0.5],
		],
	];
	let sd = 12345;
	const rnd = () => (sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296;
	const T = new Float64Array(2048),
		C = new Float64Array(2048);
	for (let i = 0; i < 2048; i++) {
		T[i] = Math.sin((2 * Math.PI * i) / 2048);
		C[i] = Math.cos((2 * Math.PI * i) / 2048);
	}
	return (WTB = [
		mk((f, a) => {
			for (let h = 1; h <= H; h++) {
				let s = 0;
				VW[f].forEach((F0, k) => {
					const d = h * 130 - F0;
					s += [1, 0.7, 0.4][k] / (1 + (d * d) / Math.pow(60 + F0 * 0.05, 2));
				});
				a[h] = s / h;
			}
		}), // VOWEL: three formants (A E I O U and between), the fundamental fixed at 130 Hz so the formants sit on harmonic numbers
		mk((f, a) => {
			for (let h = 1; h <= H; h++) {
				a[h] =
					f === 0
						? h % 2
							? 1 / (h * h)
							: 0
						: f === 1
							? h % 2
								? 1 / h
								: 0
							: f === 5
								? 1 / h
								: f === 6
									? (1 / h) * (1 + 4 * Math.exp(-Math.pow((h - 7) / 2.5, 2)))
									: Math.abs(Math.sin(Math.PI * h * PD[f])) / h;
			}
		}), // REED: triangle, square, pulses 40-10%, saw, oboe
		mk((f, a) => {
			if (f < 7) {
				sets[f].forEach(([h, x]) => (a[h] = x));
			} else {
				for (let h = 5; h <= 16; h++) {
					a[h] = 0.3 + rnd() * 0.7;
				}
			}
		}), // GLASS: a few partials, moving up
		mk((f, a) => {
			if (f < 6) {
				og[f].forEach(([h, x]) => (a[h] = x));
			} else if (f === 6) {
				for (let h = 1; h <= 12; h++) {
					a[h] = 1 / h;
				}
			} else {
				[1, 3, 5, 7, 9].forEach((h) => (a[h] = 1 / Math.pow(h, 0.8)));
			}
		}), // ORGAN: drawbar registrations
		mk((f, a) => {
			const r = [1, 1.5, 2, 2.5, 3, 3.7, 4.6, 5.5][f],
				N = 2048,
				x = new Float64Array(N);
			for (let n = 0; n < N; n++) {
				const u = (r * n) / N;
				x[n] = 2 * (u - Math.floor(u)) - 1;
			}
			for (let h = 1; h <= H; h++) {
				let c = 0,
					s = 0;
				for (let n = 0; n < N; n++) {
					c += x[n] * C[(h * n) & 2047];
					s += x[n] * T[(h * n) & 2047];
				}
				a[h] = Math.hypot(c, s) / N;
			}
		}),
	]); // SYNC: a saw hard-synced to a faster one, ratio 1 to 5.5
}

function wtAmps(tab, pos, tone) {
	const B = wtBanks()[tab - 1],
		p = (clamp(pos, 0, 127) / 127) * 7,
		i = Math.min(6, Math.floor(p)),
		fr = p - i,
		a = new Float64Array(33);
	for (let h = 1; h <= 32; h++) {
		const u0 = B[i * 32 + h - 1] / 255,
			u1 = B[(i + 1) * 32 + h - 1] / 255;
		a[h] = (u0 * u0 * (1 - fr) + u1 * u1 * fr) * Math.exp(-h / (6 + tone / 10));
	}
	return a;
}

let WTC = null;

function wtWave(w) {
	const tab = clamp(Math.round(fin(w.tab, 0)), 0, WTN.length - 1),
		pos = clamp(fin(w.pos, 52), 0, 127),
		warp = clamp(fin(w.warp, 0), 0, 99),
		drv = clamp(fin(w.drv, 0), 0, 99),
		tone = clamp(fin(w.tone, 64), 0, 99);
	if (!tab) {
		const k = Math.round((pos / 127) * 13) / 13,
			n = 32,
			re = new Float32Array(n),
			im = new Float32Array(n); // the original formula
		for (let h = 1; h < n; h++) {
			let a = h === 1 ? 1 : 1 / h;
			if (h % 2 === 0) {
				a *= (warp / 99) * 1.2;
			} else if (h > 2) {
				a *= k * (1 + drv / 40);
			}
			a *= Math.exp(-h / (6 + tone / 10));
			im[h] = a;
		}
		return AC.createPeriodicWave(re, im);
	}
	const a = wtAmps(tab, pos, tone),
		re = new Float32Array(33),
		im = new Float32Array(33);
	if (!WTC) {
		WTC = new Float64Array(256);
		for (let i = 0; i < 256; i++) {
			WTC[i] = (2 * Math.PI * i) / 256;
		}
	}
	if (warp > 0 || drv > 0) {
		const N = 256,
			x = new Float64Array(N),
			mw = (warp / 99) * 0.9;
		let pk = 1e-9;
		for (let n = 0; n < N; n++) {
			const p0 = WTC[n],
				ph = p0 + mw * Math.sin(p0);
			let s = 0;
			for (let h = 1; h <= 32; h++) {
				if (a[h] > 1e-3) {
					s += a[h] * Math.sin(h * ph);
				}
			}
			x[n] = s;
			if (Math.abs(s) > pk) {
				pk = Math.abs(s);
			}
		}
		if (drv > 0) {
			const g = 1 + (drv / 99) * 5,
				tg = Math.tanh(g);
			for (let n = 0; n < N; n++) {
				x[n] = Math.tanh((g * x[n]) / pk) / tg;
			}
		}
		for (let h = 1; h <= 32; h++) {
			let c = 0,
				s = 0;
			for (let n = 0; n < N; n++) {
				const k = (h * n) & 255,
					ph = WTC[k];
				c += x[n] * Math.cos(ph);
				s += x[n] * Math.sin(ph);
			}
			re[h] = (2 * c) / N;
			im[h] = (2 * s) / N;
		}
	} else {
		for (let h = 1; h <= 32; h++) {
			im[h] = a[h];
		}
	}
	let e = 0;
	for (let h = 1; h <= 32; h++) {
		e += re[h] * re[h] + im[h] * im[h];
	}
	const sc = e > 1e-12 ? WRMS / Math.sqrt(e / 2) : 1;
	for (let h = 1; h <= 32; h++) {
		re[h] = fin(re[h] * sc, 0);
		im[h] = fin(im[h] * sc, 0);
	}
	try {
		return AC.createPeriodicWave(re, im, { disableNormalization: true });
	} catch (e2) {
		return AC.createPeriodicWave(re, im);
	}
}

/* waves are kept per track in a small cache (12 settings), so a note on never rebuilds a wave it has played before */
function wtGet(trk, w) {
	const M = A.wtm || (A.wtm = [new Map(), new Map(), new Map(), new Map()]),
		key = (w.tab | 0) + "|" + w.pos + "|" + w.warp + "|" + w.drv + "|" + w.tone,
		c = M[trk];
	let x = c.get(key);
	if (!x) {
		x = wtWave(w);
		c.set(key, x);
		if (c.size > 12) {
			c.delete(c.keys().next().value);
		}
	}
	return x;
}

function wtVoice(trk, m, vel, t0) {
	m = fin(m, 60);
	vel = clamp(fin(vel, 1), 0, 1);
	t0 = fin(t0, AC.currentTime);
	const w = TK(trk).wt,
		f = mf(m),
		dr = (fin(TK(trk).mac[3], 0) / 127) * 30,
		tone = clamp(fin(w.tone, 64), 0, 99),
		L = capVoices(trk, m, t0),
		pw = wtGet(trk, w);
	const nodes = [],
		oscs = [],
		fmax = Math.min(20000, AC.sampleRate * 0.45),
		flt = AC.createBiquadFilter();
	flt.type = "lowpass";
	flt.frequency.value = Math.min(
		fmax,
		Math.max(
			600 * Math.pow(20, tone / 99) * Math.pow(Math.max(1, f / 262), 0.5),
			Math.min(1.6 * f, fmax),
		),
	);
	flt.Q.value = 0.8; // tone follows high notes by half and never closes on the fundamental
	const g = AC.createGain();
	g.gain.value = 0;
	[-7, 7].forEach((d) => {
		const o = AC.createOscillator(),
			d0 = d + tuneC() + (Math.random() - 0.5) * dr;
		o.setPeriodicWave(pw);
		o.frequency.value = f;
		o.detune.value = d0;
		wander(o.detune, d0, dr, t0);
		bendHook(o.detune, trk);
		o.connect(flt);
		oscs.push(o);
		nodes.push(o);
	});
	const r = AC.createGain();
	flt.connect(g);
	g.connect(r);
	r.connect(vbus(trk));
	nodes.push(flt, g, r);
	g.gain.setValueAtTime(0, t0);
	g.gain.linearRampToValueAtTime(vel * 0.13, t0 + 0.12);
	oscs.forEach((o) => o.start(t0));
	const v = mkv(oscs, nodes, trk);
	v.off = (t) => {
		if (v.done) {
			return;
		}
		v.done = true;
		const tt = Math.max(t, AC.currentTime);
		r.gain.setTargetAtTime(0, tt, 0.4);
		r.gain.setTargetAtTime(0, tt + 2, 0.03);
		v.endT = tt + 2.4;
		v.stopAt(v.endT);
	};
	v.kill = (t) => {
		if (v.killed) {
			return;
		}
		v.killed = true;
		v.done = true;
		const tt = Math.max(t, AC.currentTime);
		r.gain.setTargetAtTime(0, tt, 0.008);
		v.endT = tt + 0.1;
		v.stopAt(v.endT);
	};
	L.push({ v, m });
	return v;
}

/* Sampler voice. One voice per track: a new trigger fades the one still sounding over 8 ms (linear, from its own choke gain, so the envelope underneath is never edited mid-ramp), Each voice is source -> envelope gain -> choke gain -> the track's soft bus (hard ceiling 1.0), so any number of triggers cannot push the track above full scale. The envelope is a 4 ms attack and an 8 ms release scaled down on very short slices (high pitch), so a slice never ends on a step. The slice is played with start(when, offset) and stopped at its end instead of start(when, offset, duration), which older iOS Safari mishandles when the rate isn't 1; the rate is kept in 0.05-8. Nodes are disconnected the moment the source ends. */
function sampVoice(trk, slice, m, vel, t0) {
	ensureBuf();
	const s = TK(trk).smp,
		rev = s.dir === 1 || (s.dir === 2 && (A.ping = !A.ping)),
		buf = rev ? A.smpRev : A.smpBuf,
		sl = buf.duration / 8,
		sli = clamp(Math.round(isFinite(slice) ? slice : 0), 0, 7),
		si = rev ? 7 - sli : sli,
		st = clamp(isFinite(s.st) ? s.st : 0, 0, 99),
		off = si * sl + (st / 99) * sl * 0.8,
		dur = sl * (1 - (st / 99) * 0.8);
	if (!isFinite(t0)) {
		t0 = AC.currentTime;
	}
	const L = A.sv || (A.sv = [[], [], [], []]),
		V = L[trk];
	for (let i = V.length - 1; i >= 0; i--) {
		if (V[i].end < t0 - 0.5) {
			V.splice(i, 1);
		}
	}
	const src = AC.createBufferSource(),
		g = AC.createGain(),
		c = AC.createGain(),
		rate = clamp(
			Math.pow(
				2,
				((isFinite(m) ? m : 60) - 60) / 12 +
					(isFinite(s.pitch) ? s.pitch : 0) / 12 +
					tuneC() / 1200,
			) || 1,
			0.05,
			8,
		),
		tl = dur / rate,
		tEnd = t0 + tl,
		vv = clamp(+vel || 0, 0, 1),
		lvl = 0.8 * vv,
		at = Math.min(0.004, tl * 0.25),
		rl = Math.min(0.008, tl * 0.25);
	src.buffer = buf;
	src.playbackRate.value = rate;
	if (A.bendCs[trk] && src.detune) {
		bendHook(src.detune, trk);
		src.addEventListener("ended", () => bendFree(src.detune, trk));
	}
	g.gain.setValueAtTime(0, t0);
	g.gain.linearRampToValueAtTime(lvl, t0 + at);
	g.gain.setValueAtTime(lvl, tEnd - rl);
	g.gain.linearRampToValueAtTime(0, tEnd);
	src.connect(g);
	g.connect(c);
	c.connect(softBus("sbus", trk));
	src.start(t0, off);
	src.stop(tEnd + 0.005);
	const v = {
		dead: false,
		done: false,
		t: t0,
		end: tEnd,
		chopped: false,
		c,
		cutAt(tc, ft) {
			if (v.chopped || tc >= v.end) {
				return;
			}
			v.chopped = true;
			c.gain.setValueAtTime(1, tc);
			c.gain.linearRampToValueAtTime(0, tc + ft);
		},
	};
	v.cut = v.steal = () => {
		v.off(AC.currentTime);
	}; /* STOP / keyboard voice cap: let go now */
	v.off = (t) => {
		if (v.done) {
			return;
		}
		v.done = true;
		const tc = Math.max(t, AC.currentTime);
		if (!v.chopped) {
			v.chopped = true;
			c.gain.setValueAtTime(1, tc);
			c.gain.setTargetAtTime(0, tc, 0.012);
		}
	};
	/* steal: anything on this track that started earlier and is still sounding at t0 is faded out (this works for triggers that arrive out of time order too) */
	V.forEach((o) => {
		if (o.t < t0 - 0.001 && o.end > t0) {
			o.cutAt(t0, 0.008);
		}
	});
	V.push(v);
	if (V.length > 12) {
		V.shift();
	}
	src.onended = () => {
		v.done = true;
		v.dead = true;
		[src, g, c].forEach((n) => {
			try {
				n.disconnect();
			} catch (e) {
				/* nothing to do */
			}
		});
		const k = V.indexOf(v);
		if (k >= 0) {
			V.splice(k, 1);
		}
	};
	A.smpLast[trk] = v;
	return v;
}

/* Drums. Every pad is cheap per-sample maths that a 360 MHz MCU can run: sine oscillators with an exponential pitch drop, noise (one LFSR / white buffer) through one or two biquads, one-pole exponential envelopes, and for the hats six squares plus noise (a 0.5 s loop with a whole number of cycles per square, so it has no seam; on the device six phase counters and an LFSR). A hit is at most 2 oscillators, 3 biquads and a handful of multiplies per sample, and a pad is monophonic (a new hit of the same pad, or a closed HAT on the OPEN hat, fades the old one out in 4-12 ms instead of stacking). CRUSH is a real bit-depth quantiser (11 bits down to 7) in front of the one-pole low-pass; velocity changes level (^1.3), brightness and each pad's click/noise content. A hit is 5-11 Web Audio nodes (the first versions needed 7-16) and no buffer is allocated per hit: the white and metal buffers and the quantiser / saturator curves are built once. */
/* Each engine's output goes through one soft-clip bus per track (linear up to 0.7, tanh knee, hard ceiling 1.0 for any input, even if every pad of a kit is hit at once): a sum of drum hits or sample voices can never reach the master above full scale. On the device it is one table lookup (or a rational function) per sample. */
function softBus(key, trk) {
	const B = A[key] || (A[key] = []);
	if (!B[trk]) {
		const pre = AC.createGain(),
			sh = AC.createWaveShaper(),
			c =
				A.sbc ||
				(A.sbc = (() => {
					const N = 4097,
						c = new Float32Array(N);
					for (let i = 0; i < N; i++) {
						const u = (i / (N - 1)) * 2 - 1,
							x = Math.abs(u) * 4,
							y = x < 0.7 ? x : 0.7 + 0.3 * Math.tanh((x - 0.7) / 0.3);
						c[i] = u < 0 ? -y : y;
					}
					return c;
				})());
		pre.gain.value = 0.25;
		sh.curve = c;
		pre.connect(sh);
		sh.connect(A.tr[trk]);
		B[trk] = pre;
	}
	return B[trk];
}

function drumHit(trk, pad, vel, t) {
	/* hits of one track within 120 ms are bounded: past 16 they are dropped, past 8 they get a little quieter (a drum-grid step with all 8 pads is untouched), so a mashed pad can't pile up nodes or level */
	{
		if (A.dhAC !== AC) {
			A.dhAC = AC;
			A.dh = [[], [], [], []];
		}
		const D = A.dh,
			tn = isFinite(t) ? t : AC.currentTime,
			H = (D[trk] = D[trk].filter((h) => Math.abs(h - tn) < 0.12));
		if (H.length >= 16) {
			return null;
		}
		vel = vel / Math.sqrt(1 + Math.max(0, H.length - 8) * 0.15);
		H.push(tn);
	}
	const D = TK(trk).drum,
		num = (x, d) => (isFinite(x) ? x : d),
		tf = Math.pow(2, (num(D.tune[pad], 50) - 50) / 50),
		dc = clamp(num(D.dec[pad], 40), 0, 99) / 99,
		cr = clamp(num(D.crush[pad], 30), 0, 99) / 99,
		nodes = [],
		vv = clamp(num(+vel, 0), 0, 1),
		v2 = vv * vv;
	let endT;
	if (!isFinite(t)) {
		t = AC.currentTime;
	}
	endT = t + 0.1;
	const dv = A.dv || (A.dv = [[], [], [], []]),
		chk = (p, ft) => {
			const o = dv[trk][p];
			if (o && o.t < t - 0.001) {
				const g = o.g.gain;
				g.setValueAtTime(o.lvl, t);
				g.linearRampToValueAtTime(0, t + ft);
			}
			dv[trk][p] = null;
		};
	chk(pad, pad === 3 ? 0.012 : 0.006);
	if (pad === 2) {
		chk(3, 0.004);
	}
	const KG = [0.8, 0.555, 1.7, 1.25, 0.35, 0.42, 0.45, 0.51],
		PRE = [1, 1.3, 2.2, 2.8, 2.6, 1.5, 3.5, 2],
		POST = [
			1.08,
			1 / 1.3,
			1 / 2.2,
			1 / 2.8,
			1 / 2.6,
			1 / 1.5,
			1 / 3.5,
			1 / 2,
		]; /* pad levels, set so the hits land together (tests/drums.js) */
	/* VOICING: a kit may carry D.vo[pad] = 8 integers 0-15 (4 bytes a pad, 32 bytes a kit) that change the SHAPE of that pad (what each field is: see `voiced` below). A pad with no entry plays the original fixed voice, so old saves and kits sound as they always did. Field 7 of every pad is LEVEL (a trim of -13.5..+9 dB, 1.5 dB a step, 9 = 0 dB, applied after the bit quantiser so it can't change the tone or clip it). nb(i,d) reads a field (d when it is missing), ex(i,b,per) = b * 2^((field-8)/per), so 8 is the original value. */
	const vo = Array.isArray(D.vo) && Array.isArray(D.vo[pad]) ? D.vo[pad] : null,
		nb = (i, d) => {
			const x = vo ? vo[i] : null;
			return x != null && x >= 0 && x <= 15 ? Math.round(x) : d;
		},
		ex = (i, b, per) => Math.min(b * 4, b * Math.pow(2, (nb(i, 8) - 8) / per));
	const out = AC.createGain(),
		lvl = 0.9 * Math.pow(vv, 1.3),
		bits = Math.round(12 - 5.5 * cr);
	out.gain.setValueAtTime(lvl, t);
	dv[trk][pad] = { g: out, t, lvl };
	/* the tail of the chain is built once per track and pad and reused by every hit: gain up to ~0.8, the bit-depth quantiser, the low-pass, gain back down, then the track's soft bus. Only the hit's own gain node (velocity, choke) and its sources are made per hit. */
	const ch = A.dch || (A.dch = [[], [], [], []]);
	let C = ch[trk][pad];
	if (!C) {
		const pre = AC.createGain(),
			q = AC.createWaveShaper(),
			lp = AC.createBiquadFilter(),
			post = AC.createGain();
		pre.gain.value = PRE[pad];
		post.gain.value = POST[pad];
		lp.type = "lowpass";
		lp.Q.value = -3;
		pre.connect(q);
		q.connect(lp);
		lp.connect(post);
		post.connect(softBus("dbus", trk));
		C = ch[trk][pad] = { pre, q, lp, post, bits: -1, fc: -1, tg: 1 };
	}
	{
		const tg = vo ? Math.pow(10, (nb(7, 9) - 9) * 0.075) : 1;
		if (C.tg !== tg) {
			C.tg = tg;
			C.post.gain.value = POST[pad] * tg;
		}
	}
	const bc = cr > 0.04 ? bits : 0,
		fc = Math.round(Math.min(20000, 18000 * Math.pow(0.12, cr)));
	if (C.bits !== bc) {
		C.bits = bc;
		const qc = A.dq || (A.dq = {});
		C.q.curve = bc
			? qc[bc] ||
				(qc[bc] = (() => {
					const N = 8193,
						L = Math.pow(2, bc - 1),
						c = new Float32Array(N);
					for (let i = 0; i < N; i++) {
						c[i] = Math.round(((i / (N - 1)) * 2 - 1) * L) / L;
					}
					return c;
				})())
			: null;
	}
	if (C.fc !== fc) {
		C.fc = fc;
		C.lp.frequency.value = fc;
	}
	out.connect(C.pre);
	nodes.push(out);
	const en = out;
	const fin = (d) => {
		endT = Math.max(endT, t + d);
	};
	/* a decaying sine with an exponential pitch drop; the envelope is a one-pole decay (setTargetAtTime), so it is a single multiply per sample */
	const osc = (type, f0, f1, tc, tau, amp, dest) => {
		const o = AC.createOscillator(),
			g = AC.createGain();
		o.type = type;
		o.frequency.setValueAtTime(f0, t);
		o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + tc);
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(amp, t + 0.0006);
		g.gain.setTargetAtTime(0, t + 0.0006, tau);
		o.connect(g);
		g.connect(dest || en);
		o.start(t);
		o.stop(t + tau * 9 + 0.01);
		fin(tau * 9 + 0.02);
		nodes.push(o, g);
		return o;
	};
	/* one white-noise source per hit, shared by all of its filters; started at t, stopped at the end of the longest envelope */
	let ns = null;
	const src = () => {
		if (!ns) {
			ns = AC.createBufferSource();
			ns.buffer = A.white;
			ns.loop = true;
			nodes.push(ns);
		}
		return ns;
	};
	const noise = (ft, fr, q, e) => {
		const tt = t + (e.dl || 0),
			f = AC.createBiquadFilter(),
			g = AC.createGain(),
			at = e.att || 0.0008;
		f.type = ft;
		f.frequency.value = fr;
		f.Q.value = q;
		g.gain.setValueAtTime(0, tt);
		g.gain.linearRampToValueAtTime(e.amp, tt + at);
		g.gain.setTargetAtTime(0, tt + at, e.tau);
		src().connect(f);
		f.connect(g);
		g.connect(en);
		fin((e.dl || 0) + at + e.tau * 9 + 0.02);
		nodes.push(f, g);
		return g;
	};
	const sat =
		A.dsat ||
		(A.dsat = (() => {
			const N = 2049,
				c = new Float32Array(N);
			for (let i = 0; i < N; i++) {
				const x = (i / (N - 1)) * 2 - 1;
				c[i] = (0.66 * Math.tanh(1.9 * x)) / Math.tanh(1.9);
			}
			return c;
		})());
	/* the hats' metal: six squares at the 808's inharmonic ratios plus white noise, baked once into a 0.5 s loop (seeded, so it is the same every run) */
	const metal = () =>
		A.metal ||
		(A.metal = (() => {
			const n = Math.round(AC.sampleRate * 0.5),
				b = AC.createBuffer(1, n, AC.sampleRate),
				d = b.getChannelData(0);
			let x = 12345;
			[205.3, 304.4, 369.6, 522.7, 540, 800].forEach((f) => {
				const c = Math.round(f * 0.5),
					w = c / n;
				for (let i = 0; i < n; i++) {
					d[i] += ((i * w) % 1 < 0.5 ? 1 : -1) * 0.052;
				}
			});
			for (let i = 0; i < n; i++) {
				x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
				d[i] += (x / 2147483648 - 1) * 0.34;
			}
			return b;
		})());
	const hat = (open) => {
		const m = AC.createBufferSource(),
			hp = AC.createBiquadFilter(),
			g = AC.createGain(),
			tau = open ? 0.022 + dc * 0.12 : 0.006 + dc * 0.05,
			hf = Math.min(12000, (open ? 6200 : 7200) * tf),
			a = KG[pad] * (0.8 + 0.2 * vv);
		m.buffer = metal();
		m.loop = true;
		m.playbackRate.value = Math.pow(tf, 0.5);
		hp.type = "highpass";
		hp.frequency.value = hf;
		hp.Q.value = -1;
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(a, t + 0.0005);
		if (open) {
			g.gain.setTargetAtTime(a * 0.5, t + 0.0005, 0.008);
			g.gain.setTargetAtTime(0, t + 0.035, tau);
		} else {
			g.gain.setTargetAtTime(0, t + 0.0005, tau);
		}
		m.connect(hp);
		hp.connect(g);
		g.connect(en);
		m.start(t, Math.random() * 0.4);
		m.stop(t + tau * 9 + 0.05);
		fin(tau * 9 + 0.06);
		nodes.push(m, hp, g);
	};
	/* the six squares alone (no noise): a voiced hat mixes them with the white noise by a gain, so the square/noise balance is one multiply on the device */
	const metalS = () =>
		A.metalS ||
		(A.metalS = (() => {
			const n = Math.round(AC.sampleRate * 0.5),
				b = AC.createBuffer(1, n, AC.sampleRate),
				d = b.getChannelData(0);
			[205.3, 304.4, 369.6, 522.7, 540, 800].forEach((f) => {
				const c = Math.round(f * 0.5),
					w = c / n;
				for (let i = 0; i < n; i++) {
					d[i] += ((i * w) % 1 < 0.5 ? 1 : -1) * 0.052;
				}
			});
			return b;
		})());
	/* ---- the voiced pads. Fields 0-6 of each pad (7 is LEVEL); every field is 0-15 and 8 is the original voice's value. At most 2 oscillators and 3 biquads a pad (not counting the shared bit-crush low-pass), the same budget as the fixed voices.
    KICK  0 DROP (start/end pitch ratio, 1.05-8.4x)  1 DROP TIME (20-500 ms)  2 BODY (bits 0-1: sine, triangle, square, saw; bit 2: a high sine blip as the click, which takes the 2nd oscillator)  3 DRIVE (saturator, 0.3-9.6)  4 CLICK (level, 0 = none)  5 CLICK COLOUR (500-13000 Hz)  6 SUB (a second sine at the end pitch with a long tail, 0 = none)
    SNARE 0 PITCH  1 TONE (the two drum-head oscillators vs the wires)  2 WIRE COLOUR (noise band)  3 WIRES (noise level)  4 SNAP (the 6 kHz top)  5 HEAD DECAY  6 WIRE DECAY
    HATS (closed 2, open 3)  0 MIX (squares to noise)  1 CUTOFF  2 DECAY  3 RING (a resonant band, 0 = none)  4 METAL PITCH  5 closed: ATTACK BURST / open: SUSTAIN  6 open: ATTACK BURST
    CLAP  0 BURSTS (2-7)  1 SPREAD (gap between bursts)  2 BAND  3 WIDTH (Q)  4 TAIL  5 AIR (the upper band)  6 LOW CUT
    RIM   0 TICK PITCH  1 BODY PITCH  2 TICK LEVEL  3 BODY LEVEL  4 NOISE  5 TICK RING  6 WAVE (sine / triangle / square)
    SHAKER 0 CENTRE  1 Q  2 ATTACK  3 TAIL  4 AIR  5 DOUBLE (a second grain, 0 = none)  6 GRAIN COLOUR
    PERC  0 PITCH  1 DROP  2 PARTIAL RATIO  3 PARTIAL LEVEL  4 NOISE  5 NOISE COLOUR  6 WAVE (sine / triangle / square) */
	const hatV = (open) => {
		const ms = AC.createBufferSource(),
			ws = AC.createBufferSource(),
			gs = AC.createGain(),
			gw = AC.createGain(),
			hp = AC.createBiquadFilter(),
			g = AC.createGain(),
			m = nb(0, 8),
			tau = (open ? 0.022 + dc * 0.12 : 0.006 + dc * 0.05) * ex(2, 1, 3),
			hf = Math.min(12000, (open ? 6200 : 7200) * tf * ex(1, 1, 6)),
			a = KG[pad] * (0.8 + 0.2 * vv),
			bump = 1 + Math.max(0, nb(open ? 6 : 5, 8) - 8) * 0.2,
			ring = nb(3, 0) / 15;
		ms.buffer = metalS();
		ms.loop = true;
		ms.playbackRate.value = Math.pow(tf, 0.5) * ex(4, 1, 10);
		ws.buffer = A.white;
		ws.loop = true;
		gs.gain.value = 1 - Math.max(0, (m - 8) / 7);
		gw.gain.value = 0.34 * Math.min(1, m / 8);
		hp.type = "highpass";
		hp.frequency.value = hf;
		hp.Q.value = -1;
		ms.connect(gs);
		ws.connect(gw);
		gs.connect(hp);
		gw.connect(hp);
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(a * bump, t + 0.0005);
		if (bump > 1) {
			g.gain.setTargetAtTime(a, t + 0.0005, 0.002);
		}
		if (open) {
			const su = Math.min(0.9, 0.5 * Math.pow(2, (nb(5, 8) - 8) / 4));
			g.gain.setTargetAtTime(a * su, t + 0.0005, 0.008);
			g.gain.setTargetAtTime(0, t + 0.035, tau);
		} else {
			g.gain.setTargetAtTime(0, t + (bump > 1 ? 0.008 : 0.0005), tau);
		}
		hp.connect(g);
		nodes.push(ms, ws, gs, gw, hp, g);
		if (ring > 0) {
			const bp = AC.createBiquadFilter(),
				gr = AC.createGain();
			bp.type = "bandpass";
			bp.frequency.value = Math.min(15000, hf * 1.45);
			bp.Q.value = 5;
			gr.gain.value = ring * 1.4;
			hp.connect(bp);
			bp.connect(gr);
			gr.connect(g);
			nodes.push(bp, gr);
		}
		g.connect(en);
		ms.start(t, Math.random() * 0.4);
		ws.start(t, Math.random() * 1.2);
		ms.stop(t + tau * 9 + 0.05);
		ws.stop(t + tau * 9 + 0.05);
		fin(tau * 9 + 0.06);
	};
	const voiced = () => {
		switch (pad) {
			case 0: {
				const bw = nb(2, 0),
					wv = ["sine", "triangle", "square", "sawtooth"][bw & 3],
					blip = bw & 4,
					fe = Math.max(28, 46 * tf),
					R = Math.max(1.05, ex(0, 3.2, 5) * (1 + 0.375 * vv)),
					f0 = Math.min(420, fe * R),
					T2 = (0.12 + dc * 0.05) * ex(1, 1, 3.3),
					T1 = Math.max(0.004, T2 * 0.117),
					tau = 0.034 + dc * 0.07,
					dg = nb(3, 8),
					sh = AC.createWaveShaper(),
					sg = AC.createGain(),
					kc = A.ksat || (A.ksat = {});
				sg.gain.value =
					[1, 1, 0.5, 0.5][bw & 3] /
					(1 +
						Math.max(0, dg - 8) *
							0.04); /* square and saw are louder than a sine, and so is a harder drive: sg takes it back */
				sh.curve =
					kc[dg] ||
					(kc[dg] = (() => {
						const N = 2049,
							g = 1.9 * Math.pow(2, (dg - 8) / 3),
							c = new Float32Array(N);
						for (let i = 0; i < N; i++) {
							const x = (i / (N - 1)) * 2 - 1;
							c[i] = (0.66 * Math.tanh(g * x)) / Math.tanh(g);
						}
						return c;
					})());
				sh.connect(sg);
				sg.connect(en);
				nodes.push(sh, sg);
				let dst = sh;
				if ((bw & 3) > 1) {
					const lp = AC.createBiquadFilter();
					lp.type = "lowpass";
					lp.frequency.value = Math.min(3000, f0 * 2.5);
					lp.Q.value = 0.5;
					lp.connect(sh);
					nodes.push(lp);
					dst = lp;
				}
				const o = osc(wv, f0, fe, 0.12, tau, 1, dst);
				o.frequency.cancelScheduledValues(t);
				o.frequency.setValueAtTime(f0, t);
				o.frequency.exponentialRampToValueAtTime(
					Math.max(fe * 1.01, fe * (1 + (R - 1) * 0.147)),
					t + T1,
				);
				o.frequency.exponentialRampToValueAtTime(fe, t + T2);
				const cl = nb(4, 8),
					cc = Math.pow(2, (nb(5, 8) - 8) / 3.2);
				if (blip) {
					const fb = Math.min(7000, 3000 * cc);
					osc("sine", fb, fb * 0.4, 0.008, 0.004, 0.3 * (cl / 8) * (0.4 + 0.6 * vv), en);
				} else {
					const sa = (nb(6, 0) / 15) * 0.7;
					if (sa > 0) {
						osc("sine", fe * 1.2, fe, 0.05, 0.05 + dc * 0.22, sa, en);
					}
					if (cl > 0) {
						const fc = clamp(3000 * cc, 400, 9000);
						noise("bandpass", fc, 0.7, {
							att: 0.0004,
							tau: Math.min(0.008, 0.0025 * Math.pow(3000 / fc, 0.4)),
							amp: (0.06 + 0.28 * v2) * Math.pow(cl / 8, 2),
						});
					}
				}
				break;
			}
			case 1: {
				const k = KG[1],
					f = 190 * tf * ex(0, 1, 6),
					tn = ex(1, 1, 3),
					hd = ex(5, 1, 3),
					wd = ex(6, 1, 2.5),
					na = ex(3, 1, 3);
				osc("triangle", f * 1.2, f, 0.02, (0.018 + dc * 0.05) * hd, k * 0.5 * tn);
				osc("sine", f * 1.83, f * 1.7, 0.02, (0.012 + dc * 0.03) * hd, k * 0.22 * tn);
				noise("highpass", 1100, 0.5, {
					att: 0.0005,
					tau: (0.01 + dc * 0.04) * wd,
					amp: k * 0.35 * na * (0.4 + 0.6 * vv),
				});
				noise("bandpass", 2400 * Math.pow(tf, 0.6) * ex(2, 1, 4), 0.8, {
					att: 0.0007,
					tau: (0.014 + dc * 0.07) * wd,
					amp: k * 0.9 * na * (0.45 + 0.55 * vv),
				});
				noise("highpass", 6000, 0.7, {
					att: 0.0005,
					tau: 0.008,
					amp: k * 0.45 * v2 * Math.pow(nb(4, 8) / 8, 1.5),
				});
				break;
			}
			case 2:
				hatV(false);
				break;
			case 3:
				hatV(true);
				break;
			case 4: {
				const k = KG[4],
					f = AC.createBiquadFilter(),
					h = AC.createBiquadFilter(),
					g = AC.createGain(),
					tau = (0.016 + dc * 0.05) * ex(4, 1, 3),
					pr = AC.createBiquadFilter(),
					pg = AC.createGain(),
					nbu = 2 + Math.floor(nb(0, 8) / 3),
					sp = 0.0097 * ex(1, 1, 3);
				f.type = "bandpass";
				f.frequency.value = 1250 * tf * ex(2, 1, 5);
				f.Q.value = 1.1 * ex(3, 1, 3);
				h.type = "highpass";
				h.frequency.value = 500 * ex(6, 1, 4);
				h.Q.value = -1;
				src().connect(h);
				h.connect(f);
				f.connect(g);
				g.connect(en);
				pr.type = "bandpass";
				pr.frequency.value = Math.min(16000, 2800 * tf * ex(2, 1, 5));
				pr.Q.value = 0.9;
				pg.gain.value = 0.5 * ex(5, 1, 3);
				h.connect(pr);
				pr.connect(pg);
				pg.connect(g);
				const a = k * 1.5 * (0.7 + 0.3 * vv);
				for (let i = 0; i < nbu; i++) {
					const last = i === nbu - 1,
						tb = t + i * sp + (i && !last ? (Math.random() - 0.5) * 0.003 : 0);
					g.gain.setValueAtTime(0, tb);
					g.gain.linearRampToValueAtTime(a * (last ? 1 : 0.8), tb + 0.0006);
					g.gain.setTargetAtTime(0, tb + 0.0006, last ? tau : 0.0032);
				}
				fin(nbu * sp + 0.01 + tau * 9);
				nodes.push(f, h, g, pr, pg);
				break;
			}
			case 5: {
				const k = KG[5],
					w = nb(6, 8),
					wv = w < 5 ? "sine" : w < 11 ? "triangle" : "square",
					wg = w < 11 ? 1 : 0.5,
					f = 1660 * tf * ex(0, 1, 5),
					f2 = 470 * tf * ex(1, 1, 5);
				osc(wv, f, f * 0.9036, 0.01, 0.006 * ex(5, 1, 3), k * 1.1 * wg * ex(2, 1, 3));
				osc(wv, f2, f2 * 0.915, 0.02, 0.012 + dc * 0.03, k * 0.22 * wg * ex(3, 1, 2.5));
				if (nb(4, 8) > 0) {
					noise("bandpass", 3600, 1.4, {
						att: 0.0004,
						tau: 0.004,
						amp: (k * 0.5 * (0.4 + 0.6 * vv) * nb(4, 8)) / 8,
					});
				}
				break;
			}
			case 6: {
				const k = KG[6],
					tl = ex(3, 1, 3),
					fc = 6500 * tf * ex(0, 1, 6),
					ds = nb(5, 0);
				noise("bandpass", fc, 1.2 * ex(1, 1, 3), {
					att: 0.009 * ex(2, 1, 2.2),
					tau: (0.022 + dc * 0.12) * tl,
					amp: k * 0.5 * (0.7 + 0.3 * vv),
				});
				noise("highpass", 3500, 0.7, {
					att: 0.012,
					tau: (0.012 + dc * 0.05) * tl,
					amp: k * 0.18 * ex(4, 1, 2) * (0.5 + 0.5 * vv),
				});
				if (ds > 0) {
					noise("bandpass", fc * Math.pow(2, (nb(6, 8) - 8) / 8), 1.2 * ex(1, 1, 3), {
						dl: 0.012 + ds * 0.004,
						att: 0.006,
						tau: (0.018 + dc * 0.09) * tl,
						amp: k * 0.35 * (0.7 + 0.3 * vv),
					});
				}
				break;
			}
			default: {
				const k = KG[7],
					w = nb(6, 8),
					wv = w <= 8 ? "sine" : w < 12 ? "triangle" : "square",
					wg = w < 12 ? 1 : 0.5,
					f = 400 * tf * ex(0, 1, 5),
					pr = 2.43 * ex(2, 1, 6);
				osc(wv, f, f * clamp(0.62 * ex(1, 1, 4), 0.15, 1.5), 0.06, 0.028 + dc * 0.1, k * 0.6 * wg);
				osc("sine", f * pr, f * pr * 0.905, 0.04, 0.014 + dc * 0.04, k * 0.2 * ex(3, 1, 2));
				if (nb(4, 8) > 0) {
					noise("bandpass", 2200 * ex(5, 1, 4), 1.2, {
						att: 0.0004,
						tau: 0.004,
						amp: (k * 0.4 * (0.3 + 0.7 * vv) * nb(4, 8)) / 8,
					});
				}
			}
		}
	};
	if (vo) {
		voiced();
	} else {
		switch (pad) {
			case 0: {
				const fe = Math.max(30, 46 * tf),
					f0 = Math.min(380, fe * (3.2 + 1.2 * vv)),
					tau = 0.034 + dc * 0.07,
					sh = AC.createWaveShaper();
				sh.curve = sat;
				sh.connect(en);
				nodes.push(sh);
				const o = osc("sine", f0, fe, 0.12 + dc * 0.05, tau, 1, sh);
				o.frequency.cancelScheduledValues(t);
				o.frequency.setValueAtTime(f0, t);
				o.frequency.exponentialRampToValueAtTime(fe * 1.5, t + 0.014);
				o.frequency.exponentialRampToValueAtTime(fe, t + 0.12 + dc * 0.05);
				noise("bandpass", 3000, 0.7, { att: 0.0004, tau: 0.0025, amp: 0.06 + 0.28 * v2 });
				break;
			}
			case 1: {
				const k = KG[1],
					f = 190 * tf;
				osc("triangle", f * 1.2, f, 0.02, 0.018 + dc * 0.05, k * 0.5);
				osc("sine", f * 1.83, f * 1.7, 0.02, 0.012 + dc * 0.03, k * 0.22);
				noise("highpass", 1100, 0.5, {
					att: 0.0005,
					tau: 0.01 + dc * 0.04,
					amp: k * 0.35 * (0.4 + 0.6 * vv),
				});
				noise("bandpass", 2400 * Math.pow(tf, 0.6), 0.8, {
					att: 0.0007,
					tau: 0.014 + dc * 0.07,
					amp: k * 0.9 * (0.45 + 0.55 * vv),
				});
				noise("highpass", 6000, 0.7, { att: 0.0005, tau: 0.008, amp: k * 0.45 * v2 });
				break;
			}
			case 2:
				hat(false);
				break;
			case 3:
				hat(true);
				break;
			case 4: {
				const k = KG[4],
					f = AC.createBiquadFilter(),
					h = AC.createBiquadFilter(),
					g = AC.createGain(),
					tau = 0.016 + dc * 0.05,
					pr = AC.createBiquadFilter(),
					pg = AC.createGain();
				f.type = "bandpass";
				f.frequency.value = 1250 * tf;
				f.Q.value = 1.1;
				h.type = "highpass";
				h.frequency.value = 500;
				h.Q.value = -1;
				src().connect(h);
				h.connect(f);
				f.connect(g);
				g.connect(en);
				pr.type = "bandpass";
				pr.frequency.value = 2800 * tf;
				pr.Q.value = 0.9;
				pg.gain.value = 0.5;
				h.connect(pr);
				pr.connect(pg);
				pg.connect(g);
				const bt = [0, 0.0095, 0.0195, 0.03],
					a = k * 1.5 * (0.7 + 0.3 * vv);
				bt.forEach((o, i) => {
					const tb = t + o + (i && i < 3 ? (Math.random() - 0.5) * 0.003 : 0);
					g.gain.setValueAtTime(0, tb);
					g.gain.linearRampToValueAtTime(a * (i < 3 ? 0.8 : 1), tb + 0.0006);
					if (i < 3) {
						g.gain.setTargetAtTime(0, tb + 0.0006, 0.0032);
					} else {
						g.gain.setTargetAtTime(0, tb + 0.0006, tau);
					}
				});
				fin(0.04 + tau * 9);
				nodes.push(f, h, g, pr, pg);
				break;
			}
			case 5: {
				const k = KG[5];
				osc("triangle", 1660 * tf, 1500 * tf, 0.01, 0.006, k * 1.1);
				osc("triangle", 470 * tf, 430 * tf, 0.02, 0.012 + dc * 0.03, k * 0.22);
				noise("bandpass", 3600, 1.4, {
					att: 0.0004,
					tau: 0.004,
					amp: k * 0.5 * (0.4 + 0.6 * vv),
				});
				break;
			}
			case 6: {
				const k = KG[6];
				noise("bandpass", 6500 * tf, 1.2, {
					att: 0.009,
					tau: 0.022 + dc * 0.12,
					amp: k * 0.5 * (0.7 + 0.3 * vv),
				});
				noise("highpass", 3500, 0.7, {
					att: 0.012,
					tau: 0.012 + dc * 0.05,
					amp: k * 0.18 * (0.5 + 0.5 * vv),
				});
				break;
			}
			default: {
				const k = KG[7],
					f = 400 * tf;
				osc("sine", f, f * 0.62, 0.06, 0.028 + dc * 0.1, k * 0.6);
				osc("sine", f * 2.43, f * 2.2, 0.04, 0.014 + dc * 0.04, k * 0.2);
				noise("bandpass", 2200, 1.2, {
					att: 0.0004,
					tau: 0.004,
					amp: k * 0.4 * (0.3 + 0.7 * vv),
				});
			}
		}
	}
	if (ns) {
		ns.start(t, Math.random() * 1.2);
		ns.stop(endT);
	}
	setTimeout(
		() =>
			nodes.forEach((n) => {
				try {
					n.disconnect();
				} catch (e) {
					/* nothing to do */
				}
			}),
		Math.max(0, endT - AC.currentTime) * 1000 + 400,
	);
	if (A.sqOn === trk) {
		A.sq.push({ t: trk, when: t, end: endT, g: out, pad });
		if (A.sq.length > 400) {
			A.sq.splice(0, 100);
		}
	} /* a sequenced hit: a song mute can still silence it. Capped like sqAdd's: a drum-only pattern never calls sqAdd, so A.sq (and every hit's gain node it keeps alive) used to grow for as long as it played */
	return null;
}

const VCAP = 10,
	VCAPALL = 20;
// sounding oscillator voices (held notes and release tails) per track and in all: the oldest tail, then the oldest note, fades out in 30 ms
function noteVoice(trk, m, vel, when, dur) {
	const v = noteVoice0(trk, m, vel, when, dur);
	if (A.nvLog) {
		A.nvLog.push({ trk, n: m, vel, when, dur, ct: AC.currentTime, until: v && v.until });
	}
	return v;
}
// A.nvLog: the tests read what was scheduled
function noteVoice0(trk, m, vel, when, dur) {
	const en = engOf(trk),
		w = when || AC.currentTime,
		rn = Math.round(m);
	vel = clamp(+vel || 0, 0, 1);
	// eslint-disable-next-line no-useless-assignment -- the first value is a safe default
	let v = null;
	if (en === "DRUM" && !A.fromMidi && S.glob.out !== 3 && MIDI.outs.length) {
		const ch = midiCh(trk),
			n = 36 + (((rn % 8) + 8) % 8);
		midiSend([0x90 | ch, n, clamp(Math.round(vel * 127), 1, 127)], w);
		midiSend([0x80 | ch, n, 0], w + 0.08);
	}
	const L = A.vox[trk];
	if (en !== "DRUM") {
		for (let i = 0; i < L.length; i++) {
			const o = L[i];
			if (o.mn === rn && !o.done && o.off) {
				o.off(w);
			}
		}
	} /* the same note again lets go of its old voice first (it used to stack on top of it) */
	if (en === "FM") {
		v = fmVoice(trk, m, vel, when);
	} else if (en === "ANA") {
		v = anaVoice(trk, m, vel, w);
	} else if (en === "WAVE") {
		v = wtVoice(trk, m, vel, w);
	} else if (en === "SMP") {
		v = sampVoice(trk, TK(trk).smp.slice, m, vel, w);
	} else {
		drumHit(trk, ((m % 8) + 8) % 8, vel, w);
		return null;
	}
	if (!v) {
		return v;
	}
	v.mn = rn;
	midiOutVoice(trk, m, vel, w, v);
	if (dur) {
		v.until = Math.max(w, AC.currentTime) + dur;
		v.off(v.until);
	}
	L.push(v);
	if (en === "FM") {
		if (L.length > 14) {
			const k = L.findIndex((x) => x.done && !x.pin),
				j = k >= 0 ? k : L.findIndex((x) => !x.pin),
				o = L.splice(j < 0 ? 0 : j, 1)[0];
			if (o.off && !o.done) {
				o.off(AC.currentTime);
			}
		}
	} else {
		voiceCap(trk, L, VCAP);
		let tot = 0;
		A.vox.forEach((l) =>
			l.forEach((x) => {
				if (!x.dead && !x.stolen && x.steal) {
					tot++;
				}
			}),
		);
		if (tot > VCAPALL) {
			const all = [];
			A.vox.forEach((l) =>
				l.forEach((x) => {
					if (!x.dead && !x.stolen && x.steal) {
						all.push(x);
					}
				}),
			);
			all.sort((p, q) => q.done - p.done || p.born - q.born);
			for (let i = 0; i < tot - VCAPALL; i++) {
				all[i].steal();
			}
		}
		vbusSync(trk);
	}
	return v;
}

function voiceCap(trk, L, cap) {
	for (let i = L.length - 1; i >= 0; i--) {
		if (L[i].dead || L[i].stolen) {
			L.splice(i, 1);
		}
	}
	const live = L.filter((x) => !x.dead && !x.stolen && x.steal);
	if (live.length <= cap) {
		return;
	}
	live.sort((p, q) => q.done - p.done || (p.pin ? 1 : 0) - (q.pin ? 1 : 0) || p.born - q.born);
	for (let i = 0; i < live.length - cap; i++) {
		live[i].steal();
	}
}
// tails first, then notes nobody holds, then the oldest

// ---------- recording workflow: count-in, loop overdub, undo / redo, save ----------
// REC while stopped with COUNT-IN on: a count-in (clicks), then the pattern loops and every pass records on top of what is already there until
// you stop; stopping saves the song. Every pass (and every step edit and clear) can be undone and redone. The count-in is a setting
// (SETTINGS > COUNT-IN): REC while stopped plays it, then records.
const UND = { u: [], r: [] };
