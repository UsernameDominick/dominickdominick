const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const [w, h] of [[1400, 900], [390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, storageState: process.env.ADMIN_STATE });
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.route("**/api/admin/settings", async (r) => { if (r.request().method() !== "GET") return r.continue(); const res = await r.fetch(); const j = await res.json(); j.maintenance_mode = "1"; r.fulfill({ response: res, json: j }); });
    await p.goto((E2E_BASE + "/admin/"));
    await p.waitForSelector("#app:not([hidden])");
    await p.waitForTimeout(800);
    const r = await p.evaluate(() => {
      const mask = (id) => getComputedStyle(document.getElementById(id), "::before").maskImage || getComputedStyle(document.getElementById(id), "::before").webkitMaskImage;
      const ids = ["articles-btn","projects-btn","media-btn","redirects-btn","simulations-btn","scans-btn","songs-btn","shared-blocks-btn","layers-btn","diagnostics-btn","seo-dashboard-btn","topic-pages-btn","analytics-btn","trash-btn","site-settings-btn","preview-btn","preview-at-btn","draft-preview-mode-toggle","focus-mode-btn","content-only-mode-btn"];
      const strip = document.getElementById("admin-status-strip");
      return { missing: ids.filter((i) => !/url\(/.test(mask(i) || "")), strip: strip.hidden ? "" : strip.textContent, themeSvg: !!document.querySelector("#admin-theme-toggle svg"), densSvg: !!document.querySelector("#admin-density-toggle svg"), tier: getComputedStyle(document.querySelector('[data-tier="primary"]')).backgroundColor };
    });
    ok(r.missing.length === 0, `${w} icons on all sidebar buttons ${r.missing}`);
    ok(/Maintenance mode is on/.test(r.strip), `${w} maintenance strip shown`);
    ok(r.themeSvg && r.densSvg, `${w} footer svg icons`);
    // pill
    const st = await p.evaluate(() => {
      const n = document.getElementById("page-save-status"); const out = {};
      for (const t of ["Saving…", "Saved 10:42:11", "Unsaved changes…", "Save failed: x", ""]) { n.textContent = t; out[t] = null; }
      return null;
    });
    const states = [];
    for (const t of ["Saving…", "Saved 10:42:11", "Unsaved changes…", "Save failed: x", "", "Changed elsewhere since you loaded it — your last edit wasn't saved. ", "Merged and saved 10:00"]) {
      await p.evaluate((t) => (document.getElementById("page-save-status").textContent = t), t);
      await p.waitForTimeout(30);
      states.push(await p.evaluate(() => document.getElementById("page-save-status").dataset.state || ""));
    }
    ok(states.join() === "saving,saved,dirty,error,,error,saved", `${w} pill states ${states}`);
    // preview cookie strip
    await p.evaluate(() => document.getElementById("draft-preview-mode-toggle").click());
    const s2 = await p.evaluate(() => document.getElementById("admin-status-strip").textContent);
    ok(/Draft preview mode/.test(s2), `${w} preview strip adds`);
    await p.evaluate(() => document.getElementById("draft-preview-mode-toggle").click());
    ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${w} no overflow`);
    await p.screenshot({ path: `${process.env.S}/admin3_${w}.png` });
    ok(errs.length === 0, `${w} no page errors ${errs}`);
    await ctx.close();
  }
  await b.close(); process.exit(fail ? 1 : 0);
})();
