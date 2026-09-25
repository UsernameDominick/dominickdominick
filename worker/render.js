import { listArticles, listProjects, getSimulation, getScan, getSong } from "./db.js";
import { renderSimulationSvg } from "./simulation-render.js";

export function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// esc() stops HTML injection but a href/src value is still live even after
// escaping — "javascript:alert(1)" has nothing to escape, so it would run
// as-is on click. Blocks the dangerous schemes only; anything else (mailto:,
// tel:, relative paths, bare domains without a scheme) passes through
// unchanged, since those are all legitimate and already relied on.
export function safeHref(url) {
  const trimmed = String(url ?? "").trim();
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return "#";
  return trimmed;
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

// Merges an admin-authored custom_json_ld column value alongside whatever
// JSON-LD is already auto-generated for a page/article/project, rather than
// replacing it — an admin adding, say, FAQPage or HowTo schema shouldn't
// have to hand-maintain the Article/CreativeWork/BreadcrumbList schema too.
// custom_json_ld is validated as JSON at save time (admin-api.js), so a
// parse failure here would mean bad data slipped through some other path;
// fail safe by dropping it rather than breaking the whole page's rendering.
export function withCustomJsonLd(jsonLd, customJsonLdRaw) {
  if (!customJsonLdRaw) return jsonLd;
  let custom;
  try {
    custom = JSON.parse(customJsonLdRaw);
  } catch {
    return jsonLd;
  }
  const base = Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : [];
  return [...base, custom];
}

// Minimal markdown: **bold**, *italic*, [label](url), plus [^label] footnote
// references (see extractFootnotes). Runs on already-HTML-escaped text, so
// the only unescaped characters left are the ones this inserts itself —
// safe against breaking the surrounding markup.
function richText(escapedText, footnoteNums) {
  let out = escapedText
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => `<a href="${safeHref(url)}" target="_blank" rel="noopener">${label}</a>`);
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

// A standalone paragraph like `[before-after: url1 | url2 | Before | After]`
// — the only way to get a before/after slider inside a markdown-lite body
// (article/project text), since that body isn't block-based like pages are.
// Labels are optional and default to "Before"/"After".
function beforeAfterMatch(paragraph) {
  const m = paragraph.match(/^\[before-after:\s*([^\]]+)\]$/i);
  if (!m) return null;
  const parts = m[1].split("|").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return { beforeUrl: parts[0], afterUrl: parts[1], beforeLabel: parts[2] || "Before", afterLabel: parts[3] || "After" };
}

function beforeAfterHtml({ beforeUrl, afterUrl, beforeLabel, afterLabel }) {
  return `<div class="before-after" style="--pos:50%;height:360px;">
    <div class="before-after-base"><img src="${esc(afterUrl)}" loading="lazy" alt="${esc(afterLabel)}"><span class="before-after-tag before-after-tag-right">${esc(
    afterLabel
  )}</span></div>
    <div class="before-after-overlay"><img src="${esc(beforeUrl)}" loading="lazy" alt="${esc(beforeLabel)}"><span class="before-after-tag before-after-tag-left">${esc(
    beforeLabel
  )}</span></div>
    <input type="range" class="before-after-slider" min="0" max="100" value="50" aria-label="Drag to compare before and after">
  </div>`;
}

// A fenced `:::type\n...\n:::` block — the markdown-lite equivalent of a
// GFM callout/admonition. Extracted before paragraph splitting (same
// reason as code blocks: the content can itself contain blank lines).
const CALLOUT_TYPES = { note: "Note", tip: "Tip", warning: "Warning", danger: "Danger" };
const CALLOUT_PLACEHOLDER = /\u0000CALLOUT(\d+)\u0000/;

function extractCallouts(text) {
  const callouts = [];
  const replaced = text.replace(/^:::(note|tip|warning|danger)[ \t]*\n([\s\S]*?)\n:::$/gim, (_, type, body) => {
    const i = callouts.length;
    callouts.push({ type: type.toLowerCase(), body });
    return `\u0000CALLOUT${i}\u0000`;
  });
  return { replaced, callouts };
}

