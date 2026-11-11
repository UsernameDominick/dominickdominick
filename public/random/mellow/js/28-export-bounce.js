// export and import, bounce to audio and MIDI
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-unused-vars, no-undef -- offers names the other files use; uses names that live in the other files of the folder */

// ---------- bounce to audio / MIDI (PROTOTYPE ONLY) ----------
// BOUNCE plays the pattern (or the whole song) from the start, in real time, and records the master output, then adds a short tail for the reverb and echo.
// The result is a WAV (16-bit stereo) or a MIDI file of the notes, each wrapped in a ZIP (the artifact viewer only saves a short list of file types, and wav and mid
// are not on it). The metronome is switched off while bouncing. PLAY cancels. On the device this would be USB audio or a MIDI file.
const BNC = { on: false, last: null, info: null };

function crc32(u8) {
	let c,
		crc = -1;
	if (!crc32.t) {
		crc32.t = [];
		for (let n = 0; n < 256; n++) {
			c = n;
			for (let k = 0; k < 8; k++) {
				c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			}
			crc32.t[n] = c >>> 0;
		}
	}
	for (let i = 0; i < u8.length; i++) {
		crc = crc32.t[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
	}
	return (crc ^ -1) >>> 0;
}

function zipStore(files) {
	const enc = new TextEncoder(),
		parts = [],
		cd = [];
	let off = 0;
	const u16 = (n) => [n & 255, (n >> 8) & 255],
		u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
	files.forEach((f) => {
		const nm = enc.encode(f.name),
			crc = crc32(f.data),
			sz = f.data.length;
		const lh = new Uint8Array([
			0x50,
			0x4b,
			3,
			4,
			...u16(20),
			...u16(0),
			...u16(0),
			...u16(0),
			...u16(33),
			...u32(crc),
			...u32(sz),
			...u32(sz),
			...u16(nm.length),
			...u16(0),
		]);
		parts.push(lh, nm, f.data);
		cd.push(
			new Uint8Array([
				0x50,
				0x4b,
				1,
				2,
				...u16(20),
				...u16(20),
				...u16(0),
				...u16(0),
				...u16(0),
				...u16(33),
				...u32(crc),
				...u32(sz),
				...u32(sz),
				...u16(nm.length),
				...u16(0),
				...u16(0),
				...u16(0),
				...u16(0),
				...u32(0),
				...u32(off),
			]),
			nm,
		);
		off += lh.length + nm.length + sz;
	});
	const cdSize = cd.reduce((n, x) => n + x.length, 0),
		end = new Uint8Array([
			0x50,
			0x4b,
			5,
			6,
			...u16(0),
			...u16(0),
			...u16(files.length),
			...u16(files.length),
			...u32(cdSize),
			...u32(off),
			...u16(0),
		]);
	const all = [...parts, ...cd, end],
		out = new Uint8Array(all.reduce((n, x) => n + x.length, 0));
	let o = 0;
	all.forEach((x) => {
		out.set(x, o);
		o += x.length;
	});
	return out;
}

function wavBytes(L, R, sr) {
	const n = L.length,
		out = new Uint8Array(44 + n * 4),
		dv = new DataView(out.buffer);
	const w = (o, t) => {
		for (let i = 0; i < t.length; i++) {
			out[o + i] = t.charCodeAt(i);
		}
	};
	w(0, "RIFF");
	dv.setUint32(4, 36 + n * 4, true);
	w(8, "WAVE");
	w(12, "fmt ");
	dv.setUint32(16, 16, true);
	dv.setUint16(20, 1, true);
	dv.setUint16(22, 2, true);
	dv.setUint32(24, sr, true);
	dv.setUint32(28, sr * 4, true);
	dv.setUint16(32, 4, true);
	dv.setUint16(34, 16, true);
	w(36, "data");
	dv.setUint32(40, n * 4, true);
	for (let i = 0; i < n; i++) {
		dv.setInt16(44 + i * 4, Math.round(clamp(L[i], -1, 1) * 32767), true);
		dv.setInt16(46 + i * 4, Math.round(clamp(R[i], -1, 1) * 32767), true);
	}
	return out;
}

// the passes the song (or the pattern) plays: [{pat, steps}] in order
function bouncePasses(kind) {
	if (kind === "song") {
		const out = [];
		songChain().forEach((e) => {
			const L = S.plen[e.pat];
			for (let r = 0; r < e.rep; r++) {
				out.push({ pat: e.pat, mute: SGM(e), dmute: SGDM(e), steps: SPB() * L });
			}
		});
		return out;
	} /* a slot lasts its pattern's own length (songAdvance), whatever a track's own length is: a longer track is cut off there, a shorter one loops inside it */ // mute: the slot's muted tracks (the MIDI file leaves them out; the audio bounce plays through the scheduler, which already honours them)
	return [
		{ pat: S.pat, steps: SPB() * Math.max(S.plen[S.pat], ...S.tl[S.pat].map((x) => x || 0)) },
	];
}

function bounceCancel() {
	if (BNC.on && BNC.finish) {
		BNC.finish(false);
	}
}

// the notes as a standard MIDI file (format 1: a tempo track and one track per Mellow track)
function midiFileBytes(kind) {
	const PPQ = 96,
		tps = PPQ / [2, 4, 8][S.rate],
		passes = bouncePasses(kind),
		ev = [[], [], [], []],
		push = (a, b) => a.push(...b);
	const vlq = (n) => {
			const b = [n & 127];
			while ((n >>= 7)) {
				b.unshift((n & 127) | 128);
			}
			return b;
		},
		str = (t) => [...new TextEncoder().encode(t)];
	let base = 0;
	passes.forEach((ps) => {
		for (let t = 0; t < 4; t++) {
			if (((ps.mute | 0) >> t) & 1) {
				continue;
			}
			const q = S.pats[ps.pat][t],
				len = SPB() * (S.tl[ps.pat][t] || S.plen[ps.pat]),
				en = engOf(t),
				ch = en === "DRUM" || en === "SMP" ? 9 : Math.min(t, 8);
			if (t === DT) {
				dgMidiEv(ev[t], base, ps.steps, len, ps.pat, tps, ps.dmute | 0);
				continue;
			}
			for (let j = 0; j < ps.steps; j++) {
				const i = j % len,
					n = q.st[i];
				if (n < 0) {
					continue;
				}
				const on = Math.round((base + j) * tps),
					dur = Math.max(1, Math.round(((q.gate[i] / 100) * tps * S.sgate) / 100));
				ev[t].push(
					{
						k: on,
						o: 1,
						b: [0x90 | ch, clamp(n, 0, 127), clamp(Math.round(q.vel[i] || 100), 1, 127)],
					},
					{ k: on + dur, o: 0, b: [0x80 | ch, clamp(n, 0, 127), 0] },
				);
			}
		}
		base += ps.steps;
	});
	const trk = (evs, pre) => {
		evs.sort((a, b) => a.k - b.k || a.o - b.o);
		const d = [...pre];
		let last = 0;
		evs.forEach((e) => {
			d.push(...vlq(e.k - last), ...e.b);
			last = e.k;
		});
		d.push(0, 0xff, 0x2f, 0);
		const h = [
			0x4d,
			0x54,
			0x72,
			0x6b,
			(d.length >>> 24) & 255,
			(d.length >> 16) & 255,
			(d.length >> 8) & 255,
			d.length & 255,
		];
		return [...h, ...d];
	};
	const mpq = Math.round(60e6 / S.bpm),
		tn = TSIGS[S.ts],
		dd = Math.round(Math.log2(tn[1]));
	const tempo = [
		0,
		0xff,
		0x58,
		4,
		tn[0],
		dd,
		24,
		8,
		0,
		0xff,
		0x51,
		3,
		(mpq >> 16) & 255,
		(mpq >> 8) & 255,
		mpq & 255,
		0,
		0xff,
		0x03,
		...(() => {
			const n = str("MELLOW");
			return [n.length, ...n];
		})(),
	];
	const out = [
		0x4d,
		0x54,
		0x68,
		0x64,
		0,
		0,
		0,
		6,
		0,
		1,
		0,
		5,
		PPQ >> 8,
		PPQ & 255,
		...trk([], tempo),
	];
	for (let t = 0; t < 4; t++) {
		const nm = str("T" + (t + 1) + " " + ENGN[engOf(t)]);
		out.push(...trk(ev[t], [0, 0xff, 0x03, nm.length, ...nm]));
	}
	return { bytes: new Uint8Array(out), notes: ev.reduce((n, a) => n + a.length / 2, 0) };
}

async function saveFile(file, st) {
	// through the viewer's downloads capability inside the artifact, a plain download link elsewhere
	let dl = null;
	try {
		dl = null;
	} catch (e) {
		/* nothing to do */
	}
	if (dl) {
		try {
			await dl.save({ filename: file.filename, data: file.data });
			st && st("SAVED " + file.filename);
			return true;
		} catch (e) {
			st && st(e && e.code === "declined" ? "Cancelled." : "The viewer could not save the file.");
			return false;
		}
	}
	try {
		const a = document.createElement("a");
		a.href = URL.createObjectURL(new Blob([file.data], { type: "application/zip" }));
		a.download = file.filename;
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			URL.revokeObjectURL(a.href);
			a.remove();
		}, 500);
		st && st("DOWNLOADING " + file.filename);
		return true;
	} catch (e) {
		st && st("Downloads are blocked here.");
		return false;
	}
}

