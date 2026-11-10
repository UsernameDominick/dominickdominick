// keeping the instrument still, tapping and touch editing on the screen
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---------- tap the screen ----------
// PROTOTYPE ONLY: the real FM-1 screen is not a touch screen. Every tap here does what a real control does
// (PAGE, the PRESETS knob, a mode button pressed again, a white key), so the firmware never depends on touch.
let tapKey = null;

const PPBTN = {
	fx: "fx",
	env: "env",
	lfo: "lfo",
	edit: "op",
	pit: "op",
	voice: "op",
	glob: "global",
	arp: "arp",
};

let colTap = { c: -1, t: 0 };

function screenDown(x, y) {
	if (S.dlg || S.screen === "boot") {
		return;
	}
	const s = S.screen;
	if (y >= 205) {
		const c = clamp(Math.floor(x / 60), 0, 3),
			t = performance.now(); // the four knob columns: a double-tap resets that parameter
		if (colTap.c === c && t - colTap.t < 350) {
			colTap.t = 0;
			resetKnob(c);
		} else {
			colTap = { c, t };
			if (DESK.matches) {
				const k = knobs()[c];
				if (k && k.set) {
					turn("k" + c, x - c * 60 < 30 ? -1 : 1);
				}
			}
		}
		return;
	} /* desktop: a click on the left half of a value steps it down, the right half up (a double click resets it) */
	if (y < 13) {
		if (x >= 206 && y < 12) {
			openShare();
			return;
		}
		if (x > 70 && x < 170 && s !== "presets") {
			S.screen = "presets";
		}
		return;
	}
	if (s === "home") {
		if (y >= HM.ty && y < HM.ty + HM.th && x >= 6 && x < 234) {
			const i = clamp(Math.floor((x - 6) / 57), 0, 3);
			if (i === S.trk) {
				press("op");
			} else {
				S.trk = i;
				pop("TRACK", "T" + (i + 1) + " " + ENGN[engOf(i)], i / 3);
			}
			return;
		}
		if (y >= 14 && y < HM.wy - 1) {
			S.screen = "presets";
			return;
		}
		return;
	}
	if (s === "pp") {
		if (y < 28) {
			if (onQS()) {
				S.ppPage = (S.ppPage + 1) % ppPages().length;
			} else {
				press(PPBTN[S.ppMode] || "home");
			}
		} else if ((DESK.matches || onQS()) && y >= 29 && y < 108) {
			const pg = ppPages(),
				q = pg[clamp(S.ppPage, 0, pg.length - 1)].p,
				k = (y < 69 ? 0 : 2) + (x < 120 ? 0 : 1);
			if (q[k] && q[k].set) {
				turn("k" + k, x % 120 < 60 ? -1 : 1);
			}
		}
		return;
	} /* desktop: a click on the left half of a parameter cell steps it down, the right half up */
	if (s === "presets") {
		if (y >= 14 && y < 30) {
			const tb = ptabs(),
				q = tb.t.find(
					(q) => x >= q.x - 1 && x < q.x + q.w + 1,
				); /* a tab, or the arrow at either end: the next / previous category (PAGE) */
			if (q) {
				S.pcat = q.i;
			} else if (tb.less && x < 12) {
				S.pcat = wrap(S.pcat - 1, CATS.length);
			} else if (tb.more && x >= 226) {
				S.pcat = wrap(S.pcat + 1, CATS.length);
			}
			return;
		}
		if (y >= 32 && y < 200) {
			const rows = prows(),
				top = ptop(rows),
				row = rows[top + Math.floor((y - 32) / 21)];
			if (row && row.h) {
				togglePGroup(row.cat);
			} else if (row && row.i !== S.preset) {
				loadPreset(row.i);
				if (S.paud) {
					audition();
				}
			} else if (row && x < 34) {
				favSet(PRESETS[row.i][0], !isFav());
			} /* the current preset's number: K1 FAV */
			pscroll(top);
		} /* a tap never moves the list under the finger */
		return;
	}
	if (s === "seq" && songChipHit(x, y)) {
		songOpen();
		return;
	} /* the SONG chip: the same screen as double-tapping SEQ */
	if (s === "seq" && y >= 13 && y < 29 && x < SONGCHIP.x - 4) {
		S.seqPage = (S.seqPage + 1) % 5;
		return;
	} /* the page title: the next SEQ page, wrapping (PAGE does the same; unlike the SEQ button it never switches the sequencer off) */
	if (s === "seq" && dgOn()) {
		return;
	}
	if (s === "seq") {
		if (y >= 13 && y < 30 && x >= SONGCHIP.x + SONGCHIP.w + 3) {
			openEditMenu();
			return;
		}
		const f = footHit(x, y);
		if (f) {
			footTap(f);
			return;
		}
		if (barZone(x, y)) {
			barTap(x);
			return;
		}
		return;
	}
	if (s === "save") {
		if (y >= 146 && y < 176) {
			press(x < 120 ? "octup" : "octdn");
		} else if (y >= 62 && y < 102 && x >= 8 && x < 232) {
			S.save.cur = clamp(Math.floor((x - 10) / 22), 0, 9);
		} else if (y >= 108 && y < 136) {
			const d = clamp(Math.round((x - 120) / 24), -4, 4);
			if (d) {
				turn("k1", d);
			}
		}
		return;
	} /* OCT+ SAVE / OCT- CANCEL, CURSOR, LETTER */
	if (s === "mix") {
		if (y >= 32 && y < 174 && x >= 4 && x < 236) {
			const i = Math.floor((x - 6) / 38);
			if (i >= 0 && i < 4) {
				S.trk = i;
			}
		}
		return;
	}
	if (s === "drum") {
		if (y >= 34 && y < 150 && x >= 6 && x < 234) {
			const i = clamp(Math.floor((x - 6) / 57), 0, 3) + 4 * clamp(Math.floor((y - 34) / 58), 0, 1);
			screenUp();
			tapKey = ["w", i];
			keyOn("w", i);
		}
		return;
	}
	if (s === "smp") {
		if (y >= 36 && y < 124 && x >= 6 && x < 234) {
			const i = clamp(Math.floor((x - 6) / (228 / 8)), 0, 7);
			screenUp();
			tapKey = ["w", i];
			keyOn("w", i);
		}
		return;
	}
}

