// Shared text hygiene. "Visible" text is the value with the characters that render as nothing
// taken off its EDGES (whitespace, zero-width spaces, bidi controls, soft hyphen, the Hangul and
// Braille fillers, tag characters). Interior joiners are part of the text (ZWNJ in Persian, ZWJ
// in emoji families and Indic scripts) and are never touched. A lone combining mark is empty.
const EDGE =
  "\\s\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\u2800\\u3164\\uFEFF\\uFFA0\\u{E0000}-\\u{E007F}";
const EDGE_RE = new RegExp(`^[${EDGE}]+|[${EDGE}]+$`, "gu");

export function visibleText(value) {
  const text = String(value ?? "").replace(EDGE_RE, "");
  return /^\p{M}+$/u.test(text) ? "" : text;
}

// Applies visibleText to the named string fields of a request body, in place, so an
// effectively-blank value is stored as empty (and falls back) instead of shipping blank markup.
export function cleanBodyFields(body, keys) {
  if (!body || typeof body !== "object") return body;
  for (const key of keys) if (typeof body[key] === "string") body[key] = visibleText(body[key]);
  return body;
}