function calloutHtml({ type, body }) {
  const label = CALLOUT_TYPES[type] || "Note";
  return `<div class="callout callout-${esc(type)}"><strong class="callout-label">${label}</strong>${paragraphsHtml(body)}</div>`;
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
  const { replaced: withoutCallouts, callouts } = extractCallouts(cleaned);
  const { replaced, blocks } = extractCodeBlocks(withoutCallouts);
  const headings = extractHeadings(replaced);
  const footnoteNums = footnoteNumbering(replaced, defs);
  let hi = 0;
  const body = replaced
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => {
      const trimmed = p.trim();
      const calloutMatch = trimmed.match(CALLOUT_PLACEHOLDER);
      if (calloutMatch) return calloutHtml(callouts[Number(calloutMatch[1])]);
      const codeMatch = trimmed.match(CODE_PLACEHOLDER);
      if (codeMatch) {
        const { lang, code } = blocks[Number(codeMatch[1])];
        // A ```mermaid fenced block renders as a diagram instead of a
        // code listing — the client-side mermaid.js script (loaded
        // alongside highlight.js) finds every `.mermaid` div and replaces
        // its text with the rendered SVG. Still escaped like any other
        // code block: mermaid reads `.textContent`, not `.innerHTML`, so
        // this can't be used to inject markup.
        if ((lang || "").toLowerCase() === "mermaid") {
          return `<div class="mermaid">${esc(code)}</div>`;
        }
        return `<pre><code class="language-${esc(lang || "plaintext")}">${esc(code)}</code></pre>`;
      }
      const table = tableMatch(trimmed);
      if (table) return tableHtml(table);
      const ba = beforeAfterMatch(trimmed);
      if (ba) return beforeAfterHtml(ba);
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
    .replace(/^:::(note|tip|warning|danger)[ \t]*\n([\s\S]*?)\n:::$/gim, "$2")
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

// Full plain-text version of a markdown-lite body (not truncated, unlike
// excerpt()) — used as the source text for the browser-based "Read aloud"
// button, which needs the whole thing, not a summary.
export function plainText(text) {
  return stripMarkdown(text)
    .replace(/^\[before-after:[^\]]+\]$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function excerpt(text, maxLen = 155) {
  const flat = stripMarkdown(text).replace(/\s+/g, " ").trim();
  if (flat.length <= maxLen) return flat;
  const cut = flat.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return cut.slice(0, lastSpace > 0 ? lastSpace : maxLen).trim() + "…";
}

export function renderSearchResultsHtml(query, pages, articles, projects = [], customEmptyText = "", { type = "", sort = "newest", page = 1, totalPages = null, totalCount = null } = {}) {
  if (!query) {
    return `<p class="empty-hint">Enter a search term above to look through pages and posts.</p>`;
  }
  // Filter/sort controls are plain links (rebuilding the URL with the query
  // string intact) rather than a JS-driven form — every other listing page
  // on the site (topics, archive) already works this way with no client JS
  // needed at all, and it's just as easy to link to directly or bookmark.
  // Switching type or sort always drops back to page 1 — a page number
  // that made sense for one filter combination usually doesn't for another.
  const typeLink = (value, label) =>
    `<a href="/search?q=${encodeURIComponent(query)}${value ? `&type=${value}` : ""}${sort !== "newest" ? `&sort=${sort}` : ""}"${
      type === value ? ' class="is-active"' : ""
    }>${label}</a>`;
  const sortLink = (value, label) =>
    `<a href="/search?q=${encodeURIComponent(query)}${type ? `&type=${type}` : ""}${value !== "newest" ? `&sort=${value}` : ""}"${
      sort === value ? ' class="is-active"' : ""
    }>${label}</a>`;
  const filterBarHtml = `<div class="search-filter-bar">
    <span class="search-filter-group">${typeLink("", "All")} ${typeLink("page", "Pages")} ${typeLink("project", "Projects")} ${typeLink("article", "Posts")}</span>
    <span class="search-filter-group">${sortLink("newest", "Newest first")} ${sortLink("oldest", "Oldest first")}</span>
  </div>`;
  // Only meaningful once narrowed to one type — with all three shown at
  // once there'd be three separate page counters on one screen.
  const pageLink = (value, label, cssClass = "") =>
    `<a href="/search?q=${encodeURIComponent(query)}&type=${type}${sort !== "newest" ? `&sort=${sort}` : ""}${
      value > 1 ? `&page=${value}` : ""
    }"${cssClass ? ` class="${cssClass}"` : ""}>${label}</a>`;
  const paginationHtml =
    type && totalPages && totalPages > 1
      ? `<div class="search-pagination">${page > 1 ? pageLink(page - 1, "← Previous") : ""}<span>Page ${page} of ${totalPages}</span>${
          page < totalPages ? pageLink(page + 1, "Next →") : ""
        }</div>`
      : "";
  const total = totalCount != null ? totalCount : pages.length + articles.length + projects.length;
  if (!total) {
    const text = customEmptyText ? customEmptyText.replace("{query}", query) : `No results for "${query}".`;
    return `${filterBarHtml}<p class="empty-hint">${esc(text)}</p>`;
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
  return `${filterBarHtml}<p class="search-result-count">${total} result${total === 1 ? "" : "s"} for "${esc(query)}"</p>
${pageItems ? `<h2>Pages</h2><ul class="search-results">${pageItems}</ul>` : ""}
${projectItems ? `<h2>Projects</h2><ul class="search-results">${projectItems}</ul>` : ""}
${articleItems ? `<h2>Posts</h2><ul class="search-results">${articleItems}</ul>` : ""}
${paginationHtml}`;
}

export function renderTopicsIndexHtml(tagCounts, customEmptyText = "") {
  if (!tagCounts.length) return `<p class="empty-hint">${esc(customEmptyText || "No tagged content yet.")}</p>`;
  const items = tagCounts
    .map((t) => `<li><a href="/topics/${encodeURIComponent(t.tag)}">${esc(t.tag)}</a> <span class="topic-count">${t.count}</span></li>`)
    .join("");
  return `<ul class="topics-list">${items}</ul>`;
}

export function renderTopicPageHtml(tag, articles, projects) {
  const total = articles.length + projects.length;
  if (!total) return `<p class="empty-hint">Nothing tagged "${esc(tag)}" right now.</p>`;
  const projectItems = projects
    .map((p) => `<li><a href="/projects/${esc(p.slug)}">${esc(p.title)}</a>${p.summary ? `<p>${esc(p.summary)}</p>` : ""}</li>`)
    .join("");
  const articleItems = articles
    .map((a) => `<li><a href="/random/${esc(a.slug)}">${esc(a.title)}</a><p>${esc(excerpt(a.body, 140))}</p></li>`)
    .join("");
  return `<p class="search-result-count">${total} thing${total === 1 ? "" : "s"} tagged "${esc(tag)}"</p>
${projectItems ? `<h2>Projects</h2><ul class="search-results">${projectItems}</ul>` : ""}
${articleItems ? `<h2>Posts</h2><ul class="search-results">${articleItems}</ul>` : ""}`;
}

export function renderArchiveHtml(archive, customEmptyText = "") {
  if (!archive.length) return `<p class="empty-hint">${esc(customEmptyText || "Nothing published yet.")}</p>`;
  return archive
    .map(({ year, items }) => {
      const rows = items
        .map((item) => {
          const href = item.type === "article" ? `/random/${esc(item.slug)}` : `/projects/${esc(item.slug)}`;
          return `<li><time datetime="${esc(item.published_at)}">${esc((item.published_at || "").slice(0, 10))}</time> <a href="${href}">${esc(
            item.title
          )}</a>${item.type === "project" ? ` <span class="topic-count">project</span>` : ""}</li>`;
        })
        .join("");
      return `<h2>${esc(year)}</h2><ul class="archive-list">${rows}</ul>`;
    })
    .join("");
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

const JOURNAL_TYPE_LABELS = { log: "Log", test: "Test result", decision: "Decision", failed: "Failed attempt" };

export function renderJournalHtml(entries) {
  if (!entries || !entries.length) return "";
  const items = entries
    .map(
      (j) =>
        `<div class="journal-entry" data-entry-type="${esc(j.entry_type || "log")}"><div class="journal-entry-meta"><span class="journal-entry-type">${esc(
          JOURNAL_TYPE_LABELS[j.entry_type] || "Log"
        )}</span><time datetime="${esc(j.entry_date)}">${esc(j.entry_date)}</time></div>${
          j.title ? `<h3>${esc(j.title)}</h3>` : ""
        }${paragraphsHtml(j.body || "")}</div>`
    )
    .join("\n");
  return `<div class="journal"><strong>Build journal</strong><div class="journal-timeline">${items}</div></div>`;
}

export function renderBomHtml(items) {
  if (!items || !items.length) return "";
  const rows = items
    .map((b) => {
      const lineTotal = b.price != null ? b.price * b.quantity : null;
      return `<tr><td>${esc(b.item)}${
        b.substitution ? `<br><span class="bom-sub">Substitution: ${esc(b.substitution)}</span>` : ""
      }</td><td>${esc(String(b.quantity))}</td><td>${b.price != null ? esc(`$${b.price.toFixed(2)}`) : "—"}</td><td>${
        lineTotal != null ? esc(`$${lineTotal.toFixed(2)}`) : "—"
      }</td><td>${b.link ? `<a href="${esc(safeHref(b.link))}" target="_blank" rel="noopener">Source</a>` : ""}</td></tr>`;
    })
    .join("\n");
  const total = items.reduce((sum, b) => sum + (b.price != null ? b.price * b.quantity : 0), 0);
  const hasAnyPrice = items.some((b) => b.price != null);
  return `<div class="bom"><strong>Bill of materials</strong><div class="table-wrap"><table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th><th><span class="sr-only">Source link</span></th></tr></thead><tbody>${rows}</tbody></table></div>${
    hasAnyPrice ? `<p class="bom-grand-total">Total build cost: $${total.toFixed(2)}</p>` : ""
  }</div>`;
}

export function renderDownloadsHtml(downloads) {
  if (!downloads || !downloads.length) return "";
  const rows = downloads
    .map(
      (d) =>
        `<li><a href="${esc(safeHref(d.url))}">${esc(d.label || d.url)}</a>${d.description ? ` — ${esc(d.description)}` : ""}</li>`
    )
    .join("\n");
  return `<div class="downloads"><strong>Downloads</strong><ul class="downloads-list">${rows}</ul></div>`;
}

export function renderRelatedMediaHtml(articles, simulations, scans) {
  if (!articles.length && !simulations.length && !scans.length) return "";
  const articleItems = articles.map((a) => `<li><a href="/random/${esc(a.slug)}">${esc(a.title)}</a></li>`).join("");
  const simItems = simulations.map((s) => `<li><a href="/simulation/${esc(s.id)}">${esc(s.name)}</a></li>`).join("");
  const scanItems = scans.map((s) => `<li>${esc(s.name)}</li>`).join("");
  return `<div class="related-posts"><strong>Related</strong>
    ${articleItems ? `<h3>Articles</h3><ul class="search-results">${articleItems}</ul>` : ""}
    ${simItems ? `<h3>Simulations</h3><ul class="search-results">${simItems}</ul>` : ""}
    ${scanItems ? `<h3>3D scans</h3><ul class="search-results">${scanItems}</ul>` : ""}
  </div>`;
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

// Projects that named this article in their own related_articles field —
// the article ending's "featured in" callout. A distinct label from
// renderRelatedProjectsHtml (which is for a project page's own outgoing
// picks) since this is the reverse direction: a project pointing back.
export function renderFeaturedInProjectsHtml(projects) {
  if (!projects || !projects.length) return "";
  const items = projects
    .map(
      (p) =>
        `<div class="project-card"><h2><a href="/projects/${esc(p.slug)}">${esc(p.title)}</a></h2>${
          p.summary ? `<p>${esc(p.summary)}</p>` : ""
        }${renderTags(p.tags)}</div>`
    )
    .join("\n");
  return `<div class="related-posts"><strong>Featured in</strong><div class="project-list">${items}</div></div>`;
}

export function renderNotFoundHtml(navItems) {
  const links = navItems
    .map((n) => `<li><a href="${n.slug === "home" ? "/" : "/" + esc(n.slug)}">${esc(n.nav_label)}</a></li>`)
    .join("");
  return `<h1>Page not found</h1>
<p>Whatever you were looking for isn't here — it may have moved or never existed.</p>
${links ? `<p>Try one of these instead:</p><ul class="search-results">${links}</ul>` : ""}`;
}

// Copy-link plus a couple of prebuilt share intents — no share-widget
// script/CDN dependency, just plain links each platform already supports
// via URL parameters, matching the existing text-button aesthetic (no
// brand icons) used everywhere else on the site.
export function renderShareLinks(title, path) {
  const url = `https://dominickdominick.com${path}`;
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  return `<div class="share-links">
    <a class="share-link" href="https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}" target="_blank" rel="noopener" title="Share on X">Share on X</a>
    <a class="share-link" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}" target="_blank" rel="noopener" title="Share on LinkedIn">LinkedIn</a>
    <a class="share-link" href="mailto:?subject=${encodedTitle}&body=${encodedUrl}" title="Share by email">Email</a>
    <button type="button" class="copy-link-btn" data-copy-text="Copy link" data-copied-text="Copied!">Copy link</button>
    <button type="button" class="save-for-later-btn" data-url="${esc(path)}" data-title="${esc(title)}" data-save-text="Save for later" data-saved-text="Saved ✓">Save for later</button>
    <button type="button" class="print-pdf-btn" title="Opens your browser's print dialog — choose &quot;Save as PDF&quot; as the destination for a downloadable copy">Download PDF</button>
  </div>`;
}

export function renderReactionsHtml(contentType, contentId, counts) {
  const buttons = Object.entries(counts)
    .map(
      ([emoji, count]) =>
        `<button type="button" class="reaction-btn" data-emoji="${esc(emoji)}"><span class="reaction-emoji">${emoji}</span><span class="reaction-count">${count}</span></button>`
    )
    .join("");
  return `<div class="reactions" data-content-type="${esc(contentType)}" data-content-id="${esc(String(contentId))}">${buttons}</div>`;
}

// The audio player (if a narration file was uploaded) plus a "Read aloud"
// button that's always available — it drives the browser's own Web Speech
// API against the rendered body text at click time (see article-extras.js),
// so it needs no server-side text extraction or duplicated content in the
// page, and doubles as a real accessibility feature even when no narration
// file exists.
export function renderTtsBarHtml(audioUrl) {
  return `<div class="tts-bar">
    ${audioUrl ? `<audio controls preload="none" src="${esc(audioUrl)}">Your browser does not support audio playback.</audio>` : ""}
    <button type="button" class="read-aloud-btn" data-label-read="🔊 Read aloud" data-label-stop="⏹ Stop reading" aria-label="Read this page aloud">🔊 Read aloud</button>
  </div>`;
}

// A project's hero video (muted/looping background clip). No `autoplay`
// attribute here — whether it plays is decided client-side in nav.js so it
// can respect both the OS-level prefers-reduced-motion and this site's own
// manual motion toggle, neither of which is knowable at render time.
export function renderHeroVideoHtml(videoUrl, posterUrl) {
  if (!videoUrl) return "";
  return `<video class="project-hero-video" muted loop playsinline preload="metadata"${posterUrl ? ` poster="${esc(posterUrl)}"` : ""}>
    <source src="${esc(videoUrl)}">
  </video>`;
}

export function renderCorrectionNoteHtml(note) {
  if (!note) return "";
  return `<div class="correction-note"><strong>Update:</strong> ${esc(note)}</div>`;
}

// A visible "Home / Section / Title" trail mirroring the BreadcrumbList
// JSON-LD each article/project page already emits for search engines —
// that structured data existed only for crawlers, with nothing shown to
// an actual visitor. Takes the same {name, path} shape the JSON-LD's own
// itemListElement is built from (just relative paths instead of absolute
// URLs), so the two never drift apart. A single-item list (nothing to
// distinguish from the current page) renders nothing.
export function renderBreadcrumbHtml(items) {
  if (!items || items.length < 2) return "";
  const crumbs = items
    .map((item, i) =>
      i === items.length - 1
        ? `<span aria-current="page">${esc(item.name)}</span>`
        : `<a href="${esc(item.path)}">${esc(item.name)}</a>`
    )
    .join('<span class="breadcrumb-sep" aria-hidden="true">/</span>');
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${crumbs}</nav>`;
}

// Shown when a draft/expired article or project is being viewed by an
// authenticated admin (either whole-site preview mode's cookie, or a
// one-off ?preview=1 on this URL) — otherwise there'd be no visual cue
// at all that what's on screen isn't what a normal visitor would see,
// especially now that preview mode makes this reachable through ordinary
// navigation rather than only a URL with the query param still attached.
// Not shown for a shared preview-token link — there's no "mode" to turn
// off there, and the visitor already knows it's a preview from how they
// got the link in the first place.
export function renderPreviewBannerHtml(reason) {
  if (!reason) return "";
  const toggle = reason === "cookie" ? `<button type="button" id="preview-mode-off-btn">Turn off preview mode</button>` : "";
  return `<div class="preview-banner">Viewing a draft — not visible to other visitors.${toggle}</div>`;
}

export function renderTags(tags) {
  if (!tags || !tags.length) return "";
  // Links to the topic page (articles + projects together), not just the
  // article index — a project's tag used to send you to /random?tag=,
  // which only ever searched articles and could show nothing at all for
  // a tag that only exists on projects.
  return `<div class="tags">${tags
    .map((t) => `<a class="tag" href="/topics/${encodeURIComponent(t)}">${esc(t)}</a>`)
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
  // A gradient and a background image can coexist — CSS supports multiple
  // comma-separated background-image layers, image first (topmost) so it
  // stays visible, gradient underneath as a fallback/fill for whatever
  // the image doesn't cover (or the only layer, with no image set).
  const gradientFrom = /^#[0-9a-fA-F]{6}$/.test(style.gradientFrom || "") ? style.gradientFrom : null;
  const gradientTo = /^#[0-9a-fA-F]{6}$/.test(style.gradientTo || "") ? style.gradientTo : null;
  const gradientAngle = Number.isFinite(Number(style.gradientAngle)) ? Number(style.gradientAngle) : 135;
  const gradientCss = gradientFrom && gradientTo ? `linear-gradient(${gradientAngle}deg,${gradientFrom},${gradientTo})` : null;
  if (style.backgroundImage || gradientCss) {
    const layers = [style.backgroundImage ? `url('${esc(style.backgroundImage)}')` : null, gradientCss].filter(Boolean);
    parts.push(`background-image:${layers.join(",")}`);
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
  const SHAPE_CLIP_PATHS = {
    circle: "circle(50% at 50% 50%)",
    "diagonal-tl-br": "polygon(0 0, 100% 0, 100% 85%, 0 100%)",
    "diagonal-tr-bl": "polygon(0 0, 100% 0, 100% 100%, 0 85%)",
    hexagon: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
    blob: "polygon(44% 2%, 74% 8%, 94% 32%, 98% 62%, 78% 88%, 48% 98%, 18% 88%, 2% 60%, 6% 28%, 22% 6%)",
  };
  if (SHAPE_CLIP_PATHS[style.shapeMask]) parts.push(`clip-path:${SHAPE_CLIP_PATHS[style.shapeMask]}`);
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
// A loop from the Songs/DAW module — playback happens entirely client-side
// via public/song-engine.js (the exact same synthesis/scheduler code the
// admin builder uses, so a song sounds identical wherever it's played),
// driven by public/song-embed.js. The song's JSON data rides in a data
// attribute rather than being fetched separately, so playback works even
// if the song is later deleted from the library (same "embed the data,
// not just a reference" reasoning as a simulation block's rendered SVG).
export function renderSongBlockHtml(song) {
  const viz = song.data && song.data.visualization;
  let vizHtml;
  if (viz === "waveform") {
    vizHtml = `<canvas class="song-embed-waveform" width="600" height="80"></canvas>`;
  } else if (viz === "pulse") {
    vizHtml = `<div class="song-embed-pulse"><div class="song-embed-pulse-core"></div></div>`;
  } else {
    const bars = Array.from({ length: 16 }, () => `<span class="song-embed-bar"></span>`).join("");
    vizHtml = `<div class="song-embed-bars">${bars}</div>`;
  }
  return `<div class="song-embed" data-song="${esc(JSON.stringify(song.data))}">
    <div class="song-embed-header"><strong>${esc(song.name)}</strong><button type="button" class="song-embed-play-btn">▶ Play</button></div>
    ${vizHtml}
  </div>`;
}

export function modelViewerHtml(scan, description) {
  const attrs = [
    `src="${esc(`/media/${scan.glb_key}`)}"`,
    scan.usdz_key ? `ios-src="${esc(`/media/${scan.usdz_key}`)}"` : "",
    scan.poster_key ? `poster="${esc(scan.poster_key.startsWith("/") ? scan.poster_key : `/media/${scan.poster_key}`)}"` : "",
    scan.camera_orbit ? `camera-orbit="${esc(scan.camera_orbit)}"` : "",
    scan.camera_target ? `camera-target="${esc(scan.camera_target)}"` : "",
    scan.field_of_view ? `field-of-view="${esc(scan.field_of_view)}"` : "",
    // description (if set) is what's actually announced — a scan's own
    // name is often just a filename-ish label, not a real description of
    // what's shown, and this is also model-viewer's fallback content when
    // the custom element itself can't load (JS disabled, old browser).
    `alt="${esc(description || scan.name)}"`,
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
    case "image": {
      const rawImg = `<img src="${esc(c.url)}" alt="${esc(c.alt)}" loading="lazy" style="max-width:100%;border-radius:12px;">`;
      const img = c.frame === "browser"
        ? `<div class="device-frame device-frame-browser"><div class="device-frame-bar"><span></span><span></span><span></span></div><div class="device-frame-body">${rawImg}</div></div>`
        : c.frame === "phone"
        ? `<div class="device-frame device-frame-phone"><div class="device-frame-notch"></div><div class="device-frame-body">${rawImg}</div></div>`
        : rawImg;
      if (!c.caption && !c.credit) return img;
      const creditHtml = c.credit ? ` <cite>${esc(c.credit)}</cite>` : "";
      return `<figure class="image-figure">${img}<figcaption>${esc(c.caption || "")}${creditHtml}</figcaption></figure>`;
    }
    case "button":
      return `<a class="btn" href="${esc(safeHref(c.url))}"${c.external ? ' target="_blank" rel="noopener"' : ""}${
        c.trackEvent ? ` data-track-event="${esc(c.trackEvent)}"` : ""
      }>${esc(c.label)}</a>`;
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
        .map((it) => `<li><a href="${esc(safeHref(it.url))}"${/^https?:\/\//.test(it.url || "") ? ' target="_blank" rel="noopener"' : ""}>${esc(it.label || it.url)}</a></li>`)
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
    case "before-after": {
      if (!c.beforeUrl || !c.afterUrl) return `<p class="empty-hint">Add both a "before" and "after" image.</p>`;
      return `<div class="before-after" style="--pos:50%">
        <div class="before-after-base"><img src="${esc(c.afterUrl)}" loading="lazy" alt="${esc(c.afterLabel || "After")}"><span class="before-after-tag before-after-tag-right">${esc(
        c.afterLabel || "After"
      )}</span></div>
        <div class="before-after-overlay"><img src="${esc(c.beforeUrl)}" loading="lazy" alt="${esc(c.beforeLabel || "Before")}"><span class="before-after-tag before-after-tag-left">${esc(
        c.beforeLabel || "Before"
      )}</span></div>
        <input type="range" class="before-after-slider" min="0" max="100" value="50" aria-label="Drag to compare before and after">
      </div>`;
    }
    case "simulation": {
      if (!c.simulation_id) return `<p class="empty-hint">No simulation selected.</p>`;
      const sim = await getSimulation(env, c.simulation_id);
      if (!sim) return `<p class="empty-hint">Simulation not found.</p>`;
      const uid = `sim-${block.id}`;
      // The SVG itself is a visual circuit diagram with no inherent text
      // equivalent — an interactive canvas like this needs someone to
      // actually describe what it does, so this is opt-in per placement
      // rather than derived from the simulation's (often terse) name.
      const descId = c.description ? `${uid}-desc` : "";
      const svg = renderSimulationSvg(sim.data).replace(
        'class="sim-svg"',
        `class="sim-svg" id="${esc(uid)}" role="img" aria-label="${esc(sim.name || "Circuit simulation")}"${descId ? ` aria-describedby="${esc(descId)}"` : ""}`
      );
      const descHtml = c.description ? `<p id="${esc(descId)}" class="sr-only">${esc(c.description)}</p>` : "";
      return `<div class="sim-block-wrap">${descHtml}${svg}<button type="button" class="sim-power-btn" data-target="${esc(
        uid
      )}">Power on</button></div>`;
    }
    case "scan": {
      if (!c.scan_id) return `<p class="empty-hint">No 3D scan selected.</p>`;
      const scan = await getScan(env, c.scan_id);
      if (!scan) return `<p class="empty-hint">Scan not found.</p>`;
      return modelViewerHtml(scan, c.description);
    }
    case "song": {
      if (!c.song_id) return `<p class="empty-hint">No song selected.</p>`;
      const song = await getSong(env, c.song_id);
      if (!song) return `<p class="empty-hint">Song not found.</p>`;
      return renderSongBlockHtml(song);
    }
    case "project-card":
      return `<div class="project-card"><h2>${esc(c.title)}</h2>${c.description ? `<p>${esc(c.description)}</p>` : ""}${c.url ? `<a href="${esc(safeHref(c.url))}"${c.external ? ' target="_blank" rel="noopener"' : ""}>${esc(c.label || c.url)}</a>` : ""}</div>`;
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
        sort: c.sort === "manual" ? "manual" : "newest",
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

// Date-conditional visibility is a real server-side filter (unlike
// device-conditional, which is CSS-only) — a scheduled block genuinely
// shouldn't ship in the HTML at all before/after its window, not just be
// hidden client-side, since nothing about "not yet announced" should be
// visible in page source.
function isBlockInDateWindow(style) {
  if (!style) return true;
  const now = new Date().toISOString();
  if (style.visibleFrom && style.visibleFrom > now) return false;
  if (style.visibleUntil && style.visibleUntil <= now) return false;
  return true;
}

export async function renderBlocks(env, blocks, ctx = {}) {
  const parts = await Promise.all(
    blocks
      .filter((b) => !(b.style && b.style.hidden) && isBlockInDateWindow(b.style))
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
        const hoverClass = ["lift", "grow", "glow", "darken"].includes(style.hoverEffect) ? ` block-hover-${style.hoverEffect}` : "";
        // A background video (or an image with a tint overlay) needs real
        // stacked elements — there's no CSS property that overlays a color
        // on a <video>, and layering it into background-image would only
        // work for the image case. The plain, by-far-most-common case (no
        // video, no overlay) keeps the exact same simple markup as before.
        if (style.backgroundVideoUrl || (style.backgroundImage && style.overlayColor)) {
          const overlayRgba = style.overlayColor ? hexToRgba(style.overlayColor, style.overlayOpacity) : null;
          return `<div class="block block-has-bg-layer${visibilityClass}${hoverClass}" style="${gridStyle}${blockStyleAttr(style)}${animateDelayCss}"${dataAnimateAttr}>${
            style.backgroundVideoUrl
              ? `<video class="block-bg-video" src="${esc(style.backgroundVideoUrl)}" autoplay muted loop playsinline></video>`
              : ""
          }${overlayRgba ? `<div class="block-bg-overlay" style="background:${overlayRgba};"></div>` : ""}<div class="block-content-over-bg">${inner}</div></div>`;
        }
        return `<div class="block${visibilityClass}${hoverClass}" style="${gridStyle}${blockStyleAttr(style)}${animateDelayCss}"${dataAnimateAttr}>${inner}</div>`;
      })
  );
  return parts.join("\n");
}

// The raw SVG markup, exported separately so worker/index.js can serve it
// directly at /favicon.ico — browsers probe that path regardless of the
// <link rel="icon"> data-URI below, and without a real response there it's
// a 404 on every single page load.
export const FAVICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='#0b0b0c'/><text x='50' y='68' font-family='Arial,sans-serif' font-size='60' font-weight='700' fill='#e8a13a' text-anchor='middle'>D</text></svg>";

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%230b0b0c'/%3E%3Ctext x='50' y='68' font-family='Arial,sans-serif' font-size='60' font-weight='700' fill='%23e8a13a' text-anchor='middle'%3ED%3C/text%3E%3C/svg%3E";

// The top-level fetch() catch calls this directly — deliberately fully
// self-contained (no DB reads for nav/theme/settings, no imports beyond
// what's already in this module) since it exists for the case where
// something has already gone wrong, possibly the DB itself. Inline
// styles only, so it never depends on /style.css having loaded either.
export function renderErrorPageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Something went wrong · Dominick</title>
<meta name="robots" content="noindex">
<link rel="icon" href="${FAVICON}">
<style>
  html, body { margin: 0; height: 100%; }
  body {
    background: #0b0b0c;
    color: #f2f2f2;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px;
  }
  .error-box { max-width: 480px; }
  h1 { font-size: 1.6rem; margin-bottom: 12px; }
  p { color: #a3a3a3; line-height: 1.5; }
  a { color: #e8a13a; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="error-box">
    <h1>Something went wrong</h1>
    <p>An unexpected error occurred. It's been logged — try again in a moment, or head back to the homepage.</p>
    <p><a href="/">← Back to dominick.dominick</a></p>
  </div>
</body>
</html>`;
}

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
  canonicalUrl = null,
  canvasClass = "canvas",
}) {
  const canonical = canonicalUrl || `https://dominickdominick.com${path}`;
  const themeVars = [];
  if (theme.accent) themeVars.push(`--accent:${esc(theme.accent)}`);
  if (theme.bg) themeVars.push(`--bg:${esc(theme.bg)}`);
  if (theme.text) themeVars.push(`--text:${esc(theme.text)}`);
  if (theme.border) themeVars.push(`--border:${esc(theme.border)}`);
  if (theme.font && FONT_STACKS[theme.font]) themeVars.push(`--font-family:${FONT_STACKS[theme.font]}`);
  if (theme.headingFont && FONT_STACKS[theme.headingFont]) themeVars.push(`--heading-font-family:${FONT_STACKS[theme.headingFont]}`);
  const themeStyle = themeVars.length ? `<style>:root{${themeVars.join(";")};}</style>` : "";
  // The mobile/desktop device-visibility breakpoint (.block-hide-mobile/
  // .block-hide-desktop in style.css) is fixed at 640px in that static
  // stylesheet. A custom value can't edit that file per-request, so this
  // overrides it with the same selectors at the custom width instead —
  // only one of the two media queries ever matches a given viewport, so
  // there's no cascade-order fight with the original rule, just whichever
  // width range actually applies.
  const breakpoint = Number(theme.mobileBreakpoint) || 640;
  const breakpointStyle =
    breakpoint !== 640
      ? `<style>@media (max-width:${breakpoint}px){.block-hide-mobile{display:none !important;}}@media (min-width:${
          breakpoint + 1
        }px){.block-hide-desktop{display:none !important;}}</style>`
      : "";
  // A top-level item with children (listNavPages() nests one level deep)
  // renders as a dropdown: the item itself is still a normal link, plus a
  // caret button that toggles the dropdown open for touch/keyboard users
  // (see nav.js) — hover/focus-within alone (the CSS default) covers mouse
  // use without needing any JS at all. The parent tab is marked active
  // when the *current page is one of its children*, too, since the child
  // link itself is hidden inside the (closed) dropdown most of the time —
  // there'd otherwise be nothing in the visible tab bar showing where you are.
  const navHtml = navItems
    .map((n) => {
      const isChildActive = (n.children || []).some((c) => c.slug === activeSlug);
      const tabHref = n.slug === "home" ? "/" : "/" + esc(n.slug);
      const tab = `<a class="tab${n.slug === activeSlug || isChildActive ? " is-active" : ""}" href="${tabHref}"${
        n.slug === activeSlug ? ' aria-current="page"' : ""
      }>${esc(n.nav_label)}</a>`;
      if (!n.children || !n.children.length) return tab;
      const childLinks = n.children
        .map(
          (c) =>
            `<a href="/${esc(c.slug)}"${c.slug === activeSlug ? ' aria-current="page" class="is-active"' : ""}>${esc(c.nav_label)}</a>`
        )
        .join("\n");
      return `<div class="tab-group">
        ${tab}
        <button type="button" class="tab-caret" aria-label="Show ${esc(n.nav_label)} submenu" aria-expanded="false">▾</button>
        <div class="tab-dropdown" role="menu">${childLinks}</div>
      </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<script>(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);var m=localStorage.getItem("motion");if(m==="reduce")document.documentElement.setAttribute("data-motion","reduce");var fs=parseFloat(localStorage.getItem("fontScale"));if(fs)document.documentElement.style.setProperty("--font-scale",fs);}catch(e){}})();</script>
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
<link rel="alternate" type="application/rss+xml" title="Dominick — RSS feed" href="/rss.xml">

<link rel="stylesheet" href="/style.css">
${themeStyle}
${breakpointStyle}
<script src="/sim-player.js" defer></script>
<script src="/article-extras.js" defer></script>
<script src="/song-engine.js" defer></script>
<script src="/song-embed.js" defer></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" defer></script>
<script>document.addEventListener("DOMContentLoaded",function(){if(window.hljs)hljs.highlightAll();});</script>
<script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js"></script>
<script type="module">
  if (document.querySelector(".mermaid")) {
    import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs").then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: document.documentElement.getAttribute("data-theme") === "light" ? "default" : "dark" });
      mermaid.run();
    });
  }
</script>
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
        <form class="site-search" action="/search" method="get" role="search" autocomplete="off">
          <input type="search" name="q" placeholder="Search" aria-label="Search" value="${esc(searchQuery || "")}" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="search-suggest-list">
          <div class="search-suggest" id="search-suggest-list" hidden></div>
        </form>
        <a class="icon-link-btn" href="/shuffle" title="Random project or article" aria-label="Random project or article">⇌</a>
        <button type="button" id="motion-toggle" aria-label="Toggle reduced motion" title="Turn off entrance/hover animations">⏸</button>
        <button type="button" id="font-size-toggle" aria-label="Change text size" title="Change text size">A</button>
        <button type="button" id="theme-toggle" aria-label="Toggle light/dark theme">◐</button>
      </div>
    </header>
    <script src="/nav.js"></script>

    <main class="${esc(canvasClass)}" id="main-content">
      ${bodyHtml}
    </main>
    ${footerText ? `<footer class="site-footer">${paragraphsHtml(footerText)}</footer>` : ""}
  </div>
</body>
</html>`;
}
