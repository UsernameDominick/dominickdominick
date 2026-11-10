// the interactive device: the page, canvas, knobs and button strip
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-unused-vars, no-undef -- offers names the other files use; uses names that live in the other files of the folder */

// ---------- interactive device ----------
const big = document.getElementById("big"),
	dimEl = document.getElementById("dim"),
	bctx = big.getContext("2d");

// the LCD canvas is sized to how big it is on screen (a whole multiple of its 240 px, so blocks stay crisp and text is sharp)
function fitScreenCanvas() {
	const w = big.getBoundingClientRect().width || 240,
		k = clamp(
			Math.ceil((w * (window.devicePixelRatio || 1)) / 240 - 0.02),
			1,
			document.documentElement.style.getPropertyValue("--pw") ? 8 : 5,
		),
		n = 240 * k;
	if (big.width !== n) {
		big.width = big.height = n;
	}
}

window.addEventListener("resize", fitScreenCanvas);

if (document.fonts && document.fonts.load) {
	document.fonts.load('600 12px "Work Sans"');
}

if (document.fonts && document.fonts.addEventListener) {
	document.fonts.addEventListener("loadingdone", () => TWC.clear());
}
/* widths measured before the face was ready must not stay cached */
// big knobs under the screen
const bigWrap = document.getElementById("bigknobs"),
	bigEls = [];

function mkSlider(host, aria, label) {
	const d = document.createElement("div");
	d.className = "bigknob";
	d.tabIndex = 0;
	d.setAttribute("role", "slider");
	d.setAttribute("aria-label", aria);
	d.dataset.lab = label;
	d.innerHTML =
		'<i class="kn"><i class="arc"></i><i class="ptr"></i></i><span class="pct"></span><b>' +
		label +
		"</b>";
	host.appendChild(d);
	measureLabel(d);
	return d;
}

function measureLabel(d) {
	const b = d.querySelector("b");
	d.style.setProperty("--lw", b.offsetWidth + "px");
}

/* label changes made while a frame updates the sliders are measured together afterwards (one layout, not one per slider) */
const measureQ = new Set();

function measureLater(d) {
	measureQ.add(d);
}

function flushMeasure() {
	if (!measureQ.size) {
		return;
	}
	const L = [...measureQ].map((d) => [d, d.querySelector("b").offsetWidth]);
	measureQ.clear();
	L.forEach(([d, w]) => d.style.setProperty("--lw", w + "px"));
}

// st = {N,i} for a control with a set number of options: the fill snaps to the current stop and "option/options" (3/6) is shown instead of a percentage
// what the PAGE encoder is stepping through on this screen (null: it is the tempo, a percentage)
function selInfo() {
	const sc = S.screen;
	if (sc === "pp") {
		const n = ppPages().length;
		return n > 1
			? { N: n, i: clamp(S.ppPage, 0, n - 1), num: clamp(S.ppPage, 0, n - 1) + 1 }
			: null;
	}
	if (sc === "mix" || sc === "home") {
		return { N: 4, i: S.trk, num: S.trk + 1 };
	}
	if (sc === "presets") {
		return { N: CATS.length, i: S.pcat, num: S.pcat + 1 };
	}
	if (sc === "arp" || sc === "gen") {
		return {
			N: 2,
			i: (sc === "arp" ? S.arp.on : S.gen.on) ? 1 : 0,
			num: (sc === "arp" ? S.arp.on : S.gen.on) ? 2 : 1,
		};
	}
	if (sc === "wt") {
		return { N: WTN.length, i: S.wt.tab | 0, num: (S.wt.tab | 0) + 1 };
	}
	if (sc === "ana") {
		return { N: 4, i: S.ana.w1, num: S.ana.w1 + 1 };
	}
	if (sc === "song") {
		return { N: 2, i: S.song.on ? 1 : 0, num: S.song.on ? 2 : 1 };
	}
	if (sc === "seq") {
		return { N: 5, i: S.seqPage, num: S.seqPage + 1 };
	}
	if (sc === "global") {
		return { N: GROWS.length, i: S.glob.sel, num: S.glob.sel + 1 };
	}
	return null;
}

function stepInfo(k) {
	return k && k.st > 1 ? { N: k.st, i: clamp(k.si, 0, k.st - 1), num: k.sn } : null;
}

