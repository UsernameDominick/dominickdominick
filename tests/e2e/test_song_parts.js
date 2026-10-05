// The chords and the lead in the song builder (the full editor): the Melody / Bass / Chords / Lead switch above the piano roll, a roll of
// each part's own (C3 to B4 and C4 to B5), its sound, volume and mute, patterns and the copy tool, undo, saving and reopening, an old song
// left untouched, the MIDI file, the stems, recording from the computer keyboard, the public player, and accessibility.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const fs = require("node:fs");
const { chromium, axeSource } = require("./_pw.cjs");
(async () => {
  const b = await chromium.launch();
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  const api = async (method, path, data) => { const r = await ctx.request.fetch(E2E_BASE + "/api/admin" + path, { method, data, headers: { "content-type": "application/json" } }); let j = null; try { j = await r.json(); } catch (e) { /* none */ } return { s: r.status(), j }; };
  const lane = (str) => Array.from(str, (c) => c === "x");
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const notes = {}; [4, 3].forEach((o) => { for (let i = 11; i >= 0; i--) notes[NAMES[i] + o] = Array(16).fill(false); });
  notes.G4 = lane("x...............");
  const old = { tempo: 240, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1, tracks: { kick: lane("x...x...x...x..."), snare: [], hihat: [], clap: [] }, trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} }, melody: { waveform: "sine", notes } };
  const made = await api("POST", "/songs", { name: "QQ Parts", data: old });
  const id = made.j.id;
  const ids = [id];
  const rows = () => p.evaluate(() => [...document.querySelectorAll("#song-piano-roll .song-steps")].map((r) => r.dataset.row));
  const on = () => p.evaluate(() => { const out = {}; document.querySelectorAll("#song-piano-roll .song-steps").forEach((row) => { const s = [...row.children].map((x, i) => (x.classList.contains("song-step-on") ? i : -1)).filter((i) => i >= 0); if (s.length) out[row.dataset.row] = s.join(","); }); return Object.entries(out).sort().map(([n, s]) => `${n}:${s}`).join(" "); });
  const cell = (note, step) => p.click(`#song-piano-roll .song-step[data-row="${note}"][data-step="${step}"]`);
  const title = () => p.textContent("#song-roll-title");
  const saved = async () => (await api("GET", "/songs/" + id)).j.data;
  const hidden = (sel) => p.evaluate((q) => document.querySelector(q).hidden, sel);
  const openIt = async (songId = id) => {
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.locator(`.edit-song[data-id="${songId}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(800);
    await p.evaluate(() => { document.getElementById("song-melody-tools").open = true; });
  };
  let projectId = null;
  try {
    await p.goto(E2E_BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await openIt();

    // ---- the switch: four parts, each with a roll of its own
    const states = () => p.evaluate(() => ["melody", "bass", "chords", "lead"].map((k) => document.getElementById("song-roll-" + k).getAttribute("aria-pressed")).join());
    ok((await states()) === "true,false,false,false" && (await title()) === "Melody (piano roll)", "a song opens on its melody, with the Melody button pressed");
    await p.click("#song-roll-chords");
    ok((await states()) === "false,false,true,false" && (await title()) === "Chords (piano roll, C3 to B4)", "Chords shows the chords roll", await title());
    const chordRows = await rows();
    ok(chordRows.length === 24 && chordRows[0] === "B4" && chordRows[23] === "C3" && (await on()) === "", "an empty roll, B4 down to C3", [chordRows[0], chordRows[23], await on()]);
    ok(!(await hidden("#song-part-voice")) && (await p.inputValue("#song-part-voice")) === "pad" && (await hidden("#song-bass-voice")) && (await hidden("#song-bass-follow")), "its sound menu appears, on Pad; the bass menu and Follow the kick do not");
    ok((await p.textContent("#song-melody-clear")) === "Clear chords" && /Chords tools/.test(await p.textContent("#song-melody-tools-summary")) && (await p.getAttribute("#song-melody-mute", "aria-label")) === "Mute chords" && (await p.getAttribute("#song-melody-volume", "aria-label")) === "Chords volume", "the tool, mute and volume labels name the part");
    ok(await p.evaluate(() => document.getElementById("song-undo").disabled), "switching the part is not an undo step");
    ok((await p.inputValue("#song-chord-root")) === "C3", "the chord root menu starts on C3");
    await p.click("#song-roll-lead");
    const leadRows = await rows();
    ok((await title()) === "Lead (piano roll, C4 to B5)" && leadRows[0] === "B5" && leadRows[23] === "C4" && (await p.inputValue("#song-part-voice")) === "lead" && (await p.inputValue("#song-chord-root")) === "C5", "Lead is its own higher roll, C4 to B5, with the Lead sound", [await title(), leadRows[0], leadRows[23]]);

    // ---- drawing a chord progression and a lead line
    await p.click("#song-roll-chords");
    await cell("C3", 0); await cell("E3", 0); await cell("G3", 0); await cell("F3", 8); await cell("A3", 8); await cell("C4", 8);
    ok((await on()) === "A3:8 C3:0 C4:8 E3:0 F3:8 G3:0", "clicking steps builds chords", await on());
    await p.click("#song-roll-melody");
    ok((await on()) === "G4:0", "the melody is exactly as it was");
    await p.click("#song-roll-lead");
    await cell("E5", 4); await cell("G5", 6); await cell("C5", 12);
    ok((await on()) === "C5:12 E5:4 G5:6", "the lead is drawn on its own roll", await on());
    await p.click('#song-piano-roll .song-step[data-row="G5"][data-step="6"]', { modifiers: ["Shift"] });
    // (a tie needs the same note on the step before)
    await cell("G5", 5);
    await p.click('#song-piano-roll .song-step[data-row="G5"][data-step="6"]', { modifiers: ["Shift"] });
    ok((await p.evaluate(() => [...document.querySelectorAll("#song-piano-roll .song-step-tied")].map((x) => x.dataset.row + x.dataset.step).join())) === "G56", "Shift+click ties two lead steps", await on());

    // ---- tools act on the part shown
    await p.click("#song-melody-shift-right");
    ok((await on()) === "C5:13 E5:5 G5:6,7", "Shift moves the lead one step and leaves the others alone", await on());
    await p.click("#song-melody-shift-left");
    await p.click("#song-roll-chords");
    ok((await on()) === "A3:8 C3:0 C4:8 E3:0 F3:8 G3:0", "the chords did not move");
    await p.click("#song-melody-clear");
    ok((await on()) === "" && /chords cleared/i.test(await p.textContent("#song-melody-tools-note")), "Clear chords empties them and says so", await p.textContent("#song-melody-tools-note"));
    await p.click("#song-undo");
    ok((await on()) === "A3:8 C3:0 C4:8 E3:0 F3:8 G3:0", "and undo brings them back", await on());
    await p.click("#song-melody-clear");
    await p.selectOption("#song-prog-type", { index: 0 });
    await p.selectOption("#song-prog-key", "C");
    await p.click("#song-prog-stamp");
    const prog = await on();
    ok(prog.split(" ").filter(Boolean).length >= 9 && /C3:0/.test(prog) && !/[12]:\d/.test(prog), "Stamp progression puts whole chords (three or more notes each) on the chords roll", prog);
    ok((await p.textContent("#song-prog-stamp")) === "Stamp progression", "and the button says progression, not roots");
    await p.click("#song-undo");
    await p.click("#song-undo");
    ok((await on()) === "A3:8 C3:0 C4:8 E3:0 F3:8 G3:0", "undoing twice returns to the drawn chords", await on());

    // ---- sound, volume, mute, hide
    await p.selectOption("#song-part-voice", "bell");
    await p.fill("#song-melody-volume", "60");
    await p.dispatchEvent("#song-melody-volume", "input");
    await p.click("#song-roll-lead");
    ok((await p.inputValue("#song-part-voice")) === "lead" && (await p.inputValue("#song-melody-volume")) === "100", "the lead's sound and volume are its own");
    await p.selectOption("#song-part-voice", "pluck");
    await p.click("#song-roll-chords");
    ok((await p.inputValue("#song-part-voice")) === "bell" && (await p.inputValue("#song-melody-volume")) === "60", "and the chords' come back");
    await p.click("#song-melody-hide");
    ok(/Chords hidden, still plays/.test(await p.textContent("#song-piano-roll")), "hiding the chords roll collapses it and says it still plays");
    await p.click("#song-piano-roll .song-melody-show");
    await p.click("#song-melody-mute");
    ok((await p.getAttribute("#song-melody-mute", "aria-pressed")) === "true", "mute works");
    await p.click("#song-roll-lead");
    ok((await p.getAttribute("#song-melody-mute", "aria-pressed")) === "false", "…and only on the chords");
    await p.click("#song-roll-chords");
    await p.click("#song-melody-mute"); // unmute

    // ---- save and look at what is stored
    await p.click("#save-song");
    await p.waitForTimeout(1300);
    let data = await saved();
    ok(data.chords && data.chords.voice === "bell" && data.chords.volume === 0.6 && !data.chords.muted && data.chords.notes.C3[0] === true && data.chords.notes.F3[8] === true && Object.keys(data.chords.notes).length === 24, "Save stores the chords with their sound, volume and notes", data.chords && { voice: data.chords.voice, volume: data.chords.volume });
    ok(data.lead && data.lead.voice === "pluck" && data.lead.volume === undefined && data.lead.notes.E5[4] === true && data.lead.ties && data.lead.ties.G5 && data.lead.ties.G5[6] === true && Object.keys(data.lead.notes).length === 24, "and the lead with its sound, notes and held note (a volume left at full is not stored)", data.lead && Object.keys(data.lead));
    ok(!("bass" in data) && data.melody.notes.G4[0] === true, "no bass line was invented, and the melody is as it was", Object.keys(data));

    // ---- reopen
    await p.click("#close-song-builder"); await p.waitForTimeout(500);
    await openIt();
    ok((await title()) === "Melody (piano roll)", "reopening starts on the melody again");
    await p.click("#song-roll-chords");
    ok((await on()) === "A3:8 C3:0 C4:8 E3:0 F3:8 G3:0" && (await p.inputValue("#song-part-voice")) === "bell" && (await p.inputValue("#song-melody-volume")) === "60", "the chords, their sound and volume are all back");
    await p.click("#song-roll-lead");
    ok((await on()) === "C5:12 E5:4 G5:5,6" && (await p.inputValue("#song-part-voice")) === "pluck", "and the lead", await on());

    // ---- patterns: each has its own chords and lead
    await p.click("#song-roll-chords");
    await p.click("#song-pattern-duplicate");
    ok((await on()) === "A3:8 C3:0 C4:8 E3:0 F3:8 G3:0", "Duplicate copies the chords into the new pattern (B)", await on());
    await cell("C3", 0); await cell("D3", 0);
    ok((await on()) === "A3:8 C4:8 D3:0 E3:0 F3:8 G3:0", "B's chords are edited on their own", await on());
    ok(/chord note/.test((await p.getAttribute('#song-pattern-buttons [data-pattern="B"]', "title")) || "") && /lead note/.test((await p.getAttribute('#song-pattern-buttons [data-pattern="B"]', "title")) || ""), "the pattern button's title counts its chord and lead notes", await p.getAttribute('#song-pattern-buttons [data-pattern="B"]', "title"));
    await p.click('#song-pattern-buttons [data-pattern="A"]');
    ok((await on()) === "A3:8 C3:0 C4:8 E3:0 F3:8 G3:0", "A's chords are exactly as they were", await on());
    // the copy tool takes the chords from B on their own
    await p.click("#song-melody-clear");
    ok((await on()) === "", "A's chords cleared");
    await p.evaluate(() => { document.getElementById("song-copy-tools").hidden = false; });
    await p.selectOption("#song-copy-what", "chords");
    await p.selectOption("#song-copy-from", "B");
    await p.click("#song-copy-apply");
    ok((await on()) === "A3:8 C4:8 D3:0 E3:0 F3:8 G3:0" && /chords/.test(await p.textContent("#song-arrangement-note")), "Copy into this pattern can take just the chords from B", [await on(), await p.textContent("#song-arrangement-note")]);
    await p.click("#song-roll-lead");
    ok((await on()) === "C5:12 E5:4 G5:5,6", "and leaves A's lead alone", await on());
    await p.click('#song-pattern-buttons [data-pattern="B"]');
    await p.click("#song-pattern-remove");

    // ---- recording from the computer keyboard: the lead's two rows of keys play its two octaves
    await p.click('#song-pattern-buttons [data-pattern="A"]');
    await p.click("#song-melody-clear");
    await p.check("#song-record");
    await p.click("#song-play");
    await p.waitForTimeout(300);
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await p.keyboard.press("z");
    await p.waitForTimeout(150);
    await p.keyboard.press("q");
    await p.waitForTimeout(150);
    await p.click("#song-play");
    await p.uncheck("#song-record");
    const recorded = await on();
    ok(/C4:\d+/.test(recorded) && /C5:\d+/.test(recorded), "on the lead the keyboard's lower row records C4 and its upper row C5", recorded);
    for (let i = 0; i < 3; i++) await p.click("#song-undo"); // the two recorded notes and the clear before them
    ok((await on()) === "C5:12 E5:4 G5:5,6", "and each recorded note is an undo step", await on());

    // ---- exports: MIDI, report, stems
    await p.click("#song-roll-chords");
    const [dl] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => document.getElementById("song-export-midi").click())]);
    const bytes = Array.from(fs.readFileSync(await dl.path()));
    const parsed = await p.evaluate((b2) => window.SongFiles.parseMidi(new Uint8Array(b2)), bytes);
    const chordsTrack = parsed.tracks.find((t) => t.name === "Chords");
    const leadTrack = parsed.tracks.find((t) => t.name === "Lead");
    ok(chordsTrack && chordsTrack.notes.every((n) => n.channel === 2) && chordsTrack.notes.some((n) => n.note === 50) && leadTrack && leadTrack.notes.every((n) => n.channel === 3) && leadTrack.notes.some((n) => n.note === 76), "the MIDI file has a Chords track on channel 3 and a Lead track on channel 4", [chordsTrack && chordsTrack.notes.length, leadTrack && leadTrack.notes.length]);
    const [rep] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => document.getElementById("song-export-report").click())]);
    const report = fs.readFileSync(await rep.path(), "utf8");
    ok(/Chords sound: Bell/.test(report) && /Chords notes used:/.test(report) && /Lead sound: Pluck/.test(report) && /Lead notes used:/.test(report), "the report names both sounds and counts their notes", report.split("\n").filter((l) => /Chords|Lead/.test(l)));
    await p.evaluate(() => document.getElementById("song-export-audio").click());
    await p.waitForSelector("#song-audio-modal:not([hidden])");
    await p.check("#song-audio-stems");
    const stemText = await p.textContent("#song-audio-summary");
    ok(/^4 stems/.test(stemText), "Export audio's stems count each part (kick, melody, chords, lead)", stemText);
    await p.evaluate(() => document.getElementById("close-song-audio").click());
    await p.waitForTimeout(300);

    // ---- the public player plays them
    await p.click("#save-song");
    await p.waitForTimeout(1300);
    const slug = "qq-parts-" + Date.now();
    const proj = await api("POST", "/projects", { slug, title: "QQ parts project", summary: "s", body: "A synthetic QQ body that is comfortably longer than fifty characters in total, for publishing.", published: true, related_songs: [id] });
    projectId = proj.j && proj.j.id;
    const html = await (await fetch(E2E_BASE + "/projects/" + slug)).text();
    const dataSong = (html.match(/data-song="([^"]*)"/) || [])[1] || "";
    ok(/&quot;chords&quot;:\{/.test(dataSong) && /&quot;lead&quot;:\{/.test(dataSong), "the public embed is given the chords and the lead");
    const pubCtx = await b.newContext({ viewport: { width: 1200, height: 900 } });
    const pub = await pubCtx.newPage();
    const pubErrs = [];
    pub.on("pageerror", (e) => pubErrs.push(String(e)));
    await pub.addInitScript(() => {
      window.__oscs = [];
      const wrap = (Ctx) => { if (!Ctx) return; const orig = Ctx.prototype.createOscillator; Ctx.prototype.createOscillator = function () { const o = orig.apply(this, arguments); window.__oscs.push(o); return o; }; };
      wrap(window.AudioContext); wrap(window.webkitAudioContext);
    });
    await pub.goto(E2E_BASE + "/projects/" + slug, { waitUntil: "networkidle" });
    await pub.click(".song-embed-play-btn");
    await pub.waitForTimeout(1800);
    await pub.click(".song-embed-play-btn");
    const freqs = await pub.evaluate(() => window.__oscs.map((o) => Math.round(o.frequency.value * 10) / 10));
    const near = (hz) => freqs.some((f) => Math.abs(f - hz) < hz * 0.02 + 0.3);
    ok(near(146.8) && near(164.8), "the public player sounds the chords (D3 = 146.8 Hz and E3 = 164.8 Hz)", [...new Set(freqs)].sort((a, b) => a - b).slice(0, 24));
    ok(near(659.3) && near(523.3), "and the lead (E5 = 659.3 Hz and C5 = 523.3 Hz)", [...new Set(freqs)].sort((a, b) => a - b).slice(0, 40));
    ok(pubErrs.length === 0, "no errors on the public page", pubErrs);
    await pubCtx.close();

    // ---- accessibility, and a phone
    await p.addScriptTag({ content: axeSource() });
    for (const theme of ["dark", "light"]) {
      await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await p.waitForTimeout(300);
      const v = await p.evaluate(async () => (await axe.run(document.getElementById("song-builder-modal"), { runOnly: ["label", "select-name", "button-name", "color-contrast", "aria-valid-attr-value", "aria-allowed-attr"], resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")));
      ok(v.length === 0, `${theme} theme (chords roll shown): no accessibility findings in the builder`, v);
    }
    await p.evaluate(() => document.documentElement.removeAttribute("data-theme"));
    await p.setViewportSize({ width: 390, height: 900 });
    await p.waitForTimeout(400);
    const phone = await p.evaluate(() => {
      const sel = document.getElementById("song-part-voice").getBoundingClientRect();
      const lead = document.getElementById("song-roll-lead").getBoundingClientRect();
      return { spill: document.documentElement.scrollWidth - document.documentElement.clientWidth, leadH: Math.round(lead.height), selH: Math.round(sel.height), selRight: Math.round(sel.right) };
    });
    ok(phone.spill <= 0 && phone.leadH >= 24 && phone.selH >= 24 && phone.selRight <= 392, "on a 390px phone the part switch and the sound menu fit and are touch-sized", phone);
    ok(errs.length === 0, "no errors in the builder", errs);

    // ---- an old song that only looks at the new tabs is saved exactly as it was
    await p.setViewportSize({ width: 1440, height: 1100 });
    await p.click("#close-song-builder"); await p.waitForTimeout(500);
    const plain = await api("POST", "/songs", { name: "QQ Plain parts", data: old });
    ids.push(plain.j.id);
    await openIt(plain.j.id);
    await p.click("#song-roll-chords");
    await p.click("#song-roll-lead");
    await p.click("#song-roll-melody");
    await p.fill("#song-tempo", "111");
    await p.click("#save-song");
    await p.waitForTimeout(1300);
    const plainSaved = (await api("GET", "/songs/" + plain.j.id)).j.data;
    ok(plainSaved.tempo === 111 && !("chords" in plainSaved) && !("lead" in plainSaved) && !("bass" in plainSaved), "saving after only opening the Chords and Lead tabs stores neither", Object.keys(plainSaved));
    await p.click("#song-roll-lead");
    await cell("C5", 0);
    await cell("C5", 0);
    await p.click("#save-song");
    await p.waitForTimeout(1300);
    ok(!("lead" in (await api("GET", "/songs/" + plain.j.id)).j.data), "a lead note added and then removed leaves no lead behind");
  } finally {
    if (projectId) await api("DELETE", "/projects/" + projectId);
    for (const sid of ids) await api("DELETE", "/songs/" + sid);
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
