// LCD screens, part 3: played key, key modes, key page, global, save, mixer, analog, wavetable, sampler, drums, gen
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// the key you pressed last, shown on Home and on the KEY page (it replaces the detected key)
let lastPlayed = null;

const playedName = () =>
	lastPlayed ? NN[lastPlayed.m % 12] + (Math.floor(lastPlayed.m / 12) - 1) : "---";

const playedFresh = (now) => !!lastPlayed && now - lastPlayed.t < 700;

// KEY play modes: off, SNAP (a key plays the nearest note of the scale: the CHORD knob's SNAP) or ONLY (a key outside the scale does not play)
const KMODE = { 1: { x: 124, y: 177, w: 52, h: 20 }, 2: { x: 182, y: 177, w: 52, h: 20 } };

const keyMode = () => (S.scale.only ? 2 : S.scale.chord === 1 ? 1 : 0);

function setKeyMode(m) {
	S.scale.only = m === 2 ? 1 : 0;
	if (m === 1) {
		S.scale.chord = 1;
	} else if (S.scale.chord === 1) {
		S.scale.chord = 0;
	}
	toast(["KEYS: PLAY ANYTHING", "KEYS: SNAP TO THE SCALE", "KEYS: SCALE NOTES ONLY"][m]);
}

// ONLY mode: a key outside the selected scale does not play (drum and sampler pads are never blocked)
function keyBlocked(kind, i) {
	const en = engOf(S.trk);
	if (!S.scale.only || en === "DRUM" || (en === "SMP" && S.screen === "smp")) {
		return false;
	}
	const pc = ((((kind === "w" ? WH[i] : BL[i]) + S.glob.gtr - S.scale.root) % 12) + 12) % 12;
	return !SCALES[S.scale.type][1].includes(pc);
}

SCR.scale = (now) => {
	const sc = SCALES[S.scale.type],
		root = S.scale.root;
	T(NN[root], 6, 18, P.fg, 3);
	T(sc[0], 6 + Math.ceil(TW(NN[root], 3)) + 7, 25, P.fg, 2);
	T("PLAYED", 234, 18, P.faint, 1, "r");
	T(playedName(), 234, 26, playedFresh(now) ? P.acc : P.fg, 2, "r");
	const deg = ["1", "B2", "2", "B3", "3", "4", "#4", "5", "B6", "6", "B7", "7"];
	T(sc[1].map((i) => deg[i]).join(" "), 6, 48, P.dim);
	R(0, 60, 240, 1, P.faint);
	const ky = 66,
		kh = 98,
		kw = 14,
		x0 = 8;
	const inS = (m) => sc[1].includes((((m - root) % 12) + 12) % 12);
	WH.forEach((m, i) => {
		const x = x0 + i * kw;
		const isR = (((m - root) % 12) + 12) % 12 === 0;
		if (isR) {
			R(x, ky, kw - 2, kh, P.ops[0]);
		} else if (inS(m)) {
			R(x, ky, kw - 2, kh, P.fg);
		} else {
			B(x, ky, kw - 2, kh, P.faint);
		}
		T(NN[m % 12], x + 6, ky + kh - 11, isR || inS(m) ? P.bg : P.dim, 1, "c");
	});
	BL.forEach((m) => {
		const wi = WH.indexOf(m - 1);
		const x = x0 + wi * kw + kw - 6;
		const isR = (((m - root) % 12) + 12) % 12 === 0;
		R(x - 1, ky, 10, 62, P.bg);
		if (isR) {
			R(x, ky, 8, 60, P.ops[0]);
		} else if (inS(m)) {
			R(x, ky, 8, 60, P.dim);
		} else {
			B(x, ky, 8, 60, P.faint);
		}
	});
	T("F3", x0, ky + kh + 4, P.faint);
	T("G5", x0 + 16 * kw - 2, ky + kh + 4, P.faint, 1, "r");
	const km = keyMode();
	T(["ANY KEY PLAYS", "SNAPS TO SCALE", "SCALE ONLY"][km], 8, 179, km ? P.fg : P.dim);
	T(["KEY AGAIN: GO BACK", "NEAREST SCALE NOTE", "OTHER KEYS ARE OFF"][km], 8, 191, P.faint);
	[
		[1, "SNAP"],
		[2, "ONLY"],
	].forEach(([m, label]) => {
		const b = KMODE[m];
		if (km === m) {
			R(b.x, b.y, b.w, b.h, P.sel);
		} else {
			B(b.x, b.y, b.w, b.h, P.faint);
		}
		T(label, b.x + b.w / 2, b.y + 7, km === m ? P.selfg : P.dim, 1, "c");
	}); /* two boxes: tap one to switch it on (the other goes off), tap it again for off. All above the knob strip (205) */
};

