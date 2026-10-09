// The Studio builds its page from public/studio/dialogs.txt and then its scripts look elements up by id. An id that a script asks for but
// that is in neither the dialogs nor created by a script breaks the Studio at run time with no server error, so every id a script looks up
// by name must exist somewhere: in the dialogs file, or made by a script (an id="…" in a template, .id = "…", id: "…", setAttribute).
import fs from "node:fs";
import path from "node:path";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined && !c ? " " + JSON.stringify(extra) : ""}`); };

const dialogs = fs.readFileSync("public/studio/dialogs.txt", "utf8");
const scripts = ["public/studio.js", "public/app-kit.js", "public/dial.js", ...fs.readdirSync("public/studio").filter((f) => f.endsWith(".js")).map((f) => "public/studio/" + f)];

const defined = new Set();
const defPrefixes = new Set();
const addDefined = (text) => {
  for (const m of text.matchAll(/\bid="([A-Za-z0-9_-]+)(\$\{[^"]*)?"/g)) {
    defined.add(m[1]);
    if (m[2]) defPrefixes.add(m[1]);
  }
  for (const m of text.matchAll(/\bid='([A-Za-z0-9_-]+)'/g)) defined.add(m[1]);
  for (const m of text.matchAll(/\.id\s*=\s*["'`]([A-Za-z0-9_-]+)(\$\{[^"'`]*)?["'`]/g)) {
    defined.add(m[1]);
    if (m[2]) defPrefixes.add(m[1]);
  }
  for (const m of text.matchAll(/\bid:\s*["'`]([A-Za-z0-9_-]+)(\$\{[^"'`]*)?["'`]/g)) {
    defined.add(m[1]);
    if (m[2]) defPrefixes.add(m[1]);
  }
  for (const m of text.matchAll(/setAttribute\(\s*["']id["']\s*,\s*["'`]([A-Za-z0-9_-]+)/g)) defined.add(m[1]);
};
addDefined(dialogs);
const sources = {};
for (const f of scripts) {
  sources[f] = fs.readFileSync(f, "utf8");
  addDefined(sources[f]);
}

const wanted = new Map(); // id -> first file
for (const [f, text] of Object.entries(sources)) {
  const find = (re) => { for (const m of text.matchAll(re)) if (!wanted.has(m[1])) wanted.set(m[1], f); };
  find(/getElementById\(\s*["']([A-Za-z0-9_-]+)["']\s*\)/g);
  find(/\$\(\s*["']([A-Za-z0-9_-]+)["']\s*\)/g);
  find(/querySelector(?:All)?\(\s*["']#([A-Za-z0-9_-]+)/g);
}

const isDefined = (id) => defined.has(id) || [...defPrefixes].some((p) => id.startsWith(p));
const missing = [...wanted].filter(([id]) => !isDefined(id)).map(([id, f]) => `${id} (asked for in ${f})`);
ok(wanted.size > 100, `the scripts look up a good number of ids (${wanted.size}), so the check is reading them`);
ok(missing.length === 0, "every id a Studio script looks up exists in the dialogs or is made by a script", missing);
for (const id of ["song-builder-modal", "songs-modal", "song-audio-modal"]) ok(dialogs.includes(`id="${id}"`), `${id} is in the dialogs file`);
ok(!fs.readFileSync("public/app-kit.js", "utf8").includes("/admin/"), "the app kit does not fetch anything from /admin/");
ok(!Object.values(sources).some((t) => /fetch\(\s*["'`]\/admin\//.test(t)), "no Studio script fetches anything from /admin/");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
