// the drum track and its grid
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---------- export / import (PROTOTYPE ONLY: on the FM-1 this is a file over USB or Bluetooth) ----------
// The whole project as one small JSON file: patterns and lengths, the song chain, time signature, grid and snap, tempo, the four tracks' sounds
// and levels and the current sound's settings, and your saved USER presets. Importing is undoable (one step).
function projectJSON() {
	const o = JSON.parse(songSnap(true));
	return JSON.stringify({
		app: "mellow",
		v: 2,
		snap: o,
		bpm: S.bpm,
		rate: S.rate,
		swing: S.swing,
		sgate: S.sgate,
		tracks: S.tracks.map((t) => ({ preset: PRESETS[t.pre][0], vol: t.vol })),
		user: USERP,
	});
}

function importProject(txt) {
	let d;
	try {
		d = JSON.parse(txt);
	} catch (e) {
		return "THAT IS NOT A MELLOW PROJECT";
	}
	if (!d || d.app !== "mellow" || !d.snap || typeof d.snap !== "object") {
		return "THAT IS NOT A MELLOW PROJECT";
	}
	const keep = songSnap(true);
	undoPush("IMPORT");
	if (S.playing) {
		S.playing = false;
		stopSeq();
	}
	S.rec = false;
	S.recExt = false;
	S.countdown = null;
	if (d.user && typeof d.user === "object" && !Array.isArray(d.user)) {
		let nu = PRESETS.filter((p) => p[1] === "USER").length;
		for (const nm in d.user) {
			const u = d.user[nm];
			if (nu >= USERMAX) {
				break;
			}
			if (!userOk(nm, u) || Object.prototype.hasOwnProperty.call(USERP, nm)) {
				continue;
			}
			USERP[nm] = { en: u.en, snap: u.snap };
			PRESETS.push([nm, "USER", u.en]);
			nu++;
		}
		try {
			localStorage.setItem("mellow-user", JSON.stringify(USERP));
		} catch (e) {
			/* nothing to do */
		}
	}
	try {
		songRestore(JSON.stringify(d.snap), true);
	} catch (e) {
		songRestore(keep, true);
		afterRestore();
		return "THAT PROJECT IS DAMAGED";
	} /* all or nothing: a file that still cannot be read leaves the project as it was */
	if (d.bpm >= 30 && d.bpm <= 300) {
		S.bpm = d.bpm;
	}
	if (d.rate >= 0 && d.rate <= 2) {
		S.rate = d.rate | 0;
	}
	if (d.swing >= 50 && d.swing <= 75) {
		S.swing = d.swing;
	}
	if (d.sgate >= 20 && d.sgate <= 100) {
		S.sgate = d.sgate;
	}
	if (Array.isArray(d.tracks)) {
		d.tracks.forEach((t, i) => {
			if (i > 3 || !t) {
				return;
			}
			const k = PRESETS.findIndex((p) => p[0] === t.preset);
			if (k >= 0) {
				S.tracks[i].pre = k;
			}
			if (t.vol >= 0 && t.vol <= 100) {
				S.tracks[i].vol = t.vol | 0;
			}
		});
	}
	S.preset = clamp(S.preset | 0, 0, PRESETS.length - 1);
	S.pat = clamp(S.pat | 0, 0, 15);
	S.patNext = -1;
	S.song.pos = 0;
	S.song.rc = 0;
	S.song.jump = -1;
	S.song.go = 0;
	S.seqs.forEach((q) => {
		if (q.sel >= nst()) {
			q.sel = nst() - 1;
		}
	});
	dgForceKit();
	applyGrid();
	if (AC) {
		audioSync();
	}
	saveSong();
	return "IMPORTED";
}

// ---------- the drum track and its grid ----------
// T4 (index 3, DT) is ALWAYS the drum track: it can only hold DRUM kits (presets of other engines are hidden and refused on it), and the other three tracks are untouched.
// SEQ on T4 opens the DRUM GRID instead of the step sequencer: one row per pad (KICK SNARE HAT OPEN CLAP RIM SHAKER PERC), one column per step, so every drum part is
// visible at once and several can sit on one step. The grid lives on T4's pattern object (q.dg, flat: pad * SMAX + step, a velocity 0..127, 0 = no hit), so it follows the 16 patterns,
// song mode, per-track length, swing, undo, save, export and bounce like any track's data. A hit is a one-shot (no gate, no ratchet). T4's old note arrays (q.st) are folded into
// the grid once and stay empty. Hardware: 8 x 128 x 16 patterns x 1 byte = 16 KB, replacing T4's 3 byte-per-step note arrays (6 KB); it packs to 8 KB at 4-bit velocity.
// The screen, its touches and the white keys are prototype conveniences for what K1-K4 do on SEQ page 3 (STEP, PAD, VELOCITY, CLEAR): `dgKnobs`.
const DT = 3,
	DGN = 8,
	DGL = [50, 100, 127],
	DGLN = ["SOFT", "MED", "LOUD"],
	DGM = [36, 38, 42, 46, 39, 37, 70, 56];
