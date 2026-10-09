// Runs the browser tests (tests/e2e/test_*.js) in parallel, each worker against its own throwaway copy of the site.
//
//   node tests/e2e/run.mjs                    every test, 3 workers
//   node tests/e2e/run.mjs palette studio    only tests whose name contains one of the words
//   node tests/e2e/run.mjs --workers 4        more (or fewer) workers; --serial is --workers 1
//   node tests/e2e/run.mjs --live test_foo    use the dev server already running on :8787 (no startup, but it changes that database)
//   node tests/e2e/run.mjs --verbose         also show why the known-failing tests fail
//   node tests/e2e/run.mjs --no-retry        report a failure straight away instead of trying that test once more on its own
//   node tests/e2e/run.mjs --keep             leave the temp folders (server logs, copied databases) for a look afterwards
//
// How it stays fast and safe: each worker gets `wrangler dev --persist-to <temp folder>` on its own port, seeded from a copy of the local
// D1/R2 state in .wrangler, and its own login. Tests can create and delete whatever they like (no QQ clean-up, no collisions between
// workers) and the real local database is never touched. Don't edit files under worker/ or public/ while it runs: the servers reload.
// Tests listed in known-failing.txt may fail without failing the run; anything else red is a new failure.
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
process.removeAllListeners("warning"); // node:sqlite is still flagged experimental; the notice is just noise here
const { DatabaseSync } = await import("node:sqlite");

// Windows needs a shell to start npx and npm (their launchers are .cmd files).
const IS_WIN = process.platform === "win32";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const optionValues = new Set(["--workers"].flatMap((o) => (args.includes(o) ? [args[args.indexOf(o) + 1]] : [])));
const filters = args.filter((a) => !a.startsWith("--") && !optionValues.has(a));
const live = flag("live");
const keep = flag("keep");
const verbose = flag("verbose");
const retry = !flag("no-retry");
const workerCount = flag("serial") || live ? 1 : Math.max(1, Number(option("workers", 3)) || 3);
const TEST_TIMEOUT_MS = 4 * 60 * 1000;

