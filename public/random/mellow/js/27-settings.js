// the settings sheet
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-unused-vars, no-undef -- offers names the other files use; uses names that live in the other files of the folder */

// ---------- settings sheet (PROTOTYPE ONLY: the cog on Home) ----------
// Every setting in one scrolling list: the device's GLO page rows, the queue and mod-strip options, and the grid. Tap the left half of a
// value to step it down and the right half to step it up, or swipe it sideways. The second tab lists the shortcuts.
const SET = { tab: 0, open: false };

const SHORTS = [
	[
		"KEYS",
		[
			["SWIPE UP ON A KEY", "hold the note; it rings on until you play another key on that track"],
			[
				"SWIPE RIGHT ON A KEY",
				"add it to the queue (plays in turn). On the drum track (and the sampler screen) it queues that pad or slice. Swipe right on several keys at once and they are queued as one chord. Keep your finger down after the swipe (that is the note's length) and move it up or down to bend that note by up to two semitones (melodic tracks). The QUEUE button (piano page) opens the QUEUE screen: its settings and, on page 3/3, SAVED QUEUES (save the queue you made and play it on any track later); hold the button to switch queuing off",
			],
			["SWIPE LEFT ON A QUEUED KEY", "cancel the whole queue"],
		],
	],
	[
		"KNOBS AND THE MOD STRIP",
		[
			["DRAG A KNOB UP OR DOWN", "turns it (up is more); a slow drag is finer"],
			["TAP A KNOB'S LEFT OR RIGHT", "one step down or up"],
			["DOUBLE-TAP A KNOB", "reset it"],
			["HOLD A KNOB", "MIDI learn: then move a controller (needs Web MIDI: not in iPhone Safari)"],
			[
				"THE STRIP BUTTON (PIANO PAGE)",
				"opens the STRIP screen: choose what the strip controls (page 1/2) and its AUTOMATE page (2/2: record a movement, play it LOOP or TAP; moving the strip yourself takes over, letting go snaps back); tap it again to go back",
			],
			[
				"RECORD AUTOMATION (A SETTINGS ROW)",
				"while recording, any knob, graph or strip move is recorded at the song position (Settings > AUTOMATION lists them)",
			],
		],
	],
	[
		"THE SCREEN (TOUCH)",
		[
			[
				"SWIPE A VALUE",
				"left down, right up (a parameter, a Global row, the four values at the bottom)",
			],
			["TOUCH A GRAPH", "draw it; the knobs follow"],
			["TAP A TRACK TILE", "select it; tap the selected one again to edit it"],
			["SWIPE A TRACK TILE", "its volume"],
			[
				"TAP A BLOCK OF THE SONG UNDER THE TRACKS (HOME)",
				"goes to that part of the song: stopped, it selects the slot and shows its pattern; while the song plays, the jump lands on the next bar line. Drag it sideways to scroll while stopped",
			],
			["DRAG A MIXER FADER", "that track's volume"],
			["DOUBLE-TAP A BOTTOM VALUE", "reset that parameter"],
			["TAP A PRESET", "loads it (AUDITION ON plays a note)"],
			["DRAG THE PRESET LIST", "scrolls it; nothing loads until you tap"],
			["TAP A PRESET CATEGORY", "fold or unfold it"],
			[
				"TAP A TAB OR THE ARROW AT ITS END",
				"that category (PAGE); the arrows reach the tabs that do not fit",
			],
			[
				"TAP THE CURRENT PRESET'S NUMBER",
				"marks it as a favourite (K1 FAV); the FAV tab lists them",
			],
			[
				"THE SAVE SCREEN",
				"tap a letter of the name to move the cursor, a letter in the row under it to choose it, and the OCT+ SAVE or OCT\u2212 CANCEL box",
			],
		],
	],
	[
		"THE SEQUENCER SCREEN",
		[
			["TOUCH AN EMPTY STEP'S BAR", "places a note at that height"],
			["TAP A NOTE", "selects it; tap the selected note again to delete it"],
			["DRAG A BAR", "edit what the chip says: velocity, pitch or gate"],
			["THE CHIP (TOP RIGHT)", "choose velocity, pitch or gate"],
			["DRAG A NOTE'S END", "(the row of boxes) its length"],
			["TAP OR DRAG THE BOXES", "add or remove steps"],
			["THE SONG CHIP (TOP)", "opens the song screen; lit while song mode is on"],
			[
				"TAP THE PAGE TITLE",
				"the next of the five SEQ pages (1/2, 2/2, STEP EDIT, SEQ LENGTH, TRACK LENGTH); the pips under it show which one, and the PAGE slider does the same. Also on the drum grid",
			],
			[
				"UNDO / REDO (THE TWO ARROW ICONS, BOTTOM LEFT)",
				"one step back or forward; a touch that only selects a note is not a step",
			],
			[
				"THE BAR STRIP (2 TO 8 BARS)",
				"one segment per bar: tap a bar to jump to it, drag sideways on the strip (or the wheel) to scroll the viewed bar one at a time",
			],
		],
	],
	[
		"THE SONG SCREEN",
		[
			[
				"THE ON / OFF CHIP",
				"song mode on or off (the PAGE slider does the same). Off to on while stopped: PLAY starts at slot 1. While playing: the chain starts at the selected slot when the pass ends",
			],
			[
				"TAP A ROW",
				"selects the slot and shows its pattern on the sequencer; while the song plays, playback jumps to it at the next bar line",
			],
			[
				"TAP PAT, BARS OR REP",
				"steps that value (pattern 1-16 then empty, bars, repeat 1-8); swipe it for the other direction. Every slot has its own pattern number: PAT and the PATTERN knob skip numbers another slot holds, ADD takes the first free one, and PASTE, INSERT and DUPE put a copy in a free pattern. To play a pattern again, use REP. The chain ends at the first empty slot: slots after one you emptied are marked NOT PLAYED until you fill it again or DELETE it",
			],
			[
				"TAP A TRACK CHIP (T1-T4)",
				"mutes or unmutes that track in that slot only (white keys 1-4 do the same for the selected slot; white key 5 jumps to it)",
			],
			[
				"THE PREVIEW (UNDER THE CHIPS)",
				"the whole song as a timeline: a block per slot as wide as its bars and repeats, T1-T4 lanes of note ticks (T4: the drum hits), muted tracks dim and struck, a line that follows the playhead and scrolls with it. Tap a block to select that slot; drag it sideways to scroll while stopped",
			],
			[
				"WHITE KEYS ON THE SONG SCREEN",
				"1-4 mute T1-T4 in the selected slot, 5 jumps to it (queues it while playing), 6-9 COPY / PASTE / INSERT / DELETE (DUPE / CLEAR in PAT mode), 10 the mode chip (SLOT, PAT, T1-T4, PAD, LANE), 11 drops the slot down. With a slot dropped down: 12 COPY, 13 PASTE, 14 CLEAR, 15 the mode chip",
			],
			[
				"TAP T1-T4 ABOVE THE CHIPS",
				"opens that track's sequencer (or the drum grid on T4) for the selected slot's pattern",
			],
			["TAP THE + ADD ROW", "adds a pattern after the last one"],
			[
				"COPY / PASTE / INSERT / DELETE",
				"under the rows (COPY stays lit while something is copied): act on the selected slot (pattern, repeat, mutes, colours, its automations) or, with the SLOT / PAT chip on PAT, on the pattern's notes (PAT: PASTE overwrites, DUPE makes a copy in a free pattern, CLEAR empties). White keys 6-9, 10 = SLOT / PAT. The chip goes on through T1-T4 (one track), PAD (the drum pad chosen in the dropdown: its row of hits) and LANE (the automation lane chosen there): COPY, then PASTE into the selected slot's pattern (PAD: into the chosen pad) or slot (LANE), CLEAR. One undo step each",
			],
			[
				"THE CHEVRON NEXT TO PAT",
				"drops the slot down right under its row, in the same list (tap it again to close; one slot is open at a time): its four tracks with mute, colour, a strip of their steps and their automations, while its pattern loops (PLAY chip). + ADD AUTOMATION opens a menu; drag across a lane's curve to draw it; the chips set ALL / this slot, OFF / LOOP / TAP, length, delete. Drag the list up and down to scroll. White keys 1-4 mute, 5-8 colour, 9 add, 10 delete, 11 scope (11 with no lane chosen, or SEQ, closes it)",
			],
			[
				"THE CHEVRON ON T4",
				"shows the drum track's 8 pads (KICK to PERC) as rows under it, each with a chip that mutes just that pad in this slot (the T4 chip still mutes the whole drum track). With T4 chosen and its pads shown, white keys 1-8 mute pads 1-8 (K2 PADS hides them or shows them and chooses the pad, KICK to PERC: a tap on a pad row chooses it too, for the PAD copy; the colour of T4 is then key 8 with the pads hidden)",
			],
		],
	],
	[
		"THE DRUM GRID (SEQ ON T4)",
		[
			[
				"TAP AN EMPTY CELL",
				"places a hit at the LEVEL chip's velocity (soft, med, loud) and plays it",
			],
			["TAP A HIT", "removes it"],
			["DRAG A CELL UP OR DOWN", "its velocity"],
			["DRAG ALONG A ROW", "paints hits, or erases when you start on a hit"],
			["TAP A PAD NAME", "plays that pad and selects its row"],
			[
				"THE LEVEL CHIP (BOTTOM ROW)",
				"taps cycle soft, med, loud: the velocity of the hits you place next and of a FILL",
			],
			[
				"CLR ROW / CLR ALL",
				"clear the selected pad's row or every pad: two taps each; undo brings them back",
			],
			[
				"THE FOUR BARS UNDER THE GRID",
				"for the selected pad: TUNE, DECAY, CRUSH and its CLICK (kick click, snare snap, hat attack, clap bursts, rim tick, shaker attack, perc noise). Drag sideways on a bar (the wheel works too): one undo step, and the pad sounds while it moves",
			],
			[
				"THE FILL CHIP",
				"a dropdown that writes a pattern for the selected pad across the whole pattern at the LEVEL velocity, replacing its row: four on the floor, offbeats, eighths, sixteenths, every 2 beats, every bar, every 2 or 4 bars, or clear the pad. One undo step. On the device it is the FILL knob on SEQ page 2/2",
			],
			[
				"THE BAR STRIP (2 TO 8 BARS)",
				"tap a bar to jump to it; drag sideways on the strip (or the wheel) to scroll the viewed bar, left = later bars. Also on the sequencer",
			],
		],
	],
	[
		"ICONS",
		[
			["TAP THE COG", "this sheet"],
			["HOLD THE COG", "background grid on or off"],
			["HOLD THE TOUCH ICON", "(bottom right of the screen) lock touch editing; a tap unlocks it"],
			["TAP BY THE BLUETOOTH ICON", "export or import a project, bounce audio, save a MIDI file"],
		],
	],
	[
		"BUTTONS",
		[
			["STOP", "stops the sequencer (it never starts it)"],
			[
				"DOUBLE-TAP STOP",
				"KILL: every note on every track, held keys, queues, the arp and the reverb and echo tails are cut at once (you hear no click)",
			],
			["SAVE", "opens the SAVE screen"],
			[
				"KEY",
				"opens the scale screen and lights the keys that are in the scale on the keyboard (the rest are dimmed but playable). Press it again to switch the lights off and go back",
			],
			[
				"HOLD",
				"a sustain pedal for the phone: keys you let go keep sounding (on the selected track) until you turn HOLD off, press the same key again, or KILL. Lit while on",
			],
			["OCT\u2212 AND OCT+", "the keyboard octave down and up"],
			[
				"HOLD A BUTTON (ABOUT 0.35 S)",
				"turns that mode off at once: SEQ, SONG, KEY (lights), ARP, HOLD, QUEUE, STRIP (back to pitch bend). The button flashes and nothing else happens; if the mode is already off, nothing happens. The other buttons ignore a hold",
			],
			[
				"HOLD REC (ABOUT 0.35 S)",
				"opens the RECORDING SETTINGS screen (METRONOME, RECORD MODE, COUNT-IN, RECORD LENGTH, then RECORD AUTOMATION; K1-K4 change them, PAGE flips the two pages). REC itself is not pressed; a tap on REC still arms and disarms recording. Leave with HOME or any screen button",
			],
			[
				"QUEUE AND STRIP",
				"tap QUEUE for the swipe-right queue (ON / OFF, mode, wait, hold overlap, timing, note gap, clear), tap STRIP for what the mod strip controls and its automation; tap again to close",
			],
			[
				"SWIPE THE BUTTONS UP OR DOWN",
				"the strip of buttons has three pages: HOME PLAY STOP REC BROWSER SAVE SETTINGS, then SEQ SONG EDIT ENV LFO FX MIXER, then KEY ARP HOLD QUEUE STRIP OCT\u2212 OCT+. A swipe changes the page and presses nothing. Prototype only",
			],
			[
				"EVERY OTHER BUTTON",
				"one plain press: a screen, or the next page of the screen it is already on. METRONOME, RECORD MODE, COUNT-IN, RECORD LENGTH, RECORD AUTOMATION, UNDO, REDO and NEW PROJECT are rows in SETTINGS; the take, bounces and exports are in the sheet by the Bluetooth icon",
			],
		],
	],
	[
		"COMPUTER KEYBOARD",
		[
			["SPACE", "start or stop (the PLAY button)"],
			["MOUSE WHEEL OVER A KNOB", "turns it, one step per notch (a desktop window)"],
			[
				"MOUSE WHEEL ON THE SCREEN",
				"over a parameter cell, one of the four values at the bottom, a Global row or a graph with one value: steps it. On Home over the track tiles: next / previous track (Shift: its volume). Over the preset list: scrolls it",
			],
			["MOUSE WHEEL IN SETTINGS", "over the value side of a row: steps it"],
			[
				"CLICK A VALUE ON THE SCREEN",
				"left half steps down, right half up (a double click resets a bottom value)",
			],
			["A S D F G H J K L ;", "the white keys"],
			["W E T Y U O P", "the black keys"],
			[", (COMMA)", "open the settings"],
			["ESC", "close the settings; with KEYBOARD TO QUEUE on, clear the selected track's queue"],
			[
				"KEYBOARD TO QUEUE (QUEUE POPUP)",
				"OFF / MIDI / QWERTY / BOTH: those keys are queued instead of sounding. Hold a key for the step length, press several together for a chord",
			],
		],
	],
];

