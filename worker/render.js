import { listArticles, listProjects, getPublishedSimulation, getScan, getSong, getMediaMeta } from "./db.js";
import { safeImageSrc, mediaKeyFor, paragraphPictures, bodyPictures, PICTURE_ONLY_LINE } from "./pictures.js";
import { paragraphEmbed, bodyEmbeds, EMBED_ONLY_LINE, MAX_BODY_EMBEDS } from "./embeds.js";
import { nowIso, visibleText } from "./text.js";
import { navIconSvg } from "./nav-icons.js";
import { renderSimulationSvg, SIM_DEFS_SVG, describeSimulation, renderLogicGateTables } from "./simulation-render.js";
// STUDY (temporary): see worker/study/README.md.
import { renderStudyBlock, studyPageTags } from "./study/index.js";

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
// as-is on click.
//
// A critic pass reviewing a client-side port of this exact function (for
// simulation-builder.js's datasheet links) found the original denylist-
// regex approach had a real, browser-confirmed bypass: a tab or newline
// embedded INSIDE the scheme name (e.g. "java\tscript:alert(1)") doesn't
// match an anchored `/^(javascript|...)/` regex tested against a merely-
// .trim()'d string, since .trim() only strips leading/trailing whitespace,
// not embedded characters -- but a browser's own URL parser strips ALL
// ASCII tab/newline characters anywhere in the string before ever reading
// the scheme, so the href actually resolves to a real "javascript:" URL
// despite passing the regex check. Several call sites of this exact
// function render the result without `target="_blank"` (e.g. the
// link-list block below), so there's no incidental new-tab-navigation
// protection masking the gap the way there might be elsewhere.
//
// Fixed the same way as the client-side port: parse the URL for real
// (via the runtime's own WHATWG-compliant URL parser, which normalizes
// embedded control characters exactly the way a browser will before it
// ever gets to look at the scheme) and allowlist the resulting protocol,
// instead of denylisting patterns in the raw input text. `env` isn't
// needed here since Workers' global `URL` doesn't require a request
// context; a fixed placeholder base lets a relative path or bare
// domain-without-scheme still resolve without needing this site's own
// real origin plumbed through every caller.
export function safeHref(url) {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return "#";
  try {
    const parsed = new URL(trimmed, "https://dominickdominick.invalid/");
    const allowedProtocols = ["http:", "https:", "mailto:", "tel:"];
    return allowedProtocols.includes(parsed.protocol) ? trimmed : "#";
  } catch {
    return "#";
  }
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
  // `inline code` is lifted out first, so what is inside it (stars, brackets) stays literal; it is put back as <code> at the end.
  const codeSpans = [];
  let out = escapedText
    .replace(/`([^`\n]+?)`/g, (m, code) => {
      codeSpans.push(code);
      return `\u0000CODESPAN${codeSpans.length - 1}\u0000`;
    })
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => {
      const href = safeHref(url);
      // A link to another page of this site stays in the same tab; one to another site opens a new tab and says so.
      return /^https?:\/\//i.test(href)
        ? `<a href="${href}" target="_blank" rel="noopener">${label}<span class="sr-only"> (opens in a new tab)</span></a>`
        : `<a href="${href}">${label}</a>`;
    });
  if (footnoteNums && footnoteNums.size) {
    out = out.replace(/\[\^([^\]]+)\]/g, (m, label) => {
      const n = footnoteNums.get(label);
      return n ? `<sup id="fnref-${n}"><a href="#fn-${n}">${n}</a></sup>` : m;
    });
  }
  return codeSpans.length ? out.replace(/\u0000CODESPAN(\d+)\u0000/g, (m, i) => `<code>${codeSpans[Number(i)]}</code>`) : out;
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

function calloutHtml({ type, body }, media = null) {
  const label = CALLOUT_TYPES[type] || "Note";
  return `<div class="callout callout-${esc(type)}"><strong class="callout-label">${label}</strong>${paragraphsHtml(body, { media })}</div>`;
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

// Footer layout: up to FOOTER_MAX_COLUMNS link columns and a row of social links, kept as JSON in the
// "site_footer_links" setting. Returns the cleaned shape or null; labels are plain text and links must be
// a site path or an http(s)/mailto/tel address, so a hand-edited value can't smuggle in anything else.
export const FOOTER_MAX_COLUMNS = 3;
export const FOOTER_MAX_LINKS = 8;
export const FOOTER_MAX_LABEL = 60;
export const FOOTER_MAX_URL = 500;
function cleanFooterLink(l) {
  const label = String(l && l.label != null ? l.label : "").trim();
  const url = String(l && l.url != null ? l.url : "").trim();
  // Too long is refused, never cut: a shortened address would be a different, broken link.
  if (!label || !url || label.length > FOOTER_MAX_LABEL || url.length > FOOTER_MAX_URL) return null;
  // No control characters, spaces or backslashes anywhere (browsers read "/\\x" and "/<tab>/x" as "//x").
  if (/[\u0000-\u0020\u007f\\]/.test(url)) return null;
  if (!/^(\/(?!\/)|https?:\/\/|mailto:|tel:)/i.test(url)) return null;
  return { label, url };
}
export function cleanFooterLinks(raw) {
  let data = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const columns = (Array.isArray(data.columns) ? data.columns : [])
    .map((c) => ({
      title: String(c && c.title != null ? c.title : "").trim().slice(0, 40),
      links: (Array.isArray(c && c.links) ? c.links : []).map(cleanFooterLink).filter(Boolean).slice(0, FOOTER_MAX_LINKS),
    }))
    .filter((c) => c.links.length)
    .slice(0, FOOTER_MAX_COLUMNS);
  const social = (Array.isArray(data.social) ? data.social : []).map(cleanFooterLink).filter(Boolean).slice(0, FOOTER_MAX_LINKS);
  return columns.length || social.length ? { columns, social } : null;
}

// The footer is either plain text (the older setting) or { text, columns, social } once a layout is set.
// An admin-set footer wins; blank or whitespace-only falls back to a minimal default.
export function footerHtml(footer, year = new Date().getUTCFullYear()) {
  const obj = footer && typeof footer === "object" ? footer : { text: footer };
  const body = String(obj.text == null ? "" : obj.text).trim();
  const columns = obj.columns || [];
  const social = obj.social || [];
  const link = (l) => `<a href="${esc(safeHref(l.url))}"${/^https?:/i.test(l.url) ? ' rel="noopener"' : ""}>${esc(l.label)}</a>`;
  const colsHtml = columns.length
    ? `<nav class="footer-columns" aria-label="Footer">${columns
        .map((c) => `<div class="footer-column">${c.title ? `<h2>${esc(c.title)}</h2>` : ""}<ul role="list">${c.links.map((l) => `<li>${link(l)}</li>`).join("")}</ul></div>`)
        .join("")}</nav>`
    : "";
  const socialHtml = social.length ? `<ul class="footer-social" role="list" aria-label="Elsewhere">${social.map((l) => `<li>${link(l)}</li>`).join("")}</ul>` : "";
  // The feed link and a Share button close every footer. The feed link is left out when the admin already put one in the footer, and the
  // button stays hidden until nav.js finds the browser can share the page or copy its address (so it never shows without JavaScript).
  const hasFeedLink = [...columns.flatMap((c) => c.links || []), ...social].some((l) => /^\/rss\.xml(\?|$)/i.test(String(l.url)));
  const extras = `<p class="footer-extras">${hasFeedLink ? "" : '<a class="footer-rss" href="/rss.xml">RSS feed</a>'}<button type="button" class="footer-share" data-share hidden>Share this page</button><span class="footer-share-note" role="status" aria-live="polite"></span></p>`;
  if (!body && !columns.length && !social.length) return `<footer class="site-footer"><p class="footer-mono">© ${year} Dominick</p>${extras}</footer>`;
  return `<footer class="site-footer">${colsHtml}${socialHtml}${body ? paragraphsHtml(body) : ""}${extras}</footer>`;
}

// ---------- Images in body text ----------
// A paragraph (or run of lines) that is only `![alt text](/media/uploads/photo.jpg "Optional caption")` becomes a figure; see
// pictures.js for what counts as a picture. Alt text falls back to the Media Library's default for that file, and the file's stored
// width and height go on the <img> so the page doesn't jump as it loads.
export { safeImageSrc };

// Looks up the Media Library rows for every picture in a text (or in several texts at once: a body and its journal entries),
// one query for all of them and none when there are none, to hand to paragraphsHtml as `media`. Without it pictures still
// render, just without stored sizes or the library's alt text; a failed lookup is the same, never a broken page.
export const EMBEDS = Symbol("bodyEmbeds");
let bodyEmbedSeq = 0;

export async function loadBodyMedia(env, texts) {
  const list = Array.isArray(texts) ? texts : [texts];
  let rows = {};
  try {
    const keys = new Set();
    for (const text of list) {
      for (const picture of bodyPictures(text)) {
        if (picture.key) keys.add(picture.key);
        if (keys.size >= 50) break;
      }
    }
    if (keys.size) rows = await getMediaMeta(env, [...keys]);
  } catch {
    rows = {};
  }
  // The simulations, songs and scans the texts embed (`::sim 148::`) travel on the same object, out of sight (a symbol key that
  // isn't enumerable), so every place that already passes `media` along passes them too. A missing or unpublished item is null.
  const embeds = new Map();
  try {
    const wanted = new Map();
    for (const text of list) for (const e of bodyEmbeds(text)) wanted.set(`${e.kind}:${e.id}`, e);
    await Promise.all(
      [...wanted.entries()].slice(0, MAX_BODY_EMBEDS).map(async ([key, e]) => {
        const load = e.kind === "sim" ? getPublishedSimulation : e.kind === "song" ? getSong : getScan;
        embeds.set(key, (await load(env, e.id).catch(() => null)) || null);
      })
    );
  } catch {
    // embeds just don't show
  }
  Object.defineProperty(rows, EMBEDS, { value: embeds, enumerable: false });
  return rows;
}

// An embedded item as it appears in text: the same markup as its block. An item that is missing or unpublished shows nothing
// (like a broken block), and with no lookup done (a text that wasn't loaded with loadBodyMedia) the line stays as it was typed.
function bodyEmbedHtml(embed, embeds) {
  if (!embeds) return null;
  const item = embeds.get(`${embed.kind}:${embed.id}`);
  if (!item) return "";
  // A page shows at most MAX_BODY_EMBEDS embeds in total, copies included (an accidental paste of one line a few hundred times
  // would otherwise be a few hundred circuits); the editor warns when a text asks for more.
  embeds.shown = (embeds.shown || 0) + 1;
  if (embeds.shown > MAX_BODY_EMBEDS) return "";
  const inner =
    embed.kind === "sim"
      ? simulationEmbedHtml(item, `sim-body-${++bodyEmbedSeq}`, embed.description)
      : embed.kind === "song"
      ? renderSongBlockHtml(item)
      : modelViewerHtml(item, embed.description);
  return `<div class="body-embed body-embed-${embed.kind}">${inner}</div>`;
}

function bodyFigureHtml(m, media) {
  const src = safeImageSrc(m[2]);
  if (!src) return null;
  const key = mediaKeyFor(src);
  const row = key && media && media[key];
  const alt = m[1].trim() || (row && typeof row.alt_text === "string" ? row.alt_text.trim() : "");
  const width = row && Number(row.width);
  const height = row && Number(row.height);
  const size = width > 0 && height > 0 ? ` width="${width}" height="${height}"` : "";
  const caption = m[3] && m[3].trim() ? `<figcaption>${richText(esc(m[3].trim()))}</figcaption>` : "";
  return `<figure class="image-figure body-figure"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async"${size}>${caption}</figure>`;
}

