// Moving a bar of the song order earlier or later with the buttons on its chip, and the [ and ] keys that open the previous / next pattern.
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
  const notes = {}; [4, 3].forEach((o) => { for (let i = 11; i >= 0; i--) notes[NAMES[i] + o] = Array(16).fill(false); });
  const part = (kick) => ({ tracks: { kick: lane(kick), snare: [], hihat: [], clap: [] }, notes, ties: {} });
  const song = { tempo: 120, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1, tracks: part("x...x...x...x...").tracks, trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} }, melody: { waveform: "sine", notes }, patterns: { B: part("x.......x......."), C: part("x...............") }, chain: ["A", "B", "C", "A"] };
  const made = await api("POST", "/songs", { name: "QQ Moves", data: song });
  const id = made.j.id;
  const chips = () => p.evaluate(() => [...document.querySelectorAll("#song-order-list .song-order-letter")].map((x) => x.textContent).join(""));
  const open = () => p.evaluate(() => document.querySelector("#song-pattern-buttons [aria-pressed=true]").textContent);
  const move = (index, dir) => p.click(`#song-order-list .song-order-move[data-index="${index}"][data-dir="${dir}"]`);
  const active = () => p.evaluate(() => { const a = document.activeElement; return a ? (a.className || a.tagName) + ":" + (a.dataset.index || "") + ":" + (a.dataset.dir || "") : null; });
  try {
    await p.goto(E2E_BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.locator(`.edit-song[data-id="${id}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(900);

    ok((await chips()) === "ABCA", "the song order starts as A B C A", await chips());
    const labels = await p.evaluate(() => [...document.querySelectorAll("#song-order-list .song-order-move")].map((x) => x.getAttribute("aria-label") + (x.disabled ? " [disabled]" : "")));
    ok(labels.length === 8 && labels[0] === "Move A at position 1 earlier [disabled]" && labels[1] === "Move A at position 1 later" && labels[7] === "Move A at position 4 later [disabled]", "every bar has Earlier and Later buttons with names, off at the ends", labels);
    // later
    await move(0, 1);
    ok((await chips()) === "BACA" && /A moved from position 1 to 2/.test(await p.textContent("#song-arrangement-note")), "Later swaps the bar with the next one, and says so", [await chips(), await p.textContent("#song-arrangement-note")]);
    ok((await active()) === "song-order-move:1:1", "focus stays on the moved bar's Later button", await active());
    await move(1, 1);
    ok((await chips()) === "BCAA", "moving the same bar again keeps going (B C A A)", await chips());
    await move(2, 1);
    ok((await chips()) === "BCAA" && (await active()) === "song-order-move:3:-1", "at the last place focus moves to the bar's Earlier button (Later is off)", [await chips(), await active()]);
    await move(1, -1);
    ok((await chips()) === "CBAA", "Earlier swaps with the previous bar (C B A A)", await chips());
    await p.click("#song-undo");
    ok((await chips()) === "BCAA", "Undo takes a move back one step", await chips());
    await p.click("#song-undo");
    ok((await chips()) === "BACA", "…and another", await chips());
    await p.click("#song-undo");
    ok((await chips()) === "ABCA", "…and the third returns to A B C A", await chips());
    await p.click("#song-redo");
    ok((await chips()) === "BACA", "Redo does the first move again", await chips());
    // the play order follows the new order
    ok((await p.textContent("#song-preview-position-label")) === "4 bars", "the bar counter still says 4 bars");
    await p.click("#save-song");
    await p.waitForTimeout(1300);
    const saved = (await api("GET", "/songs/" + id)).j.data;
    ok(saved.chain.join("") === "BACA", "Save stores the new order", saved.chain);

    // ---- [ and ]
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await p.keyboard.press("]");
    ok((await open()) === "B", "] opens the next pattern (A > B)", await open());
    await p.keyboard.press("]");
    ok((await open()) === "C", "…and again (B > C)", await open());
    await p.keyboard.press("]");
    ok((await open()) === "A", "…and wraps round to A", await open());
    await p.keyboard.press("[");
    ok((await open()) === "C", "[ goes back (A > C)", await open());
    ok((await p.evaluate(() => document.getElementById("song-undo").disabled)) === false, "(undo is still the earlier edits: switching pattern is not an edit)");
    // a text field keeps the keys
    await p.fill("#song-name", "QQ Moves [x]");
    ok((await p.inputValue("#song-name")) === "QQ Moves [x]" && (await open()) === "C", "typing [ or ] in a field types it and does not switch pattern", [await p.inputValue("#song-name"), await open()]);
    // a dialog on top keeps the keys
    await p.evaluate(() => document.getElementById("song-export-audio").click());
    await p.waitForSelector("#song-audio-modal:not([hidden])");
    await p.keyboard.press("]");
    ok((await open()) === "C", "with the export dialog open the keys do nothing to the song");
    await p.evaluate(() => document.getElementById("close-song-audio").click());
    await p.waitForTimeout(300);

    // ---- accessibility and a phone
    await p.addScriptTag({ content: axeSource() });
    for (const theme of ["dark", "light"]) {
      await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await p.waitForTimeout(300);
      const v = await p.evaluate(async () => (await axe.run(document.getElementById("song-arrangement"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(",")));
      ok(v.length === 0, `${theme} theme: the arrangement section has no accessibility findings`, v);
    }
    await p.evaluate(() => document.documentElement.removeAttribute("data-theme"));
    await p.setViewportSize({ width: 390, height: 900 });
    await p.waitForTimeout(400);
    const phone = await p.evaluate(() => { const d = document.getElementById("song-arrangement"); const m = document.querySelector(".song-order-move"); const r = m.getBoundingClientRect(); return { section: d.scrollWidth - d.clientWidth, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, w: Math.round(r.width), h: Math.round(r.height) }; });
    ok(phone.section <= 1 && phone.doc <= 0 && phone.w >= 24 && phone.h >= 24, "at 390px the chips wrap, nothing spills and the move buttons are touch-sized", phone);
    ok(errs.length === 0, "no page errors", errs);
  } finally {
    await api("DELETE", "/songs/" + id);
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
