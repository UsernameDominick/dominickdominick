// The small line icons the site draws where it once used emoji or symbol characters: the owner wants no emoji anywhere, and phones
// draw play, stop and similar symbol characters as coloured emoji. Pure, so the worker and a node test share it. The play drawing is also
// inlined in the one browser script that swaps it for a stop icon (song-embed.js), so a change to it here is copied there.

const P = {
  play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
  speaker: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  external: '<path d="M8 16 17 7"/><path d="M9 7h8v8"/>',
  back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  like: '<path d="M7 11v9H4v-9z"/><path d="M7 11l4-7c1.3 0 2.3 1.1 2 2.4L12.4 10H19a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 20H7"/>',
  idea: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
  love: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
};


export function uiIcon(name, cls = "ui-icon") {
  return `<svg class="${cls}" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ""}</svg>`;
}
