// Byte ranges for /media (worker/range.js): the forms browsers send, and what is ignored or refused.
import { parseByteRange } from "../worker/range.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const R = (start, end) => ({ type: "range", start, end });

ok(eq(parseByteRange(null, 1000), { type: "none" }) && eq(parseByteRange(undefined, 1000), { type: "none" }), "no Range header: serve the whole file");
ok(eq(parseByteRange("bytes=0-99", 1000), R(0, 99)), "bytes=0-99 is the first 100 bytes");
ok(eq(parseByteRange("bytes=0-", 1000), R(0, 999)), "bytes=0- is everything (what Safari asks first)");
ok(eq(parseByteRange("bytes=500-", 1000), R(500, 999)), "bytes=500- runs to the end");
ok(eq(parseByteRange("bytes=-100", 1000), R(900, 999)), "bytes=-100 is the last 100 bytes");
ok(eq(parseByteRange("bytes=-5000", 1000), R(0, 999)), "a suffix longer than the file is the whole file");
ok(eq(parseByteRange("bytes=900-5000", 1000), R(900, 999)), "an end past the file is cut to the last byte");
ok(eq(parseByteRange("bytes=999-999", 1000), R(999, 999)), "the very last byte");
ok(eq(parseByteRange("  bytes = 10 - 20 ", 1000), R(10, 20)) && eq(parseByteRange("BYTES=10-20", 1000), R(10, 20)), "spacing and letter case are tolerated");
ok(eq(parseByteRange("bytes=1000-", 1000), { type: "unsatisfiable" }) && eq(parseByteRange("bytes=5000-6000", 1000), { type: "unsatisfiable" }), "a start at or past the end is unsatisfiable (416)");
ok(eq(parseByteRange("bytes=-0", 1000), { type: "unsatisfiable" }), "the last 0 bytes is unsatisfiable");
ok(eq(parseByteRange("bytes=0-0", 0), { type: "unsatisfiable" }) && eq(parseByteRange("bytes=-1", 0), { type: "unsatisfiable" }), "any range of an empty file is unsatisfiable");
ok(eq(parseByteRange("bytes=0-99,200-299", 1000), { type: "none" }), "several ranges are ignored (the whole file is sent)");
ok(eq(parseByteRange("items=0-99", 1000), { type: "none" }), "another unit is ignored");
ok(eq(parseByteRange("bytes=5-2", 1000), { type: "none" }), "an end before the start is not a range: ignored");
for (const junk of ["", "bytes", "bytes=", "bytes=-", "bytes=a-b", "bytes=1.5-3", "bytes=--5", "0-99", "bytes=0-99-100"]) ok(eq(parseByteRange(junk, 1000), { type: "none" }), `junk ${JSON.stringify(junk)} is ignored`);
ok(eq(parseByteRange("bytes=99999999999999999999-", 1000), { type: "unsatisfiable" }), "a number too big to be exact is unsatisfiable, not a crash");
ok(eq(parseByteRange("bytes=0-99", NaN), { type: "none" }) && eq(parseByteRange("bytes=0-99", -1), { type: "none" }), "an unknown size ignores the header");
const r = parseByteRange("bytes=0-1048575", 2048);
ok(r.end === 2047, "a big end on a small file is clamped", r);

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
