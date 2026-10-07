// The home page's "Try the tools" cards link to every tool page, the owner can switch them off in Site settings, and the app pages
// carry their own share card (and every other page a default one).
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const api = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const put = (data) => api.fetch(E2E_BASE + "/api/admin/settings", { method: "PUT", data });
  const html = async (path) => (await (await fetch(E2E_BASE + path)).text());
  try {
    const home = await html("/");
    const links = [...home.matchAll(/class="home-tool" href="([^"]+)"/g)].map((m) => m[1]);
    ok(links.join() === "/trainer,/studio,/piceditor,/simulations,/scans", "the home page has a card for each tool, in order", links);
    ok(/<h2 id="home-tools-title"/.test(home), "under a heading of its own");
    const r = await put({ home_tools_off: "1" });
    ok(r.ok(), "the owner can switch the cards off", r.status());
    ok(!(await html("/")).includes("home-tools-grid"), "and they are gone");
    await put({ home_tools_off: "" });
    ok((await html("/")).includes("home-tools-grid"), "and back on");

    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    await p.goto(E2E_BASE + "/");
    const w = await p.evaluate(() => { const g = document.querySelector(".home-tools-grid"); const c = [...g.children].map((x) => x.getBoundingClientRect().width); return { cards: c, page: document.documentElement.scrollWidth - innerWidth }; });
    ok(w.page <= 0 && w.cards.every((x) => x > 250), "on a phone the cards are full width and nothing scrolls sideways", w);
    await b.close();

    for (const [path, img] of [["/trainer", "trainer"], ["/studio", "studio"], ["/piceditor", "piceditor"], ["/simulations", "simulations"], ["/scans", "scans"]]) {
      const h = await html(path);
      ok(h.includes(`property="og:image" content="https://dominickdominick.com/share/${img}.png"`) && h.includes('twitter:card" content="summary_large_image"'), `${path} shares its own card`);
      const res = await fetch(E2E_BASE + `/share/${img}.png`);
      ok(res.ok && /image\/png/.test(res.headers.get("content-type") || ""), `and the card is served (${img}.png)`);
    }
    ok(/property="og:image" content="https:\/\/dominickdominick\.com\/[^"]+"/.test(home), "other pages have a default share image too");
  } finally { /* nothing to clean up: the setting was put back */ }
  console.log(fail ? fail + " FAILED" : "ALL PASS");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