// DGM: the pads as General MIDI drum notes (kick, snare, closed hat, open hat, clap, side stick, shaker, cowbell)

const DG = { row: 1, lvl: 1, arm: null, log: null, fill: -1 };
// the selected pad row, the brush level (new hits), an armed clear chip, an optional log of played hits (tests)
const DGX0 = 44,
	DGW = 192,
	DGY0 = 38,
	DGRH = 12,
	DGB = 139;
// LCD pixels: where the 16 columns start and how wide they are, the first row and its height, the bar strip
const dgOn = () => S.trk === DT && engOf(DT) === "DRUM";

const presetFits = (i) => S.trk !== DT || PRESETS[i][2] === "DRUM";

const dgLvl = (v) => (v <= 74 ? 0 : v <= 113 ? 1 : 2);

const dgCW = () => Math.max(4, Math.floor(DGW / SPB())),
	dgX = () => DGX0 + Math.floor((DGW - dgCW() * SPB()) / 2);

function dgGridGeom() {
	const cw = dgCW();
	return {
		cell: unitSteps() * cw,
		minor: S.gu === 1 ? BSTEPS() * cw : cw,
		ax: dgX() - 1,
		ay: DGY0 + DGN * DGRH,
	};
}

function dgRefuse() {
	toast("T4 IS THE DRUM TRACK: KITS ONLY");
}

// an older project could hold any engine on T4: put the default kit there
function dgForceKit() {
	if (engOf(DT) === "DRUM") {
		return false;
	}
	const k = Math.max(
			0,
			PRESETS.findIndex((p) => p[0] === "DUSTY KIT"),
		),
		t0 = S._trk;
	S.tracks[DT].pre = k;
	S._trk = DT;
	applyPreset(k);
	S._trk = t0;
	bindTrack(t0);
	return true;
}

// ---- data: migration of the old single-note step data, undo / save snapshots
const dgPadOf = (n) => (n >= 36 && n <= 43 ? n - 36 : ((n % 8) + 8) % 8);
// the note a drum step used to hold -> its pad (stepPlay played note - 36; anything else folds mod 8 like noteVoice)
function dgFold(q, n) {
	const g = q.dg;
	for (let i = 0; i < n; i++) {
		const m = q.st[i];
		if (m >= 0) {
			if (q.vel[i] > 0) {
				g[dgPadOf(m) * SMAX + i] = clamp(Math.round(q.vel[i]), 1, 127);
			}
			q.st[i] = -1;
			q.ch[i] = null;
		}
	}
}

function dgMigrateAll() {
	S.pats.forEach((P) => {
		const q = P[DT];
		if (!q.dg) {
			q.dg = new Uint8Array(DGN * SMAX);
		}
		dgFold(q, Math.min(q.st.length, SMAX));
	});
}

function dgSnap(q, t, n) {
	if (t !== DT || !q.dg) {
		return {};
	}
	const o = [];
	for (let r = 0; r < DGN; r++) {
		for (let j = 0; j < n; j++) {
			const v = q.dg[r * SMAX + j];
			if (v) {
				o.push([r, j, v]);
			}
		}
	}
	return { dg: o };
}
// [pad, step, velocity] for the steps in play
function dgRestore(o, q) {
	const n = Math.min(q.st.length, SMAX);
	if (!o.dg) {
		o.dg = new Uint8Array(DGN * SMAX);
	}
	const g = o.dg;
	for (let r = 0; r < DGN; r++) {
		g.fill(0, r * SMAX, r * SMAX + n);
	}
	if (Array.isArray(q.dg)) {
		q.dg.forEach((h) => {
			if (!Array.isArray(h)) {
				return;
			}
			const r = h[0] | 0,
				j = h[1] | 0,
				v = h[2] | 0;
			if (r >= 0 && r < DGN && j >= 0 && j < n && v > 0) {
				g[r * SMAX + j] = Math.min(127, v);
			}
		});
	} else {
		dgFold(o, n);
	}
}
// an older save has only notes: they become hits
function dgClearCols(q, a, b) {
	if (!q.dg) {
		return;
	}
	for (let r = 0; r < DGN; r++) {
		q.dg.fill(0, r * SMAX + a, r * SMAX + b);
	}
}

// ---- playing: every hit of the step, through drumHit with its velocity (swing and per-track length come with `when` and `k`), and out as MIDI
function dgMidi(t, r, v, when) {
	const ch = midiCh(t);
	midiSend([0x90 | ch, DGM[r], clamp(v, 1, 127)], when);
	midiSend([0x80 | ch, DGM[r], 0], when + 0.08, 1);
}

