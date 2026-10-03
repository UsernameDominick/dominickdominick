// What a script is allowed to ask the admin API for. A script runs in a sandbox with no cookies of its own: every call it makes
// goes to the Scripts window, which checks it here first and then sends it with the owner's session. Pure (no page access), so a
// node test can load it.
(function () {
  // Never reachable from a script, whatever the method: signing in or out, restoring or importing a whole site, purging history,
  // uploading files (a script can't hand over file data), and the scripts themselves (no script rewriting scripts).
  const BLOCKED = [/^\/login$/, /^\/logout$/, /^\/import(-preview)?$/, /^\/scheduled-backups-restore$/, /^\/history-orphans\/purge$/, /^\/upload(-[a-z]+)?$/, /^\/scan-upload$/, /^\/scripts(\/|$)/, /^\/client-error$/];

  // Writes are limited to the content the owner builds in the admin. Reads can go anywhere that is not blocked above.
  const WRITABLE = [
    /^\/pages(\/\d+(\/(duplicate|restore|css|blocks))?)?$/,
    /^\/blocks\/\d+(\/detach)?$/,
    /^\/shared-blocks(\/\d+)?$/,
    /^\/articles(\/(bulk|\d+(\/(restore|duplicate|convert-to-project))?))?$/,
    /^\/projects(\/(bulk|\d+(\/(restore|duplicate|journal|bom))?))?$/,
    /^\/journal\/\d+$/,
    /^\/bom\/\d+$/,
    /^\/redirects(\/\d+)?$/,
    /^\/songs(\/\d+)?$/,
    /^\/simulations(\/\d+(\/(publish|unpublish))?)?$/,
    /^\/scans(\/\d+)?$/,
    /^\/media\/(bulk-update)$/,
    /^\/find-replace$/,
    /^\/topic-meta$/,
    /^\/settings$/,
    /^\/sections(\/[a-f0-9]{12})?$/,
    /^\/templates(\/\d+)?$/,
  ];

  // These permanently destroy something that Trash would otherwise keep; they are allowed, but a preview run lists them by name.
  const DESTRUCTIVE = [/\/permanent$/, /^\/media\/bulk-delete$/];

  const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

  // Splits "/articles?limit=5" into a clean path and its query; null when the path is not one a script may even name.
  function parsePath(raw) {
    if (typeof raw !== "string" || raw.length > 2000 || !raw.startsWith("/") || raw.startsWith("//")) return null;
    if (/[\u0000-\u001f\u007f\s\\]/.test(raw)) return null;
    const q = raw.indexOf("?");
    const path = q === -1 ? raw : raw.slice(0, q);
    const query = q === -1 ? "" : raw.slice(q);
    if (path.length > 1 && path.endsWith("/")) return null;
    // No dot segments and no percent-encoding in the path itself, so "/articles/%2e%2e/login" can't slip past the patterns.
    if (path.split("/").some((seg) => seg === "." || seg === ".." || seg.includes("%"))) return null;
    return { path, query };
  }

  // { ok: true, write, destructive } for a call that may go ahead, { ok: false, error } for one that may not.
  function checkCall(method, raw) {
    const m = String(method || "GET").toUpperCase();
    if (!METHODS.includes(m)) return { ok: false, error: `The method ${m} is not supported.` };
    const parsed = parsePath(raw);
    if (!parsed) return { ok: false, error: `"${String(raw).slice(0, 80)}" is not a valid admin path.` };
    const { path } = parsed;
    if (BLOCKED.some((re) => re.test(path))) return { ok: false, error: `Scripts can't use ${path}.` };
    const write = m !== "GET";
    if (!write) return { ok: true, write: false, destructive: false, path };
    if (!WRITABLE.some((re) => re.test(path)) && !DESTRUCTIVE.some((re) => re.test(path))) {
      return { ok: false, error: `Scripts can read ${path} but not change it.` };
    }
    return { ok: true, write: true, destructive: DESTRUCTIVE.some((re) => re.test(path)) || (m === "DELETE" && /\/permanent$/.test(path)), path };
  }

  // One line for the preview list: "PATCH /articles/12 (tags, title)".
  function describeCall(method, raw, body) {
    const m = String(method || "GET").toUpperCase();
    const parsed = parsePath(raw);
    const where = parsed ? parsed.path : String(raw);
    let keys = "";
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const k = Object.keys(body).filter((x) => x !== "expected_version");
      if (k.length) keys = ` (${k.slice(0, 6).join(", ")}${k.length > 6 ? `, +${k.length - 6} more` : ""})`;
    }
    return `${m} ${where}${keys}`;
  }

  const api = { checkCall, describeCall, parsePath, METHODS };
  if (typeof window !== "undefined") window.ScriptPolicy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
