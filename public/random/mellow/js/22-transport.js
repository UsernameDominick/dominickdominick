// stop, drag handling, resampling the master output
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-unused-vars, no-undef -- offers names the other files use; uses names that live in the other files of the folder */

// STOP: stops the sequencer and leaves everything else (never starts it). Double-tap STOP is KILL.
function stopOnly() {
	const rec0 = S.rec && S.playing;
	S.countdown = null;
	if (S.playing) {
		S.playing = false;
		stopSeq();
	}
	if (rec0) {
		finishRec();
	}
	if (AC) {
		audioSync();
	}
}

// KILL: silence everything now. The sequencer stops and its queued notes never sound; every key, hold, latch, queue, arp and Drift note on every track is let go and every voice of
// every engine fades out in a few milliseconds (never a hard cut); the shared reverb and echo are ducked, flushed and brought back, so no tail is left. The output guard (limiter, soft clip) is untouched.
function killAll() {
	const rec0 = S.rec && S.playing;
	S.playing = false;
	S.countdown = null;
	stopSeq();
	if (rec0) {
		finishRec();
	}
	S.rec = false;
	S.recExt = false;
	S.gen.on = false;
	A.arps.forEach((x) => x.clear());
	A.arpKeys = {};
	if (A.arpSet) {
		A.arpSet.clear();
	}
	for (let t = 0; t < 4; t++) {
		HOLD[t] = 0;
		releaseLatch(t, true, true);
		qClear(t);
	}
	latchMark.clear();
	Object.keys(heldK).forEach((id) => keyOff(id[0], +id.slice(1)));
	A.down = 0;
	if (AC) {
		const now = AC.currentTime;
		for (let t = 0; t < 4; t++) {
			fmSend(t, { t: 0, k: "kill" });
		}
		A.vox.forEach((L) =>
			L.forEach((v) => {
				if (v && !v.dead && !v.stolen) {
					if (v.cut) {
						v.cut();
					} else if (v.off && !v.done) {
						v.off(now);
					}
				}
			}),
		);
		(A.sv || []).forEach((V) =>
			V.forEach((v) => {
				if (v && !v.done && v.off) {
					v.off(now);
				}
			}),
		);
		A.smpLast.forEach((v) => v && !v.done && v.off && v.off(now));
		(A.dv || []).forEach((D) =>
			D.forEach((o) => {
				if (o && o.g) {
					try {
						o.g.gain.cancelScheduledValues(now);
						o.g.gain.setTargetAtTime(0, now, 0.004);
					} catch (e) {
						/* nothing to do */
					}
				}
			}),
		);
		fxFlush();
		audioSync();
	}
	toast("KILLED");
}

function fxFlush() {
	if (!AC || !A.eW) {
		return;
	}
	const t = AC.currentTime;
	A.killT =
		performance.now() +
		450; /* audioSync leaves the returns alone until the new echo and reverb are in */
	[A.eW, A.rW, A.eFb].forEach((n) => {
		n.gain.cancelScheduledValues(t);
		n.gain.setTargetAtTime(0, t, 0.006);
		n.gain._v = undefined;
	}); /* (audioSync's P() only writes a value that changed: forget the cached one so it sets them again) */
	clearTimeout(A.flushT);
	A.flushT = setTimeout(() => {
		if (!AC) {
			return;
		}
		[A.eIn, A.eD, A.eLP, A.eHP, A.eSat, A.eFb].forEach((x) => {
			try {
				x.disconnect();
			} catch (e) {
				/* nothing to do */
			}
		});
		echoMake();

		A.eFb.gain.value = 0; /* a new gain node starts at 1: keep the feedback closed until audioSync opens it */
		try {
			A.reverbIn.disconnect();
			A.conv.disconnect();
		} catch (e) {
			/* nothing to do */
		}
		convMake();
		A.killT = 0;
		audioSync();
	}, 90);
}

function rebase(oss, obpm) {
	if (!AC) {
		return;
	}
	if (S.playing) {
		const nss = stepSec(),
			pos = (AC.currentTime - A.t0) / oss;
		A.t0 = AC.currentTime - pos * nss;
		S.t0 = performance.now() - pos * nss * 1000;
	}
	if (S.gen.on && obpm !== S.bpm) {
		S.gen.t0 = performance.now();
		A.gA = AC.currentTime;
		A.gk = 0;
	}
}

