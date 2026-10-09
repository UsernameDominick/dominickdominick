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
  // The melodic parts besides the melody, each with a two-octave roll of its own, highest note first (a test keeps these equal to the engine's).
  const PART_KEYS = ["bass", "chords", "lead"];
  const PART_OCTAVES = { bass: [1, 2], chords: [3, 4], lead: [4, 5] };
  const PART_NOTES = {};
  PART_KEYS.forEach((key) => {
    PART_NOTES[key] = [];
    for (let octave = PART_OCTAVES[key][1]; octave >= PART_OCTAVES[key][0]; octave--) {
      for (let i = 11; i >= 0; i--) PART_NOTES[key].push(NOTE_NAMES[i] + octave);
    }
  });
  const BASS_NOTES = PART_NOTES.bass;
  const KITS = ["acoustic", "electronic", "808", "909", "house", "techno", "trap", "boombap", "lofi", "rock", "jazz", "dnb", "chip", "industrial", "soft"]; // the kits in song-engine.js (a test keeps the lists equal)
  const WAVEFORMS = ["sine", "square", "sawtooth", "triangle"];
  const MELODY_VOICES = ["pluck", "lead", "pad", "bass", "bell", "epiano", "fmkeys", "piano", "clav", "organ", "musicbox", "harp", "guitar", "kalimba", "marimba", "pizz", "stab", "subbass", "reese", "acid", "wobble", "finger", "pluckbass", "chipbass", "supersaw", "squarelead", "chip", "brass", "strings", "flute", "vox", "laser", "warmpad", "glasspad", "stringpad", "darkpad", "swell", "wind", "chime", "vibes", "glassbell"]; // the instruments in song-engine.js (a test keeps the two lists equal)
  const SCALE_TYPES = ["major", "minor", "majpent", "minpent", "blues"];
  const PATTERN_NAMES = "ABCDEFGHIJKLMNOP".split("");
  const MAX_BARS = 64;
  const MAX_CHAIN = MAX_BARS;
  const LANE_KEYS = ["drums", "bass", "chords", "melody", "lead"];
  // A track's own sound tweaks, kept in step with SongEngine.cleanSynth (the ranges are the engine's).
  const SYNTH_WAVES = ["sine", "square", "sawtooth", "triangle"];
  const SYNTH_FILTERS = ["lowpass", "highpass", "bandpass"];
  const SYNTH_RANGES = {
    attack: [0.001, 2], decay: [0.02, 3], sustain: [0, 1], release: [0, 3], cutoff: [120, 12000], detune: [0, 40], vibrato: [0, 60],
    res: [0.1, 18], vrate: [0.5, 12], sub: [0, 1], noise: [0, 1], drive: [0, 1], tremolo: [0, 1], trate: [0.5, 14], fm: [0, 1], fmratio: [0.5, 8],
    sweep: [-1, 1], unison: [1, 7],
  };
  const DRUM_RANGES = { tune: [-12, 12], decay: [0.3, 3], tone: [-1, 1] }; // one drum sound's own tweaks, as in SongEngine.drumShape
  function cleanSynth(raw) {
    if (!isObj(raw)) return null;
    const out = {};
    if (SYNTH_WAVES.includes(raw.wave)) out.wave = raw.wave;
    if (SYNTH_FILTERS.includes(raw.ftype)) out.ftype = raw.ftype;
    Object.keys(SYNTH_RANGES).forEach((key) => {
      const n = Number(raw[key]);
      if (raw[key] === undefined || raw[key] === null || raw[key] === "" || !Number.isFinite(n)) return;
      const clamped = Math.max(SYNTH_RANGES[key][0], Math.min(SYNTH_RANGES[key][1], n));
      out[key] = key === "unison" ? Math.round(clamped) : Number(clamped.toPrecision(4)); // four significant figures: a 3 ms attack keeps its detail
    });
    return Object.keys(out).length ? out : null;
  }
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const FORMAT = "dominick-song";
  const VERSION = 1; // the version of the song FILE wrapper (exportJson / parseImport), not of the song inside it
  // The version of a song's own data. cleanSong writes it, so a song saved by this build says which format it is, and migrateSong is the one
  // place that brings a song saved by an earlier build (no version, or a lower one) up to date before it is cleaned. 1 = songs from before
  // the version existed (the player-look fields and the cached peaks are ignored, not migrated); 2 = this format. Change SONG_VERSION when a
  // later change to the song format needs old songs reshaped, and add that step to migrateSong.
  const SONG_VERSION = 2;
  const MAX_FILE_CHARS = 2000000;

  // ---- MIDI ----

  const PPQ = 480; // ticks per quarter note; a step is a sixteenth
  const STEP_TICKS = PPQ / 4;
  // Each extra part is written to its own channel (the melody is channel 1) with a General MIDI program, zero-based, so a music program
  // plays it as a bass, a pad or a lead. A part's track also carries a marker (an instrument-name event) so this site can tell it from
  // other files' tracks when the file is read back in.
  const PART_MIDI = { bass: { channel: 1, program: 33, track: "Bass" }, chords: { channel: 2, program: 89, track: "Chords" }, lead: { channel: 3, program: 80, track: "Lead" } };
  const PART_TAG = { chords: "dominick:chords", lead: "dominick:lead" };
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
  // pattern (song.editing, default "A") is the song's own tracks and melody notes/ties (and bass, chords and lead), the others sit under song.patterns,
  // and the order keeps only patterns that exist (cut to 64), or is just the first pattern the song has.
  function patternParts(song, name) {
    if (!PATTERN_NAMES.includes(name)) return null;
    const editing = PATTERN_NAMES.includes(song.editing) ? song.editing : "A";
    if (name === editing) {
      const melody = isObj(song.melody) ? song.melody : {};
      const open = { tracks: isObj(song.tracks) ? song.tracks : {}, notes: isObj(melody.notes) ? melody.notes : {}, ties: isObj(melody.ties) ? melody.ties : {} };
      PART_KEYS.forEach((key) => {
        if (isObj(song[key])) open[key] = { notes: isObj(song[key].notes) ? song[key].notes : {}, ties: isObj(song[key].ties) ? song[key].ties : {} };
      });
      return open;
    }
    const other = isObj(song.patterns) && Object.prototype.hasOwnProperty.call(song.patterns, name) ? song.patterns[name] : null;
    if (!isObj(other)) return null;
    const stored = { tracks: isObj(other.tracks) ? other.tracks : {}, notes: isObj(other.notes) ? other.notes : {}, ties: isObj(other.ties) ? other.ties : {} };
    PART_KEYS.forEach((key) => {
      if (isObj(other[key]) || isObj(song[key])) {
        const part = isObj(other[key]) ? other[key] : {};
        stored[key] = { notes: isObj(part.notes) ? part.notes : {}, ties: isObj(part.ties) ? part.ties : {} };
      }
    });
    return stored;
  }
  // The bars of the song, each with the parts that sound in it (kept equal to SongEngine.chainPatterns by song-chain.test.mjs): the song order
  // plays all the tracks together, unless the song gives a track a lane of its own (song.lanes), and song.bars sets how long the song is.
  function chainParts(song) {
    const names = PATTERN_NAMES.filter((n) => patternParts(song, n));
    const wanted = (Array.isArray(song.chain) ? song.chain : []).filter((n) => names.includes(n)).slice(0, MAX_CHAIN);
    const chain = wanted.length ? wanted : names.slice(0, 1);
    if (!chain.length) return [];
    const lanes = isObj(song.lanes) && LANE_KEYS.some((k) => isObj(song.lanes[k])) ? song.lanes : null;
    const orderOf = (key) => (lanes && isObj(lanes[key]) ? (Array.isArray(lanes[key].order) ? lanes[key].order : []).filter((n) => names.includes(n)).slice(0, MAX_BARS) : chain);
    const loops = (key) => !(lanes && isObj(lanes[key]) && lanes[key].loop === false);
    let total;
    if (Number.isInteger(song.bars) && song.bars >= 1) total = Math.min(MAX_BARS, song.bars);
    else {
      total = chain.length;
      if (lanes) LANE_KEYS.forEach((k) => { if (isObj(lanes[k])) total = Math.max(total, orderOf(k).length); });
      total = Math.min(MAX_BARS, Math.max(1, total));
    }
    const at = (key, bar) => {
      const order = orderOf(key);
      if (!order.length) return null;
      if (loops(key)) return order[bar % order.length];
      return bar < order.length ? order[bar] : null;
    };
    const bars = [];
    for (let bar = 0; bar < total; bar++) {
      const name = chain[bar % chain.length];
      if (!lanes) {
        bars.push(Object.assign({ name }, patternParts(song, name)));
        continue;
      }
      const pick = (key) => {
        const n = at(key, bar);
        return n ? patternParts(song, n) : null;
      };
      const drums = pick("drums");
      const melody = pick("melody");
      const out = { name, tracks: drums ? drums.tracks : {}, notes: melody ? melody.notes : {}, ties: melody ? melody.ties : {} };
      PART_KEYS.forEach((key) => {
        if (!isObj(song[key])) return;
        const part = pick(key);
        out[key] = { notes: part && part[key] ? part[key].notes : {}, ties: part && part[key] ? part[key].ties : {} };
      });
      bars.push(out);
    }
    return bars;
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

    // the bass, the chords and the lead, each on its own channel with its own program
    PART_KEYS.forEach((key) => {
      const config = PART_MIDI[key];
      const events = [];
      if (isObj(data[key]) && data[key].muted !== true) {
        const vol = volume(data[key]);
        bars.forEach((bar, b) => {
          if (!bar[key]) return;
          for (const noteName of Object.keys(bar[key].notes)) {
            const num = noteNumber(noteName);
            const lane = bar[key].notes[noteName];
            if (num === null || !Array.isArray(lane)) continue;
            const ties = bar[key].ties[noteName];
            const tied = (step) => Boolean(step > 0 && ties && ties[step] === true && lane[step] && lane[step - 1]);
            for (let step = 0; step < STEPS; step++) {
              if (!lane[step] || tied(step)) continue;
              let held = 1;
              while (step + held < STEPS && tied(step + held)) held++;
              const tick = (b * STEPS + step) * STEP_TICKS + delay(step);
              events.push({ tick, order: 1, bytes: [0x90 + config.channel, num, velocity(level(lane[step]), vol)] });
              events.push({ tick: tick + STEP_TICKS * held, order: 0, bytes: [0x80 + config.channel, num, 0] });
              notes++;
            }
          }
        });
      }
      if (!events.length) return;
      events.push({ tick: 0, order: -1, bytes: [0xc0 + config.channel, config.program] });
      if (PART_TAG[key]) events.push({ tick: 0, order: -2, bytes: metaText(0x04, PART_TAG[key]) });
      tracks.push(trackBytes(config.track, events));
    });
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

  // Reads a Standard MIDI File (format 0 or 1, ticks per quarter note). Returns { ppq, tempos: [{tick, micros}], timeSig, tracks: [{ name, tag,
  // notes: [{ tick, length, note, vel, channel }] }] } (tag is this site's marker for a chords or lead track, else "") or { error } in plain words. Nothing in the file can make it read past its own
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
      let partTag = "";
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
          else if (metaType === 0x04 && len < 40) partTag = Array.from(bytes.subarray(q, q + len)).map((c) => String.fromCharCode(c)).join("");
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
      tracks.push({ name, notes, tag: partTag });
    }
    if (!tracks.length) return { error: "That MIDI file has no tracks in it." };
    return { ppq, tempos, timeSig, tracks };
  }

  const STRONG_VELOCITY = 85;
  const MEDIUM_VELOCITY = 55;
  const strengthOf = (vel) => (vel >= STRONG_VELOCITY ? true : vel >= MEDIUM_VELOCITY ? 0.65 : 0.35);
  const MAX_IMPORT_BARS = MAX_BARS;

  // Turns a parsed MIDI file into a song: tempo; drums (channel 10) onto the drum rows by General MIDI note; the busiest higher part as the
  // melody and the busiest low part (named "bass", or mostly below C3) as the bass line, each moved by whole octaves into its piano roll
  // (held notes tied); everything snapped to sixteenth notes, one bar of 16 steps each. Identical bars become one pattern, so a repeating
  // file is a few patterns and a song order (up to sixteen different bars, 64 bars). Returns { song, info } (song already cleaned,
  // info.messages in plain words) or { error }.
  const MELODY_LOW = 48; // the lowest note of the melody roll (C3); the bass roll is C1 (24) to B2 (47)
  const BASS_LOW = 24;
  const BASS_HIGH = 47;
  const median = (list) => { const sorted = list.map((n) => n.note).sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
  function midiToSong(parsed) {
    if (!parsed || !Array.isArray(parsed.tracks)) return { error: "There is nothing to import." };
    const messages = [];
    const stepTicks = parsed.ppq / 4;
    const all = parsed.tracks.flatMap((t, ti) => t.notes.map((n) => Object.assign({ track: ti, trackName: t.name, trackTag: t.tag || "" }, n)));
    if (!all.length) return { error: "That MIDI file has no notes in it." };

    // the parts: drums are channel 10, every other (track, channel) pair is a candidate melody or bass line
    const drums = all.filter((n) => n.channel === 9);
    const parts = new Map();
    all.filter((n) => n.channel !== 9).forEach((n) => {
      const key = `${n.track}:${n.channel}`;
      if (!parts.has(key)) parts.set(key, { name: n.trackName || `channel ${n.channel + 1}`, tag: n.trackTag, notes: [] });
      parts.get(key).notes.push(n);
    });
    const ranked = [...parts.values()].sort((a, b) => b.notes.length - a.notes.length);
    // a chords or lead track this site wrote (it carries the marker) goes back where it came from; everything else is found as before
    const chordsPart = ranked.find((part) => part.tag === PART_TAG.chords) || null;
    const leadPart = ranked.find((part) => part.tag === PART_TAG.lead) || null;
    const rest = ranked.filter((part) => part !== chordsPart && part !== leadPart);
    const isLow = (part) => /bass/i.test(part.name) || median(part.notes) < MELODY_LOW;
    const bassPart = rest.find(isLow) || null;
    const melody = rest.find((part) => part !== bassPart) || null;
    const leftOutParts = rest.length - (melody ? 1 : 0) - (bassPart ? 1 : 0);
    if (chordsPart || leadPart) messages.push(`${[chordsPart && `the chords are "${chordsPart.name}"`, leadPart && `the lead is "${leadPart.name}"`].filter(Boolean).join(" and ").replace(/^./, (c) => c.toUpperCase())}.`);
    if (melody && bassPart) messages.push(`The melody is "${melody.name}" and the bass line is "${bassPart.name}".`);
    else if (bassPart) messages.push(`The bass line is "${bassPart.name}": it sits below the melody's range, so it became the bass line.`);
    else if (melody && ranked.length > 1) messages.push(`The melody is "${melody.name}", the busiest part.`);
    if (leftOutParts) messages.push(`${leftOutParts} other part${leftOutParts === 1 ? " was" : "s were"} left out.`);

    const barOf = (note) => Math.floor(Math.round(note.tick / stepTicks) / STEPS);
    const used = [...drums, ...(melody ? melody.notes : []), ...(bassPart ? bassPart.notes : []), ...(chordsPart ? chordsPart.notes : []), ...(leadPart ? leadPart.notes : [])];
    let lastBar = 0;
    let pastEnd = 0;
    used.forEach((n) => { // (a loop, not Math.max(...list): a big file would overflow the call stack)
      if (barOf(n) >= MAX_IMPORT_BARS) pastEnd++;
      else lastBar = Math.max(lastBar, barOf(n));
    });
    if (pastEnd) messages.push(`Notes after bar ${MAX_IMPORT_BARS} (${pastEnd}) were left out.`);
    const barCount = lastBar + 1;
    const makeBar = () => ({ drums: {}, notes: {}, ties: {}, bassNotes: {}, bassTies: {}, chordsNotes: {}, chordsTies: {}, leadNotes: {}, leadTies: {} });
    const bars = Array.from({ length: barCount }, makeBar);
    let offGrid = 0;
    let skippedDrums = 0;
    let folded = 0;
    let drumHits = 0;
    let melodyNotes = 0;
    let bassNotes = 0;
    let chordsNotes = 0;
    let leadNotes = 0;
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

    // Places one pitched part into its roll ([low, high] in MIDI numbers): a part outside it moves as a whole by octaves (so it keeps its
    // shape), to fit if its span allows, else to centre its middle note; any note still outside folds in. Returns what was done.
    function placePart(part, low, high, key, tieKey) {
      const result = { octaves: 0, folded: 0, count: 0 };
      if (!part) return result;
      let pitchLow = part.notes[0].note;
      let pitchHigh = pitchLow;
      part.notes.forEach((n) => { pitchLow = Math.min(pitchLow, n.note); pitchHigh = Math.max(pitchHigh, n.note); });
      if (pitchLow < low || pitchHigh > high) {
        const fits = [];
        for (let k = -10; k <= 10; k++) if (pitchLow + 12 * k >= low && pitchHigh + 12 * k <= high) fits.push(k);
        if (fits.length) result.octaves = fits.sort((a, b) => Math.abs(a) - Math.abs(b))[0];
        else result.octaves = Math.round(((low + high) / 2 - median(part.notes)) / 12);
      }
      const holds = [];
      part.notes.forEach((n) => {
        let note = n.note + result.octaves * 12;
        if (note < low || note > high) result.folded++;
        while (note < low) note += 12;
        while (note > high) note -= 12;
        const name = NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1);
        const step = snap(n);
        const bar = bars[Math.floor(step / STEPS)];
        if (!bar) return;
        const lane = bar[key][name] || (bar[key][name] = new Array(STEPS).fill(0));
        lane[step % STEPS] = Math.max(lane[step % STEPS], n.vel);
        result.count++;
        holds.push({ bar, name, at: step % STEPS, length: Math.max(1, Math.round(n.length / stepTicks)) });
      });
      // a note held for several steps is one note tied across them, up to the end of its bar and never over another note struck there
      holds.forEach(({ bar, name, at, length }) => {
        const lane = bar[key][name];
        for (let k = 1; k < length && at + k < STEPS; k++) {
          if (lane[at + k]) break;
          lane[at + k] = lane[at];
          (bar[tieKey][name] || (bar[tieKey][name] = new Array(STEPS).fill(false)))[at + k] = true;
        }
      });
      return result;
    }
    const melodyPlaced = placePart(melody, MELODY_LOW, 71, "notes", "ties");
    const bassPlaced = placePart(bassPart, BASS_LOW, BASS_HIGH, "bassNotes", "bassTies");
    const chordsPlaced = placePart(chordsPart, MELODY_LOW, 71, "chordsNotes", "chordsTies");
    const leadPlaced = placePart(leadPart, 60, 83, "leadNotes", "leadTies");
    melodyNotes = melodyPlaced.count;
    bassNotes = bassPlaced.count;
    chordsNotes = chordsPlaced.count;
    leadNotes = leadPlaced.count;
    folded = melodyPlaced.folded + bassPlaced.folded + chordsPlaced.folded + leadPlaced.folded;

    // what each bar holds, as the song stores it
    const hasBass = Boolean(bassPart);
    const extras = { bass: hasBass, chords: Boolean(chordsPart), lead: Boolean(leadPart) };
    const partOf = (bar) => {
      const part = { tracks: {}, notes: {}, ties: bar.ties };
      Object.keys(bar.drums).forEach((row) => (part.tracks[row] = bar.drums[row].map((v) => (v ? strengthOf(v) : false))));
      Object.keys(bar.notes).forEach((name) => (part.notes[name] = bar.notes[name].map((v) => (v ? strengthOf(v) : false))));
      PART_KEYS.forEach((key) => {
        if (!extras[key]) return;
        part[key] = { notes: {}, ties: bar[key + "Ties"] };
        Object.keys(bar[key + "Notes"]).forEach((name) => (part[key].notes[name] = bar[key + "Notes"][name].map((v) => (v ? strengthOf(v) : false))));
      });
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
    if (unique.length > PATTERN_NAMES.length) messages.push(`This file has ${unique.length} different bars. The first ${PATTERN_NAMES.length} became patterns ${PATTERN_NAMES[0]} to ${PATTERN_NAMES[PATTERN_NAMES.length - 1]}, and the ${leftOut} bars that are not one of them were left out.`);

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
    PART_KEYS.forEach((key) => {
      if (extras[key]) song[key] = { notes: first[key].notes, ties: first[key].ties };
    });
    if (kept.length > 1) {
      song.patterns = {};
      kept.slice(1).forEach((u, i) => {
        const pattern = { tracks: lanes(u.part), notes: u.part.notes, ties: u.part.ties };
        PART_KEYS.forEach((key) => {
          if (extras[key]) pattern[key] = { notes: u.part[key].notes, ties: u.part[key].ties };
        });
        song.patterns[PATTERN_NAMES[i + 1]] = pattern;
      });
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
    for (const [placed, label, range] of [[melodyPlaced, "melody", "C3 to B4"], [bassPlaced, "bass", "C1 to B2"], [chordsPlaced, "chords", "C3 to B4"], [leadPlaced, "lead", "C4 to B5"]]) {
      if (placed.octaves) messages.push(`The ${label} was moved ${Math.abs(placed.octaves)} octave${Math.abs(placed.octaves) === 1 ? "" : "s"} ${placed.octaves > 0 ? "up" : "down"} to fit the ${label === "melody" ? "" : label + " "}piano roll (${range}).`);
      if (placed.folded) messages.push(`${placed.folded} ${label} note${placed.folded === 1 ? " was" : "s were"} still outside the ${label === "melody" ? "" : label + " "}piano roll and moved by whole octaves to fit.`);
    }
    const total = drumHits + melodyNotes + bassNotes + chordsNotes + leadNotes;
    if (!total) return { error: "None of the notes in that MIDI file can be used here (no General MIDI drums this site has, and no melody or bass line)." };
    if (offGrid && offGrid / Math.max(1, total) > 0.1) messages.push(`${offGrid} note${offGrid === 1 ? " was" : "s were"} off the sixteenth-note grid and snapped to the nearest step.`);
    const counted = [`${drumHits} drum hit${drumHits === 1 ? "" : "s"}`, `${melodyNotes} melody note${melodyNotes === 1 ? "" : "s"}`];
    if (hasBass) counted.push(`${bassNotes} bass note${bassNotes === 1 ? "" : "s"}`);
    if (chordsPart) counted.push(`${chordsNotes} chord note${chordsNotes === 1 ? "" : "s"}`);
    if (leadPart) counted.push(`${leadNotes} lead note${leadNotes === 1 ? "" : "s"}`);
    messages.unshift(`Read ${barCount} bar${barCount === 1 ? "" : "s"} at ${song.tempo} BPM: ${counted.slice(0, -1).join(", ")} and ${counted[counted.length - 1]}.`);
    const cleaned = cleanSong(song);
    return { song: cleaned, info: { bars: barCount, patterns: kept.length, uniqueBars: unique.length, leftOutBars: leftOut, drumHits, melodyNotes, bassNotes, chordsNotes, leadNotes, skippedDrums, folded, offGrid, tempo: cleaned.tempo, melodyPart: melody ? melody.name : "", bassPart: bassPart ? bassPart.name : "", messages } };
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
  function cleanTieMap(rawTies, notes, names = PIANO_NOTES) {
    if (!isObj(rawTies)) return null;
    const ties = {};
    names.forEach((n) => {
      const lane = rawTies[n];
      if (!Array.isArray(lane)) return;
      const row = Array.from({ length: STEPS }, (_, i) => lane[i] === true && i > 0 && Boolean(notes[n][i]) && Boolean(notes[n][i - 1]));
      if (row.some(Boolean)) ties[n] = row;
    });
    return Object.keys(ties).length ? ties : null;
  }
  const cleanLane = (lane) => Array.from({ length: STEPS }, (_, i) => cleanStep(Array.isArray(lane) ? lane[i] : false));

  // A clean song from anything a file might hold: only the settings the builder knows, each checked and limited, so a damaged or
  // hand-edited file can't put odd values into the song.
  // Brings a song saved by an earlier build up to the current format (a copy; the argument is left alone). A song without a version is
  // version 1. Nothing needs reshaping yet, so this only stamps the version; the steps for later versions go in here, oldest first.
  function migrateSong(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? Object.assign({}, raw) : {};
    let v = Number(src.version);
    if (!Number.isFinite(v) || v < 1) v = 1;
    // if (v < 3) { ...reshape the fields version 3 changes...; v = 3; }
    src.version = SONG_VERSION; // a song from a newer build is read as far as this build understands it
    return src;
  }
  function cleanSong(input) {
    const src = migrateSong(input);
    const song = {
      version: SONG_VERSION,
      tempo: Math.round(clampNum(src.tempo, 40, 240, 120)),
      kit: oneOf(src.kit, KITS, "acoustic"),
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
    // Pump (the music ducks on each kick) is optional: it is only written once it is above 0, so a song without it keeps its keys.
    const pump = clampNum(src.pump, 0, 100, 0);
    if (pump > 0) song.pump = pump;
    // The mixer: a pan and a level per track, kept only for a track that has either (song._solo is never saved)
    if (isObj(src.mix)) {
      const mix = {};
      LANE_KEYS.forEach((id) => {
        const m = src.mix[id];
        if (!isObj(m)) return;
        const pan = Math.round(clampNum(m.pan, -1, 1, 0) * 1000) / 1000;
        const level = Math.round(clampNum(m.level, 0, 1, 1) * 1000) / 1000;
        if (pan === 0 && level >= 1) return;
        mix[id] = {};
        if (pan !== 0) mix[id].pan = pan;
        if (level < 1) mix[id].level = level;
      });
      if (Object.keys(mix).length) song.mix = mix;
    }
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
      Object.keys(DRUM_RANGES).forEach((key) => {
        if (m[key] !== undefined && m[key] !== null && m[key] !== "" && Number.isFinite(Number(m[key]))) entry[key] = clampNum(m[key], DRUM_RANGES[key][0], DRUM_RANGES[key][1], 0);
      });
      song.trackMeta[t] = entry;
    });
    const melody = src.melody && typeof src.melody === "object" ? src.melody : {};
    song.melody.waveform = oneOf(melody.waveform, WAVEFORMS, "sine");
    if (melody.muted === true) song.melody.muted = true;
    if (melody.hidden === true) song.melody.hidden = true;
    if (melody.volume !== undefined && melody.volume !== null && melody.volume !== "") song.melody.volume = clampNum(melody.volume, 0, 1, 1);
    if (MELODY_VOICES.includes(melody.voice)) song.melody.voice = melody.voice;
    const melodySynth = cleanSynth(melody.synth);
    if (melodySynth) song.melody.synth = melodySynth;
    const notes = melody.notes && typeof melody.notes === "object" ? melody.notes : {};
    PIANO_NOTES.forEach((n) => (song.melody.notes[n] = cleanLane(notes[n])));
    // Held notes: a tie only counts where the note is on at that step and the one before, so a stale flag can't survive the clean-up.
    const ties = cleanTieMap(melody.ties, song.melody.notes);
    if (ties) song.melody.ties = ties;
    // The bass, chords and lead: each with its sound (a voice name, a default per part when absent), mix flags and the notes of its own
    // two-octave roll. Only a song that has one keeps one.
    PART_KEYS.forEach((key) => {
      if (!isObj(src[key])) return;
      const raw = src[key];
      const part = {};
      if (MELODY_VOICES.includes(raw.voice)) part.voice = raw.voice;
      const partSynth = cleanSynth(raw.synth);
      if (partSynth) part.synth = partSynth;
      if (raw.muted === true) part.muted = true;
      if (raw.hidden === true) part.hidden = true;
      if (raw.volume !== undefined && raw.volume !== null && raw.volume !== "") part.volume = clampNum(raw.volume, 0, 1, 1);
      const partNotes = isObj(raw.notes) ? raw.notes : {};
      part.notes = {};
      PART_NOTES[key].forEach((n) => (part.notes[n] = cleanLane(partNotes[n])));
      const partTies = cleanTieMap(raw.ties, part.notes, PART_NOTES[key]);
      if (partTies) part.ties = partTies;
      song[key] = part;
    });
    if (src.scale && typeof src.scale === "object" && SCALE_TYPES.includes(src.scale.type) && NOTE_NAMES.includes(src.scale.root)) song.scale = Object.assign({ root: src.scale.root, type: src.scale.type }, src.scale.snap === true ? { snap: true } : {});
    // Patterns: which one is open (A is the default and is not written), the others, and the song order over them. Only the parts a
    // pattern owns (drum hits, melody notes, held notes, and the bass, chords and lead) are kept for them, over the rows this song has.
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
        PART_KEYS.forEach((key) => {
          if (!isObj(part[key])) return;
          const lanes = isObj(part[key].notes) ? part[key].notes : {};
          cleaned[key] = { notes: {} };
          PART_NOTES[key].forEach((note) => (cleaned[key].notes[note] = cleanLane(lanes[note])));
          const held = cleanTieMap(part[key].ties, cleaned[key].notes, PART_NOTES[key]);
          if (held) cleaned[key].ties = held;
        });
        patterns[n] = cleaned;
      });
      if (Object.keys(patterns).length) song.patterns = patterns;
    }
    if (Array.isArray(src.chain)) {
      const exists = new Set([open, ...Object.keys(song.patterns || {})]);
      const chain = src.chain.filter((n) => typeof n === "string" && exists.has(n)).slice(0, MAX_CHAIN);
      if (chain.length) song.chain = chain;
    }
    // How long the song is, and the tracks that play a run of patterns of their own (a lane keeps only patterns the song has).
    if (Number.isInteger(src.bars) && src.bars >= 1) song.bars = Math.min(MAX_BARS, src.bars);
    if (isObj(src.lanes)) {
      const exists = new Set([open, ...Object.keys(song.patterns || {})]);
      const lanes = {};
      LANE_KEYS.forEach((key) => {
        const lane = src.lanes[key];
        if (!isObj(lane) || !Array.isArray(lane.order)) return;
        const order = lane.order.filter((n) => typeof n === "string" && exists.has(n)).slice(0, MAX_BARS);
        lanes[key] = lane.loop === false ? { order, loop: false } : { order };
      });
      if (Object.keys(lanes).length) song.lanes = lanes;
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


  // ---------- Audio export: WAV and ZIP (pure: the builder renders, these only write bytes) ----------
  // A WAV of any number of channels: 16- or 24-bit integer PCM, or 32-bit float. Integer depths can be dithered (TPDF, one least-significant bit either
  // side) so rounding error does not turn into distortion on quiet material; exact digital silence is left silent rather than given a noise floor. The same
  // samples always give the same bytes (the dither uses a fixed seed). `channels` is an array of Float32Array (or Array) of the same length.
  const AUDIO_DEPTH_BYTES = { "16": 2, "24": 3, "32f": 4 };
  function encodeWav(channels, sampleRate, depth, dither) {
    const bytesPer = AUDIO_DEPTH_BYTES[depth];
    if (!bytesPer) throw new Error("unknown bit depth");
    const count = channels.length;
    const frames = count ? channels[0].length : 0;
    const isFloat = depth === "32f";
    const dataBytes = frames * count * bytesPer;
    const pad = dataBytes % 2; // RIFF chunks sit on even boundaries; an odd 24-bit data chunk gets one pad byte
    const factBytes = isFloat ? 12 : 0; // float WAVs carry a 'fact' chunk with the frame count
    const buffer = new ArrayBuffer(44 + factBytes + dataBytes + pad);
    const view = new DataView(buffer);
    const text = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    text(0, "RIFF");
    view.setUint32(4, 36 + factBytes + dataBytes + pad, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, isFloat ? 3 : 1, true); // 1 = integer PCM, 3 = IEEE float
    view.setUint16(22, count, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPer * count, true);
    view.setUint16(32, bytesPer * count, true);
    view.setUint16(34, bytesPer * 8, true);
    let at = 36;
    if (isFloat) {
      text(at, "fact");
      view.setUint32(at + 4, 4, true);
      view.setUint32(at + 8, frames, true);
      at += 12;
    }
    text(at, "data");
    view.setUint32(at + 4, dataBytes, true);
    at += 8;
    let peak = 0;
    let clipped = 0;
    let state = 0x9e3779b9 ^ (frames * count); // fixed seed: the same song always exports the same file
    const noise = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
    const full = isFloat ? 0 : Math.pow(2, bytesPer * 8 - 1);
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < count; c++) {
        const x = channels[c][i];
        const mag = Math.abs(x);
        if (mag > peak) peak = mag;
        if (mag > 1) clipped++;
        if (isFloat) {
          view.setFloat32(at, x, true);
        } else {
          let v = Math.max(-1, Math.min(1, x)) * (full - 1);
          if (dither && mag > 1e-9) v += noise() + noise() - 1;
          v = Math.max(-full, Math.min(full - 1, Math.round(v)));
          if (bytesPer === 2) view.setInt16(at, v, true);
          else {
            const u = v < 0 ? v + 0x1000000 : v;
            view.setUint8(at, u & 0xff);
            view.setUint8(at + 1, (u >> 8) & 0xff);
            view.setUint8(at + 2, (u >> 16) & 0xff);
          }
        }
        at += bytesPer;
      }
    }
    const bytes = new Uint8Array(buffer);
    return { blob: typeof Blob !== "undefined" ? new Blob([buffer], { type: "audio/wav" }) : null, bytes, peak, clipped };
  }

  // A minimal ZIP writer (stored, no compression: WAV does not compress usefully and this keeps it dependency-free). File names are flagged as UTF-8.
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function utf8(str) {
    const s = unescape(encodeURIComponent(String(str)));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  // The bytes of a ZIP of files [{name, bytes}]; `now` is the time stamped on every file (a test passes a fixed one).
  function buildZipBytes(files, now) {
    const when = now || new Date();
    const dosTime = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
    const dosDate = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const file of files) {
      const name = utf8(file.name);
      const crc = crc32(file.bytes);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true); // stored
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, file.bytes.length, true);
      local.setUint32(22, file.bytes.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), name, file.bytes);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, dosTime, true);
      entry.setUint16(14, dosDate, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, file.bytes.length, true);
      entry.setUint32(24, file.bytes.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), name);
      offset += 30 + name.length + file.bytes.length;
    }
    const centralSize = central.reduce((n, part) => n + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, part) => n + part.length, 0));
    let at = 0;
    for (const part of all) { out.set(part, at); at += part.length; }
    return out;
  }
  function buildZip(files) {
    return new Blob([buildZipBytes(files)], { type: "application/zip" });
  }

  window.SongFiles = { encodeWav, buildZip, buildZipBytes, crc32, AUDIO_DEPTH_BYTES, SONG_VERSION, migrateSong, parseMidi, midiToSong, importMidi, GM_TO_ROW, BASS_NOTES, PART_KEYS, PART_NOTES, PART_OCTAVES, PATTERN_NAMES, LANE_KEYS, MAX_BARS, cleanSynth, chainParts, MELODY_VOICES, KITS, CORE_DRUMS, EXTRA_DRUMS, GM_DRUMS, buildMidi, noteNumber, exportJson, parseImport, cleanSong, PPQ, STEP_TICKS, FORMAT, VERSION };
})();
