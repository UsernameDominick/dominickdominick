// the audio graph: beds, effects, convolution, guards, sleep and wake
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---------- graph ----------
// The dust and the four soundscape beds boot at 0 and are opt-in, so their ~50 s of noise is made after start-up (one bed per timer task, see the end of
// audioInit), or at once when a scape slider is raised (audioSync). Each bed's output starts at gain 0 so it can never burst in before audioSync sets it.
const BED_NOISE = {
	DUST: [
		[6, "pops"],
		[4, "white"],
	],
	RAIN: [
		[4, "white"],
		[5, "pops"],
	],
	VINYL: [
		[6, "pops"],
		[4, "white"],
	],
	OCEAN: [[8, "brown"]],
	FIRE: [
		[5, "crackle"],
		[8, "brown"],
	],
};

function bedBuild(nm, done) {
	const need = BED_NOISE[nm],
		B = [];
	const next = () => {
		if (B.length < need.length) {
			const [s, k] = need[B.length];
			noiseBuf(s, k, (b) => {
				B.push(b);
				next();
			});
			return;
		}
		bedMake(nm, B);
		if (done) {
			done();
		}
	};
	next();
}

function bedWant(nm, done) {
	if (A.bedBusy[nm]) {
		if (done) {
			done();
		}
		return;
	}
	A.bedBusy[nm] = 1;
	bedBuild(nm, () => {
		audioSync();
		if (done) {
			done();
		}
	});
}

function bedMake(nm, B) {
	const g = () => AC.createGain(),
		bq = (t) => {
			const n = AC.createBiquadFilter();
			n.type = t;
			return n;
		},
		loop = (b) => {
			const s = AC.createBufferSource();
			s.buffer = b;
			s.loop = true;
			s.start();
			return s;
		};
	if (nm === "DUST") {
		const s1 = loop(B[0]),
			hp = bq("highpass");
		hp.frequency.value = 1200;
		s1.connect(hp);
		hp.connect(A.dust);
		const s2 = loop(B[1]),
			hp2 = bq("highpass");
		hp2.frequency.value = 3500;
		const g2 = g();
		g2.gain.value = 0.15;
		s2.connect(hp2);
		hp2.connect(g2);
		g2.connect(A.dust);
		return;
	}
	const out = g();
	out.gain.value = 0;
	if (nm === "RAIN") {
		const hp = bq("highpass"),
			lp = bq("lowpass");
		hp.frequency.value = 700;
		lp.frequency.value = 9000;
		const s = loop(B[0]),
			gg = g();
		gg.gain.value = 0.35;
		s.connect(hp);
		hp.connect(lp);
		lp.connect(gg);
		gg.connect(out);
		const s2 = loop(B[1]),
			bp = bq("bandpass");
		bp.frequency.value = 2200;
		bp.Q.value = 0.8;
		const g2 = g();
		g2.gain.value = 1.3;
		s2.connect(bp);
		bp.connect(g2);
		g2.connect(out);
	} else if (nm === "VINYL") {
		const s = loop(B[0]),
			hp = bq("highpass");
		hp.frequency.value = 900;
		const gg = g();
		gg.gain.value = 1.4;
		s.connect(hp);
		hp.connect(gg);
		gg.connect(out);
		const s2 = loop(B[1]),
			hp2 = bq("highpass");
		hp2.frequency.value = 3000;
		const g2 = g();
		g2.gain.value = 0.04;
		s2.connect(hp2);
		hp2.connect(g2);
		g2.connect(out);
	} else if (nm === "OCEAN") {
		const s = loop(B[0]),
			lp = bq("lowpass");
		lp.frequency.value = 800;
		const a = g();
		a.gain.value = 0.5;
		s.connect(lp);
		lp.connect(a);
		const o = AC.createOscillator();
		o.frequency.value = 0.09;
		const og = g();
		og.gain.value = 0.4;
		o.connect(og);
		og.connect(a.gain);
		o.start();
		a.connect(out);
	} else {
		const s = loop(B[0]),
			lp = bq("lowpass");
		lp.frequency.value = 3500;
		const gg = g();
		gg.gain.value = 1.1;
		s.connect(lp);
		lp.connect(gg);
		gg.connect(out);
		const s2 = loop(B[1]),
			lp2 = bq("lowpass");
		lp2.frequency.value = 300;
		const g2 = g();
		g2.gain.value = 0.5;
		s2.connect(lp2);
		lp2.connect(g2);
		g2.connect(out);
	}
	out.connect(A.bed);
	A.layers[nm] = out;
}

/* ---- the output guard (ear protection) ----
   The last processing stage before MASTER, an AudioWorklet (prototype stand-in for what the firmware does in its output loop; all of it is per-sample maths on a mono-linked peak):
   1. NaN / Infinity are replaced by 0 and counted, finite samples are clamped to +-64; a 5 Hz DC blocker follows, then +2.4 dB of make-up (it replaces the 1.4 dB the browser compressors added at the old master gain) and a glue compressor (peak envelope, 12 ms attack, 250 ms release, threshold -8 dBFS after the make-up, 2:1).
   2. a slow RMS leveler: if the level over ~150 ms goes above RM (-10.5 dBFS RMS) the gain comes down (30 ms attack, 600 ms release), so nothing can sit loud for long.
   3. a look-ahead brick-wall limiter, ceiling C: audio is delayed L samples (1.5 ms), the gain is the moving average over L samples of the sliding minimum over L samples of C/peak,
      which cannot exceed C/peak at any sample, then a release smoother that is only allowed to lower it. No sample ever leaves above C (tests/safety.js).
   4. a trip wire: input above 16x full scale for 3 ms, or the limiter 24 dB down for 100 ms, mutes in 8 ms, holds 250 ms, and comes back over 1.2 s once the input is calm (3 trips in 10 s hold 3 s).
   Cost on the device: about 40 operations per sample, 2 x 66 samples of delay (264 bytes at 16 bit), a 70-entry min queue, and a 4-point midpoint check so the intersample peak is held too. */
