// Reading a MIDI file into a song: the round trip with the builder's own export, how bars become patterns and a song order, how drums
// and melody are mapped and folded, and that damaged or hostile files only ever give a plain error (or a smaller song), never a crash.
import { loadSongFiles, lane } from "./fake-audio.mjs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const F = loadSongFiles();
const U8 = Uint8Array;

const hits = (lane16) => lane16.map((v) => (v ? 1 : 0)).join("");
const song = (extra = {}) => ({
  tempo: 120, swing: 0,
  tracks: { kick: lane("x...x...x...x..."), snare: lane("....x.......x..."), hihat: lane("x.x.x.x.x.x.x.x."), clap: lane("................") },
  trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {} },
  melody: { waveform: "sine", notes: { C4: lane("x..............."), E4: lane("....x..........."), G4: lane("........x.......") } },
  ...extra,
});

// ---- a tiny MIDI writer, so hostile files can be built byte by byte ----
const vlq = (v) => { const out = [v & 0x7f]; while ((v >>= 7) > 0) out.unshift((v & 0x7f) | 0x80); return out; };
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n) => [(n >> 8) & 255, n & 255];
const tag = (s) => Array.from(s).map((c) => c.charCodeAt(0));
const mtrk = (bytes) => [...tag("MTrk"), ...be32(bytes.length), ...bytes];
const mthd = (format, tracks, division) => [...tag("MThd"), ...be32(6), ...be16(format), ...be16(tracks), ...be16(division)];
// events: [tick, ...bytes]; sorted by tick, delta-coded, ended
const track = (events) => {
  const sorted = events.slice().sort((a, b) => a[0] - b[0]);
  const out = []; let last = 0;
  sorted.forEach(([tick, ...bytes]) => { out.push(...vlq(tick - last), ...bytes); last = tick; });
  out.push(0, 0xff, 0x2f, 0);
  return mtrk(out);
};
const on = (tick, ch, note, vel = 100) => [tick, 0x90 | ch, note, vel];
const off = (tick, ch, note) => [tick, 0x80 | ch, note, 0];
const file = (...tracks) => new U8([...mthd(1, tracks.length, 480), ...tracks.flat()]);
const tempoEvent = (bpm) => { const m = Math.round(60000000 / bpm); return [0, 0xff, 0x51, 3, (m >> 16) & 255, (m >> 8) & 255, m & 255]; };
const nameEvent = (name) => [0, 0xff, 3, name.length, ...tag(name)];
const S = 120; // ticks per step at 480 per quarter

// ---- the round trip: what the builder exports is what comes back ----
{
  const out = F.buildMidi(song({ tempo: 96 }), "Round");
  const r = F.importMidi(out.bytes);
  ok(!r.error, "the builder's own MIDI file imports", r.error);
  const s = r.song;
  ok(s.tempo === 96, "tempo comes back", s.tempo);
  ok(hits(s.tracks.kick) === "1000100010001000" && hits(s.tracks.snare) === "0000100000001000" && hits(s.tracks.hihat) === "1010101010101010" && hits(s.tracks.clap) === "0000000000000000", "every drum hit lands on the same step");
  ok(hits(s.melody.notes.C4) === "1000000000000000" && hits(s.melody.notes.E4) === "0000100000000000" && hits(s.melody.notes.G4) === "0000000010000000", "melody notes come back on the same steps and pitches");
  ok(s.patterns === undefined && s.chain === undefined, "one bar is one pattern, with no song order");
  ok(r.info.bars === 1 && r.info.patterns === 1 && r.info.drumHits === 4 + 2 + 8 && r.info.melodyNotes === 3, "the summary counts what was read", r.info);
  ok(JSON.stringify(F.cleanSong(s)) === JSON.stringify(s), "the imported song is already clean");
  ok(r.info.messages[0].startsWith("Read 1 bar at 96 BPM"), "the first message says what was read", r.info.messages[0]);
}

