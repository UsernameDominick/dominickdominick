// Site search: how a query is broken into terms, the SQL built from them, and the results page (highlighting, snippets, sort links).
import assert from "node:assert/strict";
import { parseSearchTerms, searchSql, likePattern, escapeLikeText, MAX_SEARCH_TERMS } from "../worker/searchterms.js";
import { renderSearchResultsHtml } from "../worker/render.js";

// ---- terms ----
assert.deepEqual(parseSearchTerms("led resistor"), ["led", "resistor"]);
assert.deepEqual(parseSearchTerms("  led   resistor  "), ["led", "resistor"]);
assert.deepEqual(parseSearchTerms('"current limiting" led'), ["current limiting", "led"]);
assert.deepEqual(parseSearchTerms("“smart quotes” work"), ["smart quotes", "work"]);
assert.deepEqual(parseSearchTerms("Led LED led"), ["Led"], "duplicates ignoring case collapse");
assert.deepEqual(parseSearchTerms("C++ tips"), ["C++", "tips"]);
assert.deepEqual(parseSearchTerms(""), []);
assert.deepEqual(parseSearchTerms('""'), []);
assert.deepEqual(parseSearchTerms(null), []);
assert.equal(parseSearchTerms("a b c d e f g h i j").length, MAX_SEARCH_TERMS);
assert.deepEqual(parseSearchTerms("100% sure_thing"), ["100%", "sure_thing"]);

// The database refuses LIKE patterns over 50 bytes (the % signs and escapes count): every term is clipped to fit.
for (const q of ["x".repeat(200), "é".repeat(60), "%".repeat(60), "_".repeat(30), "日本語".repeat(20)]) {
  for (const t of parseSearchTerms(q)) assert.ok(new TextEncoder().encode(likePattern(t)).length <= 50, `${q.slice(0, 6)}… ${new TextEncoder().encode(likePattern(t)).length}`);
}
assert.equal(likePattern("100%_x"), "%100\\%\\_x%");
assert.equal(escapeLikeText("a\\b"), "a\\\\b");

// ---- SQL ----
const terms = ["led", "current limiting"];
const sql = searchSql(terms, { title: 4, tags: 2, body: 1 });
assert.equal((sql.where.match(/\?/g) || []).length, sql.whereBinds.length, "one value per placeholder (match)");
assert.equal((sql.score.match(/\?/g) || []).length, sql.scoreBinds.length, "one value per placeholder (score)");
assert.equal(sql.whereBinds.length, 2 * 3);
assert.match(sql.where, /^\(title LIKE \? ESCAPE '\\' OR tags LIKE \? ESCAPE '\\' OR body LIKE \? ESCAPE '\\'\) AND \(/, "every term must be found somewhere");
assert.match(sql.score, /CASE WHEN title LIKE \? ESCAPE '\\' THEN 4 ELSE 0 END/);
assert.ok(sql.scoreBinds.includes("%led current limiting%"), "the whole query as a phrase earns a bonus");
const single = searchSql(["led"], { title: 4, body: 1 });
assert.equal(single.scoreBinds.length, 2, "no phrase bonus for one term");
// Even the largest query stays under D1's 100 bound-value limit per statement.
const biggest = searchSql(Array.from({ length: MAX_SEARCH_TERMS }, (_, i) => `t${i}`), { title: 4, summary: 2, tags: 2, body: 1 });
assert.ok(biggest.whereBinds.length * 2 + 4 < 100, `${biggest.whereBinds.length * 2 + 4}`);

// ---- results page ----
const articles = [
  { slug: "one", title: "LED and a Resistor", body: "A long introduction. ".repeat(10) + "The resistor limits the current through the LED so it does not burn out. " + "More words follow here. ".repeat(10) },
  { slug: "two", title: "Nothing in the title", body: "Short body about a resistor." },
  { slug: "xss", title: "<img src=x onerror=alert(1)> resistor", body: "<script>alert(1)</script> resistor & more" },
];
const html = renderSearchResultsHtml("led resistor", [{ slug: "about", title: "About the LED", meta_description: "A resistor story" }], articles, [{ slug: "p", title: "Project", summary: "no match here", body: "buried: the resistor and the led live deep in the body text of this project." }], "", { terms: ["led", "resistor"], totalCount: 5 });
assert.match(html, /<a href="\/random\/one"><mark>LED<\/mark> and a <mark>Resistor<\/mark><\/a>/, "title words are highlighted, in their original case");
assert.match(html, /<mark>resistor<\/mark> limits the current through the <mark>LED<\/mark>/, "the snippet is taken from where the words are");
assert.match(html, /<p>…[^<]*<mark>resistor<\/mark>/, "and says it was cut at the front");
assert.match(html, /<a href="\/projects\/p">Project<\/a><p>[^<]*buried: the <mark>resistor<\/mark> and the <mark>led<\/mark> live deep/, "a project whose summary lacks the words shows the body where they are");
assert.match(html, /<a href="\/about">About the <mark>LED<\/mark><\/a><p>A <mark>resistor<\/mark> story<\/p>/, "pages too");
assert.doesNotMatch(html, /<img |<script>/, "result text is escaped");
assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; <mark>resistor<\/mark>/);
assert.match(html, /<mark>resistor<\/mark> &amp; more/);
// terms with regex characters are highlighted literally
assert.match(renderSearchResultsHtml("c++ (x)", [], [{ slug: "c", title: "Notes on C++ (x) things", body: "b" }], [], "", { terms: ["c++", "(x)"], totalCount: 1 }), /Notes on <mark>C\+\+<\/mark> <mark>\(x\)<\/mark> things/);
// sort links: Best match is the default and carries no sort parameter; the others do
assert.match(html, /<a href="\/search\?q=led%20resistor" class="is-active" aria-current="true">Best match<\/a>/);
assert.match(html, /<a href="\/search\?q=led%20resistor&sort=newest">Newest first<\/a>/);
assert.match(html, /<a href="\/search\?q=led%20resistor&sort=oldest">Oldest first<\/a>/);
const newest = renderSearchResultsHtml("led", [], articles.slice(0, 1), [], "", { sort: "newest", terms: ["led"], totalCount: 1 });
assert.match(newest, /<a href="\/search\?q=led&sort=newest" class="is-active" aria-current="true">Newest first<\/a>/);
assert.match(newest, /<a href="\/search\?q=led">Best match<\/a>/);
// nothing found: a hint for several words, none for one
assert.match(renderSearchResultsHtml("led zzz", [], [], [], "", { terms: ["led", "zzz"], totalCount: 0 }), /Every word has to appear/);
assert.doesNotMatch(renderSearchResultsHtml("zzz", [], [], [], "", { terms: ["zzz"], totalCount: 0 }), /Every word has to appear/);
// no terms passed (an older caller): plain, unhighlighted results
assert.doesNotMatch(renderSearchResultsHtml("led", [], articles.slice(0, 1), [], "", { totalCount: 1 }), /<mark>/);

console.log("ALL PASS");
