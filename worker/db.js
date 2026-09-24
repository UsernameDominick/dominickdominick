export const RESERVED_SLUGS = new Set(["admin", "api", "sitemap.xml", "robots.txt"]);

// SQLite's LIKE treats % and _ as wildcards with no default escape, so a
// search for a literal "%" or "_" (e.g. "50% off", "file_name") would
// otherwise match everything/anything instead of that literal substring.
// Callers pair this with "LIKE ? ESCAPE '\'".
function escapeLike(s) {
  return String(s ?? "").replace(/[\\%_]/g, "\\$&");
}

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

export async function listNavPages(env) {
  const { results } = await env.DB
    .prepare("SELECT slug, nav_label FROM pages WHERE nav_label IS NOT NULL AND deleted_at IS NULL ORDER BY nav_order ASC, id ASC")
    .all();
  return results;
}

export async function createPage(env, { slug, title, meta_description, nav_label, nav_order, og_image }) {
  const res = await env.DB
    .prepare(
      "INSERT INTO pages (slug, title, meta_description, nav_label, nav_order, og_image) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(slug, title, meta_description || "", nav_label || null, nav_order ?? null, og_image || null)
    .run();
  return res.meta.last_row_id;
}

export async function updatePage(env, id, fields) {
  const cols = [];
  const vals = [];
  for (const key of ["slug", "title", "meta_description", "nav_label", "nav_order", "og_image"]) {
    if (key in fields) {
      cols.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if (!cols.length) return;
  cols.push("updated_at = datetime('now')", "version = version + 1");
  vals.push(id);
  await env.DB.prepare(`UPDATE pages SET ${cols.join(", ")} WHERE id = ?`).bind(...vals).run();
}

// "Delete" moves a page to the trash rather than actually removing it —
// recoverable by default. hardDeletePage is the real, permanent removal,
// used only from the trash view itself.
export async function deletePage(env, id) {
  await env.DB.prepare("UPDATE pages SET deleted_at = datetime('now'), version = version + 1 WHERE id = ?").bind(id).run();
}

export async function restorePage(env, id) {
  await env.DB.prepare("UPDATE pages SET deleted_at = NULL, version = version + 1 WHERE id = ?").bind(id).run();
}

export async function hardDeletePage(env, id) {
  await env.DB.prepare("DELETE FROM pages WHERE id = ?").bind(id).run();
}

// Copies a page's settings and every block onto a fresh page with a
// "-copy" (or "-copy-2", etc.) slug — a starting point to branch from
// without touching the original. Nav label is deliberately dropped so
// the copy doesn't silently double up an entry in the site nav.
export async function duplicatePage(env, id) {
  const source = await env.DB.prepare("SELECT * FROM pages WHERE id = ?").bind(id).first();
  if (!source) return null;
  let slug = `${source.slug}-copy`;
  let n = 2;
  while (await slugExists(env, "pages", slug)) {
    slug = `${source.slug}-copy-${n}`;
    n++;
  }
  const newId = await createPage(env, {
    slug,
    title: `${source.title} (copy)`,
    meta_description: source.meta_description,
    nav_label: null,
    nav_order: null,
    og_image: source.og_image,
  });
  const blocks = await listBlocks(env, id);
  for (const b of blocks) {
    await createBlock(env, newId, b);
  }
  return newId;
}

export async function listBlocks(env, pageId) {
  const { results } = await env.DB
    .prepare("SELECT * FROM blocks WHERE page_id = ? ORDER BY row ASC, col ASC")
    .bind(pageId)
    .all();
  return results.map((b) => ({
    ...b,
    content: JSON.parse(b.content || "{}"),
    style: JSON.parse(b.style || "{}"),
  }));
}

export async function createBlock(env, pageId, block) {
  const res = await env.DB
    .prepare(
      "INSERT INTO blocks (page_id, type, content, style, col, col_span, row, row_span) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      pageId,
      block.type,
      JSON.stringify(block.content || {}),
      JSON.stringify(block.style || {}),
      block.col ?? 1,
      block.col_span ?? 24,
      block.row ?? 1,
      block.row_span ?? 4
    )
    .run();
  return res.meta.last_row_id;
}

export async function updateBlock(env, id, fields) {
  const cols = [];
  const vals = [];
  for (const key of ["type", "col", "col_span", "row", "row_span"]) {
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
  return { ...row, tags, co_authors };
}

// Other published entries in the same series, in series_order (falling back
// to publish date for entries that don't have one set) — used for the
// "Part N of M" nav on an article page.
export async function getSeriesArticles(env, series) {
  if (!series) return [];
  const { results } = await env.DB
    .prepare(
      `SELECT * FROM articles WHERE deleted_at IS NULL AND series = ?
       AND published_at IS NOT NULL AND published_at <= ?
       ORDER BY series_order IS NULL, series_order ASC, published_at ASC`
    )
    .bind(series, new Date().toISOString())
    .all();
  return results.map(parseArticleRow);
}

export async function listArticles(env, { publishedOnly = false, limit = null, tag = null } = {}) {
  let sql = "SELECT * FROM articles WHERE deleted_at IS NULL";
  const params = [];
  // "Published" means published_at is set AND not in the future — a
  // scheduled article stays hidden from public listings until its time.
  if (publishedOnly) {
    sql += " AND published_at IS NOT NULL AND published_at <= ?";
    params.push(new Date().toISOString());
  }
  sql += " ORDER BY COALESCE(published_at, created_at) DESC";
  const lim = Number(limit);
  if (Number.isFinite(lim) && lim > 0) sql += ` LIMIT ${Math.floor(lim)}`;
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  let articles = results.map(parseArticleRow);
  if (tag) articles = articles.filter((a) => a.tags.includes(tag));
  return articles;
}

export async function listTrashedArticles(env) {
  const { results } = await env.DB
    .prepare("SELECT * FROM articles WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC")
    .all();
  return results.map(parseArticleRow);
}

export async function getArticleBySlug(env, slug) {
  const row = await env.DB.prepare("SELECT * FROM articles WHERE slug = ? AND deleted_at IS NULL").bind(slug).first();
  return parseArticleRow(row);
}

export async function slugExists(env, table, slug, excludeId = null) {
  const sql = excludeId
    ? `SELECT id FROM ${table} WHERE slug = ? AND id != ?`
    : `SELECT id FROM ${table} WHERE slug = ?`;
  const stmt = excludeId ? env.DB.prepare(sql).bind(slug, excludeId) : env.DB.prepare(sql).bind(slug);
  return Boolean(await stmt.first());
}

// published_at, when given explicitly, lets an article be scheduled for a
// future time; otherwise it falls back to the old on/off "published" flag.
function resolvePublishedAt({ published, published_at }) {
  if (published_at !== undefined) return published_at;
  return published ? new Date().toISOString() : null;
}

export async function createArticle(env, { slug, title, body, published, published_at, tags, og_image, series, series_order, co_authors }) {
  const res = await env.DB
    .prepare(
      "INSERT INTO articles (slug, title, body, published_at, tags, og_image, series, series_order, co_authors) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      slug,
      title,
      body || "",
      resolvePublishedAt({ published, published_at }),
      JSON.stringify(Array.isArray(tags) ? tags : []),
      og_image || null,
      series || null,
      Number.isFinite(Number(series_order)) ? Number(series_order) : null,
      JSON.stringify(Array.isArray(co_authors) ? co_authors : [])
    )
    .run();
  return res.meta.last_row_id;
}

export async function updateArticle(env, id, fields) {
  const cols = [];
  const vals = [];
  for (const key of ["slug", "title", "body", "og_image", "series"]) {
    if (key in fields) {
      cols.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if ("series_order" in fields) {
    cols.push("series_order = ?");
    vals.push(Number.isFinite(Number(fields.series_order)) ? Number(fields.series_order) : null);
  }
  if ("tags" in fields) {
    cols.push("tags = ?");
    vals.push(JSON.stringify(Array.isArray(fields.tags) ? fields.tags : []));
  }
  if ("co_authors" in fields) {
    cols.push("co_authors = ?");
    vals.push(JSON.stringify(Array.isArray(fields.co_authors) ? fields.co_authors : []));
  }
  if ("published_at" in fields || "published" in fields) {
    cols.push("published_at = ?");
    vals.push(resolvePublishedAt(fields));
  }
  if (!cols.length) return;
  cols.push("updated_at = datetime('now')", "version = version + 1");
  vals.push(id);
  await env.DB.prepare(`UPDATE articles SET ${cols.join(", ")} WHERE id = ?`).bind(...vals).run();
}

export async function bulkArticleAction(env, ids, action) {
  const validIds = ids.map(Number).filter(Number.isFinite);
  if (!validIds.length) return;
  const placeholders = validIds.map(() => "?").join(",");
  if (action === "publish") {
    await env.DB
      .prepare(`UPDATE articles SET published_at = COALESCE(published_at, datetime('now')), updated_at = datetime('now'), version = version + 1 WHERE id IN (${placeholders})`)
      .bind(...validIds)
      .run();
  } else if (action === "unpublish") {
    await env.DB
      .prepare(`UPDATE articles SET published_at = NULL, updated_at = datetime('now'), version = version + 1 WHERE id IN (${placeholders})`)
      .bind(...validIds)
      .run();
  } else if (action === "trash") {
    await env.DB
      .prepare(`UPDATE articles SET deleted_at = datetime('now'), version = version + 1 WHERE id IN (${placeholders})`)
      .bind(...validIds)
      .run();
  } else {
    throw new Error("Invalid bulk action");
  }
}

// "Delete" moves an article to the trash rather than actually removing it
// — recoverable by default. hardDeleteArticle is the real, permanent
// removal, used only from the trash view itself.
export async function deleteArticle(env, id) {
  await env.DB.prepare("UPDATE articles SET deleted_at = datetime('now'), version = version + 1 WHERE id = ?").bind(id).run();
}

export async function restoreArticle(env, id) {
  await env.DB.prepare("UPDATE articles SET deleted_at = NULL, version = version + 1 WHERE id = ?").bind(id).run();
}

export async function hardDeleteArticle(env, id) {
  await env.DB.prepare("DELETE FROM articles WHERE id = ?").bind(id).run();
}

export async function listRedirects(env) {
  const { results } = await env.DB.prepare("SELECT * FROM redirects ORDER BY from_path").all();
  return results;
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

export async function updateRedirect(env, id, fields) {
  const cols = [];
  const vals = [];
  for (const key of ["from_path", "to_path", "status_code"]) {
    if (key in fields) {
      cols.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if (!cols.length) return;
  vals.push(id);
  await env.DB.prepare(`UPDATE redirects SET ${cols.join(", ")} WHERE id = ?`).bind(...vals).run();
}

export async function deleteRedirect(env, id) {
  await env.DB.prepare("DELETE FROM redirects WHERE id = ?").bind(id).run();
}

// ---------- Find & replace ----------
// Walks page block text fields and article title/body for a literal find
// string. In preview mode (apply=false) it only reports what WOULD change;
// in apply mode it rewrites those fields. Raw HTML/customCss fields are
// deliberately excluded — a blind substring replace there is far more
// likely to corrupt markup than help.
const FIND_REPLACE_SIMPLE_KEYS = {
  heading: ["text"],
  text: ["text"],
  quote: ["text", "cite"],
  button: ["label"],
  "project-card": ["title", "description", "label"],
};

function replaceInBlockContent(type, content, find, replace) {
  let changed = false;
  const next = { ...content };
  const simpleKeys = FIND_REPLACE_SIMPLE_KEYS[type];
  if (simpleKeys) {
    for (const k of simpleKeys) {
      if (typeof next[k] === "string" && next[k].includes(find)) {
        next[k] = next[k].split(find).join(replace);
        changed = true;
      }
    }
  } else if (type === "changelog" && Array.isArray(next.entries)) {
    next.entries = next.entries.map((entry) => {
      const ne = { ...entry };
      for (const k of ["title", "description"]) {
        if (typeof ne[k] === "string" && ne[k].includes(find)) {
          ne[k] = ne[k].split(find).join(replace);
          changed = true;
        }
      }
      return ne;
    });
  } else if (type === "links" && Array.isArray(next.items)) {
    next.items = next.items.map((item) => {
      if (typeof item.label === "string" && item.label.includes(find)) {
        changed = true;
        return { ...item, label: item.label.split(find).join(replace) };
      }
      return item;
    });
  }
  return { changed, next };
}

export async function runFindReplace(env, { find, replace, apply }) {
  if (!find) throw new Error("Find text is required");
  const results = [];

  const pages = await listPages(env);
  for (const p of pages) {
    const blocks = await listBlocks(env, p.id);
    let pageSnapshotted = false;
    for (const b of blocks) {
      const { changed, next } = replaceInBlockContent(b.type, b.content || {}, find, replace);
      if (!changed) continue;
      results.push({ kind: "block", pageId: p.id, pageTitle: p.title, blockType: b.type, blockId: b.id });
      if (apply) {
        if (!pageSnapshotted) {
          await maybeSnapshotPage(env, p.id);
          pageSnapshotted = true;
        }
        await updateBlock(env, b.id, { content: next });
      }
    }
  }

  const articles = await listArticles(env);
  for (const a of articles) {
    const fields = {};
    if (typeof a.title === "string" && a.title.includes(find)) fields.title = a.title.split(find).join(replace);
    if (typeof a.body === "string" && a.body.includes(find)) fields.body = a.body.split(find).join(replace);
    if (!Object.keys(fields).length) continue;
    results.push({ kind: "article", articleId: a.id, articleTitle: a.title, fields: Object.keys(fields) });
    if (apply) {
      await snapshotArticle(env, a.id);
      await updateArticle(env, a.id, fields);
    }
  }

  return results;
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

// ---------- Custom events ----------
// Lightweight named-event tracking alongside pageviews (link clicks, theme
// toggles, etc.) — not tied to a visitor/session id, so it can only answer
// "how often did X happen", not "how many people did X".
export async function logEvent(env, { name, path, detail }) {
  await env.DB
    .prepare("INSERT INTO events (name, path, detail) VALUES (?, ?, ?)")
    .bind(String(name || "").slice(0, 100), path || null, detail ? String(detail).slice(0, 500) : null)
    .run();
}

export async function getEventCounts(env, days = 7) {
  const { results } = await env.DB
    .prepare(
      `SELECT name, COUNT(*) AS n FROM events WHERE created_at > datetime('now', '-${Math.max(1, Math.floor(days))} days')
       GROUP BY name ORDER BY n DESC LIMIT 20`
    )
    .all();
  return results;
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

export async function recordRateLimitHit(env, bucket, ip) {
  await env.DB.prepare("INSERT INTO rate_limits (bucket, ip) VALUES (?, ?)").bind(bucket, ip).run();
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

export async function listActivityLog(env, limit = 100) {
  const { results } = await env.DB
    .prepare("SELECT * FROM activity_log ORDER BY id DESC LIMIT ?")
    .bind(Math.max(1, Math.floor(limit)))
    .all();
  return results;
}

// ---------- Media metadata ----------
// R2 holds the actual files; this table is a thin metadata layer on top
// (folder, tags, a default alt text) keyed by the R2 object key. A file can
// exist in R2 with no row here (never tagged/foldered) — treated as
// folder=null, tags=[], alt_text=null.
export async function getMediaMeta(env, keys) {
  if (!keys.length) return {};
  const placeholders = keys.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`SELECT * FROM media WHERE key IN (${placeholders})`).bind(...keys).all();
  const map = {};
  for (const row of results) {
    map[row.key] = { ...row, tags: JSON.parse(row.tags || "[]") };
  }
  return map;
}

export async function upsertMediaMeta(env, key, { folder, tags, alt_text } = {}) {
  const existing = await env.DB.prepare("SELECT key FROM media WHERE key = ?").bind(key).first();
  if (existing) {
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
    if (!cols.length) return;
    vals.push(key);
    await env.DB.prepare(`UPDATE media SET ${cols.join(", ")} WHERE key = ?`).bind(...vals).run();
  } else {
    await env.DB
      .prepare("INSERT INTO media (key, folder, tags, alt_text) VALUES (?, ?, ?, ?)")
      .bind(key, folder || null, JSON.stringify(Array.isArray(tags) ? tags : []), alt_text || null)
      .run();
  }
}

export async function deleteMediaMeta(env, key) {
  await env.DB.prepare("DELETE FROM media WHERE key = ?").bind(key).run();
}

export async function listMediaFolders(env) {
  const { results } = await env.DB.prepare("SELECT DISTINCT folder FROM media WHERE folder IS NOT NULL ORDER BY folder").all();
  return results.map((r) => r.folder);
}

// Walks every page block and article/setting field that can hold a media
// URL, for "where is this used?" before someone deletes a file.
export async function findMediaUsage(env, mediaUrl) {
  const pages = await listPages(env);
  const pageBlocks = await Promise.all(pages.map((p) => listBlocks(env, p.id)));
  const articles = await listArticles(env);
  const usage = [];
  pages.forEach((p, i) => {
    if (p.og_image === mediaUrl) usage.push({ type: "Page share image", title: p.title });
    for (const b of pageBlocks[i]) {
      const c = b.content || {};
      const style = b.style || {};
      if (b.type === "image" && c.url === mediaUrl) usage.push({ type: "Image block", title: p.title });
      if (b.type === "gallery" && Array.isArray(c.images) && c.images.includes(mediaUrl)) {
        usage.push({ type: "Gallery block", title: p.title });
      }
      if (style.backgroundImage === mediaUrl) usage.push({ type: "Block background", title: p.title });
    }
  });
  for (const a of articles) {
    if (a.og_image === mediaUrl) usage.push({ type: "Article share image", title: a.title });
  }
  const defaultOg = await getSetting(env, "default_og_image");
  if (defaultOg === mediaUrl) usage.push({ type: "Site default share image", title: null });
  return usage;
}

// ---------- 3D scans ----------
// The actual .glb/.usdz/poster files live in R2 under "scans/"; this table
// is the metadata + default camera view for each one, parallel to how
// simulations and media work.
export async function listScans(env) {
  const { results } = await env.DB.prepare("SELECT * FROM scans ORDER BY name").all();
  return results;
}

export async function getScan(env, id) {
  return env.DB.prepare("SELECT * FROM scans WHERE id = ?").bind(id).first();
}

export async function createScan(env, { name, glb_key, usdz_key, poster_key, camera_orbit, camera_target, field_of_view, size }) {
  const res = await env.DB
    .prepare(
      `INSERT INTO scans (name, glb_key, usdz_key, poster_key, camera_orbit, camera_target, field_of_view, size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(name, glb_key, usdz_key || null, poster_key || null, camera_orbit || null, camera_target || null, field_of_view || null, size || 0)
    .run();
  return res.meta.last_row_id;
}

export async function updateScan(env, id, fields) {
  const cols = [];
  const vals = [];
  for (const key of ["name", "glb_key", "usdz_key", "poster_key", "camera_orbit", "camera_target", "field_of_view", "size"]) {
    if (key in fields) {
      cols.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if (!cols.length) return;
  cols.push("updated_at = datetime('now')");
  vals.push(id);
  await env.DB.prepare(`UPDATE scans SET ${cols.join(", ")} WHERE id = ?`).bind(...vals).run();
}

export async function deleteScan(env, id) {
  await env.DB.prepare("DELETE FROM scans WHERE id = ?").bind(id).run();
}

// Which pages currently embed this scan via a "scan" block — same idea as
// findMediaUsage, so deleting a scan a page depends on isn't a silent trap.
export async function findScanUsage(env, scanId) {
  const pages = await listPages(env);
  const pageBlocks = await Promise.all(pages.map((p) => listBlocks(env, p.id)));
  const usage = [];
  pages.forEach((p, i) => {
    for (const b of pageBlocks[i]) {
      if (b.type === "scan" && Number((b.content || {}).scan_id) === Number(scanId)) {
        usage.push({ type: "3D Scan block", title: p.title });
      }
    }
  });
  return usage;
}

// ---------- Templates ----------
// A saved starting point — a page's block layout, or an article body — that
// new pages/articles can be seeded from instead of starting blank.
export async function listTemplates(env, kind) {
  const { results } = await env.DB.prepare("SELECT * FROM templates WHERE kind = ? ORDER BY name").bind(kind).all();
  return results.map((t) => ({ ...t, data: JSON.parse(t.data || "{}") }));
}

export async function createTemplate(env, { kind, name, data }) {
  const res = await env.DB
    .prepare("INSERT INTO templates (kind, name, data) VALUES (?, ?, ?)")
    .bind(kind, name, JSON.stringify(data || {}))
    .run();
  return res.meta.last_row_id;
}

export async function getTemplate(env, id) {
  const row = await env.DB.prepare("SELECT * FROM templates WHERE id = ?").bind(id).first();
  if (!row) return null;
  return { ...row, data: JSON.parse(row.data || "{}") };
}

export async function deleteTemplate(env, id) {
  await env.DB.prepare("DELETE FROM templates WHERE id = ?").bind(id).run();
}

// ---------- Simulations ----------
export async function listSimulations(env) {
  const { results } = await env.DB.prepare("SELECT id, name, updated_at FROM simulations ORDER BY name").all();
  return results;
}

export async function getSimulation(env, id) {
  const row = await env.DB.prepare("SELECT * FROM simulations WHERE id = ?").bind(id).first();
  if (!row) return null;
  return { ...row, data: JSON.parse(row.data || "{}") };
}

export async function createSimulation(env, { name, data }) {
  const res = await env.DB
    .prepare("INSERT INTO simulations (name, data) VALUES (?, ?)")
    .bind(name, JSON.stringify(data || {}))
    .run();
  return res.meta.last_row_id;
}

export async function updateSimulation(env, id, { name, data }) {
  await env.DB
    .prepare("UPDATE simulations SET name = ?, data = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(name, JSON.stringify(data || {}), id)
    .run();
}

export async function deleteSimulation(env, id) {
  await env.DB.prepare("DELETE FROM simulations WHERE id = ?").bind(id).run();
}

export async function duplicateSimulation(env, id) {
  const source = await getSimulation(env, id);
  if (!source) return null;
  return createSimulation(env, { name: `${source.name} (copy)`, data: source.data });
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
          `INSERT INTO blocks (id, page_id, type, content, style, col, col_span, row, row_span, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(b.id, pageId, b.type, b.content, b.style, b.col, b.col_span, b.row, b.row_span, b.updated_at)
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
      `INSERT INTO blocks (id, page_id, type, content, style, col, col_span, row, row_span, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type, content = excluded.content, style = excluded.style,
         col = excluded.col, col_span = excluded.col_span, row = excluded.row, row_span = excluded.row_span,
         updated_at = excluded.updated_at`
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
      oldBlock.row_span
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

// ---------- Search ----------
export async function search(env, q) {
  const like = `%${escapeLike(q)}%`;
  const [pages, articles, blocks] = await Promise.all([
    env.DB
      .prepare(
        "SELECT id, slug, title FROM pages WHERE title LIKE ? ESCAPE '\\' OR meta_description LIKE ? ESCAPE '\\' OR nav_label LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\' LIMIT 15"
      )
      .bind(like, like, like, like)
      .all(),
    env.DB
      .prepare(
        "SELECT id, slug, title FROM articles WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\' LIMIT 15"
      )
      .bind(like, like, like, like)
      .all(),
    env.DB.prepare("SELECT id, page_id, type FROM blocks WHERE content LIKE ? ESCAPE '\\' LIMIT 15").bind(like).all(),
  ]);
  return { pages: pages.results, articles: articles.results, blocks: blocks.results };
}

// Public-facing search: only live pages and published articles, unlike the
// admin command palette's search() above which intentionally sees everything.
export async function publicSearch(env, q) {
  const like = `%${escapeLike(q)}%`;
  const [pages, articles] = await Promise.all([
    env.DB
      .prepare(
        "SELECT id, slug, title, meta_description FROM pages WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR meta_description LIKE ? ESCAPE '\\') ORDER BY title LIMIT 20"
      )
      .bind(like, like)
      .all(),
    env.DB
      .prepare(
        `SELECT id, slug, title, body, tags, published_at FROM articles
         WHERE deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= ?
         AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')
         ORDER BY published_at DESC LIMIT 20`
      )
      .bind(new Date().toISOString(), like, like, like)
      .all(),
  ]);
  return { pages: pages.results, articles: articles.results.map(parseArticleRow) };
}

// Related posts for an article: prefers shared tags (most overlap first,
// ties broken by recency), falls back to just-recent when nothing shares a
// tag — so the section never comes up empty for an untagged post.
export async function getRelatedArticles(env, article, limit = 3) {
  const candidates = await listArticles(env, { publishedOnly: true });
  const others = candidates.filter((a) => a.id !== article.id);
  if (!article.tags || !article.tags.length) return others.slice(0, limit);
  const scored = others
    .map((a) => ({ a, score: a.tags.filter((t) => article.tags.includes(t)).length }))
    .sort((x, y) => y.score - x.score);
  if (scored[0] && scored[0].score > 0) {
    return scored.filter((s) => s.score > 0).slice(0, limit).map((s) => s.a);
  }
  return others.slice(0, limit);
}

export async function getSetting(env, key) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return row ? row.value : null;
}

const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_ATTEMPTS = 8;

// Returns true if this IP is currently allowed to attempt a login.
export async function checkLoginRateLimit(env, ip) {
  const { results } = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND attempted_at > datetime('now', '-${LOGIN_WINDOW_MINUTES} minutes')`
    )
    .bind(ip)
    .all();
  return (results[0]?.n || 0) < LOGIN_MAX_ATTEMPTS;
}

export async function recordLoginAttempt(env, ip) {
  await env.DB.prepare("INSERT INTO login_attempts (ip) VALUES (?)").bind(ip).run();
  // Best-effort cleanup so the table doesn't grow forever; cheap since it's indexed.
  await env.DB
    .prepare(`DELETE FROM login_attempts WHERE attempted_at < datetime('now', '-1 day')`)
    .run()
    .catch(() => {});
}

export async function recordPageview(env, { path, referrer, country }) {
  await env.DB
    .prepare("INSERT INTO pageviews (path, referrer, country) VALUES (?, ?, ?)")
    .bind(path, referrer || null, country || null)
    .run();
}

export async function getAnalytics(env, days = 7) {
  const since = `datetime('now', '-${Math.max(1, Math.floor(days))} days')`;

  const [totalsRow, byDay, topPaths, topReferrers, topCountries, topEvents] = await Promise.all([
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM pageviews WHERE created_at > datetime('now', '-5 minutes')) AS activeNow,
         (SELECT COUNT(*) FROM pageviews WHERE created_at > datetime('now', '-1 days')) AS today,
         (SELECT COUNT(*) FROM pageviews WHERE created_at > datetime('now', '-7 days')) AS last7,
         (SELECT COUNT(*) FROM pageviews WHERE created_at > datetime('now', '-30 days')) AS last30,
         (SELECT COUNT(*) FROM pageviews) AS allTime`
    ).first(),
    env.DB
      .prepare(
        `SELECT date(created_at) AS day, COUNT(*) AS n FROM pageviews
         WHERE created_at > ${since} GROUP BY day ORDER BY day ASC`
      )
      .all(),
    env.DB
      .prepare(
        `SELECT path, COUNT(*) AS n FROM pageviews
         WHERE created_at > ${since} GROUP BY path ORDER BY n DESC LIMIT 10`
      )
      .all(),
    env.DB
      .prepare(
        `SELECT COALESCE(referrer, '(direct)') AS referrer, COUNT(*) AS n FROM pageviews
         WHERE created_at > ${since} GROUP BY referrer ORDER BY n DESC LIMIT 10`
      )
      .all(),
    env.DB
      .prepare(
        `SELECT COALESCE(country, '?') AS country, COUNT(*) AS n FROM pageviews
         WHERE created_at > ${since} GROUP BY country ORDER BY n DESC LIMIT 10`
      )
      .all(),
    getEventCounts(env, days),
  ]);

  return {
    activeNow: totalsRow?.activeNow || 0,
    today: totalsRow?.today || 0,
    last7: totalsRow?.last7 || 0,
    last30: totalsRow?.last30 || 0,
    allTime: totalsRow?.allTime || 0,
    byDay: byDay.results,
    topPaths: topPaths.results,
    topReferrers: topReferrers.results,
    topCountries: topCountries.results,
    topEvents,
  };
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

export async function exportAll(env) {
  const [pages, blocks, articles, settings, redirects, templates, media, scans] = await Promise.all([
    env.DB.prepare("SELECT * FROM pages ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM blocks ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM articles ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM settings ORDER BY key").all(),
    env.DB.prepare("SELECT * FROM redirects ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM templates ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM media ORDER BY key").all(),
    env.DB.prepare("SELECT * FROM scans ORDER BY id").all(),
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

export async function runScheduledBackup(env) {
  const data = await exportAll(env);
  const key = `${BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await env.MEDIA.put(key, JSON.stringify(data), { httpMetadata: { contentType: "application/json" } });
  const listed = await env.MEDIA.list({ prefix: BACKUP_PREFIX });
  const sorted = listed.objects.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
  const stale = sorted.slice(BACKUP_KEEP);
  await Promise.all(stale.map((o) => env.MEDIA.delete(o.key)));
  return key;
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
  const { pages, blocks, articles, settings, redirects = [], templates = [], media = [], scans = [] } = data;
  if (
    !Array.isArray(pages) ||
    !Array.isArray(blocks) ||
    !Array.isArray(articles) ||
    !Array.isArray(settings) ||
    !Array.isArray(redirects) ||
    !Array.isArray(templates) ||
    !Array.isArray(media) ||
    !Array.isArray(scans)
  ) {
    throw new Error("This doesn't look like a dominickdominick backup file (missing pages/blocks/articles/settings)");
  }

  const stmts = [
    env.DB.prepare("DELETE FROM blocks"),
    env.DB.prepare("DELETE FROM pages"),
    env.DB.prepare("DELETE FROM articles"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("DELETE FROM redirects"),
    env.DB.prepare("DELETE FROM templates"),
    env.DB.prepare("DELETE FROM media"),
    env.DB.prepare("DELETE FROM scans"),
  ];

  for (const p of pages) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO pages (id, slug, title, meta_description, nav_label, nav_order, og_image, deleted_at, created_at, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          p.id,
          p.slug,
          p.title,
          p.meta_description ?? "",
          p.nav_label ?? null,
          p.nav_order ?? null,
          p.og_image ?? null,
          p.deleted_at ?? null,
          p.created_at,
          p.updated_at,
          p.version ?? 1
        )
    );
  }

  for (const b of blocks) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO blocks (id, page_id, type, content, style, col, col_span, row, row_span, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          b.updated_at
        )
    );
  }

  for (const a of articles) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO articles (id, slug, title, body, tags, og_image, published_at, deleted_at, series, series_order, co_authors, created_at, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          a.id,
          a.slug,
          a.title,
          a.body ?? "",
          a.tags ?? "[]",
          a.og_image ?? null,
          a.published_at ?? null,
          a.deleted_at ?? null,
          a.series ?? null,
          a.series_order ?? null,
          a.co_authors ?? "[]",
          a.created_at,
          a.updated_at,
          a.version ?? 1
        )
    );
  }

  for (const s of settings) {
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
        .prepare("INSERT INTO media (key, folder, tags, alt_text, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(m.key, m.folder ?? null, m.tags ?? "[]", m.alt_text ?? null, m.created_at)
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

  // .batch() runs everything as one atomic transaction — either it all
  // lands, or (on any failure) none of it does, so a bad file can't leave
  // the site half-wiped.
  await env.DB.batch(stmts);
}

// ---------- Link checker ----------
// Walks every button/project-card link and every article body link, and
// checks each one: internal paths (starting with "/") are checked against
// known pages/articles/redirects (no network call); external links get a
// live HEAD/GET request with a short timeout.

async function checkOneLink(env, rawUrl) {
  if (!rawUrl) return { ok: null, status: "Empty" };
  if (rawUrl.startsWith("/")) {
    if (rawUrl === "/" || (await getPageBySlug(env, rawUrl.replace(/^\/+/, "").replace(/\/+$/, "") || "home"))) {
      return { ok: true, status: "OK" };
    }
    const articleMatch = rawUrl.match(/^\/random\/([a-z0-9-]+)$/);
    if (articleMatch) {
      const article = await getArticleBySlug(env, articleMatch[1]);
      if (article) return { ok: true, status: "OK" };
    }
    const redirect = await getRedirect(env, rawUrl);
    if (redirect) return { ok: true, status: `Redirects to ${redirect.to_path}` };
    return { ok: false, status: "Not found" };
  }
  if (!/^https?:\/\//i.test(rawUrl)) return { ok: null, status: "Skipped" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    let res = await fetch(rawUrl, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(rawUrl, { method: "GET", redirect: "follow", signal: controller.signal });
    }
    return { ok: res.ok, status: String(res.status) };
  } catch {
    return { ok: false, status: "Unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkLinks(env) {
  const pages = await listPages(env);
  const pageBlocks = await Promise.all(pages.map((p) => listBlocks(env, p.id)));
  const articles = await listArticles(env);

  const found = [];
  pages.forEach((p, i) => {
    for (const b of pageBlocks[i]) {
      const c = b.content || {};
      if ((b.type === "button" || b.type === "project-card") && c.url) {
        found.push({ url: c.url, source: `Page "${p.title}" — ${b.type === "button" ? "Button" : "Project Card"} block` });
      }
    }
  });
  for (const a of articles) {
    const links = [...(a.body || "").matchAll(/\[[^\]]+\]\(([^)]+)\)/g)];
    for (const m of links) found.push({ url: m[1], source: `Article "${a.title}"` });
  }

  const uniqueUrls = [...new Set(found.map((f) => f.url))];
  const statusByUrl = {};
  await Promise.all(
    uniqueUrls.map(async (u) => {
      statusByUrl[u] = await checkOneLink(env, u);
    })
  );
  return found.map((f) => ({ ...f, ...statusByUrl[f.url] }));
}