function setSlider(d, n, label, st, txt) {
	if (st) {
		n = st.i / (st.N - 1);
		d.style.setProperty("--stops", st.N);
	}
	n = clamp(n, 0, 1);
	d.classList.toggle("stepped", !!st);
	d.style.setProperty("--v", (n * 100).toFixed(1));
	const p = d.querySelector(".pct"),
		t =
			label === "—"
				? ""
				: st
					? st.i + 1 + "/" + st.N
					: txt != null
						? txt
						: Math.round(n * 100) + "%";
	/* an unused slider shows nothing */ if (p.textContent !== t) {
		p.textContent = t;
	}
	{
		const an = Math.round(n * 100) + "|" + t;
		if (d._an !== an) {
			d._an = an;
			d.setAttribute("aria-valuemin", "0");
			d.setAttribute("aria-valuemax", "100");
			d.setAttribute("aria-valuenow", String(Math.round(n * 100)));
			d.setAttribute("aria-valuetext", t || "unused");
		}
	} /* a slider role needs its value for screen readers (the site's accessibility check) */
	if (label != null && d.dataset.lab !== label) {
		d.dataset.lab = label;
		d.querySelector("b").textContent = label;
		measureLater(d);
	}
}

for (let i = 0; i < 4; i++) {
	const d = mkSlider(bigWrap, "Slider " + (i + 1), "KNOB" + (i + 1));
	bigEls.push(d);
	bindSlider(
		d,
		(dd) => turn("k" + i, dd),
		() => rangeFor("k" + i),
		() => resetDial("k" + i),
		() => startLearn("k" + i),
	);
}

// How many steps the knob can take, so a flick sweeps the range once and a slow drag stays fine.
function rangeFor(id) {
	if (id === "select" && S.screen === "wt") {
		return WTN.length;
	}
	if (id === "master") {
		return 100;
	}
	if (id === "algorithm") {
		return 24;
	} // a wrapping dial: a flick must not come all the way round to where it started
	if (id === "presets") {
		return plist().length || PRESETS.length;
	}
	if (id === "select") {
		return S.screen === "song"
			? 2
			: S.screen === "seq"
				? 5
				: S.screen === "pp"
					? ppPages().length
					: S.screen === "presets"
						? CATS.length
						: S.screen === "mix" || S.screen === "home"
							? 4
							: 270;
	}
	const i = +id[1],
		ks = knobs();
	return (ks && ks[i] && ks[i].r) || 100;
}

// PROTOTYPE ONLY: the phone's knobs. Drag up or down (sideways works too): 80 px of travel sweeps the range once, and
// a slow drag is about 3x finer. A tap nudges by one (left half down, right half up); a double-tap resets to the default.
// They send the same steps the device's encoders do (turn), so nothing here needs new hardware.
function bindSlider(elm, fn, rangeFn, resetFn, learnFn) {
	let sx = null,
		lx = 0,
		ly = 0,
		pos = 0,
		hist = [],
		acc = 0,
		tot = 0,
		moved = false,
		lastTap = 0,
		timer = 0,
		pressed = false;
	elm.addEventListener("pointerdown", (e) => {
		pressed = false;
		clearTimeout(timer);
		if (learnFn) {
			timer = setTimeout(() => {
				if (sx != null && !moved) {
					pressed = true;
					try {
						navigator.requestMIDIAccess && navigator.vibrate && navigator.vibrate(12);
					} catch (x) {
						/* nothing to do */
					}
					learnFn();
				}
			}, 550);
		}
		sx = lx = e.clientX;
		ly = e.clientY;
		pos = 0;
		hist = [[e.timeStamp, 0]];
		acc = 0;
		tot = 0;
		moved = false;
		try {
			elm.setPointerCapture(e.pointerId);
		} catch (x) {
			/* nothing to do */
		}
		e.preventDefault();
	});
	elm.addEventListener("pointermove", (e) => {
		if (sx == null) {
			return;
		}
		const mx = e.clientX - lx,
			my = e.clientY - ly;
		lx = e.clientX;
		ly = e.clientY;
		const dx = Math.abs(my) >= Math.abs(mx) ? -my : mx;
		tot += Math.abs(mx) + Math.abs(my);
		if (tot > 6) {
			moved = true;
			clearTimeout(timer);
		} /* up (or right) turns the knob up: whichever way the finger moves more */
		pos += dx;
		hist.push([e.timeStamp, pos]);
		while (hist.length > 2 && e.timeStamp - hist[0][0] > 90) {
			hist.shift();
		}
		const sp = Math.abs(pos - hist[0][1]) / Math.max(24, e.timeStamp - hist[0][0]);
		const R = Math.max(4, (rangeFn && rangeFn()) || 100),
			W = 80,
			f = 0.33 + 0.67 * Math.min(1, Math.max(0, (sp - 0.04) / 0.2));
		acc += ((dx * f * R) / W) * 1.2;
		const st = Math.trunc(acc);
		if (!st) {
			return;
		}
		acc -= st;
		fn(st);
	});
	const end = (e) => {
		clearTimeout(timer);
		if (sx == null) {
			return;
		}
		if (pressed) {
			pressed = false;
			sx = null;
			lastTap = 0;
			return;
		} // a long press only started MIDI learn
		if (!moved) {
			const t = e.timeStamp;
			let did = false;
			if (resetFn && lastTap && t - lastTap < 350) {
				lastTap = 0;
				did = resetFn() !== false;
			}
			if (!did) {
				lastTap = t;
				const r = elm.getBoundingClientRect();
				fn(e.clientX < r.left + r.width / 2 ? -1 : 1);
			}
		} else {
			lastTap = 0;
		}
		sx = null;
	};
	elm.addEventListener("pointerup", end);
	elm.addEventListener("pointercancel", () => (sx = null));
	let wh = 0; /* mouse wheel: one step per notch, a trackpad's small deltas add up to a step */
	elm.addEventListener(
		"wheel",
		(e) => {
			e.preventDefault();
			const w = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
			if (!w) {
				return;
			}
			if (Math.abs(w) >= 48) {
				wh = 0;
				fn(w < 0 ? 1 : -1);
			} else {
				if (wh * w < 0) {
					wh = 0;
				}
				wh += w;
				if (Math.abs(wh) >= 48) {
					fn(wh < 0 ? 1 : -1);
					wh = 0;
				}
			}
		},
		{ passive: false },
	);
	elm.addEventListener("keydown", (e) => {
		if (e.key === "ArrowUp" || e.key === "ArrowRight") {
			fn(1);
			e.preventDefault();
		}
		if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
			fn(-1);
			e.preventDefault();
		}
	});
}

