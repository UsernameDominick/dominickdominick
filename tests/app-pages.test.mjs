// The site's app pages (/studio, /piceditor, /simulations, /scans) are listed once, in worker/app-pages.js, and everything that has to agree
// about them is checked here: a nav link and a reserved slug of the same name, one line in the sitemap, a script file that exists and
// registers itself with the kit for the mount the page holds, the scripts and admin dialogs it asks the kit for, and a page body its
// script can build into.
import fs from "node:fs";
import { APP_PAGES, appPageFor, appPageBody } from "../worker/app-pages.js";
import { BUILTIN_NAV } from "../worker/nav-settings.js";
import { RESERVED_SLUGS } from "../worker/db.js";
import { buildSitemapEntries } from "../worker/sitemap.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined && !c ? " " + JSON.stringify(extra) : ""}`); };
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const adminPage = fs.readFileSync("public/admin/index.html", "utf8");

ok(["/studio", "/piceditor", "/simulations", "/scans"].every((p) => APP_PAGES.some((a) => a.path === p)), "the Studio, PicEditor, Simulations and Scans are all app pages", APP_PAGES.map((a) => a.path));
for (const key of ["path", "slug", "mountId", "script"]) {
  const values = APP_PAGES.map((a) => a[key]);
  ok(new Set(values).size === values.length, `no two app pages share a ${key}`, values);
}

for (const page of APP_PAGES) {
  const name = page.slug;
  ok(page.path === "/" + page.slug && /^[a-z]+$/.test(page.slug), `${name}: its address is its slug`, page.path);
  ok(page.title.length > 10 && page.title.length <= 80 && page.description.length >= 60 && page.description.length <= 155 && page.h1 && page.about && page.loading, `${name}: it has a title, a description and the words for search engines and screen readers`);
  ok(appPageFor(page.path) === page && appPageFor(page.path + "x") === null, `${name}: it is found by its address`);
  ok(BUILTIN_NAV.some((n) => n.slug === page.slug), `${name}: it has a built-in nav link`);
  ok(RESERVED_SLUGS.has(page.slug), `${name}: a page of the owner's cannot take its address`);
  const body = appPageBody(page, esc);
  ok(body.includes(`id="${page.mountId}"`) && body.includes('class="app-mount"') && body.includes(esc(page.h1)), `${name}: the page holds the mount its script builds into`, body.slice(0, 200));

  // its share card
  ok(/^\/share\/[a-z]+\.png$/.test(page.image || "") && fs.existsSync("public" + page.image), `${name}: it has a share card that exists`, page.image);
  // its script
  const file = "public" + page.script;
  ok(fs.existsSync(file), `${name}: its script exists`, file);
  const src = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  ok(/SiteAppKit/.test(src) && /\.register\(\{/.test(src), `${name}: it is built on the app kit`);
  ok(new RegExp(`mountId:\\s*"${page.mountId}"`).test(src), `${name}: it builds into the mount the page holds`);
  const list = (key) => { const m = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(src); return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : []; };
  const scripts = list("scripts");
  const dialogs = list("dialogs");
  ok(scripts.length > 0 && scripts.every((s) => fs.existsSync("public" + s)), `${name}: every script it loads exists`, scripts.filter((s) => !fs.existsSync("public" + s)));
  const standalone = /standalone:\s*true/.test(src); // an app with no admin tool behind it takes no dialogs
  ok((standalone ? dialogs.length === 0 : dialogs.length > 0) && dialogs.every((d) => adminPage.includes(`id="${d}"`)), `${name}: every admin dialog it takes is on the admin page`, dialogs.filter((d) => !adminPage.includes(`id="${d}"`)));
}

// the sitemap lists each page once
const entries = buildSitemapEntries({}, { isInSitemap: () => true, reservedSlugs: RESERVED_SLUGS });
for (const page of APP_PAGES) ok(entries.filter((e) => e.loc === page.path).length === 1, `${page.slug}: one line in the sitemap`);

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
