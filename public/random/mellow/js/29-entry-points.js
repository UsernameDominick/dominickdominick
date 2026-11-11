// entry points: button presses, knob turns, what each control does
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---------- entry points ----------
function ensureAudio() {
	midiInit();
	if (!AC) {
		try {
			audioInit();
		} catch (e) {
			console.error("audio init", e);
		}
	}
	if (AC && AC.state !== "running" && AC.state !== "closed" && !document.hidden) {
		const pr = AC.resume();
		if (pr && pr.catch) {
			pr.catch(() => {});
		}
	}
}

function resetKnob(i) {
	ensureAudio();
	// the same undo key as turning the knob: the first tap of the double-tap nudged it a step, and the reset joins that step, so one UNDO goes back to the value before
	pPush("k" + i);
	if (S.screen === "boot") {
		S.screen = "home";
	}
	const ks = knobs();
	if (!ks || !ks[i] || !ks[i].rs) {
		return false;
	}
	ks[i].rs();
	const k = knobs()[i];
	S.hot = { c: i, t: now() };
	pop(k.l, k.v + " \u00b7 DEFAULT", k.n);
	audioSync();
	return true;
}

function resetDial(id) {
	pPush(id); // joins the nudge from the double-tap's first tap (see resetKnob)
	if (id === "master") {
		ensureAudio();
		S.vol = S0.vol != null ? S0.vol : 72;
		pop("VOLUME", S.vol + "%", S.vol / 100);
		audioSync();
		return true;
	}
	if (id === "algorithm" && engOf(S.trk) !== "FM") {
		if (engOf(S.trk) !== "ANA") {
			return false;
		}
		ensureAudio();
		dfl(S.ana, "w2");
		pop("OSC 2", SHP[S.ana.w2] + " \u00b7 DEFAULT", S.ana.w2 / 3);
		audioSync();
		return true;
	}
	if (id === "algorithm") {
		ensureAudio();
		S.screen = "alg";
		S.alg = PB ? PB.alg : S0.alg;
		adsrFromOps();
		pop("ALGORITHM", pad(S.alg) + " \u00b7 DEFAULT", (S.alg - 1) / 31);
		audioSync();
		return true;
	}
	if (id[0] === "k") {
		return resetKnob(+id[1]);
	}
	return false;
}

function turn(id, d) {
	ensureAudio();
	wake();
	if (/^k\d$|^master$|^algorithm$/.test(id)) {
		const kk = id[0] === "k" ? knobs()[+id[1]] : null;
		if (!(kk && kk.nu)) {
			pPush(
				id,
				id === "master"
					? "VOLUME"
					: id === "algorithm"
						? engOf(S.trk) === "ANA"
							? "OSC 2"
							: "ALGORITHM"
						: kk && kk.l
							? String(kk.l)
							: "",
			);
		}
	}
	const ob = S.bpm,
		oss = stepSec();
	turn0(id, d);
	if (stepSec() !== oss) {
		rebase(oss, ob);
	}
	syncSoon();
}

const STOPTAP = { t: 0 },
	HOMETAP = { t: 0 };

let SAVEFROM = "home",
	KEYFROM = "home";

