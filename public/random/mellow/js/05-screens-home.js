// LCD screens, part 1: grid, boot, home, presets, algorithm, operators, envelope, lfo, fx, arp
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---------- screens ----------
function amp(now, live) {
	if (!live) {
		return 0.8;
	}
	if (A.on) {
		return Math.min(1, A.rms * 5);
	}
	let a = 0;
	if (S.playing) {
		const st = stepSec() * 1000;
		const ph = ((now - S.t0) % st) / st;
		const i = Math.floor((now - S.t0) / st) % nstT();
		if (S.seq.st[i] >= 0) {
			a = 0.35 + 0.5 * Math.exp(-ph * 2.5);
		}
	}
	S.hits.forEach((h) => (a = Math.max(a, Math.exp(-(now - h) / 700))));
	return Math.min(1, a);
}

// time signature (the project's), bars and snap. A step is a 1/16 note, so a bar has numerator x 16 / denominator steps and a beat 16 / denominator steps.
const TSIGS = [
		[2, 4],
		[3, 4],
		[4, 4],
		[5, 4],
		[6, 8],
		[7, 8],
	],
	GUN = ["BEAT", "BAR", "STEP"];

const SPB = () => (TSIGS[S.ts][0] * 16) / TSIGS[S.ts][1],
	TSN = () => TSIGS[S.ts][0],
	BSTEPS = () => 16 / TSIGS[S.ts][1],
	tsName = () => TSIGS[S.ts][0] + "/" + TSIGS[S.ts][1];

const maxBars = () => Math.min(8, Math.floor(SMAX / SPB()));

const nst = () => SPB() * S.plen[S.pat];
// steps in the playing pattern
// per-track lengths (polymeter): a track can have its own length in bars (S.tl[pattern][track], 0 = follow the pattern), so a 3-bar bass can drift against 4-bar drums
S.tl = Array.from({ length: 16 }, () => [0, 0, 0, 0]);

const tbars = (t = S.trk, p = S.pat) => S.tl[p][t] || S.plen[p],
	nstT = (t = S.trk) => SPB() * tbars(t);

const unitSteps = () => [BSTEPS(), SPB(), 1][S.gu],
	snapOn = () => S.snap === 1;

const snapIdx = (j) => {
	if (!snapOn()) {
		return j;
	}
	const u = unitSteps(),
		top = Math.floor((nstT() - 1) / u) * u;
	return clamp(Math.round(j / u) * u, 0, top);
};

function seqViewBar() {
	const L = tbars(),
		c = S.playing ? stepNow() : -1;
	return clamp(Math.floor((c >= 0 ? c : S.seq.sel) / SPB()), 0, L - 1);
}
// the bar the screen shows: the one playing, or the one holding the selected step
// a playing pattern keeps its place (modulo the new length) when its length or the time signature changes, so nothing jumps
function realign(old) {
	const N = nst();
	S.seqs.forEach((q) => {
		if (q.sel >= N) {
			q.sel = N - 1;
		}
	});
	if (S.playing && AC && N !== old) {
		const ss = stepSec(),
			p = A.sn % old,
			np = p % N,
			sh = (A.sn - np) * ss;
		A.t0 += sh;
		A.sn = np;
		S.t0 += sh * 1000;
	}
}

function setTrackLen(b, t = S.trk, p = S.pat) {
	b = clamp(b, 0, maxBars());
	if (b === S.tl[p][t]) {
		return;
	}
	undoPush("TRACK LENGTH");
	S.tl[p][t] = b;
	const q = S.pats[p][t];
	if (q.sel >= nstT(t)) {
		q.sel = nstT(t) - 1;
	}
}

function setLenOf(pi, b) {
	b = clamp(b, 1, maxBars());
	if (b === S.plen[pi]) {
		return;
	}
	undoPush("LENGTH");
	const old = pi === S.pat ? nst() : 0;
	S.plen[pi] = b;
	if (pi === S.pat) {
		realign(old);
	}
}

