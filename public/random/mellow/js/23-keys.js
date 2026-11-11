// the keys: playing, holding, latching, hold
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---------- keys ----------
const heldK = {};

function chordNotes(m) {
	const sc = SCALES[S.scale.type][1],
		root = S.scale.root,
		c = S.scale.chord;
	if (c === 0) {
		return [m];
	}
	const rel = (((m - root) % 12) + 12) % 12,
		base = m - rel;
	let idx = 0,
		best = 99;
	sc.forEach((x, i) => {
		const dd = Math.abs(x - rel);
		if (dd < best) {
			best = dd;
			idx = i;
		}
	});
	if (sc[0] + 12 - rel < best) {
		idx = sc.length;
	} /* the root of the next octave can be the nearest note (PENTA, B -> C) */
	const n = sc.length,
		at = (k) => base + sc[(idx + k) % n] + 12 * Math.floor((idx + k) / n);
	if (c === 1) {
		return [at(0)];
	}
	const deg = c === 2 ? [0, 2, 4] : c === 3 ? [0, 2, 4, 6] : [0, 3, 4],
		sp = S.scale.spread;
	return deg.map((k, j) => at(k) + (sp >= 2 && j === 1 ? 12 : 0) + (sp >= 3 && j === 2 ? 12 : 0));
}

function stepDefault(i) {
	const en = engOf(S.trk);
	return en === "DRUM" ? 36 : en === "SMP" ? 36 + Math.min(i, 7) : WH[i] + 12;
}

function stepOn(j, on) {
	const q = S.seq;
	if (on) {
		if (q.st[j] < 0) {
			q.st[j] = newPitch(j);
		}
		if (!q.vel[j]) {
			q.vel[j] = 100;
		}
		if (!q.gate[j]) {
			q.gate[j] = 50;
		}
	} else {
		if (q.st[j] >= 0) {
			S.ghost = { j, v: q.vel[j] || 100, t: performance.now() };
		}
		q.st[j] = -1;
	}
}

function stepTap(i) {
	const q = S.seq;
	i = clamp(snapIdx(i), 0, nstT() - 1);
	if (q.sel === i) {
		undoPush("STEP");
		stepOn(i, q.st[i] < 0);
	}
	q.sel = i;
	if (AC && q.st[i] >= 0) {
		stepPlay(S.trk, i, AC.currentTime);
	}
}

