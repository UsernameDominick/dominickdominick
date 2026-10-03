const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const c = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const page = await c.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message)); page.on("dialog", (d) => { errs.push("DIALOG " + d.message()); d.dismiss(); });
  await page.goto(`${BASE}/admin/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(1200);
  await page.evaluate(() => { try { localStorage.removeItem("admin-density"); } catch (e) {} });
  const labels = async (q) => { await page.keyboard.press("Control+k"); await page.waitForSelector("#command-modal:not([hidden])"); await page.fill("#command-input", q).catch(async () => { await page.keyboard.type(q); }); await page.waitForTimeout(250); return page.$$eval("#command-results .command-result span:first-child", (els) => els.map((e) => e.textContent)); };
  const run = async (q, exact) => { const l = await labels(q); const i = exact ? l.findIndex((x) => x.includes(exact)) : 0; if (i < 0) return false; await page.locator("#command-results .command-result").nth(i).click(); await page.waitForTimeout(400); return true; };
  // presence
  for (const [q, want] of [["theme", "light / dark"], ["density", "switch to compact"], ["focus", "Focus mode"], ["content-only", "Content-only"], ["draft preview", "draft preview"], ["screen preview", "Screen Preview"], ["site health", "Run all Site Health"], ["log out", "Log out (signs out every device)"]]) {
    const l = await labels(q); ok(l.some((x) => x.includes(want)), `palette finds "${q}"`, l.slice(0, 3));
    await page.keyboard.press("Escape");
  }
  // ranking: a command that names the query leads the settings matches
  for (const [q, want] of [["theme", "light / dark"], ["dark mode", "light / dark"], ["logout", "Log out"], ["sign out", "Log out"], ["compact", "Interface density"], ["health", "Site Health"]]) {
    const l = await labels(q); ok(l.length && l[0].includes(want), `"${q}" puts the matching command first`, l.slice(0, 2)); await page.keyboard.press("Escape");
  }
  // short or partial queries don't get hijacked
  for (const [q, notFirst] of [["a", "Interface density"], ["l", "light / dark"], ["s", "Site Health"], ["mode", "light / dark"], ["log", "Log out"]]) {
    const l = await labels(q); ok(l.length && !l[0].includes(notFirst), `"${q}" doesn't lead with ${notFirst}`, l.slice(0, 2)); await page.keyboard.press("Escape");
  }
  ok((await labels("log"))[0].startsWith("Setting:"), '"log" still means the logs first'); await page.keyboard.press("Escape");
  // logout asks first, and cancelling keeps the session
  let asked = 0; let logoutCalls = 0;
  await page.route("**/api/admin/logout", (r) => { logoutCalls++; r.fulfill({ status: 200, body: "{}" }); });
  page.removeAllListeners("dialog"); page.on("dialog", (d) => { asked++; d.dismiss(); });
  await run("logout", "Log out");
  ok(asked === 1 && logoutCalls === 0 && (await page.evaluate(() => !document.getElementById("app").hidden)), "Log out asks for confirmation and cancelling does nothing", [asked, logoutCalls]);
  page.removeAllListeners("dialog"); page.on("dialog", (d) => { errs.push("DIALOG " + d.message()); d.dismiss(); });
  await page.unroute("**/api/admin/logout");
  // effects
  const t0 = await page.evaluate(() => document.documentElement.getAttribute("data-theme") || "dark");
  await run("theme", "light / dark");
  ok((await page.evaluate(() => document.documentElement.getAttribute("data-theme") || "dark")) !== t0, "theme action flips the admin theme");
  await run("theme", "light / dark");
  await run("density", "switch to compact");
  ok((await page.evaluate(() => document.documentElement.getAttribute("data-density"))) === "compact", "density action turns compact on");
  const l2 = await labels("density"); ok(l2.some((x) => x.includes("switch to comfortable")), "…and the entry then offers comfortable", l2); await page.keyboard.press("Escape");
  await run("density", "switch to comfortable");
  ok((await page.evaluate(() => document.documentElement.getAttribute("data-density"))) === null, "…which turns it back off");
  await run("focus", "Focus mode");
  ok(await page.evaluate(() => document.getElementById("app").classList.contains("focus-mode")), "focus action enters Focus mode");
  await run("focus", "Focus mode");
  ok(!(await page.evaluate(() => document.getElementById("app").classList.contains("focus-mode"))), "…and leaves it again");
  await run("site health", "Run all Site Health");
  await page.waitForFunction(() => { const b = document.getElementById("run-site-health-btn"); return b && !b.disabled; }, null, { timeout: 30000 }).catch(() => {});
  ok(await page.evaluate(() => !document.getElementById("seo-dashboard-modal").hidden && document.getElementById("site-health-summary").textContent.length > 0), "Site Health opens and runs the checks", await page.textContent("#site-health-summary"));
  await page.click("#close-seo-dashboard");
  // settings search entries
  await run("backfill", "Backfill image dimensions");
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => !document.getElementById("settings-modal").hidden && !document.querySelector('.settings-panel[data-panel="tools"]').hidden), "\"backfill\" opens Site Settings on the Tools tab");
  await page.click("#close-settings");
  // song builder entry only while open
  ok(!(await labels("song builder")).some((x) => x.includes("Play / stop")), "no song-builder entry while it is closed"); await page.keyboard.press("Escape");
  await page.click("#songs-btn"); await page.waitForSelector("#songs-modal:not([hidden])"); await page.waitForTimeout(500);
  const edit = page.locator("#songs-modal button", { hasText: /^Edit$/ }).first();
  if (await edit.count()) { await edit.click(); await page.waitForSelector("#song-builder-modal:not([hidden])"); await page.waitForTimeout(500);
    ok((await labels("song builder")).some((x) => x.includes("Play / stop")), "the song-builder entry appears while it is open"); await page.keyboard.press("Escape");
    await page.click("#close-song-builder"); await page.waitForTimeout(300); }
  if (await page.$("#songs-modal:not([hidden])")) await page.click("#close-songs");
  // photo editor
  await page.click("#media-btn"); await page.waitForSelector("#media-modal:not([hidden])"); await page.waitForTimeout(900);
  await page.locator("#media-grid .media-edit").first().click({ force: true }); await page.waitForSelector("#photo-editor-modal:not([hidden])"); await page.waitForTimeout(1200);
  const l3 = await labels("photo editor:"); ok(["Zoom in", "Zoom out", "Fit image", "Actual pixels"].every((w) => l3.some((x) => x.includes(w))), "photo editor zoom entries are offered", l3); await page.keyboard.press("Escape");
  const before = await page.textContent("#pe-layer-count");
  await run("new layer", "Photo Editor: New layer");
  ok((await page.textContent("#pe-layer-count")) !== before, "\"New layer\" adds a layer", [before, await page.textContent("#pe-layer-count")]);
  const z0 = await page.textContent("#pe-zoom-status");
  await run("actual pixels", "Photo Editor: Actual pixels");
  ok((await page.textContent("#pe-zoom-status")) !== z0 || /100/.test(await page.textContent("#pe-zoom-status")), "\"Actual pixels\" changes the zoom", await page.textContent("#pe-zoom-status"));
  await page.click("#close-photo-editor").catch(() => {}); await page.waitForTimeout(500);
  if (await page.$("#pe-discard-modal:not([hidden])")) { await page.keyboard.press("Escape"); }
  ok(errs.length === 0, "no page errors or dialogs", errs);
  await page.evaluate(() => { try { localStorage.removeItem("admin-density"); } catch (e) {} });
  await b.close(); console.log(f ? "FAILURES " + f : "ALL PASS");
})();
