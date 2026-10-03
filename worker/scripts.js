// What a saved admin script may hold. Scripts live in the settings table (one row per script, "admin_script:<id>"), so they need no
// schema change and travel with the settings in a backup. Pure (no database access), so a node test can load it.
export const SCRIPT_PREFIX = "admin_script:";
export const SCRIPT_MAX = 40;
export const SCRIPT_CODE_MAX = 64 * 1024;
export const SCRIPT_NAME_MAX = 60;
export const SCRIPT_NOTE_MAX = 300;

export const scriptKey = (id) => `${SCRIPT_PREFIX}${id}`;
export const isScriptId = (id) => /^[a-f0-9]{12}$/.test(String(id));

// A body from the editor: { name, code, description? }. Returns { ok: true, value } or { ok: false, error }.
export function cleanScript(body) {
  const b = body && typeof body === "object" ? body : {};
  const name = String(b.name == null ? "" : b.name).replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "A script needs a name." };
  if (name.length > SCRIPT_NAME_MAX) return { ok: false, error: `Script names are limited to ${SCRIPT_NAME_MAX} characters.` };
  if (typeof b.code !== "string") return { ok: false, error: "A script needs some code." };
  // Counted in bytes: the settings row is what is limited, and a long run of non-Latin text is bigger than it looks.
  if (new TextEncoder().encode(b.code).length > SCRIPT_CODE_MAX) return { ok: false, error: `That script is too large to save (${SCRIPT_CODE_MAX / 1024} KB limit).` };
  const description = String(b.description == null ? "" : b.description).replace(/\s+/g, " ").trim();
  if (description.length > SCRIPT_NOTE_MAX) return { ok: false, error: `The description is limited to ${SCRIPT_NOTE_MAX} characters.` };
  return { ok: true, value: { name, code: b.code.replace(/\r\n?/g, "\n"), description } };
}

// A stored row back into a list entry; null for a row that is not valid JSON or has lost its fields.
export function readScriptRow(row) {
  if (!row || !String(row.key || "").startsWith(SCRIPT_PREFIX)) return null;
  try {
    const v = JSON.parse(row.value);
    if (!v || typeof v.name !== "string" || typeof v.code !== "string") return null;
    return { id: row.key.slice(SCRIPT_PREFIX.length), name: v.name, code: v.code, description: typeof v.description === "string" ? v.description : "", updated_at: typeof v.updated_at === "string" ? v.updated_at : null };
  } catch {
    return null;
  }
}