function openSettings() {
	let m = document.getElementById("settings");
	if (!m) {
		m = document.createElement("div");
		m.id = "settings";
		m.className = "sheet";
		m.hidden = true;
		document.body.appendChild(m);
	}
	SET.open = true;
	m.hidden = false;
	renderSettings();
}

function closeSettings() {
	const m = document.getElementById("settings");
	if (m) {
		m.hidden = true;
	}
	SET.open = false;
}

// a value row: tap the left/right half or swipe sideways (one step per 26 px) to change it
function swipeStep(el, step, after) {
	let x0 = 0,
		moved = false,
		id = -1;
	el.addEventListener("pointerdown", (e) => {
		id = e.pointerId;
		x0 = e.clientX;
		moved = false;
		try {
			el.setPointerCapture(id);
		} catch (z) {
			/* nothing to do */
		}
	});
	el.addEventListener("pointermove", (e) => {
		if (e.pointerId !== id) {
			return;
		}
		const d = e.clientX - x0;
		if (Math.abs(d) < 8 && !moved) {
			return;
		}
		const n = Math.trunc(d / 26);
		if (n !== 0) {
			moved = true;
			for (let i = 0; i < Math.abs(n); i++) {
				step(n > 0 ? 1 : -1);
			}
			x0 += n * 26;
			after && after();
		}
	});
	el.addEventListener("pointerup", (e) => {
		if (e.pointerId !== id) {
			return;
		}
		id = -1;
		if (!moved) {
			const r = el.getBoundingClientRect();
			step(e.clientX < r.left + r.width / 2 ? -1 : 1);
			after && after();
		}
	});
	["pointercancel"].forEach((ev) =>
		el.addEventListener(ev, () => {
			id = -1;
		}),
	);
}

