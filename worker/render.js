import { APP_PAGES } from "./app-pages.js";
import { navIconSvg, pixelIcon } from "./nav-icons.js";
import { DIAL_PRESET_SCRIPT } from "./nav-dial-script.js";
// STUDY (temporary): see worker/study/README.md.
import { studyPageTags } from "./study/index.js";

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


// The footer: the copyright line, and a Share button that stays hidden until nav.js finds the browser can share the page or copy its
// address (so it never shows without JavaScript).
export function footerHtml(year = new Date().getUTCFullYear()) {
  const extras = `<p class="footer-extras"><button type="button" class="footer-share" data-share hidden>Share this page</button><span class="footer-share-note" role="status" aria-live="polite"></span></p>`;
  return `<footer class="site-footer"><p class="footer-mono">© ${year} Dominick</p>${extras}</footer>`;
}


const NOTFOUND_SVG = "<svg class=\"not-found-trace\" viewBox=\"0 0 240 40\" width=\"240\" height=\"40\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M4 20h92M144 20h92\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><circle cx=\"104\" cy=\"20\" r=\"4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/><circle cx=\"136\" cy=\"20\" r=\"4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M112 12l16 16\" stroke=\"var(--accent)\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>";
export function renderNotFoundHtml() {
  return `${NOTFOUND_SVG}
<p class="not-found-code" aria-hidden="true">Error 404</p>
<h1>Page not found</h1>
<p>Whatever you were looking for isn't here. It may have moved or never existed.</p>
<h2 class="not-found-heading">Try one of these instead</h2><ul class="search-results"><li><a href="/studio">studio</a></li></ul>`;
}


// Share-card and structured-data image URLs must be absolute -- Facebook,
// LinkedIn, X and Google all ignore a relative og:image, and uploads are
// stored as site-relative "/media/..." paths, so every share preview on
// the site had no image.
export function absoluteUrl(url) {
  const u = String(url || "");
  if (!u || /^https?:\/\//i.test(u)) return u;
  return `https://dominickdominick.com${u.startsWith("/") ? "" : "/"}${u}`;
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
      `    <p>An unexpected error occurred. It's been logged — try again in a moment, or head back to the Studio.</p>${safeRef ? `\n    <p class="error-ref">Reference: <code>${safeRef}</code></p>` : ""}`,
      '    <p><a href="/studio">← Back to the Studio</a></p>',
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
function finderHtml() {
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
  noindex = false,
  canonicalUrl = null,
  canvasClass = "canvas",
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
    ${finderHtml()}
    <script src="/nav.js"></script>

    <main class="${esc(canvasClass)}" id="main-content">
      ${bodyHtml}
    </main>
    ${footerHtml()}
  </div>
</body>
</html>`;
}
