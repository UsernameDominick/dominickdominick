// The Studio is the site's one app page (built on public/app-kit.js). Everything that has to agree about it is checked here: its entry in
// worker/app-pages.js, a script that exists and registers itself with the kit for the mount the page holds, the scripts it asks the kit
// for, a page body its script can build into, and the dialogs it takes. The Studio builds its page from public/studio/dialogs.txt
// (its own file, not the admin's), so a dialog id missing there would break it without any error on the server.
import fs from "node:fs";
import { APP_PAGES, appPageFor, appPageBody } from "../worker/app-pages.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined && !c ? " " + JSON.stringify(extra) : ""}`); };
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dialogsFile = fs.readFileSync("public/studio/dialogs.txt", "utf8");

ok(APP_PAGES.length === 1 && APP_PAGES[0].path === "/studio", "the Studio is the only app page", APP_PAGES.map((a) => a.path));
for (const page of APP_PAGES) {
  const name = page.slug;
  ok(page.path === "/" + page.slug && /^[a-z]+$/.test(page.slug), `${name}: its address is its slug`, page.path);
  ok(page.title.length > 10 && page.title.length <= 80 && page.description.length >= 60 && page.description.length <= 155 && page.h1 && page.about && page.loading, `${name}: it has a title, a description and the words for screen readers`);
  ok(appPageFor(page.path) === page && appPageFor(page.path + "x") === null, `${name}: it is found by its address`);
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
  ok(dialogs.length > 0 && dialogs.every((d) => dialogsFile.includes(`id="${d}"`)), `${name}: every dialog it takes is in public/studio/dialogs.txt`, dialogs.filter((d) => !dialogsFile.includes(`id="${d}"`)));
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
