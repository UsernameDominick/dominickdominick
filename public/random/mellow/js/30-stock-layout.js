// the stock FM-1 layout: page names, order and the pages
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---------- stock FM-1 layout (page names and order from the stock firmware's menu strings) + Mellow extras ----------
S.ppMode = "edit";

S.ppPage = 0;

S.seqEn = false;

S.mono = false;

S.pegR = [99, 99, 99, 99];

S.pegL = [50, 50, 50, 50];

S.adsr = { a: 0, d: 30, s: 0, r: 30 };

S.dlg = null;

Object.assign(S.glob, {
	ech: 1,
	pu: 2,
	pdn: 2,
	gtr: 0,
	metro: 0,
	rmode: 0,
	cin: 0,
	arec: 0,
	rlen: 0,
});

const GLOB0 = JSON.parse(JSON.stringify(S.glob));
/* the device settings as shipped (RESET goes back to these) */
try {
	const o = JSON.parse(localStorage.getItem("mellow-dev"));
	if (o && typeof o === "object") {
		for (const k in GLOB0) {
			if (k !== "sel" && typeof o[k] === "number" && isFinite(o[k])) {
				S.glob[k] = o[k];
			}
		}
	}
} catch (e) {
	/* nothing to do */
}

{
	/* every device setting is a whole number inside its own range (the GLO rows' steps): a stored 99 for MIDI OUT, a count-in of 50 bars or a tuning of 1e9 used to be taken as it was */
	const GR = {
		mmode: [0, 1],
		mclk: [0, 1],
		akey: [0, 1],
		ch: [1, 16],
		ech: [1, 16],
		out: [0, 3],
		bt: [0, 1],
		vel: [0, 3],
		km: [0, 1],
		bri: [10, 100],
		sleep: [0, 3],
		tune: [430, 450],
		fade: [0, 3],
		night: [0, 2],
		pu: [0, 12],
		pdn: [0, 12],
		gtr: [-12, 12],
		metro: [0, 1],
		rmode: [0, 1],
		cin: [0, 2],
		arec: [0, 1],
		rlen: [0, 1],
	};
	for (const k in GR) {
		if (k in S.glob) {
			S.glob[k] = clamp(Math.round(+S.glob[k]), GR[k][0], GR[k][1]);
		}
	}
}

let devLast = "";

function saveDev() {
	const o = Object.assign({}, S.glob);
	delete o.sel;
	const js = JSON.stringify(o);
	if (js !== devLast) {
		devLast = js;
		try {
			localStorage.setItem("mellow-dev", js);
		} catch (e) {
			/* nothing to do */
		}
	}
}

addEventListener("pagehide", saveDev);
/* metro: click on every beat while playing; rmode: 0 overdub / 1 replace; cin: count-in 0 off, 1 or 2 bars */
Object.assign(S.fx, {
	dg: 30,
	dt: 60,
	dmix: 0,
	cr: 30,
	cd: 40,
	cmix: 0,
	pf: 25,
	pd: 50,
	pmix: 0,
});

Object.assign(S.arp, { rate: 4, latch: 0, sw: 50 });

A.arpKeys = {};

S.ops.forEach((o) => {
	if (o.mode == null) {
		o.mode = 0;
	}
});

const pcf = (v) => v + "%",
	sgn = (v) => (v > 0 ? "+" : "") + v,
	CURV = ["-LIN", "-EXP", "+EXP", "+LIN"];

const ARPM = ["UP", "DOWN", "INCLUSIVE", "EXCLUSIVE", "RANDOM", "ORDER", "REPEAT"],
	ARPR = ["1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32", "1/32T"];

function adsrFromOps() {
	const c = (ALG[S.alg].c[0] || 1) - 1,
		o = S.ops[c],
		q = (r) => clamp(Math.round((99 - r) / 0.9), 0, 99);
	S.adsr = { a: q(o.R[0]), d: q(o.R[1]), s: o.L[2], r: q(o.R[3]) };
}

function applyAdsr() {
	const a = S.adsr,
		q = (v) => 99 - Math.round(v * 0.9);
	ALG[S.alg].c.forEach((c) => {
		const o = S.ops[c - 1];
		o.R[0] = q(a.a);
		o.R[1] = q(a.d);
		o.R[2] = q(a.d);
		o.R[3] = q(a.r);
		o.L[2] = a.s;
	});
}

const ADS = (l, k) => ({
	ref: [S.adsr, k, 0, 99],
	l,
	v: String(S.adsr[k]),
	n: S.adsr[k] / 99,
	set: (d) => {
		S.adsr[k] = clamp(S.adsr[k] + d, 0, 99);
		applyAdsr();
	},
});

const fixedHz = (o) => Math.pow(2, ((4458616 * ((o.co & 3) * 100 + o.fi)) >> 3) / 16777216);

function ratioTxt(o) {
	if (o.mode) {
		const f = fixedHz(o);
		return (f >= 1000 ? (f / 1000).toFixed(2) + "K" : f.toFixed(f < 10 ? 2 : 1)) + "HZ";
	}
	return ((o.co || 0.5) * (1 + o.fi / 100)).toFixed(2);
}

function ppPages() {
	const f = S.fx,
		o = S.ops[S.op],
		n = S.op + 1,
		G = S.glob,
		L = S.lfo;
	switch (S.ppMode) {
		case "fx":
			return [
				{
					t: "FILTER",
					p: [
						CH("TYPE", f, "ft", ["LOW PASS", "BAND PASS", "HIGH PASS"]),
						NUM("CUTOFF", f, "cut", 0, 127, (v) => hz(v) + "HZ"),
						NUM("Q", f, "res", 0, 99),
						NUM("MIX", f, "fmix", 0, 100, pcf),
					],
					g: gFilter,
				},
				{
					t: "REVERB",
					p: [
						CH("TYPE", f, "rt", ["HALL", "ROOM", "PLATE", "SHIMMER"]),
						NUM("DECAY", f, "size", 0, 99, pcf),
						{
							l: "TONE",
							v: String(99 - f.damp),
							n: (99 - f.damp) / 99,
							set: (d) => (f.damp = clamp(f.damp - d, 0, 99)),
						},
						NUM("MIX", f, "rmix", 0, 100, pcf),
					],
					g: gReverb,
				},
				{
					t: "DELAY",
					p: [
						CH("TIME", f, "et", ["1/8", "1/4", "3/8", "1/2"]),
						NUM("FEEDBACK", f, "efb", 0, 99, pcf),
						NUM("TONE", f, "etone", 0, 99),
						NUM("MIX", f, "emix", 0, 100, pcf),
					],
					g: gDelay,
				},
				{
					t: "DISTORTION",
					p: [
						NUM("GAIN", f, "dg", 0, 99),
						NUM("TONE", f, "dt", 0, 99),
						NUM("MIX", f, "dmix", 0, 100, pcf),
						NONE,
					],
					g: gDist,
				},
				{
					t: "CHORUS",
					p: [
						NUM("RATE", f, "cr", 0, 99),
						NUM("DEPTH", f, "cd", 0, 99),
						NUM("MIX", f, "cmix", 0, 100, pcf),
						NONE,
					],
					g: (x, y, w, h, now, live) => gMod(x, y, w, h, f.cr, f.cd, now, live),
				},
				{
					t: "PHASER",
					p: [
						NUM("FREQ", f, "pf", 0, 99),
						NUM("DEPTH", f, "pd", 0, 99),
						NUM("MIX", f, "pmix", 0, 100, pcf),
						NONE,
					],
					g: (x, y, w, h, now, live) => gMod(x, y, w, h, f.pf, f.pd, now, live),
				},
				{
					t: "TAPE  MELLOW",
					p: [
						NUM("WOW", f, "wow", 0, 99),
						NUM("FLUTTER", f, "flu", 0, 99),
						NUM("DRIVE", f, "drv", 0, 99),
						NUM("DUST", f, "dust", 0, 99),
					],
					g: gTape,
				},
			];
		case "env":
			if (engOf(S.trk) === "ANA") {
				return [
					{
						t: "ENVELOPE",
						p: [
							NUM("ATTACK", S.ana, "atk", 0, 99),
							NONE,
							NONE,
							NUM("RELEASE", S.ana, "rel", 0, 99),
						],
						g: gAnaEnv,
					},
				];
			} /* an analog track: its own two envelope values (RELEASE had no control before) */
			return [
				{
					t: "ENVELOPE",
					p: [ADS("ATTACK", "a"), ADS("DECAY", "d"), ADS("SUSTAIN", "s"), ADS("RELEASE", "r")],
					g: gADSR,
				},
			];
		case "lfo":
			return [
				{
					t: "1/2 LFO",
					p: [
						NUM("SPEED", L, "sp", 0, 99),
						NUM("DELAY", L, "dl", 0, 99),
						NUM("PITCH MOD", L, "pm", 0, 99),
						NUM("AMP MOD", L, "am", 0, 99),
					],
					g: gLfo,
				},
				{
					t: "2/2 LFO",
					p: [
						CH("LFO SYNC", L, "sy", ["OFF", "ON"]),
						CH("WAVE", L, "w", ["TRIANGLE", "SAW DOWN", "SAW UP", "SQUARE", "SINE", "S&HOLD"]),
						NUM("PITCH SENS", L, "ps", 0, 7),
						NONE,
					],
					g: gLfo,
				},
			];
		case "edit":
			return [
				{
					t: "1/6 OP" + n + " ENVELOPE",
					p: [0, 1, 2, 3].map((k) => NUM("RATE " + (k + 1), o.R, k, 0, 99)),
					g: gOpEnv,
				},
				{
					t: "2/6 OP" + n + " ENVELOPE",
					p: [0, 1, 2, 3].map((k) => NUM("LEVEL " + (k + 1), o.L, k, 0, 99)),
					g: gOpEnv,
				},
				{
					t: "3/6 OP" + n + " TUNING",
					p: [
						CH("OSCMODE", o, "mode", ["RATIO", "FIXED"]),
						NUM("FREQCOARSE", o, "co", 0, 31, () => ratioTxt(o)),
						NUM("FREQFINE", o, "fi", 0, 99),
						NUM("DETUNE", o, "de", -7, 7, sgn),
					],
					g: gTune,
				},
				{
					t: "4/6 OP" + n + " SENS&LVL",
					p: [
						NUM("RATESCALE", o, "rs", 0, 7),
						NUM("A MODSENS", o, "ams", 0, 3),
						NUM("KEYVELOCITY", o, "kvs", 0, 7),
						NUM("OUT LEVEL", o, "lv", 0, 99),
					],
					g: gLevel,
				},
				{
					t: "5/6 OP" + n + " SCALING",
					p: [
						NUM("BREAKPOINT", o, "bp", 0, 99, (v) => note(v + 9)),
						NUM("L DEPTH", o, "ld", 0, 99),
						NUM("R DEPTH", o, "rd", 0, 99),
						CH("L CURVE", o, "lc", CURV),
					],
					g: gScale,
				},
				{
					t: "6/6 OP" + n + " SCALING",
					p: [CH("R CURVE", o, "rc", CURV), NONE, NONE, NONE],
					g: gScale,
				},
			];
		case "pit":
			return [
				{
					t: "1/2 PITCHENVELOPE",
					p: [0, 1, 2, 3].map((k) => NUM("RATE " + (k + 1), S.pegR, k, 0, 99)),
					g: gPeg,
				},
				{
					t: "2/2 PITCHENVELOPE",
					p: [0, 1, 2, 3].map((k) => NUM("LEVEL " + (k + 1), S.pegL, k, 0, 99)),
					g: gPeg,
				},
			];
		case "voice":
			return [
				{
					t: "VOICE",
					p: [
						{
							l: "ALGORITHM",
							v: pad(S.alg),
							n: (S.alg - 1) / 31,
							set: (d) => {
								S.alg = wrap(S.alg - 1 + d, 32) + 1;
								adsrFromOps();
							},
						},
						NUM("FEEDBACK", S, "fb", 0, 7),
						CH("OSC SYNC", S, "sync", ["OFF", "ON"]),
						NUM("TRANSPOSE", S, "tr", -24, 24, sgn),
					],
					g: gAlgMini,
				},
			];
		case "glob":
			return [
				{
					t: "1/2 GLOBE",
					p: [
						NUM("NOTE CHN", G, "ch", 1, 16),
						NUM("EFFECT CHN", G, "ech", 1, 16),
						NUM("PITCH UP", G, "pu", 0, 12),
						NUM("PITCH DN", G, "pdn", 0, 12),
					],
				},
				{
					t: "2/2 GLOBE",
					p: [
						NUM("TRANSPOSE", G, "gtr", -12, 12, sgn),
						NUM("OCTAVE", S, "oct", -3, 3, sgn),
						NUM("VOLUME", S, "vol", 0, 100),
						{ l: "RESET", v: "---", n: 0, set: () => openResetDlg() },
					],
				},
				{
					t: "MELLOW",
					p: [
						{
							l: "SLEEP FADE",
							st: 4,
							si: G.fade,
							sn: G.fade + 1,
							v: ["OFF", "15 MIN", "30 MIN", "60 MIN"][G.fade],
							n: G.fade / 3,
							set: (d) => {
								G.fade = clamp(G.fade + d, 0, 3);
								S.sleepT0 = performance.now();
							},
						},
						NUM("BRIGHTNESS", G, "bri", 10, 100, pcf),
						NUM("TUNING", G, "tune", 430, 450, (v) => "A " + v),
						CH("VELOCITY", G, "vel", ["SOFT", "MEDIUM", "HARD", "FIXED"]),
					],
				},
			];
		case "rec":
			return [
				/* HOLD REC: the same state as the SETTINGS rows and the GLO page (S.glob), four to a page */
				{
					t: "1/2 RECORDING SETTINGS",
					p: [
						CH("METRONOME", G, "metro", ["OFF", "ON"]),
						CH("RECORD MODE", G, "rmode", ["OVERDUB", "REPLACE"]),
						CH("COUNT-IN", G, "cin", ["OFF", "1 BAR", "2 BARS"]),
						CH("RECORD LENGTH", G, "rlen", ["LOOPS", "GROWS"]),
					],
				},
				{
					t: "2/2 RECORD AUTOMATION",
					p: [CH("AUTOMATION", G, "arec", ["OFF", "ON"]), NONE, NONE, NONE],
				},
			];
		case "queue":
		case "strip":
			return qsPages(S.ppMode); /* the QUEUE and STRIP screens (pages of the same parameter grid) */
		case "arp":
			return [
				{
					t: "1/2 ARPEGGIO",
					p: [
						CH("MODE", S.arp, "mode", ARPM),
						CH("RATE", S.arp, "rate", ARPR),
						NUM("OCTAVE", S.arp, "oct", 1, 4),
						NUM("GATE", S.arp, "gate", 5, 100, pcf),
					],
					g: gArp,
				},
				{
					t: "2/2 ARPEGGIO",
					p: [
						CH("LATCH", S.arp, "latch", ["OFF", "ON"]),
						NUM("SWING", S.arp, "sw", 50, 75, pcf),
						NONE,
						NONE,
					],
					g: gArp,
				},
			];
	}
	return [{ t: "", p: [NONE, NONE, NONE, NONE] }];
}

// ---- page graphics (area 228 x 88 under the four parameter rows) ----
function gFilter(x, y, w, h) {
	R(x, y, w, h, P.grid);
	filtCurve(x, y, w, h, S.fx.ft, S.fx.cut, S.fx.res, P.ops[0]);
}

function gReverb(x, y, w, h) {
	const f = S.fx;
	R(x, y, w, h, P.grid);
	let seed = 7;
	const rnd = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	const len = 30 + f.size * 1.6,
		base = y + h - 4;
	R(x + 6, y + 8, 3, base - y - 8, P.ops[3]);
	for (let i = 14; i < w - 6; i += 3) {
		const e = Math.exp(-((i - 14) / len) * 3) * (0.4 + 0.6 * rnd()),
			hh = Math.round(e * (base - y - 14));
		if (hh > 0) {
			R(x + i, base - hh, 2, hh, f.rt === 3 && ((i / 3) | 0) % 2 ? P.ops[0] : P.ops[3]);
		}
	}
}

function gDelay(x, y, w, h) {
	const f = S.fx;
	R(x, y, w, h, P.grid);
	const sp = 24 + f.et * 14,
		base = y + h - 4,
		r = 0.35 + (f.efb / 99) * 0.6;
	for (let k = 0; k < 9; k++) {
		const xx = x + 8 + k * sp;
		if (xx > x + w - 8) {
			break;
		}
		const hh = Math.round((h - 10) * Math.pow(r, k));
		if (hh > 0) {
			R(xx, base - hh, 4, hh, k ? P.ops[3] : P.fg);
		}
	}
}

function gDist(x, y, w, h) {
	R(x, y, w, h, P.grid);
	const k = 1 + (S.fx.dg / 99) * 30,
		cx = x + w / 2,
		cy = y + h / 2;
	DH(x, cy, w, P.faint, 1, 3);
	DV(cx, y, h, P.faint, 1, 3);
	let py = null;
	for (let i = 0; i < w; i++) {
		const v = Math.tanh(((i / w) * 2 - 1) * k) / Math.tanh(k),
			yy = Math.round(cy - v * (h / 2 - 4));
		if (py != null) {
			L(x + i - 1, py, x + i, yy, P.ops[0]);
		}
		py = yy;
	}
}

function gMod(x, y, w, h, rate, depth, now, live) {
	R(x, y, w, h, P.grid);
	const cy = y + h / 2,
		ph = live ? (now / 1000) * (0.2 + rate / 30) : 0;
	DH(x, cy, w, P.faint, 1, 3);
	let py = null;
	for (let i = 0; i < w; i++) {
		const v = Math.sin(ph + (i / w) * Math.PI * 2 * (1 + rate / 25)) * (0.1 + (depth / 99) * 0.9),
			yy = Math.round(cy - v * (h / 2 - 4));
		if (py != null) {
			L(x + i - 1, py, x + i, yy, P.ops[3]);
		}
		py = yy;
	}
}

function gTape(x, y, w, h, now, live) {
	const f = S.fx;
	R(x, y, w, h, P.grid);
	const mid = y + h / 2,
		wow = f.wow / 99,
		flu = f.flu / 99,
		drv = f.drv / 99,
		tm = live ? now / 1000 : 0;
	let py = null;
	for (let i = 0; i < w; i++) {
		const u = i / w,
			ph =
				u * Math.PI * 9 +
				Math.sin(u * Math.PI * 2 + tm) * wow * 5 +
				Math.sin(u * Math.PI * 23 + tm * 3) * flu * 0.8,
			v = Math.tanh(Math.sin(ph) * (1 + drv * 4)) / Math.tanh(1 + drv * 4),
			yy = Math.round(mid - v * (h / 2 - 6));
		if (py != null) {
			L(x + i - 1, py, x + i, yy, P.ops[0]);
		}
		py = yy;
	}
	const fr = Math.floor(tm * 6);
	for (let k = 0; k < Math.round(f.dust / 4); k++) {
		R(
			x + ((hsh(k * 5.1 + fr) * w) | 0),
			y + 2 + ((hsh(k * 9.7 + fr) * (h - 4)) | 0),
			1,
			1,
			P.ops[4],
		);
	}
}

function gADSR(x, y, w, h) {
	const a = S.adsr;
	R(x, y, w, h, P.grid);
	const base = y + h - 14,
		top = y + 6,
		sy = base - Math.round(((base - top) * a.s) / 99);
	const aw = 4 + a.a * 0.5,
		dw = 4 + a.d * 0.5,
		sw = 46,
		rw = 4 + a.r * 0.5,
		k = Math.min(1, (w - 12) / (aw + dw + sw + rw)),
		xs = [0, aw, aw + dw, aw + dw + sw, aw + dw + sw + rw].map((v) => x + 6 + Math.round(v * k)),
		ys = [base, top, sy, sy, base];
	for (let i = 0; i < 4; i++) {
		L(xs[i], ys[i], xs[i + 1], ys[i + 1], P.ops[2]);
		L(xs[i], ys[i] - 1, xs[i + 1], ys[i + 1] - 1, P.ops[2]);
	}
	let lx = -9;
	["A", "D", "S", "R"].forEach((c, i) => {
		const cx = Math.max(lx + 8, Math.round((xs[i] + xs[i + 1]) / 2));
		lx = cx;
		T(c, cx, y + h - 10, P.dim, 1, "c");
	});
}

function gAnaEnv(x, y, w, h) {
	const a = S.ana;
	R(x, y, w, h, P.grid);
	const base = y + h - 14,
		top = y + 6,
		sy = top + Math.round((base - top) * 0.4),
		aw = 10 + (a.atk / 99) * 60,
		dw = 30,
		sw = 44,
		rw = 10 + (a.rel / 99) * 70,
		k = Math.min(1, (w - 12) / (aw + dw + sw + rw)),
		xs = [0, aw, aw + dw, aw + dw + sw, aw + dw + sw + rw].map((v) => x + 6 + Math.round(v * k)),
		ys = [base, top, sy, sy, base];
	for (let i = 0; i < 4; i++) {
		L(xs[i], ys[i], xs[i + 1], ys[i + 1], P.ops[2]);
		L(xs[i], ys[i] - 1, xs[i + 1], ys[i + 1] - 1, P.ops[2]);
	}
	T("A", Math.round((xs[0] + xs[1]) / 2), y + h - 10, P.dim, 1, "c");
	T("R", Math.round((xs[3] + xs[4]) / 2), y + h - 10, P.dim, 1, "c");
}

function lfoShape(ph) {
	ph = ((ph % 1) + 1) % 1;
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
		default:
			return Math.sin(Math.floor(ph * 8) * 12.9898) * 0.9;
	}
}

