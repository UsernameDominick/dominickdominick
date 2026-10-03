const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("dialog", (d) => d.accept());
  const writes = []; p.on("request", (r) => { const u = new URL(r.url()); if (/^\/api\/admin\//.test(u.pathname) && ["PATCH", "PUT", "POST", "DELETE"].includes(r.method())) writes.push(`${r.method()} ${u.pathname}`); });
  await p.goto(`${BASE}/admin/`); await p.waitForSelector("#app:not([hidden])"); await p.waitForTimeout(800);
  const mark = () => writes.length;
  const since = (n) => writes.slice(n);
  // 1) no modal: saves the open page's settings (unchanged behaviour)
  let n = mark(); await p.keyboard.press("Control+s"); await p.waitForTimeout(500);
  ok(since(n).some((w) => /^(PATCH|PUT) \/api\/admin\/pages\/\d+/.test(w)), "with nothing open on top, Ctrl+S still saves the page settings", since(n));
  // 2) simulation builder: saves the simulation, not the page behind
  await p.click("#simulations-btn"); await p.waitForTimeout(300); await p.click("#new-simulation-btn"); await p.waitForSelector("#simulation-builder-modal:not([hidden])"); await p.waitForTimeout(400);
  await p.fill("#simulation-name", "QQ ctrl-s sim"); await p.click('.sim-palette-btn[data-sim-type="resistor"]'); await p.waitForTimeout(150);
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  n = mark(); await p.keyboard.press("Control+s"); await p.waitForTimeout(700);
  ok(since(n).some((w) => w === "POST /api/admin/simulations") && !since(n).some((w) => /\/pages\//.test(w)), "inside the Simulation builder Ctrl+S saves the simulation and not the page behind it", since(n));
  ok(/Saved/.test(await p.textContent("#sim-save-status")), "and its status says saved", await p.textContent("#sim-save-status"));
  // typing in the name field still works
  await p.focus("#simulation-name"); await p.keyboard.type("!"); n = mark(); await p.keyboard.press("Control+s"); await p.waitForTimeout(600);
  ok(since(n).some((w) => /^PATCH \/api\/admin\/simulations\/\d+/.test(w)) && !since(n).some((w) => /\/pages\//.test(w)), "also from inside a text field (saves the existing simulation)", since(n));
  // an unknown dialog on top of the builder: nothing is saved
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.getElementById("sim-checklist-btn").click()); await p.waitForTimeout(150);
  n = mark(); await p.keyboard.press("Control+s"); await p.waitForTimeout(400);
  ok(since(n).length === 0, "with the build checklist open on top, Ctrl+S saves nothing", since(n));
  await p.click("#close-sim-checklist"); await p.waitForTimeout(100);
  await p.evaluate(() => document.getElementById("close-simulation-builder").click()); await p.waitForTimeout(300);
  await p.evaluate(() => { const c = document.getElementById("close-simulations"); if (c) c.click(); }); await p.waitForTimeout(200);
  // 3) song builder
  await p.click("#songs-btn"); await p.waitForSelector("#songs-modal:not([hidden])"); await p.waitForTimeout(300); await p.click("#new-song-btn"); await p.waitForSelector("#song-builder-modal:not([hidden])"); await p.waitForTimeout(600);
  await p.fill("#song-name", "QQ ctrl-s song"); await p.evaluate(() => document.activeElement && document.activeElement.blur());
  n = mark(); await p.keyboard.press("Control+s"); await p.waitForTimeout(800);
  ok(since(n).some((w) => /songs/.test(w)) && !since(n).some((w) => /\/pages\//.test(w)), "inside the Song builder Ctrl+S saves the song and not the page behind it", since(n));
  await p.evaluate(() => document.getElementById("close-song-builder") && document.getElementById("close-song-builder").click()); await p.waitForTimeout(500);
  // 3b) the Projects editor, and article Focus mode, save too
  const clean = [];
  await p.evaluate(() => { const c = document.getElementById("close-songs"); if (c) c.click(); }); await p.waitForTimeout(200);
  await p.click("#projects-btn"); await p.waitForSelector("#projects-modal:not([hidden])"); await p.waitForTimeout(300); await p.click("#new-project"); await p.waitForTimeout(200);
  await p.fill("#project-title", "QQ ctrl-s project"); await p.evaluate(() => document.activeElement && document.activeElement.blur());
  n = mark(); await p.keyboard.press("Control+s"); await p.waitForTimeout(800);
  ok(since(n).some((w) => /projects/.test(w)) && !since(n).some((w) => /\/pages\//.test(w)), "the Projects editor saves with Ctrl+S", since(n));
  await p.click("#close-projects"); await p.waitForTimeout(200);
  await p.click("#articles-btn"); await p.waitForSelector("#articles-modal:not([hidden])"); await p.waitForTimeout(300); await p.click("#new-article"); await p.waitForTimeout(200);
  await p.fill("#article-title", "QQ ctrl-s article"); await p.fill("#article-body", "Some words for the focus mode test.");
  await p.click('.writing-focus-btn[data-focus-target="article-body"]'); await p.waitForSelector("#writing-focus-overlay:not([hidden])"); await p.waitForTimeout(200);
  n = mark(); await p.keyboard.press("Control+s"); await p.waitForTimeout(800);
  ok(since(n).some((w) => /POST \/api\/admin\/articles/.test(w)), "Focus mode (distraction-free writing) still saves the article", since(n));
  // 3c) Ctrl+Shift+S and Ctrl+Alt+S are left to the browser; holding the key saves once
  const flags = await p.evaluate(() => new Promise((resolve) => { const out = {}; const h = (e) => { out[(e.shiftKey ? "shift" : e.altKey ? "alt" : e.repeat ? "repeat" : "plain")] = e.defaultPrevented; }; window.addEventListener("keydown", h); setTimeout(() => { window.removeEventListener("keydown", h); resolve(out); }, 600); document.dispatchEvent(new KeyboardEvent("keydown", { key: "S", code: "KeyS", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, altKey: true, bubbles: true, cancelable: true })); }));
  ok(flags.shift === false && flags.alt === false, "Ctrl+Shift+S and Ctrl+Alt+S are not intercepted", flags);
  n = mark(); await p.keyboard.press("Control+Shift+S"); await p.waitForTimeout(400);
  ok(since(n).length === 0, "and save nothing", since(n));
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  await p.click("#close-articles"); await p.waitForTimeout(200);
  // 3d) a double or held Ctrl+S on a new simulation creates it once (slow server)
  await p.route("**/api/admin/simulations", async (route) => { if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 700)); await route.continue(); });
  await p.click("#simulations-btn"); await p.waitForTimeout(300); await p.click("#new-simulation-btn"); await p.waitForSelector("#simulation-builder-modal:not([hidden])"); await p.waitForTimeout(400);
  await p.fill("#simulation-name", "QQ ctrl-s sim2"); await p.evaluate(() => document.activeElement && document.activeElement.blur());
  n = mark(); await p.keyboard.press("Control+s"); await p.keyboard.press("Control+s"); await p.keyboard.press("Control+s"); await p.waitForTimeout(1500);
  ok(since(n).filter((w) => w === "POST /api/admin/simulations").length === 1, "three quick Ctrl+S on a new simulation create it once", since(n));
  await p.click("#save-simulation"); await p.click("#save-simulation"); await p.waitForTimeout(1500);
  ok(since(n).filter((w) => w === "POST /api/admin/simulations").length === 1, "and so do repeated clicks of Save", since(n));
  await p.unroute("**/api/admin/simulations");
  await p.evaluate(() => document.getElementById("close-simulation-builder").click()); await p.waitForTimeout(300);
  await p.evaluate(() => { const c = document.getElementById("close-simulations"); if (c) c.click(); }); await p.waitForTimeout(200);
  // 4) shortcuts dialog on top: nothing saved
  await p.keyboard.press("?"); await p.waitForTimeout(150);
  n = mark(); await p.keyboard.press("Control+s"); await p.waitForTimeout(400);
  ok(await p.isVisible("#shortcuts-modal") && since(n).length === 0, "with the shortcuts dialog open Ctrl+S saves nothing", since(n));
  ok(/Save the topmost editor/.test(await p.textContent("#shortcuts-modal")), "the shortcuts list describes the new rule");
  await p.click("#close-shortcuts");
  ok(errs.length === 0, "no page errors", errs);
  await b.close(); console.log(f ? "FAILURES " + f : "ALL PASS"); process.exit(f ? 1 : 0);
})();
