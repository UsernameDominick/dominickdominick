// the song preview, drum pad rows, copy / paste / duplicate of slots and patterns
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

function bounceStart(kind) {
	ensureAudio();
	if (!AC || BNC.on) {
		return;
	}
	if (kind === "song" && !songChain().length) {
		toast("THE SONG IS EMPTY");
		return;
	}
	// a take in progress is finished and saved first, the same as STOP does (it used to be dropped untrimmed and unsaved)
	const rec0 = S.rec && S.playing;
	if (S.playing) {
		S.playing = false;
		stopSeq();
	}
	if (rec0) {
		finishRec();
	}
	S.rec = false;
	S.recExt = false;
	S.countdown = null;
	const keep = { song: S.song.on, pat: S.pat, patNext: S.patNext, metro: S.glob.metro };
	S.glob.metro = 0;
	S.song.on = kind === "song" ? 1 : 0;
	S.patNext = -1;
	const ss = stepSec(),
		steps = bouncePasses(kind).reduce((n, x) => n + x.steps, 0),
		main = steps * ss,
		tail = 3,
		sr = AC.sampleRate;
	const chunks = [],
		sp = AC.createScriptProcessor(4096, 2, 2),
		z = AC.createGain();
	z.gain.value = 0;
	A.master.connect(sp);
	sp.connect(z);
	z.connect(AC.destination);
	sp.onaudioprocess = (e) => {
		const b = e.inputBuffer;
		chunks.push({
			t: e.playbackTime,
			l: new Float32Array(b.getChannelData(0)),
			r: new Float32Array(b.getChannelData(b.numberOfChannels > 1 ? 1 : 0)),
		});
	};
	S.seqEn = true;
	S.playing = true;
	startSeq();
	audioSync();
	const t0 = A.t0,
		tEnd = t0 + main,
		tAll = tEnd + tail;
	BNC.on = true;
	BNC.info = { kind, t0, tEnd, tAll, main };
	let stopped = false;
	const finish = (ok) => {
		clearInterval(BNC.iv);
		BNC.on = false;
		try {
			A.master.disconnect(sp);
		} catch (e) {
			/* nothing to do */
		}
		try {
			sp.disconnect();
			z.disconnect();
		} catch (e) {
			/* nothing to do */
		}
		sp.onaudioprocess = null;
		if (S.playing) {
			S.playing = false;
			stopSeq();
		}
		S.song.on = keep.song;
		S.pat = keep.pat;
		S.patNext = keep.patNext;
		S.glob.metro = keep.metro;
		audioSync();
		if (!ok || !chunks.length) {
			toast("BOUNCE CANCELLED");
			return;
		}
		const first = chunks[0].t,
			skip = Math.max(0, Math.round((t0 - first) * sr)),
			n = Math.round((tAll - t0) * sr),
			L = new Float32Array(n),
			R = new Float32Array(n);
		let o = -skip;
		chunks.forEach((c) => {
			for (let i = 0; i < c.l.length; i++, o++) {
				if (o >= 0 && o < n) {
					L[o] = c.l[i];
					R[o] = c.r[i];
				}
			}
		});
		const wav = wavBytes(L, R, sr),
			name = kind === "song" ? "mellow-song" : "mellow-pattern";
		BNC.last = {
			filename: name + "-bounce.zip",
			data: zipStore([{ name: name + ".wav", data: wav }]),
			secs: n / sr,
			kind: "audio",
		};
		toast("BOUNCED " + BNC.last.secs.toFixed(1) + " S");
		try {
			openShare();
			const st = document.getElementById("shSt");
			if (st) {
				st.textContent =
					"BOUNCED " +
					BNC.last.secs.toFixed(1) +
					" S. Tap SAVE LAST BOUNCE to keep it (a ZIP with the WAV in it).";
			}
		} catch (e) {
			/* nothing to do */
		}
	};
	BNC.finish = finish;
	BNC.iv = setInterval(() => {
		const t = AC.currentTime;
		if (!stopped && t >= tEnd) {
			stopped = true;
			if (S.playing) {
				S.playing = false;
				stopSeq();
			}
		}
		if (t >= tAll + 0.1) {
			finish(true);
		}
	}, 80);
}

