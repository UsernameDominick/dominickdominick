// automation lanes of a slot and the slot dropdown (the song list)
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---- lanes: which belong to a track, what a track can automate, adding, re-scoping ----
function aTrackOf(a, id) {
	const m =
		/^tk\.(\d)\./.exec(a.path || "") ||
		/^tracks\.(\d)$/.exec(a.path || "") ||
		/^bend(\d)/.exec(aBase(id));
	return m ? +m[1] : -1;
}

function nestLanes(t) {
	const o = [];
	for (const id in S.auto) {
		const a = S.auto[id];
		if (!a || !a.v) {
			continue;
		}
		const s = aSlotOf(a);
		if (s >= 0 && s !== NEST.i) {
			continue;
		}
		if (aTrackOf(a, id) === t) {
			o.push(id);
		}
	}
	return o;
}

function nestParams(t) {
	const k = "tk." + t + ".",
		o = [],
		A = (g, n, path, key, lo, hi) => o.push({ g, n, path, key, lo, hi }),
		en = engOf(t);
	A("FILTER AND EFFECTS", "CUTOFF", k + "fx", "cut", 0, 127);
	A("FILTER AND EFFECTS", "RESONANCE", k + "fx", "res", 0, 99);
	A("FILTER AND EFFECTS", "REVERB SEND", k + "fx", "rmix", 0, 100);
	A("FILTER AND EFFECTS", "ECHO SEND", k + "fx", "emix", 0, 100);
	A("FILTER AND EFFECTS", "DISTORTION", k + "fx", "dmix", 0, 100);
	A("FILTER AND EFFECTS", "CHORUS", k + "fx", "cmix", 0, 100);
	A("FILTER AND EFFECTS", "PHASER", k + "fx", "pmix", 0, 100);
	A("FILTER AND EFFECTS", "TAPE DRIVE", k + "fx", "drv", 0, 99);
	A("LEVEL AND PITCH", "VOLUME", "tracks." + t, "vol", 0, 100);
	o.push({ g: "LEVEL AND PITCH", n: "PITCH BEND", bend: 1, path: "", key: "", lo: 0, hi: 1 });
	A("MACROS AND LFO", "MOOD", k + "mac", 0, 0, 127);
	A("MACROS AND LFO", "WARMTH", k + "mac", 1, 0, 127);
	A("MACROS AND LFO", "SPACE", k + "mac", 2, 0, 127);
	A("MACROS AND LFO", "DRIFT", k + "mac", 3, 0, 127);
	A("MACROS AND LFO", "VIBRATO", k + "lfo", "pm", 0, 99);
	A("MACROS AND LFO", "TREMOLO", k + "lfo", "am", 0, 99);
	if (en === "ANA") {
		A("ANALOG", "ANALOG CUTOFF", k + "ana", "cut", 0, 127);
		A("ANALOG", "ANALOG RESO", k + "ana", "res", 0, 99);
		A("ANALOG", "ANALOG DETUNE", k + "ana", "det", 0, 99);
	}
	if (en === "WAVE") {
		A("WAVETABLE", "WT POSITION", k + "wt", "pos", 0, 127);
		A("WAVETABLE", "WT WARP", k + "wt", "warp", 0, 99);
		A("WAVETABLE", "WT DRIVE", k + "wt", "drv", 0, 99);
		A("WAVETABLE", "WT TONE", k + "wt", "tone", 0, 99);
	}
	if (en === "SMP") {
		A("SAMPLER", "SAMPLER PITCH", k + "smp", "pitch", -12, 12);
	}
	if (en === "DRUM") {
		PADS.forEach((n, i) => {
			A("DRUMS", n + " TUNE", k + "drum.tune", i, 0, 99);
			A("DRUMS", n + " DECAY", k + "drum.dec", i, 0, 99);
		});
	}
	return o;
}