function openShare() {
	let m = document.getElementById("share");
	if (!m) {
		m = document.createElement("div");
		m.id = "share";
		m.className = "sheet";
		m.style.zIndex = 75;
		m.hidden = true;
		document.body.appendChild(m);
		m.innerHTML =
			'<div class="sh"><button class="ti" disabled style="flex:1">EXPORT, IMPORT, BOUNCE</button><button class="x" aria-label="Close">✕</button></div><div class="sb"><div class="sc">EXPORT</div>' +
			'<div class="sr bt" id="shDl"><span>DOWNLOAD THE PROJECT FILE</span><span class="v">SAVE</span></div><div class="sr bt" id="shCp"><span>COPY THE PROJECT AS TEXT</span><span class="v">COPY</span></div>' +
			'<div class="sc">BOUNCE (PLAYS IT IN REAL TIME AND RECORDS IT)</div><div class="sr bt" id="shBp"><span>BOUNCE THE PATTERN TO AUDIO</span><span class="v">GO</span></div><div class="sr bt" id="shBs"><span>BOUNCE THE SONG TO AUDIO</span><span class="v">GO</span></div><div class="sr bt" id="shMid"><span>THE SONG AS A MIDI FILE</span><span class="v">SAVE</span></div><div class="sr bt" id="shSv"><span>SAVE THE LAST BOUNCE</span><span class="v">SAVE</span></div>' +
			'<div class="sc">IMPORT</div><div class="sr bt" id="shFile"><span>CHOOSE A PROJECT FILE</span><span class="v">OPEN</span></div><div class="sr bt" id="shTxt"><span>IMPORT THE TEXT BELOW</span><span class="v">IMPORT</span></div>' +
			'<textarea id="shArea" spellcheck="false" placeholder="A project shows here when you export it. To import by text, paste a project here and tap IMPORT THE TEXT BELOW."></textarea><div class="st" id="shSt"></div></div><button class="sdone">DONE</button>';
		const st = (t) => {
				m.querySelector("#shSt").textContent = t;
			},
			area = m.querySelector("#shArea");
		const tap = (id, fn) => {
			const el = m.querySelector(id);
			let x0 = 0,
				mv = false;
			el.addEventListener("pointerdown", (e) => {
				x0 = e.clientX;
				mv = false;
			});
			el.addEventListener("pointermove", (e) => {
				if (Math.abs(e.clientX - x0) > 8) {
					mv = true;
				}
			});
			el.addEventListener("pointerup", () => {
				if (!mv) {
					fn();
				}
			});
		};
		m.querySelector(".x").addEventListener("pointerdown", (e) => {
			e.preventDefault();
			m.hidden = true;
		});
		m.querySelector(".sdone").addEventListener("pointerdown", (e) => {
			e.preventDefault();
			m.hidden = true;
		});
		tap("#shDl", async () => {
			const t = projectJSON();
			area.value = t;
			const kb = Math.round(t.length / 1024);
			let dl = null;
			try {
				dl = null;
			} catch (e) {
				/* nothing to do */
			}
			if (dl) {
				try {
					await dl.save({ filename: "mellow-project.json", data: t });
					st("SAVED " + kb + " KB");
				} catch (e) {
					st(
						e && e.code === "declined"
							? "Cancelled. The project is in the box below if you want to copy it."
							: "The viewer could not save a file: copy the text below instead.",
					);
				}
				return;
			}
			try {
				const a = document.createElement("a");
				a.href = URL.createObjectURL(new Blob([t], { type: "application/json" }));
				a.download = "mellow-project.json";
				document.body.appendChild(a);
				a.click();
				setTimeout(() => {
					URL.revokeObjectURL(a.href);
					a.remove();
				}, 500);
				st("EXPORTED " + kb + " KB. If nothing was saved, copy the text below instead.");
			} catch (e) {
				st("Downloads are blocked here: copy the text below instead.");
			}
		});
		tap("#shCp", () => {
			const t = projectJSON();
			area.value = t;
			let done = false;
			try {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(t).then(
						() => st("COPIED " + Math.round(t.length / 1024) + " KB"),
						() => st("Select the text below and copy it."),
					);
					done = true;
				}
			} catch (e) {
				/* nothing to do */
			}
			if (!done) {
				area.focus();
				area.select();
				try {
					document.execCommand("copy") ? st("COPIED") : st("Select the text below and copy it.");
				} catch (e) {
					st("Select the text below and copy it.");
				}
			}
		});
		tap("#shFile", () => {
			const f = document.createElement("input");
			f.type = "file";
			f.accept = ".json,application/json,text/plain";
			f.onchange = () => {
				const file = f.files && f.files[0];
				if (!file) {
					return;
				}
				const r = new FileReader();
				r.onload = () => {
					area.value = String(r.result).slice(0, 2e6);
					st(importProject(String(r.result)));
				};
				r.readAsText(file);
			};
			f.click();
		});
		tap("#shTxt", () => st(importProject(area.value)));
		tap("#shBp", () => {
			m.hidden = true;
			bounceStart("pattern");
		});
		tap("#shBs", () => {
			m.hidden = true;
			bounceStart("song");
		});
		tap("#shMid", () => {
			const r = midiFileBytes(S.song.on && songChain().length ? "song" : "pattern");
			BNC.last = {
				filename: "mellow-midi.zip",
				data: zipStore([{ name: "mellow.mid", data: r.bytes }]),
				secs: 0,
				kind: "midi",
				notes: r.notes,
			};
			st(r.notes ? r.notes + " notes in the MIDI file." : "There are no notes to export.");
			if (r.notes) {
				saveFile(BNC.last, st);
			}
		});
		tap("#shSv", () => {
			if (!BNC.last) {
				st("Nothing bounced yet.");
				return;
			}
			saveFile(BNC.last, st);
		});
	}
	m.hidden = false;
	m.querySelector("#shSt").textContent =
		"The project file holds the patterns, song, lengths, time signature, tempo, track sounds and your saved presets.";
}

