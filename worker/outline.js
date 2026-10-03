// The project outline (outline.md) shown read-only in the admin console: it is read from the GitHub repo through the contents API.
// Nothing is stored on the site and nothing can be written back; the code has no write path at all.
//
// A public repository needs no setup. For a private one, create a fine-grained GitHub token limited to this one repository with
// "Contents: Read-only" and store it as a Worker secret named GITHUB_TOKEN (`wrangler secret put GITHUB_TOKEN`). Optional settings:
//   GITHUB_REPO     owner/name of the repository          (default UsernameDominick/dominickdominick)
//   OUTLINE_PATH    the file inside the repo              (default outline.md)
//   OUTLINE_BRANCH  the branch the file is read from      (default production)
//   GITHUB_API_BASE the API origin                        (default https://api.github.com; tests point it at a local stand-in)

const DEFAULT_REPO = "UsernameDominick/dominickdominick";
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
  return { repo, path, branch, apiBase, token, valid, configured: valid, hasToken: token !== "" };
}

function base64ToUtf8(b64) {
  const bin = atob(String(b64 || "").replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function contentsUrl(cfg) {
  return `${cfg.apiBase}/repos/${cfg.repo}/contents/${cfg.path.split("/").map(encodeURIComponent).join("/")}`;
}
function headers(cfg, accept = "application/vnd.github+json") {
  const h = { Accept: accept, "User-Agent": "dominickdominick-outline-viewer", "X-GitHub-Api-Version": "2022-11-28" };
  if (cfg.token) h.Authorization = `Bearer ${cfg.token}`;
  return h;
}
// Turns a GitHub failure into a sentence the owner can act on. The token is never part of any message.
export function friendlyError(status) {
  if (status === 401) return "GitHub did not accept the token. Make a new one and store it again as GITHUB_TOKEN.";
  if (status === 403) return "GitHub refused it. The token needs \"Contents: Read-only\" on this repository (or GitHub is rate-limiting; try again in a minute).";
  if (status === 404) return "GitHub could not find that file, branch or repository. If the repository is private, store a read-only token as GITHUB_TOKEN; otherwise check GITHUB_REPO, OUTLINE_PATH and OUTLINE_BRANCH.";
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
  if (!cfg.configured) return { ok: false, status: 503, error: "The outline settings (repository, path or branch) are not valid.", configured: false };
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