function press(id, btn) {
	ensureAudio();
	wake();
	const scr =
		S.screen; /* btn: the press came from a tap on the on-screen button (only those can be a double tap) */
	if (BNC.on && (id === "play" || id === "stop")) {
		bounceCancel();
		return;
	}
	if (id === "home" && btn) {
		const nt = performance.now();
		if (nt - HOMETAP.t <= 350) {
			HOMETAP.t = 0;
			S.dlg = null;
			S.pop = null;
			S.screen = "scape";
			audioSync();
			return;
		}
		HOMETAP.t = nt;
	} /* HOME: a tap goes home; a second tap within 0.35 s opens the soundscape (the SCAPE line on Home is gone) */
	if (id === "stop") {
		const nt = performance.now();
		if (nt - STOPTAP.t < 350) {
			STOPTAP.t = 0;
			killAll();
		} else {
			STOPTAP.t = nt;
			stopOnly();
		}
		return;
	} /* STOP: stops at once; a second tap within 0.35 s is KILL */
	if (
		id === "rec" &&
		!S.rec &&
		!S.playing &&
		S.seqEn &&
		AC &&
		scr !== "smp" &&
		!S.dlg &&
		!S.countdown &&
		(S.glob.cin || S.glob.rlen)
	) {
		startCountIn(!!S.glob.rlen);
		audioSync();
		return;
	} /* REC while stopped: the COUNT-IN setting plays its clicks first, the RECORD LENGTH setting can let the pattern grow; with both off it records at once */
	const rec0 = S.rec && S.playing;
	if (id === "save" && scr !== "save") {
		SAVEFROM = scr;
		S.save.name = PRESETS[S.preset][0].slice(0, 10).padEnd(10, " ");
		S.save.cur = 0;
		{
			const us = PRESETS.filter((p) => p[1] === "USER"),
				cu = us.indexOf(PRESETS[S.preset]);
			S.save.slot = cu >= 0 ? cu + 1 : Math.min(128, us.length + 1);
		}
	}
	press0(id);
	if (id === "play") {
		S.playing ? startSeq() : stopSeq();
	}
	if (id === "rec" && S.rec && !rec0 && S.playing && scr !== "smp") {
		undoPush("RECORDING");
	} /* REC switched on while it plays: what is recorded before the next pass is an undo step too */
	if (id === "rec" && S.rec && !S.playing) {
		S.playing = true;
		startSeq();
	}
	if (id === "rec" && scr === "smp") {
		S.rec = false;
		startResample();
	}
	if (!S.playing) {
		S.countdown = null;
	}
	if (rec0 && (!S.playing || !S.rec)) {
		finishRec();
	}
	audioSync();
}

document.querySelector(".stage").addEventListener("pointerdown", () => ensureAudio(), true);

["pointerup", "touchend"].forEach((ev) =>
	document.addEventListener(
		ev,
		() => {
			if (AC && AC.state !== "running" && AC.state !== "closed" && !document.hidden) {
				const pr = AC.resume();
				if (pr && pr.catch) {
					pr.catch(() => {});
				}
			}
		},
		true,
	),
);

S.pats = [];
/* a blank project: all 16 patterns start empty (no demo pattern) */
for (let k = 0; k < 16; k++) {
	S.pats.push(emptyPat());
}

S.song = {
	on: 0,
	sel: 0,
	pos: 0,
	rc: 0,
	base: 0,
	jump: -1,
	go: 0,
	chain: Array.from({ length: 16 }, (_, i) => ({
		pat: i === 0 ? 0 : -1,
		rep: 1,
		mute: 0,
		dmute: 0,
	})),
};
// song mode: the patterns chained in order, each repeated rep times

dgMigrateAll();
/* the stock drum pattern (older single-note data too) becomes grid hits, once */
S.pats.forEach((P) =>
	P.forEach((q) => {
		while (q.st.length < SMAX) {
			q.st.push(-1);
			q.gate.push(50);
			q.vel.push(100);
		}
	}),
);
/* the stock patterns are one bar: pad them out to the full size */
Object.defineProperty(S, "seqs", {
	get() {
		return S.pats[S.pat];
	},
});

Object.defineProperty(S, "seq", {
	get() {
		return S.seqs[S.trk];
	},
});

S.pcat = 0;

S.psort = 0;

S.paud = 1;

function stepSec() {
	return 60 / S.bpm / [2, 4, 8][S.rate];
}

function doClear() {
	const c = S.clr;
	S.clr = 0;
	undoPush("CLEAR");
	if (c === 1) {
		Object.assign(S.seqs[S.trk], emptyPat()[0]);
	} else if (c === 2) {
		S.pats[S.pat] = emptyPat();
	} else if (c === 3) {
		if (S.playing) {
			S.playing = false;
			stopSeq();
		}
		for (let k = 0; k < 16; k++) {
			S.pats[k] = emptyPat();
		}
		S.plen.fill(1);
		S.tl.forEach((a) => a.fill(0));
		S.ts = 2;
		S.gu = 0;
		S.snap = 0;
		S.song.on = 0;
		S.song.sel = 0;
		S.song.chain.forEach((e, i) => {
			e.pat = i === 0 ? 0 : -1;
			e.rep = 1;
			e.mute = 0;
			e.dmute = 0;
			e.col = [0, 0, 0, 0];
		});
		S.song.jump = -1;
		S.song.go = 0;
		S.auto = {};
		applyGrid();
		S.pat = 0;
		S.patNext = -1;
		S.bpm = 120;
		S.rate = 1;
		S.sgate = 100;
		S.swing = 50;
		S.rec = false;
		S.recExt = false;
		S.countdown = null;
	}
	S.pop = null;
	S.toast = { s: ["", "TRACK CLEARED", "PATTERN CLEARED", "NEW SONG"][c], t: performance.now() };
}

