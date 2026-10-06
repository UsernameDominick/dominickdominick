// The owner's rule: no emoji anywhere on the site, public or admin. This reads every file the site serves or builds pages from
// (public/, worker/) plus the two documents the admin shows (outline.md, features.json) and fails on any emoji character, on the
// emoji presentation selector (U+FE0F), and on emoji written as an escape (\u{1F525}, ▶, &#9654;, CSS "\25B6"). Symbols that
// phones draw as emoji count too (play, pause, stop, arrows like the north-east one): the site draws icons for those
// (worker/ui-icons.js). The copyright, registered and trade mark signs are plain text and allowed. A line that only holds an emoji
// as data (a stored key, a character to parse) carries the comment "no-emoji: data" and may use an escape, never the character.
import fs from "node:fs";
import path from "node:path";
import { renderReactionsHtml, renderTtsBarHtml } from "../worker/render.js";
import { uiIcon, UI_ICON_NAMES } from "../worker/ui-icons.js";
import { REACTION_EMOJI } from "../worker/db.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined && !c ? " " + JSON.stringify(extra) : ""}`); };

const ALLOWED = new Set([0xa9, 0xae, 0x2122]);
const isEmoji = (cp) => !ALLOWED.has(cp) && (cp === 0xfe0f || (cp >= 0xd83c && cp <= 0xd83e) || /\p{Extended_Pictographic}/u.test(String.fromCodePoint(cp)));
const LITERAL = /\p{Extended_Pictographic}|️/gu;
const ESCAPES = [/\\u\{([0-9a-f]+)\}/gi, /\\u([0-9a-f]{4})/gi, /&#x([0-9a-f]+);/gi, /&#(\d+);/g];
const CSS_ESCAPE = /\\([0-9a-f]{4,6})(?![0-9a-f])/gi;

export function emojiIn(text, file = "", { escapes = true } = {}) {
  const found = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(LITERAL)) if (isEmoji(m[0].codePointAt(0))) found.push(`${file}:${i + 1} ${m[0]}`);
    if (!escapes || /no-emoji: data/.test(line)) return;
    const pats = file.endsWith(".css") ? [...ESCAPES, CSS_ESCAPE] : ESCAPES;
    for (const re of pats) for (const m of line.matchAll(re)) {
      const cp = re.source.startsWith("&#(") ? Number(m[1]) : parseInt(m[1], 16);
      if (cp <= 0x10ffff && isEmoji(cp)) found.push(`${file}:${i + 1} ${m[0]}`);
    }
  });
  return found;
}

// The checker itself
ok(emojiIn("a 🔥 b").length === 1 && emojiIn("x ▶ y").length === 1 && emojiIn("❤️").length >= 1, "it finds emoji and symbols phones draw as emoji");
ok(emojiIn('"\\u{1F525}"').length === 1 && emojiIn("'\\u25B6'").length === 1 && emojiIn("&#9654;").length === 1 && emojiIn('content: "\\25B6";', "a.css").length === 1, "and the same written as escapes");
ok(emojiIn("© 2026 ✓ × ← → ↑ ↓ ♪ … ½").length === 0, "plain text symbols are fine");
ok(emojiIn('const K = ["\\u{1F44D}"]; // no-emoji: data').length === 0 && emojiIn('"👍" // no-emoji: data').length === 1, "a data-only line may hold an escape, never the character");

// Every file of the site
const found = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(p); }
    else if (/\.(js|mjs|html|css|json|svg|txt|webmanifest)$/.test(e.name)) found.push(...emojiIn(fs.readFileSync(p, "utf8"), p));
  }
}
walk("public");
walk("worker");
// the documents only by their characters: their prose may name an escape
for (const f of ["outline.md", "features.json"]) found.push(...emojiIn(fs.readFileSync(f, "utf8"), f, { escapes: false }));
ok(found.length === 0, "no emoji in the site's files or the documents the admin shows", found.slice(0, 40));

// What the reactions and the read-aloud bar draw
const counts = Object.fromEntries(REACTION_EMOJI.map((k) => [k, 2]));
const reactions = renderReactionsHtml("article", 1, counts);
const shown = reactions.replace(/data-emoji="[^"]*"/g, "");
ok(emojiIn(shown).length === 0 && (shown.match(/<svg /g) || []).length === REACTION_EMOJI.length, "reactions are drawn icons with names, the stored key only in data-emoji", shown);
ok(/Like/.test(shown) && /Good idea/.test(shown) && /Love it/.test(shown), "and each reaction has a name for screen readers");
const tts = renderTtsBarHtml("");
ok(emojiIn(tts.replace(/data-label-\w+="[^"]*"/g, "")).length === 0 && /<svg /.test(tts) && /read-aloud-label/.test(tts), "Read aloud has a drawn speaker and its words", tts);
ok(UI_ICON_NAMES.every((n) => /<path|<rect/.test(uiIcon(n))), "every drawn icon has a drawing");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