// ---- the song preview: the whole chain as a timeline under the chips. One block per slot, one pixel per step, so a block is as wide as its bars x repeats; five lanes: a header (slot number) and T1-T4
// (a tick per note, T4 the drum hits of all pads); a muted track is dim and struck, a muted pad dims its hits. A playhead moves while the song or the slot loop plays and the view follows it; stopped, drag it sideways.
function pvLay() {
	const o = [];
	let x = 0;
	songChain().forEach((e, i) => {
		const st = SPB() * S.plen[e.pat],
			w = st * e.rep;
		o.push({ i, x, w, st, rep: e.rep });
		x += w;
	});
	return { B: o, W: x };
}

const pvClamp = (v, g = PV) => clamp(Math.round(v), 0, Math.max(0, pvLay().W - g.w));
// g: which instance (PV on the song screen, HV = the mini player on Home; both draw the same chain with their own position, width and scroll)
// where the playhead is, in preview steps ({i: slot, x}), or null: the walked slot of a playing song, the slot looping in the dropdown, or the first slot that holds the pattern that plays
function pvHead() {
	if (!S.playing || !AC) {
		return null;
	}
	const sg = S.song,
		ch = songChain();
	if (!ch.length) {
		return null;
	}
	let i,
		rc = 0;
	if (sg.on && sg.go && !NEST.pv) {
		i = sg.pos;
		rc = sg.rc | 0;
	} else {
		i = nestOn() ? NEST.i : ch.findIndex((e) => e.pat === S.pat);
		if (i < 0 || i >= ch.length || ch[i].pat !== S.pat) {
			return null;
		}
	}
	if (i >= ch.length) {
		return null;
	}
	const st = SPB() * S.plen[ch[i].pat],
		pf = playPosF(),
		inP = ((pf % st) + st) % st;
	let base = 0;
	for (let k = 0; k < i; k++) {
		base += SPB() * S.plen[ch[k].pat] * ch[k].rep;
	}
	return { i, x: base + Math.min(rc, ch[i].rep - 1) * st + inP };
}

function songPreviewDraw(now, live, g = PV) {
	const sg = S.song,
		{ B: bl, W } = pvLay(),
		hd = live ? pvHead() : null,
		x0 = g.x,
		x1 = g.x + g.w;
	R(x0, g.y, g.w, g.h, P.bg);
	if (!bl.length) {
		T(
			g === PV ? "NO PATTERNS YET" : "NO SONG YET: SONG BUTTON, + ADD",
			x0 + g.w / 2,
			g.y + 14,
			P.faint,
			1,
			"c",
		);
		return;
	}
	const key = sg.sel + ":" + W;
	if (key !== g.key) {
		g.key = key;
		const b = bl[sg.sel];
		if (b && !(S.playing && AC)) {
			if (b.x < g.sc) {
				g.sc = b.x - 4;
			} else if (b.x + Math.min(b.w, g.w) > g.sc + g.w) {
				g.sc = b.x + Math.min(b.w, g.w) - g.w + 4;
			}
		}
	}
	if (hd && (hd.x < g.sc + 3 || hd.x > g.sc + g.w - 14)) {
		g.sc = hd.x - 24;
	}
	g.sc = pvClamp(g.sc, g);
	const ly = (t) => g.y + 10 + t * 7;
	for (const b of bl) {
		const e = sg.chain[b.i],
			bx = x0 + b.x - g.sc;
		if (bx + b.w <= x0 || bx >= x1) {
			continue;
		}
		const c0 = Math.max(bx, x0),
			c1 = Math.min(bx + b.w, x1),
			sel = b.i === sg.sel,
			play = hd && hd.i === b.i,
			mk = SGM(e),
			dm = SGDM(e);
		R(c0, g.y, c1 - c0, 8, sel ? P.sel : play ? P.rec : P.bar);
		const lab = pad(b.i + 1),
			lw = TW(lab),
			lx = Math.max(bx, x0) + 2;
		if (lx + lw <= Math.min(bx + b.w, x1) - 1) {
			T(lab, lx, g.y + 1, sel ? P.selfg : play ? P.selfg : P.dim);
		}
		for (let t = 0; t < 4; t++) {
			R(c0, ly(t), c1 - c0, 6, P.grid);
		}
		R(bx, g.y + 8, 1, g.h - 8, P.bg);
		for (let r = 1; r < b.rep; r++) {
			const rx = bx + r * b.st;
			if (rx >= x0 && rx < x1) {
				R(rx, g.y + 9, 1, g.h - 9, P.faint);
			}
		}
		for (let t = 0; t < 4; t++) {
			const q = S.pats[e.pat][t],
				n = nstP(e.pat, t),
				mu = (mk >> t) & 1,
				col = ncol(e, t),
				cc = mu ? P.faint : col ? P.tag[col] : P.fg,
				g = t === DT ? q.dg : null;
			for (let px = c0; px < c1; px++) {
				const j = ((px - bx) % b.st) % n;
				if (t === DT) {
					if (!g) {
						continue;
					}
					let on = 0,
						off = 0;
					for (let r = 0; r < DGN; r++) {
						if (g[r * SMAX + j]) {
							if ((dm >> r) & 1) {
								off = 1;
							} else {
								on = 1;
							}
						}
					}
					if (on) {
						R(px, ly(t) + 1, 1, 5, cc);
					} else if (off) {
						R(px, ly(t) + 3, 1, 3, mu ? P.faint : P.hint);
					}
				} else if (q.st[j] >= 0) {
					const hh = 3 + Math.round((q.vel[j] / 127) * 2);
					R(px, ly(t) + 6 - hh, 1, hh, cc);
				}
			}
			if (mu) {
				R(c0, ly(t) + 3, c1 - c0, 1, P.hint);
			}
		}
	}
	if (hd) {
		const hx = x0 + hd.x - g.sc;
		if (hx >= x0 && hx < x1) {
			R(hx, g.y, 1, g.h, P.fg);
		}
	}
}

