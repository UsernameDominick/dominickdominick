// per-track state and starting a new project
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// what is under a touch on the screen: a graph to draw on, a value to swipe, or nothing special
function lcdZone(x, y) {
	if (S.dlg || S.screen === "boot") {
		return null;
	}
	const s = S.screen;
	if (y >= 205) {
		const c = clamp(Math.floor(x / 60), 0, 3),
			k = knobs()[c];
		return k && k.set ? { t: "knob", c, tap: true } : null;
	}
	if (s === "pp") {
		const pg = ppPages(),
			cur = pg[clamp(S.ppPage, 0, pg.length - 1)];
		if (cur.z) {
			const zz = cur.z(x, y);
			if (zz) {
				return zz;
			}
			if (y >= GB.y && y < GB.y + GB.h) {
				return null;
			}
		} /* the QUEUE and STRIP pages draw their own pictures (no graph editing) and name their own touch zones */
		if (cur.g && x >= GB.x && x < GB.x + GB.w && y >= GB.y && y < GB.y + GB.h) {
			return onQS() ? null : { t: "graph", cur };
		}
		if (y >= 29 && y < 108) {
			const k = (y < 69 ? 0 : 2) + (x < 120 ? 0 : 1),
				q = cur.p[k];
			if (q && q.set) {
				return { t: "knob", c: k, tap: DESK.matches || onQS() };
			}
		}
		return null;
	}
	if (s === "home") {
		if (x >= HM.wx && x < HM.wx + HM.ww && y >= HM.wy && y < HM.wy + HM.wh) {
			return { t: "home" };
		}
		if (y >= HM.ty && y < HM.ty + HM.th && x >= 6 && x < 234) {
			return { t: "tile", i: clamp(Math.floor((x - 6) / 57), 0, 3), tap: true };
		}
		return pvZone(HV, x, y);
	} /* the mini song player: tap a block = that slot (the song screen's row tap), drag sideways = scroll while stopped */
	if (s === "seq" && dgOn()) {
		return dgZone(x, y);
	}
	if (s === "seq" && !S.clr) {
		if (barZone(x, y)) {
			return { t: "bs", tap: true };
		}
		const gh = sqGateHit(x, y);
		if (gh) {
			return { t: "sq", kind: "gate", j: gh.j, x0g: gh.x0 };
		}
		const kind =
			y >= SQ.y0 - 2 && y < SQ.ny - 2
				? "bars"
				: y >= SQ.ky - 2 && y < SQ.ky + SQ.kh + 3
					? "box"
					: null;
		if (kind && x >= sqX0() && x < sqX0() + sqCW() * SPB()) {
			return { t: "sq", kind };
		}
	}
	if (s === "mix" && y >= 32 && y < 174 && x >= 4 && x < 236) {
		const i = Math.floor((x - 6) / 38);
		if (i >= 0 && i < 6 && i !== 4) {
			return { t: "mixv", i };
		}
	}
	if (s === "song") {
		return songZone(x, y);
	}
	if (s === "global" && y >= 32 && y < 200) {
		const top = clamp(S.glob.sel - 3, 0, GROWS.length - 8),
			i = top + Math.floor((y - 32) / 21);
		return i < GROWS.length ? { t: "grow", i, tap: true } : null;
	}
	if (s === "presets" && y >= 32 && y < 200) {
		return {
			t: "plist",
			tap: true,
			t0: ptop(prows()),
		};
	} /* the preset list: a drag scrolls it, a tap is the row */
	return null;
}

// ---------- per-track state: make the four banks and the windows onto them ----------
S.tk = [0, 1, 2, 3].map(() => {
	const b = { modT: 0 };
	TKK.forEach((k) => {
		b[k] = JSON.parse(JSON.stringify(S[k] === undefined ? null : S[k]));
	});
	return b;
});

TKK.forEach((k) =>
	Object.defineProperty(S, k, {
		get() {
			return S.tk[S._trk][k];
		},
		set(v) {
			S.tk[S._trk][k] = v;
		},
		enumerable: true,
		configurable: true,
	}),
);

for (let t = 0; t < 4; t++) {
	S._trk = t;
	applyPreset(S.tracks[t].pre);
	if (engOf(t) === "FM") {
		adsrFromOps();
	}
}

S._trk = 0;

bindTrack(0);

{
	const mt = MOD.t;
	S.tk.forEach((b) => (b.modT = mt));
	Object.defineProperty(MOD, "t", {
		get() {
			return S.tk[S._trk].modT;
		},
		set(v) {
			S.tk[S._trk].modT = v;
		},
		enumerable: true,
		configurable: true,
	});
}
// what the strip controls is per track too
// ---------- new project: SETTINGS > NEW PROJECT ----------
// Clears the song (all 16 patterns, tempo, rate, swing), puts every track and effect back to the boot sounds and stops everything.
// Saved USER presets and the global settings (tuning, brightness, screen colour, MASTER) are kept.
const PROJ = ["tracks", "tk", "gen", "scape", "bpm", "rate", "sgate", "swing", "oct"];

