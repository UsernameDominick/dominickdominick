// The cut-down public site: only the home page, the Studio and Search are open; everything else is the 404 page.
import assert from "node:assert/strict";
import { isPublicPath, inScope, scopeNav, scopeSearch, scopeSitemap } from "../worker/site-scope.js";

for (const p of ["/", "/studio", "/search", "/api/search-suggest", "/api/track", "/sitemap.xml", "/robots.txt", "/favicon.ico", "/page-access/home",
  "/admin", "/admin/", "/admin/style.css", "/api/admin/pages", "/media/uploads/a.png", "/style.css", "/nav.js", "/fonts/vt323-400.woff2", "/share/studio.png"]) {
  assert.equal(isPublicPath(p), true, p);
}
for (const p of ["/trainer", "/piceditor", "/simulations", "/scans", "/random", "/random/a-post", "/projects", "/projects/x", "/topics", "/topics/web",
  "/archive", "/saved", "/history", "/shuffle", "/rss.xml", "/hidden-notes", "/some-page", "/page-access/other", "/api/react", "/api/study/unlock", "/index.html"]) {
  assert.equal(isPublicPath(p), false, p);
}

assert.equal(inScope("home"), true);
assert.equal(inScope("studio"), true);
assert.equal(inScope("trainer"), false);

const nav = [{ slug: "home", nav_label: "Home", children: [{ slug: "about" }] }, { slug: "trainer" }, { slug: "studio" }, { slug: "about-me" }];
nav.owner = true;
nav.brand = "D";
const scoped = scopeNav(nav);
assert.deepEqual(scoped.map((n) => n.slug), ["home", "studio"]);
assert.deepEqual(scoped[0].children, []);
assert.equal(scoped.owner, true);
assert.equal(scoped.brand, "D");

const found = { pages: [{ slug: "home", title: "Home" }, { slug: "about", title: "About" }], articles: [{ slug: "a" }], projects: [{ slug: "p" }], terms: ["x"] };
const r = scopeSearch(found, "home");
assert.deepEqual(r.pages.map((p) => p.slug), ["home"]);
assert.deepEqual(r.articles, []);
assert.deepEqual(r.projects, []);
assert.equal(r.totalCount, 1);
assert.deepEqual(r.terms, ["x"]);
assert.deepEqual(scopeSearch({ pages: [] }, "drum beats").pages.map((p) => p.slug), ["studio"]);
assert.deepEqual(scopeSearch({ pages: [] }, "drum spreadsheet").pages, []);
assert.deepEqual(scopeSearch({ pages: [] }, "").pages, []);

assert.deepEqual(scopeSitemap([{ loc: "/" }, { loc: "/studio" }, { loc: "/trainer" }, { loc: "/random/a" }, { loc: "/about" }]).map((e) => e.loc), ["/", "/studio"]);
console.log("ALL PASS");
