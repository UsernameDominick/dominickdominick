// Which small icon a nav link shows above its name (the camera-dial nav): picked from the link's slug and label, so the owner's own
// pages get a fitting one without a setting, and anything unknown gets a plain dot. Pure, so the worker and a node test share it.

const P = {
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>',
  projects: '<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  articles: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 12h7M9 16h7"/>',
  random: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>',
  components: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
  topics: '<path d="M4 12V4h8l8 8-8 8z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
  studio: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  notes: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  about: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  contact: '<path d="M4 5h16v11H9l-5 4z"/>',
  circuit: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  scans: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5"/>',
  photos: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 8"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  resume: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  saved: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  dot: '<circle cx="12" cy="12" r="3.5"/>',
};

// First match wins, so the more specific words come first.
const RULES = [
  ["notes", /hidden|private|vault|secret/],
  ["home", /^home$|^index$|^start$/],
  ["studio", /studio|music|song|beat|audio/],
  ["random", /random|shuffle|surprise/],
  ["articles", /article|blog|writ|post|journal|essay|news/],
  ["projects", /project|work|portfolio|build/],
  ["components", /component|part|lab|tool|kit/],
  ["topics", /topic|tag|categor|subject/],
  ["circuit", /circuit|sim|electr/],
  ["scans", /scan|3d|model/],
  ["photos", /photo|gallery|image|picture|^pic/],
  ["contact", /contact|message|chat|mail|hello/],
  ["about", /about|bio|^me$|who/],
  ["resume", /resume|cv|experience/],
  ["search", /search|find/],
  ["saved", /saved|bookmark|later/],
  ["history", /history|recent/],
  ["notes", /note/],
];

export function navIconName(slug, label) {
  const s = String(slug || "").toLowerCase();
  const l = String(label || "").toLowerCase();
  for (const [name, re] of RULES) if (re.test(s)) return name;
  for (const [name, re] of RULES) if (re.test(l)) return name;
  return "dot";
}

export function navIconSvg(slug, label) {
  return `<svg class="tab-ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[navIconName(slug, label)]}</svg>`;
}
