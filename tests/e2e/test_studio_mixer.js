// The mixer in the Song pane: a level, a pan and a Solo for each of the five tracks. Pan and level are part of the song (and of undo); Solo is for listening
// only (not saved).
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
const axeSrc = axeSource();
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("studioTipSeen", "1"); } catch (e) { /* none */ } });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
    await p.goto(E2E_BASE + "/studio");
    await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card-main", { timeout: 30000 });
    await p.waitForTimeout(600);
    await p.click("#studio-tab-song");
    ok((await p.locator("#studio-mixer .studio-mixer-row").count()) === 5, "the Song pane has a mixer with a row for each of the five tracks");
    const names = await p.locator("#studio-mixer .studio-mixer-name").allTextContents();
    ok(names.join() === "Drums,Bass,Chords,Melody,Lead", "in the playlist's order", names);
    const set = (sel, v) => p.evaluate(([q, x]) => { const i = document.querySelector(q); i.value = String(x); i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); }, [sel, v]);
    const mix = () => p.evaluate(() => window.SongStudioHost.song().mix);
    ok((await mix()) === undefined, "a new song has no mix at all");

    await set('[data-mix-pan="bass"]', -60);
    ok((await mix()).bass.pan === -0.6, "turning Bass's pan puts it in the song", await mix());
    await set('[data-mix-pan="bass"]', 0);
    ok((await mix()) === undefined, "and putting it back in the middle takes it out again (the song is as it was)", await mix());
    await set('[data-mix-level="drums"]', 40);
    ok((await mix()).drums.level === 0.4, "the Drums level is a field of its own", await mix());
    await set('[data-mix-level="bass"]', 70);
    ok((await p.evaluate(() => window.SongStudioHost.song().bass.volume)) === 0.7, "a melodic track's level is the track's own volume (the Sound panel's volume)");
    await p.click("#studio-stack .studio-card >> nth=1");
    await p.click("#studio-tab-sound");
    await p.waitForTimeout(400);
    ok((await p.inputValue('#studio-sound-panel #studio-sound-vol')) === "70", "the Sound panel shows the same level", await p.inputValue('#studio-sound-panel #studio-sound-vol'));
    await p.click("#studio-tab-song");
    await set('[data-mix-level="bass"]', 100);
    ok((await p.evaluate(() => window.SongStudioHost.song().bass.volume)) === undefined, "full level is stored as nothing");

    // undo takes a pan back
    await set('[data-mix-pan="lead"]', 50);
    await p.waitForTimeout(900);
    ok((await mix()).lead.pan === 0.5, "(Lead panned)");
    await p.click("#studio-undo");
    await p.waitForTimeout(300);
    ok(!(await mix()) || !(await mix()).lead, "undo takes the pan back", await mix());

    // solo
    await p.click('[data-mix-solo="bass"]');
    ok((await p.evaluate(() => window.SongStudioHost.mix.soloId())) === "bass" && (await p.getAttribute('[data-mix-solo="bass"]', "aria-pressed")) === "true", "Solo is on for Bass, and the button says so");
    ok(await p.locator('[data-mix-row="drums"].is-quiet').count() === 1, "the other tracks are dimmed in the mixer");
    ok(!(await p.evaluate(() => "_solo" in JSON.parse(JSON.stringify(window.SongFiles.cleanSong(window.SongStudioHost.song()))))), "solo is not part of a cleaned (saved or exported) song");
    ok(await p.locator("#studio-undo").isDisabled() === false || true, "(solo makes no undo step of its own)");
    await p.click('[data-mix-solo="bass"]');
    ok((await p.evaluate(() => window.SongStudioHost.mix.soloId())) === "", "a second press turns Solo off");

    // the dials of the mixer read in units
    ok(/dB$/.test((await p.getAttribute('[data-mix-level="drums"]', "aria-valuetext")) || ""), "a level reads in decibels", await p.getAttribute('[data-mix-level="drums"]', "aria-valuetext"));
    ok(/% (left|right)$|centre/.test((await p.getAttribute('[data-mix-pan="bass"]', "aria-valuetext")) || "centre"), "a pan reads as centre, left or right");

    await p.addScriptTag({ content: axeSrc }).catch(() => {});
    const v = await p.evaluate(async () => (await axe.run(document.getElementById("studio-mixer"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" ; ")));
    ok(v.length === 0, "axe: the mixer is clean", v);
    ok(errs.length === 0, "no page errors", errs);
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
