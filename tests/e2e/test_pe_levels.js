const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs"); const fs = require("fs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const [w, h, label] of [[1440, 900, "desktop"], [390, 800, "phone"]]) {
    const p = await (await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: w, height: h } })).newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    const t = `[${label}]`;
    await p.goto(`${BASE}/admin/`); await p.waitForSelector("#app:not([hidden])");
    // Three vertical bands of grey: 60, 120, 180.
    const url = await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 90; c.height = 60; const g = c.getContext("2d"); [[60, 0], [120, 30], [180, 60]].forEach(([v, x]) => { g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 30, 60); }); return c.toDataURL("image/png"); });
    const open = async () => { await p.evaluate((u) => window.PhotoEditor.open(u, null), url); await p.waitForSelector("#photo-editor-modal:not([hidden])"); await p.waitForFunction(() => document.getElementById("pe-canvas").width === 90); await p.waitForTimeout(300); };
    await open();
    const px = (x, y) => p.evaluate(([x, y]) => Array.from(document.getElementById("pe-canvas").getContext("2d").getImageData(x, y, 1, 1).data), [x, y]);
    const set = async (id, v) => { await p.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, [id, v]); };
    const click = (id) => p.evaluate((id) => document.getElementById(id).click(), id);
    const note = () => p.textContent("#pe-layer-note");
    for (const id of ["pe-levels-black", "pe-levels-mid", "pe-levels-white", "pe-apply-levels"]) ok(await p.locator(`#${id}`).count() === 1, `${t} #${id} exists`);
    ok((await p.getAttribute("#pe-levels-group", "role")) === "group" && (await p.getAttribute("#pe-levels-group", "aria-label")) === "Levels", `${t} the controls are a labelled group`);
    const g0 = [await px(10, 30), await px(45, 30), await px(75, 30)];
    await click("pe-apply-levels"); await p.waitForTimeout(150);
    ok(/Move Black point, Midtones or White point first/.test(await note()) && (await px(10, 30)).join() === g0[0].join(), `${t} Apply levels with nothing moved says what to do and changes nothing`, await note());
    // the points can not cross
    await set("pe-levels-black", 100);
    await set("pe-levels-white", 90);
    const bw = [await p.inputValue("#pe-levels-black"), await p.inputValue("#pe-levels-white")];
    ok(Number(bw[0]) < Number(bw[1]), `${t} pushing white below black carries black along`, bw);
    await set("pe-levels-black", 254);
    ok((await p.inputValue("#pe-levels-white")) === "255", `${t} and pushing black to the top keeps white one above`, await p.inputValue("#pe-levels-white"));
    await set("pe-levels-black", 0); await set("pe-levels-white", 255);
    // aria-valuetext
    await set("pe-levels-mid", 50);
    ok(/^2\.00 \(brighter\)$/.test(await p.getAttribute("#pe-levels-mid", "aria-valuetext")), `${t} the midtones slider reads as a gamma`, await p.getAttribute("#pe-levels-mid", "aria-valuetext"));
    await set("pe-levels-mid", -50);
    ok(/^0\.50 \(darker\)$/.test(await p.getAttribute("#pe-levels-mid", "aria-valuetext")), `${t} and darker the other way`);
    await set("pe-levels-mid", 0);
    // stretch to the picture's own range
    await set("pe-levels-black", 60); await set("pe-levels-white", 180);
    await p.evaluate(() => { document.getElementById("pe-histogram").open = true; }); await p.waitForTimeout(900);
    const marks = await p.evaluate(() => { const c = document.getElementById("pe-histogram-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const col = (x) => { const i = (5 * c.width + x) * 4; return [d[i], d[i + 1], d[i + 2]]; }; return { black60: col(60), white180: col(180), quiet: col(100) }; });
    ok(marks.black60[0] < 30 && marks.white180[0] > 225 && marks.quiet[0] > 20 && marks.quiet[0] < 225, `${t} the histogram marks both points while the sliders are off their ends`, marks);
    await click("pe-apply-levels"); await p.waitForTimeout(250);
    const after = [await px(10, 30), await px(45, 30), await px(75, 30)];
    ok(after[0][0] === 0 && after[2][0] === 255 && Math.abs(after[1][0] - 128) <= 1 && after[0][3] === 255, `${t} 60 becomes black, 180 becomes white, 120 lands in the middle`, after);
    ok(after.every((a) => a[0] === a[1] && a[1] === a[2]), `${t} greys stay grey`);
    ok((await p.inputValue("#pe-levels-black")) === "0" && (await p.inputValue("#pe-levels-white")) === "255" && (await p.inputValue("#pe-levels-mid")) === "0", `${t} the sliders go back to their ends`);
    ok(/Applied levels: black 60, midtones 1\.00, white 180/.test(await note()), `${t} a note says what was applied`, await note());
    await p.waitForTimeout(700);
    const marks2 = await p.evaluate(() => { const c = document.getElementById("pe-histogram-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const i = (5 * c.width + 60) * 4; return d[i]; });
    ok(marks2 > 20, `${t} and the markers are gone from the histogram`, marks2);
    await p.click("#pe-undo"); await p.waitForTimeout(150);
    ok((await px(10, 30)).join() === g0[0].join() && (await px(75, 30)).join() === g0[2].join(), `${t} one Undo puts it back`);
    // midtones only
    await set("pe-levels-mid", 60); await click("pe-apply-levels"); await p.waitForTimeout(250);
    const bright = await px(45, 30);
    ok(bright[0] > 120 + 20, `${t} brighter midtones lift the middle grey`, bright);
    await p.click("#pe-undo"); await p.waitForTimeout(150);
    // a selection limits it
    await p.evaluate(() => document.querySelector('.pe-tool[data-tool="sel-rect"]').click());
    const r = await p.$eval("#pe-overlay", (e) => { const q = e.getBoundingClientRect(); return { l: q.left, t: q.top, w: q.width, h: q.height }; });
    await p.mouse.move(r.l + r.w * 0.02, r.t + r.h * 0.02); await p.mouse.down(); await p.mouse.move(r.l + r.w * 0.31, r.t + r.h * 0.95, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(200);
    await set("pe-levels-black", 100); await click("pe-apply-levels"); await p.waitForTimeout(250);
    ok((await px(10, 30))[0] === 0 && (await px(75, 30))[0] === 180 && (await px(45, 30))[0] === 120, `${t} with a selection on the left band only that band changes`, [await px(10, 30), await px(45, 30), await px(75, 30)]);
    ok(/inside the selection/.test(await note()), `${t} and the note says so`);
    await p.click("#pe-undo"); await p.waitForTimeout(150);
    // reset button (per-control defaults)
    await set("pe-levels-white", 200);
    const resetVisible = await p.evaluate(() => { const l = document.getElementById("pe-levels-white").closest("label"); const wrap = l.parentElement; return [...wrap.querySelectorAll("button")].some((x) => /reset/i.test(x.getAttribute("aria-label") || x.title || "") && !x.hidden); });
    ok(resetVisible, `${t} a moved levels slider gets its own reset button`);
    await set("pe-levels-white", 255);
    // axe on the group
    await p.addScriptTag({ content: require("./_pw.cjs").axeSource() });
    const viol = await p.evaluate(async () => (await axe.run(document.getElementById("pe-levels-group"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ":" + v.nodes.length));
    ok(viol.length === 0, `${t} axe finds nothing on the Levels group`, viol);
    ok(errs.length === 0, `${t} no page errors`, errs);
    await p.close();
  }
  await b.close();
  console.log(f ? "FAILED " + f : "ALL PASS");
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
