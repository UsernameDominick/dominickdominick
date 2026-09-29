import {
  getPageBySlug,
  listPages,
  RESERVED_SLUGS,
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
  getPublishedSimulation,
  listPublishedSimulationIds,
  getScan,
  getSongsByIds,
  logError,
  logEvent,
  checkRateLimit,
  recordRateLimitHit,
  addReaction,
  getReactionCounts,
  getValidPreviewLink,
  runScheduledBackup,
  runScheduledLinkCheck,
  getTagCounts,
  getArchive,
  listArticlesPaged,
  listProjectsPaged,
  INDEX_PAGE_SIZE,
  SEARCH_PAGE_SIZE,
  getContentByTag,
  getTopicMeta,
  isInSitemap,
} from "./db.js";
import { isAuthenticated, parseCookies, hmac, timingSafeEqual } from "./auth.js";
import {
  renderShell,
  renderBlocks,
  isBlockShown,
  renderTags,
  excerpt,
  displayDate,
  absoluteUrl,
  imgSizeAttrs as coverSizeAttrs,
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
  renderRelatedSongsHtml,
  renderTopicsIndexHtml,
  renderArchiveHtml,
  renderIndexPaginationHtml,
  renderArticlesIndexHtml,
  renderProjectsIndexHtml,
  renderTopicPageHtml,
  renderShareLinks,
  renderReactionsHtml,
  renderCorrectionNoteHtml,
  renderTtsBarHtml,
  renderHeroVideoHtml,
  renderPreviewBannerHtml,
  renderBreadcrumbHtml,
  withCustomJsonLd,
  faviconSvg,
  renderErrorPageHtml,
  CONTROL_PRESETS,
} from "./render.js";
import { handleAdminApi } from "./admin-api.js";
import {
  capacitanceMicrofarads,
  computeCircuitAnalysis,
  formatCapacitance,
  formatVolts,
  formatInductance,
  getSimulationComponentDefinition,
  inductanceMillihenries,
  inductorWindingOhms,
  LED_COLORS,
  LOGIC_GATES,
  logicGateIsCustom,
  logicGateRows,
  logicGateTruth,
  resolveLogicGate,
  OUTLET_VOLTAGE,
  renderSimulationSvg,
} from "./simulation-render.js";

// Whole-site draft-inclusive preview mode — a plain, non-secret cookie an
// admin toggles from the admin header's "Preview mode" button. Unlike
// per-item ?preview=1, this follows normal navigation (nav links, related
// content, search results, a URL typed by hand) without needing that query
// param re-added everywhere, since the cookie rides along with every
// request in the same browser automatically. It grants nothing on its
// own — every check below still requires isAuthenticated too, so a visitor
// setting this cookie themselves (nothing stops that; it's not a secret)
// sees no more than they already could without it. Deliberately scoped to
// individual article/project pages only, not listings/RSS/search/sitemap —
// those still show published-only content even in preview mode, the same
// way most CMS "preview" modes don't leak drafts into a subscribed feed.
function hasPreviewModeCookie(request) {
  return parseCookies(request.headers.get("Cookie")).preview_mode === "1";
}

// Maintenance mode — a Site Settings toggle that takes the whole public
// site down to one plain "we'll be back" page while an admin is doing
// something risky. Exempts /admin (and /api/admin, already routed
// elsewhere before this ever runs) so a logged-out admin can still reach
// the login screen to turn it back off, plus the actual static files and
// uploaded media the site needs. This used to be a blanket file-extension
// regex, which let real content through by accident: a topic tag like
// "node.js" (extension "js") or a page slug starting with "admin" (prefix
// match, not an exact one) fully rendered its real content instead of the
// maintenance page. An explicit allowlist can't have that failure mode.
const MAINTENANCE_EXEMPT_FILES = new Set(["/nav.js", "/sim-player.js", "/song-embed.js", "/song-engine.js", "/style.css", "/favicon.ico"]);
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
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0c0a16; color: #f4eefc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: center; padding: 24px; }
  .maintenance-box { max-width: 480px; }
  h1 { font-size: 1.4rem; margin-bottom: 12px; }
  p { color: #b6a9d1; line-height: 1.6; }
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

const CONTROL_SETTING_KEYS = Object.keys(CONTROL_PRESETS);

// Author/publisher for structured data -- the url ties posts back to the
// site's Person entity (the homepage JSON-LD) for search engines.
const SITE_AUTHOR = { "@type": "Person", name: "Dominick", url: "https://dominickdominick.com/" };

// /random and /projects: a CollectionPage whose ItemList names every item
// on the page, so search engines read it as an index, not a thin page.
function indexJsonLd(name, path, items) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name,
      url: `https://dominickdominick.com${path}`,
      inLanguage: "en",
      mainEntity: {
        "@type": "ItemList",
        itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, url: item.url })),
      },
    },
  ];
}