const KB = {
	a: ["w", 4],
	s: ["w", 5],
	d: ["w", 6],
	f: ["w", 7],
	g: ["w", 8],
	h: ["w", 9],
	j: ["w", 10],
	k: ["w", 11],
	l: ["w", 12],
	";": ["w", 13],
	w: ["b", 3],
	e: ["b", 4],
	t: ["b", 5],
	y: ["b", 6],
	u: ["b", 7],
	o: ["b", 8],
	p: ["b", 9],
};

document.addEventListener("keydown", (e) => {
	if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) {
		return;
	}
	const k = KB[e.key.toLowerCase()];
	if (!k) {
		return;
	}
	e.preventDefault();
	const m = mobKeys.find((x) => x[1] === k[0] && x[2] === k[1]);
	m && m[0].classList.add("down");
	kbHeld.add(k[0] + k[1]);
	keyOn(k[0], k[1]);
});

const kbHeld = new Set();
/* keys pressed on the computer keyboard */
/* KEYBOARD TO QUEUE (QUEUE popup: QS.kb 0 OFF, 1 MIDI, 2 QWERTY, 3 BOTH; PROTOTYPE ONLY for QWERTY, MIDI is device-possible). With it on for a source, its notes are queued on the selected track instead of sounding:
   key down to key up is the step length (as a swipe's hold: 0.25 s or more is that note's own length, a quick press lasts as long as WAIT), keys down within CHORD_S of the first one are ONE chord step
   (up to 6 notes), then qCommit does the rest (SYNC, MODE, 16 steps, badges). Needs QUEUE ON and ARP off like a swipe, else the keys play normally (one toast per cause). ESC clears the track's queue. */
