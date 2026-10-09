import { RESERVED_SLUGS, listPages, createPage, updatePage, getNavAdminOnlyIds, setNoindexItem, setNavAdminOnly, deletePage, restorePage, hardDeletePage, listTrashedPages, listBlocks, createBlock, updateBlock, deleteBlock, getMediaMeta, upsertMediaMeta, deleteMediaMeta, recordMediaVersion, listMediaVersions, deleteMediaVersions, getAllMediaUsage, getDuplicateMediaHashes, logActivity, listErrors, logError, runScheduledBackup, runSafetyBackup, compareBackupToSite, previewScheduledBackup, listScheduledBackups, getBackupStatus, getBackupContents, verifyBackupIntegrity, restoreScheduledBackup, slugExists, getLoginLockout, loginLockoutMessage, recordLoginAttempt, getSetting, setSetting, exportAll, importAll, createRedirect, getRedirect, maybeSnapshotPage, snapshotPageNow, listRevisions, getRevision, restorePageRevision, restoreArticleRevision, restorePageRevisionBlock, getBlockPageId, getBlockSharedId, updateSharedBlock, restoreProjectRevision, sha256Hex, plausibleDims } from "./db.js";
import { cleanBodyFields } from "./text.js";
import FEATURES from "../features.json" with { type: "json" };
import { REQUEST_PREFIX, countByStatus, readRequestRow } from "./features.js";
import { outlineConfig, readOutline } from "./outline.js";
import { cleanFooterLinks } from "./render.js";
import { checkPassword, createSessionCookie, clearSessionCookie, isAuthenticated, revokeAllSessions } from "./auth.js";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}




const SETTINGS_KEYS = [
  "default_og_image",
  "site_footer",
  "site_footer_links",
  "maintenance_mode",
  "maintenance_message",
];

// Paths a redirect could otherwise break by intercepting a system route.
const BLOCKED_REDIRECT_PREFIXES = ["/api", "/admin", "/media", "/sitemap.xml", "/rss.xml", "/robots.txt"];
function isBlockedRedirectPath(p) {
  return BLOCKED_REDIRECT_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + "/"));
}

