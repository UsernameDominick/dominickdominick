import { isHiddenNotesKey } from "./hidden-notes.js";
import { toHex } from "./auth.js";
import { visibleText, nowIso, pageCssKey } from "./text.js";
import { bodyPictures, pictureUrl } from "./pictures.js";

export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "sitemap.xml",
  "robots.txt",
  "rss.xml",
  "topics",
  "archive",
  "history",
  "saved",
  "shuffle",
  "search",
  "media",
  "random",
  "projects",
  "simulation",
  "trainer",
  "studio",
  "studio-app",
  "piceditor",
  "simulations",
  "scans",
  "favicon.ico",
]);


export async function getPageBySlug(env, slug) {
  return env.DB.prepare("SELECT * FROM pages WHERE slug = ? AND deleted_at IS NULL").bind(slug).first();
}

export async function listPages(env) {
  const { results } = await env.DB.prepare("SELECT * FROM pages WHERE deleted_at IS NULL ORDER BY id ASC").all();
  return results;
}

export async function listTrashedPages(env) {
  const { results } = await env.DB.prepare("SELECT * FROM pages WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all();
  return results;
}

// Nested one level deep only — a page whose own nav_parent_id is set can't
// also be a parent (enforced both here and at save time in admin-api.js),
// so there's no cycle or multi-level case to guard against when building
// the tree: every child's parent is guaranteed to already be top-level.
// Articles/Projects/Topics aren't rows in the pages table (see worker/nav-settings.js): they are built-in links that follow the
// owner's own nav pages, so the site always has navigation to reach its content.

// Pages whose nav link only the signed-in owner sees (for trying a page out before it is announced). Kept as a list of page ids
// in one setting, so it needs no new column; the page itself stays reachable by its address.
const NAV_ADMIN_ONLY_KEY = "nav_admin_only";
export function parseNavAdminOnly(raw) {
  try {
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list) ? [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  } catch {
    return [];
  }
}
export async function getNavAdminOnlyIds(env) {
  return parseNavAdminOnly(await getSetting(env, NAV_ADMIN_ONLY_KEY));
}
export async function setNavAdminOnly(env, pageId, on) {
  const id = Number(pageId);
  const ids = (await getNavAdminOnlyIds(env)).filter((n) => n !== id);
  if (on) ids.push(id);
  await setSetting(env, NAV_ADMIN_ONLY_KEY, JSON.stringify(ids.sort((a, b) => a - b)));
}

// Pages, articles and projects the owner has asked search engines not to list ("noindex"), kept as {page:[ids], article:[ids],
// project:[ids]} in one setting so it needs no new column. Unlike leaving something out of the sitemap, this adds a robots noindex tag.
const NOINDEX_KEY = "noindex_items";
export const NOINDEX_TYPES = ["page", "article", "project"];
export function parseNoindexItems(raw) {
  let data = {};
  try {
    data = JSON.parse(raw || "{}");
  } catch {
    data = {};
  }
  const out = {};
  for (const type of NOINDEX_TYPES) {
    const list = data && Array.isArray(data[type]) ? data[type] : [];
    out[type] = [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  }
  return out;
}
export async function getNoindexItems(env) {
  return parseNoindexItems(await getSetting(env, NOINDEX_KEY));
}
export async function setNoindexItem(env, type, id, on) {
  if (!NOINDEX_TYPES.includes(type)) return;
  const items = await getNoindexItems(env);
  items[type] = items[type].filter((n) => n !== Number(id));
  if (on) items[type].push(Number(id));
  items[type].sort((a, b) => a - b);
  const empty = NOINDEX_TYPES.every((t) => !items[t].length);
  await setSetting(env, NOINDEX_KEY, empty ? "" : JSON.stringify(items));
}


// The pages that hold a Study block. They are kept out of the nav, the sitemap and search engines (Study is reached through the
// site's own search and then its password).
export async function listStudyPageIds(env) {
  const { results } = await env.DB
    .prepare(
      `SELECT DISTINCT b.page_id AS id FROM blocks b LEFT JOIN shared_blocks sb ON sb.id = b.shared_block_id WHERE COALESCE(sb.type, b.type) = 'study'`
    )
    .all();
  return new Set((results || []).map((r) => r.id));
}

export async function createPage(env, { slug, title, meta_description, nav_label, nav_order, og_image, canonical_url, custom_json_ld }) {
  const res = await env.DB
    .prepare(
      "INSERT INTO pages (slug, title, meta_description, nav_label, nav_order, og_image, canonical_url, custom_json_ld) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(slug, title, meta_description || "", nav_label || null, nav_order ?? null, og_image || null, canonical_url || null, custom_json_ld || null)
    .run();
  return res.meta.last_row_id;
}

export async function updatePage(env, id, fields) {
  const cols = [];
  const vals = [];
  for (const key of ["slug", "title", "meta_description", "nav_label", "nav_order", "og_image", "canonical_url", "custom_json_ld"]) {
    if (key in fields) {
      cols.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if ("locked" in fields) {
    cols.push("locked = ?");
    vals.push(fields.locked ? 1 : 0);
  }
  if ("sitemap_exclude" in fields) {
    cols.push("sitemap_exclude = ?");
    vals.push(fields.sitemap_exclude ? 1 : 0);
  }
  if ("nav_parent_id" in fields) {
    cols.push("nav_parent_id = ?");
    vals.push(Number.isFinite(Number(fields.nav_parent_id)) && fields.nav_parent_id ? Number(fields.nav_parent_id) : null);
  }
  if (!cols.length) return;
  cols.push("updated_at = datetime('now')", "version = version + 1");
  vals.push(id);
  await env.DB.prepare(`UPDATE pages SET ${cols.join(", ")} WHERE id = ?`).bind(...vals).run();
  // listNavPages() only builds a page's dropdown children when the page
  // itself passes its own nav_label/deleted_at filter — clearing this
  // page's nav_label used to silently drop every child from the nav
  // entirely (still nav_label'd themselves, but never picked up as
  // top-level since they still point at this now-invisible parent).
  // Promoting them to top-level keeps them visible instead.
  if ("nav_label" in fields && !fields.nav_label) {
    await env.DB.prepare("UPDATE pages SET nav_parent_id = NULL WHERE nav_parent_id = ?").bind(id).run();
  }
}


// "Delete" moves a page to the trash rather than actually removing it —
// recoverable by default. hardDeletePage is the real, permanent removal,
// used only from the trash view itself.
export async function deletePage(env, id) {
  await env.DB.prepare("UPDATE pages SET deleted_at = datetime('now'), version = version + 1 WHERE id = ?").bind(id).run();
  // Same reasoning as updatePage()'s nav_label clear above: a trashed
  // parent is invisible to listNavPages(), which used to take its
  // children down with it rather than promoting them to top-level.
  await env.DB.prepare("UPDATE pages SET nav_parent_id = NULL WHERE nav_parent_id = ?").bind(id).run();
}

export async function restorePage(env, id) {
  await env.DB.prepare("UPDATE pages SET deleted_at = NULL, version = version + 1 WHERE id = ?").bind(id).run();
}

export async function hardDeletePage(env, id) {
  // nav_parent_id has no ON DELETE clause, so D1's foreign-key enforcement
  // rejects deleting a page that's still some other page's nav parent —
  // detach any children first rather than leaving them permanently
  // undeletable (they just fall back to top-level nav, same as any page
  // whose parent was ever removed from the nav).
  // One batch (a single transaction), so a failure can't leave a page's history behind with the page gone.
  await env.DB.batch([
    env.DB.prepare("UPDATE pages SET nav_parent_id = NULL WHERE nav_parent_id = ?").bind(id),
    env.DB.prepare("DELETE FROM pages WHERE id = ?").bind(id),
    env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(pageCssKey(id)),
    // "Permanent" means the saved versions of the page go too.
    env.DB.prepare("DELETE FROM revisions WHERE kind = 'page' AND entity_id = ?").bind(id),
  ]);
}






// A block whose shared_block_id is set defers its type/content/style to
// that shared_blocks row — this is resolved right here so every caller
// (the admin canvas, public rendering, find-replace, revisions) just sees
// a normal-looking block with the effective content, without needing to
// know reusable blocks exist. Position (col/row/span) always stays
// per-placement even for a shared block. shared_block_name is exposed
// purely for the admin UI's "this is reusable" banner.
export async function listBlocks(env, pageId) {
  const { results } = await env.DB
    .prepare("SELECT * FROM blocks WHERE page_id = ? ORDER BY row ASC, col ASC")
    .bind(pageId)
    .all();
  if (!results.length) return [];
  const sharedIds = [...new Set(results.filter((b) => b.shared_block_id).map((b) => b.shared_block_id))];
  const sharedById = new Map();
  if (sharedIds.length) {
    const sharedRows = await selectIn(env, (marks) => `SELECT * FROM shared_blocks WHERE id IN (${marks})`, sharedIds);
    sharedRows.forEach((s) => sharedById.set(s.id, s));
  }
  return results.map((b) => {
    const shared = b.shared_block_id ? sharedById.get(b.shared_block_id) : null;
    return {
      ...b,
      type: shared ? shared.type : b.type,
      content: JSON.parse((shared ? shared.content : b.content) || "{}"),
      style: JSON.parse((shared ? shared.style : b.style) || "{}"),
      shared_block_name: shared ? shared.name : null,
    };
  });
}

export async function createBlock(env, pageId, block) {
  // Keep the block inside the 24-column grid: one that spills past it widens the whole public page (updateBlock does the same).
  const col = Math.min(24, Math.max(1, Math.trunc(Number(block.col ?? 1)) || 1));
  block = { ...block, col, col_span: Math.min(25 - col, Math.max(1, Math.trunc(Number(block.col_span ?? 24)) || 24)) };
  const res = await env.DB
    .prepare(
      "INSERT INTO blocks (page_id, type, content, style, col, col_span, row, row_span, shared_block_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      pageId,
      block.type,
      JSON.stringify(block.content || {}),
      JSON.stringify(block.style || {}),
      block.col ?? 1,
      block.col_span ?? 24,
      block.row ?? 1,
      block.row_span ?? 4,
      block.shared_block_id ?? null
    )
    .run();
  return res.meta.last_row_id;
}

export async function updateBlock(env, id, fields) {
  // Same grid bounds as createBlock: a block that spills past column 24 widens the whole public page. A change to
  // only one of col / col_span is clamped against the stored value of the other.
  if ("col" in fields || "col_span" in fields) {
    const cur = await env.DB.prepare("SELECT col, col_span FROM blocks WHERE id = ?").bind(id).first();
    if (cur) {
      const col = Math.min(24, Math.max(1, Math.trunc(Number("col" in fields ? fields.col : cur.col)) || cur.col));
      const span = Math.min(25 - col, Math.max(1, Math.trunc(Number("col_span" in fields ? fields.col_span : cur.col_span)) || 1));
      fields = { ...fields, col, col_span: span };
    }
  }
  const cols = [];
  const vals = [];
  for (const key of ["type", "col", "col_span", "row", "row_span", "shared_block_id"]) {
    if (key in fields) {
      cols.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if ("content" in fields) {
    cols.push("content = ?");
    vals.push(JSON.stringify(fields.content));
  }
  if ("style" in fields) {
    cols.push("style = ?");
    vals.push(JSON.stringify(fields.style));
  }
  if ("locked" in fields) {
    cols.push("locked = ?");
    vals.push(fields.locked ? 1 : 0);
  }
  if (!cols.length) return;
  cols.push("updated_at = datetime('now')");
  vals.push(id);
  await env.DB.prepare(`UPDATE blocks SET ${cols.join(", ")} WHERE id = ?`).bind(...vals).run();
}

export async function deleteBlock(env, id) {
  await env.DB.prepare("DELETE FROM blocks WHERE id = ?").bind(id).run();
}

export async function getBlockPageId(env, id) {
  const row = await env.DB.prepare("SELECT page_id FROM blocks WHERE id = ?").bind(id).first();
  return row ? row.page_id : null;
}

export async function getBlockSharedId(env, id) {
  const row = await env.DB.prepare("SELECT shared_block_id FROM blocks WHERE id = ?").bind(id).first();
  return row ? row.shared_block_id : null;
}




export async function updateSharedBlock(env, id, fields) {
  const cols = [];
  const vals = [];
  if ("name" in fields) {
    cols.push("name = ?");
    vals.push(fields.name);
  }
  if ("content" in fields) {
    cols.push("content = ?");
    vals.push(JSON.stringify(fields.content));
  }
  if ("style" in fields) {
    cols.push("style = ?");
    vals.push(JSON.stringify(fields.style));
  }
  if (!cols.length) return;
  cols.push("updated_at = datetime('now')");
  vals.push(id);
  await env.DB.prepare(`UPDATE shared_blocks SET ${cols.join(", ")} WHERE id = ?`).bind(...vals).run();
}




function parseArticleRow(row) {
  if (!row) return row;
  let tags = [];
  try {
    tags = JSON.parse(row.tags || "[]");
  } catch {
    tags = [];
  }
  let co_authors = [];
  try {
    co_authors = JSON.parse(row.co_authors || "[]");
  } catch {
    co_authors = [];
  }
  let related_override = [];
  try {
    related_override = JSON.parse(row.related_override || "[]");
  } catch {
    related_override = [];
  }
  return { ...row, tags, co_authors, related_override };
}



export async function listArticles(env, { publishedOnly = false, limit = null, tag = null, featuredOnly = false } = {}) {
  let sql = "SELECT * FROM articles WHERE deleted_at IS NULL";
  const params = [];
  // "Published" means published_at is set AND not in the future — a
  // scheduled article stays hidden from public listings until its time.
  // expires_at is the mirror image: once passed, the article drops back
  // out of every publishedOnly listing (though it isn't deleted, and an
  // admin editing it directly still sees it — same as a draft would).
  if (publishedOnly) {
    const now = nowIso(env);
    // archived is deliberately folded into publishedOnly rather than its
    // own option: an archived article stays directly reachable at its
    // URL (same as an expired one) but drops out of every listing/
    // discovery surface — there's no publishedOnly caller that should see
    // it and no non-publishedOnly caller (admin management lists, direct
    // slug lookups) that should have it hidden.
    sql += " AND published_at IS NOT NULL AND published_at <= ? AND (expires_at IS NULL OR expires_at > ?) AND archived = 0";
    params.push(now, now);
  }
  // Pinned articles lead every listing regardless of publish date; within
  // each group, newest first — same tiebreak as before pinning existed.
  sql += " ORDER BY pinned DESC, COALESCE(published_at, created_at) DESC";
  const lim = Number(limit);
  if (Number.isFinite(lim) && lim > 0) sql += ` LIMIT ${Math.floor(lim)}`;
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  let articles = results.map(parseArticleRow);
  if (tag) articles = articles.filter((a) => a.tags.includes(tag));
  if (featuredOnly) articles = articles.filter((a) => a.featured);
  return articles;
}






export async function slugExists(env, table, slug, excludeId = null) {
  const sql = excludeId
    ? `SELECT id FROM ${table} WHERE slug = ? AND id != ?`
    : `SELECT id FROM ${table} WHERE slug = ?`;
  const stmt = excludeId ? env.DB.prepare(sql).bind(slug, excludeId) : env.DB.prepare(sql).bind(slug);
  return Boolean(await stmt.first());
}






// D1 allows 100 bound values in one statement, so a long list of ids goes in chunks (90 leaves room for a value or two beside
// the list). Reads gather the rows from every chunk; writes go in one db.batch, which is a single transaction.
export const IN_CHUNK = 90;
export function chunkList(list, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
async function selectIn(env, sqlFor, ids) {
  const rows = [];
  for (const part of chunkList(ids)) {
    const { results } = await env.DB.prepare(sqlFor(part.map(() => "?").join(","))).bind(...part).all();
    rows.push(...(results || []));
  }
  return rows;
}








// ---------- Projects (a real content type — its own list/detail pages,
// not just project-card blocks manually placed on a page) ----------
function parseProjectRow(row) {
  if (!row) return row;
  let tags = [];
  try {
    tags = JSON.parse(row.tags || "[]");
  } catch {
    tags = [];
  }
  let tech_stack = [];
  try {
    tech_stack = JSON.parse(row.tech_stack || "[]");
  } catch {
    tech_stack = [];
  }
  let links = {};
  try {
    links = JSON.parse(row.links || "{}");
  } catch {
    links = {};
  }
  let related_articles = [];
  try {
    related_articles = JSON.parse(row.related_articles || "[]");
  } catch {
    related_articles = [];
  }
  let related_simulations = [];
  try {
    related_simulations = JSON.parse(row.related_simulations || "[]");
  } catch {
    related_simulations = [];
  }
  let related_scans = [];
  try {
    related_scans = JSON.parse(row.related_scans || "[]");
  } catch {
    related_scans = [];
  }
  let related_songs = [];
  try {
    related_songs = JSON.parse(row.related_songs || "[]");
  } catch {
    related_songs = [];
  }
  let related_override = [];
  try {
    related_override = JSON.parse(row.related_override || "[]");
  } catch {
    related_override = [];
  }
  // A whitespace-only summary is truthy everywhere it is read (meta description, RSS, cards),
  // so it is normalised to empty once, here, and the excerpt fallback applies.
  const summary = typeof row.summary === "string" ? visibleText(row.summary) : row.summary;
  return { ...row, summary, tags, tech_stack, links, related_articles, related_simulations, related_scans, related_songs, related_override };
}

// Nulls-last ascending sort by a numeric field — shared by both the
// featured-subset order and the general manual order below, since it's
// the exact same "everything without a value keeps its current relative
// order, everything else sorts by the number" rule either way.
function sortByOrderField(projects, field) {
  projects.sort((a, b) => {
    if (a[field] == null && b[field] == null) return 0;
    if (a[field] == null) return 1;
    if (b[field] == null) return -1;
    return a[field] - b[field];
  });
}

// Migration 0002 adds projects.related_songs. Until it is applied (a deploy can
// land first) the column is absent, so reads treat it as [] and writes skip it.
// Once seen it is remembered; while absent it is re-checked at most every 30 s.
let relatedSongsColumn = { has: false, checkedAt: 0 };
async function projectsHaveRelatedSongs(env) {
  if (relatedSongsColumn.has) return true;
  const now = Date.now();
  if (now - relatedSongsColumn.checkedAt < 30000) return false;
  try {
    const cols = await env.DB.prepare("PRAGMA table_info(projects)").all();
    relatedSongsColumn = { has: (cols.results || []).some((c) => c.name === "related_songs"), checkedAt: now };
  } catch {
    relatedSongsColumn = { has: false, checkedAt: now };
  }
  return relatedSongsColumn.has;
}

// A project can list up to this many related songs; each becomes an embedded player.
export const MAX_RELATED_SONGS = 50;

// Positive whole ids only: numbers, or plain digit strings. Booleans, arrays,
// exponent/hex strings and unsafe magnitudes are dropped instead of coerced.
export function cleanIdList(value) {
  if (!Array.isArray(value)) return [];
  const ids = [];
  const seen = new Set();
  for (const raw of value) {
    if (ids.length >= MAX_RELATED_SONGS) break;
    const n = typeof raw === "number" ? raw : typeof raw === "string" && /^[0-9]{1,15}$/.test(raw) ? Number(raw) : NaN;
    if (Number.isSafeInteger(n) && n > 0 && !seen.has(n)) {
      seen.add(n);
      ids.push(n);
    }
  }
  return ids.slice(0, MAX_RELATED_SONGS);
}

export async function listProjects(env, { publishedOnly = false, limit = null, tag = null, featuredOnly = false, sort = "newest" } = {}) {
  let sql = "SELECT * FROM projects WHERE deleted_at IS NULL";
  const params = [];
  if (publishedOnly) {
    const now = nowIso(env);
    sql += " AND published_at IS NOT NULL AND published_at <= ? AND (expires_at IS NULL OR expires_at > ?) AND archived = 0";
    params.push(now, now);
  }
  sql += " ORDER BY COALESCE(published_at, created_at) DESC";
  // A manual sort has to happen in JS across the *whole* matching set
  // before any limit is applied — if the SQL-level LIMIT ran first
  // (newest-first), a manually-prioritized-but-older project could get
  // cut before its rank was even considered.
  const lim = Number(limit);
  const applyLimitInSql = sort !== "manual" && Number.isFinite(lim) && lim > 0;
  if (applyLimitInSql) sql += ` LIMIT ${Math.floor(lim)}`;
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  let projects = results.map(parseProjectRow);
  if (tag) projects = projects.filter((p) => p.tags.includes(tag));
  if (featuredOnly) {
    projects = projects.filter((p) => p.featured);
    // Manual order among featured projects only.
    sortByOrderField(projects, "featured_order");
  } else if (sort === "manual") {
    sortByOrderField(projects, "sort_order");
  }
  if (!applyLimitInSql && Number.isFinite(lim) && lim > 0) projects = projects.slice(0, Math.floor(lim));
  return projects;
}








export async function snapshotProject(env, projectId) {
  const row = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first();
  if (!row) return;
  const prev = await env.DB
    .prepare("SELECT snapshot FROM revisions WHERE kind = 'project' AND entity_id = ? ORDER BY id DESC LIMIT 1")
    .bind(projectId)
    .first();
  const label = describeArticleChange(prev ? JSON.parse(prev.snapshot) : null, row);
  await env.DB
    .prepare("INSERT INTO revisions (kind, entity_id, snapshot, label) VALUES ('project', ?, ?, ?)")
    .bind(projectId, JSON.stringify(row), label)
    .run();
  await pruneRevisions(env, "project", projectId);
}

export async function restoreProjectRevision(env, projectId, revisionId) {
  const rev = await getRevision(env, revisionId);
  if (!rev || rev.kind !== "project" || rev.entity_id !== projectId) throw new Error("Revision not found");
  await snapshotProject(env, projectId);
  const p = rev.snapshot;
  await env.DB
    .prepare(
      "UPDATE projects SET title = ?, summary = ?, body = ?, tags = ?, tech_stack = ?, status = ?, links = ?, og_image = ?, published_at = ?, updated_at = datetime('now'), version = version + 1 WHERE id = ?"
    )
    .bind(p.title, p.summary, p.body, p.tags, p.tech_stack, p.status, p.links, p.og_image, p.published_at, projectId)
    .run();
  // Related songs come back with the rest when the column exists and the
  // snapshot carried it (snapshots from before migration 0002 have none).
  if (typeof p.related_songs === "string" && (await projectsHaveRelatedSongs(env))) {
    let ids = [];
    try {
      ids = cleanIdList(JSON.parse(p.related_songs));
    } catch {
      ids = [];
    }
    await env.DB.prepare("UPDATE projects SET related_songs = ? WHERE id = ?").bind(JSON.stringify(ids), projectId).run();
  }
}












export async function getRedirect(env, fromPath) {
  return env.DB.prepare("SELECT * FROM redirects WHERE from_path = ?").bind(fromPath).first();
}

export async function createRedirect(env, { from_path, to_path, status_code }) {
  const res = await env.DB
    .prepare("INSERT INTO redirects (from_path, to_path, status_code) VALUES (?, ?, ?)")
    .bind(from_path, to_path, status_code || 301)
    .run();
  return res.meta.last_row_id;
}






// ---------- Error log ----------
const ERROR_LOG_KEEP = 300;

export async function logError(env, { message, stack, path }) {
  await env.DB
    .prepare("INSERT INTO error_log (message, stack, path) VALUES (?, ?, ?)")
    .bind(String(message || "Unknown error").slice(0, 2000), stack ? String(stack).slice(0, 4000) : null, path || null)
    .run();
  await env.DB
    .prepare(`DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY id DESC LIMIT ?)`)
    .bind(ERROR_LOG_KEEP)
    .run()
    .catch(() => {});
}

export async function listErrors(env, limit = 50) {
  const { results } = await env.DB
    .prepare("SELECT * FROM error_log ORDER BY id DESC LIMIT ?")
    .bind(Math.max(1, Math.floor(limit)))
    .all();
  return results;
}



// ---------- Webhook delivery history ----------
export async function logWebhookDelivery(env, { url, payload, status, status_code, error }) {
  const res = await env.DB
    .prepare("INSERT INTO webhook_deliveries (url, payload, status, status_code, error) VALUES (?, ?, ?, ?, ?)")
    .bind(url, JSON.stringify(payload), status, status_code || null, error ? String(error).slice(0, 500) : null)
    .run();
  // Pruned the same way the activity log is, so this can't grow forever.
  await env.DB
    .prepare(`DELETE FROM webhook_deliveries WHERE id NOT IN (SELECT id FROM webhook_deliveries ORDER BY id DESC LIMIT 200)`)
    .run()
    .catch(() => {});
  return res.meta.last_row_id;
}








// ---------- Rate limiting (generic) ----------
// Separate from login's own checkLoginRateLimit/recordLoginAttempt — that
// path is already proven and left untouched; this is for other public
// endpoints (search, pageview recording) that didn't have any limit before.
export async function checkRateLimit(env, bucket, ip, { windowMinutes = 1, maxAttempts = 30 } = {}) {
  const { results } = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM rate_limits WHERE bucket = ? AND ip = ? AND attempted_at > datetime('now', '-${Math.max(
        1,
        Math.floor(windowMinutes)
      )} minutes')`
    )
    .bind(bucket, ip)
    .all();
  return (results[0]?.n || 0) < maxAttempts;
}

// Old rows are swept now and then rather than on every hit: the delete filters on attempted_at alone, so it cannot use the
// (bucket, ip, attempted_at) index and scans the table. The window itself is still enforced by checkRateLimit, so rows
// that linger a little longer than a day change nothing.
export const RATE_LIMIT_PRUNE_ODDS = 50;
export function shouldPruneRateLimits(roll = Math.random()) {
  return roll < 1 / RATE_LIMIT_PRUNE_ODDS;
}

export async function recordRateLimitHit(env, bucket, ip, roll) {
  await env.DB.prepare("INSERT INTO rate_limits (bucket, ip) VALUES (?, ?)").bind(bucket, ip).run();
  if (!shouldPruneRateLimits(roll)) return;
  await env.DB
    .prepare(`DELETE FROM rate_limits WHERE attempted_at < datetime('now', '-1 day')`)
    .run()
    .catch(() => {});
}

// ---------- Activity log ----------
// A lightweight audit trail — this is a single-admin site, so there's no
// "who did it", just what happened and when. Pruned the same way revisions
// are, so it can't grow forever.
const ACTIVITY_LOG_KEEP = 500;

export async function logActivity(env, action, entity_type, entity_label, detail) {
  await env.DB
    .prepare("INSERT INTO activity_log (action, entity_type, entity_label, detail) VALUES (?, ?, ?, ?)")
    .bind(action, entity_type, entity_label || null, detail || null)
    .run();
  await env.DB
    .prepare(
      `DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT ?)`
    )
    .bind(ACTIVITY_LOG_KEEP)
    .run()
    .catch(() => {});
}


// ---------- Media metadata ----------
// R2 holds the actual files; this table is a thin metadata layer on top
// (folder, tags, a default alt text) keyed by the R2 object key. A file can
// exist in R2 with no row here (never tagged/foldered) — treated as
// folder=null, tags=[], alt_text=null.
const MEDIA_META_QUERY_KEY_LIMIT = 100;
export async function getMediaMeta(env, keys) {
  const map = {};
  for (let offset = 0; offset < keys.length; offset += MEDIA_META_QUERY_KEY_LIMIT) {
    const batch = keys.slice(offset, offset + MEDIA_META_QUERY_KEY_LIMIT);
    const placeholders = batch.map(() => "?").join(",");
    const sql = "SELECT * FROM media WHERE key IN (" + placeholders + ")";
    const { results } = await env.DB.prepare(sql).bind(...batch).all();
    for (const row of results) {
      map[row.key] = { ...row, tags: JSON.parse(row.tags || "[]") };
    }
  }
  return map;
}

// The one place that decides a media item's width/height is actually
// plausible, rather than trusting whatever a caller passed in. Enforced
// here inside upsertMediaMeta itself -- the single write path every
// caller (upload, backfill, and PATCH /media/:key) already goes
// through -- rather than only in the header parsers that normally
// produce these values, after a critic pass found `PATCH /media/:key`
// forwards its raw request body straight through with no field
// allowlist, so a stray width/height in that body previously bypassed
// every parser-side check entirely and got rendered as-is into a real
// <img> tag. 20000px is far past any real photo/graphic this site would
// ever legitimately hold.
const MAX_PLAUSIBLE_IMAGE_DIMENSION = 20000;
function boundedImageDim(v) {
  return Number.isFinite(v) && v > 0 && v <= MAX_PLAUSIBLE_IMAGE_DIMENSION ? v : null;
}
export function plausibleDims(dims) {
  if (!dims) return null;
  const width = boundedImageDim(dims.width);
  const height = boundedImageDim(dims.height);
  if (width === null || height === null) return null;
  return { width, height };
}

export async function upsertMediaMeta(
  env,
  key,
  { folder, tags, alt_text, caption, credit, license, hash, private: isPrivate, width, height } = {}
) {
  // "__uncategorized__" is the sentinel the admin's "Uncategorized (no
  // folder)" filter option uses (public/admin/app.js). A real folder named
  // exactly that would collide with it in the filter dropdown and become
  // permanently unreachable there (found by a critic pass) — guarded here,
  // the single write path every caller (upload, bulk-move, single-item
  // edit) already goes through, rather than in each individual client-side
  // prompt, so no future caller can reintroduce the collision. Silently
  // normalized to "no folder" rather than rejected with an error: an admin
  // typing that exact string didn't mean anything other than "no folder"
  // in spirit, and this function has no error-reporting path back to most
  // of its callers.
  if (folder === "__uncategorized__") folder = null;
  // Enforced here, the one write path every caller (upload, backfill, and
  // the admin PATCH route) goes through, rather than only in the header
  // parsers that normally produce these values -- a critic pass found
  // `PATCH /media/:key` forwards its raw request body straight through
  // with no field allowlist, so a stray/adversarial width or height in
  // that body previously bypassed every parser-side plausibility check
  // entirely and got rendered as-is into a real <img> tag.
  if (width !== undefined) width = boundedImageDim(width);
  if (height !== undefined) height = boundedImageDim(height);
  const existing = await env.DB.prepare("SELECT * FROM media WHERE key = ?").bind(key).first();
  if (existing) {
    // Snapshot before overwriting — but only for an actual editorial edit
    // (folder/tags/alt/caption/credit/license), not the hash-only calls
    // from upload or the duplicate-detection backfill scan, which would
    // otherwise create a noisy revision for every file on every scan.
    const isEditorialChange = [folder, tags, alt_text, caption, credit, license, isPrivate].some((v) => v !== undefined);
    if (isEditorialChange) {
      await env.DB
        .prepare(
          "INSERT INTO media_revisions (media_key, folder, tags, alt_text, caption, credit, license) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(existing.key, existing.folder, existing.tags, existing.alt_text, existing.caption, existing.credit, existing.license)
        .run();
    }
    const cols = [];
    const vals = [];
    if (folder !== undefined) {
      cols.push("folder = ?");
      vals.push(folder || null);
    }
    if (tags !== undefined) {
      cols.push("tags = ?");
      vals.push(JSON.stringify(Array.isArray(tags) ? tags : []));
    }
    if (alt_text !== undefined) {
      cols.push("alt_text = ?");
      vals.push(alt_text || null);
    }
    if (caption !== undefined) {
      cols.push("caption = ?");
      vals.push(caption || null);
    }
    if (credit !== undefined) {
      cols.push("credit = ?");
      vals.push(credit || null);
    }
    if (license !== undefined) {
      cols.push("license = ?");
      vals.push(license || null);
    }
    if (hash !== undefined) {
      cols.push("hash = ?");
      vals.push(hash || null);
    }
    if (isPrivate !== undefined) {
      cols.push("private = ?");
      vals.push(isPrivate ? 1 : 0);
    }
    if (width !== undefined) {
      cols.push("width = ?");
      vals.push(width || null);
    }
    if (height !== undefined) {
      cols.push("height = ?");
      vals.push(height || null);
    }
    if (!cols.length) return;
    vals.push(key);
    await env.DB.prepare(`UPDATE media SET ${cols.join(", ")} WHERE key = ?`).bind(...vals).run();
  } else {
    await env.DB
      .prepare(
        "INSERT INTO media (key, folder, tags, alt_text, caption, credit, license, hash, private, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        key,
        folder || null,
        JSON.stringify(Array.isArray(tags) ? tags : []),
        alt_text || null,
        caption || null,
        credit || null,
        license || null,
        hash || null,
        isPrivate ? 1 : 0,
        width || null,
        height || null
      )
      .run();
  }
}



export async function recordMediaVersion(env, mediaKey, versionKey, size) {
  await env.DB
    .prepare("INSERT INTO media_versions (media_key, version_key, size) VALUES (?, ?, ?)")
    .bind(mediaKey, versionKey, size ?? null)
    .run();
}

export async function listMediaVersions(env, mediaKey) {
  const { results } = await env.DB
    .prepare("SELECT * FROM media_versions WHERE media_key = ? ORDER BY created_at DESC")
    .bind(mediaKey)
    .all();
  return results;
}


export async function deleteMediaVersions(env, mediaKey) {
  await env.DB.prepare("DELETE FROM media_versions WHERE media_key = ?").bind(mediaKey).run();
}

// Every hash shared by more than one file, each with its list of keys —
// for the "possible duplicates" filter in the library. A file uploaded
// before hashing existed just has hash = NULL and won't match anything
// until "Scan for duplicates" (backfillMediaHashes) has hashed it too.
export async function getDuplicateMediaHashes(env) {
  const { results } = await env.DB
    .prepare("SELECT hash, GROUP_CONCAT(key) AS keys FROM media WHERE hash IS NOT NULL GROUP BY hash HAVING COUNT(*) > 1")
    .all();
  return results.map((r) => ({ hash: r.hash, keys: r.keys.split(",") }));
}

export async function deleteMediaMeta(env, key) {
  // The file is gone for good, so its metadata history (alt text, captions, credits) goes with it, together.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM media WHERE key = ?").bind(key),
    env.DB.prepare("DELETE FROM media_revisions WHERE media_key = ?").bind(key),
  ]);
}


// Single traversal producing every media URL's usage details at once — one
// walk of pages/blocks/articles/projects/settings, not one per file. Both
// findMediaUsage (one file's own breakdown) and the "usage" library filter
// below derive from this instead of re-walking the site separately.
// Matches the same `[before-after: url1 | url2 | label | label]` shortcode
// render.js's paragraphsHtml() looks for in article/project body text —
// kept in sync with that regex since it's the other place this syntax is
// parsed.
const BEFORE_AFTER_LINE = /^\[before-after:\s*([^\]]+)\]$/gim;
function findBeforeAfterUrls(body) {
  const urls = [];
  for (const m of (body || "").matchAll(BEFORE_AFTER_LINE)) {
    const parts = m[1].split("|").map((s) => s.trim());
    if (parts[0]) urls.push(parts[0]);
    if (parts[1]) urls.push(parts[1]);
  }
  return urls;
}

// The pieces of written text a page block holds (text, quote, accordion items, tabs), for everything that looks inside text:
// pictures, embedded items, links.
function blockTexts(block) {
  const c = block.content || {};
  const texts = [];
  if (block.type === "text" || block.type === "quote") texts.push(c.text);
  if (block.type === "accordion" && Array.isArray(c.items)) c.items.forEach((it) => it && texts.push(it.body));
  if (block.type === "tabs" && Array.isArray(c.tabs)) c.tabs.forEach((it) => it && texts.push(it.body));
  return texts.filter((t) => typeof t === "string" && t);
}

async function getMediaUsageMap(env) {
  const pages = await listPages(env);
  const pageBlocks = await Promise.all(pages.map((p) => listBlocks(env, p.id)));
  const [articles, projects, defaultOg, topicMeta, scans, journalRows] = await Promise.all([
    listArticles(env),
    listProjects(env),
    getSetting(env, "default_og_image"),
    listTopicMeta(env),
    listScans(env),
    env.DB.prepare("SELECT j.body AS body, pr.title AS title FROM journal_entries j JOIN projects pr ON pr.id = j.project_id WHERE pr.deleted_at IS NULL").all(),
  ]);
  const usage = new Map();
  const add = (url, type, title) => {
    if (!url || !String(url).trim()) return;
    if (!usage.has(url)) usage.set(url, []);
    usage.get(url).push({ type, title });
  };
  pages.forEach((p, i) => {
    add(p.og_image, "Page share image", p.title);
    for (const b of pageBlocks[i]) {
      const c = b.content || {};
      const style = b.style || {};
      if (b.type === "image") add(c.url, "Image block", p.title);
      if (b.type === "gallery" && Array.isArray(c.images)) c.images.forEach((u) => add(u, "Gallery block", p.title));
      if (b.type === "before-after") {
        add(c.beforeUrl, "Before/after block", p.title);
        add(c.afterUrl, "Before/after block", p.title);
      }
      if (style.backgroundImage) add(style.backgroundImage, "Block background", p.title);
      // Pictures written into text (![alt](address)) in a text, quote, accordion or tabs block.
      for (const text of blockTexts(b)) bodyPictures(text).forEach((pic) => add(pictureUrl(pic), "Picture in text block", p.title));
    }
  });
  for (const a of articles) {
    add(a.og_image, "Article share image", a.title);
    findBeforeAfterUrls(a.body).forEach((u) => add(u, "Before/after in article body", a.title));
    bodyPictures(a.body).forEach((pic) => add(pictureUrl(pic), "Picture in article body", a.title));
  }
  for (const pr of projects) {
    add(pr.og_image, "Project share image", pr.title);
    findBeforeAfterUrls(pr.body).forEach((u) => add(u, "Before/after in project body", pr.title));
    bodyPictures(pr.body).forEach((pic) => add(pictureUrl(pic), "Picture in project body", pr.title));
  }
  for (const j of journalRows.results || []) bodyPictures(j.body).forEach((pic) => add(pictureUrl(pic), "Picture in project journal", j.title));
  if (defaultOg) add(defaultOg, "Site default share image", null);
  for (const t of topicMeta) add(t.og_image, "Topic share image", t.tag);
  for (const s of scans) {
    if (s.poster_key) add(s.poster_key.startsWith("/") ? s.poster_key : `/media/${s.poster_key}`, "3D scan poster", s.name);
  }
  return usage;
}


// The full per-location breakdown for every used URL at once, for the
// library's "usage" filter — typing e.g. "About" narrows the grid to
// files actually referenced from a page/article/project matching that text.
export async function getAllMediaUsage(env) {
  return getMediaUsageMap(env);
}

// ---------- 3D scans ----------
// The actual .glb/.usdz/poster files live in R2 under "scans/"; this table
// is the metadata + default camera view for each one, parallel to how
// simulations and media work.
export async function listScans(env) {
  const { results } = await env.DB.prepare("SELECT * FROM scans ORDER BY name").all();
  return results;
}





























// ---------- Revisions ----------
// A snapshot of a page's blocks, or an article's row, kept so a bad editing
// session can be undone. Page snapshots are throttled (see maybeSnapshotPage)
// since block edits autosave on every drag/resize/field change.

const REVISION_KEEP = 20;

async function pruneRevisions(env, kind, entityId) {
  await env.DB
    .prepare(
      `DELETE FROM revisions WHERE kind = ? AND entity_id = ? AND id NOT IN (
         SELECT id FROM revisions WHERE kind = ? AND entity_id = ? ORDER BY id DESC LIMIT ?
       )`
    )
    .bind(kind, entityId, kind, entityId, REVISION_KEEP)
    .run();
}

// Compares this snapshot against the previous one (if any) to turn "a
// revision from 3:41pm" into "a revision where 2 blocks changed, 1 was
// added" — the actual point of a history list. oldBlocks is null for the
// very first snapshot of a page.
function describePageChange(oldBlocks, newBlocks) {
  if (!oldBlocks) return "Initial version";
  const oldById = new Map(oldBlocks.map((b) => [b.id, b]));
  const newById = new Map(newBlocks.map((b) => [b.id, b]));
  let added = 0, removed = 0, changed = 0;
  newBlocks.forEach((b) => {
    if (!oldById.has(b.id)) added++;
  });
  oldBlocks.forEach((b) => {
    const nb = newById.get(b.id);
    if (!nb) removed++;
    else if (
      b.content !== nb.content ||
      b.style !== nb.style ||
      b.col !== nb.col ||
      b.col_span !== nb.col_span ||
      b.row !== nb.row ||
      b.row_span !== nb.row_span
    ) {
      changed++;
    }
  });
  const parts = [];
  if (added) parts.push(`${added} block${added === 1 ? "" : "s"} added`);
  if (removed) parts.push(`${removed} removed`);
  if (changed) parts.push(`${changed} changed`);
  return parts.length ? parts.join(", ") : "No changes";
}

async function snapshotPageBlocks(env, pageId) {
  const { results } = await env.DB.prepare("SELECT * FROM blocks WHERE page_id = ? ORDER BY id").bind(pageId).all();
  if (!results.length) return;
  const prev = await env.DB
    .prepare("SELECT snapshot FROM revisions WHERE kind = 'page' AND entity_id = ? ORDER BY id DESC LIMIT 1")
    .bind(pageId)
    .first();
  const label = describePageChange(prev ? JSON.parse(prev.snapshot) : null, results);
  await env.DB
    .prepare("INSERT INTO revisions (kind, entity_id, snapshot, label) VALUES ('page', ?, ?, ?)")
    .bind(pageId, JSON.stringify(results), label)
    .run();
  await pruneRevisions(env, "page", pageId);
}

const PAGE_SNAPSHOT_THROTTLE_MS = 3 * 60 * 1000;

// An unconditional page snapshot (the throttled one above skips when the last is
// under a few minutes old), for actions that should always be undoable.
export async function snapshotPageNow(env, pageId) {
  await snapshotPageBlocks(env, pageId);
}

export async function maybeSnapshotPage(env, pageId) {
  const last = await env.DB
    .prepare("SELECT created_at FROM revisions WHERE kind = 'page' AND entity_id = ? ORDER BY id DESC LIMIT 1")
    .bind(pageId)
    .first();
  if (last) {
    const lastMs = new Date(last.created_at.replace(" ", "T") + "Z").getTime();
    if (Date.now() - lastMs < PAGE_SNAPSHOT_THROTTLE_MS) return;
  }
  await snapshotPageBlocks(env, pageId);
}

function describeArticleChange(oldRow, newRow) {
  if (!oldRow) return "Initial version";
  const parts = [];
  if (oldRow.title !== newRow.title) parts.push("title changed");
  if (oldRow.body !== newRow.body) parts.push("body edited");
  if (oldRow.tags !== newRow.tags) parts.push("tags changed");
  if (oldRow.og_image !== newRow.og_image) parts.push("share image changed");
  const wasPublished = !!oldRow.published_at;
  const isPublished = !!newRow.published_at;
  if (!wasPublished && isPublished) parts.push("published");
  else if (wasPublished && !isPublished) parts.push("unpublished");
  else if (oldRow.published_at !== newRow.published_at) parts.push("publish date changed");
  return parts.length ? parts.join(", ") : "No changes";
}

export async function snapshotArticle(env, articleId) {
  const row = await env.DB.prepare("SELECT * FROM articles WHERE id = ?").bind(articleId).first();
  if (!row) return;
  const prev = await env.DB
    .prepare("SELECT snapshot FROM revisions WHERE kind = 'article' AND entity_id = ? ORDER BY id DESC LIMIT 1")
    .bind(articleId)
    .first();
  const label = describeArticleChange(prev ? JSON.parse(prev.snapshot) : null, row);
  await env.DB
    .prepare("INSERT INTO revisions (kind, entity_id, snapshot, label) VALUES ('article', ?, ?, ?)")
    .bind(articleId, JSON.stringify(row), label)
    .run();
  await pruneRevisions(env, "article", articleId);
}

export async function listRevisions(env, kind, entityId) {
  const { results } = await env.DB
    .prepare("SELECT id, created_at, label FROM revisions WHERE kind = ? AND entity_id = ? ORDER BY id DESC")
    .bind(kind, entityId)
    .all();
  return results;
}

export async function getRevision(env, id) {
  const row = await env.DB.prepare("SELECT * FROM revisions WHERE id = ?").bind(id).first();
  if (!row) return null;
  return { ...row, snapshot: JSON.parse(row.snapshot) };
}

export async function restorePageRevision(env, pageId, revisionId) {
  const rev = await getRevision(env, revisionId);
  if (!rev || rev.kind !== "page" || rev.entity_id !== pageId) throw new Error("Revision not found");
  // Unconditional (not throttled) so restoring is itself undoable.
  await snapshotPageBlocks(env, pageId);
  const stmts = [env.DB.prepare("DELETE FROM blocks WHERE page_id = ?").bind(pageId)];
  for (const b of rev.snapshot) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO blocks (id, page_id, type, content, style, col, col_span, row, row_span, updated_at, shared_block_id, locked)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(b.id, pageId, b.type, b.content, b.style, b.col, b.col_span, b.row, b.row_span, b.updated_at, b.shared_block_id ?? null, b.locked ?? 0)
    );
  }
  await env.DB.batch(stmts);
}

// Restores a single block from a page revision, rather than the whole
// page — for the common case of "just this one block got messed up",
// where reverting every other block back too would lose real work.
// Handles both "changed since" (block still exists, update it back) and
// "removed since" (block is gone now, re-insert it under its original id
// — safe because blocks.id is AUTOINCREMENT and never reused) in one
// upsert. Restoring a block that was only *added* since this revision
// (i.e. undoing an addition) isn't offered here — that's just deleting
// the block, which the block editor's own delete-with-undo already covers.
export async function restorePageRevisionBlock(env, pageId, revisionId, blockId) {
  const rev = await getRevision(env, revisionId);
  if (!rev || rev.kind !== "page" || rev.entity_id !== pageId) throw new Error("Revision not found");
  const oldBlock = rev.snapshot.find((b) => b.id === blockId);
  if (!oldBlock) throw new Error("That block isn't in this revision");
  await snapshotPageBlocks(env, pageId); // unconditional, so this is itself undoable
  await env.DB
    .prepare(
      `INSERT INTO blocks (id, page_id, type, content, style, col, col_span, row, row_span, updated_at, shared_block_id, locked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type, content = excluded.content, style = excluded.style,
         col = excluded.col, col_span = excluded.col_span, row = excluded.row, row_span = excluded.row_span,
         updated_at = excluded.updated_at, shared_block_id = excluded.shared_block_id, locked = excluded.locked`
    )
    .bind(
      oldBlock.id,
      pageId,
      oldBlock.type,
      oldBlock.content,
      oldBlock.style,
      oldBlock.col,
      oldBlock.col_span,
      oldBlock.row,
      oldBlock.row_span,
      oldBlock.shared_block_id ?? null,
      oldBlock.locked ?? 0
    )
    .run();
}

export async function restoreArticleRevision(env, articleId, revisionId) {
  const rev = await getRevision(env, revisionId);
  if (!rev || rev.kind !== "article" || rev.entity_id !== articleId) throw new Error("Revision not found");
  await snapshotArticle(env, articleId);
  const a = rev.snapshot;
  await env.DB
    .prepare(
      "UPDATE articles SET title = ?, body = ?, tags = ?, og_image = ?, published_at = ?, updated_at = datetime('now'), version = version + 1 WHERE id = ?"
    )
    .bind(a.title, a.body, a.tags, a.og_image, a.published_at, articleId)
    .run();
}









export async function listTopicMeta(env) {
  const { results } = await env.DB.prepare("SELECT * FROM topic_meta ORDER BY tag ASC").all();
  return results;
}





// no-emoji: data







// Settings are read a lot (a page needs about 30 of them for its theme, footer and custom head). A public page request carries
// `env.__settingsCache` (a Map made for that one request, see worker/index.js): what was already read is not asked for again, and
// getSettings() reads all the keys it is missing in one query. Requests that can write settings (the admin API) have no cache.
export async function getSettings(env, keys) {
  const cache = env.__settingsCache;
  const wanted = [...new Set(keys)];
  const out = {};
  const missing = [];
  for (const key of wanted) {
    if (cache && cache.has(key)) out[key] = cache.get(key);
    else missing.push(key);
  }
  // D1 allows 100 bound values per statement.
  for (let i = 0; i < missing.length; i += 90) {
    const batch = missing.slice(i, i + 90);
    const { results } = await env.DB
      .prepare(`SELECT key, value FROM settings WHERE key IN (${batch.map(() => "?").join(",")})`)
      .bind(...batch)
      .all();
    const found = new Map(results.map((r) => [r.key, r.value]));
    for (const key of batch) {
      const value = found.has(key) ? found.get(key) : null;
      out[key] = value;
      if (cache) cache.set(key, value);
    }
  }
  return out;
}

export async function getSetting(env, key) {
  const cache = env.__settingsCache;
  if (cache && cache.has(key)) return cache.get(key);
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  const value = row ? row.value : null;
  if (cache) cache.set(key, value);
  return value;
}

const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_ATTEMPTS = 8;
// With the owner's opt-in, the webhook URLs hear about it when one connection gets this many wrong passwords inside the window.
export const LOGIN_ALERT_AFTER = 5;

// How long until a connection with these failed-attempt times (SQL UTC strings) may try again: the failures that count are the ones
// still inside the window, and it may try once enough of the oldest have aged out to drop below the limit. 0 means it may try now.
export function loginRetrySeconds(attemptTimes, nowMs, { windowMinutes = LOGIN_WINDOW_MINUTES, max = LOGIN_MAX_ATTEMPTS } = {}) {
  const windowMs = windowMinutes * 60 * 1000;
  const recent = (attemptTimes || [])
    .map(stampMs)
    .filter((t) => t !== null && t > nowMs - windowMs)
    .sort((a, b) => a - b);
  if (recent.length < max) return 0;
  const frees = recent[recent.length - max] + windowMs;
  return Math.max(1, Math.ceil((frees - nowMs) / 1000));
}

export function loginLockoutMessage(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Too many wrong passwords. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

// { allowed, retryAfterSeconds } for this connection.
export async function getLoginLockout(env, ip, nowMs = Date.now()) {
  const { results } = await env.DB
    .prepare(`SELECT attempted_at FROM login_attempts WHERE ip = ? AND attempted_at > datetime('now', '-${LOGIN_WINDOW_MINUTES} minutes') ORDER BY attempted_at`)
    .bind(ip)
    .all();
  const retryAfterSeconds = loginRetrySeconds((results || []).map((r) => r.attempted_at), nowMs);
  return { allowed: retryAfterSeconds === 0, retryAfterSeconds };
}


// Only wrong passwords are recorded: signing in correctly several times in a row must never lock the owner out.
export async function recordLoginAttempt(env, ip) {
  await env.DB.prepare("INSERT INTO login_attempts (ip) VALUES (?)").bind(ip).run();
  // Best-effort cleanup so the table doesn't grow forever; cheap since it's indexed.
  await env.DB
    .prepare(`DELETE FROM login_attempts WHERE attempted_at < datetime('now', '-1 day')`)
    .run()
    .catch(() => {});
  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND attempted_at > datetime('now', '-${LOGIN_WINDOW_MINUTES} minutes')`)
    .bind(ip)
    .first()
    .catch(() => null);
  return row ? row.n || 0 : 0;
}











export async function setSetting(env, key, value) {
  await env.DB
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

// ---------- Backup / restore ----------
// Exports raw rows (content/style/tags left as their stored JSON strings,
// not parsed) so importAll can re-insert them byte-for-byte.

const BACKUP_VERSION = 1;

// A backup row for a circuit simulation is kept as the text it was exported as. The circuit builder is gone from the site, so nothing reads
// these rows any more; they stay in the backup so a restore never loses them.
function normalizeSimulationBackupData(value, label) {
  if (typeof value !== "string") throw new Error(`Invalid ${label} in backup`);
  return value;
}


export async function exportAll(env) {
  const [
    pages,
    blocks,
    articles,
    settings,
    redirects,
    templates,
    media,
    scans,
    sharedBlocks,
    projects,
    journalEntries,
    bomItems,
    simulations,
    songs,
    topicMeta,
  ] = await Promise.all([
    env.DB.prepare("SELECT * FROM pages ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM blocks ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM articles ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM settings WHERE substr(key, 1, 11) <> 'hidden_note' ORDER BY key").all(), // the Hidden Notes vault is never in a backup
    env.DB.prepare("SELECT * FROM redirects ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM templates ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM media ORDER BY key").all(),
    env.DB.prepare("SELECT * FROM scans ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM shared_blocks ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM projects ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM journal_entries ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM bom_items ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM simulations ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM songs ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM topic_meta ORDER BY tag").all(),
  ]);
  return {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    pages: pages.results,
    blocks: blocks.results,
    articles: articles.results,
    settings: settings.results,
    redirects: redirects.results,
    templates: templates.results,
    media: media.results,
    scans: scans.results,
    shared_blocks: sharedBlocks.results,
    projects: projects.results,
    journal_entries: journalEntries.results,
    bom_items: bomItems.results,
    simulations: simulations.results,
    songs: songs.results,
    topic_meta: topicMeta.results,
  };
}

// ---------- Scheduled backups ----------
// A full JSON export of D1 content, written to R2 under its own prefix —
// separate from "uploads/", and deliberately never served by the public
// /media/:key route (see worker/index.js), since a backup contains
// everything, not just what's meant to be public. Media files themselves
// aren't re-copied; they already live durably in R2 as-is.
const BACKUP_PREFIX = "backups/";
const BACKUP_KEEP = 30;
// A copy of the site saved automatically right before any restore (see runSafetyBackup). It lives under the same prefix, so
// the download, verify and restore routes accept it, but it is rotated on its own so it never pushes a daily backup out.
export const SAFETY_BACKUP_PREFIX = `${BACKUP_PREFIX}pre-restore-`;
const SAFETY_BACKUP_KEEP = 10;

// Records success/failure to settings (not just the error_log a failure
// also gets) so the admin UI can show a clear "backups are fine" or
// "last backup failed" status without digging through the error log —
// the whole point of an "alert", not just a record after the fact.
// Shared with admin-api.js's media upload dedup — previously three
// near-identical copies of "digest, then hex-encode" existed across
// auth.js/admin-api.js/db.js; toHex (the hex-encoding half, needed on its
// own for HMAC signatures in auth.js) is now the one shared building block.
export async function sha256Hex(buf) {
  return toHex(await crypto.subtle.digest("SHA-256", buf));
}

// Exports the whole site to `key` in R2, then reads it straight back and re-hashes it, so a truncated or corrupted write is
// caught now rather than the day the file is needed. Throws on any failure.
async function writeVerifiedBackup(env, key) {
  const data = await exportAll(env);
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const checksum = await sha256Hex(bytes);
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "application/json" }, customMetadata: { sha256: checksum } });
  const written = await env.MEDIA.get(key);
  if (!written) throw new Error("Backup write succeeded but the file can't be read back");
  const readBackHash = await sha256Hex(await written.arrayBuffer());
  if (readBackHash !== checksum) throw new Error("Backup file failed integrity check after writing (hash mismatch)");
}

// Tells the configured webhook URLs about something that went wrong, when the owner has asked for that (Site Settings, off by default:
// the URLs may be build hooks that were never meant to receive anything but publish notices). One POST per URL (at most five, so a
// failing day stays well inside the request budget), each logged like any other webhook delivery. Never throws: an alert that can't
// be sent must not hide the problem it is about. Returns how many URLs were called.
async function postWebhookAlert(env, flagKey, payload, send) {
  try {
    if ((await getSetting(env, flagKey)) !== "1") return 0;
    const urls = ((await getSetting(env, "webhook_url")) || "")
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, 5);
    let called = 0;
    for (const url of urls) {
      try {
        const res = await send(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        await logWebhookDelivery(env, { url, payload, status: res.ok ? "success" : "failed", status_code: res.status, error: res.ok ? null : `HTTP ${res.status}` });
      } catch (err) {
        await logWebhookDelivery(env, { url, payload, status: "failed", error: err && err.message ? err.message : "Request failed" }).catch(() => {});
      }
      called++;
    }
    return called;
  } catch {
    return 0;
  }
}

export function alertBackupFailure(env, message, send = fetch) {
  return postWebhookAlert(
    env,
    "webhook_on_backup_failure",
    { event: "backup_failed", site: "dominickdominick.com", message: String(message || "Backup failed").slice(0, 300), at: new Date().toISOString() },
    send
  );
}

// No address in the message: these URLs can be third-party services, and who is guessing is not theirs to know.
export function alertLoginFailures(env, count, send = fetch) {
  return postWebhookAlert(
    env,
    "webhook_on_login_failures",
    { event: "login_failures", site: "dominickdominick.com", count: Number(count) || 0, window_minutes: LOGIN_WINDOW_MINUTES, at: new Date().toISOString() },
    send
  );
}


// Stored dates come in two shapes (ISO with a T from the editors, "YYYY-MM-DD HH:MM:SS" from SQL's datetime('now')); both are UTC.
export function stampMs(value) {
  const text = String(value == null ? "" : value).trim();
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(text);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}${m[3] || ":00"}${m[4] ? (/^z$/i.test(m[4]) ? "Z" : m[4].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")) : "Z"}`);
  return Number.isFinite(ms) ? ms : null;
}




export async function runScheduledBackup(env, { alert = false } = {}) {
  try {
    const key = `${BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await writeVerifiedBackup(env, key);
    const listed = await env.MEDIA.list({ prefix: BACKUP_PREFIX });
    // Rotation: the newest BACKUP_KEEP daily files stay; the pre-restore safety copies are counted and kept separately.
    const newestFirst = (list) => list.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
    const daily = newestFirst(listed.objects.filter((o) => !o.key.startsWith(SAFETY_BACKUP_PREFIX)));
    await Promise.all(daily.slice(BACKUP_KEEP).map((o) => env.MEDIA.delete(o.key)));
    await setSetting(env, "last_backup_at", new Date().toISOString());
    await setSetting(env, "last_backup_error", "");
    return key;
  } catch (err) {
    await setSetting(env, "last_backup_error", err.message || "Backup failed");
    if (alert) await alertBackupFailure(env, err.message || "Backup failed");
    throw err;
  }
}

// Saved automatically before a restore replaces the site, so a wrong file or the wrong backup can be undone by restoring this
// copy. It does not touch the "last backup" status shown for the daily backups. Throws if the copy can't be saved and verified,
// and the caller must then leave the site alone.
export async function runSafetyBackup(env) {
  const key = `${SAFETY_BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await writeVerifiedBackup(env, key);
  const listed = await env.MEDIA.list({ prefix: SAFETY_BACKUP_PREFIX });
  const stale = listed.objects.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded)).slice(SAFETY_BACKUP_KEEP);
  await Promise.all(stale.map((o) => env.MEDIA.delete(o.key)));
  return key;
}

// What a restore would change, before it happens: rows per table in the backup next to rows on the site right now.
export async function compareBackupToSite(env, data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.pages)) throw new Error("Not a valid backup file");
  const now = await exportAll(env);
  const tables = [...new Set([...Object.keys(data), ...Object.keys(now)])].filter((k) => Array.isArray(data[k]) || Array.isArray(now[k]));
  return {
    version: data.version ?? null,
    exported_at: data.exported_at ?? null,
    rows: tables.map((table) => ({ table, file: Array.isArray(data[table]) ? data[table].length : 0, now: Array.isArray(now[table]) ? now[table].length : 0 })),
  };
}

