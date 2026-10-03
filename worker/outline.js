// The project outline (outline.md) edited from the admin console: it is read from, and saved to, the GitHub repo through the contents
// API, one commit per save. Nothing is stored on the site itself.
//
// Setup (once): create a fine-grained GitHub token limited to this one repository with "Contents: Read and write", then store it as a
// Worker secret named GITHUB_TOKEN (`wrangler secret put GITHUB_TOKEN`). Optional settings, all with defaults:
//   GITHUB_REPO     owner/name of the repository          (default UsernameDominick/dominickdominick)
//   OUTLINE_PATH    the file inside the repo              (default outline.md)
//   OUTLINE_BRANCH  the branch the file is read from/saved to (default production, the preview branch, so a save does not redeploy the live site)
//   GITHUB_API_BASE the API origin                        (default https://api.github.com; tests point it at a local stand-in)
// Without a token the editor says it is not set up and nothing else changes.

const DEFAULT_REPO = "UsernameDominick/dominickdominick";
export const MAX_OUTLINE_BYTES = 900000; // the contents API tops out near 1 MB per request

export function outlineConfig(env) {
  const repo = String(env.GITHUB_REPO || DEFAULT_REPO).trim();
  const path = String(env.OUTLINE_PATH || "outline.md").trim();
  const branch = String(env.OUTLINE_BRANCH || "production").trim();
  const apiBase = String(env.GITHUB_API_BASE || "https://api.github.com").replace(/\/+$/, "");
  const token = String(env.GITHUB_TOKEN || "").trim();
  const valid =
    /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo) &&
    /^[A-Za-z0-9_./-]{1,200}\.md$/.test(path) &&
    !path.split("/").some((part) => part === ".." || part === "." || part === "") &&
    /^[A-Za-z0-9_./-]{1,200}$/.test(branch) &&
    !branch.includes("..") &&
    /^https?:\/\//.test(apiBase);
  return { repo, path, branch, apiBase, token, valid, configured: valid && token !== "" };
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function base64ToUtf8(b64) {
  const bin = atob(String(b64 || "").replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
export function byteLength(text) {
  return new TextEncoder().encode(String(text)).length;
}

function contentsUrl(cfg) {
  return `${cfg.apiBase}/repos/${cfg.repo}/contents/${cfg.path.split("/").map(encodeURIComponent).join("/")}`;
}
function headers(cfg, accept = "application/vnd.github+json") {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: accept,
    "User-Agent": "dominickdominick-outline-editor",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
// Turns a GitHub failure into a sentence the owner can act on. The token is never part of any message.
export function friendlyError(status) {
  if (status === 401) return "GitHub did not accept the token. Make a new one and store it again as GITHUB_TOKEN.";
  if (status === 403) return "GitHub refused it. The token needs \"Contents: Read and write\" on this repository (or GitHub is rate-limiting; try again in a minute).";
  if (status === 404) return "GitHub could not find that file, branch or repository (or the token cannot see it). Check GITHUB_REPO, OUTLINE_PATH and OUTLINE_BRANCH.";
  if (status === 409 || status === 422) return "GitHub rejected the save.";
  return `GitHub answered with an error (${status}).`;
}

async function call(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    return null;
  }
}

// -> { ok, text, sha, size } or { ok:false, status, error }
export async function readOutline(env) {
  const cfg = outlineConfig(env);
  if (!cfg.configured) return { ok: false, status: 503, error: "The outline editor is not set up yet.", configured: false };
  const res = await call(`${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`, { headers: headers(cfg) });
  if (!res) return { ok: false, status: 502, error: "Could not reach GitHub." };
  if (!res.ok) return { ok: false, status: res.status === 404 ? 404 : 502, error: friendlyError(res.status) };
  let meta;
  try {
    meta = await res.json();
  } catch {
    return { ok: false, status: 502, error: "GitHub sent something unexpected." };
  }
  if (!meta || meta.type !== "file" || typeof meta.sha !== "string") return { ok: false, status: 502, error: "That path is not a file." };
  let text;
  if (meta.encoding === "base64" && typeof meta.content === "string" && meta.content.length) text = base64ToUtf8(meta.content);
  else {
    // Larger files come back without their content: ask for the raw text instead.
    const raw = await call(`${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`, { headers: headers(cfg, "application/vnd.github.raw+json") });
    if (!raw || !raw.ok) return { ok: false, status: 502, error: "Could not read the file from GitHub." };
    text = await raw.text();
  }
  return { ok: true, text, sha: meta.sha, size: meta.size };
}

// -> { ok, sha } | { ok:false, conflict:true, sha } | { ok:false, status, error }
export async function writeOutline(env, { text, sha, message }) {
  const cfg = outlineConfig(env);
  if (!cfg.configured) return { ok: false, status: 503, error: "The outline editor is not set up yet.", configured: false };
  if (typeof text !== "string") return { ok: false, status: 400, error: "No text to save." };
  if (byteLength(text) > MAX_OUTLINE_BYTES) return { ok: false, status: 413, error: "The outline is too big to save (limit about 900 KB)." };
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha)) return { ok: false, status: 400, error: "Reload the outline first (it has no version to save over)." };
  const cleanMessage = String(message || "").replace(/[\r\n]+/g, " ").trim().slice(0, 120) || "Outline edited from the admin console";
  const body = { message: cleanMessage, content: utf8ToBase64(text), sha, branch: cfg.branch };
  const res = await call(contentsUrl(cfg), { method: "PUT", headers: { ...headers(cfg), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res) return { ok: false, status: 502, error: "Could not reach GitHub." };
  if (res.ok) {
    let out = null;
    try {
      out = await res.json();
    } catch {}
    return { ok: true, sha: out && out.content && out.content.sha };
  }
  if (res.status === 409 || res.status === 422) {
    // Somebody (usually a commit from the dev side) changed the file since it was loaded: hand back the newest version's id.
    const latest = await readOutline(env);
    if (latest.ok && latest.sha !== sha) return { ok: false, conflict: true, status: 409, sha: latest.sha, error: "The outline changed on GitHub after you opened it." };
  }
  return { ok: false, status: res.status === 404 ? 404 : 502, error: friendlyError(res.status) };
}