function keyOn(kind, i, keep) {
	// keep: the touch keys let go of a held note a moment later, in case this press turns into a queue swipe
	ensureAudio();
	wake();
	const id = kind + i;
	latchMark.delete(id);
	if (!keep) {
		releaseLatch(S.trk);
	}
	if (HOLD[S.trk]) {
		holdDrop(S.trk, id);
	}
	if (heldK[id]) {
		keyOff(kind, i);
	} // a missed release must not leave the old note stuck
	if (kind === "w") {
		if (qsSaved()) {
			if (i < 12) {
				qsKey(i);
			}
			return;
		} /* the SAVED QUEUES page: white keys 1-12 pick a saved queue (they do not sound) */
		if (S.screen === "song" && nestFocus()) {
			nestKey(i);
			return;
		} /* the selected slot is dropped down: white keys 1-4 mute T1-T4, 5-8 colour T1-T4, 9 adds the chosen automation, 10 deletes the chosen one, 11 moves it between this slot and the whole song (none chosen: closes it) */
		if (S.screen === "song") {
			if (i < 4) {
				songToggleMute(S.song.sel, i);
			} else if (i === 4) {
				songJump(S.song.sel);
			} else if (i <= 9) {
				songClip(NCH[i - 5].k);
			} else if (i === 10) {
				nestToggle(S.song.sel);
			}
			return;
		} /* 6-9 COPY PASTE INSERT DELETE, 10 SLOT / PATTERN, 11 drops the slot down */ /* the song screen: white keys 1-4 mute or unmute T1-T4 in the selected slot, key 5 plays the selected slot next */
		if (S.screen === "seq" && S.seqPage === 2 && !S.rec) {
			if (dgOn()) {
				dgKey(i);
				return;
			}
			if (i < SPB()) {
				stepTap(seqViewBar() * SPB() + i);
			}
			return;
		}
		if (S.screen === "drum" && i < 8) {
			S.drum.sel = i;
			S.padHits[i] = performance.now();
		}
		if (S.screen === "smp" && i < 8) {
			S.smp.slice = i;
		}
	} else {
		if (S.screen === "pp" && ["edit", "pit", "voice"].includes(S.ppMode)) {
			if (i < 6) {
				S.op = i;
				if (S.ppMode !== "edit") {
					S.ppMode = "edit";
					S.ppPage = 0;
				}
				return;
			}
			if (i === 6) {
				S.ppMode = "pit";
				S.ppPage = 0;
				return;
			}
			if (i === 7) {
				S.ppMode = "voice";
				S.ppPage = 0;
				return;
			}
			if (i === 8 || i === 9) {
				S.mono = i === 8;
				pop("VOICE", S.mono ? "MONO" : "POLY", S.mono ? 0 : 1);
				return;
			}
		}
		if (i < 6 && S.screen === "alg") {
			S.op = i;
			return;
		}
	}
	if (keyBlocked(kind, i)) {
		return;
	}
	S.hits.push(performance.now());
	if (S.hits.length > 6) {
		S.hits.shift();
	}
	if (!AC) {
		return;
	}
	const en = engOf(S.trk),
		vs = [];
	A.down++;
	if (A.down === 1 && S.arp.on) {
		A.arpSet.clear();
	}
	const kv = keyVel();
	if (en === "DRUM") {
		if (kind === "w" && i < 8) {
			drumHit(S.trk, i, kv, AC.currentTime);
			S.padHits[i] = performance.now();
			const h = recNote(36 + i, kv);
			if (h) {
				vs.rec = h;
			}
		}
	} else if (en === "SMP" && S.screen === "smp" && kind === "w" && i < 8) {
		vs.push(sampVoice(S.trk, i, 60, kv, AC.currentTime));
		{
			const h = recAt(S.trk, 36 + i, kv, AC.currentTime, 1, 1);
			if (h) {
				vs.rec = h;
			}
		}
	} /* a sampler pad records like a drum pad: the slice is the note (36+pad), a one-shot, so its length does not matter; a swipe-right on it cancels the press' record like any key's */
	else {
		const m = (kind === "w" ? WH[i] : BL[i]) + S.oct * 12 + S.glob.gtr,
			ns = chordNotes(m);
		heardNote(ns[0]);
		lastPlayed = { m, t: performance.now() };
		if (S.arp.on) {
			ns.forEach((n) => A.arpSet.add(n));
			A.arpKeys[id] = ns;
		} else {
			ns.forEach((n) => {
				const v = noteVoice(S.trk, n, kv, 0);
				if (v) {
					vs.push(v);
				}
			});
			{
				const h = recNote(en === "SMP" ? 36 + S.smp.slice : ns[0], kv);
				if (h) {
					vs.rec = h;
					recVoice(h, vs.find(Boolean));
				}
			}
		}
	}
	vs.forEach((v) => {
		if (v) {
			v.pin = true;
		}
	}); /* a key that is down is never trimmed from the voice list */
	vs.trk = S.trk;
	heldK[id] = vs;
}

// PROTOTYPE ONLY: press a key and flick up to hold it; it sounds until you play another key. The real FM-1's keys
// are plain on/off switches with no slide, so this is a phone gesture, not firmware (stock ARP has its own LATCH).
// Each track holds its own latched notes: hold a note on track 1, go to track 2 and play, come back to track 1 and playing a key there lets go of its held note.
const latch = [0, 1, 2, 3].map(() => ({ ids: new Set(), vs: [], arp: [], by: new Map() })),
	latchMark = new Set();

// HOLD (the button on the piano page; a sustain pedal for the phone): while it is on for a track, a key that lets go keeps sounding (for every engine, and with the arp the
// notes stay in the arpeggio). Held keys pile up (a chord can be built one note at a time) until HOLD is turned off, KILL, or the same key is played again, which
// replaces its own note. At most HOLDMAX keys are held per track (the oldest lets go first), and the engines' own voice caps still apply. Mock-only, like the flick-up hold.
const HOLD = [0, 0, 0, 0],
	HOLDMAX = 6;

const holdable = (t) => engOf(t) !== "DRUM" && !(S.screen === "smp" && engOf(t) === "SMP");

