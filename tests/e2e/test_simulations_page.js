// Simulations as a page of the site, open to every visitor: a nav tab, a shelf of the visitor's circuits (kept in this browser), the
// circuit builder opening in place under the nav, Circuits saving and going back to the shelf, open again, copy, delete, a circuit file
// opened from the device, the builder kept as it was after sliding to another tab and back, nothing sent to the admin API, a phone.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const fs = require("fs");
const os = require("os");
const path = require("path");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const file = path.join(os.tmpdir(), "qq-circuit-" + process.pid + ".json");
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    const errs = []; const adminCalls = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("request", (r) => { if (/\/api\/admin/.test(r.url())) adminCalls.push(r.url()); });
    p.on("dialog", (d) => d.accept());
    const stored = () => p.evaluate(() => JSON.parse(localStorage.getItem("simulations.circuits.v1") || "[]"));
    const res = await p.goto(E2E_BASE + "/simulations");
    ok(res.status() === 200, "/simulations is open to everyone", res.status());
    const tab = await p.evaluate(() => { const a = document.querySelector('.site-nav a[href="/simulations"]'); return a && [a.textContent.trim(), a.getAttribute("aria-current")]; });
    ok(tab && /^sim$/i.test(tab[0]) && tab[1] === "page", "the nav has a Sim tab, and it is the current one", tab);
    await p.waitForSelector("#simulations-mount .app-native .sim-shelf:not([hidden])", { timeout: 20000 });
    ok((await p.locator(".shelf-empty").count()) === 1, "a shelf with no circuits yet");

    // a new circuit opens in place
    await p.click("#sim-shelf-new");
    await p.waitForSelector("#simulation-builder-modal:not([hidden])", { timeout: 10000 });
    const geo = await p.evaluate(() => { const nav = document.querySelector("header.topbar").getBoundingClientRect(); const ed = document.querySelector("#simulation-builder-modal > .modal-inner").getBoundingClientRect(); return { navBottom: nav.bottom, top: ed.top, fixed: getComputedStyle(document.getElementById("simulation-builder-modal")).position }; });
    ok(geo.top >= geo.navBottom - 1 && geo.fixed !== "fixed", "the builder opens under the site's nav", geo);
    ok(!(await p.isVisible("#sim-poster-row")), "no share-image row (that is for the site's own circuits)");
    await p.fill("#simulation-name", "QQ Visitor Circuit");
    for (const t of ["battery", "led"]) await p.evaluate((s) => document.querySelector(`.sim-palette-btn[data-sim-type="${s}"]`).click(), t);
    await p.waitForTimeout(200);

    // slide away and back: the builder is as it was
    await p.click('.site-nav a[href="/"]');
    await p.waitForFunction(() => location.pathname === "/" && !document.querySelector(".page-stage"), null, { timeout: 10000 });
    ok(await p.evaluate(() => document.getElementById("simulation-builder-modal").hidden), "on another tab the builder is put away (its shortcuts sleep)");
    await p.click('.site-nav a[href="/simulations"]');
    await p.waitForFunction(() => location.pathname === "/simulations" && !document.querySelector(".page-stage") && !document.getElementById("simulation-builder-modal").hidden, null, { timeout: 10000 });
    ok((await p.inputValue("#simulation-name")) === "QQ Visitor Circuit", "back on Simulations, the circuit is still open");

    // Circuits: saved on the way, back to the shelf
    await p.click("#close-simulation-builder");
    await p.waitForSelector(".sim-shelf:not([hidden]) .sim-card", { timeout: 10000 });
    let list = await stored();
    ok(list.length === 1 && list[0].name === "QQ Visitor Circuit" && list[0].data.components.length === 2, "Circuits saves the circuit in this browser", list);
    ok(!(await p.isVisible("#simulations-modal")), "and the shelf stands for the builder's own list");
    ok(/2 parts/.test(await p.textContent(".sim-card .shelf-when")) && (await p.locator(".sim-card .sim-thumb rect").count()) === 2, "its card shows its parts");

    // open it again
    await p.click(".sim-card .shelf-open");
    await p.waitForSelector("#simulation-builder-modal:not([hidden])");
    ok((await p.inputValue("#simulation-name")) === "QQ Visitor Circuit", "a card opens its circuit");
    await p.click("#close-simulation-builder");
    await p.waitForSelector(".sim-shelf:not([hidden])");

    // copy and delete
    await p.click('.sim-card [data-act="copy"]');
    await p.waitForFunction(() => document.querySelectorAll(".sim-card").length === 2);
    await p.locator(".sim-card", { hasText: "(copy)" }).locator('[data-act="delete"]').click();
    await p.waitForFunction(() => document.querySelectorAll(".sim-card").length === 1);
    ok((await stored()).length === 1, "Copy and Delete work on the shelf");

    // a circuit file from the device
    fs.writeFileSync(file, JSON.stringify({ name: "QQ From File", data: list[0].data }));
    await p.setInputFiles("#sim-shelf-file", file);
    await p.waitForSelector("#simulation-builder-modal:not([hidden])", { timeout: 10000 });
    ok((await p.inputValue("#simulation-name")) === "QQ From File" && (await stored()).length === 2, "Open a circuit file adds it and opens it");
    ok(adminCalls.length === 0, "nothing was sent to the admin API", adminCalls);
    ok(errs.length === 0, "no page errors", errs);
    await ctx.close();

    // a phone
    const m = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    const merrs = []; mp.on("pageerror", (e) => merrs.push(e.message));
    await mp.goto(E2E_BASE + "/simulations");
    await mp.waitForSelector(".sim-shelf:not([hidden])", { timeout: 20000 });
    const shelfOver = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await mp.tap("#sim-shelf-new");
    await mp.waitForSelector("#simulation-builder-modal:not([hidden])", { timeout: 10000 });
    await mp.waitForTimeout(300);
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(shelfOver <= 0 && over <= 0, "on a phone nothing runs past the screen", [shelfOver, over]);
    ok(merrs.length === 0, "no page errors on a phone", merrs);
    await m.close();

    const sm = await (await fetch(E2E_BASE + "/sitemap.xml")).text();
    ok(/<loc>[^<]*\/simulations<\/loc>/.test(sm), "/simulations is in the sitemap");
  } finally {
    await b.close();
    fs.rmSync(file, { force: true });
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
