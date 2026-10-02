// A backup that restores less than it saved is a silent data loss. This checks, from the real schema and the real code, that
//  (1) every table is either in the backup or on an explicit "not backed up" list with a reason, and
//  (2) restoring a backup writes back every column of every table that is backed up (a column added by a migration but forgotten in
//      the restore comes back empty: for `media.private` that would make a private file public).
import fs from "node:fs";
import { exportAll, importAll, BACKUP_NOT_INCLUDED } from "../worker/db.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

// ---- the schema, as the database really has it: schema.sql plus every migration ----
const sqlText = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8") + "\n" + fs.readdirSync(new URL("../migrations/", import.meta.url)).sort().map((f) => fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8")).join("\n");
const noComments = sqlText.replace(/--.*$/gm, "");
const columns = {};
for (const m of noComments.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*?)\n\);/g)) {
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of m[2]) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch; }
  parts.push(cur);
  columns[m[1]] = parts.map((p) => p.trim()).filter((p) => p && !/^(PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(p)).map((p) => p.split(/\s+/)[0]);
}
for (const m of noComments.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)) (columns[m[1]] ||= []).push(m[2]);
const tables = Object.keys(columns);

// ---- a fake database that remembers what is read and written ----
function makeEnv(rowsByTable = {}) {
  const reads = [];
  const writes = [];
  const stmt = (sql, args) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    async all() {
      if (/PRAGMA table_info\((\w+)\)/i.test(sql)) return { results: (columns[RegExp.$1] || []).map((name) => ({ name })) };
      const t = (sql.match(/FROM (\w+)/i) || [])[1];
      reads.push(t);
      return { results: rowsByTable[t] || [] };
    },
    async first() { return null; },
    async run() { writes.push({ sql, args }); return { meta: {} }; },
  });
  return { reads, writes, DB: { prepare: (sql) => stmt(sql, null), async batch(list) { list.forEach((s) => writes.push({ sql: s.sql, args: s.args })); return []; } } };
}

// (1) every table is accounted for
{
  const env = makeEnv();
  await exportAll(env);
  const exported = new Set(env.reads);
  const listed = new Set(Object.keys(BACKUP_NOT_INCLUDED));
  const unaccounted = tables.filter((t) => !exported.has(t) && !listed.has(t));
  ok(unaccounted.length === 0, "every table in the schema is either backed up or on the explicit not-backed-up list", unaccounted);
  const both = [...exported].filter((t) => listed.has(t));
  ok(both.length === 0, "no table is both backed up and listed as not backed up", both);
  const stale = [...listed].filter((t) => !tables.includes(t));
  ok(stale.length === 0, "the not-backed-up list names no table that doesn't exist", stale);
  ok(Object.values(BACKUP_NOT_INCLUDED).every((r) => typeof r === "string" && r.length > 10), "each exclusion says why");
  ok(tables.length >= 25 && exported.size >= 15, "the schema was read (tables found, backed-up tables found)", [tables.length, exported.size]);
}

// (2) a restore writes back every column
{
  const rows = {};
  let n = 100;
  const sample = (table, col) => {
    if (col === "id") return ++n;
    if (/_id$/.test(col)) return null;
    if (col === "data" || col === "published_data") return table === "simulations" ? '{"components":[],"wires":[]}' : "{}";
    if (col === "related_songs") return "[5]";
    if (/^(tags|related_articles|related_simulations|related_scans|related_override|co_authors|tech_stack)$/.test(col)) return "[]";
    if (/^(content|style|links|camera|custom_json_ld)$/.test(col)) return "{}";
    if (/(_at|date)$/.test(col)) return "2026-01-01 00:00:00";
    if (/^(version|locked|featured|pinned|archived|private|sitemap_exclude|sort_order|featured_order|width|height|size|status_code|col|col_span|row|row_span|nav_order|series_order|field_of_view)$/.test(col)) return 1;
    return `v-${col}`;
  };
  const backedUp = Object.fromEntries(Object.entries({ pages: "pages", blocks: "blocks", articles: "articles", settings: "settings", redirects: "redirects", templates: "templates", media: "media", scans: "scans", shared_blocks: "shared_blocks", projects: "projects", journal_entries: "journal_entries", bom_items: "bom_items", simulations: "simulations", songs: "songs", topic_meta: "topic_meta" }));
  for (const t of Object.keys(backedUp)) rows[t] = [Object.fromEntries((columns[t] || []).map((c) => [c, sample(t, c)]))];
  // blocks and journal rows must point at the page / project that exist in the fixture
  rows.blocks[0].page_id = rows.pages[0].id; rows.blocks[0].shared_block_id = null;
  rows.journal_entries[0].project_id = rows.projects[0].id; rows.bom_items[0].project_id = rows.projects[0].id;
  rows.pages[0].nav_parent_id = null;
  const file = { version: 1, exported_at: "2026-01-01T00:00:00Z", ...rows };
  const env = makeEnv();
  let threw = null;
  try { await importAll(env, file); } catch (e) { threw = e.message; }
  ok(threw === null, "a backup holding every column of every table restores without error", threw);
  const written = {};
  for (const w of env.writes) {
    let m;
    if ((m = /INSERT(?: OR REPLACE)? INTO (\w+)\s*\(([^)]*)\)/i.exec(w.sql))) (written[m[1]] ||= new Set()), m[2].split(",").forEach((c) => written[m[1]].add(c.trim()));
    else if ((m = /UPDATE (\w+) SET ([\s\S]*?) WHERE/i.exec(w.sql))) (written[m[1]] ||= new Set()), [...m[2].matchAll(/(\w+)\s*=/g)].forEach((x) => written[m[1]].add(x[1]));
  }
  for (const t of Object.keys(backedUp)) {
    const missing = (columns[t] || []).filter((c) => !(written[t] && written[t].has(c)));
    ok(missing.length === 0, `restoring ${t} writes back every column`, missing);
  }
}

// (3) the values of a media file's visibility and size survive a restore, and silly sizes do not
{
  const mk = (extra) => ({ key: "uploads/x.png", folder: null, tags: "[]", alt_text: null, caption: null, credit: null, license: null, hash: null, created_at: "2026-01-01 00:00:00", ...extra });
  const bound = async (media) => {
    const env = makeEnv();
    await importAll(env, { pages: [], blocks: [], articles: [], settings: [], media });
    const w = env.writes.find((x) => /INSERT INTO media /i.test(x.sql));
    const cols = /INSERT INTO media \(([^)]*)\)/i.exec(w.sql)[1].split(",").map((c) => c.trim());
    return Object.fromEntries(cols.map((c, i) => [c, w.args[i]]));
  };
  const priv = await bound([mk({ private: 1, width: 800, height: 600 })]);
  ok(priv.private === 1 && priv.width === 800 && priv.height === 600, "a private file stays private and keeps its size", priv);
  const pub = await bound([mk({ private: 0 })]);
  ok(pub.private === 0 && pub.width === null && pub.height === null, "a public file stays public; no size stays no size", pub);
  const odd = await bound([mk({ private: "yes", width: 999999, height: -4 })]);
  ok(odd.private === 1 && odd.width === null && odd.height === null, "an implausible size is dropped, and a truthy private flag counts as private", odd);
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
