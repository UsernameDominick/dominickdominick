// When and how a big picture is shrunk.
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/admin/image-fit.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, Array, String }));
const F = window.ImageFit;
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

ok(F.MAX_SIDE === 3000, "the longest side is capped at 3000px");
ok(JSON.stringify(F.fitWithin(1600, 900)) === '{"width":1600,"height":900,"scaled":false}' && !F.fitWithin(3000, 2000).scaled, "a picture within the limit (even exactly at it) is left alone");
const a = F.fitWithin(4032, 3024);
ok(a.scaled && a.width === 3000 && a.height === 2250, "a 4032x3024 phone photo becomes 3000x2250", a);
const b = F.fitWithin(3024, 4032);
ok(b.scaled && b.height === 3000 && b.width === 2250, "a portrait one is capped on its height", b);
const c = F.fitWithin(10000, 10);
ok(c.width === 3000 && c.height === 3, "a very wide strip keeps its shape", c);
const d = F.fitWithin(20000, 3);
ok(d.width === 3000 && d.height === 1, "and never goes below one pixel on the short side", d);
const e = F.fitWithin(6001, 4000, 1000);
ok(e.width === 1000 && e.height === 667, "another limit can be given (4000 x 1000/6001 is 666.6, rounded)", e);
// shape kept, never over the limit, for a spread of sizes
let good = true;
for (let w = 3001; w < 9000; w += 487) for (let h = 100; h < 9000; h += 613) {
  const r = F.fitWithin(w, h);
  if (r.width > 3000 || r.height > 3000 || r.width < 1 || r.height < 1) good = false;
  if (Math.max(r.width, r.height) !== 3000 && Math.max(w, h) > 3000) good = false;
  const f = 3000 / Math.max(w, h);
  if (Math.abs(r.width - w * f) > 0.5 + 1e-9 || Math.abs(r.height - h * f) > 0.5 + 1e-9) if (r.height !== 1 && r.width !== 1) good = false;
}
ok(good, "across many sizes: never over the limit, the longest side lands on it, and each side is the exact scaled size to within half a pixel");
ok(F.fitWithin(0, 100).width === 0 && F.fitWithin(-5, 100).scaled === false && F.fitWithin("x", 100).height === 0 && F.fitWithin(NaN, NaN).scaled === false, "zero, negative or unreadable sizes give an empty result, never NaN");
ok(F.fitWithin(5000, 4000, "bad").width === 3000 && F.fitWithin(5000, 4000, 0).width === 3000, "a bad limit falls back to 3000");
ok(F.canShrink("image/jpeg") && F.canShrink("image/png") && F.canShrink("IMAGE/PNG") && !F.canShrink("image/gif") && !F.canShrink("image/webp") && !F.canShrink("image/svg+xml") && !F.canShrink(undefined), "only JPEG and PNG are re-drawn (GIF and WebP may be animated, SVG has no pixels)");
ok(F.describeShrunk([]) === "" && /^1 big picture was reduced to fit 3000px/.test(F.describeShrunk([1])) && /^3 big pictures were reduced/.test(F.describeShrunk([1, 2, 3])) && F.describeShrunk(null) === "", "the note names the count in the right grammar");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
