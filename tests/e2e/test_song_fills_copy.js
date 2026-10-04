// Drum fills (the end of the bar becomes a roll or a stop) and copying one part of another pattern into the open one.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
(async () => {
  const b = await chromium.launch();
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 1100 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  const api = async (method, path, data) => { const r = await ctx.request.fetch(E2E_BASE + "/api/admin" + path, { method, data, headers: { "content-type": "application/json" } }); let j = null; try { j = await r.json(); } catch (e) { /* none */ } return { s: r.status(), j }; };
  const lane = (str) => Array.from(str, (c) => c === "x");
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const roll = (names, set) => { const n = {}; names.forEach((x) => (n[x] = Array(16).fill(false))); Object.entries(set || {}).forEach(([k, v]) => (n[k] = lane(v))); return n; };
  const melodyNames = []; [4, 3].forEach((o) => { for (let i = 11; i >= 0; i--) melodyNames.push(NAMES[i] + o); });
  const bassNames = []; [2, 1].forEach((o) => { for (let i = 11; i >= 0; i--) bassNames.push(NAMES[i] + o); });
  const drums = (k, s, h) => ({ kick: lane(k), snare: lane(s), hihat: lane(h), clap: lane("................") });
  const song = {
    tempo: 120, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1,
    tracks: drums("x...x...x...x...", "....x.......x...", "x.x.x.x.x.x.x.x."), trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} },
    melody: { waveform: "sine", notes: roll(melodyNames, { C4: "x...x...x...x..." }) },
    bass: { notes: roll(bassNames, { C2: "x.......x......." }) },
    patterns: { B: { tracks: drums("x.......x.......", "................", "................"), notes: roll(melodyNames, { E4: "..x...x......." }), ties: {}, bass: { notes: roll(bassNames, { G1: "x...x...x...x..." }), ties: {} } } },
    chain: ["A", "B"],
  };
  const made = await api("POST", "/songs", { name: "QQ Fills", data: song });
  const id = made.j.id;
  const rowOn = (row) => p.evaluate((r) => [...document.querySelectorAll(`#song-sequencer .song-step[data-row="${r}"]`)].map((x) => (x.classList.contains("song-step-on") ? "x" : ".")).join(""), row);
  const rowNames = () => p.evaluate(() => [...document.querySelectorAll("#song-sequencer .song-track-label")].map((x) => x.textContent.trim()).join());
  const melodyOn = () => p.evaluate(() => { const out = {}; document.querySelectorAll("#song-piano-roll .song-steps").forEach((row) => { const on = [...row.children].map((x, i) => (x.classList.contains("song-step-on") ? i : -1)).filter((i) => i >= 0); if (on.length) out[row.dataset.row] = on.join(","); }); return Object.entries(out).sort().map(([n, s]) => `${n}:${s}`).join(" "); });
  const status = () => p.textContent("#song-pattern-status");
  try {
    await p.goto(E2E_BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.locator(`.edit-song[data-id="${id}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(900);
    await p.evaluate(() => { document.getElementById("song-generators").open = true; document.getElementById("song-melody-tools").open = true; });

    // ---- fills
    const options = await p.evaluate(() => [...document.querySelectorAll("#song-fill-style option")].map((o) => o.value));
    ok(options.length >= 5 && options[0] === "snare-roll", "the fill menu lists the fills", options);
    await p.selectOption("#song-fill-style", "snare-roll");
    await p.click("#song-fill-apply");
    ok((await rowOn("snare")) === "....x.......xxxx" && (await rowOn("kick")) === "x...x...x......." && (await rowOn("hihat")) === "x.x.x.x.x.x....." , "a snare roll fills the last beat, and clears the kick and hats there", [await rowOn("snare"), await rowOn("kick"), await rowOn("hihat")]);
    ok(/Snare roll added over steps 13 to 16/.test(await status()), "it says what it did", await status());
    ok((await p.evaluate(() => document.getElementById("song-undo").disabled)) === false, "it is an undo step");
    await p.click("#song-undo");
    ok((await rowOn("snare")) === "....x.......x..." && (await rowOn("kick")) === "x...x...x...x...", "Undo takes it away", [await rowOn("snare"), await rowOn("kick")]);
    // a fill that needs a tom adds the row
    ok(!(await rowNames()).includes("Tom"), "(no Tom row yet)");
    await p.selectOption("#song-fill-style", "tom-run");
    await p.click("#song-fill-apply");
    ok((await rowNames()).includes("Tom") && (await rowOn("tom")) === ".............xxx" && (await rowOn("snare")) === "....x.......x...", "a tom run adds the Tom row and plays three toms into the end", [await rowNames(), await rowOn("tom")]);
    await p.click("#song-undo");
    ok(!(await rowNames()).includes("Tom"), "Undo takes the Tom row back out too", await rowNames());
    // a stop
    await p.selectOption("#song-fill-style", "stop");
    await p.click("#song-fill-apply");
    ok((await rowOn("kick")) === "x...x...x..." + "...." && (await rowOn("snare")) === "....x......." + "...." && (await rowOn("hihat")) === "x.x.x.x.x.x." + "....", "a drop-out silences every row for the last beat", [await rowOn("kick"), await rowOn("snare"), await rowOn("hihat")]);
    await p.selectOption("#song-fill-style", "snare-build");
    await p.click("#song-fill-apply");
    ok((await rowOn("snare")) === "....x..." + "..x.xxxx" && (await rowOn("kick")) === "x...x...x...." + "...", "a build replaces the snare over the last half and keeps one kick to start it", [await rowOn("snare"), await rowOn("kick")]);
    // it ignores Apply to
    await p.selectOption("#song-pattern-target", "kick");
    await p.selectOption("#song-fill-style", "drive");
    await p.click("#song-fill-apply");
    ok((await rowOn("snare")).slice(8) === "....xxxx" && (await rowOn("kick")).slice(8) === "x.x.x.xx", "a fill touches every row it needs whatever Apply to says (here the kick only)", [await rowOn("snare"), await rowOn("kick")]);
    await p.selectOption("#song-pattern-target", "all");

    // ---- copy part of another pattern
    await p.click("#song-undo"); await p.click("#song-undo"); await p.click("#song-undo");
    ok((await rowOn("snare")) === "....x.......x...", "(back to the start with undo)", await rowOn("snare"));
    ok(!(await p.evaluate(() => document.getElementById("song-copy-tools").hidden)), "with two patterns the Copy tools are shown");
    const froms = await p.evaluate(() => [...document.querySelectorAll("#song-copy-from option")].map((o) => o.value).join());
    ok(froms === "B", "and offer only the other pattern", froms);
    await p.selectOption("#song-copy-what", "drums");
    await p.click("#song-copy-apply");
    ok((await rowOn("kick")) === "x.......x......." && (await rowOn("snare")) === "................" && (await melodyOn()) === "C4:0,4,8,12", "copying B's drums replaces the drums and leaves the melody alone", [await rowOn("kick"), await melodyOn()]);
    ok(/Pattern A now has pattern B's drums/.test(await p.textContent("#song-arrangement-note")), "and says so", await p.textContent("#song-arrangement-note"));
    await p.click("#song-undo");
    ok((await rowOn("kick")) === "x...x...x...x...", "Undo brings the old drums back");
    await p.selectOption("#song-copy-what", "melody");
    await p.click("#song-copy-apply");
    ok((await melodyOn()) === "E4:2,6" && (await rowOn("kick")) === "x...x...x...x...", "copying the melody replaces the melody and leaves the drums alone", [await melodyOn(), await rowOn("kick")]);
    await p.click("#song-undo");
    await p.selectOption("#song-copy-what", "bass");
    await p.click("#song-copy-apply");
    await p.click("#song-roll-bass");
    ok((await melodyOn()) === "G1:0,4,8,12", "copying the bass line puts B's bass notes in the open pattern", await melodyOn());
    await p.click("#song-roll-melody");
    ok((await melodyOn()) === "C4:0,4,8,12", "(the melody is still its own)", await melodyOn());
    await p.click("#song-undo");
    await p.selectOption("#song-copy-what", "all");
    await p.click("#song-copy-apply");
    ok((await rowOn("kick")) === "x.......x......." && (await melodyOn()) === "E4:2,6", "everything takes all three", [await rowOn("kick"), await melodyOn()]);
    // the other pattern is unchanged
    await p.click('#song-pattern-buttons [data-pattern="B"]');
    ok((await rowOn("kick")) === "x.......x......." && (await melodyOn()) === "E4:2,6", "pattern B itself is untouched", [await rowOn("kick"), await melodyOn()]);
    ok((await p.evaluate(() => [...document.querySelectorAll("#song-copy-from option")].map((o) => o.value).join())) === "A", "and in B the menu offers A");
    // with one pattern the tools are hidden
    await p.click("#song-pattern-remove");
    ok(await p.evaluate(() => document.getElementById("song-copy-tools").hidden), "with a single pattern left the Copy tools are hidden");
    await p.click("#song-undo");

    // ---- accessibility, a phone
    await p.addScriptTag({ content: axeSource() });
    for (const theme of ["dark", "light"]) {
      await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await p.waitForTimeout(300);
      const v = await p.evaluate(async () => (await axe.run(document.getElementById("song-builder-modal"), { runOnly: ["label", "select-name", "button-name", "color-contrast"], resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(",")));
      ok(v.length === 0, `${theme} theme: no accessibility findings with the fill and copy tools`, v);
    }
    await p.evaluate(() => document.documentElement.removeAttribute("data-theme"));
    await p.setViewportSize({ width: 390, height: 900 });
    await p.waitForTimeout(400);
    const phone = await p.evaluate(() => { const c = document.getElementById("song-copy-tools").getBoundingClientRect(); const bt = document.getElementById("song-copy-apply").getBoundingClientRect(); return { spill: document.documentElement.scrollWidth - document.documentElement.clientWidth, right: Math.round(c.right), h: Math.round(bt.height) }; });
    ok(phone.spill <= 0 && phone.right <= 392 && phone.h >= 24, "on a 390px phone the tools wrap and nothing spills", phone);
    ok(errs.length === 0, "no page errors", errs);
  } finally {
    await api("DELETE", "/songs/" + id);
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
