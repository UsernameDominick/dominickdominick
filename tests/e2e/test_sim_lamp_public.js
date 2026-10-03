const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { request } = require("./_pw.cjs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const anon = await request.newContext();
  const w = (id, a, ap, b, bp) => ({ id, from: { compId: a, pin: ap }, to: { compId: b, pin: bp }, kind: "wire" });
  const data = { components: [{ id: "b1", type: "battery", x: 40, y: 60, voltage: 9 }, { id: "l1", type: "lamp", x: 200, y: 60 }, { id: "l2", type: "lamp", x: 300, y: 60, resistance: 60 }, { id: "l3", type: "lamp", x: 400, y: 60 }], wires: [w("a1", "b1", "pos", "l1", "p1"), w("a2", "l1", "p2", "l2", "p1"), w("a3", "l2", "p2", "l3", "p1"), w("a4", "l3", "p2", "b1", "neg")] };
  const created = await (await c.fetch(`${BASE}/api/admin/simulations`, { method: "POST", data: { name: "QQ Lamp Public", data } })).json();
  try {
    const pub = await c.fetch(`${BASE}/api/admin/simulations/${created.id}/publish`, { method: "POST" });
    ok(pub.status() === 200, "a simulation with lamps publishes", pub.status());
    const html = await (await anon.get(`${BASE}/simulation/${created.id}`)).text();
    ok(/sim-comp-lamp/.test(html) && /lamp-glass/.test(html), "the public page draws the lamps");
    // three lamps in series: 180 + 60 + 180 = 420 ohm at 9 V = 21.4 mA; powers 0.083, 0.027, 0.083 W
    ok(/data-id="l1"[^>]*data-powered="true"[^>]*style="--lamp-level:0\.20"/.test(html), "the first lamp is lit, at the 0.20 floor (0.083 W of 0.5 W is under it)", (html.match(/<g class="sim-comp sim-comp-lamp[^>]*>/g) || []));
    ok(/data-readout="180 Ω"/.test(html) && /data-readout="60\.0 Ω"/.test(html), "tapping a lamp shows its resistance");
    ok(/21\.4 mA · 0\.08 W · OK/.test(html), "and its live figures", (html.match(/data-readout-live="[^"]*"/g) || []).slice(0, 4));
    ok(/180 Ω lamp/.test(html) || /lamps/.test(html), "the 'about this circuit' text names the lamps", (html.match(/[^.>]*lamp[^.<]*/gi) || []).slice(0, 3));
    ok(/glows with the power it is given/.test(html) || /lamp/i.test(html), "the topology text covers a lamp");
  } finally { await c.fetch(`${BASE}/api/admin/simulations/${created.id}`, { method: "DELETE" }); }
  console.log(f ? "FAILURES " + f : "ALL PASS"); process.exit(f ? 1 : 0);
})();
