// The four app pages (Studio, PicEditor, Simulations, Scans) as a visitor uses them, on a phone and on a computer, in dark and light: each
// one on its shelf and again with its editor open. Checks sideways overflow, anything drawn past the screen's edge, the editor sitting
// under the nav, axe accessibility, controls under 24 px, and console or page errors.
// Not a test (the runner only picks up test_*.js): run it by hand and read the report.
//   node tests/e2e/audit/audit-apps.js                 against http://localhost:8787
//   node tests/e2e/audit/audit-apps.js --only Scans    one app
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("../_pw.cjs");

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].toLowerCase() : null;
const APPS = [
  { name: "Studio", path: "/studio", shelf: ".studio-shelf:not([hidden])", opened: "#song-builder-modal:not([hidden]) #studio-stack .studio-card", open: (p) => p.click("#new-song-btn"), editor: "#song-builder-modal > .modal-inner", close: "#studio-close" },
  { name: "PicEditor", path: "/piceditor", shelf: ".pic-shelf:not([hidden])", opened: "#photo-editor-modal:not([hidden])", open: (p) => p.click('.pic-shelf .shelf-chip[data-w="1200"]'), editor: "#photo-editor-modal > .modal-inner", close: "#close-photo-editor" },
  { name: "Simulations", path: "/simulations", shelf: ".sim-shelf:not([hidden])", opened: "#simulation-builder-modal:not([hidden])", open: (p) => p.click("#sim-shelf-new"), editor: "#simulation-builder-modal > .modal-inner", close: "#close-simulation-builder" },
  { name: "Scans", path: "/scans", shelf: ".scan-shelf:not([hidden])", opened: "#scan-editor-modal:not([hidden])", open: (p) => p.evaluate(() => document.getElementById("new-scan-btn").click()), editor: "#scan-editor-modal > .modal-inner", close: "#close-scan-editor" },
].filter((a) => !only || a.name.toLowerCase() === only);
const VIEWPORTS = [
  { name: "phone", viewport: { width: 390, height: 800 }, touch: true },
  { name: "desktop", viewport: { width: 1280, height: 900 }, touch: false },
];

const findings = [];
const add = (sev, area, where, msg) => findings.push({ sev, area, where, msg });

// What to look at in the page right now.
function measure() {
  const vw = innerWidth;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !el.closest("[hidden]") && !el.closest(".sr-only"); };
  const scroller = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && n.scrollWidth > n.clientWidth) return true; } return false; };
  const shell = document.querySelector(".app-native") || document.body;
  const past = [];
  const small = [];
  shell.querySelectorAll("*").forEach((el) => {
    if (!visible(el) || el.closest("svg") || el.closest(".studio-keys, .dial-face")) return;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !scroller(el) && !el.closest("[aria-hidden='true']") && getComputedStyle(el).position !== "fixed") past.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : ""} ${Math.round(r.left)}..${Math.round(r.right)}`);
    if (el.matches("button, a[href], select, input:not([type=hidden]):not([type=range]):not([type=file]), [role=button], [role=tab]")) {
      if ((el.type === "checkbox" || el.type === "radio") && el.closest("label") && el.closest("label").getBoundingClientRect().height >= 24) return;
      if (el.closest("label") && el.matches("input") && el.closest("label").getBoundingClientRect().height >= 24) return;
      if (r.width < 24 || r.height < 24) small.push(`${(el.getAttribute("aria-label") || el.textContent || el.id || el.tagName).trim().replace(/\s+/g, " ").slice(0, 22)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  });
  const nav = document.querySelector("header.topbar").getBoundingClientRect();
  return { overflow: document.documentElement.scrollWidth - vw, past: [...new Set(past)].slice(0, 6), small: [...new Set(small)], navBottom: nav.bottom };
}

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const axe = axeSource();
  for (const app of APPS) {
    for (const vp of VIEWPORTS) {
      for (const scheme of ["dark", "light"]) {
        const ctx = await b.newContext({ viewport: vp.viewport, isMobile: vp.touch, hasTouch: vp.touch, colorScheme: scheme });
        const p = await ctx.newPage();
        const errs = [];
        p.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 140)));
        p.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_CONNECTION|jsdelivr|google|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 140)); });
        await p.addInitScript((s) => { try { localStorage.setItem("theme", s); } catch (e) {} }, scheme);
        for (const state of ["shelf", "editor"]) {
          const where = `${app.name} ${vp.name} ${scheme} ${state}`;
          try {
            if (state === "shelf") {
              await p.goto(E2E_BASE + app.path, { waitUntil: "load" });
              await p.waitForSelector(app.shelf, { timeout: 20000 });
            } else {
              await app.open(p);
              await p.waitForSelector(app.opened, { timeout: 15000 });
            }
            await p.waitForTimeout(500);
            const m = await p.evaluate(measure);
            if (m.overflow > 0) add("high", "layout", where, `the page scrolls sideways by ${m.overflow}px`);
            if (m.past.length) add("med", "layout", where, `drawn past the screen edge: ${m.past.join("; ")}`);
            if (m.small.length && vp.touch) add("low", "ux", where, `${m.small.length} controls under 24px: ${m.small.slice(0, 6).join(", ")}`);
            if (state === "editor") {
              const top = await p.evaluate((sel) => document.querySelector(sel).getBoundingClientRect().top, app.editor);
              if (top < m.navBottom - 1) add("high", "layout", where, `the editor starts at ${Math.round(top)}px, under the nav (ends at ${Math.round(m.navBottom)}px)`);
            }
            await p.addScriptTag({ content: axe }).catch(() => {});
            const ax = await p.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"], resultTypes: ["violations"] })).violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sample: v.nodes.slice(0, 2).map((x) => x.target.join(" ").slice(0, 60)).join(" ; ") }))).catch(() => []);
            for (const v of ax) add(v.impact === "critical" || v.impact === "serious" ? "high" : "med", "a11y", where, `axe ${v.id} (${v.n}): ${v.help} -- ${v.sample}`);
            if (state === "editor") {
              // Esc and the back button leave the editor for the shelf
              await p.click(app.close).catch(() => {});
              await p.waitForSelector(app.shelf, { timeout: 8000 }).catch(() => add("high", "ux", where, `the ${app.close} button does not go back to the shelf`));
            }
          } catch (e) {
            add("high", "audit", where, "could not check: " + String(e.message).split("\n")[0].slice(0, 140));
          }
        }
        for (const e of [...new Set(errs)]) add("high", "errors", `${app.name} ${vp.name} ${scheme}`, e);
        await ctx.close();
      }
    }
  }
  await b.close();

  const order = { high: 0, med: 1, low: 2 };
  const grouped = new Map();
  for (const f of findings) {
    const key = `${f.sev}|${f.area}|${f.msg.replace(/\d+px/g, "Npx")}`;
    if (!grouped.has(key)) grouped.set(key, { ...f, wheres: [] });
    grouped.get(key).wheres.push(f.where);
  }
  const rows = [...grouped.values()].sort((a, c) => order[a.sev] - order[c.sev]);
  const count = (s) => rows.filter((r) => r.sev === s).length;
  console.log(`\n==== ${APPS.length} apps x ${VIEWPORTS.length} screens x 2 themes, shelf and editor: ${count("high")} high, ${count("med")} medium, ${count("low")} low ====\n`);
  for (const r of rows) console.log(`[${r.sev.toUpperCase()}] ${r.area}: ${r.msg}\n        in ${r.wheres.slice(0, 6).join(" | ")}${r.wheres.length > 6 ? ` (+${r.wheres.length - 6})` : ""}`);
  process.exit(count("high") ? 1 : 0);
})();
