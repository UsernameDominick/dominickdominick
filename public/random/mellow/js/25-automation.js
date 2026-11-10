// automation: recording and playing back parameter movement
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

const AUR = {},
	AUC = { bars: 1, armed: false, rec: null, tid: 0 };

const AU_N = 64,
	AU_BARS = [1, 2, 4, 8, 16],
	aLen = (a) => a.bars * SPB() * stepSec() * 1000;

const aRt = (id) =>
	AUR[id] || (AUR[id] = { t0: performance.now(), run: 0, last: -1, man: 0, ri: -1, rg: 0, rl: 0 });

const STRIPA = [
	null,
	["mac", 0, 0, 127],
	["mac", 1, 0, 127],
	["mac", 2, 0, 127],
	["mac", 3, 0, 127],
	["fx", "cut", 0, 127],
	["fx", "res", 0, 99],
	["fx", "rmix", 0, 100],
	["fx", "emix", 0, 100],
	["lfo", "pm", 0, 99],
	["lfo", "am", 0, 99],
	["", "vol", 0, 100],
];

// every strip target belongs to the track it was recorded on: 'tk.2.fx|cut' is track 3's cutoff, 'tracks.1|vol' is track 2's volume, 'bend0' is track 1's pitch
const stripAddr = (t, trk) => {
	const d = STRIPA[t];
	return d[0] === "" ? ["tracks." + trk, "vol"] : ["tk." + trk + "." + d[0], d[1]];
};

const stripId = (t, trk) => {
	if (trk == null) {
		trk = S._trk;
	}
	if (t === 0) {
		return "bend" + trk;
	}
	const a = stripAddr(t, trk);
	return a[0] + "|" + a[1];
};

function stripLane(t, mode, bars, sync, v, trk) {
	if (trk == null) {
		trk = S._trk;
	}
	const d = STRIPA[t],
		a = d ? stripAddr(t, trk) : ["", ""];
	return {
		name: MODT[t][0] + " T" + (trk + 1),
		path: a[0],
		key: a[1],
		lo: d ? d[2] : 0,
		hi: d ? d[3] : 1,
		v,
		bars,
		mode,
		sync,
	};
}

function aObj(path) {
	let o = S;
	if (path) {
		for (const p of path.split(".")) {
			o = o == null ? null : o[p];
		}
	}
	return o;
}

const AP = new WeakMap();

function aPathOf(target) {
	if (target === S) {
		return "";
	}
	if (AP.has(target)) {
		return AP.get(target);
	}
	let found = null;
	const seen = new Set();
	const dfs = (o, path, d) => {
		if (found !== null) {
			return;
		}
		if (o === target) {
			found = path;
			return;
		}
		if (d > 3 || o == null || typeof o !== "object" || seen.has(o)) {
			return;
		}
		seen.add(o);
		for (const k in o) {
			dfs(o[k], path ? path + "." + k : k, d + 1);
		}
	};
	for (const k of PARK()) {
		dfs(S[k], k, 0);
	}
	if (found !== null) {
		AP.set(target, found);
	}
	return found;
}

function aPhase(a, r, now) {
	return ((((now - r.t0) / aLen(a)) % 1) + 1) % 1;
}

function aValue(a, p) {
	const n = a.v.length,
		x = clamp(p, 0, 0.9999) * n,
		i = Math.floor(x),
		j = (i + 1) % n,
		f = x - i;
	return (a.v[i] * (1 - f) + a.v[j] * f) / 255;
}

const aActive = (id) => {
	const a = S.auto[id];
	return !!(a && a.v && (a.mode === 1 || (a.mode === 2 && aRt(id).run)));
};

