// What a visitor can read off a published circuit: each part's value and (once powered) its live figures, and the plain-language
// description of the whole circuit used for the page description, the "About this circuit" list and screen readers.
import assert from "node:assert/strict";
import { renderSimulationSvg, describeSimulation } from "../worker/simulation-render.js";
import { simulationEmbedHtml } from "../worker/render.js";

const part = (id, type, extra = {}) => ({ id, type, x: 100 + Object.keys(extra).length, y: 100, ...extra });
const wire = (a, ap, b, bp, id) => ({ id, from: { compId: a, pin: ap }, to: { compId: b, pin: bp } });

// ---- the description ----
const circuit = {
  components: [part("b", "battery", { voltage: 9 }), part("r", "resistor", { resistance: 220 }), part("l", "led", { color: "red" })],
  wires: [wire("b", "pos", "r", "p1", "w1"), wire("r", "p2", "l", "anode", "w2"), wire("l", "cathode", "b", "neg", "w3")],
};
const d = describeSimulation(circuit);
assert.equal(d.sentence, "An interactive circuit with a 9 V battery, a 220 Ω resistor and a red LED. Power it on, then tap or press any part to see its readings.");
assert.deepEqual(d.lines, ["9 V battery", "Resistor: 220 Ω", "red LED"]);
assert.equal(describeSimulation({ components: [], wires: [] }).sentence, "An empty circuit.");
assert.equal(describeSimulation(null).sentence, "An empty circuit.", "damaged data never throws");
assert.match(describeSimulation({ components: [part("a", "resistor", { resistance: 1000 }), part("b", "resistor", { resistance: 1000 }), part("c", "led", { color: "blue" })] }).sentence, /2 × 1.00 kΩ resistors and a blue LED/);
// at most eight kinds are named
const many = describeSimulation({ components: Array.from({ length: 12 }, (_, i) => part(`r${i}`, "resistor", { resistance: 100 * (i + 1) })) });
assert.match(many.sentence, /and 4 other kinds of part/);
// custom labels name the part, a switch says how it is set
const labelled = describeSimulation({ components: [part("s", "switch", { closed: false, label: "Main switch" })] });
assert.deepEqual(labelled.lines, ["Main switch: open"]);

// ---- the drawing carries each part's readings ----
const svg = renderSimulationSvg(circuit);
const attrs = (id) => {
  const m = new RegExp(`<g class="sim-comp[^"]*" data-id="${id}"[^>]*>`).exec(svg);
  assert.ok(m, `part ${id} drawn`);
  return m[0];
};
assert.match(attrs("r"), /tabindex="0" role="button" data-readout-name="Resistor" data-readout="220 Ω" data-readout-live="[^"]*mA · [^"]*W · OK"/, "a resistor in a closed loop has its current, power and status");
assert.match(attrs("l"), /data-readout-name="LED" data-readout="red LED" data-readout-live="[0-9.]+ mA · (OK|Dim|Overdriven)/);
assert.match(attrs("b"), /data-readout="9 V battery" data-readout-live=""/, "a battery has a value and nothing live");
assert.match(attrs("r"), /aria-label="Resistor, 220 Ω\. Show its readings"/);
// a part that isn't in a closed loop has a value and no live figures
const open = renderSimulationSvg({ components: [part("r", "resistor", { resistance: 470 })], wires: [] });
assert.match(open, /data-readout="470 Ω" data-readout-live=""/);
// a breadboard is not something to ask about
assert.doesNotMatch(renderSimulationSvg({ components: [part("bb", "breadboard", {})], wires: [] }), /data-readout-name/);
// labels and values are escaped
const hostile = renderSimulationSvg({ components: [part("r", "resistor", { resistance: 220, label: 'A"><script>alert(1)</script>' })], wires: [] });
assert.doesNotMatch(hostile, /<script>/);
assert.match(hostile, /data-readout-name="A&quot;&gt;&lt;script&gt;/);

// ---- the markup around it ----
const sim = { name: "LED & resistor", data: circuit };
const html = simulationEmbedHtml(sim, "sim-x", "");
assert.match(html, /<svg class="sim-svg" id="sim-x" role="group" aria-label="LED &amp; resistor" aria-describedby="sim-x-desc"/, "a group (its parts can be focused), not an image");
assert.match(html, /<p id="sim-x-desc" class="sr-only">An interactive circuit with a 9 V battery/, "described even when the placement wrote no description");
assert.match(html, /<p class="sim-readout" role="status" aria-live="polite"[^>]*>Tap or press a part to see its readings\.<\/p>/);
assert.doesNotMatch(html, /About this circuit/, "the visible list is only on the circuit's own page");
assert.match(simulationEmbedHtml(sim, "sim-y", "My own words"), /<p id="sim-y-desc" class="sr-only">My own words<\/p>/);
const page = simulationEmbedHtml(sim, "sim-z", "", { about: true });
assert.match(page, /<section class="sim-about" aria-labelledby="sim-z-about-h"><h2 id="sim-z-about-h">About this circuit<\/h2><p>An interactive circuit with[^<]*<\/p><ul><li><button type="button" class="sim-about-part" data-part="b" data-target="sim-z">9 V battery<\/button><\/li><li><button type="button" class="sim-about-part" data-part="r" data-target="sim-z">Resistor: 220 Ω<\/button><\/li><li><button type="button" class="sim-about-part" data-part="l" data-target="sim-z">red LED<\/button><\/li><\/ul><\/section>/);

console.log("ALL PASS");
