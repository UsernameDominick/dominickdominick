// recording: count-in, loop overdub, undo and redo, save
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

const PARK = () => PROJ.filter((k) => k !== "oct").concat(["vol"]);
// the sound and parameter state that undo also takes back
function songSnap(full) {
	const o = {
		l: S.plen.slice(),
		tl: S.tl.map((a) => a.slice()),
		t: S.ts,
		g: S.gu,
		n: S.snap,
		sg: { on: S.song.on, chain: S.song.chain },
		au: S.auto,
		p: S.pats.map((P, pi) =>
			P.map((q, t) => {
				const n = SPB() * (S.tl[pi][t] || S.plen[pi]);
				return {
					st: q.st.slice(0, n),
					gate: q.gate.slice(0, n),
					vel: q.vel.slice(0, n),
					...dgSnap(q, t, n),
				};
			}),
		),
	};
	if (full) {
		o.par = {};
		PARK().forEach((k) => {
			o.par[k] = S[k];
		});
	}
	return JSON.stringify(o);
}

// lanes saved before the tracks had their own banks belonged to "the" sound: they become track 1's
function aMigrate(id, a) {
	const path = typeof a.path === "string" ? a.path : "",
		key = a.key != null ? a.key : "";
	if (id === "bend") {
		return ["bend0", ""];
	}
	if (/^tk\.|^tracks\./.test(path)) {
		return [id, path];
	}
	if (path === "" && key === "vol") {
		return ["tracks.0|vol", "tracks.0"];
	}
	if (TKK.includes(path.split(".")[0])) {
		const np = "tk.0." + path;
		return [np + "|" + key, np];
	}
	return [id, path];
}

/* ---- a saved, imported or undone project is untrusted data: it is fitted to the shape and ranges of the live state before it is used, so a corrupt, hostile or
   older file can never put NaN, a string, a missing field or a wrong-sized array into the sound banks (which used to throw in the audio code or on the screens) ----
   parFit(b, v, k): b = the boot value (the shape), v = what the file holds, k = the dotted name that picks a range from PAR_R. Numbers must be finite (else b), arrays keep
   b's length, objects keep b's keys (plus any extra number/string/flag the file has, fitted the same way), and the fields that are INDEXES into a list (algorithm, wave,
   scale, filter type, preset...) are clamped to the list. A snapshot the app made itself passes through unchanged. */
const PAR_R = {
	alg: [1, 32],
	fb: [0, 7],
	"ops.mode": [0, 1],
	"ops.co": [0, 31],
	"ops.fi": [0, 99],
	"ops.de": [-7, 7],
	"ops.lv": [0, 99],
	"ops.R": [0, 99],
	"ops.L": [0, 99],
	"ops.bp": [0, 99],
	"ops.ld": [0, 99],
	"ops.rd": [0, 99],
	"ops.lc": [0, 3],
	"ops.rc": [0, 3],
	"ops.rs": [0, 7],
	"ops.ams": [0, 3],
	"ops.kvs": [0, 7],
	pegR: [0, 99],
	pegL: [0, 99],
	"lfo.w": [0, 5],
	"lfo.sy": [0, 1],
	"ana.w1": [0, 3],
	"ana.w2": [0, 3],
	"wt.tab": [0, 5],
	"smp.slice": [0, 7],
	"smp.dir": [0, 2],
	"drum.sel": [0, 7],
	"drum.tune": [0, 99],
	"drum.dec": [0, 99],
	"drum.crush": [0, 99],
	"fx.slot": [0, 3],
	"fx.ft": [0, 2],
	"fx.et": [0, 3],
	"fx.rt": [0, 3],
	"arp.mode": [0, 5],
	"arp.rate": [0, 5],
	"arp.oct": [1, 4],
	"scale.root": [0, 11],
	"scale.type": [0, 8],
	"scale.chord": [0, 4],
	"scale.spread": [1, 3],
	"scale.hl": [0, 1],
	"scale.only": [0, 1],
	modT: [0, 11],
	"tracks.vol": [0, 100],
	bpm: [30, 300],
	rate: [0, 2],
	sgate: [20, 100],
	swing: [50, 75],
	vol: [0, 100],
};

