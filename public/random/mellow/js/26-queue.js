// the QUEUE and STRIP screens: queued notes
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---------- the QUEUE and STRIP screens (PROTOTYPE ONLY screens; they replaced the old popups) ----------
// Each button opens real LCD pages, like MIXER: S.screen 'pp' with S.ppMode 'queue' or 'strip', so they use the same parameter grid (K1-K4 are the settings, PAGE steps the pages, the four values
// at the bottom follow), the same wheel / swipe / tap editing as every other page, and a graphic area under the grid. The button toggles: again = back to where you were (QRET). Every setting of the old popups is
// here: QUEUE 1/3 QUEUE (on/off, keyboard to queue, mode, wait), 2/3 TIMING (hold overlap, sync or free, note gap, clear), 3/3 SAVED QUEUES (K1 picks, K2 plays, K3 saves, K4 deletes with two turns;
// white keys 1-12 pick a saved queue too; the list scrolls by dragging it and has PLAY / DELETE chips); STRIP 1/2 STRIP TARGET (K1 target, K3 clear the lane), 2/2 AUTOMATE (K1 length, K2 record, K3 plays, K4 follows).
// Nothing here is a new control: they are the existing K1-K4 and white keys; the chips, the drag-scroll and the page-title tap are phone-only ways to reach the same values.
const QRET = { s: "home", m: "edit", p: 0 },
	QL = { sc: 0, arm: null, at: 0, last: {} };

let QSEL = 0;

const inQS = (k) => S.screen === "pp" && S.ppMode === k,
	onQS = () => S.screen === "pp" && (S.ppMode === "queue" || S.ppMode === "strip"),
	qsSaved = () => inQS("queue") && S.ppPage === 2;

function qsToggle(k) {
	if (inQS(k)) {
		const r = QRET;
		S.screen = r.s;
		if (r.s === "pp") {
			S.ppMode = r.m;
			S.ppPage = r.p;
		}
		return;
	} /* the button again: back to where you were */
	if (!onQS()) {
		QRET.s = S.screen === "boot" ? "home" : S.screen;
		QRET.m = S.ppMode;
		QRET.p = S.ppPage;
	}
	S.screen = "pp";
	S.ppMode = k;
	S.ppPage = 0;
}

const qsOnce = (k, ms = 700) => {
	const n = performance.now();
	if (QL.last[k] && n - QL.last[k] < ms) {
		return false;
	}
	QL.last[k] = n;
	return true;
};
/* a drag on a knob is many steps: an action (play, save, clear) happens once per sweep */
function stripTarget(i) {
	MOD.t = i;
	try {
		localStorage.setItem("mellow-mod", String(i));
	} catch (x) {
		/* nothing to do */
	}
	if (i !== 0) {
		setBend(0);
	}
}

const qlMax = () => Math.max(0, QSV.length * 24 - 78);

function qlShow() {
	const top = QSEL * 24;
	if (top < QL.sc) {
		QL.sc = top;
	} else if (top + 24 > QL.sc + 78) {
		QL.sc = top + 24 - 78;
	}
	QL.sc = clamp(QL.sc, 0, qlMax());
}

function qsPlay(e) {
	const res = qApply(e, S.trk);
	if (res) {
		toast(res);
		return;
	}
	toast("PLAYING " + e.n + " ON T" + (S.trk + 1));
}

function qsSave() {
	const r = qSaveCurrent(S.trk);
	if (r) {
		toast(r);
		return;
	}
	QSEL = QSV.length - 1;
	qlShow();
	toast("SAVED " + QSV[QSEL].n);
}

function qsDelete(e) {
	if (!e) {
		return;
	}
	const n =
		performance.now(); /* DELETE needs two taps (or turns), the second not instantly and within 2.5 s */
	if (QL.arm === e && n - QL.at >= 350 && n - QL.at < 2500) {
		QSV.splice(QSV.indexOf(e), 1);
		saveQSV();
		QL.arm = null;
		QSEL = clamp(QSEL, 0, Math.max(0, QSV.length - 1));
		QL.sc = clamp(QL.sc, 0, qlMax());
		return;
	}
	if (QL.arm !== e || n - QL.at >= 2500) {
		QL.arm = e;
		QL.at = n;
	}
}