function nestAddLane(t, p) {
	const slot = NEST.i,
		base = p.bend ? "bend" + t : p.path + "|" + p.key,
		id = aIdOf(base, slot);
	if (S.auto[id]) {
		NEST.sel = id;
		toast("ALREADY AUTOMATED HERE");
		return;
	}
	if (aFull()) {
		toast("AUTOMATION LIMIT " + NLANES);
		return;
	}
	const o = p.bend ? null : aObj(p.path),
		cur = p.bend ? (A.bnd[t] + 1) / 2 : o ? (o[p.key] - p.lo) / (p.hi - p.lo) : 0;
	undoPush("ADD AUTOMATION");
	S.auto[id] = {
		name: p.n + " T" + (t + 1),
		path: p.path,
		key: p.key,
		lo: p.lo,
		hi: p.hi,
		v: new Array(AU_N).fill(Math.round(clamp(cur, 0, 1) * 255)),
		bars: 1,
		mode: 1,
		sync: 0,
		slot,
	};
	const r = aRt(id);
	r.last = -1;
	r.on = 0;
	NEST.sel = id;
	toast("AUTOMATING " + p.n + " T" + (t + 1) + "  DRAG TO DRAW");
}

function aSetSlot(id, slot) {
	const a = S.auto[id];
	if (!a) {
		return;
	}
	slot = slot >= 0 ? slot : -1;
	if (aSlotOf(a) === slot) {
		return;
	}
	const nid = aIdOf(aBase(id), slot);
	if (S.auto[nid]) {
		toast("IT ALREADY HAS ONE THERE");
		return;
	}
	undoPush("AUTOMATION");
	const r = AUR[id];
	if (r && r.on) {
		r.on = 0;
		aRelease(id, a, r);
	}
	const n = {};
	for (const k in S.auto) {
		if (k === id) {
			a.slot = slot;
			n[nid] = a;
		} else {
			n[k] = S.auto[k];
		}
	}
	S.auto = n;
	if (NEST.sel === id) {
		NEST.sel = nid;
	}
	toast(slot < 0 ? "PLAYS THE WHOLE SONG" : "PLAYS IN SLOT " + (slot + 1) + " ONLY");
}

function aResize(a, bars) {
	const m = a.v.length,
		n = AU_N * bars,
		v = new Array(n);
	for (let i = 0; i < n; i++) {
		const ph = ((i / AU_N) % a.bars) / a.bars;
		v[i] = a.v[Math.min(m - 1, Math.floor(ph * m))];
	}
	a.v = v;
	a.bars = bars;
}
// longer: the shape repeats; shorter: its first part
// where a lane's playhead is (0..1) while it acts, else -1
function aPlayPhase(a, id) {
	if (!S.playing || !AC || !A.on || !a.mode) {
		return -1;
	}
	if (a.sync === 1) {
		return aPhase(a, aRt(id), performance.now());
	}
	const ls = aSlotOf(a);
	if (ls >= 0 && ls !== autoSlot()) {
		return -1;
	}
	const L = a.bars * SPB();
	return ((ls >= 0 ? aSlotSteps() : aSongSteps()) % L) / L;
}

function nestColour(i, t, d) {
	const e = S.song.chain[i];
	if (!e || e.pat < 0) {
		return;
	}
	undoPush("COLOUR");
	if (!e.col) {
		e.col = [0, 0, 0, 0];
	}
	e.col[t] = wrap(ncol(e, t) + d, NCOLN);
	toast("SLOT " + (i + 1) + "  T" + (t + 1) + "  " + NCOLNM[e.col[t]]);
}

