// How readable the Studio is, measured and photographed. What it does:
//  (1) writes screenshots of the Studio (a computer and a phone, dark and light, with some music in it, each pane of the Sound panel or deck, the shelf and
//      the search dialog) to tests/e2e/screenshots (CI uploads them as the "studio-screenshots" artifact), so a change to type or colour is judged by eye;
//  (2) writes type-report.txt next to them: for each picture, how much of the visible text is drawn at each size (JetBrains Mono is shrunk by its
//      @font-face, 80%, so a size written as 22px is drawn at 17.6px), in which font, and the lowest contrast in each group;
//  (3) fails on the things that must stay true: no visible text drawn under 12px, no contrast under 4.5:1, no pixel-font text under 16px (its pixels
//      do not divide evenly into any other size, so it blurs), and no word broken in the middle by a narrow button.
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
  const SHRINK = { "JetBrains Mono": 0.8 };
  const groups = new Map();
  let chars = 0;
  const broken = [];
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
    // a one-word label that has been wrapped onto two lines has been broken in the middle of the word
    if (/^[A-Za-z]{5,}$/.test(text) && range.getClientRects().length > 1 && el.closest("button, [role=tab], .studio-seg-tab")) broken.push(text);
    const family = (s.fontFamily.split(",")[0] || "").replace(/["']/g, "").trim();
    const size = parseFloat(s.fontSize) * (SHRINK[family] || 1);
    const caps = s.textTransform === "uppercase";
    const weight = Number(s.fontWeight) >= 600 ? "bold" : "regular";
    const bg = background(el);
    const fg = over(rgba(s.color), bg.col);
    const c = ratio([fg[0], fg[1], fg[2], 1], bg.col);
    const key = [Math.round(size * 2) / 2, family, weight, caps ? "CAPS" : "case"].join("|");
    const g = groups.get(key) || { key, size: Math.round(size * 2) / 2, family, weight, caps, n: 0, chars: 0, minContrast: 99, samples: [], sel: [], gradient: false };
    g.n += 1;
    g.chars += text.length;
    g.gradient = g.gradient || bg.gradient;
    if (c < g.minContrast) g.minContrast = c;
    if (g.samples.length < 3 && !g.samples.includes(text.slice(0, 22))) g.samples.push(text.slice(0, 22));
    const sel = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + [...el.classList].slice(0, 2).map((cl) => "." + cl).join("");
    if (g.sel.length < 4 && !g.sel.includes(sel)) g.sel.push(sel);
    groups.set(key, g);
    chars += text.length;
  }
  return { chars, broken, groups: [...groups.values()].map((g) => ({ ...g, minContrast: Math.round(g.minContrast * 10) / 10 })).sort((a, b) => a.size - b.size) };
}

