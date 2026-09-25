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
  parseUserAgent,
  getRedirect,
  publicSearch,
  getRelatedArticles,
  getProjectsLinkingToArticle,
  getSeriesArticles,
  getSimulation,
  getScan,
  logError,
  logEvent,
  checkRateLimit,
  recordRateLimitHit,
  addReaction,
  getReactionCounts,
  getValidPreviewLink,
  runScheduledBackup,
  getTagCounts,
  getArchive,
  getContentByTag,
  getTopicMeta,
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
  renderFeaturedInProjectsHtml,
  renderNotFoundHtml,
  renderByline,
  renderSeriesNavHtml,
  renderRelatedProjectsHtml,
  renderJournalHtml,
  renderBomHtml,
  renderDownloadsHtml,
  renderRelatedMediaHtml,
  renderTopicsIndexHtml,
  renderArchiveHtml,
  renderTopicPageHtml,
  renderShareLinks,
  renderReactionsHtml,
  renderCorrectionNoteHtml,
  renderTtsBarHtml,
  FAVICON_SVG,
  renderErrorPageHtml,
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
  const [defaultOgImage, theme, footerText, customHead, emptySearchText, emptyArchiveText, emptyTopicsText] = await Promise.all([
    getSetting(env, "default_og_image"),
    getTheme(env),
    getSetting(env, "site_footer"),
    getSetting(env, "custom_head"),
    getSetting(env, "empty_search_text"),
    getSetting(env, "empty_archive_text"),
    getSetting(env, "empty_topics_text"),
  ]);
  return { defaultOgImage, theme, footerText, customHead, emptySearchText, emptyArchiveText, emptyTopicsText };
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
    canonicalUrl: page.canonical_url || null,
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
  const featuredInProjects = await getProjectsLinkingToArticle(env, article.id);
  const featuredInHtml = renderFeaturedInProjectsHtml(featuredInProjects);
  const seriesArticles = article.series ? await getSeriesArticles(env, article.series) : [];
  const seriesNavHtml = renderSeriesNavHtml(article, seriesArticles);
  const bylineHtml = renderByline(article);
  const reactionCounts = await getReactionCounts(env, "article", article.id);
  const reactionsHtml = renderReactionsHtml("article", article.id, reactionCounts);
  const correctionNoteHtml = renderCorrectionNoteHtml(article.correction_note);
  const ttsBarHtml = renderTtsBarHtml(article.tts_audio_key);
  // A meaningful gap (not every autosave tick right after publishing)
  // between published_at and updated_at is what actually earns a visible
  // "Updated" — otherwise every article would show one moments after going live.
  const wasUpdated = article.updated_at && article.published_at && new Date(article.updated_at) - new Date(article.published_at) > 24 * 3600 * 1000;

  // Sections flow top to bottom in normal document flow (see .article-canvas
  // in style.css) rather than fixed grid-row spans computed ahead of time —
  // a fixed span for the body assumed a rough content length that any real
  // long-form article blows past, overlapping whatever came after it
  // (reactions, related articles). Flow layout can't overlap; each section
  // just takes the height its own content needs.
  const bodyHtml = `<div class="reading-progress"></div>
  <div class="block">
    <div class="article-meta">
      <time datetime="${esc(article.published_at)}">${esc((article.published_at || "").slice(0, 10))}</time>
      ${wasUpdated ? `<span class="article-meta-sep">·</span><span>Updated <time datetime="${esc(article.updated_at)}">${esc((article.updated_at || "").slice(0, 10))}</time></span>` : ""}
      <span class="article-meta-sep">·</span>
      <span>${mins} min read</span>
      ${bylineHtml ? `<span class="article-meta-sep">·</span>${bylineHtml}` : ""}
      ${renderShareLinks(article.title, `/random/${article.slug}`)}
    </div>
    <h1>${esc(article.title)}</h1>
    ${renderTags(article.tags)}
  </div>
  <div class="block">${ttsBarHtml}</div>
  ${correctionNoteHtml ? `<div class="block">${correctionNoteHtml}</div>` : ""}
  ${seriesNavHtml ? `<div class="block">${seriesNavHtml}</div>` : ""}
  ${tocHtml ? `<div class="block">${tocHtml}</div>` : ""}
  <div class="block">
    <div id="readable-content">${paragraphsHtml(article.body)}</div>
  </div>
  <div class="block">${reactionsHtml}</div>
  ${featuredInHtml ? `<div class="block">${featuredInHtml}</div>` : ""}
  ${relatedHtml ? `<div class="block">${relatedHtml}</div>` : ""}`;
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
    canonicalUrl: article.canonical_url || null,
    theme,
    footerText,
    customHead,
    canvasClass: "canvas article-canvas",
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
  const reactionCounts = await getReactionCounts(env, "project", project.id);
  const reactionsHtml = renderReactionsHtml("project", project.id, reactionCounts);
  const journalEntries = await listJournalEntries(env, project.id, { order: "ASC" });
  const journalHtml = renderJournalHtml(journalEntries);
  const bomItems = await listBomItems(env, project.id);
  const bomHtml = renderBomHtml(bomItems);
  const downloads = Array.isArray(project.links && project.links.downloads) ? project.links.downloads : [];
  const downloadsHtml = renderDownloadsHtml(downloads);
  const correctionNoteHtml = renderCorrectionNoteHtml(project.correction_note);
  const ttsBarHtml = renderTtsBarHtml(project.tts_audio_key);
  const wasUpdated = project.updated_at && project.published_at && new Date(project.updated_at) - new Date(project.published_at) > 24 * 3600 * 1000;
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

  // Normal document flow (see .article-canvas in style.css), same fix and
  // reasoning as renderArticle just above — a project page has even more
  // variable-length optional sections (BOM, journal entries, downloads)
  // than an article does, all of which could overlap under the old fixed
  // grid-row-span scheme.
  const bodyHtml = `<div class="block">
    <div class="article-meta">
      ${project.status ? `<span>${esc(project.status)}</span><span class="article-meta-sep">·</span>` : ""}
      <time datetime="${esc(project.published_at)}">${esc((project.published_at || "").slice(0, 10))}</time>
      ${wasUpdated ? `<span class="article-meta-sep">·</span><span>Updated <time datetime="${esc(project.updated_at)}">${esc((project.updated_at || "").slice(0, 10))}</time></span>` : ""}
      <span class="article-meta-sep">·</span>
      <span>${mins} min read</span>
      ${renderShareLinks(project.title, `/projects/${project.slug}`)}
    </div>
    <h1>${esc(project.title)}</h1>
    ${project.summary ? `<p>${esc(project.summary)}</p>` : ""}
    ${techStackHtml}
    ${renderTags(project.tags)}
    ${linkButtons ? `<p>${linkButtons}</p>` : ""}
  </div>
  <div class="block">${ttsBarHtml}</div>
  ${correctionNoteHtml ? `<div class="block">${correctionNoteHtml}</div>` : ""}
  <div class="block">
    <div id="readable-content">${paragraphsHtml(project.body)}</div>
  </div>
  <div class="block">${reactionsHtml}</div>
  ${downloadsHtml ? `<div class="block">${downloadsHtml}</div>` : ""}
  ${bomHtml ? `<div class="block">${bomHtml}</div>` : ""}
  ${journalHtml ? `<div class="block">${journalHtml}</div>` : ""}
  ${relatedMediaHtml ? `<div class="block">${relatedMediaHtml}</div>` : ""}
  ${relatedHtml ? `<div class="block">${relatedHtml}</div>` : ""}`;

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
    canonicalUrl: project.canonical_url || null,
    theme,
    footerText,
    customHead,
    canvasClass: "canvas article-canvas",
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

