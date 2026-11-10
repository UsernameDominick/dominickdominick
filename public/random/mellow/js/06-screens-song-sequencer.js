// LCD screens, part 2: sequencer footer and bar strip, song screen, sequencer screen
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---- the shared footer and bar strip of the sequencer and the drum grid (PROTOTYPE ONLY drawing and touch; the device has the UNDO and REDO knobs on SEQ 2/2 and the pattern length on SEQ LENGTH)
// The footer is ONE row (y 191, 12 high): the UNDO and REDO icon chips (curved arrows, the table IC), then the screen's own chips; it ends before the touch icon (x 221). The row's hit zone is y 187 up to the knob strip (205).
const FOOT = { y: 191, h: 12, w: 22, ux: 4, rx: 28, pe: 216 };

function footBtn(x, w, lit, flash) {
	if (flash) {
		R(x, FOOT.y, w, FOOT.h, P.faint);
	}
	B(x, FOOT.y, w, FOOT.h, lit ? P.acc : P.faint);
}

function footUR() {
	const fl = (k) => UF.k === k && performance.now() - UF.t < 220;
	[
		["u", "undo", FOOT.ux, UND.u.length],
		["r", "redo", FOOT.rx, UND.r.length],
	].forEach(([k, n, x, c]) => {
		footBtn(x, FOOT.w, fl(k), fl(k));
		ico(n, x + ((FOOT.w - 8) >> 1), FOOT.y + 3, fl(k) ? P.acc : c ? P.fg : P.faint);
	});
}

const footHit = (x, y) =>
	y >= 187 && y < 205 && x < FOOT.rx + FOOT.w + 3 ? (x < FOOT.rx - 1 ? "u" : "r") : null;

function footTap(k) {
	UF = { k, t: performance.now() };
	k === "u" ? undo() : redo();
}

// the bar strip (patterns of 2 to 8 bars): one segment per bar with its number; a tap on a segment jumps to that bar, a drag sideways or the wheel scrolls the viewed bar one at a time
const BSTEP = 24;
// LCD pixels of sideways drag per bar
function barStrip(y, L, vb, cur, live, SP) {
	if (L < 2) {
		return;
	}
	const w = Math.floor((224 - (L - 1) * 2) / L);
	for (let b = 0; b < L; b++) {
		const x = 8 + b * (w + 2),
			on = b === vb;
		R(x, y, w, 9, on ? P.acc : P.faint);
		T(String(b + 1), x + (w >> 1), y + 1, on ? P.selfg : P.dim, 1, "c");
		if (live && S.playing && cur >= 0 && Math.floor(cur / SP) === b) {
			R(x + Math.round(((cur % SP) / SP) * (w - 2)), y - 2, 2, 13, P.fg);
		}
	}
}

const barZone = (x, y) => tbars() > 1 && y >= 136 && y < 155 && x >= 8 && x < 232;

function barStep(n) {
	const L = tbars();
	if (L < 2 || !n) {
		return false;
	}
	const SP = SPB(),
		q = S.seq,
		vb = S.playing ? seqViewBar() : clamp(Math.floor(q.sel / SP), 0, L - 1),
		nb = clamp(vb + n, 0, L - 1);
	if (nb === vb) {
		return false;
	}
	q.sel = clamp(nb * SP + (q.sel % SP), 0, nstT() - 1);
	return true;
}
// keeps the cursor's column in the new bar
function barTap(x) {
	const L = tbars();
	if (L < 2) {
		return;
	}
	S.seq.sel = clamp(Math.floor((x - 8) / (224 / L)), 0, L - 1) * SPB();
}

// the sequencer screen geometry (LCD pixels): the pitch area, the velocity lane, the step numbers, the bar strip and the on/off boxes
let UF = { k: "", t: 0 };
// the undo / redo chip that was just pressed (it flashes)
const SQ = { y0: 34, h: 100, ny: 137, by: 147, ky: 158, kh: 16, x0: 8, w: 224 };

const sqCW = () => Math.max(4, Math.floor(SQ.w / SPB())),
	sqX0 = () => SQ.x0 + Math.floor((SQ.w - sqCW() * SPB()) / 2);

const SQE = ["VELOCITY", "PITCH", "GATE"];
// what the bars show and what dragging them edits (the dropdown on the screen)
const sqFrac = (y) => clamp((SQ.y0 + SQ.h - y) / SQ.h, 0, 1);

