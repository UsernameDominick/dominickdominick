// The extra drum voices (open hat, rim, tom, crash): an old song has only its four rows, the others are added from the menu and removed
// with the ×, every part of the builder that lists rows follows, starter beats bring their own rows, and it all saves, exports and reopens.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const fs = require("fs");
(async () => {
  const b = await chromium.launch();
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  const api = async (method, path, data) => { const r = await ctx.request.fetch(E2E_BASE + "/api/admin" + path, { method, data, headers: { "content-type": "application/json" } }); let j = null; try { j = await r.json(); } catch (e) { /* none */ } return { s: r.status(), j }; };
  const lane = (str) => Array.from(str, (c) => c === "x");
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const notes = {}; [4, 3].forEach((o) => { for (let i = 11; i >= 0; i--) notes[NAMES[i] + o] = Array(16).fill(false); });
  const song = { tempo: 110, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1, tracks: { kick: lane("x...x...x...x..."), snare: lane("....x.......x..."), hihat: lane("x.x.x.x.x.x.x.x."), clap: lane("................") }, trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} }, melody: { waveform: "sine", notes } };
  const created = await api("POST", "/songs", { name: "QQ Drums", data: song });
  const id = created.j.id;
  try {
    await p.goto(E2E_BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.locator(`.edit-song[data-id="${id}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(800);

    const rows = () => p.evaluate(() => [...document.querySelectorAll("#song-sequencer .song-track-row")].map((r) => r.querySelector(".song-track-label").textContent.trim()));
    const addOptions = () => p.evaluate(() => [...document.querySelectorAll("#song-add-drum option")].map((o) => o.value));
    const targets = () => p.evaluate(() => [...document.querySelectorAll("#song-pattern-target option")].map((o) => o.value));
    const hitsOf = (row) => p.evaluate((r) => [...document.querySelectorAll(`#song-sequencer .song-step[data-row="${r}"]`)].map((x, i) => (x.classList.contains("song-step-on") ? i : -1)).filter((i) => i >= 0), row);

    ok((await rows()).join() === "Kick,Snare,Hi-Hat,Clap", "an old song opens with exactly its four rows", await rows());
    ok((await addOptions()).join() === "openhat,rim,tom,crash", "the menu offers the four extra voices", await addOptions());
    ok((await targets()).join() === "all,kick,snare,hihat,clap", "'Apply to' lists the rows the song has", await targets());
    ok(await p.evaluate(() => document.querySelectorAll("#song-sequencer .song-track-remove").length === 0), "the core rows cannot be removed");

    // add a tom
    await p.selectOption("#song-add-drum", "tom");
    await p.click("#song-add-drum-btn");
    ok((await rows()).join() === "Kick,Snare,Hi-Hat,Clap,Tom", "Add row puts the tom after the core rows", await rows());
    ok((await addOptions()).join() === "openhat,rim,crash", "the menu no longer offers it", await addOptions());
    ok((await targets()).join() === "all,kick,snare,hihat,clap,tom", "'Apply to' now lists Tom", await targets());
    ok((await p.evaluate(() => document.activeElement && document.activeElement.dataset.row)) === "tom", "focus lands on the new row's first step");
    ok(/Tom row added/.test(await p.textContent("#song-drum-status")), "and it says so", await p.textContent("#song-drum-status"));
    ok(await p.evaluate(() => document.querySelectorAll('#song-sequencer .song-track-remove[data-row="tom"]').length === 1), "the extra row has a Remove button");

    // it is a real row
    await p.click('#song-sequencer .song-step[data-row="tom"][data-step="2"]');
    await p.click('#song-sequencer .song-step[data-row="tom"][data-step="10"]');
    ok((await hitsOf("tom")).join() === "2,10", "its steps toggle like any other", await hitsOf("tom"));
    await p.click('#song-sequencer .song-track-mute[data-row="tom"]');
    ok(await p.evaluate(() => document.querySelector('#song-sequencer .song-track-mute[data-row="tom"]').getAttribute("aria-pressed") === "true"), "it can be muted");
    await p.click('#song-sequencer .song-track-mute[data-row="tom"]');

    // undo and redo of the add
    for (let i = 0; i < 5; i++) await p.click("#song-undo");
    ok((await rows()).join() === "Kick,Snare,Hi-Hat,Clap" && (await addOptions()).join() === "openhat,rim,tom,crash", "Undo takes the row (and its menu entry) back out", [await rows(), await addOptions()]);
    for (let i = 0; i < 5; i++) await p.click("#song-redo");
    ok((await rows()).join() === "Kick,Snare,Hi-Hat,Clap,Tom" && (await hitsOf("tom")).join() === "2,10", "Redo brings it back with its hits", [await rows(), await hitsOf("tom")]);

    // the pattern tools see it, and leave the others alone when it is the target
    const kickBefore = (await hitsOf("kick")).join();
    await p.selectOption("#song-pattern-target", "tom");
    await p.click("#song-pattern-clear");
    ok((await hitsOf("tom")).length === 0 && (await hitsOf("kick")).join() === kickBefore, "Apply to Tom clears just the tom", [await hitsOf("tom"), await hitsOf("kick")]);
    await p.click("#song-pattern-shift-right");
    await p.selectOption("#song-pattern-target", "all");

    // a starter beat that uses extra voices brings its rows along
    await p.evaluate(() => { document.getElementById("song-generators").open = true; });
    await p.selectOption("#song-starter-beat", "disco");
    await p.click("#song-starter-apply");
    const afterDisco = await rows();
    ok(afterDisco.join() === "Kick,Snare,Hi-Hat,Open Hat,Clap,Tom", "applying Disco to all drums adds the Open Hat row it needs", afterDisco);
    ok((await hitsOf("openhat")).join() === "2,6,10,14" && (await hitsOf("kick")).join() === "0,4,8,12" && (await hitsOf("tom")).length === 0, "and fills it (the tom, which Disco doesn't use, is emptied)", [await hitsOf("openhat"), await hitsOf("tom")]);
    await p.selectOption("#song-starter-beat", "tom-groove");
    await p.click("#song-starter-apply");
    ok((await rows()).join() === "Kick,Snare,Hi-Hat,Open Hat,Clap,Tom,Crash" && (await hitsOf("tom")).join() === "2,5,10,12" && (await hitsOf("crash")).join() === "0", "Tom groove adds the Crash row and fills the tom", [await rows(), await hitsOf("tom"), await hitsOf("crash")]);
    ok((await addOptions()).join() === "rim", "only Rim is left in the menu", await addOptions());
    ok((await hitsOf("openhat")).length === 0, "Tom groove, which has no open hat, emptied that row (a beat replaces every row it is applied to)", await hitsOf("openhat"));
    await p.click('#song-sequencer .song-step[data-row="openhat"][data-step="3"]');
    await p.click('#song-sequencer .song-step[data-row="openhat"][data-step="7"]');

    // save and look at what is stored
    await p.click("#save-song");
    await p.waitForTimeout(1200);
    const saved = (await api("GET", "/songs/" + id)).j;
    ok(["tom", "openhat", "crash"].every((t) => Array.isArray(saved.data.tracks[t]) && saved.data.trackMeta[t]) && !saved.data.tracks.rim, "Save stores the added rows and no others", Object.keys(saved.data.tracks));

    // stems: one per row with hits
    await p.evaluate(() => document.getElementById("song-export-audio").click());
    await p.waitForSelector("#song-audio-modal:not([hidden])");
    await p.check("#song-audio-stems");
    ok(/^6 stems/.test(await p.textContent("#song-audio-summary")), "Export audio's stems count the extra rows (kick, snare, hi-hat, open hat, tom, crash)", await p.textContent("#song-audio-summary"));
    await p.evaluate(() => document.getElementById("close-song-audio").click());
    await p.waitForTimeout(300);

    // MIDI: the extras go out as General MIDI notes
    const [dl] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => document.getElementById("song-export-midi").click())]);
    const bytes = fs.readFileSync(await dl.path());
    const has = (n) => bytes.some((v, i) => v === 0x99 && bytes[i + 1] === n);
    ok(has(46) && has(47) && has(49) && !has(37), "the MIDI file has open hat (46), tom (47) and crash (49) and no rim", [46, 47, 49, 37].map(has));

    // remove: with hits it asks (accepted here), and the row and menu follow
    await p.click('#song-sequencer .song-track-remove[data-row="openhat"]');
    ok((await rows()).join() === "Kick,Snare,Hi-Hat,Clap,Tom,Crash" && (await addOptions()).join() === "openhat,rim", "× removes the Open Hat row and puts it back in the menu", [await rows(), await addOptions()]);
    ok((await p.evaluate(() => document.activeElement && document.activeElement.id)) === "song-add-drum", "focus goes to the menu");
    ok((await targets()).join() === "all,kick,snare,hihat,clap,tom,crash", "'Apply to' drops it", await targets());
    await p.click("#song-undo");
    ok((await rows()).includes("Open Hat") && (await hitsOf("openhat")).join() === "3,7", "Undo restores the row and its hits", [await rows(), await hitsOf("openhat")]);

    // reopen: the rows are still there
    await p.click("#close-song-builder");
    await p.waitForTimeout(500);
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.locator(`.edit-song[data-id="${id}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(700);
    ok((await rows()).join() === "Kick,Snare,Hi-Hat,Open Hat,Clap,Tom,Crash", "reopening the song shows the added rows in order", await rows());
    ok(errs.length === 0, "no script errors along the way", errs);
  } finally {
    await api("DELETE", "/songs/" + id);
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