(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const lines = [];
  const say = (l) => { lines.push(l); };
  const problems = [];
  const NL = String.fromCharCode(10);
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
        const tap = async (sel) => { try { await p.locator(sel).first().click({ timeout: 2500 }); return true; } catch (e) { return false; } };
        let n = 0;
        // takes the picture, and measures the type as the page stands
        const shoot = async (state, el) => {
          n += 1;
          const file = `${tag}-${String(n).padStart(2, "0")}-${state}.png`;
          try { await (el ? p.locator(el).first() : p).screenshot({ path: path.join(OUT, file) }); } catch (e) { /* not there at this size */ }
          const report = await p.evaluate(typeReport);
          const buckets = { "under 12": 0, "12 to 13.9": 0, "14 to 15.9": 0, "16 and up": 0 };
          report.groups.forEach((g) => { buckets[g.size < 12 ? "under 12" : g.size < 14 ? "12 to 13.9" : g.size < 16 ? "14 to 15.9" : "16 and up"] += g.chars; });
          const pct = (k) => Math.round((100 * k) / Math.max(1, report.chars));
          say(`${NL}=== ${tag} / ${state}: ${report.chars} letters; drawn size: ` + Object.entries(buckets).map(([k, v]) => `${k}px ${pct(v)}%`).join(", "));
          report.groups.filter((g) => g.size < 15 || g.minContrast < 7 || (g.family === "Silkscreen" && g.size < 16)).forEach((g) => say(`  ${String(g.size).padStart(4)}px ${g.family.padEnd(15)} ${g.weight.padEnd(7)} ${g.caps ? "CAPS" : "case"} x${String(g.n).padEnd(3)} ${String(g.chars).padStart(4)} letters  contrast>=${g.minContrast}${g.gradient ? "~" : " "}  ${g.samples.join(" | ")}  [${g.sel.join(" ")}]`));
          report.groups.forEach((g) => {
            if (g.size < 12) problems.push(`${tag}/${state}: text drawn at ${g.size}px (${g.family}): ${g.samples.join(" | ")} [${g.sel.join(" ")}]`);
            if (g.minContrast < 4.5 && !g.gradient) problems.push(`${tag}/${state}: contrast ${g.minContrast} (${g.size}px ${g.family}): ${g.samples.join(" | ")} [${g.sel.join(" ")}]`);
            if (g.family === "Silkscreen" && g.size < 16 && g.chars > 1) problems.push(`${tag}/${state}: pixel type drawn at ${g.size}px (blurs): ${g.samples.join(" | ")} [${g.sel.join(" ")}]`);
          });
          report.broken.forEach((w) => problems.push(`${tag}/${state}: the word "${w}" is broken across two lines`));
        };
        // some music, so the grids are not empty
        for (const [row, step] of [["kick", 0], ["kick", 4], ["kick", 8], ["kick", 12], ["snare", 4], ["snare", 12], ["hihat", 2], ["hihat", 6], ["hihat", 10], ["hihat", 14]]) await tap(`#studio-grid .studio-cell[data-row="${row}"][data-step="${step}"]`);
        await shoot("drums");
        await tap('#studio-stack [data-pick="melody"]');
        await p.waitForTimeout(300);
        for (const [row, step] of [["C4", 0], ["E4", 2], ["G4", 4], ["C5", 6], ["G4", 8], ["E4", 10]]) await tap(`#studio-grid .studio-cell[data-row="${row}"][data-step="${step}"]`);
        await p.waitForTimeout(300);
        await shoot("melody");
        if (!vp.touch) {
          // the docked panel's four panes
          for (const pane of ["sound", "track", "song", "patterns"]) {
            if (await tap(`#studio-tab-${pane}`)) { await p.waitForTimeout(350); await shoot(`pane-${pane}`, "#studio-sound-panel"); }
          }
          await tap("#studio-tab-sound");
          // the other knob groups
          for (const g of ["Filter", "Tone", "Movement"]) if (await tap(`#studio-sound-panel [data-knob-group="${g}"]`)) { await p.waitForTimeout(250); await shoot(`knobs-${g.toLowerCase()}`, "#studio-sound-panel"); }
        } else {
          for (const stop of ["sound", "track", "song", "patterns", "share", "midi"]) {
            if (await tap(`.studio-deck-stop:has-text("${stop}")`)) { await p.waitForTimeout(450); await shoot(`deck-${stop}`); }
          }
          if (await tap("#studio-close")) { await p.waitForTimeout(500); await shoot("shelf"); await tap("#new-song-btn"); await p.waitForTimeout(400); }
        }
        // the search dialog
        await tap("#finder-open");
        await p.waitForTimeout(400);
        await shoot("search");
        ok(errs.length === 0, `${tag}: no page errors`, errs);
        await ctx.close();
      }
    }
    const uniq = [...new Set(problems)];
    fs.writeFileSync(path.join(OUT, "type-report.txt"), lines.join(NL) + NL + (uniq.length ? NL + "PROBLEMS" + NL + uniq.join(NL) + NL : ""));
    ok(uniq.length === 0, "the type is readable everywhere that was photographed (nothing under 12px, nothing under 4.5:1, no blurred pixel type, no broken word)", uniq.slice(0, 12));
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
