import { listArticles, listProjects, getSimulation, getScan } from "./db.js";
import { renderSimulationSvg } from "./simulation-render.js";

export function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON.stringify() doesn't escape "</script>" — a value containing that
// substring (an article titled or quoting something with a closing script
// tag, entirely plausible on a programming blog) would prematurely end the
// <script> element and let the rest of its JSON leak into the page as raw
// HTML. Escaping "<" to its unicode escape is the standard fix (same one
// React/Next.js use) and is a no-op for valid JSON, which never needs a
// literal "<" outside of a string value.
function jsonLdScript(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// Minimal markdown: **bold**, *italic*, [label](url), plus [^label] footnote
// references (see extractFootnotes). Runs on already-HTML-escaped text, so
// the only unescaped characters left are the ones this inserts itself —
// safe against breaking the surrounding markup.
function richText(escapedText, footnoteNums) {
  let out = escapedText
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  if (footnoteNums && footnoteNums.size) {
    out = out.replace(/\[\^([^\]]+)\]/g, (m, label) => {
      const n = footnoteNums.get(label);
      return n ? `<sup id="fnref-${n}"><a href="#fn-${n}">${n}</a></sup>` : m;
    });
  }
  return out;
}

// Footnote definitions look like their own paragraph/line: "[^label]: text".
// Pulled out before the rest of the body is split into paragraphs so they
// never render as regular text, and collected into a Footnotes section
// appended at the end instead.
export function extractFootnotes(text) {
  const defs = new Map();
  const cleaned = String(text ?? "").replace(/^\[\^([^\]]+)\]:\s*(.+)$/gm, (m, label, def) => {
    defs.set(label, def.trim());
    return "";
  });
  return { cleaned, defs };
}

function footnoteNumbering(text, defs) {
  const nums = new Map();
  const re = /\[\^([^\]]+)\]/g;
  let m;
  let n = 0;
  while ((m = re.exec(text))) {
    if (defs.has(m[1]) && !nums.has(m[1])) nums.set(m[1], ++n);
  }
  return nums;
}

function footnotesHtml(nums, defs) {
  if (!nums.size) return "";
  const items = [...nums.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([label, n]) => `<li id="fn-${n}">${richText(esc(defs.get(label)))} <a href="#fnref-${n}" class="footnote-back">↩</a></li>`)
    .join("");
  return `<section class="footnotes"><hr><ol>${items}</ol></section>`;
}

// Fenced ```lang\ncode\n``` blocks are pulled out before paragraph
// splitting (same reason as footnotes) since code can itself contain blank
// lines, which would otherwise fragment it into multiple "paragraphs".
const CODE_PLACEHOLDER = /\u0000CODEBLOCK(\d+)\u0000/;

function extractCodeBlocks(text) {
  const blocks = [];
  const replaced = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const i = blocks.length;
    blocks.push({ lang, code: code.replace(/\n$/, "") });
    return `\u0000CODEBLOCK${i}\u0000`;
  });
  return { replaced, blocks };
}

// A GFM-lite pipe table: a header row, a "---" separator row, then data
// rows, all inside one blank-line-delimited paragraph.
function tableMatch(paragraph) {
  const lines = paragraph.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2 || !lines[0].includes("|")) return null;
  if (!/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(lines[1])) return null;
  const splitRow = (line) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  return { header: splitRow(lines[0]), rows: lines.slice(2).map(splitRow) };
}

