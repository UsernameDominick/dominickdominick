// How SVG files are served from /media (see the /media route in index.js). The main worker module may only export handlers, so these live here.
// An SVG is a document, not just a picture: opened on its own address it would run any script in it with this site's privileges,
// and the page-wide policy allows inline scripts. So SVG files are sent under a policy that lets them draw and nothing else
// (no scripts, no network, and `sandbox` gives the document no origin of its own), whatever the upload cleaning did or missed.
export const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
export function isSvgContentType(type) {
  return /^image\/svg(\+xml)?\b/i.test(String(type || "").trim());
}
