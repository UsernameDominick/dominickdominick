// A failure on a public address: a branded 500 page that works without the database, shows a reference, leaks nothing, and the same
// reference leads the logged entry. Calls the Worker's real fetch with an environment whose static files fail (the only thing a public page now needs).
import worker from "../worker/index.js";
import { renderErrorPageHtml } from "../worker/render.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const logged = [];
const brokenEnv = () => ({
  DB: {
    prepare(sql) {
      // the error log's own write is the one thing that is allowed to be recorded; every other query fails like a dead database
      const stmt = (args) => ({
        bind: (...a) => stmt(a),
        async run() { if (/INSERT INTO error_log/i.test(sql)) { logged.push({ message: args[0], stack: args[1], path: args[2] }); return { meta: {} }; } throw new Error("D1_ERROR: database is unavailable at secret-host.internal"); },
        async all() { throw new Error("D1_ERROR: database is unavailable at secret-host.internal"); },
        async first() { throw new Error("D1_ERROR: database is unavailable at secret-host.internal"); },
      });
      return stmt(null);
    },
  },
  ASSETS: { fetch: async () => { throw new Error("D1_ERROR: database is unavailable at secret-host.internal"); } },
});
const ctx = () => { const p = []; return { waitUntil: (x) => p.push(x), done: () => Promise.all(p) }; };

// the page itself
{
  const html = renderErrorPageHtml("ab12cd34");
  ok(/Reference: <code>ab12cd34<\/code>/.test(html), "the page shows the reference");
  ok(!/Reference/.test(renderErrorPageHtml()) && !/Reference/.test(renderErrorPageHtml("<script>alert(1)</script>")) && !/<script>alert/.test(renderErrorPageHtml('"><img src=x onerror=alert(1)>')), "no reference means no reference line, and a reference with odd characters is never printed");
  ok(/<meta name="robots" content="noindex">/.test(html) && !/<link[^>]+href="\/style\.css/.test(html) && !/<script/i.test(html), "it is noindex, styled inline, and needs no scripts or stylesheets (the site may be what broke)");
}

// the Worker's real fetch
{
  const c = ctx();
  const res = await worker.fetch(new Request("https://dominickdominick.com/some-page.css"), brokenEnv(), c);
  await c.done();
  const body = await res.text();
  ok(res.status === 500 && /text\/html/.test(res.headers.get("Content-Type")), "a failing page answers 500 with an HTML page", res.status);
  const ref = (/Reference: <code>([a-z0-9]{8})<\/code>/.exec(body) || [])[1];
  ok(!!ref, "the page carries an 8-character reference", ref);
  ok(!/secret-host|D1_ERROR|database is unavailable|at .*\.js|worker\/|node_modules/.test(body), "no error text, host name or stack trace reaches the reader");
  ok(logged.length === 1 && logged[0].message.startsWith(`[${ref}] `) && /database is unavailable/.test(logged[0].message) && logged[0].path === "/some-page.css", "the logged entry starts with that same reference and holds the real error", logged[0] && logged[0].message.slice(0, 40));
  ok(res.headers.get("X-Content-Type-Options") === "nosniff" || res.headers.has("Content-Security-Policy") || res.headers.has("X-Frame-Options"), "security headers are still on the error page");
}
// each failure gets its own reference
{
  const refs = new Set();
  for (let i = 0; i < 5; i++) {
    const c = ctx();
    const res = await worker.fetch(new Request(`https://dominickdominick.com/p${i}.css`), brokenEnv(), c);
    await c.done();
    refs.add((/Reference: <code>([a-z0-9]{8})<\/code>/.exec(await res.text()) || [])[1]);
  }
  ok(refs.size === 5, "five failures, five different references", [...refs]);
}
// API paths keep a plain-text answer a client can read, with the reference
{
  const c = ctx();
  const res = await worker.fetch(new Request("https://dominickdominick.com/api/study/unlock", { method: "POST", body: "{}" }), brokenEnv(), c);
  await c.done();
  const text = await res.text();
  ok(res.status === 500 && /text\/plain/.test(res.headers.get("Content-Type")) && /\(Reference: [a-z0-9]{8}\)$/.test(text) && !/secret-host/.test(text), "an API failure is plain text with the reference, and no internals", text);
}
// the log write itself failing must not break the error page
{
  const env = brokenEnv();
  env.DB.prepare = () => { throw new Error("even prepare throws"); };
  const c = ctx();
  const res = await worker.fetch(new Request("https://dominickdominick.com/x.css"), env, c);
  await c.done();
  ok(res.status === 500 && /Something went wrong/.test(await res.text()), "even when the error log can't be written, the reader still gets the page");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
