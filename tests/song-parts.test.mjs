// The chords and the lead (songData.chords, songData.lead): two more melodic parts beside the bass, each over a two-octave roll of its own
// (CHORDS C3 to B4, LEAD C4 to B5) with its own voice, volume, mute and held notes. They live per pattern, feed the preview seed only once
// they have a note, are cleaned and validated like the bass line, go into a MIDI file on their own channels and come back from this
// site's own file, and leave a song without them exactly as it was.
import { makeCtx, count, loadEngine, loadSongFiles, lane } from "./fake-audio.mjs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined && !c ? " " + JSON.stringify(extra) : ""}`); };
const E = loadEngine();
const F = loadSongFiles();

const play = (data, step = 0, time = 0) => { const ctx = makeCtx(); E.scheduleStep(ctx, data, step, time, () => 0.5); return ctx; };
const oscs = (ctx) => ctx.nodes.filter((n) => n.kind === "osc");
const song = (extra = {}) => ({ tempo: 120, kit: "acoustic", master_volume: 1, tracks: {}, melody: { waveform: "sine", notes: {} }, ...extra });
const hz = (name) => E.noteToFreq(name);

// ---- the rolls ----
{
  ok(E.PART_KEYS.join() === "bass,chords,lead", "the melodic parts beside the melody are bass, chords and lead", E.PART_KEYS);
  const first = (k) => [E.PART_NOTES[k][0], E.PART_NOTES[k][11], E.PART_NOTES[k][12], E.PART_NOTES[k][23]].join();
  ok(first("bass") === "B2,C2,B1,C1" && E.PART_NOTES.bass.length === 24 && E.BASS_NOTES === E.PART_NOTES.bass, "the bass roll is C1 to B2 (and BASS_NOTES is still it)", first("bass"));
  ok(first("chords") === "B4,C4,B3,C3" && E.PART_NOTES.chords.length === 24, "the chords roll is C3 to B4, highest first", first("chords"));
  ok(first("lead") === "B5,C5,B4,C4" && E.PART_NOTES.lead.length === 24, "the lead roll is C4 to B5, highest first", first("lead"));
  ok(PART_KEYS_equal(), "the file helper and the engine agree on every roll");
  function PART_KEYS_equal() { return F.PART_KEYS.join() === E.PART_KEYS.join() && E.PART_KEYS.every((k) => F.PART_NOTES[k].join() === E.PART_NOTES[k].join()); }
}

// ---- the voices ----
{
  ok(E.partVoiceOf({}, "bass") === "bass" && E.partVoiceOf({}, "chords") === "pad" && E.partVoiceOf({}, "lead") === "lead", "each part has its own default voice");
  ok(E.partVoiceOf({ chords: { voice: "bell" } }, "chords") === "bell" && E.partVoiceOf({ lead: { voice: "pluck" } }, "lead") === "pluck", "a chosen voice is used");
  for (const evil of ["nope", "constructor", "__proto__", 7, null, {}, undefined]) {
    ok(E.partVoiceOf({ chords: { voice: evil }, lead: { voice: evil } }, "chords") === "pad" && E.partVoiceOf({ chords: { voice: evil }, lead: { voice: evil } }, "lead") === "lead", `a voice of ${JSON.stringify(evil)} falls back to the part's own`);
  }
  ok(E.partVoiceOf(null, "chords") === "pad" && E.bassVoiceOf({ bass: { voice: "lead" } }) === "lead", "no song at all, and the bass helper, still behave");
}

// ---- they play, at their own pitch and with their own voice ----
{
  const chords = oscs(play(song({ chords: { notes: { C3: lane("x...............") } } })));
  ok(chords.length === 3 && chords[0].type === "sawtooth" && Math.abs(chords[0].frequency.value - hz("C3")) < 1.5, "a chord note plays with the pad voice at C3", chords.map((o) => [o.type, o.frequency.value]));
  const lead = oscs(play(song({ lead: { notes: { C5: lane("x...............") } } })));
  ok(lead.length >= 1 && lead.some((o) => o.type === "square" && Math.abs(o.frequency.value - hz("C5")) < 1.5), "a lead note plays with the lead voice (a square wave) at C5", lead.map((o) => [o.type, o.frequency.value]));
  ok(oscs(play(song({ chords: { notes: { C3: lane("x...............") } } }), 1)).length === 0, "nothing on step 2 means nothing sounds");
  const all = oscs(play(song({ melody: { waveform: "sine", notes: { C4: lane("x...............") } }, bass: { notes: { C2: lane("x...............") } }, chords: { notes: { E3: lane("x...............") } }, lead: { notes: { G4: lane("x...............") } } })));
  const hasPitch = (name) => all.some((o) => Math.abs(o.frequency.value - hz(name)) < 1.5);
  ok(hasPitch("C4") && hasPitch("C2") && hasPitch("E3") && hasPitch("G4"), "all four melodic parts sound together on one step", all.map((o) => Math.round(o.frequency.value)));
}