const GUARD_WORKLET = `
class MellowGuard extends AudioWorkletProcessor{
 constructor(o){super();const sr=sampleRate,c=(o&&o.processorOptions)||{};
  this.C=c.ceil||.92;this.RM=c.rms||.30;this.OV=c.over||16;
  const L=Math.max(32,Math.round(sr*.0015));this.L=L;let M=256;while(M<L*2+8)M*=2;this.mk=M-1;
  this.d0=new Float32Array(M);this.d1=new Float32Array(M);this.w=0;this.qi=new Float64Array(M);this.qv=new Float32Array(M);this.qh=0;this.qc=0;
  this.gr=new Float32Array(L).fill(1);this.gw=0;this.sum=L;this.gs=1;this.n=0;
  this.a1=this.a2=this.a3=this.b1=this.b2=this.b3=0;this.R=1-2*Math.PI*5/sr;this.px0=0;this.py0=0;this.px1=0;this.py1=0;
  this.kca=1-Math.exp(-1/(.012*sr));this.kcr=1-Math.exp(-1/(.25*sr));this.ce=0;this.ke=1-Math.exp(-1/(.15*sr));this.ka=1-Math.exp(-1/(.03*sr));this.kb=1-Math.exp(-1/(.6*sr));this.kr=1-Math.exp(-1/(.1*sr));this.e=0;this.G=1;
  this.s=1;this.st=1;this.ds=1/(.008*sr);this.du=1/(1.2*sr);this.hold=0;this.calm=0;this.ov=0;this.deep=0;this.trips=[];this.blk=0;this.badT=-1e9;
  this.port.onmessage=m=>{const d=m.data;if(d.ceil)this.C=d.ceil;if(d.rms)this.RM=d.rms;if(d.over)this.OV=d.over}}
 trip(why){if(this.st===0)return;this.st=0;const sr=sampleRate,t=this.n/sr;this.trips=this.trips.filter(x=>t-x<10);this.trips.push(t);this.hold=this.n+(this.trips.length>=3?3:.25)*sr;this.calm=0;this.port.postMessage({k:'trip',why})}
 process(ins,outs){
  const I=ins[0]||[],O=outs[0];if(!O||!O.length)return true;const o0=O[0],o1=O[1]||O[0],nn=o0.length,a0=I[0],a1=I[1]||I[0];
  const L=this.L,mk=this.mk,d0=this.d0,d1=this.d1,qi=this.qi,qv=this.qv,gr=this.gr,C=this.C,RM=this.RM,sr=sampleRate;
  let w=this.w,qh=this.qh,qc=this.qc,gw=this.gw,sum=0,gs=this.gs,n=this.n,e=this.e,G=this.G,s=this.s,bad=0,pk=0,gmin=1;
  for(let k=0;k<L;k++)sum+=gr[k];
  for(let i=0;i<nn;i++,n++){
   let a=a0?a0[i]:0,b=a1?a1[i]:0;
   if(!(a>-1e6&&a<1e6)){a=0;bad++}else if(a>64)a=64;else if(a<-64)a=-64;
   if(!(b>-1e6&&b<1e6)){b=0;bad++}else if(b>64)b=64;else if(b<-64)b=-64;
   let ya=a-this.px0+this.R*this.py0,yb=b-this.px1+this.R*this.py1;this.px0=a;this.px1=b;if(ya>-1e-20&&ya<1e-20)ya=0;if(yb>-1e-20&&yb<1e-20)yb=0;this.py0=ya;this.py1=yb;
   const m0=Math.max(ya<0?-ya:ya,yb<0?-yb:yb);
   if(m0>this.OV){if(++this.ov>.003*sr)this.trip('over')}else if(this.ov>0)this.ov-=.25;
   ya*=1.32;yb*=1.32;{const pc=m0*1.32,ce=this.ce+(pc-this.ce)*(pc>this.ce?this.kca:this.kcr);this.ce=ce;if(ce>.4){const cg=Math.pow(ce*2.5,-.5);ya*=cg;yb*=cg}}
   e+=((ya*ya+yb*yb)*.5-e)*this.ke;const rm=Math.sqrt(e),tg=rm>RM?RM/rm:1;G+=(tg-G)*(tg<G?this.ka:this.kb);
   if(G<.12){if(++this.deep>.4*sr)this.trip('level')}else if(this.deep>0)this.deep--;
   ya*=G;yb*=G;d0[w]=ya;d1[w]=yb;
   /* the detector looks at sample n-1 and at the midpoint between n-2 and n-1 (a 4-point interpolation), so the intersample (true) peak is held too, not just the sample peak */
   const ma=(9*(this.a2+this.a1)-(this.a3+ya))*.0625,mb=(9*(this.b2+this.b1)-(this.b3+yb))*.0625;
   let pa=Math.max(this.a1<0?-this.a1:this.a1,this.b1<0?-this.b1:this.b1,ma<0?-ma:ma,mb<0?-mb:mb);this.a3=this.a2;this.a2=this.a1;this.a1=ya;this.b3=this.b2;this.b2=this.b1;this.b1=yb;
   const gt=pa>C?C/pa:1;
   while(qc>0&&qv[(qh+qc-1)&mk]>=gt)qc--;qi[(qh+qc)&mk]=n;qv[(qh+qc)&mk]=gt;qc++;while(qi[qh]<=n-L){qh=(qh+1)&mk;qc--}
   const gm=qv[qh];sum+=gm-gr[gw];gr[gw]=gm;if(++gw===L)gw=0;
   const avg=sum/L,rel=gs+(1-gs)*this.kr;gs=avg<rel?avg:rel;if(gs<gmin)gmin=gs;
   if(gs<.0625){if(++this.deep>.1*sr)this.trip('limit')}
   if(this.st===0){if(m0<2)this.calm++;else this.calm=0;if(n>=this.hold&&this.calm>.3*sr){this.st=1}}
   if(s>this.st){s-=this.ds;if(s<this.st)s=this.st}else if(s<this.st){s+=this.du;if(s>this.st)s=this.st}
   const j=(w-L)&mk,y0=d0[j]*gs*s,y1=d1[j]*gs*s;o0[i]=y0;if(o1!==o0)o1[i]=y1;w=(w+1)&mk;
   const q=y0<0?-y0:y0,q1=y1<0?-y1:y1;if(q>pk)pk=q;if(q1>pk)pk=q1}
  this.w=w;this.qh=qh;this.qc=qc;this.gw=gw;this.gs=gs;this.n=n;this.e=e;this.G=G;this.s=s;
  if(bad&&n-this.badT>.2*sr){this.badT=n;this.port.postMessage({k:'nan',n:bad})}
  if((++this.blk&15)===0)this.port.postMessage({k:'m',pk,gr:gmin,lv:G,rms:Math.sqrt(e),s});
  return true}}
registerProcessor('mellow-guard',MellowGuard);`;

