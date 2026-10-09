// public/_headers: the headers that go on files sent straight from the asset store (the admin page, scripts, the stylesheet).
import fs from "node:fs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const text = fs.readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
// Parse the way the platform reads it: a path line, then indented "Name: value" lines.
const rules = [];
for (const raw of text.split(/\r?\n/)) {
  if (!raw.trim() || raw.trim().startsWith("#")) continue;
  if (/^\s/.test(raw)) {
    const m = /^\s+([A-Za-z0-9-]+)\s*:\s*(.+?)\s*$/.exec(raw);
    ok(!!m && rules.length > 0, `indented line is a valid "Name: value" under a path`, raw.trim());
    if (m && rules.length) rules[rules.length - 1].headers[m[1].toLowerCase()] = m[2];
  } else {
    rules.push({ path: raw.trim(), headers: {} });
  }
}
const byPath = Object.fromEntries(rules.map((r) => [r.path, r.headers]));
ok(rules.length === 4 && rules.every((r) => /^(\/|https:\/\/)/.test(r.path)), "four rules, each starting at a path or https:// host", rules.map((r) => r.path));
ok(/immutable/.test(byPath["/fonts/*"]["cache-control"] || "") && /max-age=31536000/.test(byPath["/fonts/*"]["cache-control"] || ""), "the pixel fonts are cached for a year");
ok(byPath["https://dominickdominick.:subdomain.workers.dev/*"]["x-robots-tag"] === "noindex", "the workers.dev address is still kept out of search results");
const all = byPath["/*"];
ok(all && all["x-content-type-options"] === "nosniff", "every static file: no MIME sniffing");
ok(all["x-frame-options"] === "SAMEORIGIN", "every static file: not framed by other sites");
ok(all["referrer-policy"] === "strict-origin-when-cross-origin", "every static file: referrer trimmed (same as the Worker's pages)");
ok(/max-age=\d{7,}/.test(all["strict-transport-security"]), "every static file: https only");
ok(!("content-security-policy" in all) && !("content-security-policy" in (byPath["/admin/*"] || {})), "no page-wide CSP here (the admin relies on inline scripts; the Worker sets the site's CSP on rendered pages)");
ok(/noindex/.test(byPath["/admin/*"]["x-robots-tag"]) && /nofollow/.test(byPath["/admin/*"]["x-robots-tag"]), "the admin shell is noindex, nofollow");
ok(!Object.keys(all).some((k) => /cache-control|set-cookie|access-control/.test(k)), "nothing here changes caching, cookies or cross-origin access");
ok(text.length < 2000, "the file is well under the platform's size limit", text.length);
const worker = fs.readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
for (const k of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Strict-Transport-Security"]) ok(worker.includes(`"${k}"`) && all[k.toLowerCase()] !== undefined, `${k} is set on both Worker pages and static files`);

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
