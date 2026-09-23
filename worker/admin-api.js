import {
  RESERVED_SLUGS,
  listPages,
  createPage,
  updatePage,
  deletePage,
  getPageBySlug,
  listBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
  listArticles,
  createArticle,
  updateArticle,
  deleteArticle,
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
  restorePageRevision,
  restoreArticleRevision,
  search,
  checkLinks,
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
    const existing = await getPageBySlug(env, slug);
    if (existing) return json({ error: "Slug already exists" }, { status: 409 });
    const id = await createPage(env, {
      slug,
      title: body.title || slug,
      meta_description: body.meta_description || "",
      nav_label: body.nav_label || null,
      nav_order: body.nav_order ?? null,
      og_image: body.og_image || null,
    });
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
    return json({ ok: true });
  }
  if (pageMatch && method === "DELETE") {
    await deletePage(env, Number(pageMatch[1]));
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
    const row = await env.DB.prepare("SELECT page_id FROM blocks WHERE id = ?").bind(id).first();
    if (row) await maybeSnapshotPage(env, row.page_id);
    await updateBlock(env, id, body);
    return json({ ok: true });
  }
  if (blockMatch && method === "DELETE") {
    const id = Number(blockMatch[1]);
    const row = await env.DB.prepare("SELECT page_id FROM blocks WHERE id = ?").bind(id).first();
    if (row) await maybeSnapshotPage(env, row.page_id);
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
    await deleteArticle(env, Number(articleMatch[1]));
    return json({ ok: true });
  }

  // /upload — image files only, 8MB cap
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
    return json({ url: `/media/${key}` });
  }

  // /media — list/delete uploaded files, for the media library picker
  if (path === "/media" && method === "GET") {
    const listed = await env.MEDIA.list({ prefix: "uploads/", limit: 500 });
    const items = listed.objects
      .sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded))
      .map((o) => ({ key: o.key, url: `/media/${o.key}`, size: o.size, uploaded: o.uploaded }));
    return json(items);
  }
  const mediaKeyMatch = path.match(/^\/media\/(.+)$/);
  if (mediaKeyMatch && method === "DELETE") {
    await env.MEDIA.delete(mediaKeyMatch[1]);
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
    await deleteRedirect(env, Number(redirectMatch[1]));
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

  // /revisions?kind=page|article&id=N — history for a page's blocks or an article
  if (path === "/revisions" && method === "GET") {
    const kind = url.searchParams.get("kind");
    const id = Number(url.searchParams.get("id"));
    if (!["page", "article"].includes(kind) || !id) {
      return json({ error: "Invalid kind/id" }, { status: 400 });
    }
    return json(await listRevisions(env, kind, id));
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
    return json({ ok: true });
  }

  // /analytics
  if (path === "/analytics" && method === "GET") {
    const days = Number(url.searchParams.get("days")) || 7;
    return json(await getAnalytics(env, Math.min(Math.max(days, 1), 90)));
  }

  // /settings
  if (path === "/settings" && method === "GET") {
    const [default_og_image, theme_accent, theme_bg, theme_font, site_footer, custom_head, webhook_url] = await Promise.all([
      getSetting(env, "default_og_image"),
      getSetting(env, "theme_accent"),
      getSetting(env, "theme_bg"),
      getSetting(env, "theme_font"),
      getSetting(env, "site_footer"),
      getSetting(env, "custom_head"),
      getSetting(env, "webhook_url"),
    ]);
    return json({
      default_og_image: default_og_image || "",
      theme_accent: theme_accent || "",
      theme_bg: theme_bg || "",
      theme_font: theme_font || "",
      site_footer: site_footer || "",
      custom_head: custom_head || "",
      webhook_url: webhook_url || "",
    });
  }
  if (path === "/settings" && method === "PUT") {
    const body = await request.json().catch(() => ({}));
    await Promise.all([
      setSetting(env, "default_og_image", body.default_og_image || ""),
      setSetting(env, "theme_accent", body.theme_accent || ""),
      setSetting(env, "theme_bg", body.theme_bg || ""),
      setSetting(env, "theme_font", body.theme_font || ""),
      setSetting(env, "site_footer", body.site_footer || ""),
      setSetting(env, "custom_head", body.custom_head || ""),
      setSetting(env, "webhook_url", body.webhook_url || ""),
    ]);
    return json({ ok: true });
  }

  return json({ error: "Not found" }, { status: 404 });
}