async function renderSearch(env, query, navItems, ctx) {
  const { defaultOgImage, theme, footerText, customHead, emptySearchText } = await getSiteContext(env);
  const { pages, articles, projects } = query ? await publicSearch(env, query) : { pages: [], articles: [], projects: [] };
  if (query) {
    const count = pages.length + articles.length + projects.length;
    ctx.waitUntil(logEvent(env, { name: "search", path: "/search", detail: JSON.stringify({ q: query, count }) }).catch(() => {}));
  }
  const resultsHtml = renderSearchResultsHtml(query, pages, articles, projects, emptySearchText);
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

async function renderTopicsIndex(env, navItems) {
  const { defaultOgImage, theme, footerText, customHead, emptyTopicsText } = await getSiteContext(env);
  const tagCounts = await getTagCounts(env);
  const bodyHtml = `<div class="block" style="grid-column:1 / span 24;grid-row:1 / span 16;">
    <h1>Topics</h1>
    <p>Everything tagged, across posts and projects.</p>
    ${renderTopicsIndexHtml(tagCounts, emptyTopicsText)}
  </div>`;
  const html = renderShell({
    title: "Topics · Dominick",
    description: "Browse everything on dominickdominick.com by topic.",
    path: "/topics",
    navItems,
    activeSlug: null,
    bodyHtml,
    ogImage: defaultOgImage || null,
    theme,
    footerText,
    customHead,
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

async function renderArchive(env, navItems) {
  const { defaultOgImage, theme, footerText, customHead, emptyArchiveText } = await getSiteContext(env);
  const archive = await getArchive(env);
  const bodyHtml = `<div class="block" style="grid-column:1 / span 24;grid-row:1 / span 16;">
    <h1>Archive</h1>
    <p>Everything published, by year.</p>
    ${renderArchiveHtml(archive, emptyArchiveText)}
  </div>`;
  const html = renderShell({
    title: "Archive · Dominick",
    description: "Everything published on dominickdominick.com, organized by year.",
    path: "/archive",
    navItems,
    activeSlug: null,
    bodyHtml,
    ogImage: defaultOgImage || null,
    theme,
    footerText,
    customHead,
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

// Reading history lives entirely in the visitor's own browser (localStorage,
// written by nav.js as they view articles/projects) — never sent to or
// stored on the server, so this route just ships the empty shell and lets
// client-side JS fill it in from whatever's already in that browser.
async function renderHistoryPage(env, navItems) {
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);
  const bodyHtml = `<div class="block" style="grid-column:1 / span 24;grid-row:1 / span 16;">
    <h1>Reading History</h1>
    <p>Stored only in your browser — never sent to or seen by this site. <button type="button" id="clear-history-btn">Clear history</button></p>
    <div id="reading-history-list"><noscript>Requires JavaScript.</noscript></div>
  </div>`;
  const html = renderShell({
    title: "Reading History · Dominick",
    description: "Articles and projects you've viewed, stored locally in your browser.",
    path: "/history",
    navItems,
    activeSlug: null,
    bodyHtml,
    ogImage: defaultOgImage || null,
    theme,
    footerText,
    customHead,
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

// Same client-only pattern as reading history — bookmarks live in the
// visitor's own localStorage, this route just ships the empty shell.
async function renderSavedPage(env, navItems) {
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);
  const bodyHtml = `<div class="block" style="grid-column:1 / span 24;grid-row:1 / span 16;">
    <h1>Saved</h1>
    <p>Stored only in your browser — never sent to or seen by this site. <button type="button" id="clear-saved-btn">Clear all</button></p>
    <div id="saved-items-list"><noscript>Requires JavaScript.</noscript></div>
  </div>`;
  const html = renderShell({
    title: "Saved · Dominick",
    description: "Articles and projects you've saved for later, stored locally in your browser.",
    path: "/saved",
    navItems,
    activeSlug: null,
    bodyHtml,
    ogImage: defaultOgImage || null,
    theme,
    footerText,
    customHead,
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

async function renderTopicPage(env, tag, navItems) {
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);
  const [{ articles, projects }, topicMeta] = await Promise.all([getContentByTag(env, tag), getTopicMeta(env, tag)]);
  const bodyHtml = `<div class="block" style="grid-column:1 / span 24;grid-row:1 / span 16;">
    <h1>Tagged: ${esc(tag)}</h1>
    ${topicMeta?.description ? `<p class="topic-intro">${esc(topicMeta.description)}</p>` : ""}
    ${renderTopicPageHtml(tag, articles, projects)}
  </div>`;
  const html = renderShell({
    title: `${tag} · Topics · Dominick`,
    description: topicMeta?.description || `Posts and projects tagged "${tag}" on dominickdominick.com.`,
    path: `/topics/${encodeURIComponent(tag)}`,
    navItems,
    activeSlug: null,
    bodyHtml,
    ogImage: topicMeta?.og_image || defaultOgImage || null,
    theme,
    footerText,
    customHead,
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
  const tagCounts = await getTagCounts(env);
  const entries = [
    ...pages.filter((p) => !p.sitemap_exclude).map((p) => ({ loc: p.slug === "home" ? "/" : `/${p.slug}`, lastmod: p.updated_at })),
    ...articles.filter((a) => !a.sitemap_exclude).map((a) => ({ loc: `/random/${a.slug}`, lastmod: a.updated_at || a.published_at })),
    ...projects.filter((p) => !p.sitemap_exclude).map((p) => ({ loc: `/projects/${p.slug}`, lastmod: p.updated_at || p.published_at })),
    { loc: "/topics", lastmod: null },
    { loc: "/archive", lastmod: null },
    ...tagCounts.map((t) => ({ loc: `/topics/${encodeURIComponent(t.tag)}`, lastmod: null })),
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
  // region/city come from the same Cloudflare-populated request.cf object
  // as country — free, no separate geolocation lookup needed. Both are
  // undefined in local `wrangler dev` (which fills request.cf with a
  // placeholder), so this only actually gets a value on the real edge.
  const region = request.cf?.region || null;
  const city = request.cf?.city || null;
  const { device, browser } = parseUserAgent(request.headers.get("User-Agent"));
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  // Generous — this fires on every normal page load, so the point is only
  // to stop a script hammering pages purely to inflate the numbers, not to
  // limit real browsing.
  ctx.waitUntil(
    checkRateLimit(env, "pageview", ip, { windowMinutes: 1, maxAttempts: 90 })
      .then((allowed) => {
        if (!allowed) return;
        return Promise.all([
          recordPageview(env, { path, referrer, country, device, browser, region, city }),
          recordRateLimitHit(env, "pageview", ip),
        ]);
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

// A reaction click from the public site — aggregate counts only, no
// visitor identity recorded (double-voting is discouraged client-side via
// localStorage, never enforced here, matching the site's no-accounts
// approach elsewhere).
async function handleReact(request, env, ctx) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const allowed = await checkRateLimit(env, "react", ip, { windowMinutes: 1, maxAttempts: 20 });
  if (!allowed) return new Response(null, { status: 429 });
  await recordRateLimitHit(env, "react", ip);
  const body = await request.json().catch(() => ({}));
  const contentType = body.contentType === "project" ? "project" : body.contentType === "article" ? "article" : null;
  const contentId = Number(body.contentId);
  if (!contentType || !Number.isFinite(contentId)) return new Response(null, { status: 400 });
  try {
    await addReaction(env, contentType, contentId, String(body.emoji || ""));
  } catch {
    return new Response(null, { status: 400 });
  }
  const counts = await getReactionCounts(env, contentType, contentId);
  return new Response(JSON.stringify(counts), { headers: { "Content-Type": "application/json" } });
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
      // API/admin routes should still get a plain error a client can parse
      // (JSON.parse would choke on the branded HTML page below); the
      // branded page is for a human hitting a broken public/admin page.
      if (path.startsWith("/api/")) {
        return withSecurityHeaders(
          new Response("Something went wrong. Try again in a moment.", {
            status: 500,
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
          })
        );
      }
      return withSecurityHeaders(
        new Response(renderErrorPageHtml(), {
          status: 500,
          headers: { "Content-Type": "text/html;charset=UTF-8" },
        })
      );
    }
  },

  // Runs on the configured cron schedule (see wrangler.jsonc) — a full JSON
  // backup written to R2, since D1 itself has no built-in scheduled backup.
  // Media files in R2 aren't included (they're already durably stored there
  // as-is); this covers the D1-side content that only lives in one place.
  async scheduled(event, env, ctx) {
    // Unlike a request handler's errors (caught by the top-level try/catch
    // in fetch() below), a rejection inside a cron ctx.waitUntil is only
    // ever visible in Cloudflare's own dashboard logs — nothing surfaces
    // it to the admin. runScheduledBackup already records the failure to
    // settings for the UI status line; this also gets it into the same
    // error_log every other uncaught error already goes to.
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

    if (path === "/api/track" && request.method === "POST") {
      return handleTrackEvent(request, env, ctx);
    }

    if (path === "/api/react" && request.method === "POST") {
      return handleReact(request, env, ctx);
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
      return renderSearch(env, url.searchParams.get("q")?.trim() || "", navItems, ctx);
    }

    // Type-ahead suggestions for the topbar search box — a lighter, higher-
    // rate-limit sibling of /search's own page-view rate limit above, since
    // this fires (debounced) per keystroke rather than per submit. Fails
    // quiet (empty results) rather than an error page on rate-limit, since
    // it's a background enhancement, not the primary search action.
    if (path === "/api/search-suggest") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return new Response(JSON.stringify({ results: [] }), { headers: { "Content-Type": "application/json" } });
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const allowed = await checkRateLimit(env, "search-suggest", ip, { windowMinutes: 1, maxAttempts: 60 });
      if (!allowed) return new Response(JSON.stringify({ results: [] }), { status: 429, headers: { "Content-Type": "application/json" } });
      ctx.waitUntil(recordRateLimitHit(env, "search-suggest", ip).catch(() => {}));
      const { pages, articles, projects } = await publicSearch(env, q);
      const results = [
        ...pages.slice(0, 3).map((p) => ({ type: "Page", title: p.title, url: p.slug === "home" ? "/" : `/${p.slug}` })),
        ...articles.slice(0, 3).map((a) => ({ type: "Article", title: a.title, url: `/random/${a.slug}` })),
        ...projects.slice(0, 3).map((p) => ({ type: "Project", title: p.title, url: `/projects/${p.slug}` })),
      ].slice(0, 6);
      return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } });
    }

    if (path === "/topics") {
      const navItems = await listNavPages(env);
      return renderTopicsIndex(env, navItems);
    }
    const topicMatch = path.match(/^\/topics\/([^/]+)$/);
    if (topicMatch) {
      const navItems = await listNavPages(env);
      return renderTopicPage(env, decodeURIComponent(topicMatch[1]), navItems);
    }

    if (path === "/archive") {
      const navItems = await listNavPages(env);
      return renderArchive(env, navItems);
    }

    if (path === "/history") {
      const navItems = await listNavPages(env);
      return renderHistoryPage(env, navItems);
    }

    if (path === "/saved") {
      const navItems = await listNavPages(env);
      return renderSavedPage(env, navItems);
    }

    const simulationMatch = path.match(/^\/simulation\/(\d+)$/);
    if (simulationMatch) {
      const sim = await getSimulation(env, Number(simulationMatch[1]));
      if (!sim) {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) return assetResponse;
        return renderNotFound(env, await listNavPages(env));
      }
      const navItems = await listNavPages(env);
      return renderSimulationPage(env, sim, navItems);
    }

    // Scoped to "uploads/", "scans/", and "audio/" specifically — the same
    // R2 bucket also holds scheduled backups under "backups/", which must
    // never be servable through this public route.
    const mediaMatch = path.match(/^\/media\/((?:uploads|scans|audio)\/[A-Za-z0-9_.\-\/]+)$/);
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

    // Browsers probe /favicon.ico directly regardless of the <link
    // rel="icon"> data-URI already in the page head — without this, every
    // single page load logs a 404 for it.
    if (path === "/favicon.ico") {
      return new Response(FAVICON_SVG, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
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
      const now = new Date().toISOString();
      const isPublished = article && article.published_at && article.published_at <= now && (!article.expires_at || article.expires_at > now);
      const isAdminPreview = url.searchParams.get("preview") === "1" && (await isAuthenticated(request, env));
      const previewToken = url.searchParams.get("preview_token");
      const isSharedPreview = article && previewToken && (await getValidPreviewLink(env, "article", article.id, previewToken));
      const isPreview = isAdminPreview || isSharedPreview;
      if (!article || (!isPublished && !isPreview)) {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) return assetResponse;
        return renderNotFound(env, await listNavPages(env));
      }
      const navItems = await listNavPages(env);
      if (isPublished) trackView(ctx, env, request, path);
      return renderArticle(env, article, navItems);
    }

    // Individual project page: /projects/:slug
    const projectMatch = path.match(/^\/projects\/([a-z0-9-]+)$/);
    if (projectMatch) {
      const project = await getProjectBySlug(env, projectMatch[1]);
      const now = new Date().toISOString();
      const isPublished = project && project.published_at && project.published_at <= now && (!project.expires_at || project.expires_at > now);
      const isAdminPreview = url.searchParams.get("preview") === "1" && (await isAuthenticated(request, env));
      const previewToken = url.searchParams.get("preview_token");
      const isSharedPreview = project && previewToken && (await getValidPreviewLink(env, "project", project.id, previewToken));
      const isPreview = isAdminPreview || isSharedPreview;
      if (!project || (!isPublished && !isPreview)) {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) return assetResponse;
        return renderNotFound(env, await listNavPages(env));
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
