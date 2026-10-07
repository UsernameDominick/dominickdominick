// The Studio's sound side and recording helpers: the sound wakes up when Play or Preview is pressed (a phone keeps it asleep), Preview plays on the
// Sound tab, the many instruments and kits, the deeper synth controls and per-drum tweaks are saved with the song, and the transport's record
// from the top, quantize and follow buttons. Also a phone width and axe on the Sound tab.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
const { fanify } = require("./_fan.cjs");
(async () => {
  const b = await chromium.launch();
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const lane = (str) => Array.from(str, (c) => c === "x");
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const roll = (hi, lo) => { const n = {}; for (let o = hi; o >= lo; o--) for (let i = 11; i >= 0; i--) n[NAMES[i] + o] = Array(16).fill(false); return n; };
  const melody = roll(4, 3); melody.G4 = lane("x...x...x...x...");
  const data = {
    tempo: 200, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1,
    tracks: { kick: lane("x...x...x...x..."), snare: lane("....x.......x..."), hihat: lane("x.x.x.x.x.x.x.x."), clap: lane("................") },
    trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} }, melody: { waveform: "sine", notes: melody },
  };
  // a context that starts asleep like a phone's, and counts what is asked of it
  const spy = () => {
    window.__audio = { resumes: 0, osc: 0, sources: 0 };
    const Real = window.AudioContext;
    class Spy extends Real {
      constructor(...a) { super(...a); this.__asleep = true; }
      get state() { return this.__asleep ? "suspended" : super.state; }
      resume() { window.__audio.resumes++; this.__asleep = false; return super.resume(); }
      createOscillator() { window.__audio.osc++; return super.createOscillator(); }
      createBufferSource() { window.__audio.sources++; return super.createBufferSource(); }
    }
    window.AudioContext = Spy;
    let engine;
    Object.defineProperty(window, "SongEngine", {
      configurable: true, get: () => engine,
      set: (v) => { engine = v; const orig = v.createPlayer; v.createPlayer = (get, d, on) => orig(get, d, (step, time, info) => { (window.__steps = window.__steps || []).push(step); if (on) on(step, time, info); }); },
    });
  };
  const adminCtx = await b.newContext({ storageState: process.env.ADMIN_STATE });
  const api = async (method, path, body) => { const r = await adminCtx.request.fetch(E2E_BASE + "/api/admin" + path, { method, data: body, headers: { "content-type": "application/json" } }); let j = null; try { j = await r.json(); } catch (e) { /* none */ } return { s: r.status(), j }; };
  const id = (await api("POST", "/songs", { name: "QQ Studio sound", data })).j.id;
  const open = async (p) => {
    await p.goto(E2E_BASE + "/admin/"); await p.waitForSelector("#app:not([hidden])");
    await p.evaluate(() => document.getElementById("songs-btn").click()); await p.waitForSelector("#songs-modal:not([hidden])");
    await p.locator(`.edit-song[data-id="${id}"]`).click(); await p.waitForSelector("#song-builder-modal:not([hidden])"); await p.waitForSelector("#studio-stack .studio-card-main"); await p.waitForTimeout(500);
  };
  const vis = (p, sel) => p.evaluate((q) => { const e = document.querySelector(q); return Boolean(e) && !e.hidden && e.offsetParent !== null; }, sel);
  const osc = (p) => p.evaluate(() => window.__audio.osc + window.__audio.sources);
  const synth = (p, track) => p.evaluate((t) => { const s = window.SongStudioHost.song(); return JSON.stringify((t === "melody" ? s.melody : s[t] || {}).synth || {}); }, track);
  const pick = async (p, track) => { await p.evaluate((t) => document.querySelector(`#studio-stack [data-pick="${t}"]`).click(), track); await p.waitForTimeout(500); };
  try {
    const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("songView", "studio"); localStorage.removeItem("songQuantize"); localStorage.removeItem("songFollow"); localStorage.removeItem("songRecTop"); } catch (e) { /* none */ } });
    await ctx.addInitScript(spy);
    const p = fanify(await ctx.newPage());
    const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("dialog", (d) => d.accept());
    await open(p);

    // ---- Play wakes the sound
    await p.click("#studio-play");
    await p.waitForTimeout(600);
    const played = await p.evaluate(() => ({ resumes: window.__audio.resumes, steps: (window.__steps || []).length }));
    ok(played.resumes >= 1 && played.steps > 2, "Play wakes a sleeping sound and then plays", played);
    await p.click("#studio-stop");

    // ---- Preview on the Sound tab, in the studio's own words
    await pick(p, "melody");
    await p.click('#studio-detail [data-act="sound"]');
    await p.waitForTimeout(300);
    ok(!(await p.evaluate(() => /hear it/i.test(document.getElementById("studio-sheet").textContent))) && (await p.locator("#studio-sheet [data-hear]").textContent()) === "Preview", "the button says Preview, not Hear it");
    const before = await osc(p);
    await p.click("#studio-sheet [data-hear]");
    await p.waitForTimeout(150);
    ok((await osc(p)) > before, "Preview makes a sound", [before, await osc(p)]);

    // ---- instruments and the deeper controls
    const voices = await p.evaluate(() => [...document.querySelectorAll("#studio-voice option")].map((o) => o.value));
    ok(voices.length >= 41 && voices.includes("epiano") && voices.includes("supersaw") && voices.includes("strings") && voices.includes("reese") && (await p.locator("#studio-voice optgroup").count()) >= 6, "forty and more instruments, in groups", voices.length);
    const b2 = await osc(p);
    await p.selectOption("#studio-voice", "epiano");
    await p.waitForTimeout(250);
    ok((await p.inputValue("#song-voice")) === "epiano" && (await osc(p)) > b2, "choosing one sets the real menu and plays it");
    const knobKeys = await p.evaluate(() => [...document.querySelectorAll("#studio-sheet [data-knob]")].map((i) => i.dataset.knob));
    ok(["attack", "decay", "sustain", "release", "cutoff", "res", "sweep", "detune", "unison", "sub", "noise", "drive", "fm", "fmratio", "vibrato", "vrate", "tremolo", "trate"].every((k) => knobKeys.includes(k)) && (await vis(p, "#studio-synth-ftype")), "the sound has an envelope, a filter with a type, tone and movement controls", knobKeys);
    ok((await p.evaluate(() => { const o = document.querySelector('[data-out="fm"]'); return o.textContent; })) === "22%", "a knob shows what the instrument has (the electric piano's FM bite)");
    await p.evaluate(() => { const i = document.querySelector('[data-knob="res"]'); i.value = "800"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); });
    await p.selectOption("#studio-synth-ftype", "bandpass");
    await p.waitForTimeout(200);
    const saved = JSON.parse(await synth(p, "melody"));
    ok(saved.ftype === "bandpass" && saved.res > 5, "a knob and the filter type are kept as the track's own tweaks", saved);
    await p.click("#studio-synth-reset");
    ok((await synth(p, "melody")) === "{}", "Reset the sound takes them all back");
    await p.selectOption("#studio-voice", "");
    ok(!(await p.evaluate(() => Boolean(document.querySelector('[data-knob="fm"]:not([disabled])')))), "Basic keeps the knobs off (a plain wave has no shape)");

    // ---- drum kits and a drum sound's own tune, length and tone
    await pick(p, "drums");
    await p.click("#studio-tab-sound");
    await p.waitForTimeout(250);
    const kits = await p.evaluate(() => [...document.querySelectorAll("#studio-kit option")].map((o) => o.value));
    ok(kits.length >= 15 && kits.includes("909") && kits.includes("trap") && kits.includes("lofi") && kits.includes("jazz"), "fifteen drum kits", kits);
    const b3 = await osc(p);
    await p.selectOption("#studio-kit", "trap");
    await p.waitForTimeout(250);
    ok((await p.inputValue("#song-kit")) === "trap" && (await osc(p)) > b3, "a kit drives the real one and plays a drum so it can be heard");
    await p.click('[data-sound="snare"]');
    await p.evaluate(() => { const i = document.querySelector('[data-dknob="tune"]'); i.value = "750"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); });
    await p.evaluate(() => { const i = document.querySelector('[data-dknob="decay"]'); i.value = "800"; i.dispatchEvent(new Event("input", { bubbles: true })); });
    await p.waitForTimeout(150);
    const meta = await p.evaluate(() => JSON.stringify(window.SongStudioHost.song().trackMeta));
    const m = JSON.parse(meta);
    ok(m.snare.tune === 6 && m.snare.decay > 1.5 && m.kick.tune === undefined, "each drum sound has its own tune and length, kept only on that sound", meta);
    ok((await p.textContent('[data-dout="tune"]')) === "+6 st", "and says so", await p.textContent('[data-dout="tune"]'));
    const b4 = await osc(p);
    await p.click("[data-hear-drum]");
    await p.waitForTimeout(150);
    ok((await osc(p)) > b4, "Preview plays the chosen drum sound");
    await p.click("#studio-sound-reset");
    ok(!/tune|decay|tone/.test(await p.evaluate(() => JSON.stringify(window.SongStudioHost.song().trackMeta.snare))), "Reset this sound takes the tweaks back to the kit's");
    const keep = await p.evaluate(() => { const i = document.querySelector('[data-dknob="tone"]'); i.value = "900"; i.dispatchEvent(new Event("input", { bubbles: true })); return null; });
    await p.click("#close-studio-sheet");

    // ---- transport: record from the top, quantize, follow
    ok(!(await vis(p, "#studio-fan")) && (await vis(p, "#studio-rec")) && (await vis(p, "#studio-fan-btn")), "the bottom bar is Play, a Rec hub and a tempo; the rest waits in the fan");
    await p.click("#studio-fan-btn");
    await p.waitForTimeout(350);
    ok((await vis(p, "#studio-fan")) && (await vis(p, "#studio-rec-top")) && (await p.getAttribute("#studio-rec-top", "aria-pressed")) === "false" && (await p.getAttribute("#studio-follow", "aria-pressed")) === "true", "the ⋯ button opens the fan: record from the top (off at first) and Follow (on at first) are in it");
    const items = await p.evaluate(() => [...document.querySelectorAll("#studio-fan .studio-fan-item")].map((e) => e.id));
    ok(["studio-volume-btn", "studio-metro", "studio-fan-undo", "studio-fan-redo", "studio-fan-stop", "studio-fan-clear", "studio-rec-top", "studio-quant-btn", "studio-follow"].every((id) => items.includes(id)), "volume, metronome, undo, redo, stop, clear, record from the top, quantize and follow", items);
    await p.keyboard.press("Escape");
    ok(!(await vis(p, "#studio-fan")), "Escape closes it");
    // holding Rec opens it too, and the hold is not a tap on Rec
    const rb = await p.locator("#studio-rec").boundingBox();
    await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(650);
    await p.mouse.up();
    await p.waitForTimeout(300);
    ok((await vis(p, "#studio-fan")) && !(await p.isChecked("#song-record")), "holding Rec opens the fan without turning recording on");
    await p.click("#studio-fan-close");
    ok(!(await vis(p, "#studio-fan")) && !(await p.isChecked("#song-record")), "× closes the row");
    await p.click("#studio-rec");
    ok((await p.isChecked("#song-record")) && !(await vis(p, "#studio-fan")), "and a tap on Rec records");
    await p.click("#studio-rec");
    await p.click("#studio-follow");
    ok((await p.getAttribute("#studio-follow", "aria-pressed")) === "false" && (await p.evaluate(() => localStorage.getItem("songFollow"))) === "0", "Follow switches off and remembers it");
    await p.click("#studio-follow");
    const qv = () => p.evaluate(() => document.getElementById("studio-quant-value").textContent);
    ok((await qv()) === "1/16", "Quantize shows what it is set to (1/16 by default)", await qv());
    await p.click("#studio-quant-btn");
    ok((await qv()) === "1/8" && (await p.evaluate(() => window.SongStudioHost.quantize())) === 2 && (await p.evaluate(() => localStorage.getItem("songQuantize"))) === "2", "a tap moves on to 1/8, which reaches the recorder and is remembered", await qv());
    await p.click("#studio-quant-btn");
    await p.click("#studio-quant-btn");
    ok((await qv()) === "Off" && (await p.evaluate(() => window.SongStudioHost.quantize())) === 0, "then 1/4, then off", await qv());
    await p.click("#studio-quant-btn");
    ok((await qv()) === "1/16", "and round to 1/16 again", await qv());
    ok((await p.evaluate(() => { const f = document.getElementById("studio-fan").getBoundingClientRect(); const c = document.querySelector(".studio-controls").getBoundingClientRect(); return Math.abs(f.top - c.top) < 2 && Math.abs(f.bottom - c.bottom) < 2; })), "the ⋯ controls are a row over the bar, not over the steps");

    await p.click("#studio-rec-top");
    ok((await p.getAttribute("#studio-rec-top", "aria-pressed")) === "true", "Record from the top switches on");
    await p.click("#studio-fan-close"); // the row lies over Play, so close it first
    await pick(p, "melody");
    await p.evaluate(() => { window.__steps = []; });
    await p.click("#studio-play");
    await p.waitForTimeout(700);
    await p.click("#studio-play"); // pause part-way
    await p.waitForTimeout(150);
    ok(await p.evaluate(() => window.SongStudioHost.paused()), "paused part-way");
    await p.click("#studio-rec");
    ok(!(await p.evaluate(() => window.SongStudioHost.paused())), "arming Rec forgets where it was paused");
    await p.evaluate(() => { window.__steps = []; });
    await p.click("#studio-play");
    await p.waitForTimeout(300);
    ok((await p.evaluate(() => (window.__steps || [])[0])) === 0, "and playing starts from the beginning");
    await p.click("#studio-stop");
    await p.click("#studio-rec"); // disarm
    // ---- quantize: a key pressed at any moment while recording lands on the grid
    await p.evaluate(() => window.SongStudioHost.setQuantize("4"));
    await p.click("#studio-rec");
    await p.click("#studio-play");
    for (const [wait, key] of [[430, "E4"], [210, "F4"], [170, "A4"]]) {
      await p.waitForTimeout(wait);
      await p.dispatchEvent(`#studio-keys [data-key="${key}"]`, "pointerdown", { button: 0, pointerType: "mouse" });
      await p.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 0, pointerType: "mouse" }))); // a quick press, not a held key
    }
    await p.waitForTimeout(100);
    await p.click("#studio-stop");
    await p.waitForTimeout(200);
    const landed = await p.evaluate(() => ["E4", "F4", "A4"].map((n) => [...document.querySelectorAll(`#studio-grid .studio-cell[data-row="${n}"].on`)].map((c) => Number(c.dataset.step))));
    ok(landed.every((steps) => steps.length >= 1 && steps.every((st) => st % 4 === 0)), "with Quantize on 1/4 every recorded note lands on a beat", landed);
    await p.click("#studio-rec");
    ok(errs.length === 0, "no page errors", errs);

    // ---- a phone
    const mctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
    await mctx.addInitScript(() => { try { localStorage.setItem("songView", "studio"); } catch (e) { /* none */ } });
    await mctx.addInitScript(spy);
    const m2 = fanify(await mctx.newPage());
    const merrs = []; m2.on("pageerror", (e) => merrs.push(String(e))); m2.on("dialog", (d) => d.accept());
    await open(m2);
    const fit = await m2.evaluate(() => ({ over: document.documentElement.scrollWidth - window.innerWidth, small: [...document.querySelectorAll("#studio-play, #studio-rec, #studio-fan-btn")].map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h < 36) }));
    ok(fit.over <= 1 && fit.small.length === 0, "on a phone the controls fit the screen and stay finger-sized", fit);
    const clash = await m2.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); const a = r("studio-fan-btn"), b = r("studio-bpm"), c = r("studio-rec"); const hit = (x, y) => x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom; return hit(a, b) || hit(a, c) || a.left < c.right - 1; });
    ok(!clash, "the ⋯ sits just right of Rec and covers neither Rec nor the tempo");
    await m2.tap("#studio-fan-btn");
    await m2.waitForTimeout(300);
    const lefts = await m2.evaluate(() => [...document.querySelectorAll("#studio-fan .studio-fan-item")].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.height)]; }));
    ok(lefts.length === 9 && lefts.every((r) => r[0] >= 0 && r[1] <= 390 && r[2] >= 40 && r[1] - r[0] >= 24), "on a phone the whole row is inside the screen and its buttons are finger-sized", lefts);
    await m2.tap("#studio-volume-btn");
    const rect = await m2.evaluate(() => { const r = document.getElementById("studio-pop-volume").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; });
    ok(rect[0] >= 0 && rect[1] <= 390, "its volume slider opens inside the screen", rect);
    await m2.keyboard.press("Escape");
    await pick(m2, "melody");
    await m2.tap('#studio-detail [data-act="sound"]');
    await m2.waitForTimeout(300);
    await m2.addScriptTag({ content: axeSource() });
    for (const theme of ["dark", "light"]) {
      await m2.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await m2.waitForTimeout(150);
      const v = await m2.evaluate(async () => (await axe.run(document.getElementById("studio-sheet"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(",")));
      ok(v.length === 0, `the Sound tab passes axe (${theme})`, v);
    }
    ok(merrs.length === 0, "no page errors on the phone", merrs);
    await mctx.close();
    await ctx.close();
  } finally {
    await api("DELETE", "/songs/" + id);
    await adminCtx.close();
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