function screenUp() {
	if (tapKey) {
		keyOff(tapKey[0], tapKey[1]);
		tapKey = null;
	}
}

/* the cog in the status strip: a tap opens the settings sheet, a hold (0.6 s) switches the bench grid off or on */
let gearT = 0,
	bpmDrag = null,
	tapTimes = [];

const stripHit = (x, y) => !S.dlg && S.screen !== "boot" && y < 14;

const gearHit = (x, y) => stripHit(x, y) && x >= 198 && x < 220;

const playHit = (x, y) => stripHit(x, y) && x < 14;

const bpmHit = (x, y) => stripHit(x, y) && x >= 20 && x < 28 + TW(S.bpm);

// the tempo, changed the way the settings sheet changes it (a running pattern keeps its place)
function nudgeTempo(d) {
	const ob = S.bpm,
		oss = stepSec();
	S.bpm = clamp(S.bpm + d, 30, 300);
	if (stepSec() !== oss) {
		rebase(oss, ob);
	}
	pop("TEMPO", S.bpm + " BPM", (S.bpm - 30) / 270);
}

// tap the tempo: the average gap of your last few taps (a pause over 2 s starts the count again)
function tapTempo() {
	const now = performance.now();
	if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2000) {
		tapTimes = [];
	}
	tapTimes.push(now);
	if (tapTimes.length > 5) {
		tapTimes.shift();
	}
	if (tapTimes.length < 2) {
		pop("TAP TEMPO", "TAP AGAIN", 0);
		return;
	}
	const gap = (tapTimes[tapTimes.length - 1] - tapTimes[0]) / (tapTimes.length - 1);
	nudgeTempo(clamp(Math.round(60000 / gap), 30, 300) - S.bpm);
}

// the two boxes on the KEY screen
const keyModeHit = (x, y) => {
	if (S.screen !== "scale" || S.dlg) {
		return false;
	}
	for (const m of [1, 2]) {
		const b = KMODE[m];
		if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) {
			setKeyMode(keyMode() === m ? 0 : m);
			return true;
		}
	}
	return false;
};

// ---------- touch editing on the screen (PROTOTYPE ONLY: the real screen is not a touch screen) ----------
// Touch a graph and drag: it draws the shape, and the sliders and the four values under it follow at once (they read the same numbers).
// Swipe sideways on any value (a parameter row, a Global row, a track tile, one of the four values at the bottom) to change it, right = up.
// Each of these just moves the same parameters the real knobs move, so the firmware never depends on touch.
const GB = { x: 6, y: 110, w: 228, h: 88 };

