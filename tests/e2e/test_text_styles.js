// Every line this test prints that says FAIL counts, so the exit code is honest.
let failedChecks = 0;
{ const realLog = console.log; console.log = (...a) => { if (/\bFAIL\b/.test(a.map(String).join(" "))) failedChecks++; realLog(...a); }; }
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE);

async function main() {
  const fs = require("fs");
  const state = JSON.parse(fs.readFileSync(process.env.ADMIN_STATE, "utf8"));
  const cookie = state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const api = async (path, opts = {}) => {
    const res = await fetch(`${BASE}/api/admin${path}`, { ...opts, headers: { "Content-Type": "application/json", Cookie: cookie, ...(opts.headers || {}) } });
    return res;
  };

  // Server-side validation checks first (fail-closed cases).
  const badFont = await api("/text-styles", { method: "POST", body: JSON.stringify({ name: "bad", font: "comic-sans", color: "#ff0000", size: 5 }) });
  console.log("invalid font rejected (expect 400):", badFont.status, badFont.status === 400 ? "PASS" : "FAIL");
  const badColor = await api("/text-styles", { method: "POST", body: JSON.stringify({ name: "bad", font: "sans-serif", color: "red", size: 5 }) });
  console.log("invalid color rejected (expect 400):", badColor.status, badColor.status === 400 ? "PASS" : "FAIL");
  const noName = await api("/text-styles", { method: "POST", body: JSON.stringify({ font: "sans-serif", color: "#ff0000", size: 5 }) });
  console.log("missing name rejected (expect 400):", noName.status, noName.status === 400 ? "PASS" : "FAIL");

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await browser.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  let promptResponse = "Bold Orange";
  page.on("dialog", async (d) => {
    if (d.type() === "prompt") await d.accept(promptResponse);
    else await d.accept();
  });

  await page.goto(`${BASE}/admin/`);
  await page.waitForSelector("#app:not([hidden])");

  // Open a blank image via the existing new-blank-image flow.
  await page.click("#media-btn");
  await page.waitForSelector("#media-modal:not([hidden])");
  await page.click("#media-new-blank-btn");
  await page.waitForSelector("#pe-new-doc-modal:not([hidden])");
  await page.click("#pe-new-doc-create");
  await page.waitForSelector("#photo-editor-modal:not([hidden])");
  await page.waitForTimeout(400);

  // Controls hidden on the default "select" tool.
  const hiddenByDefault = await page.evaluate(() => document.getElementById("pe-apply-text-style").hidden);
  console.log("text-style controls hidden when Text tool isn't active (expect true):", hiddenByDefault, hiddenByDefault ? "PASS" : "FAIL");

  // Switch to the Text tool.
  await page.click('.pe-tool[data-tool="text"]');
  await page.waitForTimeout(200);
  const visibleOnText = await page.evaluate(() => ({
    apply: !document.getElementById("pe-apply-text-style").hidden,
    save: !document.getElementById("pe-save-text-style").hidden,
    del: !document.getElementById("pe-delete-text-style").hidden,
  }));
  console.log("text-style controls visible on Text tool (expect all true):", JSON.stringify(visibleOnText), (visibleOnText.apply && visibleOnText.save && visibleOnText.del) ? "PASS" : "FAIL");

  // Set a distinctive color/size, save as a text style.
  await page.fill("#pe-annotate-color", "#00ff00"); // color inputs don't always accept .fill; use evaluate to be safe
  await page.evaluate(() => {
    const el = document.getElementById("pe-annotate-color");
    el.value = "#00ff00";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() => {
    const el = document.getElementById("pe-annotate-size");
    el.value = 12;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click("#pe-save-text-style");
  // The style name is asked for in the editor's own small dialog (it used to be window.prompt).
  await page.fill("#photo-editor-prompt-input", promptResponse);
  await page.click('#photo-editor-prompt-form button[type="submit"]');
  await page.waitForTimeout(400);

  const saved = await (await api("/text-styles")).json();
  console.log("text style saved server-side:", JSON.stringify(saved));
  const savedCorrect = saved.length === 1 && saved[0].name === "Bold Orange" && saved[0].color === "#00ff00" && saved[0].size === 12 && saved[0].font === "sans-serif";
  console.log("saved text style has correct font/color/size (expect true):", savedCorrect, savedCorrect ? "PASS" : "FAIL");

  // Reset fields, then apply the saved style back.
  await page.evaluate(() => {
    document.getElementById("pe-annotate-color").value = "#ff7a45";
    document.getElementById("pe-annotate-size").value = 4;
  });
  await page.selectOption("#pe-apply-text-style", String(saved[0].id));
  await page.waitForTimeout(200);
  const appliedFields = await page.evaluate(() => ({
    color: document.getElementById("pe-annotate-color").value,
    size: document.getElementById("pe-annotate-size").value,
    font: document.getElementById("pe-text-font").value,
  }));
  console.log("applying the style correctly restores color/size/font (expect #00ff00/12/sans-serif):", JSON.stringify(appliedFields));
  const applyCorrect = appliedFields.color.toLowerCase() === "#00ff00" && appliedFields.size === "12" && appliedFields.font === "sans-serif";
  console.log("apply correctness:", applyCorrect, applyCorrect ? "PASS" : "FAIL");

  // Confirm placeText() actually uses these live values -- draw text and check pixel color.
  await page.evaluate(() => {
    window.__origPrompt = window.prompt;
  });
  await page.click("#pe-canvas", { position: { x: 300, y: 200 }, force: true });
  // Placing text asks what it should say, in the editor's own small dialog (it used to be window.prompt).
  await page.waitForSelector("#photo-editor-prompt-modal:not([hidden])");
  await page.fill("#photo-editor-prompt-input", "Hello");
  await page.click('#photo-editor-prompt-form button[type="submit"]');
  await page.waitForTimeout(300);
  const pixel = await page.evaluate(() => {
    const c = document.getElementById("pe-canvas");
    const cctx = c.getContext("2d");
    // Sample a wide strip since exact glyph pixel positions vary by font metrics.
    // The canvas is CSS-scaled to fit the viewport, so the click's CSS
    // position doesn't map 1:1 to canvas pixel coordinates -- sample a
    // generous region around where a mid-canvas click should have landed.
    const scaleX = c.width / c.getBoundingClientRect().width;
    const scaleY = c.height / c.getBoundingClientRect().height;
    const px = Math.round(300 * scaleX);
    const py = Math.round(200 * scaleY);
    const data = cctx.getImageData(Math.max(0, px - 80), Math.max(0, py - 40), 200, 80).data;
    let greenFound = false;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 50 && data[i + 1] > 200 && data[i + 2] < 50 && data[i + 3] > 200) { greenFound = true; break; }
    }
    return greenFound;
  });
  console.log("placed text actually renders in the applied style's color (expect true, found green pixels):", pixel, pixel ? "PASS" : "FAIL");

  // Delete the style.
  await page.click("#pe-delete-text-style");
  await page.waitForTimeout(400);
  const afterDelete = await (await api("/text-styles")).json();
  console.log("text style deleted (expect 0 remaining):", afterDelete.length === 0, afterDelete.length === 0 ? "PASS" : "FAIL");

  console.log("page errors (expect none):", pageErrors.length === 0 ? "PASS" : "FAIL " + JSON.stringify(pageErrors));

  await browser.close();
}
main().then(() => { if (failedChecks) { console.error(`${failedChecks} check(s) printed FAIL`); process.exit(1); } }).catch((e) => { console.error(e); process.exit(1); });
