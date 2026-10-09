// How readable the Studio is, measured and photographed. It does not fail on looks (the checks that can fail are the ones at the end); what it does is
//  (1) write screenshots of the Studio (a computer and a phone, dark and light, with some music in it, the Sound pane, the search dialog) to
//      tests/e2e/screenshots (CI uploads them as the "studio-screenshots" artifact), so a change to type or colour can be judged by eye, and
//  (2) print, for each of those, how much of the visible text is set at each size (as drawn: JetBrains Mono is shrunk to 70% by its @font-face, so a size
//      written as 22px is drawn at 15.4px), in which font, and the lowest contrast in each group, so "the type is small" is a number and not a feeling.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const fs = require("node:fs");
const path = require("node:path");
const OUT = process.env.SCREENSHOT_DIR || path.join(__dirname, "screenshots");

// Runs in the page: every piece of visible text, grouped by the size it is really drawn at, its font, weight and case.
function typeReport() {
  const cvs = document.createElement("canvas");
  cvs.width = cvs.height = 1;
  const cx = cvs.getContext("2d", { willReadFrequently: true });
  const rgba = (css) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = css;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top, under) => {
    const a = top[3] + under[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a);
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const background = (el) => {
    let col = [0, 0, 0, 0];
    let gradient = false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== "none") gradient = true;
      col = over(col, rgba(s.backgroundColor));
      if (col[3] >= 0.99) break;
    }
    if (col[3] < 0.99) col = over(col, rgba(getComputedStyle(document.documentElement).backgroundColor || "#fff"));
    if (col[3] < 0.99) col = over(col, [255, 255, 255, 1]);
    return { col, gradient };
  };
  const SHRINK = { "JetBrains Mono": 0.7 };
  const groups = new Map();
  let chars = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const text = t.nodeValue.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const el = t.parentElement;
    if (!el || el.closest("script, style, noscript, svg, [hidden], [aria-hidden='true']")) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) continue;
    const range = document.createRange();
    range.selectNodeContents(t);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (el.closest(".sim-sr-only, .sr-only, .skip-link")) continue;
    const family = (s.fontFamily.split(",")[0] || "").replace(/["']/g, "").trim();
    const size = parseFloat(s.fontSize) * (SHRINK[family] || 1);
    const caps = s.textTransform === "uppercase";
    const weight = Number(s.fontWeight) >= 600 ? "bold" : "regular";
    const fg = over(rgba(s.color), background(el).col);
    const bg = background(el);
    const c = ratio([fg[0], fg[1], fg[2], 1], bg.col);
    const key = [Math.round(size * 2) / 2, family, weight, caps ? "CAPS" : "case"].join("|");
    const g = groups.get(key) || { key, size: Math.round(size * 2) / 2, family, weight, caps, n: 0, chars: 0, minContrast: 99, samples: [], sel: [], gradient: false };
    g.n += 1;
    g.chars += text.length;
    g.gradient = g.gradient || bg.gradient;
    if (c < g.minContrast) g.minContrast = c;
    if (g.samples.length < 3 && !g.samples.includes(text.slice(0, 22))) g.samples.push(text.slice(0, 22));
    const sel = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + [...el.classList].slice(0, 2).map((c) => "." + c).join("");
    if (g.sel.length < 4 && !g.sel.includes(sel)) g.sel.push(sel);
    groups.set(key, g);
    chars += text.length;
  }
  return { chars, groups: [...groups.values()].map((g) => ({ ...g, minContrast: Math.round(g.minContrast * 10) / 10 })).sort((a, b) => a.size - b.size) };
}

