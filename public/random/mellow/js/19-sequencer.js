// the sequencer and the scheduler
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---------- sequencer, arp, drift ----------
function stepPlay(t, k, when) {
	if (t === DT) {
		drumStep(t, k, when);
		return;
	} /* the drum track plays its grid */
	const q = S.seqs[t],
		i = k % nstT(t),
		n = q.st[i];
	if (n < 0) {
		return;
	}
	if (A.recLive.length && recLiveSkip(t, k, when, -1)) {
		return;
	}
	if (SPLOG.l) {
		SPLOG.l.push([t, S.pat, S.song.pos]);
	}
	const vel = q.vel[i] / 127,
		en = engOf(t),
		ss = stepSec();
	if (en === "DRUM") {
		drumHit(t, clamp(n - 36, 0, 7), vel, when);
		return;
	}
	if (en === "SMP") {
		const v = sampVoice(t, clamp(n - 36, 0, 7), 60, vel, when);
		A.seqV.push(v);
		sqAdd(t, when, v);
		return;
	}
	const v = noteVoice(t, n, vel, when, Math.max(0.03, ((q.gate[i] / 100) * ss * S.sgate) / 100));
	A.seqV.push(v);
	sqAdd(t, when, v);
}

/* A.sq: the sequenced sounds of the last few seconds (voices and drum hits, by track), so a song mute can cancel what is already scheduled in the look-ahead and let go of what sounds. A.sl: the steps the scheduler passed recently with the mask each had, so an un-mute can fill in the steps it skipped. */
function sqAdd(t, when, v) {
	if (v) {
		A.sq.push({ t, when, v });
	}
	if (A.sq.length > 400) {
		A.sq.splice(0, 100);
	}
}

function songMuteCut(t) {
	const now = AC.currentTime;
	A.sq = A.sq.filter((e) => {
		if (e.t !== t) {
			return e.when > now - 4;
		}
		if (e.v) {
			if (!e.v.dead && !e.v.stolen && e.v.cut) {
				e.v.cut(true);
			}
		} else if (e.g && e.end > now) {
			const p = e.g.gain;
			try {
				p.cancelScheduledValues(now);
				p.setTargetAtTime(0, now, 0.004);
			} catch (x) {
				/* nothing to do */
			}
		}
		return false;
	});
}

function songUnmuteFill(t) {
	const ct = AC.currentTime,
		sg = S.song;
	A.sl.forEach((e) => {
		if ((e.sm >> t) & 1 && e.pos === sg.pos && e.pat === S.pat && e.when > ct + 0.012) {
			e.sm &= ~(1 << t);
			if (!(S.rec && TK(t).arp.on && A.arps[t].size)) {
				A.sqOn = t;
				A.dmCur = t === DT ? songPadMask() : 0;
				stepPlay(t, e.sn, e.when);
				A.sqOn = -1;
				A.dmCur = 0;
			}
		}
	});
}

/* a mute edit while playing: the scheduler used the old mask for the steps already in the look-ahead, so cancel (muted) or fill in (un-muted) just those, at once */
/* per-pad mutes (the drum track's 8 pads, `dmute` on the slot): the same two moves as for tracks, on the hits of just those pads */
function songPadCut(bits) {
	const now = AC.currentTime;
	A.sq = A.sq.filter((e) => {
		if (e.t !== DT || e.pad == null || !((bits >> e.pad) & 1)) {
			return e.when > now - 4;
		}
		if (e.g && e.end > now) {
			const p = e.g.gain;
			try {
				p.cancelScheduledValues(now);
				p.setTargetAtTime(0, now, 0.004);
			} catch (x) {
				/* nothing to do */
			}
		}
		return false;
	});
}

function songPadFill(bits) {
	const ct = AC.currentTime,
		sg = S.song;
	A.sl.forEach((e) => {
		const b = bits & e.dm;
		if (b && e.pos === sg.pos && e.pat === S.pat && e.when > ct + 0.012) {
			e.dm &= ~b;
			if (!((e.sm >> DT) & 1)) {
				A.sqOn = DT;
				A.dmCur = 255 & ~b;
				drumStep(DT, e.sn, e.when);
				A.sqOn = -1;
				A.dmCur = 0;
			}
		}
	});
}

