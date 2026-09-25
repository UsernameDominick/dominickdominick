import {
  RESERVED_SLUGS,
  listPages,
  createPage,
  updatePage,
  deletePage,
  restorePage,
  hardDeletePage,
  listTrashedPages,
  duplicatePage,
  duplicateArticle,
  convertArticleToProject,
  duplicateProject,
  listBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
  listArticles,
  createArticle,
  updateArticle,
  deleteArticle,
  restoreArticle,
  hardDeleteArticle,
  listTrashedArticles,
  bulkArticleAction,
  bulkProjectAction,
  listTemplates,
  createTemplate,
  deleteTemplate,
  getMediaMeta,
  upsertMediaMeta,
  deleteMediaMeta,
  listMediaRevisions,
  restoreMediaRevision,
  recordMediaVersion,
  listMediaVersions,
  getMediaVersion,
  deleteMediaVersions,
  listMediaFolders,
  findMediaUsage,
  getAllUsedMediaUrls,
  getDuplicateMediaHashes,
  logActivity,
  listActivityLog,
  listErrors,
  runScheduledBackup,
  listScheduledBackups,
  getBackupStatus,
  getBackupContents,
  runFindReplace,
  slugExists,
  checkLoginRateLimit,
  recordLoginAttempt,
  getSetting,
  logWebhookDelivery,
  listWebhookDeliveries,
  getWebhookDelivery,
  createPreviewLink,
  listPreviewLinks,
  revokePreviewLink,
  setSetting,
  getAnalytics,
  getRawAnalyticsEvents,
  exportAll,
  importAll,
  listRedirects,
  createRedirect,
  getRedirect,
  updateRedirect,
  deleteRedirect,
  maybeSnapshotPage,
  snapshotArticle,
  listRevisions,
  getRevision,
  restorePageRevision,
  restoreArticleRevision,
  restorePageRevisionBlock,
  search,
  checkLinks,
  getSeoReport,
  getOrphanContent,
  getContentHealth,
  getTagCounts,
  listTopicMeta,
  setTopicMeta,
  deleteTopicMeta,
  listScans,
  getScan,
  createScan,
  updateScan,
  deleteScan,
  findScanUsage,
  listSimulations,
  getSimulation,
  createSimulation,
  updateSimulation,
  deleteSimulation,
  duplicateSimulation,
  listSongs,
  getSong,
  createSong,
  updateSong,
  deleteSong,
  duplicateSong,
  getBlockPageId,
  getBlockSharedId,
  listSharedBlocks,
  getSharedBlock,
  createSharedBlock,
  updateSharedBlock,
  deleteSharedBlock,
  findSharedBlockUsage,
  detachSharedBlock,
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  restoreProject,
  hardDeleteProject,
  listTrashedProjects,
  snapshotProject,
  restoreProjectRevision,
  listJournalEntries,
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  listBomItems,
  createBomItem,
  updateBomItem,
  deleteBomItem,
} from "./db.js";
import { checkPassword, createSessionCookie, clearSessionCookie, isAuthenticated } from "./auth.js";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

function normalizePath(p) {
  let s = String(p || "").trim();
  if (!s) return "";
  if (!s.startsWith("/")) s = "/" + s;
  if (s.length > 1) s = s.replace(/\/+$/, "");
  return s;
}

const SETTINGS_KEYS = [
  "default_og_image",
  "theme_accent",
  "theme_bg",
  "theme_font",
  "theme_text",
  "theme_border",
  "theme_heading_font",
  "site_footer",
  "custom_head",
  "webhook_url",
  "webhook_on_project_publish",
  "mobile_breakpoint",
  "empty_search_text",
  "empty_archive_text",
  "empty_topics_text",
];

// Paths a redirect could otherwise break by intercepting a system route.
const BLOCKED_REDIRECT_PREFIXES = ["/api", "/admin", "/media", "/sitemap.xml", "/rss.xml", "/robots.txt"];
function isBlockedRedirectPath(p) {
  return BLOCKED_REDIRECT_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + "/"));
}

// SVG is the one uploadable image format that's also a document format —
// it can carry <script>, event-handler attributes, and <foreignObject>
// (which can embed arbitrary HTML). Served from the site's own origin under
// a CSP that allows 'unsafe-inline' scripts (kept for the admin's trusted
// custom-head-code feature — see SECURITY_HEADERS in index.js), an
// unsanitized SVG would execute with the full privileges of that origin if
// ever opened directly or framed. This is a best-effort text-level strip,
// not a full XML-aware sanitizer, but it removes every known script vector
// without needing a DOM/XML parser (unavailable in Workers).
function sanitizeSvg(text) {
  return text
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s"'>]+/gi, "")
    .replace(/((?:xlink:)?href|src)\s*=\s*"\s*javascript:[^"]*"/gi, '$1="#"')
    .replace(/((?:xlink:)?href|src)\s*=\s*'\s*javascript:[^']*'/gi, "$1='#'");
}

// SHA-256 of the raw file bytes, hex-encoded — the actual pixels/bytes, so
// two uploads of the same underlying file always match regardless of
// filename, upload date, or which folder/tags they got afterward.
async function hashBytes(buf) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Optimistic-concurrency guard for the article/page editors: the client
// sends back the version number it last saw when it loaded (or last saved),
// and if the row has moved on since — another tab, another device, this
// same admin editing themselves twice — this refuses the blind overwrite
// rather than silently discarding whatever changed in between. A client
// that never sends expected_version (older cached admin JS, or an external
// API caller) just skips the check, same as before this existed.
// Uses a plain incrementing counter rather than comparing updated_at
// strings — datetime('now') in SQLite only has second resolution, so two
// updates within the same second (a fast test, or two tabs saving close
// together) would otherwise produce identical timestamps and silently
// defeat the check.
async function checkConflict(env, table, id, expectedVersion) {
  if (!expectedVersion) return null;
  const row = await env.DB.prepare(`SELECT version FROM ${table} WHERE id = ?`).bind(id).first();
  if (row && row.version !== expectedVersion) {
    return json(
      { error: "This was changed elsewhere since you loaded it. Reload to see the latest version before saving.", conflict: true },
      { status: 409 }
    );
  }
  return null;
}

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function handleAdminApi(request, env, url, ctx) {
  try {
    return await routeAdminApi(request, env, url, ctx);
  } catch (err) {
    return json({ error: err.message || "Something went wrong" }, { status: 500 });
  }
}

// Actually sends a webhook payload and records what happened either way —
// used both for the automatic publish-trigger below and for retrying a
// past delivery from the history list with the exact same payload.
async function deliverWebhook(env, webhookUrl, payload) {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await logWebhookDelivery(env, {
      url: webhookUrl,
      payload,
      status: res.ok ? "success" : "failed",
      status_code: res.status,
      error: res.ok ? null : `HTTP ${res.status}`,
    });
  } catch (err) {
    await logWebhookDelivery(env, { url: webhookUrl, payload, status: "failed", error: err.message || "Request failed" });
  }
}

// A configured webhook fires (best-effort, non-blocking) the moment an
// article transitions into "published" — not on every subsequent edit.
// contentType defaults to "article" (the original, always-on trigger) so
// every existing call site keeps working unchanged. Project publish is a
// second, separately configurable trigger — off by default, since it's
// new behavior an existing webhook consumer wasn't built to expect.
async function maybeFireWebhook(env, ctx, { wasPublished, article, contentType = "article" }) {
  if (wasPublished || !article.published_at || article.published_at > new Date().toISOString()) return;
  if (contentType === "project") {
    const enabled = await getSetting(env, "webhook_on_project_publish");
    if (!enabled) return;
  }
  const webhookUrl = await getSetting(env, "webhook_url");
  if (!webhookUrl) return;
  const path = contentType === "project" ? "projects" : "random";
  const payload = {
    contentType,
    title: article.title,
    slug: article.slug,
    url: `https://dominickdominick.com/${path}/${article.slug}`,
    published_at: article.published_at,
  };
  ctx.waitUntil(deliverWebhook(env, webhookUrl, payload));
}

// Fire-and-forget activity log write — never blocks or fails the request
// it's attached to.
function log(ctx, env, action, entityType, entityLabel, detail) {
  ctx.waitUntil(logActivity(env, action, entityType, entityLabel, detail).catch(() => {}));
}