SCR.global = (now) => {
	title("DEVICE SETTINGS", S.glob.sel + 1 + "/" + GROWS.length);
	R(0, 28, 240, 1, P.faint);
	const top = clamp(S.glob.sel - 3, 0, GROWS.length - 8);
	const hl = hotLevel(1, now);
	for (let r = 0; r < 8; r++) {
		const i = top + r;
		if (i >= GROWS.length) {
			break;
		}
		const y = 32 + r * 21,
			sel = i === S.glob.sel;
		if (sel) {
			R(4, y, 218, 20, P.sel);
		} else if (r) {
			R(4, y - 1, 218, 1, P.faint);
		}
		T(GROWS[i][0], 10, y + 6, sel ? P.selfg : P.fg);
		T(GROWS[i][1](S.glob), 216, y + 6, sel ? P.selfg : P.dim, 1, "r");
		if (sel && hl) {
			R(4, y, 218, 2, P.acc);
			R(4, y + 18, 218, 2, P.acc);
		}
	}
	const n = GROWS.length,
		sh = Math.round((168 * 8) / n),
		sy = 32 + Math.round(((168 - sh) * top) / Math.max(1, n - 8));
	R(234, 32, 2, 152, P.faint);
	R(234, ((sy * 152) / 168) | 0, 2, Math.max(4, ((sh * 152) / 168) | 0), P.fg);
};

SCR.save = (now, live) => {
	title("SAVE PRESET");
	R(0, 28, 240, 1, P.faint);
	{
		const U = PRESETS.filter((p) => p[1] === "USER"),
			nm = S.save.name.trim().slice(0, 10) || "UNTITLED",
			same = U.findIndex((p) => p[0] === nm),
			sl =
				same >= 0
					? same + 1
					: clamp(
							S.save.slot,
							1,
							saveSlots(),
						); /* a slot past the next free one would only be filled in order, so the next free one is the last choice */
		T("TO", 6, 40, P.dim);
		T("USER " + pad(sl, 3), 24, 40, P.fg);
		T(
			sl <= U.length ? "REPLACES " + U[sl - 1][0] : "EMPTY",
			234,
			40,
			sl <= U.length ? P.acc : P.ops[3],
			1,
			"r",
		);
	}
	const v = S.save,
		cw = 22,
		x0 = 10,
		y = 72;
	const blink = !live || Math.floor(now / 400) % 2 === 0;
	for (let i = 0; i < 10; i++) {
		const x = x0 + i * cw,
			mx = x + ((cw - 2) >> 1);
		const cur = i === v.cur;
		if (cur && blink) {
			R(x, y, cw - 2, 24, P.sel);
			T(v.name[i], mx, y + 5, P.selfg, 2, "c");
		} else {
			R(x, y + 25, cw - 2, 1, cur ? P.fg : P.faint);
			T(v.name[i], mx, y + 5, P.fg, 2, "c");
		}
	}
	const cx = x0 + v.cur * cw + ((cw - 2) >> 1);
	T("\u0002", cx, y - 10, P.dim, 1, "c");
	T("\u0003", cx, y + 28, P.dim, 1, "c");
	const ci = CHARS.indexOf(v.name[v.cur]);
	for (let d = -4; d <= 4; d++) {
		const c = CHARS[wrap(ci + d, CHARS.length)],
			px = 120 + d * 24;
		if (d === 0) {
			R(px - 10, 115, 20, 14, P.sel);
			T(c === " " ? "_" : c, px, 118, P.selfg, 1, "c");
		} else {
			T(c === " " ? "_" : c, px, 118, P.dim, 1, "c");
		}
	}
	R(6, 150, 108, 22, P.sel);
	T("OCT+ SAVE", 60, 158, P.selfg, 1, "c");
	B(126, 150, 108, 22, P.dim);
	T("OCT- CANCEL", 180, 158, P.fg, 1, "c");
};

