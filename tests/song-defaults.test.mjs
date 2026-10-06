// The song defaults an owner sets in Site Settings: only a plain whole number in range (or a kit we have) is kept, everything else becomes
// "" (the built-in default), and a save without them leaves them alone.
import assert from "node:assert/strict";
import { cleanSongDefault, cleanSongDefaults, SONG_DEFAULT_KEYS } from "../worker/song-defaults.js";

assert.deepEqual(SONG_DEFAULT_KEYS, ["song_default_tempo", "song_default_bars", "song_default_kit"]);
for (const [value, want] of [["96", "96"], [" 140 ", "140"], [40, "40"], ["240", "240"], ["39", ""], ["241", ""], ["12.5", ""], ["1e2", ""], ["-90", ""], ["abc", ""], ["", ""], [null, ""], [undefined, ""], ["99999", ""], ["0x50", ""]]) {
  assert.equal(cleanSongDefault("song_default_tempo", value), want, `tempo ${JSON.stringify(value)}`);
}
for (const [value, want] of [["1", "1"], ["64", "64"], ["0", ""], ["65", ""], ["8.5", ""]]) assert.equal(cleanSongDefault("song_default_bars", value), want, `bars ${value}`);
for (const [value, want] of [["acoustic", "acoustic"], ["808", "808"], ["electronic", "electronic"], ["", ""], ["bogus", ""], [808, "808"], ["__proto__", ""]]) assert.equal(cleanSongDefault("song_default_kit", value), want, `kit ${value}`);
assert.equal(cleanSongDefault("other", "5"), "");
const body = { song_default_tempo: "9", song_default_bars: "8", song_default_kit: "nope", site_footer: "x" };
cleanSongDefaults(body);
assert.deepEqual(body, { song_default_tempo: "", song_default_bars: "8", song_default_kit: "", site_footer: "x" });
const untouched = { site_footer: "x" };
cleanSongDefaults(untouched);
assert.deepEqual(untouched, { site_footer: "x" });
console.log("ALL PASS");
