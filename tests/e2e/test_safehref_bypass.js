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

  await page.click('.sim-palette-btn[data-sim-type="resistor"]');
  await page.waitForTimeout(150);
  const compBox = await page.locator("#sim-builder-svg g.sim-comp").first().boundingBox();
  await page.mouse.move(compBox.x + compBox.width / 2, compBox.y + compBox.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Directly exercise the fixed safeHref via the actual rendered href, bypassing
  // the <input type="url"> which itself constrains/normalizes what a user can type --
  // set comp.datasheetUrl and re-render the inspector to reach the real code path.
  const payloads = [
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\x01javascript:alert(1)",
    "\x0Bjavascript:alert(1)", // vertical tab -- was already correctly blocked before, confirm still blocked
    "javascript:alert(1)",
    "https://example.com/ok.pdf",
  ];

  const results = await page.evaluate((payloads) => {
    // Access the module's internal safeHref indirectly isn't possible (IIFE-scoped),
    // so drive it through the real UI path: set the input value via the DOM setter
    // (bypassing React-like normalization, there is none here) and read the rendered href.
    const input = document.getElementById("sim-comp-datasheet");
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    return payloads.map((p) => {
      nativeSetter.call(input, p);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const link = document.getElementById("sim-datasheet-link");
      return { payload: JSON.stringify(p), href: link.href, hidden: link.hidden };
    });
  }, payloads);

  for (const r of results) {
    const isNeutralized = r.href.endsWith("/#") || r.href === "about:blank#" || r.href.split("#")[1] === "" && !r.href.includes("javascript");
    const isJsExecutable = r.href.startsWith("javascript:");
    console.log(`payload ${r.payload} -> href=${JSON.stringify(r.href)} -- ${isJsExecutable ? "FAIL (still javascript: scheme!)" : "PASS (neutralized or safe)"}`);
  }

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
