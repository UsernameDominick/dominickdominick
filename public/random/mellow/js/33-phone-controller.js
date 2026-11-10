// the phone controller: layout, mobile buttons, dials, and starting up
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---------- phone controller ----------
// desktop (PROTOTYPE ONLY): a landscape window of 900 x 540 or more. deskFit sizes the panel: the LCD frame --sc (its canvas a whole multiple of 240 device pixels where the window allows), the panel width --pw and the keys height --kh, all on whole pixels so nothing blurs
const DESK = window.matchMedia(
	"(orientation:landscape) and (min-width:900px) and (min-height:540px)",
);

const CLOUD = window.matchMedia(
	"(max-width:760px) and (orientation:portrait),(orientation:landscape) and (min-width:900px) and (min-height:540px)",
);
// the button cloud (the same query as the CSS 'THE BUTTON CLOUD'): no pages, so no page-turn swipe

const SMAXD = 780;
// the LCD never gets bigger than this on a big desktop window (it was filling the whole height)
function deskFit() {
	const st = document.documentElement.style,
		V = ["--pw", "--ph", "--sc", "--kr", "--bh", "--rb", "--sh", "--kh", "--knd"];
	if (!DESK.matches) {
		V.forEach((k) => st.removeProperty(k));
		return;
	}
	// the keyboard and the pitch strip run along the whole bottom of the panel; the LCD is a square of about 60% of the window height on the left, and the knobs row and the button cloud sit beside it, exactly as tall as the LCD
	// (every height a whole pixel): the keys take what the LCD and the strip leave, but never get taller than 3.4 x a white key's width (then the LCD grows instead)
	const vw = document.documentElement.clientWidth || innerWidth,
		vh = innerHeight - navHeight(),
		dpr = window.devicePixelRatio || 1,
		m = 12,
		pad = 12,
		dg = 10,
		rmin = 560,
		rmax = 1700,
		KMIN = 110;
	const Hu = vh - 2 * m - 2 * pad - 2 * dg,
		sw = vw - 2 * m - 2 * pad - dg - rmin; // Hu: the height for the LCD, the strip and the keys; sw: the widest the LCD can be and leave the right side its minimum
	const shOf = (S) => clamp(Math.round(S * 0.075), 44, 64);
	const snap = (S0) => {
		const cap = Math.max(300, Math.min(sw, SMAXD, Hu - 64 - KMIN));
		let S = Math.max(300, Math.min(Math.round(S0), cap)),
			C = S - 16;
		if (C * dpr >= 240) {
			const k = Math.floor((C * dpr) / 240 + 0.001),
				dn = (k * 240) / dpr,
				up = ((k + 1) * 240) / dpr;
			if (dn >= C * 0.92) {
				C = dn;
			} else if (up <= C * 1.2 && up + 16 <= Math.min(cap, Math.round(vh * 0.7))) {
				C = up;
			} else {
				C = Math.floor(C);
			}
		} else {
			C = Math.floor(C);
		} // the canvas is a whole multiple of 240 device px whenever that costs under 8% of the size (down) or adds under 20% (up, at most 70% of the window height)
		return Math.ceil(C + 16);
	};
	const widths = (S) => {
		const rw = Math.min(rmax, vw - 2 * m - 2 * pad - dg - S);
		let pw = S + dg + rw + 2 * pad;
		if ((vw - pw) % 2) {
			pw--;
		}
		return { rw, pw };
	};
	let S = snap(vh * 0.6),
		W = widths(S),
		kmax = Math.round(((W.pw - 2 * pad) / 16) * 3.4);
	if (Hu - S - shOf(S) > kmax) {
		S = snap(S + (Hu - S - shOf(S) - kmax));
		W = widths(S);
		kmax = Math.round(((W.pw - 2 * pad) / 16) * 3.4);
	} // tall keys on a wide window: the LCD takes the height instead
	const { rw, pw } = W,
		sh = shOf(S);
	let kh = Math.max(KMIN, Math.min(Hu - S - sh, kmax));
	if ((vh - (S + sh + kh + 2 * dg + 2 * pad)) % 2) {
		kh--;
	} // the panel sits on whole pixels: its top gap is an even number
	const R = S - dg,
		kr0 = clamp(Math.round(R * 0.25), 96, 190),
		rb = Math.max(36, Math.floor((R - kr0 - 3 * dg) / 4)),
		bh = 4 * rb + 3 * dg,
		kr = R - bh;
	const cw = (rw - 7 * dg) / 8,
		knd = clamp(Math.floor(Math.min(kr - 62, cw - 22)), 34, 112);
	const o = {
		"--pw": pw,
		"--ph": S + sh + kh + 2 * dg + 2 * pad,
		"--sc": S,
		"--kr": kr,
		"--bh": bh,
		"--rb": rb,
		"--sh": sh,
		"--kh": kh,
		"--knd": knd,
	};
	for (const k in o) {
		st.setProperty(k, o[k] + "px");
	}
}