function songClip(k) {
	const sg = S.song,
		i = sg.sel,
		e = sg.chain[i];
	if (
		NEST.i >= 0 &&
		k !== "mode" &&
		k !== "copy" &&
		k !== "paste" &&
		(NCLIP.mode === 0 ? k === "ins" || k === "del" : NCLIP.mode === 1 && k === "ins")
	) {
		nestCollapse();
	} // INSERT / DELETE / DUPE shift the slots: the dropdown closes
	if (k === "mode") {
		const n = (ncIdx() + 1) % NCMODES.length;
		NCLIP.mode = NCMODES[n][0];
		NCLIP.trk = NCMODES[n][1];
		toast(
			"CLIPBOARD: " +
				(NCLIP.mode === 0
					? "SLOT"
					: NCLIP.mode === 1
						? NCLIP.trk < 0
							? "PATTERN"
							: "PATTERN, T" + (NCLIP.trk + 1) + " ONLY"
						: NCLIP.mode === 2
							? "DRUM PAD ROW: " + PADS[NEST.pd]
							: "AUTOMATION LANE"),
		);
		return;
	} /* SLOT, PATTERN, one track of a pattern (T1-T4: copy, paste and clear only that track), one drum pad's row, one automation lane */
	if (NCLIP.mode === 0) {
		if (k === "copy") {
			slotCopy(i);
		} else if (k === "paste") {
			slotPaste(i);
		} else if (k === "ins") {
			slotInsert(i);
		} else {
			slotDelete(i);
		}
		return;
	}
	if (!e || e.pat < 0) {
		toast("EMPTY SLOT");
		return;
	}
	if (NCLIP.mode === 2) {
		padClip(k, e);
		return;
	}
	if (NCLIP.mode === 3) {
		laneClip(k, i);
		return;
	}
	if (k === "copy") {
		NCLIP.pat = patGrab(e.pat, NCLIP.trk);
		toast(
			"COPIED " +
				(NCLIP.trk >= 0 ? "T" + (NCLIP.trk + 1) + " OF " : "") +
				"PATTERN " +
				pad(e.pat + 1),
		);
	} else if (k === "paste") {
		if (!NCLIP.pat) {
			toast("NOTHING COPIED");
			return;
		}
		undoPush("PASTE PATTERN");
		patPut(e.pat, NCLIP.pat);
		toast(
			"PASTED " +
				(NCLIP.pat.trk >= 0 ? "T" + (NCLIP.pat.trk + 1) + " " : "") +
				"INTO PATTERN " +
				pad(e.pat + 1),
		);
	} else if (k === "ins") {
		patDupe(i);
	} else {
		undoPush("CLEAR PATTERN");
		for (let t = 0; t < 4; t++) {
			if (NCLIP.trk >= 0 && t !== NCLIP.trk) {
				continue;
			}
			const o = S.pats[e.pat][t];
			o.st.fill(-1);
			o.gate.fill(50);
			o.ch.fill(null);
			o.vel.fill(100);
			o.sel = 0;
			if (o.dg) {
				o.dg.fill(0);
			}
		}
		toast(
			"CLEARED " +
				(NCLIP.trk >= 0 ? "T" + (NCLIP.trk + 1) + " OF " : "") +
				"PATTERN " +
				pad(e.pat + 1),
		);
	}
}