function gLfo(x, y, w, h, now, live) {
	R(x, y, w, h, P.grid);
	const mid = y + h / 2;
	DH(x, mid, w, P.faint, 1, 3);
	let py = null;
	for (let i = 0; i < w; i++) {
		const yy = Math.round(mid - lfoShape((i / w) * 2) * (h / 2 - 6));
		if (py != null) {
			L(x + i - 1, py, x + i, yy, P.ops[4]);
		}
		py = yy;
	}
	const t = live ? ((now / 1000) * (0.2 + S.lfo.sp / 25)) % 2 : 0.7;
	R(x + Math.round((t / 2) * w) - 2, Math.round(mid - lfoShape(t) * (h / 2 - 6)) - 2, 5, 5, P.acc);
}

function gOpEnv(x, y, w, h) {
	R(x, y, w, h, P.grid);
	drawEnv(S.ops[S.op], x + 4, y + 4, w - 8, h - 8, P.ops[S.op], true, false);
}

function gTune(x, y, w, h) {
	const o = S.ops[S.op];
	R(x, y, w, h, P.grid);
	T(o.mode ? "FIXED" : "RATIO", x + 6, y + 6, P.dim);
	T(ratioTxt(o), x + w / 2, y + 30, P.fg, 3, "c");
	T(
		ALG[S.alg].c.includes(S.op + 1) ? "CARRIER" : "MODULATOR",
		x + w - 6,
		y + 6,
		P.ops[S.op],
		1,
		"r",
	);
}

