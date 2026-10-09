// The mixer: a pan and a level per track (song.mix) and solo (song._solo). A track with neither is routed exactly as before and builds nothing; a track
// with a pan goes through a channel strip (a gain and a stereo panner) on its way to the master; solo silences the other tracks; the file cleaner keeps a mix.
import { makeCtx, loadEngine, loadSongFiles, lane, count, audible } from "./fake-audio.mjs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined && !c ? " " + JSON.stringify(extra) : ""}`); };
const E = loadEngine();
const F = loadSongFiles();

const song = (extra = {}) => ({
  tempo: 120, kit: "acoustic", master_volume: 1, trackMeta: {}, tracks: { kick: lane("x...............") },
  melody: { waveform: "sine", notes: { C4: lane("x...............") } },
  bass: { voice: "bass", notes: { C2: lane("x...............") } },
  ...extra,
});
const play = (data, step = 0) => { const ctx = makeCtx(); E.scheduleStep(ctx, data, step, 0, () => 0.5); return ctx; };
const panners = (ctx) => ctx.nodes.filter((n) => n.kind === "panner");

// ---- the default: nothing is built
{
  const base = play(song());
  ok(panners(base).length === 0, "no mix, no panner");
  const flat = play(song({ mix: { drums: { pan: 0 }, bass: { level: 1 }, lead: {} } }));
  ok(panners(flat).length === 0 && flat.nodes.length === base.nodes.length, "a mix that only holds the defaults builds nothing: the same nodes as no mix", [flat.nodes.length, base.nodes.length]);
  ok(E.mixOf(song(), "drums") === null && E.mixOf({ mix: "x" }, "bass") === null && E.mixOf(null, "bass") === null, "mixOf is null with no mix, and is not fooled by nonsense");
  const m = E.mixOf({ mix: { bass: { pan: 5, level: -2 } } }, "bass");
  ok(m.pan === 1 && m.level === 0, "a pan and a level are put inside their ranges", m);
  const m2 = E.mixOf({ mix: { bass: { pan: "x", level: null } } }, "bass");
  ok(m2.pan === 0 && m2.level === 1, "junk counts as the default", m2);
}

// ---- a panned track goes through a strip
{
  const ctx = play(song({ mix: { bass: { pan: -0.5 } } }));
  const ps = panners(ctx);
  ok(ps.length === 1, "one panned track builds one panner", ps.length);
  const p = ps[0];
  const last = p.pan.calls[p.pan.calls.length - 1];
  ok(last && last.kind === "target" && Math.abs(last.v + 0.5) < 1e-9, "the pan glides to its value (no click when it is turned)", last);
  const strip = ctx.nodes.find((n) => n.kind === "gain" && n.out.includes(p));
  ok(!!strip, "a gain feeds the panner (the strip's input)");
  ok(audible(ctx, p), "and the panner reaches the speakers");
  // the bass voice's own gain stages end at the strip, not at the master
  const bassOsc = ctx.nodes.filter((n) => n.kind === "osc");
  const reach = (from, to, seen = new Set()) => from === to || (!seen.has(from) && (seen.add(from), (from.out || []).some((o) => reach(o, to, seen))));
  ok(bassOsc.some((o) => reach(o, p)), "the bass notes go through the panner");
  // only the bass: the melody and the drums do not
  const mel = ctx.nodes.filter((n) => n.kind === "osc" && !reach(n, p));
  ok(mel.length >= 1, "the other tracks do not");
  // the same strip serves every note of the track and every step
  const ctx2 = makeCtx();
  const data = song({ mix: { bass: { pan: 0.7 } }, bass: { voice: "bass", notes: { C2: lane("xx..............") } } });
  E.scheduleStep(ctx2, data, 0, 0, () => 0.5);
  E.scheduleStep(ctx2, data, 1, 0.125, () => 0.5);
  ok(panners(ctx2).length === 1, "one strip for the whole track, however many steps");
  // the drums have a strip of their own
  const dctx = play(song({ mix: { drums: { pan: 0.3 } } }));
  ok(panners(dctx).length === 1 && dctx.nodes.filter((n) => n.kind === "osc").some((o) => reach(o, panners(dctx)[0])), "the drums can be panned, as one track");
}

