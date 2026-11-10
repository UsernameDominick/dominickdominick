// shared LCD pieces: value glow, chrome, algorithm diagram, envelope, pictures
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---------- what is being touched or changed right now (the glow on a value) ----------
// HELD: the value a finger is on (it stays lit while the finger is down). S.hot: the last value that changed ({c, cs: more values a graph moved, d: direction}).
var HELD = -1;

function hotLevel(c, now) {
	if (HELD === c) {
		return 1;
	}
	const h = S.hot;
	if (!h || !(h.c === c || (h.cs && h.cs.indexOf(c) >= 0))) {
		return 0;
	}
	const a = now - h.t;
	return a < 900 ? (a < 260 ? 1 : 0.5) : 0;
}

const hotDir = (c) => (S.hot && S.hot.c === c ? S.hot.d || 0 : 0);

// ---------- shared chrome ----------
function battery(x, y, lv) {
	B(x, y, 13, 7, P.dim);
	R(x + 13, y + 2, 1, 3, P.dim);
	for (let i = 0; i < 3; i++) {
		if (i < lv) {
			R(x + 2 + i * 3 + i, y + 2, 3, 3, lv <= 1 ? P.rec : P.fg);
		}
	}
}

let IND = "";
// the text of the recording indicator in the top strip (tests read it)
function statusBar(now) {
	R(0, 0, 240, 12, P.bar);
	if (S.playing) {
		for (let i = 0; i < 4; i++) {
			R(4 + i, 2 + i, 1, 8 - 2 * i, P.ops[3]);
		}
	} else {
		R(4, 3, 6, 6, P.dim);
	}
	if (S.rec) {
		R(13, 3, 4, 6, P.rec);
		R(12, 4, 6, 4, P.rec);
	}
	if (S.rec && S.glob.arec) {
		T("AUTO", 44, 3, P.rec);
	}
	T(S.bpm, 22, 3, P.fg);
	let x = 220;
	battery(x, 3, 2);
	x -= 15;
	gearIcon(x, 1, gearOn || SET.open ? P.acc : P.dim);
	if (QS.kb && QS.on) {
		x -= TW("KB>Q") + 5;
		T("KB>Q", x, 3, P.acc);
	} /* keyboard to queue is on */
	if (S.oct) {
		const s = (S.oct > 0 ? "+" : "") + S.oct;
		x -= TW(s) + 5;
		T(s, x, 3, P.acc);
	}
	/* recording indicators live up here by the settings cog, never over the screen's contents */
	let hideTitle = 0;
	{
		let ind = null,
			col = P.rec;
		if (AC && BNC.on && BNC.info) {
			const i = BNC.info;
			ind = "BOUNCE " + Math.max(0, i.tAll - AC.currentTime).toFixed(1) + "S";
			col = P.acc;
		} else if (AC && S.countdown) {
			const c = S.countdown;
			ind = "COUNT " + clamp(c.n - Math.floor((AC.currentTime - c.t0) / c.beat), 1, c.n);
			col = P.acc;
		}
		IND = ind || "";
		if (ind) {
			const w = TW(ind),
				xx = x - w - 12;
			if (xx >= 56) {
				if (((now | 0) >> 8) & 1 || col !== P.rec) {
					R(xx - 8, 4, 5, 5, col);
				}
				T(ind, xx, 3, col);
				if (xx < 160) {
					hideTitle = 1;
				}
			}
		}
	}
	if (!hideTitle) {
		const p = PRESETS[S.preset],
			s = "T" + (S.trk + 1) + " " + p[0],
			w = TW(s),
			lo = (S.rec && S.glob.arec ? 44 + TW("AUTO") : 22 + TW(S.bpm)) + 5 + w / 2,
			hi = x - 5 - w / 2;
		T(s, Math.round(hi < lo ? lo : clamp(120, lo, hi)), 3, P.dim, 1, "c");
	} /* centred, but it moves aside rather than run into the tempo or the tags by the Bluetooth icon */
	R(0, 12, 240, 1, P.faint);
}