const parRng = (k) => (k === "tracks.pre" ? [0, PRESETS.length - 1] : PAR_R[k]);

const parNum = (v, k, d) => {
	if (typeof v !== "number" || !isFinite(v)) {
		return d;
	}
	const r = parRng(k);
	return r ? clamp(Math.round(v), r[0], r[1]) : clamp(v, -1000, 1000);
};

function parVo(v) {
	if (!Array.isArray(v)) {
		return null;
	}
	return Array.from({ length: 8 }, (_, i) => {
		const e = v[i];
		return Array.isArray(e)
			? Array.from({ length: 8 }, (_, j) =>
					typeof e[j] === "number" && isFinite(e[j]) ? clamp(Math.round(e[j]), 0, 15) : 8,
				)
			: null;
	});
}
// the kit voicing: 8 pads of null (the original voice) or 8 nibbles
function parFree(v, k, d) {
	if (typeof v === "number") {
		return parNum(v, k, undefined);
	}
	if (typeof v === "boolean") {
		return v;
	}
	if (typeof v === "string") {
		return v.slice(0, 40);
	}
	if (v === null) {
		return null;
	}
	if (!v || typeof v !== "object" || d > 3) {
		return undefined;
	}
	if (Array.isArray(v)) {
		return v.slice(0, 64).map((x) => {
			const r = parFree(x, k, d + 1);
			return r === undefined ? 0 : r;
		});
	}
	const o = {};
	let n = 0;
	for (const key in v) {
		if (n++ >= 40) {
			break;
		}
		if (key === "__proto__") {
			continue;
		}
		const r = parFree(v[key], k ? k + "." + key : key, d + 1);
		if (r !== undefined) {
			o[key] = r;
		}
	}
	return o;
}

function parFit(b, v, k) {
	if (k === "drum.vo") {
		return parVo(v);
	}
	if (typeof b === "number") {
		return parNum(v, k, b);
	}
	if (typeof b === "boolean") {
		return typeof v === "boolean" ? v : b;
	}
	if (typeof b === "string") {
		return typeof v === "string" ? v.slice(0, 40) : b;
	}
	if (Array.isArray(b)) {
		const a = Array.isArray(v) ? v : [];
		return b.map((x, i) => parFit(x, a[i], k));
	}
	if (b && typeof b === "object") {
		const o = {},
			s = v && typeof v === "object" && !Array.isArray(v) ? v : {};
		for (const key in b) {
			o[key] = parFit(b[key], s[key], k ? k + "." + key : key);
		}
		for (const key in s) {
			if (key in b || key === "__proto__") {
				continue;
			}
			const r = parFree(s[key], k ? k + "." + key : key, 0);
			if (r !== undefined) {
				o[key] = r;
			}
		}
		return o;
	}
	return parFree(v, k, 0);
}

// what the file's sound state is fitted to: the boot banks (S0) for the project keys, the live value for the master volume
const parBase = (k) => (k === "vol" ? S.vol : S0[k]);

function parApply(par) {
	if (!par || typeof par !== "object") {
		return;
	}
	PARK().forEach((k) => {
		if (k in par && parBase(k) !== undefined) {
			S[k] = parFit(parBase(k), par[k], k === "tk" ? "" : k);
		}
	});
	bindTrack(S._trk);
}

// a lane may only drive a number inside the sound banks (never the song chain, the patterns or anything else of S): its path is checked here, its value is clamped on every write (applyAuto)
const LANE_PATH = /^(|gen|tracks\.[0-3]|scape\.[0-3]|tk\.[0-3](\.\w+)*)$/;

