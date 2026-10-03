// Echo in the song builder: the slider, undo/redo, saving (and leaving no field when it is off), the written report, and that the public
// embed receives it and builds the delay when it plays.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
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
  const song = { tempo: 100, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1, space: 0, tracks: { kick: lane("x...x...x...x..."), snare: [], hihat: [], clap: [] }, trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} }, melody: { waveform: "sine", notes } };
  const created = await api("POST", "/songs", { name: "QQ Echo", data: song });
  const id = created.j.id;
  let projectId = null;
  const setSlider = (value) => p.evaluate((v) => { const el = document.getElementById("song-echo"); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, value);
  const slider = () => p.evaluate(() => ({ value: document.getElementById("song-echo").value, text: document.getElementById("song-echo").getAttribute("aria-valuetext") }));
  try {
    await p.goto(E2E_BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.locator(`.edit-song[data-id="${id}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(800);

    let s = await slider();
    ok(s.value === "0" && s.text === "Dry", "an old song opens with Echo off (Dry)", s);
    ok(await p.evaluate(() => !!document.querySelector("label[title*='dotted eighth'] #song-echo")), "the slider is labelled Echo, with a tooltip explaining what it does");

    await setSlider(60);
    s = await slider();
    ok(s.value === "60" && s.text === "60% echo", "moving the slider says '60% echo'", s);
    await p.waitForTimeout(300);
    await p.click("#song-undo");
    s = await slider();
    ok(s.value === "0" && s.text === "Dry", "Undo puts Echo back to Dry", s);
    await p.click("#song-redo");
    s = await slider();
    ok(s.value === "60", "Redo brings it back", s);

    await p.click("#song-play"); await p.waitForTimeout(900); await p.click("#song-play");
    ok(errs.length === 0, "playing with Echo on raises no script errors", errs);

    await p.click("#save-song");
    await p.waitForTimeout(1200);
    const saved = (await api("GET", "/songs/" + id)).j;
    ok(saved.data.echo === 60, "Save stores echo: 60", saved.data.echo);

    const [report] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => document.getElementById("song-export-report").click())]);
    const text = require("fs").readFileSync(await report.path(), "utf8");
    ok(/Echo: 60%/.test(text), "the written report includes 'Echo: 60%'", text.split("\n").filter((l) => /Echo|Space/.test(l)));

    // the public embed gets it and builds the delay when it plays
    const slug = "qq-echo-" + Date.now();
    const proj = await api("POST", "/projects", { slug, title: "QQ echo project", summary: "s", body: "A synthetic QQ body that is comfortably longer than fifty characters in total, for publishing.", published: true, related_songs: [id] });
    projectId = proj.j && proj.j.id;
    const html = await (await fetch(E2E_BASE + "/projects/" + slug)).text();
    ok(/&quot;echo&quot;:60/.test((html.match(/data-song="([^"]*)"/) || [])[1] || ""), "the public song embed is given echo: 60");
    const pub = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
    const pubErrs = [];
    pub.on("pageerror", (e) => pubErrs.push(String(e)));
    await pub.addInitScript(() => { window.__delays = 0; const orig = AudioContext.prototype.createDelay; AudioContext.prototype.createDelay = function (...a) { window.__delays++; return orig.apply(this, a); }; });
    await pub.goto(E2E_BASE + "/projects/" + slug, { waitUntil: "networkidle" });
    await pub.click(".song-embed-play-btn");
    await pub.waitForTimeout(1200);
    const delays = await pub.evaluate(() => window.__delays);
    await pub.click(".song-embed-play-btn");
    ok(delays === 1 && pubErrs.length === 0, "playing the public embed builds exactly one echo delay and raises no errors", { delays, pubErrs });

    // off again leaves no field
    await setSlider(0);
    s = await slider();
    ok(s.value === "0" && s.text === "Dry", "back to 0 reads Dry", s);
    await p.click("#save-song");
    await p.waitForTimeout(1200);
    const again = (await api("GET", "/songs/" + id)).j;
    ok(again.data.echo === undefined, "a song with Echo off is saved without an echo field", again.data.echo);
  } finally {
    if (projectId) await api("DELETE", "/projects/" + projectId);
    await api("DELETE", "/songs/" + id);
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
