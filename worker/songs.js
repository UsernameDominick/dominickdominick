// What a song save may carry. The builder always sends a whole song; anything that is not the shape it writes is refused rather than
// stored, because a saved song is read back by the builder, the public embed and the audio export, and a wrong type breaks all three.
export const MAX_SONG_NAME = 200;
export const MAX_SONG_BYTES = 1000000;
const MAX_PRIVATE_NOTES = 20000;
const MAX_VOICE_NAME = 24;

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const allArrays = (obj) => Object.values(obj).every(Array.isArray);

// Patterns A to D and the song order. The pattern open in the builder is the song's own tracks and melody; the others live under
// "patterns" as { tracks, notes, ties }. Returns an error message, or null (a song with none of these is fine).
const PATTERN_NAMES = ["A", "B", "C", "D"];
const MAX_CHAIN = 32;
function patternsError(data) {
  if ("editing" in data && !PATTERN_NAMES.includes(data.editing)) return "The open pattern must be A, B, C or D.";
  if ("patterns" in data) {
    if (!isPlainObject(data.patterns)) return "The song's patterns must be an object.";
    for (const [name, part] of Object.entries(data.patterns)) {
      if (!PATTERN_NAMES.includes(name)) return "A pattern must be named A, B, C or D.";
      if (!isPlainObject(part)) return `Pattern ${name} must be an object.`;
      for (const key of ["tracks", "notes", "ties"]) {
        if (key in part && (!isPlainObject(part[key]) || !allArrays(part[key]))) return `Pattern ${name}'s ${key === "tracks" ? "drum tracks" : key === "notes" ? "melody notes" : "held notes"} must be lists of steps.`;
      }
      if ("bass" in part) {
        if (!isPlainObject(part.bass)) return `Pattern ${name}'s bass line must be an object.`;
        for (const key of ["notes", "ties"]) {
          if (key in part.bass && (!isPlainObject(part.bass[key]) || !allArrays(part.bass[key]))) return `Pattern ${name}'s bass ${key === "notes" ? "notes" : "held notes"} must be lists of steps.`;
        }
      }
    }
  }
  if ("chain" in data) {
    if (!Array.isArray(data.chain) || data.chain.length > MAX_CHAIN || !data.chain.every((n) => PATTERN_NAMES.includes(n))) return `The song order must be a list of up to ${MAX_CHAIN} pattern letters (A to D).`;
  }
  return null;
}

// Returns an error message, or null when the data is acceptable.
export function songDataError(data) {
  if (!isPlainObject(data)) return "Song data must be an object.";
  if (JSON.stringify(data).length > MAX_SONG_BYTES) return "This song is too large to save (over 1 MB of data).";
  if ("tempo" in data && data.tempo !== null && !Number.isFinite(data.tempo)) return "The tempo must be a number.";
  for (const [key, word] of [["space", "Space"], ["echo", "Echo"]]) {
    if (key in data && data[key] !== null && !Number.isFinite(data[key])) return `${word} must be a number.`;
  }
  if ("private_notes" in data && (typeof data.private_notes !== "string" || data.private_notes.length > MAX_PRIVATE_NOTES)) {
    return `The private notes must be text, up to ${MAX_PRIVATE_NOTES} characters.`;
  }
  const patternError = patternsError(data);
  if (patternError) return patternError;
  if ("tracks" in data && (!isPlainObject(data.tracks) || !allArrays(data.tracks))) return "The song's tracks must be lists of steps.";
  if ("trackMeta" in data && !isPlainObject(data.trackMeta)) return "The song's track settings must be an object.";
  if ("melody" in data) {
    if (!isPlainObject(data.melody)) return "The song's melody must be an object.";
    if ("notes" in data.melody && (!isPlainObject(data.melody.notes) || !allArrays(data.melody.notes))) return "The melody's notes must be lists of steps.";
    if ("ties" in data.melody && (!isPlainObject(data.melody.ties) || !allArrays(data.melody.ties))) return "The melody's held notes must be lists of steps.";
    if ("voice" in data.melody && (typeof data.melody.voice !== "string" || data.melody.voice.length > MAX_VOICE_NAME)) return "The melody's sound must be a short name.";
  }
  if ("bass" in data) {
    if (!isPlainObject(data.bass)) return "The song's bass line must be an object.";
    if ("notes" in data.bass && (!isPlainObject(data.bass.notes) || !allArrays(data.bass.notes))) return "The bass line's notes must be lists of steps.";
    if ("ties" in data.bass && (!isPlainObject(data.bass.ties) || !allArrays(data.bass.ties))) return "The bass line's held notes must be lists of steps.";
    if ("voice" in data.bass && (typeof data.bass.voice !== "string" || data.bass.voice.length > MAX_VOICE_NAME)) return "The bass line's sound must be a short name.";
  }
  return null;
}

// Cleans a create (data left out means an empty song) or an edit (data left out means "keep the song as it is", so renaming can
// never wipe it). Returns { name, data } (data undefined on an edit that sent none) or { error }.
export function cleanSongSave(body, { edit = false } = {}) {
  const src = body && typeof body === "object" ? body : {};
  const name = typeof src.name === "string" ? src.name.trim() : "";
  if (!name) return { error: "Name is required" };
  if (name.length > MAX_SONG_NAME || /[\u0000-\u001f\u007f]/.test(name)) return { error: `The name must be under ${MAX_SONG_NAME} characters, on one line` };
  if (src.data === undefined || src.data === null) return { name, data: edit ? undefined : {} };
  const error = songDataError(src.data);
  if (error) return { error };
  return { name, data: src.data };
}
