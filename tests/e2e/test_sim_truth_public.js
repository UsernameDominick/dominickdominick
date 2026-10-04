// Logic-gate truth tables on the public pages: a section on the circuit's own page, a folded list under a circuit placed in a project,
// both readable, accessible in dark and light, and not clipped or spilling on a phone. A circuit with no gates has none.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request, axeSource } = require("./_pw.cjs");
const BASE = E2E_BASE; let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined && !c ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const anon = await request.newContext();
  const gates = [
    { id: "g1", type: "logic_gate", gate: "and", x: 60, y: 60, label: "U1" },
    { id: "g2", type: "logic_gate", gate: "and", x: 200, y: 60, label: "U2" },
    { id: "g3", type: "logic_gate", gate: "xor", x: 340, y: 60 },
    { id: "g4", type: "logic_gate", gate: "not", x: 480, y: 60, label: "<b>Inv</b>" },
    { id: "g5", type: "logic_gate", gate: "or", x: 620, y: 60, label: "Mystery", truth: [1, 0, 0, 1] },
  ];
  const plain = { components: [{ id: "b1", type: "battery", x: 40, y: 60, voltage: 9 }, { id: "r1", type: "resistor", x: 200, y: 60 }], wires: [] };
  const withGates = await (await c.fetch(`${BASE}/api/admin/simulations`, { method: "POST", data: { name: "QQ Gates Public", data: { components: gates, wires: [] } } })).json();
  const noGates = await (await c.fetch(`${BASE}/api/admin/simulations`, { method: "POST", data: { name: "QQ No Gates Public", data: plain } })).json();
  let projectId = null;
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    for (const id of [withGates.id, noGates.id]) ok((await c.fetch(`${BASE}/api/admin/simulations/${id}/publish`, { method: "POST" })).status() === 200, "the circuit publishes");
    const html = await (await anon.get(`${BASE}/simulation/${withGates.id}`)).text();
    const section = (html.match(/<section class="sim-truth"[\s\S]*?<\/section>/) || [""])[0];
    ok(/<h2 id="sim-standalone-truth-h">Logic gates<\/h2>/.test(section), "the circuit's page has a Logic gates section");
    ok((section.match(/<table/g) || []).length === 4, "four tables: AND (two gates share one), XOR, NOT and the custom OR", (section.match(/<caption>[^<]*<\/caption>/g) || []));
    ok(section.includes("AND gate × 2: U1, U2") && section.includes("(custom table)") && !section.includes("<b>Inv</b>") && section.includes("&lt;b&gt;Inv&lt;/b&gt;"), "shared and custom gates are named, and a label with markup is escaped");
    const plainHtml = await (await anon.get(`${BASE}/simulation/${noGates.id}`)).text();
    ok(!/sim-truth/.test(plainHtml), "a circuit with no gates has no truth table markup");

    // placed in a project: folded
    const slug = "qq-truth-" + Date.now();
    const proj = await (await c.fetch(`${BASE}/api/admin/projects`, { method: "POST", data: { slug, title: "QQ truth project", summary: "s", body: `A synthetic QQ body that is comfortably longer than fifty characters in total, for publishing.\n\n::sim ${withGates.id}::\n\n::sim ${noGates.id}::`, published: true } })).json();
    projectId = proj.id;
    const page = await (await anon.get(`${BASE}/projects/${slug}`)).text();
    ok((page.match(/<details class="sim-truth sim-truth-fold"/g) || []).length === 1 && /Logic gate truth tables \(5\)/.test(page), "under a circuit placed in a project it is one folded list, only for the circuit that has gates");

    for (const [width, label] of [[1280, "desktop"], [390, "phone"]]) {
      const ctx = await b.newContext({ viewport: { width, height: 900 } });
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
      await p.goto(`${BASE}/simulation/${withGates.id}`, { waitUntil: "networkidle" });
      const geometry = await p.evaluate(() => {
        const s = document.querySelector(".sim-truth");
        const r = s.getBoundingClientRect();
        const wrap = document.querySelector(".sim-block-wrap").getBoundingClientRect();
        const footer = document.querySelector("footer") && document.querySelector("footer").getBoundingClientRect();
        const block = s.closest(".block");
        const tables = [...s.querySelectorAll("table")].map((t) => { const q = t.getBoundingClientRect(); return { l: q.left, r: q.right }; });
        return { spill: document.documentElement.scrollWidth - document.documentElement.clientWidth, sectionInsideWrap: r.left >= wrap.left - 1 && r.right <= wrap.right + 1, belowSvg: r.top >= document.querySelector(".sim-svg").getBoundingClientRect().bottom - 1, noClip: block.scrollHeight <= block.clientHeight + 2, footerBelow: !footer || footer.top >= r.bottom - 1, tablesInside: tables.every((t) => t.l >= -1 && t.r <= innerWidth + 1) };
      });
      ok(geometry.spill <= 0 && geometry.sectionInsideWrap && geometry.belowSvg && geometry.tablesInside, `[${label}] the section sits under the circuit and nothing spills sideways`, geometry);
      ok(geometry.noClip && geometry.footerBelow, `[${label}] the circuit's block grows to hold it (nothing clipped, footer below)`, geometry);
      const rows = await p.evaluate(() => [...document.querySelectorAll(".sim-truth-table")].map((t) => t.querySelector("caption").textContent.split(":")[0] + " " + [...t.querySelectorAll("tbody tr")].map((r) => [...r.children].map((x) => x.textContent).join("")).join(",")));
      ok(rows.some((r) => r.startsWith("XOR gate 000,011,101,110")) && rows.some((r) => r.startsWith("NOT gate 01,10")) && rows.some((r) => r.startsWith("OR gate (custom table) 001,010,100,111")), `[${label}] the tables read right`, rows);
      if (width === 1280) {
        await p.addScriptTag({ content: axeSource() });
        for (const theme of ["dark", "light"]) {
          await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
          await p.waitForTimeout(600);
          const v = await p.evaluate(async () => (await axe.run(document.querySelector(".sim-truth"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ") + " " + (n.any[0] ? n.any[0].message.slice(0, 90) : "")).slice(0, 3).join(" | ")));
          ok(v.length === 0, `[${theme}] the truth tables have no accessibility findings`, v);
        }
      }
      ok(errs.length === 0, `[${label}] no page errors`, errs);
      await ctx.close();
    }
    // the folded one in a project opens and reads
    const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await ctx2.newPage();
    await p2.goto(`${BASE}/projects/${slug}`, { waitUntil: "networkidle" });
    ok(!(await p2.evaluate(() => document.querySelector("details.sim-truth-fold").open)) && (await p2.isHidden(".sim-truth-fold table")), "the folded list starts closed");
    await p2.click(".sim-truth-fold > summary");
    ok(await p2.isVisible(".sim-truth-fold table"), "and opens to show the tables");
    await ctx2.close();
  } finally {
    if (projectId) await c.fetch(`${BASE}/api/admin/projects/${projectId}`, { method: "DELETE" });
    for (const id of [withGates.id, noGates.id]) await c.fetch(`${BASE}/api/admin/simulations/${id}`, { method: "DELETE" });
    await b.close();
  }
  console.log(f ? "FAILURES " + f : "ALL PASS"); process.exit(f ? 1 : 0);
})();