function laneTargetOk(id, path, key) {
	if (aBase(id).startsWith("bend")) {
		return true;
	}
	if (!LANE_PATH.test(path) || (typeof key !== "string" && typeof key !== "number")) {
		return false;
	}
	const o = aObj(path);
	return !!o && typeof o === "object" && typeof o[key] === "number";
}

const laneRange = (path, key) => {
	const pp = path.replace(/^tk\.\d\.?/, "").replace(/\.\d+/g, "");
	return parRng(/^\d+$/.test(String(key)) ? pp : pp ? pp + "." + key : String(key));
};
// the same table, by where the lane writes
function songRestore(js, withPar) {
	const d0 = JSON.parse(js);
	if (!d0 || typeof d0 !== "object") {
		throw new Error("not a project");
	}
	const d = Array.isArray(d0) ? d0 : Array.isArray(d0.p) ? d0.p : [];
	if (typeof d0.t === "number" && d0.t >= 0 && d0.t < TSIGS.length) {
		S.ts = d0.t | 0;
	}
	if (d0.g >= 0 && d0.g <= 2) {
		S.gu = d0.g | 0;
	}
	if (d0.n === 0 || d0.n === 1) {
		S.snap = d0.n;
	}
	if (d0.au && typeof d0.au === "object") {
		S.auto = {};
		for (const k in d0.au) {
			const a = d0.au[k];
			if (!a || !Array.isArray(a.v) || a.v.length < 2 || a.v.length > AU_N * 16) {
				continue;
			}
			if (aFull()) {
				break;
			}
			const num = /^\d+$/.test(k);
			let id = k,
				lane;
			if (num) {
				const t = +k;
				if (t < 0 || t >= STRIPA.length) {
					continue;
				}
				id = stripId(t);
				lane = stripLane(t, 0, 1, 0, []);
			} else {
				lane = { name: "", path: "", key: "", lo: 0, hi: 1 };
				const m = aMigrate(id, a);
				id = m[0];
				a.path = m[1];
			}
			const lp = typeof a.path === "string" ? a.path : lane.path,
				lk = a.key != null ? a.key : lane.key;
			if (!laneTargetOk(id, lp, lk)) {
				continue;
			} // a lane that points anywhere but at a number of the sound banks is dropped
			const sl = a.slot >= 0 && a.slot < 16 ? a.slot | 0 : -1;
			id = aIdOf(aBase(id), sl); // a lane without a slot (an older save) plays the whole song
			S.auto[id] = Object.assign(lane, {
				name: String(a.name || lane.name || id).slice(0, 40),
				path: lp,
				key: lk,
				lo: clamp(+a.lo || (num ? lane.lo : 0), -1000, 1000),
				hi: clamp(+a.hi || lane.hi, -1000, 1000),
				v: a.v.map((x) => clamp(x | 0, 0, 255)),
				bars: AU_BARS.includes(a.bars | 0) ? a.bars | 0 : 1,
				mode: clamp(a.mode | 0, 0, 2),
				sync: a.sync ? 1 : 0,
				slot: sl,
			});
			if (num && a.sync === undefined) {
				S.auto[id].sync = 1;
			}
		}
	} else {
		S.auto = {};
	} /* a project with no lanes (an older file) has none: it used to keep the lanes of whatever was open */
	if (d0.sg && Array.isArray(d0.sg.chain)) {
		S.song.on = d0.sg.on ? 1 : 0;
		S.song.chain = songClean(d0.sg.chain);
	}
	if (withPar) {
		parApply(d0.par);
	}
	applyGrid();
	if (Array.isArray(d0.l)) {
		d0.l.slice(0, 16).forEach((b, pi) => {
			S.plen[pi] = clamp(b | 0, 1, maxBars());
		});
	}
	if (Array.isArray(d0.tl)) {
		d0.tl.slice(0, 16).forEach((a, pi) => {
			if (Array.isArray(a)) {
				for (let t = 0; t < 4; t++) {
					S.tl[pi][t] = clamp(a[t] | 0, 0, maxBars());
				}
			}
		});
	} /* an older save is just the patterns (one bar each) */
	/* every cell is coerced: a note is a whole number -1..127, a gate 0..12800 (percent of a step), a velocity 0..127; anything else (a string, null, NaN, a missing array) becomes an empty step as emptyPat() makes it */
	const cell = (x, a, b, e) => (typeof x === "number" && isFinite(x) ? clamp(x, a, b) : e);
	d.slice(0, 16).forEach((P, pi) => {
		if (Array.isArray(P)) {
			P.slice(0, 4).forEach((q, t) => {
				const o = S.pats[pi] && S.pats[pi][t];
				if (!o || !q || !Array.isArray(q.st)) {
					return;
				}
				const g = Array.isArray(q.gate) ? q.gate : [],
					v = Array.isArray(q.vel) ? q.vel : [];
				for (let i = 0; i < q.st.length && i < SMAX; i++) {
					o.st[i] = Math.round(cell(q.st[i], -1, 127, -1));
					o.gate[i] = cell(g[i], 0, 12800, 50);
					o.vel[i] = cell(v[i], 0, 127, 100);
				}
				if (t === DT) {
					dgRestore(o, q);
				}
			});
		}
	});
	S.seqs.forEach((q) => {
		if (q.sel >= nst()) {
			q.sel = nst() - 1;
		}
	});
}

