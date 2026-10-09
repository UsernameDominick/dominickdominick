import { APP_PAGES } from "./app-pages.js";
import { getMediaMeta } from "./db.js";
import { navIconSvg, pixelIcon } from "./nav-icons.js";
import { DIAL_PRESET_SCRIPT } from "./nav-dial-script.js";
import { uiIcon } from "./ui-icons.js";
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
  const extras = `<p class="footer-extras"><button type="button" class="footer-share" data-share hidden>Share this page</button><span class="footer-share-note" role="status" aria-live="polite"></span></p>`;
  if (!body && !columns.length && !social.length) return `<footer class="site-footer"><p class="footer-mono">© ${year} Dominick</p>${extras}</footer>`;
  return `<footer class="site-footer">${colsHtml}${socialHtml}${body ? paragraphsHtml(body) : ""}${extras}</footer>`;
}

// Minimal markdown for text blocks: **bold**, *italic*, `code`, [label](url). Runs on already-HTML-escaped text, so the only unescaped
// characters left are the ones this inserts itself, which keeps it safe against breaking the surrounding markup.
function richText(escapedText) {
  // `inline code` is lifted out first, so what is inside it (stars, brackets) stays literal; it is put back as <code> at the end.
  const codeSpans = [];
  const out = escapedText
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
  return codeSpans.length ? out.replace(/\u0000CODESPAN(\d+)\u0000/g, (m, i) => `<code>${codeSpans[Number(i)]}</code>`) : out;
}

// Fenced ```lang\ncode\n``` blocks are pulled out before paragraph splitting, since code can itself contain blank lines, which would
// otherwise fragment it into several "paragraphs".
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

