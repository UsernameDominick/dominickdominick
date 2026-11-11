// data tables: scales, names, step defaults
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-unused-vars, no-undef -- offers names the other files use; uses names that live in the other files of the folder */

// ---------- data ----------
// algorithms are derived from the real DX7 routing flags (patch slot k holds OP(6-k))
const ALG = [null].concat(
	DX7.ALGS.map((f) => {
		const bus = [[], [], []],
			e = [],
			c = [];
		let fb = 6;
		for (let k = 0; k < 6; k++) {
			const fl = f[k],
				inb = (fl >> 4) & 3,
				outb = fl & 3,
				add = (fl & 4) !== 0;
			if (inb) {
				bus[inb].forEach((m) => e.push([6 - m, 6 - k]));
			}
			if (outb === 0) {
				c.push(6 - k);
			} else if (add) {
				bus[outb].push(k);
			} else {
				bus[outb] = [k];
			}
			if (fl & 0x80) {
				fb = 6 - k;
			}
		}
		return { c: c.sort((x, y) => x - y), e, f: fb };
	}),
);

const PRESETS = [
	["GLASS KEYS", "KEYS", "FM", 5],
	["DUSTY EP", "LOFI", "FM", 5],
	["LULLABY", "LOFI", "FM", 17],
	["MOON PORCH", "AMBIENT", "WAVE"],
	["SLOW TIDE", "AMBIENT", "ANA"],
	["WARM PAD", "PAD", "ANA"],
	["RAIN GLASS", "AMBIENT", "WAVE"],
	["VINYL LOOP", "LOFI", "SMP"],
	["DUSTY KIT", "DRUMS", "DRUM"],
	["SUB PLUCK", "BASS", "FM", 1],
	["CHIME PAD", "PAD", "FM", 22],
	["MALLETS", "AMBIENT", "FM", 7],
	["SOFT SAW", "PAD", "ANA"],
	["NIGHTBELL", "AMBIENT", "FM", 2],
	["BRUSH KIT", "DRUMS", "DRUM"],
	["TUBE FLUTE", "KEYS", "FM", 19],
	["ICE ORGAN", "KEYS", "FM", 32],
	["GLOW BASS", "BASS", "ANA"],
	["SOFT EP", "LOFI", "FM", 5],
	["MUDDY EP", "LOFI", "FM", 5],
	["DUSTY HARP", "LOFI", "FM", 7],
	["OLD RADIO", "LOFI", "FM", 31],
	["WURLY BITE", "KEYS", "FM", 5],
	["TINE PIANO", "KEYS", "FM", 5],
	["SOFT CLAV", "KEYS", "FM", 6],
	["ROUND BASS", "BASS", "FM", 1],
	["RUBBERBASS", "BASS", "FM", 18],
	["SOFT BASS", "BASS", "FM", 14],
	["STRINGS", "PAD", "FM", 21],
	["CHOIR", "PAD", "FM", 22],
	["SUNSET PAD", "PAD", "FM", 25],
	["SHIMMER", "PAD", "FM", 19],
	["SNOW GLOBE", "AMBIENT", "FM", 5],
	["MUSIC BOX", "AMBIENT", "FM", 5],
	["CHIMES", "AMBIENT", "FM", 32],
	["DEEP DRONE", "AMBIENT", "FM", 25],
	["DREAM HARP", "AMBIENT", "FM", 6],
	["HAZE", "AMBIENT", "FM", 31],
];

const CATS = ["ALL", "LOFI", "AMBIENT", "KEYS", "BASS", "PAD", "DRUMS", "DEVICE", "USER", "FAV"];
// DEVICE lists only the presets that ship on the FM-1; the rest are phone-only (PHONEP)
const ENGN = { FM: "FM", ANA: "ANALOG", WAVE: "WAVETABLE", SMP: "SAMPLER", DRUM: "DRUMS" },
	ENGL = { FM: "FM", ANA: "ANALOG", WAVE: "WAVE", SMP: "SAMPLE", DRUM: "DRUMS" },
	ENGSH = { FM: "FM", ANA: "ANA", WAVE: "WAV", SMP: "SMP", DRUM: "DRM" };

const ENGS = Object.keys(ENGN),
	ENGSCR = { FM: "op", ANA: "ana", WAVE: "wt", SMP: "smp", DRUM: "drum" },
	ENGCOL = { FM: 0, ANA: 1, WAVE: 3, SMP: 2, DRUM: 4 };