function settingsRows() {
	const g = S.glob,
		rows = [];
	const tempo = (d) => {
		const ob = S.bpm,
			oss = stepSec();
		S.bpm = clamp(S.bpm + d, 30, 300);
		if (stepSec() !== oss) {
			rebase(oss, ob);
		}
	};
	rows.push([
		"sc",
		"PROJECT",
		"saved with the song, covered by undo, part of an export. To change a value, tap the left or right side of it (the arrows), or swipe it",
	]);
	rows.push(["sr", "TIME SIGNATURE", () => tsName(), (d) => setSig(S.ts + (d > 0 ? 1 : -1))]);
	rows.push([
		"sr",
		"LENGTH (THIS PATTERN)",
		() => S.plen[S.pat] + (S.plen[S.pat] > 1 ? " BARS" : " BAR") + "  ·  PAT " + pad(S.pat + 1),
		(d) => setLen(S.plen[S.pat] + (d > 0 ? 1 : -1)),
	]);
	rows.push([
		"sr",
		"THIS TRACK'S LENGTH",
		() => {
			const tl = S.tl[S.pat][S.trk];
			return "T" + (S.trk + 1) + "  \u00b7  " + (tl ? tl + (tl > 1 ? " BARS" : " BAR") : "FOLLOWS");
		},
		(d) => setTrackLen(S.tl[S.pat][S.trk] + (d > 0 ? 1 : -1)),
		false,
		0,
		"it loops at its own length (polymeter)",
	]);
	rows.push([
		"sr",
		"TEMPO",
		() => S.bpm + " BPM",
		(d) => {
			undoPush();
			tempo(d > 0 ? 1 : -1);
		},
	]);
	rows.push([
		"sr",
		"SWING",
		() => S.swing + "%",
		(d) => {
			undoPush();
			S.swing = clamp(S.swing + (d > 0 ? 1 : -1), 50, 75);
		},
	]);
	rows.push([
		"sr",
		"SEQUENCER GRID",
		() =>
			GUN[S.gu] +
			"  \u00b7  " +
			[BSTEPS(), SPB(), 1][S.gu] +
			([BSTEPS(), SPB(), 1][S.gu] > 1 ? " STEPS" : " STEP"),
		(d) => {
			undoPush();
			S.gu = clamp(S.gu + (d > 0 ? 1 : -1), 0, 2);
			applyGrid();
		},
		false,
		0,
		"the squares on the SEQ screen, and what SNAP rounds to",
	]);
	rows.push([
		"sr",
		"SNAP TO THE GRID",
		() => (S.snap ? "ON  ·  " + GUN[S.gu] : "OFF"),
		(d) => {
			undoPush();
			S.snap ^= 1;
		},
		false,
		0,
		"recording and editing land on the grid's squares",
	]);
	rows.push([
		"bt",
		"UNDO",
		() => {
			closeSettings();
			undo();
		},
		false,
		"takes back the last change to the song or sounds (the chips on the sequencer do the same)",
		() => (UND.u.length ? UND.u.length + " LEFT" : "NOTHING"),
	]);
	rows.push([
		"bt",
		"REDO",
		() => {
			closeSettings();
			redo();
		},
		false,
		"puts back what UNDO took away",
		() => (UND.r.length ? UND.r.length + " LEFT" : "NOTHING"),
	]);
	rows.push(["sc", "RECORDING AND PLAYING", "kept on the device, whatever the project"]);
	const grow = (nm) => {
		const r = GROWS.find((x) => x[0] === nm);
		rows.push([
			"sr",
			r[0],
			() => r[1](g),
			(d) => {
				r[2](g, d > 0 ? 1 : -1);
			},
		]);
	};
	grow("METRONOME");
	grow("RECORD MODE");
	grow("COUNT-IN");
	grow("RECORD LENGTH");
	grow("RECORD AUTOMATION");
	rows.push(["sc", "DEVICE (THE GLO PAGE)", "kept on the device"]);
	rows.push([
		"bt",
		"DEVICE SETTINGS (GLO)",
		() => {
			closeSettings();
			press("global");
		},
		false,
		"the GLO page on the display: the same settings as the rows below, with the stock pages and dialogs",
	]);
	GROWS.forEach((r) => {
		if (/^(METRONOME|RECORD MODE|COUNT-IN|RECORD LENGTH|RECORD AUTOMATION)$/.test(r[0])) {
			return;
		}
		const note = /^(AUTO SLEEP|NIGHT MODE)$/.test(r[0])
			? "kept for the device: no effect in this prototype"
			: r[0] === "BLUETOOTH"
				? "only the status icon changes here"
				: undefined;
		rows.push([
			"sr",
			r[0],
			() => r[1](g),
			(d) => {
				r[2](g, d > 0 ? 1 : -1);
			},
			/^(MIDI PORTS|FIRMWARE)$/.test(r[0]),
			0,
			note,
		]);
	});
	rows.push(["sc", "THIS PHONE ONLY", "not on the FM-1, not in an export"]);
	rows.push([
		"sr",
		"SEQUENCER GRID LINES",
		() => (UI.grid ? "ON" : "OFF"),
		(d) => {
			UI.grid ^= 1;
			saveUI();
			applyGrid();
		},
		false,
		0,
		"beat lines on the sequencer screen. Hold the cog at the top right of the screen to switch it too",
	]);
	rows.push([
		"sr",
		"KEEP CLEAR OF THE HOME SWIPE",
		() => ["OFF", "NORMAL", "WIDE"][UI.hg],
		(d) => {
			UI.hg = clamp(UI.hg + (d > 0 ? 1 : -1), 0, 2);
			saveUI();
			applyGrid();
			setTimeout(applyGrid, 60);
		},
		false,
		0,
		"a strip under the keys with nothing to touch, so a swipe up from the very bottom is not mistaken for a key: the phone itself cannot be told to ignore it",
	]);
	rows.push([
		"sr",
		"SEQUENCER BARS EDIT",
		() => SQE[UI.sqe],
		(d) => {
			UI.sqe = wrap(UI.sqe + (d > 0 ? 1 : -1), 3);
			saveUI();
		},
	]);
	rows.push(["bt", "EXPORT OR IMPORT A PROJECT", () => openShare(), false]);
	rows.push(["sc", "RESET", "each asks you to tap twice"]);
	rows.push([
		"bt",
		"NEW PROJECT",
		() => newProject(),
		true,
		"clears the song, tempo, sounds and effects (user presets stay)",
	]);
	rows.push([
		"bt",
		"RESET DEVICE SETTINGS",
		() => resetDevice(),
		true,
		"GLO page, metronome, record mode, count-in, queue, mod strip",
	]);
	rows.push([
		"bt",
		"RESET THIS PHONE",
		() => resetPhone(),
		true,
		"background grid on, touch editing on, bars edit velocity, home-swipe strip normal, first button page",
	]);
	return rows;
}