deskFit();

window.addEventListener("resize", deskFit);

const mobEl = document.getElementById("mobile"),
	mobBtns = {},
	mobDials = {};

let mobKeys = [],
	mobStart = 3,
	MVIS = 10;

{
	const enc = document.createElement("div");
	enc.className = "menc";
	[
		["master", "MASTER"],
		["select", "PAGE"],
		["presets", "PRESET"],
		["algorithm", "ALGO"],
	].forEach(([id, lab]) => {
		const d = mkSlider(enc, lab, lab);
		mobDials[id] = d;
		bindSlider(
			d,
			(dd) => turn(id, dd),
			() => rangeFor(id),
			() => resetDial(id),
			() => startLearn(id),
		);
	});
	mobEl.appendChild(enc);
	const grid = document.createElement("div");
	grid.className = "mgrid";
	// PROTOTYPE ONLY: one row of buttons in pages. A vertical swipe on the strip slides to the next page (past the last goes back to the first); a tap presses.
	// A press waits up to BTNDEF ms to see whether the finger turns into a swipe (a swipe never presses); a quick tap presses the moment it lifts.
	const PAGES = [
		[
			["home", "HOME"],
			["play", "PLAY"],
			["stop", "STOP"],
			["rec", "REC"],
			["browser", "BROWSER"],
			["save", "SAVE"],
			["settings", "SETTINGS"],
		] /* 1: general */,
		[
			["seq", "SEQ"],
			["song", "SONG"],
			["op", "EDIT"],
			["env", "ENV"],
			["lfo", "LFO"],
			["fx", "FX"],
			["mixer", "MIXER"],
		] /* 2: sound and sequencing */,
		[
			["key", "KEY"],
			["arp", "ARP"],
			["hold", "HOLD"],
			["queue", "QUEUE"],
			["strip", "STRIP"],
			["octdn", "OCT−"],
			["octup", "OCT+"],
		],
	]; /* 3: the piano (seven buttons: the whole row) */
	// HOLD A BUTTON (about 0.35 s) turns its mode OFF at once and does not press it. Each entry returns false when the mode is already off (then the hold does nothing).
	// Only the toggles/modes have one; the screens (HOME, EDIT, FX ...) and PLAY / STOP / SAVE ignore a hold and keep the 45 ms press.
	// REC is the one exception: HOLD REC opens the RECORDING SETTINGS screen (HOLDACT, below) and does not touch the recording; a tap still arms and disarms it.
	const HOLDMS = 350,
		HOLDOFF = {
			seq: () => {
				if (!S.seqEn) {
					return false;
				}
				const rec0 = S.rec && S.playing;
				S.seqEn = false;
				S.rec = false;
				S.countdown = null;
				if (S.playing) {
					S.playing = false;
					stopSeq();
				}
				if (rec0) {
					finishRec();
				}
				S.recExt = false;
				/* a recording that is switched off here ends like STOP does (finishRec: trims a growing pattern, saves); recExt used to stay on and the next plain PLAY grew the pattern a bar at a time */ if (
					S.screen === "seq" ||
					S.screen === "song" ||
					S.screen === "nest" ||
					S.screen === "dgrid"
				) {
					S.screen = "home";
				}
				toast("SEQ OFF");
				if (AC) {
					audioSync();
				}
				return true;
			},
			song: () => {
				if (!S.song.on) {
					return false;
				}
				songSetOn(0);
				toast("SONG OFF");
				return true;
			},
			key: () => {
				if (S.screen !== "scale") {
					return false;
				}
				press("key");
				return true;
			},
			arp: () => {
				if (!S.arp.on) {
					return false;
				}
				S.arp.on = false;
				A.arps.forEach((x) => x.clear());
				A.arpKeys = {};
				if (S.screen === "gen" || (S.screen === "pp" && S.ppMode === "arp")) {
					S.screen = "home";
				}
				toast("ARP OFF");
				return true;
			},
			hold: () => {
				if (!HOLD[S.trk]) {
					return false;
				}
				holdToggle();
				toast("HOLD OFF");
				return true;
			},
			queue: () => {
				if (!QS.on) {
					return false;
				}
				QS.on = 0;
				for (let t = 0; t < 4; t++) {
					qClear(t);
				}
				saveQS();
				toast("QUEUE OFF");
				return true;
			},
			strip: () => {
				if (MOD.t === 0) {
					return false;
				}
				MOD.t = 0;
				try {
					localStorage.setItem("mellow-mod", "0");
				} catch (x) {
					/* nothing to do */
				}
				setBend(0);
				toast("STRIP: PITCH BEND");
				return true;
			},
		},
		HOLDACT = {
			rec: () => {
				if (SET.open) {
					closeSettings();
				}
				S.dlg = null;
				S.pop = null;
				S.screen = "pp";
				S.ppMode = "rec";
				S.ppPage = 0;
				return true;
			},
		}; /* HOLD REC: the recording settings (the GLO recording rows) on the display; REC itself is not pressed */
	const BTNDEF = 45,
		view = document.createElement("div"),
		strip = document.createElement("div"),
		dots = document.createElement("div");
	view.className = "mview";
	strip.className = "mpages";
	dots.className = "mdots";
	dots.setAttribute("aria-hidden", "true");
	let bpage = UI.bp;
	btnPageSet = (n, now) => {
		bpage = ((n % PAGES.length) + PAGES.length) % PAGES.length;
		UI.bp = bpage;
		if (now) {
			strip.classList.add("jump");
		}
		strip.style.transform = "translateY(" + (-bpage * 100) / PAGES.length + "%)";
		if (now) {
			void strip.offsetHeight;
			strip.classList.remove("jump");
		}
		[...dots.children].forEach((d, i) => d.classList.toggle("on", i === bpage));
		[...strip.children].forEach((pg, i) =>
			pg.setAttribute(
				"aria-hidden",
				String(
					i !== bpage &&
						!DESK.matches &&
						!window.matchMedia("(max-width:760px) and (orientation:portrait)").matches,
				),
			),
		);
	};
	const goPage = (d) => {
		btnPageSet(bpage + d);
		saveUI();
		try {
			navigator.vibrate && navigator.vibrate(5);
		} catch (e) {
			/* nothing to do */
		}
	};
	const BTNPG = {};
	PAGES.forEach((pg, pi) => {
		const row = document.createElement("div");
		row.className = "mpage";
		strip.appendChild(row);
		dots.appendChild(document.createElement("i"));
		pg.forEach(([id, lab], bi) => {
			const b = document.createElement("button");
			b.className =
				"mbtn" +
				(id === "rec" ? " rec" : "") +
				(lab.length > 5 ? " m" + Math.min(8, lab.length) : "");
			b.textContent = lab;
			b.dataset.b = id;
			b.setAttribute("aria-label", id === "play" ? "Play or stop" : lab);
			BTNPG[id] = pi;
			let ps = null; /* the finger that is down on this button: {id,x,y,tm,lp,fired,swiped,long} */
			const clr = () => {
				if (ps) {
					clearTimeout(ps.tm);
					clearTimeout(ps.lt);
				}
			};
			const commit = () => {
				if (!ps || ps.fired || ps.swiped) {
					return;
				}
				ps.fired = true;
				clearTimeout(ps.tm);
				press(id, 1);
			};
			b.addEventListener("pointerdown", (e) => {
				e.preventDefault();
				clr();
				b.classList.add("down");
				try {
					navigator.vibrate && navigator.vibrate(6);
				} catch (x) {
					/* nothing to do */
				}
				try {
					b.setPointerCapture(e.pointerId);
				} catch (x) {
					/* nothing to do */
				}
				const q = {
					id: e.pointerId,
					x: e.clientX,
					y: e.clientY,
					fired: false,
					swiped: false,
					tm: 0,
					lt: 0,
				};
				ps = q;
				if (HOLDOFF[id] || HOLDACT[id]) {
					/* a mode button: a tap presses when it lifts; a hold of 0.35 s turns the mode off instead (REC: opens the recording settings) */
					q.lt = setTimeout(() => {
						if (ps !== q || q.fired || q.swiped) {
							return;
						}
						q.fired = true;
						let did = false;
						try {
							did = (HOLDOFF[id] || HOLDACT[id])();
						} catch (x) {
							/* nothing to do */
						}
						if (did) {
							try {
								navigator.vibrate && navigator.vibrate(12);
							} catch (x) {
								/* nothing to do */
							}
							b.classList.add("flash");
							setTimeout(() => b.classList.remove("flash"), 220);
						}
					}, HOLDMS);
				} else {
					q.tm = setTimeout(commit, BTNDEF);
				}
			});
			b.addEventListener("pointermove", (e) => {
				if (!ps || e.pointerId !== ps.id || ps.swiped || ps.fired || DESK.matches) {
					return;
				}

				/* a vertical swipe turns the page only in the paged carousel (landscape phones, portrait tablets); on the cloud it only cancels the press (a swipe never presses) */ const dy =
						e.clientY - ps.y,
					dx = e.clientX - ps.x;
				if (Math.abs(dy) >= 7 && Math.abs(dy) > 1.2 * Math.abs(dx)) {
					ps.swiped = true;
					clr();
					b.classList.remove("down");
					if (!CLOUD.matches) {
						goPage(dy < 0 ? 1 : -1);
					}
				}
			});
			b.addEventListener("pointerup", (e) => {
				b.classList.remove("down");
				if (!ps || e.pointerId !== ps.id) {
					return;
				}
				const q = ps;
				ps = null;
				clearTimeout(q.tm);
				clearTimeout(q.lt);
				if (q.swiped) {
					return;
				}
				if (!q.fired) {
					press(id, 1);
				}
			});
			["pointercancel", "pointerleave"].forEach((ev) =>
				b.addEventListener(ev, (e) => {
					b.classList.remove("down");
					if (ps && e.pointerId === ps.id) {
						clr();
						ps = null;
					}
				}),
			);
			row.appendChild(b);
			if (id !== "octdn" && id !== "octup") {
				mobBtns[id] = b;
			}
		});
	});
	DESK.addEventListener && DESK.addEventListener("change", () => btnPageSet(bpage, true));
	view.appendChild(strip);
	grid.appendChild(view);
	grid.appendChild(dots);
	btnPageSet(bpage, true);
	window.__mellow.btnGo = (k) => {
		const pg = PAGES.findIndex((r) => r.some(([id, lab]) => id === k || lab === k));
		if (pg >= 0) {
			btnPageSet(pg, true);
		}
	}; /* test hook: flip to the page a button is on */
	mobEl.appendChild(grid);
	const kb = document.createElement("div");
	kb.className = "mkb";
	kb.innerHTML =
		'<div class="mkbtop"><button id="mk-l" aria-label="Keys lower"><i class="tri"></i></button><span id="mk-r" aria-label="Mod strip: slide to modulate (the STRIP button chooses what it controls)"><i class="mid"></i><i class="thumb"></i><b id="mod-l">PITCH</b></span><button id="mk-h" aria-label="Keys higher"><i class="tri"></i></button></div><div class="mkeys" id="mkeys"></div>';
	mobEl.appendChild(kb);
	const shift = (d) => {
		mobStart = clamp(mobStart + d, 0, WH.length - MVIS);
		buildKeys();
	};
	kb.querySelector("#mk-l").addEventListener("pointerdown", (e) => {
		e.preventDefault();
		shift(-3);
	});
	kb.querySelector("#mk-h").addEventListener("pointerdown", (e) => {
		e.preventDefault();
		shift(3);
	});
	// PROTOTYPE ONLY: the mod strip (see modStripInit)
	modStripInit(kb.querySelector("#mk-r"));
}

