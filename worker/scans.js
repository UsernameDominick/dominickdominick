// What a 3D scan record may hold. The model files belong to one scan alone (deleting or replacing the scan deletes them from storage),
// so a key has to be exactly the shape /scan-upload hands out: anything else could point a delete at somebody else's file.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const GLB_KEY = new RegExp(`^scans/${UUID}\\.(?:glb|gltf)$`);
const USDZ_KEY = new RegExp(`^scans/${UUID}\\.usdz$`);
const MAX_NAME = 200;
const MAX_POSTER = 500;
const MAX_CAMERA = 80;
const MAX_SIZE = 200 * 1024 * 1024;

export const isScanGlbKey = (v) => typeof v === "string" && GLB_KEY.test(v);
export const isScanUsdzKey = (v) => typeof v === "string" && USDZ_KEY.test(v);

const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const CONTROL = /[\u0000-\u001f\u007f]/;

// model-viewer attributes such as "0deg 75deg 105%", "auto auto auto", "2m 1.5m 0m", "30deg".
const CAMERA = /^[-+0-9a-z.%\s]*$/i;

// Cleans the fields a create or an edit may carry. Returns { fields } holding only known keys in their cleaned form, or { error }.
// With partial (an edit), only the keys that were sent are looked at; without it, the name and the model file are required.
// keep holds the scan's current keys: sending one back unchanged is always fine, so a scan saved before these rules existed can still
// be edited (the editor sends the model keys along with every save).
export function cleanScanFields(body, { partial = false, keep = {} } = {}) {
  const src = body && typeof body === "object" ? body : {};
  const fields = {};
  if (!partial || "name" in src) {
    const name = typeof src.name === "string" ? src.name.trim() : "";
    if (!name) return { error: partial ? "Name is required" : "Name and a GLB/GLTF file are required" };
    if (name.length > MAX_NAME || CONTROL.test(name)) return { error: `The name must be under ${MAX_NAME} characters, on one line` };
    fields.name = name;
  }
  if (!partial || "glb_key" in src) {
    if (blank(src.glb_key)) return { error: partial ? "A scan needs its model file" : "Name and a GLB/GLTF file are required" };
    if (src.glb_key !== keep.glb_key && !isScanGlbKey(src.glb_key)) return { error: "The model file must be one uploaded with the scan uploader (.glb or .gltf)" };
    fields.glb_key = src.glb_key;
  }
  if ("usdz_key" in src) {
    if (blank(src.usdz_key)) fields.usdz_key = null;
    else if (src.usdz_key !== keep.usdz_key && !isScanUsdzKey(src.usdz_key)) return { error: "The iOS model must be one uploaded with the scan uploader (.usdz)" };
    else fields.usdz_key = src.usdz_key;
  }
  if ("poster_key" in src) {
    if (blank(src.poster_key)) fields.poster_key = null;
    else {
      const p = String(src.poster_key).trim();
      const okShape = (/^\/(?!\/)/.test(p) || /^https?:\/\/[^\s/]+/i.test(p) || /^uploads\//.test(p)) && !/\s/.test(p) && !CONTROL.test(p);
      if (typeof src.poster_key !== "string" || p.length > MAX_POSTER || !okShape) return { error: "The poster must be a path on the site, an uploaded file or an https:// address" };
      fields.poster_key = p;
    }
  }
  for (const key of ["camera_orbit", "camera_target", "field_of_view"]) {
    if (!(key in src)) continue;
    if (blank(src[key])) fields[key] = null;
    else {
      const v = String(src[key]).trim();
      if (v.length > MAX_CAMERA || !CAMERA.test(v)) return { error: `That ${key.replace(/_/g, " ")} is not a valid camera setting` };
      fields[key] = v;
    }
  }
  if ("size" in src) {
    const n = Number(src.size);
    if (src.size === null || src.size === "" || !Number.isFinite(n) || n < 0 || n > MAX_SIZE) fields.size = 0;
    else fields.size = Math.round(n);
  }
  return { fields };
}