// A paragraph starting with "## " or "### " renders as a heading.
function headingMatch(paragraph) {
  const m = paragraph.match(/^(#{2,3})\s+(.+)$/);
  return m ? { level: m[1].length, text: m[2].trim() } : null;
}

export function paragraphsHtml(text) {
  const { replaced, blocks } = extractCodeBlocks(String(text ?? ""));
  return replaced
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => {
      const trimmed = p.trim();
      const codeMatch = trimmed.match(CODE_PLACEHOLDER);
      if (codeMatch) {
        const { lang, code } = blocks[Number(codeMatch[1])];
        return `<pre><code class="language-${esc(lang || "plaintext")}">${esc(code)}</code></pre>`;
      }
      // A paragraph that is only "---" (or "***", "___") is a divider.
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return "<hr>";
      const h = headingMatch(trimmed);
      if (h) return `<h${h.level}>${richText(esc(h.text))}</h${h.level}>`;
      // A paragraph whose every line is a list item (or quote line) renders as the real element.
      const lines = trimmed.split("\n");
      const inline = (t) => richText(esc(t));
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
      return `<p>${richText(esc(p)).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

function stripMarkdown(text) {
  return String(text ?? "")
    .replace(/\u200b/g, "") // invisible guard characters pasted content may carry
    .replace(/```(\w*)\n([\s\S]*?)```/g, "$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    // List markers, quote markers, inline code and images leaked into
    // excerpts and meta descriptions as raw syntax ("- CSS `:has()`...").
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/!\[([^\]\n]*)\]\(\s*[^\s)]+(?:\s+"[^"\n]*")?\s*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/!?\[([^\]\n]+)\]\([^)\n]+\)/g, "$1"); // one line only: an unfinished link must not swallow the text below it
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


const NOTFOUND_SVG = "<svg class=\"not-found-trace\" viewBox=\"0 0 240 40\" width=\"240\" height=\"40\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M4 20h92M144 20h92\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><circle cx=\"104\" cy=\"20\" r=\"4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/><circle cx=\"136\" cy=\"20\" r=\"4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M112 12l16 16\" stroke=\"var(--accent)\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>";
export function renderNotFoundHtml() {
  return `${NOTFOUND_SVG}
<p class="not-found-code" aria-hidden="true">Error 404</p>
<h1>Page not found</h1>
<p>Whatever you were looking for isn't here. It may have moved or never existed.</p>
<h2 class="not-found-heading">Try one of these instead</h2><ul class="search-results"><li><a href="/">home</a></li><li><a href="/studio">studio</a></li></ul>`;
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


function headingLevel(c) {
  const lvl = Number(c.level);
  return Number.isInteger(lvl) && lvl >= 1 && lvl <= 6 ? lvl : 1;
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
      }>${esc(c.label)}${c.external ? `<span class="btn-external-icon" aria-hidden="true">${uiIcon("external")}</span><span class="sr-only"> (opens in a new tab)</span>` : ""}</a>`;
    }
    case "divider":
      return `<hr>`;
    case "spacer":
      return "";
    case "quote":
      return `<blockquote class="block-quote${c.large ? " block-quote-large" : ""}">${paragraphsHtml(c.text)}${c.cite ? `<footer>${esc(c.cite)}</footer>` : ""}</blockquote>`;
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
    default:
      return "";
  }
}

// Whether a block is part of the page a visitor gets: not switched off. Everything built from a page's blocks (the rendered body, the
// meta description) must use this, so hidden text never ships in any form.
export function isBlockShown(b) {
  return !(b.style && b.style.hidden);
}

export async function renderBlocks(env, blocks, ctx = {}) {
  const withInner = await Promise.all(
    blocks
      .filter((b) => isBlockShown(b))
      .map(async (b) => ({ b, inner: await renderBlockInner(env, b, ctx) }))
  );
  // The order these render in becomes DOM order, which is what a screen reader and Tab both actually walk, independent of the CSS grid's
  // visual placement (grid-column/grid-row below). blocks arrives here already sorted by row/col (see listBlocks() in db.js), which tracks
  // visual reading order well for straightforward layouts, but a block's "Reading order override" style field (a plain number, blank = use
  // the natural row/col position) lets the owner fix the rare case where it does not. Un-overridden blocks get synthetic keys spaced 1000
  // apart in their existing order, so an override value just needs to land in the right gap.
  const keyed = withInner.map((item, i) => {
    // The raw style value, not Number(raw), decides whether an override is present: a cleared field saves as null, and Number(null) is 0,
    // a perfectly valid real override.
    const raw = (item.b.style || {}).readingOrder;
    const override = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    return { item, key: override !== null ? override : (i + 1) * 1000 };
  });
  keyed.sort((a, b) => a.key - b.key);
  const visible = keyed
    .map(({ item }) => item)
    .map((item) => {
      // A block that has not been filled in yet (no image chosen, an empty gallery) renders a bare "empty-hint" editor placeholder.
      // Visitors never see those (nor the grid space they would take); they are kept, clearly labelled, only for the signed-in owner.
      const trimmed = typeof item.inner === "string" ? item.inner.trim() : item.inner;
      const isPlaceholder = typeof trimmed === "string" && /^<p class="empty-hint">[^<]*<\/p>$/.test(trimmed);
      const isEmptyNonSpacer = trimmed === "" && item.b.type !== "spacer";
      if (!isPlaceholder && !isEmptyNonSpacer) return item;
      if (!ctx.isAdmin) return { ...item, inner: null };
      const text = isPlaceholder ? trimmed.replace(/^<p class="empty-hint">|<\/p>$/g, "") : `Empty ${esc(item.b.type)} block.`;
      return { ...item, inner: `<p class="empty-hint empty-hint-admin"><span class="admin-only-tag">Only visible to you</span> ${text}</p>` };
    })
    .filter(({ inner }) => inner !== null);
  // Rows are absolute positions from the admin canvas, so a block dragged far down leaves dead space, and dropping unfilled blocks above
  // can open new gaps. Any run of completely unoccupied rows longer than MAX_EMPTY_ROWS is shrunk to MAX_EMPTY_ROWS; smaller deliberate
  // gaps (and Spacer blocks, which occupy their rows) are untouched.
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
      // A spacer has no content, so it is as tall as the rows it covers (16px rows and the 8px gaps between them). That was only true on a
      // wide screen: on a phone the blocks stack and an empty one had no height at all, so every spacer vanished.
      const spacerStyle = b.type === "spacer" ? `min-height:${b.row_span * 16 + (b.row_span - 1) * 8}px;` : "";
      const gridStyle = `grid-column:${b.col} / span ${b.col_span};grid-row:${b.row} / span ${b.row_span};${spacerStyle}`;
      const style = b.style || {};
      // The scroll-triggered reveal itself (adding .is-visible) is plain JS (nav.js) reacting to this attribute; prefers-reduced-motion
      // disables the whole effect in CSS without any JS branching, by simply never defining the animated styles at all. The delay is folded
      // into the block's single style="" attribute below (a second style attribute on the same element would clobber the first).
      const hasAnimation = ["fade-in", "slide-up", "slide-left", "slide-right", "zoom-in"].includes(style.animation);
      const dataAnimateAttr = hasAnimation ? ` data-animate="${style.animation}"` : "";
      const delayMs = Number(style.animationDelay);
      const animateDelayCss = hasAnimation && Number.isFinite(delayMs) && delayMs > 0 ? `--animate-delay:${delayMs}ms;` : "";
      // Device-conditional visibility is plain CSS (a media-query class), not server-side UA sniffing.
      const visibilityClass =
        style.visibility === "desktop-only" ? " block-hide-mobile" : style.visibility === "mobile-only" ? " block-hide-desktop" : "";
      const hoverClass = ["lift", "grow", "glow", "darken"].includes(style.hoverEffect) ? ` block-hover-${style.hoverEffect}` : "";
      // On mobile every block stacks full-width by default; this class opts a block out of that into the partial width given by
      // --mobile-col-span, so two blocks that should stay side by side on a phone can.
      const mobileColSpanCheck = Number(style.mobileColSpan);
      const mobileOverrideClass =
        Number.isInteger(mobileColSpanCheck) && mobileColSpanCheck >= 1 && mobileColSpanCheck <= 24 ? " block-mobile-col-override" : "";
      // A plain internal integer id: it lets the admin canvas map a rendered block back to the block it came from.
      return `<div class="block${visibilityClass}${hoverClass}${mobileOverrideClass}" data-block-id="${b.id}" style="${gridStyle}${blockStyleAttr(style)}${animateDelayCss}"${dataAnimateAttr}>${inner}</div>`;
    });
  return parts.join("\n");
}