const LAND = window.matchMedia(
	"(orientation:landscape) and (max-height:600px) and (max-width:1000px)",
);

function fitKeys() {
	deskFit();
	if (DESK.matches) {
		document.getElementById("mk-l").style.display = document.getElementById("mk-h").style.display =
			"none";
		if (MVIS !== 16 || mobStart !== 0) {
			MVIS = 16;
			mobStart = 0;
			buildKeys();
		}
		return;
	} /* desktop: every key of the FM-1 (F3-G5), no arrows */
	const kb = document.querySelector(".mkb");
	if (!kb || !kb.clientWidth) {
		return;
	}
	const avail = kb.clientWidth - 16 - (LAND.matches ? 104 : 0);
	const v = clamp(Math.floor(avail / 36), 7, 16);
	const full = v >= 16;
	document.getElementById("mk-l").style.display = document.getElementById("mk-h").style.display =
		full ? "none" : "";
	if (v !== MVIS || (full && mobStart !== clamp(mobStart, 0, WH.length - v))) {
		MVIS = v;
		mobStart = clamp(mobStart, 0, WH.length - MVIS);
		buildKeys();
	}
}

let fitT = null;

const refit = () => {
	clearTimeout(fitT);
	fitT = setTimeout(fitKeys, 120);
};

window.addEventListener("resize", refit);