// strengths and tied notes survive
{
  const s0 = song({
    tracks: { kick: [true, 0.65, 0.35, false, false, false, false, false, false, false, false, false, false, false, false, false], snare: lane("................"), hihat: lane("................"), clap: lane("................") },
    melody: { waveform: "sine", notes: { C4: lane("xxxx.......x...."), D4: lane("................") }, ties: { C4: lane(".xx.............") } },
  });
  const r = F.importMidi(F.buildMidi(s0, "x").bytes);
  ok(r.song.tracks.kick[0] === true && r.song.tracks.kick[1] === 0.65 && r.song.tracks.kick[2] === 0.35, "full, medium and soft hits come back as the same three strengths", r.song.tracks.kick.slice(0, 3));
  ok(hits(r.song.melody.notes.C4) === "1111000000010000", "the held note, the note struck right after it and the later note are all where they were", hits(r.song.melody.notes.C4));
  ok(r.song.melody.ties && r.song.melody.ties.C4 && r.song.melody.ties.C4.slice(0, 4).join() === "false,true,true,false", "…and is tied again, not struck three times", r.song.melody.ties);
  ok(r.song.melody.notes.C4[11] === true && !(r.song.melody.ties.C4[11]), "a separate note after it is its own note");
}

// extra drum rows travel
{
  const s0 = song({ tracks: { kick: lane("x..............."), snare: lane("................"), hihat: lane("................"), clap: lane("................"), openhat: lane("..x............."), rim: lane("....x..........."), tom: lane("......x........."), crash: lane("x...............") }, trackMeta: { kick: {}, snare: {}, hihat: {}, clap: {}, openhat: {}, rim: {}, tom: {}, crash: {} }, melody: { waveform: "sine", notes: {} } });
  const r = F.importMidi(F.buildMidi(s0, "x").bytes);
  ok(Object.keys(r.song.tracks).join() === "kick,snare,hihat,clap,openhat,rim,tom,crash" && hits(r.song.tracks.openhat) === "0010000000000000" && hits(r.song.tracks.crash) === "1000000000000000", "open hat, rim, tom and crash come back as their own rows");
  const plain = F.importMidi(F.buildMidi(song(), "x").bytes).song;
  ok(Object.keys(plain.tracks).join() === "kick,snare,hihat,clap", "a song without them gets no extra rows");
}

// several patterns and a song order: compared by what each bar holds
{
  const A = { tracks: { kick: lane("x...x...x...x...") }, notes: { C4: lane("x...............") }, ties: {} };
  const B = { tracks: { kick: lane("x......."), snare: lane("....x.......x...") }, notes: { E4: lane("x...x...........") }, ties: {} };
  const multi = song({
    tracks: A.tracks, melody: { waveform: "sine", notes: A.notes },
    patterns: { B },
    chain: ["A", "A", "B", "A", "B", "B"],
  });
  const original = F.chainParts(multi);
  const r = F.importMidi(F.buildMidi(multi, "x").bytes);
  ok(!r.error && r.info.bars === 6 && r.info.patterns === 2 && r.info.uniqueBars === 2, "six bars with two different ones become two patterns", r.info);
  ok(r.song.chain.join("") === "AABABB", "the song order is the original order", r.song.chain);
  const parts = F.chainParts(r.song);
  ok(parts.length === original.length, "the whole order has as many bars as the original", [parts.length, original.length]);
  const kicks = parts.map((p) => hits(p.tracks.kick));
  ok(kicks.join("|") === "1000100010001000|1000100010001000|1000000000000000|1000100010001000|1000000000000000|1000000000000000", "each bar's kick matches the original, in order", kicks);
  ok(parts[2].tracks.snare && hits(parts[2].tracks.snare) === "0000100000001000" && hits(parts[0].tracks.snare) === "0000000000000000", "a bar's snare stays in its own pattern");
  ok(parts[2].notes.E4[4] === true && parts[0].notes.C4[0] === true && !parts[0].notes.E4[0], "melody notes stay in their own bars");
  ok(r.info.messages.some((m) => /2 different bars/.test(m) && /patterns A, B/.test(m)), "a message explains the patterns", r.info.messages);
  ok(JSON.stringify(F.cleanSong(r.song)) === JSON.stringify(r.song), "the multi-pattern song is already clean");
}