const KBQ = { g: null, warn: "", all: new Map() };

const kbqOn = (src) => QS.kb === 3 || QS.kb === (src === "midi" ? 1 : 2);

function kbqUse(src) {
	if (!kbqOn(src)) {
		return false;
	}
	ensureAudio();
	if (!AC) {
		return false;
	}
	wake();
	if (queueable()) {
		KBQ.warn = "";
		return true;
	}
	const w = !QS.on ? "QUEUE IS OFF" : S.arp.on ? "ARP IS ON" : "NO QUEUE HERE";
	if (KBQ.warn !== w) {
		KBQ.warn = w;
		toast(w + ": KEYS PLAY NORMALLY");
	}
	return false;
}

function kbqDown(key, trk, notes, id) {
	kbqUp(key);
	const now = performance.now();
	let G = KBQ.g;
	if (!(G && G.trk === trk && !G.c && now - G.t0 <= CHORD_S * 1000)) {
		G = KBQ.g = { trk, t0: now, notes: [], ids: [], open: 0, h: 0, c: 0, tm: 0 };
	}
	notes.forEach((n) => {
		if (!G.notes.includes(n) && G.notes.length < 6) {
			G.notes.push(n);
		}
	});
	if (!G.ids.includes(id)) {
		G.ids.push(id);
	}
	G.open++;
	clearTimeout(G.tm);
	KBQ.all.set(key, { G, t: now });
}

