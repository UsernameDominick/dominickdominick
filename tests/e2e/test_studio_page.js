// The Studio as a page of the site, open to every visitor: a nav tab, a shelf of the visitor's songs, the song editor opening right there
// under the site's nav (no frame, no dialog), songs kept in the visitor's own browser, nothing sent to the admin API, the Studio parked
// when another tab slides in and back as it was, and a phone width that fits.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { toShelf } = require("./_shelf.cjs");
const { chromium } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    // a visitor: no admin session at all
    const ctx = await b.newContext({ viewport: { width: 1000, height: 900 } });
    const p = await ctx.newPage();
    const errs = []; const adminCalls = []; const dialogs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("request", (r) => { if (/\/api\/admin/.test(r.url())) adminCalls.push(r.url()); });
    p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    const res = await p.goto(E2E_BASE + "/studio");
    ok(res.status() === 200, "/studio is open to everyone", res.status());
    const nav = await p.evaluate(() => [...document.querySelectorAll(".site-nav a")].map((a) => [a.textContent.trim(), a.getAttribute("href"), a.getAttribute("aria-current")]));
    const tab = nav.find((n) => /^Studio$/i.test(n[0]));
    ok(tab && tab[1] === "/studio" && tab[2] === "page", "the nav has a Studio tab, and it is the current one", nav);
    ok((await p.title()).startsWith("Studio") && (await p.locator('meta[name="description"]').getAttribute("content")).length > 40, "it has a title and a description");

    // the shelf
    await toShelf(p, "studio");
    ok((await p.locator("iframe").count()) === 0, "no frame: the Studio is part of the page");
    ok(await p.locator("#song-builder-modal").evaluate((e) => e.hidden), "it opens on the shelf, the editor closed");
    ok((await p.locator(".shelf-empty").count()) === 1, "with no songs yet it says so");
    const starters = await p.locator(".shelf-chip").count();
    ok(starters >= 3, "starter songs are offered", starters);
    ok((await p.locator("#close-songs").evaluateAll((els) => els.filter((e) => e.offsetParent).length)) === 0, "no owner-only parts show");

    // a new song opens in place, under the nav
    await p.click("#new-song-btn");
    await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card", { timeout: 10000 });
    const cards = await p.evaluate(() => [...document.querySelectorAll("#studio-stack .studio-card-name")].map((x) => x.textContent).join("|"));
    ok(cards === "Drums|Bass|Chords|Melody|Lead", "the editor opens with its five tracks", cards);
    const geo = await p.evaluate(() => {
      const nav = document.querySelector("header.topbar").getBoundingClientRect();
      const ed = document.querySelector("#song-studio").getBoundingClientRect();
      return { navBottom: nav.bottom, top: ed.top, bottom: ed.bottom, width: ed.width, fixed: getComputedStyle(document.getElementById("song-builder-modal")).position };
    });
    ok(geo.top >= geo.navBottom - 1 && geo.bottom <= 901 && geo.fixed !== "fixed", "the editor sits under the site's nav, not over the page", geo);

    // make something and keep it
    await p.evaluate(() => document.querySelector('#studio-grid .studio-cell[data-row="kick"][data-step="0"]').click());
    await p.fill("#studio-name", "QQ Visitor Song");
    await p.click("#studio-save");
    await p.waitForTimeout(600);
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("studio.songs.v1") || "[]").map((s) => ({ name: s.name, kick: s.data && s.data.tracks && s.data.tracks.kick && s.data.tracks.kick[0] })));
    ok(saved.length === 1 && saved[0].name === "QQ Visitor Song" && saved[0].kick === true, "Save keeps the song in this browser", saved);

    // Play, then Songs: back to the shelf without a question, the sound stopped
    const played = await p.evaluate(async () => { document.getElementById("studio-play").click(); await new Promise((r) => setTimeout(r, 600)); return document.getElementById("studio-play").getAttribute("aria-label") === "Pause"; });
    ok(played, "Play works in the page");
    await p.evaluate(() => document.querySelector('#studio-grid .studio-cell[data-row="snare"][data-step="4"]').click()); // an unsaved change
    await p.click("#studio-close");
    await p.waitForSelector(".studio-shelf:not([hidden])", { timeout: 5000 });
    ok(dialogs.length === 0, "Songs goes back to the shelf without asking", dialogs);
    const kept = await p.evaluate(() => JSON.parse(localStorage.getItem("studio.songs.v1"))[0].data.tracks.snare[4]);
    ok(kept === true, "and the last change was kept on the way");
    ok(await p.evaluate(() => !(window.SongStudioHost && window.SongStudioHost.playing && window.SongStudioHost.playing())), "the editor stopped playing");
    const card = p.locator(".shelf-card").first();
    ok((await p.locator(".shelf-card").count()) === 1 && /QQ Visitor Song/.test(await card.innerText()), "the shelf shows the song");

    // a card plays without opening the song
    await card.locator(".shelf-play").click();
    ok((await card.locator(".shelf-play").getAttribute("aria-pressed")) === "true", "a card's play button plays the song");
    await card.locator(".shelf-play").click();
    ok((await card.locator(".shelf-play").getAttribute("aria-pressed")) !== "true", "and stops it");

    // Copy, then delete the copy
    await card.locator(".shelf-copy, [data-act='copy']").first().click();
    await p.waitForFunction(() => document.querySelectorAll(".shelf-card").length === 2);
    ok(true, "Copy makes a second song");
    const copyCard = p.locator(".shelf-card", { hasText: "(copy)" });
    await copyCard.locator(".shelf-delete, [data-act='delete']").first().click();
    await p.waitForFunction(() => document.querySelectorAll(".shelf-card").length === 1);
    ok(JSON.parse(await p.evaluate(() => localStorage.getItem("studio.songs.v1"))).length === 1, "Delete removes it from this browser");

    // open it again from its card
    await card.locator(".shelf-open").click();
    await p.waitForFunction(() => { const n = document.getElementById("studio-name"); return n && n.value === "QQ Visitor Song" && !document.getElementById("song-builder-modal").hidden; }, null, { timeout: 10000 });
    ok(await p.evaluate(() => document.querySelector('#studio-grid .studio-cell[data-row="kick"][data-step="0"]').classList.contains("on")), "a card opens the song with its notes");

    // the search dialog opens over the Studio and gives it back as it was
    await p.click("#finder-open");
    await p.waitForSelector("#site-finder:not([hidden])", { timeout: 5000 });
    await p.keyboard.press("Escape");
    await p.waitForFunction(() => document.getElementById("site-finder").hidden, null, { timeout: 5000 });
    ok(await p.evaluate(() => document.getElementById("studio-name").value === "QQ Visitor Song" && !document.getElementById("song-builder-modal").hidden), "the search dialog opens and closes, and the song is still open");
    ok(adminCalls.length === 0, "nothing was sent to the admin API", adminCalls);
    ok(errs.length === 0, "no page errors", errs);
    await ctx.close();

    // a phone
    const m = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    const merrs = [];
    mp.on("pageerror", (e) => merrs.push(e.message));
    await mp.goto(E2E_BASE + "/studio");
    await toShelf(mp, "studio");
    const shelfOver = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await mp.tap("#new-song-btn");
    await mp.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card", { timeout: 10000 });
    const phone = await mp.evaluate(() => {
      const nav = document.querySelector("header.topbar").getBoundingClientRect();
      const name = document.getElementById("studio-name").getBoundingClientRect();
      const bpm = document.getElementById("studio-bpm");
      return { over: document.documentElement.scrollWidth - window.innerWidth, nameTop: name.top, navBottom: nav.bottom, bpmFits: bpm.scrollWidth <= bpm.clientWidth };
    });
    ok(shelfOver <= 0 && phone.over <= 0, "on a phone nothing runs past the screen", [shelfOver, phone.over]);
    ok(phone.nameTop >= phone.navBottom - 1, "and the editor's top row is below the nav, not under it", phone);
    ok(phone.bpmFits, "the tempo box shows its whole number");
    ok(merrs.length === 0, "no page errors on a phone", merrs);
    await m.close();

    // the page is in the sitemap
    const sm = await (await fetch(E2E_BASE + "/sitemap.xml")).text();
    ok(/<loc>[^<]*\/studio<\/loc>/.test(sm), "/studio is in the sitemap");
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
