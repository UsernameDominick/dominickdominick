const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE);

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await browser.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/admin/`);
  await page.waitForSelector("#app:not([hidden])");
  await page.click("#simulations-btn");
  await page.waitForTimeout(300);
  await page.click("#new-simulation-btn");
  await page.waitForSelector("#simulation-builder-modal:not([hidden])");
  await page.waitForTimeout(300);

  // Craft a malicious JSON circuit with XSS payloads in id/kind/resistance/voltage
  const evilId = `x" onmouseover="window.__idXss=true" y="`;
  const evilKind = `wire" onload="window.__kindXss=true" z="`;
  const evilImport = JSON.stringify({
    components: [
      { id: evilId, type: "resistor", x: 50, y: 50, resistance: `1" autofocus onfocus="window.__resXss=true" x="` },
      { id: "b1", type: "battery", x: 200, y: 50, voltage: `9" autofocus onfocus="window.__voltXss=true" x="` },
    ],
    wires: [
      { id: "w1", from: { compId: evilId, pin: "p1" }, to: { compId: "b1", pin: "pos" }, kind: evilKind },
    ],
  });

  await page.evaluate((json) => {
    const blob = new Blob([json], { type: "application/json" });
    const file = new File([blob], "evil.json", { type: "application/json" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById("sim-import-file");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, evilImport);
  await page.waitForTimeout(300);

  // Open the resistor's inspector (triggers focus-based payload if broken out) --
  // selection is wired via pointerdown, not click, so simulate a full press-release.
  const compBox = await page.locator("#sim-builder-svg g.sim-comp").first().boundingBox();
  if (compBox) {
    await page.mouse.move(compBox.x + compBox.width / 2, compBox.y + compBox.height / 2);
    await page.mouse.down();
    await page.mouse.up();
  }
  await page.waitForTimeout(300);

  // Also explicitly select the SECOND component (the other one) to check the resistor's field too
  const compBox2 = (await page.locator("#sim-builder-svg g.sim-comp").all())[1];
  if (compBox2) {
    const box2 = await compBox2.boundingBox();
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);
  }

  const results = await page.evaluate(() => ({
    idXss: window.__idXss === true,
    kindXss: window.__kindXss === true,
    resXss: window.__resXss === true,
    voltXss: window.__voltXss === true,
  }));
  console.log("XSS results (all should be false/undefined):", results);
  const anyFired = Object.values(results).some(Boolean);
  console.log("no XSS payload fired:", !anyFired, !anyFired ? "PASS" : "FAIL (XSS executed!)");

  // Confirm the resistance field shows a sane numeric fallback, not the raw string
  const inspectorState = await page.evaluate(() => ({
    resistanceValue: document.getElementById("sim-comp-resistance")?.value ?? null,
    voltageValue: document.getElementById("sim-comp-voltage")?.value ?? null,
    inspectorHtml: (document.getElementById("sim-inspector") || document.querySelector(".sim-inspector"))?.innerHTML?.slice(0, 200) ?? "no inspector element found",
  }));
  console.log("inspector state:", inspectorState);

  // Confirm the DOM isn't broken (attribute still well-formed, group still exists)
  const compGroupExists = await page.evaluate(() => document.querySelectorAll("#sim-builder-svg g[data-id]").length);
  console.log("component groups still rendered correctly (expect 2):", compGroupExists, compGroupExists === 2 ? "PASS" : "FAIL");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
