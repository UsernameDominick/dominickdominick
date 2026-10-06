// The block bar's model (public/admin/block-bar-model.js): which chips a block gets and how they read, what × clears, the + menu,
// the size names and the dropdown pill's main choice.
import fs from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/admin/block-bar-model.js", import.meta.url), "utf8"), vm.createContext({ window, String, Object }));
const M = window.BlockBarModel;

// A slice of the inspector's STYLE_FIELDS, enough to cover every kind of field.
const FIELDS = [
  { key: "color", label: "Text color", type: "color" },
  { key: "bg", label: "Background color", type: "color" },
  { key: "padding", label: "Padding (px)", type: "number" },
  { key: "shadow", label: "Shadow", type: "select", options: [["", "None"], ["sm", "Small"], ["md", "Medium"], ["lg", "Large"]] },
  { key: "opacity", label: "Opacity (%)", type: "number" },
  { key: "backgroundImage", label: "Background image", type: "image-url" },
  { key: "backgroundSize", label: "Background image fit", type: "select", options: [["cover", "Cover"], ["contain", "Contain"]] },
  { key: "position", label: "Position", type: "select", options: [["", "Normal"], ["sticky", "Sticky (stays in view while scrolling past it)"]] },
  { key: "stickyOffset", label: "Sticky/fixed offset from top (px)", type: "number" },
  { key: "animation", label: "Entrance animation", type: "select", options: [["", "None"], ["fade-in", "Fade in"], ["custom", "Custom (build your own)…"]] },
  { key: "animationDelay", label: "Animation delay (ms)", type: "number" },
  { key: "visibility", label: "Show on", type: "select", options: [["", "All devices"], ["desktop-only", "Desktop only (hidden on mobile)"]] },
  { key: "visibleFrom", label: "Visible from", type: "datetime-local" },
  { key: "hidden", label: "Hide from live site", type: "checkbox" },
];
const texts = (style) => M.chipsFor(style, FIELDS).map((c) => c.text);

ok(texts({}).length === 0 && texts(undefined).length === 0, "a block with nothing set has no style chips");
ok(texts({ shadow: "", bg: null, hidden: false, padding: undefined }).length === 0, "empty, null and false values are not set");
ok(JSON.stringify(texts({ shadow: "md" })) === '["Shadow · Medium"]', "a choice reads as name · value", texts({ shadow: "md" }));
ok(JSON.stringify(texts({ animation: "fade-in", visibility: "desktop-only" })) === '["Fade in","Desktop only"]', "where the value says it all, the chip is just the value (bracketed notes dropped)", texts({ animation: "fade-in", visibility: "desktop-only" }));
ok(JSON.stringify(texts({ position: "sticky" })) === '["Position · Sticky"]', "a long option label is cut at its bracket");
ok(JSON.stringify(texts({ padding: 24, opacity: 80 })) === '["Padding 24px","Opacity 80%"]', "numbers carry their unit", texts({ padding: 24, opacity: 80 }));
ok(texts({ padding: 0 })[0] === "Padding 0px", "zero is a value, not unset");
const bg = M.chipsFor({ bg: "#7c3aed" }, FIELDS)[0];
ok(bg.text === "Background" && bg.swatch === "#7c3aed", "a colour chip names the setting and shows a swatch", bg);
ok(JSON.stringify(texts({ hidden: true })) === '["Hidden"]', "a switch is just its name");
ok(JSON.stringify(texts({ backgroundImage: "/media/a.png", backgroundSize: "contain" })) === '["Background image"]', "a setting that refines another has no chip of its own", texts({ backgroundImage: "/media/a.png", backgroundSize: "contain" }));
ok(JSON.stringify(texts({ animationDelay: 300 })) === "[]", "a refining setting alone shows nothing");
ok(texts({ visibleFrom: "2026-10-06T12:30:00.000Z" })[0] === "Shown from 2026-10-06 12:30", "a date reads as day and time", texts({ visibleFrom: "2026-10-06T12:30:00.000Z" }));
ok(JSON.stringify(texts({ hidden: true, shadow: "sm", bg: "#000" })) === '["Background","Shadow · Small","Hidden"]', "chips come in the inspector's order");
ok(texts({ animation: "custom" })[0] === "Custom", "a trailing ellipsis is dropped too", texts({ animation: "custom" }));

// × clears the setting and whatever rides on it
ok(JSON.stringify(M.keysOf("animation").sort()) === JSON.stringify(["animation", "animationDelay", "customKeyframes"]), "clearing animation also clears its delay and keyframes", M.keysOf("animation"));
ok(JSON.stringify(M.keysOf("shadow")) === '["shadow"]', "a plain setting clears only itself");
ok(M.keysOf("position").includes("stickyOffset") && M.keysOf("backgroundImage").includes("backgroundSize"), "position takes its offset, a background image its fit");

// the + menu
const add = M.addable({ shadow: "md" }, FIELDS).map((x) => x.key);
ok(!add.includes("shadow") && add.includes("bg") && add.includes("padding"), "+ offers the common settings the block does not have yet", add);
ok(add.indexOf("bg") < add.indexOf("padding") && add[0] === "bg", "in the order people reach for them");
ok(!M.addable({}, [{ key: "bg", type: "color" }]).some((x) => x.key === "padding"), "it never offers a setting the inspector does not have");

// sizes
ok(["¼", "⅓", "½", "⅔", "Full"].join() === [6, 8, 12, 16, 24].map(M.sizeLabel).join(), "the size presets have their names");
ok(M.sizeLabel(10) === "10/24", "any other width reads as columns");

// the dropdown pill
const HEADING = [
  { key: "text", label: "Text", type: "text" },
  { key: "level", label: "Heading level", type: "select", numeric: true, options: [[1, "H1 — page title"], [2, "H2"], [3, "H3"]] },
];
let ch = M.mainChoice(HEADING, { text: "x", level: 2 });
ok(ch && ch.key === "level" && ch.text === "H2" && ch.value === "2" && ch.options.length === 3, "a heading's pill is its level", ch);
ch = M.mainChoice(HEADING, { text: "x" });
ok(ch.text === "H1 — page title" && ch.value === "1", "with nothing chosen it shows the first option");
ok(M.mainChoice([{ key: "text", type: "text" }], {}) === null, "a block with no choice list has no pill");
ok(M.mainChoice([{ key: "only", type: "select", options: [["a", "A"]] }], {}) === null, "a list with one option is not a choice");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
