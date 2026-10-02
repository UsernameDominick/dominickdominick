import fs from "node:fs";
import vm from "node:vm";
const window = {};
const ctx = vm.createContext({ window, console, Math, Number, String, Object, Array, Set, Map, JSON, Infinity, NaN, Float64Array });
vm.runInContext(fs.readFileSync(new URL("../public/admin/sim-solver.js", import.meta.url), "utf8"), ctx);
const S = window.SimSolver;
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const near = (a, b, tol = 1e-6) => typeof a === "number" && Math.abs(a - b) <= tol * Math.max(1e-9, Math.abs(b));
const src = (id, a, b, v) => ({ kind: "src", id, a, b, v });
const res = (id, a, b, r) => ({ kind: "res", id, a, b, r });
const npn = (id, c, b, e, beta = 100) => ({ kind: "bjt", id, a: c, b: e, base: b, beta, pnp: false });
const pnp = (id, c, b, e, beta = 100) => ({ kind: "bjt", id, a: c, b: e, base: b, beta, pnp: true });
const solve = (els) => S.solveNetwork(els);

// 1. switch: 9 V, 10k base, 1k load -> saturated
let r = solve([src("v", "vcc", "0", 9), res("rb", "vcc", "b", 10000), res("rc", "vcc", "c", 1000), npn("q", "c", "b", "0")]);
ok(r.ok && r.mode.get("q") === "sat" && near(r.current.get("q:c"), 8.8e-3, 1e-6) && near(r.volts.get("c"), 0.2, 1e-6), "NPN switch saturates: Ic = (9 - 0.2) / 1k = 8.8 mA, Vce 0.2 V", [r.mode && r.mode.get("q"), r.current && r.current.get("q:c")]);
// 2. active: 1M base resistor
r = solve([src("v", "vcc", "0", 9), res("rb", "vcc", "b", 1e6), res("rc", "vcc", "c", 1000), npn("q", "c", "b", "0")]);
ok(r.ok && r.mode.get("q") === "active" && near(r.current.get("q:c"), 100 * 8.3e-6, 1e-4) && near(r.volts.get("c"), 9 - 0.83, 1e-4), "NPN active: Ic = beta * Ib = 0.83 mA, collector at 8.17 V", [r.current.get("q:c"), r.volts.get("c")]);
// 3. off: base pulled to ground
r = solve([src("v", "vcc", "0", 9), res("rb", "b", "0", 10000), res("rc", "vcc", "c", 1000), npn("q", "c", "b", "0")]);
ok(r.ok && r.mode.get("q") === "off" && r.current.get("q:c") === 0 && near(r.volts.get("c"), 9, 1e-6), "NPN with its base grounded is off: no collector current, collector at the rail");
// 4. PNP mirror
r = solve([src("v", "vcc", "0", 9), res("rb", "b", "0", 10000), res("rc", "c", "0", 1000), pnp("q", "c", "b", "vcc")]);
ok(r.ok && r.mode.get("q") === "sat" && near(r.current.get("q:c"), 8.8e-3, 1e-6) && near(r.volts.get("c"), 8.8, 1e-6), "PNP switch (emitter on the rail, base to ground through 10k) saturates: 8.8 mA, collector at 8.8 V", [r.mode.get("q"), r.current.get("q:c"), r.volts.get("c")]);
r = solve([src("v", "vcc", "0", 9), res("rb", "vcc", "b", 10000), res("rc", "c", "0", 1000), pnp("q", "c", "b", "vcc")]);
ok(r.ok && r.mode.get("q") === "off" && r.current.get("q:c") === 0, "PNP with its base at the rail is off");
// 5. emitter follower with a 5 V base source
r = solve([src("v", "vcc", "0", 9), src("vb", "b", "0", 5), res("re", "e", "0", 1000), npn("q", "vcc", "b", "e")]);
const ib = 4.3 / 1000 / 101;
ok(r.ok && r.mode.get("q") === "active" && near(r.volts.get("e"), 4.3, 1e-4) && near(r.current.get("q:c"), 100 * ib, 1e-3), "emitter follower: emitter one drop below the base (4.3 V), Ic = beta/(beta+1) * Ie", [r.volts.get("e"), r.current.get("q:c")]);
// 6. Darlington pair
r = solve([src("v", "vcc", "0", 9), res("rb", "vcc", "b", 1e6), res("rc", "vcc", "c", 100), npn("q1", "c", "b", "m", 100), npn("q2", "c", "m", "0", 100)]);
ok(r.ok && r.mode.get("q1") && r.mode.get("q2") !== "off", "a Darlington pair settles", [r.mode && [...r.mode]]);
// 7. a gain of 1 and a low collector supply: saturates early
r = solve([src("v", "vcc", "0", 9), res("rb", "vcc", "b", 1000), res("rc", "vcc", "c", 1000), npn("q", "c", "b", "0", 5)]);
ok(r.ok && r.mode.get("q") === "sat" && near(r.volts.get("c"), 0.2, 1e-6), "a gain-5 transistor with a lot of base drive saturates", [r.mode.get("q")]);
// 8. random networks: physical consistency + KCL, independent of the solver's own bookkeeping
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const names = ["0", "n1", "n2", "n3", "n4", "n5"];
const pickNode = () => names[Math.floor(rnd() * names.length)];
let solvedCount = 0, declined = 0, bad = 0, modes = { off: 0, active: 0, sat: 0 };
for (let t = 0; t < 4000; t++) {
  const els = [src("v1", "n1", "0", 3 + Math.floor(rnd() * 12))];
  if (rnd() < 0.3) els.push(src("v2", "n2", "0", 1 + Math.floor(rnd() * 8)));
  const nr = 2 + Math.floor(rnd() * 5);
  for (let i = 0; i < nr; i++) { let a = pickNode(), b = pickNode(); if (a === b) b = names[(names.indexOf(a) + 1) % names.length]; els.push(res("r" + i, a, b, [47, 100, 220, 1000, 4700, 10000, 100000, 1e6][Math.floor(rnd() * 8)])); }
  const nq = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < nq; i++) { const c = pickNode(), b = pickNode(), e = pickNode(); if (c === e) continue; els.push((rnd() < 0.5 ? npn : pnp)("q" + i, c, b, e, [20, 100, 300][Math.floor(rnd() * 3)])); }
  const sol = solve(els);
  if (!sol.ok) { declined++; continue; }
  solvedCount++;
  const V = sol.volts, I = sol.current;
  const leave = new Map();
  const mag = new Map();
  const addLeave = (n, x) => { leave.set(n, (leave.get(n) || 0) + x); mag.set(n, (mag.get(n) || 0) + Math.abs(x)); };
  let problems = [];
  els.forEach((el) => {
    if (el.kind === "res" || el.kind === "src") { addLeave(el.a, I.get(el.id)); addLeave(el.b, -I.get(el.id)); }
    else if (el.kind === "bjt") {
      const ibv = I.get(el.id + ":b"), icv = I.get(el.id + ":c"), md = sol.mode.get(el.id); modes[md]++;
      const sgn = el.pnp ? -1 : 1;
      const vbe = sgn * (V.get(el.base) - V.get(el.b)), vce = sgn * (V.get(el.a) - V.get(el.b));
      // KCL: an NPN draws ib into the base and ic into the collector and returns both at the emitter; a PNP is the mirror image
      addLeave(el.base, sgn * ibv); addLeave(el.a, sgn * icv); addLeave(el.b, -sgn * ibv); addLeave(el.b, -sgn * icv);
      const tol = 1e-6;
      if (md === "off") { if (vbe > 0.7 + tol || ibv !== 0 || icv !== 0) problems.push("off:" + vbe); }
      else if (md === "active") { if (ibv < -tol * 1e-3 || vce < 0.2 - tol || Math.abs(icv - el.beta * ibv) > 1e-6 * (1 + Math.abs(icv))) problems.push("active:" + [ibv, vce, icv]); if (Math.abs(vbe - 0.7 - 0.001 * ibv) > 1e-6) problems.push("vbe-active:" + vbe); }
      else { if (ibv < -tol * 1e-3 || icv < -1e-6 * (1 + Math.abs(ibv)) || Math.abs(vce - 0.2) > 1e-6 || icv > el.beta * ibv + 1e-6 * (1 + Math.abs(icv))) problems.push("sat:" + [ibv, vce, icv]); }
    }
  });
  leave.forEach((x, n) => { if (n !== "0" && Math.abs(x) > 1e-6 + 1e-7 * mag.get(n)) problems.push("kcl@" + n + ":" + x); });
  if (problems.length) { bad++; if (bad < 4) console.log("  inconsistent", JSON.stringify(els), problems); }
}
ok(bad === 0 && solvedCount > 2000, `random transistor networks: ${solvedCount} solved, ${declined} declined, ${bad} inconsistent (regions seen ${JSON.stringify(modes)})`);
console.log(fail ? "FAILURES " + fail : "ALL PASS");
