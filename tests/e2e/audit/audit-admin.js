// A broad check of the admin console, tool by tool: opens every sidebar tool and checks the dialog it shows for accessibility (axe),
// sideways overflow, console errors, tap-target size, squeezed fields, focus handling and Esc-to-close, on desktop and a phone, dark
// and light. Each tool is checked on its first screen and then in its deeper states: every tab, the first item's editor, and every
// collapsed section opened. It only opens and closes things (nothing is saved), but it does talk to the server, so point it at a
// local one. Not a test (the runner only picks up test_*.js): run it by hand and read the report.
//   node tests/e2e/audit/audit-admin.js                      against http://localhost:8787 (signs in with .dev.vars, never printed)
//   ADMIN_STATE=state.json E2E_BASE=http://localhost:8800 node tests/e2e/audit/audit-admin.js
//   node tests/e2e/audit/audit-admin.js --only media-btn,site-settings-btn      just those tools
//   node tests/e2e/audit/audit-admin.js --json out.json      also write the raw findings
const fs = require("fs");
const path = require("path");
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("../_pw.cjs");
const pw = require("playwright");

const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const findings = [];
const add = (sev, area, tool, vp, msg) => findings.push({ sev, area, tool, vp, msg });

// Every tool in the sidebar and the top bar that opens a window.
const TOOLS = [
  "media-btn", "features-btn", "site-settings-btn", "command-btn",
].filter((id) => !only || only.includes(id));
// Dropdown panels (not dialogs): the button, and the panel it opens. The slim admin has none.
const PANELS = {};

// Outside hosts the sandbox cannot reach (the 3D viewer script comes from a CDN) are not the admin's fault.
const IGNORED_CONSOLE = /favicon|Failed to load resource.*(404|429)|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|status of 502/;

