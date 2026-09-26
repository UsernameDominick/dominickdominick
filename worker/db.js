import { toHex } from "./auth.js";

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
  "favicon.ico",
]);

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

// Nested one level deep only — a page whose own nav_parent_id is set can't
// also be a parent (enforced both here and at save time in admin-api.js),
// so there's no cycle or multi-level case to guard against when building
// the tree: every child's parent is guaranteed to already be top-level.
// Articles/Projects/Topics aren't rows in the pages table — there was no
// page a nav_label could even attach to for them — so with zero nav_label
// pages configured (the actual state until an admin sets one up), the site
// had no persistent navigation at all: no way to reach any content from
// any page. These three are prepended unconditionally as a baseline
// alongside whatever custom nav_label pages exist, rather than being the
// only way to get a working nav — an admin who does configure their own
// pages just gets them appended after these, not instead of them.
const BASELINE_NAV_ITEMS = [
  { slug: "random", nav_label: "Articles", nav_parent_id: null, children: [] },
  { slug: "projects", nav_label: "Projects", nav_parent_id: null, children: [] },
  { slug: "topics", nav_label: "Topics", nav_parent_id: null, children: [] },
];

export async function listNavPages(env) {
  const { results } = await env.DB
    .prepare(
      "SELECT id, slug, nav_label, nav_parent_id FROM pages WHERE nav_label IS NOT NULL AND deleted_at IS NULL ORDER BY nav_order ASC, id ASC"
    )
    .all();
  const topLevel = results.filter((p) => !p.nav_parent_id);
  for (const p of topLevel) {
    p.children = results.filter((c) => c.nav_parent_id === p.id);
  }
  // Baseline items used to be prepended unconditionally, so a site that
  // also had its own "projects"/"random" nav pages (the live site does)
  // showed "Articles · Projects · Topics · Home · Projects · Random" --
  // duplicate entries, Home stuck in the middle, and two items lit up as
  // active at once. The admin's own nav pages now come first in their
  // chosen order, and a baseline item is only added if no nav page
  // already links to the same place (the admin's label wins).
  const taken = new Set(results.map((p) => p.slug));
  return [...topLevel, ...BASELINE_NAV_ITEMS.filter((item) => !taken.has(item.slug))];
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

// Kept separate from updatePage()'s generic field list on purpose: unlike
// every other field there, the client never gets the current value back
// (there's nothing to send — only the hash is stored), so "set" and
// "remove" have to be distinct actions rather than one field where blank
// would be ambiguous between "no change" and "remove protection".
export async function setPagePassword(env, id, passwordHash) {
  await env.DB.prepare("UPDATE pages SET password_hash = ?, updated_at = datetime('now'), version = version + 1 WHERE id = ?").bind(passwordHash, id).run();
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
  await env.DB.prepare("UPDATE pages SET nav_parent_id = NULL WHERE nav_parent_id = ?").bind(id).run();
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
  // A password-protected or sitemap-excluded source must not silently
  // become public through its copy — carry both over explicitly, since
  // createPage's field list doesn't accept them at insert time.
  if (source.password_hash || source.sitemap_exclude) {
    await env.DB
      .prepare("UPDATE pages SET password_hash = ?, sitemap_exclude = ? WHERE id = ?")
      .bind(source.password_hash || null, source.sitemap_exclude ? 1 : 0, newId)
      .run();
  }
  const blocks = await listBlocks(env, id);
  for (const b of blocks) {
    await createBlock(env, newId, b);
  }
  return newId;
}

// Mirrors duplicatePage — always lands as an unpublished draft, whatever
// the source's own publish state was, since a copy is something to edit
// before it's ready, not to immediately have live twice over.
export async function duplicateArticle(env, id) {
  const source = await env.DB.prepare("SELECT * FROM articles WHERE id = ?").bind(id).first();
  if (!source) return null;
  let slug = `${source.slug}-copy`;
  let n = 2;
  while (await slugExists(env, "articles", slug)) {
    slug = `${source.slug}-copy-${n}`;
    n++;
  }
  return createArticle(env, {
    slug,
    title: `${source.title} (copy)`,
    body: source.body,
    published: false,
    tags: JSON.parse(source.tags || "[]"),
    og_image: source.og_image,
    canonical_url: null,
    co_authors: JSON.parse(source.co_authors || "[]"),
    featured: false,
    pinned: false,
    expires_at: null,
  });
}

// Creates a project draft from an article's content — the article itself
// is left untouched (same "never delete the source" philosophy as
// duplicateArticle/duplicateProject below), so this is a one-way copy an
// admin can follow up on manually (e.g. trashing the original article)
// rather than an automatic move. Journal/BOM/relationships aren't carried
// over, matching how duplication already works for both types.
export async function convertArticleToProject(env, id) {
  const source = await env.DB.prepare("SELECT * FROM articles WHERE id = ?").bind(id).first();
  if (!source) return null;
  // Reusing the article's own slug is safe and reads naturally — pages,
  // articles, and projects each enforce slug uniqueness within their own
  // table only, not across types.
  let slug = source.slug;
  let n = 2;
  while (await slugExists(env, "projects", slug)) {
    slug = `${source.slug}-${n}`;
    n++;
  }
  return createProject(env, {
    slug,
    title: source.title,
    body: source.body,
    published: false,
    tags: JSON.parse(source.tags || "[]"),
    og_image: source.og_image,
  });
}

export async function duplicateProject(env, id) {
  const source = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!source) return null;
  let slug = `${source.slug}-copy`;
  let n = 2;
  while (await slugExists(env, "projects", slug)) {
    slug = `${source.slug}-copy-${n}`;
    n++;
  }
  return createProject(env, {
    slug,
    title: `${source.title} (copy)`,
    summary: source.summary,
    body: source.body,
    published: false,
    tags: JSON.parse(source.tags || "[]"),
    tech_stack: JSON.parse(source.tech_stack || "[]"),
    status: source.status,
    links: JSON.parse(source.links || "{}"),
    og_image: source.og_image,
    canonical_url: null,
    featured: false,
    related_articles: [],
    related_simulations: [],
    related_scans: [],
    expires_at: null,
  });
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
    const placeholders = sharedIds.map(() => "?").join(",");
    const { results: sharedRows } = await env.DB
      .prepare(`SELECT * FROM shared_blocks WHERE id IN (${placeholders})`)
      .bind(...sharedIds)
      .all();
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

// ---------- Reusable (shared) blocks ----------
// A named block "definition" a page block can point at instead of holding
// its own content — see the schema comment on shared_blocks and
// listBlocks() above for how the reference is resolved at read time.
export async function listSharedBlocks(env) {
  const { results } = await env.DB.prepare("SELECT * FROM shared_blocks ORDER BY name").all();
  return results.map((s) => ({ ...s, content: JSON.parse(s.content || "{}"), style: JSON.parse(s.style || "{}") }));
}

export async function getSharedBlock(env, id) {
  const row = await env.DB.prepare("SELECT * FROM shared_blocks WHERE id = ?").bind(id).first();
  if (!row) return null;
  return { ...row, content: JSON.parse(row.content || "{}"), style: JSON.parse(row.style || "{}") };
}

export async function createSharedBlock(env, { name, type, content, style }) {
  const res = await env.DB
    .prepare("INSERT INTO shared_blocks (name, type, content, style) VALUES (?, ?, ?, ?)")
    .bind(name, type, JSON.stringify(content || {}), JSON.stringify(style || {}))
    .run();
  return res.meta.last_row_id;
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

// blocks.shared_block_id is ON DELETE SET NULL, so every placement simply
// falls back to being an ordinary (empty) block rather than erroring —
// findSharedBlockUsage() is how the admin finds out before that happens.
export async function deleteSharedBlock(env, id) {
  await env.DB.prepare("DELETE FROM shared_blocks WHERE id = ?").bind(id).run();
}

export async function findSharedBlockUsage(env, sharedBlockId) {
  const { results } = await env.DB
    .prepare(
      `SELECT b.id as block_id, p.title as page_title FROM blocks b
       JOIN pages p ON p.id = b.page_id
       WHERE b.shared_block_id = ?`
    )
    .bind(sharedBlockId)
    .all();
  return results.map((r) => ({ type: "Reusable block", title: r.page_title }));
}

// Copies the shared definition's current content/style into this one
// placement's own row and clears the reference — it becomes an ordinary,
// independent block that no longer updates when the shared block changes.
export async function detachSharedBlock(env, blockId) {
  const sharedId = await getBlockSharedId(env, blockId);
  if (!sharedId) throw new Error("This block isn't a reusable block");
  const shared = await getSharedBlock(env, sharedId);
  if (!shared) throw new Error("Shared block not found");
  await env.DB
    .prepare("UPDATE blocks SET type = ?, content = ?, style = ?, shared_block_id = NULL, updated_at = datetime('now') WHERE id = ?")
    .bind(shared.type, JSON.stringify(shared.content), JSON.stringify(shared.style), blockId)
    .run();
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

export async function listArticles(env, { publishedOnly = false, limit = null, tag = null, featuredOnly = false } = {}) {
  let sql = "SELECT * FROM articles WHERE deleted_at IS NULL";
  const params = [];
  // "Published" means published_at is set AND not in the future — a
  // scheduled article stays hidden from public listings until its time.
  // expires_at is the mirror image: once passed, the article drops back
  // out of every publishedOnly listing (though it isn't deleted, and an
  // admin editing it directly still sees it — same as a draft would).
  if (publishedOnly) {
    const now = new Date().toISOString();
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

export const INDEX_PAGE_SIZE = 20;

// Paginated published-articles listing, backing the /random index page —
// listArticles() above only supports a flat LIMIT with no offset/total
// count, which a real "page 2 of N" listing needs.
export async function listArticlesPaged(env, { page = 1, perPage = INDEX_PAGE_SIZE } = {}) {
  const now = new Date().toISOString();
  const offset = (Math.max(1, page) - 1) * perPage;
  const [{ results }, countRow] = await Promise.all([
    env.DB
      .prepare(
        `SELECT * FROM articles WHERE deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= ? AND (expires_at IS NULL OR expires_at > ?) AND archived = 0
         ORDER BY pinned DESC, COALESCE(published_at, created_at) DESC LIMIT ? OFFSET ?`
      )
      .bind(now, now, perPage, offset)
      .all(),
    env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM articles WHERE deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= ? AND (expires_at IS NULL OR expires_at > ?) AND archived = 0`
      )
      .bind(now, now)
      .first(),
  ]);
  return { articles: results.map(parseArticleRow), totalCount: countRow?.n ?? 0 };
}

// Same as listArticlesPaged, for the /projects index page.
export async function listProjectsPaged(env, { page = 1, perPage = INDEX_PAGE_SIZE } = {}) {
  const now = new Date().toISOString();
  const offset = (Math.max(1, page) - 1) * perPage;
  const [{ results }, countRow] = await Promise.all([
    env.DB
      .prepare(
        `SELECT * FROM projects WHERE deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= ? AND (expires_at IS NULL OR expires_at > ?) AND archived = 0
         ORDER BY COALESCE(published_at, created_at) DESC LIMIT ? OFFSET ?`
      )
      .bind(now, now, perPage, offset)
      .all(),
    env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM projects WHERE deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= ? AND (expires_at IS NULL OR expires_at > ?) AND archived = 0`
      )
      .bind(now, now)
      .first(),
  ]);
  return { projects: results.map(parseProjectRow), totalCount: countRow?.n ?? 0 };
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

export async function createArticle(
  env,
  {
    slug,
    title,
    body,
    published,
    published_at,
    tags,
    og_image,
    canonical_url,
    series,
    series_order,
    co_authors,
    featured,
    pinned,
    expires_at,
    sitemap_exclude,
    archived,
    related_override,
    private_notes,
    custom_json_ld,
  }
) {
  const res = await env.DB
    .prepare(
      "INSERT INTO articles (slug, title, body, published_at, tags, og_image, canonical_url, series, series_order, co_authors, featured, pinned, expires_at, sitemap_exclude, archived, related_override, private_notes, custom_json_ld) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      slug,
      title,
      body || "",
      resolvePublishedAt({ published, published_at }),
      JSON.stringify(Array.isArray(tags) ? tags : []),
      og_image || null,
      canonical_url || null,
      series || null,
      Number.isFinite(Number(series_order)) ? Number(series_order) : null,
      JSON.stringify(Array.isArray(co_authors) ? co_authors : []),
      featured ? 1 : 0,
      pinned ? 1 : 0,
      expires_at || null,
      sitemap_exclude ? 1 : 0,
      archived ? 1 : 0,
      JSON.stringify(Array.isArray(related_override) ? related_override : []),
      private_notes || null,
      custom_json_ld || null
    )
    .run();
  return res.meta.last_row_id;
}

// tts_audio_key/hero_video store a "/media/..." URL (not a Media Library
// entry — a one-off upload the admin UI treats as a plain field, not
// something to keep around after it's replaced or removed), so deleting
// the old file on change needs the URL's own R2 key extracted back out.
async function deleteOldMediaUrl(env, url) {
  if (!url || !url.startsWith("/media/")) return;
  await env.MEDIA.delete(url.slice("/media/".length)).catch(() => {});
}

export async function updateArticle(env, id, fields) {
  const cols = [];
  const vals = [];
  for (const key of ["slug", "title", "body", "og_image", "canonical_url", "series", "correction_note", "tts_audio_key", "private_notes", "custom_json_ld"]) {
    if (key in fields) {
      cols.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  let oldTtsAudioKey;
  if ("tts_audio_key" in fields) {
    oldTtsAudioKey = (await env.DB.prepare("SELECT tts_audio_key FROM articles WHERE id = ?").bind(id).first())?.tts_audio_key;
  }
  if ("expires_at" in fields) {
    cols.push("expires_at = ?");
    vals.push(fields.expires_at || null);
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
  if ("locked" in fields) {
    cols.push("locked = ?");
    vals.push(fields.locked ? 1 : 0);
  }
  if ("featured" in fields) {
    cols.push("featured = ?");
    vals.push(fields.featured ? 1 : 0);
  }
  if ("pinned" in fields) {
    cols.push("pinned = ?");
    vals.push(fields.pinned ? 1 : 0);
  }
  if ("sitemap_exclude" in fields) {
    cols.push("sitemap_exclude = ?");
    vals.push(fields.sitemap_exclude ? 1 : 0);
  }
  if ("archived" in fields) {
    cols.push("archived = ?");
    vals.push(fields.archived ? 1 : 0);
  }
  if ("related_override" in fields) {
    cols.push("related_override = ?");
    vals.push(JSON.stringify(Array.isArray(fields.related_override) ? fields.related_override : []));
  }
  if (!cols.length) return;
  cols.push("updated_at = datetime('now')", "version = version + 1");
  vals.push(id);
  await env.DB.prepare(`UPDATE articles SET ${cols.join(", ")} WHERE id = ?`).bind(...vals).run();
  if (oldTtsAudioKey && oldTtsAudioKey !== fields.tts_audio_key) {
    await deleteOldMediaUrl(env, oldTtsAudioKey);
  }
}

// Locked articles are deliberately excluded from every bulk action — the
// whole point of locking a "finished" piece is protection against exactly
// this kind of sweep (select-all, one click) rather than a single
// deliberate edit, which still goes through updateArticle() normally.
// Returns how many were actually affected vs skipped for being locked, so
// the admin isn't left wondering why a locked item didn't move.
// Shared by bulkArticleAction/bulkProjectAction — adding a tag reads each
// affected row's own tags array (can't do a set-union in raw SQL against a
// JSON text column) and writes back only the ones that didn't already have it.
// A near-empty body shouldn't be publishable through any path — single-item
// create/update in admin-api.js and the bulk "Publish" action below both
// enforce this same floor.
export const MIN_PUBLISH_BODY_LENGTH = 50;
export function publishBodyTooShort(effectiveBody) {
  return !effectiveBody || effectiveBody.trim().length <= MIN_PUBLISH_BODY_LENGTH;
}

async function bulkAddTag(env, table, affectedIds, tag) {
  const placeholders = affectedIds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`SELECT id, tags FROM ${table} WHERE id IN (${placeholders})`).bind(...affectedIds).all();
  const updates = results
    .map((r) => {
      const tags = JSON.parse(r.tags || "[]");
      if (tags.includes(tag)) return null;
      return { id: r.id, tags: JSON.stringify([...tags, tag]) };
    })
    .filter(Boolean);
  await Promise.all(
    updates.map((u) =>
      env.DB.prepare(`UPDATE ${table} SET tags = ?, updated_at = datetime('now'), version = version + 1 WHERE id = ?`).bind(u.tags, u.id).run()
    )
  );
}

export async function bulkArticleAction(env, ids, action, opts = {}) {
  const validIds = ids.map(Number).filter(Number.isFinite);
  if (!validIds.length) return { affected: 0, skippedLocked: 0 };
  const placeholders = validIds.map(() => "?").join(",");
  const lockedRows = await env.DB
    .prepare(`SELECT id FROM articles WHERE id IN (${placeholders}) AND locked = 1`)
    .bind(...validIds)
    .all();
  const skippedLocked = lockedRows.results.length;
  const affectedIds = validIds.filter((id) => !lockedRows.results.some((r) => r.id === id));
  if (!affectedIds.length) return { affected: 0, skippedLocked };
  const affectedPlaceholders = affectedIds.map(() => "?").join(",");
  let skippedTooShort = 0;
  if (action === "publish") {
    // The single-item PUT/PATCH routes in admin-api.js reject publishing a
    // near-empty body — bulk "Publish" is just another way to set
    // published_at, so it needs the same floor, or it's a one-click way
    // around a check that exists specifically to stop that.
    const rows = await env.DB
      .prepare(`SELECT id, published_at, body FROM articles WHERE id IN (${affectedPlaceholders})`)
      .bind(...affectedIds)
      .all();
    const toPublish = rows.results.filter((r) => r.published_at || !publishBodyTooShort(r.body)).map((r) => r.id);
    skippedTooShort = affectedIds.length - toPublish.length;
    if (toPublish.length) {
      const publishPlaceholders = toPublish.map(() => "?").join(",");
      await env.DB
        .prepare(`UPDATE articles SET published_at = COALESCE(published_at, datetime('now')), updated_at = datetime('now'), version = version + 1 WHERE id IN (${publishPlaceholders})`)
        .bind(...toPublish)
        .run();
    }
  } else if (action === "unpublish") {
    await env.DB
      .prepare(`UPDATE articles SET published_at = NULL, updated_at = datetime('now'), version = version + 1 WHERE id IN (${affectedPlaceholders})`)
      .bind(...affectedIds)
      .run();
  } else if (action === "trash") {
    await env.DB
      .prepare(`UPDATE articles SET deleted_at = datetime('now'), version = version + 1 WHERE id IN (${affectedPlaceholders})`)
      .bind(...affectedIds)
      .run();
  } else if (action === "add-tag") {
    if (!opts.tag) throw new Error("Tag required");
    await bulkAddTag(env, "articles", affectedIds, opts.tag);
  } else {
    throw new Error("Invalid bulk action");
  }
  return { affected: affectedIds.length - skippedTooShort, skippedLocked, skippedTooShort };
}

export async function bulkProjectAction(env, ids, action, opts = {}) {
  const validIds = ids.map(Number).filter(Number.isFinite);
  if (!validIds.length) return { affected: 0, skippedLocked: 0 };
  const placeholders = validIds.map(() => "?").join(",");
  const lockedRows = await env.DB
    .prepare(`SELECT id FROM projects WHERE id IN (${placeholders}) AND locked = 1`)
    .bind(...validIds)
    .all();
  const skippedLocked = lockedRows.results.length;
  const affectedIds = validIds.filter((id) => !lockedRows.results.some((r) => r.id === id));
  if (!affectedIds.length) return { affected: 0, skippedLocked };
  const affectedPlaceholders = affectedIds.map(() => "?").join(",");
  let skippedTooShort = 0;
  if (action === "publish") {
    const rows = await env.DB
      .prepare(`SELECT id, published_at, body FROM projects WHERE id IN (${affectedPlaceholders})`)
      .bind(...affectedIds)
      .all();
    const toPublish = rows.results.filter((r) => r.published_at || !publishBodyTooShort(r.body)).map((r) => r.id);
    skippedTooShort = affectedIds.length - toPublish.length;
    if (toPublish.length) {
      const publishPlaceholders = toPublish.map(() => "?").join(",");
      await env.DB
        .prepare(`UPDATE projects SET published_at = COALESCE(published_at, datetime('now')), updated_at = datetime('now'), version = version + 1 WHERE id IN (${publishPlaceholders})`)
        .bind(...toPublish)
        .run();
    }
  } else if (action === "unpublish") {
    await env.DB
      .prepare(`UPDATE projects SET published_at = NULL, updated_at = datetime('now'), version = version + 1 WHERE id IN (${affectedPlaceholders})`)
      .bind(...affectedIds)
      .run();
  } else if (action === "trash") {
    await env.DB
      .prepare(`UPDATE projects SET deleted_at = datetime('now'), version = version + 1 WHERE id IN (${affectedPlaceholders})`)
      .bind(...affectedIds)
      .run();
  } else if (action === "add-tag") {
    if (!opts.tag) throw new Error("Tag required");
    await bulkAddTag(env, "projects", affectedIds, opts.tag);
  } else {
    throw new Error("Invalid bulk action");
  }
  return { affected: affectedIds.length - skippedTooShort, skippedLocked, skippedTooShort };
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
  let related_override = [];
  try {
    related_override = JSON.parse(row.related_override || "[]");
  } catch {
    related_override = [];
  }
  return { ...row, tags, tech_stack, links, related_articles, related_simulations, related_scans, related_override };
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

export async function listProjects(env, { publishedOnly = false, limit = null, tag = null, featuredOnly = false, sort = "newest" } = {}) {
  let sql = "SELECT * FROM projects WHERE deleted_at IS NULL";
  const params = [];
  if (publishedOnly) {
    const now = new Date().toISOString();
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

export async function listTrashedProjects(env) {
  const { results } = await env.DB
    .prepare("SELECT * FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC")
    .all();
  return results.map(parseProjectRow);
}

export async function getProjectBySlug(env, slug) {
  const row = await env.DB.prepare("SELECT * FROM projects WHERE slug = ? AND deleted_at IS NULL").bind(slug).first();
  return parseProjectRow(row);
}

export async function createProject(
  env,
  {
    slug,
    title,
    summary,
    body,
    published,
    published_at,
    tags,
    tech_stack,
    status,
    links,
    og_image,
    canonical_url,
    featured,
    related_articles,
    related_simulations,
    related_scans,
    expires_at,
    sitemap_exclude,
    archived,
    related_override,
    featured_order,
    private_notes,
    sort_order,
    hero_video,
    custom_json_ld,
  }
) {
  const res = await env.DB
    .prepare(
      `INSERT INTO projects (slug, title, summary, body, published_at, tags, tech_stack, status, links, og_image, canonical_url, featured, related_articles, related_simulations, related_scans, expires_at, sitemap_exclude, archived, related_override, featured_order, private_notes, sort_order, hero_video, custom_json_ld)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      slug,
      title,
      summary || "",
      body || "",
      resolvePublishedAt({ published, published_at }),
      JSON.stringify(Array.isArray(tags) ? tags : []),
      JSON.stringify(Array.isArray(tech_stack) ? tech_stack : []),
      status || null,
      JSON.stringify(links && typeof links === "object" ? links : {}),
      og_image || null,
      canonical_url || null,
      featured ? 1 : 0,
      JSON.stringify(Array.isArray(related_articles) ? related_articles : []),
      JSON.stringify(Array.isArray(related_simulations) ? related_simulations : []),
      JSON.stringify(Array.isArray(related_scans) ? related_scans : []),
      expires_at || null,
      sitemap_exclude ? 1 : 0,
      archived ? 1 : 0,
      JSON.stringify(Array.isArray(related_override) ? related_override : []),
      Number.isFinite(Number(featured_order)) ? Number(featured_order) : null,
      private_notes || null,
      Number.isFinite(Number(sort_order)) ? Number(sort_order) : null,
      hero_video || null,
      custom_json_ld || null
    )
    .run();
  return res.meta.last_row_id;
}

export async function updateProject(env, id, fields) {
  const cols = [];
  const vals = [];
  for (const key of ["slug", "title", "summary", "body", "og_image", "canonical_url", "status", "correction_note", "tts_audio_key", "private_notes", "hero_video", "custom_json_ld"]) {
    if (key in fields) {
      cols.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  let oldMedia;
  if ("tts_audio_key" in fields || "hero_video" in fields) {
    oldMedia = await env.DB.prepare("SELECT tts_audio_key, hero_video FROM projects WHERE id = ?").bind(id).first();
  }
  if ("tags" in fields) {
    cols.push("tags = ?");
    vals.push(JSON.stringify(Array.isArray(fields.tags) ? fields.tags : []));
  }
  if ("tech_stack" in fields) {
    cols.push("tech_stack = ?");
    vals.push(JSON.stringify(Array.isArray(fields.tech_stack) ? fields.tech_stack : []));
  }
  if ("links" in fields) {
    cols.push("links = ?");
    vals.push(JSON.stringify(fields.links && typeof fields.links === "object" ? fields.links : {}));
  }
  if ("published_at" in fields || "published" in fields) {
    cols.push("published_at = ?");
    vals.push(resolvePublishedAt(fields));
  }
  if ("expires_at" in fields) {
    cols.push("expires_at = ?");
    vals.push(fields.expires_at || null);
  }
  if ("locked" in fields) {
    cols.push("locked = ?");
    vals.push(fields.locked ? 1 : 0);
  }
  if ("featured" in fields) {
    cols.push("featured = ?");
    vals.push(fields.featured ? 1 : 0);
  }
  if ("related_articles" in fields) {
    cols.push("related_articles = ?");
    vals.push(JSON.stringify(Array.isArray(fields.related_articles) ? fields.related_articles : []));
  }
  if ("related_simulations" in fields) {
    cols.push("related_simulations = ?");
    vals.push(JSON.stringify(Array.isArray(fields.related_simulations) ? fields.related_simulations : []));
  }
  if ("related_scans" in fields) {
    cols.push("related_scans = ?");
    vals.push(JSON.stringify(Array.isArray(fields.related_scans) ? fields.related_scans : []));
  }
  if ("sitemap_exclude" in fields) {
    cols.push("sitemap_exclude = ?");
    vals.push(fields.sitemap_exclude ? 1 : 0);
  }
  if ("archived" in fields) {
    cols.push("archived = ?");
    vals.push(fields.archived ? 1 : 0);
  }
  if ("featured_order" in fields) {
    cols.push("featured_order = ?");
    vals.push(fields.featured_order === null || fields.featured_order === "" ? null : Number(fields.featured_order));
  }
  if ("sort_order" in fields) {
    cols.push("sort_order = ?");
    vals.push(fields.sort_order === null || fields.sort_order === "" ? null : Number(fields.sort_order));
  }
  if ("related_override" in fields) {
    cols.push("related_override = ?");
    vals.push(JSON.stringify(Array.isArray(fields.related_override) ? fields.related_override : []));
  }
  if (!cols.length) return;
  cols.push("updated_at = datetime('now')", "version = version + 1");
  vals.push(id);
  await env.DB.prepare(`UPDATE projects SET ${cols.join(", ")} WHERE id = ?`).bind(...vals).run();
  if ("tts_audio_key" in fields && oldMedia?.tts_audio_key && oldMedia.tts_audio_key !== fields.tts_audio_key) {
    await deleteOldMediaUrl(env, oldMedia.tts_audio_key);
  }
  if ("hero_video" in fields && oldMedia?.hero_video && oldMedia.hero_video !== fields.hero_video) {
    await deleteOldMediaUrl(env, oldMedia.hero_video);
  }
}

export async function deleteProject(env, id) {
  await env.DB.prepare("UPDATE projects SET deleted_at = datetime('now'), version = version + 1 WHERE id = ?").bind(id).run();
}

export async function restoreProject(env, id) {
  await env.DB.prepare("UPDATE projects SET deleted_at = NULL, version = version + 1 WHERE id = ?").bind(id).run();
}

export async function hardDeleteProject(env, id) {
  await env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
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
}

// ---------- Build journal entries ----------
// Dated entries attached to a project — also covers decision logs and
// failed-attempt records (just a different entry_type) and test records
// (expected/actual results go straight in the markdown-lite body).
const JOURNAL_ENTRY_TYPES = new Set(["log", "test", "decision", "failed"]);

export async function listJournalEntries(env, projectId, { order = "DESC" } = {}) {
  const dir = order === "ASC" ? "ASC" : "DESC";
  const { results } = await env.DB
    .prepare(`SELECT * FROM journal_entries WHERE project_id = ? ORDER BY entry_date ${dir}, id ${dir}`)
    .bind(projectId)
    .all();
  return results;
}

export async function createJournalEntry(env, projectId, { entry_date, title, body, entry_type }) {
  const res = await env.DB
    .prepare("INSERT INTO journal_entries (project_id, entry_date, title, body, entry_type) VALUES (?, ?, ?, ?, ?)")
    .bind(
      projectId,
      entry_date || new Date().toISOString().slice(0, 10),
      title || "",
      body || "",
      JOURNAL_ENTRY_TYPES.has(entry_type) ? entry_type : "log"
    )
    .run();
  return res.meta.last_row_id;
}

export async function updateJournalEntry(env, id, fields) {
  const cols = [];
  const vals = [];
  for (const key of ["entry_date", "title", "body"]) {
    if (key in fields) {
      cols.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if ("entry_type" in fields) {
    cols.push("entry_type = ?");
    vals.push(JOURNAL_ENTRY_TYPES.has(fields.entry_type) ? fields.entry_type : "log");
  }
  if (!cols.length) return;
  cols.push("updated_at = datetime('now')");
  vals.push(id);
  await env.DB.prepare(`UPDATE journal_entries SET ${cols.join(", ")} WHERE id = ?`).bind(...vals).run();
}

export async function deleteJournalEntry(env, id) {
  await env.DB.prepare("DELETE FROM journal_entries WHERE id = ?").bind(id).run();
}

// ---------- Bill of materials ----------
// quantity/price are real numbers (not free text) specifically so the
// public page can compute a total build cost.
export async function listBomItems(env, projectId) {
  const { results } = await env.DB.prepare("SELECT * FROM bom_items WHERE project_id = ? ORDER BY id ASC").bind(projectId).all();
  return results;
}

export async function createBomItem(env, projectId, { item, quantity, price, link, substitution }) {
  const res = await env.DB
    .prepare("INSERT INTO bom_items (project_id, item, quantity, price, link, substitution) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(
      projectId,
      item || "",
      quantity === null || quantity === undefined || quantity === "" ? 1 : Number.isFinite(Number(quantity)) ? Number(quantity) : 1,
      price === null || price === undefined || price === "" ? null : Number.isFinite(Number(price)) ? Number(price) : null,
      link || null,
      substitution || null
    )
    .run();
  return res.meta.last_row_id;
}

export async function updateBomItem(env, id, fields) {
  const cols = [];
  const vals = [];
  for (const key of ["item", "link", "substitution"]) {
    if (key in fields) {
      cols.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if ("quantity" in fields) {
    cols.push("quantity = ?");
    vals.push(
      fields.quantity === null || fields.quantity === "" ? 1 : Number.isFinite(Number(fields.quantity)) ? Number(fields.quantity) : 1
    );
  }
  if ("price" in fields) {
    cols.push("price = ?");
    vals.push(fields.price === null || fields.price === "" ? null : Number.isFinite(Number(fields.price)) ? Number(fields.price) : null);
  }
  if (!cols.length) return;
  cols.push("updated_at = datetime('now')");
  vals.push(id);
  await env.DB.prepare(`UPDATE bom_items SET ${cols.join(", ")} WHERE id = ?`).bind(...vals).run();
}

export async function deleteBomItem(env, id) {
  await env.DB.prepare("DELETE FROM bom_items WHERE id = ?").bind(id).run();
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
    if (p.locked) continue; // a "finished" page is protected from this exact kind of sweep
    const blocks = await listBlocks(env, p.id);
    let pageSnapshotted = false;
    for (const b of blocks) {
      if (b.locked) continue; // a locked block is protected from this exact kind of sweep too
      const { changed, next } = replaceInBlockContent(b.type, b.content || {}, find, replace);
      if (!changed) continue;
      results.push({ kind: "block", pageId: p.id, pageTitle: p.title, blockType: b.type, blockId: b.id });
      if (apply) {
        if (!pageSnapshotted) {
          await maybeSnapshotPage(env, p.id);
          pageSnapshotted = true;
        }
        // A reusable block's content lives on shared_blocks, not this
        // placement's own (ignored) row — see listBlocks() above. Writing
        // to updateBlock() here would silently have no visible effect.
        if (b.shared_block_id) await updateSharedBlock(env, b.shared_block_id, { content: next });
        else await updateBlock(env, b.id, { content: next });
      }
    }
  }

  const articles = await listArticles(env);
  for (const a of articles) {
    if (a.locked) continue;
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

  // A project's title/summary/body are exactly as user-facing as an
  // article's title/body, but this sweep only ever covered articles —
  // an admin doing a sitewide rename would silently miss every project.
  const projects = await listProjects(env);
  for (const p of projects) {
    if (p.locked) continue;
    const fields = {};
    if (typeof p.title === "string" && p.title.includes(find)) fields.title = p.title.split(find).join(replace);
    if (typeof p.summary === "string" && p.summary.includes(find)) fields.summary = p.summary.split(find).join(replace);
    if (typeof p.body === "string" && p.body.includes(find)) fields.body = p.body.split(find).join(replace);
    if (!Object.keys(fields).length) continue;
    results.push({ kind: "project", projectId: p.id, projectTitle: p.title, fields: Object.keys(fields) });
    if (apply) {
      await snapshotProject(env, p.id);
      await updateProject(env, p.id, fields);
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

export async function listWebhookDeliveries(env, limit = 30) {
  const { results } = await env.DB
    .prepare("SELECT * FROM webhook_deliveries ORDER BY id DESC LIMIT ?")
    .bind(Math.max(1, Math.floor(limit)))
    .all();
  return results.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}

export async function getWebhookDelivery(env, id) {
  const row = await env.DB.prepare("SELECT * FROM webhook_deliveries WHERE id = ?").bind(id).first();
  if (!row) return null;
  return { ...row, payload: JSON.parse(row.payload) };
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

// Top search terms and zero-result searches, both derived from the same
// "search" events logged by renderSearch (detail is {q, count} JSON) —
// getEventCounts groups by event name only, which would just collapse
// every search into one "search: N" row, not useful on its own.
export async function getSearchInsights(env, days = 30) {
  const { results } = await env.DB
    .prepare(
      `SELECT detail FROM events WHERE name = 'search' AND created_at > datetime('now', '-${Math.max(1, Math.floor(days))} days')`
    )
    .all();
  const termCounts = new Map();
  const noResultCounts = new Map();
  for (const row of results) {
    let parsed;
    try {
      parsed = JSON.parse(row.detail || "{}");
    } catch {
      continue;
    }
    if (!parsed.q) continue;
    const key = parsed.q.toLowerCase();
    termCounts.set(key, (termCounts.get(key) || 0) + 1);
    if (parsed.count === 0) noResultCounts.set(key, (noResultCounts.get(key) || 0) + 1);
  }
  const toSortedList = (map) => [...map.entries()].map(([term, n]) => ({ term, n })).sort((a, b) => b.n - a.n).slice(0, 20);
  return { topTerms: toSortedList(termCounts), noResultTerms: toSortedList(noResultCounts) };
}

// Top URLs for a plain-string-detail event (outbound_link, download) — same
// "getEventCounts only groups by name" gap as search, but simpler since the
// detail here is just the URL itself, not JSON.
export async function getTopEventUrls(env, eventName, days = 30) {
  const { results } = await env.DB
    .prepare(
      `SELECT detail, COUNT(*) AS n FROM events WHERE name = ? AND created_at > datetime('now', '-${Math.max(1, Math.floor(days))} days')
       AND detail IS NOT NULL GROUP BY detail ORDER BY n DESC LIMIT 20`
    )
    .bind(eventName)
    .all();
  return results.map((r) => ({ url: r.detail, n: r.n }));
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

export async function listMediaRevisions(env, key) {
  const { results } = await env.DB
    .prepare("SELECT * FROM media_revisions WHERE media_key = ? ORDER BY created_at DESC")
    .bind(key)
    .all();
  return results.map((r) => ({ ...r, tags: JSON.parse(r.tags || "[]") }));
}

// Restoring doesn't itself snapshot the pre-restore state — the restore
// goes through upsertMediaMeta just like a normal edit would, so it gets
// its own "before" snapshot the same way, and can itself be undone.
export async function restoreMediaRevision(env, revisionId) {
  const rev = await env.DB.prepare("SELECT * FROM media_revisions WHERE id = ?").bind(revisionId).first();
  if (!rev) throw new Error("Revision not found");
  await upsertMediaMeta(env, rev.media_key, {
    folder: rev.folder,
    tags: JSON.parse(rev.tags || "[]"),
    alt_text: rev.alt_text,
    caption: rev.caption,
    credit: rev.credit,
    license: rev.license,
  });
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

export async function getMediaVersion(env, id) {
  return await env.DB.prepare("SELECT * FROM media_versions WHERE id = ?").bind(id).first();
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
  await env.DB.prepare("DELETE FROM media WHERE key = ?").bind(key).run();
}

export async function listMediaFolders(env) {
  const { results } = await env.DB.prepare("SELECT DISTINCT folder FROM media WHERE folder IS NOT NULL ORDER BY folder").all();
  return results.map((r) => r.folder);
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

async function getMediaUsageMap(env) {
  const pages = await listPages(env);
  const pageBlocks = await Promise.all(pages.map((p) => listBlocks(env, p.id)));
  const [articles, projects, defaultOg, topicMeta, scans] = await Promise.all([
    listArticles(env),
    listProjects(env),
    getSetting(env, "default_og_image"),
    listTopicMeta(env),
    listScans(env),
  ]);
  const usage = new Map();
  const add = (url, type, title) => {
    if (!url) return;
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
    }
  });
  for (const a of articles) {
    add(a.og_image, "Article share image", a.title);
    findBeforeAfterUrls(a.body).forEach((u) => add(u, "Before/after in article body", a.title));
  }
  for (const pr of projects) {
    add(pr.og_image, "Project share image", pr.title);
    findBeforeAfterUrls(pr.body).forEach((u) => add(u, "Before/after in project body", pr.title));
  }
  if (defaultOg) add(defaultOg, "Site default share image", null);
  for (const t of topicMeta) add(t.og_image, "Topic share image", t.tag);
  for (const s of scans) {
    if (s.poster_key) add(s.poster_key.startsWith("/") ? s.poster_key : `/media/${s.poster_key}`, "3D scan poster", s.name);
  }
  return usage;
}

// Walks every page block and article/project/setting field that can hold a
// media URL, for "where is this used?" before someone deletes a file.
export async function findMediaUsage(env, mediaUrl) {
  const map = await getMediaUsageMap(env);
  return map.get(mediaUrl) || [];
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

// Unified "what uses this" check for the reusable library items that can be
// deleted out from under something still pointing at them — a scan/
// simulation/song can be referenced by a page block (block.content.scan_id/
// simulation_id/song_id) *and*, for scans/simulations specifically, by a
// project's "Related X" multi-select (project.related_scans/
// related_simulations — songs have no such relation field). An earlier,
// per-type findScanUsage() only checked blocks, missing the project-
// relation case entirely; this covers both for every type from one place
// instead of three near-duplicate functions each with their own gaps.
// "shared-block" and "tag" are included too so every "usage" concept in
// the admin (the confirm-before-delete on scans/simulations/songs, the
// Reusable Blocks list, a tag rename/merge) can go through one function.
export async function findContentUsage(env, type, id) {
  const blockTypeKey = { scan: "scan_id", simulation: "simulation_id", song: "song_id" };
  if (type === "shared-block") return findSharedBlockUsage(env, id);
  if (type === "tag") {
    const [articles, projects] = await Promise.all([listArticles(env), listProjects(env)]);
    return [
      ...articles.filter((a) => a.tags.includes(id)).map((a) => ({ type: "Article", title: a.title })),
      ...projects.filter((p) => p.tags.includes(id)).map((p) => ({ type: "Project", title: p.title })),
    ];
  }
  const contentKey = blockTypeKey[type];
  if (!contentKey) return [];
  const pages = await listPages(env);
  const pageBlocks = await Promise.all(pages.map((p) => listBlocks(env, p.id)));
  const usage = [];
  pages.forEach((p, i) => {
    for (const b of pageBlocks[i]) {
      if (b.type === type && Number((b.content || {})[contentKey]) === Number(id)) {
        usage.push({ type: `${blockLabel(type)} block`, title: p.title });
      }
    }
  });
  if (type === "scan" || type === "simulation") {
    const relatedKey = type === "scan" ? "related_scans" : "related_simulations";
    const projects = await listProjects(env);
    projects.forEach((p) => {
      if ((p[relatedKey] || []).map(Number).includes(Number(id))) {
        usage.push({ type: "Project (Related)", title: p.title });
      }
    });
  }
  return usage;
}

// Matches the admin SPA's own blockLabel() naming for the block types this
// covers — kept minimal (only what findContentUsage needs) rather than
// duplicating the SPA's full type-name map.
function blockLabel(type) {
  return { scan: "3D Scan", simulation: "Simulation", song: "Song" }[type] || type;
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
  const res = await env.DB
    .prepare("UPDATE simulations SET name = ?, data = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(name, JSON.stringify(data || {}), id)
    .run();
  return res.meta.changes > 0;
}

export async function deleteSimulation(env, id) {
  await env.DB.prepare("DELETE FROM simulations WHERE id = ?").bind(id).run();
}

export async function duplicateSimulation(env, id) {
  const source = await getSimulation(env, id);
  if (!source) return null;
  return createSimulation(env, { name: `${source.name} (copy)`, data: source.data });
}

// ---------- Songs (DAW module) ----------
// Mirrors the simulations CRUD exactly — same reasoning: all the real
// structure (tempo, drum-grid steps, piano-roll notes, drum kit, animation
// sync settings) lives in `data` as JSON.
export async function listSongs(env) {
  const { results } = await env.DB.prepare("SELECT id, name, updated_at FROM songs ORDER BY name").all();
  return results;
}

export async function getSong(env, id) {
  const row = await env.DB.prepare("SELECT * FROM songs WHERE id = ?").bind(id).first();
  if (!row) return null;
  return { ...row, data: JSON.parse(row.data || "{}") };
}

export async function createSong(env, { name, data }) {
  const res = await env.DB
    .prepare("INSERT INTO songs (name, data) VALUES (?, ?)")
    .bind(name, JSON.stringify(data || {}))
    .run();
  return res.meta.last_row_id;
}

export async function updateSong(env, id, { name, data }) {
  const res = await env.DB
    .prepare("UPDATE songs SET name = ?, data = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(name, JSON.stringify(data || {}), id)
    .run();
  return res.meta.changes > 0;
}

export async function deleteSong(env, id) {
  await env.DB.prepare("DELETE FROM songs WHERE id = ?").bind(id).run();
}

export async function duplicateSong(env, id) {
  const source = await getSong(env, id);
  if (!source) return null;
  return createSong(env, { name: `${source.name} (copy)`, data: source.data });
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

// ---------- Search ----------
export async function search(env, q) {
  const like = `%${escapeLike(q)}%`;
  const [pages, articles, blocks, projects, simulations, songs, scans, sharedBlocks] = await Promise.all([
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
    env.DB
      .prepare(
        "SELECT id, slug, title FROM projects WHERE title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\' LIMIT 15"
      )
      .bind(like, like, like, like, like)
      .all(),
    // Simulations/Songs/Scans/Reusable Blocks each have their own dedicated
    // editor (opened via the "More" menu, not a URL), so unlike
    // pages/articles/projects there's no slug to also match against — just
    // the one name field each is keyed by.
    env.DB.prepare("SELECT id, name FROM simulations WHERE name LIKE ? ESCAPE '\\' LIMIT 15").bind(like).all(),
    env.DB.prepare("SELECT id, name FROM songs WHERE name LIKE ? ESCAPE '\\' LIMIT 15").bind(like).all(),
    env.DB.prepare("SELECT id, name FROM scans WHERE name LIKE ? ESCAPE '\\' LIMIT 15").bind(like).all(),
    env.DB.prepare("SELECT id, name, type FROM shared_blocks WHERE name LIKE ? ESCAPE '\\' LIMIT 15").bind(like).all(),
  ]);
  return {
    pages: pages.results,
    articles: articles.results,
    blocks: blocks.results,
    projects: projects.results,
    simulations: simulations.results,
    songs: songs.results,
    scans: scans.results,
    sharedBlocks: sharedBlocks.results,
  };
}

// Public-facing search: only live pages and published articles, unlike the
// admin command palette's search() above which intentionally sees everything.
export const SEARCH_PAGE_SIZE = 20;

// `type` narrows to one category ("page"/"article"/"project"), skipping the
// other queries entirely rather than just filtering their results client-
// side. `sort` ("newest" default, or "oldest") only affects articles/
// projects — pages have no publish date, so they always sort by title.
// `page` (1-indexed) only applies when `type` picks one specific category —
// with all three shown together there'd be three separate page counters on
// one screen, more confusing than the flat top-20-each it falls back to;
// pagination is really only useful once you've already narrowed to one type.
export async function publicSearch(env, q, { type = "", sort = "newest", page = 1 } = {}) {
  const like = `%${escapeLike(q)}%`;
  const dateOrder = sort === "oldest" ? "ASC" : "DESC";
  const now = new Date().toISOString();
  const paginated = !!type;
  const limit = paginated ? SEARCH_PAGE_SIZE : 20;
  const offset = paginated ? (Math.max(1, page) - 1) * SEARCH_PAGE_SIZE : 0;
  const [pages, articles, projects, pageCount, articleCount, projectCount] = await Promise.all([
    !type || type === "page"
      ? env.DB
          .prepare(
            `SELECT id, slug, title, meta_description FROM pages WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR meta_description LIKE ? ESCAPE '\\') ORDER BY title LIMIT ? OFFSET ?`
          )
          .bind(like, like, limit, offset)
          .all()
      : { results: [] },
    !type || type === "article"
      ? env.DB
          .prepare(
            `SELECT id, slug, title, body, tags, published_at FROM articles
             WHERE deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= ? AND (expires_at IS NULL OR expires_at > ?) AND archived = 0
             AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')
             ORDER BY published_at ${dateOrder} LIMIT ? OFFSET ?`
          )
          .bind(now, now, like, like, like, limit, offset)
          .all()
      : { results: [] },
    !type || type === "project"
      ? env.DB
          .prepare(
            `SELECT id, slug, title, summary, tags, published_at FROM projects
             WHERE deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= ? AND (expires_at IS NULL OR expires_at > ?) AND archived = 0
             AND (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')
             ORDER BY published_at ${dateOrder} LIMIT ? OFFSET ?`
          )
          .bind(now, now, like, like, like, like, limit, offset)
          .all()
      : { results: [] },
    // Counted whenever a category is included at all, not just when
    // paginated — the unfiltered "All" view used to skip these entirely
    // and fall back to however many rows happened to come back from its
    // own LIMIT 20, silently showing "20 results" (and rendering exactly
    // 20 rows) even when there were genuinely more, with no indication
    // anything was cut off. These are cheap COUNT(*) queries against the
    // same WHERE clause the row query already uses.
    !type || type === "page"
      ? env.DB
          .prepare(`SELECT COUNT(*) AS n FROM pages WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR meta_description LIKE ? ESCAPE '\\')`)
          .bind(like, like)
          .first()
      : null,
    !type || type === "article"
      ? env.DB
          .prepare(
            `SELECT COUNT(*) AS n FROM articles
             WHERE deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= ? AND (expires_at IS NULL OR expires_at > ?) AND archived = 0
             AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')`
          )
          .bind(now, now, like, like, like)
          .first()
      : null,
    !type || type === "project"
      ? env.DB
          .prepare(
            `SELECT COUNT(*) AS n FROM projects
             WHERE deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= ? AND (expires_at IS NULL OR expires_at > ?) AND archived = 0
             AND (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')`
          )
          .bind(now, now, like, like, like, like)
          .first()
      : null,
  ]);
  // Filtered to one type: that type's own exact count (used for real
  // pagination). Unfiltered: the true sum across all three, so "N
  // results" is never just "however many rows fit under each category's
  // 20-row display cap."
  const totalCount = paginated ? pageCount?.n ?? articleCount?.n ?? projectCount?.n ?? null : (pageCount?.n || 0) + (articleCount?.n || 0) + (projectCount?.n || 0);
  return {
    pages: pages.results,
    articles: articles.results.map(parseArticleRow),
    projects: projects.results.map(parseProjectRow),
    totalCount,
  };
}

// Related posts for an article: prefers shared tags (most overlap first,
// ties broken by recency), falls back to just-recent when nothing shares a
// tag — so the section never comes up empty for an untagged post.
export async function getRelatedArticles(env, article, limit = 3) {
  const candidates = await listArticles(env, { publishedOnly: true });
  const others = candidates.filter((a) => a.id !== article.id);
  // An admin-pinned override always wins over the automatic tag match,
  // when it actually resolves to at least one still-published article —
  // an override pointing only at unpublished/deleted articles falls
  // through to the automatic match below rather than showing nothing.
  if (article.related_override && article.related_override.length) {
    const byId = new Map(others.map((a) => [a.id, a]));
    const pinned = article.related_override.map((id) => byId.get(id)).filter(Boolean).slice(0, limit);
    if (pinned.length) return pinned;
  }
  if (!article.tags || !article.tags.length) return others.slice(0, limit);
  const scored = others
    .map((a) => ({ a, score: a.tags.filter((t) => article.tags.includes(t)).length }))
    .sort((x, y) => y.score - x.score);
  if (scored[0] && scored[0].score > 0) {
    return scored.filter((s) => s.score > 0).slice(0, limit).map((s) => s.a);
  }
  return others.slice(0, limit);
}

export async function getRelatedProjects(env, project, limit = 3) {
  const candidates = await listProjects(env, { publishedOnly: true });
  const others = candidates.filter((p) => p.id !== project.id);
  if (project.related_override && project.related_override.length) {
    const byId = new Map(others.map((p) => [p.id, p]));
    const pinned = project.related_override.map((id) => byId.get(id)).filter(Boolean).slice(0, limit);
    if (pinned.length) return pinned;
  }
  if (!project.tags || !project.tags.length) return others.slice(0, limit);
  const scored = others
    .map((p) => ({ p, score: p.tags.filter((t) => project.tags.includes(t)).length }))
    .sort((x, y) => y.score - x.score);
  if (scored[0] && scored[0].score > 0) {
    return scored.filter((s) => s.score > 0).slice(0, limit).map((s) => s.p);
  }
  return others.slice(0, limit);
}

// Published projects that name this article in their own related_articles
// field — the reverse direction of that relationship, which nothing
// previously surfaced: a project page shows "related articles" it picked,
// but the article itself never showed "featured in this project" back.
// No new field needed — this is the same relationship, just read
// backwards, so it works for every project that already links an article
// without the article's author having to do anything.
export async function getProjectsLinkingToArticle(env, articleId, limit = 3) {
  const projects = await listProjects(env, { publishedOnly: true });
  return projects.filter((p) => Array.isArray(p.related_articles) && p.related_articles.includes(articleId)).slice(0, limit);
}

// Tag counts across every published article and project, for a topic-
// browsing index — sorted most-used first, ties broken alphabetically.
export async function getTagCounts(env) {
  const [articles, projects] = await Promise.all([
    listArticles(env, { publishedOnly: true }),
    listProjects(env, { publishedOnly: true }),
  ]);
  const counts = new Map();
  for (const item of [...articles, ...projects]) {
    for (const t of item.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export async function getTopicMeta(env, tag) {
  return await env.DB.prepare("SELECT * FROM topic_meta WHERE tag = ?").bind(tag).first();
}

export async function listTopicMeta(env) {
  const { results } = await env.DB.prepare("SELECT * FROM topic_meta ORDER BY tag ASC").all();
  return results;
}

export async function setTopicMeta(env, tag, { description, og_image }) {
  await env.DB
    .prepare(
      `INSERT INTO topic_meta (tag, description, og_image, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(tag) DO UPDATE SET description = excluded.description, og_image = excluded.og_image, updated_at = datetime('now')`
    )
    .bind(tag, description || null, og_image || null)
    .run();
}

export async function deleteTopicMeta(env, tag) {
  await env.DB.prepare("DELETE FROM topic_meta WHERE tag = ?").bind(tag).run();
}

// Every published article and project carrying a given tag, for the
// per-tag topic page (tag chips link here regardless of which content
// type they came from, so a project's tag also surfaces matching articles
// and vice versa).
export async function getContentByTag(env, tag) {
  const [articles, projects] = await Promise.all([
    listArticles(env, { publishedOnly: true, tag }),
    listProjects(env, { publishedOnly: true, tag }),
  ]);
  return { articles, projects };
}

// Every published article and project grouped by the year it was
// published, newest year first, items within a year newest first — the
// site-wide timeline archive.
export async function getArchive(env) {
  const [articles, projects] = await Promise.all([
    listArticles(env, { publishedOnly: true }),
    listProjects(env, { publishedOnly: true }),
  ]);
  const items = [
    ...articles.map((a) => ({ type: "article", title: a.title, slug: a.slug, published_at: a.published_at })),
    ...projects.map((p) => ({ type: "project", title: p.title, slug: p.slug, published_at: p.published_at })),
  ].sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""));
  const byYear = new Map();
  for (const item of items) {
    const year = (item.published_at || "").slice(0, 4) || "Unknown";
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(item);
  }
  return [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, items]) => ({ year, items }));
}

export const REACTION_EMOJI = ["👍", "💡", "❤️"];

export async function addReaction(env, contentType, contentId, emoji) {
  if (!REACTION_EMOJI.includes(emoji)) throw new Error("Invalid reaction");
  await env.DB
    .prepare("INSERT INTO reactions (content_type, content_id, emoji) VALUES (?, ?, ?)")
    .bind(contentType, contentId, emoji)
    .run();
}

export async function getReactionCounts(env, contentType, contentId) {
  const { results } = await env.DB
    .prepare("SELECT emoji, COUNT(*) AS count FROM reactions WHERE content_type = ? AND content_id = ? GROUP BY emoji")
    .bind(contentType, contentId)
    .all();
  const counts = {};
  for (const emoji of REACTION_EMOJI) counts[emoji] = 0;
  for (const r of results) counts[r.emoji] = r.count;
  return counts;
}

export async function createPreviewLink(env, contentType, contentId, hours) {
  const token = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + Math.max(1, hours) * 3600 * 1000).toISOString();
  await env.DB
    .prepare("INSERT INTO preview_links (content_type, content_id, token, expires_at) VALUES (?, ?, ?, ?)")
    .bind(contentType, contentId, token, expiresAt)
    .run();
  return { token, expires_at: expiresAt };
}

export async function listPreviewLinks(env, contentType, contentId) {
  const { results } = await env.DB
    .prepare("SELECT * FROM preview_links WHERE content_type = ? AND content_id = ? ORDER BY created_at DESC")
    .bind(contentType, contentId)
    .all();
  return results;
}

export async function revokePreviewLink(env, id) {
  await env.DB.prepare("UPDATE preview_links SET revoked_at = datetime('now') WHERE id = ?").bind(id).run();
}

export async function getValidPreviewLink(env, contentType, contentId, token) {
  if (!token) return null;
  // expires_at is a JS-generated ISO string (like articles/projects.expires_at
  // elsewhere in this file), not a SQLite datetime('now') value — those two
  // formats don't compare correctly against each other as plain strings.
  return env.DB
    .prepare("SELECT * FROM preview_links WHERE content_type = ? AND content_id = ? AND token = ? AND revoked_at IS NULL AND expires_at > ?")
    .bind(contentType, contentId, token, new Date().toISOString())
    .first();
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

export async function recordPageview(env, { path, referrer, country, device, browser, region, city }) {
  await env.DB
    .prepare("INSERT INTO pageviews (path, referrer, country, device, browser, region, city) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(path, referrer || null, country || null, device || null, browser || null, region || null, city || null)
    .run();
}

// A coarse device/browser label only — never the raw User-Agent string
// itself, so pageviews stay a lot less fingerprintable than most analytics
// setups while still answering "mobile or desktop, and which browser".
// Order matters: several UAs contain more than one of these tokens (every
// Chrome UA also contains "Safari/"), so the more specific check has to
// run first.
export function parseUserAgent(ua) {
  if (!ua) return { device: null, browser: null };
  const device = /Tablet|iPad/i.test(ua) ? "Tablet" : /Mobi|Android|iPhone/i.test(ua) ? "Mobile" : "Desktop";
  let browser = "Other";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\/|CriOS\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = "Safari";
  return { device, browser };
}

// contentType maps to a path prefix: "article" -> /random/, "project" ->
// /projects/, "page" -> neither of those (everything else — pages, home,
// topics, archive). device/referrer match the pageviews columns exactly
// (the same values the top-devices/top-referrers lists already show, so
// the dashboard's filter dropdowns are just populated from those lists).
function buildPageviewFilter({ device, referrer, contentType } = {}) {
  const clauses = [];
  const binds = [];
  if (device) {
    clauses.push(device === "?" ? "device IS NULL" : "device = ?");
    if (device !== "?") binds.push(device);
  }
  if (referrer) {
    clauses.push(referrer === "(direct)" ? "referrer IS NULL" : "referrer = ?");
    if (referrer !== "(direct)") binds.push(referrer);
  }
  if (contentType === "article") clauses.push("path LIKE '/random/%'");
  else if (contentType === "project") clauses.push("path LIKE '/projects/%'");
  else if (contentType === "page") clauses.push("path NOT LIKE '/random/%' AND path NOT LIKE '/projects/%'");
  return { sql: clauses.length ? `AND ${clauses.join(" AND ")}` : "", binds };
}

export async function getAnalytics(env, days = 7, filters = {}) {
  const since = `datetime('now', '-${Math.max(1, Math.floor(days))} days')`;
  const { sql: filterSql, binds: filterBinds } = buildPageviewFilter(filters);
  const isFiltered = !!filterSql;

  const [
    totalsRow,
    byDay,
    topPaths,
    topReferrers,
    topCountries,
    topLocations,
    topDevices,
    topBrowsers,
    topEvents,
    searchInsights,
    topOutboundLinks,
    topDownloads,
  ] = await Promise.all([
    isFiltered
      ? env.DB
          .prepare(
            `SELECT
               (SELECT COUNT(*) FROM pageviews WHERE created_at > datetime('now', '-5 minutes') ${filterSql}) AS activeNow,
               (SELECT COUNT(*) FROM pageviews WHERE created_at > datetime('now', '-1 days') ${filterSql}) AS today,
               (SELECT COUNT(*) FROM pageviews WHERE created_at > datetime('now', '-7 days') ${filterSql}) AS last7,
               (SELECT COUNT(*) FROM pageviews WHERE created_at > datetime('now', '-30 days') ${filterSql}) AS last30,
               (SELECT COUNT(*) FROM pageviews WHERE 1=1 ${filterSql}) AS allTime`
          )
          .bind(...filterBinds, ...filterBinds, ...filterBinds, ...filterBinds, ...filterBinds)
          .first()
      : env.DB.prepare(
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
         WHERE created_at > ${since} ${filterSql} GROUP BY day ORDER BY day ASC`
      )
      .bind(...filterBinds)
      .all(),
    env.DB
      .prepare(
        `SELECT path, COUNT(*) AS n FROM pageviews
         WHERE created_at > ${since} ${filterSql} GROUP BY path ORDER BY n DESC LIMIT 10`
      )
      .bind(...filterBinds)
      .all(),
    env.DB
      .prepare(
        `SELECT COALESCE(referrer, '(direct)') AS referrer, COUNT(*) AS n FROM pageviews
         WHERE created_at > ${since} ${filterSql} GROUP BY referrer ORDER BY n DESC LIMIT 10`
      )
      .bind(...filterBinds)
      .all(),
    env.DB
      .prepare(
        `SELECT COALESCE(country, '?') AS country, COUNT(*) AS n FROM pageviews
         WHERE created_at > ${since} ${filterSql} GROUP BY country ORDER BY n DESC LIMIT 10`
      )
      .bind(...filterBinds)
      .all(),
    // City/region come from the same Cloudflare-populated request.cf as
    // country, so they're free — just unset on `wrangler dev` locally,
    // which doesn't have real edge geolocation. Grouped together as one
    // "City, Region" location rather than three separate breakdowns.
    env.DB
      .prepare(
        `SELECT COALESCE(city, '?') AS city, COALESCE(region, '?') AS region, COUNT(*) AS n FROM pageviews
         WHERE created_at > ${since} ${filterSql} GROUP BY city, region ORDER BY n DESC LIMIT 10`
      )
      .bind(...filterBinds)
      .all(),
    env.DB
      .prepare(
        `SELECT COALESCE(device, '?') AS device, COUNT(*) AS n FROM pageviews
         WHERE created_at > ${since} ${filterSql} GROUP BY device ORDER BY n DESC LIMIT 10`
      )
      .bind(...filterBinds)
      .all(),
    env.DB
      .prepare(
        `SELECT COALESCE(browser, '?') AS browser, COUNT(*) AS n FROM pageviews
         WHERE created_at > ${since} ${filterSql} GROUP BY browser ORDER BY n DESC LIMIT 10`
      )
      .bind(...filterBinds)
      .all(),
    getEventCounts(env, days),
    getSearchInsights(env, days),
    getTopEventUrls(env, "outbound_link", days),
    getTopEventUrls(env, "download", days),
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
    topLocations: topLocations.results.map((r) => ({ location: r.city !== "?" ? `${r.city}, ${r.region}` : "?", n: r.n })),
    topDevices: topDevices.results,
    topBrowsers: topBrowsers.results,
    topEvents,
    topSearchTerms: searchInsights.topTerms,
    noResultSearchTerms: searchInsights.noResultTerms,
    topOutboundLinks,
    topDownloads,
  };
}

// Raw, unaggregated rows for the "export raw events" CSV — every
// individual pageview and event, not the top-N breakdowns getAnalytics()
// returns. Same date-range and pageview filters (device/referrer/
// contentType) as the dashboard; events have no device/referrer/path-type
// columns to filter on, same limitation the dashboard's own filters
// already carry (see the "raw event export" outline note). Capped at
// 20,000 rows each — plenty for a personal-blog volume of traffic without
// risking an unbounded response.
const RAW_EXPORT_ROW_LIMIT = 20000;

export async function getRawAnalyticsEvents(env, days = 7, filters = {}) {
  const since = `datetime('now', '-${Math.max(1, Math.floor(days))} days')`;
  const { sql: filterSql, binds: filterBinds } = buildPageviewFilter(filters);
  const [pageviews, events] = await Promise.all([
    env.DB
      .prepare(
        `SELECT created_at, path, referrer, device, browser, country, region, city FROM pageviews
         WHERE created_at > ${since} ${filterSql} ORDER BY created_at DESC LIMIT ${RAW_EXPORT_ROW_LIMIT}`
      )
      .bind(...filterBinds)
      .all(),
    env.DB
      .prepare(`SELECT created_at, name, path, detail FROM events WHERE created_at > ${since} ORDER BY created_at DESC LIMIT ${RAW_EXPORT_ROW_LIMIT}`)
      .all(),
  ]);
  return { pageviews: pageviews.results, events: events.results };
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
    env.DB.prepare("SELECT * FROM settings ORDER BY key").all(),
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

export async function runScheduledBackup(env) {
  try {
    const data = await exportAll(env);
    const key = `${BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    const checksum = await sha256Hex(bytes);
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "application/json" }, customMetadata: { sha256: checksum } });
    // Read the just-written object straight back and re-hash it — catches
    // any corruption/truncation in the R2 write itself, rather than only
    // finding out the file is bad the day it's actually needed for a
    // restore. A mismatch fails the whole backup (same as any other
    // exportAll/put error above), since a backup nobody can trust is as
    // good as no backup at all.
    const written = await env.MEDIA.get(key);
    if (!written) throw new Error("Backup write succeeded but the file can't be read back");
    const readBackHash = await sha256Hex(await written.arrayBuffer());
    if (readBackHash !== checksum) throw new Error("Backup file failed integrity check after writing (hash mismatch)");
    const listed = await env.MEDIA.list({ prefix: BACKUP_PREFIX });
    const sorted = listed.objects.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
    const stale = sorted.slice(BACKUP_KEEP);
    await Promise.all(stale.map((o) => env.MEDIA.delete(o.key)));
    await setSetting(env, "last_backup_at", new Date().toISOString());
    await setSetting(env, "last_backup_error", "");
    return key;
  } catch (err) {
    await setSetting(env, "last_backup_error", err.message || "Backup failed");
    throw err;
  }
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

// Sums every object under a prefix, paging through R2's list() cursor —
// a single call caps out at 1000 objects, and the media library alone can
// exceed that over time.
async function sumR2Prefix(env, prefix) {
  let count = 0;
  let bytes = 0;
  let cursor;
  do {
    const listed = await env.MEDIA.list({ prefix, cursor });
    for (const o of listed.objects) {
      count++;
      bytes += o.size;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return { count, bytes };
}

// R2 usage by prefix (images/audio/video/scans/backups/version-history)
// plus an approximate D1 database size and a few row counts for the
// tables most likely to grow unbounded on their own (pageviews/events
// accumulate forever unless pruned; everything else grows with content).
// D1 reports size_after on every query's meta; fall back to null if a
// future D1 runtime version ever stops populating it, rather than assume
// it's always there.
const STORAGE_USAGE_TABLE_NAMES = ["pages", "articles", "projects", "pageviews", "events", "media", "revisions", "webhook_deliveries"];

export async function getStorageUsage(env) {
  const [images, audio, video, scans, backups, versions, sizeProbe, rowCounts] = await Promise.all([
    sumR2Prefix(env, "uploads/"),
    sumR2Prefix(env, "audio/"),
    sumR2Prefix(env, "video/"),
    sumR2Prefix(env, "scans/"),
    sumR2Prefix(env, BACKUP_PREFIX),
    sumR2Prefix(env, "_versions/"),
    env.DB.prepare("SELECT 1").run(),
    Promise.all(STORAGE_USAGE_TABLE_NAMES.map((table) => env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first())),
  ]);
  const byPrefix = [
    { label: "Images", prefix: "uploads/", ...images },
    { label: "Audio", prefix: "audio/", ...audio },
    { label: "Video", prefix: "video/", ...video },
    { label: "3D scans", prefix: "scans/", ...scans },
    { label: "Backups", prefix: BACKUP_PREFIX, ...backups },
    { label: "Image version history", prefix: "_versions/", ...versions },
  ];
  return {
    r2: {
      totalBytes: byPrefix.reduce((sum, p) => sum + p.bytes, 0),
      totalCount: byPrefix.reduce((sum, p) => sum + p.count, 0),
      byPrefix,
    },
    d1: {
      sizeBytes: sizeProbe.meta?.size_after ?? null,
      rowCounts: STORAGE_USAGE_TABLE_NAMES.reduce((acc, name, i) => ((acc[name] = rowCounts[i]?.n || 0), acc), {}),
    },
  };
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

  const stmts = [
    env.DB.prepare("DELETE FROM blocks"),
    env.DB.prepare("DELETE FROM shared_blocks"),
    env.DB.prepare("DELETE FROM pages"),
    env.DB.prepare("DELETE FROM articles"),
    env.DB.prepare("DELETE FROM settings"),
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
          "INSERT INTO media (key, folder, tags, alt_text, caption, credit, license, hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(m.key, m.folder ?? null, m.tags ?? "[]", m.alt_text ?? null, m.caption ?? null, m.credit ?? null, m.license ?? null, m.hash ?? null, m.created_at)
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

  for (const s of simulations) {
    stmts.push(
      env.DB
        .prepare("INSERT INTO simulations (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(s.id, s.name, s.data ?? "{}", s.created_at, s.updated_at)
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

// Whether an article/project would actually be servable to a visitor right
// now — a link to a real-but-draft or real-but-expired item 404s exactly
// like a link to a nonexistent one, so the Link Checker needs to know the
// difference between "exists" and "exists and is live".
function isCurrentlyPublished(item) {
  if (!item || !item.published_at) return false;
  const now = new Date().toISOString();
  return item.published_at <= now && (!item.expires_at || item.expires_at > now);
}

async function checkOneLink(env, rawUrl) {
  if (!rawUrl) return { ok: null, status: "Empty" };
  if (rawUrl.startsWith("/")) {
    if (rawUrl === "/" || (await getPageBySlug(env, rawUrl.replace(/^\/+/, "").replace(/\/+$/, "") || "home"))) {
      return { ok: true, status: "OK" };
    }
    const articleMatch = rawUrl.match(/^\/random\/([a-z0-9-]+)$/);
    if (articleMatch) {
      const article = await getArticleBySlug(env, articleMatch[1]);
      if (!article) return { ok: false, status: "Not found" };
      if (isCurrentlyPublished(article)) return { ok: true, status: "OK" };
      return { ok: false, status: article.published_at ? "Expired" : "Not published (draft)" };
    }
    const projectMatch = rawUrl.match(/^\/projects\/([a-z0-9-]+)$/);
    if (projectMatch) {
      const project = await getProjectBySlug(env, projectMatch[1]);
      if (!project) return { ok: false, status: "Not found" };
      if (isCurrentlyPublished(project)) return { ok: true, status: "OK" };
      return { ok: false, status: project.published_at ? "Expired" : "Not published (draft)" };
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

// Walks every button/project-card/link-block/markdown link across pages,
// articles and projects (including project journals) — shared by
// checkLinks() (which pings each url) and getOrphanContent() (which
// resolves them against site content to find what nothing links to).
async function gatherInternalLinks(env) {
  const pages = await listPages(env);
  const pageBlocks = await Promise.all(pages.map((p) => listBlocks(env, p.id)));
  const articles = await listArticles(env);
  const projects = await listProjects(env);
  const projectJournals = await Promise.all(projects.map((p) => listJournalEntries(env, p.id)));

  const markdownLinks = (text) => [...(text || "").matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]);

  const found = [];
  pages.forEach((p, i) => {
    for (const b of pageBlocks[i]) {
      const c = b.content || {};
      if ((b.type === "button" || b.type === "project-card") && c.url) {
        found.push({ url: c.url, source: `Page "${p.title}" — ${b.type === "button" ? "Button" : "Project Card"} block` });
      }
      if (b.type === "links" && Array.isArray(c.items)) {
        for (const it of c.items) if (it && it.url) found.push({ url: it.url, source: `Page "${p.title}" — Links block` });
      }
      if (b.type === "text" && c.text) {
        for (const url of markdownLinks(c.text)) found.push({ url, source: `Page "${p.title}" — Text block` });
      }
    }
  });
  for (const a of articles) {
    for (const url of markdownLinks(a.body)) found.push({ url, source: `Article "${a.title}"` });
  }
  projects.forEach((p, i) => {
    for (const url of markdownLinks(p.body)) found.push({ url, source: `Project "${p.title}"` });
    for (const key of ["github", "demo", "docs", "download"]) {
      if (p.links && p.links[key]) found.push({ url: p.links[key], source: `Project "${p.title}" — ${key} link` });
    }
    if (p.links && Array.isArray(p.links.downloads)) {
      for (const d of p.links.downloads) {
        if (d && d.url) found.push({ url: d.url, source: `Project "${p.title}" — download manifest: ${d.label || d.url}` });
      }
    }
    for (const j of projectJournals[i]) {
      for (const url of markdownLinks(j.body)) found.push({ url, source: `Project "${p.title}" — journal entry "${j.title || j.entry_date}"` });
    }
  });
  return { found, pages, articles, projects };
}

export async function checkLinks(env) {
  const { found } = await gatherInternalLinks(env);
  const uniqueUrls = [...new Set(found.map((f) => f.url))];
  const statusByUrl = {};
  await Promise.all(
    uniqueUrls.map(async (u) => {
      statusByUrl[u] = await checkOneLink(env, u);
    })
  );
  return found.map((f) => ({ ...f, ...statusByUrl[f.url] }));
}

// The on-demand Link Checker above only ever runs when an admin opens the
// SEO Dashboard and clicks the button — a link can quietly go dead (a
// third-party page taken down, a demo site expiring) for weeks before
// anyone notices. Runs on the same daily cron as the scheduled backup,
// storing just the broken subset (not a run history — same "latest only"
// scope as the backup-failure status line) so the SEO Dashboard can show
// "N broken links found" without anyone having to click "Check links" first.
export async function runScheduledLinkCheck(env) {
  const results = await checkLinks(env);
  const broken = results.filter((r) => r.ok === false).map((r) => ({ url: r.url, source: r.source, status: r.status }));
  await setSetting(env, "last_link_check_at", new Date().toISOString());
  await setSetting(env, "last_link_check_broken", JSON.stringify(broken));
}

export async function getLinkCheckStatus(env) {
  const [lastAt, brokenRaw] = await Promise.all([getSetting(env, "last_link_check_at"), getSetting(env, "last_link_check_broken")]);
  let broken = [];
  try {
    broken = JSON.parse(brokenRaw || "[]");
  } catch {
    broken = [];
  }
  return { lastAt: lastAt || null, broken };
}

// Rolls up several already-separate status signals (backup failure, broken
// links, recent errors, recent failed webhook deliveries) into the one
// number the admin header's notification bell needs — no new "read/
// unread" state to track, just "how many things currently need a look",
// recomputed fresh each time rather than persisted anywhere.
const NOTIFICATION_RECENT_HOURS = 24;
export async function getNotificationSummary(env) {
  const since = `datetime('now', '-${NOTIFICATION_RECENT_HOURS} hours')`;
  const [backupStatus, linkCheckStatus, recentErrors, recentFailedWebhooks] = await Promise.all([
    getBackupStatus(env),
    getLinkCheckStatus(env),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM error_log WHERE created_at > ${since}`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM webhook_deliveries WHERE status = 'failed' AND created_at > ${since}`).first(),
  ]);
  return {
    backupFailed: !!backupStatus.lastError,
    brokenLinks: linkCheckStatus.broken.length,
    recentErrors: recentErrors?.n || 0,
    recentFailedWebhooks: recentFailedWebhooks?.n || 0,
  };
}

// Orphan-page detection: published pages/articles/projects that nothing
// else on the site links to internally (via a button/links/text block, a
// markdown link in an article/project body or journal entry, or a
// project's github/demo/docs/download links) AND that aren't reachable
// from the header nav (nav_order set) — the two ways a visitor could
// actually land on them without knowing the URL already. Related-content
// suggestions and shuffle don't count: both are automatic/random, not a
// deliberate link an editor placed, so they don't make a page "reachable"
// in the sense this check cares about.
export async function getOrphanContent(env) {
  const { found, pages, articles, projects } = await gatherInternalLinks(env);
  const linkedPaths = new Set();
  for (const { url } of found) {
    try {
      const path = new URL(url, "https://dominickdominick.com").pathname.replace(/\/$/, "") || "/";
      linkedPaths.add(path);
    } catch {
      // Not a resolvable URL (e.g. a mailto: or malformed link) — ignore.
    }
  }
  const isOrphanPage = (p) => p.slug !== "home" && p.nav_order == null && !linkedPaths.has(`/${p.slug}`);
  const isOrphanArticle = (a) => !!a.published_at && !linkedPaths.has(`/random/${a.slug}`);
  const isOrphanProject = (p) => !!p.published_at && !linkedPaths.has(`/projects/${p.slug}`);
  return {
    pages: pages.filter(isOrphanPage).map((p) => ({ title: p.title, slug: p.slug })),
    articles: articles.filter(isOrphanArticle).map((a) => ({ title: a.title, slug: a.slug })),
    projects: projects.filter(isOrphanProject).map((p) => ({ title: p.title, slug: p.slug })),
  };
}

// A page counts as "empty" for this report if it has no blocks at all, or
// every block on it fails the same emptiness check the per-page
// diagnostics panel already runs one block at a time (heading/text/quote
// with no text, image/video/embed with no url, button with no url) —
// i.e. nothing a visitor would actually see. "Stale" is separate: still
// has real content, just hasn't been touched in a long time — worth a
// second look, not necessarily a problem.
const STALE_DAYS = 365;

function isEmptyBlock(b) {
  const c = b.content || {};
  if (["heading", "text", "quote"].includes(b.type)) return !c.text;
  if (["image", "video", "embed"].includes(b.type)) return !c.url;
  if (b.type === "button") return !c.url;
  return false;
}

export async function getContentHealth(env) {
  const pages = await listPages(env);
  const pageBlocks = await Promise.all(pages.map((p) => listBlocks(env, p.id)));
  const emptyPages = pages
    .filter((p, i) => p.slug !== "home" && (pageBlocks[i].length === 0 || pageBlocks[i].every(isEmptyBlock)))
    .map((p) => ({ title: p.title, slug: p.slug }));

  // updated_at is always SQLite `datetime('now')` format ("YYYY-MM-DD
  // HH:MM:SS"), but published_at is set via JS `Date.toISOString()` on
  // some paths and `datetime('now')` on others — comparing the raw
  // strings would silently misorder whichever rows mix formats. Parsing
  // through Date (same normalization renderSitemap() already uses for
  // this exact reason) avoids that regardless of which format a given
  // row happens to have.
  const parseDbDate = (s) => (s ? new Date(/Z$/.test(s) ? s : `${s.replace(" ", "T")}Z`) : null);
  const staleCutoffMs = Date.now() - STALE_DAYS * 24 * 3600 * 1000;
  const articles = await listArticles(env, { publishedOnly: true });
  const projects = await listProjects(env, { publishedOnly: true });
  const isStale = (item) => {
    const d = parseDbDate(item.updated_at || item.published_at);
    return !!d && d.getTime() < staleCutoffMs;
  };
  return {
    emptyPages,
    staleArticles: articles.filter(isStale).map((a) => ({ title: a.title, slug: a.slug, updated_at: a.updated_at || a.published_at })),
    staleProjects: projects.filter(isStale).map((p) => ({ title: p.title, slug: p.slug, updated_at: p.updated_at || p.published_at })),
  };
}

// Site-wide "content integrity" sweep — dangling references that a normal
// edit flow can leave behind without anything visibly breaking at save
// time: a simulation/scan/song deleted after a block already pointed at it
// (the single-page admin canvas badge added alongside this only warns
// about whichever page happens to be open), and a project's related-X
// arrays still listing an id whose row is long gone (deleting a related
// article/project/simulation/scan doesn't touch anything else's
// related_* JSON array, so a stale id just sits there silently).
//
// A dangling nav_parent_id was considered too, but schema.sql's
// `nav_parent_id INTEGER REFERENCES pages(id)` is a real, D1-enforced
// foreign key, and every trash/delete/permadelete path already nulls out
// a deleted page's children (see the three `UPDATE pages SET
// nav_parent_id = NULL` calls above) — confirmed via a direct D1 write
// attempt that a dangling value can't exist, so it isn't checked here.
export async function getContentIntegrity(env) {
  const [pages, articles, projects, simulations, scans, songs] = await Promise.all([
    listPages(env),
    listArticles(env),
    listProjects(env),
    listSimulations(env),
    listScans(env),
    listSongs(env),
  ]);
  const pageBlocks = await Promise.all(pages.map((p) => listBlocks(env, p.id)));
  const simIds = new Set(simulations.map((s) => s.id));
  const scanIds = new Set(scans.map((s) => s.id));
  const songIds = new Set(songs.map((s) => s.id));
  const articleIds = new Set(articles.map((a) => a.id));
  const projectIds = new Set(projects.map((p) => p.id));

  const brokenBlockRefs = [];
  pages.forEach((p, i) => {
    for (const b of pageBlocks[i]) {
      const c = b.content || {};
      if (b.type === "simulation" && c.simulation_id && !simIds.has(Number(c.simulation_id))) {
        brokenBlockRefs.push({ pageTitle: p.title, pageSlug: p.slug, blockType: "Simulation" });
      }
      if (b.type === "scan" && c.scan_id && !scanIds.has(Number(c.scan_id))) {
        brokenBlockRefs.push({ pageTitle: p.title, pageSlug: p.slug, blockType: "3D Scan" });
      }
      if (b.type === "song" && c.song_id && !songIds.has(Number(c.song_id))) {
        brokenBlockRefs.push({ pageTitle: p.title, pageSlug: p.slug, blockType: "Song" });
      }
    }
  });

  const danglingRelations = [];
  projects.forEach((p) => {
    (p.related_articles || []).forEach((id) => {
      if (!articleIds.has(Number(id))) danglingRelations.push({ title: p.title, slug: p.slug, field: "Related articles" });
    });
    (p.related_simulations || []).forEach((id) => {
      if (!simIds.has(Number(id))) danglingRelations.push({ title: p.title, slug: p.slug, field: "Related simulations" });
    });
    (p.related_scans || []).forEach((id) => {
      if (!scanIds.has(Number(id))) danglingRelations.push({ title: p.title, slug: p.slug, field: "Related scans" });
    });
    (p.related_override || []).forEach((id) => {
      if (!projectIds.has(Number(id))) danglingRelations.push({ title: p.title, slug: p.slug, field: "Related projects override" });
    });
  });

  return { brokenBlockRefs, danglingRelations };
}

// Shared with worker/index.js's renderSitemap(), so the two never
// independently drift on what "excluded from the sitemap" means — a
// password-protected page 401s (with noindex) for anyone unauthenticated,
// so listing it contradicts that gate the same way sitemap_exclude does
// for the intentional case; only pages have a password_hash field.
export function isInSitemap(item, type) {
  if (item.sitemap_exclude) return false;
  if (type === "page" && item.password_hash) return false;
  return true;
}

// Site-wide SEO/accessibility sweep: pages missing a meta description
// (falls back to the title, which is worse for search-result snippets and
// social shares), and every image block missing alt text (aggregating
// the same check the per-page diagnostics panel already does one page at
// a time, so it can all be seen — and fixed — from one place).
export async function getSeoReport(env) {
  const pages = await listPages(env);
  const pageBlocks = await Promise.all(pages.map((p) => listBlocks(env, p.id)));
  const articles = await listArticles(env, { publishedOnly: true });
  const projects = await listProjects(env, { publishedOnly: true });
  const missingMeta = pages.filter((p) => !p.meta_description || !p.meta_description.trim()).map((p) => ({ title: p.title, slug: p.slug }));
  const missingAlt = [];
  pages.forEach((p, i) => {
    for (const b of pageBlocks[i]) {
      const c = b.content || {};
      if (b.type === "image" && c.url && !(c.alt && c.alt.trim())) {
        missingAlt.push({ title: p.title, slug: p.slug, url: c.url });
      }
    }
  });
  const missingOgImage = [
    ...articles.filter((a) => !a.og_image).map((a) => ({ title: a.title, slug: a.slug, type: "article" })),
    ...projects.filter((p) => !p.og_image).map((p) => ({ title: p.title, slug: p.slug, type: "project" })),
  ];
  // Same title used more than once across pages/articles/projects — not
  // technically broken, but confusing in search results and share cards,
  // both of which key on the title.
  const titleOwners = new Map();
  for (const [items, type] of [[pages, "page"], [articles, "article"], [projects, "project"]]) {
    for (const item of items) {
      const key = item.title.trim().toLowerCase();
      if (!key) continue;
      if (!titleOwners.has(key)) titleOwners.set(key, []);
      titleOwners.get(key).push({ title: item.title, slug: item.slug, type });
    }
  }
  const duplicateTitles = [...titleOwners.values()].filter((owners) => owners.length > 1);
  // Same meta description reused across pages — search engines treat this
  // about as poorly as a duplicate title: it makes distinct pages look
  // interchangeable in results. Pages only (not articles/projects), since
  // meta_description is the one explicit admin-typed field here — the
  // other two don't have an equivalent column, so there's nothing to
  // compare there. Empty ones are already covered by missingMeta above,
  // so they're excluded here to avoid double-reporting the same page.
  const metaOwners = new Map();
  for (const p of pages) {
    const key = (p.meta_description || "").trim().toLowerCase();
    if (!key) continue;
    if (!metaOwners.has(key)) metaOwners.set(key, []);
    metaOwners.get(key).push({ title: p.title, slug: p.slug });
  }
  const duplicateMeta = [...metaOwners.values()].filter((owners) => owners.length > 1);
  // A canonical URL pointing somewhere else is exactly the signal to use
  // for "the real version of this is over there" (e.g. a project
  // deliberately converted from an article, per the editor's own
  // confirm-dialog advice) — but sitemap.xml/rss.xml always list a page's
  // own slug URL regardless, with no awareness of that signal. Search
  // engines get told two contradictory things at once: the sitemap says
  // "index this," the page's own <link rel="canonical"> says "no, index
  // that instead." sitemap_exclude already exists for exactly this
  // situation; this just flags where it was probably meant to be set but
  // wasn't.
  const ownUrl = { page: (p) => (p.slug === "home" ? "https://dominickdominick.com/" : `https://dominickdominick.com/${p.slug}`), article: (a) => `https://dominickdominick.com/random/${a.slug}`, project: (p) => `https://dominickdominick.com/projects/${p.slug}` };
  const sitemapCanonicalMismatch = [];
  for (const [items, type] of [[pages, "page"], [articles, "article"], [projects, "project"]]) {
    for (const item of items) {
      if (!item.canonical_url || !isInSitemap(item, type)) continue;
      // Trailing slash on the site root is the one legitimate case where
      // the canonical URL and the computed URL differ by punctuation only.
      const own = ownUrl[type](item).replace(/\/$/, "") || "https://dominickdominick.com";
      const canonical = item.canonical_url.replace(/\/$/, "");
      if (canonical !== own) {
        sitemapCanonicalMismatch.push({ title: item.title, slug: item.slug, type, canonicalUrl: item.canonical_url });
      }
    }
  }
  return { missingMeta, missingAlt, missingOgImage, duplicateTitles, duplicateMeta, sitemapCanonicalMismatch };
}

// Same WCAG relative-luminance contrast formula used both by the Site
// Settings theme-color checker and the per-page Diagnostics per-block
// check (public/admin/app.js) — duplicated here rather than shared,
// since the admin bundle and the worker have no common module between
// them to put it in.
function relLuminance(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastRatio(hexA, hexB) {
  const l1 = relLuminance(hexA);
  const l2 = relLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
const HEX_RE = /^#[0-9a-f]{6}$/i;

// Most block types are already accessible by construction (semantic markup,
// real <button>/<a> elements, a dedicated alt-text field the SEO report
// above already checks) — "html" is the one place arbitrary admin-authored
// markup can land, so it's the only place worth pattern-matching for known
// keyboard-nav/focus anti-patterns. Any block type can carry a custom
// color/bg style override though, which is checked across all of them
// below, independent of the per-type checks.
// Regex-based HTML scanning is inherently approximate (same trade-off the
// markdown-link scanning elsewhere in this file already makes) — flags
// likely issues, not a substitute for actually tabbing through the page.
export async function checkAccessibility(env) {
  const pages = await listPages(env);
  const pageBlocks = await Promise.all(pages.map((p) => listBlocks(env, p.id)));
  const checks = [
    { test: /tabindex\s*=\s*["']?\s*[1-9]/i, issue: "Positive tabindex value (breaks the natural tab order)" },
    { test: /<(div|span|li|td|tr|p|section|article)\b[^>]*\bonclick\s*=/i, issue: "onclick on a non-interactive element (not reachable or operable by keyboard)" },
    { test: /<img\b(?![^>]*\balt\s*=)[^>]*>/i, issue: "<img> with no alt attribute" },
    { test: /<a\b[^>]*\bhref\s*=\s*["']\s*#\s*["'][^>]*>/i, issue: '<a href="#"> with no real destination' },
  ];
  const issues = [];
  pages.forEach((p, i) => {
    for (const b of pageBlocks[i]) {
      if (b.type === "html") {
        const html = (b.content && b.content.html) || "";
        for (const { test, issue } of checks) {
          if (test.test(html)) issues.push({ pageTitle: p.title, pageSlug: p.slug, blockId: b.id, issue });
        }
      }
      if (b.type === "gallery") {
        const images = Array.isArray(b.content && b.content.images) ? b.content.images : [];
        const missingAlt = images.some((img) => (typeof img === "string" ? true : !img || !img.alt));
        if (missingAlt) {
          issues.push({ pageTitle: p.title, pageSlug: p.slug, blockId: b.id, issue: "Gallery image with no alt text" });
        }
      }
      // The per-page Diagnostics panel already catches this one page at a
      // time, but there was no way to sweep the whole site for it — an
      // admin had to happen to open Diagnostics on the specific page a bad
      // color pair landed on. Same threshold, applied everywhere at once.
      // WCAG AA allows a relaxed 3:1 for large text; headings are the block
      // type most likely to actually be large enough to qualify, so they
      // get that lower bar instead of flagging pairs that are technically
      // compliant.
      const color = b.style && b.style.color;
      const bg = b.style && b.style.bg;
      if (color && bg && HEX_RE.test(color) && HEX_RE.test(bg)) {
        const ratio = contrastRatio(color, bg);
        const threshold = b.type === "heading" ? 3 : 4.5;
        if (ratio < threshold) {
          issues.push({
            pageTitle: p.title,
            pageSlug: p.slug,
            blockId: b.id,
            issue: `Custom text/background colors have a contrast ratio of ${ratio.toFixed(2)}:1, below the WCAG AA minimum of ${threshold}:1`,
          });
        }
      }
    }
  });
  return issues;
}