function audioInit() {
	const Ctx = window.AudioContext || window.webkitAudioContext;
	if (!Ctx) {
		return;
	}
	try {
		if (navigator.audioSession) {
			navigator.audioSession.type = "playback";
		}
	} catch (e) {
		/* nothing to do */
	}
	try {
		AC = new Ctx({ sampleRate: 44118, latencyHint: "interactive" });
	} catch (e) {
		AC = new Ctx({ latencyHint: "interactive" });
	}
	const g = () => AC.createGain(),
		bq = (t) => {
			const n = AC.createBiquadFilter();
			n.type = t;
			return n;
		};
	A.master = g();
	A.muteG = g();
	A.comp = AC.createDynamicsCompressor();
	A.comp.threshold.value = -14;
	A.comp.ratio.value = 4;
	A.comp.attack.value = 0.01;
	A.comp.release.value = 0.25;
	// glue compressor -> brick-wall limiter -> soft clipper: a sudden peak is squashed, and anything the limiter misses is rounded off, never hard-clipped
	A.lim = AC.createDynamicsCompressor();
	A.lim.threshold.value = -3;
	A.lim.knee.value = 0;
	A.lim.ratio.value = 20;
	A.lim.attack.value = 0.001;
	A.lim.release.value = 0.12;
	A.clipIn = g();
	A.clipIn.gain.value = 0.5;
	A.clip = AC.createWaveShaper();
	A.clip.curve = softClipCurve();
	// MASTER (the user's volume, at most .88) comes after the limiter and the soft clip, so the ceiling is absolute: sample peak <= .88 x .91 = .80 (-1.9 dBFS), and the last node is a hard clamp at -1 dBFS
	// that can never act unless something upstream is broken. MUTEG starts at 0 and fades in (and again after every resume), so the first sound after load / unlock / resume can never burst.
	A.fin = AC.createWaveShaper();
	A.fin.curve = clampCurve(FIN_CEIL);
	A.pre = g();
	A.pre.connect(A.comp);
	A.comp.connect(A.lim);
	A.lim.connect(A.clipIn);
	A.clipIn.connect(A.clip);
	A.clip.connect(A.master);
	A.master.connect(A.muteG);
	A.muteG.connect(A.fin);
	A.fin.connect(AC.destination);
	A.muteG.gain.value = 0;
	safeFade(0.3);
	try {
		const r0 = AC.resume.bind(AC);
		AC.resume = function () {
			safeFade(0.25, true);
			return r0();
		};
	} catch (e) {
		/* nothing to do */
	}
	AC.onstatechange = () => {
		if (AC.state !== "running") {
			try {
				A.muteG.gain.cancelScheduledValues(0);
				A.muteG.gain.value = 0;
			} catch (e) {
				/* nothing to do */
			}
		} else if (A.muteG.gain.value < 0.001) {
			safeFade(0.25);
		}
	}; /* suspended / interrupted (a phone call): silent until it runs again, then ramped */
	loadGuard();
	A.an = AC.createAnalyser();
	A.an.fftSize = 2048;
	A.trBuf = new Float32Array(512);

	A.tr = [];
	A.trAn = [];
	for (let i = 0; i < 4; i++) {
		const t = g(),
			an = AC.createAnalyser();
		an.fftSize = 512;
		t.connect(an);
		A.tr.push(t);
		A.trAn.push(an);
	}
	startFm(); /* the worklet loads on its own thread while the rest of the graph is built below */

	// Every track has its own insert chain (filter, tape, distortion, chorus, phaser, warmth). The reverb and the echo are ONE of each, shared by the four tracks
	// (the FM-1's 8 KB effects arena only holds one of each); each track has its own send level into them.
	A.wowO = AC.createOscillator();
	A.wowO.frequency.value = 0.55;
	A.wowO.start();
	A.fluO = AC.createOscillator();
	A.fluO.frequency.value = 6.3;
	A.fluO.start();
	A.dry = g();
	A.dust = g();
	A.dust.gain.value = 0;
	A.post = g();
	A.dust.connect(A.post);
	A.post.connect(A.dry);
	A.bedBusy = {};
	A.eIn = g();
	A.eW = g();
	echoMake();
	A.reverbIn = g();
	A.rW = g();
	convMake();
	A.fxn = [];
	A.lastDrv = [];
	A.lastBits = [];
	A.lastDg = [];
	for (let i = 0; i < 4; i++) {
		A.fxn.push(fxTrack(i));
	}
	A.white = noiseBuf(2, "white");
	const loop = (b) => {
		const s = AC.createBufferSource();
		s.buffer = b;
		s.loop = true;
		s.start();
		return s;
	};
	A.warm = g();
	A.sum = A.warm;
	[A.dry, A.eW, A.rW].forEach((n) => n.connect(A.warm));
	A.warm.connect(A.pre);
	A.warm.connect(A.an);
	A.bed = g();
	A.bedAn = AC.createAnalyser();
	A.bedAn.fftSize = 512;
	A.bed.connect(A.bedAn);
	A.bed.connect(A.warm);
	A.layers = {};
	A.on = true;
	S.sleepT0 = performance.now();
	A.gA = AC.currentTime;
	for (let t = 0; t < 4; t++) {
		try {
			const c = AC.createConstantSource();
			c.offset.value = A.bndC[t] || 0;
			c.start();
			A.bendCs[t] = c;
		} catch (e) {
			A.bendCs[t] = null;
		}
	} // pitch bend for the oscillator and sampler voices, one source per track (cents, added to their detune)
	audioSync();
	A.la = LA0;
	A.tkP = 0;
	A.laCalm = 0;
	A.timer = setInterval(() => {
		try {
			tick();
		} catch (e) {
			console.error("tick", e);
		}
	}, 25);
	A.bedT = setTimeout(() => {
		const q = ["DUST", "RAIN", "VINYL", "OCEAN", "FIRE"],
			go = () => {
				const n = q.shift();
				if (n) {
					bedWant(n, () => setTimeout(go, 60));
				}
			};
		go();
	}, 1500); /* one bed per task, after the first notes */
	document.addEventListener("visibilitychange", () => {
		if (!AC) {
			return;
		}
		let pr;
		if (document.hidden) {
			try {
				A.muteG.gain.cancelScheduledValues(0);
				A.muteG.gain.value = 0;
			} catch (e) {
				/* nothing to do */
			}
			pr = AC.suspend();
		} else {
			pr = AC.resume();
		}
		if (pr && pr.catch) {
			pr.catch(() => {});
		}
	}); /* silent before it suspends, ramped after it resumes: a resume never bursts */
}

