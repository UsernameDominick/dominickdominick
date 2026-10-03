// Side-panel sizes: clamping and reading back what was stored (panels.js, pure parts only).
import fs from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/admin/panels.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, Object, JSON, String, isFinite: Number.isFinite }));
const P = window.AdminPanels;

ok(P && typeof P.clampWidth === "function" && typeof P.parseState === "function", "pure helpers are exported");
ok(P.clampWidth("sidebar", 240) === 240, "an in-range width is kept");
ok(P.clampWidth("sidebar", 50) === 180 && P.clampWidth("sidebar", 9999) === 400, "sidebar is held between 180 and 400");
ok(P.clampWidth("palette", 10) === 200 && P.clampWidth("palette", 9999) === 480, "palette is held between 200 and 480");
ok(P.clampWidth("inspector", 10) === 220 && P.clampWidth("inspector", 9999) === 560, "inspector is held between 220 and 560");
ok(P.clampWidth("palette", 333.6) === 334, "widths are whole pixels");
ok(P.clampWidth("palette", NaN) === 240 && P.clampWidth("palette", "abc") === 240 && P.clampWidth("palette", undefined) === 240, "junk falls back to the default");
ok(P.clampWidth("palette", 470, 300) === 300, "a narrow window caps the width (room)");
ok(P.clampWidth("palette", 470, 50) === 200, "but never below the panel's own minimum");
ok(P.clampWidth("nope", 300) === 0, "an unknown panel is 0, not a crash");

const empty = JSON.stringify({ w: {}, hidden: {} });
ok(JSON.stringify(P.parseState(null)) === empty && JSON.stringify(P.parseState("")) === empty && JSON.stringify(P.parseState("{oops")) === empty, "missing or broken storage gives the defaults");
ok(JSON.stringify(P.parseState("[1,2]")) === empty && JSON.stringify(P.parseState("5")) === empty && JSON.stringify(P.parseState("null")) === empty, "non-object storage gives the defaults");
const good = P.parseState(JSON.stringify({ w: { sidebar: 300, palette: 5000, inspector: "wide", bogus: 400 }, hidden: { sidebar: true, inspector: "yes", palette: true } }));
ok(good.w.sidebar === 300 && good.w.palette === 480 && !("inspector" in good.w) && !("bogus" in good.w), "stored widths are clamped and unknown or non-numeric ones dropped", good.w);
ok(good.hidden.sidebar === true && !good.hidden.inspector && !good.hidden.palette, "only true for the menu and inspector counts as hidden", good.hidden);

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