const sqVel = (y) => clamp(Math.round(sqFrac(y) * 127), 1, 127);
// the bars are the velocities by default: the taller, the harder
// the value the touched height means, in the attribute being edited
function sqSet(q, j, y, perc) {
	const f = sqFrac(y);
	if (UI.sqe === 0) {
		q.vel[j] = clamp(Math.round(f * 127), 1, 127);
	} else if (UI.sqe === 1) {
		q.st[j] = perc ? 36 + clamp(Math.round(f * 7), 0, 7) : clamp(Math.round(36 + f * 48), 36, 84);
	} else {
		q.gate[j] = clamp(Math.round(f * 40) * 5, 5, 200);
	}
}

// a bar's height in the attribute being shown (0..1)
function sqLevel(q, j, perc) {
	return UI.sqe === 0
		? q.vel[j] / 127
		: UI.sqe === 1
			? perc
				? (q.st[j] - 36) / 7
				: (q.st[j] - 36) / 48
			: Math.min(q.gate[j], 200) / 200;
}

// where a note's length ends on the screen (the grab handle for dragging its gate), in LCD pixels
function sqGateX(i, q, j) {
	const cw = sqCW(),
		x = sqX0() + i * cw,
		lim = sqX0() + cw * SPB();
	return Math.min(lim - 1, x + 1 + Math.max(4, Math.round((cw * q.gate[j]) / 100) - 3));
}
// where a note's length ends along the box row, in LCD pixels
function sqGateHit(x, y) {
	if (y < SQ.ky - 3 || y > SQ.ky + SQ.kh + 3 || x < sqX0() || x >= sqX0() + sqCW() * SPB() + 6) {
		return null;
	}
	const q = S.seq,
		vb = seqViewBar(),
		SP = SPB(),
		cw = sqCW();
	let best = null,
		bd = 99;
	for (let i = 0; i < SP; i++) {
		const j = vb * SP + i;
		if (q.st[j] < 0) {
			continue;
		}
		const dx = Math.abs(x - sqGateX(i, q, j));
		if (dx <= 5 && dx < bd) {
			bd = dx;
			best = { j, x0: sqX0() + i * cw + 1 };
		}
	}
	return best;
}

// a new note takes the pitch of the nearest note to its left (else to its right), or the step's own default
function newPitch(j) {
	const q = S.seq,
		N = nstT();
	for (let d = 1; d < N; d++) {
		if (j - d >= 0 && q.st[j - d] >= 0) {
			return q.st[j - d];
		}
		if (j + d < N && q.st[j + d] >= 0) {
			return q.st[j + d];
		}
	}
	return stepDefault(j % 16);
}

// The song screen: one row per chain slot (slot, pattern, length in bars, repeat) and four track chips (filled = the track plays in this slot, outlined and struck = muted).
// Touch (PROTOTYPE ONLY) does what the knobs and white keys do: a row = SLOT (and the sequencer shows that pattern), the PAT / BARS / REP cells = PATTERN / LENGTH / REPEAT turned one step,
// a chip = white key 1-4, the ON chip = PAGE, a T1-T4 header = open that track's sequencer.
const SG = {
		y0: 39,
		rh: 13,
		n: 8,
		pat: 30,
		pw: 37,
		nv: 68,
		nw: 12,
		bars: 82,
		bw: 38,
		rep: 122,
		rw: 24,
		ch: 151,
		cw: 19,
		cs: 22,
		cy: 146,
		ch2: 11,
		ct: 1,
		cht: 10,
	},
	SONGCHIP = { x: 126, w: 38 };

const SGV = { sc: 0, key: "" };

const PV = { x: 4, y: 161, w: 216, h: 38, sc: 0, key: "" };

