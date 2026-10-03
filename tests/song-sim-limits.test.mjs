// Song saves and simulation saves: shape checks, size caps, and a rename that can never wipe a song.
import assert from "node:assert/strict";
import { cleanSongSave, songDataError, MAX_SONG_BYTES } from "../worker/songs.js";
import { simulationDataError, MAX_SIMULATION_COMPONENTS, MAX_SIMULATION_WIRES } from "../worker/simulation-validation.js";

// ---- songs ----
const song = {
  tempo: 120, kit: "acoustic", private_notes: "", swing: 0,
  tracks: { kick: [true, false, false, false], snare: [false, false, true, false] },
  trackMeta: { kick: { color: "#fff", note: "" } },
  melody: { waveform: "sine", notes: { C4: [true, false], D4: [false, false] } },
};
assert.equal(songDataError(song), null);
assert.equal(songDataError({}), null, "an empty song is fine");
assert.equal(songDataError({ tempo: null }), null);
for (const bad of [null, undefined, [], "x", 5, true]) assert.ok(songDataError(bad), String(bad));
assert.match(songDataError({ tempo: "fast" }), /tempo/);
assert.match(songDataError({ tempo: Infinity }), /tempo/);
assert.match(songDataError({ tracks: [] }), /tracks/);
assert.match(songDataError({ tracks: { kick: "x" } }), /tracks/);
assert.match(songDataError({ trackMeta: [] }), /track settings/);
assert.match(songDataError({ melody: [] }), /melody/);
assert.match(songDataError({ melody: { notes: [] } }), /notes/);
assert.match(songDataError({ melody: { notes: { C4: 1 } } }), /notes/);
assert.match(songDataError({ private_notes: 5 }), /private notes/);
assert.match(songDataError({ private_notes: "x".repeat(20001) }), /private notes/);
assert.match(songDataError({ filler: "x".repeat(MAX_SONG_BYTES) }), /too large/);

// Create: data left out is an empty song.
assert.deepEqual(cleanSongSave({ name: "  Demo " }), { name: "Demo", data: {} });
assert.deepEqual(cleanSongSave({ name: "Demo", data: song }), { name: "Demo", data: song });
assert.deepEqual(cleanSongSave({ name: "Demo", data: null }), { name: "Demo", data: {} });
// Edit: data left out means keep the song as it is.
assert.deepEqual(cleanSongSave({ name: "New name" }, { edit: true }), { name: "New name", data: undefined });
assert.deepEqual(cleanSongSave({ name: "New name", data: null }, { edit: true }), { name: "New name", data: undefined });
assert.deepEqual(cleanSongSave({ name: "New name", data: {} }, { edit: true }), { name: "New name", data: {} }, "an explicit empty song is still an empty song");
// Names.
for (const bad of [{}, { name: "" }, { name: "   " }, { name: 5 }, { name: null }, { name: ["a"] }, null, undefined]) assert.match(cleanSongSave(bad).error, /Name is required/, JSON.stringify(bad));
assert.match(cleanSongSave({ name: "x".repeat(201) }).error, /name/);
assert.match(cleanSongSave({ name: "a\nb" }).error, /name/);
assert.match(cleanSongSave({ name: "ok", data: [] }).error, /object/);
assert.match(cleanSongSave({ name: "ok", data: "x" }, { edit: true }).error, /object/);

// ---- simulations ----
const part = (id) => ({ id, type: "led", x: 10 + (id % 100), y: 10 });
assert.equal(simulationDataError({ components: [], wires: [] }), null);
const many = Array.from({ length: MAX_SIMULATION_COMPONENTS + 1 }, (_, i) => part(i + 1));
assert.match(simulationDataError({ components: many, wires: [] }), /up to 1000 parts/);
assert.doesNotMatch(simulationDataError({ components: many.slice(0, MAX_SIMULATION_COMPONENTS), wires: [] }) || "", /up to 1000 parts/, "exactly the cap is not over it");
const wires = Array.from({ length: MAX_SIMULATION_WIRES + 1 }, () => ({}));
assert.match(simulationDataError({ components: [], wires }), /up to 5000 wires/);
assert.match(simulationDataError({ components: [], wires: [], filler: "x".repeat(1000000) }), /too large/);
// The checks that were already there still run.
assert.match(simulationDataError({ components: [{ id: 1, type: "nope", x: 1, y: 1 }], wires: [] }), /unique id, supported type/);
assert.match(simulationDataError("x"), /must be an object/);

console.log("ALL PASS");
