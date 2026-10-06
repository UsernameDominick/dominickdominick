// What a new song starts with, as the owner sets it in Site Settings (Songs): the tempo, the number of bars and the drum kit. Each is saved as
// text, and "" means "the built-in default", so a value that is not a plain whole number in range (or a kit we do not have) is saved as "".
export const SONG_DEFAULT_KEYS = ["song_default_tempo", "song_default_bars", "song_default_kit"];
export const SONG_KITS = ["acoustic", "electronic", "808", "909", "house", "techno", "trap", "boombap", "lofi", "rock", "jazz", "dnb", "chip", "industrial", "soft"];

const wholeNumber = (value, min, max) => {
  const text = String(value == null ? "" : value).trim();
  if (!/^\d{1,4}$/.test(text)) return "";
  const n = Number(text);
  return n >= min && n <= max ? String(n) : "";
};

export function cleanSongDefault(key, value) {
  if (key === "song_default_tempo") return wholeNumber(value, 40, 240);
  if (key === "song_default_bars") return wholeNumber(value, 1, 64);
  if (key === "song_default_kit") return SONG_KITS.includes(String(value)) ? String(value) : "";
  return "";
}

// The body of a settings save with the song defaults cleaned (other keys untouched).
export function cleanSongDefaults(body) {
  for (const key of SONG_DEFAULT_KEYS) {
    if (key in body) body[key] = cleanSongDefault(key, body[key]);
  }
  return body;
}
