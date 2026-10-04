// Importing a MIDI file in the Songs window: a file the builder wrote comes back as a new song (patterns and song order included), the
// builder opens with a note of what was kept, a file that is not usable only gives a message and creates nothing, and the new button works
// by keyboard, in both themes and on a phone.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
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
  const emptyNotes = () => { const n = {}; [4, 3].forEach((o) => { for (let i = 11; i >= 0; i--) n[NAMES[i] + o] = Array(16).fill(false); }); return n; };
  const A = { tracks: { kick: lane("x...x...x...x..."), snare: lane("....x.......x..."), hihat: lane("x.x.x.x.x.x.x.x."), clap: lane("................") }, notes: { ...emptyNotes(), C4: lane("x...x...x...x...") } };
  const B = { tracks: { kick: lane("x......."), snare: lane("....x.......x..."), hihat: lane("................"), clap: lane("................") }, notes: { ...emptyNotes(), E4: lane("x.......x.......") }, ties: {} };
  const original = {
    tempo: 132, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1,
    tracks: A.tracks, trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} }, melody: { waveform: "sine", notes: A.notes },
    patterns: { B }, chain: ["A", "A", "B"],
  };
  const made = [];
  const songsNamed = async (prefix) => ((await api("GET", "/songs")).j || []).filter((s) => String(s.name).startsWith(prefix));
  const cleanUp = async () => { for (const s of await songsNamed("QQ")) await api("DELETE", "/songs/" + s.id); };
  const open = async () => {
    await p.goto(E2E_BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.waitForTimeout(500);
  };
  const midiBytes = (song, name) => p.evaluate(({ song, name }) => Array.from(window.SongFiles.buildMidi(song, name).bytes), { song, name });
  const pick = (name, bytes) => p.setInputFiles("#song-import-midi-input", { name, mimeType: "audio/midi", buffer: Buffer.from(bytes) });
  const status = () => p.textContent("#song-import-status");
  try {
    await cleanUp();
    await open();

    // ---- the button is there, named, and reachable by keyboard
    const btn = await p.evaluate(() => { const e = document.getElementById("song-import-midi-btn"); return { text: e.textContent, title: e.title, type: e.type }; });
    ok(/Import MIDI/.test(btn.text) && btn.title.length > 20 && btn.type === "button", "an Import MIDI… button sits next to Import song file…", btn);
    await p.focus("#song-import-btn");
    await p.keyboard.press("Tab");
    ok((await p.evaluate(() => document.activeElement.id)) === "song-import-midi-btn", "it is the next stop after Import song file… for the keyboard");

    // ---- a file the builder wrote comes back as a new song with its patterns and order
    const bytes = await midiBytes(original, "QQ source");
    ok(bytes.length > 100, "(a MIDI file of a three-bar song was made by the builder's own export)", bytes.length);
    await pick("QQ Imported groove.mid", bytes);
    await p.waitForSelector("#song-builder-modal:not([hidden])", { timeout: 8000 });
    await p.waitForTimeout(900);
    const list = await songsNamed("QQ Imported groove");
    ok(list.length === 1, "one new song, named after the file without .mid", list.map((s) => s.name));
    if (list[0]) made.push(list[0].id);
    ok((await p.inputValue("#song-name")) === "QQ Imported groove", "the builder opened on it", await p.inputValue("#song-name"));
    ok((await p.inputValue("#song-tempo")) === "132", "at the file's tempo", await p.inputValue("#song-tempo"));
    const patternButtons = await p.evaluate(() => [...document.querySelectorAll("#song-pattern-buttons .song-pattern-btn")].map((x) => x.textContent).join(""));
    const order = await p.evaluate(() => [...document.querySelectorAll("#song-order-list .song-order-letter")].map((x) => x.textContent).join(""));
    ok(patternButtons === "AB" && order === "AAB", "two patterns and the song order AAB", { patternButtons, order });
    const note = await p.textContent("#song-file-status");
    ok(/Imported from MIDI/.test(note) && /Read 3 bars at 132 BPM/.test(note) && /2 different bars/.test(note), "the builder says what was read", note);
    ok(/Imported "QQ Imported groove" as a new song/.test(await status()), "the list shows the result too", await status());
    const saved = (await api("GET", "/songs/" + made[0])).j;
    const data = saved && (typeof saved.data === "string" ? JSON.parse(saved.data) : saved.data);
    ok(data && data.chain && data.chain.join("") === "AAB" && data.tempo === 132 && data.tracks.kick.slice(0, 5).join() === "true,false,false,false,true", "the saved song has the order, the tempo and the drum steps", data && { chain: data.chain, tempo: data.tempo });
    ok(data && data.patterns && data.patterns.B && data.patterns.B.notes.E4[8] === true && data.melody.notes.C4[4] === true, "the melody notes of each pattern are saved in their own pattern");
    const kickOn = await p.evaluate(() => [...document.querySelectorAll('#song-sequencer .song-step[data-row="kick"]')].map((x, i) => (x.classList.contains("song-step-on") ? i : -1)).filter((i) => i >= 0).join());
    ok(kickOn === "0,4,8,12", "the open pattern shows its own kick steps", kickOn);

    // ---- exporting it again gives the same three bars
    const [download] = await Promise.all([p.waitForEvent("download"), p.click("#song-export-midi")]);
    const exportStatus = await p.textContent("#song-file-status");
    ok(/3 bars, the song order/.test(exportStatus) && /\.mid$/.test(download.suggestedFilename()), "Export MIDI of a patterned song says it wrote the whole song order", [exportStatus, download.suggestedFilename()]);

    // ---- back in the list: files that cannot be used create nothing
    await p.click("#close-song-builder");
    await p.waitForSelector("#song-builder-modal", { state: "hidden" });
    await p.waitForTimeout(400);
    const before = (await songsNamed("")).length;
    await pick("QQ not midi.mid", Array.from(Buffer.from("this is just some text, not a MIDI file at all")));
    await p.waitForFunction(() => /MIDI/.test(document.getElementById("song-import-status").textContent), null, { timeout: 5000 });
    ok(/isn't a MIDI file/.test(await status()), "a text file renamed .mid is refused in words", await status());
    await pick("QQ big.mid", new Array(1000100).fill(0));
    await p.waitForFunction(() => /too big/.test(document.getElementById("song-import-status").textContent), null, { timeout: 5000 });
    ok(/over 1 MB/.test(await status()), "a file over 1 MB is refused before it is read", await status());
    const empty = await p.evaluate(() => Array.from(window.SongFiles.buildMidi({ tempo: 120, tracks: { kick: Array(16).fill(true) }, melody: { notes: {} } }, "x").bytes.slice(0, 22)));
    await pick("QQ cut.mid", empty);
    await p.waitForTimeout(600);
    ok(/MIDI|notes/.test(await status()) && !/Imported/.test(await status()), "a file cut short gives a message", await status());
    ok((await songsNamed("")).length === before && (await p.evaluate(() => document.getElementById("song-builder-modal").hidden)), "none of those made a song or opened the builder");

    // ---- a file with only drums this site has no sound for, and a melody far out of range
    const hostile = await p.evaluate(() => {
      const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
      const body = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, 0, 0x90, 96, 100, 120, 0x80, 96, 0, 0, 0x90, 100, 100, 120, 0x80, 100, 0, 0, 0xff, 0x2f, 0];
      return [...Array.from("MThd").map((c) => c.charCodeAt(0)), ...be32(6), 0, 0, 0, 1, 1, 0xe0, ...Array.from("MTrk").map((c) => c.charCodeAt(0)), ...be32(body.length), ...body];
    });
    await pick("QQ high.mid", hostile);
    await p.waitForSelector("#song-builder-modal:not([hidden])", { timeout: 8000 });
    await p.waitForTimeout(700);
    const high = await songsNamed("QQ high");
    if (high[0]) made.push(high[0].id);
    const highNote = await p.textContent("#song-file-status");
    ok(high.length === 1 && /moved \d octaves? down/.test(highNote), "a melody far above the piano roll is brought down as a whole and the builder says so", highNote);
    await p.click("#close-song-builder");
    await p.waitForSelector("#song-builder-modal", { state: "hidden" });

    // ---- the import button in both themes, and on a phone
    await p.addScriptTag({ content: axeSource() });
    for (const theme of ["dark", "light"]) {
      await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await p.waitForTimeout(400);
      const v = await p.evaluate(async () => (await axe.run(document.getElementById("songs-modal"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")));
      ok(v.length === 0, `${theme} theme: the Songs window has no accessibility findings`, v);
    }
    await p.evaluate(() => document.documentElement.removeAttribute("data-theme"));
    await p.setViewportSize({ width: 390, height: 800 });
    await p.waitForTimeout(400);
    const phone = await p.evaluate(() => {
      const modal = document.querySelector("#songs-modal .modal-content, #songs-modal > div") || document.getElementById("songs-modal");
      const e = document.getElementById("song-import-midi-btn").getBoundingClientRect();
      return { overflowX: document.documentElement.scrollWidth > window.innerWidth + 1, modalOverflow: modal.scrollWidth > modal.clientWidth + 1, h: Math.round(e.height), right: Math.round(e.right) };
    });
    ok(!phone.overflowX && !phone.modalOverflow && phone.h >= 24 && phone.right <= 390, "on a 390px phone the buttons wrap and nothing spills sideways", phone);
    ok(errs.length === 0, "no page errors", errs);
  } finally {
    for (const id of made) await api("DELETE", "/songs/" + id);
    await cleanUp();
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