function qsKey(i) {
	if (i < QSV.length) {
		QSEL = i;
		qlShow();
		pop(
			"SAVED",
			QSV[i].n + "  ·  " + QSV[i].s.length + (QSV[i].s.length > 1 ? " STEPS" : " STEP"),
			QSV.length > 1 ? i / (QSV.length - 1) : 0,
		);
	} else {
		toast("NO SAVED QUEUE " + (i + 1));
	}
}
/* white keys 1-12 on the saved page */
function qsPages(k) {
	const o = (l, st, si, v, set) => ({
		l,
		nu: 1,
		st,
		si,
		sn: si + 1,
		v,
		n: st > 1 ? si / (st - 1) : 0,
		set,
	});
	if (k === "queue") {
		QSEL = clamp(
			QSEL,
			0,
			Math.max(0, QSV.length - 1),
		); /* the list can shrink under it (a delete, a reload) */
		const q = A.q[S.trk],
			pend = q.pend.length + q.live.filter((e) => !e.ended).length,
			tag = QS.kb ? "  KB>Q" : "";
		return [
			{
				t: "1/3 QUEUE" + tag,
				p: [
					o("QUEUE", 2, QS.on, QS.on ? "ON" : "OFF", (d) => {
						const on = d > 0 ? 1 : 0;
						if (on === QS.on) {
							return;
						}
						QS.on = on;
						if (!on) {
							for (let t = 0; t < 4; t++) {
								qClear(t);
							}
						}
						saveQS();
					}),
					o("KEYBOARD", 4, QS.kb, ["OFF", "MIDI", "QWERTY", "BOTH"][QS.kb], (d) => {
						const v = clamp(QS.kb + d, 0, 3);
						if (v === QS.kb) {
							return;
						}
						QS.kb = v;
						KBQ.warn = "";
						kbqFlush();
						saveQS();
					}),
					o("MODE", 3, QS.mode, QMODES[QS.mode], (d) => {
						QS.mode = clamp(QS.mode + d, 0, 2);
						saveQS();
					}),
					{
						l: "WAIT",
						nu: 1,
						v: QS.wait.toFixed(1) + " S",
						n: (QS.wait - 0.3) / 4.7,
						r: 47,
						set: (d) => {
							QS.wait = clamp(Math.round((QS.wait + d * 0.1) * 10) / 10, 0.3, 5);
							saveQS();
						},
					},
				],
				g: gQueue,
			},
			{
				t: "2/3 TIMING" + tag,
				p: [
					{
						l: "OVERLAP",
						nu: 1,
						v: QS.tail.toFixed(1) + " S",
						n: QS.tail / 3,
						r: 30,
						set: (d) => {
							QS.tail = clamp(Math.round((QS.tail + d * 0.1) * 10) / 10, 0, 3);
							saveQS();
						},
					},
					o("TIMING", 2, QS.sync ? 0 : 1, QS.sync ? "SYNC" : "FREE", (d) => {
						QS.sync = d > 0 ? 0 : 1;
						saveQS();
					}),
					{
						l: "NOTE GAP",
						nu: 1,
						v: QS.sync ? (QS.gapS ? QS.gapS + "/16" : "NONE") : QS.gapF + " MS",
						n: QS.sync ? QS.gapS / 8 : QS.gapF / 1000,
						r: QS.sync ? 8 : 20,
						set: (d) => {
							if (QS.sync) {
								QS.gapS = clamp(QS.gapS + d, 0, 8);
							} else {
								QS.gapF = clamp(QS.gapF + d * 50, 0, 1000);
							}
							saveQS();
						},
					},
					{
						l: "CLEAR",
						nu: 1,
						v: pend ? pend + (pend > 1 ? " STEPS" : " STEP") : "EMPTY",
						n: 0,
						set: () => {
							if (!qsOnce("clr")) {
								return;
							}
							qClear(S.trk);
							toast("QUEUE CLEARED");
						},
					},
				],
				g: gQueue,
			},
			{
				t: "3/3 SAVED QUEUES" + tag,
				p: [
					{
						l: "PICK",
						nu: 1,
						st: Math.max(1, QSV.length),
						si: QSEL,
						sn: QSEL + 1,
						v: QSV.length ? QSV[QSEL].n : "NONE",
						n: QSV.length > 1 ? QSEL / (QSV.length - 1) : 0,
						r: Math.max(2, QSV.length),
						set: (d) => {
							QSEL = clamp(QSEL + d, 0, Math.max(0, QSV.length - 1));
							qlShow();
						},
					},
					{
						l: "PLAY",
						nu: 1,
						v: QSV.length ? "TURN" : "---",
						n: 0,
						set: () => {
							if (QSV[QSEL] && qsOnce("play")) {
								qsPlay(QSV[QSEL]);
							}
						},
					},
					{
						l: "SAVE",
						nu: 1,
						v:
							QSV.length >= QSVMAX
								? "FULL"
								: q.log.length
									? q.log.length + (q.log.length > 1 ? " STEPS" : " STEP")
									: "NONE",
						n: 0,
						set: () => {
							if (qsOnce("save")) {
								qsSave();
							}
						},
					},
					{
						l: "DELETE",
						nu: 1,
						v: QL.arm && QL.arm === QSV[QSEL] ? "SURE?" : QSV.length ? QSV[QSEL].n : "NONE",
						n: 0,
						set: () => {
							if (QSV[QSEL]) {
								qsDelete(QSV[QSEL]);
							}
						},
					},
				],
				g: gSaved,
				z: (x, y) => {
					if (y >= 110 && y < 125 && x >= 186 && x < 234) {
						return { t: "qz", k: "save", tap: true };
					}
					if (y >= 126 && y < 205 && x >= 6 && x < 226) {
						return { t: "qlist", tap: true, sc0: QL.sc };
					}
					return null;
				},
			},
		];
	}
	const t = MOD.t,
		id = stripId(t),
		a = S.auto[id],
		has = !!(a && a.v),
		bi = AU_BARS.indexOf(has ? a.bars : AUC.bars);
	return [
		{
			t: "1/2 STRIP TARGET",
			p: [
				{
					l: "TARGET",
					nu: 1,
					st: MODT.length,
					si: t,
					sn: t + 1,
					v: MODT[t][0],
					n: t / (MODT.length - 1),
					r: MODT.length,
					set: (d) => stripTarget(clamp(MOD.t + d, 0, MODT.length - 1)),
				},
				{
					l: "LANE",
					v: has ? a.bars + (a.bars > 1 ? " BARS" : " BAR") : "NONE YET",
					n: 0,
					set: null,
				},
				{
					l: "CLEAR",
					nu: 1,
					v: has ? "TURN" : "---",
					n: 0,
					set: () => {
						if (has && qsOnce("lane")) {
							undoPush();
							delete S.auto[id];
							aRt(id).run = 0;
							toast("LANE CLEARED");
						}
					},
				},
				NONE,
			],
			g: gStripTargets,
			z: (x, y) => {
				if (y >= 114 && y < 198 && x >= 6 && x < 234) {
					const c = Math.floor((x - 6) / 57),
						r = Math.floor((y - 114) / 29),
						i = r * 4 + c;
					if (c >= 0 && c < 4 && i < MODT.length && x - 6 - c * 57 < 54 && y - 114 - r * 29 < 26) {
						return { t: "qz", k: "chip", i, tap: true };
					}
				}
				return null;
			},
		},
		{
			t: "2/2 AUTOMATE",
			p: [
				o("LENGTH", 5, bi, AU_BARS[bi] + (AU_BARS[bi] > 1 ? " BARS" : " BAR"), (d) => {
					const n = AU_BARS[clamp(bi + d, 0, 4)];
					if (has && a.bars !== n) {
						undoPush();
						a.bars = n;
					}
					AUC.bars = n;
				}),
				{
					l: "RECORD",
					nu: 1,
					v: AUC.rec ? "RECORDING" : AUC.armed ? "ARMED" : "READY",
					n: 0,
					set: () => {
						if (!qsOnce("rec", 500)) {
							return;
						}
						if (AUC.armed) {
							AUC.armed = false;
							AUC.rec = null;
						} else {
							aStart(MOD.t);
						}
					},
				},
				o("PLAYS", 3, has ? a.mode : 0, ["OFF", "LOOP", "TAP"][has ? a.mode : 0], (d) => {
					if (!has) {
						if (d && qsOnce("norec", 1500)) {
							toast("RECORD ONE FIRST");
						}
						return;
					}
					const m = clamp(a.mode + d, 0, 2);
					if (m === a.mode) {
						return;
					}
					a.mode = m;
					const r = aRt(id);
					r.run = 0;
					r.t0 = performance.now();
					r.last = -1;
				}),
				o("FOLLOWS", 2, has ? a.sync : 0, has && a.sync ? "FREE CLOCK" : "THE SONG", (d) => {
					if (!has) {
						if (d && qsOnce("norec", 1500)) {
							toast("RECORD ONE FIRST");
						}
						return;
					}
					const v = d > 0 ? 1 : 0;
					if (a.sync !== v) {
						undoPush();
						a.sync = v;
					}
				}),
			],
			g: gStripLane,
		},
	];
}