const PADS = ["KICK", "SNARE", "HAT", "OPEN", "CLAP", "RIM", "SHAKER", "PERC"],
	SHP = ["SAW", "SQUARE", "TRI", "SINE"];

const SMAX = 128;
/* a pattern can be up to 8 bars (128 steps) long; only the first 16 x its length in bars is played and shown */
const emptyPat = () =>
	[0, 1, 2, 3].map((_, t) => ({
		sel: 0,
		st: Array(SMAX).fill(-1),
		gate: Array(SMAX).fill(50),
		vel: Array(SMAX).fill(100),
		...(t === 3 ? { dg: new Uint8Array(8 * SMAX) } : {}),
	}));
/* T4 (the drum track) also carries its drum grid: 8 pads x SMAX steps of velocity, 0 = no hit */
const hsh = (n) => {
	const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
	return x - Math.floor(x);
};

const A = {
	on: false,
	muted: false,
	rms: 0,
	trRms: [0, 0, 0, 0],
	bedRms: 0,
	buf: new Float32Array(2048),
	heard: new Array(12).fill(0),
	bnd: [0, 0, 0, 0],
	bndU: [0, 0, 0, 0],
	bndC: [0, 0, 0, 0],
	bendCs: [null, null, null, null],
	bdS: [new Set(), new Set(), new Set(), new Set()],
	bendOn: [false, false, false, false],
	bendT: [0, 0, 0, 0],
	get bend() {
		return this.bnd[S._trk];
	},
	q: [0, 1, 2, 3].map(() => ({
		pend: [],
		live: [],
		cyc: [],
		log: [],
		gap: null,
		nextT: 0,
		holdUntil: 0,
		started: false,
		lastUse: -99,
	})),
	arps: [new Set(), new Set(), new Set(), new Set()],
	get arpSet() {
		return this.arps[S.trk];
	},
	arpNext: [0, 0, 0, 0],
	ais: [0, 0, 0, 0],
	seqV: [],
	vox: [[], [], [], []],
	irTok: 0,
	irReady: false,
	fm: [null, null, null, null],
	fmMode: "",
	fmw: null,
	fmStat: null,
	fmPending: [],
	fmTune: 0,
	smpLast: [],
	down: 0,
	sn: 0,
	t0: 0,
	an0: 0,
	ai: 0,
	gk: 0,
	gA: 0,
	tk: 0,
};

const NN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// the site's nav bar sits above the app: the app has the window's height minus the bar's
function navHeight() {
	const nav = document.querySelector(".navContainer");
	return nav ? nav.offsetHeight : 0;
}

