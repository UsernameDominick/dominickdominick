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
} from "./db.js";
import { checkPassword, createSessionCookie, clearSessionCookie, isAuthenticated } from "./auth.js";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function handleAdminApi(request, env, url) {
  try {
    return await routeAdminApi(request, env, url);
  } catch (err) {
    return json({ error: err.message || "Something went wrong" }, { status: 500 });
  }
}

async function routeAdminApi(request, env, url) {
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
    const id = await createBlock(env, Number(blocksMatch[1]), body);
    return json({ id });
  }

  // /blocks/:id
  const blockMatch = path.match(/^\/blocks\/(\d+)$/);
  if (blockMatch && method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    await updateBlock(env, Number(blockMatch[1]), body);
    return json({ ok: true });
  }
  if (blockMatch && method === "DELETE") {
    await deleteBlock(env, Number(blockMatch[1]));
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
    await updateArticle(env, id, body);
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

  // /analytics
  if (path === "/analytics" && method === "GET") {
    const days = Number(url.searchParams.get("days")) || 7;
    return json(await getAnalytics(env, Math.min(Math.max(days, 1), 90)));
  }

  // /settings
  if (path === "/settings" && method === "GET") {
    const [default_og_image, theme_accent, theme_bg, theme_font] = await Promise.all([
      getSetting(env, "default_og_image"),
      getSetting(env, "theme_accent"),
      getSetting(env, "theme_bg"),
      getSetting(env, "theme_font"),
    ]);
    return json({
      default_og_image: default_og_image || "",
      theme_accent: theme_accent || "",
      theme_bg: theme_bg || "",
      theme_font: theme_font || "",
    });
  }
  if (path === "/settings" && method === "PUT") {
    const body = await request.json().catch(() => ({}));
    await Promise.all([
      setSetting(env, "default_og_image", body.default_og_image || ""),
      setSetting(env, "theme_accent", body.theme_accent || ""),
      setSetting(env, "theme_bg", body.theme_bg || ""),
      setSetting(env, "theme_font", body.theme_font || ""),
    ]);
    return json({ ok: true });
  }

  return json({ error: "Not found" }, { status: 404 });
}