function gEdit(cur, x, y, st, first) {
	if (S.screen === "pp") {
		const pg = ppPages();
		cur = pg[clamp(S.ppPage, 0, pg.length - 1)];
	} /* fresh parameter objects: their current values are read at call time */
	const tc = [],
		g = cur.g,
		P4 = cur.p,
		put = (q, v) => {
			if (!q || !q.set) {
				return;
			}
			tc.push(P4.indexOf(q));
			const c = q.sn != null ? q.sn : +q.v,
				d = Math.round(v) - c;
			if (d) {
				q.set(d);
			}
		};
	const fx = (lo, hi) => lo + clamp((x - GB.x) / GB.w, 0, 1) * (hi - lo),
		fy = (lo, hi) => lo + clamp((GB.y + GB.h - y) / GB.h, 0, 1) * (hi - lo);
	const o = S.ops[S.op];
	if (g === gFilter) {
		put(P4[1], fx(0, 127));
		put(P4[2], fy(0, 99));
	} else if (g === gReverb) {
		put(P4[1], fx(0, 99));
		put(P4[3], fy(0, 100));
	} else if (g === gDelay) {
		put(P4[1], fx(0, 99));
		put(P4[3], fy(0, 100));
	} else if (g === gDist) {
		put(P4[0], fx(0, 99));
		put(P4[2], fy(0, 100));
	} else if (g === gTape) {
		put(P4[0], fx(0, 99));
		put(P4[2], fy(0, 99));
	} else if (g === gLfo) {
		if (cur.t === "1/2 LFO") {
			put(P4[0], fx(0, 99));
			put(P4[2], fy(0, 99));
		} else if (first) {
			S.lfo.w = wrap(S.lfo.w + 1, 6);
			tc.push(1);
		}
	} else if (g === gArp) {
		if (cur.t === "1/2 ARPEGGIO") {
			put(P4[3], fx(5, 100));
			put(P4[2], fy(1, 4));
		} else {
			put(P4[1], fx(50, 75));
		}
	} else if (g === gTune) {
		put(P4[1], fx(0, 31));
		put(P4[2], fy(0, 99));
	} else if (g === gAlgMini) {
		const a = 1 + Math.floor(clamp((x - GB.x) / GB.w, 0, 0.999) * 32);
		if (a !== S.alg) {
			S.alg = a;
			adsrFromOps();
		}
		tc.push(0);
	} else if (g === gLevel) {
		if (y < GB.y + 48) {
			o.lv = Math.round(fx(0, 99));
			tc.push(3);
		} else {
			o.kvs = clamp(Math.floor((x - GB.x - 6) / 14), 0, 7);
			tc.push(2);
		}
	} else if (g === gScale) {
		const bx = GB.x + Math.round((o.bp / 99) * GB.w),
			mid = GB.y + GB.h / 2;
		if (first) {
			st.bp = Math.abs(x - bx) <= 14;
		}
		if (st.bp) {
			o.bp = Math.round(fx(0, 99));
			tc.push(0);
		} else {
			const dep = Math.round(clamp(Math.abs(y - mid) / (GB.h / 2 - 4), 0, 1) * 99);
			if (x < bx) {
				o.ld = dep;
				tc.push(1);
			} else {
				o.rd = dep;
				tc.push(2);
			}
		}
	} else if (g === gOpEnv) {
		const ex = GB.x + 4,
			ey = GB.y + 4,
			ew = GB.w - 8,
			eh = GB.h - 8;
		if (first) {
			const p = envPts(o, ex, ey, ew, eh);
			let bd = 1e9;
			st.i = 0;
			[1, 2, 3, 5].forEach((k, i) => {
				const d = Math.hypot(p[k].x - x, p[k].y - y);
				if (d < bd) {
					bd = d;
					st.i = i;
				}
			});
		}
		const p = envPts(o, ex, ey, ew, eh),
			i = st.i,
			k = [1, 2, 3, 5][i],
			base = ey + eh - 1,
			seg = i === 3 ? ex + ew - 1 - x : x - p[k - 1].x;
		o.L[i] = clamp(Math.round(((base - y) / (eh - 1)) * 99), 0, 99);
		o.R[i] = clamp(Math.round(100 - ((seg - 3) / (ew * 0.22)) * 100), 0, 99);
		tc.push(i);
	} else if (g === gPeg) {
		const x0 = GB.x + 4,
			mid = GB.y + GB.h / 2,
			ly = (l) => Math.round(mid - ((l - 50) / 50) * (GB.h / 2 - 4)),
			sg = (r) => 4 + Math.round(((100 - r) / 100) * 40);
		const pts = [];
		let cx = x0;
		for (let i = 0; i < 3; i++) {
			cx += sg(S.pegR[i]);
			pts.push({ x: cx, y: ly(S.pegL[i]) });
		}
		pts.push({ x: cx + 40 + sg(S.pegR[3]), y: ly(S.pegL[3]) });
		if (first) {
			let bd = 1e9;
			st.i = 0;
			pts.forEach((q, i) => {
				const d = Math.hypot(q.x - x, q.y - y);
				if (d < bd) {
					bd = d;
					st.i = i;
				}
			});
		}
		const i = st.i,
			prev = i === 0 ? x0 : i === 3 ? pts[2].x + 40 : pts[i - 1].x;
		S.pegL[i] = clamp(Math.round(50 + ((mid - y) / (GB.h / 2 - 4)) * 50), 0, 99);
		S.pegR[i] = clamp(Math.round(100 - ((x - prev - 4) / 40) * 100), 0, 99);
		tc.push(i);
	} else if (g === gADSR) {
		const a = S.adsr,
			base = GB.y + GB.h - 14,
			top = GB.y + 6,
			xs = [
				0,
				4 + a.a * 0.5,
				4 + a.a * 0.5 + 4 + a.d * 0.5,
				4 + a.a * 0.5 + 4 + a.d * 0.5 + 46,
				4 + a.a * 0.5 + 4 + a.d * 0.5 + 46 + 4 + a.r * 0.5,
			].map((v) => GB.x + 6 + v);
		if (first) {
			let bd = 1e9;
			st.i = 0;
			[1, 2, 4].forEach((k, i) => {
				const d = Math.abs(xs[k] - x);
				if (d < bd) {
					bd = d;
					st.i = i;
				}
			});
		}
		const i = st.i;
		if (i === 0) {
			a.a = clamp(Math.round((x - xs[0] - 4) / 0.5), 0, 99);
		} else if (i === 1) {
			a.d = clamp(Math.round((x - xs[1] - 4) / 0.5), 0, 99);
			a.s = clamp(Math.round(((base - y) / (base - top)) * 99), 0, 99);
		} else {
			a.r = clamp(Math.round((x - xs[3] - 4) / 0.5), 0, 99);
		}
		tc.push(...(i === 0 ? [0] : i === 1 ? [1, 2] : [3]));
		applyAdsr();
	} else if (g === gAnaEnv) {
		if (first) {
			st.i = x < GB.x + GB.w / 2 ? 0 : 3;
		}
		put(
			P4[st.i],
			st.i
				? clamp((x - GB.x - GB.w / 2) / (GB.w / 2), 0, 1) * 99
				: clamp((x - GB.x) / (GB.w / 2), 0, 1) * 99,
		);
	} /* left half: ATTACK, right half: RELEASE */
	else if (S.screen === "pp" && cur.t === "CHORUS") {
		put(P4[0], fx(0, 99));
		put(P4[1], fy(0, 99));
	} else if (S.screen === "pp" && cur.t === "PHASER") {
		put(P4[0], fx(0, 99));
		put(P4[1], fy(0, 99));
	}
	if (tc.length) {
		const u = tc.filter((i) => i >= 0);
		if (u.length) {
			S.hot = { c: u[0], cs: u, t: performance.now(), d: 0 };
		}
		u.forEach((i) => aNote(P4[i]));
	}
	if (g === gOpEnv && st.i != null) {
		const i = st.i;
		aNoteRaw(o.L, i, 0, 99, "OP" + (S.op + 1) + " LEVEL " + (i + 1));
		aNoteRaw(o.R, i, 0, 99, "OP" + (S.op + 1) + " RATE " + (i + 1));
	} else if (g === gPeg && st.i != null) {
		const i = st.i;
		aNoteRaw(S.pegL, i, 0, 99, "PITCH ENV LEVEL " + (i + 1));
		aNoteRaw(S.pegR, i, 0, 99, "PITCH ENV RATE " + (i + 1));
	}
}

