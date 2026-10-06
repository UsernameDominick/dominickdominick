// Melody sound (instrument) in the song builder: the select, its effect on the waveform select, undo/redo, saving, reopening, the JSON
// export, and that the public embed receives the sound.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const fs = require("fs");
(async () => {
  const b = await chromium.launch();
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  const api = async (method, path, data) => { const r = await ctx.request.fetch(E2E_BASE + "/api/admin" + path, { method, data, headers: { "content-type": "application/json" } }); let j = null; try { j = await r.json(); } catch (e) { /* none */ } return { s: r.status(), j }; };

  const lane = (str) => Array.from(str, (c) => c === "x");
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const notes = {}; [4, 3].forEach((o) => { for (let i = 11; i >= 0; i--) notes[NAMES[i] + o] = Array(16).fill(false); });
  notes.C4 = lane("x...x...x...x...");
  const song = { tempo: 100, kit: "acoustic", visualization: "waveform", theme: "default", master_volume: 1, tracks: { kick: lane("x...x...x...x..."), snare: [], hihat: [], clap: [] }, trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} }, melody: { waveform: "square", notes } };
  const created = await api("POST", "/songs", { name: "QQ Voices", data: song });
  const id = created.j.id;
  let projectId = null;
  try {
    await p.goto(E2E_BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.locator(`.edit-song[data-id="${id}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(900);

    const state = () => p.evaluate(() => ({ voice: document.getElementById("song-voice").value, wave: document.getElementById("song-waveform").value, waveDisabled: document.getElementById("song-waveform").disabled, waveTitle: document.getElementById("song-waveform").title }));
    let s = await state();
    ok(s.voice === "" && s.wave === "square" && !s.waveDisabled, "an old song opens as Basic with its waveform in use", s);
    const options = await p.evaluate(() => [...document.querySelectorAll("#song-voice option")].map((o) => o.value));
    ok(options[0] === "" && ["pluck", "lead", "pad", "bass", "bell"].every((v) => options.includes(v)) && options.length >= 42, "the select offers Basic first and then the instruments, the original five among them", options.length);
    ok(await p.evaluate(() => !!document.getElementById("song-voice").getAttribute("aria-label")), "the select has a name");

    await p.selectOption("#song-voice", "pluck");
    s = await state();
    ok(s.voice === "pluck" && s.waveDisabled && /Pluck/.test(s.waveTitle), "choosing Pluck turns the waveform select off and says why", s);
    await p.waitForTimeout(400);

    await p.click("#song-undo");
    s = await state();
    ok(s.voice === "" && !s.waveDisabled, "Undo goes back to Basic and the waveform select works again", s);
    await p.click("#song-redo");
    s = await state();
    ok(s.voice === "pluck" && s.waveDisabled, "Redo brings the instrument back", s);

    // playing with an instrument works (a preview render and live playback), and a live key press uses it too
    await p.click("#song-play");
    await p.waitForTimeout(900);
    await p.click("#song-play");
    ok(errs.length === 0, "playing with an instrument raises no script errors", errs);

    // save and reopen
    await p.click("#save-song");
    await p.waitForTimeout(1200);
    const saved = await api("GET", "/songs/" + id);
    ok(saved.j && saved.j.data.melody.voice === "pluck", "Save stores the instrument in the song", saved.j && saved.j.data.melody);
    ok(Array.isArray(saved.j.data.cached_peaks) && saved.j.data.cached_peaks.length > 0, "the waveform preview is re-rendered with the instrument and stored", saved.j.data.cached_peaks && saved.j.data.cached_peaks.length);

    // the JSON export carries it
    const [dl] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => document.getElementById("song-export-json").click())]);
    const file = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    ok(file.data.melody.voice === "pluck", "the JSON export keeps the instrument", file.data.melody);

    // the public embed receives it
    const slug = "qq-voices-" + Date.now();
    const proj = await api("POST", "/projects", { slug, title: "QQ voices project", summary: "s", body: "A synthetic QQ body that is comfortably longer than fifty characters in total, for publishing.", published: true, related_songs: [id] });
    projectId = proj.j && proj.j.id;
    const html = await (await fetch(E2E_BASE + "/projects/" + slug)).text();
    const dataSong = (html.match(/data-song="([^"]*)"/) || [])[1] || "";
    ok(/&quot;voice&quot;:&quot;pluck&quot;/.test(dataSong), "the public song embed is given the instrument", dataSong.slice(0, 120));

    // back to Basic removes the key
    await p.selectOption("#song-voice", "");
    s = await state();
    ok(s.voice === "" && !s.waveDisabled, "choosing Basic again re-enables the waveform select", s);
    await p.click("#save-song");
    await p.waitForTimeout(1200);
    const again = await api("GET", "/songs/" + id);
    ok(again.j.data.melody.voice === undefined && again.j.data.melody.waveform === "square", "…and a saved Basic song has no voice at all", again.j.data.melody);
  } finally {
    if (projectId) await api("DELETE", "/projects/" + projectId);
    await api("DELETE", "/songs/" + id);
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
