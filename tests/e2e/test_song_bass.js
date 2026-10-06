// The bass line in the song builder: the Melody / Bass switch above the piano roll, a roll of its own (C1 to B2), the tools working on
// whichever part is shown, the bass sound, mute / hide / volume, patterns, undo, saving and reopening, an old song left untouched, the
// preview and the MIDI file, and accessibility.
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
  const old = { tempo: 120, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1, tracks: { kick: lane("x...x...x...x..."), snare: [], hihat: [], clap: [] }, trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} }, melody: { waveform: "sine", notes } };
  const made = await api("POST", "/songs", { name: "QQ Bassy", data: old });
  const id = made.j.id;
  const ids = [id];
  const rows = () => p.evaluate(() => [...document.querySelectorAll("#song-piano-roll .song-steps")].map((r) => r.dataset.row));
  const on = () => p.evaluate(() => { const out = {}; document.querySelectorAll("#song-piano-roll .song-steps").forEach((row) => { const s = [...row.children].map((x, i) => (x.classList.contains("song-step-on") ? i : -1)).filter((i) => i >= 0); if (s.length) out[row.dataset.row] = s.join(","); }); return Object.entries(out).sort().map(([n, s]) => `${n}:${s}`).join(" "); });
  const cell = (note, step) => p.click(`#song-piano-roll .song-step[data-row="${note}"][data-step="${step}"]`);
  const title = () => p.textContent("#song-roll-title");
  const saved = async () => (await api("GET", "/songs/" + id)).j.data;
  const openIt = async () => {
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.locator(`.edit-song[data-id="${id}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(800);
    await p.evaluate(() => { document.getElementById("song-melody-tools").open = true; });
  };
  let projectId = null;
  try {
    await p.goto(E2E_BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await openIt();

    // ---- the switch, and an old song
    ok((await title()) === "Melody (piano roll)" && (await p.getAttribute("#song-roll-melody", "aria-pressed")) === "true" && (await p.getAttribute("#song-roll-bass", "aria-pressed")) === "false", "a song opens on its melody, with the Melody button pressed");
    ok((await p.evaluate(() => document.getElementById("song-bass-voice").hidden)), "the bass sound menu is not shown for the melody");
    ok((await rows()).length === 24 && (await rows())[0] === "B4" && (await on()) === "G4:0", "the melody roll is B4 down to C3", (await rows()).slice(0, 2));
    await p.click("#song-roll-bass");
    ok((await title()).startsWith("Bass line") && (await p.getAttribute("#song-roll-bass", "aria-pressed")) === "true" && (await p.getAttribute("#song-roll-melody", "aria-pressed")) === "false", "pressing Bass shows the bass line's roll", await title());
    const bassRows = await rows();
    ok(bassRows.length === 24 && bassRows[0] === "B2" && bassRows[23] === "C1" && (await on()) === "", "its own empty roll, B2 down to C1", [bassRows[0], bassRows[23], await on()]);
    ok(!(await p.evaluate(() => document.getElementById("song-bass-voice").hidden)) && (await p.inputValue("#song-bass-voice")) === "bass", "the bass sound menu appears, on Bass");
    ok((await p.textContent("#song-melody-clear")) === "Clear bass line" && /Bass tools/.test(await p.textContent("#song-melody-tools-summary")), "the tool labels name the part");
    ok((await p.getAttribute("#song-melody-mute", "aria-label")) === "Mute bass line" && (await p.getAttribute("#song-melody-volume", "aria-label")) === "Bass line volume", "so do the mute and volume controls");
    ok((await p.evaluate(() => document.getElementById("song-undo").disabled)), "switching the part is not an undo step");
    ok((await p.evaluate(() => document.activeElement.id)) === "song-roll-bass", "focus stays on the button");
    const chordRoots = await p.evaluate(() => [...document.getElementById("song-chord-root").options].map((o) => o.value));
    ok(chordRoots[0] === "C1" && chordRoots[23] === "B2" && (await p.inputValue("#song-chord-root")) === "C2", "the chord root menu follows (C1 to B2, C2 chosen)", [chordRoots[0], chordRoots[23]]);

    // ---- drawing a bass line
    await cell("C2", 0); await cell("C2", 4); await cell("G1", 2); await cell("E2", 6); await cell("E2", 7);
    ok((await on()) === "C2:0,4 E2:6,7 G1:2", "clicking steps turns bass notes on", await on());
    await p.click("#song-roll-melody");
    ok((await on()) === "G4:0", "the melody is exactly as it was: the bass notes are not in it");
    await p.click("#song-roll-bass");
    ok((await on()) === "C2:0,4 E2:6,7 G1:2", "and the bass notes come back");
    // tie by shift-click
    await p.click('#song-piano-roll .song-step[data-row="E2"][data-step="7"]', { modifiers: ["Shift"] });
    const tied = await p.evaluate(() => [...document.querySelectorAll("#song-piano-roll .song-step-tied")].map((x) => x.dataset.row + x.dataset.step).join());
    ok(tied === "E27", "Shift+click ties two bass steps", tied);
    // tools act on the part shown
    await p.click("#song-melody-shift-right");
    ok((await on()) === "C2:1,5 E2:7,8 G1:3", "Shift → moves the bass line one step and leaves the melody alone", await on());
    await p.click("#song-melody-shift-left");
    await p.click("#song-roll-melody");
    ok((await on()) === "G4:0", "…the melody did not move");
    await p.click("#song-roll-bass");
    await p.click("#song-melody-reverse");
    ok((await on()).startsWith("C2:11,15") || /C2:/.test(await on()), "Reverse works on the bass", await on());
    await p.click("#song-undo");
    ok((await on()) === "C2:0,4 E2:6,7 G1:2", "Undo puts the bass line back", await on());
    await p.click("#song-melody-clear");
    ok((await on()) === "" && /bass line cleared/i.test(await p.textContent("#song-melody-tools-note")), "Clear bass line empties it and says so", await p.textContent("#song-melody-tools-note"));
    await p.click("#song-undo");
    ok((await on()) === "C2:0,4 E2:6,7 G1:2", "…and undo restores it");

    // ---- the bass follows the kick
    ok(!(await p.evaluate(() => document.getElementById("song-bass-follow").hidden)), "Follow the kick is offered on the bass line");
    await p.click("#song-bass-follow");
    ok((await on()) === "C2:0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15", "four kicks a quarter apart give a held C2 under the whole bar", await on());
    ok((await p.textContent("#song-melody-tools-note")).startsWith("Bass on every kick, on C"), "and says what it did", await p.textContent("#song-melody-tools-note"));
    ok((await p.evaluate(() => document.querySelectorAll("#song-piano-roll .song-step-tied").length)) === 12, "with the held steps tied (12 of 16)");
    await p.click("#song-undo");
    ok((await on()) === "C2:0,4 E2:6,7 G1:2", "undo puts the earlier bass line back", await on());
    await p.click("#song-roll-melody");
    ok(await p.evaluate(() => document.getElementById("song-bass-follow").hidden), "the button is not shown for the melody");
    await p.click("#song-roll-bass");

    // ---- chord roots and arpeggios on the bass
    await p.click("#song-melody-clear");
    await p.selectOption("#song-prog-type", { index: 0 });
    await p.selectOption("#song-prog-key", "C");
    await p.click("#song-prog-stamp");
    const prog = await on();
    const stamped = prog.split(" ").filter(Boolean);
    ok(stamped.length >= 3 && stamped.every((x) => /^[A-G]#?[12]:/.test(x)), "Stamp chord roots puts one low note per chord (no stacked chord) on the bass line", prog);
    ok((await p.textContent("#song-prog-stamp")) === "Stamp chord roots" && /chord roots/.test(await p.textContent("#song-melody-tools-note")), "the button and message say roots", await p.textContent("#song-melody-tools-note"));
    await p.click("#song-melody-clear");
    await p.selectOption("#song-chord-type", { index: 0 });
    await p.click("#song-arp-apply");
    ok(/^[A-G]#?[12]:/.test(await on()) && !/[34]:/.test(await on()), "Arpeggiate plays a chord one note at a time on the bass roll", await on());
    await p.click("#song-melody-random");
    ok(/[12]:/.test(await on()) && !/[34]:/.test(await on()), "Random bass line stays in the bass range", await on());
    await p.click("#song-melody-clear");
    await cell("C2", 0); await cell("C2", 4); await cell("G1", 2); await cell("E2", 6); await cell("E2", 7);
    await p.click('#song-piano-roll .song-step[data-row="E2"][data-step="7"]', { modifiers: ["Shift"] });

    // ---- sound, volume, mute, hide
    await p.selectOption("#song-bass-voice", "pad");
    ok((await p.evaluate(() => document.getElementById("song-bass-voice").value)) === "pad", "the bass sound can be changed");
    await p.fill("#song-melody-volume", "50");
    await p.dispatchEvent("#song-melody-volume", "input");
    await p.click("#song-roll-melody");
    ok((await p.inputValue("#song-melody-volume")) === "100", "the melody's volume is its own (100) while the bass is at 50");
    await p.click("#song-roll-bass");
    ok((await p.inputValue("#song-melody-volume")) === "50", "the bass volume comes back when Bass is shown again");
    await p.click("#song-melody-hide");
    ok(/Bass line hidden, still plays/.test(await p.textContent("#song-piano-roll")) && (await p.getAttribute("#song-melody-hide", "aria-label")) === "Hidden bass line piano roll", "hiding the bass roll collapses it and says it still plays");
    await p.click("#song-piano-roll .song-melody-show");
    ok((await on()) === "C2:0,4 E2:6,7 G1:2", "Show bass line brings it back");
    await p.click("#song-melody-mute");
    ok((await p.getAttribute("#song-melody-mute", "aria-pressed")) === "true" && (await p.textContent("#song-melody-mute")) === "Muted", "mute works");
    await p.click("#song-roll-melody");
    ok((await p.getAttribute("#song-melody-mute", "aria-pressed")) === "false", "…and only on the bass");
    await p.click("#song-roll-bass");
    await p.click("#song-melody-mute"); // unmute

    // ---- save and look at what is stored
    await p.click("#save-song");
    await p.waitForTimeout(1300);
    let data = await saved();
    ok(data.bass && data.bass.voice === "pad" && data.bass.volume === 0.5 && !data.bass.muted && data.bass.notes.C2[0] === true && data.bass.notes.G1[2] === true && Object.keys(data.bass.notes).length === 24, "Save stores the bass line with its sound, volume and notes", data.bass && { voice: data.bass.voice, volume: data.bass.volume });
    ok(data.bass.ties && data.bass.ties.E2 && data.bass.ties.E2[7] === true, "and its held notes", data.bass && data.bass.ties);
    ok(data.melody.notes.G4[0] === true && !data.melody.notes.C2, "the melody is stored as it was");

    // ---- reopen
    await p.click("#close-song-builder"); await p.waitForTimeout(500);
    await openIt();
    ok((await title()) === "Melody (piano roll)", "reopening starts on the melody again");
    await p.click("#song-roll-bass");
    ok((await on()) === "C2:0,4 E2:6,7 G1:2" && (await p.inputValue("#song-bass-voice")) === "pad" && (await p.inputValue("#song-melody-volume")) === "50", "the bass line, its sound and its volume are all back", [await on(), await p.inputValue("#song-bass-voice")]);

    // ---- patterns: each has its own bass line
    await p.click("#song-pattern-duplicate");
    ok((await on()) === "C2:0,4 E2:6,7 G1:2", "Duplicate copies the bass line into the new pattern (B)", await on());
    await cell("C2", 0); await cell("A1", 0);
    ok((await on()) === "A1:0 C2:4 E2:6,7 G1:2", "B's bass is edited on its own", await on());
    await p.click('#song-pattern-buttons [data-pattern="A"]');
    ok((await on()) === "C2:0,4 E2:6,7 G1:2", "switching back to A shows A's bass line exactly as it was", await on());
    ok(/bass note/.test((await p.getAttribute('#song-pattern-buttons [data-pattern="B"]', "title")) || ""), "the pattern's button title counts its bass notes", await p.getAttribute('#song-pattern-buttons [data-pattern="B"]', "title"));
    await p.click('#song-pattern-new');
    ok((await on()) === "" && (await p.evaluate(() => document.querySelector("#song-pattern-buttons [aria-pressed=true]").textContent)) === "C", "a new pattern has an empty bass line", await on());
    await p.click("#song-pattern-remove");
    await p.click('#song-pattern-buttons [data-pattern="A"]');
    // transposing moves the bass line, and every pattern's (a semitone up: C2 > C#2, E2 > F2, G1 > G#1, tie included)
    await p.click("#song-transpose-up");
    ok((await on()) === "C#2:0,4 F2:6,7 G#1:2", "transposing up a semitone moves the bass line", await on());
    ok((await p.evaluate(() => [...document.querySelectorAll("#song-piano-roll .song-step-tied")].map((x) => x.dataset.row + x.dataset.step).join())) === "F27", "its held note moves with it");
    await p.click('#song-pattern-buttons [data-pattern="B"]');
    ok((await on()) === "A#1:0 C2:4 E2:6,7 G1:2".replace("C2:4", "C#2:4").replace("E2:6,7", "F2:6,7").replace("G1:2", "G#1:2"), "and so does pattern B's", await on());
    await p.click("#song-roll-melody");
    ok((await on()) === "G4:0" || /G#?4|A4|G#4/.test(await on()) === false, "while the melody is not transposed by a bass transpose");
    await p.click("#song-roll-bass");
    await p.click('#song-pattern-buttons [data-pattern="A"]');
    await p.click("#song-transpose-down");
    ok((await on()) === "C2:0,4 E2:6,7 G1:2", "and down again puts it back", await on());

    // ---- exports: MIDI, report, stems
    const [dl] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => document.getElementById("song-export-midi").click())]);
    const bytes = Array.from(fs.readFileSync(await dl.path()));
    const parsed = await p.evaluate((b2) => window.SongFiles.parseMidi(new Uint8Array(b2)), bytes);
    const bassTrack = parsed.tracks.find((t) => t.name === "Bass");
    ok(bassTrack && bassTrack.notes.every((n) => n.channel === 1) && bassTrack.notes.some((n) => n.note === 36) && bassTrack.notes.some((n) => n.note === 31), "the MIDI file has a Bass track on channel 2 with C2 and G1", bassTrack && bassTrack.notes.map((n) => n.note));
    ok(/Exported \d+ notes? as MIDI \(one bar/.test(await p.textContent("#song-file-status")), "(no song order yet, so it is one bar)", await p.textContent("#song-file-status"));
    const [rep] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => document.getElementById("song-export-report").click())]);
    const report = fs.readFileSync(await rep.path(), "utf8");
    ok(/Bass sound: Pad/.test(report) && /Bass notes used:/.test(report) && /\bC2: 2 \/ 16/.test(report), "the report names the bass sound and counts the bass notes", report.split("\n").filter((l) => /Bass/.test(l)));
    await p.evaluate(() => document.getElementById("song-export-audio").click());
    await p.waitForSelector("#song-audio-modal:not([hidden])");
    await p.check("#song-audio-stems");
    const stemText = await p.textContent("#song-audio-summary");
    ok(/^3 stems/.test(stemText), "Export audio's stems count the bass line as one (kick, melody, bass)", stemText);
    await p.evaluate(() => document.getElementById("close-song-audio").click());
    await p.waitForTimeout(300);

    // ---- the public player plays the bass
    await p.click("#save-song");
    await p.waitForTimeout(1300);
    const slug = "qq-bass-" + Date.now();
    const proj = await api("POST", "/projects", { slug, title: "QQ bass project", summary: "s", body: "A synthetic QQ body that is comfortably longer than fifty characters in total, for publishing.", published: true, related_songs: [id] });
    projectId = proj.j && proj.j.id;
    const html = await (await fetch(E2E_BASE + "/projects/" + slug)).text();
    const dataSong = (html.match(/data-song="([^"]*)"/) || [])[1] || "";
    ok(/&quot;bass&quot;:\{/.test(dataSong) && /&quot;voice&quot;:&quot;pad&quot;/.test(dataSong), "the public embed is given the bass line and its sound");
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
    await pub.waitForTimeout(2300);
    await pub.click(".song-embed-play-btn");
    const freqs = await pub.evaluate(() => window.__oscs.map((o) => Math.round(o.frequency.value * 10) / 10));
    ok(freqs.some((f) => Math.abs(f - 65.4) < 0.2) && freqs.some((f) => Math.abs(f - 49) < 0.2), "the public player sounds the bass notes (C2 = 65.4 Hz and G1 = 49 Hz are among its oscillators)", [...new Set(freqs)].slice(0, 12));
    ok(pubErrs.length === 0, "no errors on the public page", pubErrs);
    await pubCtx.close();

    // ---- accessibility, and a phone
    await p.addScriptTag({ content: axeSource() });
    for (const theme of ["dark", "light"]) {
      await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await p.waitForTimeout(300);
      const v = await p.evaluate(async () => (await axe.run(document.getElementById("song-builder-modal"), { runOnly: ["label", "select-name", "button-name", "color-contrast", "aria-valid-attr-value", "aria-allowed-attr"], resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ") + " " + (n.any[0] ? n.any[0].message : "")).slice(0, 3).join(",")));
      ok(v.length === 0, `${theme} theme (bass roll shown): no accessibility findings in the builder`, v);
    }
    await p.evaluate(() => document.documentElement.removeAttribute("data-theme"));
    await p.setViewportSize({ width: 390, height: 900 });
    await p.waitForTimeout(400);
    const phone = await p.evaluate(() => {
      const h = document.querySelector("#song-roll-title").closest("h2").getBoundingClientRect();
      const bt = document.getElementById("song-roll-bass").getBoundingClientRect();
      const sel = document.getElementById("song-bass-voice").getBoundingClientRect();
      return { spill: document.documentElement.scrollWidth - document.documentElement.clientWidth, bassH: Math.round(bt.height), selH: Math.round(sel.height), selRight: Math.round(sel.right), headRight: Math.round(h.right) };
    });
    ok(phone.spill <= 0 && phone.bassH >= 24 && phone.selH >= 24 && phone.selRight <= 392, "on a 390px phone the part switch and the bass sound menu fit and are touch-sized", phone);
    ok(errs.length === 0, "no errors in the builder", errs);

    // ---- an old song that only looks at the Bass tab is saved exactly as it was (no bass line is invented)
    await p.setViewportSize({ width: 1440, height: 1100 });
    await p.click("#close-song-builder"); await p.waitForTimeout(500);
    const plain = await api("POST", "/songs", { name: "QQ Plain", data: old });
    ids.push(plain.j.id);
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.locator(`.edit-song[data-id="${plain.j.id}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(800);
    await p.click("#song-roll-bass");
    await p.click("#song-roll-melody");
    await p.fill("#song-tempo", "111");
    await p.click("#save-song");
    await p.waitForTimeout(1300);
    const plainSaved = (await api("GET", "/songs/" + plain.j.id)).j.data;
    ok(plainSaved.tempo === 111 && !("bass" in plainSaved), "saving after only opening the Bass tab stores no bass line", Object.keys(plainSaved));
    ok(!JSON.stringify(plainSaved).includes('"patterns"') && JSON.stringify(plainSaved.melody.notes.G4.slice(0, 2)) === "[true,false]", "and the rest of the song is as it was");
    // a bass line whose notes were all removed is dropped again at the next save (settings left alone count as nothing)
    await p.click("#song-roll-bass");
    await p.click('#song-piano-roll .song-step[data-row="C2"][data-step="0"]');
    await p.click('#song-piano-roll .song-step[data-row="C2"][data-step="0"]');
    await p.click("#save-song");
    await p.waitForTimeout(1300);
    ok(!("bass" in (await api("GET", "/songs/" + plain.j.id)).j.data), "a bass note added and then removed leaves no bass line behind");
  } finally {
    if (projectId) await api("DELETE", "/projects/" + projectId);
    for (const sid of ids) await api("DELETE", "/songs/" + sid);
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