// ---- the sequencer screen by touch: the bars are the velocities. Touch an empty step and a note is placed at the height you touched; tap a note to delete it;
// drag a bar up or down to change its velocity (dragging across steps paints them). The row of boxes also adds and removes steps (a drag paints the same on or off).
// With SNAP on, only the grid's steps can be touched. Each of these is the NOTE / VELOCITY knob or a white key doing the same thing, so the firmware never depends on touch.
function sqStep(x, z) {
	const j0 = clamp(Math.floor((x - sqX0()) / sqCW()), 0, SPB() - 1);
	return clamp(snapIdx(z.vb * SPB() + j0), 0, nstT() - 1);
}

function sqApply(z, x, y, first) {
	const q = S.seq,
		perc = ["DRUM", "SMP"].includes(engOf(S.trk));
	let ch = false,
		// eslint-disable-next-line no-useless-assignment -- the first value is a safe default
		hc = 0,
		j;
	if (z.kind === "gate") {
		j = z.j;
		q.sel = j;
		hc = 2;
		let g = ((x - z.x0g + 3) / sqCW()) * 100;
		if (snapOn()) {
			const un = unitSteps() * 100;
			g = Math.max(un, Math.round(g / un) * un);
		}
		g = clamp(Math.round(g / 5) * 5, 5, gateMax());
		if (g > 100) {
			g = gateQ(g);
		}
		if (q.gate[j] !== g) {
			q.gate[j] = g;
			ch = true;
		}
	} else {
		j = sqStep(x, z);
		if (z.kind === "box") {
			if (first) {
				z.add = q.st[j] < 0;
			}
			if (z.add !== q.st[j] >= 0) {
				stepOn(j, z.add);
				ch = true;
			}
			q.sel = j;
			hc = 1;
		} else {
			q.sel = j;
			hc = [3, 1, 2][UI.sqe];
			if (first) {
				z.had = q.st[j] >= 0;
			} /* a bare tap on a note deletes it (on release); on an empty step it places one at that height; editing any attribute adds the note until it is deleted */
			if (z.moved || (first && !z.had)) {
				if (q.st[j] < 0) {
					stepOn(j, true);
					ch = true;
				}
				const b = UI.sqe === 0 ? q.vel[j] : UI.sqe === 1 ? q.st[j] : q.gate[j];
				sqSet(q, j, y, perc);
				if ((UI.sqe === 0 ? q.vel[j] : UI.sqe === 1 ? q.st[j] : q.gate[j]) !== b) {
					ch = true;
				}
			}
		}
	}
	if (S.seqPage === 2) {
		S.hot = { c: hc, t: performance.now(), d: 0 };
	}
	const key = j + ":" + q.st[j] + ":" + q.vel[j];
	if (ch && AC && q.st[j] >= 0 && z.last !== key && z.kind !== "gate") {
		z.last = key;
		stepPlay(S.trk, j, AC.currentTime);
	}
}

