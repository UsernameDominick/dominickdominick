// what each knob does on each page
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-unused-vars, no-undef -- offers names the other files use; uses names that live in the other files of the folder */

// ---------- knob definitions per page ----------
// PROTOTYPE ONLY: double-tap a dial (or its column on the screen) to put that parameter back to its default.
// A default is the value the project started with, or for sound parameters (operators, envelopes, LFO, filter, wave...)
// the value the current preset loaded with. It only sets the value turning the dial would reach, so it needs no new
// hardware control. (The device's encoders turn; they have no double-tap.)
const PRESET_KEYS = [
	"ops",
	"alg",
	"fb",
	"sync",
	"tr",
	"lfo",
	"pegR",
	"pegL",
	"ana",
	"wt",
	"smp",
	"drum",
];

let PB = null,
	PATHS = new WeakMap();

// Each track has its OWN sound, macros, effects settings, arpeggiator, scale and mono switch (S.tk[t]); S.ops, S.fx, S.mac, ... are windows onto the selected track's
// (accessors on S, set up below), so every screen, knob and graph edits the selected track, and the engines read TK(t) for the track they play.
const TKK = [
	"ops",
	"alg",
	"fb",
	"sync",
	"tr",
	"lfo",
	"pegR",
	"pegL",
	"adsr",
	"ana",
	"wt",
	"smp",
	"drum",
	"fx",
	"mac",
	"arp",
	"scale",
	"mono",
];

const TK = (t) => S.tk[t == null ? S._trk : t];

let PBK = [null, null, null, null];

function bindTrack(t) {
	PB = PBK[t];
	PATHS = new WeakMap();
}
// the track changed: what RESET goes back to (its preset's values) and the path cache follow
function snapBase() {
	PB = JSON.parse(JSON.stringify(Object.fromEntries(PRESET_KEYS.map((k) => [k, S[k]]))));
	PBK[S._trk] = PB;
}

function pathOf(obj) {
	if (PATHS.has(obj)) {
		return PATHS.get(obj);
	}
	let found = null;
	const walk = (o, p, d) => {
		if (found || d > 4 || !o || typeof o !== "object") {
			return;
		}
		if (o === obj) {
			found = p;
			return;
		}
		for (const k of Object.keys(o)) {
			walk(o[k], p.concat(k), d + 1);
			if (found) {
				return;
			}
		}
	};
	for (const k of Object.keys(S)) {
		walk(S[k], [k], 0);
		if (found) {
			break;
		}
	}
	PATHS.set(obj, found);
	return found;
}

function dfl(o, k) {
	const p = pathOf(o);
	if (!p) {
		return;
	}
	const root = PB && PRESET_KEYS.includes(p[0]) ? PB : S0;
	let v = root[p[0]];
	for (let i = 1; i < p.length && v != null; i++) {
		v = v[p[i]];
	}
	if (v == null || v[k] == null) {
		v = S0[p[0]] && p.slice(1).reduce((a, x) => (a == null ? a : a[x]), S0[p[0]]);
	}
	if (v != null && v[k] != null) {
		o[k] = v[k];
	}
}

const NUM = (l, o, k, a, b, f) => ({
	ref: [o, k, a, b],
	l,
	v: f ? f(o[k]) : String(o[k]),
	n: (o[k] - a) / (b - a),
	r: b - a,
	st: b - a <= 7 ? b - a + 1 : 0,
	si: o[k] - a,
	sn: o[k],
	set: (d) => (o[k] = clamp(o[k] + d, a, b)),
	rs: () => dfl(o, k),
});

const CH = (l, o, k, list) => ({
	ref: [o, k, 0, list.length - 1],
	l,
	v: list[o[k]],
	n: o[k] / Math.max(1, list.length - 1),
	r: list.length,
	st: list.length,
	si: o[k],
	sn: o[k] + 1,
	set: (d) => (o[k] = wrap(o[k] + d, list.length)),
	rs: () => dfl(o, k),
});

const NONE = { l: "", v: "", n: 0, set: null };