function wordCount(md) {
  const words = String(md || "").replace(/```[\s\S]*?```/g, " ").match(/[\p{L}\p{N}'’-]+/gu);
  return words ? words.length : 0;
}

async function getTheme(env) {
  const [accent, bg, font, text, border, headingFont, mobileBreakpoint, customFontName, customFontUrl, ...controls] = await Promise.all([
    getSetting(env, "theme_accent"),
    getSetting(env, "theme_bg"),
    getSetting(env, "theme_font"),
    getSetting(env, "theme_text"),
    getSetting(env, "theme_border"),
    getSetting(env, "theme_heading_font"),
    getSetting(env, "mobile_breakpoint"),
    getSetting(env, "custom_font_name"),
    getSetting(env, "custom_font_url"),
    ...CONTROL_SETTING_KEYS.map((key) => getSetting(env, key)),
  ]);
  return {
    ...Object.fromEntries(CONTROL_SETTING_KEYS.map((key, i) => [key, controls[i] || null])),
    accent: accent || null,
    bg: bg || null,
    font: font || null,
    text: text || null,
    border: border || null,
    headingFont: headingFont || null,
    mobileBreakpoint: Number(mobileBreakpoint) || 640,
    customFontName: customFontName || null,
    customFontUrl: customFontUrl || null,
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

// A page's own "you already unlocked this" cookie — keyed to both the page
// id and its current password_hash (not the raw password), so a token
// stays valid until the password is next changed, at which point the old
// token silently stops matching rather than needing an explicit revoke.
async function pageAccessToken(env, page) {
  return hmac(env.SESSION_SECRET, `page-access:${page.id}:${page.password_hash}`);
}
async function hasPageAccess(request, env, page) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const cookie = cookies[`page_pw_${page.id}`];
  if (!cookie) return false;
  const expected = await pageAccessToken(env, page);
  return timingSafeEqual(cookie, expected);
}

function renderPagePasswordFormHtml(page, wrongPassword) {
  return `<div class="block password-gate">
    <h1>${esc(page.title)}</h1>
    <p>This page is password protected.</p>
    <p class="password-gate-error" role="alert">${wrongPassword ? "Wrong password — try again." : ""}</p>
    <form method="POST" action="/page-access/${esc(page.slug)}" class="password-gate-form">
      <label for="page-password-input">Password</label>
      <div class="password-gate-input-row">
        <input id="page-password-input" type="password" name="password" placeholder="Password" required autofocus>
        <button type="submit">Unlock</button>
      </div>
    </form>
  </div>`;
}

async function renderPage(env, page, url, request) {
  const [navItems, siteContext] = await Promise.all([listNavPages(env), getSiteContext(env)]);
  const { defaultOgImage, theme, footerText, customHead } = siteContext;
  // An authenticated admin always sees the real content — same bypass
  // maintenance mode and preview mode already use — so previewing/editing
  // a password-protected page never means also knowing its password.
  const isAdmin = await isAuthenticated(request, env);
  const locked = page.password_hash && !isAdmin && !(await hasPageAccess(request, env, page));
  if (locked) {
    const bodyHtml = renderPagePasswordFormHtml(page, url.searchParams.get("error") === "1");
    const html = renderShell({
      title: page.title,
      description: page.meta_description,
      path: page.slug === "home" ? "/" : `/${page.slug}`,
      navItems,
      activeSlug: page.slug,
      bodyHtml,
      ogImage: defaultOgImage || null,
      theme,
      footerText,
      customHead,
      noindex: true,
    });
    return new Response(html, { status: 401, headers: { "Content-Type": "text/html;charset=UTF-8" } });
  }
  const blocks = await listBlocks(env, page.id);
  const activeTagFilter = url.searchParams.get("tag") || null;
  const bodyHtml = await renderBlocks(env, blocks, { activeTagFilter, isAdmin, query: url.searchParams });
  // A page has no single body-text field to fall back to the way an
  // article/project's excerpt(body) already does — build an equivalent
  // fallback from its own text/heading blocks (reading order, same
  // top-to-bottom/left-to-right sort Diagnostics uses) so a page whose
  // admin never filled in "Meta description" doesn't ship an empty
  // <meta name="description"> and empty og:description instead.
  const description =
    page.meta_description ||
    excerpt(
      blocks
        .filter((b) => isBlockShown(b, url.searchParams) && (b.type === "text" || b.type === "heading") && b.content && b.content.text)
        .sort((a, b) => a.row - b.row || a.col - b.col)
        .map((b) => b.content.text)
        .join(" ")
    ) ||
    page.title;
  const pagePath = page.slug === "home" ? "/" : `/${page.slug}`;
  const jsonLd =
    page.slug === "home"
      ? {
          "@context": "https://schema.org",
          "@type": "Person",
          name: "Dominick",
          url: "https://dominickdominick.com/",
          sameAs: ["https://github.com/UsernameDominick"],
        }
      : // Every other page previously shipped with no structured data at
        // all (unless the admin manually added custom_json_ld) — a plain
        // WebPage entry is the same minimum every other content type here
        // already gets (BlogPosting for articles, CreativeWork for
        // projects), just for the generic page-builder pages.
        {
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: page.title,
          description,
          url: `https://dominickdominick.com${pagePath}`,
        };
  const html = renderShell({
    title: page.title,
    description,
    path: pagePath,
    navItems,
    activeSlug: page.slug,
    bodyHtml,
    jsonLd: withCustomJsonLd(jsonLd, page.custom_json_ld),
    ogImage: page.og_image || defaultOgImage || null,
    canonicalUrl: page.canonical_url || null,
    theme,
    footerText,
    customHead,
    editUrl: isAdmin ? `/admin/?edit=page:${page.id}` : null,
  });
  // A page with address-gated blocks differs by query string, so it must never be
  // served from a shared cache to someone with another address.
  const gated = blocks.some((b) => b.style && (b.style.urlRule === "show" || b.style.urlRule === "hide"));
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8", ...(gated ? { "Cache-Control": "private, no-store" } : {}) } });
}

async function renderArticle(env, article, navItems, previewReason = null, isAdmin = false) {
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
  const breadcrumbHtml = renderBreadcrumbHtml([
    { name: "Home", path: "/" },
    { name: "Articles", path: "/random" },
    { name: article.title, path: `/random/${article.slug}` },
  ]);
  const bodyHtml = `<div class="reading-progress"></div>
  ${renderPreviewBannerHtml(previewReason)}
  ${breadcrumbHtml}
  <div class="block page-header">
    <div class="article-meta">
      <time datetime="${esc(article.published_at)}">${esc(displayDate(article.published_at))}</time>
      ${wasUpdated ? `<span class="article-meta-sep">·</span><span>Updated <time datetime="${esc(article.updated_at)}">${esc(displayDate(article.updated_at))}</time></span>` : ""}
      <span class="article-meta-sep">·</span>
      <span>${mins} min read</span>
      ${bylineHtml ? `<span class="article-meta-sep">·</span>${bylineHtml}` : ""}
    </div>
    <h1>${esc(article.title)}</h1>
    ${renderTags(article.tags)}
    <div class="article-actions">${renderShareLinks(article.title, `/random/${article.slug}`)}</div>
    ${article.og_image ? `<img class="article-cover" src="${esc(article.og_image)}" alt="" loading="eager" fetchpriority="high"${await coverSizeAttrs(env, article.og_image)}>` : ""}
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
      description,
      url: `https://dominickdominick.com/random/${article.slug}`,
      // Google's Article rich result requires an image; relative URLs aren't
      // valid here (or in og:image) -- see absoluteUrl().
      ...(article.og_image || defaultOgImage ? { image: [absoluteUrl(article.og_image || defaultOgImage)] } : {}),
      datePublished: toIso8601(article.published_at),
      dateModified: toIso8601(article.updated_at || article.published_at),
      author: SITE_AUTHOR,
      publisher: SITE_AUTHOR,
      mainEntityOfPage: `https://dominickdominick.com/random/${article.slug}`,
      inLanguage: "en",
      wordCount: wordCount(article.body),
      ...(article.tags && article.tags.length ? { keywords: article.tags.join(", ") } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://dominickdominick.com/" },
        { "@type": "ListItem", position: 2, name: "Articles", item: "https://dominickdominick.com/random" },
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
    jsonLd: withCustomJsonLd(jsonLd, article.custom_json_ld),
    ogType: "article",
    publishedTime: toIso8601(article.published_at),
    modifiedTime: toIso8601(article.updated_at),
    keywords: article.tags && article.tags.length ? article.tags.join(", ") : null,
    ogImage: article.og_image || defaultOgImage || null,
    ogImageSize: await coverSizeAttrs(env, article.og_image || defaultOgImage),
    canonicalUrl: article.canonical_url || null,
    theme,
    footerText,
    customHead,
    canvasClass: "canvas article-canvas",
    // Reachable here only via preview mode's cookie or a one-off
    // ?preview=1/preview-token link — a draft or expired article being
    // previewed is never something to let a search engine index, even if
    // the link leaks.
    noindex: !!previewReason,
    editUrl: isAdmin ? `/admin/?edit=article:${article.id}` : null,
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

async function renderProject(env, project, navItems, previewReason = null, isAdmin = false) {
  const description = project.summary || excerpt(project.body) || project.title;
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);

  const linkButtons = ["github", "demo", "docs", "download"]
    .filter((key) => project.links && project.links[key])
    // First link is the primary call to action; the rest are outlined so a
    // project with a repo, demo and docs doesn't show three equal-weight
    // filled buttons competing with each other.
    .map(
      (key, i) =>
        `<a class="btn${i ? " btn-secondary" : ""}" href="${esc(safeHref(project.links[key]))}" target="_blank" rel="noopener">${esc(
          key[0].toUpperCase() + key.slice(1)
        )}<span class="btn-external-icon" aria-hidden="true">↗</span></a>`
    )
    .join("");
  const techStackHtml = project.tech_stack && project.tech_stack.length
    ? // Built-with chips were identical to topic tags (same class, same
      // look), so a reader couldn't tell "JavaScript" the technology from
      // "web" the topic. Labelled, and styled as plain outlined chips.
      `<div class="tech-stack"><span class="tech-stack-label">Built with</span>${project.tech_stack
        .map((t) => `<span class="tech-chip">${esc(t)}</span>`)
        .join("")}</div>`
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
  const heroVideoHtml = renderHeroVideoHtml(project.hero_video, project.og_image);
  const wasUpdated = project.updated_at && project.published_at && new Date(project.updated_at) - new Date(project.published_at) > 24 * 3600 * 1000;
  // Build journals can add a lot of reading beyond the project body itself
  // (that's the whole point of a "long project page") — same reasoning
  // articles already use, just summed across both sources.
  const mins = readingTime(`${project.body}\n${journalEntries.map((j) => j.body).join("\n")}`);

  const [allPublishedArticles, relatedSims, relatedScanRows] = await Promise.all([
    project.related_articles.length ? listArticles(env, { publishedOnly: true }) : [],
    Promise.all(project.related_simulations.map((id) => getPublishedSimulation(env, id))),
    Promise.all(project.related_scans.map((id) => getScan(env, id))),
  ]);
  const relatedArticleRows = allPublishedArticles.filter((a) => project.related_articles.includes(a.id));
  const relatedMediaHtml = renderRelatedMediaHtml(relatedArticleRows, relatedSims.filter(Boolean), relatedScanRows.filter(Boolean));
  const relatedSongRows = await getSongsByIds(env, project.related_songs || []);
  const relatedSongsHtml = renderRelatedSongsHtml(relatedSongRows);

  // Normal document flow (see .article-canvas in style.css), same fix and
  // reasoning as renderArticle just above — a project page has even more
  // variable-length optional sections (BOM, journal entries, downloads)
  // than an article does, all of which could overlap under the old fixed
  // grid-row-span scheme.
  const breadcrumbHtml = renderBreadcrumbHtml([
    { name: "Home", path: "/" },
    { name: "Projects", path: "/projects" },
    { name: project.title, path: `/projects/${project.slug}` },
  ]);
  const bodyHtml = `${renderPreviewBannerHtml(previewReason)}
  ${breadcrumbHtml}
  <div class="block page-header">
    <div class="article-meta">
      ${project.status ? `<span class="status-badge">${esc(project.status)}</span>` : ""}
      <time datetime="${esc(project.published_at)}">${esc(displayDate(project.published_at))}</time>
      ${wasUpdated ? `<span class="article-meta-sep">·</span><span>Updated <time datetime="${esc(project.updated_at)}">${esc(displayDate(project.updated_at))}</time></span>` : ""}
      <span class="article-meta-sep">·</span>
      <span>${mins} min read</span>
    </div>
    <h1>${esc(project.title)}</h1>
    ${project.summary ? `<p class="page-lede">${esc(project.summary)}</p>` : ""}
    ${linkButtons ? `<div class="project-link-buttons">${linkButtons}</div>` : ""}
    ${techStackHtml}
    ${renderTags(project.tags)}
    <div class="article-actions">${renderShareLinks(project.title, `/projects/${project.slug}`)}</div>
    ${project.og_image && !heroVideoHtml ? `<img class="article-cover" src="${esc(project.og_image)}" alt="" loading="eager" fetchpriority="high"${await coverSizeAttrs(env, project.og_image)}>` : ""}
  </div>
  ${heroVideoHtml ? `<div class="block">${heroVideoHtml}</div>` : ""}
  <div class="block">${ttsBarHtml}</div>
  ${correctionNoteHtml ? `<div class="block">${correctionNoteHtml}</div>` : ""}
  <div class="block">
    <div id="readable-content">${paragraphsHtml(project.body)}</div>
  </div>
  <div class="block">${reactionsHtml}</div>
  ${downloadsHtml ? `<div class="block">${downloadsHtml}</div>` : ""}
  ${bomHtml ? `<div class="block">${bomHtml}</div>` : ""}
  ${journalHtml ? `<div class="block">${journalHtml}</div>` : ""}
  ${relatedSongsHtml ? `<div class="block">${relatedSongsHtml}</div>` : ""}
  ${relatedMediaHtml ? `<div class="block">${relatedMediaHtml}</div>` : ""}
  ${relatedHtml ? `<div class="block">${relatedHtml}</div>` : ""}`;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: project.title,
      description,
      url: `https://dominickdominick.com/projects/${project.slug}`,
      ...(project.og_image || defaultOgImage ? { image: [absoluteUrl(project.og_image || defaultOgImage)] } : {}),
      dateCreated: toIso8601(project.created_at),
      ...(project.published_at ? { datePublished: toIso8601(project.published_at) } : {}),
      dateModified: toIso8601(project.updated_at),
      author: SITE_AUTHOR,
      mainEntityOfPage: `https://dominickdominick.com/projects/${project.slug}`,
      inLanguage: "en",
      ...(project.tags && project.tags.length ? { keywords: project.tags.join(", ") } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://dominickdominick.com/" },
        { "@type": "ListItem", position: 2, name: "Projects", item: "https://dominickdominick.com/projects" },
        { "@type": "ListItem", position: 3, name: project.title, item: `https://dominickdominick.com/projects/${project.slug}` },
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
    jsonLd: withCustomJsonLd(jsonLd, project.custom_json_ld),
    ogType: "article",
    publishedTime: toIso8601(project.published_at),
    modifiedTime: toIso8601(project.updated_at),
    keywords: project.tags && project.tags.length ? project.tags.join(", ") : null,
    ogImage: project.og_image || defaultOgImage || null,
    ogImageSize: await coverSizeAttrs(env, project.og_image || defaultOgImage),
    canonicalUrl: project.canonical_url || null,
    theme,
    footerText,
    customHead,
    canvasClass: "canvas article-canvas",
    noindex: !!previewReason,
    editUrl: isAdmin ? `/admin/?edit=project:${project.id}` : null,
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

async function renderSearch(env, query, navItems, ctx, { type = "", sort = "newest", page = 1 } = {}) {
  const { defaultOgImage, theme, footerText, customHead, emptySearchText } = await getSiteContext(env);
  const { pages, articles, projects, totalCount } = query
    ? await publicSearch(env, query, { type, sort, page })
    : { pages: [], articles: [], projects: [], totalCount: null };
  if (query) {
    const count = pages.length + articles.length + projects.length;
    ctx.waitUntil(logEvent(env, { name: "search", path: "/search", detail: JSON.stringify({ q: query, count }) }).catch(() => {}));
  }
  const totalPages = totalCount != null ? Math.max(1, Math.ceil(totalCount / SEARCH_PAGE_SIZE)) : null;
  const resultsHtml = renderSearchResultsHtml(query, pages, articles, projects, emptySearchText, { type, sort, page, totalPages, totalCount });
  // Flow layout, not a fixed grid-row span — a page of 10+ results (or a
  // second page's worth) can be taller than any span picked ahead of
  // time, and a fixed span let real content overflow into (and get
  // covered by) the footer. Same fix as article/project pages already
  // use, for the same reason.
  const bodyHtml = `<div class="block">
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
    canvasClass: "canvas article-canvas",
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

async function renderTopicsIndex(env, navItems) {
  const { defaultOgImage, theme, footerText, customHead, emptyTopicsText } = await getSiteContext(env);
  const tagCounts = await getTagCounts(env);
  const bodyHtml = `<div class="block">
    <h1>Topics</h1>
    <p>Everything tagged, across posts and projects.</p>
    ${renderTopicsIndexHtml(tagCounts, emptyTopicsText)}
  </div>`;
  const html = renderShell({
    title: "Topics · Dominick",
    description: "Browse everything on dominickdominick.com by topic.",
    path: "/topics",
    navItems,
    activeSlug: "topics",
    bodyHtml,
    ogImage: defaultOgImage || null,
    theme,
    footerText,
    customHead,
    canvasClass: "canvas article-canvas",
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

async function renderArchive(env, navItems) {
  const { defaultOgImage, theme, footerText, customHead, emptyArchiveText } = await getSiteContext(env);
  const archive = await getArchive(env);
  const bodyHtml = `<div class="block">
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
    canvasClass: "canvas article-canvas",
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

// A dedicated, paginated articles index at /random — previously the only
// real link target for the article breadcrumb/nav/RSS was /archive, which
// mixes in projects and pages and has no pagination at all.
async function renderArticlesIndex(env, navItems, page) {
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);
  const { articles, totalCount } = await listArticlesPaged(env, { page });
  const totalPages = Math.max(1, Math.ceil(totalCount / INDEX_PAGE_SIZE));
  const bodyHtml = `<div class="block">
    <header class="index-header"><h1>Articles</h1>${totalCount ? `<p class="index-count">${totalCount} ${totalCount === 1 ? "post" : "posts"}</p>` : ""}</header>
    ${renderArticlesIndexHtml(articles)}
    ${renderIndexPaginationHtml("/random", page, totalPages)}
  </div>`;
  const html = renderShell({
    title: page > 1 ? `Articles · Page ${page} · Dominick` : "Articles · Dominick",
    description: "Every article published on dominickdominick.com, newest first.",
    path: "/random",
    navItems,
    activeSlug: "random",
    bodyHtml,
    jsonLd: indexJsonLd("Articles", "/random", articles.map((x) => ({ name: x.title, url: `https://dominickdominick.com/random/${x.slug}` }))),
    ogImage: defaultOgImage || null,
    theme,
    footerText,
    customHead,
    // A page-2-and-beyond URL is a real, working page (not a thin/empty
    // one), but it's just a slice of the same content the page-1 URL
    // already covers — same reasoning as the topic/search noindex calls
    // elsewhere, just for pagination instead of an empty filter result.
    noindex: page > 1,
    canvasClass: "canvas article-canvas index-canvas",
  });
  return new Response(html, { status: page > totalPages && totalCount > 0 ? 404 : 200, headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

// Same as renderArticlesIndex, for /projects.
async function renderProjectsIndex(env, navItems, page) {
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);
  const { projects, totalCount } = await listProjectsPaged(env, { page });
  const totalPages = Math.max(1, Math.ceil(totalCount / INDEX_PAGE_SIZE));
  const bodyHtml = `<div class="block">
    <header class="index-header"><h1>Projects</h1>${totalCount ? `<p class="index-count">${totalCount} ${totalCount === 1 ? "project" : "projects"}</p>` : ""}</header>
    ${renderProjectsIndexHtml(projects)}
    ${renderIndexPaginationHtml("/projects", page, totalPages)}
  </div>`;
  const html = renderShell({
    title: page > 1 ? `Projects · Page ${page} · Dominick` : "Projects · Dominick",
    description: "Every project on dominickdominick.com, newest first.",
    path: "/projects",
    navItems,
    activeSlug: "projects",
    bodyHtml,
    jsonLd: indexJsonLd("Projects", "/projects", projects.map((x) => ({ name: x.title, url: `https://dominickdominick.com/projects/${x.slug}` }))),
    ogImage: defaultOgImage || null,
    theme,
    footerText,
    customHead,
    noindex: page > 1,
    canvasClass: "canvas article-canvas index-canvas",
  });
  return new Response(html, { status: page > totalPages && totalCount > 0 ? 404 : 200, headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

// Reading history lives entirely in the visitor's own browser (localStorage,
// written by nav.js as they view articles/projects) — never sent to or
// stored on the server, so this route just ships the empty shell and lets
// client-side JS fill it in from whatever's already in that browser.
async function renderHistoryPage(env, navItems) {
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);
  const bodyHtml = `<div class="block">
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
    canvasClass: "canvas article-canvas",
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

// Same client-only pattern as reading history — bookmarks live in the
// visitor's own localStorage, this route just ships the empty shell.
async function renderSavedPage(env, navItems) {
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);
  const bodyHtml = `<div class="block">
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
    canvasClass: "canvas article-canvas",
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

async function renderTopicPage(env, tag, navItems) {
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);
  const [{ articles, projects }, topicMeta] = await Promise.all([getContentByTag(env, tag), getTopicMeta(env, tag)]);
  const isEmpty = articles.length + projects.length === 0;
  const bodyHtml = `<div class="block">
    <h1>Tagged: ${esc(tag)}</h1>
    ${topicMeta?.description ? `<p class="topic-intro">${esc(topicMeta.description)}</p>` : ""}
    ${renderTopicPageHtml(tag, articles, projects)}
  </div>`;
  const html = renderShell({
    title: `${tag} · Topics · Dominick`,
    description: topicMeta?.description || `Posts and projects tagged "${tag}" on dominickdominick.com.`,
    path: `/topics/${encodeURIComponent(tag)}`,
    navItems,
    activeSlug: "topics",
    bodyHtml,
    ogImage: topicMeta?.og_image || defaultOgImage || null,
    theme,
    footerText,
    customHead,
    // An arbitrary URL segment with nothing tagged under it is a thin,
    // unbounded set of URLs (every possible string 404s to this same
    // "Nothing tagged…" page) — never worth indexing, unlike a topic that
    // actually has content.
    noindex: isEmpty,
    canvasClass: "canvas article-canvas",
  });
  return new Response(html, { status: isEmpty ? 404 : 200, headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

async function renderNotFound(env, navItems) {
  const [{ defaultOgImage, theme, footerText, customHead }, recentArticles] = await Promise.all([
    getSiteContext(env),
    listArticles(env, { publishedOnly: true, limit: 5 }),
  ]);
  const bodyHtml = `<div class="block">
    ${renderNotFoundHtml(navItems, recentArticles)}
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
    canvasClass: "canvas article-canvas",
  });
  return new Response(html, { status: 404, headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

// A standalone, read-only view of a saved circuit — the same rendering and
// power-toggle interactivity as the "Simulation" block, just on its own
// page so a circuit can be linked to directly instead of only embedded.
function simulationTopologyDescription(data) {
  const components = Array.isArray(data?.components) ? data.components : [];
  // Only meter readings need the analysis, so circuits without a voltmeter skip it.
  let analysis = {};
  if (components.some((component) => component?.type === "voltmeter")) {
    try {
      analysis = computeCircuitAnalysis(data);
    } catch {
      // The summary is best-effort; a malformed circuit just loses its meter readings.
    }
  }
  const wires = Array.isArray(data?.wires) ? data.wires : [];
  const componentsById = new Map(
    components
      .filter((component) => component && component.id != null)
      .map((component) => [String(component.id), component])
  );
  const shortValue = (value, limit = 60) => {
    if (typeof value !== "string" && typeof value !== "number") return "";
    return String(value).slice(0, limit);
  };
  const componentDetails = (component) => {
    const value = (raw, fallback) => {
      const number = Number(raw);
      return Number.isFinite(number) && number !== 0 ? number : fallback;
    };
    switch (component?.type) {
      case "outlet":
        return `${OUTLET_VOLTAGE}-volt AC source`;
      case "power_supply":
        return `${value(component.outputVoltage, 5)}-volt DC output`;
      case "battery":
        return `${value(component.voltage, 9)}-volt battery`;
      case "resistor":
        return `${Math.max(1, Math.round(Number(component.resistance) || 220))} ohms`;
      case "potentiometer": {
        const maxResistance = Math.max(1, Number(component.maxResistance) || 10000);
        const rawWiper = Number(component.wiper);
        const wiper = Math.max(0, Math.min(100, Number.isFinite(rawWiper) ? rawWiper : 50));
        return `${Math.max(1, Math.round(maxResistance * (wiper / 100)))} ohms at ${wiper}%`;
      }
      case "logic_gate": {
        const gate = resolveLogicGate(component);
        const info = LOGIC_GATES[gate];
        const custom = logicGateIsCustom(component);
        return custom
          ? `custom ${info.inputs}-input gate based on ${info.label}; with input${info.inputs === 2 ? "s A,B" : " A"}, ${logicGateRows(gate)
              .map((bits, i) => `${bits.join("")} gives ${logicGateTruth(component)[i]}`)
              .join(", ")}`
          : `${info.label} gate`;
      }
      case "capacitor":
        return `${formatCapacitance(capacitanceMicrofarads(component))} (blocks DC)`;
      case "inductor": {
        const windingOhms = Number(inductorWindingOhms(component).toFixed(2));
        return `${formatInductance(inductanceMillihenries(component))}, ${windingOhms} ${windingOhms === 1 ? "ohm" : "ohms"} winding resistance`;
      }
      case "breadboard":
        return `${getSimulationComponentDefinition(component)?.cols || 30} columns`;
      case "led": {
        const color = LED_COLORS[component.color]?.onColor ? component.color : "red";
        return `${color} LED`;
      }
      case "switch":
        return component.closed === false ? "open switch" : "closed switch";
      case "voltmeter": {
        const reading = analysis[component.id];
        if (!reading || typeof reading.volts !== "number") return "voltage meter with no reading";
        const text = formatVolts(reading.volts);
        return `voltage meter reading ${text.startsWith("-") ? "negative " + text.slice(1) : text}`.replace(/V$/, " volts");
      }
      case "switch_spdt":
        return `common terminal connected to throw ${component.position === "b" ? "B" : "A"}`;
      default:
        return "";
    }
  };
  const describeComponent = (component) => {
    const label = getSimulationComponentDefinition(component)?.label || "Circuit component";
    const customLabel = shortValue(component?.label);
    const id = shortValue(component?.id);
    const identity = customLabel ? ` labeled ${customLabel}` : id ? ` (ID ${id})` : "";
    const details = componentDetails(component);
    return `${label}${identity}${details ? `, ${details}` : ""}`;
  };
  const describeEndpoint = (endpoint) => {
    const component = componentsById.get(String(endpoint?.compId));
    if (!component) return "an unidentified component pin";
    const pinLabel = getSimulationComponentDefinition(component)?.pins?.find((pin) => pin.id === endpoint?.pin)?.label;
    return pinLabel ? `${describeComponent(component)}, ${pinLabel.charAt(0).toLowerCase()}${pinLabel.slice(1)} pin` : `${describeComponent(component)} pin ${shortValue(endpoint?.pin) || "unknown"}`;
  };
  const componentSummary = components.slice(0, 20).map(describeComponent);
  const wireSummary = wires.slice(0, 30).map((wire) => `${describeEndpoint(wire?.from)} connects to ${describeEndpoint(wire?.to)}`);
  const omittedComponents = components.length - componentSummary.length;
  const omittedWires = wires.length - wireSummary.length;
  const componentsText = componentSummary.length ? componentSummary.join(", ") : "none";
  const wiresText = wireSummary.length ? wireSummary.join("; ") : "none";
  return `Circuit topology. ${components.length} components: ${componentsText}${omittedComponents > 0 ? `; and ${omittedComponents} more` : ""}. ${wires.length} wire connections: ${wiresText}${omittedWires > 0 ? `; and ${omittedWires} more` : ""}.`;
}

async function renderSimulationPage(env, sim, navItems) {
  const { defaultOgImage, theme, footerText, customHead } = await getSiteContext(env);
  const uid = "sim-standalone";
  const descId = `${uid}-desc`;
  const svg = renderSimulationSvg(sim.data).replace(
    'class="sim-svg"',
    `class="sim-svg" id="${esc(uid)}" role="img" aria-label="${esc(sim.name || "Circuit simulation")}" aria-describedby="${esc(descId)}"`
  );
  const topologyDescription = simulationTopologyDescription(sim.data);
  const bodyHtml = `<div class="block" style="grid-column:1 / span 24;grid-row:1 / span 2;">
    <h1>${esc(sim.name)}</h1>
  </div>
  <div class="block" style="grid-column:1 / span 24;grid-row:3 / span 25;">
    <div class="sim-block-wrap"><p id="${esc(descId)}" class="sr-only">${esc(topologyDescription)}</p>${svg}<button type="button" class="sim-power-btn" data-target="${esc(uid)}">Power on</button></div>
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
    ogImage: (sim.data && sim.data.og_image) || defaultOgImage || null,
  });
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

function xmlEsc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// D1's datetime('now') columns come back as "YYYY-MM-DD HH:MM:SS" (space-
// separated, no timezone, implicitly UTC) — not valid ISO 8601, which the
// Open Graph article:published_time/modified_time meta tags and schema.org
// Date/DateTime properties both expect. Used everywhere one of those raw
// column values goes into structured data or a meta tag.
//
// published_at specifically isn't always in that raw D1 format, though —
// admin-api.js's "publish now" path stores `new Date().toISOString()`
// directly (already valid ISO 8601), so this has to accept either shape
// rather than assume the D1-only one and mangle an already-valid string.
function toIso8601(dbDateString) {
  if (!dbDateString) return null;
  let d = new Date(dbDateString);
  if (isNaN(d.getTime())) {
    d = new Date(dbDateString.replace(" ", "T") + "Z");
  }
  return isNaN(d.getTime()) ? null : d.toISOString();
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
  const titleSuffix = [type ? (type === "project" ? "Projects" : "Articles") : null, tag ? `"${xmlEsc(tag)}"` : null].filter(Boolean).join(" — ");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Dominick${titleSuffix ? " — " + titleSuffix : ""}</title>
  <link>https://dominickdominick.com/archive</link>
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
  const publishedSimulationIds = await listPublishedSimulationIds(env);
  const tagCounts = await getTagCounts(env);
  const entries = [
    // isInSitemap() is shared with getSeoReport()'s sitemapCanonicalMismatch
    // check, so the two can't independently drift on what "excluded from
    // the sitemap" means the way they briefly did (a password-protected
    // page was correctly excluded here but not recognized as excluded
    // there, producing a false-positive "still in sitemap.xml" finding).
    ...pages
      .filter((p) => isInSitemap(p, "page") && !RESERVED_SLUGS.has(p.slug))
      .map((p) => ({ loc: p.slug === "home" ? "/" : `/${p.slug}`, lastmod: p.updated_at })),
    ...articles.filter((a) => isInSitemap(a, "article")).map((a) => ({ loc: `/random/${a.slug}`, lastmod: a.updated_at || a.published_at })),
    ...projects.filter((p) => isInSitemap(p, "project")).map((p) => ({ loc: `/projects/${p.slug}`, lastmod: p.updated_at || p.published_at })),
    ...publishedSimulationIds.map((id) => ({ loc: `/simulation/${id}`, lastmod: null })),
    { loc: "/topics", lastmod: null },
    { loc: "/archive", lastmod: null },
    { loc: "/random", lastmod: null },
    { loc: "/projects", lastmod: null },
    ...tagCounts.map((t) => ({ loc: `/topics/${encodeURIComponent(t.tag)}`, lastmod: null })),
  ];
  // Each URL once -- /projects and /random were listed twice (as a page
  // and as a built-in index), which search engines treat as noise.
  const seenLocs = new Set();
  const uniqueEntries = entries.filter((e) => !seenLocs.has(e.loc) && seenLocs.add(e.loc));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${uniqueEntries
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

// A public JSON body as a plain object (anything else reads as {}).
async function readPublicJsonBody(request) {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}

// A named event from the public site (copy-link click, theme toggle, a
// simulation's power button, etc.) — not tied to a visitor/session id, so
// it can only answer "how often", not "how many people".
async function handleTrackEvent(request, env, ctx) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const allowed = await checkRateLimit(env, "track", ip, { windowMinutes: 1, maxAttempts: 30 });
  if (!allowed) return new Response(null, { status: 429 });
  await recordRateLimitHit(env, "track", ip);
  const body = await readPublicJsonBody(request);
  // Public, unauthenticated input stored in D1 -- capped so a script can't
  // fill the events table with arbitrarily large strings.
  const clip = (v, max) => (v == null || v === "" ? null : String(v).slice(0, max));
  const name = String(body.name || "").trim().slice(0, 64);
  if (!name) return new Response(null, { status: 400 });
  ctx.waitUntil(logEvent(env, { name, path: clip(body.path, 300), detail: clip(body.detail, 500) }).catch(() => {}));
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
  const body = await readPublicJsonBody(request);
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
  // The session cookie is already Secure-only; this closes the remaining
  // window where a first visit over plain http:// could be intercepted
  // before the redirect to https:// happens.
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    // jsdelivr is <model-viewer> (for the 3D Scan block) — it's an ES
    // module and, for compressed models, loads its own decoder via a Web
    // Worker + WASM fetched from the same origin as the script itself,
    // hence the matching allowances on worker-src/connect-src too.
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
    // jsdelivr here too — KaTeX (for ```math blocks) loads its stylesheet
    // and glyph fonts from the same jsdelivr build as its JS module, which
    // script-src above already trusts.
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
    "img-src 'self' data: https:",
    "font-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net data:",
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
    // Same daily cron also drives the scheduled Link Checker — an admin
    // otherwise only finds out a link went dead by opening the SEO
    // Dashboard and clicking "Check links" themselves.
    ctx.waitUntil(
      runScheduledLinkCheck(env).catch((err) => logError(env, { message: err.message, stack: err.stack, path: "scheduled:link-check" }))
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

    if (!isMaintenanceExempt(path) && (await getSetting(env, "maintenance_mode")) === "1" && !(await isAuthenticated(request, env))) {
      const message = (await getSetting(env, "maintenance_message")) || "We'll be back shortly.";
      return new Response(renderMaintenanceHtml(message), {
        status: 503,
        headers: { "Content-Type": "text/html;charset=UTF-8", "Retry-After": "3600" },
      });
    }

    // /page-access/:slug — verifies a password-protected page's password
    // and, on success, sets that page's own unlock cookie before redirecting
    // right back to it (303, so a refresh never resubmits the form).
    const pageAccessMatch = path.match(/^\/page-access\/([a-z0-9-]+)$/);
    if (pageAccessMatch && request.method === "POST") {
      const slug = pageAccessMatch[1];
      const page = await getPageBySlug(env, slug);
      const backTo = `${url.origin}/${slug === "home" ? "" : slug}`;
      if (!page || !page.password_hash) return Response.redirect(backTo, 303);
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const allowed = await checkRateLimit(env, "page-access", ip, { windowMinutes: 15, maxAttempts: 8 });
      if (!allowed) return new Response("Too many attempts. Try again later.", { status: 429 });
      ctx.waitUntil(recordRateLimitHit(env, "page-access", ip).catch(() => {}));
      const form = await request.formData().catch(() => null);
      const candidate = form?.get("password") || "";
      const candidateHash = candidate ? await hmac(env.SESSION_SECRET, `page-password:${candidate}`) : "";
      if (!candidate || !timingSafeEqual(candidateHash, page.password_hash)) {
        return Response.redirect(`${backTo}?error=1`, 303);
      }
      const token = await pageAccessToken(env, page);
      const headers = new Headers({ Location: backTo });
      headers.append("Set-Cookie", `page_pw_${page.id}=${token}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax; HttpOnly; Secure`);
      return new Response(null, { status: 303, headers });
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
      const rawType = url.searchParams.get("type") || "";
      const type = ["page", "article", "project"].includes(rawType) ? rawType : "";
      const sort = url.searchParams.get("sort") === "oldest" ? "oldest" : "newest";
      const rawPage = Math.floor(Number(url.searchParams.get("page")));
      const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 10000) : 1;
      return renderSearch(env, url.searchParams.get("q")?.trim() || "", navItems, ctx, { type, sort, page });
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
      let tag;
      try {
        tag = decodeURIComponent(topicMatch[1]);
      } catch {
        tag = topicMatch[1];
      }
      return renderTopicPage(env, tag, navItems);
    }

    if (path === "/archive") {
      const navItems = await listNavPages(env);
      return renderArchive(env, navItems);
    }

    if (path === "/random") {
      const navItems = await listNavPages(env);
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
      return renderArticlesIndex(env, navItems, page);
    }

    if (path === "/projects") {
      const navItems = await listNavPages(env);
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
      return renderProjectsIndex(env, navItems, page);
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
      const sim = await getPublishedSimulation(env, Number(simulationMatch[1]));
      if (!sim) {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) return assetResponse;
        return renderNotFound(env, await listNavPages(env));
      }
      const navItems = await listNavPages(env);
      return renderSimulationPage(env, sim, navItems);
    }

    // Scoped to "uploads/", "scans/", "audio/", "video/", and "fonts/"
    // specifically — the same R2 bucket also holds scheduled backups under
    // "backups/", which must never be servable through this public route.
    const mediaMatch = path.match(/^\/media\/((?:uploads|scans|audio|video|fonts)\/[A-Za-z0-9_.\-\/]+)$/);
    if (mediaMatch) {
      // Only "uploads/" keys have a row in the `media` table at all (scans/
      // audio/video/fonts are managed by their own tables and were never
      // marked private-capable), so this lookup only ever gates that one
      // prefix -- a miss for any other prefix just means "not private,"
      // preserving today's always-public behavior for those file kinds.
      let isPrivateFile = false;
      if (mediaMatch[1].startsWith("uploads/")) {
        const meta = await env.DB.prepare("SELECT private FROM media WHERE key = ?").bind(mediaMatch[1]).first();
        isPrivateFile = !!(meta && meta.private);
        if (isPrivateFile && !(await isAuthenticated(request, env))) {
          return new Response("Not found", { status: 404 });
        }
      }
      const obj = await env.MEDIA.get(mediaMatch[1]);
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      // A private file is never cached by any shared cache (a CDN/proxy
      // in front of this worker, or a browser sharing a machine) and
      // never persisted client-side either -- otherwise a copy fetched
      // while the file was still public (or a copy fetched by the admin,
      // who can always see it) could keep being served to a DIFFERENT,
      // unauthenticated visitor for up to the cache lifetime after the
      // file is marked private, defeating the point of the flag. Public
      // files keep the existing short + revalidate behavior: the photo
      // editor can overwrite a file in place at the same URL, and a
      // year-long immutable cache would hide that change from readers.
      headers.set("Cache-Control", isPrivateFile ? "private, no-store" : "public, max-age=300, must-revalidate");
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

    // Browsers probe /favicon.ico directly regardless of the <link
    // rel="icon"> data-URI already in the page head — without this, every
    // single page load logs a 404 for it.
    if (path === "/favicon.ico") {
      return new Response(faviconSvg(await getTheme(env)), { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
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
      const previewModeCookie = hasPreviewModeCookie(request);
      const isAdminPreview =
        (url.searchParams.get("preview") === "1" || previewModeCookie) && (await isAuthenticated(request, env));
      const previewToken = url.searchParams.get("preview_token");
      // Same rate-limit posture as /page-access below — a preview token is
      // 128-bit random hex, so brute force is impractical regardless, but
      // every other unauthenticated guess-a-secret endpoint in this app is
      // rate-limited and this one wasn't, purely by oversight.
      const previewIp = request.headers.get("CF-Connecting-IP") || "unknown";
      const previewAllowed =
        !previewToken || (await checkRateLimit(env, "preview-link", previewIp, { windowMinutes: 15, maxAttempts: 20 }));
      if (previewToken) ctx.waitUntil(recordRateLimitHit(env, "preview-link", previewIp).catch(() => {}));
      const isSharedPreview =
        article && previewToken && previewAllowed && (await getValidPreviewLink(env, "article", article.id, previewToken));
      const isPreview = isAdminPreview || isSharedPreview;
      if (!article || (!isPublished && !isPreview)) {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) return assetResponse;
        return renderNotFound(env, await listNavPages(env));
      }
      const navItems = await listNavPages(env);
      if (isPublished) trackView(ctx, env, request, path);
      const isAdmin = isAdminPreview || (await isAuthenticated(request, env));
      return renderArticle(
        env,
        article,
        navItems,
        !isPublished && isPreview ? (previewModeCookie && isAdminPreview ? "cookie" : "one-off") : null,
        isAdmin
      );
    }

    // Individual project page: /projects/:slug
    const projectMatch = path.match(/^\/projects\/([a-z0-9-]+)$/);
    if (projectMatch) {
      const project = await getProjectBySlug(env, projectMatch[1]);
      const now = new Date().toISOString();
      const isPublished = project && project.published_at && project.published_at <= now && (!project.expires_at || project.expires_at > now);
      const previewModeCookie = hasPreviewModeCookie(request);
      const isAdminPreview =
        (url.searchParams.get("preview") === "1" || previewModeCookie) && (await isAuthenticated(request, env));
      const previewToken = url.searchParams.get("preview_token");
      const previewIp = request.headers.get("CF-Connecting-IP") || "unknown";
      const previewAllowed =
        !previewToken || (await checkRateLimit(env, "preview-link", previewIp, { windowMinutes: 15, maxAttempts: 20 }));
      if (previewToken) ctx.waitUntil(recordRateLimitHit(env, "preview-link", previewIp).catch(() => {}));
      const isSharedPreview =
        project && previewToken && previewAllowed && (await getValidPreviewLink(env, "project", project.id, previewToken));
      const isPreview = isAdminPreview || isSharedPreview;
      if (!project || (!isPublished && !isPreview)) {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) return assetResponse;
        return renderNotFound(env, await listNavPages(env));
      }
      const navItems = await listNavPages(env);
      if (isPublished) trackView(ctx, env, request, path);
      const isAdmin = isAdminPreview || (await isAuthenticated(request, env));
      return renderProject(
        env,
        project,
        navItems,
        !isPublished && isPreview ? (previewModeCookie && isAdminPreview ? "cookie" : "one-off") : null,
        isAdmin
      );
    }

    const slug = path === "/" ? "home" : path.replace(/^\/+/, "").replace(/\/+$/, "");
    const page = await getPageBySlug(env, slug);
    if (page) {
      trackView(ctx, env, request, path);
      return renderPage(env, page, url, request);
    }

    // Fall through to static assets (style.css, nav.js, /admin app, images, etc.)
    // — but if that's also a miss, replace Cloudflare's bare 404 with a
    // branded one that helps a lost reader find their way back in.
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) return assetResponse;
    const navItems = await listNavPages(env);
    return renderNotFound(env, navItems);
}
