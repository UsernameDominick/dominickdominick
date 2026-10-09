// Small public-site hygiene rules: one address per page, and a real page when a visitor is told to slow down (robots.txt is checked in the browser tests).
import worker from "../worker/index.js";
import { renderErrorPageHtml } from "../worker/render.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const deadEnv = { DB: { prepare() { throw new Error("no database in this test"); } }, ASSETS: { fetch: async () => new Response("asset") } };
const ctx = { waitUntil() {} };

// the error page
{
  const html = renderErrorPageHtml("abcd1234");
  ok(/<html lang="en">/.test(html) && /<h1>Something went wrong<\/h1>/.test(html) && /<main/.test(html), "it is a real page: language, heading, main area");
  ok(/<meta name="robots" content="noindex">/.test(html) && !/<script/i.test(html) && !/<link[^>]+style\.css/.test(html), "noindex, no scripts, no stylesheet to depend on");
  ok(/prefers-color-scheme: light/.test(html) && /Reference: <code>abcd1234<\/code>/.test(html), "it follows a light-theme system setting and keeps its reference");
  ok(/href="\/studio"/.test(html), "it links back to the Studio");
}

// one address per page
{
  for (const [from, to] of [["https://dominickdominick.com//studio", "https://dominickdominick.com/studio"], ["https://dominickdominick.com/studio//x", "https://dominickdominick.com/studio/x"], ["https://dominickdominick.com///projects?x=1", "https://dominickdominick.com/projects?x=1"]]) {
    const res = await worker.fetch(new Request(from), deadEnv, ctx);
    ok(res.status === 301 && res.headers.get("Location") === to, `${from.replace("https://dominickdominick.com", "")} goes to one address`, { status: res.status, to: res.headers.get("Location") });
  }
  const post = await worker.fetch(new Request("https://dominickdominick.com//studio", { method: "POST", body: "x" }), deadEnv, ctx);
  ok(post.status !== 301, "a form post is not redirected");
  const api = await worker.fetch(new Request("https://dominickdominick.com/api//study/unlock"), deadEnv, ctx);
  ok(api.status !== 301, "the API is left alone");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