const FIN_CEIL = 0.89,
	MASTER_MAX = 0.88;
/* -1 dBFS: the very last node clamps here */
function clampCurve(c) {
	const n = 2049,
		a = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const x = (i / (n - 1)) * 2 - 1;
		a[i] = Math.max(-c, Math.min(c, x));
	}
	return a;
}

/* the master mute gate: 0 -> 1 over sec. The start is a value, not a ramp from the old value, so a stale gain can never leak through. */
function safeFade(sec, fromZero) {
	if (!AC || !A.muteG) {
		return;
	}
	const t = AC.currentTime,
		p = A.muteG.gain;
	A.fadeT = t;
	try {
		p.cancelScheduledValues(t);
		p.setValueAtTime(0, t);
		p.linearRampToValueAtTime(1, t + sec);
	} catch (e) {
		/* nothing to do */
	}
}

/* the guard worklet replaces the two compressor nodes in the path as soon as it has loaded (the compressor limiter stays as the fallback where worklets are missing, e.g. very old browsers) */
async function loadGuard() {
	try {
		if (window.__noWorklet || !AC.audioWorklet || typeof AudioWorkletNode === "undefined") {
			throw new Error("no worklet");
		}
		const url = URL.createObjectURL(new Blob([GUARD_WORKLET], { type: "text/javascript" }));
		try {
			await AC.audioWorklet.addModule(url);
		} finally {
			URL.revokeObjectURL(url);
		}
		const node = new AudioWorkletNode(AC, "mellow-guard", {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [2],
			channelCount: 2,
			channelCountMode: "explicit",
			processorOptions: { ceil: GUARD_CEIL, rms: GUARD_RMS },
		});
		node.port.onmessage = (m) => guardMsg(m.data);
		const t = AC.currentTime,
			p = A.muteG.gain,
			v = p.value;
		p.cancelScheduledValues(t);
		p.setValueAtTime(v, t);
		p.linearRampToValueAtTime(
			0,
			t + 0.01,
		); /* a short dip while the limiter changes, so the switch cannot click */
		await new Promise((r) => setTimeout(r, 30));
		A.pre.disconnect();
		A.comp.disconnect();
		A.lim.disconnect();
		A.pre.connect(node);
		node.connect(A.clipIn);
		A.guard = node;
		A.gOn = true;
		const t2 = AC.currentTime;
		p.cancelScheduledValues(t2);
		p.setValueAtTime(0, t2);
		p.linearRampToValueAtTime(1, t2 + (v < 0.5 ? 0.25 : 0.06));
	} catch (e) {
		A.gOn = false;
		A.gErr = String(e);
	}
}

const GUARD_CEIL = 0.92,
	GUARD_RMS = 0.3;

/* the main-thread watchdog (it covers the case without the guard worklet, and a NaN anywhere): the master mix (before the compressor) went NaN or above 4x full scale RMS: mute in ~10 ms, rebuild the feedback paths, come back over 0.6 s */
function guardWatch() {
	if (!AC || (A.dukT && performance.now() - A.dukT < 1200)) {
		return;
	}
	A.dukT = performance.now();
	A.trips = (A.trips || 0) + 1;
	A.lastTrip = isFinite(A.rms) ? "level" : "nan";
	S.pop = null;
	S.toast = { s: "LEVEL SAFETY: OUTPUT MUTED", t: performance.now() };
	try {
		const t = AC.currentTime,
			p = A.muteG.gain;
		p.cancelScheduledValues(t);
		p.setValueAtTime(p.value, t);
		p.linearRampToValueAtTime(0, t + 0.01);
	} catch (e) {
		/* nothing to do */
	}
	fxPanic();
	setTimeout(() => safeFade(0.6), 300);
}

