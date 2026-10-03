const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const p = await (await b.newContext({ viewport: { width: 1200, height: 800 }, storageState: process.env.ADMIN_STATE })).newPage();
  await p.goto((E2E_BASE + "/admin/")); await p.waitForSelector("#app:not([hidden])");
  await p.keyboard.press("Control+k"); await p.waitForSelector(".command-result");
  for (const q of ["", "theme", "s", "mode", "home", "paste"]) {
    await p.fill("#command-input", q); await p.waitForTimeout(700);
    const r = await p.evaluate(() => { const g = [...document.querySelectorAll(".command-result-group")].map((x) => x.textContent); return { g, dup: new Set(g).size !== g.length, sel: document.querySelectorAll('.command-result[aria-selected="true"]').length, ad: document.getElementById("command-input").getAttribute("aria-activedescendant"), id: (document.querySelector(".command-result.active") || {}).id }; });
    ok(!r.dup, `"${q}" no repeated headings ${r.g}`); ok((r.sel === 1 && r.ad === r.id) || (r.sel === 0 && !r.ad), `"${q}" aria-selected/activedescendant ${r.ad}`);
  }
  await p.fill("#command-input", "s"); await p.waitForTimeout(600);
  await p.keyboard.press("ArrowDown"); await p.keyboard.press("ArrowDown");
  ok(await p.evaluate(() => document.getElementById("command-input").getAttribute("aria-activedescendant") === "command-opt-2"), "arrows update activedescendant");
  await b.close(); process.exit(fail ? 1 : 0);
})();
