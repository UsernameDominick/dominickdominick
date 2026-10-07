// The nav is a dial: the stop you are on sits under a needle in the middle and is the biggest, the others step down in size the farther
// they are from it, every name is lowercase, and the Simulations stop is called Sim. Drag the dial on a phone and, as it settles on a stop,
// that page comes in; click a stop on a screen with room and it turns to the middle and goes there. Search only opens when it is pressed.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");

// The dial as it looks right now, measured in the page.
function dial() {
  const t = document.querySelector(".tabs");
  const nav = document.querySelector(".site-nav").getBoundingClientRect(); // the needle is at its middle (and is hidden on a page with no tab)
  const nx = nav.left + nav.width / 2;
  const scale = (el) => { const m = /matrix\(([^,]+),/.exec(getComputedStyle(el).transform); return m ? Number(m[1]) : 1; };
  const links = [...t.querySelectorAll("a.tab, button.tab")].map((a) => {
    const r = a.getBoundingClientRect();
    return {
      label: a.querySelector(".tab-label").textContent.trim(), shown: a.querySelector(".tab-label").innerText,
      href: a.getAttribute("href"), cx: r.left + r.width / 2, off: r.left + r.width / 2 - nx,
      s: scale(a.querySelector(".tab-ico")), ls: scale(a.querySelector(".tab-label")),
      d: parseFloat(getComputedStyle(a).getPropertyValue("--d")), centred: a.classList.contains("is-centred"), active: a.classList.contains("is-active"),
      lower: getComputedStyle(a.querySelector(".tab-label")).textTransform === "lowercase",
    };
  });
  const nearest = links.reduce((b, l) => (Math.abs(l.off) < Math.abs(b.off) ? l : b), links[0]);
  return {
    path: location.pathname, sl: t.scrollLeft, links, nearest, needle: nx, needleShown: getComputedStyle(document.querySelector(".site-nav > .tab-indicator")).display !== "none",
    finder: !!document.getElementById("site-finder") && !document.getElementById("site-finder").hidden, over: document.documentElement.scrollWidth - innerWidth,
    cut: [...t.querySelectorAll(".tab-label")].filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent),
  };
}
async function still(p) {
  let last = -1, n = 0;
  for (let i = 0; i < 60 && n < 4; i++) { const v = await p.evaluate(() => document.querySelector(".tabs").scrollLeft); n = v === last ? n + 1 : 0; last = v; await p.waitForTimeout(70); }
}
// A finger on the dial: touch down, drag, lift (real touch events, so the browser scrolls and snaps it itself).
async function drag(cdp, y, from, to, steps = 12) {
  const touch = (type, x) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  await touch("touchStart", from);
  for (let i = 1; i <= steps; i++) { await touch("touchMove", from + ((to - from) * i) / steps); await new Promise((r) => setTimeout(r, 16)); }
  await new Promise((r) => setTimeout(r, 150)); // hold still before letting go, so there is no flick to carry it past the stop it is on
  await touch("touchEnd");
}

