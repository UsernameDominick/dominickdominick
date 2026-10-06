// A broad check of the public site, page by page: SEO, accessibility, layout at several widths, broken links, console errors and weight.
// Not a test (the runner only picks up test_*.js): run it by hand and read the report.
//   node tests/e2e/audit/audit-public.js                 against http://localhost:8787
//   E2E_BASE=http://localhost:8800 node tests/e2e/audit/audit-public.js
//   node tests/e2e/audit/audit-public.js --json out.json   also write the raw findings
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const fs = require("fs");
const { chromium, axeSource } = require("../_pw.cjs");

const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const skip = (u) => /\/deep-link-test-|\/simulation\/\d+$/.test(u) && !args.includes("--all");
const findings = []; // { sev, area, page, vp, msg }
const add = (sev, area, page, vp, msg, extra) => findings.push({ sev, area, page, vp, msg, extra });

(async () => {
  const b = await chromium.launch();
  // ---- the page list
  const sm = await (await fetch(E2E_BASE + "/sitemap.xml")).text();
  const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname).filter((u) => !skip(u));
  for (const extra of ["/search?q=circuit", "/search?q=zzzznothing", "/does-not-exist", "/random/does-not-exist", "/projects/does-not-exist", "/topics/does-not-exist"]) urls.push(extra);
  const pages = [...new Set(urls)];
  console.log(`Auditing ${pages.length} pages on ${E2E_BASE}\n`);

  const seenTitle = new Map();
  const seenDesc = new Map();
  const linkStatus = new Map();
  const axe = axeSource();

  for (const path of pages) {
    // ---- 1. raw response
    const res = await fetch(E2E_BASE + path, { redirect: "manual" });
    const html = await res.text();
    const expect404 = /does-not-exist|zzzznothing/.test(path);
    if (!expect404 && res.status !== 200) add("high", "http", path, "", `HTTP ${res.status}`);
    if (expect404 && path.includes("does-not-exist") && res.status !== 404) add("high", "http", path, "", `a missing page answered ${res.status}, not 404`);
    const h = Object.fromEntries(res.headers);
    if (res.status === 200 && !/text\/html/.test(h["content-type"] || "")) add("med", "http", path, "", `content-type ${h["content-type"]}`);
    if (!h["x-content-type-options"]) add("low", "security", path, "", "no X-Content-Type-Options");
    if (!h["content-security-policy"]) add("low", "security", path, "", "no CSP header");
    if (!h["cache-control"]) add("info", "perf", path, "", "HTML has no Cache-Control header");

    // ---- 2. SEO from the HTML
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    const consoleErrs = [];
    const failed = [];
    p.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_CONNECTION|Failed to load resource.*(jsdelivr|google)/.test(m.text())) consoleErrs.push(m.text().slice(0, 160)); });
    p.on("pageerror", (e) => consoleErrs.push("pageerror: " + String(e).slice(0, 160)));
    p.on("requestfailed", (r) => { if (!/jsdelivr|google|cdnjs/.test(r.url())) failed.push(r.url() + " " + (r.failure() || {}).errorText); });
    const sizes = [];
    p.on("response", async (r) => { try { const len = Number(r.headers()["content-length"] || 0); sizes.push({ url: r.url(), status: r.status(), len, type: r.headers()["content-type"] || "", cache: r.headers()["cache-control"] || "" }); } catch (e) {} });
    await p.goto(E2E_BASE + path, { waitUntil: "networkidle" }).catch(() => {});
    const seo = await p.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const meta = (n) => (q(`meta[name="${n}"]`) || {}).content || "";
      const og = (n) => (q(`meta[property="${n}"]`) || {}).content || "";
      const heads = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => ({ l: Number(h.tagName[1]), t: h.textContent.trim().slice(0, 50), visible: !!(h.offsetWidth || h.offsetHeight) }));
      const jsonld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return JSON.parse(s.textContent); } catch (e) { return { __invalid: String(e).slice(0, 60) }; } });
      const imgs = [...document.images].map((i) => ({ src: i.currentSrc || i.src, alt: i.getAttribute("alt"), w: i.getAttribute("width"), h: i.getAttribute("height"), nw: i.naturalWidth, nh: i.naturalHeight, dw: i.clientWidth, dh: i.clientHeight, lazy: i.loading, cls: i.className, inPicture: !!i.closest("picture"), visible: !!(i.offsetWidth || i.offsetHeight), top: i.getBoundingClientRect().top + scrollY }));
      const links = [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.getAttribute("href"), text: (a.textContent || "").trim(), label: a.getAttribute("aria-label") || "", blank: a.target === "_blank", rel: a.rel, external: a.host && a.host !== location.host, w: a.offsetWidth, h: a.offsetHeight, visible: !!(a.offsetWidth || a.offsetHeight), inNav: !!a.closest("nav,footer,header") }));
      return {
        title: document.title, desc: meta("description"), canonical: (q('link[rel="canonical"]') || {}).href || "", robots: meta("robots"), lang: document.documentElement.lang, viewport: meta("viewport"), themeColor: meta("theme-color"),
        icon: !!q('link[rel~="icon"]'), ogTitle: og("og:title"), ogDesc: og("og:description"), ogImage: og("og:image"), ogUrl: og("og:url"), ogType: og("og:type"), ogSite: og("og:site_name"), twCard: meta("twitter:card"), twImage: meta("twitter:image"),
        h1: heads.filter((x) => x.l === 1 && x.visible).length, heads, jsonld, imgs, links, rss: !!q('link[rel="alternate"][type="application/rss+xml"]'),
        landmarks: { main: document.querySelectorAll("main").length, nav: document.querySelectorAll("nav").length, header: document.querySelectorAll("header").length, footer: document.querySelectorAll("footer").length }, skip: !!q('a[href="#main-content"], a.skip-link'),
        bodyWords: (document.body.innerText || "").trim().split(/\s+/).length,
      };
    });
    const indexable = !/noindex/.test(seo.robots) && res.status === 200;
    if (!seo.title) add("high", "seo", path, "", "no <title>");
    else {
      if (seo.title.length > 65) add("med", "seo", path, "", `title is ${seo.title.length} characters (search results cut off at about 60)`, seo.title);
      if (seo.title.length < 15 && !expect404) add("low", "seo", path, "", `title is short (${seo.title.length}): "${seo.title}"`);
      if (indexable) { const k = seo.title; seenTitle.set(k, [...(seenTitle.get(k) || []), path]); }
    }
    if (indexable) {
      if (!seo.desc) add("med", "seo", path, "", "no meta description");
      else {
        if (seo.desc.length > 165) add("low", "seo", path, "", `meta description is ${seo.desc.length} characters (cut off at about 155)`);
        if (seo.desc.length < 50) add("low", "seo", path, "", `meta description is short (${seo.desc.length})`);
        seenDesc.set(seo.desc, [...(seenDesc.get(seo.desc) || []), path]);
      }
      if (!seo.canonical) add("med", "seo", path, "", "no canonical link");
      else if (!seo.canonical.endsWith(path.split("?")[0] === "/" ? "/" : path.split("?")[0])) add("med", "seo", path, "", `canonical does not match the path: ${seo.canonical}`);
      if (!seo.ogTitle) add("low", "seo", path, "", "no og:title");
      if (!seo.ogDesc) add("low", "seo", path, "", "no og:description");
      if (!seo.ogImage) add("low", "seo", path, "", "no og:image (links shared from here show no picture)");
      if (!seo.ogUrl) add("low", "seo", path, "", "no og:url");
      if (!seo.twCard) add("low", "seo", path, "", "no twitter:card");
      if (!seo.rss) add("info", "seo", path, "", "no RSS alternate link");
      if (seo.bodyWords < 60 && !/\/(search|archive)/.test(path)) add("low", "seo", path, "", `only ${seo.bodyWords} words on the page`);
    }
    if (!seo.lang) add("med", "a11y", path, "", "<html> has no lang");
    if (!seo.viewport) add("high", "seo", path, "", "no viewport meta");
    if (!seo.icon) add("low", "seo", path, "", "no favicon link");
    if (seo.h1 !== 1 && !expect404) add("med", "seo", path, "", `${seo.h1} visible <h1> elements`);
    for (let i = 1; i < seo.heads.length; i++) if (seo.heads[i].l - seo.heads[i - 1].l > 1 && seo.heads[i].visible) { add("low", "a11y", path, "", `heading level jumps from h${seo.heads[i - 1].l} to h${seo.heads[i].l} ("${seo.heads[i].t}")`); break; }
    for (const j of seo.jsonld) if (j.__invalid) add("high", "seo", path, "", "invalid JSON-LD: " + j.__invalid);
    if (indexable && /\/(random|projects)\/[^/]+$/.test(path) && !seo.jsonld.length) add("low", "seo", path, "", "an article/project page with no structured data (JSON-LD)");
    const m = seo.landmarks;
    if (m.main !== 1) add("med", "a11y", path, "", `${m.main} <main> landmarks`);
    if (!m.nav) add("low", "a11y", path, "", "no <nav> landmark");
    if (!m.header) add("low", "a11y", path, "", "no <header>");
    if (!m.footer) add("low", "a11y", path, "", "no <footer>");
    if (!seo.skip) add("low", "a11y", path, "", "no skip-to-content link");
    for (const i of seo.imgs.filter((x) => x.visible)) {
      if (i.alt === null) add("med", "a11y", path, "", `image with no alt attribute: ${i.src.slice(-60)}`);
      if (!i.w && !i.h && !/svg/.test(i.src) && i.dw > 40) add("low", "perf", path, "", `image without width/height (layout shift): ${i.src.slice(-60)}`);
      if (i.nw && i.dw && i.nw > i.dw * 2.5 && i.nw > 800) add("low", "perf", path, "", `image is ${i.nw}px wide but shown at ${i.dw}px: ${i.src.slice(-60)}`);
      if (i.top > 1400 && i.lazy !== "lazy") add("low", "perf", path, "", `image far down the page is not lazy-loaded: ${i.src.slice(-60)}`);
    }
    const textless = seo.links.filter((l) => l.visible && !l.text && !l.label);
    if (textless.length) add("med", "a11y", path, "", `${textless.length} link(s) with no text or label: ${textless.slice(0, 3).map((l) => l.href).join(", ")}`);
    for (const l of seo.links.filter((x) => x.blank && x.external && !/noopener/.test(x.rel))) add("low", "security", path, "", `external link opens a new tab without rel=noopener: ${l.href}`);
    const generic = seo.links.filter((l) => /^(click here|here|read more|more|link)$/i.test(l.text));
    if (generic.length > 1) add("low", "seo", path, "", `${generic.length} links with vague text ("${generic[0].text}")`);
    // internal links get checked once each
    for (const l of seo.links) {
      if (!l.href || /^(#|mailto:|tel:|javascript:)/.test(l.href)) continue;
      let u;
      try { u = new URL(l.href, E2E_BASE + path); } catch (e) { add("med", "links", path, "", `unparseable link ${l.href}`); continue; }
      if (u.origin !== E2E_BASE && !/dominickdominick\.com$/.test(u.hostname)) continue;
      const target = u.origin === E2E_BASE ? u.pathname + u.search : u.pathname + u.search; // the live domain's paths are checked on the local server
      if (!linkStatus.has(target)) { const r = await fetch(E2E_BASE + target, { redirect: "manual" }).catch(() => ({ status: 0 })); linkStatus.set(target, r.status); }
      const st = linkStatus.get(target);
      if (st === 429) add("info", "links", path, "", `link ${l.href} was rate limited while checking, not verified`);
      else if (st >= 400 || st === 0) add("high", "links", path, "", `broken internal link ${l.href} → ${st}`);
      else if (st >= 300) add("low", "links", path, "", `internal link ${l.href} redirects (${st})`);
      if (/^https?:\/\/(www\.)?dominickdominick\.com/.test(l.href) && !/localhost/.test(E2E_BASE)) { /* absolute links to itself are fine live */ }
    }
    const missing = path.includes("does-not-exist"); // these pages are meant to answer 404, so the browser logs it
    const realErrs = missing ? consoleErrs.filter((m) => !/status of 404/.test(m)) : consoleErrs;
    if (realErrs.length) add("high", "console", path, "", `console errors: ${[...new Set(realErrs)].slice(0, 3).join(" | ")}`);
    if (failed.length) add("med", "network", path, "", `failed requests: ${[...new Set(failed)].slice(0, 3).join(" | ")}`);
    const bad = sizes.filter((s) => s.status >= 400 && !/favicon/.test(s.url) && !(missing && s.url === E2E_BASE + path));
    if (bad.length) add("med", "network", path, "", `error responses: ${bad.slice(0, 3).map((s) => s.status + " " + s.url).join(" | ")}`);
    const total = sizes.reduce((a, s) => a + s.len, 0);
    if (total > 1.5e6) add("low", "perf", path, "", `page weight ${(total / 1e6).toFixed(1)} MB`);
    for (const s of sizes.filter((x) => /\.(js|css)(\?|$)/.test(x.url) && !x.cache)) add("info", "perf", path, "", `no Cache-Control on ${s.url.replace(E2E_BASE, "")}`);
    await ctx.close();

    // ---- 3. layout and accessibility at several widths and both themes
    for (const [w, hgt, scheme] of [[320, 700, "light"], [390, 800, "dark"], [768, 900, "light"], [1280, 800, "dark"], [1280, 800, "light"]]) {
      const c = await b.newContext({ viewport: { width: w, height: hgt }, colorScheme: scheme, hasTouch: w < 800, isMobile: w < 500 });
      const pg = await c.newPage();
      await pg.goto(E2E_BASE + path, { waitUntil: "networkidle" }).catch(() => {});
      await pg.evaluate((t) => document.documentElement.setAttribute("data-theme", t), scheme);
      await pg.waitForTimeout(700);
      const vp = `${w}${scheme[0]}`;
      const lay = await pg.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const over = [];
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const cs = getComputedStyle(el);
          if (cs.position === "fixed" || cs.visibility === "hidden" || cs.display === "none") continue;
          let scrolls = false;
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if ((ox === "auto" || ox === "scroll") && p.scrollWidth > p.clientWidth) { scrolls = true; break; } }
          if (scrolls) continue;
          if (r.right > vw + 2 && !el.closest("pre,table,.code-block,[class*=scroll],[class*=marquee],svg,.sim-canvas,figure.table,.table-wrap,.topic-cloud,.hero")) over.push((el.tagName + "." + (el.className || "").toString().split(" ")[0]).slice(0, 50) + ` right=${Math.round(r.right)}`);
        }
        const small = [];
        for (const el of document.querySelectorAll("a[href],button,input,select,textarea,summary")) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
          const inline = getComputedStyle(el).display === "inline" && el.tagName === "A" && el.closest("p,li,td");
          if (!inline && (r.width < 24 || r.height < 24)) small.push((el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        const tiny = [...document.querySelectorAll("p,li,a,span,td,h1,h2,h3,label,button")].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12 && e.offsetHeight).map((e) => (e.textContent || "").trim().slice(0, 30)).slice(0, 5);
        const clipped = [...document.querySelectorAll("p,h1,h2,h3,li,a,button,span")].filter((e) => { const cs = getComputedStyle(e); return e.scrollWidth > e.clientWidth + 2 && cs.overflowX !== "visible" && cs.textOverflow !== "ellipsis" && e.clientWidth > 4 && !e.closest("pre,code,.sr-only,.visually-hidden"); }).map((e) => (e.textContent || "").trim().slice(0, 30)).slice(0, 3);
        const doc = { sw: document.documentElement.scrollWidth, vw };
        return { over: over.slice(0, 5), small: small.slice(0, 40), tiny, clipped, doc, bodyH: document.body.scrollHeight };
      });
      if (lay.doc.sw > lay.doc.vw + 1) add("high", "layout", path, vp, `horizontal scrolling: page is ${lay.doc.sw}px wide in a ${lay.doc.vw}px window`);
      if (lay.over.length) add("med", "layout", path, vp, `content runs past the right edge: ${lay.over.slice(0, 3).join(", ")}`);
      if (lay.tiny.length) add("low", "layout", path, vp, `text smaller than 12px: ${lay.tiny.join(" | ")}`);
      if (lay.clipped.length) add("med", "layout", path, vp, `text clipped by its box: ${lay.clipped.join(" | ")}`);
      if (w <= 390 && lay.small.length) add("low", "ux", path, vp, `${lay.small.length} touch targets under 24px: ${lay.small.slice(0, 4).join(", ")}`);
      await pg.addScriptTag({ content: axe }).catch(() => {});
      const ax = await pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"], resultTypes: ["violations"] })).violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.target.join(" ").slice(0, 70)).join(" ; "), help: v.help }))).catch(() => []);
      for (const v of ax) add(v.impact === "critical" || v.impact === "serious" ? "high" : "med", "a11y", path, vp, `axe ${v.id} (${v.n}): ${v.help} — ${v.sample}`);
      // keyboard: tab through to see whether anything receives focus without a visible indicator
      if (w === 1280 && scheme === "dark") {
        const focus = await pg.evaluate(async () => {
          const out = [];
          const el0 = document.activeElement;
          void el0;
          return out;
        });
        void focus;
        let invisible = 0, stops = 0;
        for (let i = 0; i < 25; i++) {
          await pg.keyboard.press("Tab");
          const f = await pg.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); const drawn = (x) => { const c = getComputedStyle(x); return (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0) || c.boxShadow !== "none"; };
            let ring = drawn(e) || e.tagName === "IFRAME"; /* a frame draws its own focus inside itself */ for (let a = e.parentElement; a && !ring && a !== document.body; a = a.parentElement) if (a.matches(":focus-within")) ring = drawn(a); return { ring, vis: r.width > 0 && r.height > 0, name: (e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 25), off: r.bottom < 0 || r.top > innerHeight + 2000 }; });
          if (!f) continue;
          stops++;
          if (f.vis && !f.ring) { invisible++; if (invisible <= 2) add("med", "a11y", path, vp, `keyboard focus shows no outline or ring on "${f.name}"`); }
        }
        if (stops === 0) add("med", "a11y", path, vp, "nothing on the page can be reached with Tab");
      }
      await c.close();
    }
  }

  // ---- duplicates across pages
  for (const [t, ps] of seenTitle) if (ps.length > 1) add("med", "seo", ps.join(" , "), "", `${ps.length} pages share the title "${t}"`);
  for (const [d, ps] of seenDesc) if (ps.length > 1) add("med", "seo", ps.join(" , "), "", `${ps.length} pages share a meta description: "${d.slice(0, 60)}…"`);

  // ---- sitewide files
  const robots = await (await fetch(E2E_BASE + "/robots.txt")).text();
  if (!/Sitemap:/i.test(robots)) add("med", "seo", "/robots.txt", "", "robots.txt does not name the sitemap");
  const feed = await fetch(E2E_BASE + "/rss.xml");
  if (feed.status !== 200) add("high", "seo", "/rss.xml", "", `feed answers ${feed.status}`);
  for (const f of ["/favicon.ico", "/style.css", "/nav.js"]) { const r = await fetch(E2E_BASE + f); if (r.status !== 200) add(f === "/favicon.ico" ? "low" : "high", "http", f, "", `${r.status}`); }
  const nf = await fetch(E2E_BASE + "/definitely-not-here");
  if (nf.status !== 404) add("high", "seo", "/definitely-not-here", "", `soft 404: answers ${nf.status}`);
  for (const [loc, st] of [["/index.html", null], ["/Random", null], ["/random/", null], ["//random", null]]) { const r = await fetch(E2E_BASE + loc, { redirect: "manual" }).catch(() => ({ status: 0 })); if (r.status === 200 && loc !== "/random/") add("low", "seo", loc, "", `duplicate URL answers 200 (should redirect or 404): ${loc}`); void st; }

  await b.close();

  // ---- report
  const order = { high: 0, med: 1, low: 2, info: 3 };
  const groups = new Map();
  for (const f of findings) { const key = `${f.area}|${f.msg.replace(/\d+/g, "#").replace(/https?:\/\/\S+/g, "URL").slice(0, 70)}|${f.sev}`; if (!groups.has(key)) groups.set(key, { ...f, pages: new Set(), vps: new Set(), n: 0 }); const g = groups.get(key); g.pages.add(f.page); if (f.vp) g.vps.add(f.vp); g.n++; }
  const list = [...groups.values()].sort((a, b) => order[a.sev] - order[b.sev] || a.area.localeCompare(b.area));
  const counts = { high: 0, med: 0, low: 0, info: 0 };
  for (const g of list) counts[g.sev]++;
  console.log(`\n==== ${list.length} distinct findings: ${counts.high} high, ${counts.med} medium, ${counts.low} low, ${counts.info} info ====\n`);
  for (const g of list) {
    const where = g.pages.size > 3 ? `${g.pages.size} pages` : [...g.pages].join(", ");
    console.log(`[${g.sev.toUpperCase()}] ${g.area}: ${g.msg}${g.vps.size ? `  (${[...g.vps].join(" ")})` : ""}\n        on ${where}`);
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(findings, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