SCR.scape = (now, live) => {
	title("SOUNDSCAPE", "4 LAYERS");
	R(0, 28, 240, 1, P.faint);
	S.scape.forEach((l, i) => {
		const y = 33 + i * 34,
			on = l.lv > 0;
		if (on) {
			R(6, y + 2, 9, 9, P.acc);
		} else {
			B(6, y + 2, 9, 9, P.faint);
		}
		T(l.n, 22, y + 4, on ? P.fg : P.dim);
		T(l.lv + "%", 234, y + 4, on ? P.fg : P.dim, 1, "r");
		scapeViz(l.n, 6, y + 15, 228, 13, l.lv / 100, now, on);
	});
	const sl = slp(),
		rem = sleepLeft(live);
	T("SLEEP FADE", 6, 172, P.dim);
	T(sl ? "OUT IN " + Math.ceil(rem) + " MIN" : "OFF", 234, 172, sl ? P.acc : P.dim, 1, "r");
	R(6, 184, 228, 5, P.faint);
	if (sl) {
		R(6, 184, Math.round((228 * rem) / sl), 5, P.acc);
	}
	T("HOME: BACK", 6, 194, P.faint);
};

SCR.mix = (now, live) => {
	title("MIXER", "T" + (S.trk + 1) + " SELECTED");
	R(0, 28, 240, 1, P.faint);
	const a = amp(now, live);
	const cols = [0, 1, 2, 3].map((i) => ({
		n: "T" + (i + 1),
		vol: S.tracks[i].vol,
		tag: ENGSH[engOf(i)],
		c: P.ops[ENGCOL[engOf(i)]],
		sel: i === S.trk,
		m: live ? (A.on ? Math.min(1, A.trRms[i] * 5) : 0) : 0.7,
	}));
	cols.push({
		n: "SCAPE",
		vol: Math.max(0, ...S.scape.map((l) => l.lv)),
		tag: "BED",
		c: P.ops[3],
		m: live ? (A.on ? Math.min(1, A.bedRms * 8) : 0) : 0.5,
	});
	cols.push({
		n: "MSTR",
		vol: S.vol,
		tag: "OUT",
		c: P.fg,
		m: live ? (A.on ? Math.min(1, A.rms * 5) : 0) : 0.7,
	});
	cols.forEach((c, i) => {
		const x = 6 + i * 38;
		if (c.sel) {
			R(x - 2, 32, 38, 142, P.faint);
		}
		T(c.n, x + 17, 36, c.sel ? P.fg : P.dim, 1, "c");
		R(x + 10, 50, 10, 100, P.grid);
		R(x + 10, 150 - c.vol, 10, c.vol, c.c);
		R(x + 7, 149 - c.vol, 16, 2, P.fg);
		const mh = Math.round(clamp(c.m, 0, 1) * 100);
		R(x + 24, 150 - mh, 4, mh, P.ops[3]);
		T(c.tag, x + 17, 156, c.c, 1, "c");
	});
	T("PAGE: TRACK   PRESET: SOUND", 120, 184, P.faint, 1, "c");
};

SCR.ana = (now, live) => {
	const a = S.ana;
	title("T" + (S.trk + 1) + " ANALOG", "2 OSC + SUB");
	R(0, 28, 240, 1, P.faint);
	[
		[a.w1, 6, "OSC 1", "PAGE"],
		[a.w2, 124, "OSC 2", "ALGO"],
	].forEach(([w, x, l, kn]) => {
		B(x, 32, 110, 34, P.faint);
		T(l, x + 5, 36, P.dim);
		T(kn, x + 5 + TW(l) + 5, 36, P.faint);
		T(SHP[w], x + 5, 50, P.fg);
		wavePic(x + 68, 38, 36, 22, w, P.ops[0]);
	}); /* the knob that picks each wave is named beside it */
	R(6, 72, 228, 70, P.grid);
	filtCurve(6, 72, 228, 70, 0, a.cut, a.res, P.ops[1]);
	T("LOW PASS 24DB", 10, 76, P.dim);
	const x0 = 6,
		y0 = 148,
		w = 228,
		h = 34,
		base = y0 + h - 1,
		top = y0 + 2;
	R(x0, y0, w, h, P.grid);
	const aw = 10 + Math.round((a.atk / 99) * 60),
		dw = 30,
		sw = 44,
		rw = 10 + Math.round((a.rel / 99) * 70),
		tot = aw + dw + sw + rw,
		k = Math.min(1, (w - 6) / tot);
	const px = [0, aw, aw + dw, aw + dw + sw, tot].map((v) => x0 + 3 + Math.round(v * k)),
		sy = top + Math.round((base - top) * 0.4),
		ys = [base, top, sy, sy, base];
	for (let i = 0; i < 4; i++) {
		L(px[i], ys[i], px[i + 1], ys[i + 1], P.ops[2]);
		L(px[i], ys[i] - 1, px[i + 1], ys[i + 1] - 1, P.ops[2]);
	}
	T("ENV: ATK " + a.atk + "  REL " + a.rel, 6, 188, P.dim);
	T("DETUNE " + a.det, 216, 188, P.dim, 1, "r");
};

