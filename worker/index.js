import {
  getPageBySlug,
  listPages,
  listNavPages,
  listBlocks,
  listArticles,
  getArticleBySlug,
  getSetting,
  recordPageview,
  getRedirect,
  publicSearch,
  getRelatedArticles,
  getSeriesArticles,
} from "./db.js";
import { isAuthenticated } from "./auth.js";
import {
  renderShell,
  renderBlocks,
  renderTags,
  excerpt,
  readingTime,
  esc,
  paragraphsHtml,
  extractHeadings,
  tableOfContentsHtml,
  renderSearchResultsHtml,
  renderRelatedArticlesHtml,
  renderNotFoundHtml,
  renderByline,
  renderSeriesNavHtml,
} from "./render.js";
import { handleAdminApi } from "./admin-api.js";

async function getTheme(env) {
  const [accent, bg, font] = await Promise.all([
    getSetting(env, "theme_accent"),
    getSetting(env, "theme_bg"),
    getSetting(env, "theme_font"),
  ]);
  return { accent: accent || null, bg: bg || null, font: font || null };
}

// Settings every rendered page/article needs, fetched together since
// renderPage and renderArticle both want the exact same four.
async function getSiteContext(env) {
  const [defaultOgImage, theme, footerText, customHead] = await Promise.all([
    getSetting(env, "default_og_image"),
    getTheme(env),
    getSetting(env, "site_footer"),
    getSetting(env, "custom_head"),
  ]);
  return { defaultOgImage, theme, footerText, customHead };
}

async function renderPage(env, page, url) {
  const [navItems, blocks, siteContext] = await Promise.all([listNavPages(env), listBlocks(env, page.id), getSiteContext(env)]);
  const { defaultOgImage, theme, footerText, customHead } = siteContext;
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
    theme,
    footerText,
    customHead,
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

async function renderArticle(env, article, navItems) {
  const description = excerpt(article.body) || article.title;
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);
  const mins = readingTime(article.body);
  const headings = extractHeadings(article.body);
  const tocHtml = tableOfContentsHtml(headings);
  const related = await getRelatedArticles(env, article);
  const relatedHtml = renderRelatedArticlesHtml(related);
  const seriesArticles = article.series ? await getSeriesArticles(env, article.series) : [];
  const seriesNavHtml = renderSeriesNavHtml(article, seriesArticles);
  const bylineHtml = renderByline(article);

  // Rows are handed out in order rather than computed with ad-hoc offsets,
  // so adding/removing an optional section (series nav, TOC, related) can't
  // silently throw off the ones after it.
  let row = 3;
  const seriesRow = seriesNavHtml ? row : null;
  if (seriesNavHtml) row += 3;
  const tocRow = tocHtml ? row : null;
  if (tocHtml) row += 6;
  const bodyRow = row;
  row += 12;
  const relatedRow = row;

  const bodyHtml = `<div class="reading-progress"></div>
  <div class="block" style="grid-column:1 / span 24;grid-row:1 / span 2;">
    <div class="article-meta">
      <time datetime="${esc(article.published_at)}">${esc((article.published_at || "").slice(0, 10))}</time>
      <span class="article-meta-sep">·</span>
      <span>${mins} min read</span>
      ${bylineHtml ? `<span class="article-meta-sep">·</span>${bylineHtml}` : ""}
      <button type="button" class="copy-link-btn" data-copy-text="Copy link" data-copied-text="Copied!">Copy link</button>
    </div>
    <h1>${esc(article.title)}</h1>
    ${renderTags(article.tags)}
  </div>
  ${seriesNavHtml ? `<div class="block" style="grid-column:1 / span 24;grid-row:${seriesRow} / span 3;">${seriesNavHtml}</div>` : ""}
  ${tocHtml ? `<div class="block" style="grid-column:1 / span 24;grid-row:${tocRow} / span 6;">${tocHtml}</div>` : ""}
  <div class="block" style="grid-column:1 / span 24;grid-row:${bodyRow} / span 12;">
    ${paragraphsHtml(article.body)}
  </div>
  ${relatedHtml ? `<div class="block" style="grid-column:1 / span 24;grid-row:${relatedRow} / span 6;">${relatedHtml}</div>` : ""}`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: article.title,
      datePublished: article.published_at,
      dateModified: article.updated_at || article.published_at,
      author: { "@type": "Person", name: "Dominick" },
      ...(article.tags && article.tags.length ? { keywords: article.tags.join(", ") } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://dominickdominick.com/" },
        { "@type": "ListItem", position: 2, name: "Random", item: "https://dominickdominick.com/random" },
        { "@type": "ListItem", position: 3, name: article.title, item: `https://dominickdominick.com/random/${article.slug}` },
      ],
    },
  ];
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
    theme,
    footerText,
    customHead,
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