function setLen(b) {
	setLenOf(S.pat, b);
}

function setSig(i) {
	i = wrap(i, TSIGS.length);
	if (i === S.ts) {
		return;
	}
	undoPush("TIME SIG");
	const old = nst();
	S.ts = i;
	for (let k = 0; k < 16; k++) {
		S.plen[k] = Math.min(S.plen[k], maxBars());
		for (let t = 0; t < 4; t++) {
			S.tl[k][t] = Math.min(S.tl[k][t], maxBars());
		}
	}
	realign(old);
	applyGrid();
}

// the grid: one square = one unit (a beat, a bar or a step), lined up with the sequencer's step columns on the screen and carried on across the page behind everything.
function gridGeom() {
	if (dgOn()) {
		return dgGridGeom();
	}
	const cw = sqCW();
	return {
		cell: unitSteps() * cw,
		minor: S.gu === 1 ? BSTEPS() * cw : cw,
		ax: sqX0() - 1,
		ay: SQ.y0 + SQ.h,
	};
}
// in LCD pixels: the grid is the sequencer's own columns, so every line is a column edge (a step, a beat or a bar), and rows have the same height, counted up from the bars' baseline
// the playhead in (fractional) steps, or -1
function playPosF() {
	if (!S.playing) {
		return -1;
	}
	if (AC && A.on) {
		const lat = AC.outputLatency || AC.baseLatency || 0;
		return Math.max(0, AC.currentTime - lat - A.t0) / stepSec();
	}
	return Math.max(0, performance.now() - S.t0) / (stepSec() * 1000);
}

// which square of the grid is playing now and how far through it (0..1)
function gridPulse() {
	const p = playPosF();
	if (p < 0) {
		return null;
	}
	const N = nst(),
		q = p % N;
	if (S.gu === 0) {
		const u = BSTEPS();
		return { col: Math.floor((q % SPB()) / u) % TSN(), f: ((q % SPB()) / u) % 1 };
	}
	if (S.gu === 1) {
		return { col: 0, f: (q / SPB()) % 1 };
	}
	return { col: Math.floor(q % SPB()), f: q % 1 };
}

function stepNow() {
	if (!S.playing) {
		return -1;
	}
	if (AC && A.on) {
		const ss = stepSec(),
			lat = AC.outputLatency || AC.baseLatency || 0;
		return Math.floor(Math.max(0, AC.currentTime - lat - A.t0) / ss) % nstT();
	}
	return Math.floor((performance.now() - S.t0) / (stepSec() * 1000)) % nstT();
}

function seqPos(now, live) {
	return live ? stepNow() : 6;
}

const SCR = {};

SCR.boot = (now) => {
	drawAlg(1, 120, 86, 26, 18, 14, 9, false);
	T("MELLOW", 120, 104, P.acc, 4, "c");
	T("FOR THE FM-1", 120, 140, P.dim, 1, "c");
	B(40, 166, 160, 7, P.faint);
	R(42, 168, Math.round(156 * 0.62), 3, P.ops[3]);
	T("LOADING PRESETS 080/128", 120, 180, P.dim, 1, "c");
	T("V0.1 DEV", 120, 224, P.faint, 1, "c");
};

// Home, top to bottom: the status strip, the patch (number, engine tag, name, one line of detail), the wave box (MOOD across x WARMTH up; it shimmers with the sound), the four track tiles, the mini song
// player (the song preview's timeline, `HV`: tap a block = go to that slot) and one line for SCAPE and KEY. HM is the layout in LCD pixels (touch, wheel and tests read it).
const HM = { wx: 6, wy: 53, ww: 228, wh: 50, ty: 107, th: 41, cy: 193 };