function guardMsg(d) {
	if (d.k === "m") {
		A.gStat = d;
		return;
	}
	if (d.k === "trip") {
		A.trips = (A.trips || 0) + 1;
		A.lastTrip = d.why;
		S.pop = null;
		S.toast = { s: "LEVEL SAFETY: OUTPUT MUTED", t: performance.now() };
		fxPanic();
	} else if (d.k === "nan") {
		A.nans = (A.nans || 0) + d.n;
		fxPanic();
	}
}

/* something went wrong (NaN, runaway level): rebuild every feedback path, which is the only way to clear a poisoned filter or delay */
function fxPanic() {
	if (!AC || (A.panicT && performance.now() - A.panicT < 1000)) {
		return;
	}
	A.panicT = performance.now();
	A.panics = (A.panics || 0) + 1;
	if (typeof fxRebuild === "function") {
		fxRebuild();
	}
}

/* Web Audio keeps running a node whose gain is 0 (a gain of 0 still counts as sound), so every stage that is switched off kept the whole chain behind it (convolver, delays, compressors) running on silence. A stage whose mix is 0 is unplugged instead; plugging back in is at once, unplugging waits ms so its fade-out finishes. */
function gate(k, from, to, on, ms) {
	const G = A.gt || (A.gt = {}),
		s = G[k] || (G[k] = { c: true, t: 0 });
	if (on) {
		if (s.t) {
			clearTimeout(s.t);
			s.t = 0;
		}
		if (!s.c) {
			try {
				from.connect(to);
			} catch (e) {
				/* nothing to do */
			}
			s.c = true;
		}
	} else if (s.c && !s.t) {
		s.t = setTimeout(
			() => {
				s.t = 0;
				s.c = false;
				try {
					from.disconnect(to);
				} catch (e) {
					/* nothing to do */
				}
			},
			ms == null ? 1500 : ms,
		);
	}
}

function gates() {
	let dust = false;
	for (let i = 0; i < 4; i++) {
		const b = TK(i),
			f = b.fx,
			mood = b.mac[0] / 127,
			n = A.fxn[i];
		if (f.dust > 0 || mood > 0) {
			dust = true;
		}
		/* a stage that is off is not in the signal path at all (so it costs nothing); it is plugged in at once when it is switched on and unplugged 1.5 s after its mix reached 0 */
		const w = {
			F: f.fmix > 0,
			D: f.dmix > 0,
			C: f.cmix > 0,
			P: f.pmix > 0,
			T: f.wow > 0 || f.flu > 0 || mood > 0 || f.drv > 0,
			K: mood > 0,
		};
		let chg = false;
		for (const k in w) {
			if (w[k]) {
				if (n.tm[k]) {
					clearTimeout(n.tm[k]);
					n.tm[k] = 0;
				}
				if (!n.act[k]) {
					n.act[k] = true;
					chg = true;
				}
			} else if (n.act[k] && !n.tm[k]) {
				n.tm[k] = setTimeout(() => {
					n.tm[k] = 0;
					if (A.fxn[i] === n) {
						n.act[k] = false;
						fxRoute(n);
					}
				}, 1500);
			}
		}
		if (f.fmix < 100) {
			if (n.tm.W) {
				clearTimeout(n.tm.W);
				n.tm.W = 0;
			}
			if (n.act.W) {
				n.act.W = false;
				chg = true;
			}
		} /* a mix below 100 plugs the dry and wet gains back in at once; 100 leaves them out once they have settled */
		else if (!n.act.W && !n.tm.W) {
			n.tm.W = setTimeout(() => {
				n.tm.W = 0;
				if (A.fxn[i] === n && TK(i).fx.fmix >= 100) {
					n.act.W = true;
					fxRoute(n);
				}
			}, 300);
		}
		if (chg) {
			fxRoute(n);
		}
		gate("ei" + i, n.post, n.eS, f.emix > 0);
		gate("ri" + i, n.post, n.rS, f.rmix > 0);
	}
	gate("dust", A.dust, A.post, dust);
	S.scape.forEach((l) => {
		const o = A.layers[l.n];
		if (o) {
			gate("L" + l.n, o, A.bed, l.lv > 0);
		}
	});
}

/* ---- the graph pieces (built once, and again by fxRebuild) ---- */
function echoMake() {
	const g = () => AC.createGain(),
		bq = (t) => {
			const x = AC.createBiquadFilter();
			x.type = t;
			return x;
		};
	A.eD = AC.createDelay(2);
	A.eFb = g();
	A.eLP = bq("lowpass");
	A.eHP = bq("highpass");
	A.eHP.frequency.value = 150;
	A.eHP.Q.value = 0;
	A.eSat = AC.createWaveShaper();
	A.eSat.curve = echoSatCurve();
	A.eIn.connect(A.eD);
	A.eD.connect(A.eLP);
	A.eLP.connect(A.eHP);
	A.eHP.connect(A.eSat);
	A.eSat.connect(A.eFb);
	A.eFb.connect(A.eD);
	A.eSat.connect(A.eW);
}

function echoSatCurve() {
	const n = 2049,
		c = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const x = (i / (n - 1)) * 2 - 1;
		c[i] = Math.tanh(1.2 * x) / 1.2;
	}
	return c;
}

/* distortion: make-up gain so a .25 sine leaves about as loud as it went in (+0.8 dB) at every GAIN setting; the old curve peaked at .6 whatever the drive, which was up to 12 dB louder at the top */
function distCurve(k) {
	const m = 2048,
		c = new Float32Array(m),
		N = 256;
	let s = 0;
	for (let j = 0; j < N; j++) {
		const y = Math.tanh(k * 0.25 * Math.sin((2 * Math.PI * j) / N));
		s += y * y;
	}
	const gain = ((0.25 / Math.SQRT2) * 1.1) / Math.sqrt(s / N);
	for (let j = 0; j < m; j++) {
		const x = (j / (m - 1)) * 2 - 1;
		c[j] = Math.tanh(x * k) * gain;
	}
	return c;
}

