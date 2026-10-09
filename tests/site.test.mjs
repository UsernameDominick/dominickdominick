// The starting site: the Worker serves the static files with the security headers on every answer (a missing file and a failure too), and the index page
// is a sound HTML document (language, title, one h1, viewport, a stylesheet that exists). Pure: no server.
import fs from "node:fs";
import worker from "../worker/index.js";
import { SECURITY_HEADERS } from "../worker/security-headers.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined && !c ? " " + JSON.stringify(extra) : ""}`); };

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ASSETS = { fetch: async (req) => (new URL(req.url).pathname === "/" ? new Response("<h1>hi</h1>", { headers: { "Content-Type": "text/html" } }) : new Response("Not found", { status: 404 })) };
const ask = (path, env = { ASSETS }) => worker.fetch(new Request("https://dominickdominick.com" + path), env);

// the Worker
{
  const res = await ask("/");
  ok(res.status === 200 && (await res.text()) === "<h1>hi</h1>", "the Worker answers from the static files");
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) ok(res.headers.get(name) === value, `and sends ${name}`);
  const csp = SECURITY_HEADERS["Content-Security-Policy"];
  ok(!/unsafe-eval|unsafe-inline/.test(csp) && /default-src 'self'/.test(csp) && /frame-ancestors 'self'/.test(csp), "the policy has no inline script, no eval and no framing by other sites", csp);
  const missing = await ask("/nope");
  ok(missing.status === 404 && missing.headers.get("X-Content-Type-Options") === "nosniff", "a missing address is a 404 with the headers too");
  const broken = await ask("/", { ASSETS: { fetch: async () => { throw new Error("boom"); } } });
  const text = await broken.text();
  ok(broken.status === 500 && /Something went wrong/.test(text) && !/boom/.test(text) && broken.headers.get("X-Frame-Options") === "SAMEORIGIN", "a failure is a plain 500 that says nothing about the cause, with the headers");
  const own = await worker.fetch(new Request("https://dominickdominick.com/"), { ASSETS: { fetch: async () => new Response("x", { headers: { "Content-Security-Policy": "default-src 'none'" } }) } });
  ok(own.headers.get("Content-Security-Policy") === "default-src 'none'", "a response that chose a stricter policy keeps it");
}

// the index page
{
  const html = read("public/index.html");
  ok(/^<!doctype html>/i.test(html), "the index is an HTML5 document");
  ok(/<html lang="[a-z-]+">/.test(html), "with a language");
  ok(/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html), "a viewport");
  ok(/<title>[^<]+<\/title>/.test(html) && /<meta name="description" content="[^"]+">/.test(html), "a title and a description");
  ok((html.match(/<h1[ >]/g) || []).length === 1, "exactly one h1");
  ok(!/<script/i.test(html) && !/ style="/i.test(html) && !/<style/i.test(html), "no inline script or style (the policy forbids them)");
  const sheet = /<link rel="stylesheet" href="\/([^"]+)">/.exec(html);
  ok(sheet && fs.existsSync(new URL(`../public/${sheet[1]}`, import.meta.url)), "and the stylesheet it names is there", sheet && sheet[1]);
  ok(/^User-agent: \*/m.test(read("public/robots.txt")), "robots.txt is there");
}

// the static headers file: what the asset store sends with the index page and every other file in public/ (they never reach the Worker)
{
  const text = read("public/_headers");
  // the `/*` block, read the way the platform reads it: a path line, then indented "Name: value" lines
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (/^\s/.test(raw)) {
      const m = /^\s+([A-Za-z0-9-]+)\s*:\s*(.+?)\s*$/.exec(raw);
      ok(!!m && rules.length > 0, "each indented line is a valid Name: value under a path", raw.trim());
      if (m && rules.length) rules[rules.length - 1].headers[m[1]] = m[2];
    } else rules.push({ path: raw.trim(), headers: {} });
  }
  const all = (rules.find((r) => r.path === "/*") || { headers: {} }).headers;
  ok(JSON.stringify(all) === JSON.stringify(SECURITY_HEADERS), "the /* block is exactly the Worker's list of security headers (same names, same values, same order)", { all, worker: SECURITY_HEADERS });
  const workersDev = rules.find((r) => /workers\.dev/.test(r.path));
  ok(workersDev && workersDev.headers["X-Robots-Tag"] === "noindex", "the workers.dev address is kept out of search results");
  ok(!Object.keys(all).some((k) => /cache-control|set-cookie|access-control/i.test(k)), "nothing there changes caching, cookies or cross-origin access");
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
