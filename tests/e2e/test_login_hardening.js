const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const http = require("http");
const fs = require("fs");
const { execSync } = require("child_process");
const { chromium, request } = require("./_pw.cjs");
const BASE = (E2E_BASE);
let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
const REPO = require("path").resolve(__dirname, "../..");
const pw = /^ADMIN_PASSWORD=(.*)$/m.exec(fs.readFileSync(REPO + "/.dev.vars", "utf8"))[1].trim().replace(/^["']|["']$/g, "");
const d1 = require("./_pw.cjs").d1;
const attempts = () => Number(/"n":\s*(\d+)/.exec(d1("SELECT COUNT(*) AS n FROM login_attempts"))[1]);
(async () => {
  d1("DELETE FROM login_attempts");
  const hits = [];
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { hits.push(JSON.parse(b || "{}")); res.end("ok"); }); });
  await new Promise((r) => srv.listen(8798, r));
  const admin = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const settings = await (await admin.fetch(BASE + "/api/admin/settings")).json();
  const anon = await request.newContext();
  const login = (p) => anon.post(BASE + "/api/admin/login", { data: { password: p } });
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    // --- the page ---
    const ctx = await b.newContext({ viewport: { width: 1000, height: 800 } });
    const p = await ctx.newPage();
    await p.goto(BASE + "/admin/", { waitUntil: "domcontentloaded" });
    await p.waitForSelector("#login-form", { state: "visible" });
    ok((await p.getAttribute("#login-error", "role")) === "alert", "the error paragraph is a live alert");
    ok(!(await p.locator("#login-error").isVisible()), "nothing is shown before an error");
    ok((await p.getAttribute("#password", "aria-label")) === "Password" && (await p.getAttribute("#password", "aria-describedby")) === "login-error", "the password field has a name and points at the error");
    await p.fill("#password", "not-the-password");
    await p.click("#login-form button[type=submit]");
    await p.waitForFunction(() => document.getElementById("login-error").textContent.length > 0);
    ok((await p.textContent("#login-error")) === "Wrong password.", "a wrong password says so", await p.textContent("#login-error"));
    ok((await p.getAttribute("#password", "aria-invalid")) === "true", "and the field is marked invalid");
    ok(await p.locator("#login-error").isVisible(), "the message is visible");
    ok(attempts() === 1, "the wrong password was counted", attempts());

    // --- successful logins are never counted ---
    d1("DELETE FROM login_attempts");
    let statuses = [];
    for (let i = 0; i < 10; i++) statuses.push((await login(pw)).status());
    ok(statuses.every((s) => s === 200), "ten correct logins in a row all work", statuses);
    ok(attempts() === 0, "none of them counted", attempts());

    // --- lockout message and alert ---
    await admin.fetch(BASE + "/api/admin/settings", { method: "PUT", data: { ...settings, webhook_url: "http://127.0.0.1:8798/hook", webhook_on_login_failures: "1" } });
    for (let i = 1; i <= 8; i++) {
      const r = await login("wrong-" + i);
      if (r.status() !== 401) ok(false, `wrong password ${i} is a 401`, r.status());
      if (i === 4) { await new Promise((r) => setTimeout(r, 800)); ok(hits.length === 0, "no alert before the fifth", hits.length); }
      if (i === 5) { await new Promise((r) => setTimeout(r, 1200)); ok(hits.length === 1, "an alert on the fifth", hits.length); }
    }
    await new Promise((r) => setTimeout(r, 800));
    ok(hits.length === 1, "and only one for the whole run", hits.length);
    ok(hits[0] && hits[0].event === "login_failures" && hits[0].count === 5 && !/\d+\.\d+\.\d+\.\d+/.test(JSON.stringify(hits[0])), "the alert says what happened and nothing about who", hits[0]);
    const locked = await login(pw);
    const body = await locked.json();
    ok(locked.status() === 429, "the ninth try is refused", locked.status());
    ok(/^Too many wrong passwords\. Try again in about \d+ minutes?\.$/.test(body.error), "with a message that says how long", body.error);
    const ra = Number(locked.headers()["retry-after"]);
    ok(ra > 0 && ra <= 900, "and a Retry-After header", ra);
    // The page shows the same words.
    await p.fill("#password", "x");
    await p.click("#login-form button[type=submit]");
    await p.waitForFunction(() => /Too many/.test(document.getElementById("login-error").textContent));
    ok(/Too many wrong passwords/.test(await p.textContent("#login-error")), "the page shows the lockout message");
    ok(attempts() === 8, "the refused tries were not counted on top", attempts());
  } finally {
    d1("DELETE FROM login_attempts");
    await admin.fetch(BASE + "/api/admin/settings", { method: "PUT", data: settings });
    srv.close();
    await b.close();
  }
  console.log(f ? "FAILED " + f : "ALL PASS");
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
