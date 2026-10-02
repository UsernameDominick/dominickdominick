// Simulations, songs and 3D scans placed into article and project text: a paragraph that is only `::sim 148::`, `::song 3::` or
// `::scan 2::` (the number is the item's id in its library), optionally with a description for people who can't see it:
// `::sim 148 "A resistor limiting the current to an LED"::`. Pure helpers shared by the renderer and the places that count words.
import { proseOf } from "./pictures.js";

export const EMBED_LINE = /^::(sim|song|scan)\s+(\d{1,9})(?:\s+"([^"\n]*)")?\s*::$/;
// The same line inside a longer text (for stripping it from excerpts and word counts).
export const EMBED_ONLY_LINE = /^[ \t]*::(?:sim|song|scan)\s+\d{1,9}(?:\s+"[^"\n]*")?\s*::[ \t]*$/gm;
// A page asks for at most this many embedded items, so a pasted wall of them can't turn into a wall of queries.
export const MAX_BODY_EMBEDS = 20;

// The embed a paragraph holds, when the paragraph is nothing but one embed line.
export function paragraphEmbed(paragraph) {
  const text = String(paragraph).trim();
  if (text.includes("\n")) return null;
  const m = EMBED_LINE.exec(text);
  return m ? { kind: m[1], id: Number(m[2]), description: m[3] || "" } : null;
}

// Every embed the renderer would show in a text (code examples and callout markers handled like pictures), in order.
export function bodyEmbeds(text) {
  const out = [];
  for (const paragraph of proseOf(text).split(/\n{2,}/)) {
    const embed = paragraph.trim() ? paragraphEmbed(paragraph) : null;
    if (embed) out.push(embed);
  }
  return out;
}

export function stripEmbedLines(text) {
  return String(text || "").replace(EMBED_ONLY_LINE, "");
}