function nestKnobs() {
	const i = NEST.i,
		e = S.song.chain[i] || {},
		t = S.trk,
		ls = nestLanes(t),
		k = NEST.sel && ls.includes(NEST.sel) ? ls.indexOf(NEST.sel) : ls.length,
		sel = k < ls.length ? ls[k] : null,
		a = sel && S.auto[sel],
		pr = nestParams(t),
		pi = clamp(NEST.pi | 0, 0, pr.length - 1),
		c = ncol(e, t);
	return [
		{
			l: "TRACK",
			st: 4,
			si: t,
			sn: t + 1,
			v: "T" + (t + 1) + " " + ENGL[engOf(t)],
			n: t / 3,
			set: (d) => {
				S.trk = wrap(S.trk + d, 4);
				NEST.sel = null;
			},
		},
		t === DT
			? {
					l: "PADS",
					st: 9,
					si: NEST.dr ? 1 + NEST.pd : 0,
					sn: NEST.dr ? 2 + NEST.pd : 1,
					v: NEST.dr ? PADS[NEST.pd] : "HIDDEN",
					n: NEST.dr ? (1 + NEST.pd) / 8 : 0,
					set: (d) => {
						const n = clamp((NEST.dr ? 1 + NEST.pd : 0) + (d > 0 ? 1 : -1), 0, 8);
						NEST.dr = n > 0 ? 1 : 0;
						if (n > 0) {
							NEST.pd = n - 1;
						}
					},
				}
			: {
					l: "COLOUR",
					st: NCOLN,
					si: c,
					sn: c + 1,
					v: NCOLNM[c],
					n: c / (NCOLN - 1),
					set: (d) => nestColour(i, t, d > 0 ? 1 : -1),
				},
		{
			l: "AUTOMATION",
			st: ls.length + 1,
			si: k,
			sn: k + 1,
			v: a ? a.name.replace(/ T\d$/, "") : "+ NEW",
			n: ls.length ? k / ls.length : 0,
			set: (d) => {
				const j = clamp(k + d, 0, ls.length);
				NEST.sel = j < ls.length ? ls[j] : null;
			},
		},
		a
			? {
					l: "MODE",
					st: 3,
					si: a.mode,
					sn: a.mode + 1,
					v: ["OFF", "LOOP", "TAP"][a.mode],
					n: a.mode / 2,
					set: (d) => {
						undoPush("AUTOMATION");
						a.mode = clamp(a.mode + d, 0, 2);
						const r = aRt(sel);
						r.run = 0;
						r.last = -1;
					},
				}
			: {
					l: "PARAMETER",
					st: pr.length,
					si: pi,
					sn: pi + 1,
					v: pr[pi].n,
					n: pr.length > 1 ? pi / (pr.length - 1) : 0,
					set: (d) => {
						NEST.pi = clamp(pi + d, 0, pr.length - 1);
					},
				},
	];
}

// the device way in: white keys 1-4 mute, 5-8 colour, 9 adds the lane the PARAMETER knob shows, 10 deletes the chosen lane, 11 moves it between this slot and the whole song (no lane chosen: closes the dropdown)
function nestKey(i) {
	const t = S.trk,
		ls = nestLanes(t),
		sel = NEST.sel && ls.includes(NEST.sel) ? NEST.sel : null;
	if (NEST.dr && t === DT && i < DGN) {
		songTogglePad(NEST.i, i);
		return;
	} // the drum track's pads are shown and T4 is the chosen track: keys 1-8 mute the pads
	if (i < 4) {
		songToggleMute(NEST.i, i);
	} else if (i < 8) {
		nestColour(NEST.i, i - 4, 1);
	} else if (i === 8) {
		if (!sel) {
			const pr = nestParams(t);
			nestAddLane(t, pr[clamp(NEST.pi | 0, 0, pr.length - 1)]);
		}
	} else if (i === 9) {
		if (sel) {
			laneDelete(sel);
		}
	} else if (i === 10) {
		if (sel) {
			aSetSlot(sel, aSlotOf(S.auto[sel]) < 0 ? NEST.i : -1);
		} else {
			nestCollapse();
		}
	} else if (i === 11) {
		songClip("copy");
	} else if (i === 12) {
		songClip("paste");
	} // 12-13: COPY and PASTE of what the mode chip says (slot, pattern, one track, a pad row, a lane)
	else if (i === 13) {
		if (NCLIP.mode === 0) {
			toast("SLOT MODE: DELETE IS ON THE CHIP");
		} else {
			songClip("del");
		}
	} // 14: CLEAR (the pad row or lane chosen, one track, the pattern)
	else if (i === 14) {
		songClip("mode");
	}
}
// 15: the mode chip
// ---- the dropdown: what this track can automate (the same popup style as the strip's menu) ----
const NMENU = { open: false };

