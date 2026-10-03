const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const [w, h] of [[1300, 850], [390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, storageState: process.env.ADMIN_STATE });
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto((E2E_BASE + "/admin/")); await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("dashboard-btn").click());
    await p.waitForSelector(".dash-card");
    const r = await p.evaluate(() => ({ cards: document.querySelectorAll(".dash-card").length, heads: [...document.querySelectorAll(".dash-card h2")].map((x) => x.textContent), items: document.querySelectorAll(".dash-item").length, over: document.getElementById("dashboard-modal").scrollWidth > innerWidth + 1 }));
    ok(r.cards >= 5 && /This week/.test(r.heads), `${w} the cards include This week: ${r.heads}`);
    ok(!r.over, `${w} no overflow`);
    await p.screenshot({ path: `${require("os").tmpdir()}/dash_${w}.png` });
    if (r.items) { await p.evaluate(() => document.querySelector(".dash-item").click()); await p.waitForTimeout(600); ok(await p.evaluate(() => document.getElementById("dashboard-modal").hidden), `${w} item closes dashboard`); }
    // palette
    await p.keyboard.press("Control+k"); await p.fill("#command-input", "dashboard"); await p.waitForTimeout(500);
    ok(/Open Dashboard/.test(await p.textContent("#command-results .command-result.active")), `${w} palette leads with dashboard`);
    await p.keyboard.press("Enter"); await p.waitForSelector("#dashboard-modal:not([hidden])");
    await p.keyboard.press("Escape"); await p.waitForTimeout(200);
    ok(await p.evaluate(() => document.getElementById("dashboard-modal").hidden), `${w} escape closes`);
    ok(errs.length === 0, `${w} no errors ${errs}`);
    await ctx.close();
  }
  await b.close(); process.exit(fail ? 1 : 0);
})();
