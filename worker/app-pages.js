// The site's app pages (built on public/app-kit.js): an admin tool as a page every visitor can use, with what they make kept in their
// own browser. One entry each: where it lives, its nav slug, its words for search engines, and the mount its script builds into.
// The Studio (/studio) is one of them too.

export const APP_PAGES = [
  {
    path: "/studio",
    slug: "studio",
    image: "/share/studio.png", // a 1200 x 630 share card for links to this page
    title: "Studio: make music in your browser · Dominick",
    description: "Make music in your browser: a step sequencer, a piano roll, forty instruments and fifteen drum kits. Nothing to install, and nothing leaves your device.",
    h1: "Studio: make music in your browser",
    about: "A step sequencer, a piano roll, forty instruments and fifteen drum kits, with five tracks (drums, bass, chords, melody and lead), looping bars, MIDI keyboard input and song files you can save and share. Songs you make here are kept in your own browser and are never sent to the site.",
    mountId: "studio-mount",
    script: "/studio.js",
    loading: "Loading the Studio…",
    noscript: "The Studio needs JavaScript.",
  },
];

export function appPageFor(path) {
  return APP_PAGES.find((p) => p.path === path) || null;
}

// The page body: a heading and a line for screen readers and search engines, and the mount (the page script builds the app into it).
export function appPageBody(page, esc) {
  return `<h1 class="sr-only">${esc(page.h1)}</h1><p class="sr-only">${esc(page.about)}</p><div class="app-mount" id="${page.mountId}"><p class="studio-loading" role="status">${esc(page.loading)}</p></div><noscript><p class="studio-noscript">${esc(page.noscript || "This needs JavaScript.")}</p></noscript>`;
}
