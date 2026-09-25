const COOKIE_NAME = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(sig);
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function checkPassword(env, candidate) {
  if (!env.ADMIN_PASSWORD || !candidate) return false;
  // Hash both sides first so comparison length never leaks the real
  // password's length via timing, then compare the fixed-length digests.
  // The "admin-login:" prefix keeps this HMAC's message space disjoint
  // from the session-cookie signature and page-password hash below —
  // all three share the same SESSION_SECRET key, so without a distinct
  // prefix each, a value computed for one purpose could be replayed as
  // another (e.g. a page password chosen to look like a session's exp
  // timestamp would otherwise double as a forged admin session).
  const [a, b] = await Promise.all([
    hmac(env.SESSION_SECRET || "pw", `admin-login:${candidate}`),
    hmac(env.SESSION_SECRET || "pw", `admin-login:${env.ADMIN_PASSWORD}`),
  ]);
  return timingSafeEqual(a, b);
}

export async function createSessionCookie(env) {
  const exp = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = String(exp);
  const sig = await hmac(env.SESSION_SECRET, `session:${payload}`);
  const token = `${payload}.${sig}`;
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

export async function isAuthenticated(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[COOKIE_NAME];
  if (!token) return false;
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx === -1) return false;
  const payload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expected = await hmac(env.SESSION_SECRET, `session:${payload}`);
  if (!timingSafeEqual(sig, expected)) return false;
  const exp = Number(payload);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  return true;
}
