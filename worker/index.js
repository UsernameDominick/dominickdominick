import { logError } from "./db.js";
import { isPublicPath } from "./site-scope.js";
import { renderShell, esc, faviconSvg, renderErrorPageHtml, renderNotFoundHtml } from "./render.js";
// STUDY (temporary): see worker/study/README.md.
import { handleStudyUnlock } from "./study/index.js";
import { trailingSlashTarget } from "./trailing-slash.js";
import { appPageFor, appPageBody } from "./app-pages.js";

// The picture links to the Studio show when a page has none of its own: a card with the site name.
const DEFAULT_SHARE_IMAGE = "/share/site.png";

// The Studio: an app page (worker/app-pages.js) with a mount that public/studio.js builds the editor into.
function renderStudio(appPage, path) {
  const html = renderShell({
    title: appPage.title,
    description: appPage.description,
    path,
    activeSlug: appPage.slug,
    bodyHtml: appPageBody(appPage, esc),
    canvasClass: "canvas studio-canvas",
    ogImage: appPage.image || DEFAULT_SHARE_IMAGE,
    ogImageSize: appPage.image ? 'width="1200" height="630"' : "",
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

// The branded 404 for an address that does not exist.
function renderNotFound() {
  const html = renderShell({
    title: "Page not found · Dominick",
    description: "This page doesn't exist.",
    path: "/404",
    activeSlug: null,
    bodyHtml: `<div class="block">${renderNotFoundHtml()}</div>`,
    ogImage: DEFAULT_SHARE_IMAGE,
    noindex: true,
    canvasClass: "canvas article-canvas",
  });
  return new Response(html, { status: 404, headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

// The sitemap lists the Studio (there is no other public page).
function renderSitemap() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://dominickdominick.com/studio</loc></url>\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml;charset=UTF-8" } });
}

// A handful of headers that cost nothing and help regardless of route: blocks MIME-sniffing, stops the site being framed elsewhere
// (clickjacking), trims referrer leakage, and a CSP that is deliberately not nonce-strict (the Studio uses inline scripts).
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Closes the window where a first visit over plain http:// could be intercepted before the redirect to https:// happens.
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
        if ((request.method === "GET" || request.method === "HEAD") && /\/{2,}/.test(u.pathname) && !u.pathname.startsWith("/api/")) {
          return Response.redirect(`${u.origin}${u.pathname.replace(/\/{2,}/g, "/")}${u.search}`, 301);
        }
        if ((request.method === "GET" || request.method === "HEAD") && trailingSlashTarget(u.pathname)) {
          return Response.redirect(`${u.origin}${trailingSlashTarget(u.pathname)}${u.search}`, 301);
        }
      }
      return withSecurityHeaders(await route(request, env));
    } catch (err) {
      const path = new URL(request.url).pathname;
      // A short reference, made here (not by the database, which may be what failed) and printed both on the error page and at the
      // start of the logged message, so a reader's quote can be matched to the entry in the error_log table.
      const ref = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      ctx.waitUntil(logError(env, { message: `[${ref}] ${err.message}`, stack: err.stack, path }).catch(() => {}));
      // API routes should still get a plain error a client can parse (JSON.parse would choke on the branded HTML page below);
      // the branded page is for a human hitting a broken page.
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
};

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // The public site is the Studio (site-scope.js): other public API calls are gone.
  if (path.startsWith("/api/") && !isPublicPath(path)) return new Response("Not found", { status: 404 });

  // STUDY (temporary): the password check behind the Study block.
  if (path === "/api/study/unlock" && request.method === "POST") {
    return handleStudyUnlock(request, env);
  }

  // Every other public address is the 404 page (site-scope.js).
  if (!isPublicPath(path)) return renderNotFound();

  if (path === "/sitemap.xml") return renderSitemap();

  // There is no home page: the front door is the Studio.
  if (path === "/") return Response.redirect(`${url.origin}/studio${url.search}`, 302);

  const appPage = appPageFor(path);
  if (appPage) return renderStudio(appPage, path);

  if (path === "/robots.txt") {
    return new Response("User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://dominickdominick.com/sitemap.xml\n", {
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    });
  }

  // Browsers probe /favicon.ico directly regardless of the <link rel="icon"> data-URI already in the page head; without this, every
  // single page load logs a 404 for it.
  if (path === "/favicon.ico") {
    return new Response(faviconSvg(), { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
  }

  // Fall through to static assets (style.css, nav.js, the Studio's files, images, etc.); a miss there is the branded 404, not
  // Cloudflare's bare one.
  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) return assetResponse;
  return renderNotFound();
}