function openNestMenu(t) {
	let m = document.getElementById("nestmenu");
	if (!m) {
		m = document.createElement("div");
		m.id = "nestmenu";
		m.className = "modmenu";
		m.hidden = true;
		document.body.appendChild(m);
	}
	m.innerHTML = "";
	let g = "";
	const cap = (x) => {
		const c = document.createElement("div");
		c.className = "mt cap";
		c.textContent = x;
		m.appendChild(c);
	};
	cap("AUTOMATE  T" + (t + 1) + "  ON SLOT " + (NEST.i + 1));
	nestParams(t).forEach((p) => {
		if (p.g !== g) {
			g = p.g;
			cap(g);
		}
		const b = document.createElement("button");
		b.className = "mt";
		b.style.minHeight = "34px";
		b.textContent = p.n;
		const has = S.auto[aIdOf(p.bend ? "bend" + t : p.path + "|" + p.key, NEST.i)];
		b.setAttribute("aria-pressed", String(!!has));
		b.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			closeNestMenu();
			nestAddLane(t, p);
		});
		m.appendChild(b);
	});
	const r = document.getElementById("big").getBoundingClientRect();
	m.style.top = Math.round(r.top + (r.height * 30) / 240) + "px";
	m.style.bottom = "auto";
	m.hidden = false;
	NMENU.open = true;
	setTimeout(() => document.addEventListener("pointerdown", outsideNest, true), 0);
}

function outsideNest(e) {
	const m = document.getElementById("nestmenu");
	if (m && m.contains(e.target)) {
		return;
	}
	closeNestMenu();
}

function closeNestMenu() {
	const m = document.getElementById("nestmenu");
	if (m) {
		m.hidden = true;
	}
	NMENU.open = false;
	document.removeEventListener("pointerdown", outsideNest, true);
}

// ---- the list: the song's 16 slot rows, and under the open slot its dropdown (header, four tracks with lanes and an add chip). Drag up and down on the LCD to scroll ----
function nestLay() {
	const L = [];
	let y = 0; // y is relative to the dropdown's top
	L.push({ k: "hdr", y, h: NV.hd });
	y += NV.hd;
	for (let t = 0; t < 4; t++) {
		L.push({ k: "trk", t, y, h: NV.hh });
		y += NV.hh;
		if (t === DT && NEST.dr) {
			for (let p = 0; p < DGN; p++) {
				L.push({ k: "pad", t, p, y, h: NV.ph });
				y += NV.ph;
			}
		}
		nestLanes(t).forEach((id) => {
			const ex = id === NEST.sel,
				h = NV.lh + (ex ? NV.eh : 0);
			L.push({ k: "lane", t, id, y, h, ex });
			y += h;
		});
		L.push({ k: "add", t, y, h: NV.ah });
		y += NV.ah;
	}
	const o = nestLanes(-1);
	if (o.length) {
		L.push({ k: "sec", y, h: 11 });
		y += 11;
		o.forEach((id) => {
			const ex = id === NEST.sel,
				h = NV.lh + (ex ? NV.eh : 0);
			L.push({ k: "lane", t: -1, id, y, h, ex });
			y += h;
		});
	}
	L.push({ k: "end", y, h: 3 });
	y += 3;
	return { L, H: y };
}

function songLay() {
	const L = [],
		open = nestOn();
	let y = 0;
	for (let i = 0; i < 16; i++) {
		L.push({ k: "slot", i, y, h: SG.rh });
		y += SG.rh;
		if (open && i === NEST.i) {
			const b = nestLay();
			b.L.forEach((it) => {
				it.y += y;
				L.push(it);
			});
			y += b.H;
		}
	}
	return { L, H: y };
}

// the layout, with the scroll kept in range; when the selection or the open slot changes, the selected row (and a dropdown that belongs to it) is brought into the window
function songView() {
	const { L, H } = songLay(),
		sg = S.song,
		view = SG.n * SG.rh,
		key = sg.sel + ":" + (nestOn() ? NEST.i : -1);
	if (key !== SGV.key) {
		SGV.key = key;
		const k = L.findIndex((it) => it.k === "slot" && it.i === sg.sel);
		if (k >= 0) {
			const nx = L.findIndex((it, j) => j > k && it.k === "slot"),
				top = L[k].y,
				bot = nx >= 0 ? L[nx].y : H;
			let end = L[k].y + L[k].h;
			if (nestOn() && NEST.i === sg.sel) {
				end = bot;
			}
			if (end > SGV.sc + view) {
				SGV.sc = end - view;
			}
			if (top < SGV.sc) {
				SGV.sc = top;
			}
		}
	}
	SGV.sc = clamp(SGV.sc, 0, Math.max(0, H - view));
	return { L, H, view };
}

