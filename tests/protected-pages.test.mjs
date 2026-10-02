// Password-protected pages: what the public listings may say about them. A locked page must not show up (title, link, description) in
// public search or in the "did you mean" suggestions on a 404, and the owner's note must say why the page opened for them.
import { publicSearch, listLinkTargets } from "../worker/db.js";
import { renderProtectedPageBannerHtml } from "../worker/render.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const pages = [
  { id: 1, slug: "home", title: "Home", nav_label: null, password_hash: null },
  { id: 2, slug: "open-page", title: "Open page", nav_label: null, password_hash: null },
  { id: 3, slug: "locked-page", title: "Locked page", nav_label: null, password_hash: "abc123" },
];
function makeEnv() {
  const sql = [];
  const run = (text, binds = []) => {
    sql.push(text.replace(/\s+/g, " ").trim());
    const rows = () => (/FROM pages WHERE deleted_at IS NULL ORDER BY id/.test(text) ? pages : []);
    return {
      all: async () => ({ results: rows() }),
      first: async () => ({ n: 0 }),
      run: async () => ({}),
    };
  };
  return { sql, DB: { prepare: (text) => ({ bind: (...b) => run(text, b), ...run(text) }) } };
}

// ---- public search never asks the database for protected pages ----
{
  const env = makeEnv();
  await publicSearch(env, "locked", {});
  const pageQueries = env.sql.filter((q) => /FROM pages /.test(q));
  ok(pageQueries.length >= 2, "search looks at pages (a list and a count)", pageQueries.length);
  ok(pageQueries.every((q) => /password_hash IS NULL/.test(q)), "every one of those queries leaves protected pages out", pageQueries);
  for (const type of ["page", "article", "project", ""]) {
    const e = makeEnv();
    await publicSearch(e, "locked", { type });
    const qs = e.sql.filter((q) => /FROM pages /.test(q));
    ok(qs.every((q) => /password_hash IS NULL/.test(q)), `also with the "${type || "all"}" filter`);
  }
}

// ---- 404 suggestions ----
{
  const env = makeEnv();
  const everything = await listLinkTargets(env);
  ok(everything.some((t) => t.path === "/locked-page"), "the admin's link list still has every page (it is for the owner)");
  const publicList = await listLinkTargets(env, { publicOnly: true });
  ok(!publicList.some((t) => t.path === "/locked-page" || /Locked/.test(t.label)), "the public list leaves the protected page out", publicList);
  ok(publicList.some((t) => t.path === "/open-page"), "and keeps the others", publicList.map((t) => t.path));
  ok(!publicList.some((t) => t.path === "/home"), "(home is never a suggestion, as before)");
}

// ---- the owner's note ----
{
  const html = renderProtectedPageBannerHtml();
  ok(/password protected/.test(html) && /signed in/.test(html) && /private window/.test(html), "the note says the page is protected, that the owner is signed in, and how to see the visitor's view");
  ok(/^<div class="preview-banner">/.test(html) && !/<script/.test(html), "it is the same plain banner as the draft one");
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
