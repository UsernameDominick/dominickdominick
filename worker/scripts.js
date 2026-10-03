// What a saved admin script may hold. Scripts live in the settings table (one row per script, "admin_script:<id>"), so they need no
// schema change and travel with the settings in a backup. Pure (no database access), so a node test can load it.
export const SCRIPT_PREFIX = "admin_script:";
export const SCRIPT_MAX = 40;
export const SCRIPT_CODE_MAX = 64 * 1024;
export const SCRIPT_NAME_MAX = 60;
export const SCRIPT_NOTE_MAX = 300;

export const scriptKey = (id) => `${SCRIPT_PREFIX}${id}`;
export const isScriptId = (id) => /^[a-f0-9]{12}$/.test(String(id));

export const GRAPH_MAX_NODES = 300;
export const GRAPH_MAX_WIRES = 1000;
export const GRAPH_MAX_BYTES = 128 * 1024;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

// The shape of a saved node graph (the Nodes editor). Only the shape is checked here (the compiler knows what the node types mean):
// bounded counts and sizes, plain values, ids that are safe to use in generated variable names. Returns { ok: true, value } or { ok: false, error }.
export function cleanGraph(raw) {
  const bad = (error) => ({ ok: false, error });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("The node graph is not valid.");
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.wires)) return bad("The node graph needs nodes and wires.");
  if (raw.nodes.length > GRAPH_MAX_NODES) return bad(`A graph can have up to ${GRAPH_MAX_NODES} nodes.`);
  if (raw.wires.length > GRAPH_MAX_WIRES) return bad(`A graph can have up to ${GRAPH_MAX_WIRES} wires.`);
  const num = (v) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 100000 ? Math.round(v) : null);
  const plain = (o) => {
    if (o === undefined) return {};
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const entries = Object.entries(o);
    if (entries.length > 40) return null;
    const out = {};
    for (const [k, v] of entries) {
      if (!ID.test(k)) return null;
      if (typeof v === "string") {
        if (v.length > 20000) return null;
      } else if (typeof v === "number") {
        if (!Number.isFinite(v)) return null;
      } else if (typeof v !== "boolean") return null;
      out[k] = v;
    }
    return out;
  };
  const ids = new Set();
  const nodes = [];
  for (const n of raw.nodes) {
    if (!n || typeof n !== "object" || typeof n.id !== "string" || !ID.test(n.id) || ids.has(n.id)) return bad("A node has a missing or repeated id.");
    if (typeof n.type !== "string" || !/^[a-z0-9-]{1,40}$/.test(n.type)) return bad("A node has an invalid type.");
    const x = num(n.x);
    const y = num(n.y);
    if (x === null || y === null) return bad("A node has an invalid position.");
    const values = plain(n.values);
    const props = plain(n.props);
    if (!values || !props) return bad("A node has invalid values.");
    ids.add(n.id);
    nodes.push({ id: n.id, type: n.type, x, y, values, props });
  }
  const wires = [];
  for (const w of raw.wires) {
    if (!w || !w.from || !w.to || !ids.has(w.from.node) || !ids.has(w.to.node) || !ID.test(String(w.from.pin)) || !ID.test(String(w.to.pin))) return bad("A wire does not connect two nodes.");
    wires.push({ from: { node: w.from.node, pin: w.from.pin }, to: { node: w.to.node, pin: w.to.pin } });
  }
  let view = null;
  if (raw.view && typeof raw.view === "object") {
    const vx = num(raw.view.x);
    const vy = num(raw.view.y);
    const zoom = typeof raw.view.zoom === "number" && raw.view.zoom >= 0.25 && raw.view.zoom <= 2 ? raw.view.zoom : 1;
    if (vx !== null && vy !== null) view = { x: vx, y: vy, zoom };
  }
  const value = { version: 1, nodes, wires, view };
  if (new TextEncoder().encode(JSON.stringify(value)).length > GRAPH_MAX_BYTES) return bad(`That graph is too large to save (${GRAPH_MAX_BYTES / 1024} KB limit).`);
  return { ok: true, value };
}

// A body from the editor: { name, code, description?, graph? }. Returns { ok: true, value } or { ok: false, error }.
export function cleanScript(body) {
  const b = body && typeof body === "object" ? body : {};
  const name = String(b.name == null ? "" : b.name).replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "A script needs a name." };
  if (name.length > SCRIPT_NAME_MAX) return { ok: false, error: `Script names are limited to ${SCRIPT_NAME_MAX} characters.` };
  if (typeof b.code !== "string") return { ok: false, error: "A script needs some code." };
  // Counted in bytes: the settings row is what is limited, and a long run of non-Latin text is bigger than it looks.
  if (new TextEncoder().encode(b.code).length > SCRIPT_CODE_MAX) return { ok: false, error: `That script is too large to save (${SCRIPT_CODE_MAX / 1024} KB limit).` };
  const description = String(b.description == null ? "" : b.description).replace(/\s+/g, " ").trim();
  if (description.length > SCRIPT_NOTE_MAX) return { ok: false, error: `The description is limited to ${SCRIPT_NOTE_MAX} characters.` };
  const value = { name, code: b.code.replace(/\r\n?/g, "\n"), description };
  // A script made in the Nodes editor also keeps its graph (the code is what the graph compiles to).
  if (b.graph !== undefined && b.graph !== null) {
    const g = cleanGraph(b.graph);
    if (!g.ok) return g;
    value.graph = g.value;
  }
  return { ok: true, value };
}

// A stored row back into a list entry; null for a row that is not valid JSON or has lost its fields.
export function readScriptRow(row) {
  if (!row || !String(row.key || "").startsWith(SCRIPT_PREFIX)) return null;
  try {
    const v = JSON.parse(row.value);
    if (!v || typeof v.name !== "string" || typeof v.code !== "string") return null;
    const graph = v.graph && typeof v.graph === "object" && Array.isArray(v.graph.nodes) ? v.graph : null;
    return { id: row.key.slice(SCRIPT_PREFIX.length), name: v.name, code: v.code, description: typeof v.description === "string" ? v.description : "", graph, updated_at: typeof v.updated_at === "string" ? v.updated_at : null };
  } catch {
    return null;
  }
}