function convMake() {
	A.conv = AC.createConvolver();
	if (A.irBuf) {
		A.conv.buffer = A.irBuf;
	}
	A.reverbIn.connect(A.conv);
	A.conv.connect(A.rW);
}

/* one track's insert chain. Stages (each a pair of nodes in and out): filter F -> distortion D -> chorus C -> phaser P, then the tape stage T (wow/flutter delay, saturation, bit crush; K = the crusher inside it),
   then warmth. fxRoute wires only the stages that are on, so the default sound runs through the filter and warmth alone. */
function fxTrack(i) {
	const g = () => AC.createGain(),
		bq = (t) => {
			const x = AC.createBiquadFilter();
			x.type = t;
			return x;
		},
		n = {
			idx: i,
			L: new Map(),
			act: { F: true, W: false, D: false, C: false, P: false, T: false, K: false },
			tm: {},
		};
	n.fDry = g();
	n.fWet = g();
	n.filt = bq("lowpass");
	n.tapeIn = g();
	n.filt.connect(n.fWet);
	n.fDry.connect(n.tapeIn);
	n.fWet.connect(n.tapeIn);
	n.dDry = g();
	n.dWet = g();
	n.dsO = g();
	n.dist = AC.createWaveShaper();
	n.dist.oversample = "2x";
	n.distT = bq("lowpass");
	n.dist.connect(n.distT);
	n.distT.connect(n.dWet);
	n.dDry.connect(n.dsO);
	n.dWet.connect(n.dsO);
	n.cDry = g();
	n.cWet = g();
	n.csO = g();
	n.chD = AC.createDelay(0.05);
	n.chD.delayTime.value = 0.015;
	n.chD.connect(n.cWet);
	n.cDry.connect(n.csO);
	n.cWet.connect(n.csO);
	n.chO = AC.createOscillator();
	n.chG = g();
	n.chO.connect(n.chG);
	n.chG.connect(n.chD.delayTime);
	n.chO.start();
	n.pDry = g();
	n.pWet = g();
	n.psO = g();
	n.phF = [];
	let last = null;
	for (let k = 0; k < 4; k++) {
		const fl = bq("allpass");
		fl.frequency.value = 500 + k * 700;
		fl.Q.value = 0.7;
		if (last) {
			last.connect(fl);
		}
		last = fl;
		n.phF.push(fl);
	}
	last.connect(n.pWet);
	n.pDry.connect(n.psO);
	n.pWet.connect(n.psO);
	n.phO = AC.createOscillator();
	n.phG = g();
	n.phO.connect(n.phG);
	n.phF.forEach((fl) => n.phG.connect(fl.frequency));
	n.phO.start();
	n.tB = g();
	n.tT = g();
	n.tT.gain.value = 0;
	n.wow = AC.createDelay(0.1);
	n.wow.delayTime.value =
		Math.round(0.005 * AC.sampleRate) /
		AC.sampleRate; /* a whole number of samples, so the still tape stage does not roll off the highs */
	n.wowG = g();
	A.wowO.connect(n.wowG);
	n.wowG.connect(n.wow.delayTime);
	n.fluG = g();
	A.fluO.connect(n.fluG);
	n.fluG.connect(n.wow.delayTime);
	n.sat = AC.createWaveShaper();
	n.crush = AC.createWaveShaper();
	n.wow.connect(n.sat);
	n.warm = bq("lowpass");
	n.tB.connect(n.warm);
	n.tT.connect(n.warm);
	n.post = n.warm;
	n.post.connect(A.dry);
	n.eS = g();
	n.rS = g();
	n.post.connect(n.eS);
	n.post.connect(n.rS);
	n.eS.connect(A.eIn);
	n.rS.connect(A.reverbIn);
	n.sF = { k: "F", i: [n.fDry, n.filt], o: n.tapeIn };
	n.sW = { k: "F", i: [n.filt], o: n.filt };
	n.sD = { k: "D", i: [n.dDry, n.dist], o: n.dsO };
	n.sC = { k: "C", i: [n.cDry, n.chD], o: n.csO };
	n.sP = { k: "P", i: [n.pDry, n.phF[0]], o: n.psO };
	fxRoute(n);
	return n;
}

let NID = 0;

function fxLink(n, a, b) {
	const k = (a._i || (a._i = ++NID)) + ">" + (b._i || (b._i = ++NID));
	if (!n.L.has(k)) {
		n.L.set(k, [a, b]);
		try {
			a.connect(b);
		} catch (e) {
			/* nothing to do */
		}
	}
	return k;
}

function fxRoute(n) {
	const want = new Set(),
		add = (a, b) => want.add(fxLink(n, a, b));
	let src = [A.tr[n.idx]];
	[n.act.W ? n.sW : n.sF, n.sD, n.sC, n.sP].forEach((s) => {
		if (!n.act[s.k]) {
			return;
		}
		src.forEach((x) => s.i.forEach((d) => add(x, d)));
		src = [s.o];
	});
	src.forEach((x) => {
		add(x, n.tB);
		if (n.act.T) {
			add(x, n.wow);
		}
	});
	if (n.act.T) {
		add(n.sat, n.act.K ? n.crush : n.tT);
		if (n.act.K) {
			add(n.crush, n.tT);
		}
	}
	n.L.forEach((v, k) => {
		if (!want.has(k)) {
			n.L.delete(k);
			try {
				v[0].disconnect(v[1]);
			} catch (e) {
				/* nothing to do */
			}
		}
	});
}