const fitTxt = (s, w) => {
	s = String(s);
	while (s.length > 1 && TW(s) > w) {
		s = s.slice(0, -1);
	}
	return s;
};

function nestDraw(it, y, live) {
	const sg = S.song,
		e = sg.chain[NEST.i],
		mk = SGM(e),
		pi = e.pat,
		playing = live && S.playing && AC && S.pat === pi,
		x0 = NV.x;
	if (it.k === "end") {
		R(4, y + 1, 232, 1, P.faint);
		return;
	}
	R(7, y, 2, it.h, P.acc);
	if (it.k === "hdr") {
		T(
			playing
				? NEST.pv || !sg.on || !sg.go
					? "LOOPING PAT " + pad(pi + 1)
					: "PLAYING"
				: "PLAY LOOPS PAT " + pad(pi + 1),
			x0,
			y + 4,
			P.dim,
		);
		if (S.playing) {
			R(186, y + 1, 44, 12, P.sel);
			T("STOP", 208, y + 4, P.selfg, 1, "c");
		} else {
			B(186, y + 1, 44, 12, P.dim);
			T("PLAY", 208, y + 4, P.fg, 1, "c");
		}
	} else if (it.k === "trk") {
		const t = it.t,
			sel = t === S.trk,
			col = ncol(e, t),
			cc = col ? P.tag[col] : P.fg,
			mu = (mk >> t) & 1,
			q = S.pats[pi][t],
			n = nstP(pi, t);
		if (sel) {
			R(9, y + 3, 1, 16, P.acc);
		}
		if (mu) {
			B(x0, y + 4, 24, 14, P.hint);
			T("T" + (t + 1), x0 + 12, y + 8, P.hint, 1, "c");
			R(x0 + 3, y + 11, 18, 1, P.hint);
		} else {
			R(x0, y + 4, 24, 14, cc);
			T("T" + (t + 1), x0 + 12, y + 8, P.selfg, 1, "c");
		}
		T(fitTxt(PRESETS[S.tracks[t].pre][0], 58), 39, y + 3, mu ? P.dim : cc);
		T(ENGN[engOf(t)], 39, y + 12, P.faint);
		R(102, y + 4, 90, 14, P.grid);
		const cols = Math.min(n, 88),
			per = n / cols,
			cw = 88 / cols;
		let any = 0;
		for (let c = 0; c < cols; c++) {
			let v = 0;
			for (let j = Math.floor(c * per); j < Math.floor((c + 1) * per); j++) {
				if (t === DT) {
					for (let pd = 0; pd < 8; pd++) {
						v = Math.max(v, q.dg ? q.dg[pd * SMAX + j] : 0);
					}
				} else if (q.st[j] >= 0) {
					v = Math.max(v, q.vel[j]);
				}
			}
			if (v) {
				any = 1;
				const hh = Math.max(2, Math.round((v / 127) * 12));
				R(
					103 + Math.floor(c * cw),
					y + 17 - hh,
					Math.max(1, Math.floor(cw) - (cw >= 3 ? 1 : 0)),
					hh,
					mu ? P.hint : cc,
				);
			}
		}
		if (!any) {
			T("EMPTY", 147, y + 8, P.faint, 1, "c");
		}
		if (playing && any) {
			const f = (Math.max(0, playPosF()) % n) / n;
			R(103 + Math.floor(f * 88), y + 4, 1, 14, P.fg);
		}
		if (col) {
			R(196, y + 4, 28, 14, cc);
		} else {
			B(196, y + 4, 28, 14, P.hint);
			T("COL", 210, y + 8, P.faint, 1, "c");
		}
		if (t === DT) {
			const o = NEST.dr;
			if (o) {
				R(227, y + 4, 10, 14, P.sel);
			} else {
				B(227, y + 4, 10, 14, P.hint);
			}
			for (let k = 0; k < 4; k++) {
				if (o) {
					R(229 + k, y + 8 + k, 6 - 2 * k, 1, P.selfg);
				} else {
					R(230 + k, y + 8, 1, 6 - 2 * k, P.fg);
				}
			}
		} // the chevron that shows this track's pads
		R(x0, y + it.h - 1, 214, 1, P.faint);
	} else if (it.k === "pad") {
		const p = it.p,
			dm = (SGDM(e) >> p) & 1,
			tm = (mk >> DT) & 1,
			q = S.pats[pi][DT],
			n = nstP(pi, DT),
			g = q.dg,
			col = ncol(e, DT),
			cc = col ? P.tag[col] : P.fg;
		R(15, y, 1, it.h, P.faint);
		if (p === NEST.pd) {
			R(15, y + 3, 5, 7, P.acc);
		} else {
			R(15, y + 6, 5, 1, P.faint);
		} // the chosen pad (PAD copy, paste and clear work on its row) has a lit tick
		if (dm) {
			B(21, y + 1, 38, 11, P.hint);
			T(PADS[p], 40, y + 3, P.hint, 1, "c");
			R(24, y + 6, 32, 1, P.hint);
		} else {
			R(21, y + 1, 38, 11, tm ? P.hint : cc);
			T(PADS[p], 40, y + 3, P.selfg, 1, "c");
		}
		let hits = 0;
		for (let j = 0; j < n; j++) {
			if (g && g[p * SMAX + j]) {
				hits++;
			}
		}
		if (dm) {
			T("MUTED", 63, y + 3, P.dim);
		} else if (hits) {
			T(hits + (hits === 1 ? " HIT" : " HITS"), 63, y + 3, P.faint);
		}
		R(102, y + 2, 90, 10, P.grid);
		const cols = Math.min(n, 88),
			per = n / cols,
			cw = 88 / cols;
		for (let c = 0; c < cols; c++) {
			let v = 0;
			for (let j = Math.floor(c * per); j < Math.floor((c + 1) * per); j++) {
				if (g) {
					v = Math.max(v, g[p * SMAX + j]);
				}
			}
			if (v) {
				const hh = Math.max(2, Math.round((v / 127) * 8));
				R(
					103 + Math.floor(c * cw),
					y + 11 - hh,
					Math.max(1, Math.floor(cw) - (cw >= 3 ? 1 : 0)),
					hh,
					dm || tm ? P.hint : cc,
				);
			}
		}
		if (!hits) {
			T("EMPTY", 147, y + 3, P.faint, 1, "c");
		}
		if (playing && hits && !dm) {
			const f = (Math.max(0, playPosF()) % n) / n;
			R(103 + Math.floor(f * 88), y + 2, 1, 10, P.fg);
		}
		R(x0, y + it.h - 1, 214, 1, P.faint);
	} else if (it.k === "lane") {
		const a = S.auto[it.id];
		if (!a) {
			return;
		}
		const ls = aSlotOf(a),
			N = a.v.length;
		T(fitTxt(a.name.replace(/ T\d$/, ""), 72), x0, y + 3, a.mode ? P.fg : P.dim);
		if (it.ex) {
			B(84, y + 1, 52, 11, P.acc);
		}
		for (let c = 0; c < 24; c++) {
			const v = a.v[Math.min(N - 1, Math.floor((c / 24) * N))],
				hh = Math.max(1, Math.round((v / 255) * 8));
			R(86 + c * 2, y + 11 - hh, 1, hh, a.mode ? P.ops[1] : P.hint);
		}
		B(138, y + 1, 24, 11, P.hint);
		T(ls < 0 ? "ALL" : "S" + (ls + 1), 150, y + 3, ls < 0 ? P.dim : P.acc, 1, "c");
		if (a.mode) {
			R(164, y + 1, 28, 11, P.sel);
		} else {
			B(164, y + 1, 28, 11, P.dim);
		}
		T(["OFF", "LOOP", "TAP"][a.mode], 178, y + 3, a.mode ? P.selfg : P.dim, 1, "c");
		B(194, y + 1, 20, 11, P.hint);
		T(a.bars + "B", 204, y + 3, P.fg, 1, "c");
		B(216, y + 1, 14, 11, P.hint);
		T("X", 223, y + 3, P.dim, 1, "c");
		if (it.ex) {
			const by = y + 14,
				bh = 32;
			R(x0, by, 216, bh, P.grid);
			for (let b = 1; b < a.bars; b++) {
				R(x0 + Math.round((b * 216) / a.bars), by, 1, bh, P.faint);
			}
			for (let c = 0; c < 108; c++) {
				const v = a.v[Math.min(N - 1, Math.floor((c / 108) * N))],
					hh = Math.max(1, Math.round((v / 255) * (bh - 2)));
				R(x0 + c * 2, by + bh - 1 - hh, 2, hh, a.mode ? P.ops[1] : P.hint);
			}
			const ph = live ? aPlayPhase(a, it.id) : -1;
			if (ph >= 0) {
				R(x0 + Math.floor(ph * 215), by, 1, bh, P.fg);
			}
			B(x0, by, 216, bh, P.faint);
		}
	} else if (it.k === "add") {
		B(x0, y + 1, 118, 11, P.hint);
		T("+ ADD AUTOMATION", x0 + 59, y + 3, P.fg, 1, "c");
	} else {
		T("ACROSS THE SONG", x0, y + 2, P.faint);
	}
}

