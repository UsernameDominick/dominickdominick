// The Studio on a wide screen: the music takes the whole page, with the visitor's songs in a panel on the left (switch songs without leaving
// the editor) and the open track's sound in a panel on the right (browse instruments or kits, shape the sound). Either panel folds to a thin
// handle. Under 1280 px there are no panels (the sound is in the Tools sheet, as on a phone).
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
const axeSrc = axeSource();

(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const rect = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.offsetParent) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; }, sel);
  const settle = (p) => p.waitForTimeout(500);
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const errs = []; const dialogs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await p.goto(E2E_BASE + "/studio");
    
    // ---- the whole page ----
    await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card", { timeout: 15000 });
    await settle(p);
    const studio = await rect(p, "#song-studio");
    const nav = await rect(p, "header.topbar");
    ok(studio && studio.l <= 1 && studio.r >= 1439 && studio.t >= nav.b - 1 && studio.b >= 899, "on a wide screen the Studio takes the whole view under the nav, edge to edge", studio);
    const songs = await rect(p, "#studio-songs-panel");
    const sound = await rect(p, "#studio-sound-panel");
    const detail = await rect(p, "#studio-detail");
    ok(songs && sound && songs.r < detail.l && detail.r < sound.l, "the songs panel is on the left and the sound panel on the right of the music", { songs, detail, sound });
    ok(songs.h > 500 && sound.h > 500 && Math.abs(songs.t - sound.t) < 2, "both run the full height beside it", [songs.h, sound.h]);
    ok((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, "and nothing runs sideways");
    ok(await p.evaluate(() => { const t = document.getElementById("studio-tab-sound"); return Boolean(t) && t.hidden; }), "the Tools sheet has no Sound tab here: the panel is the sound's home");

    // ---- songs: a first song, a second from the panel, and back ----
    await p.fill("#studio-name", "QQ Alpha");
    await p.dispatchEvent("#studio-name", "input");
    await p.click("#studio-grid .studio-cell >> nth=0");
    await p.waitForFunction(() => /^Saved/.test((document.getElementById("song-autosave-status").textContent || "").trim()) || /Saved/.test((document.getElementById("studio-status").textContent || "")), null, { timeout: 15000 });
    await p.waitForFunction(() => document.querySelectorAll("#studio-songs-panel .studio-song:not(.is-draft)").length === 1, null, { timeout: 8000 });
    const first = await p.evaluate(() => [...document.querySelectorAll("#studio-songs-panel .studio-song")].map((e) => [e.querySelector(".studio-song-name").textContent, e.classList.contains("is-current")]));
    ok(first.length === 1 && first[0][0] === "QQ Alpha" && first[0][1], "the song just made is in the panel, marked as the open one", first);
    await p.click("#studio-songs-panel .studio-songs-new");
    await p.waitForFunction(() => document.getElementById("studio-name").value !== "QQ Alpha", null, { timeout: 8000 });
    const draft = await p.evaluate(() => [...document.querySelectorAll("#studio-songs-panel .studio-song")].map((e) => [e.querySelector(".studio-song-name").textContent, e.classList.contains("is-current"), e.classList.contains("is-draft")]));
    ok(draft.length === 2 && draft[0][2] && draft[0][1], "New song in the panel opens a fresh song, shown (not saved yet) at the top", draft);
    await p.fill("#studio-name", "QQ Beta");
    await p.dispatchEvent("#studio-name", "input");
    await p.click("#studio-grid .studio-cell >> nth=3");
    await p.waitForFunction(() => document.querySelectorAll("#studio-songs-panel .studio-song:not(.is-draft)").length === 2, null, { timeout: 15000 });
    const both = await p.evaluate(() => [...document.querySelectorAll("#studio-songs-panel .studio-song")].map((e) => e.querySelector(".studio-song-name").textContent).sort().join("|"));
    ok(both === "QQ Alpha|QQ Beta", "after a change it is saved and both songs are listed", both);
    // an unsaved edit in Beta, then straight to Alpha: it is saved first, no "discard?" question
    await p.click("#studio-grid .studio-cell >> nth=5");
    await p.click('#studio-songs-panel .studio-song:has-text("QQ Alpha") .studio-song-open');
    await p.waitForFunction(() => document.getElementById("studio-name").value === "QQ Alpha", null, { timeout: 15000 });
    ok(dialogs.length === 0, "switching songs from the panel never asks to discard", dialogs);
    const cur = await p.evaluate(() => [...document.querySelectorAll("#studio-songs-panel .studio-song.is-current .studio-song-name")].map((e) => e.textContent));
    ok(cur.length === 1 && cur[0] === "QQ Alpha", "and Alpha is now the open one", cur);
    await p.click('#studio-songs-panel .studio-song:has-text("QQ Beta") .studio-song-open');
    await p.waitForFunction(() => document.getElementById("studio-name").value === "QQ Beta", null, { timeout: 15000 });
    const betaHits = await p.evaluate(() => Object.values(window.SongStudioHost.song().tracks).reduce((n, row) => n + row.filter((v) => v).length, 0));
    ok(betaHits === 2, "Beta kept the edit made just before leaving it", betaHits);
    // copy, then delete the copy (never the open song)
    await p.click('#studio-songs-panel .studio-song:has-text("QQ Alpha") [data-act="copy"]');
    await p.waitForFunction(() => document.querySelectorAll("#studio-songs-panel .studio-song").length === 3, null, { timeout: 8000 });
    ok(await p.locator('#studio-songs-panel .studio-song.is-current [data-act="delete"]').count() === 0, "the open song has no Delete in the panel");
    await p.click('#studio-songs-panel .studio-song:has-text("(copy)") [data-act="delete"]');
    await p.waitForFunction(() => document.querySelectorAll("#studio-songs-panel .studio-song").length === 2, null, { timeout: 8000 });
    ok(true, "a copy can be made and deleted from the panel");

    // ---- sound: the open track's instruments and knobs ----
    await p.click("#studio-stack .studio-card >> nth=1");
    await settle(p);
    ok((await p.textContent("#studio-sound-panel-title")) === "Bass sound", "choosing the Bass track puts its sound in the panel");
    const tabs = await p.locator("#studio-sound-panel .studio-pick-tab").allTextContents();
    ok(tabs.includes("Bass") && tabs.includes("Keys") && tabs.includes("Pads"), "the instruments come in groups", tabs);
    ok(await p.locator('#studio-sound-panel .studio-pick[data-pick="bass"]').getAttribute("aria-pressed") === "true", "the bass track's own instrument is pressed");
    await p.click('#studio-sound-panel .studio-pick-tab:has-text("Keys")');
    await p.click('#studio-sound-panel .studio-pick[data-pick="epiano"]');
    await settle(p);
    const voice = await p.evaluate(() => window.SongStudioHost.song().bass.voice);
    ok(voice === "epiano", "picking an instrument in the panel changes the track's sound", voice);
    ok(await p.locator('#studio-sound-panel .studio-pick[data-pick="epiano"]').getAttribute("aria-pressed") === "true", "and it shows as the chosen one");
    await p.evaluate(() => { const r = document.querySelector('#studio-sound-panel [data-knob="attack"]'); r.value = "700"; r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); });
    const attack = await p.evaluate(() => window.SongStudioHost.synth("bass").attack);
    ok(attack > 0.1, "a knob in the panel shapes the sound", attack);
    await p.click("#studio-stack .studio-card >> nth=0");
    await settle(p);
    ok((await p.textContent("#studio-sound-panel-title")) === "Drums sound" && (await p.locator("#studio-sound-panel .studio-pick").count()) >= 10, "the Drums track shows the kits to choose from");
    await p.click('#studio-sound-panel .studio-pick[data-pick="808"]');
    await settle(p);
    ok((await p.evaluate(() => window.SongStudioHost.song().kit)) === "808", "choosing a kit in the panel changes the drum kit");
    ok(await p.locator('#studio-sound-panel [data-sound="snare"]').count() === 1, "and each drum sound can be picked and shaped");

    // ---- folding either side away, and back ----
    const wasW = (await rect(p, "#studio-detail")).w;
    await p.click("#studio-songs-panel .studio-panel-fold");
    await settle(p);
    const foldedSongs = await rect(p, "#studio-songs-panel");
    ok(foldedSongs.w < 60 && (await rect(p, "#studio-detail")).w > wasW + 100, "folding the songs panel leaves a thin handle and gives the music the room", [foldedSongs.w, wasW]);
    await p.click("#studio-sound-panel .studio-panel-fold");
    await settle(p);
    ok((await rect(p, "#studio-sound-panel")).w < 60 && (await rect(p, "#song-studio")).w >= 1400, "folding the sound panel too leaves the music nearly the whole width");
    await p.reload();
    await p.waitForSelector("#studio-mount .studio-shelf:not([hidden])", { timeout: 30000 });
    await p.click(".shelf-card .shelf-open >> nth=0");
    await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card", { timeout: 15000 });
    await settle(p);
    ok((await rect(p, "#studio-songs-panel")).w < 60 && (await rect(p, "#studio-sound-panel")).w < 60, "the folds are remembered after a reload");
    await p.click("#studio-songs-panel .studio-panel-handle");
    await p.click("#studio-sound-panel .studio-panel-handle");
    await settle(p);
    ok((await rect(p, "#studio-songs-panel")).w > 150 && (await rect(p, "#studio-sound-panel")).w > 250, "the handles open them again");

    // ---- the Sound button on a track goes to the panel, not a sheet ----
    await p.click("#studio-stack .studio-card >> nth=1");
    await settle(p);
    await p.click('#studio-detail [data-act="sound"], #studio-detail button:has-text("Bass")').catch(() => {});
    ok(!(await p.evaluate(() => document.querySelector(".song-studio").classList.contains("studio-sheet-on"))), "the track's sound button does not open the sheet when the panel is there");

    // ---- axe in both themes ----
    await p.addScriptTag({ content: axeSrc }).catch(() => {});
    const axeRun = () => p.evaluate(async () => (await axe.run(document.getElementById("song-studio"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ": " + v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" ; ")));
    const dark = await axeRun();
    ok(dark.length === 0, "axe: the Studio with both panels is clean in the dark theme", dark);
    await p.evaluate(() => { document.documentElement.setAttribute("data-theme", "light"); });
    await p.waitForTimeout(400);
    const light = await axeRun();
    ok(light.length === 0, "axe: and in the light theme", light);

    // ---- crossing the breakpoint moves the sound between the panel and the sheet ----
    await p.setViewportSize({ width: 1100, height: 900 });
    await settle(p);
    ok(!(await rect(p, "#studio-songs-panel")) && !(await rect(p, "#studio-sound-panel")), "under 1280 px there are no panels");
    const full = await rect(p, "#song-studio");
    ok(full.w >= 1090, "the Studio still takes the whole width at 1100 px", full);
    await p.click("#studio-tools");
    await p.waitForSelector("#studio-sheet:not([hidden])");
    ok(await p.locator("#studio-tab-sound").isVisible(), "the Tools sheet has its Sound tab back");
    await p.click("#studio-tab-sound");
    ok(await p.locator("#studio-sheet #studio-pane-sound select#studio-kit, #studio-sheet #studio-pane-sound select#studio-voice").first().isVisible(), "with the instrument menu in it");
    await p.click("#close-studio-sheet");
    await p.setViewportSize({ width: 1440, height: 900 });
    await settle(p);
    ok((await rect(p, "#studio-sound-panel")) && (await p.locator("#studio-sound-panel #studio-pane-sound").count()) === 1, "back on a wide screen the sound is in the panel again");
    ok(errs.length === 0, "no page errors", errs);
    await ctx.close();

    // ---- a phone has no panels ----
    {
      const m = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
      const mp = await m.newPage();
      await mp.goto(E2E_BASE + "/studio");
      await mp.waitForSelector("#studio-mount .studio-shelf:not([hidden])", { timeout: 30000 });
      await mp.click("#new-song-btn");
      await mp.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card", { timeout: 15000 });
      await mp.waitForTimeout(500);
      ok(!(await rect(mp, "#studio-songs-panel")) && !(await rect(mp, "#studio-sound-panel")), "a phone shows no panels");
      ok((await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, "and nothing runs sideways");
      await m.close();
    }
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