function applyAuto(id, lane, v) {
	const r = aRt(id),
		q = Math.round(v * 1000);
	if (q === r.last) {
		return;
	}
	r.last = q;
	if (aBase(id).startsWith("bend")) {
		setBend(v * 2 - 1, +aBase(id).slice(4));
		return;
	}
	const o = aObj(lane.path);
	if (!o) {
		return;
	}
	const rg = laneRange(lane.path, lane.key),
		val = Math.round(
			clamp(
				lane.lo + v * (lane.hi - lane.lo),
				rg ? Math.max(lane.lo, rg[0]) : lane.lo,
				rg ? Math.min(lane.hi, rg[1]) : lane.hi,
			),
		);
	/* never outside the parameter's own range (a list index, an algorithm number), whatever the lane says */ if (
		o[lane.key] !== val
	) {
		o[lane.key] = val;
		if (lane.path === "adsr") {
			applyAdsr();
		}
		if (AC) {
			syncSoon();
		}
	}
}

const aCur = (t) => (t === 0 ? (A.bend + 1) / 2 : MODT[t][2]());

// the song's position in steps (bars of the chain so far, then the playhead)
const aSongSteps = () => (S.song.base || 0) + playPosF();

function songTotalBars() {
	let n = 0;
	songChain().forEach((e) => (n += S.plen[e.pat] * e.rep));
	return n || S.plen[S.pat];
}

// the player moved a parameter: it is theirs for a moment, and while recording with RECORD AUTOMATION on the movement is written into its lane
function aNoteId(id, path, key, lo, hi, name, v01) {
	const r = aRt(id),
		now = performance.now();
	r.man = now;
	r.last = -1;
	if (!(S.glob.arec && S.rec && S.playing && AC && A.on && !S.countdown)) {
		return;
	}
	let lane = S.auto[id];
	const b = Math.round(clamp(v01, 0, 1) * 255);
	if (!lane) {
		if (aFull()) {
			if (!r.rg || now - r.rg > 3000) {
				toast("AUTOMATION LIMIT " + NLANES);
			}
			r.rg = now;
			return;
		}
		const tb = S.song.on ? songTotalBars() : S.plen[S.pat];
		lane = {
			name,
			path,
			key,
			lo,
			hi,
			v: null,
			bars: AU_BARS.find((x) => x >= tb) || 16,
			mode: 1,
			sync: 0,
		};
		lane.v = new Array(AU_N * lane.bars).fill(b);
		undoPush();
		S.auto[id] = lane;
		toast("AUTOMATING " + name);
	} else if (!r.rg || now - r.rg > 1500) {
		undoPush();
	} // the first write of a gesture is one undo step
	r.rg = now;
	const N = lane.v.length,
		idx = Math.floor(((aSongSteps() / (lane.bars * SPB())) % 1) * N);
	if (r.ri < 0 || now - r.rl > 400) {
		r.ri = idx;
	}
	let i = r.ri,
		g = 0;
	lane.v[idx] = b;
	while (i !== idx && g++ < N) {
		i = (i + 1) % N;
		lane.v[i] = b;
	}
	r.ri = idx;
	r.rl = now;
}

function aName(l) {
	let c = "";
	if (S.screen === "pp") {
		const pg = ppPages(),
			cur = pg[clamp(S.ppPage, 0, pg.length - 1)];
		c = String(cur.t || "").replace(/^\d+\/\d+ /, "");
	}
	return (c && !String(l).startsWith(c) ? c + " " : "") + l;
}

function aNote(q) {
	if (!q || !q.ref) {
		return;
	}
	const [o, k, lo, hi] = q.ref,
		path = aPathOf(o);
	if (path === null) {
		return;
	}
	aNoteId(path + "|" + k, path, k, lo, hi, aName(q.l), (o[k] - lo) / (hi - lo));
}

function aNoteRaw(o, k, lo, hi, name) {
	const path = aPathOf(o);
	if (path === null) {
		return;
	}
	aNoteId(path + "|" + k, path, k, lo, hi, name, (o[k] - lo) / (hi - lo));
}

