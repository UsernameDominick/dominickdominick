// LCD text, icon glyphs and the colour palettes
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-unassigned-vars, no-unused-vars, no-control-regex -- assigned in other files of the folder; offers names the other files use; the LCD text marks its icons with control characters */

// ---------- LCD icon glyphs (bluetooth, up, down); all text is Work Sans, see T() ----------
const FS = {
	"\u0001": "..#.. #.##. .###. ..#.. .###. #.##. ..#..", // bluetooth rune
	"\u0002": "..... ..#.. .###. ##### ..... ..... .....", // up
	"\u0003": "..... ..... ..... ##### .###. ..#.. .....", // down
};

const G = {};

for (const k in FS) {
	const s = FS[k].replace(/ /g, "");
	G[k] = [];
	for (let i = 0; i < 35; i++) {
		if (s[i] === "#") {
			G[k].push(i);
		}
	}
}

let C, P;

/* Frame dedupe. draw() writes its canvas calls into a flat recording (REC) instead of the canvas; recFlush() replays it onto the real canvas only when it differs from the
   last one replayed. A screen that is not moving then costs no raster, no commit and no upload. Same calls in the same order = the same pixels. A resize, a font that
   finishes loading, the tab coming back and a 1 s refresh (in case a browser dropped the canvas) force a replay. */
let ops = [],
	pops = [],
	nops = 0,
	pn = -1,
	rFill = null,
	rFont = null,
	recCtx = null,
	recForce = true,
	recW = 0,
	recT = -1e9;

const REC = {
	set fillStyle(v) {
		if (v !== rFill) {
			rFill = v;
			ops[nops++] = 0;
			ops[nops++] = v;
		}
	},
	set font(v) {
		if (v !== rFont) {
			rFont = v;
			ops[nops++] = 1;
			ops[nops++] = v;
		}
	},
	set textBaseline(v) {},
	fillRect(x, y, w, h) {
		ops[nops++] = 2;
		ops[nops++] = x;
		ops[nops++] = y;
		ops[nops++] = w;
		ops[nops++] = h;
	},
	fillText(s, x, y) {
		ops[nops++] = 3;
		ops[nops++] = s;
		ops[nops++] = x;
		ops[nops++] = y;
	},
};

/* recMacro: a picture that only changes with its key (the wavetable stack) is recorded once, then costs one op to compare and replay */
const MAC = new Map();

function recMacro(key, fn) {
	let m = MAC.get(key);
	if (!m) {
		const so = ops,
			sn = nops;
		ops = [];
		nops = 0;
		rFill = rFont = null;
		fn();
		m = ops.slice(0, nops);
		ops = so;
		nops = sn;
		if (MAC.size > 40) {
			MAC.clear();
		}
		MAC.set(key, m);
	}
	rFill = rFont = null;
	ops[nops++] = 4;
	ops[nops++] = m;
}

function recRun(c, a, n) {
	for (let i = 0; i < n;) {
		switch (a[i]) {
			case 0:
				c.fillStyle = a[i + 1];
				i += 2;
				break;
			case 1:
				c.font = a[i + 1];
				i += 2;
				break;
			case 2:
				c.fillRect(a[i + 1], a[i + 2], a[i + 3], a[i + 4]);
				i += 5;
				break;
			case 4: {
				const m = a[i + 1];
				recRun(c, m, m.length);
				i += 2;
				break;
			}
			default:
				c.fillText(a[i + 1], a[i + 2], a[i + 3]);
				i += 4;
		}
	}
}

function recFlush(t) {
	const cv = recCtx.canvas;
	let same = !recForce && cv.width === recW && t - recT < 1000 && nops === pn;
	if (same) {
		for (let i = 0; i < nops; i++) {
			if (ops[i] !== pops[i]) {
				same = false;
				break;
			}
		}
	}
	const o = ops;
	ops = pops;
	pops = o;
	pn = nops;
	if (same) {
		return false;
	}
	const k = cv.width / 240,
		c = recCtx;
	c.setTransform(k, 0, 0, k, 0, 0);
	c.imageSmoothingEnabled = false;
	c.textBaseline = "alphabetic";
	recRun(c, pops, pn);
	recForce = false;
	recW = cv.width;
	recT = t;
	return true;
}

document.addEventListener("visibilitychange", () => {
	recForce = true;
});

if (document.fonts && document.fonts.addEventListener) {
	document.fonts.addEventListener("loadingdone", () => {
		recForce = true;
	});
}

const R = (x, y, w, h, c) => {
	C.fillStyle = c;
	C.fillRect(x | 0, y | 0, w | 0, h | 0);
};

const B = (x, y, w, h, c) => {
	R(x, y, w, 1, c);
	R(x, y + h - 1, w, 1, c);
	R(x, y, 1, h, c);
	R(x + w - 1, y, 1, h, c);
};

const DH = (x, y, w, c, on = 2, off = 2) => {
	for (let i = 0; i < w; i += on + off) {
		R(x + i, y, Math.min(on, w - i), 1, c);
	}
};

const DV = (x, y, h, c, on = 2, off = 2) => {
	for (let i = 0; i < h; i += on + off) {
		R(x, y + i, 1, Math.min(on, h - i), c);
	}
};