// ---- which tests
const known = new Set(
  fs.readFileSync(path.join(here, "known-failing.txt"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => l.replace(/\.js$/, ""))
);
const timingsFile = path.join(here, ".timings.json");
let timings = {};
try {
  timings = JSON.parse(fs.readFileSync(timingsFile, "utf8"));
} catch {
  /* first run */
}
let tests = fs.readdirSync(here).filter((f) => /^test_.*\.js$/.test(f)).map((f) => f.replace(/\.js$/, "")).sort();
if (filters.length) tests = tests.filter((t) => filters.some((x) => t.includes(x)));
if (!tests.length) {
  console.log(`no test matches ${filters.join(", ")}`);
  process.exit(1);
}
// Longest first, so one slow test doesn't start last and hold everything up.
tests.sort((a, b) => (timings[b] || 20) - (timings[a] || 20));

// ---- Playwright and the admin password (the password is only ever sent to the local server)
const globalRoot = (() => {
  try {
    return execFileSync("npm", ["root", "-g"], { encoding: "utf8", shell: IS_WIN, windowsHide: true }).trim();
  } catch {
    return "";
  }
})();
const nodePath = [process.env.NODE_PATH, globalRoot].filter(Boolean).join(path.delimiter);
let playwright;
try {
  const req = createRequire(path.join(here, "x.js"));
  playwright = req(req.resolve("playwright", { paths: [here, ...nodePath.split(path.delimiter)] }));
} catch {
  console.error("Playwright was not found. Run `npm install` in tests/e2e (or `npm install -g playwright`).");
  process.exit(2);
}
const adminPassword = (() => {
  try {
    const m = /^ADMIN_PASSWORD\s*=\s*(.*)$/m.exec(fs.readFileSync(path.join(root, ".dev.vars"), "utf8"));
    return m ? m[1].trim().replace(/^(["'])(.*)\1$/, "$2") : "";
  } catch {
    return "";
  }
})();
if (!adminPassword) {
  console.error("No ADMIN_PASSWORD in .dev.vars, so the tests can't sign in to the local admin.");
  process.exit(2);
}

// ---- servers
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-"));
const children = [];
function cleanup() {
  for (const c of children) {
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  if (!keep) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portFree = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, () => s.close(() => resolve(true)));
  });
async function freePort(start) {
  for (let p = start; p < start + 200; p++) if (await portFree(p)) return p;
  throw new Error(`no free port from ${start}`);
}

// The local database is a scratch one that older sessions filled with test leftovers (hundreds of trashed pages, "QQ" sections...).
// Every worker starts from a copy with that removed, so a test sees the same few real pages and articles no matter how much junk the
// dev database has collected. Also clears rate-limit state, which would make sign-in and tracking tests depend on earlier runs.
function tidySeed(stateDir) {
  const dir = path.join(stateDir, "d1", "miniflare-D1DatabaseObject");
  const file = fs.readdirSync(dir).find((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
  if (!file) return;
  const db = new DatabaseSync(path.join(dir, file));
  const run = (sql) => {
    try {
      db.exec(sql);
    } catch {
      /* a table this copy doesn't have */
    }
  };
  for (const t of ["pages", "articles", "projects"]) run(`DELETE FROM ${t} WHERE deleted_at IS NOT NULL`);
  run("DELETE FROM blocks WHERE page_id NOT IN (SELECT id FROM pages)");
  run("DELETE FROM revisions WHERE kind = 'page' AND entity_id NOT IN (SELECT id FROM pages)");
  run("DELETE FROM settings WHERE key LIKE 'page_section:%' AND value LIKE '%\"name\":\"QQ%'");
  for (const [t, col] of [["articles", "title"], ["projects", "title"], ["songs", "name"], ["simulations", "name"]]) run(`DELETE FROM ${t} WHERE ${col} LIKE 'QQ%'`);
  for (const t of ["login_attempts", "rate_limits"]) run(`DELETE FROM ${t}`);
  db.close();
}

async function startWorker(i) {
  const dir = path.join(tmp, `w${i}`);
  const state = path.join(dir, "v3");
  fs.mkdirSync(state, { recursive: true });
  const seed = path.join(root, ".wrangler/state/v3");
  for (const part of ["d1", "r2"]) {
    if (!fs.existsSync(path.join(seed, part))) {
      // A fresh checkout has a database but nothing in R2 yet: the tests start from an empty bucket.
      if (part === "r2") { fs.mkdirSync(path.join(state, part), { recursive: true }); continue; }
      throw new Error("There is no local database to copy (.wrangler/state). Run `npm run db:local` first.");
    }
    fs.cpSync(path.join(seed, part), path.join(state, part), { recursive: true });
  }
  tidySeed(state);
  const port = await freePort(8800 + i * 10);
  const inspector = await freePort(9300 + i * 10);
  const log = fs.openSync(path.join(dir, "wrangler.log"), "w");
  const child = spawn("npx", ["wrangler", "dev", "--port", String(port), "--inspector-port", String(inspector), "--persist-to", dir, "--log-level", "warn", "--show-interactive-dev-session=false"], {
    cwd: root,
    detached: !IS_WIN,
    shell: IS_WIN,
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  children.push(child);
  let exited = false;
  child.on("exit", () => (exited = true));
  const base = `http://localhost:${port}`;
  const began = Date.now();
  while (Date.now() - began < 150000) {
    if (exited) throw new Error(`worker ${i}: wrangler exited early; see ${path.join(dir, "wrangler.log")}\n${fs.readFileSync(path.join(dir, "wrangler.log"), "utf8").slice(-1500)}`);
    try {
      const r = await fetch(base + "/", { redirect: "manual" });
      if (r.status < 500) return { i, base, dir };
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`worker ${i}: the server did not come up in time; see ${path.join(dir, "wrangler.log")}`);
}

async function signIn(base, file) {
  const ctx = await playwright.request.newContext({ baseURL: base });
  const res = await ctx.post("/api/admin/login", { data: { password: adminPassword } });
  if (res.status() !== 200) throw new Error(`sign-in failed on ${base} (HTTP ${res.status()})`);
  await ctx.storageState({ path: file });
  await ctx.dispose();
  // The older song tests drive the classic editor; the Studio layout has its own test, which switches view itself.
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  state.origins = [{ origin: base, localStorage: [{ name: "admin-panels:v2", value: JSON.stringify({ w: {}, hidden: {} }) }] }];
  fs.writeFileSync(file, JSON.stringify(state));
}

// ---- running
function runTest(name, worker) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = "";
    const child = spawn(process.execPath, [path.join(here, `${name}.js`)], {
      cwd: here,
      env: { ...process.env, E2E_BASE: worker.base, ADMIN_STATE: worker.state, NODE_PATH: nodePath, NODE_OPTIONS: "--no-warnings", ...(live ? {} : { E2E_PERSIST: worker.dir }) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      out += `\nFAIL — timed out after ${TEST_TIMEOUT_MS / 1000}s\n`;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* gone */
      }
    }, TEST_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      const lines = out.split("\n").map((l) => l.trimEnd()).filter(Boolean);
      const failLines = lines.filter((l) => /^FAIL\b/.test(l) || /\bFAILED\b/.test(l) || /^ASSERTION FAILED/.test(l));
      const lastLine = lines[lines.length - 1] || "";
      const passed = failLines.length === 0 && (code === 0 || /PASS/.test(lastLine));
      resolve({ name, passed, failLines, tail: lines.slice(-8), secs: (Date.now() - started) / 1000, code, worker: worker.i });
    });
  });
}

const began = Date.now();
let workers;
try {
  if (live) {
    const base = option("base", "http://localhost:8787");
    workers = [{ i: 0, base, dir: tmp }];
    console.log(`Using the server already running at ${base} (its database will change).`);
  } else {
    console.log(`Starting ${Math.min(workerCount, tests.length)} isolated server${Math.min(workerCount, tests.length) === 1 ? "" : "s"}…`);
    execFileSync("npx", ["wrangler", "--version"], { cwd: root, stdio: "ignore", shell: IS_WIN, windowsHide: true }); // warm the npx cache once, before the workers race for it
    workers = await Promise.all(Array.from({ length: Math.min(workerCount, tests.length) }, (_, i) => startWorker(i)));
  }
  for (const w of workers) {
    w.state = path.join(tmp, `state-${w.i}.json`);
    await signIn(w.base, w.state);
  }
} catch (err) {
  console.error(String(err.message || err));
  process.exit(2);
}
const startup = ((Date.now() - began) / 1000).toFixed(1);
console.log(`Ready in ${startup}s. Running ${tests.length} test${tests.length === 1 ? "" : "s"} on ${workers.length} worker${workers.length === 1 ? "" : "s"}…\n`);

const results = [];
let next = 0;
await Promise.all(
  workers.map(async (w) => {
    while (next < tests.length) {
      const name = tests[next++];
      const r = await runTest(name, w);
      results.push(r);
      const tag = r.passed ? "ok  " : known.has(name) ? "known" : "FAIL";
      console.log(`${tag.padEnd(5)} ${name} (${r.secs.toFixed(1)}s)`);
      if (!r.passed && (verbose || !known.has(name))) (r.failLines.length ? r.failLines.slice(0, verbose ? 8 : 4) : r.tail).forEach((l) => console.log("        " + l.slice(0, 180)));
      timings[name] = Math.round(r.secs);
    }
  })
);
// Several browsers and servers share the machine, so a test that waits on a timer can miss its moment. A failed test is run once more on its
// own, after everything else has finished; if it passes then it is reported as flaky (still listed, not counted as a failure).
const flaky = [];
if (retry) {
  for (const r of results.filter((x) => !x.passed && !known.has(x.name))) {
    const again = await runTest(r.name, workers[0]);
    console.log(`retry ${r.name} on its own: ${again.passed ? "passed" : "failed again"} (${again.secs.toFixed(1)}s)`);
    if (again.passed) {
      flaky.push(r.name);
      Object.assign(r, again, { retried: true });
    }
  }
}
try {
  fs.writeFileSync(timingsFile, JSON.stringify(timings, null, 1));
} catch {
  /* timings are only an optimisation */
}

// ---- summary
const newFailures = results.filter((r) => !r.passed && !known.has(r.name)).sort((a, b) => a.name.localeCompare(b.name));
const stillKnown = results.filter((r) => !r.passed && known.has(r.name));
const nowPassing = results.filter((r) => r.passed && known.has(r.name));
const total = ((Date.now() - began) / 1000).toFixed(1);
console.log("");
if (stillKnown.length) console.log(`Known failures (not counted): ${stillKnown.map((r) => r.name).sort().join(", ")}`);
if (flaky.length) console.log(`Flaky (failed under load, passed on its own): ${flaky.sort().join(", ")}`);
if (nowPassing.length) console.log(`Passing now, remove from known-failing.txt: ${nowPassing.map((r) => r.name).sort().join(", ")}`);
if (newFailures.length) {
  console.log(`\n${newFailures.length} NEW failure${newFailures.length === 1 ? "" : "s"}:`);
  for (const r of newFailures) {
    console.log(`\n  ${r.name} (exit ${r.code})`);
    (r.failLines.length ? r.failLines.slice(0, 6) : r.tail).forEach((l) => console.log("    " + l.slice(0, 220)));
  }
  console.log(`\nRe-run one with: node tests/e2e/run.mjs ${newFailures[0].name}`);
}
console.log(`\n${results.length - newFailures.length - stillKnown.length} passed, ${stillKnown.length} known failing, ${newFailures.length} new failing — ${total}s`);
if (keep) console.log(`Kept ${tmp}`);
process.exit(newFailures.length ? 1 : 0);
