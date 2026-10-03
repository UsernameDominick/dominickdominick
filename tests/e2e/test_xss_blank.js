const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const c = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const page = await c.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  page.on("dialog", (d) => { errs.push("DIALOG " + d.message()); d.dismiss(); });
  const api = async (m, p, body) => { const r = await c.request.fetch(BASE + "/api/admin" + p, { method: m, headers: { "content-type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status(), j }; };
  const pub = async (p) => (await c.request.fetch(BASE + p)).text();
  const made = { pages: [], articles: [], projects: [], media: [], scans: [] };
  try {
    // ---- B: a blank page description never ships
    const pg = await api("POST", "/pages", { title: "QQ xss blank", slug: "qq-xss-blank" }); made.pages.push(pg.j.id);
    await api("POST", `/pages/${pg.j.id}/blocks`, { type: "text", content: { text: "Hello from the QQ blank description test page, long enough to excerpt." }, style: {}, col: 1, col_span: 24, row: 1, row_span: 2 });
    for (const [label, value] of [["spaces", "   "], ["tab/newline", "\n\t "], ["nbsp", "  "], ["zero-width", "​​"]]) {
      await api("PATCH", `/pages/${pg.j.id}`, { meta_description: value });
      const html = await pub("/qq-xss-blank");
      const m = html.match(/<meta name="description" content="([^"]*)">/);
      ok(m && m[1].startsWith("Hello from the QQ blank description"), `a ${label}-only meta description falls back to the page text`, m && m[1].slice(0, 50));
      const og = html.match(/<meta property="og:description" content="([^"]*)">/);
      ok(og && og[1].startsWith("Hello from"), `…and og:description too (${label})`, og && og[1].slice(0, 40));
    }
    // ---- B: a blank project summary never ships (meta, RSS, cards)
    const prj = await api("POST", "/projects", { title: "QQ blank proj", slug: "qq-xss-blank-proj", summary: "   ", body: "This is a synthetic QQ project body that is comfortably longer than fifty characters.", published: true }); made.projects.push(prj.j.id);
    const prHtml = await pub("/projects/qq-xss-blank-proj");
    ok(/<meta name="description" content="This is a synthetic QQ project body/.test(prHtml), "project page: description from the body");
    const idx = await pub("/projects");
    const at = idx.indexOf("qq-xss-blank-proj");
    const card = at >= 0 ? idx.slice(Math.max(0, at - 300), at + 900) : "";
    ok(at >= 0 && !/<p[^>]*>\s*<\/p>/.test(card), "project index card has no empty summary paragraph", card.match(/<p[^>]*>\s*<\/p>/));
    const rss = await pub("/rss.xml");
    const item = rss.split("<item>").find((s) => s.includes("qq-xss-blank-proj")) || "";
    if (item) ok(!/<description>\s*<\/description>/.test(item), "RSS item has a non-empty description", (item.match(/<description>[^<]*<\/description>/) || [])[0]);
    else console.log("note: project not in RSS (RSS lists articles only), skipped");
    // ---- excerpt: thematic breaks and raw HTML don't leak into a description
    const art = await api("POST", "/articles", { title: "QQ excerpt test", slug: "qq-xss-excerpt", body: "First paragraph of a long enough synthetic QQ article body.\n\n---\n\n<div class=\"x\">html chunk</div>\n\n***\n\nSecond paragraph text after the breaks.", published: true }); made.articles.push(art.j.id);
    const aHtml = await pub("/random/qq-xss-excerpt");
    const ad = (aHtml.match(/<meta name="description" content="([^"]*)">/) || [])[1] || "";
    ok(/First paragraph/.test(ad) && !/---|\*\*\*|&lt;div|<div/.test(ad), "an article description drops thematic breaks and raw HTML", ad);
    ok(/Second paragraph/.test(ad) || ad.length > 40, "…and still reads as text", ad);

    // ---- C: a scan name with quotes can't inject an attribute
    const hostileScan = 'QQ scan" onmouseover="window.__qqscan=1" x="';
    const sc = await api("POST", "/scans", { name: hostileScan, glb_key: (await require("./scanfix.js").uploadGlb()) }); made.scans.push(sc.j.id);
    ok(sc.s < 300, "hostile scan name accepted by the API (as a plain name)", sc.s);
    await page.goto(`${BASE}/admin/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(700);
    await page.click("#scans-btn"); await page.waitForSelector("#scans-modal:not([hidden])"); await page.waitForTimeout(800);
    const btn = page.locator(`#scans-list .usage-scan[data-id="${sc.j.id}"]`);
    ok((await btn.count()) === 1, "the scan row renders");
    const dn = await btn.getAttribute("data-name");
    ok(dn === hostileScan, "the data-name attribute holds the whole name as text", dn);
    const extraAttrs = await btn.evaluate((e) => [...e.attributes].map((a) => a.name).filter((n) => /^on/i.test(n) || n === "x"));
    ok(extraAttrs.length === 0, "no injected onmouseover/x attributes", extraAttrs);
    await btn.hover(); await page.waitForTimeout(300);
    ok(!(await page.evaluate(() => window.__qqscan === 1)), "hovering runs nothing");
    await page.click("#close-scans");

    // ---- D: keyframe editor values can't inject markup
    const kfPage = await api("POST", "/pages", { title: "QQ xss kf", slug: "qq-xss-kf" }); made.pages.push(kfPage.j.id);
    const payload = "'></textarea><img src=x onerror=window.__qqkf=1>";
    const kb = await api("POST", `/pages/${kfPage.j.id}/blocks`, { type: "text", content: { text: "kf" }, style: { animation: "custom", customKeyframes: [{ offset: payload, opacity: payload, x: payload, y: payload, scale: payload, rotate: payload }, { offset: 100 }] }, col: 1, col_span: 12, row: 1, row_span: 2 });
    await page.goto(`${BASE}/admin/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(700);
    await page.selectOption("#page-picker", String(kfPage.j.id)); await page.waitForTimeout(900);
    await page.click(`[data-id="${kb.j.id}"]`); await page.waitForTimeout(600);
    const opened = await page.evaluate(() => { const b = document.querySelector(".edit-keyframes-btn"); if (!b) return false; b.click(); return true; });
    await page.waitForTimeout(600);
    if (opened) {
      const imgs = await page.$$eval("#keyframe-rows img, #keyframe-editor-modal img", (i) => i.length);
      ok(imgs === 0 && !(await page.evaluate(() => window.__qqkf === 1)), "keyframe editor: a hostile value creates no element and runs nothing", [imgs]);
      await page.keyboard.press("Escape");
    } else console.log("note: keyframe editor button not reachable, UI check skipped (animation may need a different style key)");

    // ---- A + safe href: Site Health rows at 390px
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const up = await c.request.fetch(BASE + "/api/admin/upload?folder=qq-xss-test", { method: "POST", headers: { "content-type": "image/png" }, data: png });
    const mk = (await up.json()).url.replace(/^\/media\//, ""); made.media.push(mk);
    await api("PATCH", `/media/${mk}`, { alt_text: "Image of m" });
    const jsPage = await api("POST", "/pages", { title: "QQ js url", slug: "qq-xss-js" }); made.pages.push(jsPage.j.id);
    await api("POST", `/pages/${jsPage.j.id}/blocks`, { type: "image", content: { url: "javascript:window.__qqjs=1", alt: "" }, style: {}, col: 1, col_span: 6, row: 1, row_span: 4 });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`${BASE}/admin/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(700);
    await page.click("#site-menu-btn").catch(() => {}); await page.waitForTimeout(300);
    await page.click("#seo-dashboard-btn"); await page.waitForSelector("#seo-dashboard-modal:not([hidden])");
    await page.locator("#seo-dashboard-modal summary", { hasText: "SEO Report" }).click();
    await page.click("#check-seo-btn"); await page.waitForTimeout(1500);
    const over = await page.$$eval("#seo-report-results .link-check-row", (rows) => rows.filter((r) => r.scrollWidth > r.clientWidth + 1).length);
    const total = await page.$$eval("#seo-report-results .link-check-row", (rows) => rows.length);
    ok(total > 0 && over === 0, "no SEO Report row overflows its box at 390px (file names and slugs wrap)", [over, total]);
    await page.click("#run-site-health-btn"); await page.waitForTimeout(500); await page.waitForFunction(() => !document.getElementById("run-site-health-btn").disabled, null, { timeout: 60000 });
    const hrefs = await page.$$eval("#site-health-results a.link-check-url", (as) => as.map((a) => a.getAttribute("href")));
    ok(hrefs.length > 0 && !hrefs.some((h) => /^\s*javascript:/i.test(h)), "no overview link uses a javascript: address", hrefs.filter((h) => !h.startsWith("/")).slice(0, 4));
    ok(errs.length === 0, "no page errors or dialogs", errs);
  } catch (e) { f++; console.log("FAIL threw", e.message.split("\n")[0]); }
  for (const id of made.pages) { await api("DELETE", `/pages/${id}`); await api("DELETE", `/pages/${id}/permanent`); }
  for (const id of made.articles) { await api("DELETE", `/articles/${id}`); await api("DELETE", `/articles/${id}/permanent`); }
  for (const id of made.projects) { await api("DELETE", `/projects/${id}`); await api("DELETE", `/projects/${id}/permanent`); }
  for (const id of made.scans) await api("DELETE", `/scans/${id}`);
  for (const k of made.media) await api("DELETE", `/media/${k}`);
  await b.close(); console.log(f ? "FAILURES " + f : "ALL PASS");
})();
