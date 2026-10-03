// The one place the browser tests get Playwright from, so a test file never has to know where Chromium lives.
// `chromium.launch()` is patched to use a Chromium that exists on this machine: the path a test asks for if it is there, else
// E2E_CHROMIUM, else the newest one under PLAYWRIGHT_BROWSERS_PATH (or /opt/pw-browsers), else Playwright's own download.
const fs = require("node:fs");
const path = require("node:path");
const pw = require("playwright");

function findChromium() {
  if (process.env.E2E_CHROMIUM && fs.existsSync(process.env.E2E_CHROMIUM)) return process.env.E2E_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const d of dirs) {
      for (const rel of ["chrome-linux/chrome", "chrome-linux64/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-win/chrome.exe"]) {
        const exe = path.join(root, d, rel);
        if (fs.existsSync(exe)) return exe;
      }
    }
  } catch {
    /* no browser directory: let Playwright decide */
  }
  return undefined;
}

const found = findChromium();
const chromium = new Proxy(pw.chromium, {
  get(target, prop) {
    if (prop !== "launch") {
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    }
    return (options = {}) => {
      const asked = options.executablePath;
      const executablePath = asked && fs.existsSync(asked) ? asked : found;
      return target.launch({ ...options, ...(executablePath ? { executablePath } : { executablePath: undefined }) });
    };
  },
});

// axe-core's source, for tests that inject it into a page. Comes from the e2e folder's own node_modules (npm install there).
function axeSource() {
  try {
    return fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  } catch {
    throw new Error("axe-core is not installed: run `npm install` in tests/e2e");
  }
}

// Runs SQL straight against the local D1 file the test server is using (E2E_PERSIST is that server's state folder; unset means the
// dev server's own .wrangler state). Returns wrangler's JSON text shape so `/"n":\s*(\d+)/.exec(d1("SELECT COUNT(*) AS n …"))` works.
function d1(sql) {
  const { DatabaseSync } = require("node:sqlite");
  const state = process.env.E2E_PERSIST ? path.join(process.env.E2E_PERSIST, "v3") : path.resolve(__dirname, "../../.wrangler/state/v3");
  const dir = path.join(state, "d1", "miniflare-D1DatabaseObject");
  const file = fs.readdirSync(dir).find((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
  if (!file) throw new Error(`no local D1 database in ${dir}`);
  const db = new DatabaseSync(path.join(dir, file));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const rows = /^\s*(select|pragma|with)\b/i.test(sql) ? db.prepare(sql).all() : (db.exec(sql), []);
    return JSON.stringify([{ results: rows, success: true }], null, 2);
  } finally {
    db.close();
  }
}

module.exports = { ...pw, chromium, axeSource, d1 };