// ---- finer than a track: one drum pad's row of hits (T4's grid, `q.dg[pad * SMAX + step]`) and one automation lane, copied into another pattern / slot. PAD works on the pad chosen in the dropdown (NEST.pd: tap a pad row, or K2 PADS),
// LANE on the lane chosen there (NEST.sel); COPY reads the selected slot's pattern, PASTE and CLEAR act on the selected slot (the same slot rule as the other modes). A memory copy of at most 128 bytes (a row) or 64 bytes a bar (a lane).
const padHits = (pi, pd) => {
	const g = S.pats[pi][DT].dg;
	let n = 0;
	if (g) {
		for (let j = 0; j < SMAX; j++) {
			if (g[pd * SMAX + j]) {
				n++;
			}
		}
	}
	return n;
};

function padGrab(pi, pd) {
	const g = S.pats[pi][DT].dg;
	return {
		from: pi,
		pad: pd,
		v: g ? Array.from(g.subarray(pd * SMAX, pd * SMAX + SMAX)) : new Array(SMAX).fill(0),
	};
}

function padPut(pi, pd, c) {
	const g = S.pats[pi][DT].dg;
	if (!g) {
		return;
	}
	for (let j = 0; j < SMAX; j++) {
		g[pd * SMAX + j] = c.v[j] | 0;
	}
}

function padClear(pi, pd) {
	const g = S.pats[pi][DT].dg;
	if (g) {
		g.fill(0, pd * SMAX, pd * SMAX + SMAX);
	}
}

function padClip(k, e) {
	const pd = NEST.pd,
		nm = PADS[pd],
		pn = "PATTERN " + pad(e.pat + 1);
	if (k === "copy") {
		NCLIP.padc = padGrab(e.pat, pd);
		const n = padHits(e.pat, pd);
		toast(
			"COPIED " +
				nm +
				" OF " +
				pn +
				(n ? "  " + n + (n === 1 ? " HIT" : " HITS") : "  (EMPTY ROW)"),
		);
	} else if (k === "paste") {
		const c = NCLIP.padc;
		if (!c) {
			toast("NOTHING COPIED");
			return;
		}
		undoPush("PASTE PAD ROW");
		padPut(e.pat, pd, c);
		toast("PASTED " + PADS[c.pad] + (c.pad === pd ? "" : " AS " + nm) + " INTO " + pn);
	} else if (k === "del") {
		undoPush("CLEAR PAD ROW");
		padClear(e.pat, pd);
		toast("CLEARED " + nm + " OF " + pn);
	}
}

function laneGrab(id) {
	const a = S.auto[id];
	return a
		? { base: aBase(id), a: Object.assign({}, a, { v: a.v.slice() }), from: aSlotOf(a) }
		: null;
}

function lanePut(i, c) {
	const id = aIdOf(c.base, i),
		old = S.auto[id];
	if (!old && aFull()) {
		toast("AUTOMATION LIMIT " + NLANES);
		return;
	}
	undoPush("PASTE AUTOMATION");
	if (old) {
		const r = AUR[id];
		if (r && r.on) {
			r.on = 0;
			aRelease(id, old, r);
		}
	}
	S.auto[id] = Object.assign({}, c.a, { v: c.a.v.slice(), slot: i });
	const r = aRt(id);
	r.last = -1;
	r.on = 0;
	if (NEST.i === i) {
		NEST.sel = id;
	}
	toast("PASTED " + c.a.name.replace(/ T\d$/, "") + " INTO SLOT " + (i + 1));
}