function arpPattern(notes, t) {
	const ar = TK(t),
		m = ar.arp.mode,
		set = A.arps[t == null ? S.trk : t],
		base = m === 5 && set.size ? [...set] : notes,
		seq = [];
	for (let o = 0; o < ar.arp.oct; o++) {
		base.forEach((n) => seq.push(n + 12 * o));
	}
	if (m === 1) {
		return seq.slice().reverse();
	}
	if (m === 2) {
		return seq.concat(seq.slice().reverse());
	}
	if (m === 3) {
		return seq.length > 2 ? seq.concat(seq.slice(1, -1).reverse()) : seq;
	}
	if (m === 4) {
		return [seq[Math.floor(Math.random() * seq.length)]];
	}
	if (m === 6) {
		return seq.flatMap((n) => [n, n]);
	}
	return seq;
}

function genAt(st) {
	const g = S.gen,
		sc = SCALES[S.scale.type][1],
		rows = Math.max(7, sc.length * g.rng);
	if (hsh(st * 1.37) > (g.den / 100) * 1.5) {
		return null;
	}
	const walk = 0.5 + 0.35 * Math.sin(st * 0.37) + (hsh(st * 3.9) - 0.5) * 0.5,
		rr = clamp(Math.round(walk * (rows - 1)), 0, rows - 1);
	return {
		rr,
		rows,
		wd: 6 + Math.round(hsh(st * 7.7) * 18),
		hm: Math.round(((hsh(st * 2.1) - 0.5) * g.hum) / 25),
		vel: 0.4 + 0.3 * hsh(st * 5.5),
		midi: 48 + S.scale.root + sc[rr % sc.length] + 12 * Math.floor(rr / sc.length),
	};
}

/* a drag can deliver 60-120 steps a second; the audio parameters only need the latest state, so turn() and the mod strip mark them dirty and tick() runs audioSync once per 25 ms */
function syncSoon() {
	A.syncDirty = 1;
}

const arpOn = [0, 0, 0, 0];

/* The scheduler looks LA seconds ahead (140 ms) and runs every 25 ms. If the page stalls for longer than that (a slow phone, a busy tab) the notes that were due run out and come late or are dropped, so a tick that
   arrives more than 110 ms after the last one widens the look-ahead (stall + 60 ms, at most 320 ms) and it relaxes back by 80 ms a second once the page has been calm for 8 s. While the page is calm it is exactly 140 ms, so latency and mute / jump timing are as before. */
const LA0 = 0.14,
	LA_MAX = 0.32;

function laStep() {
	const np = performance.now();
	if (A.tkP && np - A.tkP < 5000) {
		const g = np - A.tkP;
		if (g > 110) {
			A.la = Math.min(LA_MAX, Math.max(A.la, g / 1000 + 0.06));
			A.laCalm = np;
			A.laN = (A.laN || 0) + 1;
			A.laMax = Math.max(A.laMax || 0, g);
		} else if (np - A.laCalm > 8000 && A.la > LA0) {
			A.la = Math.max(LA0, A.la - 0.002);
		}
	} /* (a gap of 5 s or more is a hidden page, not a stall) */
	A.tkP = np;
	return A.la;
}

