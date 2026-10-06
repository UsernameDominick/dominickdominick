// Scans as a page of the site, open to every visitor: a nav tab, a shelf of the visitor's 3D models (kept in this browser), a model file
// opening the scan editor in place under the nav, Scans saving and going back to the shelf, the model served back from this browser,
// open again, download, delete, the editor kept as it was after sliding to another tab and back, nothing sent to the admin API, a phone.
// The 3D viewer comes from a CDN the test machine may not reach, so the model is checked by its bytes, not by its picture.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const fs = require("fs");
const os = require("os");
const path = require("path");
// A tiny valid GLB: one JSON chunk with an empty scene.
function glb() {
  let json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, scenes: [{ nodes: [] }], scene: 0 }));
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const head = Buffer.alloc(12); head.write("glTF", 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length, 8);
  const ch = Buffer.alloc(8); ch.writeUInt32LE(json.length, 0); ch.write("JSON", 4);
  return Buffer.concat([head, ch, json]);
}
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const file = path.join(os.tmpdir(), "qq-scan-" + process.pid + ".glb");
  fs.writeFileSync(file, glb());
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    const errs = []; const adminCalls = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("request", (r) => { if (/\/api\/admin/.test(r.url())) adminCalls.push(r.url()); });
    p.on("dialog", (d) => d.accept());
    const res = await p.goto(E2E_BASE + "/scans");
    ok(res.status() === 200, "/scans is open to everyone", res.status());
    const tab = await p.evaluate(() => { const a = document.querySelector('.site-nav a[href="/scans"]'); return a && [a.textContent.trim(), a.getAttribute("aria-current")]; });
    ok(tab && /scans/i.test(tab[0]) && tab[1] === "page", "the nav has a Scans tab, and it is the current one", tab);
    await p.waitForSelector("#scans-mount .app-native .scan-shelf:not([hidden])", { timeout: 20000 });
    ok((await p.locator(".shelf-empty").count()) === 1, "a shelf with no scans yet");

    // a model from the device opens the editor in place, named after the file
    await p.setInputFiles("#scan-shelf-file", file);
    await p.waitForSelector("#scan-editor-modal:not([hidden])", { timeout: 10000 });
    await p.waitForFunction(() => /\(/.test(document.getElementById("scan-glb-status").textContent), null, { timeout: 10000 });
    const geo = await p.evaluate(() => { const nav = document.querySelector("header.topbar").getBoundingClientRect(); const ed = document.querySelector("#scan-editor-modal > .modal-inner").getBoundingClientRect(); return { navBottom: nav.bottom, top: ed.top, fixed: getComputedStyle(document.getElementById("scan-editor-modal")).position }; });
    ok(geo.top >= geo.navBottom - 1 && geo.fixed !== "fixed", "the editor opens under the site's nav", geo);
    ok(/^qq-scan-/.test(await p.inputValue("#scan-name")), "the scan is named after its file");
    const bytes = await p.evaluate(async () => { const v = document.getElementById("scan-preview-viewer"); const src = v.getAttribute("src") || v.src; const r = await fetch(src); const buf = new Uint8Array(await r.arrayBuffer()); return [r.status, String.fromCharCode(...buf.slice(0, 4))]; });
    ok(bytes[0] === 200 && bytes[1] === "glTF", "the viewer is given the model from this browser", bytes);
    await p.fill("#scan-name", "QQ Visitor Scan");

    // slide away and back: the editor is as it was
    await p.click('.site-nav a[href="/"]');
    await p.waitForFunction(() => location.pathname === "/" && !document.querySelector(".page-stage"), null, { timeout: 10000 });
    ok(await p.evaluate(() => document.getElementById("scan-editor-modal").hidden), "on another tab the editor is put away");
    await p.click('.site-nav a[href="/scans"]');
    await p.waitForFunction(() => location.pathname === "/scans" && !document.querySelector(".page-stage") && !document.getElementById("scan-editor-modal").hidden, null, { timeout: 10000 });
    ok((await p.inputValue("#scan-name")) === "QQ Visitor Scan", "back on Scans, the scan is still open");

    // Scans: saved on the way, back to the shelf
    await p.click("#close-scan-editor");
    await p.waitForSelector(".scan-shelf:not([hidden]) .scan-card", { timeout: 10000 });
    ok((await p.textContent(".scan-card .shelf-name")).includes("QQ Visitor Scan"), "Scans saves the scan in this browser");
    ok(!(await p.isVisible("#scans-modal")), "and the shelf stands for the editor's own list");

    // open it again: its model is still served
    await p.click(".scan-card .shelf-open");
    await p.waitForSelector("#scan-editor-modal:not([hidden])");
    ok((await p.inputValue("#scan-name")) === "QQ Visitor Scan", "a card opens its scan");
    await p.waitForTimeout(300);
    const again = await p.evaluate(async () => { const v = document.getElementById("scan-preview-viewer"); const src = v.getAttribute("src") || v.src; if (!src) return null; const r = await fetch(src); return r.status; });
    ok(again === 200, "a reopened scan still has its model", again);
    await p.click("#close-scan-editor");
    await p.waitForSelector(".scan-shelf:not([hidden])");

    // download, then delete
    const dl = p.waitForEvent("download");
    await p.click('.scan-card [data-act="download"]');
    ok(/\.glb$/.test((await dl).suggestedFilename()), "Download gives the model file");
    await p.click('.scan-card [data-act="delete"]');
    await p.waitForFunction(() => !document.querySelector(".scan-card"));
    ok((await p.locator(".shelf-empty").count()) === 1, "Delete takes it off the shelf");
    ok(adminCalls.length === 0, "nothing was sent to the admin API", adminCalls);
    ok(errs.length === 0, "no page errors", errs);
    await ctx.close();

    // a phone
    const m = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    const merrs = []; mp.on("pageerror", (e) => merrs.push(e.message));
    await mp.goto(E2E_BASE + "/scans");
    await mp.waitForSelector(".scan-shelf:not([hidden])", { timeout: 20000 });
    const shelfOver = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await mp.setInputFiles("#scan-shelf-file", file);
    await mp.waitForSelector("#scan-editor-modal:not([hidden])", { timeout: 10000 });
    await mp.waitForTimeout(300);
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(shelfOver <= 0 && over <= 0, "on a phone nothing runs past the screen", [shelfOver, over]);
    // no room for a side column on a phone: the model on top, the details under it, each as wide as the screen allows
    const lay = await mp.evaluate(() => { const v = document.querySelector(".scan-editor-preview").getBoundingClientRect(); const f = document.querySelector(".scan-editor-fields").getBoundingClientRect(); return { previewTop: v.top, fieldsTop: f.top, previewW: v.width, fieldsW: f.width, vw: innerWidth, back: document.getElementById("close-scan-editor").getBoundingClientRect().height }; });
    ok(lay.previewTop < lay.fieldsTop && lay.previewW >= lay.vw - 2 && lay.fieldsW >= lay.vw - 2, "on a phone the scan editor stacks: the model on top, the details below, both full width", lay);
    ok(lay.back >= 30, "and the Scans button is big enough to tap", lay.back);
    ok(merrs.length === 0, "no page errors on a phone", merrs);
    await m.close();

    const sm = await (await fetch(E2E_BASE + "/sitemap.xml")).text();
    ok(/<loc>[^<]*\/scans<\/loc>/.test(sm), "/scans is in the sitemap");
  } finally {
    await b.close();
    fs.rmSync(file, { force: true });
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