function drumStep(t, k, when) {
	const q = S.seqs[t],
		g = q.dg,
		i = k % nstT(t);
	if (!g) {
		return;
	}
	if (S.rec && S.glob.rmode === 1 && !S.recExt && t === S.trk && !A.recW[t].has(i)) {
		dgClearCols(q, i, i + 1);
		return;
	} /* REPLACE: what the playhead passes is wiped unless it was just played in this pass */
	const skip = A.dmCur | 0;
	for (let r = 0; r < DGN; r++) {
		const v = g[r * SMAX + i];
		if (!v || (skip >> r) & 1) {
			continue;
		}
		if (A.recLive.length && recLiveSkip(t, i, when, r)) {
			continue;
		}
		drumHit(t, r, v / 127, when);
		dgMidi(t, r, v, when);
		if (DG.log) {
			DG.log.push({ step: i, pad: r, vel: v, when, pat: S.pat, pos: S.song.pos });
		}
	}
}

// the grid of one pattern as MIDI file events (General MIDI drum notes on channel 10)
function dgMidiEv(evs, base, steps, len, pat, tps, dm = 0) {
	const g = S.pats[pat][DT].dg;
	if (!g) {
		return;
	}
	const dur = Math.max(1, Math.round(tps * 0.5));
	for (let j = 0; j < steps; j++) {
		const i = j % len;
		for (let r = 0; r < DGN; r++) {
			const v = g[r * SMAX + i];
			if (!v || (dm >> r) & 1) {
				continue;
			}
			const on = Math.round((base + j) * tps);
			evs.push(
				{ k: on, o: 1, b: [0x99, DGM[r], clamp(v, 1, 127)] },
				{ k: on + dur, o: 0, b: [0x89, DGM[r], 0] },
			);
		}
	}
}

// REC while playing: a pad you hit lands in the grid at the playhead (several pads on one step are fine)
function dgRec(q, i, n, vel) {
	q.dg[clamp(n - 36, 0, 7) * SMAX + i] = clamp(Math.round(vel * 127), 1, 127);
	A.recW[DT].add(i);
}

// ---- editing (touch, knobs and white keys all end up here)
const dgAud = (r, v) => {
	if (!AC) {
		return;
	}
	const t = AC.currentTime + 0.005;
	drumHit(DT, r, v / 127, t);
	dgMidi(DT, r, v, t);
	S.padHits[r] = performance.now();
};

function dgClearRow(r = DG.row) {
	undoPush("CLEAR ROW");
	const g = S.seqs[DT].dg;
	g.fill(0, r * SMAX, (r + 1) * SMAX);
	toast("CLEARED " + PADS[r]);
}
/* (the drum track's own pattern, S.seqs[DT]: the CLEAR dialog can outlive a track change) */
function dgClearStep() {
	undoPush("CLEAR STEP");
	const q = S.seqs[DT];
	dgClearCols(q, q.sel, q.sel + 1);
	toast("CLEARED");
}

function dgClearPat() {
	undoPush("CLEAR DRUMS");
	S.seqs[DT].dg.fill(0);
	toast("DRUMS CLEARED");
}

function dgClearDlg() {
	S.pop = null;
	S.dlg = {
		t: "CLEAR",
		lines: [
			"CLEAR STEP TURN THE K3",
			"CLEAR ROW TURN THE K2",
			"CLEAR PATTERN TURN THE K4",
			"NEW SONG TURN THE K1",
		],
		k: ["NEW SONG", "ROW", "STEP", "PATTERN"],
		a: [
			() => {
				S.clr = 3;
				doClear();
			},
			() => dgClearRow(),
			dgClearStep,
			() => {
				S.clr = 2;
				doClear();
			},
		],
	};
}

function dgKnobs() {
	const q = S.seq,
		i = q.sel,
		N = nstT(),
		r = DG.row,
		idx = r * SMAX + i,
		v = q.dg[idx];
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
			l: "PAD",
			nu: 1,
			st: DGN,
			si: r,
			sn: r + 1,
			v: PADS[r],
			n: r / (DGN - 1),
			set: (d) => {
				const nr = clamp(DG.row + d, 0, DGN - 1);
				if (nr !== DG.row) {
					DG.row = nr;
					dgAud(nr, DGL[DG.lvl]);
				}
			},
		},
		{
			l: "VELOCITY",
			v: v ? String(v) : "OFF",
			n: v / 127,
			set: (d) => {
				if (!v) {
					if (d > 0) {
						q.dg[idx] = DGL[DG.lvl];
						dgAud(r, DGL[DG.lvl]);
					}
				} else {
					q.dg[idx] = clamp(v + d * 4, 0, 127);
				}
			},
		},
		{ l: "CLEAR", nu: 1, v: "---", n: 0, set: () => openClearDlg() },
	];
}