// every frame: drive the automations (not what the player is holding) and capture an armed strip recording
// ---- lanes scoped to a slot (`lane.slot` = chain index, absent or -1 = the whole song; id = address + '@' + slot, so one parameter can have a lane in every slot) ----
const NLANES = 16,
	aBase = (id) => id.split("@")[0],
	aIdOf = (b, s) => (s >= 0 ? b + "@" + s : b),
	aSlotOf = (a) => (a && a.slot >= 0 ? a.slot | 0 : -1),
	aFull = () => Object.keys(S.auto).length >= NLANES;

// the slot whose lanes may act now: the one the song is walking, or the dropped-down one that loops; -1 = none
function autoSlot() {
	if (!(S.playing && AC && A.on)) {
		return -1;
	}
	const sg = S.song;
	if (sg.on && sg.go) {
		return sg.pos;
	}
	if (nestOn()) {
		const e = sg.chain[NEST.i];
		if (e && e.pat >= 0 && e.pat === S.pat) {
			return NEST.i;
		}
	}
	return -1;
}

// steps since the slot began (its repeats so far plus the playhead in this pass)
function aSlotSteps() {
	const n = nst(),
		sg = S.song;
	return (sg.on && sg.go ? sg.rc * n : 0) + (Math.max(0, playPosF()) % n);
}

const aCurOf = (id, a) => {
	const b = aBase(id);
	if (b.startsWith("bend")) {
		return A.bnd[+b.slice(4)];
	}
	const o = aObj(a.path);
	return o ? o[a.key] : undefined;
};

function aRelease(id, a, r) {
	const b = aBase(id),
		was = r.base;
	r.base = undefined;
	r.last = -1;
	if (was === undefined || r.man > r.bt) {
		return;
	} // the player touched it meanwhile: it stays theirs
	if (b.startsWith("bend")) {
		setBend(was, +b.slice(4));
		return;
	}
	const o = aObj(a.path);
	if (o && o[a.key] !== was) {
		o[a.key] = was;
		if (a.path === "adsr") {
			applyAdsr();
		}
		if (AC) {
			syncSoon();
		}
	}
}

function autoStep(now) {
	const as = autoSlot(),
		sh = new Set();
	if (as >= 0) {
		for (const id in S.auto) {
			const a = S.auto[id];
			if (a && a.v && a.mode && aSlotOf(a) === as) {
				sh.add(aBase(id));
			}
		}
	} // the slot that plays, and the parameters its own lanes hold right now
	for (const id in S.auto) {
		const lane = S.auto[id];
		if (!lane || !lane.v) {
			continue;
		}
		const r = aRt(id),
			ls = aSlotOf(lane);
		if (ls >= 0 && (ls !== as || !lane.mode)) {
			if (r.on) {
				r.on = 0;
				aRelease(id, lane, r);
			}
			continue;
		} // a lane scoped to a slot acts only while that slot plays, then the parameter goes back to where it was
		if (!lane.mode) {
			continue;
		}
		if (ls < 0 && sh.has(aBase(id))) {
			r.last = -1;
			continue;
		} // a slot's own lane wins over the song-wide one on the same parameter while that slot plays
		if (now - r.man < 350 || (MOD.act && id === stripId(MOD.t))) {
			continue;
		}
		let v;
		if (ls >= 0 && !r.on) {
			r.on = 1;
			r.bt = now;
			r.base = aCurOf(id, lane);
			if (lane.mode === 2) {
				r.run = 1;
				r.t0 = now;
			}
		}
		if (lane.mode === 1) {
			if (lane.sync === 1) {
				v = aValue(lane, aPhase(lane, r, now));
			} else {
				if (!(S.playing && AC && A.on)) {
					continue;
				}
				const L = lane.bars * SPB();
				v = aValue(lane, ((ls >= 0 ? aSlotSteps() : aSongSteps()) % L) / L);
			}
		} else if (r.run) {
			const el = now - r.t0,
				L = aLen(lane);
			if (el >= L) {
				r.run = 0;
				v = aValue(lane, 0.9999);
			} else {
				v = aValue(lane, el / L);
			}
		} else {
			continue;
		}
		applyAuto(id, lane, v);
	}
	const rc = AUC.rec;
	if (rc) {
		if (!MOD.act) {
			aFinish();
		} else {
			const N = AU_N * AUC.bars,
				cur = Math.round(clamp(aCur(rc.t), 0, 1) * 255);
			let idx;
			if (S.playing && AC && A.on) {
				idx = Math.floor(((aSongSteps() / (AUC.bars * SPB())) % 1) * N);
				if (rc.last < 0) {
					rc.last = idx;
					rc.v[idx] = cur;
					rc.cnt = 1;
				} else if (idx !== rc.last) {
					let i = rc.last;
					while (i !== idx) {
						i = (i + 1) % N;
						rc.v[i] = cur;
						rc.cnt++;
					}
					rc.last = idx;
					if (rc.cnt >= N) {
						aFinish();
					}
				} else {
					rc.v[idx] = cur;
				}
			} else {
				idx = Math.floor(((now - rc.t0) / (AUC.bars * SPB() * stepSec() * 1000)) * N);
				if (idx >= N) {
					for (let i = Math.max(0, rc.last + 1); i < N; i++) {
						rc.v[i] = cur;
					}
					rc.last = N - 1;
					aFinish();
				} else {
					for (let i = Math.max(0, rc.last + 1); i <= idx; i++) {
						rc.v[i] = cur;
					}
					rc.last = idx;
				}
			}
		}
	}
}

