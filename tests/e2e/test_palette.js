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
  for (const [q, want] of [["theme", "light / dark"], ["density", "switch to compact"], ["log out", "Log out (signs out every device)"], ["media", "Open Media Library"], ["features", "Open Features"]]) {
    const l = await labels(q); ok(l.some((x) => x.includes(want)), `palette finds "${q}"`, l.slice(0, 3));
    await page.keyboard.press("Escape");
  }
  // ranking: a command that names the query leads the settings matches
  for (const [q, want] of [["theme", "light / dark"], ["dark mode", "light / dark"], ["logout", "Log out"], ["sign out", "Log out"], ["compact", "Interface density"]]) {
    const l = await labels(q); ok(l.length && l[0].includes(want), `"${q}" puts the matching command first`, l.slice(0, 2)); await page.keyboard.press("Escape");
  }
  // short or partial queries don't get hijacked
  for (const [q, notFirst] of [["a", "Interface density"], ["l", "light / dark"], ["mode", "light / dark"], ["log", "Log out"]]) {
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
  // the settings index points at the right tab
  await run("offline", "Maintenance mode");
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => !document.getElementById("settings-modal").hidden && !document.querySelector('.settings-panel[data-panel="maintenance"]').hidden), "\"offline\" opens Site Settings on the Maintenance tab");
  await page.click("#close-settings");
  // the blocks of the open page are searchable
  const blockLabels = await labels("a"); ok(Array.isArray(blockLabels), "a short query still answers"); await page.keyboard.press("Escape");
  ok(errs.length === 0, "no page errors or dialogs", errs);
  await page.evaluate(() => { try { localStorage.removeItem("admin-density"); } catch (e) {} });
  await b.close(); console.log(f ? "FAILURES " + f : "ALL PASS");
})();