function fxKill(n) {
	for (const k in n.tm) {
		if (n.tm[k]) {
			clearTimeout(n.tm[k]);
		}
	}
	n.L.forEach((v) => {
		try {
			v[0].disconnect(v[1]);
		} catch (e) {
			/* nothing to do */
		}
	});
	n.L.clear();
	try {
		n.chO.stop();
		n.phO.stop();
	} catch (e) {
		/* nothing to do */
	}
	[n.post, n.eS, n.rS, n.wowG, n.fluG].forEach((x) => {
		try {
			x.disconnect();
		} catch (e) {
			/* nothing to do */
		}
	});
	try {
		A.wowO.disconnect(n.wowG);
		A.fluO.disconnect(n.fluG);
	} catch (e) {
		/* nothing to do */
	}
}

/* the emergency reset: a NaN gets stuck forever in a filter or a delay loop, so every track chain, the echo loop and the reverb are rebuilt from scratch (a few ms of work, nothing is allocated per sample) */
function fxRebuild() {
	if (!AC || !A.fxn) {
		return;
	}
	for (let i = 0; i < 4; i++) {
		const o = A.fxn[i];
		fxKill(o);
		for (const k of ["ei" + i, "ri" + i]) {
			if (A.gt && A.gt[k] && A.gt[k].t) {
				clearTimeout(A.gt[k].t);
			}
			if (A.gt) {
				delete A.gt[k];
			}
		}
		A.lastDrv[i] = A.lastBits[i] = A.lastDg[i] = undefined;
		A.fxn[i] = fxTrack(i);
	}
	[A.eIn, A.eD, A.eLP, A.eHP, A.eSat, A.eFb].forEach((x) => {
		try {
			x.disconnect();
		} catch (e) {
			/* nothing to do */
		}
	});
	echoMake();
	try {
		A.reverbIn.disconnect();
		A.conv.disconnect();
	} catch (e) {
		/* nothing to do */
	}
	convMake();
	A.rebuilt = (A.rebuilt || 0) + 1;
	audioSync();
}

function sleepLeft(live) {
	const sl = slp();
	if (!sl) {
		return 0;
	}
	if (!live) {
		return sl - 2;
	}
	if (!S.sleepT0) {
		return sl;
	}
	return Math.max(0, sl - (performance.now() - S.sleepT0) / 60000);
}

/* the fade has finished: stop everything that would keep playing (or sending MIDI) in silence; any input wakes it up again */
function sleepCheck() {
	if (!slp() || sleepLeft(true) > 0) {
		A.slept = false;
		return;
	}
	if (A.slept) {
		return;
	}
	A.slept = true;
	const rec0 = S.rec && S.playing;
	if (S.playing) {
		S.playing = false;
		stopSeq();
	}
	S.rec = false;
	S.countdown = null;
	if (rec0) {
		finishRec();
	}
	S.recExt = false; /* a recording that falls asleep ends like STOP does (trims a growing pattern, saves); recExt used to stay on and the next plain PLAY grew the pattern */
	S.gen.on = false;
	A.arps.forEach((x) => x.clear());
	A.arpKeys = {};
	for (let t = 0; t < 4; t++) {
		releaseLatch(t);
		qClear(t);
	}
}

function wake() {
	if (AC && slp() && sleepLeft(true) <= 0) {
		S.sleepT0 = performance.now();
		A.slept = false;
		audioSync();
	}
}

// The reverb and the echo exist once (shared by the four tracks), so their character (reverb type, size, damping; echo time, feedback, tone) is one
// setting: whichever track you edit it on, the other tracks' copies follow. Everything else in S.fx is that track's own.
const SHK = ["rt", "size", "damp", "et", "efb", "etone"];

let SHV = null;

function fxShare() {
	const f = S.fx;
	if (!SHV) {
		SHV = {};
		SHK.forEach((k) => (SHV[k] = f[k]));
	} else if (SHK.some((k) => f[k] !== SHV[k])) {
		SHK.forEach((k) => (SHV[k] = f[k]));
	}
	S.tk.forEach((b) => SHK.forEach((k) => (b.fx[k] = SHV[k])));
}

// the key lights, the scale's ROOT and its TYPE are one setting for all four tracks (the lit piano is the same whichever track is selected);
// CHORD, SPREAD and the per-track scale features stay each track's own. Whichever track you edit them on, the other tracks follow.
const SCK = ["root", "type", "hl"];

let SCV = null;

function scaleShare() {
	const f = S.scale;
	if (!f) {
		return;
	}
	if (!SCV) {
		SCV = {};
		SCK.forEach((k) => (SCV[k] = f[k]));
	} else if (SCK.some((k) => f[k] !== SCV[k])) {
		SCK.forEach((k) => (SCV[k] = f[k]));
	}
	S.tk.forEach((b) => SCK.forEach((k) => (b.scale[k] = SCV[k])));
}