function dgKey(i) {
	if (i >= DGN) {
		return;
	}
	const q = S.seq,
		idx = i * SMAX + q.sel;
	undoPush("DRUM STEP");
	DG.row = i;
	if (q.dg[idx]) {
		q.dg[idx] = 0;
	} else {
		q.dg[idx] = DGL[DG.lvl];
		dgAud(i, DGL[DG.lvl]);
	}
	S.hot = { c: 1, t: performance.now(), d: 0 };
}
// page 3: white key n toggles pad n at the selected step
function dgChipTap(k) {
	const n = performance.now();
	if (DG.arm && DG.arm.k === k && n - DG.arm.t < 2500) {
		DG.arm = null;
		if (k === "row") {
			dgClearRow();
		} else {
			dgClearPat();
		}
		return;
	}
	DG.arm = { k, t: n };
}
// a clear chip needs two taps
function dgCell(x, y, vb) {
	const SP = SPB(),
		c = clamp(Math.floor((x - dgX()) / dgCW()), 0, SP - 1);
	return {
		r: clamp(Math.floor((y - DGY0) / DGRH), 0, DGN - 1),
		j: clamp(snapIdx(vb * SP + c), 0, nstT() - 1),
	};
}

// what is under a touch on the grid screen
function dgZone(x, y) {
	const SP = SPB(),
		cw = dgCW();
	if (y >= DGY0 && y < DGY0 + DGN * DGRH) {
		if (x < DGX0 - 2) {
			return { t: "dg", kind: "label", r: clamp(Math.floor((y - DGY0) / DGRH), 0, DGN - 1) };
		}
		if (x >= dgX() && x < dgX() + cw * SP) {
			return { t: "dg", kind: "cell" };
		}
		return null;
	}
	if (barZone(x, y)) {
		return { t: "bs", tap: true };
	}
	if (y >= DQ.y - 1 && y < DQ.y + DQ.h && x >= 4 && x < 236) {
		return { t: "dq", k: clamp(Math.floor((x - 6) / DQ.dx), 0, 3) };
	}
	if (y >= DQ.fy - 2 && y < 187 && x < DQ.fx + DQ.fw + 8) {
		return { t: "dg", kind: "fill" };
	}
	const f = footHit(x, y);
	if (f) {
		return { t: "dg", kind: f === "u" ? "undo" : "redo" };
	}
	if (y >= 187 && y < 205) {
		if (x >= DF.lv.x - 2 && x < DF.rw.x - 2) {
			return { t: "dg", kind: "lvl" };
		}
		if (x >= DF.rw.x - 2 && x < DF.al.x - 2) {
			return { t: "dg", kind: "chip", k: "row" };
		}
		if (x >= DF.al.x - 2 && x < 221) {
			return { t: "dg", kind: "chip", k: "all" };
		}
	}
	return null;
}

// cells: touch an empty one and a hit is placed (at the brush level) and sounds; drag sideways to paint along the row; drag up or down to set its velocity.
// Touch a hit: a bare tap removes it, a sideways drag erases along the row, an up/down drag sets its velocity. One undo step per touch.
function dgDown(z, x, y) {
	const q = S.seq;
	if (z.kind === "label") {
		DG.row = z.r;
		dgAud(z.r, DGL[DG.lvl]);
		return;
	}
	if (z.kind === "lvl") {
		DG.lvl = (DG.lvl + 1) % 3;
		return;
	} /* the LEVEL chip cycles SOFT, MED, LOUD (it used to be three boxes) */
	if (z.kind === "chip") {
		dgChipTap(z.k);
		return;
	}
	if (z.kind === "fill") {
		openFillMenu();
		return;
	}
	if (z.kind === "undo") {
		footTap("u");
		return;
	}
	if (z.kind === "redo") {
		footTap("r");
		return;
	}
	undoPush("DRUM STEPS");
	z.vb = seqViewBar();
	const c = dgCell(x, y, z.vb),
		idx = c.r * SMAX + c.j;
	z.r = c.r;
	z.j0 = c.j;
	z.last = c.j;
	z.had = q.dg[idx] > 0;
	DG.row = c.r;
	q.sel = c.j;
	if (z.had) {
		z.mode = "tap";
	} else {
		q.dg[idx] = DGL[DG.lvl];
		z.mode = "add";
		dgAud(c.r, DGL[DG.lvl]);
	}
	z.v0 = q.dg[idx];
	S.hot = { c: 1, t: performance.now(), d: 0 };
}

