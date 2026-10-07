// The nav dial puts Home in the middle with the other stops on either side (Search, always last, counts as a right-hand stop), and adds an
// empty slot at the far left when the two sides would not be equally wide, so Home is dead centre.
import { centreHome } from "../worker/nav-order.js";
import { renderShell } from "../worker/render.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const item = (slug, label) => ({ slug, nav_label: label || slug, nav_parent_id: null, children: [] });
const slugs = (list) => list.map((n) => n.slug).join();
const split = (list) => { const r = centreHome(list); return `${slugs(r.left)}|${r.home ? r.home.slug : "-"}|${slugs(r.right)}|gap${r.gap}`; };

// ---- the pure ordering ----
ok(split([item("home"), item("studio"), item("piceditor"), item("simulations"), item("scans")]) === "studio,piceditor|home|simulations,scans|gap1",
  "Home, Studio, PicEditor, Sim, Scans: two on the left, two on the right, Search makes the right three, so one empty slot on the left", split([item("home"), item("studio"), item("piceditor"), item("simulations"), item("scans")]));
ok(split([item("home"), item("a"), item("b"), item("c"), item("d"), item("e")]) === "a,b,c|home|d,e|gap0", "five others and Search make six, three each side, no empty slot");
ok(split([item("a"), item("b"), item("home"), item("c")]) === "a,b|home|c|gap0", "Home is found wherever it stands in the list, the rest keep their order", split([item("a"), item("b"), item("home"), item("c")]));
ok(split([item("home")]) === "|home||gap1", "Home alone (with Search) gets an empty slot to its left", split([item("home")]));
ok(split([item("home"), item("a")]) === "a|home||gap0", "Home and one other: it goes left, Search is the right side", split([item("home"), item("a")]));
{
  const r = centreHome([item("a"), item("b")]);
  ok(r.home === null && slugs(r.right) === "a,b" && r.left.length === 0 && r.gap === 0, "no Home stop: the order and no empty slot", r);
  const e = centreHome([]);
  ok(e.home === null && e.right.length === 0 && e.gap === 0, "an empty list is fine");
  ok(centreHome(null).right.length === 0, "and so is nothing at all");
}
{
  // both sides always equally wide, whatever the count
  let bad = 0;
  for (let n = 0; n <= 12; n++) {
    const list = [item("home"), ...Array.from({ length: n }, (_, i) => item("s" + i))];
    const r = centreHome(list);
    if (r.left.length + r.gap !== r.right.length + 1) bad++; // the right side counts Search
    if (r.left.length + r.right.length !== n) bad++;
  }
  ok(bad === 0, "for 0 to 12 other stops the two sides (empty slot and Search counted) are equally wide and nothing is lost", bad);
}

// ---- in the page ----
const shell = (navItems, activeSlug = "studio") => renderShell({ title: "T", description: "d", path: "/", navItems, activeSlug, bodyHtml: "<p>hi</p>", theme: {}, footerText: null, customHead: null });
const strip = (html) => html.slice(html.indexOf('<div class="tabs">'), html.indexOf("</nav>", html.indexOf('<div class="tabs">')));
const order = (html) => [...strip(html).matchAll(/<a class="tab[^"]*" href="([^"]*)"|<span class="tab-spacer"|id="finder-open"/g)].map((m) => (m[1] !== undefined ? m[1] || m[0] : m[0].includes("spacer") ? "spacer" : "search"));
{
  const html = shell([item("home", "Home"), item("studio", "Studio"), item("piceditor", "PicEditor"), item("simulations", "Sim"), item("scans", "Scans")]);
  ok(order(html).join(",") === "spacer,/studio,/piceditor,/,/simulations,/scans,search", "the page draws: empty slot, Studio, PicEditor, Home, Sim, Scans, Search", order(html));
  ok((strip(html).match(/class="tab tab-home/g) || []).length === 1 && /<a class="tab tab-home[^"]*" href="\/"/.test(strip(html)), "Home carries the tab-home class (a little bigger)");
  ok(/<span class="tab-spacer" aria-hidden="true"><\/span>/.test(strip(html)), "the empty slot is hidden from screen readers");
  ok(/class="tab-label">Sim</.test(html), "the label is written as the owner typed it (lowercase is a style, not a rewrite)");
  const even = shell([item("home"), item("a"), item("b"), item("c"), item("d"), item("e")], "a");
  ok(!strip(even).includes("tab-spacer") && order(even).join(",") === "/a,/b,/c,/,/d,/e,search", "an even count has no empty slot", order(even));
  const noHome = shell([item("a"), item("b")], "a");
  ok(order(noHome).join(",") === "/a,/b,search" && !strip(noHome).includes("tab-spacer") && !strip(noHome).includes("tab-home"), "with no Home page the order is as it was", order(noHome));
  // the dropdown parent stays whole when it is moved
  const kids = { ...item("about", "About"), children: [{ slug: "team", nav_label: "Team" }] };
  const grouped = shell([item("home"), kids, item("studio")], "home");
  ok(/<div class="tab-group">\s*<a class="tab" href="\/about"/.test(strip(grouped)) && /id="nav-dropdown-about"/.test(grouped), "a stop with a dropdown moves as one piece");
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
