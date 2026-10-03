// The checklist shown before an article goes live: things that are easy to fix now and awkward to notice later. Nothing here blocks
// publishing; the editor lists what it found and lets the author publish anyway. Pure (no page access), so a node test can load it.
(function () {
  const TITLE_SUFFIX = 11; // " · Dominick" is added to an article's <title>, and search results cut a title off at about 60 characters
  const TITLE_MAX = 60;
  const TITLE_MIN = 10;
  const THIN_WORDS = 100;
  const LONG_WORDS = 500;

  const clean = (v) => String(v == null ? "" : v);
  const wordCount = (text) => (clean(text).trim().match(/\S+/g) || []).length;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // Picture lines are ![description](address "optional caption") on a line of their own (the same shape worker/pictures.js reads).
  function picturesWithoutDescription(body) {
    let n = 0;
    for (const line of clean(body).split(/\r?\n/)) {
      const m = /^!\[([^\]]*)\]\(\s*[^\s)]+(?:\s+"[^"]*")?\s*\)$/.exec(line.trim());
      if (m && !m[1].trim()) n++;
    }
    return n;
  }
  const hasHeadings = (body) => /^\s*#{2,3}\s+\S/m.test(clean(body));

  // article: { title, body, og_image, tags: [...], brokenLinks: [warning text, ...] }. Returns [{ id, level, text }] with the
  // things worth fixing ("fix") ahead of the nice-to-haves ("tip"); an empty list means nothing to flag.
  function check(article) {
    const a = article || {};
    const out = [];
    const title = clean(a.title).replace(/\s+/g, " ").trim();
    const length = title.length;
    if (length && length + TITLE_SUFFIX > TITLE_MAX) {
      out.push({ id: "title-long", level: "fix", text: `The title is ${plural(length, "character", "characters")}; with the site name added it goes over ${TITLE_MAX} and search results will cut it off.` });
    } else if (length && length < TITLE_MIN) {
      out.push({ id: "title-short", level: "tip", text: `The title is only ${plural(length, "character", "characters")}. A fuller one tells readers and search results more.` });
    }
    const words = wordCount(a.body);
    if (words < THIN_WORDS) {
      out.push({ id: "thin", level: "fix", text: `The article is only ${plural(words, "word", "words")}. Very short pages tend to rank poorly and feel unfinished.` });
    }
    const noAlt = picturesWithoutDescription(a.body);
    if (noAlt) {
      out.push({ id: "alt", level: "fix", text: `${plural(noAlt, "picture", "pictures")} in the text ${noAlt === 1 ? "has" : "have"} no description (alt text), so a screen reader can't say what ${noAlt === 1 ? "it shows" : "they show"}.` });
    }
    const broken = Array.isArray(a.brokenLinks) ? a.brokenLinks.filter(Boolean) : [];
    if (broken.length) {
      out.push({ id: "links", level: "fix", text: `${plural(broken.length, "link", "links")} to this site ${broken.length === 1 ? "doesn't" : "don't"} go anywhere: ${broken.slice(0, 3).join("; ")}${broken.length > 3 ? `; and ${broken.length - 3} more` : ""}.`, details: broken });
    }
    if (words >= LONG_WORDS && !hasHeadings(a.body)) {
      out.push({ id: "headings", level: "tip", text: `It runs to ${words} words with no headings. A few ## subheadings help readers skim, and two or more add a table of contents.` });
    }
    if (!clean(a.og_image).trim()) {
      out.push({ id: "share-image", level: "tip", text: "There is no share image, so links to this article will show the site's default picture." });
    }
    const tags = Array.isArray(a.tags) ? a.tags.filter((t) => clean(t).trim()) : [];
    if (!tags.length) {
      out.push({ id: "tags", level: "tip", text: "It has no tags, so it won't appear on any topic page." });
    }
    return out.sort((x, y) => (x.level === y.level ? 0 : x.level === "fix" ? -1 : 1));
  }

  window.PrePublish = { check, wordCount, picturesWithoutDescription, TITLE_MAX, TITLE_SUFFIX, THIN_WORDS };
})();