SCR.wt = (now, live) => {
	const w = S.wt;
	title("T" + (S.trk + 1) + " WAVETABLE", WTN[w.tab | 0] + " TABLE");
	R(0, 28, 240, 1, P.faint);
	const N = 14,
		W = 190,
		sel = Math.round((w.pos / 127) * (N - 1));
	recMacro("wt|" + w.warp + "|" + w.drv + "|" + sel + "|" + (w.tab | 0) + "|" + w.tone, () => {
		for (let f = 0; f < N; f++) {
			const k = f / (N - 1),
				by = 38 + f * 9,
				ox = 14 + f * 2,
				am = w.tab ? wtAmps(w.tab, (f / (N - 1)) * 127, w.tone) : null;
			let ap = 1e-9;
			if (am) {
				for (let h = 1; h <= 16; h++) {
					ap += am[h];
				}
			}
			for (let xi = 0; xi < W; xi++) {
				const t = (xi / W) * Math.PI * 4,
					tt = t + (w.warp / 99) * 1.4 * Math.sin(t * 2);
				let v =
					Math.sin(tt) + k * 0.5 * Math.sin(3 * tt + f * 0.3) + k * k * 0.3 * Math.sin(5 * tt);
				if (am) {
					v = 0;
					for (let h = 1; h <= 16; h++) {
						v += ((am[h] * Math.sin(h * tt) * 1.4) / ap) * 4;
					}
				}
				v = Math.tanh(v * (1 + w.drv / 60)) * 7;
				const y = Math.round(by - v);
				R(ox + xi, y, 1, 14, P.bg);
				R(ox + xi, y, 1, 1, f === sel ? P.acc : P.dim);
			}
		}
	});
	T(">", 4, 38 + sel * 9 - 3, P.acc);
	T("FRAME " + pad(sel + 1) + "/14", 6, 178, P.fg);
	T("TONE " + w.tone, 234, 178, P.dim, 1, "r");
};

SCR.smp = (now, live) => {
	const m = S.smp;
	title("T" + (S.trk + 1) + " SAMPLER", S.resampling ? "RESAMPLING..." : "1 BAR  8 SLICES");
	R(0, 28, 240, 1, P.faint);
	const x0 = 6,
		y0 = 36,
		w = 228,
		h = 88,
		mid = y0 + h / 2,
		sw = w / 8;
	R(x0, y0, w, h, P.grid);
	R(x0 + Math.round(m.slice * sw) + 1, y0, Math.round(sw) - 1, h, P.faint);
	for (let i = 0; i < w; i += 2) {
		const si = Math.floor(i / sw),
			amp2 = smpPeak(i / w);
		const bh = Math.round(amp2 * (h / 2 - 14));
		R(x0 + i, mid - bh, 1, bh * 2 + 1, si === m.slice ? P.ops[0] : P.dim);
	}
	for (let k = 0; k < 8; k++) {
		DV(x0 + Math.round(k * sw), y0, h, P.faint, 1, 2);
		T(k + 1, x0 + Math.round(k * sw) + 3, y0 + 3, k === m.slice ? P.acc : P.dim);
	}
	const ph = live ? ((now / 2400) % 1) * w : w * 0.46;
	R(x0 + Math.round(ph), y0 + 12, 1, h - 12, P.fg);
	T("SOURCE", 6, 134, P.dim);
	T("RESAMPLE", 60, 134, P.fg);
	T("LENGTH", 126, 134, P.dim);
	T((S.smpData ? S.smpData.length / S.smpRate : 2).toFixed(1) + " S", 184, 134, P.fg);
	T("22K 8-BIT  1 BAR, 2 S MAX", 6, 162, P.faint);
	T("PITCH", 6, 148, P.dim);
	T((m.pitch > 0 ? "+" : "") + m.pitch, 60, 148, P.fg);
	T("DIRECTION", 126, 148, P.dim);
	T(["FWD", "REV", "PING"][m.dir], 184, 148, P.fg);
	T("KEYS 1-8 PLAY SLICES  \u00b7  REC SAMPLES 1 BAR", 6, 186, P.faint);
};

