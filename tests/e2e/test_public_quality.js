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

  // focus ring on the header search
  {
    const p = await desk.newPage();
    await p.goto(E2E_BASE + "/", { waitUntil: "networkidle" });
    await p.locator(".site-search input").focus();
    const ring = await p.locator(".site-search input").evaluate((e) => { const cs = getComputedStyle(e); return [cs.outlineStyle, parseFloat(cs.outlineWidth)]; });
    ok(ring[0] !== "none" && ring[1] >= 2, "the header search box shows a focus ring", ring);
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

  // robots and the shuffle link
  {
    const robots = await (await fetch(E2E_BASE + "/robots.txt")).text();
    ok(/Disallow: \/shuffle/.test(robots) && /Disallow: \/admin\//.test(robots) && /Sitemap:/.test(robots), "robots.txt keeps crawlers off /shuffle and the admin and names the sitemap");
    const p = await desk.newPage();
    await p.goto(E2E_BASE + "/", { waitUntil: "networkidle" });
    ok((await p.getAttribute('a[href="/shuffle"]', "rel")) === "nofollow", "the shuffle link is nofollow");
    await p.close();
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
