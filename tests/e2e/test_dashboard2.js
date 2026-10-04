const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ viewport: { width: 1300, height: 850 }, storageState: process.env.ADMIN_STATE });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const future = new Date(Date.now() + 864e5 * 30).toISOString();
  let mode = "fail";
  await p.route("**/api/admin/notifications-summary", (r) => mode === "fail" ? r.fulfill({ status: 500, json: { error: "x" } }) : r.fulfill({ json: { backupFailed: false, brokenLinks: 0, recentErrors: 2, recentFailedWebhooks: 1 } }));
  await p.route("**/api/admin/seo-report", (r) => mode === "fail" ? r.fulfill({ status: 500, json: { error: "x" } }) : r.fulfill({ json: { missingMeta: [], missingAlt: [] } }));
  await p.route("**/api/admin/articles", (r) => r.request().method() !== "GET" ? r.continue() : r.fulfill({ json: [
    { id: 1, title: "QQ draft", updated_at: "2026-09-01 10:00:00", published_at: null },
    { id: 2, title: "QQ archived", updated_at: "2026-09-02 10:00:00", published_at: null, archived: 1 },
    { id: 3, title: "QQ sched", updated_at: "2026-09-03 10:00:00", published_at: future },
    ...Array.from({ length: 8 }, (_, i) => ({ id: 10 + i, title: "QQ more " + i, updated_at: "2026-08-0" + (i + 1) + " 10:00:00", published_at: null })),
  ] }));
  await p.goto((E2E_BASE + "/admin/")); await p.waitForSelector("#app:not([hidden])");
  await p.evaluate(() => document.getElementById("dashboard-btn").click()); await p.waitForSelector(".dash-card");
  await p.waitForFunction(() => /Drafts \(9\)/.test(document.getElementById("dashboard-body").textContent) && /and 3 more/.test(document.getElementById("dashboard-body").textContent), null, { timeout: 15000 }).catch(() => {}); // the cards fill in one by one, and the count can show a partial list first: wait for the whole thing (the assertions below say what is wrong if it never arrives)
  let t = await p.textContent("#dashboard-body");
  ok(!/All clear/.test(t) && /Couldn.t load: alerts, site health/.test(t), "failed health sources are not 'All clear'");
  ok(!/QQ archived/.test(t), "archived hidden");
  ok(/Scheduled \(1\)/.test(t) && /QQ sched/.test(t), "scheduled card");
  ok(/Drafts \(9\)/.test(t) && /and 3 more/.test(t), "draft count and more");
  mode = "ok";
  await p.keyboard.press("Escape"); await p.evaluate(() => document.getElementById("dashboard-btn").click()); await p.waitForFunction(() => document.querySelector(".dash-flags"));
  const links = await p.$$eval(".dash-attention [data-go]", (b) => b.map((x) => x.dataset.go));
  ok(links.includes("diagnostics-btn") && !links.includes("seo-dashboard-btn"), `flags route to Diagnostics ${links}`);
  ok(errs.length === 0, `no errors ${errs}`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
