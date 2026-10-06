const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const fs = require("fs");
const SCRATCH = require("os").tmpdir();
const BASE = (E2E_BASE);
let failures = 0;
const check = (label, ok, extra) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra !== undefined ? "  -> " + JSON.stringify(extra) : ""}`); };
(async () => {
  const state = JSON.parse(fs.readFileSync(process.env.ADMIN_STATE, "utf8"));
  const cookie = state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const api = async (path, opts = {}) => {
    const res = await fetch(`${BASE}/api/admin${path}`, { ...opts, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE, ...(opts.headers || {}) } });
    if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const stamp = Date.now();
  const row = (hits) => Array.from({ length: 16 }, (_, i) => hits.includes(i));
  const themes = ["default", "sunset", "ocean", "mono", "neon"];
  const songIds = [];
  for (const theme of themes) {
    const { id } = await api("/songs", { method: "POST", body: JSON.stringify({ name: `__embed_song_${theme}_${stamp}`, data: { tempo: 120, visualization: "bars", theme, master_volume: 0.3, tracks: { kick: row([0, 8]), snare: row([]), hihat: row([]), clap: row([]) }, melody: { waveform: "sine", notes: {} } } }) });
    songIds.push(id);
  }
  const simData = { components: [{ id: "bat", type: "battery", x: 100, y: 100 }, { id: "res", type: "resistor", x: 300, y: 100 }], wires: [{ id: "w1", from: { compId: "bat", pin: "pos" }, to: { compId: "res", pin: "p1" }, kind: "wire" }, { id: "w2", from: { compId: "res", pin: "p2" }, to: { compId: "bat", pin: "neg" }, kind: "wire" }] };
  const { id: simId } = await api("/simulations", { method: "POST", body: JSON.stringify({ name: `__embed_sim_${stamp}`, data: simData }) });
  await api(`/simulations/${simId}/publish`, { method: "POST" });
  const slug = `embed-controls-${stamp}`;
  const { id: pageId } = await api("/pages", { method: "POST", body: JSON.stringify({ slug, title: "Embed controls test" }) });
  let row0 = 1;
  for (const id of songIds) { await api(`/pages/${pageId}/blocks`, { method: "POST", body: JSON.stringify({ type: "song", content: { song_id: id }, style: {}, col: 1, col_span: 24, row: row0, row_span: 8 }) }); row0 += 8; }
  await api(`/pages/${pageId}/blocks`, { method: "POST", body: JSON.stringify({ type: "simulation", content: { simulation_id: simId }, style: {}, col: 1, col_span: 24, row: row0, row_span: 14 }) });

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
  const errs = [];
  try {
    for (const scheme of ["dark", "light"]) {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, colorScheme: scheme });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errs.push(String(e)));
      await page.addInitScript((s) => { try { localStorage.setItem("theme", s); } catch (e) {} }, scheme);
      await page.goto(`${BASE}/${slug}`);
      await page.waitForSelector(".song-embed-play-btn");
      if (scheme === "light") await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "light"); });
      await page.evaluate(() => {
        // a stand-in for the 3D scan block's slotted AR button (model-viewer needs a network font/CDN)
        const wrap = document.createElement("div");
        wrap.className = "scan-block-wrap";
        wrap.style.cssText = "position:relative;height:80px";
        wrap.innerHTML = '<button type="button" class="scan-ar-btn">View in your space</button>';
        document.querySelector("main, .canvas, body").appendChild(wrap);
      });
      const styleOf = (sel) => page.evaluate((s) => { const e = document.querySelector(s); const c = getComputedStyle(e); return { radius: c.borderTopLeftRadius, padY: c.paddingTop, padX: c.paddingLeft, fs: c.fontSize, fw: c.fontWeight, border: c.borderTopWidth, bg: c.backgroundColor, color: c.color }; }, sel);
      const song = await styleOf(".song-embed-play-btn"), sim = await styleOf(".sim-power-btn"), scan = await styleOf(".scan-ar-btn");
      const same = (k) => song[k] === sim[k] && sim[k] === scan[k];
      check(`[${scheme}] all three controls share radius, padding, font size, weight and border`, ["radius", "padY", "padX", "fs", "fw", "border"].every(same), { song, sim, scan });
      check(`[${scheme}] all three are filled with the accent by default`, song.bg === sim.bg && sim.bg === scan.bg && song.color === sim.color, { song: song.bg, sim: sim.bg, scan: scan.bg });

      // every song theme keeps readable button text
      const contrasts = await page.evaluate(() => {
        const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        return [...document.querySelectorAll(".song-embed-play-btn")].map((btn) => { const c = getComputedStyle(btn); const a = lum(c.backgroundColor), b = lum(c.color); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; });
      });
      check(`[${scheme}] Play button text meets 4.5:1 on every song theme`, contrasts.length === 5 && contrasts.every((c) => c >= 4.5), contrasts);

      // song button pressed state
      const btn = page.locator(".song-embed-play-btn").first();
      const firstName = await page.evaluate(() => document.querySelector(".song-embed-header strong").textContent);
      check(`[${scheme}] Play starts idle: no aria-pressed, not active, named for its song`, !(await btn.getAttribute("aria-pressed")) && !(await btn.evaluate((e) => e.classList.contains("is-active"))) && (await btn.getAttribute("aria-label")) === `Play ${firstName}`, await btn.getAttribute("aria-label"));
      check(`[${scheme}] the icon is a decorative drawing, not a symbol a phone shows as emoji`, await btn.evaluate((e) => { const g = e.querySelector("svg.ui-icon[aria-hidden='true']"); return !!g && !/\p{Extended_Pictographic}|\uFE0F|\uFE0E/u.test(e.textContent); }));
      await btn.click();
      await page.waitForTimeout(400);
      const playing = await styleOf(".song-embed-play-btn");
      check(`[${scheme}] while playing it reads Stop, is named for the action, and switches to the outlined look`, !(await btn.getAttribute("aria-pressed")) && (await btn.textContent()).includes("Stop") && (await btn.getAttribute("aria-label")) === `Stop ${firstName}` && (await btn.evaluate((e) => e.classList.contains("is-active"))) && playing.bg === "rgba(0, 0, 0, 0)", { text: await btn.textContent(), label: await btn.getAttribute("aria-label"), bg: playing.bg });
      await btn.click();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(500);
      check(`[${scheme}] stopping restores the label and the filled look`, (await btn.getAttribute("aria-label")) === `Play ${firstName}` && (await btn.textContent()).includes("Play") && (await styleOf(".song-embed-play-btn")).bg === song.bg);

      // sim button pressed state (existing behaviour, same treatment)
      const power = page.locator(".sim-power-btn:not(.sim-view-btn)");
      await power.click();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(500);
      const on = await styleOf(".sim-power-btn");
      check(`[${scheme}] Power on -> label swaps, no aria-pressed, outlined look`, (await power.textContent()) === "Power off" && !(await power.getAttribute("aria-pressed")) && (await power.evaluate((e) => e.classList.contains("is-active"))) && on.bg === "rgba(0, 0, 0, 0)");
      await power.click();

      // hover + focus
      await btn.hover();
      await page.waitForTimeout(300);
      const hovered = await page.evaluate(() => { const e = document.querySelector(".song-embed-play-btn"); const c = getComputedStyle(e); return { transform: c.transform, shadow: c.boxShadow }; });
      check(`[${scheme}] hover lifts the button like .btn`, hovered.transform !== "none" && hovered.shadow !== "none", hovered);
      await page.focus(".sim-power-btn");
      await page.keyboard.press("Tab");
      await page.focus(".sim-power-btn");
      const focusOutline = await page.evaluate(() => getComputedStyle(document.querySelector(".sim-power-btn")).outlineStyle);
      check(`[${scheme}] keyboard focus shows an outline`, focusOutline !== "none");
      await page.screenshot({ path: `${require("os").tmpdir()}/embed_controls_${scheme}.png`, fullPage: true });
      await ctx.close();
    }
    // environment variants
    const envCtx = await browser.newContext({ viewport: { width: 900, height: 900 }, colorScheme: "dark" });
    const envPage = await envCtx.newPage();
    await envPage.goto(`${BASE}/${slug}`);
    await envPage.waitForSelector(".song-embed-play-btn");
    await envPage.evaluate(() => { const w = document.createElement("div"); w.style.cssText = "position:relative;height:60px"; w.innerHTML = '<button type="button" class="scan-ar-btn">View in your space</button>'; document.querySelector("main, .canvas, body").appendChild(w); });
    const hoverTransform = async () => { await envPage.hover(".song-embed-play-btn"); await envPage.waitForTimeout(350); const t = await envPage.evaluate(() => { const c = getComputedStyle(document.querySelector(".song-embed-play-btn")); return { transform: c.transform, transition: c.transitionProperty, shadow: c.boxShadow }; }); await envPage.mouse.move(0, 0); await envPage.waitForTimeout(300); return t; };
    const normal = await hoverTransform();
    check("normal motion: hover lifts and glows", normal.transform !== "none" && normal.shadow !== "none", normal);
    await envPage.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await hoverTransform();
    check("OS reduced motion: hover glows but does not move, and nothing transitions", reduced.transform === "none" && reduced.shadow !== "none" && reduced.transition === "all", reduced);
    await envPage.emulateMedia({ reducedMotion: "no-preference" });
    await envPage.evaluate(() => document.documentElement.setAttribute("data-motion", "reduce"));
    const manual = await hoverTransform();
    check("the site's manual reduce-motion switch also stops the lift", manual.transform === "none" && manual.shadow !== "none", manual);
    const manualDur = await envPage.evaluate(() => ["song-embed-play-btn", "sim-power-btn"].map((c) => getComputedStyle(document.querySelector("." + c)).transitionDuration));
    check("the manual reduce-motion switch also drops the glow/colour fade", manualDur.every((d) => d.split(",").every((x) => parseFloat(x) === 0)), manualDur);
    await envPage.evaluate(() => document.documentElement.removeAttribute("data-motion"));
    // print with the Site Settings <style> still in place (this dev database overrides the accent and the on-accent colour there)
    const printContrast = () => envPage.evaluate(() => {
      const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      return [...document.querySelectorAll(".song-embed-play-btn, .sim-power-btn")].map((btn) => { const c = getComputedStyle(btn); const a = lum(c.backgroundColor), b = lum(c.color); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; });
    });
    await envPage.emulateMedia({ media: "print" });
    await envPage.waitForTimeout(300);
    const withSettings = await printContrast();
    check("print with Site Settings styles: every control is high contrast", withSettings.length === 7 && withSettings.every((c) => c >= 15), withSettings);
    const printExtras = await envPage.evaluate(() => ({ exact: [...document.querySelectorAll(".song-embed-play-btn, .sim-power-btn")].every((b) => getComputedStyle(b).printColorAdjust === "exact"), ar: getComputedStyle(document.querySelector(".scan-ar-btn")).display }));
    check("print keeps the pill fill even with background graphics off, and drops the AR button", printExtras.exact && printExtras.ar === "none", printExtras);
    await envPage.emulateMedia({ media: "screen" });
    await envPage.click(".sim-power-btn");
    await envPage.waitForTimeout(300);
    await envPage.emulateMedia({ media: "print" });
    await envPage.waitForTimeout(450);
    const activePrint = await envPage.evaluate(() => { const c = getComputedStyle(document.querySelector(".sim-power-btn")); return { color: c.color, bg: c.backgroundColor }; });
    check("print: a powered-on button (outlined look) prints black text on white, even with Site Settings colours", activePrint.color === "rgb(0, 0, 0)" && activePrint.bg === "rgba(0, 0, 0, 0)", activePrint);
    await envPage.emulateMedia({ media: "screen" });
    await envPage.click(".sim-power-btn");
    await envPage.emulateMedia({ media: "print" });
    await envPage.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await envPage.waitForTimeout(450); // let the colour transitions from the screen->print switch finish
    const withSettingsLight = await printContrast();
    check("print with Site Settings styles on the light theme: every control is high contrast and they all match", withSettingsLight.every((c) => c >= 15), withSettingsLight);
    await envPage.evaluate(() => document.documentElement.removeAttribute("data-theme"));
    await envPage.emulateMedia({ media: "screen" });
    // drop the Site Settings override to test the stock print block
    await envPage.evaluate(() => document.querySelectorAll("style").forEach((el) => { if (/--accent\s*:/.test(el.textContent)) el.remove(); }));
    await envPage.emulateMedia({ media: "print" });
    await envPage.waitForTimeout(500);
    const printed = await envPage.evaluate(() => [...document.querySelectorAll(".song-embed-play-btn, .sim-power-btn")].map((b) => { const c = getComputedStyle(b); return { bg: c.backgroundColor, color: c.color }; }));
    check("print: every button (all five song themes and the simulation) is white on black", printed.length === 7 && printed.every((p) => p.bg === "rgb(0, 0, 0)" && p.color === "rgb(255, 255, 255)"), printed);
    await envPage.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    const printedLight = await envPage.evaluate(() => [...document.querySelectorAll(".song-embed-play-btn")].map((b) => getComputedStyle(b).backgroundColor));
    check("print: still black when the page is on the light theme (the light theme accents are more specific)", printedLight.every((c) => c === "rgb(0, 0, 0)"), printedLight);
    await envPage.evaluate(() => document.documentElement.removeAttribute("data-theme"));
    await envPage.emulateMedia({ media: "screen" });
    const sizeN = (sel) => envPage.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 }; }, sel);
    const nBefore = await sizeN(".sim-power-btn");
    await envPage.click(".sim-power-btn");
    await envPage.waitForTimeout(300);
    const nAfter = await sizeN(".sim-power-btn");
    await envPage.click(".sim-power-btn");
    await envPage.waitForTimeout(300);
    const textDelta = Math.round((nAfter.w - nBefore.w) * 100) / 100;
    await envPage.emulateMedia({ media: "screen", forcedColors: "active" });
    const size = (sel) => envPage.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 }; }, sel);
    const simBefore = await size(".sim-power-btn"), songBefore = await size(".song-embed-play-btn");
    await envPage.click(".sim-power-btn");
    await envPage.click(".song-embed-play-btn");
    await envPage.waitForTimeout(400);
    const forced = await envPage.evaluate(() => getComputedStyle(document.querySelector(".sim-power-btn")).borderTopStyle);
    check("forced colors: the active state gets a dashed border as a shape cue", forced === "dashed", forced);
    const simAfter = await size(".sim-power-btn"), songAfter = await size(".song-embed-play-btn");
    check("forced colors: toggling doesn't change either button's size", simBefore.h === simAfter.h && Math.abs((simAfter.w - simBefore.w) - textDelta) < 0.6 && songBefore.h === songAfter.h, { simBefore, simAfter, songBefore, songAfter, textDelta });
    await envPage.click(".song-embed-play-btn");
    await envCtx.close();
    const touchCtx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    const touchPage = await touchCtx.newPage();
    await touchPage.goto(`${BASE}/${slug}`);
    await touchPage.waitForSelector(".song-embed-play-btn");
    const touchH = await touchPage.evaluate(() => Math.round(document.querySelector(".song-embed-play-btn").getBoundingClientRect().height));
    check("coarse pointer: buttons are at least 44px tall", touchH >= 44, touchH);
    await touchCtx.close();
    check("no page errors", errs.length === 0, errs.slice(0, 3));
  } finally {
    await browser.close();
    await api(`/pages/${pageId}`, { method: "DELETE" }).catch(() => {});
    await api(`/simulations/${simId}/unpublish`, { method: "POST" }).catch(() => {});
    await api(`/simulations/${simId}`, { method: "DELETE" }).catch(() => {});
    for (const id of songIds) await api(`/songs/${id}`, { method: "DELETE" }).catch(() => {});
    const leftover = (await api("/songs")).filter((s) => s.name.includes("__embed_song_")).length;
    console.log("cleanup: leftover test songs ->", leftover);
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
