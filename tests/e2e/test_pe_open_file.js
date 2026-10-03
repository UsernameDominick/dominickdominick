const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs"); const fs = require("fs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const api = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const mediaCount = async () => { const r = await (await api.get(BASE + "/api/admin/media")).json(); return (Array.isArray(r) ? r : r.items || r.files || []).length; };
  const before = await mediaCount();
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const [w, h, label] of [[1440, 900, "desktop"], [390, 800, "phone"]]) {
    const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: w, height: h }, acceptDownloads: true });
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    const t = `[${label}]`;
    await p.goto(`${BASE}/admin/`); await p.waitForSelector("#app:not([hidden])");
    const png = await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 64; c.height = 40; const g = c.getContext("2d"); g.fillStyle = "rgb(200,60,60)"; g.fillRect(0, 0, 64, 40); return c.toDataURL("image/png").split(",")[1]; });
    const pngBuf = Buffer.from(png, "base64");
    const openLibrary = async () => { await p.evaluate(() => document.getElementById("media-btn").click()); await p.waitForSelector("#media-modal:not([hidden])"); await p.waitForTimeout(400); };
    const editorOpen = () => p.evaluate(() => !document.getElementById("photo-editor-modal").hidden);
    const closeEditor = async () => { await p.evaluate(() => document.getElementById("close-photo-editor") && document.getElementById("close-photo-editor").click()); await p.waitForTimeout(300); await p.evaluate(() => { const c = [...document.querySelectorAll("button")].find((x) => /discard|close without|don't save/i.test(x.textContent) && x.offsetParent); c && c.click(); }); await p.waitForTimeout(300); };
    await openLibrary();
    ok(await p.locator("#media-edit-file-btn").isVisible(), `${t} the library has an Edit a file button`);
    ok((await p.getAttribute("#media-edit-file-input", "accept")).includes("image/png") && (await p.locator("#media-edit-file-input").isHidden()), `${t} backed by a hidden file input for pictures`);
    // wrong type
    await p.setInputFiles("#media-edit-file-input", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await p.waitForTimeout(300);
    ok(!(await editorOpen()) && /Only PNG, JPEG, WebP and GIF/.test(await p.textContent("#media-load-status")), `${t} a text file is turned away with a message`, await p.textContent("#media-load-status"));
    // svg
    await p.setInputFiles("#media-edit-file-input", { name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") });
    await p.waitForTimeout(200);
    ok(!(await editorOpen()), `${t} an SVG is not opened`);
    // too big
    const bigMsg = await p.evaluate(() => window.PhotoEditor.openFile(new File([new Uint8Array(31 * 1024 * 1024)], "big.png", { type: "image/png" })));
    ok(bigMsg.error && /over 30 MB/.test(bigMsg.error) && !(await editorOpen()), `${t} a picture over 30 MB is turned away`, bigMsg);
    const emptyMsg = await p.evaluate(() => window.PhotoEditor.openFile(new File([], "empty.png", { type: "image/png" })));
    ok(emptyMsg.error && /empty/.test(emptyMsg.error), `${t} an empty file is turned away`, emptyMsg);
    // a real picture
    await p.setInputFiles("#media-edit-file-input", { name: "my photo (1).png", mimeType: "image/png", buffer: pngBuf });
    await p.waitForSelector("#photo-editor-modal:not([hidden])"); await p.waitForFunction(() => document.getElementById("pe-canvas").width === 64); await p.waitForTimeout(400);
    ok(await p.evaluate(() => document.getElementById("pe-canvas").height === 40), `${t} the picture opens in the editor at its own size`);
    ok(/my photo \(1\)\.png.*nothing is uploaded/.test(await p.textContent("#pe-hint")), `${t} the hint names the file and says nothing is uploaded`, await p.textContent("#pe-hint"));
    ok(await p.locator("#pe-save-new").isVisible() && await p.locator("#pe-save-overwrite").isHidden(), `${t} only Save as new is offered (nothing to overwrite)`);
    ok((await p.evaluate(() => Array.from(document.getElementById("pe-canvas").getContext("2d").getImageData(5, 5, 1, 1).data))).join() === "200,60,60,255", `${t} and the pixels are the picture's`);
    // download png
    let [dl] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => document.getElementById("pe-download").click())]);
    ok(dl.suggestedFilename() === "my photo -1-edited.png" || dl.suggestedFilename() === "my photo (1)-edited.png" || /^my-?photo.*-edited\.png$/.test(dl.suggestedFilename().replace(/ /g, "-")), `${t} Download names the file after the opened one`, dl.suggestedFilename());
    const path = await dl.path(); const buf = fs.readFileSync(path);
    ok(buf.slice(0, 8).toString("hex") === "89504e470d0a1a0a" && buf.readUInt32BE(16) === 64 && buf.readUInt32BE(20) === 40, `${t} the file is a 64x40 PNG`, [buf.readUInt32BE(16), buf.readUInt32BE(20)]);
    ok(await editorOpen() && /Downloaded .*-edited\.png/.test(await p.textContent("#pe-layer-note")), `${t} the editor stays open and says what was downloaded`, await p.textContent("#pe-layer-note"));
    ok((await mediaCount()) === before, `${t} nothing was uploaded`, [before, await mediaCount()]);
    // the download carries the edit
    await p.evaluate(() => { const c = document.getElementById("pe-canvas"); const g = c.getContext("2d"); g.fillStyle = "rgb(0,0,255)"; g.fillRect(0, 0, 64, 40); });
    [dl] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => document.getElementById("pe-download").click())]);
    const px = await p.evaluate(async (b64) => { const bmp = await createImageBitmap(await (await fetch("data:image/png;base64," + b64)).blob()); const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height; const g = c.getContext("2d"); g.drawImage(bmp, 0, 0); return Array.from(g.getImageData(3, 3, 1, 1).data); }, fs.readFileSync(await dl.path()).toString("base64"));
    ok(px.join() === "0,0,255,255", `${t} and it is the edited picture, not the original`, px);
    // jpeg
    await p.selectOption("#pe-export-format", "image/jpeg");
    [dl] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => document.getElementById("pe-download").click())]);
    const jbuf = fs.readFileSync(await dl.path());
    ok(/-edited\.jpg$/.test(dl.suggestedFilename()) && jbuf[0] === 0xff && jbuf[1] === 0xd8, `${t} choosing JPEG downloads a .jpg`, dl.suggestedFilename());
    await p.selectOption("#pe-export-format", "image/webp");
    [dl] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => document.getElementById("pe-download").click())]);
    ok(/-edited\.webp$/.test(dl.suggestedFilename()), `${t} and WebP a .webp`, dl.suggestedFilename());
    await closeEditor();
    ok(!(await editorOpen()), `${t} the editor closes`);
    // paste
    const paste = (targetSel) => p.evaluate(async ([b64, sel]) => { const blob = await (await fetch("data:image/png;base64," + b64)).blob(); const file = new File([blob], "image.png", { type: "image/png" }); const dt = new DataTransfer(); dt.items.add(file); const target = sel ? document.querySelector(sel) : document.body; const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }); target.dispatchEvent(ev); return ev.defaultPrevented; }, [png, targetSel]);
    if (!(await p.evaluate(() => !document.getElementById("media-modal").hidden))) await openLibrary();
    const ignored = await paste("#media-search");
    await p.waitForTimeout(300);
    ok(!ignored && !(await editorOpen()), `${t} pasting while typing in a field is left to the field`, ignored);
    const handled = await paste(null);
    await p.waitForSelector("#photo-editor-modal:not([hidden])", { timeout: 5000 }).catch(() => {});
    ok(handled && (await editorOpen()), `${t} pasting a picture with the library open opens it in the editor`, handled);
    ok(/image\.png.*nothing is uploaded/.test(await p.textContent("#pe-hint")), `${t} named after the pasted file`, await p.textContent("#pe-hint"));
    // paste while the editor is open does nothing new
    const again = await paste(null);
    ok(!again, `${t} pasting while the editor is open is ignored`, again);
    // library image name for Download
    await closeEditor();
    await p.evaluate((b64) => window.PhotoEditor.open("data:image/png;base64," + b64, "uploads/photo-123.png"), png);
    await p.waitForSelector("#photo-editor-modal:not([hidden])"); await p.waitForTimeout(400);
    [dl] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => document.getElementById("pe-download").click())]);
    ok(dl.suggestedFilename() === "photo-123-edited.png", `${t} a library image downloads as <name>-edited`, dl.suggestedFilename());
    await closeEditor();
    // blank doc
    await p.evaluate(() => window.PhotoEditor.openBlank(50, 30)); await p.waitForTimeout(400);
    [dl] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => document.getElementById("pe-download").click())]);
    ok(dl.suggestedFilename() === "image-edited.png", `${t} a blank image downloads as image-edited`, dl.suggestedFilename());
    // axe
    await p.addScriptTag({ content: require("./_pw.cjs").axeSource() });
    const viol = await p.evaluate(async () => (await axe.run(document.getElementById("photo-editor-modal"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ":" + v.nodes.length));
    ok(viol.length === 0, `${t} axe finds nothing in the editor`, viol);
    await closeEditor();
    await openLibrary().catch(() => {});
    const viol2 = await p.evaluate(async () => { if (document.getElementById("media-modal").hidden) return ["library not open"]; return (await axe.run(document.getElementById("media-modal"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ":" + v.nodes.length); });
    ok(viol2.length === 0, `${t} axe finds nothing in the library`, viol2);
    ok(errs.length === 0, `${t} no page errors`, errs);
    await ctx.close();
  }
  await b.close();
  console.log(f ? "FAILED " + f : "ALL PASS");
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