SCR.home = (now, live) => {
	const p = PRESETS[S.preset],
		e = p[2];
	T(pad(S.preset + 1, 3), 6, 16, P.dim);
	T(p[1], 234, 16, P.ops[ENGCOL[e]], 1, "r");
	T(p[0], 6, 26, P.fg, 2);
	T(
		{
			FM: "FM  ALG " + pad(S.alg) + "  FB " + S.fb,
			ANA: "ANALOG  2 OSC + SUB",
			WAVE: "WAVETABLE  14 FRAMES",
			SMP: "SAMPLER  8 SLICES",
			DRUM: "DRUMS  8 PADS",
		}[e],
		6,
		43,
		P.dim,
	);
	if (slp()) {
		T("SLEEP " + Math.ceil(sleepLeft(live)) + "M", 234, 43, P.acc, 1, "r");
	}
	const x0 = HM.wx,
		y0 = HM.wy,
		w = HM.ww,
		h = HM.wh,
		mid = y0 + h / 2;
	R(x0, y0, w, h, P.grid);
	DH(x0, mid, w, P.faint, 1, 3);
	for (let i = 1; i < 4; i++) {
		DV(x0 + (i * w) / 4, y0, h, P.faint, 1, 3);
	}
	const a = amp(now, live),
		mood = S.mac[0] / 127,
		idx = (1 - S.mac[1] / 127) * 2.4 + 0.3,
		ratio = Math.min(4, S.ops[1].co || 0.5),
		ph0 = live ? now / 260 : 1.3;
	const stp = 1 + Math.floor(mood * 5),
		lv = Math.round(26 - mood * 20);
	if (live && A.on) {
		const bf = A.buf;
		let s0 = 0;
		for (let i = 1; i < 512; i++) {
			if (bf[i - 1] < 0 && bf[i] >= 0) {
				s0 = i;
				break;
			}
		}
		let py = null;
		for (let i = 0; i < w; i++) {
			const v = clamp(bf[s0 + Math.floor(i * 3.2)] * 3.2, -1, 1),
				y = Math.round(mid - v * (h / 2 - 3));
			if (py != null) {
				L(x0 + i - 1, py, x0 + i, y, P.ops[0]);
			}
			py = y;
		}
	} else {
		const tr = (dp, am, col) => {
			let py = null;
			for (let i = 0; i < w; i++) {
				const ii = Math.floor(i / stp) * stp;
				const ph =
					ph0 +
					dp +
					(ii / w) * Math.PI * 2 * 2.5 +
					mood * 0.7 * Math.sin(ii / 28 + (live ? now / 450 : 0));
				let v = Math.sin(ph + idx * Math.sin(ratio * ph));
				v = Math.round(v * lv) / lv;
				const y = Math.round(mid - v * am * (h / 2 - 3));
				if (py != null) {
					L(x0 + i - 1, py, x0 + i, y, col);
				}
				py = y;
			}
		};
		if (live && a > 0.05) {
			tr(0.9, a * 0.55, P.hint);
		} /* the shimmer: a fainter second trace a little out of phase, only while there is sound */
		tr(0, a, P.ops[0]);
	}
	if (live) {
		const f = Math.floor(now / 90),
			n = Math.round(a * 24);
		for (let k = 0; k < n; k++) {
			R(
				x0 + Math.floor(hsh(f * 1.7 + k * 3.3) * (w - 2)) + 1,
				y0 + 2 + Math.floor(hsh(f * 2.9 + k * 7.1) * (h - 4)),
				1,
				1,
				k & 1 ? P.hint : P.dim,
			);
		}
	} /* and a few sparks that come and go with how loud it is */
	{
		const dx = Math.round(x0 + (S.mac[0] / 127) * (w - 4)),
			dy = Math.round(y0 + h - 2 - (S.mac[1] / 127) * (h - 4));
		R(dx - 1, y0 + 1, 1, h - 2, P.faint);
		R(x0 + 1, dy, w - 2, 1, P.faint);
		R(dx - 2, dy - 2, 5, 5, P.acc);
	} /* where MOOD (across) and WARMTH (up) are */
	T("OUT", x0 + 3, y0 + 3, P.dim);
	T("MOOD " + Math.round(mood * 100) + "%", x0 + w - 3, y0 + 3, P.dim, 1, "r");
	for (let i = 0; i < 4; i++) {
		const x = 6 + i * 57,
			y = HM.ty,
			sel = i === S.trk,
			t = S.tracks[i],
			en = engOf(i);
		if (sel) {
			R(x, y, 54, HM.th, P.sel);
		} else {
			B(x, y, 54, HM.th, P.faint);
		}
		const fg = sel ? P.selfg : P.fg,
			dm = sel ? P.selfg : P.dim;
		T("T" + (i + 1), x + 4, y + 3, fg);
		T(ENGSH[en], x + 50, y + 3, dm, 1, "r");
		T(PRESETS[t.pre][0].split(" ")[0].slice(0, 8), x + 4, y + 13, dm);
		B(x + 4, y + 23, 46, 6, dm);
		R(x + 5, y + 24, Math.round((44 * t.vol) / 100), 4, fg);
		T(t.vol + "%", x + 4, y + 31, dm);
	}
	B(HV.x - 1, HV.y - 1, HV.w + 2, HV.h + 2, P.faint);
	songPreviewDraw(now, live, HV);
	T(
		"PLAYED " + playedName(),
		234,
		29,
		playedFresh(now) ? P.acc : P.faint,
		1,
		"r",
	); /* the key you last played: top right, under the status strip and above the wave box */
};

