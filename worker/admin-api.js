import {
  RESERVED_SLUGS,
  listPages,
  createPage,
  updatePage,
  setPagePassword,
  getNavAdminOnlyIds,
  getNoindexItems,
  setNoindexItem,
  setNavAdminOnly,
  deletePage,
  restorePage,
  hardDeletePage,
  listTrashedPages,
  duplicatePage,
  duplicateArticle,
  convertArticleToProject,
  duplicateProject,
  listBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
  listArticles,
  createArticle,
  updateArticle,
  deleteArticle,
  restoreArticle,
  hardDeleteArticle,
  listTrashedArticles,
  bulkArticleAction,
  bulkProjectAction,
  listTemplates,
  createTemplate,
  deleteTemplate,
  getMediaMeta,
  upsertMediaMeta,
  deleteMediaMeta,
  listMediaRevisions,
  restoreMediaRevision,
  recordMediaVersion,
  listMediaVersions,
  getMediaVersion,
  deleteMediaVersions,
  listMediaFolders,
  findMediaUsage,
  getAllMediaUsage,
  getDuplicateMediaHashes,
  logActivity,
  listActivityLog,
  listErrors,
  logError,
  runScheduledBackup,
  runSafetyBackup,
  compareBackupToSite,
  previewScheduledBackup,
  listScheduledBackups,
  getBackupStatus,
  getNotificationSummary,
  getStorageUsage,
  getBackupContents,
  verifyBackupIntegrity,
  restoreScheduledBackup,
  runFindReplace,
  slugExists,
  getLoginLockout,
  loginLockoutMessage,
  recordLoginAttempt,
  alertLoginFailures,
  LOGIN_ALERT_AFTER,
  getSetting,
  logWebhookDelivery,
  listWebhookDeliveries,
  getWebhookDelivery,
  createPreviewLink,
  listPreviewLinks,
  revokePreviewLink,
  setSetting,
  getAnalytics,
  getTopArticles,
  getRawAnalyticsEvents,
  exportAll,
  importAll,
  listRedirects,
  createRedirect,
  getRedirect,
  updateRedirect,
  deleteRedirect,
  maybeSnapshotPage,
  snapshotPageNow,
  snapshotArticle,
  listRevisions,
  getRevision,
  restorePageRevision,
  restoreArticleRevision,
  restorePageRevisionBlock,
  search,
  checkLinks,
  getLinkCheckStatus,
  runScheduledLinkCheck,
  publishWebhookPayload,
  getSeoReport,
  checkAccessibility,
  getOrphanContent,
  getContentHealth,
  getContentIntegrity,
  getTagCounts,
  listTopicMeta,
  setTopicMeta,
  deleteTopicMeta,
  listScans,
  getScan,
  createScan,
  updateScan,
  deleteScan,
  findContentUsage,
  listSimulations,
  getSimulation,
  publishSimulation,
  unpublishSimulation,
  createSimulation,
  updateSimulation,
  deleteSimulation,
  duplicateSimulation,
  listSongs,
  getSong,
  createSong,
  updateSong,
  deleteSong,
  duplicateSong,
  getBlockPageId,
  getBlockSharedId,
  listSharedBlocks,
  getSharedBlock,
  createSharedBlock,
  updateSharedBlock,
  deleteSharedBlock,
  findSharedBlockUsage,
  detachSharedBlock,
  listProjects,
  createProject,
  MAX_RELATED_SONGS,
  updateProject,
  deleteProject,
  restoreProject,
  hardDeleteProject,
  countOrphanedHistory,
  purgeOrphanedHistory,
  listTrashedProjects,
  snapshotProject,
  restoreProjectRevision,
  listJournalEntries,
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  listBomItems,
  createBomItem,
  updateBomItem,
  deleteBomItem,
  MIN_PUBLISH_BODY_LENGTH,
  publishBodyTooShort,
  sha256Hex,
  plausibleDims,
} from "./db.js";
import { cleanBodyFields, cleanPageCss, pageCssKey } from "./text.js";
import { cleanBrand, cleanNavBuiltin } from "./nav-settings.js";
import { cleanRedirectStatus, cleanRedirectTarget } from "./redirects.js";
import { cleanScanFields } from "./scans.js";
import { SCRIPT_MAX, SCRIPT_PREFIX, cleanScript, isScriptId, readScriptRow, scriptKey } from "./scripts.js";
import { cleanSongSave } from "./songs.js";
import { outlineConfig, readOutline } from "./outline.js";
import { cleanFooterLinks } from "./render.js";
import { checkPassword, createSessionCookie, clearSessionCookie, isAuthenticated, hmac, revokeAllSessions } from "./auth.js";
import { normalizeLegacySimulationWireIds, simulationDataError } from "./simulation-validation.js";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

function normalizePath(p) {
  let s = String(p || "").trim();
  if (!s) return "";
  if (!s.startsWith("/")) s = "/" + s;
  if (s.length > 1) s = s.replace(/\/+$/, "");
  return s;
}

// A redirect's to_path can be a full external URL (new URL(to_path, origin)
// in the request-serving code handles both) as well as an internal path —
// an external destination is always a safe dead end for loop-detection
// purposes, since the serving code only ever looks up from_path matches in
// this site's own redirects table, so it can never be revisited as part of
// a chain. Only normalize (leading slash, no trailing slash) when it looks
// like an internal path — running an absolute URL through normalizePath
// would corrupt it (prepending a stray "/").
function normalizeRedirectTarget(p) {
  return /^https?:\/\//i.test(p) ? p : normalizePath(p);
}

// Redirects can chain (A -> B, B -> C, ...), and the request-serving code
// does a single-hop lookup per request with no server-side chain
// resolution — so a cycle anywhere in the chain becomes an actual
// browser-visible redirect loop, not just a modeling inconvenience. Walks
// the graph with the pending edge applied (so it catches a loop this exact
// change would create, not just ones that already exist) starting from
// to_path: a direct self-redirect (A -> A) is just the zero-hop case of
// this same walk, so this replaces the old separate, narrower
// from_path === to_path check entirely rather than needing both — that
// check only ever caught the zero-hop case and, being POST-only, never
// caught it on PATCH at all.
async function wouldCreateRedirectLoop(env, fromPath, toPath, excludeId) {
  const rows = await listRedirects(env);
  const map = new Map();
  for (const r of rows) {
    if (excludeId != null && r.id === excludeId) continue;
    map.set(r.from_path, r.to_path);
  }
  map.set(fromPath, toPath);
  let current = normalizeRedirectTarget(toPath);
  const seen = new Set();
  // The `seen` check below already detects any cycle exactly, so the hop
  // cap only needs to be large enough that a genuinely non-cyclic chain can
  // finish walking before hitting it -- a chain can visit at most map.size
  // distinct from_paths before it must either terminate or repeat one
  // (pigeonhole), so bounding on the graph's own size (rather than a fixed
  // constant like 25) means a long-but-real redirect chain can no longer be
  // misreported as a loop just for being longer than an arbitrary cutoff.
  const maxHops = map.size + 1;
  for (let hops = 0; hops < maxHops; hops++) {
    if (current === fromPath) return true;
    const next = map.get(current);
    if (next === undefined) return false;
    if (seen.has(current)) return false; // a separate, pre-existing loop this edge doesn't participate in
    seen.add(current);
    current = normalizeRedirectTarget(next);
  }
  return true; // hop limit hit without terminating -- treat defensively as a loop
}

const SETTINGS_KEYS = [
  "default_og_image",
  "theme_accent",
  "theme_bg",
  "theme_font",
  "theme_text",
  "theme_border",
  "theme_heading_font",
  "site_footer",
  "site_footer_links",
  "site_brand",
  "nav_builtin",
  "custom_head",
  "webhook_url",
  "webhook_on_project_publish",
  "webhook_on_backup_failure",
  "webhook_on_login_failures",
  "mobile_breakpoint",
  "empty_search_text",
  "empty_archive_text",
  "empty_topics_text",
  "maintenance_mode",
  "maintenance_message",
  "custom_font_name",
  "custom_font_url",
  // Buttons & controls presets -- see CONTROL_PRESETS in render.js.
  "control_shape",
  "control_size",
  "control_outline",
  "field_shape",
  "card_shape",
  "space_scale",
  "shadow_strength",
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

// related_songs must be a short list of whole-number ids; anything else is a 400
// rather than being quietly reshaped.
function relatedSongsError(body) {
  if (!body || body.related_songs === undefined) return null;
  const list = body.related_songs;
  if (!Array.isArray(list)) return "related_songs must be a list of song ids.";
  if (list.length > MAX_RELATED_SONGS) return `A project can list at most ${MAX_RELATED_SONGS} songs.`;
  const okId = (v) => (typeof v === "number" ? Number.isSafeInteger(v) && v > 0 : typeof v === "string" && /^[0-9]{1,15}$/.test(v) && Number(v) > 0);
  return list.every(okId) ? null : "related_songs must contain only positive whole-number song ids.";
}

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

// The request body as text, or null once it passes maxBytes. Bytes are counted
// as they arrive and nothing past the cap is kept, so a chunked upload with no
// Content-Length can't be buffered whole. A modestly oversized body is read on
// (and discarded) to the end so the client gets a clean 413 instead of a cut
// connection; a truly huge one is dropped where it stands.
const OVERSIZE_DRAIN_BYTES = 4 * 1024 * 1024;
async function readBodyTextCapped(request, maxBytes) {
  if (Number(request.headers.get("content-length") || 0) > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  let chunks = [];
  let size = 0;
  let over = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      over = true;
      chunks = [];
      if (size > OVERSIZE_DRAIN_BYTES) break;
    } else if (!over) {
      chunks.push(value);
    }
  }
  if (over) return null;
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decodeUtf8(all);
}

// Journal entry dates are plain YYYY-MM-DD strings (compared as text by the public reads).
function validEntryDate(v, optional) {
  if (v === undefined || v === null || v === "") return !!optional;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export async function handleAdminApi(request, env, url, ctx) {
  try {
    return await routeAdminApi(request, env, url, ctx);
  } catch (err) {
    if (err instanceof BadRequestError) return json({ error: err.message }, { status: 400 });
    return json({ error: err.message || "Something went wrong" }, { status: 500 });
  }
}

// Actually sends a webhook payload and records what happened either way —
// used both for the automatic publish-trigger below and for retrying a
// past delivery from the history list with the exact same payload.
async function deliverWebhook(env, webhookUrl, payload) {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await logWebhookDelivery(env, {
      url: webhookUrl,
      payload,
      status: res.ok ? "success" : "failed",
      status_code: res.status,
      error: res.ok ? null : `HTTP ${res.status}`,
    });
  } catch (err) {
    await logWebhookDelivery(env, { url: webhookUrl, payload, status: "failed", error: err.message || "Request failed" });
  }
}

