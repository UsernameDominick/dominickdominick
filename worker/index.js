import {
  getPageBySlug,
  listPages,
  listNavPages,
  listBlocks,
  listArticles,
  getArticleBySlug,
  getProjectBySlug,
  listProjects,
  getRelatedProjects,
  listJournalEntries,
  listBomItems,
  getSetting,
  recordPageview,
  getRedirect,
  publicSearch,
  getRelatedArticles,
  getSeriesArticles,
  getSimulation,
  getScan,
  logError,
  logEvent,
  checkRateLimit,
  recordRateLimitHit,
  runScheduledBackup,
} from "./db.js";
import { isAuthenticated } from "./auth.js";
import {
  renderShell,
  renderBlocks,
  renderTags,
  excerpt,
  readingTime,
  esc,
  safeHref,
  paragraphsHtml,
  extractHeadings,
  tableOfContentsHtml,
  renderSearchResultsHtml,
  renderRelatedArticlesHtml,
  renderNotFoundHtml,
  renderByline,
  renderSeriesNavHtml,
  renderRelatedProjectsHtml,
  renderJournalHtml,
  renderBomHtml,
  renderRelatedMediaHtml,
} from "./render.js";
import { handleAdminApi } from "./admin-api.js";
import { renderSimulationSvg } from "./simulation-render.js";

