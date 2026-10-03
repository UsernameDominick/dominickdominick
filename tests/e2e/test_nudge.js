const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: process.env.ADMIN_STATE, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on('console', (msg) => console.log('CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));

  await page.goto((E2E_BASE + '/admin/'), { waitUntil: 'networkidle' });
  console.log('URL after load:', page.url());
  console.log('Title:', await page.title());

  await page.click('text=Simulations');
  await page.waitForSelector('#simulations-modal:not([hidden])', { timeout: 5000 });
  await page.screenshot({ path: require("os").tmpdir() + "/shot2_simlist.png" });

  await page.click('#new-simulation-btn');
  await page.waitForSelector('#simulation-builder-modal:not([hidden])', { timeout: 5000 });
  await page.screenshot({ path: require("os").tmpdir() + "/shot3_builder.png" });

  // Add two LEDs
  await page.click('[data-sim-type="led"]');
  await page.click('[data-sim-type="led"]');
  await page.screenshot({ path: require("os").tmpdir() + "/shot4_twoleds.png" });

  async function getPositions() {
    return page.$$eval('.sim-comp', (els) =>
      els.map((el) => ({ id: el.dataset.id, transform: el.getAttribute('transform'), classes: el.getAttribute('class') }))
    );
  }

  console.log('positions after adding 2 LEDs:', await getPositions());

  await browser.close();
})();
