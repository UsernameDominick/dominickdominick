// MIDI, and the mod strip
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-unused-vars, no-undef -- offers names the other files use; uses names that live in the other files of the folder */

// ---------- MIDI (Web MIDI: desktop Chrome/Edge/Opera and Chrome on Android; Safari on iPhone has none) ----------
// In: notes play the current track (MIDI MODE OMNI) or channel CH..CH+3 = tracks 1-4 (TRACKS); CC moves the knobs. Out: every note played on a
// melodic track goes out on its channel; MIDI CLOCK OUT sends clock, start and stop while the sequencer runs. Long-press a slider, then move a
// slider on your controller: that CC is tied to that slider until you do it again.
const MIDI = {
	acc: null,
	ins: [],
	outs: [],
	err: "",
	tried: false,
	learn: null,
	map: {},
	def: { 7: "master", 1: "k0", 74: "k1", 71: "k2", 91: "k3" },
	held: {},
	eng: {},
};

try {
	const m = JSON.parse(localStorage.getItem("mellow-midi"));
	if (m && typeof m === "object") {
		MIDI.map = m;
	}
} catch (e) {
	/* nothing to do */
}

const saveMidi = () => {
	try {
		localStorage.setItem("mellow-midi", JSON.stringify(MIDI.map));
	} catch (e) {
		/* nothing to do */
	}
};

const toast = (t) => {
	S.pop = null;
	S.toast = { s: t, t: performance.now() };
};

function midiStatus() {
	return MIDI.err
		? MIDI.err
		: MIDI.acc
			? MIDI.ins.length + " IN " + MIDI.outs.length + " OUT"
			: "TAP TO START";
}

function midiWire() {
	const a = MIDI.acc;
	if (!a) {
		return;
	}
	const was = MIDI.ins.map((i) => i.id),
		now = [...a.inputs.values()];
	MIDI.ins = now;
	MIDI.outs = [...a.outputs.values()];
	MIDI.ins.forEach((i) => {
		i.onmidimessage = midiIn;
	});
	if (
		was.some((id) => {
			const i = now.find((x) => x.id === id);
			return !i || i.state === "disconnected";
		})
	) {
		/* a controller went away: its note-offs and bend release will never come */
		Object.keys(MIDI.held).forEach((k) => {
			const [t, n] = k.split(":").map(Number);
			midiNoteOff(t, n);
		});
		for (let t = 0; t < 4; t++) {
			if (!MOD.sprT.has(t) && A.bnd[t]) {
				A.fromMidi = true;
				try {
					setBend(0, t);
				} finally {
					A.fromMidi = false;
				}
			}
		}
	}
}

async function midiInit() {
	if (MIDI.tried) {
		return;
	}
	MIDI.tried = true;
	if (!navigator.requestMIDIAccess) {
		MIDI.err = "NOT SUPPORTED";
		return;
	}
	try {
		MIDI.acc = await navigator.requestMIDIAccess({ sysex: false });
		midiWire();
		MIDI.acc.onstatechange = midiWire;
	} catch (e) {
		MIDI.err = "BLOCKED";
	}
}

const midiCh = (t) => (S.glob.mmode ? (S.glob.ch - 1 + t) & 15 : (S.glob.ch - 1) & 15);

/* audio-clock time -> performance.now() time for a MIDI timestamp. getOutputTimestamp is the device clock (steady to 0.1 ms) and counts the output latency, so MIDI lands when the internal sound is heard; AC.currentTime only moves in chunks and made the timestamps jitter by several ms. */
function perfOf(w) {
	try {
		const o = AC.getOutputTimestamp && AC.getOutputTimestamp();
		if (o && o.performanceTime > 0 && o.contextTime > 0) {
			return o.performanceTime + (w - o.contextTime) * 1000;
		}
	} catch (e) {
		/* nothing to do */
	}
	return performance.now() + (w - AC.currentTime) * 1000;
}

