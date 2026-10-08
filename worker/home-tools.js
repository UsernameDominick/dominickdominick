// The "Try the tools" strip (bento tiles: each is a small window with a title bar) at the bottom of the home page: one card for each tool page (Trainer, Studio, PicEditor, Sim, Scans) with what
// it does, so a visitor can find them without knowing to turn the nav dial. Pure: the page passes in its escape function. The owner can
// switch it off in Site settings > Header & footer (setting `home_tools_off` = "1").
import { navIconSvg, pixelIcon } from "./nav-icons.js";
import { inScope } from "./site-scope.js";

export const HOME_TOOLS = [
  { path: "/trainer", slug: "trainer", name: "Aim trainer", line: "Gridshot, tracking and flick drills for FPS games, with a score and a history." },
  { path: "/studio", slug: "studio", name: "Studio", line: "Make music in the browser: step sequencer, piano roll, keys, forty instruments." },
  { path: "/piceditor", slug: "piceditor", name: "PicEditor", line: "Edit pictures with layers, brushes, filters and text. Nothing is uploaded." },
  { path: "/simulations", slug: "simulations", name: "Circuit simulator", line: "Wire up a breadboard and see what lights up." },
  { path: "/scans", slug: "scans", name: "3D scans", line: "Open a scan or model and turn it around." },
];

export function homeToolsHtml(esc, off) {
  if (off === "1" || off === true) return "";
  // Only the tools still on the site (site-scope.js).
  const tools = HOME_TOOLS.filter((t) => inScope(t.slug));
  if (!tools.length) return "";
  const cards = tools.map(
    (t) => `<a class="home-tool" href="${esc(t.path)}"><span class="win-title" aria-hidden="true">${esc(t.slug)}</span>${navIconSvg(t.slug, t.name)}<span class="home-tool-name">${esc(t.name)}</span><span class="home-tool-line">${esc(t.line)}</span><span class="home-tool-go" aria-hidden="true">${pixelIcon("arrow", "icon", 32)}</span></a>`
  ).join("");
  return `<section class="home-tools" aria-labelledby="home-tools-title"><h2 id="home-tools-title" class="home-tools-title">${tools.length === 1 ? `Try the ${esc(tools[0].name)}` : "Try the tools"}</h2><div class="home-tools-grid">${cards}</div></section>`;
}
