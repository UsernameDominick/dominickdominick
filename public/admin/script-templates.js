// Starter scripts for the Scripts window: each one is a working example of the `site` helpers, and most are safe to run as a
// preview straight away. Plain data so a node test can check that every one of them at least parses.
(function () {
  const TEMPLATES = [
    {
      id: "blank",
      name: "Blank script",
      description: "An empty script with the basics in comments.",
      code: `// Everything here runs in a sandbox. site.* talks to your admin, console.log prints below.
// A preview run only records what would change; Apply makes the changes for real.

const articles = await site.articles.list();
console.log(\`\${articles.length} articles\`);
`,
    },
    {
      id: "inventory",
      name: "Site inventory",
      description: "Counts of everything, plus the longest articles. Read-only.",
      code: `const [articles, projects, pages, redirects, songs, sims] = await Promise.all([
  site.articles.list(),
  site.projects.list(),
  site.pages.list(),
  site.redirects.list(),
  site.songs.list(),
  site.simulations.list(),
]);
const words = (t) => (String(t || "").match(/\\S+/g) || []).length;

console.log({ articles: articles.length, projects: projects.length, pages: pages.length, redirects: redirects.length, songs: songs.length, simulations: sims.length });

const longest = articles
  .map((a) => ({ title: a.title, words: words(a.body) }))
  .sort((a, b) => b.words - a.words)
  .slice(0, 5);
console.log("Longest articles:", longest);
`,
    },
    {
      id: "missing-share-image",
      name: "Articles without a share image",
      description: "Lists published articles that have no share image. Read-only.",
      code: `const articles = await site.articles.list();
const missing = articles.filter((a) => a.published_at && !a.og_image);
console.log(\`\${missing.length} published articles have no share image:\`);
for (const a of missing) console.log(\`  /random/\${a.slug}  \${a.title}\`);
`,
    },
    {
      id: "long-titles",
      name: "Titles search results will cut off",
      description: "Titles over 49 characters (the site name is added to the end). Read-only.",
      code: `const LIMIT = 49;
const articles = await site.articles.list();
const long = articles.filter((a) => a.title.length > LIMIT);
console.log(\`\${long.length} of \${articles.length} titles are over \${LIMIT} characters:\`);
for (const a of long) console.log(\`  \${a.title.length}  \${a.title}\`);
`,
    },
    {
      id: "tag-by-word",
      name: "Tag articles that mention a word",
      description: "Adds a tag to every article whose title or text contains a word.",
      code: `const WORD = "arduino";   // what to look for (not case sensitive)
const TAG = "arduino";    // the tag to add

const articles = await site.articles.list();
const matches = articles.filter((a) => (a.title + " " + a.body).toLowerCase().includes(WORD) && !a.tags.includes(TAG));
console.log(\`\${matches.length} articles mention "\${WORD}" and don't have the tag yet.\`);

await site.each(matches, async (a) => {
  await site.articles.update(a.id, { tags: [...a.tags, TAG] });
  console.log("tagged:", a.title);
});
`,
    },
    {
      id: "rename-tag",
      name: "Rename a tag everywhere",
      description: "Changes one tag to another on every article.",
      code: `const FROM = "old-tag";
const TO = "new-tag";

const articles = await site.articles.list();
const hits = articles.filter((a) => a.tags.includes(FROM));
console.log(\`\${hits.length} articles use "\${FROM}".\`);

await site.each(hits, async (a) => {
  const tags = [...new Set(a.tags.map((t) => (t === FROM ? TO : t)))];
  await site.articles.update(a.id, { tags });
});
`,
    },
    {
      id: "draft-articles",
      name: "Make several draft articles",
      description: "Creates an unpublished article for each title in a list.",
      code: `const titles = [
  "First idea",
  "Second idea",
  "Third idea",
];

for (const title of titles) {
  const made = await site.articles.create({ title, body: "", tags: ["idea"] });
  console.log("created:", title, "->", made.slug);
}
`,
    },
    {
      id: "redirects-from-list",
      name: "Add redirects from a list",
      description: "One line per redirect: old path, then new path.",
      code: `const lines = \`
/old-page /new-page
/old-post /random/new-post
\`.trim().split("\\n");

for (const line of lines) {
  const [from_path, to_path] = line.trim().split(/\\s+/);
  if (!from_path || !to_path) continue;
  try {
    await site.redirects.create({ from_path, to_path, status_code: 301 });
    console.log("added:", from_path, "->", to_path);
  } catch (err) {
    console.warn("skipped", from_path, "-", err.message);
  }
}
`,
    },
    {
      id: "find-missing-alt",
      name: "Pictures without descriptions",
      description: "Finds article pictures that have empty alt text. Read-only.",
      code: `const articles = await site.articles.list();
let total = 0;
for (const a of articles) {
  const bad = a.body.split(/\\r?\\n/).filter((l) => /^!\\[\\s*\\]\\(/.test(l.trim()));
  if (!bad.length) continue;
  total += bad.length;
  console.log(\`\${a.title}: \${bad.length}\`);
}
console.log(\`\${total} pictures without a description.\`);
`,
    },
  ];

  const api = { TEMPLATES };
  if (typeof window !== "undefined") window.ScriptTemplates = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
