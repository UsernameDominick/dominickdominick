const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs"); const fs = require("fs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const w = (id, a, ap, b, bp) => ({ id, from: { compId: a, pin: ap }, to: { compId: b, pin: bp }, kind: "wire" });
  const components = [
    { id: "b1", type: "battery", x: 40, y: 60, voltage: 9 }, { id: "l1", type: "lamp", x: 200, y: 60 },
    { id: "b2", type: "battery", x: 40, y: 260, voltage: 12 }, { id: "l2", type: "lamp", x: 200, y: 260 },
    { id: "b3", type: "battery", x: 40, y: 460, voltage: 9 }, { id: "l3", type: "lamp", x: 200, y: 460 },
  ];
  const wires = [w("a1", "b1", "pos", "l1", "p1"), w("a2", "l1", "p2", "b1", "neg"), w("c1", "b2", "pos", "l2", "p1"), w("c2", "l2", "p2", "b2", "neg"), w("d1", "b3", "pos", "l3", "p1")];
  const name = "QQ Lamp Test " + Date.now();
  const created = await (await c.fetch(`${BASE}/api/admin/simulations`, { method: "POST", data: { name, data: { components, wires } } })).json();
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const p = await (await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 1000 } })).newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("dialog", (d) => d.accept());
  try {
    await p.goto(`${BASE}/admin/`, { waitUntil: "networkidle" }); await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("simulations-btn").click()); await p.waitForTimeout(700);
    await p.evaluate((n) => { const row = [...document.querySelectorAll("#simulations-modal .simulation-row")].find((r) => r.textContent.includes(n)); [...row.querySelectorAll("button")].find((x) => x.textContent.trim() === "Edit").click(); }, name);
    await p.waitForTimeout(1200);
    const attrs = (id) => p.$eval(`#sim-builder-svg .sim-comp[data-id="${id}"]`, (e) => ({ powered: e.getAttribute("data-powered"), style: e.getAttribute("style") || "", cls: e.getAttribute("class") }));
    const pick = async (id) => { const box = await p.evaluate((i) => { const el = document.querySelector(`#sim-builder-svg .sim-comp[data-id="${i}"] .lamp-glass`); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id); await p.mouse.click(box.x, box.y); await p.waitForTimeout(300); };
    ok((await p.locator('.sim-palette-btn[data-sim-type="lamp"]').count()) === 1, "the palette offers a Lamp");
    ok((await p.locator("#sim-builder-svg .lamp-glass").count()) === 3, "all three lamps draw their bulb");
    const l1 = await attrs("l1"), l2 = await attrs("l2"), l3 = await attrs("l3");
    ok(l1.powered === "true" && /--lamp-level:0\.90/.test(l1.style) && !/sim-damaged/.test(l1.cls), "the 9 V lamp glows at 90%", l1);
    ok(/sim-damaged/.test(l2.cls) && l2.powered === "true", "the 12 V lamp is marked damaged", l2);
    ok(l3.powered === "false" && !/--lamp-level/.test(l3.style), "the lamp with a dangling lead stays dark", l3);
    // computed look: lit glass is warm yellow with the glow filter, the dark one is not
    const look = async (id) => p.$eval(`#sim-builder-svg .sim-comp[data-id="${id}"] .lamp-glass`, (e) => { const cs = getComputedStyle(e); return { fill: cs.fill, opacity: cs.opacity, filter: cs.filter }; });
    await p.evaluate(() => { document.querySelector("#sim-builder-svg").classList.add("is-on"); });
    await p.waitForTimeout(600); // the glass fades in over 0.3 s
    const g1 = await look("l1"), g2 = await look("l2"), g3 = await look("l3");
    ok(/255, 211, 78/.test(g1.fill) && Number(g1.opacity) > 0.85 && /url|drop-shadow|blur/.test(g1.filter), "lit glass is warm yellow, nearly full opacity, with the glow filter", g1);
    ok(/42, 24, 16/.test(g2.fill) && g2.filter === "none", "the burnt lamp's glass is scorched dark with no glow", g2);
    ok(!/255, 211, 78/.test(g3.fill), "the unpowered lamp's glass is not yellow", g3);
    await pick("l1"); let t = await p.textContent("#sim-inspector");
    ok(/Lit at about 90%/.test(t) && /50\.0mA/.test(t) && /0\.45W/.test(t), "the inspector reports how bright it is and its current and power", t.replace(/\s+/g, " ").slice(0, 400));
    ok(/Electrical: a small incandescent bulb/.test(t), "the inspector explains the part", t.replace(/\s+/g, " ").slice(0, 200));
    ok((await p.inputValue("#sim-comp-resistance")) === "180", "the resistance field starts at 180");
    await pick("l2"); t = await p.textContent("#sim-inspector");
    ok(/Burning out — 0\.80W is well over the 0\.5W/.test(t), "the 12 V lamp's inspector says it is burning out", t.replace(/\s+/g, " ").slice(0, 300));
    await p.click("#sim-warnings-btn"); await p.waitForSelector("#sim-warnings-modal:not([hidden])"); const wt = await p.textContent("#sim-warnings-body");
    ok(/would burn out: it is given 0\.80 W against a typical 0\.5 W rating/.test(wt), "the warnings dialog names the lamp", wt.replace(/\s+/g, " ").slice(0, 300)); await p.click("#close-sim-warnings");
    // edit resistance: a bigger value makes it dimmer and safe
    await p.fill("#sim-comp-resistance", "600"); await p.dispatchEvent("#sim-comp-resistance", "change"); await p.waitForTimeout(500);
    const l2b = await attrs("l2");
    ok(!/sim-damaged/.test(l2b.cls) && /--lamp-level:0\.4[0-9]|--lamp-level:0\.2[0-9]|--lamp-level:0\.3[0-9]/.test(l2b.style), "raising the resistance to 600 ohms calms it down (12 V is 0.24 W)", l2b);
    await pick("l2"); t = await p.textContent("#sim-inspector");
    ok(/Lit at about 48%/.test(t), "and the inspector says so", t.replace(/\s+/g, " ").slice(0, 200));
    // add one from the palette, rotate-free: it appears with the default resistance
    const before = await p.locator("#sim-builder-svg .sim-comp-lamp").count(); await p.click('.sim-palette-btn[data-sim-type="lamp"]'); await p.waitForTimeout(400);
    ok((await p.locator("#sim-builder-svg .sim-comp-lamp").count()) === before + 1, "clicking the palette adds a lamp");
    // schematic view
    await p.evaluate(() => { const b = document.getElementById("sim-schematic-toggle") || [...document.querySelectorAll("button")].find((x) => /schematic/i.test(x.textContent)); b && b.click(); }); await p.waitForTimeout(300);
    ok((await p.locator("#sim-builder-svg .sch-lamp-body").count()) >= 3, "the schematic view has the lamp symbol");
    const sch = await p.$eval('#sim-builder-svg .sim-comp[data-id="l1"] .sch-lamp-body', (e) => ({ fill: getComputedStyle(e).fill, disp: getComputedStyle(e.closest(".sim-art-schem")).display }));
    ok(sch.disp !== "none", "and it is the visible one", sch);
    // notes and checklist
    await p.click("#sim-model-notes-btn"); await p.waitForSelector("#sim-model-modal:not([hidden])"); const mt = await p.textContent("#sim-model-body");
    ok(/Lamp/.test(mt) && /lamps and buzzers 0\.5 W/.test(mt), "the model notes cover the lamp and its rating", mt.replace(/\s+/g, " ").slice(0, 160)); await p.click("#close-sim-model");
    const titles = await p.$$eval('#sim-builder-svg circle.sim-pin[data-comp="l1"] title', (n) => n.map((x) => x.textContent).sort().join()); ok(titles === "Lead 1,Lead 2", "pins have hover titles", titles);
    // a11y of the builder palette area
    await p.addScriptTag({ content: require("./_pw.cjs").axeSource() });
    const viol = await p.evaluate(async () => (await axe.run(document.getElementById("sim-inspector"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ":" + v.nodes.length));
    ok(viol.length === 0, "axe finds nothing in the inspector", viol);
    ok(errs.length === 0, "no page errors", errs);
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300); ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "phone: no page overflow");
  } finally { await c.fetch(`${BASE}/api/admin/simulations/${created.id}`, { method: "DELETE" }); await b.close(); }
  console.log(f ? "FAILURES " + f : "ALL PASS"); process.exit(f ? 1 : 0);
})();