const HV = {
	x: 6,
	y: 152,
	w: 228,
	h: 38,
	sc: 0,
	key: "",
};
/* Home's mini player is as wide as the wave box above it (x 6, 228) */ // the song preview under the chips: a scrolling timeline of the chain (x, y, width, height in LCD pixels, sc = how far it is scrolled in steps)
// the song list scrolls by pixels (drag on the LCD); a slot's dropdown (nestLay) opens under its row, so the list is taller than its window
function seqPips() {
	for (let k = 0; k < 5; k++) {
		R(6 + k * 7, 28, 5, 2, k === S.seqPage ? P.acc : P.dim);
	}
}
// which of the five SEQ pages this is (PAGE, SEQ or a tap on the title steps them)
function songChipDraw() {
	const on = S.song.on,
		x = SONGCHIP.x,
		w = SONGCHIP.w;
	if (on) {
		R(x, 14, w, 12, P.sel);
	} else {
		B(x, 14, w, 12, P.dim);
	}
	T("SONG", x + w / 2, 17, on ? P.selfg : P.dim, 1, "c");
}

const songChipHit = (x, y) =>
	y >= 13 && y < 30 && x >= SONGCHIP.x - 2 && x < SONGCHIP.x + SONGCHIP.w + 2;

SCR.song = (now, live) => {
	const sg = S.song,
		ch = songChain(),
		{ L, H, view } = songView(),
		pl = live && S.playing && AC && sg.on && sg.go,
		opn = nestOn();
	for (const it of L) {
		const y = SG.y0 + it.y - SGV.sc;
		if (y >= SG.y0 + view || y + it.h <= SG.y0) {
			continue;
		}
		if (it.k !== "slot") {
			nestDraw(it, y, live);
			continue;
		}
		const i = it.i,
			e = sg.chain[i],
			sel = i === sg.sel,
			has = e.pat >= 0,
			mk = SGM(e),
			ex = opn && i === NEST.i;
		if (sel) {
			R(4, y, 232, SG.rh - 1, P.bar);
			R(4, y, 2, SG.rh - 1, P.acc);
		} else if (i) {
			R(4, y - 1, 232, 1, P.faint);
		}
		if (pl && has && i === sg.pos) {
			R(8, y + 3, 3, 7, P.rec);
		} else if (sg.on && sg.jump === i && S.playing) {
			B(8, y + 3, 3, 7, P.rec);
		}
		T(pad(i + 1), 14, y + 3, sel ? P.fg : P.dim);
		if (has) {
			const L = S.plen[e.pat],
				lost = i > ch.length,
				cy = y + SG.ct,
				cell = (x, w, tx) => {
					B(x, cy, w, SG.cht, lost ? P.faint : P.hint);
					T(tx, x + w / 2, y + 3, lost ? P.faint : P.fg, 1, "c");
				}; /* lost: a slot after an empty one. The chain ends at the first empty slot, so it never plays: drawn faint and marked */
			cell(SG.pat, SG.pw, "PAT " + pad(e.pat + 1));
			if (ex) {
				R(SG.nv, cy, SG.nw, SG.cht, P.sel);
			} else {
				B(SG.nv, cy, SG.nw, SG.cht, P.hint);
			}
			for (let k = 0; k < 4; k++) {
				if (ex) {
					R(SG.nv + 2 + k, y + 4 + k, 8 - 2 * k, 1, P.selfg);
				} else {
					R(SG.nv + 4 + k, y + 2 + k, 1, 7 - 2 * k, P.fg);
				}
			} // the chevron: points right, or down while the slot is open
			cell(SG.bars, SG.bw, L + (L > 1 ? " BARS" : " BAR"));
			cell(SG.rep, SG.rw, "x" + e.rep);
			if (lost) {
				T("NOT PLAYED", SG.ch + 42, y + 3, P.faint, 1, "c");
			} else {
				for (let t = 0; t < 4; t++) {
					const x = SG.ch + t * SG.cs;
					if ((mk >> t) & 1) {
						B(x, cy, SG.cw, SG.cht, P.hint);
						R(x + 3, y + 5, SG.cw - 6, 1, P.hint);
					} else {
						R(x, cy, SG.cw, SG.cht, ncol(e, t) ? P.tag[ncol(e, t)] : P.fg);
					}
					if (t === S.trk) {
						R(x, y + SG.ct + SG.cht, SG.cw, 1, P.acc);
					}
				}
			}
		} else if (i === ch.length) {
			B(SG.pat, y + SG.ct, SG.rep + SG.rw - SG.pat, SG.cht, P.hint);
			T("+ ADD A PATTERN", (SG.pat + SG.rep + SG.rw) / 2, y + 3, P.dim, 1, "c");
		} else {
			T("---", SG.pat + 4, y + 3, P.faint);
		}
	}
	R(0, 13, 240, SG.y0 - 13, P.bg);
	R(0, SG.y0 + view, 240, 205 - SG.y0 - view, P.bg); // the list runs under the header and the clipboard chips, which are drawn over it
	if (H > view) {
		const bh = Math.max(10, Math.round((view * view) / H));
		R(238, SG.y0 + Math.round(((view - bh) * SGV.sc) / (H - view)), 2, bh, P.faint);
	}
	T("SONG MODE", 6, 16, P.dim);
	{
		let bars = 0;
		ch.forEach((e) => (bars += S.plen[e.pat] * e.rep));
		T(
			ch.length
				? ch.length +
						(ch.length > 1 ? " SLOTS  " : " SLOT  ") +
						bars +
						(bars > 1 ? " BARS" : " BAR")
				: "EMPTY CHAIN",
			70,
			16,
			P.faint,
		);
	}
	{
		const on = sg.on,
			w = 40;
		if (on) {
			R(234 - w, 14, w, 11, P.sel);
		} else {
			B(234 - w, 14, w, 11, P.dim);
		}
		T(on ? "ON" : "OFF", 234 - w / 2, 16, on ? P.selfg : P.dim, 1, "c");
	}
	R(0, 26, 240, 1, P.faint);
	T("PAT", SG.pat + SG.pw / 2, 29, P.faint, 1, "c");
	T("BARS", SG.bars + SG.bw / 2, 29, P.faint, 1, "c");
	T("REP", SG.rep + SG.rw / 2, 29, P.faint, 1, "c");
	for (let t = 0; t < 4; t++) {
		const x = SG.ch + t * SG.cs,
			s = t === S.trk;
		if (s) {
			R(x, 28, SG.cw, 10, P.sel);
		}
		T("T" + (t + 1), x + SG.cw / 2, 29, s ? P.selfg : P.dim, 1, "c");
	}
	songClipDraw();
	songPreviewDraw(now, live);
};

