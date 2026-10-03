// Chord progressions in the song builder's melody tools: the controls, stamping held and struck, undo/redo, what Save stores, the key
// following the highlighted scale, the hidden-melody refusal, and accessibility.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
(async () => {
  const b = await chromium.launch();
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  const api = async (method, path, data) => { const r = await ctx.request.fetch(E2E_BASE + "/api/admin" + path, { method, data, headers: { "content-type": "application/json" } }); let j = null; try { j = await r.json(); } catch (e) { /* none */ } return { s: r.status(), j }; };
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const notes = {}; [4, 3].forEach((o) => { for (let i = 11; i >= 0; i--) notes[NAMES[i] + o] = Array(16).fill(false); });
  const song = { tempo: 100, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1, tracks: { kick: Array(16).fill(false), snare: [], hihat: [], clap: [] }, trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} }, melody: { waveform: "sine", notes } };
  const created = await api("POST", "/songs", { name: "QQ Progressions", data: song });
  const id = created.j.id;
  const grid = () => p.evaluate(() => { const out = {}; document.querySelectorAll("#song-piano-roll .song-steps").forEach((row) => { const on = [...row.children].map((x, i) => (x.classList.contains("song-step-on") ? i : -1)).filter((i) => i >= 0); if (on.length) out[row.dataset.row] = on.join(","); }); return out; });
  const flat = (g) => Object.entries(g).sort().map(([n, s]) => `${n}:${s}`).join(" ");
  const say = () => p.textContent("#song-melody-tools-note");
  try {
    await p.goto(E2E_BASE + "/admin/");
    await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("songs-btn").click());
    await p.waitForSelector("#songs-modal:not([hidden])");
    await p.locator(`.edit-song[data-id="${id}"]`).click();
    await p.waitForSelector("#song-builder-modal:not([hidden])");
    await p.waitForTimeout(800);
    await p.evaluate(() => { document.getElementById("song-melody-tools").open = true; });

    const keys = await p.evaluate(() => [...document.querySelectorAll("#song-prog-key option")].map((o) => o.value).join());
    const progs = await p.evaluate(() => [...document.querySelectorAll("#song-prog-type option")].map((o) => o.value));
    ok(keys === "C,C#,D,D#,E,F,F#,G,G#,A,A#,B", "the Key select has all twelve keys", keys);
    ok(progs.length >= 8 && progs[0] === "pop", "the Progression select lists the progressions, pop first", progs);
    ok(await p.isChecked("#song-prog-hold"), "Hold each chord is on by default");
    ok((await grid()) && Object.keys(await grid()).length === 0, "the melody starts empty");

    // pop in D, held
    await p.selectOption("#song-prog-key", "D");
    await p.selectOption("#song-prog-type", "pop");
    await p.click("#song-prog-stamp");
    let g = await grid();
    // D = D F# A, A = A C# E, Bm = B D F#, G = G B D: a note two chords share runs across both of their stretches
    const wantHeld = { D3: "0,1,2,3", "F#3": "0,1,2,3", A3: "0,1,2,3,4,5,6,7", "C#4": "4,5,6,7", E4: "4,5,6,7", B3: "8,9,10,11,12,13,14,15", D4: "8,9,10,11,12,13,14,15", "F#4": "8,9,10,11", G3: "12,13,14,15" };
    ok(flat(g) === flat(wantHeld), "D A Bm G held: each chord's notes fill its own four steps (and notes two chords share run across both)", { got: flat(g), want: flat(wantHeld) });
    ok(/Pop progression in D: D, A, Bm, G, each held for 4 steps/.test(await say()), "it says what it stamped", await say());

    await p.click("#song-undo");
    ok(Object.keys(await grid()).length === 0, "Undo takes the whole progression out in one step");
    await p.click("#song-redo");
    ok(flat(await grid()) === flat(g), "Redo puts it back");

    // saved with ties
    await p.click("#save-song");
    await p.waitForTimeout(1200);
    const saved = (await api("GET", "/songs/" + id)).j.data.melody;
    ok(saved.notes.D3.slice(0, 4).every(Boolean) && saved.ties && saved.ties.D3.join() === [false, true, true, true, ...Array(12).fill(false)].join(), "Save stores the notes and the ties that hold each chord", saved.ties && saved.ties.D3);
    ok(saved.ties.A3 && saved.ties.A3[4] === false && saved.ties.A3[5] === true, "a note shared by two chords (A3) is struck fresh at the second chord", saved.ties.A3);

    // not held, in C, after clearing
    await p.click("#song-melody-clear");
    await p.selectOption("#song-prog-key", "C");
    await p.uncheck("#song-prog-hold");
    await p.click("#song-prog-stamp");
    g = await grid();
    const wantStruck = { C3: "0", E3: "0", G3: "0,4", B3: "4", D4: "4", A3: "8,12", C4: "8,12", E4: "8", F3: "12" };
    ok(flat(g) === flat(wantStruck), "not held: only the first step of each chord is struck (C at 1, G at 5, Am at 9, F at 13)", { got: flat(g), want: flat(wantStruck) });
    ok(/struck on every 4th step/.test(await say()), "and the message says so", await say());

    // the key follows the highlighted scale
    await p.selectOption("#song-scale-type", "minor");
    await p.selectOption("#song-scale-root", "G");
    ok((await p.inputValue("#song-prog-key")) === "G", "turning on a scale in G sets the progression's key to G", await p.inputValue("#song-prog-key"));

    // hidden melody: refused, nothing changes
    await p.click("#song-melody-clear");
    await p.click("#song-melody-hide");
    await p.click("#song-prog-stamp");
    ok(/melody is hidden/i.test(await say()), "with the melody hidden, Stamp explains instead of editing", await say());
    await p.click("#song-piano-roll .song-melody-show, #song-melody-hide");
    ok(Object.keys(await grid()).length === 0, "and nothing was stamped");

    // on a phone the progression row (with its long names) stays inside the panel
    await p.setViewportSize({ width: 390, height: 900 });
    await p.waitForTimeout(400);
    const spill = await p.evaluate(() => { const d = document.getElementById("song-melody-tools"); const sel = document.getElementById("song-prog-type"); return { box: d.scrollWidth - d.clientWidth, select: Math.round(sel.getBoundingClientRect().right) - document.documentElement.clientWidth }; });
    ok(spill.box <= 1 && spill.select <= 0, "at 390px the progression row does not spill sideways", spill);
    await p.setViewportSize({ width: 1440, height: 1000 });

    // play it, accessibility
    await p.click("#song-prog-stamp");
    await p.click("#song-play"); await p.waitForTimeout(900); await p.click("#song-play");
    ok(errs.length === 0, "playing a stamped progression raises no script errors", errs);
    await p.addScriptTag({ content: axeSource() });
    const v = await p.evaluate(async () => (await axe.run(document.getElementById("song-melody-tools"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")));
    ok(v.length === 0, "the melody tools panel has no accessibility violations", v);
  } finally {
    await api("DELETE", "/songs/" + id);
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
