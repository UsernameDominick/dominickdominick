// The block bar: selecting a block shows its controls as pills at the bottom of the editor. A chip for the block (opens the quick
// editor), one for its width (× back to full), one for each style setting it has (× clears it), + to add a setting, a dropdown pill
// for its main choice (a heading's level), ⋯ for copy/duplicate/lock/fit/delete, and a round Done. Also axe in dark and light, and a phone.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
const axeSrc = require("./_pw.cjs").axeSource();
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const f = (m, p, b) => c.fetch(E2E_BASE + "/api/admin" + p, { method: m, data: b });
  const pg = await (await f("POST", "/pages", { title: "QQ Block Bar", slug: "qq-block-bar-" + Date.now() })).json();
  const add = (type, content, col, row, cs, rs) => f("POST", `/pages/${pg.id}/blocks`, { type, content, col, row, col_span: cs, row_span: rs });
  await add("heading", { text: "QQ Bar heading", level: 2 }, 1, 1, 24, 3);
  await add("text", { text: "QQ text under the heading, long enough to be a paragraph." }, 1, 6, 24, 4);
  const blocks = async () => (await (await f("GET", `/pages/${pg.id}/blocks`)).json());
  const heading = async () => (await blocks()).find((x) => x.type === "heading");
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, storageState: process.env.ADMIN_STATE });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
  const vis = (sel) => p.evaluate((q) => { const e = document.querySelector(q); return !!e && !e.hidden && e.getBoundingClientRect().width > 0; }, sel);
  const chipTexts = () => p.$$eval("#block-bar .bb-chip-main", (x) => x.map((y) => y.textContent.trim()));
  const settle = () => p.waitForTimeout(700);
  const axeBar = async () => {
    await p.addScriptTag({ content: axeSrc }).catch(() => {});
    await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, { timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(250);
    return p.evaluate(async () => {
      const out = [];
      for (const id of ["block-bar", "bb-pop"]) {
        const node = document.getElementById(id);
        if (!node || node.hidden) continue;
        (await axe.run(node, { resultTypes: ["violations"] })).violations.forEach((v) => out.push(id + " " + v.id + ": " + v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" ; ")));
      }
      return out;
    });
  };
  try {
    await p.goto(E2E_BASE + "/admin/"); await p.waitForSelector("#app:not([hidden])");
    await p.selectOption("#page-picker", String(pg.id)); await p.waitForSelector("#canvas .admin-block"); await p.waitForTimeout(400);
    ok(!(await vis("#block-bar")), "no bar before a block is selected");
    await p.click('#canvas .admin-block:has-text("QQ Bar heading")');
    await p.waitForSelector("#block-bar:not([hidden])");
    let chips = await chipTexts();
    ok(chips[0] === "Heading" && chips[1] === "Full width" && chips.length === 2, "selecting a block shows its chips: the block and its width", chips);
    ok((await p.textContent("#block-bar .bb-choice")).trim() === "H2", "the dropdown pill shows the heading's level");
    const geo = await p.evaluate(() => { const r = document.getElementById("block-bar").getBoundingClientRect(); return { bottom: innerHeight - r.bottom, left: r.left, right: innerWidth - r.right }; });
    ok(geo.bottom >= 8 && geo.bottom <= 30 && geo.left > 0 && geo.right > 0, "the bar floats at the bottom of the window", geo);

    // the dropdown pill: the main choice
    await p.click("#block-bar .bb-choice");
    ok(await vis("#bb-pop .bb-menu"), "the pill opens the choice list");
    ok(await p.getAttribute("#block-bar .bb-choice", "aria-expanded") === "true", "and says it is open");
    await p.click('#bb-pop button[data-value="3"]'); await settle();
    ok((await heading()).content.level === 3 && (await p.textContent("#block-bar .bb-choice")).trim() === "H3", "picking H3 saves it and the pill shows it");

    // + adds a setting, which becomes a chip
    await p.click('#block-bar [data-action="add"]');
    ok(await vis("#bb-pop .bb-menu") && /Shadow/.test(await p.textContent("#bb-pop")), "+ lists the settings this block can take");
    await p.click('#bb-pop button[data-key="shadow"]');
    ok(await vis("#bb-pop select[data-key='shadow']"), "choosing one asks for its value right there");
    await p.selectOption("#bb-pop select[data-key='shadow']", "md"); await settle();
    ok((await heading()).style.shadow === "md", "the value is saved at once");
    chips = await chipTexts();
    ok(chips.includes("Shadow · Medium"), "and it is a chip now", chips);
    await p.click("#bb-pop .bb-field-done");
    ok(!(await vis("#bb-pop")), "Done closes the panel");

    // a chip opens its own setting; × clears it
    await p.click('#block-bar [data-action="style"][data-key="shadow"]');
    ok(await vis("#bb-pop select[data-key='shadow']"), "a chip opens its setting");
    await p.keyboard.press("Escape");
    ok(!(await vis("#bb-pop")) && await p.evaluate(() => document.activeElement && document.activeElement.dataset.key === "shadow"), "Escape closes it and gives the focus back to the chip");
    await p.click('#block-bar [data-clear="shadow"]'); await settle();
    ok(!("shadow" in ((await heading()).style || {})) && !(await chipTexts()).some((t) => /Shadow/.test(t)), "× takes the setting off");

    // width
    await p.click('#block-bar [data-action="size"]');
    ok(await vis("#bb-pop .size-menu"), "the width chip opens the width and position choices");
    await p.click('#bb-pop .size-menu button[data-span="12"]'); await settle();
    ok((await heading()).col_span === 12 && (await chipTexts()).includes("½ width"), "half width is saved and shown", await chipTexts());
    await p.click('#block-bar [data-clear="size"]'); await settle();
    ok((await heading()).col_span === 24 && (await chipTexts()).includes("Full width"), "× puts it back to the full width");

    // ⋯: duplicate, lock (a Locked chip whose × unlocks), delete off while locked
    await p.click('#block-bar [data-action="more"]');
    await p.click('#bb-pop button[data-action="duplicate-block-btn"]'); await settle();
    ok((await blocks()).filter((x) => x.type === "heading").length === 2, "⋯ Duplicate copies the block");
    await p.click('#block-bar [data-action="more"]');
    await p.click('#bb-pop button[data-action="lock-block-btn"]'); await settle();
    ok((await chipTexts()).includes("Locked"), "⋯ Lock shows a Locked chip", await chipTexts());
    await p.click('#block-bar [data-action="more"]');
    ok(await p.evaluate(() => document.querySelector('#bb-pop button[data-action="delete-block-btn"]').disabled), "Delete is off while it is locked");
    await p.keyboard.press("Escape");
    await p.click('#block-bar [data-clear="lock"]'); await settle();
    ok(!(await chipTexts()).includes("Locked"), "the Locked chip's × unlocks it");

    // the block chip opens the quick editor
    await p.click('#block-bar [data-action="edit"]');
    ok(await vis("#quick-edit"), "the block's chip opens its quick editor");
    await p.click(".quick-edit-done");

    // axe, dark then light
    await p.click('#block-bar [data-action="add"]');
    let viol = await axeBar();
    ok(viol.length === 0, "axe: the bar and its menu are clean (dark)", viol);
    await p.keyboard.press("Escape");
    await p.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await p.click('#block-bar [data-action="more"]');
    viol = await axeBar();
    ok(viol.length === 0, "axe: clean in light too", viol);
    await p.screenshot({ path: require("os").tmpdir() + "/block_bar_light.png" });
    await p.keyboard.press("Escape");
    await p.evaluate(() => document.documentElement.removeAttribute("data-theme"));

    // Done
    await p.click('#block-bar [data-action="done"]');
    ok(!(await vis("#block-bar")), "Done puts the bar away");

    // a phone: a tap on a block shows the bar (no drawer), and nothing runs off the screen
    await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(500);
    await p.click('#canvas .admin-block:has-text("QQ text under")');
    await p.waitForSelector("#block-bar:not([hidden])");
    const phone = await p.evaluate(() => { const r = document.getElementById("block-bar").getBoundingClientRect(); return { left: r.left, right: innerWidth - r.right, over: document.documentElement.scrollWidth - innerWidth, drawer: document.getElementById("inspector").classList.contains("drawer-open") }; });
    ok(phone.left >= 0 && phone.right >= 0 && phone.over <= 0, "on a phone the bar fits the screen", phone);
    ok(!phone.drawer, "and the tap did not throw the inspector over the page", phone);
    await p.click('#block-bar [data-action="more"]');
    await p.click('#bb-pop button[data-action="settings"]'); await p.waitForTimeout(400);
    ok(await vis("#inspector"), "⋯ All settings opens the inspector");
    ok(errs.length === 0, "no page errors", errs);
  } finally {
    await f("DELETE", `/pages/${pg.id}`);
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