SCR.presets = (now) => {
	{
		const tb = ptabs();
		tb.t.forEach((q) => {
			if (q.i === S.pcat) {
				R(q.x, 15, q.w, 11, P.sel);
				T(CATS[q.i], q.x + 3, 17, P.selfg);
			} else {
				T(CATS[q.i], q.x + 3, 17, P.dim);
			}
		}); /* small arrows say there are more tabs to that side */
		if (tb.less) {
			for (let k = 0; k < 4; k++) {
				R(4 + 3 - k, 17 + k, 1, 7 - 2 * k, P.dim);
			}
		}
		if (tb.more) {
			for (let k = 0; k < 4; k++) {
				R(233 + k, 17 + k, 1, 7 - 2 * k, P.dim);
			}
		}
	}
	R(0, 28, 240, 1, P.faint);
	const rows = prows(),
		n = rows.length,
		top = ptop(rows),
		c = CATS[S.pcat];
	if (rows.every((r) => r.h && !r.n)) {
		T(
			c === "USER"
				? "NOTHING SAVED YET"
				: c === "FAV"
					? "NO FAVOURITES YET"
					: S.trk === DT
						? "T4: DRUM KITS ONLY"
						: "NO PRESETS",
			120,
			90,
			P.dim,
			1,
			"c",
		);
		if (c === "USER") {
			T("SAVE, THEN OCT+", 120, 104, P.faint, 1, "c");
		}
		if (c === "FAV") {
			T("K1 FAV MARKS THE SOUND YOU PLAY", 120, 104, P.faint, 1, "c");
		}
	} /* an empty tab (its header row, if it has one, still shows 0) */
	for (let rr = 0; rr < 8; rr++) {
		if (top + rr >= n) {
			break;
		}
		const row = rows[top + rr],
			y =
				32 +
				rr * 21; /* rows stop at x 222: the touch icon and the scroll bar keep the right edge */
		if (row.h) {
			R(4, y, 218, 19, P.bar);
			T(row.cat, 10, y + 6, P.acc);
			T(String(row.n), 100, y + 6, P.dim);
			T(row.shut ? "+" : "-", 216, y + 6, P.acc, 1, "r");
			continue;
		}
		const i = row.i,
			sel = i === S.preset;
		if (sel) {
			R(4, y, 218, 19, P.sel);
		}
		const fg = sel ? P.selfg : P.fg,
			dm = sel ? P.selfg : P.dim,
			pr = PRESETS[i];
		if (FAVS.has(pr[0])) {
			for (let k = 0; k < 3; k++) {
				R(10 - k, y + 7 + k, 1 + 2 * k, 1, sel ? P.selfg : P.acc);
				if (k < 2) {
					R(10 - k, y + 11 - k, 1 + 2 * k, 1, sel ? P.selfg : P.acc);
				}
			}
		} /* a favourite: a small diamond in front of its number */
		T(pad(i + 1, 3), 16, y + 6, dm);
		T(pr[0].slice(0, 14), 38, y + 6, fg);
		if (PHONEP.has(pr[0])) {
			T("PHONE", 172, y + 6, sel ? P.selfg : P.faint, 1, "r");
		}
		T(ENGL[pr[2]], 216, y + 6, sel ? P.selfg : P.ops[ENGCOL[pr[2]]], 1, "r");
	}
	if (n > 8) {
		const sh = Math.max(6, Math.round((152 * 8) / n)),
			sy = 32 + Math.round(((152 - sh) * top) / (n - 8));
		R(234, 32, 2, 152, P.faint);
		R(234, sy, 2, sh, P.fg);
	}
};

