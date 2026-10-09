// Runs every tests/*.test.mjs in its own process and fails if any prints a FAIL line, throws, or never reaches ALL PASS.
// These are the pure checks (no server, no browser): the song engine and its files, the Worker's routing and pages, the dial maths.
// The Playwright scripts that drive the Studio and the search dialog live in tests/e2e/.
//
//   node tests/run.mjs              every file, a few at a time
//   node tests/run.mjs song sim     only files whose name contains "song" or "sim"
//   node tests/run.mjs --serial     one at a time (easier to read a crash)
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

const dir = new URL("./", import.meta.url);
const args = process.argv.slice(2);
const serial = args.includes("--serial");
const filters = args.filter((a) => !a.startsWith("--"));
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)))
  .sort();
if (!files.length) {
  console.log(`no test file matches ${filters.join(", ")}`);
  process.exit(1);
}

function runOne(f) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = "";
    const child = spawn(process.execPath, [fileURLToPath(new URL(f, dir))], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (status) => {
      const failLines = out.split("\n").filter((l) => l.startsWith("FAIL"));
      const passed = status === 0 && failLines.length === 0 && /ALL PASS/.test(out);
      resolve({ f, passed, out, failLines, secs: (Date.now() - started) / 1000 });
    });
  });
}

const limit = serial ? 1 : Math.max(2, availableParallelism());
const results = new Array(files.length);
let next = 0;
const began = Date.now();
await Promise.all(
  Array.from({ length: Math.min(limit, files.length) }, async () => {
    while (next < files.length) {
      const i = next++;
      results[i] = await runOne(files[i]);
    }
  })
);

let failed = 0;
for (const r of results) {
  console.log(`${r.passed ? "ok  " : "FAIL"} ${r.f} (${r.secs.toFixed(1)}s)`);
  if (!r.passed) {
    failed++;
    r.failLines.slice(0, 5).forEach((l) => console.log("     " + l.slice(0, 200)));
    if (!r.failLines.length) console.log(r.out.split("\n").slice(-6).join("\n"));
  }
}
const secs = ((Date.now() - began) / 1000).toFixed(1);
console.log(failed ? `${failed} of ${files.length} test files failed (${secs}s)` : `all ${files.length} test files passed (${secs}s)`);
process.exit(failed ? 1 : 0);
