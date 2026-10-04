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

  window.SongFiles = { PATTERN_NAMES, chainParts, MELODY_VOICES, CORE_DRUMS, EXTRA_DRUMS, GM_DRUMS, buildMidi, noteNumber, exportJson, parseImport, cleanSong, PPQ, STEP_TICKS, FORMAT, VERSION };
})();