// The raw SVG markup, exported separately so worker/index.js can serve it
// directly at /favicon.ico — browsers probe that path regardless of the
// <link rel="icon"> data-URI below, and without a real response there it's
// a 404 on every single page load.
// The "D" mark in the site's own colors (saved accent on saved background)
// rather than the built-in violet/coral, so the browser tab matches the
// theme. Falls back to the defaults for anything that isn't a plain hex.
export function faviconSvg() {
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='#18161b'/><text x='50' y='68' font-family='Arial,sans-serif' font-size='60' font-weight='700' fill='#e3ded2' text-anchor='middle'>D</text></svg>`;
}

function faviconDataUri() {
  return "data:image/svg+xml," + encodeURIComponent(faviconSvg()).replace(/%20/g, " ").replace(/%3D/g, "=").replace(/%3A/g, ":").replace(/%2F/g, "/");
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
    background: #18161b;
    color: #e3ded2;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px;
  }
  main { max-width: 480px; }
  h1 { font-size: 1.6rem; margin-bottom: 12px; }
  p { color: #a39d91; line-height: 1.5; }
  a { color: #e3ded2; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px; text-decoration-color: #ff6a1a; }
  a:hover { background: #e3ded2; color: #18161b; }
  a:focus-visible { outline: 2px dotted #ff6a1a; outline-offset: 3px; }
  .error-ref { font-size: 0.85rem; }
  code { font-family: inherit; color: #e3ded2; }
  @media (prefers-color-scheme: light) {
    body { background: #f5f0e6; color: #2a2622; }
    p { color: #675f55; }
    a { color: #2a2622; }
    a:hover { background: #2a2622; color: #f5f0e6; }
    code { color: #2a2622; }
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

// Inline SVG icons for the header tools -- the previous Unicode glyphs
// (swap, pause, letter and half-circle symbols) were cryptic, and the half circle fell back to a broken half-glyph in
// common fonts. stroke="currentColor" so they follow the theme.
const ICON = {
  pause: pixelIcon("pause", "icon icon-pause"),
  sun: pixelIcon("sun", "icon icon-sun"),
  moon: pixelIcon("moon", "icon icon-moon"),
};

// Scripts a page needs only when its body holds the markup they drive, so a plain page ships none of them.
function pageScriptsHtml(bodyHtml) {
  const html = String(bodyHtml || "");
  const tags = [];
  // Pictures a reader can open larger: an image block or a gallery.
  if (/class="(?:block-image|gallery)"|body-figure|image-figure/.test(html)) tags.push('<script src="/lightbox.js" defer></script>');
  // The Studio: the kit, then the app's own script (worker/app-pages.js).
  const app = APP_PAGES.find((a) => html.includes(`id="${a.mountId}"`));
  if (app) tags.push('<script src="/app-kit.js" defer></script>', `<script src="${app.script}" defer></script>`);
  // STUDY (temporary): the popup for a Study block.
  tags.push(...studyPageTags(html));
  return tags.join("\n");
}

// The last stop of the nav dial: a magnifier, which opens the search and command dialog (Ctrl or Cmd with K).
function finderTabHtml() {
  return `<button type="button" class="tab tab-finder" id="finder-open" aria-haspopup="dialog" aria-controls="site-finder" aria-expanded="false" aria-label="Search" title="Search (Ctrl+K)">${navIconSvg("search", "Search")}<span class="tab-label">Search</span></button>`;
}
// The search and command dialog: type to filter its rows, or arrow through them. The rows are the site's own settings (light or dark, motion, text
// size) and the way to the Studio; the two study modules are not listed, they only appear when their name is typed (data-secret, data-keys).
// The settings rows are the same buttons nav.js has always wired by id.
function finderHtml({ editUrl = null } = {}) {
  const row = (attrs, icon, label, hint) =>
    `${attrs.tag === "a" ? `<a class="finder-item${attrs.cls ? " " + attrs.cls : ""}" href="${esc(attrs.href)}">` : `<button type="button" class="finder-item${attrs.cls ? " " + attrs.cls : ""}"${attrs.id ? ` id="${attrs.id}"` : ""}${attrs.pressed ? ' aria-pressed="false"' : ""}>`}` +
    `<span class="finder-ico" aria-hidden="true">${icon}</span><span class="finder-label">${label}</span>${hint ? `<span class="finder-hint">${hint}</span>` : ""}${attrs.tag === "a" ? "</a>" : "</button>"}`;
  const goRows = NAV_PAGES.map((n) => row({ tag: "a", href: n.href }, navIconSvg(n.slug, n.label), esc(n.label), "Page")).join("");
  // STUDY (temporary): the two study modules. Hidden until their name is typed; pressing one opens the study popup (public/study/study.js), which asks for
  // the password.
  const studyRow = (lab, label, keys) =>
    `<button type="button" class="finder-item" data-study-lab="${lab}" data-study-title="${esc(label)}" data-secret data-keys="${esc(keys)}" hidden><span class="finder-ico" aria-hidden="true">${navIconSvg("studio", label)}</span><span class="finder-label">${esc(label)}</span><span class="finder-hint">Study</span></button>`;
  return `<div class="site-finder" id="site-finder" role="dialog" aria-modal="true" aria-label="Search" hidden>
      <div class="finder-backdrop" data-finder-close></div>
      <div class="finder-panel">
        <span class="win-title" aria-hidden="true">search</span>
        <form class="finder-form" role="search" onsubmit="return false"><span class="finder-ico finder-form-ico" aria-hidden="true">${navIconSvg("search", "Search")}</span><input id="finder-q" type="search" placeholder="Search" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="go" aria-label="Search the site and its commands"></form>
        <p class="finder-none" id="finder-none" hidden>Nothing matches that.</p>
        <div class="finder-results">
          <div id="finder-list">
            <div class="finder-group" data-group="settings"><h2 class="finder-title">Settings</h2>
              ${row({ id: "theme-toggle" }, ICON.sun + ICON.moon, '<span class="finder-theme-dark">Dark mode</span><span class="finder-theme-light">Light mode</span>', "Theme")}
              ${row({ id: "motion-toggle", pressed: true }, ICON.pause, "Reduce motion", '<span class="finder-state">Off</span>')}
              ${row({ id: "font-size-toggle" }, '<span class="icon-text">Aa</span>', "Text size", '<span class="finder-state">100%</span>')}
            </div>
            <div class="finder-group" data-group="go"><h2 class="finder-title">Go to</h2>
              ${editUrl ? row({ tag: "a", href: editUrl, cls: "edit-this-btn" }, pixelIcon("pencil", "icon", 20), "Edit this page", "Admin") : ""}
              ${goRows}
            </div>
            <div class="finder-group" data-group="study" data-secret hidden>
              ${studyRow("core1-lab", "A+ Core 1 Drill", "core1|core 1|a+|comptia|study")}
              ${studyRow("c777-lab", "C777 Web Development Drill", "c777|wgu|web development|study")}
            </div>
          </div>
        </div>
        <p class="finder-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>esc</kbd> close</span><button type="button" class="finder-esc" data-finder-close aria-label="Close">esc</button></p>
      </div>
    </div>`;
}

// The pages of the site, in the order the nav dial shows them: the Studio, then the search stop (the dialog). There is no home page.
const NAV_PAGES = [{ slug: "studio", label: "studio", href: "/studio" }];

export function renderShell({
  title,
  description,
  path,
  activeSlug,
  bodyHtml,
  jsonLd,
  ogType = "website",
  // ' width="…" height="…"' as returned by imgSizeAttrs(), when known -- lets share previews reserve the image's shape before it downloads.
  ogImageSize = "",
  ogImage = null,
  footerText = null,
  noindex = false,
  canonicalUrl = null,
  canvasClass = "canvas",
  editUrl = null,
}) {
  const canonical = canonicalUrl || `https://dominickdominick.com${path}`;
  const ogSizeMatch = /width="(\d+)" height="(\d+)"/.exec(ogImageSize || "");
  const stopHtml = (n) =>
    `<a class="tab${n.slug === activeSlug ? " is-active" : ""}" href="${n.href}"${n.slug === activeSlug ? ' aria-current="page"' : ""}>${navIconSvg(n.slug, n.label)}<span class="tab-label">${esc(n.label)}</span></a>`;
  const navHtml = NAV_PAGES.map(stopHtml).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="theme-color" id="theme-color-meta" content="#18161b" data-dark="#18161b">
<script>(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark")t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);if(t==="light"){var tc=document.getElementById("theme-color-meta");if(tc)tc.setAttribute("content","#f5f0e6");}if(window.top!==window)document.documentElement.classList.add("in-frame");var m=localStorage.getItem("motion");if(m==="reduce")document.documentElement.setAttribute("data-motion","reduce");var fs=parseFloat(localStorage.getItem("fontScale"));if(fs)document.documentElement.style.setProperty("--font-scale",fs);}catch(e){}})();</script>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="author" content="Dominick">
${noindex ? `<meta name="robots" content="noindex">` : ""}
${noindex ? "" : `<link rel="canonical" href="${esc(canonical)}">`}
<link rel="icon" href="${FAVICON}">

<meta property="og:type" content="${esc(ogType)}">
<meta property="og:site_name" content="Dominick">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
${ogImage ? `<meta property="og:image" content="${esc(absoluteUrl(ogImage))}">
<meta property="og:image:alt" content="${esc(title.replace(/ · Dominick$/, ""))}">` : ""}
${ogImage && ogSizeMatch ? `<meta property="og:image:width" content="${ogSizeMatch[1]}">
<meta property="og:image:height" content="${ogSizeMatch[2]}">` : ""}
<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${ogImage ? `<meta name="twitter:image" content="${esc(absoluteUrl(ogImage))}">
<meta name="twitter:image:alt" content="${esc(title.replace(/ · Dominick$/, ""))}">` : ""}

<link rel="stylesheet" href="/style.css">
<link rel="expect" href="#main-content" blocking="render">
<script src="/page-slide.js"></script>
${pageScriptsHtml(bodyHtml)}
<script type="application/ld+json">${jsonLdScript({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Dominick",
    url: "https://dominickdominick.com/",
  })}</script>
${(Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : [])
  .map((ld) => `<script type="application/ld+json">${jsonLdScript(ld)}</script>`)
  .join("\n")}
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to content</a>
  <div class="page">
    <header class="topbar">
      <nav class="site-nav" aria-label="Sections"><div class="tabs">
        ${navHtml}
        ${finderTabHtml()}
      </div><span class="tab-indicator" aria-hidden="true"></span></nav><script>${DIAL_PRESET_SCRIPT}</script>
    </header>
    ${finderHtml({ editUrl })}
    <script src="/nav.js"></script>

    <main class="${esc(canvasClass)}" id="main-content">
      ${bodyHtml}
    </main>
    ${footerHtml(footerText)}
  </div>
</body>
</html>`;
}