window.addEventListener("orientationchange", refit);

function buildKeys() {
	const box = document.getElementById("mkeys");
	mobKeys.forEach(([el, kind, i]) => {
		if (heldK[kind + i]) {
			keyOff(kind, i);
		}
	});
	box.innerHTML = "";
	mobKeys = [];
	const W = 100 / MVIS;
	for (let wi = mobStart; wi < mobStart + MVIS; wi++) {
		const k = document.createElement("button");
		k.className = "mk white";
		k.style.left = (wi - mobStart) * W + "%";
		k.style.width = W + "%";
		k.textContent = note(WH[wi]);
		k.setAttribute("aria-label", note(WH[wi]));
		bindMobKey(k, "w", wi);
		box.appendChild(k);
		mobKeys.push([k, "w", wi]);
	}
	BL.forEach((m, j) => {
		const wi = WH.indexOf(m - 1);
		if (wi < mobStart || wi >= mobStart + MVIS - 1) {
			return;
		}
		const k = document.createElement("button");
		k.className = "mk black";
		k.style.width = W * 0.62 + "%";
		k.style.left = (wi + 1 - mobStart) * W - W * 0.31 + "%";
		k.textContent = BLL[j];
		k.setAttribute("aria-label", BLL[j] || note(m));
		bindMobKey(k, "b", j);
		box.appendChild(k);
		mobKeys.push([k, "b", j]);
	});
	document.getElementById("mk-r").dataset.range =
		note(WH[mobStart]) + " – " + note(WH[mobStart + MVIS - 1]);
}