function gLevel(x, y, w, h) {
	const o = S.ops[S.op];
	R(x, y, w, h, P.grid);
	T("OUT LEVEL", x + 6, y + 8, P.dim);
	R(x + 6, y + 22, w - 12, 8, P.faint);
	R(x + 6, y + 22, Math.round(((w - 12) * o.lv) / 99), 8, P.ops[S.op]);
	T("VELOCITY SENS", x + 6, y + 44, P.dim);
	for (let i = 0; i < 8; i++) {
		const xx = x + 6 + i * 14;
		if (i <= o.kvs) {
			R(xx, y + 58, 10, 10, P.fg);
		} else {
			B(xx, y + 58, 10, 10, P.faint);
		}
	}
}

function gScale(x, y, w, h) {
	const o = S.ops[S.op];
	R(x, y, w, h, P.grid);
	const mid = y + h / 2,
		bx = x + Math.round((o.bp / 99) * w);
	DV(bx, y, h, P.acc, 2, 2);
	DH(x, mid, w, P.faint, 1, 3);
	const side = (dep, cur, dir) => {
		const s = cur < 2 ? 1 : -1,
			ex = cur === 1 || cur === 2;
		let py = mid;
		for (let i = 1; i <= Math.abs(dir > 0 ? x + w - bx : bx - x); i++) {
			const t = i / w,
				v = ex ? ((Math.exp(t * 4) - 1) / (Math.exp(4) - 1)) * 2 : t * 2,
				yy = clamp(Math.round(mid + ((s * v * dep) / 99) * (h / 2 - 4)), y + 2, y + h - 2),
				xx = bx + dir * i;
			L(xx - dir, py, xx, yy, P.ops[S.op]);
			py = yy;
		}
	};
	side(o.ld, o.lc, -1);
	side(o.rd, o.rc, 1);
	T(note(o.bp + 9), Math.min(bx + 3, x + w - 20), y + 4, P.acc);
}

