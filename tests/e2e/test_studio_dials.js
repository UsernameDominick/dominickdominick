// The dials of the Sound pane: a value bubble while turning, a four times finer drag with Shift (and no jump when Shift changes), arrow keys, the wheel
// (only after the dial is chosen), a double-click that takes a knob back to the sound's own value, and typing a value in its own unit.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("studioTipSeen", "1"); } catch (e) { /* none */ } });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
    await p.goto(E2E_BASE + "/studio");
    await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card-main", { timeout: 30000 });
    await p.waitForTimeout(800);
    // the Bass track has an instrument, so its knobs are live
    await p.click("#studio-stack .studio-card >> nth=1");
    await p.waitForTimeout(500);
    const knob = '#studio-sound-panel [data-knob="attack"]';
    const val = () => p.evaluate((q) => Number(document.querySelector(q).value), knob);
    const face = async () => p.evaluate((q) => { const i = document.querySelector(q); const r = i.parentNode.querySelector(".dial-face").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, knob);
    const setKnob = (v) => p.evaluate(([q, x]) => { const i = document.querySelector(q); i.value = String(x); i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); }, [knob, v]);
    const tweak = () => p.evaluate(() => window.SongStudioHost.synth("bass").attack);
    ok(await p.locator('#studio-sound-panel [data-knob-pane="Envelope"]').isVisible(), "the Envelope knobs are showing");
    ok(await p.evaluate((q) => document.querySelector(q).parentNode.classList.contains("dial"), knob), "a knob is a dial");
    ok(((await p.getAttribute(knob, "aria-valuetext")) || "").length > 0, "a screen reader is told the value in its unit (aria-valuetext)", await p.getAttribute(knob, "aria-valuetext"));

    // dragging shows the bubble
    let f = await face();
    await p.mouse.move(f.x, f.y);
    await p.mouse.down();
    await p.mouse.move(f.x, f.y - 40, { steps: 6 });
    const bubble = await p.evaluate((q) => { const el = document.querySelector(q).parentNode.querySelector(".dial-bubble"); return { text: el.textContent, vis: getComputedStyle(el).visibility }; }, knob);
    ok(bubble.vis === "visible" && /s$/.test(bubble.text), "while turning, a bubble shows the value with its unit", bubble);
    await p.mouse.up();
    const afterNormal = await val();
    ok(afterNormal > 0, "a 40 px drag up moved it", afterNormal);

    // a fine drag with Shift is about four times smaller
    // (Alt held through a drag switches the pull of the detents off, so the distances are not bent by one)
    await setKnob(500);
    f = await face();
    await p.keyboard.down("Alt");
    await p.mouse.move(f.x, f.y);
    await p.mouse.down();
    await p.mouse.move(f.x, f.y - 36, { steps: 6 });
    const normalMove = (await val()) - 500;
    await p.mouse.up();
    await p.keyboard.up("Alt");
    await setKnob(500);
    f = await face();
    await p.keyboard.down("Alt");
    await p.keyboard.down("Shift");
    await p.mouse.move(f.x, f.y);
    await p.mouse.down();
    await p.mouse.move(f.x, f.y - 36, { steps: 6 });
    const fineMove = (await val()) - 500;
    await p.mouse.up();
    await p.keyboard.up("Shift");
    await p.keyboard.up("Alt");
    ok(normalMove > 100 && fineMove > 15 && Math.abs(normalMove / fineMove - 4) < 1.2, "with Shift the same drag moves about four times less", [normalMove, fineMove]);

    // Shift pressed half way does not make the value jump
    await setKnob(300);
    f = await face();
    await p.keyboard.down("Alt");
    await p.mouse.move(f.x, f.y);
    await p.mouse.down();
    await p.mouse.move(f.x, f.y - 20, { steps: 4 });
    const before = await val();
    await p.keyboard.down("Shift");
    await p.mouse.move(f.x, f.y - 21, { steps: 1 });
    const jump = Math.abs((await val()) - before);
    await p.mouse.up();
    await p.keyboard.up("Shift");
    await p.keyboard.up("Alt");
    ok(jump < 12, "pressing Shift in the middle of a drag carries on from where it is (no jump)", [before, jump]);

    // keys
    await setKnob(500);
    await p.evaluate((q) => document.querySelector(q).focus(), knob);
    await p.keyboard.press("ArrowUp");
    ok((await val()) === 501, "an arrow key is one step", await val());
    await p.keyboard.press("Shift+ArrowUp");
    ok((await val()) === 511, "Shift and an arrow is ten", await val());
    await p.keyboard.press("PageUp");
    ok((await val()) === 611, "PageUp is a tenth of the range", await val());
    await p.keyboard.press("Home");
    ok((await val()) === 0, "Home goes to the bottom");

    // the wheel needs the dial to be chosen first
    await setKnob(500);
    await p.evaluate((q) => document.querySelector(q).blur(), knob);
    f = await face();
    await p.mouse.move(f.x, f.y);
    await p.mouse.wheel(0, -100);
    ok((await val()) === 500, "the wheel over a dial that is not chosen leaves it alone (the pane scrolls)");
    await p.evaluate((q) => document.querySelector(q).focus(), knob);
    await p.mouse.wheel(0, -100);
    ok((await val()) === 510, "once the dial is chosen, a wheel notch is one percent", await val());

    // typing a value
    await p.click('#studio-sound-panel [data-out="attack"]');
    ok(await p.locator("#studio-sound-panel .dial-type").isVisible(), "a click on the readout opens a box to type a value");
    await p.keyboard.type("0.5");
    await p.keyboard.press("Enter");
    await p.waitForTimeout(250);
    const typed = await tweak();
    ok(typed !== undefined && Math.abs(typed - 0.5) < 0.02, "the typed value (0.5 s) is applied", typed);
    ok(!(await p.locator("#studio-sound-panel .dial-type").count()), "and the box closes");
    await p.click('#studio-sound-panel [data-out="attack"]');
    await p.keyboard.type("999");
    await p.keyboard.press("Escape");
    ok(!(await p.locator("#studio-sound-panel .dial-type").count()) && Math.abs((await tweak()) - typed) < 1e-9, "Escape closes the box and changes nothing");

    // a double-click takes the knob back to the sound's own value
    f = await face();
    await p.mouse.dblclick(f.x, f.y);
    await p.waitForTimeout(300);
    ok((await tweak()) === undefined, "a double-click removes the tweak (the knob is the sound's own again)", await tweak());
    ok(Number(await p.evaluate((q) => document.querySelector(q).parentNode.querySelector(".dial-def").getAttribute("r"), knob)) > 0, "the dial's own setting is marked on its face");

    // Alt-click does the same
    await p.evaluate((q) => { const i = document.querySelector(q); i.value = "800"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); }, knob);
    ok((await tweak()) !== undefined, "(a tweak again)");
    f = await face();
    await p.keyboard.down("Alt");
    await p.mouse.click(f.x, f.y);
    await p.keyboard.up("Alt");
    await p.waitForTimeout(300);
    ok((await tweak()) === undefined, "Alt-click takes it back too");

    // the volume reads in decibels
    const volText = await p.getAttribute("#studio-sound-panel #studio-sound-vol", "aria-valuetext");
    ok(/dB$/.test(volText || ""), "the volume dial reads in decibels", volText);
    ok(errs.length === 0, "no page errors", errs);
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
