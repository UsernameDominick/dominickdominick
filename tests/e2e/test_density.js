const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const c = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const page = await c.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const apiJ = async (m, p, body) => { const r = await c.request.fetch(BASE + "/api/admin" + p, { method: m, headers: { "content-type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status(), j }; };
  const pg = await apiJ("POST", "/pages", { title: "QQ density", slug: "qq-density" });
  const blk = await apiJ("POST", `/pages/${pg.j.id}/blocks`, { type: "text", content: { text: "QQ density block" }, style: {}, col: 1, col_span: 24, row: 1, row_span: 1 });
  ok(pg.s < 300 && blk.s < 300, "test page and block created", [pg.s, blk.s]);
  await page.goto(`${BASE}/admin/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(1200);
  await page.evaluate(() => { try { localStorage.removeItem("admin-density"); } catch (e) {} });
  await page.reload(); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(800);
  const attr = () => page.evaluate(() => document.documentElement.getAttribute("data-density"));
  const pressed = () => page.$eval("#admin-density-toggle", (e) => e.getAttribute("aria-pressed"));
  const H = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e && e.offsetParent ? Math.round(e.getBoundingClientRect().height * 10) / 10 : null; }, sel);
  const measure = async () => {
    const m = {};
    m.sidebarItem = await H(".admin-sidebar-group button");
    m.sidebarTotal = await page.evaluate(() => document.querySelector(".admin-sidebar-scroll").scrollHeight);
    m.footer = await H(".admin-sidebar-footer");
    m.logout = await H("#logout-btn");
    return m;
  };
  ok((await attr()) === null && (await pressed()) === "false", "default is comfortable, button not pressed", [await attr(), await pressed()]);
  const before = await measure();
  // keyboard activation
  await page.focus("#admin-density-toggle"); await page.keyboard.press("Enter"); await page.waitForTimeout(200);
  ok((await attr()) === "compact" && (await pressed()) === "true", "Enter on the toggle turns compact on");
  ok((await page.evaluate(() => localStorage.getItem("admin-density"))) === "compact", "choice saved in this browser");
  const after = await measure();
  ok(after.sidebarItem < before.sidebarItem && after.sidebarItem >= 24, "sidebar items are shorter but still >= 24px", [before.sidebarItem, after.sidebarItem]);
  ok(after.sidebarTotal < before.sidebarTotal, "whole sidebar list is shorter", [before.sidebarTotal, after.sidebarTotal]);
  ok(after.footer < before.footer, "footer is tighter", [before.footer, after.footer]);
  ok(after.logout !== null && after.logout === before.logout || after.logout >= 24, "Log out still one line, >= 24px", [before.logout, after.logout]);
  // modals: settings
  const modalCheck = async (btn, modal, sels) => {
    const read = async () => { await page.click(btn); await page.waitForSelector(`${modal}:not([hidden])`); await page.waitForTimeout(600); const r = {}; for (const [k, s] of Object.entries(sels)) r[k] = await H(s); await page.keyboard.press("Escape"); await page.waitForTimeout(300); if (await page.$(`${modal}:not([hidden])`)) { await page.click(`${modal} header button`).catch(() => {}); } await page.waitForTimeout(300); return r; };
    return read;
  };
  // Settings: header + first field + total content height
  const settingsSels = { header: "#settings-modal header", field: "#settings-modal .settings-body input:not([type=checkbox]):not([type=color])", body: "#settings-modal .settings-body" };
  const hasSettingsModal = await page.$("#settings-modal");
  let sBefore = null, sAfter = null;
  if (hasSettingsModal) {
    const readSettings = async () => { await page.click("#site-settings-btn"); await page.waitForSelector("#settings-modal:not([hidden])"); await page.waitForTimeout(600); const r = { header: await H(settingsSels.header), field: await H(settingsSels.field), scroll: await page.evaluate(() => document.querySelector("#settings-modal .settings-body").scrollHeight) }; await page.keyboard.press("Escape"); await page.waitForTimeout(300); if (await page.$("#settings-modal:not([hidden])")) await page.click("#close-settings").catch(() => {}); await page.waitForTimeout(300); return r; };
    sAfter = await readSettings();
    await page.click("#admin-density-toggle"); await page.waitForTimeout(200);
    sBefore = await readSettings();
    await page.click("#admin-density-toggle"); await page.waitForTimeout(200);
    ok(sAfter.header < sBefore.header, "settings dialog header is tighter", [sBefore.header, sAfter.header]);
    ok(sAfter.field !== null && sAfter.field < sBefore.field && sAfter.field >= 24, "settings fields are shorter but >= 24px", [sBefore.field, sAfter.field]);
    ok(sAfter.scroll < sBefore.scroll, "settings tab content is shorter overall", [sBefore.scroll, sAfter.scroll]);
  }
  // Inspector: open the QQ page and select its block
  {
    await page.selectOption("#page-picker", String(pg.j.id)); await page.waitForTimeout(900);
    await page.click(`[data-id="${blk.j.id}"]`); await page.waitForTimeout(600);
    const insp = async () => ({ summary: await H(".admin-inspector .panel-section > summary"), field: await H(".admin-inspector input:not([type=checkbox]):not([type=color]):not([type=range])"), scroll: await page.evaluate(() => { const e = document.querySelector(".admin-inspector .drawer-scroll-content"); return e ? e.scrollHeight : null; }) });
    const iAfter = await insp();
    await page.click("#admin-density-toggle"); await page.waitForTimeout(200);
    const iBefore = await insp();
    await page.click("#admin-density-toggle"); await page.waitForTimeout(200);
    ok(!!(iBefore.summary && iAfter.summary), "inspector opened for the selected block", [iBefore, iAfter]);
    if (iBefore.summary && iAfter.summary) ok(iAfter.summary < iBefore.summary && iAfter.summary >= 24, "inspector section headers are tighter but >= 24px", [iBefore.summary, iAfter.summary]);
    if (iBefore.field && iAfter.field) ok(iAfter.field < iBefore.field && iAfter.field >= 24, "inspector fields are shorter but >= 24px", [iBefore.field, iAfter.field]);
    if (iBefore.scroll && iAfter.scroll) ok(iAfter.scroll < iBefore.scroll, "whole inspector is shorter", [iBefore.scroll, iAfter.scroll]);
    // color swatches keep their own size
    const sw = async () => page.evaluate(() => { const e = document.querySelector('.admin-inspector input[type="color"]'); return e && e.offsetParent ? [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)] : null; });
    const swAfter = await sw(); await page.click("#admin-density-toggle"); await page.waitForTimeout(200); const swBefore = await sw(); await page.click("#admin-density-toggle"); await page.waitForTimeout(200);
    if (swBefore) ok(JSON.stringify(swBefore) === JSON.stringify(swAfter), "colour swatches keep their size", [swBefore, swAfter]);
  }
  // Palette strip must not bleed past the drawer (it scrolled the palette sideways in compact)
  {
    const pal = () => page.evaluate(() => { const sc = document.querySelector("#palette .drawer-scroll-content"); const strip = document.querySelector("#palette .seg-control.panel-switch"); if (!sc || !strip) return null; const a = sc.getBoundingClientRect(), r = strip.getBoundingClientRect(); return { over: sc.scrollWidth - sc.clientWidth, stripTop: Math.round(r.top - a.top), stripLeft: Math.round(r.left - a.left), stripRight: Math.round(a.right - r.right) }; });
    const pc = await pal();
    ok(pc && pc.over <= 0 && pc.stripTop === 0 && pc.stripLeft === 0 && pc.stripRight <= 0 + 0, "compact: the Blocks/Page strip fits the palette exactly (no sideways scroll)", pc);
    await page.click("#admin-density-toggle"); await page.waitForTimeout(200);
    const pf = await pal();
    ok(pf && pf.over <= 0 && pf.stripTop === 0 && pf.stripLeft === 0, "comfortable: same", pf);
    await page.click("#admin-density-toggle"); await page.waitForTimeout(200);
  }
  // Footer toggles stay square; pressed state is visible
  {
    const box = (id) => page.$eval(id, (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    const col = (id) => page.$eval(id, (e) => getComputedStyle(e).color + "|" + getComputedStyle(e).borderTopColor);
    const tC = await box("#admin-theme-toggle"), dC = await box("#admin-density-toggle"), cOn = await col("#admin-density-toggle");
    await page.click("#admin-density-toggle"); await page.waitForTimeout(200);
    const tF = await box("#admin-theme-toggle"), dF = await box("#admin-density-toggle"), cOff = await col("#admin-density-toggle");
    await page.click("#admin-density-toggle"); await page.waitForTimeout(200);
    ok(dC[0] >= 34 && dC[0] === tC[0], "compact: the density toggle is as wide as the theme toggle", [tC, dC]);
    ok(dF[0] === tF[0], "comfortable: the two toggles are the same width", [tF, dF]);
    ok(cOn !== cOff, "the pressed state is visibly different (accent colour)", [cOn, cOff]);
  }
  // Persistence across reload, no flash (state here: compact)
  await page.reload({ waitUntil: "domcontentloaded" });
  ok((await attr()) === "compact", "compact is already applied at DOMContentLoaded after a reload (no flash)", await attr());
  await page.waitForSelector("#app:not([hidden])");
  ok((await pressed()) === "true", "button shows pressed after reload", await pressed());
  await page.click("#admin-density-toggle");
  await page.reload({ waitUntil: "domcontentloaded" });
  ok((await attr()) === null, "switching back to comfortable persists through a reload", await attr());
  await page.waitForSelector("#app:not([hidden])");
  ok((await pressed()) === "false", "button shows not pressed after reload", await pressed());
  await page.click("#admin-density-toggle"); await page.waitForTimeout(200);
  // Theme independence and narrow widths
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(100);
    ok((await attr()) === "compact", `still compact under the ${theme} theme`);
  }
  for (const w of [390, 768]) {
    await page.setViewportSize({ width: w, height: 800 }); await page.waitForTimeout(300);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ov <= 0, `no horizontal page overflow at ${w}px in compact`, ov);
  }
  {
    await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(300);
    await page.click("#site-menu-btn"); await page.waitForTimeout(400);
    const openNow = () => page.evaluate(() => document.getElementById("admin-sidebar").classList.contains("drawer-open"));
    ok(await openNow(), "mobile sidebar drawer opened");
    await page.click("#admin-density-toggle"); await page.waitForTimeout(300);
    ok(await openNow(), "tapping the density toggle keeps the mobile drawer open", await openNow());
    await page.click("#admin-theme-toggle"); await page.waitForTimeout(300);
    ok(await openNow(), "tapping the theme toggle keeps it open too", await openNow());
    await page.click("#admin-theme-toggle"); await page.waitForTimeout(200);
    await page.click("#admin-density-toggle"); await page.waitForTimeout(200); // back to whatever it was before
    await page.click("#close-site-menu").catch(() => {}); await page.waitForTimeout(300);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // Back to comfortable restores the original measurements exactly
  await page.click("#admin-density-toggle"); await page.waitForTimeout(200);
  const restored = await measure();
  ok(JSON.stringify(restored) === JSON.stringify(before), "comfortable is pixel-identical to before", [before, restored]);
  ok(errs.length === 0, "no page errors", errs);
  await page.evaluate(() => { try { localStorage.removeItem("admin-density"); } catch (e) {} });
  await apiJ("DELETE", `/pages/${pg.j.id}`); await apiJ("DELETE", `/pages/${pg.j.id}/permanent`);
  await b.close(); console.log(f ? "FAILURES " + f : "ALL PASS");
})();
