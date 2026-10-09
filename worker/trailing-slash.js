// Which address a path with a trailing slash should send to: the same path without it ("/projects/x/" -> "/projects/x"), so every page
// has one address. The home page, the Studio's frame, the API and real files are left alone. Returns null to leave it be.
const KEEP = [/^\/studio-app(\/|$)/, /^\/api\//];

export function trailingSlashTarget(pathname) {
  const p = String(pathname || "");
  if (p.length < 2 || !p.endsWith("/")) return null;
  if (KEEP.some((re) => re.test(p))) return null;
  const target = p.replace(/\/+$/, "");
  return target && target !== p ? target : null;
}
