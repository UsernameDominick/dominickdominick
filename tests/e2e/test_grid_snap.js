const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE);

async function main() {
  const browser = await chromium.launch();
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

  const defaultVal = await page.evaluate(() => document.getElementById("sim-grid-snap").value);
  console.log("default snap value (expect 5):", defaultVal, defaultVal === "5" ? "PASS" : "FAIL");

  // Place a power_supply -- not in SNAP_TO_BREADBOARD_TYPES, so it always
  // uses the grid-snap math, not the breadboard-hole snap math.
  await page.click('.sim-palette-btn[data-sim-type="power_supply"]');
  await page.waitForTimeout(200);

  async function dragAndGetPos(dx, dy) {
    const g = await page.evaluate(() => {
      const el = document.querySelector('[data-comp-type="power_supply"], .sim-component[data-type="power_supply"], g[data-id]');
      return null;
    });
    // Get the component's current on-screen position via its data-id group
    const compInfo = await page.evaluate(() => {
      // simData isn't global; read from the rendered group's transform instead
      const groups = Array.from(document.querySelectorAll("#sim-builder-svg g[data-id]"));
      const g = groups.find((el) => el.dataset.id && el.dataset.id.startsWith("power_supply"));
      if (!g) return null;
      const rect = g.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, id: g.dataset.id };
    });
    return compInfo;
  }

  let compInfo = await dragAndGetPos();
  if (!compInfo) {
    console.log("FAIL: could not find placed power_supply component group");
    await browser.close();
    return;
  }

  async function readCompXY(id) {
    return page.evaluate((id) => {
      // Try to read via the rendered transform attribute, which encodes x/y directly
      const g = document.querySelector(`#sim-builder-svg g[data-id="${id}"]`);
      const t = g.getAttribute("transform") || "";
      const m = t.match(/translate\(([-\d.]+)[, ]+([-\d.]+)\)/);
      return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
    }, id);
  }

  const before = await readCompXY(compInfo.id);
  console.log("component placed at:", before);

  // Drag by a non-multiple-of-5 amount and confirm it snaps to a multiple of 5
  await page.mouse.move(compInfo.x, compInfo.y);
  await page.mouse.down();
  await page.mouse.move(compInfo.x + 47, compInfo.y + 33, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after5 = await readCompXY(compInfo.id);
  console.log("after drag with 5px snap:", after5, `-- x%5=${after5.x % 5}, y%5=${after5.y % 5} (expect both 0)`,
    after5.x % 5 === 0 && after5.y % 5 === 0 ? "PASS" : "FAIL");

  // Switch to Off and drag again -- should NOT be forced to a multiple of 5
  await page.selectOption("#sim-grid-snap", "0");
  await page.mouse.move(compInfo.x + 47, compInfo.y + 33);
  await page.mouse.down();
  await page.mouse.move(compInfo.x + 47 + 13, compInfo.y + 33 + 7, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const afterOff = await readCompXY(compInfo.id);
  // With snapping off, the position should land on the raw (fractional,
  // screen-scale-dependent) drag delta rather than being forced onto a
  // multiple of 5 -- checking for non-integer-multiple-of-5 landing
  // (rather than an exact expected delta, which depends on zoom scaling
  // we don't control here) is the real assertion.
  const isMultipleOf5 = Math.abs(afterOff.x % 5) < 0.01 && Math.abs(afterOff.y % 5) < 0.01;
  console.log(`after drag with snap Off: landed at (${afterOff.x}, ${afterOff.y}) -- ${!isMultipleOf5 ? "PASS (not forced to grid)" : "FAIL (still snapped despite Off)"}`);

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
