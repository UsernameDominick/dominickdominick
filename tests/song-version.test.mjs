// A song carries the version of the format it was saved in (SONG_VERSION). cleanSong stamps it, migrateSong is the one place that brings a
// song from an earlier build up to date, and a song saved long ago (no version, with fields that have since been removed) still opens.
import fs from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined && !c ? " " + JSON.stringify(extra) : ""}`); };

const window = {};
const context = vm.createContext({ window, Math, Number, Object, Array, JSON, Set, String, Uint8Array, console });
for (const f of ["song-files.js", "song-starters.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/studio/${f}`, import.meta.url), "utf8"), context);
const F = window.SongFiles;
const S = window.SongStarters;
const V = F.SONG_VERSION;

ok(Number.isInteger(V) && V >= 2, "the song format has a version number", V);

// ---- cleanSong always stamps it
ok(F.cleanSong({}).version === V && F.cleanSong(null).version === V && F.cleanSong("x").version === V && F.cleanSong([]).version === V, "a song, nothing at all, a string and a list all come out stamped");
ok(F.cleanSong({ version: 1 }).version === V, "a song from the first format is stamped with the current one");
ok(F.cleanSong({ version: 99 }).version === V, "a song from a newer build is read as far as this build understands it and stamped with this one");
ok(F.cleanSong({ version: "abc" }).version === V && F.cleanSong({ version: -4 }).version === V && F.cleanSong({ version: NaN }).version === V, "a nonsense version is treated as the oldest and brought up to date");

// ---- migrateSong
const old = { tempo: 90, tracks: { kick: [true, ...Array(15).fill(false)] } };
const frozen = JSON.stringify(old);
const moved = F.migrateSong(old);
ok(JSON.stringify(old) === frozen, "migrateSong leaves the song it was given alone");
ok(moved !== old && moved.version === V && moved.tempo === 90, "it returns a copy, stamped, with the song's own fields kept");
ok(F.migrateSong(null).version === V && F.migrateSong(undefined).version === V && F.migrateSong([1, 2]).version === V, "it copes with anything");

// ---- a song saved by an early build (no version, the removed player-look fields, a cached waveform) still opens, with its music
const early = {
  tempo: 100,
  kit: "808",
  visualization: "bars",
  theme: "neon",
  page_sync: true,
  cached_peaks: Array(200).fill(0.5),
  private_notes: "remember the bridge",
  tracks: { kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false], snare: Array(16).fill(false), hat: Array(16).fill(false), clap: Array(16).fill(false) },
  trackMeta: { kick: { color: "#ff0000", note: "thump" } },
  melody: { waveform: "square", notes: { C4: [true, ...Array(15).fill(false)] } },
};
const c = F.cleanSong(early);
ok(c.version === V && c.tempo === 100 && c.kit === "808", "its tempo and kit are kept");
ok(c.tracks.kick.filter(Boolean).length === 4 && c.melody.notes.C4[0] === true && c.melody.waveform === "square", "its beats and its melody are kept");
ok(c.private_notes === "remember the bridge" && c.trackMeta.kick.note === "thump", "its notes are kept");
ok(!("visualization" in c) && !("theme" in c) && !("page_sync" in c) && !("cached_peaks" in c), "the fields of features that no longer exist are dropped, not kept");
ok(JSON.stringify(F.cleanSong(c)) === JSON.stringify(c), "cleaning the result again changes nothing");

// ---- every starter is current
for (const { id, name } of S.LIST) {
  const song = S.build(id);
  ok(song && F.cleanSong(song).version === V, `${name}: it cleans and carries the version`);
}

// ---- new songs made by the builder carry it too (the builder is one big script, so look at its source)
const builder = fs.readFileSync(new URL("../public/studio/song-builder.js", import.meta.url), "utf8");
ok(/function defaultSongData\(\) \{\s*return \{\s*version: window\.SongFiles\.SONG_VERSION,/.test(builder), "a new song starts with the version");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
