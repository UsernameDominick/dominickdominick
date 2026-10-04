// Patterns A-D and the song order in the song builder and on the public player: making, copying, switching and removing patterns, the song
// order, undo, saving and reopening, which pattern sounds when (builder and public embed), transposing every pattern, and accessibility.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
(async () => {
  const b = await chromium.launch();
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 1100 } });
  // every player the page makes reports which pattern each step belongs to
  await ctx.addInitScript(() => {
    let engine;
    Object.defineProperty(window, "SongEngine", {
      configurable: true,
      get: () => engine,
      set: (v) => {
        engine = v;
        const orig = v.createPlayer;
        v.createPlayer = (get, data, on) => orig(get, data, (step, time, info) => { (window.__steps = window.__steps || []).push({ step, p: info && info.pattern, i: info && info.chainIndex, n: info && info.chainLength }); if (on) on(step, time, info); });
      },
    });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  const api = async (method, path, data) => { const r = await ctx.request.fetch(E2E_BASE + "/api/admin" + path, { method, data, headers: { "content-type": "application/json" } }); let j = null; try { j = await r.json(); } catch (e) { /* none */ } return { s: r.status(), j }; };
  const lane = (str) => Array.from(str, (c) => c === "x");
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const notes = {}; [4, 3].forEach((o) => { for (let i = 11; i >= 0; i--) notes[NAMES[i] + o] = Array(16).fill(false); });
  notes.G4 = lane("x...............");
  const song = { tempo: 240, kit: "acoustic", visualization: "waveform", theme: "default", master_volume: 1, tracks: { kick: lane("x...x...x...x..."), snare: lane("....x.......x..."), hihat: [], clap: [] }, trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} }, melody: { waveform: "sine", notes } };
  const created = await api("POST", "/songs", { name: "QQ Patterns", data: song });
  const id = created.j.id;
  let projectId = null;
  const buttons = () => p.evaluate(() => [...document.querySelectorAll("#song-pattern-buttons .song-pattern-btn")].map((x) => x.textContent + (x.getAttribute("aria-pressed") === "true" ? "*" : "")).join(""));
  const chips = () => p.evaluate(() => [...document.querySelectorAll("#song-order-list .song-order-letter")].map((x) => x.textContent).join(""));
  const kick = () => p.evaluate(() => [...document.querySelectorAll('#song-sequencer .song-step[data-row="kick"]')].map((x, i) => (x.classList.contains("song-step-on") ? i : -1)).filter((i) => i >= 0).join());
  const melody = () => p.evaluate(() => { const out = {}; document.querySelectorAll("#song-piano-roll .song-steps").forEach((row) => { const on = [...row.children].map((x, i) => (x.classList.contains("song-step-on") ? i : -1)).filter((i) => i >= 0); if (on.length) out[row.dataset.row] = on.join(","); }); return Object.entries(out).sort().map(([n, s]) => `${n}:${s}`).join(" "); });
  const say = () => p.textContent("#song-arrangement-note");
  const enabled = (sel) => p.evaluate((q) => !document.querySelector(q).disabled, sel);
  const play = async (ms) => { await p.evaluate(() => { window.__steps = []; }); await p.click("#song-play"); await p.waitForTimeout(ms); await p.click("#song-play"); return p.evaluate(() => window.__steps || []); };
  const seq = (steps) => steps.filter((x) => x.step === 0).map((x) => x.p).join("");
  try {
    await p.goto(E2E_BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.locator(`.edit-song[data-id="${id}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(900);

    // ---- an old song: one pattern, the order controls out of the way
    ok((await buttons()) === "A*", "an old song has one pattern, A, open", await buttons());
    ok((await enabled("#song-pattern-new")) && (await enabled("#song-pattern-duplicate")) && (await p.evaluate(() => document.getElementById("song-pattern-remove").hidden)), "New and Duplicate are available, Remove is not shown (a song needs a pattern)");
    ok(await p.evaluate(() => document.getElementById("song-order-tools").hidden), "the song order controls are hidden until there is a second pattern");

    // ---- duplicate: B is a copy of A and opens
    await p.click("#song-pattern-duplicate");
    ok((await buttons()) === "AB*" && (await kick()) === "0,4,8,12" && (await melody()) === "G4:0", "Duplicate makes B as a copy of A and opens it", [await buttons(), await kick(), await melody()]);
    ok(/Pattern B is a copy of A/.test(await say()), "and says so", await say());
    ok(await p.evaluate(() => !document.getElementById("song-order-tools").hidden), "the song order controls appear");
    ok((await p.evaluate(() => document.activeElement && document.activeElement.dataset.pattern)) === "B", "focus lands on the open pattern's button");
    await p.click("#song-undo");
    ok((await buttons()) === "A*" && (await kick()) === "0,4,8,12", "Undo takes the copy back out and returns to A", [await buttons(), await kick()]);
    await p.click("#song-redo");
    ok((await buttons()) === "AB*", "Redo brings it back", await buttons());

    // ---- B gets its own music; A keeps its own
    await p.click('#song-sequencer .song-step[data-row="kick"][data-step="4"]');
    await p.click('#song-sequencer .song-step[data-row="kick"][data-step="12"]');
    await p.click('#song-piano-roll .song-step[data-row="C4"][data-step="3"]');
    ok((await kick()) === "0,8" && (await melody()) === "C4:3 G4:0", "B is edited on its own", [await kick(), await melody()]);
    await p.click('#song-pattern-buttons [data-pattern="A"]');
    ok((await buttons()) === "A*B" && (await kick()) === "0,4,8,12" && (await melody()) === "G4:0", "switching to A shows A exactly as it was", [await kick(), await melody()]);
    const undoEnabled = await enabled("#song-undo");
    await p.click('#song-pattern-buttons [data-pattern="B"]');
    ok((await kick()) === "0,8" && (await melody()) === "C4:3 G4:0", "and back to B shows B's edits", [await kick(), await melody()]);
    ok(undoEnabled, "(Undo stays available: the edits are undoable even after switching)");
    await p.click("#song-undo");
    ok((await melody()) === "G4:0" && (await buttons()) === "AB*", "Undo after switching around reverts B's last edit (the C4 note), still in B", [await melody(), await buttons()]);
    await p.click("#song-redo");
    ok((await melody()) === "C4:3 G4:0", "Redo puts it back", await melody());

    // ---- a third and fourth pattern; the limit
    await p.click("#song-pattern-new");
    ok((await buttons()) === "ABC*" && (await kick()) === "" && (await melody()) === "", "New starts an empty pattern C and opens it", [await buttons(), await kick()]);
    await p.click("#song-pattern-new");
    ok((await buttons()) === "ABCD*" && !(await enabled("#song-pattern-new")) && !(await enabled("#song-pattern-duplicate")), "four patterns is the most: New and Duplicate switch off", await buttons());
    await p.click('#song-pattern-buttons [data-pattern="B"]');

    // ---- the song order
    const hint = await p.evaluate(() => { const h = document.getElementById("song-order-hint"); return { shown: !h.hidden, text: h.textContent }; });
    ok((await chips()) === "" && hint.shown && /plays pattern A on its own/.test(hint.text), "the order starts empty, and says that the song plays pattern A on its own", hint);
    for (const n of ["A", "A", "B", "A"]) await p.click(`#song-order-add [data-pattern="${n}"]`);
    ok((await chips()) === "AABA", "the order is built with the + buttons", await chips());
    ok(/Song order: A A B A, 4 bars, 4\.0 seconds at 240 BPM/.test(await say()) && (await p.evaluate(() => document.getElementById("song-order-hint").hidden)) && /4 bars, 4\.0 seconds at 240 BPM/.test(await p.textContent("#song-order-summary")), "its length is announced and shown beside the order, and the empty-order hint goes away", [await say(), await p.textContent("#song-order-summary")]);
    ok(await p.isChecked("#song-play-order"), "once the order has two bars, Play follows it");
    await p.click('#song-order-list .song-order-remove[data-index="1"]');
    ok((await chips()) === "ABA", "× takes one bar out of the order", await chips());
    await p.click('#song-order-add [data-pattern="A"]');
    ok((await chips()) === "ABAA", "…and + puts one back at the end", await chips());
    await p.click('#song-order-list .song-order-remove[data-index="3"]');

    // ---- playing: the order, then just the open pattern
    let steps = await play(4600);
    const heard = seq(steps);
    ok(heard.startsWith("ABA") && steps.every((x) => x.n === 3), "Play runs the song order A B A (three bars) and loops it", heard);
    ok(steps.some((x) => x.i === 2), "the player reports the position in the order");
    await p.uncheck("#song-play-order");
    steps = await play(2600);
    ok(seq(steps).length >= 2 && [...seq(steps)].every((c) => c === "B") && steps.every((x) => x.n === 1), "with the order off, Play loops the open pattern (B) alone", seq(steps));
    ok(errs.length === 0, "no script errors while playing", errs);
    await p.check("#song-play-order");

    // ---- transposing moves every pattern's notes
    await p.click("#song-transpose-octave-down");
    ok((await melody()) === "C3:3 G3:0" || (await melody()) === "C3:3 G4:0", "Oct ↓ moves the open pattern's notes", await melody());
    await p.click('#song-pattern-buttons [data-pattern="A"]');
    ok((await melody()) === "G3:0", "…and the other patterns' notes too (A's G4 is now G3)", await melody());
    await p.click('#song-pattern-buttons [data-pattern="B"]');
    await p.click("#song-transpose-octave-up");

    // ---- save and look at what is stored
    await p.click("#save-song");
    await p.waitForTimeout(1300);
    const saved = (await api("GET", "/songs/" + id)).j.data;
    ok(saved.editing === "B" && JSON.stringify(Object.keys(saved.patterns).sort()) === JSON.stringify(["A", "C", "D"]) && saved.chain.join("") === "ABA", "Save stores the open pattern (B), the others and the order", { editing: saved.editing, patterns: Object.keys(saved.patterns), chain: saved.chain });
    ok(saved.tracks.kick.map((v, i) => (v ? i : -1)).filter((i) => i >= 0).join() === "0,8" && saved.patterns.A.tracks.kick.map((v, i) => (v ? i : -1)).filter((i) => i >= 0).join() === "0,4,8,12", "the open pattern is the song's own tracks; A is under patterns", saved.tracks.kick);
    ok(Array.isArray(saved.cached_peaks) && saved.cached_peaks.length > 0, "the waveform preview covers the whole order and is stored");

    // ---- reopen
    await p.click("#close-song-builder"); await p.waitForTimeout(500);
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.locator(`.edit-song[data-id="${id}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(800);
    ok((await buttons()) === "ABCD".replace("B", "B*") && (await chips()) === "ABA" && (await kick()) === "0,8", "reopening shows the patterns, the open one and the order", [await buttons(), await chips(), await kick()]);
    ok(await p.isChecked("#song-play-order"), "and Play follows the order, because the song has one");

    // ---- the audio export covers the whole song, and a very long one is limited
    await p.evaluate(() => document.getElementById("song-export-audio").click());
    await p.waitForSelector("#song-audio-modal:not([hidden])");
    await p.selectOption("#song-audio-loops", "2");
    await p.selectOption("#song-audio-tail", "0");
    const exportText = await p.textContent("#song-audio-summary");
    ok(/^6\.00 seconds at 240 BPM/.test(exportText), "Export audio is the whole song: A B A at 240 BPM is 3 s, twice is 6 s", exportText);
    await p.evaluate(() => document.getElementById("close-song-audio").click());
    await p.waitForTimeout(300);

    // ---- the public player plays the whole song
    const slug = "qq-patterns-" + Date.now();
    const proj = await api("POST", "/projects", { slug, title: "QQ patterns project", summary: "s", body: "A synthetic QQ body that is comfortably longer than fifty characters in total, for publishing.", published: true, related_songs: [id] });
    projectId = proj.j && proj.j.id;
    const html = await (await fetch(E2E_BASE + "/projects/" + slug)).text();
    const dataSong = (html.match(/data-song="([^"]*)"/) || [])[1] || "";
    ok(/&quot;chain&quot;:\[&quot;A&quot;,&quot;B&quot;,&quot;A&quot;\]/.test(dataSong) && /&quot;patterns&quot;/.test(dataSong) && /&quot;editing&quot;:&quot;B&quot;/.test(dataSong), "the public song embed is given the patterns and the order");
    const pub = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
    const pubErrs = [];
    pub.on("pageerror", (e) => pubErrs.push(String(e)));
    await pub.addInitScript(() => {
      let engine;
      Object.defineProperty(window, "SongEngine", { configurable: true, get: () => engine, set: (v) => { engine = v; const orig = v.createPlayer; v.createPlayer = (g, d, on) => orig(g, d, (step, time, info) => { (window.__steps = window.__steps || []).push({ step, p: info && info.pattern, i: info && info.chainIndex, n: info && info.chainLength }); if (on) on(step, time, info); }); } });
    });
    await pub.goto(E2E_BASE + "/projects/" + slug, { waitUntil: "networkidle" });
    await pub.click(".song-embed-play-btn");
    await pub.waitForTimeout(4600);
    await pub.click(".song-embed-play-btn");
    const pubSteps = await pub.evaluate(() => window.__steps || []);
    const pubSeq = pubSteps.filter((x) => x.step === 0).map((x) => x.p).join("");
    ok(pubSeq.startsWith("ABA") && pubSteps.every((x) => x.n === 3) && pubErrs.length === 0, "the public player plays A, B, A and loops it, with no errors", { pubSeq, pubErrs });

    // ---- remove a pattern
    await p.click('#song-pattern-buttons [data-pattern="D"]');
    await p.click("#song-pattern-remove");
    const afterRemoveD = await buttons();
    ok(!afterRemoveD.includes("D") && afterRemoveD.replace("*", "").length === 3 && afterRemoveD.includes("*"), "Remove takes the open pattern (D, empty) away and opens another", afterRemoveD);
    await p.click('#song-pattern-buttons [data-pattern="A"]');
    await p.click("#song-pattern-remove");
    ok(!(await buttons()).includes("A") && (await chips()) === "B", "removing A also takes it out of the song order (B A... leaves just B)", [await buttons(), await chips()]);
    await p.click("#song-undo");
    ok((await buttons()).includes("A") && (await chips()) === "ABA", "Undo brings the pattern and its place in the order back", [await buttons(), await chips()]);

    // ---- accessibility and the phone
    await p.addScriptTag({ content: axeSource() });
    const v = await p.evaluate(async () => (await axe.run(document.getElementById("song-arrangement"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")));
    ok(v.length === 0, "the patterns section has no accessibility violations", v);
    await p.setViewportSize({ width: 390, height: 900 });
    await p.waitForTimeout(400);
    const spill = await p.evaluate(() => { const d = document.getElementById("song-arrangement"); return { section: d.scrollWidth - d.clientWidth, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
    ok(spill.section <= 1 && spill.doc <= 0, "at 390px the patterns section does not spill sideways", spill);

    // ---- a very long song gets fewer repeats than the menu offers
    await p.setViewportSize({ width: 1440, height: 1100 });
    await p.waitForTimeout(300);
    const before = (await chips()).length;
    for (let i = 0; i < 32 - before; i++) await p.click('#song-order-add [data-pattern="A"]');
    ok((await chips()).length === 32 && !(await enabled('#song-order-add [data-pattern="A"]')), "the order stops at 32 bars (the + buttons switch off)", (await chips()).length);
    await p.fill("#song-tempo", "120");
    await p.evaluate(() => document.getElementById("song-export-audio").click());
    await p.waitForSelector("#song-audio-modal:not([hidden])");
    await p.selectOption("#song-audio-loops", "8");
    const longText = await p.textContent("#song-audio-summary");
    ok(/Repeated 4 times, not 8: the song is long/.test(longText), "a 32-bar song at 120 BPM is a 64 s loop, so five minutes allow 4 repeats, not 8", longText);
  } finally {
    if (projectId) await api("DELETE", "/projects/" + projectId);
    await api("DELETE", "/songs/" + id);
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