function aFinish() {
	const rc = AUC.rec;
	AUC.rec = null;
	AUC.armed = false;
	if (!rc) {
		return;
	}
	const N = AU_N * AUC.bars,
		v = rc.v;
	let first = -1;
	for (let i = 0; i < N; i++) {
		if (v[i] !== undefined) {
			first = i;
			break;
		}
	}
	if (first < 0) {
		return;
	}
	let prev = v[first];
	for (let k = 0; k < N; k++) {
		const i = (first + k) % N;
		if (v[i] === undefined) {
			v[i] = prev;
		} else {
			prev = v[i];
		}
	}
	const id = stripId(rc.t, rc.trk),
		old = S.auto[id];
	if (!old && aFull()) {
		toast("AUTOMATION LIMIT " + NLANES);
		return;
	}
	undoPush("AUTOMATION");
	S.auto[id] = stripLane(
		rc.t,
		(old && old.mode) || 1,
		AUC.bars,
		rc.playing ? 0 : 1,
		Array.from(v, (x) => x | 0),
		rc.trk,
	);
	const r = aRt(id);
	r.t0 = performance.now();
	r.run = 0;
	r.last = -1;
	toast("AUTOMATION RECORDED");
}

function aStart(t) {
	AUC.armed = true;
	AUC.rec = null;
	AUC.tid = t;
	toast("TOUCH THE STRIP AND MOVE");
}

function fmTuneNow(trk) {
	return Math.round(Math.log2(S.glob.tune / 440) * 16777216) + (A.bndU[trk] || 0);
}

function pushFmTune() {
	const tn = [0, 1, 2, 3].map(fmTuneNow),
		k = tn.join();
	if (A.fmTune !== k) {
		A.fmTune = k;
		if (A.fmw) {
			A.fmw.port.postMessage({ k: "cfg", tunes: tn });
		}
	}
}

// pitch bend is per track: each track has its own bend, its own spring and its own automation lane
function setBend(b, trk) {
	if (trk == null) {
		trk = S._trk;
	}
	b = clamp(b, -1, 1);
	if (Math.abs(b) < 0.004) {
		b = 0;
	}
	if (b === A.bnd[trk]) {
		return;
	}
	A.bnd[trk] = b;
	const semi = b > 0 ? b * S.glob.pu : b * S.glob.pdn;
	A.bndC[trk] = semi * 100;
	A.bndU[trk] = Math.round((semi / 12) * 16777216);
	if (AC) {
		pushFmTune();
		const c = A.bendCs[trk];
		if (c) {
			bendSync(trk);
			c.offset.setTargetAtTime(A.bndC[trk], AC.currentTime, 0.012);
		}
	}
	midiBend(b, trk);
}

