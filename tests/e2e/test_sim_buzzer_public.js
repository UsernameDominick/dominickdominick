const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
const probe = require("./audio_probe.js");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const w = (id, a, ap, b, bp) => ({ id, from: { compId: a, pin: ap }, to: { compId: b, pin: bp }, kind: "wire" });
  // one circuit: a 9 V battery across a buzzer (sounds) and, in parallel, a second one behind a 1 k resistor (1.8 V: too quiet)
  const data = { components: [{ id: "b1", type: "battery", x: 40, y: 60, voltage: 9 }, { id: "z1", type: "buzzer", x: 200, y: 60 }, { id: "r1", type: "resistor", x: 300, y: 60, resistance: 1000 }, { id: "z2", type: "buzzer", x: 420, y: 60 }],
    wires: [w("a1", "b1", "pos", "z1", "p1"), w("a2", "z1", "p2", "b1", "neg"), w("a3", "b1", "pos", "r1", "p1"), w("a4", "r1", "p2", "z2", "p1"), w("a5", "z2", "p2", "b1", "neg")] };
  const created = await (await c.fetch(`${BASE}/api/admin/simulations`, { method: "POST", data: { name: "QQ Buzzer Public", data } })).json();
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    for (const [width, height, label] of [[1200, 900, "desktop"], [390, 800, "phone"]]) {
      const ctx = await b.newContext({ viewport: { width, height } });
      await ctx.addInitScript(probe);
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
      const t = `[${label}]`;
      const pub = await c.fetch(`${BASE}/api/admin/simulations/${created.id}/publish`, { method: "POST" });
      if (pub.status() !== 200) ok(false, `${t} publishes`, pub.status());
      await p.goto(`${BASE}/simulation/${created.id}`, { waitUntil: "domcontentloaded" });
      await p.waitForSelector(".sim-svg");
      await p.waitForTimeout(500);
      const audio = () => p.evaluate(() => ({ ...window.__audio }));
      const playing = () => p.evaluate(() => (window.SimBuzzer ? window.SimBuzzer.playing() : null));
      ok(await p.evaluate(() => typeof window.SimBuzzer === "object"), `${t} the sound module is loaded on a page with a buzzer`);
      ok((await audio()).started === 0, `${t} loading the page makes no sound`, await audio());
      const part = (id) => p.locator(`.sim-svg .sim-comp[data-id="${id}"]`);
      ok((await part("z1").getAttribute("data-sounding")) === "true" && (await part("z2").getAttribute("data-sounding")) === "false", `${t} only the driven buzzer is marked sounding`);
      // power off: clicking does nothing
      await part("z1").click(); await p.waitForTimeout(200);
      ok((await audio()).started === 0, `${t} clicking a buzzer while the power is off is silent`, await audio());
      await p.click(".sim-power-btn:not(.sim-view-btn)"); await p.waitForTimeout(300);
      ok((await audio()).started === 0, `${t} switching the power on is silent too`, await audio());
      // arcs visible when on
      const arc = await p.$eval('.sim-svg .sim-comp[data-id="z1"] .buzzer-wave-1', (e) => getComputedStyle(e).opacity);
      ok(Number(arc) > 0.2, `${t} the arcs show beside a sounding buzzer once the power is on`, arc);
      const arcQuiet = await p.$eval('.sim-svg .sim-comp[data-id="z2"] .buzzer-wave-1', (e) => getComputedStyle(e).opacity);
      ok(Number(arcQuiet) === 0, `${t} and not beside the quiet one`, arcQuiet);
      // click: plays
      await part("z1").click(); await p.waitForTimeout(250);
      let a = await audio();
      ok(a.started === 1 && (await playing()) === true, `${t} clicking the sounding buzzer plays one tone`, a);
      await part("z1").click(); await p.waitForTimeout(250);
      ok((await playing()) === false, `${t} clicking again stops it`);
      // click the quiet one: no tone
      await part("z2").click(); await p.waitForTimeout(250);
      ok((await audio()).started === 1 && (await playing()) === false, `${t} the quiet buzzer makes no sound when clicked`, await audio());
      // readout still works
      ok(/Buzzer — 250 Ω/.test(await p.textContent(".sim-readout")), `${t} and its readout still shows`, await p.textContent(".sim-readout"));
      // keyboard
      await part("z1").focus(); await p.keyboard.press("Enter"); await p.waitForTimeout(250);
      ok((await playing()) === true, `${t} Enter on a focused buzzer plays it`);
      // power off stops it
      await p.click(".sim-power-btn:not(.sim-view-btn)"); await p.waitForTimeout(300);
      ok((await playing()) === false, `${t} switching the power off ends the sound`);
      // it ends by itself
      await p.click(".sim-power-btn:not(.sim-view-btn)"); await p.waitForTimeout(300);
      await part("z1").click(); await p.waitForTimeout(1700);
      ok((await playing()) === false, `${t} a tone left alone ends by itself`);
      ok(errs.length === 0, `${t} no page errors`, errs);
      await ctx.close();
    }
    // a page without a buzzer does not load the module
    const plain = await c.fetch(`${BASE}/api/admin/simulations`, { method: "POST", data: { name: "QQ Buzzer Plain", data: { components: [{ id: "b1", type: "battery", x: 40, y: 60, voltage: 9 }], wires: [] } } });
    const plainId = (await plain.json()).id;
    await c.fetch(`${BASE}/api/admin/simulations/${plainId}/publish`, { method: "POST" });
    const anon = await request.newContext();
    const html = await (await anon.get(`${BASE}/simulation/${plainId}`)).text();
    const withBuzzer = await (await anon.get(`${BASE}/simulation/${created.id}`)).text();
    ok(!/sim-buzzer\.js/.test(html) && /sim-buzzer\.js/.test(withBuzzer), "only pages with a buzzer load the sound script");
    await c.fetch(`${BASE}/api/admin/simulations/${plainId}`, { method: "DELETE" });
  } finally { await c.fetch(`${BASE}/api/admin/simulations/${created.id}`, { method: "DELETE" }); await b.close(); }
  console.log(f ? "FAILURES " + f : "ALL PASS"); process.exit(f ? 1 : 0);
})();