function songMaskSync() {
	if (!AC || !S.playing) {
		return;
	}
	const m = songMask(),
		d = m ^ A.sqMask,
		dm = songPadMask(),
		dd = dm ^ A.sqDm;
	if (!d && !dd) {
		return;
	}
	A.sqMask = m;
	A.sqDm = dm;
	if (!A.sl.length && !A.sq.length) {
		return;
	}
	for (let t = 0; t < 4; t++) {
		if ((d >> t) & 1) {
			if ((m >> t) & 1) {
				songMuteCut(t);
			} else {
				songUnmuteFill(t);
			}
		}
	}
	if (dd && !((m >> DT) & 1)) {
		if (dd & dm) {
			songPadCut(dd & dm);
		}
		if (dd & ~dm) {
			songPadFill(dd & ~dm);
		}
	}
}

function songChain() {
	const c = [];
	for (const e of S.song.chain) {
		if (e.pat < 0) {
			break;
		}
		c.push(e);
	}
	return c;
}

// ---- per-slot track mutes: `mute` on a chain slot is 4 bits (bit t set = track t is silent while that slot plays). Only the sequenced notes are muted, and only while the song is on and
// the scheduler is walking the chain (`go`): live keys, the arp from held keys and audition taps never are. A missing mute (an older save) is 0.
const SPLOG = { l: null };
// test hook: [track, pattern, song slot] for every sequenced note that sounds (tests/songmute.js)
A.sq = [];

A.sl = [];

A.sqMask = 0;

A.sqDm = 0;

A.sqOn = -1;

A.dmCur = 0;

const SGM = (e) => (e && e.mute | 0) & 15,
	SGDM = (e) => (e && e.dmute | 0) & 255;

const songMask = () => {
	const sg = S.song;
	if (!sg.on || !sg.go) {
		return nestMask();
	}
	const e = sg.chain[sg.pos];
	return e && e.pat >= 0 ? SGM(e) : 0;
};

const songPadMask = () => {
	const sg = S.song;
	if (!sg.on || !sg.go) {
		return nestPadMask();
	}
	const e = sg.chain[sg.pos];
	return e && e.pat >= 0 ? SGDM(e) : 0;
};
// the drum pads this slot mutes (bit p = pad p), on the same terms as the track mask
function songClean(ch) {
	return Array.from({ length: 16 }, (_, i) => {
		const e = (ch && ch[i]) || {};
		return {
			pat: e.pat == null ? -1 : clamp(e.pat | 0, -1, 15),
			rep: clamp(e.rep | 0 || 1, 1, 8),
			mute: (e.mute | 0) & 15,
			dmute: (e.dmute | 0) & 255,
			col: [0, 1, 2, 3].map((t) => clamp((e.col && e.col[t]) | 0, 0, NCOLN - 1)),
		};
	});
}
// 16 slots, every field in range, whatever was saved
function songStart() {
	const sg = S.song;
	sg.base = 0;
	sg.jump = -1;
	sg.go = 0;
	const c = songChain();
	if (!sg.on || !c.length) {
		return;
	}
	sg.pos = 0;
	sg.rc = 0;
	sg.go = 1;
	S.pat = c[0].pat;
	S.patNext = -1;
}

const songBaseOf = (j) => {
	let n = 0;
	songChain()
		.slice(0, j)
		.forEach((e) => (n += SPB() * S.plen[e.pat] * e.rep));
	return n;
};

// at the end of a pass of the playing pattern: a requested jump, else the next repeat, or the next pattern in the chain (the chain loops)
function songAdvance(ps) {
	const c = songChain(),
		sg = S.song;
	if (!c.length) {
		return;
	}
	sg.go = 1;
	if (sg.jump >= 0) {
		const j = Math.min(sg.jump, c.length - 1);
		sg.jump = -1;
		sg.pos = j;
		sg.rc = 0;
		sg.base = songBaseOf(j);
		S.patNext = c[j].pat;
		return;
	}
	const e = c[sg.pos] || c[0];
	sg.rc++;
	sg.base = (sg.base || 0) + ps;
	if (sg.rc >= e.rep) {
		sg.rc = 0;
		sg.pos = (sg.pos + 1) % c.length;
		if (sg.pos === 0) {
			sg.base = 0;
		}
	}
	S.patNext = c[sg.pos].pat;
}
// base: steps of the chain played so far (automations follow it)
// song mode on or off (the PAGE knob, the ON chip). Stopped: just armed, PLAY starts at slot 1. Playing: the chain starts at the selected slot when this pass ends.
function songSetOn(on) {
	on = on ? 1 : 0;
	const sg = S.song;
	if (on === sg.on) {
		return;
	}
	undoPush("SONG");
	sg.on = on;
	sg.jump = -1;
	sg.go = 0;
	if (on) {
		const c = songChain();
		if (S.playing && AC && c.length) {
			sg.jump = Math.min(sg.sel, c.length - 1);
		} else {
			sg.pos = 0;
			sg.rc = 0;
		}
	}
}

