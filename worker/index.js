import { getPageBySlug, listNavPages, listBlocks, listArticles, getArticleBySlug, getSetting } from "./db.js";
import { renderShell, renderBlocks, renderTags, excerpt, esc } from "./render.js";
import { handleAdminApi } from "./admin-api.js";

async function renderPage(env, page, url) {
  const [navItems, blocks, defaultOgImage] = await Promise.all([
    listNavPages(env),
    listBlocks(env, page.id),
    getSetting(env, "default_og_image"),
  ]);
  const activeTagFilter = url.searchParams.get("tag") || null;
  const bodyHtml = await renderBlocks(env, blocks, { activeTagFilter });
  const jsonLd =
    page.slug === "home"
      ? {
          "@context": "https://schema.org",
          "@type": "Person",
          name: "Dominick",
          url: "https://dominickdominick.com/",
          sameAs: ["https://github.com/UsernameDominick"],
        }
      : null;
  const html = renderShell({
    title: page.title,
    description: page.meta_description,
    path: page.slug === "home" ? "/" : `/${page.slug}`,
    navItems,
    activeSlug: page.slug,
    bodyHtml,
    jsonLd,
    ogImage: page.og_image || defaultOgImage || null,
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

async function renderArticle(env, article, navItems) {
  const description = excerpt(article.body) || article.title;
  const defaultOgImage = await getSetting(env, "default_og_image");
  const bodyHtml = `<div class="block" style="grid-column:1 / span 12;grid-row:1 / span 1;">
    <time datetime="${esc(article.published_at)}">${esc((article.published_at || "").slice(0, 10))}</time>
    <h1>${esc(article.title)}</h1>
    ${renderTags(article.tags)}
  </div>
  <div class="block" style="grid-column:1 / span 12;grid-row:2 / span 6;">
    ${String(article.body || "")
      .split(/\n{2,}/)
      .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
      .join("\n")}
  </div>`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: article.title,
    datePublished: article.published_at,
    dateModified: article.updated_at || article.published_at,
    author: { "@type": "Person", name: "Dominick" },
    ...(article.tags && article.tags.length ? { keywords: article.tags.join(", ") } : {}),
  };
  const html = renderShell({
    title: `${article.title} · Dominick`,
    description,
    path: `/random/${article.slug}`,
    navItems,
    activeSlug: "random",
    bodyHtml,
    jsonLd,
    ogType: "article",
    publishedTime: article.published_at,
    modifiedTime: article.updated_at,
    keywords: article.tags && article.tags.length ? article.tags.join(", ") : null,
    ogImage: article.og_image || defaultOgImage || null,
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

function xmlEsc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function renderRss(env) {
  const articles = await listArticles(env, { publishedOnly: true, limit: 30 });
  const items = articles
    .map((a) => {
      const link = `https://dominickdominick.com/random/${a.slug}`;
      const pubDate = new Date(a.published_at).toUTCString();
      return `  <item>
    <title>${xmlEsc(a.title)}</title>
    <link>${link}</link>
    <guid>${link}</guid>
    <pubDate>${pubDate}</pubDate>
    <description>${xmlEsc(excerpt(a.body, 300))}</description>
  </item>`;
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Dominick — Random</title>
  <link>https://dominickdominick.com/random</link>
  <description>Notes and half-formed ideas from Dominick.</description>
  <language>en</language>
${items}
</channel>
</rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml;charset=UTF-8" } });
}

async function renderSitemap(env) {
  const { listPages } = await import("./db.js");
  const pages = await listPages(env);
  const articles = await listArticles(env, { publishedOnly: true });
  const entries = [
    ...pages.map((p) => ({ loc: p.slug === "home" ? "/" : `/${p.slug}`, lastmod: p.updated_at })),
    ...articles.map((a) => ({ loc: `/random/${a.slug}`, lastmod: a.updated_at || a.published_at })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map(
      (e) =>
        `  <url><loc>https://dominickdominick.com${e.loc}</loc>${
          e.lastmod ? `<lastmod>${new Date(e.lastmod.replace(" ", "T") + "Z").toISOString().slice(0, 10)}</lastmod>` : ""
        }</url>`
    )
    .join("\n")}\n</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml;charset=UTF-8" } });
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      return new Response("Something went wrong. Try again in a moment.", {
        status: 500,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
      });
    }
  },
};

async function route(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/admin")) {
      return handleAdminApi(request, env, url);
    }

    if (path === "/sitemap.xml") {
      return renderSitemap(env);
    }

    if (path === "/rss.xml") {
      return renderRss(env);
    }

    if (path === "/robots.txt") {
      return new Response(
        "User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: https://dominickdominick.com/sitemap.xml\n",
        { headers: { "Content-Type": "text/plain;charset=UTF-8" } }
      );
    }

    // Individual article page: /random/:slug
    const articleMatch = path.match(/^\/random\/([a-z0-9-]+)$/);
    if (articleMatch) {
      const article = await getArticleBySlug(env, articleMatch[1]);
      if (!article || !article.published_at) return env.ASSETS.fetch(request);
      const navItems = await listNavPages(env);
      return renderArticle(env, article, navItems);
    }

    const slug = path === "/" ? "home" : path.replace(/^\/+/, "").replace(/\/+$/, "");
    const page = await getPageBySlug(env, slug);
    if (page) {
      return renderPage(env, page, url);
    }

    // Fall through to static assets (style.css, nav.js, /admin app, images, etc.)
    return env.ASSETS.fetch(request);
}
