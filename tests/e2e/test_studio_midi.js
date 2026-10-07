// The Studio's MIDI tab: connect, see the keyboard, and watch its keys arrive (with a fake MIDI keyboard, since a sandbox has none).
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
const axeSrc = axeSource();
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    for (const theme of ["desktop", "phone"]) {
      const ctx = await b.newContext({ viewport: { width: theme === "desktop" ? 1360 : 390, height: 860 }, hasTouch: theme === "phone" });
      await ctx.addInitScript(() => {
        localStorage.setItem("studioTipSeen", "1");
        const input = { id: "k37", name: "Fake Keystation 37", manufacturer: "Test", state: "connected", onmidimessage: null };
        window.__input = input;
        navigator.requestMIDIAccess = async () => ({ inputs: new Map([["k37", input]]), onstatechange: null });
        window.__send = (...data) => input.onmidimessage && input.onmidimessage({ data: new Uint8Array(data) });
      });
      const p = await ctx.newPage();
      const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
      await p.goto(E2E_BASE + "/studio");
      await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-tools", { timeout: 30000 });
      await p.click("#studio-tools");
      await p.click("#studio-tab-midi");
      ok(await p.locator("#studio-pane-midi").isVisible(), theme + ": the MIDI tab opens");
      const status = () => p.locator("#studio-midi-status").textContent();
      ok(/Press Connect|connected/i.test(await status()), theme + ": it says where things stand", await status());
      if (await p.locator("#studio-midi-connect").isVisible()) await p.click("#studio-midi-connect");
      await p.waitForFunction(() => /1 MIDI input connected/.test(document.getElementById("studio-midi-status").textContent), null, { timeout: 5000 });
      ok((await p.locator("#studio-midi-devices").textContent()).includes("Fake Keystation 37"), theme + ": the keyboard is listed by name");
      await p.evaluate(() => window.__send(0x90, 60, 100));
      ok(/Note on C4 \(60\), velocity 100, channel 1/.test(await p.locator("#studio-midi-last").textContent()), theme + ": a key press shows its note and velocity");
      ok((await p.locator(".studio-midi-key.is-down").count()) === 1, theme + ": the key lights on the strip");
      await p.evaluate(() => window.__send(0x80, 60, 0));
      ok((await p.locator(".studio-midi-key.is-down").count()) === 0, theme + ": and goes out when let go");
      await p.evaluate(() => window.__send(0x90, 100, 90));
      ok(await p.locator('.studio-midi-key.is-down').count() === 1, theme + ": a note beyond the strip moves it into view");
      ok(/Heard 2 notes/.test(await p.locator("#studio-midi-range").textContent()), theme + ": it counts what it heard");
      await p.evaluate(() => window.__send(0xb0, 64, 127));
      ok(/sustain pedal/.test(await p.locator("#studio-midi-last").textContent()), theme + ": a pedal press is named");
      await p.evaluate(() => window.__send(0xf8));
      ok(/sustain pedal/.test(await p.locator("#studio-midi-last").textContent()), theme + ": clock pings are ignored");
      ok((await p.locator(".studio-midi-key").count()) === 37, theme + ": the strip has 37 keys");
      await p.evaluate(() => { window.__input.state = "disconnected"; });
      await p.click("#studio-midi-refresh");
      ok(/no MIDI keyboard found/.test(await status()), theme + ": an unplugged keyboard is reported", await status());
      const w = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      ok(w <= 0, theme + ": no sideways overflow", w);
      await p.addScriptTag({ content: axeSrc });
      const v = await p.evaluate(async () => (await axe.run("#studio-pane-midi")).violations.map((x) => x.id));
      ok(v.length === 0, theme + ": axe is clean on the tab", v);
      ok(errs.length === 0, theme + ": no page errors", errs);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? "FAILED " + fail : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
