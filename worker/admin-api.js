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
  listTemplates,
  createTemplate,
  deleteTemplate,
  getMediaMeta,
  upsertMediaMeta,
  deleteMediaMeta,
  listMediaFolders,
  findMediaUsage,
  logActivity,
  listActivityLog,
  listErrors,
  runScheduledBackup,
  listScheduledBackups,
  runFindReplace,
  slugExists,
  checkLoginRateLimit,
  recordLoginAttempt,
  getSetting,
  setSetting,
  getAnalytics,
  exportAll,
  importAll,
  listRedirects,
  createRedirect,
  updateRedirect,
  deleteRedirect,
  maybeSnapshotPage,
  snapshotArticle,
  listRevisions,
  getRevision,
  restorePageRevision,
  restoreArticleRevision,
  search,
  checkLinks,
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
  getBlockPageId,
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

const SETTINGS_KEYS = ["default_og_image", "theme_accent", "theme_bg", "theme_font", "site_footer", "custom_head", "webhook_url"];

// Paths a redirect could otherwise break by intercepting a system route.
const BLOCKED_REDIRECT_PREFIXES = ["/api", "/admin", "/media", "/sitemap.xml", "/rss.xml", "/robots.txt"];
function isBlockedRedirectPath(p) {
  return BLOCKED_REDIRECT_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + "/"));
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

// A configured webhook fires (best-effort, non-blocking) the moment an
// article transitions into "published" — not on every subsequent edit.
async function maybeFireWebhook(env, ctx, { wasPublished, article }) {
  if (wasPublished || !article.published_at || article.published_at > new Date().toISOString()) return;
  const webhookUrl = await getSetting(env, "webhook_url");
  if (!webhookUrl) return;
  const payload = {
    title: article.title,
    slug: article.slug,
    url: `https://dominickdominick.com/random/${article.slug}`,
    published_at: article.published_at,
  };
  ctx.waitUntil(
    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {})
  );
}

// Fire-and-forget activity log write — never blocks or fails the request
// it's attached to.
function log(ctx, env, action, entityType, entityLabel, detail) {
  ctx.waitUntil(logActivity(env, action, entityType, entityLabel, detail).catch(() => {}));
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
    if (!ok) return json({ error: "Wrong password" }, { status: 401 });
    const cookie = await createSessionCookie(env);
    return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
  }

  if (path === "/logout" && method === "POST") {
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
    if (body.slug) {
      body.slug = slugify(body.slug);
      if (RESERVED_SLUGS.has(body.slug)) {
        return json({ error: "Reserved slug" }, { status: 400 });
      }
      if (await slugExists(env, "pages", body.slug, id)) {
        return json({ error: "A page with that slug already exists" }, { status: 409 });
      }
    }
    await updatePage(env, id, body);
    log(ctx, env, "update", "page", body.title || body.slug || `#${id}`);
    return json({ ok: true });
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
    await updateBlock(env, id, body);
    return json({ ok: true });
  }
  if (blockMatch && method === "DELETE") {
    const id = Number(blockMatch[1]);
    const pageId = await getBlockPageId(env, id);
    if (pageId) await maybeSnapshotPage(env, pageId);
    await deleteBlock(env, id);
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
    return json({ ok: true });
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
    if (!["publish", "unpublish", "trash"].includes(body.action)) {
      return json({ error: "Invalid action" }, { status: 400 });
    }
    await bulkArticleAction(env, ids, body.action);
    log(ctx, env, body.action, "article", `${ids.length} article(s)`);
    return json({ ok: true });
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

  // /upload — image files only, 8MB cap. An optional ?folder= query param
  // files the upload into that folder from the moment it lands.
  if (path === "/upload" && method === "POST") {
    const contentType = request.headers.get("Content-Type") || "";
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
    if (!allowed.includes(contentType)) {
      return json({ error: "Only PNG, JPEG, WebP, GIF, or SVG images are allowed" }, { status: 400 });
    }
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 8 * 1024 * 1024) {
      return json({ error: "File too large (8MB max)" }, { status: 400 });
    }
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" }[
      contentType
    ];
    const key = `uploads/${crypto.randomUUID()}.${ext}`;
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType } });
    const folder = url.searchParams.get("folder");
    if (folder) await upsertMediaMeta(env, key, { folder });
    log(ctx, env, "upload", "media", key.split("/").pop());
    return json({ url: `/media/${key}` });
  }

  // /media — list uploaded files (enriched with folder/tags/alt text), for
  // the media library picker.
  if (path === "/media" && method === "GET") {
    const listed = await env.MEDIA.list({ prefix: "uploads/", limit: 500 });
    const objects = listed.objects.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
    const meta = await getMediaMeta(env, objects.map((o) => o.key));
    const items = objects.map((o) => ({
      key: o.key,
      url: `/media/${o.key}`,
      size: o.size,
      uploaded: o.uploaded,
      folder: meta[o.key]?.folder || null,
      tags: meta[o.key]?.tags || [],
      alt_text: meta[o.key]?.alt_text || null,
    }));
    return json(items);
  }
  if (path === "/media/folders" && method === "GET") {
    return json(await listMediaFolders(env));
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
  const mediaKeyMatch = path.match(/^\/media\/(.+)$/);
  if (mediaKeyMatch && method === "DELETE") {
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
  // Overwrites an existing upload's bytes in place — same key, same public
  // URL — used by the photo editor's "Overwrite original" save.
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
    const existing = await env.MEDIA.head(key);
    if (!existing) return json({ error: "Original file not found" }, { status: 404 });
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType } });
    return json({ url: `/media/${key}` });
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

  // /revisions?kind=page|article&id=N — history for a page's blocks or an article
  if (path === "/revisions" && method === "GET") {
    const kind = url.searchParams.get("kind");
    const id = Number(url.searchParams.get("id"));
    if (!["page", "article"].includes(kind) || !id) {
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
      else return json({ error: "Invalid kind" }, { status: 400 });
    } catch (err) {
      return json({ error: err.message || "Restore failed" }, { status: 400 });
    }
    log(ctx, env, "restore-revision", body.kind, `#${entityId}`);
    return json({ ok: true });
  }

  // /simulations
  // /templates?kind=page|article|simulation — saved starting points for new pages/articles/simulations
  const TEMPLATE_KINDS = ["page", "article", "simulation"];
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
    return json(await getAnalytics(env, Math.min(Math.max(days, 1), 90)));
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

  return json({ error: "Not found" }, { status: 404 });
}
