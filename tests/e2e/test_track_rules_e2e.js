const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { execSync } = require("child_process");
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE);
let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
const d1 = require("./_pw.cjs").d1;
const count = (like) => Number(/"n":\s*(\d+)/.exec(d1(`SELECT COUNT(*) AS n FROM events WHERE name LIKE '${like}'`))[1]);
(async () => {
  d1("DELETE FROM events WHERE name LIKE 'QQ%'");
  d1("DELETE FROM rate_limits WHERE bucket = 'track'");
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const p = await (await b.newContext()).newPage();
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const post = (body, ua) => p.evaluate(async ([b2]) => (await fetch("/api/track", { method: "POST", body: typeof b2 === "string" ? b2 : JSON.stringify(b2) })).status, [body]);
  try {
    ok((await post({ name: "QQ track ok", path: "/random/x", detail: "d" })) === 204, "a plain event name is accepted");
    ok((await post({ name: "QQ cta:hero-1", path: "/" })) === 204, "names with spaces, colons and dashes are accepted");
    ok((await post({ name: "not_found", path: "/x", detail: "/y" })) === 400, "a visitor cannot post the server's not_found event");
    ok((await post({ name: "Search", path: "/search", detail: "{}" })) === 400, "nor search, in any capitals");
    ok((await post({ name: "QQ <script>x" })) === 400, "markup in a name is refused");
    ok((await post({ name: "QQ" + "x".repeat(70) })) === 400, "an over-long name is refused, not cut");
    ok((await post({ name: 5 })) === 400 && (await post({ name: ["QQ a"] })) === 400, "a name that is not text is refused");
    ok((await post({ name: "QQ weird path", path: "https://evil.example/x" })) === 204, "a bad path is accepted but not stored");
    ok((await post("not json")) !== 204, "a body that is not JSON is not recorded");
    await new Promise((r) => setTimeout(r, 1200));
    ok(count("QQ track ok") === 1 && count("QQ cta:hero-1") === 1, "the good events were recorded", [count("QQ track ok"), count("QQ cta:hero-1")]);
    ok(count("QQ weird path") === 1 && /"path":\s*null/.test(d1("SELECT path FROM events WHERE name = 'QQ weird path'")), "the one with a bad path has no path stored");
    ok(count("QQ%x%") === 0 && count("QQ <script>%") === 0, "the refused ones were not recorded");
    ok(Number(/"n":\s*(\d+)/.exec(d1("SELECT COUNT(*) AS n FROM events WHERE name IN ('not_found','search') AND detail = '/y'"))[1]) === 0, "and no fake not_found row got in");
    // a crawler is answered like anyone else but not counted
    const ctx = await b.newContext({ userAgent: "Googlebot/2.1 (+http://www.google.com/bot.html)" });
    const bp = await ctx.newPage();
    await bp.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    const st = await bp.evaluate(async () => (await fetch("/api/track", { method: "POST", body: JSON.stringify({ name: "QQ bot event", path: "/" }) })).status);
    await new Promise((r) => setTimeout(r, 1000));
    ok(st === 204 && count("QQ bot event") === 0, "a crawler gets 204 and is not counted", [st, count("QQ bot event")]);
    // the site's own beacons still work: the theme toggle
    const before = count("theme_toggle");
    await p.evaluate(() => window.trackEvent("theme_toggle", "dark"));
    await new Promise((r) => setTimeout(r, 1200));
    ok(count("theme_toggle") === before + 1, "the site's own theme_toggle beacon is still recorded");
    d1("DELETE FROM events WHERE name = 'theme_toggle' AND detail = 'dark' AND created_at > datetime('now','-1 minute')");
  } finally {
    d1("DELETE FROM events WHERE name LIKE 'QQ%'");
    d1("DELETE FROM rate_limits WHERE bucket = 'track'");
    await b.close();
  }
  console.log(f ? "FAILED " + f : "ALL PASS");
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