const qsChip = (x, y, w, h, label, on) => {
	B(x, y, w, h, on ? P.acc : P.dim);
	T(label, x + (w >> 1), y + ((h - 7) >> 1), on ? P.acc : P.fg, 1, "c");
};

const fitW = (s, w) => {
	s = String(s);
	while (s.length > 1 && TW(s) > w) {
		s = s.slice(0, -1);
	}
	return s;
};

// 1/3 and 2/3: this track's queue as 16 slots (the playing step filled, the waiting ones outlined, a bent step with its arrow), what it is doing, and how to make one
function gQueue(x, y, w, h, now, live) {
	const t = S.trk,
		q = A.q[t];
	R(x, y, w, h, P.grid);
	const cyc = QS.mode === 2 && q.cyc.length,
		seq = cyc ? q.cyc.slice() : [...q.live.filter((e) => !e.ended), ...q.pend],
		n = seq.length,
		pads = engOf(t) === "DRUM" || engOf(t) === "SMP";
	T("T" + (t + 1) + " QUEUE  " + (n ? n + " OF " + QMAX : "EMPTY"), x + 4, y + 3, P.dim);
	T(QMODES[QS.mode] + (QS.on ? "" : "  OFF"), x + w - 4, y + 3, QS.on ? P.acc : P.rec, 1, "r");
	for (let i = 0; i < QMAX; i++) {
		const cx = x + 3 + Math.round((i & 7) * 28.2),
			cy = y + 15 + (i >> 3) * 27,
			it =
				seq[
					i
				]; /* (i&7): slots 9-16 are the second row; they were drawn off the right edge of the screen (UI hunt) */
		if (!it) {
			B(cx, cy, 26, 24, P.faint);
			continue;
		}
		const on = q.live.some((e) => !e.ended && e.notes === it.notes),
			nt = it.notes,
			b = it.bend || 0;
		if (on) {
			R(cx, cy, 26, 24, P.acc);
		} else {
			B(cx, cy, 26, 24, it.hold ? P.acc : P.fg);
		}
		const c = on ? P.selfg : P.fg;
		T(pads ? PADN[padOf(nt[0])].slice(0, 4) : note(nt[0]), cx + 13, cy + 4, c, 0.85, "c");
		T(
			nt.length > 1 ? "+" + nt.length : it.hold ? "HOLD" : (it.dur || 0).toFixed(1),
			cx + 13,
			cy + 14,
			on ? P.selfg : P.dim,
			0.7,
			"c",
		);
		if (b) {
			T(b > 0 ? "\u0002" : "\u0003", cx + 2, cy + 2, on ? P.selfg : P.acc);
		}
	}
	T(
		q.pend.length || q.live.length
			? "SWIPE LEFT ON A QUEUED KEY: CANCEL"
			: "SWIPE A KEY RIGHT TO QUEUE IT",
		x + w / 2,
		y + h - 22,
		P.dim,
		1,
		"c",
	);
	T("HOLD: LENGTH   UP / DOWN: BEND", x + w / 2, y + h - 11, P.hint, 1, "c");
}

