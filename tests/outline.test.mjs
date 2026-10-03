// The read-only outline viewer's GitHub side: config checks, what is requested, and how failures are reported (worker/outline.js, fetch stubbed).
import fs from "node:fs";
import { outlineConfig, readOutline, friendlyError } from "../worker/outline.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

// ---- config ----
let c = outlineConfig({});
ok(c.configured && !c.hasToken && c.repo === "UsernameDominick/dominickdominick" && c.path === "outline.md" && c.branch === "production" && c.apiBase === "https://api.github.com", "defaults: works with no token at all (a public repo needs none)", c);
c = outlineConfig({ GITHUB_TOKEN: "tok_secret_123" });
ok(c.configured && c.hasToken, "with a token it is used");
ok(!outlineConfig({ GITHUB_TOKEN: "   " }).hasToken, "a blank token counts as none");
for (const [k, v, why] of [
  ["GITHUB_REPO", "nope", "a repo without owner/name"],
  ["GITHUB_REPO", "a/b/c", "a repo with extra segments"],
  ["GITHUB_REPO", "../x/y", "a repo with .."],
  ["OUTLINE_PATH", "../secret.md", "a path that climbs out"],
  ["OUTLINE_PATH", "docs//x.md", "a path with an empty segment"],
  ["OUTLINE_PATH", "notes.txt", "a non-markdown file"],
  ["OUTLINE_PATH", "/abs.md", "an absolute path"],
  ["OUTLINE_BRANCH", "a..b", "a branch with .."],
  ["OUTLINE_BRANCH", "has space", "a branch with a space"],
  ["GITHUB_API_BASE", "ftp://x", "a non-http API base"],
]) ok(!outlineConfig({ [k]: v }).valid && !outlineConfig({ [k]: v }).configured, `${k}=${v}: rejected (${why})`);
ok(outlineConfig({ OUTLINE_PATH: "docs/outline.md", OUTLINE_BRANCH: "feature/x-1", GITHUB_REPO: "o/r.js" }).configured, "a nested path, a slashed branch and a dotted repo are fine");
ok(outlineConfig({ GITHUB_API_BASE: "http://127.0.0.1:9/" }).apiBase === "http://127.0.0.1:9", "a trailing slash on the API base is dropped");

// ---- fetch stub ----
const calls = [];
let script = [];
globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); const next = script.shift(); if (next instanceof Error) throw next; return next; };
const resp = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const b64 = (t) => Buffer.from(t, "utf8").toString("base64");
const SHA1 = "a".repeat(40);

script = [resp(200, { type: "file", sha: SHA1, size: 10, encoding: "base64", content: b64("héllo ✓\nline2\n").replace(/(.{20})/g, "$1\n") })];
let r = await readOutline({ GITHUB_TOKEN: "tok_secret_123" });
ok(r.ok && r.text === "héllo ✓\nline2\n", "read: base64 with line breaks and non-ASCII decodes exactly", r);
ok(calls[0].url === "https://api.github.com/repos/UsernameDominick/dominickdominick/contents/outline.md?ref=production", "read: URL is repo + path + branch", calls[0].url);
ok(calls[0].init.method === undefined || calls[0].init.method === "GET", "read: it is a GET");
ok(calls[0].init.headers.Authorization === "Bearer tok_secret_123" && calls[0].init.headers["User-Agent"], "read: the token and a User-Agent are sent when there is a token");
calls.length = 0;
script = [resp(200, { type: "file", sha: SHA1, size: 3, encoding: "base64", content: b64("abc") })];
r = await readOutline({});
ok(r.ok && !("Authorization" in calls[0].init.headers), "read: with no token no Authorization header is sent (public repo)");
calls.length = 0;
script = [resp(200, { type: "file", sha: SHA1, size: 2000000, encoding: "none", content: "" }), resp(200, "big text")];
r = await readOutline({});
ok(r.ok && r.text === "big text" && calls.length === 2 && /raw/.test(calls[1].init.headers.Accept), "read: a big file (no inline content) is fetched again as raw text");
for (const [status, want] of [[401, /token/i], [403, /Contents: Read-only/], [404, /private/i], [500, /500/]]) {
  script = [resp(status, { message: "x" })];
  r = await readOutline({ GITHUB_TOKEN: "tok_secret_123" });
  ok(!r.ok && want.test(r.error) && !r.error.includes("tok_secret_123"), `read: HTTP ${status} gives a plain message without the token`, r.error);
}
script = [new Error("socket hang up")];
r = await readOutline({});
ok(!r.ok && /Could not reach/.test(r.error), "read: a network failure is reported, not thrown");
script = [resp(200, { type: "dir", sha: SHA1 })];
r = await readOutline({});
ok(!r.ok && /not a file/.test(r.error), "read: a directory is not accepted");
script = [resp(200, "<html>")];
r = await readOutline({});
ok(!r.ok, "read: a non-JSON answer is an error");
calls.length = 0;
r = await readOutline({ GITHUB_REPO: "bad" });
ok(!r.ok && r.configured === false && calls.length === 0, "read: an invalid setting makes no request");
ok([401, 403, 404, 500].every((s) => !friendlyError(s).includes("tok_secret")), "no message names a token value");

// ---- there is no way to write ----
const src = fs.readFileSync(new URL("../worker/outline.js", import.meta.url), "utf8");
ok(!/\bPUT\b|\bPOST\b|\bPATCH\b|\bDELETE\b|method\s*:/.test(src.replace(/\/\/.*$/gm, "")), "the module contains no request that could write (no PUT/POST/PATCH/DELETE, no method option)");
const api = fs.readFileSync(new URL("../worker/admin-api.js", import.meta.url), "utf8");
ok(!/path === "\/outline" && method === "(PUT|POST|PATCH|DELETE)"/.test(api), "the admin API has no write route for the outline");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
