// sitemap.xml: every address once, each with the date it last changed.
import { buildSitemapEntries, sitemapXml, sitemapDate, topicIsThin } from "../worker/sitemap.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

// dates
ok(sitemapDate("2026-10-02 08:30:00") === "2026-10-02" && sitemapDate("2026-10-02T08:30") === "2026-10-02" && sitemapDate("2026-10-02T08:30:00.000Z") === "2026-10-02" && sitemapDate("2026-10-02T23:30:00-05:00") === "2026-10-03", "every stored timestamp shape reads as a date (an offset is honoured)", [sitemapDate("2026-10-02T23:30:00-05:00")]);
ok(sitemapDate(null) === null && sitemapDate("") === null && sitemapDate("not a date") === null && sitemapDate(undefined) === null && sitemapDate({}) === null, "a missing or damaged value is no date, never an exception");

const reserved = new Set(["random", "projects", "archive", "topics"]);
const isIn = (item, type) => !item.sitemap_exclude && !(type === "page" && item.password_hash);
const data = {
  pages: [
    { slug: "home", updated_at: "2026-01-05 10:00:00" },
    { slug: "about", updated_at: "2026-02-01 10:00:00" },
    { slug: "secret", updated_at: "2026-02-01 10:00:00", password_hash: "x" },
    { slug: "hidden", updated_at: "2026-02-01 10:00:00", sitemap_exclude: 1 },
    { slug: "random", updated_at: "2026-03-01 10:00:00" }, // a reserved name: only the built-in index is listed
  ],
  articles: [
    { slug: "a1", updated_at: "2026-04-01 09:00:00", published_at: "2026-03-01T09:00", tags: ["x", "y"] },
    { slug: "a2", updated_at: null, published_at: "2026-05-10T09:00:00.000Z", tags: ["y"] },
    { slug: "a3", updated_at: "garbage", published_at: "2026-02-02", tags: [], sitemap_exclude: 1 },
  ],
  projects: [{ slug: "p1", updated_at: "2026-06-15 12:00:00", published_at: "2026-06-01T12:00", tags: ["x", "z"] }],
  simulations: [{ id: 7, updated_at: "2026-07-04 07:00:00" }, { id: 9, updated_at: null }],
  tagCounts: [{ tag: "x" }, { tag: "y" }, { tag: "z" }, { tag: "has space & more" }],
};
const entries = buildSitemapEntries(data, { isInSitemap: isIn, reservedSlugs: reserved });
const by = Object.fromEntries(entries.map((e) => [e.loc, e.lastmod]));

ok(by["/"] === "2026-01-05" && by["/about"] === "2026-02-01", "pages use their own change date");
ok(!("/secret" in by) && !("/hidden" in by), "a password-protected page and an excluded page are left out");
ok(by["/random/a1"] === "2026-04-01" && by["/random/a2"] === "2026-05-10", "an article uses its edit date, or its publish date when never edited", [by["/random/a1"], by["/random/a2"]]);
ok(!("/random/a3" in by), "an excluded article is left out");
ok(by["/projects/p1"] === "2026-06-15", "a project uses its edit date");
ok(by["/simulation/7"] === "2026-07-04" && by["/simulation/9"] === null, "a circuit has its own date, or none when unknown", [by["/simulation/7"], by["/simulation/9"]]);
ok(by["/random"] === "2026-05-10" && by["/projects"] === "2026-06-15", "the Articles and Projects indexes take the date of their newest item (a page that happens to be named 'random' does not replace the index)", [by["/random"], by["/projects"]]);
ok(by["/archive"] === "2026-06-15" && by["/topics"] === "2026-06-15", "Archive and Topics take the newest date of everything");
ok(by["/topics/x"] === "2026-06-15" && by["/topics/y"] === "2026-05-10" && by["/topics/z"] === "2026-06-15", "a topic page takes the newest item carrying that tag", [by["/topics/x"], by["/topics/y"], by["/topics/z"]]);
ok(by["/topics/has%20space%20%26%20more"] === null, "a tag nothing carries has no date, and is percent-encoded in the address", Object.keys(by).filter((k) => k.startsWith("/topics/h")));
ok(new Set(entries.map((e) => e.loc)).size === entries.length, "every address appears once");

// thin topic pages: one item and no introduction of its own is left out, a written introduction or a second item keeps it in
{
  ok(topicIsThin({ count: 1, description: "" }) && topicIsThin({ count: 1 }) && topicIsThin({ count: 1, description: "   " }), "a topic with one item and no introduction is thin");
  ok(!topicIsThin({ count: 2, description: "" }) && !topicIsThin({ count: 9 }), "two or more items is enough");
  ok(!topicIsThin({ count: 1, description: "Notes on small CSS things." }), "an introduction the owner wrote makes a one-item topic real content");
  ok(!topicIsThin({ tag: "x" }) && !topicIsThin({ count: "1" }), "no usable count never hides a topic");
  const e = buildSitemapEntries({ tagCounts: [{ tag: "web", count: 5 }, { tag: "lone", count: 1 }, { tag: "lone-with-note", count: 1, description: "Hello" }] }, { isInSitemap: () => true, reservedSlugs: new Set() });
  const locs = e.map((x) => x.loc);
  ok(locs.includes("/topics/web") && locs.includes("/topics/lone-with-note") && !locs.includes("/topics/lone"), "the sitemap lists busy or introduced topics and skips the lone one", locs);
}

// damaged rows never throw
{
  let threw = null;
  try {
    buildSitemapEntries({ pages: [{ slug: "p", updated_at: "💥" }], articles: [{ slug: "a", updated_at: {}, published_at: 5, tags: "oops" }], projects: [{ slug: "q" }], simulations: [{ id: 1, updated_at: [] }], tagCounts: [{ tag: "t" }] }, { isInSitemap: isIn, reservedSlugs: reserved });
    buildSitemapEntries({}, { isInSitemap: isIn, reservedSlugs: reserved });
  } catch (e) { threw = e.message; }
  ok(threw === null, "odd or missing data never throws", threw);
}

// the XML
{
  const xml = sitemapXml(entries);
  ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && xml.includes("<urlset") && xml.endsWith("</urlset>"), "well-formed wrapper");
  ok(xml.includes("<url><loc>https://dominickdominick.com/random/a1</loc><lastmod>2026-04-01</lastmod></url>"), "an entry with its date");
  ok(xml.includes("<url><loc>https://dominickdominick.com/simulation/9</loc></url>"), "an entry without a date has no lastmod element");
  ok((xml.match(/<lastmod>/g) || []).length === entries.filter((e) => e.lastmod).length, "one lastmod per dated entry");
  ok(!/&(?!amp;|lt;|gt;)/.test(sitemapXml([{ loc: "/x?a=1&b=2", lastmod: null }])), "ampersands in an address are escaped");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
