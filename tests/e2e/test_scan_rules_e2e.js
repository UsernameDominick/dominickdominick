const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { request } = require("./_pw.cjs");
const { uploadGlb } = require("./scanfix.js");
const BASE = (E2E_BASE);
let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const api = (m, p, data) => c.fetch(BASE + "/api/admin" + p, { method: m, data });
  const made = [];
  try {
    let r = await api("POST", "/scans", { name: "QQ scan none", glb_key: "uploads/photo.png" });
    ok(r.status() === 400 && /scan uploader/.test((await r.json()).error), "a media-library key is refused as a model file", r.status());
    r = await api("POST", "/scans", { name: "QQ scan ghost", glb_key: "scans/0b6f3a52-1c3e-4d0a-9a77-2f1e5c9d8a10.glb" });
    ok(r.status() === 400 && /not found/.test((await r.json()).error), "a well-formed key that was never uploaded is refused", r.status());
    const key = await uploadGlb();
    r = await api("POST", "/scans", { name: "  QQ scan one  ", glb_key: key, camera_orbit: "0deg 75deg 105%", extra: "ignored" });
    const one = await r.json();
    ok(r.status() === 200 && one.id, "an uploaded model makes a scan", one);
    made.push(one.id);
    let got = await (await api("GET", "/scans/" + one.id)).json();
    ok(got.name === "QQ scan one" && got.glb_key === key && got.camera_orbit === "0deg 75deg 105%", "the name is trimmed and the fields are stored", got);
    r = await api("POST", "/scans", { name: "QQ scan two", glb_key: key });
    ok(r.status() === 400 && /another scan/.test((await r.json()).error), "the same file cannot back two scans", r.status());
    r = await api("PATCH", "/scans/" + one.id, { name: "QQ scan one", glb_key: key, camera_orbit: "10deg 80deg 2m" });
    ok(r.status() === 200, "saving a scan with its own key unchanged works", r.status());
    r = await api("PATCH", "/scans/" + one.id, { glb_key: "uploads/photo.png" });
    ok(r.status() === 400, "swapping in a media-library key is refused", r.status());
    r = await api("PATCH", "/scans/" + one.id, { poster_key: "javascript:alert(1)" });
    ok(r.status() === 400, "a javascript: poster is refused", r.status());
    r = await api("PATCH", "/scans/" + one.id, { camera_orbit: '0deg" onload="x' });
    ok(r.status() === 400, "a camera setting with quotes is refused", r.status());
    r = await api("PATCH", "/scans/" + one.id, { name: "   " });
    ok(r.status() === 400, "a blank name is refused", r.status());
    // Replacing the model deletes the old one from storage and keeps the scan.
    const key2 = await uploadGlb();
    r = await api("PATCH", "/scans/" + one.id, { glb_key: key2 });
    ok(r.status() === 200, "swapping in a newly uploaded model works", r.status());
    const oldFile = await c.fetch(BASE + "/media/" + key);
    const newFile = await c.fetch(BASE + "/media/" + key2);
    ok(oldFile.status() === 404 && newFile.status() === 200, "the old file is gone, the new one is served", [oldFile.status(), newFile.status()]);
    // usdz
    const usdzRes = await fetch(BASE + "/api/admin/scan-upload?kind=usdz", { method: "POST", headers: { Cookie: `session=${(await c.storageState()).cookies[0].value}`, "Content-Type": "application/octet-stream" }, body: Buffer.from("usdz-qq") });
    const usdz = await usdzRes.json();
    r = await api("PATCH", "/scans/" + one.id, { usdz_key: usdz.key });
    ok(r.status() === 200, "an uploaded .usdz can be added", r.status());
    r = await api("PATCH", "/scans/" + one.id, { usdz_key: key2 });
    ok(r.status() === 400, "a .glb is not accepted as the iOS file", r.status());
    r = await api("PATCH", "/scans/" + one.id, { usdz_key: null });
    ok(r.status() === 200, "the iOS file can be removed", r.status());
    got = await (await api("GET", "/scans/" + one.id)).json();
    ok(got.usdz_key === null && got.glb_key === key2, "and the scan is as expected", got);
  } finally {
    for (const id of made) await api("DELETE", "/scans/" + id);
  }
  console.log(f ? "FAILED " + f : "ALL PASS");
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
