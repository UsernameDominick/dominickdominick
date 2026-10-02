// What a visitor types into the search box, broken into the pieces the search matches against. Every term has to be found (in any
// order, in the title, tags or text), and a "quoted phrase" counts as one term. Pure helpers shared by the database query and the
// results page (which highlights the same terms).

export const MAX_SEARCH_TERMS = 6;
// The database refuses a LIKE pattern longer than 50 bytes, and the two % signs and any escapes count towards it.
const MAX_PATTERN_BYTES = 48;

export function escapeLikeText(s) {
  return String(s ?? "").replace(/[\\%_]/g, "\\$&");
}

const byteLength = (s) => new TextEncoder().encode(s).length;

// "%term%" for a LIKE ... ESCAPE '\' query, clipped so it always fits.
export function likePattern(term) {
  let t = String(term);
  while (t && byteLength(escapeLikeText(t)) + 2 > MAX_PATTERN_BYTES) t = t.slice(0, -1);
  return `%${escapeLikeText(t)}%`;
}

// The terms of a query: quoted phrases first, then the words, de-duplicated (ignoring case), at most MAX_SEARCH_TERMS, each short
// enough to be searched for.
export function parseSearchTerms(query) {
  let rest = String(query ?? "").replace(/\s+/g, " ").trim();
  const found = [];
  rest = rest.replace(/["“”]([^"“”]+)["“”]/g, (m, phrase) => {
    found.push(phrase.trim());
    return " ";
  });
  for (const word of rest.split(" ")) {
    const w = word.replace(/^["“”']+|["“”']+$/g, "");
    if (w) found.push(w);
  }
  const seen = new Set();
  const terms = [];
  for (let t of found) {
    while (t && byteLength(escapeLikeText(t)) + 2 > MAX_PATTERN_BYTES) t = t.slice(0, -1);
    t = t.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    terms.push(t);
    if (terms.length >= MAX_SEARCH_TERMS) break;
  }
  return terms;
}

// The SQL for "every term appears in at least one of these columns" and for a relevance score (a hit in the title counts most, then
// tags and summary, then the body; the whole query as an exact phrase earns a bonus), with the values to bind to each, in order.
export function searchSql(terms, weights, phraseBonus = true) {
  const columns = Object.keys(weights);
  const where = terms.map(() => `(${columns.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(" OR ")})`).join(" AND ");
  const whereBinds = terms.flatMap((t) => columns.map(() => likePattern(t)));
  const parts = [];
  const scoreBinds = [];
  for (const t of terms) {
    for (const c of columns) {
      parts.push(`CASE WHEN ${c} LIKE ? ESCAPE '\\' THEN ${weights[c]} ELSE 0 END`);
      scoreBinds.push(likePattern(t));
    }
  }
  if (phraseBonus && terms.length > 1) {
    const phrase = terms.join(" ");
    const [first, last] = [columns[0], columns[columns.length - 1]];
    parts.push(`CASE WHEN ${first} LIKE ? ESCAPE '\\' THEN 6 ELSE 0 END`, `CASE WHEN ${last} LIKE ? ESCAPE '\\' THEN 2 ELSE 0 END`);
    scoreBinds.push(likePattern(phrase), likePattern(phrase));
  }
  return { where, whereBinds, score: `(${parts.join(" + ")})`, scoreBinds };
}
