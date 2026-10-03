const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
(async () => {
  const b = await chromium.launch();
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const open = async (opts = {}, init) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
    if (opts.clip !== false) await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: E2E_BASE }).catch(() => {});
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    await p.goto(E2E_BASE + "/", { waitUntil: "domcontentloaded" });
    return { ctx, p };
  };

  // the feed link
  let { ctx, p } = await open();
  ok(await p.isVisible(".site-footer .footer-rss") && (await p.getAttribute(".site-footer .footer-rss", "href")) === "/rss.xml", "the footer has an RSS feed link");
  const feed = await p.request.get(E2E_BASE + "/rss.xml");
  ok(feed.status() === 200 && /rss\+xml/.test(feed.headers()["content-type"]) && (await feed.text()).includes("<rss"), "and it points at a real feed");
  ok(await p.locator(".site-footer .footer-rss").count() === 1, "only one feed link");

  // share: the browser's share sheet
  await ctx.close();
  ({ ctx, p } = await open({}, () => { window.__shared = []; navigator.share = (d) => { window.__shared.push(d); return Promise.resolve(); }; }));
  ok(await p.isVisible(".footer-share"), "the Share button shows when the browser can share");
  await p.click(".footer-share");
  const shared = await p.evaluate(() => window.__shared);
  const canonical = await p.evaluate(() => (document.querySelector('link[rel="canonical"]') || {}).href || location.href.split("#")[0]);
  ok(shared.length === 1 && shared[0].url === canonical && !!shared[0].title, "it opens the share sheet with the page's title and its canonical address", { shared, canonical });
  await ctx.close();

  // a cancelled share sheet is not an error
  ({ ctx, p } = await open({}, () => { navigator.share = () => Promise.reject(new DOMException("closed", "AbortError")); }));
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.click(".footer-share"); await p.waitForTimeout(200);
  ok(errs.length === 0 && !(await p.textContent(".footer-share-note")), "closing the share sheet says nothing and breaks nothing", errs);
  await ctx.close();

  // share: no share sheet, so the address is copied
  ({ ctx, p } = await open({}, () => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); }));
  ok(await p.isVisible(".footer-share"), "the Share button shows when the address can be copied");
  await p.click(".footer-share");
  await p.waitForFunction(() => /Link copied/.test(document.querySelector(".footer-share-note").textContent));
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  const canonical2 = await p.evaluate(() => (document.querySelector('link[rel="canonical"]') || {}).href || location.href.split("#")[0]);
  if (clip !== null) ok(clip === canonical2, "it copies the page's canonical address", { clip, canonical2 });
  ok(await p.getAttribute(".footer-share-note", "role") === "status", "and says so in a polite status line");
  await ctx.close();

  // a failed copy is reported
  ({ ctx, p } = await open({}, () => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("no")) }, configurable: true }); }));
  await p.click(".footer-share");
  await p.waitForFunction(() => /Couldn't copy/.test(document.querySelector(".footer-share-note").textContent));
  ok(true, "a failed copy says so");
  await ctx.close();

  // nothing to share with: the button stays out of the way
  ({ ctx, p } = await open({}, () => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }); }));
  ok(!(await p.isVisible(".footer-share")) && await p.isVisible(".footer-rss"), "with no way to share, the button stays hidden and the feed link stays");
  await ctx.close();
  ({ ctx, p } = await open({ javaScriptEnabled: false }));
  ok(!(await p.isVisible(".footer-share")) && await p.isVisible(".footer-rss"), "without JavaScript the button is hidden too");
  await ctx.close();

  // looks and keyboard
  for (const scheme of ["dark", "light"]) {
    ({ ctx, p } = await open({ colorScheme: scheme }));
    await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), scheme);
    await p.addScriptTag({ content: axeSource() });
    const v = await p.evaluate(async () => (await axe.run(document.querySelector(".site-footer"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" ; ")));
    ok(v.length === 0, `axe: the footer has no violations (${scheme})`, v);
    await p.locator(".footer-rss").focus();
    await p.keyboard.press("Tab");
    ok(await p.evaluate(() => document.activeElement.classList.contains("footer-share")), `Tab goes from the feed link to the Share button (${scheme})`);
    await p.screenshot({ path: require("os").tmpdir() + `/footer_${scheme}.png`, clip: { x: 0, y: Math.max(0, (await p.locator(".site-footer").boundingBox()).y - 20), width: 1280, height: 200 } }).catch(() => {});
    await ctx.close();
  }
  ({ ctx, p } = await open({ viewport: { width: 360, height: 700 } }));
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)), "no horizontal scrolling on a phone");
  await ctx.close();
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  await b.close();
})();
