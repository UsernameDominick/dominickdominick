const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const c = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1300, height: 900 } });
  const anon = await request.newContext();
  const api = async (m, p, body) => { const r = await c.request.fetch(BASE + "/api/admin" + p, { method: m, headers: { "content-type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch {} return { s: r.status(), j }; };
  let pageId = null;
  try {
    const slug = "qq-url-rules";
    const pg = await api("POST", "/pages", { title: "QQ URL rules", slug });
    pageId = pg.j.id; ok(pg.s === 200 || pg.s === 201, "test page created", pg.s);
    const mk = (text, style) => api("POST", `/pages/${pageId}/blocks`, { type: "text", content: { text }, style, col: 1, col_span: 24, row: 1 + Math.floor(Math.random() * 1000), row_span: 1 });
    await mk("ALWAYS-VISIBLE", {});
    await mk("ONLY-NEWSLETTER", { urlRule: "show", urlParam: "ref=newsletter" });
    await mk("ONLY-WITH-PROMO", { urlRule: "show", urlParam: "promo" });
    await mk("HIDE-FOR-VIP", { urlRule: "hide", urlParam: "vip=1" });
    await mk("MALFORMED-RULE", { urlRule: "show", urlParam: "a b&c" });
    await mk("RULE-NO-PARAM", { urlRule: "show", urlParam: "" });
    await mk("UNKNOWN-RULE", { urlRule: "weird", urlParam: "ref=x" });
    await mk("HIDE-BAD-RULE", { urlRule: "hide", urlParam: "a=1&b=2" });
    await mk("TYPO-QUESTION", { urlRule: "show", urlParam: "?ref=x" });
    await mk("SPACED-RULE", { urlRule: "show", urlParam: "  ref = x " });
    await mk("SWITCHED-OFF-TEXT", { hidden: true });
    await mk("SCHEDULED-LATER-TEXT", { visibleFrom: new Date(Date.now() + 86400e3).toISOString() });
    await mk("EXPIRED-TEXT", { visibleUntil: new Date(Date.now() - 86400e3).toISOString() });
    const get = async (qs) => (await anon.get(`${BASE}/${slug}${qs}`)).text();
    let h = await get("");
    ok(h.includes("ALWAYS-VISIBLE") && !h.includes("ONLY-NEWSLETTER") && !h.includes("ONLY-WITH-PROMO"), "without a query, 'show' blocks are absent from the HTML");
    ok(h.includes("HIDE-FOR-VIP"), "a 'hide when' block shows without the parameter");
    ok(!h.includes("MALFORMED-RULE") && !h.includes("RULE-NO-PARAM"), "an unreadable or empty 'show' rule fails closed (block hidden, not public by accident)");
    ok(h.includes("UNKNOWN-RULE") && h.includes("HIDE-BAD-RULE"), "an unknown rule type and an unreadable 'hide' rule have no effect");
    ok(!h.includes("TYPO-QUESTION") && !h.includes("SPACED-RULE"), "typed forms are forgiven but still gated (?ref=x, spaces around =)");
    h = await get("?ref=x");
    ok(h.includes("TYPO-QUESTION") && h.includes("SPACED-RULE"), "'?ref=x' and ' ref = x ' match ?ref=x");
    h = await get("");
    const resp = await anon.get(`${BASE}/${slug}`);
    ok(/no-store/.test(resp.headers()["cache-control"] || ""), "a page with address-gated blocks is marked private, no-store", resp.headers()["cache-control"]);
    h = await get("?ref=newsletter");
    ok(h.includes("ONLY-NEWSLETTER") && !h.includes("ONLY-WITH-PROMO"), "?ref=newsletter reveals the matching block only");
    h = await get("?ref=other");
    ok(!h.includes("ONLY-NEWSLETTER"), "a different value doesn't match");
    h = await get("?promo");
    ok(h.includes("ONLY-WITH-PROMO"), "a bare parameter name matches when the parameter is present");
    h = await get("?vip=1");
    ok(!h.includes("HIDE-FOR-VIP") && h.includes("ALWAYS-VISIBLE"), "?vip=1 hides the 'hide when' block");
    h = await get("?ref=a&ref=newsletter");
    ok(h.includes("ONLY-NEWSLETTER"), "a repeated parameter matches any of its values");
    ok(!(await get("")).includes("ref=newsletter"), "the rule text itself isn't leaked into the public HTML");
    const all = await get("");
    ok(!/SWITCHED-OFF-TEXT|SCHEDULED-LATER-TEXT|EXPIRED-TEXT/.test(all), "hidden, not-yet-visible and expired block text is nowhere in the page, including the meta description");
    const desc = (all.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
    ok(desc.includes("ALWAYS-VISIBLE") && !/ONLY-NEWSLETTER|ONLY-WITH-PROMO/.test(desc), "the meta description only draws on blocks visible for that address", desc.slice(0, 120));
    const descNl = ((await get("?ref=newsletter")).match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
    ok(descNl.includes("ONLY-NEWSLETTER"), "...and includes a revealed block when the address matches");
    // admin canvas badge
    const page = await c.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`${BASE}/admin/`); await page.waitForSelector("#app:not([hidden])");
    await page.evaluate((id) => window.__testOpenPage && window.__testOpenPage(id), pageId);
    const sel = page.locator("#page-picker");
    if (await sel.count()) { await sel.selectOption(String(pageId)).catch(() => {}); }
    await page.waitForSelector(".lock-badge", { timeout: 10000 }).catch(() => {}); // the canvas draws a moment after the page is picked (slower when several run at once)
    const badges = await page.$$eval(".lock-badge", (e) => e.map((x) => x.textContent));
    ok(badges.some((t) => /Only with \?ref=newsletter/.test(t)) && badges.some((t) => /Hidden with \?vip=1/.test(t)), "the admin canvas badges show the address rules", badges);
    ok(badges.some((t) => /Invalid address rule/.test(t)), "an unreadable rule shows an 'Invalid address rule' badge in the admin canvas", badges.length);
    ok(errs.length === 0, "no page errors", errs);
  } catch (e) { f++; console.log("FAIL threw", e.message.split("\n")[0]); }
  if (pageId) { await api("DELETE", `/pages/${pageId}`); await api("DELETE", `/pages/${pageId}/permanent`); }
  await b.close(); await anon.dispose(); console.log(f ? "FAILURES " + f : "ALL PASS");
})();
