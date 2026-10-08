// PicEditor as a page of the site, open to every visitor: a nav tab, a shelf of the visitor's pictures (kept in this browser), the photo
// editor opening in place under the nav, Save as new and Save kept here (nothing sent to the admin API), copy and delete, the editor
// still holding its work after sliding to another tab and back, and a phone width that fits.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { toShelf } = require("./_shelf.cjs");
const { chromium } = require("./_pw.cjs");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
// A small gradient PNG to open.
function png(w, h) {
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const b of buf) x = t[(x ^ b) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = []; for (let y = 0; y < h; y++) { rows.push(0); for (let x = 0; x < w; x++) rows.push((x * 255 / w) | 0, (y * 255 / h) | 0, 200); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
}
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const file = path.join(os.tmpdir(), "qq-pic-" + process.pid + ".png");
  fs.writeFileSync(file, png(160, 100));
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    const ctx = await b.newContext({ viewport: { width: 1000, height: 900 } });
    const p = await ctx.newPage();
    const errs = []; const adminCalls = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("request", (r) => { if (/\/api\/admin/.test(r.url())) adminCalls.push(r.url()); });
    p.on("dialog", (d) => d.accept());
    const res = await p.goto(E2E_BASE + "/piceditor");
    ok(res.status() === 200, "/piceditor is open to everyone", res.status());
    const tab = await p.evaluate(() => { const a = document.querySelector('.site-nav a[href="/piceditor"]'); return a && [a.textContent.trim(), a.getAttribute("aria-current")]; });
    ok(tab && /piceditor/i.test(tab[0]) && tab[1] === "page", "the nav has a PicEditor tab, and it is the current one", tab);
    ok((await p.title()).startsWith("PicEditor"), "it has its own title");
    await toShelf(p, "pic");
    ok((await p.locator(".shelf-empty").count()) === 1 && (await p.locator(".pic-shelf .shelf-chip").count()) === 4, "a shelf with no pictures yet, and blank sizes to start from");

    // open a picture from the device: the editor opens in place, under the nav
    await p.setInputFiles("#pic-file", file);
    await p.waitForSelector("#photo-editor-modal:not([hidden])", { timeout: 10000 });
    const geo = await p.evaluate(() => { const nav = document.querySelector("header.topbar").getBoundingClientRect(); const ed = document.querySelector("#photo-editor-modal > .modal-inner").getBoundingClientRect(); return { navBottom: nav.bottom, top: ed.top, fixed: getComputedStyle(document.getElementById("photo-editor-modal")).position, w: document.getElementById("pe-canvas").width }; });
    ok(geo.top >= geo.navBottom - 1 && geo.fixed !== "fixed" && geo.w === 160, "the picture opens in the editor under the site's nav", geo);
    await p.waitForFunction(() => /from your device/.test(document.getElementById("pe-hint").textContent), null, { timeout: 5000 }).catch(() => {});
    ok(/from your device/.test(await p.textContent("#pe-hint")), "the editor says the picture is from this device");
    await p.click("#pe-save-new");
    await p.waitForSelector(".pic-shelf:not([hidden]) .pic-card", { timeout: 10000 });
    ok((await p.textContent(".pic-card .shelf-name")).includes("(edited)"), "Save as new keeps it on the shelf");

    // open it, change it, Save: the shelf's picture changes
    const before = await p.evaluate(() => document.querySelector(".pic-card img").src);
    const pixelOf = () => p.evaluate(async () => { const img = document.querySelector(".pic-card img"); await img.decode(); const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext("2d"); g.drawImage(img, 0, 0); return [...g.getImageData(10, 10, 1, 1).data]; });
    const px1 = await pixelOf();
    await p.click(".pic-card .shelf-open");
    await p.waitForSelector("#photo-editor-modal:not([hidden])");
    ok((await p.textContent("#pe-save-overwrite")).trim() === "Save" && await p.isVisible("#pe-save-overwrite"), "a saved picture has Save");
    await p.evaluate(() => document.getElementById("pe-filter-invert").click());
    await p.waitForTimeout(300);
    // slide to another tab and back: the edit is still there
    await p.click('.site-nav a[href="/"]');
    await p.waitForFunction(() => location.pathname === "/" && !document.querySelector(".page-stage"), null, { timeout: 10000 });
    ok(await p.evaluate(() => document.getElementById("photo-editor-modal").getAttribute("aria-modal") === "false"), "on another tab the editor's shortcuts sleep");
    await p.click('.site-nav a[href="/piceditor"]');
    await p.waitForFunction(() => location.pathname === "/piceditor" && !document.querySelector(".page-stage"), null, { timeout: 10000 });
    ok(await p.evaluate(() => !document.getElementById("photo-editor-modal").hidden && document.getElementById("pe-canvas").width === 160 && !document.getElementById("pe-undo").disabled), "back on PicEditor, the picture and its edit are still open");
    await p.click("#pe-save-overwrite");
    await p.waitForSelector(".pic-shelf:not([hidden])", { timeout: 10000 });
    await p.waitForTimeout(300);
    const px2 = await pixelOf();
    ok(px2[0] === 255 - px1[0] && px2[2] === 255 - px1[2] && (await p.locator(".pic-card").count()) === 1, "Save keeps the change in the same picture", [px1, px2, before]);

    // copy, then delete the copy
    await p.click('.pic-card [data-act="copy"]');
    await p.waitForFunction(() => document.querySelectorAll(".pic-card").length === 2);
    ok(true, "Copy adds a second picture");
    await p.locator(".pic-card", { hasText: "(copy)" }).locator('[data-act="delete"]').click();
    await p.waitForFunction(() => document.querySelectorAll(".pic-card").length === 1);
    ok(true, "Delete takes it off the shelf");
    const dl = p.waitForEvent("download");
    await p.click('.pic-card [data-act="download"]');
    ok(/\.png$/.test((await dl).suggestedFilename()), "Download gives a picture file");

    // a blank picture
    await p.click('.pic-shelf .shelf-chip[data-w="1200"]');
    await p.waitForSelector("#photo-editor-modal:not([hidden])");
    ok(await p.evaluate(() => document.getElementById("pe-canvas").width === 1200 && document.getElementById("pe-canvas").height === 630), "a blank size opens a blank picture of that size");
    await p.click("#close-photo-editor");
    ok(await p.isVisible(".pic-shelf"), "Pictures goes back to the shelf");
    ok(adminCalls.length === 0, "nothing was sent to the admin API", adminCalls);
    ok(errs.length === 0, "no page errors", errs);
    await ctx.close();

    // a phone
    const m = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    const merrs = []; mp.on("pageerror", (e) => merrs.push(e.message));
    await mp.goto(E2E_BASE + "/piceditor");
    await toShelf(mp, "pic");
    const shelfOver = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await mp.setInputFiles("#pic-file", file);
    await mp.waitForSelector("#photo-editor-modal:not([hidden])", { timeout: 10000 });
    await mp.waitForTimeout(300);
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(shelfOver <= 0 && over <= 0, "on a phone nothing runs past the screen", [shelfOver, over]);
    const backH = await mp.evaluate(() => document.getElementById("close-photo-editor").getBoundingClientRect().height);
    ok(backH >= 30, "the Pictures button is big enough to tap", backH);
    ok(merrs.length === 0, "no page errors on a phone", merrs);
    await m.close();

    const sm = await (await fetch(E2E_BASE + "/sitemap.xml")).text();
    ok(/<loc>[^<]*\/piceditor<\/loc>/.test(sm), "/piceditor is in the sitemap");
  } finally {
    await b.close();
    fs.rmSync(file, { force: true });
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