// what is under a touch on the song screen
function songZone(x, y) {
	const sg = S.song;
	if (y >= 13 && y < 27 && x >= 180) {
		return { t: "srow", k: "on", tap: true };
	}
	if (y >= 27 && y < SG.y0 && x >= SG.ch - 2) {
		return {
			t: "srow",
			k: "trk",
			trk: clamp(Math.floor((x - SG.ch + 2) / SG.cs), 0, 3),
			tap: true,
		};
	}
	if (y >= SG.y0 && y < SG.y0 + SG.n * SG.rh) {
		const { L } = songView(),
			yy = y - SG.y0 + SGV.sc;
		for (const it of L) {
			if (yy < it.y || yy >= it.y + it.h) {
				continue;
			}
			if (it.k !== "slot") {
				return nestZone(it, x, yy - it.y, SG.y0 + it.y - SGV.sc);
			}
			const i = it.i,
				e = sg.chain[i],
				o = (k) => ({ t: "srow", k, i, tap: true, ls: 1 }); // ls: a vertical drag on a row scrolls the list
			if (e.pat < 0) {
				return o("add");
			}
			if (x >= SG.ch - 3) {
				return Object.assign(o("mute"), {
					trk: clamp(Math.floor((x - SG.ch + 3) / SG.cs), 0, 3),
				});
			}
			return o(
				x < SG.pat - 2
					? "row"
					: x < SG.nv - 2
						? "pat"
						: x < SG.bars - 2
							? "chev"
							: x < SG.rep - 2
								? "bars"
								: x < SG.ch - 4
									? "rep"
									: "row",
			);
		}
		return { t: "srow", k: "bg", ls: 1 };
	}
	{
		const z = pvZone(PV, x, y);
		if (z) {
			return z;
		}
	} // the preview: tap a block = that slot, drag sideways = scroll (bi, not i: a swipe here must not turn the SLOT knob)
	if (y >= SG.cy - 1 && y < SG.cy + SG.ch2 + 2) {
		const k = NCH.find((c) => x >= c.x - 2 && x < c.x + c.w + 2);
		if (k) {
			return { t: "srow", k: "clip", c: k.k, tap: true };
		}
	}
	return null;
}