function holdDrop(t, id) {
	const L = latch[t],
		vs = L.by.get(id);
	if (!vs) {
		return;
	}
	L.by.delete(id);
	L.ids.delete(id);
	vs.forEach((v) => {
		if (!v) {
			return;
		}
		v.pin = false;
		const k = L.vs.indexOf(v);
		if (k >= 0) {
			L.vs.splice(k, 1);
		}
		if (AC && v.off && !v.done) {
			v.off(AC.currentTime + 0.01);
		}
	});
}

function holdToggle() {
	const t = S.trk;
	HOLD[t] ^= 1;
	if (!HOLD[t]) {
		releaseLatch(t, false, true);
	}
	if (AC) {
		audioSync();
	}
	return HOLD[t];
}

function holdKey(kind, i) {
	if (engOf(S.trk) === "DRUM" || (S.screen === "smp" && engOf(S.trk) === "SMP")) {
		return;
	}
	latchMark.add(kind + i);
}

function releaseLatch(t, instant, force) {
	if (HOLD[t] && !force) {
		return;
	} /* with HOLD on a key press or a queue start does not let the held keys go */
	const L = latch[t];
	if (AC) {
		L.vs.forEach((v) => {
			if (v) {
				v.pin = false;
				if (v.off && !v.done) {
					/* HOLD OVERLAP: the held note keeps sounding for a while after the next key (FM releases by note number, so a key playing the same note lets go at once) */
					const same =
						v.note != null &&
						Object.keys(heldK).some(
							(id) =>
								heldK[id].trk === t &&
								heldK[id].some &&
								heldK[id].some((x) => x && x.note === v.note),
						);
					v.off(AC.currentTime + 0.01 + (instant || same ? 0 : QS.tail));
				}
			}
		});
	}
	if (!S.arp.latch) {
		L.arp.forEach((n) => {
			if (
				!Object.keys(A.arpKeys).some(
					(id) => heldK[id] && heldK[id].trk === t && A.arpKeys[id].includes(n),
				)
			) {
				A.arps[t].delete(n);
			}
		});
	}
	L.ids.clear();
	L.vs.length = 0;
	L.arp.length = 0;
	L.by.clear();
}

function keyOff(kind, i) {
	const id = kind + i,
		vs = heldK[id];
	if (!vs) {
		return;
	}
	delete heldK[id];
	const lt = latchMark.delete(id),
		t = vs.trk == null ? S.trk : vs.trk,
		ph = !!HOLD[t] && holdable(t);
	vs.forEach((v) => {
		if (v) {
			v.pin = false;
		}
	});
	if (A.arpKeys[id]) {
		const ns = A.arpKeys[id];
		if (lt || ph) {
			latch[t].arp.push(...ns);
		} else if (!S.arp.latch) {
			ns.forEach((n) => A.arps[t].delete(n));
		}
		delete A.arpKeys[id];
	}
	A.down = Math.max(0, A.down - 1);
	if (vs.rec && !lt && !ph && AC) {
		recClose(vs.rec, AC.currentTime);
	}
	if (lt && AC && qBusy(t) && A.q[t].pend.length < QMAX) {
		if (vs.rec) {
			recCancel(vs.rec);
		}
		vs.forEach((v) => v && v.off && !v.done && v.off(AC.currentTime + 0.01));
		qAdd(t, { id, notes: keyNotes(kind, i, t), hold: true });
		return;
	} /* the press that became the queue's last held step is not recorded as a note of its own: the queue records the step */
	if (lt || ph) {
		const L = latch[t];
		if (L.by.has(id)) {
			holdDrop(t, id);
		}
		L.ids.add(id);
		vs.forEach((v) => {
			if (v) {
				v.pin = true;
			}
		});
		L.vs.push(...vs);
		L.by.set(id, vs);
		while (ph && L.by.size > HOLDMAX) {
			holdDrop(t, L.by.keys().next().value);
		}
		return;
	}
	if (AC) {
		vs.forEach((v) => v && v.off && !v.done && v.off(AC.currentTime + 0.01));
	}
}

