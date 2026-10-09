// STUDY (temporary): a password-gated study page that opens from a button on any page.
// All of it lives in worker/study/ and public/study/; worker/study/README.md lists the few lines
// elsewhere that point at it, and how to take it all out again.
//
// How it works: the "Study" block on a page renders only a button. Pressing it asks the Worker for the
// study page. A block set to "Ask for a password" only gets it back when the password matches; any other
// block (the default) opens straight away. The study page itself is never in the page's HTML, and the
// password never leaves the server.
import { checkRateLimit, recordRateLimitHit } from "../db.js";
import { withBridge } from "./bridges.js";

// Used when a Study block is set to ask for a password but has none of its own typed in.
// An env var STUDY_PASSWORD, if set, replaces it.
const DEFAULT_PASSWORD = "123";

// The study pages that can be chosen in the block. `load` is only called after the password is right.
export const STUDY_LABS = {
  "core1-lab": {
    label: "A+ Core 1 Drill",
    load: async () => (await import("./core1-lab.html")).default,
  },
  "c777-lab": {
    label: "C777 Web Development Drill",
    load: async () => (await import("./c777-lab.html")).default,
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

// The password a block asks for. Every Study block asks now (the owner wants Study reached only through search and then its
// password): the block's own, else the site's STUDY_PASSWORD, else the default. The old "Ask for a password" tick no longer matters.
export function gatePassword(env, content) {
  return expectedPassword(env, content);
}

// POST /api/study/unlock  { block: <block id>, password: "..." }
// 200 with the study page as text/html, 401 wrong or missing password (`needsPassword` when none was given), 404 no such block,
// 429 too many tries.
export async function handleStudyUnlock(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  let body = null;
  try {
    const text = await request.text();
    body = text.length <= 2000 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Bad request." }, 400);
  const content = await studyBlock(env, Number(body.block));
  const expected = content ? gatePassword(env, content) : null;
  const serve = async () => {
    const key = STUDY_LABS[content.lab] ? content.lab : DEFAULT_LAB;
    const html = env.__studyLabs && env.__studyLabs[key] != null ? env.__studyLabs[key] : await STUDY_LABS[key].load();
    // The study page goes out with its progress bridge (worker/study/bridges.js) so the popup can keep and restore a reader's place.
    return new Response(withBridge(html, key), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  };
  if (content && expected === "") return serve();
  if (!(await checkRateLimit(env, "study", ip, { windowMinutes: 15, maxAttempts: 8 }))) {
    return json({ error: "Too many tries. Wait a few minutes and try again." }, 429);
  }
  if (!content) {
    await recordRateLimitHit(env, "study", ip);
    return json({ error: "Not found." }, 404);
  }
  const given = typeof body.password === "string" ? body.password.slice(0, 200) : "";
  // Asking before a password has been typed is not a guess, so it does not count against the limit.
  if (!given.trim()) return json({ error: "Type the password first.", needsPassword: true }, 401);
  if (!(await samePassword(given, expected))) {
    await recordRateLimitHit(env, "study", ip);
    return json({ error: "That password isn't right.", needsPassword: true }, 401);
  }
  return serve();
}

// The block as it appears on a page: just a button (the password and the study page are not in it).
export function renderStudyBlock(content, blockId, esc) {
  const c = content || {};
  const label = String(c.label || "").trim().slice(0, 80) || "Open study";
  const lab = STUDY_LABS[c.lab] ? c.lab : DEFAULT_LAB;
  return `<div class="study-block" data-study-block="${esc(blockId)}" data-study-lab="${esc(lab)}" data-study-title="${esc(STUDY_LABS[lab].label)}"><button type="button" class="btn study-open" aria-haspopup="dialog">${esc(label)}</button></div>`;
}

// The tags a page needs when it has a Study block on it.
export function studyPageTags(html) {
  return String(html || "").includes('class="study-block"')
    ? ['<link rel="stylesheet" href="/study/study.css">', '<script src="/study/study.js" defer></script>']
    : [];
}
