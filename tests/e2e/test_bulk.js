const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
const row = (steps) => Array.from({ length: 16 }, (_, i) => steps.includes(i));
const songData = (t) => ({ tempo: t, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1, tracks: { kick: row([0, 4]), snare: row([2]), hihat: row([]), clap: row([]) }, melody: { waveform: "sine", notes: { C4: row([1]) } } });
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const c = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const page = await c.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  let dialogs = []; let accept = true; page.on("dialog", (d) => { dialogs.push(d.message()); accept ? d.accept() : d.dismiss(); });
  const api = async (m, p, body) => { const r = await c.request.fetch(BASE + "/api/admin" + p, { method: m, headers: { "content-type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status(), j }; };
  const stamp = Date.now();
  const songs = []; for (const n of ["A", "B", "C"]) songs.push((await api("POST", "/songs", { name: `QQbulk song ${n} ${stamp}`, data: songData(100) })).j.id);
  const sims = []; for (const n of ["A", "B"]) sims.push((await api("POST", "/simulations", { name: `QQbulk sim ${n} ${stamp}`, data: {} })).j.id);
  const scans = []; for (const n of ["A", "B"]) scans.push((await api("POST", "/scans", { name: `QQbulk scan ${n} ${stamp}`, glb_key: (await require("./scanfix.js").uploadGlb()) })).j.id);
  const pg = await api("POST", "/pages", { title: "QQ bulk usage page", slug: "qq-bulk-usage" });
  await api("POST", `/pages/${pg.j.id}/blocks`, { type: "song", content: { song_id: songs[2] }, style: {}, col: 1, col_span: 24, row: 1, row_span: 8 });
  ok(songs.every(Boolean) && sims.every(Boolean) && scans.every(Boolean), "synthetic songs, simulations and scans created");
  await page.goto(`${BASE}/admin/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(900);
  const lists = [
    ["songs", "#songs-btn", "#songs-modal", "#songs-list", "#close-songs", "QQbulk song", true],
    ["simulations", "#simulations-btn", "#simulations-modal", "#simulations-list", "#close-simulations", "QQbulk sim", true],
    ["scans", "#scans-btn", "#scans-modal", "#scans-list", "#close-scans", "QQbulk scan", false],
  ];
  try {
    for (const [name, btn, modal, list, close, prefix, canDup] of lists) {
      await page.click(btn); await page.waitForSelector(`${modal}:not([hidden])`); await page.waitForTimeout(700);
      const qrows = () => page.$$eval(`${list} .simulation-row`, (rows, p) => rows.filter((r) => r.textContent.includes(p)).length, prefix);
      ok((await qrows()) >= 2, `${name}: test rows are listed`, await qrows());
      const bar = `${list}-bulk-bar`;
      ok(await page.evaluate((id) => { const b = document.getElementById(id); return !!b && !b.hidden; }, bar.slice(1)), `${name}: the bulk bar is shown`);
      ok(await page.$eval(`${bar} .bulk-list-delete`, (e) => e.disabled), `${name}: Delete selected is disabled with nothing selected`);
      ok((await page.$$(`${list} .simulation-row .bulk-list-row-box`)).length === (await page.$$(`${list} .simulation-row`)).length, `${name}: every row has a checkbox`);
      ok((await page.locator(`${bar} .bulk-list-duplicate`).isVisible()) === canDup, `${name}: Duplicate selected is ${canDup ? "offered" : "not offered (no duplicate route)"}`);
      // select only our rows
      const boxes = page.locator(`${list} .simulation-row`, { hasText: prefix }).locator(".bulk-list-row-box");
      const n = await boxes.count(); for (let i = 0; i < n; i++) await boxes.nth(i).check();
      ok((await page.textContent(`${bar} .bulk-list-count`)).includes(`${n} selected`), `${name}: the count follows the selection`, await page.textContent(`${bar} .bulk-list-count`));
      const totalRows = (await page.$$(`${list} .simulation-row`)).length;
      ok(await page.$eval(`${bar} .bulk-list-all-box`, (e, partial) => (partial ? e.indeterminate && !e.checked : e.checked && !e.indeterminate), n < totalRows), `${name}: Select all shows ${n < totalRows ? "the partial state" : "checked when every row is selected"}`);
      // redraw keeps the selection (open another modal's list and back? use an in-list redraw: search box if any, else reopen)
      if (canDup) {
        const before = await qrows();
        await page.click(`${bar} .bulk-list-duplicate`); await page.waitForTimeout(1500);
        ok((await qrows()) === before * 2, `${name}: Duplicate selected adds one copy of each`, [before, await qrows()]);
        ok((await page.textContent(`${bar} .bulk-list-count`)) === "", `${name}: the selection is cleared afterwards`);
        // select everything of ours again (originals and copies) and delete, cancelling first
        const all = page.locator(`${list} .simulation-row`, { hasText: prefix }).locator(".bulk-list-row-box");
        const m = await all.count(); for (let i = 0; i < m; i++) await all.nth(i).check();
      }
      dialogs = []; accept = false;
      await page.click(`${bar} .bulk-list-delete`); await page.waitForTimeout(1200);
      ok(dialogs.length === 1 && /Delete \d+ /.test(dialogs[0]), `${name}: Delete selected asks first`, dialogs[0] && dialogs[0].slice(0, 70));
      if (name === "songs") ok(/qq bulk usage page|QQ bulk usage page/i.test(dialogs[0]), "songs: the confirm names where a selected song is used", dialogs[0]);
      ok(await page.$eval(`${bar} .bulk-list-delete`, (e) => !e.disabled), `${name}: cancelling leaves the selection and the button`);
      const afterCancel = await qrows();
      accept = true; dialogs = [];
      await page.click(`${bar} .bulk-list-delete`); await page.waitForTimeout(2000);
      ok((await qrows()) === 0, `${name}: accepting deletes every selected row`, [afterCancel, await qrows()]);
      await page.click(close); await page.waitForTimeout(250);
    }
    // mobile: the checkbox sits beside the name, not above it
    for (const w of [390, 320]) {
      await page.setViewportSize({ width: w, height: 800 });
      for (const [btn, modal, list, close] of [["#songs-btn", "#songs-modal", "#songs-list", "#close-songs"], ["#simulations-btn", "#simulations-modal", "#simulations-list", "#close-simulations"]]) {
        await page.evaluate((id) => document.querySelector(id).click(), btn); await page.waitForSelector(`${modal}:not([hidden])`); await page.waitForTimeout(500);
        const pos = await page.$eval(`${list} .simulation-row`, (r) => { const b = r.querySelector(".bulk-list-row-box").getBoundingClientRect(); const n = r.querySelector("span").getBoundingClientRect(); return { sameLine: Math.abs(b.top - n.top) < 14 && n.left >= b.right - 1, overflow: r.scrollWidth > r.clientWidth + 1 }; });
        ok(pos.sameLine && !pos.overflow, `${btn.slice(1, -4)}: checkbox beside the name at ${w}px`, pos);
        await page.click(close); await page.waitForTimeout(200);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    // follow-ups: target size, toolbar role, unknown-usage warning, focus and failure wording
    const extra = []; for (const n of ["X", "Y"]) extra.push((await api("POST", "/songs", { name: `QQbulk extra ${n} ${stamp}`, data: songData(100) })).j.id);
    await page.click("#songs-btn"); await page.waitForSelector("#songs-modal:not([hidden])"); await page.waitForTimeout(700);
    const size = await page.$eval("#songs-list .bulk-list-row-box", (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    ok(size[0] >= 24 && size[1] >= 24, "row checkboxes are at least 24px", size);
    ok((await page.getAttribute("#songs-list-bulk-bar", "role")) === "toolbar", "the bar is a labelled toolbar");
    const mine = page.locator("#songs-list .simulation-row", { hasText: `QQbulk extra` }).locator(".bulk-list-row-box");
    await mine.nth(0).check();
    await page.route("**/api/admin/content-usage*", (r) => r.fulfill({ status: 500, body: "{}" }));
    dialogs = []; accept = false;
    await page.click("#songs-list-bulk-bar .bulk-list-delete"); await page.waitForTimeout(800);
    ok(dialogs.length === 1 && /Couldn't check where some of these are used/.test(dialogs[0]), "a failed usage lookup is called out in the confirm", dialogs[0]);
    await page.unroute("**/api/admin/content-usage*");
    await mine.nth(1).check();
    let failFirst = true;
    await page.route(`**/api/admin/songs/${extra[0]}`, (r) => { if (r.request().method() === "DELETE") return r.fulfill({ status: 500, body: JSON.stringify({ error: "boom" }) }); return r.continue(); });
    accept = true; dialogs = [];
    await page.click("#songs-list-bulk-bar .bulk-list-delete"); await page.waitForTimeout(2000);
    ok(dialogs.some((d) => /could not be deleted: QQbulk extra/.test(d)), "a partial failure names the item that failed", dialogs.map((d) => d.slice(0, 90)));
    ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("bulk-list-all-box")), "focus lands on the bar after a bulk action, not the page body");
    ok((await page.textContent("#songs-list-bulk-bar .bulk-list-count")).includes("1 selected"), "the failed item stays selected");
    await page.unroute(`**/api/admin/songs/${extra[0]}`);
    // emptying a list keeps focus inside the dialog
    await page.route("**/api/admin/songs", (r) => { if (r.request().method() !== "GET") return r.continue(); return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: extra[1], name: `QQbulk extra Y ${stamp}`, updated_at: "2026-01-01" }]) }); });
    await page.click("#close-songs"); await page.click("#songs-btn"); await page.waitForTimeout(700);
    await page.locator("#songs-list .simulation-row", { hasText: "QQbulk extra" }).locator(".bulk-list-row-box").check();
    await page.unroute(`**/api/admin/songs/${extra[0]}`).catch(() => {});
    await page.route("**/api/admin/songs", (r) => { if (r.request().method() !== "GET") return r.continue(); return r.fulfill({ status: 200, contentType: "application/json", body: "[]" }); }, { times: 1 }).catch(() => {});
    await page.click("#songs-list-bulk-bar .bulk-list-delete"); await page.waitForTimeout(1500);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === "close-songs"), "after the last row is deleted focus moves to the dialog's close button", await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
    await page.unroute("**/api/admin/songs").catch(() => {});
    await page.click("#close-songs").catch(() => {});
    for (const id of extra) await api("DELETE", `/songs/${id}`);
    ok(errs.length === 0, "no page errors", errs);
  } catch (e) { f++; console.log("FAIL threw", e.message.split("\n")[0]); }
  for (const id of songs) await api("DELETE", `/songs/${id}`); for (const id of sims) await api("DELETE", `/simulations/${id}`); for (const id of scans) await api("DELETE", `/scans/${id}`);
  await api("DELETE", `/pages/${pg.j.id}`); await api("DELETE", `/pages/${pg.j.id}/permanent`);
  await b.close(); console.log(f ? "FAILURES " + f : "ALL PASS");
})();