// what is under a touch in the dropdown (it: its layout item, dy: how far down the item the touch is, y0: the item's top on the LCD)
function nestZone(it, x, dy, y0) {
	const tr = it.t,
		Z = (o) => Object.assign({ t: "nest", tap: true }, o),
		bg = { t: "nest", k: "bg" };
	if (it.k === "hdr") {
		return x >= 184 && x < 236 ? Z({ k: "play" }) : bg;
	}
	if (it.k === "pad") {
		return x >= 19 && x < 61 && dy >= 0 && dy < it.h - 1
			? Z({ k: "pmute", tr: it.t, pd: it.p })
			: x >= 61 && x < 236
				? Z({ k: "psel", tr: it.t, pd: it.p })
				: bg;
	} // the chip mutes the pad (and chooses it); the rest of the row only chooses it
	if (it.k === "trk") {
		if (it.t === DT && x >= 226 && dy >= 2 && dy < 20) {
			return Z({ k: "dchev", tr });
		}
		if (x < 37 && dy >= 2 && dy < 20) {
			return Z({ k: "mute", tr });
		}
		if (x >= 194 && x < 226 && dy >= 2 && dy < 20) {
			return Z({ k: "col", tr });
		}
		if (x >= 37 && x < 100) {
			return Z({ k: "name", tr });
		}
		return Z({ k: "sel", tr });
	}
	if (it.k === "add") {
		return x < 132 ? Z({ k: "add", tr }) : bg;
	}
	if (it.k === "lane") {
		if (it.ex && dy >= 14) {
			return { t: "nest", k: "draw", lid: it.id, by: y0 + 14, bh: 32 };
		}
		const k = x < 137 ? "lsel" : x < 163 ? "lscope" : x < 193 ? "lmode" : x < 215 ? "llen" : "ldel";
		return Z({ k, lid: it.id, tr });
	}
	return bg;
}