/* a saved USER patch (from localStorage or an imported project) must have a name of 1-10 characters, a real engine and a snap object that applyPreset0 can read: one without
   (`{en:'FM'}`, ops that are not a list) used to be listed and then threw every time it was loaded. The bank holds 128. */
const USERMAX = 128;

function userOk(nm, u) {
	if (
		typeof nm !== "string" ||
		!nm.length ||
		nm.length > 10 ||
		!u ||
		typeof u !== "object" ||
		!Object.prototype.hasOwnProperty.call(ENGN, u.en)
	) {
		return false;
	}
	const s = u.snap;
	if (!s || typeof s !== "object" || Array.isArray(s)) {
		return false;
	}
	if (u.en === "FM") {
		return (
			Array.isArray(s.ops) &&
			s.ops.length === 6 &&
			s.ops.every((o) => o && typeof o === "object") &&
			!!s.lfo &&
			typeof s.lfo === "object"
		);
	}
	return true;
}

let USERP = {};

try {
	USERP = JSON.parse(localStorage.getItem("mellow-user") || "{}");
} catch (e) {
	USERP = {};
}

if (!USERP || typeof USERP !== "object" || Array.isArray(USERP)) {
	USERP = {};
}

{
	const ok = {};
	let n = 0;
	for (const nm in USERP) {
		if (n < USERMAX && userOk(nm, USERP[nm])) {
			ok[nm] = USERP[nm];
			PRESETS.push([nm, "USER", USERP[nm].en]);
			n++;
		}
	}
	USERP = ok;
}

// The preset list is grouped by category. Each category has a header row you can open and shut (tap it, or turn K4 GROUP for the category of
// the current preset); a shut category hides its presets and the encoders skip them. The ALL tab shows every category, any other tab just that one.
const PGROUPS = ["LOFI", "AMBIENT", "KEYS", "BASS", "PAD", "DRUMS", "USER"];

function pcol() {
	if (!S.pcol) {
		S.pcol = {};
		try {
			const o = JSON.parse(localStorage.getItem("mellow-pcol"));
			if (o && typeof o === "object") {
				S.pcol = o;
			}
		} catch (e) {
			/* nothing to do */
		}
	}
	return S.pcol;
}

function togglePGroup(c) {
	const o = pcol();
	o[c] = !o[c];
	try {
		localStorage.setItem("mellow-pcol", JSON.stringify(o));
	} catch (e) {
		/* nothing to do */
	}
}

// Favourites: one bit per preset (on the device 64 factory + 128 user presets = 192 bits = 24 bytes of flash; here a list of names in localStorage).
// K1 FAV on the presets page marks or unmarks the current preset; the FAV tab lists the marked ones (PAGE one click left of ALL).
let FAVS = new Set();

try {
	const o = JSON.parse(localStorage.getItem("mellow-fav"));
	if (Array.isArray(o)) {
		o.forEach((n) => {
			if (typeof n === "string" && n.length <= 10) {
				FAVS.add(n);
			}
		});
	}
} catch (e) {
	/* nothing to do */
}

const isFav = () => FAVS.has(PRESETS[S.preset][0]);

function favSet(nm, on) {
	if (on === FAVS.has(nm)) {
		return;
	}
	if (on) {
		FAVS.add(nm);
	} else {
		FAVS.delete(nm);
	}
	try {
		localStorage.setItem(
			"mellow-fav",
			JSON.stringify([...FAVS].filter((n) => PRESETS.some((p) => p[0] === n))),
		);
	} catch (e) {
		/* nothing to do */
	}
}

// The category tabs that fit in the row (the row follows the selected tab; ptabs().less / .more: tabs are hidden to the left / right) and the
// list window. The window follows the current preset, until the list is dragged (PROTOTYPE ONLY, like the song list): then it stays where it was put
// (PVW.top) until the category, sort, track, groups or the preset change by a knob.
function ptabs() {
	const ws = CATS.map((c) => TW(c) + 6),
		N = CATS.length,
		fit = (c0) => {
			let x = c0 ? 12 : 6;
			const o = [];
			for (let i = c0; i < N; i++) {
				if (x + ws[i] > (i < N - 1 ? 229 : 236)) {
					break;
				}
				o.push({ i, x, w: ws[i] });
				x += ws[i] + 2;
			}
			return o;
		};
	let c0 = 0,
		t = fit(0);
	while (c0 < N - 1 && !t.some((q) => q.i === S.pcat)) {
		c0++;
		t = fit(c0);
	}
	return { t, less: c0 > 0, more: !!t.length && t[t.length - 1].i < N - 1 };
}

