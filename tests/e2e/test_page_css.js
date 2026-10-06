const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const f = (m, p, b) => c.fetch((E2E_BASE + "/api/admin") + p, { method: m, data: b });
  const anon = await request.newContext();
  const pg = await (await f("POST", "/pages", { title: "QQ Css Page", slug: "qq-css-page" })).json();
  await f("POST", `/pages/${pg.id}/blocks`, { type: "heading", content: { text: "QQ Css Heading", level: 1 }, col: 1, row: 1, col_span: 12, row_span: 2 });
  const other = await (await f("POST", "/pages", { title: "QQ Css Other", slug: "qq-css-other" })).json();
  await f("POST", `/pages/${other.id}/blocks`, { type: "heading", content: { text: "QQ Other Heading", level: 1 }, col: 1, row: 1, col_span: 12, row_span: 2 });
  // API
  ok((await f("PUT", `/pages/${pg.id}/css`, { css: "@import url(x);" })).status() === 400, "rejects @import");
  ok((await f("PUT", `/pages/${pg.id}/css`, { css: "a{}</style><script>1</script>" })).status() === 400, "rejects style breakout");
  ok((await f("PUT", `/pages/${pg.id}/css`, { css: "h1{background:url(//evil.example/x)}" })).status() === 400, "rejects protocol-relative url");
  ok((await f("PUT", "/pages/999999/css", { css: "h1{}" })).status() === 404, "404 for a missing page");
  const good = await f("PUT", `/pages/${pg.id}/css`, { css: "h1{color:rgb(1,2,3)} h1::before{content:\"\\201C\"}" });
  ok(good.ok(), "accepts valid CSS");
  ok(((await (await f("GET", `/pages/${pg.id}/css`)).json()).css || "").includes("rgb(1,2,3)"), "GET returns it");
  // public
  const html = await (await anon.get((E2E_BASE + "/qq-css-page"))).text();
  ok(/<style data-page-css>h1\{color:rgb\(1,2,3\)\}/.test(html), "page carries its CSS");
  const otherHtml = await (await anon.get((E2E_BASE + "/qq-css-other"))).text();
  ok(!/data-page-css/.test(otherHtml), "other page has none");
  ok(!/rgb\(1,2,3\)/.test(await (await anon.get((E2E_BASE + "/"))).text()), "home unaffected");
  // UI + preview
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: process.env.ADMIN_STATE })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.goto((E2E_BASE + "/admin/")); await p.waitForSelector("#app:not([hidden])");
  await p.selectOption("#page-picker", String(pg.id)); await p.waitForTimeout(800);
  await p.click("#page-settings-btn");
  await p.waitForTimeout(300);
  ok((await p.inputValue("#page-custom-css")).includes("rgb(1,2,3)"), "textarea loads the saved CSS");
  ok(await p.evaluate(() => document.getElementById("page-css-panel").open), "panel open when CSS exists");
  await p.fill("#page-custom-css", "h1{color:rgb(9,8,7)}");
  await p.click("#page-css-preview-btn");
  await p.waitForSelector("#preview-modal:not([hidden])");
  await p.waitForFunction(() => { const d = document.getElementById("preview-frame").contentDocument; return d && d.querySelector("style[data-page-css-preview]"); }, null, { timeout: 8000 });
  const col = await p.evaluate(() => { const d = document.getElementById("preview-frame").contentDocument; return { color: d.defaultView.getComputedStyle(d.querySelector("h1")).color, saved: d.querySelectorAll("style[data-page-css]").length }; });
  ok(col.color === "rgb(9, 8, 7)" && col.saved === 0, `preview applies unsaved CSS and replaces the saved rules ${JSON.stringify(col)}`);
  ok((await (await f("GET", `/pages/${pg.id}/css`)).json()).css.includes("rgb(1,2,3)"), "preview did not save");
  await p.evaluate(() => document.getElementById("close-preview").click());
  await p.fill("#page-custom-css", "h1{background:url(javascript:alert(1))}");
  await p.click("#page-css-save-btn"); await p.waitForTimeout(600);
  ok(/Not saved/.test(await p.textContent("#page-css-status")), "UI shows the validation error");
  await p.fill("#page-custom-css", "h1{color:rgb(4,5,6)}"); await p.click("#page-css-save-btn"); await p.waitForTimeout(600);
  ok(/Saved/.test(await p.textContent("#page-css-status")), "UI saves valid CSS");
  ok(/rgb\(4,5,6\)/.test(await (await anon.get((E2E_BASE + "/qq-css-page"))).text()), "public page has the new CSS");
  // duplicate copies it, hard delete removes it
  const dup = await (await f("POST", `/pages/${pg.id}/duplicate`)).json();
  ok(/rgb\(4,5,6\)/.test((await (await f("GET", `/pages/${dup.id}/css`)).json()).css), "duplicate copies the CSS");
  await f("PUT", `/pages/${pg.id}/css`, { css: "" });
  ok(!/data-page-css/.test(await (await anon.get((E2E_BASE + "/qq-css-page"))).text()), "clearing the CSS removes the style tag");
  ok(errs.length === 0, `no errors ${errs}`);
  for (const id of [pg.id, other.id, dup.id]) { await f("DELETE", `/pages/${id}`); await f("DELETE", `/pages/${id}/permanent`); }
  ok((await (await f("GET", `/pages/${dup.id}/css`)).json()).css === "", "hard delete removes the stored CSS");
  await b.close(); process.exit(fail ? 1 : 0);
})();
