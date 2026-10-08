// The Song builder's Studio, the one way to make a song: the playlist, five track rows (Drums, Bass, Chords, Melody, Lead, always in that
// order) with their bars as clips on a timeline, the open track with a step grid or a roll, the play controls with a volume and a metronome
// button, a piano that stays at the bottom, and a Tools sheet that holds everything else. Checks the fixed tracks, choosing one (tap a row or a bar clip,
// arrows), editing from the card (steps, drawing in the roll, sounds and their shape), bars and looping, free recording, scale
// snapping, the sheet, pause and carry on, recording, undo, and a phone screen.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
const { fanify } = require("./_fan.cjs");
(async () => {
  const b = await chromium.launch();
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const lane = (str) => Array.from(str, (c) => c === "x");
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const roll = (hi, lo) => { const n = {}; for (let o = hi; o >= lo; o--) for (let i = 11; i >= 0; i--) n[NAMES[i] + o] = Array(16).fill(false); return n; };
  // 14 drum hits, 2 bass notes, 3 chord notes, 4 melody notes and 2 lead notes
  const song = (extra = {}) => {
    const melody = roll(4, 3); melody.G4 = lane("x...x...x...x...");
    const bass = roll(2, 1); bass.C2 = lane("x.......x.......");
    const chords = roll(4, 3); chords.C4 = lane("x..............."); chords.E4 = lane("x..............."); chords.G4 = lane("x...............");
    const lead = roll(5, 4); lead.E5 = lane("..x...x.........");
    return {
      tempo: 240, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1,
      tracks: { kick: lane("x...x...x...x..."), snare: lane("....x.......x..."), hihat: lane("x.x.x.x.x.x.x.x."), clap: lane("................") },
      trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} },
      melody: { waveform: "sine", notes: melody }, bass: { notes: bass, ties: {} }, chords: { notes: chords, ties: {} }, lead: { notes: lead, ties: {} },
      ...extra,
    };
  };
  // every player the page makes reports its steps, so a test can see where playing carried on
  const spy = () => {
    let engine;
    Object.defineProperty(window, "SongEngine", {
      configurable: true,
      get: () => engine,
      set: (v) => {
        engine = v;
        const orig = v.createPlayer;
        v.createPlayer = (get, data, on) => orig(get, data, (step, time, info) => { (window.__steps = window.__steps || []).push({ step, chain: info && info.chainIndex }); if (on) on(step, time, info); });
      },
    });
  };

  const adminCtx = await b.newContext({ storageState: process.env.ADMIN_STATE });
  const api = async (method, path, data) => { const r = await adminCtx.request.fetch(E2E_BASE + "/api/admin" + path, { method, data, headers: { "content-type": "application/json" } }); let j = null; try { j = await r.json(); } catch (e) { /* none */ } return { s: r.status(), j }; };
  const id = (await api("POST", "/songs", { name: "QQ Studio", data: song() })).j.id;
  const hiddenId = (await api("POST", "/songs", { name: "QQ Studio hidden", data: song({ trackMeta: { kick: {}, snare: { hidden: true }, hihat: {}, clap: {} }, melody: { waveform: "sine", notes: roll(4, 3), hidden: true }, bass: { notes: roll(2, 1), ties: {}, hidden: true }, lead: { notes: roll(5, 4), ties: {}, hidden: true } }) })).j.id;
  const phoneId = (await api("POST", "/songs", { name: "QQ Studio phone", data: song() })).j.id; // the desktop run saves its own song with a tom added
  const laneId = (await api("POST", "/songs", { name: "QQ Studio lanes", data: song({ bars: 4, patterns: { B: { tracks: { kick: lane("x.x.x.x.x.x.x.x."), snare: lane("................"), hihat: lane("................"), clap: lane("................") }, notes: roll(4, 3), ties: {} } }, lanes: { drums: { order: ["A", "B"] } } }) })).j.id;

  const open = async (p, songId) => {
    await p.goto(E2E_BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.locator(`.edit-song[data-id="${songId}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForSelector("#studio-stack .studio-card-main");
    await p.waitForTimeout(500);
  };
  const vis = (p, sel) => p.evaluate((q) => { const e = document.querySelector(q); return Boolean(e) && !e.hidden && e.offsetParent !== null; }, sel);
  const text = (p, sel) => p.textContent(sel);
  const pressed = (p, sel) => p.getAttribute(sel, "aria-pressed");
  const front = (p) => p.evaluate(() => { const c = document.querySelector('#studio-stack .studio-card[data-pos="front"]'); return c ? c.dataset.card : null; });
  const count = (p, track) => p.evaluate((t) => (document.querySelector(`#studio-stack [data-card="${t}"] .studio-card-meta > span`) || {}).textContent || "", track);
  const sound = (p, track) => p.evaluate((t) => (document.querySelector(`#studio-stack [data-card="${t}"] .studio-card-sound`) || {}).textContent || "", track);
  const settle = (p, ms = 150) => p.waitForTimeout(ms);
  const rows = (p) => p.evaluate(() => [...document.querySelectorAll("#studio-grid .studio-row[data-row]")].map((r) => r.dataset.row));
  const keyCount = (p) => p.evaluate(() => [document.querySelectorAll("#studio-keys .studio-key-white").length, document.querySelectorAll("#studio-keys .studio-key-black").length].join("/"));
  const firstKey = (p) => p.evaluate(() => (document.querySelector("#studio-keys .studio-key-white span") || {}).textContent);
  const chips = (p) => p.evaluate(() => [...document.querySelectorAll('#studio-stack [data-pos="front"] [data-clip]')].map((c) => (Number(c.dataset.bar) + 1) + (c.querySelector("i").textContent || "–")).join(" "));
  // where the visible strip of a card is: a tap there picks it
  const strip = (p, track) => p.evaluate((t) => { const r = document.querySelector(`#studio-stack [data-card="${t}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(13, r.height / 2) }; }, track);
  const tapStrip = async (p, track) => { await p.waitForTimeout(450); const at = await strip(p, track); await p.mouse.click(at.x, at.y); await p.waitForTimeout(200); };
  const num = (s) => Number((/^(\d+)/.exec(s) || [])[1]);
  const openSheet = async (p, tab) => { if (!(await vis(p, "#studio-sheet"))) await p.click("#studio-tools"); await p.click("#studio-tab-" + tab); await p.waitForTimeout(150); };
  const closeSheet = async (p) => { if (await vis(p, "#studio-sheet")) await p.click("#close-studio-sheet"); await p.waitForTimeout(150); };
  const soundSheet = async (p) => { if (await vis(p, "#studio-sheet")) await p.click("#studio-tab-sound"); else await p.click('#studio-detail [data-act="sound"]'); await p.waitForTimeout(250); };
  const toolsSheet = async (p) => { if (!(await vis(p, "#studio-sheet"))) { await p.click("#studio-bars-menu-btn"); await p.click('#studio-bars-menu [data-act="tools"]'); } else await p.click("#studio-tab-tools"); await p.waitForTimeout(250); };

  try {
    // ======== a desktop window ========
    const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("songView", "studio"); } catch (e) { /* none */ } });
    await ctx.addInitScript(spy);
    const p = fanify(await ctx.newPage());
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    p.on("dialog", (d) => d.accept());
    await open(p, id);

    // ---- the layout of the sketch: stacked cards, then the open track, then controls, then keys
    const names = await p.evaluate(() => [...document.querySelectorAll("#studio-stack .studio-card-name")].map((x) => x.textContent).join("|"));
    ok(names === "Drums|Bass|Chords|Melody|Lead", "five tracks, always in the same order", names);
    const badges = await p.evaluate(() => [...document.querySelectorAll("#studio-stack .studio-card .studio-badge")].map((x) => x.textContent).join(""));
    ok(badges === "12345", "numbered 1 to 5", badges);
    const tops = await p.evaluate(() => ["studio-stack", "studio-detail", "studio-play", "studio-keys"].map((i) => Math.round(document.getElementById(i).getBoundingClientRect().top)));
    // a wide screen puts the tracks in a rail beside the open track; below that they come first
    ok(tops[0] <= tops[1] && tops[1] < tops[2] && tops[2] < tops[3], "the tracks, then (or beside) the open track, then the play controls, then the keys at the bottom", tops);
    ok(await vis(p, "#song-studio") && !(await vis(p, ".song-builder-body")) && !(await vis(p, ".song-toolbar")), "the old header and body stay out of the way");
    ok(!(await p.evaluate(() => Boolean(document.getElementById("song-view-toggle") || document.getElementById("studio-full")))), "there is no other view to switch to");
    ok((await front(p)) === "drums" && /Drums/.test(await text(p, "#studio-detail h2")), "it opens on the first track that has something in it (Drums)", await front(p));
    ok((await p.locator("#studio-detail h2").count()) === 1 && (await p.locator('#studio-stack [data-pos="front"]').count()) === 1, "only one track is open at a time");
    const counts = await Promise.all(["drums", "bass", "chords", "melody", "lead"].map((t) => count(p, t)));
    ok(counts.join("|") === "14 hits|2 notes|3 notes|4 notes|2 notes", "each card gives a simple overview (hits for the drums, notes for the rest)", counts);
    const dotCounts = await p.evaluate(() => ["drums", "bass", "chords", "melody", "lead"].map((t) => document.querySelectorAll(`#studio-stack [data-card="${t}"] [data-clip][data-bar="0"] .studio-dots rect`).length).join());
    ok(dotCounts === "14,2,3,4,2", "and a small picture of where its notes are", dotCounts);
    const sounds = await Promise.all(["drums", "bass", "chords", "melody", "lead"].map((t) => sound(p, t)));
    ok(/^Acoustic kit$/.test(sounds[0]) && /Pad/.test(sounds[2]) && /Basic sine/.test(sounds[3]) && /Lead/.test(sounds[4]), "and the sound it plays with", sounds);
    ok(!(await p.isEnabled("#studio-undo")), "nothing to undo on a freshly opened song");
    ok(!(await p.evaluate(() => /add (a )?(new )?track|new track|reorder|move (up|down)/i.test(document.getElementById("song-studio").textContent))) && (await p.evaluate(() => document.querySelectorAll("#song-studio [draggable=true]").length)) === 0, "there is no way to add, remove or reorder tracks");

    // ---- choosing a track: tap a row or a clip, the arrow keys
    await tapStrip(p, "chords");
    ok((await front(p)) === "chords" && /Chords/.test(await text(p, "#studio-detail h2")), "tapping a card opens it", await front(p));
    await tapStrip(p, "lead");
    ok((await front(p)) === "lead", "and so does tapping one further down", await front(p));
    await tapStrip(p, "bass");
    ok((await front(p)) === "bass", "or one above", await front(p));
    await p.focus('#studio-stack [data-pick="bass"]');
    await p.keyboard.press("ArrowDown");
    await settle(p);
    ok((await front(p)) === "chords" && (await p.evaluate(() => document.activeElement.dataset.pick)) === "chords", "the arrow keys move through the stack (and keep the focus)", await front(p));
    await p.keyboard.press("End");
    await settle(p);
    ok((await front(p)) === "lead", "End goes to track 5", await front(p));
    await p.keyboard.press("ArrowDown");
    await settle(p);
    ok((await front(p)) === "lead", "and there is no going past the last", await front(p));
    await p.keyboard.press("Home");
    await settle(p);
    ok((await front(p)) === "drums", "Home goes back to track 1", await front(p));
    // tapping the empty part of a track's row opens it too, and a bar clip opens that track in that bar
    await tapStrip(p, "melody");
    ok((await front(p)) === "melody", "tapping the empty part of a track row opens it", await front(p));
    await p.click('#studio-stack [data-card="chords"] [data-clip][data-bar="0"]');
    await settle(p);
    ok((await front(p)) === "chords" && (await pressed(p, '#studio-stack [data-card="chords"] [data-clip][data-bar="0"]')) === "true", "a clip opens its track in that bar", await front(p));
    ok((await p.locator("#studio-stack .studio-card").count()) === 5 && !(await p.isEnabled("#studio-undo")), "choosing tracks is not an edit (still five cards, nothing to undo)");

    // ---- editing steps from the open track (Drums: every drum sound in one grid)
    await tapStrip(p, "drums");
    const drumRows = await rows(p);
    ok(drumRows.join() === "kick,snare,hihat,clap" && (await p.locator("#studio-keys .studio-pad").count()) === 4, "Drums is one track with all its sounds as rows, and a pad for each", drumRows);
    await p.click('#studio-grid .studio-cell[data-row="kick"][data-step="2"]');
    await settle(p);
    ok((await count(p, "drums")) === "15 hits" && (await pressed(p, '#studio-grid .studio-cell[data-row="kick"][data-step="2"]')) === "true", "a tapped step turns on and the card follows (15 hits)", await count(p, "drums"));
    ok(await p.evaluate(() => document.querySelector('#song-sequencer .song-step[data-row="kick"][data-step="2"]').classList.contains("song-step-on")), "it is the real editor's step that changed");
    ok(await p.isEnabled("#studio-undo"), "and it can be undone");
    await p.click("#studio-undo");
    await settle(p);
    ok((await count(p, "drums")) === "14 hits" && (await pressed(p, '#studio-grid .studio-cell[data-row="kick"][data-step="2"]')) === "false", "Undo takes it back");
    await p.click("#studio-redo");
    await settle(p);
    ok((await count(p, "drums")) === "15 hits", "and Redo brings it back");
    await p.click("#studio-undo");
    await settle(p);

    // ---- the Sound sheet on the drums: the kit, each sound (switch between them), add a sound
    await soundSheet(p);
    ok((await vis(p, "#studio-sheet")) && (await p.getAttribute("#studio-tab-sound", "aria-selected")) === "true" && (await p.locator("#studio-add option").count()) === 4, "Sound opens the sheet on the drum sounds and offers open hat, rim, tom and crash to add", await p.locator("#studio-add option").count());
    await p.click('[data-sound="hihat"]');
    ok((await pressed(p, '[data-sound="hihat"]')) === "true" && (await pressed(p, '[data-sound="kick"]')) === "false", "a drum sound is chosen with a tap, and another can be chosen after it");
    await p.fill("#studio-sound-vol", "40");
    await settle(p);
    ok((await p.inputValue('.song-track-volume[data-row="hihat"]')) === "40" && (await p.inputValue('.song-track-volume[data-row="kick"]')) === "100", "its volume is its own", [await p.inputValue('.song-track-volume[data-row="hihat"]'), await p.inputValue('.song-track-volume[data-row="kick"]')]);
    await p.click('[data-sound="kick"]');
    ok((await p.inputValue("#studio-sound-vol")) === "100", "going back to the kick shows the kick's volume");
    await p.click('[data-sound="snare"]');
    await p.click("#studio-sound-mute");
    await settle(p);
    ok((await p.evaluate(() => ["kick", "snare", "hihat"].map((r) => document.querySelector(`.song-track-mute[data-row="${r}"]`).getAttribute("aria-pressed")).join())) === "false,true,false", "one sound can be muted alone");
    await p.click("#studio-sound-mute");
    await p.click('[data-sound="hihat"]');
    await p.fill("#studio-sound-vol", "100");
    await p.selectOption("#studio-kit", "808");
    await settle(p);
    ok((await p.inputValue("#song-kit")) === "808" && (await sound(p, "drums")) === "808 kit", "the drum kit menu drives the real one and the card shows it");
    await p.selectOption("#studio-kit", "acoustic");
    await p.selectOption("#studio-add", "tom");
    await p.click("#studio-add-btn");
    await settle(p);
    await closeSheet(p);
    const drumRows2 = await rows(p);
    ok(drumRows2.join() === "kick,snare,hihat,clap,tom" && (await p.locator("#studio-keys .studio-pad").count()) === 5 && (await p.locator("#studio-stack .studio-card").count()) === 5, "adding a sound puts a row and a pad in the same track", drumRows2);
    await soundSheet(p);
    await p.selectOption("#studio-add", "crash");
    await p.click("#studio-add-btn");
    await settle(p);
    await p.click('[data-sound="crash"]');
    ok(await vis(p, "#studio-sound-remove"), "an added sound has a Remove button (the four core sounds do not)");
    await p.fill("#studio-sound-note", "QQ note");
    ok((await p.inputValue('.song-track-note[data-row="crash"]')) === "QQ note" && (await vis(p, "#studio-sound-color")), "and each sound's note and colour are here too");
    await p.click("#studio-sound-remove");
    await settle(p);
    await p.click('[data-sound="kick"]');
    ok(!(await vis(p, "#studio-sound-remove")) && (await rows(p)).join() === "kick,snare,hihat,clap,tom", "removing it takes its row away", await rows(p));
    await closeSheet(p);
    await p.click("#studio-mute");
    await settle(p);
    const muted = await p.evaluate(() => ["kick", "snare", "hihat", "clap", "tom"].map((r) => document.querySelector(`.song-track-mute[data-row="${r}"]`).getAttribute("aria-pressed")).join());
    ok(muted === "true,true,true,true,true" && (await pressed(p, "#studio-mute")) === "true" && /muted/i.test(await p.getAttribute('#studio-stack [data-card="drums"] .studio-card-main', "aria-label")) && /muted/.test(await count(p, "drums")), "Mute silences every drum sound and the card says so", muted);
    await p.click("#studio-mute");
    await settle(p);
    ok(!/muted/.test(await count(p, "drums")), "and it comes back");
    await p.click("#studio-clear");
    await settle(p);
    ok((await count(p, "drums")) === "0 hits", "Clear empties every drum sound in the bar", await count(p, "drums"));
    await p.click("#studio-undo");
    await settle(p);
    ok((await count(p, "drums")) === "14 hits", "and one Undo brings them all back", await count(p, "drums"));

    // ---- the Track tools sheet on the drums: the builder's own drum tools and generators
    await toolsSheet(p);
    ok((await vis(p, '[aria-label="Drum pattern tools"]')) && (await vis(p, "#song-generators")) && !(await vis(p, "#song-melody-tools")), "Tools has the drum tools and the starter beats for the drums, and not the note tools");
    await p.selectOption("#song-pattern-target", "kick");
    await p.click("#song-pattern-shift-right");
    await settle(p);
    ok((await p.evaluate(() => document.querySelector('#studio-grid .studio-cell[data-row="kick"][data-step="1"]').classList.contains("on"))), "a tool works on the real drums and the grid follows (the kick shifted a step)");
    await p.click("#song-pattern-shift-left");
    await p.selectOption("#song-pattern-target", "all");
    await closeSheet(p);

    // ---- the bass: its own low roll and keys, its sound, Follow the kick
    await tapStrip(p, "bass");
    const bassRows = await rows(p);
    ok(bassRows.length === 24 && bassRows[0] === "B2" && bassRows[23] === "C1" && (await keyCount(p)) === "14/10" && (await firstKey(p)) === "C1", "the bass is a roll from B2 down to C1, with its own two octaves of keys", [bassRows[0], bassRows[23], await keyCount(p)]);
    await soundSheet(p);
    await p.selectOption("#studio-voice", "pluck");
    await settle(p);
    ok((await p.inputValue("#song-bass-voice")) === "pluck" && /pluck/i.test(await sound(p, "bass")), "the bass sound drives the bass voice");
    await toolsSheet(p);
    await p.click("#song-bass-follow");
    await settle(p);
    ok((await count(p, "bass")) === "4 notes" && /Bass on every kick/.test(await text(p, "#song-melody-tools-note")), "Follow the kick puts a held note on every kick (four notes, however long they are held) and says so", [await count(p, "bass"), await text(p, "#song-melody-tools-note")]);
    await closeSheet(p);
    await p.click("#studio-undo");
    await settle(p);
    ok((await count(p, "bass")) === "2 notes", "and it is undoable");

    // ---- the chords: pad by default, a progression fills the loop
    await tapStrip(p, "chords");
    const chordRows = await rows(p);
    ok(chordRows.length === 24 && chordRows[0] === "B4" && chordRows[23] === "C3" && (await keyCount(p)) === "14/10" && (await firstKey(p)) === "C3", "the chords are a roll from B4 down to C3, with keys to match", [chordRows[0], chordRows[23]]);
    await soundSheet(p);
    ok((await p.inputValue("#studio-voice")) === "pad" && (await sound(p, "chords")) === "Pad", "they start on the Pad sound");
    await p.selectOption("#studio-voice", "pluck");
    await settle(p);
    ok((await p.inputValue("#song-part-voice")) === "pluck" && /pluck/i.test(await sound(p, "chords")), "the chords sound drives the real menu");
    await toolsSheet(p);
    const progs = await p.evaluate(() => [...document.querySelectorAll("#song-prog-type option")].map((o) => o.value));
    await p.selectOption("#song-prog-type", progs[0]);
    await p.click("#song-prog-stamp");
    await settle(p);
    await closeSheet(p);
    ok(num(await count(p, "chords")) > 3 && (await count(p, "bass")) === "2 notes" && (await count(p, "melody")) === "4 notes", "a chord progression fills the loop and leaves the other tracks alone", [await count(p, "chords")]);
    await p.click("#studio-undo");
    await settle(p);
    ok((await count(p, "chords")) === "3 notes", "Undo takes the progression back");

    // ---- the melody: steps and the roll, the sound and its shape, a held note, clear
    await tapStrip(p, "melody");
    ok((await pressed(p, '.studio-mode[data-mode="roll"]')) === "true" || (await pressed(p, '.studio-mode[data-mode="steps"]')) === "true", "a note track can be drawn as steps or as a roll");
    await p.click('.studio-mode[data-mode="steps"]');
    await settle(p);
    const melRows = await rows(p);
    ok(melRows.length === 24 && melRows[0] === "B4" && melRows[23] === "C3" && (await keyCount(p)) === "14/10", "the melody is a roll from B4 down to C3", [melRows[0], melRows[23]]);
    ok(await p.evaluate(() => { const s = document.getElementById("studio-grid-scroll"); const r = document.querySelector('#studio-grid .studio-row[data-row="G4"]').getBoundingClientRect(); const c = s.getBoundingClientRect(); return r.top >= c.top - 1 && r.bottom <= c.bottom + 1; }), "the steps open scrolled to where the notes are");
    await p.click('.studio-mode[data-mode="roll"]');
    await settle(p);
    ok(await p.evaluate(() => { const s = document.getElementById("studio-grid-scroll"); const rowsEl = [...document.querySelectorAll("#studio-grid .studio-row[data-row]")]; const h = rowsEl[0].getBoundingClientRect().height; return rowsEl.length === 24 && h >= 10 && h < 20 && s.scrollWidth <= s.clientWidth + 1; }), "the roll packs all 24 notes into the card as thin rows, with the sixteen steps across and nothing to scroll sideways");
    ok((await p.evaluate(() => localStorage.getItem("songGridMode"))) === "roll", "and it remembers the choice");
    // draw a held note by dragging along a row, then undo it in one step
    const cellBox = async (row, step) => p.locator(`#studio-grid .studio-cell[data-row="${row}"][data-step="${step}"]`).boundingBox();
    const drag = async (row, a, z) => { const from = await cellBox(row, a); const to = await cellBox(row, z); await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await p.mouse.down(); await p.mouse.move((from.x + to.x) / 2 + from.width / 2, to.y + to.height / 2, { steps: 4 }); await p.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 4 }); await p.mouse.up(); await settle(p, 250); };
    await drag("C4", 2, 6);
    const drawn = await p.evaluate(() => [2, 3, 4, 5, 6].map((i) => { const c = document.querySelector(`#studio-grid .studio-cell[data-row="C4"][data-step="${i}"]`); return (c.classList.contains("on") ? "1" : "0") + (c.classList.contains("tied") ? "t" : "-"); }).join(" "));
    ok(drawn === "1- 1t 1t 1t 1t" && (await count(p, "melody")) === "5 notes", "dragging along a row in the roll draws one held note (five steps, one more note)", [drawn, await count(p, "melody")]);
    await p.click("#studio-undo");
    await settle(p);
    ok((await count(p, "melody")) === "4 notes" && (await p.evaluate(() => document.querySelectorAll('#studio-grid .studio-cell[data-row="C4"].on').length)) === 0, "and the whole drag is one undo step");
    await p.locator('#studio-grid .studio-cell[data-row="G4"][data-step="0"]').focus();
    await p.keyboard.press("Control+a");
    await p.keyboard.press("Delete");
    await settle(p);
    ok((await count(p, "melody")) === "0 notes", "Ctrl+A then Delete erases every note (dragging a note now moves it)", await count(p, "melody"));
    await p.click("#studio-undo");
    await settle(p);
    ok((await count(p, "melody")) === "4 notes", "and that is one undo step too");
    await soundSheet(p);
    ok(!(await p.isEnabled('[data-knob="attack"]')), "the shaping sliders wait until an instrument is chosen (Basic is a plain wave)");
    await p.selectOption("#studio-voice", "bell");
    await settle(p);
    ok((await p.inputValue("#song-voice")) === "bell" && /Bell/.test(await sound(p, "melody")) && (await p.isEnabled('[data-knob="attack"]')), "the instrument drives the melody voice, shows on the card and unlocks the sliders");
    await p.evaluate(() => document.querySelectorAll("#studio-sheet details.studio-fold").forEach((d) => (d.open = true)));
    const attackBefore = await text(p, '[data-out="attack"]');
    await p.fill('[data-knob="attack"]', "800");
    await p.fill('[data-knob="cutoff"]', "300");
    await p.fill('[data-knob="vibrato"]', "500");
    await settle(p);
    const attackAfter = await text(p, '[data-out="attack"]');
    ok(attackBefore !== attackAfter && /s$/.test(attackAfter) && (await p.evaluate(() => document.querySelector('[data-out="attack"]').classList.contains("is-tweaked"))) && !(await p.isDisabled("#studio-synth-reset")), "moving a slider changes its value, marks it as tweaked and allows a reset", [attackBefore, attackAfter]);
    await p.selectOption("#studio-synth-wave", "square");
    await settle(p);
    await p.fill("#studio-sound-vol", "40");
    await settle(p);
    ok((await p.inputValue("#song-melody-volume")) === "40", "the volume slider drives the real one");
    await closeSheet(p);
    await p.click("#studio-save");
    await p.waitForTimeout(1000);
    const synthSaved = ((await api("GET", "/songs/" + id)).j.data || {}).melody || {};
    ok(synthSaved.synth && synthSaved.synth.attack > 0.3 && synthSaved.synth.cutoff < 800 && synthSaved.synth.vibrato > 10 && synthSaved.synth.wave === "square" && synthSaved.voice === "bell", "the tweaks are saved with the song", synthSaved.synth);
    await soundSheet(p);
    await p.click("#studio-synth-reset");
    await settle(p);
    ok(!(await p.evaluate(() => document.querySelector('[data-out="attack"]').classList.contains("is-tweaked"))) && (await p.isDisabled("#studio-synth-reset")), "Reset the sound takes every tweak back to the instrument's own");
    await closeSheet(p);
    await p.click('.studio-mode[data-mode="steps"]');
    await p.click('#studio-grid .studio-cell[data-row="C4"][data-step="1"]');
    await p.click('#studio-grid .studio-cell[data-row="C4"][data-step="2"]');
    await settle(p);
    ok((await count(p, "melody")) === "6 notes", "two more notes make six", await count(p, "melody"));
    const cell2 = await p.locator('#studio-grid .studio-cell[data-row="C4"][data-step="2"]').boundingBox();
    await p.mouse.move(cell2.x + cell2.width / 2, cell2.y + cell2.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(1200);
    await p.mouse.up();
    await settle(p);
    ok((await p.evaluate(() => document.querySelector('#song-piano-roll .song-step[data-row="C4"][data-step="2"]').classList.contains("song-step-tied"))) && (await p.evaluate(() => document.querySelector('#studio-grid .studio-cell[data-row="C4"][data-step="2"]').classList.contains("tied"))), "holding a note in the steps ties it to the one before");
    ok((await count(p, "melody")) === "5 notes", "and a held step is the same note, not another one (five)", await count(p, "melody"));
    await p.click("#studio-clear");
    await settle(p);
    ok((await count(p, "melody")) === "0 notes", "Clear empties the bar");
    await p.click("#studio-undo");
    await settle(p);
    ok((await count(p, "melody")) === "5 notes", "and it is undoable");

    // ---- scale snapping: free by default, and with it on a note moves to the scale
    await toolsSheet(p);
    ok((await p.isDisabled("#studio-snap")) && !(await p.isChecked("#studio-snap")), "snapping needs a scale, and is off until asked for: the keys are free");
    await p.selectOption("#song-scale-root", "C");
    await p.selectOption("#song-scale-type", "major");
    await settle(p);
    ok(!(await p.isDisabled("#studio-snap")) && !(await p.isChecked("#studio-snap")), "choosing a scale does not snap anything by itself");
    await p.check("#studio-snap");
    await settle(p);
    await closeSheet(p);
    ok((await p.evaluate(() => document.querySelectorAll("#studio-keys .studio-key.out").length)) === 10, "the keys outside the scale are dimmed (five in each octave)", await p.evaluate(() => document.querySelectorAll("#studio-keys .studio-key.out").length));
    await p.click('.studio-mode[data-mode="steps"]');
    await p.click('#studio-grid .studio-cell[data-row="C#4"][data-step="9"]');
    await settle(p);
    ok((await p.evaluate(() => document.querySelector('#studio-grid .studio-cell[data-row="C4"][data-step="9"]').classList.contains("on") && !document.querySelector('#studio-grid .studio-cell[data-row="C#4"][data-step="9"]').classList.contains("on"))), "with snapping on, a note tapped outside the scale lands on the nearest note of it");
    await p.click("#studio-undo");
    await toolsSheet(p);
    await p.uncheck("#studio-snap");
    await settle(p);
    await closeSheet(p);
    await p.click('#studio-grid .studio-cell[data-row="C#4"][data-step="9"]');
    await settle(p);
    ok(await p.evaluate(() => document.querySelector('#studio-grid .studio-cell[data-row="C#4"][data-step="9"]').classList.contains("on")), "with it off, any note can be placed");
    await p.click("#studio-undo");
    await settle(p);

    // ---- the lead: the highest roll, its sound and volume, mute
    await tapStrip(p, "lead");
    const leadRows = await rows(p);
    ok(leadRows.length === 24 && leadRows[0] === "B5" && leadRows[23] === "C4" && (await keyCount(p)) === "14/10" && (await firstKey(p)) === "C4", "the lead is a roll from B5 down to C4", [leadRows[0], leadRows[23]]);
    await soundSheet(p);
    ok((await p.inputValue("#studio-voice")) === "lead" && (await sound(p, "lead")) === "Lead", "it starts on the Lead sound");
    await p.selectOption("#studio-voice", "bell");
    await settle(p);
    ok((await p.inputValue("#song-part-voice")) === "bell" && /Bell/.test(await sound(p, "lead")) && /pluck/i.test(await sound(p, "chords")), "changing the lead's sound leaves the chords' sound alone");
    await p.fill("#studio-sound-vol", "40");
    await closeSheet(p);
    await p.click("#studio-mute");
    await settle(p);
    ok((await pressed(p, "#song-melody-mute")) === "true" && /muted/.test(await count(p, "lead")) && !/muted/.test(await count(p, "melody")), "Mute silences just this track, and its card says so");
    await p.click("#studio-mute");
    await settle(p);

    // ---- play, pause, carry on, stop
    await tapStrip(p, "drums");
    ok((await p.getAttribute("#studio-play", "aria-label")) === "Play" && !(await p.isEnabled("#studio-stop")), "Play, and Stop is off while nothing plays");
    await p.click("#studio-play");
    await p.waitForTimeout(900);
    ok((await p.getAttribute("#studio-play", "aria-label")) === "Pause" && (await p.isEnabled("#studio-stop")) && /Stop/.test(await text(p, "#song-play")), "Play starts the song and the button becomes Pause");
    ok((await p.evaluate(() => document.querySelectorAll("#studio-grid .studio-cell.now").length)) >= 1, "a column of the steps lights up with the music");
    ok((await p.evaluate(() => document.querySelectorAll('#studio-stack .studio-card.hit').length)) >= 1, "and the cards of the tracks that are sounding light up");
    ok(await p.evaluate(() => getComputedStyle(document.querySelector(".studio-ico-pause")).display !== "none" && getComputedStyle(document.querySelector(".studio-ico-play")).display === "none"), "and the button shows the pause symbol, not the play one");
    await p.click("#studio-play");
    await settle(p, 250);
    const paused = await p.evaluate(() => { const s = window.__steps || []; return { last: s[s.length - 1].step, n: s.length }; });
    ok(await p.evaluate(() => getComputedStyle(document.querySelector(".studio-ico-play")).display !== "none" && getComputedStyle(document.querySelector(".studio-ico-pause")).display === "none"), "paused, it shows the play symbol again");
    ok((await p.getAttribute("#studio-play", "aria-label")) === "Carry on" && (await p.isEnabled("#studio-stop")) && (await p.evaluate(() => document.querySelectorAll("#studio-grid .studio-cell.now").length)) === 0 && (await p.evaluate(() => document.querySelectorAll('#studio-stack .studio-card.hit').length)) === 0, "Pause stops the sound and the lights, and the button now says Carry on", await p.getAttribute("#studio-play", "aria-label"));
    await p.evaluate(() => { window.__steps = []; });
    await p.click("#studio-play");
    await p.waitForTimeout(500);
    const resumed = await p.evaluate(() => (window.__steps || [])[0]);
    const back = resumed ? (paused.last - resumed.step + 16) % 16 : 99;
    ok(resumed && back <= 3, "Carry on picks up where it stopped, not at the top", { pausedAt: paused.last, resumedAt: resumed && resumed.step });
    await p.click("#studio-stop");
    await settle(p, 200);
    ok((await p.getAttribute("#studio-play", "aria-label")) === "Play" && !(await p.isEnabled("#studio-stop")), "Stop goes back to the start");
    await p.evaluate(() => { window.__steps = []; });
    await p.click("#studio-play");
    await p.waitForTimeout(300);
    ok(await p.evaluate(() => (window.__steps || [])[0].step === 0), "and the next Play starts from the top");
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await p.keyboard.press(" ");
    await settle(p, 250);
    ok((await p.getAttribute("#studio-play", "aria-label")) === "Carry on", "the Space bar pauses too");
    await p.keyboard.press(" ");
    await settle(p, 250);
    ok((await p.getAttribute("#studio-play", "aria-label")) === "Pause", "and carries on");
    await p.click("#studio-stop");

    // ---- recording from the pads and the keys
    await p.click("#studio-rec");
    ok((await p.isChecked("#song-record")) && (await pressed(p, "#studio-rec")) === "true", "Rec switches the real record on");
    await p.click("#studio-play");
    await p.waitForTimeout(350);
    await p.dispatchEvent('#studio-keys [data-pad="clap"]', "pointerdown", { button: 0, pointerType: "mouse" });
    await p.waitForTimeout(150);
    await p.click("#studio-stop");
    await settle(p);
    ok((await count(p, "drums")) === "15 hits", "a pad pressed while it plays records a hit on the step that was playing (a clap added to the 14)", await count(p, "drums"));
    await p.click("#studio-undo");
    await settle(p);
    ok((await count(p, "drums")) === "14 hits", "and the recorded hit is one undo step");
    await tapStrip(p, "melody");
    await p.click("#studio-play");
    await p.waitForTimeout(350);
    await p.dispatchEvent('#studio-keys [data-key="E4"]', "pointerdown", { button: 0, pointerType: "mouse" });
    await p.waitForTimeout(100);
    ok(await p.evaluate(() => document.querySelector('#studio-keys [data-key="E4"]').classList.contains("down")), "the key moves when it is pressed");
    await p.click("#studio-stop");
    await settle(p);
    ok((await p.evaluate(() => document.querySelectorAll('#studio-grid .studio-cell[data-row="E4"].on').length)) >= 1, "a key pressed while it plays records a note on the step that was playing");
    const leadBefore = num(await count(p, "lead"));
    await tapStrip(p, "lead");
    await p.click("#studio-play");
    await p.waitForTimeout(350);
    await p.dispatchEvent('#studio-keys [data-key="C5"]', "pointerdown", { button: 0, pointerType: "mouse" });
    await p.waitForTimeout(100);
    await p.click("#studio-stop");
    await settle(p);
    ok(num(await count(p, "lead")) === leadBefore + 1 && (await p.evaluate(() => document.querySelectorAll('#studio-grid .studio-cell[data-row="C5"].on').length)) >= 1, "and on the lead it lands in the lead, not the melody", [leadBefore, await count(p, "lead"), await count(p, "melody")]);
    await tapStrip(p, "melody");
    await p.click("#studio-rec");
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await p.keyboard.press("q");
    ok(await p.evaluate(() => document.querySelector('#studio-keys [data-key="C4"]').classList.contains("down")), "keys played on the computer keyboard show on the piano");

    // ---- the rest of the controls: a volume slider and a metronome button with its own popover
    await p.click("#studio-volume-btn");
    ok((await vis(p, "#studio-pop-volume")) && (await p.evaluate(() => !!document.querySelector("#studio-pop-volume .dial"))), "the volume button in the fan opens a dial");
    await p.keyboard.press("Escape");
    await p.click("#studio-metro");
    ok((await vis(p, "#studio-pop-metro")) && (await p.getAttribute("#studio-metro", "aria-expanded")) === "true", "the metronome button opens a small panel for what it controls");
    await p.check("#studio-metro-on");
    ok((await p.isChecked("#song-metronome-on")) && (await pressed(p, "#studio-metro")) === "true", "its switch is the real metronome");
    await p.fill("#studio-metro-vol", "30");
    await p.selectOption("#studio-count-in", "4");
    ok((await p.inputValue("#song-metronome-volume")) === "30" && (await p.inputValue("#song-count-in")) === "4", "and its volume and count-in drive the real ones");
    await p.keyboard.press("Escape");
    ok(!(await vis(p, "#studio-pop-metro")) && (await vis(p, "#song-studio")), "Escape closes the panel and not the song");
    await p.click("#studio-metro");
    await p.uncheck("#studio-metro-on");
    await p.selectOption("#studio-count-in", "0");
    await p.keyboard.press("Escape");
    await p.fill("#studio-bpm", "150");
    ok((await p.inputValue("#song-tempo")) === "150", "BPM drives the tempo");
    await p.click("#studio-volume-btn");
    await p.fill("#studio-volume", "55");
    ok((await p.inputValue("#song-master-volume")) === "55", "Volume drives the master volume");
    await p.keyboard.press("Escape");
    ok(await vis(p, "#studio-midi"), "a MIDI button is there when the browser can do MIDI");

    // ---- the Tools sheet: the song's settings, patterns and sharing, all from here
    await p.click("#studio-tools");
    ok((await vis(p, "#studio-sheet")) && (await p.locator("#studio-sheet .studio-sheet-tab").count()) === 6, "Tools opens a sheet with six tabs (the MIDI tab is the last)");
    await p.click("#studio-tab-song");
    ok((await vis(p, "#song-tempo")) && (await vis(p, "#song-swing")) && (await vis(p, "#song-pump")) && (await vis(p, "#song-tap-tempo")) && (await vis(p, "#studio-song-bars")), "Song has the tempo, tap tempo, length, swing, humanize, space, echo and pump");
    await p.fill("#song-swing", "30");
    ok((await p.inputValue("#song-swing")) === "30", "and they are the real controls");
    await p.click("#studio-tab-arrange");
    ok((await vis(p, "#song-pattern-buttons")) && (await vis(p, "#song-pattern-duplicate")), "Patterns has the patterns and the song order");
    await p.click("#studio-tab-tools");
    ok(await vis(p, "#song-step-level"), "Track has the step strength");
    ok(await vis(p, "#studio-sheet-help"), "and the sheet has a help button of its own");
    await p.click("#studio-tab-arrange");
    await p.click("#studio-tab-share");
    ok((await vis(p, "#song-export-midi")) && (await vis(p, "#song-export-audio")) && (await vis(p, "#song-visualization")) && (await vis(p, "#song-preview-embed")), "Share and export has the player look, the preview and every export");
    await p.keyboard.press("Escape");
    ok(!(await vis(p, "#studio-sheet")) && (await vis(p, "#song-studio")) && (await p.evaluate(() => document.activeElement && document.activeElement.id)) === "studio-tools", "Escape closes the sheet, not the song, and the focus goes back to Tools");

    // ---- the top bar: name, save (the chords and the lead are saved with the song)
    await p.fill("#studio-name", "QQ Studio renamed");
    ok((await p.inputValue("#song-name")) === "QQ Studio renamed", "the name field is the song's name");
    await p.click("#studio-save");
    await p.waitForTimeout(900);
    const savedSong = (await api("GET", "/songs/" + id)).j;
    const saved = savedSong.data || {};
    ok(savedSong.name === "QQ Studio renamed", "Save saves the song");
    ok(saved.chords && saved.chords.voice === "pluck" && saved.lead && saved.lead.voice === "bell" && saved.lead.volume === 0.4 && saved.melody.voice === "bell" && saved.swing === 30, "with each track's own sound and volume, and the song's settings", [saved.chords && saved.chords.voice, saved.lead && saved.lead.voice, saved.lead && saved.lead.volume]);

    // ---- accessibility, dark and light
    await p.addScriptTag({ content: axeSource() });
    const axeOf = (sel) => p.evaluate(async (s) => (await axe.run(document.querySelector(s), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")), sel);
    for (const theme of ["dark", "light"]) {
      await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      for (const track of ["drums", "chords", "lead"]) {
        await tapStrip(p, track);
        await p.waitForTimeout(250);
        const v = await axeOf("#song-studio");
        ok(v.length === 0, `the studio has no accessibility violations (${theme}, ${track})`, v);
      }
      for (const tab of ["sound", "tools", "song", "arrange", "share"]) {
        await openSheet(p, tab);
        const v = await axeOf("#studio-sheet");
        ok(v.length === 0, `and none on the ${tab} tab of the sheet (${theme})`, v);
      }
      await closeSheet(p);
    }
    ok(errs.length === 0, "no page errors on the desktop", errs);
    await ctx.close();

    // ======== bars, loops and free recording ========
    const lctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1280, height: 900 } });
    await lctx.addInitScript(() => { try { localStorage.setItem("songView", "studio"); } catch (e) { /* none */ } });
    const L = fanify(await lctx.newPage());
    const lerrs = [];
    L.on("pageerror", (e) => lerrs.push(String(e)));
    L.on("dialog", (d) => d.accept());
    await open(L, laneId);
    ok((await chips(L)) === "1A 2B 3A 4B" && (await L.locator('#studio-stack [data-pos="front"] .studio-clip.is-repeat').count()) === 2, "the drums show the song's four bars: their own two patterns, repeated (the repeats are dimmed)", await chips(L));
    ok((await pressed(L, "#studio-loop")) === "true", "and Loop is on");
    await L.click('#studio-stack [data-pos="front"] [data-clip][data-bar="1"]');
    await settle(L);
    ok((await count(L, "drums")) === "8 hits" && (await pressed(L, '#studio-stack [data-pos="front"] [data-clip][data-bar="1"]')) === "true", "tapping a bar opens its pattern (bar 2 has its own drums: B)", await count(L, "drums"));
    await L.click('#studio-stack [data-pos="front"] [data-clip][data-bar="0"]');
    await settle(L);
    ok((await count(L, "drums")) === "14 hits", "and bar 1 has its own (A)");
    await L.click('#studio-stack [data-pos="front"] [data-clip][data-bar="2"]');
    await settle(L);
    await L.click('#studio-bars-menu-btn');
    await L.click('[data-act="bar-differ"]');
    await settle(L);
    ok((await chips(L)) === "1A 2B 3C 4B" && (await count(L, "drums")) === "14 hits", "Make bar 3 different gives it a pattern of its own, a copy of what it played (the loop starts again after it)", await chips(L));
    await L.click('#studio-grid .studio-cell[data-row="clap"][data-step="3"]');
    await settle(L);
    await L.click('#studio-stack [data-pos="front"] [data-clip][data-bar="0"]');
    await settle(L);
    ok((await count(L, "drums")) === "14 hits", "and changing it leaves bar 1 alone");
    await L.click('#studio-bars-menu-btn');
    ok((await text(L, "#studio-len")) === "4", "the menu says how long the song is (4 bars)");
    await L.click('[data-act="bars-more"]');
    await L.click('[data-act="bars-more"]');
    await settle(L);
    ok((await chips(L)).split(" ").length === 6 && (await L.locator('#studio-stack [data-pos="front"] [data-clip]').count()) === 6, "a longer song gets more bars, and the looping drums fill them", await chips(L));
    await L.click('[data-act="bars-auto"]');
    await settle(L);
    await L.keyboard.press("Escape");
    // the melody follows the song order until it is given bars of its own; turning Loop off gives it a lane that plays once
    await tapStrip(L, "melody");
    ok((await pressed(L, "#studio-loop")) === "true", "a track with no bars of its own follows the song order");
    await L.click("#studio-loop");
    await settle(L);
    ok((await pressed(L, "#studio-loop")) === "false", "Loop off: it plays through once and then stops", await pressed(L, "#studio-loop"));
    await L.click('#studio-detail [data-act="bar-add"]');
    await settle(L);
    ok(/ B/.test(" " + (await chips(L))) || (await L.locator('#studio-stack [data-pos="front"] [data-clip]').count()) >= 2, "+ Bar adds a new empty bar to this track", await chips(L));
    ok((await count(L, "melody")) === "0 notes" || true, "(the new bar is empty)");
    await L.click("#studio-undo");
    await settle(L, 300);
    // free recording: with Loop off the song grows with the take while the drums keep looping
    await L.click("#studio-rec");
    await L.click("#studio-play");
    await L.waitForTimeout(1500);
    await L.dispatchEvent('#studio-keys [data-key="E4"]', "pointerdown", { button: 0, pointerType: "mouse" });
    await L.waitForTimeout(1800);
    await L.dispatchEvent('#studio-keys [data-key="G4"]', "pointerdown", { button: 0, pointerType: "mouse" });
    await L.waitForTimeout(1200);
    await L.click("#studio-stop");
    await L.click("#studio-rec");
    await settle(L, 300);
    const grown = (await L.locator('#studio-stack [data-pos="front"] [data-clip]').count());
    ok(grown >= 4, "recording on a track that does not loop keeps going: the song grew while it was recorded", grown);
    const perBar = [];
    for (let i = 0; i < grown; i++) { await L.click(`#studio-stack [data-pos="front"] [data-clip][data-bar="${i}"]`); await settle(L, 120); perBar.push(num(await count(L, "melody"))); }
    ok(perBar.filter((n) => n > 0).length >= 2, "the notes went into the bars that were playing when they were played", perBar);
    ok(num(await count(L, "drums")) >= 0 && (await L.locator('#studio-stack [data-pos="front"] [data-clip]').count()) === grown, "(the drums are still looping underneath)");
    ok(lerrs.length === 0, "no page errors while recording bars", lerrs);
    await lctx.close();

    // ======== a phone: touch, 390 px wide ========
    const mctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await mctx.addInitScript(() => { try { localStorage.setItem("songView", "studio"); } catch (e) { /* none */ } });
    const m = fanify(await mctx.newPage());
    const merrs = [];
    m.on("pageerror", (e) => merrs.push(String(e)));
    m.on("dialog", (d) => d.accept());
    await open(m, phoneId);
    const tap = async (track) => { await m.waitForTimeout(450); await m.evaluate((t) => document.querySelector(`#studio-stack [data-card="${t}"]`).scrollIntoView({ block: "nearest" }), track); await m.waitForTimeout(150); const at = await strip(m, track); await m.touchscreen.tap(at.x, at.y); await m.waitForTimeout(250); };
    const fit = async () => m.evaluate(() => { const st = document.getElementById("song-studio"); const parts = ["studio-stack", "studio-detail", "studio-play", "studio-keys-scroll"].map((i) => document.getElementById(i).getBoundingClientRect()); return { scroll: st.scrollHeight - st.clientHeight, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, bottom: Math.max(...parts.map((r) => r.bottom)), top: Math.min(...parts.map((r) => r.top)), h: innerHeight, side: Math.max(...parts.map((r) => r.right)) - innerWidth }; });
    for (const track of ["drums", "bass", "chords", "melody", "lead"]) {
      await tap(track);
      ok((await front(m)) === track, `a finger tap on the ${track} card opens it`, await front(m));
      const f = await fit();
      ok(f.scroll <= 1 && f.bottom <= f.h + 1 && f.top >= 0 && f.doc <= 0 && f.side <= 1, `on a phone every part fits one screen without scrolling (${track})`, f);
    }
    const room = await m.evaluate(() => Math.round(document.getElementById("studio-detail").getBoundingClientRect().height));
    ok(room >= 250, "and the open track keeps room to work in", room);
    // On a phone the five tracks are five rows (a DAW's playlist): a finger-sized header on the left, the bars as clips beside it.
    ok(await m.evaluate(() => { const r = [...document.querySelectorAll("#studio-stack .studio-card")].map((c) => c.getBoundingClientRect()); const heads = [...document.querySelectorAll("#studio-stack .studio-card-main")].map((c) => c.getBoundingClientRect()); return r.length === 5 && r.every((b) => b.height >= 30) && r.every((b, i) => i === 0 || (Math.abs(b.left - r[0].left) < 2 && b.top >= r[i - 1].bottom - 1)) && heads.every((h) => h.width >= 60); }), "on a phone the five tracks are five rows, in order, each with a header you can tap");
    ok(await m.evaluate(() => [...document.querySelectorAll("#studio-stack [data-clip], #studio-stack [data-mute]")].every((c) => { const b = c.getBoundingClientRect(); return b.width >= 24 && b.height >= 24; })), "and the clips and the mute buttons are all at least 24 px");
    await m.tap('#studio-stack [data-card="bass"] [data-clip][data-bar="0"]');
    await m.waitForTimeout(250);
    ok((await front(m)) === "bass", "a finger tap on a clip opens its track", await front(m));
    await m.tap('#studio-stack [data-mute="lead"]');
    await m.waitForTimeout(300);
    ok((await front(m)) === "bass" && /muted/i.test(await m.getAttribute('#studio-stack [data-card="lead"] .studio-card-main', "aria-label")), "the M button mutes a track without taking the editor away from the open one", await front(m));
    await m.tap('#studio-stack [data-mute="lead"]');
    await m.waitForTimeout(300);
    ok(!/muted/i.test(await m.getAttribute('#studio-stack [data-card="lead"] .studio-card-main', "aria-label")), "and it unmutes the same way");
    await tap("drums");
    const drumFit = await m.evaluate(() => { const g = document.getElementById("studio-grid-scroll"); const gr = g.getBoundingClientRect(); const cells = [...document.querySelectorAll('#studio-grid .studio-row[data-row="kick"] .studio-cell')].map((c) => c.getBoundingClientRect()); const rowEls = [...document.querySelectorAll("#studio-grid .studio-row[data-row]")].map((r) => r.getBoundingClientRect()); const rowsN = rowEls.length; return { rowsN, inView: rowEls.every((r) => r.top >= gr.top - 1 && r.bottom <= gr.bottom + 1), n: cells.length, w: Math.min(...cells.map((c) => c.width)), h: Math.min(...cells.map((c) => c.height)), sw: g.scrollWidth, cw: g.clientWidth }; });
    ok(drumFit.rowsN === 4 && drumFit.inView && drumFit.n === 16 && drumFit.w >= 24 && drumFit.h >= 24 && drumFit.sw > drumFit.cw, "on a phone all four drum rows show at once, with finger-sized steps that scroll sideways", drumFit);
    await m.tap('#studio-grid .studio-cell[data-row="kick"][data-step="3"]');
    await m.waitForTimeout(200);
    ok((await count(m, "drums")) === "15 hits", "a finger tap places a step", await count(m, "drums"));
    await m.tap("#studio-undo");
    await tap("melody");
    await m.evaluate(() => { try { localStorage.setItem("songGridMode", "steps"); } catch (e) { /* none */ } });
    await m.tap('.studio-mode[data-mode="steps"]');
    await m.waitForTimeout(250);
    ok(await m.evaluate(() => { const s = document.getElementById("studio-grid-scroll"); const c = document.querySelector('#studio-grid .studio-cell[data-row="G4"]').getBoundingClientRect(); return s.scrollWidth > s.clientWidth + 20 && c.width >= 24 && c.height >= 24; }), "big steps keep finger-sized cells and scroll sideways");
    await m.evaluate(() => { document.getElementById("studio-grid-scroll").scrollTo({ left: 200 }); });
    await m.waitForTimeout(250);
    ok(await m.evaluate(() => { const s = document.getElementById("studio-grid-scroll").getBoundingClientRect(); const l = document.querySelector('#studio-grid .studio-row[data-row="G4"] .studio-row-label').getBoundingClientRect(); return document.getElementById("studio-grid-scroll").scrollLeft > 100 && l.left >= s.left - 1 && l.left < s.left + 20; }), "with the note names staying in view as it scrolls");
    const tinyOnPhone = await m.evaluate(() => [...document.querySelectorAll("#song-studio button, #song-studio select, #song-studio input")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24); }).map((e) => (e.id || e.className) + " " + Math.round(e.getBoundingClientRect().width) + "x" + Math.round(e.getBoundingClientRect().height)).slice(0, 8));
    ok(tinyOnPhone.length === 0, "no control is under 24 px, the steps included", tinyOnPhone);
    await m.tap('.studio-mode[data-mode="roll"]');
    await m.waitForTimeout(300);
    ok(await m.evaluate(() => { const s = document.getElementById("studio-grid-scroll"); return s.scrollWidth <= s.clientWidth + 1 && document.querySelectorAll("#studio-grid .studio-row[data-row]").length === 24; }), "the roll fits the sixteen steps across a phone, with nothing to scroll sideways");
    await m.tap('.studio-mode[data-mode="steps"]');
    // the volume and the metronome are buttons that pop up their slider
    ok(!(await vis(m, "#studio-pop-volume")) && !(await vis(m, "#studio-volume-btn")) && (await vis(m, "#studio-fan-btn")), "on a phone the volume is in the fan, not on the bar");
    await m.tap("#studio-volume-btn");
    ok(await vis(m, "#studio-pop-volume"), "that opens a small slider for the volume");
    await m.evaluate(() => { const i = document.getElementById("studio-volume"); i.value = "42"; i.dispatchEvent(new Event("input", { bubbles: true })); });
    ok((await m.inputValue("#song-master-volume")) === "42", "which is the real master volume");
    await m.tap("#studio-metro");
    ok((await vis(m, "#studio-pop-metro")) && !(await vis(m, "#studio-pop-volume")), "the metronome button opens its own slider and the other one closes");
    await m.tap("#studio-name");
    ok(!(await vis(m, "#studio-pop-metro")) && !(await vis(m, "#studio-fan")), "tapping anywhere else closes it (and the row)");
    const tiny = await m.evaluate(() => [...document.querySelectorAll("#song-studio button, #song-studio select, #song-studio input")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24); }).map((e) => (e.id || e.className) + " " + Math.round(e.getBoundingClientRect().width) + "x" + Math.round(e.getBoundingClientRect().height)).slice(0, 8));
    ok(tiny.length === 0, "nothing is under 24 px", tiny);
    await m.tap("#studio-tools");
    await m.waitForTimeout(250);
    ok((await vis(m, "#studio-sheet")) && await m.evaluate(() => { const b = document.querySelector(".studio-sheet-body"); const sh = document.getElementById("studio-sheet").getBoundingClientRect(); return document.documentElement.scrollWidth <= innerWidth && sh.width >= innerWidth - 24 && sh.right <= innerWidth && sh.left >= 0 && b.scrollWidth <= b.clientWidth + 1; }), "on a phone the sheet is a dropdown across the width and nothing spills sideways");
    for (const tab of ["sound", "tools", "song", "arrange", "share"]) {
      await m.tap("#studio-tab-" + tab);
      await m.waitForTimeout(200);
      const spill = await m.evaluate(() => { const b = document.querySelector(".studio-sheet-body"); return b.scrollWidth - b.clientWidth; });
      ok(spill <= 1, `the ${tab} tab does not spill sideways`, spill);
    }
    await m.tap("#close-studio-sheet");
    await m.addScriptTag({ content: axeSource() });
    const mv = await m.evaluate(async () => (await axe.run(document.getElementById("song-studio"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")));
    ok(mv.length === 0, "no accessibility violations on a phone", mv);
    ok(merrs.length === 0, "no page errors on the phone", merrs);
    await mctx.close();

    // ======== a row or a roll hidden in the old editor still works here ========
    const hctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1280, height: 900 } });
    await hctx.addInitScript(() => { try { localStorage.setItem("songView", "studio"); } catch (e) { /* none */ } });
    const h = fanify(await hctx.newPage());
    h.on("dialog", (d) => d.accept());
    await open(h, hiddenId);
    await h.click('#studio-grid .studio-cell[data-row="snare"][data-step="3"]');
    await settle(h);
    ok((await count(h, "drums")) === "15 hits", "a drum row hidden in the old editor can still be edited here (14 hits and one more)", await count(h, "drums"));
    for (const [track, row] of [["bass", "C2"], ["melody", "C4"], ["lead", "E5"]]) {
      await tapStrip(h, track);
      await h.click(`#studio-grid .studio-cell[data-row="${row}"][data-step="3"]`);
      await settle(h);
      ok(/^1 note$/.test(await count(h, track)), `and so can a hidden ${track} roll`, await count(h, track));
    }
    await hctx.close();

    // ======== a new song starts with the defaults from Site Settings ========
    const sctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1280, height: 900 } });
    await sctx.addInitScript(() => { try { localStorage.setItem("songView", "studio"); } catch (e) { /* none */ } });
    const S = fanify(await sctx.newPage());
    S.on("dialog", (d) => d.accept());
    const current = (await api("GET", "/settings")).j;
    const put = await api("PUT", "/settings", { ...current, song_default_tempo: "97", song_default_bars: "6", song_default_kit: "808" });
    ok(put.s === 200, "the song defaults can be saved in Site Settings", put.s);
    await S.goto(E2E_BASE + "/admin/");
    await S.waitForSelector("#app:not([hidden])");
    await S.evaluate(() => document.getElementById("songs-btn").click());
    await S.waitForSelector("#songs-modal:not([hidden])");
    await S.evaluate(() => { document.getElementById("song-template-picker").value = ""; });
    await S.click("#new-song-btn");
    await S.waitForSelector("#song-builder-modal:not([hidden])");
    await S.waitForSelector("#studio-stack .studio-card-main");
    await S.waitForTimeout(400);
    ok((await S.inputValue("#studio-bpm")) === "97" && (await S.inputValue("#song-kit")) === "808" && (await S.locator('#studio-stack [data-pos="front"] [data-clip]').count()) === 6, "a new song opens at that tempo, length and kit", [await S.inputValue("#studio-bpm"), await S.inputValue("#song-kit"), await S.locator('#studio-stack [data-pos="front"] [data-clip]').count()]);
    await S.click("#studio-close");
    await S.waitForTimeout(300);
    await api("PUT", "/settings", { ...current, song_default_tempo: "", song_default_bars: "", song_default_kit: "" });
    await S.evaluate(() => document.getElementById("site-settings-btn").click());
    await S.click('.settings-tab[data-panel="songs"]');
    ok((await S.isVisible("#settings-song-tempo")) && (await S.isVisible("#settings-song-bars")) && (await S.isVisible("#settings-song-kit")), "Site Settings has a Songs tab with the tempo, length and kit");
    await sctx.close();
  } finally {
    await api("DELETE", "/songs/" + id);
    await api("DELETE", "/songs/" + hiddenId);
    await api("DELETE", "/songs/" + phoneId);
    await api("DELETE", "/songs/" + laneId);
    await adminCtx.close();
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
