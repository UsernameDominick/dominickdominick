// "Read to the end": the article and project pages send one read_complete event per visit once the reader has reached the end and stayed
// long enough; the signed-in owner is not counted; Analytics shows the share per page next to the views, and hides it under a filter.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request, axeSource } = require("./_pw.cjs");
const BASE = E2E_BASE; let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined && !c ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const slug = "qq-read-" + Date.now();
  const sentence = "This is one synthetic sentence for the reading test, long enough to count as real words. ";
  const body = Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1}. ${sentence.repeat(3)}`).join("\n\n"); // about 400 words: 48 s needed
  const proj = await (await c.fetch(`${BASE}/api/admin/projects`, { method: "POST", data: { slug, title: "QQ Reading project", summary: "s", body, published: true } })).json();
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const path = "/projects/" + slug;
  // days=1: the real copy of the database this runs on has older visits to busier pages, which would crowd a new page out of the top 15
  const analytics = async (q = "") => (await (await c.fetch(`${BASE}/api/admin/analytics?days=1${q}`)).json());
  const row = async () => ((await analytics()).readCompletion || []).find((r) => r.path === path);
  // a visit: a fresh anonymous browser with a fake clock; returns the read_complete requests it sent
  const visit = async ({ scrollToEnd, seconds, hidden, storageState }) => {
    const ctx = await b.newContext({ viewport: { width: 1000, height: 700 }, ...(storageState ? { storageState } : {}) });
    const p = await ctx.newPage();
    const sent = [];
    p.on("request", (r) => { if (r.url().endsWith("/api/track") && r.method() === "POST") { try { const j = JSON.parse(r.postData() || "{}"); if (j.name === "read_complete") sent.push(j); } catch (e) { /* none */ } } });
    await p.clock.install();
    await p.goto(BASE + path, { waitUntil: "networkidle" });
    if (hidden) await p.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
    if (scrollToEnd) { await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(300); }
    await p.clock.runFor(seconds * 1000);
    await p.waitForTimeout(400);
    const words = await p.evaluate(() => document.getElementById("readable-content").textContent.trim().split(/\s+/).length);
    await ctx.close();
    return { sent, words };
  };
  try {
    // the page measures its own length: 8 paragraphs of about 50 words
    const first = await visit({ scrollToEnd: false, seconds: 5 });
    ok(first.words > 300 && first.words < 600, "(the test text is a few hundred words)", first.words);
    ok(first.sent.length === 0, "a visit that does not scroll sends nothing", first.sent);
    const bounce = await visit({ scrollToEnd: true, seconds: 4 });
    ok(bounce.sent.length === 0, "scrolling straight to the end and leaving after a few seconds is not a read", bounce.sent);
    const stayedTop = await visit({ scrollToEnd: false, seconds: 120 });
    ok(stayedTop.sent.length === 0, "staying a long time without reaching the end is not a read either", stayedTop.sent);
    const hiddenTab = await visit({ scrollToEnd: true, seconds: 120, hidden: true });
    ok(hiddenTab.sent.length === 0, "time with the tab hidden does not count", hiddenTab.sent);
    const read = await visit({ scrollToEnd: true, seconds: 120 });
    ok(read.sent.length === 1 && read.sent[0].path === path && Number(read.sent[0].detail) >= 10 && Number(read.sent[0].detail) <= 120, "reaching the end and staying long enough sends one read_complete for this page, with the seconds", read.sent);
    // the owner's own reading is acknowledged and ignored
    const mine = await visit({ scrollToEnd: true, seconds: 120, storageState: process.env.ADMIN_STATE });
    ok(mine.sent.length === 1, "(the owner's browser sends it too)", mine.sent.length);
    await new Promise((r) => setTimeout(r, 600));

    // analytics: the page views of the visits above (the owner's are not views), and exactly one read
    const r1 = await row();
    ok(!!r1 && r1.views === 5 && r1.reads === 1 && r1.percent === 20 && /QQ Reading project/.test(r1.title || ""), "Analytics: 5 visits, 1 read to the end, 20%, with the page's title (the owner's visit counts as neither)", r1);
    // reads can never exceed visits
    const spam = await c.fetch(`${BASE}/api/track`, { method: "POST", data: JSON.stringify({ name: "read_complete", path, detail: "30" }), headers: { "content-type": "application/json" } });
    ok([204, 429].includes(spam.status()), "(a stray extra event is accepted)", spam.status());
    for (let i = 0; i < 9; i++) await (await request.newContext()).post(`${BASE}/api/track`, { data: JSON.stringify({ name: "read_complete", path, detail: "30" }), headers: { "content-type": "application/json" } });
    await new Promise((r) => setTimeout(r, 600));
    const r2 = await row();
    ok(r2 && r2.reads <= r2.views && r2.percent <= 100, "the share is capped at the number of visits", r2);
    const filtered = await analytics("&device=mobile");
    ok(filtered.readCompletion === null, "with a filter on, the figure is left out (events carry no device)", filtered.readCompletion);

    // the window shows it
    const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    // The window asks for 7 days, where older, busier pages would push this one off the list: give it the last day's figures instead.
    const lastDay = (await analytics()).readCompletion;
    await p.route("**/api/admin/analytics?*", async (route) => {
      const real = await route.fetch();
      const data = await real.json();
      if (data.readCompletion) data.readCompletion = lastDay;
      await route.fulfill({ response: real, json: data });
    });
    await p.goto(BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("analytics-btn").click());
    await p.waitForSelector("#analytics-modal:not([hidden])");
    await p.waitForFunction(() => document.getElementById("analytics-reads").textContent.includes("QQ Reading project"), null, { timeout: 8000 });
    const shown = await p.textContent("#analytics-reads");
    ok(/QQ Reading project/.test(shown) && /\d+%/.test(shown) && /of 5/.test(shown), "Analytics lists the project with its percentage and 'N of 5'", shown.slice(0, 160));
    ok((await p.textContent("#analytics-modal h2:has-text('Read to the end')")) === "Read to the end", "under a Read to the end heading");
    await p.selectOption("#analytics-filter-device", { index: 1 }).catch(() => {});
    await p.waitForTimeout(800);
    ok(/Not shown while a filter is on/.test(await p.textContent("#analytics-reads")), "and says so when a filter is on");
    await p.selectOption("#analytics-filter-device", "");
    await p.waitForTimeout(600);
    await p.addScriptTag({ content: axeSource() });
    for (const theme of ["dark", "light"]) {
      await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await p.waitForTimeout(400);
      const v = await p.evaluate(async () => (await axe.run(document.getElementById("analytics-modal"), { runOnly: ["color-contrast", "label", "button-name", "select-name"], resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(",")));
      ok(v.length === 0, `${theme} theme: Analytics has no accessibility findings`, v);
    }
    await ctx.close();
  } finally {
    await c.fetch(`${BASE}/api/admin/projects/${proj.id}`, { method: "DELETE" });
    await b.close();
  }
  console.log(f ? "FAILURES " + f : "ALL PASS"); process.exit(f ? 1 : 0);
})();