function autoRows() {
	const rows = [],
		ids = Object.keys(S.auto);
	rows.push([
		"sc",
		"AUTOMATIONS",
		"every recorded movement, one per parameter. Record one from the strip popup, or switch on RECORD AUTOMATION in SETTINGS, press REC and move a knob, graph or the strip",
	]);
	if (!ids.length) {
		rows.push(["sr", "NONE YET", () => "", () => {}, true]);
	}
	ids.forEach((id) => {
		const a = S.auto[id];
		rows.push([
			"sr",
			a.name + (aSlotOf(a) >= 0 ? " \u00b7 SLOT " + (aSlotOf(a) + 1) : ""),
			() => ["OFF", "LOOP", "TAP"][a.mode],
			(d) => {
				a.mode = wrap(a.mode + (d > 0 ? 1 : -1), 3);
				const r = aRt(id);
				r.run = 0;
				r.t0 = performance.now();
				r.last = -1;
			},
		]);
		rows.push([
			"sr",
			"\u00a0\u00a0PLAYS IN",
			() => (aSlotOf(a) < 0 ? "THE WHOLE SONG" : "SLOT " + (aSlotOf(a) + 1)),
			(d) => {
				aSetSlot(id, clamp(aSlotOf(a) + (d > 0 ? 1 : -1), -1, 15));
			},
		]);
		rows.push([
			"sr",
			"\u00a0\u00a0FOLLOWS",
			() => (a.sync ? "FREE CLOCK" : "THE SONG"),
			(d) => {
				a.sync ^= 1;
			},
		]);
		rows.push([
			"sr",
			"\u00a0\u00a0LENGTH",
			() => a.bars + (a.bars > 1 ? " BARS" : " BAR"),
			(d) => {
				const i = AU_BARS.indexOf(a.bars);
				a.bars = AU_BARS[clamp(i + (d > 0 ? 1 : -1), 0, AU_BARS.length - 1)];
			},
		]);
		rows.push([
			"bt",
			"\u00a0\u00a0DELETE THIS ONE",
			() => {
				undoPush();
				delete S.auto[id];
			},
			true,
		]);
	});
	return rows;
}

