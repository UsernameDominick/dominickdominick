// FM voices (the DX7 core, on the page side)
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---------- FM voices (DX7 core) ----------
// The FM engine runs in an AudioWorklet (its own thread), so a busy page can never starve it. If the browser or page
// security refuses a worklet, it falls back to a main-thread ScriptProcessor with a bigger buffer.
const FM_WORKLET = `
class DX7FM extends AudioWorkletProcessor{
 constructor(){super();this.eng=[0,1,2,3].map(()=>{const g=new DX7.Engine(sampleRate);g.og=3;return g});this.q=[];this.lv=new Map();this.c=0;this.sk=-1;this.rx=0;this.sb=-1;this.sr=-1;
  this.port.onmessage=m=>{const e=m.data;if(e.k==='cfg'){this.tt=e.tunes.map(x=>x|0);if(this.tc==null)this.tc=this.tt.slice();for(let i=0;i<4;i++){const g=this.eng[i];if(!g.anyActive()){this.tc[i]=this.tt[i];g.tune=this.tt[i]}}}else{this.rx++;const q=this.q;q.push(e);let i=q.length-1;while(i>0&&q[i-1].t>e.t){q[i]=q[i-1];i--}q[i]=e}}}   /* sorted insert: no sort, no allocation */
 cap(me){let n=0,all=true,bg=null,bv=null,bs=-1e18;const E=this.eng,sc=DX7.stealScore;for(let t=0;t<4;t++){const g=E[t],vs=g.voices;for(let i=0;i<vs.length;i++){const v=vs[i];if(v.active){n++;const s=sc(v);if(s>bs){bs=s;bv=v;bg=g}}else if(g===me)all=false}}
  if(n<12||all)return;if(bg)bg.fadeOut(bv)}   /* 12 voices in all: the oldest released voice of ANY track goes first, then the oldest held note (it used to take another track's first voice, so a held chord on one track was cut by a loop on another) */
 process(_,outs){const n=outs[0][0].length,t0=currentTime;
  if(this.tt!=null)for(let i=0;i<4;i++){this.tc[i]+=(this.tt[i]-this.tc[i])*.4;this.eng[i].tune=Math.round(this.tc[i])}   // tuning and pitch bend, glided so it never steps
  for(let b=0;b<n;b+=64){const tEnd=t0+(b+64)/sampleRate,q=this.q;
   while(q.length&&q[0].t<=tEnd){const e=q.shift(),g=this.eng[e.trk];
    if(e.k==='on'){g.setPatch(e.patch);this.cap(g);g.noteOn(e.note,e.vel,e.mono);if(e.id)this.lv.set(e.id,e.note)}else if(e.k==='off'){g.noteOff(e.note);if(e.id)this.lv.delete(e.id)}
    else if(e.k==='cut'){for(let i=q.length-1;i>=0;i--)if(q[i].id===e.id)q.splice(i,1);if(this.lv.has(e.id)){g.noteOff(this.lv.get(e.id));this.lv.delete(e.id)}if(e.fast)g.quench(e.note)}else if(e.k==='kill'){for(let i=q.length-1;i>=0;i--)if(q[i].trk===e.trk)q.splice(i,1);g.killAll()}else if(e.k==='bend')g.bend(e.note,e.to,e.dur);else g.allOff()}   /* kill: the track's queued events are dropped and every voice fades out. cut: a sequencer note whose on has not fired is dropped, one that sounds is released now */
   for(let t=0;t<4;t++){const out=outs[t][0],g=this.eng[t];if(g.anyActive())g.block(out,b);else out.fill(0,b,b+64)}}
  if((++this.c&7)===0){let key=0;for(let t=0;t<4;t++){let a=0,h=0;const vs=this.eng[t].voices;for(let i=0;i<vs.length;i++){const v=vs[i];if(v.active){a++;if(v.held)h++}}key|=(a<<(t*4))|(h<<(16+t*4))}   /* 4 bits each: at most 12 voices */
   let bz=0;if(this.q.length)bz=15;else for(let t=0;t<4;t++)if(this.eng[t].anyActive())bz|=1<<t;   /* busy: voices, fade-outs or queued events */
   if(key!==this.sk||bz!==this.sb||this.rx!==this.sr){this.sk=key;this.sb=bz;this.sr=this.rx;this.port.postMessage({k:'stat',active:[key&15,(key>>4)&15,(key>>8)&15,(key>>12)&15],held:[(key>>16)&15,(key>>20)&15,(key>>24)&15,(key>>28)&15],busy:bz,rx:this.rx})}}
  return true}}
registerProcessor('dx7-fm',DX7FM);`;

