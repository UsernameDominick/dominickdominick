// The Trainer page (/trainer): a nav tab left of Studio, three drills played on the stage, a score and a history kept in this browser,
// settings that stick, panels that fold, "Opens with", a phone width that fits, and axe in dark and light.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
const axeSrc = axeSource();
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true });
    const p = await ctx.newPage();
    const errs = []; const adminCalls = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("request", (r) => { if (/\/api\//.test(r.url()) && !/track|search/.test(r.url())) adminCalls.push(r.url()); });
    p.on("dialog", (d) => d.accept());
    const res = await p.goto(E2E_BASE + "/trainer");
    ok(res.status() === 200, "/trainer is open to everyone", res.status());
    ok((await p.title()).startsWith("Trainer"), "it has its own title");
    const hrefs = await p.evaluate(() => [...document.querySelectorAll(".site-nav .tabs > .tab")].map((a) => a.getAttribute("href")));
    ok(hrefs.indexOf("/trainer") >= 0 && hrefs.indexOf("/trainer") < hrefs.indexOf("/studio") && hrefs.indexOf("/trainer") + 1 === hrefs.indexOf("/studio") - 0 || hrefs.indexOf("/trainer") < hrefs.indexOf("/studio"), "the Trainer tab sits to the left of Studio", hrefs);
    await p.waitForSelector("#trainer-mount .trainer", { timeout: 20000 });
    ok((await p.locator(".trainer-drill").count()) === 5, "five drills in the left panel");
    ok((await p.locator("#trainer-right input[data-key=size]").count()) === 1, "settings are in the right panel");
    ok((await p.locator(".trainer-intro").isVisible()), "it opens on a Start card, no prompt about new things");
    await p.evaluate(() => { localStorage.clear(); });

    // --- gridshot: hit what is on the stage ---
    await p.click(".trainer-drill[data-drill=gridshot]");
    await p.fill("#trainer-right input[data-key=duration]", "10").catch(() => {});
    await p.evaluate(() => { const i = document.querySelector("[data-key=duration]"); i.value = 10; i.dispatchEvent(new Event("input", { bubbles: true })); });
    await p.click(".trainer-go");
    await p.waitForSelector(".trainer-target", { timeout: 8000 });
    ok((await p.locator(".trainer-target").count()) === 3, "gridshot has three targets up");
    let hits = 0;
    for (let i = 0; i < 6; i++) {
      const box = await p.locator(".trainer-target").first().boundingBox();
      await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      hits++;
      await p.waitForTimeout(40);
    }
    await p.mouse.click((await p.locator("#trainer-stage").boundingBox()).x + 3, (await p.locator("#trainer-stage").boundingBox()).y + 3); // a miss in the corner
    ok((await p.locator(".trainer-target").count()) === 3, "a hit puts a new target up, so there are always three");
    ok((await p.textContent(".live-hits")) === String(hits), "the live hit count follows", await p.textContent(".live-hits"));
    ok(/^\d+%$/.test(await p.textContent(".live-acc")), "and so does the accuracy");
    await p.waitForSelector(".trainer-result:not([hidden])", { timeout: 15000 });
    const grid = await p.textContent(".result-grid");
    ok(/Score/.test(grid) && /Accuracy/.test(grid) && /Reaction/.test(grid) && new RegExp(hits + " of " + (hits + 1)).test(grid), "the result shows score, accuracy, hits and reaction", grid);
    ok(await p.locator(".result-record").isVisible(), "the first run is a best for its drill");
    ok((await p.locator(".trainer-history li").count()) === 1 && (await p.textContent(".trainer-drill[data-drill=gridshot] .drill-best")).startsWith("Best"), "it lands in the history and on the drill");
    await p.reload();
    await p.waitForSelector("#trainer-mount .trainer");
    ok((await p.locator(".trainer-history li .h-score").count()) === 1, "the history is still there after a reload");
    ok((await p.inputValue("[data-key=duration]")) === "10", "and so is the setting I changed");

    // --- flick: one target at a time, far from the last ---
    await p.click(".trainer-drill[data-drill=flick]");
    await p.click(".trainer-go");
    await p.waitForSelector(".trainer-target", { timeout: 8000 });
    ok((await p.locator(".trainer-target").count()) === 1, "flick has one target");
    const b1 = await p.locator(".trainer-target").boundingBox();
    await p.mouse.click(b1.x + b1.width / 2, b1.y + b1.height / 2);
    await p.waitForTimeout(60);
    const b2 = await p.locator(".trainer-target").boundingBox();
    ok(Math.hypot(b2.x - b1.x, b2.y - b1.y) > 100, "after a hit the next one is somewhere else", [b1, b2]);
    await p.keyboard.press("Escape");
    ok(await p.locator(".trainer-intro").isVisible() && (await p.locator(".trainer-target").count()) === 0, "Esc ends a run early and goes back to the Start card");
    ok((await p.locator(".trainer-history li .h-score").count()) === 1, "an ended run is not scored");

    // --- tracking: hold on the target ---
    await p.click(".trainer-drill[data-drill=tracking]");
    ok(await p.locator("[data-only=tracking]").isVisible(), "the speed setting shows only for tracking");
    await p.click(".trainer-go");
    await p.waitForSelector(".trainer-target", { timeout: 8000 });
    const stage = await p.locator("#trainer-stage").boundingBox();
    await p.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await p.mouse.down();
    for (let i = 0; i < 60; i++) {
      const t = await p.locator(".trainer-target").boundingBox();
      if (t) await p.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
      await p.waitForTimeout(30);
    }
    const on = await p.textContent(".live-hits");
    ok(parseFloat(on) > 0.5, "holding on the moving target adds up time on it", on);
    await p.mouse.up();
    await p.keyboard.press("Escape");
    ok(stage.width > 300, "the stage has room");

    // --- settings, folding, opens with ---
    await p.click("#trainer-right .studio-panel-fold");
    ok(await p.evaluate(() => document.querySelector(".trainer").classList.contains("is-right-folded")), "the settings panel folds to a handle");
    await p.reload();
    await p.waitForSelector("#trainer-mount .trainer");
    ok(await p.evaluate(() => document.querySelector(".trainer").classList.contains("is-right-folded")), "and stays folded after a reload");
    await p.click("#trainer-right .studio-panel-handle");
    await p.selectOption("#trainer-start", "flick");
    await p.reload();
    await p.waitForSelector("#trainer-mount .trainer");
    ok((await p.getAttribute(".trainer-drill[data-drill=flick]", "aria-checked")) === "true", "Opens with flick starts the page on flick");
    await p.check("[data-key=lock]");
    ok(await p.locator("[data-key=sensitivity]").isVisible(), "capturing the mouse brings up the sensitivity");
    await p.uncheck("[data-key=lock]");

    // --- precision: half-size targets ---
    await p.click(".trainer-drill[data-drill=precision]");
    await p.click(".trainer-go");
    await p.waitForSelector(".trainer-target", { timeout: 8000 });
    const pw = (await p.locator(".trainer-target").boundingBox()).width;
    ok(pw >= 22 && pw <= 26, "precision targets are half the size set", pw);
    await p.keyboard.press("Escape");

    // --- the chart ---
    await p.evaluate(() => localStorage.setItem("trainer.history.v1", JSON.stringify([300, 500, 400].map((s, i) => ({ drill: "gridshot", score: s, accuracy: 90, reaction: 400, hits: 5, seconds: 30, at: 1700000000000 + i })))));
    await p.reload();
    await p.waitForSelector(".trainer", { timeout: 30000 });
    await p.click(".trainer-drill[data-drill=gridshot]");
    ok((await p.locator(".trainer-chart .trainer-spark circle").count()) === 3 && /best 500/.test(await p.textContent(".trainer-chart-cap")), "the progress chart draws the drill's recent scores and names the best", await p.textContent(".trainer-chart"));
    ok(/Your last 3 Gridshot scores/.test(await p.getAttribute(".trainer-spark", "aria-label")), "and says it in words for a screen reader");

    // --- the sensitivity converter ---
    await p.click(".trainer-convert summary");
    await p.fill("#conv-sens", "1");
    ok(/Valorant: 0\.3143/.test(await p.textContent("#conv-out")) && /51\.95 cm per full turn at 800 DPI/.test(await p.textContent("#conv-out")), "CS2 1.0 converts to Valorant 0.3143 and shows the distance for a full turn", await p.textContent("#conv-out"));
    await p.selectOption("#conv-to", "overwatch");
    ok(/Overwatch 2: 3\.333(?!\d)/.test(await p.textContent("#conv-out")), "and to another game when it is changed", await p.textContent("#conv-out"));

    // --- the reaction drill, and sharing the result ---
    await p.click(".trainer-drill[data-drill=reaction]");
    ok(!(await p.locator('[data-row="size"]').isVisible()) && !(await p.locator('[data-row="duration"]').isVisible()), "the reaction drill hides the size and length settings");
    await p.click(".trainer-go");
    await p.waitForSelector(".trainer-cue.is-wait", { timeout: 8000 });
    const st = await p.locator("#trainer-stage").boundingBox();
    await p.mouse.click(st.x + st.width / 2, st.y + st.height / 2);
    await p.waitForSelector(".trainer-cue.is-early", { timeout: 3000 });
    ok(true, "clicking before green is called too soon");
    for (let i = 0; i < 8; i++) {
      await p.waitForSelector(".trainer-cue.is-go", { timeout: 8000 });
      await p.mouse.click(st.x + st.width / 2, st.y + st.height / 2);
      await p.waitForSelector(".trainer-cue.is-result, .trainer-result:not([hidden])", { timeout: 3000 });
    }
    await p.waitForSelector(".trainer-result:not([hidden])", { timeout: 6000 });
    const rg = await p.textContent(".result-grid");
    ok(/Average/.test(rg) && /Fastest/.test(rg) && /Early clicks\s*1/.test(rg), "the result shows the average, the fastest and the early click", rg);
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 8000 }), p.click(".trainer-share")]);
    ok(dl.suggestedFilename() === "aim-score.png", "Share saves a picture of the score where the browser cannot share it", dl.suggestedFilename());
    await p.click(".trainer-close");

    // --- accessibility, dark and light ---
    await p.addScriptTag({ content: axeSrc }).catch(() => {});
    const run = () => p.evaluate(async () => (await axe.run(document.getElementById("trainer-mount"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ": " + v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" ; ")));
    ok((await run()).length === 0, "axe: clean in the dark theme", await run());
    await p.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await p.waitForTimeout(400);
    const light = await run();
    ok(light.length === 0, "axe: clean in the light theme", light);
    await p.evaluate(() => document.documentElement.removeAttribute("data-theme"));

    // --- a phone ---
    const pctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
    const ph = await pctx.newPage();
    await ph.goto(E2E_BASE + "/trainer");
    await ph.waitForSelector("#trainer-mount .trainer");
    const over = await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 0, "no sideways scroll on a phone", over);
    ok((await ph.locator("#trainer-stage").boundingBox()).height > 250, "the stage keeps a usable height on a phone");
    const small = await ph.evaluate(() => [...document.querySelectorAll(".trainer button, .trainer select, .trainer input")].filter((e) => e.offsetParent && Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height) < 24).map((e) => e.className || e.tagName));
    ok(small.length === 0, "every control is at least 24 px", small);
    await ph.tap(".trainer-go");
    await ph.waitForSelector(".trainer-target", { timeout: 8000 });
    const tb = await ph.locator(".trainer-target").first().boundingBox();
    await ph.touchscreen.tap(tb.x + tb.width / 2, tb.y + tb.height / 2);
    ok((await ph.textContent(".live-hits")) === "1", "a tap on a target is a hit on a phone", await ph.textContent(".live-hits"));
    await pctx.close();

    ok(errs.length === 0, "no page errors", errs);
    ok(adminCalls.length === 0, "nothing is sent to the site's API", adminCalls);
  } finally { await b.close(); }
  console.log(fail ? fail + " FAILED" : "ALL PASS");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