function undoPush(lb) {
	const js = songSnap(true),
		tail = UND.u.length ? UND.u[UND.u.length - 1] : null;
	if (tail !== null && tail.endsWith("\x1f" + js)) {
		return;
	}
	UND.u.push((lb || "") + "\x1f" + js);
	if (UND.u.length > 16) {
		UND.u.shift();
	}
	UND.r.length = 0;
}

const UNDO_TXT = (e) => {
	const i = e.indexOf("\x1f");
	return [e.slice(0, i), e.slice(i + 1)];
};

function undo() {
	if (!UND.u.length) {
		toast("NOTHING TO UNDO");
		return;
	}
	const [lb, js] = UNDO_TXT(UND.u.pop());
	UND.r.push(lb + "\x1f" + songSnap(true));
	songRestore(js, true);
	afterRestore();
	toast("UNDO" + (lb ? " " + lb : "") + "  \u00b7  " + UND.u.length + " LEFT");
}

function redo() {
	if (!UND.r.length) {
		toast("NOTHING TO REDO");
		return;
	}
	const [lb, js] = UNDO_TXT(UND.r.pop());
	UND.u.push(lb + "\x1f" + songSnap(true));
	songRestore(js, true);
	afterRestore();
	toast("REDO" + (lb ? " " + lb : "") + "  \u00b7  " + UND.r.length + " LEFT");
}

// after undo or redo the sound may have changed: tell the audio engine, drop the glow
function afterRestore() {
	S.hot = null;
	S.pop = null;
	pT = 0;
	pK = "";
	if (AC) {
		syncSoon();
		audioSync();
	}
}
/* pT / pK: a knob turn right after an undo is a NEW step (it used to join the undone gesture, push nothing and be thrown away by the next redo) */
// parameter edits (a knob turn, a graph drag, a swipe on a value) are undone as one step per gesture: a turn that carries on within 0.65 s is the same step
let pT = 0,
	pK = "";

function pPush(key, lb) {
	const t = performance.now();
	if (t - pT > 650 || key !== pK) {
		undoPush(lb);
	}
	pT = t;
	pK = key;
}

/* The whole project (patterns, lengths, song chain, automation AND every track's sound and settings, `songSnap(true)`) is written to localStorage (the stand-in for flash)
   by `autoSave`: every 4 s while something changed, whenever the page is hidden or closed, and when a recording stops or a file is imported. It is skipped while a
   bounce is running (the bounce borrows the song state) and in a locked tab. The JSON is compared first, so an idle page writes nothing. */
let SAVED = "";