function laneDelete(id) {
	const a = S.auto[id];
	if (!a) {
		return;
	}
	undoPush("DELETE AUTOMATION");
	const r = AUR[id];
	if (r && r.on) {
		r.on = 0;
		aRelease(id, a, r);
	}
	delete S.auto[id];
	if (NEST.sel === id) {
		NEST.sel = null;
	}
}

function laneClip(k, i) {
	const id = NEST.sel && S.auto[NEST.sel] ? NEST.sel : null;
	if (k === "copy") {
		if (!id) {
			toast("OPEN A SLOT AND TAP A LANE");
			return;
		}
		NCLIP.lane = laneGrab(id);
		toast("COPIED LANE " + S.auto[id].name.replace(/ T\d$/, ""));
	} else if (k === "paste") {
		if (!NCLIP.lane) {
			toast("NOTHING COPIED");
			return;
		}
		lanePut(i, NCLIP.lane);
	} else if (k === "del") {
		if (!id) {
			toast("OPEN A SLOT AND TAP A LANE");
			return;
		}
		const nm = S.auto[id].name.replace(/ T\d$/, "");
		laneDelete(id);
		toast("DELETED LANE " + nm);
	}
}

function slotGrab(i) {
	const e = S.song.chain[i],
		ln = [];
	for (const id in S.auto) {
		const a = S.auto[id];
		if (aSlotOf(a) === i) {
			ln.push(Object.assign({}, a, { v: a.v.slice(), _b: aBase(id) }));
		}
	}
	return {
		pat: e.pat,
		rep: e.rep,
		mute: SGM(e),
		dmute: SGDM(e),
		col: [0, 1, 2, 3].map((t) => ncol(e, t)),
		ln,
	};
}

function slotPut(i, c, pp) {
	const e = S.song.chain[i];
	e.pat = pp == null ? c.pat : pp;
	e.rep = c.rep;
	e.mute = c.mute;
	e.dmute = c.dmute | 0;
	e.col = c.col.slice();
	for (const id in S.auto) {
		if (aSlotOf(S.auto[id]) === i) {
			delete S.auto[id];
		}
	}
	let drop = 0;
	c.ln.forEach((a) => {
		if (aFull()) {
			drop++;
			return;
		}
		const n = Object.assign({}, a, { v: a.v.slice(), slot: i });
		delete n._b;
		S.auto[aIdOf(a._b, i)] = n;
	});
	if (drop) {
		toast("LANE LIMIT " + NLANES + ": " + drop + " NOT COPIED");
	}
}

function slotCopy(i) {
	const e = S.song.chain[i];
	if (!e || e.pat < 0) {
		toast("EMPTY SLOT");
		return;
	}
	NCLIP.slot = slotGrab(i);
	toast(
		"COPIED SLOT " +
			(i + 1) +
			(NCLIP.slot.ln.length ? "  +" + NCLIP.slot.ln.length + " AUTOMATION" : ""),
	);
}

function slotPaste(i) {
	const sg = S.song,
		n = songChain().length;
	if (!NCLIP.slot) {
		toast("NOTHING COPIED");
		return;
	}
	if (i > n) {
		i = n;
	}
	if (i > 15) {
		return;
	}
	const c = NCLIP.slot,
		t = slotPatFor(i, c.pat, i);
	if (!t) {
		return;
	}
	undoPush("PASTE SLOT");
	if (t.cp) {
		patPut(t.p, patGrab(c.pat));
	}
	slotPut(i, c, t.p);
	sg.jump = -1;
	songSelect(i, false);
	toast(
		t.cp
			? "PASTED INTO SLOT " + (i + 1) + "  PATTERN " + pad(t.p + 1) + " IS A COPY"
			: "PASTED INTO SLOT " + (i + 1),
	);
}

function aShift(from, delta, dropAt) {
	const n = {};
	for (const id in S.auto) {
		const a = S.auto[id],
			s = aSlotOf(a);
		if (s < 0) {
			n[id] = a;
			continue;
		}
		if (s === dropAt) {
			continue;
		}
		const ns = s >= from ? s + delta : s;
		if (ns < 0 || ns > 15) {
			continue;
		}
		a.slot = ns;
		n[aIdOf(aBase(id), ns)] = a;
	}
	S.auto = n;
}