export async function previewScheduledBackup(env, key) {
  if (!key.startsWith(BACKUP_PREFIX)) throw new Error("Not a backup file");
  const obj = await env.MEDIA.get(key);
  if (!obj) throw new Error("Backup file not found");
  return compareBackupToSite(env, JSON.parse(await obj.text()));
}

export async function getBackupStatus(env) {
  const [lastAt, lastError] = await Promise.all([getSetting(env, "last_backup_at"), getSetting(env, "last_backup_error")]);
  return { lastAt: lastAt || null, lastError: lastError || null };
}

// On-demand re-verification of a backup already sitting in R2 — the write-
// time check above only ever runs once, right after writing; this lets an
// admin re-check an existing file's integrity later (e.g. before trusting
// it for an actual restore). Backups written before this feature shipped
// have no stored checksum to compare against, so that's reported distinctly
// from an actual mismatch rather than treated as a failure.
export async function verifyBackupIntegrity(env, key) {
  if (!key.startsWith(BACKUP_PREFIX)) throw new Error("Not a backup file");
  const obj = await env.MEDIA.get(key);
  if (!obj) throw new Error("Backup file not found");
  const storedHash = obj.customMetadata?.sha256 || null;
  const actualHash = await sha256Hex(await obj.arrayBuffer());
  if (!storedHash) return { ok: null, hasChecksum: false, actualHash };
  return { ok: storedHash === actualHash, hasChecksum: true, storedHash, actualHash };
}

