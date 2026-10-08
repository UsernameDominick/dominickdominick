// Decides what the public site shows. The owner cut it down to the home page, the Studio and Search: every other public address is
// the 404 page, the nav, sitemap and search only offer those, and the code behind the rest stays in place (add a slug here to bring
// a page back). The admin and its API are not affected.

// Pages that stay: nav slugs and page slugs ("home" is "/").
export const SCOPE_SLUGS = ["home", "studio"];

const OPEN_PATHS = new Set([
  "/",
  "/studio",
  "/search",
  "/api/search-suggest",
  "/api/track",
  "/sitemap.xml",
  "/robots.txt",
  "/favicon.ico",
  "/page-access/home",
]);

// Words a search can match the Studio by (it is an app page, not a page in the database).
const STUDIO_RESULT = {
  slug: "studio",
  title: "studio", // lowercase, like the nav (the owner asked)
  meta_description: "Make music in your browser: a step sequencer, a piano roll, forty instruments and fifteen drum kits.",
  words: "studio music song songs beat beats make drums bass chords melody lead piano roll sequencer instruments midi daw",
};

export function isPublicPath(path) {
  if (OPEN_PATHS.has(path)) return true;
  if (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin")) return true;
  if (path.startsWith("/media/")) return true; // pictures on the home page
  // Files: scripts, styles, fonts, share pictures (the last part of the path has an extension). Feeds and pages are not files.
  return /\/[^/]+\.[a-z0-9]+$/i.test(path) && !/\.(xml|html?)$/i.test(path);
}

export function inScope(slug) {
  return SCOPE_SLUGS.includes(slug);
}

// The nav keeps only the pages that stay, and none of their dropdown children. The list's own properties (owner, brand) are kept.
export function scopeNav(nav) {
  const out = (nav || []).filter((n) => inScope(n.slug)).map((n) => ({ ...n, children: [] }));
  for (const key of Object.keys(nav || {})) if (!/^\d+$/.test(key)) out[key] = nav[key];
  return out;
}

// Search results limited to the pages that stay, with the Studio offered when every word of the query is one of its words.
export function scopeSearch(found, query) {
  const pages = ((found && found.pages) || []).filter((p) => inScope(p.slug));
  const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  const studioText = `${STUDIO_RESULT.title} ${STUDIO_RESULT.meta_description} ${STUDIO_RESULT.words}`.toLowerCase();
  if (terms.length && terms.every((t) => studioText.includes(t)) && !pages.some((p) => p.slug === "studio")) {
    pages.push({ slug: STUDIO_RESULT.slug, title: STUDIO_RESULT.title, meta_description: STUDIO_RESULT.meta_description });
  }
  return { ...(found || {}), pages, articles: [], projects: [], totalCount: pages.length };
}

// Sitemap entries for the addresses that stay.
export function scopeSitemap(entries) {
  return (entries || []).filter((e) => e.loc === "/" || inScope(String(e.loc).replace(/^\//, "")));
}
