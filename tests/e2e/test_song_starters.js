// The built-in starter songs in the "new song" menu: they are listed, each one opens as a complete song (patterns, song order, bass line,
// settings), plays, saves, and Blank is still blank.
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
  const cleanUp = async () => { for (const s of ((await api("GET", "/songs")).j || []).filter((x) => String(x.name).startsWith("QQ"))) await api("DELETE", "/songs/" + s.id); };
  const buttons = () => p.evaluate(() => [...document.querySelectorAll("#song-pattern-buttons .song-pattern-btn")].map((x) => x.textContent).join(""));
  const chips = () => p.evaluate(() => [...document.querySelectorAll("#song-order-list .song-order-letter")].map((x) => x.textContent).join(""));
  try {
    await cleanUp();
    await p.goto(E2E_BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.waitForTimeout(600);

    // ---- the menu
    const menu = await p.evaluate(() => [...document.querySelectorAll("#song-template-picker optgroup")].map((g) => ({ label: g.label, options: [...g.children].map((o) => o.value + "=" + o.textContent) })));
    ok(menu.length >= 1 && menu[0].label === "Built-in starters" && menu[0].options.length === 4, "the menu has a Built-in starters group with four songs", menu);
    ok(menu[0].options.some((o) => o === "starter:lofi=Lo-fi loop") && menu[0].options.some((o) => o.startsWith("starter:house=")), "naming the Lo-fi loop and the house groove", menu[0].options);
    ok((await p.evaluate(() => document.querySelector('#song-template-picker option[value="starter:funk"]').title)).length > 20, "each has a one-line description as its tooltip");
    ok((await p.inputValue("#song-template-picker")) === "", "Blank is still the default");

    // ---- Blank stays blank
    await p.click("#new-song-btn");
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(700);
    ok((await buttons()) === "A" && (await p.inputValue("#song-name")) === "New song" && (await p.inputValue("#song-tempo")) === "120", "Blank opens an empty one-pattern song named New song", [await buttons(), await p.inputValue("#song-name")]);
    await p.click("#close-song-builder");
    await p.waitForSelector("#song-builder-modal", { state: "hidden" });

    // ---- each starter opens complete
    const expected = { lofi: { name: "Lo-fi loop", tempo: "80", patterns: "ABCD", order: "ABCD", melodyInA: true }, house: { name: "Four on the floor", tempo: "124", patterns: "ABCD", order: "AABBCDBB" }, funk: { name: "Funk groove", tempo: "102", patterns: "AB", order: "AABAAB" }, trap: { name: "Dark trap", tempo: "140", patterns: "ABC", order: "ABBCBB", melodyInA: true } };
    for (const [id, want] of Object.entries(expected)) {
      await p.selectOption("#song-template-picker", "starter:" + id);
      await p.click("#new-song-btn");
      await p.waitForSelector("#song-builder-modal:not([hidden])");
      await p.waitForTimeout(800);
      ok((await p.inputValue("#song-name")) === want.name && (await p.inputValue("#song-tempo")) === want.tempo, `${want.name}: opens with its name and ${want.tempo} BPM`, [await p.inputValue("#song-name"), await p.inputValue("#song-tempo")]);
      ok((await buttons()) === want.patterns && (await chips()) === want.order, `${want.name}: patterns ${want.patterns}, song order ${want.order}`, [await buttons(), await chips()]);
      ok((await p.textContent("#song-preview-position-label")) === `${want.order.length} bars`, `${want.name}: the bar counter says ${want.order.length} bars`, await p.textContent("#song-preview-position-label"));
      ok(await p.isChecked("#song-play-order"), `${want.name}: Play follows the song order`);
      await p.click("#song-roll-bass");
      const bassNotes = await p.evaluate(() => document.querySelectorAll("#song-piano-roll .song-step-on").length);
      ok(bassNotes > 3, `${want.name}: the Bass tab has a bass line`, bassNotes);
      await p.click("#song-roll-melody");
      const melodyOn = await p.evaluate(() => document.querySelectorAll("#song-piano-roll .song-step-on").length);
      ok(want.melodyInA ? melodyOn > 2 : melodyOn === 0, want.melodyInA ? `${want.name}: and the melody tab has a melody` : `${want.name}: pattern A has no melody yet (it comes in with B)`, melodyOn);
      ok((await p.evaluate(() => document.getElementById("song-undo").disabled)), `${want.name}: opening it is not an undo step`);
      await p.click("#close-song-builder");
      await p.waitForSelector("#song-builder-modal", { state: "hidden" });
      await p.waitForTimeout(250);
    }

    // ---- play one, save it, reopen it
    await p.selectOption("#song-template-picker", "starter:house");
    await p.click("#new-song-btn");
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(800);
    await p.click("#song-play");
    await p.waitForTimeout(2500);
    const label = await p.textContent("#song-preview-position-label");
    ok(/^Bar \d of 8 · Pattern [AB]$/.test(label), "it plays, and the counter follows the order", label);
    await p.click("#song-play");
    await p.fill("#song-name", "QQ Starter house");
    await p.click("#save-song");
    await p.waitForTimeout(1500);
    const saved = ((await api("GET", "/songs")).j || []).find((s) => s.name === "QQ Starter house");
    ok(!!saved, "it saves as a normal song");
    const data = saved && (await api("GET", "/songs/" + saved.id)).j.data;
    ok(data && data.chain.join("") === "AABBCDBB" && data.bass && data.bass.notes.A1.some(Boolean) && data.patterns.B && data.tracks.openhat, "with its patterns, song order, bass line and extra drum row stored", data && Object.keys(data));
    ok(data && data.private_notes && /Eight bars/.test(data.private_notes), "and its notes (private, never shown on the page)");
    ok(errs.length === 0, "no page errors", errs);

    // ---- accessibility of the menu in both themes
    await p.click("#close-song-builder");
    await p.waitForSelector("#song-builder-modal", { state: "hidden" });
    await p.addScriptTag({ content: axeSource() });
    for (const theme of ["dark", "light"]) {
      await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await p.waitForTimeout(300);
      const v = await p.evaluate(async () => (await axe.run(document.getElementById("songs-modal"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")));
      ok(v.length === 0, `${theme} theme: the Songs window has no accessibility findings`, v);
    }
  } finally {
    await cleanUp();
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
