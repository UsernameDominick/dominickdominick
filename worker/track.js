// What the public /api/track endpoint will record. Anyone on the internet can post to it, so it takes plain readable event names
// (letters, digits, spaces and _ . : - /, up to 64 characters), refuses the names the server writes itself (a visitor must not be able
// to fake the "Missing pages" and "Searches" reports), and keeps only an on-site path.
const RESERVED = new Set(["not_found", "search"]);
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.:\-/]*$/u;

// The event name to record, or null when it should be refused.
export function cleanTrackName(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  const name = trimmed.replace(/ {2,}/g, " ");
  if (!name || name.length > 64 || !NAME.test(name)) return null;
  if (RESERVED.has(name.toLowerCase().replace(/[ -]/g, "_"))) return null;
  return name;
}

// A path that starts with a single slash, clipped; anything else is dropped rather than stored.
export function cleanTrackPath(raw) {
  if (typeof raw !== "string") return null;
  const p = raw.trim();
  return /^\/(?!\/)/.test(p) && !/[\u0000-\u001f\u007f]/.test(p) ? p.slice(0, 300) : null;
}
