// The sound library. Every melodic voice (three notes each), every drum of every kit and every starter song is rendered through the real engine and a
// real OfflineAudioContext, checked (finite, not silent, under full scale, no DC offset) and written out as a WAV file, so the CI run can hand the whole
// library over as a download (the "sound-library" artifact) for the owner to LISTEN to: a pull request that changes how things sound is judged by ear.
// Also records how long each render took per second of audio, a budget for the engine's cost. Files go to SOUND_LIBRARY_DIR (default
// tests/e2e/sound-library, ignored by git).
const fs = require("node:fs");
const path = require("node:path");
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const OUT = process.env.SOUND_LIBRARY_DIR || path.join(__dirname, "sound-library");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    fs.rmSync(OUT, { recursive: true, force: true });
    for (const d of ["voices", "drums", "starters"]) fs.mkdirSync(path.join(OUT, d), { recursive: true });
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("studioTipSeen", "1"); } catch (e) { /* none */ } });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
    await p.goto(E2E_BASE + "/studio");
    await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card-main", { timeout: 30000 });

    // one render: returns the WAV (base64) and what was measured
    await p.evaluate(() => {
      window.__render = async (song, tail) => {
        const t0 = performance.now();
        const r = await window.SongEngine.renderLoopAudio(song, { sampleRate: 44100, loops: 1, tailSeconds: tail });
        const ms = performance.now() - t0;
        const s = r.samples;
        let peak = 0, sum = 0, sq = 0, bad = 0;
        for (let i = 0; i < s.length; i++) {
          const x = s[i];
          if (!Number.isFinite(x)) { bad++; continue; }
          const a = Math.abs(x);
          if (a > peak) peak = a;
          sum += x;
          sq += x * x;
        }
        const wav = window.SongFiles.encodeWav([s], r.sampleRate, "16", false);
        let bin = "";
        for (let i = 0; i < wav.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, wav.bytes.subarray(i, i + 0x8000));
        return { b64: btoa(bin), peak, rms: Math.sqrt(sq / s.length), dc: sum / s.length, bad, ms, seconds: s.length / r.sampleRate };
      };
      const lane = (str) => Array.from(str, (c) => c === "x");
      // a note held for `steps` steps from step `at` (a tie marks every step after the first)
      window.__held = (notes, ties, name, at, steps) => {
        notes[name] = notes[name] || new Array(16).fill(false);
        ties[name] = ties[name] || new Array(16).fill(false);
        for (let i = 0; i < steps; i++) { notes[name][at + i] = true; if (i) ties[name][at + i] = true; }
      };
      window.__voiceSong = (voice) => {
        const notes = {}, ties = {};
        window.__held(notes, ties, "C3", 0, 4);
        window.__held(notes, ties, "C4", 5, 4);
        window.__held(notes, ties, "G4", 10, 4);
        return { tempo: 120, kit: "acoustic", master_volume: 1, trackMeta: {}, tracks: {}, melody: { waveform: "sine", ...(voice ? { voice } : {}), notes, ties } };
      };
      window.__drumSong = (kit, row) => ({ tempo: 120, kit, master_volume: 1, trackMeta: {}, tracks: { [row]: lane("x.......x.x.....") }, melody: { waveform: "sine", notes: {} } });
    });
    const info = await p.evaluate(() => ({ voices: Object.keys(window.SongEngine.MELODY_VOICES), kits: window.SongEngine.KITS, starters: window.SongStarters.LIST.map((s) => s.id) }));
    const rows = ["kick", "snare", "hihat", "clap", "openhat", "rim", "tom", "crash"];
    const report = [];
    const check = (kind, name, r, opts = {}) => {
      const quiet = opts.quiet ? 5e-5 : 1e-4;
      report.push({ kind, name, peak: Number(r.peak.toFixed(4)), rms: Number(r.rms.toFixed(5)), dc: Number(r.dc.toFixed(5)), ms: Math.round(r.ms), seconds: Number(r.seconds.toFixed(2)) });
      const good = r.bad === 0 && r.peak <= 1.0001 && r.peak > 0.005 && r.rms > quiet && Math.abs(r.dc) < 0.03;
      if (!good) ok(false, `${kind} ${name} is finite, audible, under full scale and has almost no DC offset`, report[report.length - 1]);
      return good;
    };
    let good = 0;
    const save = (dir, file, r) => fs.writeFileSync(path.join(OUT, dir, file), Buffer.from(r.b64, "base64"));

    for (const v of info.voices) {
      const r = await p.evaluate((voice) => window.__render(window.__voiceSong(voice), 1.2), v);
      if (check("voice", v, r)) good++;
      save("voices", `${v}.wav`, r);
    }
    for (const w of ["sine", "square", "sawtooth", "triangle"]) {
      const r = await p.evaluate((wave) => { const s = window.__voiceSong(""); s.melody.waveform = wave; return window.__render(s, 0.5); }, w);
      if (check("wave", w, r)) good++;
      save("voices", `plain-${w}.wav`, r);
    }
    ok(good === info.voices.length + 4, `all ${info.voices.length} voices and the 4 plain waves render sound`, good);

    let drums = 0, drumGood = 0;
    for (const kit of info.kits) {
      for (const row of rows) {
        const r = await p.evaluate(([k, rw]) => window.__render(window.__drumSong(k, rw), 0.8), [kit, row]);
        drums++;
        if (check("drum", `${kit}/${row}`, r, { quiet: true })) drumGood++;
        save("drums", `${kit}-${row}.wav`, r);
      }
    }
    ok(drumGood === drums, `all ${drums} drum sounds (${info.kits.length} kits x ${rows.length}) render sound`, [drumGood, drums]);

    let startGood = 0;
    for (const id of info.starters) {
      const r = await p.evaluate((sid) => window.__render(window.SongStarters.build(sid), 1.5), id);
      if (check("starter", id, r)) startGood++;
      save("starters", `${id}.wav`, r);
    }
    ok(startGood === info.starters.length, `all ${info.starters.length} starter songs render sound`, [startGood, info.starters.length]);

    // how long the engine takes: milliseconds of render per second of audio, worst and mean (a budget to watch, not a pass mark)
    const rate = report.map((x) => x.ms / x.seconds);
    const worst = Math.max(...rate), mean = rate.reduce((a, c) => a + c, 0) / rate.length;
    console.log(`INFO render cost: mean ${mean.toFixed(0)} ms, worst ${worst.toFixed(0)} ms per second of audio (${report.length} renders)`);
    const offset = report.filter((x) => Math.abs(x.dc) > 0.01).map((x) => `${x.kind} ${x.name} (${x.dc})`);
    if (offset.length) console.log(`INFO DC offset above 0.01 (a flaw to fix in the sound, worth a look): ${offset.join(", ")}`);
    ok(worst < 4000, "no render takes more than four seconds per second of audio", worst);
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ made: new Date().toISOString(), renders: report }, null, 1));
    fs.writeFileSync(path.join(OUT, "README.txt"), "The sound library of this build: every melodic voice (voices/, three notes each), every drum of every kit (drums/, a kit-row.wav per sound), and every starter song (starters/). Listen to these to judge a change by ear. report.json has the peak, level and render time of each.\n");
    ok(errs.length === 0, "no page errors", errs);
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