// PROTOTYPE ONLY: the swipe-right queue. Press a key and swipe right: instead of sounding it you queue it. Keep your finger down after the
// swipe (a quarter of a second or more) and that hold is how long that one note sounds; it does not change the notes after it.
// A quick flick always gets the default step length (half a second), so you can queue fast. Up to 16 notes per track. They play one after another, starting at once
// (the first when you let go, each next one right after the one before). Swipe left on any queued key to cancel the whole queue. A swipe-up
// hold while a queue is waiting becomes its last step: it starts when the queue ends and stays held. Each track has its own queue.
const QMAX = 16,
	CHORD_S = 0.15;

// PITCH BEND of a queued step: while the finger is still down after a swipe-right, moving it up or down bends that step (one signed byte, 1/8 semitone a unit, +-16 = +-2 semitones over about 60 px;
// the value when the finger lifts is kept). It rides in the queued item (`bend`), its log entry (`b`) and saved queues (`b`, absent = 0). Melodic steps only (FM, analog, wavetable: `v.bend`).
const BEND_MAX = 16,
	bendSt = (b) => (b > 0 ? "+" : b < 0 ? "-" : "") + (Math.abs(b) / 8).toFixed(1) + " ST",
	bendMel = (t) => {
		const e = engOf(t);
		return e === "FM" || e === "ANA" || e === "WAVE";
	};

const keyNotes = (kind, i, t) => {
	const e = engOf(t == null ? S.trk : t);
	return e === "DRUM" || e === "SMP"
		? [36 + i]
		: chordNotes((kind === "w" ? WH[i] : BL[i]) + S.oct * 12 + S.glob.gtr);
};
/* a pad (white key 1-8) is queued as note 36+pad, the same notes the drum grid folds */
const padOf = (n) => (n >= 36 && n <= 43 ? n - 36 : ((n % 8) + 8) % 8);
/* notes 36-43 are pads 0-7; any other note folds mod 8, as dgFold does */
// Queue settings (hold the mod strip, QUEUE tab). MODE: NORMAL starts at once, PAUSE waits WAIT seconds after your last swipe and plays once,
// LOOP repeats until you cancel it, waiting WAIT seconds between one pass and the next (the first pass starts at once). HOLD OVERLAP: how long a swipe-up held note keeps sounding after you play the next key. TIMING: SYNC snaps note
// lengths and the gap to the tempo (1/16 steps) and starts a queue on the beat; FREE uses your swipe lengths and the gap in milliseconds as they are.
const QS = { on: 1, mode: 0, wait: 1.5, tail: 0, sync: 1, gapS: 0, gapF: 0, kb: 0 },
	QS0 = Object.assign({}, QS);

try {
	const o = JSON.parse(localStorage.getItem("mellow-qs"));
	if (o && typeof o === "object") {
		for (const k in QS) {
			if (typeof o[k] === "number" && isFinite(o[k])) {
				QS[k] = o[k];
			}
		}
		QS.on = QS.on ? 1 : 0;
		QS.mode = clamp(QS.mode | 0, 0, 2);
		QS.wait = clamp(QS.wait, 0.3, 5);
		QS.tail = clamp(QS.tail, 0, 3);
		QS.sync = QS.sync ? 1 : 0;
		QS.gapS = clamp(QS.gapS | 0, 0, 8);
		QS.gapF = clamp(QS.gapF, 0, 1000);
		QS.kb = clamp(QS.kb | 0, 0, 3);
	}
} catch (e) {
	/* nothing to do */
}

const saveQS = () => {
	try {
		localStorage.setItem("mellow-qs", JSON.stringify(QS));
	} catch (e) {
		/* nothing to do */
	}
};

const QMODES = ["NORMAL", "PAUSE", "LOOP"],
	gridSec = () => 60 / S.bpm / 4,
	gapSec = () => (QS.sync ? QS.gapS * gridSec() : QS.gapF / 1000),
	qGap = (q) => (q.gap != null ? q.gap : gapSec());

const qBusy = (t) => {
	const q = A.q[t];
	return q.pend.length > 0 || q.live.length > 0 || (QS.mode === 2 && q.cyc.length > 0);
};

const qHas = (t, id) => {
	const q = A.q[t],
		h = (x) => x.id === id || (x.ids && x.ids.includes(id));
	return q.pend.some(h) || q.live.some(h) || q.cyc.some(h);
};