function audioSync() {
	fxShare();
	scaleShare();
	if (!AC) {
		return;
	}
	const t = AC.currentTime,
		sf = S.fx;
	const sl = slp(),
		rem = sleepLeft(true),
		fade = sl ? clamp(rem / (sl * 0.2), 0, 1) : 1;
	{
		const mg = Math.pow(S.vol / 100, 1.6) * MASTER_MAX * fade;
		if (!A.mgSet) {
			A.mgSet = 1;
			A.master.gain.value = mg;
		} else {
			A.master.gain.setTargetAtTime(mg, t, 0.1);
		}
	} /* the first value is set outright: a fresh gain node starts at 1, which is louder than the ceiling allows */
	let dust = 0,
		emix = 0;
	/* P: schedule a parameter only when its target changed (and is a finite number): a steady state costs nothing, and a NaN can never reach the graph (setTargetAtTime would throw on it) */
	const P = (p, v, c) => {
		if (p._v !== v && isFinite(v)) {
			p._v = v;
			p.setTargetAtTime(v, t, c);
		}
	};
	/* Q: the same for a parameter inside a stage; while that stage is out of the signal path nothing processes it, so its value is set outright (no automation events pile up on a node nobody pulls, and it is already right when the stage is plugged in) */
	const Q = (p, v, c, on) => {
		if (p._v !== v && isFinite(v)) {
			p._v = v;
			if (on) {
				p.setTargetAtTime(v, t, c);
			} else {
				p.cancelScheduledValues(0);
				p.value = v;
			}
		}
	};
	for (let i = 0; i < 4; i++) {
		const b = TK(i),
			f = b.fx,
			mood = b.mac[0] / 127,
			sp = b.mac[2] / 127,
			n = A.fxn[i];
		P(A.tr[i].gain, Math.pow(S.tracks[i].vol / 100, 1.4) * 0.8, 0.03);
		P(n.warm.frequency, 700 * Math.pow(18000 / 700, b.mac[1] / 127), 0.05);
		{
			const ty = ["lowpass", "bandpass", "highpass"][f.ft];
			if (n.filt.type !== ty) {
				n.filt.type = ty;
			}
		}
		Q(n.filt.frequency, 20 * Math.pow(1000, f.cut / 127), 0.03, n.act.F);
		Q(n.filt.Q, 0.7 + (f.res / 99) * 9, 0.03, n.act.F);
		P(n.fWet.gain, f.fmix / 100, 0.03);
		P(n.fDry.gain, 1 - f.fmix / 100, 0.03);
		Q(n.wowG.gain, (f.wow / 99) * 0.002 + mood * 0.002, 0.1, n.act.T);
		Q(n.fluG.gain, (f.flu / 99) * 0.0003 + mood * 0.0002, 0.1, n.act.T);
		{
			const tape = f.wow > 0 || f.flu > 0 || mood > 0 || f.drv > 0;
			P(n.tB.gain, tape ? 0 : 1, 0.012);
			P(n.tT.gain, tape ? 1 : 0, 0.012);
		} /* the tape stage is crossfaded in and out (it delays by 5 ms); it is unplugged when it is off */
		if (A.lastDrv[i] !== f.drv) {
			A.lastDrv[i] = f.drv;
			n.sat.curve = satCurve(0.02 + (f.drv / 99) * 6);
		}
		const bits = Math.round(12 - mood * 7);
		if (A.lastBits[i] !== bits) {
			A.lastBits[i] = bits;
			n.crush.curve = crushCurve(bits);
		}
		if (A.lastDg[i] !== f.dg) {
			A.lastDg[i] = f.dg;
			n.dist.curve = distCurve(1 + (f.dg / 99) * 30);
		}
		Q(n.distT.frequency, 800 * Math.pow(16, f.dt / 99), 0.05, n.act.D);
		P(n.dWet.gain, f.dmix / 100, 0.03);
		P(n.dDry.gain, 1 - f.dmix / 100, 0.03);
		Q(n.chO.frequency, 0.1 + (f.cr / 99) * 5, 0.05, n.act.C);
		Q(
			n.chG.gain,
			Math.min(0.0002 + (f.cd / 99) * 0.006, 0.045 / (2 * Math.PI * (0.1 + (f.cr / 99) * 5))),
			0.05,
			n.act.C,
		);
		P(n.cWet.gain, (f.cmix / 100) * 0.8, 0.03);
		P(n.cDry.gain, 1 - (f.cmix / 100) * 0.4, 0.03);
		Q(n.phO.frequency, 0.05 + (f.pf / 99) * 4, 0.05, n.act.P);
		Q(n.phG.gain, (f.pd / 99) * 450, 0.05, n.act.P);
		P(n.pWet.gain, (f.pmix / 100) * 0.8, 0.03);
		P(n.pDry.gain, 1 - (f.pmix / 100) * 0.4, 0.03);
		P(n.eS.gain, (f.emix / 100) * (0.35 + sp) * 0.6, 0.05);
		P(n.rS.gain, (f.rmix / 100) * (0.35 + sp * 1.2) * 0.7, 0.05); // this track's sends into the shared echo and reverb
		dust = Math.max(dust, (f.dust / 99) * 0.05 + mood * 0.05);
		emix = Math.max(emix, f.emix);
	}
	P(A.dust.gain, dust, 0.1);
	{
		const dt = ((x) => (x > 2 ? x / 2 : x))((60 / S.bpm) * [0.5, 1, 1.5, 2][sf.et]),
			dp = A.eD.delayTime;
		if (isFinite(dt) && (A.eTg !== dt || A.eDprev !== A.eD)) {
			const first = A.eTg === undefined || A.eDprev !== A.eD;
			A.eTg = dt;
			A.eDprev = A.eD;
			if (first) {
				dp.value = dt;
			} else {
				const cur = dp.value;
				dp.cancelScheduledValues(t);
				dp.setValueAtTime(cur, t);
				dp.linearRampToValueAtTime(dt, t + Math.abs(dt - cur) / 0.2);
			}
		}
	}
	P(A.eLP.frequency, 500 * Math.pow(12, sf.etone / 99), 0.05);
	if (!(A.killT && performance.now() < A.killT)) {
		P(A.eFb.gain, emix > 0 ? (sf.efb / 99) * 0.8 : 0, 0.05);
		P(A.eW.gain, 1, 0.05);
		P(A.rW.gain, A.irHold ? 0 : 1, A.irHold ? 0.008 : 0.05);
	} /* (not while KILL is flushing the echo and reverb) */
	const key = sf.rt + "|" + sf.size + "|" + sf.damp;
	if (A.irKey !== key) {
		A.irKey = key;
		clearTimeout(A.irT);
		A.irT = setTimeout(() => swapIR(sf), A.irReady ? 180 : 0);
	}
	S.scape.forEach((l) => {
		const o = A.layers[l.n];
		if (o) {
			o.gain.setTargetAtTime((l.lv / 100) * 0.25, t, 0.15);
		} else if (l.lv > 0) {
			bedWant(l.n);
		}
	});
	pushFmTune();
	gates();
}