function nestTap(z) {
	const k = z.k;
	if (z.tr != null && z.tr >= 0 && S.trk !== z.tr) {
		S.trk = z.tr;
	}
	if (k === "play") {
		press("play");
	} else if (k === "mute") {
		songToggleMute(NEST.i, z.tr);
	} else if (k === "pmute") {
		NEST.pd = z.pd;
		songTogglePad(NEST.i, z.pd);
	} else if (k === "psel") {
		NEST.pd = z.pd;
		toast("PAD: " + PADS[z.pd]);
	} else if (k === "dchev") {
		nestPads();
	} else if (k === "name") {
		nestToSeq(z.tr);
	} else if (k === "col") {
		nestColour(NEST.i, z.tr, 1);
	} else if (k === "add") {
		openNestMenu(z.tr);
	} else {
		const a = S.auto[z.lid];
		if (k === "lsel") {
			if (a) {
				NEST.sel = NEST.sel === z.lid ? null : z.lid;
			}
		} else if (!a) {
			return;
		} else if (k === "lmode") {
			undoPush("AUTOMATION");
			a.mode = (a.mode + 1) % 3;
			const r = aRt(z.lid);
			r.run = 0;
			r.t0 = performance.now();
			r.last = -1;
		} else if (k === "lscope") {
			aSetSlot(z.lid, aSlotOf(a) < 0 ? NEST.i : -1);
		} else if (k === "llen") {
			undoPush("AUTOMATION");
			aResize(a, AU_BARS[(AU_BARS.indexOf(a.bars) + 1) % AU_BARS.length]);
			aRt(z.lid).last = -1;
		} else if (k === "ldel") {
			undoPush("DELETE AUTOMATION");
			const r = AUR[z.lid];
			if (r && r.on) {
				r.on = 0;
				aRelease(z.lid, a, r);
			}
			delete S.auto[z.lid];
			if (NEST.sel === z.lid) {
				NEST.sel = null;
			}
		}
	}
}

