// The Song builder's Studio layout: five fixed layers as cards, one expanded card, the roll and keys, transport, and that the classic editor
// is still one click away with the same song underneath.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
(async () => {
  const b = await chromium.launch();
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("songView", "studio"); } catch (e) { /* none */ } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  const api = async (method, path, data) => { const r = await ctx.request.fetch(E2E_BASE + "/api/admin" + path, { method, data, headers: { "content-type": "application/json" } }); let j = null; try { j = await r.json(); } catch (e) { /* none */ } return { s: r.status(), j }; };
  const lane = (str) => Array.from(str, (c) => c === "x");
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const notes = {}; [4, 3].forEach((o) => { for (let i = 11; i >= 0; i--) notes[NAMES[i] + o] = Array(16).fill(false); });
  notes.G4 = lane("x...x...");
  const song = { tempo: 120, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1, tracks: { kick: lane("x...x...x...x..."), snare: lane("....x.......x..."), hihat: lane("x.x.x.x.x.x.x.x."), clap: [] }, trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} }, melody: { waveform: "sine", notes } };
  const created = await api("POST", "/songs", { name: "QQ Studio", data: song });
  const id = created.j.id;
  const vis = (sel) => p.evaluate((q) => { const e = document.querySelector(q); return Boolean(e) && !e.hidden && e.offsetParent !== null; }, sel);
  const text = (sel) => p.textContent(sel);
  const pressed = (sel) => p.getAttribute(sel, "aria-pressed");
  try {
    await p.goto(E2E_BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.locator(`.edit-song[data-id="${id}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(900);

    // ---- layout: five cards, one expanded card, roll, keys, transport
    ok((await p.locator("#studio-cards .studio-card").count()) === 5, "five layer cards");
    const names = await p.evaluate(() => [...document.querySelectorAll("#studio-cards .studio-card-name")].map((x) => x.textContent).join("|"));
    ok(names === "Kick|Snare & clap|Hats & perc|Bass|Melody", "the layers are fixed, in order 1 to 5", names);
    ok(await vis("#song-studio") && !(await vis(".song-builder-body")), "the studio shows and the classic body is out of the way");
    ok(await vis("#studio-detail") && await vis("#studio-roll") && await vis("#studio-keys") && await vis("#studio-play"), "expanded card, roll, keys and play are all there");
    ok((await p.locator("#studio-detail").count()) === 1 && (await p.locator(".studio-detail-head").count()) === 1, "only one expanded card at a time");
    ok((await pressed('#studio-cards [data-layer="melody"]')) === "true" && /Layer 5: Melody/.test(await text("#studio-detail")), "it opens on the melody (layer 5)", await text("#studio-detail"));
    ok(await vis("#song-piano-roll") && !(await vis("#song-sequencer")), "the roll is the piano roll for a melody layer");
    ok((await p.locator("#studio-keys .studio-key-white").count()) === 14 && (await p.locator("#studio-keys .studio-key-black").count()) === 10, "two octaves of keys");
    const cardInfo = await text('#studio-cards [data-card="kick"] .studio-card-meta');
    ok(/4 hits/.test(cardInfo), "a card gives a simple overview (4 kick hits)", cardInfo);

    // ---- selecting layers
    await p.click('#studio-cards [data-layer="kick"]');
    ok((await pressed('#studio-cards [data-layer="kick"]')) === "true" && (await pressed('#studio-cards [data-layer="melody"]')) === "false", "clicking a card selects it and only it");
    ok(/Layer 1: Kick/.test(await text("#studio-detail")) && await vis("#song-sequencer") && !(await vis("#song-piano-roll")), "layer 1 shows the drum grid");
    const rowsShown = await p.evaluate(() => [...document.querySelectorAll("#song-sequencer .song-track-row")].filter((r) => !r.hidden).map((r) => r.querySelector("[data-row]").dataset.row).join());
    ok(rowsShown === "kick", "and only the kick row", rowsShown);
    await p.click('#studio-cards [data-layer="hats"]');
    const hatRows = await p.evaluate(() => [...document.querySelectorAll("#song-sequencer .song-track-row")].filter((r) => !r.hidden).map((r) => r.querySelector("[data-row]").dataset.row).join());
    ok(hatRows === "hihat", "layer 3 shows the hi-hat row", hatRows);
    ok((await p.locator("#studio-add option").count()) === 3, "and offers open hat, tom and crash to add", await p.locator("#studio-add option").count());
    await p.selectOption("#studio-add", "tom");
    await p.click("#studio-add-btn");
    await p.waitForTimeout(150);
    const hatRows2 = await p.evaluate(() => [...document.querySelectorAll("#song-sequencer .song-track-row")].filter((r) => !r.hidden).map((r) => r.querySelector("[data-row]").dataset.row).join());
    ok(hatRows2 === "hihat,tom" && (await p.locator("#studio-add option").count()) === 2, "adding a sound puts it in the layer", hatRows2);

    // ---- editing from the roll and the card
    await p.click('#studio-cards [data-layer="kick"]');
    await p.click('#song-sequencer .song-step[data-row="kick"][data-step="2"]');
    await p.waitForTimeout(150);
    ok(/5 hits/.test(await text('#studio-cards [data-card="kick"] .studio-card-meta')), "a step clicked in the roll updates the card", await text('#studio-cards [data-card="kick"] .studio-card-meta'));
    await p.click("#studio-undo");
    await p.waitForTimeout(150);
    ok(/4 hits/.test(await text('#studio-cards [data-card="kick"] .studio-card-meta')), "undo updates the card too");

    await p.click('#studio-cards [data-layer="bass"]');
    ok(await vis("#song-piano-roll") && /Layer 4: Bass/.test(await text("#studio-detail")), "layer 4 is the bass roll");
    const bassFirst = await p.evaluate(() => document.querySelector("#song-piano-roll .song-steps").dataset.row);
    ok(/2$/.test(bassFirst), "its notes are the low ones", bassFirst);
    await p.selectOption("#studio-voice", "pluck");
    ok((await p.inputValue("#song-bass-voice")) === "pluck", "the sound menu drives the bass sound");
    await p.click('#studio-keys [data-key="C2"]');
    await p.click('#studio-cards [data-layer="melody"]');
    await p.selectOption("#studio-voice", "bell");
    ok((await p.inputValue("#song-voice")) === "bell" && !(await vis("#studio-wave")), "the piano sound menu drives the melody voice (and hides the basic wave)");

    // ---- mute and volume from the card
    await p.click('#studio-cards [data-mute="melody"]');
    ok((await pressed('#studio-cards [data-mute="melody"]')) === "true" && (await pressed("#song-melody-mute")) === "true", "Mute on a card mutes the layer");
    await p.click('#studio-cards [data-mute="melody"]');
    await p.fill("#studio-layer-vol", "40");
    await p.waitForTimeout(100);
    ok((await p.inputValue("#song-melody-volume")) === "40", "the layer volume drives the real one");
    await p.click('#studio-cards [data-mute="snare"]');
    const snareMuted = await p.evaluate(() => ["snare", "clap"].map((r) => { const m = document.querySelector(`.song-track-mute[data-row="${r}"]`); return m.getAttribute("aria-pressed"); }).join());
    ok(snareMuted === "true,true", "muting a drum layer mutes its rows", snareMuted);
    await p.click('#studio-cards [data-mute="snare"]');

    // ---- transport
    await p.click("#studio-metro");
    ok((await pressed("#studio-metro")) === "true" && (await p.isChecked("#song-metronome-on")), "Metronome toggles");
    await p.click("#studio-metro");
    await p.click("#studio-rec");
    ok((await p.isChecked("#song-record")) && (await pressed("#studio-rec")) === "true", "Rec toggles the real record switch");
    await p.click("#studio-rec");
    await p.fill("#studio-bpm", "150");
    ok((await p.inputValue("#song-tempo")) === "150", "BPM drives the tempo");
    await p.fill("#studio-volume", "55");
    ok((await p.inputValue("#song-master-volume")) === "55", "Volume drives the master volume");
    await p.click("#studio-play");
    await p.waitForTimeout(500);
    ok((await p.getAttribute("#studio-play", "aria-label")) === "Pause" && /Stop/.test(await text("#song-play")), "Play starts the song and the button turns to Pause");
    await p.click("#studio-play");
    await p.waitForTimeout(200);
    ok((await p.getAttribute("#studio-play", "aria-label")) === "Play", "and Pause stops it");

    // ---- recording a note from the keys
    await p.click('#studio-cards [data-layer="melody"]');
    await p.click("#studio-rec");
    await p.click("#studio-play");
    await p.waitForTimeout(300);
    await p.dispatchEvent('#studio-keys [data-key="E4"]', "pointerdown", { button: 0 });
    await p.waitForTimeout(100);
    await p.click("#studio-play");
    await p.click("#studio-rec");
    const e4 = await p.evaluate(() => [...document.querySelectorAll('#song-piano-roll .song-steps[data-row="E4"] .song-step-on')].length);
    ok(e4 >= 1, "a key pressed while recording lands in the roll", e4);

    // ---- the classic view, and back
    await p.click("#song-view-toggle");
    ok(!(await vis("#song-studio")) && await vis(".song-builder-body") && await vis("#song-sequencer") && await vis("#song-piano-roll"), "Classic view brings the full editor back with the roll and drums in place");
    ok((await p.inputValue("#song-tempo")) === "150", "with the same song");
    await p.click("#song-view-toggle");
    ok(await vis("#song-studio") && !(await vis(".song-builder-body")), "and Studio view returns");
    const saved = await p.evaluate(() => localStorage.getItem("songView"));
    ok(saved === "studio", "the choice is remembered", saved);

    // ---- keyboard, accessibility, phone
    await p.focus('#studio-cards [data-layer="melody"]');
    await p.keyboard.press("ArrowRight");
    ok((await pressed('#studio-cards [data-layer="kick"]')) === "true", "the arrow keys move between cards (wrapping)");
    await p.addScriptTag({ content: axeSource() });
    for (const theme of ["dark", "light"]) {
      await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await p.waitForTimeout(150);
      const v = await p.evaluate(async () => (await axe.run(document.getElementById("song-studio"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")));
      ok(v.length === 0, `the studio has no accessibility violations (${theme})`, v);
    }
    await p.setViewportSize({ width: 390, height: 800 });
    await p.waitForTimeout(400);
    const spill = await p.evaluate(() => { const d = document.getElementById("song-studio"); return { studio: d.scrollWidth - d.clientWidth, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
    ok(spill.studio <= 1 && spill.doc <= 0, "at 390px nothing spills sideways", spill);
    ok(await vis("#studio-play") && await vis("#studio-keys") && await vis("#studio-roll"), "and the controls, roll and keys are all reachable");
    const keyW = await p.evaluate(() => Math.min(...[...document.querySelectorAll("#studio-keys .studio-key")].map((k) => k.getBoundingClientRect().width)));
    ok(keyW >= 24, "at 390px every key is wide enough to tap (the keyboard scrolls sideways)", keyW);
    ok(errs.length === 0, "no page errors", errs);
  } finally {
    await api("DELETE", "/songs/" + id);
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
