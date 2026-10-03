// Redirects: only real redirect codes and a sane destination are accepted; old rows can not break serving.
import assert from "node:assert/strict";
import { cleanRedirectStatus, cleanRedirectTarget, safeRedirectStatus, REDIRECT_STATUSES } from "../worker/redirects.js";

assert.deepEqual(REDIRECT_STATUSES, [301, 302, 307, 308]);
for (const good of [301, 302, 307, 308, "301", " 308 "]) assert.equal(cleanRedirectStatus(good).ok, true, String(good));
assert.equal(cleanRedirectStatus("307").value, 307);
for (const empty of [undefined, null, ""]) assert.deepEqual(cleanRedirectStatus(empty), { ok: true, value: 301 }, "left out means permanent");
assert.deepEqual(cleanRedirectStatus(undefined, 302), { ok: true, value: 302 });
for (const bad of [200, 303, 404, 500, 0, -301, 301.5, "abc", "30x", "3011", NaN, {}, [], true]) assert.equal(cleanRedirectStatus(bad).ok, false, JSON.stringify(bad));
assert.match(cleanRedirectStatus(200).error, /301, 302, 307, 308/);

// Destinations.
assert.deepEqual(cleanRedirectTarget("/new-page"), { ok: true, value: "/new-page" });
assert.deepEqual(cleanRedirectTarget("  /new?x=1#top "), { ok: true, value: "/new?x=1#top" });
assert.deepEqual(cleanRedirectTarget("new-page"), { ok: true, value: "/new-page" }, "a bare word has always meant a path on this site");
assert.deepEqual(cleanRedirectTarget("https://example.com/a"), { ok: true, value: "https://example.com/a" });
assert.deepEqual(cleanRedirectTarget("http://example.com"), { ok: true, value: "http://example.com" });
for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,hi", "vbscript:x", "ftp://example.com", "//evil.example/x", "///x", "/a b", "/a\nb", "https://exa mple.com", "http://", "", "   ", "x".repeat(2001), "https:", "mailto:me@example.com"]) {
  assert.equal(cleanRedirectTarget(bad).ok, false, JSON.stringify(bad).slice(0, 40));
}
assert.match(cleanRedirectTarget("javascript:alert(1)").error, /path starting with \//);
assert.match(cleanRedirectTarget("").error, /required/);
assert.equal(cleanRedirectTarget(null).ok, false);

// Serving.
assert.equal(safeRedirectStatus(302), 302);
assert.equal(safeRedirectStatus("308"), 308);
for (const bad of [200, 0, null, undefined, "x", 303]) assert.equal(safeRedirectStatus(bad), 301);

console.log("ALL PASS");
