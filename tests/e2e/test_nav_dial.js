// The nav dial: Home in the middle and a little bigger with the other stops on either side, every name in lowercase, the Simulations stop
// called Sim, and the current stop stepping forward (it jumps up when it becomes current; with reduced motion it just sits forward).
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");

// What the strip looks like, measured in the page.
function dialState() {
  const t = document.querySelector(".tabs");
  const sr = t.getBoundingClientRect();
  const stops = [...t.children].filter((c) => c.matches(".tab, .tab-group, .tab-spacer"));
  const homeStop = stops.find((c) => c.matches(".tab-home") || c.querySelector(":scope > .tab-home"));
  const hr = homeStop && homeStop.getBoundingClientRect();
  const homeIdx = stops.indexOf(homeStop);
  const links = [...t.querySelectorAll("a.tab, button.tab")];
  const home = t.querySelector(".tab-home");
  const others = links.filter((a) => a !== home);
  const box = (a) => a.getBoundingClientRect().width;
  const ico = (a) => parseFloat(getComputedStyle(a.querySelector(".tab-ico")).width); // the drawn size, not the pose it is in
  const font = (a) => parseFloat(getComputedStyle(a.querySelector(".tab-label")).fontSize);
  const scale = (el) => { const m = /matrix\(([^,]+),/.exec(getComputedStyle(el).transform); return m ? Number(m[1]) : 1; };
  return {
    stops: stops.length, homeIdx, before: homeIdx, after: stops.length - homeIdx - 1,
    homeOff: hr ? Math.abs(hr.left + hr.width / 2 - (sr.left + sr.width / 2)) : null,
    homeWider: home ? box(home) > Math.max(...others.map(box)) : false,
    homeIcon: home ? ico(home) > Math.max(...others.map(ico)) : false,
    homeFont: home ? font(home) > Math.max(...others.map(font)) : false,
    cut: [...t.querySelectorAll(".tab-label")].filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent),
    scrolls: t.scrollWidth > t.clientWidth + 1,
    pageOver: document.documentElement.scrollWidth - innerWidth,
    lower: links.every((a) => getComputedStyle(a.querySelector(".tab-label")).textTransform === "lowercase"),
    shown: links.map((a) => a.querySelector(".tab-label").innerText),
    spacers: t.querySelectorAll(":scope > .tab-spacer").length,
    // the pose of every stop: the current one is forward, the rest are not
    pose: links.map((a) => ({ cur: a.classList.contains("is-active") || a.getAttribute("aria-expanded") === "true", s: scale(a.querySelector(".tab-ico")), l: scale(a.querySelector(".tab-label")), ty: getComputedStyle(a.querySelector(".tab-ico")).transform })),
  };
}
// Is the jump running on this stop right now?
function jumping(sel) {
  const el = document.querySelector(sel);
  return document.getAnimations().some((a) => a.animationName === "tab-jump" && a.effect && a.effect.target && el && el.contains(a.effect.target) && a.playState === "running");
}
// The owner's own nav: Home, Studio, PicEditor, Sim, Scans (and Search), so the widths do not depend on what pages this copy of the database has.
function liveSet() {
  const strip = document.querySelector(".tabs");
  const keep = ["/", "/studio", "/piceditor", "/simulations", "/scans"];
  [...strip.querySelectorAll(":scope > .tab:not(.tab-finder), :scope > .tab-group, :scope > .tab-spacer")].forEach((s) => {
    const a = s.matches(".tab") ? s : s.querySelector(".tab");
    if (!a || !keep.includes(a.getAttribute("href"))) s.remove();
  });
  const kids = [...strip.children].filter((c) => c.matches(".tab, .tab-group, .tab-spacer"));
  const i = kids.findIndex((c) => c.matches(".tab-home") || c.querySelector(":scope > .tab-home"));
  const gap = kids.length - i - 1 - i;
  for (let k = 0; k < gap; k++) { const sp = document.createElement("span"); sp.className = "tab-spacer"; sp.setAttribute("aria-hidden", "true"); strip.insertBefore(sp, strip.firstChild); }
  window.siteLayoutNav();
}

