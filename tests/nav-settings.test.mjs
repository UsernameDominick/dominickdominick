// The site name and the built-in nav links (Articles, Projects, Topics, Studio) are editable: the cleaning rules and how they reach the nav.
import { cleanBrand, cleanNavBuiltin, parseNavBuiltin, builtinNavItems, BUILTIN_NAV } from "../worker/nav-settings.js";
import { listNavPages } from "../worker/db.js";
import { renderShell } from "../worker/render.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

// ---- site name ----
ok(cleanBrand("  my   site  ") === "my site", "spaces are tidied");
ok(cleanBrand("<b>x</b>\u0000\n") === "bx/b" || cleanBrand("<b>x</b>") === "bx/b", "angle brackets and control characters are removed", cleanBrand("<b>x</b>"));
ok(cleanBrand("a".repeat(100)).length === 40, "and it is cut to 40 characters");
ok(cleanBrand(null) === "" && cleanBrand(undefined) === "" && cleanBrand("   ") === "", "blank means the default");
ok(cleanBrand(12345) === "12345", "a number is text");

// ---- built-in links ----
ok(cleanNavBuiltin("") === "" && cleanNavBuiltin("junk") === "" && cleanNavBuiltin("[]") === "" && cleanNavBuiltin(null) === "" && cleanNavBuiltin("5") === "", "nothing or junk is no overrides");
ok(cleanNavBuiltin({ random: { label: "Writing" } }) === '{"random":{"label":"Writing"}}', "a rename is kept");
ok(cleanNavBuiltin({ random: { label: "Articles" } }) === "", "a name equal to the built-in one is no override");
ok(cleanNavBuiltin({ topics: { hidden: true, label: "  Tags  " } }) === '{"topics":{"label":"Tags","hidden":true}}', "hiding and renaming together");
ok(cleanNavBuiltin({ topics: { hidden: "yes" } }) === "", "only a real true hides");
ok(cleanNavBuiltin({ evil: { label: "x" }, projects: "text", random: null }) === "", "other keys and odd shapes are dropped");
ok(cleanNavBuiltin({ projects: { label: "<script>x" } }) === '{"projects":{"label":"scriptx"}}', "labels are cleaned like the site name");
ok(JSON.stringify(parseNavBuiltin('{"random":{"label":"W"},"zzz":{}}')) === '{"random":{"label":"W"}}', "stored values are cleaned again on the way out");
ok(Object.keys(parseNavBuiltin(cleanNavBuiltin('{"random":{"label":"' + "z".repeat(100) + '"}}')).random.label).length === 40, "and a long label is cut");

// ---- the nav itself ----
{
  const slugs = (items) => items.map((i) => i.slug).join();
  ok(slugs(builtinNavItems({})) === "projects,topics,studio", "by default the built-in links, without Articles (left out until switched back on; it is reached by search)");
ok(slugs(builtinNavItems({ random: { hidden: false } })) === "random,projects,topics,studio" && builtinNavItems({ random: { hidden: false } })[0].nav_label === "Articles", "Articles comes back when switched on");
ok(cleanNavBuiltin({ random: { hidden: false } }) === '{"random":{"hidden":false}}' && cleanNavBuiltin({ projects: { hidden: false } }) === "", "switching on is kept only for a link that is out by default");
  ok(builtinNavItems({ random: { label: "Writing", hidden: false } })[0].nav_label === "Writing", "one can be renamed");
  ok(slugs(builtinNavItems({ projects: { hidden: true } })) === "topics,studio", "one can be hidden");
  ok(slugs(builtinNavItems({}, new Set(["projects"]))) === "topics,studio", "one is skipped when a nav page already links there (as before)");
  ok(builtinNavItems({}).every((i) => i.nav_parent_id === null && Array.isArray(i.children) && i.children.length === 0), "and they have the shape the nav renderer expects");
  ok(BUILTIN_NAV.length === 4, "(four of them)");
}

