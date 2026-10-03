// Admin-only nav links: a page's link can be shown only to the signed-in owner. Kept as a list of page ids in one setting.
import { listNavPages, parseNavAdminOnly, getNavAdminOnlyIds, setNavAdminOnly } from "../worker/db.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const pages = [
  { id: 1, slug: "home", nav_label: "Home", nav_parent_id: null },
  { id: 2, slug: "about", nav_label: "About", nav_parent_id: null },
  { id: 3, slug: "secret", nav_label: "Secret", nav_parent_id: null },
  { id: 4, slug: "secret-child", nav_label: "Secret child", nav_parent_id: 3 },
  { id: 5, slug: "about-child", nav_label: "About child", nav_parent_id: 2 },
  { id: 6, slug: "projects", nav_label: "My projects", nav_parent_id: null },
];
function makeEnv(settings = {}, extra = {}) {
  const log = [];
  const DB = {
    prepare(sql) {
      const stmt = {
        args: [],
        bind(...a) { stmt.args = a; return stmt; },
        async all() {
          log.push(sql);
          if (/LEFT JOIN pages p/.test(sql)) {
            const meta = { admin_only_ids: settings.nav_admin_only ?? null, brand: settings.site_brand ?? null, builtin: settings.nav_builtin ?? null };
            return { results: pages.length ? pages.map((p) => ({ ...p, ...meta })) : [{ id: null, slug: null, nav_label: null, nav_parent_id: null, ...meta }] };
          }
          return { results: [] };
        },
        async first() {
          if (/FROM settings WHERE key = \?/.test(sql)) return stmt.args[0] in settings ? { value: settings[stmt.args[0]] } : null;
          return null;
        },
        async run() { if (/INSERT INTO settings/.test(sql)) settings[stmt.args[0]] = stmt.args[1]; return {}; },
      };
      return stmt;
    },
  };
  return { DB, log, ...extra };
}
const labels = (nav) => nav.map((n) => n.nav_label + (n.children && n.children.length ? "[" + n.children.map((c) => c.nav_label).join(",") + "]" : ""));

// ---- the stored list ----
ok(parseNavAdminOnly('[3,"5",3,0,-1,"x",null,2.5]').join() === "3,5", "the list keeps whole positive page ids, once each");
ok(parseNavAdminOnly("not json").length === 0 && parseNavAdminOnly('{"a":1}').length === 0 && parseNavAdminOnly(null).length === 0 && parseNavAdminOnly("").length === 0, "junk or nothing is an empty list");

// ---- who sees what ----
{
  const env = makeEnv({ nav_admin_only: "[3]" });
  const visitor = labels(await listNavPages(env));
  ok(!visitor.some((l) => /Secret/.test(l)), "a visitor does not see an admin-only link", visitor);
  ok(visitor.includes("About[About child]") && visitor.includes("Home"), "or anything else's position being changed");
  ok(!visitor.join().includes("Secret child"), "and the pages nested under it are hidden too (not left at the top level)");
}
{
  const env = makeEnv({ nav_admin_only: "[3]" }, { __isAdmin: true });
  const nav = await listNavPages(env);
  const names = labels(nav);
  ok(names.includes("Secret[Secret child]"), "the owner sees it, with its children", names);
  ok(nav.find((n) => n.slug === "secret").admin_only === true && !nav.find((n) => n.slug === "about").admin_only, "and it is marked so it can be told apart");
}
{
  const env = makeEnv({ nav_admin_only: "[5]" });
  const visitor = labels(await listNavPages(env));
  ok(visitor.includes("About") && !visitor.join().includes("About child"), "a nested link can be admin-only on its own", visitor);
}
{
  const env = makeEnv({});
  const visitor = labels(await listNavPages(env));
  ok(visitor.includes("Secret[Secret child]"), "with nothing set, everything shows as before", visitor);
  ok(!(await listNavPages(env)).some((n) => "admin_only" in n && n.admin_only), "and nothing is marked");
}
{
  // a hidden page that replaces a built-in item does not bring the built-in one back
  const env = makeEnv({ nav_admin_only: "[6]" });
  const visitor = (await listNavPages(env)).map((n) => n.slug);
  ok(!visitor.includes("projects"), "hiding a page that stands in for a built-in link does not bring the built-in link back", visitor);
}
{
  const env = makeEnv({ nav_admin_only: "[3]" });
  await listNavPages(env);
  ok(env.log.length === 1, "it costs no extra database query (the list rides in the same one)", env.log.length);
}

// ---- turning it on and off ----
{
  const settings = {};
  const env = makeEnv(settings);
  await setNavAdminOnly(env, 3, true);
  ok(settings.nav_admin_only === "[3]", "turning it on stores the page", settings);
  await setNavAdminOnly(env, 2, true); await setNavAdminOnly(env, 3, true);
  ok(settings.nav_admin_only === "[2,3]", "several pages, sorted, no repeats", settings);
  await setNavAdminOnly(env, 2, false);
  ok(settings.nav_admin_only === "[3]", "turning it off takes the page out", settings);
  await setNavAdminOnly(env, "3", false); await setNavAdminOnly(env, 99, false);
  ok(settings.nav_admin_only === "[]" && (await getNavAdminOnlyIds(env)).length === 0, "and an id that was not there is harmless", settings);
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