SCR.alg = (now) => {
	title("ALGORITHM");
	T(pad(S.alg), 6, 28, P.fg, 3);
	T("/32", 44, 42, P.dim);
	const A = ALG[S.alg];
	T(A.c.length + " CARRIER" + (A.c.length > 1 ? "S" : ""), 234, 28, P.fg, 1, "r");
	T("FEEDBACK OP" + A.f, 234, 40, P.dim, 1, "r");
	R(0, 54, 240, 1, P.faint);
	const md = Math.max(...Object.values(algLayout(S.alg, 120, 0, 34, 30).pos).map((p) => -p.y)) / 30;
	const by = Math.round(127 + (md * 30 - 19) / 2);
	const r = drawAlg(S.alg, 120, Math.min(178, by), 34, 30, 24, 14, true);
	T("OUT", r.maxx + 16, r.yb - 3, P.dim);
};

SCR.op = (now) => {
	for (let i = 0; i < 6; i++) {
		const x = i * 40,
			c = P.ops[i],
			sel = i === S.op,
			o = S.ops[i];
		if (sel) {
			R(x + 1, 14, 38, 22, c);
		}
		T("OP" + (i + 1), x + 20, 17, sel ? P.bg : c, 1, "c");
		const bw = Math.round((30 * o.lv) / 99);
		R(x + 5, 28, 30, 3, sel ? P.bg : P.faint);
		R(x + 5, 28, bw, 3, sel ? P.selfg : c);
		if (isCar(i)) {
			R(x + 34, 16, 3, 3, sel ? P.bg : c);
		}
	}
	R(0, 37, 240, 1, P.faint);
	const o = S.ops[S.op],
		c = P.ops[S.op];
	T("RATIO", 6, 44, P.dim);
	const rat = ((o.co || 0.5) * (1 + o.fi / 100)).toFixed(2);
	T(rat, 6, 56, P.fg, 3);
	T(isCar(S.op) ? "CARRIER" : "MODULATOR", 234, 44, c, 1, "r");
	T("DETUNE " + (o.de > 0 ? "+" : "") + o.de, 234, 58, P.dim, 1, "r");
	T("OUT " + o.lv, 234, 70, P.dim, 1, "r");
	T("ENVELOPE", 6, 90, P.dim);
	T("ENV >", 234, 90, P.dim, 1, "r");
	R(6, 100, 228, 56, P.grid);
	drawEnv(o, 10, 104, 220, 48, c, false, false);
	T("KEY VEL " + o.kvs + "   RATE SCL " + o.rs, 6, 166, P.dim);
	T(
		"AMS " +
			(S.lfo.am > 0 && ALG[S.alg].c.includes(S.op + 1) ? 2 : o.ams) +
			"      BRK PT " +
			note(o.bp + 9),
		6,
		178,
		P.dim,
	);
	T("BLACK KEYS PICK OP", 6, 192, P.faint);
};

