// "Ask search engines not to list this": a list of ids per kind in one setting, so it needs no new column.
import { parseNoindexItems, isNoindexed, getNoindexItems, setNoindexItem, NOINDEX_TYPES } from "../worker/db.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

ok(NOINDEX_TYPES.join() === "page,article,project", "three kinds: pages, articles, projects");
ok(JSON.stringify(parseNoindexItems("")) === '{"page":[],"article":[],"project":[]}' && JSON.stringify(parseNoindexItems(null)) === JSON.stringify(parseNoindexItems("junk")), "nothing, or junk, is empty lists");
ok(JSON.stringify(parseNoindexItems('{"page":[3,"5",3,0,-1,"x",2.5],"article":"no","other":[1]}')) === '{"page":[3,5],"article":[],"project":[]}', "ids are whole positive numbers, once each, sorted; other shapes and kinds are dropped");
ok(isNoindexed({ page: [3] }, "page", 3) && isNoindexed({ page: [3] }, "page", "3") && !isNoindexed({ page: [3] }, "article", 3) && !isNoindexed(null, "page", 1) && !isNoindexed({}, "page", 1), "the check is per kind and tolerates missing data");

function makeEnv(settings = {}) {
  const DB = { prepare(sql) { const st = { args: [], bind(...a) { st.args = a; return st; }, async first() { return st.args[0] in settings ? { value: settings[st.args[0]] } : null; }, async run() { if (/INSERT INTO settings/.test(sql)) settings[st.args[0]] = st.args[1]; return {}; }, async all() { return { results: [] }; } }; return st; } };
  return { DB, settings };
}
{
  const env = makeEnv();
  await setNoindexItem(env, "page", 7, true);
  ok(env.settings.noindex_items === '{"page":[7],"article":[],"project":[]}', "turning it on stores the id under its kind", env.settings.noindex_items);
  await setNoindexItem(env, "article", 2, true); await setNoindexItem(env, "page", 3, true); await setNoindexItem(env, "page", 7, true);
  const items = await getNoindexItems(env);
  ok(items.page.join() === "3,7" && items.article.join() === "2" && items.project.length === 0, "several, sorted, no repeats", items);
  await setNoindexItem(env, "page", 3, false);
  ok((await getNoindexItems(env)).page.join() === "7", "turning it off takes only that one out");
  await setNoindexItem(env, "nonsense", 1, true); await setNoindexItem(env, "page", 99, false);
  ok(JSON.stringify(await getNoindexItems(env)) === '{"page":[7],"article":[2],"project":[]}', "an unknown kind, or an id that was not there, changes nothing");
  await setNoindexItem(env, "page", 7, false); await setNoindexItem(env, "article", 2, false);
  ok(env.settings.noindex_items === "", "when the last one is turned off the setting is cleared", env.settings.noindex_items);
}
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