function flushFm() {
	A.fmPending.splice(0).forEach(([t, e]) => fmSend(t, e));
}

async function loadFmWorklet() {
	if (window.__noWorklet || !AC.audioWorklet || typeof AudioWorkletNode === "undefined") {
		throw new Error("no worklet");
	}
	const dx7Source = await (await fetch(document.getElementById("dx7src").src)).text(); // the DX7 core is its own file (dx7.js); the worklet runs a copy of it
	const url = URL.createObjectURL(
		new Blob([dx7Source + "\n" + FM_WORKLET], { type: "text/javascript" }),
	);
	try {
		await AC.audioWorklet.addModule(url);
	} finally {
		URL.revokeObjectURL(url);
	}
	const node = new AudioWorkletNode(AC, "dx7-fm", {
		numberOfInputs: 0,
		numberOfOutputs: 4,
		outputChannelCount: [1, 1, 1, 1],
	});
	A.fmG = [];
	A.fmSent = 0;
	node.port.onmessage = (m) => {
		const d = m.data;
		if (d.k === "stat") {
			A.fmStat = d;
			if (d.rx === A.fmSent) {
				for (let t = 0; t < 4; t++) {
					if (!((d.busy >> t) & 1)) {
						gate("f" + t, A.fmG[t], A.tr[t], false, 400);
					}
				}
			}
		}
	};
	for (let t = 0; t < 4; t++) {
		const gn = AC.createGain();
		gn.gain.value = 1;
		node.connect(gn, t, 0);
		gn.connect(A.tr[t]);
		A.fmG.push(gn);
	}
	A.fmw = node;
	A.fmMode = "worklet";
	A.fmTune = null;
	flushFm();
	audioSync();
}

function startFm() {
	loadFmWorklet().catch((e) => {
		A.fmMode = "sp";
		flushFm();
	});
}

function fmSend(trk, e) {
	if (A.fmMode === "worklet") {
		e.trk = trk;
		A.fmSent++;
		if (e.k === "on") {
			gate("f" + trk, A.fmG[trk], A.tr[trk], true);
		}
		A.fmw.port.postMessage(e);
	} else if (A.fmMode === "sp") {
		fmPush(fmNode(trk), e);
	} else {
		A.fmPending.push([trk, e]);
	}
}

function fmVoices() {
	if (A.fmMode === "worklet") {
		const s = A.fmStat;
		return s
			? {
					active: s.active.reduce((a, b) => a + b, 0),
					held: s.held.reduce((a, b) => a + b, 0),
					heldBy: s.held.slice(),
				}
			: { active: 0, held: 0, heldBy: [0, 0, 0, 0] };
	}
	let a = 0,
		h = 0;
	const hb = [0, 0, 0, 0];
	A.fm.forEach((fmNode, t) => {
		if (fmNode) {
			fmNode.eng.voices.forEach((v) => {
				if (v.active) {
					a++;
					if (v.held) {
						h++;
						hb[t]++;
					}
				}
			});
		}
	});
	return { active: a, held: h, heldBy: hb };
}

