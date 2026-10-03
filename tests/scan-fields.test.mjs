// 3D scan records: keys must be the ones the scan uploader hands out, everything else is trimmed and bounded.
import assert from "node:assert/strict";
import { cleanScanFields, isScanGlbKey, isScanUsdzKey } from "../worker/scans.js";

const U = "0b6f3a52-1c3e-4d0a-9a77-2f1e5c9d8a10";
const GLB = `scans/${U}.glb`;
const GLTF = `scans/${U}.gltf`;
const USDZ = `scans/${U}.usdz`;

assert.equal(isScanGlbKey(GLB), true);
assert.equal(isScanGlbKey(GLTF), true);
assert.equal(isScanGlbKey(USDZ), false);
assert.equal(isScanUsdzKey(USDZ), true);
assert.equal(isScanUsdzKey(GLB), false);
for (const bad of ["uploads/photo.png", `uploads/${U}.glb`, `scans/${U}.glb/../x`, `scans/../uploads/a.glb`, `/scans/${U}.glb`, `scans/${U}.GLB`, `scans/x.glb`, "", null, undefined, 5, `scans/${U}.glb `]) {
  assert.equal(isScanGlbKey(bad), false, String(bad));
}

// ---- create ----
let r = cleanScanFields({ name: "  Bench  ", glb_key: GLB, usdz_key: USDZ, poster_key: "/media/uploads/p.png", camera_orbit: "0deg 75deg 105%", camera_target: "auto auto auto", field_of_view: "30deg", size: 1234.4, ignored: "x", id: 9 });
assert.deepEqual(r.fields, { name: "Bench", glb_key: GLB, usdz_key: USDZ, poster_key: "/media/uploads/p.png", camera_orbit: "0deg 75deg 105%", camera_target: "auto auto auto", field_of_view: "30deg", size: 1234 }, "known keys only, cleaned");
assert.match(cleanScanFields({ name: "", glb_key: GLB }).error, /required/);
assert.match(cleanScanFields({ name: "x" }).error, /required/);
assert.match(cleanScanFields({ name: "x", glb_key: "uploads/photo.png" }).error, /scan uploader/);
assert.match(cleanScanFields({ name: "x", glb_key: GLB, usdz_key: GLB }).error, /iOS model/);
assert.match(cleanScanFields({ name: "x".repeat(201), glb_key: GLB }).error, /name/);
assert.match(cleanScanFields({ name: "a\nb", glb_key: GLB }).error, /name/);
assert.match(cleanScanFields({ name: { toString: () => "x" }, glb_key: GLB }).error, /required/, "a non-string name is not a name");
assert.match(cleanScanFields(null).error, /required/);
assert.deepEqual(cleanScanFields({ name: "n", glb_key: GLB, usdz_key: "", poster_key: "  ", camera_orbit: null }).fields, { name: "n", glb_key: GLB, usdz_key: null, poster_key: null, camera_orbit: null });

// ---- poster ----
for (const good of ["/media/uploads/a.png", "https://example.com/p.jpg", "http://example.com/p.jpg", "uploads/a.png"]) assert.equal(cleanScanFields({ name: "n", glb_key: GLB, poster_key: good }).fields.poster_key, good, good);
for (const bad of ["javascript:alert(1)", "data:image/png;base64,AA", "//evil.example/p.png", "a b", "/a\nb", "https://", "x".repeat(501), 7]) assert.ok(cleanScanFields({ name: "n", glb_key: GLB, poster_key: bad }).error, String(bad).slice(0, 30));

// ---- camera and size ----
for (const bad of ["0deg;color:red", '0deg" onload="x', "<x>", "x".repeat(81)]) assert.ok(cleanScanFields({ name: "n", glb_key: GLB, camera_orbit: bad }).error, bad.slice(0, 20));
assert.equal(cleanScanFields({ name: "n", glb_key: GLB, size: -5 }).fields.size, 0);
assert.equal(cleanScanFields({ name: "n", glb_key: GLB, size: "abc" }).fields.size, 0);
assert.equal(cleanScanFields({ name: "n", glb_key: GLB, size: 10 ** 12 }).fields.size, 0);
assert.equal(cleanScanFields({ name: "n", glb_key: GLB, size: "2048" }).fields.size, 2048);

// ---- edit: only what was sent is looked at ----
assert.deepEqual(cleanScanFields({ camera_orbit: "10deg 80deg 2m" }, { partial: true }), { fields: { camera_orbit: "10deg 80deg 2m" } });
assert.deepEqual(cleanScanFields({}, { partial: true }), { fields: {} });
assert.deepEqual(cleanScanFields({ name: " New " }, { partial: true }).fields, { name: "New" });
assert.match(cleanScanFields({ name: "  " }, { partial: true }).error, /Name is required/);
assert.match(cleanScanFields({ glb_key: null }, { partial: true }).error, /needs its model/);
assert.match(cleanScanFields({ glb_key: "uploads/x.png" }, { partial: true }).error, /scan uploader/);
assert.deepEqual(cleanScanFields({ usdz_key: null }, { partial: true }), { fields: { usdz_key: null } }, "the iOS file can be removed");

// A scan saved before these rules existed keeps working: its own current keys pass through unchanged, a different odd key does not.
const legacy = { glb_key: "scans/1699999999-old.glb", usdz_key: "scans/old.usdz" };
assert.deepEqual(cleanScanFields({ name: "Old", glb_key: legacy.glb_key, usdz_key: legacy.usdz_key, camera_orbit: "0deg 75deg 105%" }, { partial: true, keep: legacy }).fields, { name: "Old", glb_key: legacy.glb_key, usdz_key: legacy.usdz_key, camera_orbit: "0deg 75deg 105%" });
assert.ok(cleanScanFields({ glb_key: "scans/other-odd.glb" }, { partial: true, keep: legacy }).error, "a different odd key is still refused");
assert.ok(cleanScanFields({ glb_key: legacy.glb_key }, { partial: true }).error, "and without a current key to match, the shape rule applies");
assert.equal(cleanScanFields({ glb_key: GLB }, { partial: true, keep: legacy }).fields.glb_key, GLB, "a proper new key is fine");

console.log("ALL PASS");