function gPeg(x, y, w, h) {
	R(x, y, w, h, P.grid);
	const mid = y + h / 2,
		ly = (l) => Math.round(mid - ((l - 50) / 50) * (h / 2 - 4)),
		seg = (r) => 4 + Math.round(((100 - r) / 100) * 40);
	DH(x, mid, w, P.faint, 1, 3);
	let cx = x + 4,
		py = ly(S.pegL[3]);
	for (let i = 0; i < 3; i++) {
		const nx = cx + seg(S.pegR[i]),
			ny = ly(S.pegL[i]);
		L(cx, py, nx, ny, P.ops[1]);
		cx = nx;
		py = ny;
	}
	L(cx, py, cx + 40, py, P.ops[1]);
	const nx = cx + 40 + seg(S.pegR[3]);
	L(cx + 40, py, nx, ly(S.pegL[3]), P.ops[1]);
}

function gAlgMini(x, y, w, h) {
	R(x, y, w, h, P.grid);
	const md = Math.max(...Object.values(algLayout(S.alg, 0, 0, 30, 20).pos).map((q) => -q.y)) / 20;
	drawAlg(S.alg, x + w / 2 - 6, y + h - 18 - Math.round((60 - md * 20) / 2), 30, 20, 20, 11, true);
}

function gArp(x, y, w, h) {
	R(x, y, w, h, P.grid);
	let ns = [...A.arpSet].sort((a, b) => a - b);
	if (!ns.length) {
		ns = [60, 64, 67];
	}
	const pat = arpPattern(ns),
		lo = Math.min(...pat),
		hi = Math.max(...pat) + 1;
	for (let i = 0; i < 16; i++) {
		const nn = pat[i % pat.length],
			yy = y + h - 6 - Math.round(((nn - lo) / Math.max(1, hi - lo)) * (h - 12));
		R(x + 4 + i * 14, yy, Math.max(2, Math.round((12 * S.arp.gate) / 100)), 4, P.ops[3]);
	}
}