function bindMobKey(k, kind, i) {
	let sx = 0,
		sy = 0,
		st = 0,
		mode = "",
		tq = 0,
		qt = 0,
		relDone = true,
		relT = 0,
		deferT = 0,
		started = false,
		isDown = false,
		qy = 0,
		qb = 0;
	const id = kind + i;
	// the swipe-right's hold is also a pitch bend: from where the finger was when the swipe was recognised, up or down moves it (6 px dead zone, then +-2 semitones over about 54 px more), the value at lift is kept
	const bendStart = (e) => {
		qy = e.clientY;
		qb = 0;
		delete k.dataset.lv;
		delete k.dataset.ld;
	};
	const bendMove = (e) => {
		if (!bendMel(qt)) {
			return;
		}
		const dy = qy - e.clientY,
			d = Math.abs(dy) < 6 ? 0 : dy - Math.sign(dy) * 6,
			b = clamp(Math.round((d / 54) * BEND_MAX), -BEND_MAX, BEND_MAX);
		if (b === qb) {
			return;
		}
		qb = b;
		if (b) {
			k.dataset.lv = bendSt(b).replace(" ST", "");
			k.dataset.ld = b > 0 ? "u" : "d";
		} else {
			delete k.dataset.lv;
			delete k.dataset.ld;
		}
		pop("BEND", b ? bendSt(b) : "0.0 ST", (b + BEND_MAX) / (2 * BEND_MAX));
	}; /* the LCD's pop-up shows it live too */
	// a press lets go of this track's held note, but a moment later (or when you lift, or flick up to hold a new one): if the press turns
	// out to be a swipe-right queue, the held note keeps sounding and fades into the queue instead
	const relHeld = () => {
		clearTimeout(relT);
		if (!relDone) {
			relDone = true;
			releaseLatch(qt);
		}
	};
	// While you are queuing (a queue mode other than NORMAL, a queue still waiting or playing, or one used in the last 8 s) the press is held back for up to
	// 100 ms to see whether it is a swipe-right: if it is, the note is queued silently and was never sounded; if not, it sounds at that point.
	const startNote = () => {
		if (started) {
			return;
		}
		started = true;
		clearTimeout(deferT);
		keyOn(kind, i, true);
	};
	k.addEventListener("pointerdown", (e) => {
		e.preventDefault();
		sx = e.clientX;
		sy = e.clientY;
		st = e.timeStamp;
		mode = "";
		qt = S.trk;
		relDone = false;
		started = false;
		isDown = true;
		clearTimeout(relT);
		clearTimeout(deferT);
		relT = setTimeout(() => {
			if (!mode) {
				relHeld();
			}
		}, 180);
		try {
			k.setPointerCapture(e.pointerId);
		} catch (x) {
			/* nothing to do */
		}
		k.classList.add("down");
		try {
			navigator.vibrate && navigator.vibrate(4);
		} catch (x) {
			/* nothing to do */
		}
		if (deferNote()) {
			deferT = setTimeout(startNote, 100);
		} else {
			startNote();
		}
	});
	k.addEventListener("pointermove", (e) => {
		if (!isDown) {
			return;
		}
		const dx = e.clientX - sx,
			dy = e.clientY - sy;
		if (!started) {
			if (
				!mode &&
				dx >= 16 &&
				dx > 1.5 * Math.abs(dy) &&
				e.timeStamp - st <= 450 &&
				queueable() &&
				qKeyOk(kind, i)
			) {
				mode = "q";
				started = true;
				clearTimeout(deferT);
				clearTimeout(relT);
				tq = performance.now();
				latchMark.delete(id);
				k.classList.add("qhold");
				bendStart(e);
				return;
			} /* silent queue: the note was never sounded */
			if (!mode && dx <= -16 && -dx > 1.5 * Math.abs(dy) && qHas(qt, id)) {
				mode = "x";
				started = true;
				clearTimeout(deferT);
				relDone = true;
				clearTimeout(relT);
				qClear(qt);
				return;
			}
			if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
				startNote();
			} else {
				return;
			}
		}
		if (mode === "q") {
			bendMove(e);
			return;
		}
		if (!heldK[id]) {
			return;
		}

		// a quick upward slide (28 px within a third of a second) holds the key
		if (!latchMark.has(id) && sy - e.clientY >= 28 && e.timeStamp - st <= 330) {
			relHeld();
			holdKey(kind, i);
			if (latchMark.has(id)) {
				try {
					navigator.vibrate && navigator.vibrate(10);
				} catch (x) {
					/* nothing to do */
				}
			}
		}
		if (
			!mode &&
			dx >= 22 &&
			dx > 1.5 * Math.abs(dy) &&
			e.timeStamp - st <= 450 &&
			queueable() &&
			qKeyOk(kind, i)
		) {
			mode = "q";
			clearTimeout(relT);
			tq = performance.now();
			latchMark.delete(id);
			{
				const h = heldK[id] && heldK[id].rec;
				if (h) {
					recCancel(h);
				}
			}
			keyOff(kind, i);
			k.classList.add("qhold");
			bendStart(e);
		} // swipe right: queue it, and time the hold
		else if (!mode && dx <= -22 && -dx > 1.5 * Math.abs(dy) && qHas(qt, id)) {
			mode = "x";
			relDone = true;
			clearTimeout(relT);
			keyOff(kind, i);
			qClear(qt);
		}
	}); // swipe left on a queued key: cancel the queue
	["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
		k.addEventListener(ev, () => {
			if (!isDown) {
				return;
			}
			isDown = false;
			k.classList.remove("down");
			if (mode === "q") {
				mode = "";
				relDone = true;
				k.classList.remove("qhold");
				delete k.dataset.lv;
				delete k.dataset.ld;
				if (AC) {
					const h = (performance.now() - tq) / 1000,
						q = A.q[qt];
					if (h >= 0.25) {
						q.len = clamp(h, 0.25, 8);
					}
					qCommit(qt, {
						id,
						notes: keyNotes(kind, i, qt),
						dur: q.len,
						hold: false,
						bend: bendMel(qt) ? qb : 0,
					});
				}
				qb = 0;
				return;
			}
			if (mode === "x") {
				mode = "";
				return;
			}
			if (!started) {
				/* a quick tap that ended inside the 80 ms: sound it now and let it ring for a short moment */
				startNote();
				relHeld();
				const h = heldK[id];
				setTimeout(() => {
					if (heldK[id] === h) {
						keyOff(kind, i);
					}
				}, 90);
				return;
			}
			mode = "";
			relHeld();
			keyOff(kind, i);
		}),
	);
}