(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const summary = [];
  const lines = [];
  const say = (l) => { lines.push(l); };
  try {
    for (const vp of [
      { name: "desktop", viewport: { width: 1440, height: 900 }, touch: false },
      { name: "phone", viewport: { width: 390, height: 844 }, touch: true },
    ]) {
      for (const scheme of ["dark", "light"]) {
        const tag = `${vp.name}-${scheme}`;
        const ctx = await b.newContext({ viewport: vp.viewport, isMobile: vp.touch, hasTouch: vp.touch, colorScheme: scheme, deviceScaleFactor: vp.touch ? 2 : 1 });
        await ctx.addInitScript((s) => { try { localStorage.setItem("studioTipSeen", "1"); localStorage.setItem("theme", s); } catch (e) { /* none */ } }, scheme);
        const p = await ctx.newPage();
        const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
        await p.goto(E2E_BASE + "/studio");
        await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card-main", { timeout: 30000 });
        await p.waitForTimeout(800);
        // some music, so the grids are not empty
        const tap = async (sel) => { try { await p.locator(sel).first().click({ timeout: 2500 }); } catch (e) { /* not there at this size */ } };
        for (const [row, step] of [["kick", 0], ["kick", 4], ["kick", 8], ["kick", 12], ["snare", 4], ["snare", 12], ["hihat", 2], ["hihat", 6], ["hihat", 10], ["hihat", 14]]) await tap(`#studio-grid .studio-cell[data-row="${row}"][data-step="${step}"]`);
        await p.screenshot({ path: path.join(OUT, `${tag}-1-drums.png`) });
        await tap('#studio-stack [data-pick="melody"]');
        await p.waitForTimeout(300);
        for (const [row, step] of [["C4", 0], ["E4", 2], ["G4", 4], ["C5", 6], ["G4", 8], ["E4", 10]]) await tap(`#studio-grid .studio-cell[data-row="${row}"][data-step="${step}"]`);
        await p.waitForTimeout(300);
        await p.screenshot({ path: path.join(OUT, `${tag}-2-melody.png`) });
        // the sound pane (a panel on a wide screen, a section of the deck on a phone)
        if (!vp.touch) {
          try { await p.locator("#studio-sound-panel").screenshot({ path: path.join(OUT, `${tag}-3-sound.png`) }); } catch (e) { /* no panel */ }
        } else {
          await tap('.studio-deck-stop:has-text("sound")');
          await p.waitForTimeout(500);
          await p.screenshot({ path: path.join(OUT, `${tag}-3-sound.png`) });
        }
        // the type, measured on the page as it stands
        const report = await p.evaluate(typeReport);
        const buckets = { "under 12": 0, "12 to 13.9": 0, "14 to 15.9": 0, "16 and up": 0 };
        report.groups.forEach((g) => { buckets[g.size < 12 ? "under 12" : g.size < 14 ? "12 to 13.9" : g.size < 16 ? "14 to 15.9" : "16 and up"] += g.chars; });
        const pct = (n) => Math.round((100 * n) / Math.max(1, report.chars));
        say(`\n=== ${tag}: ${report.chars} letters of visible text; drawn size: ` + Object.entries(buckets).map(([k, v]) => `${k}px ${pct(v)}%`).join(", "));
        report.groups.filter((g) => g.size < 18).forEach((g) => say(`  ${String(g.size).padStart(4)}px ${g.family.padEnd(15)} ${g.weight.padEnd(7)} ${g.caps ? "CAPS" : "case"} x${String(g.n).padEnd(3)} ${String(g.chars).padStart(4)} letters  contrast>=${g.minContrast}${g.gradient ? "~" : " "}  ${g.samples.join(" | ")}  [${g.sel.join(" ")}]`));
        summary.push({ tag, ...report, buckets });
        // the search dialog
        await tap("#finder-open");
        await p.waitForTimeout(400);
        await p.screenshot({ path: path.join(OUT, `${tag}-4-search.png`) });
        ok(errs.length === 0, `${tag}: no page errors`, errs);
        await ctx.close();
      }
    }
    fs.writeFileSync(path.join(OUT, "type-report.json"), JSON.stringify(summary, null, 1));
    fs.writeFileSync(path.join(OUT, "type-report.txt"), lines.join(String.fromCharCode(10)) + String.fromCharCode(10));
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