// the four parameters of a page as a 2 x 2 grid of cells with separators (the K number says which slider moves it).
// A cell shows its name, its value big, and a bar (or one block per choice for a short list). It lights while a finger is on it or
// it has just changed, with an arrow for the direction of the last change.
function paramGrid(p, now) {
	const cw = 120,
		ch = 39,
		y0 = 29;
	R(0, y0 + ch, 240, 1, P.faint);
	R(cw, y0, 1, ch * 2, P.faint);
	p.forEach((q, k) => {
		const cx = (k % 2) * cw + (k % 2 ? 1 : 0),
			cy = y0 + (k >> 1) * ch + (k >> 1);
		if (!q.l) {
			DH(cx + cw / 2 - 8, cy + ch / 2, 16, P.faint);
			return;
		}
		const lv = hotLevel(k, now),
			w = cw - 1;
		if (lv > 0.7) {
			R(cx, cy, w, ch, P.faint);
		}
		if (lv) {
			R(cx, cy, w, 2, P.acc);
		}
		T(q.l, cx + 7, cy + 6, lv ? P.acc : P.dim);
		T(String(k + 1), cx + w - 6, cy + 6, lv ? P.acc : P.faint, 1, "r");
		const d = lv ? hotDir(k) : 0;
		if (d) {
			const ax = cx + w - 24,
				ay = cy + 5;
			if (d > 0) {
				R(ax + 3, ay, 1, 1, P.acc);
				R(ax + 2, ay + 1, 3, 1, P.acc);
				R(ax + 1, ay + 2, 5, 1, P.acc);
				R(ax, ay + 3, 7, 1, P.acc);
			} else {
				R(ax, ay, 7, 1, P.acc);
				R(ax + 1, ay + 1, 5, 1, P.acc);
				R(ax + 2, ay + 2, 3, 1, P.acc);
				R(ax + 3, ay + 3, 1, 1, P.acc);
			}
		}
		const v = String(q.v),
			big = TW(v, 2) <= w - 14 ? 2 : 1;
		T(v, cx + 7, cy + (big === 2 ? 16 : 19), lv ? P.acc : P.fg, big);
		const bx = cx + 7,
			bw = w - 14,
			by = cy + ch - 6;
		if (q.st > 1 && q.st <= 8) {
			const n = q.st,
				g = 2,
				sw = Math.floor((bw - g * (n - 1)) / n);
			for (let i = 0; i < n; i++) {
				R(bx + i * (sw + g), by, sw, 3, i === q.si ? (lv ? P.acc : P.fg) : P.faint);
			}
		} else {
			R(bx, by, bw, 3, P.faint);
			R(bx, by, Math.round(bw * clamp(q.n, 0, 1)), 3, lv ? P.acc : P.fg);
		}
	});
}