function knobStrip(ks, now) {
	if (!ks) {
		return;
	}
	R(0, 205, 240, 35, P.bg);
	R(0, 205, 240, 1, P.faint);
	ks.forEach((k, c) => {
		const x = c * 60;
		if (c) {
			R(x, 206, 1, 34, P.faint);
		}
		const hot = hotLevel(c, now) > 0;
		if (!k.l) {
			DH(x + 22, 222, 16, P.faint);
			return;
		}
		const ls = String(k.l),
			vs = String(k.v),
			fit = (s) => {
				const w = TW(s);
				return w <= 57 ? 1 : w * 0.85 <= 57 ? 0.85 : 0.7;
			},
			fl = fit(ls); /* names stay complete: shrink to the column instead of cutting letters */
		T(ls, x + 30, (vs ? 210 : 215) + Math.round(3.5 * (1 - fl)), hot ? P.acc : P.dim, fl, "c");
		if (vs) {
			const fv = fit(vs);
			T(vs, x + 30, 221 + Math.round(3.5 * (1 - fv)), P.fg, fv, "c");
		}
		R(x + 6, 233, 48, 3, P.faint);
		R(x + 6, 233, Math.round(48 * clamp(k.n, 0, 1)), 3, hot ? P.acc : P.fg);
	});
}

function title(s, right) {
	T(s, 6, 17, P.dim);
	if (right) {
		T(right, 234, 17, P.dim, 1, "r");
	}
}

// ---------- algorithm diagram ----------
function algLayout(a, cx, by, sp, dy) {
	const A = ALG[a],
		tg = {};
	for (let o = 1; o <= 6; o++) {
		tg[o] = [];
	}
	A.e.forEach(([m, t]) => tg[m].push(t));
	const dep = {};
	const d = (o) => {
		if (dep[o] != null) {
			return dep[o];
		}
		if (A.c.includes(o)) {
			return (dep[o] = 0);
		}
		let m = 0;
		tg[o].forEach((t) => (m = Math.max(m, d(t))));
		return (dep[o] = m + 1);
	};
	for (let o = 1; o <= 6; o++) {
		d(o);
	}
	const pos = {},
		maxD = Math.max(...Object.values(dep));
	const cs = A.c.slice().sort((x, y) => x - y);
	cs.forEach((o, i) => (pos[o] = { x: cx + (i - (cs.length - 1) / 2) * sp, y: by }));
	for (let k = 1; k <= maxD; k++) {
		const row = [];
		for (let o = 1; o <= 6; o++) {
			if (dep[o] === k) {
				const xs = tg[o].map((t) => pos[t].x);
				row.push({ o, want: xs.reduce((s, v) => s + v, 0) / xs.length });
			}
		}
		row.sort((p, r) => p.want - r.want || p.o - r.o);
		let prev = -1e9;
		row.forEach((r) => {
			r.x = Math.max(r.want, prev + sp);
			prev = r.x;
		});
		const sh =
			(row.reduce((s, r) => s + r.want, 0) - row.reduce((s, r) => s + r.x, 0)) / (row.length || 1);
		row.forEach((r) => (pos[r.o] = { x: r.x + sh, y: by - k * dy }));
	}
	return { pos, A };
}

function drawAlg(a, cx, by, sp, dy, bw, bh, big) {
	const { pos, A } = algLayout(a, cx, by, sp, dy);
	const ln = big ? P.dim : P.faint;
	A.e.forEach(([m, t]) => {
		const p = pos[m],
			r = pos[t];
		const x0 = Math.round(p.x),
			y0 = Math.round(p.y + bh),
			x1 = Math.round(r.x),
			y1 = Math.round(r.y);
		const ym = Math.round((y0 + y1) / 2);
		L(x0, y0, x0, ym, ln);
		L(x0, ym, x1, ym, ln);
		L(x1, ym, x1, y1 - 1, ln);
	});
	const f = pos[A.f];
	if (f) {
		const xr = Math.round(f.x + bw / 2),
			yt = Math.round(f.y),
			xc = Math.round(f.x),
			g = big ? 4 : 2;
		L(xr, yt + (bh >> 1), xr + g, yt + (bh >> 1), ln);
		L(xr + g, yt + (bh >> 1), xr + g, yt - g, ln);
		L(xr + g, yt - g, xc, yt - g, ln);
		L(xc, yt - g, xc, yt - 1, ln);
	}
	const cs = A.c.map((o) => pos[o].x);
	const yb = by + bh;
	cs.forEach((x) => L(x, yb, x, yb + (big ? 5 : 3), ln));
	L(Math.min(...cs), yb + (big ? 5 : 3), Math.max(...cs), yb + (big ? 5 : 3), ln);
	for (let o = 1; o <= 6; o++) {
		const p = pos[o];
		const x = Math.round(p.x - bw / 2),
			y = Math.round(p.y);
		const c = P.ops[o - 1];
		const car = A.c.includes(o);
		if (car) {
			R(x, y, bw, bh, c);
			if (big) {
				T(o, x + bw / 2, y + ((bh - 7) >> 1), P.bg, 1, "c");
			}
		} else {
			R(x, y, bw, bh, P.bg);
			B(x, y, bw, bh, c);
			if (big) {
				T(o, x + bw / 2, y + ((bh - 7) >> 1), c, 1, "c");
			}
		}
		if (big && o - 1 === S.op) {
			B(x - 2, y - 2, bw + 4, bh + 4, P.fg);
		}
	}
	return { yb: yb + (big ? 5 : 3), minx: Math.min(...cs), maxx: Math.max(...cs) };
}