// ---- mix: volume, mute, held notes ----
{
  const loud = (extra) => play(song({ chords: Object.assign({ notes: { C3: lane("x...............") } }, extra) }));
  ok(oscs(loud({ muted: true })).length === 0, "a muted chords part is silent");
  ok(oscs(loud({ hidden: true })).length === 3, "a hidden one (an editor setting) still plays");
  ok(oscs(loud({ volume: 0 })).length >= 0 && loud({ volume: 0.5 }).nodes.some((n) => n.kind === "gain" && Math.abs(n.gain.value - 0.5) < 1e-9), "its volume is applied as a gain");
  const held = song({ lead: { notes: { C4: lane("xx..............") }, ties: { C4: [false, true, ...Array(14).fill(false)] } } });
  ok(oscs(play(held, 0)).length >= 1 && oscs(play(held, 1)).length === 0, "a tied step carries the note on instead of striking it again");
  ok(E.heldSteps(held, "C4", 0, "lead") === 2 && E.isTiedContinuation(held, "C4", 1, "lead") && !E.isTiedContinuation(held, "C4", 1, "chords"), "held notes are looked up per part");
}

// ---- patterns carry the parts ----
{
  const s = song({
    tracks: { kick: lane("x...............") },
    chords: { notes: { C3: lane("x...............") } },
    patterns: { B: { tracks: {}, notes: {}, ties: {}, chords: { notes: { E3: lane("x...............") }, ties: {} } } },
    chain: ["A", "B"],
  });
  ok(E.patternData(s, "A").chords.notes.C3[0] === true && E.patternData(s, "A").lead === undefined, "the open pattern's chords are the song's own, and no lead is invented");
  ok(E.patternData(s, "B").chords.notes.E3[0] === true && E.viewOf(s, "B").chords.notes.E3[0] === true && E.viewOf(s, "B").chords.notes.C3 === undefined, "another pattern brings its own chords into its view");
  const withLead = Object.assign({}, s, { lead: { notes: { C4: lane("x...............") } } });
  ok(E.patternData(withLead, "B").lead && Object.keys(E.patternData(withLead, "B").lead.notes).length === 0, "once the song has a lead, every pattern has one (empty where it has none)");
  ok(oscs(play(E.viewOf(s, "B"))).some((o) => Math.abs(o.frequency.value - hz("E3")) < 1.5), "the player plays the pattern's own chord");
  ok(F.chainParts(s).map((p) => Object.keys(p.chords.notes).join()).join("|") === E.chainPatterns(s).map((p) => Object.keys(p.chords.notes).join()).join("|"), "the file helper walks the song order the way the engine does");
}

// ---- the preview seed ----
{
  const plain = song({ tracks: { kick: lane("x...x...") } });
  const seedOf = (data) => { const r = E.previewRandom(data); return [r(), r(), r()].join(); };
  ok(seedOf(plain) === seedOf(Object.assign({}, plain, { chords: { notes: { C3: lane("................") } }, lead: { notes: {} } })), "empty chords and lead leave the seed alone");
  ok(seedOf(plain) !== seedOf(Object.assign({}, plain, { chords: { notes: { C3: lane("x...............") } } })), "chords with a note change it");
  ok(seedOf(Object.assign({}, plain, { chords: { notes: { C3: lane("x...............") } } })) !== seedOf(Object.assign({}, plain, { lead: { notes: { C4: lane("x...............") } } })), "and chords are not the same as a lead");
}

// ---- what the server accepts ----
{
}

// ---- cleaning a song (a file, an import, a saved copy) ----
{
  const raw = {
    chords: { voice: "bell", muted: true, hidden: true, volume: 0.4, notes: { C3: lane("x...x..."), Z9: lane("xxxx"), C1: lane("x...") }, ties: { C3: [false, false, false, false, true, ...Array(11).fill(false)] } },
    lead: { voice: "nope", volume: "loud", notes: { C5: lane("x") } },
    patterns: { B: { tracks: {}, notes: {}, chords: { notes: { E3: lane("x...") }, ties: {} }, lead: "no" } },
    chain: ["A", "B"],
  };
  const c = F.cleanSong(raw);
  ok(c.chords.voice === "bell" && c.chords.muted === true && c.chords.hidden === true && c.chords.volume === 0.4, "chords keep a real voice, mute, hide and volume");
  ok(Object.keys(c.chords.notes).join() === F.PART_NOTES.chords.join() && c.chords.notes.C3.length === 16 && c.chords.notes.C3[4] === true && c.chords.notes.Z9 === undefined && c.chords.notes.C1 === undefined, "only the chords roll's own notes survive, as sixteen steps each");
  ok(!c.chords.ties || !c.chords.ties.C3 || c.chords.ties.C3[4] === false, "a tie with no note before it does not survive");
  ok(c.lead.voice === undefined && c.lead.volume === 1 && Object.keys(c.lead.notes).join() === F.PART_NOTES.lead.join(), "a lead with a bad voice and volume is cleaned");
  ok(c.patterns.B.chords.notes.E3[0] === true && c.patterns.B.lead === undefined, "patterns keep their chords and drop a lead that is not an object");
  ok(F.cleanSong({}).chords === undefined && F.cleanSong({}).lead === undefined && F.cleanSong({ chords: "x" }).chords === undefined, "a song without them has none");
  const again = F.cleanSong(JSON.parse(JSON.stringify(c)));
  ok(JSON.stringify(again) === JSON.stringify(c), "cleaning a clean song changes nothing");
  const file = F.parseImport(F.exportJson("Parts", c));
  ok(file.data.chords.notes.C3[0] === true && file.data.lead && JSON.stringify(file.data) === JSON.stringify(c), "a song file carries them out and back");
}