// ---- reaching the nav, through listNavPages and the page shell ----
function makeEnv(settings, pageRows, extra = {}) {
  const DB = {
    prepare(sql) {
      const stmt = {
        args: [], bind(...a) { stmt.args = a; return stmt; },
        async all() {
          if (/LEFT JOIN pages p/.test(sql)) {
            const meta = { admin_only_ids: settings.nav_admin_only ?? null, brand: settings.site_brand ?? null, builtin: settings.nav_builtin ?? null };
            return { results: pageRows.length ? pageRows.map((p) => ({ ...p, ...meta })) : [{ id: null, slug: null, nav_label: null, nav_parent_id: null, ...meta }] };
          }
          return { results: [] };
        },
        async first() { return null; }, async run() { return {}; },
      };
      return stmt;
    },
  };
  return { DB, ...extra };
}
const labels = (nav) => nav.map((n) => n.nav_label).join("|");
{
  const nav = await listNavPages(makeEnv({}, []));
  ok(labels(nav) === "Projects|Topics|Studio" && nav.brand === "", "with no pages and nothing set: the built-in links (Articles out by default) and the default name", [labels(nav), nav.brand]);
  const named = await listNavPages(makeEnv({ site_brand: " My Site. ", nav_builtin: '{"random":{"label":"Writing","hidden":false},"topics":{"hidden":true}}' }, []));
  ok(labels(named) === "Writing|Projects|Studio" && named.brand === "My Site.", "the site name and the overrides are read even when no page has a nav label", [labels(named), named.brand]);
  const mixed = await listNavPages(makeEnv({ nav_builtin: '{"projects":{"hidden":true}}' }, [{ id: 7, slug: "about", nav_label: "About", nav_parent_id: null }]));
  ok(labels(mixed) === "About|Topics|Studio", "the owner's pages come first, then the built-in links that are left", labels(mixed));
  const covered = await listNavPages(makeEnv({}, [{ id: 8, slug: "projects", nav_label: "My work", nav_parent_id: null }]));
  ok(labels(covered) === "My work|Topics|Studio", "a nav page that stands in for a built-in link still replaces it", labels(covered));
  const ownRandom = await listNavPages(makeEnv({}, [{ id: 3, slug: "random", nav_label: "Random", nav_parent_id: null }, { id: 9, slug: "about", nav_label: "About", nav_parent_id: null }]));
  ok(labels(ownRandom) === "About|Projects|Topics|Studio", "a page of the owner's own on /random follows the Articles switch: out by default", labels(ownRandom));
  const ownRandomOn = await listNavPages(makeEnv({ nav_builtin: '{"random":{"hidden":false}}' }, [{ id: 3, slug: "random", nav_label: "Random", nav_parent_id: null }]));
  ok(labels(ownRandomOn) === "Random|Projects|Topics|Studio", "and back when it is switched on", labels(ownRandomOn));
  const owner = await listNavPages(makeEnv({}, [], { __isAdmin: true }));
  ok(!owner.some((n) => n.slug === "hidden-notes") && owner.owner === true, "Hidden Notes is not a tab, even for the owner (it is in the finder)");
}
{
  const shell = (brand) => {
    const nav = [{ slug: "random", nav_label: "Articles", nav_parent_id: null, children: [] }];
    if (brand !== undefined) nav.brand = brand;
    return renderShell({ title: "T", description: "d", path: "/", navItems: nav, activeSlug: "x", bodyHtml: "<p>hi</p>", theme: {}, footerText: null, customHead: null });
  };
  // The owner took the site name off the header: it is the nav dial alone, whatever the name is set to (and a name never reaches it).
  ok(!shell(undefined).includes('class="brand"') && !shell("My Site").includes('class="brand"'), "the page header has no site name, set or not");
  ok(!shell("<img src=x onerror=1>").includes("<img src=x"), "a name with markup in it never reaches the page as markup");
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
