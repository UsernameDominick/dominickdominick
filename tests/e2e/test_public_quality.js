// Fixes from the site quality passes, checked in a real browser: contrast, focus, touch-target size, small screens, one address per page.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
(async () => {
  const b = await chromium.launch();
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const desk = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const axe = axeSource();
  const small = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetWidth).map((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height), (e.textContent || "").trim().slice(0, 20)]).filter(([w, h]) => w < 24 || h < 24), sel);

  // find an article and a project to look at
  const sm = await (await fetch(E2E_BASE + "/sitemap.xml")).text();
  const paths = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  const article = paths.find((x) => /^\/random\/[^/]+$/.test(x));
  const project = paths.find((x) => /^\/projects\/[^/]+$/.test(x));
  ok(article && project, "the test site has an article and a project to check", { article, project });

  // search highlight contrast in the light theme
  {
    const p = await desk.newPage();
    await p.goto(E2E_BASE + "/search?q=the", { waitUntil: "networkidle" });
    await p.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await p.waitForTimeout(800);
    await p.addScriptTag({ content: axe });
    const v = await p.evaluate(async () => (await axe.run(document.querySelector("main"), { runOnly: ["color-contrast"], resultTypes: ["violations"] })).violations.map((x) => x.nodes.map((n) => n.target.join(" ")).join(" ; ")));
    ok(v.length === 0 && (await p.locator(".search-results mark").count()) > 0, "search highlights have enough contrast in the light theme", v);
    await p.close();
  }

  // the 404 page fits a 320px phone
  {
    const c = await b.newContext({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    await p.goto(E2E_BASE + "/nope-not-here", { waitUntil: "networkidle" });
    ok(!(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)), "the 404 page does not scroll sideways on a 320px phone", await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]));
    await c.close();
  }

  // the finder: Search at the end of the nav opens it, with the focus in its box; Escape closes it and gives the focus back
  {
    const p = await desk.newPage();
    await p.goto(E2E_BASE + "/", { waitUntil: "networkidle" });
    await p.locator("#finder-open").focus();
    const ring = await p.locator("#finder-open").evaluate((e) => { const cs = getComputedStyle(e); return [cs.outlineStyle, parseFloat(cs.outlineWidth)]; });
    ok(ring[0] !== "none" && ring[1] >= 2, "the Search stop of the nav shows a focus ring", ring);
    await p.keyboard.press("Enter");
    await p.waitForTimeout(200);
    ok((await p.evaluate(() => document.activeElement.id)) === "finder-input" && (await p.isVisible("#site-finder")), "it opens the finder with the focus in its box");
    const under = await p.evaluate(() => { const nav = document.querySelector(".topbar").getBoundingClientRect(); const pn = document.querySelector(".finder-panel").getBoundingClientRect(); const s = document.getElementById("finder-open").getBoundingClientRect(); return { panelTop: pn.top, navBottom: nav.bottom, navOnTop: !!document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2).closest("#finder-open") }; });
    ok(under.panelTop >= under.navBottom && under.navOnTop, "it opens under the nav, which stays in view and can be pressed", under);
    await p.keyboard.type("dark");
    await p.waitForTimeout(150);
    const shown = await p.evaluate(() => [...document.querySelectorAll("#finder-list .finder-item")].filter((e) => e.offsetParent).map((e) => e.id || e.textContent.trim()));
    ok(shown.length === 1 && shown[0] === "theme-toggle", "typing a setting's name finds it", shown);
    const before = await p.evaluate(() => document.documentElement.getAttribute("data-theme") || "dark");
    await p.keyboard.press("Enter");
    ok((await p.evaluate(() => document.documentElement.getAttribute("data-theme") || "dark")) !== before, "and Enter switches it");
    await p.keyboard.press("Escape");
    ok(!(await p.isVisible("#site-finder")) && (await p.evaluate(() => document.activeElement.id)) === "finder-open", "Escape closes it and gives the focus back");
    await p.keyboard.press("Control+k");
    ok(await p.isVisible("#site-finder"), "Ctrl+K opens it too");
    await p.close();
  }

  // touch targets on a phone
  {
    const p = await phone.newPage();
    await p.goto(E2E_BASE + article, { waitUntil: "networkidle" });
    ok((await small(p, ".breadcrumbs a")).length === 0, "breadcrumb links are at least 24px", await small(p, ".breadcrumbs a"));
    ok((await small(p, ".site-footer .footer-rss, .site-footer .footer-share")).length === 0, "the footer links are at least 24px", await small(p, ".site-footer a, .site-footer button"));
    ok((await small(p, ".heading-anchor")).length === 0, "heading anchors are at least 24px", await small(p, ".heading-anchor"));
    const dots = await p.evaluate(() => [...document.querySelectorAll(".article-meta-sep")].filter((e) => e.offsetWidth).length);
    ok(dots === 0, "the date line has no dots left hanging when it wraps on a phone", dots);
    await p.goto(E2E_BASE + "/random", { waitUntil: "networkidle" });
    ok((await small(p, "main h2 > a")).length === 0, "article titles in lists are at least 24px tall", await small(p, "main h2 > a"));
    await p.goto(E2E_BASE + "/projects", { waitUntil: "networkidle" });
    ok((await small(p, "main h2 > a")).length === 0, "project titles in lists are at least 24px tall", await small(p, "main h2 > a"));
    await p.close();
  }

  // one address per page
  {
    const r = await fetch(E2E_BASE + "//random?x=1", { redirect: "manual" });
    ok(r.status === 301 && new URL(r.headers.get("location")).pathname === "/random" && new URL(r.headers.get("location")).search === "?x=1", "//random goes to /random and keeps its query", { s: r.status, l: r.headers.get("location") });
    const ok200 = await fetch(E2E_BASE + "/random", { redirect: "manual" });
    ok(ok200.status === 200, "/random itself is fine");
  }

  // the feed
  {
    const feed = await fetch(E2E_BASE + "/rss.xml");
    const xml = await feed.text();
    const p = await desk.newPage();
    const parsed = await p.evaluate((x) => { const d = new DOMParser().parseFromString(x, "application/xml"); return { err: !!d.querySelector("parsererror"), items: d.querySelectorAll("item").length, self: (d.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "link")[0] || {}).getAttribute ? d.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "link")[0].getAttribute("rel") : null, last: (d.querySelector("lastBuildDate") || {}).textContent }; }, xml);
    ok(!parsed.err && parsed.items > 0, "the feed is well-formed XML with entries", parsed);
    ok(parsed.self === "self" && !isNaN(Date.parse(parsed.last)), "it names its own address and when it last changed", parsed);
    const tagged = await (await fetch(E2E_BASE + "/rss.xml?type=article")).text();
    ok(/rel="self"/.test(tagged) && /rss\.xml\?type=article/.test(tagged), "a filtered feed names its own filtered address");
    await p.close();
  }

  // the tab for the page you are on is in view on a phone
  {
    const p = await phone.newPage();
    const tabs = (await (await fetch(E2E_BASE + "/")).text()).match(/class="tab[^"]*" href="([^"]+)"/g) || [];
    const last = tabs.map((t) => /href="([^"]+)"/.exec(t)[1]).pop();
    await p.goto(E2E_BASE + last, { waitUntil: "networkidle" });
    const fit = await p.evaluate(() => { const w = document.querySelector(".tabs").getBoundingClientRect(); const t = document.querySelector(".tab.is-active"); if (!t) return null; const r = t.getBoundingClientRect(); return { left: r.left - w.left, right: w.right - r.right, ind: document.querySelector(".tab-indicator").getBoundingClientRect(), tab: r }; });
    ok(fit && fit.left >= -1 && fit.right >= -1, `the current page's tab (${last}) is fully inside the tab row on a phone`, fit);
    ok(fit && Math.abs(fit.ind.left - fit.tab.left) < 3 && Math.abs(fit.ind.width - fit.tab.width) < 3, "and the highlight sits exactly on it", fit && { ind: fit.ind.left, tab: fit.tab.left });
    await p.close();
  }

  // robots and the shuffle link
  {
    const robots = await (await fetch(E2E_BASE + "/robots.txt")).text();
    ok(/Disallow: \/shuffle/.test(robots) && /Disallow: \/admin\//.test(robots) && /Sitemap:/.test(robots), "robots.txt keeps crawlers off /shuffle and the admin and names the sitemap");
    const p = await desk.newPage();
    await p.goto(E2E_BASE + "/", { waitUntil: "networkidle" });
    ok((await p.getAttribute('a[href="/shuffle"]', "rel")) === "nofollow", "the shuffle link is nofollow");
    await p.close();
  }

  // thin topic pages: one item and no introduction stays out of search results and the sitemap, a busier topic stays in
  {
    const index = await (await fetch(E2E_BASE + "/topics")).text();
    const topics = [...index.matchAll(/href="\/topics\/([^"]+)">[^<]*<\/a> <span class="topic-count">(\d+)<\/span>/g)].map((m) => ({ tag: m[1], count: Number(m[2]) }));
    const sitemap = await (await fetch(E2E_BASE + "/sitemap.xml")).text();
    const lone = topics.find((t) => t.count === 1);
    const busy = topics.find((t) => t.count >= 2);
    ok(!!lone && !!busy, "the sample site has a one-item topic and a busier one to compare", topics);
    if (lone && busy) {
      const robots = async (t) => ((await (await fetch(E2E_BASE + "/topics/" + t.tag)).text()).match(/<meta name="robots" content="([^"]*)"/) || [])[1] || "";
      ok(/noindex/.test(await robots(lone)), "a one-item topic page asks not to be indexed", lone);
      ok(!sitemap.includes(`/topics/${lone.tag}</loc>`), "…and is left out of the sitemap");
      ok(!/noindex/.test(await robots(busy)), "a topic with several items stays indexable", busy);
      ok(sitemap.includes(`/topics/${busy.tag}</loc>`), "…and stays in the sitemap");
    }
  }

  // the "slow down" page
  {
    let res;
    for (let i = 0; i < 30; i++) { res = await fetch(E2E_BASE + "/search?q=abc" + i); if (res.status === 429) break; }
    ok(res.status === 429, "searching too often is turned away", res.status);
    const html = await res.text();
    ok(/text\/html/.test(res.headers.get("content-type")) && res.headers.get("retry-after") === "60" && /<h1>Slow down a moment<\/h1>/.test(html), "…with a real page and a Retry-After header", { ct: res.headers.get("content-type"), ra: res.headers.get("retry-after") });
    const p = await desk.newPage();
    await p.goto(E2E_BASE + "/search?q=again");
    await p.addScriptTag({ content: axe });
    const v = await p.evaluate(async () => (await axe.run(document, { resultTypes: ["violations"] })).violations.map((x) => x.id));
    ok(v.length === 0, "the page has no accessibility violations", v);
    await p.close();
  }
  await b.close();
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
})();
