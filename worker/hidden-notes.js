// What the Hidden Notes vault will store. The server never sees a passphrase or any readable text: every note is a sealed blob made in the
// owner's browser (AES-GCM under a key derived from the passphrase), and the vault's "meta" holds only the salt and a sealed check word
// used to tell a right passphrase from a wrong one. This file only checks the shapes, so nothing odd is stored.
export const HIDDEN_NOTE_PREFIX = "hidden_note:";
export const HIDDEN_META_KEY = "hidden_notes_meta";
export const MAX_HIDDEN_NOTES = 300;
export const MAX_HIDDEN_BLOB = 400000;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Any settings row of the vault (used to keep it out of backups and safe through a restore).
export const isHiddenNotesKey = (key) => typeof key === "string" && key.startsWith("hidden_note");

function sealed(v, maxCt) {
  return !!v && typeof v === "object" && !Array.isArray(v) && typeof v.iv === "string" && v.iv.length === 16 && B64.test(v.iv) && typeof v.ct === "string" && v.ct.length >= 24 && v.ct.length <= maxCt && B64.test(v.ct);
}

// A note's blob as the exact text to store, or null: a JSON string of { v: 1, iv, ct }.
export function cleanHiddenBlob(raw) {
  if (typeof raw !== "string" || raw.length > MAX_HIDDEN_BLOB) return null;
  let v;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || v.v !== 1 || !sealed(v, MAX_HIDDEN_BLOB)) return null;
  return JSON.stringify({ v: 1, iv: v.iv, ct: v.ct });
}

// The vault's meta, cleaned, or null: { v: 1, salt, iter, check: { iv, ct } }.
export function cleanHiddenMeta(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.v !== 1) return null;
  if (typeof raw.salt !== "string" || raw.salt.length < 16 || raw.salt.length > 64 || !B64.test(raw.salt)) return null;
  if (!Number.isInteger(raw.iter) || raw.iter < 100000 || raw.iter > 2000000) return null;
  if (!sealed(raw.check, 200)) return null;
  return { v: 1, salt: raw.salt, iter: raw.iter, check: { iv: raw.check.iv, ct: raw.check.ct } };
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
// A replacement vault ({ meta, notes: [{ id?, blob, created_at?, updated_at? }] }), cleaned, or { error }.
export function cleanHiddenVault(body) {
  const meta = cleanHiddenMeta(body && body.meta);
  if (!meta) return { error: "The vault settings are not valid." };
  const list = body && Array.isArray(body.notes) ? body.notes : null;
  if (!list) return { error: "The notes must be a list." };
  if (list.length > MAX_HIDDEN_NOTES) return { error: `A vault holds up to ${MAX_HIDDEN_NOTES} notes.` };
  const notes = [];
  const seen = new Set();
  for (const n of list) {
    const blob = cleanHiddenBlob(n && n.blob);
    if (!blob) return { error: "One of the notes is not a sealed note." };
    let id = n && typeof n.id === "string" && /^[a-f0-9]{12}$/.test(n.id) && !seen.has(n.id) ? n.id : null;
    if (id) seen.add(id);
    notes.push({ id, blob, created_at: n && ISO.test(n.created_at) ? n.created_at : null, updated_at: n && ISO.test(n.updated_at) ? n.updated_at : null });
  }
  return { meta, notes };
}