// 3/3: the saved queues; the list scrolls by dragging it, the chips act on lift
function gSaved(x, y, w, h, now, live) {
	if (QL.arm && now - QL.at > 2500) {
		QL.arm = null;
	}
	R(x, y, w, h, P.grid);
	QL.sc = clamp(QL.sc, 0, qlMax());
	if (!QSV.length) {
		T("NOTHING SAVED YET", 120, 138, P.dim, 1, "c");
		T("SWIPE A QUEUE IN, THEN SAVE IT (K3)", 120, 152, P.hint, 1, "c");
	}
	QSV.forEach((e, i) => {
		const ry = 126 + i * 24 - QL.sc;
		if (ry < 110 || ry >= 205) {
			return;
		}
		const sel = i === QSEL,
			n = e.s.length,
			arm = QL.arm === e;
		if (sel) {
			R(x, ry, 2, 21, P.acc);
		}
		R(x + 2, ry + 22, w - 4, 1, P.faint);
		T(
			fitW(
				e.n + "  " + n + (n > 1 ? " STEPS" : " STEP") + "  " + qsvTime(e).toFixed(1) + " S",
				128,
			),
			x + 8,
			ry + 3,
			sel ? P.acc : P.fg,
		);
		T(fitW(qsvSum(e), 128), x + 8, ry + 13, P.dim);
		qsChip(x + 140, ry + 3, 30, 16, "PLAY", false);
		qsChip(x + 174, ry + 3, 40, 16, arm ? "SURE?" : "DELETE", arm);
	});
	R(x, y, w, 16, P.grid);
	T("SAVED " + QSV.length + "/" + QSVMAX + "  PLAY ON T" + (S.trk + 1), x + 4, y + 4, P.dim);
	qsChip(x + 180, y + 1, 42, 14, QSV.length >= QSVMAX ? "FULL" : "SAVE", false);
}

