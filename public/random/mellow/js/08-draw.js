// the bench grid and the master draw of the LCD
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-unused-vars, no-undef -- offers names the other files use; uses names that live in the other files of the folder */

// ---------- phone-only UI settings (not firmware): the bench grid ----------
const UI = { grid: 1, sqe: 0, hg: 1, bp: 0 };

let btnPageSet = null;

try {
	const o = JSON.parse(localStorage.getItem("mellow-ui"));
	if (o && typeof o === "object") {
		if (o.grid === 0) {
			UI.grid = 0;
		}
		if (o.sqe >= 0 && o.sqe <= 2) {
			UI.sqe = o.sqe | 0;
		}
		if (o.hg >= 0 && o.hg <= 2) {
			UI.hg = o.hg | 0;
		}
		if (o.bp >= 0 && o.bp <= 2) {
			UI.bp = o.bp | 0;
		}
	}
} catch (e) {
	/* nothing to do */
}
/* this phone only: the page grid and the touch lock */
const saveUI = () => {
	try {
		localStorage.setItem("mellow-ui", JSON.stringify(UI));
	} catch (e) {
		/* nothing to do */
	}
};

function applyGrid() {
	document.body.classList.toggle("nogrid", !UI.grid);
	const hp = Math.round(clamp(innerHeight - navHeight() - innerWidth - 272, 0, [0, 20, 34][UI.hg]));
	/* on a short phone the strip gives way first: the keys and buttons come before it */ document.documentElement.style.setProperty(
		"--hg",
		hp + "px",
	);
	document.body.classList.toggle("nohg", !hp);
	const g = gridGeom(),
		cv = document.getElementById("big"),
		r = cv ? cv.getBoundingClientRect() : { left: 0, top: 0, width: 0 },
		k = r.width ? r.width / 240 : Math.min(innerWidth, 520) / 240,
		cell = g.cell * k,
		minor = g.minor * k,
		st = document.documentElement.style;
	const ax = (r.left || 0) + g.ax * k,
		ay = (r.top || 0) + g.ay * k;
	{
		const kn = document.getElementById("bigknobs"),
			mg = document.querySelector(".mgrid");
		if (kn && mg) {
			const a = kn.getBoundingClientRect(),
				b = mg.getBoundingClientRect();
			if (a.height && b.height) {
				st.setProperty("--ct", Math.round(a.top - 6) + "px");
				st.setProperty("--cb", Math.round(b.bottom + 6) + "px");
			}
		}
	}
	st.setProperty("--gw", cell.toFixed(2) + "px");
	st.setProperty("--gm", minor.toFixed(2) + "px");
	st.setProperty("--gx", ax.toFixed(2) + "px");
	st.setProperty("--gy", (((ay % cell) + cell) % cell).toFixed(2) + "px");
}

addEventListener("resize", () => {
	try {
		applyGrid();
	} catch (e) {
		/* nothing to do */
	}
});

function toggleGrid() {
	UI.grid ^= 1;
	saveUI();
	applyGrid();
	toast(UI.grid ? "GRID ON" : "GRID OFF");
}

let gearOn = false;

// the settings icon: an 11x11 cog (a ring with eight teeth), built once as runs of pixels
const GEAR = (() => {
	const rows = [];
	for (let y = 0; y < 11; y++) {
		const runs = [];
		let a = -1;
		for (let x = 0; x <= 11; x++) {
			const dx = x - 5,
				dy = y - 5,
				r = Math.hypot(dx, dy),
				ax = Math.abs(dx),
				ay = Math.abs(dy);
			const on =
				x < 11 &&
				((r >= 2.3 && r <= 3.9) ||
					(r > 3.9 && r <= 5.3 && (ax <= 1 || ay <= 1 || Math.abs(ax - ay) <= 1)));
			if (on && a < 0) {
				a = x;
			}
			if (!on && a >= 0) {
				runs.push([a, x - a]);
				a = -1;
			}
		}
		rows.push(runs);
	}
	return rows;
})();

// the settings cog, drawn at the right of the status strip
function gearIcon(x, y, c) {
	GEAR.forEach((runs, j) => runs.forEach(([a, n]) => R(x + a, y + j, n, 1, c)));
}

