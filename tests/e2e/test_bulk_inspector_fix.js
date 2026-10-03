const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE);

async function main() {
  const fs = require("fs");
  const state = JSON.parse(fs.readFileSync(process.env.ADMIN_STATE, "utf8"));
  const cookie = state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const api = async (path, opts = {}) => {
    const res = await fetch(`${BASE}/api/admin${path}`, { ...opts, headers: { "Content-Type": "application/json", Cookie: cookie, ...(opts.headers || {}) } });
    if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
    return res.json();
  };

  const slug = "bulk-inspector-fix-test-" + Date.now();
  const { id: pageId } = await api("/pages", { method: "POST", body: JSON.stringify({ slug, title: "Bulk inspector fix test" }) });
  const style1 = { animation: "custom", customKeyframes: [{ offset: 0, opacity: 0 }, { offset: 100, opacity: 1 }], animationDuration: 500 };
  const { id: block1 } = await api(`/pages/${pageId}/blocks`, { method: "POST", body: JSON.stringify({ type: "text", content: { text: "Block 1" }, style: style1, col: 1, col_span: 12, row: 1, row_span: 4 }) });
  const { id: block2 } = await api(`/pages/${pageId}/blocks`, { method: "POST", body: JSON.stringify({ type: "text", content: { text: "Block 2" }, style: style1, col: 13, col_span: 12, row: 1, row_span: 4 }) });
  console.log("created page", pageId, "blocks", block1, block2);

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await browser.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(`${BASE}/admin/`);
  await page.waitForSelector("#app:not([hidden])");
  await page.selectOption("#page-picker", String(pageId));
  await page.waitForTimeout(400);

  // Multi-select both blocks via shift-click (the exact critic reproduction).
  await page.click(`.admin-block[data-id="${block1}"]`);
  await page.click(`.admin-block[data-id="${block2}"]`, { modifiers: ["Shift"] });
  await page.waitForSelector("#bulk-inspector:not([hidden])");
  await page.waitForTimeout(200);

  const bulkBtnExists = await page.evaluate(() => !!document.querySelector("#bulk-inspector .edit-keyframes-btn"));
  console.log("bulk inspector has the edit-keyframes button (expect true, confirming this is the right reproduction):", bulkBtnExists);

  // The exact critic reproduction: synthetic change event on the bulk inspector's button.
  await page.evaluate(() => {
    document.querySelector("#bulk-inspector .edit-keyframes-btn").dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(400);

  const afterList = await api(`/pages/${pageId}/blocks`);
  const b1After = afterList.find((b) => b.id === block1).style;
  const b2After = afterList.find((b) => b.id === block2).style;
  console.log("block1 customKeyframes after synthetic change on bulk button:", JSON.stringify(b1After.customKeyframes));
  console.log("block2 customKeyframes after synthetic change on bulk button:", JSON.stringify(b2After.customKeyframes));
  const bothUnaffected =
    Array.isArray(b1After.customKeyframes) && b1After.customKeyframes.length === 2 &&
    Array.isArray(b2After.customKeyframes) && b2After.customKeyframes.length === 2;
  console.log("bulk inspector no longer wipes customKeyframes across selected blocks (expect true):", bothUnaffected, bothUnaffected ? "PASS" : "FAIL");

  // Regression: normal bulk apply (a real field, e.g. hoverEffect) still works via a real change event.
  await page.selectOption('#bulk-inspector select[data-key="hoverEffect"]', "lift");
  await page.waitForTimeout(400);
  const afterHover = await api(`/pages/${pageId}/blocks`);
  const bothGotHover = afterHover.every((b) => b.style.hoverEffect === "lift");
  console.log("normal bulk-apply of a real select field still works (expect both blocks get hoverEffect=lift):", bothGotHover, bothGotHover ? "PASS" : "FAIL");

  console.log("page errors (expect none):", pageErrors.length === 0 ? "PASS" : "FAIL " + JSON.stringify(pageErrors));

  await browser.close();
  await api(`/pages/${pageId}`, { method: "DELETE" });
  const confirmGone = await fetch(`${BASE}/${slug}`);
  console.log("test page deleted (expect true):", confirmGone.status !== 200, confirmGone.status !== 200 ? "PASS" : "FAIL");
}
main().catch((e) => { console.error(e); process.exit(1); });
