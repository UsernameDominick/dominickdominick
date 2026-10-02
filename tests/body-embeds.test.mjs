// Simulations, songs and 3D scans placed into text with ::sim 148:: (also ::song and ::scan).
import assert from "node:assert/strict";
import { paragraphsHtml, loadBodyMedia, excerpt, readingTime } from "../worker/render.js";
import { paragraphEmbed, bodyEmbeds, stripEmbedLines, EMBED_LINE } from "../worker/embeds.js";

// ---- parsing ----
assert.deepEqual(paragraphEmbed("::sim 148::"), { kind: "sim", id: 148, description: "" });
assert.deepEqual(paragraphEmbed('  ::song 3 ::  '), { kind: "song", id: 3, description: "" });
assert.deepEqual(paragraphEmbed('::scan 2 "A bracket, seen from above"::'), { kind: "scan", id: 2, description: "A bracket, seen from above" });
for (const not of ["::sim::", "::sim abc::", "::sim 1:: after", "before ::sim 1::", "::video 1::", "::sim 1\n::sim 2::", "::sim 12345678901::", ":::sim 1:::", "::sim 1 'single'::", ""]) {
  assert.equal(paragraphEmbed(not), null, not);
}
const text = ["Intro.", "::sim 1::", "```", "::sim 2::", "```", ":::note", "::song 3::", ":::", "::scan 4 \"d\"::", "::sim 1::"].join("\n\n");
assert.deepEqual(bodyEmbeds(text).map((e) => `${e.kind}:${e.id}`), ["sim:1", "song:3", "scan:4", "sim:1"], "code is skipped, callouts are not");
assert.equal(stripEmbedLines("Words.\n\n::sim 1::\n\nMore words. ::sim 2:: inline").replace(/\s+/g, " ").trim(), "Words. More words. ::sim 2:: inline");

// ---- rendering from a prepared lookup ----
const circuit = { name: "LED & resistor", data: { components: [], wires: [] } };
const song = { name: "Loop <one>", data: { bpm: 100, private_notes: "SECRET", visualization: "bars" } };
const scan = { name: "Bracket", glb_key: "scans/bracket.glb" };
// loadBodyMedia attaches the lookup to the media object under a symbol key; the fake database below stands in for D1.
const queries = [];
const rows = { simulations: { 1: { id: 1, name: circuit.name, data: JSON.stringify(circuit.data) } }, songs: { 3: { id: 3, name: song.name, data: JSON.stringify(song.data) } }, scans: { 4: { id: 4, ...scan } } };
const env = {
  DB: {
    prepare(sql) {
      const table = /FROM (simulations|songs|scans)/.exec(sql)[1];
      return {
        bind: (id) => ({
          first: async () => {
            queries.push(`${table}:${id}`);
            return rows[table][id] || null;
          },
          all: async () => ({ results: [] }),
        }),
      };
    },
  },
};
const body = ["Intro words.", '::sim 1 "A resistor limiting current to an LED"::', "::sim 1::", "::song 3::", "::scan 4::", "::sim 99::", "::song 98::", "Closing words."].join("\n\n");
const media = await loadBodyMedia(env, body);
assert.deepEqual(Object.keys(media), [], "the embeds ride on the object out of sight");
assert.deepEqual([...queries].sort(), ["scans:4", "simulations:1", "simulations:99", "songs:3", "songs:98"], "each distinct item is fetched once");
const html = paragraphsHtml(body, { media });
// the simulation, twice, with distinct ids and its own description
const simIds = [...html.matchAll(/<svg[^>]*class="sim-svg" id="(sim-body-\d+)"/g)].map((m) => m[1]);
assert.equal(simIds.length, 2);
assert.notEqual(simIds[0], simIds[1], "two embeds of the same circuit get different ids");
assert.match(html, new RegExp(`<p id="${simIds[0]}-desc" class="sr-only">A resistor limiting current to an LED</p>`));
assert.doesNotMatch(html, new RegExp(`${simIds[1]}-desc`));
assert.equal((html.match(/data-target="sim-body-\d+"/g) || []).length, 4, "each has Power on and Schematic view buttons pointing at it");
assert.match(html, /<div class="body-embed body-embed-sim">/);
// the song: data rides along but not the private notes; name escaped
assert.match(html, /class="song-embed[^"]*" data-song="[^"]*bpm[^"]*"/);
assert.doesNotMatch(html, /SECRET/);
assert.match(html, /Loop &lt;one&gt;/);
// the scan
assert.match(html, /<div class="body-embed body-embed-scan">.*<model-viewer src="\/media\/scans\/bracket\.glb"[^>]*alt="Bracket"/s);
// a missing or unpublished item shows nothing, not a raw line or an error
assert.doesNotMatch(html, /::(sim|song) 9\d::|not found/i);
assert.match(html, /<p>Intro words\.<\/p>/);
assert.match(html, /<p>Closing words\.<\/p>/);