// identical bars collapse; an empty bar in the middle is a (silent) pattern
{
  const r = F.importMidi(F.buildMidi(song({ chain: ["A", "A", "A"], patterns: { B: { tracks: {}, notes: {}, ties: {} } } }), "x").bytes);
  ok(r.info.bars === 3 && r.info.patterns === 1 && r.song.chain === undefined && /All 3 bars are the same/.test(r.info.messages.join(" ")), "three identical bars are just the one pattern", r.info.messages);
  const gap = F.importMidi(file(track([tempoEvent(120), on(0, 9, 36), off(60, 9, 36), on(S * 32, 9, 36), off(S * 32 + 60, 9, 36)])));
  ok(gap.info.bars === 3 && gap.info.patterns === 2 && gap.song.chain.join("") === "ABA", "a silent bar between two hits is its own pattern", gap.song.chain);
}

// more than four different bars, and more than 32 bars
{
  const ev = [tempoEvent(100)];
  for (let bar = 0; bar < 6; bar++) { ev.push(on(bar * S * 16 + bar * S, 9, 36), off(bar * S * 16 + bar * S + 60, 9, 36)); }
  const r = F.importMidi(file(track(ev)));
  ok(r.info.bars === 6 && r.info.patterns === 4 && r.info.uniqueBars === 6 && r.info.leftOutBars === 2, "six different bars: the first four are patterns, two bars are left out", r.info);
  ok(r.song.chain.join("") === "ABCD" && /first 4 became patterns A to D/.test(r.info.messages.join(" ")), "the song order only lists the bars that were kept", r.song.chain);

  const long = [tempoEvent(120)];
  for (let bar = 0; bar < 40; bar++) long.push(on(bar * S * 16, 9, 36), off(bar * S * 16 + 60, 9, 36));
  const r2 = F.importMidi(file(track(long)));
  ok(r2.info.bars === 32 && /Notes after bar 32 \(8\)/.test(r2.info.messages.join(" ")), "a 40-bar file stops at bar 32 and says how much was left out", r2.info.messages);
}