const PVW = { top: null, key: "" },
	pvKey = () =>
		[
			S.pcat,
			S.psort,
			S._trk,
			S.preset,
			PRESETS.length,
			FAVS.size,
			PGROUPS.map((c) => (pcol()[c] ? 1 : 0)).join(""),
		].join("|");

function ptop(rows) {
	const mx = Math.max(0, rows.length - 8);
	if (PVW.top != null && PVW.key !== pvKey()) {
		PVW.top = null;
	}
	if (PVW.top != null) {
		return (PVW.top = clamp(PVW.top, 0, mx));
	}
	return clamp(
		Math.max(
			0,
			rows.findIndex((r) => r.i === S.preset),
		) - 3,
		0,
		mx,
	);
}

function pscroll(v) {
	PVW.top = clamp(Math.round(v), 0, Math.max(0, prows().length - 8));
	PVW.key = pvKey();
}

function prows() {
	const c = CATS[S.pcat],
		all = c === "ALL" || c === "DEVICE" || c === "FAV",
		cats = all ? PGROUPS : [c],
		rows = [];
	cats.forEach((cat) => {
		const L = PRESETS.map((p, i) => i).filter(
			(i) =>
				PRESETS[i][1] === cat &&
				presetFits(i) &&
				(c !== "DEVICE" || !PHONEP.has(PRESETS[i][0])) &&
				(c !== "FAV" || FAVS.has(PRESETS[i][0])),
		);
		if (S.psort) {
			L.sort((a, b) =>
				PRESETS[a][0] < PRESETS[b][0] ? -1 : PRESETS[a][0] > PRESETS[b][0] ? 1 : a - b,
			);
		}
		if (c === "FAV") {
			L.forEach((i) => rows.push({ i }));
			return;
		} /* favourites: one short flat list, no group headers */
		if (!L.length && all) {
			return;
		}
		rows.push({ h: 1, cat, n: L.length, shut: !!pcol()[cat] });
		if (!pcol()[cat]) {
			L.forEach((i) => rows.push({ i }));
		}
	});
	if (c === "FAV" && S.psort) {
		rows.sort((a, b) =>
			PRESETS[a.i][0] < PRESETS[b.i][0] ? -1 : PRESETS[a.i][0] > PRESETS[b.i][0] ? 1 : a.i - b.i,
		);
	}
	return rows;
}

function plist() {
	return prows()
		.filter((r) => !r.h)
		.map((r) => r.i);
}

function stepPreset(d) {
	const L = plist();
	if (!L.length) {
		return;
	}
	let k = L.indexOf(S.preset);
	k = k < 0 ? (d > 0 ? 0 : L.length - 1) : clamp(k + d, 0, L.length - 1);
	if (L[k] === S.preset) {
		return;
	}
	loadPreset(L[k]);
	if (S.paud) {
		audition();
	}
}

function audition() {
	if (!AC || BNC.on) {
		return;
	} /* a bounce records what you hear: changing sounds while it runs must not add the preview note to it */
	const t = AC.currentTime + 0.02,
		en = engOf(S.trk);
	if (en === "DRUM") {
		drumHit(S.trk, 0, 0.8, t);
		drumHit(S.trk, 2, 0.5, t + 0.25);
		drumHit(S.trk, 1, 0.7, t + 0.5);
	} else if (en === "SMP") {
		sampVoice(S.trk, S.smp.slice, 60, 0.8, t).off(t + 0.9);
	} else {
		noteVoice(S.trk, 60, 0.75, t, 0.5);
	}
}

