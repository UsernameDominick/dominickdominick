// Playing with feeling: a MIDI keyboard's notes are held until the key is let go (or the sustain pedal comes up) and carry the key's strength, the pitch
// wheel bends the held notes, the mod wheel adds vibrato, CC 74 moves the filter; the computer keyboard holds notes too and "," and "." move its octave;
// a piano key struck low on its face is louder than one struck at its top.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      localStorage.setItem("studioTipSeen", "1");
      const input = { id: "k37", name: "Fake Keystation 37", manufacturer: "Test", state: "connected", onmidimessage: null };
      navigator.requestMIDIAccess = async () => ({ inputs: new Map([["k37", input]]), onstatechange: null });
      window.__send = (...data) => input.onmidimessage && input.onmidimessage({ data: new Uint8Array(data) });
    });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
    await p.goto(E2E_BASE + "/studio");
    await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card", { timeout: 30000 });
    await p.waitForTimeout(500);
    // the Bass track plays a voiced note, which is what a held note is made of; watch every voiced note the engine is asked for
    await p.click("#studio-stack .studio-card >> nth=1");
    await p.waitForTimeout(400);
    await p.evaluate(() => {
      window.__notes = [];
      const E = window.SongEngine;
      const real = E.playVoicedNote;
      E.playVoicedNote = (ctx, time, freq, voice, dur, synth, random, live) => {
        const h = real(ctx, time, freq, voice, dur, synth, random, live);
        const rec = { freq: Math.round(freq), live: !!live, released: 0, bends: [], updates: [] };
        window.__notes.push(rec);
        if (!h) return h;
        const rel = h.release, bend = h.bend, upd = h.update;
        h.release = (t) => { rec.released++; return rel(t); };
        h.bend = (c) => { rec.bends.push(Math.round(c)); return bend(c); };
        h.update = (n, s) => { rec.updates.push(JSON.stringify(s)); return upd(n, s); };
        return h;
      };
    });
    const notes = () => p.evaluate(() => window.__notes.map((n) => ({ ...n })));
    // connect
    await p.click("#studio-tab-midi");
    if (await p.locator("#studio-midi-connect").isVisible()) await p.click("#studio-midi-connect");
    await p.waitForFunction(() => /1 MIDI input connected/.test(document.getElementById("studio-midi-status").textContent), null, { timeout: 5000 });

    // a key is held until it is let go
    await p.evaluate(() => window.__send(0x90, 45, 100));
    let n = await notes();
    ok(n.length === 1 && n[0].live && n[0].released === 0, "a MIDI key-down starts a held note", n);
    await p.waitForTimeout(200);
    await p.evaluate(() => window.__send(0x80, 45, 0));
    n = await notes();
    ok(n[0].released === 1, "and the key coming up lets it go", n);
    await p.evaluate(() => { window.__send(0x90, 47, 90); window.__send(0x90, 47, 0); });
    n = await notes();
    ok(n.length === 2 && n[1].released === 1, "a note-on with velocity 0 is a note-off too", n);

    // the sustain pedal holds a note after the key is up
    await p.evaluate(() => { window.__send(0xb0, 64, 127); window.__send(0x90, 50, 100); window.__send(0x80, 50, 0); });
    n = await notes();
    ok(n[2] && n[2].released === 0, "with the pedal down a released key keeps sounding", n[2]);
    await p.evaluate(() => window.__send(0xb0, 64, 0));
    n = await notes();
    ok(n[2].released === 1, "and the pedal coming up lets it go", n[2]);

    // the pitch wheel bends held notes
    await p.evaluate(() => { window.__send(0x90, 52, 100); window.__send(0xe0, 127, 127); });
    n = await notes();
    ok(n[3].bends.length >= 1 && n[3].bends[n[3].bends.length - 1] >= 190, "the pitch wheel pushed up bends the held note (about two semitones)", n[3].bends);
    await p.evaluate(() => window.__send(0xe0, 0, 64));
    n = await notes();
    ok(n[3].bends[n[3].bends.length - 1] === 0, "and back in the middle it is straight again", n[3].bends);

    // the mod wheel and CC 74 reach the held note, never the song
    await p.evaluate(() => window.__send(0xb0, 1, 127));
    n = await notes();
    ok(n[3].updates.some((u) => /"vibrato":45/.test(u)), "the mod wheel adds vibrato to the held note", n[3].updates);
    await p.evaluate(() => window.__send(0xb0, 74, 127));
    n = await notes();
    ok(n[3].updates.some((u) => /"cutoff":1[12]\d\d\d/.test(u)), "CC 74 opens its filter", n[3].updates);
    ok((await p.evaluate(() => { const s = window.SongStudioHost.synth("bass"); return s.vibrato === undefined && s.cutoff === undefined; })), "(neither is saved in the song)");
    await p.evaluate(() => { window.__send(0xb0, 1, 0); window.__send(0xb0, 74, 127); window.__send(0x80, 52, 0); });
    await p.evaluate(() => { window.__send(0x90, 54, 80); });
    n = await notes();
    ok(n[4] && n[4].live, "a note struck later is held too");
    await p.evaluate(() => window.__send(0x80, 54, 0));

    // the computer keyboard: a key is held while it is down (on the Chords track, whose roll has an octave of room above the lowest key)
    await p.click("#studio-stack .studio-card >> nth=2");
    await p.waitForTimeout(400);
    await p.click("body", { position: { x: 5, y: 5 } });
    await p.keyboard.down("z");
    n = await notes();
    const before = n.length;
    ok(n[before - 1].live && n[before - 1].released === 0, "a computer key held down is a held note");
    await p.keyboard.up("z");
    n = await notes();
    ok(n[before - 1].released === 1, "and lets go when the key comes up", n[before - 1]);
    await p.keyboard.press(".");
    await p.keyboard.down("z");
    n = await notes();
    const up = n[n.length - 1].freq;
    await p.keyboard.up("z");
    await p.keyboard.press(",");
    await p.keyboard.down("z");
    n = await notes();
    const normal = n[n.length - 1].freq;
    await p.keyboard.up("z");
    ok(Math.abs(up / normal - 2) < 0.02, "the full stop moves the computer keyboard up an octave (and the comma brings it back)", [up, normal]);
    ok(/usual octaves/.test(await p.locator("#studio-live").textContent()), "and says so", await p.locator("#studio-live").textContent());

    ok(errs.length === 0, "no page errors", errs);
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