function dgMove(z, x, y) {
	if (z.kind !== "cell") {
		return;
	}
	const q = S.seq,
		g = q.dg,
		dx = x - z.x,
		dy = y - z.y;
	if (!z.moved) {
		if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
			return;
		}
		z.moved = true;
		z.axis = Math.abs(dy) > Math.abs(dx) ? "v" : "h";
	}
	if (z.axis === "v") {
		const idx = z.r * SMAX + z.j0;
		if (g[idx]) {
			g[idx] = clamp(Math.round(z.v0 - dy * 4), 1, 127);
			S.hot = { c: 2, t: performance.now(), d: 0 };
		}
		return;
	}
	const SP = SPB(),
		c = clamp(Math.floor((x - dgX()) / dgCW()), 0, SP - 1),
		j = clamp(snapIdx(z.vb * SP + c), 0, nstT() - 1);
	if (j === z.last) {
		return;
	}
	if (z.mode === "tap") {
		z.mode = "erase";
		g[z.r * SMAX + z.j0] = 0;
	}
	const dir = j > z.last ? 1 : -1;
	for (let k = z.last + dir; ; k += dir) {
		const jj = clamp(snapIdx(k), 0, nstT() - 1),
			idx = z.r * SMAX + jj;
		if (z.mode === "erase") {
			g[idx] = 0;
		} else if (!g[idx]) {
			g[idx] = DGL[DG.lvl];
			if (AC && jj === j) {
				dgAud(z.r, DGL[DG.lvl]);
			}
		}
		if (k === j) {
			break;
		}
	}
	z.last = j;
	q.sel = j;
}

function dgUp(z, e) {
	if (z.kind === "cell" && e.type === "pointerup" && !z.moved && z.mode === "tap") {
		S.seq.dg[z.r * SMAX + z.j0] = 0;
	}
}

// the screen
// ---- the drum grid's quick strip (PROTOTYPE ONLY touch; the device way in is the EDIT page's TUNE / DECAY / CRUSH knobs for the first three and the FILL knob on this page 2/2).
// Four small bars for the SELECTED pad row (the one you tapped): TUNE, DECAY and CRUSH (S.drum.tune / dec / crush, 0-99 like the EDIT knobs) and the pad's CLICK (the kit voicing field that is that pad's attack or click:
// DQV is the field, DQL its lowest useful value; the bar shows 0-99 like the others, the field has 16 steps). A kit with no voicing (`vo` null) gets the NEUTRAL voice for that pad (DQN0) on the first CLICK edit, so the
// field has something to move; no engine field is added. Drag sideways on a bar (a relative drag: a bare tap changes nothing, the bar's width sweeps the whole range): one undo step per gesture, an audition hit while it moves.
const DQ = {
	y: 152,
	h: 21,
	dx: 57,
	w: 52,
	by: 163,
	bh: 7,
	fy: 174,
	fx: 8,
	fw: 112,
	held: -1,
	k: -1,
	t: 0,
	at: 0,
	wt: 0,
};
// LCD pixels: the first bar column, its label line, bar and size, the FILL chip row

const DF = { lv: { x: 54, w: 46 }, rw: { x: 104, w: 56 }, al: { x: 164, w: 56 } };
// the footer's own chips: LEVEL (cycles), CLEAR ROW, CLEAR ALL, after the UNDO / REDO icons
const DQV = [4, 4, 5, 6, 0, 2, 2, 4],
	DQL = [0, 0, 8, 8, 0, 0, 0, 0],
	DQN = ["CLICK", "SNAP", "ATTACK", "ATTACK", "BURSTS", "TICK", "ATTACK", "NOISE"];
// per pad: the voicing field that is its attack or click, its lowest value, its name (kick click, snare snap, hat attack burst, clap bursts, rim tick level, shaker attack, perc noise)
const DQN0 = [
	[8, 8, 0, 8, 8, 8, 0, 9],
	[8, 8, 8, 8, 8, 8, 8, 9],
	[8, 8, 8, 0, 8, 8, 8, 9],
	[8, 8, 8, 0, 8, 8, 8, 9],
	[8, 8, 8, 8, 8, 8, 8, 9],
	[8, 8, 8, 8, 8, 8, 8, 9],
	[8, 8, 8, 8, 8, 0, 8, 9],
	[8, 8, 8, 8, 8, 8, 8, 9],
];
// a pad's neutral voicing (8 = the original voice's value, 0 for the layers the original lacks, 9 = 0 dB)
const dqName = (k, r) => (k === 0 ? "TUNE" : k === 1 ? "DECAY" : k === 2 ? "CRUSH" : DQN[r]);

const dqVo = (D, r) => (Array.isArray(D.vo) && Array.isArray(D.vo[r]) ? D.vo[r] : null);

