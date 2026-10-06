// The nav: no Random (Articles) tab and no Hidden Notes tab; every tab of the dial slides in place, like a carousel, with no page load (even
// with what Cloudflare adds to live pages)
// (the Studio and the song and circuit players come along); a page with a Study block stays out of the nav, the sitemap and search
// engines, is found through the site's search, and always asks for its password.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const f = (m, p, b) => c.fetch(E2E_BASE + "/api/admin" + p, { method: m, data: b });
  const slug = "qq-study-" + Date.now();
  const pg = await (await f("POST", "/pages", { title: "QQ Study Corner", slug, nav_label: "QQ Study" })).json();
  await f("POST", `/pages/${pg.id}/blocks`, { type: "text", content: { text: "QQ a page for the study drill, with enough words in it to be published on the site." }, col: 1, row: 1, col_span: 24, row_span: 3 });
  await f("POST", `/pages/${pg.id}/blocks`, { type: "study", content: { label: "Open study", lab: "core1-lab", requirePassword: false, password: "" }, col: 1, row: 4, col_span: 8, row_span: 3 });
  await f("PUT", `/pages/${pg.id}`, { title: "QQ Study Corner", slug, nav_label: "QQ Study", published: true });
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    const anon = await request.newContext();
    const home = await (await anon.get(E2E_BASE + "/")).text();
    const tabs = [...home.matchAll(/class="tab[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
    ok(!tabs.includes("/random") && !tabs.includes("/hidden-notes") && !tabs.includes("/" + slug), "no Random, Hidden Notes or Study tab", tabs);
    ok(/id="finder-open"/.test(home) && /href="\/random"[^>]*>(?:(?!<\/a>)[\s\S])*All articles/.test(home), "the articles are in the finder instead");
    ok(!/href="\/hidden-notes"/.test(home), "a visitor is not offered Hidden Notes anywhere");
    const ownerHome = await (await c.get(E2E_BASE + "/")).text();
    ok(/href="\/hidden-notes"[^>]*>(?:(?!<\/a>)[\s\S])*Hidden Notes/.test(ownerHome) && ![...ownerHome.matchAll(/class="tab[^"]*" href="([^"]+)"/g)].some((m) => m[1] === "/hidden-notes"), "the owner finds Hidden Notes in the finder, not as a tab");

    // the study page: out of the nav, the sitemap and search engines, found by the site's search, always asks for its password
    const studyHtml = await (await anon.get(E2E_BASE + "/" + slug)).text();
    ok(/name="robots" content="noindex"/.test(studyHtml), "the study page tells search engines to leave it out");
    ok(!(await (await anon.get(E2E_BASE + "/sitemap.xml")).text()).includes(slug), "and it is not in the sitemap");
    const sug = await (await anon.get(E2E_BASE + "/api/search-suggest?q=" + encodeURIComponent("QQ Study Corner"))).json();
    ok((sug.results || []).some((r) => r.url === "/" + slug), "the site's own search finds it", sug.results);
    const blockId = Number((/data-study-block="(\d+)"/.exec(studyHtml) || [])[1]);
    const unlock = (password) => anon.post(E2E_BASE + "/api/study/unlock", { data: { block: blockId, password } });
    ok((await unlock("")).status() === 401, "a Study block left unticked still asks for the password");
    ok((await unlock("123")).status() === 200, "and opens with it");

    // the dial slides in place: no page load from tab to tab
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(E2E_BASE + "/", { waitUntil: "networkidle" });
    await p.evaluate(() => { window.__sameDocument = true; });
    // on a phone the stops share the bar evenly, and the ruler has a long tick under the middle of each one
    const even = await p.evaluate(() => {
      const t = document.querySelector(".tabs");
      const r = t.getBoundingClientRect();
      const mids = [...t.querySelectorAll(":scope > .tab, :scope > .tab-group")].map((s) => { const b = s.getBoundingClientRect(); return b.left + b.width / 2; });
      const gaps = mids.slice(1).map((m, i) => m - mids[i]);
      const step = parseFloat(getComputedStyle(t).getPropertyValue("--tick-step"));
      return { isEven: t.classList.contains("is-even"), spread: Math.max(...gaps) - Math.min(...gaps), step, gap: gaps[0], left: r.left, right: innerWidth - r.right };
    });
    ok(even.isEven && even.spread < 1.5 && Math.abs(even.step - even.gap) < 1 && Math.abs(even.left - even.right) < 2, "on a phone the tabs and the ruler's long ticks are evenly spaced across the bar", even);
    const barH = () => p.evaluate(() => Math.round(document.querySelector(".topbar").getBoundingClientRect().height * 10) / 10);
    const startH = await barH();
    for (const href of tabs.filter((h) => h !== "/")) {
      await p.evaluate((h) => document.querySelector(`.tabs a.tab[href="${h}"]`).click(), href);
      await p.waitForFunction((h) => location.pathname === h && !document.querySelector(".page-stage"), href, { timeout: 15000 });
      await p.waitForTimeout(150);
      ok((await barH()) === startH, `the bar keeps its height on ${href}`, [await barH(), startH]);
      ok(await p.evaluate(() => window.__sameDocument === true), `${href} slides in without a page load`);
      ok((await p.evaluate(() => document.querySelector(".tab.is-active").getAttribute("href"))) === href, `and its tab is the active one`);
    }
    if (tabs.includes("/studio")) {
      await p.evaluate(() => document.querySelector('.tabs a.tab[href="/studio"]').click());
      await p.waitForFunction(() => location.pathname === "/studio" && !document.querySelector(".page-stage"), null, { timeout: 15000 });
      await p.waitForSelector("#studio-mount .studio-native", { timeout: 20000 });
      ok(await p.evaluate(() => window.__sameDocument === true), "the Studio comes along in the slide");
    }
    await p.goBack();
    await p.waitForTimeout(800);
    ok(await p.evaluate(() => window.__sameDocument === true), "Back slides too");
    ok(errs.length === 0, "no page errors", errs);
    await ctx.close();

    // What the live site adds that a local server does not: Cloudflare's scripts (email protection, analytics) and its hidden email
    // addresses, and a page with styles of its own. None of it may turn a slide into a full page load.
    const cf = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const enc = (email, key = 0x5a) => key.toString(16).padStart(2, "0") + [...Buffer.from(email)].map((c) => (c ^ key).toString(16).padStart(2, "0")).join("");
    await cf.route(/\/studio$/, async (route) => {
      const res = await route.fetch();
      let html = await res.text();
      html = html.replace("</head>", "<style>.qq-page-only{outline:3px solid rgb(1, 2, 3)}</style></head>")
        .replace("</body>", '<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script><script defer src="https://static.cloudflareinsights.com/beacon.min.js"></script></body>')
        .replace('id="studio-mount"', `id="studio-mount"></div><p class="qq-page-only"><a id="qq-mail" href="/cdn-cgi/l/email-protection#${enc("hi@example.com")}"><span class="__cf_email__" data-cfemail="${enc("hi@example.com")}">[email&#160;protected]</span></a></p><div hidden`);
      await route.fulfill({ response: res, body: html });
    });
    await cf.route(/cdn-cgi|cloudflareinsights/, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
    const q = await cf.newPage();
    const qerrs = []; q.on("pageerror", (e) => qerrs.push(String(e)));
    await q.goto(E2E_BASE + "/", { waitUntil: "networkidle" });
    await q.evaluate(() => { window.__sameDocument = true; });
    if (tabs.includes("/studio")) {
      await q.evaluate(() => document.querySelector('.tabs a.tab[href="/studio"]').click());
      await q.waitForFunction(() => location.pathname === "/studio" && !document.querySelector(".page-stage"), null, { timeout: 15000 });
      ok(await q.evaluate(() => window.__sameDocument === true), "a page with Cloudflare's scripts still slides in place", await q.evaluate(() => sessionStorage.getItem("slideFallback")));
      const mail = await q.evaluate(() => { const a = document.getElementById("qq-mail"); return a && [a.getAttribute("href"), a.textContent]; });
      ok(mail && mail[0] === "mailto:hi@example.com" && mail[1] === "hi@example.com", "and its hidden email address is put back", mail);
      ok(await q.evaluate(() => getComputedStyle(document.querySelector(".qq-page-only")).outlineColor === "rgb(1, 2, 3)"), "its own styles come with it");
      await q.evaluate(() => document.querySelector('.tabs a.tab[href="/"]').click());
      await q.waitForFunction(() => location.pathname === "/" && !document.querySelector(".page-stage"), null, { timeout: 15000 });
      ok(await q.evaluate(() => window.__sameDocument === true && ![...document.querySelectorAll("head style")].some((s) => s.textContent.includes("qq-page-only"))), "and leave with it when the next page slides in");
    }
    ok(qerrs.length === 0, "no page errors", qerrs);
    await cf.close();
  } finally {
    await f("DELETE", `/pages/${pg.id}`);
    await f("DELETE", `/trash/pages/${pg.id}`).catch(() => {});
    await b.close();
  }
  console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
  process.exit(fail ? 1 : 0);
})();
