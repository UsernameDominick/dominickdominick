// The bar counter on a song with a song order: on the public player ("3 bars" at rest, "Bar 2 of 3" while it plays, one segment per bar,
// nothing at all for a one-bar song) and in the builder's preview (the same, plus the pattern letter, gone when the order is one bar).
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
  const base = { tempo: 240, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1, tracks: { kick: lane("x...x...x...x..."), snare: [], hihat: [], clap: [] }, trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} }, melody: { waveform: "sine", notes } };
  const ordered = { ...base, patterns: { B: { tracks: { kick: lane("x.......x......."), snare: [], hihat: [], clap: [] }, notes, ties: {} } }, chain: ["A", "B", "A"] };
  const made = await api("POST", "/songs", { name: "QQ Counted", data: ordered });
  const plain = await api("POST", "/songs", { name: "QQ Single", data: base });
  const ids = [made.j.id, plain.j.id];
  let projectId = null;
  try {
    // ---- the public page
    const slug = "qq-position-" + Date.now();
    const proj = await api("POST", "/projects", { slug, title: "QQ position project", summary: "s", body: "A synthetic QQ body that is comfortably longer than fifty characters in total, for publishing.", published: true, related_songs: ids });
    projectId = proj.j && proj.j.id;
    const pubCtx = await b.newContext({ viewport: { width: 1200, height: 900 } });
    const pub = await pubCtx.newPage();
    const pubErrs = [];
    pub.on("pageerror", (e) => pubErrs.push(String(e)));
    await pub.goto(E2E_BASE + "/projects/" + slug, { waitUntil: "networkidle" });
    const embeds = pub.locator(".song-embed");
    ok((await embeds.count()) === 2, "the project shows both songs", await embeds.count());
    const counted = embeds.filter({ hasText: "QQ Counted" });
    const single = embeds.filter({ hasText: "QQ Single" });
    ok((await single.locator(".song-embed-position").count()) === 0, "a one-bar song has no counter");
    ok((await counted.locator(".song-embed-position").count()) === 1, "a song with a three-bar order has one");
    const label = counted.locator(".song-embed-position-label");
    const segs = counted.locator(".song-embed-position-strip > span");
    ok((await label.textContent()) === "3 bars" && (await segs.count()) === 3, "at rest it says 3 bars and has three segments", [await label.textContent(), await segs.count()]);
    ok((await counted.locator(".song-embed-position-strip").getAttribute("aria-hidden")) === "true", "the segments are decoration for the eye (hidden from screen readers)");
    ok((await counted.locator(".song-embed-position-label").getAttribute("aria-live")) === null, "the text is not a live region (it would be read out every bar)");
    const seen = new Set();
    const states = [];
    await counted.locator(".song-embed-play-btn").click();
    for (let i = 0; i < 30; i++) {
      await pub.waitForTimeout(150);
      const now = await counted.evaluate((el) => ({ text: el.querySelector(".song-embed-position-label").textContent, cls: [...el.querySelectorAll(".song-embed-position-strip > span")].map((s) => (s.classList.contains("is-now") ? "N" : s.classList.contains("is-done") ? "d" : ".")).join("") }));
      seen.add(now.text); states.push(now.cls);
    }
    ok(["Bar 1 of 3", "Bar 2 of 3", "Bar 3 of 3"].every((t) => seen.has(t)), "while it plays the label walks through Bar 1, 2 and 3 of 3", [...seen]);
    ok(states.every((s) => (s.match(/N/g) || []).length === 1) && states.includes("Ndd".replace(/d/g, ".")) && states.includes("dN.") && states.includes("ddN"), "exactly one segment is the current bar, the earlier ones are marked done", [...new Set(states)]);
    ok(states.every((s) => !/N.*d/.test(s)), "nothing after the current bar is marked done");
    await counted.locator(".song-embed-play-btn").click();
    await pub.waitForTimeout(200);
    ok((await label.textContent()) === "3 bars" && (await counted.locator(".is-now, .is-done").count()) === 0, "Stop puts it back to 3 bars with no segment marked");
    // phone width and accessibility, both themes
    await pub.addScriptTag({ content: axeSource() });
    for (const theme of ["dark", "light"]) {
      await pub.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await pub.waitForTimeout(300);
      const v = await pub.evaluate(async () => (await axe.run(document.querySelector(".song-embed"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")));
      ok(v.length === 0, `${theme} theme: the song player has no accessibility findings`, v);
    }
    await pub.setViewportSize({ width: 390, height: 800 });
    await pub.waitForTimeout(300);
    const phone = await pub.evaluate(() => { const e = [...document.querySelectorAll(".song-embed")].find((x) => x.textContent.includes("QQ Counted")); const r = e.querySelector(".song-embed-position").getBoundingClientRect(); return { spill: document.documentElement.scrollWidth - document.documentElement.clientWidth, right: Math.round(r.right), inside: r.right <= e.getBoundingClientRect().right + 0.5 }; });
    ok(phone.spill <= 0 && phone.inside, "on a 390px phone the counter stays inside the player", phone);
    ok(pubErrs.length === 0, "no errors on the public page", pubErrs);
    await pubCtx.close();

    // ---- the builder's preview
    await p.goto(E2E_BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.locator(`.edit-song[data-id="${ids[0]}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(900);
    const row = "#song-preview-position";
    const pLabel = () => p.textContent("#song-preview-position-label");
    ok(!(await p.evaluate((q) => document.querySelector(q).hidden, row)) && (await pLabel()) === "3 bars", "the preview shows 3 bars at rest", await pLabel());
    ok((await p.locator("#song-preview-position-strip > span").count()) === 3, "with three segments");
    await p.click("#song-play");
    const builderSeen = new Set();
    for (let i = 0; i < 30; i++) { await p.waitForTimeout(150); builderSeen.add(await pLabel()); }
    ok(["Bar 1 of 3 · Pattern A", "Bar 2 of 3 · Pattern B", "Bar 3 of 3 · Pattern A"].every((t) => builderSeen.has(t)), "while playing it names the bar and its pattern", [...builderSeen]);
    await p.click("#song-play");
    await p.waitForTimeout(250);
    ok((await pLabel()) === "3 bars", "Stop puts it back to 3 bars", await pLabel());
    // one bar left means nothing to count
    await p.click('#song-order-list .song-order-remove[data-index="2"]');
    ok((await pLabel()) === "2 bars" && (await p.locator("#song-preview-position-strip > span").count()) === 2, "taking a bar out of the order updates the count and the segments", [await pLabel(), await p.locator("#song-preview-position-strip > span").count()]);
    await p.click('#song-order-list .song-order-remove[data-index="1"]');
    ok(await p.evaluate((q) => document.querySelector(q).hidden, row), "with one bar left the counter is gone");
    await p.click("#song-undo");
    ok(!(await p.evaluate((q) => document.querySelector(q).hidden, row)) && (await pLabel()) === "2 bars", "Undo brings it back", await pLabel());
    await p.addScriptTag({ content: axeSource() });
    for (const theme of ["dark", "light"]) {
      await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await p.waitForTimeout(300);
      const v = await p.evaluate(async () => (await axe.run(document.getElementById("song-preview-embed"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")));
      ok(v.length === 0, `${theme} theme: the builder preview has no accessibility findings`, v);
    }
    ok(errs.length === 0, "no errors in the builder", errs);
  } finally {
    if (projectId) await api("DELETE", "/projects/" + projectId);
    for (const id of ids) await api("DELETE", "/songs/" + id);
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
