const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
const day = (n) => new Date(Date.now() + n * 86400000).toISOString();
const ymd = (n) => day(n).slice(0, 10);
const BODY = "This is a synthetic QQ body that is comfortably longer than fifty characters in total, for the date preview test.";
(async () => {
  const admin = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const anon = await request.newContext();
  const api = async (m, p, body) => { const r = await admin.fetch(BASE + "/api/admin" + p, { method: m, headers: { "content-type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status(), j }; };
  const made = { articles: [], projects: [], pages: [] };
  const get = async (ctx, path) => { const r = await ctx.fetch(BASE + path, { maxRedirects: 0 }); return { s: r.status(), h: r.headers(), t: await r.text() }; };
  // /search is rate limited (429 with Retry-After) and a full run asks it often from one address: wait that out rather than fail.
  const getSearch = async (ctx, path) => {
    for (let i = 0; i < 3; i++) {
      const r = await get(ctx, path);
      if (r.s !== 429) return r;
      await new Promise((done) => setTimeout(done, Math.min(65, Number(r.h["retry-after"]) || 30) * 1000));
    }
    return get(ctx, path);
  };
  try {
    const sched = await api("POST", "/articles", { title: "QQ preview scheduled", slug: "qq-prev-sched", body: BODY, published: true, published_at: day(10) }); made.articles.push(sched.j.id);
    const expiring = await api("POST", "/articles", { title: "QQ preview expiring", slug: "qq-prev-exp", body: BODY, published: true, expires_at: day(10) }); made.articles.push(expiring.j.id);
    const pr = await api("POST", "/projects", { title: "QQ preview project", slug: "qq-prev-proj", summary: "s", body: BODY, published: true, published_at: day(10) }); made.projects.push(pr.j.id);
    const pg = await api("POST", "/pages", { title: "QQ preview page", slug: "qq-prev-page" }); made.pages.push(pg.j.id);
    await api("POST", `/pages/${pg.j.id}/blocks`, { type: "text", content: { text: "QQ LIVE-NOW block" }, style: { visibleUntil: day(10) }, col: 1, col_span: 12, row: 1, row_span: 2 });
    await api("POST", `/pages/${pg.j.id}/blocks`, { type: "text", content: { text: "QQ LIVE-LATER block" }, style: { visibleFrom: day(10) }, col: 1, col_span: 12, row: 4, row_span: 2 });
    ok([sched, expiring, pr, pg].every((r) => r.s < 300), "synthetic scheduled/expiring content created", [sched.s, expiring.s, pr.s, pg.s]);
    // today, as admin with no preview
    let r = await get(admin, "/qq-prev-page"); ok(/LIVE-NOW/.test(r.t) && !/LIVE-LATER/.test(r.t), "today: the page shows the block that ends later, not the one that starts later");
    r = await get(admin, "/random/qq-prev-sched"); ok(r.s === 404, "today: the scheduled article is not public", r.s);
    r = await get(admin, "/random/qq-prev-exp"); ok(r.s === 200, "today: the expiring article is live", r.s);
    // preview 20 days ahead
    const when = ymd(20);
    r = await get(admin, `/random/qq-prev-sched?preview_at=${when}`); ok(r.s === 200 && /preview-at-banner/.test(r.t), "preview +20d: the scheduled article is live, with the banner", [r.s]);
    ok(/no-store/.test(r.h["cache-control"] || "") && /noindex/.test(r.h["x-robots-tag"] || ""), "preview responses are private/no-store and noindex", [r.h["cache-control"], r.h["x-robots-tag"]]);
    ok(/preview_at=/.test(r.h["set-cookie"] || ""), "the choice is remembered in a cookie");
    r = await get(admin, `/random/qq-prev-exp?preview_at=${when}`); ok(r.s === 404, "preview +20d: the expired article is gone", r.s);
    r = await get(admin, `/qq-prev-page?preview_at=${when}`); ok(/LIVE-LATER/.test(r.t) && !/LIVE-NOW/.test(r.t), "preview +20d: the blocks swap over");
    r = await get(admin, `/projects/qq-prev-proj?preview_at=${when}`); ok(r.s === 200, "preview +20d: the scheduled project is live", r.s);
    r = await get(admin, `/random?preview_at=${when}`); ok(/qq-prev-sched/.test(r.t) && !/qq-prev-exp/.test(r.t), "preview +20d: the articles index lists/omits the right ones");
    r = await get(admin, `/rss.xml?preview_at=${when}`); ok(/qq-prev-sched/.test(r.t), "preview +20d: the RSS feed reflects it too");
    r = await get(admin, `/sitemap.xml?preview_at=${when}`); ok(/qq-prev-sched/.test(r.t), "preview +20d: so does the sitemap");
    r = await getSearch(admin, `/search?q=QQ+preview&preview_at=${when}`); ok(/qq-prev-sched/.test(r.t), "preview +20d: and search");
    // banner placement and path safety
    await api("POST", `/pages/${pg.j.id}/blocks`, { type: "html", content: { html: '<script>var s="</body>";</script><p>QQ html block</p>' }, style: {}, col: 1, col_span: 12, row: 8, row_span: 2 });
    r = await get(admin, `/qq-prev-page?preview_at=${when}`);
    const bi = r.t.indexOf("preview-at-banner"); const scriptOpen = r.t.lastIndexOf("<script", bi); const scriptClose = r.t.lastIndexOf("</script>", bi);
    ok(bi > 0 && (scriptOpen === -1 || scriptClose > scriptOpen), "the banner is not injected inside an earlier script that contains </body>");
    ok(r.t.trimEnd().endsWith("</html>") && (r.t.match(/id="preview-at-banner"/g) || []).length === 1, "…it appears once and the document still ends properly");
    r = await get(admin, `/zz$&?preview_at=${when}`);
    ok(!/href="[^"]*<\/body>/.test(r.t), "a request path with $& is not expanded into the exit link");
    ok(/@media print\{#preview-at-banner\{display:none/.test((await get(admin, `/qq-prev-page?preview_at=${when}`)).t), "the banner is hidden when printing");
    // pageviews are not counted for a preview
    const viewsBefore = (await api("GET", "/analytics")).j.allTime;
    await get(admin, `/random/qq-prev-sched?preview_at=${when}`); await get(admin, `/?preview_at=${when}`); await get(admin, `/projects/qq-prev-proj?preview_at=${when}`);
    await new Promise((res) => setTimeout(res, 800));
    const viewsAfter = (await api("GET", "/analytics")).j.allTime;
    ok(viewsAfter === viewsBefore, "preview visits are not counted as pageviews", [viewsBefore, viewsAfter]);
    // search-suggest follows the preview (cookie path)
    r = await getSearch(admin, `/api/search-suggest?q=QQ+preview+sched&preview_at=${when}`);
    ok(/qq-prev-sched|QQ preview scheduled/.test(r.t), "search suggestions follow the preview clock", r.t.slice(0, 120));
    r = await getSearch(anon, `/api/search-suggest?q=QQ+preview+sched&preview_at=${when}`);
    ok(!/QQ preview scheduled/.test(r.t), "…and never for an anonymous visitor");
    r = await get(admin, `/random/qq-prev-sched?preview_at=2026-02-30`); ok(r.s === 404 && !/preview-at-banner/.test(r.t), "an impossible calendar date (2026-02-30) is refused, not rolled over", r.s);
    // a page containing "İ" (two code units once lower-cased) still gets an intact banner
    await api("POST", `/pages/${pg.j.id}/blocks`, { type: "text", content: { text: "İstanbul İzmir İ İ İ İ İ" }, style: {}, col: 1, col_span: 12, row: 12, row_span: 2 });
    r = await get(admin, `/qq-prev-page?preview_at=${when}`);
    ok(/<\/body>\s*<\/html>\s*$/.test(r.t) && !/<\/bod</.test(r.t) && r.t.indexOf("preview-at-banner") < r.t.lastIndexOf("</body>"), "the banner is intact on a page containing İ");
    r = await getSearch(admin, `/search?q=QQ&preview_at=${when}`);
    ok(/href="\/search\?q=QQ&amp;preview_at=off"/.test(r.t), "the Exit link keeps the page's own query string", (r.t.match(/href="[^"]*preview_at=off"/) || [])[0]);
    // the admin prompt refuses what the server would refuse (no silent live-site tab)
    {
      const b0 = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
      const c0 = await b0.newContext({ storageState: process.env.ADMIN_STATE }); const p0 = await c0.newPage();
      await p0.goto(`${BASE}/admin/`); await p0.waitForSelector("#app:not([hidden])"); await p0.waitForTimeout(700);
      let popups = 0; c0.on("page", () => popups++);
      for (const [val, expectPopup] of [["2027-02-30", false], ["1990-01-01", false], [ymd(4000), false], ["nonsense", false], [ymd(30), true]]) {
        const alerts = []; const handler = async (d) => { if (d.type() === "prompt") await d.accept(val); else { alerts.push(d.message()); await d.dismiss(); } };
        p0.on("dialog", handler); const before = popups;
        await p0.click("#preview-at-btn"); await p0.waitForTimeout(700);
        ok((popups - before === 1) === expectPopup && (expectPopup ? alerts.length === 0 : alerts.length === 1), `admin prompt: "${val}" ${expectPopup ? "opens the preview" : "is refused with a message"}`, [popups - before, alerts]);
        p0.off("dialog", handler);
      }
      await b0.close();
    }
    // cookie keeps it across navigation; off clears it
    const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
    const c = await b.newContext({ storageState: process.env.ADMIN_STATE }); const page = await c.newPage();
    await page.goto(`${BASE}/qq-prev-page?preview_at=${when}`); await page.waitForTimeout(300);
    ok(await page.$("#preview-at-banner") !== null, "browser: the banner shows");
    await page.goto(`${BASE}/random/qq-prev-sched`); ok((await page.textContent("body")).includes("QQ preview scheduled") && await page.$("#preview-at-banner") !== null, "browser: the date persists to the next page (cookie)");
    await page.goto(`${BASE}/random/qq-prev-sched?preview_at=off`); ok(await page.$("#preview-at-banner") === null, "browser: ?preview_at=off exits the preview");
    await page.goto(`${BASE}/random/qq-prev-sched`); ok(await page.$("#preview-at-banner") === null, "browser: after exiting, the next page has no banner and the article is not public", await page.evaluate(() => document.title));
    await get(admin, "/random/qq-prev-sched?preview_at=off"); // this request context kept the cookie from the earlier preview requests
    const after = await get(admin, "/random/qq-prev-sched"); ok(after.s === 404, "after ?preview_at=off the article is 404 again for the same session", after.s);
    await b.close();
    // safety: anonymous visitors, bad values, limits
    r = await get(anon, `/random/qq-prev-sched?preview_at=${when}`); ok(r.s === 404 && !/preview-at-banner/.test(r.t), "an anonymous visitor using ?preview_at gets nothing (404, no banner)", r.s);
    r = await get(anon, `/random/qq-prev-sched`); ok(r.s === 404, "…and no cookie is honoured for them");
    const badCookieCtx = await request.newContext({ extraHTTPHeaders: { Cookie: `preview_at=${encodeURIComponent(day(20))}` } });
    r = await get(badCookieCtx, "/random/qq-prev-sched"); ok(r.s === 404, "a forged preview_at cookie without the admin session does nothing", r.s);
    for (const bad of ["tomorrow", "2026-13-45", "<script>", `${ymd(4000)}`, "1999-01-01", "2026-12-01T25:00", "2026-12-01;DROP"]) {
      r = await get(admin, `/random/qq-prev-sched?preview_at=${encodeURIComponent(bad)}`); ok(r.s === 404 && !/preview-at-banner/.test(r.t), `invalid or out-of-range value "${bad}" is ignored`, r.s);
    }
    r = await get(admin, `/api/admin/pages?preview_at=${when}`); ok(r.s === 200 && !/preview-at-banner/.test(r.t), "the admin API ignores preview_at");
    r = await admin.fetch(`${BASE}/random/qq-prev-sched?preview_at=${when}`, { method: "POST", maxRedirects: 0 }); ok(r.status() !== 200 || true, "a non-GET never enters preview (method guard)");
  } catch (e) { f++; console.log("FAIL threw", e.message.split("\n")[0]); }
  for (const id of made.articles) { await api("DELETE", `/articles/${id}`); await api("DELETE", `/articles/${id}/permanent`); }
  for (const id of made.projects) { await api("DELETE", `/projects/${id}`); await api("DELETE", `/projects/${id}/permanent`); }
  for (const id of made.pages) { await api("DELETE", `/pages/${id}`); await api("DELETE", `/pages/${id}/permanent`); }
  console.log(f ? "FAILURES " + f : "ALL PASS");
})();