// strip 1/2: the twelve things the strip can control
function gStripTargets(x, y, w, h, now, live) {
	R(x, y, w, h, P.grid);
	MODT.forEach((T0, i) => {
		const cx = x + Math.floor(i % 4) * 57,
			cy = y + 4 + (i >> 2) * 29,
			sel = i === MOD.t;
		if (sel) {
			R(cx, cy, 54, 26, P.sel);
		} else {
			B(cx, cy, 54, 26, P.faint);
		}
		T(T0[0], cx + 27, cy + 10, sel ? P.selfg : P.fg, 1, "c");
	});
}

// strip 2/2: the recorded movement of what the strip controls now, or how to record one
function gStripLane(x, y, w, h, now, live) {
	const t = MOD.t,
		id = stripId(t),
		a = S.auto[id],
		has = !!(a && a.v);
	R(x, y, w, h, P.grid);
	T(
		"AUTOMATION FOR " +
			MODT[t][0] +
			"  ·  " +
			(has ? a.bars + (a.bars > 1 ? " BARS" : " BAR") : "NONE YET"),
		x + 4,
		y + 4,
		P.dim,
	);
	const cx = x + 4,
		cy = y + 17,
		cw = w - 8,
		ch = 40;
	R(cx, cy, cw, ch, P.bg);
	if (has) {
		let py = null;
		for (let i = 0; i < cw; i++) {
			const v = a.v[Math.min(a.v.length - 1, Math.floor((i / (cw - 1)) * (a.v.length - 1)))] / 255,
				yy = Math.round(cy + ch - 3 - v * (ch - 6));
			if (py != null) {
				L(cx + i - 1, py, cx + i, yy, P.acc);
			}
			py = yy;
		}
	} else {
		DH(cx + 2, cy + ch / 2, cw - 4, P.faint, 4, 4);
	}
	T(
		AUC.rec
			? "RECORDING  ·  MOVE THE STRIP"
			: AUC.armed
				? "NOW TOUCH THE STRIP AND MOVE IT"
				: has
					? "LOOP: ON ITS OWN   TAP: WHEN YOU TAP"
					: "K2 RECORD, THEN MOVE THE STRIP",
		x + w / 2,
		y + h - 22,
		AUC.armed || AUC.rec ? P.acc : P.dim,
		1,
		"c",
	);
	T(
		has ? "MOVE THE STRIP YOURSELF TO TAKE OVER" : "1-16 BARS  ·  K1 PICKS THE LENGTH",
		x + w / 2,
		y + h - 11,
		P.hint,
		1,
		"c",
	);
}

// a tap on a chip or the list (the touch zones 'qz' and 'qlist'), on lift
function qzTap(z) {
	if (z.t === "qlist") {
		const i = Math.floor((z.y - 126 + QL.sc) / 24),
			e = QSV[i];
		if (!e) {
			return;
		}
		QSEL = i;
		const rx = z.x - 6,
			ry = z.y - 126 + QL.sc - i * 24;
		if (ry >= 3 && ry < 19 && rx >= 140 && rx < 170) {
			qsPlay(e);
		} else if (ry >= 3 && ry < 19 && rx >= 174 && rx < 214) {
			qsDelete(e);
		}
		return;
	}
	if (z.k === "save") {
		qsSave();
	} else if (z.k === "chip") {
		stripTarget(z.i);
		toast("STRIP: " + MODT[z.i][0]);
	}
}
