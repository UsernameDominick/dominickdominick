// The site's app pages (built on public/app-kit.js): an admin tool as a page every visitor can use, with what they make kept in their
// own browser. One entry each: where it lives, its nav slug, its words for search engines, and the mount its script builds into.
// The Studio (/studio) came first and is routed on its own in index.js.

export const APP_PAGES = [
  {
    path: "/piceditor",
    slug: "piceditor",
    title: "PicEditor: edit pictures in your browser · Dominick",
    description: "Edit pictures in your browser: layers, brushes, selections, filters, text, crop and more. Nothing to install, and your pictures never leave your device.",
    h1: "PicEditor: edit pictures in your browser",
    about: "A photo editor with layers and masks, brushes and a pencil, selections, filters and adjustments, text, crop, straighten and redaction. Pictures you edit here are kept in your own browser and are never sent to the site.",
    mountId: "piceditor-mount",
    script: "/piceditor.js",
    loading: "Loading PicEditor…",
  },
  {
    path: "/simulations",
    slug: "simulations",
    title: "Simulations: build circuits in your browser · Dominick",
    description: "Build circuits on a breadboard in your browser: batteries, LEDs, switches, resistors, meters, transistors and logic gates, and see what lights up. Nothing to install, and nothing leaves your device.",
    h1: "Simulations: build circuits in your browser",
    about: "A circuit builder with a breadboard, power supplies, LEDs, lamps, buzzers, switches, resistors, capacitors, meters, diodes, transistors and logic gates, a schematic view, a build checklist and sweeps. Circuits you build here are kept in your own browser and are never sent to the site.",
    mountId: "simulations-mount",
    script: "/simulations.js",
    loading: "Loading Simulations…",
  },
];

export function appPageFor(path) {
  return APP_PAGES.find((p) => p.path === path) || null;
}

// The page body: a heading and a line for screen readers and search engines, and the mount (the page script builds the app into it).
export function appPageBody(page, esc) {
  return `<h1 class="sr-only">${esc(page.h1)}</h1><p class="sr-only">${esc(page.about)}</p><div class="app-mount" id="${page.mountId}"><p class="studio-loading" role="status">${esc(page.loading)}</p></div><noscript><p class="studio-noscript">This needs JavaScript.</p></noscript>`;
}
