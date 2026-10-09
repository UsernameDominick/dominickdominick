const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const BASE = (E2E_BASE);
let failures = 0;

function check(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
}

async function main() {
  const home = await fetch(`${BASE}/`);
  const homeText = await home.text();
  check("homepage 200", home.status === 200);
  check("homepage has <title>", /<title>/.test(homeText));
  check("homepage has meta description", /<meta name="description"/.test(homeText));
  check("homepage has canonical link", /<link rel="canonical"/.test(homeText));
  check("homepage has og:title", /<meta property="og:title"/.test(homeText));
  check("homepage has JSON-LD", /application\/ld\+json/.test(homeText));

  const notFound = await fetch(`${BASE}/this-page-does-not-exist-xyz`);
  const notFoundText = await notFound.text();
  check("404 status", notFound.status === 404);
  check("404 has noindex robots meta", /<meta name="robots" content="noindex/.test(notFoundText));

  const robots = await fetch(`${BASE}/robots.txt`);
  check("robots.txt 200", robots.status === 200);
  const sitemap = await fetch(`${BASE}/sitemap.xml`);
  check("sitemap.xml 200", sitemap.status === 200);
  const rss = await fetch(`${BASE}/rss.xml`);
  check("rss.xml is gone", rss.status === 404);

  check("homepage has no javascript: URIs", !/href=["']javascript:/i.test(homeText));

  const unauthChecks = [
    ["GET", "/api/admin/pages"],
    ["POST", "/api/admin/upload-audio"],
    ["POST", "/api/admin/upload-video"],
    ["POST", "/api/admin/upload-font"],
    ["GET", "/api/admin/analytics/export-raw"],
    ["GET", "/api/admin/storage-usage"],
    ["GET", "/api/admin/accessibility-report"],
    ["PUT", "/api/admin/pages/1/password"],
    ["GET", "/api/admin/notifications-summary"],
    ["GET", "/api/admin/link-check-status"],
    ["GET", "/api/admin/songs"],
    ["POST", "/api/admin/client-error"],
  ];
  for (const [method, path] of unauthChecks) {
    const res = await fetch(`${BASE}${path}`, { method });
    check(`unauthenticated ${method} ${path} is 401`, res.status === 401);
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