SCR.env = (now) => {
	const o = S.ops[S.op],
		c = P.ops[S.op];
	T("OP" + (S.op + 1) + " ENVELOPE", 6, 17, c);
	const chip = (s, x, on) => {
		const w = TW(s) + 6;
		if (on) {
			R(x - w, 15, w, 11, P.sel);
			T(s, x - w + 3, 17, P.selfg);
		} else {
			T(s, x - w + 3, 17, P.dim);
		}
		return w;
	};
	const w2 = chip("LEVELS", 234, S.envPage === 1);
	chip("RATES", 232 - w2, S.envPage === 0);
	R(4, 30, 232, 132, P.grid);
	drawEnv(o, 8, 36, 224, 122, c, true, true);
	T("R " + o.R.map((v) => pad(v)).join(" "), 6, 170, S.envPage ? P.dim : P.fg);
	T("L " + o.L.map((v) => pad(v)).join(" "), 126, 170, S.envPage ? P.fg : P.dim);
	T("ENV AGAIN: RATES/LEVELS", 6, 186, P.faint);
};

SCR.lfo = (now, live) => {
	LFOW.forEach((w, i) => {
		const x = 4 + i * 39,
			sel = i === S.lfo.w;
		if (sel) {
			R(x, 14, 37, 12, P.sel);
		}
		T(w, x + 19, 17, sel ? P.selfg : P.dim, 1, "c");
	});
	R(0, 28, 240, 1, P.faint);
	const x0 = 6,
		y0 = 36,
		w = 228,
		h = 100,
		mid = y0 + h / 2;
	R(x0, y0, w, h, P.grid);
	DH(x0, mid, w, P.faint, 1, 3);
	const f = (ph) => {
		ph = ph % 1;
		switch (S.lfo.w) {
			case 0:
				return ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;
			case 1:
				return 1 - ph * 2;
			case 2:
				return ph * 2 - 1;
			case 3:
				return ph < 0.5 ? 1 : -1;
			case 4:
				return Math.sin(ph * Math.PI * 2);
			default: {
				const k = Math.floor(ph * 8);
				return Math.sin(k * 12.9898) * 0.9;
			}
		}
	};
	let py = null;
	const cyc = 2;
	for (let i = 0; i < w; i++) {
		const ph = (i / w) * cyc + (S.lfo.w === 5 ? 0 : 0);
		const y = Math.round(
			mid - f(ph + (S.lfo.w === 5 ? Math.floor((i / w) * cyc) : 0) * 0) * (h / 2 - 6),
		);
		if (py != null) {
			L(x0 + i - 1, py, x0 + i, y, P.ops[4]);
		}
		py = y;
	}
	const t = live ? ((now / 1000) * (0.2 + S.lfo.sp / 25)) % cyc : 0.7;
	const dx = Math.round((t / cyc) * w);
	const dy = Math.round(mid - f(t) * (h / 2 - 6));
	R(x0 + dx - 2, dy - 2, 5, 5, P.acc);
	T("SPEED", 6, 146, P.dim);
	T(S.lfo.sp, 60, 146, P.fg);
	T("DELAY", 126, 146, P.dim);
	T(S.lfo.dl, 180, 146, P.fg);
	T("KEY SYNC", 6, 160, P.dim);
	T("ON", 60, 160, P.fg);
	T("PMS", 126, 160, P.dim);
	T(String(S.lfo.ps), 180, 160, P.fg);
	T("PITCH", 6, 176, P.dim);
	R(60, 178, 60, 3, P.faint);
	R(60, 178, Math.round((60 * S.lfo.pm) / 99), 3, P.ops[4]);
	T("AMP", 126, 176, P.dim);
	R(180, 178, 54, 3, P.faint);
	R(180, 178, Math.round((54 * S.lfo.am) / 99), 3, P.ops[4]);
};

