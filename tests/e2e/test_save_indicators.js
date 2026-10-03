const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const errs = []; const dialogs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("dialog", (d) => { dialogs.push(d.message()); d.type() === "prompt" ? d.accept("QQ cp") : d.accept(); });
  await p.goto(`${BASE}/admin/`); await p.waitForSelector("#app:not([hidden])");
  const st = (id) => p.evaluate((i) => { const e = document.getElementById(i); return { t: e.textContent.trim(), s: e.dataset.state || "" }; }, id);
  // simulation
  await p.click("#simulations-btn"); await p.waitForTimeout(300); await p.click("#new-simulation-btn"); await p.waitForSelector("#simulation-builder-modal:not([hidden])"); await p.waitForTimeout(300);
  ok((await st("sim-save-status")).t === "", "fresh simulation: no status");
  await p.fill("#simulation-name", "QQ Save Indicator Sim");
  let s1 = await st("sim-save-status"); ok(/Unsaved/.test(s1.t) && s1.s === "dirty", "editing the name shows Unsaved (dirty pill)", s1);
  await p.click("#save-simulation"); await p.waitForTimeout(800);
  s1 = await st("sim-save-status"); ok(/^Saved/.test(s1.t) && s1.s === "saved", "saving shows Saved (saved pill)", s1);
  ok(!dialogs.some((d) => /^Saved/.test(d)), "no pop-up Saved dialog", dialogs);
  await p.click('.sim-palette-btn[data-sim-type="resistor"]'); await p.waitForTimeout(200);
  s1 = await st("sim-save-status"); ok(/Unsaved/.test(s1.t), "placing a part marks unsaved", s1);
  // undo back to the saved circuit reads Saved again; redo reads Unsaved
  s1 = await st("sim-save-status"); const savedText = (await st("sim-save-status")).t;
  await p.click("#sim-save-status").catch(() => {});
  await p.click("#save-simulation"); await p.waitForTimeout(700);
  const saved2 = await st("sim-save-status"); ok(/^Saved/.test(saved2.t), "saved again", saved2);
  await p.click('.sim-palette-btn[data-sim-type="led"]'); await p.waitForTimeout(200);
  ok(/Unsaved/.test((await st("sim-save-status")).t), "another part marks unsaved");
  await p.click("#sim-undo"); await p.waitForTimeout(300);
  const backToSaved = await st("sim-save-status"); ok(backToSaved.t === saved2.t && backToSaved.s === "saved", "undoing back to the saved circuit reads Saved again", backToSaved);
  await p.click("#sim-redo"); await p.waitForTimeout(300);
  ok(/Unsaved/.test((await st("sim-save-status")).t), "redo reads Unsaved");
  await p.click("#sim-undo"); await p.waitForTimeout(300);
  // poster URL edit
  await p.fill("#sim-poster-url", "https://example.com/p.png"); await p.waitForTimeout(150);
  ok(/Unsaved/.test((await st("sim-save-status")).t), "editing the poster URL marks unsaved");
  await p.fill("#sim-poster-url", ""); await p.waitForTimeout(150);
  ok((await st("sim-save-status")).t === saved2.t, "clearing it again reads Saved");
  // checkpoint save marks unsaved
  await p.click("#sim-checkpoint-save"); await p.waitForTimeout(400);
  ok(/Unsaved/.test((await st("sim-save-status")).t), "saving a checkpoint marks unsaved");
  // clean up the QQ simulation
  const list = await (await c.fetch((E2E_BASE + "/api/admin/simulations"))).json();
  for (const sim of list.filter((x) => x.name === "QQ Save Indicator Sim")) await c.fetch(`${E2E_BASE}/api/admin/simulations/${sim.id}`, { method: "DELETE" });
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); console.log(f ? "FAILURES " + f : "ALL PASS"); process.exit(f ? 1 : 0);
})();
