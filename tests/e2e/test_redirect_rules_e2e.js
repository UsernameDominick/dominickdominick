const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { execSync } = require("child_process");
const { request } = require("./_pw.cjs");
const BASE = (E2E_BASE);
let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
const d1 = require("./_pw.cjs").d1;
(async () => {
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const anon = await request.newContext({ maxRedirects: 0 });
  const post = (data) => c.post(BASE + "/api/admin/redirects", { data });
  const made = [];
  try {
    let r = await post({ from_path: "/qq-r-200", to_path: "/", status_code: 200 });
    ok(r.status() === 400 && /301, 302, 307, 308/.test((await r.json()).error), "a 200 is turned away", r.status());
    r = await post({ from_path: "/qq-r-js", to_path: "javascript:alert(1)", status_code: 301 });
    ok(r.status() === 400, "a javascript: destination is turned away", r.status());
    r = await post({ from_path: "/qq-r-proto", to_path: "//evil.example/x" });
    ok(r.status() === 400, "a protocol-relative destination is turned away", r.status());
    r = await post({ from_path: "/qq-r-ok", to_path: "qq-target", status_code: 307 });
    const body = await r.json();
    ok(r.status() === 200 && body.id, "a 307 to a bare word is accepted", body);
    made.push(body.id);
    const list = await (await c.get(BASE + "/api/admin/redirects")).json();
    const row = list.find((x) => x.id === body.id);
    ok(row && row.status_code === 307 && row.to_path === "/qq-target", "stored as 307 to /qq-target", row);
    const hit = await anon.get(BASE + "/qq-r-ok");
    ok(hit.status() === 307 && /\/qq-target$/.test(hit.headers().location), "visiting it redirects with 307", [hit.status(), hit.headers().location]);
    r = await c.patch(BASE + "/api/admin/redirects/" + body.id, { data: { status_code: 404 } });
    ok(r.status() === 400, "editing to a 404 is turned away", r.status());
    r = await c.patch(BASE + "/api/admin/redirects/" + body.id, { data: { to_path: "data:text/html,x" } });
    ok(r.status() === 400, "editing to a data: destination is turned away", r.status());
    r = await c.patch(BASE + "/api/admin/redirects/" + body.id, { data: { status_code: 302 } });
    ok(r.status() === 200, "editing to a 302 works", r.status());
    // An old row with a code that is not a redirect must not break the visit.
    d1("INSERT INTO redirects (from_path, to_path, status_code) VALUES ('/qq-r-legacy', '/qq-target', 200)");
    const legacy = await anon.get(BASE + "/qq-r-legacy");
    ok(legacy.status() === 301, "a legacy row with code 200 still redirects (as 301)", legacy.status());
  } finally {
    for (const id of made) await c.delete(BASE + "/api/admin/redirects/" + id);
    d1("DELETE FROM redirects WHERE from_path LIKE '/qq-r-%'");
  }
  console.log(f ? "FAILED " + f : "ALL PASS");
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