const S0 = JSON.parse(JSON.stringify(Object.fromEntries(PROJ.concat(TKK).map((k) => [k, S[k]]))));

loadSong();

function newProject() {
	undoPush("NEW PROJECT");
	if (S.playing) {
		S.playing = false;
		stopSeq();
	}
	for (let t = 0; t < 4; t++) {
		HOLD[t] = 0;
		releaseLatch(t, true, true);
	}
	A.arps.forEach((x) => x.clear());
	A.arpKeys = {};
	if (AC) {
		for (let t = 0; t < 4; t++) {
			fmSend(t, { t: 0, k: "alloff" });
		}
		A.vox.forEach((L) => L.forEach((v) => v && v.off && !v.done && v.off(AC.currentTime)));
		A.smpLast.forEach((v) => v && v.off && !v.done && v.off(AC.currentTime));
	}
	const v = JSON.parse(JSON.stringify(S0));
	PROJ.forEach((k) => {
		S[k] = v[k];
	});
	S.pats = Array.from({ length: 16 }, emptyPat);
	S.plen.fill(1);
	S.tl.forEach((a) => a.fill(0));
	S.ts = 2;
	S.gu = 0;
	S.snap = 0;
	S.song.on = 0;
	S.song.sel = 0;
	S.song.pos = 0;
	S.song.rc = 0;
	S.song.chain.forEach((e, i) => {
		e.pat = i === 0 ? 0 : -1;
		e.rep = 1;
		e.mute = 0;
		e.dmute = 0;
		e.col = [0, 0, 0, 0];
	});
	S.song.jump = -1;
	S.song.go = 0;
	S.auto = {};
	AUC.armed = false;
	AUC.rec = null;
	applyGrid();
	S.pat = 0;
	S.patNext = -1;
	S.seqPage = 0;
	S.seqEn = false;
	S.rec = false;
	S.recExt = false;
	S.clr = 0;
	S.dlg = null;
	S.hits.length = 0;
	S.padHits = [];
	S.trk = 0;
	S.op = 2;
	S.screen = "home";
	S.ppMode = "edit";
	S.ppPage = 0;
	S.arp.on = false;
	S.gen.on = false;
	S.playing = false;
	S.smpData = null;
	A.smpBuf = null;
	A.heard.fill(0);
	keyAt = 0;
	for (let t = 0; t < 4; t++) {
		qClear(t);
	}
	S.countdown = null;
	try {
		localStorage.removeItem("mellow-song");
	} catch (e) {
		/* nothing to do */
	}
	[0, 5, 7, 8].forEach((p, t) => {
		S._trk = t;
		applyPreset(p);
		if (engOf(t) === "FM") {
			adsrFromOps();
		}
		S.fx.emix = 0;
		S.fx.rmix = 0;
	});
	S._trk = 0;
	bindTrack(0); // a new project starts dry: no reverb or echo send on any track
	if (AC) {
		audioSync();
	}
	S.pop = null;
	S.toast = { s: "NEW PROJECT  \u00b7  UNDO IN SETTINGS", t: performance.now() };
}

