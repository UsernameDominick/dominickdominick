// The camera-dial nav's icons: each link gets a fitting icon from its slug or label, and an unknown one a plain dot.
import assert from "node:assert/strict";
import { navIconName, navIconSvg, pixelIcon } from "../worker/nav-icons.js";

assert.equal(navIconName("home", "Home"), "home");
assert.equal(navIconName("studio", "Studio"), "studio");
assert.equal(navIconName("settings", "Settings"), "settings");
assert.equal(navIconName("search", "Search"), "search");
assert.equal(navIconName("my-page", "Get in touch"), "dot");
assert.equal(navIconName("", ""), "dot");
assert.equal(navIconName(undefined, undefined), "dot");

const svg = navIconSvg("studio", "studio");
assert.match(svg, /^<svg class="tab-ico" viewBox="0 0 16 16"/);
assert.match(svg, /aria-hidden="true"/);
assert.match(svg, /<path d="M/);

// the pixel icons the dialog and the editor link use exist; an unknown name falls back to the dot
for (const name of ["sun", "moon", "pause", "pencil", "settings", "home", "studio", "search"]) assert.match(pixelIcon(name), /<path d="M/, name);
assert.equal(pixelIcon("no-such-icon"), pixelIcon("dot"));
console.log("ALL PASS");
