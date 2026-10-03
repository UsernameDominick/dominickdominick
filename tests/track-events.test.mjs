// The public /api/track endpoint: which event names and paths it will record.
import assert from "node:assert/strict";
import { cleanTrackName, cleanTrackPath } from "../worker/track.js";

// Names the site itself sends, and the sort an admin types into a Button block's "Track clicks as" box.
for (const good of ["download", "outbound_link", "theme_toggle", "motion_toggle", "copy_link", "download_pdf", "lightbox_open", "cta hero", "Newsletter signup", "cta:hero-1", "buy.now/v2", "démo clic", "按钮 点击", "a", "7"]) {
  assert.equal(cleanTrackName(good), good, good);
}
assert.equal(cleanTrackName("  spaced   out  "), "spaced out", "trimmed and single-spaced");
assert.equal(cleanTrackName("x".repeat(64)), "x".repeat(64));

// The names the server writes itself, in any spelling that reads the same.
for (const reserved of ["not_found", "search", "Search", "SEARCH", "not found", "Not-Found", "NOT_FOUND", " search "]) assert.equal(cleanTrackName(reserved), null, reserved);
assert.equal(cleanTrackName("searches"), "searches", "only the exact names are held back");
assert.equal(cleanTrackName("search_box"), "search_box");

// Junk.
for (const bad of ["", "   ", "x".repeat(65), "<script>", "a<b", 'say "hi"', "it's", "a&b", "a;b", "a\nb", "a\u0000b", "(x)", "[x]", "{x}", "_leading", "-leading", ".x", "emoji 😀", null, undefined, 5, true, {}, [], ["search"]]) {
  assert.equal(cleanTrackName(bad), null, JSON.stringify(bad));
}

// Paths.
assert.equal(cleanTrackPath("/random/post"), "/random/post");
assert.equal(cleanTrackPath("  /a?b=1#c "), "/a?b=1#c");
assert.equal(cleanTrackPath("/" + "x".repeat(400)).length, 300, "clipped to 300");
for (const bad of ["", "random/post", "//evil.example/x", "https://example.com/x", "javascript:alert(1)", "/a\nb", null, undefined, 5, {}]) assert.equal(cleanTrackPath(bad), null, JSON.stringify(bad));

console.log("ALL PASS");