// one undo step per touch, pushed when the touch ends and only if it changed something (a tap that just selects a note used to leave a step that undid nothing)
function sqUndo(z) {
	const js = z.us;
	if (!js) {
		return;
	}
	z.us = null;
	if (songSnap(true) === js) {
		return;
	}
	UND.u.push("STEPS\x1f" + js);
	if (UND.u.length > 16) {
		UND.u.shift();
	}
	UND.r.length = 0;
}

// the dropdown that picks what the sequencer's bars edit (a small popup under the chip in the screen's top right)
const EMENU = { open: false };

const menuOpen = (k) => k === "edit" && EMENU.open;

function openEditMenu() {
	let m = document.getElementById("editmenu");
	if (!m) {
		m = document.createElement("div");
		m.id = "editmenu";
		m.className = "modmenu";
		m.hidden = true;
		m.style.gridTemplateColumns = "repeat(3,1fr)";
		document.body.appendChild(m);
	}
	m.innerHTML = "";
	SQE.forEach((n, i) => {
		const b = document.createElement("button");
		b.className = "mt";
		b.textContent = n;
		b.setAttribute("aria-pressed", String(UI.sqe === i));
		b.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			UI.sqe = i;
			saveUI();
			closeEditMenu();
			toast("BARS EDIT " + n);
		});
		m.appendChild(b);
	});
	const r = document.getElementById("big").getBoundingClientRect();
	m.style.top = Math.round(r.top + (r.height * 28) / 240) + "px";
	m.style.bottom = "auto";
	m.hidden = false;
	EMENU.open = true;
	setTimeout(() => document.addEventListener("pointerdown", outsideEdit, true), 0);
}

function outsideEdit(e) {
	const m = document.getElementById("editmenu");
	if (m && m.contains(e.target)) {
		return;
	}
	closeEditMenu();
	if (e.target === big) {
		e.stopPropagation();
		e.preventDefault();
	}
}
/* a tap on the screen that closes the dropdown is only that (it used to place or delete a note under the finger as well) */
function closeEditMenu() {
	const m = document.getElementById("editmenu");
	if (m) {
		m.hidden = true;
	}
	EMENU.open = false;
	document.removeEventListener("pointerdown", outsideEdit, true);
}

let lz = null;

function lcdSwipe(n, sg) {
	// one step (sg = +1 / -1) on the value under the finger
	const z = lz;
	if (z.t === "knob") {
		turn("k" + z.c, sg);
	} else if (z.t === "tile") {
		const t = S.tracks[z.i];
		t.vol = clamp(t.vol + sg, 0, 100);
		aNoteRaw(t, "vol", 0, 100, "T" + (z.i + 1) + " VOLUME");
		pop("T" + (z.i + 1) + " VOLUME", t.vol + "%", t.vol / 100);
		syncSoon();
	} else if (z.t === "grow") {
		S.glob.sel = z.i;
		turn("k1", sg);
	} else if (z.t === "srow") {
		songSwipe(z, sg);
	}
}

function lcdPps(z) {
	const w = (big.getBoundingClientRect().width * 228) / 240;
	if (z.t === "tile") {
		return 3;
	}
	const ks = knobs(),
		k = z.t === "knob" ? ks[z.c] : z.t === "grow" ? null : null;
	if (z.t === "grow" || z.t === "srow") {
		return 30;
	}
	const r = (k && (k.r || (k.st > 1 ? k.st : 100))) || 100;
	return clamp(w / r, 2.2, 30);
}