function tick() {
	if (!AC) {
		return;
	}
	const ct = AC.currentTime,
		LA = laStep();
	if (A.syncDirty) {
		A.syncDirty = 0;
		audioSync();
	}
	if (S.playing) {
		songMaskSync();
	}
	if (S.countdown) {
		const c = S.countdown;
		while (c.next < c.n && c.t0 + c.next * c.beat < ct + LA) {
			clickAt(c.t0 + c.next * c.beat, c.next === 0);
			c.next++;
		}
		if (ct >= c.t0 + c.n * c.beat) {
			S.countdown = null;
		}
	}
	if (S.playing) {
		const ss = stepSec(),
			sw = ((S.swing - 50) / 50) * ss;
		let n = 0;
		while (
			A.t0 + A.sn * ss < ct + LA &&
			!(BNC.on && BNC.info && A.t0 + A.sn * ss >= BNC.info.tEnd - 0.0005) &&
			n++ < 8
		) {
			/* a bounce ends at tEnd: the look-ahead used to schedule the first step of the NEXT pass (a stray downbeat at the very end of the file) before the 80 ms poll stopped it */ if (
				S.recExt &&
				A.sn > 0 &&
				A.sn % nst() === 0
			) {
				extendOne();
			}
			let NS = nst();
			if (
				S.song.on &&
				S.song.jump >= 0 &&
				!S.recExt &&
				A.sn > 0 &&
				A.sn % (S.plen[S.pat] === 1 ? BSTEPS() : SPB()) === 0
			) {
				songJumpNow(ss);
				NS = nst();
			}
			if (S.song.on && !S.recExt && A.sn > 0 && A.sn % NS === 0) {
				songAdvance(NS);
			}
			if (A.sn % NS === 0 && S.rec && A.sn > 0 && !S.recExt) {
				undoPush("RECORDING");
			}
			if (A.sn % NS === 0 && S.patNext >= 0 && !S.recExt) {
				S.pat = S.patNext;
				S.patNext = -1;
				{
					const sh = A.sn * ss;
					A.t0 += sh;
					A.sn = 0;
					S.t0 += sh * 1000;
				}
			} /* the new pattern starts from its first step (and may have a different length) */
			const when = A.t0 + A.sn * ss + (A.sn % 2 ? sw : 0),
				i0 = A.sn % NS;
			A.recW.forEach((w, t) => {
				if (A.sn % nstT(t) === 0) {
					w.clear();
				}
			});
			if (S.glob.metro && A.sn % BSTEPS() === 0) {
				clickAt(A.t0 + A.sn * ss, i0 % SPB() === 0);
			}
			const it = A.sn % nstT(S.trk),
				rep =
					S.rec &&
					S.glob.rmode === 1 &&
					!S.recExt &&
					!A.recW[S.trk].has(
						it,
					); /* REPLACE: what the playhead passes on the recording track is wiped, unless it was just played in this pass */
			if (rep) {
				S.seqs[S.trk].st[it] = -1;
			}
			if (when >= ct - 0.1) {
				const sm = songMask();
				A.sqMask = sm;
				const dm = songPadMask();
				A.sqDm = dm;
				A.sl.push({ sn: A.sn, when, pos: S.song.pos, pat: S.pat, sm, dm });
				if (A.sl.length > 24) {
					A.sl.shift();
				}
				for (let t = 0; t < 4; t++) {
					if (!((sm >> t) & 1) && !(S.rec && TK(t).arp.on && A.arps[t].size)) {
						A.sqOn = t;
						A.dmCur = t === DT ? dm : 0;
						stepPlay(t, A.sn, when);
						A.sqOn = -1;
						A.dmCur = 0;
					}
				}
			} /* sm: the tracks this song slot mutes. A step the scheduler reached more than 100 ms late (the page was stalled) is skipped, not played in a burst with the next ones */
			A.sn++;
		}
	}
	qTick(ct);
	midiClockTick(ct);
	for (let t = 0; t < 4; t++) {
		const arp = TK(t).arp,
			notes = [...A.arps[t]].sort((a, b) => a - b); // each track has its own arp notes (held or latched on that track)
		if (arp.on && notes.length) {
			const sb = [1, 1.5, 2, 3, 4, 6, 8, 12][arp.rate],
				sd = 60 / S.bpm / sb,
				lk =
					S.playing &&
					A.t0 >
						0; /* while the sequencer plays the arp sits on its grid (a multiple of its step from the pattern start), so it can't flam against the pattern, and a tempo change can't drift it */
			if (A.arpNext[t] < ct - 0.2 || !arpOn[t]) {
				arpOn[t] = 1;
				let st = ct + 0.02;
				if (lk) {
					const nx = A.t0 + Math.ceil((ct + 0.01 - A.t0) / sd - 1e-6) * sd;
					if (nx - ct <= 0.18) {
						st = nx;
					}
				}
				A.arpNext[t] = st;
			}
			let n = 0;
			while (A.arpNext[t] < ct + LA && n++ < 6) {
				const pat = arpPattern(notes, t),
					sw = A.ais[t] % 2 ? ((arp.sw - 50) / 50) * sd : 0,
					nn = pat[A.ais[t] % pat.length],
					when = A.arpNext[t] + sw;
				noteVoice(t, nn, 0.75, when, (sd * arp.gate) / 100);
				recArp(t, nn, when, sd);
				A.ais[t]++;
				if (lk) {
					const T = A.arpNext[t];
					let nx = A.t0 + (Math.floor((T - A.t0) / sd + 1e-6) + 1) * sd;
					if (nx - T < 0.5 * sd) {
						nx += sd;
					}
					A.arpNext[t] = nx;
				} else {
					A.arpNext[t] += sd;
				}
			}
		} else {
			A.arpNext[t] = ct;
			A.ais[t] = 0;
			arpOn[t] = 0;
		}
	}
	const g = S.gen;
	if (g.on) {
		const sec = 30 / S.bpm;
		let n = 0;
		while (A.gA + (A.gk + 0.25) * sec < ct + LA && n++ < 4) {
			const e = genAt(A.gk + 12);
			if (e) {
				noteVoice(
					S.trk,
					e.midi,
					e.vel,
					A.gA + (A.gk + 0.25) * sec + Math.max(0, (e.hm / 12) * sec),
					(e.wd / 12) * sec * 1.6,
				);
			}
			A.gk++;
		}
	}
	A.tk = (A.tk || 0) + 1;
	if (A.tk % 2 === 0) {
		A.an.getFloatTimeDomainData(A.buf);
		let s = 0;
		for (let i = 0; i < A.buf.length; i++) {
			s += A.buf[i] * A.buf[i];
		}
		A.rms = Math.sqrt(s / A.buf.length);
		if (!(A.rms < 4)) {
			guardWatch();
		}
		for (let i = 0; i < 4; i++) {
			A.trAn[i].getFloatTimeDomainData(A.trBuf);
			let q = 0;
			for (let j = 0; j < A.trBuf.length; j++) {
				q += A.trBuf[j] * A.trBuf[j];
			}
			A.trRms[i] = Math.sqrt(q / A.trBuf.length);
		}
		A.bedAn.getFloatTimeDomainData(A.trBuf);
		let q = 0;
		for (let j = 0; j < A.trBuf.length; j++) {
			q += A.trBuf[j] * A.trBuf[j];
		}
		A.bedRms = Math.sqrt(q / A.trBuf.length);
	}
	if (A.tk % 40 === 0) {
		saveDev();
		A.seqV = A.seqV.filter(
			(v) => v && !v.dead && !v.cutd && !v.stolen && (v.until ? v.until > AC.currentTime : !v.done),
		);
		A.vox = A.vox.map((L) => L.filter((v) => v && !v.dead));
		audioSync();
		sleepCheck();
	}
}