buildKeys();

fitKeys();

setTimeout(fitKeys, 300);

/* iOS: when the app is switched away, locked or a system gesture takes the touches, the keys never see their pointerup; let go of every key that is down so no note is left sounding (latched keys stay) */
function releaseAllKeys() {
	Object.keys(heldK).forEach((id) => {
		if (!latchMark.has(id)) {
			keyOff(id[0], +id.slice(1));
		}
	});
	mobKeys.forEach(([el]) => el.classList.remove("down"));
}

document.addEventListener("visibilitychange", () => {
	if (document.hidden) {
		releaseAllKeys();
	}
});

window.addEventListener("pagehide", releaseAllKeys);

// loop
if (document.fonts && document.fonts.ready) {
	document.fonts.ready.then(() => {
		document.querySelectorAll(".bigknob").forEach(measureLabel);
	});
}

window.addEventListener("resize", () =>
	document.querySelectorAll(".bigknob").forEach(measureLabel),
);

let last = 0;

function frame(t) {
	requestAnimationFrame(frame);
	if (t - last < 30) {
		return;
	}
	const dtf = Math.min(6, Math.max(0.5, (t - last) / 33));
	last = t; // dtf: frames are 30-35 ms apart on a good phone, longer on a busy one
	fitScreenCanvas();
	draw(bctx, t, true);
	recFlush(t);
	autoStep(performance.now());
	MOD.sprT.forEach((t) => {
		if (A.bnd[t] === 0) {
			MOD.sprT.delete(t);
			return;
		}
		if (MOD.act && t === S._trk) {
			return;
		}
		if (!aActive(stripId(0, t))) {
			setBend(Math.abs(A.bnd[t]) < 0.03 ? 0 : A.bnd[t] * Math.pow(0.55, dtf), t);
		}
	}); // a bend from the strip springs back to centre (a bend from a MIDI controller stays until the controller lets go)
	{
		const st = document.getElementById("mk-r");
		if (st) {
			const T = MODT[MOD.t],
				v = MOD.t === 0 ? (A.bend + 1) / 2 : T[2]();
			st.style.setProperty("--m", v.toFixed(3));
			const l = document.getElementById("mod-l"),
				lt =
					T[0] +
					(AUC.rec || AUC.armed
						? "  \u00b7  REC"
						: aActive(stripId(MOD.t))
							? "  \u00b7  AUTO"
							: "");
			if (l.textContent !== lt) {
				l.textContent = lt;
			}
			st.querySelector(".mid").style.display = MOD.t === 0 ? "" : "none";
		}
	}
	if (S.glob.akey) {
		const k = currentKey();
		if (k) {
			const ty = k.minor ? 1 : 0;
			if (S.scale.root !== k.root || S.scale.type !== ty) {
				S.scale.root = k.root;
				S.scale.type = ty;
			}
		}
	} // AUTO KEY: the scale follows the detected key
	if ((A.gf = (A.gf || 0) + 1) % 20 === 0) {
		const cv = document.getElementById("big"),
			r = cv.getBoundingClientRect(),
			key = Math.round(r.left) + "|" + Math.round(r.top) + "|" + Math.round(r.width);
		if (key !== A.gk2) {
			A.gk2 = key;
			applyGrid();
		}
	}
	document.body.classList.toggle("gs-seq", S.screen === "seq");
	{
		const pu = UI.grid && S.screen === "seq" ? gridPulse() : null,
			pc = pu ? String(pu.col) : "0",
			pa = pu ? (1 - pu.f) * (1 - pu.f) * 0.9 : 0,
			pas = pa.toFixed(2),
			bn = document.documentElement.style;
		if (bn._pc !== pc) {
			bn._pc = pc;
			bn.setProperty("--pc", pc);
		}
		if (bn._pa !== pas) {
			bn._pa = pas;
			bn.setProperty("--pa", pas);
		}
	}
	const ks = knobs() || [NONE, NONE, NONE, NONE];
	ks.forEach((k, i) => {
		setSlider(
			bigEls[i],
			k.n,
			k.l || "—",
			stepInfo(k),
			k.v != null && k.v !== "" && String(k.v).length <= 7 ? String(k.v) : null,
		);
		slMark(bigEls[i], "k" + i);
	});
	const cur = stepNow();
	const dv = (0.65 * (1 - S.glob.bri / 100)).toFixed(3);
	if (dimEl._v !== dv) {
		dimEl._v = dv;
		dimEl.style.opacity = dv;
	}
	{
		const q = A.q[S.trk],
			pos = {},
			bn = {};
		q.pend.forEach((x, n) => {
			(pos[x.id] = pos[x.id] || []).push(n + 1);
			if (x.bend) {
				bn[x.id] = x.bend;
			}
		});
		q.live.forEach((x) => {
			if (x.b && !bn[x.id]) {
				bn[x.id] = x.b;
			}
		});
		mobKeys.forEach(([el, kind, i]) => {
			const id = kind + i,
				p = pos[id],
				qd = !!p || q.live.some((x) => x.id === id);
			el.classList.toggle("queued", qd);
			if (qd) {
				const tx = p ? p.join(",") : "";
				if (el.dataset.q !== tx) {
					el.dataset.q = tx;
				}
			}
			const bd = qd && bn[id] ? (bn[id] > 0 ? "u" : "d") : "";
			if ((el.dataset.bd || "") !== bd) {
				if (bd) {
					el.dataset.bd = bd;
				} else {
					delete el.dataset.bd;
				}
			}
		});
	} /* a bent step: an arrow under its badge */
	mobKeys.forEach(([el, kind, i]) =>
		el.classList.toggle(
			"lit",
			latch[S.trk].ids.has(kind + i) ||
				latchMark.has(kind + i) ||
				A.q[S.trk].live.some((x) => x.id === kind + i && !x.ended) ||
				(kind === "w"
					? (S.screen === "seq" && !dgOn() && (i === cur || i === S.seq.sel)) ||
						(S.screen === "drum" && i < 8 && t - (S.padHits[i] || -1e9) < 170) ||
						(S.screen === "smp" && i === S.smp.slice)
					: blackLit(i)),
		),
	);
	{
		const beat = 60 / Math.max(30, S.bpm),
			qq = A.q[S.trk];
		for (const id in mobBtns) {
			const b = mobBtns[id],
				on = !!ledOn(id);
			b.classList.toggle("on", on);
			let cp = 0;
			if (on) {
				if (S.playing && (id === "play" || id === "seq" || id === "song" || id === "rec")) {
					cp = beat;
				} /* a lap a beat while the song runs */
				else if (S.playing && id === "arp") {
					cp = stepSec() * 4;
				} /* the arpeggio: a lap every four steps, so a changed RATE shows */
				else if (id === "queue" && (qq.pend.length || qq.live.length)) {
					cp = clamp(qq.len || 0.5, 0.15, 8);
				}
			} /* a queue is playing: a lap per queued step */
			const w = cp ? cp.toFixed(3) : "";
			if (b._cp !== w) {
				b._cp = w;
				if (cp) {
					b.style.setProperty("--cp", w + "s");
				}
				b.classList.toggle("chase", !!cp);
			}
		}
	}
	{
		scaleShare();
		const hl =
				!!S.scale.only && engOf(S.trk) !== "DRUM" && S.screen !== "drum" && S.screen !== "smp",
			kb =
				document.getElementById(
					"mkeys",
				); /* KEY: light the keys that are in the scale, dim the others */
		if (kb) {
			kb.classList.toggle("kh", hl);
			const sc = SCALES[S.scale.type][1],
				root = S.scale.root,
				tr = S.glob.gtr;
			mobKeys.forEach(([el, kind, i]) => {
				let c = "";
				if (hl) {
					const pc = ((((kind === "w" ? WH[i] : BL[i]) + tr - root) % 12) + 12) % 12;
					c =
						pc === 0
							? "sin sroot"
							: sc.includes(pc)
								? "sin"
								: S.scale.only
									? "sout sblock"
									: "sout";
				}
				if (el._sc !== c) {
					el._sc = c;
					el.classList.remove("sin", "sout", "sroot", "sblock");
					if (c) {
						c.split(" ").forEach((x) => el.classList.add(x));
					}
				}
			});
		}
	}
	if (mobDials.master) {
		setSlider(mobDials.master, S.vol / 100);
		setSlider(
			mobDials.select,
			(S.bpm - 30) / 270,
			selInfo() ? "PAGE" : "TEMPO",
			selInfo(),
			selInfo() ? null : String(S.bpm),
		);
		setSlider(mobDials.presets, 0, null, { N: PRESETS.length, i: S.preset, num: S.preset + 1 });
		{
			const en = engOf(S.trk);
			if (en === "FM") {
				setSlider(mobDials.algorithm, 0, null, { N: 32, i: S.alg - 1, num: S.alg });
			} else if (en === "ANA") {
				setSlider(mobDials.algorithm, 0, null, { N: 4, i: S.ana.w2, num: S.ana.w2 + 1 });
			} else {
				setSlider(mobDials.algorithm, 0, null, null, "");
			}
		}
		/* what ALGO turns on this track: the FM algorithm, the analog OSC 2 wave, or nothing */ for (const id in mobDials) {
			slMark(mobDials[id], id);
		}
	}
	flushMeasure();
}

S.t0 = performance.now();

requestAnimationFrame(frame);
