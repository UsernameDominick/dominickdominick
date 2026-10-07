// The nav dial is ordered with Home in the middle and the other stops on either side (Search, always last, counts as a right-hand stop); the
// dial then scrolls so the stop you are on is the one under the needle.
import { centreHome } from "../worker/nav-order.js";
import { renderShell } from "../worker/render.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const item = (slug, label) => ({ slug, nav_label: label || slug, nav_parent_id: null, children: [] });
const slugs = (list) => list.map((n) => n.slug).join();
const split = (list) => { const r = centreHome(list); return `${slugs(r.left)}|${r.home ? r.home.slug : "-"}|${slugs(r.right)}`; };

// ---- the pure ordering ----
ok(split([item("home"), item("studio"), item("piceditor"), item("simulations"), item("scans")]) === "studio,piceditor|home|simulations,scans",
  "Home, Studio, PicEditor, Sim, Scans: two on the left of Home, two on the right (and Search after them)", split([item("home"), item("studio"), item("piceditor"), item("simulations"), item("scans")]));
ok(split([item("home"), item("a"), item("b"), item("c"), item("d"), item("e")]) === "a,b,c|home|d,e", "five others and Search make six, three each side");
ok(split([item("a"), item("b"), item("home"), item("c")]) === "a,b|home|c", "Home is found wherever it stands in the list, the rest keep their order", split([item("a"), item("b"), item("home"), item("c")]));
ok(split([item("home")]) === "|home|", "Home alone is just Home (and Search after it)", split([item("home")]));
ok(split([item("home"), item("a")]) === "a|home|", "Home and one other: it goes left, Search is the right side", split([item("home"), item("a")]));
{
  const r = centreHome([item("a"), item("b")]);
  ok(r.home === null && slugs(r.right) === "a,b" && r.left.length === 0, "no Home stop: the order is as it was", r);
  const e = centreHome([]);
  ok(e.home === null && e.right.length === 0, "an empty list is fine");
  ok(centreHome(null).right.length === 0, "and so is nothing at all");
}
{
  // nothing is lost or repeated, and the two sides differ by at most Search itself, whatever the count
  let bad = 0;
  for (let n = 0; n <= 12; n++) {
    const list = [item("home"), ...Array.from({ length: n }, (_, i) => item("s" + i))];
    const r = centreHome(list);
    if (r.left.length + r.right.length !== n) bad++;
    if (r.left.length > r.right.length + 1 || r.right.length > r.left.length + 1) bad++;
    if (slugs([...r.left, r.home, ...r.right]).split(",").sort().join() !== slugs(list).split(",").sort().join()) bad++;
  }
  ok(bad === 0, "for 0 to 12 other stops nothing is lost and the two sides are within one stop of each other", bad);
}

// ---- in the page ----
const shell = (navItems, activeSlug = "studio") => renderShell({ title: "T", description: "d", path: "/", navItems, activeSlug, bodyHtml: "<p>hi</p>", theme: {}, footerText: null, customHead: null });
const strip = (html) => html.slice(html.indexOf('<div class="tabs">'), html.indexOf("</nav>", html.indexOf('<div class="tabs">')));
const order = (html) => [...strip(html).matchAll(/<a class="tab[^"]*" href="([^"]*)"|id="finder-open"/g)].map((m) => (m[1] !== undefined ? m[1] : "search"));
{
  const html = shell([item("home", "Home"), item("studio", "Studio"), item("piceditor", "PicEditor"), item("simulations", "Sim"), item("scans", "Scans")]);
  ok(order(html).join(",") === "/studio,/piceditor,/,/simulations,/scans,search", "the page draws: Studio, PicEditor, Home, Sim, Scans, Search", order(html));
  ok((strip(html).match(/class="tab tab-home/g) || []).length === 1 && /<a class="tab tab-home[^"]*" href="\/"/.test(strip(html)), "Home carries the tab-home class (a little bigger)");
  ok(!strip(html).includes("tab-spacer") && /<\/div><span class="tab-indicator" aria-hidden="true"><\/span><\/nav>/.test(html), "there is no filler in the strip, and the needle sits after it (it stays in the middle while the strip scrolls)");
  ok(/class="tab-label">Sim</.test(html), "the label is written as the owner typed it (lowercase is a style, not a rewrite)");
  const even = shell([item("home"), item("a"), item("b"), item("c"), item("d"), item("e")], "a");
  ok(order(even).join(",") === "/a,/b,/c,/,/d,/e,search", "an even count is split three and three", order(even));
  const noHome = shell([item("a"), item("b")], "a");
  ok(order(noHome).join(",") === "/a,/b,search" && !strip(noHome).includes("tab-home"), "with no Home page the order is as it was", order(noHome));
  // the dropdown parent stays whole when it is moved
  const kids = { ...item("about", "About"), children: [{ slug: "team", nav_label: "Team" }] };
  const grouped = shell([item("home"), kids, item("studio")], "home");
  ok(/<div class="tab-group">\s*<a class="tab" href="\/about"/.test(strip(grouped)) && /id="nav-dropdown-about"/.test(grouped), "a stop with a dropdown moves as one piece");
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
