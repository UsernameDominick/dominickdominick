// The Song builder's Studio layout, as sketched: a stack of five layer cards on top, then the one open layer, then the play controls and the
// piano keys. Checks the order and the fixed layers, choosing a layer (tap, swipe, arrows, numbers), editing steps and sounds from the card,
// pause and carry on, recording from the keys and pads, undo, the classic editor one click away, and a phone screen with no scrolling.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
(async () => {
  const b = await chromium.launch();
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const lane = (str) => Array.from(str, (c) => c === "x");
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const roll = (hi, lo) => { const n = {}; for (let o = hi; o >= lo; o--) for (let i = 11; i >= 0; i--) n[NAMES[i] + o] = Array(16).fill(false); return n; };
  const notes = roll(4, 3); notes.G4 = lane("x...x...");
  const bass = roll(2, 1); bass.C2 = lane("x.......");
  const song = (extra = {}) => ({ tempo: 240, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1, tracks: { kick: lane("x...x...x...x..."), snare: lane("....x.......x..."), hihat: lane("x.x.x.x.x.x.x.x."), clap: lane("................") }, trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} }, melody: { waveform: "sine", notes }, bass: { notes: bass, ties: {} }, ...extra });
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
  const hiddenId = (await api("POST", "/songs", { name: "QQ Studio hidden", data: song({ trackMeta: { kick: {}, snare: { hidden: true }, hihat: {}, clap: {} }, melody: { waveform: "sine", notes: roll(4, 3), hidden: true } }) })).j.id;

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
  const meta = (p, layer) => p.evaluate((l) => (document.querySelector(`#studio-stack [data-card="${l}"] .studio-card-meta`) || {}).textContent || "", layer);
  const settle = (p, ms = 150) => p.waitForTimeout(ms);

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

    // ---- the layout of the sketch: cards, then the open layer, then controls, then keys
    const names = await p.evaluate(() => [...document.querySelectorAll("#studio-stack .studio-card-name")].map((x) => x.textContent).join("|"));
    ok(names === "Kick|Snare & clap|Hats & perc|Bass|Melody", "five layers, always in the same order", names);
    const tops = await p.evaluate(() => ["studio-stack", "studio-detail", "studio-play", "studio-keys"].map((i) => Math.round(document.getElementById(i).getBoundingClientRect().top)));
    ok(tops[0] < tops[1] && tops[1] < tops[2] && tops[2] < tops[3], "stacked cards, then the open layer, then the play controls, then the keys", tops);
    ok(await vis(p, "#song-studio") && !(await vis(p, ".song-builder-body")) && !(await vis(p, ".song-toolbar")), "the classic header and body stay out of the way");
    ok((await front(p)) === "kick" && /Kick/.test(await text(p, "#studio-detail h2")), "it opens on the first layer that has something in it (Kick)", await front(p));
    ok((await p.locator("#studio-detail h2").count()) === 1 && (await p.locator('#studio-stack [data-pos="front"]').count()) === 1, "only one layer is open at a time");
    ok((await p.locator("#studio-pager .studio-dot").count()) === 5 && (await pressed(p, '#studio-pager [data-pick="kick"]')) === "true", "the numbers 1 to 5 show which is open");
    ok(/4 hits/.test(await meta(p, "kick")) && /2 hits/.test(await meta(p, "snare")), "each card gives a simple overview (kick 4 hits, snare and clap 2)", [await meta(p, "kick"), await meta(p, "snare")]);
    ok((await p.locator('#studio-stack [data-card="kick"] .studio-dots rect').count()) === 4, "and a small picture of its pattern");
    ok(!(await p.isEnabled("#studio-undo")), "nothing to undo on a freshly opened song");

    // ---- choosing a layer: the numbers, the sliver of a card behind, the arrow keys, a swipe
    await p.click('#studio-pager [data-pick="hats"]');
    ok((await front(p)) === "hats" && /Hats & perc/.test(await text(p, "#studio-detail h2")), "tapping a number opens that layer", await front(p));
    await p.waitForTimeout(500);
    const near = await p.evaluate(() => { const r = document.querySelector('#studio-stack [data-card="snare"]').getBoundingClientRect(); const f = document.querySelector('#studio-stack [data-card="hats"] .studio-card-main').getBoundingClientRect(); return { x: (r.left + f.left) / 2, y: r.top + 40 }; });
    await p.mouse.click(near.x, near.y);
    await settle(p);
    ok((await front(p)) === "snare", "tapping the card peeking out behind opens it", await front(p));
    await p.focus('#studio-stack [data-pick="snare"]');
    await p.keyboard.press("ArrowRight");
    await settle(p);
    ok((await front(p)) === "hats", "the arrow keys move through the stack", await front(p));
    await p.keyboard.press("End");
    await settle(p);
    ok((await front(p)) === "melody", "End goes to layer 5", await front(p));
    await p.waitForTimeout(500);
    const box = await p.evaluate(() => { const r = document.getElementById("studio-stack").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.mouse.move(box.x + 120, box.y); await p.mouse.down(); await p.mouse.move(box.x + 60, box.y, { steps: 4 }); await p.mouse.move(box.x - 20, box.y, { steps: 4 }); await p.mouse.up();
    await settle(p);
    ok((await front(p)) === "melody", "swiping towards the end stays on the last layer", await front(p));
    await p.mouse.move(box.x - 120, box.y); await p.mouse.down(); await p.mouse.move(box.x - 60, box.y, { steps: 4 }); await p.mouse.move(box.x + 40, box.y, { steps: 4 }); await p.mouse.up();
    await settle(p);
    ok((await front(p)) === "bass", "swiping the other way brings the layer before it forward", await front(p));
    ok(!(await p.isEnabled("#studio-undo")), "choosing layers is not an edit (nothing to undo, even after opening the bass line)");

    // ---- editing steps from the open layer
    await p.click('#studio-pager [data-pick="kick"]');
    await p.click('#studio-grid .studio-cell[data-row="kick"][data-step="2"]');
    await settle(p);
    ok(/5 hits/.test(await meta(p, "kick")) && (await pressed(p, '#studio-grid .studio-cell[data-row="kick"][data-step="2"]')) === "true", "a tapped step turns on and the card follows (5 hits)", await meta(p, "kick"));
    ok(await p.evaluate(() => document.querySelector('#song-sequencer .song-step[data-row="kick"][data-step="2"]').classList.contains("song-step-on")), "it is the real editor's step that changed");
    ok(await p.isEnabled("#studio-undo"), "and it can be undone");
    await p.click("#studio-undo");
    await settle(p);
    ok(/4 hits/.test(await meta(p, "kick")) && (await pressed(p, '#studio-grid .studio-cell[data-row="kick"][data-step="2"]')) === "false", "Undo takes it back");
    await p.click("#studio-redo");
    await settle(p);
    ok(/5 hits/.test(await meta(p, "kick")), "and Redo brings it back");
    await p.click("#studio-undo");
    await settle(p);

    // ---- the drum layers: rows, adding a sound, mute, volume, sound
    await p.click('#studio-pager [data-pick="hats"]');
    const hatRows = await p.evaluate(() => [...document.querySelectorAll("#studio-grid .studio-row")].map((r) => r.dataset.row).join());
    ok(hatRows === "hihat", "layer 3 shows the hi-hat row", hatRows);
    ok((await p.locator("#studio-add option").count()) === 3, "and offers open hat, tom and crash to add", await p.locator("#studio-add option").count());
    await p.selectOption("#studio-add", "tom");
    await p.click("#studio-add-btn");
    await settle(p);
    const hatRows2 = await p.evaluate(() => [...document.querySelectorAll("#studio-grid .studio-row")].map((r) => r.dataset.row).join());
    ok(hatRows2 === "hihat,tom" && (await p.locator("#studio-add option").count()) === 2 && (await p.locator("#studio-keys .studio-pad").count()) === 2, "adding a sound puts a row and a pad in the layer", hatRows2);
    await p.click('#studio-pager [data-pick="snare"]');
    await p.click("#studio-mute");
    await settle(p);
    const muted = await p.evaluate(() => ["snare", "clap"].map((r) => document.querySelector(`.song-track-mute[data-row="${r}"]`).getAttribute("aria-pressed")).join());
    ok(muted === "true,true" && (await pressed(p, "#studio-mute")) === "true" && /muted/i.test(await p.getAttribute('#studio-stack [data-card="snare"] .studio-card-main', "aria-label")), "Mute silences every sound in the layer", muted);
    await p.click("#studio-mute");
    await settle(p);
    await p.click('#studio-stack [data-card="snare"] .studio-card-mute');
    await settle(p);
    ok((await pressed(p, "#studio-mute")) === "true", "the Mute on the front card does the same");
    await p.click('#studio-stack [data-card="snare"] .studio-card-mute');
    await settle(p);
    await p.selectOption("#studio-kit", "808");
    await settle(p);
    ok((await p.inputValue("#song-kit")) === "808" && /808 kit/.test(await meta(p, "snare")), "the drum kit menu drives the real one and the card shows it");
    await p.selectOption("#studio-kit", "acoustic");
    await settle(p);

    // ---- the bass and the melody: a note roll, sounds, volume, ties
    await p.click('#studio-pager [data-pick="melody"]');
    ok((await p.locator("#studio-grid .studio-row").count()) === 24 && (await text(p, "#studio-grid .studio-row .studio-row-label")) === "B4", "the melody layer is a 24-note roll from B4 down to C3", await p.locator("#studio-grid .studio-row").count());
    ok((await p.locator("#studio-keys .studio-key-white").count()) === 14 && (await p.locator("#studio-keys .studio-key-black").count()) === 10, "with two octaves of keys under it");
    ok(await p.evaluate(() => { const s = document.getElementById("studio-grid-scroll"); const r = document.querySelector('#studio-grid .studio-row[data-row="G4"]').getBoundingClientRect(); const c = s.getBoundingClientRect(); return r.top >= c.top - 1 && r.bottom <= c.bottom + 1; }), "the roll opens scrolled to where the notes are");
    await p.selectOption("#studio-voice", "bell");
    await settle(p);
    ok((await p.inputValue("#song-voice")) === "bell" && !(await vis(p, "#studio-wave")) && /Bell/.test(await meta(p, "melody")), "the piano sound drives the melody voice, hides the basic wave and shows on the card");
    await p.fill("#studio-layer-vol", "40");
    await settle(p);
    ok((await p.inputValue("#song-melody-volume")) === "40", "the volume slider drives the real one");
    await p.click('#studio-grid .studio-cell[data-row="C4"][data-step="1"]');
    await p.click('#studio-grid .studio-cell[data-row="C4"][data-step="2"]');
    await settle(p);
    const cell2 = await p.locator('#studio-grid .studio-cell[data-row="C4"][data-step="2"]').boundingBox();
    await p.mouse.move(cell2.x + cell2.width / 2, cell2.y + cell2.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(700);
    await p.mouse.up();
    await settle(p);
    ok((await p.evaluate(() => document.querySelector('#song-piano-roll .song-step[data-row="C4"][data-step="2"]').classList.contains("song-step-tied"))) && (await p.evaluate(() => document.querySelector('#studio-grid .studio-cell[data-row="C4"][data-step="2"]').classList.contains("tied"))), "holding a note ties it to the one before");
    ok(/4 notes/.test(await meta(p, "melody")), "the melody card counts notes (2 + 2)", await meta(p, "melody"));
    await p.click("#studio-clear");
    await settle(p);
    ok(/0 notes/.test(await meta(p, "melody")), "Clear layer empties the layer");
    await p.click("#studio-undo");
    await settle(p);
    ok(/4 notes/.test(await meta(p, "melody")), "and it is undoable");
    await p.click('#studio-pager [data-pick="bass"]');
    ok((await p.locator("#studio-grid .studio-row").count()) === 24 && (await text(p, "#studio-grid .studio-row .studio-row-label")) === "B2" && (await p.locator("#studio-keys .studio-key-white").count()) === 14, "the bass layer is its own lower roll, C1 to B2, with its own keys");
    await p.selectOption("#studio-voice", "pluck");
    await settle(p);
    ok((await p.inputValue("#song-bass-voice")) === "pluck", "the bass sound drives the bass voice");

    // ---- play, pause, carry on, stop
    await p.click('#studio-pager [data-pick="kick"]');
    ok((await p.getAttribute("#studio-play", "aria-label")) === "Play" && !(await p.isEnabled("#studio-stop")), "Play, and Stop is off while nothing plays");
    await p.click("#studio-play");
    await p.waitForTimeout(900);
    ok((await p.getAttribute("#studio-play", "aria-label")) === "Pause" && (await p.isEnabled("#studio-stop")) && /Stop/.test(await text(p, "#song-play")), "Play starts the song and the button becomes Pause");
    ok((await p.evaluate(() => document.querySelectorAll("#studio-grid .studio-cell.now").length)) >= 1, "a column of the steps lights up with the music");
    ok(await p.evaluate(() => getComputedStyle(document.querySelector(".studio-ico-pause")).display !== "none" && getComputedStyle(document.querySelector(".studio-ico-play")).display === "none"), "and the button shows the pause symbol, not the play one");
    await p.click("#studio-play");
    await settle(p, 250);
    const paused = await p.evaluate(() => { const s = window.__steps || []; return { last: s[s.length - 1].step, n: s.length }; });
    ok(await p.evaluate(() => getComputedStyle(document.querySelector(".studio-ico-play")).display !== "none" && getComputedStyle(document.querySelector(".studio-ico-pause")).display === "none"), "paused, it shows the play symbol again");
    ok((await p.getAttribute("#studio-play", "aria-label")) === "Carry on" && (await p.isEnabled("#studio-stop")) && (await p.evaluate(() => document.querySelectorAll("#studio-grid .studio-cell.now").length)) === 0, "Pause stops the sound and the lights, and the button now says Carry on", await p.getAttribute("#studio-play", "aria-label"));
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
    await p.click('#studio-pager [data-pick="snare"]');
    await p.click("#studio-rec");
    ok((await p.isChecked("#song-record")) && (await pressed(p, "#studio-rec")) === "true", "Rec switches the real record on");
    await p.click("#studio-play");
    await p.waitForTimeout(350);
    await p.dispatchEvent('#studio-keys [data-pad="clap"]', "pointerdown", { button: 0, pointerType: "mouse" });
    await p.waitForTimeout(150);
    await p.click("#studio-stop");
    await settle(p);
    ok(/3 hits/.test(await meta(p, "snare")), "a pad pressed while it plays records a hit on the step that was playing (clap added to the 2 hits)", await meta(p, "snare"));
    await p.click("#studio-undo");
    await settle(p);
    ok(/2 hits/.test(await meta(p, "snare")), "and the recorded hit is one undo step");
    await p.click('#studio-pager [data-pick="melody"]');
    await p.click("#studio-play");
    await p.waitForTimeout(350);
    await p.dispatchEvent('#studio-keys [data-key="E4"]', "pointerdown", { button: 0, pointerType: "mouse" });
    await p.waitForTimeout(100);
    ok(await p.evaluate(() => document.querySelector('#studio-keys [data-key="E4"]').classList.contains("down")), "the key moves when it is pressed");
    await p.click("#studio-stop");
    await settle(p);
    ok((await p.evaluate(() => document.querySelectorAll('#studio-grid .studio-cell[data-row="E4"].on').length)) >= 1, "a key pressed while it plays records a note on the step that was playing");
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

    // ---- the top bar: name, save
    await p.fill("#studio-name", "QQ Studio renamed");
    ok((await p.inputValue("#song-name")) === "QQ Studio renamed", "the name field is the song's name");
    await p.click("#studio-save");
    await p.waitForTimeout(900);
    ok((await api("GET", "/songs/" + id)).j.name === "QQ Studio renamed" || ((await api("GET", "/songs/" + id)).j.song || {}).name === "QQ Studio renamed", "Save saves the song");

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
      await p.waitForTimeout(250);
      const v = await p.evaluate(async () => (await axe.run(document.getElementById("song-studio"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")));
      ok(v.length === 0, `the studio has no accessibility violations (${theme}, one layer)`, v);
      await p.click('#studio-pager [data-pick="snare"]');
      await p.waitForTimeout(250);
      const v2 = await p.evaluate(async () => (await axe.run(document.getElementById("song-studio"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")));
      ok(v2.length === 0, `and none on a drum layer (${theme})`, v2);
      await p.click('#studio-pager [data-pick="melody"]');
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
    await open(m, id);
    const fit = async () => m.evaluate(() => { const st = document.getElementById("song-studio"); const parts = ["studio-stack", "studio-pager", "studio-detail", "studio-play", "studio-keys-scroll"].map((i) => document.getElementById(i).getBoundingClientRect()); return { scroll: st.scrollHeight - st.clientHeight, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, bottom: Math.max(...parts.map((r) => r.bottom)), top: Math.min(...parts.map((r) => r.top)), h: innerHeight, side: Math.max(...parts.map((r) => r.right)) - innerWidth }; });
    for (const layer of ["kick", "snare", "hats", "bass", "melody"]) {
      await m.tap(`#studio-pager [data-pick="${layer}"]`);
      await m.waitForTimeout(250);
      const f = await fit();
      ok(f.scroll <= 1 && f.bottom <= f.h + 1 && f.top >= 0 && f.doc <= 0 && f.side <= 1, `on a phone every part fits one screen without scrolling (${layer})`, f);
    }
    ok(await m.evaluate(() => document.getElementById("studio-detail").getBoundingClientRect().height >= 280), "and the open layer keeps room to work in");
    await m.tap('#studio-pager [data-pick="kick"]');
    await m.tap('#studio-grid .studio-cell[data-row="kick"][data-step="3"]');
    await m.waitForTimeout(200);
    ok(/5 hits/.test(await meta(m, "kick")), "a finger tap places a step");
    await m.tap("#studio-undo");
    ok(await m.evaluate(() => { const r = document.querySelector('#studio-grid .studio-row[data-row="kick"]'); const cells = [...r.querySelectorAll(".studio-cell")].map((c) => c.getBoundingClientRect()); return cells.length === 16 && new Set(cells.map((c) => Math.round(c.top))).size === 2 && Math.min(...cells.map((c) => c.width)) >= 24; }), "on a phone the drum steps wrap to two lines of eight, each a finger-sized target");
    await m.tap('#studio-pager [data-pick="melody"]');
    await m.waitForTimeout(250);
    ok(await m.evaluate(() => { const s = document.getElementById("studio-grid-scroll"); const c = document.querySelector('#studio-grid .studio-cell[data-row="G4"]').getBoundingClientRect(); return s.scrollWidth > s.clientWidth + 20 && c.width >= 24 && c.height >= 24; }), "the note roll keeps finger-sized cells and scrolls sideways");
    await m.evaluate(() => { document.getElementById("studio-grid-scroll").scrollTo({ left: 200 }); });
    await m.waitForTimeout(150);
    ok(await m.evaluate(() => { const s = document.getElementById("studio-grid-scroll").getBoundingClientRect(); const l = document.querySelector('#studio-grid .studio-row[data-row="G4"] .studio-row-label').getBoundingClientRect(); return document.getElementById("studio-grid-scroll").scrollLeft > 100 && l.left >= s.left - 1 && l.left < s.left + 20; }), "with the note names staying in view as it scrolls");
    await m.evaluate(() => { document.getElementById("studio-grid-scroll").scrollTo({ left: 0 }); });
    const keyW = await m.evaluate(() => Math.min(...[...document.querySelectorAll("#studio-keys .studio-key")].map((k) => k.getBoundingClientRect().width)));
    ok(keyW >= 24, "every key is wide enough to hit (the keyboard scrolls sideways)", keyW);
    ok(await m.evaluate(() => { const s = document.getElementById("studio-keys-scroll"); return s.scrollWidth > s.clientWidth + 20; }), "the keyboard is wider than the screen and scrolls");
    const before = await m.evaluate(() => document.getElementById("studio-keys-scroll").scrollLeft);
    await m.evaluate((b0) => document.getElementById("studio-keys-scroll").scrollTo({ left: b0 + 120 }), before);
    await m.waitForTimeout(100);
    ok(await m.evaluate((b0) => document.getElementById("studio-keys-scroll").scrollLeft > b0, before), "it scrolls along");
    const tiny = await m.evaluate(() => [...document.querySelectorAll("#song-studio button, #song-studio select, #song-studio input")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24) ; }).map((e) => (e.id || e.className) + " " + Math.round(e.getBoundingClientRect().width) + "x" + Math.round(e.getBoundingClientRect().height)).slice(0, 8));
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
    await h.click('#studio-pager [data-pick="snare"]');
    await h.click('#studio-grid .studio-cell[data-row="snare"][data-step="3"]');
    await settle(h);
    ok(/hit/.test(await meta(h, "snare")) && !/^0 hits/.test(await meta(h, "snare")), "a drum row hidden in the classic editor can still be edited here", await meta(h, "snare"));
    await h.click('#studio-pager [data-pick="melody"]');
    await h.click('#studio-grid .studio-cell[data-row="C4"][data-step="3"]');
    await settle(h);
    ok(/^1 note/.test(await meta(h, "melody")), "and so can a hidden melody roll", await meta(h, "melody"));
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
    await q.click('#studio-patterns [data-pat="A"]');
    await settle(q, 300);
    ok((await q.evaluate(() => document.querySelector('#song-pattern-buttons [data-pattern="A"]').getAttribute("aria-pressed") === "true")) && (await pressed(q, '#studio-patterns [data-pat="A"]')) === "true", "choosing A opens it in the editor");
    await pctx.close();
  } finally {
    await api("DELETE", "/songs/" + id);
    await api("DELETE", "/songs/" + hiddenId);
    await adminCtx.close();
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