export function paragraphsHtml(text, { anchors = false, media = null } = {}) {
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
      if (calloutMatch) return calloutHtml(callouts[Number(calloutMatch[1])], media);
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
        // A ```math fenced block renders as a KaTeX equation instead of a
        // code listing, same conditional-CDN-load pattern as mermaid above
        // (see renderShell) — most pages have no math in them at all, so
        // KaTeX's JS/CSS only loads on the ones that do. Deliberately
        // block-level only, not inline $...$ spans: this site already has
        // dollar-amount content (BOM build costs) that inline math syntax
        // would collide with.
        if ((lang || "").toLowerCase() === "math") {
          return `<div class="katex-block">${esc(code)}</div>`;
        }
        return `<pre><code class="language-${esc(lang || "plaintext")}">${esc(code)}</code></pre>`;
      }
      // A paragraph that is only "---" (or "***", "___") is a divider.
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return "<hr>";
      const embed = paragraphEmbed(trimmed);
      if (embed) {
        const embedHtml = bodyEmbedHtml(embed, media && media[EMBEDS]);
        if (embedHtml !== null) return embedHtml;
      }
      const images = paragraphPictures(trimmed);
      if (images) {
        const figures = images.map((m) => bodyFigureHtml(m, media));
        if (figures.every(Boolean)) return figures.join("");
      }
      const table = tableMatch(trimmed);
      if (table) return tableHtml(table);
      const ba = beforeAfterMatch(trimmed);
      if (ba) return beforeAfterHtml(ba);
      const h = headingMatch(trimmed);
      if (h) {
        const { id, level } = headings[hi++];
        // Article and project bodies (anchors: true) get a "#" permalink beside each heading; page text blocks don't, since
        // several of them on one page would repeat the same ids.
        const anchor = anchors ? `<a class="heading-anchor" href="#${esc(id)}" aria-label="Link to this section: ${esc(h.text)}">#</a>` : "";
        return `<h${level} id="${esc(id)}">${richText(esc(h.text))}${anchor}</h${level}>`;
      }
      // Lists and blockquotes -- the two most common Markdown constructs --
      // weren't supported at all: "- item" and "> quote" rendered as literal
      // text with the dash/bracket showing. A paragraph whose every line is
      // a list item (or quote line) now renders as the real element.
      const lines = trimmed.split("\n");
      const inline = (t) => richText(esc(t), footnoteNums);
      if (lines.every((l) => /^\s*[-*+]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*+]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
        const start = Number(lines[0].match(/^\s*(\d+)/)[1]);
        return `<ol${start !== 1 ? ` start="${start}"` : ""}>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
      }
      if (lines.every((l) => /^\s*>/.test(l))) {
        const quoted = lines.map((l) => l.replace(/^\s*>\s?/, "")).join("\n");
        return `<blockquote class="md-quote"><p>${inline(quoted).replace(/\n/g, "<br>")}</p></blockquote>`;
      }
      return `<p>${richText(esc(p), footnoteNums).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
  return body + footnotesHtml(footnoteNums, defs);
}

function stripMarkdown(text) {
  return String(text ?? "")
    .replace(/\u200b/g, "") // invisible guard characters pasted content may carry
    .replace(/```(\w*)\n([\s\S]*?)```/g, "$2")
    .replace(/^:::(note|tip|warning|danger)[ \t]*\n([\s\S]*?)\n:::$/gim, "$2")
    .replace(/^\[\^([^\]]+)\]:\s*.+$/gm, "")
    .replace(/\[\^([^\]]+)\]/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    // List markers, quote markers, inline code and images leaked into
    // excerpts and meta descriptions as raw syntax ("- CSS `:has()`...").
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(PICTURE_ONLY_LINE, "") // a picture on its own line has no words
    .replace(EMBED_ONLY_LINE, "") // nor does an embedded simulation, song or scan
    .replace(/!\[([^\]\n]*)\]\(\s*[^\s)]+(?:\s+"[^"\n]*")?\s*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/!?\[([^\]\n]+)\]\([^)\n]+\)/g, "$1"); // one line only: an unfinished link must not swallow the text below it
}

// A rough, standard estimate (200 words/minute) — good enough to give a
// reader a sense of length, not meant to be precise to the second.
export function readingTime(text) {
  const flat = stripMarkdown(text).trim();
  const words = flat ? flat.split(/\s+/).length : 0;
  return Math.max(1, Math.round(words / 200));
}

// "Sep 26, 2026" instead of a raw "2026-09-26" in listings. Formatted in
// UTC with a fixed locale so the server-rendered text never depends on
// the Worker's own locale settings.
const DISPLAY_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function displayDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  return `${DISPLAY_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// Well-formed HTML tags of the usual names only, bounded and single-line, so prose such as
// "i<n and j>k", "Vec<String>" or "<https://example.com>" is never mistaken for markup.
const HTML_TAG_RE =
  /<\/?(?:div|span|p|br|hr|img|a|b|i|u|s|em|strong|small|sub|sup|mark|ul|ol|li|dl|dt|dd|h[1-6]|table|thead|tbody|tfoot|tr|td|th|section|article|aside|header|footer|nav|main|blockquote|pre|code|iframe|video|audio|source|figure|figcaption|details|summary|button|form|input|label|select|option|textarea|script|style|center|font)(?:\s[^<>\n]{0,200})?\/?>/gi;

export function excerpt(text, maxLen = 155) {
  // Headings are dropped, not flattened: "…on the page.\n## The model\nEvery
  // part…" otherwise read as "…on the page. The model Every part…".
  // Thematic breaks ("---", "***", "___") and raw HTML tags carry no text for a snippet.
  const body = String(text || "")
    .replace(/^\s{0,3}#{1,6}\s.*$/gm, "")
    .replace(/^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, "")
    .split(/(`[^`\n]*`)/)
    .map((part, i) => (i % 2 ? part : part.replace(HTML_TAG_RE, "")))
    .join("");
  const flat = stripMarkdown(body).replace(/\s+/g, " ").trim();
  if (flat.length <= maxLen) return flat;
  const cut = flat.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return cut.slice(0, lastSpace > 0 ? lastSpace : maxLen).trim() + "…";
}

// Text with the searched words wrapped in <mark> (everything else escaped).
function highlightHtml(text, terms) {
  const t = String(text ?? "");
  const words = (terms || []).filter(Boolean);
  if (!words.length) return esc(t);
  const re = new RegExp(
    words
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .sort((a, b) => b.length - a.length)
      .join("|"),
    "gi"
  );
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(t))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    out += esc(t.slice(last, m.index)) + `<mark>${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  return out + esc(t.slice(last));
}

// A short stretch of a text around the first place the searched words appear (the start of the text when they aren't in it), with
// the words highlighted and "…" where it was cut.
function searchSnippetHtml(text, terms, max = 160) {
  const flat = excerpt(text, 1e9);
  if (!flat) return "";
  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of terms || []) {
    const i = term ? lower.indexOf(term.toLowerCase()) : -1;
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (flat.length <= max) return highlightHtml(flat, terms);
  let start = at === -1 ? 0 : Math.max(0, at - 50);
  if (start > 0) {
    const next = flat.indexOf(" ", start);
    start = next === -1 || next > at ? start : next + 1;
  }
  let end = Math.min(flat.length, start + max);
  if (end < flat.length) {
    const prev = flat.lastIndexOf(" ", end);
    if (prev > start + max / 2) end = prev;
  }
  return `${start > 0 ? "…" : ""}${highlightHtml(flat.slice(start, end).trim(), terms)}${end < flat.length ? "…" : ""}`;
}

export function renderSearchResultsHtml(query, pages, articles, projects = [], customEmptyText = "", { type = "", sort = "relevance", page = 1, totalPages = null, totalCount = null, terms = [] } = {}) {
  const formHtml = `<form class="search-page-form" action="/search" method="get" role="search" aria-label="Search the site"><input type="search" name="q" value="${esc(query || "")}" placeholder="Search pages, projects and articles" aria-label="Search for"><button type="submit" class="btn">Search</button></form>`;
  if (!query) {
    return `${formHtml}<p class="empty-hint">Type what you are looking for to search pages, projects and articles.</p>`;
  }
  // Filter/sort controls are plain links (rebuilding the URL with the query
  // string intact) rather than a JS-driven form — every other listing page
  // on the site (topics, archive) already works this way with no client JS
  // needed at all, and it's just as easy to link to directly or bookmark.
  // Switching type or sort always drops back to page 1 — a page number
  // that made sense for one filter combination usually doesn't for another.
  const typeLink = (value, label) =>
    `<a href="/search?q=${encodeURIComponent(query)}${value ? `&type=${value}` : ""}${sort !== "relevance" ? `&sort=${sort}` : ""}"${
      type === value ? ' class="is-active" aria-current="true"' : ""
    }>${label}</a>`;
  const sortLink = (value, label) =>
    `<a href="/search?q=${encodeURIComponent(query)}${type ? `&type=${encodeURIComponent(type)}` : ""}${value !== "relevance" ? `&sort=${value}` : ""}"${
      sort === value ? ' class="is-active" aria-current="true"' : ""
    }>${label}</a>`;
  const filterBarHtml = `<div class="search-filter-bar">
    <span class="search-filter-group" role="group" aria-label="Type">${typeLink("", "All")} ${typeLink("page", "Pages")} ${typeLink("project", "Projects")} ${typeLink("article", "Articles")}</span>
    <span class="search-filter-group" role="group" aria-label="Sort">${sortLink("relevance", "Best match")} ${sortLink("newest", "Newest first")} ${sortLink("oldest", "Oldest first")}</span>
  </div>`;
  // Only meaningful once narrowed to one type — with all three shown at
  // once there'd be three separate page counters on one screen.
  const pageLink = (value, label, cssClass = "") =>
    `<a href="/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}${sort !== "relevance" ? `&sort=${sort}` : ""}${
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
    const tip = terms.length > 1 ? `<p class="empty-hint">Every word has to appear. Try fewer or different words, or put a few in "quotes" to look for that exact phrase.</p>` : "";
    return `${formHtml}${filterBarHtml}<p class="empty-hint">${esc(text)}</p>${tip}`;
  }
  const pageItems = pages
    .map(
      (p) =>
        `<li><a href="${p.slug === "home" ? "/" : "/" + esc(p.slug)}">${highlightHtml(p.title, terms)}</a>${
          p.meta_description ? `<p>${searchSnippetHtml(p.meta_description, terms)}</p>` : ""
        }</li>`
    )
    .join("");
  const articleItems = articles
    .map(
      (a) =>
        `<li><a href="/random/${esc(a.slug)}">${highlightHtml(a.title, terms)}</a><p>${searchSnippetHtml(a.body, terms)}</p></li>`
    )
    .join("");
  const projectItems = projects
    .map((p) => {
      // The summary reads best, unless the words were only found in the body: then show where.
      const summaryHit = p.summary && terms.some((t) => p.summary.toLowerCase().includes(t.toLowerCase()));
      const text = summaryHit || !p.body ? p.summary : p.body;
      return `<li><a href="/projects/${esc(p.slug)}">${highlightHtml(p.title, terms)}</a>${text ? `<p>${searchSnippetHtml(text, terms)}</p>` : ""}</li>`;
    })
    .join("");
  // Unfiltered "All" caps each category at 20 rows (see publicSearch()) so
  // the page doesn't render three full result sets at once — the count
  // above is now the real total regardless, but without this a visitor
  // with, say, 45 matching articles would see "45 results" yet only ever
  // find 20 of them with no clue the other 25 exist. The type filters in
  // filterBarHtml right above are the way to actually reach them.
  const shownCount = pages.length + articles.length + projects.length;
  const truncationHint =
    !type && total > shownCount
      ? `<p class="search-truncation-hint">Showing the first ${shownCount} of ${total} — narrow to one type above to see the rest.</p>`
      : "";
  return `${formHtml}${filterBarHtml}<p class="search-result-count">${total} result${total === 1 ? "" : "s"} for "${esc(query)}"</p>
${truncationHint}
${pageItems ? `<h2 class="results-heading">Pages</h2><ul class="search-results">${pageItems}</ul>` : ""}
${projectItems ? `<h2 class="results-heading">Projects</h2><ul class="search-results">${projectItems}</ul>` : ""}
${articleItems ? `<h2 class="results-heading">Articles</h2><ul class="search-results">${articleItems}</ul>` : ""}
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
${projectItems ? `<h2 class="results-heading">Projects</h2><ul class="search-results">${projectItems}</ul>` : ""}
${articleItems ? `<h2 class="results-heading">Articles</h2><ul class="search-results">${articleItems}</ul>` : ""}`;
}