function fmNode(trk) {
	if (A.fm[trk]) {
		return A.fm[trk];
	}
	const eng = new DX7.Engine(AC.sampleRate),
		sp = AC.createScriptProcessor(2048, 0, 1),
		q = [],
		lv = new Map(),
		gn = AC.createGain();
	gn.gain.value = 1;
	eng.og = 3;
	sp.onaudioprocess = (ev) => {
		const tt = fmTuneNow(trk);
		const out = ev.outputBuffer.getChannelData(0),
			n = out.length,
			sr = AC.sampleRate,
			t0 = ev.playbackTime || AC.currentTime + n / sr;
		for (let b = 0; b < n; b += 64) {
			const tEnd = t0 + (b + 64) / sr;
			eng.tune = Math.round(eng.tune + (tt - eng.tune) * 0.12);
			while (q.length && q[0].t <= tEnd) {
				const e = q.shift();
				if (e.k === "on") {
					eng.setPatch(e.patch);
					fmCap(eng);
					eng.noteOn(e.note, e.vel, e.mono);
					if (e.id) {
						lv.set(e.id, e.note);
					}
				} else if (e.k === "off") {
					eng.noteOff(e.note);
					if (e.id) {
						lv.delete(e.id);
					}
				} else if (e.k === "cut") {
					for (let i = q.length - 1; i >= 0; i--) {
						if (q[i].id === e.id) {
							q.splice(i, 1);
						}
					}
					if (lv.has(e.id)) {
						eng.noteOff(lv.get(e.id));
						lv.delete(e.id);
					}
					if (e.fast) {
						eng.quench(e.note);
					}
				} else if (e.k === "kill") {
					q.length = 0;
					lv.clear();
					eng.killAll();
				} else if (e.k === "bend") {
					eng.bend(e.note, e.to, e.dur);
				} else {
					eng.allOff();
				}
			}
			if (eng.anyActive()) {
				eng.block(out, b);
			} else {
				out.fill(0, b, b + 64);
			}
		}
	};
	sp.connect(gn);
	gn.connect(A.tr[trk]);
	return (A.fm[trk] = { eng, sp, q, gn });
}

// the FM-1 has one 12-voice FM engine: all FM tracks together never sound more than 12 voices
function fmCap(me) {
	let n = 0,
		bs = -1e18,
		bg = null,
		bv = null;
	A.fm.forEach((fmNode) => {
		if (fmNode) {
			fmNode.eng.voices.forEach((v) => {
				if (v.active) {
					n++;
					const s = DX7.stealScore(v);
					if (s > bs) {
						bs = s;
						bv = v;
						bg = fmNode.eng;
					}
				}
			});
		}
	});
	if (n < 12 || me.voices.every((v) => v.active)) {
		return;
	}
	if (bg) {
		bg.fadeOut(bv);
	}
}
/* the same rule as the worklet's cap: oldest released voice of any track, then oldest held note */
function fmPush(fmNode, e) {
	fmNode.q.push(e);
	fmNode.q.sort((a, b) => a.t - b.t);
}

let fmIds = 0;

function fmVoice(trk, m, vel, when, sq) {
	const note = clamp(Math.round(m) + TK(trk).tr, 0, 127),
		id = ++fmIds,
		w = when || 0;
	// a voice releases once. FM releases by note number, so a late second 'off' from an old voice (for example when the
	// recent-voices list trims it) would also release a newer press of the same note and silence it.
	// A live release (within 30 ms) is sent at once, so it can never be sorted behind the next press of the same key.
	// An 'off' is never sent for a time before its own 'on' (a scheduler that ran late used to sort the off first: the note then rang until stopped).
	const v = {
		dead: false,
		done: false,
		note,
		id,
		off(t) {
			if (v.done) {
				return;
			}
			v.done = true;
			fmSend(trk, { t: Math.max(t && t - AC.currentTime > 0.03 ? t : 0, w), k: "off", note, id });
		},
		cut(fast) {
			if (v.cutd) {
				return;
			}
			v.cutd = v.done = true;
			fmSend(trk, fast ? { t: 0, k: "cut", id, note, fast: 1 } : { t: 0, k: "cut", id });
		}, // cut: STOP drops a note that has not started and releases one that sounds
		bend(semi, t, dur) {
			if (v.done) {
				return;
			}
			fmSend(trk, {
				t: Math.max(t || 0, w) + 0.0005,
				k: "bend",
				note,
				to: Math.round((semi / 12) * 16777216),
				dur: Math.max(0.02, dur),
				id,
			});
		},
	}; /* a queued step's pitch bend: this voice's own offset glides from 0 to `semi` semitones over `dur` s (the same logfreq units as the tuning, no click) */
	fmSend(trk, {
		t: w,
		k: "on",
		note,
		vel: clamp(Math.round(vel * 127), 1, 127),
		patch: fmPatch(trk),
		mono: !!TK(trk).mono,
		id,
	});
	return v;
}
