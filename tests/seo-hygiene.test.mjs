// Small public-site hygiene rules: one address per page, and a real page when a visitor is told to slow down (robots.txt is checked in the browser tests).
import worker from "../worker/index.js";
import { renderSlowDownHtml, renderErrorPageHtml } from "../worker/render.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const deadEnv = { DB: { prepare() { throw new Error("no database in this test"); } }, MEDIA: {}, ASSETS: { fetch: async () => new Response("asset") } };
const ctx = { waitUntil() {} };

// the slow-down page
{
  const html = renderSlowDownHtml("That's a lot of searches in a short time.", 1);
  ok(/<html lang="en">/.test(html) && /<title>Slow down a moment · Dominick<\/title>/.test(html) && /<h1>Slow down a moment<\/h1>/.test(html) && /<main/.test(html), "it is a real page: language, title, heading and a main landmark");
  ok(/about 1 minute\./.test(html) && /about 15 minutes\./.test(renderSlowDownHtml("x", 15)) && /about 1 minute\./.test(renderSlowDownHtml("x", 0)), "it says how long to wait, in the right plural");
  ok(/<meta name="robots" content="noindex">/.test(html) && !/<script/i.test(html) && !/<link[^>]+style\.css/.test(html), "noindex, no scripts, no stylesheet to depend on");
  ok(/prefers-color-scheme: light/.test(html), "it follows a light-theme system setting");
  ok(/href="\/"/.test(html), "it links back home");
  ok(/prefers-color-scheme: light/.test(renderErrorPageHtml("abcd1234")) && /Reference: <code>abcd1234<\/code>/.test(renderErrorPageHtml("abcd1234")), "the error page shares the look and keeps its reference");
}

// one address per page
{
  for (const [from, to] of [["https://dominickdominick.com//random", "https://dominickdominick.com/random"], ["https://dominickdominick.com/random//a-post", "https://dominickdominick.com/random/a-post"], ["https://dominickdominick.com///projects?x=1", "https://dominickdominick.com/projects?x=1"]]) {
    const res = await worker.fetch(new Request(from), deadEnv, ctx);
    ok(res.status === 301 && res.headers.get("Location") === to, `${from.replace("https://dominickdominick.com", "")} goes to one address`, { status: res.status, to: res.headers.get("Location") });
  }
  const post = await worker.fetch(new Request("https://dominickdominick.com//random", { method: "POST", body: "x" }), deadEnv, ctx);
  ok(post.status !== 301, "a form post is not redirected");
  const api = await worker.fetch(new Request("https://dominickdominick.com/api//track"), deadEnv, ctx);
  ok(api.status !== 301, "the API is left alone");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
