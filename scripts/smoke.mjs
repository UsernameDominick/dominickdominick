// Post-deploy smoke test: a handful of requests that prove the site is up and still has the shape it should.
// Used by the pipeline against every preview and right after every production deploy (a failure there rolls the deploy back).
//
//   node scripts/smoke.mjs https://dominickdominick.com
//   node scripts/smoke.mjs https://pr-12-dominickdominick.example.workers.dev --no-home    (a preview whose database has no home page yet)
const [base, ...flags] = process.argv.slice(2);
if (!base || !/^https?:\/\//.test(base)) {
  console.error("usage: node scripts/smoke.mjs <base-url> [--no-home]");
  process.exit(2);
}
const origin = base.replace(/\/+$/, "");
const expectHome = !flags.includes("--no-home");

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(name);
};
async function get(path, init = {}) {
  const res = await fetch(origin + path, { redirect: "manual", ...init });
  const text = await res.text();
  return { res, text };
}

try {
  if (expectHome) {
    const { res, text } = await get("/");
    check("home answers 200", res.status === 200, `got ${res.status}`);
    check("home has its main area", text.includes('id="main-content"'));
    check("home has a study button", text.includes('class="study-block"'));
    check("home sends a content security policy", !!res.headers.get("content-security-policy"));
    check("home stops MIME sniffing", res.headers.get("x-content-type-options") === "nosniff");
  }

  const studio = await get("/studio");
  check("studio answers 200", studio.res.status === 200, `got ${studio.res.status}`);
  check("studio has its mount", studio.text.includes('id="studio-mount"'));

  const sitemap = await get("/sitemap.xml");
  check("sitemap lists the studio", sitemap.res.status === 200 && sitemap.text.includes("/studio"), `got ${sitemap.res.status}`);

  const robots = await get("/robots.txt");
  check("robots.txt answers 200", robots.res.status === 200, `got ${robots.res.status}`);

  const missing = await get("/this-address-does-not-exist");
  check("a missing address is a 404", missing.res.status === 404, `got ${missing.res.status}`);

  // The cut-down site: these used to exist and must stay gone.
  for (const gone of ["/search", "/random", "/projects", "/trainer", "/piceditor", "/simulations", "/scans"]) {
    const r = await get(gone);
    check(`${gone} stays removed`, r.res.status === 404, `got ${r.res.status}`);
  }

  const admin = await get("/admin/");
  check("admin page answers 200", admin.res.status === 200, `got ${admin.res.status}`);

  const api = await get("/api/admin/pages");
  check("admin API refuses a visitor", api.res.status === 401, `got ${api.res.status}`);
  const me = await get("/api/admin/me");
  check("admin API says a visitor is signed out", me.res.status === 200 && me.text.includes('"authenticated":false'), `got ${me.res.status} ${me.text.slice(0, 60)}`);

  // The study unlock must refuse a request with no password (a missing block is also fine: it is a 404, not a crash).
  const unlock = await get("/api/study/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ block: 0 }),
  });
  check("study unlock refuses without a password", [400, 401, 404].includes(unlock.res.status), `got ${unlock.res.status}`);
} catch (err) {
  check("site reachable", false, err && err.message);
}

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed against ${origin}`);
  process.exit(1);
}
console.log(`\nall smoke checks passed against ${origin}`);
