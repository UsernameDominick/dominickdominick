const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, storageState: process.env.ADMIN_STATE });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto((E2E_BASE + "/admin/")); await p.waitForSelector("#app:not([hidden])");
  await p.keyboard.press("Control+k"); await p.waitForSelector("#command-results .command-result");
  let r = await p.evaluate(() => ({ groups: [...document.querySelectorAll(".command-result-group")].map((g) => g.textContent), rows: document.querySelectorAll(".command-result").length, ico: [...document.querySelectorAll(".command-result")].every((i) => /url\(/.test(getComputedStyle(i, "::before").maskImage || getComputedStyle(i, "::before").webkitMaskImage || "")) }));
  ok(r.groups.length >= 1 && r.rows > 5, `empty query groups ${r.groups}`);
  ok(r.ico, "all icons resolve");
  await p.fill("#command-input, .command-input", "footer"); await p.waitForTimeout(700);
  r = await p.evaluate(() => [...document.querySelectorAll(".command-result-group")].map((g) => g.textContent));
  ok(r.includes("Settings"), `settings group ${r}`);
  await p.keyboard.press("ArrowDown"); await p.keyboard.press("ArrowUp");
  ok((await p.evaluate(() => document.querySelectorAll(".command-result.active").length)) === 1, "one active row after arrows");
  await p.fill(".command-input", "zzqqxx"); await p.waitForTimeout(700);
  ok(/Nothing matches/.test(await p.textContent("#command-results")), "empty message");
  await p.fill(".command-input", "theme"); await p.waitForTimeout(400);
  await p.screenshot({ path: `${require("os").tmpdir()}/palette_groups.png` });
  ok(errs.length === 0, `no errors ${errs}`);
  // login screen
  const c2 = await b.newContext({ viewport: { width: 390, height: 700 } }); const q = await c2.newPage();
  await q.goto((E2E_BASE + "/admin/")); await q.waitForSelector("#login-form", { state: "visible" });
  ok(!(await q.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "login no overflow 390");
  await q.screenshot({ path: `${require("os").tmpdir()}/login3.png` });
  await b.close(); process.exit(fail ? 1 : 0);
})();