// A configured webhook fires (best-effort, non-blocking) the moment an
// article transitions into "published" — not on every subsequent edit.
// contentType defaults to "article" (the original, always-on trigger) so
// every existing call site keeps working unchanged. Project publish is a
// second, separately configurable trigger — off by default, since it's
// new behavior an existing webhook consumer wasn't built to expect.
// webhook_url holds one URL per line (multiple endpoints, e.g. separate
// build hooks for a couple of downstream services) — every non-blank line
// gets its own independent delivery attempt/history row, so one endpoint
// being down doesn't affect whether the others get called or get retried.
async function maybeFireWebhook(env, ctx, { wasPublished, article, contentType = "article" }) {
  if (wasPublished || !article.published_at || article.published_at > new Date().toISOString()) return;
  if (contentType === "project") {
    const enabled = await getSetting(env, "webhook_on_project_publish");
    if (!enabled) return;
  }
  const rawUrls = await getSetting(env, "webhook_url");
  const webhookUrls = (rawUrls || "").split("\n").map((u) => u.trim()).filter(Boolean);
  if (!webhookUrls.length) return;
  const payload = publishWebhookPayload(contentType, article);
  for (const webhookUrl of webhookUrls) {
    ctx.waitUntil(deliverWebhook(env, webhookUrl, payload));
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

// Keep one backfill request below the Workers Free subrequest budget even
// when every file needs one R2 read and a metadata update. The UI resumes
// with the opaque R2 cursor until the listing is complete.
const MEDIA_BACKFILL_PAGE_SIZE = 20;
async function listUploadedMediaPage(bucket, cursor) {
  const page = await bucket.list({
    prefix: "uploads/",
    limit: MEDIA_BACKFILL_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
  });
  if (page.truncated && !page.cursor) {
    throw new Error("R2 returned a truncated media listing without a cursor");
  }
  return page;
}

// A model file that is new to a scan (create, or an edit that swaps it) has to exist in storage and belong to no other scan:
// deleting a scan, or replacing its file, deletes the old file from storage.
async function scanKeyProblem(env, fields, selfId, before) {
  for (const col of ["glb_key", "usdz_key"]) {
    const key = fields[col];
    if (!key || (before && before[col] === key)) continue;
    if (!(await env.MEDIA.head(key))) return "That model file was not found. Upload it again.";
    const other = await env.DB.prepare("SELECT id FROM scans WHERE (glb_key = ? OR usdz_key = ?) AND id != ?").bind(key, key, selfId ?? -1).first();
    if (other) return "That model file already belongs to another scan.";
  }
  return null;
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
      if (failures === LOGIN_ALERT_AFTER) ctx.waitUntil(alertLoginFailures(env, failures));
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

  // /pages
  // Which pages, articles and projects are marked noindex, for the editors' checkboxes.
  if (path === "/noindex" && method === "GET") {
    return json(await getNoindexItems(env));
  }
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
  const pageDuplicateMatch = path.match(/^\/pages\/(\d+)\/duplicate$/);
  if (pageDuplicateMatch && method === "POST") {
    const newId = await duplicatePage(env, Number(pageDuplicateMatch[1]));
    if (!newId) return json({ error: "Page not found" }, { status: 404 });
    log(ctx, env, "duplicate", "page", `#${pageDuplicateMatch[1]} → #${newId}`);
    return json({ id: newId });
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

  // /pages/:id/password — set or remove password protection. Separate from
  // the generic PATCH /pages/:id above since the client never gets the
  // current password back to round-trip (only its hash is ever stored).
  const pagePasswordMatch = path.match(/^\/pages\/(\d+)\/password$/);
  if (pagePasswordMatch && method === "PUT") {
    const body = await readJsonBody(request);
    if (typeof body.password !== "string" || body.password.trim().length < 4) {
      return json({ error: "Password must be at least 4 characters" }, { status: 400 });
    }
    const id = Number(pagePasswordMatch[1]);
    // "page-password:" keeps this HMAC's message space disjoint from the
    // session-cookie signature (see auth.js) — both share SESSION_SECRET
    // as their key, so without a distinct prefix a chosen page password
    // could double as a forged admin session signature.
    const hash = await hmac(env.SESSION_SECRET, `page-password:${body.password}`);
    await setPagePassword(env, id, hash);
    const p = await env.DB.prepare("SELECT title FROM pages WHERE id = ?").bind(id).first();
    log(ctx, env, "update", "page", `password protection set on "${p?.title || `#${id}`}"`);
    return json({ ok: true });
  }
  if (pagePasswordMatch && method === "DELETE") {
    const id = Number(pagePasswordMatch[1]);
    await setPagePassword(env, id, null);
    const p = await env.DB.prepare("SELECT title FROM pages WHERE id = ?").bind(id).first();
    log(ctx, env, "update", "page", `password protection removed from "${p?.title || `#${id}`}"`);
    return json({ ok: true });
  }

  // /pages/:id/css — per-page custom CSS, kept in the settings table so it needs no schema change
  const pageCssMatch = path.match(/^\/pages\/(\d+)\/css$/);
  if (pageCssMatch && method === "GET") {
    return json({ css: (await getSetting(env, pageCssKey(pageCssMatch[1]))) || "" });
  }
  if (pageCssMatch && method === "PUT") {
    const id = Number(pageCssMatch[1]);
    const page = await env.DB.prepare("SELECT id, title FROM pages WHERE id = ?").bind(id).first();
    if (!page) return json({ error: "Page not found" }, { status: 404 });
    const body = await readJsonBody(request);
    const cleaned = cleanPageCss(body.css);
    if (cleaned.error) return json({ error: cleaned.error }, { status: 400 });
    if (cleaned.css) await setSetting(env, pageCssKey(id), cleaned.css);
    else await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(pageCssKey(id)).run();
    log(ctx, env, "update", "page css", page.title);
    return json({ ok: true, css: cleaned.css });
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
  const blockDetachMatch = path.match(/^\/blocks\/(\d+)\/detach$/);
  if (blockDetachMatch && method === "POST") {
    const id = Number(blockDetachMatch[1]);
    const pageId = await getBlockPageId(env, id);
    if (pageId) await maybeSnapshotPage(env, pageId);
    try {
      await detachSharedBlock(env, id);
    } catch (err) {
      return json({ error: err.message }, { status: 400 });
    }
    return json({ ok: true });
  }

  // /shared-blocks — reusable block library
  if (path === "/shared-blocks" && method === "GET") {
    return json(await listSharedBlocks(env));
  }
  if (path === "/shared-blocks" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body.name || !String(body.name).trim() || !body.type) {
      return json({ error: "Name and a source block are required" }, { status: 400 });
    }
    const id = await createSharedBlock(env, { ...body, name: body.name.trim() });
    log(ctx, env, "create", "shared block", body.name.trim());
    return json({ id });
  }
  if (path === "/shared-blocks/usage" && method === "GET") {
    const sharedId = Number(url.searchParams.get("id"));
    if (!sharedId) return json({ error: "id required" }, { status: 400 });
    return json(await findSharedBlockUsage(env, sharedId));
  }
  const sharedBlockMatch = path.match(/^\/shared-blocks\/(\d+)$/);
  if (sharedBlockMatch && method === "GET") {
    const sb = await getSharedBlock(env, Number(sharedBlockMatch[1]));
    if (!sb) return json({ error: "Not found" }, { status: 404 });
    return json(sb);
  }
  if (sharedBlockMatch && method === "PATCH") {
    const body = await readJsonBody(request);
    if ("name" in body && !String(body.name).trim()) return json({ error: "Name is required" }, { status: 400 });
    await updateSharedBlock(env, Number(sharedBlockMatch[1]), body);
    return json({ ok: true });
  }
  if (sharedBlockMatch && method === "DELETE") {
    const id = Number(sharedBlockMatch[1]);
    const sb = await getSharedBlock(env, id);
    await deleteSharedBlock(env, id);
    log(ctx, env, "delete", "shared block", sb?.name || `#${id}`);
    return json({ ok: true });
  }

  // /articles
  if (path === "/articles" && method === "GET") {
    return json(await listArticles(env));
  }
  if (path === "/articles" && method === "POST") {
    const body = await readJsonBody(request);
    cleanBodyFields(body, ["og_image"]);
    const jsonLdError = validateCustomJsonLd(body);
    if (jsonLdError) return json({ error: jsonLdError }, { status: 400 });
    const canonicalError = validateCanonicalUrl(body);
    if (canonicalError) return json({ error: canonicalError }, { status: 400 });
    const slug = slugify(body.slug || body.title);
    if (!slug) return json({ error: "Title or slug required" }, { status: 400 });
    if (RESERVED_SLUGS.has(slug)) return json({ error: "Reserved slug" }, { status: 400 });
    if (await slugExists(env, "articles", slug)) {
      return json({ error: "An article with that slug already exists" }, { status: 409 });
    }
    const resolvedPublishedAt = body.published_at !== undefined ? body.published_at : body.published ? new Date().toISOString() : null;
    // Any non-null published_at — not just one that's already in the past —
    // commits this article to eventually going live with whatever body it
    // has right now; nothing re-checks length at the moment a *future*
    // published_at actually arrives, so scheduling ahead can't be used to
    // dodge this the way checking only "publishing right now" allowed.
    if (resolvedPublishedAt && publishBodyTooShort(body.body)) {
      return json({ error: `Body needs more than ${MIN_PUBLISH_BODY_LENGTH} characters before publishing.` }, { status: 400 });
    }
    const id = await createArticle(env, { ...body, slug });
    log(ctx, env, "create", "article", body.title || slug);
    await maybeFireWebhook(env, ctx, {
      wasPublished: false,
      article: { title: body.title, slug, published_at: body.published_at },
    });
    return json({ id, slug });
  }
  const articleMatch = path.match(/^\/articles\/(\d+)$/);
  if (articleMatch && method === "PATCH") {
    const body = await readJsonBody(request);
    cleanBodyFields(body, ["og_image"]);
    const jsonLdError = validateCustomJsonLd(body);
    if (jsonLdError) return json({ error: jsonLdError }, { status: 400 });
    const canonicalError = validateCanonicalUrl(body);
    if (canonicalError) return json({ error: canonicalError }, { status: 400 });
    const id = Number(articleMatch[1]);
    const conflict = await checkConflict(env, "articles", id, body.expected_version);
    if (conflict) return conflict;
    if ("noindex" in body) {
      await setNoindexItem(env, "article", id, body.noindex === true);
      delete body.noindex;
    }
    if (body.slug) {
      body.slug = slugify(body.slug);
      if (await slugExists(env, "articles", body.slug, id)) {
        return json({ error: "An article with that slug already exists" }, { status: 409 });
      }
    }
    const before = await env.DB.prepare("SELECT slug, title, published_at, body FROM articles WHERE id = ?").bind(id).first();
    const wasPublished = !!(before && before.published_at && before.published_at <= new Date().toISOString());
    const newPublishedAt = "published_at" in body ? body.published_at : before && before.published_at;
    const isNowPublished = !!(newPublishedAt && newPublishedAt <= new Date().toISOString());
    // Same reasoning as the POST /articles check above: a draft picking up
    // *any* published_at (now or scheduled ahead) is what needs the body
    // check, not just one landing in the past already.
    const hadAnyPublishDate = !!(before && before.published_at);
    if (!hadAnyPublishDate && newPublishedAt) {
      const effectiveBody = "body" in body ? body.body : before && before.body;
      if (publishBodyTooShort(effectiveBody)) {
        return json({ error: `Body needs more than ${MIN_PUBLISH_BODY_LENGTH} characters before publishing.` }, { status: 400 });
      }
    }
    await snapshotArticle(env, id);
    await updateArticle(env, id, body);
    if (body.slug && before) {
      await maybeCreateSlugRedirect(env, ctx, { oldSlug: before.slug, newSlug: body.slug, pathPrefix: "/random/", isLive: wasPublished });
    }
    // Only the publish/unpublish transition is logged — plain content edits
    // fire this same endpoint every couple of seconds via autosave, which
    // would otherwise flood the log with noise revisions already capture.
    if (wasPublished !== isNowPublished) {
      log(ctx, env, isNowPublished ? "publish" : "unpublish", "article", body.title || (before && before.title));
    }
    await maybeFireWebhook(env, ctx, {
      wasPublished,
      article: {
        title: body.title || (before && before.title),
        slug: body.slug || (before && before.slug),
        published_at: newPublishedAt,
      },
    });
    const fresh = await env.DB.prepare("SELECT version, slug FROM articles WHERE id = ?").bind(id).first();
    return json({ ok: true, version: fresh?.version, slug: fresh?.slug });
  }
  if (articleMatch && method === "DELETE") {
    const id = Number(articleMatch[1]);
    const a = await env.DB.prepare("SELECT title FROM articles WHERE id = ?").bind(id).first();
    await deleteArticle(env, id);
    log(ctx, env, "trash", "article", a?.title || `#${id}`);
    return json({ ok: true });
  }
  if (path === "/articles/bulk" && method === "POST") {
    const body = await readJsonBody(request);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) return json({ error: "No articles selected" }, { status: 400 });
    if (!["publish", "unpublish", "trash", "add-tag"].includes(body.action)) {
      return json({ error: "Invalid action" }, { status: 400 });
    }
    const result = await bulkArticleAction(env, ids, body.action, { tag: body.tag });
    log(
      ctx,
      env,
      body.action,
      "article",
      `${result.affected} article(s)${result.skippedLocked ? `, ${result.skippedLocked} skipped (locked)` : ""}${
        result.skippedTooShort ? `, ${result.skippedTooShort} skipped (body too short)` : ""
      }`
    );
    return json({ ok: true, ...result });
  }
  if (path === "/articles/trash" && method === "GET") {
    return json(await listTrashedArticles(env));
  }
  const articleRestoreMatch = path.match(/^\/articles\/(\d+)\/restore$/);
  if (articleRestoreMatch && method === "POST") {
    const id = Number(articleRestoreMatch[1]);
    await restoreArticle(env, id);
    const a = await env.DB.prepare("SELECT title FROM articles WHERE id = ?").bind(id).first();
    log(ctx, env, "restore", "article", a?.title || `#${id}`);
    return json({ ok: true });
  }
  const articlePermanentMatch = path.match(/^\/articles\/(\d+)\/permanent$/);
  if (articlePermanentMatch && method === "DELETE") {
    const id = Number(articlePermanentMatch[1]);
    const a = await env.DB.prepare("SELECT title, deleted_at FROM articles WHERE id = ?").bind(id).first();
    // The UI only offers this from the Trash; refuse a live item rather than deleting it with no way back.
    if (a && !a.deleted_at) return json({ error: "Move it to the Trash first; only trashed items can be deleted permanently." }, { status: 409 });
    await hardDeleteArticle(env, id);
    log(ctx, env, "delete-forever", "article", a?.title || `#${id}`);
    return json({ ok: true });
  }
  const articleDuplicateMatch = path.match(/^\/articles\/(\d+)\/duplicate$/);
  if (articleDuplicateMatch && method === "POST") {
    const newId = await duplicateArticle(env, Number(articleDuplicateMatch[1]));
    if (!newId) return json({ error: "Article not found" }, { status: 404 });
    log(ctx, env, "duplicate", "article", `#${articleDuplicateMatch[1]} → #${newId}`);
    return json({ id: newId });
  }
  const articleConvertMatch = path.match(/^\/articles\/(\d+)\/convert-to-project$/);
  if (articleConvertMatch && method === "POST") {
    const newId = await convertArticleToProject(env, Number(articleConvertMatch[1]));
    if (!newId) return json({ error: "Article not found" }, { status: 404 });
    log(ctx, env, "convert", "article→project", `#${articleConvertMatch[1]} → project #${newId}`);
    return json({ id: newId });
  }

  // /projects
  if (path === "/projects" && method === "GET") {
    return json(await listProjects(env));
  }
  if (path === "/projects" && method === "POST") {
    const body = await readJsonBody(request);
    cleanBodyFields(body, ["summary", "og_image"]);
    const jsonLdError = validateCustomJsonLd(body);
    if (jsonLdError) return json({ error: jsonLdError }, { status: 400 });
    const canonicalError = validateCanonicalUrl(body);
    if (canonicalError) return json({ error: canonicalError }, { status: 400 });
    const slug = slugify(body.slug || body.title);
    if (!slug) return json({ error: "Title or slug required" }, { status: 400 });
    if (RESERVED_SLUGS.has(slug)) return json({ error: "Reserved slug" }, { status: 400 });
    if (await slugExists(env, "projects", slug)) {
      return json({ error: "A project with that slug already exists" }, { status: 409 });
    }
    const resolvedPublishedAt = body.published_at !== undefined ? body.published_at : body.published ? new Date().toISOString() : null;
    // See the matching comment in POST /articles above: any non-null
    // published_at, not just an immediate one, commits this to eventually
    // going live with whatever body it has now.
    if (resolvedPublishedAt && publishBodyTooShort(body.body)) {
      return json({ error: `Body needs more than ${MIN_PUBLISH_BODY_LENGTH} characters before publishing.` }, { status: 400 });
    }
    const songsError = relatedSongsError(body);
    if (songsError) return json({ error: songsError }, { status: 400 });
    const id = await createProject(env, { ...body, slug });
    log(ctx, env, "create", "project", body.title || slug);
    await maybeFireWebhook(env, ctx, {
      wasPublished: false,
      article: { title: body.title, slug, published_at: body.published_at },
      contentType: "project",
    });
    return json({ id, slug });
  }
  const projectMatch = path.match(/^\/projects\/(\d+)$/);
  if (projectMatch && method === "PATCH") {
    const body = await readJsonBody(request);
    cleanBodyFields(body, ["summary", "og_image"]);
    const jsonLdError = validateCustomJsonLd(body);
    if (jsonLdError) return json({ error: jsonLdError }, { status: 400 });
    const canonicalError = validateCanonicalUrl(body);
    if (canonicalError) return json({ error: canonicalError }, { status: 400 });
    const id = Number(projectMatch[1]);
    const conflict = await checkConflict(env, "projects", id, body.expected_version);
    if (conflict) return conflict;
    if ("noindex" in body) {
      await setNoindexItem(env, "project", id, body.noindex === true);
      delete body.noindex;
    }
    if (body.slug) {
      body.slug = slugify(body.slug);
      if (await slugExists(env, "projects", body.slug, id)) {
        return json({ error: "A project with that slug already exists" }, { status: 409 });
      }
    }
    const before = await env.DB.prepare("SELECT slug, title, published_at, body FROM projects WHERE id = ?").bind(id).first();
    const wasPublished = !!(before && before.published_at && before.published_at <= new Date().toISOString());
    const newPublishedAt = "published_at" in body ? body.published_at : before && before.published_at;
    const isNowPublished = !!(newPublishedAt && newPublishedAt <= new Date().toISOString());
    const hadAnyPublishDate = !!(before && before.published_at);
    if (!hadAnyPublishDate && newPublishedAt) {
      const effectiveBody = "body" in body ? body.body : before && before.body;
      if (publishBodyTooShort(effectiveBody)) {
        return json({ error: `Body needs more than ${MIN_PUBLISH_BODY_LENGTH} characters before publishing.` }, { status: 400 });
      }
    }
    const songsError = relatedSongsError(body);
    if (songsError) return json({ error: songsError }, { status: 400 });
    await snapshotProject(env, id);
    await updateProject(env, id, body);
    if (wasPublished !== isNowPublished) {
      log(ctx, env, isNowPublished ? "publish" : "unpublish", "project", body.title || (before && before.title));
    }
    if (body.slug && before) {
      await maybeCreateSlugRedirect(env, ctx, { oldSlug: before.slug, newSlug: body.slug, pathPrefix: "/projects/", isLive: wasPublished });
    }
    await maybeFireWebhook(env, ctx, {
      wasPublished,
      article: {
        title: body.title || (before && before.title),
        slug: body.slug || (before && before.slug),
        published_at: newPublishedAt,
      },
      contentType: "project",
    });
    const fresh = await env.DB.prepare("SELECT version, slug FROM projects WHERE id = ?").bind(id).first();
    return json({ ok: true, version: fresh?.version, slug: fresh?.slug });
  }
  if (projectMatch && method === "DELETE") {
    const id = Number(projectMatch[1]);
    const p = await env.DB.prepare("SELECT title FROM projects WHERE id = ?").bind(id).first();
    await deleteProject(env, id);
    log(ctx, env, "trash", "project", p?.title || `#${id}`);
    return json({ ok: true });
  }
  if (path === "/projects/bulk" && method === "POST") {
    const body = await readJsonBody(request);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) return json({ error: "No projects selected" }, { status: 400 });
    if (!["publish", "unpublish", "trash", "add-tag"].includes(body.action)) {
      return json({ error: "Invalid action" }, { status: 400 });
    }
    const result = await bulkProjectAction(env, ids, body.action, { tag: body.tag });
    log(
      ctx,
      env,
      body.action,
      "project",
      `${result.affected} project(s)${result.skippedLocked ? `, ${result.skippedLocked} skipped (locked)` : ""}${
        result.skippedTooShort ? `, ${result.skippedTooShort} skipped (body too short)` : ""
      }`
    );
    return json({ ok: true, ...result });
  }
  if (path === "/projects/trash" && method === "GET") {
    return json(await listTrashedProjects(env));
  }
  const projectRestoreMatch = path.match(/^\/projects\/(\d+)\/restore$/);
  if (projectRestoreMatch && method === "POST") {
    const id = Number(projectRestoreMatch[1]);
    await restoreProject(env, id);
    const p = await env.DB.prepare("SELECT title FROM projects WHERE id = ?").bind(id).first();
    log(ctx, env, "restore", "project", p?.title || `#${id}`);
    return json({ ok: true });
  }
  const projectPermanentMatch = path.match(/^\/projects\/(\d+)\/permanent$/);
  if (projectPermanentMatch && method === "DELETE") {
    const id = Number(projectPermanentMatch[1]);
    const p = await env.DB.prepare("SELECT title, deleted_at FROM projects WHERE id = ?").bind(id).first();
    // The UI only offers this from the Trash; refuse a live item rather than deleting it with no way back.
    if (p && !p.deleted_at) return json({ error: "Move it to the Trash first; only trashed items can be deleted permanently." }, { status: 409 });
    await hardDeleteProject(env, id);
    log(ctx, env, "delete-forever", "project", p?.title || `#${id}`);
    return json({ ok: true });
  }
  const projectDuplicateMatch = path.match(/^\/projects\/(\d+)\/duplicate$/);
  if (projectDuplicateMatch && method === "POST") {
    const newId = await duplicateProject(env, Number(projectDuplicateMatch[1]));
    if (!newId) return json({ error: "Project not found" }, { status: 404 });
    log(ctx, env, "duplicate", "project", `#${projectDuplicateMatch[1]} → #${newId}`);
    return json({ id: newId });
  }

  // /projects/:id/journal — a project's build journal entries
  const journalListMatch = path.match(/^\/projects\/(\d+)\/journal$/);
  if (journalListMatch && method === "GET") {
    return json(await listJournalEntries(env, Number(journalListMatch[1])));
  }
  if (journalListMatch && method === "POST") {
    const body = await readJsonBody(request);
    const projectId = Number(journalListMatch[1]);
    if (!validEntryDate(body.entry_date, true)) return json({ error: "Entry date must be a real date like 2026-09-30." }, { status: 400 });
    const id = await createJournalEntry(env, projectId, body);
    log(ctx, env, "create", "journal entry", body.title || `on project #${projectId}`);
    return json({ id });
  }
  const journalMatch = path.match(/^\/journal\/(\d+)$/);
  if (journalMatch && method === "PATCH") {
    const body = await readJsonBody(request);
    if (!validEntryDate(body.entry_date, !("entry_date" in body))) return json({ error: "Entry date must be a real date like 2026-09-30." }, { status: 400 });
    await updateJournalEntry(env, Number(journalMatch[1]), body);
    return json({ ok: true });
  }
  if (journalMatch && method === "DELETE") {
    await deleteJournalEntry(env, Number(journalMatch[1]));
    log(ctx, env, "delete", "journal entry", `#${journalMatch[1]}`);
    return json({ ok: true });
  }

  // /projects/:id/bom — a project's bill of materials
  const bomListMatch = path.match(/^\/projects\/(\d+)\/bom$/);
  if (bomListMatch && method === "GET") {
    return json(await listBomItems(env, Number(bomListMatch[1])));
  }
  if (bomListMatch && method === "POST") {
    const body = await readJsonBody(request);
    const id = await createBomItem(env, Number(bomListMatch[1]), body);
    return json({ id });
  }
  const bomMatch = path.match(/^\/bom\/(\d+)$/);
  if (bomMatch && method === "PATCH") {
    const body = await readJsonBody(request);
    await updateBomItem(env, Number(bomMatch[1]), body);
    return json({ ok: true });
  }
  if (bomMatch && method === "DELETE") {
    await deleteBomItem(env, Number(bomMatch[1]));
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

  // /upload-audio — TTS narration files for the article/project audio
  // player, kept separate from /upload (images only) rather than widening
  // that route's scope. 30MB covers a long narration at a reasonable
  // bitrate without needing a resumable-upload flow.
  if (path === "/upload-audio" && method === "POST") {
    const contentType = request.headers.get("Content-Type") || "";
    const allowed = { "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg" };
    if (!allowed[contentType]) {
      return json({ error: "Only MP3, WAV, M4A, or OGG audio files are allowed" }, { status: 400 });
    }
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 30 * 1024 * 1024) {
      return json({ error: "File too large (30MB max)" }, { status: 400 });
    }
    const key = `audio/${crypto.randomUUID()}.${allowed[contentType]}`;
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType } });
    log(ctx, env, "upload", "audio", key.split("/").pop());
    return json({ url: `/media/${key}`, key });
  }

  // /upload-video — a project's hero video, kept separate from /upload
  // (images only) for the same reason as /upload-audio above: one file per
  // project, not a reusable Media Library asset. 40MB covers a short muted
  // background loop at a reasonable bitrate without a resumable-upload flow.
  if (path === "/upload-video" && method === "POST") {
    const contentType = request.headers.get("Content-Type") || "";
    const allowed = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
    if (!allowed[contentType]) {
      return json({ error: "Only MP4, WebM, or MOV video files are allowed" }, { status: 400 });
    }
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 40 * 1024 * 1024) {
      return json({ error: "File too large (40MB max)" }, { status: 400 });
    }
    const key = `video/${crypto.randomUUID()}.${allowed[contentType]}`;
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType } });
    log(ctx, env, "upload", "video", key.split("/").pop());
    return json({ url: `/media/${key}`, key });
  }

  // /upload-font — the site's one custom font, kept separate from /upload
  // (images only) for the same reason as /upload-audio/-video above.
  // Replacing an existing custom font just overwrites the setting; the old
  // R2 object is deliberately left in place rather than deleted, matching
  // how nothing else in this codebase deletes an R2 object the moment a
  // setting stops pointing at it (e.g. default_og_image).
  if (path === "/upload-font" && method === "POST") {
    const contentType = request.headers.get("Content-Type") || "";
    const allowed = { "font/woff2": "woff2", "font/woff": "woff", "font/ttf": "ttf", "font/otf": "otf", "application/font-woff2": "woff2" };
    if (!allowed[contentType]) {
      return json({ error: "Only WOFF2, WOFF, TTF, or OTF font files are allowed" }, { status: 400 });
    }
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 5 * 1024 * 1024) {
      return json({ error: "File too large (5MB max)" }, { status: 400 });
    }
    const key = `fonts/${crypto.randomUUID()}.${allowed[contentType]}`;
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType } });
    log(ctx, env, "upload", "font", key.split("/").pop());
    return json({ url: `/media/${key}`, key });
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
  if (path === "/media/folders" && method === "GET") {
    return json(await listMediaFolders(env));
  }
  // /media/backfill-hashes — re-runnable pass over uploads from before
  // hashing existed. Existing hashes are skipped; the caller follows the
  // returned cursor across bounded requests.
  if (path === "/media/backfill-hashes" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || (body.cursor != null && typeof body.cursor !== "string")) {
      return json({ error: "Invalid media backfill cursor" }, { status: 400 });
    }
    const listed = await listUploadedMediaPage(env.MEDIA, body.cursor || undefined);
    const meta = await getMediaMeta(env, listed.objects.map((o) => o.key));
    const missing = listed.objects.filter((o) => !meta[o.key]?.hash);
    let hashed = 0;
    const statements = [];
    for (const o of missing) {
      const obj = await env.MEDIA.get(o.key);
      if (!obj) continue;
      const hash = await sha256Hex(await obj.arrayBuffer());
      statements.push(
        env.DB.prepare(
          "INSERT INTO media (key, hash) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET hash = excluded.hash"
        ).bind(o.key, hash)
      );
      hashed++;
    }
    if (statements.length) await env.DB.batch(statements);
    return json({
      hashed,
      alreadyHashed: listed.objects.length - missing.length,
      complete: !listed.truncated,
      cursor: listed.truncated ? listed.cursor : null,
    });
  }
  // /media/backfill-dimensions — same shape as backfill-hashes above, for
  // uploads from before width/height existed. SVGs get re-parsed from
  // their own text; every raster format goes through the same header-only
  // reader the /upload route itself uses (no full image decode needed).
  // Like the hash backfill, the caller resumes bounded pages and skips
  // dimensions already present in metadata.
  if (path === "/media/backfill-dimensions" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || (body.cursor != null && typeof body.cursor !== "string")) {
      return json({ error: "Invalid media backfill cursor" }, { status: 400 });
    }
    const listed = await listUploadedMediaPage(env.MEDIA, body.cursor || undefined);
    const meta = await getMediaMeta(env, listed.objects.map((o) => o.key));
    const missing = listed.objects.filter((o) => !meta[o.key]?.width || !meta[o.key]?.height);
    let updated = 0;
    let unreadable = 0;
    const statements = [];
    for (const o of missing) {
      const obj = await env.MEDIA.get(o.key);
      if (!obj) continue;
      const contentType = obj.httpMetadata?.contentType || "";
      const buf = await obj.arrayBuffer();
      const dims = contentType === "image/svg+xml" ? readSvgDimensions(new TextDecoder().decode(buf)) : readImageDimensions(buf, contentType);
      const safeDims = plausibleDims(dims);
      if (safeDims) {
        statements.push(
          env.DB.prepare(
            "INSERT INTO media (key, width, height) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET width = excluded.width, height = excluded.height"
          ).bind(o.key, safeDims.width, safeDims.height)
        );
        updated++;
      } else {
        unreadable++;
      }
    }
    if (statements.length) await env.DB.batch(statements);
    return json({
      updated,
      unreadable,
      alreadyHad: listed.objects.length - missing.length,
      complete: !listed.truncated,
      cursor: listed.truncated ? listed.cursor : null,
    });
  }
  if (path === "/media/usage" && method === "GET") {
    const mediaUrl = url.searchParams.get("url");
    if (!mediaUrl) return json({ error: "url required" }, { status: 400 });
    return json(await findMediaUsage(env, mediaUrl));
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
  // Bulk move (set folder), bulk tag (add one tag, keeping each file's
  // existing tags), and/or bulk alt-text (overwrite, same string for every
  // selected file — meant for a batch of near-duplicate images, e.g. a
  // gallery of the same product from different angles, not a substitute
  // for writing distinct alt text per image) across a selection — same
  // shape as bulk-delete, since all of these come from the same selection
  // checkboxes in the library grid.
  if (path === "/media/bulk-update" && method === "POST") {
    const body = await readJsonBody(request);
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (!keys.length) return json({ error: "No files selected" }, { status: 400 });
    if (body.folder === undefined && !body.addTag && body.altText === undefined) {
      return json({ error: "Nothing to update" }, { status: 400 });
    }
    if (body.addTag) {
      const meta = await getMediaMeta(env, keys);
      await Promise.all(
        keys.map((k) => {
          const tags = meta[k]?.tags || [];
          const patch = { tags: tags.includes(body.addTag) ? tags : [...tags, body.addTag] };
          if (body.folder !== undefined) patch.folder = body.folder;
          if (body.altText !== undefined) patch.alt_text = body.altText;
          return upsertMediaMeta(env, k, patch);
        })
      );
    } else {
      const patch = {};
      if (body.folder !== undefined) patch.folder = body.folder;
      if (body.altText !== undefined) patch.alt_text = body.altText;
      await Promise.all(keys.map((k) => upsertMediaMeta(env, k, patch)));
    }
    log(ctx, env, "update", "media", `${keys.length} file(s)`);
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
  // /media-revisions?key=... — a query param rather than a path segment,
  // since a media key itself contains slashes (uploads/xxx.png), which
  // would collide with a /media/:key/revisions-style route.
  if (path === "/media-revisions" && method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) return json({ error: "key is required" }, { status: 400 });
    return json(await listMediaRevisions(env, key));
  }
  const mediaRevisionRestoreMatch = path.match(/^\/media-revisions\/(\d+)\/restore$/);
  if (mediaRevisionRestoreMatch && method === "POST") {
    await restoreMediaRevision(env, Number(mediaRevisionRestoreMatch[1]));
    log(ctx, env, "restore", "media-revision", mediaRevisionRestoreMatch[1]);
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
  // /media-file-versions?key=... — same reasoning as /media-revisions:
  // a query param, not a path segment, since a media key contains slashes.
  if (path === "/media-file-versions" && method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) return json({ error: "key is required" }, { status: 400 });
    const versions = await listMediaVersions(env, key);
    // Archived bytes live under `_versions/`, which the public /media/:key
    // route deliberately doesn't serve (only uploads/scans/audio) — this
    // admin-only image route is how the History panel's thumbnail loads.
    return json(versions.map((v) => ({ ...v, url: `/api/admin/media-file-versions/${v.id}/image` })));
  }
  const mediaFileVersionImageMatch = path.match(/^\/media-file-versions\/(\d+)\/image$/);
  if (mediaFileVersionImageMatch && method === "GET") {
    const version = await getMediaVersion(env, Number(mediaFileVersionImageMatch[1]));
    if (!version) return new Response("Not found", { status: 404 });
    const obj = await env.MEDIA.get(version.version_key);
    if (!obj) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("Cache-Control", "private, max-age=3600");
    return new Response(obj.body, { headers });
  }
  const mediaFileVersionRestoreMatch = path.match(/^\/media-file-versions\/(\d+)\/restore$/);
  if (mediaFileVersionRestoreMatch && method === "POST") {
    const version = await getMediaVersion(env, Number(mediaFileVersionRestoreMatch[1]));
    if (!version) return json({ error: "Version not found" }, { status: 404 });
    const versionObj = await env.MEDIA.get(version.version_key);
    if (!versionObj) return json({ error: "Archived file is missing" }, { status: 404 });
    // The current (about-to-be-replaced) bytes get archived too, exactly
    // like a normal overwrite would — restoring is just another
    // overwrite, so it's undoable the same way.
    const currentObj = await env.MEDIA.get(version.media_key);
    if (currentObj) {
      const preRestoreKey = `_versions/${version.media_key}/${Date.now()}`;
      await env.MEDIA.put(preRestoreKey, await currentObj.arrayBuffer(), { httpMetadata: currentObj.httpMetadata });
      await recordMediaVersion(env, version.media_key, preRestoreKey, currentObj.size);
    }
    const restoredBytes = await versionObj.arrayBuffer();
    await env.MEDIA.put(version.media_key, restoredBytes, { httpMetadata: versionObj.httpMetadata });
    // The recorded size must follow the bytes (an overwrite does the same): a restored
    // version can have a different size from the file it replaces.
    const restoredType = versionObj.httpMetadata?.contentType || "";
    const restoredDims = plausibleDims(
      restoredType === "image/svg+xml" ? readSvgDimensions(new TextDecoder().decode(restoredBytes)) : readImageDimensions(restoredBytes, restoredType)
    );
    await upsertMediaMeta(env, version.media_key, { width: restoredDims ? restoredDims.width : null, height: restoredDims ? restoredDims.height : null });
    log(ctx, env, "restore", "media-file-version", version.media_key);
    return json({ ok: true });
  }

  // ---------- 3D scans ----------
  // The .glb/.usdz model files, uploaded separately from the poster image
  // (which reuses the existing /upload endpoint above — it's a plain image).
  // Real LiDAR/photogrammetry scans run much bigger than a photo, so these
  // caps are deliberately far above the 8MB image limit — but still capped
  // well under Workers' request-body/memory ceiling, since the whole file
  // is buffered in the Worker before being written to R2. A scan larger
  // than this needs to be compressed/decimated (Polycam, Reality Composer,
  // etc.) before uploading.
  const SCAN_FILE_LIMITS = {
    glb: { maxBytes: 80 * 1024 * 1024, ext: "glb", contentType: "model/gltf-binary" },
    gltf: { maxBytes: 80 * 1024 * 1024, ext: "gltf", contentType: "model/gltf+json" },
    usdz: { maxBytes: 30 * 1024 * 1024, ext: "usdz", contentType: "model/vnd.usdz+zip" },
  };
  if (path === "/scan-upload" && method === "POST") {
    const kind = url.searchParams.get("kind");
    const limits = SCAN_FILE_LIMITS[kind];
    if (!limits) return json({ error: "Invalid or missing ?kind= (glb, gltf, or usdz)" }, { status: 400 });
    const buf = await request.arrayBuffer();
    if (buf.byteLength > limits.maxBytes) {
      return json({ error: `File too large (${Math.round(limits.maxBytes / (1024 * 1024))}MB max)` }, { status: 400 });
    }
    const key = `scans/${crypto.randomUUID()}.${limits.ext}`;
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType: limits.contentType } });
    return json({ key, url: `/media/${key}`, size: buf.byteLength });
  }

  if (path === "/scans" && method === "GET") {
    return json(await listScans(env));
  }
  if (path === "/scans" && method === "POST") {
    const body = await readJsonBody(request);
    const cleaned = cleanScanFields(body);
    if (cleaned.error) return json({ error: cleaned.error }, { status: 400 });
    const keyProblem = await scanKeyProblem(env, cleaned.fields, null, null);
    if (keyProblem) return json({ error: keyProblem }, { status: 400 });
    const id = await createScan(env, cleaned.fields);
    log(ctx, env, "create", "scan", cleaned.fields.name);
    return json({ id });
  }
  // /content-usage — the general "what uses this" check behind
  // findSharedBlockUsage above, extended to simulations/songs/scans/tags too (a
  // scan/simulation used only via a project's "Related X" picker, or a tag
  // used only by drafts, wasn't previously checkable at all for those types).
  if (path === "/content-usage" && method === "GET") {
    const type = url.searchParams.get("type");
    const rawId = url.searchParams.get("id");
    if (!type || !rawId) return json({ error: "type and id required" }, { status: 400 });
    const id = type === "tag" ? rawId : Number(rawId);
    if (type !== "tag" && !id) return json({ error: "id required" }, { status: 400 });
    if (!["scan", "simulation", "song", "shared-block", "tag"].includes(type)) {
      return json({ error: "Unsupported type" }, { status: 400 });
    }
    return json(await findContentUsage(env, type, id));
  }
  const scanMatch = path.match(/^\/scans\/(\d+)$/);
  if (scanMatch && method === "GET") {
    const scan = await getScan(env, Number(scanMatch[1]));
    if (!scan) return json({ error: "Not found" }, { status: 404 });
    return json(scan);
  }
  if (scanMatch && method === "PATCH") {
    const sent = await readJsonBody(request);
    const id = Number(scanMatch[1]);
    const before = await getScan(env, id);
    const cleaned = cleanScanFields(sent, { partial: true, keep: before || {} });
    if (cleaned.error) return json({ error: cleaned.error }, { status: 400 });
    const body = cleaned.fields;
    const keyProblem = await scanKeyProblem(env, body, id, before);
    if (keyProblem) return json({ error: keyProblem }, { status: 400 });
    await updateScan(env, id, body);
    // glb_key/usdz_key point at files dedicated to this scan (not shared
    // media-library references), so replacing one with a re-upload needs to
    // clean up the old R2 object here — otherwise it's orphaned forever.
    if (before) {
      const cleanups = [];
      if ("glb_key" in body && body.glb_key !== before.glb_key && before.glb_key) cleanups.push(before.glb_key);
      if ("usdz_key" in body && body.usdz_key !== before.usdz_key && before.usdz_key) cleanups.push(before.usdz_key);
      await Promise.all(cleanups.map((k) => env.MEDIA.delete(k).catch(() => {})));
    }
    return json({ ok: true });
  }
  if (scanMatch && method === "DELETE") {
    const id = Number(scanMatch[1]);
    const scan = await getScan(env, id);
    await deleteScan(env, id);
    if (scan) {
      // The model files are dedicated to this scan (not a shared media
      // library resource), so they're cleaned up here. The poster image,
      // if set, usually comes from the shared media library — left alone,
      // same as every other feature that just references a media URL.
      await Promise.all(
        [scan.glb_key, scan.usdz_key].filter(Boolean).map((k) => env.MEDIA.delete(k).catch(() => {}))
      );
    }
    log(ctx, env, "delete", "scan", scan?.name || `#${id}`);
    return json({ ok: true });
  }

  // /redirects
  if (path === "/redirects" && method === "GET") {
    return json(await listRedirects(env));
  }
  if (path === "/redirects" && method === "POST") {
    const body = await readJsonBody(request);
    const from_path = normalizePath(body.from_path);
    if (!from_path || !String(body.to_path || "").trim()) return json({ error: "Both a from and to path are required" }, { status: 400 });
    const target = cleanRedirectTarget(body.to_path);
    if (!target.ok) return json({ error: target.error }, { status: 400 });
    const to_path = target.value;
    const statusCheck = cleanRedirectStatus(body.status_code);
    if (!statusCheck.ok) return json({ error: statusCheck.error }, { status: 400 });
    if (isBlockedRedirectPath(from_path)) {
      return json({ error: "That path is reserved and can't be redirected" }, { status: 400 });
    }
    if (await wouldCreateRedirectLoop(env, from_path, to_path, null)) {
      return json({ error: "This would create a redirect loop" }, { status: 400 });
    }
    try {
      const id = await createRedirect(env, { from_path, to_path, status_code: statusCheck.value });
      log(ctx, env, "create", "redirect", `${from_path} → ${to_path}`);
      return json({ id });
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) {
        return json({ error: "A redirect from that path already exists" }, { status: 409 });
      }
      throw err;
    }
  }
  const redirectMatch = path.match(/^\/redirects\/(\d+)$/);
  if (redirectMatch && method === "PATCH") {
    const body = await readJsonBody(request);
    const fields = {};
    if (body.from_path !== undefined) fields.from_path = normalizePath(body.from_path);
    if (body.to_path !== undefined) {
      const target = cleanRedirectTarget(body.to_path);
      if (!target.ok) return json({ error: target.error }, { status: 400 });
      fields.to_path = target.value;
    }
    if (body.status_code !== undefined) {
      const statusCheck = cleanRedirectStatus(body.status_code);
      if (!statusCheck.ok) return json({ error: statusCheck.error }, { status: 400 });
      fields.status_code = statusCheck.value;
    }
    if (fields.from_path && isBlockedRedirectPath(fields.from_path)) {
      return json({ error: "That path is reserved and can't be redirected" }, { status: 400 });
    }
    const redirectId = Number(redirectMatch[1]);
    if (fields.from_path !== undefined || fields.to_path !== undefined) {
      // PATCH can change just one side of an edge — the loop check needs
      // the row as it would exist *after* this update, not just whichever
      // field happened to be sent, so it's checked against the existing
      // row merged with the incoming changes (excluding this row's own
      // current edge from the graph, since it's being replaced).
      const existing = await env.DB.prepare("SELECT from_path, to_path FROM redirects WHERE id = ?").bind(redirectId).first();
      const effectiveFrom = fields.from_path ?? existing?.from_path;
      const effectiveTo = fields.to_path ?? existing?.to_path;
      if (effectiveFrom && effectiveTo && (await wouldCreateRedirectLoop(env, effectiveFrom, effectiveTo, redirectId))) {
        return json({ error: "This would create a redirect loop" }, { status: 400 });
      }
    }
    try {
      await updateRedirect(env, redirectId, fields);
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) {
        return json({ error: "A redirect from that path already exists" }, { status: 409 });
      }
      throw err;
    }
    return json({ ok: true });
  }
  if (redirectMatch && method === "DELETE") {
    const id = Number(redirectMatch[1]);
    const r = await env.DB.prepare("SELECT from_path, to_path FROM redirects WHERE id = ?").bind(id).first();
    await deleteRedirect(env, id);
    log(ctx, env, "delete", "redirect", r ? `${r.from_path} → ${r.to_path}` : `#${id}`);
    return json({ ok: true });
  }

  // /search — pages, articles, and blocks matching a text query
  if (path === "/search" && method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return json({ pages: [], articles: [], blocks: [] });
    return json(await search(env, q));
  }

  // /link-check — walks every button/project-card/article link and reports status
  if (path === "/link-check" && method === "GET") {
    return json(await checkLinks(env));
  }
  // /link-check-status — the last scheduled (daily-cron) run's broken-link
  // subset, so the dashboard can show it without running a fresh check.
  if (path === "/link-check-status" && method === "GET") {
    return json(await getLinkCheckStatus(env));
  }
  // /link-check-status/run — manually fires the same check the daily cron
  // runs, same "run it now" convenience as scheduled backups already have.
  if (path === "/link-check-status/run" && method === "POST") {
    await runScheduledLinkCheck(env);
    log(ctx, env, "run", "link-check", null);
    return json(await getLinkCheckStatus(env));
  }

  // /seo-report — pages missing a meta description, and image blocks
  // missing alt text, across the whole site.
  if (path === "/seo-report" && method === "GET") {
    return json(await getSeoReport(env));
  }

  // /accessibility-report — known keyboard-nav/focus anti-patterns inside
  // "html" (raw, unescaped) blocks specifically — every other block type
  // is already accessible by construction.
  if (path === "/accessibility-report" && method === "GET") {
    return json(await checkAccessibility(env));
  }

  // /orphan-content — published pages/articles/projects nothing internally
  // links to and that aren't in the header nav either.
  if (path === "/orphan-content" && method === "GET") {
    return json(await getOrphanContent(env));
  }

  // /content-health — site-wide empty-page and stale-content inventory.
  if (path === "/content-health" && method === "GET") {
    return json(await getContentHealth(env));
  }

  // /content-integrity — site-wide dangling-reference sweep (broken block
  // references, stale related-X ids, orphaned nav-parent assignments).
  if (path === "/content-integrity" && method === "GET") {
    return json(await getContentIntegrity(env));
  }

  // /topic-meta — optional per-tag description/share-image override for
  // /topics/:tag landing pages. GET lists every known tag (from real
  // content, via getTagCounts) alongside any custom meta already saved
  // for it, so the admin UI can show one row per tag whether or not it's
  // been customized yet.
  if (path === "/topic-meta" && method === "GET") {
    const [tags, metaRows] = await Promise.all([getTagCounts(env), listTopicMeta(env)]);
    const metaByTag = new Map(metaRows.map((m) => [m.tag, m]));
    const rows = tags.map((t) => ({ tag: t.tag, count: t.count, description: metaByTag.get(t.tag)?.description || "", og_image: metaByTag.get(t.tag)?.og_image || "" }));
    // A tag's last published article/project can be unpublished or deleted
    // without ever touching its topic_meta row — the tag then silently
    // drops out of getTagCounts (and this list), but /topics/:tag still
    // renders the stale description/og:image into the page <head> forever,
    // with no way for the admin to even see the row exists, let alone
    // clear it. Surfacing it with count 0 makes it reachable through the
    // exact same Edit flow every other row already uses — saving it with
    // both fields blank already deletes it (see the PUT handler below).
    const knownTags = new Set(tags.map((t) => t.tag));
    for (const m of metaRows) {
      if (!knownTags.has(m.tag)) rows.push({ tag: m.tag, count: 0, orphaned: true, description: m.description || "", og_image: m.og_image || "" });
    }
    return json(rows);
  }
  if (path === "/topic-meta" && method === "PUT") {
    const body = await readJsonBody(request);
    cleanBodyFields(body, ["description", "og_image"]);
    if (!body.tag) return json({ error: "tag is required" }, { status: 400 });
    if (!body.description && !body.og_image) {
      await deleteTopicMeta(env, body.tag);
    } else {
      await setTopicMeta(env, body.tag, { description: body.description, og_image: body.og_image });
    }
    log(ctx, env, "update", "topic-meta", body.tag);
    return json({ ok: true });
  }

  // /preview-links — shareable, expiring, revocable links that let someone
  // without an admin login view an unpublished article/project.
  if (path === "/preview-links" && method === "GET") {
    const contentType = url.searchParams.get("contentType");
    const contentId = Number(url.searchParams.get("contentId"));
    if (!["article", "project"].includes(contentType) || !Number.isFinite(contentId)) {
      return json({ error: "Invalid content" }, { status: 400 });
    }
    return json(await listPreviewLinks(env, contentType, contentId));
  }
  if (path === "/preview-links" && method === "POST") {
    const body = await readJsonBody(request);
    if (!["article", "project"].includes(body.contentType) || !Number.isFinite(Number(body.contentId))) {
      return json({ error: "Invalid content" }, { status: 400 });
    }
    const hours = Number.isFinite(Number(body.hours)) ? Number(body.hours) : 24 * 7;
    const link = await createPreviewLink(env, body.contentType, Number(body.contentId), hours);
    log(ctx, env, "create", "preview-link", `${body.contentType} #${body.contentId}`);
    return json(link);
  }
  const previewLinkRevokeMatch = path.match(/^\/preview-links\/(\d+)\/revoke$/);
  if (previewLinkRevokeMatch && method === "POST") {
    await revokePreviewLink(env, Number(previewLinkRevokeMatch[1]));
    return json({ ok: true });
  }

  if (path === "/webhook-deliveries" && method === "GET") {
    return json(await listWebhookDeliveries(env));
  }
  // Re-sends the exact same payload that was recorded at the time — not a
  // fresh one built from the article's current state, since the article
  // may have changed since (retrying should reproduce what should have
  // been delivered then, not send a different event under the same id).
  const webhookRetryMatch = path.match(/^\/webhook-deliveries\/(\d+)\/retry$/);
  if (webhookRetryMatch && method === "POST") {
    const delivery = await getWebhookDelivery(env, Number(webhookRetryMatch[1]));
    if (!delivery) return json({ error: "Not found" }, { status: 404 });
    await deliverWebhook(env, delivery.url, delivery.payload);
    log(ctx, env, "webhook-retry", "webhook", delivery.payload?.title || delivery.url);
    return json({ ok: true });
  }

  // /find-replace — apply=false previews matches without changing anything;
  // apply=true rewrites them (each touched page/article is snapshotted
  // first, so it's undoable via History).
  if (path === "/find-replace" && method === "POST") {
    const body = await readJsonBody(request);
    const find = String(body.find || "");
    if (!find) return json({ error: "Find text is required" }, { status: 400 });
    const replace = String(body.replace ?? "");
    const apply = !!body.apply;
    const results = await runFindReplace(env, { find, replace, apply });
    if (apply && results.length) log(ctx, env, "find-replace", "site", `"${find}" → "${replace}"`, `${results.length} field(s)`);
    return json({ results, applied: apply });
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

  // /simulations
  // /templates?kind=page|article|simulation|project — saved starting points for new pages/articles/simulations/projects
  const TEMPLATE_KINDS = ["page", "article", "simulation", "project", "song"];
  if (path === "/templates" && method === "GET") {
    const kind = url.searchParams.get("kind");
    if (!TEMPLATE_KINDS.includes(kind)) return json({ error: "Invalid kind" }, { status: 400 });
    return json(await listTemplates(env, kind));
  }
  if (path === "/templates" && method === "POST") {
    const body = await readJsonBody(request);
    if (!TEMPLATE_KINDS.includes(body.kind) || !body.name) {
      return json({ error: "kind and name are required" }, { status: 400 });
    }
    if (body.kind === "simulation") {
      const dataError = simulationDataError(body.data || {}, true);
      if (dataError) return json({ error: dataError }, { status: 400 });
    }
    const id = await createTemplate(env, body);
    log(ctx, env, "create", "template", body.name);
    return json({ id });
  }
  const templateMatch = path.match(/^\/templates\/(\d+)$/);
  if (templateMatch && method === "DELETE") {
    await deleteTemplate(env, Number(templateMatch[1]));
    return json({ ok: true });
  }

  if (path === "/simulations" && method === "GET") {
    return json(await listSimulations(env));
  }
  if (path === "/simulations" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body.name || !String(body.name).trim()) return json({ error: "Name is required" }, { status: 400 });
    const data = body.data || {};
    const dataError = simulationDataError(data);
    if (dataError) return json({ error: dataError }, { status: 400 });
    const id = await createSimulation(env, { name: body.name.trim(), data });
    log(ctx, env, "create", "simulation", body.name.trim());
    return json({ id });
  }
  const simPublicationMatch = path.match(/^\/simulations\/(\d+)\/(publish|unpublish)$/);
  if (simPublicationMatch && method === "POST") {
    const id = Number(simPublicationMatch[1]);
    const action = simPublicationMatch[2];
    const simulation = await getSimulation(env, id, {
      includeData: action === "publish",
      includeRawData: action === "publish",
    });
    if (!simulation) return json({ error: "Simulation not found" }, { status: 404 });
    if (action === "publish") {
      const data = normalizeLegacySimulationWireIds(simulation.data);
      const dataError = simulationDataError(data);
      if (dataError) return json({ error: dataError }, { status: 400 });
      const updated = await publishSimulation(env, id, {
        data,
        expectedRawData: simulation.raw_data,
        expectedName: simulation.name,
      });
      if (!updated) return json({ error: "Simulation changed while publishing. Reload and try again." }, { status: 409 });
      log(ctx, env, action, "simulation", simulation.name);
      return json({ ok: true });
    }
    const updated = await unpublishSimulation(env, id);
    if (!updated) return json({ error: "Simulation not found" }, { status: 404 });
    log(ctx, env, action, "simulation", simulation.name);
    return json({ ok: true });
  }
  const simDuplicateMatch = path.match(/^\/simulations\/(\d+)\/duplicate$/);
  if (simDuplicateMatch && method === "POST") {
    const source = await getSimulation(env, Number(simDuplicateMatch[1]));
    if (!source) return json({ error: "Simulation not found" }, { status: 404 });
    const data = normalizeLegacySimulationWireIds(source.data || {});
    const dataError = simulationDataError(data);
    if (dataError) return json({ error: dataError }, { status: 400 });
    const newId = await duplicateSimulation(env, Number(simDuplicateMatch[1]), data);
    if (!newId) return json({ error: "Simulation not found" }, { status: 404 });
    log(ctx, env, "duplicate", "simulation", `#${simDuplicateMatch[1]} → #${newId}`);
    return json({ id: newId });
  }
  const simMatch = path.match(/^\/simulations\/(\d+)$/);
  if (simMatch && method === "GET") {
    const sim = await getSimulation(env, Number(simMatch[1]));
    if (!sim) return json({ error: "Not found" }, { status: 404 });
    return json(sim);
  }
  if (simMatch && method === "PATCH") {
    const body = await readJsonBody(request);
    if (!body.name || !String(body.name).trim()) return json({ error: "Name is required" }, { status: 400 });
    const data = body.data || {};
    const dataError = simulationDataError(data);
    if (dataError) return json({ error: dataError }, { status: 400 });
    const updated = await updateSimulation(env, Number(simMatch[1]), { name: body.name.trim(), data });
    if (!updated) return json({ error: "Not found" }, { status: 404 });
    return json({ ok: true });
  }
  if (simMatch && method === "DELETE") {
    const id = Number(simMatch[1]);
    const s = await getSimulation(env, id);
    await deleteSimulation(env, id);
    log(ctx, env, "delete", "simulation", s?.name || `#${id}`);
    return json({ ok: true });
  }

  if (path === "/songs" && method === "GET") {
    return json(await listSongs(env));
  }
  if (path === "/songs" && method === "POST") {
    const cleaned = cleanSongSave(await readJsonBody(request));
    if (cleaned.error) return json({ error: cleaned.error }, { status: 400 });
    const id = await createSong(env, { name: cleaned.name, data: cleaned.data });
    log(ctx, env, "create", "song", cleaned.name);
    return json({ id });
  }
  const songDuplicateMatch = path.match(/^\/songs\/(\d+)\/duplicate$/);
  if (songDuplicateMatch && method === "POST") {
    const newId = await duplicateSong(env, Number(songDuplicateMatch[1]));
    if (!newId) return json({ error: "Song not found" }, { status: 404 });
    log(ctx, env, "duplicate", "song", `#${songDuplicateMatch[1]} → #${newId}`);
    return json({ id: newId });
  }
  const songMatch = path.match(/^\/songs\/(\d+)$/);
  if (songMatch && method === "GET") {
    const song = await getSong(env, Number(songMatch[1]));
    if (!song) return json({ error: "Not found" }, { status: 404 });
    return json(song);
  }
  if (songMatch && method === "PATCH") {
    const cleaned = cleanSongSave(await readJsonBody(request), { edit: true });
    if (cleaned.error) return json({ error: cleaned.error }, { status: 400 });
    const updated = await updateSong(env, Number(songMatch[1]), { name: cleaned.name, data: cleaned.data });
    if (!updated) return json({ error: "Not found" }, { status: 404 });
    return json({ ok: true });
  }
  if (songMatch && method === "DELETE") {
    const id = Number(songMatch[1]);
    const s = await getSong(env, id);
    await deleteSong(env, id);
    log(ctx, env, "delete", "song", s?.name || `#${id}`);
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
  // /notifications-summary — rolls up backup-failure/broken-links/recent-
  // errors/recent-failed-webhooks into one count for the admin header's
  // notification bell, rather than making an admin separately check four
  // different panels to see if anything needs attention.
  if (path === "/notifications-summary" && method === "GET") {
    return json(await getNotificationSummary(env));
  }
  // /storage-usage — R2 bucket usage by category plus an approximate D1
  // database size, for the Site Settings "Storage" panel.
  if (path === "/storage-usage" && method === "GET") {
    return json(await getStorageUsage(env));
  }
  // Saved versions whose page, article, project or file is already gone (see countOrphanedHistory). Counting is
  // harmless; removing them is an explicit action from Settings > Backups.
  if (path === "/history-orphans" && method === "GET") {
    return json(await countOrphanedHistory(env));
  }
  if (path === "/history-orphans/purge" && method === "POST") {
    const removed = await purgeOrphanedHistory(env);
    log(ctx, env, "cleanup", "history", `${removed.revisions} revision(s), ${removed.mediaRevisions} media edit(s)`);
    return json({ removed });
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

  // /activity — recent admin actions, for the audit trail viewer
  if (path === "/activity" && method === "GET") {
    return json(await listActivityLog(env, Number(url.searchParams.get("limit")) || 100));
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

  // /analytics
  if (path === "/analytics" && method === "GET") {
    const days = Number(url.searchParams.get("days")) || 7;
    const filters = {
      device: url.searchParams.get("device") || null,
      referrer: url.searchParams.get("referrer") || null,
      contentType: url.searchParams.get("contentType") || null,
    };
    return json(await getAnalytics(env, Math.min(Math.max(days, 1), 90), filters));
  }

  // /analytics/export-raw — every individual pageview/event row in the
  // selected window, not the top-N breakdowns /analytics returns. Generated
  // server-side (unlike the breakdown CSV, which the client already has
  // the aggregated numbers for and builds itself) since raw rows aren't
  // otherwise sent to the browser.
  if (path === "/analytics/top-articles" && method === "GET") {
    const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 7, 1), 90);
    return json(await getTopArticles(env, days, Number(url.searchParams.get("limit")) || 5));
  }
  if (path === "/analytics/export-raw" && method === "GET") {
    const days = Number(url.searchParams.get("days")) || 7;
    const filters = {
      device: url.searchParams.get("device") || null,
      referrer: url.searchParams.get("referrer") || null,
      contentType: url.searchParams.get("contentType") || null,
    };
    const { pageviews, events } = await getRawAnalyticsEvents(env, Math.min(Math.max(days, 1), 90), filters);
    // A cell starting with =, +, -, or @ is a live formula to Excel/Sheets/
    // LibreOffice even when quoted — pageview referrer/path/event-detail
    // values come straight from public, unauthenticated requests (see
    // POST /api/track), so a crafted one could run a formula the moment
    // an admin opens this export. Prefixing with a tab neutralizes it
    // (rendered as leading whitespace, not evaluated) without visibly
    // altering the cell the way a leading apostrophe would.
    const csvCell = (v) => {
      let s = String(v ?? "");
      if (/^[=+\-@]/.test(s)) s = "\t" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const csvRow = (cells) => cells.map(csvCell).join(",") + "\r\n";
    let csv = csvRow(["Pageviews"]) + csvRow(["Time (UTC)", "Path", "Referrer", "Device", "Browser", "Country", "Region", "City"]);
    for (const p of pageviews) csv += csvRow([p.created_at, p.path, p.referrer, p.device, p.browser, p.country, p.region, p.city]);
    csv += "\r\n" + csvRow(["Events"]) + csvRow(["Time (UTC)", "Name", "Path", "Detail"]);
    for (const e of events) csv += csvRow([e.created_at, e.name, e.path, e.detail]);
    log(ctx, env, "export", "analytics-raw", `${pageviews.length} pageviews, ${events.length} events`);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="dominickdominick-raw-events-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
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
    // The site name and the built-in nav links are cleaned to the same shape the page shell reads (worker/nav-settings.js).
    if ("site_brand" in body) body.site_brand = cleanBrand(body.site_brand);
    if ("nav_builtin" in body) body.nav_builtin = cleanNavBuiltin(body.nav_builtin);
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

  // /sections — reusable multi-block sections ("save this group, insert it on any page"). One settings row per
  // section ("page_section:<id>", random id), so saving two at once can't overwrite or reuse an id, and no schema change
  // is needed. Each block stores its content, style and a position relative to the section's top row; inserting
  // recreates them through the normal block route.
  const SECTION_PREFIX = "page_section:";
  const SECTION_MAX = 30;
  if (path === "/sections" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE ? ORDER BY key").bind(`${SECTION_PREFIX}%`).all();
    const list = [];
    for (const r of results) {
      try {
        list.push({ ...JSON.parse(r.value), id: r.key.slice(SECTION_PREFIX.length) });
      } catch {}
    }
    return json(list);
  }
  if (path === "/sections" && method === "POST") {
    const body = await readJsonBody(request);
    const name = String(body.name || "").trim();
    const input = Array.isArray(body.blocks) ? body.blocks : [];
    if (!name) return json({ error: "A section needs a name." }, { status: 400 });
    if (name.length > 60) return json({ error: "Section names are limited to 60 characters." }, { status: 400 });
    if (!input.length || input.length > 24) return json({ error: "A section holds 1 to 24 blocks." }, { status: 400 });
    const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
    const cleaned = [];
    for (const b of input) {
      if (!b || typeof b.type !== "string" || !/^[a-z0-9-]{1,40}$/.test(b.type)) return json({ error: "A block has an invalid type." }, { status: 400 });
      if (!int(b.col, 1, 24) || !int(b.col_span, 1, 24) || b.col + b.col_span > 25 || !int(b.row, 1, 5000) || !int(b.row_span, 1, 200)) {
        return json({ error: "A block has an invalid position or size." }, { status: 400 });
      }
      const style = b.style && typeof b.style === "object" && !Array.isArray(b.style) ? { ...b.style } : {};
      delete style.group;
      cleaned.push({ type: b.type, content: b.content && typeof b.content === "object" ? b.content : {}, style, col: b.col, col_span: b.col_span, row: b.row, row_span: b.row_span });
    }
    const top = Math.min(...cleaned.map((b) => b.row));
    cleaned.forEach((b) => (b.row = b.row - top + 1));
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE ?").bind(`${SECTION_PREFIX}%`).first();
    if ((count?.n || 0) >= SECTION_MAX) return json({ error: `You can keep up to ${SECTION_MAX} sections; delete one first.` }, { status: 400 });
    const value = JSON.stringify({ name, blocks: cleaned });
    if (value.length > 100000) return json({ error: "That section is too large to save (100 KB limit)." }, { status: 400 });
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    await setSetting(env, `${SECTION_PREFIX}${id}`, value);
    log(ctx, env, "create", "section", name);
    return json({ id });
  }
  const sectionMatch = path.match(/^\/sections\/([a-f0-9]{12})$/);
  if (sectionMatch && method === "DELETE") {
    const key = `${SECTION_PREFIX}${sectionMatch[1]}`;
    const row = await getSetting(env, key);
    await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
    if (row) {
      try {
        log(ctx, env, "delete", "section", JSON.parse(row).name);
      } catch {}
    }
    return json({ ok: true });
  }

  // /scripts — the owner's saved admin scripts (written and run in the Scripts window; see public/admin/script-runner.js).
  // One settings row each, so saving two at once can't overwrite or reuse an id and no schema change is needed.
  if (path === "/scripts" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE ? ORDER BY key").bind(`${SCRIPT_PREFIX}%`).all();
    return json(results.map(readScriptRow).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)));
  }
  if (path === "/scripts" && method === "POST") {
    const cleaned = cleanScript(await readJsonBody(request));
    if (!cleaned.ok) return json({ error: cleaned.error }, { status: 400 });
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE ?").bind(`${SCRIPT_PREFIX}%`).first();
    if ((count?.n || 0) >= SCRIPT_MAX) return json({ error: `You can keep up to ${SCRIPT_MAX} scripts; delete one first.` }, { status: 400 });
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    await setSetting(env, scriptKey(id), JSON.stringify({ ...cleaned.value, updated_at: new Date().toISOString() }));
    log(ctx, env, "create", "script", cleaned.value.name);
    return json({ id });
  }
  const scriptMatch = path.match(/^\/scripts\/([a-f0-9]{12})$/);
  if (scriptMatch && isScriptId(scriptMatch[1]) && method === "PUT") {
    const key = scriptKey(scriptMatch[1]);
    if (!(await getSetting(env, key))) return json({ error: "Script not found" }, { status: 404 });
    const cleaned = cleanScript(await readJsonBody(request));
    if (!cleaned.ok) return json({ error: cleaned.error }, { status: 400 });
    await setSetting(env, key, JSON.stringify({ ...cleaned.value, updated_at: new Date().toISOString() }));
    log(ctx, env, "update", "script", cleaned.value.name);
    return json({ ok: true });
  }
  if (scriptMatch && method === "DELETE") {
    const key = scriptKey(scriptMatch[1]);
    const row = await getSetting(env, key);
    if (!row) return json({ error: "Script not found" }, { status: 404 });
    await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
    log(ctx, env, "delete", "script", readScriptRow({ key, value: row })?.name || "script");
    return json({ ok: true });
  }

  // /style-presets — reusable block-style snapshots (color/hover/animation/
  // etc. — the same STYLE_FIELDS every block type shares), stored as one
  // JSON blob under its own settings key rather than folded into the
  // SETTINGS_KEYS bulk save above, since that PUT resets any key missing
  // from its body — wrong for a list that gets individually added to/
  // removed from, not replaced wholesale on every settings save.
  if (path === "/style-presets" && method === "GET") {
    const raw = await getSetting(env, "style_presets");
    return json(JSON.parse(raw || "[]"));
  }
  if (path === "/style-presets" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body.name || !body.style || typeof body.style !== "object") {
      return json({ error: "name and style are required" }, { status: 400 });
    }
    const presets = JSON.parse((await getSetting(env, "style_presets")) || "[]");
    const id = presets.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1;
    presets.push({ id, name: String(body.name).slice(0, 60), style: body.style });
    await setSetting(env, "style_presets", JSON.stringify(presets));
    log(ctx, env, "create", "style-preset", body.name);
    return json({ id });
  }
  const stylePresetMatch = path.match(/^\/style-presets\/(\d+)$/);
  if (stylePresetMatch && method === "DELETE") {
    const id = Number(stylePresetMatch[1]);
    const presets = JSON.parse((await getSetting(env, "style_presets")) || "[]");
    const target = presets.find((p) => p.id === id);
    await setSetting(env, "style_presets", JSON.stringify(presets.filter((p) => p.id !== id)));
    log(ctx, env, "delete", "style-preset", target?.name || `#${id}`);
    return json({ ok: true });
  }

  // /photo-presets — named brightness/contrast/saturation snapshots for the
  // photo editor's adjust sliders, same storage pattern as style presets
  // above (own settings key, own routes, not folded into the bulk PUT).
  if (path === "/photo-presets" && method === "GET") {
    const raw = await getSetting(env, "photo_editor_presets");
    return json(JSON.parse(raw || "[]"));
  }
  if (path === "/photo-presets" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body.name || typeof body.adjust !== "object" || !body.adjust) {
      return json({ error: "name and adjust are required" }, { status: 400 });
    }
    const { brightness = 0, contrast = 0, saturate = 0 } = body.adjust;
    const presets = JSON.parse((await getSetting(env, "photo_editor_presets")) || "[]");
    const id = presets.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1;
    presets.push({
      id,
      name: String(body.name).slice(0, 60),
      adjust: { brightness: Number(brightness) || 0, contrast: Number(contrast) || 0, saturate: Number(saturate) || 0 },
    });
    await setSetting(env, "photo_editor_presets", JSON.stringify(presets));
    log(ctx, env, "create", "photo-preset", body.name);
    return json({ id });
  }
  const photoPresetMatch = path.match(/^\/photo-presets\/(\d+)$/);
  if (photoPresetMatch && method === "DELETE") {
    const id = Number(photoPresetMatch[1]);
    const presets = JSON.parse((await getSetting(env, "photo_editor_presets")) || "[]");
    const target = presets.find((p) => p.id === id);
    await setSetting(env, "photo_editor_presets", JSON.stringify(presets.filter((p) => p.id !== id)));
    log(ctx, env, "delete", "photo-preset", target?.name || `#${id}`);
    return json({ ok: true });
  }

  // /brush-presets — named brush tool/size/opacity combos, same storage
  // pattern (and own settings key) as the adjustment presets above --
  // kept as a separate resource rather than folded into /photo-presets
  // since that endpoint's own validation is specifically shaped around
  // `adjust: {brightness, contrast, saturate}`, not brush parameters.
  const BRUSH_PRESET_TOOLS = new Set(["paint", "pencil", "erase", "blur", "pixelate", "dodge", "burn"]);
  if (path === "/brush-presets" && method === "GET") {
    const raw = await getSetting(env, "photo_editor_brush_presets");
    return json(JSON.parse(raw || "[]"));
  }
  if (path === "/brush-presets" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body.name || !BRUSH_PRESET_TOOLS.has(body.tool)) {
      return json({ error: "name and a valid tool are required" }, { status: 400 });
    }
    // Number.isFinite, not `|| default` -- a critic pass reviewing the
    // sibling /text-styles endpoint (which deliberately copies this exact
    // pattern) found `|| default` silently discards an explicit,
    // legitimate `0` in favor of the default instead of clamping it to
    // the real minimum, since `0` is falsy. Fixed here too rather than
    // leaving the original instance of the bug in place once found.
    const rawSize = Number(body.size);
    const size = Math.max(1, Math.min(150, Number.isFinite(rawSize) ? rawSize : 30));
    const rawOpacity = Number(body.opacity);
    const opacity = Math.max(1, Math.min(100, Number.isFinite(rawOpacity) ? rawOpacity : 100));
    const presets = JSON.parse((await getSetting(env, "photo_editor_brush_presets")) || "[]");
    const id = presets.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1;
    // Colour and hardness matter to Paint and Pencil; stored only when valid.
    const preset = { id, name: String(body.name).slice(0, 60), tool: body.tool, size, opacity };
    if ((body.tool === "paint" || body.tool === "pencil") && typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)) preset.color = body.color.toLowerCase();
    // Hardness only shapes Paint (null or missing is "not given", not 0).
    const rawHardness = Number(body.hardness);
    if (body.tool === "paint" && body.hardness != null && Number.isFinite(rawHardness)) preset.hardness = Math.max(0, Math.min(100, Math.round(rawHardness)));
    presets.push(preset);
    await setSetting(env, "photo_editor_brush_presets", JSON.stringify(presets));
    log(ctx, env, "create", "brush-preset", body.name);
    return json({ id });
  }
  const brushPresetMatch = path.match(/^\/brush-presets\/(\d+)$/);
  if (brushPresetMatch && method === "DELETE") {
    const id = Number(brushPresetMatch[1]);
    const presets = JSON.parse((await getSetting(env, "photo_editor_brush_presets")) || "[]");
    const target = presets.find((p) => p.id === id);
    await setSetting(env, "photo_editor_brush_presets", JSON.stringify(presets.filter((p) => p.id !== id)));
    log(ctx, env, "delete", "brush-preset", target?.name || `#${id}`);
    return json({ ok: true });
  }

  // /text-styles — named font/color/size combos for the Text annotation
  // tool, same settings-blob storage pattern as brush presets immediately
  // above (own settings key, own validation shaped for its own fields) --
  // not folded into /brush-presets since text has no "tool" concept and
  // brush presets have no "font" concept.
  const TEXT_STYLE_FONTS = new Set(["sans-serif", "custom"]);
  if (path === "/text-styles" && method === "GET") {
    const raw = await getSetting(env, "photo_editor_text_styles");
    return json(JSON.parse(raw || "[]"));
  }
  if (path === "/text-styles" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body.name || !TEXT_STYLE_FONTS.has(body.font)) {
      return json({ error: "name and a valid font are required" }, { status: 400 });
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(body.color || "")) {
      return json({ error: "A valid #rrggbb color is required" }, { status: 400 });
    }
    // Number.isFinite, not `|| 4` -- a critic pass found the sibling
    // /brush-presets endpoint's `Number(x) || default` falls through to
    // the default for an explicit, legitimate `0` (since `0` is falsy),
    // silently saving 4 instead of clamping to the real minimum of 1. Not
    // copying that bug into this new endpoint even though it's the same
    // storage pattern being deliberately mirrored elsewhere.
    const rawSize = Number(body.size);
    const size = Math.max(1, Math.min(20, Number.isFinite(rawSize) ? rawSize : 4));
    const styles = JSON.parse((await getSetting(env, "photo_editor_text_styles")) || "[]");
    const id = styles.reduce((max, s) => Math.max(max, s.id || 0), 0) + 1;
    styles.push({ id, name: String(body.name).slice(0, 60), font: body.font, color: body.color, size });
    await setSetting(env, "photo_editor_text_styles", JSON.stringify(styles));
    log(ctx, env, "create", "text-style", body.name);
    return json({ id });
  }
  const textStyleMatch = path.match(/^\/text-styles\/(\d+)$/);
  if (textStyleMatch && method === "DELETE") {
    const id = Number(textStyleMatch[1]);
    const styles = JSON.parse((await getSetting(env, "photo_editor_text_styles")) || "[]");
    const target = styles.find((s) => s.id === id);
    await setSetting(env, "photo_editor_text_styles", JSON.stringify(styles.filter((s) => s.id !== id)));
    log(ctx, env, "delete", "text-style", target?.name || `#${id}`);
    return json({ ok: true });
  }

  // /selection-presets — named photo-editor selections, same settings-blob
  // storage pattern as the presets above (own key, own validation). A
  // selection is stored as the shapes that made it (rect/ellipse boxes and
  // polygon/lasso points, all as fractions of the image size 0..1), not as
  // pixels, so it applies to any image size and stays small.
  const SELECTION_KINDS = new Set(["rect", "ellipse", "poly"]);
  const SELECTION_MODES = new Set(["add", "sub", "int"]);
  const SELECTION_PRESET_LIMIT = 20;
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
  if (path === "/selection-presets" && method === "GET") {
    const raw = await getSetting(env, "photo_editor_selections");
    return json(JSON.parse(raw || "[]"));
  }
  if (path === "/selection-presets" && method === "POST") {
    // Capped in bytes as they arrive, so it also holds for chunked uploads
    // without a Content-Length.
    const rawBody = await readBodyTextCapped(request, 300000);
    if (rawBody === null) {
      return json({ error: "That selection is too large to save." }, { status: 413 });
    }
    let body = {};
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
    } catch {
      // not JSON: fall through with {}, which fails validation below
    }
    // Printable characters only: control characters become spaces; bidi marks and
    // overrides and lone surrogates are dropped; composed (NFC) so "café" typed two
    // ways is one name; runs of spaces collapse; cut on whole characters rather than
    // through a surrogate pair.
    const cleanedName = (typeof body.name === "string" ? body.name : "")
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
        // Zero-width joiners and non-joiners, emoji selectors and tag characters carry
        // meaning (family emoji, flags, Persian and Indic text) and stay.
        .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2060-\u2069\u00ad\u061c\ufeff\u3164\u2800]/g, "")
        .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "")
        .normalize("NFC")
        .replace(/\s+/g, " ");
    // Cut on whole characters as a reader sees them (an emoji sequence or a letter
    // with its marks is never split), falling back to code points.
    const nameChars =
      typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(cleanedName), (x) => x.segment)
        : Array.from(cleanedName);
    // At most 60 characters and 120 code points (one grapheme can carry any number
    // of combining marks), always cut on a grapheme boundary.
    let nameCodePoints = 0;
    const keptChars = [];
    for (const g of nameChars) {
      const n = Array.from(g).length;
      if (keptChars.length >= 60 || nameCodePoints + n > 120) break;
      keptChars.push(g);
      nameCodePoints += n;
    }
    const name = keptChars.join("").trim();
    const ops = cleanSelectionOps(body.ops);
    // A name needs something visible: a letter, number, punctuation or symbol.
    if (!name || !/[\p{L}\p{N}\p{P}\p{S}]/u.test(name) || !ops) {
      return json({ error: "A name and a valid list of selection shapes are required" }, { status: 400 });
    }
    const presets = JSON.parse((await getSetting(env, "photo_editor_selections")) || "[]");
    if (presets.length >= SELECTION_PRESET_LIMIT) {
      return json({ error: `You can save up to ${SELECTION_PRESET_LIMIT} selections; delete one first.` }, { status: 400 });
    }
    if (presets.some((p) => p.name.normalize("NFC").toLowerCase() === name.toLowerCase())) {
      return json({ error: `A saved selection called "${name}" already exists; pick another name.` }, { status: 400 });
    }
    const id = presets.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1;
    presets.push({ id, name, ops });
    await setSetting(env, "photo_editor_selections", JSON.stringify(presets));
    log(ctx, env, "create", "selection-preset", name);
    return json({ id });
  }
  const selectionPresetMatch = path.match(/^\/selection-presets\/(\d+)$/);
  if (selectionPresetMatch && method === "DELETE") {
    const id = Number(selectionPresetMatch[1]);
    const presets = JSON.parse((await getSetting(env, "photo_editor_selections")) || "[]");
    const target = presets.find((p) => p.id === id);
    if (!target) return json({ error: "No such saved selection" }, { status: 404 });
    await setSetting(env, "photo_editor_selections", JSON.stringify(presets.filter((p) => p.id !== id)));
    log(ctx, env, "delete", "selection-preset", target.name);
    return json({ ok: true });
  }

  // /media-saved-searches — a named snapshot of the media library's
  // filter controls (folder/type/dimensions/search text/usage/unused/duplicates), same
  // storage pattern as style presets above and for the same reason: an
  // individually added-to/removed-from list, not something the settings
  // bulk PUT should own.
  if (path === "/media-saved-searches" && method === "GET") {
    const raw = await getSetting(env, "media_saved_searches");
    return json(JSON.parse(raw || "[]"));
  }
  if (path === "/media-saved-searches" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body.name || typeof body.filters !== "object") {
      return json({ error: "name and filters are required" }, { status: 400 });
    }
    const searches = JSON.parse((await getSetting(env, "media_saved_searches")) || "[]");
    const id = searches.reduce((max, s) => Math.max(max, s.id || 0), 0) + 1;
    searches.push({ id, name: String(body.name).slice(0, 60), filters: body.filters });
    await setSetting(env, "media_saved_searches", JSON.stringify(searches));
    log(ctx, env, "create", "media-saved-search", body.name);
    return json({ id });
  }
  const mediaSavedSearchMatch = path.match(/^\/media-saved-searches\/(\d+)$/);
  if (mediaSavedSearchMatch && method === "DELETE") {
    const id = Number(mediaSavedSearchMatch[1]);
    const searches = JSON.parse((await getSetting(env, "media_saved_searches")) || "[]");
    const target = searches.find((s) => s.id === id);
    await setSetting(env, "media_saved_searches", JSON.stringify(searches.filter((s) => s.id !== id)));
    log(ctx, env, "delete", "media-saved-search", target?.name || `#${id}`);
    return json({ ok: true });
  }

  return json({ error: "Not found" }, { status: 404 });
}
