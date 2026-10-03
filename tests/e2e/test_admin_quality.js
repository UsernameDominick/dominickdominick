// Fixes from the admin console quality pass: dialog focus after the Diagnostics scan and after a builder hands back to its list,
// labelled journal fields, keyboard-reachable scrolling result lists, light-theme contrast on accent-coloured controls, and the
// phone sizes (24px checkboxes, an image-address field that is not squeezed away).
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
(async () => {
  const b = await chromium.launch();
  const axe = axeSource();
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const open = async (opts = {}) => {
    const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1280, height: 900 }, ...opts });
    const p = await ctx.newPage();
    p.on("dialog", (d) => d.accept().catch(() => {}));
    await p.goto(E2E_BASE + "/admin/", { waitUntil: "networkidle" });
    await p.waitForSelector("#app:not([hidden])");
    await p.addScriptTag({ content: axe });
    return { ctx, p };
  };
  const settle = async (p) => {
    await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, { timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(250);
  };
  const topId = (p) => p.evaluate(() => { const o = [...document.querySelectorAll(".modal:not([hidden])")]; const t = o[o.length - 1]; return t ? t.id : null; });
  const activeId = (p) => p.evaluate(() => (document.activeElement ? document.activeElement.id || document.activeElement.tagName : null));
  const setTheme = (p, t) => p.evaluate((t2) => document.documentElement.setAttribute("data-theme", t2), t);

  // ---- the Diagnostics window keeps keyboard focus once its scan finishes
  {
    const { ctx, p } = await open();
    await p.focus("#diagnostics-btn");
    await p.keyboard.press("Enter");
    await p.waitForTimeout(4500); // the scan loads the real page in a hidden frame and takes a moment
    ok((await topId(p)) === "diagnostics-modal" && (await activeId(p)) === "diagnostics-modal-title", "Diagnostics: keyboard focus is still in the dialog after the scan finishes", { top: await topId(p), active: await activeId(p) });
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
    ok((await activeId(p)) === "diagnostics-btn", "…and closing it returns focus to the Diagnostics button", await activeId(p));
    await ctx.close();
  }

  // ---- a list that hands over to its builder: closing both lands back on the button that started it
  {
    const { ctx, p } = await open();
    for (const [btn, newBtn, builder] of [["simulations-btn", "new-simulation-btn", "simulation-builder-modal"], ["scans-btn", "new-scan-btn", "scan-editor-modal"], ["songs-btn", "new-song-btn", "song-builder-modal"]]) {
      await p.focus("#" + btn); await p.keyboard.press("Enter"); await p.waitForTimeout(700);
      await p.focus("#" + newBtn); await p.keyboard.press("Enter"); await p.waitForTimeout(900);
      const inBuilder = await topId(p);
      await p.keyboard.press("Escape"); await p.waitForTimeout(600);
      const backInList = await topId(p);
      await p.keyboard.press("Escape"); await p.waitForTimeout(600);
      ok(inBuilder === builder && backInList === btn.replace("-btn", "-modal") && (await topId(p)) === null && (await activeId(p)) === btn, `${btn}: list → builder → Esc → Esc puts focus back on the ${btn} button`, { inBuilder, backInList, active: await activeId(p) });
    }
    await ctx.close();
  }

  // ---- the build journal's date and type fields have names
  {
    const { ctx, p } = await open();
    await p.evaluate(() => document.getElementById("projects-btn").click());
    await p.waitForTimeout(700);
    await p.evaluate(() => { const i = document.querySelector("#projects-modal .article-list-item"); if (i) i.click(); });
    await p.waitForTimeout(600);
    await p.evaluate(() => document.querySelectorAll("#projects-modal details").forEach((d) => { d.open = true; }));
    const labels = await p.evaluate(() => ({ date: document.getElementById("journal-entry-date").getAttribute("aria-label"), type: document.getElementById("journal-entry-type").getAttribute("aria-label") }));
    ok(!!labels.date && !!labels.type, "the build journal's date and type fields are labelled", labels);
    const v = await p.evaluate(async () => (await axe.run(document.getElementById("projects-modal"), { runOnly: ["label", "select-name"], resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")));
    ok(v.length === 0, "the project editor has no unlabelled fields", v);
    await ctx.close();
  }

  // ---- a result list that scrolls can be reached with the keyboard, and one that does not scroll adds no tab stop
  {
    const { ctx, p } = await open();
    await p.evaluate(() => document.getElementById("site-settings-btn").click());
    await p.waitForTimeout(700);
    await p.evaluate(() => document.querySelector('#settings-modal .settings-tab[data-panel="logs"]').click());
    await p.waitForTimeout(500);
    await p.evaluate(() => { const box = document.getElementById("activity-log-list"); box.innerHTML = Array.from({ length: 80 }, (_, i) => `<div>QQ entry ${i}</div>`).join(""); });
    await p.waitForTimeout(400);
    const scrolling = await p.evaluate(() => { const e = document.getElementById("activity-log-list"); return { tab: e.getAttribute("tabindex"), role: e.getAttribute("role"), label: e.getAttribute("aria-label"), overflows: e.scrollHeight > e.clientHeight }; });
    ok(scrolling.overflows && scrolling.tab === "0" && scrolling.role === "region" && /activity/i.test(scrolling.label || ""), "a scrolling log list is a focusable, named region", scrolling);
    const axeScroll = await p.evaluate(async () => (await axe.run(document.getElementById("activity-log-list"), { runOnly: ["scrollable-region-focusable"], resultTypes: ["violations"] })).violations.length);
    ok(axeScroll === 0, "…and axe no longer reports it", axeScroll);
    await p.evaluate(() => { document.getElementById("activity-log-list").innerHTML = "<div>QQ one short entry</div>"; });
    await p.waitForTimeout(400);
    const short = await p.evaluate(() => { const e = document.getElementById("activity-log-list"); return { tab: e.getAttribute("tabindex"), role: e.getAttribute("role") }; });
    ok(short.tab === null && short.role === null, "a short list is not a tab stop", short);
    await ctx.close();
  }

  // ---- light theme: accent-coloured controls and the outline error text meet 4.5:1
  {
    const { ctx, p } = await open({ colorScheme: "light" });
    await setTheme(p, "light");
    for (const [btn, modal, label] of [["topic-pages-btn", "topic-pages-modal", "Topic Pages"], ["analytics-btn", "analytics-modal", "Analytics"], ["site-settings-btn", "settings-modal", "Settings"], ["preview-btn", "preview-modal", "Screen Preview"]]) {
      await p.evaluate((i) => document.getElementById(i).click(), btn);
      await p.waitForTimeout(800);
      await settle(p);
      const v = await p.evaluate(async (m) => (await axe.run(document.getElementById(m), { runOnly: ["color-contrast"], resultTypes: ["violations"] })).violations.flatMap((x) => x.nodes.map((n) => n.target.join(" ").slice(0, 60))), modal);
      ok(v.length === 0, `light theme: ${label} has no contrast failures`, v);
      await p.evaluate(() => { const c = [...document.querySelectorAll(".modal:not([hidden]) [id^=close-]")].pop(); if (c) c.click(); });
      await p.waitForTimeout(300);
    }
    await ctx.close();
  }

  // ---- the outline's "could not load" message is readable in both themes (the request is answered with a 502 here, so nothing
  // goes out to GitHub; it is what the real route sends when GitHub cannot be reached)
  for (const theme of ["dark", "light"]) {
    const { ctx, p } = await open({ colorScheme: theme });
    await p.route("**/api/admin/outline", (route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "QQ could not reach the repository" }) }));
    await setTheme(p, theme);
    await p.evaluate(() => document.getElementById("site-settings-btn").click());
    await p.waitForTimeout(700);
    await p.evaluate(() => document.querySelector('#settings-modal .settings-tab[data-panel="outline"]').click());
    await p.waitForFunction(() => document.getElementById("outline-status").classList.contains("is-error"), null, { timeout: 5000 }).catch(() => {});
    await settle(p);
    const shown = await p.evaluate(() => document.getElementById("outline-status").className);
    const bad = await p.evaluate(async () => (await axe.run(document.getElementById("outline-status"), { runOnly: ["color-contrast"], resultTypes: ["violations"] })).violations.length);
    ok(/is-error/.test(shown) && bad === 0, `${theme} theme: the outline's error message is readable`, { shown, bad });
    await ctx.close();
  }

  // ---- on a phone: 24px checkboxes and an image-address field with room to type
  {
    const { ctx, p } = await open({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    await p.evaluate(() => document.getElementById("articles-btn").click());
    await p.waitForTimeout(700);
    const boxes = await p.evaluate(() => [...document.querySelectorAll("#articles-modal input[type=checkbox]")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => Math.round(e.getBoundingClientRect().width) + "x" + Math.round(e.getBoundingClientRect().height)));
    ok(boxes.length > 0 && boxes.every((s) => { const [w, h] = s.split("x").map(Number); return w >= 24 && h >= 24; }), "phone: the article list's checkboxes are at least 24px", boxes.slice(0, 5));
    await p.evaluate(() => document.getElementById("close-articles").click());
    await p.waitForTimeout(300);
    await p.evaluate(() => document.getElementById("projects-btn").click());
    await p.waitForTimeout(700);
    await p.evaluate(() => { const i = document.querySelector("#projects-modal .article-list-item"); if (i) i.click(); });
    await p.waitForTimeout(600);
    await p.evaluate(() => document.querySelectorAll("#projects-modal details").forEach((d) => { d.open = true; }));
    await p.waitForTimeout(300);
    const field = await p.evaluate(() => { const i = document.getElementById("project-og-image"); const r = i.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
    ok(field.w >= 200 && field.h >= 24, "phone: the share-image address field is wide enough to use", field);
    const preview = await p.evaluate(() => { const a = document.getElementById("preview-project-link"); a.hidden = false; return Math.round(a.getBoundingClientRect().height); });
    ok(preview >= 24, "phone: the Preview link is at least 24px tall", preview);
    await ctx.close();
  }

  await b.close();
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