function midiBend(b, trk) {
	if (A.fromMidi || S.glob.out === 3 || !MIDI.outs.length) {
		return;
	}
	const v = clamp(Math.round(((b + 1) / 2) * 16383), 0, 16383),
		ch = midiCh(trk);
	midiSend([0xe0 | ch, v & 127, v >> 7]);
}

function modStripInit(strip) {
	let sx = 0,
		v0 = 0.5,
		w = 1,
		moved = false,
		id = -1,
		t0 = 0;
	const note = () => {
		const t = MOD.t,
			i = stripId(t);
		if (t === 0) {
			aNoteId(i, "", "", 0, 1, "PITCH T" + (S._trk + 1), (A.bend + 1) / 2);
		} else {
			const d = STRIPA[t],
				ad = stripAddr(t, S._trk);
			aNoteId(i, ad[0], ad[1], d[2], d[3], MODT[t][0] + " T" + (S._trk + 1), aCur(t));
		}
	};
	const apply = (x) => {
		const dv = (x - sx) / w;
		if (MOD.t === 0) {
			MOD.sprT.add(S._trk);
			setBend(clamp((v0 + dv) * 2 - 1, -1, 1));
		} // half the strip's width is full bend
		else {
			const T = MODT[MOD.t],
				v = clamp(v0 + dv, 0, 1);
			T[1](v);
			if (AC) {
				syncSoon();
			}
			S.hot = null;
		}
		note();
	};
	strip.addEventListener("pointerdown", (e) => {
		e.preventDefault();
		ensureAudio();
		id = e.pointerId;
		sx = e.clientX;
		w = Math.max(60, strip.getBoundingClientRect().width);
		moved = false;
		MOD.down = true;
		t0 = performance.now();
		try {
			strip.setPointerCapture(e.pointerId);
		} catch (x) {
			/* nothing to do */
		}
	});
	strip.addEventListener("pointermove", (e) => {
		if (!MOD.down || e.pointerId !== id) {
			return;
		}
		if (!moved && Math.abs(e.clientX - sx) > 6) {
			moved = true;
			MOD.act = true; /* the player takes the strip: from where the value is now (an automation's current value too) */
			v0 = MOD.t === 0 ? (aActive(stripId(0)) ? (A.bend + 1) / 2 : 0.5) : MODT[MOD.t][2]();
			if (AUC.armed && !AUC.rec) {
				AUC.rec = {
					t: MOD.t,
					trk: S._trk,
					t0: performance.now(),
					v: new Array(AU_N * AUC.bars),
					last: -1,
					cnt: 0,
					playing: !!(S.playing && AC && A.on),
				};
			}
		}
		if (moved) {
			apply(e.clientX);
		}
	});
	const end = (e) => {
		if (e.pointerId !== id) {
			return;
		}
		const tap = !moved && e.type === "pointerup" && performance.now() - t0 < 400,
			wasAct = MOD.act;
		MOD.down = false;
		MOD.act = false;
		id = -1; // pitch springs back to centre by itself (see frame), an automation snaps back in
		if (wasAct) {
			const r = AUR[stripId(MOD.t)];
			if (r) {
				r.man = 0;
				r.last = -1;
			}
		}
		if (tap) {
			const a = S.auto[stripId(MOD.t)];
			if (a && a.v && a.mode === 2) {
				const r = aRt(stripId(MOD.t));
				r.run = 1;
				r.t0 = performance.now();
				r.last = -1;
			}
		}
	};
	["pointerup", "pointercancel"].forEach((ev) => strip.addEventListener(ev, end));
}