// the icon table for buttons on the LCD (8 x 6 pixel pictures, drawn with R by ico(); the text glyphs above are 5 x 7): UNDO and REDO are curved arrows
const IC = {
	undo: ["..#.....", ".##.....", "#######.", ".##...##", "..#....#", "....###."],
	redo: [".....#..", ".....##.", ".#######", "##...##.", "#....#..", ".###...."],
};

function ico(n, x, y, c) {
	const g = IC[n];
	for (let j = 0; j < g.length; j++) {
		const r = g[j];
		let a = -1;
		for (let i = 0; i <= r.length; i++) {
			const on = i < r.length && r[i] === "#";
			if (on && a < 0) {
				a = i;
			}
			if (!on && a >= 0) {
				R(x + a, y + j, i - a, 1, c);
				a = -1;
			}
		}
	}
}

function L(x0, y0, x1, y1, c) {
	x0 = Math.round(x0);
	y0 = Math.round(y0);
	x1 = Math.round(x1);
	y1 = Math.round(y1);
	C.fillStyle = c;
	let dx = Math.abs(x1 - x0),
		sx = x0 < x1 ? 1 : -1,
		dy = -Math.abs(y1 - y0),
		sy = y0 < y1 ? 1 : -1,
		e = dx + dy;
	for (let n = 0; n < 2000; n++) {
		C.fillRect(x0, y0, 1, 1);
		if (x0 === x1 && y0 === y1) {
			break;
		}
		const e2 = 2 * e;
		if (e2 >= dy) {
			e += dy;
			x0 += sx;
		}
		if (e2 <= dx) {
			e += dx;
			y0 += sy;
		}
	}
}

// Text on the LCD is smooth Work Sans (anti-aliased, like any modern small screen), drawn on a canvas sized to the display. Shapes stay
// crisp blocks. sc is the old text scale: the same cell (cap height about 7 px per step), now a font. The few icon glyphs (bluetooth,
// up, down) are still drawn from the pixel table.
const CAPR = 0.66,
	TSZ = 9.1,
	TFONT = (sc) => "600 " + (TSZ * sc).toFixed(2) + 'px "Work Sans", system-ui, sans-serif',
	MC = document.createElement("canvas").getContext("2d"),
	TWC = new Map();

function twMeasure(s, sc) {
	const k = sc + "|" + s;
	let w = TWC.get(k);
	if (w == null) {
		MC.font = TFONT(sc);
		w = 0;
		for (const part of s.split(/([\u0001-\u0003])/)) {
			if (!part) {
				continue;
			}
			w += /[\u0001-\u0003]/.test(part) ? 5 * sc + sc : MC.measureText(part).width;
		}
		if (TWC.size > 3000) {
			TWC.clear();
		}
		TWC.set(k, w);
	}
	return w;
}

function T(s, x, y, c, sc = 1, al = "l") {
	s = String(s).toLowerCase();
	const w = twMeasure(s, sc);
	if (al === "c") {
		x = Math.round(x - w / 2);
	} else if (al === "r") {
		x = Math.round(x - w);
	}
	C.fillStyle = c === P.faint ? P.hint : c;
	C.textBaseline = "alphabetic";
	C.font = TFONT(sc);
	let ox = x;
	for (const part of s.split(/([\u0001-\u0003])/)) {
		if (!part) {
			continue;
		}
		if (/[\u0001-\u0003]/.test(part)) {
			const g = G[part] || G["?"];
			for (const i of g) {
				C.fillRect(ox + (i % 5) * sc, y + ((i / 5) | 0) * sc, sc, sc);
			}
			ox += 6 * sc;
		} else {
			C.fillText(part, ox, y + 7 * sc - (7 * sc - CAPR * TSZ * sc) / 2);
			ox += twMeasure(part, sc);
		}
	}
	return w;
}

const TW = (s, sc = 1) => twMeasure(String(s).toLowerCase(), sc);

// ---------- palettes, quantised to RGB565 ----------
function q(h) {
	const n = parseInt(h.slice(1), 16);
	let r = (n >> 16) & 255,
		g = (n >> 8) & 255,
		b = n & 255;
	r = Math.round((Math.round((r * 31) / 255) * 255) / 31);
	g = Math.round((Math.round((g * 63) / 255) * 255) / 63);
	b = Math.round((Math.round((b * 31) / 255) * 255) / 31);
	return `rgb(${r},${g},${b})`;
}

const RAW = {
	dusk: {
		bg: "#121212",
		bar: "#1d1d1c",
		fg: "#ece6d6",
		dim: "#9a968b",
		faint: "#2a2a28",
		hint: "#6b6862",
		grid: "#1b1b1a",
		sel: "#e04a36",
		selfg: "#ece6d6",
		acc: "#e04a36",
		rec: "#e04a36",
		ops: ["#e04a36", "#ece6d6", "#9a968b", "#6b6862", "#ece6d6", "#b5b0a3"],
		tag: ["#ece6d6", "#e04a36", "#9a968b", "#ece6d6", "#b5b0a3", "#6b6862"],
	},
};

const PAL = {};

for (const k in RAW) {
	const o = {};
	for (const f in RAW[k]) {
		o[f] = Array.isArray(RAW[k][f]) ? RAW[k][f].map(q) : q(RAW[k][f]);
	}
	PAL[k] = o;
}
