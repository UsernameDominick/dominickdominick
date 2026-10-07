// The "Try the tools" strip at the bottom of the home page: one card for each tool page (Trainer, Studio, PicEditor, Sim, Scans) with what
// it does, so a visitor can find them without knowing to turn the nav dial. Pure: the page passes in its escape function. The owner can
// switch it off in Site settings > Header & footer (setting `home_tools_off` = "1").
import { navIconSvg } from "./nav-icons.js";

export const HOME_TOOLS = [
  { path: "/trainer", slug: "trainer", name: "Aim trainer", line: "Gridshot, tracking and flick drills for FPS games, with a score and a history." },
  { path: "/studio", slug: "studio", name: "Studio", line: "Make music in the browser: step sequencer, piano roll, keys, forty instruments." },
  { path: "/piceditor", slug: "piceditor", name: "PicEditor", line: "Edit pictures with layers, brushes, filters and text. Nothing is uploaded." },
  { path: "/simulations", slug: "simulations", name: "Circuit simulator", line: "Wire up a breadboard and see what lights up." },
  { path: "/scans", slug: "scans", name: "3D scans", line: "Open a scan or model and turn it around." },
];

export function homeToolsHtml(esc, off) {
  if (off === "1" || off === true) return "";
  const cards = HOME_TOOLS.map(
    (t) => `<a class="home-tool" href="${esc(t.path)}">${navIconSvg(t.slug, t.name)}<span class="home-tool-name">${esc(t.name)}</span><span class="home-tool-line">${esc(t.line)}</span></a>`
  ).join("");
  return `<section class="home-tools" aria-labelledby="home-tools-title"><h2 id="home-tools-title" class="home-tools-title">Try the tools</h2><div class="home-tools-grid">${cards}</div></section>`;
}
