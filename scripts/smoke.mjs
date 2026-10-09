// Post-deploy smoke test: a handful of requests that prove the site is up and still has the shape it should.
// Used by the pipeline against every preview and right after every production deploy, and by the six-hourly monitor.
//
//   node scripts/smoke.mjs https://dominickdominick.com
//
// Cloudflare's bot protection answers requests from data centres (GitHub's runners) with a challenge page ("Just a moment...", status
// 403 and a cf-mitigated header). A challenged request proves the edge is up but says nothing about the site, so it is reported as
// "skipped", never as a failure; a real failure (a 5xx, a wrong page, a missing header) still fails. To get the full check from CI, add a
// Cloudflare WAF custom rule that skips bot protection when the request header X-Smoke-Key equals a secret, and store the same secret as
// the repository secret SMOKE_KEY: this script sends it when the environment variable SMOKE_KEY is set.
const [base] = process.argv.slice(2);
if (!base || !/^https?:\/\//.test(base)) {
  console.error("usage: node scripts/smoke.mjs <base-url>");
  process.exit(2);
}
const origin = base.replace(/\/+$/, "");
const extraHeaders = process.env.SMOKE_KEY ? { "X-Smoke-Key": process.env.SMOKE_KEY } : {};

const failures = [];
let skipped = 0;
let judged = 0;

async function get(path, init = {}) {
  const res = await fetch(origin + path, { redirect: "manual", ...init, headers: { ...extraHeaders, ...(init.headers || {}) } });
  const text = await res.text();
  const challenged = res.status === 403 && (res.headers.get("cf-mitigated") === "challenge" || /<title>Just a moment/i.test(text));
  return { res, text, challenged };
}

// Judges one response: a challenged one is skipped, anything else must satisfy the predicate.
function expect(name, r, ok, detail = "") {
  if (r.challenged) {
    skipped++;
    console.log(`skip ${name} (Cloudflare challenged this request)`);
    return;
  }
  judged++;
  const pass = typeof ok === "function" ? ok(r) : ok;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : detail ? ` (${typeof detail === "function" ? detail(r) : detail})` : ""}`);
  if (!pass) failures.push(name);
}
const status = (r) => `got ${r.res.status}`;

try {
  const index = await get("/");
  expect("the index answers 200", index, (r) => r.res.status === 200, status);
  expect("the index is a page with a title and a heading", index, (r) => /<title>[^<]+<\/title>/i.test(r.text) && /<h1[ >]/i.test(r.text));
  expect("the index sends a content security policy", index, (r) => !!r.res.headers.get("content-security-policy"));
  expect("the index stops MIME sniffing", index, (r) => r.res.headers.get("x-content-type-options") === "nosniff");
  expect("the index cannot be framed by another site", index, (r) => r.res.headers.get("x-frame-options") === "SAMEORIGIN");

  const robots = await get("/robots.txt");
  expect("robots.txt answers 200", robots, (r) => r.res.status === 200, status);

  const missing = await get("/this-address-does-not-exist");
  expect("a missing address is a 404", missing, (r) => r.res.status === 404, status);

  // The admin panel was removed for good: its addresses are just missing.
  expect("the admin address stays gone", await get("/admin"), (r) => r.res.status === 404, status);
  expect("the admin API stays gone", await get("/api/admin/pages"), (r) => r.res.status === 404, status);
} catch (err) {
  console.log(`FAIL site reachable (${err && err.message})`);
  failures.push("site reachable");
}

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed against ${origin}`);
  process.exit(1);
}
if (skipped && !judged) {
  // Everything was challenged: the edge answered, but nothing about the site could be checked from here.
  console.log(`::warning title=Smoke test inconclusive::Cloudflare challenged every request to ${origin}, so the site could not be checked from here. Add the SMOKE_KEY rule described in scripts/smoke.mjs to get a full check.`);
  console.log(`\nINCONCLUSIVE: all ${skipped} checks were challenged by Cloudflare (${origin} is answering, nothing more is known)`);
  process.exit(0);
}
console.log(`\nall judged smoke checks passed against ${origin}${skipped ? ` (${skipped} skipped: challenged by Cloudflare)` : ""}`);