// resample the master output into the sampler (one bar, at most SMP_MAX seconds)
/* Capture: a ScriptProcessor tap on the master (the only way to read the output on every browser, iOS included) that does nothing but copy each 4096-sample block; the sinc decimation to 22,050 Hz then runs in 3 ms tasks, so neither the audio callback nor the page stalls. A tap that never completes (the page was hidden, the context suspended) is dropped after the bar's length plus 2 s instead of blocking the next resample, and any NaN is cleared. */
function startResample() {
	if (!AC || A.rec) {
		return;
	}
	const dur = Math.min(SMP_MAX, (60 / S.bpm) * 4),
		fs = AC.sampleRate,
		n = Math.floor(fs * dur),
		chunks = [];
	let got = 0;
	const sp = AC.createScriptProcessor(4096, 1, 1),
		z = AC.createGain();
	z.gain.value = 0;
	A.warm.connect(sp);
	sp.connect(z);
	z.connect(AC.destination);
	const rec = (A.rec = { sp, z });
	S.resampling = true;
	const end = () => {
		sp.onaudioprocess = null;
		try {
			A.warm.disconnect(sp);
		} catch (x) {
			/* nothing to do */
		}
		try {
			sp.disconnect();
			z.disconnect();
		} catch (x) {
			/* nothing to do */
		}
		clearTimeout(rec.to);
		if (A.rec === rec) {
			A.rec = null;
		}
		S.resampling = false;
	};
	rec.to = setTimeout(
		() => {
			if (A.rec === rec) {
				end();
				S.toast = { s: "SAMPLE FAILED", t: performance.now() };
			}
		},
		(dur + 2) * 1000,
	);
	sp.onaudioprocess = (e) => {
		chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
		got += 4096;
		if (got >= n) {
			end();
			const d = new Float32Array(n);
			let o = 0;
			for (const c of chunks) {
				d.set(c.subarray(0, Math.min(c.length, n - o)), o);
				o += c.length;
				if (o >= n) {
					break;
				}
			}
			for (let i = 0; i < n; i++) {
				if (!isFinite(d[i])) {
					d[i] = 0;
				}
			}
			smpResample(d, fs, SMP_RATE, (ds) => {
				setSample(ds, SMP_RATE);
				S.toast = { s: "SAMPLED " + dur.toFixed(1) + " S", t: performance.now() };
			});
		}
	};
}