function savePreset() {
	const nm = S.save.name.trim().slice(0, 10) || "UNTITLED",
		en = engOf(S.trk);
	const snap = JSON.parse(
		JSON.stringify(
			en === "FM"
				? {
						alg: S.alg,
						fb: S.fb,
						ops: S.ops,
						lfo: S.lfo,
						pegR: S.pegR,
						pegL: S.pegL,
						sync: S.sync,
						tr: S.tr,
					}
				: en === "ANA"
					? S.ana
					: en === "WAVE"
						? S.wt
						: en === "SMP"
							? { slice: S.smp.slice, st: S.smp.st, pitch: S.smp.pitch, dir: S.smp.dir }
							: {
									tune: S.drum.tune,
									dec: S.drum.dec,
									crush: S.drum.crush,
									vo: S.drum.vo || null,
								},
		),
	);
	const U = PRESETS.map((p, k) => (p[1] === "USER" ? k : -1)).filter(
		(k) => k >= 0,
	); /* slot n = the n-th user patch; the bank holds 128 */
	let i = PRESETS.findIndex((p) => p[1] === "USER" && p[0] === nm);
	if (i < 0) {
		const k = clamp(S.save.slot, 1, 128) - 1;
		if (k < U.length) {
			i = U[k];
			delete USERP[PRESETS[i][0]];
			PRESETS[i][0] = nm;
		} else {
			PRESETS.push([nm, "USER", en]);
			i = PRESETS.length - 1;
		}
	}
	PRESETS[i][2] = en;
	USERP[nm] = { en, snap };
	{
		const o = {};
		PRESETS.forEach((p) => {
			if (p[1] === "USER" && USERP[p[0]]) {
				o[p[0]] = USERP[p[0]];
			}
		});
		USERP = o;
	} /* keep the stored order = slot order */
	S.tracks[S.trk].pre = i;
	try {
		localStorage.setItem("mellow-user", JSON.stringify(USERP));
	} catch (e) {
		/* nothing to do */
	}
	S.pop = null;
	S.toast = { s: "SAVED " + nm, t: performance.now() };
}

// REC while playing writes what you play into the current track's pattern
A.recW = [new Set(), new Set(), new Set(), new Set()];
// the steps written by the recording in this pass, per track (REPLACE keeps them)
const snapPos = (p) => (snapOn() ? Math.round(p / unitSteps()) * unitSteps() : p);

// A step's GATE is a note LENGTH in percent of one step (100 = a whole step, 50 = staccato, 400 = four steps, up to the whole pattern). On the device it is ONE byte per step
// (the same third byte as before, no extra RAM): codes 0-100 are the old percent, 101-160 run 125%..1600% in quarter steps, 161-216 run 1800%..12800% in two-step jumps.
// The old meaning (percent of a step) is unchanged, so old saves play as before. gateQ() rounds a length to what that byte can hold.
const gateCode = (p) => {
		p = +p || 0;
		return p <= 100
			? clamp(Math.round(p), 0, 100)
			: p <= 1600
				? 100 + Math.round((p - 100) / 25)
				: Math.min(216, 160 + Math.round((p - 1600) / 200));
	},
	gateDec = (c) => (c <= 100 ? c : c <= 160 ? 100 + 25 * (c - 100) : 1600 + 200 * (c - 160));

const gateQ = (p) => gateDec(gateCode(p)),
	gateMax = (t) => gateQ(nstT(t) * 100);

const gateTxt = (g) => (g <= 100 ? g + "%" : +(g / 100).toFixed(2) + " ST");

function gateNudge(g, d, t) {
	for (let k = Math.abs(d); k > 0; k--) {
		if (d > 0) {
			g = g < 100 ? Math.min(100, g + 5) : gateDec(Math.min(216, gateCode(g) + 1));
		} else {
			g = g > 100 ? Math.max(100, gateDec(gateCode(g) - 1)) : Math.max(0, g - 5);
		}
	}
	return Math.min(g, gateMax(t));
}

// REC writes a note where it sounded and then its REAL length: the step's gate is set when the note ends (key up, HOLD / latch let go, the same key again, the queue's note ending, the arp's step),
// converted from seconds to steps and divided by the GATE page's share so playback gives the same seconds. A note still open when recording stops is closed at the stop.
A.recOpen = [];