big.addEventListener("pointerdown", (e) => {
	e.preventDefault();
	const r = big.getBoundingClientRect(),
		x = ((e.clientX - r.left) / r.width) * 240,
		y = ((e.clientY - r.top) / r.height) * 240;
	ensureAudio();
	if (gearHit(x, y)) {
		gearOn = true;
		clearTimeout(gearT);
		gearT = setTimeout(() => {
			gearOn = false;
			toggleGrid();
			try {
				navigator.vibrate && navigator.vibrate(14);
			} catch (z) {
				/* nothing to do */
			}
		}, 600);
		return;
	}
	if (playHit(x, y)) {
		press("play");
		return;
	}
	if (bpmHit(x, y)) {
		bpmDrag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, bpm0: S.bpm, moved: false };
		try {
			big.setPointerCapture(e.pointerId);
		} catch (q) {
			/* nothing to do */
		}
		return;
	}
	if (keyModeHit(x, y)) {
		return;
	}
	const z = lcdZone(x, y);
	if (lz && lz.t === "sq") {
		sqUndo(lz);
	}
	if (z) {
		lz = Object.assign({}, z, { id: e.pointerId, x0: e.clientX, x, y, moved: false, st: {} });
		try {
			big.setPointerCapture(e.pointerId);
		} catch (q) {
			/* nothing to do */
		}
		if (z.t === "knob") {
			HELD = z.c;
		}
		if (z.t === "dg") {
			dgDown(lz, x, y);
		}
		if (z.t === "dq") {
			dqDown(lz, x, y);
		}
		if (z.t === "nest") {
			nestDown(lz, x, y);
		}
		if (z.ls) {
			lz.y0 = y;
			lz.sc0 = SGV.sc;
		}
		if (z.t === "sq") {
			lz.us = songSnap(true);
			lz.vb = seqViewBar();
			lz.y0 = y;
			lz.prev = S.seq.sel;
			if (z.kind === "gate") {
				S.seq.sel = z.j;
			}
			sqApply(lz, x, y, true);
		}
		if (z.t === "graph" || z.t === "home" || z.t === "tile") {
			undoPush();
		}
		if (z.t === "mixv") {
			undoPush("VOLUME");
			if (z.i < 4) {
				S.trk = z.i;
			}
			lz.y0 = y;
		}
		if (z.t === "graph") {
			wake();
			gEdit(z.cur, x, y, lz.st, true);
			syncSoon();
		} else if (z.t === "home") {
			wake();
			lz.h0 = { x, y, a: S.mac[0], b: S.mac[1] };
		}
		return;
	}
	screenDown(x, y);
	try {
		navigator.vibrate && navigator.vibrate(4);
	} catch (z) {
		/* nothing to do */
	}
});

big.addEventListener("pointermove", (e) => {
	if (bpmDrag && e.pointerId === bpmDrag.id) {
		const moved = bpmDrag.x0 - e.clientX + (bpmDrag.y0 - e.clientY);
		if (Math.abs(moved) > 6) {
			bpmDrag.moved = true;
		}
		if (bpmDrag.moved) {
			const want = clamp(
				bpmDrag.bpm0 + Math.round((e.clientX - bpmDrag.x0 - (e.clientY - bpmDrag.y0)) / 4),
				30,
				300,
			);
			if (want !== S.bpm) {
				nudgeTempo(want - S.bpm);
			}
		}
		return;
	}
	if (!lz || e.pointerId !== lz.id) {
		return;
	}
	const r = big.getBoundingClientRect(),
		x = ((e.clientX - r.left) / r.width) * 240,
		y = ((e.clientY - r.top) / r.height) * 240;
	if (lz.t === "graph") {
		gEdit(lz.cur, x, y, lz.st, false);
		syncSoon();
		return;
	}
	if (lz.t === "dg") {
		dgMove(lz, x, y);
		return;
	}
	if (lz.t === "nest") {
		nestMove(lz, x, y);
		return;
	}
	if (lz.t === "bs") {
		const dx = lz.x - x;
		if (!lz.moved && Math.abs(dx) < 4) {
			return;
		}
		lz.moved = true;
		const n = Math.trunc(dx / BSTEP);
		if (n) {
			barStep(n);
			lz.x -= n * BSTEP;
		}
		return;
	} /* the bar strip scrolls: drag left = later bars, one bar per 24 px */
	if (lz.t === "dq") {
		dqMove(lz, x, y);
		return;
	}
	if (lz.ls && songDrag(lz, x, y)) {
		return;
	}
	if (lz.sc) {
		return;
	}
	if (lz.t === "sq") {
		if (!lz.moved && (Math.abs(y - lz.y0) > 3 || Math.abs(e.clientX - lz.x0) > 4)) {
			lz.moved = true;
		}
		sqApply(lz, x, y, false);
		return;
	}
	if (lz.t === "qlist") {
		if (!lz.moved && Math.abs(y - lz.y) < 5) {
			return;
		}
		lz.moved = true;
		QL.sc = clamp(lz.sc0 - (y - lz.y), 0, qlMax());
		return;
	} /* drag the saved-queue list: it scrolls, no button is pressed */
	if (lz.t === "plist") {
		if (!lz.moved && Math.abs(y - lz.y) < 5) {
			return;
		}
		lz.moved = true;
		pscroll(lz.t0 - (y - lz.y) / 21);
		return;
	} /* drag the preset list: it scrolls, nothing loads */
	if (lz.t === "mixv") {
		if (!lz.moved && Math.abs(y - lz.y0) < 4) {
			return;
		}
		lz.moved = true;
		const v = clamp(Math.round(150 - y), 0, 100);
		if (lz.i < 4) {
			S.tracks[lz.i].vol = v;
			aNoteRaw(S.tracks[lz.i], "vol", 0, 100, "T" + (lz.i + 1) + " VOLUME");
		} else {
			S.vol = v;
			aNoteRaw(S, "vol", 0, 100, "MASTER VOLUME");
		}
		wake();
		syncSoon();
		return;
	}
	if (lz.t === "home") {
		const h = lz.h0;
		if (!lz.moved) {
			if (Math.hypot(x - h.x, y - h.y) < 4) {
				return;
			}
			lz.moved = true;
		}
		S.mac[0] = clamp(Math.round(h.a + ((x - h.x) / HM.ww) * 127), 0, 127);
		S.mac[1] = clamp(Math.round(h.b - ((y - h.y) / HM.wh) * 127), 0, 127);
		aNoteRaw(S.mac, 0, 0, 127, "MOOD");
		aNoteRaw(S.mac, 1, 0, 127, "WARMTH");
		syncSoon();
		return;
	} /* it grabs from where the values are: a bare tap changes nothing */
	const dx = e.clientX - lz.x0;
	if (!lz.moved && Math.abs(dx) < 7) {
		return;
	}
	const pps = lcdPps(lz),
		n = Math.trunc(dx / pps);
	if (n !== 0) {
		lz.moved = true;
		wake();
		for (let i = 0; i < Math.abs(n); i++) {
			lcdSwipe(1, n > 0 ? 1 : -1);
		}
		lz.x0 += n * pps;
	}
});