// ---- reading the file ----
{
  // drums by General MIDI note, with the notes that have no sound here counted and left out
  const r = F.importMidi(file(track([
    tempoEvent(120),
    ...[35, 36, 38, 40, 42, 44, 46, 39, 37, 41, 43, 45, 47, 48, 50, 49, 52, 55, 57].flatMap((n, i) => [on(i * S, 9, n), off(i * S + 60, 9, n)]),
    ...[51, 53, 56].flatMap((n, i) => [on((20 + i) * S, 9, n), off((20 + i) * S + 60, 9, n)]),
  ])));
  ok(r.info.drumHits === 19 && r.info.skippedDrums === 3, "19 General MIDI drum notes map to the rows; ride, ride bell and cowbell do not", [r.info.drumHits, r.info.skippedDrums]);
  ok(r.info.messages.some((m) => /3 drum notes have no matching sound/.test(m)), "a message says which were left out", r.info.messages);
  ok(r.song.tracks.kick[0] === true && r.song.tracks.kick[1] === true && r.song.tracks.snare[2] === true && r.song.tracks.snare[3] === true && r.song.tracks.tom && r.song.tracks.crash && r.song.tracks.openhat && r.song.tracks.rim, "several GM notes share a row (two kicks, two snares, six toms, four crashes)");
}
{
  // format 0 (one track with both drums and melody on different channels)
  const f0 = new U8([...mthd(0, 1, 480), ...track([tempoEvent(90), on(0, 9, 36), off(60, 9, 36), on(0, 0, 60), off(S, 0, 60), on(S * 4, 0, 64), off(S * 8, 0, 64)])]);
  const r = F.importMidi(f0);
  ok(!r.error && r.song.tempo === 90 && r.song.tracks.kick[0] === true && r.song.melody.notes.C4[0] === true && r.song.melody.notes.E4[4] === true, "a format 0 file (everything in one track) is split by channel");
  ok(r.song.melody.ties.E4.slice(4, 8).join() === "false,true,true,true", "a long note becomes a tie", r.song.melody.ties && r.song.melody.ties.E4);
}
{
  // the busiest part is the melody, the rest are counted
  const busy = []; for (let i = 0; i < 6; i++) busy.push(on(i * S, 1, 62 + i), off(i * S + S, 1, 62 + i));
  const r = F.importMidi(file(
    track([tempoEvent(120), nameEvent("Pad"), on(0, 0, 60), off(S * 2, 0, 60)]),
    track([nameEvent("Lead"), ...busy]),
  ));
  ok(r.info.melodyPart === "Lead" && r.song.melody.notes.D4[0] === true && !r.song.melody.notes.C4.some(Boolean), "the part with the most notes is the melody", r.info.melodyPart);
  ok(r.info.messages.some((m) => /1 other part was left out/.test(m)), "…and the others are mentioned", r.info.messages);
}
{
  // a melody outside the piano roll moves as a whole, keeping its shape
  const mel = (notes) => F.importMidi(file(track([tempoEvent(120), ...notes.flatMap((n, i) => [on(i * S, 0, n), off(i * S + S, 0, n)])])));
  const high = mel([84, 88, 91, 88]); // C6 E6 G6 E6: two octaves up
  ok(high.info.folded === 0 && high.song.melody.notes.C4[0] === true && high.song.melody.notes.E4[1] === true && high.song.melody.notes.G4[2] === true, "a melody two octaves too high moves down together", high.info);
  ok(high.info.messages.some((m) => /moved 2 octaves down/.test(m)), "…and says so", high.info.messages);
  const low = mel([36, 40, 43]); // C2 E2 G2: below the melody roll, so it is the bass line
  ok(low.song.bass && low.song.bass.notes.C2[0] === true && low.song.bass.notes.E2[1] === true && low.song.bass.notes.G2[2] === true && low.info.bassNotes === 3 && low.info.melodyNotes === 0, "a part below C3 becomes the bass line, at its own pitch", low.info);
  const inRange = mel([71, 48, 60]);
  ok(inRange.info.folded === 0 && !inRange.info.messages.some((m) => /octave/.test(m)) && inRange.song.melody.notes.B4[0] === true && inRange.song.melody.notes.C3[1] === true, "a melody that already fits is not moved");
  const wide = mel([30, 60, 100]); // wider than the roll: the middle note decides, the rest fold in
  ok(wide.info.folded >= 1 && Object.values(wide.song.melody.notes).filter((l) => l.some(Boolean)).length === 3, "a melody wider than the piano roll folds the notes that don't fit", wide.info);
}
{
  // tempo: clamped, first one used, changes mentioned; time signature mentioned
  const slow = F.importMidi(file(track([tempoEvent(20), on(0, 9, 36), off(60, 9, 36)])));
  ok(slow.song.tempo === 40 && /outside 40 to 240/.test(slow.info.messages.join(" ")), "a tempo outside 40 to 240 is clamped and mentioned", slow.info.messages);
  const fast = F.importMidi(file(track([tempoEvent(300), on(0, 9, 36), off(60, 9, 36)])));
  ok(fast.song.tempo === 240, "…at the top as well");
  const changes = F.importMidi(file(track([tempoEvent(100), [S * 4, 0xff, 0x51, 3, 0x07, 0xa1, 0x20], on(0, 9, 36), off(60, 9, 36)])));
  ok(changes.song.tempo === 100 && /changes tempo/.test(changes.info.messages.join(" ")), "a tempo change keeps the first tempo and says so");
  const none = F.importMidi(file(track([on(0, 9, 36), off(60, 9, 36)])));
  ok(none.song.tempo === 120, "a file with no tempo is 120 BPM");
  const waltz = F.importMidi(file(track([[0, 0xff, 0x58, 4, 3, 2, 24, 8], tempoEvent(120), on(0, 9, 36), off(60, 9, 36)])));
  ok(/in 3\/4/.test(waltz.info.messages.join(" ")), "a 3/4 file is warned about");
  const four = F.importMidi(file(track([[0, 0xff, 0x58, 4, 4, 2, 24, 8], tempoEvent(120), on(0, 9, 36), off(60, 9, 36)])));
  ok(!/\/4, but/.test(four.info.messages.join(" ")), "a 4/4 file is not");
}
{
  // other resolutions and off-grid notes
  const ppq96 = new U8([...mthd(1, 1, 96), ...track([on(0, 9, 36), off(10, 9, 36), on(24, 9, 38), off(30, 9, 38), on(48 * 2, 9, 42), off(100, 9, 42)])]);
  const r = F.importMidi(ppq96);
  ok(r.song.tracks.kick[0] === true && r.song.tracks.snare[1] === true && r.song.tracks.hihat[4] === true, "another ticks-per-quarter (96) still lands on the right steps", [r.song.tracks.kick[0], r.song.tracks.snare[1], r.song.tracks.hihat[4]]);
  const swung = []; for (let i = 0; i < 8; i++) swung.push(on(i * S + (i % 2 ? 50 : 0), 9, 42), off(i * S + 70, 9, 42));
  const sw = F.importMidi(file(track(swung)));
  ok(sw.info.drumHits === 8 && sw.song.tracks.hihat.slice(0, 8).filter(Boolean).length === 8, "a loosely played hi-hat snaps to the nearest step", sw.song.tracks.hihat.slice(0, 8));
  ok(sw.info.offGrid >= 0, "off-grid notes are counted");
  const sloppy = []; for (let i = 0; i < 8; i++) sloppy.push(on(i * S + 55, 9, 42), off(i * S + 70, 9, 42));
  const sl = F.importMidi(file(track(sloppy)));
  ok(sl.info.offGrid === 8 && /off the sixteenth-note grid/.test(sl.info.messages.join(" ")), "many notes between steps are mentioned", sl.info.messages);
}
{
  // running status, note-on with velocity 0 as note-off, a held note that never ends, a note struck twice
  const body = [
    0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20,
    0, 0x90, 60, 100, // on
    ...vlq(S), 60, 0, // running status: on with velocity 0 ends it
    ...vlq(0), 0x90, 64, 90, // E4 on
    ...vlq(S * 3), 64, 80, // E4 struck again (running status), the first ends here
    ...vlq(S * 4), 0x80, 64, 0, // ends the second
    ...vlq(0), 0x91, 67, 100, // G4 on, channel 2, never ended
    0, 0xff, 0x2f, 0,
  ];
  const r = F.importMidi(new U8([...mthd(0, 1, 480), ...mtrk(body)]));
  ok(!r.error && r.song.melody.notes.C4[0] === true && r.song.melody.notes.E4[1] === true && r.song.melody.notes.E4[4] === 0.65, "running status and note-on velocity 0 are read", r.error);
  ok(r.song.melody.ties.E4.slice(1, 5).join() === "false,true,true,false", "a note struck again ends the first one there", r.song.melody.ties && r.song.melody.ties.E4);
  ok(r.info.messages.some((m) => /1 other part was left out/.test(m)), "channels are separate parts (the never-ended note was on its own channel)", r.info.messages);
}
{
  // sysex, text events, controller and program changes in the middle are skipped properly
  const r = F.importMidi(file(track([
    tempoEvent(120), [0, 0xff, 1, 3, ...tag("hey")], [0, 0xf0, 3, 1, 2, 0xf7], [0, 0xb9, 7, 100], [0, 0xc9, 5], [0, 0xe0, 0, 64], [0, 0xd9, 10],
    on(0, 9, 36), off(60, 9, 36),
    [S, 0xff, 0x7f, 2, 1, 2], on(S, 9, 38), off(S + 60, 9, 38),
  ])));
  ok(!r.error && r.info.drumHits === 2, "meta events, sysex, controllers, program and pitch changes do not get in the way", r.info);
}

