const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const c = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const page = await c.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  let dialogs = []; let accept = true; page.on("dialog", (d) => { dialogs.push(d.message()); accept ? d.accept() : d.dismiss(); });
  const api = async (m, p, body) => { const r = await c.request.fetch(BASE + "/api/admin" + p, { method: m, headers: { "content-type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status(), j }; };
  const stamp = Date.now(); const ids = [];
  for (const n of ["A", "B", "C"]) ids.push((await api("POST", "/shared-blocks", { name: `QQbulk shared ${n} ${stamp}`, type: "text", content: { text: "QQ shared" }, style: {} })).j.id);
  const pg = await api("POST", "/pages", { title: "QQ shared usage page", slug: "qq-shared-usage" });
  await api("POST", `/pages/${pg.j.id}/blocks`, { type: "text", shared_block_id: ids[2], col: 1, col_span: 12, row: 1, row_span: 2 });
  try {
    await page.goto(`${BASE}/admin/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(900);
    await page.click("#shared-blocks-btn"); await page.waitForSelector("#shared-blocks-modal:not([hidden])"); await page.waitForTimeout(800);
    const rows = () => page.$$eval("#shared-blocks-list .simulation-row", (r) => r.filter((x) => x.textContent.includes("QQbulk shared")).length);
    ok((await rows()) === 3, "the three test reusable blocks are listed", await rows());
    ok(!(await page.locator("#shared-blocks-list-bulk-bar .bulk-list-duplicate").isVisible()), "no Duplicate selected (there is no duplicate route)");
    const boxes = page.locator("#shared-blocks-list .simulation-row", { hasText: "QQbulk shared" }).locator(".bulk-list-row-box");
    for (let i = 0; i < 3; i++) await boxes.nth(i).check();
    const labelsNow = await page.$$eval("#shared-blocks-list .bulk-list-row-box", (b) => b.map((x) => x.getAttribute("aria-label")).filter((l) => l.includes("QQbulk shared")));
    ok(labelsNow.length === 3 && labelsNow.every((l) => /^Select QQbulk shared [ABC] \d+$/.test(l)), "checkbox labels hold just the name (no type or badge text)", labelsNow);
    dialogs = []; accept = false;
    await page.click("#shared-blocks-list-bulk-bar .bulk-list-delete"); await page.waitForTimeout(1000);
    ok(dialogs.length === 1 && /Delete 3 reusable blocks/.test(dialogs[0]), "Delete selected asks first", dialogs[0] && dialogs[0].slice(0, 60));
    ok(/- QQbulk shared C \d+: QQ shared usage page/.test(dialogs[0]), "the confirm's usage line has the bare name", dialogs[0]);
    ok(/QQ shared usage page/.test(dialogs[0]) && /placements become empty blocks/.test(dialogs[0]), "the confirm names the page using one and the empty-placement consequence", dialogs[0]);
    accept = true; dialogs = [];
    await page.click("#shared-blocks-list-bulk-bar .bulk-list-delete"); await page.waitForTimeout(1800);
    ok((await rows()) === 0, "accepting deletes all three");
    ok(errs.length === 0, "no page errors", errs);
  } catch (e) { f++; console.log("FAIL threw", e.message.split("\n")[0]); }
  for (const id of ids) await api("DELETE", `/shared-blocks/${id}`);
  await api("DELETE", `/pages/${pg.j.id}`); await api("DELETE", `/pages/${pg.j.id}/permanent`);
  await b.close(); console.log(f ? "FAILURES " + f : "ALL PASS");
})();