SCR.pp = (now, live) => {
	const pg = ppPages(),
		i = clamp(S.ppPage, 0, pg.length - 1),
		cur = pg[i];
	T(cur.t, 6, 17, S.ppMode === "edit" ? P.ops[S.op] : P.acc);
	if (pg.length > 1) {
		if (pg.length <= 8) {
			for (let k = pg.length - 1, x = 232; k >= 0; k--, x -= 9) {
				if (k === i) {
					R(x - 6, 18, 7, 4, P.acc);
				} else {
					R(x - 6, 19, 7, 2, P.faint);
				}
			}
		} else {
			T(i + 1 + "/" + pg.length, 234, 17, P.dim, 1, "r");
		}
	}
	R(0, 28, 240, 1, P.faint);
	paramGrid(cur.p, now);
	if (cur.g) {
		cur.g(6, 110, 228, 88, now, live);
	}
};

// ---- stock dialogs ("Clear Step Turn the K3" etc.) ----
function openClearDlg() {
	if (dgOn()) {
		dgClearDlg();
		return;
	}
	S.pop = null;
	S.dlg = {
		t: "CLEAR",
		lines: [
			"CLEAR STEP TURN THE K3",
			"CLEAR PATTERN TURN THE K4",
			"CANCEL CLEAR TURN THE K2",
			"NEW SONG TURN THE K1",
		],
		k: ["NEW SONG", "CANCEL", "STEP", "PATTERN"],
		a: [
			() => {
				S.clr = 3;
				doClear();
			},
			null,
			() => {
				S.seq.st[S.seq.sel] = -1;
				S.toast = { s: "CLEARED", t: performance.now() };
			},
			() => {
				S.clr = 2;
				doClear();
			},
		],
	};
}