export function renderArchiveHtml(archive, customEmptyText = "") {
  if (!archive.length) return `<p class="empty-hint">${esc(customEmptyText || "Nothing published yet.")}</p>`;
  return archive
    .map(({ year, items }) => {
      const rows = items
        .map((item) => {
          const href = item.type === "article" ? `/random/${esc(item.slug)}` : `/projects/${esc(item.slug)}`;
          return `<li><time datetime="${esc(item.published_at)}">${esc(displayDate(item.published_at))}</time> <a href="${href}">${esc(
            item.title
          )}</a>${item.type === "project" ? ` <span class="topic-count">project</span>` : ""}</li>`;
        })
        .join("");
      return `<h2>${esc(year)}</h2><ul class="archive-list">${rows}</ul>`;
    })
    .join("");
}

// Shared "Page N of M" links for a single-type index page (articles or
// projects) — same visual pattern as the search page's per-type pagination,
// but simpler since there's no type/sort query string to preserve.
export function renderIndexPaginationHtml(basePath, page, totalPages) {
  if (totalPages <= 1) return "";
  const link = (p, label) => `<a href="${basePath}${p > 1 ? `?page=${p}` : ""}">${label}</a>`;
  return `<div class="search-pagination">${page > 1 ? link(page - 1, "← Previous") : ""}<span>Page ${page} of ${totalPages}</span>${
    page < totalPages ? link(page + 1, "Next →") : ""
  }</div>`;
}

// These two are the actual default landing pages for a site visitor's
// primary content-discovery routes (/articles, /projects) — previously the
// weakest visual treatment in the codebase, a bare <ul class="search-results">
// (bold title + one-line excerpt, no card, no border) shared with internal
// search-result rows, while a proper card treatment (.project-card /
// .project-list) already existed and was only ever used for "related
// content" call-outs elsewhere. Reused here rather than inventing a
// near-duplicate class, plus .index-grid (index pages only — not applied to
// the narrower related-content call-outs, which read better single-column
// in a body-width column) so it flows into a responsive grid instead of
// staying single-column even at desktop widths.
export function renderArticlesIndexHtml(articles, customEmptyText = "") {
  if (!articles.length) return `<p class="empty-hint">${esc(customEmptyText || "No articles published yet.")}</p>`;
  const items = articles
    .map(
      (a) =>
        `<div class="project-card"><h2><a href="/random/${esc(a.slug)}">${esc(a.title)}</a></h2>${
          a.published_at ? `<p class="index-card-date"><time datetime="${esc(a.published_at)}">${esc(displayDate(a.published_at))}</time></p>` : ""
        }<p>${esc(excerpt(a.body, 140))}</p>${renderTags(a.tags)}</div>`
    )
    .join("\n");
  return `<div class="project-list index-grid">${items}</div>`;
}

// Finished or parked projects get a muted LED so it doesn't read as "live".
const STATUS_DONE_RE = /complete|done|finish|shipped|retired|archiv|paused|abandon|on hold/i;

export function renderProjectsIndexHtml(projects, customEmptyText = "") {
  if (!projects.length) return `<p class="empty-hint">${esc(customEmptyText || "No projects published yet.")}</p>`;
  const items = projects
    .map(
      (p) =>
        `<div class="project-card"><h2><a href="/projects/${esc(p.slug)}">${esc(p.title)}</a></h2>${
          visibleText(p.status) ? `<p class="card-status"><span class="status-led${STATUS_DONE_RE.test(visibleText(p.status)) ? " status-led-quiet" : ""}" aria-hidden="true"></span>${esc(visibleText(p.status))}</p>` : ""
        }${p.summary ? `<p>${esc(p.summary)}</p>` : ""
        }${renderTags(p.tags)}</div>`
    )
    .join("\n");
  return `<div class="project-list index-grid">${items}</div>`;
}