async function renderSearch(env, query, navItems) {
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);
  const { pages, articles } = query ? await publicSearch(env, query) : { pages: [], articles: [] };
  const resultsHtml = renderSearchResultsHtml(query, pages, articles);
  const bodyHtml = `<div class="block" style="grid-column:1 / span 24;grid-row:1 / span 16;">
    <h1>Search</h1>
    ${resultsHtml}
  </div>`;
  const html = renderShell({
    title: query ? `"${query}" · Search · Dominick` : "Search · Dominick",
    description: "Search dominickdominick.com.",
    path: "/search",
    navItems,
    activeSlug: null,
    bodyHtml,
    ogImage: defaultOgImage || null,
    theme,
    footerText,
    customHead,
    noindex: true,
    searchQuery: query,
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

async function renderNotFound(env, navItems) {
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);
  const bodyHtml = `<div class="block" style="grid-column:1 / span 24;grid-row:1 / span 16;">
    ${renderNotFoundHtml(navItems)}
  </div>`;
  const html = renderShell({
    title: "Page not found · Dominick",
    description: "This page doesn't exist.",
    path: "/404",
    navItems,
    activeSlug: null,
    bodyHtml,
    ogImage: defaultOgImage || null,
    theme,
    footerText,
    customHead,
    noindex: true,
  });
  return new Response(html, { status: 404, headers: { "Content-Type": "text/html;charset=UTF-8" } });
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

function trackView(ctx, env, request, path) {
  let referrer = null;
  const refHeader = request.headers.get("Referer");
  if (refHeader) {
    try {
      const refHost = new URL(refHeader).hostname;
      if (refHost !== "dominickdominick.com") referrer = refHost;
    } catch {
      // ignore malformed referrer
    }
  }
  const country = request.cf?.country || null;
  ctx.waitUntil(recordPageview(env, { path, referrer, country }).catch(() => {}));
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      return new Response("Something went wrong. Try again in a moment.", {
        status: 500,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
      });
    }
  },
};

async function route(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/admin")) {
      return handleAdminApi(request, env, url, ctx);
    }

    if (path === "/sitemap.xml") {
      return renderSitemap(env);
    }

    if (path === "/rss.xml") {
      return renderRss(env);
    }

    if (path === "/search") {
      const navItems = await listNavPages(env);
      return renderSearch(env, url.searchParams.get("q")?.trim() || "", navItems);
    }

    const mediaMatch = path.match(/^\/media\/([A-Za-z0-9_.\-\/]+)$/);
    if (mediaMatch) {
      const obj = await env.MEDIA.get(mediaMatch[1]);
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      // Short + revalidate rather than immutable: the photo editor can
      // overwrite a file in place at the same URL, and a year-long
      // immutable cache would hide that change from readers.
      headers.set("Cache-Control", "public, max-age=300, must-revalidate");
      headers.set("ETag", obj.httpEtag);
      if (request.headers.get("If-None-Match") === obj.httpEtag) {
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

    // Redirects for old URLs that no longer resolve on their own — checked
    // before page/article lookup so one can override a still-existing page.
    const redirect = await getRedirect(env, path);
    if (redirect) {
      return Response.redirect(new URL(redirect.to_path, url.origin).toString(), redirect.status_code || 301);
    }

    // Individual article page: /random/:slug
    const articleMatch = path.match(/^\/random\/([a-z0-9-]+)$/);
    if (articleMatch) {
      const article = await getArticleBySlug(env, articleMatch[1]);
      const isPublished = article && article.published_at && article.published_at <= new Date().toISOString();
      const isPreview = url.searchParams.get("preview") === "1" && (await isAuthenticated(request, env));
      if (!article || (!isPublished && !isPreview)) {
        return env.ASSETS.fetch(request);
      }
      const navItems = await listNavPages(env);
      if (isPublished) trackView(ctx, env, request, path);
      return renderArticle(env, article, navItems);
    }

    const slug = path === "/" ? "home" : path.replace(/^\/+/, "").replace(/\/+$/, "");
    const page = await getPageBySlug(env, slug);
    if (page) {
      trackView(ctx, env, request, path);
      return renderPage(env, page, url);
    }

    // Fall through to static assets (style.css, nav.js, /admin app, images, etc.)
    // — but if that's also a miss, replace Cloudflare's bare 404 with a
    // branded one that helps a lost reader find their way back in.
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) return assetResponse;
    const navItems = await listNavPages(env);
    return renderNotFound(env, navItems);
}
