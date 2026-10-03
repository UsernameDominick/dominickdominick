const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { execSync } = require("child_process");
const { chromium } = require("./_pw.cjs"); const fs = require("fs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
const d1 = require("./_pw.cjs").d1;
const put = (k, v) => d1(`INSERT INTO settings (key, value) VALUES ('${k}', '${v.replace(/'/g, "''")}') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
(async () => {
  const keys = ["last_link_check_at", "last_link_check_broken", "last_link_check_unchecked"];
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    for (const [w, h, label] of [[1440, 900, "desktop"], [390, 800, "phone"]]) {
      const p = await (await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: w, height: h } })).newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
      const t = `[${label}]`;
      put("last_link_check_at", new Date().toISOString());
      put("last_link_check_broken", JSON.stringify([{ url: "https://gone.example/x", source: "Article QQ", status: "Unreachable", checkedAt: new Date().toISOString() }]));
      put("last_link_check_unchecked", "7");
      await p.goto(`${BASE}/admin/`); await p.waitForSelector("#app:not([hidden])");
      await p.evaluate(() => document.getElementById("seo-dashboard-btn").click()); await p.waitForTimeout(900);
      await p.evaluate(() => { const d = document.getElementById("scheduled-link-check-status").closest("details"); if (d) d.open = true; });
      await p.waitForTimeout(500);
      await p.waitForFunction(() => document.getElementById("scheduled-link-check-status").textContent.length > 0, null, { timeout: 8000 }).catch(() => {});
      let txt = await p.textContent("#scheduled-link-check-status");
      ok(/1 broken link\(s\) found/.test(txt) && /7 links to other sites haven't been checked yet: each automatic check looks at 25 of them/.test(txt) && /gone\.example/.test(txt), `${t} the status shows the broken link and how many are waiting`, txt.replace(/\s+/g, " ").slice(0, 300));
      put("last_link_check_unchecked", "1");
      await p.evaluate(() => document.getElementById("close-seo-dashboard") && document.getElementById("close-seo-dashboard").click()); await p.waitForTimeout(200);
      await p.evaluate(() => document.getElementById("seo-dashboard-btn").click()); await p.waitForTimeout(900);
      await p.waitForFunction(() => document.getElementById("scheduled-link-check-status").textContent.length > 0, null, { timeout: 8000 }).catch(() => {});
      txt = await p.textContent("#scheduled-link-check-status");
      ok(/1 link to other sites hasn't been checked yet/.test(txt), `${t} one waiting reads in the singular`, txt.replace(/\s+/g, " ").slice(0, 200));
      put("last_link_check_unchecked", "0"); put("last_link_check_broken", "[]");
      await p.evaluate(() => document.getElementById("close-seo-dashboard") && document.getElementById("close-seo-dashboard").click()); await p.waitForTimeout(200);
      await p.evaluate(() => document.getElementById("seo-dashboard-btn").click()); await p.waitForTimeout(900);
      await p.waitForFunction(() => document.getElementById("scheduled-link-check-status").textContent.length > 0, null, { timeout: 8000 }).catch(() => {});
      txt = await p.textContent("#scheduled-link-check-status");
      ok(/no broken links/.test(txt) && !/haven't been checked/.test(txt), `${t} with nothing broken or waiting it is the plain all-clear`, txt.replace(/\s+/g, " ").slice(0, 200));
      await p.addScriptTag({ content: require("./_pw.cjs").axeSource() });
      const viol = await p.evaluate(async () => (await axe.run(document.getElementById("scheduled-link-check-status").closest("details"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ":" + v.nodes.length));
      ok(viol.length === 0, `${t} axe finds nothing there`, viol);
      ok(errs.length === 0, `${t} no page errors`, errs);
      await p.close();
    }
  } finally {
    d1(`DELETE FROM settings WHERE key IN (${keys.map((k) => `'${k}'`).join(",")})`);
    await b.close();
  }
  console.log(f ? "FAILURES " + f : "ALL PASS"); process.exit(f ? 1 : 0);
})();
