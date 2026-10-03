const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs"); const fs = require("fs");
const BASE = (E2E_BASE); let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const ALL = []; [4, 3].forEach((o) => { for (let i = 11; i >= 0; i--) ALL.push(NAMES[i] + o); });
  const melody = {}; ALL.forEach((n) => (melody[n] = Array(16).fill(false)));
  melody.C4[0] = true; melody.E4[4] = true; melody.G4[8] = true; melody.D4[15] = true;
  const created = await (await c.fetch(`${BASE}/api/admin/songs`, { method: "POST", data: { name: "QQ Melody Tools", data: { tempo: 100, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1, tracks: { kick: Array(16).fill(false), snare: Array(16).fill(false), hihat: Array(16).fill(false), clap: Array(16).fill(false) }, trackMeta: {}, melody: { waveform: "sine", notes: melody } } } })).json();
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const [w, h, label] of [[1440, 900, "desktop"], [390, 800, "phone"]]) {
    const p = await (await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: w, height: h } })).newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("dialog", (d) => d.accept());
    const t = `[${label}]`;
    try {
      await p.goto(`${BASE}/admin/`); await p.waitForSelector("#app:not([hidden])"); await p.evaluate(() => document.getElementById("songs-btn").click()); await p.waitForSelector("#songs-modal:not([hidden])"); await p.waitForTimeout(300);
      await p.locator(`.edit-song[data-id="${created.id}"]`).click(); await p.waitForSelector("#song-builder-modal:not([hidden])"); await p.waitForTimeout(800);
      await p.evaluate(() => { document.getElementById("song-melody-tools").open = true; });
      const grid = () => p.evaluate(() => { const out = {}; document.querySelectorAll("#song-piano-roll .song-steps").forEach((row) => { const name = row.dataset.row; const on = [...row.children].map((x, i) => (x.getAttribute("aria-pressed") === "true" || x.classList.contains("song-step-on") ? i : -1)).filter((i) => i >= 0); if (on.length) out[name] = on; }); return out; });
      const flat = (g) => Object.entries(g).sort().map(([n, s]) => `${n}:${s.join(",")}`).join(" ");
      const say = () => p.textContent("#song-melody-tools-note");
      const start = flat(await grid());
      ok(start === "C4:0 D4:15 E4:4 G4:8", `${t} the melody starts as saved`, start);
      for (const id of ["song-melody-shift-left", "song-melody-shift-right", "song-melody-reverse", "song-melody-clear", "song-melody-random", "song-chord-stamp", "song-arp-apply"]) ok(await p.locator(`#${id}`).count() === 1, `${t} #${id} exists`);
      // shift
      await p.click("#song-melody-shift-right");
      ok(flat(await grid()) === "C4:1 D4:0 E4:5 G4:9", `${t} shift later moves each note one step, the last wraps to the first`, flat(await grid()));
      ok(/shifted one step later/.test(await say()), `${t} and says so`, await say());
      await p.click("#song-melody-shift-left"); await p.click("#song-melody-shift-left");
      ok(flat(await grid()) === "C4:15 D4:14 E4:3 G4:7", `${t} two shifts earlier wraps the first step to the end`, flat(await grid()));
      await p.click("#song-undo"); await p.click("#song-undo"); await p.click("#song-undo");
      ok(flat(await grid()) === start, `${t} Undo three times is back to the start`, flat(await grid()));
      // reverse
      await p.click("#song-melody-reverse");
      ok(flat(await grid()) === "C4:15 D4:0 E4:11 G4:7", `${t} reverse turns the steps round`, flat(await grid()));
      await p.click("#song-undo");
      ok(flat(await grid()) === start, `${t} Undo puts it back`);
      // chord stamp
      await p.selectOption("#song-chord-root", "A3"); await p.selectOption("#song-chord-type", "minor"); await p.fill("#song-chord-step", "3");
      await p.click("#song-chord-stamp");
      const g1 = await grid();
      ok(g1.A3.includes(2) && g1.C4.includes(2) && g1.E4.includes(2) && g1.C4.includes(0) && g1.G4.includes(8), `${t} Stamp chord adds A minor on step 3 and keeps the rest`, flat(g1));
      ok(/a3 minor chord added on step 3/i.test(await say()), `${t} and says what it did`, await say());
      await p.click("#song-undo");
      ok(flat(await grid()) === start, `${t} Undo removes the chord`);
      await p.selectOption("#song-chord-root", "G4"); await p.selectOption("#song-chord-type", "dom7"); await p.fill("#song-chord-step", "99");
      await p.click("#song-chord-stamp");
      ok((await p.inputValue("#song-chord-step")) === "16" && /left out/.test(await say()), `${t} a step past the end is held at 16 and chord tones above the roll are reported`, [await p.inputValue("#song-chord-step"), await say()]);
      await p.click("#song-undo");
      // arpeggio
      await p.selectOption("#song-chord-root", "C4"); await p.selectOption("#song-chord-type", "major"); await p.selectOption("#song-arp-pattern", "up"); await p.selectOption("#song-arp-every", "4");
      await p.click("#song-arp-apply");
      ok(flat(await grid()) === "C4:0,12 E4:4 G4:8", `${t} Arpeggiate replaces the melody with C E G every 4 steps`, flat(await grid()));
      ok(/replaced the melody/.test(await say()), `${t} and warns it replaced one`, await say());
      await p.selectOption("#song-arp-pattern", "down"); await p.selectOption("#song-arp-every", "1");
      await p.click("#song-arp-apply");
      const gd = await grid();
      ok(gd.G4[0] === 0 && gd.E4[0] === 1 && gd.C4[0] === 2 && gd.G4.includes(3), `${t} down at every step runs G E C G...`, flat(gd));
      await p.click("#song-undo"); await p.click("#song-undo");
      ok(flat(await grid()) === start, `${t} two Undos restore the original melody`, flat(await grid()));
      // random in scale
      await p.selectOption("#song-scale-type", "minpent"); await p.selectOption("#song-scale-root", "A");
      await p.fill("#song-melody-density", "100"); await p.evaluate(() => document.getElementById("song-melody-density").dispatchEvent(new Event("input", { bubbles: true })));
      ok((await p.getAttribute("#song-melody-density", "aria-valuetext")) === "100% of steps", `${t} the density slider reads in words`);
      await p.click("#song-melody-random");
      const gr = await grid();
      const allowed = new Set(["A", "C", "D", "E", "G"]);
      const names = Object.keys(gr);
      const count = Object.values(gr).reduce((n, s) => n + s.length, 0);
      ok(names.length && names.every((n) => allowed.has(n.replace(/\d+$/, ""))) && count === 16, `${t} a full random tune uses only A minor pentatonic notes, one on each step`, flat(gr));
      ok(/random tune in a minor pentatonic.*replaced the melody/i.test(await say()), `${t} and names the scale`, await say());
      await p.click("#song-undo");
      ok(flat(await grid()) === start, `${t} Undo restores the melody`);
      await p.selectOption("#song-scale-type", "off");
      await p.fill("#song-melody-density", "40"); await p.evaluate(() => document.getElementById("song-melody-density").dispatchEvent(new Event("input", { bubbles: true })));
      await p.click("#song-melody-random");
      const g2 = await grid();
      ok(/C major pentatonic \(no scale is highlighted\)/.test(await say()) && Object.keys(g2).every((n) => ["C", "D", "E", "G", "A"].includes(n.replace(/\d+$/, ""))), `${t} without a scale it uses C major pentatonic and says so`, await say());
      await p.click("#song-undo");
      // clear
      await p.click("#song-melody-clear");
      ok(Object.keys(await grid()).length === 0 && /cleared/i.test(await say()), `${t} Clear empties the melody`, await say());
      await p.click("#song-melody-shift-right");
      ok(/no melody notes to shift/.test(await say()), `${t} shifting an empty melody says there is nothing to shift`, await say());
      await p.click("#song-melody-reverse");
      ok(/no melody notes to reverse/.test(await say()), `${t} and so does reversing`);
      await p.click("#song-melody-clear");
      ok(/already empty/.test(await say()), `${t} clearing an empty melody says so`);
      await p.click("#song-undo");
      ok(flat(await grid()) === start, `${t} Undo of Clear restores it`);
      // hidden melody is left alone
      await p.click("#song-melody-hide");
      await p.click("#song-melody-shift-right");
      ok(/melody is hidden/i.test(await say()), `${t} with the melody hidden the tools refuse and say why`, await say());
      await p.click(".song-melody-show");
      ok(flat(await grid()) === start, `${t} and nothing moved while it was hidden`, flat(await grid()));
      // a11y
      await p.addScriptTag({ content: require("./_pw.cjs").axeSource() });
      const viol = await p.evaluate(async () => (await axe.run(document.getElementById("song-melody-tools"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ":" + v.nodes.length));
      ok(viol.length === 0, `${t} axe finds nothing in the melody tools`, viol);
      const overflow = await p.evaluate(() => { const d = document.getElementById("song-melody-tools"); return d.scrollWidth > d.clientWidth + 1; });
      ok(!overflow, `${t} the tools do not spill sideways`);
      ok(errs.length === 0, `${t} no page errors`, errs);
    } finally { await p.close(); }
  }
  await c.fetch(`${BASE}/api/admin/songs/${created.id}`, { method: "DELETE" });
  await b.close();
  console.log(f ? "FAILURES " + f : "ALL PASS"); process.exit(f ? 1 : 0);
})();
