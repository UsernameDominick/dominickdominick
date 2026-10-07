// The four app pages (Studio, Simulations, PicEditor, Scans) in one visit, all built on public/app-kit.js: each keeps its own work in its
// own place and answers its own calls (the editors' calls to the admin API go to whichever app owns the path), sliding between the pages
// never loads a page or loses an open editor, and nothing is sent to the server.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { toShelf } = require("./_shelf.cjs");
const { chromium } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    const ctx = await b.newContext({ viewport: { width: 1000, height: 900 } });
    const p = await ctx.newPage();
    const errs = []; const adminCalls = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("request", (r) => { if (/\/api\/admin/.test(r.url())) adminCalls.push(r.url()); });
    p.on("dialog", (d) => d.accept());
    const stored = (key) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), key);
    const slide = async (path) => {
      await p.click(`.site-nav a[href="${path}"]`);
      await p.waitForFunction((x) => location.pathname === x && !document.querySelector(".page-stage"), path, { timeout: 15000 });
    };

    // the Studio: a song, saved
    await p.goto(E2E_BASE + "/studio");
    await p.evaluate(() => { window.__sameDocument = true; });
    ok(await p.evaluate(() => !!document.querySelector('script[src="/app-kit.js"]') && !!document.querySelector('script[src="/studio.js"]')), "the Studio page loads the kit and then its own script");
    await toShelf(p, "studio");
    await p.click("#new-song-btn");
    await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card", { timeout: 15000 });
    await p.evaluate(() => document.querySelector('#studio-grid .studio-cell[data-row="kick"][data-step="0"]').click());
    await p.fill("#studio-name", "QQ Together Song");
    await p.click("#studio-save");
    await p.waitForTimeout(600);
    ok((await stored("studio.songs.v1")).map((s) => s.name).join() === "QQ Together Song", "the Studio keeps its song under the same key as ever (studio.songs.v1)");

    // Simulations: a circuit, saved
    await slide("/simulations");
    await toShelf(p, "sim");
    await p.click("#sim-shelf-new");
    await p.waitForSelector("#simulation-builder-modal:not([hidden])", { timeout: 15000 });
    await p.fill("#simulation-name", "QQ Together Circuit");
    for (const t of ["battery", "led"]) await p.evaluate((s) => document.querySelector(`.sim-palette-btn[data-sim-type="${s}"]`).click(), t);
    await p.waitForTimeout(200);
    await p.click("#close-simulation-builder");
    await p.waitForSelector(".sim-shelf:not([hidden]) .sim-card", { timeout: 10000 });
    ok((await stored("simulations.circuits.v1")).map((s) => s.name).join() === "QQ Together Circuit", "Simulations keeps its circuit in its own place");

    // PicEditor and Scans open on their shelves
    await slide("/piceditor");
    await p.waitForSelector("#piceditor-mount .app-native", { timeout: 20000 });
    await slide("/scans");
    await p.waitForSelector("#scans-mount .app-native", { timeout: 20000 });
    ok(true, "PicEditor and Scans open in the same visit");

    // back to the Studio: its song is still open and the song editor still works
    await slide("/studio");
    await p.waitForFunction(() => { const n = document.getElementById("studio-name"); return n && n.value === "QQ Together Song" && !document.getElementById("song-builder-modal").hidden; }, null, { timeout: 15000 });
    ok(true, "back on the Studio, its song is still open");

    // each call goes to the app that owns it
    const calls = await p.evaluate(async () => {
      const out = {};
      out.songs = (await window.adminApi("/songs")).map((s) => s.name);
      out.circuits = (await window.adminApi("/simulations")).map((s) => s.name);
      out.songTemplates = await window.adminApi("/templates?kind=song");
      out.simTemplates = await window.adminApi("/templates?kind=simulation");
      out.settings = await window.adminApi("/settings");
      try { await window.adminApi("/nothing-here"); out.unknown = "answered"; } catch (e) { out.unknown = e.status; }
      return out;
    });
    ok(calls.songs.join() === "QQ Together Song" && calls.circuits.join() === "QQ Together Circuit", "the song list and the circuit list each come from their own app", calls);
    ok(Array.isArray(calls.songTemplates) && Array.isArray(calls.simTemplates), "templates of each kind are answered, whichever app is asked first", calls);
    ok(calls.unknown === 404 && calls.settings && typeof calls.settings === "object", "a call no app owns is 'not available here', and the settings are empty", calls);
    ok(await p.evaluate(() => window.__sameDocument === true), "four slides and back, and the page was never loaded again");
    ok(adminCalls.length === 0, "nothing was sent to the admin API", adminCalls);
    ok(errs.length === 0, "no page errors", errs);
    await ctx.close();
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
