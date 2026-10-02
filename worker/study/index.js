// STUDY (temporary): a password-gated study page that opens from a button on any page.
// All of it lives in worker/study/ and public/study/; worker/study/README.md lists the few lines
// elsewhere that point at it, and how to take it all out again.
//
// How it works: the "Study" block on a page renders only a button. Pressing it asks for a password,
// the browser sends it here, and only if it matches does this return the study page (as text). The
// study page itself is never in the page's HTML, and the password never leaves the server.
import { checkRateLimit, recordRateLimitHit } from "../db.js";

// Used when a Study block has no password of its own (set one in the block's settings to override it).
// An env var STUDY_PASSWORD, if set, replaces it too.
const DEFAULT_PASSWORD = "Sebastain";

// The study pages that can be chosen in the block. `load` is only called after the password is right.
export const STUDY_LABS = {
  "core1-lab": {
    label: "A+ Core 1 Drill",
    load: async () => (await import("./core1-lab.html")).default,
  },
};
const DEFAULT_LAB = "core1-lab";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (body, status) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// Case and stray spaces don't matter: a phone keyboard capitalises the first letter and adds a space.
const normalise = (s) => String(s == null ? "" : s).normalize("NFC").trim().toLowerCase();

// Compares two passwords without stopping at the first difference (both are hashed first, so the
// length does not show either).
export async function samePassword(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map((s) => crypto.subtle.digest("SHA-256", enc.encode(normalise(s)))));
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length && i < y.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// The block's settings, with a reusable (shared) block's own content standing in when it has one.
async function studyBlock(env, id) {
  if (!Number.isInteger(id) || id < 1) return null;
  const row = await env.DB
    .prepare(
      `SELECT b.type, b.content, s.type AS shared_type, s.content AS shared_content
       FROM blocks b LEFT JOIN shared_blocks s ON s.id = b.shared_block_id WHERE b.id = ?`
    )
    .bind(id)
    .first();
  if (!row) return null;
  const type = row.shared_type || row.type;
  if (type !== "study") return null;
  try {
    return JSON.parse((row.shared_content != null ? row.shared_content : row.content) || "{}") || {};
  } catch {
    return {};
  }
}

export function expectedPassword(env, content) {
  const own = content && typeof content.password === "string" ? content.password.trim() : "";
  return own || (env && typeof env.STUDY_PASSWORD === "string" && env.STUDY_PASSWORD.trim()) || DEFAULT_PASSWORD;
}

// POST /api/study/unlock  { block: <block id>, password: "..." }
// 200 with the study page as text/html, 401 wrong password, 404 no such block, 429 too many tries.
export async function handleStudyUnlock(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await checkRateLimit(env, "study", ip, { windowMinutes: 15, maxAttempts: 8 }))) {
    return json({ error: "Too many tries. Wait a few minutes and try again." }, 429);
  }
  let body = null;
  try {
    const text = await request.text();
    body = text.length <= 2000 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Bad request." }, 400);
  const content = await studyBlock(env, Number(body.block));
  const right = content ? await samePassword(typeof body.password === "string" ? body.password.slice(0, 200) : "", expectedPassword(env, content)) : false;
  if (!right) {
    await recordRateLimitHit(env, "study", ip);
    return content ? json({ error: "That password isn't right." }, 401) : json({ error: "Not found." }, 404);
  }
  const key = STUDY_LABS[content.lab] ? content.lab : DEFAULT_LAB;
  const html = env.__studyLabs && env.__studyLabs[key] != null ? env.__studyLabs[key] : await STUDY_LABS[key].load();
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

// The block as it appears on a page: just a button (the password and the study page are not in it).
export function renderStudyBlock(content, blockId, esc) {
  const c = content || {};
  const label = String(c.label || "").trim().slice(0, 80) || "Open study";
  const lab = STUDY_LABS[c.lab] ? c.lab : DEFAULT_LAB;
  return `<div class="study-block" data-study-block="${esc(blockId)}" data-study-title="${esc(STUDY_LABS[lab].label)}"><button type="button" class="btn study-open" aria-haspopup="dialog">${esc(label)}</button></div>`;
}

// The tags a page needs when it has a Study block on it.
export function studyPageTags(html) {
  return String(html || "").includes('class="study-block"')
    ? ['<link rel="stylesheet" href="/study/study.css">', '<script src="/study/study.js" defer></script>']
    : [];
}