function kbqUp(key) {
	const r = KBQ.all.get(key);
	if (!r) {
		return false;
	}
	KBQ.all.delete(key);
	const G = r.G;
	G.h = Math.max(G.h, (performance.now() - r.t) / 1000);
	if (--G.open > 0) {
		return true;
	} /* the step is committed when its last key is up, and not before CHORD_S after its first, so a second key can still join */
	G.tm = setTimeout(
		() => {
			if (G.open > 0 || G.c) {
				return;
			}
			G.c = 1;
			if (KBQ.g === G) {
				KBQ.g = null;
			}
			kbqCommit(G);
		},
		Math.max(0, G.t0 + CHORD_S * 1000 - performance.now()),
	);
	return true;
}

function kbqCommit(G) {
	if (!AC || !QS.on || S.arp.on) {
		return;
	}
	const it = {
		id: G.ids[0],
		notes: G.notes.slice().sort((a, b) => a - b),
		dur: G.h >= 0.25 ? clamp(G.h, 0.25, 8) : QS.wait, // a hold is that note's own length; a quick press lasts as long as WAIT
		hold: false,
		kb: true,
	};
	if (G.ids.length > 1) {
		it.ids = G.ids.slice();
	}
	qCommit(G.trk, it);
}

function kbqFlush() {
	[...KBQ.all.keys()].forEach(kbqUp);
}