SCR.fx = (now, live) => {
	const f = S.fx,
		names = ["FILT", "TAPE", "ECHO", "VERB"];
	names.forEach((nm, i) => {
		const x = 4 + i * 58,
			on = f.slot === i;
		if (on) {
			R(x, 16, 52, 16, P.sel);
			T(nm, x + 26, 21, P.selfg, 1, "c");
		} else {
			B(x, 16, 52, 16, P.dim);
			T(nm, x + 26, 21, P.fg, 1, "c");
		}
		if (i < 3) {
			L(x + 52, 24, x + 57, 24, P.dim);
		}
	});
	R(0, 38, 240, 1, P.faint);
	const x0 = 6,
		y0 = 44,
		w = 228,
		h = 126,
		tm = live ? now / 1000 : 0;
	R(x0, y0, w, h, P.grid);
	if (f.slot === 0) {
		T(["LOW PASS 12DB", "BAND PASS", "HIGH PASS 12DB"][f.ft], 10, 48, P.dim);
		filtCurve(x0, y0, w, h, f.ft, f.cut, f.res, P.ops[0]);
	} else if (f.slot === 1) {
		T("TAPE  WOW + FLUTTER + DUST", 10, 48, P.dim);
		const mid = y0 + 68;
		DH(x0, mid, w, P.faint, 1, 3);
		const wow = f.wow / 99,
			flu = f.flu / 99,
			drv = f.drv / 99;
		let py = null;
		for (let i = 0; i < w; i++) {
			const u = i / w;
			const ph =
				u * Math.PI * 9 +
				Math.sin(u * Math.PI * 2 + tm) * wow * 5 +
				Math.sin(u * Math.PI * 23 + tm * 3) * flu * 0.8;
			const v = Math.tanh(Math.sin(ph) * (1 + drv * 4)) / Math.tanh(1 + drv * 4);
			const y = Math.round(mid - v * (36 - wow * 6));
			if (py != null) {
				L(x0 + i - 1, py, x0 + i, y, P.ops[0]);
			}
			py = y;
		}
		const fr = Math.floor(tm * 6);
		for (let n = 0; n < Math.round(f.dust / 4); n++) {
			R(
				x0 + ((hsh(n * 5.1 + fr) * w) | 0),
				y0 + 4 + ((hsh(n * 9.7 + fr) * (h - 8)) | 0),
				1,
				1,
				P.ops[4],
			);
		}
		T("WOW " + f.wow + "  FLUTTER " + f.flu + "  DRIVE " + f.drv, 10, y0 + h - 10, P.dim);
	} else if (f.slot === 2) {
		T("TAPE ECHO  " + ["1/8", "1/4", "3/8", "1/2"][f.et], 10, 48, P.dim);
		T("SHARED", x0 + w - 4, 48, P.fg, 1, "r");
		const sp = 26 + f.et * 14,
			base = y0 + h - 16,
			r = 0.35 + (f.efb / 99) * 0.6;
		for (let k = 0; k < 9; k++) {
			const x = x0 + 10 + k * sp;
			if (x > x0 + w - 8) {
				break;
			}
			const hh = Math.round(70 * Math.pow(r, k));
			if (hh > 0) {
				R(x, base - hh, 4, hh, k === 0 ? P.fg : P.ops[3]);
			}
		}
		R(x0, base, w, 1, P.faint);
		T(
			"TONE " + (f.etone < 34 ? "DARK" : f.etone < 67 ? "WARM" : "BRIGHT") + "  FEEDBACK " + f.efb,
			10,
			base + 4,
			P.dim,
		);
	} else {
		T(["HALL", "ROOM", "PLATE", "SHIMMER"][f.rt] + " REVERB", 10, 48, P.dim);
		T("SHARED", x0 + w - 4, 48, P.fg, 1, "r");
		let seed = 7;
		const rnd = () => {
			seed = (seed * 16807) % 2147483647;
			return seed / 2147483647;
		};
		const len = 40 + f.size * 1.8,
			base = y0 + h - 12;
		R(x0 + 8, y0 + 22, 3, base - y0 - 22, P.ops[3]);
		for (let i = 14; i < w - 6; i += 3) {
			const t = (i - 14) / len;
			const e = Math.exp(-t * 3) * (0.4 + 0.6 * rnd());
			const hh = Math.round(e * (base - y0 - 30));
			if (hh > 0) {
				R(x0 + i, base - hh, 2, hh, f.rt === 3 && ((i / 3) | 0) % 2 ? P.ops[0] : P.ops[3]);
			}
		}
		R(x0, base, w, 1, P.faint);
		T("PRE", x0 + 4, base + 3, P.dim);
		T("TAIL " + (0.4 + f.size / 30).toFixed(1) + "S", x0 + w - 4, base + 3, P.dim, 1, "r");
	}
	T("FX AGAIN: NEXT SLOT", 6, 182, P.faint);
};

