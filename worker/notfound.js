// Helpers for pages that don't exist: which misses are worth recording (a reader following a broken link) and which are
// noise (scanners probing for WordPress, .env files and the like), and the nearest real address to offer a lost reader.

const MAX_LOGGED_PATH = 160;

// Paths automated scanners ask for on every site. None of them is a reader, and recording them would bury the real misses.
const PROBE = [
  /^\/wp-/i,
  /^\/wordpress/i,
  /^\/xmlrpc/i,
  /^\/\.(env|git|svn|hg|aws|ssh|well-known)/i,
  /^\/(phpmyadmin|pma|myadmin|mysql|adminer|cgi-bin|vendor|node_modules|actuator|server-status|solr|boaform|hudson|jenkins|console|manager|geoserver|ecp|owa|autodiscover|remote|login\.action)\b/i,
  /^\/admin\/?(\.|$)/i,
  /\.(php\d?|asp|aspx|jsp|cgi|env|ini|bak|sql|zip|gz|tar|rar|7z|log|yml|yaml|conf|config|htaccess|htpasswd|pem|key|git)$/i,
  /\.\./,
  /\/\//,
];

// Browser and tool requests that aren't links anyone followed: icons, maps, service workers and similar.
const NOT_A_LINK = [/^\/(apple-touch-icon|favicon|browserconfig|manifest|sw\.js|service-worker|robots|sitemap|ads\.txt|security\.txt|humans\.txt)/i, /\.(map|png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|woff2?|ttf|otf|mp4|webm|mp3|wav|ogg|json|xml|txt|pdf)$/i];

// The path to record for a 404, or null when it should not be recorded. The result is exactly what a redirect would have to match
// (redirects compare the address as typed), so it is not re-cased and an address with escapes in it ("%20" and the like) is
// dropped rather than recorded in a form a redirect could never catch. A trailing slash is trimmed (the Redirects tool does too).
export function notFoundLogPath(rawPath) {
  const raw = String(rawPath || "");
  if (!raw.startsWith("/") || raw.length > MAX_LOGGED_PATH || /[%\u0000-\u001f\u007f<>"'`\\]/.test(raw)) return null;
  const path = raw.replace(/\/+$/, "") || "/";
  if (path === "/") return null;
  if (PROBE.some((re) => re.test(path)) || NOT_A_LINK.some((re) => re.test(path))) return null;
  return path;
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// The closest real address to a missing one, or null if nothing is close enough to be worth offering. `candidates` is a list of
// { path, label } (the site's own pages, articles and projects). The last segment of each is compared (so /random/my-artcle
// finds /random/my-article), and the section must agree when the miss has one (an article slug never matches a project).
export function suggestNearest(missingPath, candidates) {
  const parts = String(missingPath || "").toLowerCase().replace(/\/+$/, "").split("/").filter(Boolean);
  if (!parts.length) return null;
  const slug = parts[parts.length - 1];
  const section = parts.length > 1 ? parts[0] : null;
  let best = null;
  for (const c of candidates || []) {
    const cParts = String(c.path || "").toLowerCase().split("/").filter(Boolean);
    if (!cParts.length) continue;
    const cSlug = cParts[cParts.length - 1];
    const cSection = cParts.length > 1 ? cParts[0] : null;
    if (section && cSection && section !== cSection) continue;
    const distance = editDistance(slug, cSlug);
    // Close in spelling (about a third of the longer word at most), or one is the start of the other ("simulator" for "simulator-intro").
    const limit = Math.max(2, Math.floor(Math.max(slug.length, cSlug.length) / 3));
    const prefix = slug.length >= 5 && (cSlug.startsWith(slug) || slug.startsWith(cSlug)) && cSlug.length >= 5;
    if (distance > limit && !prefix) continue;
    const score = prefix ? Math.min(distance, 1) : distance;
    if (!best || score < best.score) best = { score, path: c.path, label: c.label };
  }
  return best ? { path: best.path, label: best.label } : null;
}
