const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const f = (m, p, b) => c.fetch((E2E_BASE + "/api/admin") + p, { method: m, data: b });
  for (const i of [1, 2, 3]) await f("POST", "/redirects", { from_path: `/qq-bulk-${i}`, to_path: "/", status_code: 301 });
  const pages = [];
  for (const i of [1, 2, 3]) { const pg = await (await f("POST", "/pages", { title: `QQ Trash ${i}`, slug: `qq-trash-${i}` })).json(); pages.push(pg.id); await f("DELETE", `/pages/${pg.id}`); }
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const w of [1300, 390]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 850 }, storageState: process.env.ADMIN_STATE });
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
    await p.goto((E2E_BASE + "/admin/")); await p.waitForSelector("#app:not([hidden])");
    if (w === 1300) {
      // redirects
      await p.evaluate(() => document.getElementById("redirects-btn").click()); await p.waitForSelector("#redirects-list .bulk-list-row-box");
      const n = await p.locator("#redirects-list .redirect-row", { hasText: "/qq-bulk-" }).count();
      ok(n === 3, `three QQ redirects listed (${n})`);
      ok(await p.locator("#redirects-list-bulk-bar").isVisible(), "redirects bulk bar visible");
      ok(await p.locator("#redirects-list-bulk-bar .bulk-list-restore").isHidden(), "no Restore on redirects");
      for (const row of await p.locator("#redirects-list .redirect-row", { hasText: "/qq-bulk-" }).all()) await row.locator(".bulk-list-row-box").check();
      ok(/3 selected/.test(await p.textContent("#redirects-list-bulk-bar .bulk-list-count")), "3 selected");
      await p.click("#redirects-list-bulk-bar .bulk-list-delete"); await p.waitForTimeout(1200);
      ok((await p.locator("#redirects-list .redirect-row", { hasText: "/qq-bulk-" }).count()) === 0, "bulk delete removed the redirects");
      await p.keyboard.press("Escape");
      // trash
      await p.evaluate(() => document.getElementById("trash-btn").click()); await p.waitForSelector("#trash-pages-list .bulk-list-row-box");
      const tr = p.locator("#trash-pages-list .redirect-row", { hasText: "QQ Trash" });
      ok((await tr.count()) === 3, "three QQ pages in trash");
      await tr.nth(0).locator(".bulk-list-row-box").check(); await tr.nth(1).locator(".bulk-list-row-box").check();
      await p.click("#trash-pages-list-bulk-bar .bulk-list-restore"); await p.waitForTimeout(1200);
      ok((await p.locator("#trash-pages-list .redirect-row", { hasText: "QQ Trash" }).count()) === 1, "restore selected brought two back");
      const live = await (await f("GET", "/pages")).json();
      ok(live.filter((x) => /^qq-trash/.test(x.slug)).length === 2, "restored pages are live again");
      // delete forever the remaining one with typed confirm
      await p.locator("#trash-pages-list .redirect-row", { hasText: "QQ Trash" }).first().locator(".bulk-list-row-box").check();
      await p.click("#trash-pages-list-bulk-bar .bulk-list-delete");
      await p.waitForSelector("#typed-confirm-modal:not([hidden])");
      await p.fill("#typed-confirm-input", "DELETE"); await p.click("#typed-confirm-ok"); await p.waitForTimeout(1200);
      ok((await p.locator("#trash-pages-list .redirect-row", { hasText: "QQ Trash" }).count()) === 0, "delete forever with typed confirm");
      // cancelling typed confirm keeps it
      await f("DELETE", `/pages/${pages[0]}`); await f("DELETE", `/pages/${pages[1]}`);
      await p.evaluate(() => document.getElementById("close-trash").click()); await p.evaluate(() => document.getElementById("trash-btn").click()); await p.waitForSelector("#trash-pages-list .bulk-list-row-box");
      await p.locator("#trash-pages-list .redirect-row", { hasText: "QQ Trash" }).first().locator(".bulk-list-row-box").check();
      await p.click("#trash-pages-list-bulk-bar .bulk-list-delete"); await p.waitForSelector("#typed-confirm-modal:not([hidden])");
      await p.keyboard.press("Escape"); await p.waitForTimeout(600);
      ok((await p.locator("#trash-pages-list .redirect-row", { hasText: "QQ Trash" }).count()) === 2, "cancelled typed confirm deletes nothing");
      ok(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains("bulk-list-delete")), "focus returns to Delete after a cancel");
      ok(await p.evaluate(() => !document.querySelector("#trash-pages-list-bulk-bar .bulk-list-delete").disabled), "Delete re-enabled after a cancel");
    } else {
      await p.evaluate(() => document.getElementById("trash-btn").click()); await p.waitForSelector("#trash-pages-list .bulk-list-row-box");
      ok(!(await p.evaluate(() => document.getElementById("trash-modal").scrollWidth > innerWidth + 1)), `${w} trash no overflow`);
      await p.screenshot({ path: `${require("os").tmpdir()}/bulk_trash_${w}.png` });
    }
    ok(errs.length === 0, `${w} no errors ${errs}`);
    await ctx.close();
  }
  await b.close();
  // cleanup
  for (const id of pages) { await f("DELETE", `/pages/${id}`); await f("DELETE", `/pages/${id}/permanent`); }
  process.exit(fail ? 1 : 0);
})();
