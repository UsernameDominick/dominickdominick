// Back up and restore on every tool page: the button saves one file, a restore puts things back without overwriting, a second restore adds
// nothing, and a file for another page is turned away.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const fs = require("fs");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
    const bk = () => p.locator(".app-backup:visible").first();
    const status = () => bk().locator(".app-backup-status").textContent();
    const backup = async () => { const [dl] = await Promise.all([p.waitForEvent("download"), bk().locator(".app-backup-save").click()]); return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), "utf8") }; };
    const restore = async (text, name) => { const f = require("path").join(require("os").tmpdir(), name || "qq-restore-" + process.pid + ".json"); fs.writeFileSync(f, text); await bk().locator("input[type=file]").setInputFiles(f); await p.waitForFunction(() => /Restored|Nothing new|not|empty|big|newer|nothing/i.test((document.querySelector(".app-backup:not([hidden]) .app-backup-status") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(400); };
    const load = async (path, sel) => { await p.goto(E2E_BASE + path); await p.waitForSelector(sel, { timeout: 30000 }); await p.waitForTimeout(600); };

    // ---- Studio (songs in localStorage) ----
    await load("/studio", "#studio-keys .studio-pad");
    await p.evaluate(() => localStorage.setItem("studio.songs.v1", JSON.stringify([{ id: 5, name: "QQ Beat", data: { tempo: 100 }, updated_at: "2026-01-01 00:00:00" }])));
    await p.reload(); await p.waitForSelector("#studio-keys .studio-pad", { timeout: 30000 }); await p.waitForTimeout(600);
    const s1 = await backup();
    ok(/^dominick-studio-backup-\d{4}-\d\d-\d\d\.json$/.test(s1.name) && JSON.parse(s1.text).parts.songs.length === 1, "the Studio's Back up saves a file named for the page and the day, with the song in it", s1.name);
    await p.evaluate(() => localStorage.setItem("studio.songs.v1", JSON.stringify([{ id: 1, name: "Other", data: { tempo: 90 }, updated_at: "2026-02-02 00:00:00" }])));
    await p.reload(); await p.waitForSelector("#studio-keys .studio-pad", { timeout: 30000 }); await p.waitForTimeout(600);
    await restore(s1.text);
    ok(/Restored 1 item/.test(await status()), "Restore says what came back", await status());
    const songs = await p.evaluate(() => JSON.parse(localStorage.getItem("studio.songs.v1")));
    ok(songs.length === 2 && songs.some((s) => s.name === "Other" && s.id === 1) && songs.some((s) => s.name === "QQ Beat" && s.id === 2), "the song is back under a new id and the one that was here is untouched", songs.map((s) => s.name + s.id));
    await restore(s1.text);
    ok(/Nothing new/.test(await status()) && (await p.evaluate(() => JSON.parse(localStorage.getItem("studio.songs.v1")).length)) === 2, "restoring it again adds nothing");
    await restore(JSON.stringify({ format: "dominick-backup", version: 1, app: "simulations", parts: { circuits: [] } }));
    ok(/Simulations, not the Studio/.test(await status()), "a backup for another page is turned away with a reason", await status());
    await restore("not json at all");
    ok(/not a backup/i.test(await status()), "so is a file that is not a backup");

    // ---- Simulations (circuits in localStorage) ----
    await load("/simulations", "#simulation-builder-modal:not([hidden])");
    await p.evaluate(() => localStorage.setItem("simulations.circuits.v1", JSON.stringify([{ id: 3, name: "QQ Circuit", data: { components: [], wires: [] }, updated_at: "2026-01-01 00:00:00" }])));
    await p.reload(); await p.waitForSelector("#simulation-builder-modal:not([hidden])", { timeout: 30000 }); await p.waitForTimeout(600);
    const c1 = await backup();
    await p.evaluate(() => localStorage.removeItem("simulations.circuits.v1"));
    await restore(c1.text);
    ok((await p.evaluate(() => JSON.parse(localStorage.getItem("simulations.circuits.v1")).map((c) => c.name).join())) === "QQ Circuit", "Simulations: a backed-up circuit comes back");

    // ---- PicEditor (pictures in IndexedDB, as files) ----
    await load("/piceditor", "#photo-editor-modal:not([hidden])");
    await p.evaluate(async () => { const st = SiteAppKit.fileStore("piceditor-pictures"); await st.put({ id: 1, name: "QQ pic", type: "image/png", blob: new Blob(["abcdef"], { type: "image/png" }), width: 2, height: 2, updated_at: "2026-01-01 00:00:00" }); });
    await p.reload(); await p.waitForSelector("#photo-editor-modal:not([hidden])", { timeout: 30000 }); await p.waitForTimeout(600);
    const pic = await backup();
    await p.evaluate(async () => { await SiteAppKit.fileStore("piceditor-pictures").delete(1); });
    await restore(pic.text);
    const back = await p.evaluate(async () => (await SiteAppKit.fileStore("piceditor-pictures").all()).map((x) => [x.name, x.blob.size, x.blob.type]));
    ok(back.length === 1 && back[0][0] === "QQ pic" && back[0][1] === 6 && back[0][2] === "image/png", "PicEditor: the picture comes back with its pixels (bytes and type)", back);
    await restore(pic.text);
    ok((await p.evaluate(async () => (await SiteAppKit.fileStore("piceditor-pictures").all()).length)) === 1, "and restoring twice does not copy it");

    // ---- Scans (records and model files in IndexedDB) ----
    await load("/scans", "#scan-editor-modal:not([hidden])");
    await p.evaluate(async () => {
      const files = SiteAppKit.fileStore("scans-files"); const list = SiteAppKit.fileStore("scans-list");
      await files.put({ id: "local-scan-qq1", blob: new Blob(["glbdata"], { type: "model/gltf-binary" }), name: "qq.glb", type: "model/gltf-binary", size: 7 });
      await list.put({ id: 1, name: "QQ scan", glb_key: "local-scan-qq1", size: 7, updated_at: "2026-01-01 00:00:00" });
    });
    await p.reload(); await p.waitForSelector("#scan-editor-modal:not([hidden])", { timeout: 30000 }); await p.waitForTimeout(600);
    const sc = await backup();
    await p.evaluate(async () => { await SiteAppKit.fileStore("scans-list").delete(1); await SiteAppKit.fileStore("scans-files").delete("local-scan-qq1"); });
    await restore(sc.text);
    const rs = await p.evaluate(async () => { const l = await SiteAppKit.fileStore("scans-list").all(); const f = l[0] && l[0].glb_key ? await SiteAppKit.fileStore("scans-files").get(l[0].glb_key) : null; return { n: l.length, key: l[0] && l[0].glb_key, size: f && f.blob.size }; });
    ok(rs.n === 1 && /^local-scan-/.test(rs.key) && rs.key !== "local-scan-qq1" && rs.size === 7, "Scans: the scan comes back with its model file under a fresh key", rs);

    // ---- Trainer (settings and runs in localStorage) ----
    await load("/trainer", ".trainer");
    await p.evaluate(() => localStorage.setItem("trainer.history.v1", JSON.stringify([{ drill: "flick", score: 900, accuracy: 80, reaction: 410, hits: 9, seconds: 30, at: 1700000000000 }])));
    await p.reload(); await p.waitForSelector(".trainer", { timeout: 30000 }); await p.waitForTimeout(500);
    const tr = await backup();
    await p.evaluate(() => localStorage.removeItem("trainer.history.v1"));
    await p.reload(); await p.waitForSelector(".trainer", { timeout: 30000 }); await p.waitForTimeout(500);
    await restore(tr.text);
    ok((await p.locator(".trainer-history li .h-score").count()) === 1 && (await p.locator(".trainer-history li .h-score").first().textContent()) === "900", "Trainer: the run is back in the list straight away");

    ok(errs.length === 0, "no page errors", errs);
  } finally { await b.close(); }
  console.log(fail ? fail + " FAILED" : "ALL PASS");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