function flash(b) {
	b.classList.add("down");
	setTimeout(() => b.classList.remove("down"), 130);
}

const now = () => performance.now();

function pop(l, v, n) {
	S.pop = { l, v, n, t: now() };
}

function loadPreset(i) {
	if (S.trk === DT && PRESETS[wrap(i, PRESETS.length)][2] !== "DRUM") {
		dgRefuse();
		return;
	}
	S.preset = wrap(i, PRESETS.length);
	applyPreset(S.preset);
	if (engOf(S.trk) === "FM") {
		adsrFromOps();
	}
}

function setEng(t, d) {
	if (t === DT) {
		dgRefuse();
		return;
	}
	const ne = ENGS[wrap(ENGS.indexOf(engOf(t)) + d, ENGS.length)];
	S.tracks[t].pre = PRESETS.findIndex((p) => p[2] === ne);
	const p = PRESETS[S.tracks[t].pre];
	applyPreset(S.tracks[t].pre);
	pop("T" + (t + 1) + " ENGINE", ENGN[ne], ENGS.indexOf(ne) / 4);
}

function turn0(id, d) {
	if (id === "select" && S.screen === "wt") {
		S.wt.tab = wrap((S.wt.tab | 0) + d, WTN.length);
		pop("TABLE", WTN[S.wt.tab], S.wt.tab / (WTN.length - 1));
		return;
	} // on a wavetable track PAGE picks the table, as it picks OSC 1 on an analog one
	if (S.screen === "boot") {
		S.screen = "home";
	}
	if (id === "master") {
		S.vol = clamp(S.vol + d * 2, 0, 100);
		pop("VOLUME", S.vol + "%", S.vol / 100);
		return;
	}
	if (id === "select") {
		if (S.screen === "song") {
			songSetOn(d > 0);
		} else if (S.screen === "seq") {
			S.seqPage = clamp(S.seqPage + d, 0, 4);
		} else if (S.screen === "pp") {
			S.ppPage = clamp(S.ppPage + d, 0, ppPages().length - 1);
		} else if (S.screen === "mix" || S.screen === "home") {
			S.trk = wrap(S.trk + d, 4);
			pop("TRACK", "T" + (S.trk + 1) + " " + ENGN[engOf(S.trk)], S.trk / 3);
		} else if (S.screen === "arp") {
			S.arp.on = d > 0;
			if (!S.arp.on) {
				A.arpSet.clear();
			}
		} else if (S.screen === "gen") {
			S.gen.on = d > 0;
			S.gen.t0 = performance.now();
			A.gk = 0;
			if (AC) {
				A.gA = AC.currentTime;
			}
		} else if (S.screen === "presets") {
			S.pcat = wrap(S.pcat + d, CATS.length);
		} else if (S.screen === "ana") {
			S.ana.w1 = wrap(S.ana.w1 + d, 4);
			pop("OSC 1", SHP[S.ana.w1], S.ana.w1 / 3);
		} else if (S.screen === "global") {
			S.glob.sel = clamp(S.glob.sel + d, 0, GROWS.length - 1);
		} else {
			S.bpm = clamp(S.bpm + d, 30, 300);
			pop("TEMPO", S.bpm + " BPM", (S.bpm - 30) / 270);
		}
		return;
	}
	if (id === "presets") {
		if (S.screen !== "presets") {
			S.screen = "presets";
		} else {
			stepPreset(d);
		}
		return;
	}
	if (id === "algorithm" && engOf(S.trk) === "ANA") {
		S.ana.w2 = wrap(S.ana.w2 + d, 4);
		if (S.screen !== "ana") {
			S.screen = "ana";
		}
		pop("OSC 2", SHP[S.ana.w2], S.ana.w2 / 3);
		return;
	}
	if (id === "algorithm" && engOf(S.trk) !== "FM") {
		S.pop = null;
		S.toast = { s: "ALGORITHM: FM TRACKS ONLY", t: now() };
		return;
	}
	if (id === "algorithm") {
		S.screen = "alg";
		S.alg = wrap(S.alg - 1 + d, 32) + 1;
		adsrFromOps();
		return;
	}
	const i = +id[1];
	const ks = knobs();
	if (!ks || !ks[i] || !ks[i].set) {
		return;
	}
	ks[i].set(d);
	if (S.dlgDone) {
		S.dlgDone = false;
		return;
	}
	aNote(ks[i]);
	const k = knobs()[i];
	S.hot = { c: i, t: now(), d: Math.sign(d) };
	if (S.screen !== "pp") {
		pop(k.l, k.v, k.n);
	} /* on a parameter page the cell lights up and shows the value itself */
}