function tableHtml({ header, rows }) {
  const thead = `<tr>${header.map((h) => `<th>${richText(esc(h))}</th>`).join("")}</tr>`;
  const tbody = rows.map((r) => `<tr>${r.map((c) => `<td>${richText(esc(c))}</td>`).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
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
  const { cleaned, defs } = extractFootnotes(text);
  const { replaced, blocks } = extractCodeBlocks(cleaned);
  const headings = extractHeadings(replaced);
  const footnoteNums = footnoteNumbering(replaced, defs);
  let hi = 0;
  const body = replaced
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => {
      const trimmed = p.trim();
      const codeMatch = trimmed.match(CODE_PLACEHOLDER);
      if (codeMatch) {
        const { lang, code } = blocks[Number(codeMatch[1])];
        return `<pre><code class="language-${esc(lang || "plaintext")}">${esc(code)}</code></pre>`;
      }
      const table = tableMatch(trimmed);
      if (table) return tableHtml(table);
      const h = headingMatch(trimmed);
      if (h) {
        const { id, level } = headings[hi++];
        return `<h${level} id="${esc(id)}">${richText(esc(h.text))}</h${level}>`;
      }
      return `<p>${richText(esc(p), footnoteNums).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
  return body + footnotesHtml(footnoteNums, defs);
}

function stripMarkdown(text) {
  return String(text ?? "")
    .replace(/```(\w*)\n([\s\S]*?)```/g, "$2")
    .replace(/^\[\^([^\]]+)\]:\s*.+$/gm, "")
    .replace(/\[\^([^\]]+)\]/g, "")
    .replace(/^#{2,3}\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
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

export function renderSearchResultsHtml(query, pages, articles, projects = []) {
  if (!query) {
    return `<p class="empty-hint">Enter a search term above to look through pages and posts.</p>`;
  }
  const total = pages.length + articles.length + projects.length;
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
  const projectItems = projects
    .map(
      (p) =>
        `<li><a href="/projects/${esc(p.slug)}">${esc(p.title)}</a>${
          p.summary ? `<p>${esc(p.summary)}</p>` : ""
        }</li>`
    )
    .join("");
  return `<p class="search-result-count">${total} result${total === 1 ? "" : "s"} for "${esc(query)}"</p>
${pageItems ? `<h2>Pages</h2><ul class="search-results">${pageItems}</ul>` : ""}
${projectItems ? `<h2>Projects</h2><ul class="search-results">${projectItems}</ul>` : ""}
${articleItems ? `<h2>Posts</h2><ul class="search-results">${articleItems}</ul>` : ""}`;
}

export function renderByline(article) {
  const names = ["Dominick", ...(article.co_authors || [])];
  return names.length > 1 ? `<span class="byline">By ${names.map(esc).join(" & ")}</span>` : "";
}

export function renderSeriesNavHtml(article, seriesArticles) {
  if (!article.series || !seriesArticles || seriesArticles.length < 2) return "";
  const idx = seriesArticles.findIndex((a) => a.id === article.id);
  if (idx === -1) return "";
  const prev = idx > 0 ? seriesArticles[idx - 1] : null;
  const next = idx < seriesArticles.length - 1 ? seriesArticles[idx + 1] : null;
  return `<div class="series-nav">
    <div class="series-nav-label">Part ${idx + 1} of ${seriesArticles.length} in <strong>${esc(article.series)}</strong></div>
    <div class="series-nav-links">
      ${prev ? `<a href="/random/${esc(prev.slug)}" class="series-prev">← ${esc(prev.title)}</a>` : "<span></span>"}
      ${next ? `<a href="/random/${esc(next.slug)}" class="series-next">${esc(next.title)} →</a>` : ""}
    </div>
  </div>`;
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

export function renderRelatedProjectsHtml(projects) {
  if (!projects || !projects.length) return "";
  const items = projects
    .map(
      (p) =>
        `<div class="project-card"><h2><a href="/projects/${esc(p.slug)}">${esc(p.title)}</a></h2>${
          p.summary ? `<p>${esc(p.summary)}</p>` : ""
        }${renderTags(p.tags)}</div>`
    )
    .join("\n");
  return `<div class="related-posts"><strong>Related projects</strong><div class="project-list">${items}</div></div>`;
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
  if (["multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "difference"].includes(style.blendMode)) {
    parts.push(`background-blend-mode:${style.blendMode}`);
  }
  if (["sticky", "fixed"].includes(style.position)) {
    parts.push(`position:${style.position}`);
    const offset = Number(style.stickyOffset);
    parts.push(`top:${Number.isFinite(offset) ? offset : 0}px`);
  }
  if (style.customCss && style.customCss.trim()) parts.push(esc(style.customCss.trim()));
  return parts.length ? parts.join(";") + ";" : "";
}

// #rrggbb + 0-100 -> "rgba(r,g,b,a)", or null if the hex isn't valid —
// used for the tint overlay over a background image/video, since CSS has
// no way to apply a translucent color on top of a <video> element other
// than a real stacked element.
function hexToRgba(hex, opacityPercent) {
  const h = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const pct = Number(opacityPercent);
  const a = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) / 100 : 0.5;
  return `rgba(${r},${g},${b},${a})`;
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

// A handful of common embeddable services get a proper embed URL; anything
// else falls back to a raw iframe (works for plenty of sites, does nothing
// useful for ones that forbid framing — hence the "open original" link
// alongside it either way).
function genericEmbedInfo(rawUrl) {
  if (!rawUrl) return null;
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  if (host === "codepen.io") {
    const m = u.pathname.match(/\/([^/]+)\/pen\/([^/]+)/);
    if (m) return { type: "iframe", src: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`, height: 400 };
  }
  if (host === "open.spotify.com") {
    const m = u.pathname.match(/^\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/);
    if (m) return { type: "iframe", src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: m[1] === "track" ? 152 : 352 };
  }
  if (host === "figma.com") {
    return { type: "iframe", src: `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(rawUrl)}`, height: 450 };
  }
  if (host === "codesandbox.io") {
    const m = u.pathname.match(/\/s\/([^/?]+)/);
    if (m) return { type: "iframe", src: `https://codesandbox.io/embed/${m[1]}`, height: 500 };
  }
  if (host === "gist.github.com") {
    const m = u.pathname.match(/^\/([^/]+)\/(\w+)/);
    if (m) return { type: "script", src: `https://gist.github.com/${m[1]}/${m[2]}.js` };
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  return { type: "iframe", src: rawUrl, height: 400 };
}

function genericEmbedHtml(rawUrl) {
  const info = genericEmbedInfo(rawUrl);
  if (!info) return rawUrl ? `<p class="empty-hint">Couldn't figure out how to embed that link.</p>` : `<p class="empty-hint">No embed URL yet.</p>`;
  if (info.type === "script") {
    return `<div class="generic-embed"><script src="${esc(info.src)}"></script></div>`;
  }
  return `<div class="generic-embed"><iframe src="${esc(info.src)}" loading="lazy" style="height:${info.height}px" allow="autoplay; encrypted-media; fullscreen; clipboard-write" allowfullscreen></iframe><p class="embed-fallback"><a href="${esc(
    rawUrl
  )}" target="_blank" rel="noopener">Open original ↗</a></p></div>`;
}

// A <model-viewer> element for an orbitable/zoomable 3D scan — GLB/GLTF,
// with the USDZ variant (if uploaded) letting iOS hand off to AR Quick Look
// via the built-in "ar" attribute. Exported so the future standalone
// /scan/:id page (mirroring /simulation/:id) can reuse it too.
export function modelViewerHtml(scan) {
  const attrs = [
    `src="${esc(`/media/${scan.glb_key}`)}"`,
    scan.usdz_key ? `ios-src="${esc(`/media/${scan.usdz_key}`)}"` : "",
    scan.poster_key ? `poster="${esc(scan.poster_key.startsWith("/") ? scan.poster_key : `/media/${scan.poster_key}`)}"` : "",
    scan.camera_orbit ? `camera-orbit="${esc(scan.camera_orbit)}"` : "",
    scan.camera_target ? `camera-target="${esc(scan.camera_target)}"` : "",
    scan.field_of_view ? `field-of-view="${esc(scan.field_of_view)}"` : "",
    `alt="${esc(scan.name)}"`,
  ]
    .filter(Boolean)
    .join(" ");
  return `<div class="scan-block-wrap"><model-viewer ${attrs} camera-controls auto-rotate shadow-intensity="1" ar ar-modes="webxr scene-viewer quick-look" loading="lazy"><button slot="ar-button" class="scan-ar-btn">View in your space</button></model-viewer></div>`;
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
    case "changelog": {
      const entries = Array.isArray(c.entries) ? c.entries.filter((e) => e && (e.title || e.description)) : [];
      if (!entries.length) return `<p class="empty-hint">No entries yet.</p>`;
      return `<div class="changelog-list">${entries
        .map(
          (e) =>
            `<div class="changelog-item">${e.date ? `<time datetime="${esc(e.date)}">${esc(e.date)}</time>` : ""}${
              e.title ? `<h3>${esc(e.title)}</h3>` : ""
            }${e.description ? `<p>${esc(e.description)}</p>` : ""}</div>`
        )
        .join("")}</div>`;
    }
    case "accordion": {
      const items = Array.isArray(c.items) ? c.items.filter((it) => it && (it.title || it.body)) : [];
      if (!items.length) return `<p class="empty-hint">No items yet.</p>`;
      // <details>/<summary> is native, keyboard- and screen-reader-accessible
      // expand/collapse with zero JS needed.
      return `<div class="accordion">${items
        .map(
          (it) =>
            `<details class="accordion-item"><summary>${esc(it.title || "Untitled")}</summary><div class="accordion-body">${paragraphsHtml(
              it.body || ""
            )}</div></details>`
        )
        .join("")}</div>`;
    }
    case "tabs": {
      const items = Array.isArray(c.tabs) ? c.tabs.filter((it) => it && (it.label || it.body)) : [];
      if (!items.length) return `<p class="empty-hint">No tabs yet.</p>`;
      const uid = `tabs-${block.id}`;
      const tabButtons = items
        .map(
          (it, i) =>
            `<button type="button" class="tab-strip-btn${i === 0 ? " is-active" : ""}" role="tab" aria-selected="${
              i === 0 ? "true" : "false"
            }" aria-controls="${uid}-panel-${i}" id="${uid}-tab-${i}">${esc(it.label || `Tab ${i + 1}`)}</button>`
        )
        .join("");
      const panels = items
        .map(
          (it, i) =>
            `<div class="tab-panel${i === 0 ? " is-active" : ""}" role="tabpanel" id="${uid}-panel-${i}" aria-labelledby="${uid}-tab-${i}"${
              i === 0 ? "" : ' hidden'
            }>${paragraphsHtml(it.body || "")}</div>`
        )
        .join("");
      return `<div class="tabs-block" data-tabs-id="${uid}"><div class="tab-strip" role="tablist">${tabButtons}</div><div class="tab-panels">${panels}</div></div>`;
    }
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
    case "embed":
      return genericEmbedHtml(c.url);
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
    case "scan": {
      if (!c.scan_id) return `<p class="empty-hint">No 3D scan selected.</p>`;
      const scan = await getScan(env, c.scan_id);
      if (!scan) return `<p class="empty-hint">Scan not found.</p>`;
      return modelViewerHtml(scan);
    }
    case "project-card":
      return `<div class="project-card"><h2>${esc(c.title)}</h2>${c.description ? `<p>${esc(c.description)}</p>` : ""}${c.url ? `<a href="${esc(c.url)}"${c.external ? ' target="_blank" rel="noopener"' : ""}>${esc(c.label || c.url)}</a>` : ""}</div>`;
    case "article-list": {
      const articles = await listArticles(env, {
        publishedOnly: true,
        limit: c.limit || 10,
        tag: c.tag || (ctx && ctx.activeTagFilter) || null,
        featuredOnly: !!c.featuredOnly,
      });
      if (!articles.length) return `<p class="empty-hint">No posts yet.</p>`;
      return `<div class="thought-list">${articles
        .map(
          (a) =>
            `<article class="thought${a.pinned ? " thought-pinned" : ""}">${
              a.featured ? `<span class="featured-badge">★ Featured</span>` : ""
            }<time datetime="${esc(a.published_at)}">${esc(
              (a.published_at || "").slice(0, 10)
            )}</time><h2><a href="/random/${esc(a.slug)}">${esc(a.title)}</a></h2>${renderTags(a.tags)}</article>`
        )
        .join("\n")}</div>`;
    }
    case "project-list": {
      const projects = await listProjects(env, {
        publishedOnly: true,
        limit: c.limit || 12,
        tag: c.tag || (ctx && ctx.activeTagFilter) || null,
        featuredOnly: !!c.featuredOnly,
      });
      if (!projects.length) return `<p class="empty-hint">No projects yet.</p>`;
      return `<div class="project-list">${projects
        .map(
          (p) =>
            `<div class="project-card">${
              p.featured ? `<span class="featured-badge">★ Featured</span>` : ""
            }<h2><a href="/projects/${esc(p.slug)}">${esc(p.title)}</a></h2>${p.summary ? `<p>${esc(p.summary)}</p>` : ""}${renderTags(p.tags)}</div>`
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
        const style = b.style || {};
        const inner = await renderBlockInner(env, b, ctx);
        // The scroll-triggered reveal itself (adding .is-visible) is plain
        // JS (nav.js) reacting to this attribute — see the CSS for how
        // prefers-reduced-motion disables the whole effect without any JS
        // branching, by simply never defining the animated styles at all.
        // The delay is folded into the block's single style="" attribute
        // below (a second style attribute on the same element would just
        // clobber the first, silently breaking the grid positioning).
        const hasAnimation = ["fade-in", "slide-up", "slide-left", "slide-right", "zoom-in"].includes(style.animation);
        const dataAnimateAttr = hasAnimation ? ` data-animate="${style.animation}"` : "";
        const delayMs = Number(style.animationDelay);
        const animateDelayCss = hasAnimation && Number.isFinite(delayMs) && delayMs > 0 ? `--animate-delay:${delayMs}ms;` : "";
        // Device-conditional visibility is plain CSS (a media-query class),
        // not server-side UA sniffing — same reasoning as the reduced-motion
        // approach: it works with zero JS and needs no client hint at all.
        const visibilityClass =
          style.visibility === "desktop-only" ? " block-hide-mobile" : style.visibility === "mobile-only" ? " block-hide-desktop" : "";
        // A background video (or an image with a tint overlay) needs real
        // stacked elements — there's no CSS property that overlays a color
        // on a <video>, and layering it into background-image would only
        // work for the image case. The plain, by-far-most-common case (no
        // video, no overlay) keeps the exact same simple markup as before.
        if (style.backgroundVideoUrl || (style.backgroundImage && style.overlayColor)) {
          const overlayRgba = style.overlayColor ? hexToRgba(style.overlayColor, style.overlayOpacity) : null;
          return `<div class="block block-has-bg-layer${visibilityClass}" style="${gridStyle}${blockStyleAttr(style)}${animateDelayCss}"${dataAnimateAttr}>${
            style.backgroundVideoUrl
              ? `<video class="block-bg-video" src="${esc(style.backgroundVideoUrl)}" autoplay muted loop playsinline></video>`
              : ""
          }${overlayRgba ? `<div class="block-bg-overlay" style="background:${overlayRgba};"></div>` : ""}<div class="block-content-over-bg">${inner}</div></div>`;
        }
        return `<div class="block${visibilityClass}" style="${gridStyle}${blockStyleAttr(style)}${animateDelayCss}"${dataAnimateAttr}>${inner}</div>`;
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
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" defer></script>
<script>document.addEventListener("DOMContentLoaded",function(){if(window.hljs)hljs.highlightAll();});</script>
<script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js"></script>
<script type="application/ld+json">${jsonLdScript({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Dominick",
    url: "https://dominickdominick.com/",
    potentialAction: {
      "@type": "SearchAction",
      target: "https://dominickdominick.com/search?q={search_term_string}",
      "query-input": "required name=search_term_string",
    },
  })}</script>
${(Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : [])
  .map((ld) => `<script type="application/ld+json">${jsonLdScript(ld)}</script>`)
  .join("\n")}
${customHead || ""}
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to content</a>
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

    <main class="canvas" id="main-content">
      ${bodyHtml}
    </main>
    ${footerText ? `<footer class="site-footer">${paragraphsHtml(footerText)}</footer>` : ""}
  </div>
</body>
</html>`;
}
