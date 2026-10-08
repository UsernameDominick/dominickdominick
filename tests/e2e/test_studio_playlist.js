// The Studio's playlist: the five tracks as rows like a DAW's, each with its bars as clips on a timeline. Checks the rows, the ruler, a clip
// opening its track in that bar, the M buttons, the pictures in the clips, the arrow keys, the line that follows the music, the header staying
// put while the timeline scrolls, a short screen (the playlist scrolls and keeps the open track in view), and axe in both themes on a phone too.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
const axeSrc = axeSource();
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    const mk = async (viewport, extra) => {
      const ctx = await b.newContext(Object.assign({ viewport }, extra || {}));
      await ctx.addInitScript(() => { try { localStorage.setItem("studioTipSeen", "1"); } catch (e) { /* none */ } });
      const p = await ctx.newPage();
      p.errs = []; p.on("pageerror", (e) => p.errs.push(e.message)); p.on("dialog", (d) => d.accept());
      await p.goto(E2E_BASE + "/studio");
      await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card-main", { timeout: 30000 });
      await p.waitForTimeout(700);
      return p;
    };
    const front = (p) => p.evaluate(() => { const c = document.querySelector('#studio-stack .studio-card[data-pos="front"]'); return c ? c.dataset.card : null; });
    const letters = (p, t) => p.evaluate((id) => [...document.querySelectorAll(`#studio-stack [data-card="${id}"] [data-clip]`)].map((c) => c.querySelector("i").textContent || "-").join(""), t);
    const clipCount = (p, t) => p.locator(`#studio-stack [data-card="${t}"] [data-clip]`).count();
    const longer = async (p, n) => { await p.click("#studio-bars-menu-btn"); for (let i = 0; i < n; i++) await p.click('#studio-bars-menu [data-act="bars-more"]'); await p.keyboard.press("Escape"); await p.waitForTimeout(250); };

    // ======== a desktop window ========
    const p = await mk({ width: 1280, height: 900 });
    const names = await p.evaluate(() => [...document.querySelectorAll("#studio-stack .studio-card")].map((c) => c.dataset.card + ":" + c.querySelector(".studio-badge").textContent + ":" + c.querySelector(".studio-card-name").textContent).join("|"));
    ok(names === "drums:1:Drums|bass:2:Bass|chords:3:Chords|melody:4:Melody|lead:5:Lead", "five rows, always in the same order, numbered 1 to 5", names);
    ok(await p.evaluate(() => [...document.querySelectorAll("#studio-stack .studio-card")].every((c) => c.querySelector(".studio-pl-head") && c.querySelector(".studio-pl-lane"))), "each row has a header on the left and a lane for its bars");
    const tops = await p.evaluate(() => ["studio-stack", "studio-detail", "studio-play", "studio-keys"].map((i) => Math.round(document.getElementById(i).getBoundingClientRect().top)));
    ok(tops[0] < tops[1] && tops[1] < tops[2] && tops[2] < tops[3], "the playlist comes first, then the open track, the play controls and the keys", tops);
    ok((await clipCount(p, "drums")) === 1 && (await p.locator("#studio-pl-marks .studio-pl-mark").first().textContent()) === "1", "a new song is one bar: one clip per row, and the ruler starts at 1");
    await longer(p, 3);
    ok((await clipCount(p, "bass")) === 4 && (await p.evaluate(() => [...document.querySelectorAll("#studio-pl-marks .studio-pl-mark")].map((m) => m.textContent).filter(Boolean).join(","))) === "1,2,3,4", "a four bar song has four clips in every row and the numbers 1 to 4 on the ruler");
    ok(await p.evaluate(() => getComputedStyle(document.getElementById("studio-pl-marks")).backgroundImage !== "none"), "and the ruler's ticks carry on past the end");
    ok((await letters(p, "drums")) === "AAAA" && (await p.locator('#studio-stack [data-card="drums"] .studio-clip.is-repeat').count()) === 3, "the bars a looping track repeats are marked as repeats (dashed)", await letters(p, "drums"));

    // a clip opens its track in that bar
    // (a part the song has not used yet is made empty in memory when its track opens, so only the music itself is compared)
    const songJson = () => p.evaluate(() => { const d = window.SongStudioHost.song(); const only = (x) => (x ? Object.keys(x.notes || {}).filter((n) => x.notes[n].some(Boolean)) : []); return JSON.stringify({ tracks: d.tracks, melody: only(d.melody), bass: only(d.bass), chords: only(d.chords), lead: only(d.lead), lanes: d.lanes, bars: d.bars }); });
    const before = await songJson();
    await p.click('#studio-stack [data-card="bass"] [data-clip][data-bar="2"]');
    await p.waitForTimeout(250);
    ok((await front(p)) === "bass" && (await p.getAttribute('#studio-stack [data-card="bass"] [data-clip][data-bar="2"]', "aria-pressed")) === "true", "tapping a clip opens that track in that bar", await front(p));
    ok(/Bass/.test(await p.textContent("#studio-editing")) && /Bar 3/.test(await p.textContent("#studio-editing")), "and the open track says which bar it is editing", await p.textContent("#studio-editing"));
    await p.click('#studio-stack [data-card="melody"] .studio-pl-lane', { position: { x: 300, y: 10 } });
    await p.waitForTimeout(250);
    ok((await front(p)) === "melody", "the empty part of a row opens its track too", await front(p));
    ok((await songJson()) === before, "choosing tracks and bars changes nothing in the song");

    // + Bar gives the open track a bar of its own
    await p.click('#studio-stack [data-pick="drums"]');
    await p.waitForTimeout(250);
    await p.click('#studio-detail [data-act="bar-add"]');
    await p.waitForTimeout(300);
    ok((await letters(p, "drums")) === "ABAB" && (await letters(p, "bass")) === "AAAA", "+ Bar adds a pattern to the open track only (the drums now read A B A B)", [await letters(p, "drums"), await letters(p, "bass")]);

    // the picture in a clip is the pattern of that bar
    await p.click('#studio-stack [data-card="drums"] [data-clip][data-bar="0"]');
    await p.waitForTimeout(250);
    await p.locator('#studio-grid .studio-cell[data-row="kick"][data-step="0"]').click();
    await p.locator('#studio-grid .studio-cell[data-row="snare"][data-step="4"]').click();
    await p.waitForTimeout(900);
    const rects = (bar) => p.locator(`#studio-stack [data-card="drums"] [data-clip][data-bar="${bar}"] .studio-dots rect`).count();
    ok((await rects(0)) === 2 && (await rects(2)) === 2 && (await rects(1)) === 0, "a clip pictures its own pattern: the two hits show in bars 1 and 3 (pattern A), not in bar 2 (B)", [await rects(0), await rects(1), await rects(2)]);
    ok(/2 hits/.test(await p.textContent('#studio-stack [data-card="drums"] .studio-card-meta > span')), "and the header counts the hits of the bar being edited");

    // M mutes a track without taking the editor away from the open one
    await p.click('#studio-stack [data-mute="lead"]');
    await p.waitForTimeout(400);
    ok((await front(p)) === "drums" && (await p.getAttribute('#studio-stack [data-mute="lead"]', "aria-pressed")) === "true" && /muted/.test(await p.getAttribute('#studio-stack [data-card="lead"] .studio-card-main', "aria-label")), "the M button mutes its track and the open track stays open", await front(p));
    await p.click('#studio-stack [data-mute="lead"]');
    await p.waitForTimeout(400);
    ok((await p.getAttribute('#studio-stack [data-mute="lead"]', "aria-pressed")) === "false" && (await front(p)) === "drums", "and it unmutes the same way");

    // the arrow keys
    await p.focus('#studio-stack [data-card="drums"] [data-clip][data-bar="0"]');
    await p.keyboard.press("ArrowRight");
    ok(await p.evaluate(() => document.activeElement.dataset.track === "drums" && document.activeElement.dataset.bar === "1"), "the arrow keys go along a row's bars");
    await p.keyboard.press("ArrowDown");
    ok(await p.evaluate(() => document.activeElement.dataset.track === "bass" && document.activeElement.dataset.bar === "1"), "and down to the next track in the same bar");
    await p.keyboard.press("Enter");
    await p.waitForTimeout(250);
    ok((await front(p)) === "bass", "Enter opens the focused clip", await front(p));
    await p.focus('#studio-stack [data-pick="bass"]');
    await p.keyboard.press("ArrowDown");
    await p.waitForTimeout(250);
    ok((await front(p)) === "chords" && (await p.evaluate(() => document.activeElement.dataset.pick)) === "chords", "on a header the arrow keys move through the tracks and keep the focus", await front(p));

    // the line that follows the music
    await p.click('#studio-stack [data-pick="drums"]');
    await p.waitForTimeout(250);
    ok((await p.locator("#studio-playhead.is-on").count()) === 0, "the playhead is not shown while nothing plays");
    await p.click("#studio-play");
    await p.waitForTimeout(900);
    const during = await p.evaluate(() => ({ on: document.getElementById("studio-playhead").classList.contains("is-on"), ph: Number(document.getElementById("studio-pl-grid").style.getPropertyValue("--ph")), now: document.querySelectorAll("#studio-stack .studio-clip.is-now").length, markNow: document.querySelectorAll("#studio-pl-marks .is-now").length }));
    ok(during.on && during.ph >= 0 && during.now === 5 && during.markNow === 1, "while it plays a line crosses the rows, the bar sounding is lit in every row and on the ruler", during);
    await p.click("#studio-stop");
    await p.waitForTimeout(300);
    ok((await p.locator("#studio-playhead.is-on").count()) === 0 && (await p.locator("#studio-stack .studio-clip.is-now").count()) === 0, "and it goes away when the music stops");

    // the headers stay put while the timeline scrolls
    await longer(p, 8);
    const sticky = await p.evaluate(async () => {
      const box = document.getElementById("studio-pl-scroll");
      box.scrollLeft = 260;
      await new Promise((r) => setTimeout(r, 120));
      const left = box.getBoundingClientRect().left;
      return { moved: box.scrollLeft, scrolls: box.scrollWidth > box.clientWidth, heads: [...document.querySelectorAll("#studio-stack .studio-pl-head")].map((h) => Math.round(h.getBoundingClientRect().left - left)), corner: Math.round(document.querySelector(".studio-pl-corner").getBoundingClientRect().left - left) };
    });
    ok(sticky.scrolls && sticky.moved > 100 && sticky.heads.every((x) => Math.abs(x) <= 1) && Math.abs(sticky.corner) <= 1, "a long song scrolls sideways while the track headers stay in view", sticky);
    const detailH = await p.evaluate(() => document.getElementById("studio-detail").getBoundingClientRect().height);
    ok(detailH >= 240, "and the open track keeps room to work in", detailH);

    // axe, both themes
    await p.addScriptTag({ content: axeSrc }).catch(() => {});
    for (const theme of ["dark", "light"]) {
      await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await p.waitForTimeout(250);
      const v = await p.evaluate(async () => (await axe.run(document.getElementById("studio-stack"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" ; ")));
      ok(v.length === 0, `axe: the playlist is clean in the ${theme} theme`, v);
    }
    ok(p.errs.length === 0, "no page errors", p.errs);
    await p.context().close();

    // ======== a phone, tall enough for all five rows ========
    const m = await mk({ width: 390, height: 880 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const fits = await m.evaluate(() => { const box = document.getElementById("studio-pl-scroll").getBoundingClientRect(); const cards = [...document.querySelectorAll("#studio-stack .studio-card")].map((c) => c.getBoundingClientRect()); return { allIn: cards.every((r) => r.top >= box.top - 1 && r.bottom <= box.bottom + 1), doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, h: cards.map((r) => Math.round(r.height)) }; });
    ok(fits.allIn && fits.doc <= 0 && fits.h.every((x) => x >= 28), "on a tall phone all five rows are in view and nothing runs off the side", fits);
    await m.tap('#studio-stack [data-card="chords"] [data-clip][data-bar="0"]');
    await m.waitForTimeout(250);
    ok((await front(m)) === "chords", "a finger tap on a clip opens its track", await front(m));
    ok(await m.evaluate(() => [...document.querySelectorAll("#studio-stack [data-clip], #studio-stack [data-mute], #studio-stack [data-pick]")].every((c) => { const r = c.getBoundingClientRect(); return r.width >= 24 && r.height >= 24; })), "the clips, the headers and the M buttons are all at least 24 px");
    await m.addScriptTag({ content: axeSrc }).catch(() => {});
    for (const theme of ["dark", "light"]) {
      await m.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await m.waitForTimeout(250);
      const v = await m.evaluate(async () => (await axe.run(document.getElementById("song-studio"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" ; ")));
      ok(v.length === 0, `axe: the Studio on a phone is clean in the ${theme} theme`, v);
    }
    ok(m.errs.length === 0, "no page errors on the phone", m.errs);
    await m.context().close();

    // ======== a short phone: the playlist scrolls and keeps the open track in view ========
    const s = await mk({ width: 390, height: 640 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const short = await s.evaluate(() => { const box = document.getElementById("studio-pl-scroll"); return { scrolls: box.scrollHeight > box.clientHeight + 4, visibleRows: Math.round((box.clientHeight - 16) / 30 * 10) / 10, detail: Math.round(document.getElementById("studio-detail").getBoundingClientRect().height) }; });
    ok(short.scrolls && short.detail >= 240, "on a short screen the playlist scrolls up and down and the open track keeps its room", short);
    await s.evaluate(() => window.SongStudio.select("lead"));
    await s.waitForTimeout(400);
    const inView = await s.evaluate(() => { const box = document.getElementById("studio-pl-scroll").getBoundingClientRect(); const r = document.querySelector('#studio-stack [data-card="lead"]').getBoundingClientRect(); return r.top >= box.top + 12 && r.bottom <= box.bottom + 1; });
    ok(inView && (await front(s)) === "lead", "choosing a track scrolls its row into view", await front(s));
    ok(s.errs.length === 0, "no page errors on the short phone", s.errs);
    await s.context().close();
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
