// What a redirect may say: only the real redirect codes, and a destination that is either one of this site's paths or a full
// http(s) address. Anything else (a 200, a javascript: address, a protocol-relative "//host") is turned away when it is saved,
// because Response.redirect throws on a status that is not a redirect and the visitor would see an error page instead.
export const REDIRECT_STATUSES = [301, 302, 307, 308];
const MAX_TARGET = 2000;

export function cleanRedirectStatus(value, fallback = 301) {
  if (value === undefined || value === null || value === "") return { ok: true, value: fallback };
  const n = typeof value === "number" ? value : /^\d{3}$/.test(String(value).trim()) ? Number(String(value).trim()) : NaN;
  if (REDIRECT_STATUSES.includes(n)) return { ok: true, value: n };
  return { ok: false, error: `The redirect type must be one of ${REDIRECT_STATUSES.join(", ")}` };
}

export function cleanRedirectTarget(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s) return { ok: false, error: "Both a from and to path are required" };
  const bad = { ok: false, error: "The destination must be a path starting with / or a full https:// address" };
  if (s.length > MAX_TARGET || /[\u0000-\u001f\u007f\s]/.test(s)) return bad;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    try {
      const u = new URL(s);
      return u.protocol === "http:" || u.protocol === "https:" ? { ok: true, value: s } : bad;
    } catch {
      return bad;
    }
  }
  // A bare "new-page" has always meant "/new-page".
  const path = s.startsWith("/") ? s : "/" + s;
  return path.startsWith("//") ? bad : { ok: true, value: path };
}

// For serving: a row saved before these checks existed must not take the page down.
export function safeRedirectStatus(value) {
  return REDIRECT_STATUSES.includes(Number(value)) ? Number(value) : 301;
}
