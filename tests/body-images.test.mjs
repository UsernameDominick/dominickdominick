// Pictures written into article and project bodies: ![alt](address "caption") becomes a figure, safely.
import assert from "node:assert/strict";
import { paragraphsHtml, loadBodyMedia, safeImageSrc, excerpt, readingTime, renderJournalHtml } from "../worker/render.js";
import { bodyPictures, markdownLinkTargets, stripPictureLines, pictureUrl, mediaKeyFor } from "../worker/pictures.js";

const media = {
  "uploads/board.jpg": { key: "uploads/board.jpg", alt_text: "A breadboard with a blinking LED", width: 1600, height: 900 },
  "uploads/noalt.png": { key: "uploads/noalt.png", alt_text: null, width: 400, height: 300 },
  "uploads/bad.png": { key: "uploads/bad.png", alt_text: "x", width: 0, height: "wide" },
};
const html = (text, m = media) => paragraphsHtml(text, { media: m });

// The basic form, with stored size, lazy loading and the caption.
let out = html('![The finished board](/media/uploads/board.jpg "Version two, **tidied** up")');
assert.equal(
  out,
  '<figure class="image-figure body-figure"><img src="/media/uploads/board.jpg" alt="The finished board" loading="lazy" decoding="async" width="1600" height="900"><figcaption>Version two, <strong>tidied</strong> up</figcaption></figure>'
);

// No caption: no figcaption. Empty alt falls back to the library's default; no library default means alt="" (decorative).
assert.doesNotMatch(html("![x](/media/uploads/board.jpg)"), /figcaption/);
assert.match(html("![](/media/uploads/board.jpg)"), /alt="A breadboard with a blinking LED"/);
assert.match(html("![](/media/uploads/noalt.png)"), /alt="" loading/);
assert.match(html("![ ](/media/uploads/noalt.png)"), /alt="" loading/);
// A typed alt always wins over the library's.
assert.match(html("![Mine](/media/uploads/board.jpg)"), /alt="Mine"/);
// Implausible stored sizes are not used; unknown files and other addresses get no size.
assert.doesNotMatch(html("![a](/media/uploads/bad.png)"), /width=/);
assert.doesNotMatch(html("![a](/media/uploads/unknown.png)"), /width=/);
assert.doesNotMatch(html("![a](https://example.com/x.png)"), /width=/);
// Without any media map the picture still renders.
assert.match(paragraphsHtml("![a](/media/uploads/board.jpg)"), /<img src="\/media\/uploads\/board.jpg" alt="a" loading="lazy" decoding="async">/);
// The site's own absolute address finds the same library row.
assert.match(html("![a](https://dominickdominick.com/media/uploads/board.jpg)"), /width="1600"/);

// Several pictures, one per line, stack; surrounding text is untouched.
out = html("Before\n\n![one](/media/uploads/board.jpg)\n![two](/media/uploads/noalt.png)\n\nAfter");
assert.equal((out.match(/<figure/g) || []).length, 2);
assert.match(out, /^<p>Before<\/p>\n<figure/);
assert.match(out, /<\/figure>\n<p>After<\/p>$/);

// Escaping: alt, caption and address cannot break out of their attributes or add markup.
out = html('![a "quoted" <b>bold</b> & more](/media/uploads/board.jpg "cap <script>alert(1)</script>")');
assert.doesNotMatch(out, /<script|<b>/);
assert.match(out, /alt="a &quot;quoted&quot; &lt;b&gt;bold&lt;\/b&gt; &amp; more"/);
assert.match(out, /<figcaption>cap &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/figcaption>/);

// Unsafe or unsupported addresses are not pictures: the line stays text and nothing is requested.
for (const bad of ["javascript:alert(1)", "data:image/svg+xml;base64,AAAA", "//evil.example/x.png", "http://example.com/x.png", "ftp://x/y.png", "vbscript:x", "/a\\b.png", "relative/path.png"]) {
  out = html(`![a](${bad})`);
  assert.doesNotMatch(out, /<img|<figure/, bad);
}
assert.equal(safeImageSrc("/media/uploads/a.jpg"), "/media/uploads/a.jpg");
assert.equal(safeImageSrc("https://example.com/a.jpg"), "https://example.com/a.jpg");
assert.equal(safeImageSrc("  /x.png "), "/x.png");
assert.equal(safeImageSrc("/x\".png"), null);
assert.equal(safeImageSrc(""), null);
assert.equal(safeImageSrc(null), null);