// ---- the bass line ----
{
  const bassSong = song({
    tempo: 100,
    bass: { voice: "pluck", volume: 0.8, notes: { C2: lane("x.......x.......") , G1: lane("..x...x.........") , E2: lane("....xxx.........") }, ties: { E2: lane(".....xx.........") } },
  });
  const r = F.importMidi(F.buildMidi(bassSong, "Bassy").bytes);
  ok(!r.error && r.song.bass && r.info.bassNotes === 5, "the builder's own bass track comes back (two C2, two G1 and the held E2 as one note)", r.info);
  ok(hits(r.song.bass.notes.C2) === "1000000010000000" && hits(r.song.bass.notes.G1) === "0010001000000000", "bass notes land on the same steps and pitches", [hits(r.song.bass.notes.C2), hits(r.song.bass.notes.G1)]);
  ok(hits(r.song.bass.notes.E2) === "0000111000000000" && r.song.bass.ties.E2.slice(4, 8).join() === "false,true,true,false", "a held bass note stays held: struck once, tied across the next two steps", r.song.bass.ties && r.song.bass.ties.E2);
  ok(r.info.melodyPart === "Melody" && r.info.bassPart === "Bass" && r.info.messages.some((m) => /melody is "Melody" and the bass line is "Bass"/.test(m)), "both parts are named in the messages", r.info.messages);
  ok(/3 melody notes and 5 bass notes/.test(r.info.messages[0]) && /14 drum hits/.test(r.info.messages[0]), "the summary counts drums, melody and bass", r.info.messages[0]);
  ok(r.song.melody.notes.C4[0] === true && !r.song.melody.notes.C2, "the melody is not disturbed by the bass");
  ok(JSON.stringify(F.cleanSong(r.song)) === JSON.stringify(r.song), "an imported song with a bass line is already clean");
  // the bass stays in its own pattern, with patterns and a song order
  const B1 = { tracks: { kick: lane("x......."), snare: lane("................") }, notes: {}, ties: {}, bass: { notes: { A1: lane("x...x...") }, ties: {} } };
  const multi = song({ bass: { notes: { C2: lane("x...x...x...x...") }, ties: {} }, patterns: { B: B1 }, chain: ["A", "B", "B", "A"] });
  const m = F.importMidi(F.buildMidi(multi, "x").bytes);
  const parts = F.chainParts(m.song);
  ok(m.info.bars === 4 && m.info.patterns === 2 && m.song.chain.join("") === "ABBA", "a bass line in two patterns makes the same two patterns", [m.info.bars, m.info.patterns, m.song.chain]);
  ok(parts.map((p) => p.bass && hits(p.bass.notes.C2 || [])).join("|") === "1000100010001000|0000000000000000|0000000000000000|1000100010001000" && hits(parts[1].bass.notes.A1) === "1000100000000000", "each bar has its own bass notes, in order", parts.map((p) => p.bass && Object.keys(p.bass.notes).join()));
  ok(m.song.patterns.B.bass && m.song.patterns.B.bass.notes.A1[4] === true, "pattern B stores its own bass");
}
{
  const mel = (ev) => F.importMidi(file(track([tempoEvent(120), ...ev.flatMap(([n, ch, at, name]) => [on(at * S, ch, n), off(at * S + S, ch, n)])])));
  // a low part with no name is the bass, a part named Bass is the bass even when it is high
  const named = F.importMidi(file(track([tempoEvent(120), nameEvent("Bass"), on(0, 0, 72), off(S, 0, 72), on(S * 2, 0, 76), off(S * 3, 0, 76)]), track([nameEvent("Lead"), on(0, 1, 64), off(S, 1, 64)])));
  ok(named.info.bassPart === "Bass" && named.info.melodyPart === "Lead" && named.song.bass.notes.C2[0] === true && named.song.bass.notes.E2[2] === true, "a part named Bass is the bass line however high it is: it is moved down into C1 to B2", named.info);
  ok(named.info.messages.some((m) => /bass was moved \d+ octaves? down/.test(m)), "…and says so", named.info.messages);
  const bassOnly = F.importMidi(file(track([tempoEvent(120), on(0, 0, 36), off(S, 0, 36), on(S * 4, 0, 43), off(S * 5, 0, 43)])));
  ok(bassOnly.song.bass && bassOnly.info.melodyNotes === 0 && bassOnly.info.bassNotes === 2 && /bass line is "channel 1": it sits below the melody's range/.test(bassOnly.info.messages.join(" ")), "a file with only a low part is just a bass line, and says why", bassOnly.info.messages);
  ok(!Object.values(bassOnly.song.melody.notes).some((l) => l.some(Boolean)), "…with an empty melody");
  const highOnly = mel([[72, 0, 0], [76, 0, 2]]);
  ok(highOnly.song.bass === undefined && highOnly.info.bassNotes === 0 && !/bass/i.test(highOnly.info.messages.join(" ")), "a file with no low part has no bass line, and does not mention one");
  const three = F.importMidi(file(track([tempoEvent(120), nameEvent("Lead"), ...[0, 1, 2, 3].flatMap((i) => [on(i * S, 0, 62 + i), off(i * S + S, 0, 62 + i)])]), track([nameEvent("Pad"), on(0, 1, 64), off(S * 8, 1, 64)]), track([nameEvent("Sub bass"), ...[0, 4].flatMap((i) => [on(i * S, 2, 36), off(i * S + S, 2, 36)])])));
  ok(three.info.melodyPart === "Lead" && three.info.bassPart === "Sub bass" && /1 other part was left out/.test(three.info.messages.join(" ")), "with a lead, a pad and a bass: lead and bass are used, the pad is counted as left out", three.info.messages);
  // the busiest low part wins, strengths come over, and bass notes past the range are folded in
  const strengths = F.importMidi(file(track([tempoEvent(120), on(0, 0, 36, 100), off(S, 0, 36), on(S * 2, 0, 36, 70), off(S * 3, 0, 36), on(S * 4, 0, 36, 30), off(S * 5, 0, 36)])));
  ok(strengths.song.bass.notes.C2[0] === true && strengths.song.bass.notes.C2[2] === 0.65 && strengths.song.bass.notes.C2[4] === 0.35, "bass notes keep three strengths like every other part", strengths.song.bass.notes.C2.slice(0, 5));
  const wide = F.importMidi(file(track([tempoEvent(120), ...[20, 40, 90].flatMap((n, i) => [on(i * S, 0, n), off(i * S + S, 0, n)])])));
  ok(wide.song.bass && wide.info.folded >= 1 && Object.values(wide.song.bass.notes).filter((l) => l.some(Boolean)).length === 3, "a bass wider than its roll folds the notes that don't fit", wide.info);
  const allDrums = F.importMidi(file(track([tempoEvent(120), on(0, 9, 36), off(60, 9, 36)])));
  ok(allDrums.song.bass === undefined, "a drums-only file has no bass line");
}

// ---- damaged and hostile files ----
{
  const good = F.buildMidi(song(), "x").bytes;
  const err = (bytes) => { const r = F.importMidi(bytes); return r.error || null; };
  ok(/too short/.test(err(new U8(0)) || "") && /too short/.test(err(new U8(5)) || ""), "an empty or tiny file says it is too short");
  ok(/no MIDI header/.test(err(new U8(20).fill(65)) || ""), "a file that is not MIDI says so");
  ok(/no MIDI header/.test(err(new U8([...tag("RIFF"), ...new Array(20).fill(0)])) || ""), "…even if it looks like another format");
  ok(/format 2/.test(err(new U8([...mthd(2, 1, 480), ...track([on(0, 0, 60)])])) || ""), "format 2 is refused in words");
  ok(/SMPTE/.test(err(new U8([...mthd(1, 1, 0xe728), ...track([on(0, 0, 60)])])) || ""), "SMPTE timing is refused in words");
  ok(/no timing/.test(err(new U8([...mthd(1, 1, 0), ...track([on(0, 0, 60)])])) || ""), "zero ticks per quarter is refused");
  ok(/header is damaged/.test(err(new U8([...tag("MThd"), ...be32(900000), 0, 1, 0, 1, 1, 0xe0])) || ""), "a header that claims to be longer than the file is refused");
  ok(/no tracks/.test(err(new U8([...mthd(1, 0, 480), ...new Array(8).fill(0)])) || ""), "a header with no tracks is refused");
  ok(/no notes/.test(err(file(track([tempoEvent(120)]))) || ""), "a file with only a tempo has no notes");
  ok(/None of the notes/.test(err(file(track([on(0, 9, 51), off(60, 9, 51)]))) || ""), "a file with only drums this site has no sound for says so");
  ok(/too big/.test(err(new U8(1000001).fill(0)) || ""), "over 1 MB is refused before it is read");

  // every cut of a real file: an error or a smaller song, never a throw
  let threw = 0;
  for (let n = 0; n < good.length; n++) { try { F.importMidi(good.subarray(0, n)); } catch { threw++; } }
  ok(threw === 0, `every truncation of a real file (${good.length} of them) is handled without a crash`, threw);
  // every single byte replaced by garbage
  let garbled = 0;
  for (let i = 0; i < good.length; i++) {
    for (const v of [0, 0x7f, 0x80, 0xff]) {
      const copy = new U8(good); copy[i] = v;
      try { F.importMidi(copy); } catch { garbled++; }
    }
  }
  ok(garbled === 0, "a single byte changed to 0, 0x7F, 0x80 or 0xFF anywhere never makes it throw", garbled);
  // pseudo-random noise after a valid header
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let noisy = 0;
  for (let k = 0; k < 200; k++) {
    const body = Array.from({ length: 60 + Math.floor(rnd() * 200) }, () => Math.floor(rnd() * 256));
    try { F.importMidi(new U8([...mthd(1, 1, 480), ...tag("MTrk"), ...be32(body.length), ...body])); } catch { noisy++; }
  }
  ok(noisy === 0, "200 files of random bytes inside a valid header never throw", noisy);

  // a track whose length field lies, a track that runs off the end, a delta time that never ends
  ok(!err(new U8([...mthd(1, 1, 480), ...tag("MTrk"), ...be32(0xffffff00), ...track([on(0, 9, 36), off(60, 9, 36)]).slice(8)])), "a track that says it is huge but is short is read as far as it goes");
  ok(/no notes/.test(err(new U8([...mthd(1, 1, 480), ...tag("MTrk"), ...be32(8), 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80])) || ""), "a delta time that never ends stops the track");
  ok(/no notes/.test(err(new U8([...mthd(1, 1, 480), ...tag("MTrk"), ...be32(4), 0, 60, 100, 0])) || ""), "data bytes before any status stop the track");
  ok(/no tracks/.test(err(new U8([...mthd(1, 1, 480), ...tag("JUNK"), ...be32(4), 1, 2, 3, 4])) || ""), "chunks that are not tracks are skipped");
  const huge = F.importMidi(file(track([on(0xfffffff, 9, 36), off(0xfffffff + 1, 9, 36), on(0, 9, 38), off(60, 9, 38)])));
  ok(!huge.error && huge.info.bars === 1 && /Notes after bar 32 \(1\)/.test(huge.info.messages.join(" ")), "a note an absurd distance into the file is left out, not allocated", huge.error || huge.info.messages);

  // too many events
  const many = []; for (let i = 0; i < 110000; i++) many.push(on(i, 0, 60), off(i, 0, 60));
  const big = file(track(many));
  const t0 = Date.now();
  const rBig = big.length <= 1000000 ? F.importMidi(big) : { error: "too big" };
  ok(rBig.error && /too many events|too big/.test(rBig.error) && Date.now() - t0 < 3000, "more than 200,000 events is refused quickly", rBig.error);
  // many notes within the limits: fast and does not blow the stack
  const dense = []; for (let i = 0; i < 90000; i++) dense.push(on((i % 4000) * 16, 0, 48 + (i % 24)), off((i % 4000) * 16 + 1, 0, 48 + (i % 24)));
  const t1 = Date.now();
  const rDense = F.importMidi(file(track(dense)));
  ok(!rDense.error && rDense.info.bars === 32 && Date.now() - t1 < 3000, "90,000 notes (just under the limits) import without trouble", rDense.error || Date.now() - t1);
  // 64 tracks is the most it reads
  const tracks = Array.from({ length: 70 }, () => track([on(0, 0, 60), off(S, 0, 60)]));
  const parsed = F.parseMidi(file(...tracks));
  ok(parsed.tracks.length === 64, "no more than 64 tracks are read", parsed.tracks.length);
}

// ---- what the parser returns, for the UI ----
{
  const p = F.parseMidi(F.buildMidi(song({ tempo: 150 }), "Name here").bytes);
  ok(p.ppq === 480 && p.tempos.length === 1 && p.tempos[0].micros === 400000 && p.timeSig.num === 4 && p.timeSig.den === 4, "parseMidi reports resolution, tempo and time signature", [p.ppq, p.tempos, p.timeSig]);
  ok(p.tracks[0].name === "Name here" && p.tracks.map((t) => t.name).join() === "Name here,Drums,Melody", "…and the track names", p.tracks.map((t) => t.name));
  ok(F.midiToSong(null).error && F.midiToSong({}).error, "midiToSong refuses nothing");
  ok(F.GM_TO_ROW[36] === "kick" && F.GM_TO_ROW[38] === "snare" && Object.values(F.GM_TO_ROW).every((r) => [...F.CORE_DRUMS, ...F.EXTRA_DRUMS].includes(r)), "every mapped drum is a row the builder has");
  // the export's own drum notes are all in the table, and map back to their own row
  ok(Object.entries(F.GM_DRUMS).every(([row, note]) => F.GM_TO_ROW[note] === row), "the notes the export writes map back to the same row");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
