// The outline editor's GitHub side: config checks, what is sent, and how failures are reported (worker/outline.js, with fetch stubbed).
import { outlineConfig, readOutline, writeOutline, friendlyError, byteLength, MAX_OUTLINE_BYTES } from "../worker/outline.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

// ---- config ----
const base = { GITHUB_TOKEN: "tok_secret_123" };
let c = outlineConfig(base);
ok(c.configured && c.repo === "UsernameDominick/dominickdominick" && c.path === "outline.md" && c.branch === "production" && c.apiBase === "https://api.github.com", "defaults", c);
ok(!outlineConfig({}).configured, "no token = not configured");
ok(!outlineConfig({ GITHUB_TOKEN: "   " }).configured, "a blank token = not configured");
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
]) ok(!outlineConfig({ ...base, [k]: v }).valid, `${k}=${v}: rejected (${why})`);
ok(outlineConfig({ ...base, OUTLINE_PATH: "docs/outline.md", OUTLINE_BRANCH: "feature/x-1", GITHUB_REPO: "o/r.js" }).configured, "a nested path, a slashed branch and a dotted repo are fine");
ok(outlineConfig({ ...base, GITHUB_API_BASE: "http://127.0.0.1:9/" }).apiBase === "http://127.0.0.1:9", "a trailing slash on the API base is dropped");

// ---- fetch stub ----
const calls = [];
let script = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  const next = script.shift();
  if (next instanceof Error) throw next;
  return next;
};
const resp = (status, body, headers) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
const b64 = (t) => Buffer.from(t, "utf8").toString("base64");
const SHA1 = "a".repeat(40), SHA2 = "b".repeat(40);

// ---- read ----
script = [resp(200, { type: "file", sha: SHA1, size: 10, encoding: "base64", content: b64("héllo ✓\nline2\n").replace(/(.{20})/g, "$1\n") })];
let r = await readOutline(base);
ok(r.ok && r.text === "héllo ✓\nline2\n" && r.sha === SHA1, "read: base64 with line breaks and non-ASCII decodes exactly", r);
ok(calls[0].url === "https://api.github.com/repos/UsernameDominick/dominickdominick/contents/outline.md?ref=production", "read: URL is repo + path + branch", calls[0].url);
ok(calls[0].init.headers.Authorization === "Bearer tok_secret_123" && /github/.test(calls[0].init.headers.Accept) && calls[0].init.headers["User-Agent"], "read: token, Accept and User-Agent are sent");
calls.length = 0;
script = [resp(200, { type: "file", sha: SHA1, size: 2000000, encoding: "none", content: "" }), resp(200, "big text")];
r = await readOutline(base);
ok(r.ok && r.text === "big text" && calls.length === 2 && /raw/.test(calls[1].init.headers.Accept), "read: a big file (no inline content) is fetched again as raw text");
for (const [status, want] of [[401, /token/i], [403, /Contents/], [404, /could not find/i], [500, /500/]]) {
  script = [resp(status, { message: "x" })];
  r = await readOutline(base);
  ok(!r.ok && want.test(r.error) && !r.error.includes("tok_secret_123"), `read: HTTP ${status} gives a plain message without the token`, r.error);
}
script = [new Error("socket hang up")];
r = await readOutline(base);
ok(!r.ok && /Could not reach/.test(r.error), "read: a network failure is reported, not thrown");
script = [resp(200, { type: "dir", sha: SHA1 })];
r = await readOutline(base);
ok(!r.ok && /not a file/.test(r.error), "read: a directory is not accepted");
script = [resp(200, "<html>")];
r = await readOutline(base);
ok(!r.ok, "read: a non-JSON answer is an error");
r = await readOutline({});
ok(!r.ok && r.configured === false && calls.length > 0, "read: not configured -> no request is made");

// ---- write ----
calls.length = 0;
script = [resp(200, { content: { sha: SHA2 } })];
r = await writeOutline(base, { text: "new ✓ text\n", sha: SHA1, message: "My edit\nsecond line" });
const sent = JSON.parse(calls[0].init.body);
ok(r.ok && r.sha === SHA2, "write: success returns the new sha", r);
ok(calls[0].init.method === "PUT" && sent.branch === "production" && sent.sha === SHA1, "write: PUT with branch and the sha being replaced");
ok(Buffer.from(sent.content, "base64").toString("utf8") === "new ✓ text\n", "write: content is the exact UTF-8 text in base64");
ok(sent.message === "My edit second line", "write: a message's line breaks are flattened", sent.message);
script = [resp(200, {})];
r = await writeOutline(base, { text: "x", sha: SHA1, message: "   " });
ok(JSON.parse(calls[1].init.body).message === "Outline edited from the admin console", "write: a blank message gets the default");
script = [resp(200, {})];
await writeOutline(base, { text: "x", sha: SHA1, message: "m".repeat(500) });
ok(JSON.parse(calls[2].init.body).message.length === 120, "write: a long message is cut to 120");
calls.length = 0;
r = await writeOutline(base, { text: "x", sha: "short" });
ok(!r.ok && r.status === 400 && calls.length === 0, "write: a bad sha is refused before any request");
r = await writeOutline(base, { text: 5, sha: SHA1 });
ok(!r.ok && r.status === 400 && calls.length === 0, "write: non-text is refused");
r = await writeOutline(base, { text: "é".repeat(MAX_OUTLINE_BYTES / 2 + 1), sha: SHA1 });
ok(!r.ok && r.status === 413 && calls.length === 0, "write: over the size limit is refused (counted in bytes, not characters)", byteLength("é".repeat(10)));
ok(byteLength("é") === 2 && byteLength("✓") === 3, "byteLength counts UTF-8 bytes");
r = await writeOutline({}, { text: "x", sha: SHA1 });
ok(!r.ok && r.configured === false && calls.length === 0, "write: not configured -> no request");
// conflict: GitHub 409, then the latest sha is looked up
script = [resp(409, { message: "does not match" }), resp(200, { type: "file", sha: SHA2, size: 1, encoding: "base64", content: b64("z") })];
r = await writeOutline(base, { text: "mine", sha: SHA1 });
ok(!r.ok && r.conflict === true && r.sha === SHA2 && r.status === 409, "write: 409 with a newer file = conflict, with the latest sha", r);
script = [resp(422, { message: "sha wasn't supplied" }), resp(200, { type: "file", sha: SHA1, size: 1, encoding: "base64", content: b64("z") })];
r = await writeOutline(base, { text: "mine", sha: SHA1 });
ok(!r.ok && !r.conflict, "write: a 422 where the file is unchanged is an error, not a conflict", r.error);
script = [resp(403, { message: "no" })];
r = await writeOutline(base, { text: "x", sha: SHA1 });
ok(!r.ok && /Contents/.test(r.error), "write: 403 explains the token needs Contents: Read and write");
script = [new Error("boom")];
r = await writeOutline(base, { text: "x", sha: SHA1 });
ok(!r.ok && /Could not reach/.test(r.error), "write: a network failure is reported");
ok([401, 403, 404, 409, 422, 500].every((s) => !friendlyError(s).includes("tok_secret")), "no message names the token value");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