// the chevron on the drum track's row: show or hide its 8 pads (the list scrolls so the pads are in view)
function nestPads() {
	NEST.dr ^= 1;
	if (NEST.dr) {
		const { L, view } = songView(),
			it = L.find((q) => q.k === "trk" && q.t === DT);
		if (it && it.y + it.h + DGN * NV.ph > SGV.sc + view) {
			SGV.sc = Math.max(0, it.y - 4);
		}
	}
}

function nestDown(z, x, y) {
	z.y0 = y;
	z.sc0 = SGV.sc;
	if (z.k === "draw") {
		undoPush("DRAW AUTOMATION");
		nestPaint(z, x, y);
	}
}

function nestMove(z, x, y) {
	if (z.k === "draw") {
		nestPaint(z, x, y);
		return;
	}
	if (!z.moved && Math.abs(y - z.y0) < 4) {
		return;
	}
	z.moved = true;
	SGV.sc = Math.max(0, z.sc0 - (y - z.y0));
}

// a vertical drag that starts on a slot row scrolls the list too (a sideways one still steps the cell under the finger)
function songDrag(z, x, y) {
	if (z.k === "prev") {
		const g = z.g || PV;
		if (!z.sc) {
			const dx = Math.abs(x - z.x),
				dy = Math.abs(y - z.y0);
			if (dy >= 5 && dy > dx) {
				z.moved = true;
				return false;
			}
			if (z.moved || dx < 5 || dx <= dy) {
				return false;
			}
			if (S.playing && AC) {
				z.moved = true;
				return false;
			}
			z.sc = 1;
			z.moved = true;
			z.sc0 = g.sc;
			z.x1 = x;
		}
		g.sc = pvClamp(z.sc0 - (x - z.x1), g);
		return true;
	}
	if (!z.sc) {
		if (z.moved || Math.abs(y - z.y0) < 5 || Math.abs(y - z.y0) <= Math.abs(x - z.x)) {
			return false;
		}
		z.sc = 1;
		z.moved = true;
		z.sc0 = SGV.sc;
		z.y0 = y;
	}
	SGV.sc = Math.max(0, z.sc0 - (y - z.y0));
	return true;
}

function nestPaint(z, x, y) {
	const a = S.auto[z.lid];
	if (!a) {
		return;
	}
	const N = a.v.length,
		i = clamp(Math.round(((x - NV.x) / 216) * (N - 1)), 0, N - 1),
		v = clamp(Math.round((1 - (y - z.by - 1) / (z.bh - 2)) * 255), 0, 255);
	z.moved = true;
	const p = z.pi == null ? i : z.pi,
		pv = z.pv == null ? v : z.pv,
		s = i >= p ? 1 : -1,
		n = Math.abs(i - p);
	for (let k = 0; k <= n; k++) {
		a.v[p + s * k] = Math.round(pv + (v - pv) * (n ? k / n : 1));
	}
	z.pi = i;
	z.pv = v;
	aRt(z.lid).last = -1;
}

function stopSeq() {
	if (!AC) {
		return;
	}
	recCloseAll();
	A.seqV.forEach(
		(v) => v && v.cut && v.cut(),
	); /* STOP: notes that have not started never sound, notes that sound are let go now (they used to ring out their whole gate, and the ones in the look-ahead still started) */
	A.seqV = [];
	A.sq = [];
	A.sl = [];
	A.sqMask = 0;
	A.sqDm = 0;
	A.recLive.length = 0; // what the queue just wrote belongs to the pass that stopped
	S.padHits = [];
	S.song.jump = -1;
	S.song.go = 0;
}