// One-line "currently building" call-out from the newest journal entry.
export function renderBuildingStripHtml(entry) {
  if (!entry) return "";
  const title = visibleText(entry.title) || excerpt(entry.body || "", 80);
  if (!title) return "";
  return `<a class="building-strip" href="/projects/${esc(entry.project_slug)}"><span class="building-strip-label"><span class="status-led" aria-hidden="true"></span>Currently building</span><span class="building-strip-text"><strong>${esc(
    entry.project_title
  )}</strong> · ${esc(title)}</span><time datetime="${esc(entry.entry_date)}">${esc(displayDate(entry.entry_date) || entry.entry_date)}</time></a>`;
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

// Older / newer links at the end of an article or project. `kind` is "article" or "project"; `adjacent` is
// { older, newer }, each null or { title, slug } (see getAdjacentPublished).
export function renderPrevNextHtml(kind, adjacent) {
  const { older, newer } = adjacent || {};
  if (!older && !newer) return "";
  const base = kind === "project" ? "/projects/" : "/random/";
  const noun = kind === "project" ? "project" : "article";
  const link = (item, rel, label, cls) =>
    item
      ? `<a class="prev-next-link ${cls}" href="${base}${esc(item.slug)}" rel="${rel}"><span class="prev-next-label">${label}</span><span class="prev-next-title">${esc(item.title)}</span></a>`
      : "<span></span>";
  return `<nav class="prev-next" aria-label="More ${noun}s">${link(older, "prev", `← Older ${noun}`, "prev-next-older")}${link(newer, "next", `Newer ${noun} →`, "prev-next-newer")}</nav>`;
}

export function renderRelatedArticlesHtml(articles) {
  if (!articles || !articles.length) return "";
  const items = articles
    .map(
      (a) =>
        `<article class="thought"><time datetime="${esc(a.published_at)}">${esc(
          displayDate(a.published_at)
        )}</time><h2><a href="/random/${esc(a.slug)}">${esc(a.title)}</a></h2>${renderTags(a.tags)}</article>`
    )
    .join("\n");
  return `<div class="related-posts"><strong>More to read</strong><div class="thought-list">${items}</div></div>`;
}

const JOURNAL_TYPE_LABELS = { log: "Log", test: "Test result", decision: "Decision", failed: "Failed attempt" };

export function renderJournalHtml(entries, media = null) {
  if (!entries || !entries.length) return "";
  const items = entries
    .map(
      (j) =>
        `<div class="journal-entry" data-entry-type="${esc(j.entry_type || "log")}"><div class="journal-entry-meta"><span class="journal-entry-type">${esc(
          JOURNAL_TYPE_LABELS[j.entry_type] || "Log"
        )}</span><time datetime="${esc(j.entry_date)}">${esc(j.entry_date)}</time></div>${
          j.title ? `<h3>${esc(j.title)}</h3>` : ""
        }${paragraphsHtml(j.body || "", { media })}</div>`
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
    ${articleItems ? `<h3 class="results-heading">Articles</h3><ul class="search-results">${articleItems}</ul>` : ""}
    ${simItems ? `<h3 class="results-heading">Simulations</h3><ul class="search-results">${simItems}</ul>` : ""}
    ${scanItems ? `<h3>3D scans</h3><ul class="search-results">${scanItems}</ul>` : ""}
  </div>`;
}

// Songs a project features: each is the same playable embed a Song block renders.
export function renderRelatedSongsHtml(songs) {
  if (!songs || !songs.length) return "";
  return `<div class="related-posts" role="group" aria-label="Tracks"><strong>Tracks</strong>${songs.map((s) => renderSongBlockHtml(s)).join("")}</div>`;
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

export function renderNotFoundHtml(navItems, recentArticles = [], suggestion = null) {
  const links = navItems
    .map((n) => `<li><a href="${n.slug === "home" ? "/" : "/" + esc(n.slug)}">${esc(n.nav_label)}</a></li>`)
    .join("");
  const recentHtml = recentArticles.length
    ? `<h2 class="not-found-heading">Recent posts</h2><ul class="search-results">${recentArticles
        .map((a) => `<li><a href="/random/${esc(a.slug)}">${esc(a.title)}</a></li>`)
        .join("")}</ul>`
    : "";
  return `<svg class="not-found-trace" viewBox="0 0 240 40" width="240" height="40" aria-hidden="true" focusable="false"><path d="M4 20h92M144 20h92" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="104" cy="20" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="136" cy="20" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M112 12l16 16" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/></svg>
<p class="not-found-code" aria-hidden="true">Error 404</p>
<h1>Page not found</h1>
<p>Whatever you were looking for isn't here — it may have moved or never existed.</p>
${suggestion ? `<p class="not-found-suggest">Did you mean <a href="${esc(suggestion.path)}">${esc(suggestion.label || suggestion.path)}</a>?</p>` : ""}
<form class="not-found-search" action="/search" method="get" role="search" aria-label="Search for another page">
  <input type="search" name="q" placeholder="Search the site" aria-label="Search">
  <button type="submit">Search</button>
</form>
${links ? `<h2 class="not-found-heading">Try one of these instead</h2><ul class="search-results">${links}</ul>` : ""}
${recentHtml}
<p><a href="/archive">Browse the full archive →</a></p>`;
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
// On a password-protected page, for the signed-in owner only: they always see the real page (so editing never needs the password),
// which is easy to mistake for the protection not working. Same look as the draft banner above.
export function renderProtectedPageBannerHtml() {
  return `<div class="preview-banner">This page is password protected. You're signed in, so you see it without the password; open it in a private window to see what visitors see.</div>`;
}

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
  // The uploaded custom font's actual name/URL are only known at request
  // time (see renderShell's customFontFace), not here — this just points
  // at the CSS variable that @font-face rule defines, with a plain
  // sans-serif fallback for any page where no custom font is configured.
  custom: `var(--custom-font-family, sans-serif)`,
};

// Turns a block's { color, bg, fontFamily, fontSize, borderRadius,
// borderColor, borderWidth } into a safe inline style string. Values are
// escaped/coerced rather than trusted verbatim, since they end up inside an
// HTML attribute.
// A cleared setting is stored as null (or ""), and Number(null) is 0, which would
// read as a real 0 (opacity 0 makes the block vanish). Blank counts as "not set".
const styleNum = (v) => (v === null || v === undefined || (typeof v === "string" && !v.trim()) ? NaN : Number(v));

function blockStyleAttr(style) {
  if (!style) return "";
  const parts = [];
  if (style.color) parts.push(`color:${esc(style.color)}`);
  if (style.bg) parts.push(`background:${esc(style.bg)}`);
  if (style.fontFamily && FONT_STACKS[style.fontFamily]) parts.push(`font-family:${FONT_STACKS[style.fontFamily]}`);
  const fontSize = Number(style.fontSize);
  if (Number.isFinite(fontSize) && fontSize > 0) parts.push(`font-size:${fontSize}px`);
  if (["left", "center", "right", "justify"].includes(style.textAlign)) parts.push(`text-align:${style.textAlign}`);
  const padding = styleNum(style.padding);
  if (Number.isFinite(padding) && padding >= 0) parts.push(`padding:${padding}px`);
  // Design-token choices: a padding step (--space-1..6) applies when no exact pixel padding is set,
  // and a shadow (--shadow-sm|md|lg). Both follow Site Settings > Spacing scale / Shadow strength.
  else if (/^[1-6]$/.test(String(style.paddingStep ?? ""))) parts.push(`padding:var(--space-${style.paddingStep})`);
  if (["sm", "md", "lg"].includes(style.shadow)) parts.push(`box-shadow:var(--shadow-${style.shadow})`);
  const opacity = styleNum(style.opacity);
  if (Number.isFinite(opacity) && opacity >= 0 && opacity <= 100) parts.push(`opacity:${opacity / 100}`);
  const borderRadius = styleNum(style.borderRadius);
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
  const gradientAngle = Number.isFinite(styleNum(style.gradientAngle)) ? Number(style.gradientAngle) : 135;
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
    const offset = styleNum(style.stickyOffset);
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
  const mobileColSpan = Number(style.mobileColSpan);
  if (Number.isInteger(mobileColSpan) && mobileColSpan >= 1 && mobileColSpan <= 24) {
    parts.push(`--mobile-col-span:${mobileColSpan}`);
  }
  return parts.length ? parts.join(";") + ";" : "";
}

// Site Settings > Appearance > "Buttons & controls". Each setting is a
// named preset rather than a free-form number so every combination stays
// coherent; a missing/unknown value leaves style.css's own default alone.
// Mirrored in public/admin/app.js (ADMIN_CONTROL_PRESETS) so the admin's
// own buttons and the live preview follow the same choice.
export const CONTROL_PRESETS = {
  control_shape: {
    chunky: { "--control-radius": "14px", "--btn-radius": "14px" },
    pill: { "--control-radius": "999px", "--btn-radius": "999px" },
    rounded: { "--control-radius": "12px", "--btn-radius": "12px" },
    soft: { "--control-radius": "6px", "--btn-radius": "6px" },
    square: { "--control-radius": "0px", "--btn-radius": "0px" },
  },
  control_size: {
    compact: { "--control-pad-y": "0.45em", "--control-pad-x": "0.95em" },
    regular: { "--control-pad-y": "0.6em", "--control-pad-x": "1.25em" },
    roomy: { "--control-pad-y": "0.8em", "--control-pad-x": "1.6em" },
  },
  control_outline: {
    chunky: { "--control-border-width": "1px", "--btn-border-width": "3px", "--btn-shadow": "0 5px 0 var(--btn-ink)", "--btn-shadow-sm": "0 3px 0 var(--btn-ink)" },
    thin: { "--control-border-width": "1px", "--btn-border-width": "1px", "--btn-shadow": "none", "--btn-shadow-sm": "none" },
    bold: { "--control-border-width": "2px", "--btn-border-width": "2px", "--btn-shadow": "none", "--btn-shadow-sm": "none" },
  },
  field_shape: {
    chunky: { "--field-radius": "12px", "--field-border-width": "3px" },
    rounded: { "--field-radius": "12px", "--field-border-width": "1px" },
    soft: { "--field-radius": "8px", "--field-border-width": "1px" },
    square: { "--field-radius": "2px", "--field-border-width": "1px" },
  },
  card_shape: {
    round: { "--card-radius": "22px" },
    rounded: { "--card-radius": "14px" },
    soft: { "--card-radius": "8px" },
    square: { "--card-radius": "2px" },
  },
  // Spacing and shadow design tokens. The first option of each is style.css's own default.
  space_scale: {
    compact: { "--space-1": "4px", "--space-2": "8px", "--space-3": "12px", "--space-4": "16px", "--space-5": "24px", "--space-6": "32px" },
    roomy: { "--space-1": "6px", "--space-2": "12px", "--space-3": "18px", "--space-4": "24px", "--space-5": "36px", "--space-6": "48px" },
  },
  shadow_strength: {
    soft: {
      "--shadow-sm": "0 1px 2px rgba(0,0,0,0.18)",
      "--shadow-md": "0 4px 12px rgba(0,0,0,0.22)",
      "--shadow-lg": "0 12px 32px rgba(0,0,0,0.28)",
    },
    strong: {
      "--shadow-sm": "0 2px 4px rgba(0,0,0,0.32)",
      "--shadow-md": "0 8px 20px rgba(0,0,0,0.4)",
      "--shadow-lg": "0 18px 44px rgba(0,0,0,0.5)",
    },
  },
};

export function controlVars(theme) {
  const out = [];
  for (const [key, options] of Object.entries(CONTROL_PRESETS)) {
    const vars = options[theme[key]];
    if (vars) for (const [name, value] of Object.entries(vars)) out.push(`${name}:${value}`);
  }
  return out;
}

// Near-black or white text for a given background hex, whichever has the
// higher WCAG contrast -- so a custom accent that's dark (a deep blue)
// doesn't end up with the default near-black label on it.
// WCAG contrast between two #rrggbb colors.
function contrastRatio(a, b) {
  const lum = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    const lin = (c) => {
      const v = parseInt(c, 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, bl] = [m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6)].map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The saved accent, darkened in small steps toward black until it reads
// as text on the light theme's background (WCAG AA, 4.5:1) -- so light
// mode keeps the site's own hue instead of switching to a fixed palette.
export function accentForLightTheme(hex, bg = "#fffaf5") {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return null;
  const rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  for (let t = 0; t <= 1.0001; t += 0.04) {
    const c = "#" + rgb.map((v) => Math.round(v * (1 - t)).toString(16).padStart(2, "0")).join("");
    if (contrastRatio(c, bg) >= 4.5) return c;
  }
  return "#000000";
}

function readableOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return "#0c0a16";
  const lin = (c) => {
    const v = parseInt(c, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6)].map(lin);
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const vsDark = (L + 0.05) / (0.0045 + 0.05);
  const vsWhite = 1.05 / (L + 0.05);
  return vsDark >= vsWhite ? "#0c0a16" : "#ffffff";
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
  const pct = styleNum(opacityPercent); // a cleared value means the 50% default, not 0
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
    if (m) return { type: "iframe", src: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`, height: 400, host };
  }
  if (host === "open.spotify.com") {
    const m = u.pathname.match(/^\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/);
    if (m) return { type: "iframe", src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: m[1] === "track" ? 152 : 352, host };
  }
  if (host === "figma.com") {
    return { type: "iframe", src: `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(rawUrl)}`, height: 450, host };
  }
  if (host === "codesandbox.io") {
    const m = u.pathname.match(/\/s\/([^/?]+)/);
    if (m) return { type: "iframe", src: `https://codesandbox.io/embed/${m[1]}`, height: 500, host };
  }
  if (host === "gist.github.com") {
    const m = u.pathname.match(/^\/([^/]+)\/(\w+)/);
    if (m) return { type: "script", src: `https://gist.github.com/${m[1]}/${m[2]}.js` };
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  return { type: "iframe", src: rawUrl, height: 400, host };
}

function genericEmbedHtml(rawUrl) {
  const info = genericEmbedInfo(rawUrl);
  if (!info) return rawUrl ? `<p class="empty-hint">Couldn't figure out how to embed that link.</p>` : `<p class="empty-hint">No embed URL yet.</p>`;
  if (info.type === "script") {
    return `<div class="generic-embed"><script src="${esc(info.src)}"></script></div>`;
  }
  return `<div class="generic-embed"><iframe src="${esc(info.src)}" title="Embedded content from ${esc(
    info.host
  )}" loading="lazy" style="height:${info.height}px" allow="autoplay; encrypted-media; fullscreen; clipboard-write" allowfullscreen></iframe><p class="embed-fallback"><a href="${esc(
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
// Whitelisted rather than interpolated directly -- song.data rides through
// this render path from arbitrary stored/imported JSON, and a class name
// built from an unvalidated string is exactly the kind of thing this
// codebase has been bitten by before for other free-text component fields.
const SONG_THEME_CLASSES = new Set(["sunset", "ocean", "mono", "neon"]);
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
  const theme = song.data && song.data.theme;
  const themeClass = SONG_THEME_CLASSES.has(theme) ? ` song-theme-${theme}` : "";
  // private_notes (see defaultSongData() in song-builder.js) is admin-only
  // production commentary, not playback data -- every other key in `data`
  // drives the public player and belongs in this attribute, but that one
  // never should. Stripped here, not just left out of the admin UI,
  // because this is the one path song data actually reaches a visitor's
  // browser (as a raw JSON blob in a data attribute, readable via "View
  // Source" by anyone, not just through the rendered page).
  const { private_notes, ...publicSongData } = song.data || {};
  return `<div class="song-embed${themeClass}" data-song="${esc(JSON.stringify(publicSongData))}">
    <div class="song-embed-header"><strong>${esc(song.name)}</strong><button type="button" class="song-embed-play-btn" aria-label="Play ${esc(song.name)}"><span aria-hidden="true">▶&#xFE0E;</span> Play</button></div>
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

// Emits width/height attributes for an internal media upload, when its
// dimensions were captured at upload time -- the standard fix for a
// late-loading image shifting the surrounding page layout, since the
// browser can reserve the right amount of space before the file even
// starts loading. Returns "" (not just for external URLs, but also for
// an internal one with no recorded dimensions -- an upload from before
// this existed, or a format/file the header parser couldn't read) so a
// missing size attribute never renders as `width="null"` or similar.
// Share-card and structured-data image URLs must be absolute -- Facebook,
// LinkedIn, X and Google all ignore a relative og:image, and uploads are
// stored as site-relative "/media/..." paths, so every share preview on
// the site had no image.
export function absoluteUrl(url) {
  const u = String(url || "");
  if (!u || /^https?:\/\//i.test(u)) return u;
  return `https://dominickdominick.com${u.startsWith("/") ? "" : "/"}${u}`;
}

export async function imgSizeAttrs(env, imgUrl) {
  if (typeof imgUrl !== "string") return "";
  let url;
  try {
    url = new URL(imgUrl, "https://dominickdominick.com");
  } catch {
    return "";
  }
  // Relative media-library URLs and absolute URLs for this site can both
  // refer to a known upload. Ignore foreign origins rather than guessing at
  // metadata for a different image with the same path.
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["dominickdominick.com", "www.dominickdominick.com"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password
  ) return "";
  const match = url.pathname.match(/^\/media\/(uploads\/[A-Za-z0-9_.\-\/]+)$/);
  if (!match) return "";
  const meta = await getMediaMeta(env, [match[1]]);
  const row = meta[match[1]];
  if (!row || !row.width || !row.height) return "";
  return ` width="${row.width}" height="${row.height}"`;
}

// The interactive circuit shown by a Simulation block and by `::sim 148::` in a text: `uid` is the SVG's id (the power buttons point
// at it, so it must be unique on the page).
const simSvgCache = new WeakMap();
// A circuit with its Power on / Schematic view buttons, a line that shows the readings of the part a visitor taps, and (unless the
// placement gave its own description) a plain-language description of what is in it for screen readers. `describe` adds the visible
// "About this circuit" list, for the circuit's own page.
export function simulationEmbedHtml(sim, uid, description, { about = false } = {}) {
  // The same circuit embedded several times is drawn once per request; each copy only gets its own id.
  let cached = simSvgCache.get(sim);
  if (!cached) {
    cached = { svg: renderSimulationSvg(sim.data), summary: describeSimulation(sim.data) };
    simSvgCache.set(sim, cached);
  }
  const { svg: drawn, summary } = cached;
  // The SVG itself is a visual circuit diagram with no inherent text equivalent: an explicit description from the placement wins,
  // otherwise the generated one is used. It is a group, not an image, because the parts inside can be focused and asked for readings.
  const text = description || summary.sentence;
  const descId = `${uid}-desc`;
  const svg = drawn.replace(
    'class="sim-svg"',
    `class="sim-svg" id="${esc(uid)}" role="group" aria-label="${esc(sim.name || "Circuit simulation")}" aria-describedby="${esc(descId)}"`
  );
  const descHtml = `<p id="${esc(descId)}" class="sr-only">${esc(text)}</p>`;
  // The buttons are described by the circuit they drive (its name), so several "Power on" buttons on a page can be told apart.
  const aboutHtml = about
    ? `<section class="sim-about" aria-labelledby="${esc(uid)}-about-h"><h2 id="${esc(uid)}-about-h">About this circuit</h2><p>${esc(summary.sentence)}</p><ul>${summary.items
        .slice(0, 40)
        .map((item) =>
          // Each part is also a button that shows its readings (the drawing's parts are tiny on a phone).
          item.id != null ? `<li><button type="button" class="sim-about-part" data-part="${esc(item.id)}" data-target="${esc(uid)}">${esc(item.text)}</button></li>` : `<li>${esc(item.text)}</li>`
        )
        .join("")}</ul></section>`
    : "";
  return `<div class="sim-block-wrap">${descHtml}${svg}<div class="sim-block-actions"><button type="button" class="sim-power-btn" data-target="${esc(
    uid
  )}" aria-describedby="${esc(uid)}">Power on</button><button type="button" class="sim-power-btn sim-view-btn" aria-pressed="false" data-target="${esc(
    uid
  )}" aria-describedby="${esc(uid)}">Schematic view</button></div><p class="sim-readout" role="status" aria-live="polite" data-hint="Tap or press a part to see its readings.">Tap or press a part to see its readings.</p>${aboutHtml}${renderLogicGateTables(sim.data, uid, { open: about })}</div>`;
}

async function renderBlockInner(env, block, ctx) {
  const c = block.content || {};
  switch (block.type) {
    case "heading": {
      const lvl = headingLevel(c);
      return `<h${lvl}>${esc(c.text)}</h${lvl}>`;
    }
    case "text":
      return paragraphsHtml(c.text, { media: await loadBodyMedia(env, c.text) });
    case "image": {
      // An unset image used to emit <img src=""> -- a broken-image icon.
      if (!c.url) return `<p class="empty-hint">No image chosen yet.</p>`;
      // The first picture on a page is usually the first thing a reader sees: the browser fetches it at once, at high priority,
      // instead of waiting to find out it is on screen (the checks run before any await, so this follows the page's block order).
      const firstImage = !!ctx && !ctx.firstImageSeen;
      if (ctx) ctx.firstImageSeen = true;
      const rawImg = `<img class="block-image" src="${esc(c.url)}" alt="${esc(c.alt)}" ${firstImage ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'}${await imgSizeAttrs(env, c.url)} style="max-width:100%;border-radius:12px;">`;
      const img = c.frame === "browser"
        ? `<div class="device-frame device-frame-browser"><div class="device-frame-bar"><span></span><span></span><span></span></div><div class="device-frame-body">${rawImg}</div></div>`
        : c.frame === "phone"
        ? `<div class="device-frame device-frame-phone"><div class="device-frame-notch"></div><div class="device-frame-body">${rawImg}</div></div>`
        : rawImg;
      if (!c.caption && !c.credit) return img;
      const creditHtml = c.credit ? ` <cite>${esc(c.credit)}</cite>` : "";
      return `<figure class="image-figure">${img}<figcaption>${esc(c.caption || "")}${creditHtml}</figcaption></figure>`;
    }
    case "button": {
      if (!c.label || !c.url) return `<p class="empty-hint">Button needs a label and a link.</p>`;
      const variantClass = c.variant === "secondary" ? " btn-secondary" : c.variant === "link" ? " btn-link" : "";
      return `<a class="btn${variantClass}" href="${esc(safeHref(c.url))}"${c.external ? ' target="_blank" rel="noopener"' : ""}${
        c.trackEvent ? ` data-track-event="${esc(c.trackEvent)}"` : ""
      }>${esc(c.label)}${c.external ? `<span class="btn-external-icon" aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span>` : ""}</a>`;
    }
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
            `<div class="changelog-item">${e.date ? `<time datetime="${esc(e.date)}">${esc(displayDate(e.date) || e.date)}</time>` : ""}${
              e.title ? `<h3>${esc(e.title)}</h3>` : ""
            }${e.description ? `<p>${esc(e.description)}</p>` : ""}</div>`
        )
        .join("")}</div>`;
    }
    case "accordion": {
      const items = Array.isArray(c.items) ? c.items.filter((it) => it && (it.title || it.body)) : [];
      if (!items.length) return `<p class="empty-hint">No items yet.</p>`;
      const media = await loadBodyMedia(env, items.map((it) => it.body || ""));
      // <details>/<summary> is native, keyboard- and screen-reader-accessible
      // expand/collapse with zero JS needed.
      return `<div class="accordion">${items
        .map(
          (it) =>
            `<details class="accordion-item"><summary>${esc(it.title || "Untitled")}</summary><div class="accordion-body">${paragraphsHtml(
              it.body || "",
              { media }
            )}</div></details>`
        )
        .join("")}</div>`;
    }
    case "tabs": {
      const items = Array.isArray(c.tabs) ? c.tabs.filter((it) => it && (it.label || it.body)) : [];
      if (!items.length) return `<p class="empty-hint">No tabs yet.</p>`;
      const media = await loadBodyMedia(env, items.map((it) => it.body || ""));
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
            }>${paragraphsHtml(it.body || "", { media })}</div>`
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
      if (!embed) return c.url ? `<p class="empty-hint">Unsupported video link — use a YouTube or Vimeo URL.</p>` : `<p class="empty-hint">No video link yet.</p>`;
      // There's no title/caption field on this block to draw a real title
      // from — naming the platform is the best available fallback for
      // giving the iframe a non-empty accessible name.
      const videoTitle = embed.includes("youtube") ? "Embedded YouTube video" : embed.includes("vimeo") ? "Embedded Vimeo video" : "Embedded video";
      return `<div class="video-embed"><iframe src="${esc(embed)}" title="${esc(
        videoTitle
      )}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
    }
    case "quote":
      return `<blockquote class="block-quote${c.large ? " block-quote-large" : ""}">${paragraphsHtml(c.text, { media: await loadBodyMedia(env, c.text) })}${c.cite ? `<footer>${esc(c.cite)}</footer>` : ""}</blockquote>`;
    case "embed":
      return genericEmbedHtml(c.url);
    // STUDY (temporary): just a button; the password and the study page are never in the page.
    case "study":
      return renderStudyBlock(c, block.id, esc);
    case "gallery": {
      // Each entry is either a bare URL string (older galleries, and any
      // newly-appended image before its alt text is filled in) or a
      // {url, alt} object — normalize both to give every <img> a real alt
      // attribute when one's been provided.
      const images = Array.isArray(c.images)
        ? c.images.map((img) => (typeof img === "string" ? { url: img, alt: "" } : img)).filter((img) => img && img.url)
        : [];
      if (!images.length) return `<p class="empty-hint">No images yet.</p>`;
      // Dimensions from the media table (same as the single-image block)
      // so the gallery reserves its space before the images arrive instead
      // of shifting everything below it as each one loads.
      const sized = await Promise.all(images.map(async (img) => ({ img, attrs: await imgSizeAttrs(env, img.url) })));
      return `<div class="gallery">${sized
        .map(({ img, attrs }) => `<img src="${esc(img.url)}" alt="${esc(img.alt || "")}" loading="lazy"${attrs}>`)
        .join("")}</div>`;
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
      // Only the published snapshot is ever public: a draft simulation (never published, or unpublished since) stays
      // hidden here exactly as it does on its own page and in a project's Related list.
      const sim = await getPublishedSimulation(env, c.simulation_id);
      // A deleted or unpublished simulation is a broken reference, not something a real
      // visitor should ever see an error about — the whole block is
      // skipped (see renderBlocks' null check) rather than showing an
      // "X not found" message and still reserving its grid space.
      if (!sim) return null;
      return simulationEmbedHtml(sim, `sim-${block.id}`, c.description);
    }
    case "scan": {
      if (!c.scan_id) return `<p class="empty-hint">No 3D scan selected.</p>`;
      const scan = await getScan(env, c.scan_id);
      if (!scan) return null;
      return modelViewerHtml(scan, c.description);
    }
    case "song": {
      if (!c.song_id) return `<p class="empty-hint">No song selected.</p>`;
      const song = await getSong(env, c.song_id);
      if (!song) return null;
      return renderSongBlockHtml(song);
    }
    case "project-card":
      // The palette's default ("Project", no description, no link) is a
      // placeholder, not content -- the live homepage shipped one as-is.
      if (!c.url && !c.description) return `<p class="empty-hint">Project card not filled in yet.</p>`;
      return `<div class="project-card${c.url ? " project-card-linked" : ""}"><h2>${esc(c.title)}</h2>${c.description ? `<p>${esc(c.description)}</p>` : ""}${
        c.url
          ? `<a class="project-card-link" href="${esc(safeHref(c.url))}"${c.external ? ' target="_blank" rel="noopener"' : ""}>${esc(c.label || "View project")}<span aria-hidden="true"> →</span></a>`
          : ""
      }</div>`;
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
            }<time datetime="${esc(a.published_at)}">${esc(displayDate(a.published_at))}</time><h2><a href="/random/${esc(a.slug)}">${esc(
              a.title
            )}</a></h2>${a.body ? `<p class="thought-excerpt">${esc(excerpt(a.body, 150))}</p>` : ""}${renderTags(a.tags)}</article>`
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
function isBlockInDateWindow(style, env) {
  if (!style) return true;
  const now = nowIso(env);
  if (style.visibleFrom && style.visibleFrom > now) return false;
  if (style.visibleUntil && style.visibleUntil <= now) return false;
  return true;
}

// URL-conditional visibility: "show only when the address has ?name=value" (or
// "hide when it does"), for campaign links and the like. Like the date window it
// is a real server-side filter, so a hidden block never ships in the HTML. The
// rule text is `name` (the parameter just has to be present) or `name=value`,
// matched exactly (case-sensitive). A leading "?" and spaces around the name and
// "=" are forgiven. A rule that still can't be read fails CLOSED for "show" (the
// block stays hidden rather than going public by accident) and open for "hide".
export function parseUrlRule(raw) {
  const text = String(raw || "").trim().replace(/^\?/, "").trim();
  const m = text.match(/^([A-Za-z0-9_.-]{1,40})\s*(?:=\s*([^&#\s]{0,80}))?$/);
  return m ? { name: m[1], value: m[2] } : null;
}
function isBlockUrlAllowed(style, query) {
  if (!style || (style.urlRule !== "show" && style.urlRule !== "hide") || !query) return true;
  const rule = parseUrlRule(style.urlParam);
  if (!rule) return style.urlRule !== "show";
  const has = rule.value === undefined ? query.has(rule.name) : query.getAll(rule.name).includes(rule.value);
  return style.urlRule === "show" ? has : !has;
}

// Whether a block is part of the page a visitor gets: not switched off, inside its
// date window, and allowed by its address rule. Everything built from a page's
// blocks (the rendered body, the meta description) must use this, so hidden text
// never ships in any form.
export function isBlockShown(b, query, env) {
  return !(b.style && b.style.hidden) && isBlockInDateWindow(b.style, env) && isBlockUrlAllowed(b.style, query);
}

// A fixed easing name/keyword set, not a raw admin-typed cubic-bezier
// string — same "constrained, GUI-safe" reasoning as customKeyframes'
// property set below: keeps codegen trivially safe to emit with no
// escaping/validation of arbitrary CSS syntax, and keeps the admin UI a
// dropdown instead of a place to paste broken CSS.
const CUSTOM_ANIMATION_EASINGS = {
  linear: "linear",
  ease: "ease",
  "ease-in": "ease-in",
  "ease-out": "ease-out",
  "ease-in-out": "ease-in-out",
  overshoot: "cubic-bezier(0.34, 1.56, 0.64, 1)",
};

// Builds the transform: value for one keyframe stop from its constrained
// x/y/scale/rotate fields, in a fixed translate->scale->rotate order so
// combined stops compose predictably. Returns null (omit the property
// entirely, rather than "transform: ;") when a stop sets none of them --
// most custom animations only touch opacity, or only touch transform, and
// a stop shouldn't force the other property to something it never opted
// into.
function customKeyframeTransform(stop) {
  const x = Number.isFinite(stop.x) ? stop.x : 0;
  const y = Number.isFinite(stop.y) ? stop.y : 0;
  const scale = Number.isFinite(stop.scale) ? stop.scale : 1;
  const rotate = Number.isFinite(stop.rotate) ? stop.rotate : 0;
  if (x === 0 && y === 0 && scale === 1 && rotate === 0) return null;
  return `translate(${x}px,${y}px) scale(${scale}) rotate(${rotate}deg)`;
}

// Validates + generates the @keyframes rule (and the two supporting
// selector rules that hook it into the exact same data-animate/.is-
// visible/reduced-motion mechanism the 5 fixed presets already use --
// see nav.js's IntersectionObserver and style.css's reduced-motion
// scoping, neither of which needs to change at all for this to work,
// since they only ever look at [data-animate] as a bare attribute
// selector, never caring what its value actually is) for one block's
// custom keyframe animation. Returns null on ANY malformed input (fewer
// than 2 stops, a non-numeric offset, an offset outside 0-100, an
// unrecognized easing) rather than emitting broken/partial CSS -- same
// "fail closed on bad admin-authored data" precedent withCustomJsonLd
// above already established for custom_json_ld.
// Generous for anything a human would actually build one row at a time in
// the admin's keyframe-list editor, but bounds how much @keyframes CSS one
// block can inject into every page load -- the admin UI itself has no way
// to create more than a handful quickly, but the API takes raw JSON, so
// this is a real (if low-severity, since it needs authenticated admin
// access already) size ceiling rather than trusting client-side UI limits
// alone.
const MAX_CUSTOM_KEYFRAME_STOPS = 20;

function customAnimationCss(blockId, style) {
  const stops = style.customKeyframes;
  if (!Array.isArray(stops) || stops.length < 2 || stops.length > MAX_CUSTOM_KEYFRAME_STOPS) return null;
  const easing = CUSTOM_ANIMATION_EASINGS[style.animationEasing] || CUSTOM_ANIMATION_EASINGS.ease;
  const duration = Number(style.animationDuration);
  const durationMs = Number.isFinite(duration) && duration > 0 ? duration : 600;
  const parsedStops = [];
  for (const stop of stops) {
    if (!stop || typeof stop !== "object") return null;
    const offset = Number(stop.offset);
    if (!Number.isFinite(offset) || offset < 0 || offset > 100) return null;
    parsedStops.push({ offset, opacity: Number.isFinite(stop.opacity) ? Math.max(0, Math.min(1, stop.opacity)) : null, transform: customKeyframeTransform(stop) });
  }
  const name = `block-anim-${blockId}`;
  const body = parsedStops
    .map((s) => {
      const decls = [];
      if (s.opacity !== null) decls.push(`opacity:${s.opacity}`);
      if (s.transform) decls.push(`transform:${s.transform}`);
      return decls.length ? `${s.offset}%{${decls.join(";")}}` : "";
    })
    .filter(Boolean)
    .join("");
  if (!body) return null; // every stop was empty -- nothing to actually animate
  const first = parsedStops[0];
  const initialDecls = [];
  if (first.opacity !== null) initialDecls.push(`opacity:${first.opacity}`);
  if (first.transform) initialDecls.push(`transform:${first.transform}`);
  return `@media (prefers-reduced-motion: no-preference) {
[data-animate="custom:${name}"]{${initialDecls.join(";")}}
[data-animate="custom:${name}"].is-visible{animation:${name} ${durationMs}ms ${easing} both;animation-delay:var(--animate-delay,0s);}
@keyframes ${name}{${body}}
}`;
}

export async function renderBlocks(env, blocks, ctx = {}) {
  // Collected across all blocks below and emitted once as a single
  // trailing <style> tag (one @keyframes per block that actually has a
  // valid custom animation) rather than duplicating a <style> tag per
  // block -- a <style> tag anywhere in the body is valid HTML5, so this
  // needs no changes to where renderBlocks' return value gets embedded.
  const customAnimationCssBlocks = [];
  const withInner = await Promise.all(
    blocks
      .filter((b) => isBlockShown(b, ctx.query, env))
      .map(async (b) => ({ b, inner: await renderBlockInner(env, b, ctx) }))
  );
  // The order these render in becomes DOM order, which is what a screen
  // reader and Tab both actually walk — independent of the CSS grid's
  // *visual* placement (grid-column/grid-row below). blocks arrives here
  // already sorted by row/col (see listBlocks() in db.js), which tracks
  // visual reading order well for straightforward layouts, but a block's
  // "Reading order override" style field (a plain number, blank = use the
  // natural row/col position) lets an admin fix the rare case where it
  // doesn't — a decorative block visually first but logically less
  // important, or a layout where the intended reading order genuinely
  // isn't top-to-bottom/left-to-right. Un-overridden blocks get synthetic
  // keys spaced 1000 apart in their existing order, so an override value
  // just needs to land in the right gap (e.g. 1500 to slot between the
  // 1st and 2nd block) rather than needing to renumber everything else.
  const keyed = withInner.map((item, i) => {
    // The raw style value, not Number(raw), decides whether an override is
    // present — a cleared field saves as `null` (see fieldValue() in
    // public/admin/app.js), and Number(null) is 0, a perfectly valid real
    // override, so coercing first made "cleared" indistinguishable from
    // "explicitly set to 0" and silently stuck the block at the front
    // forever with no way back to natural order.
    const raw = (item.b.style || {}).readingOrder;
    const override = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    return { item, key: override !== null ? override : (i + 1) * 1000 };
  });
  keyed.sort((a, b) => a.key - b.key);
  const visible = keyed
    .map(({ item }) => item)
    .map((item) => {
      // A block that hasn't been filled in yet (no image chosen, no song
      // selected, an empty gallery…) renders a bare "empty-hint" editor
      // placeholder. Visitors were seeing those verbatim ("No song
      // selected.") -- the live homepage showed eight of them. They're now
      // dropped for visitors entirely (along with their grid space, below)
      // and kept, clearly labelled, only for a signed-in admin.
      const trimmed = typeof item.inner === "string" ? item.inner.trim() : item.inner;
      const isPlaceholder = typeof trimmed === "string" && /^<p class="empty-hint">[^<]*<\/p>$/.test(trimmed);
      const isEmptyNonSpacer = trimmed === "" && item.b.type !== "spacer";
      if (!isPlaceholder && !isEmptyNonSpacer) return item;
      if (!ctx.isAdmin) return { ...item, inner: null };
      const text = isPlaceholder ? trimmed.replace(/^<p class="empty-hint">|<\/p>$/g, "") : `Empty ${esc(item.b.type)} block.`;
      return { ...item, inner: `<p class="empty-hint empty-hint-admin"><span class="admin-only-tag">Only visible to you</span> ${text}</p>` };
    })
    // renderBlockInner returns null (distinct from a spacer block's
    // intentional "") specifically for a simulation/scan/song block whose
    // reference no longer exists — skipped here so a visitor never sees a
    // "not found" error, and so the deleted block's grid space isn't
    // reserved as blank either.
    .filter(({ inner }) => inner !== null);
  // Rows are absolute positions from the admin canvas, so a block dragged
  // far down (the live homepage jumps from row 13 to row 84) left ~1,700px
  // of dead space, and dropping unfilled blocks above can open new gaps.
  // Any run of completely unoccupied rows longer than MAX_EMPTY_ROWS is
  // shrunk to MAX_EMPTY_ROWS; smaller deliberate gaps (and Spacer blocks,
  // which occupy their rows) are untouched.
  const MAX_EMPTY_ROWS = 2;
  const occupied = new Set();
  visible.forEach(({ b }) => {
    for (let r = b.row; r < b.row + b.row_span; r++) occupied.add(r);
  });
  const maxRow = occupied.size ? Math.max(...occupied) : 0;
  const rowMap = new Map();
  let nextRow = 1;
  let emptyRun = 0;
  for (let r = 1; r <= maxRow; r++) {
    if (occupied.has(r)) {
      emptyRun = 0;
      rowMap.set(r, nextRow++);
    } else if (++emptyRun <= MAX_EMPTY_ROWS) {
      nextRow++;
    }
  }
  const parts = visible
    .map(({ b, inner }) => ({ b: { ...b, row: rowMap.get(b.row) ?? b.row }, inner }))
    .map(({ b, inner }) => {
      // A video block's 16:9 aspect-ratio box sizes its height purely from
      // its own width, independent of the row_span the admin actually
      // assigned it — a column wide enough (relative to a short row_span)
      // could render taller than its own grid cell and visually spill
      // into whatever's positioned after it. Clipping just this block
      // type at its own boundary means a mismatched row_span crops the
      // video instead of overlapping other content — better than either
      // outcome being unpredictable. Scoped to "video" specifically
      // rather than every block, since overflow:hidden here would also
      // clip other blocks' intentional escape-the-box effects (e.g. a
      // hover-lift's shadow, a slide-in animation's start position).
      // A spacer has no content, so it is as tall as the rows it covers (16px rows and the 8px gaps between them). That was only true on a
      // wide screen: on a phone the blocks stack and an empty one had no height at all, so every spacer vanished.
      const spacerStyle = b.type === "spacer" ? `min-height:${b.row_span * 16 + (b.row_span - 1) * 8}px;` : "";
      const overflowStyle = (b.type === "video" ? "overflow:hidden;" : "") + spacerStyle;
      const gridStyle = `grid-column:${b.col} / span ${b.col_span};grid-row:${b.row} / span ${b.row_span};${overflowStyle}`;
      const style = b.style || {};
      // The scroll-triggered reveal itself (adding .is-visible) is plain
      // JS (nav.js) reacting to this attribute — see the CSS for how
      // prefers-reduced-motion disables the whole effect without any JS
      // branching, by simply never defining the animated styles at all.
      // The delay is folded into the block's single style="" attribute
      // below (a second style attribute on the same element would just
      // clobber the first, silently breaking the grid positioning).
      const hasPresetAnimation = ["fade-in", "slide-up", "slide-left", "slide-right", "zoom-in"].includes(style.animation);
      // "custom" reuses the exact same data-animate attribute + reveal
      // mechanism as the 5 fixed presets -- nav.js's observer and the
      // reduced-motion CSS scoping only ever check for the attribute's
      // PRESENCE, never inspect its value, so a custom animation needs no
      // changes to either. customAnimationCss() (defined above
      // isBlockInDateWindow) validates the stored keyframe data and
      // returns null on anything malformed, in which case this silently
      // falls back to "no animation" rather than emitting a broken
      // data-animate value with no matching CSS behind it.
      const customAnimCss = style.animation === "custom" ? customAnimationCss(b.id, style) : null;
      const hasAnimation = hasPresetAnimation || !!customAnimCss;
      const dataAnimateAttr = hasPresetAnimation ? ` data-animate="${style.animation}"` : customAnimCss ? ` data-animate="custom:block-anim-${b.id}"` : "";
      if (customAnimCss) customAnimationCssBlocks.push(customAnimCss);
      const delayMs = Number(style.animationDelay);
      const animateDelayCss = hasAnimation && Number.isFinite(delayMs) && delayMs > 0 ? `--animate-delay:${delayMs}ms;` : "";
      // Device-conditional visibility is plain CSS (a media-query class),
      // not server-side UA sniffing — same reasoning as the reduced-motion
      // approach: it works with zero JS and needs no client hint at all.
      const visibilityClass =
        style.visibility === "desktop-only" ? " block-hide-mobile" : style.visibility === "mobile-only" ? " block-hide-desktop" : "";
      const hoverClass = ["lift", "grow", "glow", "darken"].includes(style.hoverEffect) ? ` block-hover-${style.hoverEffect}` : "";
      // On mobile every block stacks full-width by default (see the
      // .block grid-column/-row overrides in the mobile media query) —
      // this class opts a specific block out of that into the partial
      // width given by --mobile-col-span above, letting e.g. two blocks
      // that should stay side-by-side on mobile do so.
      const mobileColSpanCheck = Number(style.mobileColSpan);
      const mobileOverrideClass =
        Number.isInteger(mobileColSpanCheck) && mobileColSpanCheck >= 1 && mobileColSpanCheck <= 24 ? " block-mobile-col-override" : "";
      // Only meaningful with a background image actually set — the CSS
      // rule itself (background-attachment: fixed, desktop + no-reduced-
      // motion only) is inert without one, but skipping the class here too
      // means an admin who enables this before picking an image sees
      // nothing silently break instead of just doing nothing.
      const parallaxClass = style.parallax && style.backgroundImage ? " block-parallax" : "";
      // A background video (or an image with a tint overlay) needs real
      // stacked elements — there's no CSS property that overlays a color
      // on a <video>, and layering it into background-image would only
      // work for the image case. The plain, by-far-most-common case (no
      // video, no overlay) keeps the exact same simple markup as before.
      // A plain internal integer id, already visible elsewhere (revision
      // snapshots, the activity log) — exposing it here isn't a new
      // information leak, and it's what lets the admin's own Diagnostics
      // panel (in the parent document, checking this same markup rendered
      // inside a hidden iframe) map a real-layout finding like "content
      // overflows its box" or "broken image" back to the specific block
      // that caused it, instead of just naming the problem with no way to
      // jump to it.
      if (style.backgroundVideoUrl || (style.backgroundImage && style.overlayColor)) {
        const overlayRgba = style.overlayColor ? hexToRgba(style.overlayColor, style.overlayOpacity) : null;
        return `<div class="block block-has-bg-layer${visibilityClass}${hoverClass}${mobileOverrideClass}${parallaxClass}" data-block-id="${b.id}" style="${gridStyle}${blockStyleAttr(style)}${animateDelayCss}"${dataAnimateAttr}>${
          style.backgroundVideoUrl
            ? `<video class="block-bg-video" src="${esc(style.backgroundVideoUrl)}" autoplay muted loop playsinline></video>`
            : ""
        }${overlayRgba ? `<div class="block-bg-overlay" style="background:${overlayRgba};"></div>` : ""}<div class="block-content-over-bg">${inner}</div></div>`;
      }
      return `<div class="block${visibilityClass}${hoverClass}${mobileOverrideClass}${parallaxClass}" data-block-id="${b.id}" style="${gridStyle}${blockStyleAttr(style)}${animateDelayCss}"${dataAnimateAttr}>${inner}</div>`;
    });
  const customAnimationStyleTag = customAnimationCssBlocks.length ? `<style>${customAnimationCssBlocks.join("\n")}</style>` : "";
  return customAnimationStyleTag + parts.join("\n");
}

// The raw SVG markup, exported separately so worker/index.js can serve it
// directly at /favicon.ico — browsers probe that path regardless of the
// <link rel="icon"> data-URI below, and without a real response there it's
// a 404 on every single page load.
// The "D" mark in the site's own colors (saved accent on saved background)
// rather than the built-in violet/coral, so the browser tab matches the
// theme. Falls back to the defaults for anything that isn't a plain hex.
export function faviconSvg(theme = {}) {
  const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || "") ? v : d);
  const bg = hex(theme.bg, "#0c0a16");
  const fg = hex(theme.accent, "#ff7a45");
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='${bg}'/><text x='50' y='68' font-family='Arial,sans-serif' font-size='60' font-weight='700' fill='${fg}' text-anchor='middle'>D</text></svg>`;
}

function faviconDataUri(theme) {
  return "data:image/svg+xml," + encodeURIComponent(faviconSvg(theme)).replace(/%20/g, " ").replace(/%3D/g, "=").replace(/%3A/g, ":").replace(/%2F/g, "/");
}

const FAVICON = faviconDataUri();

// A small standalone page (no stylesheet, no scripts, no database) used for the error page and for "slow down" answers. Dark by default
// like the site, and light for visitors whose system asks for it.
function noticePageHtml({ title, heading, paragraphs, robots = "noindex" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} · Dominick</title>
<meta name="robots" content="${robots}">
<link rel="icon" href="${FAVICON}">
<style>
  html, body { margin: 0; height: 100%; }
  body {
    background: #0c0a16;
    color: #f4eefc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px;
  }
  main { max-width: 480px; }
  h1 { font-size: 1.6rem; margin-bottom: 12px; }
  p { color: #b6a9d1; line-height: 1.5; }
  a { color: #ff7a45; text-decoration: none; }
  a:hover { text-decoration: underline; }
  a:focus-visible { outline: 2px solid #ff7a45; outline-offset: 3px; }
  .error-ref { font-size: 0.85rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #f4eefc; }
  @media (prefers-color-scheme: light) {
    body { background: #fffaf5; color: #241832; }
    p { color: #6e5f82; }
    a { color: #c1440e; }
    a:focus-visible { outline-color: #c1440e; }
    code { color: #241832; }
  }
</style>
</head>
<body>
  <main class="error-box">
    <h1>${heading}</h1>
${paragraphs.join("\n")}
  </main>
</body>
</html>`;
}

// The top-level fetch() catch calls this directly — deliberately fully
// self-contained (no DB reads for nav/theme/settings, no imports beyond
// what's already in this module) since it exists for the case where
// something has already gone wrong, possibly the DB itself. Inline
// styles only, so it never depends on /style.css having loaded either.
// `ref` is the short reference the failure was logged under (see worker/index.js): shown so a reader can quote it and the owner can
// find that exact entry in Diagnostics, Error log. Only plain letters and digits are ever printed.
export function renderErrorPageHtml(ref) {
  const safeRef = /^[a-z0-9]{6,16}$/.test(String(ref || "")) ? String(ref) : "";
  return noticePageHtml({
    title: "Something went wrong",
    heading: "Something went wrong",
    paragraphs: [
      `    <p>An unexpected error occurred. It's been logged — try again in a moment, or head back to the homepage.</p>${safeRef ? `\n    <p class="error-ref">Reference: <code>${safeRef}</code></p>` : ""}`,
      '    <p><a href="/">← Back to dominick.dominick</a></p>',
    ],
  });
}

// "Too many tries": the page a visitor sees when the search or a page password has been used too often in a short while.
// `what` is plain text written in the code, never from the request; `minutes` is how long to wait.
export function renderSlowDownHtml(what, minutes) {
  const wait = Math.max(1, Math.round(Number(minutes) || 1));
  return noticePageHtml({
    title: "Slow down a moment",
    heading: "Slow down a moment",
    paragraphs: [`    <p>${what} Please try again in about ${wait} minute${wait === 1 ? "" : "s"}.</p>`, '    <p><a href="/">← Back to dominick.dominick</a></p>'],
  });
}

// Inline SVG icons for the header tools -- the previous Unicode glyphs
// (⇌ ⏸ A ◐) were cryptic, and ◐ fell back to a broken half-glyph in
// common fonts. stroke="currentColor" so they follow the theme.
const svgIcon = (cls, paths) =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
const ICON = {
  shuffle: svgIcon("icon-shuffle", '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>'),
  pause: svgIcon("icon-pause", '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'),
  sun: svgIcon("icon-sun", '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'),
  moon: svgIcon("icon-moon", '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
};

// Every page used to download the simulator, song engine, song embed and
// article scripts whether or not it had any of those features. Each is
// now included only when the rendered body actually contains markup it
// drives, so a plain page ships none of them.
// The circuit drawings paint themselves with gradients and a glow defined once, by id, in their own <defs>, and the stylesheet
// refers to them by those ids. Several drawings on one page repeat the ids and the browser uses the first one in the page; if that
// first one is inside something hidden (an inactive tab, a block hidden on phones) every other drawing loses its colours. A copy in
// an always-rendered, zero-size SVG at the top of the page comes first, so it is the one used.
function simDefsHolder(bodyHtml) {
  return String(bodyHtml || "").includes('class="sim-svg"')
    ? `<svg class="sim-defs-holder" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false">${SIM_DEFS_SVG}</svg>`
    : "";
}

function pageScriptsHtml(bodyHtml) {
  const html = String(bodyHtml || "");
  const tags = [];
  if (html.includes("sim-comp-buzzer")) tags.push('<script src="/sim-buzzer.js" defer></script>');
  if (html.includes("sim-power-btn") || html.includes('class="sim-')) tags.push('<script src="/sim-player.js" defer></script>');
  if (/reading-progress|copy-link-btn|read-aloud-btn|save-for-later-btn|class="reactions|saved-items-list|<pre>/.test(html)) {
    tags.push('<script src="/article-extras.js" defer></script>');
  }
  if (html.includes("song-embed")) {
    tags.push('<script src="/song-engine.js" defer></script>', '<script src="/song-embed.js" defer></script>');
  }
  // Pictures a reader can open larger: an image block, a gallery, or a picture written into the text.
  if (/class="(?:block-image|gallery)"|body-figure|image-figure/.test(html)) tags.push('<script src="/lightbox.js" defer></script>');
  // STUDY (temporary): the popup for a Study block.
  tags.push(...studyPageTags(html));
  return tags.join("\n");
}

// The name at the top left: "dominick.dominick" unless the owner set one (Site settings > Header & footer), with each dot in the accent colour.
// The last stop of the nav dial: Search, which opens the finder.
function finderTabHtml() {
  return `<button type="button" class="tab tab-finder" id="finder-open" aria-haspopup="dialog" aria-controls="site-finder" title="Search the site and its settings (/ or Ctrl+K)">${navIconSvg("search", "Search")}<span class="tab-label">Search</span></button>`;
}
// The finder (like a Mac's Spotlight): one box that searches the site as you type and also finds the site's own settings (light or dark,
// motion, text size), its sections and a random post. The settings rows are the same buttons nav.js has always wired by id.
function finderHtml(navItems, { searchQuery = "", editUrl = null } = {}) {
  const row = (attrs, icon, label, hint, keys) =>
    `${attrs.tag === "a" ? `<a class="finder-item${attrs.cls ? " " + attrs.cls : ""}" href="${esc(attrs.href)}"${attrs.rel ? ` rel="${attrs.rel}"` : ""}` : `<button type="button" class="finder-item${attrs.cls ? " " + attrs.cls : ""}"${attrs.id ? ` id="${attrs.id}"` : ""}${attrs.pressed ? ' aria-pressed="false"' : ""}`} data-keys="${esc(keys)}">` +
    `<span class="finder-ico" aria-hidden="true">${icon}</span><span class="finder-label">${label}</span>${hint ? `<span class="finder-hint">${hint}</span>` : ""}${attrs.tag === "a" ? "</a>" : "</button>"}`;
  const pages = [];
  (navItems || []).forEach((n) => {
    pages.push(n);
    (n.children || []).forEach((c) => pages.push(c));
  });
  const goRows = pages
    .map((n) => row({ tag: "a", href: n.slug === "home" ? "/" : "/" + n.slug }, navIconSvg(n.slug, n.nav_label), esc(n.nav_label), n.admin_only ? "Only you" : "Page", `${n.nav_label} ${n.slug} page go`))
    .join("");
  return `<div class="site-finder" id="site-finder" role="dialog" aria-modal="true" aria-label="Search and settings" hidden>
      <div class="finder-backdrop" data-finder-close></div>
      <div class="finder-panel">
        <form class="site-search finder-form" action="/search" method="get" role="search" aria-label="Search the site" autocomplete="off">
          <span class="finder-glass" aria-hidden="true">${navIconSvg("search", "Search")}</span>
          <input type="search" name="q" id="finder-input" placeholder="Search, or try “dark mode”" aria-label="Search the site and its settings" value="${esc(searchQuery || "")}" aria-controls="search-suggest-list finder-list">
          <button type="button" class="finder-esc" data-finder-close aria-label="Close">esc</button>
        </form>
        <div class="finder-results">
          <div class="search-suggest finder-group" id="search-suggest-list" aria-label="Pages and posts" hidden></div>
          <div id="finder-list">
            <div class="finder-group" data-group="settings"><h2 class="finder-title">Settings</h2>
              ${row({ id: "theme-toggle" }, ICON.sun + ICON.moon, '<span class="finder-theme-dark">Dark mode</span><span class="finder-theme-light">Light mode</span>', "Theme", "dark light theme mode night day colour color appearance")}
              ${row({ id: "motion-toggle", pressed: true }, ICON.pause, "Reduce motion", '<span class="finder-state">Off</span>', "motion animation reduce calm still")}
              ${row({ id: "font-size-toggle" }, '<span class="icon-text">Aa</span>', "Text size", '<span class="finder-state">100%</span>', "text size font bigger smaller zoom read")}
            </div>
            <div class="finder-group" data-group="go"><h2 class="finder-title">Go to</h2>
              ${editUrl ? row({ tag: "a", href: editUrl, cls: "edit-this-btn" }, "✎", "Edit this page", "Admin", "edit admin change this page") : ""}
              ${row({ tag: "a", href: "/shuffle", rel: "nofollow" }, ICON.shuffle, "Surprise me", "A random post or project", "random shuffle surprise lucky")}
              ${goRows}
              ${row({ tag: "a", href: "/saved" }, navIconSvg("saved", "Saved"), "Saved for later", "In this browser", "saved bookmarks later")}
              ${row({ tag: "a", href: "/history" }, navIconSvg("history", "History"), "Reading history", "In this browser", "history read recent")}
            </div>
          </div>
          <p class="finder-empty" hidden>Nothing here by that name. Press Enter to search the whole site.</p>
        </div>
        <p class="finder-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>esc</kbd> close</span></p>
      </div>
    </div>`;
}
function brandHtml(brand) {
  const name = String(brand || "").trim();
  if (!name) return `dominick<span class="accent">.</span>dominick`;
  return esc(name).replace(/\./g, '<span class="accent">.</span>');
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
  // ' width="…" height="…"' as returned by imgSizeAttrs(), when known --
  // lets share previews reserve the image's shape before it downloads.
  ogImageSize = "",
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
  editUrl = null,
}) {
  const canonical = canonicalUrl || `https://dominickdominick.com${path}`;
  // The browser-chrome color follows the saved background instead of the
  // old built-in violet.
  const themeColorDark = /^#[0-9a-f]{6}$/i.test(theme.bg || "") ? theme.bg : "#0c0a16";
  const ogSizeMatch = /width="(\d+)" height="(\d+)"/.exec(ogImageSize || "");
  const articleTags = ogType === "article" && keywords ? String(keywords).split(",").map((t) => t.trim()).filter(Boolean) : [];
  const themeVars = [];
  if (theme.accent) themeVars.push(`--accent:${esc(theme.accent)}`);
  if (theme.bg) themeVars.push(`--bg:${esc(theme.bg)}`);
  if (theme.text) themeVars.push(`--text:${esc(theme.text)}`);
  if (theme.border) themeVars.push(`--border:${esc(theme.border)}`);
  // Only the four base colors used to follow Site Settings -- every derived
  // shade (card background, dim text, the gradient's second color, date
  // labels, text-on-accent) stayed at the built-in violet palette's fixed
  // values. With the live site's amber accent on a neutral black, that
  // meant violet-tinted cards and an amber-to-violet nav pill. They're now
  // derived from whatever was chosen, so a custom theme stays coherent.
  if (theme.accent) {
    themeVars.push("--accent-secondary:color-mix(in oklch, var(--accent), white 38%)");
    themeVars.push("--accent-dim:color-mix(in oklch, var(--accent) 78%, var(--text))");
    themeVars.push(`--on-accent:${readableOn(theme.accent)}`);
  }
  if (theme.bg || theme.text) {
    themeVars.push("--bg-elevated:color-mix(in oklch, var(--bg), var(--text) 6%)");
    themeVars.push("--text-dim:color-mix(in oklch, var(--text) 68%, var(--bg))");
    // No saved border ("Match theme" in Site Settings) = one derived from
    // the chosen colors, not style.css's built-in violet.
    if (!theme.border) themeVars.push("--border:color-mix(in oklch, var(--bg), var(--text) 16%)");
  }
  themeVars.push(...controlVars(theme));
  if (theme.font && FONT_STACKS[theme.font]) themeVars.push(`--font-family:${FONT_STACKS[theme.font]}`);
  if (theme.headingFont && FONT_STACKS[theme.headingFont]) themeVars.push(`--heading-font-family:${FONT_STACKS[theme.headingFont]}`);
  // One uploaded custom font, selectable as "Custom" alongside the fixed
  // sans/serif/mono/rounded stacks (site-wide font pickers and the
  // per-block font-family style both read from the same FONT_STACKS —
  // see blockStyleAttr above), via a CSS variable rather than a fixed
  // string, since the font's actual name/URL is only known at request
  // time (uploaded through Site Settings), not at code-definition time.
  const customFontFace =
    theme.customFontName && theme.customFontUrl
      ? `@font-face{font-family:'${esc(theme.customFontName)}';src:url('${esc(theme.customFontUrl)}');font-display:swap;}:root{--custom-font-family:'${esc(
          theme.customFontName
        )}', sans-serif;}`
      : "";
  // Light theme: the same accent hue, darkened to stay readable, with the
  // rest of the palette derived from it -- instead of the built-in
  // coral/violet, which made the site change character between themes.
  const lightAccent = theme.accent ? accentForLightTheme(theme.accent) : null;
  const lightVars = lightAccent
    ? [
        `--accent:${lightAccent}`,
        "--accent-secondary:color-mix(in oklch, var(--accent), black 22%)",
        "--accent-dim:color-mix(in oklch, var(--accent) 75%, var(--text))",
        `--on-accent:${readableOn(lightAccent)}`,
        "--text:#1d1a17",
        "--text-dim:color-mix(in oklch, var(--text) 72%, var(--bg))",
        "--bg-elevated:color-mix(in oklch, var(--bg), var(--accent) 7%)",
        "--border:color-mix(in oklch, var(--bg), var(--text) 14%)",
      ]
    : [];
  const themeStyle =
    themeVars.length || customFontFace
      ? `<style>${customFontFace}:root{${themeVars.join(";")};}${lightVars.length ? `:root[data-theme="light"]{${lightVars.join(";")};}` : ""}</style>`
      : "";
  // The mobile/desktop device-visibility breakpoint (.block-hide-mobile/
  // .block-hide-desktop in style.css) is fixed at 640px in that static
  // stylesheet. A custom value can't edit that file per-request, so this
  // overrides it with the same selectors at the custom width instead —
  // only one of the two media queries ever matches a given viewport, so
  // there's no cascade-order fight with the original rule, just whichever
  // width range actually applies.
  const breakpoint = Number(theme.mobileBreakpoint) || 640;
  // The auto-stack layout (.canvas/.block overrides in the static
  // stylesheet's mobile media query — see style.css) has the exact same
  // fixed-640px limitation as the device-visibility rule above, so a
  // custom breakpoint gets the same "reassert the same rules at the
  // custom width" treatment here.
  const breakpointStyle =
    breakpoint !== 640
      ? `<style>@media (max-width:${breakpoint}px){.block-hide-mobile{display:none !important;}.canvas{grid-auto-flow:row;grid-auto-rows:auto;row-gap:16px;}.block{grid-column:1 / -1 !important;grid-row:auto !important;}.block.block-mobile-col-override{grid-column:span var(--mobile-col-span) !important;}}@media (min-width:${
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
      const tab = `<a class="tab${n.slug === activeSlug || isChildActive ? " is-active" : ""}${n.admin_only ? " is-admin-only" : ""}" href="${tabHref}"${
        n.slug === activeSlug ? ' aria-current="page"' : ""
      }${n.admin_only ? ' title="Only you can see this link"' : ""}>${navIconSvg(n.slug, n.nav_label)}<span class="tab-label">${esc(n.nav_label)}</span>${n.admin_only ? '<span class="sr-only"> (admin-only link)</span>' : ""}</a>`;
      if (!n.children || !n.children.length) return tab;
      const childLinks = n.children
        .map(
          (c) =>
            `<a href="/${esc(c.slug)}"${c.slug === activeSlug ? ' aria-current="page" class="is-active"' : ""}${c.admin_only ? ' title="Only you can see this link" data-admin-only="1"' : ""}>${esc(c.nav_label)}${c.admin_only ? '<span class="sr-only"> (admin-only link)</span>' : ""}</a>`
        )
        .join("\n");
      // No role="menu" here — that ARIA role commits to full application-
      // menu keyboard behavior (arrow keys, Home/End, type-ahead between
      // menuitems), which nothing here implements; a screen reader user
      // who gets a "menu" announcement but only plain Tab-order behavior
      // is worse off than one who's simply told about a list of links.
      // This is the "Disclosure Navigation Menu" pattern instead: a
      // plain button (aria-expanded/aria-controls, wired up in nav.js)
      // revealing ordinary links, which normal Tab order already
      // handles correctly with no special role needed.
      const dropdownId = `nav-dropdown-${esc(n.slug)}`;
      return `<div class="tab-group">
        ${tab}
        <button type="button" class="tab-caret" aria-label="Show ${esc(n.nav_label)} submenu" aria-expanded="false" aria-controls="${dropdownId}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg></button>
        <div class="tab-dropdown" id="${dropdownId}">${childLinks}</div>
      </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="theme-color" id="theme-color-meta" content="${esc(themeColorDark)}" data-dark="${esc(themeColorDark)}">
<script>(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark")t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":null;if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);if(t==="light"){var tc=document.getElementById("theme-color-meta");if(tc)tc.setAttribute("content","#fffaf5");}if(localStorage.getItem("sim-schematic")==="1")document.documentElement.classList.add("sim-schematic-pref");if(window.top!==window)document.documentElement.classList.add("in-frame");var m=localStorage.getItem("motion");if(m==="reduce")document.documentElement.setAttribute("data-motion","reduce");var fs=parseFloat(localStorage.getItem("fontScale"));if(fs)document.documentElement.style.setProperty("--font-scale",fs);}catch(e){}})();</script>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="author" content="Dominick">
${keywords ? `<meta name="keywords" content="${esc(keywords)}">` : ""}
${noindex ? `<meta name="robots" content="noindex">` : ""}
${noindex ? "" : `<link rel="canonical" href="${esc(canonical)}">`}
<link rel="icon" href="${faviconDataUri(theme)}">

<meta property="og:type" content="${esc(ogType)}">
<meta property="og:site_name" content="Dominick">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
${ogImage ? `<meta property="og:image" content="${esc(absoluteUrl(ogImage))}">
<meta property="og:image:alt" content="${esc(title.replace(/ · Dominick$/, ""))}">` : ""}
${ogImage && ogSizeMatch ? `<meta property="og:image:width" content="${ogSizeMatch[1]}">
<meta property="og:image:height" content="${ogSizeMatch[2]}">` : ""}
${articleTags.map((t) => `<meta property="article:tag" content="${esc(t)}">`).join("\n")}
${publishedTime ? `<meta property="article:published_time" content="${esc(publishedTime)}">` : ""}
${modifiedTime ? `<meta property="article:modified_time" content="${esc(modifiedTime)}">` : ""}
<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${ogImage ? `<meta name="twitter:image" content="${esc(absoluteUrl(ogImage))}">
<meta name="twitter:image:alt" content="${esc(title.replace(/ · Dominick$/, ""))}">` : ""}
<link rel="alternate" type="application/rss+xml" title="Dominick — RSS feed" href="/rss.xml">

<link rel="stylesheet" href="/style.css">
<link rel="expect" href="#main-content" blocking="render">
<script src="/page-slide.js"></script>
${themeStyle}
${breakpointStyle}
${pageScriptsHtml(bodyHtml)}
<script>
  document.addEventListener("DOMContentLoaded", function () {
    if (document.querySelector("pre code")) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css";
      document.head.appendChild(link);
      var script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js";
      script.onload = function () { if (window.hljs) hljs.highlightAll(); };
      document.head.appendChild(script);
    }
    if (document.querySelector("model-viewer")) {
      var mv = document.createElement("script");
      mv.type = "module";
      mv.src = "https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js";
      document.head.appendChild(mv);
    }
  });
</script>
<script type="module">
  if (document.querySelector(".mermaid")) {
    import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs").then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: document.documentElement.getAttribute("data-theme") === "light" ? "default" : "dark" });
      mermaid.run();
    });
  }
