// The song builder's MIDI export and JSON song file (export, and a safe import).
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/admin/song-files.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, String, Array, Object, JSON, Uint8Array, Set }));
const F = window.SongFiles;
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

// ---- a small MIDI reader, so the test checks the bytes rather than the code that wrote them ----
function readMidi(bytes) {
  let p = 0;
  const str = (n) => { const s = String.fromCharCode(...bytes.slice(p, p + n)); p += n; return s; };
  const u32 = () => { const v = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0; p += 4; return v; };
  const u16 = () => { const v = (bytes[p] << 8) | bytes[p + 1]; p += 2; return v; };
  const vlq = () => { let v = 0, b; do { b = bytes[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  if (str(4) !== "MThd" || u32() !== 6) throw new Error("bad header");
  const out = { format: u16(), ntracks: u16(), division: u16(), tracks: [] };
  for (let t = 0; t < out.ntracks; t++) {
    if (str(4) !== "MTrk") throw new Error("bad track");
    const len = u32();
    const stop = p + len;
    const tr = { name: "", events: [], tempo: null, timeSig: null, ended: false };
    let tick = 0, status = 0;
    while (p < stop) {
      tick += vlq();
      let b = bytes[p++];
      if (b === 0xff) {
        const type = bytes[p++]; const n = vlq(); const data = bytes.slice(p, p + n); p += n;
        if (type === 0x03) tr.name = String.fromCharCode(...data);
        if (type === 0x51) tr.tempo = (data[0] << 16) | (data[1] << 8) | data[2];
        if (type === 0x58) tr.timeSig = [...data];
        if (type === 0x2f) tr.ended = true;
      } else {
        if (b & 0x80) status = b; else p--;
        const kind = status & 0xf0, ch = status & 0x0f;
        const d1 = bytes[p++], d2 = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[p++];
        tr.events.push({ tick, kind, ch, note: d1, vel: d2 });
      }
    }
    if (p !== stop) throw new Error("track length mismatch");
    out.tracks.push(tr);
  }
  if (p !== bytes.length) throw new Error("trailing bytes");
  return out;
}

const lane = (str) => Array.from(str, (c) => c === "x");
const song = (extra = {}) => ({
  tempo: 120, swing: 0,
  tracks: { kick: lane("x...x...x...x..."), snare: lane("....x.......x..."), hihat: lane("................"), clap: lane("................") },
  trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} },
  melody: { waveform: "sine", notes: { C4: lane("x..............."), E4: lane("xx.............."), A3: lane("................") } },
  ...extra,
});

// note names
ok(F.noteNumber("C4") === 60 && F.noteNumber("A4") === 69 && F.noteNumber("C#3") === 49 && F.noteNumber("B3") === 59, "note names map to MIDI numbers, C4 = 60 (middle C)");
ok(F.noteNumber("H4") === null && F.noteNumber("") === null && F.noteNumber("C99") === null && F.noteNumber(null) === null, "anything that isn't a note name is rejected");

// the file's structure
{
  const out = F.buildMidi(song(), "My Loop");
  const m = readMidi(out.bytes);
  ok(m.format === 1 && m.division === 480 && m.ntracks === 3 && m.tracks.length === 3, "format 1, 480 ticks per quarter, a tempo track plus drums and melody", [m.format, m.division, m.ntracks]);
  ok(m.tracks.every((t) => t.ended), "every track ends with an end-of-track marker");
  ok(m.tracks[0].name === "My Loop" && m.tracks[0].tempo === 500000 && m.tracks[0].timeSig.join() === "4,2,24,8", "the first track names the song, sets 120 BPM (500000 µs per quarter) and 4/4", [m.tracks[0].name, m.tracks[0].tempo]);
  const drums = m.tracks[1], mel = m.tracks[2];
  ok(drums.name === "Drums" && drums.events.every((e) => e.ch === 9), "drums are on channel 10 (index 9)");
  const ons = (t) => t.events.filter((e) => e.kind === 0x90 || e.kind === 0x99);
  const offs = (t) => t.events.filter((e) => e.kind === 0x80 || e.kind === 0x89);
  ok(ons(drums).length === 6 && offs(drums).length === 6, "6 drum hits, each with its own note-off", ons(drums).length);
  ok(ons(drums).filter((e) => e.note === 36).map((e) => e.tick).join() === "0,480,960,1440", "the kick lands on steps 1, 5, 9 and 13 (a quarter note = 480 ticks apart)", ons(drums).filter((e) => e.note === 36).map((e) => e.tick));
  ok(ons(drums).filter((e) => e.note === 38).map((e) => e.tick).join() === "480,1440", "the snare uses GM note 38 on steps 5 and 13");
  ok(mel.name === "Melody" && mel.events.every((e) => e.ch === 0), "the melody is on channel 1");
  ok(ons(mel).length === 3 && ons(mel).map((e) => e.note).sort().join() === "60,64,64", "the melody's C4 (60) and two E4 (64) notes", ons(mel).map((e) => e.note));
  const e4 = ons(mel).filter((e) => e.note === 64).map((e) => e.tick);
  ok(e4.join() === "0,120", "two E4 steps in a row start one step (120 ticks) apart", e4);
  // a note ends before the next one on the same pitch starts
  const sameTick = mel.events.filter((e) => e.note === 64 && e.tick === 120).map((e) => e.kind);
  ok(sameTick.join() === "128,144", "at the tick where E4 restarts, the old one ends first (off 0x80 then on 0x90)", sameTick);
  ok(Math.min(...ons(drums).map((e) => e.vel)) === 100 && ons(drums).every((e) => e.vel <= 127), "a full-strength hit has velocity 100");
}

// held (tied) notes are one long note in the file, not several short ones
{
  const held = readMidi(F.buildMidi(song({ melody: { waveform: "sine", notes: { C4: lane("xxx.x..........."), E4: lane("x...............") }, ties: { C4: lane(".xx.............") } } }), "x").bytes);
  const mel = held.tracks[2];
  const c4 = mel.events.filter((e) => e.note === 60).map((e) => `${e.kind === 0x90 ? "on" : "off"}@${e.tick}`);
  ok(c4.join() === "on@0,off@360,on@480,off@600", "C4 held across steps 1-3 is one note from tick 0 to 360, then a separate one-step note at step 5", c4);
  const e4 = mel.events.filter((e) => e.note === 64).map((e) => `${e.kind === 0x90 ? "on" : "off"}@${e.tick}`);
  ok(e4.join() === "on@0,off@120", "an untied note is still one step long", e4);
  const flagOnly = readMidi(F.buildMidi(song({ melody: { waveform: "sine", notes: { C4: lane("x.x.............") }, ties: { C4: lane("..x.............") } } }), "x").bytes);
  const f = flagOnly.tracks[2].events.filter((e) => e.kind === 0x90).map((e) => e.tick);
  ok(f.join() === "0,240", "a tie flag with no note on the step before is ignored (both notes are struck)", f);
  ok(F.buildMidi(song({ melody: { waveform: "sine", notes: { C4: lane("xxxx............") }, ties: { C4: lane(".xxx............") } } }), "x").notes === 1 + 6 && true, "a held note counts once in the note total (6 drum hits plus 1)", F.buildMidi(song({ melody: { waveform: "sine", notes: { C4: lane("xxxx............") }, ties: { C4: lane(".xxx............") } } }), "x").notes);
}

// tempo, swing, strength, volume, muting
{
  const m = readMidi(F.buildMidi(song({ tempo: 90 }), "x").bytes);
  ok(m.tracks[0].tempo === Math.round(60000000 / 90), "90 BPM is 666667 µs per quarter", m.tracks[0].tempo);
  const sw = readMidi(F.buildMidi(song({ swing: 100, tracks: { kick: lane("xxxx............"), snare: [], hihat: [], clap: [] } }), "x").bytes);
  const k = sw.tracks[1].events.filter((e) => e.kind === 0x90).map((e) => e.tick);
  ok(k.join() === "0,180,240,420", "100% swing delays every second step by half a step (60 ticks)", k);
  const soft = readMidi(F.buildMidi(song({ tracks: { kick: [0.35, false, true], snare: [], hihat: [], clap: [] }, trackMeta: { kick: { volume: 0.5 } } }), "x").bytes);
  const vel = soft.tracks[1].events.filter((e) => e.kind === 0x90).map((e) => e.vel);
  ok(vel.join() === "18,50", "strength and track volume multiply into velocity (0.35 × 0.5 → 18, full × 0.5 → 50)", vel);
  const muted = readMidi(F.buildMidi(song({ trackMeta: { kick: { muted: true }, snare: {}, hihat: {}, clap: {} } }), "x").bytes);
  ok(muted.tracks[1].events.filter((e) => e.kind === 0x90).every((e) => e.note !== 36), "a muted drum is left out");
  const noMel = readMidi(F.buildMidi(song({ melody: { waveform: "sine", muted: true, notes: { C4: lane("x") } } }), "x").bytes);
  ok(noMel.ntracks === 2 && noMel.tracks.every((t) => t.name !== "Melody"), "a muted melody is left out, and so is its track");
  const only = readMidi(F.buildMidi(song({ melody: { notes: {} } }), "x").bytes);
  ok(only.ntracks === 2, "a song with no melody notes has no melody track");
  ok(F.buildMidi(song({ tracks: { kick: [], snare: [], hihat: [], clap: [] }, melody: { notes: {} } }), "x").bytes === null, "nothing to export gives no file");
  ok(F.buildMidi({}, "x").bytes === null && F.buildMidi(null, "x").bytes === null && F.buildMidi({ tracks: "nope", melody: 5 }, "x").bytes === null, "damaged songs give no file and never throw");
  const odd = readMidi(F.buildMidi(song(), "Café ☃ \n").bytes);
  ok(/^Caf\? \? \?$/.test(odd.tracks[0].name), "a name with non-ASCII characters is written as ? so no reader gets odd bytes", odd.tracks[0].name);
}

// ---- JSON ----
{
  const clean = F.cleanSong(song());
  const text = F.exportJson("My Loop", clean);
  const back = F.parseImport(text);
  ok(!back.error && back.name === "My Loop" && JSON.stringify(back.data) === JSON.stringify(clean), "a song exported and read back is identical");
  ok(JSON.parse(text).format === "dominick-song" && JSON.parse(text).version === 1, "the file says what it is and which version");
  const bare = F.parseImport(JSON.stringify(song()));
  ok(!bare.error && bare.name === "Imported song" && bare.data.tracks.kick.length === 16, "a bare song object (as in a site backup) is accepted and named", bare.name);
  // every kind of bad file gets a message, not a crash
  const bad = ["", "   ", "not json", "[]", "5", "null", '{"format":"other","data":{}}', '{"format":"dominick-song","version":2,"data":{"tracks":{}}}', '{"format":"dominick-song","version":1,"data":{}}', '{"format":"dominick-song","data":{"tracks":{}}}', '{"foo":1}'];
  ok(bad.every((t) => typeof F.parseImport(t).error === "string"), "empty, unreadable, foreign, newer-version and song-less files all give a plain error", bad.map((t) => F.parseImport(t).error));
  ok(F.parseImport("x".repeat(2000001)).error && F.parseImport(null).error, "an oversized or missing file is refused");
}

// cleaning: what a hostile or broken file can't do
{
  const hostile = {
    tempo: 9999, kit: "<script>", visualization: "x", theme: "javascript:alert(1)", page_sync: "yes", master_volume: 7, humanize: -5, swing: "50", space: 400, private_notes: "a\u0000b‮" + "n".repeat(30000),
    tracks: { kick: [true, 0.5, 2, -1, "x", null, {}, [1], NaN, Infinity, 0, 0.004, ...Array(20).fill(true)], evil: [true], __proto__: { polluted: true } },
    trackMeta: { kick: { color: "red; background:url(x)", note: "<b>hi</b>".repeat(100), muted: "true", hidden: true, volume: 9 }, snare: { color: "#ABCDEF" } },
    melody: { waveform: "../x", muted: true, volume: -2, notes: { C4: [true], Z9: [true], "<img>": [true], __proto__: { x: 1 } } },
    scale: { root: "H", type: "major" }, extra: { huge: "x".repeat(1000) },
  };
  const c = F.cleanSong(hostile);
  ok(c.tempo === 240 && c.kit === "acoustic" && c.visualization === "bars" && c.theme === "default" && c.page_sync === false && c.master_volume === 1 && c.humanize === 0 && c.swing === 50 && c.space === 100, "settings are limited to what the builder allows (a string number still counts)", [c.tempo, c.kit, c.theme, c.master_volume, c.humanize, c.swing]);
  ok(c.private_notes.length === 20000 && !/[\u0000‮]/.test(c.private_notes), "notes lose control and direction characters and are capped at 20,000");
  ok(c.tracks.kick.length === 16 && c.tracks.kick.slice(0, 12).join() === "true,0.5,true,false,false,false,false,false,false,false,false,0.01", "a drum lane is 16 steps of off, full or a strength between 0.01 and 1", c.tracks.kick.slice(0, 12));
  ok(!("evil" in c.tracks) && Object.keys(c.tracks).join() === "kick,snare,hihat,clap", "only the four known drum lanes survive");
  ok(c.trackMeta.kick.color === "#ff7a45" && c.trackMeta.snare.color === "#ABCDEF" && c.trackMeta.kick.note.length === 200 && c.trackMeta.kick.muted === undefined && c.trackMeta.kick.hidden === true && c.trackMeta.kick.volume === 1, "colours must be #rrggbb, notes are capped, flags must be real booleans, volume is limited", c.trackMeta.kick);
  ok(c.melody.waveform === "sine" && c.melody.muted === true && c.melody.volume === 0 && Object.keys(c.melody.notes).length === 24 && c.melody.notes.C4[0] === true && !("Z9" in c.melody.notes), "the melody keeps only the 24 piano-roll notes", Object.keys(c.melody.notes).length);
  ok(!("scale" in c) && !("extra" in c) && !({}).polluted, "an unknown scale, extra keys and prototype tricks are dropped");
  ok(JSON.stringify(Object.keys(c)) === JSON.stringify(["tempo", "kit", "visualization", "theme", "page_sync", "master_volume", "humanize", "swing", "space", "echo", "private_notes", "tracks", "trackMeta", "melody"]), "the cleaned song has exactly the builder's own keys", Object.keys(c));
  ok(JSON.stringify(F.cleanSong(F.cleanSong(song()))) === JSON.stringify(F.cleanSong(song())), "cleaning twice changes nothing");
  ok(F.cleanSong(null).tracks.kick.length === 16 && F.cleanSong("x").melody.waveform === "sine", "even nothing at all becomes a valid empty song");
  const goodScale = F.cleanSong({ tracks: {}, scale: { root: "D", type: "blues" } });
  ok(goodScale.scale && goodScale.scale.root === "D" && goodScale.scale.type === "blues", "a real scale choice is kept");
}

// the bass line: its own track on channel 2 with the electric bass program, held notes as one long note, mutes and volume
{
  const withBass = song({
    bass: { voice: "pad", volume: 0.5, notes: { C2: lane("x...x...........") , E1: lane("..xx............") }, ties: { E1: lane("...x............") } },
  });
  const out = F.buildMidi(withBass, "Bassy");
  const m = readMidi(out.bytes);
  const bass = m.tracks.find((t) => t.name === "Bass");
  ok(m.ntracks === 4 && bass && m.tracks.map((t) => t.name).join() === "Bassy,Drums,Melody,Bass", "the bass line is its own track after drums and melody", m.tracks.map((t) => t.name));
  ok(bass.events.every((e) => e.ch === 1), "on channel 2 (index 1)");
  const program = bass.events.filter((e) => e.kind === 0xc0);
  ok(program.length === 1 && program[0].note === 33 && program[0].tick === 0, "with the electric bass program (General MIDI 34, zero-based 33) at the very start", program);
  const ons = bass.events.filter((e) => e.kind === 0x90);
  ok(ons.map((e) => e.note + "@" + e.tick).join() === "36@0,28@240,36@480", "C2 (36) on steps 1 and 5 and E1 (28) on step 3, in time order", ons.map((e) => e.note + "@" + e.tick));
  ok(ons.every((e) => e.vel === 50), "the bass volume (50%) scales every velocity", ons.map((e) => e.vel));
  const e1 = bass.events.filter((e) => e.note === 28).map((e) => `${e.kind === 0x90 ? "on" : "off"}@${e.tick}`);
  ok(e1.join() === "on@240,off@480", "a held E1 is one note: on at step 3, off after two steps", e1);
  ok(out.notes === 12, "the note count includes the bass notes (6 drum hits, 3 melody notes, 3 bass notes)", out.notes);
  const mutedBass = readMidi(F.buildMidi(song({ bass: { muted: true, notes: { C2: lane("x...............") } } }), "x").bytes);
  ok(!mutedBass.tracks.some((t) => t.name === "Bass") && mutedBass.ntracks === 3, "a muted bass is left out with its track");
  const emptyBass = readMidi(F.buildMidi(song({ bass: { notes: { C2: lane("................") } } }), "x").bytes);
  ok(!emptyBass.tracks.some((t) => t.name === "Bass"), "an empty bass line writes no track");
  const noBass = readMidi(F.buildMidi(song(), "x").bytes);
  ok(noBass.ntracks === 3 && !noBass.tracks.some((t) => t.name === "Bass"), "a song without a bass line is the same three tracks as ever");
  const multi = song({ bass: { notes: { C2: lane("x...............") }, ties: {} }, patterns: { B: { tracks: {}, notes: {}, ties: {}, bass: { notes: { G1: lane("x...............") }, ties: {} } } }, chain: ["A", "B"] });
  const mm = readMidi(F.buildMidi(multi, "x").bytes).tracks.find((t) => t.name === "Bass");
  const mOns = mm.events.filter((e) => e.kind === 0x90).map((e) => e.note + "@" + e.tick);
  ok(mOns.join() === "36@0,31@1920", "with patterns each bar of the song order brings its own bass notes (C2 in bar 1, G1 in bar 2)", mOns);
}

// the cleaner and the bass line
{
  const hostileBass = { notes: { C2: [true, 0.5, "x"], Z9: [true], C4: [true], "<img>": [true] }, ties: { C2: [false, true, true], Q: [true] }, voice: "nope", muted: "yes", hidden: true, volume: 9, extra: "x" };
  const c = F.cleanSong({ tracks: {}, melody: { notes: {} }, bass: hostileBass });
  ok(c.bass && Object.keys(c.bass.notes).length === 24 && Object.keys(c.bass.notes).every((n) => F.BASS_NOTES.includes(n)), "the bass keeps only its own 24 rows, C1 to B2", Object.keys(c.bass.notes).length);
  ok(c.bass.notes.C2[0] === true && c.bass.notes.C2[1] === 0.5 && c.bass.notes.C2[2] === false && !("C4" in c.bass.notes), "steps are checked like the melody's, and a melody-roll note has no row in the bass");
  ok(c.bass.voice === undefined && c.bass.muted === undefined && c.bass.hidden === true && c.bass.volume === 1 && !("extra" in c.bass), "an unknown voice, a non-boolean mute and extra keys are dropped; volume is limited", c.bass);
  ok(c.bass.ties && c.bass.ties.C2 && c.bass.ties.C2[1] === true && c.bass.ties.C2[2] === false && !c.bass.ties.Q, "a tie only survives where the note is on at that step and the one before", c.bass.ties);
  ok(F.cleanSong({ tracks: {}, melody: { notes: {} }, bass: { voice: "lead", notes: {} } }).bass.voice === "lead", "a real voice name is kept");
  ok(!("bass" in F.cleanSong({ tracks: {}, melody: { notes: {} } })) && !("bass" in F.cleanSong({ tracks: {}, melody: { notes: {} }, bass: "x" })) && !("bass" in F.cleanSong({ bass: [] })), "a song without a bass line (or with a bad one) gets none");
  const patterned = F.cleanSong({ tracks: {}, melody: { notes: {} }, bass: { notes: { C2: [true] } }, patterns: { B: { tracks: {}, notes: {}, bass: { notes: { G1: [true, true], C4: [true] }, ties: { G1: [false, true] } } }, C: { tracks: {}, notes: {} } }, chain: ["A", "B", "C"] });
  ok(patterned.patterns.B.bass && Object.keys(patterned.patterns.B.bass.notes).length === 24 && patterned.patterns.B.bass.notes.G1[1] === true && patterned.patterns.B.bass.ties.G1[1] === true, "a pattern's bass is cleaned over the same 24 rows, ties included");
  ok(patterned.patterns.C.bass === undefined, "a pattern with no bass of its own stays without one");
  ok(JSON.stringify(F.cleanSong(patterned)) === JSON.stringify(patterned), "cleaning a song with a bass line twice changes nothing");
  ok(JSON.stringify(F.BASS_NOTES.slice(0, 3)) === JSON.stringify(["B2", "A#2", "A2"]) && F.BASS_NOTES[23] === "C1", "the bass roll order is B2 down to C1");
  const imported = F.parseImport(F.exportJson("Bassline", patterned));
  ok(imported.data.bass && imported.data.patterns.B.bass.notes.G1[0] === true, "a song file keeps the bass line through export and import");
}

// Pump (the music ducks on each kick) is optional and only written once above 0
{
  const withPump = F.cleanSong({ tracks: {}, melody: { notes: {} }, pump: 60 });
  ok(withPump.pump === 60, "Pump is kept when it is above 0", withPump.pump);
  ok(!("pump" in F.cleanSong({ tracks: {}, melody: { notes: {} } })) && !("pump" in F.cleanSong({ tracks: {}, melody: { notes: {} }, pump: 0 })) && !("pump" in F.cleanSong({ tracks: {}, melody: { notes: {} }, pump: -4 })) && !("pump" in F.cleanSong({ tracks: {}, melody: { notes: {} }, pump: "loud" })), "absent, 0, negative or junk Pump leaves no key (a song without it is stored as before)");
  ok(F.cleanSong({ tracks: {}, melody: { notes: {} }, pump: 900 }).pump === 100 && F.cleanSong({ tracks: {}, melody: { notes: {} }, pump: "35" }).pump === 35, "it is limited to 100, and a number as text counts");
  ok(JSON.stringify(F.cleanSong(withPump)) === JSON.stringify(withPump), "cleaning a song with Pump twice changes nothing");
  ok(F.parseImport(F.exportJson("Pumped", withPump)).data.pump === 60, "a song file keeps Pump through export and import");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