const note = (m) => NN[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

const WH = [53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79],
	BL = [54, 56, 58, 61, 63, 66, 68, 70, 73, 75, 78];

const BLL = ["OP1", "OP2", "OP3", "OP4", "OP5", "OP6", "PIT", "GLO", "MONO", "POLY", ""];

const SCALES = [
	["MAJOR", [0, 2, 4, 5, 7, 9, 11]],
	["MINOR", [0, 2, 3, 5, 7, 8, 10]],
	["DORIAN", [0, 2, 3, 5, 7, 9, 10]],
	["PHRYGIAN", [0, 1, 3, 5, 7, 8, 10]],
	["LYDIAN", [0, 2, 4, 6, 7, 9, 11]],
	["MIXOLYD", [0, 2, 4, 5, 7, 9, 10]],
	["PENTA", [0, 2, 4, 7, 9]],
	["BLUES", [0, 3, 5, 6, 7, 10]],
	["CHROMA", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
];

const LFOW = ["TRI", "SAW-", "SAW+", "SQR", "SIN", "S/H"];

const CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.";

const mkop = (co, lv, Rr, Ll) => ({
	co,
	fi: 0,
	de: 0,
	lv,
	R: Rr,
	L: Ll,
	bp: 39,
	ld: 0,
	rd: 0,
	lc: 0,
	rc: 0,
	rs: 0,
	ams: 0,
	kvs: 2,
});

const S = {
	screen: "home",
	theme: "dusk",
	alg: 5,
	fb: 6,
	sync: 1,
	tr: 0,
	op: 2,
	ops: [
		mkop(1, 99, [96, 25, 25, 67], [99, 75, 0, 0]),
		mkop(2, 58, [95, 50, 35, 78], [99, 75, 0, 0]),
		mkop(1, 99, [95, 20, 20, 50], [99, 95, 0, 0]),
		mkop(1, 89, [95, 29, 20, 50], [99, 95, 0, 0]),
		mkop(1, 99, [95, 20, 20, 50], [99, 95, 0, 0]),
		mkop(1, 79, [95, 29, 20, 50], [99, 95, 0, 0]),
	],
	mac: [0, 70, 45, 30],
	lfo: { w: 0, sp: 35, pm: 10, am: 0, dl: 0, ps: 3, sy: 1 },
	fx: {
		slot: 0,
		ft: 0,
		cut: 104,
		res: 30,
		fmix: 100,
		wow: 0,
		flu: 0,
		drv: 0,
		dust: 0,
		et: 1,
		efb: 42,
		etone: 36,
		emix: 8,
		rt: 3,
		size: 72,
		damp: 46,
		rmix: 10,
	},
	arp: { mode: 0, rate: 3, oct: 2, gate: 60, on: false },
	scale: { root: 2, type: 2, chord: 0, spread: 1, hl: 0, only: 0 },
	glob: {
		mmode: 0,
		mclk: 0,
		akey: 0,
		sel: 1,
		ch: 1,
		out: 0,
		bt: 1,
		vel: 1,
		km: 1,
		bri: 80,
		sleep: 2,
		tune: 440,
		fade: 0,
		night: 1,
	},
	save: { cur: 4, name: "GLASS KEYS", slot: 17 },
	pat: 0,
	patNext: -1,
	plen: Array(16).fill(1),
	ts: 2,
	gu: 0,
	snap: 0,
	recExt: false,
	seqPage: 0,
	rate: 1,
	sgate: 100,
	swing: 50,
	clr: 0,
	bpm: 120,
	playing: false,
	t0: 0,
	rec: false,
	oct: 0,
	envPage: 0,
	vol: 72,
	hits: [],
	pop: null,
	hot: null,
	toast: null,
};

S.ops[2].co = 1;

S.ops[3].co = 1;

S.ops[0].fi = 0;

S.ops[4].co = 1;

S.ops[5].co = 1;

S.tracks = [
	{ pre: 0, vol: 84 },
	{ pre: 5, vol: 66 },
	{ pre: 7, vol: 58 },
	{ pre: 8, vol: 72 },
];

S._trk = 0;

Object.defineProperty(S, "trk", {
	get() {
		return S._trk;
	},
	set(v) {
		if (v !== S._trk) {
			S._trk = v;
			if (S.tk) {
				bindTrack(v);
			}
			if (S.screen === "song" && !nestOn()) {
				songToSeq();
			}
		}
	},
});

Object.defineProperty(S, "preset", {
	get() {
		return S.tracks[S.trk].pre;
	},
	set(v) {
		S.tracks[S.trk].pre = v;
	},
});

S.scape = [
	{ n: "RAIN", lv: 0 },
	{ n: "VINYL", lv: 0 },
	{ n: "OCEAN", lv: 0 },
	{ n: "FIRE", lv: 0 },
];

S.ana = { w1: 0, w2: 1, cut: 78, res: 24, det: 12, atk: 40, rel: 60 };

S.wt = { pos: 52, warp: 28, drv: 20, tone: 64 };

S.smp = { slice: 2, st: 0, pitch: 0, dir: 0 };

// S.drum.vo: the kit's voicing (8 pads x 8 nibbles 0-15, see drumHit); null = the original fixed voices
S.drum = {
	sel: 1,
	tune: [58, 50, 46, 46, 50, 55, 52, 40],
	dec: [38, 40, 14, 40, 38, 12, 25, 30],
	crush: [40, 42, 25, 28, 38, 40, 30, 35],
	vo: null,
};

S.gen = { den: 38, rng: 3, evo: 20, hum: 40, on: false, t0: 0 };

S.padHits = [];

const engOf = (i) => PRESETS[S.tracks[i].pre][2];

const slp = () => [0, 15, 30, 60][S.glob.fade];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const wrap = (v, n) => ((v % n) + n) % n;

const pad = (n, w = 2) => String(n).padStart(w, "0");