// SVG is the one uploadable image format that's also a document format —
// it can carry <script>, event-handler attributes, and <foreignObject>
// (which can embed arbitrary HTML). Served from the site's own origin under
// a CSP that allows 'unsafe-inline' scripts (kept for the admin's trusted
// custom-head-code feature — see SECURITY_HEADERS in index.js), an
// unsanitized SVG would execute with the full privileges of that origin if
// ever opened directly or framed. This is a best-effort text-level strip,
// not a full XML-aware sanitizer, but it removes every known script vector
// without needing a DOM/XML parser (unavailable in Workers).
export function sanitizeSvg(text) {
  // Each pass can uncover what the one before hid (a tag split around another tag: <scr<script></script>ipt>), so the strip repeats
  // until nothing changes. The served file also carries a locked-down policy (SVG_CSP in index.js), which is what really protects.
  const steps = [
    [/<script[\s\S]*?<\/script\s*>/gi, ""],
    [/<script\b[^>]*\/?>/gi, ""],
    [/<(?:foreignObject|iframe|object|embed)\b[\s\S]*?<\/(?:foreignObject|iframe|object|embed)\s*>/gi, ""],
    [/<(?:foreignObject|iframe|object|embed)\b[^>]*\/?>/gi, ""],
    [/<\/(?:script|foreignObject|iframe|object|embed)\s*>/gi, ""], // a closing tag left on its own by the cuts above
    [/[\s\/]on\w+\s*=\s*"[^"]*"/gi, ""],
    [/[\s\/]on\w+\s*=\s*'[^']*'/gi, ""],
    [/[\s\/]on\w+\s*=\s*[^\s"'>]+/gi, ""],
    [/((?:xlink:)?href|src)\s*=\s*"\s*(?:javascript|data\s*:\s*text\/html)[^"]*"/gi, '$1="#"'],
    [/((?:xlink:)?href|src)\s*=\s*'\s*(?:javascript|data\s*:\s*text\/html)[^']*'/gi, "$1='#'"],
  ];
  let out = String(text);
  for (let i = 0; i < 12; i++) {
    const before = out;
    for (const [re, replacement] of steps) out = out.replace(re, replacement);
    if (out === before) break;
  }
  return out;
}

// Reads an image's pixel width/height straight from its file header --
// no decoding needed, and no image-decode API exists in Workers anyway.
// Used so an <img> can carry width/height attributes, letting the
// browser reserve the right amount of space before the file even starts
// loading (the standard fix for layout shift from a late-loading image).
// Returns null (never throws) for anything it can't confidently parse --
// a missing width/height attribute on one image is a much smaller
// problem than corrupting an upload over a header-parsing edge case.
// The EXIF Orientation tag from a JPEG APP1 segment starting at `start`: null when the
// segment isn't an Exif block at all (e.g. XMP), 0 when it is one but holds no usable
// orientation, else 1-8. Only a well-formed entry counts (type SHORT, count 1), the same
// as browsers, which ignore an orientation tag of any other type.
function readExifOrientation(view, start, length) {
  try {
    const end = Math.min(view.byteLength, start + length);
    if (length < 14 || view.getUint32(start) !== 0x45786966 /* "Exif" */ || view.getUint16(start + 4) !== 0) return null;
    const tiff = start + 6;
    const order = view.getUint16(tiff);
    const little = order === 0x4949;
    if (!little && order !== 0x4d4d) return 0;
    if (view.getUint16(tiff + 2, little) !== 42) return 0;
    const ifd = tiff + view.getUint32(tiff + 4, little);
    if (ifd + 2 > end) return 0;
    const count = view.getUint16(ifd, little);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > end) return 0;
      if (view.getUint16(entry, little) === 0x0112) {
        // a malformed entry (not one SHORT, or a value outside 1-8) is skipped, not fatal: a later valid one still counts
        if (view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) continue;
        const value = view.getUint16(entry + 8, little);
        if (value >= 1 && value <= 8) return value;
        continue; // an out-of-range value is skipped too; browsers keep scanning the IFD
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

function readImageDimensions(buf, contentType) {
  try {
    const view = new DataView(buf);
    if (contentType === "image/png" && buf.byteLength >= 24) {
      // 8-byte signature (checked -- a critic pass found this was the one
      // raster format left trusting the IHDR fourCC without ever
      // validating the file's actual magic bytes first, the same gap
      // already fixed for GIF/JPEG/WebP), then the IHDR chunk: 4-byte
      // length, 4-byte type (always "IHDR" -- guaranteed to be the first
      // chunk), then width/height as big-endian uint32s.
      if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return null;
      if (view.getUint32(12) === 0x49484452 /* "IHDR" */) {
        return plausibleDims({ width: view.getUint32(16), height: view.getUint32(20) });
      }
      return null;
    }
    if (contentType === "image/gif" && buf.byteLength >= 10) {
      // 6-byte "GIF87a"/"GIF89a" signature (checked -- unlike every other
      // branch here, this one previously trusted the bytes at this offset
      // with no signature check at all, so arbitrary garbage labeled
      // image/gif would parse to a nonsense "size"), then width/height as
      // little-endian uint16s.
      const sig = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3), view.getUint8(4), view.getUint8(5));
      if (sig !== "GIF87a" && sig !== "GIF89a") return null;
      return plausibleDims({ width: view.getUint16(6, true), height: view.getUint16(8, true) });
    }
    if (contentType === "image/jpeg" && buf.byteLength >= 4) {
      // 2-byte 0xFFD8 SOI signature (checked -- without it, any garbage
      // buffer that happens to contain a byte pair matching an SOF marker
      // pattern anywhere in its first few bytes parses to fabricated
      // dimensions, the same failure mode a critic pass already found and
      // fixed for GIF's missing signature check).
      if (view.getUint16(0) !== 0xffd8) return null;
      // Walk marker segments looking for a Start-Of-Frame marker (any of
      // the SOFn variants actually used for baseline/progressive JPEGs --
      // explicitly excluding 0xC4/0xC8/0xCC, which share that numeric
      // range but are DHT/JPG-extension/DAC markers, not SOF).
      let offset = 2; // skip the initial 0xFFD8 SOI marker
      let orientation = 1;
      let exifSeen = false; // the first Exif block decides, as in browsers
      while (offset + 9 < buf.byteLength) {
        if (view.getUint8(offset) !== 0xff) {
          offset++;
          continue;
        }
        const marker = view.getUint8(offset + 1);
        if (marker === 0xff) {
          offset++; // a fill byte before the marker
          continue;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
          offset += 2; // standalone marker, no length field
          continue;
        }
        const segmentLength = view.getUint16(offset + 2);
        if (marker === 0xe1 && !exifSeen) {
          const found = readExifOrientation(view, offset + 4, segmentLength - 2);
          if (found !== null) {
            exifSeen = true;
            orientation = found || 1;
          }
        }
        const isSof =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);
        if (isSof) {
          const height = view.getUint16(offset + 5);
          const width = view.getUint16(offset + 7);
          // EXIF orientations 5-8 turn the picture a quarter turn when it is shown, so
          // its displayed size is the stored size with width and height swapped.
          return plausibleDims(orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height });
        }
        offset += 2 + segmentLength;
      }
      return null;
    }
    if (contentType === "image/webp" && buf.byteLength >= 30) {
      // Outer RIFF/WEBP envelope (checked -- without it, any buffer that
      // happens to have "VP8X"/"VP8 "/"VP8L" at byte offset 12, an easy
      // 4-byte coincidence, parses as if it were real WebP data).
      const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
      const webp = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
      if (riff !== "RIFF" || webp !== "WEBP") return null;
      const fourCC = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15));
      if (fourCC === "VP8X") {
        // Extended format: 1-byte flags, 3-byte reserved, then
        // (width-1)/(height-1) as 24-bit little-endian integers.
        const width = 1 + (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16));
        const height = 1 + (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16));
        return plausibleDims({ width, height });
      }
      if (fourCC === "VP8 ") {
        // Lossy: 3-byte frame tag, then a 3-byte start code that's always
        // 0x9d 0x01 0x2a, then 14-bit width/height (the top 2 bits of
        // each field are an unrelated scale factor, masked off).
        if (view.getUint8(23) === 0x9d && view.getUint8(24) === 0x01 && view.getUint8(25) === 0x2a) {
          return plausibleDims({ width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff });
        }
        return null;
      }
      if (fourCC === "VP8L") {
        // Lossless: 1-byte 0x2F signature, then a packed little-endian
        // 32-bit value: 14 bits (width-1), 14 bits (height-1), 1 bit
        // alpha flag, 3-bit version.
        if (view.getUint8(20) === 0x2f) {
          const bits = view.getUint32(21, true);
          return plausibleDims({ width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 });
        }
        return null;
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

// SVG has no fixed binary header to read a size from -- its dimensions
// are just XML attributes (or absent entirely, since a valid SVG doesn't
// have to declare one). Prefers an explicit width/height pair over
// viewBox, matching how a browser itself resolves an SVG's intrinsic
// size. Returns null rather than a fabricated guess when neither is
// present or parseable.
// Extracts a `width`/`height`-style attribute's numeric value ONLY when
// it's a bare number or has an explicit "px" unit -- returns null for a
// percentage or any other CSS unit (em, in, cm, ...), rather than
// silently reading just the leading digits as if they were pixels. A
// critic pass found the previous version treated `width="100%"` as a
// literal 100px, which for a responsive SVG (a very common real-world
// pattern, relying on viewBox for its actual proportions) can silently
// produce a wrong aspect ratio whenever the two percentages don't happen
// to match the viewBox's own ratio.
// The leading `(?:^|\s)` (rather than `\b`) is required so `attrName`
// only matches a real attribute name, not the tail of a hyphenated one --
// a critic pass found `\b` alone lets `width` match inside `stroke-width`
// (a common root-<svg> attribute in icon sets), silently reading the
// wrong attribute's value as the file's dimensions.
function readSvgPixelAttr(openTag, attrName) {
  const match = openTag.match(new RegExp(`(?:^|[\\s<])${attrName}\\s*=\\s*["']?([\\d.]+)\\s*(%|px|em|ex|pt|pc|cm|mm|in)?(?=["'\\s/>]|$)`, "i"));
  if (!match) return null;
  const unit = match[2];
  if (unit && unit.toLowerCase() !== "px") return null;
  return Number(match[1]);
}

function readSvgDimensions(svgText) {
  const openTagMatch = svgText.match(/<svg\b[^>]*>/i);
  const openTag = openTagMatch ? openTagMatch[0] : "";
  const width = readSvgPixelAttr(openTag, "width");
  const height = readSvgPixelAttr(openTag, "height");
  if (width !== null && height !== null) {
    const dims = plausibleDims({ width: Math.round(width), height: Math.round(height) });
    if (dims) return dims;
  }
  const viewBoxMatch = svgText.match(/<svg\b[^>]*\bviewBox\s*=\s*["']?\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (viewBoxMatch) {
    return plausibleDims({ width: Math.round(Number(viewBoxMatch[1])), height: Math.round(Number(viewBoxMatch[2])) });
  }
  return null;
}

// A malformed custom_json_ld would otherwise fail silently until someone
// actually inspects the rendered <script type="application/ld+json"> tag —
// or worse, get swallowed by JSON.stringify re-serializing whatever
// half-broken value made it into the column. Reject it at save time instead.
// The publishing checklist in the admin UI has always shown "Body has
// enough content to publish" as a checkmark, but never actually stopped
// anyone from publishing anyway — a real gap, not just cosmetic, since
// the checklist looked like validation without being any. Enforced only
// at the moment something transitions from unpublished to published (not
// on every subsequent edit — an already-published short piece shouldn't
// suddenly start failing to save because of an unrelated tag change).
// MIN_PUBLISH_BODY_LENGTH/publishBodyTooShort now live in db.js so
// bulkArticleAction/bulkProjectAction (bulk "Publish") can enforce the
// same floor as these single-item routes do.

function validateCustomJsonLd(body) {
  if (!body.custom_json_ld) return null;
  try {
    JSON.parse(body.custom_json_ld);
    return null;
  } catch {
    return "Custom structured data (JSON-LD) is not valid JSON";
  }
}

// Canonical URL had no validation at all before this — an admin typo (or a
// deliberately malformed value) landed straight in renderShell()'s
// <link rel="canonical">/og:url output, and until that output was also
// properly escaped, a value containing quotes/angle-brackets could inject
// arbitrary markup into every page's <head>. This is defense-in-depth
// alongside that escaping fix, same pattern as validateCustomJsonLd above.
// Trims in place (so a stray trailing/leading space doesn't get stored
// verbatim just because it happened to pass the regex, and doesn't
// inconsistently reject only the leading-space case while silently
// accepting the trailing-space one) before validating — a whitespace-only
// value normalizes to "" and is treated the same as never having been set.
function validateCanonicalUrl(body) {
  if (typeof body.canonical_url === "string") body.canonical_url = body.canonical_url.trim() || null;
  if (!body.canonical_url) return null;
  if (!/^https?:\/\//i.test(body.canonical_url)) {
    return "Canonical URL must start with http:// or https://";
  }
  return null;
}

// Optimistic-concurrency guard for the article/page editors: the client
// sends back the version number it last saw when it loaded (or last saved),
// and if the row has moved on since — another tab, another device, this
// same admin editing themselves twice — this refuses the blind overwrite
// rather than silently discarding whatever changed in between. A client
// that never sends expected_version (older cached admin JS, or an external
// API caller) just skips the check, same as before this existed.
// Uses a plain incrementing counter rather than comparing updated_at
// strings — datetime('now') in SQLite only has second resolution, so two
// updates within the same second (a fast test, or two tabs saving close
// together) would otherwise produce identical timestamps and silently
// defeat the check.
async function checkConflict(env, table, id, expectedVersion) {
  if (!expectedVersion) return null;
  const row = await env.DB.prepare(`SELECT version FROM ${table} WHERE id = ?`).bind(id).first();
  if (row && row.version !== expectedVersion) {
    return json(
      { error: "This was changed elsewhere since you loaded it. Reload to see the latest version before saving.", conflict: true },
      { status: 409 }
    );
  }
  return null;
}

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// At most max characters (whole code points, so an emoji is never cut in half),
// with an ellipsis when something was left out.
function clipChars(text, max) {
  const chars = Array.from(String(text));
  return chars.length > max ? chars.slice(0, max).join("") + "…" : String(text);
}

// Thrown for a request the client got wrong; handleAdminApi answers it with a 400.
class BadRequestError extends Error {}


// UTF-8 bytes to text; invalid sequences are a 400 rather than silently turning
// into U+FFFD inside a stored name.
function decodeUtf8(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new BadRequestError("The request body must be valid UTF-8.");
  }
}

// A JSON request body as a plain object. No body at all reads as {}; anything
// else that isn't a JSON object (invalid JSON, null, a string, a number, an
// array) is a 400 rather than a silent {} -- an empty object would otherwise
// reach handlers that treat missing fields as "clear this" (a settings save)
// and blank data the caller never meant to touch.
async function readJsonBody(request) {
  const text = decodeUtf8(await request.arrayBuffer());
  if (!text.trim()) return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BadRequestError("The request body must be valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError("The request body must be a JSON object.");
  }
  return body;
}



export async function handleAdminApi(request, env, url, ctx) {
  try {
    return await routeAdminApi(request, env, url, ctx);
  } catch (err) {
    if (err instanceof BadRequestError) return json({ error: err.message }, { status: 400 });
    return json({ error: err.message || "Something went wrong" }, { status: 500 });
  }
}



// Fire-and-forget activity log write — never blocks or fails the request
// it's attached to.
function log(ctx, env, action, entityType, entityLabel, detail) {
  ctx.waitUntil(logActivity(env, action, entityType, entityLabel, detail).catch(() => {}));
}

// A slug change on something that's live breaks whatever already links to
// or bookmarked the old URL — auto-creating the redirect is a one-time
// courtesy, not a standing rule: it only fires the moment the slug
// actually changes, and never overwrites a redirect an admin already set
// up from that same old path (their choice wins).
async function maybeCreateSlugRedirect(env, ctx, { oldSlug, newSlug, pathPrefix, isLive }) {
  if (!isLive || !oldSlug || !newSlug || oldSlug === newSlug) return;
  const fromPath = `${pathPrefix}${oldSlug}`;
  const toPath = `${pathPrefix}${newSlug}`;
  if (isBlockedRedirectPath(fromPath) || fromPath === toPath) return;
  try {
    const existing = await getRedirect(env, fromPath);
    if (existing) return;
    await createRedirect(env, { from_path: fromPath, to_path: toPath, status_code: 301 });
    log(ctx, env, "create", "redirect", `${fromPath} → ${toPath} (auto, from slug change)`);
  } catch {
    // Best-effort courtesy, not a hard requirement — a failure here
    // (e.g. a race against a redirect created the same moment) shouldn't
    // fail the slug change itself.
  }
}



async function routeAdminApi(request, env, url, ctx) {
  const path = url.pathname.replace(/^\/api\/admin/, "");
  const method = request.method;

  if (path === "/login" && method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const lockout = await getLoginLockout(env, ip);
    if (!lockout.allowed) {
      return json(
        { error: loginLockoutMessage(lockout.retryAfterSeconds), retryAfter: lockout.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(lockout.retryAfterSeconds) } }
      );
    }
    const body = await readJsonBody(request);
    const ok = await checkPassword(env, body.password);
    if (!ok) {
      // Only wrong passwords count against the limit.
      const failures = await recordLoginAttempt(env, ip);
      log(ctx, env, "login_failed", "session", "Failed login attempt", ip);
      return json({ error: "Wrong password" }, { status: 401 });
    }
    log(ctx, env, "login", "session", "Admin login", ip);
    const cookie = await createSessionCookie(env);
    return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
  }

  if (path === "/logout" && method === "POST") {
    // Only log a real logout — this route sits above the auth gate below
    // (so a signed-out browser can always clear a stale cookie), which
    // would otherwise let anyone spam the activity log with fake "Admin
    // logout" entries just by hitting this endpoint repeatedly.
    if (await isAuthenticated(request, env)) {
      // Gated on a real session so an unauthenticated request can't force
      // everyone else out by spamming this endpoint.
      await revokeAllSessions(env);
      log(ctx, env, "logout", "session", "Admin logout (all sessions revoked)", request.headers.get("CF-Connecting-IP") || "unknown");
    }
    return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
  }

  if (path === "/me" && method === "GET") {
    const authed = await isAuthenticated(request, env);
    return json({ authenticated: authed });
  }

  // Everything past this point requires auth
  const authed = await isAuthenticated(request, env);
  if (!authed) return json({ error: "Unauthorized" }, { status: 401 });

  // The project outline (outline.md), read-only from the GitHub repo: see worker/outline.js for the setup.
  if (path === "/outline" && method === "GET") {
    const cfg = outlineConfig(env);
    const base = { configured: cfg.configured, repo: cfg.repo, branch: cfg.branch, path: cfg.path };
    const out = await readOutline(env);
    if (!out.ok) return json({ ...base, error: out.error }, { status: out.status === 404 ? 404 : out.status === 503 ? 503 : 502 });
    return json({ ...base, text: out.text, size: out.size });
  }
  if (path === "/pages" && method === "GET") {
    const adminOnly = new Set(await getNavAdminOnlyIds(env));
    return json((await listPages(env)).map((p) => ({ ...p, nav_admin_only: adminOnly.has(p.id) })));
  }
  if (path === "/pages" && method === "POST") {
    const body = await readJsonBody(request);
    cleanBodyFields(body, ["meta_description", "nav_label", "og_image"], ["nav_label", "og_image"]);
    const jsonLdError = validateCustomJsonLd(body);
    if (jsonLdError) return json({ error: jsonLdError }, { status: 400 });
    const canonicalError = validateCanonicalUrl(body);
    if (canonicalError) return json({ error: canonicalError }, { status: 400 });
    const slug = slugify(body.slug || body.title);
    if (!slug || RESERVED_SLUGS.has(slug)) {
      return json({ error: "Invalid or reserved slug" }, { status: 400 });
    }
    // Checked against every page regardless of trash status — the slug
    // column is unique at the DB level whether or not a page using it is
    // currently trashed, so a trashed page's slug can't be silently reused.
    if (await slugExists(env, "pages", slug)) return json({ error: "Slug already exists" }, { status: 409 });
    const id = await createPage(env, {
      slug,
      title: body.title || slug,
      meta_description: body.meta_description || "",
      nav_label: body.nav_label || null,
      nav_order: body.nav_order ?? null,
      og_image: body.og_image || null,
      custom_json_ld: body.custom_json_ld || null,
    });
    log(ctx, env, "create", "page", body.title || slug);
    return json({ id, slug });
  }
  const pageMatch = path.match(/^\/pages\/(\d+)$/);
  if (pageMatch && method === "PATCH") {
    const body = await readJsonBody(request);
    cleanBodyFields(body, ["meta_description", "nav_label", "og_image"], ["nav_label", "og_image"]);
    const jsonLdError = validateCustomJsonLd(body);
    if (jsonLdError) return json({ error: jsonLdError }, { status: 400 });
    const canonicalError = validateCanonicalUrl(body);
    if (canonicalError) return json({ error: canonicalError }, { status: 400 });
    const id = Number(pageMatch[1]);
    const conflict = await checkConflict(env, "pages", id, body.expected_version);
    if (conflict) return conflict;
    if ("noindex" in body) {
      await setNoindexItem(env, "page", id, body.noindex === true);
      delete body.noindex;
    }
    if (body.slug) {
      body.slug = slugify(body.slug);
      if (RESERVED_SLUGS.has(body.slug)) {
        return json({ error: "Reserved slug" }, { status: 400 });
      }
      if (await slugExists(env, "pages", body.slug, id)) {
        return json({ error: "A page with that slug already exists" }, { status: 409 });
      }
    }
    // Nesting stays one level deep — a page can't be its own parent, and a
    // page that's already nested under something can't also be a parent
    // itself (no dropdown-inside-a-dropdown), so listNavPages() never has
    // to worry about cycles or multi-level trees when building the nav.
    if (body.nav_parent_id) {
      const parentId = Number(body.nav_parent_id);
      if (parentId === id) return json({ error: "A page can't be nested under itself" }, { status: 400 });
      const parent = await env.DB.prepare("SELECT nav_parent_id FROM pages WHERE id = ?").bind(parentId).first();
      if (!parent) return json({ error: "Parent nav item not found" }, { status: 400 });
      if (parent.nav_parent_id) return json({ error: "Can't nest under a page that's already nested (one level of dropdown only)" }, { status: 400 });
      const hasChildren = await env.DB.prepare("SELECT 1 FROM pages WHERE nav_parent_id = ? LIMIT 1").bind(id).first();
      if (hasChildren) return json({ error: "This page already has its own dropdown items — can't also nest it under another page" }, { status: 400 });
    }
    const beforePage = body.slug ? await env.DB.prepare("SELECT slug FROM pages WHERE id = ?").bind(id).first() : null;
    if ("nav_admin_only" in body) {
      await setNavAdminOnly(env, id, body.nav_admin_only === true);
      delete body.nav_admin_only;
    }
    await updatePage(env, id, body);
    log(ctx, env, "update", "page", body.title || body.slug || `#${id}`);
    // The home page's slug ("home") maps to "/", not "/home" — every
    // other page is just "/" + its slug.
    if (body.slug && beforePage && beforePage.slug !== "home") {
      await maybeCreateSlugRedirect(env, ctx, { oldSlug: beforePage.slug, newSlug: body.slug, pathPrefix: "/", isLive: true });
    }
    const fresh = await env.DB.prepare("SELECT version FROM pages WHERE id = ?").bind(id).first();
    return json({ ok: true, version: fresh?.version });
  }
  if (pageMatch && method === "DELETE") {
    const id = Number(pageMatch[1]);
    const p = await env.DB.prepare("SELECT title FROM pages WHERE id = ?").bind(id).first();
    await deletePage(env, id);
    log(ctx, env, "trash", "page", p?.title || `#${id}`);
    return json({ ok: true });
  }
      if (path === "/pages/trash" && method === "GET") {
    return json(await listTrashedPages(env));
  }
  const pageRestoreMatch = path.match(/^\/pages\/(\d+)\/restore$/);
  if (pageRestoreMatch && method === "POST") {
    const id = Number(pageRestoreMatch[1]);
    await restorePage(env, id);
    const p = await env.DB.prepare("SELECT title FROM pages WHERE id = ?").bind(id).first();
    log(ctx, env, "restore", "page", p?.title || `#${id}`);
    return json({ ok: true });
  }
  const pagePermanentMatch = path.match(/^\/pages\/(\d+)\/permanent$/);
  if (pagePermanentMatch && method === "DELETE") {
    const id = Number(pagePermanentMatch[1]);
    const p = await env.DB.prepare("SELECT title, deleted_at FROM pages WHERE id = ?").bind(id).first();
    // The UI only offers this from the Trash; refuse a live item rather than deleting it with no way back.
    if (p && !p.deleted_at) return json({ error: "Move it to the Trash first; only trashed items can be deleted permanently." }, { status: 409 });
    await hardDeletePage(env, id);
    log(ctx, env, "delete-forever", "page", p?.title || `#${id}`);
    return json({ ok: true });
  }

    
    
  // /pages/:id/blocks
  const blocksMatch = path.match(/^\/pages\/(\d+)\/blocks$/);
  if (blocksMatch && method === "GET") {
    return json(await listBlocks(env, Number(blocksMatch[1])));
  }
  if (blocksMatch && method === "POST") {
    const body = await readJsonBody(request);
    const pageId = Number(blocksMatch[1]);
    await maybeSnapshotPage(env, pageId);
    const id = await createBlock(env, pageId, body);
    return json({ id });
  }

  // /blocks/:id
  const blockMatch = path.match(/^\/blocks\/(\d+)$/);
  if (blockMatch && method === "PATCH") {
    const body = await readJsonBody(request);
    const id = Number(blockMatch[1]);
    const pageId = await getBlockPageId(env, id);
    // A bulk clear (the style-group reset) asks for a snapshot regardless of the throttle.
    const forceSnapshot = body.force_snapshot === true;
    delete body.force_snapshot;
    if (pageId) await (forceSnapshot ? snapshotPageNow(env, pageId) : maybeSnapshotPage(env, pageId));
    // A reusable-block placement's content/style live on the shared_blocks
    // row, not this one — redirect those fields there so an edit updates
    // every page using it. Position fields (col/row/span) always stay
    // per-placement and go through updateBlock() as normal either way.
    const sharedId = await getBlockSharedId(env, id);
    if (sharedId && ("content" in body || "style" in body)) {
      const sharedFields = {};
      if ("content" in body) sharedFields.content = body.content;
      if ("style" in body) sharedFields.style = body.style;
      await updateSharedBlock(env, sharedId, sharedFields);
      delete body.content;
      delete body.style;
    }
    if (Object.keys(body).length) await updateBlock(env, id, body);
    return json({ ok: true });
  }
  if (blockMatch && method === "DELETE") {
    const id = Number(blockMatch[1]);
    const pageId = await getBlockPageId(env, id);
    if (pageId) await maybeSnapshotPage(env, pageId);
    await deleteBlock(env, id);
    return json({ ok: true });
  }
    
            
                            
                        
          
          
  // /upload — image files only, 8MB cap. An optional ?folder= query param
  // files the upload into that folder from the moment it lands.
  if (path === "/upload" && method === "POST") {
    const contentType = request.headers.get("Content-Type") || "";
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
    if (!allowed.includes(contentType)) {
      return json({ error: "Only PNG, JPEG, WebP, GIF, or SVG images are allowed" }, { status: 400 });
    }
    let buf = await request.arrayBuffer();
    if (buf.byteLength > 8 * 1024 * 1024) {
      return json({ error: "File too large (8MB max)" }, { status: 400 });
    }
    if (contentType === "image/svg+xml") {
      const cleaned = sanitizeSvg(new TextDecoder().decode(buf));
      buf = new TextEncoder().encode(cleaned).buffer;
    }
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" }[
      contentType
    ];
    const hash = await sha256Hex(buf);
    const duplicate = await env.DB.prepare("SELECT key FROM media WHERE hash = ? LIMIT 1").bind(hash).first();
    const key = `uploads/${crypto.randomUUID()}.${ext}`;
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType } });
    const folder = url.searchParams.get("folder");
    const dims =
      contentType === "image/svg+xml" ? readSvgDimensions(new TextDecoder().decode(buf)) : readImageDimensions(buf, contentType);
    await upsertMediaMeta(env, key, { folder: folder || undefined, hash, width: dims?.width, height: dims?.height });
    log(ctx, env, "upload", "media", key.split("/").pop());
    return json({ url: `/media/${key}`, duplicateOf: duplicate ? `/media/${duplicate.key}` : null });
  }




  // /media — list uploaded files (enriched with folder/tags/alt text), for
  // the media library picker.
  if (path === "/media" && method === "GET") {
    // One page of up to 500 files. The library asks for `?paged=1` and follows `next` (R2's own cursor) until there is none, so
    // it is not limited to the first 500; without `paged` the reply stays a plain array of the first page, as it always was.
    const paged = url.searchParams.has("paged");
    const cursor = (url.searchParams.get("cursor") || "").slice(0, 2000);
    const listed = await env.MEDIA.list({ prefix: "uploads/", limit: 500, ...(cursor ? { cursor } : {}) });
    const next = listed.truncated && listed.cursor ? listed.cursor : null;
    const objects = listed.objects.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
    const [meta, usageMap, duplicateGroups] = await Promise.all([
      getMediaMeta(env, objects.map((o) => o.key)),
      getAllMediaUsage(env),
      getDuplicateMediaHashes(env),
    ]);
    const duplicateKeys = new Set(duplicateGroups.flatMap((g) => g.keys));
    const items = objects.map((o) => {
      const url = `/media/${o.key}`;
      const usage = usageMap.get(url) || [];
      return {
        key: o.key,
        url,
        size: o.size,
        uploaded: o.uploaded,
        folder: meta[o.key]?.folder || null,
        tags: meta[o.key]?.tags || [],
        alt_text: meta[o.key]?.alt_text || null,
        caption: meta[o.key]?.caption || null,
        credit: meta[o.key]?.credit || null,
        license: meta[o.key]?.license || null,
        hash: meta[o.key]?.hash || null,
        private: !!meta[o.key]?.private,
        width: meta[o.key]?.width || null,
        height: meta[o.key]?.height || null,
        isDuplicate: duplicateKeys.has(o.key),
        used: usage.length > 0,
        // Flattened "type: title" strings — the library's usage filter
        // does a plain substring match against these, same as it already
        // does for filename/tags, rather than the client needing to know
        // this shape.
        usage: usage.map((u) => (u.title ? `${u.type}: ${u.title}` : u.type)),
      };
    });
    return json(paged ? { items, next } : items);
  }
      if (path === "/media/bulk-delete" && method === "POST") {
    const body = await readJsonBody(request);
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (!keys.length) return json({ error: "No files selected" }, { status: 400 });
    // Mirrors the single-item DELETE route above: without this, a file's
    // "Overwrite" version history (both the archived R2 bytes under
    // _versions/ and their media_versions rows) survived the file's own
    // deletion when done through a bulk selection instead of one at a
    // time -- orphaned R2 objects with nothing left pointing to them, and
    // dead D1 rows next to them. A real bug found while testing an
    // unrelated feature, fixed here since it's the same shape as the
    // existing single-delete cleanup and touches the same table.
    await Promise.all(
      keys.map(async (k) => {
        const versions = await listMediaVersions(env, k);
        await Promise.all(versions.map((v) => env.MEDIA.delete(v.version_key)));
        await deleteMediaVersions(env, k);
        await env.MEDIA.delete(k);
        await deleteMediaMeta(env, k);
      })
    );
    log(ctx, env, "delete", "media", `${keys.length} file(s)`);
    return json({ ok: true });
  }
  const mediaKeyMatch = path.match(/^\/media\/(.+)$/);
  if (mediaKeyMatch && method === "DELETE") {
    const versions = await listMediaVersions(env, mediaKeyMatch[1]);
    await Promise.all(versions.map((v) => env.MEDIA.delete(v.version_key)));
    await deleteMediaVersions(env, mediaKeyMatch[1]);
    await env.MEDIA.delete(mediaKeyMatch[1]);
    await deleteMediaMeta(env, mediaKeyMatch[1]);
    log(ctx, env, "delete", "media", mediaKeyMatch[1].split("/").pop());
    return json({ ok: true });
  }
  if (mediaKeyMatch && method === "PATCH") {
    const body = await readJsonBody(request);
    // Editing the details of a file that has been deleted would otherwise create a ghost row holding them.
    const known = (await env.DB.prepare("SELECT 1 AS ok FROM media WHERE key = ?").bind(mediaKeyMatch[1]).first()) || (await env.MEDIA.head(mediaKeyMatch[1]));
    if (!known) return json({ error: "That file no longer exists" }, { status: 404 });
    await upsertMediaMeta(env, mediaKeyMatch[1], body);
    return json({ ok: true });
  }
      // Overwrites an existing upload's bytes in place — same key, same public
  // URL — used by the photo editor's "Overwrite original" save. The bytes
  // being replaced are archived first (under a `_versions/` prefix, kept
  // out of the main `uploads/` listing) so the overwrite itself can be
  // undone later, the one gap plain in-place replacement otherwise has.
  if (mediaKeyMatch && method === "PUT") {
    const contentType = request.headers.get("Content-Type") || "";
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowed.includes(contentType)) {
      return json({ error: "Only PNG, JPEG, WebP, or GIF images are allowed" }, { status: 400 });
    }
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 8 * 1024 * 1024) {
      return json({ error: "File too large (8MB max)" }, { status: 400 });
    }
    const key = mediaKeyMatch[1];
    const existingObj = await env.MEDIA.get(key);
    if (!existingObj) return json({ error: "Original file not found" }, { status: 404 });
    const versionKey = `_versions/${key}/${Date.now()}`;
    await env.MEDIA.put(versionKey, await existingObj.arrayBuffer(), { httpMetadata: existingObj.httpMetadata });
    await recordMediaVersion(env, key, versionKey, existingObj.size);
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType } });
    // Recompute width/height against the new bytes -- a critic pass found
    // an overwrite (e.g. the photo editor cropping the image) otherwise
    // left the old dimensions in place, so a page rendering this image
    // would reserve the wrong amount of layout space for the new file,
    // exactly the failure mode this whole feature exists to prevent.
    // This is an UPDATE on an existing row (unlike a fresh /upload
    // INSERT), so passing `undefined` here would make upsertMediaMeta
    // skip the width/height columns entirely and leave the old file's
    // now-stale dimensions in place when the new bytes can't be parsed --
    // explicit `null` is required to actually clear them.
    const dims = readImageDimensions(buf, contentType);
    await upsertMediaMeta(env, key, { width: dims ? dims.width : null, height: dims ? dims.height : null });
    return json({ url: `/media/${key}` });
  }
        
  
            
        







  
      
    

  // /revisions?kind=page|article|project&id=N — history for a page's blocks,
  // an article, or a project
  if (path === "/revisions" && method === "GET") {
    const kind = url.searchParams.get("kind");
    const id = Number(url.searchParams.get("id"));
    if (!["page", "article", "project"].includes(kind) || !id) {
      return json({ error: "Invalid kind/id" }, { status: 400 });
    }
    return json(await listRevisions(env, kind, id));
  }
  // /revisions/:id — a single revision's full snapshot, for a diff preview
  // before committing to restoring it.
  const revisionDetailMatch = path.match(/^\/revisions\/(\d+)$/);
  if (revisionDetailMatch && method === "GET") {
    const rev = await getRevision(env, Number(revisionDetailMatch[1]));
    if (!rev) return json({ error: "Not found" }, { status: 404 });
    return json(rev);
  }
  const restoreMatch = path.match(/^\/revisions\/(\d+)\/restore$/);
  if (restoreMatch && method === "POST") {
    const body = await readJsonBody(request);
    const revisionId = Number(restoreMatch[1]);
    const entityId = Number(body.entity_id);
    try {
      if (body.kind === "page") await restorePageRevision(env, entityId, revisionId);
      else if (body.kind === "article") await restoreArticleRevision(env, entityId, revisionId);
      else if (body.kind === "project") await restoreProjectRevision(env, entityId, revisionId);
      else return json({ error: "Invalid kind" }, { status: 400 });
    } catch (err) {
      return json({ error: err.message || "Restore failed" }, { status: 400 });
    }
    log(ctx, env, "restore-revision", body.kind, `#${entityId}`);
    return json({ ok: true });
  }
  const restoreBlockMatch = path.match(/^\/revisions\/(\d+)\/restore-block$/);
  if (restoreBlockMatch && method === "POST") {
    const body = await readJsonBody(request);
    const revisionId = Number(restoreBlockMatch[1]);
    const pageId = Number(body.entity_id);
    const blockId = Number(body.block_id);
    try {
      await restorePageRevisionBlock(env, pageId, revisionId, blockId);
    } catch (err) {
      return json({ error: err.message || "Restore failed" }, { status: 400 });
    }
    log(ctx, env, "restore-revision", "page block", `#${blockId} on page #${pageId}`);
    return json({ ok: true });
  }

        
                    
                
  // /export — a full JSON backup, downloaded straight from the browser
  if (path === "/export" && method === "GET") {
    const data = await exportAll(env);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="dominickdominick-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  }

  // /import — replaces ALL content with the uploaded backup, atomically
  // /import-preview — what the file would change (rows per table: backup vs site now), without changing anything
  if (path === "/import-preview" && method === "POST") {
    const body = await readJsonBody(request);
    try {
      return json(await compareBackupToSite(env, body));
    } catch (err) {
      return json({ error: err.message || "Not a valid backup file" }, { status: 400 });
    }
  }
  if (path === "/scheduled-backups-preview" && method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) return json({ error: "key is required" }, { status: 400 });
    try {
      return json(await previewScheduledBackup(env, key));
    } catch (err) {
      return json({ error: err.message }, { status: 400 });
    }
  }
  if (path === "/import" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || !Array.isArray(body.pages)) return json({ error: "Not a valid backup file" }, { status: 400 });
    // The site as it is now is saved first; if that can't be done and verified, nothing is replaced.
    let safetyKey;
    try {
      safetyKey = await runSafetyBackup(env);
    } catch (err) {
      return json({ error: `Couldn't save a safety copy of the site first, so nothing was changed (${err.message || "backup failed"}).` }, { status: 500 });
    }
    try {
      await importAll(env, body);
    } catch (err) {
      return json({ error: err.message || "Import failed" }, { status: 400 });
    }
    log(ctx, env, "import", "backup", `${body.exported_at || "unknown date"}; previous site saved as ${safetyKey}`);
    return json({ ok: true, safetyBackup: safetyKey });
  }

  // /scheduled-backups — the automatic daily R2 backups (separate from the
  // on-demand "Download backup" export above)
  if (path === "/scheduled-backups" && method === "GET") {
    return json(await listScheduledBackups(env));
  }
  if (path === "/scheduled-backups/run" && method === "POST") {
    const key = await runScheduledBackup(env);
    log(ctx, env, "create", "backup", key);
    return json({ key });
  }
  if (path === "/backup-status" && method === "GET") {
    return json(await getBackupStatus(env));
  }
    // /scheduled-backups-contents?key=... — a query param, not a path
  // segment, since a backup key contains slashes (backups/2026-...json).
  if (path === "/scheduled-backups-contents" && method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) return json({ error: "key is required" }, { status: 400 });
    try {
      return json(await getBackupContents(env, key));
    } catch (err) {
      return json({ error: err.message }, { status: 400 });
    }
  }
  // /scheduled-backups-verify?key=... — re-hashes the file as it sits in R2
  // right now and compares it to the checksum stored when it was written,
  // catching corruption/truncation before it's discovered mid-restore.
  if (path === "/scheduled-backups-verify" && method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) return json({ error: "key is required" }, { status: 400 });
    try {
      return json(await verifyBackupIntegrity(env, key));
    } catch (err) {
      return json({ error: err.message }, { status: 400 });
    }
  }
  // /scheduled-backups-download?key=... — streams a specific historical
  // backup back to the browser, same as the on-demand /export above but
  // for a chosen point-in-time snapshot instead of always "right now."
  if (path === "/scheduled-backups-download" && method === "GET") {
    const key = url.searchParams.get("key");
    if (!key || !key.startsWith("backups/")) return json({ error: "Invalid key" }, { status: 400 });
    const obj = await env.MEDIA.get(key);
    if (!obj) return json({ error: "Backup file not found" }, { status: 404 });
    return new Response(obj.body, {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${key.split("/").pop()}"` },
    });
  }
  // /scheduled-backups-restore — replaces ALL content with a specific R2-
  // stored scheduled backup, same destructive all-or-nothing semantics as
  // /import (which this reuses under the hood), just sourced from a chosen
  // historical snapshot instead of an uploaded file.
  if (path === "/scheduled-backups-restore" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body.key) return json({ error: "key is required" }, { status: 400 });
    // The chosen file has to exist before the site is touched or a safety copy is made for nothing.
    if (!String(body.key).startsWith("backups/") || !(await env.MEDIA.head(body.key))) return json({ error: "Backup file not found" }, { status: 400 });
    let safetyKey;
    try {
      safetyKey = await runSafetyBackup(env);
    } catch (err) {
      return json({ error: `Couldn't save a safety copy of the site first, so nothing was changed (${err.message || "backup failed"}).` }, { status: 500 });
    }
    try {
      const { exported_at } = await restoreScheduledBackup(env, body.key);
      log(ctx, env, "import", "backup", `${body.key} (${exported_at || "unknown date"}); previous site saved as ${safetyKey}`);
      return json({ ok: true, safetyBackup: safetyKey });
    } catch (err) {
      return json({ error: err.message || "Restore failed" }, { status: 400 });
    }
  }


  // /errors — recent uncaught worker errors, for the error log viewer
  if (path === "/errors" && method === "GET") {
    return json(await listErrors(env, Number(url.searchParams.get("limit")) || 50));
  }

  // /client-error — the same error_log the worker's own uncaught-exception
  // handler already writes to, fed from the browser side instead. Previously
  // only server-side crashes ever landed here — an uncaught JS error inside
  // the Photo Editor, Song builder, or Simulation builder (all admin-only,
  // canvas/Web-Audio-heavy code with real crash surface) just vanished with
  // nothing to look back at later. `source` is folded into the existing
  // `path` column with a "client:" prefix so the one viewer already built
  // for this table can tell client crashes apart from worker ones at a
  // glance, without a schema change.
  if (path === "/client-error" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body.message) return json({ error: "message is required" }, { status: 400 });
    await logError(env, {
      message: body.message,
      stack: body.stack || null,
      path: `client:${body.source || "unknown"}`,
    });
    return json({ ok: true });
  }

              
  
  
  // /settings — SETTINGS_KEYS is the single source of truth for which keys
  // exist; add a new setting here once instead of in both GET and PUT.
  if (path === "/settings" && method === "GET") {
    const values = await Promise.all(SETTINGS_KEYS.map((key) => getSetting(env, key)));
    const result = {};
    SETTINGS_KEYS.forEach((key, i) => {
      result[key] = values[i] || "";
    });
    return json(result);
  }
  if (path === "/settings" && method === "PUT") {
    const body = await readJsonBody(request);
    // Every key not in the body is saved as "", so a body with none of them
    // would wipe the whole site's settings.
    if (!SETTINGS_KEYS.some((key) => key in body)) {
      return json({ error: "No settings were supplied." }, { status: 400 });
    }
    // A settings save used to log as a bare "Updated settings" with no
    // detail — the Activity Log told you *when* something changed, never
    // *what*, so finding/reversing a specific change meant remembering
    // which of the 7 tabs it was on and re-checking every field by eye.
    // Diffing old vs. new per-key gives a real changelog entry instead.
    // Values are truncated (some, like custom_head, can be long HTML) and
    // a key with no actual change is left out entirely.
    // The footer layout is stored normalised, so what is saved is exactly what the site will render.
    if (body.site_footer_links) {
      const cleaned = cleanFooterLinks(body.site_footer_links);
      body.site_footer_links = cleaned ? JSON.stringify(cleaned) : "";
    }
    const before = await Promise.all(SETTINGS_KEYS.map((key) => getSetting(env, key)));
    const truncate = (v) => (v ? clipChars(v, 60) : v);
    const changes = SETTINGS_KEYS.map((key, i) => {
      const oldVal = before[i] || "";
      const newVal = body[key] || "";
      if (oldVal === newVal) return null;
      return `${key}: "${truncate(oldVal)}" → "${truncate(newVal)}"`;
    }).filter(Boolean);
    await Promise.all(SETTINGS_KEYS.map((key) => setSetting(env, key, body[key] || "")));
    // A re-save with nothing actually different (e.g. just opening and
    // closing the tab) used to still log "no changes" every time — noise
    // in the exact log this diff was built to make useful. Skip it.
    if (changes.length) {
      // Each value is already truncated, but saving several keys at once
      // joins them into one string with no overall cap — since the
      // Activity Log renders this with no title="" attribute, an
      // unbounded join can run off the edge of the row with no way to
      // see the rest. Same 60-char-ish budget as a single value.
      let combined = changes.join("; ");
      combined = clipChars(combined, 240);
      log(ctx, env, "update", "settings", combined);
    }
    return json({ ok: true });
  }

          
  // /features — the Features board: what has been built (features.json, updated with each change) and the owner's own requests
  // (one settings row each, so no schema change; see worker/features.js).
  if (path === "/features" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE ? ORDER BY key").bind(`${REQUEST_PREFIX}%`).all();
    const requests = results.map(readRequestRow).filter(Boolean).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return json({ updated: FEATURES.updated, items: FEATURES.items, counts: countByStatus(FEATURES.items), requests });
  }
        
        
      
      
        
        
  // /selection-presets — named photo-editor selections, same settings-blob
  // storage pattern as the presets above (own key, own validation). A
  // selection is stored as the shapes that made it (rect/ellipse boxes and
  // polygon/lasso points, all as fractions of the image size 0..1), not as
  // pixels, so it applies to any image size and stays small.
  const SELECTION_KINDS = new Set(["rect", "ellipse", "poly"]);
  const SELECTION_MODES = new Set(["add", "sub", "int"]);
    const SELECTION_MAX_OPS = 40;
  const SELECTION_MAX_POINTS = 2000;
  const unitFraction = (n) => Math.max(0, Math.min(1, Math.round(n * 10000) / 10000));
  function cleanSelectionOps(ops) {
    if (!Array.isArray(ops) || ops.length < 1 || ops.length > SELECTION_MAX_OPS) return null;
    const out = [];
    let points = 0;
    for (const op of ops) {
      if (op && typeof op === "object" && op.kind === "invert") {
        out.push({ kind: "invert" });
        continue;
      }
      if (!op || typeof op !== "object" || !SELECTION_KINDS.has(op.kind) || !SELECTION_MODES.has(op.mode)) return null;
      if (op.kind === "poly") {
        if (!Array.isArray(op.pts) || op.pts.length < 3) return null;
        points += op.pts.length;
        if (points > SELECTION_MAX_POINTS) return null;
        const pts = [];
        for (const pt of op.pts) {
          if (!Array.isArray(pt) || pt.length !== 2 || typeof pt[0] !== "number" || typeof pt[1] !== "number" || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return null;
          pts.push([unitFraction(pt[0]), unitFraction(pt[1])]);
        }
        out.push({ kind: "poly", mode: op.mode, pts });
      } else {
        if (!Array.isArray(op.box) || op.box.length !== 4 || op.box.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
        // Clamp each edge to the image, so a box hanging off one side keeps only
        // the part that is inside it.
        const [bx, by, bw, bh] = op.box;
        const x0 = unitFraction(bx);
        const y0 = unitFraction(by);
        const x1 = unitFraction(bx + bw);
        const y1 = unitFraction(by + bh);
        if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
        out.push({ kind: op.kind, mode: op.mode, box: [x0, y0, unitFraction(x1 - x0), unitFraction(y1 - y0)] });
      }
    }
    return out;
  }
        
      
  return json({ error: "Not found" }, { status: 404 });
}
