const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const c = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const page = await c.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message)); page.on("dialog", (d) => { errs.push("DIALOG " + d.message()); d.dismiss(); });
  const api = async (m, p, body) => { const r = await c.request.fetch(BASE + "/api/admin" + p, { method: m, headers: { "content-type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status(), j }; };
  const before = (await api("GET", "/settings")).j || {};
  const pg = await api("POST", "/pages", { title: "QQ tokens", slug: "qq-tokens" });
  const mk = (style, row) => api("POST", `/pages/${pg.j.id}/blocks`, { type: "text", content: { text: "QQ token block " + row }, style, col: 1, col_span: 12, row, row_span: 2 });
  await mk({ shadow: "md", paddingStep: "3" }, 1); await mk({ shadow: "lg", padding: 7, paddingStep: "5" }, 4); await mk({ shadow: "bogus", paddingStep: "9" }, 7); await mk({}, 10);
  const computed = async (sel) => page.$$eval(sel, (els) => els.map((e) => { const s = getComputedStyle(e); return { shadow: s.boxShadow, padding: s.paddingTop }; }));
  const vars = () => page.evaluate(() => { const s = getComputedStyle(document.documentElement); return ["--space-1", "--space-3", "--space-6", "--shadow-sm", "--shadow-lg"].map((v) => s.getPropertyValue(v).trim()); });
  try {
    await api("PUT", "/settings", { ...before, space_scale: "", shadow_strength: "" });
    await page.goto(`${BASE}/qq-tokens`); await page.waitForTimeout(500);
    let v = await vars();
    ok(v[0] === "4px" && v[1] === "12px" && v[2] === "32px", "defaults: compact spacing scale 4/12/32", v);
    ok(/0px 1px 2px|0 1px 2px/.test(v[3]) || v[3].includes("1px 2px"), "defaults: soft shadows", v[3]);
    const blocks = await computed(".block");
    ok(blocks[0].padding === "12px" && blocks[0].shadow !== "none", "padding step 3 = 12px and shadow md applied", blocks[0]);
    ok(blocks[1].padding === "7px" && blocks[1].shadow !== "none", "an exact padding wins over a step; shadow lg applies", blocks[1]);
    ok(blocks[2].shadow === "none" && blocks[2].padding !== "36px", "an unknown shadow or step is ignored", blocks[2]);
    ok(blocks[3].shadow === "none", "a block with no token choice has no shadow (no visible change)", blocks[3]);
    // roomy + strong through the admin UI
    await page.goto(`${BASE}/admin/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(800);
    await page.click("#site-settings-btn"); await page.waitForSelector("#settings-modal:not([hidden])"); await page.waitForTimeout(700);
    await page.click('.control-preset[data-setting="space_scale"] button[data-value="roomy"]');
    await page.click('.control-preset[data-setting="shadow_strength"] button[data-value="strong"]');
    ok((await page.getAttribute('.control-preset[data-setting="space_scale"] button[data-value="roomy"]', "aria-pressed")) === "true", "the Roomy button shows pressed");
    await page.click("#save-settings"); await page.waitForTimeout(1200);
    const saved = (await api("GET", "/settings")).j;
    ok(saved.space_scale === "roomy" && saved.shadow_strength === "strong", "saved through the admin UI", [saved.space_scale, saved.shadow_strength]);
    await page.goto(`${BASE}/qq-tokens`); await page.waitForTimeout(500);
    v = await vars(); ok(v[0] === "6px" && v[1] === "18px" && v[2] === "48px", "roomy scale is applied on the public page", v);
    ok(v[4].includes("18px 44px"), "strong shadows are applied", v[4]);
    const b2 = await computed(".block"); ok(b2[0].padding === "18px", "a padding step follows the scale (3 = 18px)", b2[0]);
    // admin inspector offers the two fields
    await page.goto(`${BASE}/admin/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(800);
    await page.selectOption("#page-picker", String(pg.j.id)); await page.waitForTimeout(800);
    await page.locator("#canvas [data-id]").first().click({ position: { x: 5, y: 5 }, force: true }); await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('.style-group[data-group="box"]').open = true);
    ok((await page.$$('.style-group[data-group="box"] select')).length >= 2, "the Box group offers Padding step and Shadow selects");
    // invalid setting values are rejected or ignored
    const bad = await api("PUT", "/settings", { ...before, space_scale: "enormous" });
    await page.goto(`${BASE}/qq-tokens`); v = await vars();
    ok(v[0] === "4px" || v[0] === "6px", "an unknown scale name leaves a valid value in place", v);
    ok(errs.length === 0, "no page errors or dialogs", errs);
  } catch (e) { f++; console.log("FAIL threw", e.message.split("\n")[0]); }
  await api("PUT", "/settings", { ...before });
  await api("DELETE", `/pages/${pg.j.id}`); await api("DELETE", `/pages/${pg.j.id}/permanent`);
  await b.close(); console.log(f ? "FAILURES " + f : "ALL PASS");
})();
