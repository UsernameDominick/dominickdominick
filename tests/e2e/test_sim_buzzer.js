const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs"); const fs = require("fs");
const probe = require("./audio_probe.js");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const w = (id, a, ap, b, bp) => ({ id, from: { compId: a, pin: ap }, to: { compId: b, pin: bp }, kind: "wire" });
  const components = [
    { id: "b1", type: "battery", x: 40, y: 60, voltage: 9 }, { id: "z1", type: "buzzer", x: 200, y: 60 },
    { id: "b2", type: "battery", x: 40, y: 260, voltage: 2 }, { id: "z2", type: "buzzer", x: 200, y: 260 },
    { id: "b3", type: "battery", x: 40, y: 460, voltage: 12 }, { id: "z3", type: "buzzer", x: 200, y: 460 },
  ];
  const wires = [w("a1", "b1", "pos", "z1", "p1"), w("a2", "z1", "p2", "b1", "neg"), w("c1", "b2", "pos", "z2", "p1"), w("c2", "z2", "p2", "b2", "neg"), w("d1", "b3", "pos", "z3", "p1"), w("d2", "z3", "p2", "b3", "neg")];
  const name = "QQ Buzzer Test " + Date.now();
  const created = await (await c.fetch(`${BASE}/api/admin/simulations`, { method: "POST", data: { name, data: { components, wires } } })).json();
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(probe);
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("dialog", (d) => d.accept());
  try {
    await p.goto(`${BASE}/admin/`, { waitUntil: "networkidle" }); await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("simulations-btn").click()); await p.waitForTimeout(700);
    await p.evaluate((n) => { const row = [...document.querySelectorAll("#simulations-modal .simulation-row")].find((r) => r.textContent.includes(n)); [...row.querySelectorAll("button")].find((x) => x.textContent.trim() === "Edit").click(); }, name);
    await p.waitForTimeout(1200);
    const audio = () => p.evaluate(() => ({ ...window.__audio }));
    const attrs = (id) => p.$eval(`#sim-builder-svg .sim-comp[data-id="${id}"]`, (e) => ({ sounding: e.getAttribute("data-sounding"), cls: e.getAttribute("class") }));
    const pick = async (id) => { const box = await p.evaluate((i) => { const el = document.querySelector(`#sim-builder-svg .sim-comp[data-id="${i}"] .buzzer-body`); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id); await p.mouse.click(box.x, box.y); await p.waitForTimeout(300); };
    ok((await p.locator('.sim-palette-btn[data-sim-type="buzzer"]').count()) === 1, "the palette offers a Buzzer");
    ok((await p.locator("#sim-builder-svg .buzzer-body").count()) === 3, "all three buzzers draw their sounder");
    ok((await audio()).started === 0, "opening the builder starts no sound", await audio());
    const z1 = await attrs("z1"), z2 = await attrs("z2"), z3 = await attrs("z3");
    ok(z1.sounding === "true" && !/sim-damaged/.test(z1.cls), "the 9 V buzzer is marked sounding", z1);
    ok(z2.sounding === "false", "the 2 V one is not (too quiet)", z2);
    ok(z3.sounding === "false" && /sim-damaged/.test(z3.cls), "the 12 V one is damaged and silent", z3);
    await pick("z1"); let t = await p.textContent("#sim-inspector");
    ok(/Buzzing — 36\.0mA flowing, 0\.32W of its 0\.5W rating/.test(t), "the inspector says Buzzing with its current and power", t.replace(/\s+/g, " ").slice(0, 300));
    ok(/Electrical: a small buzzer/.test(t), "and explains the part");
    ok((await p.inputValue("#sim-comp-resistance")) === "250", "the resistance field starts at 250");
    ok((await audio()).started === 0, "selecting a buzzer on the canvas does not make a sound", await audio());
    const btn = p.locator("#sim-buzzer-play");
    ok((await btn.count()) === 1 && (await btn.textContent()) === "Hear it", "there is a Hear it button");
    await btn.click(); await p.waitForTimeout(200);
    let a = await audio();
    ok(a.started === 1 && a.contexts === 1, "pressing it plays one tone", a);
    ok((await p.textContent("#sim-buzzer-play")) === "Stop the sound", "and the button offers to stop it");
    await p.click("#sim-buzzer-play"); await p.waitForTimeout(300);
    a = await audio();
    ok(a.stopped >= 1 && (await p.evaluate(() => !window.SimBuzzer.playing())), "pressing again stops it", a);
    await p.click("#sim-buzzer-play"); await p.waitForTimeout(1700);
    ok(await p.evaluate(() => !window.SimBuzzer.playing()), "left alone it ends by itself after about a second");
    await pick("z2"); t = await p.textContent("#sim-inspector");
    ok(/Too quiet — it gets 2\.0V and needs about 2\.5V/.test(t) && (await p.locator("#sim-buzzer-play").count()) === 0, "the 2 V buzzer's inspector says too quiet and offers no sound", t.replace(/\s+/g, " ").slice(0, 300));
    await pick("z3"); t = await p.textContent("#sim-inspector");
    ok(/Burning out — 0\.58W is well over the 0\.5W a small buzzer can take/.test(t) && (await p.locator("#sim-buzzer-play").count()) === 0, "the 12 V buzzer's inspector says it is burning out", t.replace(/\s+/g, " ").slice(0, 300));
    await p.click("#sim-warnings-btn"); await p.waitForSelector("#sim-warnings-modal:not([hidden])"); const wt = await p.textContent("#sim-warnings-body");
    ok(/would burn out: it is given 0\.58 W against a typical 0\.5 W rating/.test(wt) && /gets only 2\.0 V, too little to sound \(it needs about 2\.5 V\)/.test(wt), "the warnings dialog covers both", wt.replace(/\s+/g, " ").slice(0, 400)); await p.click("#close-sim-warnings");
    // raising the resistance of the 12 V one calms it
    await p.fill("#sim-comp-resistance", "600"); await p.dispatchEvent("#sim-comp-resistance", "change"); await p.waitForTimeout(500);
    ok((await attrs("z3")).sounding === "true" && !/sim-damaged/.test((await attrs("z3")).cls), "at 600 ohms the 12 V buzzer is fine and sounding (0.24 W)", await attrs("z3"));
    // add from the palette
    const before = await p.locator("#sim-builder-svg .sim-comp-buzzer").count(); await p.click('.sim-palette-btn[data-sim-type="buzzer"]'); await p.waitForTimeout(400);
    ok((await p.locator("#sim-builder-svg .sim-comp-buzzer").count()) === before + 1, "clicking the palette adds a buzzer");
    // schematic
    await p.evaluate(() => { const b = document.getElementById("sim-schematic-toggle") || [...document.querySelectorAll("button")].find((x) => /schematic/i.test(x.textContent)); b && b.click(); }); await p.waitForTimeout(300);
    ok((await p.locator("#sim-builder-svg .sch-buzzer-body").count()) >= 3, "the schematic view has the buzzer symbol");
    await p.click("#sim-model-notes-btn"); await p.waitForSelector("#sim-model-modal:not([hidden])"); const mt = await p.textContent("#sim-model-body");
    ok(/Buzzer/.test(mt) && /lamps and buzzers 0\.5 W/.test(mt), "the model notes cover the buzzer and its rating", mt.replace(/\s+/g, " ").slice(0, 160)); await p.click("#close-sim-model");
    const titles = await p.$$eval('#sim-builder-svg circle.sim-pin[data-comp="z1"] title', (n) => n.map((x) => x.textContent).sort().join()); ok(titles === "Lead 1,Lead 2", "pins have hover titles", titles);
    await p.addScriptTag({ content: require("./_pw.cjs").axeSource() });
    await pick("z1");
    const viol = await p.evaluate(async () => (await axe.run(document.getElementById("sim-inspector"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ":" + v.nodes.length));
    ok(viol.length === 0, "axe finds nothing in the inspector", viol);
    ok(errs.length === 0, "no page errors", errs);
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300); ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "phone: no page overflow");
  } finally { await c.fetch(`${BASE}/api/admin/simulations/${created.id}`, { method: "DELETE" }); await b.close(); }
  console.log(f ? "FAILURES " + f : "ALL PASS"); process.exit(f ? 1 : 0);
})();