SCR.drum = (now, live) => {
	const D = S.drum;
	title("T" + (S.trk + 1) + " DRUMS", PRESETS[S.preset][0]);
	R(0, 28, 240, 1, P.faint);
	for (let i = 0; i < 8; i++) {
		const x = 6 + (i % 4) * 57,
			y = 34 + ((i / 4) | 0) * 58,
			wd = 54,
			h = 54,
			sel = i === D.sel;
		const hit = live ? Math.max(0, 1 - (now - (S.padHits[i] || -1e9)) / 220) : i === 1 ? 0.8 : 0;
		const fl = hit > 0.3;
		if (fl) {
			R(x, y, wd, h, P.acc);
		} else if (sel) {
			R(x, y, wd, h, P.sel);
		} else {
			B(x, y, wd, h, P.faint);
		}
		const fg = fl || sel ? P.selfg : P.fg,
			dm = fl || sel ? P.selfg : P.dim;
		T(String(i + 1), x + 4, y + 4, dm);
		T(PADS[i], x + wd / 2, y + h - 12, fg, 1, "c");
		R(x + 6, y + 24, Math.round((42 * D.dec[i]) / 99), 3, dm);
		R(x + 6, y + 30, Math.round((42 * D.tune[i]) / 99), 2, dm);
	}
	{
		const i = D.sel;
		[
			["TUNE", D.tune[i], 6],
			["DECAY", D.dec[i], 82],
			["CRUSH", D.crush[i], 160],
		].forEach(([l, n, x]) => {
			T(l, x, 156, P.dim);
			T(n, x + TW(l) + 5, 156, P.fg);
		});
	}
	T("KEYS 1-8 PLAY PADS", 6, 186, P.faint);
};

SCR.gen = (now, live) => {
	const g = S.gen,
		sc = SCALES[S.scale.type];
	title("DRIFT", NN[S.scale.root] + " " + sc[0]);
	R(0, 28, 240, 1, P.faint);
	T(g.on ? "ON T" + (S.trk + 1) + "  PAGE: STOP" : "OFF  PAGE: START", 6, 34, g.on ? P.acc : P.dim);
	const x0 = 6,
		y0 = 46,
		w = 228,
		h = 112;
	R(x0, y0, w, h, P.grid);
	const rows = Math.max(7, sc[1].length * g.rng);
	for (let q = 0; q < rows; q += sc[1].length) {
		DH(x0, y0 + h - 4 - Math.round((q * (h - 8)) / (rows - 1)), w, P.faint, 1, 3);
	}
	const sp = 12,
		sh = live
			? (AC && A.on
					? Math.max(0, AC.currentTime - A.gA) / (30 / S.bpm)
					: (now - g.t0) / (30000 / S.bpm)) * sp
			: 0,
		ph = x0 + Math.round(w * 0.62);
	for (let n = -1; n <= w / sp + 1; n++) {
		const st = Math.floor(sh / sp) + n,
			e = genAt(st);
		if (!e) {
			continue;
		}
		const x = x0 + n * sp - (sh % sp),
			y = y0 + h - 4 - Math.round((e.rr * (h - 8)) / (rows - 1));
		if (x < x0 || x + e.wd > x0 + w) {
			continue;
		}
		R(x + e.hm, y - 2, e.wd, 4, x + e.wd < ph ? P.dim : x <= ph ? P.acc : P.ops[0]);
	}
	R(ph, y0, 1, h, P.acc);
	T("DENSITY " + g.den + "%  RANGE " + g.rng + " OCT", 6, 166, P.dim);
	T("EVOLVE " + g.evo + "%  HUMANIZE " + g.hum + "%", 6, 180, P.dim);
};
