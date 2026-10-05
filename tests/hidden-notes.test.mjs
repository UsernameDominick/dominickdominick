// The Hidden Notes vault's server-side checks: only sealed blobs and a well-formed meta are stored, and the vault's rows are recognised so
// backups and restores can leave them alone.
import { cleanHiddenBlob, cleanHiddenMeta, cleanHiddenVault, isHiddenNotesKey, MAX_HIDDEN_NOTES, MAX_HIDDEN_BLOB } from "../worker/hidden-notes.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const iv = "AAAAAAAAAAAAAAAA";
const ct = "A".repeat(56);
const blob = JSON.stringify({ v: 1, iv, ct });
const meta = { v: 1, salt: "A".repeat(24), iter: 600000, check: { iv, ct: "A".repeat(44) } };

ok(cleanHiddenBlob(blob) === blob, "a sealed blob is kept exactly");
ok(cleanHiddenBlob(JSON.stringify({ v: 1, iv, ct, extra: "<script>" })) === blob, "extra keys are dropped");
for (const bad of [null, 5, "x", "{}", JSON.stringify({ v: 2, iv, ct }), JSON.stringify({ v: 1, iv: "short", ct }), JSON.stringify({ v: 1, iv, ct: "tiny" }), JSON.stringify({ v: 1, iv, ct: "not base64!!!!!!!!!!!!!!!!!!!!!!" }), "A".repeat(MAX_HIDDEN_BLOB + 1), JSON.stringify({ v: 1, iv, ct: "A".repeat(MAX_HIDDEN_BLOB) })]) ok(cleanHiddenBlob(bad) === null, `rejects ${String(bad).slice(0, 40)}`);

ok(JSON.stringify(cleanHiddenMeta(meta)) === JSON.stringify(meta), "a good meta is kept");
ok(cleanHiddenMeta({ ...meta, extra: 1, iter: 600000 }).extra === undefined, "extra meta keys are dropped");
for (const bad of [null, [], { ...meta, v: 2 }, { ...meta, salt: "short" }, { ...meta, salt: "!".repeat(24) }, { ...meta, iter: 10 }, { ...meta, iter: 1.5 }, { ...meta, iter: 99999999 }, { ...meta, check: null }, { ...meta, check: { iv, ct: "x" } }]) ok(cleanHiddenMeta(bad) === null, `rejects meta ${JSON.stringify(bad).slice(0, 50)}`);

const good = cleanHiddenVault({ meta, notes: [{ id: "0123456789ab", blob, created_at: "2026-10-05T10:00:00.000Z" }, { blob, id: "bad id" }, { blob, id: "0123456789ab" }] });
ok(!good.error && good.notes.length === 3 && good.notes[0].id === "0123456789ab" && good.notes[0].created_at === "2026-10-05T10:00:00.000Z", "a vault keeps good ids and dates");
ok(good.notes[1].id === null && good.notes[2].id === null && good.notes[1].created_at === null, "a bad or repeated id becomes new, and an unknown date is dropped");
ok(cleanHiddenVault({ meta, notes: [] }).notes.length === 0, "an empty vault is fine");
ok(cleanHiddenVault({ meta: null, notes: [] }).error && cleanHiddenVault({ meta, notes: "x" }).error && cleanHiddenVault({ meta, notes: [{ blob: "x" }] }).error, "a bad meta, list or note is refused with a message");
ok(cleanHiddenVault({ meta, notes: Array.from({ length: MAX_HIDDEN_NOTES + 1 }, () => ({ blob })) }).error, "more than the cap is refused");

ok(isHiddenNotesKey("hidden_note:abc") && isHiddenNotesKey("hidden_notes_meta") && !isHiddenNotesKey("site_brand") && !isHiddenNotesKey(null) && !isHiddenNotesKey(5), "the vault's settings rows are recognised, others are not");
console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