function openResetDlg() {
	S.pop = null;
	S.dlg = {
		t: "RESET",
		lines: ["RESET ALL PATCHES TURN THE K4", "CANCEL RESET TURN THE K1"],
		k: ["CANCEL", "", "", "RESET"],
		a: [null, null, null, resetAll],
	};
}

function resetAll() {
	USERP = {};
	try {
		localStorage.removeItem("mellow-user");
	} catch (e) {
		/* nothing to do */
	}
	for (let i = PRESETS.length - 1; i >= 0; i--) {
		if (PRESETS[i][1] === "USER") {
			favSet(PRESETS[i][0], false);
			PRESETS.splice(i, 1);
		}
	}
	[0, 5, 7, 8].forEach((p, t) => {
		S.tracks[t].pre = p;
		S._trk = t;
		applyPreset(p);
		if (engOf(t) === "FM") {
			adsrFromOps();
		}
	});
	S._trk = 0;
	bindTrack(0);
	S.pop = null;
	S.toast = { s: "SUCCESS", t: performance.now() };
}

function knobs() {
	if (S.dlg) {
		const D = S.dlg;
		return D.k.map((l, i) =>
			l
				? {
						l,
						v: "",
						n: 0,
						nu: !D.a[i],
						set: () => {
							const fn = D.a[i];
							S.dlg = null;
							S.dlgDone = true;
							if (fn) {
								fn();
							}
						},
					}
				: NONE,
		);
	}
	if (S.screen === "pp") {
		const pg = ppPages();
		return pg[clamp(S.ppPage, 0, pg.length - 1)].p;
	}
	return knobs0();
}

