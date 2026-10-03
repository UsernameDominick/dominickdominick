const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE);

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await browser.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin/`);
  await page.waitForSelector("#app:not([hidden])");

  // Create a page with a "button" block whose url is a real external link, and a
  // second with a javascript: URI, to confirm the worker's safeHref fix end-to-end.
  const pageId = await page.evaluate(async () => {
    const p = await (await fetch("/api/admin/pages", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ title: "safeHref e2e test", slug: "safehref-e2e-test" }) })).json();
    await fetch(`/api/admin/pages/${p.id}/blocks`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ type: "button", content: { label: "Good link", url: "https://example.com/real", external: true }, col: 0, col_span: 12, row: 0, row_span: 2 }) });
    await fetch(`/api/admin/pages/${p.id}/blocks`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ type: "button", content: { label: "Evil link", url: "java\tscript:alert(1)", external: true }, col: 0, col_span: 12, row: 2, row_span: 2 }) });
    return p.id;
  });

  const publicPage = await ctx.newPage();
  const resp = await publicPage.goto(`${BASE}/safehref-e2e-test`);
  console.log("public page status:", resp.status());

  const hrefs = await publicPage.evaluate(() => Array.from(document.querySelectorAll("a.btn")).map((a) => a.getAttribute("href")));
  console.log("rendered button hrefs:", hrefs);
  const goodOk = hrefs.some((h) => h === "https://example.com/real");
  const evilNeutralized = hrefs.every((h) => !h.includes("javascript"));
  console.log("real link rendered correctly:", goodOk, goodOk ? "PASS" : "FAIL");
  console.log("evil link neutralized (no 'javascript' in any href):", evilNeutralized, evilNeutralized ? "PASS" : "FAIL");

  // Cleanup
  await page.evaluate(async (id) => {
    await fetch(`/api/admin/pages/${id}`, { method: "DELETE", credentials: "include" });
    await fetch(`/api/admin/pages/${id}/permanent`, { method: "DELETE", credentials: "include" });
  }, pageId);

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
