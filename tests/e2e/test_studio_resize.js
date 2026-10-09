// Resizing the playlist: each track's row is dragged taller or shorter by the grip along the bottom of its name cell (keys do it too, a double click puts it
// back, the choice is kept), and on a wide screen the playlist's right edge is dragged to make it narrower, the edge being pulled onto the width of the box
// below it. Also the slim nav: the Studio and the search sit side by side, centred as a pair, in a bar that is no taller than 50px.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    const mk = async (viewport) => {
      const ctx = await b.newContext({ viewport });
      await ctx.addInitScript(() => { try { localStorage.setItem("studioTipSeen", "1"); } catch (e) { /* none */ } });
      const p = await ctx.newPage();
      p.errs = []; p.on("pageerror", (e) => p.errs.push(e.message)); p.on("dialog", (d) => d.accept());
      await p.goto(E2E_BASE + "/studio");
      await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card-main", { timeout: 30000 });
      await p.waitForTimeout(700);
      return p;
    };
    const rowH = (p, id) => p.evaluate((t) => Math.round(document.querySelector(`#studio-stack [data-card="${t}"]`).getBoundingClientRect().height), id);
    const box = (p, sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
    const drag = async (p, from, to, steps = 8, alt = false) => {
      await p.mouse.move(from.x, from.y);
      await p.mouse.down();
      if (alt) await p.keyboard.down("Alt");
      await p.mouse.move(to.x, to.y, { steps });
      await p.mouse.up();
      if (alt) await p.keyboard.up("Alt");
      await p.waitForTimeout(150);
    };

    // ======== the nav ========
    const p = await mk({ width: 1440, height: 900 });
    const nav = await p.evaluate(() => {
      const n = document.querySelector(".site-nav").getBoundingClientRect();
      const tabs = [...document.querySelectorAll(".tabs > .tab")].map((t) => { const r = t.getBoundingClientRect(); return { cx: r.left + r.width / 2, w: r.width }; });
      return { h: Math.round(document.querySelector(".topbar").getBoundingClientRect().height), mid: n.left + n.width / 2, tabs, lit: [...document.querySelectorAll(".tabs > .tab.is-centred")].length };
    });
    ok(nav.tabs.length === 2 && nav.h <= 50, "the nav is two stops in a bar no taller than 50px", { n: nav.tabs.length, h: nav.h });
    ok(nav.tabs.length === 2 && Math.abs((nav.tabs[0].cx + nav.tabs[1].cx) / 2 - nav.mid) <= 2, "and the pair is centred, not pushed to one side", nav);
    ok(nav.lit === 1 && (await p.locator(".tabs > .tab.is-centred").getAttribute("href")) === "/studio", "the Studio is the lit stop");
    ok(nav.tabs.length === 2 && nav.tabs[1].cx - nav.tabs[0].cx <= 140, "the stops sit close together", nav.tabs);

    // ======== a row's height ========
    const base = await rowH(p, "bass");
    const grip = await box(p, '#studio-stack [data-grip="bass"]');
    ok(grip.w > 40 && grip.h >= 6, "each row has a grip along the bottom of its name cell", grip);
    const gy = grip.y + grip.h / 2; const gx = grip.x + grip.w / 2;
    await drag(p, { x: gx, y: gy }, { x: gx, y: gy + 40 });
    const taller = await rowH(p, "bass");
    ok(taller >= base + 30, "dragging the grip down makes the row taller", { base, taller });
    ok((await rowH(p, "drums")) <= base + 4, "and only that row", await rowH(p, "drums"));
    ok(await p.evaluate(() => (localStorage.getItem("studioRowH") || "").includes("bass")), "the height is kept in this browser");
    await p.reload();
    await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card-main", { timeout: 30000 });
    await p.waitForTimeout(700);
    ok(Math.abs((await rowH(p, "bass")) - taller) <= 2, "and is still there after a reload", await rowH(p, "bass"));
    // a drag with Alt held is not pulled onto the heights of the other rows
    let g2 = await box(p, '#studio-stack [data-grip="bass"]');
    await drag(p, { x: g2.x + g2.w / 2, y: g2.y + g2.h / 2 }, { x: g2.x + g2.w / 2, y: g2.y + g2.h / 2 + 7 }, 6, true);
    ok((await rowH(p, "bass")) >= taller + 5, "dragging by hand with Alt held is not pulled anywhere", await rowH(p, "bass"));
    // keys
    await p.focus('#studio-stack [data-grip="bass"]');
    const before = await rowH(p, "bass");
    await p.keyboard.press("ArrowDown");
    ok((await rowH(p, "bass")) >= before + 4, "the arrow keys change it too");
    await p.keyboard.press("Enter");
    ok(Math.abs((await rowH(p, "bass")) - base) <= 2 && !(await p.evaluate(() => (localStorage.getItem("studioRowH") || "").includes("bass"))), "and Enter puts it back to automatic");
    // double click
    g2 = await box(p, '#studio-stack [data-grip="bass"]');
    await drag(p, { x: g2.x + g2.w / 2, y: g2.y + g2.h / 2 }, { x: g2.x + g2.w / 2, y: g2.y + g2.h / 2 + 30 });
    ok((await rowH(p, "bass")) > base + 20, "(taller again)");
    g2 = await box(p, '#studio-stack [data-grip="bass"]');
    await p.mouse.dblclick(g2.x + g2.w / 2, g2.y + g2.h / 2);
    await p.waitForTimeout(150);
    ok(Math.abs((await rowH(p, "bass")) - base) <= 2, "a double click on the grip puts it back too", await rowH(p, "bass"));
    // clicking a grip does not take the editor to that track
    const frontBefore = await p.evaluate(() => document.querySelector('#studio-stack .studio-card[data-pos="front"]').dataset.card);
    g2 = await box(p, '#studio-stack [data-grip="lead"]');
    await p.mouse.click(g2.x + g2.w / 2, g2.y + g2.h / 2);
    ok((await p.evaluate(() => document.querySelector('#studio-stack .studio-card[data-pos="front"]').dataset.card)) === frontBefore, "pressing a grip without dragging does not open that track");

    // ======== the playlist's width ========
    const hs = await box(p, "#studio-hsplit");
    const full = await p.evaluate(() => Math.round(document.getElementById("studio-detail").getBoundingClientRect().width));
    const w0 = (await box(p, "#studio-stack")).w;
    ok(hs.h > 40 && Math.abs(w0 - full) <= 2, "on a wide screen the playlist is as wide as the box below it, with a handle on its right edge", { hs, w0, full });
    await drag(p, { x: hs.x + hs.w / 2, y: hs.y + hs.h / 2 }, { x: hs.x + hs.w / 2 - 200, y: hs.y + hs.h / 2 });
    const w1 = (await box(p, "#studio-stack")).w;
    ok(w1 <= w0 - 150 && w1 >= 300, "dragging it left makes the playlist narrower", { w0, w1 });
    ok(Math.abs((await box(p, "#studio-detail")).w - full) <= 2, "the box below does not change");
    ok(await p.evaluate(() => (localStorage.getItem("studioStackW") || "") !== ""), "the width is kept");
    // back towards the full width: within the pull it lands exactly on the width of the box below
    let h2 = await box(p, "#studio-hsplit");
    await drag(p, { x: h2.x + h2.w / 2, y: h2.y + h2.h / 2 }, { x: h2.x + h2.w / 2 + (full - w1) - 6, y: h2.y + h2.h / 2 }, 10);
    const w2 = (await box(p, "#studio-stack")).w;
    ok(Math.abs(w2 - full) <= 2 && (await p.evaluate(() => (localStorage.getItem("studioStackW") || "") === "")), "near the width of the box below it is pulled onto it (and goes back to automatic)", { w2, full });
    // keys
    await p.focus("#studio-hsplit");
    await p.keyboard.press("ArrowLeft");
    ok((await box(p, "#studio-stack")).w <= full - 20, "the arrow keys narrow it");
    await p.keyboard.press("Enter");
    ok(Math.abs((await box(p, "#studio-stack")).w - full) <= 2, "and Enter puts it back as wide as the box below");

    // ======== a phone: no width handle, rows still resize ========
    const ph = await mk({ width: 390, height: 800 });
    ok(!(await ph.locator("#studio-hsplit").isVisible()), "on a phone the playlist is the full width and has no width handle");
    const pb = await ph.evaluate(() => { const g = document.querySelector('#studio-stack [data-grip="drums"]'); const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height }; });
    ok(pb.h >= 6, "rows have their grip there too", pb);
    const pn = await ph.evaluate(() => { const n = document.querySelector(".topbar").getBoundingClientRect(); return Math.round(n.height); });
    ok(pn <= 52, "and the nav is slim", pn);

    ok(p.errs.length === 0 && ph.errs.length === 0, "no page errors", [...p.errs, ...ph.errs]);
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
