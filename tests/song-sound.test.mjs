// The sound library: forty and more instruments in groups, fifteen drum kits, the deeper synth tweaks (filter type, resonance, sweep, voices, sub,
// noise, drive, FM, tremolo, vibrato speed) and a drum sound's own tune, length and tone: that each plays without trouble, that the tweaks
// reach the audio graph, that the ranges are the same in the engine, the file helper and the server, and that bad data stays out.
import { makeCtx, count, loadEngine, loadSongFiles, lane, melodyOnly } from "./fake-audio.mjs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const E = loadEngine();
const F = loadSongFiles();
const play = (data, step = 0) => { const ctx = makeCtx(); E.scheduleStep(ctx, data, step, 0, () => 0.5); return ctx; };
const note = (voice, synth, extra = {}) => play(melodyOnly({}, { C4: lane("x...............") }, { voice, ...(synth ? { synth } : {}), ...extra }));
const oscs = (ctx) => ctx.nodes.filter((n) => n.kind === "osc");
const drum = (row, kit, meta = {}) => play({ tempo: 120, kit, master_volume: 1, tracks: { [row]: [true] }, trackMeta: { [row]: meta }, melody: { notes: {} } });

// ---- the instruments ----
{
  const names = Object.keys(E.MELODY_VOICES);
  ok(names.length >= 41, "forty-one instruments or more", names.length);
  const grouped = E.VOICE_GROUPS.flatMap((g) => g.voices);
  ok(JSON.stringify([...grouped].sort()) === JSON.stringify([...names].sort()) && new Set(grouped).size === grouped.length, "every instrument is in exactly one menu group");
  ok(E.VOICE_GROUPS.length >= 6 && E.VOICE_GROUPS.every((g) => g.label && g.voices.length), "in at least six groups");
  const bad = [];
  names.forEach((name) => {
    try {
      const ctx = note(name);
      const o = oscs(ctx);
      const finished = o.every((n) => n.started !== null && n.stopped !== null && n.stopped > n.started);
      const sound = o.length >= 1 && finished && count(ctx, "gain") >= 1;
      if (!sound) bad.push(name);
    } catch (e) { bad.push(name + ": " + e.message); }
  });
  ok(bad.length === 0, "every instrument plays, and every oscillator it starts is given an end", bad);
  // the original five are the same graphs as ever
  ok(oscs(note("pluck")).length === 1 && oscs(note("lead")).length === 4 && oscs(note("pad")).length === 3 && oscs(note("bass")).length === 2 && oscs(note("bell")).length === 2, "the first five instruments are unchanged");
  ok(count(note("pluck"), "shaper") === 0 && count(note("pluck"), "source") === 0, "and use none of the new parts");
}