function press0old(id) {
	if (S.screen === "boot" && id !== "play" && id !== "rec") {
		S.screen = "home";
	}
	if (id === "play") {
		S.playing = !S.playing;
		S.t0 = now();
		return;
	}
	if (id === "rec") {
		if (S.screen === "smp") {
			return;
		}
		if (!S.seqEn && !S.rec) {
			S.pop = null;
			S.toast = { s: "ENABLE SEQ FIRST: PRESS SEQ", t: now() };
			return;
		}
		S.rec = !S.rec;
		if (!S.rec) {
			recCloseAll();
		}
		return;
	}
	if (id === "seq" && S.screen === "seq") {
		S.seqPage = (S.seqPage + 1) % 5;
		return;
	}
	if (id === "octup" && S.screen === "seq" && S.clr) {
		doClear();
		return;
	}
	if (id === "octdn" && S.screen === "seq" && S.clr) {
		S.clr = 0;
		return;
	}
	if (id === "octdn") {
		if (S.screen === "save") {
			S.screen = "home";
			return;
		}
		S.oct = clamp(S.oct - 1, -3, 3);
		pop("OCTAVE", (S.oct > 0 ? "+" : "") + S.oct, (S.oct + 3) / 6);
		return;
	}
	if (id === "octup") {
		if (S.screen === "save") {
			savePreset();
			S.screen = "home";
			return;
		}
		S.oct = clamp(S.oct + 1, -3, 3);
		pop("OCTAVE", (S.oct > 0 ? "+" : "") + S.oct, (S.oct + 3) / 6);
		return;
	}
	if (id === "env" && S.screen === "env") {
		S.envPage ^= 1;
		return;
	}
	if (id === "fx" && S.screen === "fx") {
		S.fx.slot = (S.fx.slot + 1) % 4;
		return;
	}
	if (id === "op") {
		if (S.screen === "op") {
			S.screen = "alg";
			return;
		}
		if (S.screen === "alg") {
			S.screen = "op";
			return;
		}
		S.screen = ENGSCR[engOf(S.trk)];
		return;
	}
	if (id === "global") {
		S.screen = S.screen === "mix" ? "global" : "mix";
		return;
	}
	if (id === "arp" && S.screen === "arp") {
		S.screen = "gen";
		return;
	}
	S.screen = id;
}

// gallery

// ---------- audio ----------
// FM voices run on the DX7 core port (dx7.js): 12 voices, 64-sample blocks. Everything else is Web Audio.
let AC = null;