function recAt(t, n, vel, when, key, pad, chord) {
	if (
		!S.rec ||
		!S.playing ||
		!AC ||
		(S.screen === "smp" && !pad) ||
		when < A.t0 - 0.005 ||
		engOf(t) === "DRUM" ||
		(engOf(t) === "SMP" && !key && !pad)
	) {
		return null;
	} /* pad: a sampler pad (a key on the SMP screen, or a queued pad step), which records on the SMP screen too */
	const ss = stepSec(),
		lat = key ? AC.outputLatency || AC.baseLatency || 0 : 0,
		pos = snapPos(Math.round((when - lat - A.t0) / ss)),
		N = nstT(t),
		i = ((pos % N) + N) % N,
		q = S.seqs[t];
	const h = { q, i, n, t0: when, t, done: 0, prev: [q.st[i], q.vel[i], q.gate[i], q.ch[i]] };
	A.recOpen.forEach((o) => {
		if (o.q === q && o.i === i) {
			o.done = 1;
			o.by = h;
			(h.sup || (h.sup = [])).push(o);
		}
	});
	A.recOpen = A.recOpen.filter(
		(o) => !o.done,
	); /* a note written on a cell that holds an open note replaces it; if the new one is taken back (a key press that turned into a swipe-right queue) the old one carries on (see recCancel) */
	q.st[i] = n;
	q.ch[i] = chord && chord.length ? chord : null;
	q.vel[i] = clamp(Math.round(vel * 127), 1, 127);
	q.gate[i] = 50;
	A.recW[t].add(i);
	A.recOpen.push(h);
	if (!key) {
		recLive(t, i, when, -1);
	}
	return h;
}

/* A note the queue writes is scheduled ahead of the playhead, so the scheduler could still reach that very step a moment later and play it a second time on top of the queue's own voice (the same note again lets go of the old voice, so the queued note was cut to nothing and recorded with the minimum length). recLive remembers what the queue just wrote (track, step, time, pad) and the scheduler skips exactly that cell this pass. */
A.recLive = [];

function recLive(t, i, when, pad) {
	A.recLive.push({ t, i, when, pad });
	if (A.recLive.length > 64) {
		A.recLive.shift();
	}
}

function recLiveSkip(t, k, when, pad) {
	const L = A.recLive;
	if (!L.length) {
		return false;
	}
	const i = k % nstT(t),
		ss = stepSec(),
		ct = AC ? AC.currentTime : 0;
	for (let j = L.length - 1; j >= 0; j--) {
		const e = L[j];
		if (e.when < ct - 2) {
			L.splice(j, 1);
			continue;
		}
		if (e.t === t && e.i === i && e.pad === pad && Math.abs(e.when - when) < ss * 1.2) {
			return true;
		}
	}
	return false;
}

function recNote(n, vel, chord) {
	if (!S.rec || !S.playing || !AC || S.screen === "smp" || AC.currentTime < A.t0 - 0.005) {
		return null;
	}
	if (S.trk === DT) {
		const ss = stepSec(),
			lat = AC.outputLatency || AC.baseLatency || 0,
			pos = snapPos(Math.round((AC.currentTime - lat - A.t0) / ss)),
			i = ((pos % nstT()) + nstT()) % nstT(),
			q = S.seqs[S.trk],
			idx = clamp(n - 36, 0, 7) * SMAX + i,
			prev = q.dg[idx];
		dgRec(q, i, n, vel);
		return { drum: 1, q, idx, prev, done: 0 };
	} /* a drum hit's record has a handle too: a pad key that turns out to be a swipe-right queue takes it back */
	return recAt(S.trk, n, vel, AC.currentTime, 1, undefined, chord);
}

function recClose(h, end) {
	if (!h) {
		return;
	}
	if (h.done) {
		if (h.by && h.late == null) {
			h.late = end > 0 ? end : AC ? AC.currentTime : 0;
		}
		return;
	} /* (a replaced note that ends meanwhile remembers when, in case it is given back) */
	if (h.drum) {
		h.done = 1;
		return;
	}
	h.done = 1;
	const k = A.recOpen.indexOf(h);
	if (k >= 0) {
		A.recOpen.splice(k, 1);
	}
	if (!AC || h.q.st[h.i] !== h.n) {
		return;
	}
	const e = end > 0 ? end : AC.currentTime;
	h.q.gate[h.i] = gateQ(
		clamp(
			Math.round(((Math.max(0, e - h.t0) / stepSec()) * 10000) / clamp(S.sgate, 20, 100)),
			5,
			gateMax(h.t),
		),
	);
}

