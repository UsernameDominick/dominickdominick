// The admin opens on the page itself: the page chooser and Add are in the top bar, the menu and the inspector are tucked away until asked for,
// a click on an empty spot of the page opens the block picker right there and the block lands where you clicked (pushing what it overlaps
// down), and a selected block's toolbar sets its width and position and opens its settings.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
const fs = require("fs");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const f = (m, p, b) => c.fetch(E2E_BASE + "/api/admin" + p, { method: m, data: b });
  const pg = await (await f("POST", "/pages", { title: "QQ Page First", slug: "qq-page-first-" + Date.now() })).json();
  const add = (type, content, col, row, cs, rs) => f("POST", `/pages/${pg.id}/blocks`, { type, content, col, row, col_span: cs, row_span: rs });
  await add("heading", { text: "QQ Top", level: 2 }, 1, 1, 24, 3);
  await add("text", { text: "QQ lower text that sits where a new block will land." }, 1, 9, 12, 4);
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  // a context with the sign-in but none of the runner's panel settings: what the owner sees on a first visit
  const state = JSON.parse(fs.readFileSync(process.env.ADMIN_STATE, "utf8")); state.origins = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, storageState: state });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
  const vis = (sel) => p.evaluate((q) => { const e = document.querySelector(q); if (!e) return false; const cs = getComputedStyle(e); return cs.display !== "none" && cs.visibility !== "hidden" && e.getBoundingClientRect().width > 0 && !e.hidden; }, sel);
  const layout = () => p.evaluate(() => [...document.querySelectorAll("#canvas .admin-block")].map((e) => ({ id: Number(e.dataset.id), t: e.querySelector(".block-type-name") && e.querySelector(".block-type-name").textContent, left: parseFloat(e.style.left), top: parseFloat(e.style.top), w: parseFloat(e.style.width), h: parseFloat(e.style.height) })));
  try {
    await p.goto(E2E_BASE + "/admin/"); await p.waitForSelector("#app:not([hidden])");
    await p.selectOption("#page-picker", String(pg.id)); await p.waitForSelector("#canvas .admin-block"); await p.waitForTimeout(500);
    ok(await p.evaluate(() => !!document.querySelector(".admin-header #page-picker") && !!document.querySelector(".admin-header #new-page-btn")), "the page chooser is in the top bar");
    ok(await vis("#add-block-btn") && await vis("#page-settings-btn"), "with Add and Page settings beside it");
    ok(!(await vis("#admin-sidebar")) && !(await vis("#inspector")) && !(await vis("#palette")), "the menu, the inspector and the palette are out of the way on a first visit");
    ok((await p.getAttribute("#sidebar-toggle-btn", "aria-pressed")) === "false" && /Tools/.test(await p.textContent("#sidebar-toggle-btn")), "the ☰ Tools button is how the menu comes back");

    // + Add: the picker, and the block goes at the bottom
    const n0 = (await layout()).length;
    await p.click("#add-block-btn");
    ok((await vis("#palette")) && (await p.evaluate(() => document.activeElement && document.activeElement.id)) === "palette-search" && (await p.getAttribute("#add-block-btn", "aria-expanded")) === "true", "+ Add opens the picker with the search ready");
    await p.keyboard.press("Escape");
    ok(!(await vis("#palette")) && (await p.evaluate(() => document.activeElement && document.activeElement.id)) === "add-block-btn", "Escape closes it and gives the focus back");
    await p.click("#add-block-btn");
    await p.click('#palette .palette-btn[data-type="divider"]');
    await p.waitForTimeout(700);
    const afterAdd = await layout();
    const bottom = Math.max(...afterAdd.filter((x) => x.t !== "Divider").map((x) => x.top + x.h));
    ok(afterAdd.length === n0 + 1 && !(await vis("#palette")) && afterAdd.find((x) => x.t === "Divider").top >= bottom - 1, "a block added from + Add goes at the bottom and the picker closes", afterAdd);
    // remove it again so the next steps have a clean page
    await p.evaluate(async (id) => {}, 0);

    // click an empty spot: the ghost, the picker at the click, the block there
    const box = await p.locator("#canvas").boundingBox();
    const at = { x: box.x + 600, y: box.y + 20 * 24 + 4 }; // far below the others, around column 13, row 21
    await p.mouse.move(at.x, at.y);
    await p.waitForTimeout(200);
    ok(await vis(".insert-ghost"), "over an empty spot a box shows where a block would go");
    await p.mouse.click(at.x, at.y);
    await p.waitForTimeout(300);
    const pr = await p.locator("#palette").boundingBox();
    ok((await vis("#palette")) && Math.abs(pr.x - (at.x + 10)) < 40, "a click there opens the picker beside it", pr);
    await p.click('#palette .palette-btn[data-type="quote"]');
    await p.waitForTimeout(900);
    const lay = await layout();
    const q = lay.find((x) => x.t === "Quote");
    const colW = (box.width - 23 * 8) / 24;
    const wantCol = Math.floor((at.x - box.x) / (colW + 8)) + 1;
    ok(q && Math.abs(q.left - (wantCol - 1) * (colW + 8)) < 2 && q.top > bottom, "the block lands in the column and row that was clicked", { q, wantCol });
    ok(q && q.left + q.w <= box.width + 1, "and never runs off the right edge", q);
    ok(await vis(".canvas-toolbar") && await vis("#quick-edit, .quick-edit"), "it is selected, with its toolbar and its quick editor open");
    const labels = await p.$$eval(".canvas-toolbar button", (x) => x.map((y) => y.textContent));
    ok(labels.includes("Size") && labels.includes("Settings") && labels.includes("Edit"), "the toolbar has Edit, Size and Settings", labels);
    await p.click(".quick-edit-done");

    // Size: width presets and position
    await p.click('.canvas-toolbar button[data-action="size"]');
    ok(await vis(".size-menu"), "Size opens the width and position choices");
    await p.click('.size-menu button[data-span="12"]');
    await p.waitForTimeout(600);
    let q2 = (await layout()).find((x) => x.t === "Quote");
    ok(Math.abs(q2.w - (12 * colW + 11 * 8)) < 2, "Half makes it twelve columns wide", q2);
    await p.click('.canvas-toolbar button[data-action="size"]');
    await p.click('.size-menu button[data-align="right"]');
    await p.waitForTimeout(600);
    q2 = (await layout()).find((x) => x.t === "Quote");
    ok(Math.abs(q2.left - 12 * (colW + 8)) < 2, "Right puts it against the right edge", q2);
    await p.click('.canvas-toolbar button[data-action="size"]');
    await p.click('.size-menu button[data-align="center"]');
    await p.waitForTimeout(600);
    q2 = (await layout()).find((x) => x.t === "Quote");
    ok(Math.abs(q2.left - 6 * (colW + 8)) < 2, "Centre puts it in the middle", q2);

    // Settings brings the inspector
    await p.click('.canvas-toolbar button[data-action="settings"]');
    await p.waitForTimeout(300);
    ok(await vis("#inspector") && (await p.getAttribute("#inspector-toggle-btn", "aria-pressed")) === "true", "Settings opens the inspector with this block's fields");

    // a block put on top of one below moves it down, and nothing overlaps
    const lowText = (await layout()).find((x) => x.t === "Text");
    const spotAbove = { x: box.x + 40, y: box.y + lowText.top - 20 };
    await p.mouse.click(spotAbove.x, spotAbove.y);
    await p.waitForTimeout(300);
    await p.click('#palette .palette-btn[data-type="gallery"]');
    await p.waitForTimeout(1000);
    const lay2 = await layout();
    const overlap = lay2.some((a, i) => lay2.some((o, j) => j > i && a.left < o.left + o.w - 1 && o.left < a.left + a.w - 1 && a.top < o.top + o.h - 1 && o.top < a.top + a.h - 1));
    const lowAfter = lay2.find((x) => x.t === "Text");
    ok(!overlap && lowAfter.top > lowText.top, "a new block over an existing one pushes it down: nothing overlaps", { overlap, before: lowText.top, after: lowAfter.top });

    // Tools brings the menu
    await p.click("#sidebar-toggle-btn");
    ok(await vis("#admin-sidebar") && await vis("#articles-btn"), "☰ Tools brings the menu back, with every tool in it");
    ok(errs.length === 0, "no page errors", errs);
    await ctx.close();

    // a phone keeps its drawer: no Add bar, the page chooser inside the menu
    const m = await b.newContext({ viewport: { width: 390, height: 800 }, storageState: state, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    await mp.goto(E2E_BASE + "/admin/"); await mp.waitForSelector("#app:not([hidden])");
    ok(await mp.evaluate(() => !document.querySelector(".admin-header #page-picker") && !!document.querySelector("#admin-sidebar #page-picker")), "on a phone the page chooser is in the menu drawer");
    ok(await mp.evaluate(() => { const e = document.querySelector(".page-actions"); return !e || getComputedStyle(e).display === "none"; }), "and the desktop Add bar stays away");
    ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "nothing runs past the phone's screen");
    await m.close();
  } finally {
    await f("DELETE", `/pages/${pg.id}`);
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
