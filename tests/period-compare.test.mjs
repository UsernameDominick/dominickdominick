// The words for "this period against the one before".
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/admin/period-compare.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number }));
const D = window.PeriodCompare.describe;
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

ok(D(112, 100, 7).text === "12% more than the 7 days before (100)." && D(112, 100, 7).trend === "up", "more views: a percentage, the span and the earlier figure", D(112, 100, 7));
ok(D(75, 100, 7).text === "25% fewer than the 7 days before (100)." && D(75, 100, 7).trend === "down", "fewer views", D(75, 100, 7));
ok(D(5, 5, 30).text === "The same as the 30 days before (5)." && D(5, 5, 30).trend === "same", "identical", D(5, 5, 30));
ok(D(0, 0, 7).trend === "none" && /No views/.test(D(0, 0, 7).text), "nothing in either period says so");
ok(D(8, 0, 7).text === "8 views, none in the 7 days before." && D(1, 0, 7).text === "1 view, none in the 7 days before.", "growth from nothing has no percentage, and the singular is right", [D(8, 0, 7).text, D(1, 0, 7).text]);
ok(D(0, 6, 7).text === "100% fewer than the 7 days before (6)." && D(0, 6, 7).trend === "down", "falling to nothing is 100% fewer");
ok(D(1001, 1000, 7).text === "About the same as the 7 days before (1000)." && D(1001, 1000, 7).trend === "same", "a change that rounds to 0% is 'about the same', never '0% more'", D(1001, 1000, 7).text);
ok(D(3, 1, 1).text === "200% more than the day before (1)." , "a one-day range says 'the day before'", D(3, 1, 1).text);
ok(D("x", null, "y").trend === "none" && D(-5, -2, -1).trend === "none" && D(undefined, undefined, undefined).text.length > 0, "odd input is treated as zero, never NaN", D("x", null, "y"));
ok(!/NaN|undefined|Infinity/.test(JSON.stringify([D(NaN, Infinity, NaN), D(1e9, 3, 90)])), "no NaN or Infinity in any sentence");

const S = window.PeriodCompare.short;
ok(S(125, 100) === "▲ 25%" && S(60, 100) === "▼ 40%" && S(5, 5) === "same" && S(7, 0) === "new" && S(0, 0) === "" && S(1001, 1000) === "same", "the short form for a list row", [S(125, 100), S(60, 100), S(5, 5), S(7, 0), S(0, 0), S(1001, 1000)]);
ok(S(0, 4) === "▼ 100%" && S("x", null) === "" && !/NaN|undefined/.test(S(NaN, Infinity)), "falling to nothing is 100% down and odd input is zero", [S(0, 4), S(NaN, Infinity)]);

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