async function getTheme(env) {
  const [accent, bg, font, text, border, headingFont] = await Promise.all([
    getSetting(env, "theme_accent"),
    getSetting(env, "theme_bg"),
    getSetting(env, "theme_font"),
    getSetting(env, "theme_text"),
    getSetting(env, "theme_border"),
    getSetting(env, "theme_heading_font"),
  ]);
  return {
    accent: accent || null,
    bg: bg || null,
    font: font || null,
    text: text || null,
    border: border || null,
    headingFont: headingFont || null,
  };
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

async function renderProject(env, project, navItems) {
  const description = project.summary || excerpt(project.body) || project.title;
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);

  const linkButtons = ["github", "demo", "docs", "download"]
    .filter((key) => project.links && project.links[key])
    .map((key) => `<a class="btn" href="${esc(safeHref(project.links[key]))}" target="_blank" rel="noopener">${esc(key[0].toUpperCase() + key.slice(1))}</a>`)
    .join(" ");
  const techStackHtml = project.tech_stack && project.tech_stack.length
    ? `<div class="tags">${project.tech_stack.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>`
    : "";
  const related = await getRelatedProjects(env, project);
  const relatedHtml = renderRelatedProjectsHtml(related);
  const journalEntries = await listJournalEntries(env, project.id, { order: "ASC" });
  const journalHtml = renderJournalHtml(journalEntries);
  const bomItems = await listBomItems(env, project.id);
  const bomHtml = renderBomHtml(bomItems);
  // Build journals can add a lot of reading beyond the project body itself
  // (that's the whole point of a "long project page") — same reasoning
  // articles already use, just summed across both sources.
  const mins = readingTime(`${project.body}\n${journalEntries.map((j) => j.body).join("\n")}`);

  const [allPublishedArticles, relatedSims, relatedScanRows] = await Promise.all([
    project.related_articles.length ? listArticles(env, { publishedOnly: true }) : [],
    Promise.all(project.related_simulations.map((id) => getSimulation(env, id))),
    Promise.all(project.related_scans.map((id) => getScan(env, id))),
  ]);
  const relatedArticleRows = allPublishedArticles.filter((a) => project.related_articles.includes(a.id));
  const relatedMediaHtml = renderRelatedMediaHtml(relatedArticleRows, relatedSims.filter(Boolean), relatedScanRows.filter(Boolean));

  // Rows handed out in order (same reasoning as renderArticle) so an
  // optional section's length can't throw off the ones after it. Unlike
  // the article header (title/meta/tags only), a project header can also
  // carry a summary, tech stack, and link buttons, so its span has to grow
  // with what's actually present or long content overlaps the body below it.
  const headerSpan =
    6 +
    (project.summary ? 3 : 0) +
    (techStackHtml ? 2 : 0) +
    (project.tags && project.tags.length ? 2 : 0) +
    (linkButtons ? 2 : 0);
  let row = headerSpan + 2;
  const bodyRow = row;
  row += 12;
  const bomRow = bomHtml ? row : null;
  if (bomHtml) row += 4 + bomItems.length * 2;
  const journalRow = journalHtml ? row : null;
  if (journalHtml) row += 4 + journalEntries.length * 4;
  const relatedMediaRow = relatedMediaHtml ? row : null;
  if (relatedMediaHtml) row += 6;
  const relatedRow = row;

  const bodyHtml = `<div class="block" style="grid-column:1 / span 24;grid-row:1 / span ${headerSpan};">
    <div class="article-meta">
      ${project.status ? `<span>${esc(project.status)}</span><span class="article-meta-sep">·</span>` : ""}
      <time datetime="${esc(project.published_at)}">${esc((project.published_at || "").slice(0, 10))}</time>
      <span class="article-meta-sep">·</span>
      <span>${mins} min read</span>
      <button type="button" class="copy-link-btn" data-copy-text="Copy link" data-copied-text="Copied!">Copy link</button>
    </div>
    <h1>${esc(project.title)}</h1>
    ${project.summary ? `<p>${esc(project.summary)}</p>` : ""}
    ${techStackHtml}
    ${renderTags(project.tags)}
    ${linkButtons ? `<p>${linkButtons}</p>` : ""}
  </div>
  <div class="block" style="grid-column:1 / span 24;grid-row:${bodyRow} / span 12;">
    ${paragraphsHtml(project.body)}
  </div>
  ${bomHtml ? `<div class="block" style="grid-column:1 / span 24;grid-row:${bomRow} / span ${4 + bomItems.length * 2};">${bomHtml}</div>` : ""}
  ${journalHtml ? `<div class="block" style="grid-column:1 / span 24;grid-row:${journalRow} / span ${4 + journalEntries.length * 4};">${journalHtml}</div>` : ""}
  ${relatedMediaHtml ? `<div class="block" style="grid-column:1 / span 24;grid-row:${relatedMediaRow} / span 6;">${relatedMediaHtml}</div>` : ""}
  ${relatedHtml ? `<div class="block" style="grid-column:1 / span 24;grid-row:${relatedRow} / span 6;">${relatedHtml}</div>` : ""}`;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: project.title,
      description,
      dateCreated: project.created_at,
      dateModified: project.updated_at,
      author: { "@type": "Person", name: "Dominick" },
      ...(project.tags && project.tags.length ? { keywords: project.tags.join(", ") } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://dominickdominick.com/" },
        { "@type": "ListItem", position: 2, name: project.title, item: `https://dominickdominick.com/projects/${project.slug}` },
      ],
    },
  ];
  const html = renderShell({
    title: `${project.title} · Dominick`,
    description,
    path: `/projects/${project.slug}`,
    navItems,
    activeSlug: "projects",
    bodyHtml,
    jsonLd,
    ogType: "article",
    publishedTime: project.published_at,
    modifiedTime: project.updated_at,
    keywords: project.tags && project.tags.length ? project.tags.join(", ") : null,
    ogImage: project.og_image || defaultOgImage || null,
    theme,
    footerText,
    customHead,
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

async function renderSearch(env, query, navItems) {
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);
  const { pages, articles, projects } = query ? await publicSearch(env, query) : { pages: [], articles: [], projects: [] };
  const resultsHtml = renderSearchResultsHtml(query, pages, articles, projects);
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

// A standalone, read-only view of a saved circuit — the same rendering and
// power-toggle interactivity as the "Simulation" block, just on its own
// page so a circuit can be linked to directly instead of only embedded.
async function renderSimulationPage(env, sim, navItems) {
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);
  const uid = "sim-standalone";
  const svg = renderSimulationSvg(sim.data).replace('class="sim-svg"', `class="sim-svg" id="${esc(uid)}"`);
  const bodyHtml = `<div class="block" style="grid-column:1 / span 24;grid-row:1 / span 2;">
    <h1>${esc(sim.name)}</h1>
  </div>
  <div class="block" style="grid-column:1 / span 24;grid-row:3 / span 25;">
    <div class="sim-block-wrap">${svg}<button type="button" class="sim-power-btn" data-target="${esc(uid)}">Power on</button></div>
  </div>`;
  const html = renderShell({
    title: `${sim.name} · Dominick`,
    description: `An interactive circuit simulation: ${sim.name}.`,
    path: `/simulation/${sim.id}`,
    navItems,
    activeSlug: null,
    bodyHtml,
    theme,
    footerText,
    customHead,
    ogImage: defaultOgImage || null,
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

function xmlEsc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// type: "article" | "project" (blank = both, sorted together by date).
// tag: filters to that tag on whichever content type(s) are included.
async function renderRss(env, { type, tag } = {}) {
  const wantArticles = type !== "project";
  const wantProjects = type !== "article";
  const [articles, projects] = await Promise.all([
    wantArticles ? listArticles(env, { publishedOnly: true, limit: 30, tag: tag || null }) : [],
    wantProjects ? listProjects(env, { publishedOnly: true, limit: 30, tag: tag || null }) : [],
  ]);
  const entries = [
    ...articles.map((a) => ({ title: a.title, link: `https://dominickdominick.com/random/${a.slug}`, date: a.published_at, body: a.body })),
    ...projects.map((p) => ({
      title: p.title,
      link: `https://dominickdominick.com/projects/${p.slug}`,
      date: p.published_at,
      body: p.summary || p.body,
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));
  const items = entries
    .map(
      (e) => `  <item>
    <title>${xmlEsc(e.title)}</title>
    <link>${e.link}</link>
    <guid>${e.link}</guid>
    <pubDate>${new Date(e.date).toUTCString()}</pubDate>
    <description>${xmlEsc(excerpt(e.body, 300))}</description>
  </item>`
    )
    .join("\n");
  const titleSuffix = [type ? (type === "project" ? "Projects" : "Random") : null, tag ? `"${tag}"` : null].filter(Boolean).join(" — ");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Dominick${titleSuffix ? " — " + titleSuffix : " — Random"}</title>
  <link>https://dominickdominick.com/random</link>
  <description>Notes, projects, and half-formed ideas from Dominick.</description>
  <language>en</language>
${items}
</channel>
</rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml;charset=UTF-8" } });
}

async function renderSitemap(env) {
  const pages = await listPages(env);
  const articles = await listArticles(env, { publishedOnly: true });
  const projects = await listProjects(env, { publishedOnly: true });
  const entries = [
    ...pages.map((p) => ({ loc: p.slug === "home" ? "/" : `/${p.slug}`, lastmod: p.updated_at })),
    ...articles.map((a) => ({ loc: `/random/${a.slug}`, lastmod: a.updated_at || a.published_at })),
    ...projects.map((p) => ({ loc: `/projects/${p.slug}`, lastmod: p.updated_at || p.published_at })),
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
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  // Generous — this fires on every normal page load, so the point is only
  // to stop a script hammering pages purely to inflate the numbers, not to
  // limit real browsing.
  ctx.waitUntil(
    checkRateLimit(env, "pageview", ip, { windowMinutes: 1, maxAttempts: 90 })
      .then((allowed) => {
        if (!allowed) return;
        return Promise.all([recordPageview(env, { path, referrer, country }), recordRateLimitHit(env, "pageview", ip)]);
      })
      .catch(() => {})
  );
}

// A named event from the public site (copy-link click, theme toggle, a
// simulation's power button, etc.) — not tied to a visitor/session id, so
// it can only answer "how often", not "how many people".
async function handleTrackEvent(request, env, ctx) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const allowed = await checkRateLimit(env, "track", ip, { windowMinutes: 1, maxAttempts: 30 });
  if (!allowed) return new Response(null, { status: 429 });
  await recordRateLimitHit(env, "track", ip);
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) return new Response(null, { status: 400 });
  ctx.waitUntil(logEvent(env, { name, path: body.path || null, detail: body.detail || null }).catch(() => {}));
  return new Response(null, { status: 204 });
}

// A handful of headers that cost nothing and help regardless of route:
// blocks MIME-sniffing, stops the site being framed elsewhere (clickjacking),
// trims referrer leakage, and a CSP that's deliberately not nonce-strict —
// the admin's own "Custom <head> code" setting is trusted, admin-authored
// content that can include an inline <script> (e.g. pasting an analytics
// snippet), which a strict nonce policy would silently break.
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    // jsdelivr is <model-viewer> (for the 3D Scan block) — it's an ES
    // module and, for compressed models, loads its own decoder via a Web
    // Worker + WASM fetched from the same origin as the script itself,
    // hence the matching allowances on worker-src/connect-src too.
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
    "img-src 'self' data: https:",
    "font-src 'self' https://cdnjs.cloudflare.com data:",
    "connect-src 'self' https://cdn.jsdelivr.net",
    "worker-src 'self' blob: https://cdn.jsdelivr.net",
    // The Generic Embed block is deliberately "any iframe-able link" —
    // restricting this to a fixed list of services would break that
    // feature, so it's scoped to https: rather than named origins.
    "frame-src https:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
  ].join("; "),
};

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    try {
      const response = await route(request, env, ctx);
      return withSecurityHeaders(response);
    } catch (err) {
      const path = new URL(request.url).pathname;
      ctx.waitUntil(logError(env, { message: err.message, stack: err.stack, path }).catch(() => {}));
      return withSecurityHeaders(
        new Response("Something went wrong. Try again in a moment.", {
          status: 500,
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
        })
      );
    }
  },

  // Runs on the configured cron schedule (see wrangler.jsonc) — a full JSON
  // backup written to R2, since D1 itself has no built-in scheduled backup.
  // Media files in R2 aren't included (they're already durably stored there
  // as-is); this covers the D1-side content that only lives in one place.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledBackup(env));
  },
};

