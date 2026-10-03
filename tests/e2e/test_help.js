const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const c = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const page = await c.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message)); page.on("dialog", (d) => { errs.push("DIALOG " + d.message()); d.dismiss(); });
  const api = async (m, p, body) => { const r = await c.request.fetch(BASE + "/api/admin" + p, { method: m, headers: { "content-type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status(), j }; };
  const scan = await api("POST", "/scans", { name: "QQ help scan", glb_key: (await require("./scanfix.js").uploadGlb()) });
  await page.goto(`${BASE}/admin/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(1000);
  const check = async (name, openFn, editorId, closeId, expectText) => {
    await openFn(); await page.waitForSelector(`#${editorId}:not([hidden])`, { timeout: 6000 }); await page.waitForTimeout(500);
    const btn = page.locator(`#${editorId} .editor-help-btn`); ok((await btn.count()) === 1, `${name}: a ? button is in the editor header`);
    ok((await btn.getAttribute("aria-label")).startsWith("Help for"), `${name}: it has an accessible name`);
    for (const w of [1440, 768, 390]) {
      await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(200);
      const g = await page.evaluate((id) => { const m = document.getElementById(id); const h = m.querySelector(".editor-help-btn").getBoundingClientRect(); const x = m.querySelector(".editor-header-end button:last-child").getBoundingClientRect(); return { gap: Math.round(x.left - h.right), top: Math.round(h.top), w: Math.round(h.width), hgt: Math.round(h.height), sameRow: Math.abs(h.top - x.top) < 6 }; }, editorId);
      if (editorId === "scan-editor-modal") { const pos = await page.evaluate(() => { const m = document.getElementById("scan-editor-modal"); const x = m.querySelector("#close-scan-editor").getBoundingClientRect(); const save = m.querySelector("#save-scan-btn").getBoundingClientRect(); return { closeRight: Math.round(x.right), saveRight: Math.round(save.right), closeAfterSave: x.left > save.left || Math.abs(x.top - save.top) > 6 }; }); ok(pos.closeAfterSave, `scan editor: the × stays after Save at ${w}px`, pos); }
      ok(g.gap >= 0 && g.gap <= 16 && g.sameRow && g.top < 160 && g.w >= 24 && g.hgt >= 24, `${name}: ? sits beside the × at ${w}px`, g);
    }
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(200);
    await btn.click(); await page.waitForTimeout(200);
    const shown = await page.evaluate(() => !document.getElementById("editor-help-modal").hidden);
    const title = await page.textContent("#editor-help-title"); const body = await page.textContent("#editor-help-body");
    ok(shown && expectText.test(title) && body.length > 80, `${name}: help opens with its own content`, [title, body.length]);
    const visible = await page.evaluate(() => { const r = document.querySelector("#editor-help-modal .modal-inner").getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + 40); return !!e && !!e.closest("#editor-help-modal"); });
    ok(visible, `${name}: the help dialog sits above the editor`);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === "close-editor-help"), `${name}: focus moves into the dialog`);
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    ok(await page.evaluate((id) => document.getElementById("editor-help-modal").hidden && !document.getElementById(id).hidden, editorId), `${name}: Escape closes only the help, the editor stays open`);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("editor-help-btn")), `${name}: focus returns to the ? button`);
    await btn.click(); await page.waitForTimeout(150);
    await page.mouse.click(8, 8); await page.waitForTimeout(250);
    ok(await page.evaluate((id) => document.getElementById("editor-help-modal").hidden && !document.getElementById(id).hidden, editorId), `${name}: clicking the help backdrop closes only the help, never the editor`);
    await btn.click(); await page.waitForTimeout(150);
    await page.keyboard.press("Control+k"); await page.waitForTimeout(250);
    await page.keyboard.type("help"); await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.getElementById("editor-help-modal").hidden && !document.getElementById("command-modal").hidden && document.getElementById("command-input").value === "help"), `${name}: Ctrl+K while help is open closes it and the palette takes typing`);
    await page.keyboard.press("Escape"); await page.waitForTimeout(150);
    await btn.click(); await page.click("#close-editor-help"); ok(await page.evaluate(() => document.getElementById("editor-help-modal").hidden), `${name}: the × closes it`);
    await page.click(`#${closeId}`).catch(() => {}); await page.waitForTimeout(400);
    if (await page.$("#pe-discard-modal:not([hidden])")) await page.keyboard.press("Escape");
  };
  await check("Photo editor", async () => { await page.click("#media-btn"); await page.waitForSelector("#media-modal:not([hidden])"); await page.waitForTimeout(800); await page.locator("#media-grid .media-edit").first().click({ force: true }); }, "photo-editor-modal", "close-photo-editor", /Photo editor/);
  await page.click("#close-media").catch(() => {});
  await check("Song builder", async () => { await page.click("#songs-btn"); await page.waitForSelector("#songs-modal:not([hidden])"); await page.waitForTimeout(500); await page.locator("#songs-modal button", { hasText: /^Edit$/ }).first().click(); }, "song-builder-modal", "close-song-builder", /Song builder/);
  await page.click("#close-songs").catch(() => {});
  await check("Simulation builder", async () => { await page.click("#simulations-btn"); await page.waitForSelector("#simulations-modal:not([hidden])"); await page.waitForTimeout(500); await page.locator("#simulations-modal button", { hasText: /^Edit$/ }).first().click(); }, "simulation-builder-modal", "close-simulation-builder", /Simulation builder/);
  await page.click("#close-simulations").catch(() => {});
  if (scan.j && scan.j.id) {
    await page.goto(`${BASE}/admin/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(800);
    await check("3D scan editor", async () => { await page.click("#scans-btn"); await page.waitForSelector("#scans-modal:not([hidden])"); await page.waitForTimeout(500); await page.locator(`#scans-list .edit-scan[data-id="${scan.j.id}"]`).click(); }, "scan-editor-modal", "close-scan-editor", /3D scan/);
  }
  await page.click("#close-scans").catch(() => {});
  // palette entry appears only while an editor is open, and opens the right help
  await page.click("#songs-btn"); await page.waitForSelector("#songs-modal:not([hidden])"); await page.waitForTimeout(400);
  const labelsNow = async () => { await page.keyboard.press("Control+k"); await page.waitForSelector("#command-modal:not([hidden])"); await page.fill("#command-input", "help"); await page.waitForTimeout(250); return page.$$eval("#command-results .command-result span:first-child", (e) => e.map((x) => x.textContent)); };
  ok(!(await labelsNow()).includes("Help for this editor"), "no editor-help palette entry while no editor is open"); await page.keyboard.press("Escape");
  await page.locator("#songs-modal button", { hasText: /^Edit$/ }).first().click(); await page.waitForSelector("#song-builder-modal:not([hidden])"); await page.waitForTimeout(500);
  const l = await labelsNow(); ok(l[0] === "Help for this editor", "the palette offers Help for this editor first while the song builder is open", l.slice(0, 2));
  await page.locator("#command-results .command-result").first().click(); await page.waitForTimeout(300);
  ok(/Song builder/.test(await page.textContent("#editor-help-title")), "…and it opens the Song builder help");
  await page.click("#close-editor-help");
  await page.setViewportSize({ width: 390, height: 800 }); await page.locator("#song-builder-modal .editor-help-btn").click(); await page.waitForTimeout(200);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); const inView = await page.evaluate(() => { const r = document.querySelector("#editor-help-modal .modal-inner").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
  ok(ov <= 0 && inView, "help fits a 390px screen", [ov, inView]);
  ok(errs.length === 0, "no page errors or dialogs", errs);
  if (scan.j && scan.j.id) await api("DELETE", `/scans/${scan.j.id}`);
  await b.close(); console.log(f ? "FAILURES " + f : "ALL PASS");
})();