window.__mellow = {
	autoSave,
	get IND() {
		return IND;
	},
	ptabs,
	ptop,
	pscroll,
	PVW,
	favSet,
	get FAVS() {
		return FAVS;
	},
	CATS,
	saveSlots,
	songZone,
	lcdZone,
	songAdd,
	songTap,
	songSelect,
	songJump,
	PV,
	HV,
	HM,
	pvZone,
	aResize,
	padGrab,
	laneGrab,
	pvLay,
	pvHead,
	pvClamp,
	songPreviewDraw,
	songTogglePad,
	songPadMask,
	patStep,
	patUsed,
	patFirstFree,
	patCopyTarget,
	nestPads,
	SGDM,
	heldK,
	saveQS,
	get QSV() {
		return QSV;
	},
	saveQSV,
	qsvClean,
	qSaveCurrent,
	qApply,
	padOf,
	qKeyOk,
	queueable,
	songSetOn,
	noteVoice,
	stepPlay,
	recNote,
	gateQ,
	gateCode,
	gateDec,
	gateTxt,
	gateNudge,
	stepSec,
	midiOnN: midiNoteOn,
	midiOffN: midiNoteOff,
	nestOpen,
	nestBack,
	nestToggle,
	nestCollapse,
	nestOn,
	nestFocus,
	nestZone,
	songLay,
	songView,
	SGV,
	NEST,
	NCLIP,
	NCH,
	NV,
	songClip,
	slotCopy,
	slotPaste,
	slotInsert,
	slotDelete,
	patGrab,
	patPut,
	nestLanes,
	nestParams,
	nestAddLane,
	nestLay,
	nestMask,
	nestKnobs,
	nestKey,
	aSetSlot,
	autoSlot,
	aSlotOf,
	aBase,
	aIdOf,
	openNestMenu,
	SG,
	SONGCHIP,
	SPLOG,
	songMask,
	PHONEP,
	audioSync,
	setBend,
	openShare,
	BNC,
	bounceStart,
	bounceCancel,
	midiFileBytes,
	zipStore,
	setTrackLen,
	tbars,
	nstT,
	aSongSteps,
	aValue,
	songChain,
	S_auto: () => S.auto,
	stripId,
	aRt,
	aPathOf,
	AUC,
	AUR,
	aActive,
	MOD,
	MODT,
	resetPhone,

	SPB,
	sqCW,
	sqX0,
	gridGeom,
	SQ,
	setSig,
	UI,
	setLen,
	nst,
	seqViewBar,
	songSnap,
	songRestore,
	loadSong,
	undoPush,
	held: () => HELD,
	TW,
	QS,
	prows,
	plist,
	togglePGroup,
	pcol,
	stepPreset,
	undo,
	redo,
	UND,
	startCountIn,
	saveSong,
	holdKey,
	releaseLatch,
	HOLD,
	holdToggle,
	killAll,
	stopOnly,
	qCommit,
	qClear,
	qAdd,
	newProject,
	MIDI,
	detectKey,
	heardNote,
	currentKey,
	keyName,
	latch,
	fmVoices,
	knobs,
	PRESETS,
	pp: () => {
		const g = ppPages();
		return g[clamp(S.ppPage, 0, g.length - 1)].t;
	},
	S,
	A,
	get AC() {
		return AC;
	},
	DX7,
	ensureAudio,
	keyOn,
	keyOff,
	press,
	turn,
	setEng,
	loadPreset,
	fmPatch,
	applyPreset,
	ALG,
};

Object.assign(window.__mellow, {
	resetAll,
	savePreset,
	getUSERP: () => USERP,
	TSIGS,
	maxBars,
	SMAX,
	setLenOf,
	setTrackLen,
	emptyPat,
	songMaskSync,
	songToggleMute,
	songJump,
	qPads,
	qsToggle,
	inQS,
	QL,
	QRET,
	qsPages,
	qsKey,
	qzTap,
	ppPages,
	stripTarget,
	qsSave,
	qsDelete,
	qsPlay,
	qTick,
	qsvSum,
	recCancel,
	BEND_MAX,
	bendSt,
	recCloseAll,
});

Object.defineProperty(window.__mellow, "QSEL", {
	get: () => QSEL,
	set: (v) => {
		QSEL = v;
	},
	configurable: true,
	enumerable: true,
});
// latency / mute timing checks (tests/latency.js)

// ---------- keep the instrument still: block selection, menus, zoom, drag and pan ----------
(() => {
	const stop = (e) => {
		if (e.cancelable) {
			e.preventDefault();
		}
	};
	[
		"contextmenu",
		"selectstart",
		"dragstart",
		"dblclick",
		"gesturestart",
		"gesturechange",
		"gestureend",
	].forEach((t) => document.addEventListener(t, stop, { passive: false }));

	const inSheet = (e) => e.target && e.target.closest && e.target.closest(".sheet"); // the settings sheet scrolls, so its touches are left alone
	document.addEventListener(
		"touchmove",
		(e) => {
			if (!inSheet(e)) {
				stop(e);
			}
		},
		{ passive: false },
	);
	document.addEventListener(
		"touchstart",
		(e) => {
			if (!inSheet(e)) {
				stop(e);
			}
		},
		{ passive: false },
	); // cancelling touchstart is what stops the long-press loupe / selection on iOS
	document.addEventListener(
		"touchend",
		(e) => {
			if (!inSheet(e)) {
				stop(e);
			}
		},
		{ passive: false },
	);
	document.addEventListener(
		"wheel",
		(e) => {
			if (e.ctrlKey) {
				stop(e);
			}
		},
		{ passive: false },
	);
	const clear = () => {
		const sel = window.getSelection && window.getSelection();
		if (sel && sel.rangeCount) {
			sel.removeAllRanges();
		}
	};
	document.addEventListener("selectionchange", clear);
	document.addEventListener("keydown", (e) => {
		if (e.ctrlKey && ["+", "-", "=", "0"].includes(e.key)) {
			stop(e);
		}
	});
})();
