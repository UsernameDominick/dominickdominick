// The camera-dial nav's icons: each link gets a fitting icon from its slug or label, and an unknown one a plain dot.
import assert from "node:assert/strict";
import { navIconName, navIconSvg } from "../worker/nav-icons.js";

assert.equal(navIconName("home", "Home"), "home");
assert.equal(navIconName("projects", "Projects"), "projects");
assert.equal(navIconName("random", "Articles"), "random");
assert.equal(navIconName("topics", "Topics"), "topics");
assert.equal(navIconName("studio", "Studio"), "studio");
assert.equal(navIconName("hidden-notes", "Hidden Notes"), "notes");
assert.equal(navIconName("components", "Components"), "components");
assert.equal(navIconName("my-page", "Get in touch"), "dot");
assert.equal(navIconName("x1", "Contact me"), "contact");
assert.equal(navIconName("blog", "Writing"), "articles");
const svg = navIconSvg("home", "Home");
assert.ok(svg.startsWith('<svg class="tab-ico"') && svg.includes('aria-hidden="true"') && svg.includes("<path"));
assert.ok(!/[<>"]/.test(navIconName('"><script>', "")), "a name is always one of ours");
console.log("ALL PASS");