const GROWS = [
	["MIDI CHANNEL", (g) => String(g.ch), (g, d) => (g.ch = clamp(g.ch + d, 1, 16))],
	[
		"MIDI OUT",
		(g) => ["USB+BLE", "USB", "BLE", "OFF"][g.out],
		(g, d) => (g.out = wrap(g.out + d, 4)),
	],
	["MIDI MODE", (g) => ["OMNI", "TRACKS"][g.mmode], (g, d) => (g.mmode ^= 1)],
	["MIDI CLOCK", (g) => ["OFF", "OUT"][g.mclk], (g, d) => (g.mclk ^= 1)],
	["MIDI PORTS", (g) => midiStatus(), () => {}],
	["BLUETOOTH", (g) => (g.bt ? "ON" : "OFF"), (g, d) => (g.bt ^= 1)],
	[
		"VELOCITY",
		(g) => ["SOFT", "MEDIUM", "HARD", "FIXED"][g.vel],
		(g, d) => (g.vel = wrap(g.vel + d, 4)),
	],
	["KNOB PICKUP", (g) => ["JUMP", "CATCH"][g.km], (g, d) => (g.km ^= 1)],
	["BRIGHTNESS", (g) => g.bri + "%", (g, d) => (g.bri = clamp(g.bri + d * 10, 10, 100))],
	[
		"AUTO SLEEP",
		(g) => ["OFF", "5 MIN", "10 MIN", "30 MIN"][g.sleep],
		(g, d) => (g.sleep = wrap(g.sleep + d, 4)),
	],
	["TUNING", (g) => "A " + g.tune, (g, d) => (g.tune = clamp(g.tune + d, 430, 450))],
	[
		"SLEEP FADE",
		(g) => ["OFF", "15 MIN", "30 MIN", "60 MIN"][g.fade],
		(g, d) => {
			g.fade = wrap(g.fade + d, 4);
			S.sleepT0 = performance.now();
		},
	],
	["NIGHT MODE", (g) => ["OFF", "AUTO", "ON"][g.night], (g, d) => (g.night = wrap(g.night + d, 3))],
	["AUTO KEY", (g) => (g.akey ? "ON" : "OFF"), (g, d) => (g.akey = d > 0 ? 1 : 0)],
	["METRONOME", (g) => (g.metro ? "ON" : "OFF"), (g, d) => (g.metro ^= 1)],
	["RECORD MODE", (g) => ["OVERDUB", "REPLACE"][g.rmode], (g, d) => (g.rmode ^= 1)],
	["COUNT-IN", (g) => ["OFF", "1 BAR", "2 BARS"][g.cin], (g, d) => (g.cin = wrap(g.cin + d, 3))],
	["RECORD AUTOMATION", (g) => (g.arec ? "ON" : "OFF"), (g, d) => (g.arec ^= 1)],
	["RECORD LENGTH", (g) => (g.rlen ? "GROWS" : "LOOPS"), (g, d) => (g.rlen ^= 1)],
	["FIRMWARE", (g) => "0.1 DEV", () => {}],
];

