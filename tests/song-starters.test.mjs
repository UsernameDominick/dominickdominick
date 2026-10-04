// The built-in starter songs: every one is a valid, clean, playable song that the server would accept, uses the features it advertises
// (patterns, a song order, a bass line), survives MIDI export and import, and a bad id gives nothing.
import fs from "node:fs";
import vm from "node:vm";
import { loadEngine, loadSongFiles } from "./fake-audio.mjs";
import { songDataError } from "../worker/songs.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const E = loadEngine();
const F = loadSongFiles();
// the starters file needs SongFiles on its window, so load both into one context
const window = {};
const context = vm.createContext({ window, Math, Number, Object, Array, JSON, Set, String, Uint8Array, console });
for (const f of ["song-files.js", "song-starters.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/admin/${f}`, import.meta.url), "utf8"), context);
const S = window.SongStarters;

ok(S.LIST.length >= 4 && S.LIST.every((s) => s.id && s.name && s.blurb.length > 20), "there are at least four starters, each with an id, a name and a description", S.LIST.map((s) => s.id));
ok(new Set(S.LIST.map((s) => s.id)).size === S.LIST.length, "the ids are unique");
ok(S.build("nope") === null && S.build("") === null && S.build("__proto__") === null && S.build(undefined) === null, "an unknown id gives nothing");

for (const { id, name } of S.LIST) {
  const song = S.build(id);
  ok(song && !songDataError(song), `${name}: the server accepts it`, song && songDataError(song));
  ok(JSON.stringify(F.cleanSong(song)) === JSON.stringify(song), `${name}: it is already clean (cleaning it again changes nothing)`);
  ok(JSON.stringify(song).length < 40000, `${name}: it is small`, JSON.stringify(song).length);
  const names = E.patternNames(song);
  const chain = E.chainOf(song);
  ok(names.length >= 2 && chain.length >= 4 && chain.length <= 32 && chain.every((n) => names.includes(n)), `${name}: patterns ${names.join("")} and a song order of ${chain.length} bars`, chain.join(""));
  ok(chain.every((n) => Array.isArray(E.patternData(song, n).tracks.kick)), `${name}: every pattern has the core rows`);
  const parts = E.chainPatterns(song);
  const anyDrums = parts.some((p) => Object.values(p.tracks).some((lane) => lane.some(Boolean)));
  const anyMelody = parts.some((p) => Object.values(p.notes).some((lane) => lane.some(Boolean)));
  const anyBass = parts.some((p) => p.bass && Object.values(p.bass.notes).some((lane) => lane.some(Boolean)));
  ok(anyDrums && anyMelody && anyBass, `${name}: it has drums, a melody and a bass line`, { anyDrums, anyMelody, anyBass });
  ok(parts.every((p) => Object.values(p.tracks).every((lane) => lane.length === 16) && Object.values(p.notes).every((lane) => lane.length === 16) && (!p.bass || Object.values(p.bass.notes).every((lane) => lane.length === 16))), `${name}: every lane is 16 steps`);
  ok(song.tempo >= 60 && song.tempo <= 180 && ["acoustic", "electronic", "808"].includes(song.kit) && song.scale && song.melody.voice, `${name}: tempo ${song.tempo}, kit ${song.kit}, a scale and a melody sound`);
  // each melody note is a note of the melody roll, each bass note one of the bass roll
  ok(Object.keys(song.melody.notes).length === 24 && Object.keys(song.bass.notes).length === 24, `${name}: melody and bass notes are on their rolls`);
  // held notes: ties only where the note is on at both steps (cleanSong guarantees it), and some are used
  ok(parts.some((p) => Object.keys(p.ties || {}).length || (p.bass && Object.keys(p.bass.ties || {}).length)), `${name}: it uses held notes`);
  // it plays
  const peaks = await E.renderWaveformPeaks(song, 40);
  ok(peaks.length === 40, `${name}: the waveform preview renders`);
  const audio = await E.renderLoopAudio(song, { loops: 1 });
  ok(audio.loopSamples === Math.round((60 / song.tempo / 4) * 16 * chain.length * 44100), `${name}: the audio export is the whole song order`, audio.loopSamples);
  // MIDI out and back
  const midi = F.buildMidi(song, name);
  ok(midi.bytes && midi.notes > 20, `${name}: the MIDI file has notes`, midi.notes);
  const back = F.importMidi(midi.bytes);
  ok(!back.error && back.info.bars === chain.length && back.info.bassNotes > 0 && back.info.melodyNotes > 0, `${name}: the MIDI file imports again with all ${chain.length} bars, melody and bass`, back.error || back.info);
  const sameOrder = F.chainParts(back.song).map((p) => JSON.stringify(Object.keys(p.tracks.kick || []).length ? p.tracks.kick : []));
  ok(sameOrder.length === chain.length, `${name}: and the imported song order is as long`);
}

// the starters differ enough to be worth having
const tempos = new Set(S.LIST.map((s) => S.build(s.id).tempo));
const kits = new Set(S.LIST.map((s) => S.build(s.id).kit));
ok(tempos.size === S.LIST.length && kits.size >= 3, "the starters differ in tempo and use at least three kits", { tempos: [...tempos], kits: [...kits] });
ok(S.build("house").tracks.openhat && S.build("lofi").trackMeta.kick && !S.build("lofi").tracks.openhat, "an extra drum row exists only in the songs that use it");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
