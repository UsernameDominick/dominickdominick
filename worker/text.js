// Shared text hygiene. "Visible" text is the value with the characters that render as nothing
// taken off its EDGES (whitespace, zero-width spaces, bidi controls, soft hyphen, the Hangul and
// Braille fillers, tag characters). Interior joiners are part of the text (ZWNJ in Persian, ZWJ
// in emoji families and Indic scripts) and are never touched. A lone combining mark is empty.
// The trim is a linear two-ended scan (no regex backtracking), so a hostile value made of
// millions of invisible characters costs time proportional to its length only.
const WS = /\s/u;
function isEdgeCodePoint(cp) {
  if (cp === 0x00ad || cp === 0x034f || cp === 0x061c || cp === 0x115f || cp === 0x1160) return true;
  if (cp === 0x17b4 || cp === 0x17b5 || cp === 0x180e || cp === 0x2800 || cp === 0x3164 || cp === 0xfeff || cp === 0xffa0) return true;
  if (cp >= 0x200b && cp <= 0x200f) return true;
  if (cp >= 0x202a && cp <= 0x202e) return true;
  if (cp >= 0x2060 && cp <= 0x206f) return true;
  if (cp >= 0xe0000 && cp <= 0xe007f) return true;
  return cp < 0x10000 && WS.test(String.fromCharCode(cp));
}

export function visibleText(value) {
  const text = String(value ?? "");
  let start = 0;
  let end = text.length;
  while (start < end) {
    const cp = text.codePointAt(start);
    if (!isEdgeCodePoint(cp)) break;
    start += cp > 0xffff ? 2 : 1;
  }
  while (end > start) {
    let cp = text.charCodeAt(end - 1);
    let width = 1;
    if (cp >= 0xdc00 && cp <= 0xdfff && end - 2 >= start) {
      const hi = text.charCodeAt(end - 2);
      if (hi >= 0xd800 && hi <= 0xdbff) {
        cp = text.codePointAt(end - 2);
        width = 2;
      }
    }
    if (!isEdgeCodePoint(cp)) break;
    end -= width;
  }
  const trimmed = text.slice(start, end);
  return /^\p{M}+$/u.test(trimmed) ? "" : trimmed;
}

// Applies visibleText to the named string fields of a request body, in place, so an
// effectively-blank value is stored as empty (and falls back) instead of shipping blank markup.
// Keys in `nullKeys` become null when empty (columns where NULL, not "", means "not set").
export function cleanBodyFields(body, keys, nullKeys = []) {
  if (!body || typeof body !== "object") return body;
  for (const key of keys) {
    if (typeof body[key] !== "string") continue;
    const cleaned = visibleText(body[key]);
    body[key] = cleaned === "" && nullKeys.includes(key) ? null : cleaned;
  }
  return body;
}

// "Now" for every public read that decides what is live (published, scheduled, expired). An
// admin previewing the site as of another date gets a per-request copy of env carrying
// __previewNow (see worker/index.js); everyone else, and every write, uses the real clock.
export function nowIso(env) {
  return (env && env.__previewNow) || new Date().toISOString();
}



export function pageCssKey(pageId) {
  return `page_css_${Number(pageId)}`;
}