function resetDevice() {
	const sel = S.glob.sel;
	Object.assign(S.glob, JSON.parse(JSON.stringify(GLOB0)));
	S.glob.sel = sel;
	Object.assign(QS, QS0);
	saveQS();
	MOD.t = 0;
	for (let t = 0; t < 4; t++) {
		setBend(0, t);
	}
	try {
		localStorage.setItem("mellow-mod", "0");
	} catch (e) {
		/* nothing to do */
	}
	saveDev();
	if (AC) {
		audioSync();
	}
	toast("DEVICE SETTINGS RESET");
}

function resetPhone() {
	UI.grid = 1;
	UI.tlock = 0;
	UI.sqe = 0;
	UI.hg = 1;
	UI.bp = 0;
	if (btnPageSet) {
		btnPageSet(0, true);
	}
	saveUI();
	applyGrid();
	toast("PHONE SETTINGS RESET");
}

function renderSettings() {
	const m = document.getElementById("settings");
	if (!m) {
		return;
	}
	const keepY = (m.querySelector(".sb") || {}).scrollTop || 0;
	m.innerHTML = "";
	const hd = document.createElement("div");
	hd.className = "sh";
	const tb = (t, i) => {
		const b = document.createElement("button");
		b.textContent = t;
		b.setAttribute("aria-pressed", String(SET.tab === i));
		b.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			if (SET.tab !== i) {
				const o = m.querySelector(".sb");
				if (o) {
					o.scrollTop = 0;
				}
			}
			SET.tab = i;
			renderSettings();
		});
		hd.appendChild(b);
	}; /* another tab starts at its top, not at the old tab's scroll position */
	tb("SETTINGS", 0);
	tb("SHORTCUTS", 1);
	tb("AUTOMATION", 2);
	const x = document.createElement("button");
	x.className = "x";
	x.textContent = "✕";
	x.setAttribute("aria-label", "Close");
	x.addEventListener("pointerdown", (e) => {
		e.preventDefault();
		closeSettings();
	});
	hd.appendChild(x);
	m.appendChild(hd);
	const sb = document.createElement("div");
	sb.className = "sb";
	m.appendChild(sb);
	if (SET.tab !== 1) {
		(SET.tab === 0 ? settingsRows() : autoRows()).forEach((r) => {
			if (r[0] === "sc") {
				const c = document.createElement("div");
				c.className = "sc";
				c.textContent = r[1];
				if (r[2]) {
					const n = document.createElement("div");
					n.className = "scn";
					n.textContent = r[2];
					c.appendChild(n);
				}
				sb.appendChild(c);
				return;
			}
			if (r[0] === "bt") {
				const [, label, fn, confirm, note, vt] = r,
					row = document.createElement("div");
				row.className = "sr bt" + (confirm ? " danger" : "");
				const l = document.createElement("span");
				l.textContent = label;
				if (note) {
					const n = document.createElement("div");
					n.className = "n";
					n.textContent = note;
					l.appendChild(n);
				}
				row.appendChild(l);
				const v = document.createElement("span");
				v.className = "v";
				v.textContent = confirm ? "TAP" : vt ? vt() : "OPEN";
				row.appendChild(v);
				sb.appendChild(row);
				let armed = 0,
					tm = 0,
					x0 = 0,
					mv = false;
				row.addEventListener("pointerdown", (e) => {
					x0 = e.clientX;
					mv = false;
				});
				row.addEventListener("pointermove", (e) => {
					if (Math.abs(e.clientX - x0) > 8) {
						mv = true;
					}
				});
				row.addEventListener("pointerup", () => {
					if (mv) {
						return;
					}
					if (!confirm) {
						fn();
						return;
					}
					if (!armed) {
						armed = 1;
						v.textContent = "TAP AGAIN";
						row.classList.add("armed");
						tm = setTimeout(() => {
							armed = 0;
							v.textContent = "TAP";
							row.classList.remove("armed");
						}, 3000);
						return;
					}
					clearTimeout(tm);
					fn();
					renderSettings();
				});
				return;
			}
			const [, label, get, step, ro, , note] = r,
				row = document.createElement("div");
			row.className = "sr" + (ro ? " ro" : "");
			const l = document.createElement("span");
			l.textContent = label;
			if (note) {
				const n = document.createElement("div");
				n.className = "n";
				n.textContent = note;
				l.appendChild(n);
			}
			const v = document.createElement("span");
			v.className = "v";
			v.textContent = get();
			row.appendChild(l);
			row.appendChild(v);
			sb.appendChild(row);
			if (!ro) {
				swipeStep(v, step, () => {
					v.textContent = get();
				});
				const ws = { wh: 0 };
				row.addEventListener(
					"wheel",
					(e) => {
						if (
							!DESK.matches ||
							e.clientX <
								row.getBoundingClientRect().left + row.getBoundingClientRect().width * 0.45
						) {
							return;
						}
						e.preventDefault();
						const d = wheelDir(e, ws);
						if (d) {
							step(d);
							v.textContent = get();
						}
					},
					{ passive: false },
				);
			}
		});
	} /* desktop: the wheel over the value half of a row steps it (over the label half it scrolls the list) */
	else {
		SHORTS.forEach(([h, list]) => {
			const c = document.createElement("div");
			c.className = "sc";
			c.textContent = h;
			sb.appendChild(c);
			list
				.filter(([k]) => !(k === "HOLD A KNOB" && !navigator.requestMIDIAccess))
				.forEach(([k, t]) => {
					const d = document.createElement("div");
					d.className = "sk";
					const b = document.createElement("b");
					b.textContent = k;
					const sp = document.createElement("span");
					sp.textContent = t;
					d.appendChild(b);
					d.appendChild(sp);
					sb.appendChild(d);
				});
		});
	}
	{
		const dn = document.createElement("button");
		dn.className = "sdone";
		dn.textContent = "DONE";
		dn.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			closeSettings();
		});
		m.appendChild(dn);
	}
	sb.scrollTop = keepY;
}

document.addEventListener("keydown", (e) => {
	if (e.ctrlKey || e.metaKey || e.altKey) {
		return;
	}
	if (e.key === "," && !SET.open && !kbTyping()) {
		e.preventDefault();
		openSettings();
	} /* not while a text box has focus: a comma typed into the share sheet's project text opened the settings and was lost (UI hunt) */ else if (
		e.key === "Escape" &&
		SET.open
	) {
		e.preventDefault();
		closeSettings();
	}
});

applyGrid();
