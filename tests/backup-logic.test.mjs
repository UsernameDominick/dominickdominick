// Backing up and restoring what a visitor keeps in the browser: the file's shape, the checks on a restore, and merging without overwriting.
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/backup-logic.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, Array, Object, JSON, Set, String, Date, Boolean }));
const B = window.BackupLogic;
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const bundle = B.makeBundle("studio", { songs: [{ id: 1, name: "A", data: { x: 1 } }] }, "2026-01-02T00:00:00.000Z");
ok(bundle.format === "dominick-backup" && bundle.version === 1 && bundle.app === "studio" && bundle.made === "2026-01-02T00:00:00.000Z", "a backup says what it is, which page it is for and when it was made");
const text = JSON.stringify(bundle);
ok(B.parseBundle(text, "studio").bundle.parts.songs.length === 1, "a good file reads back");
ok(B.parseBundle(text).bundle.app === "studio", "and so does one with no page named");
ok(/not.*backup/i.test(B.parseBundle("{nope", "studio").error), "a file that is not JSON is turned away in plain words");
ok(/not one of this site/i.test(B.parseBundle(JSON.stringify({ hello: 1 }), "studio").error), "so is JSON that is not a backup");
ok(/something this site does not have/.test(B.parseBundle(JSON.stringify(B.makeBundle("simulations", {})), "studio").error), "a backup for a page this site no longer has is refused");
ok(/newer version/.test(B.parseBundle(JSON.stringify(Object.assign({}, bundle, { version: 9 })), "studio").error), "a backup from a newer version is not guessed at");
ok(/something this site does not have/.test(B.parseBundle(JSON.stringify(Object.assign({}, bundle, { app: "other" })), "studio").error), "an unknown page is refused");
ok(B.parseBundle("", "studio").error && B.parseBundle(null, "studio").error, "an empty file or nothing is refused");
ok(/nothing in it/.test(B.parseBundle(JSON.stringify(Object.assign({}, bundle, { parts: [] })), "studio").error), "a backup with no parts is refused");
ok(B.parseBundle("x".repeat(B.MAX_BYTES + 1), "studio").error.includes("too big"), "a huge file is refused before it is read");
ok(B.fileName("studio", new Date(2026, 0, 5)) === "dominick-studio-backup-2026-01-05.json", "the file name has the page and the date");

// merging
const have = [{ id: 1, name: "Beat", data: { a: 1 } }, { id: 7, name: "Tune", data: { b: 2 } }];
const m = B.mergeItems(have, [{ id: 1, name: "Beat", data: { a: 1 } }, { id: 1, name: "Beat", data: { a: 2 } }, { id: 4, name: "New", data: {} }], B.dataSig);
ok(m.added === 2 && m.skipped === 1 && m.list.length === 4, "a restored item that is already here is skipped, the others are added", m);
ok(m.list[0].id === 1 && m.list[1].id === 7 && JSON.stringify(m.list[0].data) === '{"a":1}', "what was here is untouched");
ok(m.list[2].id === 8 && m.list[3].id === 9, "added items get new ids after the largest, so nothing is overwritten", m.list.map((x) => x.id));
ok(B.mergeItems(have, have, B.dataSig).added === 0, "restoring the same backup twice adds nothing");
ok(B.mergeItems(undefined, [{ id: 3, name: "x", data: 1 }], B.dataSig).list[0].id === 1, "into an empty list ids start at 1");
ok(B.mergeItems(have, [null, 5, "x"], B.dataSig).added === 0, "junk entries are ignored");
const cap = B.mergeItems([], [{ name: "a", data: 1 }, { name: "b", data: 2 }, { name: "c", data: 3 }], B.dataSig, 2);
ok(cap.list.length === 2 && cap.full === 1, "a browser's cap on how many it keeps is respected, and the rest are counted", cap);

// what to say
ok(B.summary({ added: 3, skipped: 1, full: 0 }) === "Restored 3 items, 1 already here.", "the summary says how many came back and how many were already here");
ok(B.summary({ added: 1, skipped: 0, full: 2 }).includes("2 left out"), "and how many did not fit");
ok(B.summary({ added: 0, skipped: 2, full: 0 }).startsWith("Nothing new"), "and when there was nothing new");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