async function route(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/admin")) {
      return handleAdminApi(request, env, url, ctx);
    }

    if (path === "/api/track" && request.method === "POST") {
      return handleTrackEvent(request, env, ctx);
    }

    if (path === "/sitemap.xml") {
      return renderSitemap(env);
    }

    if (path === "/rss.xml") {
      return renderRss(env, { type: url.searchParams.get("type"), tag: url.searchParams.get("tag") });
    }

    if (path === "/shuffle") {
      const [articles, projects] = await Promise.all([
        listArticles(env, { publishedOnly: true }),
        listProjects(env, { publishedOnly: true }),
      ]);
      const candidates = [
        ...articles.map((a) => `/random/${a.slug}`),
        ...projects.map((p) => `/projects/${p.slug}`),
      ];
      if (!candidates.length) return Response.redirect(`${url.origin}/`, 302);
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return Response.redirect(`${url.origin}${pick}`, 302);
    }

    if (path === "/search") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const allowed = await checkRateLimit(env, "search", ip, { windowMinutes: 1, maxAttempts: 20 });
      if (!allowed) return new Response("Too many searches. Try again in a minute.", { status: 429 });
      ctx.waitUntil(recordRateLimitHit(env, "search", ip).catch(() => {}));
      const navItems = await listNavPages(env);
      return renderSearch(env, url.searchParams.get("q")?.trim() || "", navItems);
    }

    const simulationMatch = path.match(/^\/simulation\/(\d+)$/);
    if (simulationMatch) {
      const sim = await getSimulation(env, Number(simulationMatch[1]));
      if (!sim) return env.ASSETS.fetch(request);
      const navItems = await listNavPages(env);
      return renderSimulationPage(env, sim, navItems);
    }

    // Scoped to "uploads/" and "scans/" specifically — the same R2 bucket
    // also holds scheduled backups under "backups/", which must never be
    // servable through this public route.
    const mediaMatch = path.match(/^\/media\/((?:uploads|scans)\/[A-Za-z0-9_.\-\/]+)$/);
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

    // Individual project page: /projects/:slug
    const projectMatch = path.match(/^\/projects\/([a-z0-9-]+)$/);
    if (projectMatch) {
      const project = await getProjectBySlug(env, projectMatch[1]);
      const isPublished = project && project.published_at && project.published_at <= new Date().toISOString();
      const isPreview = url.searchParams.get("preview") === "1" && (await isAuthenticated(request, env));
      if (!project || (!isPublished && !isPreview)) {
        return env.ASSETS.fetch(request);
      }
      const navItems = await listNavPages(env);
      if (isPublished) trackView(ctx, env, request, path);
      return renderProject(env, project, navItems);
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
