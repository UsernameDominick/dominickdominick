// The Features board: what has been built and what is still open (features.json, kept up to date with each change) plus the owner's own
// requests (one settings row each, "feature_request:<id>"). Pure (no database access), so a node test can load it.
export const FEATURE_STATUSES = ["done", "doing", "planned", "decision", "parked"];
export const REQUEST_STATUSES = ["requested", "done", "dropped"];
export const REQUEST_PREFIX = "feature_request:";
export const REQUEST_MAX = 100;
export const REQUEST_TITLE_MAX = 120;
export const REQUEST_NOTES_MAX = 1000;

export const requestKey = (id) => `${REQUEST_PREFIX}${id}`;
export const isRequestId = (id) => /^[a-f0-9]{12}$/.test(String(id));

const oneLine = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

// A new request from the board's form. Returns { ok: true, value } or { ok: false, error }.
export function cleanRequest(body, { partial = false } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const out = {};
  if (!partial || "title" in b) {
    const title = oneLine(b.title);
    if (!title) return { ok: false, error: "A request needs a title." };
    if (title.length > REQUEST_TITLE_MAX) return { ok: false, error: `Titles are limited to ${REQUEST_TITLE_MAX} characters.` };
    out.title = title;
  }
  if (!partial || "notes" in b) {
    const notes = String(b.notes == null ? "" : b.notes).replace(/\r\n?/g, "\n").trim();
    if (notes.length > REQUEST_NOTES_MAX) return { ok: false, error: `Notes are limited to ${REQUEST_NOTES_MAX} characters.` };
    out.notes = notes;
  }
  if ("status" in b || !partial) {
    const status = b.status === undefined ? "requested" : b.status;
    if (!REQUEST_STATUSES.includes(status)) return { ok: false, error: `Status must be one of ${REQUEST_STATUSES.join(", ")}.` };
    out.status = status;
  }
  return { ok: true, value: out };
}

export function readRequestRow(row) {
  if (!row || !String(row.key || "").startsWith(REQUEST_PREFIX)) return null;
  try {
    const v = JSON.parse(row.value);
    if (!v || typeof v.title !== "string") return null;
    return {
      id: row.key.slice(REQUEST_PREFIX.length),
      title: v.title,
      notes: typeof v.notes === "string" ? v.notes : "",
      status: REQUEST_STATUSES.includes(v.status) ? v.status : "requested",
      created_at: typeof v.created_at === "string" ? v.created_at : null,
    };
  } catch {
    return null;
  }
}

// Problems with a features.json document, as a list of plain sentences (empty when it is fine). Used by the node test.
export function checkFeatures(doc) {
  const problems = [];
  if (!doc || !Array.isArray(doc.items)) return ["features.json needs an items list"];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(doc.updated || ""))) problems.push("updated must be a date like 2026-10-03");
  const seen = new Set();
  for (const it of doc.items) {
    const where = `"${it && it.title}"`;
    if (!it || typeof it !== "object") {
      problems.push("an item is not an object");
      continue;
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(it.id || ""))) problems.push(`${where}: id must be lowercase words joined by dashes`);
    if (seen.has(it.id)) problems.push(`${where}: duplicate id ${it.id}`);
    seen.add(it.id);
    if (!oneLine(it.title)) problems.push(`${where}: missing title`);
    if (!oneLine(it.area)) problems.push(`${where}: missing area`);
    if (!FEATURE_STATUSES.includes(it.status)) problems.push(`${where}: status must be one of ${FEATURE_STATUSES.join(", ")}`);
    for (const k of ["summary", "notes"]) if (it[k] !== undefined && typeof it[k] !== "string") problems.push(`${where}: ${k} must be text`);
    if (it.status === "decision" && !oneLine(it.notes)) problems.push(`${where}: an item waiting on a decision should say what the decision is (notes)`);
  }
  return problems;
}

export function countByStatus(items) {
  const counts = Object.fromEntries(FEATURE_STATUSES.map((s) => [s, 0]));
  for (const it of items) if (it.status in counts) counts[it.status]++;
  return counts;
}
