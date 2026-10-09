// Decides which addresses the public site answers: the home page, the Studio, the study unlock, the sitemap and robots files, the
// favicon, uploaded pictures, static files, and the admin with its API. Every other address is the 404 page.

const OPEN_PATHS = new Set(["/", "/studio", "/api/study/unlock", "/sitemap.xml", "/robots.txt", "/favicon.ico"]);

export function isPublicPath(path) {
  if (OPEN_PATHS.has(path)) return true;
  if (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin")) return true;
  if (path.startsWith("/media/")) return true; // pictures on the home page
  // Files: scripts, styles, fonts, share pictures (the last part of the path has an extension). Feeds and pages are not files.
  return /\/[^/]+\.[a-z0-9]+$/i.test(path) && !/\.(xml|html?)$/i.test(path);
}