// select a slot. Stopped: the sequencer now shows its pattern. Playing: `go` asks for it (song on: playback jumps there when the pass ends; song off: the pattern is queued like the PATTERN knob).
function songSelect(i, go) {
	const sg = S.song,
		e = sg.chain[i];
	sg.sel = clamp(i, 0, 15);
	if (!e || e.pat < 0) {
		return;
	}
	if (!(S.playing && AC)) {
		S.pat = e.pat;
		S.patNext = -1;
		return;
	}
	if (go) {
		songJump(i);
	}
}

// playing: play slot i next, when this pass ends (white key 5 on the song screen, or a tap on a row). Song off: queue its pattern like the PATTERN knob.
function songJump(i) {
	const sg = S.song,
		e = sg.chain[i];
	if (!e || e.pat < 0 || !(S.playing && AC)) {
		return;
	}
	if (sg.on) {
		if (NEST.pv) {
			nestCollapse();
		} /* a looping dropdown: jumping leaves the loop, the song carries on from that slot */
		sg.jump = i;
		toast("NEXT: SLOT " + (i + 1));
	} else {
		S.patNext = e.pat === S.pat ? -1 : e.pat;
	}
}

/* a jump while the song plays lands on the next BAR line (the next beat when the playing pattern is one bar, since a bar is its whole pass): the slot starts from its first bar, or, from a one-bar pattern, keeps the position inside the bar. The sequencer follows at that moment (S.pat) */
function songJumpNow(ss) {
	const c = songChain(),
		sg = S.song,
		j = Math.min(sg.jump, c.length - 1),
		off = S.plen[S.pat] === 1 ? A.sn % SPB() : 0;
	sg.jump = -1;
	sg.go = 1;
	sg.pos = j;
	sg.rc = 0;
	sg.base = songBaseOf(j);
	S.pat = c[j].pat;
	S.patNext = -1;
	const sh = (A.sn - off) * ss;
	A.t0 += sh;
	A.sn = off;
	S.t0 += sh * 1000;
}

// ---- every slot has its own pattern number: no two slots of the chain hold the same pattern (to play one again use REPEAT, or DUPE for a copy you can vary). The rule is for edits only:
// a save, project or undo step that already holds a repeated number loads and plays as it always did, and a slot is only moved when the owner edits its PAT cell.
const patUsed = (p, except) => S.song.chain.some((e, i) => i !== except && e.pat === p);

const patFirstFree = () => {
	for (let p = 0; p < 16; p++) {
		if (!patUsed(p, -1)) {
			return p;
		}
	}
	return -1;
};

// the pattern a PAT cell or the PATTERN knob lands on, d steps (or +-1) from slot i's: only free patterns and the empty state (-1) count. wrapIt: the cell wraps, the knob stops at the ends
function patStep(i, d, wrapIt) {
	const e = S.song.chain[i],
		dir = d < 0 ? -1 : 1;
	let k = e.pat;
	for (let n = 0, m = Math.max(1, Math.abs(d | 0)); n < m; n++) {
		let q = k;
		for (let g = 0; g < 17; g++) {
			q += dir;
			if (q > 15) {
				if (wrapIt) {
					q = -1;
				} else {
					q = k;
					break;
				}
			}
			if (q < -1) {
				if (wrapIt) {
					q = 15;
				} else {
					q = k;
					break;
				}
			}
			if (q < 0 || !patUsed(q, i)) {
				break;
			}
		}
		k = q;
	}
	return k;
}

function patSet(i, p) {
	const e = S.song.chain[i],
		w = e.pat;
	e.pat = p;
	if (w < 0 && p >= 0) {
		e.mute = 0;
		e.dmute = 0;
		e.col = [0, 0, 0, 0];
	}
}