// a touch on a preview instance (PV on the song screen, HV = the mini player on Home): tap a block = that slot, drag sideways = scroll (bi, not i: a swipe here must not turn the SLOT knob)
function pvZone(g, x, y) {
	if (y >= g.y && y < g.y + g.h && x >= g.x && x < g.x + g.w) {
		const { B } = pvLay(),
			sx = x - g.x + g.sc,
			b = B.find((q) => sx >= q.x && sx < q.x + q.w);
		return { t: "srow", k: "prev", bi: b ? b.i : -1, tap: true, ls: 1, g };
	}
	return null;
}

function songTap(z) {
	const sg = S.song,
		e = sg.chain[z.i];
	if (z.k === "on") {
		songSetOn(!sg.on);
		return;
	}
	if (z.k === "trk") {
		songGoTrack(z.trk);
		return;
	}
	if (z.k === "add") {
		songAdd();
		return;
	}
	if (z.k === "clip") {
		songClip(z.c);
		return;
	}
	if (z.k === "prev") {
		if (z.bi >= 0) {
			songSelect(z.bi, true);
		}
		return;
	}
	if (z.k === "chev") {
		nestToggle(z.i);
		return;
	}
	if (z.k === "mute") {
		songToggleMute(z.i, z.trk);
		return;
	}
	if (z.k === "pat") {
		undoPush("SONG");
		patSet(z.i, patStep(z.i, 1, true));
	} else if (z.k === "bars") {
		setLenOf(e.pat, S.plen[e.pat] >= maxBars() ? 1 : S.plen[e.pat] + 1);
	} else if (z.k === "rep") {
		undoPush("SONG");
		e.rep = e.rep >= 8 ? 1 : e.rep + 1;
	}
	songSelect(z.i, z.k === "row");
}

function songSwipe(z, d) {
	// a sideways swipe: the cell under the finger steps like its knob; anywhere else on a row it moves the slot
	if (z.i == null) {
		return;
	}
	S.song.sel = z.i;
	if (z.k === "pat" || z.k === "bars" || z.k === "rep") {
		knobs()[z.k === "pat" ? 1 : z.k === "bars" ? 2 : 3].set(d);
	} else {
		turn("k0", d);
	}
}

