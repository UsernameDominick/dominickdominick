const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
// Scans need a model file that was really uploaded (the server checks): hands out a fresh one each call.
const fs = require("fs");
const val = JSON.parse(fs.readFileSync(process.env.ADMIN_STATE)).cookies[0].value;
exports.uploadGlb = async () => {
  const r = await fetch((E2E_BASE + "/api/admin/scan-upload?kind=glb"), { method: "POST", headers: { Cookie: `session=${val}`, "Content-Type": "application/octet-stream" }, body: Buffer.from("glTF-qq-fixture") });
  return (await r.json()).key;
};
