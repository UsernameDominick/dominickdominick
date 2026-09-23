import { listArticles, getSimulation } from "./db.js";
import { renderSimulationSvg } from "./simulation-render.js";

export function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Minimal markdown: **bold**, *italic*, [label](url). Runs on already-
// HTML-escaped text, so the only unescaped characters left are the ones
// this inserts itself — safe against breaking the surrounding markup.
function richText(escapedText) {
  return escapedText
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

// A paragraph starting with "## " or "### " renders as a heading instead
// — the only block-level markdown this renderer supports, added
// specifically so long articles can have a table of contents to link to.
function headingMatch(paragraph) {
  const m = paragraph.match(/^(#{2,3})\s+(.+)$/);
  return m ? { level: m[1].length, text: m[2].trim() } : null;
}

export function slugifyHeading(text) {
  return String(text ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Extracts {level, id, text} for every heading paragraph, for building a
// table of contents — the ids match exactly what paragraphsHtml() gives
// each rendered <h2>/<h3>, since both split on the same paragraphs.
export function extractHeadings(text) {
  const headings = [];
  const seen = new Map();
  String(text ?? "")
    .split(/\n{2,}/)
    .forEach((p) => {
      const h = headingMatch(p.trim());
      if (!h) return;
      let id = slugifyHeading(h.text) || "section";
      const n = seen.get(id) || 0;
      seen.set(id, n + 1);
      if (n > 0) id = `${id}-${n + 1}`;
      headings.push({ level: h.level, id, text: h.text });
    });
  return headings;
}

export function tableOfContentsHtml(headings) {
  if (!headings || headings.length < 2) return "";
  const items = headings
    .map((h) => `<li class="toc-item toc-level-${h.level}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`)
    .join("");
  return `<nav class="table-of-contents" aria-label="Table of contents"><strong>Contents</strong><ul>${items}</ul></nav>`;
}

export function paragraphsHtml(text) {
  const headings = extractHeadings(text);
  let hi = 0;
  return String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => {
      const h = headingMatch(p.trim());
      if (h) {
        const { id, level } = headings[hi++];
        return `<h${level} id="${esc(id)}">${richText(esc(h.text))}</h${level}>`;
      }
      return `<p>${richText(esc(p)).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

function stripMarkdown(text) {
  return String(text ?? "")
    .replace(/^#{2,3}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

// A rough, standard estimate (200 words/minute) — good enough to give a
// reader a sense of length, not meant to be precise to the second.
export function readingTime(text) {
  const flat = stripMarkdown(text).trim();
  const words = flat ? flat.split(/\s+/).length : 0;
  return Math.max(1, Math.round(words / 200));
}

export function excerpt(text, maxLen = 155) {
  const flat = stripMarkdown(text).replace(/\s+/g, " ").trim();
  if (flat.length <= maxLen) return flat;
  const cut = flat.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return cut.slice(0, lastSpace > 0 ? lastSpace : maxLen).trim() + "…";
}

export function renderSearchResultsHtml(query, pages, articles) {
  if (!query) {
    return `<p class="empty-hint">Enter a search term above to look through pages and posts.</p>`;
  }
  const total = pages.length + articles.length;
  if (!total) {
    return `<p class="empty-hint">No results for "${esc(query)}".</p>`;
  }
  const pageItems = pages
    .map(
      (p) =>
        `<li><a href="${p.slug === "home" ? "/" : "/" + esc(p.slug)}">${esc(p.title)}</a>${
          p.meta_description ? `<p>${esc(p.meta_description)}</p>` : ""
        }</li>`
    )
    .join("");
  const articleItems = articles
    .map(
      (a) =>
        `<li><a href="/random/${esc(a.slug)}">${esc(a.title)}</a><p>${esc(excerpt(a.body, 140))}</p></li>`
    )
    .join("");
  return `<p class="search-result-count">${total} result${total === 1 ? "" : "s"} for "${esc(query)}"</p>
${pageItems ? `<h2>Pages</h2><ul class="search-results">${pageItems}</ul>` : ""}
${articleItems ? `<h2>Posts</h2><ul class="search-results">${articleItems}</ul>` : ""}`;
}

export function renderRelatedArticlesHtml(articles) {
  if (!articles || !articles.length) return "";
  const items = articles
    .map(
      (a) =>
        `<article class="thought"><time datetime="${esc(a.published_at)}">${esc(
          (a.published_at || "").slice(0, 10)
        )}</time><h2><a href="/random/${esc(a.slug)}">${esc(a.title)}</a></h2>${renderTags(a.tags)}</article>`
    )
    .join("\n");
  return `<div class="related-posts"><strong>More to read</strong><div class="thought-list">${items}</div></div>`;
}

export function renderNotFoundHtml(navItems) {
  const links = navItems
    .map((n) => `<li><a href="${n.slug === "home" ? "/" : "/" + esc(n.slug)}">${esc(n.nav_label)}</a></li>`)
    .join("");
  return `<h1>Page not found</h1>
<p>Whatever you were looking for isn't here — it may have moved or never existed.</p>
${links ? `<p>Try one of these instead:</p><ul class="search-results">${links}</ul>` : ""}`;
}

export function renderTags(tags) {
  if (!tags || !tags.length) return "";
  return `<div class="tags">${tags
    .map((t) => `<a class="tag" href="/random?tag=${encodeURIComponent(t)}">${esc(t)}</a>`)
    .join("")}</div>`;
}

// Single-quoted font names: this string gets embedded both inside a <style>
// tag (fine either way) and inside an HTML style="..." attribute (where a
// double quote would prematurely close the attribute and corrupt the page).
export const FONT_STACKS = {
  sans: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif`,
  serif: `Georgia, 'Times New Roman', serif`,
  mono: `'Courier New', Courier, monospace`,
  rounded: `'Trebuchet MS', Verdana, sans-serif`,
};

// Turns a block's { color, bg, fontFamily, fontSize, borderRadius,
// borderColor, borderWidth } into a safe inline style string. Values are
// escaped/coerced rather than trusted verbatim, since they end up inside an
// HTML attribute.
function blockStyleAttr(style) {
  if (!style) return "";
  const parts = [];
  if (style.color) parts.push(`color:${esc(style.color)}`);
  if (style.bg) parts.push(`background:${esc(style.bg)}`);
  if (style.fontFamily && FONT_STACKS[style.fontFamily]) parts.push(`font-family:${FONT_STACKS[style.fontFamily]}`);
  const fontSize = Number(style.fontSize);
  if (Number.isFinite(fontSize) && fontSize > 0) parts.push(`font-size:${fontSize}px`);
  if (["left", "center", "right", "justify"].includes(style.textAlign)) parts.push(`text-align:${style.textAlign}`);
  const padding = Number(style.padding);
  if (Number.isFinite(padding) && padding >= 0) parts.push(`padding:${padding}px`);
  const opacity = Number(style.opacity);
  if (Number.isFinite(opacity) && opacity >= 0 && opacity <= 100) parts.push(`opacity:${opacity / 100}`);
  const borderRadius = Number(style.borderRadius);
  if (Number.isFinite(borderRadius) && borderRadius >= 0) parts.push(`border-radius:${borderRadius}px`);
  const borderWidth = Number(style.borderWidth);
  if (Number.isFinite(borderWidth) && borderWidth > 0) {
    parts.push(`border-width:${borderWidth}px`);
    parts.push(`border-style:solid`);
    parts.push(`border-color:${style.borderColor ? esc(style.borderColor) : "currentColor"}`);
  }
  if (style.backgroundImage) {
    parts.push(`background-image:url('${esc(style.backgroundImage)}')`);
    parts.push(`background-size:${["cover", "contain", "auto"].includes(style.backgroundSize) ? style.backgroundSize : "cover"}`);
    parts.push(`background-position:center`);
  }
  if (style.customCss && style.customCss.trim()) parts.push(esc(style.customCss.trim()));
  return parts.length ? parts.join(";") + ";" : "";
}

function headingLevel(c) {
  const lvl = Number(c.level);
  return Number.isInteger(lvl) && lvl >= 1 && lvl <= 6 ? lvl : 1;
}

// Turns a pasted YouTube/Vimeo link into a privacy-friendly embed URL, or
// null if the link isn't recognized (the caller falls back to a plain link).
function videoEmbedUrl(rawUrl) {
  if (!rawUrl) return null;
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtube.com") {
    const id = u.searchParams.get("v");
    if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
    const m = u.pathname.match(/^\/(shorts|embed)\/([\w-]+)/);
    if (m) return `https://www.youtube-nocookie.com/embed/${m[2]}`;
  }
  if (host === "youtu.be") {
    const id = u.pathname.slice(1);
    if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
  }
  if (host === "vimeo.com") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
  }
  return null;
}

async function renderBlockInner(env, block, ctx) {
  const c = block.content || {};
  switch (block.type) {
    case "heading": {
      const lvl = headingLevel(c);
      return `<h${lvl}>${esc(c.text)}</h${lvl}>`;
    }
    case "text":
      return paragraphsHtml(c.text);
    case "image":
      return `<img src="${esc(c.url)}" alt="${esc(c.alt)}" loading="lazy" style="max-width:100%;border-radius:12px;">`;
    case "button":
      return `<a class="btn" href="${esc(c.url)}"${c.external ? ' target="_blank" rel="noopener"' : ""}>${esc(c.label)}</a>`;
    case "divider":
      return `<hr>`;
    case "spacer":
      return "";
    case "links": {
      const items = Array.isArray(c.items) ? c.items.filter((it) => it && it.url) : [];
      if (!items.length) return `<p class="empty-hint">No links yet.</p>`;
      return `<ul class="block-links">${items
        .map((it) => `<li><a href="${esc(it.url)}"${/^https?:\/\//.test(it.url || "") ? ' target="_blank" rel="noopener"' : ""}>${esc(it.label || it.url)}</a></li>`)
        .join("")}</ul>`;
    }
    case "html":
      // Trusted admin-authored HTML, rendered as-is — this is the deliberate
      // "escape hatch" block type, same trust level as the customCss style field.
      return String(c.html || "");
    case "video": {
      const embed = videoEmbedUrl(c.url);
      if (!embed) return c.url ? `<p class="empty-hint">Unsupported video link — use a YouTube or Vimeo URL.</p>` : "";
      return `<div class="video-embed"><iframe src="${esc(
        embed
      )}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
    }
    case "quote":
      return `<blockquote class="block-quote">${paragraphsHtml(c.text)}${c.cite ? `<footer>${esc(c.cite)}</footer>` : ""}</blockquote>`;
    case "gallery": {
      const images = Array.isArray(c.images) ? c.images.filter(Boolean) : [];
      if (!images.length) return `<p class="empty-hint">No images yet.</p>`;
      return `<div class="gallery">${images.map((url) => `<img src="${esc(url)}" loading="lazy">`).join("")}</div>`;
    }
    case "simulation": {
      if (!c.simulation_id) return `<p class="empty-hint">No simulation selected.</p>`;
      const sim = await getSimulation(env, c.simulation_id);
      if (!sim) return `<p class="empty-hint">Simulation not found.</p>`;
      const uid = `sim-${block.id}`;
      const svg = renderSimulationSvg(sim.data).replace('class="sim-svg"', `class="sim-svg" id="${esc(uid)}"`);
      return `<div class="sim-block-wrap">${svg}<button type="button" class="sim-power-btn" data-target="${esc(
        uid
      )}">Power on</button></div>`;
    }
    case "project-card":
      return `<div class="project-card"><h2>${esc(c.title)}</h2>${c.description ? `<p>${esc(c.description)}</p>` : ""}${c.url ? `<a href="${esc(c.url)}"${c.external ? ' target="_blank" rel="noopener"' : ""}>${esc(c.label || c.url)}</a>` : ""}</div>`;
    case "article-list": {
      const articles = await listArticles(env, {
        publishedOnly: true,
        limit: c.limit || 10,
        tag: c.tag || (ctx && ctx.activeTagFilter) || null,
      });
      if (!articles.length) return `<p class="empty-hint">No posts yet.</p>`;
      return `<div class="thought-list">${articles
        .map(
          (a) =>
            `<article class="thought"><time datetime="${esc(a.published_at)}">${esc(
              (a.published_at || "").slice(0, 10)
            )}</time><h2><a href="/random/${esc(a.slug)}">${esc(a.title)}</a></h2>${renderTags(a.tags)}</article>`
        )
        .join("\n")}</div>`;
    }
    default:
      return "";
  }
}

export async function renderBlocks(env, blocks, ctx = {}) {
  const parts = await Promise.all(
    blocks
      .filter((b) => !(b.style && b.style.hidden))
      .map(async (b) => {
        const gridStyle = `grid-column:${b.col} / span ${b.col_span};grid-row:${b.row} / span ${b.row_span};`;
        return `<div class="block" style="${gridStyle}${blockStyleAttr(b.style)}">${await renderBlockInner(env, b, ctx)}</div>`;
      })
  );
  return parts.join("\n");
}

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%230b0b0c'/%3E%3Ctext x='50' y='68' font-family='Arial,sans-serif' font-size='60' font-weight='700' fill='%23e8a13a' text-anchor='middle'%3ED%3C/text%3E%3C/svg%3E";

export function renderShell({
  title,
  description,
  path,
  navItems,
  activeSlug,
  bodyHtml,
  jsonLd,
  ogType = "website",
  publishedTime = null,
  modifiedTime = null,
  keywords = null,
  ogImage = null,
  theme = {},
  footerText = null,
  customHead = null,
  noindex = false,
  searchQuery = null,
}) {
  const canonical = `https://dominickdominick.com${path}`;
  const themeVars = [];
  if (theme.accent) themeVars.push(`--accent:${esc(theme.accent)}`);
  if (theme.bg) themeVars.push(`--bg:${esc(theme.bg)}`);
  if (theme.font && FONT_STACKS[theme.font]) themeVars.push(`--font-family:${FONT_STACKS[theme.font]}`);
  const themeStyle = themeVars.length ? `<style>:root{${themeVars.join(";")};}</style>` : "";
  const navHtml = navItems
    .map(
      (n) =>
        `<a class="tab${n.slug === activeSlug ? " is-active" : ""}" href="${n.slug === "home" ? "/" : "/" + esc(n.slug)}"${
          n.slug === activeSlug ? ' aria-current="page"' : ""
        }>${esc(n.nav_label)}</a>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<script>(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="author" content="Dominick">
${keywords ? `<meta name="keywords" content="${esc(keywords)}">` : ""}
<meta name="theme-color" content="#0b0b0c">
${noindex ? `<meta name="robots" content="noindex">` : ""}
<link rel="canonical" href="${canonical}">
<link rel="icon" href="${FAVICON}">

<meta property="og:type" content="${esc(ogType)}">
<meta property="og:site_name" content="Dominick">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ""}
${publishedTime ? `<meta property="article:published_time" content="${esc(publishedTime)}">` : ""}
${modifiedTime ? `<meta property="article:modified_time" content="${esc(modifiedTime)}">` : ""}
<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}">` : ""}

<link rel="stylesheet" href="/style.css">
${themeStyle}
<script src="/sim-player.js" defer></script>
<script src="/article-extras.js" defer></script>
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ""}
${customHead || ""}
</head>
<body>
  <div class="page">
    <header class="topbar">
      <a class="brand" href="/">dominick<span class="accent">.</span>dominick</a>
      <nav class="tabs" aria-label="Sections">
        ${navHtml}
        <span class="tab-indicator" aria-hidden="true"></span>
      </nav>
      <div class="topbar-tools">
        <form class="site-search" action="/search" method="get" role="search">
          <input type="search" name="q" placeholder="Search" aria-label="Search" value="${esc(searchQuery || "")}">
        </form>
        <button type="button" id="theme-toggle" aria-label="Toggle light/dark theme">◐</button>
      </div>
    </header>
    <script src="/nav.js"></script>

    <main class="canvas">
      ${bodyHtml}
    </main>
    ${footerText ? `<footer class="site-footer">${paragraphsHtml(footerText)}</footer>` : ""}
  </div>
</body>
</html>`;
}