// ---- the tweaks reach the graph ----
{
  const baseline = note("pluck");
  ok(count(note("pluck", { drive: 0.5 }), "shaper") === 1 && count(baseline, "shaper") === 0, "Drive adds a soft saturation");
  ok(count(note("pluck", { noise: 0.5 }), "source") === 1, "Noise adds a hiss, shaped by the filter");
  ok(oscs(note("pluck", { sub: 0.6 })).length === oscs(baseline).length + 1, "Sub adds a tone an octave down");
  ok(oscs(note("pluck", { unison: 5 })).length === 5 && oscs(note("pluck", { unison: 1 })).length === 1, "Voices stacks that many oscillators");
  ok(oscs(note("pluck", { tremolo: 0.5 })).length === oscs(baseline).length + 1, "Tremolo adds a slow wobble in the loudness");
  ok(oscs(note("pluck", { vibrato: 20, vrate: 8 })).some((o) => o.frequency.value === 8), "Vibrato speed sets the rate of the pitch wobble");
  const fm = note("pluck", { fm: 0.5, fmratio: 2 });
  ok(oscs(fm).length === oscs(baseline).length + 1 && oscs(fm).some((o) => Math.abs(o.frequency.value - 2 * oscs(baseline)[0].frequency.value) < 1e-9), "FM bite adds a modulator at the chosen multiple of the note");
  const filt = (ctx) => ctx.nodes.find((n) => n.kind === "filter");
  ok(filt(note("pluck", { ftype: "highpass" })).type === "highpass" && filt(baseline).type === "lowpass", "the filter type is chosen");
  ok(filt(note("pluck", { res: 9 })).Q.value === 9, "Resonance sets the filter's Q");
  const sweepEnd = (synth) => { const f = filt(note("pad", synth)); const exp = f.frequency.calls.find((c) => c.kind === "exp"); return exp ? exp.v : null; };
  ok(sweepEnd({ sweep: 1 }) < 1500 / 2 && sweepEnd({ sweep: -1 }) > 1500 * 2 && sweepEnd({}) === null && sweepEnd({ sweep: 0 }) === null, "Filter sweep closes or opens the filter over the note (0 is none)");
  ok(filt(note("subbass", { res: 4 })) && count(note("subbass"), "filter") === 0, "Resonance gives a voice with no filter one");
  const wob = note("wobble");
  ok(wob.nodes.some((n) => n.kind === "osc" && n.frequency.value === 3), "Wobble bass has its own filter wobble");
  // the same data reaches the engine through a song's melody and a part
  const viaPart = play({ tempo: 120, master_volume: 1, tracks: {}, trackMeta: {}, melody: { notes: {} }, bass: { voice: "reese", synth: { unison: 2 }, notes: { C2: lane("x...............") } } });
  ok(oscs(viaPart).length === 2, "a bass part takes the tweaks too (Reese with two voices)", oscs(viaPart).length);
}

// ---- cleaning the tweaks: the engine, the file helper and the server agree ----
{
  const messy = { wave: "sawtooth", ftype: "bandpass", res: 99, vrate: 0.01, sub: -1, noise: 2, drive: 0.5, tremolo: 0.3, trate: 50, fm: 1, fmratio: 20, sweep: -5, unison: 3.7, cutoff: 5, attack: "x", bogus: 1, ftype2: "x" };
  const a = E.cleanSynth(messy);
  const f = F.cleanSong({ tempo: 100, melody: { voice: "pluck", synth: messy } }).melody.synth;
  ok(JSON.stringify(a) === JSON.stringify(f), "the engine and the import cleaner clean tweaks the same way", { a, f });
  ok(a.res === 18 && a.vrate === 0.5 && a.sub === 0 && a.noise === 1 && a.trate === 14 && a.fmratio === 8 && a.sweep === -1 && a.unison === 4 && a.cutoff === 120 && a.attack === undefined && a.bogus === undefined, "ranges are enforced, whole numbers where they must be, strangers dropped", a);
  ok(E.cleanSynth({ ftype: "evil" }) === null && E.cleanSynth({ ftype: "highpass" }).ftype === "highpass", "a filter type must be one of the three");
  const keys = Object.keys(E.SYNTH_RANGES).concat(["wave", "ftype"]);
}

// ---- the drum kits ----
{
  ok(E.KITS.length === 15 && new Set(E.KITS).size === 15 && E.KITS.every((k) => E.KIT_LABELS[k]), "fifteen kits, each with a name", E.KITS);
  ok(JSON.stringify(F.KITS) === JSON.stringify(E.KITS), "the import cleaner lists the same kits in the same order");
  const bad = [];
  E.KITS.forEach((kit) => E.DRUM_VOICES.forEach((row) => {
    try {
      const ctx = drum(row, kit);
      if (count(ctx, "osc") + count(ctx, "source") < 1) bad.push(`${kit}/${row}`);
    } catch (e) { bad.push(`${kit}/${row}: ${e.message}`); }
  }));
  ok(bad.length === 0, "every drum plays in every kit", bad);
  const kickStart = (kit, meta) => drum("kick", kit, meta).nodes.find((n) => n.kind === "osc").frequency.calls[0].v;
  ok(new Set(E.KITS.map((k) => kickStart(k))).size >= 12, "the kits really differ (twelve or more different kick pitches)");
  ok(drum("kick", "chip").nodes.find((n) => n.kind === "osc").type === "square" && drum("kick", "acoustic").nodes.find((n) => n.kind === "osc").type === "sine", "a chip kit's kick is a square wave");
  ok(count(drum("kick", "industrial"), "shaper") === 1 && count(drum("kick", "acoustic"), "shaper") === 0, "drive is built only for the kits that ask for it");
  // every kick has its beater (a few milliseconds of noise); a kit that asks for more click has a louder one
  const clickLevel = (kit) => drum("kick", kit).nodes.find((n) => n.kind === "source").out[0].out[0].gain.calls[0].v;
  ok(count(drum("kick", "909"), "source") === 1 && count(drum("kick", "acoustic"), "source") === 1 && clickLevel("909") > clickLevel("acoustic"), "every kick has a beater, and a kit with a click has a louder one");
  ok(drum("kick", "nonsense").nodes.find((n) => n.kind === "osc").frequency.calls[0].v === kickStart("acoustic") && drum("kick", "constructor").nodes.length > 0, "an unknown kit is the acoustic one");
}