(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    // ---- at rest, at every width: the current stop is in the middle, biggest, with the rest stepping down evenly on both sides ----
    for (const [w, h, dpr, mobile, label] of [[393, 800, 3, true, "a large phone"], [375, 800, 3, true, "a small phone"], [320, 640, 2, true, "a 320 px phone"], [768, 900, 2, false, "a tablet"], [1280, 800, 1, false, "a computer"]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
      const p = await ctx.newPage();
      const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      for (const path of ["/", "/studio", "/scans"]) {
        await p.goto(E2E_BASE + path);
        await p.waitForSelector(".tab.is-centred");
        await still(p);
        const s = await p.evaluate(dial);
        const cur = s.links.find((l) => l.active);
        ok(cur && Math.abs(cur.off) <= 1.5 && cur.centred && s.nearest === cur, `${label}, ${path}: this page's stop is in the middle, under the needle (off by ${cur && cur.off.toFixed(1)}px)`, s.links.map((l) => [l.label, l.off, l.centred]));
        ok(cur && cur.s === 1 && cur.d < 0.05, `${label}, ${path}: and it is full size`, cur);
        const others = s.links.filter((l) => l !== cur);
        const pitch = s.links[1].cx - s.links[0].cx;
        const byDist = (k) => others.filter((l) => Math.abs(Math.abs(l.off) / pitch - k) < 0.1);
        const one = byDist(1);
        ok(one.length >= 1 && one.every((l) => l.s < 0.9 && l.s > 0.7), `${label}, ${path}: the stops next to it are smaller`, one.map((l) => [l.label, l.s]));
        const two = byDist(2);
        ok(one.length >= 1 && two.every((l) => l.s < one[0].s - 0.1), `${label}, ${path}: the next ones smaller again, a staircase down`, [one.map((l) => l.s), two.map((l) => l.s)]);
        ok(one.length >= 1 && Math.max(...one.map((l) => l.s)) - Math.min(...one.map((l) => l.s)) < 0.03, `${label}, ${path}: and the two sides step down alike`, one.map((l) => l.s));
        ok(s.links.every((l) => l.lower && l.shown === l.shown.toLowerCase()), `${label}, ${path}: every name is lowercase`, s.links.map((l) => l.shown));
        ok(s.over <= 0 && s.cut.length === 0, `${label}, ${path}: nothing runs sideways and no name is cut`, [s.over, s.cut]);
      }
      ok(errs.length === 0, `${label}: no page errors`, errs);
      await ctx.close();
    }

    // ---- the Simulations stop is called Sim ----
    {
      const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
      await p.goto(E2E_BASE + "/simulations");
      const txt = await p.evaluate(() => { const a = document.querySelector('.tabs a.tab[href="/simulations"]'); return a && [a.textContent.trim(), a.getAttribute("aria-current")]; });
      ok(txt && txt[0] === "Sim" && txt[1] === "page", "the Simulations page's stop is called Sim and is the current one", txt);
      await p.context().close();
    }

    // ---- a computer: click the stop you want ----
    {
      const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
      await p.goto(E2E_BASE + "/");
      await p.waitForSelector(".tab.is-centred");
      await still(p);
      const needleBefore = (await p.evaluate(dial)).needle;
      await p.click('.tabs a.tab[href="/scans"]');
      await p.waitForFunction(() => location.pathname === "/scans" && !document.querySelector(".page-stage"), null, { timeout: 10000 });
      await still(p);
      const s = await p.evaluate(dial);
      const cur = s.links.find((l) => l.active);
      ok(cur && cur.href === "/scans" && Math.abs(cur.off) <= 1.5 && cur.centred && cur.s === 1, "clicking a stop turns the dial to it, makes it the big one and goes there", s.links.map((l) => [l.label, l.off, l.s]));
      ok(Math.abs(s.needle - needleBefore) < 0.5, "the needle stayed where it was; the ticks and stops moved under it");
      const home = s.links.find((l) => l.href === "/");
      ok(home && home.s < 0.9, "and Home, no longer the middle one, is smaller", home);
      // pressing the stop you are already on does nothing
      await p.click('.tabs a.tab[href="/scans"]');
      await p.waitForTimeout(300);
      ok((await p.evaluate(dial)).path === "/scans", "pressing the current stop again stays put");
      await p.context().close();
    }

    // ---- a phone: drag the dial and the page follows; a tap works too ----
    {
      const ctx = await b.newContext({ viewport: { width: 393, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      const p = await ctx.newPage();
      const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(E2E_BASE + "/");
      await p.waitForSelector(".tab.is-centred");
      await still(p);
      const cdp = await ctx.newCDPSession(p);
      const s0 = await p.evaluate(dial);
      const pitch = s0.links[1].cx - s0.links[0].cx;
      const homeIdx = s0.links.findIndex((l) => l.active);
      // a finger moves left by two stops: the dial turns two stops forward
      await drag(cdp, 50, 300, 300 - 2 * pitch);
      await p.waitForFunction((want) => location.pathname === want, s0.links[homeIdx + 2].href, { timeout: 8000 }).catch(() => {});
      await still(p);
      let s = await p.evaluate(dial);
      ok(s.path === s0.links[homeIdx + 2].href, "dragging the dial two stops brings in that page", [s.path, s0.links[homeIdx + 2].href]);
      let cur = s.links.find((l) => l.active);
      ok(cur && Math.abs(cur.off) <= 1.5 && cur.centred && cur.s === 1, "and it has settled with that stop in the middle and big", cur);
      // and back one stop
      await drag(cdp, 50, 100, 100 + pitch);
      await p.waitForFunction((want) => location.pathname === want, s0.links[homeIdx + 1].href, { timeout: 8000 }).catch(() => {});
      await still(p);
      s = await p.evaluate(dial);
      ok(s.path === s0.links[homeIdx + 1].href, "dragging back one stop brings in the page before it", [s.path, s0.links[homeIdx + 1].href]);
      // a drag that lets go most of the way to the next stop snaps to it, and that is the page
      const here = await p.evaluate(dial);
      const hereIdx = here.links.findIndex((l) => l.active);
      await drag(cdp, 50, 250, 250 - Math.round(pitch * 0.95), 8);
      await p.waitForFunction((want) => location.pathname === want, here.links[hereIdx + 1].href, { timeout: 8000 }).catch(() => {});
      await still(p);
      s = await p.evaluate(dial);
      cur = s.links.find((l) => l.active);
      ok(s.path === here.links[hereIdx + 1].href && cur && Math.abs(cur.off) <= 1.5, "letting go most of the way to the next stop snaps to it", [s.path, cur && cur.off]);
      // dragging the dial onto Search opens the finder (with the box left alone, so a phone's keyboard does not pop up on the way past)
      const startPath = s.path;
      const activeAt = s.links.findIndex((l) => l.active);
      await drag(cdp, 50, 330, 330 - 4 * pitch, 16);
      await p.waitForSelector("#site-finder:not([hidden])", { timeout: 5000 }).catch(() => {});
      await still(p);
      s = await p.evaluate(dial);
      const search = s.links[s.links.length - 1];
      ok(s.finder && Math.abs(search.off) <= 1.5 && search.centred, "dragging the dial onto Search opens the finder, with Search under the needle", [s.finder, search]);
      ok(await p.evaluate(() => document.activeElement && document.activeElement.id !== "finder-input"), "and leaves the search box unfocused, so no keyboard pops up");
      ok(s.path === startPath, "the page underneath is still the one you were on", [s.path, startPath]);
      // dragging back onto the page's own stop closes it again and stays on the page
      await drag(cdp, 50, 100, 100 + (s.links.length - 1 - activeAt) * pitch);
      await p.waitForFunction(() => document.getElementById("site-finder").hidden, null, { timeout: 5000 }).catch(() => {});
      await still(p);
      s = await p.evaluate(dial);
      cur = s.links.find((l) => l.active);
      ok(!s.finder && s.path === startPath && cur && cur.centred && Math.abs(cur.off) <= 1.5, "dragging back onto this page's stop closes the finder and stays put", [s.finder, s.path, cur && cur.off]);
      // onto Search again, then off it onto a different page's stop: the finder closes and that page comes in
      await drag(cdp, 50, 330, 330 - 4 * pitch, 16);
      await p.waitForSelector("#site-finder:not([hidden])", { timeout: 5000 }).catch(() => {});
      await still(p);
      const other = (await p.evaluate(dial)).links[activeAt - 1].href;
      await drag(cdp, 50, 100, 100 + 2 * pitch);
      await p.waitForFunction((want) => location.pathname === want, other, { timeout: 8000 }).catch(() => {});
      await still(p);
      s = await p.evaluate(dial);
      cur = s.links.find((l) => l.active);
      ok(s.path === other && !s.finder && cur && cur.centred && Math.abs(cur.off) <= 1.5, "dragging from Search onto another page's stop closes the finder and brings that page in", [s.path, other, s.finder, cur && cur.off]);
      // a tap on Search opens it with the box ready to type in, and Search the stop in the middle
      await p.tap("#finder-open");
      await p.waitForSelector("#site-finder:not([hidden])");
      await still(p);
      s = await p.evaluate(dial);
      ok(s.finder && s.links[s.links.length - 1].centred && Math.abs(s.links[s.links.length - 1].off) <= 1.5, "pressing Search opens the finder with Search under the needle");
      ok(await p.evaluate(() => document.activeElement && document.activeElement.id === "finder-input"), "and the box is ready to type in");
      await p.keyboard.press("Escape");
      await p.waitForFunction(() => document.getElementById("site-finder").hidden, null, { timeout: 4000 });
      await still(p);
      s = await p.evaluate(dial);
      cur = s.links.find((l) => l.active);
      ok(cur && cur.centred && Math.abs(cur.off) <= 1.5, "and closing it turns the dial back to the page's own stop");
      // a tap on a stop works as on a computer
      await p.tap('.tabs a.tab[href="/scans"]');
      await p.waitForFunction(() => location.pathname === "/scans" && !document.querySelector(".page-stage"), null, { timeout: 10000 });
      await still(p);
      s = await p.evaluate(dial);
      cur = s.links.find((l) => l.active);
      ok(cur && cur.href === "/scans" && Math.abs(cur.off) <= 1.5, "tapping a stop turns the dial to it and goes there");
      ok(errs.length === 0, "no page errors", errs);
      await ctx.close();
    }

    // ---- scrolling the dial from a script, or the browser keeping a focused stop in view, is not a choice: no page change ----
    {
      const p = await (await b.newContext({ viewport: { width: 393, height: 800 }, isMobile: true, hasTouch: true })).newPage();
      await p.goto(E2E_BASE + "/");
      await p.waitForSelector(".tab.is-centred");
      await still(p);
      await p.evaluate(() => { document.querySelector(".tabs").scrollLeft += 144; });
      await p.waitForTimeout(700);
      ok((await p.evaluate(dial)).path === "/", "a scroll nobody asked for leaves the page alone");
      await p.context().close();
    }

    // ---- the keyboard: arrows pass along the dial without going anywhere, Enter goes ----
    {
      const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
      await p.goto(E2E_BASE + "/");
      await p.waitForSelector(".tab.is-centred");
      await still(p);
      await p.focus('.tabs a.tab[href="/"]');
      await p.keyboard.press("ArrowRight");
      await p.keyboard.press("ArrowRight");
      await p.waitForTimeout(700);
      const s = await p.evaluate(dial);
      const focused = await p.evaluate(() => document.activeElement.getAttribute("href"));
      const f = s.links.find((l) => l.href === focused);
      ok(s.path === "/" && f && f.href !== "/" && Math.abs(f.off) <= 1.5, "the arrow keys turn the dial to the next stops without leaving the page", [s.path, focused, f && f.off]);
      await p.keyboard.press("Enter");
      await p.waitForFunction((h) => location.pathname === h, focused, { timeout: 10000 });
      ok(true, "and Enter goes there");
      await p.context().close();
    }

    // ---- a page with no tab of its own: the dial rests on Home, unlit, with no needle ----
    {
      const ctx = await b.newContext({ viewport: { width: 393, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      const p = await ctx.newPage();
      await p.goto(E2E_BASE + "/no-such-page-qq");
      await p.waitForSelector(".tabs");
      await still(p);
      const s = await p.evaluate(dial);
      ok(!s.needleShown && s.links.every((l) => !l.centred) && !s.links.some((l) => l.active), "a missing page has no needle and no lit stop", s.links.map((l) => l.centred));
      ok(Math.abs(s.links.find((l) => l.href === "/").off) <= 1.5, "the dial rests on Home");
      await ctx.close();
    }

    // ---- exactly in the middle, always: before the script arrives, and when the strip changes width at rest ----
    {
      // a slow connection: /nav.js has not arrived, yet the page's own stop is already under the needle and the sizes already step down
      const ctx = await b.newContext({ viewport: { width: 393, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      const p = await ctx.newPage();
      await p.route("**/nav.js", async (r) => { await new Promise((x) => setTimeout(x, 2500)); r.continue(); });
      p.goto(E2E_BASE + "/studio").catch(() => {});
      await p.waitForSelector(".tab.is-active", { state: "attached" });
      await p.waitForTimeout(400);
      const early = await p.evaluate(() => {
        const nav = document.querySelector(".site-nav").getBoundingClientRect(); const a = document.querySelector(".tab.is-active"); const r = a.getBoundingClientRect();
        const next = a.nextElementSibling; const m = /matrix\(([^,]+),/.exec(getComputedStyle(next.querySelector(".tab-ico")).transform);
        return { off: r.left + r.width / 2 - (nav.left + nav.width / 2), ready: document.querySelector(".tabs").classList.contains("dial-ready"), neighbour: m ? Number(m[1]) : 1 };
      });
      ok(!early.ready && Math.abs(early.off) <= 0.5 && early.neighbour < 0.9, "before /nav.js has arrived the page's stop is already exactly in the middle and the neighbours already smaller", early);
      await ctx.close();
    }
    {
      // the strip changes width with no window resize (a scrollbar appears, a panel opens): the middle stop stays exactly in the middle.
      // That holds by the layout itself (the room either side of the stops is half the strip, so a stop at a multiple of the step is at 50%
      // whatever the width); snapping is switched off here so the browser's own re-snap is not what is being tested.
      const ctx = await b.newContext({ viewport: { width: 600, height: 800 } });
      const p = await ctx.newPage();
      await p.goto(E2E_BASE + "/scans");
      await p.waitForSelector(".tab.is-centred");
      await still(p);
      await p.addStyleTag({ content: ".tabs { scroll-snap-type: none !important; }" });
      const off = () => p.evaluate(() => { const nav = document.querySelector(".site-nav").getBoundingClientRect(); const r = document.querySelector(".tab.is-active").getBoundingClientRect(); return r.left + r.width / 2 - (nav.left + nav.width / 2); });
      ok(Math.abs(await off()) <= 0.5, "the middle stop is exactly in the middle to start with");
      await p.addStyleTag({ content: ".topbar { padding-left: 57px !important; padding-right: 21px !important; }" });
      await p.waitForTimeout(500);
      ok(Math.abs(await off()) <= 0.5, "and still is after the strip's width changes without the window changing", await off());
      await p.addStyleTag({ content: ".topbar { padding-left: 3px !important; padding-right: 90px !important; }" });
      await p.waitForTimeout(500);
      ok(Math.abs(await off()) <= 0.5, "and again after it changes the other way", await off());
      await ctx.close();
    }

    // ---- reduced motion: the dial turns at once (no glide) ----
    {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const p = await ctx.newPage();
      await p.goto(E2E_BASE + "/");
      await p.waitForSelector(".tab.is-centred");
      await still(p);
      await p.evaluate(() => { document.querySelector('.tabs a.tab[href="/scans"]').click(); });
      const quick = await p.evaluate(() => { const a = document.querySelector('.tabs a.tab[href="/scans"]'); const nav = document.querySelector(".site-nav").getBoundingClientRect(); const r = a.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - (nav.left + nav.width / 2)); });
      ok(quick <= 1.5, "with reduced motion the dial is on the new stop straight away", quick);
      await ctx.close();
    }
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
