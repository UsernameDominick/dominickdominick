// sitemap.xml: which addresses are listed and when each last changed. Pure (no database, no Response) so a node test can feed it fixtures.

// "2026-10-02" from a stored timestamp ("2026-10-02 08:30:00", "2026-10-02T08:30", "2026-10-02T08:30:00.000Z"), or null when the
// value is missing or not a date (a damaged row must never take the whole sitemap down).
export function sitemapDate(value) {
  if (value === null || value === undefined || value === "") return null;
  let text = String(value).trim();
  if (!/[zZ]$|[+-]\d\d:?\d\d$/.test(text)) text = `${text.replace(" ", "T")}Z`;
  const t = Date.parse(text);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

// The most recent of several dates (as sitemapDate strings), or null when there are none.
function latestOf(dates) {
  const real = dates.map(sitemapDate).filter(Boolean);
  return real.length ? real.reduce((a, b) => (b > a ? b : a)) : null;
}

// A topic page that lists a single thing and says nothing of its own repeats that thing's page, so it is kept out of search results and
// out of the sitemap. One the owner has written an introduction for is real content and stays in.
export const THIN_TOPIC_ITEMS = 2;
export function topicIsThin({ count, description }) {
  if (typeof description === "string" && description.trim()) return false;
  return Number.isFinite(count) && count < THIN_TOPIC_ITEMS;
}

const changedAt = (item) => item.updated_at || item.published_at || item.created_at || null;

// Everything the sitemap lists, once each. The index pages take the date of the newest thing they list (a reader's search engine then
// knows when to look again), a topic page the newest thing carrying that tag, and a circuit its own last change.
// data: { pages, articles, projects, simulations: [{ id, updated_at }], tagCounts: [{ tag, count?, description? }] }; options.isInSitemap(item, type).
export function buildSitemapEntries(data, { isInSitemap, reservedSlugs }) {
  const pages = data.pages || [];
  const articles = data.articles || [];
  const projects = data.projects || [];
  const sims = data.simulations || [];
  const tags = data.tagCounts || [];
  const articleDates = articles.map(changedAt);
  const projectDates = projects.map(changedAt);
  const tagged = (tag) => [...articles, ...projects].filter((i) => Array.isArray(i.tags) && i.tags.includes(tag)).map(changedAt);
  const entries = [
    // isInSitemap() is shared with the SEO report's canonical check, so what counts as "excluded from the sitemap" can't drift.
    ...pages.filter((p) => isInSitemap(p, "page") && !reservedSlugs.has(p.slug)).map((p) => ({ loc: p.slug === "home" ? "/" : `/${p.slug}`, lastmod: sitemapDate(p.updated_at) })),
    ...articles.filter((a) => isInSitemap(a, "article")).map((a) => ({ loc: `/random/${a.slug}`, lastmod: sitemapDate(changedAt(a)) })),
    ...projects.filter((p) => isInSitemap(p, "project")).map((p) => ({ loc: `/projects/${p.slug}`, lastmod: sitemapDate(changedAt(p)) })),
    ...sims.map((s) => ({ loc: `/simulation/${s.id}`, lastmod: sitemapDate(s.updated_at) })),
    { loc: "/topics", lastmod: latestOf([...articleDates, ...projectDates]) },
    { loc: "/archive", lastmod: latestOf([...articleDates, ...projectDates]) },
    { loc: "/random", lastmod: latestOf(articleDates) },
    { loc: "/projects", lastmod: latestOf(projectDates) },
    { loc: "/studio" },
    ...tags.filter((t) => !topicIsThin(t)).map((t) => ({ loc: `/topics/${encodeURIComponent(t.tag)}`, lastmod: latestOf(tagged(t.tag)) })),
  ];
  // Each address once: /projects and /random were listed twice (as a page and as a built-in index), which search engines read as noise.
  const seen = new Set();
  return entries.filter((e) => !seen.has(e.loc) && seen.add(e.loc));
}

export function sitemapXml(entries, origin = "https://dominickdominick.com") {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map((e) => `  <url><loc>${esc(origin + e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`)
    .join("\n")}\n</urlset>`;
}