const lcdEnd = (e) => {
	if (bpmDrag && e.pointerId === bpmDrag.id) {
		const drag = bpmDrag;
		bpmDrag = null;
		if (e.type === "pointerup" && !drag.moved) {
			tapTempo();
		}
		return;
	}
	if (gearOn && e.type === "pointerup") {
		gearOn = false;
		clearTimeout(gearT);
		openSettings();
	} else if (e.type !== "pointerup") {
		gearOn = false;
		clearTimeout(gearT);
	}
	if (lz && e.pointerId === lz.id) {
		const z = lz;
		lz = null;
		HELD = -1;
		if (z.t === "dg") {
			dgUp(z, e);
		}
		if (z.t === "dq") {
			dqUp(z);
		}
		if (z.t === "sq" && e.type === "pointerup" && !z.moved && z.kind === "bars" && z.had) {
			const jj = sqStep(z.x, z);
			if (z.prev === jj) {
				stepOn(jj, false);
			} else if (AC) {
				stepPlay(S.trk, jj, AC.currentTime);
			}
		}
		if (z.t === "sq" && e.type === "pointerup" && !z.moved && z.kind === "gate") {
			if (z.prev === z.j) {
				stepOn(z.j, false);
			} else if (AC) {
				stepPlay(S.trk, z.j, AC.currentTime);
			}
		}
		/* a bare tap on a note's end is a tap on the note: select it, or delete it if it was selected */ if (
			z.t === "sq"
		) {
			sqUndo(z);
		}
		if (e.type === "pointerup" && !z.moved && z.tap) {
			if (z.t === "grow") {
				S.glob.sel = z.i;
			} else if (z.t === "bs") {
				barTap(z.x);
			} else if (z.t === "srow") {
				songTap(z);
			} else if (z.t === "nest") {
				nestTap(z);
			} else if (z.t === "qz" || z.t === "qlist") {
				qzTap(z);
			} else {
				screenDown(z.x, z.y);
			}
		}
	}
	screenUp();
};

["pointerup", "pointercancel"].forEach((ev) => big.addEventListener(ev, lcdEnd));

big.addEventListener("pointerleave", (e) => {
	if (!lz) {
		gearOn = false;
		clearTimeout(gearT);
		screenUp();
	}
});

// ---- desktop mouse wheel on the screen (PROTOTYPE ONLY): over a value it steps that value, one step per notch (a trackpad's small deltas add up), through the same turn() the knobs use
// (undo grouping, automation recording and haptics are the knob's own). Home: the track tiles flip tracks (wheel down = next, wrapping like the PAGE knob); Shift + wheel is a tile's volume.
function wheelDir(e, st) {
	const dy = e.deltaY || e.deltaX,
		w = e.deltaMode === 1 ? dy * 33 : e.deltaMode === 2 ? dy * 400 : dy;
	if (!w) {
		return 0;
	}
	if (Math.abs(w) >= 48) {
		st.wh = 0;
		return w < 0 ? 1 : -1;
	}
	if (st.wh * w < 0) {
		st.wh = 0;
	}
	st.wh = (st.wh || 0) + w;
	if (Math.abs(st.wh) >= 48) {
		const d = st.wh < 0 ? 1 : -1;
		st.wh = 0;
		return d;
	}
	return 0;
}

const LW = { wh: 0, k: "", t: 0 };

