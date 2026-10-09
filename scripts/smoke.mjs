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
  // There is no home page: the front door sends a visitor to the Studio.
  const front = await get("/");
  expect("the front door sends a visitor to the Studio", front, (r) => r.res.status === 302 && (r.res.headers.get("location") || "").endsWith("/studio"), (r) => "got " + r.res.status + " to " + r.res.headers.get("location"));

  const studio = await get("/studio");
  expect("studio answers 200", studio, (r) => r.res.status === 200, status);
  expect("studio has its mount", studio, (r) => r.text.includes('id="studio-mount"'));
  expect("studio has the search stop and its dialog", studio, (r) => r.text.includes('id="finder-open"') && r.text.includes('id="finder-q"'));
  expect("studio sends a content security policy", studio, (r) => !!r.res.headers.get("content-security-policy"));
  expect("studio stops MIME sniffing", studio, (r) => r.res.headers.get("x-content-type-options") === "nosniff");

  const sitemap = await get("/sitemap.xml");
  expect("sitemap lists the studio", sitemap, (r) => r.res.status === 200 && r.text.includes("/studio"), status);

  const robots = await get("/robots.txt");
  expect("robots.txt answers 200", robots, (r) => r.res.status === 200, status);

  const missing = await get("/this-address-does-not-exist");
  expect("a missing address is a 404", missing, (r) => r.res.status === 404, status);

  // The cut-down site: these used to exist and must stay gone.
  for (const gone of ["/search", "/random", "/projects", "/trainer", "/piceditor", "/simulations", "/scans"]) {
    expect(`${gone} stays removed`, await get(gone), (r) => r.res.status === 404, status);
  }

  // The admin panel is gone: its addresses are just the 404 page.
  expect("the admin address is gone", await get("/admin"), (r) => r.res.status === 404, status);
  expect("the admin API is gone", await get("/api/admin/pages"), (r) => r.res.status === 404, status);

  // The study unlock must refuse a request with no password, for a lab asked for by name (the search dialog) and for a block that is not there.
  const post = (body) => get("/api/study/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  expect("study unlock refuses a lab without its password", await post({ lab: "core1-lab" }), (r) => r.res.status === 401 && r.text.includes("needsPassword"), status);
  expect("study unlock refuses a block that is not there", await post({ block: 0 }), (r) => [400, 401, 404].includes(r.res.status), status);
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
