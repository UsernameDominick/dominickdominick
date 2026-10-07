// Playing live in the Studio: every key is labelled, a key can be held (and kept with Hold), the pitch wheel bends and springs back, pads
// hit harder lower down and roll when held, and the Play options (arpeggio, strum, random) make the notes; on a phone Tools is a dropdown.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
const axeSrc = axeSource();
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1360, height: 860 } });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
    const open = async (play) => {
      await p.goto(E2E_BASE + "/studio");
      await p.evaluate((v) => { localStorage.setItem("studioPlay", JSON.stringify(v)); }, play || {});
      await p.reload();
      await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-keys .studio-pad", { timeout: 30000 });
    };
    const spy = () => p.evaluate(() => {
      const h = window.SongStudioHost; window.__calls = [];
      for (const k of ["note", "hit", "noteOn"]) { const o = h[k]; h[k] = (...a) => { window.__calls.push([k, ...a]); return o(...a); }; }
    });
    const calls = (k) => p.evaluate((kind) => window.__calls.filter((c) => c[0] === kind), k);
    const toMelody = async () => { await p.click("#studio-stack .studio-card >> nth=3"); await p.waitForSelector("#studio-keys .studio-key"); await p.waitForTimeout(300); };

    // --- drum pads ---
    await open({});
    await spy();
    const pad = p.locator('.studio-pad[data-pad="kick"]');
    const pb = await pad.boundingBox();
    await p.mouse.move(pb.x + pb.width / 2, pb.y + 4); await p.mouse.down(); await p.mouse.up();
    await p.mouse.move(pb.x + pb.width / 2, pb.y + pb.height - 4); await p.mouse.down(); await p.mouse.up();
    const hits = await calls("hit");
    ok(hits.length === 2 && hits[0][2] < 0.5 && hits[1][2] > 0.9, "a pad hit near its top is soft and near its bottom is hard", hits);
    ok((await pad.textContent()).includes("Kick"), "the pad is labelled");

    // --- a pad roll ---
    await open({ padMode: "roll", rate: "1/16" });
    await spy();
    const pb2 = await p.locator('.studio-pad[data-pad="hihat"]').boundingBox();
    await p.mouse.move(pb2.x + pb2.width / 2, pb2.y + pb2.height - 6); await p.mouse.down();
    await p.waitForTimeout(700);
    ok(await p.locator('.studio-pad[data-pad="hihat"]').evaluate((e) => e.classList.contains("rolling")), "a held pad on Roll shows it is rolling");
    await p.mouse.up();
    const rolled = (await calls("hit")).length;
    ok(rolled >= 4 && rolled <= 9, "holding a pad on Roll at 1/16 repeats the hit", rolled);
    await p.waitForTimeout(400);
    ok((await calls("hit")).length === rolled, "and it stops when let go");
    // Hold keeps a roll going
    await spy();
    await p.click("#studio-sustain");
    await p.mouse.move(pb2.x + pb2.width / 2, pb2.y + pb2.height - 6); await p.mouse.down(); await p.mouse.up();
    await p.waitForTimeout(600);
    const keptRolling = (await calls("hit")).length;
    ok(keptRolling >= 4, "with Hold on, a roll keeps going after the pad is let go", keptRolling);
    await p.click("#studio-sustain");
    const afterOff = (await calls("hit")).length;
    await p.waitForTimeout(400);
    ok((await calls("hit")).length <= afterOff + 1, "and stops when Hold is switched off");

    // --- keys: labels, hold, the wheel ---
    await open({});
    await toMelody();
    const labelled = await p.evaluate(() => [...document.querySelectorAll("#studio-keys .studio-key")].every((k) => (k.querySelector(".k-name").textContent || "").trim().length >= 1));
    ok(labelled, "every key carries its name");
    ok((await p.locator('.studio-key-white[data-key="C4"] .k-name').textContent()).replace(/\s/g, "") === "C4" && (await p.locator('.studio-key-black[data-key="C#4"] .k-name').textContent()) === "C#", "a white key reads C4 and a black one C#");
    await spy();
    const key = p.locator('.studio-key-white[data-key="E3"]');
    const kb = await key.boundingBox();
    await p.mouse.move(kb.x + kb.width / 2, kb.y + kb.height - 10); await p.mouse.down();
    await p.waitForTimeout(250);
    ok(await key.evaluate((e) => e.classList.contains("held")), "a key stays lit while it is held");
    ok((await calls("noteOn")).length === 1, "and plays a held note", await calls("noteOn"));
    await p.mouse.up();
    await p.waitForTimeout(100);
    ok(!(await key.evaluate((e) => e.classList.contains("held"))), "it lets go when the button comes up");
    // Hold
    await p.click("#studio-sustain");
    await p.mouse.move(kb.x + kb.width / 2, kb.y + kb.height - 10); await p.mouse.down(); await p.mouse.up();
    await p.waitForTimeout(200);
    ok(await key.evaluate((e) => e.classList.contains("held")), "with Hold on, a key stays down after it is let go");
    await p.click("#studio-sustain");
    await p.waitForTimeout(100);
    ok(!(await key.evaluate((e) => e.classList.contains("held"))), "and lets go when Hold is switched off");
    // the wheel
    const wb = await p.locator("#studio-wheel").boundingBox();
    await p.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2); await p.mouse.down();
    await p.mouse.move(wb.x + wb.width / 2, wb.y + 4, { steps: 4 });
    const bent = Number(await p.getAttribute("#studio-wheel", "aria-valuenow"));
    ok(bent > 60, "dragging the pitch wheel up bends up", bent);
    await p.mouse.up();
    await p.waitForFunction(() => document.getElementById("studio-wheel").getAttribute("aria-valuenow") === "0", null, { timeout: 3000 }).catch(() => {});
    ok((await p.getAttribute("#studio-wheel", "aria-valuenow")) === "0", "and it springs back to the middle when let go");

    // --- arpeggio ---
    await open({ mode: "arp", rate: "1/16", pattern: "up", octaves: 1 });
    await toMelody();
    await spy();
    for (const n of ["C3", "E3", "G3"]) {
      const kk = await p.locator(`.studio-key[data-key="${n}"]`).boundingBox();
      await p.mouse.move(kk.x + kk.width / 2, kk.y + kk.height - 8); await p.mouse.down(); await p.mouse.up(); // each is tapped, and Hold keeps it
      if (n === "C3") await p.click("#studio-sustain");
    }
    await p.waitForTimeout(900);
    const arpNotes = (await calls("note")).map((c) => c[1]);
    ok(arpNotes.length >= 5 && new Set(arpNotes).size === 3 && arpNotes.slice(0, 3).join() === "C3,E3,G3", "an arpeggio cycles the held keys in order", arpNotes);
    ok((await calls("note")).every((c) => c[2] && c[2].duration > 0.05 && c[2].duration < 0.13), "each note is a fraction of the step long", (await calls("note"))[0]);
    await p.click("#studio-sustain");
    const arpDone = (await calls("note")).length;
    await p.waitForTimeout(400);
    ok((await calls("note")).length <= arpDone, "and it stops when Hold goes off");

    // --- strum ---
    await open({ mode: "strum", chord: "major", spread: 70, dir: "down" });
    await toMelody();
    await spy();
    const sk = await p.locator('.studio-key[data-key="C3"]').boundingBox();
    await p.mouse.move(sk.x + sk.width / 2, sk.y + sk.height - 8); await p.mouse.down();
    await p.waitForTimeout(400);
    const strummed = (await calls("noteOn")).map((c) => c[1]);
    await p.mouse.up();
    ok(strummed.join() === "C3,E3,G3", "a strum plays the chord on the key, low to high", strummed);

    // --- random ---
    await open({ mode: "random", rate: "1/16", octaves: 2 });
    await toMelody();
    await spy();
    for (const n of ["C3", "G3"]) {
      const kk = await p.locator(`.studio-key[data-key="${n}"]`).boundingBox();
      await p.mouse.move(kk.x + kk.width / 2, kk.y + kk.height - 8); await p.mouse.down(); await p.mouse.up();
      if (n === "C3") await p.click("#studio-sustain");
    }
    await p.waitForTimeout(1200);
    const rnd = (await calls("note")).map((c) => c[1]);
    ok(rnd.length >= 6 && new Set(rnd).size >= 3, "random plays varied notes from the held keys and the octave above", rnd);
    await p.click("#studio-sustain");

    // --- a held key records as a held note ---
    await open({});
    await toMelody();
    await p.click("#studio-rec");
    await p.click("#studio-play");
    await p.waitForTimeout(300);
    const hk = await p.locator('.studio-key-white[data-key="E3"]').boundingBox();
    await p.mouse.move(hk.x + 20, hk.y + 80); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up();
    await p.waitForTimeout(150);
    await p.click("#studio-play");
    const rec = await p.evaluate(() => { const s = SongStudioHost.song(); return { notes: (s.melody.notes.E3 || []).filter(Boolean).length, ties: ((s.melody.ties || {}).E3 || []).filter(Boolean).length }; });
    ok(rec.notes >= 4 && rec.ties === rec.notes - 1, "recording a held key writes one note held across the steps it was down", rec);

    // --- the Play menu ---
    await open({});
    await toMelody();
    await p.click("#studio-playmode");
    ok(await p.locator("#studio-playpop").isVisible(), "the Play button opens the options");
    await p.click('#studio-playpop [data-pp-mode="arp"]');
    ok((await p.textContent("#studio-playmode")).startsWith("Play: Arpeggio"), "choosing Arpeggio says so on the button");
    ok(await p.locator('#studio-playpop select[data-pp="rate"]').isVisible(), "and shows the arpeggio's own settings");
    await p.selectOption('#studio-playpop select[data-pp="rate"]', "1/32");
    await p.keyboard.press("Escape");
    ok(!(await p.locator("#studio-playpop").isVisible()) && await p.locator("#song-builder-modal").isVisible(), "Esc closes the options and not the whole editor");
    await p.reload();
    await p.waitForSelector("#studio-keys .studio-pad", { timeout: 30000 });
    await toMelody();
    ok((await p.textContent("#studio-playmode")).includes("1/32"), "the choice is remembered after a reload");

    // --- accessibility, dark and light ---
    await p.addScriptTag({ content: axeSrc }).catch(() => {});
    const run = () => p.evaluate(async () => (await axe.run(document.getElementById("studio-keyboard"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ": " + v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" ; ")));
    await p.click("#studio-playmode");
    const dark = await run();
    ok(dark.length === 0, "axe: the keyboard is clean in the dark theme", dark);
    await p.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await p.waitForTimeout(400);
    const light = await run();
    ok(light.length === 0, "axe: and in the light theme", light);
    await p.evaluate(() => document.documentElement.removeAttribute("data-theme"));
    ok(errs.length === 0, "no page errors", errs);

    // --- a phone: Tools is a dropdown ---
    const pctx = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    const ph = await pctx.newPage();
    await ph.goto(E2E_BASE + "/studio");
    await ph.waitForSelector("#song-builder-modal:not([hidden]) #studio-keys .studio-pad", { timeout: 30000 });
    await ph.tap("#studio-tools");
    await ph.waitForSelector("#studio-sheet:not([hidden])");
    const r = await ph.evaluate(() => { const s = document.getElementById("studio-sheet").getBoundingClientRect(); const t = document.getElementById("studio-tools").getBoundingClientRect(); return { top: s.top, bottom: s.bottom, left: s.left, right: s.right, toolsBottom: t.bottom, h: innerHeight, w: innerWidth }; });
    ok(r.top >= r.toolsBottom - 1 && r.left > 0 && r.right < r.w && r.bottom < r.h, "on a phone the Tools sheet hangs under the Tools button, with room around it", r);
    await ph.tap("#studio-keys .studio-pad >> nth=0", { force: true }).catch(() => {});
    await ph.tap("#studio-name", { force: true }).catch(() => {});
    await ph.waitForTimeout(300);
    ok(await ph.locator("#studio-sheet").isHidden(), "tapping outside it closes it");
    const over = await ph.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 0, "no sideways scroll on the phone", over);
    await pctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + " FAILED" : "ALL PASS");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