SCR.seq = (now, live) => {
	if (dgOn()) {
		return SCR.dgrid(now, live);
	}
	const L = tbars(),
		SP = SPB(),
		cw = sqCW(),
		X0 = sqX0(),
		q = S.seq,
		cur = seqPos(now, live),
		vb =
			live && S.playing && cur >= 0
				? Math.min(L - 1, Math.floor(cur / SP))
				: clamp(Math.floor(q.sel / SP), 0, L - 1),
		o = vb * SP,
		bs = BSTEPS(),
		u = unitSteps();
	if (q.sel >= nstT()) {
		q.sel = nstT() - 1;
	}
	title(["1/2 SEQUENCER", "2/2 SEQUENCER", "STEP EDIT", "SEQ LENGTH", "TRACK LENGTH"][S.seqPage]);
	R(0, 28, 240, 1, P.faint);
	seqPips();
	{
		const cl = SQE[UI.sqe],
			w = Math.ceil(TW(cl)) + 18;
		B(234 - w, 14, w, 12, menuOpen("edit") ? P.acc : P.dim);
		T(cl, 234 - w + 4, 17, P.fg);
		R(234 - 9, 19, 5, 1, P.acc);
		R(234 - 8, 20, 3, 1, P.acc);
		R(234 - 7, 21, 1, 1, P.acc);
	}
	songChipDraw();
	const perc = ["DRUM", "SMP"].includes(engOf(S.trk)),
		y0 = SQ.y0,
		h = SQ.h;
	if (!S.rec && !q.st.slice(0, nstT()).some((n) => n >= 0)) {
		T("EMPTY: TAP A STEP, OR REC AND PLAY", 120, y0 + 46, P.faint, 1, "c");
	} /* nothing on this track in this pattern yet */
	for (let i = 0; i < SP; i++) {
		const j = o + i,
			x = X0 + i * cw,
			bw = cw - 4;
		if (j === cur) {
			R(x - 1, y0, cw, h + 4, P.faint);
		}
		if (i % bs === 0 && i) {
			DV(x - 2, y0, h, P.faint, 1, 3);
		}
		const n = q.st[j];
		if (n < 0) {
			R(x + Math.floor(bw / 3) + 1, y0 + h - 2, Math.max(2, Math.floor(bw / 2)), 1, P.dim);
		} else {
			const hh = Math.max(4, Math.round(clamp(sqLevel(q, j, perc), 0, 1) * h));
			R(x + 1, y0 + h - hh, bw, hh, j === q.sel ? P.dim : P.faint);
			R(x + 1, y0 + h - hh, bw, 3, P.ops[i < SP / 2 ? 1 : 5]);
		}
		if (j === q.sel) {
			B(x - 1, y0 - 2, cw, h + 4, P.fg);
		}
		if (S.ghost && S.ghost.j === j && live && now - S.ghost.t < 240) {
			const gh = Math.max(4, Math.round((S.ghost.v / 127) * h));
			B(x + 1, y0 + h - gh, bw, gh, P.acc);
		} /* the note you just deleted, for a moment */
		if (i % bs === 0) {
			T(String(j + 1), x + (cw >> 1), SQ.ny, P.dim, 1, "c");
		}
	}
	for (let i = 0; i < SP; i++) {
		const j = o + i,
			x = X0 + i * cw;
		if (q.st[j] < 0) {
			B(x + 1, SQ.ky, cw - 3, SQ.kh, P.faint);
		}
		if (snapOn() && j % u === 0) {
			R(x + (cw >> 1) - 1, SQ.ky + SQ.kh + 2, 2, 2, P.acc);
		}
	}
	for (let i = 0; i < SP; i++) {
		const j = o + i,
			x = X0 + i * cw;
		if (q.st[j] >= 0) {
			const ge = sqGateX(i, q, j),
				c = j === cur ? P.acc : P.dim;
			R(x + 1, SQ.ky, Math.max(4, ge - x - 1), SQ.kh, c);
			if (ge - x - 1 >= 8) {
				R(ge - 2, SQ.ky, 2, SQ.kh, j === q.sel ? P.fg : P.bg);
			}
		}
	} // a box is as long as its note: drag its right end to change the length
	{
		const lim = X0 + cw * SP - 1;
		for (let j = Math.max(0, o - 128); j < o; j++) {
			if (q.st[j] < 0) {
				continue;
			}
			const e = j + q.gate[j] / 100;
			if (e <= o + 0.01) {
				continue;
			}
			const ge = Math.min(lim, X0 + Math.round((e - o) * cw) - 3);
			R(X0, SQ.ky, Math.max(2, ge - X0), SQ.kh, P.dim);
			R(X0, SQ.ky, 2, SQ.kh, P.fg);
		}
	} // a long note that began in an earlier bar carries on here: a box from the left edge with a bright tie mark
	barStrip(SQ.by, L, vb, cur, live, SP);
	const ty = 178,
		sl = q.sel,
		nm =
			q.st[sl] < 0
				? "REST"
				: perc
					? engOf(S.trk) === "DRUM"
						? PADS[q.st[sl] - 36] || "?"
						: "SLICE " + (q.st[sl] - 35)
					: note(q.st[sl]);
	if (S.clr) {
		T("OCT+ CONFIRM   OCT- CANCEL", 120, ty, P.acc, 1, "c");
	} else if (S.recExt && S.rec) {
		T("REC: GROWING  PLAY OR REC TO STOP", 120, ty, P.rec, 1, "c");
	} else if (S.rec) {
		T("REC: PLAY KEYS TO RECORD", 120, ty, P.rec, 1, "c");
	} else if (S.seqPage === 4) {
		T("NEXT SEQ PRESS: SEQUENCER OFF", 120, ty, P.faint, 1, "c");
	} else {
		T(
			"STEP " +
				(sl + 1) +
				"  " +
				nm +
				(q.st[sl] < 0 ? "" : "  VEL " + q.vel[sl] + "  GATE " + gateTxt(q.gate[sl])),
			120,
			ty,
			P.dim,
			1,
			"c",
		);
	}
	footUR();
	T(
		"PAT " +
			pad(S.pat + 1) +
			(S.patNext >= 0 ? ">" + pad(S.patNext + 1) : "") +
			(L !== S.plen[S.pat] ? "  POLY" : "  " + tsName()),
		FOOT.pe,
		FOOT.y + 3,
		P.faint,
		1,
		"r",
	); /* the footer: one row, UNDO and REDO icons at the left, the pattern at the right (clear of the touch icon) */
};