// no lookup: the line stays as typed (nothing to show it with); inside a code block it is code
assert.match(paragraphsHtml("::sim 1::"), /<p>::sim 1::<\/p>/);
assert.match(paragraphsHtml("```\n::sim 1::\n```", { media }), /<pre><code[^>]*>::sim 1::\n?<\/code><\/pre>/);
// inside a callout it renders
assert.match(paragraphsHtml(":::note\n::song 3::\n:::", { media }), /<div class="callout[^>]*>.*song-embed/s);
// a draft sim isn't returned by the lookup (published snapshot only): simulate by a lookup that says null
const gone = await loadBodyMedia({ DB: { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }) }) }) } }, "::sim 1::");
assert.equal(paragraphsHtml("::sim 1::", { media: gone }).trim(), "");

// no more than 20 distinct items per lookup, and a failing database never breaks the page
queries.length = 0;
await loadBodyMedia(env, Array.from({ length: 60 }, (_, i) => `::song ${i + 1}::`).join("\n\n"));
assert.ok(queries.length <= 20, `looked up ${queries.length}`);
const broken = await loadBodyMedia({ DB: { prepare: () => { throw new Error("D1 is down"); } } }, "::sim 1::\n\n![a](/media/uploads/x.png)");
assert.equal(paragraphsHtml("::sim 1::", { media: broken }).trim(), "");

// excerpts, meta descriptions and reading time ignore the lines
assert.equal(excerpt("Before.\n\n::sim 148::\n\nAfter."), "Before. After.");
assert.equal(readingTime(`${"word ".repeat(400)}\n\n${"::sim 1::\n\n".repeat(300)}`), 2);

// ---- review fixes ----
// the kind is not case sensitive
assert.deepEqual(paragraphEmbed("::SIM 148::"), { kind: "sim", id: 148, description: "" });
assert.deepEqual(bodyEmbeds("::Song 3::").map((e) => e.kind), ["song"]);
assert.equal(stripEmbedLines("a\n\n::SCAN 2::\n\nb").replace(/\s+/g, " ").trim(), "a b");
// a page shows at most 20 embeds in total, copies included
{
  const many = Array.from({ length: 35 }, () => "::sim 1::").join("\n\n");
  const m = await loadBodyMedia(env, many);
  const out = paragraphsHtml(many, { media: m });
  assert.equal((out.match(/<svg[^>]*class="sim-svg"/g) || []).length, 20);
}
// one drawing per circuit per request: the extra copies reuse it, each with its own id and buttons described by the circuit
{
  const two = "::sim 1::\n\n::sim 1::";
  const out = paragraphsHtml(two, { media: await loadBodyMedia(env, two) });
  const svgs = out.match(/<svg[^>]*class="sim-svg"[^>]*>/g) || [];
  assert.equal(svgs.length, 2);
  assert.match(out, /<button type="button" class="sim-power-btn" data-target="(sim-body-\d+)" aria-describedby="\1">Power on<\/button>/);
}

console.log("ALL PASS");
