// Post-deploy smoke test: a handful of requests that prove the site is up and still has the shape it should.
// Used by the pipeline against every preview and right after every production deploy, and by the six-hourly monitor.
//
//   node scripts/smoke.mjs https://dominickdominick.com
//   node scripts/smoke.mjs https://pr-12-dominickdominick.example.workers.dev --no-home    (a preview whose database has no home page yet)
//
// Cloudflare's bot protection answers requests from data centres (GitHub's runners) with a challenge page ("Just a moment...", status
// 403 and a cf-mitigated header). A challenged request proves the edge is up but says nothing about the site, so it is reported as
// "skipped", never as a failure; a real failure (a 5xx, a wrong page, a missing header) still fails. To get the full check from CI, add a
// Cloudflare WAF custom rule that skips bot protection when the request header X-Smoke-Key equals a secret, and store the same secret as
// the repository secret SMOKE_KEY: this script sends it when the environment variable SMOKE_KEY is set.
const [base, ...flags] = process.argv.slice(2);
if (!base || !/^https?:\/\//.test(base)) {
  console.error("usage: node scripts/smoke.mjs <base-url> [--no-home]");
  process.exit(2);
}
const origin = base.replace(/\/+$/, "");
const expectHome = !flags.includes("--no-home");
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
  if (expectHome) {
    const home = await get("/");
    expect("home answers 200", home, (r) => r.res.status === 200, status);
    expect("home has its main area", home, (r) => r.text.includes('id="main-content"'));
    expect("home has a study button", home, (r) => r.text.includes('class="study-block"'));
    expect("home sends a content security policy", home, (r) => !!r.res.headers.get("content-security-policy"));
    expect("home stops MIME sniffing", home, (r) => r.res.headers.get("x-content-type-options") === "nosniff");
  }

  const studio = await get("/studio");
  expect("studio answers 200", studio, (r) => r.res.status === 200, status);
  expect("studio has its mount", studio, (r) => r.text.includes('id="studio-mount"'));

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

  expect("admin page answers 200", await get("/admin/"), (r) => r.res.status === 200, status);
  expect("admin API refuses a visitor", await get("/api/admin/pages"), (r) => r.res.status === 401, status);
  expect("admin API says a visitor is signed out", await get("/api/admin/me"), (r) => r.res.status === 200 && r.text.includes('"authenticated":false'), (r) => `got ${r.res.status} ${r.text.slice(0, 60)}`);

  // The study unlock must refuse a request with no password (a missing block is also fine: it is a 404, not a crash).
  const unlock = await get("/api/study/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ block: 0 }) });
  expect("study unlock refuses without a password", unlock, (r) => [400, 401, 404].includes(r.res.status), status);
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
