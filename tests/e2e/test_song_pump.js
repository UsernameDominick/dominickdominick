// Pump in the song builder: the slider next to Echo, what is stored, undo, reopening, the report, and the House starter that uses it.
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
  const notes = {}; [4, 3].forEach((o) => { for (let i = 11; i >= 0; i--) notes[NAMES[i] + o] = Array(16).fill(false); });
  notes.C4 = lane("x...x...x...x...");
  const old = { tempo: 120, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1, tracks: { kick: lane("x...x...x...x..."), snare: [], hihat: [], clap: [] }, trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} }, melody: { waveform: "sine", notes } };
  const made = await api("POST", "/songs", { name: "QQ Pump", data: old });
  const id = made.j.id;
  const saved = async () => (await api("GET", "/songs/" + id)).j.data;
  const openIt = async () => {
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.locator(`.edit-song[data-id="${id}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(800);
  };
  try {
    await p.goto(E2E_BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await openIt();
    ok((await p.inputValue("#song-pump")) === "0" && (await p.getAttribute("#song-pump", "aria-valuetext")) === "Off", "an old song opens with Pump off");
    ok((await p.evaluate(() => document.querySelector("#song-pump").closest("label").textContent.trim())) === "Pump" && (await p.evaluate(() => document.querySelector("#song-pump").closest("label").title)).length > 20, "the slider is labelled Pump and explains itself");
    await p.fill("#song-pump", "60"); await p.dispatchEvent("#song-pump", "input");
    ok((await p.getAttribute("#song-pump", "aria-valuetext")) === "60% pump", "dragging it updates its spoken value", await p.getAttribute("#song-pump", "aria-valuetext"));
    // undo: one step for the drag
    const dbg = { undoDisabled: await p.evaluate(() => document.getElementById("song-undo").disabled) };
    await p.click("#song-undo");
    ok((await p.inputValue("#song-pump")) === "0" && (await p.getAttribute("#song-pump", "aria-valuetext")) === "Off", "Undo puts the slider back to 0", { ...dbg, after: await p.inputValue("#song-pump") });
    await p.click("#song-redo");
    ok((await p.inputValue("#song-pump")) === "60", "Redo brings 60 back", await p.inputValue("#song-pump"));
    await p.click("#save-song");
    await p.waitForTimeout(1300);
    ok((await saved()).pump === 60, "Save stores it", (await saved()).pump);
    // reopen
    await p.click("#close-song-builder"); await p.waitForTimeout(500);
    await openIt();
    ok((await p.inputValue("#song-pump")) === "60", "reopening shows 60", await p.inputValue("#song-pump"));
    // the report
    const [rep] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => document.getElementById("song-export-report").click())]);
    ok(/\nPump: 60%/.test(require("node:fs").readFileSync(await rep.path(), "utf8")), "the report lists Pump");
    // it plays: the preview's player keeps going with Pump on, with no errors
    await p.click("#song-play");
    await p.waitForTimeout(1500);
    await p.click("#song-play");
    // back to 0 removes the key
    await p.fill("#song-pump", "0"); await p.dispatchEvent("#song-pump", "input");
    await p.click("#save-song");
    await p.waitForTimeout(1300);
    ok(!("pump" in (await saved())), "setting it back to 0 stores no pump key at all", Object.keys(await saved()));
    // the house starter uses it
    await p.click("#close-song-builder"); await p.waitForTimeout(500);
    await p.selectOption("#song-template-picker", "starter:house");
    await p.click("#new-song-btn");
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(800);
    ok((await p.inputValue("#song-pump")) === "55", "the Four on the floor starter opens with Pump at 55", await p.inputValue("#song-pump"));
    await p.click("#close-song-builder");
    await p.waitForSelector("#song-builder-modal", { state: "hidden" });
    // accessibility and a phone
    await p.addScriptTag({ content: axeSource() });
    await p.evaluate(() => document.getElementById("songs-btn") && 0);
    await p.locator(`.edit-song[data-id="${id}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(600);
    for (const theme of ["dark", "light"]) {
      await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await p.waitForTimeout(300);
      const v = await p.evaluate(async () => (await axe.run(document.getElementById("song-builder-modal"), { runOnly: ["label", "select-name", "button-name", "color-contrast"], resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(",")));
      ok(v.length === 0, `${theme} theme: no accessibility findings with the Pump slider`, v);
    }
    await p.evaluate(() => document.documentElement.removeAttribute("data-theme"));
    await p.setViewportSize({ width: 390, height: 900 });
    await p.waitForTimeout(400);
    await p.click("#song-toolbar-more"); // on a phone the sound controls sit behind More
    await p.waitForTimeout(300);
    const phone = await p.evaluate(() => { const e = document.getElementById("song-pump").getBoundingClientRect(); return { spill: document.documentElement.scrollWidth - document.documentElement.clientWidth, right: Math.round(e.right), w: Math.round(e.width) }; });
    ok(phone.spill <= 0 && phone.right <= 392 && phone.w >= 40, "on a 390px phone the slider fits and is usable", phone);
    ok(errs.length === 0, "no page errors", errs);
  } finally {
    await api("DELETE", "/songs/" + id);
    for (const s of ((await api("GET", "/songs")).j || []).filter((x) => x.name === "Four on the floor")) await api("DELETE", "/songs/" + s.id);
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
