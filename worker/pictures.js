// Pictures written into article, project and page text: ![alt text](address "Optional caption") on a line of its own.
// Pure helpers shared by the renderer (render.js) and the places that have to know which pictures a text holds (the Media Library's
// "used by" list, the SEO report, the link checker), so all of them agree on what counts as a picture.

// One picture line. The address has no spaces or ")"; the caption is in double quotes and may hold anything but a quote.
export const IMAGE_LINE = /^!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+"([^"]*)")?\s*\)$/;

// The address a picture may use: a path on this site, or an https address. javascript:, data:, "//host", "\host", http: and relative
// paths are not pictures, so the line stays text and nothing unsafe is ever requested.
export function safeImageSrc(url) {
  const src = String(url ?? "").trim();
  if (!src || /[\u0000-\u001f\u007f\\"'<>`]/.test(src)) return null;
  if (src.startsWith("/")) return src.startsWith("//") ? null : src;
  try {
    const parsed = new URL(src);
    return parsed.protocol === "https:" && parsed.hostname ? src : null;
  } catch {
    return null;
  }
}

// The Media Library key behind an address ("uploads/…"), for this site's own addresses only; null for anything else.
export function mediaKeyFor(src) {
  try {
    const url = new URL(src, "https://dominickdominick.com");
    if (!["dominickdominick.com", "www.dominickdominick.com"].includes(url.hostname) || url.port || url.username || url.password) return null;
    const match = url.pathname.match(/^\/media\/(uploads\/[A-Za-z0-9_.\-\/]+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// The picture on each line of a paragraph when every line is one (the renderer shows a run of picture lines as stacked
// figures, and anything mixed with other text stays text), otherwise null.
export function paragraphPictures(paragraph) {
  const lines = String(paragraph).trim().split("\n").map((l) => l.trim());
  const found = lines.map((l) => IMAGE_LINE.exec(l));
  return found.length && found.every(Boolean) ? found : null;
}

// What the renderer would see as prose: fenced code is code, and the lines that open and close a callout (:::note … :::) are not
// content, so the pictures inside a callout are found too.
function proseOf(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, "")
    .replace(/^:::[a-z]*[ \t]*$/gim, "");
}

// Every picture in a text that the renderer would turn into a figure: { alt, src, caption, key } (key is the Media Library key,
// or null for any other address).
export function bodyPictures(text) {
  const out = [];
  for (const paragraph of proseOf(text).split(/\n{2,}/)) {
    const run = paragraph.trim() ? paragraphPictures(paragraph) : null;
    if (!run) continue;
    const pictures = run.map((m) => ({ alt: m[1].trim(), src: safeImageSrc(m[2]), caption: m[3] || "" }));
    if (pictures.some((p) => !p.src)) continue; // one bad line keeps the whole run as text
    for (const p of pictures) out.push({ ...p, key: mediaKeyFor(p.src) });
  }
  return out;
}

// The address to record for a picture in the Media Library's usage list: the library's own "/media/…" form whenever it is one of
// its files (however it was written), otherwise the address as written.
export function pictureUrl(picture) {
  return picture.key ? `/media/${picture.key}` : picture.src;
}

// A text without its picture-only lines, for counting words (the alt text and caption are not part of the prose).
export function stripPictureLines(text) {
  return String(text || "").replace(/^[ \t]*!\[[^\]\n]*\]\([^\n]*\)[ \t]*$/gm, "");
}

// The address of every markdown link or picture in a text, for the link checker. A caption after a picture's address is not part of
// the address, and a picture with no alt text still counts.
export function markdownLinkTargets(text) {
  const withoutTitles = String(text || "").replace(/(\]\(\s*[^\s)]+)\s+"[^"\n]*"(\s*\))/g, "$1$2");
  return [...withoutTitles.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1].trim()).filter(Boolean);
}
