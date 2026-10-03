const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs"); const fs = require("fs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const ALL = []; [4, 3].forEach((o) => { for (let i = 11; i >= 0; i--) ALL.push(NAMES[i] + o); });
  const melody = {}; ALL.forEach((n) => (melody[n] = Array(16).fill(false)));
  [2, 3, 4].forEach((i) => (melody.C4[i] = true)); [8, 9].forEach((i) => (melody.E4[i] = true)); melody.G4[12] = true;
  const mk = (extra) => c.fetch(`${BASE}/api/admin/songs`, { method: "POST", data: { name: "QQ Ties", data: { tempo: 100, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1, tracks: { kick: Array(16).fill(false), snare: Array(16).fill(false), hihat: Array(16).fill(false), clap: Array(16).fill(false) }, trackMeta: {}, melody: { waveform: "sine", notes: melody, ...extra } } } }).then((r) => r.json());
  let created = await mk();
  // the API refuses junk
  let r = await c.fetch(`${BASE}/api/admin/songs/${created.id}`, { method: "PATCH", data: { name: "QQ Ties", data: { melody: { notes: melody, ties: [] } } } });
  ok(r.status() === 400, "the API refuses ties that are not an object", r.status());
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const [w, h, label] of [[1440, 900, "desktop"], [390, 800, "phone"]]) {
    const p = await (await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: w, height: h } })).newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("dialog", (d) => d.accept());
    const t = `[${label}]`;
    if (label !== "desktop") { await c.fetch(`${BASE}/api/admin/songs/${created.id}`, { method: "DELETE" }); created = await mk(); }
    try {
      await p.goto(`${BASE}/admin/`); await p.waitForSelector("#app:not([hidden])"); await p.evaluate(() => document.getElementById("songs-btn").click()); await p.waitForSelector("#songs-modal:not([hidden])"); await p.waitForTimeout(300);
      await p.locator(`.edit-song[data-id="${created.id}"]`).click(); await p.waitForSelector("#song-builder-modal:not([hidden])"); await p.waitForTimeout(800);
      await p.evaluate(() => { document.getElementById("song-melody-tools").open = true; });
      const cell = (row, step) => p.locator(`#song-piano-roll .song-steps[data-row="${row}"] .song-step[data-step="${step}"]`);
      const tiedCells = () => p.evaluate(() => [...document.querySelectorAll("#song-piano-roll .song-step-tied")].map((e) => `${e.dataset.row}:${e.dataset.step}`).sort().join(" "));
      const onCells = () => p.evaluate(() => { const out = []; document.querySelectorAll("#song-piano-roll .song-steps").forEach((r) => [...r.children].forEach((x, i) => { if (x.classList.contains("song-step-on")) out.push(`${r.dataset.row}:${i}`); })); return out.sort().join(" "); });
      const say = () => p.textContent("#song-melody-tools-note");
      const saved = async () => { await p.waitForTimeout(3200); const s = await (await c.fetch(`${BASE}/api/admin/songs/${created.id}`)).json(); return s.data.melody.ties || null; };
      ok((await tiedCells()) === "", `${t} nothing is tied to start with`);
      // shift+click ties the pair
      await cell("C4", 3).click({ modifiers: ["Shift"] });
      ok((await tiedCells()) === "C4:3", `${t} Shift+click on the second of two notes ties it`, await tiedCells());
      ok(/C4 steps 3 and 4 tied/.test(await say()), `${t} and says so`, await say());
      ok((await cell("C4", 3).getAttribute("aria-description")) === "Held: tied to the same note on the step before" && (await cell("C4", 3).getAttribute("class")).includes("song-step-on"), `${t} the cell is announced as held and is still on`);
      ok(await onCells() === "C4:2 C4:3 C4:4 E4:8 E4:9 G4:12", `${t} Shift+click did not switch any note on or off`, await onCells());
      const ties1 = await saved();
      ok(ties1 && ties1.C4 && ties1.C4[3] === true && ties1.C4.filter(Boolean).length === 1, `${t} the tie is saved with the song`, ties1);
      // shift+click again unties
      await cell("C4", 3).click({ modifiers: ["Shift"] });
      ok((await tiedCells()) === "" && /untied/.test(await say()), `${t} Shift+click again unties it`, await say());
      // can't tie where there is nothing to join
      await cell("G4", 12).click({ modifiers: ["Shift"] });
      ok((await tiedCells()) === "" && /can't be tied/.test(await say()), `${t} a lone note can't be tied, and it says why`, await say());
      await cell("C4", 2).click({ modifiers: ["Shift"] });
      ok((await tiedCells()) === "" && /can't be tied/.test(await say()), `${t} nor the first note of a pair`);
      // keyboard: shift+enter
      await cell("E4", 9).focus(); await p.keyboard.press("Shift+Enter"); await p.waitForTimeout(200);
      ok((await tiedCells()) === "E4:9", `${t} Shift+Enter on a focused note ties it`, await tiedCells());
      // turning a tied note off removes the tie, turning it back on does not bring it back
      await cell("E4", 9).click(); await p.waitForTimeout(200);
      ok((await tiedCells()) === "", `${t} turning a tied note off drops the tie`, await tiedCells());
      await cell("E4", 9).click(); await p.waitForTimeout(200);
      ok((await tiedCells()) === "", `${t} and turning it back on does not resurrect it`);
      // undo
      await p.click("#song-undo"); await p.click("#song-undo");
      ok((await tiedCells()) === "E4:9", `${t} Undo steps back through the edits (two undos restore the tie)`, await tiedCells());
      // tie repeated notes
      await p.click("#song-melody-tie-repeats");
      ok((await tiedCells()) === "C4:3 C4:4 E4:9" && /3 repeated notes tied/.test(await say()), `${t} Tie repeated notes ties every adjacent pair`, [await tiedCells(), await say()]);
      // shift keeps ties with notes
      await p.click("#song-melody-shift-right");
      ok((await tiedCells()) === "C4:4 C4:5 E4:10", `${t} shifting a step later moves the ties with the notes`, await tiedCells());
      await p.click("#song-melody-shift-left");
      ok((await tiedCells()) === "C4:3 C4:4 E4:9", `${t} and back`);
      // reverse
      await p.click("#song-melody-reverse");
      ok((await tiedCells()) === "C4:12 C4:13 E4:7", `${t} reversing keeps each pair joined`, await tiedCells());
      await p.click("#song-melody-reverse");
      ok((await tiedCells()) === "C4:3 C4:4 E4:9", `${t} and reversing back restores them`);
      // transpose up a semitone moves them to C#4 / F4
      await p.click("#song-transpose-up"); await p.waitForTimeout(200);
      ok((await tiedCells()) === "C#4:3 C#4:4 F4:9", `${t} transposing carries the ties to the new rows`, await tiedCells());
      await p.click("#song-transpose-down");
      ok((await tiedCells()) === "C4:3 C4:4 E4:9", `${t} and back`);
      // chord stamp keeps ties
      await p.selectOption("#song-chord-root", "C3"); await p.fill("#song-chord-step", "14"); await p.click("#song-chord-stamp");
      ok((await tiedCells()) === "C4:3 C4:4 E4:9", `${t} stamping a chord leaves the ties alone`, await tiedCells());
      // saved
      const ties2 = await saved();
      ok(ties2 && ties2.C4[3] && ties2.C4[4] && ties2.E4[9], `${t} the saved ties match`, ties2);
      // the sound: a held note renders differently from two struck ones
      const peaks = await p.evaluate(async () => {
        const base = () => ({ tempo: 100, kit: "acoustic", tracks: {}, master_volume: 1, melody: { waveform: "sine", notes: { C4: Array.from({ length: 16 }, (_, i) => i === 2 || i === 3) } } });
        const a = base(); const bb = base(); bb.melody.ties = { C4: Array.from({ length: 16 }, (_, i) => i === 3) };
        const pa = await window.SongEngine.renderWaveformPeaks(a, 64); const pb = await window.SongEngine.renderWaveformPeaks(bb, 64);
        return { same: JSON.stringify(pa) === JSON.stringify(pb), sumA: pa.reduce((s, x) => s + Math.abs(x[1]) + Math.abs(x[0]), 0), sumB: pb.reduce((s, x) => s + Math.abs(x[1]) + Math.abs(x[0]), 0) };
      });
      ok(!peaks.same, `${t} the rendered audio of a held note differs from two struck notes`, peaks);
      // untie all
      await p.click("#song-melody-untie");
      ok((await tiedCells()) === "" && /All held notes untied/.test(await say()), `${t} Untie all removes every tie`, await say());
      await p.click("#song-melody-untie");
      ok(/No notes are held yet/.test(await say()), `${t} and says so when there are none`);
      ok((await saved()) === null, `${t} the saved song has no ties key once none are left`);
      // random and arpeggio clear ties
      await p.click("#song-melody-tie-repeats");
      await p.click("#song-melody-random");
      ok((await tiedCells()) === "", `${t} a random tune starts with no ties`);
      await p.click("#song-undo"); await p.click("#song-undo");
      // a11y + layout
      await p.addScriptTag({ content: require("./_pw.cjs").axeSource() });
      const viol = await p.evaluate(async () => (await axe.run(document.getElementById("song-melody-tools"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ":" + v.nodes.length));
      ok(viol.length === 0, `${t} axe finds nothing in the melody tools`, viol);
      await p.click("#song-melody-tie-repeats"); await p.waitForTimeout(200);
      const bridge = await p.evaluate(() => { const e = document.querySelector("#song-piano-roll .song-step-tied"); const cs = getComputedStyle(e, "::before"); return { content: cs.content, width: cs.width }; });
      ok(/""|"\"/.test(bridge.content) || bridge.content === '""', `${t} a tied note draws its bridge`, bridge);
      ok(!(await p.evaluate(() => { const d = document.getElementById("song-melody-tools"); return d.scrollWidth > d.clientWidth + 1; })), `${t} the tools do not spill sideways`);
      ok(errs.length === 0, `${t} no page errors`, errs);
    } finally { await p.close(); }
  }
  await c.fetch(`${BASE}/api/admin/songs/${created.id}`, { method: "DELETE" });
  await b.close();
  console.log(f ? "FAILURES " + f : "ALL PASS"); process.exit(f ? 1 : 0);
})();
