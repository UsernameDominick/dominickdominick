// Back up and restore on the Studio: the button saves one file, a restore puts things back without overwriting, a second restore adds
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
    ok(/does not have/.test(await status()), "a backup for a page this site does not have is turned away with a reason", await status());
    await restore("not json at all");
    ok(/not a backup/i.test(await status()), "so is a file that is not a backup");

    ok(errs.length === 0, "no page errors", errs);
  } finally { await b.close(); }
  console.log(fail ? fail + " FAILED" : "ALL PASS");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
