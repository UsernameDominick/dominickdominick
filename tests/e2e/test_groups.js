const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const f = (m, p, b) => c.fetch((E2E_BASE + "/api/admin") + p, { method: m, data: b });
  const mk = async (slug) => (await (await f("POST", "/pages", { title: slug, slug })).json()).id;
  const pg = await mk("qq-group-a"), pg2 = await mk("qq-group-b");
  const add = async (pid, type, text, col, row, cs, rs) => (await (await f("POST", `/pages/${pid}/blocks`, { type, content: { text }, col, row, col_span: cs, row_span: rs })).json()).id;
  const a = await add(pg, "heading", "QQ A", 1, 1, 8, 3), b2 = await add(pg, "text", "QQ B", 9, 1, 8, 3), c3 = await add(pg, "text", "QQ C", 1, 8, 8, 3);
  const blocksOf = async (pid) => (await (await f("GET", `/pages/${pid}/blocks`)).json());
  const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const p = await (await br.newContext({ viewport: { width: 1440, height: 900 }, storageState: process.env.ADMIN_STATE })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  p.on("dialog", (d) => d.type() === "prompt" ? d.accept("QQ Section") : d.accept());
  await p.goto((E2E_BASE + "/admin/")); await p.waitForSelector("#app:not([hidden])");
  await p.selectOption("#page-picker", String(pg)); await p.waitForSelector("#canvas .admin-block"); await p.waitForTimeout(500);
  const box = (id) => p.locator(`#canvas .admin-block[data-id="${id}"]`).boundingBox();
  // multi-select A and B via shift-click, then group
  const ba = await box(a); await p.mouse.click(ba.x + 20, ba.y + 25);
  const bb = await box(b2); await p.keyboard.down("Shift"); await p.mouse.click(bb.x + 20, bb.y + 25); await p.keyboard.up("Shift"); await p.waitForTimeout(400);
  await p.click("#bulk-group-btn"); await p.waitForTimeout(900);
  let bl = await blocksOf(pg); const ga = bl.find((x) => x.id === a).style.group, gb = bl.find((x) => x.id === b2).style.group;
  ok(ga && ga === gb && !bl.find((x) => x.id === c3).style.group, "Group sets one shared id on A and B only");
  ok(await p.locator("#canvas .group-outline").count() === 1, "one dashed outline drawn");
  ok((await p.locator("#canvas .admin-block .lock-badge", { hasText: "Group" }).count()) === 2, "Group badge on both members");
  // drag A one column-width right: B follows
  await p.mouse.click(1000, 800); await p.waitForTimeout(300);
  const a0 = bl.find((x) => x.id === a), b0 = bl.find((x) => x.id === b2);
  const ba2 = await box(a);
  await p.mouse.move(ba2.x + 20, ba2.y + 25); await p.mouse.down(); await p.mouse.move(ba2.x + 20 + 60, ba2.y + 25 + 70, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(1200);
  bl = await blocksOf(pg);
  const a1 = bl.find((x) => x.id === a), b1 = bl.find((x) => x.id === b2), c1 = bl.find((x) => x.id === c3);
  const dC = a1.col - a0.col, dR = a1.row - a0.row;
  ok((dC !== 0 || dR !== 0) && b1.col - b0.col === dC && b1.row - b0.row === dR, `group moved together (d=${dC},${dR})`);
  ok(c1.col === 1 && c1.row === 8, "ungrouped block stayed");
  // save as section from a selection (A+B), then insert on page 2
  await p.mouse.click(1000, 800); await p.waitForTimeout(200);
  const bA = await box(a); await p.mouse.click(bA.x + 20, bA.y + 25);
  const bB = await box(b2); await p.keyboard.down("Shift"); await p.mouse.click(bB.x + 20, bB.y + 25); await p.keyboard.up("Shift"); await p.waitForTimeout(300);
  await p.click("#bulk-save-section-btn"); await p.waitForTimeout(900);
  let secs = await (await f("GET", "/sections")).json();
  const sec = secs.find((x) => x.name === "QQ Section");
  ok(sec && sec.blocks.length === 2 && sec.blocks.every((x) => !x.style.group) && Math.min(...sec.blocks.map((x) => x.row)) === 1, "section saved with 2 blocks, relative rows, no group id");
  await p.selectOption("#page-picker", String(pg2)); await p.waitForTimeout(800);
  await p.click("#page-settings-btn");
  await p.evaluate(() => { document.getElementById("sections-panel").open = true; });
  await p.waitForSelector("#sections-list .insert-section");
  await p.locator("#sections-list .section-row", { hasText: "QQ Section" }).locator(".insert-section").click(); await p.waitForTimeout(1500);
  const b2s = await blocksOf(pg2);
  ok(b2s.length === 2 && b2s[0].style.group && b2s[0].style.group === b2s[1].style.group, "insert creates 2 grouped blocks on the other page");
  ok(!bl.some((x) => x.style.group && x.style.group === b2s[0].style.group), "inserted group id is fresh");
  // duplicating one grouped block must not join its group
  await p.waitForSelector("#canvas .admin-block");
  const d0 = await p.locator("#canvas .admin-block").nth(0).boundingBox(); await p.mouse.click(d0.x + 15, d0.y + 20); await p.waitForTimeout(300);
  const gid = (await blocksOf(pg2))[0].style.group;
  await p.click(".canvas-toolbar button:has-text('Duplicate')"); await p.waitForTimeout(1200);
  const afterDup = await blocksOf(pg2);
  ok(afterDup.length === 3 && afterDup.filter((x) => x.style.group === gid).length === 2, "single duplicate does not join the original group");
  // ungroup releases both
  await p.waitForSelector("#canvas .admin-block");
  // (the duplicate above left its floating toolbar over the blocks: clear the selection and click the blocks low down, below it)
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  const x0 = await p.locator("#canvas .admin-block").nth(0).boundingBox(); await p.mouse.click(x0.x + 15, x0.y + x0.height - 8);
  const x1 = await p.locator("#canvas .admin-block").nth(1).boundingBox(); await p.keyboard.down("Shift"); await p.mouse.click(x1.x + 15, x1.y + x1.height - 8); await p.keyboard.up("Shift"); await p.waitForTimeout(300);
  await p.click("#bulk-ungroup-btn"); await p.waitForTimeout(900);
  ok((await blocksOf(pg2)).every((x) => !x.style.group), "Ungroup clears the group");
  // validation
  ok((await f("POST", "/sections", { name: "x", blocks: [{ type: "<b>", col: 1, col_span: 1, row: 1, row_span: 1 }] })).status() === 400, "server rejects a bad block type");
  ok((await f("POST", "/sections", { name: "", blocks: [] })).status() === 400, "server rejects empty section");
  ok((await f("POST", "/sections", { name: "QQ wide", blocks: [{ type: "text", col: 24, col_span: 24, row: 1, row_span: 2 }] })).status() === 400, "server rejects col+span past the grid");
  const wide = await add(pg2, "text", "QQ wide", 24, 40, 24, 2);
  const wideB = (await blocksOf(pg2)).find((x) => x.id === wide);
  ok(wideB.col === 24 && wideB.col_span === 1, `block create clamps to the grid (${wideB.col},${wideB.col_span})`);
  const par = await Promise.all([1, 2, 3].map((n) => f("POST", "/sections", { name: "QQ par " + n, blocks: [{ type: "text", col: 1, col_span: 4, row: 1, row_span: 2 }] }).then((r) => r.json())));
  const parIds = new Set(par.map((x) => x.id));
  const listed = (await (await f("GET", "/sections")).json()).filter((x) => /^QQ par/.test(x.name));
  ok(parIds.size === 3 && listed.length === 3, `parallel saves keep unique ids and all three entries (${parIds.size},${listed.length})`);
  for (const id of parIds) await f("DELETE", `/sections/${id}`);
  ok((await f("DELETE", `/sections/${sec.id}`)).ok(), "delete section");
  ok(((await (await f("GET", "/sections")).json()).filter((x) => x.name === "QQ Section")).length === 0, "section gone");
  ok(errs.length === 0, `no errors ${errs}`);
  for (const id of [pg, pg2]) { await f("DELETE", `/pages/${id}`); await f("DELETE", `/pages/${id}/permanent`); }
  await br.close(); process.exit(fail ? 1 : 0);
})();