// A slug change on something that's live breaks whatever already links to
// or bookmarked the old URL — auto-creating the redirect is a one-time
// courtesy, not a standing rule: it only fires the moment the slug
// actually changes, and never overwrites a redirect an admin already set
// up from that same old path (their choice wins).
async function maybeCreateSlugRedirect(env, ctx, { oldSlug, newSlug, pathPrefix, isLive }) {
  if (!isLive || !oldSlug || !newSlug || oldSlug === newSlug) return;
  const fromPath = `${pathPrefix}${oldSlug}`;
  const toPath = `${pathPrefix}${newSlug}`;
  if (isBlockedRedirectPath(fromPath) || fromPath === toPath) return;
  try {
    const existing = await getRedirect(env, fromPath);
    if (existing) return;
    await createRedirect(env, { from_path: fromPath, to_path: toPath, status_code: 301 });
    log(ctx, env, "create", "redirect", `${fromPath} → ${toPath} (auto, from slug change)`);
  } catch {
    // Best-effort courtesy, not a hard requirement — a failure here
    // (e.g. a race against a redirect created the same moment) shouldn't
    // fail the slug change itself.
  }
}

async function routeAdminApi(request, env, url, ctx) {
  const path = url.pathname.replace(/^\/api\/admin/, "");
  const method = request.method;

  if (path === "/login" && method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const allowed = await checkLoginRateLimit(env, ip);
    if (!allowed) {
      return json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
    }
    const body = await request.json().catch(() => ({}));
    await recordLoginAttempt(env, ip);
    const ok = await checkPassword(env, body.password);
    if (!ok) {
      log(ctx, env, "login_failed", "session", "Failed login attempt", ip);
      return json({ error: "Wrong password" }, { status: 401 });
    }
    log(ctx, env, "login", "session", "Admin login", ip);
    const cookie = await createSessionCookie(env);
    return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
  }

  if (path === "/logout" && method === "POST") {
    log(ctx, env, "logout", "session", "Admin logout", request.headers.get("CF-Connecting-IP") || "unknown");
    return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
  }

  if (path === "/me" && method === "GET") {
    const authed = await isAuthenticated(request, env);
    return json({ authenticated: authed });
  }

  // Everything past this point requires auth
  const authed = await isAuthenticated(request, env);
  if (!authed) return json({ error: "Unauthorized" }, { status: 401 });

  // /pages
  if (path === "/pages" && method === "GET") {
    return json(await listPages(env));
  }
  if (path === "/pages" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const slug = slugify(body.slug || body.title);
    if (!slug || RESERVED_SLUGS.has(slug)) {
      return json({ error: "Invalid or reserved slug" }, { status: 400 });
    }
    // Checked against every page regardless of trash status — the slug
    // column is unique at the DB level whether or not a page using it is
    // currently trashed, so a trashed page's slug can't be silently reused.
    if (await slugExists(env, "pages", slug)) return json({ error: "Slug already exists" }, { status: 409 });
    const id = await createPage(env, {
      slug,
      title: body.title || slug,
      meta_description: body.meta_description || "",
      nav_label: body.nav_label || null,
      nav_order: body.nav_order ?? null,
      og_image: body.og_image || null,
    });
    log(ctx, env, "create", "page", body.title || slug);
    return json({ id, slug });
  }
  const pageMatch = path.match(/^\/pages\/(\d+)$/);
  if (pageMatch && method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    const id = Number(pageMatch[1]);
    const conflict = await checkConflict(env, "pages", id, body.expected_version);
    if (conflict) return conflict;
    if (body.slug) {
      body.slug = slugify(body.slug);
      if (RESERVED_SLUGS.has(body.slug)) {
        return json({ error: "Reserved slug" }, { status: 400 });
      }
      if (await slugExists(env, "pages", body.slug, id)) {
        return json({ error: "A page with that slug already exists" }, { status: 409 });
      }
    }
    const beforePage = body.slug ? await env.DB.prepare("SELECT slug FROM pages WHERE id = ?").bind(id).first() : null;
    await updatePage(env, id, body);
    log(ctx, env, "update", "page", body.title || body.slug || `#${id}`);
    // The home page's slug ("home") maps to "/", not "/home" — every
    // other page is just "/" + its slug.
    if (body.slug && beforePage && beforePage.slug !== "home") {
      await maybeCreateSlugRedirect(env, ctx, { oldSlug: beforePage.slug, newSlug: body.slug, pathPrefix: "/", isLive: true });
    }
    const fresh = await env.DB.prepare("SELECT version FROM pages WHERE id = ?").bind(id).first();
    return json({ ok: true, version: fresh?.version });
  }
  if (pageMatch && method === "DELETE") {
    const id = Number(pageMatch[1]);
    const p = await env.DB.prepare("SELECT title FROM pages WHERE id = ?").bind(id).first();
    await deletePage(env, id);
    log(ctx, env, "trash", "page", p?.title || `#${id}`);
    return json({ ok: true });
  }
  const pageDuplicateMatch = path.match(/^\/pages\/(\d+)\/duplicate$/);
  if (pageDuplicateMatch && method === "POST") {
    const newId = await duplicatePage(env, Number(pageDuplicateMatch[1]));
    if (!newId) return json({ error: "Page not found" }, { status: 404 });
    log(ctx, env, "duplicate", "page", `#${pageDuplicateMatch[1]} → #${newId}`);
    return json({ id: newId });
  }
  if (path === "/pages/trash" && method === "GET") {
    return json(await listTrashedPages(env));
  }
  const pageRestoreMatch = path.match(/^\/pages\/(\d+)\/restore$/);
  if (pageRestoreMatch && method === "POST") {
    const id = Number(pageRestoreMatch[1]);
    await restorePage(env, id);
    const p = await env.DB.prepare("SELECT title FROM pages WHERE id = ?").bind(id).first();
    log(ctx, env, "restore", "page", p?.title || `#${id}`);
    return json({ ok: true });
  }
  const pagePermanentMatch = path.match(/^\/pages\/(\d+)\/permanent$/);
  if (pagePermanentMatch && method === "DELETE") {
    const id = Number(pagePermanentMatch[1]);
    const p = await env.DB.prepare("SELECT title FROM pages WHERE id = ?").bind(id).first();
    await hardDeletePage(env, id);
    log(ctx, env, "delete-forever", "page", p?.title || `#${id}`);
    return json({ ok: true });
  }

  // /pages/:id/blocks
  const blocksMatch = path.match(/^\/pages\/(\d+)\/blocks$/);
  if (blocksMatch && method === "GET") {
    return json(await listBlocks(env, Number(blocksMatch[1])));
  }
  if (blocksMatch && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const pageId = Number(blocksMatch[1]);
    await maybeSnapshotPage(env, pageId);
    const id = await createBlock(env, pageId, body);
    return json({ id });
  }

  // /blocks/:id
  const blockMatch = path.match(/^\/blocks\/(\d+)$/);
  if (blockMatch && method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    const id = Number(blockMatch[1]);
    const pageId = await getBlockPageId(env, id);
    if (pageId) await maybeSnapshotPage(env, pageId);
    // A reusable-block placement's content/style live on the shared_blocks
    // row, not this one — redirect those fields there so an edit updates
    // every page using it. Position fields (col/row/span) always stay
    // per-placement and go through updateBlock() as normal either way.
    const sharedId = await getBlockSharedId(env, id);
    if (sharedId && ("content" in body || "style" in body)) {
      const sharedFields = {};
      if ("content" in body) sharedFields.content = body.content;
      if ("style" in body) sharedFields.style = body.style;
      await updateSharedBlock(env, sharedId, sharedFields);
      delete body.content;
      delete body.style;
    }
    if (Object.keys(body).length) await updateBlock(env, id, body);
    return json({ ok: true });
  }
  if (blockMatch && method === "DELETE") {
    const id = Number(blockMatch[1]);
    const pageId = await getBlockPageId(env, id);
    if (pageId) await maybeSnapshotPage(env, pageId);
    await deleteBlock(env, id);
    return json({ ok: true });
  }
  const blockDetachMatch = path.match(/^\/blocks\/(\d+)\/detach$/);
  if (blockDetachMatch && method === "POST") {
    const id = Number(blockDetachMatch[1]);
    const pageId = await getBlockPageId(env, id);
    if (pageId) await maybeSnapshotPage(env, pageId);
    try {
      await detachSharedBlock(env, id);
    } catch (err) {
      return json({ error: err.message }, { status: 400 });
    }
    return json({ ok: true });
  }

  // /shared-blocks — reusable block library
  if (path === "/shared-blocks" && method === "GET") {
    return json(await listSharedBlocks(env));
  }
  if (path === "/shared-blocks" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!body.name || !String(body.name).trim() || !body.type) {
      return json({ error: "Name and a source block are required" }, { status: 400 });
    }
    const id = await createSharedBlock(env, { ...body, name: body.name.trim() });
    log(ctx, env, "create", "shared block", body.name.trim());
    return json({ id });
  }
  if (path === "/shared-blocks/usage" && method === "GET") {
    const sharedId = Number(url.searchParams.get("id"));
    if (!sharedId) return json({ error: "id required" }, { status: 400 });
    return json(await findSharedBlockUsage(env, sharedId));
  }
  const sharedBlockMatch = path.match(/^\/shared-blocks\/(\d+)$/);
  if (sharedBlockMatch && method === "GET") {
    const sb = await getSharedBlock(env, Number(sharedBlockMatch[1]));
    if (!sb) return json({ error: "Not found" }, { status: 404 });
    return json(sb);
  }
  if (sharedBlockMatch && method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    if ("name" in body && !String(body.name).trim()) return json({ error: "Name is required" }, { status: 400 });
    await updateSharedBlock(env, Number(sharedBlockMatch[1]), body);
    return json({ ok: true });
  }
  if (sharedBlockMatch && method === "DELETE") {
    const id = Number(sharedBlockMatch[1]);
    const sb = await getSharedBlock(env, id);
    await deleteSharedBlock(env, id);
    log(ctx, env, "delete", "shared block", sb?.name || `#${id}`);
    return json({ ok: true });
  }

  // /articles
  if (path === "/articles" && method === "GET") {
    return json(await listArticles(env));
  }
  if (path === "/articles" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const slug = slugify(body.slug || body.title);
    if (!slug) return json({ error: "Title or slug required" }, { status: 400 });
    if (RESERVED_SLUGS.has(slug)) return json({ error: "Reserved slug" }, { status: 400 });
    if (await slugExists(env, "articles", slug)) {
      return json({ error: "An article with that slug already exists" }, { status: 409 });
    }
    const id = await createArticle(env, { ...body, slug });
    log(ctx, env, "create", "article", body.title || slug);
    await maybeFireWebhook(env, ctx, {
      wasPublished: false,
      article: { title: body.title, slug, published_at: body.published_at },
    });
    return json({ id, slug });
  }
  const articleMatch = path.match(/^\/articles\/(\d+)$/);
  if (articleMatch && method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    const id = Number(articleMatch[1]);
    const conflict = await checkConflict(env, "articles", id, body.expected_version);
    if (conflict) return conflict;
    if (body.slug) {
      body.slug = slugify(body.slug);
      if (await slugExists(env, "articles", body.slug, id)) {
        return json({ error: "An article with that slug already exists" }, { status: 409 });
      }
    }
    const before = await env.DB.prepare("SELECT slug, title, published_at FROM articles WHERE id = ?").bind(id).first();
    await snapshotArticle(env, id);
    await updateArticle(env, id, body);
    const wasPublished = !!(before && before.published_at && before.published_at <= new Date().toISOString());
    const newPublishedAt = "published_at" in body ? body.published_at : before && before.published_at;
    const isNowPublished = !!(newPublishedAt && newPublishedAt <= new Date().toISOString());
    if (body.slug && before) {
      await maybeCreateSlugRedirect(env, ctx, { oldSlug: before.slug, newSlug: body.slug, pathPrefix: "/random/", isLive: wasPublished });
    }
    // Only the publish/unpublish transition is logged — plain content edits
    // fire this same endpoint every couple of seconds via autosave, which
    // would otherwise flood the log with noise revisions already capture.
    if (wasPublished !== isNowPublished) {
      log(ctx, env, isNowPublished ? "publish" : "unpublish", "article", body.title || (before && before.title));
    }
    await maybeFireWebhook(env, ctx, {
      wasPublished,
      article: {
        title: body.title || (before && before.title),
        slug: body.slug || (before && before.slug),
        published_at: newPublishedAt,
      },
    });
    const fresh = await env.DB.prepare("SELECT version, slug FROM articles WHERE id = ?").bind(id).first();
    return json({ ok: true, version: fresh?.version, slug: fresh?.slug });
  }
  if (articleMatch && method === "DELETE") {
    const id = Number(articleMatch[1]);
    const a = await env.DB.prepare("SELECT title FROM articles WHERE id = ?").bind(id).first();
    await deleteArticle(env, id);
    log(ctx, env, "trash", "article", a?.title || `#${id}`);
    return json({ ok: true });
  }
  if (path === "/articles/bulk" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) return json({ error: "No articles selected" }, { status: 400 });
    if (!["publish", "unpublish", "trash", "add-tag"].includes(body.action)) {
      return json({ error: "Invalid action" }, { status: 400 });
    }
    const result = await bulkArticleAction(env, ids, body.action, { tag: body.tag });
    log(ctx, env, body.action, "article", `${result.affected} article(s)${result.skippedLocked ? `, ${result.skippedLocked} skipped (locked)` : ""}`);
    return json({ ok: true, ...result });
  }
  if (path === "/articles/trash" && method === "GET") {
    return json(await listTrashedArticles(env));
  }
  const articleRestoreMatch = path.match(/^\/articles\/(\d+)\/restore$/);
  if (articleRestoreMatch && method === "POST") {
    const id = Number(articleRestoreMatch[1]);
    await restoreArticle(env, id);
    const a = await env.DB.prepare("SELECT title FROM articles WHERE id = ?").bind(id).first();
    log(ctx, env, "restore", "article", a?.title || `#${id}`);
    return json({ ok: true });
  }
  const articlePermanentMatch = path.match(/^\/articles\/(\d+)\/permanent$/);
  if (articlePermanentMatch && method === "DELETE") {
    const id = Number(articlePermanentMatch[1]);
    const a = await env.DB.prepare("SELECT title FROM articles WHERE id = ?").bind(id).first();
    await hardDeleteArticle(env, id);
    log(ctx, env, "delete-forever", "article", a?.title || `#${id}`);
    return json({ ok: true });
  }
  const articleDuplicateMatch = path.match(/^\/articles\/(\d+)\/duplicate$/);
  if (articleDuplicateMatch && method === "POST") {
    const newId = await duplicateArticle(env, Number(articleDuplicateMatch[1]));
    if (!newId) return json({ error: "Article not found" }, { status: 404 });
    log(ctx, env, "duplicate", "article", `#${articleDuplicateMatch[1]} → #${newId}`);
    return json({ id: newId });
  }
  const articleConvertMatch = path.match(/^\/articles\/(\d+)\/convert-to-project$/);
  if (articleConvertMatch && method === "POST") {
    const newId = await convertArticleToProject(env, Number(articleConvertMatch[1]));
    if (!newId) return json({ error: "Article not found" }, { status: 404 });
    log(ctx, env, "convert", "article→project", `#${articleConvertMatch[1]} → project #${newId}`);
    return json({ id: newId });
  }

  // /projects
  if (path === "/projects" && method === "GET") {
    return json(await listProjects(env));
  }
  if (path === "/projects" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const slug = slugify(body.slug || body.title);
    if (!slug) return json({ error: "Title or slug required" }, { status: 400 });
    if (RESERVED_SLUGS.has(slug)) return json({ error: "Reserved slug" }, { status: 400 });
    if (await slugExists(env, "projects", slug)) {
      return json({ error: "A project with that slug already exists" }, { status: 409 });
    }
    const id = await createProject(env, { ...body, slug });
    log(ctx, env, "create", "project", body.title || slug);
    await maybeFireWebhook(env, ctx, {
      wasPublished: false,
      article: { title: body.title, slug, published_at: body.published_at },
      contentType: "project",
    });
    return json({ id, slug });
  }
  const projectMatch = path.match(/^\/projects\/(\d+)$/);
  if (projectMatch && method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    const id = Number(projectMatch[1]);
    const conflict = await checkConflict(env, "projects", id, body.expected_version);
    if (conflict) return conflict;
    if (body.slug) {
      body.slug = slugify(body.slug);
      if (await slugExists(env, "projects", body.slug, id)) {
        return json({ error: "A project with that slug already exists" }, { status: 409 });
      }
    }
    const before = await env.DB.prepare("SELECT slug, title, published_at FROM projects WHERE id = ?").bind(id).first();
    await snapshotProject(env, id);
    await updateProject(env, id, body);
    const wasPublished = !!(before && before.published_at && before.published_at <= new Date().toISOString());
    const newPublishedAt = "published_at" in body ? body.published_at : before && before.published_at;
    const isNowPublished = !!(newPublishedAt && newPublishedAt <= new Date().toISOString());
    if (wasPublished !== isNowPublished) {
      log(ctx, env, isNowPublished ? "publish" : "unpublish", "project", body.title || (before && before.title));
    }
    if (body.slug && before) {
      await maybeCreateSlugRedirect(env, ctx, { oldSlug: before.slug, newSlug: body.slug, pathPrefix: "/projects/", isLive: wasPublished });
    }
    await maybeFireWebhook(env, ctx, {
      wasPublished,
      article: {
        title: body.title || (before && before.title),
        slug: body.slug || (before && before.slug),
        published_at: newPublishedAt,
      },
      contentType: "project",
    });
    const fresh = await env.DB.prepare("SELECT version, slug FROM projects WHERE id = ?").bind(id).first();
    return json({ ok: true, version: fresh?.version, slug: fresh?.slug });
  }
  if (projectMatch && method === "DELETE") {
    const id = Number(projectMatch[1]);
    const p = await env.DB.prepare("SELECT title FROM projects WHERE id = ?").bind(id).first();
    await deleteProject(env, id);
    log(ctx, env, "trash", "project", p?.title || `#${id}`);
    return json({ ok: true });
  }
  if (path === "/projects/bulk" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) return json({ error: "No projects selected" }, { status: 400 });
    if (!["publish", "unpublish", "trash", "add-tag"].includes(body.action)) {
      return json({ error: "Invalid action" }, { status: 400 });
    }
    const result = await bulkProjectAction(env, ids, body.action, { tag: body.tag });
    log(ctx, env, body.action, "project", `${result.affected} project(s)${result.skippedLocked ? `, ${result.skippedLocked} skipped (locked)` : ""}`);
    return json({ ok: true, ...result });
  }
  if (path === "/projects/trash" && method === "GET") {
    return json(await listTrashedProjects(env));
  }
  const projectRestoreMatch = path.match(/^\/projects\/(\d+)\/restore$/);
  if (projectRestoreMatch && method === "POST") {
    const id = Number(projectRestoreMatch[1]);
    await restoreProject(env, id);
    const p = await env.DB.prepare("SELECT title FROM projects WHERE id = ?").bind(id).first();
    log(ctx, env, "restore", "project", p?.title || `#${id}`);
    return json({ ok: true });
  }
  const projectPermanentMatch = path.match(/^\/projects\/(\d+)\/permanent$/);
  if (projectPermanentMatch && method === "DELETE") {
    const id = Number(projectPermanentMatch[1]);
    const p = await env.DB.prepare("SELECT title FROM projects WHERE id = ?").bind(id).first();
    await hardDeleteProject(env, id);
    log(ctx, env, "delete-forever", "project", p?.title || `#${id}`);
    return json({ ok: true });
  }
  const projectDuplicateMatch = path.match(/^\/projects\/(\d+)\/duplicate$/);
  if (projectDuplicateMatch && method === "POST") {
    const newId = await duplicateProject(env, Number(projectDuplicateMatch[1]));
    if (!newId) return json({ error: "Project not found" }, { status: 404 });
    log(ctx, env, "duplicate", "project", `#${projectDuplicateMatch[1]} → #${newId}`);
    return json({ id: newId });
  }

  // /projects/:id/journal — a project's build journal entries
  const journalListMatch = path.match(/^\/projects\/(\d+)\/journal$/);
  if (journalListMatch && method === "GET") {
    return json(await listJournalEntries(env, Number(journalListMatch[1])));
  }
  if (journalListMatch && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const projectId = Number(journalListMatch[1]);
    const id = await createJournalEntry(env, projectId, body);
    log(ctx, env, "create", "journal entry", body.title || `on project #${projectId}`);
    return json({ id });
  }
  const journalMatch = path.match(/^\/journal\/(\d+)$/);
  if (journalMatch && method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    await updateJournalEntry(env, Number(journalMatch[1]), body);
    return json({ ok: true });
  }
  if (journalMatch && method === "DELETE") {
    await deleteJournalEntry(env, Number(journalMatch[1]));
    log(ctx, env, "delete", "journal entry", `#${journalMatch[1]}`);
    return json({ ok: true });
  }

  // /projects/:id/bom — a project's bill of materials
  const bomListMatch = path.match(/^\/projects\/(\d+)\/bom$/);
  if (bomListMatch && method === "GET") {
    return json(await listBomItems(env, Number(bomListMatch[1])));
  }
  if (bomListMatch && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const id = await createBomItem(env, Number(bomListMatch[1]), body);
    return json({ id });
  }
  const bomMatch = path.match(/^\/bom\/(\d+)$/);
  if (bomMatch && method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    await updateBomItem(env, Number(bomMatch[1]), body);
    return json({ ok: true });
  }
  if (bomMatch && method === "DELETE") {
    await deleteBomItem(env, Number(bomMatch[1]));
    return json({ ok: true });
  }

  // /upload — image files only, 8MB cap. An optional ?folder= query param
  // files the upload into that folder from the moment it lands.
  if (path === "/upload" && method === "POST") {
    const contentType = request.headers.get("Content-Type") || "";
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
    if (!allowed.includes(contentType)) {
      return json({ error: "Only PNG, JPEG, WebP, GIF, or SVG images are allowed" }, { status: 400 });
    }
    let buf = await request.arrayBuffer();
    if (buf.byteLength > 8 * 1024 * 1024) {
      return json({ error: "File too large (8MB max)" }, { status: 400 });
    }
    if (contentType === "image/svg+xml") {
      const cleaned = sanitizeSvg(new TextDecoder().decode(buf));
      buf = new TextEncoder().encode(cleaned).buffer;
    }
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" }[
      contentType
    ];
    const hash = await hashBytes(buf);
    const duplicate = await env.DB.prepare("SELECT key FROM media WHERE hash = ? LIMIT 1").bind(hash).first();
    const key = `uploads/${crypto.randomUUID()}.${ext}`;
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType } });
    const folder = url.searchParams.get("folder");
    await upsertMediaMeta(env, key, { folder: folder || undefined, hash });
    log(ctx, env, "upload", "media", key.split("/").pop());
    return json({ url: `/media/${key}`, duplicateOf: duplicate ? `/media/${duplicate.key}` : null });
  }

  // /upload-audio — TTS narration files for the article/project audio
  // player, kept separate from /upload (images only) rather than widening
  // that route's scope. 30MB covers a long narration at a reasonable
  // bitrate without needing a resumable-upload flow.
  if (path === "/upload-audio" && method === "POST") {
    const contentType = request.headers.get("Content-Type") || "";
    const allowed = { "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg" };
    if (!allowed[contentType]) {
      return json({ error: "Only MP3, WAV, M4A, or OGG audio files are allowed" }, { status: 400 });
    }
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 30 * 1024 * 1024) {
      return json({ error: "File too large (30MB max)" }, { status: 400 });
    }
    const key = `audio/${crypto.randomUUID()}.${allowed[contentType]}`;
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType } });
    log(ctx, env, "upload", "audio", key.split("/").pop());
    return json({ url: `/media/${key}`, key });
  }

  // /upload-video — a project's hero video, kept separate from /upload
  // (images only) for the same reason as /upload-audio above: one file per
  // project, not a reusable Media Library asset. 40MB covers a short muted
  // background loop at a reasonable bitrate without a resumable-upload flow.
  if (path === "/upload-video" && method === "POST") {
    const contentType = request.headers.get("Content-Type") || "";
    const allowed = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
    if (!allowed[contentType]) {
      return json({ error: "Only MP4, WebM, or MOV video files are allowed" }, { status: 400 });
    }
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 40 * 1024 * 1024) {
      return json({ error: "File too large (40MB max)" }, { status: 400 });
    }
    const key = `video/${crypto.randomUUID()}.${allowed[contentType]}`;
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType } });
    log(ctx, env, "upload", "video", key.split("/").pop());
    return json({ url: `/media/${key}`, key });
  }

  // /media — list uploaded files (enriched with folder/tags/alt text), for
  // the media library picker.
  if (path === "/media" && method === "GET") {
    const listed = await env.MEDIA.list({ prefix: "uploads/", limit: 500 });
    const objects = listed.objects.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
    const [meta, usedUrls, duplicateGroups] = await Promise.all([
      getMediaMeta(env, objects.map((o) => o.key)),
      getAllUsedMediaUrls(env),
      getDuplicateMediaHashes(env),
    ]);
    const duplicateKeys = new Set(duplicateGroups.flatMap((g) => g.keys));
    const items = objects.map((o) => {
      const url = `/media/${o.key}`;
      return {
        key: o.key,
        url,
        size: o.size,
        uploaded: o.uploaded,
        folder: meta[o.key]?.folder || null,
        tags: meta[o.key]?.tags || [],
        alt_text: meta[o.key]?.alt_text || null,
        caption: meta[o.key]?.caption || null,
        credit: meta[o.key]?.credit || null,
        license: meta[o.key]?.license || null,
        hash: meta[o.key]?.hash || null,
        isDuplicate: duplicateKeys.has(o.key),
        used: usedUrls.has(url),
      };
    });
    return json(items);
  }
  if (path === "/media/folders" && method === "GET") {
    return json(await listMediaFolders(env));
  }
  // /media/backfill-hashes — one-time (well, re-runnable, but only does
  // anything the first time) pass over uploads from before hashing
  // existed. Skips anything that already has a hash, so re-running after
  // new plain uploads is cheap and safe.
  if (path === "/media/backfill-hashes" && method === "POST") {
    const listed = await env.MEDIA.list({ prefix: "uploads/", limit: 500 });
    const meta = await getMediaMeta(env, listed.objects.map((o) => o.key));
    const missing = listed.objects.filter((o) => !meta[o.key]?.hash);
    let hashed = 0;
    for (const o of missing) {
      const obj = await env.MEDIA.get(o.key);
      if (!obj) continue;
      const hash = await hashBytes(await obj.arrayBuffer());
      await upsertMediaMeta(env, o.key, { hash });
      hashed++;
    }
    return json({ hashed, alreadyHashed: listed.objects.length - missing.length });
  }
  if (path === "/media/usage" && method === "GET") {
    const mediaUrl = url.searchParams.get("url");
    if (!mediaUrl) return json({ error: "url required" }, { status: 400 });
    return json(await findMediaUsage(env, mediaUrl));
  }
  if (path === "/media/bulk-delete" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (!keys.length) return json({ error: "No files selected" }, { status: 400 });
    await Promise.all(keys.map((k) => Promise.all([env.MEDIA.delete(k), deleteMediaMeta(env, k)])));
    log(ctx, env, "delete", "media", `${keys.length} file(s)`);
    return json({ ok: true });
  }
  // Bulk move (set folder) and/or bulk tag (add one tag, keeping each
  // file's existing tags) across a selection — same shape as bulk-delete,
  // since both come from the same selection checkboxes in the library grid.
  if (path === "/media/bulk-update" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (!keys.length) return json({ error: "No files selected" }, { status: 400 });
    if (body.folder === undefined && !body.addTag) return json({ error: "Nothing to update" }, { status: 400 });
    if (body.addTag) {
      const meta = await getMediaMeta(env, keys);
      await Promise.all(
        keys.map((k) => {
          const tags = meta[k]?.tags || [];
          const patch = { tags: tags.includes(body.addTag) ? tags : [...tags, body.addTag] };
          if (body.folder !== undefined) patch.folder = body.folder;
          return upsertMediaMeta(env, k, patch);
        })
      );
    } else {
      await Promise.all(keys.map((k) => upsertMediaMeta(env, k, { folder: body.folder })));
    }
    log(ctx, env, "update", "media", `${keys.length} file(s)`);
    return json({ ok: true });
  }
  const mediaKeyMatch = path.match(/^\/media\/(.+)$/);
  if (mediaKeyMatch && method === "DELETE") {
    const versions = await listMediaVersions(env, mediaKeyMatch[1]);
    await Promise.all(versions.map((v) => env.MEDIA.delete(v.version_key)));
    await deleteMediaVersions(env, mediaKeyMatch[1]);
    await env.MEDIA.delete(mediaKeyMatch[1]);
    await deleteMediaMeta(env, mediaKeyMatch[1]);
    log(ctx, env, "delete", "media", mediaKeyMatch[1].split("/").pop());
    return json({ ok: true });
  }
  if (mediaKeyMatch && method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    await upsertMediaMeta(env, mediaKeyMatch[1], body);
    return json({ ok: true });
  }
  // /media-revisions?key=... — a query param rather than a path segment,
  // since a media key itself contains slashes (uploads/xxx.png), which
  // would collide with a /media/:key/revisions-style route.
  if (path === "/media-revisions" && method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) return json({ error: "key is required" }, { status: 400 });
    return json(await listMediaRevisions(env, key));
  }
  const mediaRevisionRestoreMatch = path.match(/^\/media-revisions\/(\d+)\/restore$/);
  if (mediaRevisionRestoreMatch && method === "POST") {
    await restoreMediaRevision(env, Number(mediaRevisionRestoreMatch[1]));
    log(ctx, env, "restore", "media-revision", mediaRevisionRestoreMatch[1]);
    return json({ ok: true });
  }
  // Overwrites an existing upload's bytes in place — same key, same public
  // URL — used by the photo editor's "Overwrite original" save. The bytes
  // being replaced are archived first (under a `_versions/` prefix, kept
  // out of the main `uploads/` listing) so the overwrite itself can be
  // undone later, the one gap plain in-place replacement otherwise has.
  if (mediaKeyMatch && method === "PUT") {
    const contentType = request.headers.get("Content-Type") || "";
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowed.includes(contentType)) {
      return json({ error: "Only PNG, JPEG, WebP, or GIF images are allowed" }, { status: 400 });
    }
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 8 * 1024 * 1024) {
      return json({ error: "File too large (8MB max)" }, { status: 400 });
    }
    const key = mediaKeyMatch[1];
    const existingObj = await env.MEDIA.get(key);
    if (!existingObj) return json({ error: "Original file not found" }, { status: 404 });
    const versionKey = `_versions/${key}/${Date.now()}`;
    await env.MEDIA.put(versionKey, await existingObj.arrayBuffer(), { httpMetadata: existingObj.httpMetadata });
    await recordMediaVersion(env, key, versionKey, existingObj.size);
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType } });
    return json({ url: `/media/${key}` });
  }
  // /media-file-versions?key=... — same reasoning as /media-revisions:
  // a query param, not a path segment, since a media key contains slashes.
  if (path === "/media-file-versions" && method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) return json({ error: "key is required" }, { status: 400 });
    const versions = await listMediaVersions(env, key);
    // Archived bytes live under `_versions/`, which the public /media/:key
    // route deliberately doesn't serve (only uploads/scans/audio) — this
    // admin-only image route is how the History panel's thumbnail loads.
    return json(versions.map((v) => ({ ...v, url: `/api/admin/media-file-versions/${v.id}/image` })));
  }
  const mediaFileVersionImageMatch = path.match(/^\/media-file-versions\/(\d+)\/image$/);
  if (mediaFileVersionImageMatch && method === "GET") {
    const version = await getMediaVersion(env, Number(mediaFileVersionImageMatch[1]));
    if (!version) return new Response("Not found", { status: 404 });
    const obj = await env.MEDIA.get(version.version_key);
    if (!obj) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("Cache-Control", "private, max-age=3600");
    return new Response(obj.body, { headers });
  }
  const mediaFileVersionRestoreMatch = path.match(/^\/media-file-versions\/(\d+)\/restore$/);
  if (mediaFileVersionRestoreMatch && method === "POST") {
    const version = await getMediaVersion(env, Number(mediaFileVersionRestoreMatch[1]));
    if (!version) return json({ error: "Version not found" }, { status: 404 });
    const versionObj = await env.MEDIA.get(version.version_key);
    if (!versionObj) return json({ error: "Archived file is missing" }, { status: 404 });
    // The current (about-to-be-replaced) bytes get archived too, exactly
    // like a normal overwrite would — restoring is just another
    // overwrite, so it's undoable the same way.
    const currentObj = await env.MEDIA.get(version.media_key);
    if (currentObj) {
      const preRestoreKey = `_versions/${version.media_key}/${Date.now()}`;
      await env.MEDIA.put(preRestoreKey, await currentObj.arrayBuffer(), { httpMetadata: currentObj.httpMetadata });
      await recordMediaVersion(env, version.media_key, preRestoreKey, currentObj.size);
    }
    await env.MEDIA.put(version.media_key, await versionObj.arrayBuffer(), { httpMetadata: versionObj.httpMetadata });
    log(ctx, env, "restore", "media-file-version", version.media_key);
    return json({ ok: true });
  }

  // ---------- 3D scans ----------
  // The .glb/.usdz model files, uploaded separately from the poster image
  // (which reuses the existing /upload endpoint above — it's a plain image).
  // Real LiDAR/photogrammetry scans run much bigger than a photo, so these
  // caps are deliberately far above the 8MB image limit — but still capped
  // well under Workers' request-body/memory ceiling, since the whole file
  // is buffered in the Worker before being written to R2. A scan larger
  // than this needs to be compressed/decimated (Polycam, Reality Composer,
  // etc.) before uploading.
  const SCAN_FILE_LIMITS = {
    glb: { maxBytes: 80 * 1024 * 1024, ext: "glb", contentType: "model/gltf-binary" },
    gltf: { maxBytes: 80 * 1024 * 1024, ext: "gltf", contentType: "model/gltf+json" },
    usdz: { maxBytes: 30 * 1024 * 1024, ext: "usdz", contentType: "model/vnd.usdz+zip" },
  };
  if (path === "/scan-upload" && method === "POST") {
    const kind = url.searchParams.get("kind");
    const limits = SCAN_FILE_LIMITS[kind];
    if (!limits) return json({ error: "Invalid or missing ?kind= (glb, gltf, or usdz)" }, { status: 400 });
    const buf = await request.arrayBuffer();
    if (buf.byteLength > limits.maxBytes) {
      return json({ error: `File too large (${Math.round(limits.maxBytes / (1024 * 1024))}MB max)` }, { status: 400 });
    }
    const key = `scans/${crypto.randomUUID()}.${limits.ext}`;
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType: limits.contentType } });
    return json({ key, url: `/media/${key}`, size: buf.byteLength });
  }

  if (path === "/scans" && method === "GET") {
    return json(await listScans(env));
  }
  if (path === "/scans" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!body.name || !String(body.name).trim() || !body.glb_key) {
      return json({ error: "Name and a GLB/GLTF file are required" }, { status: 400 });
    }
    const id = await createScan(env, { ...body, name: body.name.trim() });
    log(ctx, env, "create", "scan", body.name.trim());
    return json({ id });
  }
  if (path === "/scans/usage" && method === "GET") {
    const scanId = Number(url.searchParams.get("id"));
    if (!scanId) return json({ error: "id required" }, { status: 400 });
    return json(await findScanUsage(env, scanId));
  }
  const scanMatch = path.match(/^\/scans\/(\d+)$/);
  if (scanMatch && method === "GET") {
    const scan = await getScan(env, Number(scanMatch[1]));
    if (!scan) return json({ error: "Not found" }, { status: 404 });
    return json(scan);
  }
  if (scanMatch && method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    if ("name" in body && !String(body.name).trim()) return json({ error: "Name is required" }, { status: 400 });
    const id = Number(scanMatch[1]);
    const before = await getScan(env, id);
    await updateScan(env, id, body);
    // glb_key/usdz_key point at files dedicated to this scan (not shared
    // media-library references), so replacing one with a re-upload needs to
    // clean up the old R2 object here — otherwise it's orphaned forever.
    if (before) {
      const cleanups = [];
      if ("glb_key" in body && body.glb_key !== before.glb_key && before.glb_key) cleanups.push(before.glb_key);
      if ("usdz_key" in body && body.usdz_key !== before.usdz_key && before.usdz_key) cleanups.push(before.usdz_key);
      await Promise.all(cleanups.map((k) => env.MEDIA.delete(k).catch(() => {})));
    }
    return json({ ok: true });
  }
  if (scanMatch && method === "DELETE") {
    const id = Number(scanMatch[1]);
    const scan = await getScan(env, id);
    await deleteScan(env, id);
    if (scan) {
      // The model files are dedicated to this scan (not a shared media
      // library resource), so they're cleaned up here. The poster image,
      // if set, usually comes from the shared media library — left alone,
      // same as every other feature that just references a media URL.
      await Promise.all(
        [scan.glb_key, scan.usdz_key].filter(Boolean).map((k) => env.MEDIA.delete(k).catch(() => {}))
      );
    }
    log(ctx, env, "delete", "scan", scan?.name || `#${id}`);
    return json({ ok: true });
  }

  // /redirects
  if (path === "/redirects" && method === "GET") {
    return json(await listRedirects(env));
  }
  if (path === "/redirects" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const from_path = normalizePath(body.from_path);
    const to_path = String(body.to_path || "").trim();
    if (!from_path || !to_path) return json({ error: "Both a from and to path are required" }, { status: 400 });
    if (isBlockedRedirectPath(from_path)) {
      return json({ error: "That path is reserved and can't be redirected" }, { status: 400 });
    }
    if (from_path === to_path) return json({ error: "A path can't redirect to itself" }, { status: 400 });
    try {
      const id = await createRedirect(env, { from_path, to_path, status_code: Number(body.status_code) || 301 });
      log(ctx, env, "create", "redirect", `${from_path} → ${to_path}`);
      return json({ id });
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) {
        return json({ error: "A redirect from that path already exists" }, { status: 409 });
      }
      throw err;
    }
  }
  const redirectMatch = path.match(/^\/redirects\/(\d+)$/);
  if (redirectMatch && method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    const fields = {};
    if (body.from_path !== undefined) fields.from_path = normalizePath(body.from_path);
    if (body.to_path !== undefined) fields.to_path = String(body.to_path).trim();
    if (body.status_code !== undefined) fields.status_code = Number(body.status_code) || 301;
    if (fields.from_path && isBlockedRedirectPath(fields.from_path)) {
      return json({ error: "That path is reserved and can't be redirected" }, { status: 400 });
    }
    try {
      await updateRedirect(env, Number(redirectMatch[1]), fields);
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) {
        return json({ error: "A redirect from that path already exists" }, { status: 409 });
      }
      throw err;
    }
    return json({ ok: true });
  }
  if (redirectMatch && method === "DELETE") {
    const id = Number(redirectMatch[1]);
    const r = await env.DB.prepare("SELECT from_path, to_path FROM redirects WHERE id = ?").bind(id).first();
    await deleteRedirect(env, id);
    log(ctx, env, "delete", "redirect", r ? `${r.from_path} → ${r.to_path}` : `#${id}`);
    return json({ ok: true });
  }

  // /search — pages, articles, and blocks matching a text query
  if (path === "/search" && method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return json({ pages: [], articles: [], blocks: [] });
    return json(await search(env, q));
  }

  // /link-check — walks every button/project-card/article link and reports status
  if (path === "/link-check" && method === "GET") {
    return json(await checkLinks(env));
  }

  // /seo-report — pages missing a meta description, and image blocks
  // missing alt text, across the whole site.
  if (path === "/seo-report" && method === "GET") {
    return json(await getSeoReport(env));
  }

  // /orphan-content — published pages/articles/projects nothing internally
  // links to and that aren't in the header nav either.
  if (path === "/orphan-content" && method === "GET") {
    return json(await getOrphanContent(env));
  }

  // /content-health — site-wide empty-page and stale-content inventory.
  if (path === "/content-health" && method === "GET") {
    return json(await getContentHealth(env));
  }

  // /topic-meta — optional per-tag description/share-image override for
  // /topics/:tag landing pages. GET lists every known tag (from real
  // content, via getTagCounts) alongside any custom meta already saved
  // for it, so the admin UI can show one row per tag whether or not it's
  // been customized yet.
  if (path === "/topic-meta" && method === "GET") {
    const [tags, metaRows] = await Promise.all([getTagCounts(env), listTopicMeta(env)]);
    const metaByTag = new Map(metaRows.map((m) => [m.tag, m]));
    return json(
      tags.map((t) => ({ tag: t.tag, count: t.count, description: metaByTag.get(t.tag)?.description || "", og_image: metaByTag.get(t.tag)?.og_image || "" }))
    );
  }
  if (path === "/topic-meta" && method === "PUT") {
    const body = await request.json().catch(() => ({}));
    if (!body.tag) return json({ error: "tag is required" }, { status: 400 });
    if (!body.description && !body.og_image) {
      await deleteTopicMeta(env, body.tag);
    } else {
      await setTopicMeta(env, body.tag, { description: body.description, og_image: body.og_image });
    }
    log(ctx, env, "update", "topic-meta", body.tag);
    return json({ ok: true });
  }

  // /preview-links — shareable, expiring, revocable links that let someone
  // without an admin login view an unpublished article/project.
  if (path === "/preview-links" && method === "GET") {
    const contentType = url.searchParams.get("contentType");
    const contentId = Number(url.searchParams.get("contentId"));
    if (!["article", "project"].includes(contentType) || !Number.isFinite(contentId)) {
      return json({ error: "Invalid content" }, { status: 400 });
    }
    return json(await listPreviewLinks(env, contentType, contentId));
  }
  if (path === "/preview-links" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!["article", "project"].includes(body.contentType) || !Number.isFinite(Number(body.contentId))) {
      return json({ error: "Invalid content" }, { status: 400 });
    }
    const hours = Number.isFinite(Number(body.hours)) ? Number(body.hours) : 24 * 7;
    const link = await createPreviewLink(env, body.contentType, Number(body.contentId), hours);
    log(ctx, env, "create", "preview-link", `${body.contentType} #${body.contentId}`);
    return json(link);
  }
  const previewLinkRevokeMatch = path.match(/^\/preview-links\/(\d+)\/revoke$/);
  if (previewLinkRevokeMatch && method === "POST") {
    await revokePreviewLink(env, Number(previewLinkRevokeMatch[1]));
    return json({ ok: true });
  }

  if (path === "/webhook-deliveries" && method === "GET") {
    return json(await listWebhookDeliveries(env));
  }
  // Re-sends the exact same payload that was recorded at the time — not a
  // fresh one built from the article's current state, since the article
  // may have changed since (retrying should reproduce what should have
  // been delivered then, not send a different event under the same id).
  const webhookRetryMatch = path.match(/^\/webhook-deliveries\/(\d+)\/retry$/);
  if (webhookRetryMatch && method === "POST") {
    const delivery = await getWebhookDelivery(env, Number(webhookRetryMatch[1]));
    if (!delivery) return json({ error: "Not found" }, { status: 404 });
    await deliverWebhook(env, delivery.url, delivery.payload);
    log(ctx, env, "webhook-retry", "webhook", delivery.payload?.title || delivery.url);
    return json({ ok: true });
  }

  // /find-replace — apply=false previews matches without changing anything;
  // apply=true rewrites them (each touched page/article is snapshotted
  // first, so it's undoable via History).
  if (path === "/find-replace" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const find = String(body.find || "");
    if (!find) return json({ error: "Find text is required" }, { status: 400 });
    const replace = String(body.replace ?? "");
    const apply = !!body.apply;
    const results = await runFindReplace(env, { find, replace, apply });
    if (apply && results.length) log(ctx, env, "find-replace", "site", `"${find}" → "${replace}"`, `${results.length} field(s)`);
    return json({ results, applied: apply });
  }

  // /revisions?kind=page|article|project&id=N — history for a page's blocks,
  // an article, or a project
  if (path === "/revisions" && method === "GET") {
    const kind = url.searchParams.get("kind");
    const id = Number(url.searchParams.get("id"));
    if (!["page", "article", "project"].includes(kind) || !id) {
      return json({ error: "Invalid kind/id" }, { status: 400 });
    }
    return json(await listRevisions(env, kind, id));
  }
  // /revisions/:id — a single revision's full snapshot, for a diff preview
  // before committing to restoring it.
  const revisionDetailMatch = path.match(/^\/revisions\/(\d+)$/);
  if (revisionDetailMatch && method === "GET") {
    const rev = await getRevision(env, Number(revisionDetailMatch[1]));
    if (!rev) return json({ error: "Not found" }, { status: 404 });
    return json(rev);
  }
  const restoreMatch = path.match(/^\/revisions\/(\d+)\/restore$/);
  if (restoreMatch && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const revisionId = Number(restoreMatch[1]);
    const entityId = Number(body.entity_id);
    try {
      if (body.kind === "page") await restorePageRevision(env, entityId, revisionId);
      else if (body.kind === "article") await restoreArticleRevision(env, entityId, revisionId);
      else if (body.kind === "project") await restoreProjectRevision(env, entityId, revisionId);
      else return json({ error: "Invalid kind" }, { status: 400 });
    } catch (err) {
      return json({ error: err.message || "Restore failed" }, { status: 400 });
    }
    log(ctx, env, "restore-revision", body.kind, `#${entityId}`);
    return json({ ok: true });
  }
  const restoreBlockMatch = path.match(/^\/revisions\/(\d+)\/restore-block$/);
  if (restoreBlockMatch && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const revisionId = Number(restoreBlockMatch[1]);
    const pageId = Number(body.entity_id);
    const blockId = Number(body.block_id);
    try {
      await restorePageRevisionBlock(env, pageId, revisionId, blockId);
    } catch (err) {
      return json({ error: err.message || "Restore failed" }, { status: 400 });
    }
    log(ctx, env, "restore-revision", "page block", `#${blockId} on page #${pageId}`);
    return json({ ok: true });
  }

  // /simulations
  // /templates?kind=page|article|simulation|project — saved starting points for new pages/articles/simulations/projects
  const TEMPLATE_KINDS = ["page", "article", "simulation", "project"];
  if (path === "/templates" && method === "GET") {
    const kind = url.searchParams.get("kind");
    if (!TEMPLATE_KINDS.includes(kind)) return json({ error: "Invalid kind" }, { status: 400 });
    return json(await listTemplates(env, kind));
  }
  if (path === "/templates" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!TEMPLATE_KINDS.includes(body.kind) || !body.name) {
      return json({ error: "kind and name are required" }, { status: 400 });
    }
    const id = await createTemplate(env, body);
    log(ctx, env, "create", "template", body.name);
    return json({ id });
  }
  const templateMatch = path.match(/^\/templates\/(\d+)$/);
  if (templateMatch && method === "DELETE") {
    await deleteTemplate(env, Number(templateMatch[1]));
    return json({ ok: true });
  }

  if (path === "/simulations" && method === "GET") {
    return json(await listSimulations(env));
  }
  if (path === "/simulations" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!body.name || !String(body.name).trim()) return json({ error: "Name is required" }, { status: 400 });
    const id = await createSimulation(env, { name: body.name.trim(), data: body.data || {} });
    log(ctx, env, "create", "simulation", body.name.trim());
    return json({ id });
  }
  const simDuplicateMatch = path.match(/^\/simulations\/(\d+)\/duplicate$/);
  if (simDuplicateMatch && method === "POST") {
    const newId = await duplicateSimulation(env, Number(simDuplicateMatch[1]));
    if (!newId) return json({ error: "Simulation not found" }, { status: 404 });
    log(ctx, env, "duplicate", "simulation", `#${simDuplicateMatch[1]} → #${newId}`);
    return json({ id: newId });
  }
  const simMatch = path.match(/^\/simulations\/(\d+)$/);
  if (simMatch && method === "GET") {
    const sim = await getSimulation(env, Number(simMatch[1]));
    if (!sim) return json({ error: "Not found" }, { status: 404 });
    return json(sim);
  }
  if (simMatch && method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    if (!body.name || !String(body.name).trim()) return json({ error: "Name is required" }, { status: 400 });
    await updateSimulation(env, Number(simMatch[1]), { name: body.name.trim(), data: body.data || {} });
    return json({ ok: true });
  }
  if (simMatch && method === "DELETE") {
    const id = Number(simMatch[1]);
    const s = await getSimulation(env, id);
    await deleteSimulation(env, id);
    log(ctx, env, "delete", "simulation", s?.name || `#${id}`);
    return json({ ok: true });
  }

  if (path === "/songs" && method === "GET") {
    return json(await listSongs(env));
  }
  if (path === "/songs" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!body.name || !String(body.name).trim()) return json({ error: "Name is required" }, { status: 400 });
    const id = await createSong(env, { name: body.name.trim(), data: body.data || {} });
    log(ctx, env, "create", "song", body.name.trim());
    return json({ id });
  }
  const songDuplicateMatch = path.match(/^\/songs\/(\d+)\/duplicate$/);
  if (songDuplicateMatch && method === "POST") {
    const newId = await duplicateSong(env, Number(songDuplicateMatch[1]));
    if (!newId) return json({ error: "Song not found" }, { status: 404 });
    log(ctx, env, "duplicate", "song", `#${songDuplicateMatch[1]} → #${newId}`);
    return json({ id: newId });
  }
  const songMatch = path.match(/^\/songs\/(\d+)$/);
  if (songMatch && method === "GET") {
    const song = await getSong(env, Number(songMatch[1]));
    if (!song) return json({ error: "Not found" }, { status: 404 });
    return json(song);
  }
  if (songMatch && method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    if (!body.name || !String(body.name).trim()) return json({ error: "Name is required" }, { status: 400 });
    await updateSong(env, Number(songMatch[1]), { name: body.name.trim(), data: body.data || {} });
    return json({ ok: true });
  }
  if (songMatch && method === "DELETE") {
    const id = Number(songMatch[1]);
    const s = await getSong(env, id);
    await deleteSong(env, id);
    log(ctx, env, "delete", "song", s?.name || `#${id}`);
    return json({ ok: true });
  }

  // /export — a full JSON backup, downloaded straight from the browser
  if (path === "/export" && method === "GET") {
    const data = await exportAll(env);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="dominickdominick-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  }

  // /import — replaces ALL content with the uploaded backup, atomically
  if (path === "/import" && method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: "Invalid JSON" }, { status: 400 });
    try {
      await importAll(env, body);
    } catch (err) {
      return json({ error: err.message || "Import failed" }, { status: 400 });
    }
    log(ctx, env, "import", "backup", body.exported_at || null);
    return json({ ok: true });
  }

  // /scheduled-backups — the automatic daily R2 backups (separate from the
  // on-demand "Download backup" export above)
  if (path === "/scheduled-backups" && method === "GET") {
    return json(await listScheduledBackups(env));
  }
  if (path === "/scheduled-backups/run" && method === "POST") {
    const key = await runScheduledBackup(env);
    log(ctx, env, "create", "backup", key);
    return json({ key });
  }
  if (path === "/backup-status" && method === "GET") {
    return json(await getBackupStatus(env));
  }
  // /scheduled-backups-contents?key=... — a query param, not a path
  // segment, since a backup key contains slashes (backups/2026-...json).
  if (path === "/scheduled-backups-contents" && method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) return json({ error: "key is required" }, { status: 400 });
    try {
      return json(await getBackupContents(env, key));
    } catch (err) {
      return json({ error: err.message }, { status: 400 });
    }
  }

  // /activity — recent admin actions, for the audit trail viewer
  if (path === "/activity" && method === "GET") {
    return json(await listActivityLog(env, Number(url.searchParams.get("limit")) || 100));
  }

  // /errors — recent uncaught worker errors, for the error log viewer
  if (path === "/errors" && method === "GET") {
    return json(await listErrors(env, Number(url.searchParams.get("limit")) || 50));
  }

  // /analytics
  if (path === "/analytics" && method === "GET") {
    const days = Number(url.searchParams.get("days")) || 7;
    const filters = {
      device: url.searchParams.get("device") || null,
      referrer: url.searchParams.get("referrer") || null,
      contentType: url.searchParams.get("contentType") || null,
    };
    return json(await getAnalytics(env, Math.min(Math.max(days, 1), 90), filters));
  }

  // /analytics/export-raw — every individual pageview/event row in the
  // selected window, not the top-N breakdowns /analytics returns. Generated
  // server-side (unlike the breakdown CSV, which the client already has
  // the aggregated numbers for and builds itself) since raw rows aren't
  // otherwise sent to the browser.
  if (path === "/analytics/export-raw" && method === "GET") {
    const days = Number(url.searchParams.get("days")) || 7;
    const filters = {
      device: url.searchParams.get("device") || null,
      referrer: url.searchParams.get("referrer") || null,
      contentType: url.searchParams.get("contentType") || null,
    };
    const { pageviews, events } = await getRawAnalyticsEvents(env, Math.min(Math.max(days, 1), 90), filters);
    const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csvRow = (cells) => cells.map(csvCell).join(",") + "\r\n";
    let csv = csvRow(["Pageviews"]) + csvRow(["Time (UTC)", "Path", "Referrer", "Device", "Browser", "Country", "Region", "City"]);
    for (const p of pageviews) csv += csvRow([p.created_at, p.path, p.referrer, p.device, p.browser, p.country, p.region, p.city]);
    csv += "\r\n" + csvRow(["Events"]) + csvRow(["Time (UTC)", "Name", "Path", "Detail"]);
    for (const e of events) csv += csvRow([e.created_at, e.name, e.path, e.detail]);
    log(ctx, env, "export", "analytics-raw", `${pageviews.length} pageviews, ${events.length} events`);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="dominickdominick-raw-events-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  // /settings — SETTINGS_KEYS is the single source of truth for which keys
  // exist; add a new setting here once instead of in both GET and PUT.
  if (path === "/settings" && method === "GET") {
    const values = await Promise.all(SETTINGS_KEYS.map((key) => getSetting(env, key)));
    const result = {};
    SETTINGS_KEYS.forEach((key, i) => {
      result[key] = values[i] || "";
    });
    return json(result);
  }
  if (path === "/settings" && method === "PUT") {
    const body = await request.json().catch(() => ({}));
    await Promise.all(SETTINGS_KEYS.map((key) => setSetting(env, key, body[key] || "")));
    log(ctx, env, "update", "settings", null);
    return json({ ok: true });
  }

  // /style-presets — reusable block-style snapshots (color/hover/animation/
  // etc. — the same STYLE_FIELDS every block type shares), stored as one
  // JSON blob under its own settings key rather than folded into the
  // SETTINGS_KEYS bulk save above, since that PUT resets any key missing
  // from its body — wrong for a list that gets individually added to/
  // removed from, not replaced wholesale on every settings save.
  if (path === "/style-presets" && method === "GET") {
    const raw = await getSetting(env, "style_presets");
    return json(JSON.parse(raw || "[]"));
  }
  if (path === "/style-presets" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!body.name || !body.style || typeof body.style !== "object") {
      return json({ error: "name and style are required" }, { status: 400 });
    }
    const presets = JSON.parse((await getSetting(env, "style_presets")) || "[]");
    const id = presets.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1;
    presets.push({ id, name: String(body.name).slice(0, 60), style: body.style });
    await setSetting(env, "style_presets", JSON.stringify(presets));
    log(ctx, env, "create", "style-preset", body.name);
    return json({ id });
  }
  const stylePresetMatch = path.match(/^\/style-presets\/(\d+)$/);
  if (stylePresetMatch && method === "DELETE") {
    const id = Number(stylePresetMatch[1]);
    const presets = JSON.parse((await getSetting(env, "style_presets")) || "[]");
    const target = presets.find((p) => p.id === id);
    await setSetting(env, "style_presets", JSON.stringify(presets.filter((p) => p.id !== id)));
    log(ctx, env, "delete", "style-preset", target?.name || `#${id}`);
    return json({ ok: true });
  }

  // /photo-presets — named brightness/contrast/saturation snapshots for the
  // photo editor's adjust sliders, same storage pattern as style presets
  // above (own settings key, own routes, not folded into the bulk PUT).
  if (path === "/photo-presets" && method === "GET") {
    const raw = await getSetting(env, "photo_editor_presets");
    return json(JSON.parse(raw || "[]"));
  }
  if (path === "/photo-presets" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!body.name || typeof body.adjust !== "object" || !body.adjust) {
      return json({ error: "name and adjust are required" }, { status: 400 });
    }
    const { brightness = 0, contrast = 0, saturate = 0 } = body.adjust;
    const presets = JSON.parse((await getSetting(env, "photo_editor_presets")) || "[]");
    const id = presets.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1;
    presets.push({
      id,
      name: String(body.name).slice(0, 60),
      adjust: { brightness: Number(brightness) || 0, contrast: Number(contrast) || 0, saturate: Number(saturate) || 0 },
    });
    await setSetting(env, "photo_editor_presets", JSON.stringify(presets));
    log(ctx, env, "create", "photo-preset", body.name);
    return json({ id });
  }
  const photoPresetMatch = path.match(/^\/photo-presets\/(\d+)$/);
  if (photoPresetMatch && method === "DELETE") {
    const id = Number(photoPresetMatch[1]);
    const presets = JSON.parse((await getSetting(env, "photo_editor_presets")) || "[]");
    const target = presets.find((p) => p.id === id);
    await setSetting(env, "photo_editor_presets", JSON.stringify(presets.filter((p) => p.id !== id)));
    log(ctx, env, "delete", "photo-preset", target?.name || `#${id}`);
    return json({ ok: true });
  }

  // /media-saved-searches — a named snapshot of the media library's
  // filter controls (folder/type/search text/unused/duplicates), same
  // storage pattern as style presets above and for the same reason: an
  // individually added-to/removed-from list, not something the settings
  // bulk PUT should own.
  if (path === "/media-saved-searches" && method === "GET") {
    const raw = await getSetting(env, "media_saved_searches");
    return json(JSON.parse(raw || "[]"));
  }
  if (path === "/media-saved-searches" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!body.name || typeof body.filters !== "object") {
      return json({ error: "name and filters are required" }, { status: 400 });
    }
    const searches = JSON.parse((await getSetting(env, "media_saved_searches")) || "[]");
    const id = searches.reduce((max, s) => Math.max(max, s.id || 0), 0) + 1;
    searches.push({ id, name: String(body.name).slice(0, 60), filters: body.filters });
    await setSetting(env, "media_saved_searches", JSON.stringify(searches));
    log(ctx, env, "create", "media-saved-search", body.name);
    return json({ id });
  }
  const mediaSavedSearchMatch = path.match(/^\/media-saved-searches\/(\d+)$/);
  if (mediaSavedSearchMatch && method === "DELETE") {
    const id = Number(mediaSavedSearchMatch[1]);
    const searches = JSON.parse((await getSetting(env, "media_saved_searches")) || "[]");
    const target = searches.find((s) => s.id === id);
    await setSetting(env, "media_saved_searches", JSON.stringify(searches.filter((s) => s.id !== id)));
    log(ctx, env, "delete", "media-saved-search", target?.name || `#${id}`);
    return json({ ok: true });
  }

  return json({ error: "Not found" }, { status: 404 });
}