function midiSend(bytes, whenAC, force) {
	if (!MIDI.outs.length || (!force && (S.glob.out === 3 || A.fromMidi))) {
		return;
	}
	/* force: note-offs always go out, so switching MIDI OUT off mid-note can't leave one hanging */ const ts =
		whenAC && AC && whenAC > AC.currentTime ? perfOf(whenAC) : 0;
	MIDI.outs.forEach((o) => {
		try {
			o.send(bytes, ts);
		} catch (e) {
			/* nothing to do */
		}
	});
}

// every voice noteVoice makes also goes out as MIDI, and its release does too
function midiOutVoice(t, m, vel, when, v) {
	if (S.glob.out === 3 || !MIDI.outs.length || A.fromMidi) {
		return;
	}
	const ch = midiCh(t),
		n = clamp(Math.round(m), 0, 127);
	midiSend([0x90 | ch, n, clamp(Math.round(vel * 127), 1, 127)], when);
	const o = v.off;
	v.off = function (tt) {
		if (!v._mo) {
			v._mo = 1;
			midiSend([0x80 | ch, n, 0], Math.max(tt, when + 0.001), 1);
		}
		return o.call(v, tt);
	};
	const oc = v.cut;
	if (oc) {
		v.cut = function () {
			midiSend([0x80 | ch, n, 0], 0, 1);
			return oc.call(v);
		};
	}
}

function startLearn(id) {
	ensureAudio();
	midiInit();
	if (id === "select") {
		toast("PAGE CANNOT BE TIED");
		return;
	}
	setTimeout(
		() => {
			if (MIDI.err) {
				toast(MIDI.err === "NOT SUPPORTED" ? "NO MIDI IN THIS BROWSER" : "MIDI " + MIDI.err);
				return;
			}
			if (MIDI.learn === id) {
				MIDI.learn = null;
				toast("LEARN CANCELLED");
				return;
			}
			MIDI.learn = id;
			toast("MOVE A SLIDER ON YOUR CONTROLLER");
		},
		MIDI.acc || MIDI.err ? 0 : 700,
	);
}

function slMark(d, id) {
	const cc = ccOf(id),
		b = d.querySelector("b"),
		txt = (d.dataset.lab || "") + (cc != null ? " \u00b7 CC" + cc : "");
	if (b.textContent !== txt) {
		b.textContent = txt;
		measureLater(d);
	}
	d.classList.toggle("learning", MIDI.learn === id);
}

function ccTarget(cc) {
	if (MIDI.map[cc]) {
		return MIDI.map[cc];
	}
	const d = MIDI.def[cc];
	return d && ccOf(d) == null ? d : null;
}
// the usual CCs work until you tie that slider yourself
function ccOf(id) {
	for (const k in MIDI.map) {
		if (MIDI.map[k] === id) {
			return +k;
		}
	}
	return null;
}

function midiApply(id, val) {
	// val 0..1
	ensureAudio();
	if (id === "master") {
		S.vol = Math.round(val * 100);
		pop("VOLUME", S.vol + "%", val);
		return;
	}
	if (id === "algorithm") {
		S.screen = "alg";
		S.alg = 1 + Math.round(val * 31);
		adsrFromOps();
		pop("ALGORITHM", pad(S.alg), val);
		return;
	}
	if (id === "presets") {
		loadPreset(Math.round(val * (PRESETS.length - 1)));
		return;
	}
	if (id[0] === "k") {
		const i = +id[1];
		let ks = knobs();
		if (!ks || !ks[i] || !ks[i].set) {
			return;
		}
		if (S.glob.km) {
			// KNOB PICKUP = CATCH: a CC takes over only once it reaches (or passes through) the parameter's current value, so nothing jumps
			const lab = ks[i].l,
				e =
					MIDI.eng[id] && MIDI.eng[id].l === lab
						? MIDI.eng[id]
						: (MIDI.eng[id] = { l: lab, on: false, last: null }),
				n = ks[i].n;
			if (!e.on) {
				const hit = Math.abs(val - n) <= 0.06 || (e.last != null && (e.last - n) * (val - n) <= 0);
				e.last = val;
				if (!hit) {
					return;
				}
				e.on = true;
			}
		}
		for (let it = 0; it < 3; it++) {
			ks = knobs();
			const k = ks[i],
				d = Math.round((val - k.n) * (k.r || 100));
			if (!d) {
				break;
			}
			k.set(d);
		}
		const k = knobs()[i];
		S.hot = { c: i, t: now() };
		pop(k.l, k.v, k.n);
	}
}