const deferNote = () =>
	queueable() && (QS.mode !== 0 || qBusy(S.trk) || AC.currentTime - A.q[S.trk].lastUse < 8);

function queueable() {
	const e = engOf(S.trk),
		pads = e === "DRUM" || (e === "SMP" && S.screen === "smp");
	return (
		QS.on &&
		AC &&
		(pads ||
			((e === "FM" || e === "ANA" || e === "WAVE") &&
				!(S.screen === "drum" || S.screen === "smp"))) &&
		!S.arp.on &&
		!(S.screen === "seq" && S.seqPage === 2 && !S.rec) &&
		!qsSaved()
	);
}
/* drums and the sampler's slices queue too (their keys are white keys 1-8) */
const qKeyOk = (kind, i) => {
	const e = engOf(S.trk);
	return ((e !== "DRUM" && e !== "SMP") || (kind === "w" && i < 8)) && !keyBlocked(kind, i);
};

function qAdd(t, item) {
	const q = A.q[t],
		last = q.pend[q.pend.length - 1];
	if (item.hold && last && last.hold) {
		q.pend.pop();
	} // only one held finish
	if (q.pend.length >= QMAX) {
		S.pop = null;
		S.toast = { s: "QUEUE FULL (16)", t: performance.now() };
		return false;
	}
	if (!item.hold && last && last.hold) {
		q.pend.splice(q.pend.length - 1, 0, item);
	} else {
		q.pend.push(item);
	}
	return true;
}

function qRelease(v, from) {
	if (v && v.off && !v.done) {
		v.off(Math.max(AC.currentTime, (v.start || 0) + 0.002));
	}
}

// A held note is playing and a queue starts: the held note is let go (its own release is the fade) and the queue's first note is eased in
// behind it, after about as long as that release takes, instead of starting on the spot.
function handoffSec(t) {
	const e = engOf(t);
	let rel = 0.5;
	if (e === "FM") {
		const cs = ALG[S.alg].c,
			r4 = cs.reduce((a, c) => a + S.ops[c - 1].R[3], 0) / Math.max(1, cs.length);
		rel = 8 * Math.exp(-0.065 * r4);
	} else if (e === "ANA") {
		rel = (0.08 + (S.ana.rel / 99) * 2.4) * 0.9;
	}
	return clamp(rel, 0.25, 1);
}

function qCommit(t, item) {
	const q = A.q[t];
	if (AC) {
		q.lastUse = AC.currentTime;
	}
	if (!item.hold && !qBusy(t)) {
		q.log.length = 0;
		q.gap = null;
	} /* q.log: the steps of this queue as swiped in, so SAVE THIS QUEUE still works after it has played */
	if (!item.hold && QS.sync) {
		const g = gridSec();
		item.dur = Math.max(g, Math.round(item.dur / g) * g);
	} /* SYNC: the note length is a whole number of 1/16 steps */
	if (AC && !qBusy(t) && latch[t].vs.length) {
		releaseLatch(t);
		q.nextT = Math.max(q.nextT, AC.currentTime + handoffSec(t));
	}
	if (AC && QS.mode === 1) {
		q.holdUntil = AC.currentTime + QS.wait;
	} /* PAUSE: every new swipe restarts the wait */
	/* several fingers: swipes that let go within CHORD_S of each other on the same track are ONE step that plays together (a chord; one queue slot, at most 6 notes) */
	if (AC && !item.hold) {
		item.at = AC.currentTime;
		const last = q.pend[q.pend.length - 1];
		if (
			last &&
			!last.hold &&
			!last.rep &&
			last.at != null &&
			!item.kb &&
			!last.kb &&
			item.at - last.at <= CHORD_S &&
			last.notes.length < 6
		) {
			item.notes.forEach((n) => {
				if (!last.notes.includes(n)) {
					last.notes.push(n);
				}
			});
			last.notes.sort((a, b) => a - b);
			last.ids = (last.ids || [last.id]).concat(item.id);
			last.dur = Math.max(last.dur, item.dur);
			if (Math.abs(item.bend | 0) > Math.abs(last.bend | 0)) {
				last.bend = item.bend;
			}
			if (last.lg) {
				last.lg.n = last.notes.slice();
				last.lg.d = last.dur;
				last.lg.b = last.bend | 0;
			}
			return true;
		}
	}
	if (!qAdd(t, item)) {
		return false;
	}
	if (!item.hold && q.log.length < QMAX) {
		item.lg = { n: item.notes.slice(), d: item.dur, b: item.bend | 0 };
		q.log.push(item.lg);
	}
	return true;
}

