const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const c = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const page = await c.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.route("**/api/admin/**", (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));
  await page.goto(`${BASE}/admin/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(900);
  try {
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.click("#songs-btn"); await page.waitForSelector("#songs-modal:not([hidden])"); await page.waitForTimeout(500);
      await page.locator("#songs-modal button", { hasText: /^Edit$/ }).first().click(); await page.waitForSelector("#song-builder-modal:not([hidden])"); await page.waitForTimeout(700);
      const col = await page.evaluate(() => {
        const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
        const l = document.querySelector("#song-builder-modal .sim-toolbar-group-label"); const bg = getComputedStyle(l).backgroundColor;
        return { fg: rgb(getComputedStyle(l).color), bg: rgb(bg), border: getComputedStyle(l.parentElement).borderTopColor };
      });
      const r = ratio(col.fg, col.bg);
      ok(r >= 4.5, `builder section labels have >= 4.5:1 contrast in the ${theme} theme`, Math.round(r * 100) / 100);
      await page.click("#close-song-builder"); await page.waitForTimeout(300); if (await page.$("#typed-confirm-modal:not([hidden])")) await page.keyboard.press("Escape");
      await page.click("#close-songs"); await page.waitForTimeout(200);
    }
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.click("#simulations-btn"); await page.waitForSelector("#simulations-modal:not([hidden])"); await page.waitForTimeout(700);
    const fit = await page.$$eval("#simulations-list .simulation-row", (rows) => rows.map((r) => { const box = r.getBoundingClientRect(); return [...r.querySelectorAll("button, a")].every((x) => { const b = x.getBoundingClientRect(); return b.right <= box.right + 1 && b.left >= box.left - 1; }); }));
    ok(fit.length > 0 && fit.every(Boolean), "every Simulations row action sits inside its row (nothing clipped)", fit);
    const nowrap = await page.$$eval("#simulations-list .simulation-row a, #simulations-list .simulation-row button", (els) => els.every((e) => getComputedStyle(e).whiteSpace === "nowrap"));
    ok(nowrap, "row action labels never wrap mid-label");
    await page.click("#close-simulations");
    await page.click("#songs-btn"); await page.waitForSelector("#songs-modal:not([hidden])"); await page.waitForTimeout(400);
    await page.locator("#songs-modal button", { hasText: /^Edit$/ }).first().click(); await page.waitForSelector("#song-builder-modal:not([hidden])"); await page.waitForTimeout(600);
    const acc = await page.evaluate(() => { const r = document.querySelector("#song-builder-modal input[type=range]"); return r ? getComputedStyle(r).accentColor : null; });
    ok(acc && acc !== "auto", "sliders use the theme accent instead of the browser blue", acc);
    const ph = await page.evaluate(() => { const i = document.querySelector("#song-name"); return i ? getComputedStyle(i, "::placeholder").color : null; });
    console.log("placeholder colour:", ph);
    await page.click("#close-song-builder"); await page.waitForTimeout(300); await page.click("#close-songs");
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForTimeout(150);
      const pc = await page.evaluate(() => {
        const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return c.startsWith("color(") ? [m[0] * 255, m[1] * 255, m[2] * 255, m[3] ?? 1] : [m[0], m[1], m[2], m[3] ?? 1]; };
        const out = [];
        for (const id of ["palette-search", "command-input", "article-title"]) { const e = document.getElementById(id); if (!e) continue; const ph = parse(getComputedStyle(e, "::placeholder").color); let bg = parse(getComputedStyle(e).backgroundColor); if (bg[3] < 1) bg = parse(getComputedStyle(document.body).backgroundColor); const a = ph[3]; out.push({ id, fg: [0, 1, 2].map((i) => ph[i] * a + bg[i] * (1 - a)), bg: bg.slice(0, 3) }); }
        return out;
      });
      for (const x of pc) { const r = ratio(x.fg, x.bg); ok(r >= 4.5, `placeholder contrast on #${x.id} in the ${theme} theme is >= 4.5:1`, Math.round(r * 100) / 100); }
    }
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.click("#songs-btn"); await page.waitForSelector("#songs-modal:not([hidden])"); await page.waitForTimeout(300);
    await page.locator("#songs-modal button", { hasText: /^Edit$/ }).first().click(); await page.waitForSelector("#song-builder-modal:not([hidden])"); await page.waitForTimeout(400);
    await page.click("#close-song-builder"); await page.waitForTimeout(300); await page.click("#close-songs");
    // shortcuts modal: no focus box around the title
    await page.keyboard.press("Shift+/"); await page.waitForTimeout(400);
    if (await page.evaluate(() => !document.getElementById("shortcuts-modal").hidden)) {
      const out = await page.evaluate(() => { const h = document.querySelector("#shortcuts-modal h1"); return getComputedStyle(h).outlineStyle; });
      ok(out === "none", "the shortcuts dialog's title has no focus box", out);
    } else console.log("note: shortcuts dialog did not open via ?");
    ok(errs.length === 0, "no page errors", errs);
  } catch (e) { f++; console.log("FAIL threw", e.message.split("\n")[0]); }
  await b.close(); console.log(f ? "FAILURES " + f : "ALL PASS");
})();
