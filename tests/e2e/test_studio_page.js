// The Studio as a page of its own, open to every visitor: a nav tab, the song builder filling the page (in a frame), songs kept in the visitor's
// own browser, nothing sent to the admin API, and a phone width that fits.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    // a visitor: no admin session at all
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    const errs = []; const adminCalls = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("request", (r) => { if (/\/api\/admin/.test(r.url())) adminCalls.push(r.url()); });
    p.on("dialog", (d) => d.accept());
    const res = await p.goto(E2E_BASE + "/studio");
    ok(res.status() === 200, "/studio is open to everyone", res.status());
    const nav = await p.evaluate(() => [...document.querySelectorAll("nav a, .site-nav a")].map((a) => [a.textContent.trim(), a.getAttribute("href"), a.getAttribute("aria-current")]));
    const tab = nav.find((n) => n[0] === "Studio");
    ok(tab && tab[1] === "/studio" && tab[2] === "page", "the nav has a Studio tab, and it is the current one", nav);
    ok((await p.title()).startsWith("Studio") && (await p.locator('meta[name="description"]').getAttribute("content")).length > 40, "it has a title and a description");
    const frame = () => p.frames().find((f) => /\/studio-app\//.test(f.url()));
    await p.waitForFunction(() => { const f = document.querySelector(".studio-frame"); return f && f.contentDocument && f.contentDocument.querySelector("#studio-stack .studio-card"); }, null, { timeout: 20000 });
    const f = frame();
    const cards = await f.evaluate(() => [...document.querySelectorAll("#studio-stack .studio-card-name")].map((x) => x.textContent).join("|"));
    ok(cards === "Drums|Bass|Chords|Melody|Lead", "the Studio is built into the page: five tracks", cards);
    const box = await p.locator(".studio-frame").boundingBox();
    ok(box.width >= 1270 && box.height >= 700, "and fills the width of the page", box);
    ok(!(await f.evaluate(() => /Usage|Save as template.*admin/i.test(document.getElementById("songs-modal").innerText) && !document.getElementById("songs-modal").hidden)), "no owner-only parts show");
    // make something and keep it
    await f.evaluate(() => document.querySelector('#studio-grid .studio-cell[data-row="kick"][data-step="0"]').click());
    await f.fill("#studio-name", "QQ Visitor Song");
    await f.click("#studio-save");
    await p.waitForTimeout(600);
    const saved = await f.evaluate(() => JSON.parse(localStorage.getItem("studio.songs.v1") || "[]").map((s) => ({ name: s.name, kick: s.data && s.data.tracks && s.data.tracks.kick && s.data.tracks.kick[0] })));
    ok(saved.length === 1 && saved[0].name === "QQ Visitor Song" && saved[0].kick === true, "Save keeps the song in this browser", saved);
    ok(adminCalls.length === 0, "nothing was sent to the admin API", adminCalls);
    // come back: it opens the song worked on last
    await p.goto(E2E_BASE + "/studio");
    await p.waitForFunction(() => { const fr = document.querySelector(".studio-frame"); const d = fr && fr.contentDocument; return d && d.querySelector("#studio-name") && d.querySelector("#studio-name").value === "QQ Visitor Song"; }, null, { timeout: 20000 });
    const again = await frame().evaluate(() => document.querySelector('#studio-grid .studio-cell[data-row="kick"][data-step="0"]').classList.contains("on"));
    ok(again, "coming back opens the song and its notes");
    // the sound plays after a tap
    const played = await frame().evaluate(async () => { document.getElementById("studio-play").click(); await new Promise((r) => setTimeout(r, 700)); const on = document.getElementById("studio-play").getAttribute("aria-label") === "Pause"; document.getElementById("studio-stop").click(); return on; });
    ok(played, "Play works in the page");
    ok(errs.length === 0, "no page errors", errs);
    await ctx.close();

    // a phone
    const m = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    await mp.goto(E2E_BASE + "/studio");
    await mp.waitForFunction(() => { const fr = document.querySelector(".studio-frame"); const d = fr && fr.contentDocument; return d && d.querySelector("#studio-stack .studio-card"); }, null, { timeout: 20000 });
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const inner = await mp.frames().find((x) => /studio-app/.test(x.url())).evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 0 && inner <= 0, "on a phone nothing runs past the screen", [over, inner]);
    await m.close();

    // the page is in the sitemap and open to search engines; the frame is not
    const sm = await (await fetch(E2E_BASE + "/sitemap.xml")).text();
    ok(/<loc>[^<]*\/studio<\/loc>/.test(sm), "/studio is in the sitemap");
    const html = await (await fetch(E2E_BASE + "/studio-app/")).text();
    ok(/name="robots" content="noindex"/.test(html), "the frame itself is noindex");
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
