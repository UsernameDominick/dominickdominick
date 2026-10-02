// Runs every tests/*.test.mjs in its own process and fails if any prints a FAIL line, throws, or never reaches ALL PASS.
// These are the pure checks (no server, no browser): the circuit solver and the client/worker parity of the simulation
// analysis. The Playwright scripts that drive the admin UI are run by hand against `wrangler dev`.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const dir = new URL("./", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();
let failed = 0;
for (const f of files) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [new URL(f, dir).pathname], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  const failLines = out.split("\n").filter((l) => l.startsWith("FAIL"));
  const passed = r.status === 0 && failLines.length === 0 && /ALL PASS/.test(out);
  console.log(`${passed ? "ok  " : "FAIL"} ${f} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (!passed) {
    failed++;
    failLines.slice(0, 5).forEach((l) => console.log("     " + l.slice(0, 200)));
    if (!failLines.length) console.log(out.split("\n").slice(-6).join("\n"));
  }
}
console.log(failed ? `${failed} of ${files.length} test files failed` : `all ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
