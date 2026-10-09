// On a phone the strip of sections under the Studio (pads, sound, track, song, patterns, share, midi) is a carousel: equal stops that snap to the
// middle, the one in the middle is the section shown, a tap scrolls a stop to the middle, and scrolling the strip to another stop switches to it.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => { try { localStorage.setItem("studioTipSeen", "1"); } catch (e) { /* none */ } });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
    await p.goto(E2E_BASE + "/studio");
    await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card-main", { timeout: 30000 });
    await p.waitForTimeout(900);

    const picked = () => p.evaluate(() => { const e = document.querySelector('.studio-deck-dial [aria-selected="true"]'); return e ? e.dataset.deck : ""; });
    const offMiddle = (id) => p.evaluate((d) => { const dial = document.querySelector(".studio-deck-dial").getBoundingClientRect(); const s = document.querySelector(`.studio-deck-dial [data-deck="${d}"]`).getBoundingClientRect(); return Math.round(Math.abs(s.left + s.width / 2 - (dial.left + dial.width / 2))); }, id);
    // scrolls the strip the way a finger would, to put a stop in the middle (no script turn: it goes through the scroll event)
    const scrollTo = (id) => p.evaluate((d) => { const dial = document.querySelector(".studio-deck-dial"); const s = document.querySelector(`.studio-deck-dial [data-deck="${d}"]`); const dr = dial.getBoundingClientRect(); const sr = s.getBoundingClientRect(); dial.scrollLeft += (sr.left + sr.width / 2) - (dr.left + dr.width / 2); }, id);

    const widths = await p.evaluate(() => [...document.querySelectorAll(".studio-deck-stop")].map((e) => Math.round(e.getBoundingClientRect().width)));
    ok(widths.length === 7 && new Set(widths).size === 1, "the seven sections are stops of one width", widths);
    ok((await picked()) === "pads" && (await offMiddle("pads")) <= 3, "Pads is the one in the middle to begin with", [await picked(), await offMiddle("pads")]);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "and the page itself does not scroll sideways");

    // a tap
    await p.click('.studio-deck-stop[data-deck="sound"]');
    await p.waitForTimeout(1000);
    ok((await picked()) === "sound" && (await offMiddle("sound")) <= 3, "a tap on Sound shows it and scrolls it to the middle", [await picked(), await offMiddle("sound")]);
    ok(await p.locator("#studio-pane-sound").isVisible(), "(its pane is on show)");

    // a scroll
    await scrollTo("song");
    await p.waitForTimeout(700);
    ok((await picked()) === "song", "scrolling the strip until Song is in the middle switches to it", await picked());
    ok(await p.locator("#studio-pane-sound").isHidden(), "(and the Sound pane is gone)");
    await scrollTo("midi");
    await p.waitForTimeout(700);
    ok((await picked()) === "midi" && (await offMiddle("midi")) <= 3, "the last one can reach the middle too (MIDI)", [await picked(), await offMiddle("midi")]);
    await scrollTo("pads");
    await p.waitForTimeout(700);
    ok((await picked()) === "pads", "and so can the first (back to Pads, the keys)", await picked());
    ok(await p.locator("#studio-keys").isVisible(), "(the keys are back)");

    // the keyboard still walks it
    await p.focus('.studio-deck-stop[data-deck="pads"]');
    await p.keyboard.press("ArrowRight");
    await p.waitForTimeout(500);
    ok((await picked()) === "sound", "the arrow keys still step to the next section", await picked());
    ok(errs.length === 0, "no page errors", errs);
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