function midiIn(ev) {
	const d = ev.data;
	if (!d || d.length < 1) {
		return;
	}
	const st = d[0];
	if (st >= 0xf8) {
		if (st === 0xfc || st === 0xff) {
			/* nothing to do */
			/* transport stop from a DAW: let go of everything */
		}
		return;
	}
	const type = st & 0xf0,
		ch = st & 0x0f;
	let trk = S.trk;
	if (S.glob.mmode) {
		trk = (ch - (S.glob.ch - 1) + 16) & 15;
		if (trk > 3) {
			return;
		}
	}
	if (type === 0x90 && d[2] > 0) {
		midiNoteOn(trk, d[1], d[2] / 127);
	} else if (type === 0x80 || (type === 0x90 && d[2] === 0)) {
		midiNoteOff(trk, d[1]);
	} else if (type === 0xe0) {
		MOD.sprT.delete(trk);
		A.fromMidi = true;
		try {
			setBend((((d[2] << 7) | d[1]) - 8192) / 8192, trk);
		} finally {
			A.fromMidi = false;
		}
	} else if (type === 0xb0) {
		const cc = d[1],
			v = d[2];
		if (cc === 123 || cc === 120) {
			kbqFlush();
			for (const k in MIDI.held) {
				midiNoteOff(+k.split(":")[0], +k.split(":")[1]);
			}
			return;
		}
		if (MIDI.learn) {
			const id = MIDI.learn;
			MIDI.learn = null;
			for (const k in MIDI.map) {
				if (MIDI.map[k] === id || +k === cc) {
					delete MIDI.map[k];
				}
			}
			MIDI.map[cc] = id;
			saveMidi();
			toast(
				"CC " +
					cc +
					" TIED TO " +
					((id[0] === "k" ? (knobs()[+id[1]] || {}).l : id.toUpperCase()) || id),
			);
			return;
		}
		const id = ccTarget(cc);
		if (id) {
			midiApply(id, v / 127);
		}
	}
}

function midiNoteOn(trk, n, vel) {
	ensureAudio();
	if (!AC) {
		return;
	}
	wake();
	if (trk === S.trk && kbqUse("midi")) {
		kbqMidi(n);
		return;
	}
	A.fromMidi = true;
	try {
		const key = trk + ":" + n;
		if (MIDI.held[key]) {
			midiNoteOff(trk, n);
		}
		const e = engOf(trk);
		if (e !== "DRUM") {
			heardNote(n);
		}
		if (TK(trk).arp.on) {
			const set = A.arps[trk];
			if (
				TK(trk).arp.latch &&
				!Object.keys(MIDI.held).some((k) => MIDI.held[k].arp && +k.split(":")[0] === trk)
			) {
				set.clear();
			} /* LATCH: a new chord replaces the old one, as with the keys */
			set.add(n);
			MIDI.held[key] = { arp: true };
			return;
		}
		const v = noteVoice(trk, n, Math.max(0.25, vel), 0);
		if (v) {
			v.pin = true;
		}
		MIDI.held[key] = { v };
		if (e !== "DRUM" && e !== "SMP" && trk === S.trk) {
			const h = recNote(n, vel);
			if (h) {
				recVoice(h, v);
			}
		}
	} finally {
		A.fromMidi = false;
	}
}

function midiNoteOff(trk, n) {
	kbqUp("m" + n);
	const ks = S.glob.mmode
		? [trk + ":" + n]
		: Object.keys(MIDI.held).filter(
				(k) => +k.split(":")[1] === n,
			); /* OMNI: the controller has one key per note, whatever track is selected now */
	ks.forEach((key) => {
		const h = MIDI.held[key];
		if (!h) {
			return;
		}
		delete MIDI.held[key];
		const t = +key.split(":")[0];
		if (h.arp) {
			if (!TK(t).arp.latch) {
				A.arps[t].delete(n);
			}
			return;
		}
		if (h.v) {
			h.v.pin = false;
		}
		if (h.v && h.v.off && !h.v.done && AC) {
			h.v.off(AC.currentTime + 0.01);
		}
	});
}