SCR.arp = (now, live) => {
	const modes = ["UP", "DOWN", "UP/DN", "RAND", "ORDER", "CHORD"];
	modes.forEach((m, i) => {
		const x = 4 + i * 39,
			sel = i === S.arp.mode;
		if (sel) {
			R(x, 14, 37, 12, P.sel);
		}
		T(m, x + 19, 17, sel ? P.selfg : P.dim, 1, "c");
	});
	R(0, 28, 240, 1, P.faint);
	const held = [60, 64, 67],
		seq = [];
	for (let o = 0; o < S.arp.oct; o++) {
		held.forEach((n) => seq.push(n + 12 * o));
	}
	let pat = seq.slice();
	if (S.arp.mode === 1) {
		pat.reverse();
	}
	if (S.arp.mode === 2) {
		pat = seq.concat(seq.slice(1, -1).reverse());
	}
	if (S.arp.mode === 3) {
		let s = 3;
		pat = seq.map(() => {
			s = (s * 31 + 7) % seq.length;
			return seq[s];
		});
	}
	const x0 = 6,
		y0 = 34,
		w = 228,
		h = 124,
		lo = 58,
		hi = 60 + 12 * S.arp.oct + 2;
	R(x0, y0, w, h, P.grid);
	for (let n = lo; n <= hi; n++) {
		if (n % 12 === 0) {
			DH(x0, y0 + h - Math.round(((n - lo) / (hi - lo)) * h), w, P.faint, 1, 3);
		}
	}
	const cur = seqPos(now, live);
	for (let i = 0; i < 16; i++) {
		const x = x0 + 2 + i * 14;
		if (i === cur) {
			R(x - 1, y0, 14, h, P.faint);
		}
		if (i % 4 === 0) {
			DV(x - 2, y0, h, P.faint, 1, 4);
		}
		if (S.arp.mode === 5) {
			held.forEach((n) => {
				const y = y0 + h - Math.round(((n - lo) / (hi - lo)) * h);
				R(
					x,
					y - 2,
					Math.max(2, Math.round((12 * S.arp.gate) / 100)),
					4,
					i === cur ? P.acc : P.ops[3],
				);
			});
		} else {
			const n = pat[i % pat.length];
			const y = y0 + h - Math.round(((n - lo) / (hi - lo)) * h);
			R(
				x,
				y - 2,
				Math.max(2, Math.round((12 * S.arp.gate) / 100)),
				4,
				i === cur ? P.acc : P.ops[3],
			);
		}
	}
	T(
		"HELD " +
			([...A.arpSet]
				.sort((a, b) => a - b)
				.slice(0, 3)
				.map(note)
				.join(" ") || "C4 E4 G4"),
		6,
		166,
		P.dim,
	);
	T(
		S.arp.on ? "ARP ON  PAGE: OFF" : "ARP OFF  PAGE: ON",
		234,
		166,
		S.arp.on ? P.acc : P.dim,
		1,
		"r",
	);
	T(
		"RATE " + ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"][S.arp.rate] + "  SWING 0%",
		6,
		180,
		P.dim,
	);
};