function kbqMidi(n) {
	const en = engOf(S.trk),
		pad = en === "DRUM" || en === "SMP";
	let id = "m" + n,
		note = clamp(n, 24, 108);
	if (pad) {
		const p = padOf(n);
		note = 36 + p;
		id = "w" + p;
	} else {
		const w = WH.indexOf(n - S.oct * 12 - S.glob.gtr),
			b = BL.indexOf(n - S.oct * 12 - S.glob.gtr);
		id = w >= 0 ? "w" + w : b >= 0 ? "b" + b : id;
	} /* the badge goes on the on-screen key with that note, if there is one */
	kbqDown("m" + n, S.trk, [note], id);
}

const kbTyping = () => {
	const a = document.activeElement;
	return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
};

/* capture listeners, ahead of the key handler below: they take the note keys only when queuing, and leave them alone while a text field has focus */
document.addEventListener(
	"keydown",
	(e) => {
		if (e.ctrlKey || e.metaKey || e.altKey) {
			return;
		}
		if (e.key === "Escape") {
			if (QS.kb && !SET.open && !kbTyping() && AC) {
				const q = A.q[S.trk];
				if (qBusy(S.trk) || q.log.length) {
					qClear(S.trk);
					toast("QUEUE CLEARED");
				}
			}
			return;
		}
		const k = KB[e.key.toLowerCase()];
		if (!k) {
			return;
		}
		if (kbTyping()) {
			e.stopImmediatePropagation();
			return;
		}
		const key = "k" + k[0] + k[1];
		if (e.repeat) {
			if (KBQ.all.has(key)) {
				e.preventDefault();
				e.stopImmediatePropagation();
			}
			return;
		}
		if (!kbqOn("qwerty") || !qKeyOk(k[0], k[1]) || !kbqUse("qwerty")) {
			return;
		}
		e.preventDefault();
		e.stopImmediatePropagation();
		const m = mobKeys.find((x) => x[1] === k[0] && x[2] === k[1]);
		m && flash(m[0]);
		kbqDown(key, S.trk, keyNotes(k[0], k[1]), k[0] + k[1]);
	},
	true,
);

document.addEventListener(
	"keyup",
	(e) => {
		const k = KB[e.key.toLowerCase()];
		if (k && kbqUp("k" + k[0] + k[1])) {
			e.stopImmediatePropagation();
		}
	},
	true,
);

window.addEventListener("blur", kbqFlush);

document.addEventListener("keyup", (e) => {
	const k = KB[e.key.toLowerCase()];
	if (k) {
		const m = mobKeys.find((x) => x[1] === k[0] && x[2] === k[1]);
		m && m[0].classList.remove("down");
		kbHeld.delete(k[0] + k[1]);
		keyOff(k[0], k[1]);
	}
});

window.addEventListener("blur", () => {
	kbHeld.forEach((id) => {
		if (heldK[id] && !latchMark.has(id)) {
			keyOff(id[0], +id.slice(1));
		}
	});
	kbHeld.clear();
});
/* a keyup that goes to another window must not leave a computer-keyboard note stuck (touch presses are not tracked here) */
const releaseTouched = () => Object.keys(heldK).forEach((id) => keyOff(id[0], +id.slice(1)));

document.addEventListener("visibilitychange", () => {
	if (document.hidden) {
		releaseTouched();
	}
});

window.addEventListener("pagehide", releaseTouched);