(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    // ---- the real page: Home sits in the middle of the stops, whatever pages this site has ----
    {
      const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
      const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(E2E_BASE + "/studio");
      await p.waitForSelector(".tab-home");
      const s = await p.evaluate(dialState);
      ok(s.homeIdx > 0 && s.before === s.after, "Home has as many stops before it as after it (Search and any empty slot counted)", s);
      ok(s.homeOff <= 10, "and sits within a few pixels of the middle of the strip", s.homeOff);
      ok(s.homeWider && s.homeIcon && s.homeFont, "Home is wider, with a bigger icon and a bigger name", s);
      ok(s.lower && s.shown.every((t) => t === t.toLowerCase()), "every name is shown in lowercase", s.shown);
      ok(errs.length === 0, "no page errors", errs);
      await p.context().close();
    }

    // ---- the owner's own set of stops at every width: Home dead centre, nothing cut off ----
    for (const [w, h, dpr, mobile, centre, label] of [[393, 800, 3, true, 4, "a large phone"], [375, 800, 3, true, 4, "a small phone"], [768, 900, 2, false, 2, "a tablet"], [1280, 800, 1, false, 2, "a computer"]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
      const p = await ctx.newPage();
      await p.goto(E2E_BASE + "/studio");
      await p.waitForSelector(".tab-home");
      await p.evaluate(liveSet);
      await p.waitForTimeout(500);
      const s = await p.evaluate(dialState);
      ok(s.before === s.after && s.homeOff <= centre, `${label}: Home is in the middle (off by ${s.homeOff && s.homeOff.toFixed(1)}px)`, s);
      ok(s.homeWider && s.homeIcon && s.homeFont, `${label}: Home is a little bigger than the rest`);
      ok(!s.scrolls && s.cut.length === 0 && s.pageOver <= 0, `${label}: everything fits, no name is cut and the page does not run sideways`, [s.scrolls, s.cut, s.pageOver]);
      await ctx.close();
    }
    // the smallest phone may scroll the strip, but never the page
    {
      const ctx = await b.newContext({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const p = await ctx.newPage();
      await p.goto(E2E_BASE + "/studio");
      await p.waitForSelector(".tab-home");
      await p.evaluate(liveSet);
      await p.waitForTimeout(400);
      const s = await p.evaluate(dialState);
      ok(s.pageOver <= 0 && s.cut.length === 0, "a 320 px phone: the page does not run sideways and no name is cut", [s.pageOver, s.cut]);
      await ctx.close();
    }

    // ---- the Simulations stop is called Sim ----
    {
      const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
      await p.goto(E2E_BASE + "/simulations");
      const txt = await p.evaluate(() => { const a = document.querySelector('.tabs a.tab[href="/simulations"]'); return a && [a.textContent.trim(), a.getAttribute("aria-current")]; });
      ok(txt && txt[0] === "Sim" && txt[1] === "page", "the Simulations page's stop is called Sim and is the current one", txt);
      ok((await p.title()).length > 0 && (await p.textContent("h1")).trim().length > 0, "(the page itself keeps its own title and heading)");
      await p.context().close();
    }

    // ---- the current stop steps forward, and jumps when it becomes current ----
    {
      const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
      await p.goto(E2E_BASE + "/studio");
      await p.waitForSelector(".tab-home");
      await p.waitForFunction(() => !document.getAnimations().some((a) => a.animationName === "tab-jump" && a.playState === "running"), null, { timeout: 5000 });
      let s = await p.evaluate(dialState);
      const cur = s.pose.filter((x) => x.cur); const rest = s.pose.filter((x) => !x.cur);
      ok(cur.length === 1 && Math.abs(cur[0].s - 1.12) < 0.01 && Math.abs(cur[0].l - 1.12) < 0.01 && rest.every((x) => x.s === 1 && x.l === 1), "the current stop sits forward (icon and name larger); the others do not", s.pose);
      await p.click('.tabs a.tab[href="/"]');
      const during = await p.waitForFunction(jumping, '.tabs a.tab[href="/"]', { polling: "raf", timeout: 5000 }).then(() => true).catch(() => false);
      ok(during, "when Home becomes the current stop its icon and name jump");
      ok(!(await p.evaluate(jumping, '.tabs a.tab[href="/studio"]')), "and Studio, no longer current, does not");
      await p.waitForFunction(() => location.pathname === "/" && !document.querySelector(".page-stage"), null, { timeout: 10000 });
      await p.waitForFunction(() => !document.getAnimations().some((a) => a.animationName === "tab-jump" && a.playState === "running"), null, { timeout: 5000 });
      await p.waitForTimeout(450);
      s = await p.evaluate(dialState);
      ok(s.pose.filter((x) => x.cur).length === 1 && s.pose.filter((x) => !x.cur).every((x) => x.s === 1 && x.l === 1), "afterwards only Home is forward; Studio has come back down", s.pose);
      // Search is the forward stop while the finder is open, and the page's own stop steps back
      await p.click("#finder-open");
      await p.waitForSelector("#site-finder:not([hidden])");
      await p.waitForTimeout(700);
      s = await p.evaluate(dialState);
      const searchIdx = s.pose.length - 1;
      ok(s.pose[searchIdx].s > 1.05 && s.pose.slice(0, searchIdx).every((x) => x.s === 1), "with the finder open Search is the forward stop and the page's stop steps back", s.pose);
      await p.keyboard.press("Escape");
      await p.waitForTimeout(700);
      s = await p.evaluate(dialState);
      ok(s.pose[searchIdx].s === 1 && s.pose.filter((x) => x.cur && x.s > 1.05).length === 1, "closed again, the page's own stop is forward once more", s.pose);
      await p.context().close();
    }

    // ---- reduced motion: it sits forward but does not jump (the visitor's setting, and the site's own switch) ----
    for (const [label, opts, init] of [["the system asks for reduced motion", { reducedMotion: "reduce" }, null], ["the site's motion switch is on reduce", {}, "try{localStorage.setItem('motion','reduce')}catch(e){}"]]) {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
      const p = await ctx.newPage();
      if (init) await p.addInitScript(init);
      await p.goto(E2E_BASE + "/studio");
      await p.waitForSelector(".tab-home");
      await p.waitForTimeout(100);
      ok(!(await p.evaluate(() => document.getAnimations().some((a) => a.animationName === "tab-jump"))), `${label}: no jump`);
      let s = await p.evaluate(dialState);
      ok(s.pose.filter((x) => x.cur && Math.abs(x.s - 1.12) < 0.01).length === 1, `${label}: the current stop still sits forward`, s.pose);
      await p.click('.tabs a.tab[href="/"]');
      await p.waitForFunction(() => location.pathname === "/" && !document.querySelector(".page-stage"), null, { timeout: 10000 });
      await p.waitForTimeout(100);
      ok(!(await p.evaluate(() => document.getAnimations().some((a) => a.animationName === "tab-jump" || (a.transitionProperty === "transform" && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest(".tab-ico, .tab-label"))))), `${label}: sliding to another tab neither jumps nor eases the icons and names`);
      ok(!(await p.evaluate(() => document.getAnimations().some((a) => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains("tab-indicator")))), `${label}: and the needle does not glide`);
      await ctx.close();
    }
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