</script>
<script type="module">
  if (document.querySelector(".katex-block")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
    document.head.appendChild(link);
    import("https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.mjs").then(({ default: katex }) => {
      document.querySelectorAll(".katex-block").forEach((el) => {
        try {
          katex.render(el.textContent, el, { displayMode: true, throwOnError: false });
        } catch (e) {}
      });
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
  ${simDefsHolder(bodyHtml)}<a class="skip-link" href="#main-content">Skip to content</a>
  <div class="page">
    <header class="topbar">
      <a class="brand" href="/">${brandHtml(navItems.brand)}</a>
      ${
        navItems.length
          ? `<nav class="site-nav" aria-label="Sections"><div class="tabs">
        ${navHtml}
        ${finderTabHtml()}
        <span class="tab-indicator" aria-hidden="true"></span>
      </div></nav>`
          : `<nav class="site-nav" aria-label="Sections"><div class="tabs">${finderTabHtml()}<span class="tab-indicator" aria-hidden="true"></span></div></nav>`
      }
    </header>
    ${finderHtml(navItems, { searchQuery, editUrl })}
    <script src="/nav.js"></script>

    <main class="${esc(canvasClass)}" id="main-content">
      ${bodyHtml}
    </main>
    ${footerHtml(footerText)}
  </div>
</body>
</html>`;
}