function qClear(t) {
	const q = A.q[t];
	if (AC) {
		q.live.forEach((x) => x.vs.forEach((v) => qRelease(v)));
	}
	q.pend.length = 0;
	q.live.length = 0;
	q.cyc.length = 0;
	q.log.length = 0;
	q.gap = null;
	q.nextT = 0;
	q.started = false;
	q.holdUntil = 0;
}

function qTick(ct) {
	for (let t = 0; t < 4; t++) {
		const q = A.q[t];
		for (let k = q.live.length - 1; k >= 0; k--) {
			const x = q.live[k];
			if (!x.ended && x.end <= ct + A.la) {
				x.vs.forEach((v) => {
					if (v && v.off && !v.done) {
						v.off(x.end);
					}
				});
				if (x.rec) {
					recClose(x.rec, x.end);
				}
				x.ended = true;
			}
			if (x.end < ct - 0.05) {
				q.live.splice(k, 1);
			}
		}
		if (!q.pend.length && !q.live.length && !(QS.mode === 2 && q.cyc.length)) {
			q.started = false;
		}
		if (QS.mode === 1 && !q.started && q.pend.length && ct < q.holdUntil) {
			continue;
		}
		if (!q.started && q.pend.length && ct < q.pend[q.pend.length - 1].at + 0.12) {
			continue;
		} /* a queue that is just starting waits a moment for a second finger's swipe to join the chord */ /* PAUSE: still waiting for you to finish queuing */
		while (
			(q.pend.length || (QS.mode === 2 && q.cyc.length)) &&
			q.nextT + (q.pend.length ? 0 : QS.wait) < ct + A.la
		) {
			if (!q.pend.length) {
				q.nextT += QS.wait;
				q.cyc.forEach((x) =>
					q.pend.push({
						id: x.id,
						ids: x.ids,
						notes: x.notes,
						dur: x.dur,
						hold: false,
						rep: true,
						bend: x.bend,
					}),
				);
			} /* LOOP: start the pass again */
			const it = q.pend.shift();
			let when = Math.max(q.nextT, ct + 0.02);
			if (!q.started) {
				q.started = true;
				if (QS.sync && S.playing && AC) {
					const ss = gridSec(),
						k = Math.ceil((when - A.t0) / ss - 1e-6);
					when = Math.max(when, A.t0 + k * ss);
				}
			} /* SYNC: a queue starts on the next 1/16 step of the song clock */
			const vs = [],
				en = engOf(t);
			let rec = null;
			if (en === "DRUM" || en === "SMP") {
				qPads(t, en, it.notes, when);
			} /* one-shots: nothing to let go of, the step length only sets when the next step starts */
			else {
				it.notes.forEach((n) => {
					const v = noteVoice(t, n, 0.8, when);
					if (v) {
						v.start = when;
						vs.push(v);
					}
				});
				heardNote(it.notes[0]);
				if (it.bend) {
					vs.forEach((v) => {
						if (v.bend) {
							v.bend(it.bend / 8, when, clamp(it.dur * 0.4, 0.03, 0.25));
						}
					});
				} /* the step's pitch bend: glides from 0 over the first part of the step */
				{
					const h = recAt(t, it.notes[0], 0.8, when, 0);
					if (h) {
						const v0 = vs.find(Boolean);
						if (it.hold) {
							if (v0) {
								recVoice(h, v0);
							} else {
								recClose(h, when);
							}
						} else {
							rec = h;
						}
					}
				}
			}
			if (it.hold) {
				vs.forEach((v) => {
					v.pin = true;
				});
				latch[t].vs.push(...vs);
				latch[t].ids.add(it.id);
				q.nextT = when;
				q.cyc.length = 0;
			} /* the last step stays held, like a swipe-up hold; it ends a loop */
			else {
				if (QS.mode === 2 && !it.rep) {
					q.cyc.push(it);
				}
				if (rec) {
					const v0 = vs.find(Boolean);
					if (v0) {
						recVoice(rec, v0);
					} else {
						recClose(rec, when + it.dur);
					}
				} /* the recorded note ends when its voice is let go (STOP cuts it short); with no voice it is the step's own length */
				q.live.push({
					id: it.id,
					ids: it.ids,
					vs,
					end: when + it.dur,
					ended: false,
					b: it.bend | 0,
					bend: it.bend | 0,
					rec,
					notes: it.notes,
					dur: it.dur,
				});
				q.nextT = when + it.dur + qGap(q);
			}
		}
	}
}

