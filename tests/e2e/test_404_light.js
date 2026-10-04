const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const lum = (c) => { const [r, g, bl] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const ratio = (a, c) => { const x = lum(a), y = lum(c); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const w of [1280, 390]) {
    const p = await (await b.newContext({ viewport: { width: w, height: 800 } })).newPage();
    const res = await p.goto((E2E_BASE + "/definitely-missing"));
    ok(res.status() === 404, `${w} 404 status`);
    ok(await p.locator(".not-found-trace").count() === 1 && (await p.locator("h1").textContent()) === "Page not found", `${w} trace + h1`);
    ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${w} no overflow`);
    await p.screenshot({ path: `${require("os").tmpdir()}/404_${w}.png` });
  }
  const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await p.addInitScript(() => { try { localStorage.setItem("theme", "light"); } catch (e) {} });
  await p.goto((E2E_BASE + "/projects")); await p.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  // colours ease between themes; measure once they have settled, not part-way (two equal readings in a row, so a slow, busy machine can't
  // catch it mid-fade)
  const reading = () => p.evaluate(() => { const e = document.querySelector(".tag"); if (!e) return "none"; const cs = getComputedStyle(e); return cs.color + "|" + cs.backgroundColor; });
  let last = ""; for (let i = 0; i < 40; i++) { const now = await reading(); if (now === last) break; last = now; await p.waitForTimeout(300); }
  const t = await p.evaluate(() => { const e = document.querySelector(".tag"); if (!e) return null; const cs = getComputedStyle(e); return [cs.color, cs.backgroundColor]; });
  if (t) ok(ratio(t[0], t[1]) >= 4.5, `light tag contrast ${ratio(t[0], t[1]).toFixed(2)}`); else console.log("no tag on page, skipped");
  await b.close(); process.exit(fail ? 1 : 0);
})();