// A picture inside a code fence is code, and one in the middle of a sentence stays text.
out = html("```\n![a](/media/uploads/board.jpg)\n```");
assert.doesNotMatch(out, /<figure|<img/);
assert.match(out, /<pre><code/);
assert.doesNotMatch(html("See ![a](/media/uploads/board.jpg) here"), /<figure/);
// One bad line in a run keeps the whole run as text rather than half a gallery.
assert.doesNotMatch(html("![a](/media/uploads/board.jpg)\n![b](javascript:x)"), /<figure/);

// Words in the picture line don't leak into excerpts or the reading time.
const body = "Intro words here.\n\n![A very long description of a picture with many words in it](/media/uploads/board.jpg \"Caption words\")\n\nMore words.";
assert.equal(excerpt(body), "Intro words here. More words.");
assert.equal(readingTime(`${"word ".repeat(400)}\n\n![${"alt ".repeat(400)}](/x.png)`), 2);
assert.equal(excerpt("Inline ![alt text](/x.png) stays"), "Inline alt text stays");

// loadBodyMedia: one query for all the library pictures, none when there are none, deduplicated, library addresses only.
const queries = [];
const env = {
  DB: {
    prepare(sql) {
      return {
        bind: (...keys) => ({
          all: async () => {
            queries.push({ sql, keys });
            return { results: keys.filter((k) => media[k]).map((k) => ({ ...media[k], tags: "[]" })) };
          },
        }),
      };
    },
  },
};
assert.deepEqual(await loadBodyMedia(env, "No pictures here.\n\n[a link](/media/uploads/board.jpg)"), {});
assert.equal(queries.length, 0, "no query without pictures");
const loaded = await loadBodyMedia(
  env,
  "![a](/media/uploads/board.jpg)\n\n![b](/media/uploads/board.jpg)\n\n![c](https://dominickdominick.com/media/uploads/noalt.png)\n\n![d](https://example.com/x.png)\n\n![e](javascript:x)\n\n![f](/media/scans/x.png)"
);
assert.equal(queries.length, 1);
assert.deepEqual(queries[0].keys.sort(), ["uploads/board.jpg", "uploads/noalt.png"]);
assert.equal(loaded["uploads/board.jpg"].width, 1600);
// A body with hundreds of pictures asks for at most 50 files.
queries.length = 0;
await loadBodyMedia(env, Array.from({ length: 200 }, (_, i) => `![a](/media/uploads/p${i}.jpg)`).join("\n\n"));
assert.equal(queries.length, 1);
assert.ok(queries[0].keys.length <= 50);


// ---- Everything that has to know about pictures agrees with the renderer (pictures.js) ----
const sample = [
  "Intro.",
  "![One](/media/uploads/board.jpg \"Caption (with parens)\")",
  "```",
  "![in code](/media/uploads/code.jpg)",
  "```",
  ":::note",
  "![In a callout](https://www.dominickdominick.com/media/uploads/noalt.png)",
  ":::",
  "![bad](javascript:alert(1))",
  "![mixed](/media/uploads/a.jpg)\n![also bad](data:image/png;base64,AA)",
  "![](https://example.com/x.png)",
].join("\n\n");
const found = bodyPictures(sample);
assert.deepEqual(found.map((p) => p.alt), ["One", "In a callout", ""]);
assert.deepEqual(found.map((p) => p.key), ["uploads/board.jpg", "uploads/noalt.png", null]);
assert.equal(found[0].caption, "Caption (with parens)");
assert.deepEqual(found.map(pictureUrl), ["/media/uploads/board.jpg", "/media/uploads/noalt.png", "https://example.com/x.png"]);
assert.equal(mediaKeyFor("/media/scans/x.png"), null);
// The usage list, report and renderer see the same pictures: what renders as a figure is exactly what bodyPictures returns.
assert.equal((paragraphsHtml(sample).match(/<figure/g) || []).length, found.length);