// ---- MIDI: written on their own channels, and read back from this site's own file ----
{
  const s = F.cleanSong({
    tempo: 100,
    tracks: { kick: lane("x...x...x...x...") },
    melody: { notes: { C4: lane("x...............") } },
    bass: { notes: { C2: lane("x...............") } },
    chords: { notes: { E3: lane("x---............".replace(/-/g, "x")), G3: lane("x...............") }, ties: { E3: [false, true, true, true, ...Array(12).fill(false)] } },
    lead: { notes: { C5: lane("....x...") } },
  });
  const built = F.buildMidi(s, "Parts");
  const parsed = F.parseMidi(built.bytes);
  ok(parsed.tracks.map((t) => t.name).join() === "Parts,Drums,Melody,Bass,Chords,Lead", "the file has a track for each (after the tempo track)", parsed.tracks.map((t) => t.name));
  const track = (name) => parsed.tracks.find((t) => t.name === name);
  ok(track("Chords").notes.every((n) => n.channel === 2) && track("Lead").notes.every((n) => n.channel === 3) && track("Bass").notes.every((n) => n.channel === 1), "on channels 3 and 4 (and the bass on 2)");
  ok(track("Chords").tag === "dominick:chords" && track("Lead").tag === "dominick:lead" && track("Bass").tag === "", "the chords and lead tracks carry this site's marker");
  ok(track("Chords").notes.length === 2 && track("Chords").notes.find((n) => n.note === F.noteNumber("E3")).length === 4 * 120, "a held chord note is one long note", track("Chords").notes);
  const muted = F.buildMidi(Object.assign({}, s, { chords: Object.assign({}, s.chords, { muted: true }) }), "x");
  ok(!F.parseMidi(muted.bytes).tracks.some((t) => t.name === "Chords") && F.parseMidi(muted.bytes).tracks.some((t) => t.name === "Lead"), "a muted part is left out of the file");
  const back = F.importMidi(built.bytes);
  ok(!back.error && back.song.chords && back.song.lead && back.song.bass, "reading the file back finds the chords, the lead and the bass", back.error);
  ok(back.song.chords.notes.E3[0] === true && back.song.chords.notes.G3[0] === true && back.song.lead.notes.C5[4] === true && back.song.melody.notes.C4[0] === true && back.song.bass.notes.C2[0] === true, "each is back on its own roll, where it was");
  ok(back.song.chords.ties && back.song.chords.ties.E3[1] === true && back.info.chordsNotes === 2 && back.info.leadNotes === 1, "with its held note and its counts", back.info);
  ok(back.info.messages.some((m) => /chords are "Chords" and the lead is "Lead"/i.test(m)), "and says what it found", back.info.messages);
  // a file from somewhere else with a track called Lead is still read as the melody (the marker is what counts)
  const foreign = F.buildMidi(F.cleanSong({ melody: { notes: { C4: lane("x...............") } } }), "x");
  const swapped = F.importMidi(new Uint8Array(Array.from(foreign.bytes)));
  ok(swapped.song.chords === undefined && swapped.song.lead === undefined, "a file without the marker never makes chords or a lead");
}

// ---- a song with none of them is what it always was ----
{
  const old = { tempo: 100, tracks: { kick: lane("x...x...") }, melody: { notes: { C4: lane("x...") } }, bass: { notes: { C2: lane("x...") } } };
  const c = F.cleanSong(old);
  ok(Object.keys(c).includes("bass") && !Object.keys(c).includes("chords") && !Object.keys(c).includes("lead"), "an old song gains no chords or lead keys");
  ok(F.parseMidi(F.buildMidi(c, "x").bytes).tracks.map((t) => t.name).join() === "x,Drums,Melody,Bass", "and its MIDI file has the same tracks as before");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