function slotInsert(i) {
	const sg = S.song,
		n = songChain().length;
	if (n >= 16) {
		toast("CHAIN FULL (16)");
		return;
	}
	if (i > n) {
		i = n;
	}
	if (!n) {
		songAdd();
		return;
	}
	const c = NCLIP.slot || slotGrab(Math.min(i, n - 1)),
		t = slotPatFor(i, c.pat, -1);
	if (!t) {
		return;
	}
	undoPush("INSERT SLOT");
	if (t.cp) {
		patPut(t.p, patGrab(c.pat));
	}
	aShift(i, 1, -2);
	sg.chain.splice(i, 0, { pat: t.p, rep: 1, mute: 0, dmute: 0, col: [0, 0, 0, 0] });
	sg.chain.pop();
	slotPut(i, c, t.p);
	if (sg.pos >= i) {
		sg.pos++;
	}
	sg.jump = -1;
	songSelect(i, false);
	toast(
		t.cp
			? "INSERTED SLOT " + (i + 1) + "  PATTERN " + pad(t.p + 1) + " IS A COPY"
			: "INSERTED SLOT " + (i + 1),
	);
}

function slotDelete(i) {
	const sg = S.song,
		n = songChain().length;
	if (i >= n) {
		toast("EMPTY SLOT");
		return;
	}
	undoPush("DELETE SLOT");
	aShift(i + 1, -1, i);
	sg.chain.splice(i, 1);
	sg.chain.push({ pat: -1, rep: 1, mute: 0, dmute: 0, col: [0, 0, 0, 0] });
	if (sg.pos > i) {
		sg.pos--;
	}
	sg.jump = -1;
	if (sg.pos >= n - 1) {
		sg.pos = 0;
	}
	songSelect(clamp(i, 0, Math.max(0, n - 2)), false);
	toast("DELETED SLOT " + (i + 1));
}

function patGrab(pi, trk) {
	trk = trk >= 0 ? trk : -1;
	return {
		from: pi,
		trk,
		len: S.plen[pi],
		tl: S.tl[pi].slice(),
		q: S.pats[pi].map((q, t) =>
			trk >= 0 && t !== trk
				? null
				: {
						sel: q.sel,
						st: q.st.slice(),
						gate: q.gate.slice(),
						ch: q.ch.slice(),
						vel: q.vel.slice(),
						dg: q.dg ? q.dg.slice() : null,
					},
		),
	};
}

function patPut(pi, c) {
	const old = pi === S.pat ? nst() : 0;
	const one = c.trk >= 0;
	if (!one || patEmpty(pi)) {
		S.plen[pi] = c.len;
	}
	c.tl.forEach((v, t) => {
		if (!one || t === c.trk) {
			S.tl[pi][t] = v;
		}
	}); /* a single-track copy leaves the other tracks and the pattern's length alone (unless the pattern is still empty) */
	c.q.forEach((s, t) => {
		if (!s) {
			return;
		}
		const o = S.pats[pi][t];
		o.sel = s.sel;
		for (let j = 0; j < SMAX; j++) {
			o.st[j] = s.st[j];
			o.gate[j] = s.gate[j];
			o.ch[j] = s.ch ? s.ch[j] : null;
			o.vel[j] = s.vel[j];
		}
		if (o.dg && s.dg) {
			o.dg.set(s.dg);
		}
	});
	if (pi === S.pat) {
		realign(old);
	}
}

const patEmpty = (pi) =>
	S.pats[pi].every((q) => q.st.every((n) => n < 0) && (!q.dg || !q.dg.some((v) => v)));

// DUPE (pattern mode): the copied pattern goes into the first unused empty pattern and a new slot after the selected one plays it, ready to be varied
function patDupe(i) {
	const sg = S.song,
		ch = songChain(),
		e = sg.chain[i];
	if (!NCLIP.pat) {
		toast("NOTHING COPIED");
		return;
	}
	if (ch.length >= 16) {
		toast("CHAIN FULL (16)");
		return;
	}
	if (!e || e.pat < 0) {
		toast("EMPTY SLOT");
		return;
	}
	const fp = patCopyTarget(-1);
	if (fp < 0) {
		toast("NO FREE PATTERN");
		return;
	}
	undoPush("DUPLICATE PATTERN");
	patPut(fp, NCLIP.pat);
	aShift(i + 1, 1, -2);
	sg.chain.splice(i + 1, 0, {
		pat: fp,
		rep: e.rep,
		mute: SGM(e),
		dmute: SGDM(e),
		col: [0, 1, 2, 3].map((t) => ncol(e, t)),
	});
	sg.chain.pop();
	if (sg.pos > i) {
		sg.pos++;
	}
	sg.jump = -1;
	songSelect(i + 1, false);
	toast("PATTERN " + pad(fp + 1) + " IS A COPY");
}

