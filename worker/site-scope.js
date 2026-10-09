// Decides which addresses the public site answers: the Studio (and "/", which goes to it), the study unlock, the sitemap and robots files, the
// favicon and static files. Every other address is the 404 page.

const OPEN_PATHS = new Set(["/", "/studio", "/api/study/unlock", "/sitemap.xml", "/robots.txt", "/favicon.ico"]);

export function isPublicPath(path) {
  if (OPEN_PATHS.has(path)) return true;
  // Files: scripts, styles, fonts, share pictures (the last part of the path has an extension). Feeds and pages are not files.
  return /\/[^/]+\.[a-z0-9]+$/i.test(path) && !/\.(xml|html?)$/i.test(path);
}
