const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const w of [1300, 390]) {
    const p = await (await b.newContext({ viewport: { width: w, height: 850 }, storageState: process.env.ADMIN_STATE })).newPage();
    await p.goto((E2E_BASE + "/admin/")); await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("trash-btn").click()); await p.waitForTimeout(700);
    const r = await p.evaluate(() => { const m = document.getElementById("trash-modal"); const c = document.getElementById("close-trash").getBoundingClientRect(); return { over: m.scrollWidth > innerWidth + 1, cw: Math.round(c.width), ch: Math.round(c.height), h1: getComputedStyle(m.querySelector("h1")).fontSize }; });
    ok(!r.over && r.cw >= 34 && r.ch >= 34, `${w} trash modal ${JSON.stringify(r)}`);
    await p.screenshot({ path: `${require("os").tmpdir()}/trash_${w}.png` });
    await p.keyboard.press("Escape");
  }
  await b.close(); process.exit(fail ? 1 : 0);
})();
