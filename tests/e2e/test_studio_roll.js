// The Studio's step sequencer and piano roll: drag to paint drum steps, a strength lane under both grids, notes you can move, copy,
// resize, pick with a box, nudge with the keys, snap, zoom, the other tracks' notes as ghosts, and shift / copy / paste of a bar.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");

(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
    await p.goto(E2E_BASE + "/studio");
    await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card", { timeout: 15000 });
    await p.waitForTimeout(600);
    const song = () => p.evaluate(() => JSON.parse(JSON.stringify(window.SongStudioHost.song())));
    const cell = (row, step) => p.locator(`#studio-grid .studio-cell[data-row="${row}"][data-step="${step}"]`);
    const box = async (row, step) => { const bb = await cell(row, step).boundingBox(); return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2, w: bb.width, h: bb.height, l: bb.x, r: bb.x + bb.width }; };
    const drag = async (from, to, steps = 12) => { await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(to.x, to.y, { steps }); await p.mouse.up(); await p.waitForTimeout(120); };
    const on = (arr) => arr.map((v) => (v ? "x" : ".")).join("");
    const undo = async () => { await p.click("#studio-undo"); await p.waitForTimeout(150); };

    // ---- drums: paint a run by dragging ----
    let a = await box("kick", 0), z = await box("kick", 7);
    await drag(a, z);
    let s = await song();
    ok(on(s.tracks.kick).startsWith("xxxxxxxx") && on(s.tracks.kick).slice(8) === "........", "dragging across empty drum steps paints the whole run", on(s.tracks.kick));
    await undo();
    ok(on((await song()).tracks.kick) === "................", "and the whole drag is one undo step");
    a = await box("kick", 0); z = await box("snare", 3);
    await drag(a, z, 20);
    s = await song();
    ok(s.tracks.kick[0] && s.tracks.snare[3] && on(s.tracks.kick).includes("x") && on(s.tracks.snare).includes("x"), "a drag can cross rows too", [on(s.tracks.kick), on(s.tracks.snare)]);
    a = await box("kick", 0); z = await box("kick", 7);
    await drag(a, z);
    s = await song();
    ok(on(s.tracks.kick).slice(0, 8) === "........", "pressing on a hit and dragging erases a run of them", on(s.tracks.kick));
    await p.click("#studio-clear");
    await p.waitForFunction(() => !Object.values(window.SongStudioHost.song().tracks).some((r) => r.some(Boolean)), null, { timeout: 5000 });
    // a plain tap still toggles
    await cell("kick", 4).click();
    ok((await song()).tracks.kick[4] === true, "a plain tap still places a hit");
    // the strength lane
    const lane0 = await p.locator('.studio-lane-bar[data-lane="4"]').boundingBox();
    await p.mouse.move(lane0.x + lane0.width / 2, lane0.y + lane0.height * 0.5);
    await p.mouse.down(); await p.mouse.up();
    await p.waitForTimeout(150);
    const lv = (await song()).tracks.kick[4];
    ok(typeof lv === "number" && lv > 0.3 && lv < 0.7, "pressing halfway up the strength lane makes that hit half as strong", lv);
    ok((await p.locator('.studio-lane-bar[data-lane="4"] i').evaluate((e) => parseFloat(getComputedStyle(e).height))) > 5, "and the lane shows it");
    await p.mouse.move(lane0.x + lane0.width / 2, lane0.y + 2); await p.mouse.down(); await p.mouse.up();
    ok((await song()).tracks.kick[4] === true, "the top of the lane is full strength");

    // ---- the bar tools ----
    await p.waitForTimeout(300);
    await cell("snare", 0).click();
    await p.waitForFunction(() => window.SongStudioHost.song().tracks.snare[0] === true, null, { timeout: 5000 });
    await p.click("#studio-bars-menu-btn"); await p.click('[data-act="shift-right"]');
    s = await song();
    ok(s.tracks.snare[1] === true && !s.tracks.snare[0], "Shift the bar later moves the hits one step on", on(s.tracks.snare));
    await p.click("#studio-bars-menu-btn"); await p.click('[data-act="shift-left"]');
    ok((await song()).tracks.snare[0] === true, "and earlier moves them back");
    await p.click("#studio-bars-menu-btn"); await p.click('[data-act="copy-bar"]');
    await p.click("#studio-clear");
    ok(!(await song()).tracks.snare.some(Boolean), "Clear empties the bar");
    await p.click("#studio-bars-menu-btn"); await p.click('[data-act="paste-bar"]');
    s = await song();
    ok(s.tracks.snare[0] === true && s.tracks.kick[4] === true, "and Paste puts the copied bar back", [on(s.tracks.snare), on(s.tracks.kick)]);

    // ---- the roll ----
    await p.click("#studio-stack .studio-card >> nth=3"); // Melody
    await p.waitForTimeout(500);
    ok(await p.locator('#studio-grid[data-mode="roll"]').count() === 1, "the melody is drawn as a roll");
    // draw a held note on C4, steps 2 to 4 (drag along empty steps)
    a = await box("C4", 2); z = await box("C4", 4);
    await drag(a, z);
    const held = (await song()).melody;
    ok(held.notes.C4[2] && held.notes.C4[3] && held.notes.C4[4] && held.ties && held.ties.C4[3] && held.ties.C4[4], "dragging along empty steps draws a held note", on(held.notes.C4));
    // move it three steps right and one row up
    a = await box("C4", 3);
    z = { x: a.x + a.w * 3 + 6, y: a.y - a.h * 1 - 1 };
    await drag(a, z, 14);
    let m = (await song()).melody;
    ok(on(m.notes.C4) === "................" && m.notes["C#4"] && on(m.notes["C#4"]) === ".....xxx........", "dragging a note moves it (three steps along, one row up)", [on(m.notes.C4), on(m.notes["C#4"] || [])]);
    ok(m.ties["C#4"][6] === true && m.ties["C#4"][7] === true, "and it stays one held note");
    await undo();
    m = (await song()).melody;
    ok(on(m.notes.C4) === "..xxx..........." , "the whole move is one undo step", on(m.notes.C4));
    // resize from its right edge
    a = await box("C4", 4);
    await drag({ x: a.l + a.w * 0.85, y: a.y }, { x: a.l + a.w * 0.85 + a.w * 2, y: a.y }, 10);
    m = (await song()).melody;
    ok(on(m.notes.C4) === "..xxxxx.........", "dragging a note's right edge makes it longer", on(m.notes.C4));
    a = await box("C4", 6);
    await drag({ x: a.l + a.w * 0.85, y: a.y }, { x: a.l + a.w * 0.85 - a.w * 3, y: a.y }, 10);
    m = (await song()).melody;
    ok(on(m.notes.C4) === "..xx............", "and shorter", on(m.notes.C4));
    // Alt-drag copies
    a = await box("C4", 2);
    await p.keyboard.down("Alt");
    await drag({ x: a.x, y: a.y }, { x: a.x + a.w * 6, y: a.y }, 10);
    await p.keyboard.up("Alt");
    m = (await song()).melody;
    ok(on(m.notes.C4) === "..xx....xx......", "Alt-dragging copies the note", on(m.notes.C4));
    // box select both with Shift-drag over empty steps, then Delete
    const tl = await box("D4", 0); const br = await box("B3", 12);
    await p.keyboard.down("Shift");
    await drag({ x: tl.x, y: tl.y }, { x: br.x, y: br.y }, 12);
    await p.keyboard.up("Shift");
    ok((await p.locator("#studio-grid .studio-cell.sel").count()) === 4, "Shift-dragging a box picks the notes inside it", await p.locator("#studio-grid .studio-cell.sel").count());
    await cell("C4", 2).focus();
    await p.keyboard.press("ArrowRight");
    m = (await song()).melody;
    ok(on(m.notes.C4) === "...xx....xx.....", "the arrow keys move every picked note", on(m.notes.C4));
    await p.keyboard.press("ArrowUp");
    m = (await song()).melody;
    ok(m.notes["C#4"] && on(m.notes["C#4"]) === "...xx....xx....." && !m.notes.C4.some(Boolean), "Up moves them a semitone", on(m.notes["C#4"] || []));
    await p.keyboard.press("Delete");
    m = (await song()).melody;
    ok(!Object.values(m.notes).some((r) => r.some(Boolean)), "Delete removes the picked notes");
    await undo();
    ok(Object.values((await song()).melody.notes).some((r) => r.some(Boolean)), "and Undo brings them back");
    await p.keyboard.press("Escape");

    // the strength lane on a roll: press at a step where a note starts
    const st = (await song()).melody;
    const row = Object.keys(st.notes).find((r) => st.notes[r].some(Boolean));
    const first = st.notes[row].findIndex(Boolean);
    const lane = await p.locator(`.studio-lane-bar[data-lane="${first}"]`).boundingBox();
    await p.mouse.move(lane.x + lane.width / 2, lane.y + lane.height * 0.4); await p.mouse.down(); await p.mouse.up();
    await p.waitForTimeout(150);
    const soft = (await song()).melody.notes[row][first];
    ok(typeof soft === "number" && soft < 1, "the lane under the roll sets the strength of the notes that start on a step", soft);

    // snap to a beat
    await p.selectOption("#studio-snap-by", "4");
    const here = (await song()).melody;
    const r0 = Object.keys(here.notes).find((r) => here.notes[r].some(Boolean));
    const s0 = here.notes[r0].findIndex(Boolean);
    a = await box(r0, s0);
    await drag({ x: a.x, y: a.y }, { x: a.x + a.w * 1.2, y: a.y }, 8);
    const snapped = (await song()).melody.notes[r0].findIndex(Boolean);
    ok(snapped % 4 === 0, "with Snap on 1/4 a note lands on a beat", [s0, snapped]);
    await p.selectOption("#studio-snap-by", "1");

    // zoom
    const rowH = () => p.evaluate(() => document.querySelector("#studio-grid .studio-row[data-row]").getBoundingClientRect().height);
    const h1 = await rowH();
    await p.click('[data-act="zoom-in"]'); await p.click('[data-act="zoom-in"]');
    await p.waitForTimeout(200);
    ok((await rowH()) > h1 * 1.2 || h1 >= 30, "Zoom in makes the rows taller", [h1, await rowH()]);
    ok(await p.locator("#studio-grid[data-zoomed]").count() === 1, "and marks the grid as zoomed");
    await p.click('[data-act="zoom-out"]'); await p.click('[data-act="zoom-out"]');
    ok(await p.locator("#studio-grid[data-zoomed]").count() === 0, "Zoom out puts it back");

    // ghosts of the other tracks: a Lead note on E4 shows faintly on the Melody roll, which shares that pitch
    await p.click("#studio-stack .studio-card >> nth=4"); // Lead
    await p.waitForTimeout(500);
    a = await box("E4", 9);
    await p.mouse.click(a.x, a.y);
    await p.waitForTimeout(200);
    ok((await song()).lead.notes.E4[9], "a note is placed on the Lead roll");
    await p.click("#studio-stack .studio-card >> nth=3");
    await p.waitForTimeout(500);
    ok(await cell("E4", 9).evaluate((e) => e.classList.contains("ghost") && !e.classList.contains("on")), "notes of the other tracks show faintly behind this one");
    await p.click("#studio-stack .studio-card >> nth=4");
    await p.waitForTimeout(400);
    ok(!(await cell("E4", 9).evaluate((e) => e.classList.contains("ghost"))), "and a track's own notes are not ghosts on its own roll");

    ok(errs.length === 0, "no page errors", errs);
    await p.context().close();
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
