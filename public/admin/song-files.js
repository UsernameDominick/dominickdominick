// Song files for the song builder: a Standard MIDI File of the loop, and a JSON file that holds a whole song (and reads one back in
// safely). Pure (no DOM), so a node test can load it.
(function () {
  const STEPS = 16;
  const CORE_DRUMS = ["kick", "snare", "hihat", "clap"]; // every song has these rows
  const EXTRA_DRUMS = ["openhat", "rim", "tom", "crash"]; // a song only has these once they were added (see song-builder.js)
  const DRUMS = [...CORE_DRUMS, ...EXTRA_DRUMS];
  const DEFAULT_COLORS = { kick: "#ff7a45", snare: "#ffd166", hihat: "#4ecdc4", clap: "#c9a5ff", openhat: "#7bdff2", rim: "#f4a261", tom: "#e76f51", crash: "#b8e986" };
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const PIANO_NOTES = [];
  [4, 3].forEach((octave) => {
    for (let i = 11; i >= 0; i--) PIANO_NOTES.push(NOTE_NAMES[i] + octave);
  });
  const KITS = ["acoustic", "electronic", "808"];
  const WAVEFORMS = ["sine", "square", "sawtooth", "triangle"];
  const MELODY_VOICES = ["pluck", "lead", "pad", "bass", "bell"]; // the instruments in song-engine.js (a test keeps the two lists equal)
  const VISUALIZATIONS = ["bars", "waveform", "pulse"];
  const THEMES = ["default", "sunset", "ocean", "mono", "neon"];
  const SCALE_TYPES = ["major", "minor", "majpent", "minpent", "blues"];
  const PATTERN_NAMES = ["A", "B", "C", "D"];
  const MAX_CHAIN = 32;
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const FORMAT = "dominick-song";
  const VERSION = 1;
  const MAX_FILE_CHARS = 2000000;

  // ---- MIDI ----

  const PPQ = 480; // ticks per quarter note; a step is a sixteenth
  const STEP_TICKS = PPQ / 4;
  const GM_DRUMS = { kick: 36, snare: 38, hihat: 42, clap: 39, openhat: 46, rim: 37, tom: 47, crash: 49 }; // General MIDI percussion map, played on channel 10

  // "C4" -> 60 (the usual convention where C4 is middle C); null for anything that isn't a note name.
  function noteNumber(name) {
    const m = /^([A-G]#?)(-?\d{1,2})$/.exec(String(name));
    if (!m) return null;
    const n = NOTE_NAMES.indexOf(m[1]) + (Number(m[2]) + 1) * 12;
    return n >= 0 && n <= 127 ? n : null;
  }

  function vlq(value) {
    let v = Math.max(0, Math.floor(value));
    const bytes = [v & 0x7f];
    while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
    return bytes;
  }
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const u16 = (n) => [(n >>> 8) & 255, n & 255];
  // Names in the file are plain ASCII: anything else becomes "?" so no program reads a stray byte as something else.
  const asciiBytes = (text) => Array.from(String(text == null ? "" : text).slice(0, 100)).map((ch) => (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 127 ? ch.charCodeAt(0) : 63));
  function metaText(type, text) {
    const bytes = asciiBytes(text);
    return [0xff, type, ...vlq(bytes.length), ...bytes];
  }
  function chunk(tag, bytes) {
    return [...Array.from(tag).map((c) => c.charCodeAt(0)), ...u32(bytes.length), ...bytes];
  }
  // Events are { tick, order, bytes }: at the same tick a note ends before the next one starts.
  function trackBytes(name, events) {
    const sorted = events.slice().sort((a, b) => a.tick - b.tick || a.order - b.order);
    const out = [0, ...metaText(0x03, name)];
    let last = 0;
    for (const e of sorted) {
      out.push(...vlq(e.tick - last), ...e.bytes);
      last = e.tick;
    }
    out.push(0, 0xff, 0x2f, 0);
    return chunk("MTrk", out);
  }

  // The patterns of a song and the song order, resolved the way song-engine.js does it (song-chain.test.mjs checks they agree): the open
  // pattern (song.editing, default "A") is the song's own tracks and melody notes/ties, the others sit under song.patterns, and the order
  // keeps only patterns that exist (cut to 32), or is just the first pattern the song has.
  function patternParts(song, name) {
    if (!PATTERN_NAMES.includes(name)) return null;
    const editing = PATTERN_NAMES.includes(song.editing) ? song.editing : "A";
    if (name === editing) {
      const melody = isObj(song.melody) ? song.melody : {};
      return { tracks: isObj(song.tracks) ? song.tracks : {}, notes: isObj(melody.notes) ? melody.notes : {}, ties: isObj(melody.ties) ? melody.ties : {} };
    }
    const other = isObj(song.patterns) && Object.prototype.hasOwnProperty.call(song.patterns, name) ? song.patterns[name] : null;
    return isObj(other) ? { tracks: isObj(other.tracks) ? other.tracks : {}, notes: isObj(other.notes) ? other.notes : {}, ties: isObj(other.ties) ? other.ties : {} } : null;
  }
  function chainParts(song) {
    const names = PATTERN_NAMES.filter((n) => patternParts(song, n));
    const wanted = (Array.isArray(song.chain) ? song.chain : []).filter((n) => names.includes(n)).slice(0, MAX_CHAIN);
    return (wanted.length ? wanted : names.slice(0, 1)).map((name) => Object.assign({ name }, patternParts(song, name)));
  }

  const level = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1);
  const volume = (meta) => {
    const v = meta && Number(meta.volume);
    return meta && Number.isFinite(v) && meta.volume !== null && meta.volume !== "" ? Math.max(0, Math.min(1, v)) : 1;
  };
  const velocity = (lvl, vol) => Math.max(1, Math.min(127, Math.round(100 * lvl * vol)));

  // The song as a format-1 MIDI file: a tempo track, the drums on channel 10 (General MIDI drum notes) and the melody on channel 1. A
  // one-pattern song is one loop (16 steps, one bar of 4/4); a song with several patterns writes its whole song order, one bar after
  // another. Muted tracks are left out, a step's strength and a track's volume become velocity, and swing delays every second step the
  // way the player does. Humanize is not written. Returns { bytes, notes } (null bytes if no note).
  function buildMidi(song, name) {
    const data = song || {};
    const tempo = Math.max(40, Math.min(240, Number(data.tempo) || 120));
    const swing = Math.max(0, Math.min(100, Number(data.swing) || 0));
    const delay = (step) => (step % 2 === 1 ? Math.round((swing / 100) * 0.5 * STEP_TICKS) : 0);
    const bars = chainParts(data);
    const tracks = [];
    let notes = 0;

    const drumEvents = [];
    DRUMS.forEach((t) => {
      if (data.trackMeta && data.trackMeta[t] && data.trackMeta[t].muted === true) return;
      const vol = volume(data.trackMeta && data.trackMeta[t]);
      bars.forEach((bar, b) => {
        const lane = bar.tracks[t];
        if (!Array.isArray(lane)) return;
        for (let step = 0; step < STEPS; step++) {
          if (!lane[step]) continue;
          const tick = (b * STEPS + step) * STEP_TICKS + delay(step);
          drumEvents.push({ tick, order: 1, bytes: [0x99, GM_DRUMS[t], velocity(level(lane[step]), vol)] });
          drumEvents.push({ tick: tick + STEP_TICKS / 2, order: 0, bytes: [0x89, GM_DRUMS[t], 0] });
          notes++;
        }
      });
    });
    if (drumEvents.length) tracks.push(trackBytes("Drums", drumEvents));

    const melodyEvents = [];
    if (data.melody && data.melody.muted !== true) {
      const vol = volume(data.melody);
      bars.forEach((bar, b) => {
        for (const noteName of Object.keys(bar.notes)) {
          const num = noteNumber(noteName);
          const lane = bar.notes[noteName];
          if (num === null || !Array.isArray(lane)) continue;
          const ties = bar.ties[noteName];
          // a step tied to the one before it (and the note on at both) carries that note on instead of striking it again
          const tied = (step) => Boolean(step > 0 && ties && ties[step] === true && lane[step] && lane[step - 1]);
          for (let step = 0; step < STEPS; step++) {
            if (!lane[step] || tied(step)) continue;
            let held = 1;
            while (step + held < STEPS && tied(step + held)) held++;
            const tick = (b * STEPS + step) * STEP_TICKS + delay(step);
            melodyEvents.push({ tick, order: 1, bytes: [0x90, num, velocity(level(lane[step]), vol)] });
            melodyEvents.push({ tick: tick + STEP_TICKS * held, order: 0, bytes: [0x80, num, 0] });
            notes++;
          }
        }
      });
    }
    if (melodyEvents.length) tracks.push(trackBytes("Melody", melodyEvents));
    if (!notes) return { bytes: null, notes: 0 };

    const micros = Math.round(60000000 / tempo);
    const conductor = trackBytes(name || "Song", [
      { tick: 0, order: 0, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] }, // 4/4
      { tick: 0, order: 0, bytes: [0xff, 0x51, 3, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255] },
    ]);
    const header = chunk("MThd", [...u16(1), ...u16(tracks.length + 1), ...u16(PPQ)]);
    return { bytes: new Uint8Array([...header, ...conductor, ...tracks.flat()]), notes };
  }

  // ---- reading a MIDI file ----

  const MAX_MIDI_BYTES = 1000000;
  const MAX_MIDI_EVENTS = 200000;
  // General MIDI percussion notes, as the song's drum rows. Anything else (ride, cowbell, congas...) has no sound here and is left out.
  const GM_TO_ROW = { 35: "kick", 36: "kick", 37: "rim", 38: "snare", 40: "snare", 39: "clap", 42: "hihat", 44: "hihat", 46: "openhat", 41: "tom", 43: "tom", 45: "tom", 47: "tom", 48: "tom", 50: "tom", 49: "crash", 52: "crash", 55: "crash", 57: "crash" };

  // Reads a Standard MIDI File (format 0 or 1, ticks per quarter note). Returns { ppq, tempos: [{tick, micros}], timeSig, tracks: [{ name,
  // notes: [{ tick, length, note, vel, channel }] }] } or { error } in plain words. Nothing in the file can make it read past its own
  // end, run for long, or build anything large: sizes and event counts are capped, and a damaged track just ends where it breaks.
  function parseMidi(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
    if (bytes.length < 14) return { error: "That isn't a MIDI file: it is too short." };
    if (bytes.length > MAX_MIDI_BYTES) return { error: "That MIDI file is too big (over 1 MB)." };
    const u16 = (i) => (bytes[i] << 8) | bytes[i + 1];
    const u32 = (i) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    const tag = (i) => String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
    if (tag(0) !== "MThd") return { error: "That isn't a MIDI file: it has no MIDI header." };
    const headLen = u32(4);
    if (headLen < 6 || 8 + headLen > bytes.length) return { error: "That MIDI file's header is damaged." };
    const format = u16(8);
    const ppq = u16(12);
    if (format > 1) return { error: "Only MIDI file formats 0 and 1 can be imported (this one is format 2)." };
    if (ppq & 0x8000) return { error: "This MIDI file uses SMPTE timing, which can't be imported." };
    if (!ppq) return { error: "That MIDI file's header is damaged (no timing)." };
    const tempos = [];
    let timeSig = null;
    const tracks = [];
    let events = 0;
    let at = 8 + headLen;
    while (at + 8 <= bytes.length && tracks.length < 64) {
      const type = tag(at);
      const start = at + 8;
      const end = Math.min(bytes.length, start + u32(at + 4));
      at = start + u32(at + 4);
      if (type !== "MTrk") continue;
      let q = start;
      let tick = 0;
      let status = 0;
      let name = "";
      const open = new Map();
      const notes = [];
      const vlq = () => {
        let v = 0;
        for (let n = 0; n < 4; n++) {
          if (q >= end) return null;
          const b = bytes[q++];
          v = (v << 7) | (b & 0x7f);
          if (!(b & 0x80)) return v;
        }
        return null;
      };
      while (q < end) {
        const delta = vlq();
        if (delta === null) break;
        tick += delta;
        if (++events > MAX_MIDI_EVENTS) return { error: "That MIDI file has too many events to import." };
        if (q >= end) break;
        if (bytes[q] & 0x80) status = bytes[q++];
        else if (!status) break; // a data byte with no status before it: the track is damaged from here
        if (status === 0xff) {
          const metaType = bytes[q++];
          const len = vlq();
          if (len === null || q + len > end) break;
          if (metaType === 0x2f) break;
          if (metaType === 0x51 && len === 3) tempos.push({ tick, micros: (bytes[q] << 16) | (bytes[q + 1] << 8) | bytes[q + 2] });
          else if (metaType === 0x58 && len >= 2 && !timeSig) timeSig = { num: bytes[q], den: 2 ** Math.min(bytes[q + 1], 7) };
          else if (metaType === 0x03) name = Array.from(bytes.subarray(q, q + len)).map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : "")).join("").trim().slice(0, 60);
          q += len;
          status = 0;
          continue;
        }
        if (status === 0xf0 || status === 0xf7) {
          const len = vlq();
          if (len === null) break;
          q += len;
          status = 0;
          continue;
        }
        const kind = status & 0xf0;
        const channel = status & 0x0f;
        const need = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
        if (q + need > end) break;
        const d1 = bytes[q] & 0x7f;
        const d2 = need === 2 ? bytes[q + 1] & 0x7f : 0;
        q += need;
        const key = channel * 128 + d1;
        if (kind === 0x90 && d2 > 0) {
          const held = open.get(key);
          if (held) held.length = tick - held.tick; // struck again before it ended: the first one ends here
          const n = { tick, length: 0, note: d1, vel: d2, channel };
          notes.push(n);
          open.set(key, n);
        } else if (kind === 0x80 || kind === 0x90) {
          const held = open.get(key);
          if (held) {
            held.length = tick - held.tick;
            open.delete(key);
          }
        }
      }
      for (const n of open.values()) n.length = Math.max(0, tick - n.tick); // never ended: held to the end of the track
      tracks.push({ name, notes });
    }
    if (!tracks.length) return { error: "That MIDI file has no tracks in it." };
    return { ppq, tempos, timeSig, tracks };
  }

  const STRONG_VELOCITY = 85;
  const MEDIUM_VELOCITY = 55;
  const strengthOf = (vel) => (vel >= STRONG_VELOCITY ? true : vel >= MEDIUM_VELOCITY ? 0.65 : 0.35);
  const MAX_IMPORT_BARS = 32;

  // Turns a parsed MIDI file into a song: tempo; drums (channel 10) onto the drum rows by General MIDI note; the busiest other part as
  // the melody (folded by octaves into the piano roll, held notes tied); everything snapped to sixteenth notes, one bar of 16 steps each.
  // Identical bars become one pattern, so a repeating file is a few patterns and a song order (up to four different bars, 32 bars). Returns
  // { song, info } (song already cleaned, info.messages in plain words) or { error }.
  function midiToSong(parsed) {
    if (!parsed || !Array.isArray(parsed.tracks)) return { error: "There is nothing to import." };
    const messages = [];
    const stepTicks = parsed.ppq / 4;
    const all = parsed.tracks.flatMap((t, ti) => t.notes.map((n) => Object.assign({ track: ti, trackName: t.name }, n)));
    if (!all.length) return { error: "That MIDI file has no notes in it." };

    // the parts: drums are channel 10, every other (track, channel) pair is a candidate melody
    const drums = all.filter((n) => n.channel === 9);
    const parts = new Map();
    all.filter((n) => n.channel !== 9).forEach((n) => {
      const key = `${n.track}:${n.channel}`;
      if (!parts.has(key)) parts.set(key, { name: n.trackName || `channel ${n.channel + 1}`, notes: [] });
      parts.get(key).notes.push(n);
    });
    const ranked = [...parts.values()].sort((a, b) => b.notes.length - a.notes.length);
    const melody = ranked[0] || null;
    if (ranked.length > 1) messages.push(`The melody is "${melody.name}", the busiest part. ${ranked.length - 1} other part${ranked.length === 2 ? " was" : "s were"} left out.`);

    const barOf = (note) => Math.floor(Math.round(note.tick / stepTicks) / STEPS);
    const used = [...drums, ...(melody ? melody.notes : [])];
    let lastBar = 0;
    let pastEnd = 0;
    used.forEach((n) => { // (a loop, not Math.max(...list): a big file would overflow the call stack)
      if (barOf(n) >= MAX_IMPORT_BARS) pastEnd++;
      else lastBar = Math.max(lastBar, barOf(n));
    });
    if (pastEnd) messages.push(`Notes after bar ${MAX_IMPORT_BARS} (${pastEnd}) were left out.`);
    const barCount = lastBar + 1;
    const makeBar = () => ({ drums: {}, notes: {}, ties: {} });
    const bars = Array.from({ length: barCount }, makeBar);
    let offGrid = 0;
    let skippedDrums = 0;
    let folded = 0;
    let drumHits = 0;
    let melodyNotes = 0;
    const snap = (note) => {
      const exact = note.tick / stepTicks;
      const step = Math.round(exact);
      if (Math.abs(exact - step) > 0.25) offGrid++;
      return step;
    };
    drums.forEach((n) => {
      const row = GM_TO_ROW[n.note];
      if (!row) { skippedDrums++; return; }
      const step = snap(n);
      const bar = bars[Math.floor(step / STEPS)];
      if (!bar) return;
      const lane = bar.drums[row] || (bar.drums[row] = new Array(STEPS).fill(0));
      lane[step % STEPS] = Math.max(lane[step % STEPS], n.vel);
      drumHits++;
    });
    const holds = [];
    // a melody outside the piano roll moves as a whole by octaves (so it keeps its shape): to fit if its span allows, else to centre its
    // middle note; any note still outside folds in
    const pitches = (melody ? melody.notes : []).map((n) => n.note).sort((a, b) => a - b);
    const low = pitches.length ? pitches[0] : 60;
    const high = pitches.length ? pitches[pitches.length - 1] : 60;
    let octaves = 0;
    if (low < 48 || high > 71) {
      const fits = [];
      for (let k = -10; k <= 10; k++) if (low + 12 * k >= 48 && high + 12 * k <= 71) fits.push(k);
      if (fits.length) octaves = fits.sort((a, b) => Math.abs(a) - Math.abs(b))[0];
      else octaves = Math.round((59.5 - pitches[Math.floor(pitches.length / 2)]) / 12);
    }
    (melody ? melody.notes : []).forEach((n) => {
      let note = n.note + octaves * 12;
      if (note < 48 || note > 71) folded++;
      while (note < 48) note += 12;
      while (note > 71) note -= 12;
      const name = NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1);
      const step = snap(n);
      const bar = bars[Math.floor(step / STEPS)];
      if (!bar) return;
      const lane = bar.notes[name] || (bar.notes[name] = new Array(STEPS).fill(0));
      lane[step % STEPS] = Math.max(lane[step % STEPS], n.vel);
      melodyNotes++;
      holds.push({ bar, name, at: step % STEPS, length: Math.max(1, Math.round(n.length / stepTicks)) });
    });
    // a note held for several steps is one note tied across them, up to the end of its bar and never over another note struck there
    holds.forEach(({ bar, name, at, length }) => {
      const lane = bar.notes[name];
      for (let k = 1; k < length && at + k < STEPS; k++) {
        if (lane[at + k]) break;
        lane[at + k] = lane[at];
        (bar.ties[name] || (bar.ties[name] = new Array(STEPS).fill(false)))[at + k] = true;
      }
    });

    // what each bar holds, as the song stores it
    const partOf = (bar) => {
      const part = { tracks: {}, notes: {}, ties: bar.ties };
      Object.keys(bar.drums).forEach((row) => (part.tracks[row] = bar.drums[row].map((v) => (v ? strengthOf(v) : false))));
      Object.keys(bar.notes).forEach((name) => (part.notes[name] = bar.notes[name].map((v) => (v ? strengthOf(v) : false))));
      return part;
    };
    const parts4 = bars.map(partOf);
    const unique = [];
    const barPattern = parts4.map((part) => {
      const key = JSON.stringify(part);
      let i = unique.findIndex((u) => u.key === key);
      if (i < 0) { unique.push({ key, part }); i = unique.length - 1; }
      return i;
    });
    const kept = unique.slice(0, PATTERN_NAMES.length);
    const order = barPattern.filter((i) => i < kept.length);
    const leftOut = barPattern.length - order.length;
    if (unique.length > 1 && unique.length <= PATTERN_NAMES.length) messages.push(`${barCount} bars with ${unique.length} different bars: they became patterns ${PATTERN_NAMES.slice(0, unique.length).join(", ")} and a song order.`);
    else if (unique.length === 1 && barCount > 1) messages.push(`All ${barCount} bars are the same, so the song is that one pattern.`);
    if (unique.length > PATTERN_NAMES.length) messages.push(`This file has ${unique.length} different bars. The first ${PATTERN_NAMES.length} became patterns A to D, and the ${leftOut} bars that are not one of them were left out.`);

    // the song: the first pattern is the song's own parts, the rest go under patterns
    const rowsUsed = new Set(CORE_DRUMS);
    kept.forEach((u) => Object.keys(u.part.tracks).forEach((row) => rowsUsed.add(row)));
    const rows = DRUMS.filter((row) => rowsUsed.has(row));
    const lanes = (part) => Object.fromEntries(rows.map((row) => [row, part.tracks[row] || new Array(STEPS).fill(false)]));
    const first = kept[0].part;
    const song = {
      tempo: 120,
      tracks: lanes(first),
      trackMeta: Object.fromEntries(rows.map((row) => [row, { color: DEFAULT_COLORS[row], note: "" }])),
      melody: { waveform: "sine", notes: first.notes, ties: first.ties },
    };
    if (kept.length > 1) {
      song.patterns = {};
      kept.slice(1).forEach((u, i) => (song.patterns[PATTERN_NAMES[i + 1]] = { tracks: lanes(u.part), notes: u.part.notes, ties: u.part.ties }));
      song.chain = order.slice(0, MAX_CHAIN).map((i) => PATTERN_NAMES[i]);
    }

    // tempo, signature and anything else that did not survive
    const micros = parsed.tempos.length ? parsed.tempos[0].micros : 500000;
    const bpm = micros > 0 ? 60000000 / micros : 120;
    song.tempo = Math.round(Math.max(40, Math.min(240, bpm)));
    if (bpm < 39.5 || bpm > 240.5) messages.push(`The file's tempo (${Math.round(bpm)} BPM) is outside 40 to 240, so it was set to ${song.tempo}.`);
    if (new Set(parsed.tempos.map((t) => t.micros)).size > 1) messages.push("The file changes tempo; only the first tempo was used.");
    if (parsed.timeSig && !(parsed.timeSig.num === 4 && parsed.timeSig.den === 4)) messages.push(`The file is in ${parsed.timeSig.num}/${parsed.timeSig.den}, but songs here are always bars of sixteen steps (4/4), so the bars won't line up with the music.`);
    if (skippedDrums) messages.push(`${skippedDrums} drum note${skippedDrums === 1 ? " has" : "s have"} no matching sound here and ${skippedDrums === 1 ? "was" : "were"} left out.`);
    if (octaves) messages.push(`The melody was moved ${Math.abs(octaves)} octave${Math.abs(octaves) === 1 ? "" : "s"} ${octaves > 0 ? "up" : "down"} to fit the piano roll (C3 to B4).`);
    if (folded) messages.push(`${folded} melody note${folded === 1 ? " was" : "s were"} still outside the piano roll and moved by whole octaves to fit.`);
    const total = drumHits + melodyNotes;
    if (!total) return { error: "None of the notes in that MIDI file can be used here (no General MIDI drums this site has, and no melody)." };
    if (offGrid && offGrid / Math.max(1, total) > 0.1) messages.push(`${offGrid} note${offGrid === 1 ? " was" : "s were"} off the sixteenth-note grid and snapped to the nearest step.`);
    messages.unshift(`Read ${barCount} bar${barCount === 1 ? "" : "s"} at ${song.tempo} BPM: ${drumHits} drum hit${drumHits === 1 ? "" : "s"} and ${melodyNotes} melody note${melodyNotes === 1 ? "" : "s"}.`);
    const cleaned = cleanSong(song);
    return { song: cleaned, info: { bars: barCount, patterns: kept.length, uniqueBars: unique.length, leftOutBars: leftOut, drumHits, melodyNotes, skippedDrums, folded, offGrid, tempo: cleaned.tempo, melodyPart: melody ? melody.name : "", messages } };
  }

  // A MIDI file's bytes straight to a song: { song, info } or { error }.
  function importMidi(bytes) {
    const parsed = parseMidi(bytes);
    return parsed.error ? parsed : midiToSong(parsed);
  }

  // ---- JSON ----

  function cleanText(value, max) {
    return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "").slice(0, max);
  }
  const oneOf = (value, list, fallback) => (list.includes(value) ? value : fallback);
  const clampNum = (value, lo, hi, fallback) => {
    const n = typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : NaN;
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  };
  // A step is off (false), full strength (true) or a strength between 0 and 1; anything else is off.
  function cleanStep(v) {
    if (v === true) return true;
    if (typeof v === "number" && Number.isFinite(v)) return v >= 1 ? true : v > 0 ? Math.max(0.01, Math.round(v * 100) / 100) : false;
    return false;
  }
  // The held notes of one pattern, or null when there are none: a tie only survives where the note is on at that step and the one before.
  function cleanTieMap(rawTies, notes) {
    if (!isObj(rawTies)) return null;
    const ties = {};
    PIANO_NOTES.forEach((n) => {
      const lane = rawTies[n];
      if (!Array.isArray(lane)) return;
      const row = Array.from({ length: STEPS }, (_, i) => lane[i] === true && i > 0 && Boolean(notes[n][i]) && Boolean(notes[n][i - 1]));
      if (row.some(Boolean)) ties[n] = row;
    });
    return Object.keys(ties).length ? ties : null;
  }
  const cleanLane = (lane) => Array.from({ length: STEPS }, (_, i) => cleanStep(Array.isArray(lane) ? lane[i] : false));

  // A clean song from anything a file might hold: only the settings the builder knows, each checked and limited, so a damaged or
  // hand-edited file can't put odd values into the song (or into the public page it is embedded on).
  function cleanSong(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const song = {
      tempo: Math.round(clampNum(src.tempo, 40, 240, 120)),
      kit: oneOf(src.kit, KITS, "acoustic"),
      visualization: oneOf(src.visualization, VISUALIZATIONS, "bars"),
      theme: oneOf(src.theme, THEMES, "default"),
      page_sync: src.page_sync === true,
      master_volume: clampNum(src.master_volume, 0, 1, 1),
      humanize: clampNum(src.humanize, 0, 100, 0),
      swing: clampNum(src.swing, 0, 100, 0),
      space: clampNum(src.space, 0, 100, 0),
      echo: clampNum(src.echo, 0, 100, 0),
      private_notes: cleanText(src.private_notes, 20000),
      tracks: {},
      trackMeta: {},
      melody: { waveform: "sine", notes: {} },
    };
    const meta = src.trackMeta && typeof src.trackMeta === "object" ? src.trackMeta : {};
    const tracks = src.tracks && typeof src.tracks === "object" ? src.tracks : {};
    DRUMS.forEach((t) => {
      if (EXTRA_DRUMS.includes(t) && !Array.isArray(tracks[t])) return; // an extra row the file doesn't have stays absent
      song.tracks[t] = cleanLane(tracks[t]);
      const m = meta[t] && typeof meta[t] === "object" ? meta[t] : {};
      const entry = { color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : DEFAULT_COLORS[t], note: cleanText(m.note, 200) };
      if (m.muted === true) entry.muted = true;
      if (m.hidden === true) entry.hidden = true;
      if (m.volume !== undefined && m.volume !== null && m.volume !== "") entry.volume = clampNum(m.volume, 0, 1, 1);
      song.trackMeta[t] = entry;
    });
    const melody = src.melody && typeof src.melody === "object" ? src.melody : {};
    song.melody.waveform = oneOf(melody.waveform, WAVEFORMS, "sine");
    if (melody.muted === true) song.melody.muted = true;
    if (melody.hidden === true) song.melody.hidden = true;
    if (melody.volume !== undefined && melody.volume !== null && melody.volume !== "") song.melody.volume = clampNum(melody.volume, 0, 1, 1);
    if (MELODY_VOICES.includes(melody.voice)) song.melody.voice = melody.voice;
    const notes = melody.notes && typeof melody.notes === "object" ? melody.notes : {};
    PIANO_NOTES.forEach((n) => (song.melody.notes[n] = cleanLane(notes[n])));
    // Held notes: a tie only counts where the note is on at that step and the one before, so a stale flag can't survive the clean-up.
    const ties = cleanTieMap(melody.ties, song.melody.notes);
    if (ties) song.melody.ties = ties;
    if (src.scale && typeof src.scale === "object" && SCALE_TYPES.includes(src.scale.type) && NOTE_NAMES.includes(src.scale.root)) song.scale = { root: src.scale.root, type: src.scale.type };
    // Patterns: which one is open (A is the default and is not written), the others, and the song order over them. Only the three parts a
    // pattern owns (drum hits, melody notes, held notes) are kept for them, over the rows this song has.
    const open = PATTERN_NAMES.includes(src.editing) ? src.editing : "A";
    if (open !== "A") song.editing = open;
    if (isObj(src.patterns)) {
      const patterns = {};
      PATTERN_NAMES.forEach((n) => {
        const part = n !== open && Object.prototype.hasOwnProperty.call(src.patterns, n) ? src.patterns[n] : null;
        if (!isObj(part)) return;
        const partTracks = isObj(part.tracks) ? part.tracks : {};
        const partNotes = isObj(part.notes) ? part.notes : {};
        const cleaned = { tracks: {}, notes: {} };
        Object.keys(song.tracks).forEach((row) => (cleaned.tracks[row] = cleanLane(partTracks[row])));
        PIANO_NOTES.forEach((note) => (cleaned.notes[note] = cleanLane(partNotes[note])));
        const heldNotes = cleanTieMap(part.ties, cleaned.notes);
        if (heldNotes) cleaned.ties = heldNotes;
        patterns[n] = cleaned;
      });
      if (Object.keys(patterns).length) song.patterns = patterns;
    }
    if (Array.isArray(src.chain)) {
      const exists = new Set([open, ...Object.keys(song.patterns || {})]);
      const chain = src.chain.filter((n) => typeof n === "string" && exists.has(n)).slice(0, MAX_CHAIN);
      if (chain.length) song.chain = chain;
    }
    return song;
  }

  // The text of a song file: a small wrapper so a future version can tell what it is reading.
  function exportJson(name, song) {
    return JSON.stringify({ format: FORMAT, version: VERSION, name: cleanText(name, 200).trim() || "Untitled song", data: song }, null, 2);
  }

  // Read a song file's text. Returns { name, data } (data already cleaned) or { error } in plain words. Accepts the wrapper above or a bare
  // song object (what a song's data looks like inside a site backup).
  function parseImport(text) {
    const source = String(text == null ? "" : text);
    if (!source.trim()) return { error: "That file is empty." };
    if (source.length > MAX_FILE_CHARS) return { error: "That file is too big to be a song (over 2 MB)." };
    let value;
    try {
      value = JSON.parse(source);
    } catch {
      return { error: "That isn't a song file: it isn't valid JSON." };
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "That isn't a song file." };
    let name = "";
    let data = value;
    if (value.format !== undefined || value.data !== undefined) {
      if (value.format !== FORMAT) return { error: "That isn't a song file from this site." };
      if (!Number.isFinite(value.version) || value.version > VERSION) return { error: "That song file was made by a newer version of the builder than this one." };
      name = cleanText(value.name, 200).trim();
      data = value.data;
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || !(data.tracks && typeof data.tracks === "object") && !(data.melody && typeof data.melody === "object")) {
      return { error: "That file has no song in it (no drum tracks or melody)." };
    }
    return { name: name || "Imported song", data: cleanSong(data) };
  }

  window.SongFiles = { parseMidi, midiToSong, importMidi, GM_TO_ROW, PATTERN_NAMES, chainParts, MELODY_VOICES, CORE_DRUMS, EXTRA_DRUMS, GM_DRUMS, buildMidi, noteNumber, exportJson, parseImport, cleanSong, PPQ, STEP_TICKS, FORMAT, VERSION };
})();
