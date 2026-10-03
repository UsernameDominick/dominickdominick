// The site name in the header and the three built-in nav links (Articles, Projects, Topics), which were fixed in the code and are now
// editable under Site settings > Header & footer. Pure, so the worker, the admin API and the tests share one set of rules.

// The built-in links, in the order they follow the owner's own nav pages. `slug` is where each one goes.
export const BUILTIN_NAV = [
  { slug: "random", label: "Articles" },
  { slug: "projects", label: "Projects" },
  { slug: "topics", label: "Topics" },
];

const clean = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

// The name shown at the top left. Blank means the default ("dominick.dominick").
export function cleanBrand(raw) {
  return clean(raw, 40);
}

// {slug: {label?, hidden?}} for the built-in links only; anything else (or an empty override) is dropped. "" when nothing is set.
export function cleanNavBuiltin(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }
  }
  const out = {};
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const item of BUILTIN_NAV) {
      const o = data[item.slug];
      if (!o || typeof o !== "object") continue;
      const label = clean(o.label, 40);
      const entry = {};
      if (label && label !== item.label) entry.label = label;
      if (o.hidden === true) entry.hidden = true;
      if (Object.keys(entry).length) out[item.slug] = entry;
    }
  }
  return Object.keys(out).length ? JSON.stringify(out) : "";
}

export function parseNavBuiltin(raw) {
  const cleaned = cleanNavBuiltin(raw);
  return cleaned ? JSON.parse(cleaned) : {};
}

// The built-in links as the nav shows them: renamed or left out as the owner chose. A built-in link is also skipped when one of the
// owner's own pages already stands in for it (`taken` is the set of slugs those pages use).
export function builtinNavItems(overrides, taken = new Set()) {
  const over = overrides || {};
  return BUILTIN_NAV.filter((item) => !taken.has(item.slug) && !(over[item.slug] && over[item.slug].hidden)).map((item) => ({
    slug: item.slug,
    nav_label: (over[item.slug] && over[item.slug].label) || item.label,
    nav_parent_id: null,
    children: [],
  }));
}