// A read-only peek inside a specific backup file — row counts per table
// and its exported_at/version, so an admin can sanity-check "is this the
// one I want" without doing a full (currently all-or-nothing) restore.
export async function getBackupContents(env, key) {
  if (!key.startsWith(BACKUP_PREFIX)) throw new Error("Not a backup file");
  const obj = await env.MEDIA.get(key);
  if (!obj) throw new Error("Backup file not found");
  const data = JSON.parse(await obj.text());
  const counts = {};
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) counts[k] = v.length;
  }
  return { version: data.version, exported_at: data.exported_at, counts };
}

// A scheduled backup could be inspected (getBackupContents) and verified
// not-corrupted (verifyBackupIntegrity) but never actually used to restore
// anything — the only restore path was "Restore from file…", which needs
// the admin to already have a JSON file on their own device. This closes
// that gap by reading a specific R2-stored backup straight into the exact
// same importAll() the manual file-upload restore already uses, so a
// scheduled backup's "verified intact" status actually means something
// actionable.
export async function restoreScheduledBackup(env, key) {
  if (!key.startsWith(BACKUP_PREFIX)) throw new Error("Not a backup file");
  const obj = await env.MEDIA.get(key);
  if (!obj) throw new Error("Backup file not found");
  const data = JSON.parse(await obj.text());
  await importAll(env, data);
  return { exported_at: data.exported_at };
}

