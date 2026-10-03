// Dialog widths: clamping and reading back what was stored (dialog-resize.js, pure parts only).
import fs from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/admin/dialog-resize.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, Object, Array, JSON, String, isFinite: Number.isFinite }));
const D = window.AdminDialogResize;

ok(D && D.MIN === 420, "helpers are exported, minimum 420");
ok(D.clampDialogWidth(700, 1000) === 700, "an in-range width is kept");
ok(D.clampDialogWidth(100, 1000) === 420, "too narrow becomes 420");
ok(D.clampDialogWidth(5000, 1000) === 1000, "too wide becomes the room");
ok(D.clampDialogWidth(500.4, 1000) === 500, "whole pixels");
ok(D.clampDialogWidth(900, 380) === 380, "a room smaller than the minimum wins over the minimum");
ok(D.clampDialogWidth(100, 380) === 380 - 0 && D.clampDialogWidth(100, 380) >= 0, "and a small width is raised only up to the room");
ok(D.clampDialogWidth("abc", 1000) === null && D.clampDialogWidth(NaN, 1000) === null && D.clampDialogWidth(undefined, 1000) === null, "junk gives null (caller does nothing)");
ok(D.clampDialogWidth(800) === 800 && D.clampDialogWidth(9000) === 2000, "no room given: capped at 2000");
ok(D.clampDialogWidth(300, -50) === 0, "a negative room is treated as none");

ok(Object.keys(D.parseWidths(null)).length === 0 && Object.keys(D.parseWidths("{oops")).length === 0 && Object.keys(D.parseWidths("[1]")).length === 0 && Object.keys(D.parseWidths("7")).length === 0, "broken or non-object storage gives nothing");
const good = D.parseWidths(JSON.stringify({ "settings-modal": 800, "redirects-modal": 100, "bad key!": 700, "x": "wide", "huge-modal": 90000, "ok_2": 421.6 }));
ok(good["settings-modal"] === 800 && good.ok_2 === 422, "valid entries are kept (rounded)", good);
ok(!("redirects-modal" in good) && !("bad key!" in good) && !("x" in good) && !("huge-modal" in good), "too small, odd keys, non-numbers and absurd sizes are dropped", good);

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