function dqRaw(k, r) {
	const D = TK(DT).drum;
	if (k === 0) {
		return D.tune[r];
	}
	if (k === 1) {
		return D.dec[r];
	}
	if (k === 2) {
		return D.crush[r];
	}
	const vo = dqVo(D, r),
		x = vo && vo[DQV[r]] != null ? vo[DQV[r]] : DQN0[r][DQV[r]];
	return x;
}

const dqField = (k, r, v) =>
	k < 3
		? clamp(Math.round(v), 0, 99)
		: clamp(DQL[r] + Math.round((clamp(v, 0, 99) / 99) * (15 - DQL[r])), 0, 15);
// the number a bar value of 0-99 is stored as
const dqGet = (k, r) => {
	const x = dqRaw(k, r);
	return k < 3 ? x : Math.round(clamp((x - DQL[r]) / (15 - DQL[r]), 0, 1) * 99);
};

function dqSet(k, r, v) {
	const D = TK(DT).drum,
		x = dqField(k, r, v);
	if (k === 0) {
		D.tune[r] = x;
	} else if (k === 1) {
		D.dec[r] = x;
	} else if (k === 2) {
		D.crush[r] = x;
	} else {
		if (!Array.isArray(D.vo)) {
			D.vo = [null, null, null, null, null, null, null, null];
		}
		if (!Array.isArray(D.vo[r])) {
			D.vo[r] = DQN0[r].slice();
		}
		D.vo[r][DQV[r]] = x;
	}
}

function dqAud(r) {
	const n = performance.now();
	if (n - DQ.at < 110) {
		return;
	}
	DQ.at = n;
	dgAud(r, DGL[DG.lvl]);
}
// at most one audition hit per 110 ms while a bar moves
function dqDown(z, x, y) {
	z.r = DG.row;
	z.v0 = dqGet(z.k, z.r);
	z.last = null;
	z.pushed = false;
	DQ.held = z.k;
	DQ.k = z.k;
	dqAud(z.r);
}

function dqMove(z, x, y) {
	const dx = x - z.x;
	if (!z.moved && Math.abs(dx) < 3) {
		return;
	}
	z.moved = true;
	const nv = clamp(Math.round(z.v0 + (dx / DQ.w) * 99), 0, 99);
	if (nv === z.last) {
		return;
	}
	z.last = nv;
	if (dqField(z.k, z.r, nv) === dqRaw(z.k, z.r)) {
		return;
	}
	if (!z.pushed) {
		undoPush("DRUM " + dqName(z.k, z.r));
		z.pushed = true;
	}
	dqSet(z.k, z.r, nv);
	DQ.t = performance.now();
	dqAud(z.r);
}

function dqUp(z) {
	DQ.held = -1;
}

function dqWheel(k, d) {
	const r = DG.row,
		nv = clamp(dqGet(k, r) + d * (k === 3 ? 7 : 3), 0, 99);
	if (dqField(k, r, nv) === dqRaw(k, r)) {
		return;
	}
	const n = performance.now();
	if (n - DQ.wt > 700) {
		undoPush("DRUM " + dqName(k, r));
	}
	DQ.wt = n;
	dqSet(k, r, nv);
	DQ.k = k;
	DQ.t = n;
	dqAud(r);
}

// ---- FILL: one pattern for the selected pad across the whole pattern length at the LEVEL velocity, replacing that pad's row (steps past the pattern's length are left alone). A step is a 1/16, a beat is BSTEPS() steps, a bar SPB().
// Device: the FILL knob (K1 of SEQ page 2/2 on the drum grid) steps through the same list and writes each one as you turn (one undo step per turn, like any knob); the dropdown is the phone's way.
const FILLS = [
	["FOUR ON THE FLOOR", (j) => j % BSTEPS() === 0],
	["OFFBEATS", (j) => j % BSTEPS() === BSTEPS() / 2],
	["EIGHTHS", (j) => j % 2 === 0],
	["SIXTEENTHS", () => true],
	["EVERY 2 BEATS", (j) => j % (2 * BSTEPS()) === 0],
	["EVERY BAR", (j) => j % SPB() === 0],
	["EVERY 2 BARS", (j) => j % (2 * SPB()) === 0],
	["EVERY 4 BARS", (j) => j % (4 * SPB()) === 0],
	["CLEAR PAD", () => false],
];

function dgFill(i, own = true, r = DG.row) {
	const f = FILLS[i];
	if (!f) {
		return;
	}
	if (own) {
		undoPush("FILL " + f[0]);
	}
	const g = S.seqs[DT].dg,
		N = nstT(DT),
		v = DGL[DG.lvl];
	for (let j = 0; j < N; j++) {
		g[r * SMAX + j] = f[1](j) ? v : 0;
	}
	DG.fill = i;
	toast(f[0] + "  " + PADS[r]);
}

