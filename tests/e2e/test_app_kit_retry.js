// A tool page survives a flaky connection: a script that fails to arrive is asked for again and the page still builds; when it keeps failing
// the page says so and offers "Try again", which builds it once the connection is back (it used to stay broken until a reload).
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    // 1. the song editor's script fails twice, then arrives: the Studio still builds
    {
      const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
      let blocked = 0;
      await p.route("**/admin/song-builder.js", (r) => (blocked++ < 2 ? r.abort() : r.continue()));
      const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(E2E_BASE + "/studio");
      const built = await p.waitForSelector("#studio-mount .studio-shelf:not([hidden])", { timeout: 30000 }).then(() => true).catch(() => false);
      ok(built && blocked === 3, "a script that fails twice is asked for again and the Studio still builds", { built, requests: blocked });
      ok(errs.length === 0, "with no page errors", errs);
      await p.context().close();
    }
    // 2. it keeps failing: an error with Try again, and Try again works once the connection is back
    {
      const p = await (await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true })).newPage();
      let down = true;
      await p.route("**/admin/song-builder.js", (r) => (down ? r.abort() : r.continue()));
      await p.goto(E2E_BASE + "/studio");
      await p.waitForSelector("#studio-mount .app-retry", { timeout: 30000 });
      ok(/Could not load/.test(await p.textContent("#studio-mount [role=alert]")) && (await p.locator("#studio-mount .studio-native").count()) === 0, "when it keeps failing the page says so, with a Try again button");
      const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      ok(over <= 0, "and the message fits a phone", over);
      down = false;
      await p.tap("#studio-mount .app-retry");
      const built = await p.waitForSelector("#studio-mount .studio-shelf:not([hidden])", { timeout: 30000 }).then(() => true).catch(() => false);
      ok(built, "Try again builds the Studio once the connection is back");
      await p.context().close();
    }
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
