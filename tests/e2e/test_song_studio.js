// The Song builder's Studio layout, as sketched: five track cards stacked on top of each other (Drums, Bass, Chords, Melody, Lead, always
// in that order), the open track's expanded card, the play controls, and a piano that stays at the bottom. Checks the fixed tracks, choosing
// one (tap, swipe, wheel, arrows), editing steps and sounds from the card, pause and carry on, recording from the keys and pads, undo, the
// classic editor one click away, and a phone screen with no scrolling.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
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
  const rows = (p) => p.evaluate(() => [...document.querySelectorAll("#studio-grid .studio-row")].map((r) => r.dataset.row));
  const keyCount = (p) => p.evaluate(() => [document.querySelectorAll("#studio-keys .studio-key-white").length, document.querySelectorAll("#studio-keys .studio-key-black").length].join("/"));
  const firstKey = (p) => p.evaluate(() => (document.querySelector("#studio-keys .studio-key-white span") || {}).textContent);
  // where the visible strip of a card is: a tap there picks it
  const strip = (p, track) => p.evaluate((t) => { const r = document.querySelector(`#studio-stack [data-card="${t}"]`).getBoundingClientRect(); const s = document.getElementById("studio-stack").getBoundingClientRect(); return { x: s.left + s.width / 2, y: r.top + 13 }; }, track);
  const tapStrip = async (p, track) => { await p.waitForTimeout(450); const at = await strip(p, track); await p.mouse.click(at.x, at.y); await p.waitForTimeout(200); };
  const num = (s) => Number((/^(\d+)/.exec(s) || [])[1]);

  try {
    // ======== a desktop window ========
    const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("songView", "studio"); } catch (e) { /* none */ } });
    await ctx.addInitScript(spy);
    const p = await ctx.newPage();
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
    ok(tops[0] < tops[1] && tops[1] < tops[2] && tops[2] < tops[3], "stacked cards, then the open track, then the play controls, then the keys at the bottom", tops);
    ok(await vis(p, "#song-studio") && !(await vis(p, ".song-builder-body")) && !(await vis(p, ".song-toolbar")), "the classic header and body stay out of the way");
    ok((await front(p)) === "drums" && /Drums/.test(await text(p, "#studio-detail h2")), "it opens on the first track that has something in it (Drums)", await front(p));
    ok((await p.locator("#studio-detail h2").count()) === 1 && (await p.locator('#studio-stack [data-pos="front"]').count()) === 1, "only one track is open at a time");
    const counts = await Promise.all(["drums", "bass", "chords", "melody", "lead"].map((t) => count(p, t)));
    ok(counts.join("|") === "14 hits|2 notes|3 notes|4 notes|2 notes", "each card gives a simple overview (hits for the drums, notes for the rest)", counts);
    const dotCounts = await p.evaluate(() => ["drums", "bass", "chords", "melody", "lead"].map((t) => document.querySelectorAll(`#studio-stack [data-card="${t}"] .studio-dots rect`).length).join());
    ok(dotCounts === "14,2,3,4,2", "and a small picture of where its notes are", dotCounts);
    const sounds = await Promise.all(["drums", "bass", "chords", "melody", "lead"].map((t) => sound(p, t)));
    ok(sounds.join("|") === "Acoustic kit|Bass|Pad|Basic sine|Lead", "and the sound it plays with", sounds);
    ok(!(await p.isEnabled("#studio-undo")), "nothing to undo on a freshly opened song");
    ok(!(await p.evaluate(() => /add (a )?(new )?track|new track|reorder|move (up|down)/i.test(document.getElementById("song-studio").textContent + [...document.querySelectorAll("#song-studio [aria-label], #song-studio [title]")].map((e) => (e.getAttribute("aria-label") || "") + (e.title || "")).join(" ")))) && (await p.evaluate(() => document.querySelectorAll("#song-studio [draggable=true]").length)) === 0, "there is no way to add, remove or reorder tracks");

    // ---- choosing a track: tap a strip, the arrow keys, the wheel, a swipe
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
    await p.waitForTimeout(450);
    const box = await p.evaluate(() => { const r = document.getElementById("studio-stack").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.mouse.move(box.x, box.y);
    await p.mouse.wheel(0, 120);
    await settle(p, 350);
    ok((await front(p)) === "bass", "scrolling the wheel over the stack moves to the next card", await front(p));
    await p.mouse.wheel(0, 120);
    await settle(p, 350);
    await p.mouse.wheel(0, -120);
    await settle(p, 350);
    ok((await front(p)) === "bass", "and back up again", await front(p));
    await p.waitForTimeout(450);
    await p.mouse.move(box.x, box.y + 40); await p.mouse.down(); await p.mouse.move(box.x, box.y + 10, { steps: 4 }); await p.mouse.move(box.x, box.y - 40, { steps: 4 }); await p.mouse.up();
    await settle(p);
    ok((await front(p)) === "chords", "swiping up goes to the next card", await front(p));
    await p.waitForTimeout(450);
    await p.mouse.move(box.x, box.y - 40); await p.mouse.down(); await p.mouse.move(box.x, box.y - 10, { steps: 4 }); await p.mouse.move(box.x, box.y + 40, { steps: 4 }); await p.mouse.up();
    await settle(p);
    ok((await front(p)) === "bass", "swiping down brings the one before it forward", await front(p));
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

    // ---- the drums track: add a sound, mute, the mix, the kit, clear
    ok((await p.locator("#studio-add option").count()) === 4, "it offers open hat, rim, tom and crash to add", await p.locator("#studio-add option").count());
    await p.selectOption("#studio-add", "tom");
    await p.click("#studio-add-btn");
    await settle(p);
    const drumRows2 = await rows(p);
    ok(drumRows2.join() === "kick,snare,hihat,clap,tom" && (await p.locator("#studio-add option").count()) === 3 && (await p.locator("#studio-keys .studio-pad").count()) === 5 && (await p.locator("#studio-stack .studio-card").count()) === 5, "adding a sound puts a row and a pad in the same track", drumRows2);
    await p.click("#studio-mute");
    await settle(p);
    const muted = await p.evaluate(() => ["kick", "snare", "hihat", "clap", "tom"].map((r) => document.querySelector(`.song-track-mute[data-row="${r}"]`).getAttribute("aria-pressed")).join());
    ok(muted === "true,true,true,true,true" && (await pressed(p, "#studio-mute")) === "true" && /muted/i.test(await p.getAttribute('#studio-stack [data-card="drums"] .studio-card-main', "aria-label")) && /muted/.test(await count(p, "drums")), "Mute silences every drum sound and the card says so", muted);
    await p.click("#studio-mute");
    await settle(p);
    ok((await p.evaluate(() => document.querySelector('.song-track-mute[data-row="kick"]').getAttribute("aria-pressed"))) === "false" && !/muted/.test(await count(p, "drums")), "and it comes back");
    await p.click(".studio-mix summary");
    await p.click('[data-row-mute="hihat"]');
    await settle(p);
    const mix = await p.evaluate(() => ["kick", "hihat"].map((r) => document.querySelector(`.song-track-mute[data-row="${r}"]`).getAttribute("aria-pressed")).join());
    ok(mix === "false,true", "one sound can be muted alone from the mix", mix);
    await p.click('[data-row-mute="hihat"]');
    await p.fill('[data-row-vol="kick"]', "40");
    await settle(p);
    ok((await p.inputValue('.song-track-volume[data-row="kick"]')) === "40", "and its volume set there");
    await p.selectOption("#studio-kit", "808");
    await settle(p);
    ok((await p.inputValue("#song-kit")) === "808" && (await sound(p, "drums")) === "808 kit", "the drum kit menu drives the real one and the card shows it");
    await p.selectOption("#studio-kit", "acoustic");
    await settle(p);
    await p.click("#studio-clear");
    await settle(p);
    ok((await count(p, "drums")) === "0 hits", "Clear track empties every drum sound", await count(p, "drums"));
    await p.click("#studio-undo");
    await settle(p);
    ok((await count(p, "drums")) === "14 hits", "and one Undo brings them all back", await count(p, "drums"));

    // ---- the bass: its own low roll and keys, its sound, Follow the kick
    await tapStrip(p, "bass");
    const bassRows = await rows(p);
    ok(bassRows.length === 24 && bassRows[0] === "B2" && bassRows[23] === "C1" && (await keyCount(p)) === "14/10" && (await firstKey(p)) === "C1", "the bass is a roll from B2 down to C1, with its own two octaves of keys", [bassRows[0], bassRows[23], await keyCount(p)]);
    ok(await p.evaluate(() => { const s = document.getElementById("studio-grid-scroll"); const r = document.querySelector('#studio-grid .studio-row[data-row="C2"]').getBoundingClientRect(); const c = s.getBoundingClientRect(); return r.top >= c.top - 1 && r.bottom <= c.bottom + 1; }), "the roll opens scrolled to where the notes are");
    await p.selectOption("#studio-voice", "pluck");
    await settle(p);
    ok((await p.inputValue("#song-bass-voice")) === "pluck" && /pluck/i.test(await sound(p, "bass")), "the bass sound drives the bass voice");
    await p.click("#studio-follow");
    await settle(p);
    ok((await count(p, "bass")) === "4 notes" && /Bass on every kick/.test(await text(p, "#studio-note")), "Follow the kick puts a held note on every kick (four notes, however long they are held) and says so", [await count(p, "bass"), await text(p, "#studio-note")]);
    await p.click("#studio-undo");
    await settle(p);
    ok((await count(p, "bass")) === "2 notes", "and it is undoable");

    // ---- the chords: pad by default, a progression fills the loop
    await tapStrip(p, "chords");
    const chordRows = await rows(p);
    ok(chordRows.length === 24 && chordRows[0] === "B4" && chordRows[23] === "C3" && (await keyCount(p)) === "14/10" && (await firstKey(p)) === "C3", "the chords are a roll from B4 down to C3, with keys to match", [chordRows[0], chordRows[23]]);
    ok((await p.inputValue("#studio-voice")) === "pad" && (await sound(p, "chords")) === "Pad", "they start on the Pad sound");
    await p.selectOption("#studio-voice", "pluck");
    await settle(p);
    ok((await p.inputValue("#song-part-voice")) === "pluck" && /pluck/i.test(await sound(p, "chords")), "the chords sound drives the real menu");
    const progs = await p.evaluate(() => [...document.querySelectorAll("#studio-prog-type option")].map((o) => o.value));
    await p.selectOption("#studio-prog-type", progs[0]);
    await p.click("#studio-prog-stamp");
    await settle(p);
    const stamped = num(await count(p, "chords"));
    ok(stamped > 3 && /progression/i.test(await text(p, "#studio-note")), "Fill puts a chord progression across the loop and says which", [await count(p, "chords"), await text(p, "#studio-note")]);
    ok((await count(p, "bass")) === "2 notes" && (await count(p, "melody")) === "4 notes", "and leaves the other tracks alone");
    await p.click("#studio-undo");
    await settle(p);
    ok((await count(p, "chords")) === "3 notes", "Undo takes the progression back");

    // ---- the melody: piano sound, wave, volume, a held note, clear
    await tapStrip(p, "melody");
    const melRows = await rows(p);
    ok(melRows.length === 24 && melRows[0] === "B4" && melRows[23] === "C3" && (await keyCount(p)) === "14/10", "the melody is a roll from B4 down to C3", [melRows[0], melRows[23]]);
    ok(await p.evaluate(() => { const s = document.getElementById("studio-grid-scroll"); const r = document.querySelector('#studio-grid .studio-row[data-row="G4"]').getBoundingClientRect(); const c = s.getBoundingClientRect(); return r.top >= c.top - 1 && r.bottom <= c.bottom + 1; }), "the roll opens scrolled to where the notes are");
    await p.selectOption("#studio-voice", "bell");
    await settle(p);
    ok((await p.inputValue("#song-voice")) === "bell" && !(await vis(p, "#studio-wave")) && /Bell/.test(await sound(p, "melody")), "the piano sound drives the melody voice, hides the basic wave and shows on the card");
    await p.fill("#studio-track-vol", "40");
    await settle(p);
    ok((await p.inputValue("#song-melody-volume")) === "40", "the volume slider drives the real one");
    await p.click('#studio-grid .studio-cell[data-row="C4"][data-step="1"]');
    await p.click('#studio-grid .studio-cell[data-row="C4"][data-step="2"]');
    await settle(p);
    ok((await count(p, "melody")) === "6 notes", "two more notes make six", await count(p, "melody"));
    const cell2 = await p.locator('#studio-grid .studio-cell[data-row="C4"][data-step="2"]').boundingBox();
    await p.mouse.move(cell2.x + cell2.width / 2, cell2.y + cell2.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(700);
    await p.mouse.up();
    await settle(p);
    ok((await p.evaluate(() => document.querySelector('#song-piano-roll .song-step[data-row="C4"][data-step="2"]').classList.contains("song-step-tied"))) && (await p.evaluate(() => document.querySelector('#studio-grid .studio-cell[data-row="C4"][data-step="2"]').classList.contains("tied"))), "holding a note ties it to the one before");
    ok((await count(p, "melody")) === "5 notes", "and a held step is the same note, not another one (five)", await count(p, "melody"));
    await p.click("#studio-clear");
    await settle(p);
    ok((await count(p, "melody")) === "0 notes", "Clear track empties the track");
    await p.click("#studio-undo");
    await settle(p);
    ok((await count(p, "melody")) === "5 notes", "and it is undoable");

    // ---- the lead: the highest roll, its sound and volume, mute
    await tapStrip(p, "lead");
    const leadRows = await rows(p);
    ok(leadRows.length === 24 && leadRows[0] === "B5" && leadRows[23] === "C4" && (await keyCount(p)) === "14/10" && (await firstKey(p)) === "C4", "the lead is a roll from B5 down to C4", [leadRows[0], leadRows[23]]);
    ok((await p.inputValue("#studio-voice")) === "lead" && (await sound(p, "lead")) === "Lead", "it starts on the Lead sound");
    await p.selectOption("#studio-voice", "bell");
    await settle(p);
    ok((await p.inputValue("#song-part-voice")) === "bell" && /Bell/.test(await sound(p, "lead")) && /pluck/i.test(await sound(p, "chords")), "changing the lead's sound leaves the chords' sound alone");
    await p.fill("#studio-track-vol", "40");
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

    // ---- the rest of the controls
    await p.click("#studio-metro");
    ok((await pressed(p, "#studio-metro")) === "true" && (await p.isChecked("#song-metronome-on")), "Metronome toggles the real one");
    await p.click("#studio-metro");
    await p.fill("#studio-bpm", "150");
    ok((await p.inputValue("#song-tempo")) === "150", "BPM drives the tempo");
    await p.fill("#studio-volume", "55");
    ok((await p.inputValue("#song-master-volume")) === "55", "Volume drives the master volume");

    // ---- the top bar: name, save (the chords and the lead are saved with the song)
    await p.fill("#studio-name", "QQ Studio renamed");
    ok((await p.inputValue("#song-name")) === "QQ Studio renamed", "the name field is the song's name");
    await p.click("#studio-save");
    await p.waitForTimeout(900);
    const savedSong = (await api("GET", "/songs/" + id)).j;
    const saved = savedSong.data || (savedSong.song || {}).data || {};
    ok(savedSong.name === "QQ Studio renamed" || (savedSong.song || {}).name === "QQ Studio renamed", "Save saves the song");
    ok(saved.chords && saved.chords.voice === "pluck" && saved.lead && saved.lead.voice === "bell" && saved.lead.volume === 0.4 && saved.melody.voice === "bell", "with each track's own sound and volume", [saved.chords && saved.chords.voice, saved.lead && saved.lead.voice, saved.lead && saved.lead.volume]);

    // ---- the classic editor, one tap away, with the same song
    await p.click("#studio-full");
    ok(!(await vis(p, "#song-studio")) && (await vis(p, ".song-builder-body")) && (await vis(p, "#song-sequencer")) && (await vis(p, "#song-piano-roll")) && (await vis(p, ".song-toolbar")), "Full editor brings the whole classic editor back");
    ok((await p.inputValue("#song-tempo")) === "150" && (await vis(p, "#song-view-toggle")), "with the same song, and a way back");
    ok((await p.evaluate(() => localStorage.getItem("songView"))) === "classic", "the choice is remembered");
    await p.click("#song-view-toggle");
    ok((await vis(p, "#song-studio")) && !(await vis(p, ".song-builder-body")) && (await p.evaluate(() => localStorage.getItem("songView"))) === "studio", "Studio view returns");

    // ---- accessibility, dark and light
    await p.addScriptTag({ content: axeSource() });
    for (const theme of ["dark", "light"]) {
      await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      for (const track of ["drums", "chords", "lead"]) {
        await tapStrip(p, track);
        await p.waitForTimeout(250);
        const v = await p.evaluate(async () => (await axe.run(document.getElementById("song-studio"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")));
        ok(v.length === 0, `the studio has no accessibility violations (${theme}, ${track})`, v);
      }
    }
    ok(errs.length === 0, "no page errors on the desktop", errs);
    await ctx.close();

    // ======== a phone: touch, 390 px wide, no scrolling ========
    const mctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await mctx.addInitScript(() => { try { localStorage.setItem("songView", "studio"); } catch (e) { /* none */ } });
    const m = await mctx.newPage();
    const merrs = [];
    m.on("pageerror", (e) => merrs.push(String(e)));
    m.on("dialog", (d) => d.accept());
    await open(m, phoneId);
    const tap = async (track) => { await m.waitForTimeout(450); const at = await strip(m, track); await m.touchscreen.tap(at.x, at.y); await m.waitForTimeout(250); };
    const fit = async () => m.evaluate(() => { const st = document.getElementById("song-studio"); const parts = ["studio-stack", "studio-detail", "studio-play", "studio-keys-scroll"].map((i) => document.getElementById(i).getBoundingClientRect()); return { scroll: st.scrollHeight - st.clientHeight, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, bottom: Math.max(...parts.map((r) => r.bottom)), top: Math.min(...parts.map((r) => r.top)), h: innerHeight, side: Math.max(...parts.map((r) => r.right)) - innerWidth }; });
    for (const track of ["drums", "bass", "chords", "melody", "lead"]) {
      await tap(track);
      ok((await front(m)) === track, `a finger tap on the ${track} card opens it`, await front(m));
      const f = await fit();
      ok(f.scroll <= 1 && f.bottom <= f.h + 1 && f.top >= 0 && f.doc <= 0 && f.side <= 1, `on a phone every part fits one screen without scrolling (${track})`, f);
    }
    ok(await m.evaluate(() => document.getElementById("studio-detail").getBoundingClientRect().height >= 280), "and the open track keeps room to work in");
    // a swipe on the stack (touch pointer events) moves one card
    const swipe = (dy) => m.evaluate((d) => { const el = document.getElementById("studio-stack"); const r = el.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2; const ev = (type, yy) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 41, pointerType: "touch", isPrimary: true, button: 0, clientX: x, clientY: yy })); ev("pointerdown", y); ev("pointermove", y + d / 2); ev("pointermove", y + d); ev("pointerup", y + d); }, dy);
    await m.waitForTimeout(450);
    await swipe(60);
    await m.waitForTimeout(250);
    ok((await front(m)) === "melody", "swiping down on the stack brings the card before forward", await front(m));
    await m.waitForTimeout(450);
    await swipe(-60);
    await m.waitForTimeout(250);
    ok((await front(m)) === "lead", "and swiping up goes on to the next", await front(m));
    await tap("drums");
    ok(await m.evaluate(() => { const g = document.getElementById("studio-grid-scroll"); const cells = [...document.querySelectorAll('#studio-grid .studio-row[data-row="kick"] .studio-cell')].map((c) => c.getBoundingClientRect()); const rowsN = document.querySelectorAll("#studio-grid .studio-row").length; return rowsN === 4 && g.scrollHeight <= g.clientHeight + 1 && cells.length === 16 && Math.min(...cells.map((c) => c.width)) >= 24 && Math.min(...cells.map((c) => c.height)) >= 24 && g.scrollWidth > g.clientWidth; }), "on a phone all four drum rows show at once, with finger-sized steps that scroll sideways");
    await m.tap('#studio-grid .studio-cell[data-row="kick"][data-step="3"]');
    await m.waitForTimeout(200);
    ok((await count(m, "drums")) === "15 hits", "a finger tap places a step", await count(m, "drums"));
    await m.tap("#studio-undo");
    await tap("melody");
    ok(await m.evaluate(() => { const s = document.getElementById("studio-grid-scroll"); const c = document.querySelector('#studio-grid .studio-cell[data-row="G4"]').getBoundingClientRect(); return s.scrollWidth > s.clientWidth + 20 && c.width >= 24 && c.height >= 24; }), "the note roll keeps finger-sized cells and scrolls sideways");
    await m.evaluate(() => { document.getElementById("studio-grid-scroll").scrollTo({ left: 200 }); });
    await m.waitForTimeout(250);
    ok(await m.evaluate(() => { const s = document.getElementById("studio-grid-scroll").getBoundingClientRect(); const l = document.querySelector('#studio-grid .studio-row[data-row="G4"] .studio-row-label').getBoundingClientRect(); return document.getElementById("studio-grid-scroll").scrollLeft > 100 && l.left >= s.left - 1 && l.left < s.left + 20; }), "with the note names staying in view as it scrolls");
    await m.evaluate(() => { document.getElementById("studio-grid-scroll").scrollTo({ left: 0 }); });
    const keyW = await m.evaluate(() => Math.min(...[...document.querySelectorAll("#studio-keys .studio-key")].map((k) => k.getBoundingClientRect().width)));
    ok(keyW >= 24, "every key is wide enough to hit (the keyboard scrolls sideways)", keyW);
    ok(await m.evaluate(() => { const s = document.getElementById("studio-keys-scroll"); return s.scrollWidth > s.clientWidth + 20; }), "the keyboard is wider than the screen and scrolls");
    await m.evaluate(() => document.getElementById("studio-keys-scroll").scrollTo({ left: 0 }));
    await m.waitForTimeout(100);
    const before = await m.evaluate(() => document.getElementById("studio-keys-scroll").scrollLeft);
    await m.evaluate((b0) => document.getElementById("studio-keys-scroll").scrollTo({ left: b0 + 120 }), before);
    await m.waitForTimeout(100);
    ok(await m.evaluate((b0) => document.getElementById("studio-keys-scroll").scrollLeft > b0, before), "it scrolls along");
    const tiny = await m.evaluate(() => [...document.querySelectorAll("#song-studio button, #song-studio select, #song-studio input")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24); }).map((e) => (e.id || e.className) + " " + Math.round(e.getBoundingClientRect().width) + "x" + Math.round(e.getBoundingClientRect().height)).slice(0, 8));
    ok(tiny.length === 0, "no control is under 24 px, the steps included", tiny);
    await m.addScriptTag({ content: axeSource() });
    const mv = await m.evaluate(async () => (await axe.run(document.getElementById("song-studio"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")));
    ok(mv.length === 0, "no accessibility violations on a phone", mv);
    ok(merrs.length === 0, "no page errors on the phone", merrs);
    await mctx.close();

    // ======== a row or a roll hidden in the classic editor still works here ========
    const hctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1280, height: 900 } });
    await hctx.addInitScript(() => { try { localStorage.setItem("songView", "studio"); } catch (e) { /* none */ } });
    const h = await hctx.newPage();
    h.on("dialog", (d) => d.accept());
    await open(h, hiddenId);
    await h.click('#studio-grid .studio-cell[data-row="snare"][data-step="3"]');
    await settle(h);
    ok((await count(h, "drums")) === "15 hits", "a drum row hidden in the classic editor can still be edited here (14 hits and one more)", await count(h, "drums"));
    for (const [track, row] of [["bass", "C2"], ["melody", "C4"], ["lead", "E5"]]) {
      await tapStrip(h, track);
      await h.click(`#studio-grid .studio-cell[data-row="${row}"][data-step="3"]`);
      await settle(h);
      ok(/^1 note$/.test(await count(h, track)), `and so can a hidden ${track} roll`, await count(h, track));
    }
    await hctx.close();

    // ======== two patterns: the buttons are here too ========
    const pctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1280, height: 900 } });
    await pctx.addInitScript(() => { try { localStorage.setItem("songView", "studio"); } catch (e) { /* none */ } });
    const q = await pctx.newPage();
    q.on("dialog", (d) => d.accept());
    await open(q, id);
    ok((await q.locator("#studio-patterns .studio-pat").count()) === 0, "with one pattern there are no pattern buttons to clutter the card");
    await q.evaluate(() => document.getElementById("song-pattern-duplicate").click());
    await settle(q, 300);
    ok((await q.locator("#studio-patterns .studio-pat").count()) === 2 && (await pressed(q, '#studio-patterns [data-pat="B"]')) === "true", "a second pattern brings A and B", await q.locator("#studio-patterns .studio-pat").count());
    await tapStrip(q, "chords");
    ok((await q.locator("#studio-patterns .studio-pat").count()) === 2 && (await pressed(q, '#studio-patterns [data-pat="B"]')) === "true", "and they stay when another track is opened");
    await q.click('#studio-patterns [data-pat="A"]');
    await settle(q, 300);
    ok((await q.evaluate(() => document.querySelector('#song-pattern-buttons [data-pattern="A"]').getAttribute("aria-pressed") === "true")) && (await pressed(q, '#studio-patterns [data-pat="A"]')) === "true", "choosing A opens it in the editor");
    await pctx.close();
  } finally {
    await api("DELETE", "/songs/" + id);
    await api("DELETE", "/songs/" + hiddenId);
    await api("DELETE", "/songs/" + phoneId);
    await adminCtx.close();
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