// MIDI clock: 24 pulses per beat from the sequencer's start, scheduled ahead like the notes
function midiClockTick(ct) {
	if (!MIDI.outs.length) {
		return;
	}
	if (!S.glob.mclk || S.glob.out === 3 || !S.playing) {
		if (A.mcOn) {
			A.mcOn = false;
			MIDI.outs.forEach((o) => {
				try {
					o.send([0xfc]);
				} catch (e) {
					/* nothing to do */
				}
			});
		}
		return;
	}
	if (!A.mcOn) {
		A.mcOn = true;
		A.mcT = A.t0;
		midiSend([0xfa], A.t0);
	}
	let n = 0;
	while (A.mcT < ct + A.la && n++ < 12) {
		midiSend([0xf8], A.mcT);
		A.mcT += 60 / S.bpm / 24;
	}
}

// ---------- the mod strip: pitch bend by default, or anything from the list (hold the strip to choose) ----------
// Pitch bend uses the stock PITCH UP / DOWN ranges (GLO, in semitones) and is also what MIDI pitch bend does, in and out, so the strip stands
// in for a bend wheel. The other targets move an ordinary parameter. Touch anywhere on the strip and slide: it moves from where you touched.
const MODT = [
	["PITCH"],
	["MOOD", (v) => (S.mac[0] = Math.round(v * 127)), () => S.mac[0] / 127],
	["WARMTH", (v) => (S.mac[1] = Math.round(v * 127)), () => S.mac[1] / 127],
	["SPACE", (v) => (S.mac[2] = Math.round(v * 127)), () => S.mac[2] / 127],
	["DRIFT", (v) => (S.mac[3] = Math.round(v * 127)), () => S.mac[3] / 127],
	["CUTOFF", (v) => (S.fx.cut = Math.round(v * 127)), () => S.fx.cut / 127],
	["RESO", (v) => (S.fx.res = Math.round(v * 99)), () => S.fx.res / 99],
	["REVERB", (v) => (S.fx.rmix = Math.round(v * 100)), () => S.fx.rmix / 100],
	["ECHO", (v) => (S.fx.emix = Math.round(v * 100)), () => S.fx.emix / 100],
	["VIBRATO", (v) => (S.lfo.pm = Math.round(v * 99)), () => S.lfo.pm / 99],
	["TREMOLO", (v) => (S.lfo.am = Math.round(v * 99)), () => S.lfo.am / 99],
	["VOLUME", (v) => (S.tracks[S._trk].vol = Math.round(v * 100)), () => S.tracks[S._trk].vol / 100],
];

const MOD = { t: 0, down: false, act: false, sprT: new Set() };

try {
	const t = +localStorage.getItem("mellow-mod");
	if (Number.isInteger(t) && t >= 0 && t < MODT.length) {
		MOD.t = t;
	}
} catch (e) {
	/* nothing to do */
}
/* a whole number: 1.5 used to index the target list at a hole and throw on every frame */
// ---------- automation ----------
// An automation is the recorded movement of ONE parameter (any value on the screen: a strip target, a knob, a graph point) over 1 to 16 bars, 64
// samples a bar, stored by the parameter's address (`S.auto['fx|cut']`). It plays LOOP (endlessly) or TAP (once each time you tap the strip), and
// it either FOLLOWS THE SONG (its length laid along the song's position, so bar 5 is always bar 5; silent while stopped) or runs on its own FREE clock.
// Two ways to record: arm RECORD in the strip popup and move the strip (any length, any time), or switch on RECORD AUTOMATION (SETTINGS) and move
// any knob, graph or the strip while recording: the movement is written at the song position, pass after pass.
// The player wins: a parameter you touch is yours until 0.35 s after your last move (or until you let go of the strip), then it snaps back.
S.auto = {};