function recCancel(h) {
	if (!h || h.done) {
		return;
	}
	if (h.drum) {
		h.done = 1;
		h.q.dg[h.idx] = h.prev;
		return;
	}
	h.done = 1;
	const k = A.recOpen.indexOf(h);
	if (k >= 0) {
		A.recOpen.splice(k, 1);
	}
	if (h.q.st[h.i] === h.n) {
		h.q.st[h.i] = h.prev[0];
		h.q.vel[h.i] = h.prev[1];
		h.q.gate[h.i] = h.prev[2];
		h.q.ch[h.i] = h.prev[3] || null;
		if (h.sup) {
			h.sup.forEach((o) => {
				if (o.by !== h) {
					return;
				}
				o.by = null;
				o.done = 0;
				if (o.late != null) {
					const e = o.late;
					o.late = null;
					recClose(o, e);
				} else {
					A.recOpen.push(o);
				}
			});
		}
	}
}
/* the note it had replaced is back (and ends when it ended, or when its voice does) */
function recCloseAll() {
	A.recOpen.slice().forEach((h) => recClose(h, AC ? AC.currentTime : 0));
}

function recVoice(h, v) {
	if (!h || !v || !v.off) {
		return;
	}
	const o = v.off;
	v.off = function (w) {
		recClose(h, w > 0 ? w : AC.currentTime);
		return o.apply(this, arguments);
	};
}
// the voice's note-off is the end of the recorded note
function recArp(t, n, when, sd) {
	if (!S.rec || !S.playing || !AC || when < A.t0 - 0.005) {
		return;
	}
	const ss = stepSec(),
		pos = snapPos(Math.round((when - A.t0) / ss)),
		i = ((pos % nstT(t)) + nstT(t)) % nstT(t),
		q = S.seqs[t];
	if (engOf(t) === "DRUM" || engOf(t) === "SMP") {
		return;
	}
	q.st[i] = n;
	q.ch[i] = null;
	q.vel[i] = 95;
	q.gate[i] = gateQ(
		clamp(
			Math.round((((sd * TK(t).arp.gate) / ss) * 100) / clamp(S.sgate, 20, 100)),
			5,
			gateMax(t),
		),
	);
	A.recW[t].add(i);
}

// Key detection: a 12-bin note histogram (what is in the patterns, plus the notes you have played lately, older ones fading)
// matched against the Krumhansl-Kessler major and minor key profiles. Cheap: 24 small sums.
const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
	KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function heardNote(m) {
	const h = A.heard;
	for (let i = 0; i < 12; i++) {
		h[i] *= 0.96;
	}
	h[((Math.round(m) % 12) + 12) % 12] += 1;
}

function detectKey() {
	const h = A.heard.slice();
	S.pats.forEach((P, pi) =>
		P.forEach((q, t) => {
			const e = engOf(t);
			if (e === "DRUM" || e === "SMP") {
				return;
			}
			q.st.slice(0, SPB() * (S.tl[pi][t] || S.plen[pi])).forEach((n) => {
				if (n >= 0) {
					h[n % 12] += 0.7;
				}
			});
		}),
	);
	let tot = 0;
	for (let i = 0; i < 12; i++) {
		tot += h[i];
	}
	if (tot < 4) {
		return null;
	}
	const mean = tot / 12;
	let sd = 0;
	for (let i = 0; i < 12; i++) {
		sd += (h[i] - mean) * (h[i] - mean);
	}
	if (sd <= 0) {
		return null;
	}
	const corr = (prof, r) => {
		let pm = 0;
		for (let i = 0; i < 12; i++) {
			pm += prof[i];
		}
		pm /= 12;
		let a = 0,
			b = 0;
		for (let i = 0; i < 12; i++) {
			const x = prof[(i - r + 12) % 12] - pm;
			a += (h[i] - mean) * x;
			b += x * x;
		}
		return a / Math.sqrt(sd * b);
	};
	let best = null;
	for (let r = 0; r < 12; r++) {
		for (const [prof, minor] of [
			[KK_MAJ, 0],
			[KK_MIN, 1],
		]) {
			const c = corr(prof, r);
			if (!best || c > best.r) {
				best = { root: r, minor, r: c };
			}
		}
	}
	return best.r >= 0.5 ? best : null;
}

const keyName = (k) => (k ? NN[k.root] + (k.minor ? " MIN" : " MAJ") : "---");

let keyCache = null,
	keyAt = 0;

function currentKey() {
	const t = performance.now();
	if (t - keyAt > 350) {
		keyAt = t;
		keyCache = detectKey();
	}
	return keyCache;
}

const tuneC = () => 1200 * Math.log2(S.glob.tune / 440),
	keyVel = () => [0.6, 0.85, 1, 0.8][S.glob.vel];

[0, 5, 7, 8].forEach((i) => applyPreset(i));
