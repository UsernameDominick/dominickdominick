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

// the static headers file
{
  const text = read("public/_headers");
  ok(/X-Content-Type-Options: nosniff/.test(text) && /X-Frame-Options: SAMEORIGIN/.test(text) && /Strict-Transport-Security: max-age=\d{7,}/.test(text), "public/_headers carries the same basics for files the asset store sends by itself");
  ok(!/Content-Security-Policy/i.test(text), "and leaves the policy to the Worker");
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
