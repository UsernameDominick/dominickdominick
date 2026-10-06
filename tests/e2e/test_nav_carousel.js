// The nav: no Random (Articles) tab and no Hidden Notes tab; every tab of the dial slides in place, like a carousel, with no page load (even
// with what Cloudflare adds to live pages)
// (the Studio and the song and circuit players come along); a page with a Study block stays out of the nav, the sitemap and search
// engines, is found through the site's search, and always asks for its password.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
// What the dial's ruler must look like, measured in the page: a long tick under the middle of every stop (the link, for a stop with a
// dropdown), five short ticks evenly between neighbours, and the needle on the current stop's long tick. Positions are screen coordinates,
// so it holds wherever the strip is scrolled to.
function rulerState() {
  const t = document.querySelector(".tabs");
  const mid = (el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
  const stops = [...t.querySelectorAll(":scope > .tab, :scope > .tab-group")];
  const anchors = stops.map((x) => (x.classList.contains("tab-group") ? x.querySelector(".tab") || x : x));
  const marks = [...t.querySelectorAll(".tab-ruler > i")].map((i) => ({ c: mid(i), major: i.classList.contains("is-major") }));
  const majors = marks.filter((m) => m.major).map((m) => m.c);
  const between = []; let run = []; let prev = null;
  for (const m of marks) {
    if (m.major) { if (prev !== null && run.length) { const pts = [prev, ...run, m.c]; const g = pts.slice(1).map((v, i) => v - pts[i]); between.push({ n: run.length, spread: Math.max(...g) - Math.min(...g) }); } prev = m.c; run = []; } else run.push(m.c);
  }
  const act = t.querySelector(".tab.is-active");
  const needle = mid(t.querySelector(".tab-indicator"));
  const strip = t.getBoundingClientRect();
  return {
    dpr: window.devicePixelRatio, stops: anchors.length, majors: majors.length,
    stopOff: Math.max(0, ...anchors.map((a, i) => Math.abs(mid(a) - (majors[i] === undefined ? 9999 : majors[i])))),
    needleOff: act ? Math.min(...majors.map((c) => Math.abs(c - needle))) : null,
    needleWidth: parseFloat(getComputedStyle(t).getPropertyValue("--indicator-width")) || 0,
    five: between.every((b) => b.n === 5), spread: Math.max(0, ...between.map((b) => b.spread)),
    shown: marks.filter((m) => m.c >= strip.left && m.c <= strip.right).length,
    drawn: [...t.querySelectorAll(".tab-ruler > i")].every((i) => getComputedStyle(i).backgroundColor !== "rgba(0, 0, 0, 0)" && i.getBoundingClientRect().width > 0),
    cut: [...t.querySelectorAll(".tab-label")].filter((l) => l.scrollWidth > l.clientWidth + 1).length,
    scrolls: t.scrollWidth > t.clientWidth + 1, left: strip.left, right: innerWidth - strip.right,
    widths: anchors.map((a) => a.getBoundingClientRect().width),
  };
}
const rulerOk = (r) => r.stops > 0 && r.majors === r.stops && r.stopOff <= 0.5 / r.dpr + 0.05 && r.five && r.spread <= 1 / r.dpr + 0.05 && r.shown > 0 && r.drawn;

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
    // on a phone the names are never cut short; the ruler has a long tick under the middle of every tab, and the needle is on the current one
    const start = await p.evaluate(rulerState);
    ok(start.cut === 0, "on a phone no tab's name is cut short", start);
    ok(rulerOk(start) && start.needleOff <= 0.5 / start.dpr + 0.05, "the ruler has a long tick under every tab, five short ones evenly between, and the needle is on the current tab's", start);
    if (start.scrolls) {
      // the strip scrolls: wherever it is scrolled to, the ticks still sit under their tabs (they travel with them)
      const moved = [];
      for (const to of [0, 9999, 40]) { await p.evaluate((x) => { document.querySelector(".tabs").scrollLeft = x; }, to); await p.waitForTimeout(60); moved.push(await p.evaluate(rulerState)); }
      ok(moved.every(rulerOk), "and scrolling the strip keeps every tick under its tab", moved.filter((r) => !rulerOk(r)));
    } else {
      ok(Math.max(...start.widths) - Math.min(...start.widths) < 1.5 && Math.abs(start.left - start.right) < 2, "they all fit, so the tabs share the bar evenly", start);
    }
    {
      // Three stops (the owner's own bar) share the width evenly; the ruler follows them.
      const rp = await (await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage();
      await rp.goto(E2E_BASE + "/", { waitUntil: "networkidle" });
      await rp.evaluate(() => {
        const stops = [...document.querySelectorAll(".tabs > .tab, .tabs > .tab-group")];
        stops.forEach((x, i) => { if (i > 1 && i < stops.length - 1) x.remove(); });
        window.siteLayoutNav();
      });
      const r = await rp.evaluate(rulerState);
      ok(rulerOk(r) && !r.scrolls && Math.max(...r.widths) - Math.min(...r.widths) < 1.5, "with three stops they are even, and each long tick is right under its stop", r);
      await rp.context().close();
    }
    for (const [w, h, dpr, phone] of [[393, 852, 3, true], [375, 700, 3, true], [320, 640, 2, true], [768, 900, 2, false], [1280, 800, 1, false]]) {
      // every width and screen density: the ticks line up, after a click on each tab too
      const rc = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: phone, hasTouch: phone });
      const rp = await rc.newPage();
      await rp.goto(E2E_BASE + "/", { waitUntil: "networkidle" });
      const bad = [];
      for (const href of tabs) {
        await rp.evaluate((x) => document.querySelector(`.tabs a.tab[href="${x}"]`).click(), href);
        await rp.waitForFunction((x) => location.pathname === x && !document.querySelector(".page-stage"), href, { timeout: 15000 });
        await rp.waitForTimeout(700);
        const r = await rp.evaluate(rulerState);
        if (!rulerOk(r) || !(r.needleOff <= 0.5 / r.dpr + 0.05) || r.needleWidth <= 0) bad.push([href, r]);
      }
      ok(bad.length === 0, `${w} px wide at ${dpr}x: on every tab the ticks sit under their tabs and the needle is on the current one`, bad[0]);
      await rc.close();
    }
    {
      // a page with no tab of its own (a missing page): the ruler is still there, with no needle
      const rp = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
      await rp.goto(E2E_BASE + "/no-such-page-qq", { waitUntil: "networkidle" });
      const r = await rp.evaluate(rulerState);
      ok(rulerOk(r) && r.needleWidth === 0, "a page that is not one of the tabs keeps the ruler and has no needle", r);
      await rp.context().close();
    }
    {
      // The header can leave the screen (a print preview, a style that hides it): the tabs then have no size at all. Nothing may be left
      // spinning on that (the ruler once looped without end, which froze the page), and the ruler comes back with the header.
      const rp = await (await b.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
      await rp.goto(E2E_BASE + "/", { waitUntil: "networkidle" });
      const alive = () => Promise.race([rp.evaluate(() => 1).catch(() => 0), new Promise((r) => setTimeout(() => r(0), 6000))]);
      await rp.emulateMedia({ media: "print" });
      await rp.waitForTimeout(700);
      const responsive = (await alive()) === 1;
      ok(responsive, "printing the page leaves it responsive (the ruler does not loop on a hidden header)");
      if (responsive) {
        await rp.emulateMedia({ media: "screen" });
        await rp.waitForTimeout(700);
        const back = await rp.evaluate(rulerState);
        ok(rulerOk(back), "and the ruler is back when the header is", back);
        await rp.evaluate(() => { const st = document.createElement("style"); st.id = "qq-hide"; st.textContent = ".topbar{display:none !important}"; document.head.appendChild(st); window.siteLayoutNav(); });
        await rp.waitForTimeout(300);
        ok((await alive()) === 1 && (await rp.evaluate(() => document.querySelectorAll(".tab-ruler > i").length)) === 0, "with the header hidden there are no marks and nothing is spinning");
        await rp.evaluate(() => { document.getElementById("qq-hide").remove(); window.siteLayoutNav(); });
        await rp.waitForTimeout(300);
        ok(rulerOk(await rp.evaluate(rulerState)), "and the marks return when it is shown again");
      }
      await rp.context().close();
    }
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