/* A queued step on a drum or sampler track: its notes fold to pads (36-43 = pads 0-7, any other note mod 8) and the track's own voice plays them (drumHit keeps its 16-hits-in-120-ms cap). Two notes that fold to one pad are one hit. */
let qSmpRec = 0;

function qPads(t, en, notes, when) {
	qSmpRec = 0;
	[...new Set(notes.map(padOf))]
		.sort((a, b) => a - b)
		.forEach((p) => {
			if (A.nvLog) {
				A.nvLog.push({ trk: t, n: 36 + p, pad: p, eng: en, vel: 0.8, when, ct: AC.currentTime });
			}
			if (en === "DRUM") {
				drumHit(t, p, 0.8, when);
				if (t === DT && S.rec && S.playing && AC && when >= A.t0 - 0.005) {
					const ss = stepSec(),
						N = nstT(t),
						i = ((snapPos(Math.round((when - A.t0) / ss)) % N) + N) % N;
					dgRec(S.seqs[t], i, 36 + p, 0.8);
					recLive(t, i, when, p);
				} /* REC writes a queued drum step into the grid at the step it lands on (and the scheduler leaves that cell alone this pass: the queue already hit it) */
				S.padHits[p] = performance.now();
				if (S.glob.out !== 3 && MIDI.outs.length) {
					dgMidi(t, p, 102, when);
				}
			} else {
				sampVoice(t, p, 60, 0.8, when);
				if (!qSmpRec && S.rec && S.playing && AC && when >= A.t0 - 0.005) {
					qSmpRec = 1;
					const h = recAt(t, 36 + p, 0.8, when, 0, 1);
					if (h) {
						recClose(h, when + stepSec() * 0.5);
					}
				}
			}
		});
}
/* the sampler's step data holds ONE note per step, so a chord records its first pad */
// ---- SAVED QUEUES (the bottom of the QUEUE popup; PROTOTYPE ONLY, `mellow-queues` stands in for flash). A saved queue belongs to no track: steps of MIDI notes (up to 6 per step) with their lengths in seconds, plus the gap. Playing one on a track
// uses that track's engine: melodic tracks play the notes (clamped to C1-C8, the track's transpose applies as for keys), a drum track and the sampler fold them to pads / slices with padOf. Up to 12; not part of a project export or of any reset.
const QSVMAX = 12,
	PADN = ["KICK", "SNARE", "HAT", "OPEN", "CLAP", "RIM", "SHAKER", "PERC"];

let QSV = [];

function qsvClean(a) {
	const out = [];
	if (!Array.isArray(a)) {
		return out;
	}
	for (const e of a) {
		if (out.length >= QSVMAX) {
			break;
		}
		if (!e || !Array.isArray(e.s)) {
			continue;
		}
		const s = e.s
			.slice(0, QMAX)
			.map((x) => {
				if (!(x && Array.isArray(x.n))) {
					return null;
				}
				const o = {
						n: [
							...new Set(
								x.n
									.filter((n) => typeof n === "number")
									.map((n) => Math.round(n))
									.filter((n) => isFinite(n) && n >= 0 && n <= 127),
							),
						]
							.sort((a, b) => a - b)
							.slice(0, 6),
						d: isFinite(+x.d) ? clamp(Math.round(x.d * 100) / 100, 0.05, 8) : 0.5,
					},
					b = isFinite(+x.b) ? clamp(Math.round(+x.b), -BEND_MAX, BEND_MAX) : 0;
				if (b) {
					o.b = b;
				}
				return o;
			})
			.filter((x) => x && x.n.length); /* b = the step's pitch bend; an older queue has none */
		if (s.length) {
			out.push({
				n:
					String(e.n || "Q" + (out.length + 1))
						.toUpperCase()
						.replace(/[^A-Z0-9 .-]/g, "")
						.slice(0, 10) || "Q" + (out.length + 1),
				g: isFinite(+e.g) ? clamp(Math.round(e.g * 100) / 100, 0, 2) : 0,
				s,
			});
		}
	}
	return out;
}