// ---- one drum sound's own tune, length and tone ----
{
  const start = (meta) => drum("kick", "acoustic", meta).nodes.find((n) => n.kind === "osc").frequency.calls[0].v;
  ok(Math.abs(start({ tune: 12 }) / start({}) - 2) < 1e-9 && Math.abs(start({ tune: -12 }) / start({}) - 0.5) < 1e-9, "tune is in semitones: twelve is an octave");
  const end = (meta) => Math.max(...drum("kick", "acoustic", meta).nodes.filter((n) => n.kind === "gain").flatMap((n) => n.gain.calls.map((c) => c.t)));
  ok(end({ decay: 2 }) > end({}) * 1.6 && end({ decay: 0.5 }) < end({}) * 0.7, "length stretches the decay");
  const hatHP = (meta) => drum("hihat", "acoustic", meta).nodes.find((n) => n.kind === "filter" && n.type === "highpass").frequency.value;
  ok(hatHP({ tone: 1 }) > hatHP({}) * 2 && hatHP({ tone: -1 }) < hatHP({}) / 2, "tone moves a hi-hat's filter up or down");
  ok(start({ tone: 1 }) > start({}), "and on a kick it is the punch of the pitch drop");
  const d = E.drumShape({ tune: 99, decay: 0, tone: -9, volume: 0.5 });
  ok(d.tune === 12 && d.decay === 0.3 && d.tone === -1 && d.volume === undefined && Object.keys(E.drumShape({ tune: "x", decay: null, tone: "" })).length === 0 && Object.keys(E.drumShape(undefined)).length === 0, "tweaks are held to their ranges and anything else is ignored", d);
  ok(start({ tune: NaN, decay: "x" }) === start({}), "a bad value changes nothing");
  // only that sound
  const two = play({ tempo: 120, kit: "acoustic", master_volume: 1, tracks: { kick: [true], snare: [true] }, trackMeta: { kick: { tune: 12 }, snare: {} }, melody: { notes: {} } });
  const oscs = two.nodes.filter((n) => n.kind === "osc");
  ok(Math.abs(oscs[0].frequency.calls[0].v - 150 * 2.5 * 2) < 1e-9 && Math.abs(oscs[1].frequency.calls[0].v - 200 * 1.35) < 1e-9, "the tweak belongs to the sound it was made on (the kick is an octave up, the snare is as the kit has it)");
  // saving and importing
  const meta = F.cleanSong({ tempo: 100, tracks: { kick: lane("x...............") }, trackMeta: { kick: { tune: 40, decay: 0.01, tone: 0.25, color: "#ff0000" }, snare: { tune: "x", decay: 2 } } }).trackMeta;
  ok(meta.kick.tune === 12 && meta.kick.decay === 0.3 && meta.kick.tone === 0.25 && meta.snare.tune === undefined && meta.snare.decay === 2 && meta.hihat.tune === undefined, "an imported song keeps them inside their ranges", meta);
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