const FMENU = { open: false };

function openFillMenu() {
	closeEditMenu();
	let m = document.getElementById("fillmenu");
	if (!m) {
		m = document.createElement("div");
		m.id = "fillmenu";
		m.className = "modmenu";
		m.hidden = true;
		document.body.appendChild(m);
	}
	m.innerHTML = "";
	const cap = document.createElement("div");
	cap.className = "mt cap";
	cap.textContent = "FILL " + PADS[DG.row] + " ACROSS THE PATTERN AT " + DGLN[DG.lvl];
	m.appendChild(cap);
	FILLS.forEach((f, i) => {
		const b = document.createElement("button");
		b.className = "mt";
		b.textContent = f[0];
		b.dataset.fill = i;
		if (i === 0) {
			b.style.gridColumn = "1/-1";
		}
		b.setAttribute("aria-pressed", String(DG.fill === i));
		b.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			dgFill(i);
			closeFillMenu();
		});
		m.appendChild(b);
	});
	const r = document.getElementById("big").getBoundingClientRect();
	m.style.top = Math.round(r.top + (r.height * 28) / 240) + "px";
	m.style.bottom = "auto";
	m.hidden = false;
	FMENU.open = true;
	setTimeout(() => document.addEventListener("pointerdown", outsideFill, true), 0);
}

function outsideFill(e) {
	const m = document.getElementById("fillmenu");
	if (m && m.contains(e.target)) {
		return;
	}
	closeFillMenu();
	if (e.target === big) {
		e.stopPropagation();
		e.preventDefault();
	}
}
/* a tap on the screen that closes the dropdown is only that */
function closeFillMenu() {
	const m = document.getElementById("fillmenu");
	if (m) {
		m.hidden = true;
	}
	FMENU.open = false;
	document.removeEventListener("pointerdown", outsideFill, true);
}

