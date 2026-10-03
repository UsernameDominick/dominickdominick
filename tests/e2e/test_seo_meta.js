const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const c = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const page = await c.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const api = async (m, p, body) => { const r = await c.request.fetch(BASE + "/api/admin" + p, { method: m, headers: { "content-type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status(), j }; };
  const made = { pages: [], articles: [], projects: [], media: [], sims: [] };
  const rep = async () => (await api("GET", "/seo-report")).j;
  try {
    // --- titles: pages are served as-is, articles/projects get " · Dominick" (11 characters) appended
    const t = (n, tag) => (tag + "x".repeat(n)).slice(0, n);
    const p60 = await api("POST", "/pages", { title: t(60, "QQ60 "), slug: "qq-seo-t60" }); made.pages.push(p60.j.id);
    const p61 = await api("POST", "/pages", { title: t(61, "QQ61 "), slug: "qq-seo-t61" }); made.pages.push(p61.j.id);
    const a49 = await api("POST", "/articles", { title: t(49, "QQA49 "), slug: "qq-seo-a49", body: "This is a synthetic QQ body that is comfortably longer than fifty characters in total.", published: true }); made.articles.push(a49.j.id);
    const a50 = await api("POST", "/articles", { title: t(50, "QQA50 "), slug: "qq-seo-a50", body: "This is a synthetic QQ body that is comfortably longer than fifty characters in total.", published: true }); made.articles.push(a50.j.id);
    const pr50 = await api("POST", "/projects", { title: t(50, "QQP50 "), slug: "qq-seo-p50", summary: "Short", body: "This is a synthetic QQ body that is comfortably longer than fifty characters in total.", published: true }); made.projects.push(pr50.j.id);
    ok([p60, p61, a49, a50, pr50].every((r) => r.s < 300), "synthetic pages, articles and a project created", [p60.s, p61.s, a49.s, a50.s, pr50.s]);
    // --- descriptions: pages (Meta description) and projects (Summary)
    await api("PATCH", `/pages/${p60.j.id}`, { meta_description: "x".repeat(49) });
    await api("PATCH", `/pages/${p61.j.id}`, { meta_description: "x".repeat(161) });
    const pOk = await api("POST", "/pages", { title: "QQ desc ok", slug: "qq-seo-desc-ok" }); made.pages.push(pOk.j.id);
    await api("PATCH", `/pages/${pOk.j.id}`, { meta_description: "A sensible description of exactly the right length to show fully in a result: " + "y".repeat(20) });
    const pEdge = await api("POST", "/pages", { title: "QQ desc edge", slug: "qq-seo-desc-edge" }); made.pages.push(pEdge.j.id);
    await api("PATCH", `/pages/${pEdge.j.id}`, { meta_description: "e".repeat(50) });
    const pEdge2 = await api("POST", "/pages", { title: "QQ desc edge2", slug: "qq-seo-desc-edge2" }); made.pages.push(pEdge2.j.id);
    await api("PATCH", `/pages/${pEdge2.j.id}`, { meta_description: "f".repeat(160) });
    // --- alt text on blocks
    const img = (alt, n) => api("POST", `/pages/${pOk.j.id}/blocks`, { type: "image", content: { url: `/media/uploads/qq-${n}.png`, alt }, style: {}, col: 1, col_span: 6, row: n, row_span: 4 });
    await img("IMG_4021.jpg", 1); await img("A red bicycle leaning on a brick wall", 2); await img("image of a cat", 3); await img("x".repeat(140), 4); await img("", 5);
    await api("POST", `/pages/${pOk.j.id}/blocks`, { type: "gallery", content: { images: [{ url: "/media/uploads/qq-g1.png", alt: "Photo 12" }, { url: "/media/uploads/qq-g2.png", alt: "Workbench with the amplifier open" }, "/media/uploads/qq-g3.png"] }, style: {}, col: 1, col_span: 12, row: 20, row_span: 6 });
    // --- media library default alt text
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const up = await c.request.fetch(BASE + "/api/admin/upload?folder=qq-seo-test", { method: "POST", headers: { "content-type": "image/png" }, data: png });
    const mk = (await up.json()).url.replace(/^\/media\//, ""); made.media.push(mk);
    await api("PATCH", `/media/${mk}`, { alt_text: "screenshot" });

    // a title with a double space is counted the way the browser shows it (collapsed): 60, so fine
    const pWs = await api("POST", "/pages", { title: "QQWS  " + "w".repeat(54), slug: "qq-seo-ws" }); made.pages.push(pWs.j.id);
    // zero-width-only alt counts as missing (and is not double-reported as weak)
    await img("\u200b\u200b", 6);
    // a genuinely long description is a softer finding and says so
    await img("A bar chart of monthly sales for 2024: January starts near 40 units, rises steadily to a peak of about 120 in July, dips through the autumn and finishes the year at roughly 85 units.", 7);
    // a whitespace-only project summary falls back to the body excerpt, not a blank meta description
    const prBlank = await api("POST", "/projects", { title: "QQ blank summary", slug: "qq-seo-blank-summary", summary: "   ", body: "This is a synthetic QQ body that is comfortably longer than fifty characters in total.", published: true }); made.projects.push(prBlank.j.id);
    // a hostile page title must not execute in the page picker
    const hostile = await api("POST", "/pages", { title: "<img src=x onerror=window.__qqxss=1> hostile", slug: "qq-seo-hostile" }); made.pages.push(hostile.j.id);
    // a published simulation's page title is "<name> · Dominick": a 50-character name is 61 served
    const simNew = await api("POST", "/simulations", { name: ("QQ sim " + "s".repeat(50)).slice(0, 50), data: {} });
    if (simNew.j && simNew.j.id) { made.sims.push(simNew.j.id); await api("POST", `/simulations/${simNew.j.id}/publish`); }
    const simShort = await api("POST", "/simulations", { name: "QQ sim short", data: {} });
    if (simShort.j && simShort.j.id) { made.sims.push(simShort.j.id); await api("POST", `/simulations/${simShort.j.id}/publish`); }
    const simDraft = await api("POST", "/simulations", { name: "QQ sim draft " + "d".repeat(60), data: {} });
    if (simDraft.j && simDraft.j.id) made.sims.push(simDraft.j.id);
    const r = await rep();
    const has = (arr, pred) => (arr || []).some(pred);
    // titles
    ok(!has(r.longTitles, (x) => x.slug === "qq-seo-t60"), "a 60-character page title is fine");
    ok(has(r.longTitles, (x) => x.slug === "qq-seo-t61" && x.length === 61 && x.type === "page"), "a 61-character page title is flagged with its length", (r.longTitles || []).find((x) => x.slug === "qq-seo-t61"));
    ok(!has(r.longTitles, (x) => x.slug === "qq-seo-a49"), "a 49-character article title (60 with the site name) is fine");
    ok(has(r.longTitles, (x) => x.slug === "qq-seo-a50" && x.length === 61 && x.type === "article"), "a 50-character article title is flagged (61 with the site name)", (r.longTitles || []).find((x) => x.slug === "qq-seo-a50"));
    ok(has(r.longTitles, (x) => x.slug === "qq-seo-p50" && x.length === 61 && x.type === "project"), "a 50-character project title is flagged too");
    // descriptions
    const dl = (slug) => (r.descriptionLength || []).find((x) => x.slug === slug);
    ok(dl("qq-seo-t60") && dl("qq-seo-t60").problem === "short" && dl("qq-seo-t60").length === 49, "a 49-character meta description is 'short'", dl("qq-seo-t60"));
    ok(dl("qq-seo-t61") && dl("qq-seo-t61").problem === "long" && dl("qq-seo-t61").length === 161, "a 161-character meta description is 'long'", dl("qq-seo-t61"));
    ok(!dl("qq-seo-desc-ok"), "a well-sized description isn't flagged");
    ok(!dl("qq-seo-desc-edge") && !dl("qq-seo-desc-edge2"), "50 and 160 characters are both accepted");
    ok(dl("qq-seo-p50") && dl("qq-seo-p50").type === "project" && dl("qq-seo-p50").problem === "short", "a project's short Summary is flagged", dl("qq-seo-p50"));
    ok(!has(r.descriptionLength, (x) => x.slug === "qq-seo-a49" || x.slug === "qq-seo-a50"), "articles (automatic excerpt) are never judged on description length");
    // alt
    const wa = (alt) => (r.weakAlt || []).find((x) => x.alt === alt);
    ok(wa("IMG_4021.jpg") && /file name/.test(wa("IMG_4021.jpg").reason) && wa("IMG_4021.jpg").where === "Image block", "a file-name alt on an image block", wa("IMG_4021.jpg"));
    ok(!wa("A red bicycle leaning on a brick wall"), "a real description isn't flagged");
    ok(wa("image of a cat") && /image of/.test(wa("image of a cat").reason), "an 'image of…' alt", wa("image of a cat"));
    ok(wa("x".repeat(140)) && /140 characters/.test(wa("x".repeat(140)).reason), "an over-long alt reports its length");
    ok(wa("Photo 12") && wa("Photo 12").where === "Gallery image", "a numbered alt in a gallery", wa("Photo 12"));
    ok(!wa("Workbench with the amplifier open"), "a good gallery alt isn't flagged");
    ok(wa("screenshot") && wa("screenshot").where === "Media Library default alt text" && wa("screenshot").url === `/media/${mk}`, "the Media Library's default alt is checked", wa("screenshot"));
    ok(!(r.weakAlt || []).some((x) => x.alt === ""), "an empty alt isn't double-reported (it stays under Missing alt text)");
    ok((r.missingAlt || []).some((m) => m.slug === "qq-seo-desc-ok"), "…it still appears under Missing alt text");
    ok(!has(r.longTitles, (x) => x.slug === "qq-seo-ws"), "a double space inside a title is counted collapsed (60, fine)", (r.longTitles || []).find((x) => x.slug === "qq-seo-ws"));
    ok(!(r.weakAlt || []).some((x) => x.url === "/media/uploads/qq-6.png"), "a zero-width-only alt isn't reported as weak…");
    ok((r.missingAlt || []).some((m) => m.url === "/media/uploads/qq-6.png"), "…it's reported as missing alt text");
    const longRow = (r.weakAlt || []).find((x) => x.url === "/media/uploads/qq-7.png");
    ok(longRow && longRow.long === true && /characters/.test(longRow.reason), "a long alt is marked long (a softer finding)", longRow && [longRow.long, longRow.reason]);
    const blankPage = await (await c.request.fetch(BASE + "/projects/qq-seo-blank-summary")).text();
    ok(/<meta name="description" content="This is a synthetic QQ body/.test(blankPage), "a whitespace-only summary falls back to the body excerpt in <meta description>", (blankPage.match(/<meta name="description"[^>]*>/) || [])[0]);
    ok(!/class="page-lede"/.test(blankPage), "…and renders no empty lede paragraph");
    ok(simNew.s < 300 && has(r.longTitles, (x) => x.type === "simulation" && x.slug === String(simNew.j.id) && x.length === 61), "a published simulation with a 50-character name is flagged (61 served)", (r.longTitles || []).filter((x) => x.type === "simulation"));
    ok(!has(r.longTitles, (x) => x.type === "simulation" && x.slug === String(simShort.j.id)), "a short simulation name is fine");
    ok(!has(r.longTitles, (x) => x.type === "simulation" && x.slug === String(simDraft.j.id)), "an unpublished simulation isn't judged (it has no public page)");
    // existing fields untouched
    ok(["missingMeta", "missingAlt", "missingOgImage", "duplicateTitles", "duplicateMeta", "sitemapCanonicalMismatch"].every((k) => Array.isArray(r[k])), "the existing report fields are still there");

    // --- UI: the SEO Report list and the Site Health overview
    await page.goto(`${BASE}/admin/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(800);
    await page.click("#seo-dashboard-btn"); await page.waitForSelector("#seo-dashboard-modal:not([hidden])");
    await page.locator("#seo-dashboard-modal summary", { hasText: "SEO Report" }).click();
    await page.click("#check-seo-btn"); await page.waitForTimeout(1500);
    const listText = await page.textContent("#seo-report-results");
    ok(/IMG_4021\.jpg/.test(listText) && /Looks like a file name/.test(listText), "SEO Report list shows the weak alt text row", listText.slice(0, 80));
    ok(/Title is 61 characters/.test(listText), "SEO Report list shows the title length row");
    ok(/Meta description is 161 characters/.test(listText) && /Meta description is 49 characters/.test(listText), "SEO Report list shows both description rows");
    ok(/Summary is 5 characters/.test(listText), "a project's row says Summary");
    const t0 = Date.now(); await page.click("#run-site-health-btn"); await page.waitForFunction(() => !document.getElementById("run-site-health-btn").disabled, null, { timeout: 60000 }); 
    const overview = await page.textContent("#site-health-results");
    ok(/IMG_4021\.jpg/.test(overview) && /Title is 61 characters/.test(overview) && /161 characters/.test(overview), "the Site Health overview includes the new findings");
    ok(/Looks like a camera or screenshot number|file name/.test(overview), "…with their reasons");
    ok(/Media Library default alt text/.test(overview) || /Media Library default alt text/.test(listText), "the Media Library row says where it lives");
    ok(/Edit it in the Media Library/.test(listText), "…and how to fix it");
    ok(/including the " · Dominick" the site adds/.test(listText), "article and project title rows explain the site-name suffix");
    ok(/consider moving the detail into a caption/.test(listText), "a long alt reads as a suggestion, not as 'says nothing useful'");
    const xss = await page.evaluate(() => window.__qqxss === 1);
    const hostileOpt = await page.$$eval("#page-picker option", (os) => os.map((o) => o.textContent).filter((t) => t.includes("onerror")));
    const imgInPicker = await page.$$eval("#page-picker img", (i) => i.length);
    ok(!xss && imgInPicker === 0, "a hostile page title is text in the page picker, not markup", [xss, imgInPicker]);
    ok(hostileOpt.length === 1, "…and the title is still listed literally", hostileOpt);
    ok(errs.length === 0, "no page errors", errs);
  } catch (e) { f++; console.log("FAIL threw", e.message.split("\n")[0]); }
  for (const id of made.pages) { await api("DELETE", `/pages/${id}`); await api("DELETE", `/pages/${id}/permanent`); }
  for (const id of made.articles) { await api("DELETE", `/articles/${id}`); await api("DELETE", `/articles/${id}/permanent`); }
  for (const id of made.projects) { await api("DELETE", `/projects/${id}`); await api("DELETE", `/projects/${id}/permanent`); }
  for (const k of made.media) await api("DELETE", `/media/${k}`);
  for (const id of made.sims) await api("DELETE", `/simulations/${id}`);
  const r2 = await rep();
  const leftovers = [...(r2.longTitles || []), ...(r2.descriptionLength || [])].filter((x) => /^qq-/.test(x.slug || "")).length + (r2.weakAlt || []).filter((x) => /qq-|^screenshot$/.test((x.url || "") + x.alt)).length;
  ok(leftovers === 0, "test data cleaned up", leftovers);
  await b.close(); console.log(f ? "FAILURES " + f : "ALL PASS");
})();