try {
	QSV = qsvClean(JSON.parse(localStorage.getItem("mellow-queues")));
} catch (e) {
	QSV = [];
}

const saveQSV = () => {
	try {
		localStorage.setItem("mellow-queues", JSON.stringify(QSV));
	} catch (e) {
		/* nothing to do */
	}
};

const qsvTime = (e) => e.s.reduce((a, x) => a + x.d + e.g, 0);

function qsvSum(e) {
	const dr = e.s.every((x) => x.n.every((n) => n >= 36 && n <= 43));
	return e.s
		.map(
			(x) =>
				x.n.map((n) => (dr ? PADN[n - 36] : note(n))).join("+") +
				(x.b ? (x.b > 0 ? "\u0002" : "\u0003") + (Math.abs(x.b) / 8).toFixed(1) : ""),
		)
		.join("  ");
}
/* a bent step shows an arrow and the semitones (\u0002 up, \u0003 down: the LCD's pixel arrows) */
function qSaveCurrent(t) {
	const q = A.q[t];
	if (!q.log.length) {
		return "NOTHING QUEUED";
	}
	if (QSV.length >= QSVMAX) {
		return "FULL: DELETE ONE";
	}
	let k = 1;
	while (QSV.some((e) => e.n === "Q" + k)) {
		k++;
	}
	QSV.push({
		n: "Q" + k,
		g: Math.round(qGap(q) * 100) / 100,
		s: q.log.map((x) => ({
			n: x.n.slice().sort((a, b) => a - b),
			d: Math.round(x.d * 100) / 100,
			b: x.b | 0,
		})),
	});
	QSV = qsvClean(QSV);
	saveQSV();
	return "";
}

function qKeyIds(t, notes) {
	const en = engOf(t),
		ids = [];
	if (en === "DRUM" || en === "SMP") {
		notes.forEach((n) => {
			const id = "w" + padOf(n);
			if (!ids.includes(id)) {
				ids.push(id);
			}
		});
	} else {
		const sh = S.oct * 12 + S.glob.gtr;
		notes.forEach((n) => {
			let i = WH.findIndex((m) => m + sh === n),
				id = i >= 0 ? "w" + i : "";
			if (i < 0) {
				i = BL.findIndex((m) => m + sh === n);
				if (i >= 0) {
					id = "b" + i;
				}
			}
			if (id && !ids.includes(id)) {
				ids.push(id);
			}
		});
	}
	return ids;
}

/* play a saved queue on track t as if it had just been swiped in (same start rules, MODE and TIMING of the popup; the steps keep their saved lengths) */
function qApply(e, t) {
	if (!QS.on) {
		return "QUEUE IS OFF";
	}
	if (S.arp.on && t === S.trk) {
		return "TURN ARP OFF";
	}
	ensureAudio();
	if (!AC) {
		return "SOUND IS OFF";
	}
	const q = A.q[t],
		en = engOf(t),
		mel = en !== "DRUM" && en !== "SMP";
	qClear(t);
	q.lastUse = AC.currentTime;
	if (mel && latch[t].vs.length) {
		releaseLatch(t);
		q.nextT = AC.currentTime + handoffSec(t);
	}
	if (QS.mode === 1) {
		q.holdUntil = AC.currentTime + QS.wait;
	}
	e.s.forEach((x, i) => {
		const notes = mel ? x.n.map((n) => clamp(n, 24, 108)) : x.n.slice(),
			ids = qKeyIds(t, notes);
		qAdd(t, {
			id: ids[0] || "s" + i,
			ids: ids.length > 1 ? ids : undefined,
			notes,
			dur: x.d,
			hold: false,
			at: AC.currentTime - 1,
			lg: null,
			bend: mel ? x.b | 0 : 0,
		});
		q.log.push({ n: x.n.slice(), d: x.d, b: x.b | 0 });
	});
	q.gap = e.g;
	return "";
}
