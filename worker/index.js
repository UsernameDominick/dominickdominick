import { getPageBySlug, listStudyPageIds, listBlocks, getSettings, logError, runScheduledBackup } from "./db.js";
import { isAuthenticated } from "./auth.js";
import { isPublicPath } from "./site-scope.js";
import { renderShell, renderBlocks, isBlockShown, excerpt, esc, cleanFooterLinks, faviconSvg, renderErrorPageHtml, renderNotFoundHtml } from "./render.js";
import { handleAdminApi } from "./admin-api.js";
import { visibleText } from "./text.js";
// STUDY (temporary): see worker/study/README.md.
import { handleStudyUnlock } from "./study/index.js";
import { SVG_CSP, isSvgContentType } from "./svg.js";
import { trailingSlashTarget } from "./trailing-slash.js";
import { appPageFor, appPageBody } from "./app-pages.js";

// The picture links to a page show when the owner has not chosen one (Site settings > default share image): a card with the site name.
const DEFAULT_SHARE_IMAGE = "/share/site.png";

// Maintenance mode: a Site Settings toggle that takes the public site down to one plain "we'll be back" page while the owner is doing
// something risky. /admin (and /api/admin, routed before this runs) stay reachable so a logged-out owner can reach the login screen to
// turn it back off, plus the files the page itself needs. An explicit allowlist, not a file-extension regex: a regex let real content
// through by accident (a path ending in ".js", a slug that merely started with "admin").
const MAINTENANCE_EXEMPT_FILES = new Set(["/nav.js", "/style.css", "/favicon.ico", "/fonts/silkscreen-400.woff2", "/fonts/silkscreen-700.woff2", "/fonts/vt323-400.woff2", "/fonts/jetbrains-mono-400.woff2", "/fonts/jetbrains-mono-700.woff2"]);
function isMaintenanceExempt(path) {
  return path === "/admin" || path.startsWith("/admin/") || path.startsWith("/media/") || MAINTENANCE_EXEMPT_FILES.has(path);
}
function renderMaintenanceHtml(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Down for maintenance · Dominick</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #18161b; color: #e3ded2; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 18px; text-align: center; padding: 24px; }
  .maintenance-box { max-width: 480px; }
  h1 { font-size: 1.4rem; margin-bottom: 12px; }
  p { color: #a39d91; line-height: 1.6; }
</style>
</head>
<body>
  <div class="maintenance-box">
    <h1>Down for maintenance</h1>
    <p>${esc(message)}</p>
  </div>
</body>
</html>`;
}

// Everything a public page needs from the settings, read together (see getSettings): the footer and the default share image.
const SITE_CONTEXT_KEYS = ["default_og_image", "site_footer", "site_footer_links"];

// Settings every rendered page needs, fetched together.
async function getSiteContext(env) {
  const v = await getSettings(env, SITE_CONTEXT_KEYS);
  const footerPlain = v.site_footer;
  // The footer is plain text until a layout (link columns, social links) is saved, then { text, columns, social }.
  const footerLinks = cleanFooterLinks(v.site_footer_links);
  const footerText = footerLinks ? { text: footerPlain || "", ...footerLinks } : footerPlain;
  return { defaultOgImage: v.default_og_image || DEFAULT_SHARE_IMAGE, footerText };
}

// The home page, from the "home" page and its blocks in the database.
async function renderHome(env, page, url, request) {
  const { defaultOgImage, footerText } = await getSiteContext(env);
  const isAdmin = !!env.__isAdmin || (await isAuthenticated(request, env));
  const blocks = await listBlocks(env, page.id);
  const bodyHtml = await renderBlocks(env, blocks, { isAdmin, query: url.searchParams });
  // A page has no single body-text field to fall back to: build the fallback description from its own text and heading blocks, in
  // reading order, so a page whose "Meta description" was never filled in does not ship an empty <meta name="description">.
  const description =
    visibleText(page.meta_description) ||
    excerpt(
      blocks
        .filter((b) => isBlockShown(b, url.searchParams, env) && (b.type === "text" || b.type === "heading") && b.content && b.content.text)
        .sort((a, b) => a.row - b.row || a.col - b.col)
        .map((b) => b.content.text)
        .join(" ")
    ) ||
    page.title;
  const html = renderShell({
    title: page.title,
    description,
    path: "/",
    activeSlug: "home",
    bodyHtml,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Person",
      name: "Dominick",
      url: "https://dominickdominick.com/",
      sameAs: ["https://github.com/UsernameDominick"],
    },
    ogImage: visibleText(page.og_image) || defaultOgImage || null,
    footerText,
    // A page with a Study block is not offered to search engines (the study pages are for the people who were given the password).
    noindex: String(bodyHtml).includes('class="study-block"'),
    editUrl: isAdmin ? `/admin/?edit=page:${page.id}` : null,
  });
  // A page with address-gated blocks differs by query string, so it must never be served from a shared cache to someone else.
  const gated = blocks.some((b) => b.style && (b.style.urlRule === "show" || b.style.urlRule === "hide"));
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8", ...(gated ? { "Cache-Control": "private, no-store" } : {}) } });
}

// The Studio: an app page (worker/app-pages.js) with a mount that public/studio.js builds the editor into.
async function renderStudio(env, appPage, path) {
  const { defaultOgImage, footerText } = await getSiteContext(env);
  const html = renderShell({
    title: appPage.title,
    description: appPage.description,
    path,
    activeSlug: appPage.slug,
    bodyHtml: appPageBody(appPage, esc),
    footerText,
    canvasClass: "canvas studio-canvas",
    ogImage: appPage.image || defaultOgImage || null,
    ogImageSize: appPage.image ? 'width="1200" height="630"' : "",
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

// The branded 404 for an address that does not exist.
async function renderNotFound(env) {
  const { defaultOgImage, footerText } = await getSiteContext(env);
  const html = renderShell({
    title: "Page not found · Dominick",
    description: "This page doesn't exist.",
    path: "/404",
    activeSlug: null,
    bodyHtml: `<div class="block">${renderNotFoundHtml()}</div>`,
    ogImage: defaultOgImage || null,
    footerText,
    noindex: true,
    canvasClass: "canvas article-canvas",
  });
  return new Response(html, { status: 404, headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

// The sitemap lists the Studio, and the home page unless it holds a Study block (those pages stay out of search results).
async function renderSitemap(env) {
  const home = await getPageBySlug(env, "home");
  const studyPages = await listStudyPageIds(env);
  const paths = ["/studio"];
  if (home && !studyPages.has(home.id)) paths.unshift("/");
  const urls = paths.map((p) => `  <url><loc>https://dominickdominick.com${p === "/" ? "/" : p}</loc></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml;charset=UTF-8" } });
}

// A handful of headers that cost nothing and help regardless of route: blocks MIME-sniffing, stops the site being framed elsewhere
// (clickjacking), trims referrer leakage, and a CSP that is deliberately not nonce-strict (the admin and the Studio use inline scripts).
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // The session cookie is already Secure-only; this closes the remaining window where a first visit over plain http:// could be
  // intercepted before the redirect to https:// happens.
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    // blob: the Studio shows and loads what a visitor made from their own device or browser storage.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' blob:",
    "worker-src 'self' blob:",
    // The study popup shows its page in a sandboxed srcdoc frame.
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
  ].join("; "),
};

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  // A route that already chose its own (stricter) policy keeps it.
  const ownCsp = headers.get("Content-Security-Policy");
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (k.toLowerCase() === "content-security-policy" && ownCsp) continue;
    headers.set(k, v);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    try {
      // "//studio" and "/studio//x" are the same page as "/studio": send them to the one address so search engines see one copy.
      {
        const u = new URL(request.url);
        if ((request.method === "GET" || request.method === "HEAD") && /\/{2,}/.test(u.pathname) && !u.pathname.startsWith("/api/") && !u.pathname.startsWith("/admin")) {
          return Response.redirect(`${u.origin}${u.pathname.replace(/\/{2,}/g, "/")}${u.search}`, 301);
        }
        if ((request.method === "GET" || request.method === "HEAD") && trailingSlashTarget(u.pathname)) {
          return Response.redirect(`${u.origin}${trailingSlashTarget(u.pathname)}${u.search}`, 301);
        }
      }
      // A public page request reads its settings once and shares them (see getSettings); anything that could write a setting
      // (the admin API, any non-GET) gets none, so it never reads a stale one back.
      const { pathname } = new URL(request.url);
      const readOnly = request.method === "GET" && !pathname.startsWith("/api/") && !pathname.startsWith("/admin");
      const reqEnv = readOnly ? { ...env, __settingsCache: new Map(), __isAdmin: await isAuthenticated(request, env) } : env;
      return withSecurityHeaders(await route(request, reqEnv, ctx));
    } catch (err) {
      const path = new URL(request.url).pathname;
      // A short reference, made here (not by the database, which may be what failed) and printed both on the error page and at the
      // start of the logged message, so the owner can find exactly the entry a reader quotes (Error log).
      const ref = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      ctx.waitUntil(logError(env, { message: `[${ref}] ${err.message}`, stack: err.stack, path }).catch(() => {}));
      // API/admin routes should still get a plain error a client can parse (JSON.parse would choke on the branded HTML page below);
      // the branded page is for a human hitting a broken public/admin page.
      if (path.startsWith("/api/")) {
        return withSecurityHeaders(
          new Response(`Something went wrong. Try again in a moment. (Reference: ${ref})`, {
            status: 500,
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
          })
        );
      }
      return withSecurityHeaders(
        new Response(renderErrorPageHtml(ref), {
          status: 500,
          headers: { "Content-Type": "text/html;charset=UTF-8" },
        })
      );
    }
  },

  // Runs on the configured cron schedule (see wrangler.jsonc): a full JSON backup written to R2, since D1 itself has no built-in
  // scheduled backup. Media files in R2 are not included (they are already durably stored there as-is); this covers the D1-side
  // content that only lives in one place. A rejection inside a cron ctx.waitUntil is only ever visible in Cloudflare's own dashboard
  // logs, so a failure is also written to the error log; runScheduledBackup records it to settings for the admin's status line.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runScheduledBackup(env).catch((err) => logError(env, { message: err.message, stack: err.stack, path: "scheduled:backup" }))
    );
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.startsWith("/api/admin")) {
    return handleAdminApi(request, env, url, ctx);
  }

  // The public site is the home page and the Studio (site-scope.js): other public API calls are gone.
  if (path.startsWith("/api/") && !isPublicPath(path)) return new Response("Not found", { status: 404 });

  // STUDY (temporary): the password check behind the Study block.
  if (path === "/api/study/unlock" && request.method === "POST") {
    return handleStudyUnlock(request, env);
  }

  // The maintenance switch is read together with everything a page is about to need (one query for all of it, shared for the rest of
  // the request); files and API calls only need the switch.
  const pageSettings = env.__settingsCache && !/^\/(?:media|api|admin)(?:\/|$)/.test(path) ? SITE_CONTEXT_KEYS : [];
  const { maintenance_mode: maintenanceMode, maintenance_message: maintenanceMessage } = await getSettings(env, ["maintenance_mode", "maintenance_message", ...pageSettings]);
  if (!isMaintenanceExempt(path) && maintenanceMode === "1" && !(await isAuthenticated(request, env))) {
    const message = maintenanceMessage || "We'll be back shortly.";
    return new Response(renderMaintenanceHtml(message), {
      status: 503,
      headers: { "Content-Type": "text/html;charset=UTF-8", "Retry-After": "3600" },
    });
  }

  // Every other public address is the 404 page (site-scope.js).
  if (!isPublicPath(path)) return renderNotFound(env);

  if (path === "/sitemap.xml") return renderSitemap(env);

  const appPage = appPageFor(path);
  if (appPage) return renderStudio(env, appPage, path);

  // Pictures uploaded in the admin. Scoped to "uploads/" specifically: the same R2 bucket also holds scheduled backups under
  // "backups/", which must never be servable through this public route.
  const mediaMatch = path.match(/^\/media\/(uploads\/[A-Za-z0-9_.\-\/]+)$/);
  if (mediaMatch) {
    // A file the owner marked private is visible only to the signed-in owner.
    const meta = await env.DB.prepare("SELECT private FROM media WHERE key = ?").bind(mediaMatch[1]).first();
    const isPrivateFile = !!(meta && meta.private);
    if (isPrivateFile && !(await isAuthenticated(request, env))) {
      return new Response("Not found", { status: 404 });
    }
    const obj = await env.MEDIA.get(mediaMatch[1]);
    if (!obj) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    if (isSvgContentType(headers.get("Content-Type"))) headers.set("Content-Security-Policy", SVG_CSP);
    // A private file is never cached by any shared cache and never persisted client-side either: otherwise a copy fetched while the
    // file was still public could keep being served to a different visitor after it is marked private. Public files keep a short
    // cache that revalidates, because a picture replaced in place keeps its address.
    headers.set("Cache-Control", isPrivateFile ? "private, no-store" : "public, max-age=60, must-revalidate");
    headers.set("ETag", obj.httpEtag);
    if (!isPrivateFile && request.headers.get("If-None-Match") === obj.httpEtag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(obj.body, { headers });
  }

  if (path === "/robots.txt") {
    return new Response(
      "User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: https://dominickdominick.com/sitemap.xml\n",
      { headers: { "Content-Type": "text/plain;charset=UTF-8" } }
    );
  }

  // Browsers probe /favicon.ico directly regardless of the <link rel="icon"> data-URI already in the page head; without this, every
  // single page load logs a 404 for it.
  if (path === "/favicon.ico") {
    return new Response(faviconSvg(), { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
  }

  if (path === "/") {
    const page = await getPageBySlug(env, "home");
    if (page) return renderHome(env, page, url, request);
  }

  // Fall through to static assets (style.css, nav.js, the admin app, images, etc.); a miss there is the branded 404, not Cloudflare's
  // bare one.
  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) return assetResponse;
  return renderNotFound(env);
}