function autoSave() {
	try {
		if ((typeof tabLocked !== "undefined" && tabLocked) || (typeof BNC !== "undefined" && BNC.on)) {
			return false;
		}
		const js = JSON.stringify({
			p: songSnap(true),
			full: 1,
			bpm: S.bpm,
			rate: S.rate,
			swing: S.swing,
			sgate: S.sgate,
		});
		if (js === SAVED) {
			return false;
		}
		localStorage.setItem("mellow-song", js);
		SAVED = js;
		return true;
	} catch (e) {
		return false;
	}
}

function saveSong() {
	autoSave();
}

setInterval(autoSave, 4000);

document.addEventListener("visibilitychange", () => {
	if (document.hidden) {
		autoSave();
	}
});

addEventListener("pagehide", autoSave);

function loadSong() {
	try {
		const d = JSON.parse(localStorage.getItem("mellow-song"));
		if (d && typeof d.p === "string") {
			songRestore(d.p, !!d.full);
			if (d.full) {
				try {
					dgForceKit();
				} catch (e) {
					/* nothing to do */
				}
			}
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
		}
	} catch (e) {
		/* nothing to do */
	}
}

function clickAt(t, acc) {
	if (!AC) {
		return;
	}
	const o = AC.createOscillator(),
		g = AC.createGain();
	o.frequency.value = acc ? 1500 : 1000;
	g.gain.setValueAtTime(0, t);
	g.gain.linearRampToValueAtTime(acc ? 0.28 : 0.18, t + 0.002);
	g.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);
	o.connect(g);
	g.connect(A.master);
	o.start(t);
	o.stop(t + 0.06);
	o.onended = () => {
		try {
			g.disconnect();
		} catch (e) {
			/* nothing to do */
		}
	};
}

function startCountIn(ext) {
	if (!AC) {
		return;
	}
	stopSeq();
	S.seqEn = true;
	S.rec = true;
	S.playing = true;
	S.patNext = -1;
	S.recExt = !!ext;
	songStart();
	if (S.screen !== "seq") {
		S.screen = "seq";
	}
	const beat = ((60 / S.bpm) * 4) / TSIGS[S.ts][1],
		n = TSN() * S.glob.cin,
		t0 = AC.currentTime + 0.08;
	S.countdown = n ? { t0, beat, n, next: 0 } : null;
	A.t0 = t0 + n * beat;
	A.sn = 0;
	S.t0 = performance.now() + (A.t0 - AC.currentTime) * 1000;
	undoPush("RECORDING");
}

// RECORD LENGTH = GROWS (extend recording): the pattern is not looped, it grows a bar at a time as you play past its end; stopping cuts it back to the
// last bar you reached and saves it.
function extendOne() {
	const L = S.plen[S.pat];
	if (L >= maxBars()) {
		S.recExt = false;
		toast("LONGEST LENGTH: NOW LOOPING");
		return false;
	}
	const a = L * SPB(),
		b = (L + 1) * SPB();
	S.plen[S.pat] = L + 1;
	S.seqs.forEach((q, t) => {
		if (t === DT) {
			dgClearCols(q, a, b);
		}
		if (S.tl[S.pat][t]) {
			return;
		}
		for (let i = a; i < b; i++) {
			q.st[i] = -1;
			q.gate[i] = 50;
			q.vel[i] = 100;
		}
	});
	return true;
}

function trimToPlayed() {
	if (!AC) {
		return;
	}
	const lat = AC.outputLatency || AC.baseLatency || 0,
		played = Math.max(0, (AC.currentTime - lat - A.t0) / stepSec());
	const bars = clamp(Math.ceil(played / SPB() - 1e-6), 1, maxBars());
	S.plen[S.pat] = Math.min(S.plen[S.pat], bars);
	S.seqs.forEach((q) => {
		if (q.sel >= nst()) {
			q.sel = nst() - 1;
		}
	});
}

function finishRec() {
	S.countdown = null;
	if (S.recExt) {
		S.recExt = false;
		trimToPlayed();
	}
	saveSong();
	toast("SAVED");
}
