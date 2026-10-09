// The public site: only the Studio (and "/", which goes to it), the study unlock and a few files are open; everything else is the 404 page.
import assert from "node:assert/strict";
import { isPublicPath } from "../worker/site-scope.js";

for (const p of ["/", "/studio", "/api/study/unlock", "/sitemap.xml", "/robots.txt", "/favicon.ico",
  "/style.css", "/nav.js", "/fonts/vt323-400.woff2", "/share/studio.png"]) {
  assert.equal(isPublicPath(p), true, p);
}
for (const p of ["/search", "/api/search-suggest", "/api/track", "/api/react", "/page-access/home", "/trainer", "/piceditor", "/simulations", "/scans",
  "/random", "/random/a-post", "/projects", "/projects/x", "/topics", "/topics/web", "/archive", "/saved", "/history", "/shuffle", "/rss.xml",
  "/hidden-notes", "/some-page", "/api/anything-else", "/admin", "/admin/", "/api/admin/pages"]) {
  assert.equal(isPublicPath(p), false, p);
}
// a feed or a page that merely ends in an extension is not a static file
assert.equal(isPublicPath("/rss.xml"), false);
assert.equal(isPublicPath("/page.html"), false);
console.log("ALL PASS");
