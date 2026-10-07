// A hard sideways drag with the mouse on the page's own space moves to the tab beside it (and springs back when it is not pulled far
// enough); selecting text, and pressing on a link, are left alone.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    const p = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(E2E_BASE + "/");
    await p.waitForSelector(".tab.is-centred");
    await p.waitForTimeout(1500); // the neighbouring pages are fetched once the page has settled
    // a spot of the page that is its own space: the main area itself or a plain container
    const spot = await p.evaluate(() => {
      const main = document.getElementById("main-content");
      for (let y = 150; y < 780; y += 20) for (let x = 40; x < 1160; x += 40) {
        const el = document.elementFromPoint(x, y);
        if (el && main.contains(el) && !el.closest('a, button, img, svg, input, textarea, select, .tabs, .site-finder') && [...el.childNodes].every((n) => n.nodeType !== 3 || !n.textContent.trim())) return { x, y };
      }
      return null;
    });
    ok(!!spot, "there is a plain spot on the page to drag from", spot);
    if (spot) {
      const start = await p.evaluate(() => location.pathname);
      // a short pull springs back
      await p.mouse.move(spot.x + 100, spot.y); await p.mouse.down();
      for (let i = 1; i <= 8; i++) { await p.mouse.move(spot.x + 100 - i * 8, spot.y); await p.waitForTimeout(60); } // slowly: a quick short pull is a flick
      await p.mouse.up();
      await p.waitForTimeout(500);
      ok((await p.evaluate(() => location.pathname)) === start, "a short drag springs back and stays on the page");
      ok(await p.evaluate(() => !document.querySelector(".page-swipe") && !document.documentElement.classList.contains("is-page-dragging")), "and leaves nothing behind");
      // a long pull moves to the next tab
      await p.mouse.move(spot.x + 300, spot.y); await p.mouse.down();
      for (let i = 1; i <= 12; i++) await p.mouse.move(spot.x + 300 - i * 25, spot.y);
      await p.mouse.up();
      await p.waitForFunction((was) => location.pathname !== was, start, { timeout: 8000 }).catch(() => {});
      const now = await p.evaluate(() => location.pathname);
      const hrefs = await p.evaluate(() => [...document.querySelectorAll(".tabs > .tab")].map((a) => a.getAttribute("href")));
      ok(now !== start && hrefs.indexOf(now) === hrefs.indexOf(start) + 1, "a long drag to the left brings in the tab to its right", [start, now]);
      // and back with a drag to the right
      await p.waitForTimeout(1200);
      const spot2 = await p.evaluate(() => {
        const main = document.getElementById("main-content");
        for (let y = 150; y < 780; y += 20) for (let x = 40; x < 1160; x += 40) {
          const el = document.elementFromPoint(x, y);
          if (el && main.contains(el) && !el.closest('a, button, img, svg, input, textarea, select, .tabs, .site-finder, .app-native, canvas') && [...el.childNodes].every((n) => n.nodeType !== 3 || !n.textContent.trim())) return { x, y };
        }
        return null;
      });
      if (spot2 && !/studio|piceditor|simulations|scans|trainer/.test(now)) {
        await p.mouse.move(spot2.x - 100, spot2.y); await p.mouse.down();
        for (let i = 1; i <= 12; i++) await p.mouse.move(spot2.x - 100 + i * 25, spot2.y);
        await p.mouse.up();
        await p.waitForFunction((was) => location.pathname !== was, now, { timeout: 8000 }).catch(() => {});
        ok((await p.evaluate(() => location.pathname)) === start, "a long drag to the right goes back", await p.evaluate(() => location.pathname));
      }
    }
    // a link pressed and dragged is not a page drag
    const link = await p.evaluate(() => { const a = document.querySelector("#main-content a[href]"); if (!a) return null; const r = a.getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height / 2 }; });
    if (link) {
      const was = await p.evaluate(() => location.pathname);
      await p.goto(E2E_BASE + was);
      await p.waitForTimeout(1200);
      await p.mouse.move(link.x, link.y); await p.mouse.down();
      for (let i = 1; i <= 10; i++) await p.mouse.move(link.x - i * 30, link.y);
      await p.mouse.up();
      await p.waitForTimeout(500);
      ok((await p.evaluate(() => location.pathname)) === was, "dragging from a link does not turn the page");
    }
    ok(errs.length === 0, "no page errors", errs);
  } finally { await b.close(); }
  console.log(fail ? fail + " FAILED" : "ALL PASS");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