big.addEventListener(
	"wheel",
	(e) => {
		if (!DESK.matches) {
			return;
		}
		e.preventDefault();
		if (S.dlg || S.screen === "boot" || lz) {
			return;
		}
		const r = big.getBoundingClientRect(),
			x = ((e.clientX - r.left) / r.width) * 240,
			y = ((e.clientY - r.top) / r.height) * 240,
			s = S.screen,
			kn = (c) => {
				const k = knobs()[c];
				return k && k.set ? (d) => turn("k" + c, d) : null;
			};
		let key = null,
			act = null;
		if (y < 14 && x >= 20 && x < 28 + TW(S.bpm)) {
			key = "bpm";
			act = (d) => nudgeTempo(e.shiftKey ? d * 10 : d);
		} /* the tempo in the status strip: a notch is 1 BPM, 10 with shift */
		else if (y >= 205) {
			const c = clamp(Math.floor(x / 60), 0, 3);
			key = "k" + c;
			act = kn(c);
		} /* the four values at the bottom */
		else if (s === "home") {
			if (y >= HM.ty - 6 && y < HM.ty + HM.th + 3) {
				if (e.shiftKey) {
					const i = clamp(Math.floor((x - 6) / 57), 0, 3);
					key = "v" + i;
					act = (d) => {
						const t = S.tracks[i];
						if (performance.now() - LW.t > 700) {
							undoPush();
						}
						LW.t = performance.now();
						t.vol = clamp(t.vol + d * 5, 0, 100);
						aNoteRaw(t, "vol", 0, 100, "T" + (i + 1) + " VOLUME");
						pop("T" + (i + 1) + " VOLUME", t.vol + "%", t.vol / 100);
						syncSoon();
					};
				} else {
					key = "trk";
					act = (d) => turn("select", -d);
				}
			}
		} /* anywhere over the tiles row */
		else if (s === "pp" && qsSaved() && y >= 126 && y < 205) {
			key = "ql";
			act = (d) => {
				QL.sc = clamp(QL.sc - d * 24, 0, qlMax());
			};
		} /* the saved-queue list scrolls, a row a notch */
		else if (s === "pp") {
			const pg = ppPages(),
				cur = pg[clamp(S.ppPage, 0, pg.length - 1)];
			if (y >= 29 && y < 108) {
				const k = (y < 69 ? 0 : 2) + (x < 120 ? 0 : 1);
				key = "p" + k;
				act = kn(k);
			} /* the 2 x 2 parameter cells */
			else if (cur.g && x >= GB.x && x < GB.x + GB.w && y >= GB.y && y < GB.y + GB.h) {
				/* a graph with ONE obvious value (the others edit two values by touch: no wheel) */
				const g = cur.g,
					k =
						g === gAlgMini
							? 0
							: g === gLfo && cur.t === "2/2 LFO"
								? 1
								: g === gArp && cur.t === "2/2 ARPEGGIO"
									? 1
									: g === gScale && /^6\/6/.test(cur.t)
										? 0
										: -1;
				if (k >= 0) {
					key = "g" + k;
					act = kn(k);
				}
			}
		} else if (s === "global" && y >= 32 && y < 200) {
			const top = clamp(S.glob.sel - 3, 0, GROWS.length - 8),
				i = top + Math.floor((y - 32) / 21);
			if (i >= 0 && i < GROWS.length) {
				key = "r" + i;
				act = (d) => {
					S.glob.sel = i;
					turn("k1", d);
				};
			}
		} else if (s === "presets" && y >= 32 && y < 200) {
			key = "pl";
			act = (d) => pscroll(ptop(prows()) - d * 2);
		} /* the preset list scrolls, two rows a notch */
		else if (s === "seq" && barZone(x, y)) {
			key = "bars";
			act = (d) => barStep(-d);
		} /* the bar strip (sequencer and drum grid): wheel down = the next bar, up = the previous, one per notch */
		else if (s === "seq" && dgOn() && y >= DQ.y - 1 && y < DQ.y + DQ.h && x >= 4 && x < 236) {
			const k = clamp(Math.floor((x - 6) / DQ.dx), 0, 3);
			key = "dq" + k;
			act = (d) => dqWheel(k, d);
		} /* a quick drum bar: three per notch, one undo step per burst */
		if (!act) {
			return;
		}
		if (LW.k !== key) {
			LW.k = key;
			LW.wh = 0;
		}
		const d = wheelDir(e, LW);
		if (d) {
			act(d);
		}
	},
	{ passive: false },
);

// space starts and stops (the PLAY button's single press); not while a text field has focus or the settings sheet is open, and holding it does not repeat
document.addEventListener("keydown", (e) => {
	if (e.key !== " " && e.code !== "Space") {
		return;
	}
	if (e.ctrlKey || e.metaKey || e.altKey || !DESK.matches) {
		return;
	}
	const t = e.target,
		tg = t && t.tagName;
	if (tg === "TEXTAREA" || tg === "INPUT" || tg === "SELECT" || (t && t.isContentEditable)) {
		return;
	}
	e.preventDefault();
	if (e.repeat || SET.open) {
		return;
	}
	if (typeof mobBtns !== "undefined" && mobBtns.play) {
		flash(mobBtns.play);
	}
	press("play");
});
