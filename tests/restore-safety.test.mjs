// Restoring replaces the whole site, so it must first save a safety copy (and refuse to go on if that fails), the safety copies
// must not push daily backups out of rotation, and the preview must say what would change. Uses a fake D1 and R2.
import { runScheduledBackup, runSafetyBackup, compareBackupToSite, previewScheduledBackup, listScheduledBackups, SAFETY_BACKUP_PREFIX } from "../worker/db.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

function makeEnv(rowsByTable = {}, { failPut = false, corruptRead = false } = {}) {
  const store = new Map();
  let clock = Date.parse("2026-01-01T00:00:00Z");
  const settings = new Map();
  const env = {
    store,
    settings,
    MEDIA: {
      async put(key, bytes, opts) { if (failPut) throw new Error("R2 is down"); clock += 60000; store.set(key, { bytes: new Uint8Array(bytes), uploaded: new Date(clock).toISOString(), customMetadata: opts?.customMetadata || {} }); },
      async get(key) { const o = store.get(key); if (!o) return null; const bytes = corruptRead ? new Uint8Array([1, 2, 3]) : o.bytes; return { customMetadata: o.customMetadata, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => new TextDecoder().decode(bytes), body: null }; },
      async head(key) { return store.has(key) ? { key } : null; },
      async delete(key) { store.delete(key); },
      async list({ prefix }) { return { objects: [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length, uploaded: o.uploaded })) }; },
    },
    DB: {
      prepare(sql) {
        const table = (sql.match(/FROM (\w+)/i) || [])[1];
        const stmt = (args) => ({
          async all() { return { results: rowsByTable[table] || [] }; },
          async first() { if (/settings/i.test(sql) && args && args[0] && settings.has(args[0])) return { value: settings.get(args[0]) }; return null; },
          async run() { if (/INSERT INTO settings|INSERT OR REPLACE INTO settings|ON CONFLICT/i.test(sql) && args) settings.set(args[0], args[1]); return { meta: {} }; },
          bind(...a) { return stmt(a); },
        });
        return stmt(null);
      },
    },
  };
  return env;
}

const site = { pages: [{ id: 1 }, { id: 2 }, { id: 3 }], blocks: [{ id: 1 }], articles: [{ id: 1 }, { id: 2 }], settings: [{ key: "a", value: "b" }], projects: [], songs: [{ id: 1 }], simulations: [{ id: 1 }, { id: 2 }] };

// the safety copy
{
  const env = makeEnv(site);
  const key = await runSafetyBackup(env);
  ok(key.startsWith(SAFETY_BACKUP_PREFIX) && key.startsWith("backups/"), "the safety copy lives under backups/ with its own pre-restore name (so download, verify and restore routes accept it)", key);
  const saved = JSON.parse(new TextDecoder().decode(env.store.get(key).bytes));
  ok(saved.pages.length === 3 && saved.articles.length === 2 && saved.simulations.length === 2, "it contains the whole current site", Object.fromEntries(Object.entries(saved).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])));
  ok(!env.settings.has("last_backup_at"), "it does not change the daily backup status");
}
// failing closed
{
  let threw = null;
  try { await runSafetyBackup(makeEnv(site, { failPut: true })); } catch (e) { threw = e.message; }
  ok(threw === "R2 is down", "if the copy can't be written the call throws, so the caller must leave the site alone", threw);
  threw = null;
  try { await runSafetyBackup(makeEnv(site, { corruptRead: true })); } catch (e) { threw = e.message; }
  ok(/integrity check/.test(threw || ""), "a copy that reads back different is treated as failed", threw);
}
// rotation: daily backups keep 30, safety copies keep 10, neither evicts the other
{
  const env = makeEnv(site);
  const tick = () => new Promise((r) => setTimeout(r, 3)); // file names carry the millisecond
  for (let i = 0; i < 12; i++) { await runSafetyBackup(env); await tick(); }
  let keys = [...env.store.keys()];
  ok(keys.filter((k) => k.startsWith(SAFETY_BACKUP_PREFIX)).length === 10, "only the newest 10 safety copies are kept", keys.length);
  for (let i = 0; i < 33; i++) { await runScheduledBackup(env); await tick(); }
  keys = [...env.store.keys()];
  const daily = keys.filter((k) => !k.startsWith(SAFETY_BACKUP_PREFIX));
  const safety = keys.filter((k) => k.startsWith(SAFETY_BACKUP_PREFIX));
  ok(daily.length === 30 && safety.length === 10, "30 daily backups and 10 safety copies coexist: neither pushes the other out", [daily.length, safety.length]);
  ok(env.settings.get("last_backup_at") && env.settings.get("last_backup_error") === "", "a daily backup still records its status");
  const listed = await listScheduledBackups(env);
  ok(listed.length === 40 && listed.every((b) => b.key.startsWith("backups/")), "the backup list shows both kinds", listed.length);
}
// the preview
{
  const env = makeEnv(site);
  const file = { version: 1, exported_at: "2025-12-01T00:00:00Z", pages: [{ id: 1 }], blocks: [], articles: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], settings: [{ key: "a", value: "b" }], extra_table: [1, 2] };
  const diff = await compareBackupToSite(env, file);
  const row = (t) => diff.rows.find((r) => r.table === t);
  ok(row("pages").file === 1 && row("pages").now === 3 && row("articles").file === 4 && row("articles").now === 2, "the preview shows rows in the backup against rows on the site, per table", diff.rows.filter((r) => r.file || r.now));
  ok(row("songs").file === 0 && row("songs").now === 1, "a table missing from the file counts as zero in it (it would be emptied)");
  ok(diff.exported_at === "2025-12-01T00:00:00Z", "the backup's date is reported");
  let threw = null;
  try { await compareBackupToSite(env, { nonsense: true }); } catch (e) { threw = e.message; }
  ok(threw === "Not a valid backup file", "a file that is not a backup is refused", threw);
  const key = await runSafetyBackup(env);
  const viaKey = await previewScheduledBackup(env, key);
  ok(viaKey.rows.find((r) => r.table === "pages").file === 3 && viaKey.rows.find((r) => r.table === "pages").now === 3, "a stored backup can be previewed by key");
  threw = null;
  try { await previewScheduledBackup(env, "uploads/x.json"); } catch (e) { threw = e.message; }
  ok(threw === "Not a backup file", "only backup keys can be previewed", threw);
}
console.log(fail ? "FAILURES " + fail : "ALL PASS");