function dgKnobs2() {
	const fi = DG.fill;
	return [
		{
			l: "FILL",
			st: FILLS.length,
			si: Math.max(0, fi),
			sn: fi + 1,
			v: fi < 0 ? "---" : FILLS[fi][0],
			n: fi < 0 ? 0 : fi / (FILLS.length - 1),
			set: (d) =>
				dgFill(
					DG.fill < 0 ? (d > 0 ? 0 : FILLS.length - 1) : clamp(DG.fill + d, 0, FILLS.length - 1),
					false,
				),
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

SCR.dgrid = (now, live) => {
	const L = tbars(),
		SP = SPB(),
		cw = dgCW(),
		X0 = dgX(),
		q = S.seq,
		g = q.dg,
		cur = seqPos(now, live),
		bs = BSTEPS(),
		u = unitSteps();
	const vb =
			live && S.playing && cur >= 0
				? Math.min(L - 1, Math.floor(cur / SP))
				: clamp(Math.floor(q.sel / SP), 0, L - 1),
		o = vb * SP;
	if (q.sel >= nstT()) {
		q.sel = nstT() - 1;
	}
	let hits = 0;
	for (let r = 0; r < DGN; r++) {
		for (let j = 0, N = nstT(); j < N; j++) {
			if (g[r * SMAX + j]) {
				hits++;
			}
		}
	}
	title(
		["1/2 DRUM GRID", "2/2 DRUM GRID", "STEP EDIT", "SEQ LENGTH", "TRACK LENGTH"][S.seqPage],
		hits + (hits === 1 ? " HIT" : " HITS"),
	);
	R(0, 28, 240, 1, P.faint);
	seqPips();
	songChipDraw();
	for (let i = 0; i < SP; i++) {
		const j = o + i,
			x = X0 + i * cw;
		if (i % bs === 0) {
			T(String(j + 1), x + ((cw - 1) >> 1), 30, P.dim, 1, "c");
		}
		if (j === q.sel) {
			R(x, DGY0 - 2, cw - 1, 1, P.acc);
		}
	}
	for (let r = 0; r < DGN; r++) {
		const ry = DGY0 + r * DGRH,
			sel = r === DG.row,
			flash = now - (S.padHits[r] || -1e9) < 160 || (live && cur >= 0 && g[r * SMAX + cur] > 0);
		if (sel) {
			R(2, ry, DGX0 - 5, DGRH - 1, P.sel);
		}
		T(PADS[r], 5, ry + 3, sel ? P.selfg : flash ? P.acc : P.dim);
		for (let i = 0; i < SP; i++) {
			const j = o + i,
				x = X0 + i * cw,
				v = g[r * SMAX + j],
				on = j === cur;
			R(x, ry, cw - 1, DGRH - 1, on ? P.faint : Math.floor(i / bs) & 1 ? P.bar : P.grid);
			if (v) {
				const hh = Math.max(3, Math.round((DGRH - 1) * (0.34 + (0.66 * v) / 127)));
				R(x, ry + DGRH - 1 - hh, cw - 1, hh, on ? P.fg : [P.ops[3], P.ops[5], P.acc][dgLvl(v)]);
			}
			if (j === q.sel && r === DG.row) {
				B(x - 1, ry - 1, cw + 1, DGRH + 1, P.fg);
			}
		}
	}
	for (let i = 0; i < SP; i++) {
		const j = o + i,
			x = X0 + i * cw;
		if (snapOn() && j % u === 0) {
			R(x + ((cw - 1) >> 1) - 1, DGY0 + DGN * DGRH + 1, 2, 2, P.acc);
		}
	}
	barStrip(DGB, L, vb, cur, live, SP);
	/* the quick strip: four bars for the selected pad */
	{
		const r = DG.row,
			lit = now - DQ.t < 900;
		for (let k = 0; k < 4; k++) {
			const x = 8 + k * DQ.dx,
				v = dqGet(k, r),
				hot = DQ.held === k || (lit && DQ.k === k);
			T(dqName(k, r), x, DQ.y + 1, hot ? P.acc : P.dim);
			T(String(v), x + DQ.w, DQ.y + 1, hot ? P.acc : P.fg, 1, "r");
			R(x, DQ.by, DQ.w, DQ.bh, P.faint);
			R(x, DQ.by, Math.round((DQ.w * v) / 99), DQ.bh, hot ? P.acc : P.fg);
		}
	}
	/* the FILL dropdown chip, and what the cursor is on (or what the recording is doing) on the same row */
	{
		const x = DQ.fx,
			w = DQ.fw,
			y = DQ.fy;
		B(x, y, w, 12, FMENU.open ? P.acc : P.faint);
		T("FILL " + PADS[DG.row], x + 6, y + 3, P.fg);
		R(x + w - 10, y + 5, 5, 1, P.acc);
		R(x + w - 9, y + 6, 3, 1, P.acc);
		R(x + w - 8, y + 7, 1, 1, P.acc);
	}
	{
		const sl = q.sel,
			v = g[DG.row * SMAX + sl],
			ty = DQ.fy + 3;
		if (S.recExt && S.rec) {
			T("REC: GROWING", 232, ty, P.rec, 1, "r");
		} else if (S.rec) {
			T("REC: PLAY PADS", 232, ty, P.rec, 1, "r");
		} else if (S.seqPage === 4) {
			T("NEXT SEQ: SEQ OFF", 232, ty, P.faint, 1, "r");
		} else if (!hits && S.seqPage !== 2) {
			T("EMPTY: TAP A CELL", 232, ty, P.faint, 1, "r");
		} else {
			T("STEP " + (sl + 1) + "  " + (v ? "VEL " + v : "OFF"), 232, ty, P.dim, 1, "r");
		}
	}
	/* the footer row: UNDO and REDO icons, the LEVEL chip (taps cycle SOFT, MED, LOUD), CLEAR ROW and CLEAR ALL (two taps each) */
	footUR();
	{
		const y = FOOT.y,
			lv = DF.lv;
		B(lv.x, y, lv.w, FOOT.h, P.faint);
		for (let i = 0; i < 3; i++) {
			const h = [3, 5, 8][i];
			R(lv.x + 5 + i * 3, y + 10 - h, 2, h, i <= DG.lvl ? P.fg : P.faint);
		}
		T(DGLN[DG.lvl], lv.x + 17, y + 3, P.fg);
		[
			["row", DF.rw, "CLR ROW"],
			["all", DF.al, "CLR ALL"],
		].forEach(([k, c, tx]) => {
			const arm = DG.arm && DG.arm.k === k && now - DG.arm.t < 2500;
			B(c.x, y, c.w, FOOT.h, arm ? P.rec : P.faint);
			T(arm ? "TAP AGAIN" : tx, c.x + (c.w >> 1), y + 3, arm ? P.rec : P.dim, 1, "c");
		});
	}
};

window.__mellowDrum = {
	DG,
	DT,
	DGM,
	DGL,
	dgOn,
	dgGeom: () => ({
		x0: dgX(),
		cw: dgCW(),
		y0: DGY0,
		rh: DGRH,
		bar: DGB,
		dq: DQ,
		df: DF,
		foot: FOOT,
	}),
	FILLS,
	dgFill,
	dqGet,
	dqSet,
	dqName,
	barStep,
	dgForceKit,
	dgMigrateAll,
	dgFold,
	dgSnap,
	dgRestore,
	drumStep,
	dgPadOf,
	projectJSON,
	importProject,
};