const isCar = (o) => ALG[S.alg].c.includes(o + 1);

// ---------- envelope ----------
function envPts(op, x, y, w, h) {
	const Rr = op.R,
		Lv = op.L;
	const seg = (r) => Math.round(((100 - r) / 100) * w * 0.22) + 3;
	const base = y + h - 1;
	const ly = (l) => base - Math.round((l / 99) * (h - 1));
	let cx = x;
	const p = [{ x: cx, y: ly(Lv[3]) }];
	cx += seg(Rr[0]);
	p.push({ x: cx, y: ly(Lv[0]) });
	cx += seg(Rr[1]);
	p.push({ x: cx, y: ly(Lv[1]) });
	cx += seg(Rr[2]);
	p.push({ x: cx, y: ly(Lv[2]) });
	const hold = Math.max(10, x + w - 1 - cx - seg(Rr[3]));
	cx += hold;
	p.push({ x: cx, y: ly(Lv[2]) });
	cx += seg(Rr[3]);
	p.push({ x: Math.min(cx, x + w - 1), y: ly(Lv[3]) });
	return p;
}

function drawEnv(op, x, y, w, h, c, fill, marks) {
	const p = envPts(op, x, y, w, h),
		base = y + h - 1;
	if (fill) {
		for (let i = 0; i < p.length - 1; i++) {
			const a = p[i],
				b = p[i + 1];
			for (let xx = a.x; xx < b.x; xx += 2) {
				const yy = a.y + ((b.y - a.y) * (xx - a.x)) / Math.max(1, b.x - a.x);
				for (let k = Math.ceil(yy) + 2; k < base; k += 2) {
					if (((k >> 1) & 1) === ((xx >> 1) & 1)) {
						R(xx, k, 1, 1, P.faint);
					}
				}
			}
		}
	}
	for (let i = 0; i < p.length - 1; i++) {
		if (i === 3) {
			DH(p[3].x, p[3].y, p[4].x - p[3].x, c, 3, 2);
		} else {
			L(p[i].x, p[i].y, p[i + 1].x, p[i + 1].y, c);
			L(p[i].x, p[i].y - 1, p[i + 1].x, p[i + 1].y - 1, c);
		}
	}
	if (marks) {
		[1, 2, 3, 5].forEach((k, i) => {
			const q = p[k];
			R(q.x - 2, q.y - 2, 5, 5, P.bg);
			B(q.x - 2, q.y - 2, 5, 5, c);
		});
		DV(p[4].x, y, h, P.faint, 1, 2);
		const kx = p[4].x + 3 + TW("KEY UP") > x + w ? p[4].x - 3 - TW("KEY UP") : p[4].x + 3;
		T("KEY UP", kx, y + 1, P.dim);
	}
	return p;
}