function knobs0() {
	const s = S.screen,
		o = S.ops[S.op];
	if (s === "home") {
		return [
			NUM("MOOD", S.mac, 0, 0, 127),
			NUM("WARMTH", S.mac, 1, 0, 127),
			NUM("SPACE", S.mac, 2, 0, 127),
			NUM("DRIFT", S.mac, 3, 0, 127),
		];
	}
	if (s === "presets") {
		return [
			{
				l: "FAV",
				st: 2,
				si: isFav() ? 1 : 0,
				sn: isFav() ? 2 : 1,
				v: isFav() ? "YES" : "NO",
				n: isFav() ? 1 : 0,
				set: (d) => favSet(PRESETS[S.preset][0], d > 0),
			},
			{
				l: "SORT",
				st: 2,
				si: S.psort,
				sn: S.psort + 1,
				v: ["NUMBER", "A-Z"][S.psort],
				n: S.psort,
				set: () => (S.psort ^= 1),
			},
			{
				l: "AUDITION",
				st: 2,
				si: S.paud ? 1 : 0,
				sn: S.paud ? 2 : 1,
				v: S.paud ? "ON" : "OFF",
				n: S.paud,
				set: (d) => (S.paud = d > 0 ? 1 : 0),
			},
			{
				l: "GROUP",
				st: 2,
				si: pcol()[PRESETS[S.preset][1]] ? 1 : 0,
				sn: pcol()[PRESETS[S.preset][1]] ? 2 : 1,
				v: pcol()[PRESETS[S.preset][1]] ? "SHUT" : "OPEN",
				n: pcol()[PRESETS[S.preset][1]] ? 1 : 0,
				set: (d) => {
					const c = PRESETS[S.preset][1];
					if (!!pcol()[c] !== d > 0) {
						togglePGroup(c);
					}
				},
			},
		];
	}
	if (s === "alg") {
		return [
			{
				l: "ALGORITHM",
				v: pad(S.alg),
				n: (S.alg - 1) / 31,
				set: (d) => (S.alg = wrap(S.alg - 1 + d, 32) + 1),
			},
			NUM("FEEDBACK", S, "fb", 0, 7),
			{
				l: "OSC SYNC",
				st: 2,
				si: S.sync ? 1 : 0,
				sn: S.sync ? 2 : 1,
				v: S.sync ? "ON" : "OFF",
				n: S.sync,
				set: () => (S.sync ^= 1),
			},
			NUM("TRANSPOSE", S, "tr", -24, 24, (v) => note(60 + v)),
		];
	}
	if (s === "op") {
		return [
			NUM("COARSE", o, "co", 0, 31, (v) => (v ? String(v) : "0.5")),
			NUM("FINE", o, "fi", 0, 99),
			NUM("DETUNE", o, "de", -7, 7, (v) => (v > 0 ? "+" : "") + v),
			NUM("LEVEL", o, "lv", 0, 99),
		];
	}
	if (s === "env") {
		const a = S.envPage ? o.L : o.R,
			p = S.envPage ? "L" : "R";
		return [0, 1, 2, 3].map((i) => NUM(p + (i + 1), a, i, 0, 99));
	}
	if (s === "lfo") {
		return [
			CH("WAVE", S.lfo, "w", LFOW),
			NUM("SPEED", S.lfo, "sp", 0, 99),
			NUM("PITCH", S.lfo, "pm", 0, 99),
			NUM("AMP", S.lfo, "am", 0, 99),
		];
	}
	if (s === "fx") {
		const f = S.fx;
		return [
			[
				CH("TYPE", f, "ft", ["LOW PASS", "BAND", "HIGH PASS"]),
				NUM("CUTOFF", f, "cut", 0, 127, hz),
				NUM("RESO", f, "res", 0, 99),
				NUM("MIX", f, "fmix", 0, 100, (v) => v + "%"),
			],
			[
				NUM("WOW", f, "wow", 0, 99),
				NUM("FLUTTER", f, "flu", 0, 99),
				NUM("DRIVE", f, "drv", 0, 99),
				NUM("DUST", f, "dust", 0, 99),
			],
			[
				CH("TIME", f, "et", ["1/8", "1/4", "3/8", "1/2"]),
				NUM("FEEDBACK", f, "efb", 0, 99),
				NUM("TONE", f, "etone", 0, 99, (v) => (v < 34 ? "DARK" : v < 67 ? "WARM" : "BRIGHT")),
				NUM("MIX", f, "emix", 0, 100, (v) => v + "%"),
			],
			[
				CH("TYPE", f, "rt", ["HALL", "ROOM", "PLATE", "SHIMMER"]),
				NUM("SIZE", f, "size", 0, 99),
				NUM("DAMP", f, "damp", 0, 99),
				NUM("MIX", f, "rmix", 0, 100, (v) => v + "%"),
			],
		][f.slot];
	}
	if (s === "mix") {
		return S.tracks.map((t, i) => ({
			l: "T" + (i + 1) + " " + ENGSH[engOf(i)],
			v: t.vol + "%",
			n: t.vol / 100,
			set: (d) => (t.vol = clamp(t.vol + d * 3, 0, 100)),
			rs: () => dfl(t, "vol"),
		}));
	}
	if (s === "scape") {
		return S.scape.map((l) => ({
			l: l.n,
			v: l.lv + "%",
			n: l.lv / 100,
			set: (d) => (l.lv = clamp(l.lv + d * 3, 0, 100)),
			rs: () => dfl(l, "lv"),
		}));
	}
	if (s === "ana") {
		return [
			NUM("CUTOFF", S.ana, "cut", 0, 127, hz),
			NUM("RESO", S.ana, "res", 0, 99),
			NUM("DETUNE", S.ana, "det", 0, 99),
			NUM("ATTACK", S.ana, "atk", 0, 99),
		];
	}
	if (s === "wt") {
		return [
			NUM("POSITION", S.wt, "pos", 0, 127),
			NUM("WARP", S.wt, "warp", 0, 99),
			NUM("DRIVE", S.wt, "drv", 0, 99),
			NUM("TONE", S.wt, "tone", 0, 99),
		];
	}
	if (s === "smp") {
		return [
			{
				l: "SLICE",
				st: 8,
				si: S.smp.slice,
				sn: S.smp.slice + 1,
				v: S.smp.slice + 1 + "/8",
				n: S.smp.slice / 7,
				set: (d) => (S.smp.slice = clamp(S.smp.slice + d, 0, 7)),
			},
			NUM("START", S.smp, "st", 0, 99),
			NUM("PITCH", S.smp, "pitch", -12, 12, (v) => (v > 0 ? "+" : "") + v),
			CH("DIRECTION", S.smp, "dir", ["FWD", "REV", "PING"]),
		];
	}
	if (s === "drum") {
		const D = S.drum,
			i = D.sel;
		return [
			{
				l: "PAD",
				st: 8,
				si: i,
				sn: i + 1,
				v: PADS[i],
				n: i / 7,
				set: (d) => (D.sel = clamp(D.sel + d, 0, 7)),
			},
			NUM("TUNE", D.tune, i, 0, 99),
			NUM("DECAY", D.dec, i, 0, 99),
			NUM("CRUSH", D.crush, i, 0, 99),
		];
	}
	if (s === "gen") {
		return [
			NUM("DENSITY", S.gen, "den", 0, 99, (v) => v + "%"),
			NUM("RANGE", S.gen, "rng", 1, 4, (v) => v + " OCT"),
			NUM("EVOLVE", S.gen, "evo", 0, 99, (v) => v + "%"),
			NUM("HUMANIZE", S.gen, "hum", 0, 99, (v) => v + "%"),
		];
	}
	if (s === "arp") {
		return [
			CH("MODE", S.arp, "mode", ["UP", "DOWN", "UP/DN", "RANDOM", "ORDER", "CHORD"]),
			CH("RATE", S.arp, "rate", ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"]),
			NUM("OCTAVES", S.arp, "oct", 1, 4),
			NUM("GATE", S.arp, "gate", 5, 100, (v) => v + "%"),
		];
	}
	if (s === "seq" && S.seqPage === 0) {
		const cp = S.patNext >= 0 ? S.patNext : S.pat;
		return [
			{
				l: "PATTERN",
				nu: 1,
				st: 16,
				si: cp,
				sn: cp + 1,
				v: pad(cp + 1),
				n: cp / 15,
				set: (d) => {
					if (S.playing && S.song.on && S.song.go && !NEST.pv) {
						toast("SONG IS ON: THE CHAIN PICKS THE PATTERN");
						S.dlgDone = true;
						return;
					}
					const nx = clamp(cp + d, 0, 15);
					if (S.playing) {
						S.patNext = nx === S.pat ? -1 : nx;
					} else {
						S.pat = nx;
						S.patNext = -1;
					}
				},
			},
			{ l: "CLEAR", nu: 1, v: "---", n: 0, set: () => openClearDlg() },
			{
				l: "RATE",
				st: 3,
				si: S.rate,
				sn: S.rate + 1,
				v: ["1/8", "1/16", "1/32"][S.rate],
				n: S.rate / 2,
				set: (d) => (S.rate = clamp(S.rate + d, 0, 2)),
			},
			{
				l: "TEMPO",
				v: String(S.bpm),
				n: (S.bpm - 30) / 270,
				set: (d) => (S.bpm = clamp(S.bpm + d, 30, 300)),
			},
		];
	}
	if (s === "seq" && dgOn() && S.seqPage === 1) {
		return dgKnobs2();
	} /* the drum grid's 2/2 page: FILL in place of GATE (hits are one-shots, so a gate does nothing there) */
	if (s === "seq" && S.seqPage === 1) {
		return [
			{
				l: "GATE",
				v: S.sgate + "%",
				n: (S.sgate - 20) / 80,
				set: (d) => (S.sgate = clamp(S.sgate + d * 5, 20, 100)),
			},
			{
				l: "SWING",
				v: S.swing + "%",
				n: (S.swing - 50) / 25,
				set: (d) => (S.swing = clamp(S.swing + d, 50, 75)),
			},
			{ l: "UNDO", nu: 1, v: UND.u.length + " LEFT", n: UND.u.length ? 1 : 0, set: () => undo() },
			{ l: "REDO", nu: 1, v: UND.r.length + " LEFT", n: UND.r.length ? 1 : 0, set: () => redo() },
		];
	}
	if (s === "seq" && S.seqPage === 4) {
		const mb = maxBars(),
			tl = S.tl[S.pat][S.trk],
			eff = tbars();
		return [
			{
				l: "TRACK",
				nu: 1,
				st: 4,
				si: S.trk,
				sn: S.trk + 1,
				v: "T" + (S.trk + 1) + " " + ENGN[engOf(S.trk)],
				n: S.trk / 3,
				set: (d) => {
					S.trk = wrap(S.trk + d, 4);
				},
			},
			{
				l: "LENGTH",
				st: mb + 1,
				si: tl,
				sn: tl + 1,
				v: tl ? tl + (tl > 1 ? " BARS" : " BAR") : "FOLLOW " + S.plen[S.pat],
				n: mb ? tl / mb : 0,
				set: (d) => setTrackLen(tl + d),
			},
			{ l: "IN THE PATTERN", v: eff === S.plen[S.pat] ? "IN STEP" : "POLY", n: 0, set: null },
			NONE,
		];
	}
	if (s === "seq" && S.seqPage === 3) {
		const L = S.plen[S.pat],
			mb = maxBars();
		return [
			{
				l: "LENGTH",
				st: mb,
				si: L - 1,
				sn: L,
				v: L + (L > 1 ? " BARS" : " BAR"),
				n: mb > 1 ? (L - 1) / (mb - 1) : 0,
				set: (d) => setLen(L + d),
			},
			{
				l: "TIME SIG",
				st: TSIGS.length,
				si: S.ts,
				sn: S.ts + 1,
				v: tsName(),
				n: S.ts / (TSIGS.length - 1),
				set: (d) => setSig(S.ts + d),
			},
			{
				l: "GRID",
				st: 3,
				si: S.gu,
				sn: S.gu + 1,
				v: GUN[S.gu],
				n: S.gu / 2,
				set: (d) => {
					S.gu = clamp(S.gu + d, 0, 2);
					applyGrid();
				},
			},
			{
				l: "SNAP",
				st: 2,
				si: S.snap,
				sn: S.snap + 1,
				v: S.snap ? "TO " + GUN[S.gu] : "OFF",
				n: S.snap,
				set: (d) => {
					S.snap = d > 0 ? 1 : 0;
				},
			},
		];
	}
	if (s === "seq" && dgOn() && S.seqPage === 2) {
		return dgKnobs();
	}
	if (s === "seq") {
		const q = S.seq,
			i = q.sel,
			N = nstT(),
			EN = engOf(S.trk),
			PERC = EN === "DRUM" || EN === "SMP";
		return [
			{
				l: "STEP",
				nu: 1,
				st: N,
				si: i,
				sn: i + 1,
				v: pad(i + 1, N > 99 ? 3 : 2),
				n: i / (N - 1),
				r: N,
				set: (d) => (q.sel = clamp(snapIdx(q.sel + d * (snapOn() ? unitSteps() : 1)), 0, N - 1)),
			},
			{
				l: "NOTE",
				v:
					q.st[i] < 0
						? "REST"
						: PERC
							? EN === "DRUM"
								? PADS[q.st[i] - 36] || "?"
								: "SLICE " + (q.st[i] - 35)
							: note(q.st[i]),
				n: q.st[i] < 0 ? 0 : PERC ? (q.st[i] - 36) / 7 : (q.st[i] - 36) / 48,
				set: (d) => {
					if (q.st[i] < 0) {
						q.st[i] = PERC ? 36 : 60;
						q.ch[i] = null;
						if (!q.vel[i]) {
							q.vel[i] = 100;
						}
						if (!q.gate[i]) {
							q.gate[i] = 50;
						}
					} else {
						q.st[i] = clamp(q.st[i] + d, 36, PERC ? 43 : 84);
					}
				},
			},
			{
				l: "GATE",
				v: gateTxt(q.gate[i]),
				n: Math.min(1, q.gate[i] / 100),
				set: (d) => (q.gate[i] = gateNudge(q.gate[i], d)),
			},
			{
				l: "VELOCITY",
				v: String(q.vel[i]),
				n: q.vel[i] / 127,
				set: (d) => (q.vel[i] = clamp(q.vel[i] + d * 4, 1, 127)),
			},
		];
	}
	if (s === "scale") {
		return [
			CH("ROOT", S.scale, "root", NN),
			CH(
				"SCALE",
				S.scale,
				"type",
				SCALES.map((x) => x[0]),
			),
			CH("CHORD", S.scale, "chord", ["OFF", "SNAP", "TRIAD", "7TH", "SUS4"]),
			NUM("SPREAD", S.scale, "spread", 1, 3),
		];
	}
	if (s === "song" && nestFocus()) {
		return nestKnobs();
	} /* a dropped-down slot that is the selected one: TRACK / COLOUR / AUTOMATION / PARAMETER */
	if (s === "song") {
		const sg = S.song,
			i = sg.sel,
			e = sg.chain[i],
			has = e.pat >= 0,
			bars = has ? S.plen[e.pat] : 0;
		return [
			{
				l: "SLOT",
				nu: 1,
				st: 16,
				si: i,
				sn: i + 1,
				v: pad(i + 1),
				n: i / 15,
				r: 16,
				set: (d) => {
					sg.sel = clamp(sg.sel + d, 0, 15);
					songSelect(sg.sel, false);
				},
			},
			{
				l: "PATTERN",
				v: has ? pad(e.pat + 1) : "---",
				n: has ? e.pat / 15 : 0,
				r: 17,
				set: (d) => {
					const j = Math.min(i, songChain().length);
					sg.sel = j;
					patSet(j, patStep(j, d, false));
					songSelect(j, false);
				},
			},
			{
				l: "LENGTH",
				v: has ? bars + (bars > 1 ? " BARS" : " BAR") : "---",
				n: has ? (bars - 1) / (maxBars() - 1 || 1) : 0,
				r: 8,
				set: (d) => {
					if (has) {
						setLenOf(e.pat, bars + d);
					}
				},
			},
			{
				l: "REPEAT",
				v: has ? "x" + e.rep : "---",
				n: has ? (e.rep - 1) / 7 : 0,
				r: 8,
				set: (d) => {
					if (has) {
						e.rep = clamp(e.rep + d, 1, 8);
					}
				},
			},
		];
	}
	if (s === "global") {
		const r = GROWS[S.glob.sel];
		return [
			{
				l: "SCROLL",
				st: GROWS.length,
				si: S.glob.sel,
				sn: S.glob.sel + 1,
				v: pad(S.glob.sel + 1),
				n: S.glob.sel / (GROWS.length - 1),
				set: (d) => (S.glob.sel = clamp(S.glob.sel + d, 0, GROWS.length - 1)),
			},
			{ l: "VALUE", v: r[1](S.glob), n: 0.5, set: (d) => r[2](S.glob, d) },
			NONE,
			NONE,
		];
	}
	if (s === "save") {
		const v = S.save;
		return [
			{
				l: "CURSOR",
				st: 10,
				si: v.cur,
				sn: v.cur + 1,
				v: pad(v.cur + 1),
				n: v.cur / 9,
				set: (d) => (v.cur = clamp(v.cur + d, 0, 9)),
			},
			{
				l: "LETTER",
				v: "'" + v.name[v.cur] + "'",
				n: CHARS.indexOf(v.name[v.cur]) / (CHARS.length - 1),
				set: (d) => {
					const c = CHARS[wrap(CHARS.indexOf(v.name[v.cur]) + d, CHARS.length)];
					v.name = v.name.slice(0, v.cur) + c + v.name.slice(v.cur + 1);
				},
			},
			{
				l: "SLOT",
				v: "U" + pad(clamp(v.slot, 1, saveSlots()), 3),
				n: saveSlots() > 1 ? (clamp(v.slot, 1, saveSlots()) - 1) / (saveSlots() - 1) : 0,
				set: (d) => (v.slot = clamp(clamp(v.slot, 1, saveSlots()) + d, 1, saveSlots())),
			},
			NONE,
		];
	}
	return null;
}

const saveSlots = () => Math.min(128, PRESETS.filter((p) => p[1] === "USER").length + 1);
/* the USER slots SAVE can write: the saved ones and the next free one */
function hz(v) {
	const f = 20 * Math.pow(1000, v / 127);
	return f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + "K" : String(Math.round(f));
}