// ---- buttons, stock behaviour first ----
function press0(id) {
	if (S.dlg) {
		S.dlg = null;
		if (id !== "play" && id !== "rec") {
			return;
		}
	}
	if (S.screen === "boot") {
		S.screen = "home";
	}
	const pp = (m, pg) => {
			S.screen = "pp";
			S.ppMode = m;
			S.ppPage = pg || 0;
		},
		inPP = (m) => S.screen === "pp" && S.ppMode === m,
		msg = (s) => {
			S.pop = null;
			S.toast = { s, t: performance.now() };
		};
	switch (id) {
		case "fx":
			if (inPP("fx")) {
				S.ppPage = (S.ppPage + 1) % 7;
			} else {
				pp("fx");
			}
			return;
		case "env":
			if (engOf(S.trk) !== "FM" && engOf(S.trk) !== "ANA") {
				msg("ENV: FM AND ANALOG TRACKS");
				return;
			}
			pp("env");
			return; /* the other engines have no envelope to edit: say so instead of opening a page that changes nothing */
		case "lfo":
			if (engOf(S.trk) !== "FM") {
				msg("LFO: FM TRACKS ONLY");
				return;
			}
			if (inPP("lfo")) {
				S.ppPage = (S.ppPage + 1) % 2;
			} else {
				pp("lfo");
			}
			return;
		case "op":
			if (engOf(S.trk) !== "FM") {
				S.screen = ENGSCR[engOf(S.trk)];
				return;
			}
			if (inPP("edit")) {
				S.ppPage = (S.ppPage + 1) % 6;
			} else {
				pp("edit");
			}
			return;
		case "global":
			if (inPP("glob")) {
				if (S.ppPage < ppPages().length - 1) {
					S.ppPage++;
				} else {
					S.screen = "mix";
				}
			} else {
				pp("glob");
			}
			return;
		case "arp":
			if (!S.arp.on) {
				S.arp.on = true;
				A.arps.forEach((x) => x.clear());
				A.arpKeys = {};
				pp("arp");
				return;
			}
			if (inPP("arp")) {
				if (S.ppPage === 0) {
					S.ppPage = 1;
				} else {
					S.screen = "gen";
				}
				return;
			}
			if (S.screen === "gen") {
				S.arp.on = false;
				A.arps.forEach((x) => x.clear());
				A.arpKeys = {};
				S.screen = "home";
				msg("ARP OFF");
				return;
			}
			pp("arp");
			return;
		case "seq":
			if (nestOn()) {
				nestCollapse();
				return;
			}
			if (S.screen === "song") {
				S.screen = "seq";
				S.seqPage = 0;
				return;
			}
			if (!S.seqEn) {
				S.seqEn = true;
				S.seqPage = 0;
				S.screen = "seq";
				return;
			}
			if (S.screen === "seq") {
				if (S.seqPage < 4) {
					S.seqPage++;
				} else {
					S.seqEn = false;
					S.rec = false;
					if (S.playing) {
						S.playing = false;
						stopSeq();
					}
					S.screen = "home";
					msg("SEQ OFF");
				}
				return;
			}
			S.screen = "seq";
			return;
		case "song" /* the SONG button: opens the song screen; again goes back to the sequencer (or home when it is off) */:
			if (nestOn()) {
				nestCollapse();
				return;
			}
			if (S.screen === "song") {
				if (S.seqEn) {
					S.screen = "seq";
					S.seqPage = 0;
				} else {
					S.screen = "home";
				}
				return;
			}
			songOpen();
			return;
		case "play":
			if (!S.seqEn && !S.playing) {
				msg("ENABLE SEQ FIRST: PRESS SEQ");
				return;
			}
			break;
		case "mixer":
			S.screen = S.screen === "mix" ? "home" : "mix";
			return;
		case "browser" /* the presets screen with its categories; pressing it again jumps to the USER tab (what you saved) and back to ALL */:
			if (S.screen !== "presets") {
				S.screen = "presets";
				return;
			}
			{
				const u = CATS.indexOf("USER");
				S.pcat = S.pcat === u ? 0 : u;
				msg(S.pcat === u ? "YOUR SAVED PRESETS" : "ALL PRESETS");
			}
			return;
		case "settings":
			if (SET.open) {
				closeSettings();
			} else {
				openSettings();
			}
			return;
		case "key" /* KEY: opens the scale screen and lights the scale on the keys; pressed again on that screen it switches the lights off and leaves */:
			if (S.screen === "scale") {
				S.screen =
					KEYFROM && KEYFROM !== "scale" && KEYFROM !== "pp" && SCR[KEYFROM] ? KEYFROM : "home";
				return;
			}
			KEYFROM = S.screen;
			S.screen = "scale";
			return;
		case "hold": {
			const on = holdToggle();
			msg(on ? "HOLD ON: KEYS KEEP SOUNDING" : "HOLD OFF");
			return;
		}
		case "queue":
		case "strip":
			qsToggle(id);
			return; /* QUEUE and STRIP: a screen of their own (like MIXER): tap opens it, tap again goes back to where you were */
	}
	press0old(id);
}

function ledOn(id) {
	if (id === "hold") {
		return !!HOLD[S.trk];
	}
	if (id === "queue") {
		return !!QS.on || inQS("queue");
	}
	if (id === "strip") {
		return MOD.t !== 0 || aActive(stripId(0)) || inQS("strip");
	}
	if (id === "key") {
		return S.screen === "scale" || keyMode() > 0;
	}
	if (id === "settings") {
		return SET.open;
	}
	if (id === "mixer") {
		return S.screen === "mix";
	}
	if (id === "browser") {
		return S.screen === "presets";
	}
	if (id === "play") {
		return S.playing;
	}
	if (id === "rec") {
		return S.rec;
	}
	if (id === "arp") {
		return S.arp.on;
	}
	if (id === "seq") {
		return S.seqEn;
	}
	if (id === "song") {
		return S.screen === "song" || !!S.song.on;
	}
	if (S.screen === "pp") {
		return (
			id ===
			{ fx: "fx", env: "env", lfo: "lfo", edit: "op", pit: "op", voice: "op", glob: "global" }[
				S.ppMode
			]
		);
	}
	const m = { home: ["home", "scape"], save: ["save"], op: ["ana", "wt", "smp", "drum"] }[id];
	return !!(m && m.includes(S.screen));
}

function blackLit(i) {
	const pp = S.screen === "pp" && ["edit", "pit", "voice"].includes(S.ppMode);
	if (!pp && S.screen !== "alg") {
		return false;
	}
	if (i < 6) {
		return (S.screen === "alg" || S.ppMode === "edit") && i === S.op;
	}
	if (!pp) {
		return false;
	}
	if (i === 6) {
		return S.ppMode === "pit";
	}
	if (i === 7) {
		return S.ppMode === "voice";
	}
	if (i === 8) {
		return S.mono;
	}
	if (i === 9) {
		return !S.mono;
	}
	return false;
}

adsrFromOps();