// ---- a level lowers a track as a whole
{
  const ctx = play(song({ mix: { drums: { level: 0.5 } } }));
  const strip = ctx.nodes.find((n) => n.kind === "gain" && n.gain.calls.some((c) => c.kind === "target" && Math.abs(c.v - 0.5) < 1e-9));
  ok(!!strip, "a level below 1 builds a strip whose gain glides to it", strip && strip.gain.calls);
}

// ---- solo
{
  const solo = play(song({ _solo: "bass" }));
  const normal = play(song());
  ok(solo.nodes.length < normal.nodes.length && count(solo, "osc") >= 1, "solo plays only that track: fewer sounds than the whole mix", [solo.nodes.length, normal.nodes.length]);
  const nothing = play(song({ _solo: "lead" }));
  ok(nothing.nodes.filter((n) => n.kind === "osc").length === 0 && nothing.nodes.filter((n) => n.kind === "source").length === 0, "solo on a track with nothing in it plays nothing at all");
  ok(E.soloSilences({ _solo: "bass" }, "drums") && !E.soloSilences({ _solo: "bass" }, "bass") && !E.soloSilences({}, "bass") && !E.soloSilences({ _solo: "nope" }, "bass") && !E.soloSilences({ _solo: 3 }, "bass"), "soloSilences: the others, never the soloed track, never for a bad name");
  const pumped = play(song({ pump: 80, _solo: "melody" }));
  ok(!pumped.nodes.some((n) => n.kind === "gain" && n.gain.calls.some((c) => c.kind === "target" && c.v < 0.2)), "with the drums soloed out there is no kick, so Pump has nothing to duck");
}

// ---- Pump and a panned track: the strip feeds the music bus
{
  const ctx = play(song({ pump: 60, mix: { bass: { pan: 0.4 } } }));
  const p = panners(ctx)[0];
  ok(!!p && audible(ctx, p), "with Pump on, a panned track still reaches the speakers");
}

// ---- the file cleaner
{
  const clean = F.cleanSong({ tempo: 120, tracks: { kick: [true] }, mix: { drums: { pan: 0.5, level: 0.25 }, bass: { pan: 0 }, melody: { pan: 9 }, nope: { pan: 1 }, lead: 3 }, _solo: "bass" });
  ok(clean.mix && clean.mix.drums.pan === 0.5 && clean.mix.drums.level === 0.25, "a mix survives cleaning", clean.mix);
  ok(!("bass" in clean.mix) && clean.mix.melody.pan === 1 && !("nope" in clean.mix) && !("lead" in clean.mix), "default entries are dropped, ranges are kept, unknown tracks and junk are ignored", clean.mix);
  ok(!("_solo" in clean), "solo is never kept");
  ok(!("mix" in F.cleanSong({ tempo: 120, tracks: { kick: [true] } })) && !("mix" in F.cleanSong({ tempo: 120, tracks: {}, mix: { bass: { pan: 0 } } })), "a song with no mix, or only defaults, has no mix field");
  const twice = F.cleanSong(clean);
  ok(JSON.stringify(twice.mix) === JSON.stringify(clean.mix), "cleaning is stable");
}

// ---- a stereo render has two channels
{
  const data = song();
  const mono = await E.renderLoopAudio(data, { loops: 1 });
  const stereo = await E.renderLoopAudio(data, { loops: 1, stereo: true });
  ok(!mono.right && stereo.right && stereo.right.length === stereo.samples.length && stereo.samples.length === mono.samples.length, "stereo: true gives a second channel of the same length; mono has none");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
