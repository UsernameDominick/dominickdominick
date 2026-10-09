const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  let fails = 0; const ok = (c, m) => { console.log((c ? "PASS" : "FAIL") + " — " + m); if (!c) fails++; };
  await p.goto((E2E_BASE + "/admin/"), { waitUntil: "networkidle" });
  await p.waitForSelector("#app:not([hidden])");
  await p.evaluate(() => document.getElementById("media-btn").click());
  await p.waitForTimeout(1000);
  const count = () => p.evaluate(() => document.querySelectorAll("#media-grid .media-item").length);
  const total = await count();
  ok(total >= 1, `grid shows seeded files (${total})`);
  ok(await p.isHidden("#media-bulk-actions"), "bulk actions hidden with nothing selected");
  // search narrows the grid by file name
  const name = await p.evaluate(() => document.querySelector("#media-grid .media-filename").getAttribute("title"));
  await p.fill("#media-search", name);
  const found = await count();
  ok(found >= 1 && found <= total, `search by file name keeps the match (${found} of ${total})`);
  await p.fill("#media-search", "zzzz-no-such-file");
  ok((await count()) === 0, "a search with no match shows nothing");
  await p.fill("#media-search", "");
  ok((await count()) === total, "clearing the search brings the grid back");
  // select all, count, clear
  await p.check("#media-select-all");
  ok(await p.isVisible("#media-bulk-actions"), "bulk actions appear after select all");
  ok((await p.textContent("#media-selected-count")) === `${total} selected`, "count matches shown");
  await p.click("#media-bulk-clear-btn").catch(() => {});
  ok(await p.isHidden("#media-bulk-actions"), "Clear empties selection");
  // tile click opens details when browsing
  await p.evaluate(() => document.querySelector("#media-grid .media-meta").click());
  await p.waitForTimeout(500);
  ok(await p.evaluate(() => [...document.querySelectorAll(".modal:not([hidden])")].some((m) => /info|detail/i.test(m.id))), "tile click opens details modal");
  ok(await p.evaluate(() => !!document.getElementById("media-info-alt") && !!document.getElementById("save-media-info")), "the details dialog has alt text and Save");
  ok(errs.length === 0, "no page errors " + errs.join(";"));
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  await b.close();
})();
