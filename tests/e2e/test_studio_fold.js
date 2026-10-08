// The open track can be folded to its row of controls (the tracks take the room), and on a phone a handle between the playlist and the open
// track sets how tall the open track is: drag it, use the arrow keys, double tap or press Enter to put it back. Both are kept in the browser.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
const axeSrc = axeSource();
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    const mk = async (viewport, extra) => {
      const ctx = await b.newContext(Object.assign({ viewport }, extra || {}));
      await ctx.addInitScript(() => { try { localStorage.setItem("studioTipSeen", "1"); } catch (e) { /* none */ } });
      const p = await ctx.newPage();
      p.errs = []; p.on("pageerror", (e) => p.errs.push(e.message)); p.on("dialog", (d) => d.accept());
      p.open = async () => {
        await p.goto(E2E_BASE + "/studio");
        await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card-main", { timeout: 30000 });
        await p.waitForTimeout(700);
      };
      await p.open();
      return p;
    };
    const h = (p, id) => p.evaluate((i) => Math.round(document.getElementById(i).getBoundingClientRect().height), id);
    const vis = (p, sel) => p.evaluate((q) => { const e = document.querySelector(q); return Boolean(e) && e.offsetParent !== null && getComputedStyle(e).visibility !== "hidden"; }, sel);
    const ls = (p, k) => p.evaluate((key) => localStorage.getItem(key), k);
    const dragSplit = async (p, dy, steps = 8) => {
      const r = await p.evaluate(() => { const e = document.getElementById("studio-split").getBoundingClientRect(); return { x: e.left + e.width / 2, y: e.top + e.height / 2 }; });
      await p.mouse.move(r.x, r.y); await p.mouse.down(); await p.mouse.move(r.x, r.y + dy, { steps }); await p.mouse.up();
      await p.waitForTimeout(250);
    };

    // ======== a phone ========
    const m = await mk({ width: 390, height: 780 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    ok(await vis(m, "#studio-split") && (await m.getAttribute("#studio-split", "role")) === "separator", "on a phone there is a handle between the playlist and the open track");
    const h0 = await h(m, "studio-detail");
    const stack0 = await h(m, "studio-stack");
    await dragSplit(m, -60);
    const h1 = await h(m, "studio-detail");
    ok(h1 > h0 + 40 && h1 < h0 + 80, "dragging the handle up makes the open track taller by about that much", [h0, h1]);
    ok((await h(m, "studio-stack")) < stack0, "and the playlist gives the room up", [stack0, await h(m, "studio-stack")]);
    ok(Number(await ls(m, "studioEditorH")) === h1 && Number(await m.getAttribute("#studio-split", "aria-valuenow")) === h1, "the height is kept and announced (aria-valuenow)", [await ls(m, "studioEditorH"), h1]);
    await dragSplit(m, 400);
    const small = await h(m, "studio-detail");
    ok(small >= 148 && small <= 160, "it cannot be made smaller than the controls and a few rows", small);
    ok(await m.evaluate(() => document.getElementById("studio-grid-scroll").getBoundingClientRect().height > 40), "(the steps are still there to use)");
    await dragSplit(m, -900, 12);
    const big = await h(m, "studio-detail");
    const fits = await m.evaluate(() => { const st = document.getElementById("song-studio"); const k = document.getElementById("studio-keyboard").getBoundingClientRect(); return { over: st.scrollHeight - st.clientHeight, keysBottom: Math.round(k.bottom), h: innerHeight }; });
    ok(big >= h1 - 4 && fits.over <= 4, "and no taller than leaves the keys on the screen", { big, fits });
    await m.reload();
    await m.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card-main", { timeout: 30000 });
    await m.waitForTimeout(700);
    ok(Math.abs((await h(m, "studio-detail")) - big) <= 2, "the height is still there after a reload", [big, await h(m, "studio-detail")]);

    // the keyboard
    await m.focus("#studio-split");
    const before = Number(await m.getAttribute("#studio-split", "aria-valuenow"));
    await m.keyboard.press("ArrowDown");
    await m.waitForTimeout(200);
    const after = Number(await m.getAttribute("#studio-split", "aria-valuenow"));
    ok(after === before - 24, "the arrow keys change it 24 px at a time (down is smaller)", [before, after]);
    await m.keyboard.press("Home");
    ok(Number(await m.getAttribute("#studio-split", "aria-valuenow")) === 150, "Home makes it as small as it goes", await m.getAttribute("#studio-split", "aria-valuenow"));
    await m.keyboard.press("Enter");
    await m.waitForTimeout(250);
    ok(!(await ls(m, "studioEditorH")) && Math.abs((await h(m, "studio-detail")) - h0) <= 3, "Enter puts it back to automatic", [await ls(m, "studioEditorH"), await h(m, "studio-detail"), h0]);
    await dragSplit(m, -50);
    ok(Boolean(await ls(m, "studioEditorH")), "(a height again)");
    const hr = await m.evaluate(() => { const e = document.getElementById("studio-split").getBoundingClientRect(); return { x: e.left + e.width / 2, y: e.top + e.height / 2 }; });
    await m.mouse.click(hr.x, hr.y); await m.mouse.click(hr.x, hr.y);
    await m.waitForTimeout(250);
    ok(!(await ls(m, "studioEditorH")), "two quick taps on the handle do the same");

    // folding
    const rowsBefore = await m.evaluate(() => Math.round(document.querySelector("#studio-stack .studio-card").getBoundingClientRect().height));
    await m.click("#studio-fold");
    await m.waitForTimeout(400);
    const folded = await m.evaluate(() => ({ grid: document.getElementById("studio-grid-scroll").offsetParent !== null, pager: document.getElementById("studio-pager").offsetParent !== null, detail: Math.round(document.getElementById("studio-detail").getBoundingClientRect().height), row: Math.round(document.querySelector("#studio-stack .studio-card").getBoundingClientRect().height), expanded: document.getElementById("studio-fold").getAttribute("aria-expanded"), split: document.getElementById("studio-split").offsetParent !== null }));
    ok(!folded.grid && !folded.pager && folded.detail < 90 && folded.expanded === "false" && !folded.split, "Fold leaves only the open track's row of controls", folded);
    ok(folded.row > rowsBefore + 10 && folded.row <= 72, "and the tracks above take the room (taller rows)", [rowsBefore, folded.row]);
    ok(await vis(m, "#studio-play") && await vis(m, "#studio-keys"), "the play controls and the keys are still there");
    await m.reload();
    await m.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card-main", { timeout: 30000 });
    await m.waitForTimeout(600);
    ok(!(await vis(m, "#studio-grid-scroll")) && (await m.getAttribute("#studio-fold", "aria-expanded")) === "false", "it stays folded after a reload");
    await m.click('#studio-stack [data-pick="melody"]');
    await m.waitForTimeout(300);
    ok(!(await vis(m, "#studio-grid-scroll")) && /Melody/.test(await m.textContent("#studio-detail h2")), "and stays folded when another track is chosen");
    await m.click("#studio-fold");
    await m.waitForTimeout(400);
    ok(await vis(m, "#studio-grid-scroll") && (await m.getAttribute("#studio-fold", "aria-expanded")) === "true" && await vis(m, "#studio-split"), "Open brings the editor back");

    // axe in both themes, with the handle in place
    await m.addScriptTag({ content: axeSrc }).catch(() => {});
    for (const theme of ["dark", "light"]) {
      await m.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await m.waitForTimeout(250);
      const v = await m.evaluate(async () => (await axe.run(document.getElementById("song-studio"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" ; ")));
      ok(v.length === 0, `axe: the Studio on a phone is clean in the ${theme} theme`, v);
    }
    ok(m.errs.length === 0, "no page errors on the phone", m.errs);
    await m.context().close();

    // ======== a desktop window: no handle, but it folds ========
    const d = await mk({ width: 1280, height: 900 });
    ok(!(await vis(d, "#studio-split")), "on a wide screen there is no handle (the layout there is a grid)");
    const dh0 = await h(d, "studio-detail");
    await d.click("#studio-fold");
    await d.waitForTimeout(400);
    const dh1 = await h(d, "studio-detail");
    const dr = await d.evaluate(() => Math.round(document.querySelector("#studio-stack .studio-card").getBoundingClientRect().height));
    ok(dh1 < 90 && dh1 < dh0 && dr > 30 && dr <= 72, "Fold works here too: the open track is one row and the rows get taller", [dh0, dh1, dr]);
    await d.click("#studio-fold");
    await d.waitForTimeout(400);
    ok(Math.abs((await h(d, "studio-detail")) - dh0) <= 3 && (await vis(d, "#studio-grid-scroll")), "and opens again as it was", [dh0, await h(d, "studio-detail")]);
    ok(d.errs.length === 0, "no page errors on the desktop", d.errs);
    await d.context().close();
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
