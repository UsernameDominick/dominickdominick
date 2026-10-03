const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const phone = async (scheme = "dark") => { const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 390, height: 664 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: scheme }); const p = await ctx.newPage(); p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e))); p.on("dialog", (d) => d.accept()); await p.goto(`${BASE}/admin/`, { waitUntil: "networkidle" }); await p.waitForSelector("#app:not([hidden])"); return p; };
  const vis = (p, id) => p.evaluate((i) => { const e = document.getElementById(i); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, id);
  // ---------- simulation builder ----------
  for (const scheme of ["dark", "light"]) {
    const p = await phone(scheme);
    await p.evaluate(() => document.getElementById("simulations-btn").click()); await p.waitForTimeout(500);
    await p.evaluate(() => document.getElementById("new-simulation-btn").click()); await p.waitForTimeout(800);
    const tag = `[sim ${scheme}]`;
    ok((await Promise.all(["sim-undo", "sim-redo", "save-simulation", "sim-toolbar-more", "sim-preview-power", "sim-warnings-btn"].map((i) => vis(p, i)))).every(Boolean), `${tag} quick bar: Undo, Redo, Save, More, Preview, Warnings visible`);
    ok(!(await vis(p, "sim-reset")) && !(await vis(p, "sim-export")) && !(await vis(p, "sim-poster-url")), `${tag} the rest is tucked away`);
    const m = await p.evaluate(() => { const t = (s) => Math.round(document.querySelector(s).getBoundingClientRect().top); return { canvas: t("#sim-builder-canvas"), palette: t(".sim-palette"), header: Math.round(document.querySelector("header.sim-toolbar").getBoundingClientRect().height) }; });
    ok(m.canvas < 360 && m.header < 260, `${tag} the canvas starts at ${m.canvas}px under a ${m.header}px toolbar (was ~1,200px)`, m);
    const help = await p.evaluate(() => { const d = document.querySelector("#sim-inspector .sim-help-more"); return d ? { open: d.open } : null; });
    ok(help && help.open === false, `${tag} the long help sits in a closed "How breadboards and power work" fold`, help);
    // palette is a single row
    const tops = await p.$$eval(".sim-palette .sim-palette-btn, .sim-palette-recent-btn, #sim-palette-search", (els) => [...new Set(els.filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().top)))]);
    ok(Math.max(...tops) - Math.min(...tops) <= 3, `${tag} the part tray is one row of chips`, tops);
    // recent chips join the same row
    await p.click('.sim-palette-btn[data-sim-type="resistor"]'); await p.waitForTimeout(250); await p.click('.sim-palette-btn[data-sim-type="led"]'); await p.waitForTimeout(250);
    const tops2 = await p.$$eval(".sim-palette .sim-palette-btn, .sim-palette-recent-btn, #sim-palette-search", (els) => [...new Set(els.filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().top)))]);
    const nRecent = await p.$$eval(".sim-palette-recent-btn", (e) => e.length);
    ok(nRecent >= 2 && Math.max(...tops2) - Math.min(...tops2) <= 3, `${tag} recent parts (${nRecent}) sit in the same single row`, tops2);
    // help is folded
    await p.evaluate(() => document.getElementById("simulation-builder-modal").querySelector(".simulation-builder-inner").scrollTo(0, 99999)); await p.waitForTimeout(150);
    // More toggles
    await p.evaluate(() => document.getElementById("simulation-builder-modal").querySelector(".simulation-builder-inner").scrollTo(0, 0));
    await p.click("#sim-toolbar-more"); await p.waitForTimeout(200);
    ok((await vis(p, "sim-reset")) && (await vis(p, "sim-export")) && (await vis(p, "sim-checkpoint-select")) && (await p.getAttribute("#sim-toolbar-more", "aria-expanded")) === "true", `${tag} More shows every tool and reports aria-expanded`);
    await p.click("#sim-toolbar-more"); await p.waitForTimeout(150);
    ok(!(await vis(p, "sim-reset")), `${tag} pressing it again hides them`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1) && p.errs.length === 0, `${tag} no overflow, no page errors`, p.errs);
    await p.context().close();
  }
  // ---------- song builder ----------
  {
    const p = await phone();
    await p.evaluate(() => document.getElementById("songs-btn").click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById("new-song-btn").click()); await p.waitForTimeout(900);
    ok((await Promise.all(["song-undo", "song-redo", "song-play", "save-song", "song-toolbar-more"].map((i) => vis(p, i)))).every(Boolean), "[song] quick bar: Undo, Redo, Play, Save, More visible");
    ok(!(await vis(p, "song-tempo")) && !(await vis(p, "song-kit")) && !(await vis(p, "song-export-audio")) && !(await vis(p, "song-metronome-on")), "[song] tempo, kit, metronome and export are tucked away");
    const seqTop = await p.evaluate(() => { const inner = document.querySelector("#song-builder-modal .modal-inner"); return Math.round(document.getElementById("song-sequencer").getBoundingClientRect().top + inner.scrollTop - inner.getBoundingClientRect().top); });
    ok(seqTop < 520, `[song] the drum grid starts ${seqTop}px down (was ~1,900px)`, seqTop);
    const shown = (id) => p.evaluate((i) => document.getElementById(i).checkVisibility(), id);
    ok(!(await shown("song-preview-embed")) && (await p.evaluate(() => document.getElementById("song-preview-fold").open)) === false, "[song] the preview card and clipping history are folded on a phone");
    await p.click("#song-preview-fold > summary"); await p.waitForTimeout(150);
    ok((await shown("song-preview-embed")) && (await shown("song-clip-section")), "[song] opening the fold shows the preview and clipping history");
    await p.click("#song-preview-fold > summary"); await p.waitForTimeout(100);
    const play = await p.evaluate(() => { const r = document.getElementById("song-play").getBoundingClientRect(); return Math.round(r.height); });
    ok(play <= 44, "[song] Play stays one line", play);
    await p.click("#song-toolbar-more"); await p.waitForTimeout(200);
    ok((await vis(p, "song-tempo")) && (await vis(p, "song-kit")) && (await vis(p, "song-export-audio")) && (await vis(p, "song-metronome-on")), "[song] More shows tempo, kit, metronome and export");
    await p.click("#song-toolbar-more"); await p.waitForTimeout(150);
    // closing and reopening starts collapsed
    await p.click("#song-toolbar-more"); await p.click("#close-song-builder"); await p.waitForTimeout(300);
    await p.evaluate(() => document.getElementById("songs-btn").click()); await p.waitForTimeout(400); await p.evaluate(() => document.getElementById("new-song-btn").click()); await p.waitForTimeout(700);
    ok(!(await vis(p, "song-tempo")), "[song] reopening starts with the extra tools closed");
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1) && p.errs.length === 0, "[song] no overflow, no page errors", p.errs);
    await p.context().close();
  }
  // ---------- critic follow-ups: a11y, focus, continuity hint, 641-860px ----------
  {
    const p = await phone();
    await p.evaluate(() => document.getElementById("simulations-btn").click()); await p.waitForTimeout(500);
    await p.evaluate(() => document.getElementById("new-simulation-btn").click()); await p.waitForTimeout(800);
    const name1 = await p.evaluate(() => document.getElementById("sim-toolbar-more").textContent.replace(/\s+/g, " ").trim());
    await p.click("#sim-toolbar-more"); await p.waitForTimeout(150);
    const nameOpen = await p.evaluate(() => document.getElementById("sim-toolbar-more").textContent.replace(/\s+/g, " ").trim());
    ok(name1.startsWith("More") && nameOpen.startsWith("More") && await p.getAttribute("#sim-toolbar-more .sim-more-caret", "aria-hidden") === "true", "[a11y] the More button keeps its name; only an aria-hidden caret changes", [name1, nameOpen]);
    const tt = await p.evaluate(() => ["sim-zoom-in", "sim-zoom-out", "close-simulation-builder"].map((i) => { const r = document.getElementById(i).getBoundingClientRect(); return [i, Math.round(r.width), Math.round(r.height)]; }).concat([["help", ...(() => { const r = document.querySelector("#simulation-builder-modal .editor-help-btn").getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()]]));
    ok(tt.every(([, w, h]) => w >= 40 && h >= 40), "[touch] zoom, close and help buttons are at least 40px", tt);
    // continuity: closes the panel, focus returns to More, hint is visible and the live regions are still in the tree
    await p.focus("#sim-continuity-test"); await p.click("#sim-continuity-test"); await p.waitForTimeout(250);
    const st = await p.evaluate(() => { const hint = document.getElementById("sim-continuity-result"); const r = hint.getBoundingClientRect(); return { open: document.querySelector(".simulation-builder-inner").classList.contains("sim-more-open"), focus: document.activeElement && document.activeElement.id, hint: hint.textContent, hintVisible: r.width > 50 && r.height > 8 }; });
    ok(!st.open && st.focus === "sim-toolbar-more", "[a11y] auto-close hands focus to the More button, not the page", st);
    ok(/tap two pins/i.test(st.hint) && st.hintVisible, "[ux] continuity mode says what to do while the panel is closed", st);
    const live = await p.evaluate(() => ["sim-view-status", "sim-warnings-live", "sim-save-status", "sim-continuity-result"].map((i) => getComputedStyle(document.getElementById(i)).display));
    ok(live.every((d) => d !== "none"), "[a11y] live regions are not display:none while collapsed", live);
    // find-on-canvas: Enter steps through matches without closing the panel
    await p.click("#sim-toolbar-more"); await p.click("#sim-continuity-test"); await p.waitForTimeout(150); // leave continuity mode (panel auto-closes)
    await p.click('.sim-palette-btn[data-sim-type="resistor"]'); await p.waitForTimeout(250); await p.click('.sim-palette-btn[data-sim-type="resistor"]'); await p.waitForTimeout(250);
    await p.click("#sim-toolbar-more"); await p.waitForTimeout(150);
    await p.fill("#sim-canvas-search", "resistor"); await p.press("#sim-canvas-search", "Enter"); await p.waitForTimeout(250);
    const c1 = await p.evaluate(() => ({ open: document.querySelector(".simulation-builder-inner").classList.contains("sim-more-open"), count: document.getElementById("sim-canvas-search-count").textContent }));
    await p.press("#sim-canvas-search", "Enter"); await p.waitForTimeout(250);
    const c2 = await p.evaluate(() => document.getElementById("sim-canvas-search-count").textContent);
    ok(c1.open && /1 of 2/.test(c1.count) && /2 of 2/.test(c2), "[ux] Enter steps match 1 of 2 then 2 of 2 and keeps the panel open", { c1, c2 });
    await p.context().close();
    // song More: aria-controls resolves to real elements
    const q = await phone();
    await q.evaluate(() => document.getElementById("songs-btn").click()); await q.waitForTimeout(500); await q.evaluate(() => document.getElementById("new-song-btn").click()); await q.waitForTimeout(900);
    const ac = await q.evaluate(() => { const ids = document.getElementById("song-toolbar-more").getAttribute("aria-controls").split(" "); return ids.map((i) => !!document.getElementById(i)); });
    ok(ac.length >= 1 && ac.every(Boolean), "[a11y] song More has aria-controls pointing at real elements", ac);
    await q.context().close();
  }
  for (const [w, h] of [[700, 420], [820, 1180]]) {
    const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: w, height: h }, hasTouch: true, isMobile: true }); const p = await ctx.newPage(); p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e))); p.on("dialog", (d) => d.accept());
    await p.goto(`${BASE}/admin/`, { waitUntil: "networkidle" }); await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("simulations-btn").click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById("new-simulation-btn").click()); await p.waitForTimeout(800);
    const tag = `[sim ${w}x${h}]`;
    const grid = await p.evaluate(() => getComputedStyle(document.querySelector("header.sim-toolbar")).display);
    ok(grid === "flex" && (await Promise.all(["sim-undo", "sim-redo", "save-simulation", "sim-toolbar-more", "sim-preview-power", "sim-warnings-btn", "close-simulation-builder"].map((i) => vis(p, i)))).every(Boolean) && !(await vis(p, "sim-reset")), `${tag} header is the quick bar (flex), not the desktop grid`, grid);
    const hh = await p.evaluate(() => Math.round(document.querySelector("header.sim-toolbar").getBoundingClientRect().height));
    ok(hh < 200, `${tag} the quick bar is ${hh}px tall`, hh);
    await p.click("#sim-toolbar-more"); await p.waitForTimeout(200);
    ok((await vis(p, "sim-reset")) && (await vis(p, "sim-export")), `${tag} More shows every tool`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1) && p.errs.length === 0, `${tag} no overflow, no page errors`, p.errs);
    await p.evaluate(() => document.getElementById("close-simulation-builder").click()); await p.waitForTimeout(300);
    await p.evaluate(() => document.getElementById("songs-btn").click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById("new-song-btn").click()); await p.waitForTimeout(900);
    const sg = await p.evaluate(() => getComputedStyle(document.querySelector("header.song-toolbar")).display);
    ok(sg === "flex" && (await Promise.all(["song-undo", "song-redo", "song-play", "save-song", "song-toolbar-more"].map((i) => vis(p, i)))).every(Boolean) && !(await vis(p, "song-tempo")), `[song ${w}x${h}] header is the quick bar (flex)`, sg);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1) && p.errs.length === 0, `[song ${w}x${h}] no overflow, no page errors`, p.errs);
    await ctx.close();
  }
  // ---------- desktop is unchanged ----------
  {
    const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); await p.goto(`${BASE}/admin/`, { waitUntil: "networkidle" }); await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("simulations-btn").click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById("new-simulation-btn").click()); await p.waitForTimeout(800);
    ok(!(await vis(p, "sim-toolbar-more")) && (await vis(p, "sim-reset")) && (await vis(p, "sim-export")) && (await vis(p, "sim-checkpoint-select")), "[desktop] no More button; every tool is on show as before");
    await p.evaluate(() => document.getElementById("close-simulation-builder").click()); await p.waitForTimeout(300);
    await p.evaluate(() => document.getElementById("songs-btn").click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById("new-song-btn").click()); await p.waitForTimeout(900);
    ok((await vis(p, "song-preview-embed")) && (await vis(p, "song-clip-section")) && !(await vis(p, "song-preview-fold").catch(() => false) && await p.evaluate(() => { const e = document.querySelector("#song-preview-fold > summary"); const r = e.getBoundingClientRect(); return r.width > 0; })), "[desktop] the preview and clipping history are open and the fold summary is hidden");
    await ctx.close();
  }
  await b.close(); console.log(f ? "FAILURES " + f : "ALL PASS"); process.exit(f ? 1 : 0);
})();