// ---------- shared pictures ----------
function filtCurve(x0, y0, w, h, ft, cutv, resv, col) {
	[100, 1000, 10000].forEach((f, i) => {
		const x = x0 + Math.round((Math.log(f / 20) / Math.log(1000)) * w);
		DV(x, y0, h, P.faint, 1, 2);
		T(["100", "1K", "10K"][i], i === 2 ? x - 2 : x + 2, y0 + h - 9, P.dim, 1, i === 2 ? "r" : "l");
	}); /* 10K sits left of its line: the touch icon has the graph's bottom right corner */
	const fc = 20 * Math.pow(1000, cutv / 127),
		Q = 0.7 + (resv / 99) * 6,
		mid = y0 + Math.round(h * 0.32);
	DH(x0, mid, w, P.faint, 1, 3);
	let py = null;
	for (let i = 0; i < w; i++) {
		const f = 20 * Math.pow(1000, i / w);
		const r = f / fc;
		let m;
		if (ft === 0) {
			m = 1 / Math.sqrt((1 - r * r) ** 2 + (r / Q) ** 2);
		} else if (ft === 2) {
			m = (r * r) / Math.sqrt((1 - r * r) ** 2 + (r / Q) ** 2);
		} else {
			m = r / Q / Math.sqrt((1 - r * r) ** 2 + (r / Q) ** 2);
		}
		const db = 20 * Math.log10(Math.max(m, 1e-4));
		const y = clamp(Math.round(mid - db * 2.2), y0 + 2, y0 + h - 11);
		if (py != null) {
			L(x0 + i - 1, py, x0 + i, y, col);
		}
		py = y;
	}
	const cx = x0 + Math.round((cutv / 127) * w);
	DV(cx, y0, h, P.acc, 2, 2);
	{
		const cs = hz(cutv) + "HZ",
			lx = Math.min(cx + 3, x0 + w - TW(cs) - 3);
		[
			[-1, 0],
			[1, 0],
			[0, -1],
			[0, 1],
		].forEach(([a, b]) => T(cs, lx + a, y0 + 14 + b, P.grid));
		T(cs, lx, y0 + 14, P.acc);
	}
}

function wavePic(x, y, w, h, t, c) {
	const mid = y + h / 2;
	let py = null;
	for (let i = 0; i < w; i++) {
		const ph = ((i / w) * 2) % 1;
		const v =
			t === 0
				? 1 - ph * 2
				: t === 1
					? ph < 0.5
						? 1
						: -1
					: t === 2
						? ph < 0.5
							? ph * 4 - 1
							: 3 - ph * 4
						: Math.sin(ph * Math.PI * 2);
		const yy = Math.round(mid - v * (h / 2 - 1));
		if (py != null) {
			L(x + i - 1, py, x + i, yy, c);
		}
		py = yy;
	}
}

function scapeViz(nm, x, y, w, h, k, now, on) {
	R(x, y, w, h, P.grid);
	if (!on) {
		DH(x, y + (h >> 1), w, P.faint, 1, 3);
		return;
	}
	const c1 = P.ops[3],
		c0 = P.ops[0];
	if (nm === "RAIN") {
		for (let i = 0; i < w; i += 3) {
			const q = hsh(i * 1.7);
			if (q > k * 1.1 + 0.05) {
				continue;
			}
			const ph = (now / (260 + q * 300) + q * 5) % 1;
			R(x + i, y + Math.floor(ph * (h - 3)), 1, 3, c1);
		}
	} else if (nm === "VINYL") {
		const f = Math.floor(now / 80);
		DH(x, y + (h >> 1), w, P.faint, 1, 3);
		for (let n = 0; n < 12; n++) {
			if (hsh(f * 7.3 + n) > k * 0.9 + 0.05) {
				continue;
			}
			R(x + Math.floor(hsh(f * 3.1 + n * 5.7) * w), y + Math.floor(hsh(f + n * 1.9) * h), 1, 2, c0);
		}
	} else if (nm === "OCEAN") {
		let py = null;
		for (let i = 0; i < w; i++) {
			const v = Math.sin(i / 22 + now / 1100) * 0.6 + Math.sin(i / 9 - now / 700) * 0.25;
			const yy = Math.round(y + h / 2 - v * k * (h / 2 - 1));
			if (py != null) {
				L(x + i - 1, py, x + i, yy, c1);
			}
			py = yy;
		}
	} else {
		const f = Math.floor(now / 110);
		for (let i = 0; i < w; i += 2) {
			const hh = Math.round(hsh(f * 0.3 + i * 0.9) * k * (h - 1)) + 1;
			R(x + i, y + h - hh, 1, hh, c0);
		}
	}
}
