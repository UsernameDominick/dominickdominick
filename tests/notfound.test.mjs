// Missing-page tracking: which misses are recorded, the nearest real address offered to a lost reader, and the 404 markup.
import assert from "node:assert/strict";
import { notFoundLogPath, suggestNearest } from "../worker/notfound.js";
import { renderNotFoundHtml } from "../worker/render.js";

// Real broken links are recorded as typed (a redirect matches the address exactly), minus a trailing slash.
assert.equal(notFoundLogPath("/old-post"), "/old-post");
assert.equal(notFoundLogPath("/old-post/"), "/old-post");
assert.equal(notFoundLogPath("/Random/My-Post"), "/Random/My-Post");
assert.equal(notFoundLogPath("/random/my-artcle"), "/random/my-artcle");

// Scanner probes, non-links and odd input are not.
for (const probe of [
  "/wp-login.php", "/wp-admin/setup-config.php", "/wordpress/wp-includes/x", "/xmlrpc.php", "/.env", "/.git/config", "/.well-known/x",
  "/phpmyadmin/index.php", "/cgi-bin/luci", "/admin.php", "/backup.zip", "/config.yml", "/a/../../etc/passwd", "/a//b", "/actuator/health",
]) assert.equal(notFoundLogPath(probe), null, probe);
for (const asset of ["/favicon.ico", "/apple-touch-icon.png", "/robots.txt", "/sitemap.xml", "/x.png", "/app.js.map", "/sw.js", "/data.json"]) {
  assert.equal(notFoundLogPath(asset), null, asset);
}
for (const odd of ["/", "", "no-slash", "/has space%20", "/a%2e%2e/b", "/<script>", "/it's", "/a\u0000b", "/" + "x".repeat(200), null, undefined]) {
  assert.equal(notFoundLogPath(odd), null, String(odd));
}

// Suggestions: typos and shortened slugs find their neighbour; unrelated misses and other sections do not.
const targets = [
  { path: "/random/led-blink-basics", label: "LED blink basics" },
  { path: "/random/transistor-switch", label: "Transistor switch" },
  { path: "/projects/led-blink-basics", label: "LED blink (project)" },
  { path: "/about", label: "About" },
  { path: "/contact", label: "Contact me" },
];
assert.deepEqual(suggestNearest("/random/led-blink-basic", targets), { path: "/random/led-blink-basics", label: "LED blink basics" });
assert.deepEqual(suggestNearest("/random/transitor-switch", targets), { path: "/random/transistor-switch", label: "Transistor switch" });
assert.deepEqual(suggestNearest("/projects/led-blnk-basics", targets), { path: "/projects/led-blink-basics", label: "LED blink (project)" });
assert.deepEqual(suggestNearest("/abuot", targets), { path: "/about", label: "About" });
assert.deepEqual(suggestNearest("/random/transistor", targets), { path: "/random/transistor-switch", label: "Transistor switch" }, "a start of the slug");
assert.equal(suggestNearest("/random/something-else-entirely", targets), null);
assert.equal(suggestNearest("/projects/transistor-switch", targets), null, "the section must agree");
assert.equal(suggestNearest("/", targets), null);
assert.equal(suggestNearest("/abc", []), null);
assert.equal(suggestNearest("/zzzz", targets), null);

// The 404 page offers the neighbour first, escaped, and still lists the usual ways out.
const nav = [{ slug: "about", nav_label: "About" }];
const withHint = renderNotFoundHtml(nav, [], { path: '/random/a"b', label: "<b>Odd</b>" });
assert.match(withHint, /Did you mean <a href="\/random\/a&quot;b">&lt;b&gt;Odd&lt;\/b&gt;<\/a>\?/);
assert.doesNotMatch(renderNotFoundHtml(nav, []), /Did you mean/);
// The archive is off the cut-down site (worker/site-scope.js), so the 404 no longer links to it.
assert.doesNotMatch(renderNotFoundHtml(nav, []), /Browse the full archive/);

console.log("ALL PASS");