// ---------- master draw ----------
function draw(ctx, now, live) {
	C = REC;
	recCtx = ctx;
	nops = 0;
	rFill = rFont = null;
	P = PAL[S.theme];
	R(0, 0, 240, 240, P.bg);
	if (UI.grid && S.screen === "seq") {
		const g = gridGeom(),
			ln = "rgba(181,176,163,.075)",
			mn = "rgba(181,176,163,.035)",
			nm = Math.ceil(240 / g.minor) + 2;
		const onMajor = (v) => {
			const t = (v - g.ax) / g.cell;
			return Math.abs(t - Math.round(t)) < 0.01;
		};
		for (let k = -Math.ceil(g.ax / g.minor); k < nm; k++) {
			const v = g.ax + k * g.minor;
			if (v < 0 || v >= 240) {
				continue;
			}
			R(Math.round(v), 0, 1, 240, onMajor(v) ? ln : mn);
		}
		for (let k = 0; k < nm + 8; k++) {
			const y = g.ay - k * g.minor;
			if (y < 0) {
				break;
			}
			R(
				0,
				Math.round(y),
				240,
				1,
				Math.abs((k * g.minor) / g.cell - Math.round((k * g.minor) / g.cell)) < 0.01 ? ln : mn,
			);
		}
		for (let k = 1; k < nm + 8; k++) {
			const y = g.ay + k * g.minor;
			if (y >= 240) {
				break;
			}
			R(
				0,
				Math.round(y),
				240,
				1,
				Math.abs((k * g.minor) / g.cell - Math.round((k * g.minor) / g.cell)) < 0.01 ? ln : mn,
			);
		}
		const pu = live && gridPulse();
		if (pu) {
			R(
				Math.round(g.ax + pu.col * g.cell),
				13,
				Math.max(1, Math.round(g.cell)),
				227,
				"rgba(244,201,93," + (0.08 * (1 - pu.f) * (1 - pu.f)).toFixed(3) + ")",
			);
		}
	}
	if (S.screen === "boot") {
		SCR.boot(now, live);
		return;
	}
	if (S.screen !== "song" && NEST.i >= 0) {
		nestCollapse();
	} /* leaving the song screen closes the dropdown */
	if (FMENU.open && !(S.screen === "seq" && dgOn())) {
		closeFillMenu();
	} /* so does leaving the drum grid for the FILL dropdown */
	if (EMENU.open && !(S.screen === "seq" && !dgOn())) {
		closeEditMenu();
	} /* the BARS EDIT dropdown and the automate dropdown belong to their screens too: a screen change that is not a tap (a key, MIDI, a knob) left them hanging over the next screen, and the next tap on the LCD was swallowed by the "outside tap" guard (UI hunt) */
	if (NMENU.open && !nestOn()) {
		closeNestMenu();
	}
	/* a dropdown sits under the screen's title row; its top was set once when it opened, so a resize or a turn of the phone left it where the screen used to be (UI hunt) */
	for (const [id, f] of [
		["editmenu", 28],
		["fillmenu", 28],
		["nestmenu", 30],
	]) {
		const m = document.getElementById(id);
		if (m && !m.hidden) {
			const r = big.getBoundingClientRect(),
				t = Math.round(r.top + (r.height * f) / 240) + "px";
			if (m.style.top !== t) {
				m.style.top = t;
			}
		}
	}
	SCR[S.screen](now, live);
	statusBar(now);
	knobStrip(knobs(), now);
	if (live && S.pop && now - S.pop.t < 850) {
		const p = S.pop;
		const x = 34,
			y = 74,
			w = 172,
			h = 60;
		R(x + 3, y + 3, w, h, P.grid);
		R(x, y, w, h, P.bar);
		B(x, y, w, h, P.fg);
		T(p.l, x + w / 2, y + 7, P.dim, 1, "c");
		{
			const big = TW(p.v, 2) <= w - 12;
			T(p.v, x + w / 2, y + (big ? 20 : 24), P.fg, big ? 2 : TW(p.v, 1.4) <= w - 12 ? 1.4 : 1, "c");
		}
		/* a long value (TRIANGLE \u00b7 DEFAULT) is drawn smaller instead of leaving the box */ R(
			x + 10,
			y + 46,
			w - 20,
			4,
			P.faint,
		);
		R(x + 10, y + 46, Math.round((w - 20) * clamp(p.n, 0, 1)), 4, P.acc);
	}
	if (live && S.dlg) {
		const D = S.dlg,
			h = 24 + D.lines.length * 14,
			y = Math.round((205 - h) / 2);
		R(12, y, 216, h, P.bar);
		B(12, y, 216, h, P.fg);
		T(D.t, 120, y + 6, P.acc, 1, "c");
		D.lines.forEach((l, k) => T(l, 120, y + 20 + k * 14, P.fg, 1, "c"));
	}
	if (live && S.toast && now - S.toast.t < 1300) {
		const s = S.toast.s,
			ts = TW(s) <= 224 ? 1 : TW(s, 0.85) <= 224 ? 0.85 : 0.7,
			w = Math.min(236, TW(s, ts) + 20);
		R(120 - w / 2, 96, w, 22, P.sel);
		T(s, 120, 104 + Math.round(3.5 * (1 - ts)), P.selfg, ts, "c");
	} /* a long message shrinks to the screen's width */
}