// a free pattern to put a copy in: an unused empty one first, else the pasted-over slot's own pattern, else the first unused one (its notes are replaced; undo brings them back)
function patCopyTarget(except) {
	const o = except >= 0 ? S.song.chain[except].pat : -1;
	let b = o >= 0 && !patUsed(o, except) ? o : -1;
	for (let p = 0; p < 16; p++) {
		if (patUsed(p, except)) {
			continue;
		}
		if (b < 0) {
			b = p;
		}
		if (patEmpty(p)) {
			return p;
		}
	}
	return b;
}
// no empty one: the pattern of the slot being pasted over, else the first unused
// slot i is to hold `pat`: that pattern itself when no other slot has it, else a copy of its content in a free pattern ({p, cp}); null (with a toast) when none is left
function slotPatFor(i, pat, except) {
	if (!patUsed(pat, except)) {
		return { p: pat, cp: false };
	}
	const fp = patCopyTarget(except);
	if (fp < 0) {
		toast("NO FREE PATTERN");
		return null;
	}
	return { p: fp, cp: true, wipe: !patEmpty(fp) };
}

function songAdd() {
	const c = songChain(),
		n = c.length;
	if (n >= 16) {
		return;
	}
	const fp = patFirstFree();
	if (fp < 0) {
		toast("NO FREE PATTERN");
		return;
	}
	undoPush("SONG");
	const e = S.song.chain[n];
	e.pat = fp;
	e.rep = 1;
	e.mute = 0;
	e.dmute = 0;
	e.col = [0, 0, 0, 0];
	songSelect(n, false);
}

function songToggleMute(i, t) {
	const e = S.song.chain[i];
	if (!e || e.pat < 0 || !(t >= 0 && t < 4)) {
		return;
	}
	undoPush("SONG MUTE");
	e.mute = ((e.mute | 0) ^ (1 << t)) & 15;
	songSelect(i, false);
	songMaskSync();
	toast("SLOT " + (i + 1) + "  T" + (t + 1) + ((e.mute >> t) & 1 ? " MUTED" : " PLAYS"));
}

// one drum pad of one slot muted or let go (bit p of `dmute`): the drum track's pads inside the slot dropdown, white keys 1-8 while they are shown. Heard at once, like a track mute.
function songTogglePad(i, pd) {
	const e = S.song.chain[i];
	if (!e || e.pat < 0 || !(pd >= 0 && pd < DGN)) {
		return;
	}
	undoPush("PAD MUTE");
	e.dmute = ((e.dmute | 0) ^ (1 << pd)) & 255;
	songSelect(i, false);
	songMaskSync();
	toast("SLOT " + (i + 1) + "  " + PADS[pd] + ((e.dmute >> pd) & 1 ? " MUTED" : " PLAYS"));
}

// the song screen -> a track's sequencer (or its drum grid) showing the selected slot's pattern (a playing song keeps the pattern that plays)
function songToSeq() {
	if (S.screen !== "song") {
		return;
	}
	const e = S.song.chain[S.song.sel];
	if (!(S.playing && AC) && e && e.pat >= 0) {
		S.pat = e.pat;
		S.patNext = -1;
	}
	S.screen = "seq";
	S.seqPage = 0;
	S.seqEn = true;
	pop("TRACK", "T" + (S.trk + 1) + "  PAT " + pad(S.pat + 1), S.trk / 3);
}

function songGoTrack(t) {
	S.trk = t;
	songToSeq();
}

function songOpen() {
	const sg = S.song;
	if (sg.on && sg.go && S.playing && AC) {
		sg.sel = clamp(sg.pos, 0, 15);
	} else if (!(sg.chain[sg.sel] && sg.chain[sg.sel].pat === S.pat)) {
		const k = songChain().findIndex((e) => e.pat === S.pat);
		if (k >= 0) {
			sg.sel = k;
		}
	}
	S.screen = "song";
	S.seqEn = true;
	audioSync();
}