export async function listScheduledBackups(env) {
  const listed = await env.MEDIA.list({ prefix: BACKUP_PREFIX });
  return listed.objects
    .sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded))
    .map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded }));
}




export async function importAll(env, data) {
  if (!data || typeof data !== "object") throw new Error("Not a valid backup file");
  // Deliberately no defaults here for the original four tables: a file
  // missing one of these keys entirely is malformed and must be rejected,
  // not silently treated as "wipe this table and leave it empty" — a backup
  // restore should never be able to destroy data just because a field name
  // is missing. `redirects` and `templates` were added later, so older
  // legitimate backups won't have them — default those to empty instead of
  // rejecting them.
  const {
    pages,
    blocks,
    articles,
    settings,
    redirects = [],
    templates = [],
    media = [],
    scans = [],
    shared_blocks: sharedBlocks = [],
    projects = [],
    journal_entries: journalEntries = [],
    bom_items: bomItems = [],
    simulations = [],
    songs = [],
    topic_meta: topicMeta = [],
  } = data;
  if (
    !Array.isArray(pages) ||
    !Array.isArray(blocks) ||
    !Array.isArray(articles) ||
    !Array.isArray(settings) ||
    !Array.isArray(redirects) ||
    !Array.isArray(templates) ||
    !Array.isArray(media) ||
    !Array.isArray(scans) ||
    !Array.isArray(sharedBlocks) ||
    !Array.isArray(projects) ||
    !Array.isArray(journalEntries) ||
    !Array.isArray(bomItems) ||
    !Array.isArray(simulations) ||
    !Array.isArray(songs) ||
    !Array.isArray(topicMeta)
  ) {
    throw new Error("This doesn't look like a dominickdominick backup file (missing pages/blocks/articles/settings)");
  }

  const restoredSimulations = simulations.map((s) => {
    if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("Invalid simulation in backup");
    const restoredData = normalizeSimulationBackupData(s.data ?? "{}", "simulation data");
    const hasPublishedName = Object.prototype.hasOwnProperty.call(s, "published_name");
    const hasPublishedData = Object.prototype.hasOwnProperty.call(s, "published_data");
    if (hasPublishedName !== hasPublishedData) throw new Error("Incomplete simulation publication snapshot in backup");
    const publishedData = hasPublishedData ? s.published_data : (s.data ?? "{}");
    const publishedName = hasPublishedName ? s.published_name : (publishedData === null ? null : s.name);
    if (publishedData !== null && typeof publishedData !== "string") throw new Error("Invalid published simulation data in backup");
    if (publishedName !== null && typeof publishedName !== "string") throw new Error("Invalid published simulation name in backup");
    if ((publishedData === null) !== (publishedName === null)) throw new Error("Incomplete simulation publication snapshot in backup");
    let normalizedPublishedData = publishedData;
    if (publishedData !== null) {
      normalizedPublishedData = normalizeSimulationBackupData(publishedData, "published simulation data");
    }
    return { ...s, data: restoredData, published_name: publishedName, published_data: normalizedPublishedData };
  });

  const stmts = [
    env.DB.prepare("DELETE FROM blocks"),
    env.DB.prepare("DELETE FROM shared_blocks"),
    env.DB.prepare("DELETE FROM pages"),
    env.DB.prepare("DELETE FROM articles"),
    env.DB.prepare("DELETE FROM settings WHERE substr(key, 1, 11) <> 'hidden_note'"), // a restore leaves the Hidden Notes vault alone
    env.DB.prepare("DELETE FROM redirects"),
    env.DB.prepare("DELETE FROM templates"),
    env.DB.prepare("DELETE FROM media"),
    env.DB.prepare("DELETE FROM scans"),
    env.DB.prepare("DELETE FROM journal_entries"),
    env.DB.prepare("DELETE FROM bom_items"),
    env.DB.prepare("DELETE FROM projects"),
    env.DB.prepare("DELETE FROM simulations"),
    env.DB.prepare("DELETE FROM songs"),
    env.DB.prepare("DELETE FROM topic_meta"),
    // History belongs to the content being replaced, and ids may be reused by the backup being restored.
    env.DB.prepare("DELETE FROM revisions"),
    env.DB.prepare("DELETE FROM media_revisions"),
  ];

  for (const p of pages) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO pages (id, slug, title, meta_description, nav_label, nav_order, og_image, canonical_url, deleted_at, created_at, updated_at, version, locked, sitemap_exclude, custom_json_ld, nav_parent_id, password_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          p.id,
          p.slug,
          p.title,
          p.meta_description ?? "",
          p.nav_label ?? null,
          p.nav_order ?? null,
          p.og_image ?? null,
          p.canonical_url ?? null,
          p.deleted_at ?? null,
          p.created_at,
          p.updated_at,
          p.version ?? 1,
          p.locked ?? 0,
          p.sitemap_exclude ?? 0,
          p.custom_json_ld ?? null,
          // Deferred to a second pass below: nav_parent_id is a
          // self-reference, and a child can have a lower id than its
          // parent, so setting it here could insert-order-fail the FK
          // check against a parent row that doesn't exist yet.
          null,
          p.password_hash ?? null
        )
    );
  }
  for (const p of pages) {
    if (p.nav_parent_id != null) {
      stmts.push(env.DB.prepare("UPDATE pages SET nav_parent_id = ? WHERE id = ?").bind(p.nav_parent_id, p.id));
    }
  }

  // Inserted before blocks (which may reference these) even though it's
  // declared after pages/articles here, to match the parent-before-child
  // order the DELETEs above already follow in reverse.
  for (const sb of sharedBlocks) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO shared_blocks (id, name, type, content, style, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(sb.id, sb.name, sb.type, sb.content ?? "{}", sb.style ?? "{}", sb.created_at, sb.updated_at)
    );
  }

  for (const b of blocks) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO blocks (id, page_id, type, content, style, col, col_span, row, row_span, updated_at, shared_block_id, locked)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          b.id,
          b.page_id,
          b.type,
          b.content ?? "{}",
          b.style ?? "{}",
          b.col,
          b.col_span,
          b.row,
          b.row_span,
          b.updated_at,
          b.shared_block_id ?? null,
          b.locked ?? 0
        )
    );
  }

  for (const a of articles) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO articles (id, slug, title, body, tags, og_image, canonical_url, published_at, deleted_at, series, series_order, co_authors, created_at, updated_at, version, locked, featured, pinned, expires_at, correction_note, tts_audio_key, sitemap_exclude, related_override, archived, private_notes, custom_json_ld)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          a.id,
          a.slug,
          a.title,
          a.body ?? "",
          a.tags ?? "[]",
          a.og_image ?? null,
          a.canonical_url ?? null,
          a.published_at ?? null,
          a.deleted_at ?? null,
          a.series ?? null,
          a.series_order ?? null,
          a.co_authors ?? "[]",
          a.created_at,
          a.updated_at,
          a.version ?? 1,
          a.locked ?? 0,
          a.featured ?? 0,
          a.pinned ?? 0,
          a.expires_at ?? null,
          a.correction_note ?? null,
          a.tts_audio_key ?? null,
          a.sitemap_exclude ?? 0,
          a.related_override ?? "[]",
          a.archived ?? 0,
          a.private_notes ?? null,
          a.custom_json_ld ?? null
        )
    );
  }

  for (const s of settings) {
    if (isHiddenNotesKey(s.key)) continue; // a backup never carries the vault, and one that somehow does must not overwrite it
    stmts.push(env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind(s.key, s.value));
  }

  for (const r of redirects) {
    stmts.push(
      env.DB
        .prepare("INSERT INTO redirects (id, from_path, to_path, status_code, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(r.id, r.from_path, r.to_path, r.status_code ?? 301, r.created_at)
    );
  }

  for (const t of templates) {
    stmts.push(
      env.DB
        .prepare("INSERT INTO templates (id, kind, name, data, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(t.id, t.kind, t.name, t.data ?? "{}", t.created_at)
    );
  }

  for (const m of media) {
    stmts.push(
      env.DB
        .prepare(
          "INSERT INTO media (key, folder, tags, alt_text, caption, credit, license, hash, private, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        // `private` has to come back as it was: a file marked private is only kept from readers by this flag, so a restore that
        // dropped it would publish the file. The sizes go through the same sanity check as an upload's.
        .bind(m.key, m.folder ?? null, m.tags ?? "[]", m.alt_text ?? null, m.caption ?? null, m.credit ?? null, m.license ?? null, m.hash ?? null, m.private ? 1 : 0, boundedImageDim(Number(m.width)), boundedImageDim(Number(m.height)), m.created_at)
    );
  }

  for (const s of scans) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO scans (id, name, glb_key, usdz_key, poster_key, camera_orbit, camera_target, field_of_view, size, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          s.id,
          s.name,
          s.glb_key,
          s.usdz_key ?? null,
          s.poster_key ?? null,
          s.camera_orbit ?? null,
          s.camera_target ?? null,
          s.field_of_view ?? null,
          s.size ?? 0,
          s.created_at,
          s.updated_at
        )
    );
  }

  const hasSongsColumn = await projectsHaveRelatedSongs(env);
  for (const p of projects) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO projects (id, slug, title, summary, body, tech_stack, status, links, og_image, canonical_url, tags, featured, published_at, deleted_at, created_at, updated_at, version, locked, related_articles, related_simulations, related_scans, expires_at, correction_note, tts_audio_key, sitemap_exclude, related_override, archived, featured_order, private_notes, sort_order, hero_video, custom_json_ld)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          p.id,
          p.slug,
          p.title,
          p.summary ?? "",
          p.body ?? "",
          p.tech_stack ?? "[]",
          p.status ?? null,
          p.links ?? "{}",
          p.og_image ?? null,
          p.canonical_url ?? null,
          p.tags ?? "[]",
          p.featured ?? 0,
          p.published_at ?? null,
          p.deleted_at ?? null,
          p.created_at,
          p.updated_at,
          p.version ?? 1,
          p.locked ?? 0,
          p.related_articles ?? "[]",
          p.related_simulations ?? "[]",
          p.related_scans ?? "[]",
          p.expires_at ?? null,
          p.correction_note ?? null,
          p.tts_audio_key ?? null,
          p.sitemap_exclude ?? 0,
          p.related_override ?? "[]",
          p.archived ?? 0,
          p.featured_order ?? null,
          p.private_notes ?? null,
          p.sort_order ?? null,
          p.hero_video ?? null,
          p.custom_json_ld ?? null
        )
    );
    // A backup from after migration 0002 carries related_songs (a JSON string).
    if (hasSongsColumn && p.related_songs) {
      let ids = [];
      try {
        ids = cleanIdList(typeof p.related_songs === "string" ? JSON.parse(p.related_songs) : p.related_songs);
      } catch {
        ids = [];
      }
      if (ids.length) stmts.push(env.DB.prepare("UPDATE projects SET related_songs = ? WHERE id = ?").bind(JSON.stringify(ids), p.id));
    }
  }

  for (const j of journalEntries) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO journal_entries (id, project_id, entry_date, title, body, entry_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(j.id, j.project_id, j.entry_date, j.title ?? "", j.body ?? "", j.entry_type ?? "log", j.created_at, j.updated_at)
    );
  }

  for (const b of bomItems) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO bom_items (id, project_id, item, quantity, price, link, substitution, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(b.id, b.project_id, b.item, b.quantity ?? 1, b.price ?? null, b.link ?? null, b.substitution ?? null, b.created_at, b.updated_at)
    );
  }

  for (const s of restoredSimulations) {
    stmts.push(
      env.DB
        .prepare("INSERT INTO simulations (id, name, data, published_name, published_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(s.id, s.name, s.data, s.published_name, s.published_data, s.created_at, s.updated_at)
    );
  }

  for (const s of songs) {
    stmts.push(
      env.DB
        .prepare("INSERT INTO songs (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(s.id, s.name, s.data ?? "{}", s.created_at, s.updated_at)
    );
  }

  for (const t of topicMeta) {
    stmts.push(
      env.DB
        .prepare("INSERT INTO topic_meta (tag, description, og_image, updated_at) VALUES (?, ?, ?, ?)")
        .bind(t.tag, t.description ?? null, t.og_image ?? null, t.updated_at)
    );
  }

  // .batch() runs everything as one atomic transaction — either it all
  // lands, or (on any failure) none of it does, so a bad file can't leave
  // the site half-wiped.
  await env.DB.batch(stmts);
}

// ---------- Link checker ----------
// Walks every button/project-card/links-list block, every article and
// project body, every project's own github/demo/docs/download links, and
// every journal entry body, then checks each URL found: internal paths
// (starting with "/") are checked against known pages/articles/projects/
// redirects — including whether the target is actually published right
// now, not just whether it exists (no network call); external links get a
// live HEAD/GET request with a short timeout.























// Tables that are deliberately not in the backup file, with the reason, so a new table cannot be forgotten silently (tests/backup-coverage.test.mjs).
export const BACKUP_NOT_INCLUDED = {
  login_attempts: "Short-lived sign-in rate-limit counters; nothing worth restoring.",
  rate_limits: "Short-lived request counters; nothing worth restoring.",
  error_log: "A rolling log of recent errors, pruned automatically; only useful for the current session of problems.",
  events: "Analytics events (clicks, searches, misses), a rolling record rather than site content.",
  pageviews: "Analytics page views, a rolling record rather than site content; large and rebuilt as visitors arrive.",
  activity_log: "The admin activity trail, pruned automatically.",
  webhook_deliveries: "A short history of webhook calls, pruned to the latest 200.",
  revisions: "Version history of pages, articles and projects. Not in the backup file today; the current content is. Restoring starts history afresh. (Worth deciding whether to include.)",
  media_revisions: "History of each media file's description edits. Not in the backup file today. (Worth deciding whether to include.)",
  media_versions: "Pointers to older uploaded versions of a file (the old bytes stay in R2). Not in the backup file today. (Worth deciding whether to include.)",
  reactions: "Reader reaction counts. Not in the backup file today. (Worth deciding whether to include.)",
  preview_links: "Secret share-links for unpublished items; deliberately not copied into a backup file, so a leaked backup can't reveal working links.",
};