// ---- opening, leaving and playing the dropdown ----
// A slot is dropped down while NEST.i is its index and the song screen shows (leaving the screen collapses it: the frame hook). Its knobs and white keys apply while it is also the selected slot (`nestFocus`).
const nestOn = () => {
		const e = S.song.chain[NEST.i];
		return S.screen === "song" && NEST.i >= 0 && !!e && e.pat >= 0;
	},
	nestFocus = () => nestOn() && S.song.sel === NEST.i;

function nestOpen(i) {
	const sg = S.song,
		e = sg.chain[i];
	if (!e || e.pat < 0) {
		return;
	}
	closeNestMenu();
	if (NEST.i !== i) {
		NEST.sel = null;
	}
	sg.sel = i;
	NEST.i = i;
	S.seqEn = true;
	if (!(S.playing && AC)) {
		S.pat = e.pat;
		S.patNext = -1;
	} else if (!(sg.on && sg.go) && S.pat !== e.pat) {
		S.patNext = e.pat;
	} // playing: this pass finishes, then the slot's pattern loops
	audioSync();
}

function nestLeave() {
	const sg = S.song;
	if (NEST.pv) {
		NEST.pv = 0;
		const e = sg.chain[NEST.i];
		if (sg.on && S.playing && AC && e && e.pat >= 0 && e.pat === S.pat) {
			sg.pos = NEST.i;
			sg.rc = 0;
			sg.go = 1;
			sg.base = songBaseOf(NEST.i);
		}
	}
	closeNestMenu();
}
// collapsing: the song carries on from this slot
function nestCollapse() {
	if (NEST.i < 0) {
		return;
	}
	nestLeave();
	NEST.i = -1;
	NEST.sel = null;
	NEST.dr = 0;
}

const nestBack = nestCollapse;

function nestToggle(i) {
	if (nestOn() && NEST.i === i) {
		S.song.sel = i;
		nestCollapse();
	} else {
		nestOpen(i);
	}
}

function nestToSeq(t) {
	const i = NEST.i;
	nestCollapse();
	S.song.sel = i;
	songGoTrack(t);
}

// while a slot is dropped down and its pattern plays on its own, the slot's mutes apply (a walking song uses the playing slot's, as before)
const nestMask = () => {
	if (!nestOn() || !S.playing) {
		return 0;
	}
	const e = S.song.chain[NEST.i];
	return e && e.pat >= 0 && e.pat === S.pat ? SGM(e) : 0;
};

const nestPadMask = () => {
	if (!nestOn() || !S.playing) {
		return 0;
	}
	const e = S.song.chain[NEST.i];
	return e && e.pat >= 0 && e.pat === S.pat ? SGDM(e) : 0;
};

function nestStart() {
	NEST.pv = 0;
	if (nestOn() && !NEST.nob) {
		const e = S.song.chain[NEST.i];
		if (e && e.pat >= 0) {
			S.song.go = 0;
			S.song.jump = -1;
			S.pat = e.pat;
			S.patNext = -1;
			NEST.pv = S.song.on ? 1 : 0;
		}
	}
}
// PLAY here loops just this pattern, song mode on or off (startSeq calls it before it schedules the first step)
{
	const _sa = songAdvance;
	songAdvance = function (ps) {
		if (NEST.pv) {
			if (nestOn()) {
				S.patNext = -1;
				return;
			}
			nestLeave();
		}
		return _sa(ps);
	};
	const _bs = bounceStart;
	// eslint-disable-next-line no-useless-assignment, no-func-assign -- this patches the function on purpose
	bounceStart = function (k) {
		NEST.nob = 1;
		try {
			return _bs(k);
		} finally {
			NEST.nob = 0;
		}
	};
}