async function signIn() {
  if (process.env.ADMIN_STATE) return process.env.ADMIN_STATE;
  let pass = process.env.ADMIN_PASSWORD;
  if (!pass) {
    const vars = fs.readFileSync(path.join(__dirname, "../../../.dev.vars"), "utf8");
    pass = ((vars.match(/^ADMIN_PASSWORD=(.*)$/m) || [])[1] || "").replace(/^["']|["']$/g, "");
  }
  const ctx = await pw.request.newContext({ baseURL: E2E_BASE });
  const res = await ctx.post("/api/admin/login", { data: { password: pass } });
  if (res.status() !== 200) throw new Error(`sign-in failed (HTTP ${res.status()})`);
  const file = path.join(require("os").tmpdir(), `audit-admin-state-${process.pid}.json`);
  await ctx.storageState({ path: file });
  await ctx.dispose();
  return file;
}

// Runs inside the page: the topmost open dialog and what is wrong with it right now.
function readTopDialog() {
  const open = [...document.querySelectorAll(".modal:not([hidden])")];
  const top = open[open.length - 1];
  if (!top) return null;
  const inner = top.querySelector(":scope > *") || top;
  const innerBox = inner.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const closer = top.querySelector("[id^=close-], button[aria-label^=Close], button[aria-label^=close]");
  const small = [];
  for (const el of top.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,summary")) {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!b.width || !b.height || cs.visibility === "hidden" || el.disabled) continue;
    if (cs.display === "inline" && el.tagName === "A" && el.closest("p,li,td")) continue;
    if ((el.type === "checkbox" || el.type === "radio") && el.closest("label") && el.closest("label").getBoundingClientRect().height >= 24) continue;
    if (b.width < 24 || b.height < 24) small.push((el.textContent || el.getAttribute("aria-label") || el.id || el.tagName).trim().slice(0, 24) + ` ${Math.round(b.width)}x${Math.round(b.height)}`);
  }
  const squeezed = [];
  for (const el of top.querySelectorAll("input:not([type]), input[type=text], input[type=url], input[type=search], input[type=email], input[type=number], textarea, select")) {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0 && b.width < 40 && getComputedStyle(el).visibility !== "hidden") squeezed.push(`${el.id || el.getAttribute("aria-label") || el.name || el.tagName} ${Math.round(b.width)}px wide`);
  }
  return {
    id: top.id || "(no id)",
    role: top.getAttribute("role"),
    named: !!(top.getAttribute("aria-label") || top.getAttribute("aria-labelledby")),
    hasCloser: !!closer,
    inside: top.contains(document.activeElement),
    left: Math.round(innerBox.left),
    innerRight: Math.round(innerBox.right),
    vw,
    docSw: document.documentElement.scrollWidth,
    small: small.slice(0, 40),
    squeezed: squeezed.slice(0, 6),
  };
}

(async () => {
  const state = await signIn();
  const b = await chromium.launch();
  const axe = axeSource();
  console.log(`Auditing ${TOOLS.length} admin tools on ${E2E_BASE}\n`);

  for (const [w, h, scheme] of [[1280, 900, "dark"], [1280, 900, "light"], [390, 800, "dark"], [390, 800, "light"]]) {
    const vp = `${w}${scheme[0]}`;
    const phone = w < 500;
    const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: phone, isMobile: phone });
    const p = await ctx.newPage();
    let current = "shell";
    p.on("dialog", (d) => (d.type() === "prompt" ? d.dismiss() : d.accept()).catch(() => {}));
    p.on("pageerror", (e) => add("high", "console", current, vp, `script error: ${e.message.slice(0, 140)}`));
    p.on("console", (m) => { if (m.type() === "error" && !IGNORED_CONSOLE.test(m.text())) add("high", "console", current, vp, `console error: ${m.text().slice(0, 140)}`); });
    await p.goto(E2E_BASE + "/admin/", { waitUntil: "networkidle" });
    await p.waitForSelector("#app:not([hidden])", { timeout: 15000 });
    await p.evaluate((t) => { try { localStorage.setItem("admin-theme", t); } catch (e) { /* no storage */ } document.documentElement.setAttribute("data-theme", t); }, scheme);
    await p.addScriptTag({ content: axe });
    const settle = async () => {
      await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, { timeout: 3000 }).catch(() => {});
      await p.waitForTimeout(250);
    };
    await settle();

    const axeOn = async (selector) => p.evaluate(async (sel) => {
      const root = sel ? document.querySelector(sel) : document;
      if (!root) return [];
      return (await axe.run(root, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"], resultTypes: ["violations"] })).violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.target.join(" ").slice(0, 80)).join(" ; "), help: v.help }));
    }, selector);
    const sevOf = (impact) => (impact === "critical" || impact === "serious" ? "med" : "low");

    // Checks the topmost dialog in whatever state it is in now. Collapsed sections are opened first so their controls are checked too.
    const inspect = async (label, firstScreen) => {
      await p.evaluate(() => { const o = [...document.querySelectorAll(".modal:not([hidden])")]; const t = o[o.length - 1]; if (t) t.querySelectorAll("details").forEach((d) => { d.open = true; }); });
      await settle();
      const info = await p.evaluate(readTopDialog);
      if (!info) { if (firstScreen) add("low", "ux", label, vp, "nothing opened (a toggle, a panel or a button that needs a page open)"); return null; }
      if (firstScreen && info.role !== "dialog") add("med", "a11y", label, vp, `#${info.id} is not role="dialog"`);
      if (firstScreen && !info.named) add("med", "a11y", label, vp, `#${info.id} has no accessible name (aria-label or aria-labelledby)`);
      if (firstScreen && !info.hasCloser) add("med", "ux", label, vp, `#${info.id} has no close button`);
      if (firstScreen && !phone && !info.inside) add("med", "a11y", label, vp, `#${info.id}: keyboard focus did not move into the dialog`);
      if (info.innerRight > info.vw + 1 || info.left < -1) add("med", "layout", label, vp, `#${info.id} runs past the screen edge (left ${info.left}, right ${info.innerRight}, window ${info.vw})`);
      if (info.docSw > info.vw + 1) add("high", "layout", label, vp, `#${info.id} makes the whole admin scroll sideways (${info.docSw}px in ${info.vw}px)`);
      if (info.squeezed.length) add("med", "layout", label, vp, `#${info.id}: fields squeezed to almost nothing: ${info.squeezed.join(", ")}`);
      if (phone && info.small.length) add("low", "ux", label, vp, `#${info.id}: ${info.small.length} controls under 24px: ${info.small.slice(0, 5).join(", ")}`);
      for (const v of await axeOn(`#${info.id}`)) add(sevOf(v.impact), "a11y", label, vp, `${v.id}: ${v.help} (${v.n}) ${v.sample}`);
      return info;
    };

    // The deeper states of the open dialog: each tab, the first item's editor, a media item's details.
    const deeperStates = (tool) => p.evaluate((t) => {
      const open = [...document.querySelectorAll(".modal:not([hidden])")];
      const top = open[open.length - 1];
      if (!top) return [];
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const tabs = [...top.querySelectorAll('[role="tab"], .settings-tab, [data-panel]')].filter((e) => e.tagName === "BUTTON" && vis(e) && !e.classList.contains("is-active") && e.getAttribute("aria-selected") !== "true");
      const out = tabs.map((e, i) => ({ kind: "tab", index: i, label: (e.textContent || e.dataset.panel || "tab").trim().slice(0, 20) }));
      if (t === "media-btn") out.push({ kind: "media-info", label: "details" });
      return out;
    }, tool);
    const enterState = (st) => p.evaluate((s) => {
      const open = [...document.querySelectorAll(".modal:not([hidden])")];
      const top = open[open.length - 1];
      if (!top) return false;
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      let target = null;
      if (s.kind === "tab") target = [...top.querySelectorAll('[role="tab"], .settings-tab, [data-panel]')].filter((e) => e.tagName === "BUTTON" && vis(e) && !e.classList.contains("is-active") && e.getAttribute("aria-selected") !== "true")[s.index];
      else if (s.kind === "first-item") target = top.querySelector(".article-list-item");
      else if (s.kind === "media-info") target = top.querySelector(".media-item .media-info");
      else if (s.kind === "click-id") target = document.getElementById(s.id);
      if (!target) return false;
      target.click();
      return true;
    }, st);

    // the admin with nothing open
    for (const v of await axeOn(null)) add(sevOf(v.impact), "a11y", "shell", vp, `${v.id}: ${v.help} (${v.n}) ${v.sample}`);
    const sw = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
    if (sw.sw > sw.vw + 1) add("high", "layout", "shell", vp, `the admin scrolls sideways: ${sw.sw}px wide in a ${sw.vw}px window`);

    for (const id of TOOLS) {
      current = id;
      await p.evaluate(() => document.querySelectorAll(".modal:not([hidden]) [id^=close-]").forEach((x) => x.click())).catch(() => {});
      await p.waitForTimeout(150);
      if (!(await p.evaluate((i) => !!document.getElementById(i), id))) { add("low", "audit", id, vp, "button not found (the audit list is out of date)"); continue; }
      if (!phone) await p.focus(`#${id}`).catch(() => {});
      await p.evaluate((i) => document.getElementById(i).click(), id);
      await p.waitForTimeout(700);
      await settle();
      if (PANELS[id]) {
        const panelId = PANELS[id];
        // on a phone the sidebar, and the Recent button in it, is a drawer that has to be opened first
        const inDrawer = phone && id === "recent-items-btn";
        if (inDrawer) { await p.evaluate(() => document.getElementById("site-menu-btn").click()); await p.waitForTimeout(500); await settle(); }
        if (inDrawer) { await p.evaluate((i) => { const pn = document.getElementById("recent-items-panel"); if (!pn.classList.contains("open")) document.getElementById(i).click(); }, id); await p.waitForTimeout(500); await settle(); }
        const st = await p.evaluate(({ b2, pid }) => { const pn = document.getElementById(pid); const btn = document.getElementById(b2); const r = pn.getBoundingClientRect(); return { open: pn.classList.contains("open"), expanded: btn.getAttribute("aria-expanded"), left: Math.round(r.left), right: Math.round(r.right), vw: document.documentElement.clientWidth, visible: r.width > 0 && r.height > 0 }; }, { b2: id, pid: panelId });
        if (!st.open || !st.visible) add("med", "ux", id, vp, `#${panelId} did not open`);
        if (st.expanded !== "true") add("med", "a11y", id, vp, `${id} says aria-expanded="${st.expanded}" while its panel is open`);
        if (st.left < -1 || st.right > st.vw + 1) add("med", "layout", id, vp, `#${panelId} runs past the screen edge (left ${st.left}, right ${st.right}, window ${st.vw})`);
        for (const v of await axeOn(`#${panelId}`)) add(sevOf(v.impact), "a11y", id, vp, `${v.id}: ${v.help} (${v.n}) ${v.sample}`);
        if (!phone && scheme === "dark") {
          await p.keyboard.press("Escape");
          await p.waitForTimeout(300);
          const after = await p.evaluate(({ b2, pid }) => ({ open: document.getElementById(pid).classList.contains("open"), expanded: document.getElementById(b2).getAttribute("aria-expanded") }), { b2: id, pid: panelId });
          if (after.open) add("med", "ux", id, vp, `#${panelId} does not close with Esc`);
          else if (after.expanded !== "false") add("med", "a11y", id, vp, `${id} still says aria-expanded="${after.expanded}" after its panel closed`);
        } else {
          await p.evaluate((pid) => document.getElementById(pid).classList.remove("open"), panelId);
        }
        if (inDrawer) { await p.evaluate(() => { const c = document.getElementById("close-site-menu"); if (c) c.click(); }); await p.waitForTimeout(400); }
        continue;
      }
      const info = await inspect(id, true);
      if (!info) continue;

      // deeper states of the same dialog
      for (const st of (await deeperStates(id)).slice(0, 14)) {
        if (!(await enterState(st))) continue;
        await p.waitForTimeout(500);
        await settle();
        await inspect(`${id} › ${st.label}`, false);
      }

      // a deeper state can open a second dialog on top (a media item's details): close those so the one under is the top again
      for (let i = 0; i < 4; i++) {
        const stillOver = await p.evaluate((mid) => { const o = [...document.querySelectorAll(".modal:not([hidden])")]; const t = o[o.length - 1]; if (!t || t.id === mid) return false; const c = t.querySelector("[id^=close-]"); if (c) c.click(); else t.hidden = true; return true; }, info.id);
        if (!stillOver) break;
        await p.waitForTimeout(250);
      }

      // Esc closes the top dialog, and focus goes back to the button that opened it (desktop, once per tool). Focus is moved off any
      // text box first: inside the code editor Esc deliberately means "let Tab leave", not "close".
      if (!phone && scheme === "dark") {
        await p.evaluate((mid) => { const m = document.getElementById(mid); if (m) { const h = m.querySelector("h1"); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); if (h) h.focus(); } }, info.id);
        await p.keyboard.press("Escape");
        await p.waitForTimeout(400);
        const after = await p.evaluate((mid) => { const m = document.getElementById(mid); return { open: !!m && !m.hidden && getComputedStyle(m).display !== "none", active: document.activeElement && (document.activeElement.id || document.activeElement.tagName) }; }, info.id);
        if (after.open) add("med", "ux", id, vp, `#${info.id} does not close with Esc`);
        else if (after.active !== id && !/^(command|notifications)-btn$/.test(id)) add("low", "a11y", id, vp, `after closing #${info.id}, focus went to ${after.active}, not back to the ${id} button`);
      }
    }
    await ctx.close();
  }
  await b.close();
  if (!process.env.ADMIN_STATE) fs.rmSync(state, { force: true });

  // ---- report: each distinct finding once, with where it happened
  const groups = new Map();
  for (const f of findings) {
    const key = `${f.sev}|${f.area}|${f.msg}`;
    if (!groups.has(key)) groups.set(key, { ...f, where: new Set() });
    groups.get(key).where.add(`${f.tool}@${f.vp}`);
  }
  const order = { high: 0, med: 1, low: 2 };
  const list = [...groups.values()].sort((a, c) => order[a.sev] - order[c.sev] || a.area.localeCompare(c.area));
  const count = (s) => list.filter((x) => x.sev === s).length;
  console.log(`\n==== ${list.length} distinct findings: ${count("high")} high, ${count("med")} medium, ${count("low")} low ====\n`);
  for (const f of list) {
    const where = [...f.where];
    console.log(`[${f.sev.toUpperCase()}] ${f.area}: ${f.msg}\n        on ${where.slice(0, 6).join(", ")}${where.length > 6 ? ` and ${where.length - 6} more` : ""}`);
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(findings, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