// Link checker targets: a picture's caption is not part of its address; empty alt still counts; ordinary links unchanged.
assert.deepEqual(markdownLinkTargets('See [a](/x "t") and ![](/media/uploads/a.png "Cap (x)") and ![b](https://e.com/p.png) and [c](/y)'), ["/x", "/media/uploads/a.png", "https://e.com/p.png", "/y"]);
assert.deepEqual(markdownLinkTargets("nothing here"), []);
assert.deepEqual(markdownLinkTargets(null), []);

// Word counts skip picture lines only.
assert.equal(stripPictureLines('Words.\n\n![alt words here](/x.png "cap words")\n\nMore words.').replace(/\s+/g, " ").trim(), "Words. More words.");
assert.equal(stripPictureLines("Inline ![alt](/x.png) stays"), "Inline ![alt](/x.png) stays");

// Excerpts: captions with parentheses, unfinished picture lines and pathological input.
assert.equal(excerpt('Before.\n\n![a](/x.png "cap (x)")\n\nAfter.'), "Before. After.");
assert.equal(excerpt("Inline ![alt](/x.png \"cap (x)\") here"), "Inline alt here");
assert.equal(excerpt("![alt](/x.png\n\nSecond paragraph survives (maybe)"), "![alt](/x.png Second paragraph survives (maybe)");
assert.equal(excerpt("![sketch](draft\nImportant sentence (really)\n\nTail words here."), "![sketch](draft Important sentence (really) Tail words here.");
{
  const started = Date.now();
  excerpt("![a](/x.png\n".repeat(6000));
  assert.ok(Date.now() - started < 250, "unclosed picture lines must not make excerpts slow");
}

// Callouts and journal entries pass the library rows along too.
assert.match(paragraphsHtml(":::note\n![](/media/uploads/board.jpg)\n:::", { media }), /alt="A breadboard with a blinking LED"[^>]*width="1600"/);
assert.match(renderJournalHtml([{ entry_type: "log", entry_date: "2026-01-01", title: "t", body: "![](/media/uploads/board.jpg)" }], media), /alt="A breadboard with a blinking LED"[^>]*width="1600"/);
assert.doesNotMatch(renderJournalHtml([{ entry_type: "log", entry_date: "2026-01-01", body: "![](/media/uploads/board.jpg)" }]), /width=/);

// loadBodyMedia takes several texts at once and never throws.
queries.length = 0;
await loadBodyMedia(env, ["![a](/media/uploads/board.jpg)", "![b](/media/uploads/noalt.png)"]);
assert.equal(queries.length, 1);
assert.deepEqual(queries[0].keys.sort(), ["uploads/board.jpg", "uploads/noalt.png"]);
const failing = { DB: { prepare: () => { throw new Error("D1 is down"); } } };
assert.deepEqual(await loadBodyMedia(failing, "![a](/media/uploads/board.jpg)"), {});
assert.deepEqual(await loadBodyMedia(failing, null), {});

// A line that starts with a picture but carries words is prose, not a picture-only line.
assert.equal(excerpt("![icon](/i.png) Prose after the icon (a note)"), "icon Prose after the icon (a note)");
assert.equal(excerpt("![a](/x.png) text (a) and more (b)"), "a text (a) and more (b)");
assert.equal(stripPictureLines("![icon](/i.png) Prose (a note)\n![only](/i.png)\n![only](/i.png 'single')").trim(), "![icon](/i.png) Prose (a note)");
// Non-standard inline pictures leave no stray "!".
assert.equal(excerpt("See ![a](/x y.png) here"), "See a here");
assert.equal(excerpt("See ![a](/x.png 'single') here"), "See a here");
// Link targets: unfinished links stay on their own line, single-quoted titles go, code examples are not links.
assert.deepEqual(markdownLinkTargets("[a](/x\n\n[b](/y)"), ["/y"]);
assert.deepEqual(markdownLinkTargets("[k](/projects/x 'single') and [j](/random/y \"Title\")"), ["/projects/x", "/random/y"]);
assert.deepEqual(markdownLinkTargets("Real [r](/real)\n\n```\n![in code](/media/uploads/nope.png)\n[l](/nope)\n```\n\n[after](/after)"), ["/real", "/after"]);

console.log("ALL PASS");
