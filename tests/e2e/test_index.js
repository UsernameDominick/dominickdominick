// The starting site in a real browser: the index page loads with its heading, in a computer and a phone width, dark and light, with nothing wider than the
// screen, no errors, readable contrast (axe) and the security headers on the answer.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
const axeSrc = axeSource();
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    for (const vp of [{ name: "computer", width: 1280, height: 800 }, { name: "phone", width: 390, height: 800 }]) {
      for (const scheme of ["light", "dark"]) {
        const where = `${vp.name}, ${scheme}`;
        const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme });
        const p = await ctx.newPage();
        const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
        const res = await p.goto(E2E_BASE + "/");
        ok(res.status() === 200, `${where}: the index answers 200`, res.status());
        ok((await p.textContent("h1")).trim().length > 0 && (await p.title()).length > 0, `${where}: it has a heading and a title`);
        ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${where}: nothing is wider than the screen`);
        const size = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector("p")).fontSize));
        ok(size >= 16, `${where}: the text is at least 16px`, size);
        await p.addScriptTag({ content: axeSrc });
        const v = await p.evaluate(async () => (await axe.run(document, { resultTypes: ["violations"] })).violations.map((x) => x.id));
        ok(v.length === 0, `${where}: axe finds nothing`, v);
        if (scheme === "light" && vp.name === "computer") {
          const h = res.headers();
          ok(h["x-content-type-options"] === "nosniff" && /default-src 'self'/.test(h["content-security-policy"] || "") && h["x-frame-options"] === "SAMEORIGIN", "the security headers are on the answer", h);
          const missing = await p.request.get(E2E_BASE + "/nothing-here");
          ok(missing.status() === 404, "a missing address is a 404", missing.status());
        }
        ok(errs.length === 0, `${where}: no errors`, errs);
        await ctx.close();
      }
    }
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