function startSeq() {
	if (!AC) {
		return;
	}
	songStart();
	A.sq = [];
	A.sl = [];
	A.sqMask = 0;
	A.sqDm = 0;
	S.t0 = performance.now() + 25;
	A.t0 = AC.currentTime + 0.025;
	A.sn = 0;
	if (S.rec) {
		undoPush("RECORDING");
	}
	nestStart();
	tick();
}
/* the first step is 25 ms away (was 60) and is scheduled now, not at the next 25 ms timer tick */
// ---- COPY / PASTE / INSERT / DELETE on the song screen, and the NESTED VIEW of one slot (PROTOTYPE ONLY screens; the data is device-sized) ----
// The song screen's chips work on a SLOT (pattern number, repeat, mutes, colours, the lanes scoped to it) or, with the SLOT / PAT chip on PAT, on a PATTERN's content (four tracks' notes, the drum grid,
// the lengths). One clipboard each (`NCLIP`: a slot is 4 numbers + its lanes, a pattern is 4 x 128 steps x 3 bytes + the 1 KB drum grid, about 1.5 KB). Every operation is one undo step.
// The dropdown (tap the chevron next to a slot's PAT): the slot's four tracks open under its row, in the same list (mute, colour, a strip of the track's steps, its automation lanes, and + ADD AUTOMATION with a menu of what
// that track can automate); one slot at a time, and the slot's pattern loops while it is open. A lane is `S.auto` as before (one parameter, 64 samples a bar x 1 byte, at most 16 lanes in all); `lane.slot` scopes it to one slot.
const NCOLN = 6,
	NCOLNM = ["NONE", "RED", "GRAY", "WASHI", "PALE", "DIM"],
	ncol = (e, t) => ((e && e.col && e.col[t]) | 0) % NCOLN;

const NCLIP = { slot: null, pat: null, padc: null, lane: null, mode: 1, trk: -1 },
	NEST = { i: -1, sel: null, pv: 0, pi: 0, nob: 0, dr: 0, pd: 0 };
// NEST.dr: the drum track's 8 pads are shown under it; NEST.pd: the pad chosen in the dropdown (PAD copy / paste / clear work on its row); NEST.sel: the lane chosen (LANE mode)
// the mode chip's cycle: SLOT, PATTERN, T1-T4 (one track of the pattern), PAD (one drum pad's row of hits), LANE (one automation lane); [mode, track]
const NCMODES = [
		[0, -1],
		[1, -1],
		[1, 0],
		[1, 1],
		[1, 2],
		[1, 3],
		[2, -1],
		[3, -1],
	],
	ncIdx = () => {
		const k = NCMODES.findIndex((q) => q[0] === NCLIP.mode && q[1] === NCLIP.trk);
		return k < 0 ? 1 : k;
	};

const NCH = [
	{ k: "copy", x: 4, w: 42 },
	{ k: "paste", x: 48, w: 46 },
	{ k: "ins", x: 96, w: 46 },
	{ k: "del", x: 144, w: 46 },
	{ k: "mode", x: 194, w: 42 },
];

const NV = { x: 11, hd: 14, hh: 22, lh: 13, eh: 34, ah: 15, ph: 13 };
// the dropdown's row heights (LCD pixels): header, track, lane (+ the drawing box when open), add chip
const nstP = (pi, t) => SPB() * (S.tl[pi][t] || S.plen[pi]);

// ---- the clipboard ----
function songClipDraw() {
	const y = SG.cy,
		m = NCLIP.mode,
		c = NCLIP,
		pm =
			m === 0
				? "SLOT"
				: m === 1
					? c.trk >= 0
						? "T" + (c.trk + 1)
						: "PAT"
					: m === 2
						? "PAD"
						: "LANE",
		lb =
			m === 0
				? ["COPY", "PASTE", "INSERT", "DELETE"]
				: m === 1
					? ["COPY", "PASTE", "DUPE", "CLEAR"]
					: ["COPY", "PASTE", "", "CLEAR"],
		has = m === 0 ? c.slot : m === 1 ? c.pat : m === 2 ? c.padc : c.lane;
	NCH.forEach((h, k) => {
		const off = m >= 2 && k === 2,
			dim = off || (k === 1 && !has);
		if (k === 4) {
			R(h.x, y, h.w, SG.ch2, m ? P.sel : P.faint);
			T(pm, h.x + h.w / 2, y + 2, m ? P.selfg : P.fg, 1, "c");
		} else if (k === 0 && has) {
			R(h.x, y, h.w, SG.ch2, P.bar);
			B(h.x, y, h.w, SG.ch2, P.acc);
			T(lb[k], h.x + h.w / 2, y + 2, P.fg, 1, "c");
		} // something is on the clipboard: COPY stays lit
		else {
			B(h.x, y, h.w, SG.ch2, dim ? P.faint : P.dim);
			T(lb[k], h.x + h.w / 2, y + 2, dim ? P.faint : P.fg, 1, "c");
		}
	});
}
